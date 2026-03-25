"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { FileTable } from "@/components/FileTable";
import { cx } from "@/lib/cn";
import { IconSearch } from "@/components/icons";
import type { SyncFile } from "@/lib/types";

export default function SearchPageWrapper() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <SearchPage />
    </Suspense>
  );
}

function SearchPage() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";

  const [query, setQuery] = useState(initialQuery);
  const [source, setSource] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [results, setResults] = useState<SyncFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const doSearch = async () => {
    if (!query.trim() && !source && !dateFrom && !dateTo) return;
    setLoading(true);
    setSearched(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set("q", query);
      if (source) params.set("source", source);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);

      const res = await fetch(`/api/search?${params}`);
      const data = await res.json();
      setResults(data.files || []);
    } catch {
      console.error("Search failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialQuery) doSearch();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <TopBar title="Search" subtitle="Find files across all sources" />
      <div className="p-6 space-y-4">
        <div className={`${cx.card} p-5 space-y-4`}>
          {/* Search Input */}
          <div className="flex gap-3">
            <div className="relative flex-1">
              <IconSearch className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doSearch()}
                placeholder="Search by filename, email subject, sender..."
                className={`${cx.input} pl-10 text-base py-3`}
                autoFocus
              />
            </div>
            <button onClick={doSearch} className={`${cx.btnPrimary} px-6`}>
              Search
            </button>
          </div>

          {/* Advanced Filters */}
          <div className="flex flex-wrap gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Source</label>
              <select value={source} onChange={(e) => setSource(e.target.value)} className={`${cx.input} w-40`}>
                <option value="">All Sources</option>
                <option value="gdrive">Google Drive</option>
                <option value="email-outlook">Outlook</option>
                <option value="email-gmail">Gmail</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">From Date</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={`${cx.input} w-40`} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">To Date</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={`${cx.input} w-40`} />
            </div>
          </div>
        </div>

        {searched && (
          <div>
            <div className="text-sm text-gray-500 mb-3">
              {loading ? "Searching..." : `${results.length} result${results.length !== 1 ? "s" : ""} found`}
            </div>
            <FileTable files={results} loading={loading} emptyMessage="No files match your search" />
          </div>
        )}
      </div>
    </>
  );
}
