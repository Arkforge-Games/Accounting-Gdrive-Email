import { NextRequest, NextResponse } from "next/server";
import * as db from "@/lib/db";

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") || "overview";

  try {
    switch (action) {
      case "overview":
        return NextResponse.json(getMultiCurrencyOverview());

      case "spending-trends":
        return NextResponse.json(getSpendingTrends());

      case "cash-flow":
        return NextResponse.json(getCashFlowForecast());

      case "vendor-scorecard":
        return NextResponse.json(getVendorScorecard());

      case "budget":
        return NextResponse.json(getBudgetTracking());

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Unknown error" }, { status: 500 });
  }
}

function getMultiCurrencyOverview() {
  // Xero data
  const xeroStats = db.getDataCache("xero", "stats")?.data as Record<string, unknown> | null;
  const wiseBalances = db.getWiseCache("business_balances")?.data as { amount: { value: number; currency: string } }[] | null;
  const wiseRates = db.getWiseCache("exchange_rates")?.data as Record<string, number> | null;
  const rates = wiseRates || {};

  // Build currency positions
  const positions: { currency: string; source: string; amount: number; hkdEquivalent: number }[] = [];

  // Xero
  if (xeroStats) {
    positions.push({ currency: "HKD", source: "Xero Receivable", amount: Number(xeroStats.totalReceivable) || 0, hkdEquivalent: Number(xeroStats.totalReceivable) || 0 });
    positions.push({ currency: "HKD", source: "Xero Payable", amount: -(Number(xeroStats.totalPayable) || 0), hkdEquivalent: -(Number(xeroStats.totalPayable) || 0) });
  }

  // Wise
  if (wiseBalances) {
    for (const b of wiseBalances) {
      const cur = b.amount.currency;
      const val = b.amount.value;
      let hkd = val;
      if (cur !== "HKD") {
        const rateKey = `${cur}_HKD`;
        const reverseKey = `HKD_${cur}`;
        if (rates[rateKey]) hkd = val * rates[rateKey];
        else if (rates[reverseKey]) hkd = val / rates[reverseKey];
        else if (cur === "USD") hkd = val * 7.8;
      }
      positions.push({ currency: cur, source: "Wise", amount: val, hkdEquivalent: hkd });
    }
  }

  // Indexed files by currency
  const files = db.getIndexedFiles({});
  const fileByCurrency: Record<string, { count: number; total: number }> = {};
  for (const f of files) {
    if (!f.amount || f.category === "junk") continue;
    const cur = f.currency || "HKD";
    if (!fileByCurrency[cur]) fileByCurrency[cur] = { count: 0, total: 0 };
    fileByCurrency[cur].count++;
    fileByCurrency[cur].total += parseFloat(f.amount);
  }

  const totalHKD = positions.reduce((s, p) => s + p.hkdEquivalent, 0);

  return {
    positions,
    totalHKDEquivalent: totalHKD,
    fileByCurrency,
    rates,
    xeroReceivable: Number(xeroStats?.totalReceivable) || 0,
    xeroPayable: Number(xeroStats?.totalPayable) || 0,
    xeroNet: (Number(xeroStats?.totalReceivable) || 0) - (Number(xeroStats?.totalPayable) || 0),
  };
}

function getSpendingTrends() {
  const files = db.getIndexedFiles({});
  const months: Record<string, Record<string, { count: number; total: number }>> = {};

  for (const f of files) {
    if (f.category === "junk" || f.category === "uncategorized") continue;
    const period = f.period || f.date?.substring(0, 7) || "unknown";
    if (!months[period]) months[period] = {};
    if (!months[period][f.category]) months[period][f.category] = { count: 0, total: 0 };
    months[period][f.category].count++;
    if (f.amount) months[period][f.category].total += parseFloat(f.amount);
  }

  // Sort by period
  const sorted = Object.entries(months)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, categories]) => ({
      period,
      label: formatPeriod(period),
      categories,
      total: Object.values(categories).reduce((s, c) => s + c.total, 0),
      fileCount: Object.values(categories).reduce((s, c) => s + c.count, 0),
    }));

  // Category totals across all time
  const categoryTotals: Record<string, { count: number; total: number }> = {};
  for (const m of sorted) {
    for (const [cat, data] of Object.entries(m.categories)) {
      if (!categoryTotals[cat]) categoryTotals[cat] = { count: 0, total: 0 };
      categoryTotals[cat].count += data.count;
      categoryTotals[cat].total += data.total;
    }
  }

  return { months: sorted, categoryTotals };
}

