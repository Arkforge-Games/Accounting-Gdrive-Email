import { NextRequest, NextResponse } from "next/server";
import * as db from "@/lib/db";
import { getTokens, getAuthenticatedClient, extractFolderId } from "@/lib/google";
import { fetchEmailAttachments } from "@/lib/imap";
import { isWiseConfigured, syncWiseData } from "@/lib/wise";
import { runWisePipeline } from "@/lib/wise-pipeline";
import { isXeroConnected, syncXeroData } from "@/lib/xero";
import { google } from "googleapis";
import type { SyncFile, SyncResult } from "@/lib/types";
import { Readable } from "stream";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

// Google Workspace MIME type export mappings
const EXPORT_MIMES: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": { mime: "application/pdf", ext: ".pdf" },
  "application/vnd.google-apps.spreadsheet": { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: ".xlsx" },
  "application/vnd.google-apps.presentation": { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", ext: ".pptx" },
  "application/vnd.google-apps.drawing": { mime: "application/pdf", ext: ".pdf" },
};

// Mime types to skip (not downloadable)
const SKIP_MIMES = new Set([
  "application/vnd.google-apps.folder",
  "application/vnd.google-apps.shortcut",
  "application/vnd.google-apps.form",
  "application/vnd.google-apps.map",
  "application/vnd.google-apps.site",
]);

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function downloadGDriveFile(
  drive: ReturnType<typeof google.drive>,
  fileId: string,
  mimeType: string
): Promise<{ content: Buffer; finalMime: string } | null> {
  try {
    const exportInfo = EXPORT_MIMES[mimeType];
    if (exportInfo) {
      // Google Workspace file — export to a real format
      const res = await drive.files.export(
        { fileId, mimeType: exportInfo.mime },
        { responseType: "stream" }
      );
      const content = await streamToBuffer(res.data as unknown as Readable);
      return { content, finalMime: exportInfo.mime };
    } else {
      // Regular file — direct download
      const res = await drive.files.get(
        { fileId, alt: "media" },
        { responseType: "stream" }
      );
      const content = await streamToBuffer(res.data as unknown as Readable);
      return { content, finalMime: mimeType };
    }
  } catch (err) {
    console.error(`Failed to download file ${fileId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size: string | null;
  parents: string[];
  folderPath: string;
}

async function listFolder(
  drive: ReturnType<typeof google.drive>,
  folderId: string,
  folderPath: string,
  includeShared?: boolean
): Promise<DriveFile[]> {
  const allFiles: DriveFile[] = [];
  let pageToken: string | undefined;

  const q = `'${folderId}' in parents and trashed = false`;

  do {
    const res = await drive.files.list({
      pageSize: 100,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime, size, parents)",
      orderBy: "modifiedTime desc",
      q,
      ...(includeShared ? { includeItemsFromAllDrives: true, supportsAllDrives: true } : {}),
      ...(pageToken ? { pageToken } : {}),
    });

    const files = res.data.files || [];
    for (const f of files) {
      allFiles.push({
        id: f.id!,
        name: f.name || "Untitled",
        mimeType: f.mimeType || "application/octet-stream",
        modifiedTime: f.modifiedTime || new Date().toISOString(),
        size: f.size || null,
        parents: (f.parents as string[]) || [],
        folderPath,
      });
    }

    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  // Recurse into subfolders
  const subfolders = allFiles.filter((f) => f.mimeType === "application/vnd.google-apps.folder");
  for (const sub of subfolders) {
    const subPath = folderPath ? `${folderPath}/${sub.name}` : sub.name;
    console.log(`[GDrive Sync] Scanning folder: ${subPath}`);
    const subFiles = await listFolder(drive, sub.id, subPath, includeShared);
    allFiles.push(...subFiles);
  }

  return allFiles;
}

async function listAllFiles(
  drive: ReturnType<typeof google.drive>,
  folderId?: string
): Promise<DriveFile[]> {
  if (folderId) {
    // Sync a specific folder
    let folderName = "My Drive";
    try {
      const res = await drive.files.get({ fileId: folderId, fields: "name", supportsAllDrives: true });
      folderName = res.data.name || "My Drive";
    } catch { /* use default */ }
    return listFolder(drive, folderId, folderName, true);
  }

  // No folder specified — sync My Drive root + Shared with me
  const allFiles: DriveFile[] = [];

  // 1. My Drive root
  console.log("[GDrive Sync] Scanning My Drive...");
  const myDriveFiles = await listFolder(drive, "root", "My Drive");
  allFiles.push(...myDriveFiles);

  // 2. Shared with me (top-level shared files/folders)
  console.log("[GDrive Sync] Scanning Shared with me...");
  let pageToken: string | undefined;
  do {
    const res = await drive.files.list({
      pageSize: 100,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime, size, parents)",
      orderBy: "modifiedTime desc",
      q: "sharedWithMe = true and trashed = false",
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      ...(pageToken ? { pageToken } : {}),
    });

    const files = res.data.files || [];
    for (const f of files) {
      if (f.mimeType === "application/vnd.google-apps.folder") {
        // Recurse into shared folders
        const sharedPath = `Shared with me/${f.name}`;
        console.log(`[GDrive Sync] Scanning shared folder: ${sharedPath}`);
        allFiles.push({
          id: f.id!, name: f.name || "Untitled", mimeType: f.mimeType!,
          modifiedTime: f.modifiedTime || new Date().toISOString(),
          size: f.size || null, parents: (f.parents as string[]) || [],
          folderPath: "Shared with me",
        });
        const subFiles = await listFolder(drive, f.id!, sharedPath, true);
        allFiles.push(...subFiles);
      } else {
        allFiles.push({
          id: f.id!, name: f.name || "Untitled",
          mimeType: f.mimeType || "application/octet-stream",
          modifiedTime: f.modifiedTime || new Date().toISOString(),
          size: f.size || null, parents: (f.parents as string[]) || [],
          folderPath: "Shared with me",
        });
      }
    }

    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  return allFiles;
}

async function syncGDrive(): Promise<SyncResult> {
  const result: SyncResult = { source: "gdrive", filesAdded: 0, filesUpdated: 0, errors: [], timestamp: new Date().toISOString() };

  try {
    const tokens = getTokens();
    if (!tokens) {
      console.log("[GDrive Sync] No tokens found — not authenticated");
      result.errors.push("Not authenticated with Google. Go to Google Drive page → Connect Google Drive.");
      return result;
    }

    console.log("[GDrive Sync] Starting sync...");
    const auth = getAuthenticatedClient();
    const drive = google.drive({ version: "v3", auth });

    // Check if a specific folder is configured
    const folderSetting = db.getSetting("gdrive_folder");
    const folderId = folderSetting ? extractFolderId(folderSetting) : undefined;
    console.log("[GDrive Sync] Folder:", folderId || "(all files)");

    // List all files (with pagination + subfolder recursion)
    const driveFiles = await listAllFiles(drive, folderId);
    console.log(`[GDrive Sync] Found ${driveFiles.length} total items`);

    // Filter out non-downloadable types
    const downloadable = driveFiles.filter((f) => !SKIP_MIMES.has(f.mimeType));
    console.log(`[GDrive Sync] ${downloadable.length} downloadable files`);

    let downloadErrors = 0;
    let totalSaved = 0;

    for (let i = 0; i < downloadable.length; i++) {
      const f = downloadable[i];
      const exportInfo = EXPORT_MIMES[f.mimeType];
      const fileName = exportInfo ? `${f.name}${exportInfo.ext}` : f.name;

      console.log(`[GDrive Sync] Downloading ${i + 1}/${downloadable.length}: ${fileName}`);

      const downloaded = await downloadGDriveFile(drive, f.id, f.mimeType);
      if (!downloaded) {
        downloadErrors++;
        continue;
      }

      // Save immediately to DB (not batched) to prevent OOM
      db.upsertFiles([{
        id: `gdrive_${f.id}`,
        name: fileName,
        mimeType: downloaded.finalMime,
        source: "gdrive",
        date: f.modifiedTime,
        size: formatBytes(downloaded.content.length),
        sizeBytes: downloaded.content.length,
        folder: f.folderPath || undefined,
        content: downloaded.content,
      }]);
      totalSaved++;

      // Log progress every 50 files
      if (totalSaved % 50 === 0) {
        console.log(`[GDrive Sync] Progress: ${totalSaved} saved, ${downloadErrors} errors`);
      }
    }

    result.filesAdded = totalSaved;
    result.filesUpdated = 0;

    if (downloadErrors > 0) {
      result.errors.push(`${downloadErrors} file(s) failed to download`);
    }
    db.setConnection("gdrive", {
      connected: true,
      lastSync: result.timestamp,
      fileCount: totalSaved,
    });

    console.log(`[GDrive Sync] Done — ${totalSaved} saved, ${downloadErrors} errors`);
  } catch (err) {
    console.error("[GDrive Sync] Error:", err);
    result.errors.push(err instanceof Error ? err.message : "Unknown error");
  }

  return result;
}

async function syncEmail(): Promise<SyncResult> {
  const result: SyncResult = { source: "email", filesAdded: 0, filesUpdated: 0, errors: [], timestamp: new Date().toISOString() };

  try {
    const { files, emailCount } = await fetchEmailAttachments();

    const { added, updated } = db.upsertFiles(files);
    result.filesAdded = added;
    result.filesUpdated = updated;

    db.setConnection("gmail", {
      connected: true,
      email: process.env.IMAP_USER,
      lastSync: result.timestamp,
      fileCount: emailCount,
    });
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : "Unknown error");
  }

  return result;
}

export async function POST(req: NextRequest) {
  const source = req.nextUrl.searchParams.get("source");
  const results: SyncResult[] = [];

  if (!source || source === "gdrive") {
    results.push(await syncGDrive());
  }
  if (!source || source === "email") {
    results.push(await syncEmail());
  }
  if ((!source || source === "xero") && isXeroConnected()) {
    try {
      const xeroResult = await syncXeroData();
      results.push({
        source: "xero",
        filesAdded: xeroResult.invoices + xeroResult.bills,
        filesUpdated: 0,
        errors: [],
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      results.push({
        source: "xero",
        filesAdded: 0,
        filesUpdated: 0,
        errors: [err instanceof Error ? err.message : "Xero sync failed"],
        timestamp: new Date().toISOString(),
      });
    }
  }
  if ((!source || source === "wise") && isWiseConfigured()) {
    try {
      const wiseResult = await syncWiseData();
      results.push({
        source: "wise",
        filesAdded: wiseResult.transfers,
        filesUpdated: 0,
        errors: [],
        timestamp: new Date().toISOString(),
      });

      // Andrea's April 2026 checklist item #5: after caching Wise data,
      // run the Wise pipeline to categorize transfers and append/match them
      // to the Payable sheet.
      try {
        const wisePipeline = await runWisePipeline();
        results.push({
          source: "wise-pipeline",
          filesAdded: wisePipeline.appended,
          filesUpdated: wisePipeline.matchedExisting,
          errors: wisePipeline.errors > 0 ? [`${wisePipeline.errors} errors during processing`] : [],
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        results.push({
          source: "wise-pipeline",
          filesAdded: 0,
          filesUpdated: 0,
          errors: [err instanceof Error ? err.message : "Wise pipeline failed"],
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      results.push({
        source: "wise",
        filesAdded: 0,
        filesUpdated: 0,
        errors: [err instanceof Error ? err.message : "Wise sync failed"],
        timestamp: new Date().toISOString(),
      });
    }
  }

  for (const r of results) {
    db.addActivity({
      action: "sync",
      source: r.source,
      details: r.errors.length > 0
        ? `Sync failed: ${r.errors.join(", ")}`
        : `Synced ${r.filesAdded} new, ${r.filesUpdated} updated files`,
      fileCount: r.filesAdded + r.filesUpdated,
    });
  }

  return NextResponse.json({ results });
}
