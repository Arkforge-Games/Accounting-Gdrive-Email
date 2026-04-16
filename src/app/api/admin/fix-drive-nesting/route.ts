/**
 * Fix Drive folder nesting by scanning actual Drive folders (not just DB).
 *
 * GET  → Preview: list all files in old-style folders that need moving
 * POST → Execute: move files to correct nested structure + delete empty old folders
 *
 * Handles:
 *   - "2025-2026" fiscal year folders → rename/move to "Jul 2025 - Jun 2026"
 *   - Domain-name app folders (e.g. "adgohk.com") → move files to vendor-name folders
 */
import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { getAuthenticatedClient } from "@/lib/google";
import { resolveOrCreateFolder, getFiscalYearFolderName, resolveAppFolderName } from "@/lib/drive-upload";

const CATEGORY_FOLDERS: Record<string, string | undefined> = {
  "Credit Card": process.env.DRIVE_FOLDER_CC,
  "Reimbursement": process.env.DRIVE_FOLDER_REIMBURSEMENT,
  "Supplier": process.env.DRIVE_FOLDER_SUPPLIER,
  "Supplier - Freelancer": process.env.DRIVE_FOLDER_FREELANCER,
  "Staff": process.env.DRIVE_FOLDER_STAFF,
  "Cash": process.env.DRIVE_FOLDER_CASH,
  "Client - Receivable": process.env.DRIVE_FOLDER_RECEIVABLE,
};

// Old fiscal year folder name pattern (e.g. "2025-2026")
const OLD_FY_REGEX = /^(\d{4})-(\d{4})$/;

// Known vendor mappings: domain → vendor name
const DOMAIN_TO_VENDOR: Record<string, string> = {
  "adgohk.com": "Cloudflare",
  "autoquotation.app": "Cloudflare",
  "blueapex.io": "Cloudflare",
  "bookmaster.io": "Cloudflare",
  "brand-it.io": "Cloudflare",
  "definertech.com": "Cloudflare",
  "devehub.app": "Cloudflare",
  "hkclawmachine.com": "Cloudflare",
  "hkeventpro.com": "Cloudflare",
  "hkperformerpro.com": "Cloudflare",
  "hobbyland-group.com": "Cloudflare",
  "hongkongmagical.com": "Cloudflare",
  "kidi-edu.org": "Cloudflare",
  "option4all.com": "Cloudflare",
};

async function listFolderContents(drive: ReturnType<typeof google.drive>, folderId: string) {
  const items: Array<{ id: string; name: string; mimeType: string; parents: string[] }> = [];
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "nextPageToken,files(id,name,mimeType,parents)",
      pageSize: 100,
      pageToken,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      corpora: "allDrives",
    });
    items.push(...(res.data.files || []).map(f => ({
      id: f.id!,
      name: f.name!,
      mimeType: f.mimeType!,
      parents: f.parents || [],
    })));
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);
  return items;
}

