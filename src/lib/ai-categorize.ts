import type { SyncFile } from "./types";
import type { CategoryKey } from "./categorize";

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || "";
const MODEL = "google/gemini-2.5-flash-preview-05-20";

interface AICategorizeResult {
  category: CategoryKey;
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
  "vendor": extracted vendor/company name or null,
  "amount": total amount as string (e.g. "224.00") or null,
  "currency": "USD", "HKD", "PHP", "SGD", "MYR", "IDR", "EUR", "GBP" or null,
  "description": one-line summary of what this document is (e.g. "Claude API subscription receipt for March 2026"),
  "confidence": "high", "medium", or "low"
}

Rules:
- "junk" = email bounce notifications, delivery failure icons, tracking pixels, system emails, non-accounting files
- "invoice" = sales invoices sent TO customers (accounts receivable)
- "bill" = invoices received FROM suppliers (accounts payable)
- "receipt" = payment confirmations, OR receipts, transaction receipts
- "reimbursement" = employee expense claims, reimbursement requests
- "payroll" = salary slips, SSS/PhilHealth/Pag-IBIG, payroll sheets
- If unsure, use "uncategorized"`;

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
      vendor: null,
      amount: null,
      currency: null,
      description: null,
      confidence: "low",
    };
  }
}
