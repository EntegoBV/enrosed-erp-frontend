import type {
  Payee, PurchaseInstalmentReconciliation, PurchaseOrderView, PurchaseReconciliationStream, PurchaseReconciliationTotals, UnitCostBasis,
} from '../../core/api/models';
import type { PaymentLedger, PayeeStatusKind } from './purchase-payment-ledger';

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
  const streams = (report.streams ?? []).map(stream => streamResult(stream, eligible,
    stream.payee === 'SUPPLIER' ? report.supplierInstalments : undefined));
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

function streamResult(stream: PurchaseReconciliationStream, eligible: boolean,
  terms?: readonly PurchaseInstalmentReconciliation[]): PurchasePaymentResultStream {
  const planned = nonnegativeCents(stream.plannedEur);
  const paid = nonnegativeCents(stream.paidEur);
  const saved = nonnegativeCents(stream.settledSavingEur);
  const overpaid = nonnegativeCents(stream.overpaidEur);
  const known = planned !== null && paid !== null && saved !== null && overpaid !== null;
  const other = stream.payee === 'OTHER';
  const explicitlySettled = stream.explicitlySettled === true;
  const finalized = eligible && known && stream.finalized === true
    && (other || !!terms?.length || ((saved === 0 && overpaid === 0) || explicitlySettled));
  // A deposit or a missing historical EUR value must never look like a saving.
  let saving = eligible && !other && finalized && explicitlySettled ? saved! : 0;
  let settledOverrun = eligible && !other && finalized && explicitlySettled ? overpaid! : 0;
  let unsettledOverrun = eligible && !other && !finalized ? overpaid ?? 0 : 0;
  if (eligible && known && terms?.length) {
    // A settled 30% instalment can yield a confirmed saving while 70% stays open.
    // Read each canonical result once; never add the stream's same saving again.
    saving = 0;
    settledOverrun = 0;
    unsettledOverrun = 0;
    for (const term of terms) {
      const savedTerm = nonnegativeCents(term.settledSavingEur);
      const overpaidTerm = nonnegativeCents(term.overpaidEur);
      const knownTerm = nonnegativeCents(term.plannedEur) !== null && nonnegativeCents(term.paidEur) !== null
        && savedTerm !== null && overpaidTerm !== null;
      if (knownTerm && term.finalized && term.explicitlySettled) {
        saving += savedTerm!;
        settledOverrun += overpaidTerm!;
      } else if (overpaidTerm !== null && !term.finalized) unsettledOverrun += overpaidTerm;
    }
  }
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

/** Where the nacalculatie stands: a draft, a forecast, something to review, or final. */
export type NacalcKind = 'concept' | 'provisional' | 'review' | 'final';
export type NacalcTone = 'ok' | 'warn' | 'neutral' | 'outline';

/** The state pill, one word per kind, shared by the summary card and the full nacalculatie. */
export const NACALC_PILL: Readonly<Record<NacalcKind, { label: string; tone: NacalcTone }>> = {
  concept: { label: 'Nog niet besteld', tone: 'outline' },
  provisional: { label: 'Voorlopig', tone: 'neutral' },
  review: { label: 'Na te kijken', tone: 'warn' },
  final: { label: 'Definitief', tone: 'ok' },
};

/** What the headline figure is called in each state. */
export const NACALC_LABEL: Readonly<Record<NacalcKind, 'Begrote kost' | 'Verwachte eindkost' | 'Eindkost'>> = {
  concept: 'Begrote kost', provisional: 'Verwachte eindkost', review: 'Verwachte eindkost', final: 'Eindkost',
};

const REVIEW_STATUSES: ReadonlySet<PayeeStatusKind> = new Set<PayeeStatusKind>(['OVERPAID', 'UNBUDGETED', 'INCOMPLETE']);

/**
 * The state machine. With the ledger, a payee that is overpaid, unbudgeted or
 * incomplete (or figures that do not close) means review; without it the
 * server report alone decides: an unsettled overrun or a stream missing its
 * euro amount. Final needs every stream finalized on a non-concept order.
 */
export function nacalcKind(
  result: Pick<PurchasePaymentResult, 'eligible' | 'finalized' | 'unsettledOverrunsEur' | 'streams'>,
  totals: Pick<PurchaseReconciliationTotals, 'finalized'>,
  ledger?: Pick<PaymentLedger, 'payees' | 'summary'> | null,
): NacalcKind {
  if (!result.eligible) return 'concept';
  const ledgerReview = !!ledger && (!ledger.summary.balanced || ledger.payees.some(payee => REVIEW_STATUSES.has(payee.status.kind)));
  const serverReview = result.unsettledOverrunsEur > 0 || result.streams.some(stream => !stream.finalized && stream.paidEur === null);
  if (ledgerReview || serverReview) return 'review';
  return totals.finalized === true && result.finalized ? 'final' : 'provisional';
}

/** What the Betalingen workbench and the desk rail show of the Nacalculatie in one card, and what the full story starts from. */
export interface PurchaseNacalcSummary {
  eligible: boolean;
  finalized: boolean;
  /** The expected or final external cost: paid plus open. */
  forecastEur: number;
  /** Against the calculation in Kosten; positive is dearer. */
  varianceEur: number;
  netResultEur: number;
  internalMarkupEur: number;
  markupWithResultEur: number;
  kind: NacalcKind;
  label: 'Begrote kost' | 'Verwachte eindkost' | 'Eindkost';
  pill: { label: string; tone: NacalcTone };
  /** totals.remainingEur: what still has to be paid on the agreements. */
  openEur: number;
  /** Paid beyond an agreement and not yet settled: inside the forecast, apart from every result. */
  reviewEur: number;
  unitEur: number | null;
  unitQuantity: number;
  unitBasis: UnitCostBasis;
  /** The confirmed differences, as purchasePaymentResult counts them; the full nacalculatie explains the Verschil with these. */
  settledSavingsEur: number;
  settledOverrunsEur: number;
  additionalCostsEur: number;
}

export function purchaseNacalcSummary(
  view: Pick<PurchaseOrderView, 'order' | 'reconciliation'>, ledger?: Pick<PaymentLedger, 'payees' | 'summary'> | null,
): PurchaseNacalcSummary | null {
  const result = purchasePaymentResult(view);
  const totals = view.reconciliation?.totals;
  if (!result || !totals) return null;
  const kind = nacalcKind(result, totals, ledger);
  return {
    eligible: result.eligible,
    finalized: totals.finalized === true,
    forecastEur: totals.forecastExternalEur,
    varianceEur: totals.varianceEur,
    netResultEur: result.netResultEur,
    internalMarkupEur: result.internalMarkupEur,
    markupWithResultEur: result.markupWithResultEur,
    kind,
    label: NACALC_LABEL[kind],
    pill: NACALC_PILL[kind],
    openEur: totals.remainingEur,
    reviewEur: result.unsettledOverrunsEur,
    unitEur: totals.forecastExternalUnitEur ?? null,
    unitQuantity: totals.unitCostQuantity ?? 0,
    unitBasis: totals.unitCostBasis ?? 'ORDERED',
    settledSavingsEur: result.settledSavingsEur,
    settledOverrunsEur: result.settledOverrunsEur,
    additionalCostsEur: result.additionalCostsEur,
  };
}
