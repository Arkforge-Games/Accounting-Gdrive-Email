import { NextRequest, NextResponse } from "next/server";
import * as db from "@/lib/db";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  if (q) {
    return NextResponse.json({ emails: db.searchEmails(q) });
  }
  return NextResponse.json({ emails: db.getEmails(), total: db.getEmailCount() });
}
