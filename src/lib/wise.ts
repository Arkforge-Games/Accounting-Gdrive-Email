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
