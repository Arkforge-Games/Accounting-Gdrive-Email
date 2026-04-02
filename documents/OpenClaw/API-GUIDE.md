# AccountSync API — OpenClaw Integration Guide

Complete API reference for OpenClaw/Mina to access all HobbyLand accounting data.

---

## Connection Details

| Property | Value |
|----------|-------|
| **Base URL** | `https://accounting.devehub.app` |
| **API Endpoint** | `https://accounting.devehub.app/api/open` |
| **Auth** | `x-api-key: dabad6bac618e166401b28bdd40c40606c58f57839c079a661440b59d044746f` |
| **Alt Auth** | `?key=dabad6bac618e166401b28bdd40c40606c58f57839c079a661440b59d044746f` |

---

## Quick Start — Get ALL Data in One Call

```
GET /api/open?key=<KEY>&action=all-data
```

Returns everything in one JSON response:
- `overview` — file stats, connection statuses, recent activity
- `accounting` — file index summary (by category, status, period)
- `xero` — invoices due (42), bills due (29), receivable (HK$428K), payable (HK$127K)
- `wise` — balances, recent transfers, exchange rates
- `analytics` — multi-currency positions, HKD equivalents
- `sheets` — Google Sheets expenses (23 payable + 120 receivable)
- `alerts` — overdue invoices, duplicates, missing periods
- `pipeline` — auto-record pipeline run history

---

## All Available Actions

All use `GET /api/open?key=<KEY>&action=<ACTION>`

### Everything
| Action | Description |
|--------|-------------|
| `all-data` | **ALL data in one call** — overview, Xero, Wise, analytics, sheets, alerts, pipeline |

### General
| Action | Params | Description |
|--------|--------|-------------|
| `overview` | — | Stats, connections, recent activity |
| `stats` | — | File/email counts + total size |
| `emails` | `&q=search&limit=50` | List/search emails |
| `email` | `&id=xxx` | Single email with full body |
| `files` | `&source=gdrive\|email-gmail` | All synced files |
| `search` | `&q=term` | Search files + emails |
| `activity` | `&limit=20` | Sync activity audit log |
| `connections` | — | Connection statuses (Gmail, GDrive, Xero, Wise) |

### Accounting Index (345 files categorized)
| Action | Params | Description |
|--------|--------|-------------|
| `accounting` | `&sub=summary` | Category/status/period breakdown |
| `accounting` | `&sub=files` | All indexed files with vendor, amount, category |
| `accounting` | `&sub=files&category=receipt` | Filter by category |
| `accounting` | `&sub=files&status=pending` | Filter by status |
| `accounting` | `&sub=files&period=2026-03` | Filter by month |

### Xero Accounting (DeFiner Tech Ltd — HKD)
| Action | Params | Description |
|--------|--------|-------------|
| `xero` | `&sub=status` | Connection + tenant info |
| `xero` | `&sub=summary` | **Invoices due: 42 (HK$428K), Bills due: 29 (HK$127K)** |
| `xero` | `&sub=invoices&page=1` | All invoices (100/page) |
| `xero` | `&sub=bills` | All bills |
| `xero` | `&sub=contacts` | 164 contacts (79 customers, 4 suppliers) |
| `xero` | `&sub=accounts` | 60 chart of accounts |

### Wise (HobbyLand Technology Limited — HKD)
| Action | Params | Description |
|--------|--------|-------------|
| `wise` | `&sub=summary` | Balances + last 10 transfers |
| `wise` | `&sub=balances` | All currency balances (HKD 0.00) |
| `wise` | `&sub=all-transfers` | **All 1,385 transfers + stats per currency** |
| `wise` | `&sub=transfers&limit=20&offset=0` | Paginated transfers |
| `wise` | `&sub=recipients` | 118 recipients with full names |
| `wise` | `&sub=rate&source=HKD&target=PHP` | Live exchange rate |

