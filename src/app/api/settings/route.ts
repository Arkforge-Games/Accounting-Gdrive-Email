import { NextRequest, NextResponse } from "next/server";
import * as db from "@/lib/db";

export async function GET() {
  const settings = db.getAllSettings();
  return NextResponse.json(settings);
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") {
      db.setSetting(key, value);
    }
  }

  return NextResponse.json({ success: true, settings: db.getAllSettings() });
}
