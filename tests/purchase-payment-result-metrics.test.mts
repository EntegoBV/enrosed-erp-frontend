import assert from 'node:assert/strict';
import test from 'node:test';
import type { PurchaseOrderView, PurchaseReconciliationStream } from '../src/app/core/api/models.ts';
import {
  NACALC_LABEL, NACALC_PILL, landedUnit, landedUnitText, mixHeadline, mixPricingRange, mixQuantity, mixReceiptLine, mixRowFigure, nacalcKind, nacalcUnitMix,
  purchaseNacalcSummary, purchasePaymentResult, reconciliationLineUnit, reconciliationUnit,
} from '../src/app/features/purchasing/purchase-payment-result-metrics.ts';
import type { PurchaseReconciliationLine, PurchaseReconciliationTotals } from '../src/app/core/api/models.ts';

function stream(values: Partial<PurchaseReconciliationStream> = {}): PurchaseReconciliationStream {
  return { payee: 'SUPPLIER', label: 'Leverancier', status: 'PARTIAL', plannedEur: 1_000,
    paidEur: 300, remainingEur: 700, forecastEur: 1_000, varianceEur: 0, overpaidEur: 0,
    settledSavingEur: 0, explicitlySettled: false, finalized: false, paymentCount: 1, ...values };
}

function purchase(streams = [stream()], finalized = false): PurchaseOrderView {
  return {
    order: { id: 1, status: 'BESTELD', lines: [{ id: 1, productId: 10, quantity: 100 }],
      extraRevenueEur: 250, usdToEurGoods: 0.9, cnyToUsd: 0.14 },
    costing: { totals: { extraRevenueEur: 250, totalEur: 1_250, totalWithSeparateCostsEur: 1_300 } },
    reconciliation: {
      streams,
      totals: { plannedExternalEur: 1_000, paidEur: 300, remainingEur: 700, forecastExternalEur: 1_000,
        varianceEur: 0, internalMarkupEur: 250, plannedPricingEur: 1_250, forecastPricingEur: 1_250, finalized },
      lines: [], notes: [],
    },
  } as PurchaseOrderView;
}

function lower(payee: PurchaseReconciliationStream['payee'] = 'SUPPLIER', saving = 60) {
  return stream({ payee, status: 'SETTLED_LOWER', paidEur: 1_000 - saving, remainingEur: 0,
    forecastEur: 1_000 - saving, varianceEur: -saving, settledSavingEur: saving,
    explicitlySettled: true, finalized: true });
}

test('unpaid and partially paid streams never turn their outstanding balance into a benefit', () => {
  for (const paidEur of [0, 300, 995]) {
    const view = purchase([stream({ paidEur, remainingEur: 1_000 - paidEur })]);
    const result = purchasePaymentResult(view)!;
    assert.equal(result.eligible, true);
    assert.equal(result.settledSavingsEur, 0);
    assert.equal(result.netResultEur, 0);
    assert.equal(result.markupWithResultEur, 250);
    assert.equal(result.finalized, false);
  }
});

test('a confirmed lower cost enters the pot immediately while other payment groups remain open', () => {
  const view = purchase([lower(), stream({ payee: 'LOGISTICS', label: 'Douane & transport' })]);
  const result = purchasePaymentResult(view)!;
  assert.equal(result.settledSavingsEur, 60);
  assert.equal(result.netResultEur, 60);
  assert.equal(result.markupWithResultEur, 310);
  assert.equal(result.finalized, false, 'The whole container is still provisional');
  assert.equal(result.streams[0].finalized, true);
  assert.equal(result.streams[1].finalized, false);
  assert.equal(result.streams[1].savingEur, 0);
});

test('reopening, correcting or deleting the settling payment follows the fresh server response', () => {
  const original = purchase([lower()], true);
  assert.equal(purchasePaymentResult(original)!.settledSavingsEur, 60);
  const reopened = purchase([stream({ paidEur: 940, remainingEur: 60 })]);
  const corrected = purchase([lower('SUPPLIER', 40)], true);
  const deleted = purchase([stream({ paidEur: 300, remainingEur: 700 })]);
  assert.equal(purchasePaymentResult(reopened)!.netResultEur, 0);
  assert.equal(purchasePaymentResult(corrected)!.netResultEur, 40);
  assert.equal(purchasePaymentResult(deleted)!.netResultEur, 0);
  assert.equal(purchasePaymentResult(original)!.netResultEur, 60, 'The helper does not mutate or retain another snapshot');
});

