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
import { appendPayableRow, appendReceivableRow, getPayables, getReceivables, convertToHkd, formatHkd, updatePayableCell } from "./sheets";
import { uploadToDrive, getDriveFolderForSheetType, buildDriveFilename, resolveOrCreateFolder, getFiscalYearFolderName, resolveAppFolderName } from "./drive-upload";
import { createBankTransaction, createBill, isXeroConnected } from "./xero";
import { pickAccountCodeForReceipt } from "./xero-reconcile";

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
    let existingPayables: { supplierName: string; invoiceNumber: string; paymentAmount: string; jobDate: string; receiptLink: string; rowIndex: number }[] = [];
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

    // ===== PHASE 2: Write one row per file, with in-run dedupe =====
    //
    // We do NOT group files at all. Why: we can't reliably distinguish
    // "1 invoice + 1 receipt for the same Vercel charge" (should merge)
    // from "9 different monthly Cloudflare charges, all $10.46" (must NOT
    // merge) without parsing PDF content for invoice numbers and dates.
    //
    // Trade-off: 1 invoice + 1 receipt for the same transaction will
    // produce 2 rows. Andrea can manually merge if she wants. Better to
    // have correct atomic rows than to silently lose data.
    //
    // The in-run dedupe set catches the obvious case of two files with
    // identical (vendor, amount, date) being written in the same run.
    const writtenInRun = new Set<string>();

    for (const file of unrecorded) {
      try {

        // Skip categories that shouldn't be recorded
        if (SKIP_CATEGORIES.has(file.category)) {
          db.logPipeline({ runId, fileId: file.id, action: "record", status: "skipped", details: `Category: ${file.category}` });
          result.skipped++;
          continue;
        }

        // Check for duplicates against existing sheet rows
        if (isDuplicate(file, existingPayables, existingReceivables)) {
          db.logPipeline({ runId, fileId: file.id, action: "record", status: "duplicate", details: `Duplicate detected: ${file.vendor} ${file.amount}` });
          result.duplicates++;
          continue;
        }

        // In-run dedupe: catch when two files in the same run resolve to the
        // same (vendor, amount, date) triple (e.g. invoice + receipt for the
        // same transaction). The first wins, the second is logged as duplicate.
        const runKey = `${(file.vendor || "").toLowerCase().trim()}|${(file.amount || "").trim()}|${(file.date || "").substring(0, 10)}`;
        if (file.vendor && file.amount && writtenInRun.has(runKey)) {
          db.logPipeline({ runId, fileId: file.id, action: "record", status: "duplicate", details: `In-run duplicate: ${file.vendor} ${file.amount} on ${file.date?.substring(0, 10)}` });
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
          result.skipped++;
          continue;
        }

        const receiptLink = getReceiptLink(file);

        // SALES TEAM MATCHING — check if there's already a row in the sheet
        // (pre-entered by the sales team) that matches this receipt. If so,
        // update that row with the receipt link instead of creating a new one.
        // Andrea's April 2026 checklist: "sales team lists expenses first,
        // receipts come second — need to match."
        const unfilledMatch = findUnfilledRow(existingPayables, file);
        if (unfilledMatch !== null) {
          const finalReceiptLink = await uploadReceiptToDrive(file, file.sheetType || formatType(file.category), file.category) || receiptLink;
          await updatePayableCell(unfilledMatch, "C", finalReceiptLink); // Receipt Link
          await updatePayableCell(unfilledMatch, "P", "TRUE"); // Receipt created
          if (file.referenceNo) await updatePayableCell(unfilledMatch, "E", file.referenceNo); // Invoice Number
          if (file.notes) await updatePayableCell(unfilledMatch, "G", file.notes); // Job Details
          db.logPipeline({ runId, fileId: file.id, action: "record", status: "success", result: "matched_sales_row", details: `${file.vendor} ${file.currency} ${file.amount} → existing row ${unfilledMatch}` });
          writtenInRun.add(runKey);
          result.recorded++;
          await sleep(1200);
          continue;
        }

        try {
          if (PAYABLE_CATEGORIES.has(file.category)) {
            // Determine sheetType. Order of precedence:
            //  1. Reimbursement category → use file.sheetType (Reimbursement or Freelancer)
            //  2. Known SaaS/CC vendor → ALWAYS "CC"
            //  3. AI's explicit sheetType
            //  4. Fallback formatType from category
            const isCC = file.category !== "reimbursement" && isSaasCcVendor(file);
            let sheetType: string;
            let paymentMethod: string;
            if (file.category === "reimbursement") {
              sheetType = file.sheetType || "Reimbursement";
              paymentMethod = file.paymentMethod || "Andrea CC";
            } else if (isCC) {
              sheetType = "CC";
              paymentMethod = "Credit Card";
            } else {
              sheetType = file.sheetType || formatType(file.category);
              paymentMethod = file.paymentMethod || "Bank";
            }

            // Upload the receipt file to the matching Drive folder so the
            // receipt link in the sheet points to a real Drive file Andrea
            // can click. Falls back to the proxy URL if upload fails.
            const finalReceiptLink = await uploadReceiptToDrive(file, sheetType, file.category) || receiptLink;

            // Cash column Q — HKD equivalent. Column R uses a SUM formula
            // (auto-set by appendPayableRow) so we don't track it here.
            // EXCLUDE reimbursements per Andrea's checklist item #4.
            let debitCell = "";
            if (file.category !== "reimbursement" && file.amount) {
              const amt = parseFloat(file.amount);
              const hkd = convertToHkd(amt, file.currency);
              if (hkd !== null) {
                debitCell = formatHkd(hkd);
              }
            }

            await appendPayableRow({
              jobDate: formatDate(file.date),
              type: sheetType,
              receiptLink: finalReceiptLink,
              supplierName: file.vendor || "Unknown",
              invoiceNumber: file.referenceNo || "",
              fullName: file.category === "reimbursement"
                ? ((file as db.IndexedFile & { reimbursementRecipient?: string }).reimbursementRecipient || "Andrea de Vera")
                : "",
              jobDetails: file.notes || "",
              paymentAmount: file.amount ? `${file.currency} ${file.amount}` : "",
              conversion: debitCell, // Column I — Andrea wants HKD conversion here too
              // If we have a receipt, the payment was already made → "Paid".
              // Only truly unpaid items (no receipt, awaiting invoice) stay "Pending".
              paymentStatus: "Paid",
              paymentMethod,
              account: "HobbyLand",
              receiptCreated: "TRUE",
              debit: debitCell,
              // Column R (Running Balance) is auto-set as a SUM formula by appendPayableRow
            });
            db.logPipeline({ runId, fileId: file.id, action: "record", status: "success", result: "payable", details: `${file.vendor} ${file.currency} ${file.amount}` });
            writtenInRun.add(runKey);
            result.recorded++;
            await sleep(1200);

            // Create a Xero DRAFT bill so it shows up on the "Match" tab when
            // Andrea reconciles the bank feed. Andrea's checklist:
            // "Auto match the expenses/payable to reconcile data."
            // Replicable to both Wise and non-Wise expenses.
            // Skip reimbursements (those are personal, not company expenses).
            if (isXeroConnected() && file.category !== "reimbursement" && file.amount) {
              try {
                const xeroCode = await pickAccountCodeForReceipt(
                  file.vendor || "",
                  file.notes || "",
                  parseFloat(file.amount),
                ) || "429";
                const amt = parseFloat(file.amount);
                const dt = file.date?.substring(0, 10) || new Date().toISOString().substring(0, 10);
                const desc = file.notes || `${file.category}: ${file.name}`;
                // Option C: Spend Money BankTransaction (code 102 = HSBC Business Bank)
                // Falls back to DRAFT bill (Option B) if BankTransaction fails
                try {
                  await createBankTransaction({
                    type: "SPEND",
                    bankAccountCode: "102",
                    contactName: file.vendor || "Unknown",
                    date: dt,
                    description: desc,
                    amount: amt,
                    accountCode: xeroCode,
                    currencyCode: file.currency || "HKD",
                    reference: file.referenceNo || file.id,
                  });
                } catch {
                  await createBill({
                    contactName: file.vendor || "Unknown",
                    date: dt,
                    description: desc,
                    amount: amt,
                    accountCode: xeroCode,
                    currencyCode: file.currency || "HKD",
                    invoiceNumber: file.referenceNo || undefined,
                  });
                }
                db.logPipeline({ runId, fileId: file.id, action: "xero_expense", status: "success", result: xeroCode, details: `${file.vendor} ${file.currency} ${file.amount}` });
              } catch (err) {
                db.logPipeline({ runId, fileId: file.id, action: "xero_expense", status: "error", error: err instanceof Error ? err.message : "Xero failed" });
              }
            }
          } else if (RECEIVABLE_CATEGORIES.has(file.category)) {
            const finalReceiptLink = await uploadReceiptToDrive(file, "Invoice", file.category) || receiptLink;
            await appendReceivableRow({
              jobDate: formatDate(file.date),
              type: "Invoice",
              receiptLink: finalReceiptLink,
              clientName: file.vendor || "Unknown",
              invoiceNumber: file.referenceNo || "",
              paymentAmount: file.amount ? `${file.currency} ${file.amount}` : "",
              paymentStatus: "Pending",
              paymentMethod: file.paymentMethod || "Bank",
              account: "HobbyLand",
              receiptCreated: "TRUE",
            });
            db.logPipeline({ runId, fileId: file.id, action: "record", status: "success", result: "receivable", details: `${file.vendor} ${file.currency} ${file.amount}` });
            writtenInRun.add(runKey);
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

/**
 * Parse a payment amount cell into { value, currency }. Handles formats like:
 *   "USD 14.20", "PHP 1,234.56", "HK$ 100", "₱500", "€10.00"
 * Returns currency=null if no currency token is recognized.
 */
function parsePaymentAmount(s: string): { value: number; currency: string | null } {
  const raw = (s || "").trim();
  if (!raw) return { value: 0, currency: null };
  // Pull out the numeric portion
  const numMatch = raw.match(/[\d,]+\.?\d{0,4}/);
  const value = numMatch ? parseFloat(numMatch[0].replace(/,/g, "")) : 0;
  // Detect currency from any of the common tokens / symbols
  const upper = raw.toUpperCase();
  let currency: string | null = null;
  if (/USD|US\$/.test(upper) || (raw.includes("$") && !raw.includes("HK") && !raw.includes("S$"))) currency = "USD";
  else if (/HKD|HK\$/.test(upper)) currency = "HKD";
  else if (/PHP|₱/.test(upper) || /(^|\s)P\d/.test(upper)) currency = "PHP";
  else if (/SGD|S\$/.test(upper)) currency = "SGD";
  else if (/EUR|€/.test(upper)) currency = "EUR";
  else if (/GBP|£/.test(upper)) currency = "GBP";
  else if (/MYR|RM/.test(upper)) currency = "MYR";
  else if (/IDR|RP/.test(upper)) currency = "IDR";
  return { value, currency };
}

function isDuplicate(
  file: db.IndexedFile,
  payables: { supplierName: string; invoiceNumber: string; paymentAmount: string; jobDate: string }[],
  receivables: { invoiceNumber: string; clientName: string; paymentAmount: string }[],
): boolean {
  const refNo = file.referenceNo || "";
  const vendor = (file.vendor || "").toLowerCase();
  const amount = file.amount ? parseFloat(file.amount) : 0;
  const fileCurrency = (file.currency || "").toUpperCase().trim();
  const fileDate = new Date(file.date).getTime();

  // Check payables
  for (const p of payables) {
    // Exact invoice number match — strongest signal, currency-agnostic
    if (refNo && p.invoiceNumber && p.invoiceNumber.includes(refNo)) return true;

    // Vendor + amount + currency + date match
    if (vendor && p.supplierName?.toLowerCase().includes(vendor.substring(0, 5))) {
      const parsed = parsePaymentAmount(p.paymentAmount || "");
      if (amount > 0 && parsed.value > 0 && Math.abs(amount - parsed.value) / parsed.value < 0.05) {
        // Currency must match (or existing row has no currency token, in which
        // case we still allow the match — old rows often lack currency labels).
        const currencyMatches = !parsed.currency || !fileCurrency || parsed.currency === fileCurrency;
        if (!currencyMatches) continue;
        // Date proximity within 7 days
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

/**
 * Find a pre-existing sheet row (entered by the sales team) that matches
 * this file but has no receipt attached yet. Used for "sales team lists
 * expenses first, receipts come later" matching — Andrea's April 2026
 * checklist.
 *
 * Match criteria:
 *   - Same vendor (5-char prefix)
 *   - Similar amount (within 5%)
 *   - Empty receiptLink (no receipt attached yet)
 *   - Row entered within 30 days of the file date
 */
function findUnfilledRow(
  payables: { supplierName: string; paymentAmount: string; receiptLink: string; jobDate: string; rowIndex: number }[],
  file: db.IndexedFile,
): number | null {
  const vendor = (file.vendor || "").toLowerCase();
  const amount = file.amount ? parseFloat(file.amount) : 0;
  const fileDate = new Date(file.date).getTime();
  if (!vendor || amount <= 0 || isNaN(fileDate)) return null;

  for (const p of payables) {
    // Must have empty receipt link (not yet matched to a receipt)
    if (p.receiptLink && p.receiptLink.trim() !== "") continue;
    // Vendor prefix match
    if (!p.supplierName?.toLowerCase().includes(vendor.substring(0, 5))) continue;
    // Amount within 5%
    const pAmount = parseFloat((p.paymentAmount || "0").replace(/[^0-9.]/g, "")) || 0;
    if (pAmount <= 0 || Math.abs(amount - pAmount) / pAmount > 0.05) continue;
    // Date within 30 days
    const pDate = new Date(p.jobDate).getTime();
    if (isNaN(pDate) || Math.abs(fileDate - pDate) > 30 * 86400000) continue;
    return p.rowIndex;
  }
  return null;
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
      // Use AI's extracted transaction date if available — this is the actual
      // invoice/receipt date from the PDF, NOT the email forward date.
      const finalDate = aiResult.transactionDate || file.date;
      const finalPeriod = finalDate.substring(0, 7);
      db.upsertFileIndex({
        fileId: file.id, category: finalCategory, period: finalPeriod,
        vendor: aiResult.vendor || file.vendor || undefined, autoCategorized: true,
      });
      if (aiResult.amount) db.updateFileIndex(file.id, { amount: aiResult.amount, currency: aiResult.currency || undefined });
      if (aiResult.description) db.updateFileIndex(file.id, { notes: aiResult.description });
      if (aiResult.invoiceNumber) db.updateFileIndex(file.id, { referenceNo: aiResult.invoiceNumber });
      if (aiResult.transactionDate) db.updateFileIndex(file.id, { transactionDate: aiResult.transactionDate });
      if (aiResult.sheetType && !file.sheetType) db.updateFileIndex(file.id, { sheetType: aiResult.sheetType });
      if (aiResult.paymentMethod && !file.paymentMethod) db.updateFileIndex(file.id, { paymentMethod: aiResult.paymentMethod });
      if (aiResult.confidence === "low") db.updateFileIndex(file.id, { needsReview: true, reviewNotes: "Low AI confidence" });

      file.category = finalCategory;
      file.vendor = aiResult.vendor || file.vendor;
      file.amount = aiResult.amount || file.amount;
      if (aiResult.currency) file.currency = aiResult.currency;
      if (aiResult.description) file.notes = aiResult.description;
      // Override file.date with the AI-extracted transaction date so the row
      // writer uses it for jobDate, not the email arrival timestamp.
      if (aiResult.transactionDate) file.date = aiResult.transactionDate;
      if (aiResult.invoiceNumber) file.referenceNo = aiResult.invoiceNumber;
      result.aiCategorized++;
      db.logPipeline({ runId, fileId: file.id, action: "categorize_ai", status: "success", result: finalCategory, details: aiResult.description || (categoryWasLocked ? `Extraction only (category locked: ${finalCategory})` : undefined) });
    } catch (err) {
      db.logPipeline({ runId, fileId: file.id, action: "categorize_ai", status: "error", error: err instanceof Error ? err.message : "AI failed" });
    }
  }

  // 3-bis: Apply SaaS CC vendor override to PERSISTED sheetType too.
  // The runtime override at write-time already corrects the row, but we also
  // persist it so the DB stays consistent with what's in the sheet.
  if (file.category !== "reimbursement" && PAYABLE_CATEGORIES.has(file.category) && isSaasCcVendor(file)) {
    if (file.sheetType !== "CC") {
      db.updateFileIndex(file.id, { sheetType: "CC", paymentMethod: "Credit Card" });
      file.sheetType = "CC";
      file.paymentMethod = "Credit Card";
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

/**
 * Upload a file's PDF/image content to the appropriate Drive folder, organized
 * as: <category>/<fiscal-year>/<app>/. The fiscal year (e.g. "2025-2026") and
 * app folder (e.g. "autoquotation.app" or "Anthropic") are auto-created on
 * first use via resolveOrCreateFolder.
 *
 * Returns the Drive file URL for use as the Receipt Link in the sheet.
 *
 * Idempotent: if the file already has a drive_file_url in DB, reuses it.
 * Falls back to null on any error so the caller uses the proxy URL.
 */
async function uploadReceiptToDrive(
  file: db.IndexedFile,
  sheetType: string,
  category: string,
): Promise<string | null> {
  // Already uploaded — reuse
  if (file.driveFileUrl) return file.driveFileUrl;

  const categoryFolderId = getDriveFolderForSheetType(sheetType, category);
  if (!categoryFolderId) return null; // No folder configured for this sheetType

  // Only upload files we have content for
  const fileData = db.getFileContent(file.id);
  if (!fileData || !fileData.content) return null;

  try {
    // Walk: category folder → fiscal year folder → app folder
    const fiscalYear = getFiscalYearFolderName(file.date);
    const appName = resolveAppFolderName({ description: file.notes, vendor: file.vendor });
    const fyFolderId = await resolveOrCreateFolder(categoryFolderId, fiscalYear);
    const appFolderId = await resolveOrCreateFolder(fyFolderId, appName);

    const filename = buildDriveFilename({
      date: file.date,
      vendor: file.vendor,
      amount: file.amount,
      currency: file.currency,
      invoiceNumber: file.referenceNo,
      originalName: file.name,
    });
    const result = await uploadToDrive(appFolderId, filename, file.mimeType, Buffer.from(fileData.content));
    db.updateFileIndex(file.id, { driveFileId: result.fileId, driveFileUrl: result.webViewLink });
    file.driveFileId = result.fileId;
    file.driveFileUrl = result.webViewLink;
    return result.webViewLink;
  } catch (err) {
    console.error(`[drive-upload] failed for ${file.id}:`, err instanceof Error ? err.message : err);
    return null;
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
