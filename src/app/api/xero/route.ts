import { NextRequest, NextResponse } from "next/server";
import * as xero from "@/lib/xero";

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") || "status";

  try {
    switch (action) {
      case "status": {
        const connected = xero.isXeroConnected();
        const tenant = xero.getXeroTenantInfo();
        return NextResponse.json({ connected, tenant });
      }

      case "summary": {
        const summary = await xero.getXeroSummary();
        return NextResponse.json(summary);
      }

      case "invoices": {
        const page = parseInt(req.nextUrl.searchParams.get("page") || "1");
        const where = req.nextUrl.searchParams.get("where") || undefined;
        const data = await xero.getInvoices(page, where);
        return NextResponse.json(data);
      }

      case "bills": {
        const page = parseInt(req.nextUrl.searchParams.get("page") || "1");
        const data = await xero.getInvoices(page, 'Type=="ACCPAY"');
        return NextResponse.json({ Bills: data.Invoices, count: data.Invoices.length });
      }

      case "contacts": {
        const page = parseInt(req.nextUrl.searchParams.get("page") || "1");
        const where = req.nextUrl.searchParams.get("where") || undefined;
        const data = await xero.getContacts(page, where);
        return NextResponse.json(data);
      }

      case "bank-transactions": {
        const page = parseInt(req.nextUrl.searchParams.get("page") || "1");
        const where = req.nextUrl.searchParams.get("where") || undefined;
        const data = await xero.getBankTransactions(page, where);
        return NextResponse.json(data);
      }

      case "accounts": {
        const data = await xero.getAccounts();
        return NextResponse.json(data);
      }

      case "organisation": {
        const data = await xero.getOrganisation();
        return NextResponse.json(data);
      }

      case "profit-loss": {
        const from = req.nextUrl.searchParams.get("from") || undefined;
        const to = req.nextUrl.searchParams.get("to") || undefined;
        const data = await xero.getProfitAndLoss(from, to);
        return NextResponse.json(data);
      }

      case "balance-sheet": {
        const date = req.nextUrl.searchParams.get("date") || undefined;
        const data = await xero.getBalanceSheet(date);
        return NextResponse.json(data);
      }

      case "bank-summary": {
        const from = req.nextUrl.searchParams.get("from") || undefined;
        const to = req.nextUrl.searchParams.get("to") || undefined;
        const data = await xero.getBankSummary(from, to);
        return NextResponse.json(data);
      }

      case "aged-receivables": {
        const date = req.nextUrl.searchParams.get("date") || undefined;
        const data = await xero.getAgedReceivables(date);
        return NextResponse.json(data);
      }

      case "aged-payables": {
        const date = req.nextUrl.searchParams.get("date") || undefined;
        const data = await xero.getAgedPayables(date);
        return NextResponse.json(data);
      }

      case "trial-balance": {
        const date = req.nextUrl.searchParams.get("date") || undefined;
        const data = await xero.getTrialBalance(date);
        return NextResponse.json(data);
      }

      case "report": {
        const name = req.nextUrl.searchParams.get("name");
        if (!name) return NextResponse.json({ error: "Missing report name" }, { status: 400 });
        const data = await xero.getReport(name);
        return NextResponse.json(data);
      }

      case "sync": {
        const result = await xero.syncXeroData();
        return NextResponse.json({ message: "Xero data synced and cached", ...result });
      }

      case "cached": {
        const key = req.nextUrl.searchParams.get("key") || "stats";
        const data = xero.getCachedXeroData(key);
        if (!data) return NextResponse.json({
          error: `No cached data for key: ${key}`,
          available: ["last_sync", "stats", "organisation", "invoices", "bills", "contacts", "bank_transactions", "accounts"],
        }, { status: 404 });
        return NextResponse.json({ key, data });
      }

      case "all-data": {
        // Try cached first, fall back to live
        const stats = xero.getCachedXeroData("stats");
        const invoices = xero.getCachedXeroData("invoices");
        const bills = xero.getCachedXeroData("bills");
        const contacts = xero.getCachedXeroData("contacts");
        const bankTx = xero.getCachedXeroData("bank_transactions");
        const accounts = xero.getCachedXeroData("accounts");
        const lastSync = xero.getLastXeroSync();

        if (!stats) {
          // No cache — do a live sync
          const result = await xero.syncXeroData();
          return NextResponse.json({
            message: "First sync completed",
            ...result,
            stats: xero.getCachedXeroData("stats"),
            lastSync: xero.getLastXeroSync(),
          });
        }

        return NextResponse.json({ stats, invoices, bills, contacts, bankTransactions: bankTx, accounts, lastSync });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}`, available: ["status", "summary", "invoices", "bills", "contacts", "bank-transactions", "accounts", "organisation", "sync", "cached", "all-data"] }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.action === "sync") {
    const result = await xero.syncXeroData();
    return NextResponse.json({ message: "Xero data synced", ...result });
  }

  if (body.action === "disconnect") {
    xero.disconnectXero();
    return NextResponse.json({ success: true, message: "Xero disconnected" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
