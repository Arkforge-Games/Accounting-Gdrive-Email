import { NextRequest, NextResponse } from "next/server";
import * as db from "@/lib/db";

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || "";
const MODEL = process.env.AI_MODEL || "qwen/qwen3.6-plus-preview:free";

function buildSystemContext(): string {
  const stats = db.getStats();
  const emailCount = db.getEmailCount();
  const accountingSummary = db.getAccountingSummary();

  const indexedFiles = db.getIndexedFiles({});
  const filesByCategory: Record<string, { count: number; totalAmount: number; files: { name: string; vendor: string | null; amount: string | null; currency: string; date: string; notes: string | null }[] }> = {};
  for (const f of indexedFiles) {
    if (!filesByCategory[f.category]) filesByCategory[f.category] = { count: 0, totalAmount: 0, files: [] };
    filesByCategory[f.category].count++;
    if (f.amount) filesByCategory[f.category].totalAmount += parseFloat(f.amount);
    filesByCategory[f.category].files.push({ name: f.name, vendor: f.vendor, amount: f.amount, currency: f.currency, date: f.date, notes: f.notes });
  }

  const xeroStats = db.getDataCache("xero", "stats");
  const xeroInvoices = db.getDataCache("xero", "invoices");
  const xeroBills = db.getDataCache("xero", "bills");
  const wiseTransferStats = db.getWiseCache("business_transfer_stats");
  const wiseBalances = db.getWiseCache("business_balances");
  const wiseRates = db.getWiseCache("exchange_rates");

  let ctx = `You are an accounting assistant for HobbyLand Technology Limited (DeFiner Tech Ltd on Xero), a Hong Kong company. Answer accurately based on the data. Use HKD as default currency. Be concise.

Today: ${new Date().toISOString().split("T")[0]}

=== FILES (${stats.totalFiles} total, ${stats.totalSize}) ===
Gmail: ${stats.gmailFiles} | Drive: ${stats.gdriveFiles} | Emails: ${emailCount}
`;

  for (const { category, count } of accountingSummary.byCategory) {
    const cat = filesByCategory[category];
    ctx += `${category}: ${count}`;
    if (cat?.totalAmount > 0) ctx += ` ($${cat.totalAmount.toFixed(2)})`;
    ctx += " | ";
  }
  ctx += "\n\nFiles:\n";

  for (const [category, data] of Object.entries(filesByCategory)) {
    if (category === "junk") continue;
    ctx += `\n[${category}]\n`;
    for (const f of data.files.slice(0, 15)) {
      ctx += `${f.name} | ${f.vendor || "?"} | ${f.amount ? `${f.currency} ${f.amount}` : "-"} | ${f.date?.substring(0, 10)}\n`;
    }
    if (data.files.length > 15) ctx += `... +${data.files.length - 15} more\n`;
  }

  if (xeroStats?.data) {
    const xs = xeroStats.data as Record<string, unknown>;
    ctx += `\n=== XERO (${xs.organisation}) ===
Invoices: ${xs.totalInvoices} (${xs.outstandingInvoices} outstanding) | Receivable: HK$${Number(xs.totalReceivable).toLocaleString()}
Bills: ${xs.totalBills} (${xs.outstandingBills} outstanding) | Payable: HK$${Number(xs.totalPayable).toLocaleString()}
Contacts: ${xs.totalContacts} (${xs.customers} customers, ${xs.suppliers} suppliers)
Status: ${JSON.stringify(xs.invoicesByStatus)} / Bills: ${JSON.stringify(xs.billsByStatus)}\n`;
  }

  if (xeroInvoices?.data) {
    const invs = xeroInvoices.data as { InvoiceNumber: string; Contact: { Name: string }; Total: number; AmountDue: number; Status: string; DateString: string; DueDateString: string; CurrencyCode: string }[];
    ctx += `\nInvoices (${invs.length}):\n`;
    for (const inv of invs.slice(0, 25))
      ctx += `${inv.InvoiceNumber} | ${inv.Contact?.Name} | ${inv.CurrencyCode} ${inv.Total} | Due: ${inv.AmountDue} | ${inv.Status} | ${inv.DateString?.substring(0, 10)}\n`;
  }

  if (xeroBills?.data) {
    const bills = xeroBills.data as { InvoiceNumber: string; Contact: { Name: string }; Total: number; AmountDue: number; Status: string; DateString: string; CurrencyCode: string }[];
    ctx += `\nBills (${bills.length}):\n`;
    for (const b of bills)
      ctx += `${b.InvoiceNumber || "-"} | ${b.Contact?.Name} | ${b.CurrencyCode} ${b.Total} | ${b.Status} | ${b.DateString?.substring(0, 10)}\n`;
  }

  if (wiseTransferStats?.data) {
    const ws = wiseTransferStats.data as Record<string, unknown>;
    ctx += `\n=== WISE ===\nTransfers: ${ws.total} (${ws.sent} sent) | By currency: ${JSON.stringify(ws.byTargetCurrency)}\n`;
  }
  if (wiseBalances?.data) {
    const bals = wiseBalances.data as { amount: { value: number; currency: string } }[];
    ctx += `Balances: ${bals.map(b => `${b.amount.currency} ${b.amount.value}`).join(", ")}\n`;
  }
  if (wiseRates?.data) ctx += `Rates: ${JSON.stringify(wiseRates.data)}\n`;

  return ctx;
}