test('unconfirmed overpayment stays separate until explicitly settled, then becomes a loss', () => {
  const overrun = stream({ paidEur: 1_075, remainingEur: 0, forecastEur: 1_075,
    varianceEur: 75, overpaidEur: 75, status: 'OVERPAID' });
  const pending = purchasePaymentResult(purchase([overrun]))!;
  assert.equal(pending.unsettledOverrunsEur, 75);
  assert.equal(pending.settledOverrunsEur, 0);
  assert.equal(pending.netResultEur, 0);
  const settled = purchasePaymentResult(purchase([{ ...overrun, explicitlySettled: true, finalized: true }], true))!;
  assert.equal(settled.unsettledOverrunsEur, 0);
  assert.equal(settled.settledOverrunsEur, 75);
  assert.equal(settled.netResultEur, -75);
  assert.equal(settled.markupWithResultEur, 175);
  assert.equal(settled.finalized, true);
});

test('gross savings, final overruns and OTHER fees remain visible and are counted exactly once', () => {
  const result = purchasePaymentResult(purchase([
    lower('SUPPLIER', 60), lower('SEPARATE', 20),
    stream({ payee: 'LOGISTICS', label: 'Douane & transport', status: 'OVERPAID',
      overpaidEur: 100, paidEur: 1_100, explicitlySettled: true, finalized: true }),
    stream({ payee: 'OTHER', label: 'Andere betaling', status: 'ADDITIONAL', plannedEur: 0,
      paidEur: 25.95, remainingEur: 0, forecastEur: 25.95, varianceEur: 25.95, finalized: true }),
  ], true))!;
  assert.equal(result.settledSavingsEur, 80);
  assert.equal(result.settledOverrunsEur, 100);
  assert.equal(result.additionalCostsEur, 25.95);
  assert.equal(result.netResultEur, -45.95);
  assert.equal(result.markupWithResultEur, 204.05);
  assert.equal(result.streams[3].additionalCostEur, 25.95);
  assert.equal(result.streams[3].settledOverrunEur, 0);
});

test('the projection uses server euro amounts and never converts original currencies at new FX rates', () => {
  const view = purchase([stream({ plannedEur: 100, paidEur: 87.65, settledSavingEur: 12.35,
    explicitlySettled: true, finalized: true, status: 'SETTLED_LOWER' })], true);
  const first = purchasePaymentResult(view);
  view.order.usdToEurGoods = 0.3;
  view.order.cnyToUsd = 0.7;
  assert.deepEqual(purchasePaymentResult(view), first);
  assert.equal(first!.netResultEur, 12.35);
  assert.equal(first!.streams[0].paidEur, 87.65);
});

test('concept and empty orders cannot claim realized benefits or losses, but retain the markup preview', () => {
  for (const empty of [false, true]) {
    const view = purchase([lower(), stream({ payee: 'OTHER', paidEur: 12, finalized: true })], true);
    if (empty) view.order.lines = [];
    else view.order.status = 'CONCEPT';
    const result = purchasePaymentResult(view)!;
    assert.equal(result.eligible, false);
    assert.equal(result.finalized, false);
    assert.equal(result.netResultEur, 0);
    assert.equal(result.settledSavingsEur, 0);
    assert.equal(result.additionalCostsEur, 0);
    assert.equal(result.internalMarkupEur, 250);
    assert.equal(result.markupWithResultEur, 250);
    assert.ok(result.streams.every(row => !row.finalized && row.netResultEur === 0));
  }
});

test('missing reconciliation is unknown and never falls back to budget minus paid', () => {
  const view = purchase();
  view.reconciliation = null;
  assert.equal(purchasePaymentResult(view), null);
  delete view.reconciliation;
  assert.equal(purchasePaymentResult(view), null);
});

test('missing historical EUR or incomplete settlement flags cannot expose a positive saving', () => {
  for (const change of [
    { finalized: false }, { explicitlySettled: false },
    { paidEur: null }, { plannedEur: Number.NaN }, { settledSavingEur: Number.POSITIVE_INFINITY },
  ]) {
    const unsafe = { ...lower(), ...change } as PurchaseReconciliationStream;
    const result = purchasePaymentResult(purchase([unsafe], true))!;
    assert.equal(result.settledSavingsEur, 0);
    assert.equal(result.netResultEur, 0);
    assert.equal(result.finalized, false);
    if (change.paidEur === null) assert.equal(result.streams[0].paidEur, null);
  }
});

