import type {
  Currency, PartnerFinancing, Payee, PurchaseOrderView, PurchaseReconciliationStream, PurchaseReconciliationTotals, UnitCostBasis,
} from '../../core/api/models';
import type {
  Due, LedgerTerm, LedgerTone, PayeeLedger, PayeeStatus, PaymentLedger, PurchasePaymentAction, PurchaseSettleRequest,
} from './purchase-payment-ledger';
import type { NacalcKind, NacalcTone, NacalcUnitMix, PurchaseNacalcSummary } from './purchase-payment-result-metrics';

export type { NacalcKind, NacalcTone } from './purchase-payment-result-metrics';

/**
 * The nacalculatie of a container as one story: what it was budgeted at, what
 * it will cost or cost, where the difference sits per payee, what the receipt
 * did to the piece price, and what the partner finances. Pure and node
 * tested; cents everywhere; the server stays the judge of allocation,
 * settlement and FX (reconciliation, receiptVariance) and the ledger the judge
 * of what is due, so nothing here derives a saving from budget minus paid.
 *
 * The confirmed differences (purchasePaymentResult) and the state pill arrive
 * through the PurchaseNacalcSummary the host already computes: this module
 * imports types only, so a node test can load it without a harness.
 */

export type NacalcReason = 'none' | 'open' | 'partly-settled' | 'settled-lower' | 'settled-higher' | 'review' | 'fx' | 'additional'
  | 'unbudgeted' | 'incomplete' | 'legacy' | 'credit' | 'offset';

/**
 * Per display / per stuk (2026-10-15). A display product (sales unit DISPLAY, e.g. a
 * box of 12 stem roses) is counted and priced per display; the server adds the
 * per-piece figures. PIECE: every line per piece (as before); DISPLAY: every
 * line a display of the same size and noun, the container figure per display; MIXED:
 * displays and pieces (or displays of different sizes) together, the container
 * average per piece. Quantities and unit figures of the server stay per sales
 * unit; only the words and the added per-piece figures differ.
 */
export type NacalcSetBasis = 'PIECE' | 'DISPLAY' | 'MIXED';
export type NacalcUnitWord = 'stuk' | 'display' | 'verkoopeenheid';
const UNIT_TEXT: Readonly<Record<NacalcSetBasis, { word: NacalcUnitWord; plural: string; label: string; column: string; pricing: string }>> = {
  PIECE: { word: 'stuk', plural: 'stuks', label: 'Per stuk', column: 'Per stuk', pricing: 'Per stuk incl. Enrosed kost' },
  DISPLAY: { word: 'display', plural: 'displays', label: 'Per display', column: 'Per display', pricing: 'Per display incl. Enrosed kost' },
  MIXED: { word: 'verkoopeenheid', plural: 'verkoopeenheden', label: 'Gem. per stuk', column: 'Per eenheid', pricing: 'Gem. per stuk incl. Enrosed kost' },
};

export interface NacalcHeadline {
  kind: NacalcKind;
  label: 'Verwachte eindkost' | 'Eindkost';
  pill: { label: string; tone: NacalcTone };
  sentence: string;
  eindkostEur: number;
  begrootEur: number;
  paidEur: number;
  openEur: number;
  dueNowEur: number;
  laterEur: number;
  verschilEur: number;
  /** One decimal, of the budget; null without a budget. */
  verschilPct: number | null;
  reviewEur: number;
  additionalEur: number;
  fxEur: number;
  /** Tegoed leverancier: every credit (it lowers the eindkost) and the part still to receive. */
  creditEur: number;
  creditOpenEur: number;
  unitEur: number | null;
  unitQuantity: number;
  unitBasis: UnitCostBasis;
  orderedQuantity: number;
  /** After receipt: the same cost over the ordered pieces, so the receipt's effect reads as a delta. */
  unitOrderedEur: number | null;
  unitDeltaEur: number | null;
  pricingUnitEur: number | null;
  markupEur: number;
  pricingEur: number;
  landedEur: number;
  landedWithSeparateEur: number;
  separateApart: boolean;
  includesInspection: boolean;
  ddp: boolean;
  /** Per display / per stuk: PIECE without the server's fields. */
  setBasis: NacalcSetBasis;
  /** The pieces per display shared by every display line, and their plural noun ('rozen'); null otherwise. */
  setPieces: number | null;
  setUnitOther: string | null;
  /** The container's cost per piece (displays counted with their pieces); null without the server's fields. */
  pieceEur: number | null;
  pricingPieceEur: number | null;
  /** The pieces the cost is spread over (ordered, or usable after receipt), and both counts. */
  pieceQuantity: number;
  orderedPieceQuantity: number;
  usablePieceQuantity: number;
  /** The counting word of the container: stuk(s), display(s) or verkoopeenhe(i)d(en). */
  unitWord: NacalcUnitWord;
  unitPlural: string;
  /** 'Per stuk' | 'Per display' | 'Gem. per stuk': the strip, the phone hero and the summary card. */
  unitLabel: string;
  /** The product table's column: 'Per stuk' | 'Per display' | 'Per eenheid'. */
  unitColumn: string;
  pricingUnitLabel: string;
  /** The figure under unitLabel: per display or per stuk, the average per piece in a mixed container. */
  stripUnitEur: number | null;
  stripPricingEur: number | null;
}

export interface NacalcTermRow {
  due: Due;
  label: string;
  agreedEur: number;
  paidEur: number;
  openEur: number;
  verschilEur: number;
  /** Why the term differs, beside its pill; 'none' when the pill says it all (a netted term's pill can name the other term). */
  reason: NacalcReason;
  reasonLabel: string;
  status: { label: string; tone: LedgerTone };
}

export interface NacalcPayeeRow {
  payee: Payee;
  label: string;
  icon: string;
  tone: string;
  basis: string;
  ddpNote: boolean;
  /** Douane & transport of a CIF container: the sea freight is paid to the supplier. */
  cifNote: boolean;
  legacy: boolean;
  legacyEur: number;
  agreedEur: number | null;
  paidEur: number;
  paidForeign: { amount: number; currency: Currency } | null;
  openEur: number;
  dueNowEur: number;
  laterEur: number;
  eindkostEur: number;
  verschilEur: number;
  reason: NacalcReason;
  reasonLabel: string;
  fxEur: number;
  /** Leverancier only: the credits that lower its eindkost, and what is still to receive of them. */
  creditEur: number;
  creditOpenEur: number;
  status: PayeeStatus;
  action: 'add' | 'settle' | null;
  actionLabel: 'Noteer ›' | 'Afrekenen…' | 'Nakijken…' | null;
  payAction: PurchasePaymentAction | null;
  settleDefault: PurchaseSettleRequest;
  canUndoSettle: boolean;
  terms: NacalcTermRow[];
  termsMixed: boolean;
}

