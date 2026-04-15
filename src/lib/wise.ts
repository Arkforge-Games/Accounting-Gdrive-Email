import { setWiseCache, getWiseCache, addActivity } from "./db";

const WISE_API_TOKEN = process.env.WISE_API_TOKEN || "";
const WISE_BASE = "https://api.wise.com";

async function wiseGet<T>(path: string): Promise<T> {
  if (!WISE_API_TOKEN) throw new Error("Wise API token not configured");

  const res = await fetch(`${WISE_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${WISE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Wise API error: ${res.status} ${err}`);
  }

  return res.json();
}

// ===== Types =====

export interface WiseProfile {
  id: number;
  type: "personal" | "business";
  details: {
    firstName?: string;
    lastName?: string;
    name?: string;
    dateOfBirth?: string;
    phoneNumber?: string;
    registrationNumber?: string;
    companyType?: string;
    companyRole?: string;
    webpage?: string;
    businessCategory?: string;
  };
}

export interface WiseBalance {
  id: number;
  currency: string;
  amount: { value: number; currency: string };
  reservedAmount: { value: number; currency: string };
  cashAmount?: { value: number; currency: string };
  totalWorth?: { value: number; currency: string };
  type: string;
  bankDetails?: {
    accountNumber?: string;
    bankCode?: string;
    iban?: string;
    swift?: string;
    bankName?: string;
    bankAddress?: { city: string; country: string };
  };
}

export interface WiseBorderlessAccount {
  id: number;
  profileId: number;
  recipientId: number;
  creationTime: string;
  modificationTime: string;
  active: boolean;
  eligible: boolean;
  balances: {
    balanceType: string;
    currency: string;
    amount: { value: number; currency: string };
    reservedAmount: { value: number; currency: string };
    bankDetails?: Record<string, unknown>;
  }[];
}

export interface WiseTransfer {
  id: number;
  user: number;
  targetAccount: number;
  sourceAccount: number;
  quote: number;
  quoteUuid: string;
  status: string;
  reference: string;
  rate: number;
  created: string;
  business: number | null;
  transferRequest: number | null;
  details: { reference: string };
  hasActiveIssues: boolean;
  sourceCurrency: string;
  sourceValue: number;
  targetCurrency: string;
  targetValue: number;
  customerTransactionId: string;
}

export interface WiseRecipient {
  id: number;
  profile: number;
  accountHolderName: string;
  type: string;
  currency: string;
  country: string;
  active: boolean;
  details: Record<string, unknown>;
}

export interface WiseStatement {
  accountHolder: { type: string; address: Record<string, string>; firstName?: string; lastName?: string };
  issuer: { name: string; firstLine: string; city: string; postCode: string; stateCode: string; country: string };
  bankDetails: unknown;
  transactions: WiseStatementTransaction[];
  startOfStatementBalance: { value: number; currency: string };
  endOfStatementBalance: { value: number; currency: string };
  query: { intervalStart: string; intervalEnd: string; currency: string; accountId: number };
}

export interface WiseStatementTransaction {
  type: string;
  date: string;
  amount: { value: number; currency: string };
  totalFees: { value: number; currency: string };
  details: {
    type: string;
    description: string;
    senderName?: string;
    senderAccount?: string;
    paymentReference?: string;
    recipient?: { name: string };
  };
  exchangeDetails: { toAmount?: { value: number; currency: string }; fromAmount?: { value: number; currency: string }; rate?: number } | null;
  runningBalance: { value: number; currency: string };
  referenceNumber: string;
}

// ===== API Functions =====

export function isWiseConfigured(): boolean {
  return !!WISE_API_TOKEN;
}

export async function getProfiles(): Promise<WiseProfile[]> {
  return wiseGet("/v1/profiles");
}

export async function getBusinessProfile(): Promise<WiseProfile | null> {
  const profiles = await getProfiles();
  return profiles.find(p => p.type === "business") || profiles[0] || null;
}

export async function getBalances(profileId: number): Promise<WiseBalance[]> {
  return wiseGet(`/v4/profiles/${profileId}/balances?types=STANDARD`);
}

export async function getBorderlessAccounts(profileId: number): Promise<WiseBorderlessAccount[]> {
  return wiseGet(`/v1/borderless-accounts?profileId=${profileId}`);
}

export async function getTransfers(profileId: number, limit = 20, offset = 0): Promise<WiseTransfer[]> {
  return wiseGet(`/v1/transfers?profile=${profileId}&limit=${limit}&offset=${offset}`);
}

