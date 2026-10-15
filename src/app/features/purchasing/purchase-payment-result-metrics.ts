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
 * euro amount. The bank's koersverschil on a foreign amount paid as agreed
 * (the ledger's fxEur) is no overrun to review: it stays provisional until
 * settled. Final needs every stream finalized on a non-concept order.
 */
export function nacalcKind(
  result: Pick<PurchasePaymentResult, 'eligible' | 'finalized' | 'unsettledOverrunsEur' | 'streams'>,
  totals: Pick<PurchaseReconciliationTotals, 'finalized'>,
  ledger?: Pick<PaymentLedger, 'payees' | 'summary'> | null,
): NacalcKind {
  if (!result.eligible) return 'concept';
  const ledgerReview = !!ledger && (!ledger.summary.balanced || ledger.payees.some(payee => REVIEW_STATUSES.has(payee.status.kind)));
  const serverReview = reviewOverrunEur(result, ledger) > 0 || result.streams.some(stream => !stream.finalized && stream.paidEur === null);
  if (ledgerReview || serverReview) return 'review';
  return totals.finalized === true && result.finalized ? 'final' : 'provisional';
}

/** The unsettled overrun still to review: the server's, less the koersverschil the ledger recognised (PayeeLedger.fxEur). */
function reviewOverrunEur(result: Pick<PurchasePaymentResult, 'unsettledOverrunsEur'>, ledger?: Pick<PaymentLedger, 'payees'> | null): number {
  const fx = (ledger?.payees ?? []).reduce((sum, payee) => sum + Math.round((payee.fxEur ?? 0) * 100), 0);
  return Math.max(0, Math.round(result.unsettledOverrunsEur * 100) - fx) / 100;
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
  /** Paid beyond an agreement and not yet settled: inside the forecast, apart from every result; a koersverschil is not in it. */
  reviewEur: number;
  unitEur: number | null;
  unitQuantity: number;
  unitBasis: UnitCostBasis;
  /** Per display / per stuk: stuk (PIECE), display (DISPLAY) or verkoopeenheid (MIXED, then the card shows the average per piece). */
  unitWord: 'stuk' | 'display' | 'verkoopeenheid';
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
  /** Per display for a display product, per stuk otherwise. */
  unit: 'display' | 'stuk';
  unitEur: number | null;
  /** A display product's figure per piece, and its size ('12 rozen'). */
  pieceEur: number | null;
  set: { pieces: number; other: string } | null;
  valueEur: number;
  /** The same with the Enrosed kost, per unit and per piece. */
  pricingUnitEur: number | null;
  pricingPieceEur: number | null;
  /** The cost per ordered unit, against unitEur per usable unit once the container is received. */
  orderedUnitEur: number | null;
}

/**
 * Per product, never a mixed average (Emre, 2026-10-15: 'Per stuk € 2,4473 ·
 * 6.920 bestelde stuks — want als meerdere producten dan klopt dat niet').
 * The container's per-unit figure stands only when it holds one product
 * (variants of one family are different products too); otherwise the screens
 * show '2 producten · € min – € max per stuk' (per display when every line is a
 * display of one size, else per stuk with displays at their piece price) and the
 * products by value. No average over the products is shown anywhere, not
 * even as a sub-line.
 */
export interface NacalcUnitMix {
  uniform: boolean;
  /** Distinct products. */
  count: number;
  /** The unit of the range: per display when every line is a display of one size, else per stuk. */
  unit: 'display' | 'stuk';
  minEur: number | null;
  maxEur: number | null;
  /** The range with the Enrosed kost. */
  pricingMinEur: number | null;
  pricingMaxEur: number | null;
  /** Every product, the most valuable first; the cards show the first three. */
  rows: NacalcMixRow[];
  /** How many units (in `unit`, displays counted with their pieces per stuk) the figures rest on: '7.976 st'. */
  quantity: number;
}

/**
 * The products of a container against its per-unit figure. The server's
 * totals.containerAverage decides when it is there; an older server leaves
 * it to the same rule here (ReconciliationUnits.containerAverage): one
 * product at most.
 */
export function nacalcUnitMix(
  report: { lines: readonly PurchaseReconciliationLine[]; totals: PurchaseReconciliationTotals } | null | undefined,
): NacalcUnitMix {
  const lines = report?.lines ?? [];
  const totals = report?.totals;
  const keyOf = (line: PurchaseReconciliationLine) => line.productId != null ? 'p' + line.productId : 'n' + line.productName;
  const products = new Map<string, PurchaseReconciliationLine[]>();
  for (const line of lines) products.set(keyOf(line), [...(products.get(keyOf(line)) ?? []), line]);
  const unitOf = (line: PurchaseReconciliationLine) => `${line.salesUnit ?? 'PIECE'}|${line.salesUnit === 'DISPLAY' ? line.piecesPerUnit ?? 1 : 1}`;
  const sameUnit = new Set(lines.map(unitOf)).size <= 1;
  // The server says it since round 2; an older one leaves it to the same rule here: one product, never a family of them.
  const uniform = typeof totals?.containerAverage === 'boolean' ? totals.containerAverage : products.size <= 1;
  const allSets = lines.length > 0 && sameUnit && lines.every(line => line.salesUnit === 'DISPLAY');
  const unit: 'display' | 'stuk' = allSets ? 'display' : 'stuk';
  const rows: NacalcMixRow[] = [...products.values()].map((group): NacalcMixRow => {
    const first = group[0];
    const set = first.salesUnit === 'DISPLAY';
    const sumCents = (pick: (line: PurchaseReconciliationLine) => number | null | undefined) =>
      group.reduce((sum, line) => sum + Math.round((pick(line) ?? 0) * 100), 0) / 100;
    const value = sumCents(line => line.forecastExternalEur);
    const pricing = sumCents(line => line.forecastPricingEur);
    const quantity = group.reduce((sum, line) => sum + (line.unitCostQuantity ?? 0), 0);
    const ordered = group.reduce((sum, line) => sum + (line.orderedQuantity ?? 0), 0);
    const pieces = group.reduce((sum, line) => sum + (line.pieceQuantity ?? line.unitCostQuantity ?? 0), 0);
    const unitEur = group.length === 1 ? first.forecastExternalUnitEur ?? null : quantity > 0 ? round4(value / quantity) : null;
    const pieceEur = group.length === 1 ? first.forecastExternalPieceEur ?? (set ? null : first.forecastExternalUnitEur ?? null)
      : pieces > 0 ? round4(value / pieces) : null;
    const pricingUnitEur = group.length === 1 ? first.forecastPricingUnitEur ?? null : quantity > 0 && pricing > 0 ? round4(pricing / quantity) : null;
    const pricingPieceEur = group.length === 1 ? first.forecastPricingPieceEur ?? (set ? null : first.forecastPricingUnitEur ?? null)
      : pieces > 0 && pricing > 0 ? round4(pricing / pieces) : null;
    return { productId: first.productId ?? null, name: first.productName, unit: set ? 'display' : 'stuk', unitEur, pieceEur,
      set: set ? { pieces: first.piecesPerUnit ?? 1, other: first.unitOther || 'stuks' } : null, valueEur: value,
      pricingUnitEur, pricingPieceEur, orderedUnitEur: ordered > 0 ? round4(value / ordered) : null };
  }).sort((left, right) => right.valueEur - left.valueEur || left.name.localeCompare(right.name, 'nl'));
  const finite = (values: (number | null)[]) => values.filter((value): value is number => value !== null && Number.isFinite(value));
  const figures = finite(rows.map(row => unit === 'display' ? row.unitEur : row.pieceEur));
  const pricing = finite(rows.map(row => unit === 'display' ? row.pricingUnitEur : row.pricingPieceEur));
  const quantity = !totals ? 0 : unit === 'display' ? totals.unitCostQuantity ?? 0 : totals.unitCostPieceQuantity ?? totals.unitCostQuantity ?? 0;
  return {
    uniform,
    count: totals?.productCount && totals.productCount > 0 ? totals.productCount : products.size,
    unit,
    minEur: figures.length ? Math.min(...figures) : null,
    maxEur: figures.length ? Math.max(...figures) : null,
    pricingMinEur: pricing.length === figures.length && pricing.length ? Math.min(...pricing) : null,
    pricingMaxEur: pricing.length === figures.length && pricing.length ? Math.max(...pricing) : null,
    rows,
    quantity,
  };
}

const round4 = (value: number): number => Math.round(value * 10000) / 10000;

/**
 * One product's cost in its own unit, as Analyses › Inkoop writes it (the
 * container table, the Afrekening and its Per product list): a display product
 * per display with the piece price beside it ('€ 30,9600 per display · € 2,5800 per
 * stuk · 400 bestelde displays'), a product sold per piece per stuk. Only for a
 * container's own figure when it holds one product (nacalcUnitMix.uniform),
 * or for one product line; several products get their range instead.
 */
export interface ReconciliationUnit {
  unit: 'display' | 'stuk';
  plural: 'displays' | 'stuks';
  unitEur: number | null;
  /** A display's figure per stuk; null for a product sold per stuk (its unitEur is already per stuk). */
  pieceEur: number | null;
  pricingUnitEur: number | null;
  pricingPieceEur: number | null;
  /** What the figure rests on, in `unit`: displays for a display product. */
  quantity: number;
  /** Bruikbaar ontvangen (after receipt) or besteld. */
  usable: boolean;
}

/**
 * The container's own figure in its unit: per display when every line is a display of
 * one size (setBasis DISPLAY), per stuk otherwise; displays beside pieces (MIXED)
 * count per stuk with their pieces. Without the server's set fields (setBasis, setPieces): per stuk.
 */
export function reconciliationUnit(totals: PurchaseReconciliationTotals): ReconciliationUnit {
  const usable = totals.unitCostBasis === 'USABLE_RECEIVED';
  const basis = totals.setBasis ?? 'PIECE';
  if (basis === 'DISPLAY') {
    return setUnit(totals.forecastExternalUnitEur ?? null, totals.forecastExternalPieceEur, totals.forecastPricingUnitEur ?? null,
      totals.forecastPricingPieceEur, totals.setPieces ?? null, totals.unitCostQuantity ?? 0, usable);
  }
  if (basis === 'MIXED') {
    return { unit: 'stuk', plural: 'stuks', unitEur: totals.forecastExternalPieceEur ?? null, pieceEur: null,
      pricingUnitEur: totals.forecastPricingPieceEur ?? null, pricingPieceEur: null,
      quantity: totals.unitCostPieceQuantity ?? totals.unitCostQuantity ?? 0, usable };
  }
  return { unit: 'stuk', plural: 'stuks', unitEur: totals.forecastExternalUnitEur ?? null, pieceEur: null,
    pricingUnitEur: totals.forecastPricingUnitEur ?? null, pricingPieceEur: null, quantity: totals.unitCostQuantity ?? 0, usable };
}

/** One product line in its unit: a display (sales unit DISPLAY) per display with its piece price, else per stuk. */
export function reconciliationLineUnit(line: PurchaseReconciliationLine): ReconciliationUnit {
  const usable = line.unitCostBasis === 'USABLE_RECEIVED';
  if (line.salesUnit === 'DISPLAY') {
    return setUnit(line.forecastExternalUnitEur ?? null, line.forecastExternalPieceEur, line.forecastPricingUnitEur ?? null,
      line.forecastPricingPieceEur, line.piecesPerUnit ?? null, line.unitCostQuantity ?? 0, usable);
  }
  return { unit: 'stuk', plural: 'stuks', unitEur: line.forecastExternalUnitEur ?? null, pieceEur: null,
    pricingUnitEur: line.forecastPricingUnitEur ?? null, pricingPieceEur: null, quantity: line.unitCostQuantity ?? 0, usable };
}

/** A display's figures: the server's piece price, else the display price over its pieces. */
function setUnit(unitEur: number | null, pieceEur: number | null | undefined, pricingUnitEur: number | null, pricingPieceEur: number | null | undefined,
  pieces: number | null, quantity: number, usable: boolean): ReconciliationUnit {
  const per = (value: number | null, server: number | null | undefined) =>
    server ?? (value !== null && pieces && pieces > 0 ? round4(value / pieces) : null);
  return { unit: 'display', plural: 'displays', unitEur, pieceEur: per(unitEur, pieceEur), pricingUnitEur,
    pricingPieceEur: per(pricingUnitEur, pricingPieceEur), quantity, usable };
}
const EURO4 = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 4, maximumFractionDigits: 4 });
const eur4 = (value: number): string => EURO4.format(value);

