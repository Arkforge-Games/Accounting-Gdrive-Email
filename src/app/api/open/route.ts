import { NextRequest, NextResponse } from "next/server";
import * as db from "@/lib/db";

/**
 * Open API endpoint for external agents (OpenClaw, etc.)
 * No authentication required.
 *
 * Usage:
 *   GET /api/open                         → overview (stats, connections, recent files)
 *   GET /api/open?action=stats            → file/email statistics
 *   GET /api/open?action=emails           → list emails (optional: ?limit=50)
 *   GET /api/open?action=emails&q=invoice → search emails
 *   GET /api/open?action=email&id=xxx     → get single email with body
 *   GET /api/open?action=files            → list all files
 *   GET /api/open?action=files&source=gdrive  → list only gdrive files
 *   GET /api/open?action=search&q=term    → search files
 *   GET /api/open?action=activity         → recent activity log
 *   GET /api/open?action=connections      → connection statuses
 */
export async function GET(req: NextRequest) {
  const action = req.nextUrl.searchParams.get("action") || "overview";

  try {
    switch (action) {
      case "overview": {
        const stats = db.getStats();
        const connections = db.getAllConnections();
        const activity = db.getActivity(5);
        const emailCount = db.getEmailCount();
        return NextResponse.json({
          stats: { ...stats, emailCount },
          connections,
          recentActivity: activity,
        });
      }

      case "stats": {
        const stats = db.getStats();
        const emailCount = db.getEmailCount();
        return NextResponse.json({ ...stats, emailCount });
      }

      case "emails": {
        const q = req.nextUrl.searchParams.get("q");
        const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50");
        if (q) {
          const emails = db.searchEmails(q);
          return NextResponse.json({ emails, count: emails.length, query: q });
        }
        const emails = db.getEmails(limit);
        return NextResponse.json({ emails, count: emails.length });
      }

      case "email": {
        const id = req.nextUrl.searchParams.get("id");
        if (!id) return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
        const email = db.getEmail(id);
        if (!email) return NextResponse.json({ error: "Email not found" }, { status: 404 });
        return NextResponse.json({ email });
      }

      case "files": {
        const source = req.nextUrl.searchParams.get("source");
        const allFiles = db.getFiles();
        const files = source ? allFiles.filter((f) => f.source === source) : allFiles;
        return NextResponse.json({ files, count: files.length });
      }

      case "search": {
        const q = req.nextUrl.searchParams.get("q");
        if (!q) return NextResponse.json({ error: "Missing q parameter" }, { status: 400 });
        const source = req.nextUrl.searchParams.get("source") || undefined;
        const files = db.searchFiles(q, { source });
        const emails = db.searchEmails(q);
        return NextResponse.json({ files, emails, filesCount: files.length, emailsCount: emails.length, query: q });
      }

      case "activity": {
        const limit = parseInt(req.nextUrl.searchParams.get("limit") || "20");
        const activity = db.getActivity(limit);
        return NextResponse.json({ activity, count: activity.length });
      }

      case "connections": {
        const connections = db.getAllConnections();
        return NextResponse.json(connections);
      }

      default:
        return NextResponse.json({
          error: `Unknown action: ${action}`,
          available: ["overview", "stats", "emails", "email", "files", "search", "activity", "connections"],
        }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal error" }, { status: 500 });
  }
}
