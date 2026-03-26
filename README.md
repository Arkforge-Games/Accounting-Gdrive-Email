# AccountSync - Accounting GDrive & Email

A Next.js web application that syncs and manages accounting files from Google Drive and Gmail. All emails and attachments are downloaded and stored in a local SQLite database for offline access, search, and organization.

**Live:** http://74.226.88.89:8325

## Features

- **Email Sync (IMAP)** — Connects to Gmail via IMAP, downloads all emails with full body (text + HTML), headers, metadata, and attachments
- **Google Drive Sync** — Pulls files from Google Drive via OAuth2 (requires API credentials)
- **SQLite Storage** — All data persisted in `data/accounting.db` — survives restarts
- **File Downloads** — Attachments stored as BLOBs, downloadable individually or as a ZIP
- **Email Viewer** — Full email client with sender avatars, HTML rendering, search
- **Search** — Full-text search across files, emails, senders, subjects
- **Star/Bookmark** — Mark important files for quick access
- **Activity Log** — Tracks all sync, download, star, and delete actions
- **Filters** — Filter by source (Drive/Gmail), file type (PDF, spreadsheet, image, document), date range

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Database | SQLite (better-sqlite3) |
| Email | IMAP (imapflow + mailparser) |
| Google Drive | googleapis + google-auth-library |
| File Compression | archiver |
| Runtime | Node.js 22 |

## Pages

| Route | Description |
|-------|-------------|
| `/` | Landing page |
| `/login` | Sign in with Google/Microsoft |
| `/dashboard` | Overview — stats, quick actions, recent files |
| `/dashboard/emails` | Email list with detail view, search, HTML rendering |
| `/dashboard/files` | All attachments — sort, filter, bulk select, download |
| `/dashboard/starred` | Bookmarked files |
| `/dashboard/search` | Full-text search with date and source filters |
| `/dashboard/activity` | Sync and file activity log |
| `/dashboard/settings` | Account connections, sync preferences |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/sync` | Sync all sources |
| `POST` | `/api/sync?source=email` | Sync Gmail only |
| `POST` | `/api/sync?source=gdrive` | Sync Google Drive only |
| `GET` | `/api/files` | List all files |
| `GET` | `/api/files?starred=true` | List starred files |
| `GET` | `/api/files/stats` | File and sync statistics |
| `GET` | `/api/files/[id]` | Get single file metadata |
| `GET` | `/api/files/[id]/download` | Download file content |
| `GET` | `/api/files/download-all` | Download all files as ZIP |
| `POST` | `/api/files/star` | Toggle star on a file |
| `DELETE` | `/api/files/[id]` | Delete a file |
| `GET` | `/api/files/activity` | Activity log |
| `GET` | `/api/files/connections` | Connection statuses |
| `GET` | `/api/emails` | List all emails |
| `GET` | `/api/emails?q=search` | Search emails |
| `GET` | `/api/emails/[id]` | Get full email with body |
| `GET` | `/api/search?q=term` | Search files |

## Database Schema

### `emails` table
Stores complete email data from IMAP sync.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | `email_{uid}` |
| uid | INTEGER | IMAP UID |
| message_id | TEXT | RFC Message-ID |
| subject | TEXT | Email subject |
| from_address | TEXT | Sender email |
| from_name | TEXT | Sender display name |
| to_addresses | TEXT | Recipients |
| cc_addresses | TEXT | CC recipients |
| bcc_addresses | TEXT | BCC recipients |
| reply_to | TEXT | Reply-to address |
| date | TEXT | ISO date |
| body_text | TEXT | Plain text body |
| body_html | TEXT | HTML body |
| headers | TEXT | JSON of all headers |
| labels | TEXT | Gmail labels |
| has_attachments | INTEGER | 0 or 1 |
| attachment_count | INTEGER | Number of attachments |
| raw_source | BLOB | Full raw email source |

### `files` table
Stores file metadata and content (attachments + Drive files).

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | `email_{uid}_{checksum}` or `gdrive_{id}` |
| email_id | TEXT FK | Links to emails table |
| name | TEXT | Filename |
| mime_type | TEXT | MIME type |
| source | TEXT | `email-gmail`, `gdrive` |
| date | TEXT | ISO date |
| size | TEXT | Human-readable size |
| size_bytes | INTEGER | Size in bytes |
| starred | INTEGER | 0 or 1 |
| email_subject | TEXT | Parent email subject |
| email_from | TEXT | Parent email sender |
| has_content | INTEGER | 0 or 1 |
| content | BLOB | Actual file bytes |

### `activity` table
Audit log of all user and sync actions.

### `connections` table
Tracks connected account status and last sync time.

## Setup

### Prerequisites
- Node.js 22+
- npm

### Local Development

```bash
# Clone
git clone https://github.com/Arkforge-Games/Accounting-Gdrive-Email.git
cd Accounting-Gdrive-Email

# Install
npm install

# Configure
cp .env.local.example .env.local
# Edit .env.local with your credentials

# Run
npm run dev -- -p 8325
```

### Environment Variables

```env
# IMAP Email (Gmail)
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=your-email@gmail.com
IMAP_PASSWORD=your-app-password    # Google App Password (not regular password)

# Google Drive API (optional)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:8325/api/auth/google/callback

# App
NEXTAUTH_URL=http://localhost:8325
NEXTAUTH_SECRET=random-secret-string
```

> **Gmail App Password:** Go to Google Account > Security > 2-Step Verification > App Passwords. Create one for "Mail". Use the 16-character code as `IMAP_PASSWORD`.

### Production Deployment (VM)

The app runs on Azure VM `General-Agent` (74.226.88.89):

```bash
# SSH into VM or use az vm run-command
cd /opt/accounting-sync
git pull origin master
npm install
npm run build
sudo systemctl restart accounting-sync
```

**systemd service:** `/etc/systemd/system/accounting-sync.service`
**Port:** 8325 (UFW + Azure NSG open)
**Nginx:** Reverse proxy configured
**Database:** `/opt/accounting-sync/data/accounting.db`

## Project Structure

```
├── src/
│   ├── app/
│   │   ├── api/            # 17 API route handlers
│   │   ├── dashboard/      # 7 dashboard pages
│   │   ├── login/          # Login page
│   │   ├── page.tsx        # Landing page
│   │   ├── layout.tsx      # Root layout
│   │   └── globals.css     # Tailwind imports
│   ├── components/
│   │   ├── icons/          # SVG icon components
│   │   ├── ConnectionCard  # Account connection card
│   │   ├── FilePreviewModal# File preview overlay
│   │   ├── FileTable       # Sortable file table with actions
│   │   ├── Sidebar         # Navigation sidebar
│   │   ├── StatCard        # Dashboard stat card
│   │   └── TopBar          # Page header with search
│   └── lib/
│       ├── cn.ts           # Tailwind class constants
│       ├── db.ts           # SQLite database layer
│       ├── google.ts       # Google OAuth client
│       ├── imap.ts         # IMAP email fetcher
│       ├── microsoft.ts    # Microsoft MSAL client
│       ├── store.ts        # Legacy in-memory store
│       └── types.ts        # TypeScript interfaces
├── data/                   # SQLite database (gitignored)
├── .env.local              # Credentials (gitignored)
├── package.json
├── tsconfig.json
├── next.config.ts
└── postcss.config.mjs
```

## License

Private — Hobbyland Group
