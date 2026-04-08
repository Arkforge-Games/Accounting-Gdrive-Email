import { google } from "googleapis";
import { getAuthenticatedClient } from "./google";
import { setDataCache, getDataCache } from "./db";

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

export async function appendPayableRow(data: Partial<PayableRow>): Promise<void> {
  const sheets = getSheets();
  const nextRow = await findNextEmptyRow("Payable", "A", 9);
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
        data.runningBalance || "",
      ]],
    },
  });
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
