/**
 * AccountSync Autonomous Pipeline
 *
 * Runs every hour (retry) and daily at 6PM (full sync). Processes new files
 * through: scan → categorize (rules → AI) → extract amount → check duplicate
 * → record to Google Sheet → create DRAFT in Xero → log everything.
 *
 * See docs/PIPELINE.md for full documentation.
 */
import * as db from "./db";
import { categorizeFile, extractAmountFromBody } from "./categorize";
import { isAIConfigured, aiCategorizeFile } from "./ai-categorize";
import { appendPayableRow, appendReceivableRow, getPayables, getReceivables } from "./sheets";

/** Sleep helper to throttle Google Sheets writes (max 60/min) */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Categories that get recorded to the Payable tab */
const PAYABLE_CATEGORIES = new Set(["bill", "reimbursement", "receipt", "payroll"]);

/**
 * Vendors known to be auto-billed to a company credit card.
 * If a payable matches one of these, sheetType is forced to "CC" and
 * paymentMethod to "Credit Card" — even if the rule-based categorizer
 * returned "receipt" (which would otherwise yield the invalid sheetType
 * "Receipt"). See ai-categorize.ts CRITICAL RULES.
 */
const SAAS_CC_VENDORS = /anthropic|claude|openai|github|cloudflare|vercel|netlify|aws|amazon\s*web|azure|microsoft|google|gcp|workspace|digital\s*ocean|hostinger|namecheap|godaddy|alibaba|alicloud|hetzner|vultr|linode|figma|canva|notion|slack|zoom|webwork|stripe|paypal|appsumo/i;

function isSaasCcVendor(file: { vendor?: string | null; emailSubject?: string | null; emailFrom?: string | null; name?: string }): boolean {
  return SAAS_CC_VENDORS.test(file.vendor || "")
    || SAAS_CC_VENDORS.test(file.emailSubject || "")
    || SAAS_CC_VENDORS.test(file.emailFrom || "")
    || SAAS_CC_VENDORS.test(file.name || "");
}

/** Categories that get recorded to the Receivable tab */
const RECEIVABLE_CATEGORIES = new Set(["invoice"]);

/** Categories the pipeline skips (won't record to sheets) */
const SKIP_CATEGORIES = new Set(["junk", "uncategorized", "contract", "permit", "quotation", "bank_statement", "tax"]);

export interface PipelineResult {
  runId: string;
  filesProcessed: number;
  categorized: number;
  aiCategorized: number;
  recorded: number;
  xeroCreated: number;
  duplicates: number;
  skipped: number;
  errors: number;
  details: string[];
}

/**
 * Runs the complete autonomous pipeline.
 *
 * Flow:
 *   1. Scan for unrecorded files (status != 'recorded')
 *   2. For each file:
 *      a. If uncategorized → run rule-based categorize
 *      b. If still uncategorized → run AI categorize (extracts vendor, amount, type)
 *      c. Extract amount from email body if missing
 *      d. Skip if junk/uncategorized
 *      e. Check duplicate against existing sheet rows
 *      f. Record to Payable or Receivable tab in Google Sheet
 *      g. Auto-create DRAFT bill/invoice in Xero
 *   3. Log every action to pipeline_log table
 *   4. Throttle: 1.2s between Sheets writes (avoids 60/min quota)
 *
 * @returns Summary of files processed, recorded, duplicates, errors
 */
