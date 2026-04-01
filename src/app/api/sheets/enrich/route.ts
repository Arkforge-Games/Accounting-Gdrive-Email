import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getAuthenticatedClient } from "@/lib/google";
import * as db from "@/lib/db";

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || "1gCGR0fEruEdwVNe2qx9U2hAb7cIqjWcMHVae_iH_MsE";

function getSheets() {
  return google.sheets({ version: "v4", auth: getAuthenticatedClient() });
}

// POST /api/sheets/enrich — auto-fill empty columns + populate receivable from Xero
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action } = body;

  try {
    if (action === "enrich-payable") {
      const result = await enrichPayable();
      return NextResponse.json(result);
    }

    if (action === "populate-receivable") {
      const result = await populateReceivable();
      return NextResponse.json(result);
    }

    if (action === "all") {
      const [payResult, recResult] = await Promise.all([
        enrichPayable(),
        populateReceivable(),
      ]);
      return NextResponse.json({ payable: payResult, receivable: recResult });
    }

    return NextResponse.json({ error: "Unknown action. Use: enrich-payable, populate-receivable, all" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

async function enrichPayable(): Promise<{ updated: number; details: string[] }> {
  const sheets = getSheets();
  const details: string[] = [];

  // Read current payable data (including headers)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Payable!A1:R100",
  });
  const allRows = res.data.values || [];
  if (allRows.length < 2) return { updated: 0, details: ["No data rows found"] };

  // Get our data sources
  const indexedFiles = db.getIndexedFiles({});
  const wiseRates = db.getWiseCache("exchange_rates");
  const rates = (wiseRates?.data || {}) as Record<string, number>;
  const xeroBillsCache = db.getDataCache("xero", "bills");
  const xeroBills = (xeroBillsCache?.data || []) as {
    InvoiceNumber: string; Contact: { Name: string }; Total: number;
    Status: string; DateString: string; CurrencyCode: string;
  }[];

  // Build updates batch
  const updates: { range: string; values: string[][] }[] = [];
  let updated = 0;

  for (let i = 1; i < allRows.length; i++) {
    const row = allRows[i];
    const rowNum = i + 1; // 1-based sheet row
    if (!row || row.length === 0 || row[0] === "REAL DATA BELOW") continue;

    const supplierName = (row[3] || "").trim();
    const invoiceNum = (row[4] || "").trim();
    const amount = (row[7] || "").trim();
    const jobDetails = (row[6] || "").trim();
    const conversion = (row[8] || "").trim();
    const paymentDetails = (row[9] || "").trim();
    const paymentStatus = (row[10] || "").trim();
    const paymentMethod = (row[12] || "").trim();
    const account = (row[13] || "").trim();
    const receiptCreated = (row[15] || "").trim();
    const debit = (row[16] || "").trim();
    const type = (row[1] || "").trim();

    let changed = false;

    // G: Job Details — from AI notes in file index
    if (!jobDetails && supplierName) {
      const match = indexedFiles.find(f =>
        (f.vendor && f.vendor.toLowerCase().includes(supplierName.toLowerCase())) ||
        (f.name && invoiceNum && f.name.includes(invoiceNum))
      );
      if (match?.notes) {
        updates.push({ range: `Payable!G${rowNum}`, values: [[match.notes]] });
        changed = true;
      }
    }

    // I: Conversion — convert to HKD using Wise rates
    if (!conversion && amount) {
      const parsed = parseAmount(amount);
      if (parsed && parsed.currency !== "HKD") {
        const rateKey = `${parsed.currency}_HKD`;
        const reverseKey = `HKD_${parsed.currency}`;
        let hkdAmount: number | null = null;

        if (rates[rateKey]) {
          hkdAmount = parsed.value * rates[rateKey];
        } else if (rates[reverseKey]) {
          hkdAmount = parsed.value / rates[reverseKey];
        } else if (parsed.currency === "USD") {
          hkdAmount = parsed.value * 7.8; // approximate
        } else if (parsed.currency === "PHP") {
          hkdAmount = parsed.value / 7.7; // approximate
        }

        if (hkdAmount) {
          updates.push({ range: `Payable!I${rowNum}`, values: [[`HK$ ${hkdAmount.toFixed(2)}`]] });
          changed = true;
        }
      }
    }

    // J: Payment Details — from email subject / AI description
    if (!paymentDetails && supplierName) {
      const match = indexedFiles.find(f =>
        (f.vendor && f.vendor.toLowerCase().includes(supplierName.toLowerCase())) ||
        (invoiceNum && f.name.includes(invoiceNum))
      );
      if (match?.emailSubject) {
        updates.push({ range: `Payable!J${rowNum}`, values: [[match.emailSubject]] });
        changed = true;
      }
    }

    // K: Payment Status — from Xero bill matching
    if (!paymentStatus || paymentStatus === "-") {
      const xeroMatch = xeroBills.find(b =>
        (invoiceNum && b.InvoiceNumber && b.InvoiceNumber.includes(invoiceNum)) ||
        (supplierName && b.Contact?.Name?.toLowerCase().includes(supplierName.toLowerCase()))
      );
      if (xeroMatch) {
        const status = xeroMatch.Status === "PAID" ? "Paid" : xeroMatch.Status === "AUTHORISED" ? "Ready" : xeroMatch.Status;
        updates.push({ range: `Payable!K${rowNum}`, values: [[status]] });
        changed = true;
      }
    }

    // M: Payment Method — infer from type
    if (!paymentMethod) {
      let method = "";
      if (type === "Reimbursement") method = "Andrea CC";
      else if (type === "CC") method = "Credit Card";
      else if (type === "Cash") method = "Cash";
      else if (type.includes("Freelancer")) method = "Bank Transfer";
      else if (type === "Supplier") method = "Bank";
      if (method) {
        updates.push({ range: `Payable!M${rowNum}`, values: [[method]] });
        changed = true;
      }
    }

    // N: Account — default to HobbyLand
    if (!account) {
      updates.push({ range: `Payable!N${rowNum}`, values: [["HobbyLand"]] });
      changed = true;
    }

    // P: Receipt created? — check if matching file exists
    if (!receiptCreated || receiptCreated === "FALSE") {
      const hasFile = indexedFiles.some(f =>
        (invoiceNum && f.name.includes(invoiceNum)) ||
        (supplierName && f.vendor && f.vendor.toLowerCase().includes(supplierName.toLowerCase()) && f.amount)
      );
      if (hasFile) {
        updates.push({ range: `Payable!P${rowNum}`, values: [["TRUE"]] });
        changed = true;
      }
    }

    // Q: Debit — parse amount to number
    if (!debit && amount) {
      const parsed = parseAmount(amount);
      if (parsed) {
        updates.push({ range: `Payable!Q${rowNum}`, values: [[parsed.value.toFixed(2)]] });
        changed = true;
      }
    }

    if (changed) {
      updated++;
      details.push(`Row ${rowNum}: ${supplierName || "?"} — enriched`);
    }
  }

  // Batch update all cells
  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: updates,
      },
    });
  }

  return { updated, details };
}