export interface NacalcReceipt {
  ordered: number;
  received: number;
  missing: number;
  over: number;
  damaged: number;
  usable: number;
  missingValueEur: number | null;
  damagedValueEur: number | null;
  lossEur: number | null;
  unvaluedPieces: number;
  valuationComplete: boolean;
  /** What the supplier may still invoice for the extra pieces; null when a unit value is missing. */
  overValueEur: number | null;
  unitOrderedEur: number | null;
  unitUsableEur: number | null;
  unitDeltaEur: number | null;
  /** The same per piece (displays counted with their pieces): usable, as if every ordered piece had come. */
  pieceUsableEur: number | null;
  pieceOrderedEur: number | null;
  supplierFact: { kind: 'settled-lower' | 'open' | 'paid-full'; amountEur: number } | null;
  /** Tegoed leverancier noted on this container: in total and still to receive. */
  credit: { totalEur: number; openEur: number; count: number } | null;
  later: { count: number; damaged: number; missing: number; products: string[] } | null;
  clean: boolean;
}

export interface NacalcProductRow {
  productId: number | null;
  name: string;
  ordered: number;
  received: number;
  missing: number;
  over: number;
  damaged: number;
  usable: number;
  unitQuantity: number;
  unitBasis: UnitCostBasis;
  begrootEur: number;
  eindkostEur: number;
  verschilEur: number;
  unitEur: number | null;
  pricingUnitEur: number | null;
  /** A display product: its size and nouns ('× 12 rozen'); null for a product sold per piece. */
  set: { pieces: number; one: string; other: string } | null;
  unitPieceEur: number | null;
  pricingPieceEur: number | null;
  pieceQuantity: number;
}

export interface NacalcBridgeRow {
  key: string;
  label: string;
  /** The figure as shown; signed only for the Verschil, the correction and the koersverschil. */
  amountEur: number;
  note: string | null;
  op: '' | '−' | '+' | '=' | '→';
}

export interface NacalcExplained {
  savingsEur: number;
  overrunsEur: number;
  additionalEur: number;
  reviewEur: number;
  openEur: number;
  fxEur: number;
}

export interface NacalcPartner {
  costPct: number;
  sharePct: number;
  basisEur: number | null;
  advanceEur: number | null;
  unitEur: number | null;
  shortPieces: number;
  ordered: number;
  financing: {
    committedAdvanceEur: number; invoicedAdvanceEur: number; receivedAdvanceEur: number; openAdvanceEur: number;
    ownExposureEur: number; settlementNumber: string | null; settlementComplete: boolean; creditEur: number; unbilledCount: number;
  } | null;
  shortageAfterAdvance: boolean;
}

export interface PurchaseNacalc {
  headline: NacalcHeadline;
  /** One product, or several: the hero shows the products' range then, never a mixed average (purchaseNacalcSummary's mix). */
  mix: NacalcUnitMix;
  /** Null while the ledger is missing (payments not loaded or failed). */
  payees: NacalcPayeeRow[] | null;
  receipt: NacalcReceipt | null;
  products: NacalcProductRow[];
  productTotals: { begrootEur: number; eindkostEur: number; verschilEur: number };
  bridge: { rows: NacalcBridgeRow[]; consistent: boolean };
  explained: NacalcExplained;
  partner: NacalcPartner | null;
  notes: string[];
}

export interface PurchaseNacalcInput {
  view: PurchaseOrderView;
  ledger: PaymentLedger | null;
  /** purchaseNacalcSummary(view, ledger), as the host shows it in the cards. */
  summary: PurchaseNacalcSummary | null;
  partner?: PartnerFinancing | null;
}

/**
 * The static words per reason; 'open', 'partly-settled' and 'legacy' carry an
 * amount and are formatted by nacalcReason, 'offset' names the other terms
 * (termRow).
 */
export const NACALC_REASON_LABEL: Readonly<Record<NacalcReason, string>> = {
  none: 'geen verschil',
  open: 'nog open',
  'partly-settled': 'deels afgerekend',
  'settled-lower': 'minder betaald · afgerekend',
  'settled-higher': 'meer betaald · afgerekend',
  review: 'te veel betaald · nakijken',
  fx: 'koersverschil (bank) · zit al in betaald',
  additional: 'bijkomend · zonder afspraak',
  unbudgeted: 'betaald zonder afspraak',
  incomplete: 'bedragen onvolledig',
  legacy: 'historisch betaald bij ontvangst · niet in het logboek',
  credit: 'tegoed leverancier',
  offset: 'verrekend',
};

const EURO = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
const eur = (value: number): string => EURO.format(Number.isFinite(value) ? value : 0);
const cents = (value: number | null | undefined): number => Number.isFinite(value as number) ? Math.round((value as number) * 100) : 0;
const euro = (value: number): number => value / 100;
const round4 = (value: number): number => Math.round(value * 10000) / 10000;
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);
/** 'a', 'a en b', 'a, b en c': the same join as the ledger's term words. */
const listNl = (items: readonly string[]): string =>
  items.length < 2 ? items.join('') : items.slice(0, -1).join(', ') + ' en ' + items[items.length - 1];

/**
 * The supplier's credits in cents: the server totals first, the supplier
 * stream next, the credits themselves as a fallback for an older response.
 */
export function supplierCreditCents(view: Pick<PurchaseOrderView, 'reconciliation' | 'supplierCredits'>): { total: number; open: number; count: number } {
  const credits = view.supplierCredits ?? [];
  const totals = view.reconciliation?.totals;
  const stream = view.reconciliation?.streams.find(item => item.payee === 'SUPPLIER');
  const total = totals?.supplierCreditEur != null ? cents(totals.supplierCreditEur)
    : stream?.creditEur != null ? cents(stream.creditEur) : sum(credits.map(credit => cents(credit.amountEur)));
  const open = totals?.supplierCreditOpenEur != null ? cents(totals.supplierCreditOpenEur)
    : sum(credits.filter(credit => credit.status === 'OPEN').map(credit => cents(credit.amountEur)));
  return { total, open, count: credits.length };
}

