import { NextRequest, NextResponse } from "next/server";
import * as db from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const file = db.getFile(id);
  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  return NextResponse.json({ file });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const deleted = db.deleteFile(id);
  if (!deleted) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  db.addActivity({ action: "delete", source: "manual", details: "Deleted file" });
  return NextResponse.json({ success: true });
}
