import { NextRequest, NextResponse } from "next/server";
import { exchangeXeroCode } from "@/lib/xero";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const baseUrl = process.env.NEXTAUTH_URL || req.url;

  if (!code) {
    return NextResponse.redirect(new URL("/dashboard/settings?error=xero_no_code", baseUrl));
  }

  try {
    const result = await exchangeXeroCode(code);
    console.log(`Xero OAuth: connected to "${result.tenantName}" (${result.tenantId})`);
    return NextResponse.redirect(new URL(`/dashboard/settings?xero=connected&org=${encodeURIComponent(result.tenantName)}`, baseUrl));
  } catch (err) {
    console.error("Xero OAuth callback error:", err);
    return NextResponse.redirect(new URL("/dashboard/settings?error=xero_oauth_failed", baseUrl));
  }
}
