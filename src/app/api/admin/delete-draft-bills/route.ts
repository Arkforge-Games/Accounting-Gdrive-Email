/**
 * Bulk-delete DRAFT bills from Xero.
 *
 * GET  → List all DRAFT bills (preview what will be deleted)
 * POST → Delete all DRAFT bills (or specific IDs if provided in body)
 *
 * POST body (optional):
 *   { "invoiceIds": ["id1", "id2", ...] }
 *   If omitted, deletes ALL draft bills.
 */

import { NextResponse } from "next/server";
import { getAllDraftBills, bulkDeleteDraftBills } from "@/lib/xero";

export async function GET() {
  try {
    const drafts = await getAllDraftBills();
    return NextResponse.json({
      count: drafts.length,
      totalAmount: drafts.reduce((sum, d) => sum + (d.Total || 0), 0),
      bills: drafts.map(d => ({
        id: d.InvoiceID,
        contact: d.Contact?.Name || "Unknown",
        reference: d.Reference || "-",
        date: d.DateString,
        total: d.Total,
        currency: d.CurrencyCode,
      })),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    let invoiceIds: string[] | undefined;
    try {
      const body = await req.json();
      if (body?.invoiceIds && Array.isArray(body.invoiceIds)) {
        invoiceIds = body.invoiceIds;
      }
    } catch {
      // No body = delete all drafts
    }

    const result = await bulkDeleteDraftBills(invoiceIds);
    return NextResponse.json({
      deletedCount: result.deleted.length,
      failedCount: result.failed.length,
      deleted: result.deleted,
      failed: result.failed,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
