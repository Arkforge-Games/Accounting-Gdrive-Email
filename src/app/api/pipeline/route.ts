import { NextRequest, NextResponse } from "next/server";
import * as db from "@/lib/db";
import { runPipeline } from "@/lib/pipeline";

export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") || "status";

  if (action === "status") {
    const runs = db.getPipelineRuns(20);
    return NextResponse.json({ runs });
  }

  if (action === "log") {
    const runId = req.nextUrl.searchParams.get("runId") || undefined;
    const fileId = req.nextUrl.searchParams.get("fileId") || undefined;
    const logAction = req.nextUrl.searchParams.get("logAction") || undefined;
    const limit = parseInt(req.nextUrl.searchParams.get("limit") || "100");
    const logs = db.getPipelineLogs({ runId, fileId, action: logAction, limit });
    return NextResponse.json({ logs, count: logs.length });
  }

  if (action === "unrecorded") {
    const files = db.getUnrecordedFiles();
    return NextResponse.json({
      count: files.length,
      byCat: files.reduce<Record<string, number>>((acc, f) => { acc[f.category] = (acc[f.category] || 0) + 1; return acc; }, {}),
      files: files.slice(0, 50).map(f => ({ id: f.id, name: f.name, category: f.category, vendor: f.vendor, amount: f.amount, date: f.date })),
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const action = (body as { action?: string }).action || "run";

  if (action === "run") {
    const result = await runPipeline();
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
