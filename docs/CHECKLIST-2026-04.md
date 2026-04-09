# April 2026 Checklist (Andrea)

Source: WhatsApp message from Andrea Hobbyland on 2026-04-09 14:31 PHT.

> Accounting:
> 1. Xero - Can we reconcile in xero?
>    -- choose the what automatically
> 2. Sheet - Append on sheet properly
>    -- Drop down for: Type, Payment Status, Payment Method, Account
>    -- Check if all are being appended properly
> 3. Drive - Upload on google drive based on timeline + per app
>    -- e.g if app is July 2025, it will be upload on Jul 25-26.
>    -- each app should have own app folder
> 4. Cash column O & P
>    -- list all HKD equivalent of ALL in Column O (except ANY REIMBURSEMENTS)
>    -- list running Balance
> 5. Wise
>    -- should check for freelancer or payroll or Supplier type
>    -- wise data should match and append to sheet

## Item-by-item status

### 1. Xero auto-reconciliation

**Current state:** `POST /api/xero/bills` with `{"action":"reconcile"}` already finds matches between Wise transfers and Xero open bills using a confidence-scored algorithm (amount within 5% + currency + 7-day date proximity + vendor/reference similarity). Returns sorted matches.

**Gap:**
- The endpoint **finds** matches; it does **not apply** them. It never POSTs payments to Xero to mark bills paid.
- It is **only triggered manually** via curl/dashboard. No cron schedule.

**Plan:**
1. Add `applyPaymentToBill(invoiceId, amount, currency, date, reference)` in `xero.ts` that POSTs to `/Payments` with the correct account code.
2. In the existing reconcile route, when called with `?auto=1`, automatically apply matches with `confidence === "high"`. Medium and low matches are returned for review only.
3. Add a new step to `daily-sync.sh`: after the pipeline runs, hit `/api/xero/bills` with `{"action":"reconcile","autoApply":true}` so reconciliation happens nightly.
4. Log every auto-applied payment to `pipeline_log` so it shows on the Monitor dashboard.

**Open questions:** None — the design is clear from existing code.

---

### 2. Sheet column drop-downs

**Current state:** Columns Type, Payment Status, Payment Method, Account are free-text. No data validation rules anywhere in `sheets.ts`.

**Plan:**
1. Add a new `setSheetDropdowns()` function in `sheets.ts` that uses Sheets API `batchUpdate` with `setDataValidation` requests for the four columns.
2. Add `POST /api/admin/setup-dropdowns` admin endpoint to apply the dropdowns. Run once per sheet.
3. The dropdown lists:
   - **Type (col B):** `Invoice`, `CC`, `Reimbursement`, `Freelancer`, `Freelancer - Reimbursement`, `Supplier`, `Staff`, `Cash`, `Payroll`
   - **Payment Status (col K):** `Pending`, `Paid`, `Awaiting Payment`, `Cancelled`
   - **Payment Method (col M):** `Andrea CC`, `Credit Card`, `Bank`, `Cash`, `Wise`, `PayPal`
   - **Account (col N):** `HobbyLand` (+ whatever Andrea adds)
