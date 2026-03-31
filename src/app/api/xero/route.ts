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

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.action === "disconnect") {
    xero.disconnectXero();
    return NextResponse.json({ success: true, message: "Xero disconnected" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
