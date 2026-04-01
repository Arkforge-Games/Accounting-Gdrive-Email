import * as db from "./db";
import { categorizeFile, extractAmountFromBody } from "./categorize";
import { isAIConfigured, aiCategorizeFile } from "./ai-categorize";
import { appendPayableRow, appendReceivableRow, getPayables, getReceivables } from "./sheets";
import { isXeroConnected, createBill, createInvoice } from "./xero";

const PAYABLE_CATEGORIES = new Set(["bill", "reimbursement", "receipt", "payroll"]);
const RECEIVABLE_CATEGORIES = new Set(["invoice"]);
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

    // Step 2: Process each file
    for (const file of unrecorded) {
      try {
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

        // 2e: Record to Google Sheets
        if (!file.amount && !file.vendor) {
          db.logPipeline({ runId, fileId: file.id, action: "record", status: "skipped", details: "No amount or vendor" });
          result.skipped++;
          continue;
        }

        try {
          if (PAYABLE_CATEGORIES.has(file.category)) {
            await appendPayableRow({
              jobDate: formatDate(file.date),
              type: formatType(file.category),
              receiptLink: file.downloadUrl ? `https://accounting.devehub.app${file.downloadUrl}` : "",
              supplierName: file.vendor || "Unknown",
              invoiceNumber: file.referenceNo || "",
              fullName: "",
              jobDetails: file.notes || "",
              paymentAmount: file.amount ? `${file.currency} ${file.amount}` : "",
              paymentStatus: "Pending",
              paymentMethod: file.category === "reimbursement" ? "Andrea CC" : "Bank",
              account: "HobbyLand",
              receiptCreated: "TRUE",
            });
            db.logPipeline({ runId, fileId: file.id, action: "record", status: "success", result: "payable", details: `${file.vendor} ${file.currency} ${file.amount}` });
            result.recorded++;

            // Auto-create Xero bill (DRAFT) for payable items with amount
            if (isXeroConnected() && file.amount && parseFloat(file.amount) > 0) {
              try {
                const amt = parseFloat(file.amount);
                const cur = mapCurrency(file.currency);
                await createBill({
                  contactName: file.vendor || "Unknown Supplier",
                  date: file.date ? new Date(file.date).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
                  description: file.notes || `${file.category}: ${file.name}`,
                  amount: amt,
                  currencyCode: cur,
                  invoiceNumber: file.referenceNo || undefined,
                });
                db.logPipeline({ runId, fileId: file.id, action: "xero_bill", status: "success", result: "DRAFT", details: `${file.vendor} ${cur} ${amt}` });
                result.xeroCreated++;
              } catch (err) {
                db.logPipeline({ runId, fileId: file.id, action: "xero_bill", status: "error", error: err instanceof Error ? err.message : "Xero write failed" });
              }
            }
          } else if (RECEIVABLE_CATEGORIES.has(file.category)) {
            await appendReceivableRow({
              jobDate: formatDate(file.date),
              type: "Invoice",
              receiptLink: file.downloadUrl ? `https://accounting.devehub.app${file.downloadUrl}` : "",
              clientName: file.vendor || "Unknown",
              invoiceNumber: file.referenceNo || "",
              paymentAmount: file.amount ? `${file.currency} ${file.amount}` : "",
              paymentStatus: "Pending",
              paymentMethod: "Bank",
              account: "HobbyLand",
              receiptCreated: "TRUE",
            });
            db.logPipeline({ runId, fileId: file.id, action: "record", status: "success", result: "receivable", details: `${file.vendor} ${file.currency} ${file.amount}` });
            result.recorded++;

            // Auto-create Xero invoice (DRAFT) for receivable items
            if (isXeroConnected() && file.amount && parseFloat(file.amount) > 0) {
              try {
                const amt = parseFloat(file.amount);
                const cur = mapCurrency(file.currency);
                await createInvoice({
                  contactName: file.vendor || "Unknown Client",
                  date: file.date ? new Date(file.date).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
                  description: file.notes || `${file.category}: ${file.name}`,
                  amount: amt,
                  currencyCode: cur,
                  invoiceNumber: file.referenceNo || undefined,
                });
                db.logPipeline({ runId, fileId: file.id, action: "xero_invoice", status: "success", result: "DRAFT", details: `${file.vendor} ${cur} ${amt}` });
                result.xeroCreated++;
              } catch (err) {
                db.logPipeline({ runId, fileId: file.id, action: "xero_invoice", status: "error", error: err instanceof Error ? err.message : "Xero write failed" });
              }
            }
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

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function mapCurrency(currency: string): string {
  // Normalize currency codes for Xero
  const c = (currency || "HKD").toUpperCase().trim();
  if (c === "US$" || c === "US" || c === "$") return "USD";
  if (c === "HK$" || c === "HK") return "HKD";
  if (c === "₱" || c === "P") return "PHP";
  if (c === "S$") return "SGD";
  if (c === "RM") return "MYR";
  if (c === "Rp") return "IDR";
  if (c === "€") return "EUR";
  if (c === "£") return "GBP";
  return c;
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