### Analytics
| Action | Params | Description |
|--------|--------|-------------|
| `analytics` | `&sub=overview` | Multi-currency positions, net HKD, Xero receivable/payable |
| `analytics` | `&sub=spending-trends` | Monthly spend by category (11 months) |
| `analytics` | `&sub=cash-flow` | Forecast: overdue, this week, 2 weeks, next month |
| `analytics` | `&sub=vendor-scorecard` | 27 vendors ranked by total spend |
| `analytics` | `&sub=budget` | Budget vs actual for current month |

### Google Sheets (Expenses)
| Action | Params | Description |
|--------|--------|-------------|
| `sheets` | `&sub=all` | All payable (23) + receivable (120) entries |
| `sheets` | `&sub=payables` | Payable entries with supplier, amount, status, receipt link |
| `sheets` | `&sub=receivables` | Receivable entries from Xero invoices |

### Alerts & Monitoring
| Action | Params | Description |
|--------|--------|-------------|
| `alerts` | — | Smart alerts: overdue (23), duplicates (85), missing periods, uncategorized |
| `pipeline` | `&sub=status` | Pipeline run history (auto-record results) |
| `pipeline` | `&sub=log&limit=50` | Detailed pipeline log entries |
| `pipeline` | `&sub=unrecorded` | Files not yet recorded to sheets/Xero |

### Actions
| Action | Description |
|--------|-------------|
| `sync` | Trigger full sync (`&source=email\|gdrive\|xero\|wise`) |

---

## Data Summary (Current State)

| Source | Data |
|--------|------|
| **Gmail** | 274 emails, 198 attachments synced |
| **Google Drive** | 147 files synced |
| **Xero** | 120 invoices, 29 bills, 164 contacts, 82 bank tx, 60 accounts |
| **Wise** | 1,385 transfers, 118 recipients, HKD balance |
| **Accounting Index** | 345 files (55 invoices, 53 receipts, 30 reimbursements, 90 junk, 110 uncategorized) |
| **Google Sheets** | 23 payable + 120 receivable entries |

## Key Financials
| Metric | Value |
|--------|-------|
| **Receivable** | HK$428,196.20 (42 outstanding invoices) |
| **Payable** | HK$126,971.50 (29 outstanding bills) |
| **Net Position** | HK$301,224.70 |
| **Overdue Invoices** | 23 |
| **Bank (HSBC)** | HK$468,426 across 4 accounts |
| **Net Assets** | HK$61,530 |
| **YTD Profit** | HK$35,727 |

---

## Example Queries for Mina

| User Question | API Call |
|---------------|----------|
| "How much do we owe?" | `action=xero&sub=summary` → totalPayable |
| "What invoices are overdue?" | `action=alerts` → overdue type |
| "How much did we transfer via Wise?" | `action=wise&sub=all-transfers` → stats |
| "What's the HKD to PHP rate?" | `action=wise&sub=rate&source=HKD&target=PHP` |
| "Show March expenses" | `action=accounting&sub=files&period=2026-03` |
| "Who are our biggest vendors?" | `action=analytics&sub=vendor-scorecard` |
| "What's our cash flow?" | `action=analytics&sub=cash-flow` |
| "Show me everything" | `action=all-data` |
| "What bills are unpaid?" | `action=xero&sub=bills` |
| "How much did we spend on Cloudflare?" | `action=accounting&sub=files` → filter vendor |
| "What reimbursements does Andrea have?" | `action=sheets&sub=payables` → filter fullName |
| "Any alerts?" | `action=alerts` |
| "What did the pipeline do?" | `action=pipeline&sub=status` |
| "What's our P&L?" | `action=xero&sub=summary` → totalReceivable - totalPayable |
| "How much in the bank?" | `action=analytics&sub=overview` → positions |

---

## Automation Schedule

| Schedule | What Runs |
|----------|-----------|
| **Every hour** | Pipeline retry — processes failed/unrecorded files |
| **Daily 6PM PHT** | Full sync (all sources) → AI categorize → record to sheets + Xero → enrich |
