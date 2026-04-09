import { google } from "googleapis";
import { saveGoogleTokens, loadGoogleTokens, clearGoogleTokens } from "./db";

export function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl() {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: [
      // Full drive access — needed to upload receipt PDFs into the
      // Credit Card / Reimbursement / Supplier folders for organization.
      // Was previously drive.readonly but we now write files to Drive.
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/spreadsheets",
    ],
    prompt: "consent",
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setTokens(t: Record<string, any> | null) {
  if (t) {
    saveGoogleTokens(t);
  } else {
    clearGoogleTokens();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getTokens(): Record<string, any> | null {
  return loadGoogleTokens();
}

export function getAuthenticatedClient() {
  const client = getOAuth2Client();
  const tokens = getTokens();
  if (!tokens) throw new Error("Not authenticated with Google");
  client.setCredentials(tokens);
  return client;
}

/**
 * Extract a Google Drive folder ID from a URL or raw ID.
 * Supports:
 *   - https://drive.google.com/drive/folders/FOLDER_ID
 *   - https://drive.google.com/drive/u/0/folders/FOLDER_ID
 *   - Raw folder ID string
 */
export function extractFolderId(input: string): string {
  const trimmed = input.trim();
  // Match folder ID from URL
  const match = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  // If it looks like a raw ID (no slashes, no spaces)
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return trimmed;
  return trimmed;
}
