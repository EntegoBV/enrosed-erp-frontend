import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseTemplate } from '@angular/compiler';
import type { PurchaseStockBatchRow, PurchaseStockBatches } from '../src/app/core/api/stock-batch-models.ts';
import { batchFormat } from '../src/app/core/api/stock-batch-units.ts';
import {
  batchPending, batchPiecesByProduct, batchStale, mergeStale, purchaseBatchFigures, purchaseBatchRows, purchaseBatchSummary,
} from '../src/app/features/purchasing/purchase-batches-model.ts';

/* Stock batches (2026-10-25) on the purchase order: rows, summary and the batch part of the costs step. */

/** The euro formatter writes a no-break space; the assertions read plain spaces. */
const plain = (value: string | null): string | null => value?.replace(/[  ]/g, ' ') ?? null;
const DISPLAY = batchFormat({ singular: 'display', plural: 'displays' });
const PIECE = batchFormat({ singular: 'stuk', plural: 'stuks' });
const fmtFor = (productId: number) => (productId === 220 ? DISPLAY : PIECE);

function row(productId: number, extra: Partial<PurchaseStockBatchRow> = {}): PurchaseStockBatchRow {
  return {
    id: productId * 10, productId, kind: 'RECEIPT', owner: 'OWN', purchaseOrderId: 41, orderNumber: 'PO-2026-007',
    containerName: 'Stolpen mei', containerGone: false, supplierId: 3, supplierName: 'Yiwu Jerry Crafts Co., Ltd', productSupplierId: null,
    receivedOn: '2026-08-20', bookedAt: '2026-08-21T08:00:00Z', unitPieces: 1, piecesIn: 500, piecesLeft: 105,
    soldPieces: 380, lostPieces: 15, earlierPieces: 0, otherPieces: 0, costState: 'APPLIED', unitCostEur: 8.318,
    unitCostExclEnrosedEur: 7.9012, parts: null, costAppliedAt: '2026-08-23T10:00:00Z', costAppliedBy: 'emre', valueLeftEur: 873.39,
    next: true, calcUnitEur: 8.318, stale: false, note: null, sku: `SKU-${productId}`, productName: `Product ${productId}`, ...extra,
  };
}

function data(rows: PurchaseStockBatchRow[], extra: Partial<PurchaseStockBatches> = {}): PurchaseStockBatches {
  return {
    started: true, booked: true, rows,
    totals: { piecesIn: 9000, piecesLeft: 1800, valueLeftEur: 12340.55, valueComplete: true },
    costs: { applied: 4, calculated: 1, card: 0, none: 1, stale: 1, staleLargestEur: 2.5678 }, ...extra,
  };
}

const SIX = data([
  row(220, { unitPieces: 12, piecesIn: 6000, piecesLeft: 1264, soldPieces: 4496, lostPieces: 240, earlierPieces: 0, otherPieces: 0,
    unitCostEur: 35.4, calcUnitEur: 37.9178, stale: true, valueLeftEur: 3728.8, productName: 'Soap rose display' }),
  row(221, { costState: 'CALCULATED', calcUnitEur: 4.1, unitCostEur: 4.1 }),
  row(222, { costState: 'CARD', soldPieces: 0, lostPieces: 0, piecesLeft: 500 }),
  row(223, { costState: 'NONE', unitCostEur: null, calcUnitEur: null, valueLeftEur: null }),
  row(224, { piecesLeft: 0, soldPieces: 480, lostPieces: 15, earlierPieces: 5, valueLeftEur: 0, stale: true, calcUnitEur: 9.1 }),
  row(225, { sku: '  ', earlierPieces: 5, stale: true, unitCostEur: 3, calcUnitEur: 2.25 }),
]);

test('one row per batch: units, what left the batch, the cost per unit and its state', () => {
  const rows = purchaseBatchRows(SIX, fmtFor);
  assert.equal(rows.length, 6);
  const [display, calculated, card, none, soldOut, older] = rows;
  assert.deepEqual([display.name, display.variant, display.received, display.left], ['Soap rose display', 'SKU-220', '500 displays', '105 displays + 4 los']);
  /* Out of stock: sold + lost + before the start + other moves, in the batch's units. */
  assert.equal(display.out, '394 displays + 8 los');
  assert.equal(display.outDetail, '374 + 8 los verkocht · 20 verlies');
  assert.equal(plain(display.cost), '€ 35,4000');
  assert.equal(display.stale, true);
  assert.equal(plain(display.costNote), 'nu € 37,9178');
  assert.equal(plain(display.costNow), '37,9178');
  assert.equal(display.valueEur, 3728.8);
  assert.deepEqual(display.productLink, ['/products', 220]);
  assert.deepEqual([calculated.costNote, card.costNote, none.costNote], ['berekend', 'van productkaart', 'kost onbekend']);
  assert.equal(calculated.costNow, null);
  assert.equal(card.outDetail, null, 'nothing left the batch');
  assert.equal(card.out, '0 stuks');
  assert.deepEqual([none.cost, none.valueEur], [null, null]);
  assert.equal(soldOut.left, '0 stuks');
  assert.equal(soldOut.outDetail, '480 verkocht · 15 verlies · 5 vóór de start');
  assert.equal(older.variant, null, 'a blank SKU has no second line');
  assert.equal(plain(`${older.cost} → ${older.costNow}`), '€ 3,0000 → 2,2500');
  assert.equal(purchaseBatchRows(data([]), fmtFor).length, 0);
});

