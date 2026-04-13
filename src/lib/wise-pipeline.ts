/**
 * Wise auto-categorize and append pipeline.
 *
 * Andrea's April 2026 checklist item #5:
 *   "Wise — should check for freelancer or payroll or Supplier type
 *    wise data should match and append to sheet"
 *
 * For each completed outgoing Wise transfer:
 *   1. Look up the recipient's name from the cached recipients list
 *   2. Categorize as Freelancer / Payroll / Supplier (rule-based, no AI yet)
 *   3. Try to match against an existing payable row in the sheet
 *      (same recipient + same amount + within 7 days)
 *      → if matched, update the row's paymentStatus to "Paid" and
 *        paymentDate to the transfer date
 *      → if NOT matched, append a new payable row
 *   4. Persist transfer ID to wise_processed so we never re-process it
 *
 * Idempotent across runs: wise_processed is the gate.
 */
import * as db from "./db";
import { getCachedWiseData, WiseTransfer, WiseRecipient } from "./wise";
import { appendPayableRow, getPayables, convertToHkd, formatHkd, updatePayableCell } from "./sheets";
import { createBankTransaction, isXeroConnected } from "./xero";
import { getOrCreateReceiptSheet, addReceiptEntry, formatReceiptDate } from "./receipt-generator";
import { getFiscalYearFolderName } from "./drive-upload";

/** Throttle Sheets API calls — 60/min read+write quota per user. */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Map sheetType to Xero chart-of-accounts code. */
const XERO_ACCOUNT_CODES: Record<string, string> = {
  "Staff": "477",       // Wages and Salaries
  "Payroll": "477",     // Wages and Salaries
  "Freelancer": "313",  // Service provider-Operations
  "Supplier": "429",    // General Expenses
};

export interface WisePipelineResult {
  runId: string;
  scanned: number;
  alreadyProcessed: number;
  appended: number;
  matchedExisting: number;
  skipped: number;
  errors: number;
  details: string[];
}

/** Match a recipient name against known freelancers (case-insensitive). */
const FREELANCER_REGEX = /\b(jamie|jayvee|jm|murphy|aarati)\b/i;

/** Match payroll/salary keywords in transfer reference or recipient name. */
const PAYROLL_REGEX = /\b(salary|payroll|wage|sss|philhealth|pag-?ibig)\b/i;

/**
 * Decide the sheetType for a Wise transfer based on its recipient name and reference.
 *
 * Andrea's feedback (2026-04-10): default should be "Staff" not "Supplier",
 * since most Wise payments are to staff/employees.
 */
function classifyWiseTransfer(recipientName: string, reference: string): {
  sheetType: "Payroll" | "Freelancer" | "Supplier" | "Staff";
  paymentMethod: "Wise";
  reason: string;
} {
  const ref = (reference || "").trim();
  const name = (recipientName || "").trim();

  if (PAYROLL_REGEX.test(ref) || PAYROLL_REGEX.test(name)) {
    return { sheetType: "Payroll", paymentMethod: "Wise", reason: "matched payroll keyword" };
  }
  if (FREELANCER_REGEX.test(name) || FREELANCER_REGEX.test(ref)) {
    return { sheetType: "Freelancer", paymentMethod: "Wise", reason: "matched freelancer name" };
  }
  // Andrea prefers "Staff" as the default for Wise transfers (most are staff payments)
  return { sheetType: "Staff", paymentMethod: "Wise", reason: "default for Wise" };
}

/** Format a Wise transfer's date for the sheet (e.g. "5 Dec 2025"). */
function formatTransferDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Try to find an existing payable sheet row that this Wise transfer pays.
 * Match criteria: same recipient/supplier name (5-char prefix) + amount within
 * 5% + transfer date within 7 days of the row's jobDate.
 *
 * Returns the matching row's index (1-based) or null.
 */
