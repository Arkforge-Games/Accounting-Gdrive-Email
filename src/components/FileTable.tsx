"use client";

import { useState } from "react";
import type { SyncFile } from "@/lib/types";
import { cx } from "@/lib/cn";
import { IconStar, IconDownload, IconEye, IconTrash, IconChevronDown } from "./icons";
import { FilePreviewModal } from "./FilePreviewModal";

function sourceLabel(source: string) {
  switch (source) {
    case "gdrive": return "Google Drive";
    case "email-outlook": return "Outlook";
    case "email-gmail": return "Gmail";
    default: return source;
  }
}

function sourceBadgeClass(source: string) {
  switch (source) {
    case "gdrive": return cx.badgeGdrive;
    case "email-outlook": return cx.badgeEmail;
    case "email-gmail": return cx.badgeGmail;
    default: return `${cx.badge} bg-gray-100 text-gray-600`;
  }
}

function fileIcon(mimeType: string) {
  if (mimeType.includes("pdf")) return "PDF";
  if (mimeType.includes("image")) return "IMG";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType.includes("csv")) return "XLS";
  if (mimeType.includes("document") || mimeType.includes("word")) return "DOC";
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint")) return "PPT";
  if (mimeType.includes("zip") || mimeType.includes("compressed")) return "ZIP";
  return "FILE";
}

function fileIconColor(mimeType: string) {
  if (mimeType.includes("pdf")) return "bg-red-100 text-red-600";
  if (mimeType.includes("image")) return "bg-blue-100 text-blue-600";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType.includes("csv")) return "bg-green-100 text-green-600";
  if (mimeType.includes("document") || mimeType.includes("word")) return "bg-blue-100 text-blue-600";
  return "bg-gray-100 text-gray-600";
}

function formatDate(dateStr: string) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type SortKey = "name" | "date" | "size" | "source";

export function FileTable({
  files,
  loading,
  emptyMessage = "No files found",
  showSource = true,
}: {
  files: SyncFile[];
  loading?: boolean;
  emptyMessage?: string;
  showSource?: boolean;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortAsc, setSortAsc] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewFile, setPreviewFile] = useState<SyncFile | null>(null);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === "name");
    }
  };

  const sorted = [...files].sort((a, b) => {
    const dir = sortAsc ? 1 : -1;
    switch (sortKey) {
      case "name": return dir * a.name.localeCompare(b.name);
      case "date": return dir * (new Date(a.date).getTime() - new Date(b.date).getTime());
      case "size": return dir * ((a.sizeBytes || 0) - (b.sizeBytes || 0));
      case "source": return dir * a.source.localeCompare(b.source);
      default: return 0;
    }
  });

  const toggleStar = async (id: string) => {
    await fetch("/api/files/star", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === files.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(files.map((f) => f.id)));
    }
  };

  if (loading) {
    return (
      <div className={cx.card}>
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className={cx.card}>
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg">{emptyMessage}</p>
        </div>
      </div>
    );
  }

  const SortHeader = ({ label, sortKeyValue }: { label: string; sortKeyValue: SortKey }) => (
    <th
      className={`${cx.tableHeader} cursor-pointer select-none hover:text-gray-700`}
      onClick={() => handleSort(sortKeyValue)}
    >
      <div className="flex items-center gap-1">
        {label}
        {sortKey === sortKeyValue && (
          <IconChevronDown className={`w-3 h-3 transition-transform ${sortAsc ? "rotate-180" : ""}`} />
        )}
      </div>
    </th>
  );

  return (
    <>
      <div className={`${cx.card} overflow-hidden`}>
        {/* Bulk Actions */}
        {selected.size > 0 && (
          <div className="px-4 py-2 bg-blue-50 border-b flex items-center gap-3 text-sm">
            <span className="font-medium text-blue-700">
              {selected.size} selected
            </span>
            <button className={`${cx.btnSecondary} text-xs py-1 px-2`}>
              <IconDownload className="w-3 h-3" /> Download
            </button>
            <button className={`${cx.btn} text-xs py-1 px-2 text-red-600 hover:bg-red-50`}>
              <IconTrash className="w-3 h-3" /> Remove
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50/80">
              <tr>
                <th className={`${cx.tableHeader} w-10`}>
                  <input
                    type="checkbox"
                    checked={selected.size === files.length && files.length > 0}
                    onChange={toggleAll}
                    className="rounded"
                  />
                </th>
                <th className={`${cx.tableHeader} w-10`}></th>
                <SortHeader label="Name" sortKeyValue="name" />
                {showSource && <SortHeader label="Source" sortKeyValue="source" />}
                <th className={cx.tableHeader}>Type</th>
                <SortHeader label="Date" sortKeyValue="date" />
                <SortHeader label="Size" sortKeyValue="size" />
                <th className={`${cx.tableHeader} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sorted.map((file) => (
                <tr key={file.id} className="hover:bg-gray-50/50 group">
                  <td className={cx.tableCell}>
                    <input
                      type="checkbox"
                      checked={selected.has(file.id)}
                      onChange={() => toggleSelect(file.id)}
                      className="rounded"
                    />
                  </td>
                  <td className={cx.tableCell}>
                    <button
                      onClick={() => toggleStar(file.id)}
                      className={`hover:text-yellow-500 transition ${
                        file.starred ? "text-yellow-400" : "text-gray-300"
                      }`}
                    >
                      <IconStar className="w-4 h-4" filled={file.starred} />
                    </button>
                  </td>
                  <td className={cx.tableCell}>
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold ${fileIconColor(file.mimeType)}`}>
                        {fileIcon(file.mimeType)}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate max-w-xs">{file.name}</div>
                        {file.folder && (
                          <div className="text-xs text-gray-400 truncate">{file.folder}</div>
                        )}
                        {file.emailSubject && (
                          <div className="text-xs text-gray-400 truncate">
                            From: {file.emailFrom} &bull; {file.emailSubject}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  {showSource && (
                    <td className={cx.tableCell}>
                      <span className={sourceBadgeClass(file.source)}>
                        {sourceLabel(file.source)}
                      </span>
                    </td>
                  )}
                  <td className={`${cx.tableCell} text-gray-500 text-xs`}>
                    {file.mimeType.split("/").pop()?.replace("vnd.", "").substring(0, 20)}
                  </td>
                  <td className={`${cx.tableCell} text-gray-500`}>{formatDate(file.date)}</td>
                  <td className={`${cx.tableCell} text-gray-500`}>{file.size || "—"}</td>
                  <td className={`${cx.tableCell} text-right`}>
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
                      <button
                        onClick={() => setPreviewFile(file)}
                        className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                        title="Preview"
                      >
                        <IconEye className="w-4 h-4" />
                      </button>
                      {file.downloadUrl && (
                        <a
                          href={file.downloadUrl}
                          target="_blank"
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                          title="Download"
                        >
                          <IconDownload className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* File Count */}
        <div className="px-4 py-2 border-t bg-gray-50/50 text-xs text-gray-400">
          Showing {files.length} file{files.length !== 1 ? "s" : ""}
        </div>
      </div>

      {previewFile && (
        <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
      )}
    </>
  );
}
