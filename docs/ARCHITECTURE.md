# Architecture

This document describes the high-level architecture of the HobbyLand Accounting application: a Next.js dashboard that ingests financial documents from multiple sources, classifies them with rules + AI, and writes the results to Google Sheets and Xero.

---

## High-Level System Architecture

```
┌──────────────┐      ┌──────────────────┐      ┌──────────────┐      ┌──────────────────┐
│  End Users   │─────▶│  DNS             │─────▶│  Alibaba     │─────▶│  Azure VM        │
│  (browsers)  │      │  accounting.     │      │  Cloud Proxy │      │  (Next.js app)   │
└──────────────┘      │  devehub.app     │      │  (HK region) │      │                  │
                      └──────────────────┘      └──────────────┘      └────────┬─────────┘
                                                                                │
                                                                                ▼
                                                                       ┌──────────────────┐
                                                                       │ SQLite (WAL)     │
                                                                       │ data/            │
                                                                       │ accounting.db    │
                                                                       └──────────────────┘
                                                                                │
                                            ┌───────────────────┬───────────────┼───────────────┬───────────────┐
                                            ▼                   ▼               ▼               ▼               ▼
                                       ┌─────────┐         ┌─────────┐    ┌─────────┐     ┌─────────┐     ┌─────────┐
                                       │  Gmail  │         │ GDrive  │    │  Xero   │     │  Wise   │     │  Sheets │
                                       │  IMAP   │         │  API    │    │  API    │     │  API    │     │  API    │
                                       └─────────┘         └─────────┘    └─────────┘     └─────────┘     └─────────┘
```

### Request flow

1. A user browser requests `https://accounting.devehub.app`.
2. DNS resolves to an Alibaba Cloud proxy (Hong Kong region).
3. The proxy terminates TLS and forwards the request to an Azure VM running the Next.js application.
4. Next.js handles the request, reading/writing to a local SQLite database and contacting external APIs as needed.

### Why Alibaba proxy in front of Azure VM?

- The Azure VM lives outside Hong Kong / mainland routes, so direct connections are slow and unreliable for users in Asia.
- Routing through the Alibaba HK proxy gives users in HK / mainland China low-latency access while keeping the application + data hosted on Azure.
- The proxy also acts as a stable public entry point so the Azure VM IP can change without DNS updates.
- It provides an extra layer of TLS termination and request shaping in front of the Next.js process.

---

## Data Sources

The application integrates **5 external data sources**. All ingest paths converge into the same SQLite database via `src/lib/db.ts`.

| # | Source        | Module                            | Type        | Purpose                                                                                  |
|---|---------------|-----------------------------------|-------------|------------------------------------------------------------------------------------------|
| 1 | Gmail (IMAP)  | `src/lib/imap.ts`                 | Pull        | Downloads emails and their attachments. Stored in `emails` and `files` tables.           |
| 2 | Google Drive  | `src/lib/google.ts` + `/api/sync` | OAuth pull  | Walks My Drive + "Shared with me", downloads file content into `files`.                  |
| 3 | Xero          | `src/lib/xero.ts`                 | OAuth API   | Pulls invoices/bills for cross-reference; pushes new DRAFT bills/invoices.               |
| 4 | Wise          | `src/lib/wise.ts`                 | API key     | Pulls transfer history into `wise_cache` for reconciliation.                             |
| 5 | Google Sheets | `src/lib/sheets.ts`               | OAuth API   | Reads existing payable/receivable rows for duplicate checks; appends new rows.           |

The unified sync entry point is `POST /api/sync?source=<gdrive|email|xero|wise>` (see `src/app/api/sync/route.ts`). Calling without a `source` parameter syncs all sources sequentially.

### Gmail (IMAP)

- Fetches messages and attachments via `fetchEmailAttachments()`.
- Stores full message metadata + body in the `emails` table; saves each attachment to the `files` table with an `email_id` foreign key, so the pipeline can later read the original email body for amount extraction.

### Google Drive

- Authenticates via Google OAuth, tokens persisted in `google_tokens`.
- `listAllFiles()` recursively walks "My Drive" + "Shared with me", paginating 100 files at a time.
- Google Workspace docs (Docs/Sheets/Slides) are exported to PDF/XLSX/PPTX using `EXPORT_MIMES`. Folders/forms/maps/sites/shortcuts are skipped.
- Each file is downloaded and saved to the DB **immediately** (not batched) to avoid OOM on large drives.
- A specific folder can be configured via the `gdrive_folder` setting; otherwise the whole drive is scanned.

### Xero