async function populateReceivable(): Promise<{ added: number }> {
  const sheets = getSheets();

  // Get Xero invoices (ACCREC = receivable)
  const xeroCache = db.getDataCache("xero", "invoices");
  if (!xeroCache?.data) return { added: 0 };

  const invoices = (xeroCache.data as {
    InvoiceID: string; InvoiceNumber: string; Type: string;
    Contact: { Name: string }; Total: number; AmountDue: number; AmountPaid: number;
    Status: string; DateString: string; DueDateString: string; CurrencyCode: string;
  }[]).filter(inv => inv.Type === "ACCREC");

  if (invoices.length === 0) return { added: 0 };

  // Read existing receivable data to avoid duplicates
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Receivable!F2:F500", // Invoice numbers column
  });
  const existingInvNums = new Set(
    (existing.data.values || []).map(r => (r[0] || "").trim()).filter(Boolean)
  );

  // Cross-reference with files
  const indexedFiles = db.getIndexedFiles({});

  // Build rows for new invoices
  const newRows: string[][] = [];
  for (const inv of invoices) {
    if (existingInvNums.has(inv.InvoiceNumber)) continue;

    // Try to find matching file
    const matchFile = indexedFiles.find(f =>
      f.name.includes(inv.InvoiceNumber) ||
      (f.vendor && inv.Contact?.Name && f.vendor.toLowerCase().includes(inv.Contact.Name.toLowerCase().substring(0, 5)))
    );

    const status = inv.Status === "PAID" ? "Paid" :
      inv.Status === "AUTHORISED" ? "Awaiting Payment" :
      inv.Status === "DRAFT" ? "Draft" : inv.Status;

    const date = inv.DateString ? new Date(inv.DateString).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
    const paymentDate = inv.AmountPaid > 0 ? date : "";

    newRows.push([
      date,                                          // A: Job Date
      "Invoice",                                     // B: Type
      matchFile?.downloadUrl || "",                   // C: Receipt Link
      "",                                            // D: Brand
      inv.Contact?.Name || "",                       // E: Client Name
      inv.InvoiceNumber || "",                       // F: Invoice Number
      "",                                            // G: Full Name
      "",                                            // H: Job Details
      `${inv.CurrencyCode} ${inv.Total.toFixed(2)}`, // I: Payment Amount
      inv.AmountDue > 0 ? `Due: ${inv.CurrencyCode} ${inv.AmountDue.toFixed(2)}` : `Paid in full`, // J: Payment Details
      status,                                        // K: Payment Status
      paymentDate,                                   // L: Payment Date
      "Bank",                                        // M: Payment method
      "HobbyLand",                                   // N: Account
      "",                                            // O: Remarks
      matchFile ? "TRUE" : "FALSE",                  // P: Receipt created?
    ]);
  }

  if (newRows.length === 0) return { added: 0 };

  // Append to sheet
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "Receivable!A:P",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: newRows },
  });

  return { added: newRows.length };
}

function parseAmount(amountStr: string): { value: number; currency: string } | null {
  if (!amountStr) return null;
  const cleaned = amountStr.replace(/,/g, "").trim();

  if (cleaned.includes("US$") || cleaned.includes("USD")) {
    const m = cleaned.match(/([\d.]+)/);
    return m ? { value: parseFloat(m[1]), currency: "USD" } : null;
  }
  if (cleaned.includes("₱") || cleaned.includes("PHP")) {
    const m = cleaned.match(/([\d.]+)/);
    return m ? { value: parseFloat(m[1]), currency: "PHP" } : null;
  }
  if (cleaned.includes("HK$") || cleaned.includes("HKD")) {
    const m = cleaned.match(/([\d.]+)/);
    return m ? { value: parseFloat(m[1]), currency: "HKD" } : null;
  }
  if (cleaned.includes("S$") || cleaned.includes("SGD")) {
    const m = cleaned.match(/([\d.]+)/);
    return m ? { value: parseFloat(m[1]), currency: "SGD" } : null;
  }
  if (cleaned.includes("NPR")) {
    const m = cleaned.match(/([\d.]+)/);
    return m ? { value: parseFloat(m[1]), currency: "NPR" } : null;
  }
  // Default: try to parse as number
  const m = cleaned.match(/([\d.]+)/);
  return m ? { value: parseFloat(m[1]), currency: "HKD" } : null;
}
