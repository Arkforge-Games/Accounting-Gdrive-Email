"use client";

import { useEffect, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { FileTable } from "@/components/FileTable";
import { cx } from "@/lib/cn";
import { IconFilter } from "@/components/icons";
import type { SyncFile } from "@/lib/types";

export default function FilesPage() {
  const [files, setFiles] = useState<SyncFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    fetch("/api/files")
      .then((r) => r.json())
      .then((data) => setFiles(data.files || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = files.filter((f) => {
    if (sourceFilter !== "all" && f.source !== sourceFilter) return false;
    if (typeFilter !== "all") {
      if (typeFilter === "pdf" && !f.mimeType.includes("pdf")) return false;
      if (typeFilter === "image" && !f.mimeType.includes("image")) return false;
      if (typeFilter === "spreadsheet" && !f.mimeType.includes("spreadsheet") && !f.mimeType.includes("excel") && !f.mimeType.includes("csv")) return false;
      if (typeFilter === "document" && !f.mimeType.includes("document") && !f.mimeType.includes("word")) return false;
    }
    return true;
  });

  return (
    <>
      <TopBar title="All Files" subtitle={`${filtered.length} files`} />
      <div className="p-6 space-y-4">
        {/* Filters */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`${cx.btnSecondary} ${showFilters ? "bg-gray-100" : ""}`}
          >
            <IconFilter className="w-4 h-4" />
            Filters
          </button>
          <div className="text-sm text-gray-400">
            {filtered.length} of {files.length} files
          </div>
        </div>

        {showFilters && (
          <div className={`${cx.card} p-4 flex flex-wrap gap-4`}>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Source</label>
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className={`${cx.input} w-40`}
              >
                <option value="all">All Sources</option>
                <option value="gdrive">Google Drive</option>
                <option value="email-outlook">Outlook</option>
                <option value="email-gmail">Gmail</option>
              </select>
            </div>
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
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={() => { setSourceFilter("all"); setTypeFilter("all"); }}
                className={`${cx.btnSecondary} text-xs`}
              >
                Clear Filters
              </button>
            </div>
          </div>
        )}

        <FileTable files={filtered} loading={loading} />
      </div>
    </>
  );
}
