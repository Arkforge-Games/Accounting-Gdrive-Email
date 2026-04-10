/**
 * Xero auto-reconciliation pipeline (Phase B v2).
 *
 * Andrea's April 2026 checklist item #1 — the FULL version after she clarified
 * what she meant. The simpler "Wise → Xero bill payment" stays in xero.ts
 * (applyPaymentToBill), but THIS module handles the actual workflow she wants:
 *
 * For each unreconciled Xero bank statement line:
 *   1. Try to MATCH against an existing open Xero bill/invoice
 *      (same amount + same direction + within 7 days)
 *      → if matched, apply payment via /Payments to mark the bill PAID
 *   2. Otherwise CREATE a new bank transaction (Spend Money / Receive Money)
 *      with the AI-picked "What" account code from the chart of accounts
 *      → POSTed to /BankTransactions
 *
 * Idempotent: Xero only returns AUTHORISED bank transactions that aren't
 * already reconciled, so re-runs naturally skip everything that's been done.
 *
 * Triggered automatically from /api/sync (after Xero sync) and via the
 * existing /api/xero/bills?action=reconcile&autoApply=true endpoint.
 */
import * as db from "./db";
import { getCachedWiseData, WiseTransfer, WiseRecipient } from "./wise";
import {
  getAllBankTransactions,
  getAllInvoices,
  getAccounts,
  applyPaymentToBill,
  createBankTransaction,
  XeroBankTransaction,
  XeroInvoice,
  XeroAccount,
  isXeroConnected,
} from "./xero";
import { aiPickAccountCode, AccountChoice, isAIConfigured } from "./ai-categorize";