/** The whole story, or null while the server report is missing: nothing is guessed from budget minus paid. */
export function purchaseNacalc(input: PurchaseNacalcInput): PurchaseNacalc | null {
  const { view, ledger, summary } = input;
  const report = view.reconciliation;
  if (!report || !summary) return null;
  const totals = report.totals;
  const costing = view.costing.totals;
  const kind = summary.kind;
  const concept = kind === 'concept';
  const credit = supplierCreditCents(view);
  const receipt = totals.receiptRecorded ? receiptBlock(view, totals, credit) : null;
  const payees = concept ? [] : ledger ? ledger.visible
    .filter(item => item.payee !== 'OTHER' || item.paymentCount > 0)
    .map(item => payeeRow(item, report.streams.find(stream => stream.payee === item.payee), totals, view)) : null;
  const fxEur = euro(sum((payees ?? []).map(row => cents(row.fxEur))));
  const separate = cents(costing.separateCostsEur);
  const separateApart = separate > 0 && !costing.separateCostsInPiecePrice;
  const ordered = totals.orderedQuantity ?? 0;
  const forecast = cents(totals.forecastExternalEur);
  const begroot = cents(totals.plannedExternalEur);
  const verschil = cents(totals.varianceEur);
  const unitEur = totals.forecastExternalUnitEur ?? null;
  const unitOrderedEur = totals.receiptRecorded && ordered > 0 ? round4(euro(forecast) / ordered) : null;
  const setBasis: NacalcSetBasis = totals.setBasis ?? 'PIECE';
  const words = UNIT_TEXT[setBasis];
  const pieceEur = totals.forecastExternalPieceEur ?? (setBasis === 'PIECE' ? unitEur : null);
  const pricingPieceEur = totals.forecastPricingPieceEur ?? (setBasis === 'PIECE' ? totals.forecastPricingUnitEur ?? null : null);
  const headline: NacalcHeadline = {
    kind,
    label: summary.label,
    pill: summary.pill,
    sentence: stateSentence(kind, payees, report.streams, summary) + (kind !== 'concept' && credit.open > 0 ? ` · tegoed ${eur(euro(credit.open))} open` : ''),
    eindkostEur: euro(forecast),
    begrootEur: euro(begroot),
    paidEur: euro(cents(totals.paidEur)),
    openEur: euro(cents(totals.remainingEur)),
    dueNowEur: ledger?.summary.dueNowEur ?? 0,
    laterEur: ledger?.summary.laterEur ?? 0,
    verschilEur: euro(verschil),
    verschilPct: begroot > 0 ? Math.round((verschil / begroot) * 1000) / 10 : null,
    reviewEur: summary.reviewEur,
    additionalEur: summary.additionalCostsEur,
    fxEur,
    creditEur: euro(credit.total),
    creditOpenEur: euro(credit.open),
    unitEur,
    unitQuantity: totals.unitCostQuantity ?? 0,
    unitBasis: totals.unitCostBasis ?? 'ORDERED',
    orderedQuantity: ordered,
    unitOrderedEur,
    unitDeltaEur: unitEur !== null && unitOrderedEur !== null ? round4(unitEur - unitOrderedEur) : null,
    pricingUnitEur: totals.forecastPricingUnitEur ?? null,
    markupEur: euro(cents(totals.internalMarkupEur)),
    pricingEur: euro(cents(totals.forecastPricingEur)),
    landedEur: euro(cents(costing.totalEur)),
    landedWithSeparateEur: euro(cents(costing.totalWithSeparateCostsEur ?? costing.totalEur)),
    separateApart,
    includesInspection: separate > 0,
    ddp: !!view.payable?.ddp,
    setBasis,
    setPieces: totals.setPieces ?? null,
    setUnitOther: totals.setUnitOther ?? null,
    pieceEur,
    pricingPieceEur,
    pieceQuantity: totals.unitCostPieceQuantity ?? totals.unitCostQuantity ?? 0,
    orderedPieceQuantity: totals.orderedPieceQuantity ?? ordered,
    usablePieceQuantity: totals.usablePieceQuantity ?? totals.usableQuantity ?? 0,
    unitWord: words.word,
    unitPlural: words.plural,
    unitLabel: words.label,
    unitColumn: words.column,
    pricingUnitLabel: words.pricing,
    stripUnitEur: setBasis === 'MIXED' ? pieceEur : unitEur,
    stripPricingEur: setBasis === 'MIXED' ? pricingPieceEur : totals.forecastPricingUnitEur ?? null,
  };
  const products = report.lines.map((line): NacalcProductRow => ({
    productId: line.productId ?? null,
    name: line.productName,
    ordered: line.orderedQuantity,
    received: line.receivedQuantity,
    missing: totals.receiptRecorded ? Math.max(0, line.orderedQuantity - line.receivedQuantity) : 0,
    over: totals.receiptRecorded ? Math.max(0, line.receivedQuantity - line.orderedQuantity) : 0,
    damaged: line.damagedQuantity,
    usable: line.usableQuantity,
    unitQuantity: line.unitCostQuantity,
    unitBasis: line.unitCostBasis,
    begrootEur: euro(cents(line.plannedExternalEur)),
    eindkostEur: euro(cents(line.forecastExternalEur)),
    verschilEur: euro(cents(line.varianceEur)),
    unitEur: line.forecastExternalUnitEur ?? null,
    pricingUnitEur: line.forecastPricingUnitEur ?? null,
    set: line.salesUnit === 'DISPLAY' ? { pieces: line.piecesPerUnit ?? 1, one: line.unitOne || 'stuk', other: line.unitOther || 'stuks' } : null,
    unitPieceEur: line.forecastExternalPieceEur ?? (line.salesUnit === 'DISPLAY' ? null : line.forecastExternalUnitEur ?? null),
    pricingPieceEur: line.forecastPricingPieceEur ?? (line.salesUnit === 'DISPLAY' ? null : line.forecastPricingUnitEur ?? null),
    pieceQuantity: line.pieceQuantity ?? line.unitCostQuantity,
  }));
  return {
    headline,
    mix: summary.mix,
    payees,
    receipt,
    products,
    productTotals: {
      begrootEur: euro(sum(products.map(row => cents(row.begrootEur)))),
      eindkostEur: euro(sum(products.map(row => cents(row.eindkostEur)))),
      verschilEur: euro(sum(products.map(row => cents(row.verschilEur)))),
    },
    bridge: nacalcBridge(view, summary),
    explained: {
      savingsEur: summary.settledSavingsEur,
      overrunsEur: summary.settledOverrunsEur,
      additionalEur: summary.additionalCostsEur,
      reviewEur: summary.reviewEur,
      openEur: euro(cents(totals.remainingEur)),
      fxEur,
    },
    partner: partnerBlock(view, totals, receipt, input.partner ?? null),
    notes: clientNotes(view, receipt, input.partner ?? null, report.notes, credit.total),
  };
}

