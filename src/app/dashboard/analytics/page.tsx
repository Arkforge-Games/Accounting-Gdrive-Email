"use client";

import { useState, useEffect, useCallback } from "react";
import { TopBar } from "@/components/TopBar";
import { cx } from "@/lib/cn";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CurrencyPosition {
  currency: string;
  amount: number;
  hkdEquivalent: number;
}

interface XeroComparison {
  receivable: number;
  payable: number;
}

interface ExchangeRate {
  pair: string;
  rate: number;
}

interface OverviewData {
  positions: CurrencyPosition[];
  netHKD: number;
  xero: XeroComparison;
  exchangeRates: ExchangeRate[];
}

interface SpendingCategory {
  name: string;
  count: number;
  total: number;
}

interface SpendingMonth {
  period: string;
  label: string;
  categories: SpendingCategory[];
  total: number;
  fileCount: number;
}

interface SpendingData {
  months: SpendingMonth[];
}

interface CashFlowItem {
  description: string;
  amount: number;
  type: "inflow" | "outflow";
  date?: string;
}

interface CashFlowPeriod {
  period: string;
  label: string;
  inflow: number;
  outflow: number;
  net: number;
  items: CashFlowItem[];
}

interface CashFlowData {
  forecast: CashFlowPeriod[];
}

interface Vendor {
  rank: number;
  name: string;
  fileCount: number;
  totalAmount: number;
  avgAmount: number;
  categories: string[];
  firstSeen: string;
  lastSeen: string;
}

interface VendorData {
  vendors: Vendor[];
}

interface BudgetCategory {
  category: string;
  budget: number;
  actual: number;
  remaining: number;
  percentage: number;
}

