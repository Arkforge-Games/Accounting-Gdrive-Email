"use client";

import { useEffect, useState, useCallback } from "react";
import { TopBar } from "@/components/TopBar";
import { FileTable } from "@/components/FileTable";
import { cx } from "@/lib/cn";
import { IconSync, IconFilter, IconDownload } from "@/components/icons";
import type { SyncFile } from "@/lib/types";

export default function DrivePage() {
  const [files, setFiles] = useState<SyncFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [folderLink, setFolderLink] = useState("");
  const [savedFolder, setSavedFolder] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [showFilters, setShowFilters] = useState(false);
  const [connected, setConnected] = useState(false);
  const [oauthMessage, setOauthMessage] = useState<string | null>(null);

  const loadFiles = useCallback(() => {
    fetch("/api/files")
      .then((r) => r.json())
      .then((data) => {
        const driveFiles = (data.files || []).filter((f: SyncFile) => f.source === "gdrive");
        setFiles(driveFiles);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadFiles();

    // Check URL params for OAuth result
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "true") {
      setOauthMessage("Google Drive connected successfully! You can now sync your files.");
      setConnected(true);
      // Clean URL
      window.history.replaceState({}, "", "/dashboard/drive");
    } else if (params.get("error")) {
      const err = params.get("error");
      setOauthMessage(`Connection failed: ${err === "oauth_failed" ? "Google OAuth failed — try again" : err}`);
      window.history.replaceState({}, "", "/dashboard/drive");
    }

    fetch("/api/settings")
      .then((r) => r.json())
      .then((s) => {
        setFolderLink(s.gdrive_folder || "");
        setSavedFolder(s.gdrive_folder || "");
      })
      .catch(console.error);

    fetch("/api/files/connections")
      .then((r) => r.json())
      .then((c) => setConnected(c.gdrive?.connected || false))
      .catch(console.error);
  }, [loadFiles]);

  const saveFolder = async () => {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gdrive_folder: folderLink }),
    });
    setSavedFolder(folderLink);
  };

  const syncDrive = async () => {
    setSyncing(true);
    setSyncStatus("Connecting to Google Drive...");
    setSyncError(null);
    setOauthMessage(null);

    try {
      if (folderLink !== savedFolder) {
        setSyncStatus("Saving folder settings...");
        await saveFolder();
      }

      setSyncStatus("Fetching file list from Google Drive...");

      const res = await fetch("/api/sync?source=gdrive", { method: "POST" });
      const data = await res.json();
      const result = data.results?.[0];

      if (result?.errors?.length > 0) {
        setSyncError(result.errors.join(", "));
        setSyncStatus(null);
      } else {
        const added = result?.filesAdded || 0;
        const updated = result?.filesUpdated || 0;
        const total = added + updated;
        if (total === 0) {
          setSyncStatus("Sync complete — no new files found. Make sure the folder link is correct or try syncing all files (leave folder blank).");
        } else {
          setSyncStatus(`Sync complete! ${added} new file${added !== 1 ? "s" : ""} added, ${updated} updated.`);
        }
        loadFiles();
        setConnected(true);
      }
    } catch (err) {
      setSyncError(`Sync failed: ${err instanceof Error ? err.message : "Connection error"}`);
      setSyncStatus(null);
    } finally {
      setSyncing(false);
    }
  };

  const filtered = files.filter((f) => {
    if (typeFilter === "all") return true;
    if (typeFilter === "pdf" && f.mimeType.includes("pdf")) return true;
    if (typeFilter === "image" && f.mimeType.includes("image")) return true;
    if (typeFilter === "spreadsheet" && (f.mimeType.includes("spreadsheet") || f.mimeType.includes("excel") || f.mimeType.includes("csv"))) return true;
    if (typeFilter === "document" && (f.mimeType.includes("document") || f.mimeType.includes("word"))) return true;
    if (typeFilter === "presentation" && (f.mimeType.includes("presentation") || f.mimeType.includes("powerpoint"))) return true;
    return false;
  });

  return (
    <>
      <TopBar title="Google Drive" subtitle={`${files.length} files synced`} />
      <div className="p-6 space-y-5">
        {/* OAuth feedback */}
        {oauthMessage && (
          <div className={`text-sm px-4 py-3 rounded-lg ${oauthMessage.includes("failed") ? "bg-red-50 text-red-700 border border-red-200" : "bg-green-50 text-green-700 border border-green-200"}`}>
            {oauthMessage}
          </div>
        )}

        {/* Connection & Folder Config */}
        <div className={`${cx.card} p-5 space-y-4`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
              </div>
              <div>
                <div className="font-semibold text-sm">Google Drive</div>
                <div className="text-xs">
                  {connected ? (
                    <span className="text-green-600 font-medium">Connected</span>
                  ) : (
                    <span className="text-gray-400">Not connected</span>
                  )}
                </div>
              </div>
            </div>
            {!connected && (
              <a href="/api/auth/google" className={cx.btnPrimary}>
                Connect Google Drive
              </a>
            )}
            {connected && (
              <a href="/api/auth/google" className={`${cx.btnSecondary} text-xs`}>
                Reconnect
              </a>
            )}
          </div>

          {/* Folder Link Input */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Google Drive Folder
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={folderLink}
                onChange={(e) => setFolderLink(e.target.value)}
                placeholder="Paste Google Drive folder link or leave blank for all files..."
                className={`${cx.input} flex-1`}
              />
              <button
                onClick={syncDrive}
                disabled={syncing || !connected}
                className={cx.btnPrimary}
              >
                <IconSync className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "Syncing..." : "Sync Drive"}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              Paste a link like https://drive.google.com/drive/folders/abc123 to sync a specific folder, or leave empty to sync all files.
            </p>
          </div>

          {/* Sync Progress */}
          {syncing && syncStatus && (
            <div className="flex items-center gap-3 text-sm px-4 py-3 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg">
              <svg className="w-4 h-4 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {syncStatus}
            </div>
          )}

          {/* Sync Result */}
          {!syncing && syncStatus && (
            <div className="text-sm px-4 py-3 rounded-lg bg-green-50 text-green-700 border border-green-200">
              {syncStatus}
            </div>
          )}

          {/* Sync Error */}
          {syncError && (
            <div className="text-sm px-4 py-3 rounded-lg bg-red-50 text-red-700 border border-red-200">
              {syncError}
            </div>
          )}

          {/* Not connected warning */}
          {!connected && !oauthMessage && (
            <div className="text-sm px-4 py-3 rounded-lg bg-yellow-50 text-yellow-700 border border-yellow-200">
              Connect your Google account first before syncing files.
            </div>
          )}
        </div>

        {/* File List */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`${cx.btnSecondary} ${showFilters ? "bg-gray-100" : ""}`}
            >
              <IconFilter className="w-4 h-4" />
              Filters
            </button>
            {files.length > 0 && (
              <a href="/api/files/download-all" className={cx.btnSecondary}>
                <IconDownload className="w-4 h-4" />
                Download All
              </a>
            )}
          </div>
          <div className="text-sm text-gray-400">
            {filtered.length} of {files.length} files
          </div>
        </div>

        {showFilters && (
          <div className={`${cx.card} p-4 flex flex-wrap gap-4`}>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">File Type</label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className={`${cx.input} w-40`}
              >
                <option value="all">All Types</option>
                <option value="pdf">PDF</option>
                <option value="image">Images</option>
                <option value="spreadsheet">Spreadsheets</option>
                <option value="document">Documents</option>
                <option value="presentation">Presentations</option>
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={() => setTypeFilter("all")}
                className={`${cx.btnSecondary} text-xs`}
              >
                Clear Filters
              </button>
            </div>
          </div>
        )}

        {files.length === 0 && !loading ? (
          <div className={`${cx.card} p-12 text-center`}>
            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
            </div>
            <h3 className="font-semibold text-lg mb-1">No Google Drive files yet</h3>
            <p className="text-sm text-gray-400 mb-4">
              {connected
                ? "Paste a folder link above and click Sync Drive to get started."
                : "Connect your Google account first, then sync your files."}
            </p>
            {!connected && (
              <a href="/api/auth/google" className={cx.btnPrimary}>
                Connect Google Drive
              </a>
            )}
          </div>
        ) : (
          <>
            {/* Group files by folder */}
            {(() => {
              const folders: Record<string, SyncFile[]> = {};
              for (const f of filtered) {
                const folder = f.folder || "My Drive";
                if (!folders[folder]) folders[folder] = [];
                folders[folder].push(f);
              }
              const folderNames = Object.keys(folders).sort();

              return folderNames.map((folder) => (
                <div key={folder} className="space-y-2">
                  <div className="flex items-center gap-2 px-1">
                    <svg className="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                    </svg>
                    <span className="font-medium text-sm text-gray-700">{folder}</span>
                    <span className="text-xs text-gray-400">({folders[folder].length} files)</span>
                  </div>
                  <FileTable files={folders[folder]} loading={loading} />
                </div>
              ));
            })()}
          </>
        )}
      </div>
    </>
  );
}