function stateSentence(
  kind: NacalcKind, payees: NacalcPayeeRow[] | null, streams: readonly PurchaseReconciliationStream[], summary: PurchaseNacalcSummary,
): string {
  switch (kind) {
    case 'concept': return 'Nog niet besteld — de calculatie is de afspraak.';
    case 'final': return 'Definitief · alle ontvangers afgerekend';
    case 'review': {
      const reviewed = payees?.find(row => row.status.kind === 'OVERPAID' || row.status.kind === 'UNBUDGETED' || row.status.kind === 'INCOMPLETE');
      if (reviewed) {
        if (reviewed.status.kind === 'OVERPAID') return `Na te kijken · ${eur(overpaidOf(streams, reviewed.payee))} te veel betaald aan ${reviewed.label}`;
        if (reviewed.status.kind === 'UNBUDGETED') return `Na te kijken · ${reviewed.label} betaald zonder afspraak`;
        return `Na te kijken · betaling zonder eurowaarde bij ${reviewed.label}`;
      }
      // Without the ledger the server report names the payee.
      const overpaid = streams.find(stream => stream.payee !== 'OTHER' && stream.status === 'OVERPAID' && !stream.finalized);
      if (overpaid) return `Na te kijken · ${eur(overpaid.overpaidEur)} te veel betaald aan ${overpaid.label}`;
      const unbudgeted = streams.find(stream => stream.payee !== 'OTHER' && stream.status === 'ADDITIONAL');
      if (unbudgeted) return `Na te kijken · ${unbudgeted.label} betaald zonder afspraak`;
      return 'Na te kijken';
    }
    default: {
      const open = payees ? payees.filter(row => row.openEur > 0).length
        : streams.filter(stream => stream.payee !== 'OTHER' && cents(stream.remainingEur) > 0).length;
      return open > 0 ? `Voorlopig · ${open} ${open === 1 ? 'ontvanger' : 'ontvangers'} nog open` : 'Voorlopig · alles betaald, nog niet afgerekend';
    }
  }
}

function overpaidOf(streams: readonly PurchaseReconciliationStream[], payee: Payee): number {
  return streams.find(stream => stream.payee === payee)?.overpaidEur ?? 0;
}

function payeeRow(
  item: PayeeLedger, stream: PurchaseReconciliationStream | undefined, totals: PurchaseReconciliationTotals, view: PurchaseOrderView,
): NacalcPayeeRow {
  const other = item.payee === 'OTHER';
  const rates = { cnyToUsd: view.order.cnyToUsd ?? null, usdToEurGoods: view.order.usdToEurGoods ?? null };
  const rows = item.rows;
  const currency = rows[0]?.currency;
  const paidForeign = rows.length && currency && currency !== 'EUR' && rows.every(row => row.currency === currency)
    ? { amount: Math.round(sum(rows.map(row => row.amount)) * 100) / 100, currency } : null;
  const fx = sum(rows.map(row => cents(paymentFxEur(row, rates))));
  const reason = nacalcReason(item, stream, totals);
  const ddpNote = item.payee === 'SUPPLIER' && !!view.payable?.ddp;
  const cifNote = item.payee === 'LOGISTICS' && !!view.order.freightViaSupplier && !view.payable?.ddp;
  const separateApart = cents(view.costing.totals.separateCostsEur) > 0 && !view.costing.totals.separateCostsInPiecePrice;
  let basis = item.basis;
  if (ddpNote) basis = (basis.startsWith('Goederen') ? 'Goederen DDP' + basis.slice('Goederen'.length) : basis) + ' · transport en invoerrechten in de DDP-prijs';
  if (item.payee === 'SEPARATE') basis += separateApart ? ' · apart' : ' · in de stukprijs verdeeld';
  const legacy = reason.reason === 'legacy';
  const actionLabel = nacalcActionLabel(item);
  const action = actionLabel === null ? null : actionLabel === 'Noteer ›' ? 'add' : 'settle';
  const next = item.next;
  return {
    payee: item.payee,
    label: item.label,
    icon: item.icon,
    tone: item.tone,
    basis,
    ddpNote,
    cifNote,
    legacy,
    legacyEur: legacy ? euro(cents(totals.legacyPaidTotalEur)) : 0,
    agreedEur: item.agreedEur,
    paidEur: item.paidEur,
    paidForeign,
    openEur: item.openEur,
    dueNowEur: item.dueNowEur,
    laterEur: item.laterEur,
    eindkostEur: stream ? euro(cents(stream.forecastEur)) : euro(cents(item.paidEur) + cents(item.openEur) - cents(item.creditEur)),
    verschilEur: other ? item.paidEur : stream ? euro(cents(stream.varianceEur)) : 0,
    reason: reason.reason,
    reasonLabel: reason.label,
    fxEur: euro(fx),
    creditEur: item.creditEur,
    creditOpenEur: item.creditOpenEur,
    status: item.status,
    action,
    actionLabel,
    payAction: action === 'add'
      ? (next ? { payee: item.payee, amount: next.amountEur, label: next.label, due: next.due } : { payee: item.payee }) : null,
    settleDefault: item.settleDefault,
    canUndoSettle: item.canUndoSettle,
    terms: item.payee === 'SUPPLIER' ? item.terms.map(termRow) : [],
    termsMixed: item.payee === 'SUPPLIER' && termsMixed(item.terms),
  };
}

/**
 * The supplier's terms tell their own story once one of them carries a
 * difference the others do not, or the other way round (one paid more, the
 * next less, netted).
 */
function termsMixed(terms: readonly LedgerTerm[]): boolean {
  if (terms.length < 2 || !terms.some(term => cents(term.differenceEur) !== 0)) return false;
  return new Set(terms.map(term => `${term.state}|${term.settled}|${Math.sign(cents(term.differenceEur))}`)).size > 1;
}

function termRow(term: LedgerTerm): NacalcTermRow {
  const open = cents(term.openEur);
  const offset = cents(term.offsetEur);
  const verrekend = 'verrekend met ' + listNl(term.offsetWith);
  let reason: NacalcReason = 'none';
  let label = NACALC_REASON_LABEL.none;
  // A netted term explains its Verschil by the other term; the pill keeps what is left (te veel, afgerekend).
  // A pill that already names the other term ('Betaald · verrekend met …') leaves nothing to say beside it:
  // 'none', so the words never stand twice (the ledger's statusNote rule).
  if (offset !== 0 && open === 0) { reason = term.status.label.includes(verrekend) ? 'none' : 'offset'; label = verrekend; }
  else if (term.lowerEur > 0 && open === 0) { reason = 'settled-lower'; label = NACALC_REASON_LABEL['settled-lower']; }
  else if (term.higherEur > 0) { reason = term.finalized ? 'settled-higher' : term.fxEur > 0 ? 'fx' : 'review'; label = NACALC_REASON_LABEL[reason]; }
  else if (open > 0 && term.lowerEur > 0) { reason = 'partly-settled'; label = `deels afgerekend · nog ${eur(term.openEur)} open`; }
  else if (open > 0) {
    reason = 'open';
    label = (term.state === 'due' ? `nog ${eur(term.openEur)} open · nu te betalen` : `nog ${eur(term.openEur)} open · later ${term.moment}`)
      + (offset > 0 ? ` · ${eur(euro(offset))} ${verrekend}` : '');
  }
  return {
    due: term.due,
    label: term.label,
    agreedEur: term.fullEur,
    paidEur: term.paidEur,
    openEur: term.openEur,
    verschilEur: euro(cents(term.differenceEur)),
    reason,
    reasonLabel: label,
    status: term.status,
  };
}

