"use client";

import { useEffect, useState, useCallback } from "react";
import { TopBar } from "@/components/TopBar";
import { cx } from "@/lib/cn";
import { IconSearch, IconSync } from "@/components/icons";

interface PayableRow {
  rowIndex: number; jobDate: string; type: string; receiptLink: string; supplierName: string;
  invoiceNumber: string; fullName: string; jobDetails: string; paymentAmount: string;
  conversion: string; paymentDetails: string; paymentStatus: string; paymentDate: string;
  paymentMethod: string; account: string; remarks: string; receiptCreated: string;
  debit: string; runningBalance: string;
}

interface ReceivableRow {
  rowIndex: number; jobDate: string; type: string; receiptLink: string; brand: string;
  clientName: string; invoiceNumber: string; fullName: string; jobDetails: string;
  paymentAmount: string; paymentDetails: string; paymentStatus: string; paymentDate: string;
  paymentMethod: string; account: string; remarks: string; receiptCreated: string;
}

type Tab = "payable" | "receivable";

const statusColors: Record<string, string> = {
  "Ready": "bg-green-100 text-green-700",
  "Paid": "bg-blue-100 text-blue-700",
  "Pending": "bg-yellow-100 text-yellow-700",
  "Overdue": "bg-red-100 text-red-700",
  "-": "bg-gray-100 text-gray-500",
};

