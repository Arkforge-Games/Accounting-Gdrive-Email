import { saveXeroTokens, loadXeroTokens, clearXeroTokens, setConnection } from "./db";

const XERO_CLIENT_ID = process.env.XERO_CLIENT_ID || "";
const XERO_CLIENT_SECRET = process.env.XERO_CLIENT_SECRET || "";
const XERO_REDIRECT_URI = process.env.XERO_REDIRECT_URI || "";

const XERO_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "accounting.transactions.read",
  "accounting.contacts.read",
  "accounting.settings.read",
  "accounting.attachments.read",
].join(" ");

const AUTH_URL = "https://login.xero.com/identity/connect/authorize";
const TOKEN_URL = "https://identity.xero.com/connect/token";
const API_BASE = "https://api.xero.com/api.xro/2.0";
const CONNECTIONS_URL = "https://api.xero.com/connections";

// ===== OAuth2 Flow =====

export function getXeroAuthUrl(state?: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: XERO_CLIENT_ID,
    redirect_uri: XERO_REDIRECT_URI,
    scope: XERO_SCOPES,
    state: state || crypto.randomUUID(),
  });
  return `${AUTH_URL}?${params}`;
}

export async function exchangeXeroCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tenantId: string;
  tenantName: string;
}> {
  // Exchange authorization code for tokens
  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: XERO_REDIRECT_URI,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Xero token exchange failed: ${tokenRes.status} ${err}`);
  }

  const tokens = await tokenRes.json();

  // Get tenant (organization) info
  const connectionsRes = await fetch(CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!connectionsRes.ok) {
    throw new Error(`Failed to get Xero connections: ${connectionsRes.status}`);
  }

  const connections = await connectionsRes.json();
  if (!connections || connections.length === 0) {
    throw new Error("No Xero organizations found. Please authorize at least one organization.");
  }

  // Use the first tenant
  const tenant = connections[0];

  // Save tokens + tenant info
  saveXeroTokens(
    {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
      token_type: tokens.token_type,
      scope: tokens.scope,
    },
    tenant.tenantId,
    tenant.tenantName
  );

  // Mark as connected
  setConnection("xero", { connected: true, email: tenant.tenantName });

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresIn: tokens.expires_in,
    tenantId: tenant.tenantId,
    tenantName: tenant.tenantName,
  };
}

// ===== Token Management =====

async function refreshAccessToken(): Promise<string> {
  const stored = loadXeroTokens();
  if (!stored) throw new Error("Not authenticated with Xero");

  const refreshToken = stored.tokens.refresh_token as string;
  if (!refreshToken) throw new Error("No Xero refresh token available");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${XERO_CLIENT_ID}:${XERO_CLIENT_SECRET}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    clearXeroTokens();
    setConnection("xero", { connected: false });
    throw new Error(`Xero token refresh failed: ${res.status} ${err}`);
  }

  const tokens = await res.json();

  // Save new tokens (refresh token rotates!)
  saveXeroTokens(
    {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + tokens.expires_in * 1000,
      token_type: tokens.token_type,
      scope: tokens.scope,
    },
    stored.tenantId || undefined,
    stored.tenantName || undefined
  );

  return tokens.access_token;
}

async function getValidToken(): Promise<{ accessToken: string; tenantId: string }> {
  const stored = loadXeroTokens();
  if (!stored) throw new Error("Not authenticated with Xero. Go to Settings → Connect Xero.");
  if (!stored.tenantId) throw new Error("No Xero organization linked.");

  const expiresAt = stored.tokens.expires_at as number;
  // Refresh if token expires within 5 minutes
  if (Date.now() > expiresAt - 5 * 60 * 1000) {
    const newToken = await refreshAccessToken();
    return { accessToken: newToken, tenantId: stored.tenantId };
  }

  return { accessToken: stored.tokens.access_token as string, tenantId: stored.tenantId };
}

// ===== API Calls =====

async function xeroGet<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
  const { accessToken, tenantId } = await getValidToken();

  const url = new URL(`${API_BASE}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "xero-tenant-id": tenantId,
      Accept: "application/json",
    },
  });

  if (res.status === 401) {
    // Try refresh once
    const newToken = await refreshAccessToken();
    const retry = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${newToken}`,
        "xero-tenant-id": tenantId,
        Accept: "application/json",
      },
    });
    if (!retry.ok) throw new Error(`Xero API error: ${retry.status}`);
    return retry.json();
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Xero API error: ${res.status} ${err}`);
  }

  return res.json();
}

// ===== Public API =====

export function isXeroConnected(): boolean {
  const stored = loadXeroTokens();
  return !!(stored && stored.tenantId);
}

