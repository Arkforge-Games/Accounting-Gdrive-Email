import { NextRequest, NextResponse } from "next/server";
import { getMsalClient, setAccessToken } from "@/lib/microsoft";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "No code provided" }, { status: 400 });
  }

  const result = await getMsalClient().acquireTokenByCode({
    code,
    scopes: ["Mail.Read", "Mail.ReadBasic"],
    redirectUri: process.env.AZURE_REDIRECT_URI || "",
  });

  if (result?.accessToken) {
    setAccessToken(result.accessToken);
  }

  const baseUrl = process.env.NEXTAUTH_URL || req.url;
  return NextResponse.redirect(new URL("/dashboard", baseUrl));
}
