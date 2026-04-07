# Database Reference

The application uses a single **SQLite** database (`data/accounting.db`) accessed via `better-sqlite3`. The schema is defined and migrated by `initSchema()` in `src/lib/db.ts`.

- **Journal mode**: WAL (so reads never block writes during sync runs).
- **Foreign keys**: ON.
- **Schema migrations**: additive only — defensive `ALTER TABLE ... ADD COLUMN` calls wrapped in try/catch are used so re-running on an existing DB is safe.

---

## Table Index

| Table                  | Purpose                                                              |
|------------------------|----------------------------------------------------------------------|
| [`emails`](#emails)               | Full Gmail messages, body, raw source.                    |
| [`files`](#files)                 | Every ingested document (Gmail attachments + GDrive).     |
| [`file_index`](#file_index)       | Per-file accounting metadata used by the pipeline.        |
| [`activity`](#activity)           | Human-readable sync/pipeline activity log.                |
| [`connections`](#connections)     | Per-source connection state.                              |
| [`settings`](#settings)           | Generic key/value config store.                           |
| [`google_tokens`](#google_tokens) | Persisted Google OAuth tokens.                            |
| [`xero_tokens`](#xero_tokens)     | Persisted Xero OAuth tokens + tenant info.                |
| [`wise_cache`](#wise_cache)       | Cached Wise API responses.                                |
| [`data_cache`](#data_cache)       | Generic per-source JSON cache for analytics.              |
| [`pipeline_log`](#pipeline_log)   | Per-step audit log for every pipeline run.                |
| [`chat_conversations`](#chat_conversations) | Container rows for the AI chat assistant.       |
| [`chat_messages`](#chat_messages) | Individual chat turns linked to a conversation.           |

---

## emails

**Purpose**: Stores every Gmail message fetched via IMAP, including full headers and the raw RFC822 source. Used both as the listing source for the Email page and as the lookup target for `getEmailBodyForFile()` (the pipeline reads the body to extract amounts).

| Column             | Type    | Description                                                       |
|--------------------|---------|-------------------------------------------------------------------|
| `id`               | TEXT PK | Stable message identifier (typically the IMAP-derived hash).      |
| `uid`              | INTEGER | IMAP UID for incremental fetch.                                   |
| `message_id`       | TEXT    | RFC822 `Message-ID` header.                                       |
| `subject`          | TEXT    | Email subject.                                                    |
| `from_address`     | TEXT    | Sender email address.                                             |
| `from_name`        | TEXT    | Sender display name.                                              |
| `to_addresses`     | TEXT    | Comma-joined recipients.                                          |
| `cc_addresses`     | TEXT    | Comma-joined CCs.                                                 |
| `bcc_addresses`    | TEXT    | Comma-joined BCCs.                                                |
| `reply_to`         | TEXT    | Reply-To header.                                                  |
| `date`             | TEXT    | ISO date string. **NOT NULL**.                                    |
| `body_text`        | TEXT    | Plain-text body (used by amount extractor).                       |
| `body_html`        | TEXT    | HTML body for the email viewer.                                   |
| `headers`          | TEXT    | Serialized full headers (JSON).                                   |
| `labels`           | TEXT    | IMAP/Gmail labels (JSON).                                         |
| `has_attachments`  | INTEGER | 0/1 flag.                                                         |
| `attachment_count` | INTEGER | Number of attachments.                                            |
| `raw_source`       | BLOB    | Full RFC822 source for re-parsing if needed.                      |
| `created_at`       | TEXT    | Insert timestamp (`datetime('now')`).                             |

**Indexes**: `idx_emails_date(date)`, `idx_emails_from(from_address)`, `idx_emails_subject(subject)`.

**Example use cases**:
- Display the Email page sorted by `date DESC`.
- The pipeline calls `getEmailBodyForFile(fileId)` which joins `files` → `emails` to read `body_text` for amount extraction.
- Full-text search by subject/from/body via `searchEmails()`.

---

## files

**Purpose**: The unified store for every accounting document — both Gmail attachments and Google Drive files. The binary content is stored in-row as `BLOB` so the dashboard can serve previews/downloads without going back to the source.

| Column          | Type        | Description                                                                    |
|-----------------|-------------|--------------------------------------------------------------------------------|
| `id`            | TEXT PK     | Format: `gdrive_<driveId>` for Drive files, message-attachment hash for Gmail. |
| `email_id`      | TEXT FK     | References `emails(id)` for Gmail attachments; NULL for GDrive.                |
| `name`          | TEXT NOT NULL | File name (with `.pdf`/`.xlsx`/`.pptx` appended for exported Workspace docs). |
| `mime_type`     | TEXT NOT NULL | MIME type after any export conversion.                                       |
| `source`        | TEXT NOT NULL | `"gmail"` or `"gdrive"`.                                                     |
| `date`          | TEXT NOT NULL | Modified time (Drive) or sent date (Gmail).                                  |
| `size`          | TEXT        | Human-readable size (e.g. `"1.2 MB"`).                                         |
| `size_bytes`    | INTEGER     | Raw byte count (used by junk detection: tiny images < 15 KB).                  |
| `download_url`  | TEXT        | Internal download URL for Gmail attachments.                                   |
| `preview_url`   | TEXT        | Optional preview URL.                                                          |
| `starred`       | INTEGER     | 0/1 — toggleable star.                                                         |
| `folder`        | TEXT        | Drive folder path (e.g. `"My Drive/Receipts/2026"`).                           |
| `email_subject` | TEXT        | Denormalized email subject (for fast categorization without joins).            |
| `email_from`    | TEXT        | Denormalized sender (for fast categorization without joins).                   |
| `tags`          | TEXT        | JSON array of user tags.                                                       |
| `has_content`   | INTEGER     | 0/1 — whether `content` BLOB is populated.                                     |
| `content`       | BLOB        | Raw file bytes.                                                                |
| `created_at`    | TEXT        | Insert timestamp.                                                              |
| `updated_at`    | TEXT        | Last update timestamp.                                                         |

**Indexes**: `idx_files_source(source)`, `idx_files_date(date)`, `idx_files_starred(starred)`, `idx_files_name(name)`, `idx_files_email_id(email_id)`.

**Foreign keys**: `email_id → emails(id)`.

**Example use cases**:
- The dashboard's Files page lists all rows ordered by `date DESC`.
- `/api/files/<id>/download` serves `content` directly to the user (or to the receipt link in Sheets).
- The pipeline iterates `getUnrecordedFiles()` (LEFT JOIN with `file_index`) to find files that need processing.

---

## file_index

**Purpose**: Per-file accounting metadata produced by the pipeline. Separated from `files` so re-syncing source data (which `UPSERT`s into `files`) does not destroy human edits to category/vendor/amount.

| Column             | Type    | Description                                                                  |
|--------------------|---------|------------------------------------------------------------------------------|
| `file_id`          | TEXT PK | References `files(id) ON DELETE CASCADE`.                                    |
| `category`         | TEXT NOT NULL | One of the `CategoryKey` values; default `'uncategorized'`.            |
| `status`           | TEXT NOT NULL | `pending` / `reviewed` / `recorded` / `flagged`; default `'pending'`.  |
| `period`           | TEXT    | Year-month string `YYYY-MM` for reporting.                                    |
| `notes`            | TEXT    | Free-form notes (also gets the AI's `description`).                          |
| `vendor`           | TEXT    | Cleaned vendor/customer name.                                                |
| `amount`           | TEXT    | Amount as a string to preserve precision.                                    |
| `currency`         | TEXT    | ISO currency code; default `'PHP'`.                                          |
| `reference_no`     | TEXT    | Invoice number / reference, used by duplicate detection.                     |
| `auto_categorized` | INTEGER | 0/1 — set to 1 when the pipeline (rules or AI) wrote the category.           |
| `sheet_type`       | TEXT    | The "Type" column for the destination sheet (`CC`, `Reimbursement`, etc.). Added by migration. |
| `payment_method`   | TEXT    | `Andrea CC` / `Bank` / `Cash` / etc. Added by migration.                     |
| `needs_review`     | INTEGER | 0/1 — set when AI confidence is low. Added by migration.                     |
| `review_notes`     | TEXT    | Why the file was flagged (e.g. `"Low AI confidence"`). Added by migration.   |
| `indexed_at`       | TEXT    | First-classification timestamp.                                              |
| `updated_at`       | TEXT    | Last update timestamp.                                                       |

**Indexes**: `idx_file_index_category(category)`, `idx_file_index_status(status)`, `idx_file_index_period(period)`, `idx_file_index_vendor(vendor)`.

**Foreign keys**: `file_id → files(id) ON DELETE CASCADE`.

**Example use cases**:
- `getUnrecordedFiles()` returns files where `status != 'recorded'`.
- The dashboard's "needs review" view filters by `needs_review = 1`.
- Reports group by `period` + `category` for monthly P&L breakdowns.
- `reset-recorded` action wipes `status` back to `pending` for re-processing.

---

## activity

**Purpose**: Human-readable activity log shown in the dashboard's activity feed. One row per noteworthy action (sync completed, pipeline run finished).

| Column       | Type        | Description                                                |
|--------------|-------------|------------------------------------------------------------|
| `id`         | TEXT PK     | UUID.                                                      |
| `action`     | TEXT NOT NULL | `sync` / `categorize` / `delete` / etc.                  |
| `source`     | TEXT NOT NULL | `gmail` / `gdrive` / `xero` / `wise` / `pipeline`.       |
| `details`    | TEXT NOT NULL | Free-form description (e.g. `"Synced 12 new files"`).    |
| `file_count` | INTEGER     | Optional count for display.                                |
| `timestamp`  | TEXT NOT NULL | ISO timestamp.                                          |

**Indexes**: `idx_activity_timestamp(timestamp)`.

**Example use cases**:
- Dashboard activity feed: `SELECT ... ORDER BY timestamp DESC LIMIT 50`.
- After every sync and every pipeline run, a summary row is inserted.

---

## connections

**Purpose**: Tracks the connection status of each external data source for the dashboard's "Connections" panel.

| Column       | Type        | Description                                              |
|--------------|-------------|----------------------------------------------------------|
| `source`     | TEXT PK     | `gdrive` / `gmail` / `outlook` / `xero`.                 |
| `connected`  | INTEGER     | 0/1 flag.                                                |
| `email`      | TEXT        | Account identifier (e.g. the IMAP user).                 |
| `last_sync`  | TEXT        | ISO timestamp of last successful sync.                   |
| `file_count` | INTEGER     | Files known for that source at last sync.                |

**Seed data**: on first boot the rows `gdrive`, `outlook`, `gmail`, `xero` are inserted with `connected = 0`.

**Example use cases**:
- Dashboard shows green/red dots based on `connected` and freshness of `last_sync`.
- `setConnection()` is called at the end of every successful sync.

---

## settings

**Purpose**: Generic key/value store for application-level configuration that doesn't deserve its own table.

| Column       | Type        | Description                       |
|--------------|-------------|-----------------------------------|
| `key`        | TEXT PK     | Setting key.                      |
| `value`      | TEXT NOT NULL | Setting value (often a string). |
| `updated_at` | TEXT        | Last update timestamp.            |

**Known keys**:
- `gdrive_folder` — optional Drive folder URL/ID; if set, sync only walks that folder instead of the entire drive.

---

## google_tokens

**Purpose**: Persists the Google OAuth token bundle for Drive + Sheets access. Single-row table (enforced by `CHECK (id = 1)`).

| Column       | Type        | Description                              |
|--------------|-------------|------------------------------------------|
| `id`         | INTEGER PK  | Always `1`.                              |
| `tokens`     | TEXT NOT NULL | JSON-serialized token bundle from googleapis. |
| `updated_at` | TEXT        | Last refresh timestamp.                  |

**Example use cases**:
- `getTokens()` reads the row before every Drive/Sheets API call.
- Refreshed automatically when access tokens expire.

---

## xero_tokens

**Purpose**: Persists the Xero OAuth2 token bundle plus the tenant ID. Single-row table.

| Column        | Type        | Description                                                  |
|---------------|-------------|--------------------------------------------------------------|
| `id`          | INTEGER PK  | Always `1`.                                                  |
| `tokens`      | TEXT NOT NULL | JSON-serialized OAuth2 token bundle (xero-node).           |
| `tenant_id`   | TEXT        | The active Xero organisation ID (required for every API call). |
| `tenant_name` | TEXT        | Human-readable org name for the dashboard.                   |
| `updated_at`  | TEXT        | Last refresh timestamp.                                      |

**Example use cases**:
- `isXeroConnected()` returns `true` when this row exists and tokens are valid.
- The pipeline reads `tenant_id` before calling `createBill()` / `createInvoice()`.

---

## wise_cache

**Purpose**: Caches Wise API responses (transfers, balances) so the dashboard does not hit the Wise API on every page load.

| Column       | Type        | Description                              |
|--------------|-------------|------------------------------------------|
| `key`        | TEXT PK     | Cache key (e.g. `transfers`, `balances`). |
| `data`       | TEXT NOT NULL | JSON payload from Wise.                |
| `updated_at` | TEXT        | When the cache was last refreshed.       |

**Example use cases**:
- `syncWiseData()` writes to this table at the end of each sync.
- Reconciliation page reads from here to compare against `file_index` payables.

---

## data_cache

**Purpose**: Generic per-source JSON cache used by various analytics endpoints (e.g. cross-reference, reports). Decoupled from `wise_cache` so each cache can evolve independently.

| Column       | Type        | Description                            |
|--------------|-------------|----------------------------------------|
| `key`        | TEXT PK     | Cache key.                             |
| `source`     | TEXT NOT NULL | Source identifier for filtering.     |
| `data`       | TEXT NOT NULL | JSON payload.                        |
| `updated_at` | TEXT        | When the cache was last refreshed.     |

**Indexes**: `idx_data_cache_source(source)`.

---

## pipeline_log

**Purpose**: Append-only audit trail for every pipeline run. Every action and every per-file step writes a row here, so any run can be replayed by querying `WHERE run_id = ?`.

| Column       | Type             | Description                                                                  |
|--------------|------------------|------------------------------------------------------------------------------|
| `id`         | INTEGER PK AUTOINCREMENT | Row id.                                                              |
| `run_id`     | TEXT NOT NULL    | UUID generated at the top of `runPipeline()`. Groups rows for one run.       |
| `file_id`    | TEXT             | The file being processed (NULL for run-level events like `pipeline_start`).  |
| `action`     | TEXT NOT NULL    | `pipeline_start`, `scan`, `categorize_rule`, `categorize_ai`, `record`, `xero_bill`, `xero_invoice`, `process`, `pipeline_end`, `sheet_load`. |
| `status`     | TEXT NOT NULL    | `success` / `error` / `skipped` / `duplicate`.                              |
| `result`     | TEXT             | Short result (e.g. category name, `payable`, `DRAFT`).                      |
| `error`      | TEXT             | Error message when `status = 'error'`.                                       |
| `details`    | TEXT             | Free-form context (e.g. `"Cloudflare USD 12.50"`).                          |
| `created_at` | TEXT             | Insert timestamp.                                                            |

**Indexes**: `idx_pipeline_log_run(run_id)`, `idx_pipeline_log_file(file_id)`, `idx_pipeline_log_created(created_at)`.

**Example use cases**:
- `/dashboard/monitor` lists recent runs and lets you drill into each one.
- "Why was this file skipped?" — query by `file_id` to see every action ever taken on it.
- Health checks: count `error` rows in the last hour.

---

## chat_conversations

**Purpose**: Container rows for the in-app AI chat assistant. Each conversation has a title and a set of messages.

| Column       | Type        | Description                              |
|--------------|-------------|------------------------------------------|
| `id`         | TEXT PK     | UUID.                                    |
| `title`      | TEXT NOT NULL | Defaults to `'New Chat'`.              |
| `created_at` | TEXT        | Created timestamp.                       |
| `updated_at` | TEXT        | Last activity timestamp.                 |

**Example use cases**:
- Sidebar list of past chats, ordered by `updated_at DESC`.

---

## chat_messages

**Purpose**: Individual chat turns. Each message belongs to exactly one conversation; deleting a conversation cascades the messages.

| Column            | Type             | Description                                              |
|-------------------|------------------|----------------------------------------------------------|
| `id`              | INTEGER PK AUTOINCREMENT | Row id.                                          |
| `conversation_id` | TEXT NOT NULL FK | References `chat_conversations(id) ON DELETE CASCADE`.   |
| `role`            | TEXT NOT NULL    | `user` / `assistant` / `system`.                        |
| `content`         | TEXT NOT NULL    | Message body.                                            |
| `model`           | TEXT             | Model name used for assistant messages.                  |
| `created_at`      | TEXT             | Created timestamp.                                       |

**Indexes**: `idx_chat_messages_conv(conversation_id)`.

**Foreign keys**: `conversation_id → chat_conversations(id) ON DELETE CASCADE`.

**Example use cases**:
- Render a conversation by querying `WHERE conversation_id = ? ORDER BY id ASC`.
- Persist user prompts and assistant replies as the user chats with the AI assistant.

---

## Relationships Diagram

```
emails (1) ────────< files (N)
                       │
                       │ 1
                       ▼
                  file_index (1)

chat_conversations (1) ────────< chat_messages (N)
```

Other tables (`activity`, `connections`, `settings`, `google_tokens`, `xero_tokens`, `wise_cache`, `data_cache`, `pipeline_log`) are standalone and have no foreign keys.

---

## Related Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — system architecture, why SQLite, why WAL.
- [PIPELINE.md](./PIPELINE.md) — how the pipeline reads/writes these tables.
