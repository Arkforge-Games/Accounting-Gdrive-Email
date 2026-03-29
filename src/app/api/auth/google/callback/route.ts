import { NextRequest, NextResponse } from "next/server";
import { getOAuth2Client, setTokens } from "@/lib/google";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "No code provided" }, { status: 400 });
  }

  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  setTokens(tokens);

  const baseUrl = process.env.NEXTAUTH_URL || req.url;
  return NextResponse.redirect(new URL("/dashboard/drive", baseUrl));
}
