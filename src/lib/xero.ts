import { saveXeroTokens, loadXeroTokens, clearXeroTokens, setConnection, setDataCache, getDataCache, addActivity } from "./db";

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
  "accounting.reports.read",
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

async function xeroPost<T>(endpoint: string, body: unknown): Promise<T> {
  const { accessToken, tenantId } = await getValidToken();
  const res = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "xero-tenant-id": tenantId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Xero API error: ${res.status} ${err}`);
  }
  return res.json();
}

export async function createBill(bill: {
  contactName: string;
  date: string;
  dueDate?: string;
  description: string;
  amount: number;
  currencyCode?: string;
  invoiceNumber?: string;
  accountCode?: string;
}): Promise<unknown> {
  return xeroPost("/Invoices", {
    Type: "ACCPAY",
    Contact: { Name: bill.contactName },
    Date: bill.date,
    DueDate: bill.dueDate || bill.date,
    LineItems: [
      {
        Description: bill.description,
        Quantity: 1,
        UnitAmount: bill.amount,
        AccountCode: bill.accountCode || "200",
      },
    ],
    Status: "DRAFT",
    InvoiceNumber: bill.invoiceNumber || undefined,
    CurrencyCode: bill.currencyCode || "HKD",
  });
}

export async function createInvoice(invoice: {
  contactName: string;
  date: string;
  dueDate?: string;
  description: string;
  amount: number;
  currencyCode?: string;
  invoiceNumber?: string;
  accountCode?: string;
}): Promise<unknown> {
  return xeroPost("/Invoices", {
    Type: "ACCREC",
    Contact: { Name: invoice.contactName },
    Date: invoice.date,
    DueDate: invoice.dueDate || invoice.date,
    LineItems: [
      {
        Description: invoice.description,
        Quantity: 1,
        UnitAmount: invoice.amount,
        AccountCode: invoice.accountCode || "200",
      },
    ],
    Status: "DRAFT",
    InvoiceNumber: invoice.invoiceNumber || undefined,
    CurrencyCode: invoice.currencyCode || "HKD",
  });
}

/**
 * Apply a payment to an existing Xero bill or invoice. POSTs to /Payments
 * with the bill's InvoiceID. Used by the auto-reconcile feature when a Wise
 * transfer is matched against an open Xero bill with high confidence.
 *
 * Andrea's April 2026 checklist item #1.
 *
 * @returns The created Payment record from Xero
 */
export async function applyPaymentToBill(payment: {
  invoiceId: string;
  amount: number;
  date: string;            // YYYY-MM-DD
  reference?: string;
  accountCode?: string;    // Bank account code that the payment came FROM
}): Promise<{ Payments: Array<{ PaymentID: string; Status: string }> }> {
  return xeroPost<{ Payments: Array<{ PaymentID: string; Status: string }> }>("/Payments", {
    Payments: [
      {
        Invoice: { InvoiceID: payment.invoiceId },
        // Account that the money came FROM (a bank/wallet account in Xero).
        // Defaults to the same account code we use for createBill, which is
        // a sensible fallback. Andrea may want to override this later.
        Account: { Code: payment.accountCode || "200" },
        Date: payment.date,
        Amount: payment.amount,
        Reference: payment.reference || "",
      },
    ],
  });
}

/**
 * Create a Xero bank transaction (Spend Money or Receive Money) — used when
 * reconciling a bank statement line that does NOT match an existing bill.
 * The "Create" tab in Xero's bank reconciliation UI.
 *
 * Andrea's April 2026 checklist item #1 (v2). The accountCode here is the
 * "What" the user picks from Xero's chart-of-accounts dropdown — we pick it
 * via AI based on the bank narration.
 */
// Andrea's HSBC Xero bank account — has no Code field.
// Use both AccountID + Name for maximum compatibility.
const XERO_BANK_ACCOUNT = {
  AccountID: "fccb6880-9a8e-475a-9624-e25b17141a34",
  Name: "HSBC",
};

export async function createBankTransaction(tx: {
  type: "RECEIVE" | "SPEND";
  bankAccountCode: string;      // legacy field, kept for compatibility but overridden by AccountID
  contactName: string;
  date: string;
  description: string;
  amount: number;
  accountCode: string;
  currencyCode?: string;
  reference?: string;
  lineItems?: Array<{ description: string; amount: number; accountCode?: string }>;
}): Promise<unknown> {
  const items = tx.lineItems && tx.lineItems.length > 0
    ? tx.lineItems.map(li => ({
        Description: li.description,
        Quantity: 1,
        UnitAmount: li.amount,
        AccountCode: li.accountCode || tx.accountCode,
      }))
    : [{
        Description: tx.description,
        Quantity: 1,
        UnitAmount: tx.amount,
        AccountCode: tx.accountCode,
      }];

  return xeroPost("/BankTransactions", {
    BankTransactions: [
      {
        Type: tx.type,
        Contact: { Name: tx.contactName },
        BankAccount: XERO_BANK_ACCOUNT,
        Date: tx.date,
        Reference: tx.reference || "",
        LineItems: items,
        CurrencyCode: tx.currencyCode || "HKD",
        Status: "AUTHORISED",
      },
    ],
  });
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
  IsReconciled: boolean;
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

export async function getAllInvoices(where?: string): Promise<XeroInvoice[]> {
  const all: XeroInvoice[] = [];
  let page = 1;
  while (true) {
    const res = await getInvoices(page, where);
    all.push(...res.Invoices);
    if (res.Invoices.length < 100) break;
    page++;
  }
  return all;
}

export async function getAllContacts(): Promise<XeroContact[]> {
  const all: XeroContact[] = [];
  let page = 1;
  while (true) {
    const res = await getContacts(page);
    all.push(...res.Contacts);
    if (res.Contacts.length < 100) break;
    page++;
  }
  return all;
}

export async function getAllBankTransactions(): Promise<XeroBankTransaction[]> {
  const all: XeroBankTransaction[] = [];
  let page = 1;
  while (true) {
    const res = await getBankTransactions(page);
    all.push(...res.BankTransactions);
    if (res.BankTransactions.length < 100) break;
    page++;
  }
  return all;
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

// ===== Reports =====

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getReport(reportName: string, params?: Record<string, string>): Promise<any> {
  return xeroGet(`/Reports/${reportName}`, params);
}

export async function getProfitAndLoss(fromDate?: string, toDate?: string) {
  const params: Record<string, string> = {};
  if (fromDate) params.fromDate = fromDate;
  if (toDate) params.toDate = toDate;
  return getReport("ProfitAndLoss", params);
}

export async function getBalanceSheet(date?: string) {
  const params: Record<string, string> = {};
  if (date) params.date = date;
  return getReport("BalanceSheet", params);
}

export async function getBankSummary(fromDate?: string, toDate?: string) {
  const params: Record<string, string> = {};
  if (fromDate) params.fromDate = fromDate;
  if (toDate) params.toDate = toDate;
  return getReport("BankSummary", params);
}

export async function getAgedReceivables(date?: string) {
  const params: Record<string, string> = {};
  if (date) params.date = date;
  return getReport("AgedReceivablesByContact", params);
}

export async function getAgedPayables(date?: string) {
  const params: Record<string, string> = {};
  if (date) params.date = date;
  return getReport("AgedPayablesByContact", params);
}

export async function getBankAccounts(): Promise<{ accounts: { name: string; code: string; accountId: string; balance: number; currency: string }[] }> {
  const accountsRes = await getAccounts();
  const bankAccounts = (accountsRes.Accounts || []).filter((a: XeroAccount) => a.Type === "BANK" && a.Status === "ACTIVE");

  // Get balances from bank summary
  const summary = await getBankSummary();
  const reports = (summary as { Reports?: { Rows?: { Rows?: { Cells?: { Value: string; Attributes?: { Value: string; Id: string }[] }[] }[] }[] }[] }).Reports || [];
  const rows = reports[0]?.Rows || [];

  const balances: Record<string, number> = {};
  for (const section of rows) {
    for (const row of section.Rows || []) {
      const cells = row.Cells || [];
      if (cells.length >= 5) {
        const name = cells[0]?.Value || "";
        const closing = parseFloat(cells[4]?.Value || "0");
        if (name && !isNaN(closing)) balances[name] = closing;
      }
    }
  }

  return {
    accounts: bankAccounts.map((a: XeroAccount) => ({
      name: a.Name,
      code: a.Code,
      accountId: a.AccountID,
      balance: balances[a.Name] || 0,
      currency: "HKD",
    })),
  };
}

export async function getTrialBalance(date?: string) {
  const params: Record<string, string> = {};
  if (date) params.date = date;
  return getReport("TrialBalance", params);
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

// ===== Sync & Cache =====

export async function syncXeroData(): Promise<{
  invoices: number;
  bills: number;
  contacts: number;
  bankTransactions: number;
  accounts: number;
}> {
  if (!isXeroConnected()) throw new Error("Xero not connected");

  const S = "xero";

  // Fetch everything in parallel where possible
  // Sequential to avoid Xero 429 rate limit (60 calls/min)
  const org = await getOrganisation();
  const allInvoices = await getAllInvoices();
  const allContacts = await getAllContacts();
  const allBankTx = await getAllBankTransactions();
  const accountsRes = await getAccounts();
  const bankAccountsRes = await getBankAccounts().catch(() => ({ accounts: [] as { name: string; code: string; accountId: string; balance: number; currency: string }[] }));
  const pnlRes = await getProfitAndLoss().catch(() => null);
  const balSheetRes = await getBalanceSheet().catch(() => null);

  const orgInfo = org.Organisations[0];
  setDataCache(S, "organisation", orgInfo);

  // Split invoices vs bills
  const invoices = allInvoices.filter(i => i.Type === "ACCREC");
  const bills = allInvoices.filter(i => i.Type === "ACCPAY");

  setDataCache(S, "invoices", invoices);
  setDataCache(S, "bills", bills);
  setDataCache(S, "contacts", allContacts);
  setDataCache(S, "bank_transactions", allBankTx);
  setDataCache(S, "accounts", accountsRes.Accounts);
  setDataCache(S, "bank_accounts", bankAccountsRes.accounts);
  if (pnlRes) setDataCache(S, "profit_loss", pnlRes);
  if (balSheetRes) setDataCache(S, "balance_sheet", balSheetRes);

  // Compute summary stats
  const outstandingInvoices = invoices.filter(i => i.Status !== "PAID" && i.Status !== "VOIDED" && i.Status !== "DELETED");
  const outstandingBills = bills.filter(i => i.Status !== "PAID" && i.Status !== "VOIDED" && i.Status !== "DELETED");

  const stats = {
    organisation: orgInfo?.Name || "Unknown",
    currency: orgInfo?.BaseCurrency || "HKD",
    totalInvoices: invoices.length,
    totalBills: bills.length,
    outstandingInvoices: outstandingInvoices.length,
    outstandingBills: outstandingBills.length,
    totalReceivable: outstandingInvoices.reduce((s, i) => s + i.AmountDue, 0),
    totalPayable: outstandingBills.reduce((s, i) => s + i.AmountDue, 0),
    totalContacts: allContacts.length,
    customers: allContacts.filter(c => c.IsCustomer).length,
    suppliers: allContacts.filter(c => c.IsSupplier).length,
    totalBankTransactions: allBankTx.length,
    totalAccounts: accountsRes.Accounts.length,
    invoicesByStatus: invoices.reduce<Record<string, number>>((acc, i) => { acc[i.Status] = (acc[i.Status] || 0) + 1; return acc; }, {}),
    billsByStatus: bills.reduce<Record<string, number>>((acc, i) => { acc[i.Status] = (acc[i.Status] || 0) + 1; return acc; }, {}),
    bankAccounts: bankAccountsRes.accounts,
    totalBankBalance: bankAccountsRes.accounts.reduce((s, a) => s + a.balance, 0),
  };
  setDataCache(S, "stats", stats);

  setDataCache(S, "last_sync", {
    timestamp: new Date().toISOString(),
    invoices: invoices.length,
    bills: bills.length,
    contacts: allContacts.length,
    bankTransactions: allBankTx.length,
    accounts: accountsRes.Accounts.length,
  });

  // Update connection status
  setConnection("xero", {
    connected: true,
    email: orgInfo?.Name,
    lastSync: new Date().toISOString(),
    fileCount: invoices.length + bills.length,
  });

  addActivity({
    action: "sync",
    source: "xero",
    details: `Synced ${invoices.length} invoices, ${bills.length} bills, ${allContacts.length} contacts, ${allBankTx.length} bank transactions, ${accountsRes.Accounts.length} accounts`,
    fileCount: invoices.length + bills.length,
  });

  return {
    invoices: invoices.length,
    bills: bills.length,
    contacts: allContacts.length,
    bankTransactions: allBankTx.length,
    accounts: accountsRes.Accounts.length,
  };
}

export function getCachedXeroData(key: string): unknown | null {
  const cached = getDataCache("xero", key);
  return cached ? cached.data : null;
}

export function getLastXeroSync(): Record<string, unknown> | null {
  const cached = getDataCache("xero", "last_sync");
  return cached ? cached.data as Record<string, unknown> : null;
}
