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
    CREATE TABLE IF NOT EXISTS emails (
      id TEXT PRIMARY KEY,
      uid INTEGER,
      message_id TEXT,
      subject TEXT,
      from_address TEXT,
      from_name TEXT,
      to_addresses TEXT,
      cc_addresses TEXT,
      bcc_addresses TEXT,
      reply_to TEXT,
      date TEXT NOT NULL,
      body_text TEXT,
      body_html TEXT,
      headers TEXT,
      labels TEXT,
      has_attachments INTEGER DEFAULT 0,
      attachment_count INTEGER DEFAULT 0,
      raw_source BLOB,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      email_id TEXT REFERENCES emails(id),
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

    CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date);
    CREATE INDEX IF NOT EXISTS idx_emails_from ON emails(from_address);
    CREATE INDEX IF NOT EXISTS idx_emails_subject ON emails(subject);
    CREATE INDEX IF NOT EXISTS idx_files_source ON files(source);
    CREATE INDEX IF NOT EXISTS idx_files_date ON files(date);
    CREATE INDEX IF NOT EXISTS idx_files_starred ON files(starred);
    CREATE INDEX IF NOT EXISTS idx_files_name ON files(name);
    CREATE INDEX IF NOT EXISTS idx_files_email_id ON files(email_id);
    CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity(timestamp);

    CREATE TABLE IF NOT EXISTS file_index (
      file_id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
      category TEXT NOT NULL DEFAULT 'uncategorized',
      status TEXT NOT NULL DEFAULT 'pending',
      period TEXT,
      notes TEXT,
      vendor TEXT,
      amount TEXT,
      currency TEXT DEFAULT 'PHP',
      reference_no TEXT,
      auto_categorized INTEGER DEFAULT 0,
      indexed_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_file_index_category ON file_index(category);
    CREATE INDEX IF NOT EXISTS idx_file_index_status ON file_index(status);
    CREATE INDEX IF NOT EXISTS idx_file_index_period ON file_index(period);
    CREATE INDEX IF NOT EXISTS idx_file_index_vendor ON file_index(vendor);
  `);

  // Migration: add sheet_type, payment_method, needs_review columns if not present
  try { db.exec("ALTER TABLE file_index ADD COLUMN sheet_type TEXT"); } catch { /* exists */ }
  try { db.exec("ALTER TABLE file_index ADD COLUMN payment_method TEXT"); } catch { /* exists */ }
  try { db.exec("ALTER TABLE file_index ADD COLUMN needs_review INTEGER DEFAULT 0"); } catch { /* exists */ }
  try { db.exec("ALTER TABLE file_index ADD COLUMN review_notes TEXT"); } catch { /* exists */ }

  db.exec(`

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS google_tokens (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      tokens TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS pipeline_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      file_id TEXT,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      error TEXT,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_pipeline_log_run ON pipeline_log(run_id);
    CREATE INDEX IF NOT EXISTS idx_pipeline_log_file ON pipeline_log(file_id);
    CREATE INDEX IF NOT EXISTS idx_pipeline_log_created ON pipeline_log(created_at);

    CREATE TABLE IF NOT EXISTS chat_conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Chat',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id);

    CREATE TABLE IF NOT EXISTS data_cache (
      key TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_data_cache_source ON data_cache(source);

    CREATE TABLE IF NOT EXISTS wise_cache (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS xero_tokens (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      tokens TEXT NOT NULL,
      tenant_id TEXT,
      tenant_name TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Seed connections if empty
  const count = db.prepare("SELECT COUNT(*) as c FROM connections").get() as { c: number };
  if (count.c === 0) {
    const insert = db.prepare("INSERT INTO connections (source, connected) VALUES (?, 0)");
    insert.run("gdrive");
    insert.run("outlook");
    insert.run("gmail");
    insert.run("xero");
  }
}

// ===== Emails =====

export interface EmailRecord {
  id: string;
  uid?: number;
  messageId?: string;
  subject: string;
  fromAddress: string;
  fromName?: string;
  toAddresses: string;
  ccAddresses?: string;
  bccAddresses?: string;
  replyTo?: string;
  date: string;
  bodyText?: string;
  bodyHtml?: string;
  headers?: string;
  labels?: string;
  hasAttachments: boolean;
  attachmentCount: number;
  rawSource?: Buffer;
}

export function upsertEmail(email: EmailRecord) {
  getDb().prepare(`
    INSERT INTO emails (id, uid, message_id, subject, from_address, from_name, to_addresses, cc_addresses, bcc_addresses, reply_to, date, body_text, body_html, headers, labels, has_attachments, attachment_count, raw_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      subject = excluded.subject,
      from_address = excluded.from_address,
      from_name = excluded.from_name,
      to_addresses = excluded.to_addresses,
      cc_addresses = excluded.cc_addresses,
      bcc_addresses = excluded.bcc_addresses,
      reply_to = excluded.reply_to,
      body_text = excluded.body_text,
      body_html = excluded.body_html,
      headers = excluded.headers,
      labels = excluded.labels,
      has_attachments = excluded.has_attachments,
      attachment_count = excluded.attachment_count,
      raw_source = CASE WHEN excluded.raw_source IS NOT NULL THEN excluded.raw_source ELSE emails.raw_source END
  `).run(
    email.id,
    email.uid || null,
    email.messageId || null,
    email.subject,
    email.fromAddress,
    email.fromName || null,
    email.toAddresses,
    email.ccAddresses || null,
    email.bccAddresses || null,
    email.replyTo || null,
    email.date,
    email.bodyText || null,
    email.bodyHtml || null,
    email.headers || null,
    email.labels || null,
    email.hasAttachments ? 1 : 0,
    email.attachmentCount,
    email.rawSource || null
  );
}

export function getEmails(limit = 100): DbEmail[] {
  return getDb()
    .prepare("SELECT id, uid, message_id, subject, from_address, from_name, to_addresses, cc_addresses, bcc_addresses, reply_to, date, body_text, body_html, has_attachments, attachment_count, created_at FROM emails ORDER BY date DESC LIMIT ?")
    .all(limit) as DbEmail[];
}

export function getEmail(id: string): DbEmail | undefined {
  return getDb()
    .prepare("SELECT * FROM emails WHERE id = ?")
    .get(id) as DbEmail | undefined;
}

export function getEmailCount(): number {
  return (getDb().prepare("SELECT COUNT(*) as c FROM emails").get() as { c: number }).c;
}

export function getEmailBodyForFile(fileId: string): string | null {
  const row = getDb().prepare(
    "SELECT e.body_text FROM emails e JOIN files f ON f.email_id = e.id WHERE f.id = ?"
  ).get(fileId) as { body_text: string | null } | undefined;
  return row?.body_text || null;
}

export function searchEmails(query: string): DbEmail[] {
  const q = `%${query}%`;
  return getDb()
    .prepare("SELECT id, uid, message_id, subject, from_address, from_name, to_addresses, cc_addresses, date, body_text, has_attachments, attachment_count, created_at FROM emails WHERE subject LIKE ? OR from_address LIKE ? OR to_addresses LIKE ? OR body_text LIKE ? ORDER BY date DESC LIMIT 100")
    .all(q, q, q, q) as DbEmail[];
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

export function upsertFiles(files: (SyncFile & { content?: Buffer; emailId?: string })[]): { added: number; updated: number } {
  const d = getDb();
  let added = 0;
  let updated = 0;

  const upsert = d.prepare(`
    INSERT INTO files (id, email_id, name, mime_type, source, date, size, size_bytes, download_url, preview_url, folder, email_subject, email_from, tags, has_content, content, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      email_id = excluded.email_id,
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
        (f as { emailId?: string }).emailId || null,
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

export interface DbEmail {
  id: string;
  uid: number | null;
  message_id: string | null;
  subject: string;
  from_address: string;
  from_name: string | null;
  to_addresses: string;
  cc_addresses: string | null;
  bcc_addresses: string | null;
  reply_to: string | null;
  date: string;
  body_text: string | null;
  body_html: string | null;
  headers: string | null;
  labels: string | null;
  has_attachments: number;
  attachment_count: number;
  raw_source: Buffer | null;
  created_at: string;
}

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

// ===== File Index (Accounting) =====

export interface FileIndexRecord {
  file_id: string;
  category: string;
  status: string;
  period: string | null;
  notes: string | null;
  vendor: string | null;
  amount: string | null;
  currency: string;
  reference_no: string | null;
  auto_categorized: number;
  indexed_at: string;
  updated_at: string;
}

export interface IndexedFile extends SyncFile {
  category: string;
  accountingStatus: string;
  period: string | null;
  notes: string | null;
  vendor: string | null;
  amount: string | null;
  currency: string;
  referenceNo: string | null;
  autoCategorized: boolean;
  sheetType?: string | null;
  paymentMethod?: string | null;
  needsReview?: boolean;
  reviewNotes?: string | null;
}

export function upsertFileIndex(entry: {
  fileId: string;
  category: string;
  status?: string;
  period?: string;
  notes?: string;
  vendor?: string;
  amount?: string;
  currency?: string;
  referenceNo?: string;
  autoCategorized?: boolean;
}) {
  getDb().prepare(`
    INSERT INTO file_index (file_id, category, status, period, notes, vendor, amount, currency, reference_no, auto_categorized, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(file_id) DO UPDATE SET
      category = excluded.category,
      status = CASE WHEN excluded.status != 'pending' THEN excluded.status ELSE file_index.status END,
      period = COALESCE(excluded.period, file_index.period),
      notes = COALESCE(excluded.notes, file_index.notes),
      vendor = COALESCE(excluded.vendor, file_index.vendor),
      amount = COALESCE(excluded.amount, file_index.amount),
      currency = COALESCE(excluded.currency, file_index.currency),
      reference_no = COALESCE(excluded.reference_no, file_index.reference_no),
      auto_categorized = excluded.auto_categorized,
      updated_at = datetime('now')
  `).run(
    entry.fileId,
    entry.category,
    entry.status || "pending",
    entry.period || null,
    entry.notes || null,
    entry.vendor || null,
    entry.amount || null,
    entry.currency || "PHP",
    entry.referenceNo || null,
    entry.autoCategorized ? 1 : 0
  );
}

export function updateFileIndex(fileId: string, updates: Partial<{
  category: string;
  status: string;
  period: string;
  notes: string;
  vendor: string;
  amount: string;
  currency: string;
  referenceNo: string;
  sheetType: string;
  paymentMethod: string;
  needsReview: boolean;
  reviewNotes: string;
}>) {
  const d = getDb();
  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.category !== undefined) { sets.push("category = ?"); params.push(updates.category); }
  if (updates.status !== undefined) { sets.push("status = ?"); params.push(updates.status); }
  if (updates.period !== undefined) { sets.push("period = ?"); params.push(updates.period); }
  if (updates.notes !== undefined) { sets.push("notes = ?"); params.push(updates.notes); }
  if (updates.vendor !== undefined) { sets.push("vendor = ?"); params.push(updates.vendor); }
  if (updates.amount !== undefined) { sets.push("amount = ?"); params.push(updates.amount); }
  if (updates.currency !== undefined) { sets.push("currency = ?"); params.push(updates.currency); }
  if (updates.referenceNo !== undefined) { sets.push("reference_no = ?"); params.push(updates.referenceNo); }
  if (updates.sheetType !== undefined) { sets.push("sheet_type = ?"); params.push(updates.sheetType); }
  if (updates.paymentMethod !== undefined) { sets.push("payment_method = ?"); params.push(updates.paymentMethod); }
  if (updates.needsReview !== undefined) { sets.push("needs_review = ?"); params.push(updates.needsReview ? 1 : 0); }
  if (updates.reviewNotes !== undefined) { sets.push("review_notes = ?"); params.push(updates.reviewNotes); }

  if (sets.length === 0) return;
  sets.push("updated_at = datetime('now')");
  params.push(fileId);

  d.prepare(`UPDATE file_index SET ${sets.join(", ")} WHERE file_id = ?`).run(...params);
}

export function getFileIndex(fileId: string): FileIndexRecord | undefined {
  return getDb().prepare("SELECT * FROM file_index WHERE file_id = ?").get(fileId) as FileIndexRecord | undefined;
}

export function getIndexedFiles(filters?: {
  category?: string;
  status?: string;
  period?: string;
  vendor?: string;
  search?: string;
}): IndexedFile[] {
  let sql = `
    SELECT f.*, fi.category, fi.status as accounting_status, fi.period, fi.notes,
           fi.vendor, fi.amount, fi.currency, fi.reference_no, fi.auto_categorized,
           fi.sheet_type, fi.payment_method, fi.needs_review, fi.review_notes
    FROM files f
    LEFT JOIN file_index fi ON f.id = fi.file_id
    WHERE 1=1
  `;
  const params: string[] = [];

  if (filters?.category && filters.category !== "all") {
    if (filters.category === "uncategorized") {
      sql += " AND (fi.category IS NULL OR fi.category = 'uncategorized')";
    } else {
      sql += " AND fi.category = ?";
      params.push(filters.category);
    }
  }
  if (filters?.status && filters.status !== "all") {
    sql += " AND fi.status = ?";
    params.push(filters.status);
  }
  if (filters?.period) {
    sql += " AND fi.period = ?";
    params.push(filters.period);
  }
  if (filters?.vendor) {
    sql += " AND fi.vendor LIKE ?";
    params.push(`%${filters.vendor}%`);
  }
  if (filters?.search) {
    sql += " AND (f.name LIKE ? OR f.email_subject LIKE ? OR f.email_from LIKE ? OR fi.notes LIKE ? OR fi.vendor LIKE ?)";
    const q = `%${filters.search}%`;
    params.push(q, q, q, q, q);
  }

  sql += " ORDER BY f.date DESC";

  const rows = getDb().prepare(sql).all(...params) as (DbFile & {
    category: string | null;
    accounting_status: string | null;
    period: string | null;
    notes: string | null;
    vendor: string | null;
    amount: string | null;
    currency: string | null;
    reference_no: string | null;
    auto_categorized: number | null;
    sheet_type: string | null;
    payment_method: string | null;
    needs_review: number | null;
    review_notes: string | null;
  })[];

  return rows.map((row) => ({
    ...rowToFile(row),
    category: row.category || "uncategorized",
    accountingStatus: row.accounting_status || "pending",
    period: row.period,
    notes: row.notes,
    vendor: row.vendor,
    amount: row.amount,
    currency: row.currency || "PHP",
    referenceNo: row.reference_no,
    autoCategorized: row.auto_categorized === 1,
    sheetType: row.sheet_type,
    paymentMethod: row.payment_method,
    needsReview: row.needs_review === 1,
    reviewNotes: row.review_notes,
  }));
}

export function getAccountingSummary(): {
  byCategory: { category: string; count: number }[];
  byStatus: { status: string; count: number }[];
  byPeriod: { period: string; count: number }[];
  totalIndexed: number;
  totalUnindexed: number;
} {
  const d = getDb();

  const byCategory = d.prepare(`
    SELECT COALESCE(fi.category, 'uncategorized') as category, COUNT(*) as count
    FROM files f LEFT JOIN file_index fi ON f.id = fi.file_id
    GROUP BY COALESCE(fi.category, 'uncategorized')
    ORDER BY count DESC
  `).all() as { category: string; count: number }[];

  const byStatus = d.prepare(`
    SELECT COALESCE(fi.status, 'pending') as status, COUNT(*) as count
    FROM files f LEFT JOIN file_index fi ON f.id = fi.file_id
    GROUP BY COALESCE(fi.status, 'pending')
    ORDER BY count DESC
  `).all() as { status: string; count: number }[];

  const byPeriod = d.prepare(`
    SELECT COALESCE(fi.period, strftime('%Y-%m', f.date)) as period, COUNT(*) as count
    FROM files f LEFT JOIN file_index fi ON f.id = fi.file_id
    GROUP BY COALESCE(fi.period, strftime('%Y-%m', f.date))
    ORDER BY period DESC
  `).all() as { period: string; count: number }[];

  const totalIndexed = (d.prepare("SELECT COUNT(*) as c FROM file_index WHERE category != 'uncategorized'").get() as { c: number }).c;
  const totalFiles = (d.prepare("SELECT COUNT(*) as c FROM files").get() as { c: number }).c;

  return { byCategory, byStatus, byPeriod, totalIndexed, totalUnindexed: totalFiles - totalIndexed };
}

// ===== Settings =====

export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value || null;
}

export function setSetting(key: string, value: string) {
  getDb().prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')"
  ).run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const result: Record<string, string> = {};
  for (const row of rows) result[row.key] = row.value;
  return result;
}

// ===== Google Tokens (persistent) =====

export function saveGoogleTokens(tokens: Record<string, unknown>) {
  getDb().prepare(
    "INSERT INTO google_tokens (id, tokens, updated_at) VALUES (1, ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET tokens = excluded.tokens, updated_at = datetime('now')"
  ).run(JSON.stringify(tokens));
}

export function loadGoogleTokens(): Record<string, unknown> | null {
  const row = getDb().prepare("SELECT tokens FROM google_tokens WHERE id = 1").get() as { tokens: string } | undefined;
  if (!row) return null;
  try { return JSON.parse(row.tokens); } catch { return null; }
}

export function clearGoogleTokens() {
  getDb().prepare("DELETE FROM google_tokens WHERE id = 1").run();
}

// ===== Xero Tokens (persistent) =====

export function saveXeroTokens(tokens: Record<string, unknown>, tenantId?: string, tenantName?: string) {
  getDb().prepare(
    `INSERT INTO xero_tokens (id, tokens, tenant_id, tenant_name, updated_at)
     VALUES (1, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       tokens = excluded.tokens,
       tenant_id = COALESCE(excluded.tenant_id, xero_tokens.tenant_id),
       tenant_name = COALESCE(excluded.tenant_name, xero_tokens.tenant_name),
       updated_at = datetime('now')`
  ).run(JSON.stringify(tokens), tenantId || null, tenantName || null);
}

export function loadXeroTokens(): { tokens: Record<string, unknown>; tenantId: string | null; tenantName: string | null } | null {
  const row = getDb().prepare("SELECT tokens, tenant_id, tenant_name FROM xero_tokens WHERE id = 1").get() as {
    tokens: string; tenant_id: string | null; tenant_name: string | null;
  } | undefined;
  if (!row) return null;
  try {
    return { tokens: JSON.parse(row.tokens), tenantId: row.tenant_id, tenantName: row.tenant_name };
  } catch { return null; }
}

export function clearXeroTokens() {
  getDb().prepare("DELETE FROM xero_tokens WHERE id = 1").run();
}

// ===== Wise Cache =====

export function setWiseCache(key: string, data: unknown) {
  getDb().prepare(
    "INSERT INTO wise_cache (key, data, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = datetime('now')"
  ).run(key, JSON.stringify(data));
}

export function getWiseCache(key: string): { data: unknown; updatedAt: string } | null {
  const row = getDb().prepare("SELECT data, updated_at FROM wise_cache WHERE key = ?").get(key) as { data: string; updated_at: string } | undefined;
  if (!row) return null;
  try { return { data: JSON.parse(row.data), updatedAt: row.updated_at }; } catch { return null; }
}

export function getWiseCacheAge(key: string): number | null {
  const row = getDb().prepare("SELECT updated_at FROM wise_cache WHERE key = ?").get(key) as { updated_at: string } | undefined;
  if (!row) return null;
  return Date.now() - new Date(row.updated_at).getTime();
}

// ===== Pipeline Log =====

export function logPipeline(entry: { runId: string; fileId?: string; action: string; status: string; result?: string; error?: string; details?: string }) {
  getDb().prepare(
    "INSERT INTO pipeline_log (run_id, file_id, action, status, result, error, details) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(entry.runId, entry.fileId || null, entry.action, entry.status, entry.result || null, entry.error || null, entry.details || null);
}

export function getPipelineRuns(limit = 20): { runId: string; startedAt: string; actions: number; succeeded: number; failed: number; lastAction: string }[] {
  return getDb().prepare(`
    SELECT run_id as runId,
      MIN(created_at) as startedAt,
      COUNT(*) as actions,
      SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as succeeded,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as failed,
      MAX(action) as lastAction
    FROM pipeline_log
    GROUP BY run_id
    ORDER BY MIN(created_at) DESC
    LIMIT ?
  `).all(limit) as { runId: string; startedAt: string; actions: number; succeeded: number; failed: number; lastAction: string }[];
}

export function getPipelineLogs(filters?: { runId?: string; fileId?: string; action?: string; limit?: number }): {
  id: number; run_id: string; file_id: string | null; action: string; status: string; result: string | null; error: string | null; details: string | null; created_at: string;
}[] {
  let sql = "SELECT * FROM pipeline_log WHERE 1=1";
  const params: (string | number)[] = [];
  if (filters?.runId) { sql += " AND run_id = ?"; params.push(filters.runId); }
  if (filters?.fileId) { sql += " AND file_id = ?"; params.push(filters.fileId); }
  if (filters?.action) { sql += " AND action = ?"; params.push(filters.action); }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(filters?.limit || 100);
  return getDb().prepare(sql).all(...params) as ReturnType<typeof getPipelineLogs>;
}

export function getFileRecordingStatus(fileId: string): string {
  const row = getDb().prepare(
    "SELECT status FROM pipeline_log WHERE file_id = ? AND action = 'record' ORDER BY created_at DESC LIMIT 1"
  ).get(fileId) as { status: string } | undefined;
  return row?.status || "pending";
}

export function getUnrecordedFiles(): IndexedFile[] {
  // Files that have been categorized but not yet recorded to sheets
  const recorded = getDb().prepare(
    "SELECT DISTINCT file_id FROM pipeline_log WHERE action = 'record' AND status IN ('success', 'duplicate', 'skipped')"
  ).all() as { file_id: string }[];
  const recordedIds = new Set(recorded.map(r => r.file_id));

  const all = getIndexedFiles({});
  return all.filter(f => !recordedIds.has(f.id));
}

// ===== Chat Conversations =====

export interface ChatConversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
  last_message?: string;
}

export interface ChatMessage {
  id: number;
  conversation_id: string;
  role: string;
  content: string;
  model: string | null;
  created_at: string;
}

export function createConversation(id: string, title?: string): ChatConversation {
  getDb().prepare(
    "INSERT INTO chat_conversations (id, title) VALUES (?, ?)"
  ).run(id, title || "New Chat");
  return getDb().prepare("SELECT * FROM chat_conversations WHERE id = ?").get(id) as ChatConversation;
}

export function getConversations(limit = 50): ChatConversation[] {
  return getDb().prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id) as message_count,
      (SELECT m.content FROM chat_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) as last_message
    FROM chat_conversations c
    ORDER BY c.updated_at DESC
    LIMIT ?
  `).all(limit) as ChatConversation[];
}

export function getConversation(id: string): ChatConversation | undefined {
  return getDb().prepare("SELECT * FROM chat_conversations WHERE id = ?").get(id) as ChatConversation | undefined;
}

export function updateConversationTitle(id: string, title: string) {
  getDb().prepare("UPDATE chat_conversations SET title = ?, updated_at = datetime('now') WHERE id = ?").run(title, id);
}

export function deleteConversation(id: string) {
  getDb().prepare("DELETE FROM chat_conversations WHERE id = ?").run(id);
}

export function addChatMessage(conversationId: string, role: string, content: string, model?: string) {
  getDb().prepare(
    "INSERT INTO chat_messages (conversation_id, role, content, model) VALUES (?, ?, ?, ?)"
  ).run(conversationId, role, content, model || null);
  getDb().prepare("UPDATE chat_conversations SET updated_at = datetime('now') WHERE id = ?").run(conversationId);
}

export function getChatMessages(conversationId: string): ChatMessage[] {
  return getDb().prepare(
    "SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY id ASC"
  ).all(conversationId) as ChatMessage[];
}

// ===== Generic Data Cache (Xero, etc.) =====

export function setDataCache(source: string, key: string, data: unknown) {
  const fullKey = `${source}:${key}`;
  getDb().prepare(
    "INSERT INTO data_cache (key, source, data, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = datetime('now')"
  ).run(fullKey, source, JSON.stringify(data));
}

export function getDataCache(source: string, key: string): { data: unknown; updatedAt: string } | null {
  const fullKey = `${source}:${key}`;
  const row = getDb().prepare("SELECT data, updated_at FROM data_cache WHERE key = ?").get(fullKey) as { data: string; updated_at: string } | undefined;
  if (!row) return null;
  try { return { data: JSON.parse(row.data), updatedAt: row.updated_at }; } catch { return null; }
}

export function getAllDataCacheForSource(source: string): Record<string, { data: unknown; updatedAt: string }> {
  const rows = getDb().prepare("SELECT key, data, updated_at FROM data_cache WHERE source = ?").all(source) as { key: string; data: string; updated_at: string }[];
  const result: Record<string, { data: unknown; updatedAt: string }> = {};
  const prefix = `${source}:`;
  for (const row of rows) {
    const shortKey = row.key.startsWith(prefix) ? row.key.slice(prefix.length) : row.key;
    try { result[shortKey] = { data: JSON.parse(row.data), updatedAt: row.updated_at }; } catch { /* skip */ }
  }
  return result;
}

export function getAllWiseCache(): Record<string, { data: unknown; updatedAt: string }> {
  const rows = getDb().prepare("SELECT key, data, updated_at FROM wise_cache").all() as { key: string; data: string; updated_at: string }[];
  const result: Record<string, { data: unknown; updatedAt: string }> = {};
  for (const row of rows) {
    try { result[row.key] = { data: JSON.parse(row.data), updatedAt: row.updated_at }; } catch { /* skip */ }
  }
  return result;
}

// ===== Helpers =====

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
