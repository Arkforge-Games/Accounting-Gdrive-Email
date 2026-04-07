# User Guide — AccountSync

This guide is for **Andrea** and anyone using the AccountSync app day-to-day.

---

## Logging In

1. Open **https://accounting.devehub.app**
2. Username: `devtonyadmin`
3. Password: (in `documents/info.txt`)

---

## What This System Does

The system **automatically**:
1. Pulls all invoices, receipts, and statements from `invoicehobbyland@gmail.com` every day
2. Pulls all files from connected Google Drive
3. Pulls all data from Xero (invoices, bills, contacts, P&L, balance sheet)
4. Pulls all transfers and balances from Wise
5. Uses AI to categorize each file (invoice, bill, receipt, reimbursement, etc.)
6. Detects duplicates so the same invoice isn't recorded twice
7. Records new entries to the **Google Sheet** (Payable + Receivable tabs)
8. Creates **DRAFT bills/invoices in Xero** for review
9. Logs every action so you can see what the AI did

You don't need to do anything to add new invoices — just forward them to `invoicehobbyland@gmail.com` and they'll appear automatically.

---

## How to Add a New Invoice/Receipt

### Option 1: Email it (recommended)
Forward or CC the invoice/receipt to **`invoicehobbyland@gmail.com`**.

That's it. The system will:
- Pick it up on the next sync (hourly retry or daily 6PM)
- AI will categorize it
- It will appear in the Google Sheet automatically
- A DRAFT bill will be created in Xero

