"use client";

import { useEffect, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { StatCard } from "@/components/StatCard";
import { FileTable } from "@/components/FileTable";
import { cx } from "@/lib/cn";
import { IconFiles, IconStar, IconGoogle, IconMicrosoft, IconSync } from "@/components/icons";
import type { SyncFile } from "@/lib/types";

interface Stats {
  totalFiles: number;
  totalSize: string;
  gdriveFiles: number;
  outlookFiles: number;
  gmailFiles: number;
  starredFiles: number;
  recentFiles: SyncFile[];
}

export default function DashboardOverview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/files/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <TopBar title="Overview" subtitle="Your accounting file dashboard" />
      <div className="p-6 space-y-6">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Total Files"
            value={stats?.totalFiles ?? 0}
            icon={<IconFiles />}
            color="blue"
          />
          <StatCard
            label="Google Drive"
            value={stats?.gdriveFiles ?? 0}
            icon={<IconGoogle />}
            color="green"
          />
          <StatCard
            label="Email Files"
            value={(stats?.outlookFiles ?? 0) + (stats?.gmailFiles ?? 0)}
            icon={<IconMicrosoft />}
            color="purple"
          />
          <StatCard
            label="Starred"
            value={stats?.starredFiles ?? 0}
            icon={<IconStar />}
            color="yellow"
          />
        </div>

        {/* Quick Actions */}
        <div className={`${cx.card} p-5`}>
          <h2 className="font-semibold mb-3">Quick Actions</h2>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => fetch("/api/sync", { method: "POST" }).then(() => window.location.reload())}
              className={cx.btnPrimary}
            >
              <IconSync className="w-4 h-4" /> Sync All Sources
            </button>
            <button
              onClick={() => fetch("/api/sync?source=gdrive", { method: "POST" }).then(() => window.location.reload())}
              className={cx.btnSuccess}
            >
              <IconGoogle className="w-4 h-4" /> Sync Google Drive
            </button>
            <button
              onClick={() => fetch("/api/sync?source=email", { method: "POST" }).then(() => window.location.reload())}
              className={cx.btnSecondary}
            >
              <IconMicrosoft className="w-4 h-4" /> Sync Email
            </button>
          </div>
        </div>

        {/* Recent Files */}
        <div>
          <h2 className="font-semibold mb-3">Recent Files</h2>
          <FileTable
            files={stats?.recentFiles ?? []}
            loading={loading}
            emptyMessage="No files synced yet. Connect your accounts and sync to get started."
          />
        </div>
      </div>
    </>
  );
}