test('known OTHER fees remain incurred costs even when another historical EUR payment is unresolved', () => {
  const view = purchase([stream({ payee: 'OTHER', label: 'Andere betaling', plannedEur: 0,
    paidEur: 8.95, paymentCount: 2, finalized: false, explicitlySettled: false })]);
  const result = purchasePaymentResult(view)!;
  assert.equal(result.additionalCostsEur, 8.95);
  assert.equal(result.netResultEur, -8.95);
  assert.equal(result.finalized, false);
});

test('cent aggregates and the combined display do not expose floating point artifacts', () => {
  const result = purchasePaymentResult(purchase([
    lower('SUPPLIER', 0.1), lower('SEPARATE', 0.2),
    stream({ payee: 'OTHER', paidEur: 0.05, plannedEur: 0, finalized: true }),
  ], true))!;
  assert.equal(result.settledSavingsEur, 0.3);
  assert.equal(result.netResultEur, 0.25);
  assert.equal(result.markupWithResultEur, 250.25);
});

test('the pot is explanatory only: Enrosed cost, product prices, forecasts and input DTO remain untouched', () => {
  const view = purchase([lower()], true);
  view.reconciliation!.totals.forecastExternalEur = 940;
  view.reconciliation!.totals.forecastPricingEur = 1_190;
  const before = structuredClone(view);
  function freeze(value: unknown) {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  }
  freeze(view);
  const result = purchasePaymentResult(view)!;
  assert.equal(result.netResultEur, 60);
  assert.equal(result.markupWithResultEur, 310);
  assert.deepEqual(view, before);
  assert.equal(view.order.extraRevenueEur, 250);
  assert.equal(view.costing.totals.totalWithSeparateCostsEur, 1_300);
  assert.equal(view.reconciliation!.totals.forecastExternalEur, 940);
  assert.equal(view.reconciliation!.totals.forecastPricingEur, 1_190);
});

function termPurchase(): PurchaseOrderView {
  const view = purchase([stream({ plannedEur: 59_620, paidEur: 17_000, remainingEur: 41_734,
    settledSavingEur: 886, forecastEur: 58_734, varianceEur: -886 })]);
  view.reconciliation!.supplierInstalments = [
    { due: 'ORDERED', label: '30% bij bestelling', plannedEur: 17_886, paidEur: 17_000,
      remainingEur: 0, settledSavingEur: 886, overpaidEur: 0, explicitlySettled: true, finalized: true },
    { due: 'SHIPPED', label: '30% bij vertrek', plannedEur: 17_886, paidEur: 0,
      remainingEur: 17_886, settledSavingEur: 0, overpaidEur: 0, explicitlySettled: false, finalized: false },
    { due: 'ARRIVED', label: '40% bij aankomst', plannedEur: 23_848, paidEur: 0,
      remainingEur: 23_848, settledSavingEur: 0, overpaidEur: 0, explicitlySettled: false, finalized: false },
  ];
  return view;
}

test('settling just the first 30% counts its 886 saving while the other 70% stays open', () => {
  const view = termPurchase();
  const result = purchasePaymentResult(view)!;
  assert.equal(result.netResultEur, 886);
  assert.equal(result.settledSavingsEur, 886, 'The same saving on the stream is not added twice');
  assert.equal(result.finalized, false);
  assert.equal(result.streams[0].finalized, false);
  assert.equal(view.reconciliation!.streams[0].remainingEur, 41_734);
  assert.equal(result.markupWithResultEur, 1_136);
});

test('reopening or deleting the term slot immediately removes its recognized saving', () => {
  const view = termPurchase();
  const term = view.reconciliation!.supplierInstalments![0];
  Object.assign(term, { explicitlySettled: false, finalized: false, remainingEur: 886, settledSavingEur: 0 });
  assert.equal(purchasePaymentResult(view)!.netResultEur, 0);
  Object.assign(term, { paidEur: 0, remainingEur: 17_886 });
  assert.equal(purchasePaymentResult(view)!.netResultEur, 0);
});

test('finalized and provisional overruns of other instalments are kept apart', () => {
  const view = termPurchase();
  const second = view.reconciliation!.supplierInstalments![1];
  Object.assign(second, { paidEur: 17_986, remainingEur: 0, overpaidEur: 100 });
  const provisional = purchasePaymentResult(view)!;
  assert.equal(provisional.netResultEur, 886);
  assert.equal(provisional.unsettledOverrunsEur, 100);
  Object.assign(second, { explicitlySettled: true, finalized: true });
  const finalized = purchasePaymentResult(view)!;
  assert.equal(finalized.netResultEur, 786);
  assert.equal(finalized.settledOverrunsEur, 100);
  assert.equal(finalized.unsettledOverrunsEur, 0);
});

