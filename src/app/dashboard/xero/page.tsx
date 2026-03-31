"use client";

import { useEffect, useState, useCallback } from "react";
import { TopBar } from "@/components/TopBar";
import { cx } from "@/lib/cn";
import { IconXero, IconSearch, IconChevronDown } from "@/components/icons";

interface XeroStatus {
  connected: boolean;
  tenant: { tenantId: string; tenantName: string } | null;
}

interface XeroSummary {
  organisation: string;
  currency: string;
  invoicesDue: number;
  billsDue: number;
  totalReceivable: number;
  totalPayable: number;
  recentInvoices: XeroInvoice[];
  recentBills: XeroInvoice[];
}

interface XeroInvoice {
  InvoiceID: string;
  InvoiceNumber: string;
  Type: "ACCREC" | "ACCPAY";
  Reference: string;
  Status: string;
  Contact: { ContactID: string; Name: string };
  DateString: string;
  DueDateString: string;
  Total: number;
  AmountDue: number;
  AmountPaid: number;
  CurrencyCode: string;
  HasAttachments: boolean;
  LineItems: { Description: string; Quantity: number; UnitAmount: number; LineAmount: number; AccountCode: string }[];
}

interface XeroContact {
  ContactID: string;
  Name: string;
  EmailAddress: string;
  IsSupplier: boolean;
  IsCustomer: boolean;
  Balances?: {
    AccountsReceivable?: { Outstanding: number; Overdue: number };
    AccountsPayable?: { Outstanding: number; Overdue: number };
  };
}

interface XeroBankTx {
  BankTransactionID: string;
  Type: "RECEIVE" | "SPEND";
  Contact: { ContactID: string; Name: string };
  DateString: string;
  Total: number;
  Reference: string;
  Status: string;
  BankAccount: { AccountID: string; Name: string; Code: string };
  LineItems: { Description: string; Quantity: number; UnitAmount: number; LineAmount: number; AccountCode: string }[];
}

interface XeroAccount {
  AccountID: string;
  Code: string;
  Name: string;
  Type: string;
  Class: string;
  Status: string;
  Description: string;
}

type Tab = "overview" | "invoices" | "bills" | "contacts" | "bank" | "accounts";

const statusColors: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  SUBMITTED: "bg-blue-100 text-blue-700",
  AUTHORISED: "bg-yellow-100 text-yellow-700",
  PAID: "bg-green-100 text-green-700",
  VOIDED: "bg-red-100 text-red-700",
  DELETED: "bg-red-100 text-red-500",
  OVERDUE: "bg-red-100 text-red-700",
  ACTIVE: "bg-green-100 text-green-700",
};

function formatCurrency(amount: number, currency = "PHP") {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount);
}