export async function runPipeline(): Promise<PipelineResult> {
  const runId = crypto.randomUUID();
  const result: PipelineResult = {
    runId, filesProcessed: 0, categorized: 0, aiCategorized: 0,
    recorded: 0, xeroCreated: 0, duplicates: 0, skipped: 0, errors: 0, details: [],
  };

  db.logPipeline({ runId, action: "pipeline_start", status: "success", details: "Pipeline run started" });

  try {
    // Step 1: Get all unrecorded files
    const unrecorded = db.getUnrecordedFiles();
    result.filesProcessed = unrecorded.length;
    db.logPipeline({ runId, action: "scan", status: "success", details: `Found ${unrecorded.length} unrecorded files` });

    if (unrecorded.length === 0) {
      db.logPipeline({ runId, action: "pipeline_end", status: "success", details: "No files to process" });
      return result;
    }

    // Load existing sheet data for duplicate checking
    let existingPayables: { supplierName: string; invoiceNumber: string; paymentAmount: string; jobDate: string }[] = [];
    let existingReceivables: { invoiceNumber: string; clientName: string; paymentAmount: string }[] = [];
    try {
      existingPayables = await getPayables();
      existingReceivables = await getReceivables();
    } catch (err) {
      db.logPipeline({ runId, action: "sheet_load", status: "error", error: err instanceof Error ? err.message : "Failed to load sheets" });
    }

    // Group unrecorded files by email so multi-attachment emails produce ONE row.
    // Files not from an email (gdrive uploads, manual uploads) get their own group.
    const groups = groupByEmail(unrecorded);

    // Step 2: Process each GROUP (not each file). All files in a group share the
    // same category/sheetType/vendor/amount and produce a single Sheet row.
    for (const group of groups) {
      const file = group[0]; // representative file (first attachment)
      const siblings = group.slice(1);
      try {
        // 2a-pre: SUBJECT KEYWORD OVERRIDE — runs before any other categorization.
        // Andrea labels her forwards intentionally. If the email subject says
        // "reimburs", that is authoritative regardless of what the PDF contents say.
        const subjectLower = (file.emailSubject || "").toLowerCase();
        if (subjectLower.includes("reimburs") && file.category !== "reimbursement") {
          const freelancerMatch = (file.emailSubject || "").match(/jamie|jayvee|\bjm\b|murphy|aarati/i);
          const isFreelancer = !!freelancerMatch;
          const sheetType = isFreelancer ? "Freelancer" : "Reimbursement";
          const paymentMethod = isFreelancer ? "Bank" : "Andrea CC";
          db.upsertFileIndex({
            fileId: file.id,
            category: "reimbursement",
            period: file.date?.substring(0, 7),
            autoCategorized: true,
          });
          db.updateFileIndex(file.id, { sheetType, paymentMethod });
          file.category = "reimbursement";
          file.sheetType = sheetType;
          file.paymentMethod = paymentMethod;
          result.categorized++;
          db.logPipeline({ runId, fileId: file.id, action: "categorize_subject_override", status: "success", result: "reimbursement", details: `Subject contained "reimburs"; sheetType=${sheetType}` });
        }

        // 2a: Ensure categorized
        if (file.category === "uncategorized" || !file.category) {
          // Try rule-based first
          const ruleResult = categorizeFile(file);
          if (ruleResult.category !== "uncategorized") {
            db.upsertFileIndex({
              fileId: file.id, category: ruleResult.category, period: ruleResult.period,
              vendor: ruleResult.vendor || undefined, autoCategorized: true,
            });
            file.category = ruleResult.category;
            file.vendor = ruleResult.vendor;
            result.categorized++;
            db.logPipeline({ runId, fileId: file.id, action: "categorize_rule", status: "success", result: ruleResult.category });
          } else if (isAIConfigured()) {
            // Try AI categorize
            try {
              const emailBody = db.getEmailBodyForFile(file.id);
              let pdfText: string | null = null;
              if (file.mimeType.includes("pdf")) {
                try {
                  const fileData = db.getFileContent(file.id);
                  if (fileData) {
                    // eslint-disable-next-line @typescript-eslint/no-require-imports
                    const pdfParse = require("pdf-parse");
                    const parsed = await pdfParse(Buffer.from(fileData.content));
                    pdfText = parsed.text || null;
                  }
                } catch { /* skip pdf parse errors */ }
              }

              const aiResult = await aiCategorizeFile(file, emailBody, pdfText);
              db.upsertFileIndex({
                fileId: file.id, category: aiResult.category, period: file.date?.substring(0, 7),
                vendor: aiResult.vendor || undefined, autoCategorized: true,
              });
              if (aiResult.amount) db.updateFileIndex(file.id, { amount: aiResult.amount, currency: aiResult.currency || undefined });
              if (aiResult.description) db.updateFileIndex(file.id, { notes: aiResult.description });
              // Save AI's sheet type and payment method (Andrea's required fields)
              if (aiResult.sheetType) db.updateFileIndex(file.id, { sheetType: aiResult.sheetType });
              if (aiResult.paymentMethod) db.updateFileIndex(file.id, { paymentMethod: aiResult.paymentMethod });
              // Flag low-confidence for human review
              if (aiResult.confidence === "low") db.updateFileIndex(file.id, { needsReview: true, reviewNotes: "Low AI confidence" });

              file.category = aiResult.category;
              file.vendor = aiResult.vendor;
              file.amount = aiResult.amount;
              result.aiCategorized++;
              db.logPipeline({ runId, fileId: file.id, action: "categorize_ai", status: "success", result: aiResult.category, details: aiResult.description || undefined });
            } catch (err) {
              db.logPipeline({ runId, fileId: file.id, action: "categorize_ai", status: "error", error: err instanceof Error ? err.message : "AI failed" });
            }
          }
        }

        // 2b: Extract amount if missing
        if (!file.amount && file.category !== "junk") {
          const emailBody = db.getEmailBodyForFile(file.id);
          if (emailBody) {
            const extracted = extractAmountFromBody(emailBody);
            if (extracted) {
              db.updateFileIndex(file.id, { amount: extracted.amount, currency: extracted.currency });
              file.amount = extracted.amount;
            }
          }
        }

        // 2c: Skip categories that shouldn't be recorded
        if (SKIP_CATEGORIES.has(file.category)) {
          db.logPipeline({ runId, fileId: file.id, action: "record", status: "skipped", details: `Category: ${file.category}` });
          result.skipped++;
          continue;
        }

        // 2d: Check for duplicates before recording
        if (isDuplicate(file, existingPayables, existingReceivables)) {
          db.logPipeline({ runId, fileId: file.id, action: "record", status: "duplicate", details: `Duplicate detected: ${file.vendor} ${file.amount}` });
          result.duplicates++;
          continue;
        }

        // 2e: SPARSE-ROW GUARD — refuse to write rows missing essential fields.
        // Andrea hates half-empty rows. Flag for human review instead.
        const missing: string[] = [];
        if (!file.amount) missing.push("amount");
        if (!file.vendor) missing.push("vendor");
        if (!file.date) missing.push("date");
        if (missing.length > 0) {
          db.updateFileIndex(file.id, { needsReview: true, reviewNotes: `Missing required fields: ${missing.join(", ")}` });
          db.logPipeline({ runId, fileId: file.id, action: "record", status: "needs_review", details: `Missing: ${missing.join(", ")}` });
          // Mark siblings as needing review too so they don't reprocess every hour
          for (const sib of siblings) {
            db.updateFileIndex(sib.id, { needsReview: true, reviewNotes: `Missing required fields: ${missing.join(", ")}` });
            db.logPipeline({ runId, fileId: sib.id, action: "record", status: "needs_review", details: `Sibling of ${file.id}; missing: ${missing.join(", ")}` });
          }
          result.skipped++;
          continue;
        }

        // Build the receipt link cell — concatenate all attachment links from this email
        const allLinks = [file, ...siblings].map(getReceiptLink).filter(Boolean);
        const receiptLink = allLinks.join("\n");

        try {
          if (PAYABLE_CATEGORIES.has(file.category)) {
            // Determine sheetType. Order of precedence:
            //  1. Subject override already set sheetType (reimbursement) → keep it
            //  2. Known SaaS/CC vendor → "CC" (overrides AI/rule; Cloudflare/GitHub/etc)
            //  3. AI's explicit sheetType (already validated, "Receipt" → "CC")
            //  4. Fallback formatType from category
            const isCC = file.category !== "reimbursement" && isSaasCcVendor(file);
            const sheetType = file.sheetType
              || (isCC ? "CC" : formatType(file.category));
            const paymentMethod = file.paymentMethod
              || (isCC ? "Credit Card" : (file.category === "reimbursement" ? "Andrea CC" : "Bank"));
            await appendPayableRow({
              jobDate: formatDate(file.date),
              type: sheetType,
              receiptLink,
              supplierName: file.vendor || "Unknown",
              invoiceNumber: file.referenceNo || "",
              fullName: file.category === "reimbursement" ? "Andrea de Vera" : "",
              jobDetails: file.notes || "",
              paymentAmount: file.amount ? `${file.currency} ${file.amount}` : "",
              paymentStatus: "Pending",
              paymentMethod,
              account: "HobbyLand",
              receiptCreated: "TRUE",
            });
            db.logPipeline({ runId, fileId: file.id, action: "record", status: "success", result: "payable", details: `${file.vendor} ${file.currency} ${file.amount}${siblings.length > 0 ? ` (+${siblings.length} attachments)` : ""}` });
            // Mark all siblings as recorded so they don't reprocess
            for (const sib of siblings) {
              db.logPipeline({ runId, fileId: sib.id, action: "record", status: "success", result: "payable", details: `Merged into row for ${file.id}` });
            }
            result.recorded++;
            await sleep(1200); // Throttle: max ~50 writes/min to stay under Google Sheets 60/min limit

            // Xero bill creation DISABLED per Andrea (2026-04-07): "We don't need to
            // create any bills or invoices, only reconciliation for now."
            // Pipeline records to Google Sheets only; Xero is read-only for now.
          } else if (RECEIVABLE_CATEGORIES.has(file.category)) {
            await appendReceivableRow({
              jobDate: formatDate(file.date),
              type: "Invoice",
              receiptLink,
              clientName: file.vendor || "Unknown",
              invoiceNumber: file.referenceNo || "",
              paymentAmount: file.amount ? `${file.currency} ${file.amount}` : "",
              paymentStatus: "Pending",
              paymentMethod: file.paymentMethod || "Bank",
              account: "HobbyLand",
              receiptCreated: "TRUE",
            });
            db.logPipeline({ runId, fileId: file.id, action: "record", status: "success", result: "receivable", details: `${file.vendor} ${file.currency} ${file.amount}${siblings.length > 0 ? ` (+${siblings.length} attachments)` : ""}` });
            for (const sib of siblings) {
              db.logPipeline({ runId, fileId: sib.id, action: "record", status: "success", result: "receivable", details: `Merged into row for ${file.id}` });
            }
            result.recorded++;
            await sleep(1200); // Throttle Google Sheets writes

            // Xero invoice creation DISABLED per Andrea (2026-04-07): "We don't need to
            // create any bills or invoices, only reconciliation for now."
          } else {
            db.logPipeline({ runId, fileId: file.id, action: "record", status: "skipped", details: `Unhandled category: ${file.category}` });
            result.skipped++;
          }
        } catch (err) {
          db.logPipeline({ runId, fileId: file.id, action: "record", status: "error", error: err instanceof Error ? err.message : "Sheet write failed" });
          result.errors++;
        }
      } catch (err) {
        db.logPipeline({ runId, fileId: file.id, action: "process", status: "error", error: err instanceof Error ? err.message : "Unknown error" });
        result.errors++;
      }
    }

    result.details.push(
      `Processed: ${result.filesProcessed}`,
      `Categorized (rules): ${result.categorized}`,
      `Categorized (AI): ${result.aiCategorized}`,
      `Recorded to sheets: ${result.recorded}`,
      `Xero created: ${result.xeroCreated}`,
      `Duplicates skipped: ${result.duplicates}`,
      `Skipped: ${result.skipped}`,
      `Errors: ${result.errors}`,
    );

    db.logPipeline({ runId, action: "pipeline_end", status: "success", details: result.details.join(" | ") });
    db.addActivity({ action: "sync", source: "pipeline", details: `Pipeline: ${result.recorded} recorded, ${result.duplicates} dupes, ${result.skipped} skipped, ${result.errors} errors`, fileCount: result.recorded });

  } catch (err) {
    db.logPipeline({ runId, action: "pipeline_end", status: "error", error: err instanceof Error ? err.message : "Pipeline crashed" });
    result.errors++;
  }

  return result;
}

