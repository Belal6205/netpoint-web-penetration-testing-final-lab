# 🛒 NetPoint Store

**NetPoint Store** is a small e-commerce platform for networking gear and smart hardware — routers, switches, mesh Wi-Fi, security cameras, tools and accessories.

A classic server-rendered monolith built with **Node.js + Express + EJS + MySQL**, fully containerized with Docker. Clone it, run one command, and you have a complete storefront running on your own machine — no cloud services, no external APIs, no manual database setup.

## ✨ Features

- 👤 User accounts — register, sign in/out, password reset
- 🔍 Product catalog with search & category filters
- ⭐ Product reviews with ratings, photo attachments & a community leaderboard
- 🛒 Shopping cart, coupon codes and checkout (simulated payment)
- 📦 Order history, printable invoices and downloadable receipts
- 🖼 Customer profiles with avatar upload or import-from-URL
- 🧰 Back-office admin panel — catalog, orders, customers, ERP XML import

## 📋 Requirements

| Requirement | Notes |
|---|---|
| **Docker** | Docker Desktop (Windows/macOS) or Docker Engine + Compose v2 (Linux) |
| **Disk space** | ~1 GB free |
| **Free port** | `9000` by default (configurable — see troubleshooting) |

> Check that Compose v2 works: `docker compose version`

## 🚀 Deployment — start to finish

### 1️⃣ Clone the repository

```bash
git clone https://github.com/abdelrahman-reda-ahmed/netpoint-store.git
```

```bash
cd netpoint-store
```

### 2️⃣ Build and start everything

```bash
docker compose up --build
```

That single command will:

1. Build the app image (Node.js 20)
2. Pull the MySQL 8 image
3. Start three containers: **app**, **database**, and an internal inventory-sync service
4. Auto-create the schema and load realistic demo data on first boot

⏳ The first start takes **2–5 minutes** while images download and the database initializes. You'll know it's ready when you see:

```
netpoint-app  | [boot] database connection established
netpoint-app  |
netpoint-app  |   NetPoint Store is running
netpoint-app  |   http://localhost:9000
```

### 3️⃣ Open the store

👉 **http://localhost:9000**

Sign in with a seeded demo account or create your own:

| Role     | Email                  | Password   |
| -------- | ---------------------- | ---------- |
| Admin    | `admin@netpoint.store` | `admin123` |
| Customer | `sarah.j@example.com`  | `Passw0rd` |
| Customer | `mike_t@example.com`   | `qwerty12` |

### 4️⃣ Stop / reset

```bash
docker compose down        # stop containers (data is kept)
docker compose down -v     # stop AND wipe the database back to seed state
```

Run `docker compose up -d` afterwards to start again (add `--build` only if source changed).

## 🔧 Useful commands

```bash
docker compose logs -f app                                # follow application logs
docker compose ps                                         # container status
docker compose exec db mysql -uroot -prootpw netpoint     # open a MySQL shell
docker compose exec app sh                                # shell inside the app container
```

## 🛠 Troubleshooting

<details>
<summary><b>Port 9000 is already in use</b></summary>

Pick any free port:

```bash
# Linux / macOS / WSL
APP_PORT=8080 docker compose up --build
```
```powershell
# PowerShell
$env:APP_PORT = 8080; docker compose up --build
```
Then browse to `http://localhost:<your-port>` instead.
</details>

<details>
<summary><b>Page shows "waiting for database" or login fails right after first start</b></summary>

The database needs a little longer on slower machines. Wait ~30 seconds and reload,
or check health with:

```bash
docker compose ps          # db should show (healthy)
docker compose logs db     # look for "ready for connections"
```
</details>

<details>
<summary><b>I want a completely fresh install</b></summary>

```bash
docker compose down -v
docker compose up --build
```
This deletes the data volume and re-initializes everything from scratch.
</details>

<details>
<summary><b>Build fails or behaves oddly after pulling new commits</b></summary>

Rebuild without cache:

```bash
docker compose build --no-cache
docker compose up -d
```
</details>

## 🗂 Project structure

```
netpoint-store/
├── docker-compose.yml      # 3-container orchestration (app + mysql + internal service)
├── Dockerfile              # Node.js 20 app image
├── db/
│   ├── 01_schema.sql       # database schema (auto-applied on first boot)
│   └── 02_seed.sql         # realistic demo data
├── src/
│   ├── server.js           # entrypoint (waits for DB, then listens)
│   ├── app.js              # express wiring
│   ├── routes/             # auth, catalog, cart, orders, profile, admin, misc
│   ├── views/              # EJS templates
│   └── public/             # css, js, product images, uploads
├── scripts/
│   └── make_receipt.js     # receipt generator used by the invoice pipeline
└── internal-service/       # private inventory-sync agent (not exposed)
```

## 🧱 Tech stack

| Layer    | Technology                     |
| -------- | ------------------------------ |
| Backend  | Node.js 20 · Express 4         |
| Views    | EJS server-side templates      |
| Database | MySQL 8                        |
| Uploads  | Multipart handling → `/uploads` |
| Deploy   | Docker · Docker Compose        |

---

> ⚠️ **Educational notice:** NetPoint Store was built as a capstone target for an offline
> penetration-testing workshop. It is intended to run **locally in an isolated lab environment
> only**. Do not deploy it to a public host or expose it to untrusted networks.
