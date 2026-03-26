import Database from "better-sqlite3";
import path from "path";
import type { SyncFile, ActivityEntry, ConnectionStatus } from "./types";

const DB_PATH = path.join(process.cwd(), "data", "accounting.db");

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    // Ensure data directory exists
    const fs = require("fs");
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      source TEXT NOT NULL,
      date TEXT NOT NULL,
      size TEXT,
      size_bytes INTEGER DEFAULT 0,
      download_url TEXT,
      preview_url TEXT,
      starred INTEGER DEFAULT 0,
      folder TEXT,
      email_subject TEXT,
      email_from TEXT,
      tags TEXT,
      has_content INTEGER DEFAULT 0,
      content BLOB,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      source TEXT NOT NULL,
      details TEXT NOT NULL,
      file_count INTEGER,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS connections (
      source TEXT PRIMARY KEY,
      connected INTEGER DEFAULT 0,
      email TEXT,
      last_sync TEXT,
      file_count INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_files_source ON files(source);
    CREATE INDEX IF NOT EXISTS idx_files_date ON files(date);
    CREATE INDEX IF NOT EXISTS idx_files_starred ON files(starred);
    CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
    CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity(timestamp);
  `);

  // Seed connections if empty
  const count = db.prepare("SELECT COUNT(*) as c FROM connections").get() as { c: number };
  if (count.c === 0) {
    const insert = db.prepare("INSERT INTO connections (source, connected) VALUES (?, 0)");
    insert.run("gdrive");
    insert.run("outlook");
    insert.run("gmail");
  }
}

// ===== Files =====

export function getFiles(): SyncFile[] {
  const rows = getDb()
    .prepare("SELECT * FROM files ORDER BY date DESC")
    .all() as DbFile[];
  return rows.map(rowToFile);
}

export function getFile(id: string): SyncFile | undefined {
  const row = getDb()
    .prepare("SELECT * FROM files WHERE id = ?")
    .get(id) as DbFile | undefined;
  return row ? rowToFile(row) : undefined;
}

export function getFileContent(id: string): { content: Buffer; name: string; mimeType: string } | null {
  const row = getDb()
    .prepare("SELECT content, name, mime_type FROM files WHERE id = ? AND has_content = 1")
    .get(id) as { content: Buffer; name: string; mime_type: string } | undefined;
  if (!row || !row.content) return null;
  return { content: row.content, name: row.name, mimeType: row.mime_type };
}

export function upsertFiles(files: (SyncFile & { content?: Buffer })[]): { added: number; updated: number } {
  const d = getDb();
  let added = 0;
  let updated = 0;

  const upsert = d.prepare(`
    INSERT INTO files (id, name, mime_type, source, date, size, size_bytes, download_url, preview_url, folder, email_subject, email_from, tags, has_content, content, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      mime_type = excluded.mime_type,
      date = excluded.date,
      size = excluded.size,
      size_bytes = excluded.size_bytes,
      download_url = excluded.download_url,
      preview_url = excluded.preview_url,
      folder = excluded.folder,
      email_subject = excluded.email_subject,
      email_from = excluded.email_from,
      has_content = CASE WHEN excluded.has_content = 1 THEN 1 ELSE files.has_content END,
      content = CASE WHEN excluded.has_content = 1 THEN excluded.content ELSE files.content END,
      updated_at = datetime('now')
  `);

  const check = d.prepare("SELECT id FROM files WHERE id = ?");

  const tx = d.transaction(() => {
    for (const f of files) {
      const exists = check.get(f.id);
      if (exists) updated++;
      else added++;

      upsert.run(
        f.id,
        f.name,
        f.mimeType,
        f.source,
        f.date,
        f.size || null,
        f.sizeBytes || 0,
        f.downloadUrl || null,
        f.previewUrl || null,
        f.folder || null,
        f.emailSubject || null,
        f.emailFrom || null,
        f.tags ? JSON.stringify(f.tags) : null,
        f.content ? 1 : 0,
        f.content || null
      );
    }
  });

  tx();
  return { added, updated };
}

export function deleteFile(id: string): boolean {
  const result = getDb().prepare("DELETE FROM files WHERE id = ?").run(id);
  return result.changes > 0;
}

export function toggleStar(id: string): boolean {
  const d = getDb();
  d.prepare("UPDATE files SET starred = CASE WHEN starred = 1 THEN 0 ELSE 1 END WHERE id = ?").run(id);
  const row = d.prepare("SELECT starred FROM files WHERE id = ?").get(id) as { starred: number } | undefined;
  return row?.starred === 1;
}

export function getStarredFiles(): SyncFile[] {
  const rows = getDb()
    .prepare("SELECT * FROM files WHERE starred = 1 ORDER BY date DESC")
    .all() as DbFile[];
  return rows.map(rowToFile);
}

export function searchFiles(query: string, filters?: { source?: string; mimeType?: string; dateFrom?: string; dateTo?: string }): SyncFile[] {
  let sql = "SELECT * FROM files WHERE 1=1";
  const params: string[] = [];

  if (query) {
    sql += " AND (name LIKE ? OR email_subject LIKE ? OR email_from LIKE ? OR folder LIKE ?)";
    const q = `%${query}%`;
    params.push(q, q, q, q);
  }
  if (filters?.source) {
    sql += " AND source = ?";
    params.push(filters.source);
  }
  if (filters?.dateFrom) {
    sql += " AND date >= ?";
    params.push(filters.dateFrom);
  }
  if (filters?.dateTo) {
    sql += " AND date <= ?";
    params.push(filters.dateTo);
  }

  sql += " ORDER BY date DESC";

  const rows = getDb().prepare(sql).all(...params) as DbFile[];
  return rows.map(rowToFile);
}

// ===== Activity =====

export function addActivity(entry: Omit<ActivityEntry, "id" | "timestamp">) {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  getDb().prepare(
    "INSERT INTO activity (id, action, source, details, file_count, timestamp) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, entry.action, entry.source, entry.details, entry.fileCount || null, timestamp);
}

export function getActivity(limit = 50): ActivityEntry[] {
  return getDb()
    .prepare("SELECT * FROM activity ORDER BY timestamp DESC LIMIT ?")
    .all(limit) as ActivityEntry[];
}

// ===== Connections =====

export function getConnection(source: string): ConnectionStatus {
  const row = getDb().prepare("SELECT * FROM connections WHERE source = ?").get(source) as DbConnection | undefined;
  if (!row) return { connected: false };
  return { connected: row.connected === 1, email: row.email || undefined, lastSync: row.last_sync || undefined, fileCount: row.file_count || undefined };
}

export function getAllConnections(): Record<string, ConnectionStatus> {
  const rows = getDb().prepare("SELECT * FROM connections").all() as DbConnection[];
  const result: Record<string, ConnectionStatus> = {};
  for (const row of rows) {
    result[row.source] = { connected: row.connected === 1, email: row.email || undefined, lastSync: row.last_sync || undefined, fileCount: row.file_count || undefined };
  }
  return result;
}

export function setConnection(source: string, status: Partial<ConnectionStatus>) {
  const d = getDb();
  const existing = d.prepare("SELECT * FROM connections WHERE source = ?").get(source);
  if (existing) {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if (status.connected !== undefined) { sets.push("connected = ?"); params.push(status.connected ? 1 : 0); }
    if (status.email !== undefined) { sets.push("email = ?"); params.push(status.email); }
    if (status.lastSync !== undefined) { sets.push("last_sync = ?"); params.push(status.lastSync); }
    if (status.fileCount !== undefined) { sets.push("file_count = ?"); params.push(status.fileCount); }
    if (sets.length > 0) {
      params.push(source);
      d.prepare(`UPDATE connections SET ${sets.join(", ")} WHERE source = ?`).run(...params);
    }
  } else {
    d.prepare("INSERT INTO connections (source, connected, email, last_sync, file_count) VALUES (?, ?, ?, ?, ?)").run(
      source, status.connected ? 1 : 0, status.email || null, status.lastSync || null, status.fileCount || 0
    );
  }
}

// ===== Stats =====

export function getStats() {
  const d = getDb();
  const totalFiles = (d.prepare("SELECT COUNT(*) as c FROM files").get() as { c: number }).c;
  const totalSize = (d.prepare("SELECT COALESCE(SUM(size_bytes), 0) as s FROM files").get() as { s: number }).s;
  const gdriveFiles = (d.prepare("SELECT COUNT(*) as c FROM files WHERE source = 'gdrive'").get() as { c: number }).c;
  const outlookFiles = (d.prepare("SELECT COUNT(*) as c FROM files WHERE source = 'email-outlook'").get() as { c: number }).c;
  const gmailFiles = (d.prepare("SELECT COUNT(*) as c FROM files WHERE source = 'email-gmail'").get() as { c: number }).c;
  const starredFiles = (d.prepare("SELECT COUNT(*) as c FROM files WHERE starred = 1").get() as { c: number }).c;
  const recentRows = d.prepare("SELECT * FROM files ORDER BY date DESC LIMIT 5").all() as DbFile[];

  return {
    totalFiles,
    totalSize: formatBytes(totalSize),
    gdriveFiles,
    outlookFiles,
    gmailFiles,
    starredFiles,
    recentFiles: recentRows.map(rowToFile),
  };
}

// ===== Helpers =====

interface DbFile {
  id: string;
  name: string;
  mime_type: string;
  source: string;
  date: string;
  size: string | null;
  size_bytes: number;
  download_url: string | null;
  preview_url: string | null;
  starred: number;
  folder: string | null;
  email_subject: string | null;
  email_from: string | null;
  tags: string | null;
  has_content: number;
}

interface DbConnection {
  source: string;
  connected: number;
  email: string | null;
  last_sync: string | null;
  file_count: number;
}

function rowToFile(row: DbFile): SyncFile {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mime_type,
    source: row.source as SyncFile["source"],
    date: row.date,
    size: row.size || undefined,
    sizeBytes: row.size_bytes || undefined,
    downloadUrl: row.has_content ? `/api/files/${encodeURIComponent(row.id)}/download` : (row.download_url || undefined),
    previewUrl: row.preview_url || undefined,
    starred: row.starred === 1,
    folder: row.folder || undefined,
    emailSubject: row.email_subject || undefined,
    emailFrom: row.email_from || undefined,
    tags: row.tags ? JSON.parse(row.tags) : undefined,
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
