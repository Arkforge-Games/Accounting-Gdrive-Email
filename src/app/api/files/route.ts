import { NextRequest, NextResponse } from "next/server";
import * as db from "@/lib/db";

export async function GET(req: NextRequest) {
  const starred = req.nextUrl.searchParams.get("starred");

  if (starred === "true") {
    return NextResponse.json({ files: db.getStarredFiles() });
  }

  return NextResponse.json({ files: db.getFiles() });
}
