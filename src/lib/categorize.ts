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
    subjectPatterns: [/receipt/i, /payment.*confirm/i, /payment.*received/i, /paid/i, /transaction.*confirm/i, /order.*confirm/i],
  },
  {
    category: "payroll",
    filePatterns: [/payroll/i, /payslip/i, /salary/i, /sss/i, /philhealth/i, /pagibig/i, /pag-ibig/i, /hdmf/i, /13th.*month/i],
    senderPatterns: [/payroll/i, /hr@/i, /human.*resource/i, /sss\.gov/i, /philhealth/i, /pagibig/i],
    subjectPatterns: [/payroll/i, /payslip/i, /salary/i, /sss/i, /philhealth/i, /pag-?ibig/i, /hdmf/i, /contribution/i],
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

export function categorizeFile(file: SyncFile): {
  category: CategoryKey;
  vendor: string | null;
  period: string;
  confidence: "high" | "medium" | "low";
} {
  const name = file.name || "";
  const subject = file.emailSubject || "";
  const sender = file.emailFrom || "";

  let bestCategory: CategoryKey = "uncategorized";
  let bestScore = 0;

  for (const rule of rules) {
    let score = 0;
    for (const p of rule.filePatterns) if (p.test(name)) score += 3;
    for (const p of rule.subjectPatterns) if (p.test(subject)) score += 2;
    for (const p of rule.senderPatterns) if (p.test(sender)) score += 2;

    if (score > bestScore) {
      bestScore = score;
      bestCategory = rule.category;
    }
  }

  // Extract vendor from sender
  let vendor: string | null = null;
  if (sender) {
    const match = sender.match(/^([^<]+)</);
    vendor = match ? match[1].trim() : sender.split("@")[0];
    if (vendor && vendor.length > 50) vendor = vendor.substring(0, 50);
  }

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