export default function ExpensesPage() {
  const [tab, setTab] = useState<Tab>("payable");
  const [payables, setPayables] = useState<PayableRow[]>([]);
  const [receivables, setReceivables] = useState<ReceivableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sheets?action=all");
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setPayables(data.payables || []);
      setReceivables(data.receivables || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sheet data");
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSync = async () => {
    setSyncing(true);
    await fetch("/api/sheets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sync" }) });
    await fetchData();
    setSyncing(false);
  };

  const filteredPayables = payables.filter(p =>
    !search || [p.supplierName, p.fullName, p.invoiceNumber, p.type, p.paymentAmount, p.jobDate, p.paymentStatus]
      .some(v => v?.toLowerCase().includes(search.toLowerCase()))
  );

  const filteredReceivables = receivables.filter(r =>
    !search || [r.clientName, r.brand, r.invoiceNumber, r.fullName, r.paymentAmount, r.jobDate, r.paymentStatus]
      .some(v => v?.toLowerCase().includes(search.toLowerCase()))
  );

  const totalPayable = payables.reduce((sum, p) => {
    const m = p.paymentAmount?.match(/[\d,.]+/);
    return sum + (m ? parseFloat(m[0].replace(/,/g, "")) : 0);
  }, 0);

  const totalReceivable = receivables.reduce((sum, r) => {
    const m = r.paymentAmount?.match(/[\d,.]+/);
    return sum + (m ? parseFloat(m[0].replace(/,/g, "")) : 0);
  }, 0);

  return (
    <>
      <TopBar title="Expenses Sheet" subtitle={`${payables.length} payable, ${receivables.length} receivable`} />
      <div className="p-6 space-y-5">

        {/* Summary + Tabs */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-1 border-b border-gray-200">
            <button onClick={() => setTab("payable")}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${tab === "payable" ? "border-red-500 text-red-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
              Payable ({payables.length})
            </button>
            <button onClick={() => setTab("receivable")}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition ${tab === "receivable" ? "border-green-500 text-green-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
              Receivable ({receivables.length})
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleSync} disabled={syncing} className={cx.btnSecondary}>
              <IconSync className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing..." : "Sync Sheet"}
            </button>
            <a href={`https://docs.google.com/spreadsheets/d/${process.env.NEXT_PUBLIC_SHEET_ID || "1gCGR0fEruEdwVNe2qx9U2hAb7cIqjWcMHVae_iH_MsE"}/edit`}
              target="_blank" className={cx.btnPrimary}>
              Open in Google Sheets
            </a>
            <div className="relative">
              <IconSearch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search..." className={`${cx.input} pl-9 py-1.5 text-sm w-56`} />
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className={`${cx.card} p-4`}>
            <div className="text-xs text-gray-500">Total Payable</div>
            <div className="text-xl font-bold text-red-600">{totalPayable.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
            <div className="text-xs text-gray-400">{payables.length} entries</div>
          </div>
          <div className={`${cx.card} p-4`}>
            <div className="text-xs text-gray-500">Total Receivable</div>
            <div className="text-xl font-bold text-green-600">{totalReceivable.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
            <div className="text-xs text-gray-400">{receivables.length} entries</div>
          </div>
          <div className={`${cx.card} p-4`}>
            <div className="text-xs text-gray-500">Pending Payment</div>
            <div className="text-xl font-bold text-yellow-600">
              {payables.filter(p => !p.paymentStatus || p.paymentStatus === "-" || p.paymentStatus === "Pending").length}
            </div>
          </div>
          <div className={`${cx.card} p-4`}>
            <div className="text-xs text-gray-500">Ready to Pay</div>
            <div className="text-xl font-bold text-blue-600">
              {payables.filter(p => p.paymentStatus === "Ready").length}
            </div>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin h-10 w-10 border-4 border-blue-600 border-t-transparent rounded-full" />
          </div>
        )}

        {error && (
          <div className={`${cx.card} p-8 text-center`}>
            <p className="text-red-500 mb-3">{error}</p>
            <p className="text-sm text-gray-400 mb-4">Make sure Google is connected with Sheets permission. Go to Settings → Reconnect Google Drive.</p>
            <button onClick={fetchData} className={cx.btnPrimary}>Retry</button>
          </div>
        )}

        {/* PAYABLE TABLE */}
        {!loading && !error && tab === "payable" && (
          <div className={`${cx.card} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50/80">
                  <tr>
                    <th className={cx.tableHeader}>Date</th>
                    <th className={cx.tableHeader}>Type</th>
                    <th className={cx.tableHeader}>Supplier</th>
                    <th className={cx.tableHeader}>Invoice #</th>
                    <th className={cx.tableHeader}>Person</th>
                    <th className={`${cx.tableHeader} text-right`}>Amount</th>
                    <th className={cx.tableHeader}>Status</th>
                    <th className={cx.tableHeader}>Method</th>
                    <th className={cx.tableHeader}>Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredPayables.length === 0 ? (
                    <tr><td colSpan={9} className="p-8 text-center text-gray-400">No payable entries</td></tr>
                  ) : filteredPayables.map((p, i) => (
                    <tr key={i} className="hover:bg-gray-50/50">
                      <td className={`${cx.tableCell} text-gray-500 whitespace-nowrap text-sm`}>{p.jobDate}</td>
                      <td className={cx.tableCell}>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          p.type === "Reimbursement" ? "bg-pink-100 text-pink-700" :
                          p.type === "Supplier" ? "bg-blue-100 text-blue-700" :
                          p.type === "CC" ? "bg-purple-100 text-purple-700" :
                          p.type === "Cash" ? "bg-yellow-100 text-yellow-700" :
                          "bg-gray-100 text-gray-600"
                        }`}>{p.type || "-"}</span>
                      </td>
                      <td className={`${cx.tableCell} font-medium text-sm`}>{p.supplierName}</td>
                      <td className={`${cx.tableCell} text-sm text-gray-500 font-mono`}>{p.invoiceNumber || "-"}</td>
                      <td className={`${cx.tableCell} text-sm`}>{p.fullName}</td>
                      <td className={`${cx.tableCell} text-right font-medium text-sm whitespace-nowrap`}>{p.paymentAmount || "-"}</td>
                      <td className={cx.tableCell}>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[p.paymentStatus] || "bg-gray-100 text-gray-500"}`}>
                          {p.paymentStatus || "-"}
                        </span>
                      </td>
                      <td className={`${cx.tableCell} text-sm text-gray-500`}>{p.paymentMethod || "-"}</td>
                      <td className={cx.tableCell}>
                        {p.receiptLink && p.receiptLink.startsWith("http") ? (
                          <a href={p.receiptLink} target="_blank" className="text-blue-600 hover:underline text-xs">View</a>
                        ) : (
                          <span className="text-xs text-gray-400">{p.receiptLink ? "Link" : "-"}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t bg-gray-50/50 text-xs text-gray-400">
              {filteredPayables.length} entries
            </div>
          </div>
        )}

        {/* RECEIVABLE TABLE */}
        {!loading && !error && tab === "receivable" && (
          <div className={`${cx.card} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50/80">
                  <tr>
                    <th className={cx.tableHeader}>Date</th>
                    <th className={cx.tableHeader}>Brand</th>
                    <th className={cx.tableHeader}>Client</th>
                    <th className={cx.tableHeader}>Invoice #</th>
                    <th className={cx.tableHeader}>Person</th>
                    <th className={`${cx.tableHeader} text-right`}>Amount</th>
                    <th className={cx.tableHeader}>Status</th>
                    <th className={cx.tableHeader}>Method</th>
                    <th className={cx.tableHeader}>Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredReceivables.length === 0 ? (
                    <tr><td colSpan={9} className="p-8 text-center text-gray-400">No receivable entries</td></tr>
                  ) : filteredReceivables.map((r, i) => (
                    <tr key={i} className="hover:bg-gray-50/50">
                      <td className={`${cx.tableCell} text-gray-500 whitespace-nowrap text-sm`}>{r.jobDate}</td>
                      <td className={`${cx.tableCell} text-sm font-medium`}>{r.brand || "-"}</td>
                      <td className={`${cx.tableCell} font-medium text-sm`}>{r.clientName}</td>
                      <td className={`${cx.tableCell} text-sm text-gray-500 font-mono`}>{r.invoiceNumber || "-"}</td>
                      <td className={`${cx.tableCell} text-sm`}>{r.fullName}</td>
                      <td className={`${cx.tableCell} text-right font-medium text-sm`}>{r.paymentAmount || "-"}</td>
                      <td className={cx.tableCell}>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[r.paymentStatus] || "bg-gray-100 text-gray-500"}`}>
                          {r.paymentStatus || "-"}
                        </span>
                      </td>
                      <td className={`${cx.tableCell} text-sm text-gray-500`}>{r.paymentMethod || "-"}</td>
                      <td className={cx.tableCell}>
                        {r.receiptLink?.startsWith("http") ? (
                          <a href={r.receiptLink} target="_blank" className="text-blue-600 hover:underline text-xs">View</a>
                        ) : (
                          <span className="text-xs text-gray-400">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t bg-gray-50/50 text-xs text-gray-400">
              {filteredReceivables.length} entries
            </div>
          </div>
        )}
      </div>
    </>
  );
}