/** Get detailed transfer info including fees. */
export async function getTransferDetails(transferId: number): Promise<{
  id: number;
  sourceValue: number;
  sourceCurrency: string;
  targetValue: number;
  targetCurrency: string;
  fee: number;
  feeCurrency: string;
  rate: number;
  status: string;
  raw: Record<string, unknown>;
}> {
  const data = await wiseGet<Record<string, unknown>>(`/v1/transfers/${transferId}`);
  return {
    id: data.id as number,
    sourceValue: data.sourceValue as number,
    sourceCurrency: data.sourceCurrency as string,
    targetValue: data.targetValue as number,
    targetCurrency: data.targetCurrency as string,
    fee: (data.fee as number) || 0,
    feeCurrency: (data.feeCurrency as string) || (data.sourceCurrency as string),
    rate: data.rate as number,
    status: data.status as string,
    raw: data,
  };
}

export async function getAllTransfers(profileId: number): Promise<WiseTransfer[]> {
  const all: WiseTransfer[] = [];
  let offset = 0;
  const PAGE = 100;
  while (true) {
    const page = await getTransfers(profileId, PAGE, offset);
    all.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

export async function getRecipients(profileId: number): Promise<WiseRecipient[]> {
  // v1 endpoint returns full names, v2 does not
  return wiseGet(`/v1/accounts?profileId=${profileId}`);
}

/**
 * Fetch a single recipient by account ID. Used to look up names for
 * recipients not in the cached list (deleted/inactive accounts).
 */
export async function getRecipientById(accountId: number): Promise<WiseRecipient | null> {
  try {
    return await wiseGet(`/v1/accounts/${accountId}`);
  } catch {
    return null;
  }
}

export async function getStatement(
  profileId: number,
  balanceId: number,
  currency: string,
  intervalStart: string,
  intervalEnd: string
): Promise<WiseStatement> {
  return wiseGet(
    `/v1/profiles/${profileId}/balance-statements/${balanceId}/statement?currency=${currency}&intervalStart=${intervalStart}&intervalEnd=${intervalEnd}&type=COMPACT`
  );
}

export async function getExchangeRate(source: string, target: string): Promise<{ rate: number; source: string; target: string; time: string }[]> {
  return wiseGet(`/v1/rates?source=${source}&target=${target}`);
}

// ===== Summary Helper =====

export async function getWiseSummary(): Promise<{
  profile: WiseProfile;
  balances: { currency: string; value: number; reserved: number; bankDetails?: WiseBalance["bankDetails"] }[];
  recentTransfers: WiseTransfer[];
  totalBalanceHKD: number;
}> {
  const profile = await getBusinessProfile();
  if (!profile) throw new Error("No Wise profile found");

  const [rawBalances, transfers, borderless] = await Promise.all([
    getBalances(profile.id),
    getTransfers(profile.id, 10),
    getBorderlessAccounts(profile.id),
  ]);

  // Merge balance info from both endpoints
  const balances: { currency: string; value: number; reserved: number; bankDetails?: WiseBalance["bankDetails"] }[] = rawBalances.map(b => ({
    currency: b.amount.currency,
    value: b.amount.value,
    reserved: b.reservedAmount?.value || 0,
    bankDetails: b.bankDetails,
  }));

  // Also include balances from borderless accounts that might not be in v4
  if (borderless.length > 0) {
    for (const acct of borderless) {
      for (const bal of acct.balances) {
        if (!balances.find(b => b.currency === bal.currency)) {
          balances.push({
            currency: bal.currency,
            value: bal.amount.value,
            reserved: bal.reservedAmount?.value || 0,
          });
        }
      }
    }
  }

  const totalBalanceHKD = balances.reduce((sum, b) => {
    if (b.currency === "HKD") return sum + b.value;
    return sum;
  }, 0);

  return { profile, balances, recentTransfers: transfers, totalBalanceHKD };
}

// ===== Sync & Cache =====

export async function syncWiseData(): Promise<{
  profiles: number;
  transfers: number;
  recipients: number;
  balances: number;
}> {
  const profiles = await getProfiles();
  setWiseCache("profiles", profiles);

  const business = profiles.find(p => p.type === "business");
  const personal = profiles.find(p => p.type === "personal");

  let totalTransfers = 0;
  let totalRecipients = 0;
  let totalBalances = 0;

  if (business) {
    const [balances, borderless, transfers, recipients] = await Promise.all([
      getBalances(business.id),
      getBorderlessAccounts(business.id),
      getAllTransfers(business.id),
      getRecipients(business.id),
    ]);

    // Compute stats
    const sent = transfers.filter(t => t.status === "outgoing_payment_sent");
    const byCurrency: Record<string, { amount: number; count: number }> = {};
    for (const t of sent) {
      if (!byCurrency[t.targetCurrency]) byCurrency[t.targetCurrency] = { amount: 0, count: 0 };
      byCurrency[t.targetCurrency].amount += t.targetValue;
      byCurrency[t.targetCurrency].count++;
    }

    setWiseCache("business_profile", business);
    setWiseCache("business_balances", balances);
    setWiseCache("business_borderless", borderless);
    setWiseCache("business_transfers", transfers);
    setWiseCache("business_transfer_stats", {
      total: transfers.length,
      sent: sent.length,
      cancelled: transfers.filter(t => t.status === "cancelled").length,
      refunded: transfers.filter(t => t.status === "funds_refunded").length,
      byTargetCurrency: byCurrency,
    });
    setWiseCache("business_recipients", recipients);

    totalTransfers += transfers.length;
    totalRecipients += recipients.length;
    totalBalances += balances.length;
  }

  if (personal) {
    const [balances, transfers, recipients] = await Promise.all([
      getBalances(personal.id).catch(() => []),
      getAllTransfers(personal.id),
      getRecipients(personal.id).catch(() => []),
    ]);

    setWiseCache("personal_profile", personal);
    setWiseCache("personal_balances", balances);
    setWiseCache("personal_transfers", transfers);
    setWiseCache("personal_recipients", recipients);

    totalTransfers += transfers.length;
    totalRecipients += recipients.length;
    totalBalances += balances.length;
  }

  // Fetch names for recipients missing from the main list.
  // Some transfers reference recipient IDs that aren't in /v1/accounts
  // (deleted accounts, cross-profile transfers, etc.)
  if (business) {
    const bizTransfers = (getWiseCache("business_transfers")?.data as WiseTransfer[] | null) || [];
    const bizRecipients = (getWiseCache("business_recipients")?.data as WiseRecipient[] | null) || [];
    const knownIds = new Set(bizRecipients.map(r => r.id));
    const missingIds = new Set<number>();
    for (const t of bizTransfers) {
      if (t.targetAccount && !knownIds.has(t.targetAccount)) missingIds.add(t.targetAccount);
    }
    if (missingIds.size > 0) {
      const fetched: WiseRecipient[] = [];
      for (const id of missingIds) {
        try {
          const r = await getRecipientById(id);
          if (r && r.accountHolderName) fetched.push(r);
        } catch { /* skip failures */ }
      }
      if (fetched.length > 0) {
        // Merge into cached recipients
        const merged = [...bizRecipients, ...fetched];
        setWiseCache("business_recipients", merged);
        totalRecipients += fetched.length;
      }
    }
  }

  // Get common exchange rates. Cache both directions and X→HKD for every
  // major currency Andrea uses. The Q/R cash columns need X→HKD conversion.
  const ratePairs = [
    ["HKD", "PHP"], ["HKD", "MYR"], ["HKD", "IDR"], ["HKD", "SGD"], ["HKD", "USD"], ["HKD", "EUR"], ["HKD", "GBP"],
    ["USD", "HKD"], ["PHP", "HKD"], ["MYR", "HKD"], ["IDR", "HKD"], ["SGD", "HKD"], ["EUR", "HKD"], ["GBP", "HKD"],
    ["USD", "PHP"],
  ];
  const rates: Record<string, number> = {};
  for (const [src, tgt] of ratePairs) {
    try {
      const r = await getExchangeRate(src, tgt);
      if (r.length > 0) rates[`${src}_${tgt}`] = r[0].rate;
    } catch { /* skip */ }
  }
  setWiseCache("exchange_rates", rates);

  setWiseCache("last_sync", { timestamp: new Date().toISOString(), profiles: profiles.length, transfers: totalTransfers, recipients: totalRecipients, balances: totalBalances });

  addActivity({ action: "sync", source: "wise", details: `Synced ${totalTransfers} transfers, ${totalRecipients} recipients, ${totalBalances} balances`, fileCount: totalTransfers });

  return { profiles: profiles.length, transfers: totalTransfers, recipients: totalRecipients, balances: totalBalances };
}

export function getCachedWiseData(key: string): unknown | null {
  const cached = getWiseCache(key);
  return cached ? cached.data : null;
}

export function getLastWiseSync(): { timestamp: string; profiles: number; transfers: number; recipients: number; balances: number } | null {
  const cached = getWiseCache("last_sync");
  return cached ? cached.data as { timestamp: string; profiles: number; transfers: number; recipients: number; balances: number } : null;
}
