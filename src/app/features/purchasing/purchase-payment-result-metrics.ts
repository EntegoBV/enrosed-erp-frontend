import type { Payee, PurchaseOrderView, PurchaseReconciliationStream } from '../../core/api/models';

export interface PurchasePaymentResultStream {
  payee: Payee;
  label: string;
  savingEur: number;
  settledOverrunEur: number;
  additionalCostEur: number;
  unsettledOverrunEur: number;
  netResultEur: number;
  finalized: boolean;
  plannedEur: number | null;
  paidEur: number | null;
  paymentCount: number;
}

export interface PurchasePaymentResult {
  settledSavingsEur: number;
  settledOverrunsEur: number;
  additionalCostsEur: number;
  unsettledOverrunsEur: number;
  netResultEur: number;
  internalMarkupEur: number;
  markupWithResultEur: number;
  finalized: boolean;
  eligible: boolean;
  streams: PurchasePaymentResultStream[];
}

/**
 * A separate explanation of confirmed payment differences, not another cost or
 * revenue posting. Reconciliation forecasts already contain these differences;
 * adding this result to a forecast-based margin would count them twice.
 * Settlement, original payment FX and allocation remain server-owned.
 */
export function purchasePaymentResult(
  view: Pick<PurchaseOrderView, 'order' | 'reconciliation'>,
): PurchasePaymentResult | null {
  const report = view.reconciliation;
  if (!report) return null;
  const eligible = view.order.status !== 'CONCEPT' && (view.order.lines?.length ?? 0) > 0;
  const streams = (report.streams ?? []).map(stream => streamResult(stream, eligible));
  const sum = (field: 'savingEur' | 'settledOverrunEur' | 'additionalCostEur' | 'unsettledOverrunEur') =>
    streams.reduce((total, stream) => total + (cents(stream[field]) ?? 0), 0);
  const saving = sum('savingEur');
  const overrun = sum('settledOverrunEur');
  const additional = sum('additionalCostEur');
  const net = saving - overrun - additional;
  const markup = cents(report.totals.internalMarkupEur);
  return {
    settledSavingsEur: saving / 100,
    settledOverrunsEur: overrun / 100,
    additionalCostsEur: additional / 100,
    unsettledOverrunsEur: sum('unsettledOverrunEur') / 100,
    netResultEur: net / 100,
    internalMarkupEur: (markup ?? 0) / 100,
    markupWithResultEur: ((markup ?? 0) + net) / 100,
    finalized: eligible && markup !== null && report.totals.finalized === true
      && streams.length > 0 && streams.every(stream => stream.finalized),
    eligible,
    streams,
  };
}

function streamResult(stream: PurchaseReconciliationStream, eligible: boolean): PurchasePaymentResultStream {
  const planned = nonnegativeCents(stream.plannedEur);
  const paid = nonnegativeCents(stream.paidEur);
  const saved = nonnegativeCents(stream.settledSavingEur);
  const overpaid = nonnegativeCents(stream.overpaidEur);
  const known = planned !== null && paid !== null && saved !== null && overpaid !== null;
  const other = stream.payee === 'OTHER';
  const explicitlySettled = stream.explicitlySettled === true;
  const finalized = eligible && known && stream.finalized === true
    && (other || ((saved === 0 && overpaid === 0) || explicitlySettled));
  // A deposit or a missing historical EUR value must never look like a saving.
  const saving = eligible && !other && finalized && explicitlySettled ? saved! : 0;
  const settledOverrun = eligible && !other && finalized && explicitlySettled ? overpaid! : 0;
  const unsettledOverrun = eligible && !other && !finalized ? overpaid ?? 0 : 0;
  // OTHER is already-incurred cost; it has no agreed payable to settle.
  const additional = eligible && other ? paid ?? 0 : 0;
  return {
    payee: stream.payee,
    label: stream.label,
    savingEur: saving / 100,
    settledOverrunEur: settledOverrun / 100,
    additionalCostEur: additional / 100,
    unsettledOverrunEur: unsettledOverrun / 100,
    netResultEur: (saving - settledOverrun - additional) / 100,
    finalized,
    plannedEur: planned === null ? null : planned / 100,
    paidEur: paid === null ? null : paid / 100,
    paymentCount: Number.isSafeInteger(stream.paymentCount) && stream.paymentCount >= 0 ? stream.paymentCount : 0,
  };
}

function nonnegativeCents(value: unknown): number | null {
  const amount = cents(value);
  return amount !== null && amount >= 0 ? amount : null;
}

function cents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const amount = Math.round(value * 100);
  return Number.isSafeInteger(amount) ? amount : null;
}
