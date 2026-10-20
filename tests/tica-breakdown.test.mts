import assert from 'node:assert/strict';
import test from 'node:test';
import { ticaBreakdown, ticaLineRange } from '../src/app/features/analyses/tica-breakdown.ts';
import type { TicaAnalyticsDay, TicaSale } from '../src/app/core/api/tica-api.ts';

let nextId = 1;
const sale = (patch: Partial<TicaSale>): TicaSale => ({
  id: nextId++, location: 'TICA - Brussel', exhibitor: '2132', soldAt: '2026-10-20T14:05:00', transactionNumber: '100', lineNumber: '1',
  description: 'Rose box rood', beeyondArticleNumber: 'B-1', sku: 'RB-RED', barcode: null, quantity: 1, discountPercent: 0,
  grossTotal: 20, netTotal: 20, vatRate: 21, transactionType: 'SALE', productId: 7, mappingStatus: 'MATCHED',
  firstSeenAt: '2026-10-20T12:10:00Z', updatedAt: '2026-10-20T12:10:00Z', ...patch,
});
const day = (date: string, revenueExcl = 10, transactionCount = 1): TicaAnalyticsDay =>
  ({ date, revenueExcl, transactionCount, quantity: 1, goodsCostEur: 0, missingCostLines: 0 });

test('the line range: none without TICA sales, the first TICA day for Alle, at most 366 days', () => {
  const days = [day('2025-03-02'), day('2026-10-19')];
  assert.equal(ticaLineRange('2026-10-01', '2026-10-18', days, '2026-10-20'), null);
  assert.deepEqual(ticaLineRange('2026-10-01', '2026-10-20', days, '2026-10-20'), { from: '2026-10-01', to: '2026-10-20' });
  assert.deepEqual(ticaLineRange('', '', [day('2026-09-21'), day('2026-10-19')], '2026-10-20'), { from: '2026-09-21', to: '2026-10-20' });
  assert.deepEqual(ticaLineRange('', '', days, '2026-10-20'), { from: '2025-10-20', to: '2026-10-20' });
  assert.deepEqual(ticaLineRange('2025-01-01', '2025-12-31', days, '2026-10-20'), { from: '2025-01-01', to: '2025-12-31' });
  assert.equal(ticaLineRange('2026-10-01', '2026-10-20', [day('2026-10-05', 0, 0)], '2026-10-20'), null);
});

test('figures come from the server sums: averages per piece and per sale, the discount, unmatched lines', () => {
  const result = ticaBreakdown({ transactionCount: 4, quantity: 10, grossTotal: 330, netTotal: 300, unmatchedLineCount: 2 }, [], true);
  assert.equal(result.perPieceEur, 30);
  assert.equal(result.perSaleEur, 75);
  assert.equal(result.discountEur, 30);
  assert.equal(result.unmatchedLines, 2);
  const none = ticaBreakdown({ transactionCount: 0, quantity: 0, grossTotal: 0, netTotal: 0, unmatchedLineCount: 0 }, [], true);
  assert.equal(none.perPieceEur, null);
  assert.equal(none.perSaleEur, null);
});

test('products: an ERP product by its id, an unknown article by its code, best seller first, the newest name', () => {
  const lines = [
    sale({ productId: 7, description: 'Rose box (oud)', soldAt: '2026-10-01T10:00:00', quantity: 2, netTotal: 40, transactionNumber: '1' }),
    sale({ productId: 7, description: 'Rose box rood', soldAt: '2026-10-19T10:00:00', quantity: 1, netTotal: 19.99, transactionNumber: '2' }),
    sale({ productId: null, mappingStatus: 'UNMATCHED', sku: 'X-9', description: 'Vaas', quantity: 3, netTotal: 75, transactionNumber: '2' }),
    sale({ productId: null, mappingStatus: 'UNMATCHED', sku: 'x-9 ', description: 'Vaas', quantity: 1, netTotal: 25, transactionNumber: '3' }),
  ];
  const result = ticaBreakdown({ transactionCount: 3, quantity: 7, grossTotal: 159.99, netTotal: 159.99, unmatchedLineCount: 2 }, lines, true);
  assert.deepEqual(result.products.map((row) => [row.name, row.productId, row.pieces, row.netEur, row.perPieceEur, row.transactions]), [
    ['Vaas', null, 4, 100, 25, 2],
    ['Rose box rood', 7, 3, 59.99, 20, 2],
  ]);
});

test('vestigingen by revenue with their own receipts and pieces', () => {
  const lines = [
    sale({ location: 'TICA - Brussel', transactionNumber: '1', quantity: 2, netTotal: 30 }),
    sale({ location: 'TICA - Brussel', transactionNumber: '1', quantity: 1, netTotal: 10 }),
    sale({ location: 'TICA - Antwerpen', transactionNumber: '1', quantity: 5, netTotal: 90 }),
  ];
  const result = ticaBreakdown({ transactionCount: 2, quantity: 8, grossTotal: 130, netTotal: 130, unmatchedLineCount: 0 }, lines, false);
  assert.deepEqual(result.locations, [
    { location: 'TICA - Antwerpen', transactions: 1, pieces: 5, netEur: 90 },
    { location: 'TICA - Brussel', transactions: 1, pieces: 3, netEur: 40 },
  ]);
  assert.equal(result.complete, false);
});

test('full displays count their pieces: Gem. per stuk is per piece, also for the products and vestigingen', () => {
  const lines = [
    sale({ productId: 7, quantity: 2, grossTotal: 80, netTotal: 80, stockSourceUnit: 'DISPLAY', stockUnitPieces: 12, transactionNumber: '1' }),
    sale({ productId: 8, sku: 'ST-1', description: 'Steel', quantity: 10, grossTotal: 40, netTotal: 40, stockSourceUnit: 'PIECE', stockUnitPieces: 12, transactionNumber: '2' }),
  ];
  const result = ticaBreakdown({ transactionCount: 2, quantity: 12, grossTotal: 120, netTotal: 120, unmatchedLineCount: 0 }, lines, true);
  assert.equal(result.pieces, 34);
  assert.equal(result.perPieceEur, 3.53);
  assert.deepEqual(result.products.map((row) => [row.productId, row.pieces, row.perPieceEur]), [[7, 24, 3.33], [8, 10, 4]]);
  assert.equal(result.locations[0].pieces, 34);
  const capped = ticaBreakdown({ transactionCount: 900, quantity: 1000, grossTotal: 5000, netTotal: 5000, unmatchedLineCount: 0 }, lines, false);
  assert.equal(capped.pieces, 1022, 'past the cap: the server quantity plus the loaded displays\' extra pieces');
});
