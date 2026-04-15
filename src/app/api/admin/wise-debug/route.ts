import { NextResponse } from "next/server";
import { getTransferDetails } from "@/lib/wise";
import { getCachedWiseData, WiseTransfer } from "@/lib/wise";

export async function GET() {
  try {
    const businessTransfers = (getCachedWiseData("business_transfers") as WiseTransfer[] | null) || [];
    const outgoing = businessTransfers.filter(t =>
      t.status === "outgoing_payment_sent" || t.status === "funds_converted" || t.status === "completed"
    );

    // Pick a recent transfer
    const sample = outgoing[0];
    if (!sample) return NextResponse.json({ error: "No outgoing transfers found" });

    const details = await getTransferDetails(sample.id);

    return NextResponse.json({
      cachedFields: Object.keys(sample),
      cachedSample: {
        id: sample.id,
        sourceValue: sample.sourceValue,
        sourceCurrency: sample.sourceCurrency,
        targetValue: sample.targetValue,
        targetCurrency: sample.targetCurrency,
      },
      apiFields: Object.keys(details.raw),
      apiSample: details,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