function isDuplicate(
  file: db.IndexedFile,
  payables: { supplierName: string; invoiceNumber: string; paymentAmount: string; jobDate: string }[],
  receivables: { invoiceNumber: string; clientName: string; paymentAmount: string }[],
): boolean {
  const refNo = file.referenceNo || "";
  const vendor = (file.vendor || "").toLowerCase();
  const amount = file.amount ? parseFloat(file.amount) : 0;
  const fileDate = new Date(file.date).getTime();

  // Check payables
  for (const p of payables) {
    // Exact invoice number match
    if (refNo && p.invoiceNumber && p.invoiceNumber.includes(refNo)) return true;

    // Vendor + amount + date match
    if (vendor && p.supplierName?.toLowerCase().includes(vendor.substring(0, 5))) {
      const pAmount = parseFloat((p.paymentAmount || "0").replace(/[^0-9.]/g, "")) || 0;
      if (amount > 0 && pAmount > 0 && Math.abs(amount - pAmount) / pAmount < 0.05) {
        // Check date proximity (parse various date formats)
        const pDate = new Date(p.jobDate).getTime();
        if (!isNaN(pDate) && Math.abs(fileDate - pDate) < 7 * 86400000) return true;
      }
    }
  }

  // Check receivables
  for (const r of receivables) {
    if (refNo && r.invoiceNumber && r.invoiceNumber.includes(refNo)) return true;
  }

  return false;
}