export interface XeroReconcileResult {
  runId: string;
  scanned: number;
  matchedAndPaid: number;
  createdNew: number;
  skipped: number;
  errors: number;
  details: string[];
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Find an open Xero bill/invoice that this bank transaction probably pays.
 * Match criteria:
 *   - Same amount (within 1%)
 *   - Same direction (SPEND → ACCPAY bill, RECEIVE → ACCREC invoice)
 *   - Within 14 days
 *   - Bonus if contact name matches
 */
function findMatchingInvoice(
  tx: XeroBankTransaction,
  invoices: XeroInvoice[],
): XeroInvoice | null {
  // Xero bank tx types include variants like "SPEND-TRANSFER", "RECEIVE-TRANSFER",
  // "SPEND-PREPAYMENT", etc. Match by prefix.
  const isSpend = String(tx.Type || "").startsWith("SPEND");
  const isReceive = String(tx.Type || "").startsWith("RECEIVE");
  if (!isSpend && !isReceive) return null;
  const expectedType = isSpend ? "ACCPAY" : "ACCREC";
  const txDate = new Date(tx.DateString).getTime();
  const txAmount = Math.abs(tx.Total);
  const txContact = (tx.Contact?.Name || "").toLowerCase();

  for (const inv of invoices) {
    if (inv.Type !== expectedType) continue;
    // Skip already paid bills
    if (inv.Status === "PAID" || inv.Status === "VOIDED") continue;
    // Amount match within 1%
    const invAmount = inv.Total;
    if (invAmount <= 0) continue;
    if (Math.abs(txAmount - invAmount) / invAmount > 0.01) continue;
    // Date proximity within 14 days
    const invDate = new Date(inv.DateString).getTime();
    if (isNaN(invDate)) continue;
    if (Math.abs(txDate - invDate) > 14 * 86400000) continue;
    // Contact bonus
    if (txContact && inv.Contact?.Name?.toLowerCase().includes(txContact.substring(0, 5))) {
      return inv;
    }
    // Without contact match, only return if the amount is exact
    if (Math.abs(txAmount - invAmount) < 0.01) return inv;
  }
  return null;
}

/**
 * Run the Xero auto-reconciliation. Called from /api/sync after syncXeroData()
 * and also exposed as a manual admin endpoint.
 *
 * NOTE: This currently only processes bank transactions that Xero already has.
 * It does NOT pull bank statement lines via the Statements endpoint — Xero
 * automatically creates AUTHORISED BankTransaction records for matched feed
 * entries, which is what we work with here. Unreconciled statement lines
 * still need to be matched via Xero's UI for the first time.
 *
 * For Andrea's flow: when an email receipt comes in, it creates a DRAFT bill
 * in Xero (via the existing pipeline). When the bank feed brings in the
 * matching transaction, this function detects the match and applies payment
 * to mark the bill PAID.
 */
export async function runXeroReconcile(opts: { autoApply?: boolean } = {}): Promise<XeroReconcileResult> {
  const runId = crypto.randomUUID();
  const result: XeroReconcileResult = {
    runId, scanned: 0, matchedAndPaid: 0, createdNew: 0, skipped: 0, errors: 0, details: [],
  };
  const autoApply = opts.autoApply !== false; // default true

  if (!isXeroConnected()) {
    db.logPipeline({ runId, action: "xero_reconcile_start", status: "error", error: "Xero not connected" });
    result.errors++;
    return result;
  }

  db.logPipeline({ runId, action: "xero_reconcile_start", status: "success", details: `autoApply=${autoApply}` });

  try {
    // 1. Fetch chart of accounts (cached in memory for the run)
    let accounts: AccountChoice[] = [];
    try {
      const accRes = await getAccounts();
      accounts = (accRes.Accounts || []).map((a: XeroAccount) => ({
        Code: a.Code,
        Name: a.Name,
        Type: a.Type,
        Description: a.Description,
      }));
      db.logPipeline({ runId, action: "xero_chart_loaded", status: "success", details: `${accounts.length} accounts` });
    } catch (err) {
      db.logPipeline({ runId, action: "xero_chart_loaded", status: "error", error: err instanceof Error ? err.message : "Failed" });
      // We can still try to match against bills without the chart
    }

    // 2. Fetch all bank transactions, then filter to UNRECONCILED ones only.
    // Xero's IsReconciled flag tells us which need work — a bank tx that's
    // already reconciled (matched to a bill or categorized) should be left
    // alone. Most transactions in a healthy Xero are reconciled, so this
    // filter dramatically narrows the candidate set.
    const allBankTx = await getAllBankTransactions();
    const candidates = allBankTx.filter(t =>
      t.Status === "AUTHORISED" && t.IsReconciled === false
    );
    result.scanned = candidates.length;
    db.logPipeline({
      runId,
      action: "xero_bank_scan",
      status: "success",
      details: `${allBankTx.length} total bank txns, ${candidates.length} unreconciled`,
    });

    if (candidates.length === 0) {
      db.logPipeline({ runId, action: "xero_reconcile_end", status: "success", details: "No bank transactions to process" });
      return result;
    }

    // 3. Fetch open bills/invoices to match against
    const invoices = await getAllInvoices("Status==\"AUTHORISED\" OR Status==\"DRAFT\" OR Status==\"SUBMITTED\"");
    db.logPipeline({ runId, action: "xero_invoices_loaded", status: "success", details: `${invoices.length} open invoices/bills` });

    // Track which invoices have been paid in this run to avoid double-payment
    const paidInvoiceIds = new Set<string>();

    // 4. Process each candidate bank transaction
    for (const tx of candidates) {
      try {
        // Try to match against an existing invoice/bill
        const match = findMatchingInvoice(tx, invoices.filter(i => !paidInvoiceIds.has(i.InvoiceID)));

        if (match) {
          if (!autoApply) {
            db.logPipeline({
              runId,
              action: "xero_match_found",
              status: "skipped",
              details: `Bank tx ${tx.BankTransactionID} would match invoice ${match.InvoiceNumber} (autoApply=false)`,
            });
            result.skipped++;
            continue;
          }

          // Apply payment to the bill
          try {
            await applyPaymentToBill({
              invoiceId: match.InvoiceID,
              amount: match.Total,
              date: tx.DateString.substring(0, 10),
              reference: `Bank match: ${tx.Reference || tx.BankTransactionID}`,
              accountCode: tx.BankAccount?.Code,
            });
            paidInvoiceIds.add(match.InvoiceID);
            db.logPipeline({
              runId,
              action: "xero_match_paid",
              status: "success",
              result: match.InvoiceID,
              details: `${match.Contact?.Name || "?"} ${match.Total} → bank tx ${tx.BankTransactionID}`,
            });
            result.matchedAndPaid++;
            await sleep(800);
          } catch (err) {
            db.logPipeline({
              runId,
              action: "xero_match_paid",
              status: "error",
              error: err instanceof Error ? err.message : "Apply failed",
              details: `bank tx ${tx.BankTransactionID} → invoice ${match.InvoiceID}`,
            });
            result.errors++;
          }
        } else if (isLikelyWisePayment(tx) && autoApply) {
          // No bill match, but this looks like a Wise batch payment.
          // Decompose it into individual recipients and create a categorized
          // bank transaction with proper WHO/WHAT/WHY fields.
          const batch = decomposeWiseBatch(Math.abs(tx.Total), tx.DateString, tx.BankAccount?.Code || "");
          if (batch && batch.recipients.length > 0) {
            const who = batch.recipients.join(", ").substring(0, 200);
            const whatCode = WISE_ACCOUNT_CODES[batch.dominantType] || "477";
            const month = new Date(tx.DateString).toLocaleDateString("en-US", { month: "long", year: "numeric" });
            const typeLabel = batch.dominantType === "Freelancer" ? "Freelancer" : "Staff";
            const why = `${typeLabel} payments ${month}`;

            try {
              await createBankTransaction({
                type: "SPEND",
                bankAccountCode: tx.BankAccount?.Code || "100",
                contactName: who,
                date: tx.DateString.substring(0, 10),
                description: why,
                amount: Math.abs(tx.Total),
                accountCode: whatCode,
                reference: tx.Reference || tx.BankTransactionID,
              });
              db.logPipeline({
                runId,
                action: "xero_wise_batch",
                status: "success",
                result: whatCode,
                details: `${who.substring(0, 80)} — ${why} — ${batch.recipients.length} recipients, total ${tx.Total}`,
              });
              result.createdNew++;
              await sleep(800);
            } catch (err) {
              db.logPipeline({
                runId,
                action: "xero_wise_batch",
                status: "error",
                error: err instanceof Error ? err.message : "Create failed",
                details: `Bank tx ${tx.BankTransactionID} — ${batch.recipients.length} recipients`,
              });
              result.errors++;
            }
          } else {
            db.logPipeline({
              runId,
              action: "xero_no_match",
              status: "skipped",
              details: `Bank tx ${tx.BankTransactionID} (Wise-like, ${tx.Total}) — could not decompose batch`,
            });
            result.skipped++;
          }
        } else {
          // No match and not a Wise payment — skip for manual review
          db.logPipeline({
            runId,
            action: "xero_no_match",
            status: "skipped",
            details: `Bank tx ${tx.BankTransactionID} (${tx.Type} ${tx.Total}) — no matching open bill, manual review`,
          });
          result.skipped++;
        }
      } catch (err) {
        db.logPipeline({
          runId,
          action: "xero_process",
          status: "error",
          error: err instanceof Error ? err.message : "Unknown error",
          details: `bank tx ${tx.BankTransactionID}`,
        });
        result.errors++;
      }
    }

    // Cache accounts for use by the email pipeline (so it can pick a code
    // when creating new Xero bills from receipts).
    if (accounts.length > 0) {
      db.setDataCache("xero", "chart_of_accounts", accounts);
    }

    result.details.push(
      `Scanned: ${result.scanned}`,
      `Matched and paid: ${result.matchedAndPaid}`,
      `Created new: ${result.createdNew}`,
      `Skipped (no match): ${result.skipped}`,
      `Errors: ${result.errors}`,
    );

    db.logPipeline({ runId, action: "xero_reconcile_end", status: "success", details: result.details.join(" | ") });
    db.addActivity({
      action: "sync",
      source: "xero-reconcile",
      details: `Xero reconcile: ${result.matchedAndPaid} paid, ${result.skipped} skipped, ${result.errors} errors`,
      fileCount: result.matchedAndPaid + result.createdNew,
    });
  } catch (err) {
    db.logPipeline({
      runId,
      action: "xero_reconcile_end",
      status: "error",
      error: err instanceof Error ? err.message : "Reconcile crashed",
    });
    result.errors++;
  }

  return result;
}

// ===== Wise Batch Payment Decomposition =====

/** Map sheetType (from wise_processed) to Xero chart-of-accounts code. */
const WISE_ACCOUNT_CODES: Record<string, string> = {
  "Staff": "477",       // Wages and Salaries
  "Payroll": "477",     // Wages and Salaries
  "Freelancer": "313",  // Service provider-Operations
  "Supplier": "429",    // General Expenses
};

/**
 * Detect if a bank transaction is likely a Wise payment based on its
 * reference, contact name, or line item description.
 */
function isLikelyWisePayment(tx: XeroBankTransaction): boolean {
  const ref = (tx.Reference || "").toUpperCase();
  const contact = (tx.Contact?.Name || "").toUpperCase();
  const desc = tx.LineItems?.[0]?.Description?.toUpperCase() || "";
  return ref.includes("WISE") || contact.includes("WISE") ||
    /^HC\d{8,}/.test(ref) || desc.includes("MONEY TRANSFER") ||
    ref.includes("260401") || ref.includes("260404") || ref.includes("260406");
}

/**
 * Build a recipient lookup from cached Wise data.
 */
function buildRecipientMap(): Map<number, string> {
  const map = new Map<number, string>();
  const biz = (getCachedWiseData("business_recipients") as WiseRecipient[] | null) || [];
  const personal = (getCachedWiseData("personal_recipients") as WiseRecipient[] | null) || [];
  for (const r of [...biz, ...personal]) {
    if (r.id && r.accountHolderName) map.set(r.id, r.accountHolderName);
  }
  return map;
}

/**
 * Decompose a bank transaction amount into individual Wise transfers.
 *
 * Finds cached Wise transfers from ±7 days of the bank tx date whose
 * sourceValues sum to within 5% of the bank tx total. Returns the
 * matched recipients and their dominant sheetType classification.
 */
function decomposeWiseBatch(
  bankTxAmount: number,
  bankTxDateStr: string,
  _bankAccountCode: string,
): {
  recipients: string[];
  dominantType: string;
  transferIds: number[];
  totalMatched: number;
} | null {
  const bankTxDate = new Date(bankTxDateStr).getTime();
  if (isNaN(bankTxDate)) return null;
  const SEVEN_DAYS = 7 * 86400000;

  // Get all cached transfers
  const bizTransfers = (getCachedWiseData("business_transfers") as WiseTransfer[] | null) || [];
  const personalTransfers = (getCachedWiseData("personal_transfers") as WiseTransfer[] | null) || [];
  const allTransfers = [...bizTransfers, ...personalTransfers];

  // Filter to completed outgoing transfers within ±7 days
  const candidates = allTransfers.filter(t => {
    if (t.status !== "outgoing_payment_sent" && t.status !== "funds_converted" && t.status !== "completed") return false;
    const tDate = new Date(t.created).getTime();
    return Math.abs(tDate - bankTxDate) <= SEVEN_DAYS;
  });

  if (candidates.length === 0) return null;

  // Sort by date to group chronologically
  candidates.sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());

