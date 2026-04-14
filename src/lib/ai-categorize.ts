/**
 * AI Categorization via OpenRouter
 *
 * Sends file metadata + email body + PDF text to an LLM and extracts:
 * - category (invoice, bill, receipt, etc.)
 * - sheetType (CC, Reimbursement, Freelancer, Supplier, etc. — Andrea's rules)
 * - paymentMethod (Andrea CC, Credit Card, Bank, Cash)
 * - vendor, amount, currency, description
 *
 * The system prompt contains Andrea's accounting rules (see docs/AI-RULES.md).
 *
 * Model is configurable via AI_MODEL env var. Default: openai/gpt-oss-120b:free
 */
import type { SyncFile } from "./types";
import type { CategoryKey } from "./categorize";

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || "";
const MODEL = process.env.AI_MODEL || "openai/gpt-oss-120b:free";

interface AICategorizeResult {
  category: CategoryKey;
  sheetType: string | null;
  paymentMethod: string | null;
  vendor: string | null;
  amount: string | null;
  currency: string | null;
  description: string | null;
  /** Transaction date from PDF/body in ISO format YYYY-MM-DD (e.g. "2025-12-05"). NOT the email forward date. */
  transactionDate: string | null;
  /** Invoice/receipt reference number (e.g. "IN 52791905"). */
  invoiceNumber: string | null;
  confidence: "high" | "medium" | "low";
}

export function isAIConfigured(): boolean {
  return !!OPENROUTER_KEY;
}

/**
 * Categorize a single file using AI.
 *
 * @param file - File metadata (name, mime, source, email subject/from, etc.)
 * @param emailBody - Optional plain text body of the linked email
 * @param pdfText - Optional extracted text from PDF content
 * @returns AI's classification with category, sheetType, paymentMethod, amount, etc.
 *
 * @example
 * const result = await aiCategorizeFile(file, "...", "...");
 * // { category: "bill", sheetType: "CC", paymentMethod: "Credit Card",
 * //   vendor: "Cloudflare, Inc.", amount: "9.77", currency: "USD", ... }
 */
export async function aiCategorizeFile(
  file: SyncFile,
  emailBody?: string | null,
  pdfText?: string | null,
): Promise<AICategorizeResult> {
  const prompt = buildPrompt(file, emailBody, pdfText);

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: `You are an accounting document classifier for HobbyLand Technology Limited (Hong Kong company). Classify documents into exactly one category and extract key info. Respond ONLY with valid JSON, no markdown.`,
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 400,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "";

  return parseAIResponse(content);
}

export async function aiCategorizeBatch(
  files: { file: SyncFile; emailBody?: string | null; pdfText?: string | null }[],
): Promise<Map<string, AICategorizeResult>> {
  const results = new Map<string, AICategorizeResult>();

  // Process in parallel batches of 5
  const BATCH_SIZE = 5;
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async ({ file, emailBody, pdfText }) => {
      try {
        const result = await aiCategorizeFile(file, emailBody, pdfText);
        results.set(file.id, result);
      } catch (err) {
        console.error(`[AI] Failed to categorize ${file.name}:`, err instanceof Error ? err.message : err);
      }
    });
    await Promise.all(promises);
  }

  return results;
}

