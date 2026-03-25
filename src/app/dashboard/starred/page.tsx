"use client";

import { useEffect, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { FileTable } from "@/components/FileTable";
import type { SyncFile } from "@/lib/types";

export default function StarredPage() {
  const [files, setFiles] = useState<SyncFile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/files?starred=true")
      .then((r) => r.json())
      .then((data) => setFiles(data.files || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <TopBar title="Starred Files" subtitle="Your important files" />
      <div className="p-6">
        <FileTable
          files={files}
          loading={loading}
          emptyMessage="No starred files. Click the star icon on any file to save it here."
        />
      </div>
    </>
  );
}
