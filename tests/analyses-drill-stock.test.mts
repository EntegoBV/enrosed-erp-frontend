import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExpectedStock, Product, SalesOrderView } from '../src/app/core/api/models.ts';
import { inventoryAnalysis, lastSoldOn } from '../src/app/features/analyses/analysis-metrics.ts';
import { columnSum } from '../src/app/features/analyses/drill-table.ts';
import { zeroNoIncomingView } from '../src/app/features/analyses/drill-stock.ts';

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
