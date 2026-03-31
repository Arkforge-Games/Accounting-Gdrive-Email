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
        const limit = parseInt(req.nextUrl.searchParams.get("limit") || "20");
        const offset = parseInt(req.nextUrl.searchParams.get("offset") || "0");
        if (!profileId) {
          const profile = await wise.getBusinessProfile();
          if (!profile) return NextResponse.json({ error: "No profile found" }, { status: 404 });
          const transfers = await wise.getTransfers(profile.id, limit, offset);
          return NextResponse.json({ transfers, count: transfers.length, profileId: profile.id });
        }
        const transfers = await wise.getTransfers(profileId, limit, offset);
        return NextResponse.json({ transfers, count: transfers.length, profileId });
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