// GET /api/chat — list conversations or get messages
export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") || "conversations";

  if (action === "conversations") {
    const conversations = db.getConversations();
    return NextResponse.json({ conversations });
  }

  if (action === "messages") {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing conversation id" }, { status: 400 });
    const messages = db.getChatMessages(id);
    const conversation = db.getConversation(id);
    return NextResponse.json({ conversation, messages });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

// POST /api/chat — send message, create/delete conversation
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action } = body;

  // Create new conversation
  if (action === "create") {
    const id = crypto.randomUUID();
    const conv = db.createConversation(id, body.title);
    return NextResponse.json({ conversation: conv });
  }

  // Delete conversation
  if (action === "delete") {
    if (!body.id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    db.deleteConversation(body.id);
    return NextResponse.json({ success: true });
  }

  // Rename conversation
  if (action === "rename") {
    if (!body.id || !body.title) return NextResponse.json({ error: "Missing id or title" }, { status: 400 });
    db.updateConversationTitle(body.id, body.title);
    return NextResponse.json({ success: true });
  }

  // Send message (default action)
  if (!OPENROUTER_KEY) return NextResponse.json({ error: "AI not configured" }, { status: 500 });

  const { conversationId } = body;
  // Support both new format (message: string) and old format (messages: array)
  let message = body.message as string | undefined;
  if (!message && body.messages && Array.isArray(body.messages)) {
    const lastUser = [...body.messages].reverse().find((m: { role: string }) => m.role === "user");
    message = lastUser?.content;
  }
  if (!message) return NextResponse.json({ error: "Missing message" }, { status: 400 });

  // Ensure conversation exists
  let convId = conversationId;
  if (!convId) {
    convId = crypto.randomUUID();
    db.createConversation(convId, "New Chat");
  } else if (!db.getConversation(convId)) {
    db.createConversation(convId, "New Chat");
  }

  // Save user message
  db.addChatMessage(convId, "user", message);

  // Get conversation history
  const history = db.getChatMessages(convId);
  const messages = history.map(m => ({ role: m.role, content: m.content }));

  // Auto-title on first message
  if (history.length <= 1) {
    const title = message.length > 60 ? message.substring(0, 57) + "..." : message;
    db.updateConversationTitle(convId, title);
  }

  // Build system context
  const systemContext = buildSystemContext();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000); // 55s timeout

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: systemContext }, ...messages],
        temperature: 0.3,
        max_tokens: 1000,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: `AI error: ${res.status}`, conversationId: convId }, { status: 500 });
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content || "Sorry, I couldn't generate a response.";

    // Save assistant reply
    db.addChatMessage(convId, "assistant", reply, data.model);

    return NextResponse.json({ reply, conversationId: convId, model: data.model });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "AI request failed", conversationId: convId }, { status: 500 });
  }
}
