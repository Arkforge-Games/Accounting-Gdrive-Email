import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import * as db from "@/lib/db";
import { categorizeFile } from "@/lib/categorize";
import type { SyncFile } from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const id = `upload_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    // Optional form fields
    const vendorOverride = formData.get("vendor") as string | null;
    const categoryOverride = formData.get("category") as string | null;
    const notes = formData.get("notes") as string | null;

    // Build the SyncFile for categorization
    const syncFile: SyncFile = {
      id,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      source: "upload",
      date: now,
      size: formatBytes(buffer.length),
      sizeBytes: buffer.length,
    };

    // Auto-categorize
    const categorization = categorizeFile(syncFile);

    // Try to extract amount from PDF
    let extractedAmount: string | null = null;
    let extractedCurrency: string = "PHP";

    if (file.type === "application/pdf") {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pdfParse = require("pdf-parse");
        const pdfData = await pdfParse(buffer);
        const text: string = pdfData.text || "";

        // Reuse the amount extraction from categorize module
        const { extractAmountFromBody } = await import("@/lib/categorize");
        const amountResult = extractAmountFromBody(text);
        if (amountResult) {
          extractedAmount = amountResult.amount;
          extractedCurrency = amountResult.currency;
        }
      } catch {
        // pdf-parse not installed or PDF parsing failed — skip amount extraction
      }
    }

    // Save file to the files table
    const result = db.upsertFiles([
      {
        ...syncFile,
        content: buffer,
      },
    ]);

    // Save categorization to file_index
    const finalCategory = categoryOverride || categorization.category;
    const finalVendor = vendorOverride || categorization.vendor;

    db.upsertFileIndex({
      fileId: id,
      category: finalCategory,
      status: "pending",
      period: categorization.period,
      notes: notes || undefined,
      vendor: finalVendor || undefined,
      amount: extractedAmount || undefined,
      currency: extractedCurrency,
      autoCategorized: !categoryOverride,
    });

    // Log activity
    db.addActivity({
      action: "sync",
      source: "upload",
      details: `Uploaded file: ${file.name}`,
      fileCount: 1,
    });

    return NextResponse.json({
      success: true,
      file: {
        id,
        name: file.name,
        mimeType: syncFile.mimeType,
        source: "upload",
        date: now,
        size: syncFile.size,
        sizeBytes: syncFile.sizeBytes,
        category: finalCategory,
        vendor: finalVendor,
        amount: extractedAmount,
        currency: extractedCurrency,
        notes,
        autoCategorized: !categoryOverride,
      },
      ...result,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 }
    );
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
