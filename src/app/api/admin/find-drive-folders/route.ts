/**
 * Discover the Drive folder IDs for the expense category folders.
 *
 * Walks: Hobbyland Group > Accounting (NEW) > (NEW) Expenses Receiv... > [subfolders]
 * Returns the IDs of all subfolders so they can be added to .env.local.
 *
 * GET /api/admin/find-drive-folders
 */
import { NextResponse } from "next/server";
import { google } from "googleapis";
import { getAuthenticatedClient } from "@/lib/google";

export async function GET() {
  try {
    const auth = getAuthenticatedClient();
    const drive = google.drive({ version: "v3", auth });

    // Find the parent folder by name. Search includes shared drives + items shared with me.
    const parentSearch = await drive.files.list({
      q: `mimeType='application/vnd.google-apps.folder' and name contains 'Expenses Receiv' and trashed=false`,
      fields: "files(id,name,parents,driveId)",
      pageSize: 25,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      corpora: "allDrives",
    });
    const parents = parentSearch.data.files || [];
    if (parents.length === 0) {
      return NextResponse.json({ error: "No '(NEW) Expenses Receiv...' folder found in any accessible Drive" }, { status: 404 });
    }

    // For each candidate parent, list its subfolders
    const result: Array<{ parent: { id: string; name: string }; subfolders: { id: string; name: string }[] }> = [];
    for (const parent of parents) {
      if (!parent.id) continue;
      const sub = await drive.files.list({
        q: `'${parent.id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: "files(id,name)",
        pageSize: 50,
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
        corpora: "allDrives",
      });
      result.push({
        parent: { id: parent.id, name: parent.name || "" },
        subfolders: (sub.data.files || []).map(f => ({ id: f.id || "", name: f.name || "" })),
      });
    }
    return NextResponse.json({ found: result });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown" }, { status: 500 });
  }
}
