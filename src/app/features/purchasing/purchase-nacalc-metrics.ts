import type {
  Currency, PartnerFinancing, Payee, PurchaseOrderView, PurchaseReconciliationStream, PurchaseReconciliationTotals, UnitCostBasis,
} from '../../core/api/models';
import type {
  Due, LedgerTerm, LedgerTone, PayeeLedger, PayeeStatus, PaymentLedger, PurchasePaymentAction, PurchaseSettleRequest,
} from './purchase-payment-ledger';
import type { NacalcKind, NacalcTone, PurchaseNacalcSummary } from './purchase-payment-result-metrics';

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

export type NacalcReason = 'none' | 'open' | 'partly-settled' | 'settled-lower' | 'settled-higher' | 'review' | 'additional'
  | 'unbudgeted' | 'incomplete' | 'legacy';

export interface NacalcHeadline {
  kind: NacalcKind;
  label: 'Begrote kost' | 'Verwachte eindkost' | 'Eindkost';
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
}

export interface NacalcTermRow {
  due: Due;
  label: string;
  agreedEur: number;
  paidEur: number;
  openEur: number;
  verschilEur: number;
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
  supplierFact: { kind: 'settled-lower' | 'open' | 'paid-full'; amountEur: number } | null;
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

/** The static words per reason; 'open', 'partly-settled' and 'legacy' carry an amount and are formatted by nacalcReason. */
export const NACALC_REASON_LABEL: Readonly<Record<NacalcReason, string>> = {
  none: 'geen verschil',
  open: 'nog open',
  'partly-settled': 'deels afgerekend',
  'settled-lower': 'minder betaald · afgerekend',
  'settled-higher': 'meer betaald · afgerekend',
  review: 'te veel betaald · nakijken',
  additional: 'bijkomend · zonder afspraak',
  unbudgeted: 'niet begroot',
  incomplete: 'bedragen onvolledig',
  legacy: 'historisch betaald bij ontvangst · niet in het logboek',
};

const EURO = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
const eur = (value: number): string => EURO.format(Number.isFinite(value) ? value : 0);
const cents = (value: number | null | undefined): number => Number.isFinite(value as number) ? Math.round((value as number) * 100) : 0;
const euro = (value: number): number => value / 100;
const round4 = (value: number): number => Math.round(value * 10000) / 10000;
const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

/** The whole story, or null while the server report is missing: nothing is guessed from budget minus paid. */
export function purchaseNacalc(input: PurchaseNacalcInput): PurchaseNacalc | null {
  const { view, ledger, summary } = input;
  const report = view.reconciliation;
  if (!report || !summary) return null;
  const totals = report.totals;
  const costing = view.costing.totals;
  const kind = summary.kind;
  const concept = kind === 'concept';
  const receipt = totals.receiptRecorded ? receiptBlock(view, totals) : null;
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
  const headline: NacalcHeadline = {
    kind,
    label: summary.label,
    pill: summary.pill,
    sentence: stateSentence(kind, payees, report.streams, summary),
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
  }));
  return {
    headline,
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
    notes: clientNotes(view, receipt, input.partner ?? null, report.notes),
  };
}