test('missing term EUR figures or a provisional explicit marker never count as a saving', () => {
  const view = termPurchase();
  const first = view.reconciliation!.supplierInstalments![0];
  first.finalized = false;
  assert.equal(purchasePaymentResult(view)!.netResultEur, 0);
  first.finalized = true;
  first.paidEur = null as unknown as number;
  assert.equal(purchasePaymentResult(view)!.netResultEur, 0);
});

test('all separately finalized instalments finalize the group without a whole-group marker', () => {
  const view = termPurchase();
  for (const term of view.reconciliation!.supplierInstalments!.slice(1)) {
    Object.assign(term, { paidEur: term.plannedEur, remainingEur: 0, finalized: true });
  }
  view.reconciliation!.streams[0].finalized = true;
  view.reconciliation!.totals.finalized = true;
  const result = purchasePaymentResult(view)!;
  assert.equal(result.netResultEur, 886);
  assert.equal(result.finalized, true);
  assert.equal(result.streams[0].finalized, true);
});

test('the nacalculatie summary is null without a reconciliation and never claims a result on a concept', () => {
  const missing = purchase();
  missing.reconciliation = null;
  assert.equal(purchaseNacalcSummary(missing), null);
  delete missing.reconciliation;
  assert.equal(purchaseNacalcSummary(missing), null);
  const concept = purchase([lower()], true);
  concept.order.status = 'CONCEPT';
  const draft = purchaseNacalcSummary(concept)!;
  assert.equal(draft.eligible, false);
  assert.equal(draft.netResultEur, 0);
  assert.equal(draft.markupWithResultEur, 250);
});

test('the nacalculatie summary carries the server forecast and variance next to the settled result', () => {
  const view = purchase([lower()], true);
  Object.assign(view.reconciliation!.totals, { paidEur: 940, remainingEur: 0, forecastExternalEur: 940, varianceEur: -60 });
  const summary = purchaseNacalcSummary(view)!;
  assert.deepEqual(summary, {
    eligible: true, finalized: true, forecastEur: 940, varianceEur: -60, netResultEur: 60, internalMarkupEur: 250, markupWithResultEur: 310,
    kind: 'final', label: 'Eindkost', pill: { label: 'Definitief', tone: 'ok' }, openEur: 0, reviewEur: 0,
    unitEur: null, unitQuantity: 0, unitBasis: 'ORDERED', unitWord: 'stuk', pieceEur: null, pieceQuantity: 0, setPieces: null,
    settledSavingsEur: 60, settledOverrunsEur: 0, additionalCostsEur: 0,
    mix: { uniform: true, count: 0, unit: 'stuk', minEur: null, maxEur: null, pricingMinEur: null, pricingMaxEur: null, rows: [], quantity: 0 },
  });
  const provisional = purchaseNacalcSummary(purchase([stream({ paidEur: 300, remainingEur: 700 })]))!;
  assert.deepEqual([provisional.finalized, provisional.forecastEur, provisional.varianceEur, provisional.netResultEur], [false, 1_000, 0, 0]);
  assert.deepEqual([provisional.kind, provisional.label, provisional.pill, provisional.openEur, provisional.reviewEur],
    ['provisional', 'Verwachte eindkost', { label: 'Voorlopig', tone: 'neutral' }, 700, 0]);
});

test('the summary carries the state machine: concept, review on an unsettled overrun or a missing euro amount, final only when everything is', () => {
  const concept = purchase([lower()], true);
  concept.order.status = 'CONCEPT';
  const draft = purchaseNacalcSummary(concept)!;
  assert.deepEqual([draft.kind, draft.label, draft.pill], ['concept', 'Verwachte eindkost', { label: 'Nog niet besteld', tone: 'outline' }]);
  const overrun = stream({ paidEur: 1_075, remainingEur: 0, forecastEur: 1_075, varianceEur: 75, overpaidEur: 75, status: 'OVERPAID' });
  const review = purchaseNacalcSummary(purchase([overrun]))!;
  assert.deepEqual([review.kind, review.label, review.pill.label, review.reviewEur], ['review', 'Verwachte eindkost', 'Na te kijken', 75]);
  const missing = purchaseNacalcSummary(purchase([{ ...stream(), paidEur: null as unknown as number }]))!;
  assert.equal(missing.kind, 'review', 'a stream without its euro amount cannot be a plain forecast');
  const settled = purchaseNacalcSummary(purchase([{ ...overrun, explicitlySettled: true, finalized: true }], true))!;
  assert.deepEqual([settled.kind, settled.reviewEur, settled.settledOverrunsEur], ['final', 0, 75]);
  const notYetTotals = purchaseNacalcSummary(purchase([lower()], false))!;
  assert.equal(notYetTotals.kind, 'provisional', 'the server totals must also say finalized');
  for (const kind of ['concept', 'provisional', 'review', 'final'] as const) {
    assert.equal(NACALC_PILL[kind].label.length > 0 && NACALC_LABEL[kind].length > 0, true);
  }
});

