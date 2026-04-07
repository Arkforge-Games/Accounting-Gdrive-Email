# AccountSync — Autonomous Accounting Platform

A Next.js web application that automatically syncs, categorizes, and records all accounting documents from Gmail, Google Drive, Xero, Wise, and Google Sheets — with AI-powered classification and a monitoring dashboard.

**Live URL:** https://accounting.devehub.app
**Direct URL:** http://74.226.88.89:8325
**Repo:** https://github.com/Arkforge-Games/Accounting-Gdrive-Email

---

## What It Does

Syncs accounting data from **5 sources** every day at 6PM:
1. **Gmail** — emails + attachments via IMAP
2. **Google Drive** — files via OAuth2
3. **Xero** — invoices, bills, contacts, P&L, balance sheet
4. **Wise** — multi-currency transfers, balances, exchange rates
5. **Google Sheets** — bidirectional Expenses Sheet sync

Then runs an **autonomous pipeline** that:
1. AI-categorizes each new file (using OpenRouter + Llama/GPT-OSS)
2. Extracts amounts from PDFs and email bodies
3. Detects duplicates (vendor + amount + date proximity)
4. Auto-records to Google Sheets (Payable/Receivable tabs)
5. Auto-creates DRAFT bills/invoices in Xero
6. Logs every action to a monitoring dashboard

Every change is auditable. Andrea (the accountant) can review AI decisions on the Monitor page.

---

## Quick Links

| Page | Purpose |
|------|---------|
| [/dashboard](https://accounting.devehub.app/dashboard) | Overview — file stats |
| [/dashboard/chat](https://accounting.devehub.app/dashboard/chat) | AI Assistant (ask questions about your finances) |
| [/dashboard/analytics](https://accounting.devehub.app/dashboard/analytics) | Multi-currency, spending trends, cash flow, vendors, budget |
| [/dashboard/expenses](https://accounting.devehub.app/dashboard/expenses) | Google Sheets Payable + Receivable (bidirectional) |
| [/dashboard/accounting](https://accounting.devehub.app/dashboard/accounting) | All 345+ files categorized by AI |
| [/dashboard/xero](https://accounting.devehub.app/dashboard/xero) | Xero — 9 tabs: invoices, bills, contacts, P&L, balance sheet, file matching |
| [/dashboard/wise](https://accounting.devehub.app/dashboard/wise) | 1,385 Wise transfers, recipients, exchange rates |
| [/dashboard/monitor](https://accounting.devehub.app/dashboard/monitor) | Pipeline run history + audit log |
| [/dashboard/alerts](https://accounting.devehub.app/dashboard/alerts) | Overdue invoices, duplicates, missing periods |
| [/dashboard/reports](https://accounting.devehub.app/dashboard/reports) | Monthly accounting reports |
| [/dashboard/settings](https://accounting.devehub.app/dashboard/settings) | Manage 5 integrations (Gmail, GDrive, Xero, Wise, Outlook) |

---

## Architecture

```
                    Internet
                       │
                       ▼
            ┌─────────────────────┐
            │  accounting.devehub.app  │  (DNS → Alibaba Nginx)
            │    8.210.219.100    │
            └─────────┬──────────┘
                      │ HTTPS
                      ▼
            ┌─────────────────────┐
            │  Azure VM (Ubuntu)  │
            │  74.226.88.89:8325  │
            └─────────┬──────────┘
                      │
            ┌─────────┴─────────────────┐
            │  Next.js 15 App           │
            │  (systemd service)        │
            └─────────┬─────────────────┘
                      │
        ┌─────────────┼──────────────────────────┐
        ▼             ▼              ▼            ▼
   ┌────────┐   ┌──────────┐   ┌──────────┐  ┌─────────┐
   │ SQLite │   │  Gmail   │   │  Google  │  │  Xero   │
   │  data  │   │  IMAP    │   │  Drive   │  │  Wise   │
   │  .db   │   │          │   │          │  │ Sheets  │
   └────────┘   └──────────┘   └──────────┘  └─────────┘
                      │
                      ▼
              ┌─────────────┐
              │  OpenRouter │
              │  (AI categ) │
              └─────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript 5.8 |
| Styling | Tailwind CSS v4 |
| Database | SQLite (better-sqlite3) |
| Email | IMAP (imapflow + mailparser) |
| Google APIs | googleapis + google-auth-library |
| Xero | Custom OAuth2 client (xero-node not used) |
| Wise | REST API (custom client) |
| AI | OpenRouter (configurable model — Llama 3.3, GPT-OSS, Gemini) |
| PDF Parsing | pdf-parse |
| Compression | archiver (ZIP downloads) |
| Runtime | Node.js 22 |
| Process Manager | systemd |
| Hosting | Azure VM + Alibaba Cloud Nginx proxy |

---

## Documentation

| Doc | Purpose |
|-----|---------|
| [docs/USER-GUIDE.md](./docs/USER-GUIDE.md) | **For Andrea (accountant)** — how to use the system |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | System architecture, data flow, design decisions |
| [docs/PIPELINE.md](./docs/PIPELINE.md) | Autonomous pipeline — categorize, dedupe, record |
| [docs/AI-RULES.md](./docs/AI-RULES.md) | AI categorization rules and Andrea's feedback |
| [docs/DATABASE.md](./docs/DATABASE.md) | SQLite schema reference |
| [documents/Azure/INFRASTRUCTURE.md](./documents/Azure/INFRASTRUCTURE.md) | Azure VM, deployment, systemd service |
| [documents/OpenClaw/API-GUIDE.md](./documents/OpenClaw/API-GUIDE.md) | API reference for OpenClaw/Mina bot |

---

## Quick Start (Local Dev)

```bash
git clone https://github.com/Arkforge-Games/Accounting-Gdrive-Email.git
cd Accounting-Gdrive-Email
npm install
cp .env.local.example .env.local  # then edit credentials
npm run dev -- -p 8325
```

Open http://localhost:8325

## Production Deployment

```bash
ssh azureuser@74.226.88.89
cd /opt/accounting-sync
sudo git pull origin master
sudo npm install
sudo npm run build
sudo systemctl restart accounting-sync
```

---

## Automation Schedule

| When | What |
|------|------|
| **Hourly** (top of every hour) | Pipeline retry — processes failed/unrecorded files |
| **Daily 6PM PHT** (10:00 UTC) | Full sync (Gmail + GDrive + Xero + Wise) → AI categorize → record to Sheets + Xero → enrich |

Cron jobs configured at `/opt/accounting-sync/daily-sync.sh` and `hourly-retry.sh`.

---

## License

Private — HobbyLand Technology Limited
