import assert from 'node:assert/strict';
import test from 'node:test';
import type { PurchaseOrderView, PurchaseReconciliationStream } from '../src/app/core/api/models.ts';
import { purchasePaymentResult } from '../src/app/features/purchasing/purchase-payment-result-metrics.ts';

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
