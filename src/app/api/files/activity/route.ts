import { NextResponse } from "next/server";
import * as db from "@/lib/db";

export async function GET() {
  return NextResponse.json({ activity: db.getActivity() });
}
