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

```
x-api-key: dabad6bac618e166401b28bdd40c40606c58f57839c079a661440b59d044746f
```

Or query param: `?key=<API_KEY>`

---

## Available Actions

All use `GET /api/open?key=<KEY>&action=<ACTION>`

### General
| Action | Description |
|--------|-------------|
| `overview` | Stats, connections, recent activity |
| `stats` | File/email statistics |
| `emails` | List emails (optional `&q=search&limit=50`) |
| `email` | Single email (`&id=xxx`) |
| `files` | All files (optional `&source=gdrive\|email-gmail`) |
| `search` | Search files + emails (`&q=term`) |
| `activity` | Recent sync activity log |
| `connections` | Connection statuses |

### Accounting Index
| Action | Description |
|--------|-------------|
| `accounting` | Summary: `&sub=summary`. Files: `&sub=files&category=receipt&status=pending` |

### Xero Accounting (DeFiner Tech Ltd — HKD)
| Action | Sub | Description |
|--------|-----|-------------|
| `xero` | `status` | Connection status |
| `xero` | `summary` | Invoices due, bills due, receivable, payable |
| `xero` | `invoices` | All invoices (paginated `&page=1`) |
| `xero` | `bills` | All bills |
| `xero` | `contacts` | All contacts |
| `xero` | `accounts` | Chart of accounts |

### Wise (HobbyLand Technology Limited)
| Action | Sub | Description |
|--------|-----|-------------|
| `wise` | `summary` | Balances + recent transfers |
| `wise` | `balances` | All currency balances |
| `wise` | `transfers` | Transfers (add `&all=true` for all 1385, or `&limit=20&offset=0`) |
| `wise` | `all-transfers` | All transfers with stats + per-currency breakdown |
| `wise` | `recipients` | All 59 recipients |
| `wise` | `rate` | Live exchange rate (`&source=HKD&target=PHP`) |

### Analytics
| Action | Sub | Description |
|--------|-----|-------------|
| `analytics` | `overview` | Multi-currency positions, HKD equivalents, Xero receivable/payable |
| `analytics` | `spending-trends` | Monthly spend by category |
| `analytics` | `cash-flow` | 4-period forecast (overdue, this week, 2 weeks, month) |
| `analytics` | `vendor-scorecard` | All vendors ranked by total spend |
| `analytics` | `budget` | Budget vs actual for current month |

### Google Sheets (Expenses)
| Action | Sub | Description |
|--------|-----|-------------|
| `sheets` | `all` | All payable + receivable entries |
| `sheets` | `payables` | Payable entries only |
| `sheets` | `receivables` | Receivable entries only |

### Alerts
| Action | Description |
|--------|-------------|
| `alerts` | Smart alerts: overdue invoices, duplicates, missing periods, uncategorized |

### Sync
| Action | Description |
|--------|-------------|
| `sync` | Trigger full sync (optional `&source=email\|gdrive\|xero\|wise`) |

---

## Example Queries for Mina

- "How much do we owe?" → `action=xero&sub=summary` (check totalPayable)
- "List overdue invoices" → `action=alerts` (check overdue type)
- "How much did we transfer via Wise?" → `action=wise&sub=all-transfers`
- "What's the HKD to PHP rate?" → `action=wise&sub=rate&source=HKD&target=PHP`
- "Show March expenses" → `action=sheets&sub=payables` (filter by date)
- "Who are our biggest vendors?" → `action=analytics&sub=vendor-scorecard`
- "What's our cash flow forecast?" → `action=analytics&sub=cash-flow`
