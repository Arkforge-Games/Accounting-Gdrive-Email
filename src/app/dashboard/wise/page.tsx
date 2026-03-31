"use client";

import { useEffect, useState, useCallback } from "react";
import { TopBar } from "@/components/TopBar";
import { cx } from "@/lib/cn";
import { IconSearch } from "@/components/icons";

interface WiseProfile {
  id: number;
  type: string;
  details: { name?: string; firstName?: string; lastName?: string; registrationNumber?: string; phoneNumber?: string; webpage?: string };
}

interface WiseBalance {
  currency: string;
  value: number;
  reserved: number;
  bankDetails?: { accountNumber?: string; iban?: string; swift?: string; bankName?: string };
}

interface WiseTransfer {
  id: number;
  status: string;
  reference: string;
  created: string;
  sourceCurrency: string;
  sourceValue: number;
  targetCurrency: string;
  targetValue: number;
  rate: number;
  details: { reference: string };
}

interface WiseRecipient {
  id: number;
  accountHolderName: string;
  type: string;
  currency: string;
  country: string;
  active: boolean;
  details: Record<string, unknown>;
}

interface WiseSummary {
  profile: WiseProfile;
  balances: WiseBalance[];
  recentTransfers: WiseTransfer[];
  totalBalanceHKD: number;
}

type Tab = "overview" | "transfers" | "recipients" | "rates";

const statusColors: Record<string, string> = {
  outgoing_payment_sent: "bg-green-100 text-green-700",
  funds_converted: "bg-blue-100 text-blue-700",
  processing: "bg-yellow-100 text-yellow-700",
  funds_refunded: "bg-red-100 text-red-700",
  cancelled: "bg-gray-100 text-gray-500",
  waiting_recipient_input_to_proceed: "bg-orange-100 text-orange-700",
  charged: "bg-blue-100 text-blue-700",
  incoming_payment_waiting: "bg-yellow-100 text-yellow-700",
  bounced_back: "bg-red-100 text-red-700",
};

const statusLabels: Record<string, string> = {
  outgoing_payment_sent: "Sent",
  funds_converted: "Converted",
  processing: "Processing",
  funds_refunded: "Refunded",
  cancelled: "Cancelled",
  waiting_recipient_input_to_proceed: "Waiting",
  charged: "Charged",
  incoming_payment_waiting: "Incoming",
  bounced_back: "Bounced",
};

const currencyFlags: Record<string, string> = {
  HKD: "HK$", PHP: "₱", USD: "$", EUR: "€", GBP: "£", SGD: "S$",
  MYR: "RM", IDR: "Rp", JPY: "¥", AUD: "A$", CAD: "C$", THB: "฿",
  CNY: "¥", KRW: "₩", INR: "₹", TWD: "NT$", VND: "₫", NZD: "NZ$",
};

