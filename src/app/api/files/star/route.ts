import { NextRequest, NextResponse } from "next/server";
import { store } from "@/lib/store";

export async function POST(req: NextRequest) {
  const { id } = await req.json();
  const starred = store.toggleStar(id);
  store.addActivity({
    action: starred ? "star" : "unstar",
    source: "manual",
    details: starred ? "Starred a file" : "Unstarred a file",
  });
  return NextResponse.json({ starred });
}
