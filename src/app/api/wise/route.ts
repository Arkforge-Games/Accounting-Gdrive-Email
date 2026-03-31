import { NextRequest, NextResponse } from "next/server";
import * as wise from "@/lib/wise";

export async function GET(req: NextRequest) {
  if (!wise.isWiseConfigured()) {
    return NextResponse.json({ error: "Wise API token not configured" }, { status: 500 });
  }

  const action = req.nextUrl.searchParams.get("action") || "summary";

  try {
    switch (action) {
      case "status": {
        const configured = wise.isWiseConfigured();
        let profile = null;
        if (configured) {
          try { profile = await wise.getBusinessProfile(); } catch { /* token might be invalid */ }
        }
        return NextResponse.json({ configured, connected: !!profile, profile });
      }

      case "summary": {
        const summary = await wise.getWiseSummary();
        return NextResponse.json(summary);
      }

      case "profiles": {
        const profiles = await wise.getProfiles();
        return NextResponse.json({ profiles });
      }

      case "balances": {
        const profileId = parseInt(req.nextUrl.searchParams.get("profileId") || "0");
        if (!profileId) {
          const profile = await wise.getBusinessProfile();
          if (!profile) return NextResponse.json({ error: "No profile found" }, { status: 404 });
          const balances = await wise.getBalances(profile.id);
          return NextResponse.json({ balances, profileId: profile.id });
        }
        const balances = await wise.getBalances(profileId);
        return NextResponse.json({ balances, profileId });
      }

      case "transfers": {
        const profileId = parseInt(req.nextUrl.searchParams.get("profileId") || "0");
        const all = req.nextUrl.searchParams.get("all") === "true";
        const limit = parseInt(req.nextUrl.searchParams.get("limit") || "20");
        const offset = parseInt(req.nextUrl.searchParams.get("offset") || "0");

        const resolvedId = profileId || (await wise.getBusinessProfile())?.id;
        if (!resolvedId) return NextResponse.json({ error: "No profile found" }, { status: 404 });

        if (all) {
          const transfers = await wise.getAllTransfers(resolvedId);
          return NextResponse.json({ transfers, count: transfers.length, profileId: resolvedId });
        }
        const transfers = await wise.getTransfers(resolvedId, limit, offset);
        return NextResponse.json({ transfers, count: transfers.length, profileId: resolvedId });
      }

      case "all-data": {
        // Full dump for AI agents — all profiles, balances, transfers, recipients
        const profiles = await wise.getProfiles();
        const business = profiles.find(p => p.type === "business");
        const personal = profiles.find(p => p.type === "personal");

        const result: Record<string, unknown> = { profiles };

        if (business) {
          const [bBalances, bBorderless, bTransfers, bRecipients] = await Promise.all([
            wise.getBalances(business.id),
            wise.getBorderlessAccounts(business.id),
            wise.getAllTransfers(business.id),
            wise.getRecipients(business.id),
          ]);

          // Compute transfer stats
          const sent = bTransfers.filter(t => t.status === "outgoing_payment_sent");
          const totalSentByCurrency: Record<string, number> = {};
          for (const t of sent) {
            totalSentByCurrency[t.sourceCurrency] = (totalSentByCurrency[t.sourceCurrency] || 0) + t.sourceValue;
          }
          const byCurrency: Record<string, { sent: number; count: number }> = {};
          for (const t of sent) {
            if (!byCurrency[t.targetCurrency]) byCurrency[t.targetCurrency] = { sent: 0, count: 0 };
            byCurrency[t.targetCurrency].sent += t.targetValue;
            byCurrency[t.targetCurrency].count++;
          }

          result.business = {
            profile: business,
            balances: bBalances,
            borderlessAccounts: bBorderless,
            transfers: {
              total: bTransfers.length,
              sent: sent.length,
              cancelled: bTransfers.filter(t => t.status === "cancelled").length,
              refunded: bTransfers.filter(t => t.status === "funds_refunded").length,
              totalSentByCurrency,
              byTargetCurrency: byCurrency,
              all: bTransfers,
            },
            recipients: bRecipients,
          };
        }

        if (personal) {
          const [pBalances, pTransfers, pRecipients] = await Promise.all([
            wise.getBalances(personal.id).catch(() => []),
            wise.getAllTransfers(personal.id),
            wise.getRecipients(personal.id).catch(() => []),
          ]);
          result.personal = {
            profile: personal,
            balances: pBalances,
            transfers: { total: pTransfers.length, all: pTransfers },
            recipients: pRecipients,
          };
        }

        return NextResponse.json(result);
      }

      case "recipients": {
        const profileId = parseInt(req.nextUrl.searchParams.get("profileId") || "0");
        if (!profileId) {
          const profile = await wise.getBusinessProfile();
          if (!profile) return NextResponse.json({ error: "No profile found" }, { status: 404 });
          const recipients = await wise.getRecipients(profile.id);
          return NextResponse.json({ recipients, count: recipients.length });
        }
        const recipients = await wise.getRecipients(profileId);
        return NextResponse.json({ recipients, count: recipients.length });
      }

      case "statement": {
        const profileId = parseInt(req.nextUrl.searchParams.get("profileId") || "0");
        const balanceId = parseInt(req.nextUrl.searchParams.get("balanceId") || "0");
        const currency = req.nextUrl.searchParams.get("currency") || "HKD";
        const start = req.nextUrl.searchParams.get("start") || new Date(Date.now() - 30 * 86400000).toISOString();
        const end = req.nextUrl.searchParams.get("end") || new Date().toISOString();
        if (!profileId || !balanceId) {
          return NextResponse.json({ error: "Missing profileId and balanceId" }, { status: 400 });
        }
        const statement = await wise.getStatement(profileId, balanceId, currency, start, end);
        return NextResponse.json(statement);
      }

      case "rate": {
        const source = req.nextUrl.searchParams.get("source") || "HKD";
        const target = req.nextUrl.searchParams.get("target") || "PHP";
        const rates = await wise.getExchangeRate(source, target);
        return NextResponse.json({ rates });
      }

      default:
        return NextResponse.json({
          error: `Unknown action: ${action}`,
          available: ["status", "summary", "profiles", "balances", "transfers", "recipients", "statement", "rate"],
        }, { status: 400 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
