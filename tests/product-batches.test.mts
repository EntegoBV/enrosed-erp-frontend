import assert from 'node:assert/strict';
import test from 'node:test';
import { batchFormat } from '../src/app/core/api/stock-batch-units.ts';
import type { ProductStockBatches, StockBatch, StockBatchMove } from '../src/app/core/api/stock-batch-models.ts';
import {
  batchCostParts, batchCostText, batchDate, batchDrift, batchFigures, batchRowTitle, batchStateWord, batchSub, batchTags, batchTitle,
  batchesHelper, batchesNote, batchesTotal, moveDelta, moveLabel, partnerFoot, showBatches, splitBatches,
} from '../src/app/features/products/product-batches.ts';

/* Intl writes a no-break space between € and the figure; compare with a plain space. */
const plain = (text: string | null) => text === null ? null : text.replace(/[  ]/g, ' ');

const displays = batchFormat({ singular: 'display', plural: 'displays' });
const pieces = batchFormat({ singular: 'stuk', plural: 'stuks' });

function batch(extra: Partial<StockBatch> = {}): StockBatch {
  return {
    id: 12, productId: 94, kind: 'RECEIPT', owner: 'OWN',
    purchaseOrderId: 39, orderNumber: 'PO-2026-005', containerName: 'Stolpen mei', containerGone: false,
    supplierId: 3, supplierName: 'Yunnan Pubei', productSupplierId: null,
    receivedOn: '2026-08-20', bookedAt: '2026-08-21T08:00:00Z',
    unitPieces: 12, piecesIn: 6000, piecesLeft: 1260,
    soldPieces: 4500, lostPieces: 240, earlierPieces: 0, otherPieces: 0,
    costState: 'APPLIED', unitCostEur: 8.318, unitCostExclEnrosedEur: 7.9012,
    parts: null, costAppliedAt: '2026-08-23T10:00:00Z', costAppliedBy: 'emre',
    valueLeftEur: 873.39, next: true, calcUnitEur: 10.3858, stale: false, note: null,
    ...extra,
  };
}

function data(list: StockBatch[], summary: Partial<ProductStockBatches['summary']> = {}, extra: Partial<ProductStockBatches> = {}): ProductStockBatches {
  return {
    productId: 94, started: true, unitPieces: 12, batches: list,
    summary: { stockPieces: 1260, batchPieces: 1260, unassignedPieces: 0, differencePieces: 0, valueEur: 873.39,
      partnerValueEur: 0, valueComplete: true, nextUnitCostEur: 8.318, nextBatchId: 12, ...summary },
    ...extra,
  };
}

function move(extra: Partial<StockBatchMove> = {}): StockBatchMove {
  return { id: 901, batchId: 12, kind: 'SALE', pieces: -240, unitPieces: 12, unitCostEur: 8.318, reference: 'F-2026-0123',
    salesOrderId: 812, ticaSaleId: null, purchaseOrderId: null, pinned: false, settles: false, restores: false,
    movementGone: false, at: '2026-09-01T09:00:00Z', actor: 'emre', ...extra };
}

test('batchTitle: the container name, else its number, else "Container"; Beginvoorraad; Telling', () => {
  assert.equal(batchTitle(batch()), 'Stolpen mei');
  assert.equal(batchTitle(batch({ containerName: null })), 'PO-2026-005');
  assert.equal(batchTitle(batch({ containerName: '  ', orderNumber: null })), 'Container');
  assert.equal(batchTitle(batch({ kind: 'OPENING', containerName: 'x' })), 'Beginvoorraad');
  assert.equal(batchTitle(batch({ kind: 'COUNT' })), 'Telling');
});

test('batchTags: volgende, partner, then one cost word in that order', () => {
  assert.deepEqual(batchTags(batch()), ['volgende']);
  assert.deepEqual(batchTags(batch({ next: false })), []);
  assert.deepEqual(batchTags(batch({ owner: 'PARTNER', costState: 'CALCULATED' })), ['volgende', 'partner', 'berekend']);
  assert.deepEqual(batchTags(batch({ next: false, costState: 'CARD' })), ['van productkaart']);
  assert.deepEqual(batchTags(batch({ next: false, owner: 'PARTNER', costState: 'NONE' })), ['partner', 'kost onbekend']);
});

