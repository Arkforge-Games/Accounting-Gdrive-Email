"use client";

import type { SyncFile } from "@/lib/types";
import { cx } from "@/lib/cn";
import { IconX, IconDownload } from "./icons";

function formatDate(dateStr: string) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FilePreviewModal({
  file,
  onClose,
}: {
  file: SyncFile;
  onClose: () => void;
}) {
  const isImage = file.mimeType.startsWith("image/");
  const isPdf = file.mimeType === "application/pdf";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-semibold text-lg truncate">{file.name}</h2>
          <div className="flex items-center gap-2">
            {file.downloadUrl && (
              <a
                href={file.downloadUrl}
                target="_blank"
                className={`${cx.btnSecondary} text-sm py-1.5`}
              >
                <IconDownload className="w-4 h-4" /> Download
              </a>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
              <IconX className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Preview Area */}
        <div className="flex-1 overflow-auto p-6">
          {isImage && file.previewUrl ? (
            <img src={file.previewUrl} alt={file.name} className="max-w-full rounded-lg shadow" />
          ) : isPdf && file.previewUrl ? (
            <iframe src={file.previewUrl} className="w-full h-96 rounded-lg border" />
          ) : (
            <div className="flex items-center justify-center h-48 bg-gray-50 rounded-lg text-gray-400">
              <div className="text-center">
                <p className="text-lg font-medium">Preview not available</p>
                <p className="text-sm mt-1">Download the file to view it</p>
              </div>
            </div>
          )}
        </div>

        {/* Details */}
        <div className="px-6 py-4 border-t bg-gray-50 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-gray-400 text-xs">Source</div>
            <div className="font-medium capitalize">
              {file.source === "gdrive" ? "Google Drive" : file.source.replace("email-", "")}
            </div>
          </div>
          <div>
            <div className="text-gray-400 text-xs">Type</div>
            <div className="font-medium">{file.mimeType.split("/").pop()}</div>
          </div>
          <div>
            <div className="text-gray-400 text-xs">Size</div>
            <div className="font-medium">{file.size || "Unknown"}</div>
          </div>
          <div>
            <div className="text-gray-400 text-xs">Date</div>
            <div className="font-medium">{formatDate(file.date)}</div>
          </div>
          {file.folder && (
            <div className="col-span-2">
              <div className="text-gray-400 text-xs">Folder</div>
              <div className="font-medium">{file.folder}</div>
            </div>
          )}
          {file.emailSubject && (
            <div className="col-span-2">
              <div className="text-gray-400 text-xs">Email Subject</div>
              <div className="font-medium">{file.emailSubject}</div>
            </div>
          )}
          {file.emailFrom && (
            <div className="col-span-2">
              <div className="text-gray-400 text-xs">From</div>
              <div className="font-medium">{file.emailFrom}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
