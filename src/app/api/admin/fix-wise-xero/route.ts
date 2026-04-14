/**
 * Fix existing Wise batch Spend Money transactions in Xero to include fees.
 *
 * GET  → List all WISE PAYMENT bank transactions
 * POST → Delete old ones and recreate with fees included
 *
 * POST body (optional):
 *   { "action": "delete-and-recreate" }  (default)
 *   { "action": "delete-only", "ids": ["id1", ...] }
 */

import { NextResponse } from "next/server";
import {
  getBankTransactions,
  deleteBankTransaction,
  createBankTransaction,
  isXeroConnected,
  type XeroBankTransaction,
} from "@/lib/xero";
import { getCachedWiseData, WiseTransfer, WiseRecipient, getTransferDetails } from "@/lib/wise";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const XERO_ACCOUNT_CODES: Record<string, string> = {
  "Staff": "477",
  "Payroll": "477",
  "Freelancer": "313",
  "Supplier": "429",
};

const FREELANCER_REGEX = /\b(jamie|jayvee|jm|murphy|aarati)\b/i;
const PAYROLL_REGEX = /\b(salary|payroll|wage|sss|philhealth|pag-?ibig)\b/i;

function classifyRecipient(name: string): string {
  if (PAYROLL_REGEX.test(name)) return "Payroll";
  if (FREELANCER_REGEX.test(name)) return "Freelancer";
  return "Staff";
}

