/**
 * Receipt of Services generator.
 *
 * Andrea's April 2026 checklist: for each staff member/freelancer, create a
 * Google Sheet "Receipt of Services" per fiscal year. Each monthly salary
 * payment gets added as a row. The person signs it once.
 *
 * The sheet is created FROM SCRATCH (not copied from a template) matching
 * the layout Andrea shared as a sample.
 *
 * Structure:
 *   Row 2:  "Receipt of Services" title (merged, centered, bold)
 *   Row 5:  SERVICE PROVIDER INFO / BANK/E-WALLET INFO
 *   Row 8:  Full Name / Bank
 *   Row 10: Designation / Account Name
 *   Row 13: Address / Account No.
 *   Row 15: Citizenship / E-wallet & No.
 *   Row 18: CLIENT INFO
 *   Row 21: HobbyLand Technology Limited / Email
 *   Row 23: Address / Phone
 *   Row 26: Data headers: Date | Remark | Local Currency | Amount Total (HKD)
 *   Row 27+: Monthly entries (added by addReceiptEntry)
 *   Row 29:  Cumulative Total (SUM formulas)
 *   Row 35:  Signature line
 */
import { google } from "googleapis";
import { getAuthenticatedClient } from "./google";
import { getReceiptSheet, saveReceiptSheet } from "./db";
import { getFiscalYearFolderName, resolveOrCreateFolder } from "./drive-upload";

// Drive folder IDs for staff/freelancer receipts
const STAFF_FOLDER_ID = process.env.DRIVE_FOLDER_STAFF || "";
const FREELANCER_FOLDER_ID = process.env.DRIVE_FOLDER_FREELANCER || "";

/**
 * Get or create a Receipt of Services sheet for a recipient in a fiscal year.
 * If it already exists (in the DB), returns the cached sheet ID.
 * Otherwise, creates a new sheet from scratch with the full layout.
 */
