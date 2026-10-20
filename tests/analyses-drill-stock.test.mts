import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExpectedStock, Product, PurchaseOrderView, SalesOrderView } from '../src/app/core/api/models.ts';
import { inventoryAnalysis, lastSoldOn } from '../src/app/features/analyses/analysis-metrics.ts';
import { columnSum, drillGap, drillTable } from '../src/app/features/analyses/drill-table.ts';
import { incomingView, orderByDay, qualityViews, QUALITY_KEYS, reorderView, stockValueView, zeroNoIncomingView } from '../src/app/features/analyses/drill-stock.ts';
import { purchaseExternalCost } from '../src/app/features/purchasing/purchase-reconciliation-metrics.ts';

/*
 * Voorraad's drill-downs and the Overzicht row that reads the stock (design/analyses2/design.md §B.2, §B.5): the rows
 * of a view match the figure inventoryAnalysis gives its row (rule A.4).
 */

function product(id: number, stock: number, extra: Partial<Product> = {}): Product {
  return { id, sku: `SKU-${id}`, name: `Product ${id}`, colour: id === 1 ? 'Rood' : null, inventoryKnown: true, stockQuantity: stock, active: true, demo: false,
    carton: { piecesPerCarton: 6 }, landedCostEur: 2, computedSalesPriceEur: 5, ...extra } as Product;
}

function invoice(id: number, date: string, productIds: number[], extra: Partial<SalesOrderView['order']> = {}): SalesOrderView {
  return { order: { id, number: `INV-${id}`, docType: 'FACTUUR', status: 'VERZONDEN', orderDate: date, ...extra },
    priced: { lines: productIds.map((productId) => ({ productId, quantity: 1, net: 1 })), totals: { total: 1 }, validation: { productsWithoutCost: [] } } } as unknown as SalesOrderView;
}

test('lastSoldOn: the last regular issued invoice per product; concepts and partner voorschotten do not count', () => {
  const sales = [invoice(1, '2026-03-01', [1, 2]), invoice(2, '2026-05-01', [1]), invoice(3, '2026-09-01', [2], { status: 'CONCEPT' }),
    invoice(4, '2026-09-02', [3], { purpose: 'PARTNER_ADVANCE', partnerPurchaseOrderId: 7 })];
  assert.deepEqual([...lastSoldOn(sales)].sort(), [[1, '2026-05-01'], [2, '2026-03-01']]);
});

test('Aandacht › zonder voorraad én inkoop: the count of zeroStock, the last sold first, never sold last', () => {
  const products = [product(1, 0), product(2, 0), product(3, 0), product(4, 0), product(5, 4), product(6, 0, { active: false })];
  const expected: ExpectedStock[] = [{ productId: 4, quantity: 12, expectedArrival: '2026-11-01', orderIds: [9], orderNumbers: ['PO-9'] }];
  const zero = inventoryAnalysis(products, expected).zeroStock;
  const lastSold = new Map([[1, '2026-02-01'], [2, '2026-08-01']]);
  const view = zeroNoIncomingView(zero.rows, lastSold, zero.withoutIncomingCount);
  assert.equal(zero.withoutIncomingCount, 3);
  assert.equal(view.rows.length, view.total?.value, 'the rows are the count (no gap)');
  assert.equal(view.total?.of, 'rows');
  assert.deepEqual(view.rows.map((row) => row.key), ['p1', 'p2', 'p3'], 'the product with something on order is not listed');
  assert.equal(view.rows[0].cells['product'], 'Product 1 · Rood');
  assert.deepEqual(view.sort, { key: 'lastSold', dir: 'desc' });
  assert.deepEqual(view.rows[1].link, { path: ['/products', 2] });
  assert.deepEqual(view.foot?.link, { path: ['/analyses', 'inventory'] });
  assert.equal(columnSum(view.rows, 'lastSold'), 0, 'days are never summed');
});

/* ---------- WP1b: Kostwaarde, Verkoopwaarde, Onderweg, Raakt op, Datakwaliteit (§B.5) */

const unit = (productId: number, count: number) => `${count} st van ${productId}`;
const products = [
  product(1, 10, { landedCostEur: 3, computedSalesPriceEur: 8 }),
  product(2, 4, { landedCostEur: null }),
  product(3, 6, { active: false, landedCostEur: 5 }),
  product(4, 2, { demo: true, landedCostEur: 1 }),
  product(5, 3, { inventoryKnown: false }),
  product(6, 1, { inventoryKnown: null, active: false }),
  product(7, -2, { carton: null }),
  product(8, 5, { carton: { piecesPerCarton: null } as unknown as Product['carton'], demo: true }),
  product(9, 12, { landedCostEur: 2 }),
];