function getCashFlowForecast() {
  const xeroInvoices = db.getDataCache("xero", "invoices")?.data as {
    InvoiceNumber: string; Contact: { Name: string }; Total: number; AmountDue: number;
    Status: string; DueDateString: string; CurrencyCode: string;
  }[] | null;

  const xeroBills = db.getDataCache("xero", "bills")?.data as typeof xeroInvoices | null;

  const today = new Date();
  const forecast: { period: string; label: string; inflow: number; outflow: number; net: number; items: { type: string; contact: string; amount: number; dueDate: string; invoiceNumber: string }[] }[] = [];

  // Build 4 periods: overdue, this week, next 2 weeks, next month
  const periods = [
    { key: "overdue", label: "Overdue", start: new Date(0), end: today },
    { key: "this_week", label: "This Week", start: today, end: new Date(today.getTime() + 7 * 86400000) },
    { key: "next_2_weeks", label: "Next 2 Weeks", start: new Date(today.getTime() + 7 * 86400000), end: new Date(today.getTime() + 21 * 86400000) },
    { key: "next_month", label: "Next Month", start: new Date(today.getTime() + 21 * 86400000), end: new Date(today.getTime() + 60 * 86400000) },
  ];

  for (const p of periods) {
    let inflow = 0;
    let outflow = 0;
    const items: typeof forecast[0]["items"] = [];

    // Invoices (inflow)
    if (xeroInvoices) {
      for (const inv of xeroInvoices) {
        if (inv.AmountDue <= 0 || inv.Status === "PAID" || inv.Status === "VOIDED") continue;
        const due = new Date(inv.DueDateString);
        if (due >= p.start && due < p.end) {
          inflow += inv.AmountDue;
          items.push({ type: "invoice", contact: inv.Contact?.Name || "?", amount: inv.AmountDue, dueDate: inv.DueDateString, invoiceNumber: inv.InvoiceNumber });
        }
      }
    }

    // Bills (outflow)
    if (xeroBills) {
      for (const bill of xeroBills) {
        if (bill.AmountDue <= 0 || bill.Status === "PAID" || bill.Status === "VOIDED") continue;
        const due = new Date(bill.DueDateString);
        if (due >= p.start && due < p.end) {
          outflow += bill.AmountDue;
          items.push({ type: "bill", contact: bill.Contact?.Name || "?", amount: -bill.AmountDue, dueDate: bill.DueDateString, invoiceNumber: bill.InvoiceNumber });
        }
      }
    }

    forecast.push({ period: p.key, label: p.label, inflow, outflow, net: inflow - outflow, items });
  }

  const totalInflow = forecast.reduce((s, f) => s + f.inflow, 0);
  const totalOutflow = forecast.reduce((s, f) => s + f.outflow, 0);

  return { forecast, totalInflow, totalOutflow, totalNet: totalInflow - totalOutflow };
}

function getVendorScorecard() {
  const files = db.getIndexedFiles({});
  const vendors: Record<string, {
    name: string; count: number; totalAmount: number; categories: Record<string, number>;
    firstSeen: string; lastSeen: string; avgAmount: number;
  }> = {};

  for (const f of files) {
    if (!f.vendor || f.category === "junk") continue;
    const key = f.vendor.toLowerCase();
    if (!vendors[key]) {
      vendors[key] = { name: f.vendor, count: 0, totalAmount: 0, categories: {}, firstSeen: f.date, lastSeen: f.date, avgAmount: 0 };
    }
    vendors[key].count++;
    if (f.amount) vendors[key].totalAmount += parseFloat(f.amount);
    vendors[key].categories[f.category] = (vendors[key].categories[f.category] || 0) + 1;
    if (f.date < vendors[key].firstSeen) vendors[key].firstSeen = f.date;
    if (f.date > vendors[key].lastSeen) vendors[key].lastSeen = f.date;
  }

  // Calculate averages and sort
  const sorted = Object.values(vendors)
    .map(v => ({ ...v, avgAmount: v.count > 0 ? v.totalAmount / v.count : 0 }))
    .sort((a, b) => b.totalAmount - a.totalAmount);

  return { vendors: sorted, totalVendors: sorted.length };
}

function getBudgetTracking() {
  // Default budgets (can be made configurable later)
  const budgets: Record<string, number> = {
    invoice: 50000,
    receipt: 5000,
    reimbursement: 10000,
    payroll: 30000,
    bill: 20000,
    bank_statement: 0,
    contract: 0,
    tax: 0,
  };

  const files = db.getIndexedFiles({});
  const currentMonth = new Date().toISOString().substring(0, 7);

  const tracking: { category: string; budget: number; actual: number; percentage: number; remaining: number; count: number }[] = [];

  for (const [category, budget] of Object.entries(budgets)) {
    const monthFiles = files.filter(f => f.category === category && (f.period === currentMonth || f.date?.startsWith(currentMonth)));
    const actual = monthFiles.reduce((s, f) => s + (f.amount ? parseFloat(f.amount) : 0), 0);

    tracking.push({
      category,
      budget,
      actual,
      percentage: budget > 0 ? Math.round((actual / budget) * 100) : 0,
      remaining: budget - actual,
      count: monthFiles.length,
    });
  }

  return { month: currentMonth, tracking: tracking.filter(t => t.budget > 0 || t.actual > 0) };
}

function formatPeriod(period: string) {
  const [year, month] = period.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(month) - 1]} ${year}`;
}
