import * as msal from "@azure/msal-node";

const msalConfig: msal.Configuration = {
  auth: {
    clientId: process.env.AZURE_CLIENT_ID || "",
    clientSecret: process.env.AZURE_CLIENT_SECRET || "",
    authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID || "common"}`,
  },
};

let msalClient: msal.ConfidentialClientApplication | null = null;

export function getMsalClient() {
  if (!msalClient) {
    msalClient = new msal.ConfidentialClientApplication(msalConfig);
  }
  return msalClient;
}

export function getAuthUrl() {
  const client = getMsalClient();
  return client.getAuthCodeUrl({
    scopes: ["Mail.Read", "Mail.ReadBasic"],
    redirectUri: process.env.AZURE_REDIRECT_URI || "",
  });
}

// In-memory token store (replace with DB in production)
let accessToken: string | null = null;

export function setAccessToken(token: string) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}
