"use client";

import { cx } from "@/lib/cn";
import { IconCheck, IconX } from "./icons";

export function ConnectionCard({
  name,
  description,
  icon,
  connected,
  email,
  lastSync,
  fileCount,
  connectUrl,
  color,
}: {
  name: string;
  description?: string;
  icon: React.ReactNode;
  connected: boolean;
  email?: string;
  lastSync?: string;
  fileCount?: number;
  connectUrl: string;
  color: string;
}) {
  return (
    <div className={`${cx.card} p-5 flex items-start gap-4`}>
      {/* Icon */}
      <div className="w-12 h-12 shrink-0 flex items-center justify-center">
        {icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <h3 className="font-semibold text-sm">{name}</h3>
          <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full ${
            connected ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500"
          }`}>
            {connected ? <IconCheck className="w-3 h-3" /> : <IconX className="w-3 h-3" />}
            {connected ? "Connected" : "Not connected"}
          </span>
        </div>

        {email && <div className="text-xs text-gray-500 truncate">{email}</div>}
        {!connected && !email && description && <div className="text-xs text-gray-400">{description}</div>}

        {connected && (
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
            {fileCount !== undefined && (
              <div>
                <span className="font-semibold text-gray-700">{fileCount}</span> synced
              </div>
            )}
            {lastSync && (
              <div>
                Last sync: <span className="font-medium text-gray-700">{new Date(lastSync).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action */}
      <div className="shrink-0">
        <a
          href={connectUrl}
          className={`${connected ? cx.btnSecondary : cx.btn + ` text-white ${color}`} text-xs py-1.5 px-3`}
        >
          {connected ? "Reconnect" : "Connect"}
        </a>
      </div>
    </div>
  );
}
