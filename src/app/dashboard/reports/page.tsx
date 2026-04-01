"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { TopBar } from "@/components/TopBar";
import { cx } from "@/lib/cn";

/* ---------- Types ---------- */

interface CategoryBreakdown {
  category: string;
  count: number;
  total: number;
}

interface VendorBreakdown {
  vendor: string;
  count: number;
  total: number;
}

interface XeroSection {
  invoicesCreated: number;
  billsCreated: number;
  paymentsReceived: number;
}

interface WiseTransfer {
  currency: string;
  count: number;
  total: number;
}

interface WiseSection {
  transfersMade: number;
  byCurrency: WiseTransfer[];
}

interface MonthlyReport {
  month: string;
  totalIncome: number;
  totalExpenses: number;
  net: number;
  fileCount: number;
  categories: CategoryBreakdown[];
  topVendors: VendorBreakdown[];
  xero: XeroSection;
  wise: WiseSection;
}

/* ---------- Helpers ---------- */

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(amount);
}

function getLastNMonths(n: number): { value: string; label: string }[] {
  const months: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 1; i <= n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    months.push({ value, label });
  }
  return months;
}

/* ---------- Component ---------- */

export default function ReportsPage() {
  const monthOptions = useMemo(() => getLastNMonths(12), []);
  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0].value);
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReport = useCallback(async (month: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/monthly?month=${month}`);
      if (!res.ok) throw new Error(`Failed to fetch report (${res.status})`);
      const data: MonthlyReport = await res.json();
      setReport(data);
    } catch (err) {
      console.error("Failed to load report:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReport(selectedMonth);
  }, [selectedMonth, fetchReport]);

  const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedMonth(e.target.value);
  };

  /* ---------- Loading state ---------- */

  if (loading) {
    return (
      <>
        <TopBar title="Monthly Reports" subtitle="Loading..." />
        <div className="flex items-center justify-center py-32">
          <div className="animate-spin h-10 w-10 border-4 border-blue-600 border-t-transparent rounded-full" />
        </div>
      </>
    );
  }

  /* ---------- Render ---------- */

  const monthLabel = monthOptions.find((m) => m.value === selectedMonth)?.label ?? selectedMonth;

  return (
    <>
      <TopBar title="Monthly Reports" subtitle={monthLabel} />
      <div className="p-6 space-y-6">

        {/* Month Selector */}
        <div className="flex items-center gap-3">
          <label htmlFor="month-select" className="text-sm font-medium text-gray-700">
            Report Month
          </label>
          <select
            id="month-select"
            value={selectedMonth}
            onChange={handleMonthChange}
            className={`${cx.input} w-56`}
          >
            {monthOptions.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* Error State */}
        {error && (
          <div className={`${cx.card} p-8 text-center`}>
            <p className="text-red-500 font-medium mb-2">Failed to load report</p>
            <p className="text-sm text-gray-400 mb-4">{error}</p>
            <button onClick={() => fetchReport(selectedMonth)} className={cx.btnPrimary}>
              Retry
            </button>
          </div>
        )}

        {/* Report Content */}
        {report && (
          <>
            {/* ===== Summary Cards ===== */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className={`${cx.card} p-5`}>
                <div className="text-sm text-gray-500 mb-1">Total Income</div>
                <div className="text-2xl font-bold text-green-600">{formatCurrency(report.totalIncome)}</div>
              </div>
              <div className={`${cx.card} p-5`}>
                <div className="text-sm text-gray-500 mb-1">Total Expenses</div>
                <div className="text-2xl font-bold text-red-600">{formatCurrency(report.totalExpenses)}</div>
              </div>
              <div className={`${cx.card} p-5`}>
                <div className="text-sm text-gray-500 mb-1">Net</div>
                <div className={`text-2xl font-bold ${report.net >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {formatCurrency(report.net)}
                </div>
              </div>
              <div className={`${cx.card} p-5`}>
                <div className="text-sm text-gray-500 mb-1">Files Processed</div>
                <div className="text-2xl font-bold text-blue-600">{report.fileCount}</div>
              </div>
            </div>

            {/* ===== Category Breakdown + Top Vendors side by side ===== */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

              {/* Category Breakdown */}
              <div className={`${cx.card} overflow-hidden`}>
                <div className="px-4 py-3 border-b bg-gray-50/50">
                  <h3 className="font-semibold text-sm">Category Breakdown</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50/80">
                      <tr>
                        <th className={cx.tableHeader}>Category</th>
                        <th className={`${cx.tableHeader} text-right`}>Count</th>
                        <th className={`${cx.tableHeader} text-right`}>Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {report.categories.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="p-6 text-center text-gray-400 text-sm">
                            No categories
                          </td>
                        </tr>
                      ) : (
                        report.categories.map((cat) => (
                          <tr key={cat.category} className="hover:bg-gray-50/50">
                            <td className={`${cx.tableCell} font-medium`}>{cat.category}</td>
                            <td className={`${cx.tableCell} text-right text-gray-500`}>{cat.count}</td>
                            <td className={`${cx.tableCell} text-right font-medium`}>{formatCurrency(cat.total)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-2 border-t bg-gray-50/50 text-xs text-gray-400">
                  {report.categories.length} categor{report.categories.length !== 1 ? "ies" : "y"}
                </div>
              </div>

              {/* Top Vendors */}
              <div className={`${cx.card} overflow-hidden`}>
                <div className="px-4 py-3 border-b bg-gray-50/50">
                  <h3 className="font-semibold text-sm">Top 10 Vendors</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50/80">
                      <tr>
                        <th className={`${cx.tableHeader} w-8`}>#</th>
                        <th className={cx.tableHeader}>Vendor</th>
                        <th className={`${cx.tableHeader} text-right`}>Count</th>
                        <th className={`${cx.tableHeader} text-right`}>Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {report.topVendors.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="p-6 text-center text-gray-400 text-sm">
                            No vendor data
                          </td>
                        </tr>
                      ) : (
                        report.topVendors.map((v, i) => (
                          <tr key={v.vendor} className="hover:bg-gray-50/50">
                            <td className={`${cx.tableCell} text-gray-400 text-xs`}>{i + 1}</td>
                            <td className={`${cx.tableCell} font-medium`}>{v.vendor}</td>
                            <td className={`${cx.tableCell} text-right text-gray-500`}>{v.count}</td>
                            <td className={`${cx.tableCell} text-right font-medium`}>{formatCurrency(v.total)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-2 border-t bg-gray-50/50 text-xs text-gray-400">
                  {report.topVendors.length} vendor{report.topVendors.length !== 1 ? "s" : ""}
                </div>
              </div>
            </div>

            {/* ===== Xero + Wise side by side ===== */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

              {/* Xero Section */}
              <div className={`${cx.card} overflow-hidden`}>
                <div className="px-4 py-3 border-b bg-gray-50/50 flex items-center gap-2">
                  <div className="w-5 h-5 rounded bg-[#13B5EA]/10 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-[#13B5EA]">X</span>
                  </div>
                  <h3 className="font-semibold text-sm">Xero Activity</h3>
                </div>
                <div className="grid grid-cols-3 divide-x divide-gray-100">
                  <div className="p-5 text-center">
                    <div className="text-2xl font-bold text-blue-600">{report.xero.invoicesCreated}</div>
                    <div className="text-xs text-gray-500 mt-1">Invoices Created</div>
                  </div>
                  <div className="p-5 text-center">
                    <div className="text-2xl font-bold text-orange-600">{report.xero.billsCreated}</div>
                    <div className="text-xs text-gray-500 mt-1">Bills Created</div>
                  </div>
                  <div className="p-5 text-center">
                    <div className="text-2xl font-bold text-green-600">{report.xero.paymentsReceived}</div>
                    <div className="text-xs text-gray-500 mt-1">Payments Received</div>
                  </div>
                </div>
              </div>

              {/* Wise Section */}
              <div className={`${cx.card} overflow-hidden`}>
                <div className="px-4 py-3 border-b bg-gray-50/50 flex items-center gap-2">
                  <div className="w-5 h-5 rounded bg-green-100 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-green-700">W</span>
                  </div>
                  <h3 className="font-semibold text-sm">Wise Transfers</h3>
                </div>
                <div className="p-4">
                  <div className="mb-3">
                    <span className="text-sm text-gray-500">Total transfers: </span>
                    <span className="text-sm font-semibold">{report.wise.transfersMade}</span>
                  </div>
                  {report.wise.byCurrency.length === 0 ? (
                    <p className="text-sm text-gray-400">No transfers this month</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50/80">
                          <tr>
                            <th className={cx.tableHeader}>Currency</th>
                            <th className={`${cx.tableHeader} text-right`}>Count</th>
                            <th className={`${cx.tableHeader} text-right`}>Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {report.wise.byCurrency.map((w) => (
                            <tr key={w.currency} className="hover:bg-gray-50/50">
                              <td className={`${cx.tableCell} font-medium`}>
                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                                  {w.currency}
                                </span>
                              </td>
                              <td className={`${cx.tableCell} text-right text-gray-500`}>{w.count}</td>
                              <td className={`${cx.tableCell} text-right font-medium`}>
                                {new Intl.NumberFormat("en-US", {
                                  style: "currency",
                                  currency: w.currency,
                                  minimumFractionDigits: 2,
                                }).format(w.total)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
