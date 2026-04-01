import { NextRequest, NextResponse } from "next/server";
import * as db from "@/lib/db";

// GET /api/reports/monthly?month=2026-03
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;

  // Default to last month
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const defaultPeriod = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, "0")}`;
  const month = p.get("month") || defaultPeriod;

  // Parse month bounds
  const [year, mon] = month.split("-").map(Number);
  const periodStart = `${month}-01`;
  const periodEndDate = new Date(year, mon, 0); // last day of month
  const periodEnd = `${month}-${String(periodEndDate.getDate()).padStart(2, "0")}`;

  // 1. Indexed files for this period
  const allIndexed = db.getIndexedFiles({ period: month });
  // Also get files by date if they lack a period tag
  const allByDate = db.getIndexedFiles({}).filter(
    (f) => f.date >= periodStart && f.date <= `${periodEnd}T23:59:59` && !allIndexed.some((idx) => idx.id === f.id)
  );
  const periodFiles = [...allIndexed, ...allByDate];

  const filesWithAmounts = periodFiles.filter((f) => f.amount && parseFloat(f.amount) > 0);
  const totalAmount = filesWithAmounts.reduce((sum, f) => sum + parseFloat(f.amount || "0"), 0);

  // 2. Category breakdown
  const categoryMap: Record<string, { count: number; total: number; files: { id: string; name: string; amount: string | null; vendor: string | null }[] }> = {};
  for (const f of periodFiles) {
    const cat = f.category || "uncategorized";
    if (!categoryMap[cat]) categoryMap[cat] = { count: 0, total: 0, files: [] };
    categoryMap[cat].count++;
    categoryMap[cat].total += parseFloat(f.amount || "0");
    categoryMap[cat].files.push({ id: f.id, name: f.name, amount: f.amount, vendor: f.vendor });
  }
  const categories = Object.entries(categoryMap)
    .map(([category, data]) => ({ category, ...data }))
    .sort((a, b) => b.total - a.total);

  // 3. Top vendors by spend
  const vendorMap: Record<string, { count: number; total: number }> = {};
  for (const f of periodFiles) {
    const vendor = f.vendor || "Unknown";
    if (!vendorMap[vendor]) vendorMap[vendor] = { count: 0, total: 0 };
    vendorMap[vendor].count++;
    vendorMap[vendor].total += parseFloat(f.amount || "0");
  }
  const topVendors = Object.entries(vendorMap)
    .map(([vendor, data]) => ({ vendor, ...data }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);

  // 4. Xero invoices/bills for the period
  let xeroInvoices: Record<string, unknown>[] = [];
  let xeroBills: Record<string, unknown>[] = [];
  let xeroTotals = { invoicesTotal: 0, billsTotal: 0, invoicesCount: 0, billsCount: 0 };

  try {
    const invoiceCache = db.getDataCache("xero", "invoices");
    if (invoiceCache?.data && Array.isArray(invoiceCache.data)) {
      const allInvoices = invoiceCache.data as Record<string, unknown>[];
      for (const inv of allInvoices) {
        const dateStr = (inv.DateString as string) || "";
        if (dateStr >= periodStart && dateStr <= periodEnd) {
          const type = inv.Type as string;
          const total = (inv.Total as number) || 0;
          if (type === "ACCREC") {
            xeroInvoices.push(inv);
            xeroTotals.invoicesTotal += total;
            xeroTotals.invoicesCount++;
          } else if (type === "ACCPAY") {
            xeroBills.push(inv);
            xeroTotals.billsTotal += total;
            xeroTotals.billsCount++;
          }
        }
      }
    }
  } catch (err) {
    console.error("[Report] Xero data error:", err);
  }

  // 5. Wise transfers for the period
  let wiseTransfers: Record<string, unknown>[] = [];
  const wiseCurrencies: Record<string, number> = {};
  let wiseTotals: { count: number; totalSent: number; currencies: Record<string, number> } = { count: 0, totalSent: 0, currencies: wiseCurrencies };

  try {
    const wiseCache = db.getWiseCache("transfers");
    if (wiseCache?.data && Array.isArray(wiseCache.data)) {
      const allTransfers = wiseCache.data as Record<string, unknown>[];
      for (const t of allTransfers) {
        const created = (t.created as string) || (t.createdAt as string) || "";
        if (created >= periodStart && created <= `${periodEnd}T23:59:59`) {
          wiseTransfers.push(t);
          wiseTotals.count++;
          const sourceAmount = Number(t.sourceValue) || 0;
          const sourceCurrency = (t.sourceCurrency as string) || "USD";
          wiseTotals.totalSent += sourceAmount;
          wiseTotals.currencies[sourceCurrency] = (wiseTotals.currencies[sourceCurrency] || 0) + sourceAmount;
        }
      }
    }
  } catch (err) {
    console.error("[Report] Wise data error:", err);
  }

  // Format month label
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const monthLabel = `${months[mon - 1]} ${year}`;

  return NextResponse.json({
    month,
    monthLabel,
    periodStart,
    periodEnd,
    summary: {
      totalFiles: periodFiles.length,
      filesWithAmounts: filesWithAmounts.length,
      totalAmount: Math.round(totalAmount * 100) / 100,
      uniqueVendors: Object.keys(vendorMap).length,
      categoryCount: Object.keys(categoryMap).length,
    },
    categories,
    topVendors,
    xero: {
      invoices: xeroInvoices.map((inv) => ({
        invoiceNumber: inv.InvoiceNumber,
        contact: (inv.Contact as Record<string, unknown>)?.Name || "Unknown",
        date: inv.DateString,
        dueDate: inv.DueDateString,
        total: inv.Total,
        status: inv.Status,
        currency: inv.CurrencyCode,
        type: inv.Type,
      })),
      bills: xeroBills.map((inv) => ({
        invoiceNumber: inv.InvoiceNumber,
        contact: (inv.Contact as Record<string, unknown>)?.Name || "Unknown",
        date: inv.DateString,
        dueDate: inv.DueDateString,
        total: inv.Total,
        status: inv.Status,
        currency: inv.CurrencyCode,
        type: inv.Type,
      })),
      totals: xeroTotals,
    },
    wise: {
      transfers: wiseTransfers.slice(0, 50).map((t) => ({
        id: t.id,
        created: t.created || t.createdAt,
        sourceAmount: t.sourceValue || t.sourceAmount,
        sourceCurrency: t.sourceCurrency,
        targetAmount: t.targetValue || t.targetAmount,
        targetCurrency: t.targetCurrency,
        status: t.status,
        reference: t.reference,
      })),
      totals: wiseTotals,
    },
    files: periodFiles.map((f) => ({
      id: f.id,
      name: f.name,
      date: f.date,
      category: f.category,
      status: f.accountingStatus,
      vendor: f.vendor,
      amount: f.amount,
      currency: f.currency,
    })),
  });
}