function buildPrompt(file: SyncFile, emailBody?: string | null, pdfText?: string | null): string {
  let prompt = `Classify this accounting document:

Filename: ${file.name}
Type: ${file.mimeType}
Date: ${file.date}
Source: ${file.source}`;

  if (file.emailSubject) prompt += `\nEmail Subject: ${file.emailSubject}`;
  if (file.emailFrom) prompt += `\nEmail From: ${file.emailFrom}`;
  if (file.folder) prompt += `\nFolder: ${file.folder}`;

  if (emailBody) {
    const trimmed = emailBody.substring(0, 1500).trim();
    if (trimmed.length > 20) prompt += `\nEmail Body:\n${trimmed}`;
  }

  if (pdfText) {
    const trimmed = pdfText.substring(0, 2000).trim();
    if (trimmed.length > 20) prompt += `\nPDF Content:\n${trimmed}`;
  }

  prompt += `

Respond with JSON:
{
  "category": one of: "invoice", "bill", "receipt", "payroll", "tax", "bank_statement", "contract", "reimbursement", "permit", "quotation", "junk", "uncategorized",
  "sheetType": one of: "Invoice", "Supplier", "CC", "Cash", "Reimbursement", "Freelancer", "Freelancer - Reimbursement", "Staff", "Payroll" — this maps to the expense sheet's Type column,
  "paymentMethod": one of: "Andrea CC", "Credit Card", "Bank", "Cash", "Wise", "PayPal" — how it was paid,
  "vendor": extracted vendor/company name (e.g. "Cloudflare, Inc."),
  "amount": total amount as string (e.g. "224.00") or null,
  "currency": "USD", "HKD", "PHP", "SGD", "MYR", "IDR", "EUR", "GBP" or null,
  "description": one-line summary (e.g. "Claude API subscription receipt for March 2026"),
  "transactionDate": "YYYY-MM-DD" — the actual date on the invoice/receipt (NOT the email date). Look for "Date of issue", "Invoice date", "Date", "Receipt date", "Paid on", etc. If you see "December 5, 2025", return "2025-12-05". null if you cannot find it.,
  "invoiceNumber": invoice/receipt reference number as it appears on the document (e.g. "IN 52791905", "INV-2024-0042", "1B7K-DTKE"). null if not present.,
  "confidence": "high", "medium", or "low"
}

⚠️ transactionDate is CRITICAL. Andrea forwards old invoices/receipts to be recorded — the email forward date is NOT useful. The PDF has the real transaction date. Always extract it.

CRITICAL RULES (from accountant Andrea):

SUBJECT KEYWORD OVERRIDE (highest priority — overrides PDF content):
- If Email Subject contains "reimburs" → category MUST be "reimbursement"
  → If subject names a freelancer (Jamie/Jayvee/JM/Murphy/Aarati) → sheetType="Freelancer", paymentMethod="Bank"
  → Otherwise → sheetType="Reimbursement", paymentMethod="Andrea CC"
- If Email Subject contains "payroll" or "salary slip" → category="payroll", sheetType="Payroll"
- The subject is authoritative because Andrea labels her forwards intentionally.
  Do NOT classify based on PDF content if the subject already tells you the type.

CATEGORY:
- "junk" = email bounces, delivery failures, tracking pixels, system emails
- "invoice" = sales invoices SENT TO customers (accounts receivable, money coming IN)
- "bill" = invoices/expenses FROM suppliers (accounts payable, money going OUT)
- "receipt" = payment confirmations, OR receipts, transaction receipts
- "reimbursement" = employee/freelancer expense claims being repaid
- "payroll" = ONLY for actual salary/SSS/PhilHealth/Pag-IBIG (employees, not freelancers)
- "tax" = BIR forms, tax returns, withholding certificates
- "bank_statement" = monthly bank statements

SHEET TYPE — DETERMINED BY HOW IT WAS PAID, NOT THE DOCUMENT TYPE:

⚠️ CRITICAL: "Receipt" is NOT a valid sheet type. NEVER use sheetType="Receipt".
The document being a receipt does NOT mean sheetType=Receipt. The sheet type is about HOW it was PAID:

- "CC" = paid by COMPANY credit card (Cloudflare, AWS, GitHub, OpenAI billed to company, Google Ads, SaaS subscriptions)
  → If a vendor charges your credit card automatically (subscription, monthly billing), it's CC
  → SaaS/cloud/online services are almost always CC
- "Reimbursement" = paid by EMPLOYEE personally (Andrea de Vera) and being reimbursed
  → If the email/PDF is forwarded by Andrea or to admin@hobbyland-group.com from Andrea's personal payment, it's Reimbursement
- "Freelancer" = payment to a freelancer/contractor (Jamie Bonsay, Jayvee, JM, Murphy, Aarati)
- "Freelancer - Reimbursement" = freelancer reimbursing for something on behalf of company
- "Staff" = staff/employee expense (NOT freelancer, NOT payroll)
- "Payroll" = ACTUAL salary/wage payments only (not reimbursements, not freelancer payments)
- "Supplier" = bank transfer to traditional supplier (NOT credit card, NOT subscription)
- "Cash" = paid in physical cash
- "Invoice" = sales invoice we sent to a customer (money coming in)

DECISION TREE for sheetType:
1. Is this money we're RECEIVING from a customer? → Invoice
2. Was it paid by Andrea's personal CC and being reimbursed? → Reimbursement
3. Is the recipient a freelancer (Jamie/Jayvee/Aarati/etc.)? → Freelancer
4. Is it a SaaS/cloud/online subscription (Cloudflare/GitHub/AWS/OpenAI/Anthropic/Google Ads)? → CC
5. Is it auto-billed to a company credit card? → CC
6. Is it a bank wire to a supplier with an invoice? → Supplier
7. Is it cash? → Cash
8. Is it salary to a payrolled employee? → Payroll

EXAMPLES (CRITICAL — STUDY THESE):
- "Cloudflare domain receipt" → category=bill, sheetType=CC (NOT Receipt!)
- "GitHub Payment Receipt" → category=bill, sheetType=CC (NOT Receipt!)
- "OpenAI receipt" → category=bill, sheetType=CC (NOT Receipt!)
- "Anthropic Claude subscription receipt" → category=bill, sheetType=CC (NOT Receipt!)
- "Google Ads invoice" → category=bill, sheetType=CC
- "Jayvee blog reimbursement" → category=reimbursement, sheetType=Freelancer (NOT Payroll!)
- "Jamie Bonsay design payment" → category=reimbursement, sheetType=Freelancer
- "Andrea reimbursement Anthropic Max" → category=reimbursement, sheetType=Reimbursement, paymentMethod="Andrea CC"
- "Cathay Pacific flight ticket" → category=receipt, sheetType=Reimbursement (it's a travel expense being reimbursed)
- "WebWork workspace payment" → category=bill, sheetType=CC
- "Salary slip employee" → category=payroll, sheetType=Payroll

CURRENCY:
- Be careful with currency detection — look at the symbol AND the amount carefully
- If you see "$" without context, default to USD unless the document is from HK (then HKD)
- If you see "₱" or "PHP", that's Philippine Peso
- If you see "HK$", that's Hong Kong Dollar

PAYMENT METHOD:
- "Andrea CC" = Andrea's personal credit card (used for reimbursements)
- "Credit Card" = company credit card (used for CC expenses)
- "Bank" = bank transfer (used for Supplier, Freelancer)
- "Cash" = paid in cash

If unsure, use "uncategorized" but try hard to match the rules above.`;

  return prompt;
}

