# AccountSync — Azure Infrastructure & Deployment Guide

Complete reference for the AccountSync (Accounting-Gdrive-Email) application: where it runs, how it's deployed, how traffic reaches it, and how all the pieces connect.

---

## 1. Architecture Overview

```
                    Internet
                       │
                       ▼
            ┌─────────────────────┐
            │  accounting.devehub.app  │  (DNS → Alibaba Cloud Nginx)
            │    8.210.219.100    │
            └─────────┬──────────┘
                      │ HTTPS (443)
                      │ Reverse proxy
                      ▼
            ┌─────────────────────┐
            │  Azure VM: General-Agent  │
            │    74.226.88.89     │
            │    Port 8325        │
            └─────────┬──────────┘
                      │
                      ▼
            ┌─────────────────────┐
            │  Next.js 15 App     │
            │  (systemd service)  │
            │  SQLite database    │
            └─────────┬──────────┘
                      │
              ┌───────┴───────┐
              ▼               ▼
        ┌──────────┐   ┌──────────────┐
        │  Gmail   │   │ Google Drive  │
        │  IMAP    │   │  OAuth2 API   │
        └──────────┘   └──────────────┘
```

---

## 2. Server Details

### Azure VM

| Property | Value |
|----------|-------|
| **VM Name** | General-Agent |
| **Resource Group** | GENERAL-DEV-RG |
| **VM Size** | Standard_B2s_v2 |
| **OS** | Ubuntu 22.04 LTS |
| **Public IP** | 74.226.88.89 |
| **Private IP** | 10.0.0.5 |
| **SSH User** | azureuser |
| **Node.js** | v22.x |

### DNS & Domain

| Property | Value |
|----------|-------|
| **Production URL** | https://accounting.devehub.app |
| **Direct URL** | http://74.226.88.89:8325 |
| **Domain** | devehub.app (hosted on Alibaba Cloud server 8.210.219.100) |
| **SSL** | Let's Encrypt (Certbot), auto-renew |
| **Proxy** | Alibaba Nginx → Azure VM port 8325 |

### How DNS/Proxy Works

