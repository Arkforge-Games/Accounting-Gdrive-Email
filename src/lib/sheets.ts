import { google } from "googleapis";
import { getAuthenticatedClient } from "./google";
import { setDataCache, getDataCache, getWiseCache } from "./db";

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || "1gCGR0fEruEdwVNe2qx9U2hAb7cIqjWcMHVae_iH_MsE";

function getSheets() {
  const auth = getAuthenticatedClient();
  return google.sheets({ version: "v4", auth });
}

// ===== Types =====

export interface PayableRow {
  rowIndex: number;
  jobDate: string;
  type: string;
  receiptLink: string;
  supplierName: string;
  invoiceNumber: string;
  fullName: string;
  jobDetails: string;
  paymentAmount: string;
  conversion: string;
  paymentDetails: string;
  paymentStatus: string;
  paymentDate: string;
  paymentMethod: string;
  account: string;
  remarks: string;
  receiptCreated: string;
  debit: string;
  runningBalance: string;
}

export interface ReceivableRow {
  rowIndex: number;
  jobDate: string;
  type: string;
  receiptLink: string;
  brand: string;
  clientName: string;
  invoiceNumber: string;
  fullName: string;
  jobDetails: string;
  paymentAmount: string;
  paymentDetails: string;
  paymentStatus: string;
  paymentDate: string;
  paymentMethod: string;
  account: string;
  remarks: string;
  receiptCreated: string;
}

// ===== Read =====

export async function getPayables(): Promise<PayableRow[]> {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Payable!A9:R500", // Skip header + template rows, start from "REAL DATA BELOW"
  });

  const rows = res.data.values || [];
  const payables: PayableRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;
    // Skip the "REAL DATA BELOW" marker
    if (r[0] === "REAL DATA BELOW" || (r.join("").trim() === "")) continue;

    payables.push({
      rowIndex: i + 9, // actual sheet row (1-based, offset by header rows)
      jobDate: r[0] || "",
      type: r[1] || "",
      receiptLink: r[2] || "",
      supplierName: r[3] || "",
      invoiceNumber: r[4] || "",
      fullName: r[5] || "",
      jobDetails: r[6] || "",
      paymentAmount: r[7] || "",
      conversion: r[8] || "",
      paymentDetails: r[9] || "",
      paymentStatus: r[10] || "",
      paymentDate: r[11] || "",
      paymentMethod: r[12] || "",
      account: r[13] || "",
      remarks: r[14] || "",
      receiptCreated: r[15] || "",
      debit: r[16] || "",
      runningBalance: r[17] || "",
    });
  }

  return payables;
}

export async function getReceivables(): Promise<ReceivableRow[]> {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Receivable!A2:P500",
  });

  const rows = res.data.values || [];
  const receivables: ReceivableRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0 || r.join("").trim() === "") continue;

    receivables.push({
      rowIndex: i + 2,
      jobDate: r[0] || "",
      type: r[1] || "",
      receiptLink: r[2] || "",
      brand: r[3] || "",
      clientName: r[4] || "",
      invoiceNumber: r[5] || "",
      fullName: r[6] || "",
      jobDetails: r[7] || "",
      paymentAmount: r[8] || "",
      paymentDetails: r[9] || "",
      paymentStatus: r[10] || "",
      paymentDate: r[11] || "",
      paymentMethod: r[12] || "",
      account: r[13] || "",
      remarks: r[14] || "",
      receiptCreated: r[15] || "",
    });
  }

  return receivables;
}

// ===== Write =====
//
// We do NOT use sheets.spreadsheets.values.append() because Google Sheets'
// table-detection heuristic is unreliable on this sheet: row 2 has a yellow
// "CASH ONLY" band spanning columns P-R, which makes append treat P:R as a
// separate "table" and writes new data starting at column P (15-column shift).
//
// Instead, find the last row with data in column A explicitly, then UPDATE
// the next row with the full A:R range. Deterministic and bulletproof.

