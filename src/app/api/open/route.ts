import { NextRequest, NextResponse } from "next/server";
import * as db from "@/lib/db";
import { getTokens, getAuthenticatedClient, extractFolderId } from "@/lib/google";
import { fetchEmailAttachments } from "@/lib/imap";
import { CATEGORIES, STATUSES } from "@/lib/categorize";
import * as xero from "@/lib/xero";
import * as wise from "@/lib/wise";

const API_KEY = process.env.API_KEY || "";

/**
 * Secured API endpoint for external agents (OpenClaw, etc.)
 * Requires API key via header or query param.
 *
 * Auth: Header `x-api-key: <key>` OR query param `?key=<key>`
 *
 * Usage:
 *   GET /api/open?key=xxx                         → overview (stats, connections, recent files)
 *   GET /api/open?key=xxx&action=stats            → file/email statistics
 *   GET /api/open?key=xxx&action=emails           → list emails (optional: &limit=50)
 *   GET /api/open?key=xxx&action=emails&q=invoice → search emails
 *   GET /api/open?key=xxx&action=email&id=xxx     → get single email with body
 *   GET /api/open?key=xxx&action=files            → list all files
 *   GET /api/open?key=xxx&action=files&source=gdrive  → list only gdrive files
 *   GET /api/open?key=xxx&action=search&q=term    → search files
 *   GET /api/open?key=xxx&action=activity         → recent activity log
 *   GET /api/open?key=xxx&action=connections      → connection statuses
 */
