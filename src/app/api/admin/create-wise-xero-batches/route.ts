/**
 * One-shot endpoint: create Xero SPEND bank transactions from already-processed
 * Wise transfers that were appended to the sheet before the Xero integration
 * was added to the Wise pipeline.
 *
 * Groups transfers by date and creates one Xero entry per batch with
 * WHO=recipients, WHAT=account code, WHY=description.
 *
 * POST /api/admin/create-wise-xero-batches
 */
import { NextResponse } from "next/server";
import * as db from "@/lib/db";
import { getCachedWiseData, WiseTransfer, WiseRecipient } from "@/lib/wise";
import { createBankTransaction, isXeroConnected } from "@/lib/xero";

const XERO_ACCOUNT_CODES: Record<string, string> = {
  "Staff": "477",
  "Payroll": "477",
  "Freelancer": "313",
  "Supplier": "429",
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function POST() {
  if (!isXeroConnected()) {
    return NextResponse.json({ error: "Xero not connected" }, { status: 400 });
  }

  try {
    // Get all cached transfers
    const bizTransfers = (getCachedWiseData("business_transfers") as WiseTransfer[] | null) || [];
    const bizRecipients = (getCachedWiseData("business_recipients") as WiseRecipient[] | null) || [];

    const recipientMap = new Map<number, string>();
    for (const r of bizRecipients) {
      if (r.id && r.accountHolderName) recipientMap.set(r.id, r.accountHolderName);
    }

    // Filter to completed outgoing
    const outgoing = bizTransfers.filter(t =>
      t.status === "outgoing_payment_sent" || t.status === "completed" || t.status === "funds_converted"
    );

    // Group by date
    const byDate = new Map<string, WiseTransfer[]>();
    for (const t of outgoing) {
      const day = new Date(t.created).toISOString().substring(0, 10);
      const existing = byDate.get(day) || [];
      existing.push(t);
      byDate.set(day, existing);
    }

    const results: Array<{ date: string; count: number; total: number; currency: string; who: string; status: string; error?: string }> = [];

    for (const [day, transfers] of Array.from(byDate.entries()).sort(([a], [b]) => b.localeCompare(a)).slice(0, 30)) {
      // Only process batches with multiple transfers (single transfers are individual payments)
      if (transfers.length < 2) continue;

      const totalSource = transfers.reduce((s, t) => s + t.sourceValue, 0);
      const currency = transfers[0].sourceCurrency || "HKD";

      // Build per-recipient line items with individual salary amounts
      const lineItems = transfers.map(t => ({
        description: recipientMap.get(t.targetAccount) || t.reference || "Unknown",
        amount: t.sourceValue, // HKD amount for this person
      }));
      const recipientNames = lineItems.map(li => li.description);
      const who = recipientNames.join(", ").substring(0, 60);

      // WHY
      const month = new Date(day).toLocaleDateString("en-US", { month: "long", year: "numeric" });
      const why = `Staff payments ${month} (${transfers.length} transfers via Wise)`;

      try {
        await createBankTransaction({
          type: "SPEND",
          bankAccountCode: "100",
          contactName: "WISE PAYMENT",
          date: day,
          description: why,
          amount: totalSource,
          accountCode: "477",
          currencyCode: currency,
          reference: `Wise batch ${day}`,
          lineItems, // One line per recipient with individual salary
        });
        results.push({ date: day, count: transfers.length, total: totalSource, currency, who, status: "created" });
      } catch (err) {
        results.push({ date: day, count: transfers.length, total: totalSource, currency, who: who.substring(0, 60), status: "error", error: err instanceof Error ? err.message : "failed" });
      }
      await sleep(1000);
    }

    return NextResponse.json({
      success: true,
      batchesProcessed: results.length,
      results,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown" }, { status: 500 });
  }
}
