# AI Categorization Rules

This document explains how the Accounting-Gdrive-Email pipeline uses AI to classify accounting documents and how Andrea's accounting rules are encoded into the prompt.

The source of truth lives in [`src/lib/ai-categorize.ts`](../src/lib/ai-categorize.ts) — this document is a human-readable mirror of the rules baked into the `buildPrompt` function.

---

## Section 1: Overview

### What the AI does

The pipeline ingests accounting documents from two sources:

1. **Gmail** — emailed invoices, receipts, payroll slips, bills, etc.
2. **Google Drive** — PDFs/images uploaded into accounting folders.

For each file, the AI is asked to:

- Classify the document into a single **category** (`invoice`, `bill`, `receipt`, `payroll`, etc.)
- Pick the correct **sheetType** for Andrea's expense spreadsheet (`CC`, `Reimbursement`, `Freelancer`, `Supplier`, etc.)
- Detect the **payment method** (`Andrea CC`, `Credit Card`, `Bank`, `Cash`, ...)
- Extract **vendor**, **amount**, **currency**
- Produce a one-line **description**
- Report a **confidence** level (`high`, `medium`, `low`)

The AI must respond with strict JSON. Markdown code blocks are tolerated; anything outside `{...}` is stripped before parsing.

### Which model

The model is configurable via the `AI_MODEL` environment variable.

```
AI_MODEL=openai/gpt-oss-120b:free   # current default in production
```

The fallback hard-coded in source is `qwen/qwen3.6-plus-preview:free`. In production we use **OpenAI GPT-OSS 120B (free tier)** because it follows the strict JSON format reliably and is free.

