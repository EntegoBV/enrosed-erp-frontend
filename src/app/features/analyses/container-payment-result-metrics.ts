import type { PurchasePaymentResult } from '../purchasing/purchase-payment-result-metrics';

export interface ContainerPaymentResultRow {
  view: { order: { id: number } };
  paymentResult: PurchasePaymentResult | null;
}

/**
 * Summarize the displayed containers only. The shared payment-result projection
 * owns settlement rules; this is a separate disclosure, never a second posting
 * to purchase prices, invoice profit or the ENROSED markup.
 */
export function containerPaymentResultTotals(rows: readonly ContainerPaymentResultRow[]) {
  const total = {
    settledSavingsEur: 0,
    settledOverrunsEur: 0,
    additionalCostsEur: 0,
    unsettledOverrunsEur: 0,
    netResultEur: 0,
    internalMarkupEur: 0,
    markupWithResultEur: 0,
    eligibleCount: 0,
    provisionalCount: 0,
    finalizedCount: 0,
    excludedCount: 0,
    unavailableCount: 0,
  };
  const seen = new Set<number>();
  for (const row of rows) {
    if (seen.has(row.view.order.id)) continue;
    seen.add(row.view.order.id);
    const result = row.paymentResult;
    if (!result) {
      total.unavailableCount++;
      continue;
    }
    if (!result.eligible) {
      total.excludedCount++;
      continue;
    }
    total.eligibleCount++;
    if (result.finalized) total.finalizedCount++;
    else total.provisionalCount++;
    total.settledSavingsEur += result.settledSavingsEur;
    total.settledOverrunsEur += result.settledOverrunsEur;
    total.additionalCostsEur += result.additionalCostsEur;
    total.unsettledOverrunsEur += result.unsettledOverrunsEur;
    total.netResultEur += result.netResultEur;
    total.internalMarkupEur += result.internalMarkupEur;
    total.markupWithResultEur += result.markupWithResultEur;
  }
  return {
    ...total,
    settledSavingsEur: cents(total.settledSavingsEur),
    settledOverrunsEur: cents(total.settledOverrunsEur),
    additionalCostsEur: cents(total.additionalCostsEur),
    unsettledOverrunsEur: cents(total.unsettledOverrunsEur),
    netResultEur: cents(total.netResultEur),
    internalMarkupEur: cents(total.internalMarkupEur),
    markupWithResultEur: cents(total.markupWithResultEur),
  };
}

function cents(amount: number): number {
  return Math.round(amount * 100) / 100;
}