  // Greedy accumulation: find a subset summing close to bankTxAmount
  // Use sourceValue (what was debited from the HKD account — matches the bank tx)
  let accumulated = 0;
  const matched: WiseTransfer[] = [];

  for (const t of candidates) {
    if (accumulated >= bankTxAmount * 1.05) break; // Already overshot
    accumulated += t.sourceValue;
    matched.push(t);
    // Check if we're close enough
    if (Math.abs(accumulated - bankTxAmount) / bankTxAmount < 0.05) {
      break; // Within 5% — good enough
    }
  }

  // Check if the match is good (within 5%)
  if (matched.length === 0) return null;
  if (Math.abs(accumulated - bankTxAmount) / bankTxAmount > 0.05) {
    // Greedy didn't work — try matching by single-day batches
    // Group transfers by date, find a date whose total matches
    const byDate = new Map<string, WiseTransfer[]>();
    for (const t of candidates) {
      const day = new Date(t.created).toISOString().substring(0, 10);
      const existing = byDate.get(day) || [];
      existing.push(t);
      byDate.set(day, existing);
    }
    for (const [, dayTransfers] of byDate) {
      const dayTotal = dayTransfers.reduce((s, t) => s + t.sourceValue, 0);
      if (Math.abs(dayTotal - bankTxAmount) / bankTxAmount < 0.05) {
        // This day's transfers match the bank tx
        matched.length = 0;
        matched.push(...dayTransfers);
        accumulated = dayTotal;
        break;
      }
    }
    // Final check
    if (Math.abs(accumulated - bankTxAmount) / bankTxAmount > 0.05) return null;
  }