function findMatchingPayableRow(
  payables: Awaited<ReturnType<typeof getPayables>>,
  recipientName: string,
  amount: number,
  transferDate: Date,
): number | null {
  const recipientLower = recipientName.toLowerCase();
  if (recipientLower.length < 3) return null;
  for (const p of payables) {
    if (!p.supplierName) continue;
    const sLower = p.supplierName.toLowerCase();
    if (!sLower.includes(recipientLower.substring(0, 5)) && !recipientLower.includes(sLower.substring(0, 5))) continue;
    const pAmountMatch = (p.paymentAmount || "").match(/[\d.,]+/);
    if (!pAmountMatch) continue;
    const pAmount = parseFloat(pAmountMatch[0].replace(/,/g, ""));
    if (!isFinite(pAmount) || pAmount <= 0) continue;
    if (Math.abs(pAmount - amount) / pAmount > 0.05) continue;
    const pDate = new Date(p.jobDate);
    if (isNaN(pDate.getTime())) continue;
    if (Math.abs(pDate.getTime() - transferDate.getTime()) > 7 * 86400000) continue;
    return p.rowIndex;
  }
  return null;
}

/**
 * Build a recipient lookup map from the cached recipients list.
 * Wise's WiseRecipient interface has accountHolderName which is the most
 * reliable source for the human-readable recipient name.
 */
function buildRecipientLookup(): Map<number, string> {
  const map = new Map<number, string>();
  const businessRecipients = (getCachedWiseData("business_recipients") as WiseRecipient[] | null) || [];
  const personalRecipients = (getCachedWiseData("personal_recipients") as WiseRecipient[] | null) || [];
  for (const r of [...businessRecipients, ...personalRecipients]) {
    if (r.id && r.accountHolderName) {
      map.set(r.id, r.accountHolderName);
    }
  }
  return map;
}

/**
 * Run the Wise auto-categorize and append pipeline.
 * Called from /api/sync after syncWiseData() finishes.
 */
