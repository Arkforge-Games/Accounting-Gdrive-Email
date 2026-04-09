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

    // Iterate from the DB side: every file_index row that has a drive_file_id
    // is a previously-uploaded receipt. Look up its current Drive location,
    // compute where it should be, and move it if different.
    const indexedFiles = db.getIndexedFiles({}).filter(f => f.driveFileId);

    // Reverse-lookup: which env var folder ID maps to which category name
    const folderIdToCategory: Record<string, string> = {};
    for (const [name, id] of Object.entries(CATEGORY_FOLDER_IDS)) {
      if (id) folderIdToCategory[id] = name;
    }

    const result: MigrationResult = {
      category: "all",
      scanned: indexedFiles.length,
      moved: 0,
      skipped: 0,
      errors: 0,
      movedFiles: [],
    };

    for (const f of indexedFiles) {
      if (!f.driveFileId) continue;

      try {
        // Get current Drive parents
        const meta = await drive.files.get({
          fileId: f.driveFileId,
          fields: "id,name,parents",
          supportsAllDrives: true,
        });
        const currentParents = meta.data.parents || [];
        if (currentParents.length === 0) {
          result.skipped++;
          continue;
        }

        // Walk up to find the top-level category folder.
        // Strategy: any current parent (or grandparent) that matches one of our
        // configured category folder IDs is the category we route under.
        let categoryFolderId: string | null = null;
        for (const pid of currentParents) {
          if (folderIdToCategory[pid]) { categoryFolderId = pid; break; }
        }
        if (!categoryFolderId) {
          // Walk up parents recursively (max 5 levels) to find the category
          let cursor = currentParents[0];
          for (let i = 0; i < 5 && cursor && !categoryFolderId; i++) {
            const parentMeta = await drive.files.get({
              fileId: cursor,
              fields: "id,parents",
              supportsAllDrives: true,
            });
            if (folderIdToCategory[cursor]) { categoryFolderId = cursor; break; }
            cursor = parentMeta.data.parents?.[0] || "";
          }
        }
        if (!categoryFolderId) {
          // Could not determine the category — skip
          result.skipped++;
          continue;
        }

        // Compute target nested location
        const date = f.transactionDate || f.date;
        if (!date) { result.skipped++; continue; }
        const fiscalYear = getFiscalYearFolderName(date);
        const appName = resolveAppFolderName({ description: f.notes, vendor: f.vendor });
        const fyFolderId = await resolveOrCreateFolder(categoryFolderId, fiscalYear);
        const appFolderId = await resolveOrCreateFolder(fyFolderId, appName);

        // Skip if already in the right place
        if (currentParents.includes(appFolderId)) {
          result.skipped++;
          continue;
        }

        // Move: addParents=appFolderId, removeParents=current
        await drive.files.update({
          fileId: f.driveFileId,
          addParents: appFolderId,
          removeParents: currentParents.join(","),
          fields: "id,parents",
          supportsAllDrives: true,
        });

        result.moved++;
        result.movedFiles.push({
          name: meta.data.name || f.name,
          newPath: `${folderIdToCategory[categoryFolderId]}/${fiscalYear}/${appName}/`,
        });
      } catch (err) {
        console.error(`[migrate] failed for ${f.driveFileId}:`, err instanceof Error ? err.message : err);
        result.errors++;
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        totalMoved: result.moved,
        totalSkipped: result.skipped,
        totalErrors: result.errors,
        scanned: result.scanned,
      },
      movedFiles: result.movedFiles,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
