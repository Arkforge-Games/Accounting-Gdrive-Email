import { NextRequest, NextResponse } from "next/server";
import * as db from "@/lib/db";
import { getTokens, getAuthenticatedClient, extractFolderId } from "@/lib/google";
import { fetchEmailAttachments } from "@/lib/imap";
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

async function listAllFiles(
  drive: ReturnType<typeof google.drive>,
  folderId?: string
): Promise<{ id: string; name: string; mimeType: string; modifiedTime: string; size: string | null; parents: string[] }[]> {
  const allFiles: { id: string; name: string; mimeType: string; modifiedTime: string; size: string | null; parents: string[] }[] = [];
  let pageToken: string | undefined;

  const query = folderId ? `'${folderId}' in parents and trashed = false` : "trashed = false";

  do {
    const res = await drive.files.list({
      pageSize: 100,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime, size, parents)",
      orderBy: "modifiedTime desc",
      q: query,
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
      });
    }

    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);

  // If syncing a folder, also recurse into subfolders
  if (folderId) {
    const subfolders = allFiles.filter((f) => f.mimeType === "application/vnd.google-apps.folder");
    for (const sub of subfolders) {
      const subFiles = await listAllFiles(drive, sub.id);
      allFiles.push(...subFiles);
    }
  }

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

    const syncFiles: (SyncFile & { content?: Buffer })[] = [];
    let downloadErrors = 0;

    for (let i = 0; i < downloadable.length; i++) {
      const f = downloadable[i];
      const exportInfo = EXPORT_MIMES[f.mimeType];
      const fileName = exportInfo ? `${f.name}${exportInfo.ext}` : f.name;

      console.log(`[GDrive Sync] Downloading ${i + 1}/${downloadable.length}: ${fileName}`);

      // Download file content
      const downloaded = await downloadGDriveFile(drive, f.id, f.mimeType);
      if (!downloaded) {
        downloadErrors++;
        continue;
      }

      syncFiles.push({
        id: `gdrive_${f.id}`,
        name: fileName,
        mimeType: downloaded.finalMime,
        source: "gdrive",
        date: f.modifiedTime,
        size: formatBytes(downloaded.content.length),
        sizeBytes: downloaded.content.length,
        folder: folderId || undefined,
        content: downloaded.content,
      });
    }

    console.log(`[GDrive Sync] Saving ${syncFiles.length} files to database...`);
    const { added, updated } = db.upsertFiles(syncFiles);
    result.filesAdded = added;
    result.filesUpdated = updated;

    if (downloadErrors > 0) {
      result.errors.push(`${downloadErrors} file(s) failed to download`);
    }

    db.setConnection("gdrive", {
      connected: true,
      lastSync: result.timestamp,
      fileCount: syncFiles.length,
    });

    console.log(`[GDrive Sync] Done — ${added} added, ${updated} updated, ${downloadErrors} errors`);
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