// ===== Xero account code categorization =====
//
// Andrea's April 2026 checklist item #1 (v2): when auto-creating a Xero bank
// transaction from a bank statement line, we need to pick the right "What"
// (chart-of-accounts code). This function takes a bank statement narration
// and a list of available accounts, and asks AI to pick the best one.

export interface AccountChoice {
  Code: string;
  Name: string;
  Type: string;        // "EXPENSE" | "REVENUE" | "DIRECTCOSTS" | etc.
  Description?: string;
}

export interface AccountPickResult {
  accountCode: string;
  contactName: string;
  description: string;
  confidence: "high" | "medium" | "low";
}

/**
 * Pick a Xero chart-of-accounts code for a bank statement line via AI.
 *
 * @param statementLine The bank narration text (e.g. "CHEQUE DEPOSIT LEARNING B LE..")
 * @param amount        The transaction amount
 * @param direction     "RECEIVE" (money in) or "SPEND" (money out)
 * @param accounts      The list of valid Xero accounts to pick from
 * @returns The picked account code, suggested contact name, and description
 */
export async function aiPickAccountCode(
  statementLine: string,
  amount: number,
  direction: "RECEIVE" | "SPEND",
  accounts: AccountChoice[],
): Promise<AccountPickResult> {
  // Filter to only accounts that make sense given the direction.
  // SPEND → expenses + direct costs + fixed assets (we're paying out)
  // RECEIVE → revenue + other income (we're receiving)
  const relevantTypes = direction === "SPEND"
    ? ["EXPENSE", "DIRECTCOSTS", "OVERHEADS", "FIXED", "CURRLIAB", "TERMLIAB", "DEPRECIATN"]
    : ["REVENUE", "SALES", "OTHERINCOME", "CURRENT"];

  const filtered = accounts.filter(a =>
    relevantTypes.some(t => (a.Type || "").toUpperCase().includes(t))
  );
  // If filtering returned nothing, fall back to all accounts
  const choices = filtered.length > 0 ? filtered : accounts;

  // Build a compact list for the prompt
  const accountList = choices
    .map(a => `${a.Code} - ${a.Name}${a.Description ? " (" + a.Description.substring(0, 60) + ")" : ""}`)
    .join("\n");

  const prompt = `You are categorizing a bank statement line for HobbyLand Technology Limited's Xero accounting.

BANK STATEMENT LINE:
  Narration: ${statementLine}
  Amount: ${amount}
  Direction: ${direction === "SPEND" ? "Money OUT (we paid)" : "Money IN (we received)"}

AVAILABLE XERO ACCOUNTS (chart of accounts):
${accountList}

Pick the BEST matching account code from the list above. Use these rules:
- For SPEND: pick the expense/cost category (e.g. "489 Telephone & Internet" for a Cloudflare charge, "400 Advertising" for Google Ads, "477 Wages and Salaries" for payroll, "313 Service provider-Operations" for freelancer work, "404 Bank Fees" for fee charges).
- For RECEIVE: pick the income category (e.g. "200 Sales" for customer payments, "260 Other Revenue" for misc income, "270 Interest Income" for bank interest).
- Bank fees, transaction fees, FX charges → "404 Bank Fees"
- SaaS subscriptions (Cloudflare, GitHub, OpenAI, Anthropic, AWS) → "489 Telephone & Internet" or "423 Computer expenses" (prefer the latter for software/cloud)
- Domain renewals → "423 Computer expenses"
- Google Ads → "400 Advertising"

Respond with JSON only, no markdown:
{
  "accountCode": "the picked code as a string e.g. \\"489\\"",
  "contactName": "extracted vendor/customer name from narration (e.g. \\"Cloudflare, Inc.\\" or \\"HSBC\\") or empty string",
  "description": "one-line description for the Xero entry (e.g. \\"Bank fee\\" or \\"Cloudflare domain renewal\\")",
  "confidence": "high|medium|low"
}`;

  if (!OPENROUTER_KEY) {
    return { accountCode: "479", contactName: "", description: statementLine.substring(0, 80), confidence: "low" }; // 479 = Sundry
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: "You are a careful accounting categorizer. Respond ONLY with valid JSON, no markdown." },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 200,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "";

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const json = jsonMatch ? jsonMatch[0] : content;
    const parsed = JSON.parse(json);
    // Validate the picked code is actually in the list
    const validCodes = new Set(choices.map(c => c.Code));
    let pickedCode = String(parsed.accountCode || "").trim();
    if (!validCodes.has(pickedCode)) {
      // AI hallucinated a code — fall back to a sensible default
      pickedCode = direction === "SPEND" ? "479" : "260"; // Sundry expenses / Other Revenue
    }
    return {
      accountCode: pickedCode,
      contactName: String(parsed.contactName || "").trim(),
      description: String(parsed.description || statementLine).trim().substring(0, 200),
      confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "medium",
    };
  } catch {
    return {
      accountCode: direction === "SPEND" ? "479" : "260",
      contactName: "",
      description: statementLine.substring(0, 80),
      confidence: "low",
    };
  }
}

