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
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
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
        <div className={`${selected ? "w-1/2" : "w-full"} border-r overflow-hidden flex flex-col`}>
          {/* Search */}
          <form onSubmit={handleSearch} className="p-3 border-b bg-white">
            <div className="relative">
              <IconSearch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search emails..."
                className={`${cx.input} pl-9 py-1.5 text-sm`}
              />
            </div>
          </form>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
              </div>
            ) : emails.length === 0 ? (
              <div className="text-center py-20 text-gray-400">
                <p>No emails found</p>
              </div>
            ) : (
              emails.map((email) => (
                <div
                  key={email.id}
                  onClick={() => setSelected(email)}
                  className={`px-4 py-3 border-b cursor-pointer hover:bg-blue-50 transition ${
                    selected?.id === email.id ? "bg-blue-50 border-l-2 border-l-blue-600" : ""
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-sm truncate max-w-xs">
                      {email.from_name || email.from_address}
                    </span>
                    <span className="text-xs text-gray-400 whitespace-nowrap ml-2">
                      {formatDate(email.date)}
                    </span>
                  </div>
                  <div className="text-sm font-medium truncate">{email.subject}</div>
                  <div className="text-xs text-gray-400 truncate mt-0.5">
                    {email.body_text?.substring(0, 120) || "(no text content)"}
                  </div>
                  {email.has_attachments === 1 && (
                    <div className="mt-1">
                      <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                        {email.attachment_count} attachment{email.attachment_count !== 1 ? "s" : ""}
                      </span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Email Detail */}
        {selected && (
          <div className="w-1/2 overflow-y-auto bg-white">
            <div className="sticky top-0 bg-white border-b px-5 py-3 flex items-center justify-between">
              <h2 className="font-semibold truncate">{selected.subject}</h2>
              <button onClick={() => setSelected(null)} className="p-1 hover:bg-gray-100 rounded">
                <IconX className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Header Info */}
              <div className="space-y-2 text-sm border-b pb-4">
                <div className="flex">
                  <span className="w-16 text-gray-400 shrink-0">From</span>
                  <span className="font-medium">
                    {selected.from_name ? `${selected.from_name} <${selected.from_address}>` : selected.from_address}
                  </span>
                </div>
                <div className="flex">
                  <span className="w-16 text-gray-400 shrink-0">To</span>
                  <span>{selected.to_addresses}</span>
                </div>
                {selected.cc_addresses && (
                  <div className="flex">
                    <span className="w-16 text-gray-400 shrink-0">CC</span>
                    <span>{selected.cc_addresses}</span>
                  </div>
                )}
                <div className="flex">
                  <span className="w-16 text-gray-400 shrink-0">Date</span>
                  <span>{formatDate(selected.date)}</span>
                </div>
                {selected.has_attachments === 1 && (
                  <div className="flex">
                    <span className="w-16 text-gray-400 shrink-0">Files</span>
                    <span>{selected.attachment_count} attachment{selected.attachment_count !== 1 ? "s" : ""}</span>
                  </div>
                )}
              </div>

              {/* Body */}
              {selected.body_html ? (
                <div
                  className="prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: selected.body_html }}
                />
              ) : selected.body_text ? (
                <pre className="text-sm whitespace-pre-wrap font-sans text-gray-700">
                  {selected.body_text}
                </pre>
              ) : (
                <p className="text-gray-400 text-sm">(no content)</p>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