/**
 * One reason word per payee, in this order: bijkomend, onvolledig, betaald
 * zonder afspraak, te veel betaald, historisch, deels afgerekend, nog open,
 * tegoed leverancier, minder or meer betaald · afgerekend, geen verschil.
 */
export function nacalcReason(
  item: Pick<PayeeLedger, 'payee' | 'status' | 'paymentCount' | 'openEur' | 'lowerEur' | 'higherEur' | 'dueNowEur' | 'next'>
    & Partial<Pick<PayeeLedger, 'creditEur' | 'creditOpenEur'>>, stream: PurchaseReconciliationStream | undefined, totals: Pick<PurchaseReconciliationTotals, 'legacyPaidTotalEur'>,
): { reason: NacalcReason; label: string } {
  const word = (reason: NacalcReason, label = NACALC_REASON_LABEL[reason]) => ({ reason, label });
  if (item.payee === 'OTHER') return word('additional');
  switch (item.status.kind) {
    case 'INCOMPLETE': return word('incomplete');
    case 'UNBUDGETED': return word('unbudgeted');
    case 'OVERPAID': return word('review');
    case 'FX': return word('fx');
  }
  const legacy = cents(totals.legacyPaidTotalEur);
  if (item.payee === 'SUPPLIER' && (stream?.paymentCount ?? item.paymentCount) === 0 && legacy > 0) {
    return word('legacy', `historisch ${eur(euro(legacy))} betaald bij ontvangst · niet in het logboek`);
  }
  const open = cents(item.openEur);
  if (open > 0 && (item.lowerEur > 0 || item.higherEur > 0)) return word('partly-settled', `deels afgerekend · nog ${eur(item.openEur)} open`);
  if (open > 0) {
    if (item.dueNowEur > 0) return word('open', `nog ${eur(item.openEur)} open · nu te betalen`);
    const moment = item.next && !item.next.now && item.next.when !== 'later' ? item.next.when : null;
    return word('open', moment ? `nog ${eur(item.openEur)} open · later ${moment}` : `nog ${eur(item.openEur)} open`);
  }
  const credit = cents(item.creditEur);
  if (credit > 0) {
    const toReceive = cents(item.creditOpenEur);
    return word('credit', `tegoed leverancier − ${eur(euro(credit))}` + (toReceive > 0 ? ` · ${eur(euro(toReceive))} te ontvangen` : ''));
  }
  if (item.status.kind === 'SETTLED_LOWER') return word('settled-lower');
  if (item.status.kind === 'SETTLED_HIGHER') return word('settled-higher');
  return word('none');
}

/**
 * The row's one text button, by the ledger's shared rule (payeeRowAction);
 * an overpayment is reviewed rather than settled, and a payee whose figures
 * do not close is looked at before any money is recorded on it.
 */
export function nacalcActionLabel(item: Pick<PayeeLedger, 'action' | 'status'>): 'Noteer ›' | 'Afrekenen…' | 'Nakijken…' | null {
  if (item.status.kind === 'INCOMPLETE') return null;
  if (item.action === 'add') return 'Noteer ›';
  if (item.action === 'settle') return item.status.kind === 'OVERPAID' ? 'Nakijken…' : 'Afrekenen…';
  return null;
}

/**
 * What the bank really debited beyond the order rate, in euro: the stored
 * euro value minus the foreign amount at the order-pinned rate. Zero for euro
 * payments, for a missing rate and for a payment without its euro value; it
 * already sits inside 'betaald' and is never added again.
 */
export function paymentFxEur(
  row: { amount: number; currency: Currency; amountEur: number }, rates: { cnyToUsd: number | null; usdToEurGoods: number | null },
): number {
  if (row.currency === 'EUR' || !Number.isFinite(row.amountEur) || !Number.isFinite(row.amount)) return 0;
  const usd = rates.usdToEurGoods;
  if (usd == null || !Number.isFinite(usd) || usd <= 0) return 0;
  let rate = usd;
  if (row.currency === 'CNY') {
    const cny = rates.cnyToUsd;
    if (cny == null || !Number.isFinite(cny) || cny <= 0) return 0;
    rate = cny * usd;
  }
  return euro(cents(row.amountEur) - Math.round(row.amount * rate * 100));
}

function receiptBlock(view: PurchaseOrderView, totals: PurchaseReconciliationTotals, credit: { total: number; open: number; count: number }): NacalcReceipt {
  const variance = view.receiptVariance;
  const lines = view.reconciliation?.lines ?? [];
  const missing = variance?.missingPieces ?? sum(lines.map(line => Math.max(0, line.orderedQuantity - line.receivedQuantity)));
  const over = variance?.overReceivedPieces ?? sum(lines.map(line => Math.max(0, line.receivedQuantity - line.orderedQuantity)));
  const damaged = totals.damagedQuantity ?? 0;
  const ordered = totals.orderedQuantity ?? 0;
  let overValue: number | null = 0;
  for (const line of view.order.lines) {
    if (line.orderedQuantity == null || line.quantity <= line.orderedQuantity) continue;
    if (line.receiptUnitValueEur == null || !Number.isFinite(line.receiptUnitValueEur)) { overValue = null; break; }
    overValue += Math.round((line.quantity - line.orderedQuantity) * line.receiptUnitValueEur * 100);
  }
  const loss = variance ? euro(cents(variance.totalLossValueEur)) : null;
  const unvalued = variance?.unvaluedLossPieces ?? 0;
  const supplier = view.reconciliation?.streams.find(stream => stream.payee === 'SUPPLIER');
  let supplierFact: NacalcReceipt['supplierFact'] = null;
  if ((loss ?? 0) > 0 || unvalued > 0) {
    if (cents(supplier?.settledSavingEur) > 0) supplierFact = { kind: 'settled-lower', amountEur: euro(cents(supplier!.settledSavingEur)) };
    else if (cents(supplier?.remainingEur) > 0) supplierFact = { kind: 'open', amountEur: euro(cents(supplier!.remainingEur)) };
    else supplierFact = { kind: 'paid-full', amountEur: loss ?? 0 };
  }
  const laterReports = (view.receiptReports ?? []).filter(report => report.source === 'LATER');
  const names = [...new Set(laterReports.map(report => report.productName))];
  const later = laterReports.length ? {
    count: laterReports.length,
    damaged: sum(laterReports.map(report => report.damaged)),
    missing: sum(laterReports.map(report => report.missing)),
    products: names.length > 3 ? [...names.slice(0, 3), `+${names.length - 3}`] : names,
  } : null;
  const unitUsable = totals.forecastExternalUnitEur ?? null;
  const unitOrdered = ordered > 0 ? round4(euro(cents(totals.forecastExternalEur)) / ordered) : null;
  const orderedPieces = totals.orderedPieceQuantity ?? ordered;
  const pieceUsable = totals.forecastExternalPieceEur ?? null;
  const pieceOrdered = totals.forecastExternalPieceEur != null && orderedPieces > 0 ? round4(euro(cents(totals.forecastExternalEur)) / orderedPieces) : null;
  return {
    ordered,
    received: totals.receivedQuantity ?? 0,
    missing,
    over,
    damaged,
    usable: totals.usableQuantity ?? 0,
    missingValueEur: variance ? euro(cents(variance.missingValueEur)) : null,
    damagedValueEur: variance ? euro(cents(variance.damagedValueEur)) : null,
    lossEur: loss,
    unvaluedPieces: unvalued,
    valuationComplete: variance?.valuationComplete ?? false,
    overValueEur: over > 0 ? (overValue === null ? null : euro(overValue)) : 0,
    unitOrderedEur: unitOrdered,
    unitUsableEur: unitUsable,
    unitDeltaEur: unitUsable !== null && unitOrdered !== null ? round4(unitUsable - unitOrdered) : null,
    pieceUsableEur: pieceUsable,
    pieceOrderedEur: pieceOrdered,
    supplierFact,
    credit: credit.total > 0 || credit.count > 0 ? { totalEur: euro(credit.total), openEur: euro(credit.open), count: credit.count } : null,
    later,
    clean: missing + damaged + over === 0 && !later,
  };
}

