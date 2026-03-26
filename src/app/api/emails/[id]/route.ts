import { NextRequest, NextResponse } from "next/server";
import * as db from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const email = db.getEmail(id);
  if (!email) {
    return NextResponse.json({ error: "Email not found" }, { status: 404 });
  }
  // Don't send raw_source to frontend (too big)
  const { raw_source, ...emailData } = email;
  return NextResponse.json({ email: emailData });
}