export async function getOrCreateReceiptSheet(
  recipientName: string,
  fiscalYear: string,
  isFreelancer: boolean,
): Promise<{ sheetId: string; sheetUrl: string }> {
  // Check if already exists in DB
  const existing = getReceiptSheet(recipientName, fiscalYear);
  if (existing) {
    return { sheetId: existing.sheetId, sheetUrl: existing.sheetUrl || `https://docs.google.com/spreadsheets/d/${existing.sheetId}` };
  }

  const auth = getAuthenticatedClient();
  const drive = google.drive({ version: "v3", auth });
  const sheets = google.sheets({ version: "v4", auth });

  // Determine the destination folder
  const parentFolderId = isFreelancer ? FREELANCER_FOLDER_ID : STAFF_FOLDER_ID;
  if (!parentFolderId) {
    throw new Error(`No Drive folder configured for ${isFreelancer ? "Freelancer" : "Staff"}`);
  }

  // Create fiscal year subfolder
  const fyFolderId = await resolveOrCreateFolder(parentFolderId, fiscalYear);

  // 1. Create the spreadsheet from scratch
  const title = `Receipt of Services - ${recipientName} - FY ${fiscalYear}`;
  const createRes = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: [{
        properties: {
          sheetId: 0,
          title: "Receipt of Services",
          gridProperties: { rowCount: 50, columnCount: 9 },
        },
      }],
    },
    fields: "spreadsheetId,spreadsheetUrl",
  });

  const newSheetId = createRes.data.spreadsheetId!;
  const sheetUrl = createRes.data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${newSheetId}`;

  // 2. Populate all cells with the receipt layout
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: newSheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: [
        // Title
        { range: "B2", values: [["Receipt of Services"]] },
        // Service Provider Info
        { range: "A5", values: [["SERVICE PROVIDER INFO:"]] },
        { range: "E5", values: [["BANK/E-WALLET INFO:"]] },
        // Provider details
        { range: "A8:D8", values: [["Full Name", ":", recipientName, ""]] },
        { range: "E8:G8", values: [["Bank", ":", ""]] },
        { range: "A10:D10", values: [["Designation", ":", "", ""]] },
        { range: "E10:G10", values: [["Account Name", ":", ""]] },
        { range: "A13:D13", values: [["Address:", ":", "", ""]] },
        { range: "E13:G13", values: [["Account No.", ":", ""]] },
        { range: "A15:D15", values: [["Citizenship", ":", "", ""]] },
        { range: "E15:G15", values: [["E-wallet & No.", ":", ""]] },
        // Client Info
        { range: "A18", values: [["CLIENT INFO:"]] },
        { range: "A21:H21", values: [["Full Name", ":", "Hobbyland Technology Limited", "", "Email", ":", "info@hkdesignpro.com", ""]] },
        { range: "A23:H23", values: [["Address", ":", "9N Century Industrial Centre, 33-35 Au Pui Wan St, Fo Tan, Hong Kong", "", "Phone", "", "852 6755 2667", ""]] },
        // Data table headers
        { range: "A26:H26", values: [["MM/DD/YYYY", "", "Remark\n(Cash/Bank Transfer)", "", `Local Currency`, "", "", "Amount Total\n(HKD)"]] },
        // Cumulative Total (row 29 — will shift down as entries are inserted)
        { range: "C29:H29", values: [["Cumulative Total:", "", "₱0.00", "", "", "$0.00"]] },
        // Signature
        { range: "B35", values: [["Signature"]] },
      ],
    },
  });

  // 3. Apply formatting (bold headers, merge title, column widths)
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: newSheetId,
    requestBody: {
      requests: [
        // Merge title row (B2:H2)
        {
          mergeCells: {
            range: { sheetId: 0, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 8 },
            mergeType: "MERGE_ALL",
          },
        },
        // Title formatting: bold, 18pt, centered
        {
          repeatCell: {
            range: { sheetId: 0, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 8 },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true, fontSize: 18 },
                horizontalAlignment: "CENTER",
              },
            },
            fields: "userEnteredFormat(textFormat,horizontalAlignment)",
          },
        },
        // Section headers bold (rows 5, 18, 26)
        ...[4, 17, 25].map(row => ({
          repeatCell: {
            range: { sheetId: 0, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: 8 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: "userEnteredFormat(textFormat)",
          },
        })),
        // Field labels bold (rows 8, 10, 13, 15, 21, 23)
        ...[7, 9, 12, 14, 20, 22].map(row => ({
          repeatCell: {
            range: { sheetId: 0, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: 2 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: "userEnteredFormat(textFormat)",
          },
        })),
        // Cumulative Total row — green background
        {
          repeatCell: {
            range: { sheetId: 0, startRowIndex: 28, endRowIndex: 29, startColumnIndex: 0, endColumnIndex: 9 },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.85, green: 0.92, blue: 0.83 },
                textFormat: { bold: true },
              },
            },
            fields: "userEnteredFormat(backgroundColor,textFormat)",
          },
        },
        // Column widths
        { updateDimensionProperties: { range: { sheetId: 0, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 100 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId: 0, dimension: "COLUMNS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 30 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId: 0, dimension: "COLUMNS", startIndex: 2, endIndex: 3 }, properties: { pixelSize: 180 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId: 0, dimension: "COLUMNS", startIndex: 3, endIndex: 4 }, properties: { pixelSize: 30 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId: 0, dimension: "COLUMNS", startIndex: 4, endIndex: 5 }, properties: { pixelSize: 120 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId: 0, dimension: "COLUMNS", startIndex: 5, endIndex: 6 }, properties: { pixelSize: 30 }, fields: "pixelSize" } },
        { updateDimensionProperties: { range: { sheetId: 0, dimension: "COLUMNS", startIndex: 7, endIndex: 8 }, properties: { pixelSize: 120 }, fields: "pixelSize" } },
        // Border under signature line (row 34)
        {
          updateBorders: {
            range: { sheetId: 0, startRowIndex: 33, endRowIndex: 34, startColumnIndex: 1, endColumnIndex: 4 },
            bottom: { style: "SOLID", width: 1, color: { red: 0, green: 0, blue: 0 } },
          },
        },
      ],
    },
  });

  // 4. Move the file to the correct Drive folder (new sheets are created in My Drive root)
  const getFile = await drive.files.get({
    fileId: newSheetId,
    fields: "parents",
    supportsAllDrives: true,
  });
  const currentParents = getFile.data.parents || [];
  await drive.files.update({
    fileId: newSheetId,
    addParents: fyFolderId,
    removeParents: currentParents.join(","),
    fields: "id,parents",
    supportsAllDrives: true,
  });

  // 5. Save to DB
  saveReceiptSheet({
    recipientName,
    fiscalYear,
    sheetId: newSheetId,
    sheetUrl,
    driveFolderId: fyFolderId,
  });

  return { sheetId: newSheetId, sheetUrl };
}

/**
 * Add a monthly salary entry to the recipient's Receipt of Services sheet.
 *
 * Finds the next empty row in the data section (starting at row 27),
 * writes the entry, and updates the cumulative total row.
 */
export async function addReceiptEntry(
  sheetId: string,
  entry: {
    date: string;       // MM/DD/YYYY format
    remark: string;     // e.g. "Salary March 2026 - Cash/Bank Transfer"
    localAmount: number; // Amount in local currency (PHP)
    localCurrency: string;
    hkdAmount: number;   // HKD equivalent
  },
): Promise<void> {
  const auth = getAuthenticatedClient();
  const sheets = google.sheets({ version: "v4", auth });

  // Find the first sheet tab's ID for batchUpdate
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "sheets(properties(sheetId,title))",
  });
  const firstSheetTabId = meta.data.sheets?.[0]?.properties?.sheetId || 0;

  // Read column A starting from row 27 to find the next empty row
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: "A27:A100",
  });
  const existingRows = existing.data.values || [];
  let nextRow = 27;
  for (let i = 0; i < existingRows.length; i++) {
    if (existingRows[i]?.[0] && String(existingRows[i][0]).trim() !== "") {
      nextRow = 27 + i + 1;
    }
  }

  // Insert a row to push the cumulative total down
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      requests: [{
        insertDimension: {
          range: {
            sheetId: firstSheetTabId,
            dimension: "ROWS",
            startIndex: nextRow - 1, // 0-based
            endIndex: nextRow,
          },
          inheritFromBefore: true,
        },
      }],
    },
  });

  // Write the entry
  const localFormatted = entry.localCurrency === "PHP"
    ? `₱${entry.localAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`
    : `${entry.localCurrency} ${entry.localAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  const hkdFormatted = `$${entry.hkdAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `A${nextRow}:H${nextRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        entry.date,
        "", // B empty
        entry.remark,
        "", // D empty
        localFormatted,
        "", // F empty
        "", // G empty
        hkdFormatted,
      ]],
    },
  });

  // Update cumulative total row (shifted down by 1 due to insert)
  const totalRow = nextRow + 2; // cumulative total is 2 rows below the last data entry
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `E${totalRow}:H${totalRow}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[
        `=SUM(E27:E${nextRow})`, // Local currency total
        "",
        "",
        `=SUM(H27:H${nextRow})`, // HKD total
      ]],
    },
  });
}

/**
 * Format a date as MM/DD/YYYY for the receipt sheet.
 */
export function formatReceiptDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}