4. Allow free-text on the column too (so AI can write values not in the list — drops down won't reject them, just suggest).

**Open questions:**
- What entities go in the Account dropdown besides "HobbyLand"? **Assumption: only HobbyLand for now.**

---

### 3. Drive — nested folders by period and "app"

**Current state:** All Cloudflare receipts land in `Credit Card/` flat. The existing folders (`Cash`, `Reimbursement`, `Supplier`, `Supplier - Freelancer`, `Staff`, `Client - Receivable`) are also flat.

**Andrea wants:** `Credit Card / Jul 25-26 / autoquotation.app / 2025-12-05 - $14.20.pdf`

**Plan:**
1. Add `resolveOrCreateFolder(parentId, name)` helper in `drive-upload.ts` that uses Drive API to find a child folder by name, or create it if missing. Caches results in memory for the duration of the pipeline run.
2. Extend the upload path to walk:
   - Step 1: category folder (existing — `Credit Card`, etc.)
   - Step 2: fiscal-year folder (`Jul 25-26` for July 2025 - June 2026, etc.)
   - Step 3: app folder (extracted from the receipt — see below)
3. **App detection logic:**
   - For Cloudflare domain receipts, the `jobDetails` description already contains the domain name (e.g. `Registrar Renewal Fee - autoquotation.app`). Parse the domain out.
   - For other SaaS (Anthropic, GitHub, OpenAI, Slack, Zoom, etc.), use the vendor name itself as the "app folder". So Anthropic charges → `Anthropic/`.
   - If no specific app can be detected, fall back to `(uncategorized)/` under the period folder.
4. **Fiscal year format:** Use `Jul YY-YY` format (e.g. `Jul 25-26` covers 2025-07-01 → 2026-06-30). HK fiscal year matches the example Andrea gave.
5. Folder structure example:

```
Credit Card/
├── Jul 25-26/
│   ├── autoquotation.app/
│   │   └── 2025-12-05 - Cloudflare, Inc. - USD 14.20 - IN 52791905.pdf
│   ├── devehub.app/
│   ├── Anthropic/
│   └── GitHub/
└── Jul 26-27/
    └── ...
```

**Open questions:**
- "Each app should have own app folder" — confirmed app = vendor for non-domain charges, domain for Cloudflare-style. **Going with this assumption.**
- HK fiscal year July-June (matches "Jul 25-26") — **assuming this.**

---

### 4. Cash columns — HKD equivalent + running balance

**Current state:** The sheet has columns Q ("Debit (Money Out / Spend)") and R ("Running Balance") with a "CASH ONLY" yellow band header. Both are empty. The pipeline writes nothing to them.

**Andrea says:** "Cash column O & P". The columns I see are at Q & R, not O & P. Either the production sheet has different layout, or she means Q & R.

**Plan (assuming columns Q and R):**
1. Add an FX conversion helper in `sheets.ts` that converts any currency to HKD using Wise live rates (we already integrate with Wise).
2. After writing each non-reimbursement payable row, also populate:
   - Column Q: `HKD <amount>` (the HKD equivalent of the row's payment amount)
   - Column R: `<running total>` (the cumulative HKD total)
3. Reimbursements are EXCLUDED per Andrea's note.
4. Running balance computed as the running sum of column Q values from the top of the data range.

**Open questions:**
- **CRITICAL: Confirm columns** — is the "Cash" section in the production sheet at columns O & P or Q & R? If different, I need the actual letters.
- When new rows come in mid-month, do we recompute the running balance from scratch (reading the whole column) or just append?

---

### 5. Wise auto-categorize and append

**Current state:** Wise sync imports raw transfer data into `wise.ts` cache. Doesn't categorize. Doesn't write to the sheet.

**Andrea wants:** Wise transfers should be classified as Freelancer / Payroll / Supplier and either matched to existing rows or appended as new rows.

**Plan:**
1. Add a `processWiseTransfer()` function in a new `wise-pipeline.ts` that:
   - Iterates `getCachedWiseData("transfers")`
   - For each completed outgoing transfer:
     - Uses AI to classify the recipient as Freelancer / Payroll / Supplier (similar to existing `aiCategorizeFile` but with Wise transfer fields)
     - Computes a `wise_runKey` of `(recipient_name, amount, currency, date_day)` to detect already-processed
     - Matches against existing sheet rows by amount + recipient name + 7-day date proximity
     - If matched: update existing row's `paymentStatus` to `Paid` and `paymentDate` to the transfer date
     - If not matched: append a new row to the appropriate tab (Payable for outgoing, Receivable for incoming)
2. Persist the processed Wise transfer IDs to a new `wise_processed` table to avoid re-processing.
3. Call this from the daily sync after the email pipeline runs.
4. Categorization rules for Wise (added to AI prompt):
   - Recipient name matches a freelancer (Jamie/Jayvee/JM/Murphy/Aarati/etc.) → Freelancer
   - Reference contains "salary" or "payroll" → Payroll
   - Otherwise → Supplier

**Open questions:**
- Do we need a way for Andrea to mark a Wise transfer as "ignore" (e.g. internal transfers)? **Assumption: skip transfers where source and target are both HobbyLand accounts.**
- Some Wise transfers might already have a corresponding email receipt that the pipeline processed. Matching on recipient + amount + date should catch this.

---

## Critical clarifications needed (blockers)

1. **Column letters for cash section** — Q & R or O & P? Need to know exactly. (Item 4)
2. **Fiscal year start month** — July (matching "Jul 25-26") or April (HK common) or another? (Item 3)
3. **Account dropdown contents** — only "HobbyLand" or are there others? (Item 2)

I will proceed with assumptions documented above for items 1, 2 (with HobbyLand only), 3 (Jul-Jun FY), and 5. Item 4 will be implemented but only deployed once Andrea confirms the column letters.

## Out of scope for this checklist

- The corrupted `hourly-retry.sh` is already fixed (separate fix).
- Currency-blind dedupe is already fixed (separate fix).
- SaaS CC override persistence to DB is already fixed (separate fix).
- The 19 Cloudflare receipts already in the sheet will retroactively get migrated to nested folders during the next pipeline run (idempotent — files with `drive_file_url` already set will be MOVED to the new structure rather than re-uploaded).

## Implementation order

1. **Sheet drop-downs** (item 2) — smallest, fastest, no risk
2. **Xero auto-reconcile** (item 1) — extends existing code
3. **Drive nested folders** (item 3) — biggest impact for Andrea
4. **Wise auto-categorize** (item 5) — biggest scope
5. **Cash HKD column** (item 4) — last because of column-letter ambiguity
