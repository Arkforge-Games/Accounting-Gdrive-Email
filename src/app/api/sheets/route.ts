import { NextRequest, NextResponse } from "next/server";
import * as sheets from "@/lib/sheets";

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") || "all";

  try {
    switch (action) {
      case "all": {
        const [payables, receivables] = await Promise.all([
          sheets.getPayables(),
          sheets.getReceivables(),
        ]);
        return NextResponse.json({ payables, receivables, payableCount: payables.length, receivableCount: receivables.length });
      }
      case "payables": {
        const payables = await sheets.getPayables();
        return NextResponse.json({ payables, count: payables.length });
      }
      case "receivables": {
        const receivables = await sheets.getReceivables();
        return NextResponse.json({ receivables, count: receivables.length });
      }
      case "sync": {
        const result = await sheets.syncSheetData();
        return NextResponse.json({ message: "Sheet data synced", ...result });
      }
      case "cached": {
        const payables = sheets.getCachedPayables();
        const receivables = sheets.getCachedReceivables();
        return NextResponse.json({ payables, receivables, payableCount: payables.length, receivableCount: receivables.length });
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action } = body;

  try {
    if (action === "add-payable") {
      await sheets.appendPayableRow(body.data);
      return NextResponse.json({ success: true, message: "Payable row added to sheet" });
    }

    if (action === "add-receivable") {
      await sheets.appendReceivableRow(body.data);
      return NextResponse.json({ success: true, message: "Receivable row added to sheet" });
    }

    if (action === "update-payable") {
      const { row, col, value } = body;
      if (!row || !col) return NextResponse.json({ error: "Missing row or col" }, { status: 400 });
      await sheets.updatePayableCell(row, col, value);
      return NextResponse.json({ success: true });
    }

    if (action === "update-receivable") {
      const { row, col, value } = body;
      if (!row || !col) return NextResponse.json({ error: "Missing row or col" }, { status: 400 });
      await sheets.updateReceivableCell(row, col, value);
      return NextResponse.json({ success: true });
    }

    if (action === "sync") {
      const result = await sheets.syncSheetData();
      return NextResponse.json({ message: "Sheet data synced", ...result });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}