test('with the ledger, an overpaid, unbudgeted or incomplete payee (or figures that do not close) means review', () => {
  const view = purchase([stream({ paidEur: 300, remainingEur: 700 })]);
  const result = purchasePaymentResult(view)!;
  const payee = (kind: string) => ({ status: { kind } });
  const balanced = { summary: { balanced: true } };
  assert.equal(nacalcKind(result, view.reconciliation!.totals, { payees: [payee('PARTIAL')], ...balanced } as never), 'provisional');
  for (const kind of ['OVERPAID', 'UNBUDGETED', 'INCOMPLETE']) {
    assert.equal(nacalcKind(result, view.reconciliation!.totals, { payees: [payee('PARTIAL'), payee(kind)], ...balanced } as never), 'review', kind);
  }
  assert.equal(nacalcKind(result, view.reconciliation!.totals, { payees: [payee('PARTIAL')], summary: { balanced: false } } as never), 'review');
  assert.equal(purchaseNacalcSummary(view, { payees: [payee('INCOMPLETE')], ...balanced } as never)!.pill.label, 'Na te kijken');
  const unit = purchase([stream({ paidEur: 300, remainingEur: 700 })]);
  Object.assign(unit.reconciliation!.totals, { forecastExternalUnitEur: 12.6267, unitCostQuantity: 5_560, unitCostBasis: 'ORDERED' });
  const summary = purchaseNacalcSummary(unit)!;
  assert.deepEqual([summary.unitEur, summary.unitQuantity, summary.unitBasis], [12.6267, 5_560, 'ORDERED']);
});

test('PO 35: netted terms leave € 0,50 to review, never the 30 % term’s gross € 61,28', () => {
  const view = purchase([stream({ status: 'OVERPAID', plannedEur: 31_048.04, paidEur: 31_048.54, remainingEur: 0, forecastEur: 31_048.54,
    varianceEur: 0.5, overpaidEur: 0.5, paymentCount: 2 })]);
  view.order.status = 'ONTVANGEN';
  Object.assign(view.reconciliation!.totals, { plannedExternalEur: 31_048.04, paidEur: 31_048.54, remainingEur: 0,
    forecastExternalEur: 31_048.54, varianceEur: 0.5, internalMarkupEur: 0 });
  view.reconciliation!.supplierInstalments = [
    { due: 'ORDERED', label: '30% bij bestelling', plannedEur: 9_314.41, paidEur: 9_375.69, remainingEur: 0, settledSavingEur: 0,
      overpaidEur: 0.5, explicitlySettled: false, finalized: false, offsetEur: -60.78 },
    { due: 'SHIPPED', label: '70% bij vertrek', plannedEur: 21_733.63, paidEur: 21_672.85, remainingEur: 0, settledSavingEur: 0,
      overpaidEur: 0, explicitlySettled: false, finalized: true, offsetEur: 60.78 },
  ];
  const result = purchasePaymentResult(view)!;
  assert.deepEqual([result.unsettledOverrunsEur, result.settledOverrunsEur, result.settledSavingsEur, result.netResultEur], [0.5, 0, 0, 0]);
  const summary = purchaseNacalcSummary(view)!;
  assert.deepEqual([summary.kind, summary.reviewEur, summary.forecastEur, summary.varianceEur, summary.openEur], ['review', 0.5, 31_048.54, 0.5, 0]);
  // Settling the whole supplier makes the € 0,50 a confirmed overrun.
  for (const term of view.reconciliation!.supplierInstalments) Object.assign(term, { explicitlySettled: true, finalized: true });
  Object.assign(view.reconciliation!.streams[0], { explicitlySettled: true, finalized: true });
  const settled = purchasePaymentResult(view)!;
  assert.deepEqual([settled.unsettledOverrunsEur, settled.settledOverrunsEur, settled.netResultEur], [0, 0.5, -0.5]);
});

