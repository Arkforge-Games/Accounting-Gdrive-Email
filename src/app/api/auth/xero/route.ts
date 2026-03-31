import { NextResponse } from "next/server";
import { getXeroAuthUrl } from "@/lib/xero";

export async function GET() {
  const url = getXeroAuthUrl();
  return NextResponse.redirect(url);
}
