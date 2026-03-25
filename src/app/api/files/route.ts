import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";

export async function GET(req: NextRequest) {
  const starred = req.nextUrl.searchParams.get("starred");

  if (starred === "true") {
    return NextResponse.json({ files: store.getStarredFiles() });
  }

  return NextResponse.json({ files: store.getFiles() });
}