export async function GET(req: NextRequest) {
  // Verify API key
  const headerKey = req.headers.get("x-api-key");
  const queryKey = req.nextUrl.searchParams.get("key");
  const providedKey = headerKey || queryKey;

  if (!API_KEY || !providedKey || providedKey !== API_KEY) {
    return NextResponse.json({ error: "Unauthorized — invalid or missing API key" }, { status: 401 });
  }

  const action = req.nextUrl.searchParams.get("action") || "overview";

  try {
    switch (action) {
      case "overview": {
        const stats = db.getStats();
        const connections = db.getAllConnections();
        const activity = db.getActivity(5);
        const emailCount = db.getEmailCount();
        return NextResponse.json({
          stats: { ...stats, emailCount },
          connections,
          recentActivity: activity,
        });
      }

      case "stats": {
        const stats = db.getStats();
        const emailCount = db.getEmailCount();
        return NextResponse.json({ ...stats, emailCount });
      }

      case "emails": {
        const q = req.nextUrl.searchParams.get("q");
        const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50");
        if (q) {
          const emails = db.searchEmails(q);
          return NextResponse.json({ emails, count: emails.length, query: q });
        }
        const emails = db.getEmails(limit);
        return NextResponse.json({ emails, count: emails.length });
      }

      case "email": {
        const id = req.nextUrl.searchParams.get("id");
        if (!id) return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
        const email = db.getEmail(id);
        if (!email) return NextResponse.json({ error: "Email not found" }, { status: 404 });
        return NextResponse.json({ email });
      }

      case "files": {
        const source = req.nextUrl.searchParams.get("source");
        const allFiles = db.getFiles();
        const files = source ? allFiles.filter((f) => f.source === source) : allFiles;
        return NextResponse.json({ files, count: files.length });
      }

      case "search": {
        const q = req.nextUrl.searchParams.get("q");
        if (!q) return NextResponse.json({ error: "Missing q parameter" }, { status: 400 });
        const source = req.nextUrl.searchParams.get("source") || undefined;
        const files = db.searchFiles(q, { source });
        const emails = db.searchEmails(q);
        return NextResponse.json({ files, emails, filesCount: files.length, emailsCount: emails.length, query: q });
      }

      case "activity": {
        const limit = parseInt(req.nextUrl.searchParams.get("limit") || "20");
        const activity = db.getActivity(limit);
        return NextResponse.json({ activity, count: activity.length });
      }

      case "connections": {
        const connections = db.getAllConnections();
        return NextResponse.json(connections);
      }

      case "wise": {
        if (!wise.isWiseConfigured()) {
          return NextResponse.json({ error: "Wise API token not configured" }, { status: 500 });
        }
        const sub = req.nextUrl.searchParams.get("sub") || "summary";
        try {
          switch (sub) {
            case "summary": {
              const summary = await wise.getWiseSummary();
              return NextResponse.json(summary);
            }
            case "balances": {
              const profile = await wise.getBusinessProfile();
              if (!profile) return NextResponse.json({ error: "No profile" }, { status: 404 });
              const balances = await wise.getBalances(profile.id);
              return NextResponse.json({ balances });
            }
            case "transfers": {
              const profile = await wise.getBusinessProfile();
              if (!profile) return NextResponse.json({ error: "No profile" }, { status: 404 });
              const all = req.nextUrl.searchParams.get("all") === "true";
              if (all) {
                const transfers = await wise.getAllTransfers(profile.id);
                return NextResponse.json({ transfers, count: transfers.length });
              }
              const limit = parseInt(req.nextUrl.searchParams.get("limit") || "20");
              const offset = parseInt(req.nextUrl.searchParams.get("offset") || "0");
              const transfers = await wise.getTransfers(profile.id, limit, offset);
              return NextResponse.json({ transfers, count: transfers.length });
            }
            case "all-transfers": {
              const profile = await wise.getBusinessProfile();
              if (!profile) return NextResponse.json({ error: "No profile" }, { status: 404 });
              const transfers = await wise.getAllTransfers(profile.id);
              const sent = transfers.filter(t => t.status === "outgoing_payment_sent");
              const byCurrency: Record<string, { amount: number; count: number }> = {};
              for (const t of sent) {
                if (!byCurrency[t.targetCurrency]) byCurrency[t.targetCurrency] = { amount: 0, count: 0 };
                byCurrency[t.targetCurrency].amount += t.targetValue;
                byCurrency[t.targetCurrency].count++;
              }
              return NextResponse.json({
                transfers,
                count: transfers.length,
                stats: { total: transfers.length, sent: sent.length, cancelled: transfers.filter(t => t.status === "cancelled").length, refunded: transfers.filter(t => t.status === "funds_refunded").length },
                byTargetCurrency: byCurrency,
              });
            }
            case "recipients": {
              const profile = await wise.getBusinessProfile();
              if (!profile) return NextResponse.json({ error: "No profile" }, { status: 404 });
              const recipients = await wise.getRecipients(profile.id);
              return NextResponse.json({ recipients, count: recipients.length });
            }
            case "rate": {
              const source = req.nextUrl.searchParams.get("source") || "HKD";
              const target = req.nextUrl.searchParams.get("target") || "PHP";
              const rates = await wise.getExchangeRate(source, target);
              return NextResponse.json({ rates });
            }
            default:
              return NextResponse.json({ error: `Unknown wise sub: ${sub}`, available: ["summary", "balances", "transfers", "all-transfers", "recipients", "rate"] });
          }
        } catch (err) {
          return NextResponse.json({ error: err instanceof Error ? err.message : "Wise API error" }, { status: 500 });
        }
      }

      case "xero": {
        const sub = req.nextUrl.searchParams.get("sub") || "status";
        try {
          switch (sub) {
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
              const data = await xero.getInvoices(page);
              return NextResponse.json(data);
            }
            case "bills": {
              const page = parseInt(req.nextUrl.searchParams.get("page") || "1");
              const data = await xero.getInvoices(page, 'Type=="ACCPAY"');
              return NextResponse.json({ Bills: data.Invoices, count: data.Invoices.length });
            }
            case "contacts": {
              const page = parseInt(req.nextUrl.searchParams.get("page") || "1");
              const data = await xero.getContacts(page);
              return NextResponse.json(data);
            }
            case "accounts": {
              const data = await xero.getAccounts();
              return NextResponse.json(data);
            }
            default:
              return NextResponse.json({ error: `Unknown xero sub-action: ${sub}`, available: ["status", "summary", "invoices", "bills", "contacts", "accounts"] });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Xero API error";
          return NextResponse.json({ error: msg }, { status: 500 });
        }
      }

      case "accounting": {
        const subAction = req.nextUrl.searchParams.get("sub") || "summary";
        if (subAction === "summary") {
          const summary = db.getAccountingSummary();
          return NextResponse.json({ ...summary, categories: CATEGORIES, statuses: STATUSES });
        }
        const files = db.getIndexedFiles({
          category: req.nextUrl.searchParams.get("category") || undefined,
          status: req.nextUrl.searchParams.get("status") || undefined,
          period: req.nextUrl.searchParams.get("period") || undefined,
          search: req.nextUrl.searchParams.get("q") || undefined,
        });
        return NextResponse.json({ files, count: files.length });
      }

      case "sync": {
        const source = req.nextUrl.searchParams.get("source") || "all";
        // Trigger sync in background by calling the sync API internally
        const syncUrl = `http://localhost:8325/api/sync${source !== "all" ? `?source=${source}` : ""}`;
        // Fire and forget — don't wait for completion
        fetch(syncUrl, {
          method: "POST",
          headers: { "Cookie": `session=${req.cookies.get("session")?.value || ""}` },
        }).catch(() => {});
        return NextResponse.json({ message: `Sync triggered for: ${source}. Check activity log for progress.` });
      }

      default:
        return NextResponse.json({
          error: `Unknown action: ${action}`,
          available: ["overview", "stats", "emails", "email", "files", "search", "activity", "connections", "accounting", "wise", "xero", "sync"],
        }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal error" }, { status: 500 });
  }
}
