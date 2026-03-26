"use client";

import { useEffect, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { cx } from "@/lib/cn";
import { IconSearch, IconX } from "@/components/icons";

interface Email {
  id: string;
  uid: number | null;
  message_id: string | null;
  subject: string;
  from_address: string;
  from_name: string | null;
  to_addresses: string;
  cc_addresses: string | null;
  date: string;
  body_text: string | null;
  body_html: string | null;
  has_attachments: number;
  attachment_count: number;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / 86400000);

  if (days === 0) {
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  } else if (days < 7) {
    return d.toLocaleDateString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatFullDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getInitials(name: string) {
  return name.split(/[\s@.]+/).slice(0, 2).map(w => w[0]?.toUpperCase() || "").join("");
}

const avatarColors = [
  "bg-blue-600", "bg-emerald-600", "bg-violet-600", "bg-rose-600",
  "bg-amber-600", "bg-cyan-600", "bg-pink-600", "bg-indigo-600",
];

function getAvatarColor(email: string) {
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

export default function EmailsPage() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Email | null>(null);

  const fetchEmails = async (q?: string) => {
    setLoading(true);
    const url = q ? `/api/emails?q=${encodeURIComponent(q)}` : "/api/emails";
    const res = await fetch(url);
    const data = await res.json();
    setEmails(data.emails || []);
    setTotal(data.total || data.emails?.length || 0);
    setLoading(false);
  };

  useEffect(() => { fetchEmails(); }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchEmails(search || undefined);
  };

  return (
    <>
      <TopBar title="Emails" subtitle={`${total} emails synced`} />
      <div className="flex h-[calc(100vh-4rem)]">
        {/* Email List */}
        <div className={`${selected ? "w-[420px] min-w-[420px]" : "w-full"} border-r border-gray-200 overflow-hidden flex flex-col bg-white`}>
          {/* Search */}
          <form onSubmit={handleSearch} className="p-3 border-b border-gray-200">
            <div className="relative">
              <IconSearch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search emails..."
                className={`${cx.input} pl-9 py-2 text-sm bg-gray-50 border-gray-200 focus:bg-white`}
              />
            </div>
          </form>

          {/* List */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
              </div>
            ) : emails.length === 0 ? (
              <div className="text-center py-20 text-gray-400">
                <p className="text-base font-medium">No emails found</p>
              </div>
            ) : (
              emails.map((email) => {
                const isSelected = selected?.id === email.id;
                const senderName = email.from_name || email.from_address.split("@")[0];
                return (
                  <div
                    key={email.id}
                    onClick={() => setSelected(email)}
                    className={`px-4 py-3.5 cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-blue-50 border-l-[3px] border-l-blue-600"
                        : "hover:bg-gray-50 border-l-[3px] border-l-transparent"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {/* Avatar */}
                      <div className={`w-9 h-9 rounded-full ${getAvatarColor(email.from_address)} flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5`}>
                        {getInitials(senderName)}
                      </div>

                      <div className="flex-1 min-w-0">
                        {/* Sender + Date */}
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <span className="font-semibold text-sm text-gray-900 truncate">
                            {senderName}
                          </span>
                          <span className="text-[11px] text-gray-400 whitespace-nowrap shrink-0">
                            {formatDate(email.date)}
                          </span>
                        </div>

                        {/* Subject */}
                        <div className="text-[13px] font-medium text-gray-800 truncate leading-snug">
                          {email.subject}
                        </div>

                        {/* Preview */}
                        <div className="text-[12px] text-gray-400 truncate mt-0.5 leading-snug">
                          {email.body_text?.replace(/\s+/g, " ").substring(0, 100) || "(no content)"}
                        </div>

                        {/* Attachment badge */}
                        {email.has_attachments === 1 && (
                          <div className="mt-1.5 flex items-center gap-1">
                            <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                            </svg>
                            <span className="text-[11px] text-gray-400 font-medium">
                              {email.attachment_count} file{email.attachment_count !== 1 ? "s" : ""}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Email Detail */}
        {selected && (
          <div className="flex-1 overflow-y-auto bg-white">
            {/* Detail Header */}
            <div className="sticky top-0 bg-white/95 backdrop-blur-sm border-b border-gray-200 px-6 py-4 flex items-start justify-between z-10">
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-bold text-gray-900 leading-tight">{selected.subject}</h2>
                <p className="text-sm text-gray-400 mt-1">{formatFullDate(selected.date)}</p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="p-2 hover:bg-gray-100 rounded-lg transition shrink-0 ml-4"
              >
                <IconX className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="p-6">
              {/* Sender Card */}
              <div className="flex items-start gap-4 mb-6 p-4 bg-gray-50 rounded-xl">
                <div className={`w-11 h-11 rounded-full ${getAvatarColor(selected.from_address)} flex items-center justify-center text-white text-sm font-bold shrink-0`}>
                  {getInitials(selected.from_name || selected.from_address.split("@")[0])}
                </div>
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900">
                      {selected.from_name || selected.from_address.split("@")[0]}
                    </span>
                    <span className="text-xs text-gray-400">&lt;{selected.from_address}&gt;</span>
                  </div>
                  <div className="text-sm text-gray-500">
                    <span className="text-gray-400">To: </span>{selected.to_addresses}
                  </div>
                  {selected.cc_addresses && (
                    <div className="text-sm text-gray-500">
                      <span className="text-gray-400">CC: </span>{selected.cc_addresses}
                    </div>
                  )}
                </div>
              </div>

              {/* Attachments */}
              {selected.has_attachments === 1 && (
                <div className="mb-6 p-4 border border-gray-200 rounded-xl">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                    </svg>
                    <span className="text-sm font-semibold text-gray-700">
                      {selected.attachment_count} Attachment{selected.attachment_count !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">View attachments in the Attachments tab</p>
                </div>
              )}

              {/* Body */}
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                {selected.body_html ? (
                  <div className="p-6">
                    <iframe
                      srcDoc={`<!DOCTYPE html><html><head><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;margin:0;padding:0;}a{color:#2563eb;}img{max-width:100%;height:auto;}</style></head><body>${selected.body_html}</body></html>`}
                      className="w-full border-0 min-h-[400px]"
                      sandbox="allow-same-origin"
                      onLoad={(e) => {
                        const iframe = e.target as HTMLIFrameElement;
                        if (iframe.contentDocument) {
                          iframe.style.height = iframe.contentDocument.body.scrollHeight + 40 + "px";
                        }
                      }}
                    />
                  </div>
                ) : selected.body_text ? (
                  <pre className="p-6 text-sm whitespace-pre-wrap font-sans text-gray-700 leading-relaxed">
                    {selected.body_text}
                  </pre>
                ) : (
                  <p className="p-6 text-gray-400 text-sm">(no content)</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Empty state when no email selected */}
        {!selected && emails.length > 0 && !loading && (
          <div className="hidden" />
        )}
      </div>
    </>
  );
}