function stateSentence(
  kind: NacalcKind, payees: NacalcPayeeRow[] | null, streams: readonly PurchaseReconciliationStream[], summary: PurchaseNacalcSummary,
): string {
  switch (kind) {
    case 'concept': return 'Nog niet besteld — de calculatie is de begroting.';
    case 'final': return 'Definitief · alle ontvangers afgerekend';
    case 'review': {
      const reviewed = payees?.find(row => row.status.kind === 'OVERPAID' || row.status.kind === 'UNBUDGETED' || row.status.kind === 'INCOMPLETE');
      if (reviewed) {
        if (reviewed.status.kind === 'OVERPAID') return `Na te kijken · ${eur(overpaidOf(streams, reviewed.payee))} te veel betaald aan ${reviewed.label}`;
        if (reviewed.status.kind === 'UNBUDGETED') return `Na te kijken · ${reviewed.label} niet begroot`;
        return `Na te kijken · betaling zonder eurowaarde bij ${reviewed.label}`;
      }
      // Without the ledger the server report names the payee.
      const overpaid = streams.find(stream => stream.payee !== 'OTHER' && stream.status === 'OVERPAID' && !stream.finalized);
      if (overpaid) return `Na te kijken · ${eur(overpaid.overpaidEur)} te veel betaald aan ${overpaid.label}`;
      const unbudgeted = streams.find(stream => stream.payee !== 'OTHER' && stream.status === 'ADDITIONAL');
      if (unbudgeted) return `Na te kijken · ${unbudgeted.label} niet begroot`;
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
    legacy,
    legacyEur: legacy ? euro(cents(totals.legacyPaidTotalEur)) : 0,
    agreedEur: item.agreedEur,
    paidEur: item.paidEur,
    paidForeign,
    openEur: item.openEur,
    dueNowEur: item.dueNowEur,
    laterEur: item.laterEur,
    eindkostEur: stream ? euro(cents(stream.forecastEur)) : euro(cents(item.paidEur) + cents(item.openEur)),
    verschilEur: other ? item.paidEur : stream ? euro(cents(stream.varianceEur)) : 0,
    reason: reason.reason,
    reasonLabel: reason.label,
    fxEur: euro(fx),
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

/** The supplier's terms tell their own story once one of them carries a difference the others do not. */
function termsMixed(terms: readonly LedgerTerm[]): boolean {
  if (terms.length < 2 || !terms.some(term => term.lowerEur > 0 || term.higherEur > 0)) return false;
  return new Set(terms.map(term => `${term.state}|${term.settled}|${term.lowerEur > 0 || term.higherEur > 0}`)).size > 1;
}

function termRow(term: LedgerTerm): NacalcTermRow {
  const open = cents(term.openEur);
  let reason: NacalcReason = 'none';
  let label = NACALC_REASON_LABEL.none;
  if (term.lowerEur > 0 && open === 0) { reason = 'settled-lower'; label = NACALC_REASON_LABEL['settled-lower']; }
  else if (term.higherEur > 0) { reason = term.finalized ? 'settled-higher' : 'review'; label = NACALC_REASON_LABEL[reason]; }
  else if (open > 0 && term.lowerEur > 0) { reason = 'partly-settled'; label = `deels afgerekend · nog ${eur(term.openEur)} open`; }
  else if (open > 0) {
    reason = 'open';
    label = term.state === 'due' ? `nog ${eur(term.openEur)} open · nu te betalen` : `nog ${eur(term.openEur)} open · later ${term.moment}`;
  }
  return {
    due: term.due,
    label: term.label,
    agreedEur: term.fullEur,
    paidEur: term.paidEur,
    openEur: term.openEur,
    verschilEur: euro(cents(term.higherEur) - cents(term.lowerEur)),
    reason,
    reasonLabel: label,
    status: term.status,
  };
}

/**
 * One reason word per payee, in this order: bijkomend, onvolledig, niet
 * begroot, te veel betaald, historisch, deels afgerekend, nog open, minder
 * or meer betaald · afgerekend, geen verschil.
 */
export function nacalcReason(
  item: PayeeLedger, stream: PurchaseReconciliationStream | undefined, totals: Pick<PurchaseReconciliationTotals, 'legacyPaidTotalEur'>,
): { reason: NacalcReason; label: string } {
  const word = (reason: NacalcReason, label = NACALC_REASON_LABEL[reason]) => ({ reason, label });
  if (item.payee === 'OTHER') return word('additional');
  switch (item.status.kind) {
    case 'INCOMPLETE': return word('incomplete');
    case 'UNBUDGETED': return word('unbudgeted');
    case 'OVERPAID': return word('review');
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

function receiptBlock(view: PurchaseOrderView, totals: PurchaseReconciliationTotals): NacalcReceipt {
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
    supplierFact,
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
      rows.push({ key: 'ORDERED', label: 'Correctie naar bestelde stuks', amountEur: euro(Math.abs(residue)),
        note: `het budget blijft op ${totals.orderedQuantity} bestelde stuks`, op: residue < 0 ? '−' : '+' });
    } else if (Math.abs(residue) <= 100) {
      rows.push({ key: 'ROUNDING', label: 'Afronding', amountEur: euro(Math.abs(residue)), note: null, op: residue < 0 ? '−' : '+' });
    } else consistent = false;
  }
  rows.push({ key: 'BUDGET', label: 'Begroot extern', amountEur: euro(begroot), note: 'op bestelde aantallen en orderkoersen', op: '=' });
  rows.push({ key: 'PAID', label: 'Betaald', amountEur: euro(cents(totals.paidEur)), note: null, op: '' });
  rows.push({ key: 'OPEN', label: 'Open', amountEur: euro(cents(totals.remainingEur)), note: null, op: '+' });
  rows.push({ key: 'FORECAST', label: summary.kind === 'final' ? 'Eindkost' : 'Verwachte eindkost', amountEur: euro(cents(totals.forecastExternalEur)), note: null, op: '=' });
  if (summary.reviewEur > 0) rows.push({ key: 'REVIEW', label: 'waarvan te veel betaald · nakijken', amountEur: summary.reviewEur, note: null, op: '' });
  if (summary.additionalCostsEur > 0) rows.push({ key: 'ADDITIONAL', label: 'waarvan bijkomende kosten', amountEur: summary.additionalCostsEur, note: null, op: '' });
  rows.push({ key: 'VARIANCE', label: 'Verschil', amountEur: euro(cents(totals.varianceEur)), note: 'eindkost min begroot', op: '→' });
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

/** The server's notes verbatim, then what the client adds and the server does not say yet. */
function clientNotes(view: PurchaseOrderView, receipt: NacalcReceipt | null, financing: PartnerFinancing | null, server: readonly string[]): string[] {
  const notes = [...server];
  if (!server.some(note => /USD of CNY/.test(note))) {
    notes.push('Betalingen in USD of CNY tellen tegen hun geboekte eurobedrag (orderkoers, of het afgeschreven bankbedrag als dat is ingevuld).');
  }
  if (receipt) notes.push('De inkoopwaarde van verloren stuks is de goederenprijs per stuk tegen de orderkoers; transport en rechten zijn verdeeld over de bruikbare stuks.');
  notes.push('De nacalculatie wijzigt geen productkostprijzen; Kostprijzen toepassen (Afronden) gebruikt de calculatie per stuk.');
  if (view.order.partnerCustomerId != null && financing?.settlementInvoiceNumber) {
    notes.push('Uitgereikte afrekeningen zijn bevroren; latere kostwijzigingen wijzigen ze niet.');
  }
  return notes;
}
