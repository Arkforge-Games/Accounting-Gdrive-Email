"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { TopBar } from "@/components/TopBar";
import { cx } from "@/lib/cn";
import { IconSync, IconDownload } from "@/components/icons";
import type { SyncFile } from "@/lib/types";

function getFileIcon(mimeType: string, name: string) {
  if (mimeType.includes("pdf")) return { label: "PDF", color: "bg-red-100 text-red-600" };
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || name.endsWith(".xlsx") || name.endsWith(".csv")) return { label: "XLS", color: "bg-green-100 text-green-600" };
  if (mimeType.includes("document") || mimeType.includes("word") || name.endsWith(".docx")) return { label: "DOC", color: "bg-blue-100 text-blue-600" };
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint")) return { label: "PPT", color: "bg-orange-100 text-orange-600" };
  if (mimeType.includes("image")) return { label: "IMG", color: "bg-purple-100 text-purple-600" };
  if (mimeType.includes("video") || name.endsWith(".mp4")) return { label: "VID", color: "bg-pink-100 text-pink-600" };
  if (mimeType.includes("json")) return { label: "JSON", color: "bg-yellow-100 text-yellow-700" };
  return { label: "FILE", color: "bg-gray-100 text-gray-600" };
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface FolderNode {
  name: string;
  path: string;
  files: SyncFile[];
  subfolders: Record<string, FolderNode>;
}

function buildFolderTree(files: SyncFile[]): FolderNode {
  const root: FolderNode = { name: "My Drive", path: "", files: [], subfolders: {} };

  for (const f of files) {
    const folderPath = f.folder || "My Drive";
    const parts = folderPath.split("/").filter(Boolean);

    let current = root;
    // Files at root "My Drive" level
    if (parts.length === 0 || (parts.length === 1 && parts[0] === "My Drive")) {
      current.files.push(f);
      continue;
    }

    // Walk/create the folder tree
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part === "My Drive" && i === 0) continue;
      if (!current.subfolders[part]) {
        current.subfolders[part] = {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          files: [],
          subfolders: {},
        };
      }
      current = current.subfolders[part];
    }
    current.files.push(f);
  }

  return root;
}

function getFolderAtPath(root: FolderNode, path: string[]): FolderNode {
  let current = root;
  for (const part of path) {
    if (current.subfolders[part]) {
      current = current.subfolders[part];
    }
  }
  return current;
}