/** '€ 2,6339 – € 8,9465': the cheapest and the dearest product per unit. */
export function mixRange(mix: Pick<NacalcUnitMix, 'minEur' | 'maxEur'>): string {
  if (mix.minEur === null || mix.maxEur === null) return '—';
  return Math.round(mix.minEur * 10000) === Math.round(mix.maxEur * 10000) ? eur4(mix.minEur) : `${eur4(mix.minEur)} – ${eur4(mix.maxEur)}`;
}

/** The same range with the Enrosed kost: '€ 2,8314 – € 9,6175', or null when a product has no such figure. */
export function mixPricingRange(mix: Pick<NacalcUnitMix, 'pricingMinEur' | 'pricingMaxEur'>): string | null {
  return mix.pricingMinEur === null || mix.pricingMaxEur === null ? null : mixRange({ minEur: mix.pricingMinEur, maxEur: mix.pricingMaxEur });
}

/** '2 producten · € 2,6339 – € 8,9465 per stuk' (per display when every line is a display of one size). */
export function mixHeadline(mix: Pick<NacalcUnitMix, 'count' | 'minEur' | 'maxEur' | 'unit'>): string {
  return `${mix.count} producten · ${mixRange(mix)} per ${mix.unit}`;
}

/** What the products' figures rest on, without any average: '7.976 st' or '498 displays'. Null without a count. */
export function mixQuantity(mix: Pick<NacalcUnitMix, 'quantity' | 'unit'>): string | null {
  if (!(mix.quantity > 0)) return null;
  return `${mix.quantity.toLocaleString('nl-BE')} ${mix.unit === 'display' ? 'displays' : 'st'}`;
}