test('batchSub: date and what is left in whole units with loose pieces; opening "bij de start"; Telling its day', () => {
  assert.equal(batchSub(batch(), displays), '20/08/2026 · nog 105 van 500');
  assert.equal(batchSub(batch({ piecesLeft: 1264, piecesIn: 6004 }), displays), '20/08/2026 · nog 105 + 4 los van 500 + 4 los');
  assert.equal(batchSub(batch({ kind: 'OPENING', receivedOn: null, unitPieces: 1, piecesIn: 40, piecesLeft: 40 }), pieces), 'bij de start · nog 40 van 40');
  assert.equal(batchSub(batch({ kind: 'COUNT', receivedOn: '2026-10-21', unitPieces: 1, piecesIn: 4, piecesLeft: 4 }), pieces), '21/10/2026 · nog 4 van 4');
  assert.equal(batchSub(batch({ receivedOn: null, bookedAt: null, unitPieces: 1, piecesIn: 6, piecesLeft: 0 }), pieces), 'nog 0 van 6');
  assert.equal(batchDate('2026-08-20'), '20/08/2026');
  assert.equal(batchDate(null), '');
});

test('batchCostText: the cost, the stale arrow, or "—"', () => {
  assert.equal(plain(batchCostText(batch(), displays)), '€ 8,32');
  assert.equal(plain(batchCostText(batch({ stale: true }), displays)), '€ 8,32 → 10,39');
  assert.equal(batchCostText(batch({ unitCostEur: null, costState: 'NONE', calcUnitEur: null }), displays), '—');
  assert.equal(plain(batchCostText(batch({ stale: true, calcUnitEur: null }), displays)), '€ 8,32', 'no arrow without a calculation');
  const parts = batchCostParts(batch({ stale: true }), displays);
  assert.deepEqual([plain(parts.cost), parts.now], ['€ 8,32', '→ 10,39'], 'the phone shows today\'s figure under the cost');
  assert.deepEqual(batchCostParts(batch(), displays).now, null);
  assert.deepEqual(batchCostParts(batch({ unitCostEur: null }), displays), { cost: '—', now: null });
});

test('splitBatches keeps the server order: live ones, then the sold-out ones', () => {
  const a = batch({ id: 1, piecesLeft: 10 });
  const b = batch({ id: 2, piecesLeft: 0, next: false });
  const c = batch({ id: 3, piecesLeft: 5, next: false });
  const d = batch({ id: 4, piecesLeft: 0, next: false });
  const { active, empty } = splitBatches([a, b, c, d]);
  assert.deepEqual(active.map((x) => x.id), [1, 3]);
  assert.deepEqual(empty.map((x) => x.id), [2, 4]);
});

test('showBatches: only after the start and with batches, unassigned pieces or a difference', () => {
  assert.equal(showBatches(null), false);
  assert.equal(showBatches(data([batch()], {}, { started: false })), false);
  assert.equal(showBatches(data([])), false);
  assert.equal(showBatches(data([batch()])), true);
  assert.equal(showBatches(data([], { unassignedPieces: 6 })), true);
  assert.equal(showBatches(data([], { differencePieces: -2 })), true);
});

test('batchesHelper names the unit and the partner part of the total', () => {
  assert.equal(batchesHelper(data([batch()]), displays), 'Oudste gaat eerst · in displays');
  assert.equal(plain(batchesHelper(data([batch()], { partnerValueEur: 120.4 }), displays)), 'Oudste gaat eerst · in displays · waarvan partner € 120');
  assert.equal(batchesHelper(data([batch()]), pieces), 'Oudste gaat eerst · in stuks');
});

test('batchesNote: without batch first, then the difference, then batches without cost, else null', () => {
  const none = batch({ id: 5, unitCostEur: null, costState: 'NONE', next: false });
  assert.equal(batchesNote(data([batch(), none], { unassignedPieces: 6, differencePieces: 3 }, { unitPieces: 1 }), pieces), '6 stuks zonder batch');
  assert.equal(batchesNote(data([batch()], { unassignedPieces: 16 }), displays), '1 display + 4 los zonder batch');
  assert.equal(batchesNote(data([batch(), none], { differencePieces: -10 }), displays), 'Batches wijken 10 stuks af van de voorraad');
  assert.equal(batchesNote(data([batch()], { differencePieces: 1 }), displays), 'Batches wijken 1 stuk af van de voorraad');
  assert.equal(batchesNote(data([batch(), none]), displays), '1 batch zonder kost');
  assert.equal(batchesNote(data([batch(), none, { ...none, id: 6 }]), displays), '2 batches zonder kost');
  assert.equal(batchesNote(data([batch(), { ...none, piecesLeft: 0 }]), displays), null, 'a sold-out batch without cost says nothing');
  assert.equal(batchesNote(data([batch()]), displays), null);
});

test('partnerFoot only with a partner value', () => {
  assert.equal(plain(partnerFoot(data([batch()], { partnerValueEur: 120 }), displays)), 'Waarvan partner € 120');
  assert.equal(partnerFoot(data([batch()]), displays), null);
});

