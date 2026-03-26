import { NextRequest, NextResponse } from "next/server";
import * as db from "@/lib/db";

export async function POST(req: NextRequest) {
  const { id } = await req.json();
  const starred = db.toggleStar(id);
  db.addActivity({
    action: starred ? "star" : "unstar",
    source: "manual",
    details: starred ? "Starred a file" : "Unstarred a file",
  });
  return NextResponse.json({ starred });
}