function getReceiptLink(file: db.IndexedFile): string {
  // Google Drive files: use direct Drive link (no auth needed if shared)
  if (file.source === "gdrive" && file.id.startsWith("gdrive_")) {
    const driveId = file.id.replace("gdrive_", "");
    return `https://drive.google.com/file/d/${driveId}/view`;
  }
  // Email attachments: use our public download endpoint
  if (file.downloadUrl) {
    return `https://accounting.devehub.app${file.downloadUrl}`;
  }
  return "";
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Group unrecorded files by source email so multi-attachment emails produce
 * a single Sheet row instead of one row per PDF.
 *
 * Grouping key: lowercased emailSubject + emailFrom. Files without an email
 * source (gdrive uploads, manual uploads) get their own group of size 1.
 *
 * Within each email group, the file with the most data (amount > vendor > date)
 * is moved to the front so it becomes the "representative" used for classification
 * and sheet writing.
 */
function groupByEmail(files: db.IndexedFile[]): db.IndexedFile[][] {
  const groups = new Map<string, db.IndexedFile[]>();
  const standalone: db.IndexedFile[][] = [];

  for (const f of files) {
    const subj = (f.emailSubject || "").trim().toLowerCase();
    const from = (f.emailFrom || "").trim().toLowerCase();
    if (!subj && !from) {
      standalone.push([f]);
      continue;
    }
    const key = `${subj}|${from}`;
    const existing = groups.get(key);
    if (existing) existing.push(f);
    else groups.set(key, [f]);
  }

  // Sort each group so the file with the most extracted data comes first
  const result: db.IndexedFile[][] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => {
      const aScore = (a.amount ? 4 : 0) + (a.vendor ? 2 : 0) + (a.date ? 1 : 0);
      const bScore = (b.amount ? 4 : 0) + (b.vendor ? 2 : 0) + (b.date ? 1 : 0);
      return bScore - aScore;
    });
    result.push(group);
  }
  result.push(...standalone);
  return result;
}

function formatType(category: string): string {
  switch (category) {
    case "reimbursement": return "Reimbursement";
    case "bill": return "Supplier";
    case "receipt": return "Receipt";
    case "payroll": return "Payroll";
    case "invoice": return "Invoice";
    default: return category;
  }
}
