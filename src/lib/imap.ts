import { ImapFlow } from "imapflow";
import { simpleParser, ParsedMail } from "mailparser";
import type { SyncFile } from "./types";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export interface EmailFile extends SyncFile {
  content?: Buffer;
}

export async function fetchEmailAttachments(): Promise<EmailFile[]> {
  const host = process.env.IMAP_HOST || "imap.gmail.com";
  const port = Number(process.env.IMAP_PORT || "993");
  const user = process.env.IMAP_USER || "";
  const pass = process.env.IMAP_PASSWORD || "";

  if (!user || !pass) {
    throw new Error("IMAP credentials not configured");
  }

  const client = new ImapFlow({
    host,
    port,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  const files: EmailFile[] = [];

  try {
    await client.connect();

    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox;
      const totalMessages = mailbox ? Number(mailbox.exists) || 100 : 100;
      const messages = client.fetch(
        { seq: `${Math.max(1, totalMessages - 99)}:*` },
        {
          envelope: true,
          bodyStructure: true,
          uid: true,
          source: true,
        }
      );

      for await (const msg of messages) {
        if (!msg.source) continue;

        let parsed: ParsedMail;
        try {
          parsed = await simpleParser(msg.source);
        } catch {
          continue;
        }

        if (!parsed.attachments || parsed.attachments.length === 0) continue;

        const fromAddr = parsed.from?.value?.[0]?.address || "unknown";
        const subject = parsed.subject || "(no subject)";
        const date = parsed.date?.toISOString() || new Date().toISOString();

        for (const att of parsed.attachments) {
          if (!att.filename) continue;

          files.push({
            id: `email_${msg.uid}_${att.checksum || att.filename}`,
            name: att.filename,
            mimeType: att.contentType || "application/octet-stream",
            source: "email-gmail",
            date,
            size: att.size ? formatBytes(att.size) : undefined,
            sizeBytes: att.size || undefined,
            emailSubject: subject,
            emailFrom: fromAddr,
            content: Buffer.from(att.content),
          });
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    try { await client.logout(); } catch { /* ignore */ }
    throw err;
  }

  return files;
}