/**
 * From the calculation in Kosten to the budget the payees are measured
 * against, then paid plus open to the eindkost. After receipt the live
 * calculation runs on received pieces while the budget stays on the ordered
 * ones; that residue is named, never hidden. Before receipt a residue up to a
 * euro is rounding, more means the costs no longer match.
 */
export function nacalcBridge(view: PurchaseOrderView, summary: PurchaseNacalcSummary | null): { rows: NacalcBridgeRow[]; consistent: boolean } {
  const report = view.reconciliation;
  if (!report || !summary) return { rows: [], consistent: true };
  const totals = report.totals;
  const costing = view.costing.totals;
  const landed = cents(costing.totalEur);
  const enrosed = cents(view.payable ? view.payable.enrosedEur : costing.extraRevenueEur);
  const separate = cents(costing.separateCostsEur);
  const separateApart = separate > 0 && !costing.separateCostsInPiecePrice;
  const begroot = cents(totals.plannedExternalEur);
  const rows: NacalcBridgeRow[] = [{ key: 'LANDED', label: 'Calculatie · totaal geland', amountEur: euro(landed), note: null, op: '' }];
  if (view.payable?.ddp) rows.push({ key: 'DDP', label: 'Douane & transport', amountEur: 0, note: 'inbegrepen in de prijs (DDP)', op: '' });
  rows.push({ key: 'ENROSED', label: 'Enrosed kost', amountEur: euro(enrosed), note: 'intern, geen betaling', op: '−' });
  let parts = landed - enrosed;
  if (separateApart) {
    rows.push({ key: 'SEPARATE', label: 'Inspectie & andere kosten', amountEur: euro(separate), note: 'apart', op: '+' });
    parts += separate;
  }
  const residue = begroot - parts;
  let consistent = true;
  if (residue !== 0) {
    if (totals.receiptRecorded) {
      rows.push({ key: 'ORDERED', label: 'Correctie naar bestelde aantallen', amountEur: euro(Math.abs(residue)),
        note: `de afspraak blijft op ${totals.orderedQuantity.toLocaleString('nl-BE')} bestelde ${UNIT_TEXT[totals.setBasis ?? 'PIECE'].plural}`, op: residue < 0 ? '−' : '+' });
    } else if (Math.abs(residue) <= 100) {
      rows.push({ key: 'ROUNDING', label: 'Afronding', amountEur: euro(Math.abs(residue)), note: null, op: residue < 0 ? '−' : '+' });
    } else consistent = false;
  }
  rows.push({ key: 'BUDGET', label: 'Afspraak extern', amountEur: euro(begroot), note: 'op bestelde aantallen en orderkoersen', op: '=' });
  rows.push({ key: 'PAID', label: 'Betaald', amountEur: euro(cents(totals.paidEur)), note: null, op: '' });
  rows.push({ key: 'OPEN', label: 'Open', amountEur: euro(cents(totals.remainingEur)), note: null, op: '+' });
  const credit = supplierCreditCents(view);
  if (credit.total > 0) {
    rows.push({ key: 'CREDIT', label: 'Tegoed leverancier', amountEur: euro(credit.total),
      note: credit.open > 0 ? `waarvan ${eur(euro(credit.open))} nog te ontvangen` : 'terugbetaald of verrekend', op: '−' });
  }
  rows.push({ key: 'FORECAST', label: summary.kind === 'final' ? 'Eindkost' : 'Verwachte eindkost', amountEur: euro(cents(totals.forecastExternalEur)), note: null, op: '=' });
  if (summary.reviewEur > 0) rows.push({ key: 'REVIEW', label: 'waarvan te veel betaald · nakijken', amountEur: summary.reviewEur, note: null, op: '' });
  if (summary.additionalCostsEur > 0) rows.push({ key: 'ADDITIONAL', label: 'waarvan bijkomende kosten', amountEur: summary.additionalCostsEur, note: null, op: '' });
  rows.push({ key: 'VARIANCE', label: 'Verschil', amountEur: euro(cents(totals.varianceEur)), note: 'eindkost min afspraak', op: '→' });
  return { rows, consistent };
}

function partnerBlock(
  view: PurchaseOrderView, totals: PurchaseReconciliationTotals, receipt: NacalcReceipt | null, financing: PartnerFinancing | null,
): NacalcPartner | null {
  const order = view.order;
  if (order.partnerCustomerId == null) return null;
  const costPct = order.partnerCostPct ?? 100;
  const basis = view.costing.totals.totalWithSeparateCostsEur ?? view.costing.totals.totalEur ?? null;
  const shortPieces = receipt ? receipt.missing + receipt.damaged : 0;
  const invoiced = cents(financing?.invoicedAdvanceEur);
  return {
    costPct,
    sharePct: order.partnerSharePct ?? 50,
    basisEur: basis === null ? null : euro(cents(basis)),
    advanceEur: basis === null ? null : euro(Math.round(cents(basis) * costPct / 100)),
    unitEur: totals.forecastExternalUnitEur ?? null,
    shortPieces,
    ordered: totals.orderedQuantity ?? 0,
    financing: financing ? {
      committedAdvanceEur: euro(cents(financing.committedAdvanceEur)),
      invoicedAdvanceEur: euro(invoiced),
      receivedAdvanceEur: euro(cents(financing.receivedAdvanceEur)),
      openAdvanceEur: euro(cents(financing.openAdvanceEur)),
      ownExposureEur: euro(cents(financing.ownExposureEur)),
      settlementNumber: financing.settlementInvoiceNumber ?? null,
      settlementComplete: financing.settlementComplete === true,
      creditEur: euro(cents(financing.creditEur)),
      unbilledCount: financing.unbilledAdvanceCount ?? 0,
    } : null,
    shortageAfterAdvance: invoiced > 0 && shortPieces > 0,
  };
}

