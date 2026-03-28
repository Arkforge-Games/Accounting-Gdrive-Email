import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";

// Credentials from environment or defaults
const VALID_USERNAME = process.env.AUTH_USERNAME || "admin";
const VALID_PASSWORD = process.env.AUTH_PASSWORD || "admin";
const SESSION_SECRET = process.env.NEXTAUTH_SECRET || "fallback-secret";

function createSessionToken(username: string): string {
  const payload = JSON.stringify({ username, ts: Date.now() });
  const hmac = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return Buffer.from(payload).toString("base64") + "." + hmac;
}

function verifySessionToken(token: string): { username: string } | null {
  try {
    const [payloadB64, hmac] = token.split(".");
    if (!payloadB64 || !hmac) return null;
    const payload = Buffer.from(payloadB64, "base64").toString();
    const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
    if (hmac !== expected) return null;
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();

  if (username === VALID_USERNAME && password === VALID_PASSWORD) {
    const token = createSessionToken(username);
    const cookieStore = await cookies();

    cookieStore.set("session", token, {
      httpOnly: true,
      secure: req.url.startsWith("https"),
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
}
