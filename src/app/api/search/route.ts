import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "";
  const source = req.nextUrl.searchParams.get("source") || undefined;
  const dateFrom = req.nextUrl.searchParams.get("dateFrom") || undefined;
  const dateTo = req.nextUrl.searchParams.get("dateTo") || undefined;

  const files = store.searchFiles(q, { source, dateFrom, dateTo });
  return NextResponse.json({ files });
}
