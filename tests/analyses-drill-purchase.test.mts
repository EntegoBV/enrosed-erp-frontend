import assert from 'node:assert/strict';
import test from 'node:test';
import type { PartnerFinancing, PurchaseOrderView, ReceiptVarianceRow } from '../src/app/core/api/models.ts';
import { partnerFinancingAnalysis } from '../src/app/features/analyses/analysis-metrics.ts';
import { columnSum, drillGap, drillTable } from '../src/app/features/analyses/drill-table.ts';
import {
  impactViews, partnersAwaitingView, partnersOpenView, partnersUnbilledView, receiptsView, supplierView, varianceGroups, varianceOrdersView,
} from '../src/app/features/analyses/drill-purchase.ts';
import type { ReceivedOrderRow } from '../src/app/features/analyses/drill-purchase.ts';
import { receiptOrderRows, supplierReceiptPerformance, supplierScorecards } from '../src/app/features/analyses/receipt-metrics.ts';

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

/* ---------- WP1b: Kwaliteit, Partners › Nog te ontvangen, Afwijkingen › Inkoopimpact (§B.6) */

const order = (id: number, received: string | null, eta: string | null, lines: { quantity: number; orderedQuantity?: number | null; damagedQuantity?: number | null }[], orderDate = '2026-01-10') =>
  ({ id, orderDate, receivedOn: received, expectedArrival: eta, lines });
const orders = [
  order(1, '2026-03-01', '2026-03-05', [{ quantity: 100, orderedQuantity: 100 }]),
  order(2, '2026-04-10', '2026-04-01', [{ quantity: 95, orderedQuantity: 100 }, { quantity: 50, orderedQuantity: 50, damagedQuantity: 2 }]),
  order(3, '2026-05-01', null, [{ quantity: 10, orderedQuantity: null }]),
  order(4, '2026-06-01', '2026-06-01', [{ quantity: 12, orderedQuantity: 10 }], '2026-04-01'),
];

test('receiptOrderRows: the per-order tests are the ones supplierReceiptPerformance counts', () => {
  const rows = receiptOrderRows(orders);
  const performance = supplierReceiptPerformance(orders);
  assert.equal(rows.filter((row) => row.perfect !== null).length, performance.comparableOrders);
  assert.equal(rows.filter((row) => row.perfect === true).length, performance.perfectOrders);
  assert.equal(rows.filter((row) => row.lateDays !== null).length, performance.datedOrders);
  assert.equal(rows.filter((row) => row.lateDays === 0).length, performance.onTimeOrders);
  assert.equal(rows.length, performance.receivedOrders);
  assert.deepEqual(rows.map((row) => [row.id, row.perfect, row.lateDays, row.leadDays]),
    [[1, true, 0, 50], [2, false, 9, 90], [3, null, null, 111], [4, false, 0, 61]], 'an over-receipt is not perfect; no ETA, no on-time test');
  assert.deepEqual([rows[1].ordered, rows[1].missing, rows[1].damaged, rows[1].usable], [150, 5, 2, 143]);
});

test('Perfect ontvangen, Op tijd, Doorlooptijd: the received orders, ordered for the figure; shortages open Afwijkingen', () => {
  const named: ReceivedOrderRow[] = receiptOrderRows(orders).map((row) => ({ ...row, name: `Container ${row.id}`, supplierId: row.id < 3 ? 1 : 2,
    supplierName: row.id < 3 ? 'Yunnan' : 'Ningbo', agreedDays: row.id < 3 ? 35 : null }));
  const performance = supplierReceiptPerformance(orders);
  const scope = 'Dit jaar · op ontvangstdatum';
  const perfect = receiptsView('perfect', named, performance, { averageDays: 78, agreedDays: 35 }, scope);
  assert.equal(drillGap(perfect)?.show, false, 'the rows are the received orders');
  assert.equal(perfect.summary, '1 van 3 perfect · 33,3 %');
  assert.deepEqual(drillTable(perfect).sections[0].rows.map((row) => row.key), ['o4', 'o2', 'o3', 'o1'], 'not perfect first, then no snapshot, each by the last receipt');
  assert.deepEqual(perfect.rows.map((row) => row.cells['receipt']), ['perfect', '5 ontbreekt · 2 beschadigd', 'geen bestelsnapshot', 'meer ontvangen']);
  assert.deepEqual(perfect.rows[1].link, { path: ['/analyses', 'purchasing'], query: { deel: 'afwijkingen', orderId: 2 } });
  assert.deepEqual(perfect.rows[0].link, { path: ['/purchasing', 1] });
  const onTime = receiptsView('ontime', named, performance, { averageDays: 78, agreedDays: 35 }, scope);
  assert.equal(onTime.summary, '2 van 3 op tijd · tegen de laatste ETA');
  assert.deepEqual(drillTable(onTime).sections[0].rows.map((row) => row.key), ['o2', 'o3', 'o4', 'o1'], 'late first, then no ETA');
  assert.deepEqual(onTime.rows.map((row) => row.cells['onTime']), ['op tijd', '9 d te laat', null, 'op tijd']);
  assert.equal(onTime.columns.find((column) => column.key === 'onTime')?.phone, 'value');
  const lead = receiptsView('lead', named, performance, { averageDays: 78, agreedDays: 35 }, scope);
  assert.equal(lead.summary, 'gem. 78 dagen · afgesproken 35');
  assert.deepEqual(lead.sort, { key: 'lead', dir: 'desc' });
  assert.equal(receiptsView('lead', [], supplierReceiptPerformance([]), { averageDays: null, agreedDays: null }, scope).summary, 'nog geen doorlooptijd');
});

