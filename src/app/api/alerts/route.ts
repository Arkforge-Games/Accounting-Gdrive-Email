import { NextResponse } from "next/server";
import * as db from "@/lib/db";

interface Alert {
  type: "overdue" | "duplicate" | "missing" | "uncategorized" | "reimbursement";
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  items: unknown[];
}

// GET /api/alerts — scan all data and return smart alerts
export async function GET() {
  const alerts: Alert[] = [];

  // 1. Overdue invoices (Xero cached invoices: AUTHORISED + past due)
  try {
    const invoiceCache = db.getDataCache("xero", "invoices");
    if (invoiceCache?.data) {
      const invoices = Array.isArray(invoiceCache.data) ? invoiceCache.data : [];
      const today = new Date().toISOString().split("T")[0];
      const overdue = invoices.filter(
        (inv: Record<string, unknown>) =>
          inv.Status === "AUTHORISED" &&
          typeof inv.DueDateString === "string" &&
          inv.DueDateString < today
      );
      if (overdue.length > 0) {
        alerts.push({
          type: "overdue",
          severity: "high",
          title: `${overdue.length} Overdue Invoice${overdue.length > 1 ? "s" : ""}`,
          description: `Invoices past their due date that are still authorised and unpaid.`,
          items: overdue.map((inv: Record<string, unknown>) => ({
            invoiceNumber: inv.InvoiceNumber,
            contact: (inv.Contact as Record<string, unknown>)?.Name || "Unknown",
            dueDate: inv.DueDateString,
            total: inv.Total,
            currency: inv.CurrencyCode,
          })),
        });
      }
    }
  } catch (err) {
    console.error("[Alerts] Overdue check failed:", err);
  }

  // 2. Large uncategorized files (amount > 1000)
  try {
    const uncategorized = db.getIndexedFiles({ category: "uncategorized" });
    const largeUncategorized = uncategorized.filter((f) => {
      const amt = parseFloat(f.amount || "0");
      return amt > 1000;
    });
    if (largeUncategorized.length > 0) {
      alerts.push({
        type: "uncategorized",
        severity: "high",
        title: `${largeUncategorized.length} Large Uncategorized File${largeUncategorized.length > 1 ? "s" : ""}`,
        description: `Files with amounts over 1,000 that haven't been categorized yet.`,
        items: largeUncategorized.map((f) => ({
          fileId: f.id,
          name: f.name,
          amount: f.amount,
          currency: f.currency,
          date: f.date,
          vendor: f.vendor,
        })),
      });
    }
  } catch (err) {
    console.error("[Alerts] Uncategorized check failed:", err);
  }

  // 3. Duplicate detection (same vendor + similar amount within 7 days)
  try {
    const allFiles = db.getIndexedFiles({});
    const filesWithVendor = allFiles.filter((f) => f.vendor && f.amount);
    const duplicates: { file1: typeof filesWithVendor[0]; file2: typeof filesWithVendor[0] }[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < filesWithVendor.length; i++) {
      for (let j = i + 1; j < filesWithVendor.length; j++) {
        const a = filesWithVendor[i];
        const b = filesWithVendor[j];

        if (
          a.vendor?.toLowerCase() === b.vendor?.toLowerCase() &&
          a.amount && b.amount
        ) {
          const amtA = parseFloat(a.amount);
          const amtB = parseFloat(b.amount);
          // Similar amount: within 5% or exact match
          const diff = Math.abs(amtA - amtB);
          const maxAmt = Math.max(amtA, amtB);
          if (maxAmt > 0 && diff / maxAmt > 0.05) continue;

          // Within 7 days
          const dateA = new Date(a.date).getTime();
          const dateB = new Date(b.date).getTime();
          const daysDiff = Math.abs(dateA - dateB) / (1000 * 60 * 60 * 24);
          if (daysDiff > 7) continue;

          const pairKey = [a.id, b.id].sort().join(":");
          if (seen.has(pairKey)) continue;
          seen.add(pairKey);

          duplicates.push({ file1: a, file2: b });
        }
      }
    }

    if (duplicates.length > 0) {
      alerts.push({
        type: "duplicate",
        severity: "medium",
        title: `${duplicates.length} Potential Duplicate${duplicates.length > 1 ? "s" : ""} Detected`,
        description: `Files from the same vendor with similar amounts within a 7-day window.`,
        items: duplicates.map((d) => ({
          file1: { id: d.file1.id, name: d.file1.name, vendor: d.file1.vendor, amount: d.file1.amount, date: d.file1.date },
          file2: { id: d.file2.id, name: d.file2.name, vendor: d.file2.vendor, amount: d.file2.amount, date: d.file2.date },
        })),
      });
    }
  } catch (err) {
    console.error("[Alerts] Duplicate check failed:", err);
  }

  // 4. Missing periods (months with no files in last 6 months)
  try {
    const allFiles = db.getIndexedFiles({});
    const now = new Date();
    const missingMonths: string[] = [];

    for (let i = 1; i <= 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const hasFiles = allFiles.some(
        (f) => f.period === period || f.date.startsWith(period)
      );
      if (!hasFiles) {
        missingMonths.push(period);
      }
    }

    if (missingMonths.length > 0) {
      alerts.push({
        type: "missing",
        severity: "medium",
        title: `${missingMonths.length} Month${missingMonths.length > 1 ? "s" : ""} With No Files`,
        description: `No accounting files found for these months in the last 6 months.`,
        items: missingMonths.map((m) => {
          const [year, month] = m.split("-");
          const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          return { period: m, label: `${months[parseInt(month) - 1]} ${year}` };
        }),
      });
    }
  } catch (err) {
    console.error("[Alerts] Missing periods check failed:", err);
  }

  // 5. Reimbursements without amounts
  try {
    const reimbursements = db.getIndexedFiles({ category: "reimbursement" });
    const noAmount = reimbursements.filter((f) => !f.amount || f.amount === "0");
    if (noAmount.length > 0) {
      alerts.push({
        type: "reimbursement",
        severity: "low",
        title: `${noAmount.length} Reimbursement${noAmount.length > 1 ? "s" : ""} Missing Amounts`,
        description: `Reimbursement files that don't have an amount recorded yet.`,
        items: noAmount.map((f) => ({
          fileId: f.id,
          name: f.name,
          vendor: f.vendor,
          date: f.date,
          period: f.period,
        })),
      });
    }
  } catch (err) {
    console.error("[Alerts] Reimbursement check failed:", err);
  }

  // Sort alerts by severity: high > medium > low
  const severityOrder = { high: 0, medium: 1, low: 2 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return NextResponse.json({ alerts });
}
