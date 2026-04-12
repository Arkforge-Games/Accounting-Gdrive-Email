/**
 * Receipt of Services generator.
 *
 * Andrea's April 2026 checklist: for each staff member/freelancer, create a
 * Google Sheet "Receipt of Services" per fiscal year. Each monthly salary
 * payment gets added as a row. The person signs it once.
 *
 * Template: https://docs.google.com/spreadsheets/d/1sKW1kf-b9t6E9YPHIyukQ8pb5ZGKwNS2Q6Ue_y0X184
 *
 * Structure:
 *   Row 2:  "Receipt of Services" title
 *   Row 8:  Full Name (service provider)
 *   Row 26: Headers: MM/DD/YYYY | Remark | Local Currency (PHP) | Amount Total (HKD)
 *   Row 27+: Monthly entries
 *   Row 29+: Cumulative Total (SUM formulas)
 *   Row 35+: Signature
 */
import { google } from "googleapis";
import { getAuthenticatedClient } from "./google";
import { getReceiptSheet, saveReceiptSheet } from "./db";
import { getFiscalYearFolderName, resolveOrCreateFolder } from "./drive-upload";

const TEMPLATE_SHEET_ID = "1sKW1kf-b9t6E9YPHIyukQ8pb5ZGKwNS2Q6Ue_y0X184";

// Drive folder IDs for staff/freelancer receipts
const STAFF_FOLDER_ID = process.env.DRIVE_FOLDER_STAFF || "";
const FREELANCER_FOLDER_ID = process.env.DRIVE_FOLDER_FREELANCER || "";

/**
 * Get or create a Receipt of Services sheet for a recipient in a fiscal year.
 * If it already exists (in the DB), returns the cached sheet ID.
 * Otherwise, copies the template and creates a new sheet.
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

  // Copy the template
  const title = `Receipt of Services - ${recipientName} - FY ${fiscalYear}`;
  const copy = await drive.files.copy({
    fileId: TEMPLATE_SHEET_ID,
    requestBody: {
      name: title,
      parents: [fyFolderId],
    },
    supportsAllDrives: true,
    fields: "id,webViewLink",
  });

  const newSheetId = copy.data.id!;
  const sheetUrl = copy.data.webViewLink || `https://docs.google.com/spreadsheets/d/${newSheetId}`;

  // Fill in the service provider name (row 8, column C-D)
  await sheets.spreadsheets.values.update({
    spreadsheetId: newSheetId,
    range: "C8:D8",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[recipientName, ""]] },
  });

  // Save to DB
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

  // If we're about to overwrite the Cumulative Total row, insert a row first
  // Cumulative Total is typically at row 29 in the template, but shifts as we add rows
  const cumTotalRow = nextRow + 1;

  // Insert a row above the cumulative total if needed (push it down)
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

  // Update cumulative total row (now at cumTotalRow + 1 because we inserted a row)
  const totalRow = cumTotalRow + 1;
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