export async function GET() {
  try {
    if (!isXeroConnected()) {
      return NextResponse.json({ error: "Xero not connected" }, { status: 400 });
    }

    // Get all bank transactions with WISE PAYMENT contact
    const allTxns: XeroBankTransaction[] = [];
    let page = 1;
    while (true) {
      const res = await getBankTransactions(page, 'Contact.Name=="WISE PAYMENT"');
      const txns = res.BankTransactions || [];
      allTxns.push(...txns);
      if (txns.length < 100) break;
      page++;
    }

    return NextResponse.json({
      count: allTxns.length,
      transactions: allTxns.map(t => ({
        id: t.BankTransactionID,
        contact: t.Contact?.Name,
        reference: t.Reference,
        date: t.DateString,
        total: t.Total,
        status: t.Status,
        lineItems: t.LineItems?.map(li => ({
          description: li.Description,
          amount: li.UnitAmount,
          accountCode: li.AccountCode,
        })),
        hasFees: t.LineItems?.some(li => li.Description === "Wise Transfer Fees") || false,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    if (!isXeroConnected()) {
      return NextResponse.json({ error: "Xero not connected" }, { status: 400 });
    }

    let action = "delete-and-recreate";
    let specificIds: string[] | undefined;
    try {
      const body = await req.json();
      if (body?.action) action = body.action;
      if (body?.ids) specificIds = body.ids;
    } catch { /* no body */ }

    // Get existing WISE PAYMENT bank transactions
    const allTxns: XeroBankTransaction[] = [];
    let page = 1;
    while (true) {
      const res = await getBankTransactions(page, 'Contact.Name=="WISE PAYMENT"');
      const txns = res.BankTransactions || [];
      allTxns.push(...txns);
      if (txns.length < 100) break;
      page++;
    }

    // Filter to only non-reconciled ones that don't have fees yet
    const toFix = allTxns.filter(t => {
      if (specificIds) return specificIds.includes(t.BankTransactionID);
      if (t.Status === "DELETED") return false;
      // Skip if already has fees line item
      if (t.LineItems?.some(li => li.Description === "Wise Transfer Fees")) return false;
      return true;
    });

    if (action === "delete-only") {
      const deleted: string[] = [];
      const failed: Array<{ id: string; error: string }> = [];
      for (const t of toFix) {
        try {
          await deleteBankTransaction(t.BankTransactionID);
          deleted.push(t.BankTransactionID);
        } catch (err) {
          failed.push({ id: t.BankTransactionID, error: (err as Error).message });
        }
        await sleep(500);
      }
      return NextResponse.json({ deleted: deleted.length, failed });
    }

    // delete-and-recreate: delete old, then recreate with fees
    // Build recipient lookup
    const businessRecipients = (getCachedWiseData("business_recipients") as WiseRecipient[] | null) || [];
    const personalRecipients = (getCachedWiseData("personal_recipients") as WiseRecipient[] | null) || [];
    const recipientMap = new Map<number, string>();
    for (const r of [...businessRecipients, ...personalRecipients]) {
      if (r.id && r.accountHolderName) recipientMap.set(r.id, r.accountHolderName);
    }

    // Get all transfers grouped by date
    const businessTransfers = (getCachedWiseData("business_transfers") as WiseTransfer[] | null) || [];
    const personalTransfers = (getCachedWiseData("personal_transfers") as WiseTransfer[] | null) || [];
    const allTransfers = [...businessTransfers, ...personalTransfers].filter(
      t => t.status === "outgoing_payment_sent" || t.status === "funds_converted" || t.status === "completed"
    );

    const results: Array<{ date: string; action: string; oldTotal?: number; newTotal?: number; fees?: number; error?: string }> = [];

    for (const txn of toFix) {
      const ref = txn.Reference || "";
      // Extract date from reference "Wise batch YYYY-MM-DD"
      const dateMatch = ref.match(/\d{4}-\d{2}-\d{2}/);
      if (!dateMatch) {
        results.push({ date: ref, action: "skipped", error: "No date in reference" });
        continue;
      }
      const batchDate = dateMatch[0];

      // Find transfers for this date
      const batchTransfers = allTransfers.filter(t => {
        const day = new Date(t.created).toISOString().substring(0, 10);
        return day === batchDate;
      });

      if (batchTransfers.length === 0) {
        results.push({ date: batchDate, action: "skipped", error: "No matching transfers found" });
        continue;
      }

      // Fetch fees for each transfer
      let totalFees = 0;
      const lineItems: Array<{ description: string; amount: number; accountCode: string }> = [];

      for (const t of batchTransfers) {
        const recipientName = recipientMap.get(t.targetAccount) || t.details?.reference || t.reference || "Unknown";
        const sheetType = classifyRecipient(recipientName);
        const accountCode = XERO_ACCOUNT_CODES[sheetType] || "477";

        lineItems.push({
          description: recipientName,
          amount: t.sourceValue,
          accountCode,
        });

        try {
          const details = await getTransferDetails(t.id);
          totalFees += details.fee || 0;
          await sleep(500);
        } catch {
          // Can't get fee, continue
        }
      }

      // Add fees line item
      if (totalFees > 0) {
        lineItems.push({
          description: "Wise Transfer Fees",
          amount: Math.round(totalFees * 100) / 100,
          accountCode: "404",
        });
      }

      const totalSource = batchTransfers.reduce((s, t) => s + t.sourceValue, 0) + totalFees;
      const currency = batchTransfers[0]?.sourceCurrency || "HKD";
      const dominantType = "Staff";
      const accountCode = XERO_ACCOUNT_CODES[dominantType] || "477";
      const month = new Date(batchDate).toLocaleDateString("en-US", { month: "long", year: "numeric" });
      const why = `Staff payments ${month} (${batchTransfers.length} transfers via Wise)`;

      try {
        // Delete old transaction
        await deleteBankTransaction(txn.BankTransactionID);
        await sleep(500);

        // Create new with fees
        await createBankTransaction({
          type: "SPEND",
          bankAccountCode: "102",
          contactName: "WISE PAYMENT",
          date: batchDate,
          description: why,
          amount: totalSource,
          accountCode,
          currencyCode: currency,
          reference: `Wise batch ${batchDate}`,
          lineItems,
        });

        results.push({
          date: batchDate,
          action: "recreated",
          oldTotal: txn.Total,
          newTotal: Math.round(totalSource * 100) / 100,
          fees: Math.round(totalFees * 100) / 100,
        });
      } catch (err) {
        results.push({ date: batchDate, action: "error", error: (err as Error).message });
      }

      await sleep(1000);
    }

    return NextResponse.json({ processed: results.length, results });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
