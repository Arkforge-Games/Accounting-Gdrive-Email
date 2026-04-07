import type { SyncFile } from "./types";
import type { CategoryKey } from "./categorize";

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || "";
const MODEL = process.env.AI_MODEL || "qwen/qwen3.6-plus-preview:free";

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

SHEET TYPE (the most important field — Andrea's rules):
- "Supplier" = ONLY traditional vendor invoices paid via bank transfer (NOT credit card)
- "CC" = ANY expense charged to a credit card (Cloudflare, AWS, SaaS subscriptions, Google Ads)
  → IMPORTANT: SaaS/cloud/online subscriptions are usually CC, not Supplier
- "Cash" = paid in physical cash
- "Reimbursement" = employee reimbursement (Andrea de Vera personal expenses)
- "Freelancer" = freelancer/contractor payment (Jamie Bonsay, Jayvee, etc.) — NOT payroll
- "Freelancer - Reimbursement" = freelancer reimbursing for something
- "Staff" = staff/employee expense (NOT freelancer, NOT payroll)
- "Payroll" = ONLY actual salary/wage payments to employees
- "Invoice" = receivable invoice (money coming in)

EXAMPLES:
- "Cloudflare domain" → category=bill, sheetType=CC, paymentMethod="Credit Card"
- "Jayvee blog reimbursement" → category=reimbursement, sheetType=Freelancer (NOT Payroll)
- "Andrea reimbursement Anthropic" → category=reimbursement, sheetType=Reimbursement, paymentMethod="Andrea CC"
- "Cathay Pacific flight ticket" → category=receipt, sheetType=Reimbursement (it's an expense to reimburse)
- "Jamie Bonsay design payment" → category=reimbursement, sheetType=Freelancer
- "Google Ads invoice" → category=bill, sheetType=CC, paymentMethod="Credit Card"

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

    return {
      category: validCategories.includes(parsed.category) ? parsed.category : "uncategorized",
      sheetType: parsed.sheetType || null,
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