export function getXeroTenantInfo(): { tenantId: string; tenantName: string } | null {
  const stored = loadXeroTokens();
  if (!stored || !stored.tenantId) return null;
  return { tenantId: stored.tenantId, tenantName: stored.tenantName || "Unknown" };
}

export function disconnectXero() {
  clearXeroTokens();
  setConnection("xero", { connected: false });
}

// ===== Data Fetching =====

export interface XeroInvoice {
  InvoiceID: string;
  InvoiceNumber: string;
  Type: "ACCREC" | "ACCPAY";
  Reference: string;
  Status: string;
  Contact: { ContactID: string; Name: string };
  DateString: string;
  DueDateString: string;
  Total: number;
  AmountDue: number;
  AmountPaid: number;
  CurrencyCode: string;
  HasAttachments: boolean;
  LineItems: { Description: string; Quantity: number; UnitAmount: number; LineAmount: number; AccountCode: string }[];
}

export interface XeroContact {
  ContactID: string;
  Name: string;
  EmailAddress: string;
  IsSupplier: boolean;
  IsCustomer: boolean;
  AccountNumber: string;
  TaxNumber: string;
  Phones: { PhoneType: string; PhoneNumber: string }[];
  Addresses: { AddressType: string; AddressLine1: string; City: string; Region: string; PostalCode: string; Country: string }[];
  Balances?: {
    AccountsReceivable?: { Outstanding: number; Overdue: number };
    AccountsPayable?: { Outstanding: number; Overdue: number };
  };
}

export interface XeroBankTransaction {
  BankTransactionID: string;
  Type: "RECEIVE" | "SPEND";
  Contact: { ContactID: string; Name: string };
  DateString: string;
  Total: number;
  Reference: string;
  Status: string;
  BankAccount: { AccountID: string; Name: string; Code: string };
  LineItems: { Description: string; Quantity: number; UnitAmount: number; LineAmount: number; AccountCode: string }[];
}

export interface XeroAccount {
  AccountID: string;
  Code: string;
  Name: string;
  Type: string;
  Class: string;
  Status: string;
  Description: string;
}

export async function getInvoices(page = 1, where?: string): Promise<{ Invoices: XeroInvoice[] }> {
  const params: Record<string, string> = { page: String(page) };
  if (where) params.where = where;
  return xeroGet("/Invoices", params);
}

export async function getInvoice(id: string): Promise<{ Invoices: XeroInvoice[] }> {
  return xeroGet(`/Invoices/${id}`);
}

export async function getContacts(page = 1, where?: string): Promise<{ Contacts: XeroContact[] }> {
  const params: Record<string, string> = { page: String(page) };
  if (where) params.where = where;
  return xeroGet("/Contacts", params);
}

export async function getBankTransactions(page = 1, where?: string): Promise<{ BankTransactions: XeroBankTransaction[] }> {
  const params: Record<string, string> = { page: String(page) };
  if (where) params.where = where;
  return xeroGet("/BankTransactions", params);
}

export async function getAccounts(): Promise<{ Accounts: XeroAccount[] }> {
  return xeroGet("/Accounts");
}

export async function getOrganisation(): Promise<{ Organisations: { Name: string; LegalName: string; BaseCurrency: string; CountryCode: string; OrganisationType: string }[] }> {
  return xeroGet("/Organisation");
}

// Summary helper — gets a quick overview of the Xero org
export async function getXeroSummary(): Promise<{
  organisation: string;
  currency: string;
  invoicesDue: number;
  billsDue: number;
  totalReceivable: number;
  totalPayable: number;
  recentInvoices: XeroInvoice[];
  recentBills: XeroInvoice[];
}> {
  const [org, invoices, bills] = await Promise.all([
    getOrganisation(),
    getInvoices(1, 'Type=="ACCREC"&&Status!="PAID"&&Status!="VOIDED"&&Status!="DELETED"'),
    getInvoices(1, 'Type=="ACCPAY"&&Status!="PAID"&&Status!="VOIDED"&&Status!="DELETED"'),
  ]);

  const orgInfo = org.Organisations[0];
  const totalReceivable = invoices.Invoices.reduce((sum, i) => sum + i.AmountDue, 0);
  const totalPayable = bills.Invoices.reduce((sum, i) => sum + i.AmountDue, 0);

  return {
    organisation: orgInfo?.Name || "Unknown",
    currency: orgInfo?.BaseCurrency || "PHP",
    invoicesDue: invoices.Invoices.length,
    billsDue: bills.Invoices.length,
    totalReceivable,
    totalPayable,
    recentInvoices: invoices.Invoices.slice(0, 5),
    recentBills: bills.Invoices.slice(0, 5),
  };
}