test('the summary and the phone figures', () => {
  assert.equal(plain(purchaseBatchSummary(SIX, DISPLAY.eur)), 'Oudste batch gaat eerst · nog € 12.341 op voorraad');
  assert.deepEqual(purchaseBatchFigures(SIX), { products: 6, valueLeftEur: 12340.55, soldOut: 1 });
});

test('batchPending: live batches still on the calculation, only once batches started', () => {
  assert.equal(batchPending(SIX), true);
  assert.equal(batchPending(data(SIX.rows, { costs: { ...SIX.costs, calculated: 0 } })), false);
  assert.equal(batchPending(data(SIX.rows, { started: false })), false);
  assert.equal(batchPending(null), false);
  assert.equal(batchPending(undefined), false);
});

test('batchStale: live stale rows only, the largest signed change; zeros before the start', () => {
  /* 224 is stale but sold out: nothing on the shelf to put a new cost on. */
  assert.deepEqual(batchStale(SIX), { count: 2, productIds: [220, 225], largestEur: 2.5178 });
  assert.deepEqual(batchStale(data([row(225, { stale: true, unitCostEur: 3, calcUnitEur: 2.25 })])), { count: 1, productIds: [225], largestEur: -0.75 });
  assert.deepEqual(batchStale(data(SIX.rows, { started: false })), { count: 0, productIds: [], largestEur: 0 });
  assert.deepEqual(batchStale(null), { count: 0, productIds: [], largestEur: 0 });
  /* A stale row without both figures falls back on the server's largest change. */
  assert.deepEqual(batchStale(data([row(223, { stale: true, unitCostEur: null })])), { count: 1, productIds: [223], largestEur: 2.5678 });
});

test('mergeStale: the card part and the batch part by product, the largest change of either', () => {
  const card = { count: 2, productIds: [220, 301], largestEur: -1.2 };
  assert.deepEqual(mergeStale(card, batchStale(SIX)), { count: 3, productIds: [220, 301, 225], largestEur: 2.5178 });
  assert.deepEqual(mergeStale({ count: 1, productIds: [301], largestEur: -3 }, batchStale(SIX)), { count: 3, productIds: [301, 220, 225], largestEur: -3 });
  const none = { count: 0, productIds: [], largestEur: 0 };
  assert.deepEqual(mergeStale(card, batchStale(null)), card);
  assert.deepEqual(mergeStale(none, batchStale(null)), none);
});

test('batchPiecesByProduct: what is still on the shelf from this container, empty before the start', () => {
  const left = batchPiecesByProduct(SIX);
  assert.deepEqual(left.get(220), { pieces: 1264, unitPieces: 12 });
  assert.deepEqual(left.get(224), { pieces: 0, unitPieces: 1 });
  assert.equal(left.size, 6);
  const twice = batchPiecesByProduct(data([row(230, { piecesLeft: 10 }), row(230, { piecesLeft: 5 })]));
  assert.deepEqual(twice.get(230), { pieces: 15, unitPieces: 1 });
  assert.equal(batchPiecesByProduct(data(SIX.rows, { started: false })).size, 0);
  assert.equal(batchPiecesByProduct(null).size, 0);
});

test('the batches card parses, keeps its words and its classes, and links to the product\'s batches', async () => {
  const card = await readFile(new URL('../src/app/features/purchasing/purchase-batches-card.ts', import.meta.url), 'utf8');
  const template = /template:\s*`([\s\S]*?)`,\s*styles:/.exec(card)?.[1] ?? '';
  assert.equal(parseTemplate(template, 'purchase-batches-card.html').errors, null);
  for (const word of ['Batches uit deze container', 'Product', 'Ontvangen', 'Uit voorraad', 'Nog', 'Kost per eenheid', 'Waarde', 'Totaal',
    'Producten', 'Nog op voorraad', 'Uitverkocht', 'Oudste batch gaat eerst.']) assert.ok(template.includes(word), word);
  assert.match(template, /<table class="desk-table desk-table--batches">/);
  assert.match(template, /fragment="pd-batches"/);
  assert.match(template, /fragment="product-batches"/);
  for (const cls of ['c-bprod', 'c-bin', 'c-bout', 'c-bleft', 'c-bcost', 'c-bval']) assert.ok(template.includes(cls), cls);
  const words = template.replace(/<[^>]*>/g, ' ').replace(/\{\{[^}]*\}\}/g, ' ').replace(/@\w+[^{]*\{/g, ' ');
  assert.doesNotMatch(words, /\bset\b|begroot/i);
  /* The desk table gets its own columns, never the products table's 726 px minimum. */
  const scss = await readFile(new URL('../src/styles/purchase-desk.scss', import.meta.url), 'utf8');
  assert.match(scss, /app-purchase-desk \.desk-table--batches\{min-width:0;table-layout:fixed\}/);
  for (const [cls, width] of [['c-bin', 100], ['c-bout', 134], ['c-bleft', 134], ['c-bcost', 124], ['c-bval', 88]] as const) {
    assert.match(scss, new RegExp(`app-purchase-desk \\.desk-table--batches \\.${cls}\\{width:${width}px\\}`), cls);
  }
  assert.match(scss, /\.pbc-name\{[^}]*text-overflow:ellipsis/);
});
