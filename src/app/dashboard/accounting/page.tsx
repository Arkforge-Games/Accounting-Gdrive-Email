"use client";

import { useEffect, useState, useCallback } from "react";
import { TopBar } from "@/components/TopBar";
import { cx } from "@/lib/cn";
import { IconSearch, IconFilter, IconSync, IconDownload, IconTag, IconEye } from "@/components/icons";
import { FilePreviewModal } from "@/components/FilePreviewModal";
import type { SyncFile } from "@/lib/types";

interface IndexedFile extends SyncFile {
  category: string;
  accountingStatus: string;
  period: string | null;
  notes: string | null;
  vendor: string | null;
  amount: string | null;
  currency: string;
  referenceNo: string | null;
  autoCategorized: boolean;
}

interface Summary {
  byCategory: { category: string; count: number }[];
  byStatus: { status: string; count: number }[];
  byPeriod: { period: string; count: number }[];
  totalIndexed: number;
  totalUnindexed: number;
  categories: Record<string, { label: string; color: string; icon: string }>;
  statuses: Record<string, { label: string; color: string }>;
}

const categoryColors: Record<string, string> = {
  invoice: "bg-blue-100 text-blue-700 border-blue-200",
  bill: "bg-red-100 text-red-700 border-red-200",
  receipt: "bg-green-100 text-green-700 border-green-200",
  payroll: "bg-purple-100 text-purple-700 border-purple-200",
  tax: "bg-orange-100 text-orange-700 border-orange-200",
  bank_statement: "bg-cyan-100 text-cyan-700 border-cyan-200",
  contract: "bg-indigo-100 text-indigo-700 border-indigo-200",
  reimbursement: "bg-pink-100 text-pink-700 border-pink-200",
  permit: "bg-amber-100 text-amber-700 border-amber-200",
  quotation: "bg-teal-100 text-teal-700 border-teal-200",
  junk: "bg-slate-100 text-slate-500 border-slate-200",
  uncategorized: "bg-gray-100 text-gray-600 border-gray-200",
};

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  reviewed: "bg-blue-100 text-blue-700",
  recorded: "bg-green-100 text-green-700",
  flagged: "bg-red-100 text-red-700",
};

const categoryIcons: Record<string, string> = {
  invoice: "INV",
  bill: "BILL",
  receipt: "REC",
  payroll: "PAY",
  tax: "TAX",
  bank_statement: "BANK",
  contract: "CON",
  reimbursement: "REIMB",
  permit: "PER",
  quotation: "QUO",
  junk: "JUNK",
  uncategorized: "?",
};