/** Where the desk applies the costs: its Afronden tab. The phone has none (nacalcPhoneNotes). */
const APPLY_ON_DESK = 'Kostprijzen toepassen (Afronden)';

/** The server's notes verbatim, then what the client adds and the server does not say yet. */
function clientNotes(
  view: PurchaseOrderView, receipt: NacalcReceipt | null, financing: PartnerFinancing | null, server: readonly string[], creditCents = 0,
): string[] {
  const notes = [...server];
  if (creditCents > 0 && !server.some(note => /[Tt]egoed/.test(note))) {
    notes.push('Een tegoed van de leverancier verlaagt de eindkost van de leverancier, ook zolang het nog open staat; Betaald en Open blijven zoals ze zijn.');
  }
  if (!server.some(note => /USD of CNY/.test(note))) {
    notes.push('Betalingen in USD of CNY tellen tegen hun geboekte eurobedrag (orderkoers, of het afgeschreven bankbedrag als dat is ingevuld).');
  }
  const basis = view.reconciliation?.totals.setBasis ?? 'PIECE';
  const lost = basis === 'DISPLAY' ? 'verloren displays is de goederenprijs per display' : basis === 'MIXED' ? 'verloren displays en stuks is de goederenprijs per display of per stuk'
    : 'verloren stuks is de goederenprijs per stuk';
  const usable = basis === 'DISPLAY' ? 'de bruikbare displays' : basis === 'MIXED' ? 'de bruikbare displays en stuks' : 'de bruikbare stuks';
  if (receipt) notes.push(`De inkoopwaarde van ${lost} tegen de orderkoers; transport en rechten zijn verdeeld over ${usable}.`);
  notes.push(`De nacalculatie wijzigt geen productkostprijzen; ${APPLY_ON_DESK} gebruikt de calculatie ${basis === 'DISPLAY' ? 'per display' : basis === 'MIXED' ? 'per display of per stuk' : 'per stuk'}.`);
  if (view.order.partnerCustomerId != null && financing?.settlementInvoiceNumber) {
    notes.push('Uitgereikte afrekeningen zijn bevroren; latere kostwijzigingen wijzigen ze niet.');
  }
  return notes;
}

/**
 * The notes as the phone's Nacalculatie shows them. The phone has no Afronden
 * tab: its apply sheet opens from the dock, Acties or the Nacalculatie's
 * 'Kostprijzen toepassen ›', so the note names just Kostprijzen toepassen.
 * The desk shows the notes as they are.
 */
export function nacalcPhoneNotes(notes: readonly string[]): string[] {
  return notes.map(note => note.replace(APPLY_ON_DESK, 'Kostprijzen toepassen'));
}

/* ---- per display / per stuk: the words every nacalculatie screen shares ---------------------------- */

const EURO4 = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 4, maximumFractionDigits: 4 });
const eur4 = (value: number): string => EURO4.format(value);
const count = (value: number): string => value.toLocaleString('nl-BE');
/** '+ € 0,6367' / '− € 0,0100': a unit delta with its sign. */
function signedUnit(value: number): string {
  return (value < 0 ? '− ' : '+ ') + eur4(Math.abs(value));
}
/** 'displays als 12 rozen geteld', or without one shared size or noun 'displays als hun aantal stuks geteld'. */
function setsCounted(head: Pick<NacalcHeadline, 'setPieces' | 'setUnitOther'>): string {
  return head.setPieces && head.setUnitOther ? `displays als ${head.setPieces} ${head.setUnitOther} geteld` : 'displays als hun aantal stuks geteld';
}

/** What the unit figure rests on: '100 bestelde displays × 12 rozen · € 2,6000 per stuk', '1.400 stuks · displays als 12 rozen geteld'. */
export function nacalcUnitBasis(head: NacalcHeadline): string {
  const suffix = (head.includesInspection ? ' · incl. inspectie' : '') + (head.ddp ? ' · DDP' : '');
  const usable = head.unitBasis === 'USABLE_RECEIVED';
  if (head.setBasis === 'MIXED') return `${count(head.pieceQuantity)} stuks · ${setsCounted(head)}${suffix}`;
  if (head.setBasis === 'DISPLAY') {
    const piece = head.pieceEur !== null ? ` · ${eur4(head.pieceEur)} per stuk` : '';
    return (usable ? `${count(head.unitQuantity)} bruikbare displays · ${count(head.orderedQuantity)} besteld`
      : `${count(head.unitQuantity)} bestelde displays × ${head.setPieces ?? 1} ${head.setUnitOther ?? 'stuks'}`) + piece + suffix;
  }
  return (usable ? `${count(head.unitQuantity)} bruikbare stuks · ${count(head.orderedQuantity)} besteld` : `${count(head.unitQuantity)} bestelde stuks`) + suffix;
}

/**
 * What the figures of a container with several products rest on, after its
 * count ('7.976 st'): 'bruikbaar · displays als 12 rozen geteld · incl. inspectie
 * · DDP'. No average over the products is shown.
 */
export function nacalcMixBasis(head: NacalcHeadline): string {
  const suffix = (head.includesInspection ? ' · incl. inspectie' : '') + (head.ddp ? ' · DDP' : '');
  const basis = head.unitBasis === 'USABLE_RECEIVED' ? 'bruikbaar' : 'besteld';
  return (head.setBasis === 'MIXED' ? `${basis} · ${setsCounted(head)}` : basis) + suffix;
}

/** 'calculatie op 100 bestelde displays' (verkoopeenheden in a mixed container). */
export function nacalcAgreedSub(head: Pick<NacalcHeadline, 'orderedQuantity' | 'unitPlural'>): string {
  return `calculatie op ${count(head.orderedQuantity)} bestelde ${head.unitPlural}`;
}