export default function DrivePage() {
  const [files, setFiles] = useState<SyncFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [folderLink, setFolderLink] = useState("");
  const [savedFolder, setSavedFolder] = useState("");
  const [connected, setConnected] = useState(false);
  const [oauthMessage, setOauthMessage] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [showConfig, setShowConfig] = useState(false);

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

    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "true") {
      setOauthMessage("Google Drive connected successfully!");
      setConnected(true);
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
      setSyncStatus("Syncing files from Google Drive (this may take a few minutes)...");

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
        setSyncStatus(total === 0
          ? "Sync complete — no new files found."
          : `Sync complete! ${added} new, ${updated} updated files.`);
        loadFiles();
        setConnected(true);
      }
    } catch {
      setSyncError("Sync timed out — files may still be downloading in the background. Refresh the page in a minute.");
      setSyncStatus(null);
    } finally {
      setSyncing(false);
    }
  };

  const folderTree = useMemo(() => buildFolderTree(files), [files]);
  const currentFolder = useMemo(() => getFolderAtPath(folderTree, currentPath), [folderTree, currentPath]);
  const subfolderList = Object.values(currentFolder.subfolders).sort((a, b) => a.name.localeCompare(b.name));
  const currentFiles = currentFolder.files;

  // Count total files in a folder recursively
  const countFiles = (node: FolderNode): number => {
    let count = node.files.length;
    for (const sub of Object.values(node.subfolders)) count += countFiles(sub);
    return count;
  };

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

        {/* Sync status/error banners */}
        {syncing && syncStatus && (
          <div className="flex items-center gap-3 text-sm px-4 py-3 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg">
            <svg className="w-4 h-4 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {syncStatus}
          </div>
        )}
        {!syncing && syncStatus && (
          <div className="text-sm px-4 py-3 rounded-lg bg-green-50 text-green-700 border border-green-200">
            {syncStatus}
          </div>
        )}
        {syncError && (
          <div className="text-sm px-4 py-3 rounded-lg bg-red-50 text-red-700 border border-red-200">
            {syncError}
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {connected ? (
              <>
                <button onClick={syncDrive} disabled={syncing} className={cx.btnPrimary}>
                  <IconSync className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
                  {syncing ? "Syncing..." : "Sync Drive"}
                </button>
                <button onClick={() => setShowConfig(!showConfig)} className={cx.btnSecondary}>
                  {showConfig ? "Hide Config" : "Config"}
                </button>
                <a href="/api/auth/google" className={`${cx.btnSecondary} text-xs`}>Reconnect</a>
              </>
            ) : (
              <a href="/api/auth/google" className={cx.btnPrimary}>Connect Google Drive</a>
            )}
          </div>
          <div className="text-sm text-gray-400">
            {files.length} files total
          </div>
        </div>

        {/* Config panel */}
        {showConfig && (
          <div className={`${cx.card} p-4 space-y-3`}>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Google Drive Folder</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={folderLink}
                  onChange={(e) => setFolderLink(e.target.value)}
                  placeholder="Paste folder link or leave blank for all files..."
                  className={`${cx.input} flex-1`}
                />
                <button onClick={saveFolder} className={cx.btnSecondary}>Save</button>
              </div>
              <p className="text-xs text-gray-400 mt-1">Leave empty to sync all files from Google Drive.</p>
            </div>
          </div>
        )}

        {/* Breadcrumb */}
        {files.length > 0 && (
          <div className="flex items-center gap-1 text-sm">
            <button
              onClick={() => setCurrentPath([])}
              className={`hover:text-blue-600 ${currentPath.length === 0 ? "text-gray-800 font-medium" : "text-blue-600"}`}
            >
              My Drive
            </button>
            {currentPath.map((part, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className="text-gray-400">/</span>
                <button
                  onClick={() => setCurrentPath(currentPath.slice(0, i + 1))}
                  className={`hover:text-blue-600 ${i === currentPath.length - 1 ? "text-gray-800 font-medium" : "text-blue-600"}`}
                >
                  {part}
                </button>
              </span>
            ))}
          </div>
        )}

        {/* File explorer */}
        {files.length === 0 && !loading ? (
          <div className={`${cx.card} p-12 text-center`}>
            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
            </div>
            <h3 className="font-semibold text-lg mb-1">No Google Drive files yet</h3>
            <p className="text-sm text-gray-400 mb-4">
              {connected ? "Click Sync Drive to get started." : "Connect your Google account first."}
            </p>
            {!connected && (
              <a href="/api/auth/google" className={cx.btnPrimary}>Connect Google Drive</a>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {/* Folders */}
            {subfolderList.map((folder) => (
              <button
                key={folder.path}
                onClick={() => setCurrentPath([...currentPath, folder.name])}
                className="group flex flex-col items-center p-4 rounded-xl border border-transparent hover:border-gray-200 hover:bg-gray-50 transition-all text-center"
              >
                <svg className="w-12 h-12 text-gray-400 group-hover:text-yellow-500 transition-colors mb-2" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
                </svg>
                <span className="text-xs font-medium text-gray-700 truncate w-full">{folder.name}</span>
                <span className="text-[10px] text-gray-400 mt-0.5">{countFiles(folder)} files</span>
              </button>
            ))}

            {/* Files */}
            {currentFiles.map((file) => {
              const icon = getFileIcon(file.mimeType, file.name);
              return (
                <div
                  key={file.id}
                  className="group flex flex-col items-center p-4 rounded-xl border border-transparent hover:border-gray-200 hover:bg-gray-50 transition-all text-center relative"
                >
                  {/* File type badge */}
                  <div className={`w-12 h-14 rounded-lg flex items-center justify-center mb-2 ${icon.color}`}>
                    <span className="text-[10px] font-bold">{icon.label}</span>
                  </div>
                  <span className="text-xs font-medium text-gray-700 truncate w-full" title={file.name}>
                    {file.name}
                  </span>
                  <span className="text-[10px] text-gray-400 mt-0.5">{file.size || ""}</span>
                  <span className="text-[10px] text-gray-400">{formatDate(file.date)}</span>

                  {/* Download on hover */}
                  {file.downloadUrl && (
                    <a
                      href={file.downloadUrl}
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 bg-white rounded-lg shadow border border-gray-200 hover:bg-gray-50"
                      title="Download"
                    >
                      <IconDownload className="w-3.5 h-3.5 text-gray-500" />
                    </a>
                  )}
                </div>
              );
            })}

            {/* Empty folder */}
            {subfolderList.length === 0 && currentFiles.length === 0 && !loading && (
              <div className="col-span-full text-center py-8 text-sm text-gray-400">
                This folder is empty
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