function parseAIResponse(content: string): AICategorizeResult {
  // Extract JSON from response (handle markdown code blocks)
  let json = content;
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) json = jsonMatch[0];

  try {
    const parsed = JSON.parse(json);

    const validCategories: CategoryKey[] = [
      "invoice", "bill", "receipt", "payroll", "tax", "bank_statement",
      "contract", "reimbursement", "permit", "quotation", "junk", "uncategorized",
    ];

    // Andrea's rule: "Receipt" is NOT a valid sheet type. Convert it to CC.
    let sheetType = parsed.sheetType || null;
    if (sheetType === "Receipt") sheetType = "CC";

    // Normalize transactionDate — accept various formats and convert to YYYY-MM-DD
    let transactionDate: string | null = null;
    if (parsed.transactionDate) {
      const raw = String(parsed.transactionDate).trim();
      // Already ISO format YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        transactionDate = raw;
      } else {
        // Try to parse other formats (Date constructor handles "December 5, 2025", "Dec 5, 2025", "12/5/2025", etc.)
        const d = new Date(raw);
        if (!isNaN(d.getTime())) {
          transactionDate = d.toISOString().substring(0, 10);
        }
      }
    }

    // Normalize all whitespace in extracted fields — PDFs often contain non-breaking
    // spaces (U+00A0) which look identical but make text unsearchable in Google Sheets.
    const normalizeWs = (s: string | null) => s ? s.replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ").trim() : null;

    return {
      category: validCategories.includes(parsed.category) ? parsed.category : "uncategorized",
      sheetType,
      paymentMethod: parsed.paymentMethod || null,
      vendor: normalizeWs(parsed.vendor),
      amount: parsed.amount || null,
      currency: parsed.currency || null,
      description: normalizeWs(parsed.description),
      transactionDate,
      invoiceNumber: normalizeWs(parsed.invoiceNumber),
      confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "medium",
    };
  } catch {
    console.error("[AI] Failed to parse response:", content.substring(0, 200));
    return {
      category: "uncategorized",
      sheetType: null,
      paymentMethod: null,
      vendor: null,
      amount: null,
      currency: null,
      description: null,
      transactionDate: null,
      invoiceNumber: null,
      confidence: "low",
    };
  }
}