test('inventoryAnalysis keeps every row (D-V2): reorder and slow movers in full, capital beside topCapital', () => {
  const sales = [invoice(11, '2026-09-20', [1, 9]), invoice(12, '2026-09-25', [1])];
  const many = Array.from({ length: 14 }, (_, index) => product(100 + index, 1, { landedCostEur: 1 + index }));
  const result = inventoryAnalysis([...products, ...many], [], { topLimit: 3, sales, today: '2026-10-20' });
  assert.equal(result.reorder.rows.length, result.reorder.count);
  assert.equal(result.slowMovers.rows.length, result.slowMovers.count);
  assert.ok(result.slowMovers.count > 3, 'more than the top limit, every one listed');
  assert.equal(result.topCapital.length, 3);
  assert.deepEqual(result.topCapital, result.capital.slice(0, 3));
  const capital = result.capital.reduce((sum, row) => sum + row.costValueEur, 0);
  assert.ok(Math.abs(capital - result.stock.costValueEur) < 0.005, 'capital Σ = costValueEur');
  assert.equal(inventoryAnalysis(products, [], { sales: undefined }).slowMovers.count, 0, 'an unknown pace never lists every product as slow (D-V4)');
});

test('Kostwaarde / Verkoopwaarde: valued products plus a "Zonder kostprijs" group; both columns add up to their tiles', () => {
  const result = inventoryAnalysis(products, []);
  const figure = { costValueEur: result.stock.costValueEur, salesValueEur: result.stock.salesValueEur, upliftEur: result.stock.potentialUpliftEur };
  const view = stockValueView(result.capital, result.gapRows.unvalued, figure, 'cost', unit, (value) => `€ ${value}`);
  assert.equal(drillGap(view)?.show, false);
  assert.ok(Math.abs(columnSum(view.rows, 'cost') - result.stock.costValueEur) < 0.005);
  assert.ok(Math.abs(columnSum(view.rows, 'sales') - result.stock.salesValueEur) < 0.005, 'Verkoopwaarde column Σ = salesValueEur');
  assert.equal(drillTable(view).total?.sums['sales'], Math.round(result.stock.salesValueEur * 100) / 100);
  assert.deepEqual(drillTable(view).sections.map((section) => section.key), ['', 'unvalued']);
  assert.deepEqual(view.rows.filter((row) => row.group === 'unvalued').map((row) => [row.key, row.cells['cost']]), [['u2', null]], 'known stock without a cost');
  assert.equal(view.rows.find((row) => row.key === 'p3')?.cells['sales'], null, 'an inactive product has no Verkoopwaarde');
  assert.equal(view.rows.find((row) => row.key === 'p4')?.cells['sales'], null, 'nor a demo piece');
  assert.equal(view.summary, 'kostdekking onvolledig', 'a saleable product without a cost');
  assert.deepEqual(stockValueView(result.capital, [], { ...figure, upliftEur: 12 }, 'sales', unit, (value) => `€ ${value}`).sort, { key: 'sales', dir: 'desc' });
  assert.equal(stockValueView(result.capital, [], { ...figure, upliftEur: 12 }, 'sales', unit, (value) => `€ ${value}`).summary, 'marge op voorraad € 12');
  assert.deepEqual(view.foot?.link, { path: ['/stock', 'inventaris'] });
});

test('Onderweg: the ordered and sailing containers add up to their external cost; without an ETA last', () => {
  const po = (id: number, status: 'BESTELD' | 'ONDERWEG', eta: string | null, forecast: number | null) => ({
    order: { id, number: `PO-${id}`, alias: null, status, supplierId: 3, expectedArrival: eta, lines: [{ productId: 1 }, { productId: 2 }, { productId: 1 }] },
    costing: { totals: { totalEur: 1000, totalWithSeparateCostsEur: 1200, extraRevenueEur: 100 } },
    reconciliation: forecast === null ? null : { totals: { forecastExternalEur: forecast } } }) as unknown as PurchaseOrderView;
  const orders = [po(1, 'BESTELD', null, 5000), po(2, 'ONDERWEG', '2026-11-02', null), po(3, 'ONDERWEG', '2026-10-28', 2500)];
  const figure = orders.reduce((sum, row) => sum + purchaseExternalCost(row), 0);
  const view = incomingView(orders, figure, { container: (row) => row.order.number, supplier: () => 'Yunnan', cost: purchaseExternalCost }, '1 besteld · 2 vertrokken');
  assert.equal(figure, 8600);
  assert.equal(drillGap(view)?.show, false);
  assert.deepEqual(drillTable(view).sections[0].rows.map((row) => row.key), ['o3', 'o2', 'o1'], 'first ETA first, zonder ETA last');
  assert.deepEqual(view.rows.map((row) => [row.cells['status'], row.cells['products']]), [['Besteld', 2], ['Onderweg', 2], ['Onderweg', 2]]);
  assert.equal(view.rows[0].cells['eta'], 'zonder ETA');
  assert.deepEqual(view.rows[0].link, { path: ['/purchasing', 1] });
});

