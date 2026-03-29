import { NextRequest, NextResponse } from "next/server";
import { getOAuth2Client, setTokens } from "@/lib/google";
import * as db from "@/lib/db";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "No code provided" }, { status: 400 });
  }

  try {
    const client = getOAuth2Client();
    const { tokens } = await client.getToken(code);
    setTokens(tokens);

    // Mark Google Drive as connected
    db.setConnection("gdrive", {
      connected: true,
    });

    const baseUrl = process.env.NEXTAUTH_URL || req.url;
    return NextResponse.redirect(new URL("/dashboard/drive", baseUrl));
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    const baseUrl = process.env.NEXTAUTH_URL || req.url;
    return NextResponse.redirect(new URL("/dashboard/drive?error=oauth_failed", baseUrl));
  }
}