/** The receipt's effect on the unit cost in one sentence (desk), without its closing period. */
export function nacalcReceiptUnitLine(receipt: NacalcReceipt, head: NacalcHeadline): string | null {
  if (head.setBasis === 'MIXED') {
    if (receipt.pieceUsableEur === null || receipt.pieceOrderedEur === null) return null;
    return `Kost per bruikbaar stuk ${eur4(receipt.pieceUsableEur)} (${setsCounted(head)}) · per besteld stuk zou dit ${eur4(receipt.pieceOrderedEur)} zijn`
      + ` (${signedUnit(round4(receipt.pieceUsableEur - receipt.pieceOrderedEur))})`;
  }
  if (receipt.unitUsableEur === null || receipt.unitOrderedEur === null || receipt.unitDeltaEur === null) return null;
  if (head.setBasis === 'DISPLAY') {
    const piece = receipt.pieceUsableEur !== null ? ` (${eur4(receipt.pieceUsableEur)} per stuk)` : '';
    return `Kost per bruikbare display ${eur4(receipt.unitUsableEur)}${piece} · per bestelde display zou dit ${eur4(receipt.unitOrderedEur)} zijn (${signedUnit(receipt.unitDeltaEur)})`;
  }
  return `Kost per bruikbaar stuk ${eur4(receipt.unitUsableEur)} · per besteld stuk zou dit ${eur4(receipt.unitOrderedEur)} zijn (${signedUnit(receipt.unitDeltaEur)})`;
}

/** What the partner pays at the auction settlement; a mixed container has no one average (the settlement is per product line). */
export function nacalcPartnerLine(partner: NacalcPartner, head: Pick<NacalcHeadline, 'setBasis'>, phone = false): string {
  if (head.setBasis === 'MIXED') {
    return phone ? `eindkost van de verkochte displays en stuks, per product + ${partner.sharePct} % resultaat; voorschot verrekend`
      : `Bij de veilingafrekening betaalt de partner de eindkost van de verkochte displays en stuks, per product, plus ${partner.sharePct} % van het resultaat; het voorschot wordt dan verrekend.`;
  }
  const set = head.setBasis === 'DISPLAY';
  const unit = partner.unitEur !== null ? eur4(partner.unitEur) : null;
  if (phone) return `eindkost per ${set ? 'bruikbare display' : 'bruikbaar stuk'}${unit ? ` (${unit})` : ''} × verkochte ${set ? 'displays' : 'stuks'} + ${partner.sharePct} % resultaat; voorschot verrekend`;
  return `Bij de veilingafrekening betaalt de partner de eindkost van de verkochte ${set ? 'displays' : 'stuks'}${unit ? ` (${unit} per ${set ? 'bruikbare display' : 'bruikbaar stuk'})` : ''}`
    + ` plus ${partner.sharePct} % van het resultaat; het voorschot wordt dan verrekend.`;
}

/** Pieces that did not arrive, in the container's counting word. */
export function nacalcPartnerShortage(partner: NacalcPartner, head: Pick<NacalcHeadline, 'unitWord' | 'unitPlural'>): string {
  const per = head.unitWord === 'verkoopeenheid' ? 'per verkoopeenheid' : `per ${head.unitWord}`;
  return `${count(partner.shortPieces)} ${head.unitPlural} kwamen niet aan: de partner betaalt alleen voor bruikbare ${head.unitPlural}, tegen een hogere kost ${per}.`
    + (partner.shortageAfterAdvance ? ` Het voorschot is berekend op ${count(partner.ordered)} bestelde ${head.unitPlural}; verreken het verschil bij de slotfactuur of met een creditnota op het voorschot.` : '');
}

/**
 * A product's unit cost: '€ 31,2000 /display' with '€ 2,6000 /stuk' under it, '€ 5,0000 /stuk' beside displays, a plain figure in a
 * container of pieces. `main` is the one-line form; a table cell shows `amount` with `per` on its own small line under it, as the
 * total row does, so a 92 px column never cuts '€ 30,9600 /dis…'.
 */
export function nacalcProductUnit(row: Pick<NacalcProductRow, 'set' | 'unitEur' | 'unitPieceEur' | 'unitQuantity'>, basis: NacalcSetBasis,
  value: 'cost' | 'pricing' = 'cost', pricing?: { unit: number | null; piece: number | null }): { main: string; amount: string; per: string | null; sub: string | null } | null {
  const unit = value === 'pricing' ? pricing?.unit ?? null : row.unitEur;
  const piece = value === 'pricing' ? pricing?.piece ?? null : row.unitPieceEur;
  if (unit === null || row.unitQuantity === 0) return null;
  const per = row.set ? '/display' : basis === 'PIECE' ? null : '/stuk';
  const amount = eur4(unit);
  return { main: per ? `${amount} ${per}` : amount, amount, per, sub: row.set && piece !== null ? `${eur4(piece)} /stuk` : null };
}

/** A product's quantity: '100 displays' with '× 12 rozen' under it; a piece product's plain count. */
export function nacalcProductCount(row: Pick<NacalcProductRow, 'set'>, quantity: number): { main: string; sub: string | null } {
  return row.set ? { main: `${count(quantity)} ${quantity === 1 ? 'display' : 'displays'}`, sub: `× ${row.set.pieces} ${row.set.other}` } : { main: count(quantity), sub: null };
}

/**
 * The phone's line under a product: '100 bestelde displays × 12 rozen · € 31,2000/display · € 2,6000/stuk'. Beside displays (a display or
 * a mixed container) a piece product says '/stuk' and the price incl. Enrosed kost carries its unit; a container of
 * pieces keeps its short '/st'.
 */
export function nacalcProductSub(row: NacalcProductRow, received: boolean, basis: NacalcSetBasis = 'PIECE'): string {
  const words = row.set ? { one: 'display', other: 'displays', usable: 'bruikbare' } : { one: 'stuk', other: 'stuks', usable: 'bruikbare' };
  const shortfall = [row.missing ? row.missing + ' te weinig' : '', row.damaged ? row.damaged + ' beschadigd' : '', row.over ? row.over + ' te veel' : ''].filter(Boolean);
  const pieces = received
    ? `${count(row.usable)} ${words.usable} ${words.other}${shortfall.length ? ` (${shortfall.join(', ')})` : ''}`
    : `${count(row.ordered)} bestelde ${words.other}` + (row.set ? ` × ${row.set.pieces} ${row.set.other}` : '');
  const usable = row.unitEur !== null && row.unitQuantity > 0;
  const unit = !usable ? '' : row.set
    ? ` · ${eur4(row.unitEur!)}/display` + (row.unitPieceEur !== null ? ` · ${eur4(row.unitPieceEur)}/stuk` : '')
    : ` · ${eur4(row.unitEur!)}${basis === 'PIECE' ? '/st' : '/stuk'}`;
  const pricingUnit = row.set ? '/display' : basis === 'PIECE' ? '' : '/stuk';
  const pricing = row.pricingUnitEur !== null && row.unitQuantity > 0 ? ` · ${eur4(row.pricingUnitEur)}${pricingUnit} incl. Enrosed kost` : '';
  return pieces + unit + pricing;
}
