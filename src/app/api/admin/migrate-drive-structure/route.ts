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
import * as db from "@/lib/db";

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

    // Build a lookup from Drive file ID → file_index row so we can use the
    // real notes/vendor (not the filename) when computing the app folder.
    const indexedFiles = db.getIndexedFiles({});
    const byDriveId = new Map<string, db.IndexedFile>();
    for (const f of indexedFiles) {
      if (f.driveFileId) byDriveId.set(f.driveFileId, f);
    }

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

        // Look up the file in our DB by drive_file_id to get the real notes
        // (jobDetails) which contain the domain for app folder routing.
        const indexed = byDriveId.get(file.id);

        // Determine date — prefer DB transaction_date, fall back to filename parse
        let date: string | null = indexed?.date || indexed?.transactionDate || null;
        let vendor: string | null = indexed?.vendor || null;
        if (!date) {
          const dateMatch = file.name.match(/^(\d{4}-\d{2}-\d{2})\s*-\s*([^-]+?)\s*-/);
          if (dateMatch) {
            date = dateMatch[1];
            if (!vendor) vendor = dateMatch[2].trim();
          }
        }
        if (!date) {
          // Cannot determine date — skip
          result.skipped++;
          continue;
        }

        // Compute destination — pass the real notes so resolveAppFolderName can
        // extract the domain (e.g. "autoquotation.app") instead of falling back
        // to the vendor name ("Cloudflare, Inc.")
        const fiscalYear = getFiscalYearFolderName(date);
        const appName = resolveAppFolderName({
          description: indexed?.notes || file.name,
          vendor,
        });

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