/** One product as the cards list it: '€ 31,6072 /display · € 2,6339 /stuk' or '€ 8,9465 /stuk'. */
export function mixRowFigure(row: Pick<NacalcMixRow, 'unit' | 'unitEur' | 'pieceEur'>): string {
  if (row.unit === 'display') {
    return [row.unitEur !== null ? eur4(row.unitEur) + ' /display' : null, row.pieceEur !== null ? eur4(row.pieceEur) + ' /stuk' : null].filter(Boolean).join(' · ') || '—';
  }
  return row.unitEur !== null ? eur4(row.unitEur) + ' /stuk' : '—';
}

/**
 * The receipt's effect per product, never over the container: the products
 * whose cost per usable unit moved, then how many did not. 'Long stem rose
 * box: kost per bruikbare display € 31,6072, per bestelde display zou dit € 31,4808
 * zijn (+ € 0,1264) · 1 ander product zonder verschil'. Null when no product
 * has both figures.
 */
export function mixReceiptLine(mix: Pick<NacalcUnitMix, 'rows'>): string | null {
  const known = mix.rows.filter(row => row.unitEur !== null && row.orderedUnitEur !== null);
  if (!known.length) return null;
  const moved = known.filter(row => Math.round(row.unitEur! * 10000) !== Math.round(row.orderedUnitEur! * 10000));
  const words = moved.map(row => {
    const delta = round4(row.unitEur! - row.orderedUnitEur!);
    const sign = delta > 0 ? '+ ' : '− ';
    return `${row.name}: kost per bruikbare ${row.unit} ${eur4(row.unitEur!)}, per bestelde ${row.unit} zou dit ${eur4(row.orderedUnitEur!)} zijn (${sign}${eur4(Math.abs(delta))})`;
  });
  const still = known.length - moved.length;
  if (still) words.push(moved.length ? `${still} ${still === 1 ? 'ander product' : 'andere producten'} zonder verschil` : 'Geen product verandert van kost per eenheid');
  return words.join(' · ');
}

