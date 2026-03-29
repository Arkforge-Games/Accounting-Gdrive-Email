import { NextRequest, NextResponse } from "next/server";
import { getOAuth2Client, setTokens } from "@/lib/google";
import * as db from "@/lib/db";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const baseUrl = process.env.NEXTAUTH_URL || req.url;

  if (!code) {
    return NextResponse.redirect(new URL("/dashboard/drive?error=no_code", baseUrl));
  }

  try {
    const client = getOAuth2Client();
    const { tokens } = await client.getToken(code);

    if (!tokens || !tokens.access_token) {
      console.error("Google OAuth: no access_token in response");
      return NextResponse.redirect(new URL("/dashboard/drive?error=no_token", baseUrl));
    }

    setTokens(tokens);
    console.log("Google OAuth: tokens saved successfully");

    db.setConnection("gdrive", { connected: true });

    return NextResponse.redirect(new URL("/dashboard/drive?connected=true", baseUrl));
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    // Do NOT mark as connected on failure
    return NextResponse.redirect(new URL("/dashboard/drive?error=oauth_failed", baseUrl));
  }
}
