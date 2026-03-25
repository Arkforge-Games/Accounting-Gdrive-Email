"use client";

import { useEffect, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { cx } from "@/lib/cn";
import { IconSync, IconDownload, IconStar, IconTrash, IconCheck } from "@/components/icons";
import type { ActivityEntry } from "@/lib/types";

function formatTime(ts: string) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

function actionIcon(action: string) {
  switch (action) {
    case "sync": return <IconSync className="w-4 h-4" />;
    case "download": return <IconDownload className="w-4 h-4" />;
    case "star":
    case "unstar": return <IconStar className="w-4 h-4" />;
    case "delete": return <IconTrash className="w-4 h-4" />;
    case "connect":
    case "disconnect": return <IconCheck className="w-4 h-4" />;
    default: return <IconSync className="w-4 h-4" />;
  }
}

function actionColor(action: string) {
  switch (action) {
    case "sync": return "bg-blue-100 text-blue-600";
    case "download": return "bg-green-100 text-green-600";
    case "star": return "bg-yellow-100 text-yellow-600";
    case "delete": return "bg-red-100 text-red-600";
    case "connect": return "bg-green-100 text-green-600";
    case "disconnect": return "bg-gray-100 text-gray-600";
    default: return "bg-gray-100 text-gray-600";
  }
}

export default function ActivityPage() {
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/files/activity")
      .then((r) => r.json())
      .then((data) => setActivity(data.activity || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <TopBar title="Activity" subtitle="Recent sync and file activity" />
      <div className="p-6">
        <div className={`${cx.card} divide-y`}>
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
            </div>
          ) : activity.length === 0 ? (
            <div className="text-center py-20 text-gray-400">
              <p className="text-lg">No activity yet</p>
              <p className="text-sm mt-1">Activity will appear here as you sync and manage files</p>
            </div>
          ) : (
            activity.map((entry) => (
              <div key={entry.id} className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${actionColor(entry.action)}`}>
                  {actionIcon(entry.action)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{entry.details}</div>
                  <div className="text-xs text-gray-400 flex items-center gap-2">
                    <span className="capitalize">{entry.source}</span>
                    {entry.fileCount !== undefined && (
                      <>
                        <span>&bull;</span>
                        <span>{entry.fileCount} files</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-xs text-gray-400 whitespace-nowrap">
                  {formatTime(entry.timestamp)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
