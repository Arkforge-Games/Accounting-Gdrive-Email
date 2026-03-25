"use client";

import { useEffect, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { ConnectionCard } from "@/components/ConnectionCard";
import { cx } from "@/lib/cn";
import { IconGoogle, IconMicrosoft } from "@/components/icons";
import type { ConnectionStatus } from "@/lib/types";

export default function SettingsPage() {
  const [connections, setConnections] = useState<Record<string, ConnectionStatus>>({
    gdrive: { connected: false },
    outlook: { connected: false },
    gmail: { connected: false },
  });

  useEffect(() => {
    fetch("/api/files/connections")
      .then((r) => r.json())
      .then(setConnections)
      .catch(console.error);
  }, []);

  return (
    <>
      <TopBar title="Settings" subtitle="Manage connections and preferences" />
      <div className="p-6 space-y-8 max-w-4xl">
        {/* Connections */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Connected Accounts</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ConnectionCard
              name="Google Drive"
              icon={<IconGoogle className="w-10 h-10" />}
              connected={connections.gdrive?.connected}
              email={connections.gdrive?.email}
              lastSync={connections.gdrive?.lastSync}
              fileCount={connections.gdrive?.fileCount}
              connectUrl="/api/auth/google"
              color="bg-blue-600 hover:bg-blue-700"
            />
            <ConnectionCard
              name="Outlook Email"
              icon={<IconMicrosoft className="w-10 h-10" />}
              connected={connections.outlook?.connected}
              email={connections.outlook?.email}
              lastSync={connections.outlook?.lastSync}
              fileCount={connections.outlook?.fileCount}
              connectUrl="/api/auth/microsoft"
              color="bg-[#0078d4] hover:bg-[#006cbd]"
            />
            <ConnectionCard
              name="Gmail"
              icon={
                <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-500" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20 18h-2V9.25L12 13 6 9.25V18H4V6h1.2l6.8 4.25L18.8 6H20m0-2H4c-1.11 0-2 .89-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2z"/>
                  </svg>
                </div>
              }
              connected={connections.gmail?.connected}
              email={connections.gmail?.email}
              lastSync={connections.gmail?.lastSync}
              fileCount={connections.gmail?.fileCount}
              connectUrl="/api/auth/google"
              color="bg-red-600 hover:bg-red-700"
            />
          </div>
        </section>

        {/* Sync Preferences */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Sync Preferences</h2>
          <div className={`${cx.card} divide-y`}>
            <div className="p-5 flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">Auto-sync interval</div>
                <div className="text-xs text-gray-400">How often to automatically check for new files</div>
              </div>
              <select className={`${cx.input} w-40`}>
                <option value="manual">Manual only</option>
                <option value="15">Every 15 min</option>
                <option value="30">Every 30 min</option>
                <option value="60">Every hour</option>
                <option value="360">Every 6 hours</option>
                <option value="1440">Daily</option>
              </select>
            </div>
            <div className="p-5 flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">Google Drive folder</div>
                <div className="text-xs text-gray-400">Specific folder to sync (leave blank for all)</div>
              </div>
              <input type="text" placeholder="e.g., Accounting/2024" className={`${cx.input} w-60`} />
            </div>
            <div className="p-5 flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">Email filter</div>
                <div className="text-xs text-gray-400">Only sync attachments from emails matching this filter</div>
              </div>
              <input type="text" placeholder="e.g., invoice OR receipt" className={`${cx.input} w-60`} />
            </div>
            <div className="p-5 flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">File types</div>
                <div className="text-xs text-gray-400">Only sync these file types</div>
              </div>
              <input type="text" placeholder="e.g., pdf,xlsx,csv,jpg" className={`${cx.input} w-60`} />
            </div>
            <div className="p-5 flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">Max file size</div>
                <div className="text-xs text-gray-400">Skip files larger than this</div>
              </div>
              <select className={`${cx.input} w-40`}>
                <option value="0">No limit</option>
                <option value="5">5 MB</option>
                <option value="10">10 MB</option>
                <option value="25">25 MB</option>
                <option value="50">50 MB</option>
                <option value="100">100 MB</option>
              </select>
            </div>
          </div>
        </section>

        {/* Danger Zone */}
        <section>
          <h2 className="text-lg font-semibold mb-4 text-red-600">Danger Zone</h2>
          <div className={`${cx.card} border-red-200 p-5 space-y-4`}>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">Clear all synced files</div>
                <div className="text-xs text-gray-400">Remove all files from the local database. Source files are not affected.</div>
              </div>
              <button className={cx.btnDanger}>Clear Files</button>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">Disconnect all accounts</div>
                <div className="text-xs text-gray-400">Remove all connected account tokens.</div>
              </div>
              <button className={cx.btnDanger}>Disconnect All</button>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
