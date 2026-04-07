# Autonomous Accounting Pipeline

The pipeline is the heart of the system: it takes raw ingested files (from Gmail and Google Drive), classifies them, extracts amounts, deduplicates them against existing records, writes them to Google Sheets, and creates DRAFT entries in Xero — all without human intervention. A human accountant only needs to review the DRAFTs and the items the pipeline flagged for low confidence.

Source: `src/lib/pipeline.ts` (entry point: `runPipeline()`).

---

## End-to-End Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│  runPipeline()                                                          │
└─────────────────────────────────────────────────────────────────────────┘
            │
            ▼
   ┌──────────────────┐
   │ 1. Scan          │  db.getUnrecordedFiles() — every file with no
   │                  │  recorded sheet row yet.
   └──────────────────┘
            │
            ▼
   ┌──────────────────┐
   │ 2. Load existing │  getPayables() + getReceivables() from Sheets.
   │    sheet rows    │  Used as the dedupe corpus for this run.
   └──────────────────┘
            │
            ▼  for each unrecorded file:
   ┌──────────────────┐
   │ 3a. Categorize   │  Try rule-based categorizeFile() (regex on
   │     (rules)      │  filename / subject / sender). Fast, free, deterministic.
   └──────────────────┘
            │
            ▼  if rules return "uncategorized" AND OpenRouter key set:
   ┌──────────────────┐
   │ 3b. Categorize   │  aiCategorizeFile() — sends filename, subject,
   │     (AI fallback)│  email body, and parsed PDF text to an LLM that
   │                  │  returns category + sheetType + paymentMethod +
   │                  │  vendor + amount + currency + confidence.
   └──────────────────┘
            │
            ▼
   ┌──────────────────┐
   │ 4. Extract amount│  If still no amount, parse the email body with
   │                  │  extractAmountFromBody() (regex on Total: lines).
   └──────────────────┘
            │
            ▼
   ┌──────────────────┐
   │ 5. Skip filter   │  SKIP_CATEGORIES (junk, contract, permit, etc.)
   │                  │  exit here without recording.
   └──────────────────┘
            │
            ▼
   ┌──────────────────┐
   │ 6. Duplicate     │  isDuplicate() checks invoice number AND
   │    check         │  vendor+amount+date proximity vs the loaded sheets.
   └──────────────────┘
            │
            ▼
   ┌──────────────────┐
   │ 7. Record to     │  appendPayableRow() or appendReceivableRow().
   │    Google Sheet  │  Sleeps 1.2s after each write.
   └──────────────────┘
            │
            ▼
   ┌──────────────────┐
   │ 8. Create Xero   │  createBill() (payables) or createInvoice()
   │    DRAFT         │  (receivables). Amount must be > 0.
   └──────────────────┘
```

Every step writes a row to `pipeline_log` with the `run_id`, `file_id`, `action`, `status`, and `error/details` fields, so the entire run is fully auditable.

---

## Categories and Sheet Types

The pipeline distinguishes between two concepts that are easy to confuse:

- **Category** — *what kind of document is this?* (e.g. invoice, bill, receipt). Determined by `categorize.ts` rules or AI.
- **Sheet Type** — *how was it paid?* (e.g. CC, Reimbursement, Supplier). Drives the "Type" column in the accountant's expense sheet.

### Categories

| Category        | Routed to    | Description                                                                  |
|-----------------|--------------|------------------------------------------------------------------------------|
| `invoice`       | Receivables  | Sales invoices we sent to customers (money coming IN).                       |
| `bill`          | Payables     | Vendor bills / supplier invoices (money going OUT).                          |
| `receipt`       | Payables     | Payment confirmations for things we paid for.                                |
| `reimbursement` | Payables     | Employee or freelancer expense claims being repaid.                          |
| `payroll`       | Payables     | Salary slips, SSS, PhilHealth, Pag-IBIG.                                     |
| `tax`           | Skipped      | BIR forms, VAT returns — informational only, not auto-recorded.              |
| `bank_statement`| Skipped      | Monthly bank statements.                                                     |
| `contract`      | Skipped      | Contracts and agreements.                                                    |
| `permit`        | Skipped      | Business permits, licenses.                                                  |
| `quotation`     | Skipped      | Quotes / proposals (not yet a bill).                                         |
| `junk`          | Skipped      | Bounce notices, tracking pixels, email icons.                                |
| `uncategorized` | Skipped      | Falls through when neither rules nor AI could classify.                      |

```ts
const PAYABLE_CATEGORIES   = new Set(["bill", "reimbursement", "receipt", "payroll"]);
const RECEIVABLE_CATEGORIES = new Set(["invoice"]);
const SKIP_CATEGORIES       = new Set(["junk", "uncategorized", "contract",
                                        "permit", "quotation", "bank_statement", "tax"]);
