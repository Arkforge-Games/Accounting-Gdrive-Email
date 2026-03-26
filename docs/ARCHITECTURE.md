# Architecture Documentation

## Overview

AccountSync is a full-stack Next.js application that serves as a centralized accounting file manager. It connects to Gmail (via IMAP) and Google Drive (via OAuth2) to pull in all emails, attachments, and documents into a local SQLite database.

## System Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Browser (Client)                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│  │ Dashboard │ │  Emails  │ │  Files   │ │  Settings  │  │
│  └─────┬────┘ └─────┬────┘ └─────┬────┘ └──────┬─────┘  │
└────────┼────────────┼────────────┼──────────────┼────────┘
         │            │            │              │
         ▼            ▼            ▼              ▼
┌──────────────────────────────────────────────────────────┐
│                   Next.js API Routes                      │
│  /api/sync    /api/emails    /api/files    /api/search   │
└────────┬────────────┬────────────┬──────────────┬────────┘
         │            │            │              │
         ▼            ▼            ▼              ▼
┌──────────────────────────────────────────────────────────┐
│                    Data Layer (lib/)                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐  │
│  │  imap.ts  │ │ google.ts│ │  db.ts   │ │  types.ts  │  │
│  └─────┬────┘ └─────┬────┘ └─────┬────┘ └────────────┘  │
└────────┼────────────┼────────────┼───────────────────────┘
         │            │            │
         ▼            ▼            ▼
┌────────────┐ ┌────────────┐ ┌──────────────────┐
│   Gmail    │ │  Google    │ │  SQLite Database  │
│   IMAP     │ │  Drive API │ │  (accounting.db)  │
└────────────┘ └────────────┘ └──────────────────┘
```

## Data Flow

### Email Sync Flow

```
1. User clicks "Sync Email" or POST /api/sync?source=email
2. sync/route.ts calls syncEmail()
3. imap.ts connects to imap.gmail.com:993 with App Password
4. Fetches ALL messages from INBOX (seq 1:*)
5. For each message:
   a. simpleParser parses raw source into structured data
   b. db.upsertEmail() stores full email (subject, from, to, cc, bcc,
      body text, body HTML, headers, raw source, message ID)
   c. For each attachment:
      - db.upsertFiles() stores metadata + file content as BLOB
      - Links to email via email_id foreign key
6. db.setConnection() updates gmail connection status
7. db.addActivity() logs the sync action
8. Returns JSON with { filesAdded, filesUpdated, errors }
```

### File Download Flow

```
1. User clicks Download on a file
2. GET /api/files/{id}/download
3. db.getFileContent() reads BLOB from SQLite
4. Returns binary response with proper Content-Type and Content-Disposition
```

### Download All Flow

```
1. GET /api/files/download-all
2. Fetches all files from DB
3. archiver creates a streaming ZIP
4. Each file BLOB is added to the archive
5. Streams ZIP to client as chunked transfer
```

## Database Design

### Entity Relationship

```
┌─────────────┐       ┌─────────────┐
│   emails     │       │    files     │
│─────────────│       │─────────────│
│ id (PK)     │◄──────│ email_id(FK)│
│ uid         │       │ id (PK)     │
│ message_id  │       │ name        │
│ subject     │       │ mime_type   │
│ from_address│       │ source      │
│ from_name   │       │ content     │
│ to_addresses│       │ starred     │
│ cc_addresses│       │ size_bytes  │
│ body_text   │       │ has_content │
│ body_html   │       └─────────────┘
│ headers     │
│ raw_source  │       ┌─────────────┐
│ date        │       │  activity   │
└─────────────┘       │─────────────│
                      │ id (PK)     │
┌─────────────┐       │ action      │
│ connections  │       │ source      │
│─────────────│       │ details     │
│ source (PK) │       │ timestamp   │
│ connected   │       └─────────────┘
│ email       │
│ last_sync   │
│ file_count  │
└─────────────┘
```

### Storage Strategy

- **Email bodies:** Stored as TEXT (body_text, body_html) for searchability
- **Attachments:** Stored as BLOB in files.content column
- **Raw email source:** Stored as BLOB in emails.raw_source for full fidelity
- **SQLite WAL mode:** Enabled for better concurrent read performance
- **Indexes:** On date, source, starred, name, from_address, subject for fast queries

## Component Architecture

### Layout Hierarchy

```
RootLayout (app/layout.tsx)
├── Landing Page (app/page.tsx)
├── Login Page (app/login/page.tsx)
└── DashboardLayout (app/dashboard/layout.tsx)
    ├── Sidebar (components/Sidebar.tsx)
    └── Page Content
        ├── Overview (dashboard/page.tsx)
        │   ├── StatCard x4
        │   ├── Quick Actions
        │   └── FileTable (recent)
        ├── Emails (dashboard/emails/page.tsx)
        │   ├── Email List (left panel)
        │   └── Email Detail (right panel)
        ├── Files (dashboard/files/page.tsx)
        │   ├── Filter bar
        │   └── FileTable
        ├── Starred (dashboard/starred/page.tsx)
        ├── Search (dashboard/search/page.tsx)
        ├── Activity (dashboard/activity/page.tsx)
        └── Settings (dashboard/settings/page.tsx)
            ├── ConnectionCard x3
            ├── Sync Preferences
            └── Danger Zone
```

### Shared Components

| Component | Purpose | Used In |
|-----------|---------|---------|
| `Sidebar` | Navigation with sync button | All dashboard pages |
| `TopBar` | Page title + global search | All dashboard pages |
| `FileTable` | Sortable, selectable file list | Overview, Files, Starred, Search |
| `FilePreviewModal` | File detail overlay | FileTable |
| `StatCard` | Metric display card | Overview |
| `ConnectionCard` | Account connection status | Settings |

## Security Considerations

- **Credentials:** Stored only in `.env.local` on the server, never in git
- **Gmail:** Uses App Password (not regular password) for IMAP access
- **Email rendering:** HTML emails rendered in sandboxed iframe
- **Database:** SQLite file in `data/` directory, gitignored
- **No authentication on the web app itself** — relies on network-level access control (firewall/NSG)

## Deployment

### Infrastructure

```
Azure VM: General-Agent (74.226.88.89)
├── OS: Ubuntu 22.04
├── Runtime: Node.js 22
├── Process: systemd (accounting-sync.service)
├── Reverse proxy: nginx
├── Firewall: UFW (port 8325 open)
├── Azure NSG: port 8325 open
└── Database: /opt/accounting-sync/data/accounting.db
```

### Deploy Process

```bash
# Local: edit, build, commit, push
npm run build
git add -A && git commit -m "message" && git push

# VM: pull, build, restart
cd /opt/accounting-sync
git pull origin master
npm install    # only if dependencies changed
npm run build
systemctl restart accounting-sync
```

### systemd Service

```ini
[Unit]
Description=AccountSync Next.js App
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/accounting-sync
ExecStart=/usr/bin/node node_modules/.bin/next start -p 8325
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=8325

[Install]
WantedBy=multi-user.target
```
