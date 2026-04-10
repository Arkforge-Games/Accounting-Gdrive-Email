/**
 * One-shot backfill: populate columns Q (HKD equivalent) and R (running
 * balance) for every existing non-reimbursement payable row that's currently
 * missing them.
 *
 * Andrea's April 2026 checklist item #4. Excludes any row where type is
 * "Reimbursement" / "Freelancer - Reimbursement" per her instruction.
 *
 * Throttled at 1.5s per row update to stay under Sheets API quota (60/min).
 *
 * POST /api/admin/backfill-cash-columns
 */
import { NextResponse } from "next/server";
import { google } from "googleapis";
import { getAuthenticatedClient } from "@/lib/google";
import { getPayables, convertToHkd, formatHkd } from "@/lib/sheets";

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || "1gCGR0fEruEdwVNe2qx9U2hAb7cIqjWcMHVae_iH_MsE";
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const REIMBURSEMENT_TYPES = new Set(["Reimbursement", "Freelancer - Reimbursement"]);

/** Parse "USD 14.20", "PHP 1,234.56", "₱500" → {amount, currency}. */
function parseAmountCell(s: string): { amount: number; currency: string } | null {
  const raw = (s || "").trim();
  if (!raw) return null;
  const numMatch = raw.match(/[\d,]+\.?\d{0,4}/);
  if (!numMatch) return null;
  const amount = parseFloat(numMatch[0].replace(/,/g, ""));
  if (!isFinite(amount) || amount <= 0) return null;
  const upper = raw.toUpperCase();
  let currency = "HKD";
  if (/USD|US\$/.test(upper)) currency = "USD";
  else if (/HKD|HK\$/.test(upper)) currency = "HKD";
  else if (/PHP|₱/.test(upper)) currency = "PHP";
  else if (/SGD|S\$/.test(upper)) currency = "SGD";
  else if (/MYR|RM/.test(upper)) currency = "MYR";
  else if (/IDR|RP/.test(upper)) currency = "IDR";
  else if (/EUR|€/.test(upper)) currency = "EUR";
  else if (/GBP|£/.test(upper)) currency = "GBP";
  return { amount, currency };
}

export async function POST() {
  try {
    const auth = getAuthenticatedClient();
    const sheets = google.sheets({ version: "v4", auth });

    const payables = await getPayables();
    payables.sort((a, b) => a.rowIndex - b.rowIndex);

    let runningBalance = 0;
    let updated = 0;
    let skipped = 0;
    let noRate = 0;
    const writes: Array<{ row: number; q: string; r: string }> = [];

    // First pass: compute everything in memory
    for (const p of payables) {
      // Skip reimbursements
      if (REIMBURSEMENT_TYPES.has(p.type || "")) {
        skipped++;
        continue;
      }
      // Skip rows with no payment amount
      const parsed = parseAmountCell(p.paymentAmount);
      if (!parsed) {
        skipped++;
        continue;
      }
      const hkd = convertToHkd(parsed.amount, parsed.currency);
      if (hkd === null) {
        noRate++;
        continue;
      }
      runningBalance += hkd;
      writes.push({
        row: p.rowIndex,
        q: formatHkd(hkd),
        r: formatHkd(runningBalance),
      });
    }

    // Second pass: batch write Q & R for each row.
    // Use values.batchUpdate with one ValueRange per row to minimize API calls.
    // Each batch can hold many ranges in one request.
    const BATCH_SIZE = 50;
    for (let i = 0; i < writes.length; i += BATCH_SIZE) {
      const batch = writes.slice(i, i + BATCH_SIZE);
      const data = batch.flatMap(w => [
        // Column I (Conversion) — Andrea wants HKD shown here too
        { range: `Payable!I${w.row}`, values: [[w.q]] },
        // Column Q (Debit / Money Out)
        { range: `Payable!Q${w.row}`, values: [[w.q]] },
        // Column R (Running Balance)
        { range: `Payable!R${w.row}`, values: [[w.r]] },
      ]);
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data,
        },
      });
      updated += batch.length;
      // Throttle between batches: 50 rows per batch = 100 cell writes,
      // sleep enough to stay safely under 60 writes/min
      await sleep(2500);
    }

    return NextResponse.json({
      success: true,
      summary: {
        scanned: payables.length,
        updated,
        skippedReimbursementOrEmpty: skipped,
        noExchangeRate: noRate,
        finalRunningBalance: formatHkd(runningBalance),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