function formatDate(dateStr: string) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function XeroPage() {
  const [status, setStatus] = useState<XeroStatus | null>(null);
  const [summary, setSummary] = useState<XeroSummary | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState(false);

  // Tab data
  const [invoices, setInvoices] = useState<XeroInvoice[]>([]);
  const [bills, setBills] = useState<XeroInvoice[]>([]);
  const [contacts, setContacts] = useState<XeroContact[]>([]);
  const [bankTxs, setBankTxs] = useState<XeroBankTx[]>([]);
  const [accounts, setAccounts] = useState<XeroAccount[]>([]);
  const [search, setSearch] = useState("");

  // Expanded invoice rows
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchStatus = useCallback(async () => {
    const res = await fetch("/api/xero?action=status");
    const data = await res.json();
    setStatus(data);
    return data;
  }, []);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/xero?action=summary");
      if (res.ok) setSummary(await res.json());
    } catch { /* not connected */ }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const s = await fetchStatus();
      if (s.connected) await fetchSummary();
      setLoading(false);
    })();
  }, [fetchStatus, fetchSummary]);

  const loadTab = useCallback(async (t: Tab) => {
    setTab(t);
    if (t === "overview") return;
    setTabLoading(true);
    try {
      switch (t) {
        case "invoices": {
          const res = await fetch("/api/xero?action=invoices");
          const data = await res.json();
          setInvoices(data.Invoices || []);
          break;
        }
        case "bills": {
          const res = await fetch("/api/xero?action=bills");
          const data = await res.json();
          setBills(data.Bills || []);
          break;
        }
        case "contacts": {
          const res = await fetch("/api/xero?action=contacts");
          const data = await res.json();
          setContacts(data.Contacts || []);
          break;
        }
        case "bank": {
          const res = await fetch("/api/xero?action=bank-transactions");
          const data = await res.json();
          setBankTxs(data.BankTransactions || []);
          break;
        }
        case "accounts": {
          const res = await fetch("/api/xero?action=accounts");
          const data = await res.json();
          setAccounts(data.Accounts || []);
          break;
        }
      }
    } catch (err) {
      console.error(`Failed to load ${t}:`, err);
    }
    setTabLoading(false);
  }, []);

  const toggleExpand = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  // Filter helpers
  const filteredInvoices = invoices.filter(i =>
    !search || i.InvoiceNumber?.toLowerCase().includes(search.toLowerCase()) ||
    i.Contact?.Name?.toLowerCase().includes(search.toLowerCase()) ||
    i.Reference?.toLowerCase().includes(search.toLowerCase())
  );
  const filteredBills = bills.filter(i =>
    !search || i.InvoiceNumber?.toLowerCase().includes(search.toLowerCase()) ||
    i.Contact?.Name?.toLowerCase().includes(search.toLowerCase()) ||
    i.Reference?.toLowerCase().includes(search.toLowerCase())
  );
  const filteredContacts = contacts.filter(c =>
    !search || c.Name?.toLowerCase().includes(search.toLowerCase()) ||
    c.EmailAddress?.toLowerCase().includes(search.toLowerCase())
  );
  const filteredBankTxs = bankTxs.filter(t =>
    !search || t.Contact?.Name?.toLowerCase().includes(search.toLowerCase()) ||
    t.Reference?.toLowerCase().includes(search.toLowerCase())
  );
  const filteredAccounts = accounts.filter(a =>
    !search || a.Name?.toLowerCase().includes(search.toLowerCase()) ||
    a.Code?.toLowerCase().includes(search.toLowerCase()) ||
    a.Type?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <>
        <TopBar title="Xero Accounting" subtitle="Loading..." />
        <div className="flex items-center justify-center py-32">
          <div className="animate-spin h-10 w-10 border-4 border-[#13B5EA] border-t-transparent rounded-full" />
        </div>
      </>
    );
  }

  // Not connected
  if (!status?.connected) {
    return (
      <>
        <TopBar title="Xero Accounting" subtitle="Connect your Xero account" />
        <div className="p-6">
          <div className={`${cx.card} p-12 text-center max-w-lg mx-auto`}>
            <div className="w-16 h-16 bg-[#13B5EA]/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <IconXero className="w-10 h-10 text-[#13B5EA]" />
            </div>
            <h2 className="text-xl font-bold mb-2">Connect to Xero</h2>
            <p className="text-gray-500 mb-6">
              Link your Xero account to view invoices, bills, contacts, and bank transactions directly in AccountSync.
            </p>
            <a href="/api/auth/xero" className={`${cx.btn} text-white bg-[#13B5EA] hover:bg-[#0e9fd0] px-8 py-3 text-base`}>
              Connect Xero Account
            </a>
            <p className="text-xs text-gray-400 mt-4">
              You&apos;ll be redirected to Xero to authorize access. Read-only permissions only.
            </p>
          </div>
        </div>
      </>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "invoices", label: "Invoices" },
    { key: "bills", label: "Bills" },
    { key: "contacts", label: "Contacts" },
    { key: "bank", label: "Bank" },
    { key: "accounts", label: "Accounts" },
  ];

  return (
    <>
      <TopBar
        title="Xero Accounting"
        subtitle={summary ? `${summary.organisation} — ${summary.currency}` : status.tenant?.tenantName || "Connected"}
      />
      <div className="p-6 space-y-5">

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-gray-200">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => loadTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? "border-[#13B5EA] text-[#13B5EA]"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {t.label}
            </button>
          ))}
          {/* Search - shown on data tabs */}
          {tab !== "overview" && (
            <div className="ml-auto relative">
              <IconSearch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search..."
                className={`${cx.input} pl-9 py-1.5 text-sm w-56`}
              />
            </div>
          )}
        </div>

        {/* Tab Loading */}
        {tabLoading && (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin h-8 w-8 border-4 border-[#13B5EA] border-t-transparent rounded-full" />
          </div>
        )}

        {/* ===== OVERVIEW ===== */}
        {tab === "overview" && !tabLoading && summary && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className={`${cx.card} p-5`}>
                <div className="text-sm text-gray-500 mb-1">Invoices Due</div>
                <div className="text-2xl font-bold text-blue-600">{summary.invoicesDue}</div>
                <div className="text-sm text-gray-400 mt-1">{formatCurrency(summary.totalReceivable, summary.currency)}</div>
              </div>
              <div className={`${cx.card} p-5`}>
                <div className="text-sm text-gray-500 mb-1">Bills Due</div>
                <div className="text-2xl font-bold text-red-600">{summary.billsDue}</div>
                <div className="text-sm text-gray-400 mt-1">{formatCurrency(summary.totalPayable, summary.currency)}</div>
              </div>
              <div className={`${cx.card} p-5`}>
                <div className="text-sm text-gray-500 mb-1">Receivable</div>
                <div className="text-2xl font-bold text-green-600">{formatCurrency(summary.totalReceivable, summary.currency)}</div>
              </div>
              <div className={`${cx.card} p-5`}>
                <div className="text-sm text-gray-500 mb-1">Payable</div>
                <div className="text-2xl font-bold text-orange-600">{formatCurrency(summary.totalPayable, summary.currency)}</div>
              </div>
            </div>

            {/* Recent Invoices + Bills side by side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Recent Invoices */}
              <div className={cx.card}>
                <div className="px-4 py-3 border-b bg-gray-50/50 flex items-center justify-between">
                  <h3 className="font-semibold text-sm">Outstanding Invoices</h3>
                  <button onClick={() => loadTab("invoices")} className="text-xs text-[#13B5EA] hover:underline">View all</button>
                </div>
                <div className="divide-y divide-gray-100">
                  {summary.recentInvoices.length === 0 ? (
                    <div className="p-6 text-center text-gray-400 text-sm">No outstanding invoices</div>
                  ) : summary.recentInvoices.map(inv => (
                    <div key={inv.InvoiceID} className="px-4 py-3 flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">{inv.Contact?.Name || "Unknown"}</div>
                        <div className="text-xs text-gray-400">
                          {inv.InvoiceNumber} &bull; Due {formatDate(inv.DueDateString)}
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-4">
                        <div className="font-semibold text-sm">{formatCurrency(inv.AmountDue, inv.CurrencyCode)}</div>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusColors[inv.Status] || "bg-gray-100 text-gray-600"}`}>
                          {inv.Status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Bills */}
              <div className={cx.card}>
                <div className="px-4 py-3 border-b bg-gray-50/50 flex items-center justify-between">
                  <h3 className="font-semibold text-sm">Outstanding Bills</h3>
                  <button onClick={() => loadTab("bills")} className="text-xs text-[#13B5EA] hover:underline">View all</button>
                </div>
                <div className="divide-y divide-gray-100">
                  {summary.recentBills.length === 0 ? (
                    <div className="p-6 text-center text-gray-400 text-sm">No outstanding bills</div>
                  ) : summary.recentBills.map(bill => (
                    <div key={bill.InvoiceID} className="px-4 py-3 flex items-center justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">{bill.Contact?.Name || "Unknown"}</div>
                        <div className="text-xs text-gray-400">
                          {bill.InvoiceNumber} &bull; Due {formatDate(bill.DueDateString)}
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-4">
                        <div className="font-semibold text-sm text-red-600">{formatCurrency(bill.AmountDue, bill.CurrencyCode)}</div>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusColors[bill.Status] || "bg-gray-100 text-gray-600"}`}>
                          {bill.Status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {tab === "overview" && !tabLoading && !summary && (
          <div className={`${cx.card} p-12 text-center`}>
            <p className="text-gray-400">Loading Xero data...</p>
            <button onClick={fetchSummary} className={`${cx.btnPrimary} mt-4`}>Retry</button>
          </div>
        )}

        {/* ===== INVOICES ===== */}
        {tab === "invoices" && !tabLoading && (
          <div className={`${cx.card} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50/80">
                  <tr>
                    <th className={`${cx.tableHeader} w-8`}></th>
                    <th className={cx.tableHeader}>Invoice #</th>
                    <th className={cx.tableHeader}>Contact</th>
                    <th className={cx.tableHeader}>Date</th>
                    <th className={cx.tableHeader}>Due Date</th>
                    <th className={cx.tableHeader}>Total</th>
                    <th className={cx.tableHeader}>Due</th>
                    <th className={cx.tableHeader}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredInvoices.length === 0 ? (
                    <tr><td colSpan={8} className="p-8 text-center text-gray-400">No invoices found</td></tr>
                  ) : filteredInvoices.map(inv => (
                    <>
                      <tr key={inv.InvoiceID} className="hover:bg-gray-50/50 cursor-pointer" onClick={() => toggleExpand(inv.InvoiceID)}>
                        <td className={cx.tableCell}>
                          <IconChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${expanded.has(inv.InvoiceID) ? "rotate-180" : ""}`} />
                        </td>
                        <td className={`${cx.tableCell} font-medium`}>{inv.InvoiceNumber || "-"}</td>
                        <td className={cx.tableCell}>{inv.Contact?.Name || "-"}</td>
                        <td className={`${cx.tableCell} text-gray-500`}>{formatDate(inv.DateString)}</td>
                        <td className={`${cx.tableCell} text-gray-500`}>{formatDate(inv.DueDateString)}</td>
                        <td className={`${cx.tableCell} font-medium`}>{formatCurrency(inv.Total, inv.CurrencyCode)}</td>
                        <td className={`${cx.tableCell} font-medium ${inv.AmountDue > 0 ? "text-red-600" : "text-green-600"}`}>
                          {formatCurrency(inv.AmountDue, inv.CurrencyCode)}
                        </td>
                        <td className={cx.tableCell}>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[inv.Status] || "bg-gray-100 text-gray-600"}`}>
                            {inv.Status}
                          </span>
                        </td>
                      </tr>
                      {expanded.has(inv.InvoiceID) && inv.LineItems?.length > 0 && (
                        <tr key={`${inv.InvoiceID}-detail`}>
                          <td colSpan={8} className="bg-gray-50 px-8 py-3">
                            <div className="text-xs font-medium text-gray-500 mb-2">Line Items</div>
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-xs text-gray-400">
                                  <th className="text-left pb-1">Description</th>
                                  <th className="text-right pb-1">Qty</th>
                                  <th className="text-right pb-1">Unit Price</th>
                                  <th className="text-right pb-1">Amount</th>
                                  <th className="text-right pb-1">Account</th>
                                </tr>
                              </thead>
                              <tbody>
                                {inv.LineItems.map((li, i) => (
                                  <tr key={i} className="border-t border-gray-200">
                                    <td className="py-1.5">{li.Description || "-"}</td>
                                    <td className="py-1.5 text-right text-gray-500">{li.Quantity}</td>
                                    <td className="py-1.5 text-right text-gray-500">{formatCurrency(li.UnitAmount, inv.CurrencyCode)}</td>
                                    <td className="py-1.5 text-right font-medium">{formatCurrency(li.LineAmount, inv.CurrencyCode)}</td>
                                    <td className="py-1.5 text-right text-gray-400">{li.AccountCode || "-"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {inv.Reference && <div className="mt-2 text-xs text-gray-400">Ref: {inv.Reference}</div>}
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t bg-gray-50/50 text-xs text-gray-400">
              {filteredInvoices.length} invoice{filteredInvoices.length !== 1 ? "s" : ""}
            </div>
          </div>
        )}

        {/* ===== BILLS ===== */}
        {tab === "bills" && !tabLoading && (
          <div className={`${cx.card} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50/80">
                  <tr>
                    <th className={`${cx.tableHeader} w-8`}></th>
                    <th className={cx.tableHeader}>Bill #</th>
                    <th className={cx.tableHeader}>Supplier</th>
                    <th className={cx.tableHeader}>Date</th>
                    <th className={cx.tableHeader}>Due Date</th>
                    <th className={cx.tableHeader}>Total</th>
                    <th className={cx.tableHeader}>Due</th>
                    <th className={cx.tableHeader}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredBills.length === 0 ? (
                    <tr><td colSpan={8} className="p-8 text-center text-gray-400">No bills found</td></tr>
                  ) : filteredBills.map(bill => (
                    <>
                      <tr key={bill.InvoiceID} className="hover:bg-gray-50/50 cursor-pointer" onClick={() => toggleExpand(bill.InvoiceID)}>
                        <td className={cx.tableCell}>
                          <IconChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${expanded.has(bill.InvoiceID) ? "rotate-180" : ""}`} />
                        </td>
                        <td className={`${cx.tableCell} font-medium`}>{bill.InvoiceNumber || "-"}</td>
                        <td className={cx.tableCell}>{bill.Contact?.Name || "-"}</td>
                        <td className={`${cx.tableCell} text-gray-500`}>{formatDate(bill.DateString)}</td>
                        <td className={`${cx.tableCell} text-gray-500`}>{formatDate(bill.DueDateString)}</td>
                        <td className={`${cx.tableCell} font-medium`}>{formatCurrency(bill.Total, bill.CurrencyCode)}</td>
                        <td className={`${cx.tableCell} font-medium text-red-600`}>{formatCurrency(bill.AmountDue, bill.CurrencyCode)}</td>
                        <td className={cx.tableCell}>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[bill.Status] || "bg-gray-100 text-gray-600"}`}>
                            {bill.Status}
                          </span>
                        </td>
                      </tr>
                      {expanded.has(bill.InvoiceID) && bill.LineItems?.length > 0 && (
                        <tr key={`${bill.InvoiceID}-detail`}>
                          <td colSpan={8} className="bg-gray-50 px-8 py-3">
                            <div className="text-xs font-medium text-gray-500 mb-2">Line Items</div>
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-xs text-gray-400">
                                  <th className="text-left pb-1">Description</th>
                                  <th className="text-right pb-1">Qty</th>
                                  <th className="text-right pb-1">Unit Price</th>
                                  <th className="text-right pb-1">Amount</th>
                                  <th className="text-right pb-1">Account</th>
                                </tr>
                              </thead>
                              <tbody>
                                {bill.LineItems.map((li, i) => (
                                  <tr key={i} className="border-t border-gray-200">
                                    <td className="py-1.5">{li.Description || "-"}</td>
                                    <td className="py-1.5 text-right text-gray-500">{li.Quantity}</td>
                                    <td className="py-1.5 text-right text-gray-500">{formatCurrency(li.UnitAmount, bill.CurrencyCode)}</td>
                                    <td className="py-1.5 text-right font-medium">{formatCurrency(li.LineAmount, bill.CurrencyCode)}</td>
                                    <td className="py-1.5 text-right text-gray-400">{li.AccountCode || "-"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t bg-gray-50/50 text-xs text-gray-400">
              {filteredBills.length} bill{filteredBills.length !== 1 ? "s" : ""}
            </div>
          </div>
        )}

        {/* ===== CONTACTS ===== */}
        {tab === "contacts" && !tabLoading && (
          <div className={`${cx.card} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50/80">
                  <tr>
                    <th className={cx.tableHeader}>Name</th>
                    <th className={cx.tableHeader}>Email</th>
                    <th className={cx.tableHeader}>Type</th>
                    <th className={cx.tableHeader}>Receivable</th>
                    <th className={cx.tableHeader}>Payable</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredContacts.length === 0 ? (
                    <tr><td colSpan={5} className="p-8 text-center text-gray-400">No contacts found</td></tr>
                  ) : filteredContacts.map(c => (
                    <tr key={c.ContactID} className="hover:bg-gray-50/50">
                      <td className={`${cx.tableCell} font-medium`}>{c.Name}</td>
                      <td className={`${cx.tableCell} text-gray-500`}>{c.EmailAddress || "-"}</td>
                      <td className={cx.tableCell}>
                        <div className="flex gap-1">
                          {c.IsCustomer && <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700">Customer</span>}
                          {c.IsSupplier && <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-orange-100 text-orange-700">Supplier</span>}
                        </div>
                      </td>
                      <td className={`${cx.tableCell} text-sm`}>
                        {c.Balances?.AccountsReceivable?.Outstanding
                          ? formatCurrency(c.Balances.AccountsReceivable.Outstanding)
                          : "-"}
                      </td>
                      <td className={`${cx.tableCell} text-sm`}>
                        {c.Balances?.AccountsPayable?.Outstanding
                          ? formatCurrency(c.Balances.AccountsPayable.Outstanding)
                          : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t bg-gray-50/50 text-xs text-gray-400">
              {filteredContacts.length} contact{filteredContacts.length !== 1 ? "s" : ""}
            </div>
          </div>
        )}

        {/* ===== BANK TRANSACTIONS ===== */}
        {tab === "bank" && !tabLoading && (
          <div className={`${cx.card} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50/80">
                  <tr>
                    <th className={cx.tableHeader}>Date</th>
                    <th className={cx.tableHeader}>Type</th>
                    <th className={cx.tableHeader}>Contact</th>
                    <th className={cx.tableHeader}>Bank Account</th>
                    <th className={cx.tableHeader}>Reference</th>
                    <th className={cx.tableHeader}>Amount</th>
                    <th className={cx.tableHeader}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredBankTxs.length === 0 ? (
                    <tr><td colSpan={7} className="p-8 text-center text-gray-400">No bank transactions found</td></tr>
                  ) : filteredBankTxs.map(tx => (
                    <tr key={tx.BankTransactionID} className="hover:bg-gray-50/50">
                      <td className={`${cx.tableCell} text-gray-500`}>{formatDate(tx.DateString)}</td>
                      <td className={cx.tableCell}>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          tx.Type === "RECEIVE" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                        }`}>
                          {tx.Type === "RECEIVE" ? "Receive" : "Spend"}
                        </span>
                      </td>
                      <td className={`${cx.tableCell} font-medium`}>{tx.Contact?.Name || "-"}</td>
                      <td className={`${cx.tableCell} text-gray-500`}>{tx.BankAccount?.Name || "-"}</td>
                      <td className={`${cx.tableCell} text-gray-500`}>{tx.Reference || "-"}</td>
                      <td className={`${cx.tableCell} font-medium ${tx.Type === "RECEIVE" ? "text-green-600" : "text-red-600"}`}>
                        {tx.Type === "SPEND" ? "-" : ""}{formatCurrency(tx.Total)}
                      </td>
                      <td className={cx.tableCell}>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[tx.Status] || "bg-gray-100 text-gray-600"}`}>
                          {tx.Status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t bg-gray-50/50 text-xs text-gray-400">
              {filteredBankTxs.length} transaction{filteredBankTxs.length !== 1 ? "s" : ""}
            </div>
          </div>
        )}

        {/* ===== CHART OF ACCOUNTS ===== */}
        {tab === "accounts" && !tabLoading && (
          <div className={`${cx.card} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50/80">
                  <tr>
                    <th className={cx.tableHeader}>Code</th>
                    <th className={cx.tableHeader}>Name</th>
                    <th className={cx.tableHeader}>Type</th>
                    <th className={cx.tableHeader}>Class</th>
                    <th className={cx.tableHeader}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredAccounts.length === 0 ? (
                    <tr><td colSpan={5} className="p-8 text-center text-gray-400">No accounts found</td></tr>
                  ) : filteredAccounts.map(a => (
                    <tr key={a.AccountID} className="hover:bg-gray-50/50">
                      <td className={`${cx.tableCell} font-mono text-sm font-medium`}>{a.Code || "-"}</td>
                      <td className={`${cx.tableCell} font-medium`}>{a.Name}</td>
                      <td className={`${cx.tableCell} text-gray-500 text-sm`}>{a.Type}</td>
                      <td className={cx.tableCell}>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          a.Class === "REVENUE" ? "bg-green-100 text-green-700" :
                          a.Class === "EXPENSE" ? "bg-red-100 text-red-700" :
                          a.Class === "ASSET" ? "bg-blue-100 text-blue-700" :
                          a.Class === "LIABILITY" ? "bg-orange-100 text-orange-700" :
                          a.Class === "EQUITY" ? "bg-purple-100 text-purple-700" :
                          "bg-gray-100 text-gray-600"
                        }`}>
                          {a.Class}
                        </span>
                      </td>
                      <td className={cx.tableCell}>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[a.Status] || "bg-gray-100 text-gray-600"}`}>
                          {a.Status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t bg-gray-50/50 text-xs text-gray-400">
              {filteredAccounts.length} account{filteredAccounts.length !== 1 ? "s" : ""}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
