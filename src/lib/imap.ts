import { ImapFlow } from "imapflow";
import { simpleParser, ParsedMail } from "mailparser";
import type { SyncFile } from "./types";
import * as db from "./db";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export interface EmailFile extends SyncFile {
  content?: Buffer;
  emailId?: string;
}

function addressesToString(addrs: { value: Array<{ address?: string; name?: string }> } | undefined): string {
  if (!addrs?.value) return "";
  return addrs.value.map((a) => a.address ? (a.name ? `${a.name} <${a.address}>` : a.address) : a.name || "").filter(Boolean).join(", ");
}

function headersToJson(headers: Map<string, string> | undefined): string | undefined {
  if (!headers) return undefined;
  const obj: Record<string, string> = {};
  headers.forEach((value, key) => { obj[key] = value; });
  return JSON.stringify(obj);
}

export async function fetchEmailAttachments(): Promise<{ files: EmailFile[]; emailCount: number }> {
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
  let emailCount = 0;

  try {
    await client.connect();

    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox;
      const totalMessages = mailbox ? Number(mailbox.exists) || 100 : 100;
      const messages = client.fetch(
        { seq: `1:*` },
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

        emailCount++;

        const fromAddr = parsed.from?.value?.[0]?.address || "unknown";
        const fromName = parsed.from?.value?.[0]?.name || undefined;
        const subject = parsed.subject || "(no subject)";
        const date = parsed.date?.toISOString() || new Date().toISOString();
        const emailId = `email_${msg.uid}`;

        // Store full email in DB
        db.upsertEmail({
          id: emailId,
          uid: msg.uid,
          messageId: parsed.messageId || undefined,
          subject,
          fromAddress: fromAddr,
          fromName,
          toAddresses: addressesToString(parsed.to as { value: Array<{ address?: string; name?: string }> }),
          ccAddresses: addressesToString(parsed.cc as { value: Array<{ address?: string; name?: string }> }) || undefined,
          bccAddresses: addressesToString(parsed.bcc as { value: Array<{ address?: string; name?: string }> }) || undefined,
          replyTo: addressesToString(parsed.replyTo as { value: Array<{ address?: string; name?: string }> }) || undefined,
          date,
          bodyText: parsed.text || undefined,
          bodyHtml: parsed.html || undefined,
          headers: headersToJson(parsed.headers as unknown as Map<string, string>),
          hasAttachments: (parsed.attachments?.length || 0) > 0,
          attachmentCount: parsed.attachments?.length || 0,
          rawSource: Buffer.from(msg.source),
        });

        // Store attachments
        if (parsed.attachments && parsed.attachments.length > 0) {
          for (const att of parsed.attachments) {
            if (!att.filename) continue;

            files.push({
              id: `email_${msg.uid}_${att.checksum || att.filename}`,
              emailId,
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
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    try { await client.logout(); } catch { /* ignore */ }
    throw err;
  }

  return { files, emailCount };
}