function formatDate(dateStr: string) {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatPeriod(period: string) {
  const [year, month] = period.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(month) - 1]} ${year}`;
}

export default function AccountingIndexPage() {
  const [files, setFiles] = useState<IndexedFile[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [categorizing, setCategorizing] = useState(false);
  const [view, setView] = useState<"table" | "category" | "period">("table");
  const [showFilters, setShowFilters] = useState(false);
  const [previewFile, setPreviewFile] = useState<SyncFile | null>(null);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [periodFilter, setPeriodFilter] = useState("all");
  const [search, setSearch] = useState("");

  // Edit modal
  const [editFile, setEditFile] = useState<IndexedFile | null>(null);
  const [editForm, setEditForm] = useState<{
    category: string; status: string; vendor: string; amount: string; currency: string; referenceNo: string; notes: string;
  }>({ category: "", status: "", vendor: "", amount: "", currency: "PHP", referenceNo: "", notes: "" });

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (categoryFilter !== "all") params.set("category", categoryFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (periodFilter !== "all") params.set("period", periodFilter);
    if (search) params.set("q", search);

    const [filesRes, summaryRes] = await Promise.all([
      fetch(`/api/accounting?${params}`),
      fetch("/api/accounting?view=summary"),
    ]);

    const filesData = await filesRes.json();
    const summaryData = await summaryRes.json();

    setFiles(filesData.files || []);
    setSummary(summaryData);
    setLoading(false);
  }, [categoryFilter, statusFilter, periodFilter, search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleAutoCategorize = async () => {
    setCategorizing(true);
    await fetch("/api/accounting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "auto-categorize" }),
    });
    await fetchData();
    setCategorizing(false);
  };

  const openEditModal = (file: IndexedFile) => {
    setEditFile(file);
    setEditForm({
      category: file.category || "uncategorized",
      status: file.accountingStatus || "pending",
      vendor: file.vendor || "",
      amount: file.amount || "",
      currency: file.currency || "PHP",
      referenceNo: file.referenceNo || "",
      notes: file.notes || "",
    });
  };

  const saveEdit = async () => {
    if (!editFile) return;
    await fetch("/api/accounting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", fileId: editFile.id, ...editForm }),
    });
    setEditFile(null);
    fetchData();
  };

  const handleBulkUpdate = async (updates: { category?: string; status?: string }) => {
    if (selected.size === 0) return;
    await fetch("/api/accounting", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "bulk-update", fileIds: Array.from(selected), ...updates }),
    });
    setSelected(new Set());
    fetchData();
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    if (selected.size === files.length) setSelected(new Set());
    else setSelected(new Set(files.map(f => f.id)));
  };

  // Group files by category or period
  const groupedByCategory = files.reduce<Record<string, IndexedFile[]>>((acc, f) => {
    const key = f.category || "uncategorized";
    (acc[key] = acc[key] || []).push(f);
    return acc;
  }, {});

  const groupedByPeriod = files.reduce<Record<string, IndexedFile[]>>((acc, f) => {
    const key = f.period || f.date?.substring(0, 7) || "unknown";
    (acc[key] = acc[key] || []).push(f);
    return acc;
  }, {});

  const totalFiles = summary ? summary.byCategory.reduce((s, c) => s + c.count, 0) : 0;

  return (
    <>
      <TopBar title="Accounting Index" subtitle={`${totalFiles} files indexed`} />
      <div className="p-6 space-y-5">

        {/* Summary Cards */}
        {summary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {summary.byCategory
              .filter(c => c.count > 0)
              .map(({ category, count }) => (
                <button
                  key={category}
                  onClick={() => { setCategoryFilter(category === categoryFilter ? "all" : category); }}
                  className={`${cx.card} p-3 text-left transition-all hover:shadow-md ${
                    categoryFilter === category ? "ring-2 ring-blue-500" : ""
                  }`}
                >
                  <div className={`inline-flex px-2 py-0.5 rounded text-xs font-bold mb-2 ${categoryColors[category] || categoryColors.uncategorized}`}>
                    {categoryIcons[category] || "?"}
                  </div>
                  <div className="text-xl font-bold">{count}</div>
                  <div className="text-xs text-gray-500 capitalize">{category.replace("_", " ")}</div>
                </button>
              ))}
            {summary.totalUnindexed > 0 && (
              <button
                onClick={() => setCategoryFilter("uncategorized")}
                className={`${cx.card} p-3 text-left border-dashed border-2 border-yellow-300 bg-yellow-50 hover:shadow-md`}
              >
                <div className="text-xl font-bold text-yellow-700">{summary.totalUnindexed}</div>
                <div className="text-xs text-yellow-600 font-medium">Need Review</div>
              </button>
            )}
          </div>
        )}

        {/* Status Summary Row */}
        {summary && (
          <div className="flex items-center gap-3 flex-wrap">
            {summary.byStatus.map(({ status, count }) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status === statusFilter ? "all" : status)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
                  statusFilter === status ? "ring-2 ring-blue-500" : ""
                } ${statusColors[status] || "bg-gray-100 text-gray-600"}`}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}: {count}
              </button>
            ))}
          </div>
        )}

        {/* Actions Bar */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <button onClick={handleAutoCategorize} disabled={categorizing} className={cx.btnPrimary}>
              {categorizing ? (
                <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
              ) : (
                <IconTag className="w-4 h-4" />
              )}
              {categorizing ? "Categorizing..." : "Auto-Categorize"}
            </button>
            <button onClick={() => setShowFilters(!showFilters)} className={`${cx.btnSecondary} ${showFilters ? "bg-gray-100" : ""}`}>
              <IconFilter className="w-4 h-4" /> Filters
            </button>
            {/* View Toggle */}
            <div className="flex rounded-lg border border-gray-300 overflow-hidden">
              {(["table", "category", "period"] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 text-xs font-medium capitalize ${
                    view === v ? "bg-blue-600 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); fetchData(); }} className="flex items-center gap-2">
            <div className="relative">
              <IconSearch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search files, vendors..."
                className={`${cx.input} pl-9 py-2 text-sm w-64`}
              />
            </div>
          </form>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <div className={`${cx.card} p-4 flex flex-wrap gap-4`}>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
              <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className={`${cx.input} w-44`}>
                <option value="all">All Categories</option>
                {Object.entries(summary?.categories || {}).map(([key, val]) => (
                  <option key={key} value={key}>{(val as { label: string }).label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={`${cx.input} w-36`}>
                <option value="all">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="reviewed">Reviewed</option>
                <option value="recorded">Recorded</option>
                <option value="flagged">Flagged</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Period</label>
              <select value={periodFilter} onChange={e => setPeriodFilter(e.target.value)} className={`${cx.input} w-40`}>
                <option value="all">All Periods</option>
                {(summary?.byPeriod || []).map(({ period }) => (
                  <option key={period} value={period}>{formatPeriod(period)}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button onClick={() => { setCategoryFilter("all"); setStatusFilter("all"); setPeriodFilter("all"); setSearch(""); }} className={`${cx.btnSecondary} text-xs`}>
                Clear
              </button>
            </div>
          </div>
        )}

        {/* Bulk Actions */}
        {selected.size > 0 && (
          <div className={`${cx.card} p-3 flex items-center gap-3 bg-blue-50 border-blue-200`}>
            <span className="text-sm font-medium text-blue-700">{selected.size} selected</span>
            <select
              onChange={e => { if (e.target.value) handleBulkUpdate({ category: e.target.value }); e.target.value = ""; }}
              className={`${cx.input} w-44 text-xs py-1`}
              defaultValue=""
            >
              <option value="" disabled>Set Category...</option>
              <option value="invoice">Invoice</option>
              <option value="bill">Bill / Payable</option>
              <option value="receipt">Receipt</option>
              <option value="payroll">Payroll</option>
              <option value="tax">Tax</option>
              <option value="bank_statement">Bank Statement</option>
              <option value="contract">Contract</option>
              <option value="reimbursement">Reimbursement</option>
              <option value="quotation">Quotation</option>
              <option value="permit">Permit / License</option>
              <option value="junk">Junk / System</option>
              <option value="uncategorized">Uncategorized</option>
            </select>
            <select
              onChange={e => { if (e.target.value) handleBulkUpdate({ status: e.target.value }); e.target.value = ""; }}
              className={`${cx.input} w-36 text-xs py-1`}
              defaultValue=""
            >
              <option value="" disabled>Set Status...</option>
              <option value="pending">Pending</option>
              <option value="reviewed">Reviewed</option>
              <option value="recorded">Recorded</option>
              <option value="flagged">Flagged</option>
            </select>
            <button onClick={() => setSelected(new Set())} className="text-xs text-gray-500 hover:text-gray-700 ml-auto">
              Clear selection
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className={cx.card}>
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
            </div>
          </div>
        )}

        {/* TABLE VIEW */}
        {!loading && view === "table" && (
          <div className={`${cx.card} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50/80">
                  <tr>
                    <th className={`${cx.tableHeader} w-10`}>
                      <input type="checkbox" checked={selected.size === files.length && files.length > 0} onChange={toggleAll} className="rounded" />
                    </th>
                    <th className={cx.tableHeader}>Category</th>
                    <th className={cx.tableHeader}>File Name</th>
                    <th className={cx.tableHeader}>Vendor / From</th>
                    <th className={cx.tableHeader}>Period</th>
                    <th className={cx.tableHeader}>Amount</th>
                    <th className={cx.tableHeader}>Status</th>
                    <th className={cx.tableHeader}>Source</th>
                    <th className={cx.tableHeader}>Date</th>
                    <th className={`${cx.tableHeader} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {files.map(file => (
                    <tr key={file.id} className="hover:bg-gray-50/50 group">
                      <td className={cx.tableCell}>
                        <input type="checkbox" checked={selected.has(file.id)} onChange={() => toggleSelect(file.id)} className="rounded" />
                      </td>
                      <td className={cx.tableCell}>
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-bold border ${categoryColors[file.category] || categoryColors.uncategorized}`}>
                          {categoryIcons[file.category] || "?"}
                        </span>
                      </td>
                      <td className={cx.tableCell}>
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate max-w-xs">{file.name}</div>
                          {file.emailSubject && (
                            <div className="text-xs text-gray-400 truncate">{file.emailSubject}</div>
                          )}
                          {file.notes && (
                            <div className="text-xs text-blue-500 truncate mt-0.5">{file.notes}</div>
                          )}
                        </div>
                      </td>
                      <td className={`${cx.tableCell} text-sm text-gray-600`}>
                        {file.vendor || file.emailFrom || "-"}
                      </td>
                      <td className={`${cx.tableCell} text-sm text-gray-500`}>
                        {file.period ? formatPeriod(file.period) : "-"}
                      </td>
                      <td className={`${cx.tableCell} text-sm font-medium`}>
                        {file.amount ? `${file.currency} ${file.amount}` : "-"}
                      </td>
                      <td className={cx.tableCell}>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[file.accountingStatus] || statusColors.pending}`}>
                          {file.accountingStatus || "pending"}
                        </span>
                      </td>
                      <td className={cx.tableCell}>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          file.source === "gdrive" ? "bg-green-100 text-green-700" :
                          file.source === "email-gmail" ? "bg-red-100 text-red-700" :
                          "bg-purple-100 text-purple-700"
                        }`}>
                          {file.source === "gdrive" ? "Drive" : file.source === "email-gmail" ? "Gmail" : "Outlook"}
                        </span>
                      </td>
                      <td className={`${cx.tableCell} text-sm text-gray-500 whitespace-nowrap`}>
                        {formatDate(file.date)}
                      </td>
                      <td className={`${cx.tableCell} text-right`}>
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
                          <button onClick={() => openEditModal(file)} className="p-1.5 rounded hover:bg-blue-100 text-gray-400 hover:text-blue-600" title="Edit Index">
                            <IconTag className="w-4 h-4" />
                          </button>
                          <button onClick={() => setPreviewFile(file)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600" title="Preview">
                            <IconEye className="w-4 h-4" />
                          </button>
                          {file.downloadUrl && (
                            <a href={file.downloadUrl} target="_blank" className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600" title="Download">
                              <IconDownload className="w-4 h-4" />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t bg-gray-50/50 text-xs text-gray-400">
              Showing {files.length} file{files.length !== 1 ? "s" : ""}
            </div>
          </div>
        )}

        {/* CATEGORY VIEW */}
        {!loading && view === "category" && (
          <div className="space-y-6">
            {Object.entries(groupedByCategory)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([category, catFiles]) => (
                <div key={category} className={cx.card}>
                  <div className="px-4 py-3 border-b bg-gray-50/50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-bold border ${categoryColors[category] || categoryColors.uncategorized}`}>
                        {categoryIcons[category] || "?"}
                      </span>
                      <h3 className="font-semibold text-sm capitalize">{category.replace("_", " ")}</h3>
                    </div>
                    <span className="text-xs text-gray-400">{catFiles.length} file{catFiles.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {catFiles.map(file => (
                      <div key={file.id} className="px-4 py-3 flex items-center gap-4 hover:bg-gray-50 group">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{file.name}</div>
                          <div className="text-xs text-gray-400">
                            {file.vendor || file.emailFrom || "Unknown"} &bull; {formatDate(file.date)}
                            {file.amount && <span className="ml-2 font-medium text-gray-600">{file.currency} {file.amount}</span>}
                          </div>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[file.accountingStatus] || statusColors.pending}`}>
                          {file.accountingStatus}
                        </span>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                          <button onClick={() => openEditModal(file)} className="p-1 rounded hover:bg-blue-100 text-gray-400 hover:text-blue-600">
                            <IconTag className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setPreviewFile(file)} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                            <IconEye className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* PERIOD VIEW */}
        {!loading && view === "period" && (
          <div className="space-y-6">
            {Object.entries(groupedByPeriod)
              .sort(([a], [b]) => b.localeCompare(a))
              .map(([period, periodFiles]) => (
                <div key={period} className={cx.card}>
                  <div className="px-4 py-3 border-b bg-gray-50/50 flex items-center justify-between">
                    <h3 className="font-semibold text-sm">{formatPeriod(period)}</h3>
                    <span className="text-xs text-gray-400">{periodFiles.length} file{periodFiles.length !== 1 ? "s" : ""}</span>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {periodFiles.map(file => (
                      <div key={file.id} className="px-4 py-3 flex items-center gap-4 hover:bg-gray-50 group">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-bold border shrink-0 ${categoryColors[file.category] || categoryColors.uncategorized}`}>
                          {categoryIcons[file.category] || "?"}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{file.name}</div>
                          <div className="text-xs text-gray-400">
                            {file.vendor || file.emailFrom || "Unknown"} &bull; {formatDate(file.date)}
                            {file.amount && <span className="ml-2 font-medium text-gray-600">{file.currency} {file.amount}</span>}
                          </div>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[file.accountingStatus] || statusColors.pending}`}>
                          {file.accountingStatus}
                        </span>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                          <button onClick={() => openEditModal(file)} className="p-1 rounded hover:bg-blue-100 text-gray-400 hover:text-blue-600">
                            <IconTag className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => setPreviewFile(file)} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                            <IconEye className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* Empty State */}
        {!loading && files.length === 0 && (
          <div className={cx.card}>
            <div className="text-center py-20">
              <div className="text-4xl mb-3">?</div>
              <p className="text-lg font-medium text-gray-600">No files found</p>
              <p className="text-sm text-gray-400 mt-1">Try adjusting your filters or run Auto-Categorize to index your files</p>
            </div>
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {editFile && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setEditFile(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b">
              <h2 className="font-bold text-lg">Edit File Index</h2>
              <p className="text-sm text-gray-400 truncate">{editFile.name}</p>
            </div>
            <div className="px-6 py-4 space-y-4">
              {/* Category */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
                <select value={editForm.category} onChange={e => setEditForm({ ...editForm, category: e.target.value })} className={cx.input}>
                  <option value="uncategorized">Uncategorized</option>
                  <option value="invoice">Invoice</option>
                  <option value="bill">Bill / Payable</option>
                  <option value="receipt">Receipt</option>
                  <option value="payroll">Payroll</option>
                  <option value="tax">Tax</option>
                  <option value="bank_statement">Bank Statement</option>
                  <option value="contract">Contract</option>
                  <option value="reimbursement">Reimbursement</option>
                  <option value="quotation">Quotation</option>
                  <option value="permit">Permit / License</option>
                </select>
              </div>
              {/* Status */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
                <select value={editForm.status} onChange={e => setEditForm({ ...editForm, status: e.target.value })} className={cx.input}>
                  <option value="pending">Pending</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="recorded">Recorded</option>
                  <option value="flagged">Flagged</option>
                </select>
              </div>
              {/* Vendor + Amount row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Vendor</label>
                  <input value={editForm.vendor} onChange={e => setEditForm({ ...editForm, vendor: e.target.value })} className={cx.input} placeholder="e.g. PLDT, Meralco" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Amount</label>
                  <div className="flex gap-2">
                    <select value={editForm.currency} onChange={e => setEditForm({ ...editForm, currency: e.target.value })} className={`${cx.input} w-20`}>
                      <option value="PHP">PHP</option>
                      <option value="USD">USD</option>
                      <option value="SGD">SGD</option>
                    </select>
                    <input value={editForm.amount} onChange={e => setEditForm({ ...editForm, amount: e.target.value })} className={cx.input} placeholder="0.00" />
                  </div>
                </div>
              </div>
              {/* Reference No */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Reference No.</label>
                <input value={editForm.referenceNo} onChange={e => setEditForm({ ...editForm, referenceNo: e.target.value })} className={cx.input} placeholder="OR#, Invoice#, etc." />
              </div>
              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
                <textarea value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} className={`${cx.input} h-20 resize-none`} placeholder="Additional notes..." />
              </div>
              {/* File Info (read-only) */}
              <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-500 space-y-1">
                <div><span className="font-medium">Source:</span> {editFile.source}</div>
                <div><span className="font-medium">Date:</span> {formatDate(editFile.date)}</div>
                <div><span className="font-medium">Size:</span> {editFile.size || "Unknown"}</div>
                {editFile.emailSubject && <div><span className="font-medium">Email:</span> {editFile.emailSubject}</div>}
                {editFile.emailFrom && <div><span className="font-medium">From:</span> {editFile.emailFrom}</div>}
                {editFile.folder && <div><span className="font-medium">Folder:</span> {editFile.folder}</div>}
                {editFile.downloadUrl && (
                  <a href={editFile.downloadUrl} target="_blank" className="text-blue-600 hover:underline inline-block mt-1">Download file</a>
                )}
              </div>
            </div>
            <div className="px-6 py-4 border-t flex justify-end gap-3">
              <button onClick={() => setEditFile(null)} className={cx.btnSecondary}>Cancel</button>
              <button onClick={saveEdit} className={cx.btnPrimary}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewFile && (
        <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
      )}
    </>
  );
}