- OAuth2 connection, tokens in `xero_tokens`.
- `syncXeroData()` pulls invoices and bills for analytics + cross-referencing.
- The pipeline pushes new bills/invoices as **DRAFT** so the human accountant always has a final review step.

### Wise

- API-key authentication (`isWiseConfigured()`).
- `syncWiseData()` pulls transfer history into `wise_cache` for reconciliation against payables.

### Google Sheets

- Uses the same Google OAuth tokens as GDrive.
- `getPayables()` / `getReceivables()` are called by the pipeline at the start of each run to load all existing rows for duplicate detection.
- `appendPayableRow()` / `appendReceivableRow()` write new rows. Writes are throttled to ~1 every 1.2s to stay under the Sheets API 60 writes/minute quota.

---

## Authentication

Authentication is enforced by `src/middleware.ts` which runs on every matching request.

- **Matcher**: `/dashboard/:path*` and `/api/:path*`.
- **Public routes** (no session required): `/`, `/login`, `/api/auth/*`, `/api/open*`, `/api/chat`, `/api/analytics`, `/api/alerts`, `/api/sheets/*`, `/api/wise/*`, `/api/xero/*`, `/api/reports/*`, `/api/crossref`, `/api/pipeline`, `/api/files/<id>/download`, plus Next.js internals.
- These public API routes are intentionally open because the dashboard's client-side code calls them directly without going through a session-bearing fetch wrapper, and because external cron / receipt-link traffic must hit them without a cookie.
- **Session format**: a cookie named `session` containing `<base64 payload>.<HMAC-SHA256 hex>`. The HMAC is computed with `NEXTAUTH_SECRET` using the WebCrypto subtle API (works in the Edge runtime).
- **Internal traffic exemption**: requests from `localhost`, `127.0.0.1`, or `10.0.0.*` hosts bypass auth so server-to-server pings (e.g. cron from inside the VM) work without a session.
- Unauthorized API requests get `401 JSON`; unauthorized page requests get a redirect to `/login`.

---

## Database

- Engine: **SQLite** via `better-sqlite3`.
- File: `data/accounting.db` (relative to `process.cwd()`); the directory is auto-created on first boot.
- **WAL mode** (`journal_mode = WAL`) is enabled so reads do not block writes — important because the dashboard reads heavily while the pipeline writes during sync runs.
- `foreign_keys = ON` for referential integrity.
- Schema is defined and migrated in `initSchema()` using `CREATE TABLE IF NOT EXISTS` plus a few defensive `ALTER TABLE` calls for additive columns.

### Tables (summary)

| Table                | Purpose                                                                       |
|----------------------|-------------------------------------------------------------------------------|
| `emails`             | Full Gmail messages with body + raw source, used as source for amount extraction. |
| `files`              | Every ingested document (Gmail attachments + GDrive files), with binary content. |
| `file_index`         | Per-file accounting metadata: category, vendor, amount, sheet type, review flags. |
| `activity`           | Human-readable log of sync/pipeline activity for the dashboard activity feed.    |
| `connections`        | Per-source connection state: connected flag, last sync, file count.              |
| `settings`           | Generic key/value store (e.g. `gdrive_folder`).                                  |
| `google_tokens`      | Persisted Google OAuth tokens (single row).                                      |
| `xero_tokens`        | Persisted Xero OAuth tokens + tenant ID (single row).                            |
| `wise_cache`         | Cached Wise API responses (transfers, balances).                                 |
| `data_cache`         | Generic per-source JSON cache used by analytics endpoints.                       |
| `pipeline_log`       | Per-step audit log for every pipeline run (run_id, file_id, action, status).     |
| `chat_conversations` | Conversation containers for the in-app AI chat assistant.                        |
| `chat_messages`      | Individual chat turns linked to a conversation.                                  |

For full column-level documentation, see [DATABASE.md](./DATABASE.md).

---

## Cron Schedule

The autonomous pipeline runs on two schedules (configured at the OS / scheduler level):

| Cron              | Purpose                                                                 |
|-------------------|-------------------------------------------------------------------------|
| Daily **18:00**   | Full sync of all sources, then full pipeline run.                       |
| **Hourly retry**  | Re-runs the pipeline against any unrecorded files left behind so transient failures (Sheets quota, Xero 429, AI timeouts) self-heal within the hour. |

Both jobs hit `POST /api/pipeline?action=run`, which is left in the public-routes list so the cron does not need a session cookie.

---

## Related Documentation

- [PIPELINE.md](./PIPELINE.md) — step-by-step pipeline flow, categories, throttling, monitoring.
- [DATABASE.md](./DATABASE.md) — full schema reference.