test('Scorekaart › leverancier (D-V1): its orders, the supplier list opens from the foot, never /suppliers/:id', () => {
  const named: ReceivedOrderRow[] = receiptOrderRows(orders).map((row) => ({ ...row, name: `Container ${row.id}`, supplierId: row.id < 3 ? 1 : 2,
    supplierName: row.id < 3 ? 'Yunnan' : 'Ningbo', agreedDays: null }));
  const [card] = supplierScorecards(orders.map((row) => ({ ...row, supplierId: row.id < 3 ? 1 : 2, supplierName: row.id < 3 ? 'Yunnan' : 'Ningbo', totalEur: 1000 })))
    .filter((row) => row.supplierId === 1);
  const view = supplierView(card, named, 'Dit jaar', (value) => `€ ${value}`);
  assert.equal(drillGap(view)?.show, false);
  assert.deepEqual(view.rows.map((row) => row.key), ['o1', 'o2']);
  assert.equal(view.summary, '2 orders · externe kost € 2000 · perfect 50 %');
  assert.deepEqual(view.foot?.link, { path: ['/suppliers'], query: { q: 'Yunnan' } });
});

test('Partners › Nog te ontvangen: the containers with something open add up to openEur', () => {
  const purchases = [purchase(1, 'ONTVANGEN', '2026-05-01'), purchase(2, 'ONTVANGEN', '2026-03-01')];
  const summaries = [{ purchaseOrderId: 1, partnerName: 'Partner', totalOpenEur: 1210, documents: [] }, { purchaseOrderId: 2, partnerName: 'Partner', totalOpenEur: 0, documents: [] }] as unknown as PartnerFinancing[];
  const financing = partnerFinancingAnalysis(purchases, [], [], summaries);
  const view = partnersOpenView(financing.rows, financing.openEur, (row) => row.number);
  assert.equal(financing.openEur, 1210);
  assert.equal(drillGap(view)?.show, false);
  assert.deepEqual(view.rows.map((row) => row.key), ['o1']);
  assert.deepEqual(view.rows[0].link, { path: ['/purchasing', 1], query: { section: 'payments' } });
});

test('Inkoopimpact: per product and per supplier the lines add up to the known impact; unvalued pieces in the summary', () => {
  const rows = [line(1, '2026-03-01'), line(2, '2026-06-01', { productId: 2, productSku: 'B', damagedPieces: 3, totalLossValueEur: null, valuationComplete: false }),
    line(3, '2026-07-01', { supplierId: 2, supplierName: 'Ningbo', totalLossValueEur: 6 }),
    line(4, '2026-07-02', { productId: 3, missingPieces: 0, damagedPieces: 0, overReceivedPieces: 4, totalLossValueEur: 0 })];
  const [perProduct, perSupplier] = impactViews(rows, { totalLossValueEur: 16, unvaluedLossPieces: 8 }, 'Dit jaar', (row) => row.productName);
  for (const view of [perProduct, perSupplier]) assert.equal(drillGap(view)?.show, false, `${view.id} adds up`);
  assert.deepEqual(perProduct.rows.map((row) => [row.key, row.cells['orders'], row.cells['missing'], row.cells['damaged'], row.cells['impact']]),
    [['p1', 2, 10, 0, 16], ['p2', 1, 5, 3, 0]], 'an over-receipt alone is no impact row');
  assert.deepEqual(perSupplier.rows.map((row) => [row.cells['supplier'], row.cells['impact']]), [['Yunnan', 10], ['Ningbo', 6]]);
  assert.equal(perProduct.summary, '+ 8 zonder waarde');
  assert.deepEqual(perProduct.rows[0].link, { path: ['/products', 1] });
  assert.equal(perSupplier.rows[0].link, undefined, 'a supplier has no screen of its own here');
});

test('empty states, and the scorecard no longer links /suppliers/:id (source, D-V1)', async () => {
  assert.equal(impactViews([], { totalLossValueEur: 0, unvaluedLossPieces: 0 }, '', String)[0].empty, 'Geen tekorten of schade in deze selectie.');
  assert.equal(partnersOpenView([], 0, String).empty, 'Niets meer te ontvangen van partners.');
  const { readFile } = await import('node:fs/promises');
  const page = await readFile(new URL('../src/app/features/analyses/analyses-page.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /\['\/suppliers', card\.supplierId\]/);
  assert.match(page, /\(click\)="openSupplier\(card\)"/);
  assert.doesNotMatch(page, /Open order ›/, 'the order name is the link');
  assert.doesNotMatch(page, /tellen pas mee zodra hun ontvangstwaarde/, 'the valuation banner went: the Zonder waarde tile says it');
});
