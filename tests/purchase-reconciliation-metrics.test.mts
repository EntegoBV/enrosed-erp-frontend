import assert from 'node:assert/strict';
import test from 'node:test';
import type { PurchaseOrderView, PurchaseReconciliation, PurchaseReconciliationStream } from '../src/app/core/api/models.ts';
import { containerCostRows, containerCostTotals, purchaseExternalCost, reconciliationStatusLabel } from '../src/app/features/purchasing/purchase-reconciliation-metrics.ts';
import { resultAnalysis } from '../src/app/features/analyses/analysis-metrics.ts';

function stream(values: Partial<PurchaseReconciliationStream> = {}): PurchaseReconciliationStream {
  return { payee: 'SUPPLIER', label: 'Leverancier', status: 'PARTIAL', plannedEur: 1_000,
    paidEur: 300, remainingEur: 700, forecastEur: 1_000, varianceEur: 0, overpaidEur: 0,
    settledSavingEur: 0, explicitlySettled: false, finalized: false, paymentCount: 1, ...values };
}

function row(id: number, values: Partial<PurchaseReconciliation['totals']> = {}, streams = [stream()]): PurchaseOrderView {
  return {
    order: { id, number: `PO-2026-${id}`, alias: null, status: 'ONTVANGEN', orderDate: '2026-04-01', receivedOn: '2026-05-01' },
    costing: { totals: { totalEur: 1_200, totalWithSeparateCostsEur: 1_250, extraRevenueEur: 250 } },
    reconciliation: { streams, totals: { plannedExternalEur: 1_000, paidEur: 300, remainingEur: 700,
      forecastExternalEur: 1_000, varianceEur: 0, internalMarkupEur: 250, plannedPricingEur: 1_250,
      forecastPricingEur: 1_250, finalized: false, orderedQuantity: 100, receivedQuantity: 100,
      damagedQuantity: 5, usableQuantity: 95, unitCostQuantity: 95, unitCostBasis: 'USABLE_RECEIVED',
      forecastExternalUnitEur: 10.5263, forecastPricingUnitEur: 13.1579, receiptRecorded: true,
      legacyPaidTotalEur: null, ...values }, lines: [], notes: [] },
  } as PurchaseOrderView;
}

test('a partially paid container remains at forecast cost and never enters the cheaper filter', () => {
  const purchase = row(1);
  assert.equal(containerCostRows([purchase], 'lower').length, 0);
  assert.equal(containerCostRows([purchase], 'open').length, 1);
  const totals = containerCostTotals(containerCostRows([purchase]));
  assert.equal(totals.forecastEur, 1_000);
  assert.equal(totals.remainingEur, 700);
  assert.equal(totals.varianceEur, 0);
  assert.equal(totals.settledSavingEur, 0);
});

test('offsetting supplier, customs and extra payments retain gross differences', () => {
  const purchase = row(1, { paidEur: 1_045, remainingEur: 0, forecastExternalEur: 1_045, varianceEur: 45, finalized: true }, [
    stream({ plannedEur: 800, paidEur: 900, remainingEur: 0, forecastEur: 900, varianceEur: 100, overpaidEur: 100, finalized: true, explicitlySettled: true, status: 'OVERPAID' }),
    stream({ payee: 'LOGISTICS', plannedEur: 200, paidEur: 120, remainingEur: 0, forecastEur: 120, varianceEur: -80, settledSavingEur: 80, finalized: true, explicitlySettled: true, status: 'SETTLED_LOWER' }),
    stream({ payee: 'OTHER', plannedEur: 0, paidEur: 25, remainingEur: 0, forecastEur: 25, varianceEur: 25, finalized: true, status: 'ADDITIONAL' }),
  ]);
  const totals = containerCostTotals(containerCostRows([purchase]));
  assert.equal(totals.overpaidEur, 100);
  assert.equal(totals.settledSavingEur, 80);
  assert.equal(totals.additionalEur, 25);
  assert.equal(totals.varianceEur, 45);
  assert.equal(totals.finalizedCount, 1);
  assert.equal(containerCostRows([purchase], 'higher').length, 1);
});

test('overpayment status does not suggest final agreement until the stream is settled', () => {
  assert.equal(reconciliationStatusLabel(stream({ status: 'OVERPAID' })), 'Meer betaald · te beoordelen');
  assert.equal(reconciliationStatusLabel(stream({ status: 'OVERPAID', finalized: true })), 'Meer betaald · vereffend');
  assert.equal(reconciliationStatusLabel(stream({ status: 'SETTLED_LOWER' })), 'Minder betaald · vereffend');
});

test('unavailable calculations are omitted and concept containers only enter the all filter', () => {
  const draft = row(1); draft.order.status = 'CONCEPT';
  const missing = row(2); delete missing.reconciliation;
  const lower = row(3, { forecastExternalEur: 980, varianceEur: -20, finalized: true });
  lower.order.alias = 'Rozen zomer';
  assert.deepEqual(containerCostRows([draft, missing, lower]).map((row) => row.view.order.id), [3]);
  assert.deepEqual(containerCostRows([draft, missing, lower], 'all').map((row) => row.view.order.id), [3, 1]);
  assert.equal(containerCostRows([lower], 'lower', ' ROZEN ').length, 1);
  assert.equal(containerCostRows([lower], 'open').length, 0);
  assert.equal(containerCostRows([lower], 'finalized', 'PO-2026').length, 1);
});

test('external container cost uses the saved reconciliation and never includes internal markup', () => {
  const purchase = row(1, { forecastExternalEur: 1_060 });
  assert.equal(purchaseExternalCost(purchase), 1_060);
  delete purchase.reconciliation;
  assert.equal(purchaseExternalCost(purchase), 1_000);
});

test('result overview values received containers from reconciliation without expensing them twice', () => {
  const purchase = row(1, { forecastExternalEur: 1_060 });
  const result = resultAnalysis([], [purchase], [], { from: '2026-01-01', to: '2026-12-31' });
  assert.equal(result.purchasedEur, 1_060);
  assert.equal(result.receivedContainers, 1);
  assert.equal(result.costsEur, 0);
  assert.equal(result.resultEur, 0);
  delete purchase.reconciliation;
  assert.equal(resultAnalysis([], [purchase], [], { from: '2026-01-01', to: '2026-12-31' }).purchasedEur, 1_000);
});

test('presentation aggregates preserve cents instead of exposing floating point artifacts', () => {
  const rows = containerCostRows([row(1, { paidEur: 0.1 }), row(2, { paidEur: 0.2 })]);
  assert.equal(containerCostTotals(rows).paidEur, 0.3);
});
