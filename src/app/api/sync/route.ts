import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";
import { getTokens, getAuthenticatedClient } from "@/lib/google";
import { getAccessToken } from "@/lib/microsoft";
import { google } from "googleapis";
import { Client } from "@microsoft/microsoft-graph-client";
import type { SyncFile, SyncResult } from "@/lib/types";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

async function syncGDrive(): Promise<SyncResult> {
  const result: SyncResult = { source: "gdrive", filesAdded: 0, filesUpdated: 0, errors: [], timestamp: new Date().toISOString() };

  try {
    const tokens = getTokens();
    if (!tokens) {
      result.errors.push("Not authenticated with Google");
      return result;
    }

    const auth = getAuthenticatedClient();
    const drive = google.drive({ version: "v3", auth });

    const res = await drive.files.list({
      pageSize: 200,
      fields: "files(id, name, mimeType, modifiedTime, size, webContentLink, parents, thumbnailLink)",
      orderBy: "modifiedTime desc",
    });

    const files: SyncFile[] = (res.data.files || []).map((f) => ({
      id: `gdrive_${f.id}`,
      name: f.name || "Untitled",
      mimeType: f.mimeType || "application/octet-stream",
      source: "gdrive" as const,
      date: f.modifiedTime || new Date().toISOString(),
      size: f.size ? formatBytes(Number(f.size)) : undefined,
      sizeBytes: f.size ? Number(f.size) : undefined,
      downloadUrl: f.webContentLink || undefined,
      previewUrl: f.thumbnailLink || undefined,
    }));

    const { added, updated } = store.upsertFiles(files);
    result.filesAdded = added;
    result.filesUpdated = updated;

    store.setConnection("gdrive", {
      connected: true,
      lastSync: result.timestamp,
      fileCount: files.length,
    });
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : "Unknown error");
  }

  return result;
}

async function syncOutlook(): Promise<SyncResult> {
  const result: SyncResult = { source: "outlook", filesAdded: 0, filesUpdated: 0, errors: [], timestamp: new Date().toISOString() };

  try {
    const token = getAccessToken();
    if (!token) {
      result.errors.push("Not authenticated with Microsoft");
      return result;
    }

    const client = Client.init({
      authProvider: (done) => done(null, token),
    });

    const messages = await client
      .api("/me/messages")
      .filter("hasAttachments eq true")
      .top(100)
      .orderby("receivedDateTime desc")
      .select("id,subject,receivedDateTime,from")
      .get();

    const files: SyncFile[] = [];

    for (const msg of messages.value || []) {
      const attachments = await client
        .api(`/me/messages/${msg.id}/attachments`)
        .get();

      for (const att of attachments.value || []) {
        if (att["@odata.type"] === "#microsoft.graph.fileAttachment") {
          files.push({
            id: `outlook_${msg.id}_${att.id}`,
            name: att.name,
            mimeType: att.contentType || "application/octet-stream",
            source: "email-outlook",
            date: msg.receivedDateTime || new Date().toISOString(),
            size: att.size ? formatBytes(att.size) : undefined,
            sizeBytes: att.size || undefined,
            emailSubject: msg.subject,
            emailFrom: msg.from?.emailAddress?.address,
          });
        }
      }
    }

    const { added, updated } = store.upsertFiles(files);
    result.filesAdded = added;
    result.filesUpdated = updated;

    store.setConnection("outlook", {
      connected: true,
      lastSync: result.timestamp,
      fileCount: files.length,
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
  if (!source || source === "outlook") {
    results.push(await syncOutlook());
  }

  // Log activity
  for (const r of results) {
    store.addActivity({
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
