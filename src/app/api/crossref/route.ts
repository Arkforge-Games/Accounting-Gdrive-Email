import { NextResponse } from "next/server";
import * as db from "@/lib/db";

interface Match {
  fileId: string;
  fileName: string;
  fileCategory: string;
  fileVendor: string | null;
  fileAmount: string | null;
  fileCurrency: string;
  fileDate: string;
  xeroInvoiceId: string;
  xeroInvoiceNumber: string;
  xeroContact: string;
  xeroTotal: number;
  xeroCurrency: string;
  xeroStatus: string;
  xeroDate: string;
  matchType: "invoice_number" | "amount_vendor" | "amount_date";
  confidence: "high" | "medium" | "low";
}

export async function GET() {
  const matches: Match[] = [];

  // Get all indexed files
  const files = db.getIndexedFiles({});
  const xeroInvoicesCache = db.getDataCache("xero", "invoices");
  const xeroBillsCache = db.getDataCache("xero", "bills");

  if (!xeroInvoicesCache?.data && !xeroBillsCache?.data) {
    return NextResponse.json({ matches: [], count: 0, message: "No Xero data cached. Run a Xero sync first." });
  }

  const xeroInvoices = (xeroInvoicesCache?.data || []) as {
    InvoiceID: string; InvoiceNumber: string; Contact: { Name: string }; Total: number;
    AmountDue: number; Status: string; DateString: string; CurrencyCode: string; Type: string;
  }[];
  const xeroBills = (xeroBillsCache?.data || []) as typeof xeroInvoices;
  const allXero = [...xeroInvoices, ...xeroBills];

  for (const file of files) {
    if (file.category === "junk" || file.category === "uncategorized") continue;

    for (const inv of allXero) {
      // Match 1: Invoice number in filename
      if (inv.InvoiceNumber && file.name.includes(inv.InvoiceNumber)) {
        matches.push(buildMatch(file, inv, "invoice_number", "high"));
        continue;
      }

      // Match 2: Same vendor/contact + similar amount (within 5%)
      if (file.amount && file.vendor && inv.Contact?.Name) {
        const fileAmt = parseFloat(file.amount);
        const xeroAmt = inv.Total;
        const vendorMatch = fuzzyVendorMatch(file.vendor, inv.Contact.Name);
        if (vendorMatch && fileAmt > 0 && xeroAmt > 0) {
          const diff = Math.abs(fileAmt - xeroAmt) / xeroAmt;
          if (diff < 0.05) {
            matches.push(buildMatch(file, inv, "amount_vendor", diff < 0.01 ? "high" : "medium"));
            continue;
          }
        }
      }

      // Match 3: Same amount + close dates (within 7 days)
      if (file.amount) {
        const fileAmt = parseFloat(file.amount);
        const xeroAmt = inv.Total;
        if (fileAmt > 0 && Math.abs(fileAmt - xeroAmt) < 0.01) {
          const fileDate = new Date(file.date).getTime();
          const xeroDate = new Date(inv.DateString).getTime();
          const daysDiff = Math.abs(fileDate - xeroDate) / 86400000;
          if (daysDiff <= 7) {
            matches.push(buildMatch(file, inv, "amount_date", daysDiff <= 1 ? "high" : "medium"));
          }
        }
      }
    }
  }

  // Deduplicate (keep highest confidence per file-invoice pair)
  const seen = new Map<string, Match>();
  for (const m of matches) {
    const key = `${m.fileId}:${m.xeroInvoiceId}`;
    const existing = seen.get(key);
    if (!existing || confidenceRank(m.confidence) > confidenceRank(existing.confidence)) {
      seen.set(key, m);
    }
  }

  const unique = Array.from(seen.values()).sort((a, b) =>
    confidenceRank(b.confidence) - confidenceRank(a.confidence)
  );

  return NextResponse.json({ matches: unique, count: unique.length });
}

function buildMatch(
  file: ReturnType<typeof db.getIndexedFiles>[0],
  inv: { InvoiceID: string; InvoiceNumber: string; Contact: { Name: string }; Total: number; Status: string; DateString: string; CurrencyCode: string },
  matchType: Match["matchType"],
  confidence: Match["confidence"],
): Match {
  return {
    fileId: file.id,
    fileName: file.name,
    fileCategory: file.category,
    fileVendor: file.vendor,
    fileAmount: file.amount,
    fileCurrency: file.currency,
    fileDate: file.date,
    xeroInvoiceId: inv.InvoiceID,
    xeroInvoiceNumber: inv.InvoiceNumber,
    xeroContact: inv.Contact?.Name || "Unknown",
    xeroTotal: inv.Total,
    xeroCurrency: inv.CurrencyCode,
    xeroStatus: inv.Status,
    xeroDate: inv.DateString,
    matchType,
    confidence,
  };
}

function fuzzyVendorMatch(fileVendor: string, xeroContact: string): boolean {
  const a = fileVendor.toLowerCase().replace(/[^a-z0-9]/g, "");
  const b = xeroContact.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  // Check if first significant word matches
  const aWords = fileVendor.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const bWords = xeroContact.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  return aWords.some(w => bWords.includes(w));
}

function confidenceRank(c: string): number {
  return c === "high" ? 3 : c === "medium" ? 2 : 1;
}