/**
 * The calculation's landed cost per unit as the order header and the Kosten
 * chain say it (eurUp: 3 in the template). One product (`uniform`, the
 * Nacalculatie's rule): the container's own
 * figure, per display with the piece price beside it for a display product
 * ('€ 30,960 per display · € 2,580 per stuk'). Several products: their count and
 * range, per display when every line is a display of one size, else per stuk with a
 * display at its piece price ('2 producten · € 2,600 – € 8,867 per stuk'); never
 * an average over different products. Null without lines.
 */
export interface LandedUnit {
  mix: boolean;
  /** Distinct products. */
  count: number;
  unit: 'display' | 'stuk';
  /** One figure: the container's per-unit cost; several products: the cheapest and the dearest. */
  unitEur: number;
  maxEur: number;
  /** The pieces of a display when the one figure is per display: its piece price is unitEur / setPieces. */
  setPieces: number | null;
}

export function landedUnit(
  lines: readonly { productId: number; quantity: number; totalEur: number }[], averageUnitEur: number, uniform: boolean,
  setPiecesOf: (productId: number) => number | null,
): LandedUnit | null {
  if (!lines.length) return null;
  const products = new Map<number, { quantity: number; totalEur: number }>();
  for (const line of lines) {
    const product = products.get(line.productId) ?? { quantity: 0, totalEur: 0 };
    products.set(line.productId, { quantity: product.quantity + line.quantity, totalEur: product.totalEur + line.totalEur });
  }
  const sizes = new Set([...products.keys()].map(id => setPiecesOf(id) ?? 1));
  const allSets = [...products.keys()].every(id => setPiecesOf(id) !== null) && sizes.size === 1;
  const setPieces = allSets ? [...sizes][0] : null;
  if (uniform || products.size === 1) {
    return { mix: false, count: products.size, unit: setPieces ? 'display' : 'stuk', unitEur: averageUnitEur, maxEur: averageUnitEur, setPieces };
  }
  const figures = [...products.entries()].filter(([, product]) => product.quantity > 0)
    .map(([id, product]) => product.totalEur / product.quantity / (allSets ? 1 : setPiecesOf(id) ?? 1));
  if (!figures.length) return null;
  return { mix: true, count: products.size, unit: allSets ? 'display' : 'stuk', unitEur: Math.min(...figures), maxEur: Math.max(...figures), setPieces: null };
}