function formatCurrency(amount: number, currency = "HKD") {
  const symbol = currencyFlags[currency] || currency + " ";
  return `${symbol}${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr: string) {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(dateStr: string) {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function WisePage() {
  const [summary, setSummary] = useState<WiseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [tabLoading, setTabLoading] = useState(false);

  // Tab data
  const [allTransfers, setAllTransfers] = useState<WiseTransfer[]>([]);
  const [recipients, setRecipients] = useState<WiseRecipient[]>([]);
  const [rates, setRates] = useState<{ source: string; target: string; rate: number; time: string }[]>([]);
  const [search, setSearch] = useState("");

  // Rate converter
  const [rateFrom, setRateFrom] = useState("HKD");
  const [rateTo, setRateTo] = useState("PHP");

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/wise?action=summary");
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to load Wise data");
      }
      setSummary(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  const loadTab = useCallback(async (t: Tab) => {
    setTab(t);
    if (t === "overview") return;
    setTabLoading(true);
    try {
      switch (t) {
        case "transfers": {
          const res = await fetch("/api/wise?action=transfers&limit=50");
          const data = await res.json();
          setAllTransfers(data.transfers || []);
          break;
        }
        case "recipients": {
          const res = await fetch("/api/wise?action=recipients");
          const data = await res.json();
          setRecipients(data.recipients || []);
          break;
        }
        case "rates": {
          const res = await fetch(`/api/wise?action=rate&source=${rateFrom}&target=${rateTo}`);
          const data = await res.json();
          setRates(data.rates || []);
          break;
        }
      }
    } catch (err) {
      console.error(`Failed to load ${t}:`, err);
    }
    setTabLoading(false);
  }, [rateFrom, rateTo]);

  const fetchRate = async () => {
    setTabLoading(true);
    try {
      const res = await fetch(`/api/wise?action=rate&source=${rateFrom}&target=${rateTo}`);
      const data = await res.json();
      setRates(data.rates || []);
    } catch { /* ignore */ }
    setTabLoading(false);
  };

  const filteredTransfers = allTransfers.filter(t =>
    !search ||
    t.sourceCurrency?.toLowerCase().includes(search.toLowerCase()) ||
    t.targetCurrency?.toLowerCase().includes(search.toLowerCase()) ||
    t.reference?.toLowerCase().includes(search.toLowerCase()) ||
    t.details?.reference?.toLowerCase().includes(search.toLowerCase()) ||
    t.status?.toLowerCase().includes(search.toLowerCase())
  );

  const filteredRecipients = recipients.filter(r =>
    !search ||
    r.accountHolderName?.toLowerCase().includes(search.toLowerCase()) ||
    r.currency?.toLowerCase().includes(search.toLowerCase()) ||
    r.country?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <>
        <TopBar title="Wise" subtitle="Loading..." />
        <div className="flex items-center justify-center py-32">
          <div className="animate-spin h-10 w-10 border-4 border-[#9FE870] border-t-transparent rounded-full" />
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <TopBar title="Wise" subtitle="Error" />
        <div className="p-6">
          <div className={`${cx.card} p-12 text-center max-w-lg mx-auto`}>
            <div className="w-16 h-16 bg-[#9FE870]/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl font-bold text-[#163300]">W</span>
            </div>
            <h2 className="text-xl font-bold mb-2">Wise Connection Error</h2>
            <p className="text-gray-500 mb-4 text-sm">{error}</p>
            <button onClick={fetchSummary} className={`${cx.btn} text-white bg-[#163300] hover:bg-[#1e4400]`}>
              Retry
            </button>
          </div>
        </div>
      </>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "transfers", label: "Transfers" },
    { key: "recipients", label: "Recipients" },
    { key: "rates", label: "Exchange Rates" },
  ];

  const profileName = summary?.profile?.details?.name || `${summary?.profile?.details?.firstName || ""} ${summary?.profile?.details?.lastName || ""}`.trim() || "Wise";

  return (
    <>
      <TopBar title="Wise" subtitle={profileName} />
      <div className="p-6 space-y-5">

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-gray-200">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => loadTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? "border-[#9FE870] text-[#163300]"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {t.label}
            </button>
          ))}
          {(tab === "transfers" || tab === "recipients") && (
            <div className="ml-auto relative">
              <IconSearch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search..." className={`${cx.input} pl-9 py-1.5 text-sm w-56`}
              />
            </div>
          )}
        </div>

        {tabLoading && (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin h-8 w-8 border-4 border-[#9FE870] border-t-transparent rounded-full" />
          </div>
        )}

        {/* ===== OVERVIEW ===== */}
        {tab === "overview" && !tabLoading && summary && (
          <>
            {/* Balance Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {summary.balances.map(b => (
                <div key={b.currency} className={`${cx.card} p-5`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-lg font-bold text-[#163300]">{b.currency}</span>
                    {b.bankDetails?.accountNumber && (
                      <span className="text-[10px] text-gray-400 font-mono">{b.bankDetails.accountNumber}</span>
                    )}
                  </div>
                  <div className="text-2xl font-bold">{formatCurrency(b.value, b.currency)}</div>
                  {b.reserved > 0 && (
                    <div className="text-xs text-orange-500 mt-1">Reserved: {formatCurrency(b.reserved, b.currency)}</div>
                  )}
                  {b.bankDetails?.bankName && (
                    <div className="text-xs text-gray-400 mt-1">{b.bankDetails.bankName}</div>
                  )}
                </div>
              ))}
              {summary.balances.length === 0 && (
                <div className={`${cx.card} p-5 col-span-full text-center text-gray-400`}>No balances found</div>
              )}
            </div>

            {/* Profile Info */}
            <div className={`${cx.card} p-5`}>
              <h3 className="font-semibold text-sm mb-3">Account Info</h3>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-gray-400 text-xs">Account Type</div>
                  <div className="font-medium capitalize">{summary.profile.type}</div>
                </div>
                <div>
                  <div className="text-gray-400 text-xs">Profile ID</div>
                  <div className="font-medium font-mono">{summary.profile.id}</div>
                </div>
                {summary.profile.details.registrationNumber && (
                  <div>
                    <div className="text-gray-400 text-xs">Registration #</div>
                    <div className="font-medium">{summary.profile.details.registrationNumber}</div>
                  </div>
                )}
                {summary.profile.details.webpage && (
                  <div>
                    <div className="text-gray-400 text-xs">Website</div>
                    <div className="font-medium">{summary.profile.details.webpage}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Recent Transfers */}
            <div className={cx.card}>
              <div className="px-4 py-3 border-b bg-gray-50/50 flex items-center justify-between">
                <h3 className="font-semibold text-sm">Recent Transfers</h3>
                <button onClick={() => loadTab("transfers")} className="text-xs text-[#163300] hover:underline">View all</button>
              </div>
              <div className="divide-y divide-gray-100">
                {summary.recentTransfers.length === 0 ? (
                  <div className="p-8 text-center text-gray-400 text-sm">No transfers found</div>
                ) : summary.recentTransfers.map(t => (
                  <div key={t.id} className="px-4 py-3 flex items-center justify-between hover:bg-gray-50">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-10 h-10 rounded-full bg-[#163300]/10 flex items-center justify-center text-xs font-bold text-[#163300] shrink-0">
                        {t.sourceCurrency}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-sm">
                          {formatCurrency(t.sourceValue, t.sourceCurrency)}
                          <span className="text-gray-400 mx-1.5">&rarr;</span>
                          {formatCurrency(t.targetValue, t.targetCurrency)}
                        </div>
                        <div className="text-xs text-gray-400">
                          {formatDate(t.created)}
                          {t.reference && <span> &bull; {t.reference}</span>}
                          {t.rate && <span className="ml-2 text-gray-500">Rate: {t.rate.toFixed(4)}</span>}
                        </div>
                      </div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${statusColors[t.status] || "bg-gray-100 text-gray-600"}`}>
                      {statusLabels[t.status] || t.status.replace(/_/g, " ")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ===== TRANSFERS ===== */}
        {tab === "transfers" && !tabLoading && (
          <div className={`${cx.card} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50/80">
                  <tr>
                    <th className={cx.tableHeader}>Date</th>
                    <th className={cx.tableHeader}>From</th>
                    <th className={cx.tableHeader}></th>
                    <th className={cx.tableHeader}>To</th>
                    <th className={cx.tableHeader}>Rate</th>
                    <th className={cx.tableHeader}>Reference</th>
                    <th className={cx.tableHeader}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredTransfers.length === 0 ? (
                    <tr><td colSpan={7} className="p-8 text-center text-gray-400">No transfers found</td></tr>
                  ) : filteredTransfers.map(t => (
                    <tr key={t.id} className="hover:bg-gray-50/50">
                      <td className={`${cx.tableCell} text-gray-500 whitespace-nowrap`}>{formatDateTime(t.created)}</td>
                      <td className={`${cx.tableCell} font-medium whitespace-nowrap`}>
                        {formatCurrency(t.sourceValue, t.sourceCurrency)}
                        <span className="text-xs text-gray-400 ml-1">{t.sourceCurrency}</span>
                      </td>
                      <td className={`${cx.tableCell} text-gray-400`}>&rarr;</td>
                      <td className={`${cx.tableCell} font-medium whitespace-nowrap`}>
                        {formatCurrency(t.targetValue, t.targetCurrency)}
                        <span className="text-xs text-gray-400 ml-1">{t.targetCurrency}</span>
                      </td>
                      <td className={`${cx.tableCell} text-gray-500 font-mono text-sm`}>{t.rate?.toFixed(4) || "-"}</td>
                      <td className={`${cx.tableCell} text-gray-500 text-sm`}>{t.reference || t.details?.reference || "-"}</td>
                      <td className={cx.tableCell}>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[t.status] || "bg-gray-100 text-gray-600"}`}>
                          {statusLabels[t.status] || t.status.replace(/_/g, " ")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t bg-gray-50/50 text-xs text-gray-400">
              {filteredTransfers.length} transfer{filteredTransfers.length !== 1 ? "s" : ""}
            </div>
          </div>
        )}

        {/* ===== RECIPIENTS ===== */}
        {tab === "recipients" && !tabLoading && (
          <div className={`${cx.card} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50/80">
                  <tr>
                    <th className={cx.tableHeader}>Name</th>
                    <th className={cx.tableHeader}>Type</th>
                    <th className={cx.tableHeader}>Currency</th>
                    <th className={cx.tableHeader}>Country</th>
                    <th className={cx.tableHeader}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredRecipients.length === 0 ? (
                    <tr><td colSpan={5} className="p-8 text-center text-gray-400">No recipients found</td></tr>
                  ) : filteredRecipients.map(r => (
                    <tr key={r.id} className="hover:bg-gray-50/50">
                      <td className={`${cx.tableCell} font-medium`}>{r.accountHolderName}</td>
                      <td className={`${cx.tableCell} text-gray-500 capitalize text-sm`}>{r.type?.replace(/_/g, " ") || "-"}</td>
                      <td className={cx.tableCell}>
                        <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-700 text-xs font-mono font-medium">{r.currency}</span>
                      </td>
                      <td className={`${cx.tableCell} text-gray-500`}>{r.country || "-"}</td>
                      <td className={cx.tableCell}>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                          {r.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t bg-gray-50/50 text-xs text-gray-400">
              {filteredRecipients.length} recipient{filteredRecipients.length !== 1 ? "s" : ""}
            </div>
          </div>
        )}

        {/* ===== EXCHANGE RATES ===== */}
        {tab === "rates" && !tabLoading && (
          <div className="max-w-md">
            <div className={`${cx.card} p-6 space-y-4`}>
              <h3 className="font-semibold">Live Exchange Rate</h3>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
                  <select value={rateFrom} onChange={e => setRateFrom(e.target.value)} className={cx.input}>
                    {["HKD", "USD", "EUR", "GBP", "SGD", "PHP", "MYR", "IDR", "JPY", "AUD", "CNY", "THB", "TWD", "KRW", "INR", "VND", "CAD", "NZD"].map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="pt-5 text-gray-400 text-lg">&rarr;</div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
                  <select value={rateTo} onChange={e => setRateTo(e.target.value)} className={cx.input}>
                    {["PHP", "HKD", "USD", "EUR", "GBP", "SGD", "MYR", "IDR", "JPY", "AUD", "CNY", "THB", "TWD", "KRW", "INR", "VND", "CAD", "NZD"].map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button onClick={fetchRate} className={`${cx.btn} w-full justify-center text-white bg-[#163300] hover:bg-[#1e4400]`}>
                Get Rate
              </button>
              {rates.length > 0 && (
                <div className="bg-[#163300]/5 rounded-xl p-5 text-center">
                  <div className="text-sm text-gray-500 mb-1">1 {rates[0].source} =</div>
                  <div className="text-3xl font-bold text-[#163300]">{rates[0].rate.toFixed(4)} {rates[0].target}</div>
                  <div className="text-xs text-gray-400 mt-2">
                    Updated: {new Date(rates[0].time).toLocaleString()}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
