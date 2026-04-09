/**
 * One-time setup endpoint to apply dropdown data validation to the Payable
 * sheet columns Type, Payment Status, Payment Method, and Account.
 *
 * Andrea's April 2026 checklist item #2.
 *
 * POST /api/admin/setup-dropdowns
 */
import { NextResponse } from "next/server";
import { setSheetDropdowns } from "@/lib/sheets";

export async function POST() {
  try {
    const result = await setSheetDropdowns();
    return NextResponse.json({
      success: true,
      message: `Applied ${result.applied} dropdown rules to Payable sheet`,
      applied: result.applied,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
