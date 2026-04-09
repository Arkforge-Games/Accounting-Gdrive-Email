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
import { appendPayableRow, getPayables, convertToHkd, formatHkd, updatePayableCell, getCurrentRunningBalance } from "./sheets";

/** Throttle Sheets API calls — 60/min read+write quota per user. */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
 * Returns one of the existing dropdown values: Payroll, Freelancer, Supplier.
 */
function classifyWiseTransfer(recipientName: string, reference: string): {
  sheetType: "Payroll" | "Freelancer" | "Supplier";
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
  return { sheetType: "Supplier", paymentMethod: "Wise", reason: "default for Wise" };
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

    // Read running balance once for any new appends
    let runningBalance = await getCurrentRunningBalance();

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

          // Cash columns Q & R — non-reimbursement Wise transfers all qualify
          let debitCell = "";
          let runningBalanceCell = "";
          const hkd = convertToHkd(amount, currency);
          if (hkd !== null) {
            debitCell = formatHkd(hkd);
            runningBalance += hkd;
            runningBalanceCell = formatHkd(runningBalance);
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
            paymentStatus: "Paid",
            paymentDate: formatTransferDate(t.created),
            paymentMethod,
            account: "HobbyLand",
            receiptCreated: "FALSE",
            debit: debitCell,
            runningBalance: runningBalanceCell,
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
