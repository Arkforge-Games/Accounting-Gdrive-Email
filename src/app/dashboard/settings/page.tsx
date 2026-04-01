"use client";

import { useEffect, useState, useCallback } from "react";
import { TopBar } from "@/components/TopBar";
import { ConnectionCard } from "@/components/ConnectionCard";
import { cx } from "@/lib/cn";
import { IconGoogle, IconMicrosoft, IconXero, IconWise } from "@/components/icons";
import type { ConnectionStatus } from "@/lib/types";

export default function SettingsPage() {
  const [connections, setConnections] = useState<Record<string, ConnectionStatus>>({
    gdrive: { connected: false },
    outlook: { connected: false },
    gmail: { connected: false },
    xero: { connected: false },
    wise: { connected: false },
  });
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/files/connections")
      .then((r) => r.json())
      .then(setConnections)
      .catch(console.error);

    fetch("/api/settings")
      .then((r) => r.json())
      .then(setSettings)
      .catch(console.error);
  }, []);

  const updateSetting = useCallback((key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }, []);

  const saveSettings = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setSaving(false);
    }
  }, [settings]);

  return (
    <>
      <TopBar title="Settings" subtitle="Manage connections and preferences" />
      <div className="p-6 space-y-8 max-w-5xl">

        {/* === Accounting Integrations === */}
        <section>
          <h2 className="text-lg font-semibold mb-1">Accounting & Payments</h2>
          <p className="text-sm text-gray-400 mb-4">Connect your accounting software and payment platforms</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ConnectionCard
              name="Xero Accounting"
              description="Invoices, bills, contacts, bank reconciliation"
              icon={
                <div className="w-12 h-12 bg-[#13B5EA]/10 rounded-xl flex items-center justify-center">
                  <IconXero className="w-7 h-7 text-[#13B5EA]" />
                </div>
              }
              connected={connections.xero?.connected}
              email={connections.xero?.email}
              lastSync={connections.xero?.lastSync}
              fileCount={connections.xero?.fileCount}
              connectUrl="/api/auth/xero"
              color="bg-[#13B5EA] hover:bg-[#0e9fd0]"
            />
            <ConnectionCard
              name="Wise"
              description="Multi-currency balances, transfers, exchange rates"
              icon={
                <div className="w-12 h-12 bg-[#9FE870]/20 rounded-xl flex items-center justify-center">
                  <IconWise className="w-7 h-7 text-[#163300]" />
                </div>
              }
              connected={connections.wise?.connected}
              email={connections.wise?.email}
              lastSync={connections.wise?.lastSync}
              fileCount={connections.wise?.fileCount}
              connectUrl="/dashboard/wise"
              color="bg-[#163300] hover:bg-[#1e4400]"
            />
          </div>
        </section>

        {/* === File Sources === */}
        <section>
          <h2 className="text-lg font-semibold mb-1">File Sources</h2>
          <p className="text-sm text-gray-400 mb-4">Connect email and cloud storage to sync accounting documents</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ConnectionCard
              name="Gmail"
              description="Sync email attachments (invoices, receipts, statements)"
              icon={
                <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center">
                  <svg className="w-7 h-7 text-red-500" viewBox="0 0 24 24" fill="currentColor">
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
            <ConnectionCard
              name="Google Drive"
              description="Sync files from Google Drive folders"
              icon={
                <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center">
                  <IconGoogle className="w-7 h-7" />
                </div>
              }
              connected={connections.gdrive?.connected}
              email={connections.gdrive?.email}
              lastSync={connections.gdrive?.lastSync}
              fileCount={connections.gdrive?.fileCount}
              connectUrl="/api/auth/google"
              color="bg-blue-600 hover:bg-blue-700"
            />
            <ConnectionCard
              name="Outlook Email"
              description="Sync email attachments from Microsoft Outlook"
              icon={
                <div className="w-12 h-12 bg-[#0078d4]/10 rounded-xl flex items-center justify-center">
                  <IconMicrosoft className="w-7 h-7" />
                </div>
              }
              connected={connections.outlook?.connected}
              email={connections.outlook?.email}
              lastSync={connections.outlook?.lastSync}
              fileCount={connections.outlook?.fileCount}
              connectUrl="/api/auth/microsoft"
              color="bg-[#0078d4] hover:bg-[#006cbd]"
            />
          </div>
        </section>

        {/* === Sync Preferences === */}
        <section>
          <h2 className="text-lg font-semibold mb-1">Sync Preferences</h2>
          <p className="text-sm text-gray-400 mb-4">Configure how and when files are synced</p>
          <div className={`${cx.card} divide-y`}>
            <div className="p-5 flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">Auto-sync interval</div>
                <div className="text-xs text-gray-400">How often to automatically check for new files</div>
              </div>
              <select
                className={`${cx.input} w-44`}
                value={settings.sync_interval || "manual"}
                onChange={(e) => updateSetting("sync_interval", e.target.value)}
              >
                <option value="manual">Manual only</option>
                <option value="15">Every 15 min</option>
                <option value="30">Every 30 min</option>
                <option value="60">Every hour</option>
                <option value="360">Every 6 hours</option>
                <option value="1440">Daily</option>
              </select>
            </div>
            <div className="p-5 flex items-center justify-between gap-6">
              <div className="shrink-0">
                <div className="font-medium text-sm">Google Drive folder</div>
                <div className="text-xs text-gray-400">Paste a folder link or ID (blank = all files)</div>
              </div>
              <input
                type="text"
                placeholder="https://drive.google.com/drive/folders/..."
                className={`${cx.input} flex-1 max-w-md`}
                value={settings.gdrive_folder || ""}
                onChange={(e) => updateSetting("gdrive_folder", e.target.value)}
              />
            </div>
            <div className="p-5 flex items-center justify-between gap-6">
              <div className="shrink-0">
                <div className="font-medium text-sm">Email filter</div>
                <div className="text-xs text-gray-400">Only sync attachments matching this</div>
              </div>
              <input
                type="text"
                placeholder="e.g., invoice OR receipt"
                className={`${cx.input} w-64`}
                value={settings.email_filter || ""}
                onChange={(e) => updateSetting("email_filter", e.target.value)}
              />
            </div>
            <div className="p-5 flex items-center justify-between gap-6">
              <div className="shrink-0">
                <div className="font-medium text-sm">File types</div>
                <div className="text-xs text-gray-400">Only sync these file types</div>
              </div>
              <input
                type="text"
                placeholder="e.g., pdf,xlsx,csv,jpg"
                className={`${cx.input} w-64`}
                value={settings.file_types || ""}
                onChange={(e) => updateSetting("file_types", e.target.value)}
              />
            </div>
            <div className="p-5 flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">Max file size</div>
                <div className="text-xs text-gray-400">Skip files larger than this</div>
              </div>
              <select
                className={`${cx.input} w-44`}
                value={settings.max_file_size || "0"}
                onChange={(e) => updateSetting("max_file_size", e.target.value)}
              >
                <option value="0">No limit</option>
                <option value="5">5 MB</option>
                <option value="10">10 MB</option>
                <option value="25">25 MB</option>
                <option value="50">50 MB</option>
                <option value="100">100 MB</option>
              </select>
            </div>
            <div className="p-5 flex items-center justify-end gap-3">
              {saved && <span className="text-xs text-green-500 font-medium">Settings saved!</span>}
              <button
                className={cx.btnPrimary}
                onClick={saveSettings}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Settings"}
              </button>
            </div>
          </div>
        </section>

        {/* === Danger Zone === */}
        <section>
          <h2 className="text-lg font-semibold mb-1 text-red-600">Danger Zone</h2>
          <p className="text-sm text-gray-400 mb-4">Irreversible actions</p>
          <div className={`${cx.card} border-red-200 divide-y divide-red-100`}>
            <div className="p-5 flex items-center justify-between">
              <div>
                <div className="font-medium text-sm">Clear all synced files</div>
                <div className="text-xs text-gray-400">Remove all files from the local database. Source files are not affected.</div>
              </div>
              <button className={cx.btnDanger}>Clear Files</button>
            </div>
            <div className="p-5 flex items-center justify-between">
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
