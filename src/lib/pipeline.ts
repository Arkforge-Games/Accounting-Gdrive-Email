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

    // ===== PHASE 1: Categorize + extract data for EVERY file individually =====
    // We process each file independently to extract vendor/amount/category.
    // Grouping happens in Phase 2 — only files representing the SAME logical
    // transaction (same email + same vendor + same amount) get merged.
    for (const file of unrecorded) {
      try {
        await categorizeAndExtractFile(file, runId, result);
      } catch (err) {
        db.logPipeline({ runId, fileId: file.id, action: "process", status: "error", error: err instanceof Error ? err.message : "Unknown error" });
        result.errors++;
      }
    }

    // ===== PHASE 2: Group by transaction-identity, NOT just by email =====
    // Two files belong to the same transaction iff:
    //   - same emailId (came from the same forwarded email)
    //   - same vendor
    //   - same amount
    // 19 different Cloudflare receipts in one email = 19 different transactions
    // (different amounts), so they each get their own row. A reimbursement
    // email with 1 invoice + 1 receipt for the same Vercel charge = 1 row.
    const groups = groupByTransaction(unrecorded);

    // ===== PHASE 3: Write one row per transaction group =====
    for (const group of groups) {
      const file = group[0];
      const siblings = group.slice(1);
      try {

        // Skip categories that shouldn't be recorded
        if (SKIP_CATEGORIES.has(file.category)) {
          db.logPipeline({ runId, fileId: file.id, action: "record", status: "skipped", details: `Category: ${file.category}` });
          for (const sib of siblings) db.logPipeline({ runId, fileId: sib.id, action: "record", status: "skipped", details: `Sibling of ${file.id}; category: ${file.category}` });
          result.skipped++;
          continue;
        }

        // Check for duplicates against existing sheet rows
        if (isDuplicate(file, existingPayables, existingReceivables)) {
          db.logPipeline({ runId, fileId: file.id, action: "record", status: "duplicate", details: `Duplicate detected: ${file.vendor} ${file.amount}` });
          for (const sib of siblings) db.logPipeline({ runId, fileId: sib.id, action: "record", status: "duplicate", details: `Sibling of ${file.id}; duplicate` });
          result.duplicates++;
          continue;
        }

        // SPARSE-ROW GUARD — refuse to write rows missing essential fields.
        const missing: string[] = [];
        if (!file.amount) missing.push("amount");
        if (!file.vendor) missing.push("vendor");
        if (!file.date) missing.push("date");
        if (missing.length > 0) {
          db.updateFileIndex(file.id, { needsReview: true, reviewNotes: `Missing required fields: ${missing.join(", ")}` });
          db.logPipeline({ runId, fileId: file.id, action: "record", status: "needs_review", details: `Missing: ${missing.join(", ")}` });
          for (const sib of siblings) {
            db.updateFileIndex(sib.id, { needsReview: true, reviewNotes: `Missing required fields: ${missing.join(", ")}` });
            db.logPipeline({ runId, fileId: sib.id, action: "record", status: "needs_review", details: `Sibling of ${file.id}; missing: ${missing.join(", ")}` });
          }
          result.skipped++;
          continue;
        }

        // Build the receipt link cell — concatenate all attachment links from this group
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
              fullName: file.category === "reimbursement"
                ? ((file as db.IndexedFile & { reimbursementRecipient?: string }).reimbursementRecipient || "Andrea de Vera")
                : "",
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
 * Group files by LOGICAL TRANSACTION, not just by source email.
 *
 * Two files belong to the same transaction iff ALL of:
 *   - same emailId (came from the same forwarded email)
 *   - same vendor (after normalization)
 *   - same amount
 *
 * This correctly handles both:
 *   - Vercel reimbursement: 1 invoice + 1 receipt PDF, same vendor + amount
 *     → ONE row with both attachment links
 *   - Bulk Cloudflare receipts: 19 PDFs in one email, different amounts
 *     → 19 separate rows
 *
 * Files without an emailId (gdrive uploads, manual uploads) always go
 * into singleton groups.
 */
function groupByTransaction(files: db.IndexedFile[]): db.IndexedFile[][] {
  const groups = new Map<string, db.IndexedFile[]>();
  const standalone: db.IndexedFile[][] = [];

  for (const f of files) {
    if (!f.emailId) {
      standalone.push([f]);
      continue;
    }
    const vendorKey = (f.vendor || "").toLowerCase().trim();
    const amountKey = (f.amount || "").trim();
    // No vendor or amount yet → can't safely merge with anything → standalone
    if (!vendorKey || !amountKey) {
      standalone.push([f]);
      continue;
    }
    const key = `${f.emailId}|${vendorKey}|${amountKey}`;
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

/**
 * Categorize a single file and extract vendor / amount / currency / etc.
 * Updates both the in-memory file object and the file_index DB row.
 *
 * Order of precedence:
 *   1. Subject keyword override ("reimburs", "payroll") — locks category
 *      and sheetType regardless of PDF content
 *   2. Rule-based categorize from filename/subject/sender
 *   3. AI categorize (with PDF text) — only runs if needed and AI is configured
 *   4. Body/PDF amount extraction as fallback
 */
async function categorizeAndExtractFile(
  file: db.IndexedFile,
  runId: string,
  result: PipelineResult,
): Promise<void> {
  // 1. SUBJECT KEYWORD OVERRIDE
  const subjectLower = (file.emailSubject || "").toLowerCase();
  if (subjectLower.includes("reimburs") && file.category !== "reimbursement") {
    const freelancerMatch = (file.emailSubject || "").match(/jamie|jayvee|\bjm\b|murphy|aarati/i);
    const isFreelancer = !!freelancerMatch;
    const freelancerName = freelancerMatch
      ? freelancerMatch[0].charAt(0).toUpperCase() + freelancerMatch[0].slice(1).toLowerCase()
      : null;
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
    (file as db.IndexedFile & { reimbursementRecipient?: string }).reimbursementRecipient = freelancerName || "Andrea de Vera";
    result.categorized++;
    db.logPipeline({ runId, fileId: file.id, action: "categorize_subject_override", status: "success", result: "reimbursement", details: `Subject contained "reimburs"; sheetType=${sheetType}; recipient=${freelancerName || "Andrea de Vera"}` });
  }

  // 2. RULE-BASED CATEGORIZE (always run for vendor extraction)
  const categoryWasLocked = file.category === "reimbursement" || file.category === "payroll";
  if (file.category === "uncategorized" || !file.category || (categoryWasLocked && !file.vendor)) {
    const ruleResult = categorizeFile(file);
    const newCategory = categoryWasLocked ? file.category : ruleResult.category;
    const newVendor = file.vendor || ruleResult.vendor;
    if (newCategory !== "uncategorized" || newVendor) {
      db.upsertFileIndex({
        fileId: file.id, category: newCategory, period: ruleResult.period,
        vendor: newVendor || undefined, autoCategorized: true,
      });
      file.category = newCategory;
      file.vendor = newVendor;
      result.categorized++;
      db.logPipeline({ runId, fileId: file.id, action: "categorize_rule", status: "success", result: newCategory, details: categoryWasLocked ? `Vendor only (category locked: ${newCategory})` : undefined });
    }
  }

  // 3. AI CATEGORIZE — runs when uncategorized OR locked-but-missing-vendor/amount
  const needsExtraction = (file.category === "uncategorized") ||
    ((!file.vendor || !file.amount) && file.mimeType.includes("pdf"));
  if (needsExtraction && isAIConfigured()) {
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
      const finalCategory = categoryWasLocked ? file.category : aiResult.category;
      db.upsertFileIndex({
        fileId: file.id, category: finalCategory, period: file.date?.substring(0, 7),
        vendor: aiResult.vendor || file.vendor || undefined, autoCategorized: true,
      });
      if (aiResult.amount) db.updateFileIndex(file.id, { amount: aiResult.amount, currency: aiResult.currency || undefined });
      if (aiResult.description) db.updateFileIndex(file.id, { notes: aiResult.description });
      if (aiResult.sheetType && !file.sheetType) db.updateFileIndex(file.id, { sheetType: aiResult.sheetType });
      if (aiResult.paymentMethod && !file.paymentMethod) db.updateFileIndex(file.id, { paymentMethod: aiResult.paymentMethod });
      if (aiResult.confidence === "low") db.updateFileIndex(file.id, { needsReview: true, reviewNotes: "Low AI confidence" });

      file.category = finalCategory;
      file.vendor = aiResult.vendor || file.vendor;
      file.amount = aiResult.amount || file.amount;
      if (aiResult.currency) file.currency = aiResult.currency;
      if (aiResult.description) file.notes = aiResult.description;
      result.aiCategorized++;
      db.logPipeline({ runId, fileId: file.id, action: "categorize_ai", status: "success", result: finalCategory, details: aiResult.description || (categoryWasLocked ? `Extraction only (category locked: ${finalCategory})` : undefined) });
    } catch (err) {
      db.logPipeline({ runId, fileId: file.id, action: "categorize_ai", status: "error", error: err instanceof Error ? err.message : "AI failed" });
    }
  }

  // 4. AMOUNT EXTRACTION FALLBACK — try email body, then PDF text
  if (!file.amount && file.category !== "junk") {
    const emailBody = db.getEmailBodyForFile(file.id);
    let extracted = emailBody ? extractAmountFromBody(emailBody) : null;
    if (!extracted && file.mimeType.includes("pdf")) {
      try {
        const fileData = db.getFileContent(file.id);
        if (fileData) {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const pdfParse = require("pdf-parse");
          const parsed = await pdfParse(Buffer.from(fileData.content));
          if (parsed.text) extracted = extractAmountFromBody(parsed.text);
        }
      } catch { /* skip pdf parse errors */ }
    }
    if (extracted) {
      db.updateFileIndex(file.id, { amount: extracted.amount, currency: extracted.currency });
      file.amount = extracted.amount;
      file.currency = extracted.currency;
    }
  }
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
