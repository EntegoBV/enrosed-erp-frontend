import assert from 'node:assert/strict';
import test from 'node:test';
import type { PurchaseOrderView, PurchaseReconciliationStream } from '../src/app/core/api/models.ts';
import { purchasePaymentResult } from '../src/app/features/purchasing/purchase-payment-result-metrics.ts';
import { containerCostRows, containerCostTotals, purchaseExternalCost } from '../src/app/features/purchasing/purchase-reconciliation-metrics.ts';
import { containerPaymentResultTotals } from '../src/app/features/analyses/container-payment-result-metrics.ts';
import { resultAnalysis } from '../src/app/features/analyses/analysis-metrics.ts';

function stream(values: Partial<PurchaseReconciliationStream> = {}): PurchaseReconciliationStream {
  return {
    payee: 'SUPPLIER', label: 'Leverancier', status: 'PARTIAL', plannedEur: 1_000,
    paidEur: 400, remainingEur: 600, forecastEur: 1_000, varianceEur: 0,
    overpaidEur: 0, settledSavingEur: 0, explicitlySettled: false, finalized: false, paymentCount: 1,
    ...values,
  };
}
function purchase(id: number, streams: PurchaseReconciliationStream[], finalized = false): PurchaseOrderView {
  const planned = streams.reduce((sum, item) => sum + item.plannedEur, 0);
  const forecast = streams.reduce((sum, item) => sum + item.forecastEur, 0);
  return {
    order: { id, number: `PO-2026-${id}`, alias: null, status: 'ONTVANGEN', orderDate: '2026-05-01',
      receivedOn: '2026-06-01', extraRevenueEur: 250, lines: [{ productId: 10, quantity: 100 }] },
    costing: { totals: { totalEur: planned + 250, totalWithSeparateCostsEur: planned + 250, extraRevenueEur: 250 } },
    reconciliation: { streams, lines: [], notes: [], totals: {
      plannedExternalEur: planned, forecastExternalEur: forecast, varianceEur: forecast - planned,
      paidEur: streams.reduce((sum, item) => sum + item.paidEur, 0),
      remainingEur: streams.reduce((sum, item) => sum + item.remainingEur, 0),
      internalMarkupEur: 250, plannedPricingEur: planned + 250, forecastPricingEur: forecast + 250,
      finalized, orderedQuantity: 100, receivedQuantity: 100, damagedQuantity: 0, usableQuantity: 100,
      unitCostQuantity: 100, unitCostBasis: 'USABLE_RECEIVED', forecastExternalUnitEur: forecast / 100,
      forecastPricingUnitEur: (forecast + 250) / 100, receiptRecorded: true, legacyPaidTotalEur: null,
    } },
  } as PurchaseOrderView;
}
function saved(amount = 100) {
  return stream({ status: 'SETTLED_LOWER', paidEur: 1_000 - amount, remainingEur: 0,
    forecastEur: 1_000 - amount, varianceEur: -amount, settledSavingEur: amount, explicitlySettled: true, finalized: true });
}
function rows(purchases: PurchaseOrderView[], filter: Parameters<typeof containerCostRows>[1] = 'active', search = '') {
  return containerCostRows(purchases, filter, search).map(row => ({ ...row, paymentResult: purchasePaymentResult(row.view) }));
}

test('partial payments stay zero; only the settled stream contributes before the whole container closes', () => {
  const partial = purchase(1, [stream()]);
  const mixed = purchase(2, [saved(), stream({ payee: 'LOGISTICS', label: 'Douane en transport', plannedEur: 200, paidEur: 0, remainingEur: 200, forecastEur: 200, paymentCount: 0 })]);
  assert.equal(containerPaymentResultTotals(rows([partial])).netResultEur, 0);
  const total = containerPaymentResultTotals(rows([partial, mixed]));
  assert.equal(total.settledSavingsEur, 100);
  assert.equal(total.netResultEur, 100);
  assert.equal(total.internalMarkupEur, 500);
  assert.equal(total.markupWithResultEur, 600);
  assert.equal(total.provisionalCount, 2);
  assert.equal(total.finalizedCount, 0);
});