/* ---- per product instead of a mixed average (Emre, 2026-10-15: 'Per stuk € 2,4473 · 6.920 bestelde stuks — want als meerdere producten dan klopt dat niet') */

const plain = (text: string | null) => text == null ? text : text.replace(/[\u00a0\u202f]/g, ' ');
function line(productId: number, name: string, values: Partial<PurchaseReconciliationLine> = {}): PurchaseReconciliationLine {
  return { productId, productName: name, orderedQuantity: 1000, receivedQuantity: 0, damagedQuantity: 0, usableQuantity: 0, unitCostQuantity: 1000,
    unitCostBasis: 'ORDERED', plannedExternalEur: 0, paidEur: 0, remainingEur: 0, forecastExternalEur: 2000, varianceEur: 0, internalMarkupEur: 0,
    forecastPricingEur: 0, forecastExternalUnitEur: 2, forecastPricingUnitEur: null, allocationBasis: 'VALUE', ...values };
}
const totals = (values: Partial<PurchaseReconciliationTotals> = {}) => ({ forecastExternalUnitEur: 2.4473, unitCostQuantity: 6920, ...values }) as PurchaseReconciliationTotals;

test('one product keeps its per-unit figure; several get their range and the products by value, never an average', () => {
  const one = nacalcUnitMix({ lines: [line(10, 'Rozenschaal Roze')], totals: totals() });
  assert.deepEqual([one.uniform, one.count], [true, 1]);
  const mixed = nacalcUnitMix({ lines: [line(10, 'Rozenschaal Roze', { forecastExternalEur: 2000, forecastExternalUnitEur: 2 }),
    line(11, 'Vaas glas', { forecastExternalEur: 9000, forecastExternalUnitEur: 3.1 }), line(12, 'Lint', { forecastExternalEur: 500, forecastExternalUnitEur: 0.5 }),
    line(13, 'Doos', { forecastExternalEur: 1000, forecastExternalUnitEur: 1 })], totals: totals() });
  assert.deepEqual([mixed.uniform, mixed.count, mixed.unit, mixed.minEur, mixed.maxEur], [false, 4, 'stuk', 0.5, 3.1]);
  assert.deepEqual(mixed.rows.slice(0, 3).map(row => row.name), ['Vaas glas', 'Rozenschaal Roze', 'Doos'], 'the most valuable first');
  assert.equal(plain(mixHeadline(mixed)), '4 producten · € 0,5000 – € 3,1000 per stuk');
  assert.equal(plain(mixQuantity(mixed)), '6.920 st', 'the count the figures rest on, no average beside it');
  assert.equal('averageEur' in mixed, false, 'the mix carries no container average at all');
  assert.equal(plain(mixRowFigure(mixed.rows[0])), '€ 3,1000 /stuk');
});

test('only one product keeps the container figure, like the server (no family rule); displays and pieces together range per stuk', () => {
  const colours = nacalcUnitMix({ lines: [line(10, 'Box Rood'), line(11, 'Box Roze')], totals: totals() });
  assert.equal(colours.uniform, false, 'colour variants of one family are two products: their range, no average');
  assert.equal(nacalcUnitMix({ lines: [line(10, 'Box Rood'), line(10, 'Box Rood', { orderedQuantity: 200 })], totals: totals() }).uniform, true,
    'two lines of one product are one product');
  const set = { salesUnit: 'DISPLAY' as const, piecesPerUnit: 12, unitOther: 'rozen' };
  assert.equal(nacalcUnitMix({ lines: [line(10, 'Box Rood', set), line(11, 'Box Roze', set)], totals: totals() }).uniform, false,
    'one family in one display size is still two products');
  const mixed = nacalcUnitMix({ lines: [line(10, 'Long stem rose box', { ...set, forecastExternalEur: 15740.4, forecastExternalUnitEur: 31.6072, forecastExternalPieceEur: 2.6339 }),
    line(12, 'Rozenschaal Roze', { forecastExternalEur: 17892.93, forecastExternalUnitEur: 8.9465 })],
    totals: totals({ setBasis: 'MIXED', forecastExternalUnitEur: 13.334, forecastExternalPieceEur: 4.2168, unitCostPieceQuantity: 7976 }) });
  assert.deepEqual([mixed.unit, mixed.minEur, mixed.maxEur], ['stuk', 2.6339, 8.9465], 'a display at its piece price');
  assert.equal(plain(mixQuantity(mixed)), '7.976 st');
  assert.equal(plain(mixRowFigure(mixed.rows.find(row => row.unit === 'display')!)), '€ 31,6072 /display · € 2,6339 /stuk');
  const sets = nacalcUnitMix({ lines: [line(10, 'Box A', { ...set, forecastExternalUnitEur: 30 }), line(14, 'Box B', { ...set, forecastExternalUnitEur: 33 })],
    totals: totals({ setBasis: 'DISPLAY', forecastExternalUnitEur: 31.5, unitCostQuantity: 498 }) });
  assert.deepEqual([sets.uniform, sets.unit, sets.minEur, sets.maxEur, plain(mixQuantity(sets)), plain(mixHeadline(sets))],
    [false, 'display', 30, 33, '498 displays', '2 producten · € 30,0000 – € 33,0000 per display']);
});