To swap models, set `AI_MODEL` to any [OpenRouter](https://openrouter.ai/models) model slug.

### Where it runs

All inference is done through **OpenRouter** (`https://openrouter.ai/api/v1/chat/completions`). The API key comes from the `OPENROUTER_API_KEY` env variable. If the key is missing, `isAIConfigured()` returns false and the pipeline falls back to the rule-based categorizer (`src/lib/categorize.ts`).

Files are processed in **parallel batches of 5** (`aiCategorizeBatch`), with `temperature=0.1` and `max_tokens=300` to keep responses deterministic and short.

---

## Section 2: Categories

The `category` field describes **what kind of document** it is. There are 12 valid values:

| Category | Description | When to use |
|---|---|---|
| `invoice` | Sales invoice we SENT to a customer | Money coming IN. Accounts receivable. |
| `bill` | Invoice/expense FROM a supplier | Money going OUT. Accounts payable. SaaS, cloud, vendor invoices. |
| `receipt` | Payment confirmation, transaction receipt | Proof a payment happened (after the fact). |
| `payroll` | Salary slip, SSS/PhilHealth/Pag-IBIG | ONLY for actual employees, NEVER for freelancers. |
| `tax` | BIR forms, tax returns, withholding certificates | Anything filed with a tax authority. |
| `bank_statement` | Monthly bank statement | Statements from BPI, HSBC, etc. |
| `contract` | Signed contracts/agreements | NDAs, service agreements, employment contracts. |
| `reimbursement` | Employee/freelancer expense being repaid | Someone paid out of pocket and is being repaid. |
| `permit` | Business permit, licence, government doc | DTI, BIR registration, mayor's permit. |
| `quotation` | Price quote (not yet a bill) | Pre-purchase quotes from suppliers. |
| `junk` | Bounces, tracking pixels, system emails | Email delivery failures, marketing junk. Filtered out. |
| `uncategorized` | AI couldn't decide | Falls back to manual review. |

---

## Section 3: Sheet Types (Andrea's rules)

The `sheetType` field maps to the **Type column** in Andrea's expense spreadsheet. This is the field where the AI most often gets confused — and where Andrea has given the most feedback.

> **CRITICAL: `Receipt` is NOT a valid sheet type.**
>
> The fact that a document is *a receipt* (category=receipt) does NOT mean its sheetType is `Receipt`. The sheet type is about **HOW IT WAS PAID**, not what the document looks like.
>
> If the AI returns `sheetType="Receipt"`, the parser in `parseAIResponse()` automatically rewrites it to `"CC"` as a safety net. But the prompt is designed to never produce it in the first place.

### Valid sheet types

| Sheet Type | Meaning | Examples |
|---|---|---|
| `CC` | Paid by COMPANY credit card | Cloudflare, AWS, GitHub, OpenAI, Anthropic, Google Ads, any SaaS subscription auto-billed to the company card |
| `Reimbursement` | Paid by Andrea de Vera personally and being reimbursed | Anthropic Max on Andrea's personal card, Cathay Pacific flight she expensed, anything she forwards from her personal email |
| `Freelancer` | Payment to a freelancer/contractor | Jamie Bonsay (design), Jayvee (blog), JM, Murphy, Aarati |
| `Freelancer - Reimbursement` | Freelancer reimbursing for something on behalf of the company | Freelancer bought tools/assets for the company and is being repaid |
| `Staff` | Staff/employee expense | Employee expense that is NOT a freelancer payment AND NOT payroll |
| `Payroll` | ACTUAL salary/wage payments | Monthly salary slip for a payrolled employee, SSS/PhilHealth/Pag-IBIG contributions |
| `Supplier` | Bank wire/transfer to a traditional supplier with an invoice | Hardware suppliers, office vendors, anything paid by bank wire (NOT credit card, NOT subscription) |
| `Cash` | Paid in physical cash | Petty cash purchases, cash receipts |
| `Invoice` | Sales invoice we SENT to a customer | Money coming IN — the only sheet type for revenue |

---

## Section 4: Decision Tree

When picking `sheetType`, the AI follows this ordered decision tree. **Stop at the first match.**

1. **Is this money we are RECEIVING from a customer?**
   → `Invoice`

2. **Was it paid by Andrea's personal CC and being reimbursed?**
   (Email forwarded by Andrea, or sent to `admin@hobbyland-group.com` from Andrea's personal payment)
   → `Reimbursement` (with `paymentMethod="Andrea CC"`)

3. **Is the recipient a freelancer?** (Jamie / Jayvee / Aarati / JM / Murphy / etc.)
   → `Freelancer`

4. **Is it a SaaS / cloud / online subscription?**
   (Cloudflare, GitHub, AWS, OpenAI, Anthropic, Google Ads, etc.)
   → `CC`

5. **Is it auto-billed to a company credit card?**
   → `CC`

6. **Is it a bank wire to a supplier with an invoice?**
   → `Supplier`

7. **Is it cash?**
   → `Cash`

8. **Is it salary to a payrolled employee?**
   → `Payroll`

If none of the above match, return `uncategorized`.

---

## Section 5: Examples

These 11 examples are embedded in the prompt itself so the model can pattern-match them. They cover the cases Andrea has flagged as historically wrong.

| # | Document | category | sheetType | Notes |
|---|---|---|---|---|
| 1 | Cloudflare domain receipt | `bill` | `CC` | NOT `Receipt`! It's a SaaS bill paid on company CC. |
| 2 | GitHub Payment Receipt | `bill` | `CC` | NOT `Receipt`! Subscription billed to company. |
| 3 | OpenAI receipt | `bill` | `CC` | NOT `Receipt`! API/subscription on company CC. |
| 4 | Anthropic Claude subscription receipt | `bill` | `CC` | NOT `Receipt`! Subscription on company CC. |
| 5 | Google Ads invoice | `bill` | `CC` | Auto-billed to company credit card. |
| 6 | Jayvee blog reimbursement | `reimbursement` | `Freelancer` | NOT `Payroll`! Jayvee is a freelancer. |
| 7 | Jamie Bonsay design payment | `reimbursement` | `Freelancer` | Jamie is a freelance designer. |
| 8 | Andrea reimbursement Anthropic Max | `reimbursement` | `Reimbursement` | `paymentMethod="Andrea CC"` — paid on Andrea's personal card. |
| 9 | Cathay Pacific flight ticket | `receipt` | `Reimbursement` | Travel expense being reimbursed. |
| 10 | WebWork workspace payment | `bill` | `CC` | SaaS/workspace tool. |
| 11 | Salary slip employee | `payroll` | `Payroll` | The only case where `sheetType=Payroll` is correct. |

---

## Section 6: Andrea's Feedback History

The current rules exist because Andrea (the accountant) reviewed early outputs and flagged these issues. Each fix is documented here so future maintainers know **why** the rules look the way they do.

### Issue 1: Cloudflare labeled as `Supplier`

- **What happened:** AI saw "Cloudflare, Inc." and labeled it `Supplier` because Cloudflare is a vendor.
- **Why wrong:** Cloudflare is a SaaS subscription auto-billed to the company credit card. `Supplier` in Andrea's spreadsheet is reserved for **bank-wire** vendors.
- **Fix:** Decision tree step 4 explicitly says "SaaS/cloud/online subscription → CC". Cloudflare is also listed by name in the prompt.

### Issue 2: Jayvee blog reimbursement labeled as `Payroll`

- **What happened:** AI saw "reimbursement" + "Jayvee" and labeled `sheetType=Payroll` because Jayvee was treated like an employee.
- **Why wrong:** Jayvee is a freelancer, not a payrolled employee. `Payroll` is reserved for actual salary payments.
- **Fix:** Category description for `payroll` now says "ONLY for actual salary/SSS/PhilHealth/Pag-IBIG (employees, not freelancers)". Decision tree step 3 routes any freelancer recipient to `Freelancer`. Example #6 lists this exact case.

### Issue 3: Many CC payments labeled as `Receipt`

- **What happened:** AI was returning `sheetType="Receipt"` whenever the document looked like a payment receipt (Cloudflare, GitHub, OpenAI, Anthropic, etc.).
- **Why wrong:** `Receipt` is **not a valid sheet type at all** in Andrea's spreadsheet. The sheet type column tracks HOW the expense was paid, not the document format.
- **Fix:**
  1. The list of valid sheet types in the prompt no longer includes `Receipt`.
  2. A bold "CRITICAL" warning explains that the document being a receipt does NOT mean `sheetType=Receipt`.
  3. Examples #1–4 each explicitly say "(NOT Receipt!)".
  4. **Safety net:** `parseAIResponse()` rewrites any stray `sheetType="Receipt"` to `"CC"`.

### Issue 4: Reimbursement Debit column was filled

- **What happened:** When writing reimbursements to the spreadsheet, the pipeline was filling the Debit column with the amount.
- **Why wrong:** Andrea's reimbursement sheet does not use the Debit column for the expense — that column is reserved for something else, and filling it broke her totals.
- **Fix:** The sheet writer now skips the Debit column for reimbursement rows. (See the sheet writer in `src/lib/sheets/`.)

### Issue 5: Receipt links not loading

- **What happened:** Links to source receipts in the spreadsheet were not opening — they pointed at internal pipeline URLs that required auth.
- **Why wrong:** Andrea needs to click the link from the spreadsheet and immediately see the receipt PDF/image.
- **Fix:** Links now use **Google Drive direct links** (`https://drive.google.com/file/d/<id>/view`) and the file's sharing permissions are set to **public download**, so anyone with the link can open it without signing in.

---

## Section 7: How to Update Rules

When Andrea flags a new issue, the workflow is:

### 1. Edit the prompt

All AI rules live in **one function**: `buildPrompt()` in [`src/lib/ai-categorize.ts`](../src/lib/ai-categorize.ts).

Typical edits:

- **New category nuance** → add a bullet under the `CATEGORY:` section.
- **New sheetType rule** → add a bullet under `SHEET TYPE` and (if order matters) a step in the `DECISION TREE`.
- **New edge case** → add a line to the `EXAMPLES` block. The model strongly pattern-matches examples, so this is the most reliable lever.
- **New vendor mapping** → name the vendor explicitly in the relevant rule (e.g. add "WebWork" to the SaaS list).

If the rule needs to be enforced even when the model ignores it, also add a normalization in `parseAIResponse()` (see how `sheetType="Receipt"` is rewritten to `"CC"`).

### 2. Update this document

Mirror the change in this `AI-RULES.md` so the human-readable rules stay in sync. Add a new entry to **Section 6: Andrea's Feedback History** explaining what went wrong and how it was fixed.

### 3. Reset and re-categorize the pipeline

Once the prompt is updated, existing rows in the database still have the old (wrong) categorization. To re-run:

```bash
# Reset the categorization state for affected files
npm run pipeline:reset

# Re-run the categorization step
npm run pipeline:categorize
```

(Or use whatever reset/re-categorize entry points your environment exposes — see the pipeline scripts in `package.json` and `src/pipeline/`.)

### 4. Spot-check Andrea's spreadsheet

After re-categorization completes, open the expense spreadsheet and verify:

- The previously-broken rows now have the correct `Type` column.
- No new rows have `sheetType="Receipt"`.
- Reimbursement rows have the Debit column empty.
- Receipt links open directly without an auth prompt.

If anything is still wrong, loop back to step 1.