1. `accounting.devehub.app` DNS resolves to **8.210.219.100** (Alibaba Cloud server)
2. Nginx on Alibaba server has a `server_name accounting.devehub.app` block
3. Nginx terminates SSL (Let's Encrypt cert) and proxies to **74.226.88.89:8325** (Azure VM)
4. The Azure VM runs the Next.js app on port 8325

---

## 3. Application Location on Server

```
/opt/accounting-sync/              ← App root on the Azure VM
├── .env.local                     ← Production credentials (not in git)
├── .next/                         ← Next.js build output
├── data/
│   └── accounting.db              ← SQLite database (all emails + files)
├── node_modules/
├── package.json
├── src/                           ← Source code
│   ├── app/
│   │   ├── api/                   ← 17 API route handlers
│   │   ├── dashboard/             ← 7 dashboard pages
│   │   ├── login/
│   │   ├── page.tsx               ← Landing page
│   │   └── layout.tsx
│   ├── components/                ← Reusable UI components
│   └── lib/                       ← Core logic (db, imap, google, types)
└── public/
```

---

## 4. Networking & Firewall

### Azure NSG Rules (General-AgentNSG)

| Priority | Port | Protocol | Name | Purpose |
|----------|------|----------|------|---------|
| default | 22 | TCP | default-allow-ssh | SSH access |
| 1030 | 6080 | TCP | allow-cc-switch | CC-Switch noVNC |
| 1031 | 6081 | TCP | allow-cc-switch-api | CC-Switch REST API |
| 1032 | 3001 | TCP | allow-openhands | OpenHands Web |
| — | 8325 | TCP | — | AccountSync app |
| — | 18789 | TCP | open-port-18789 | OpenClaw |

### UFW (VM Firewall)

Port 8325 is open in UFW to allow inbound traffic from the Alibaba proxy and direct access.

---

## 5. Systemd Service

**Service file:** `/etc/systemd/system/accounting-sync.service`

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

### Service Commands

```bash
# Check status
sudo systemctl status accounting-sync

# Restart
sudo systemctl restart accounting-sync

# View logs
sudo journalctl -u accounting-sync -f

# Stop / Start
sudo systemctl stop accounting-sync
sudo systemctl start accounting-sync
```

---

## 6. Environment Variables (Production)

Located at `/opt/accounting-sync/.env.local` on the VM:

| Variable | Purpose | Value |
|----------|---------|-------|
| `IMAP_HOST` | Gmail IMAP server | `imap.gmail.com` |
| `IMAP_PORT` | IMAP port (SSL) | `993` |
| `IMAP_USER` | Gmail account | `invoicehobbyland@gmail.com` |
| `IMAP_PASSWORD` | Gmail App Password | *(16-char app password)* |
| `GOOGLE_CLIENT_ID` | Google Drive OAuth | *(OAuth client ID)* |
| `GOOGLE_CLIENT_SECRET` | Google Drive OAuth | *(OAuth client secret)* |
| `GOOGLE_REDIRECT_URI` | OAuth callback | `https://accounting.devehub.app/api/auth/google/callback` |
| `NEXTAUTH_URL` | App base URL | `https://accounting.devehub.app` |
| `NEXTAUTH_SECRET` | Session signing key | *(random base64 string)* |

---

## 7. Deployment Process

### From Local Machine to Production

```bash
# 1. Local: make changes, test, commit, push
cd workflows/Accounting-Gdrive-Email
npm run build          # verify build works locally
git add -A
git commit -m "your changes"
git push origin master

# 2. SSH into Azure VM
ssh azureuser@74.226.88.89

# 3. On VM: pull, install, build, restart
cd /opt/accounting-sync
git pull origin master
npm install              # only if dependencies changed
npm run build
sudo systemctl restart accounting-sync

# 4. Verify
sudo systemctl status accounting-sync
curl http://localhost:8325   # quick health check
```

### Quick Deploy (one-liner from VM)

```bash
cd /opt/accounting-sync && git pull origin master && npm install && npm run build && sudo systemctl restart accounting-sync
```

---

## 8. Database

| Property | Value |
|----------|-------|
| **Engine** | SQLite 3 (via better-sqlite3) |
| **File** | `/opt/accounting-sync/data/accounting.db` |
| **WAL mode** | Enabled (better concurrency) |
| **Backup** | Copy the `.db` file (single file = easy backup) |

### Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `emails` | Full email data from IMAP sync | id, uid, subject, from_address, body_text, body_html, raw_source |
| `files` | Attachments + Drive files (BLOBs) | id, email_id (FK), name, mime_type, content, source |
| `activity` | Audit log of all actions | action, source, details, timestamp |
| `connections` | Connected account status | source, connected, email, last_sync, file_count |

---

## 9. External Service Connections

### Gmail (IMAP)

| Property | Value |
|----------|-------|
| **Protocol** | IMAP over SSL |
| **Server** | imap.gmail.com:993 |
| **Account** | invoicehobbyland@gmail.com |
| **Auth** | Google App Password (not regular password) |
| **How to get App Password** | Google Account → Security → 2-Step Verification → App Passwords → Create for "Mail" |

### Google Drive (OAuth2)

| Property | Value |
|----------|-------|
| **API** | Google Drive API v3 |
| **Auth** | OAuth2 (server-side redirect flow) |
| **Google Cloud Project** | Project ID linked to client ID `346389519950-*` |
| **Redirect URI** | `https://accounting.devehub.app/api/auth/google/callback` |
| **Scopes** | Google Drive read access |

---

## 10. Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| **Framework** | Next.js 15 (App Router) |
| **Language** | TypeScript |
| **Styling** | Tailwind CSS v4 |
| **Database** | SQLite (better-sqlite3) |
| **Email** | IMAP (imapflow + mailparser) |
| **Google Drive** | googleapis + google-auth-library |
| **File Compression** | archiver (ZIP downloads) |
| **Runtime** | Node.js 22 |
| **Process Manager** | systemd |
| **Hosting** | Azure VM (Standard_B2s_v2) |
| **Domain/SSL** | devehub.app via Alibaba Cloud Nginx + Let's Encrypt |

---

## 11. API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/sync` | Sync all sources (email + drive) |
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
| `GET` | `/api/auth/google` | Start Google OAuth flow |
| `GET` | `/api/auth/google/callback` | Google OAuth callback |
| `GET` | `/api/auth/microsoft` | Start Microsoft OAuth flow |
| `GET` | `/api/auth/microsoft/callback` | Microsoft OAuth callback |

---

## 12. Other Services on the Same VM

The General-Agent VM (74.226.88.89) also hosts:

| Service | Port | Purpose |
|---------|------|---------|
| **OpenClaw** | 6080 (Caddy proxy), 18789 (API) | AI agent platform |
| **OpenHands** | 3001 (nginx proxy) | AI coding assistant |
| **CC-Switch** | 6080 (noVNC), 6081 (REST API) | API provider management |

These services are independent but share the same VM resources.

---

## 13. Troubleshooting

### App not loading
```bash
# Check if service is running
sudo systemctl status accounting-sync

# Check logs for errors
sudo journalctl -u accounting-sync --since "10 min ago"

# Check if port is listening
ss -tlnp | grep 8325
```

### Database issues
```bash
# Check database size
ls -lh /opt/accounting-sync/data/accounting.db

# Quick integrity check
sqlite3 /opt/accounting-sync/data/accounting.db "PRAGMA integrity_check;"
```

### Can't reach via domain (accounting.devehub.app)
1. Check Alibaba Nginx is running: SSH to 8.210.219.100, check `nginx -t && systemctl status nginx`
2. Check SSL cert hasn't expired: `certbot certificates` on Alibaba server
3. Check Azure NSG allows traffic on port 8325
4. Check UFW on VM: `sudo ufw status`

### Email sync not working
- Verify App Password is valid (Google may revoke if suspicious activity detected)
- Check IMAP is enabled in Gmail settings
- Test manually: `openssl s_client -connect imap.gmail.com:993`

---

## 14. Git Repository

| Property | Value |
|----------|-------|
| **Remote** | https://github.com/Arkforge-Games/Accounting-Gdrive-Email.git |
| **Branch** | master |
| **Note** | This repo has its own `.git` — it is NOT part of the parent n8nProject01 repo |
