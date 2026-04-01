import type { SyncFile } from "./types";

export const CATEGORIES = {
  invoice: { label: "Invoice", color: "blue", icon: "INV" },
  bill: { label: "Bill / Payable", color: "red", icon: "BILL" },
  receipt: { label: "Receipt", color: "green", icon: "REC" },
  payroll: { label: "Payroll", color: "purple", icon: "PAY" },
  tax: { label: "Tax", color: "orange", icon: "TAX" },
  bank_statement: { label: "Bank Statement", color: "cyan", icon: "BANK" },
  contract: { label: "Contract", color: "indigo", icon: "CON" },
  reimbursement: { label: "Reimbursement", color: "pink", icon: "REIMB" },
  permit: { label: "Permit / License", color: "amber", icon: "PER" },
  quotation: { label: "Quotation", color: "teal", icon: "QUO" },
  junk: { label: "Junk / System", color: "slate", icon: "JUNK" },
  uncategorized: { label: "Uncategorized", color: "gray", icon: "?" },
} as const;

export type CategoryKey = keyof typeof CATEGORIES;

export const STATUSES = {
  pending: { label: "Pending", color: "yellow" },
  reviewed: { label: "Reviewed", color: "blue" },
  recorded: { label: "Recorded", color: "green" },
  flagged: { label: "Flagged", color: "red" },
} as const;

export type StatusKey = keyof typeof STATUSES;

// ===== Vendor Keyword Map =====
// Maps keywords found in email subjects/senders to clean vendor names

const VENDOR_MAP: [RegExp, string][] = [
  [/anthropic|claude/i, "Anthropic (Claude)"],
  [/github/i, "GitHub"],
  [/webwork/i, "WebWork"],
  [/google|workspace|gcp/i, "Google"],
  [/vercel/i, "Vercel"],
  [/stripe/i, "Stripe"],
  [/aws|amazon\s*web/i, "Amazon Web Services"],
  [/appsumo/i, "AppSumo"],
  [/lazada/i, "Lazada"],
  [/shopee/i, "Shopee"],
  [/grab/i, "Grab"],
  [/gcash/i, "GCash"],
  [/maya\b/i, "Maya"],
  [/paymongo/i, "PayMongo"],
  [/meralco/i, "Meralco"],
  [/pldt/i, "PLDT"],
  [/globe\s*telecom|globe\.com/i, "Globe Telecom"],
  [/converge/i, "Converge ICT"],
  [/smart\s*comm/i, "Smart Communications"],
  [/bpi\b/i, "BPI"],
  [/bdo\b/i, "BDO"],
  [/metrobank/i, "Metrobank"],
  [/unionbank/i, "UnionBank"],
  [/digital\s*ocean/i, "DigitalOcean"],
  [/netlify/i, "Netlify"],
  [/cloudflare/i, "Cloudflare"],
  [/azure|microsoft/i, "Microsoft"],
  [/openai/i, "OpenAI"],
  [/figma/i, "Figma"],
  [/canva/i, "Canva"],
  [/notion/i, "Notion"],
  [/slack/i, "Slack"],
  [/zoom/i, "Zoom"],
  [/hostinger/i, "Hostinger"],
  [/namecheap/i, "Namecheap"],
  [/godaddy/i, "GoDaddy"],
  [/alibaba|alicloud/i, "Alibaba Cloud"],
  [/hetzner/i, "Hetzner"],
  [/vultr/i, "Vultr"],
  [/linode|akamai/i, "Akamai/Linode"],
  [/sss\b/i, "SSS"],
  [/philhealth/i, "PhilHealth"],
  [/pag-?ibig|hdmf/i, "Pag-IBIG/HDMF"],
  [/bir\b/i, "BIR"],
  [/chubb/i, "Chubb Insurance"],
  [/chow\s*tai\s*fook/i, "Chow Tai Fook"],
];

// Generic senders that should be skipped in favor of subject-based extraction
const GENERIC_SENDERS = /^(noreply|no-reply|admin|info|support|billing|notifications?|feedback|hello|contact|service|team|help|donotreply|system)$/i;

// ===== Junk Detection =====

const JUNK_SENDERS = /mailer-daemon|postmaster/i;

const JUNK_FILENAMES = /^(icon|warning[_-]?triangle|image\d{2,}|logo|spacer|pixel|banner|footer|header|divider|separator|blank|transparent|tracking|unnamed|noname)\.(png|gif|jpg|jpeg|bmp|webp)$/i;

