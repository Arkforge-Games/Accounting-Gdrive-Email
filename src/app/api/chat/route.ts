import { NextRequest, NextResponse } from "next/server";
import * as db from "@/lib/db";

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || "";
const MODEL = process.env.AI_MODEL || "qwen/qwen3.6-plus-preview:free";

function buildSystemContext(): string {
  // Gather all available data for the AI
  const stats = db.getStats();
  const emailCount = db.getEmailCount();
  const accountingSummary = db.getAccountingSummary();

  // Get indexed files summary
  const indexedFiles = db.getIndexedFiles({});
  const filesByCategory: Record<string, { count: number; totalAmount: number; currency: string; files: { name: string; vendor: string | null; amount: string | null; currency: string; date: string; notes: string | null }[] }> = {};
  for (const f of indexedFiles) {
    if (!filesByCategory[f.category]) filesByCategory[f.category] = { count: 0, totalAmount: 0, currency: "HKD", files: [] };
    filesByCategory[f.category].count++;
    if (f.amount) filesByCategory[f.category].totalAmount += parseFloat(f.amount);
    filesByCategory[f.category].files.push({
      name: f.name,
      vendor: f.vendor,
      amount: f.amount,
      currency: f.currency,
      date: f.date,
      notes: f.notes,
    });
  }

  // Get Xero cached data
  const xeroStats = db.getDataCache("xero", "stats");
  const xeroInvoices = db.getDataCache("xero", "invoices");
  const xeroBills = db.getDataCache("xero", "bills");
  const xeroContacts = db.getDataCache("xero", "contacts");

  // Get Wise cached data
  const wiseTransferStats = db.getWiseCache("business_transfer_stats");
  const wiseRecipients = db.getWiseCache("business_recipients");
  const wiseBalances = db.getWiseCache("business_balances");
  const wiseRates = db.getWiseCache("exchange_rates");

  let context = `You are an accounting assistant for HobbyLand Technology Limited (DeFiner Tech Ltd on Xero), a Hong Kong company. You have access to all their financial data. Answer questions accurately based on the data provided. Use HKD as default currency. Be concise but thorough.

Today's date: ${new Date().toISOString().split("T")[0]}

=== FILE STORAGE (AccountSync) ===
Total files: ${stats.totalFiles} (${stats.totalSize})
- Gmail attachments: ${stats.gmailFiles}
- Google Drive: ${stats.gdriveFiles}
- Emails synced: ${emailCount}

Accounting Index Summary:
`;

  for (const { category, count } of accountingSummary.byCategory) {
    const cat = filesByCategory[category];
    context += `- ${category}: ${count} files`;
    if (cat && cat.totalAmount > 0) context += ` (total: ${cat.totalAmount.toFixed(2)})`;
    context += "\n";
  }

  // Add detailed file list (limit to keep context manageable)
  context += "\nDetailed Files by Category:\n";
  for (const [category, data] of Object.entries(filesByCategory)) {
    if (category === "junk") continue;
    context += `\n[${category.toUpperCase()}] (${data.count} files)\n`;
    for (const f of data.files.slice(0, 30)) {
      context += `  - ${f.name} | ${f.vendor || "?"} | ${f.amount ? `${f.currency} ${f.amount}` : "no amount"} | ${f.date?.substring(0, 10)} | ${f.notes || ""}\n`;
    }
    if (data.files.length > 30) context += `  ... and ${data.files.length - 30} more\n`;
  }

  // Xero data
  if (xeroStats?.data) {
    const xs = xeroStats.data as Record<string, unknown>;
    context += `\n=== XERO ACCOUNTING (${xs.organisation}) ===
Currency: ${xs.currency}
Total Invoices: ${xs.totalInvoices} | Outstanding: ${xs.outstandingInvoices} | Receivable: HK$${Number(xs.totalReceivable).toLocaleString()}
Total Bills: ${xs.totalBills} | Outstanding: ${xs.outstandingBills} | Payable: HK$${Number(xs.totalPayable).toLocaleString()}
Contacts: ${xs.totalContacts} (${xs.customers} customers, ${xs.suppliers} suppliers)
Bank Transactions: ${xs.totalBankTransactions}
Accounts: ${xs.totalAccounts}
Invoices by status: ${JSON.stringify(xs.invoicesByStatus)}
Bills by status: ${JSON.stringify(xs.billsByStatus)}
`;
  }

  // Xero invoices detail
  if (xeroInvoices?.data) {
    const invs = xeroInvoices.data as { InvoiceNumber: string; Contact: { Name: string }; Total: number; AmountDue: number; Status: string; DateString: string; DueDateString: string; CurrencyCode: string }[];
    context += `\nXero Invoices (${invs.length}):\n`;
    for (const inv of invs.slice(0, 50)) {
      context += `  ${inv.InvoiceNumber} | ${inv.Contact?.Name} | ${inv.CurrencyCode} ${inv.Total} | Due: ${inv.AmountDue} | ${inv.Status} | ${inv.DateString?.substring(0, 10)} | Due: ${inv.DueDateString?.substring(0, 10)}\n`;
    }
    if (invs.length > 50) context += `  ... and ${invs.length - 50} more\n`;
  }

  // Xero bills detail
  if (xeroBills?.data) {
    const bills = xeroBills.data as { InvoiceNumber: string; Contact: { Name: string }; Total: number; AmountDue: number; Status: string; DateString: string; CurrencyCode: string }[];
    context += `\nXero Bills (${bills.length}):\n`;
    for (const b of bills) {
      context += `  ${b.InvoiceNumber || "-"} | ${b.Contact?.Name} | ${b.CurrencyCode} ${b.Total} | Due: ${b.AmountDue} | ${b.Status} | ${b.DateString?.substring(0, 10)}\n`;
    }
  }

  // Wise data
  if (wiseTransferStats?.data) {
    const ws = wiseTransferStats.data as Record<string, unknown>;
    context += `\n=== WISE TRANSFERS ===
Total transfers: ${ws.total} (${ws.sent} sent, ${ws.cancelled} cancelled, ${ws.refunded} refunded)
By target currency: ${JSON.stringify(ws.byTargetCurrency)}
`;
  }

  if (wiseBalances?.data) {
    const bals = wiseBalances.data as { amount: { value: number; currency: string } }[];
    context += `Wise Balances: ${bals.map(b => `${b.amount.currency} ${b.amount.value}`).join(", ")}\n`;
  }

  if (wiseRates?.data) {
    context += `Exchange rates: ${JSON.stringify(wiseRates.data)}\n`;
  }

  return context;
}

export async function POST(req: NextRequest) {
  if (!OPENROUTER_KEY) {
    return NextResponse.json({ error: "AI not configured" }, { status: 500 });
  }

  const { messages } = await req.json();
  if (!messages || !Array.isArray(messages)) {
    return NextResponse.json({ error: "Missing messages array" }, { status: 400 });
  }

  const systemContext = buildSystemContext();

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemContext },
        ...messages,
      ],
      temperature: 0.3,
      max_tokens: 1500,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return NextResponse.json({ error: `AI error: ${res.status} ${err}` }, { status: 500 });
  }

  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content || "Sorry, I couldn't generate a response.";

  return NextResponse.json({ reply, model: data.model });
}
