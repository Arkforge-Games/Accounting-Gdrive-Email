"use client";

import { useEffect, useState, useCallback } from "react";
import { TopBar } from "@/components/TopBar";
import { cx } from "@/lib/cn";

interface ReportData {
  month: string;
  monthLabel: string;
  summary: { totalFiles: number; filesWithAmounts: number; totalAmount: number; uniqueVendors: number; categoryCount: number };
  categories: { category: string; count: number; total: number }[];
  topVendors: { vendor: string; count: number; total: number }[];
  xero: {
    invoices: { invoiceNumber: string; contact: string; total: number; status: string; currency: string; type: string; date: string }[];
    bills: { invoiceNumber: string; contact: string; total: number; status: string; currency: string; date: string }[];
    totalInvoiced: number;
    totalBilled: number;
  };
  wise: {
    transfers: { sourceCurrency: string; sourceValue: number; targetCurrency: string; targetValue: number; status: string; created: string }[];
    totals: { count: number; totalSent: number; currencies: Record<string, number> };
  };
}

function formatCurrency(amount: number, currency = "HKD") {
  return new Intl.NumberFormat("en-HK", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount);
}

function getLast12Months(): { value: string; label: string }[] {
  const months = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    months.push({ value, label });
  }
  return months;
}

export default function ReportsPage() {
  const months = getLast12Months();
  const [selectedMonth, setSelectedMonth] = useState(months[1]?.value || months[0].value); // default last month
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async (month: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/monthly?month=${month}`);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      setReport(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchReport(selectedMonth); }, [selectedMonth, fetchReport]);

  const xeroInvoiceTotal = report?.xero?.invoices?.reduce((s, i) => s + (i.type === "ACCREC" ? i.total : 0), 0) || 0;
  const xeroBillTotal = report?.xero?.bills?.reduce((s, b) => s + b.total, 0) || 0;

  return (
    <>
      <TopBar title="Monthly Reports" subtitle={report?.monthLabel || "Select a month"} />
      <div className="p-6 space-y-6 max-w-6xl">

        {/* Month Selector */}
        <div className="flex items-center gap-4">
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className={`${cx.input} w-56`}
          >
            {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <button onClick={() => fetchReport(selectedMonth)} className={cx.btnSecondary}>Refresh</button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin h-10 w-10 border-4 border-blue-600 border-t-transparent rounded-full" />
          </div>
        )}

        {error && (
          <div className={`${cx.card} p-8 text-center`}>
            <p className="text-red-500">{error}</p>
            <button onClick={() => fetchReport(selectedMonth)} className={`${cx.btnPrimary} mt-4`}>Retry</button>
          </div>
        )}

        {!loading && !error && report && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <div className={`${cx.card} p-5`}>
                <div className="text-sm text-gray-500">Total Files</div>
                <div className="text-2xl font-bold text-blue-600">{report.summary.totalFiles}</div>
              </div>
              <div className={`${cx.card} p-5`}>
                <div className="text-sm text-gray-500">With Amounts</div>
                <div className="text-2xl font-bold text-green-600">{report.summary.filesWithAmounts}</div>
              </div>
              <div className={`${cx.card} p-5`}>
                <div className="text-sm text-gray-500">File Total</div>
                <div className="text-2xl font-bold">{formatCurrency(report.summary.totalAmount)}</div>
              </div>
              <div className={`${cx.card} p-5`}>
                <div className="text-sm text-gray-500">Xero Invoiced</div>
                <div className="text-2xl font-bold text-green-600">{formatCurrency(xeroInvoiceTotal)}</div>
              </div>
              <div className={`${cx.card} p-5`}>
                <div className="text-sm text-gray-500">Xero Billed</div>
                <div className="text-2xl font-bold text-red-600">{formatCurrency(xeroBillTotal)}</div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Category Breakdown */}
              <div className={cx.card}>
                <div className="px-4 py-3 border-b bg-gray-50/50">
                  <h3 className="font-semibold text-sm">Category Breakdown</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50/50">
                      <tr>
                        <th className={cx.tableHeader}>Category</th>
                        <th className={`${cx.tableHeader} text-right`}>Files</th>
                        <th className={`${cx.tableHeader} text-right`}>Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {report.categories.length === 0 ? (
                        <tr><td colSpan={3} className="p-6 text-center text-gray-400">No files this month</td></tr>
                      ) : report.categories.map(c => (
                        <tr key={c.category} className="hover:bg-gray-50">
                          <td className={`${cx.tableCell} font-medium capitalize`}>{c.category.replace("_", " ")}</td>
                          <td className={`${cx.tableCell} text-right`}>{c.count}</td>
                          <td className={`${cx.tableCell} text-right font-medium`}>{c.total > 0 ? formatCurrency(c.total) : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Top Vendors */}
              <div className={cx.card}>
                <div className="px-4 py-3 border-b bg-gray-50/50">
                  <h3 className="font-semibold text-sm">Top Vendors</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50/50">
                      <tr>
                        <th className={cx.tableHeader}>#</th>
                        <th className={cx.tableHeader}>Vendor</th>
                        <th className={`${cx.tableHeader} text-right`}>Files</th>
                        <th className={`${cx.tableHeader} text-right`}>Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {report.topVendors.length === 0 ? (
                        <tr><td colSpan={4} className="p-6 text-center text-gray-400">No vendor data</td></tr>
                      ) : report.topVendors.map((v, i) => (
                        <tr key={v.vendor} className="hover:bg-gray-50">
                          <td className={`${cx.tableCell} text-gray-400`}>{i + 1}</td>
                          <td className={`${cx.tableCell} font-medium`}>{v.vendor}</td>
                          <td className={`${cx.tableCell} text-right`}>{v.count}</td>
                          <td className={`${cx.tableCell} text-right font-medium`}>{v.total > 0 ? formatCurrency(v.total) : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Xero Section */}
            {report.xero && (report.xero.invoices?.length > 0 || report.xero.bills?.length > 0) && (
              <div className={cx.card}>
                <div className="px-4 py-3 border-b bg-gray-50/50">
                  <h3 className="font-semibold text-sm">Xero — Invoices & Bills</h3>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-gray-100">
                  {/* Invoices */}
                  <div className="p-4">
                    <div className="text-xs text-gray-500 mb-2 font-medium">Invoices ({report.xero.invoices?.length || 0}) — {formatCurrency(xeroInvoiceTotal)}</div>
                    <div className="space-y-1.5 max-h-60 overflow-y-auto">
                      {(report.xero.invoices || []).map((inv, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <div className="min-w-0">
                            <span className="font-medium">{inv.invoiceNumber}</span>
                            <span className="text-gray-400 ml-2">{inv.contact}</span>
                          </div>
                          <div className="shrink-0 ml-3 font-medium">{formatCurrency(inv.total, inv.currency)}</div>
                        </div>
                      ))}
                      {(!report.xero.invoices || report.xero.invoices.length === 0) && (
                        <p className="text-gray-400 text-sm">No invoices this month</p>
                      )}
                    </div>
                  </div>
                  {/* Bills */}
                  <div className="p-4">
                    <div className="text-xs text-gray-500 mb-2 font-medium">Bills ({report.xero.bills?.length || 0}) — {formatCurrency(xeroBillTotal)}</div>
                    <div className="space-y-1.5 max-h-60 overflow-y-auto">
                      {(report.xero.bills || []).map((bill, i) => (
                        <div key={i} className="flex items-center justify-between text-sm">
                          <div className="min-w-0">
                            <span className="font-medium">{bill.invoiceNumber || "-"}</span>
                            <span className="text-gray-400 ml-2">{bill.contact}</span>
                          </div>
                          <div className="shrink-0 ml-3 font-medium text-red-600">{formatCurrency(bill.total, bill.currency)}</div>
                        </div>
                      ))}
                      {(!report.xero.bills || report.xero.bills.length === 0) && (
                        <p className="text-gray-400 text-sm">No bills this month</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Wise Section */}
            {report.wise?.totals?.count > 0 && (
              <div className={cx.card}>
                <div className="px-4 py-3 border-b bg-gray-50/50">
                  <h3 className="font-semibold text-sm">Wise Transfers — {report.wise.totals.count} transfers</h3>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {Object.entries(report.wise.totals.currencies).map(([cur, amount]) => (
                      <div key={cur} className="bg-gray-50 rounded-lg p-3 text-center">
                        <div className="text-lg font-bold">{cur}</div>
                        <div className="text-sm text-gray-600">{Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* No data state */}
            {report.summary.totalFiles === 0 && (!report.xero?.invoices?.length) && (!report.wise?.totals?.count) && (
              <div className={`${cx.card} p-12 text-center`}>
                <p className="text-gray-400 text-lg">No data for {report.monthLabel}</p>
                <p className="text-gray-400 text-sm mt-1">Try selecting a different month</p>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