test('Raakt op: every row, "Bestel vóór" = today + the shelf weeks − the lead time; without a lead time none', () => {
  assert.equal(orderByDay('2026-10-20', 2, 10), '2026-10-24');
  assert.equal(orderByDay('2026-10-20', 1, 30), '2026-09-27', 'already past: order now');
  assert.equal(orderByDay('2026-10-20', 3, 0), null);
  assert.equal(orderByDay('2026-10-20', null, 10), null);
  const sales = [invoice(21, '2026-10-01', [1, 1, 1, 9]), invoice(22, '2026-10-10', [1, 1])];
  const expected: ExpectedStock[] = [{ productId: 1, quantity: 1, expectedArrival: '2026-11-15', orderIds: [5], orderNumbers: ['PO-5'] }];
  const shelf = [product(1, 2, { supplierId: 3 }), product(9, 0, { supplierId: 4 })];
  const result = inventoryAnalysis(shelf, expected, { sales, today: '2026-10-20' });
  assert.equal(result.reorder.count, 2);
  assert.equal(result.reorder.rows.find((row) => row.productId === 1)?.nextArrival, '2026-11-15');
  const suppliers = new Map([[3, { name: 'Yunnan', leadTimeDays: 35 }], [4, { name: 'Ningbo', leadTimeDays: 0 }]]);
  const view = reorderView(result.reorder.rows, result.reorder.count, '2026-10-20', (id) => suppliers.get(id ?? 0) ?? null, unit, 90);
  assert.equal(drillGap(view)?.show, false, 'the rows are the count');
  assert.equal(view.summary, 'tempo over 90 dagen, zonder TICA');
  const one = view.rows.find((row) => row.key === 'p1')!;
  assert.deepEqual([one.cells['supplier'], one.cells['lead'], one.cells['incoming'], one.cells['eta']], ['Yunnan', 35, '1 st van 1', '2026-11-15']);
  assert.equal(one.tone, 'danger', 'the order day has passed');
  assert.equal(view.rows.find((row) => row.key === 'p9')?.cells['orderBy'], null, 'no lead time: no order day');
  assert.deepEqual(view.sort, { key: 'orderBy', dir: 'asc' });
});

test('Datakwaliteit: each count is its list (D-V5: an inactive or demo product is never "onbekend")', () => {
  const result = inventoryAnalysis(products, []);
  const gaps = result.dataGaps;
  assert.deepEqual([gaps.unknownStockSkuCount, gaps.unvaluedStockSkuCount, gaps.missingCartonSkuCount, gaps.negativeStockSkuCount], [1, 1, 1, 1]);
  assert.deepEqual(result.gapRows.unknown.map((row) => row.productId), [5], 'product 6 is inactive');
  assert.deepEqual(result.gapRows.missingCarton.map((row) => row.productId), [7], 'product 8 is a demo piece');
  const counts = { unknown: gaps.unknownStockSkuCount, unvalued: gaps.unvaluedStockSkuCount, missingCarton: gaps.missingCartonSkuCount, negative: gaps.negativeStockSkuCount };
  const views = qualityViews(result.gapRows, counts, unit);
  assert.deepEqual(views.map((view) => view.tab), ['Onbekend', 'Zonder kostprijs', 'Zonder omdoos', 'Negatief']);
  for (const view of views) assert.equal(drillGap(view)?.show, false, `${view.id}: the rows are the count`);
  assert.equal(views[0].rows[0].cells['units'], 'onbekend');
  assert.equal(views[3].rows[0].cells['units'], '-2 st van 7');
  assert.deepEqual(views[0].rows[0].link, { path: ['/products', 5] });
  assert.deepEqual(QUALITY_KEYS, ['unknown', 'unvalued', 'missingCarton', 'negative']);
});

test('Nulvoorraad with lastSold: nothing on order first, then the last sold, never sold last, then by name', () => {
  const shelf = [product(1, 0), product(2, 0), product(3, 0), product(4, 0)];
  const expected: ExpectedStock[] = [{ productId: 2, quantity: 6, expectedArrival: null, orderIds: [1], orderNumbers: ['PO-1'] }];
  const zero = inventoryAnalysis(shelf, expected, { lastSold: new Map([[3, '2026-09-01'], [4, '2026-10-01'], [2, '2026-10-15']]) }).zeroStock;
  assert.deepEqual(zero.rows.map((row) => row.productId), [4, 3, 1, 2]);
});