const JUNK_SUBJECTS = /delivery\s*status\s*notif|undeliverable|returned\s*mail|failure\s*notice|mail\s*delivery\s*(failed|subsystem)|auto.?reply|out\s*of\s*office|automatic\s*reply/i;

function isJunkFile(file: SyncFile): boolean {
  const name = file.name || "";
  const sender = file.emailFrom || "";
  const subject = file.emailSubject || "";

  // Mailer-daemon / postmaster files are always junk
  if (JUNK_SENDERS.test(sender)) return true;

  // Known junk filenames
  if (JUNK_FILENAMES.test(name)) return true;

  // Bounce/auto-reply subjects with image attachments
  if (JUNK_SUBJECTS.test(subject) && file.mimeType.startsWith("image/")) return true;

  // Tiny images (< 15KB) with no meaningful subject are likely email icons/pixels
  if (file.mimeType.startsWith("image/") && file.sizeBytes && file.sizeBytes < 15000) {
    // Only if the subject is empty or generic
    if (!subject || JUNK_SUBJECTS.test(subject) || /^(re:|fwd:|fw:)?\s*$/i.test(subject)) return true;
  }

  return false;
}

// ===== Smart Vendor Extraction =====

function extractVendor(file: SyncFile): string | null {
  const subject = file.emailSubject || "";
  const sender = file.emailFrom || "";
  const name = file.name || "";

  // 1. Try vendor keyword map against subject (most informative)
  for (const [pattern, vendorName] of VENDOR_MAP) {
    if (pattern.test(subject)) return vendorName;
  }

  // 2. Try vendor keyword map against filename
  for (const [pattern, vendorName] of VENDOR_MAP) {
    if (pattern.test(name)) return vendorName;
  }

  // 3. Try vendor keyword map against sender
  for (const [pattern, vendorName] of VENDOR_MAP) {
    if (pattern.test(sender)) return vendorName;
  }

  // 4. Try to extract a meaningful name from sender domain
  if (sender) {
    const domainMatch = sender.match(/@([^.>]+)\./);
    if (domainMatch) {
      const domain = domainMatch[1];
      if (!GENERIC_SENDERS.test(domain) && !/gmail|yahoo|hotmail|outlook|icloud/i.test(domain)) {
        return domain.charAt(0).toUpperCase() + domain.slice(1);
      }
    }
  }

  // 5. Try sender display name (before <)
  if (sender) {
    const displayMatch = sender.match(/^([^<]+)</);
    if (displayMatch) {
      const displayName = displayMatch[1].trim();
      if (displayName && !GENERIC_SENDERS.test(displayName) && displayName.length > 2) {
        return displayName;
      }
    }
    // Last resort: sender prefix, but only if not generic
    const prefix = sender.split("@")[0];
    if (prefix && !GENERIC_SENDERS.test(prefix)) {
      return prefix;
    }
  }

  return null;
}

// ===== Categorization Rules =====

interface CategorizeRule {
  category: CategoryKey;
  filePatterns: RegExp[];
  senderPatterns: RegExp[];
  subjectPatterns: RegExp[];
}