interface BudgetData {
  categories: BudgetCategory[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TABS = [
  { key: "overview", label: "Overview", action: "overview" },
  { key: "spending", label: "Spending Trends", action: "spending-trends" },
  { key: "cashflow", label: "Cash Flow", action: "cash-flow" },
  { key: "vendors", label: "Vendors", action: "vendor-scorecard" },
  { key: "budget", label: "Budget", action: "budget" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function fmt(n: number, currency?: string): string {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-HK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const prefix = n < 0 ? "-" : "";
  return currency ? `${prefix}${currency} ${formatted}` : `${prefix}$${formatted}`;
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Overview
// ---------------------------------------------------------------------------

function OverviewTab({ data }: { data: OverviewData }) {
  return (
    <div className="space-y-6">
      {/* Currency positions */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Multi-Currency Positions
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.positions.map((p) => (
            <div key={p.currency} className={`${cx.card} p-5`}>
              <p className="text-xs text-gray-400 uppercase">{p.currency}</p>
              <p className="text-xl font-bold mt-1">{fmt(p.amount, p.currency)}</p>
              <p className="text-sm text-gray-500 mt-0.5">
                HKD Equiv: {fmt(p.hkdEquivalent, "HKD")}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Net position */}
      <section>
        <div className={`${cx.card} p-6 border-l-4 border-l-blue-500`}>
          <p className="text-xs text-gray-400 uppercase">Net Position (Total HKD)</p>
          <p
            className={`text-2xl font-bold mt-1 ${
              data.netHKD >= 0 ? "text-green-600" : "text-red-600"
            }`}
          >
            {fmt(data.netHKD, "HKD")}
          </p>
        </div>
      </section>

      {/* Xero receivable vs payable */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Xero: Receivable vs Payable
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className={`${cx.card} p-5 border-l-4 border-l-green-500`}>
            <p className="text-xs text-gray-400 uppercase">Receivable</p>
            <p className="text-xl font-bold text-green-600 mt-1">
              {fmt(data.xero.receivable)}
            </p>
          </div>
          <div className={`${cx.card} p-5 border-l-4 border-l-red-500`}>
            <p className="text-xs text-gray-400 uppercase">Payable</p>
            <p className="text-xl font-bold text-red-600 mt-1">
              {fmt(data.xero.payable)}
            </p>
          </div>
        </div>
      </section>

      {/* Exchange rates */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Exchange Rates
        </h2>
        <div className={cx.card}>
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className={cx.tableHeader}>Pair</th>
                <th className={`${cx.tableHeader} text-right`}>Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.exchangeRates.map((r) => (
                <tr key={r.pair}>
                  <td className={cx.tableCell}>{r.pair}</td>
                  <td className={`${cx.tableCell} text-right font-mono`}>
                    {r.rate.toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Spending Trends
// ---------------------------------------------------------------------------

function SpendingTab({ data }: { data: SpendingData }) {
  const { months } = data;

  // Collect all unique category names
  const allCategories = Array.from(
    new Set(months.flatMap((m) => m.categories.map((c) => c.name)))
  ).sort();

  // Category totals across all time
  const categoryTotals: Record<string, number> = {};
  months.forEach((m) =>
    m.categories.forEach((c) => {
      categoryTotals[c.name] = (categoryTotals[c.name] || 0) + c.total;
    })
  );
  const maxCategoryTotal = Math.max(...Object.values(categoryTotals), 1);

  return (
    <div className="space-y-6">
      {/* Monthly table */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Monthly Breakdown
        </h2>
        <div className={`${cx.card} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className={cx.tableHeader}>Month</th>
                <th className={`${cx.tableHeader} text-right`}>Files</th>
                {allCategories.map((cat) => (
                  <th key={cat} className={`${cx.tableHeader} text-right`}>
                    {cat}
                  </th>
                ))}
                <th className={`${cx.tableHeader} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {months.map((m) => {
                const catMap: Record<string, number> = {};
                m.categories.forEach((c) => (catMap[c.name] = c.total));
                return (
                  <tr key={m.period} className="hover:bg-gray-50">
                    <td className={`${cx.tableCell} font-medium`}>{m.label}</td>
                    <td className={`${cx.tableCell} text-right`}>{m.fileCount}</td>
                    {allCategories.map((cat) => (
                      <td key={cat} className={`${cx.tableCell} text-right font-mono`}>
                        {catMap[cat] ? fmt(catMap[cat]) : "-"}
                      </td>
                    ))}
                    <td className={`${cx.tableCell} text-right font-bold`}>{fmt(m.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Category totals with bar chart */}
      <section>
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Category Totals (All Time)
        </h2>
        <div className={`${cx.card} p-5 space-y-3`}>
          {Object.entries(categoryTotals)
            .sort(([, a], [, b]) => b - a)
            .map(([cat, total]) => {
              const pct = (total / maxCategoryTotal) * 100;
              return (
                <div key={cat}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="font-medium">{cat}</span>
                    <span className="font-mono">{fmt(total)}</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-3">
                    <div
                      className="bg-blue-500 h-3 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Cash Flow
// ---------------------------------------------------------------------------

function CashFlowTab({ data }: { data: CashFlowData }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const toggle = (period: string) =>
    setExpanded((prev) => ({ ...prev, [period]: !prev[period] }));

  const totalInflow = data.forecast.reduce((s, f) => s + f.inflow, 0);
  const totalOutflow = data.forecast.reduce((s, f) => s + f.outflow, 0);
  const totalNet = data.forecast.reduce((s, f) => s + f.net, 0);

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={`${cx.card} p-5 border-l-4 border-l-green-500`}>
          <p className="text-xs text-gray-400 uppercase">Total Inflow</p>
          <p className="text-xl font-bold text-green-600 mt-1">{fmt(totalInflow)}</p>
        </div>
        <div className={`${cx.card} p-5 border-l-4 border-l-red-500`}>
          <p className="text-xs text-gray-400 uppercase">Total Outflow</p>
          <p className="text-xl font-bold text-red-600 mt-1">{fmt(totalOutflow)}</p>
        </div>
        <div className={`${cx.card} p-5 border-l-4 border-l-blue-500`}>
          <p className="text-xs text-gray-400 uppercase">Net</p>
          <p
            className={`text-xl font-bold mt-1 ${
              totalNet >= 0 ? "text-green-600" : "text-red-600"
            }`}
          >
            {fmt(totalNet)}
          </p>
        </div>
      </div>

      {/* Period cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.forecast.map((f) => (
          <div key={f.period} className={`${cx.card} p-5`}>
            <h3 className="text-sm font-semibold mb-3">{f.label}</h3>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Inflow</span>
                <span className="text-green-600 font-mono font-medium">
                  +{fmt(f.inflow)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Outflow</span>
                <span className="text-red-600 font-mono font-medium">
                  -{fmt(f.outflow)}
                </span>
              </div>
              <div className="flex justify-between border-t pt-1 mt-1">
                <span className="font-medium">Net</span>
                <span
                  className={`font-mono font-bold ${
                    f.net >= 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {fmt(f.net)}
                </span>
              </div>
            </div>

            {f.items && f.items.length > 0 && (
              <div className="mt-3">
                <button
                  onClick={() => toggle(f.period)}
                  className={cx.btnSecondary + " text-xs py-1 px-2"}
                >
                  {expanded[f.period] ? "Hide" : "Show"} {f.items.length} items
                </button>
                {expanded[f.period] && (
                  <ul className="mt-2 space-y-1 text-sm max-h-48 overflow-y-auto">
                    {f.items.map((item, i) => (
                      <li
                        key={i}
                        className="flex justify-between py-1 border-b border-gray-50"
                      >
                        <span className="text-gray-600 truncate mr-2">
                          {item.description}
                        </span>
                        <span
                          className={`font-mono whitespace-nowrap ${
                            item.type === "inflow" ? "text-green-600" : "text-red-600"
                          }`}
                        >
                          {item.type === "inflow" ? "+" : "-"}
                          {fmt(item.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Vendors
// ---------------------------------------------------------------------------

function VendorsTab({ data }: { data: VendorData }) {
  const [search, setSearch] = useState("");

  const filtered = data.vendors.filter((v) =>
    v.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="max-w-sm">
        <input
          type="text"
          placeholder="Search vendors..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={cx.input}
        />
      </div>

      <div className={`${cx.card} overflow-x-auto`}>
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className={cx.tableHeader}>#</th>
              <th className={cx.tableHeader}>Vendor</th>
              <th className={`${cx.tableHeader} text-right`}>Files</th>
              <th className={`${cx.tableHeader} text-right`}>Total</th>
              <th className={`${cx.tableHeader} text-right`}>Avg</th>
              <th className={cx.tableHeader}>Categories</th>
              <th className={cx.tableHeader}>First Seen</th>
              <th className={cx.tableHeader}>Last Seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className={`${cx.tableCell} text-center text-gray-400`}>
                  No vendors found.
                </td>
              </tr>
            )}
            {filtered.map((v, i) => (
              <tr key={v.name} className="hover:bg-gray-50">
                <td className={`${cx.tableCell} text-gray-400`}>{i + 1}</td>
                <td className={`${cx.tableCell} font-medium`}>{v.name}</td>
                <td className={`${cx.tableCell} text-right`}>{v.fileCount}</td>
                <td className={`${cx.tableCell} text-right font-mono`}>
                  {fmt(v.totalAmount)}
                </td>
                <td className={`${cx.tableCell} text-right font-mono`}>
                  {fmt(v.avgAmount)}
                </td>
                <td className={cx.tableCell}>
                  <div className="flex flex-wrap gap-1">
                    {v.categories.map((c) => (
                      <span
                        key={c}
                        className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </td>
                <td className={`${cx.tableCell} text-gray-500`}>{v.firstSeen}</td>
                <td className={`${cx.tableCell} text-gray-500`}>{v.lastSeen}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab: Budget
// ---------------------------------------------------------------------------

function BudgetTab({ data }: { data: BudgetData }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {data.categories.map((b) => {
        const pct = b.budget > 0 ? (b.actual / b.budget) * 100 : 0;
        const over = pct > 100;
        return (
          <div key={b.category} className={`${cx.card} p-5`}>
            <h3 className="text-sm font-semibold mb-1">{b.category}</h3>
            <div className="flex justify-between text-xs text-gray-500 mb-2">
              <span>Budget: {fmt(b.budget)}</span>
              <span>Actual: {fmt(b.actual)}</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-3 mb-2">
              <div
                className={`h-3 rounded-full transition-all ${
                  over ? "bg-red-500" : "bg-green-500"
                }`}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-xs">
              <span className={`font-medium ${over ? "text-red-600" : "text-green-600"}`}>
                {pct.toFixed(1)}%
              </span>
              <span className={over ? "text-red-600" : "text-gray-500"}>
                {over ? "Over by " : "Remaining: "}
                {fmt(Math.abs(b.remaining))}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const [data, setData] = useState<any>({});
  const [loading, setLoading] = useState<any>({});
  const [errors, setErrors] = useState<any>({});
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const fetchTab = useCallback(
    async (action: string, key: string) => {
      if (data[key] || loading[key]) return;
      setLoading((p: any) => ({ ...p, [key]: true }));
      setErrors((p: any) => ({ ...p, [key]: "" }));
      try {
        const res = await fetch(`/api/analytics?action=${action}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setData((p: any) => ({ ...p, [key]: json }));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to fetch";
        setErrors((p: any) => ({ ...p, [key]: msg }));
      } finally {
        setLoading((p: any) => ({ ...p, [key]: false }));
      }
    },
    [data, loading]
  );

  useEffect(() => {
    const tab = TABS.find((t) => t.key === activeTab);
    if (tab) fetchTab(tab.action, tab.key);
  }, [activeTab, fetchTab]);

  const currentTab = TABS.find((t) => t.key === activeTab)!;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopBar title="Analytics" subtitle="Financial overview and insights" />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Tab bar */}
        <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.key
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Error */}
        {(() => {
          const err = errors[activeTab];
          if (!err) return null;
          return (
            <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg border border-red-200">
              Error loading {currentTab.label}: {err}
            </div>
          );
        })()}

        {/* Content */}
        {loading[activeTab] && <Spinner />}

        {!loading[activeTab] && data[activeTab] && (
          <>
            {activeTab === "overview" && (
              <OverviewTab data={data.overview as OverviewData} />
            )}
            {activeTab === "spending" && (
              <SpendingTab data={data.spending as SpendingData} />
            )}
            {activeTab === "cashflow" && (
              <CashFlowTab data={data.cashflow as CashFlowData} />
            )}
            {activeTab === "vendors" && (
              <VendorsTab data={data.vendors as VendorData} />
            )}
            {activeTab === "budget" && (
              <BudgetTab data={data.budget as BudgetData} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
