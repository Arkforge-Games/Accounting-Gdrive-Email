/**
 * One-shot cleanup endpoint to clear rows that were corrupted by the
 * pre-fix values.append() bug (data shifted 15 columns right). Safe to
 * leave in place — only clears rows where column A is empty AND column
 * P contains a date-like string (the exact signature of the bug).
 *
 * POST /api/admin/clear-broken-rows
 */
import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getAuthenticatedClient } from "@/lib/google";

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || "1gCGR0fEruEdwVNe2qx9U2hAb7cIqjWcMHVae_iH_MsE";

// GET /api/admin/clear-broken-rows?from=182&to=200 — clear an explicit range
export async function GET(req: NextRequest) {
  try {
    const from = parseInt(req.nextUrl.searchParams.get("from") || "0", 10);
    const to = parseInt(req.nextUrl.searchParams.get("to") || "0", 10);
    if (!from || !to || from > to) {
      return NextResponse.json({ error: "from and to query params required" }, { status: 400 });
    }
    const auth = getAuthenticatedClient();
    const sheets = google.sheets({ version: "v4", auth });
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `Payable!A${from}:R${to}`,
    });
    return NextResponse.json({ cleared: to - from + 1, range: `${from}-${to}` });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const auth = getAuthenticatedClient();
    const sheets = google.sheets({ version: "v4", auth });

    // Read columns A and P from the data range
    const res = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: SPREADSHEET_ID,
      ranges: ["Payable!A9:A500", "Payable!P9:P500"],
    });

    const valueRanges = res.data.valueRanges || [];
    const colA = valueRanges[0]?.values || [];
    const colP = valueRanges[1]?.values || [];

    // Find broken rows: column A empty, column P contains a date
    const brokenRows: number[] = [];
    const len = Math.max(colA.length, colP.length);
    for (let i = 0; i < len; i++) {
      const a = (colA[i]?.[0] || "").trim();
      const p = (colP[i]?.[0] || "").trim();
      if (!a && p && /20\d{2}/.test(p)) {
        brokenRows.push(9 + i); // actual sheet row (1-based, range starts at row 9)
      }
    }

    if (brokenRows.length === 0) {
      return NextResponse.json({ cleared: 0, message: "No broken rows found" });
    }

    // Clear them in one batch
    const ranges = brokenRows.map((r) => `Payable!A${r}:R${r}`);
    await sheets.spreadsheets.values.batchClear({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { ranges },
    });

    return NextResponse.json({
      cleared: brokenRows.length,
      rows: brokenRows,
      message: `Cleared ${brokenRows.length} broken rows`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
