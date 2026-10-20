import assert from 'node:assert/strict';
import test from 'node:test';
import type { PartnerFinancing, PurchaseOrderView, ReceiptVarianceRow } from '../src/app/core/api/models.ts';
import { partnerFinancingAnalysis } from '../src/app/features/analyses/analysis-metrics.ts';
import { columnSum, drillGap } from '../src/app/features/analyses/drill-table.ts';
import { partnersAwaitingView, partnersUnbilledView, varianceGroups, varianceOrdersView } from '../src/app/features/analyses/drill-purchase.ts';

/*
 * Inkoop's drill-downs and the Overzicht rows that read them (design/analyses2/design.md §B.2, §B.6): the rows add up
 * to the figure of the row that opens them (rule A.4).
 */

function line(orderId: number, received: string, extra: Partial<ReceiptVarianceRow> = {}): ReceiptVarianceRow {
  return { orderId, orderNumber: `PO-${orderId}`, orderAlias: null, receivedOn: received, expectedArrival: null, supplierId: 1, supplierName: 'Yunnan',
    lineId: orderId * 10, productId: 1, productSku: 'R', productName: 'Roos', orderedPieces: 100, receivedPieces: 95, missingPieces: 5, overReceivedPieces: 0,
    damagedPieces: 0, usablePieces: 95, receiptUnitValueEur: 2, missingValueEur: 10, damagedValueEur: 0, totalLossValueEur: 10, valuationComplete: true, ...extra };
}

test('varianceGroups: one group per order, the last received first, the unvalued pieces counted apart', () => {
  const rows = [line(1, '2026-03-01'), line(2, '2026-06-01', { damagedPieces: 3, totalLossValueEur: null, valuationComplete: false }), line(1, '2026-03-01', { productId: 2, totalLossValueEur: 4 })];
  const groups = varianceGroups(rows);
  assert.deepEqual(groups.map((group) => [group.orderId, group.missingPieces, group.damagedPieces, group.totalLossValueEur, group.unvaluedLossPieces]),
    [[2, 5, 3, 0, 8], [1, 10, 0, 14, 0]]);
});

test('Aandacht › Ontvangstafwijkingen: the orders add up to the report\'s known impact; each opens its card on Afwijkingen', () => {
  const rows = [line(1, '2026-03-01'), line(2, '2026-06-01', { damagedPieces: 3, totalLossValueEur: null, valuationComplete: false }), line(1, '2026-03-01', { productId: 2, totalLossValueEur: 4 })];
  const view = varianceOrdersView(varianceGroups(rows), 14, 8, 'Dit jaar · op ontvangstdatum', (group) => `Container ${group.orderId}`);
  assert.equal(drillGap(view)?.show, false);
  assert.equal(columnSum(view.rows, 'impact'), 14);
  assert.equal(view.summary, '+ 8 zonder waarde');
  assert.deepEqual(view.rows[0].link, { path: ['/analyses', 'purchasing'], query: { deel: 'afwijkingen', orderId: 2 } });
  assert.equal(view.rows[0].cells['name'], 'Container 2');
  assert.equal(varianceOrdersView([], 0, 0, '', String).summary, null);
});

const purchase = (id: number, status: 'ONTVANGEN' | 'ONDERWEG', receivedOn: string | null) => ({ order: { id, number: `PO-${id}`, status, partnerCustomerId: 7, receivedOn },
  costing: { totals: { totalEur: 3000 } }, reconciliation: { totals: { forecastExternalEur: 3000, paidEur: 3000 } } }) as unknown as PurchaseOrderView;

test('Aandacht › partnercontainers: af te rekenen is the awaiting count; voorschottermijnen add up to unbilledAdvanceEur in the analysis\' order', () => {
  const purchases = [purchase(1, 'ONTVANGEN', '2026-05-01'), purchase(2, 'ONTVANGEN', '2026-03-01'), purchase(3, 'ONDERWEG', null)];
  const summaries = [
    { purchaseOrderId: 1, partnerName: 'Partner', unbilledAdvanceEur: 4200, unbilledAdvanceCount: 1, overdueUnbilledAdvanceEur: 0, nextAdvanceDueDate: '2026-11-01', remainingQuantity: 40, documents: [] },
    { purchaseOrderId: 2, partnerName: 'Partner', unbilledAdvanceEur: 1800, unbilledAdvanceCount: 2, overdueUnbilledAdvanceEur: 1800, nextAdvanceDueDate: '2026-09-08', remainingQuantity: 10, documents: [] },
    { purchaseOrderId: 3, partnerName: 'Partner', unbilledAdvanceEur: 0, unbilledAdvanceCount: 0, documents: [] },
  ] as unknown as PartnerFinancing[];
  const financing = partnerFinancingAnalysis(purchases, [], [], summaries);
  const name = (row: { number: string }) => row.number;
  const received = new Map(purchases.map((row) => [row.order.id, row.order.receivedOn ?? null]));
  const awaiting = partnersAwaitingView(financing.rows, received, financing.awaitingSettlement, name);
  assert.equal(financing.awaitingSettlement, 2);
  assert.equal(drillGap(awaiting)?.show, false, 'the rows are the count');
  assert.deepEqual(awaiting.sort, { key: 'received', dir: 'asc' }, 'the longest waiting first');
  assert.deepEqual(awaiting.rows.map((row) => row.cells['remaining']).sort(), [10, 40]);
  assert.deepEqual(awaiting.rows[0].link, { path: ['/purchasing', 2], query: { section: 'payments' } });
  const unbilled = partnersUnbilledView(financing.unbilledAdvances, financing.unbilledAdvanceEur, name);
  assert.equal(drillGap(unbilled)?.show, false);
  assert.equal(columnSum(unbilled.rows, 'amount'), 6000);
  assert.deepEqual(unbilled.rows.map((row) => [row.key, row.tone]), [['o2', 'danger'], ['o1', null]], 'overdue first, as the analysis orders them');
  assert.deepEqual(unbilled.sort, { key: 'rank', dir: 'asc' });
});