test('the summary card carries the mix; the server\'s word wins when it sends one', () => {
  const view = purchase();
  view.reconciliation!.lines = [line(10, 'A'), line(11, 'B')];
  assert.equal(purchaseNacalcSummary(view)!.mix.uniform, false);
  Object.assign(view.reconciliation!.totals, { containerAverage: false, productCount: 2 });
  assert.deepEqual([purchaseNacalcSummary(view)!.mix.uniform, purchaseNacalcSummary(view)!.mix.count], [false, 2]);
  Object.assign(view.reconciliation!.totals, { containerAverage: true });
  assert.equal(purchaseNacalcSummary(view)!.mix.uniform, true);
  view.reconciliation!.lines = [line(10, 'A')];
  delete view.reconciliation!.totals.containerAverage;
  assert.equal(purchaseNacalcSummary(view)!.mix.uniform, true, 'an older server: one product keeps its figure');
});

/* ---- round 3: no mixed average anywhere (Emre: the container-wide 'Per stuk' 'klopt niet' with several products) */

test('the Kostbasis range comes from each product with its Enrosed kost; the receipt speaks per product', () => {
  const set = { salesUnit: 'DISPLAY' as const, piecesPerUnit: 12, unitOther: 'rozen' };
  const mixed = nacalcUnitMix({ lines: [
    line(10, 'Long stem rose box display Rood', { ...set, orderedQuantity: 500, unitCostQuantity: 498, forecastExternalEur: 15740.4, forecastExternalUnitEur: 31.6072,
      forecastExternalPieceEur: 2.6339, forecastPricingUnitEur: 33.9778, forecastPricingPieceEur: 2.8315 }),
    line(12, 'Rozenschaal Roze', { orderedQuantity: 2000, unitCostQuantity: 2000, forecastExternalEur: 17892.93, forecastExternalUnitEur: 8.9465, forecastPricingUnitEur: 9.6175 })],
    totals: totals({ setBasis: 'MIXED', unitCostPieceQuantity: 7976 }) });
  assert.equal(plain(mixPricingRange(mixed)), '€ 2,8315 – € 9,6175', 'per stuk with the Enrosed kost, a display at its piece price');
  assert.equal(plain(mixReceiptLine(mixed)),
    'Long stem rose box display Rood: kost per bruikbare display € 31,6072, per bestelde display zou dit € 31,4808 zijn (+ € 0,1264) · 1 ander product zonder verschil');
  const clean = nacalcUnitMix({ lines: [line(12, 'A'), line(13, 'B')], totals: totals() });
  assert.equal(mixReceiptLine(clean), 'Geen product verandert van kost per eenheid');
  const noPricing = nacalcUnitMix({ lines: [line(12, 'A', { forecastPricingUnitEur: 2.1 }), line(13, 'B')], totals: totals() });
  assert.equal(mixPricingRange(noPricing), null, 'a product without the figure: no range that would hide it');
});