```

### Sheet Types (the "Type" column)

| Sheet Type                  | Meaning                                                              | Example                                              |
|-----------------------------|----------------------------------------------------------------------|------------------------------------------------------|
| `CC`                        | Paid by company credit card / SaaS subscription                      | Cloudflare receipt, GitHub, OpenAI, Anthropic, AWS   |
| `Reimbursement`             | Paid personally by Andrea, being reimbursed                          | Andrea's Anthropic Max receipt forwarded to admin@   |
| `Freelancer`                | Payment to a freelancer/contractor                                   | Jamie Bonsay design payment, Jayvee blog work        |
| `Freelancer - Reimbursement`| Freelancer paid for something on behalf of company                   | Freelancer expense receipt                            |
| `Staff`                     | Staff/employee expense (not freelancer, not payroll)                 | Office supply purchase                                |
| `Payroll`                   | Actual salary payments                                               | Monthly salary slip                                   |
| `Supplier`                  | Bank transfer to a traditional supplier                              | Wire transfer to printing vendor                      |
| `Cash`                      | Paid in physical cash                                                | Petty cash receipt                                    |
| `Invoice`                   | Sales invoice we sent to a customer                                  | Outgoing invoice to client                            |

> **Important rule from accountant Andrea**: `Receipt` is **not** a valid sheet type. The fact that a document *is* a receipt doesn't mean its sheet type is "Receipt" — the sheet type is about *how it was paid*. The AI prompt enforces this and `parseAIResponse()` defensively rewrites `sheetType=Receipt` to `sheetType=CC`.

---

## Categorization: rules first, AI second

### Rule-based (free, fast, deterministic)

`src/lib/categorize.ts` runs first. Each `CategorizeRule` has three pattern lists weighted as:

- filename match: **+3**
- subject match: **+3**
- sender match: **+2**

The highest-scoring category wins. Confidence is `high` if score ≥ 5, `medium` if ≥ 2, else `low`. There is also a fast-path `isJunkFile()` that catches `mailer-daemon` bounces, tracking pixels (tiny images < 15 KB with no real subject), and known junk filenames like `icon.png`.

Rules also produce a `vendor` via a `VENDOR_MAP` lookup against the subject, filename, and sender (e.g. anything matching `/cloudflare/i` → `"Cloudflare"`).

### AI fallback (`src/lib/ai-categorize.ts`)

If rules return `uncategorized` and `OPENROUTER_API_KEY` is configured, the pipeline falls back to AI:

1. Loads the email body via `db.getEmailBodyForFile()`.
2. If the file is a PDF, parses its text content with `pdf-parse`.
3. Sends a structured prompt to OpenRouter (model from `AI_MODEL`, default `qwen/qwen3.6-plus-preview:free`) requesting strict JSON: `category`, `sheetType`, `paymentMethod`, `vendor`, `amount`, `currency`, `description`, `confidence`.
4. The prompt embeds Andrea's accounting rules and a decision tree for `sheetType`, plus 8 worked examples (Cloudflare → CC, Jayvee blog → Freelancer, Andrea Anthropic Max → Reimbursement, etc.).
5. Result is written to `file_index`. If `confidence === "low"`, the file is flagged with `needs_review = 1` and `review_notes = "Low AI confidence"` so a human can double-check it on the dashboard.

---

## Amount Extraction

If neither rules nor AI produced an amount, the pipeline tries `extractAmountFromBody(emailBody)`:

1. Looks for `Total:` lines (most reliable, picks the **last** match — usually the grand total).
2. Falls back to currency-prefixed regexes (`$`, `HK$`, `₱`, `S$`, `€`, `£`, `RM`, `Rp`, plus ISO codes) and picks the **largest** value found, since totals are typically the biggest number on the page.

Supported currencies: USD, HKD, PHP, SGD, EUR, GBP, MYR, IDR.

---

## Duplicate Detection

`isDuplicate()` runs before any sheet write. A file is considered a duplicate if **any** of these are true against the in-memory rows loaded from Sheets at the start of the run:

### Payables

1. **Invoice number match** — `file.referenceNo` is non-empty AND a payable row's `invoiceNumber` `includes()` it.
2. **Vendor + amount + date proximity** — vendor name (lowercased, first 5 chars) is contained in the row's `supplierName`, AND the amounts are within 5% of each other, AND the dates are within 7 days.

### Receivables

1. **Invoice number match** — `file.referenceNo` is non-empty AND a receivable row's `invoiceNumber` `includes()` it.

Duplicates are logged with `action=record, status=duplicate` and counted in `result.duplicates`. They never reach Sheets or Xero.

---

## Throttling

Google Sheets imposes a **60 writes/minute** quota per user. After every successful `appendPayableRow()` or `appendReceivableRow()`, the pipeline calls:

```ts
await sleep(1200); // 1.2s — caps at ~50 writes/min, leaving headroom
```

This prevents the pipeline from being throttled mid-run, which would otherwise cascade into errors and partial state.

There is no throttling on Xero writes — the API is more generous and the pipeline only creates DRAFTs (not finalized invoices), which are cheap.

---

## Logging and Audit Trail

Every action writes to the `pipeline_log` table via `db.logPipeline()`:

| Action            | Statuses                          | When                                         |
|-------------------|-----------------------------------|----------------------------------------------|
| `pipeline_start`  | success                           | At the very top of `runPipeline()`.          |
| `scan`            | success                           | After loading unrecorded files.              |
| `sheet_load`      | error                             | If loading existing payables/receivables fails. |
| `categorize_rule` | success                           | Rule-based classifier produced a category.   |
| `categorize_ai`   | success / error                   | AI classifier ran (or failed).               |
| `record`          | success / skipped / duplicate / error | The Sheets write step.                  |
| `xero_bill`       | success / error                   | DRAFT bill creation.                         |
| `xero_invoice`    | success / error                   | DRAFT invoice creation.                      |
| `process`         | error                             | Catch-all per-file error wrapper.            |
| `pipeline_end`    | success / error                   | Final summary line.                          |

Every row carries the same `run_id` (a UUID generated at the top of `runPipeline()`), so a single run can be retrieved with `WHERE run_id = ?`.

A single human-readable summary is also written to the `activity` table at the end of the run, e.g.: `Pipeline: 12 recorded, 3 dupes, 5 skipped, 1 errors`.

---

## Monitoring

- **Dashboard**: `/dashboard/monitor` — displays the latest pipeline runs, per-run breakdown (recorded / duplicates / skipped / errors), and lets you drill into the `pipeline_log` rows.
- **Activity feed**: every run's summary line shows up in the dashboard's activity feed via the `activity` table.
- **Files needing review**: any file with `needs_review = 1` (low AI confidence) is surfaced on the dashboard for human review.

---

## Manual Operations

### Trigger a run on demand

```bash
curl -X POST 'https://accounting.devehub.app/api/pipeline?action=run'
```

This is the same endpoint the daily and hourly cron jobs use. The route is in the public-routes list in `middleware.ts`, so no session cookie is required.

### Reset and reprocess

If categorizations or sheet writes went wrong and you want the pipeline to redo work, reset the recorded markers:

```bash
curl -X POST 'https://accounting.devehub.app/api/pipeline?action=reset-recorded'
```

This clears the "recorded" status from `file_index` so the next pipeline run will re-evaluate those files. Existing rows in the destination Google Sheet are **not** deleted — but the duplicate detector should catch them on the second pass and skip them, leaving Xero/Sheets unchanged unless the input data has actually changed.

---

## Error Handling and Retries

The pipeline is designed to be safely re-run any number of times:

- **Per-file try/catch**: a single bad file (broken PDF, AI timeout, Sheets 429) increments `result.errors` and the loop continues with the next file.
- **Per-step try/catch**: AI failures, Sheets failures, and Xero failures are each isolated, so a Xero outage doesn't block Sheets writes (and vice versa).
- **Idempotent writes**: the duplicate detector is the safety net for re-runs. As long as a row was successfully appended to Sheets (the source of truth for dedupe), it will be skipped on the next run.
- **Hourly retry cron**: any file that errored, was throttled, or where Xero was down will be picked up by the next hourly run automatically. There is no separate dead-letter queue — `pipeline_log` is the audit trail and `getUnrecordedFiles()` is the retry queue.

---

## Related Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — system topology, data sources, auth, cron.
- [DATABASE.md](./DATABASE.md) — schema reference for `file_index`, `pipeline_log`, etc.
