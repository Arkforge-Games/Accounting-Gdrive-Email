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
      max_tokens: 300,
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
  "confidence": "high", "medium", or "low"
}

CRITICAL RULES (from accountant Andrea):

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

    return {
      category: validCategories.includes(parsed.category) ? parsed.category : "uncategorized",
      sheetType,
      paymentMethod: parsed.paymentMethod || null,
      vendor: parsed.vendor || null,
      amount: parsed.amount || null,
      currency: parsed.currency || null,
      description: parsed.description || null,
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
      confidence: "low",
    };
  }
}