test("the order header: one product keeps its figure (a display per display with its piece price), several their range, never 'gem.'", () => {
  const up = (value: number) => (Math.ceil(value * 1000 - 1e-9) / 1000).toLocaleString('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 3 });
  const sets = (id: number) => id === 301 ? 12 : null;
  const display = { productId: 301, quantity: 500, totalEur: 15600 }, bowls = { productId: 302, quantity: 2000, totalEur: 17733.33 };
  const mixed = landedUnit([display, bowls], 13.3333, false, sets)!;
  assert.deepEqual([mixed.mix, mixed.count, mixed.unit], [true, 2, 'stuk']);
  assert.equal(plain(landedUnitText(mixed, up))!.replace(/\u2060/g, ''), '2 producten · € 2,600 – € 8,867 per stuk', 'the display at its piece price, beside the bowls');
  assert.match(landedUnitText(mixed, up), /€\u00a02,600\u00a0–\u2060\u00a0€/, 'the range never breaks inside itself');
  const one = landedUnit([{ productId: 301, quantity: 400, totalEur: 12384 }], 30.96, true, sets);
  assert.equal(plain(landedUnitText(one, up)), '€ 30,960 per display · € 2,580 per stuk', "PO-30's display price is per display");
  assert.equal(plain(landedUnitText(landedUnit([bowls], 8.8667, true, sets), up)), '€ 8,867 per stuk');
  const family = landedUnit([{ productId: 302, quantity: 1000, totalEur: 8000 }, { productId: 303, quantity: 1000, totalEur: 9000 }], 8.5, false, sets);
  assert.equal(plain(landedUnitText(family, up))!.replace(/\u2060/g, ''), '2 producten · € 8,000 – € 9,000 per stuk',
    'two variants of one family are two products (the mix says so since the family rule is gone): their range');
  assert.equal(landedUnit([], 0, true, sets), null);
});

/* ---- Analyses › Inkoop: a display product per display with its piece price, never its display figure called 'per stuk' */

test("one display product reads per display with 'per stuk' beside it; pieces stay per stuk; a mixed basis counts per stuk", () => {
  const set = { salesUnit: 'DISPLAY' as const, piecesPerUnit: 12, unitOther: 'rozen' };
  // PO-30: 400 displays of 12 rozen at € 30,96 (the server sends the piece price).
  const po30 = reconciliationUnit(totals({ setBasis: 'DISPLAY', setPieces: 12, forecastExternalUnitEur: 30.96, forecastExternalPieceEur: 2.58,
    forecastPricingUnitEur: 33.282, forecastPricingPieceEur: 2.7735, unitCostQuantity: 400, unitCostBasis: 'ORDERED' }));
  assert.deepEqual([po30.unit, po30.plural, po30.unitEur, po30.pieceEur, po30.pricingUnitEur, po30.pricingPieceEur, po30.quantity, po30.usable],
    ['display', 'displays', 30.96, 2.58, 33.282, 2.7735, 400, false]);
  const older = reconciliationUnit(totals({ setBasis: 'DISPLAY', setPieces: 12, forecastExternalUnitEur: 30.96, forecastPricingUnitEur: 33.282, unitCostQuantity: 400 }));
  assert.deepEqual([older.pieceEur, older.pricingPieceEur], [2.58, 2.7735], 'without the server\'s piece price: the display price over its pieces');
  const pieces = reconciliationUnit(totals({ forecastExternalUnitEur: 8.06, forecastPricingUnitEur: 8.6645, unitCostQuantity: 5000, unitCostBasis: 'USABLE_RECEIVED' }));
  assert.deepEqual([pieces.unit, pieces.plural, pieces.unitEur, pieces.pieceEur, pieces.quantity, pieces.usable], ['stuk', 'stuks', 8.06, null, 5000, true]);
  const mixed = reconciliationUnit(totals({ setBasis: 'MIXED', forecastExternalUnitEur: 13.334, forecastExternalPieceEur: 4.2168,
    forecastPricingPieceEur: 4.5, unitCostQuantity: 2500, unitCostPieceQuantity: 7976 }));
  assert.deepEqual([mixed.unit, mixed.unitEur, mixed.pricingUnitEur, mixed.quantity], ['stuk', 4.2168, 4.5, 7976], 'never the per-unit average of displays and pieces');
  // PO-14's Per product list: the display per display (498 usable displays), the bowl per stuk.
  const display = reconciliationLineUnit(line(10, 'Long stem rose box display Rood', { ...set, unitCostBasis: 'USABLE_RECEIVED', unitCostQuantity: 498,
    forecastExternalUnitEur: 31.6072, forecastExternalPieceEur: 2.6339, forecastPricingUnitEur: 33.9778, forecastPricingPieceEur: 2.8315 }));
  assert.deepEqual([display.unit, display.plural, display.unitEur, display.pieceEur, display.pricingUnitEur, display.quantity, display.usable],
    ['display', 'displays', 31.6072, 2.6339, 33.9778, 498, true]);
  const bowl = reconciliationLineUnit(line(12, 'Rozenschaal Roze', { forecastExternalUnitEur: 8.9465, forecastPricingUnitEur: 9.6175, unitCostQuantity: 2000 }));
  assert.deepEqual([bowl.unit, bowl.unitEur, bowl.pieceEur, bowl.pricingUnitEur, bowl.quantity], ['stuk', 8.9465, null, 9.6175, 2000]);
});