### Option 2: Upload it directly
Go to the dashboard and use the upload feature (if available on the page you're on).

### Option 3: Add it manually to the Google Sheet
You can edit the Google Sheet directly — the system will sync your changes.

---

## Pages Explained

### `/dashboard` — Overview
Quick stats: how many files synced, last sync time, recent activity. Use this as your starting page.

### `/dashboard/chat` — AI Assistant
**Ask questions in plain English** about your finances:
- "How much do we owe?"
- "What invoices are overdue?"
- "Show me Cloudflare expenses for March"
- "How much did Andrea claim in reimbursements?"
- "What's the HKD to PHP rate?"

Conversations are saved — click an old chat to continue it.

### `/dashboard/expenses` — Google Sheets View
Shows the **Payable** and **Receivable** tabs from the Google Sheet, the same data you'd see in Google Sheets but in a nice table format. This is the same data syncing both ways:
- App → Sheet: when AI categorizes a file, it appears here
- Sheet → App: any edits you make to the Google Sheet show up here on next sync

**Click any row** to see receipt link (Google Drive or download).

### `/dashboard/accounting` — Accounting Index
Shows **all 345+ files** the system has indexed, sorted by category. Use this to:
- See what's been categorized
- Filter by category (invoice, bill, receipt, etc.)
- Re-categorize files manually
- Find files that need review

### `/dashboard/xero` — Xero Dashboard
9 tabs of Xero data:
- **Overview** — invoices due, bills due, receivable, payable
- **Invoices** — all 120 invoices
- **Bills** — all 29 bills
- **Contacts** — 164 customers + suppliers
- **Bank** — bank transactions
- **Accounts** — chart of accounts
- **P&L** — Profit & Loss report
- **Balance Sheet** — Assets, Liabilities, Equity
- **File Matching** — see which files match Xero invoices

### `/dashboard/wise` — Wise Transfers
- 1,385 historical transfers
- 118 recipients with full names
- Multi-currency balances
- Live exchange rate calculator

### `/dashboard/monitor` — Pipeline Monitor
**This is where you check what the AI did.** Shows:
- Pipeline run history (when it ran, how many files, errors)
- Detailed log of every action (categorize, record, skip, duplicate, error)
- "Run Pipeline" button to trigger manually
- Filter by status (Success, Error, Duplicate, Skipped)

If something looks wrong, check this page first.

### `/dashboard/alerts` — Alerts
Smart alerts that need your attention:
- **Overdue invoices** (Xero AUTHORISED + past due)
- **Duplicates** (same vendor, similar amount, close dates)
- **Missing periods** (months with no files)
- **Reimbursements without amounts**
- **Large uncategorized files**

### `/dashboard/reports` — Monthly Reports
Pick a month from the dropdown to see:
- Total income vs expenses
- Top 10 vendors by spend
- Category breakdown
- Xero invoices/bills for that month
- Wise transfers by currency

### `/dashboard/analytics` — Analytics
5 tabs:
- **Overview** — multi-currency positions in HKD
- **Spending Trends** — monthly spend by category
- **Cash Flow** — forecast for overdue, this week, next 2 weeks, next month
- **Vendors** — 27 vendors ranked by total spend
- **Budget** — budget vs actual for current month

### `/dashboard/settings` — Settings
- Connect/disconnect Gmail, GDrive, Xero, Wise, Outlook
- Set sync interval and folder
- Configure file filters

### `/dashboard/emails`, `/dashboard/files`, `/dashboard/drive`
Browse raw synced data — emails, file attachments, Google Drive files.

---

## Common Tasks

### Check if a specific invoice was recorded
1. Go to **Accounting Index** (`/dashboard/accounting`)
2. Search for the vendor or invoice number in the search box
3. Or go to **Expenses Sheet** and search there
4. Or open the actual Google Sheet to see if it's there

### Fix a wrong categorization
The AI might mislabel something (e.g., calling a CC payment a "Receipt"). To fix:
1. Open the Google Sheet directly (link on the Expenses page → "Open in Google Sheets")
2. Edit the Type column to the correct value
3. The next sync will pick up your manual edit

If you see the AI making the same mistake repeatedly, tell Tony so he can update the AI rules.

### Re-process all files (if AI rules were updated)
1. Go to **Pipeline Monitor**
2. Or use API: `POST /api/pipeline action=reset-recorded` then `action=run`
3. The pipeline will re-categorize and re-record everything

### See what the AI is doing
1. Go to **Pipeline Monitor**
2. Click any run to see its detailed log
3. Filter by Success / Error / Duplicate / Skipped

### Check overdue invoices
1. Go to **Alerts** — overdue invoices show as red high-severity alerts
2. Or go to **Cash Flow** tab on Analytics — shows overdue amount

---

## Important Rules (from Andrea)

These rules are baked into the AI:

| Scenario | Correct Type |
|----------|-------------|
| Cloudflare/AWS/SaaS subscription receipt | **CC** (not Supplier, not Receipt) |
| Andrea paid with personal credit card | **Reimbursement** |
| Jamie/Jayvee/freelancer payment | **Freelancer** (not Payroll) |
| Bank transfer to a supplier | **Supplier** |
| Cash purchase | **Cash** |
| Salary to employee | **Payroll** |
| Customer invoice (money in) | **Invoice** |

**Other rules:**
- Reimbursements should NOT have a value in the **Debit (Money Out)** column — that would double-count them
- Receipt links should use Google Drive direct URLs when possible

---

## Troubleshooting

### "Invalid Date" or pages not loading
- Hard refresh: `Ctrl+Shift+R` (or `Cmd+Shift+R` on Mac)

### "Preview not available" for a PDF
- Click the download button instead — it should download the file

### AI categorized something wrong
- Edit the row in Google Sheets directly
- Tell Tony so the AI rule can be updated

### A file wasn't recorded
1. Check **Pipeline Monitor** — see if it errored or was skipped
2. Common reasons:
   - File has no amount or vendor → AI couldn't extract
   - Detected as duplicate
   - Category is "junk" or "uncategorized"
   - Google Sheets quota exceeded (will retry next hour)

### Receipt link broken
- Google Drive files: should open Drive directly (no login needed if shared)
- Email attachments: click should download from the app

### "I edited the Google Sheet but the app shows old data"
- Click "Sync Sheet" button on the Expenses page
- Or wait for next hourly sync

---

## Automation Schedule

| When | What Happens |
|------|------|
| **Every hour** | Pipeline retries failed files (if any) |
| **Every day at 6PM Manila time** | Full sync from all sources + auto-categorize + record to sheets/Xero + enrich |

You don't need to trigger anything manually — it just works.

---

## Support

- **Code repo:** https://github.com/Arkforge-Games/Accounting-Gdrive-Email
- **Server:** Azure VM `74.226.88.89` (deployed via systemd)
- **Database:** SQLite at `/opt/accounting-sync/data/accounting.db`
- **Logs:** `/var/log/accounting-sync-cron.log`

For issues, contact Tony.