export async function GET(req: NextRequest) {
  try {
    const auth = getAuthenticatedClient();
    const drive = google.drive({ version: "v3", auth });
    const category = req.nextUrl.searchParams.get("category") || "Credit Card";
    const categoryFolderId = CATEGORY_FOLDERS[category];
    if (!categoryFolderId) {
      return NextResponse.json({ error: `No folder configured for "${category}"` }, { status: 400 });
    }

    // List top-level items in category folder
    const topLevel = await listFolderContents(drive, categoryFolderId);
    const folders = topLevel.filter(f => f.mimeType === "application/vnd.google-apps.folder");

    const report: Array<{
      folderName: string;
      folderId: string;
      type: string;
      contents: Array<{ name: string; type: string }>;
      action: string;
    }> = [];

    for (const folder of folders) {
      const contents = await listFolderContents(drive, folder.id);

      if (OLD_FY_REGEX.test(folder.name)) {
        // Old fiscal year folder — scan subfolders
        const subfolders = contents.filter(c => c.mimeType === "application/vnd.google-apps.folder");
        const files = contents.filter(c => c.mimeType !== "application/vnd.google-apps.folder");

        for (const sub of subfolders) {
          const subContents = await listFolderContents(drive, sub.id);
          const isDomain = DOMAIN_TO_VENDOR[sub.name];
          report.push({
            folderName: `${folder.name}/${sub.name}`,
            folderId: sub.id,
            type: isDomain ? "domain-folder" : "app-folder",
            contents: subContents.map(c => ({ name: c.name, type: c.mimeType })),
            action: isDomain
              ? `Move ${subContents.length} files to "Jul ${folder.name.split("-")[0].trim()} - Jun ${folder.name.split("-")[1].trim()}/${isDomain}"`
              : subContents.length === 0 ? "Delete empty folder" : `Move to correct FY name`,
          });
        }

        if (files.length > 0) {
          report.push({
            folderName: folder.name,
            folderId: folder.id,
            type: "old-fy-with-files",
            contents: files.map(c => ({ name: c.name, type: c.mimeType })),
            action: `Move ${files.length} loose files to correct FY folder`,
          });
        }
      } else {
        // Could be a correct FY folder or something else
        report.push({
          folderName: folder.name,
          folderId: folder.id,
          type: folder.name.startsWith("Jul ") ? "correct-fy" : "unknown",
          contents: contents.slice(0, 5).map(c => ({ name: c.name, type: c.mimeType })),
          action: folder.name.startsWith("Jul ") ? "Keep (correct format)" : "Review",
        });
      }
    }

    return NextResponse.json({ category, categoryFolderId, folders: report });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = getAuthenticatedClient();
    const drive = google.drive({ version: "v3", auth });

    let category = "Credit Card";
    try {
      const body = await req.json();
      if (body?.category) category = body.category;
    } catch { /* default */ }

    const categoryFolderId = CATEGORY_FOLDERS[category];
    if (!categoryFolderId) {
      return NextResponse.json({ error: `No folder configured for "${category}"` }, { status: 400 });
    }

    const topLevel = await listFolderContents(drive, categoryFolderId);
    const results: Array<{ action: string; from: string; to: string; count?: number; error?: string }> = [];

    for (const folder of topLevel.filter(f => f.mimeType === "application/vnd.google-apps.folder")) {
      const match = OLD_FY_REGEX.exec(folder.name);
      if (!match) continue;

      // This is an old FY folder like "2025-2026"
      // Compute correct FY name: "2025-2026" → "Jul 2025 - Jun 2026"
      const startYear = match[1];
      const endYear = match[2];
      const correctFyName = `Jul ${startYear} - Jun ${endYear}`;

      // Get or create the correct FY folder
      const correctFyId = await resolveOrCreateFolder(categoryFolderId, correctFyName);

      // Scan subfolders in old FY
      const subItems = await listFolderContents(drive, folder.id);

      for (const sub of subItems) {
        if (sub.mimeType === "application/vnd.google-apps.folder") {
          // It's a subfolder (domain-name or vendor-name)
          const vendorName = DOMAIN_TO_VENDOR[sub.name] || resolveAppFolderName({ description: null, vendor: sub.name });
          const correctAppId = await resolveOrCreateFolder(correctFyId, vendorName);

          // Move all files from old folder to correct folder
          const files = await listFolderContents(drive, sub.id);
          let movedCount = 0;
          for (const file of files) {
            if (file.mimeType === "application/vnd.google-apps.folder") continue; // skip nested folders
            try {
              await drive.files.update({
                fileId: file.id,
                addParents: correctAppId,
                removeParents: sub.id,
                fields: "id",
                supportsAllDrives: true,
              });
              movedCount++;
            } catch (err) {
              results.push({ action: "error", from: `${folder.name}/${sub.name}/${file.name}`, to: correctFyName, error: (err as Error).message });
            }
          }

          if (movedCount > 0) {
            results.push({ action: "moved", from: `${folder.name}/${sub.name}`, to: `${correctFyName}/${vendorName}`, count: movedCount });
          }

          // Delete the now-empty old subfolder
          const remaining = await listFolderContents(drive, sub.id);
          if (remaining.length === 0) {
            try {
              await drive.files.update({
                fileId: sub.id,
                requestBody: { trashed: true },
                supportsAllDrives: true,
              });
              results.push({ action: "deleted-folder", from: `${folder.name}/${sub.name}`, to: "" });
            } catch (delErr) {
              results.push({ action: "delete-failed", from: `${folder.name}/${sub.name}`, to: "", error: (delErr as Error).message });
            }
          }
        } else {
          // Loose file in old FY folder — move to correct FY root (or try to determine vendor)
          try {
            // Try to parse vendor from filename: "YYYY-MM-DD - Vendor - Amount.pdf"
            const vendorMatch = sub.name.match(/^\d{4}-\d{2}-\d{2}\s*-\s*(.+?)\s*-\s*/);
            const vendor = vendorMatch ? resolveAppFolderName({ description: null, vendor: vendorMatch[1] }) : "(uncategorized)";
            const appId = await resolveOrCreateFolder(correctFyId, vendor);
            await drive.files.update({
              fileId: sub.id,
              addParents: appId,
              removeParents: folder.id,
              fields: "id",
              supportsAllDrives: true,
            });
            results.push({ action: "moved-file", from: `${folder.name}/${sub.name}`, to: `${correctFyName}/${vendor}` });
          } catch (err) {
            results.push({ action: "error", from: `${folder.name}/${sub.name}`, to: "", error: (err as Error).message });
          }
        }
      }

      // Delete old FY folder if empty
      const remainingTop = await listFolderContents(drive, folder.id);
      if (remainingTop.length === 0) {
        try {
          await drive.files.update({
            fileId: folder.id,
            requestBody: { trashed: true },
            supportsAllDrives: true,
          });
          results.push({ action: "deleted-fy-folder", from: folder.name, to: "" });
        } catch (delErr) {
          results.push({ action: "delete-fy-failed", from: folder.name, to: "", error: (delErr as Error).message });
        }
      }
    }

    // Also clean up empty/duplicate folders in the correct FY folder
    const correctFyFolders = topLevel.filter(f =>
      f.mimeType === "application/vnd.google-apps.folder" && f.name.startsWith("Jul ")
    );
    for (const fyFolder of correctFyFolders) {
      const appFolders = await listFolderContents(drive, fyFolder.id);
      for (const app of appFolders.filter(a => a.mimeType === "application/vnd.google-apps.folder")) {
        const appContents = await listFolderContents(drive, app.id);
        // Delete empty app folders
        if (appContents.length === 0) {
          try {
            await drive.files.update({
              fileId: app.id,
              requestBody: { trashed: true },
              supportsAllDrives: true,
            });
            results.push({ action: "deleted-empty-app", from: `${fyFolder.name}/${app.name}`, to: "" });
          } catch (err) {
            results.push({ action: "delete-app-failed", from: `${fyFolder.name}/${app.name}`, to: "", error: (err as Error).message });
          }
          continue;
        }
        // Merge "Cloudflare, Inc." into "Cloudflare" etc
        const cleanName = resolveAppFolderName({ description: null, vendor: app.name });
        if (cleanName !== app.name) {
          const correctAppId = await resolveOrCreateFolder(fyFolder.id, cleanName);
          if (correctAppId !== app.id) {
            let moved = 0;
            for (const file of appContents) {
              try {
                await drive.files.update({
                  fileId: file.id,
                  addParents: correctAppId,
                  removeParents: app.id,
                  fields: "id",
                  supportsAllDrives: true,
                });
                moved++;
              } catch { /* skip */ }
            }
            if (moved > 0) {
              results.push({ action: "merged", from: `${fyFolder.name}/${app.name}`, to: `${fyFolder.name}/${cleanName}`, count: moved });
            }
            // Trash old folder
            const rem = await listFolderContents(drive, app.id);
            if (rem.length === 0) {
              try {
                await drive.files.update({ fileId: app.id, requestBody: { trashed: true }, supportsAllDrives: true });
                results.push({ action: "deleted-merged", from: `${fyFolder.name}/${app.name}`, to: "" });
              } catch { /* skip */ }
            }
          }
        }
      }
    }

    return NextResponse.json({ category, results });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
