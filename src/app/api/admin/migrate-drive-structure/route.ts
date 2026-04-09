/**
 * One-shot migration: reorganize existing Drive files in flat category folders
 * into the new nested structure: <category>/<fiscal-year>/<app>/<filename>
 *
 * Walks each top-level category folder (Credit Card, Reimbursement, etc.),
 * skips files that are already inside a fiscal-year subfolder, and moves the
 * rest into the appropriate nested location.
 *
 * The new filename format includes the date and vendor, so we can parse those
 * back out to determine the destination fiscal year and app folder.
 *
 * Andrea's April 2026 checklist item #3.
 *
 * POST /api/admin/migrate-drive-structure
 */
import { NextResponse } from "next/server";
import { google } from "googleapis";
import { getAuthenticatedClient } from "@/lib/google";
import { resolveOrCreateFolder, getFiscalYearFolderName, resolveAppFolderName } from "@/lib/drive-upload";

const CATEGORY_FOLDER_IDS: Record<string, string | undefined> = {
  "Credit Card": process.env.DRIVE_FOLDER_CC,
  "Reimbursement": process.env.DRIVE_FOLDER_REIMBURSEMENT,
  "Supplier": process.env.DRIVE_FOLDER_SUPPLIER,
  "Supplier - Freelancer": process.env.DRIVE_FOLDER_FREELANCER,
  "Staff": process.env.DRIVE_FOLDER_STAFF,
  "Cash": process.env.DRIVE_FOLDER_CASH,
  "Client - Receivable": process.env.DRIVE_FOLDER_RECEIVABLE,
};

interface MigrationResult {
  category: string;
  scanned: number;
  moved: number;
  skipped: number;
  errors: number;
  movedFiles: Array<{ name: string; newPath: string }>;
}

export async function POST() {
  try {
    const auth = getAuthenticatedClient();
    const drive = google.drive({ version: "v3", auth });

    const results: MigrationResult[] = [];

    for (const [categoryName, folderId] of Object.entries(CATEGORY_FOLDER_IDS)) {
      if (!folderId) continue;

      // List ONLY non-folder children (PDFs etc.) of this top-level folder
      const list = await drive.files.list({
        q: `'${folderId}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false`,
        fields: "files(id,name,parents)",
        pageSize: 1000,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        corpora: "allDrives",
      });

      const files = list.data.files || [];
      const result: MigrationResult = {
        category: categoryName,
        scanned: files.length,
        moved: 0,
        skipped: 0,
        errors: 0,
        movedFiles: [],
      };

      for (const file of files) {
        if (!file.id || !file.name) {
          result.errors++;
          continue;
        }

        // Parse the filename to extract date and vendor.
        // Expected format: "YYYY-MM-DD - Vendor - Currency Amount - InvoiceNo.pdf"
        const dateMatch = file.name.match(/^(\d{4}-\d{2}-\d{2})\s*-\s*([^-]+?)\s*-/);
        if (!dateMatch) {
          // Filename doesn't match the expected format — skip (likely a manual upload)
          result.skipped++;
          continue;
        }
        const date = dateMatch[1];
        const vendor = dateMatch[2].trim();

        // Compute destination
        const fiscalYear = getFiscalYearFolderName(date);
        // Try to extract app from the filename's description portion (between vendor and amount/invoice).
        // Fall back to vendor name.
        const appName = resolveAppFolderName({ description: file.name, vendor });

        try {
          const fyFolderId = await resolveOrCreateFolder(folderId, fiscalYear);
          const appFolderId = await resolveOrCreateFolder(fyFolderId, appName);

          // Skip if already in the right place
          const currentParents = file.parents || [];
          if (currentParents.includes(appFolderId)) {
            result.skipped++;
            continue;
          }

          // Move: addParents=appFolderId, removeParents=current
          await drive.files.update({
            fileId: file.id,
            addParents: appFolderId,
            removeParents: currentParents.join(","),
            fields: "id,parents",
            supportsAllDrives: true,
          });

          result.moved++;
          result.movedFiles.push({
            name: file.name,
            newPath: `${categoryName}/${fiscalYear}/${appName}/`,
          });
        } catch (err) {
          console.error(`[migrate] failed to move ${file.name}:`, err instanceof Error ? err.message : err);
          result.errors++;
        }
      }

      results.push(result);
    }

    const totalMoved = results.reduce((s, r) => s + r.moved, 0);
    const totalSkipped = results.reduce((s, r) => s + r.skipped, 0);
    const totalErrors = results.reduce((s, r) => s + r.errors, 0);

    return NextResponse.json({
      success: true,
      summary: {
        totalMoved,
        totalSkipped,
        totalErrors,
      },
      details: results,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