async function findNextEmptyRow(sheetName: string, anchorCol: string = "A", startRow: number = 9): Promise<number> {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!${anchorCol}${startRow}:${anchorCol}10000`,
    majorDimension: "COLUMNS",
  });
  const col = res.data.values?.[0] || [];
  // Walk from the end backwards to find the last non-empty cell
  let lastNonEmpty = -1;
  for (let i = col.length - 1; i >= 0; i--) {
    if (col[i] && String(col[i]).trim() !== "") {
      lastNonEmpty = i;
      break;
    }
  }
  return startRow + lastNonEmpty + 1;
}

export async function appendPayableRow(data: Partial<PayableRow>): Promise<number> {
  const sheets = getSheets();
  const nextRow = await findNextEmptyRow("Payable", "A", 9);
  // Column R (Running Balance) uses a SUM formula instead of a static value.
  // This way the balance auto-recalculates when rows are edited/deleted.
  const runningBalanceCell = data.debit
    ? buildRunningBalanceFormula(nextRow)
    : (data.runningBalance || "");
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Payable!A${nextRow}:R${nextRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        data.jobDate || "",
        data.type || "",
        data.receiptLink || "",
        data.supplierName || "",
        data.invoiceNumber || "",
        data.fullName || "",
        data.jobDetails || "",
        data.paymentAmount || "",
        data.conversion || "",
        data.paymentDetails || "",
        data.paymentStatus || "",
        data.paymentDate || "",
        data.paymentMethod || "",
        data.account || "",
        data.remarks || "",
        data.receiptCreated || "FALSE",
        data.debit || "",
        runningBalanceCell,
      ]],
    },
  });
  return nextRow;
}

export async function appendReceivableRow(data: Partial<ReceivableRow>): Promise<void> {
  const sheets = getSheets();
  const nextRow = await findNextEmptyRow("Receivable", "A", 2);
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Receivable!A${nextRow}:P${nextRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        data.jobDate || "",
        data.type || "",
        data.receiptLink || "",
        data.brand || "",
        data.clientName || "",
        data.invoiceNumber || "",
        data.fullName || "",
        data.jobDetails || "",
        data.paymentAmount || "",
        data.paymentDetails || "",
        data.paymentStatus || "",
        data.paymentDate || "",
        data.paymentMethod || "",
        data.account || "",
        data.remarks || "",
        data.receiptCreated || "FALSE",
      ]],
    },
  });
}

export async function updatePayableCell(row: number, col: string, value: string): Promise<void> {
  const sheets = getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Payable!${col}${row}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[value]] },
  });
}

export async function updateReceivableCell(row: number, col: string, value: string): Promise<void> {
  const sheets = getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Receivable!${col}${row}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[value]] },
  });
}

// ===== Data Validation (Drop-downs) =====

/**
 * Get the numeric sheetId for a given tab name (Payable / Receivable).
 * Required for batchUpdate requests which use numeric IDs, not the spreadsheet ID.
 */
async function getSheetId(tabName: string): Promise<number> {
  const sheets = getSheets();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: "sheets(properties(sheetId,title))",
  });
  const sheet = meta.data.sheets?.find(s => s.properties?.title === tabName);
  if (!sheet?.properties?.sheetId === undefined || sheet?.properties?.sheetId === null) {
    throw new Error(`Sheet tab "${tabName}" not found`);
  }
  return sheet!.properties!.sheetId!;
}

/**
 * Apply data validation drop-downs to the Payable sheet's Type, Payment Status,
 * Payment Method, and Account columns. Andrea's April 2026 checklist item #2.
 *
 * Uses ONE_OF_LIST condition with strict=false so the AI can still write values
 * not in the list (the dropdown shows suggestions but doesn't reject other values).
 *
 * One-time setup; idempotent — running it twice is harmless.
 */
export async function setSheetDropdowns(): Promise<{ applied: number }> {
  const sheets = getSheets();
  const sheetId = await getSheetId("Payable");

  // Column index (0-based) → list of allowed values
  // B=1 (Type), K=10 (Payment Status), M=12 (Payment Method), N=13 (Account)
  const dropdowns: Array<{ col: number; label: string; values: string[] }> = [
    {
      col: 1, label: "Type",
      values: ["Invoice", "CC", "Reimbursement", "Freelancer", "Freelancer - Reimbursement", "Supplier", "Staff", "Cash", "Payroll"],
    },
    {
      col: 10, label: "Payment Status",
      values: ["Pending", "Paid", "Awaiting Payment", "Cancelled"],
    },
    {
      col: 12, label: "Payment Method",
      values: ["Andrea CC", "Credit Card", "Bank", "Cash", "Wise", "PayPal"],
    },
    {
      col: 13, label: "Account",
      values: ["HobbyLand"],
    },
  ];

  const requests = dropdowns.map(d => ({
    setDataValidation: {
      range: {
        sheetId,
        startRowIndex: 8, // Row 9 (data starts here, headers + template above)
        endRowIndex: 1000,
        startColumnIndex: d.col,
        endColumnIndex: d.col + 1,
      },
      rule: {
        condition: {
          type: "ONE_OF_LIST",
          values: d.values.map(v => ({ userEnteredValue: v })),
        },
        inputMessage: `Choose a ${d.label}`,
        // strict=false → users (and the AI) can still type values not in the list
        strict: false,
        showCustomUi: true,
      },
    },
  }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests },
  });

  return { applied: requests.length };
}

// ===== HKD conversion (cash columns Q & R) =====
//
// Andrea's April 2026 checklist item #4: column Q gets the HKD-equivalent of
// every non-reimbursement payable, and column R gets the running balance.
//
// Wise sync caches exchange rates with keys like "USD_HKD", "PHP_HKD" etc.
// (See wise.ts ratePairs.) We look those up here. If the direct rate is
// missing, fall back to the inverse (HKD_X → 1/rate).

/**
 * Convert an amount in any currency to HKD using cached Wise exchange rates.
 * Returns null if no rate is available (caller should leave Q empty).
 */
export function convertToHkd(amount: number, currency: string): number | null {
  const cur = (currency || "").toUpperCase().trim();
  if (!cur || cur === "HKD") return amount;
  if (!isFinite(amount) || amount <= 0) return null;

  // Wise's syncWiseData stores rates in the wise_cache table (not data_cache).
  // The keys are "X_HKD" pairs e.g. "USD_HKD", "PHP_HKD", "SGD_HKD".
  const cached = getWiseCache("exchange_rates");
  const rates = (cached?.data as Record<string, number> | undefined) || {};

  // Direct rate: X → HKD
  const direct = rates[`${cur}_HKD`];
  if (direct && isFinite(direct) && direct > 0) return amount * direct;

  // Inverse rate: HKD → X (so 1 X = 1 / rate HKD)
  const inverse = rates[`HKD_${cur}`];
  if (inverse && isFinite(inverse) && inverse > 0) return amount / inverse;

  return null;
}

/** Format an HKD amount for display in the cash columns. */
export function formatHkd(amount: number): string {
  return `HKD ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Build the Running Balance formula for column R at a given row.
 * Uses a SUM formula so the balance auto-recalculates when rows are
 * edited or deleted — Andrea's feedback (2026-04-10).
 *
 * Formula: =SUM(Q$9:Q{row})
 * This sums all HKD debit values from the start of data (row 9) down
 * to the current row, giving a cumulative running balance.
 */
export function buildRunningBalanceFormula(row: number): string {
  return `=SUM(Q$9:Q${row})`;
}

// ===== Sync & Cache =====

export async function syncSheetData(): Promise<{ payables: number; receivables: number }> {
  const [payables, receivables] = await Promise.all([
    getPayables(),
    getReceivables(),
  ]);

  setDataCache("sheets", "payables", payables);
  setDataCache("sheets", "receivables", receivables);
  setDataCache("sheets", "last_sync", {
    timestamp: new Date().toISOString(),
    payables: payables.length,
    receivables: receivables.length,
  });

  return { payables: payables.length, receivables: receivables.length };
}

export function getCachedPayables(): PayableRow[] {
  const cached = getDataCache("sheets", "payables");
  return (cached?.data as PayableRow[]) || [];
}

export function getCachedReceivables(): ReceivableRow[] {
  const cached = getDataCache("sheets", "receivables");
  return (cached?.data as ReceivableRow[]) || [];
}
