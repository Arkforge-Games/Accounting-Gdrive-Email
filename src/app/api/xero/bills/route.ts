import { NextRequest, NextResponse } from "next/server";
import { createBill, applyPaymentToBill, deleteDraftBill, getCachedXeroData } from "@/lib/xero";
import { getPayables, PayableRow } from "@/lib/sheets";
import { getCachedWiseData, getBusinessProfile, getAllTransfers, WiseTransfer } from "@/lib/wise";
import * as db from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "create-bill": {
        const { supplierName, amount, currency, date, description, invoiceNumber, dueDate, accountCode } = body;

        if (!supplierName || !amount || !date || !description) {
          return NextResponse.json(
            { error: "Missing required fields: supplierName, amount, date, description" },
            { status: 400 }
          );
        }

        const result = await createBill({
          contactName: supplierName,
          date,
          dueDate,
          description,
          amount: Number(amount),
          currencyCode: currency || "HKD",
          invoiceNumber,
          accountCode,
        });

        return NextResponse.json({ success: true, message: "Draft bill created in Xero", data: result });
      }

      case "create-from-sheet": {
        const { rowIndex } = body;
        if (!rowIndex) {
          return NextResponse.json({ error: "Missing rowIndex" }, { status: 400 });
        }

        // Fetch payables from the sheet
        const payables = await getPayables();
        const row = payables.find((p: PayableRow) => p.rowIndex === Number(rowIndex));

        if (!row) {
          return NextResponse.json(
            { error: `No payable row found at rowIndex ${rowIndex}` },
            { status: 404 }
          );
        }

        // Parse amount — strip currency symbols, commas
        const rawAmount = row.paymentAmount.replace(/[^0-9.\-]/g, "");
        const amount = parseFloat(rawAmount);
        if (isNaN(amount) || amount <= 0) {
          return NextResponse.json(
            { error: `Invalid payment amount: "${row.paymentAmount}"` },
            { status: 400 }
          );
        }

        // Detect currency from payment amount string or default HKD
        let currency = "HKD";
        const amountStr = row.paymentAmount.toUpperCase();
        if (amountStr.includes("USD") || amountStr.includes("$")) currency = "USD";
        else if (amountStr.includes("PHP") || amountStr.includes("₱")) currency = "PHP";
        else if (amountStr.includes("EUR") || amountStr.includes("€")) currency = "EUR";
        else if (amountStr.includes("GBP") || amountStr.includes("£")) currency = "GBP";
        else if (amountStr.includes("HKD")) currency = "HKD";

        // Build description from available fields
        const descParts = [row.jobDetails, row.type, row.remarks].filter(Boolean);
        const description = descParts.join(" — ") || `Payment to ${row.supplierName}`;

        // Parse date (try jobDate, fall back to today)
        const date = parseSheetDate(row.jobDate) || new Date().toISOString().split("T")[0];

        const result = await createBill({
          contactName: row.supplierName || row.fullName || "Unknown Supplier",
          date,
          description,
          amount,
          currencyCode: currency,
          invoiceNumber: row.invoiceNumber || undefined,
        });

        return NextResponse.json({
          success: true,
          message: `Draft bill created from sheet row ${rowIndex}`,
          sheetRow: {
            supplier: row.supplierName,
            amount: row.paymentAmount,
            date: row.jobDate,
            invoiceNumber: row.invoiceNumber,
          },
          data: result,
        });
      }

      case "reconcile": {
        // Scan Wise transfers and Xero bills, find matches by amount + vendor + date proximity
        const cachedBills = getCachedXeroData("bills") as Array<{
          InvoiceID: string;
          InvoiceNumber: string;
          Contact: { Name: string };
          Total: number;
          AmountDue: number;
          Status: string;
          DateString: string;
          DueDateString: string;
          CurrencyCode: string;
        }> | null;

        if (!cachedBills || cachedBills.length === 0) {
          return NextResponse.json(
            { error: "No cached Xero bills. Run Xero sync first." },
            { status: 400 }
          );
        }

        // Get Wise transfers — try cache first, then live
        let transfers: WiseTransfer[] = [];
        const cachedTransfers = getCachedWiseData("transfers") as WiseTransfer[] | null;
        if (cachedTransfers && cachedTransfers.length > 0) {
          transfers = cachedTransfers;
        } else {
          const profile = await getBusinessProfile();
          if (profile) {
            transfers = await getAllTransfers(profile.id);
          }
        }

        if (transfers.length === 0) {
          return NextResponse.json(
            { error: "No Wise transfers found. Run Wise sync first or check Wise connection." },
            { status: 400 }
          );
        }

        // Only look at unpaid/draft/authorised bills
        const openBills = cachedBills.filter(
          (b) => b.Status === "DRAFT" || b.Status === "AUTHORISED" || b.Status === "SUBMITTED"
        );

        // Only look at completed Wise transfers (outgoing)
        const completedTransfers = transfers.filter(
          (t) => t.status === "outgoing_payment_sent" || t.status === "funds_converted" || t.status === "completed"
        );

        const matches: Array<{
          bill: { id: string; number: string; vendor: string; amount: number; currency: string; date: string };
          transfer: { id: number; amount: number; currency: string; date: string; reference: string; recipient: string };
          confidence: "high" | "medium" | "low";
          reasons: string[];
        }> = [];

        for (const bill of openBills) {
          for (const transfer of completedTransfers) {
            const reasons: string[] = [];
            let score = 0;

            // Amount match (exact or very close — within 1% for FX)
            const billAmount = bill.Total;
            const transferAmount = transfer.targetValue;
            const amountDiff = Math.abs(billAmount - transferAmount);
            const amountPct = billAmount > 0 ? amountDiff / billAmount : 1;

            if (amountDiff < 0.01) {
              score += 3;
              reasons.push(`Exact amount match: ${billAmount}`);
            } else if (amountPct < 0.01) {
              score += 2;
              reasons.push(`Amount within 1%: bill=${billAmount}, transfer=${transferAmount}`);
            } else if (amountPct < 0.05) {
              score += 1;
              reasons.push(`Amount within 5%: bill=${billAmount}, transfer=${transferAmount}`);
            } else {
              continue; // Skip if amounts are too different
            }

            // Currency match
            if (bill.CurrencyCode === transfer.targetCurrency) {
              score += 1;
              reasons.push(`Currency match: ${bill.CurrencyCode}`);
            }

            // Date proximity (within 7 days)
            const billDate = new Date(bill.DateString);
            const transferDate = new Date(transfer.created);
            const daysDiff = Math.abs(billDate.getTime() - transferDate.getTime()) / (1000 * 60 * 60 * 24);
            if (daysDiff <= 3) {
              score += 2;
              reasons.push(`Dates within ${Math.round(daysDiff)} days`);
            } else if (daysDiff <= 7) {
              score += 1;
              reasons.push(`Dates within ${Math.round(daysDiff)} days`);
            }

            // Vendor name similarity (simple substring check)
            const vendorLower = bill.Contact.Name.toLowerCase();
            const refLower = (transfer.details?.reference || transfer.reference || "").toLowerCase();
            if (vendorLower && refLower && (refLower.includes(vendorLower) || vendorLower.includes(refLower))) {
              score += 2;
              reasons.push(`Vendor/reference match: "${bill.Contact.Name}" ~ "${transfer.reference}"`);
            }

            if (score >= 3) {
              const confidence = score >= 5 ? "high" : score >= 4 ? "medium" : "low";
              matches.push({
                bill: {
                  id: bill.InvoiceID,
                  number: bill.InvoiceNumber,
                  vendor: bill.Contact.Name,
                  amount: bill.Total,
                  currency: bill.CurrencyCode,
                  date: bill.DateString,
                },
                transfer: {
                  id: transfer.id,
                  amount: transfer.targetValue,
                  currency: transfer.targetCurrency,
                  date: transfer.created,
                  reference: transfer.reference || transfer.details?.reference || "",
                  recipient: "", // Wise transfers don't have recipient name directly
                },
                confidence,
                reasons,
              });
            }
          }
        }

        // Sort by confidence
        const order = { high: 0, medium: 1, low: 2 };
        matches.sort((a, b) => order[a.confidence] - order[b.confidence]);

        // Auto-apply payments to Xero for high-confidence matches if requested.
        // Andrea's April 2026 checklist item #1.
        const autoApply = body.autoApply === true;
        const applied: Array<{ billId: string; invoiceNumber: string; vendor: string; amount: number; paymentId: string }> = [];
        const applyErrors: Array<{ billId: string; error: string }> = [];
        const skipped: Array<{ billId: string; reason: string }> = [];

        if (autoApply) {
          const runId = crypto.randomUUID();
          db.logPipeline({ runId, action: "auto_reconcile_start", status: "success", details: `${matches.length} matches found, processing high-confidence` });

          // Track which bills we've already paid in this run to avoid double-application
          const paidBillIds = new Set<string>();

          for (const match of matches) {
            if (match.confidence !== "high") continue;
            if (paidBillIds.has(match.bill.id)) {
              skipped.push({ billId: match.bill.id, reason: "Bill already paid earlier in this run" });
              continue;
            }
            try {
              const transferDate = match.transfer.date.substring(0, 10);
              const reference = `Wise #${match.transfer.id} — ${match.bill.number || match.bill.id}`;
              const paymentRes = await applyPaymentToBill({
                invoiceId: match.bill.id,
                amount: match.bill.amount,
                date: transferDate,
                reference,
              });
              const paymentId = paymentRes.Payments?.[0]?.PaymentID || "";
              applied.push({
                billId: match.bill.id,
                invoiceNumber: match.bill.number,
                vendor: match.bill.vendor,
                amount: match.bill.amount,
                paymentId,
              });
              paidBillIds.add(match.bill.id);
              db.logPipeline({
                runId,
                action: "xero_apply_payment",
                status: "success",
                result: paymentId,
                details: `${match.bill.vendor} ${match.bill.currency} ${match.bill.amount} → bill ${match.bill.number}`,
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : "Unknown error";
              applyErrors.push({ billId: match.bill.id, error: message });
              db.logPipeline({
                runId,
                action: "xero_apply_payment",
                status: "error",
                error: message,
                details: `${match.bill.vendor} ${match.bill.currency} ${match.bill.amount} → bill ${match.bill.number}`,
              });
            }
          }

          db.logPipeline({
            runId,
            action: "auto_reconcile_end",
            status: "success",
            details: `Applied ${applied.length}, errors ${applyErrors.length}, skipped ${skipped.length}`,
          });
        }

        return NextResponse.json({
          success: true,
          summary: {
            openBills: openBills.length,
            completedTransfers: completedTransfers.length,
            matchesFound: matches.length,
            highConfidence: matches.filter((m) => m.confidence === "high").length,
            mediumConfidence: matches.filter((m) => m.confidence === "medium").length,
            lowConfidence: matches.filter((m) => m.confidence === "low").length,
            autoApplied: applied.length,
            applyErrors: applyErrors.length,
            applySkipped: skipped.length,
          },
          matches,
          applied,
          applyErrors,
          skipped,
        });
      }

      case "delete-drafts": {
        const cachedBills = getCachedXeroData("bills") as Array<{
          InvoiceID: string; Status: string; Contact: { Name: string }; Total: number;
        }> | null;
        if (!cachedBills) return NextResponse.json({ error: "No cached bills" }, { status: 400 });
        const drafts = cachedBills.filter(b => b.Status === "DRAFT");
        let deleted = 0, errors = 0;
        for (const bill of drafts) {
          try {
            await deleteDraftBill(bill.InvoiceID);
            deleted++;
          } catch { errors++; }
          await new Promise(r => setTimeout(r, 500));
        }
        return NextResponse.json({ success: true, deleted, errors, total: drafts.length });
      }

      default:
        return NextResponse.json(
          {
            error: `Unknown action: ${action}`,
            available: ["create-bill", "create-from-sheet", "reconcile", "delete-drafts"],
          },
          { status: 400 }
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Helper: parse sheet date formats like "1/15/2026" or "2026-01-15" to YYYY-MM-DD
function parseSheetDate(dateStr: string): string | null {
  if (!dateStr) return null;

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  // M/D/YYYY or MM/DD/YYYY
  const slashMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, m, d, y] = slashMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // Try Date parse as fallback
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split("T")[0];
  }

  return null;
}