const rules: CategorizeRule[] = [
  {
    category: "invoice",
    filePatterns: [/invoice/i, /inv[_-]?\d/i, /billing/i, /factura/i],
    senderPatterns: [/billing/i, /invoice/i, /accounts?\s*receivable/i],
    subjectPatterns: [/invoice/i, /billing\s*statement/i, /inv\s*#/i, /invoice\s*#/i],
  },
  {
    category: "bill",
    filePatterns: [/bill/i, /payable/i, /utility/i, /meralco/i, /pldt/i, /globe/i, /maynilad/i],
    senderPatterns: [/meralco/i, /pldt/i, /globe/i, /maynilad/i, /converge/i, /smart/i, /noreply.*bill/i],
    subjectPatterns: [/\bbill\b/i, /payment\s*due/i, /amount\s*due/i, /utility/i, /electricity/i, /water\s*bill/i],
  },
  {
    category: "receipt",
    filePatterns: [/receipt/i, /payment.*confirm/i, /acknowledgment/i, /or[_-]?\d/i, /official.*receipt/i],
    senderPatterns: [/receipt/i, /payment/i, /gcash/i, /maya/i, /paymongo/i, /grab/i, /lazada/i, /shopee/i],
    subjectPatterns: [/receipt/i, /payment.*confirm/i, /payment.*received/i, /\bpaid\b/i, /transaction.*confirm/i, /order.*confirm/i, /payment\b/i],
  },
  {
    category: "payroll",
    filePatterns: [/payroll/i, /payslip/i, /salary/i, /sss/i, /philhealth/i, /pagibig/i, /pag-ibig/i, /hdmf/i, /13th.*month/i],
    senderPatterns: [/payroll/i, /hr@/i, /human.*resource/i, /sss\.gov/i, /philhealth/i, /pagibig/i],
    subjectPatterns: [/payroll/i, /payslip/i, /salary/i, /\bsss\b/i, /philhealth/i, /pag-?ibig/i, /hdmf/i, /contribution/i],
  },
  {
    category: "tax",
    filePatterns: [/tax/i, /bir/i, /\b2307\b/i, /\b2316\b/i, /\b1601/i, /\b1701/i, /\b0619/i, /withholding/i, /vat/i, /itr/i],
    senderPatterns: [/bir/i, /tax/i, /revenue/i],
    subjectPatterns: [/tax/i, /bir/i, /withholding/i, /vat/i, /annual.*return/i, /tax.*return/i],
  },
  {
    category: "bank_statement",
    filePatterns: [/statement/i, /bank.*stmt/i, /account.*summary/i, /soa/i, /bpi/i, /bdo/i, /metrobank/i, /unionbank/i, /chinabank/i, /landbank/i, /pnb/i, /rcbc/i],
    senderPatterns: [/bpi/i, /bdo/i, /metrobank/i, /unionbank/i, /chinabank/i, /landbank/i, /pnb\.com/i, /rcbc/i, /bank/i],
    subjectPatterns: [/statement.*account/i, /account.*statement/i, /bank.*statement/i, /monthly.*statement/i, /e-?statement/i],
  },
  {
    category: "contract",
    filePatterns: [/contract/i, /agreement/i, /moa/i, /memorandum/i, /nda/i, /lease/i, /rental/i, /service.*agreement/i],
    senderPatterns: [],
    subjectPatterns: [/contract/i, /agreement/i, /memorandum/i, /lease/i],
  },
  {
    category: "reimbursement",
    filePatterns: [/reimburs/i, /expense.*report/i, /liquidat/i, /petty.*cash/i, /cash.*advance/i],
    senderPatterns: [],
    subjectPatterns: [/reimburs/i, /expense.*report/i, /liquidat/i, /petty.*cash/i, /cash.*advance/i],
  },
  {
    category: "permit",
    filePatterns: [/permit/i, /license/i, /registration/i, /sec/i, /dti/i, /business.*permit/i, /mayor/i, /clearance/i],
    senderPatterns: [/sec\.gov/i, /dti/i, /lgu/i],
    subjectPatterns: [/permit/i, /license/i, /registration/i, /clearance/i],
  },
  {
    category: "quotation",
    filePatterns: [/quot/i, /estimate/i, /proposal/i, /price.*list/i, /proforma/i],
    senderPatterns: [],
    subjectPatterns: [/quot/i, /estimate/i, /proposal/i, /proforma/i, /price.*list/i],
  },
];

// ===== Main Categorization Function =====

export function categorizeFile(file: SyncFile): {
  category: CategoryKey;
  vendor: string | null;
  period: string;
  confidence: "high" | "medium" | "low";
} {
  // Fast-path: junk detection
  if (isJunkFile(file)) {
    return {
      category: "junk",
      vendor: null,
      period: file.date ? file.date.substring(0, 7) : new Date().toISOString().substring(0, 7),
      confidence: "high",
    };
  }

  const name = file.name || "";
  const subject = file.emailSubject || "";
  const sender = file.emailFrom || "";

  let bestCategory: CategoryKey = "uncategorized";
  let bestScore = 0;

  for (const rule of rules) {
    let score = 0;
    for (const p of rule.filePatterns) if (p.test(name)) score += 3;
    // Subject patterns weighted equally to filenames — subjects are very informative
    for (const p of rule.subjectPatterns) if (p.test(subject)) score += 3;
    for (const p of rule.senderPatterns) if (p.test(sender)) score += 2;

    if (score > bestScore) {
      bestScore = score;
      bestCategory = rule.category;
    }
  }

  // Extract vendor using smart extraction
  const vendor = extractVendor(file);

  // Extract period from file date
  const period = file.date ? file.date.substring(0, 7) : new Date().toISOString().substring(0, 7);

  const confidence = bestScore >= 5 ? "high" : bestScore >= 2 ? "medium" : "low";

  return { category: bestCategory, vendor, period, confidence };
}

export function categorizeFiles(files: SyncFile[]): {
  fileId: string;
  category: CategoryKey;
  vendor: string | null;
  period: string;
  confidence: "high" | "medium" | "low";
}[] {
  return files.map((file) => ({
    fileId: file.id,
    ...categorizeFile(file),
  }));
}
