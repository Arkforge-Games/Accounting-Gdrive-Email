import { NextRequest, NextResponse } from "next/server";
import * as db from "@/lib/db";
import { categorizeFile, CATEGORIES, STATUSES } from "@/lib/categorize";

// GET /api/accounting — get indexed files with filters + summary
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const view = p.get("view") || "files"; // "files" | "summary"

  if (view === "summary") {
    const summary = db.getAccountingSummary();
    return NextResponse.json({
      ...summary,
      categories: CATEGORIES,
      statuses: STATUSES,
    });
  }

  const files = db.getIndexedFiles({
    category: p.get("category") || undefined,
    status: p.get("status") || undefined,
    period: p.get("period") || undefined,
    vendor: p.get("vendor") || undefined,
    search: p.get("q") || undefined,
  });

  return NextResponse.json({
    files,
    count: files.length,
    categories: CATEGORIES,
    statuses: STATUSES,
  });
}

// POST /api/accounting — update file index or auto-categorize
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action } = body;

  if (action === "auto-categorize") {
    // Auto-categorize all files that haven't been manually categorized
    const allFiles = db.getFiles();
    let categorized = 0;

    for (const file of allFiles) {
      const existing = db.getFileIndex(file.id);
      // Skip files that were manually categorized (not auto)
      if (existing && !existing.auto_categorized && existing.category !== "uncategorized") continue;

      const result = categorizeFile(file);
      db.upsertFileIndex({
        fileId: file.id,
        category: result.category,
        period: result.period,
        vendor: result.vendor || undefined,
        autoCategorized: true,
      });
      categorized++;
    }

    return NextResponse.json({ message: `Auto-categorized ${categorized} files`, categorized });
  }

  if (action === "update") {
    const { fileId, category, status, period, notes, vendor, amount, currency, referenceNo } = body;
    if (!fileId) return NextResponse.json({ error: "Missing fileId" }, { status: 400 });

    // Check if file exists
    const existing = db.getFileIndex(fileId);
    if (existing) {
      db.updateFileIndex(fileId, {
        category, status, period, notes, vendor, amount, currency, referenceNo,
      });
    } else {
      db.upsertFileIndex({
        fileId,
        category: category || "uncategorized",
        status: status || "pending",
        period, notes, vendor, amount, currency, referenceNo,
        autoCategorized: false,
      });
    }

    return NextResponse.json({ success: true, fileId });
  }

  if (action === "bulk-update") {
    const { fileIds, category, status } = body;
    if (!fileIds || !Array.isArray(fileIds)) {
      return NextResponse.json({ error: "Missing fileIds array" }, { status: 400 });
    }

    let updated = 0;
    for (const fileId of fileIds) {
      const existing = db.getFileIndex(fileId);
      if (existing) {
        db.updateFileIndex(fileId, { category, status });
      } else {
        db.upsertFileIndex({
          fileId,
          category: category || "uncategorized",
          status: status || "pending",
          autoCategorized: false,
        });
      }
      updated++;
    }

    return NextResponse.json({ success: true, updated });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