export async function runWisePipeline(): Promise<WisePipelineResult> {
  const runId = crypto.randomUUID();
  const result: WisePipelineResult = {
    runId, scanned: 0, alreadyProcessed: 0, appended: 0, matchedExisting: 0, skipped: 0, errors: 0, details: [],
  };

  db.logPipeline({ runId, action: "wise_pipeline_start", status: "success", details: "Starting Wise auto-categorize" });

  try {
    const businessTransfers = (getCachedWiseData("business_transfers") as WiseTransfer[] | null) || [];
    const personalTransfers = (getCachedWiseData("personal_transfers") as WiseTransfer[] | null) || [];
    const allTransfers = [...businessTransfers, ...personalTransfers];

    // Only outgoing completed transfers — these represent money we paid out
    const outgoing = allTransfers.filter(t =>
      t.status === "outgoing_payment_sent" || t.status === "funds_converted" || t.status === "completed"
    );
    result.scanned = outgoing.length;

    if (outgoing.length === 0) {
      db.logPipeline({ runId, action: "wise_pipeline_end", status: "success", details: "No outgoing transfers to process" });
      return result;
    }

    const recipientLookup = buildRecipientLookup();
    const existingPayables = await getPayables();

    // Running balance is now a SUM formula in column R (auto-set by appendPayableRow)

    for (const t of outgoing) {
      const transferId = String(t.id);

      // Skip if already processed
      if (db.isWiseTransferProcessed(transferId)) {
        result.alreadyProcessed++;
        continue;
      }

      try {
        const recipientName = recipientLookup.get(t.targetAccount) || t.details?.reference || t.reference || "";
        const reference = t.details?.reference || t.reference || "";
        const amount = t.targetValue;
        const currency = t.targetCurrency;
        const transferDate = new Date(t.created);

        // Skip transfers with no recipient or zero amount
        if (!recipientName || !amount || amount <= 0) {
          db.logPipeline({ runId, action: "wise_skip", status: "skipped", details: `Transfer ${transferId}: missing recipient or amount` });
          db.markWiseTransferProcessed({ transferId, recipientName, amount: String(amount), currency, transferDate: t.created, action: "skipped" });
          result.skipped++;
          continue;
        }

        // Try to match against existing payable row
        const matchedRowIndex = findMatchingPayableRow(existingPayables, recipientName, amount, transferDate);

        if (matchedRowIndex !== null) {
          // Update the existing row: paymentStatus → Paid, paymentDate → transfer date
          await updatePayableCell(matchedRowIndex, "K", "Paid");
          await updatePayableCell(matchedRowIndex, "L", formatTransferDate(t.created));
          db.logPipeline({
            runId,
            action: "wise_match_existing",
            status: "success",
            result: String(matchedRowIndex),
            details: `${recipientName} ${currency} ${amount} → row ${matchedRowIndex} marked Paid`,
          });
          db.markWiseTransferProcessed({
            transferId, recipientName, amount: String(amount), currency,
            transferDate: t.created, sheetType: "Wise-matched", action: "matched_existing",
            sheetRowIndex: matchedRowIndex,
          });
          result.matchedExisting++;
          // Throttle: 2 cell updates above (status + date) — wait to stay under 60/min
          await sleep(2500);
        } else {
          // Append new row
          const { sheetType, paymentMethod } = classifyWiseTransfer(recipientName, reference);

          // Cash column Q — HKD equivalent. Column R is a SUM formula (auto-set).
          let debitCell = "";
          const hkd = convertToHkd(amount, currency);
          if (hkd !== null) {
            debitCell = formatHkd(hkd);
          }

          await appendPayableRow({
            jobDate: formatTransferDate(t.created),
            type: sheetType,
            receiptLink: "",
            supplierName: recipientName,
            invoiceNumber: reference || `Wise #${transferId}`,
            fullName: "",
            jobDetails: reference || `Wise transfer #${transferId}`,
            paymentAmount: `${currency} ${amount}`,
            conversion: debitCell, // Column I — HKD conversion
            paymentStatus: "Paid",
            paymentDate: formatTransferDate(t.created),
            paymentMethod,
            account: "HobbyLand",
            receiptCreated: "FALSE",
            debit: debitCell,
            // Column R auto-set as SUM formula by appendPayableRow
          });

          db.logPipeline({
            runId,
            action: "wise_append",
            status: "success",
            result: sheetType,
            details: `${recipientName} ${currency} ${amount} appended as ${sheetType}`,
          });
          db.markWiseTransferProcessed({
            transferId, recipientName, amount: String(amount), currency,
            transferDate: t.created, sheetType, action: "appended",
          });
          result.appended++;

          // Generate compiled "Receipt of Services" sheet for Staff/Freelancer
          if (sheetType === "Staff" || sheetType === "Freelancer") {
            try {
              const fiscalYear = getFiscalYearFolderName(t.created);
              const isFreelancer = sheetType === "Freelancer";
              const { sheetId } = await getOrCreateReceiptSheet(recipientName, fiscalYear, isFreelancer);
              const hkdVal = hkd !== null ? hkd : 0;
              const remark = `${sheetType === "Staff" ? "Salary" : "Freelancer payment"} - Bank Transfer`;
              await addReceiptEntry(sheetId, {
                date: formatReceiptDate(t.created),
                remark,
                localAmount: amount,
                localCurrency: currency,
                hkdAmount: hkdVal,
              });
              db.logPipeline({ runId, action: "receipt_entry_added", status: "success", details: `${recipientName} ${currency} ${amount} → Receipt FY ${fiscalYear}` });
            } catch (err) {
              db.logPipeline({ runId, action: "receipt_entry_added", status: "error", error: err instanceof Error ? err.message : "Receipt generation failed", details: recipientName });
            }
          }

          // Throttle: appendPayableRow makes 2 sheets calls (read+write).
          // Sheets API limit is 60/min — sleep to stay safely under.
          await sleep(2500);
        }
      } catch (err) {
        db.logPipeline({
          runId,
          action: "wise_process",
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
          details: `Transfer ${transferId}`,
        });
        result.errors++;
      }
    }

    // ===== Create Xero bank transactions for batch payments =====
    // Group this run's appended transfers by date (day) to create one Xero
    // SPEND entry per batch. Andrea wants: WHO=all recipients, WHAT=477/313,
    // WHY="Staff payments [Month Year]"
    if (isXeroConnected() && result.appended > 0) {
      try {
        // Collect all transfers we just appended in this run
        const appendedTransfers: Array<{
          recipientName: string;
          sourceValue: number;
          sourceCurrency: string;
          date: string;
          sheetType: string;
        }> = [];

        for (const t of outgoing) {
          const tid = String(t.id);
          // Only include transfers we appended in THIS run (not previously processed)
          // Check if this transfer was just processed as "appended"
          if (!db.isWiseTransferProcessed(tid)) continue;
          const recipientName = recipientLookup.get(t.targetAccount) || t.details?.reference || t.reference || "";
          const { sheetType } = classifyWiseTransfer(recipientName, t.details?.reference || t.reference || "");
          appendedTransfers.push({
            recipientName,
            sourceValue: t.sourceValue,
            sourceCurrency: t.sourceCurrency,
            date: t.created,
            sheetType,
          });
        }

        // Group by date (day) to create one Xero entry per batch
        const byDate = new Map<string, typeof appendedTransfers>();
        for (const t of appendedTransfers) {
          const day = new Date(t.date).toISOString().substring(0, 10);
          const existing = byDate.get(day) || [];
          existing.push(t);
          byDate.set(day, existing);
        }

        for (const [day, transfers] of byDate) {
          if (transfers.length === 0) continue;
          const totalSource = transfers.reduce((s, t) => s + t.sourceValue, 0);
          const currency = transfers[0].sourceCurrency || "HKD";

          // WHAT = dominant type's account code
          const typeCounts: Record<string, number> = {};
          for (const t of transfers) {
            typeCounts[t.sheetType] = (typeCounts[t.sheetType] || 0) + 1;
          }
          const dominantType = Object.entries(typeCounts).sort(([, a], [, b]) => b - a)[0]?.[0] || "Staff";
          const accountCode = XERO_ACCOUNT_CODES[dominantType] || "477";

          // WHY = "Staff payments [Month Year]"
          const month = new Date(day).toLocaleDateString("en-US", { month: "long", year: "numeric" });
          const typeLabel = dominantType === "Freelancer" ? "Freelancer" : "Staff";
          const why = `${typeLabel} payments ${month} (${transfers.length} transfers via Wise)`;

          // Build INDIVIDUAL line items per recipient with their actual salary.
          // Andrea's checklist: "Put salary value of each staff on Wise reconcile"
          const lineItems = transfers.map(t => ({
            description: t.recipientName || "Unknown",
            amount: t.sourceValue, // HKD amount debited for this person
            accountCode,
          }));

          try {
            await createBankTransaction({
              type: "SPEND",
              bankAccountCode: "100",
              contactName: "WISE PAYMENT",
              date: day,
              description: why,
              amount: totalSource,
              accountCode,
              currencyCode: currency,
              reference: `Wise batch ${day}`,
              lineItems, // One line per recipient with their individual salary
            });
            db.logPipeline({
              runId,
              action: "xero_wise_batch_created",
              status: "success",
              result: accountCode,
              details: `${lineItems.map(li => li.description).join(", ").substring(0, 60)} — ${why} — ${currency} ${totalSource}`,
            });
          } catch (err) {
            db.logPipeline({
              runId,
              action: "xero_wise_batch_created",
              status: "error",
              error: err instanceof Error ? err.message : "Xero create failed",
              details: `Batch ${day}: ${transfers.length} transfers, ${currency} ${totalSource}`,
            });
          }
          await sleep(1000);
        }
      } catch (err) {
        db.logPipeline({
          runId,
          action: "xero_wise_batch",
          status: "error",
          error: err instanceof Error ? err.message : "Batch creation failed",
        });
      }
    }

    result.details.push(
      `Scanned: ${result.scanned}`,
      `Already processed: ${result.alreadyProcessed}`,
      `Appended new: ${result.appended}`,
      `Matched existing: ${result.matchedExisting}`,
      `Skipped: ${result.skipped}`,
      `Errors: ${result.errors}`,
    );
    db.logPipeline({ runId, action: "wise_pipeline_end", status: "success", details: result.details.join(" | ") });
    db.addActivity({
      action: "sync",
      source: "wise-pipeline",
      details: `Wise pipeline: ${result.appended} appended, ${result.matchedExisting} matched, ${result.skipped} skipped, ${result.errors} errors`,
      fileCount: result.appended + result.matchedExisting,
    });
  } catch (err) {
    db.logPipeline({ runId, action: "wise_pipeline_end", status: "error", error: err instanceof Error ? err.message : "Wise pipeline crashed" });
    result.errors++;
  }

  return result;
}
