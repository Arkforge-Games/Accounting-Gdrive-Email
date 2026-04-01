import { NextRequest, NextResponse } from "next/server";
import * as db from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const file = db.getFileContent(id);

  if (!file) {
    return NextResponse.json({ error: "File not found or no content" }, { status: 404 });
  }

  const inline = req.nextUrl.searchParams.get("inline") === "1";

  return new NextResponse(new Uint8Array(file.content), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${file.name.replace(/"/g, '\\"')}"`,
      "Content-Length": String(file.content.length),
    },
  });
}
