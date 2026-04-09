/**
 * Manual trigger for the Xero auto-reconciliation pipeline.
 *
 * The reconcile already runs automatically as part of /api/sync after
 * Xero sync. This endpoint lets us trigger it standalone for testing
 * or when the Xero sync hit a rate limit but the cached data is fresh
 * enough to reconcile against.
 *
 * GET  /api/admin/xero-reconcile         — preview matches without applying
 * POST /api/admin/xero-reconcile         — find matches AND apply payments
 *
 * Andrea's April 2026 checklist item #1.
 */
import { NextResponse } from "next/server";
import { runXeroReconcile } from "@/lib/xero-reconcile";

export async function GET() {
  try {
    const result = await runXeroReconcile({ autoApply: false });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown" },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const result = await runXeroReconcile({ autoApply: true });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown" },
      { status: 500 }
    );
  }
}
