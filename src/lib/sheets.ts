import { google } from "googleapis";
import { getAuthenticatedClient } from "./google";
import { setDataCache, getDataCache } from "./db";

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || "1YTTr1t_a4ADQiDnfGGz20W1qqygqKDfvq9B4wPTxIpQ";

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

export async function appendPayableRow(data: Partial<PayableRow>): Promise<void> {
  const sheets = getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "Payable!A:R",
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
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "Receivable!A:P",
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
