import type {
  Payee, PurchaseInstalmentReconciliation, PurchaseOrderView, PurchaseReconciliationLine, PurchaseReconciliationStream, PurchaseReconciliationTotals,
  UnitCostBasis,
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

/** What the headline figure is called in each state; the pill carries the state, so a concept reads like any forecast. */
export const NACALC_LABEL: Readonly<Record<NacalcKind, 'Verwachte eindkost' | 'Eindkost'>> = {
  concept: 'Verwachte eindkost', provisional: 'Verwachte eindkost', review: 'Verwachte eindkost', final: 'Eindkost',
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
  label: 'Verwachte eindkost' | 'Eindkost';
  pill: { label: string; tone: NacalcTone };
  /** totals.remainingEur: what still has to be paid on the agreements. */
  openEur: number;
  /** Paid beyond an agreement and not yet settled: inside the forecast, apart from every result. */
  reviewEur: number;
  unitEur: number | null;
  unitQuantity: number;
  unitBasis: UnitCostBasis;
  /** Per set / per stuk: stuk (PIECE), set (DISPLAY) or verkoopeenheid (MIXED, then the card shows the average per piece). */
  unitWord: 'stuk' | 'set' | 'verkoopeenheid';
  pieceEur: number | null;
  pieceQuantity: number;
  setPieces: number | null;
  /** The confirmed differences, as purchasePaymentResult counts them; the full nacalculatie explains the Verschil with these. */
  settledSavingsEur: number;
  settledOverrunsEur: number;
  additionalCostsEur: number;
  /** One product or several: whether the container's per-unit figure means anything, else the products' range (nacalcUnitMix). */
  mix: NacalcUnitMix;
}

/** One product of a container with its landed cost per unit, as the cards list them. */
export interface NacalcMixRow {
  productId: number | null;
  name: string;
  /** Per set for a set product, per stuk otherwise. */
  unit: 'set' | 'stuk';
  unitEur: number | null;
  /** A set product's figure per piece, and its size ('12 rozen'). */
  pieceEur: number | null;
  set: { pieces: number; other: string } | null;
  valueEur: number;
}

/**
 * Per product instead of a mixed average (Emre, 2026-10-15: 'Per stuk
 * € 2,4473 · 6.920 bestelde stuks — want als meerdere producten dan klopt dat
 * niet'). The container's per-unit figure stands only when it holds one
 * product, or every line shares the product family, the sales unit and the
 * set size; otherwise the screens show 'n producten · € min – € max' (per set
 * when every line is a set of one size, else per stuk with sets at their
 * piece price), the products by value, and the average as a sub-line only.
 */
export interface NacalcUnitMix {
  uniform: boolean;
  /** Distinct products. */
  count: number;
  /** The unit of the range and the average: per set when every line is a set of one size, else per stuk. */
  unit: 'set' | 'stuk';
  minEur: number | null;
  maxEur: number | null;
  /** Every product, the most valuable first; the cards show the first three. */
  rows: NacalcMixRow[];
  /** The container average in `unit` and how many units it spreads over: 'gem. € 4,2168 over 7.976 st'. */
  averageEur: number | null;
  averageQuantity: number;
}

/**
 * The products of a container against its per-unit figure. The server's
 * totals.containerAverage decides when it is there; else `familyOf` maps a
 * product to its family (null without one) and without it only one product
 * is uniform.
 */
export function nacalcUnitMix(
  report: { lines: readonly PurchaseReconciliationLine[]; totals: PurchaseReconciliationTotals } | null | undefined,
  familyOf: (productId: number) => number | null = () => null,
): NacalcUnitMix {
  const lines = report?.lines ?? [];
  const totals = report?.totals;
  const keyOf = (line: PurchaseReconciliationLine) => line.productId != null ? 'p' + line.productId : 'n' + line.productName;
  const products = new Map<string, PurchaseReconciliationLine[]>();
  for (const line of lines) products.set(keyOf(line), [...(products.get(keyOf(line)) ?? []), line]);
  const unitOf = (line: PurchaseReconciliationLine) => `${line.salesUnit ?? 'PIECE'}|${line.salesUnit === 'DISPLAY' ? line.piecesPerUnit ?? 1 : 1}`;
  const families = new Set(lines.map(line => line.productId != null ? familyOf(line.productId) : null));
  const sameUnit = new Set(lines.map(unitOf)).size <= 1;
  const oneFamily = families.size === 1 && !families.has(null);
  // The server says it since round 2 (it knows every product's family); an older one leaves it to the same rule here.
  const uniform = typeof totals?.containerAverage === 'boolean' ? totals.containerAverage : products.size <= 1 || (oneFamily && sameUnit);
  const allSets = lines.length > 0 && sameUnit && lines.every(line => line.salesUnit === 'DISPLAY');
  const unit: 'set' | 'stuk' = allSets ? 'set' : 'stuk';
  const rows: NacalcMixRow[] = [...products.values()].map((group): NacalcMixRow => {
    const first = group[0];
    const set = first.salesUnit === 'DISPLAY';
    const value = group.reduce((sum, line) => sum + Math.round((line.forecastExternalEur ?? 0) * 100), 0) / 100;
    const quantity = group.reduce((sum, line) => sum + (line.unitCostQuantity ?? 0), 0);
    const pieces = group.reduce((sum, line) => sum + (line.pieceQuantity ?? line.unitCostQuantity ?? 0), 0);
    const unitEur = group.length === 1 ? first.forecastExternalUnitEur ?? null : quantity > 0 ? round4(value / quantity) : null;
    const pieceEur = group.length === 1 ? first.forecastExternalPieceEur ?? (set ? null : first.forecastExternalUnitEur ?? null)
      : pieces > 0 ? round4(value / pieces) : null;
    return { productId: first.productId ?? null, name: first.productName, unit: set ? 'set' : 'stuk', unitEur, pieceEur,
      set: set ? { pieces: first.piecesPerUnit ?? 1, other: first.unitOther || 'stuks' } : null, valueEur: value };
  }).sort((left, right) => right.valueEur - left.valueEur || left.name.localeCompare(right.name, 'nl'));
  const figures = rows.map(row => unit === 'set' ? row.unitEur : row.pieceEur).filter((value): value is number => value !== null && Number.isFinite(value));
  const setBasis = totals?.setBasis ?? 'PIECE';
  const averageEur = !totals ? null : unit === 'set' ? totals.forecastExternalUnitEur ?? null
    : totals.forecastExternalPieceEur ?? (setBasis === 'PIECE' ? totals.forecastExternalUnitEur ?? null : null);
  const averageQuantity = !totals ? 0 : unit === 'set' ? totals.unitCostQuantity ?? 0 : totals.unitCostPieceQuantity ?? totals.unitCostQuantity ?? 0;
  return {
    uniform,
    count: totals?.productCount && totals.productCount > 0 ? totals.productCount : products.size,
    unit,
    minEur: figures.length ? Math.min(...figures) : null,
    maxEur: figures.length ? Math.max(...figures) : null,
    rows,
    averageEur,
    averageQuantity,
  };
}

const round4 = (value: number): number => Math.round(value * 10000) / 10000;
const EURO4 = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 4, maximumFractionDigits: 4 });
const eur4 = (value: number): string => EURO4.format(value);