/** The words of landedUnit with `money` as the template's eurUp: 3 writes it. */
export function landedUnitText(unit: LandedUnit | null, money: (value: number) => string): string {
  if (!unit) return '';
  if (unit.mix) {
    // The range never breaks inside itself in a narrow tile: no-break spaces, and a word joiner after the dash (a line may break after a dash).
    const range = money(unit.unitEur) === money(unit.maxEur) ? money(unit.unitEur) : `${money(unit.unitEur)}\u00a0–\u2060\u00a0${money(unit.maxEur)}`;
    return `${unit.count} producten · ${range} per ${unit.unit}`;
  }
  return unit.setPieces ? `${money(unit.unitEur)} per display · ${money(unit.unitEur / unit.setPieces)} per stuk` : `${money(unit.unitEur)} per stuk`;
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
    reviewEur: reviewOverrunEur(result, ledger),
    unitEur: totals.forecastExternalUnitEur ?? null,
    unitQuantity: totals.unitCostQuantity ?? 0,
    unitBasis: totals.unitCostBasis ?? 'ORDERED',
    unitWord: totals.setBasis === 'DISPLAY' ? 'display' : totals.setBasis === 'MIXED' ? 'verkoopeenheid' : 'stuk',
    pieceEur: totals.forecastExternalPieceEur ?? null,
    pieceQuantity: totals.unitCostPieceQuantity ?? totals.unitCostQuantity ?? 0,
    setPieces: totals.setPieces ?? null,
    settledSavingsEur: result.settledSavingsEur,
    settledOverrunsEur: result.settledOverrunsEur,
    additionalCostsEur: result.additionalCostsEur,
    mix: nacalcUnitMix(view.reconciliation),
  };
}