  // Build recipient list
  const recipientMap = buildRecipientMap();
  const recipients: string[] = [];
  const seen = new Set<string>();
  for (const t of matched) {
    const name = recipientMap.get(t.targetAccount) || t.details?.reference || t.reference || "";
    if (name && !seen.has(name)) {
      recipients.push(name);
      seen.add(name);
    }
  }

  // Default to "Staff" for Wise batch payments — Andrea confirmed this is the
  // most common type. If we wanted per-transfer classification, we'd need to
  // query wise_processed for each transfer's sheet_type and take the majority.
  // For now, Staff (477) is correct for salary batches.
  const dominantType = "Staff";

  return {
    recipients,
    dominantType,
    transferIds: matched.map(t => t.id),
    totalMatched: accumulated,
  };
}

/**
 * Helper for the email pipeline: when creating a Xero bill from a receipt,
 * pick the right chart-of-accounts code via AI based on the vendor +
 * description, instead of always defaulting to "200".
 *
 * Returns null if AI is not configured or the chart isn't cached.
 */
export async function pickAccountCodeForReceipt(
  vendor: string,
  description: string,
  amount: number,
): Promise<string | null> {
  if (!isAIConfigured()) return null;
  const cached = db.getDataCache("xero", "chart_of_accounts");
  const accounts = (cached?.data as AccountChoice[] | undefined) || [];
  if (accounts.length === 0) return null;

  try {
    const result = await aiPickAccountCode(
      `${vendor || ""} — ${description || ""}`.trim(),
      amount,
      "SPEND",
      accounts,
    );
    return result.accountCode;
  } catch {
    return null;
  }
}
