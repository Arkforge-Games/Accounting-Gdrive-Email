import { NextRequest, NextResponse } from "next/server";

const SESSION_SECRET = process.env.NEXTAUTH_SECRET || "fallback-secret";

async function verifySession(token: string): Promise<boolean> {
  try {
    const dotIdx = token.indexOf(".");
    if (dotIdx === -1) return false;
    const payloadB64 = token.slice(0, dotIdx);
    const hmac = token.slice(dotIdx + 1);

    const payload = atob(payloadB64);
    const encoder = new TextEncoder();
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      encoder.encode(SESSION_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await globalThis.crypto.subtle.sign("HMAC", key, encoder.encode(payload));
    const expected = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
    return hmac === expected;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public routes
  if (
    pathname === "/" ||
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/open" ||
    pathname.startsWith("/api/open/") ||
    pathname === "/api/chat" ||
    pathname === "/api/analytics" ||
    pathname === "/api/alerts" ||
    pathname.startsWith("/api/sheets") ||
    pathname.startsWith("/api/wise") ||
    pathname.startsWith("/api/xero") ||
    pathname.startsWith("/api/reports/") ||
    pathname === "/api/crossref" ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  // Allow localhost/internal requests (server-to-server)
  const host = req.headers.get("host") || "";
  if (host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("10.0.0.")) {
    return NextResponse.next();
  }

  const session = req.cookies.get("session")?.value;
  if (!session || !(await verifySession(session))) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};