/** '€ 2,6339 – € 8,9465': the cheapest and the dearest product per unit. */
export function mixRange(mix: Pick<NacalcUnitMix, 'minEur' | 'maxEur'>): string {
  if (mix.minEur === null || mix.maxEur === null) return '—';
  return Math.round(mix.minEur * 10000) === Math.round(mix.maxEur * 10000) ? eur4(mix.minEur) : `${eur4(mix.minEur)} – ${eur4(mix.maxEur)}`;
}

/** '2 producten · € 2,6339 – € 8,9465' (per stuk, or per set when every line is a set of one size). */
export function mixHeadline(mix: Pick<NacalcUnitMix, 'count' | 'minEur' | 'maxEur'>): string {
  return `${mix.count} producten · ${mixRange(mix)}`;
}

/** 'gem. € 4,2168 over 7.976 st' or 'gem. € 31,6072 over 498 sets': the container average, kept as a sub-line. */
export function mixAverage(mix: Pick<NacalcUnitMix, 'averageEur' | 'averageQuantity' | 'unit'>): string | null {
  if (mix.averageEur === null || !Number.isFinite(mix.averageEur)) return null;
  return `gem. ${eur4(mix.averageEur)} over ${mix.averageQuantity.toLocaleString('nl-BE')} ${mix.unit === 'set' ? 'sets' : 'st'}`;
}

/** One product as the cards list it: '€ 31,6072 /set · € 2,6339 /stuk' or '€ 8,9465 /stuk'. */
export function mixRowFigure(row: Pick<NacalcMixRow, 'unit' | 'unitEur' | 'pieceEur'>): string {
  if (row.unit === 'set') {
    return [row.unitEur !== null ? eur4(row.unitEur) + ' /set' : null, row.pieceEur !== null ? eur4(row.pieceEur) + ' /stuk' : null].filter(Boolean).join(' · ') || '—';
  }
  return row.unitEur !== null ? eur4(row.unitEur) + ' /stuk' : '—';
}

export function purchaseNacalcSummary(
  view: Pick<PurchaseOrderView, 'order' | 'reconciliation'>, ledger?: Pick<PaymentLedger, 'payees' | 'summary'> | null,
  familyOf?: (productId: number) => number | null,
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
    unitWord: totals.setBasis === 'DISPLAY' ? 'set' : totals.setBasis === 'MIXED' ? 'verkoopeenheid' : 'stuk',
    pieceEur: totals.forecastExternalPieceEur ?? null,
    pieceQuantity: totals.unitCostPieceQuantity ?? totals.unitCostQuantity ?? 0,
    setPieces: totals.setPieces ?? null,
    settledSavingsEur: result.settledSavingsEur,
    settledOverrunsEur: result.settledOverrunsEur,
    additionalCostsEur: result.additionalCostsEur,
    mix: nacalcUnitMix(view.reconciliation, familyOf),
  };
}