test('confirmed overrun and extra expenses offset savings; unsettled overpayment stays separately visible', () => {
  const value = purchase(1, [saved(),
    stream({ payee: 'LOGISTICS', plannedEur: 200, paidEur: 220, remainingEur: 0, forecastEur: 220,
      overpaidEur: 20, varianceEur: 20, explicitlySettled: true, finalized: true, status: 'OVERPAID' }),
    stream({ payee: 'SEPARATE', plannedEur: 50, paidEur: 80, remainingEur: 0, forecastEur: 80,
      overpaidEur: 30, varianceEur: 30, status: 'OVERPAID' }),
    stream({ payee: 'OTHER', plannedEur: 0, paidEur: 5, remainingEur: 0, forecastEur: 5,
      varianceEur: 5, finalized: true, status: 'ADDITIONAL' }),
  ]);
  const total = containerPaymentResultTotals(rows([value]));
  assert.equal(total.settledSavingsEur, 100);
  assert.equal(total.settledOverrunsEur, 20);
  assert.equal(total.additionalCostsEur, 5);
  assert.equal(total.unsettledOverrunsEur, 30);
  assert.equal(total.netResultEur, 75);
  assert.equal(total.markupWithResultEur, 325);
  assert.equal(total.provisionalCount, 1);
});

test('negative results retain their sign instead of becoming a positive savings pot', () => {
  const value = purchase(1, [saved(10), stream({ payee: 'OTHER', plannedEur: 0, paidEur: 25,
    remainingEur: 0, forecastEur: 25, varianceEur: 25, finalized: true, status: 'ADDITIONAL' })], true);
  const total = containerPaymentResultTotals(rows([value]));
  assert.equal(total.netResultEur, -15);
  assert.equal(total.markupWithResultEur, 235);
  assert.equal(total.finalizedCount, 1);
});

test('container search and reconciliation filters scope the aggregate before any summation', () => {
  const closed = purchase(1, [saved(100)], true); closed.order.alias = 'Rozen zomer';
  const open = purchase(2, [saved(40), stream({ payee: 'SEPARATE' })]); open.order.alias = 'Winter';
  const draft = purchase(3, [saved(900)], true); draft.order.status = 'CONCEPT';
  assert.equal(containerPaymentResultTotals(rows([closed, open, draft], 'active')).netResultEur, 140);
  assert.equal(containerPaymentResultTotals(rows([closed, open, draft], 'finalized')).netResultEur, 100);
  assert.equal(containerPaymentResultTotals(rows([closed, open, draft], 'open')).netResultEur, 40);
  assert.equal(containerPaymentResultTotals(rows([closed, open, draft], 'all', ' ROZEN ')).netResultEur, 100);
  const all = containerPaymentResultTotals(rows([closed, open, draft], 'all'));
  assert.equal(all.netResultEur, 140);
  assert.equal(all.internalMarkupEur, 500, 'Concept markup is excluded together with its payment result');
  assert.equal(all.excludedCount, 1);
});

test('missing reconciliation is unavailable and a duplicate container cannot double its result', () => {
  const original = purchase(1, [saved()], true);
  const projected = rows([original]);
  const total = containerPaymentResultTotals([...projected, ...projected, { view: { order: { id: 2 } }, paymentResult: null }]);
  assert.equal(total.netResultEur, 100);
  assert.equal(total.eligibleCount, 1);
  assert.equal(total.unavailableCount, 1);
  const noReport = purchase(2, []); delete noReport.reconciliation;
  assert.equal(purchasePaymentResult(noReport), null);
  assert.equal(rows([original, noReport]).length, 1, 'Existing missing-reconciliation warning owns excluded data');
});

test('summary discloses amounts without changing markup, cost forecast or accounting result', () => {
  const value = purchase(1, [saved()], true);
  const before = JSON.stringify(value);
  const baseRows = containerCostRows([value]);
  const oldCosts = containerCostTotals(baseRows);
  const accounting = resultAnalysis([], [value], [], { from: '2026-01-01', to: '2026-12-31' });
  containerPaymentResultTotals(rows([value]));
  assert.equal(JSON.stringify(value), before);
  assert.equal(value.order.extraRevenueEur, 250);
  assert.equal(purchaseExternalCost(value), 900);
  assert.deepEqual(containerCostTotals(baseRows), oldCosts);
  assert.deepEqual(resultAnalysis([], [value], [], { from: '2026-01-01', to: '2026-12-31' }), accounting);
  assert.equal(accounting.resultEur, 0, 'The disclosure is not booked again as realized profit');
  assert.equal(accounting.purchasedEur, 900);
});

test('aggregate cents remain exact for repeated small confirmed differences', () => {
  const total = containerPaymentResultTotals(rows([purchase(1, [saved(.1)], true), purchase(2, [saved(.2)], true)]));
  assert.equal(total.netResultEur, .3);
  assert.equal(total.markupWithResultEur, 500.3);
});
