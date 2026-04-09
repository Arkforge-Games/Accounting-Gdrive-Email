/**
 * Drive upload helper — uploads a file's content to a Google Drive folder
 * matching its expense category, so Andrea can find receipts organized by
 * type (Credit Card, Reimbursement, Supplier, etc.) directly in Drive.
 *
 * The folder IDs are configured via env vars:
 *   DRIVE_FOLDER_CC                 → "Credit Card"
 *   DRIVE_FOLDER_REIMBURSEMENT      → "Reimbursement"
 *   DRIVE_FOLDER_SUPPLIER           → "Supplier"
 *   DRIVE_FOLDER_FREELANCER         → "Supplier - Freelancer"
 *   DRIVE_FOLDER_STAFF              → "Staff"
 *   DRIVE_FOLDER_CASH               → "Cash"
 *   DRIVE_FOLDER_RECEIVABLE         → "Client - Receivable"
 *   DRIVE_FOLDER_UNSORTED           → "(to organise in new...)"
 *
 * Discover the IDs once via GET /api/admin/find-drive-folders.
 */
import { google } from "googleapis";
import { Readable } from "stream";
import { getAuthenticatedClient } from "./google";

/**
 * Maps a sheetType (or category fallback) to the destination Drive folder ID.
 * Returns null if no folder is configured for the given type, in which case
 * the caller should use the unsorted folder or skip the upload.
 */
export function getDriveFolderForSheetType(sheetType: string | null | undefined, category: string): string | null {
  const t = (sheetType || "").toLowerCase().trim();
  switch (t) {
    case "cc":
    case "credit card":
      return process.env.DRIVE_FOLDER_CC || null;
    case "reimbursement":
      return process.env.DRIVE_FOLDER_REIMBURSEMENT || null;
    case "freelancer":
    case "supplier - freelancer":
    case "freelancer - reimbursement":
      return process.env.DRIVE_FOLDER_FREELANCER || null;
    case "staff":
      return process.env.DRIVE_FOLDER_STAFF || null;
    case "cash":
      return process.env.DRIVE_FOLDER_CASH || null;
    case "supplier":
      return process.env.DRIVE_FOLDER_SUPPLIER || null;
    case "invoice":
      return process.env.DRIVE_FOLDER_RECEIVABLE || null;
    default:
      // Fall back to category-based routing
      if (category === "invoice") return process.env.DRIVE_FOLDER_RECEIVABLE || null;
      if (category === "reimbursement") return process.env.DRIVE_FOLDER_REIMBURSEMENT || null;
      return process.env.DRIVE_FOLDER_UNSORTED || null;
  }
}

export interface DriveUploadResult {
  fileId: string;
  webViewLink: string;
}

/**
 * Upload a file's content to a specific Drive folder.
 *
 * @param folderId  Destination Drive folder ID
 * @param name      Filename to use in Drive (include extension)
 * @param mimeType  MIME type (e.g. "application/pdf")
 * @param content   File bytes
 * @returns         The new Drive file's ID and webViewLink (clickable URL)
 */
export async function uploadToDrive(
  folderId: string,
  name: string,
  mimeType: string,
  content: Buffer,
): Promise<DriveUploadResult> {
  const auth = getAuthenticatedClient();
  const drive = google.drive({ version: "v3", auth });

  const res = await drive.files.create({
    requestBody: {
      name,
      parents: [folderId],
      mimeType,
    },
    media: {
      mimeType,
      body: Readable.from(content),
    },
    fields: "id,webViewLink",
  });

  if (!res.data.id) throw new Error("Drive upload returned no file ID");
  return {
    fileId: res.data.id,
    webViewLink: res.data.webViewLink || `https://drive.google.com/file/d/${res.data.id}/view`,
  };
}

/**
 * Build a descriptive filename for the Drive upload.
 * Format: "YYYY-MM-DD - Vendor - Amount - InvoiceNo.pdf"
 * Example: "2025-12-05 - Cloudflare, Inc. - USD 14.20 - IN 52791905.pdf"
 */
export function buildDriveFilename(opts: {
  date: string | null | undefined;
  vendor: string | null | undefined;
  amount: string | null | undefined;
  currency: string | null | undefined;
  invoiceNumber: string | null | undefined;
  originalName: string;
}): string {
  const parts: string[] = [];
  if (opts.date) parts.push(opts.date.substring(0, 10));
  if (opts.vendor) parts.push(opts.vendor);
  if (opts.amount) parts.push(`${opts.currency || ""} ${opts.amount}`.trim());
  if (opts.invoiceNumber) parts.push(opts.invoiceNumber);
  let base = parts.join(" - ").trim();
  // Sanitize: remove characters Drive doesn't like in filenames
  base = base.replace(/[/\\:*?"<>|]/g, "_").replace(/\s+/g, " ");
  // Always end with the original extension if there is one
  const extMatch = opts.originalName.match(/\.[a-z0-9]{2,5}$/i);
  const ext = extMatch ? extMatch[0] : ".pdf";
  if (!base) base = opts.originalName.replace(ext, "");
  if (!base.toLowerCase().endsWith(ext.toLowerCase())) base += ext;
  return base;
}
