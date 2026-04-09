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

// In-memory cache of resolved folder IDs (parentId|name → folderId).
// Cleared on process restart; populated on first lookup per pipeline run.
const folderCache = new Map<string, string>();

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
    // Required when the parent folder is in a Shared Drive (e.g. Hobbyland Group).
    // Without this, Drive returns "File not found" for the folder ID.
    supportsAllDrives: true,
  });

  if (!res.data.id) throw new Error("Drive upload returned no file ID");
  return {
    fileId: res.data.id,
    webViewLink: res.data.webViewLink || `https://drive.google.com/file/d/${res.data.id}/view`,
  };
}

/**
 * Find a child folder by name under a given parent, creating it if missing.
 * Used to build the nested fiscal-year/app-name folder structure under each
 * top-level category folder. Caches results in memory for the duration of
 * the process.
 *
 * Andrea's April 2026 checklist item #3.
 */
export async function resolveOrCreateFolder(parentId: string, name: string): Promise<string> {
  const cacheKey = `${parentId}|${name}`;
  const cached = folderCache.get(cacheKey);
  if (cached) return cached;

  const auth = getAuthenticatedClient();
  const drive = google.drive({ version: "v3", auth });

  // Escape single quotes in the name for the search query
  const safeName = name.replace(/'/g, "\\'");
  const search = await drive.files.list({
    q: `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and name='${safeName}' and trashed=false`,
    fields: "files(id,name)",
    pageSize: 5,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    corpora: "allDrives",
  });

  const existing = search.data.files?.[0];
  if (existing?.id) {
    folderCache.set(cacheKey, existing.id);
    return existing.id;
  }

  // Not found — create it
  const created = await drive.files.create({
    requestBody: {
      name,
      parents: [parentId],
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id",
    supportsAllDrives: true,
  });
  if (!created.data.id) throw new Error(`Failed to create folder "${name}" under ${parentId}`);
  folderCache.set(cacheKey, created.data.id);
  return created.data.id;
}

/**
 * Compute the fiscal year folder name for a given transaction date.
 * Hobbyland fiscal year runs July to June, named "YYYY-YYYY".
 * Examples:
 *   2025-12-05 → "2025-2026" (July 2025 - June 2026)
 *   2026-04-09 → "2025-2026" (still in fiscal year that started July 2025)
 *   2026-07-15 → "2026-2027" (new fiscal year starts July 2026)
 *
 * Andrea's April 2026 checklist item #3 (clarified format on 2026-04-09).
 */
export function getFiscalYearFolderName(date: string | null | undefined): string {
  if (!date) return "unknown-fy";
  const d = new Date(date);
  if (isNaN(d.getTime())) return "unknown-fy";
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1; // 1-12
  // If month is July or later, fiscal year starts THIS year. Otherwise, last year.
  const fyStart = month >= 7 ? year : year - 1;
  return `${fyStart}-${fyStart + 1}`;
}

/**
 * Determine the "app" folder name for a receipt based on its description and vendor.
 * Andrea wants per-app organization within each fiscal year folder.
 *
 * Logic:
 *   1. If the description (jobDetails) contains a domain like "autoquotation.app"
 *      or "devehub.app", use that domain as the app folder.
 *   2. Else use the vendor name (e.g. "Anthropic", "GitHub", "OpenAI").
 *   3. Else "(uncategorized)".
 */
export function resolveAppFolderName(opts: {
  description: string | null | undefined;
  vendor: string | null | undefined;
}): string {
  // Extract domain from description if present
  if (opts.description) {
    const domainMatch = opts.description.match(/\b([a-z0-9][a-z0-9-]*\.(?:app|com|org|io|net|co|dev|ai|xyz|tech))\b/i);
    if (domainMatch) return domainMatch[1].toLowerCase();
  }
  // Fall back to vendor name (sanitized)
  if (opts.vendor) {
    return opts.vendor.replace(/[/\\:*?"<>|]/g, "_").trim();
  }
  return "(uncategorized)";
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
