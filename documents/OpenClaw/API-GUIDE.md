# AccountSync API — OpenClaw Integration Guide

This document describes how to connect OpenClaw (or any external agent) to the AccountSync accounting application.

---

## Connection Details

| Property | Value |
|----------|-------|
| **Base URL** | `https://accounting.devehub.app` |
| **API Endpoint** | `https://accounting.devehub.app/api/open` |
| **Auth Method** | API Key (header or query param) |
| **API Key** | `dabad6bac618e166401b28bdd40c40606c58f57839c079a661440b59d044746f` |
| **Response Format** | JSON |

---

## Authentication

Every request must include the API key. Two methods:

### Option 1: Header (recommended)
```
x-api-key: dabad6bac618e166401b28bdd40c40606c58f57839c079a661440b59d044746f
```

### Option 2: Query parameter
```
?key=dabad6bac618e166401b28bdd40c40606c58f57839c079a661440b59d044746f
```

Without a valid key, the API returns `401 Unauthorized`.

---

## What This App Does

AccountSync is an accounting file management system that:
- Syncs all emails from `invoicehobbyland@gmail.com` via IMAP (full body, headers, attachments)
- Syncs files from Google Drive
- Stores everything in a local SQLite database
- Provides search across all emails and files

The data includes invoices, receipts, payment confirmations, reimbursement requests, and other accounting documents for Hobbyland Group.

---

## API Endpoints

All endpoints use `GET` method. The `action` parameter determines what data is returned.

### 1. Overview (default)
```
GET /api/open?key=<API_KEY>
GET /api/open?key=<API_KEY>&action=overview
```
Returns stats, connection statuses, and recent activity. Good for a quick health check.

**Response:**
```json
{
  "stats": {
    "totalFiles": 198,
    "totalSize": "32.3 MB",
    "gdriveFiles": 0,
    "gmailFiles": 198,
    "starredFiles": 0,
    "emailCount": 273,
    "recentFiles": [...]
  },
  "connections": {
    "gdrive": { "connected": false },
    "gmail": { "connected": true, "lastSync": "2026-03-28T..." }
  },
  "recentActivity": [...]
}
```

---

### 2. Stats
```
GET /api/open?key=<API_KEY>&action=stats
```
Returns file and email counts, total size, breakdown by source.

---

### 3. List Emails
```
GET /api/open?key=<API_KEY>&action=emails
GET /api/open?key=<API_KEY>&action=emails&limit=20
```
Returns a list of emails (most recent first). Default limit is 50.

**Email fields:** `id`, `subject`, `from_address`, `from_name`, `to_addresses`, `date`, `body_text`, `has_attachments`, `attachment_count`

---

### 4. Search Emails
```
GET /api/open?key=<API_KEY>&action=emails&q=invoice
GET /api/open?key=<API_KEY>&action=emails&q=Andrea+reimbursement
```
Searches email subject, sender, recipients, and body text.

---

### 5. Get Single Email (full body)
```
GET /api/open?key=<API_KEY>&action=email&id=email_274
```
Returns a single email with full HTML body, headers, and all metadata.

---

### 6. List Files
```
GET /api/open?key=<API_KEY>&action=files
GET /api/open?key=<API_KEY>&action=files&source=gdrive
GET /api/open?key=<API_KEY>&action=files&source=email-gmail
```
Returns all files (attachments + Drive files). Filter by `source`:
- `gdrive` — Google Drive files
- `email-gmail` — Gmail attachments

**File fields:** `id`, `name`, `mimeType`, `source`, `date`, `size`, `sizeBytes`, `downloadUrl`, `starred`, `emailSubject`, `emailFrom`

---

### 7. Search Files + Emails
```
GET /api/open?key=<API_KEY>&action=search&q=receipt
GET /api/open?key=<API_KEY>&action=search&q=WebWork&source=email-gmail
```
Searches across both files and emails simultaneously. Returns:
```json
{
  "files": [...],
  "emails": [...],
  "filesCount": 5,
  "emailsCount": 12,
  "query": "receipt"
}
```

---

### 8. Activity Log
```
GET /api/open?key=<API_KEY>&action=activity
GET /api/open?key=<API_KEY>&action=activity&limit=10
```
Returns recent sync, download, and file actions.

---

### 9. Connection Statuses
```
GET /api/open?key=<API_KEY>&action=connections
```
Returns which services are connected and when they last synced.

---

## Example: curl Commands

```bash
# Overview
curl -H "x-api-key: dabad6bac618e166401b28bdd40c40606c58f57839c079a661440b59d044746f" \
  "https://accounting.devehub.app/api/open"

# Search for invoices
curl -H "x-api-key: dabad6bac618e166401b28bdd40c40606c58f57839c079a661440b59d044746f" \
  "https://accounting.devehub.app/api/open?action=search&q=invoice"

# List recent 10 emails
curl -H "x-api-key: dabad6bac618e166401b28bdd40c40606c58f57839c079a661440b59d044746f" \
  "https://accounting.devehub.app/api/open?action=emails&limit=10"

# Get all Gmail attachments
curl -H "x-api-key: dabad6bac618e166401b28bdd40c40606c58f57839c079a661440b59d044746f" \
  "https://accounting.devehub.app/api/open?action=files&source=email-gmail"
```

---

## OpenClaw Tool Configuration

To add this as a tool/skill in OpenClaw, configure an HTTP fetch tool with:

```json
{
  "name": "accounting_lookup",
  "description": "Search and retrieve accounting emails, invoices, receipts, and files from the Hobbyland accounting system (invoicehobbyland@gmail.com). Use this to answer questions about payments, reimbursements, receipts, invoices, and financial documents.",
  "endpoint": "https://accounting.devehub.app/api/open",
  "method": "GET",
  "headers": {
    "x-api-key": "dabad6bac618e166401b28bdd40c40606c58f57839c079a661440b59d044746f"
  },
  "parameters": {
    "action": "search",
    "q": "<search term>"
  }
}
```

### Suggested prompts for the agent:
- "Search accounting for [term]" → `action=search&q=term`
- "Show recent emails" → `action=emails&limit=10`
- "How many files do we have?" → `action=stats`
- "Find Andrea's reimbursement" → `action=search&q=Andrea+reimbursement`
- "Show accounting activity" → `action=activity`

---

## Security Notes

- The API key grants **read-only** access — no writes, deletes, or syncs
- The key does not grant access to the web dashboard (that requires username/password login)
- Rotate the key by changing `API_KEY` in `/opt/accounting-sync/.env.local` on the Azure VM and restarting the service
- The API does not expose raw file content (BLOBs) — only metadata and email text bodies

---

## Infrastructure Reference

| Component | Details |
|-----------|---------|
| **App** | AccountSync (Next.js 15, TypeScript) |
| **Server** | Azure VM `General-Agent` (74.226.88.89) |
| **Domain** | accounting.devehub.app (SSL via Alibaba Cloud Nginx) |
| **Port** | 8325 |
| **Service** | systemd `accounting-sync` |
| **Database** | SQLite at `/opt/accounting-sync/data/accounting.db` |
| **Email Account** | invoicehobbyland@gmail.com |
| **Repo** | github.com/Arkforge-Games/Accounting-Gdrive-Email |
