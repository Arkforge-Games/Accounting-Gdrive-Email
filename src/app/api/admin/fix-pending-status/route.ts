/**
 * Bulk-fix Payable rows that have a receipt but are still marked "Pending".
 *
 * Finds rows where:
 *   - Column C (receiptLink) is NOT empty  → a receipt exists
 *   - Column K (paymentStatus) is "Pending"
 *
 * For Wise rows (paymentMethod = "Wise"):
 *   - Only mark "Paid" if receiptCreated (column P) is NOT "FALSE"
 *   - Andrea: "better if we can record on the individual receipts first
 *     before we mark as paid"
 *
 * For all other rows:
 *   - Always update to "Paid"
 *
 * POST /api/admin/fix-pending-status
 */
import { NextResponse } from "next/server";
import { getPayables, updatePayableCell } from "@/lib/sheets";

export async function POST() {
  try {
    const payables = await getPayables();

    const pending = payables.filter(
      (p) => p.receiptLink.trim() !== "" && p.paymentStatus.trim() === "Pending"
    );

    let updated = 0;
    let skippedWise = 0;
    const details: string[] = [];

    for (const row of pending) {
      const isWise = row.paymentMethod.trim() === "Wise";

      // Wise rows: require receiptCreated to be truthy (not "FALSE" or empty)
      if (isWise) {
        const rc = row.receiptCreated.trim().toUpperCase();
        if (rc === "FALSE" || rc === "") {
          skippedWise++;
          details.push(
            `Row ${row.rowIndex}: SKIPPED (Wise, receiptCreated=${row.receiptCreated || "empty"}) — ${row.supplierName}`
          );
          continue;
        }
      }

      await updatePayableCell(row.rowIndex, "K", "Paid");
      updated++;
      details.push(
        `Row ${row.rowIndex}: Pending → Paid — ${row.supplierName} ${row.paymentAmount}`
      );
    }

    return NextResponse.json({
      success: true,
      message: `Updated ${updated} rows from Pending to Paid (${skippedWise} Wise rows skipped)`,
      totalPending: pending.length,
      updated,
      skippedWise,
      details,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