test('batchFigures: Vóór de start only above 0, values in units with loose pieces', () => {
  assert.deepEqual(batchFigures(batch(), displays), [
    { label: 'Ontvangen', value: '500 displays' },
    { label: 'Verkocht', value: '375 displays' },
    { label: 'Verlies', value: '20 displays' },
    { label: 'Nog', value: '105 displays' },
  ]);
  const earlier = batchFigures(batch({ earlierPieces: 52, lostPieces: 0 }), displays);
  assert.deepEqual(earlier.map((f) => f.label), ['Ontvangen', 'Verkocht', 'Verlies', 'Vóór de start', 'Nog']);
  assert.equal(earlier[2].value, '0 displays');
  assert.equal(earlier[3].value, '4 displays + 4 los');
  assert.equal(batchFigures(batch({ unitPieces: 1, piecesIn: 1, piecesLeft: 1, soldPieces: 0, lostPieces: 0 }), pieces)[0].value, '1 stuk');
});

test('state words, the row title and the drift line', () => {
  assert.equal(batchStateWord(batch()), 'Toegepast 23/08/2026');
  assert.equal(batchStateWord(batch({ costAppliedAt: null })), 'Toegepast');
  assert.equal(batchStateWord(batch({ costState: 'CALCULATED' })), 'Berekend');
  assert.equal(batchStateWord(batch({ costState: 'CARD' })), 'Van de productkaart');
  assert.equal(batchStateWord(batch({ costState: 'NONE' })), 'Kost onbekend');
  assert.equal(plain(batchRowTitle(batch({ stale: true }), displays)), '€ 8,32 → 10,39 per display · Toegepast 23/08/2026');
  assert.equal(batchDrift(batch(), displays), null);
  const drift = batchDrift(batch({ stale: true }), displays);
  assert.equal(drift?.orderId, 39);
  assert.equal(plain(drift?.text ?? null), 'PO-2026-005 rekent nu € 10,39 per display (+ € 2,07)');
  assert.equal(plain(batchDrift(batch({ stale: true, calcUnitEur: 7.5 }), displays)?.text ?? null), 'PO-2026-005 rekent nu € 7,50 per display (− € 0,82)');
  assert.equal(batchDrift(batch({ stale: true, containerGone: true }), displays), null, 'a gone container has nothing to re-apply');
});

test('moveLabel: every kind, with the settle and gone suffixes', () => {
  const expected: Record<StockBatchMove['kind'], string> = {
    PURCHASE_RECEIPT: 'Ontvangen', RECEIPT_CORRECTION: 'Ontvangst gecorrigeerd', OPENING: 'Beginvoorraad', COUNT_IN: 'Gevonden',
    BACKFILL: 'Weg vóór de start', REPAIR: 'Hersteld', SALE: 'Verkocht', SALE_RETURN: 'Retour', DAMAGED: 'Beschadigd',
    SHORTAGE: 'Te weinig geleverd', DEMO: 'Demo', STOCKTAKE: 'Telling', MANUAL_CORRECTION: 'Manueel gezet',
  };
  for (const [kind, label] of Object.entries(expected)) {
    assert.equal(moveLabel(move({ kind: kind as StockBatchMove['kind'] })), label, kind);
  }
  assert.equal(moveLabel(move({ kind: 'PURCHASE_RECEIPT', settles: true })), 'Ontvangen · eerder zonder batch');
  assert.equal(moveLabel(move({ movementGone: true })), 'Verkocht · boeking verwijderd');
  assert.equal(moveLabel(move({ kind: 'REPAIR', settles: true, movementGone: true })), 'Hersteld · eerder zonder batch · boeking verwijderd');
});

test('moveDelta: signed, in the move\'s own unit, loose pieces apart', () => {
  assert.equal(moveDelta(move(), displays), '−20');
  assert.equal(moveDelta(move({ pieces: 4 }), displays), '+4 los');
  assert.equal(moveDelta(move({ pieces: 14 }), displays), '+1 + 2 los');
  assert.equal(moveDelta(move({ pieces: -5, unitPieces: 1 }), pieces), '−5');
  assert.equal(moveDelta(move({ pieces: 0 }), displays), '0');
});

test('batchesTotal adds the partner batches to the own value (product 94: only partner stock, € 193)', () => {
  assert.equal(batchesTotal(data([batch()], { valueEur: 0, partnerValueEur: 192.96 })), 192.96);
  assert.equal(batchesTotal(data([batch()], { valueEur: 100.1, partnerValueEur: 20.2 })), 120.3);
  assert.equal(batchesTotal(data([batch()], { valueEur: 55, partnerValueEur: 0 })), 55);
});
