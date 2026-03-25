"use client";

import { cx } from "@/lib/cn";
import { IconCheck, IconX } from "./icons";

export function ConnectionCard({
  name,
  icon,
  connected,
  email,
  lastSync,
  fileCount,
  connectUrl,
  color,
}: {
  name: string;
  icon: React.ReactNode;
  connected: boolean;
  email?: string;
  lastSync?: string;
  fileCount?: number;
  connectUrl: string;
  color: string;
}) {
  return (
    <div className={`${cx.card} p-5`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10">{icon}</div>
          <div>
            <div className="font-semibold">{name}</div>
            {email && <div className="text-xs text-gray-400">{email}</div>}
          </div>
        </div>
        <div className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${
          connected ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500"
        }`}>
          {connected ? <IconCheck className="w-3 h-3" /> : <IconX className="w-3 h-3" />}
          {connected ? "Connected" : "Not connected"}
        </div>
      </div>

      {connected ? (
        <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
          <div>
            <div className="text-gray-400 text-xs">Files Synced</div>
            <div className="font-medium">{fileCount ?? 0}</div>
          </div>
          <div>
            <div className="text-gray-400 text-xs">Last Sync</div>
            <div className="font-medium">{lastSync ? new Date(lastSync).toLocaleDateString() : "Never"}</div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-400 mb-4">Connect your account to start syncing files.</p>
      )}

      <a
        href={connectUrl}
        className={`${connected ? cx.btnSecondary : cx.btn + ` text-white ${color}`} w-full justify-center`}
      >
        {connected ? "Reconnect" : "Connect"}
      </a>
    </div>
  );
}
