import { google } from "googleapis";

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
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/gmail.readonly",
    ],
    prompt: "consent",
  });
}

// In-memory token store (replace with DB in production)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let tokens: Record<string, any> | null = null;

export function setTokens(t: typeof tokens) {
  tokens = t;
}

export function getTokens() {
  return tokens;
}

export function getAuthenticatedClient() {
  const client = getOAuth2Client();
  if (!tokens) throw new Error("Not authenticated with Google");
  client.setCredentials(tokens);
  return client;
}
