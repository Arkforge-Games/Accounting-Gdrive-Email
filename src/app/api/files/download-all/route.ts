import { NextResponse } from "next/server";
import * as db from "@/lib/db";
import archiver from "archiver";
import { PassThrough } from "stream";

export async function GET() {
  const files = db.getFiles();

  if (files.length === 0) {
    return NextResponse.json({ error: "No files to download" }, { status: 404 });
  }

  const passthrough = new PassThrough();
  const archive = archiver("zip", { zlib: { level: 5 } });

  archive.pipe(passthrough);

  // Track filenames to avoid duplicates
  const nameCount: Record<string, number> = {};

  for (const file of files) {
    const content = db.getFileContent(file.id);
    if (!content) continue;

    // Deduplicate filenames
    let fileName = content.name;
    if (nameCount[fileName]) {
      const ext = fileName.lastIndexOf(".");
      if (ext > 0) {
        fileName = `${fileName.substring(0, ext)}_${nameCount[fileName]}${fileName.substring(ext)}`;
      } else {
        fileName = `${fileName}_${nameCount[fileName]}`;
      }
    }
    nameCount[content.name] = (nameCount[content.name] || 0) + 1;

    archive.append(Buffer.from(content.content), { name: fileName });
  }

  archive.finalize();

  // Convert Node stream to Web ReadableStream
  const readable = new ReadableStream({
    start(controller) {
      passthrough.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk)));
      passthrough.on("end", () => controller.close());
      passthrough.on("error", (err) => controller.error(err));
    },
  });

  return new NextResponse(readable, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="accounting-files-${new Date().toISOString().split("T")[0]}.zip"`,
      "Transfer-Encoding": "chunked",
    },
  });
}
