import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { parseTemplate } from '@angular/compiler';
import type { Product, ProductCostHistoryEntry, UnitName } from '../src/app/core/api/models.ts';
import * as units from '../src/app/features/products/product-sales-unit.ts';
import * as containers from '../src/app/features/purchasing/container-name.ts';

// product-cost-basis and the history model import their siblings without an
// extension, which node cannot resolve; run them through the TypeScript
// transpiler with the real modules, like inventory-unit.test.mts.
async function load(path: string, modules: Record<string, unknown>): Promise<Record<string, any>> {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const loaded = { exports: {} as Record<string, any> };
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { module: loaded, exports: loaded.exports, require: (id: string) => modules[id], Intl });
  return loaded.exports;
}
const basisModule = await load('../src/app/features/products/product-cost-basis.ts', { './product-sales-unit': units });
const model = await load('../src/app/features/products/product-cost-history-model.ts', {
  '../purchasing/container-name': containers, './product-cost-basis': basisModule,
});
/** The modules run in their own realm; compare their objects as plain data. */
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const basis: typeof import('../src/app/features/products/product-cost-basis.ts') = basisModule as any;
const history: typeof import('../src/app/features/products/product-cost-history-model.ts') = model as any;

// The Dutch answer of GET /api/products/unit-names (backend unit-names.csv).
const NAMES: UnitName[] = [
  { key: 'stuk', one: 'stuk', other: 'stuks', per: 'per stuk', short: 'st.' },
  { key: 'roos', one: 'roos', other: 'rozen', per: 'per roos', short: 'rozen' },
  { key: 'diamant', one: 'diamant', other: 'diamanten', per: 'per diamant', short: 'diamanten' },
  { key: 'bowl', one: 'bowl', other: 'bowls', per: 'per bowl', short: 'bowls' },
];
units.rememberUnitNames(NAMES);

const packaging = (over: Partial<Product['packaging']>): Pick<Product, 'packaging'> => ({ packaging: {
  kind: 'NONE', dimensions: { lengthCm: null, widthCm: null, heightCm: null, weightKg: null }, barcode: null,
  piecesPerUnit: null, salesUnit: 'PIECE', unitKey: 'stuk', ...over } as Product['packaging'] });
const ROSES_DISPLAY = packaging({ kind: 'DISPLAY', piecesPerUnit: 12, salesUnit: 'DISPLAY', unitKey: 'roos' });
const DIAMANT_PIECE = packaging({ kind: 'DISPLAY', piecesPerUnit: 12, salesUnit: 'PIECE', unitKey: 'diamant' });

let nextId = 1;
function row(over: Partial<ProductCostHistoryEntry>): ProductCostHistoryEntry {
  const landed = over.landedUnitEur ?? 1;
  const previous = over.previousLandedUnitEur ?? null;
  const delta = previous === null ? null : Math.round((landed - previous) * 10000) / 10000;
  return {
    id: nextId++, appliedAt: '2026-10-01T10:00:00Z', landedUnitEur: landed, previousLandedUnitEur: previous,
    deltaEur: delta, deltaPct: delta === null || previous! <= 0 ? null : Math.round(delta * 1000 / previous!) / 10,
    source: 'PO-2026-001', purchaseOrderId: 1, quantity: 100, exwPrice: null, exwCurrency: null, appliedBy: 'emre',
    ...over,
  };
}

/* ---- the basis words -------------------------------------------------- */

test('a product basis is the effective one, as the server stores it', () => {
  assert.deepEqual(plain(basis.productCostBasis(ROSES_DISPLAY)), { salesUnit: 'DISPLAY', piecesPerUnit: 12, unitKey: 'roos' });
  assert.deepEqual(plain(basis.productCostBasis(DIAMANT_PIECE)), { salesUnit: 'PIECE', piecesPerUnit: 12, unitKey: 'diamant' });
  /* A stray DISPLAY sales unit without a display is per piece; a blank key is "stuk". */
  assert.deepEqual(plain(basis.productCostBasis(packaging({ kind: 'GIFT_BOX' as any, salesUnit: 'DISPLAY', unitKey: ' ' }))),
    { salesUnit: 'PIECE', piecesPerUnit: null, unitKey: 'stuk' });
  assert.deepEqual(plain(basis.productCostBasis(null)), { salesUnit: 'PIECE', piecesPerUnit: null, unitKey: 'stuk' });
});

test('a cost reads per display of n with the per-piece figure, or per piece with the display figure', () => {
  const display = basis.productCostBasis(ROSES_DISPLAY);
  assert.equal(basis.costWords(display).per, 'per display van 12');
  assert.equal(basis.costWords(display).unit, 'display van 12');
  assert.deepEqual(plain(basis.otherSideCost(display, 31.5)), { sign: '=', price: 2.625, per: 'per roos' });
  assert.equal(basis.otherSideCost(display, 31.21)?.sign, '≈');
  assert.equal(basis.costQuantity(display, 500), '500 displays');
  assert.equal(basis.costQuantity(display, 1), '1 display');
  const diamant = basis.productCostBasis(DIAMANT_PIECE);
  assert.equal(basis.costWords(diamant).per, 'per diamant');
  assert.deepEqual(plain(basis.otherSideCost(diamant, 0.56)), { sign: '=', price: 6.72, per: 'per display van 12' });
  assert.equal(basis.costQuantity(diamant, 2400), '2.400 diamanten');
  const stuk = basis.productCostBasis(packaging({}));
  assert.equal(basis.costWords(stuk).per, 'per stuk');
  assert.equal(basis.otherSideCost(stuk, 3), null);
  assert.equal(basis.otherSideCost(display, 0), null);
  assert.equal(basis.otherSideCost(display, null), null);
  /* A display of one sold per display: per display, no other side. */
  const single = { salesUnit: 'DISPLAY' as const, piecesPerUnit: null, unitKey: 'roos' };
  assert.equal(basis.costWords(single).per, 'per display');
  assert.equal(basis.otherSideCost(single, 4), null);
  for (const words of [basis.costWords(display), basis.costWords(diamant), basis.costWords(stuk)]) {
    assert.doesNotMatch(JSON.stringify(words), /\bset\b/);
  }
});

test('a row keeps its own basis; a row without one reads on the product basis', () => {
  const fallback = basis.productCostBasis(ROSES_DISPLAY);
  assert.deepEqual(plain(basis.entryCostBasis({ salesUnit: null, piecesPerUnit: null, unitKey: null }, fallback)), plain(fallback));
  assert.deepEqual(plain(basis.entryCostBasis({}, fallback)), plain(fallback));
  assert.deepEqual(plain(basis.entryCostBasis({ salesUnit: 'PIECE', piecesPerUnit: null, unitKey: 'Bowl ' }, fallback)),
    { salesUnit: 'PIECE', piecesPerUnit: null, unitKey: 'bowl' });
  assert.equal(basis.sameCostBasis(fallback, { salesUnit: 'DISPLAY', piecesPerUnit: 12, unitKey: 'roos' }), true);
  assert.equal(basis.sameCostBasis(fallback, { salesUnit: 'DISPLAY', piecesPerUnit: 10, unitKey: 'roos' }), false);
  assert.equal(basis.sameCostBasis(fallback, { salesUnit: 'PIECE', piecesPerUnit: 12, unitKey: 'roos' }), false);
});

test('only what changes the amount makes another basis: not a display count per piece, not a unit name', () => {
  /* Per piece, the display around it does not change what one piece costs. */
  assert.equal(basis.sameCostBasis({ salesUnit: 'PIECE', piecesPerUnit: null, unitKey: 'diamant' },
    { salesUnit: 'PIECE', piecesPerUnit: 12, unitKey: 'diamant' }), true);
  /* A display of 12 stays a display of 12 when its piece is renamed; so does a piece. */
  assert.equal(basis.sameCostBasis({ salesUnit: 'DISPLAY', piecesPerUnit: 12, unitKey: 'roos' },
    { salesUnit: 'DISPLAY', piecesPerUnit: 12, unitKey: 'diamant' }), true);
  assert.equal(basis.sameCostBasis({ salesUnit: 'PIECE', piecesPerUnit: null, unitKey: 'roos' },
    { salesUnit: 'PIECE', piecesPerUnit: null, unitKey: 'diamant' }), true);
  assert.equal(basis.sameCostBasis({ salesUnit: 'DISPLAY', piecesPerUnit: null, unitKey: 'roos' },
    { salesUnit: 'DISPLAY', piecesPerUnit: 12, unitKey: 'roos' }), false);

  /* A product sold per diamant gets a display of 12 and is still sold per diamant. */
  const display = history.costHistoryView([
    row({ appliedAt: '2026-10-10T10:00:00Z', landedUnitEur: 0.6, previousLandedUnitEur: 0.56, purchaseOrderId: 2, source: 'PO-2',
      salesUnit: 'PIECE', piecesPerUnit: 12, unitKey: 'diamant' }),
    row({ appliedAt: '2026-09-10T10:00:00Z', landedUnitEur: 0.56, previousLandedUnitEur: null, purchaseOrderId: 1, source: 'PO-1',
      salesUnit: 'PIECE', piecesPerUnit: null, unitKey: 'diamant' }),
  ], basis.productCostBasis(DIAMANT_PIECE));
  assert.deepEqual(plain(display.rows.map((r) => r.delta.tone)), ['up', 'first']);
  assert.equal(display.excluded, 0);
  assert.deepEqual(plain(display.stats), { min: 0.56, max: 0.6, avg: 0.58 });
  assert.equal(display.basisNote, null);
  /* The other way round: a display of 12 per diamant was one before, the product now sits in no display. */
  const loose = history.costHistoryView(display.rows.map((r) => r.entry).reverse().map((e, i) => ({ ...e, previousLandedUnitEur: i ? 0.6 : null,
    deltaEur: i ? -0.04 : null, deltaPct: i ? -6.7 : null, landedUnitEur: i ? 0.56 : 0.6 })).reverse(), basis.productCostBasis(packaging({ unitKey: 'diamant' })));
  assert.deepEqual(plain(loose.rows.map((r) => r.delta.tone)), ['down', 'first']);
  assert.equal(loose.basisNote, null);

  /* A display of 12 roses whose piece is now called diamant. */
  const renamed = history.costHistoryView([
    row({ appliedAt: '2026-10-10T10:00:00Z', landedUnitEur: 31.5, previousLandedUnitEur: 31.2, purchaseOrderId: 2, source: 'PO-2',
      salesUnit: 'DISPLAY', piecesPerUnit: 12, unitKey: 'roos' }),
    row({ appliedAt: '2026-09-10T10:00:00Z', landedUnitEur: 31.2, previousLandedUnitEur: null, purchaseOrderId: 1, source: 'PO-1',
      salesUnit: 'DISPLAY', piecesPerUnit: 12, unitKey: 'roos' }),
  ], basis.productCostBasis(packaging({ kind: 'DISPLAY', piecesPerUnit: 12, salesUnit: 'DISPLAY', unitKey: 'diamant' })));
  assert.deepEqual(plain(renamed.rows.map((r) => r.delta.tone)), ['up', 'first']);
  assert.equal(renamed.excluded, 0);
  assert.equal(renamed.basisNote, null);
  /* Each row keeps its own words. */
  assert.deepEqual(plain(renamed.rows[0].other), { sign: '=', price: 2.625, per: 'per roos' });
});

/* ---- the history ------------------------------------------------------ */

test('the kind of a row, with the fallback for rows from before the kind was kept', () => {
  assert.equal(history.costKind({ kind: 'REAPPLY', appliedBy: 'emre' }), 'REAPPLY');
  assert.equal(history.costKind({ kind: 'COPY', appliedBy: 'system' }), 'COPY');
  assert.equal(history.costKind({ kind: null, appliedBy: 'system' }), 'SEED');
  assert.equal(history.costKind({ appliedBy: 'systeem' }), 'APPLY', "'systeem' rows are real applies by the system");
  assert.equal(history.costKind({ kind: null, appliedBy: 'emre' }), 'APPLY');
  assert.deepEqual(plain(Object.values(history.COST_KIND_LABEL)), ['Toegepast', 'Opnieuw', 'Start', 'Kopie']);
});

test('rows read in their stored unit, name the container and compare with the row before', () => {
  const current = basis.productCostBasis(ROSES_DISPLAY);
  const entries = [
    row({ appliedAt: '2026-10-14T09:00:00Z', landedUnitEur: 31.5, previousLandedUnitEur: 31.5, kind: 'REAPPLY', purchaseOrderId: 14,
      source: 'PO-2026-014', containerName: 'container/2026/014', salesUnit: 'DISPLAY', piecesPerUnit: 12, unitKey: 'roos', quantity: 498 }),
    row({ appliedAt: '2026-10-12T09:00:00Z', landedUnitEur: 31.5, previousLandedUnitEur: 30, kind: 'APPLY', purchaseOrderId: 14,
      source: 'PO-2026-014', containerName: 'container/2026/014', salesUnit: 'DISPLAY', piecesPerUnit: 12, unitKey: 'roos', quantity: 500,
      appliedBy: 'systeem' }),
    row({ appliedAt: '2026-08-01T09:00:00Z', landedUnitEur: 30, previousLandedUnitEur: 32, kind: 'APPLY', purchaseOrderId: 9,
      source: 'PO-2026-009', containerName: 'PO-2026-009', containerGone: true, salesUnit: 'DISPLAY', piecesPerUnit: 12, unitKey: 'roos' }),
    row({ appliedAt: '2026-05-01T09:00:00Z', landedUnitEur: 32, previousLandedUnitEur: null, kind: 'SEED', purchaseOrderId: null,
      source: null, appliedBy: 'system', quantity: null }),
  ];
  const view = history.costHistoryView(entries, current, 14);
  assert.deepEqual(plain(view.rows.map((r) => r.kindLabel)), ['Opnieuw', 'Toegepast', 'Toegepast', 'Start']);
  assert.deepEqual(plain(view.rows.map((r) => r.delta.tone)), ['same', 'up', 'down', 'first']);
  assert.equal(view.rows[1].delta.pct, 5);
  assert.deepEqual(plain(view.rows.map((r) => r.per)), Array(4).fill('per display van 12'));
  assert.equal(view.rows[0].quantity, '498 displays');
  assert.deepEqual(plain(view.rows[0].other), { sign: '=', price: 2.625, per: 'per roos' });
  assert.equal(view.rows[0].name, 'container/2026/014');
  assert.equal(view.rows[0].numberHint, 'PO-2026-014');
  assert.equal(view.rows[0].linkId, null, 'the container the sheet was opened from links to nothing');
  assert.equal(view.rows[2].linkId, null);
  assert.equal(view.rows[2].gone, true);
  assert.equal(view.rows[2].numberHint, null);
  assert.equal(view.rows[3].name, 'Handmatig');
  assert.deepEqual(plain(view.rows.map((r) => r.by)), ['emre', null, 'emre', null]);
  assert.equal(view.containers, 2, 'two purchase orders; the seed without a source is no container');
  assert.equal(view.excluded, 0);
  /* The re-applied container counts once, with its newest cost. */
  assert.deepEqual(plain(view.stats), { min: 30, max: 32, avg: 31.1667 });
  assert.equal(view.replaced, 1);
  assert.equal(view.basisNote, null);
  /* The header of a re-apply compares with this same container, not with "the previous container". */
  assert.deepEqual(plain(view.rows.map((r) => r.against)),
    ['eerder bij deze container', 'de vorige container', 'de vorige container', 'de vorige container']);
  const elsewhere = history.costHistoryView(entries, current, null);
  assert.equal(elsewhere.rows[0].linkId, 14);
});

test('a row on another basis is marked, left out of the sums and the chart, and the product basis note shows', () => {
  const current = basis.productCostBasis(ROSES_DISPLAY);
  const entries = [
    row({ appliedAt: '2026-10-10T09:00:00Z', landedUnitEur: 2.6, previousLandedUnitEur: 31.2, purchaseOrderId: 2, source: 'PO-2026-002',
      salesUnit: 'PIECE', piecesPerUnit: 12, unitKey: 'roos' }),
    row({ appliedAt: '2026-09-10T09:00:00Z', landedUnitEur: 31.2, previousLandedUnitEur: null, salesUnit: 'DISPLAY', piecesPerUnit: 12, unitKey: 'roos' }),
  ];
  const view = history.costHistoryView(entries, current);
  assert.equal(view.rows[0].delta.tone, 'basis');
  assert.equal(view.rows[0].per, 'per roos');
  assert.deepEqual(plain(view.rows[0].other), { sign: '=', price: 31.2, per: 'per display van 12' });
  assert.equal(view.excluded, 1);
  assert.deepEqual(plain(view.stats), { min: 2.6, max: 2.6, avg: 2.6 });
  assert.deepEqual(plain(view.chart), { dates: ['2026-10-10'], values: [2.6] });
  assert.equal(view.basisNote, 'De prijs geldt nu per display van 12; deze kostprijs werd toegepast per roos en is niet omgerekend.');
  assert.equal(history.excludedNote(1), '1 rij op een andere basis telt niet mee in laagste, hoogste, gemiddeld en de grafiek.');
  assert.equal(history.excludedNote(3), '3 rijen op een andere basis tellen niet mee in laagste, hoogste, gemiddeld en de grafiek.');
  assert.equal(history.excludedNote(0), null);
});

test('rows written before the basis was kept read on the product basis, and equal costs show "="', () => {
  const current = basis.productCostBasis(DIAMANT_PIECE);
  const entries = [
    row({ landedUnitEur: 0.56, previousLandedUnitEur: 0.56, appliedAt: '2026-10-02T09:00:00Z' }),
    row({ landedUnitEur: 0.56, previousLandedUnitEur: null, appliedAt: '2026-10-01T09:00:00Z', source: 'PO-2026-001', purchaseOrderId: 1 }),
  ];
  const view = history.costHistoryView(entries, current);
  assert.deepEqual(plain(view.rows.map((r) => r.per)), ['per diamant', 'per diamant']);
  assert.equal(view.rows[0].quantity, '100 diamanten');
  assert.equal(view.rows[0].delta.tone, 'same');
  assert.equal(view.rows[0].name, 'PO-2026-001', 'an older server sends no container name; the source stands in');
  assert.equal(view.rows[0].numberHint, null);
  assert.equal(view.containers, 1);
  assert.equal(view.basisNote, null);
});

test('the chart takes one point a day, the last cost of that day, oldest first', () => {
  const current = basis.productCostBasis(packaging({ unitKey: 'bowl' }));
  const entries = [
    row({ appliedAt: '2026-10-12T15:00:00Z', landedUnitEur: 3.2, previousLandedUnitEur: 3.1, purchaseOrderId: 3, source: 'PO-2026-003' }),
    row({ appliedAt: '2026-10-12T09:00:00Z', landedUnitEur: 3.1, previousLandedUnitEur: 2.9, purchaseOrderId: 2, source: 'PO-2026-002' }),
    row({ appliedAt: '2026-09-01T09:00:00Z', landedUnitEur: 2.9, previousLandedUnitEur: null }),
  ];
  const view = history.costHistoryView(entries, current);
  assert.deepEqual(plain(view.chart), { dates: ['2026-09-01', '2026-10-12'], values: [2.9, 3.2] });
  assert.equal(view.replaced, 0);
  assert.equal(view.rows[0].per, 'per bowl');
  assert.equal(view.rows[0].quantity, '100 bowls');
  assert.equal(history.costHistoryView([], current).chart.dates.length, 0);
});

test('the parts of one unit in the build-up words, with rounding when they miss the cost', () => {
  const current = basis.productCostBasis(ROSES_DISPLAY);
  const entry = row({ landedUnitEur: 31.5, goodsEur: 26.0001, originEur: 0.5, freightEur: 2.1, dutyEur: 0, destinationEur: 1.4,
    enrosedEur: 1.2, separateEur: 0.3, extraUnitCost: 0.25, exwCurrency: 'USD' });
  const parts = history.costParts(entry, current)!;
  assert.deepEqual(plain(parts.map((p) => p.label)), ['Inkoopprijs (EXW)', 'Lokale kosten bij vertrek', 'Zeevracht', 'Kosten na aankomst',
    'Enrosed kost', 'Inspectie en andere kosten', 'Afronding', 'Kostprijs per display van 12']);
  assert.deepEqual(plain(parts.map((p) => p.mark)), ['·', '+', '+', '+', '+', '+', '±', '=']);
  assert.equal(parts[6].eur, -0.0001);
  assert.equal(parts[7].eur, 31.5);
  assert.match(parts[0].hint!, /^fabrieksprijs incl\. (US)?\$\s?0,25 extra kost$/);
  assert.equal(parts[4].hint, 'vast bedrag per container, verdeeld over de displays');
  const exact = history.costParts(row({ landedUnitEur: 3, goodsEur: 2, freightEur: 1 }), basis.productCostBasis(packaging({ unitKey: 'bowl' })))!;
  assert.deepEqual(plain(exact.map((p) => p.label)), ['Inkoopprijs (EXW)', 'Zeevracht', 'Kostprijs per bowl']);
  assert.equal(history.costParts(row({ landedUnitEur: 3 }), current), null);
  const view = history.costHistoryView([entry], current);
  assert.equal(view.rows[0].parts?.length, 8);
});

test('a container applied again counts with its newest cost only; every row stays in the list', () => {
  const current = basis.productCostBasis(ROSES_DISPLAY);
  const entries = [
    row({ appliedAt: '2026-10-03T09:00:00Z', landedUnitEur: 31, previousLandedUnitEur: 100, kind: 'REAPPLY', purchaseOrderId: 20, source: 'PO-2026-020' }),
    row({ appliedAt: '2026-10-01T09:00:00Z', landedUnitEur: 100, previousLandedUnitEur: 30, kind: 'APPLY', purchaseOrderId: 20, source: 'PO-2026-020' }),
    row({ appliedAt: '2026-09-01T09:00:00Z', landedUnitEur: 30, previousLandedUnitEur: null, kind: 'APPLY', purchaseOrderId: 19, source: 'PO-2026-019' }),
  ];
  const view = history.costHistoryView(entries, current);
  assert.equal(view.rows.length, 3, 'the mistaken cost stays in the list');
  assert.deepEqual(plain(view.stats), { min: 30, max: 31, avg: 30.5 });
  assert.deepEqual(plain(view.chart), { dates: ['2026-09-01', '2026-10-03'], values: [30, 31] });
  assert.equal(view.containers, 2);
  assert.equal(view.excluded, 0);
  assert.equal(view.replaced, 1);
  assert.equal(view.rows[0].delta.tone, 'down');
  assert.equal(view.rows[0].against, 'eerder bij deze container');
  assert.equal(history.replacedNote(1), '1 eerdere kostprijs van een opnieuw toegepaste container telt niet mee in laagste, hoogste, gemiddeld en de grafiek.');
  assert.equal(history.replacedNote(2), '2 eerdere kostprijzen van opnieuw toegepaste containers tellen niet mee in laagste, hoogste, gemiddeld en de grafiek.');
  assert.equal(history.replacedNote(0), null);
  /* Rows without a container all count. */
  const manual = history.costHistoryView([
    row({ appliedAt: '2026-10-02T09:00:00Z', landedUnitEur: 4, previousLandedUnitEur: 3, purchaseOrderId: null, source: null }),
    row({ appliedAt: '2026-10-01T09:00:00Z', landedUnitEur: 3, previousLandedUnitEur: null, purchaseOrderId: null, source: null }),
  ], current);
  assert.deepEqual([manual.replaced, manual.stats.min, manual.stats.max], [0, 3, 4]);
});

test('a copy row that kept only the source number links to the order the product page found for it', () => {
  const current = basis.productCostBasis(ROSES_DISPLAY);
  /* Product 309 of the screen check: a copy of a copy, so its COPY row has the number but no order id. */
  const entries = [
    row({ appliedAt: '2026-10-15T09:00:00Z', landedUnitEur: 31.2, previousLandedUnitEur: null, kind: 'COPY', purchaseOrderId: null,
      source: 'PO-2026-014', quantity: null }),
    row({ appliedAt: '2026-05-01T09:00:00Z', landedUnitEur: 30, previousLandedUnitEur: null, kind: 'SEED', purchaseOrderId: null,
      source: 'PO-2026-003', appliedBy: 'system', quantity: null }),
  ];
  const link = { id: 14, text: 'PO-2026-014' };
  const view = history.costHistoryView(entries, current, null, link);
  /* The header reads rows[0]: the Bron tile's link is back, in the sheet it now opens. */
  assert.equal(view.rows[0].linkId, 14);
  assert.equal(view.rows[0].name, 'PO-2026-014');
  assert.equal(view.rows[0].gone, false);
  assert.equal(view.rows[1].linkId, null, 'another source text is another order');
  assert.equal(history.costHistoryView(entries, current).rows[0].linkId, null, 'without the order found, no link');
  assert.equal(history.costHistoryView(entries, current, 14, link).rows[0].linkId, null, 'never a link to the order the sheet came from');
  /* Spaces around the stored number do not matter. */
  const spaced = history.costHistoryView([{ ...entries[0], source: ' PO-2026-014 ' }], current, null, { id: 14, text: 'PO-2026-014 ' });
  assert.equal(spaced.rows[0].linkId, 14);
  /* A row with an order id keeps its own, even when it names the product's source. */
  const own = history.costHistoryView([row({ purchaseOrderId: 9, source: 'PO-2026-014', containerGone: true })], current, null, link);
  assert.deepEqual([own.rows[0].linkId, own.rows[0].gone], [null, true]);
  const live = history.costHistoryView([row({ purchaseOrderId: 9, source: 'PO-2026-014' })], current, null, link);
  assert.equal(live.rows[0].linkId, 9);
});

test('a copy row that kept only the number and a later apply of that container are one container', () => {
  const current = basis.productCostBasis(ROSES_DISPLAY);
  /* Product 309 after applying PO-2026-014 ("Najaar 2026"): its COPY row kept the number, not the order id. */
  const entries = [
    row({ appliedAt: '2026-10-16T09:00:00Z', landedUnitEur: 31, previousLandedUnitEur: 31.2, kind: 'APPLY', purchaseOrderId: 14,
      source: 'PO-2026-014', containerName: 'Najaar 2026', salesUnit: 'DISPLAY', piecesPerUnit: 12, unitKey: 'roos' }),
    row({ appliedAt: '2026-10-15T09:00:00Z', landedUnitEur: 31.2, previousLandedUnitEur: null, kind: 'COPY', purchaseOrderId: null,
      source: 'PO-2026-014', quantity: null, salesUnit: 'DISPLAY', piecesPerUnit: 12, unitKey: 'roos' }),
  ];
  for (const link of [{ id: 14, text: 'PO-2026-014' }, null]) {
    /* With the product page's source order, and without it (the Kostprijzen toepassen sheet): the APPLY row names the order. */
    const view = history.costHistoryView(entries, current, null, link);
    assert.equal(view.containers, 1, 'one container, not two');
    assert.deepEqual(plain(view.rows.map((r) => r.orderId)), [14, 14]);
    assert.deepEqual(plain(view.rows.map((r) => r.linkId)), [14, 14]);
    /* The copy row reads the container's Herkenbare naam too, with the number beside it. */
    assert.deepEqual(plain(view.rows.map((r) => [r.name, r.numberHint])), [['Najaar 2026', 'PO-2026-014'], ['Najaar 2026', 'PO-2026-014']]);
    /* Like a re-apply, the container counts with its newest cost; the copied one stays in the list. */
    assert.deepEqual(plain(view.stats), { min: 31, max: 31, avg: 31 });
    assert.equal(view.replaced, 1);
    assert.deepEqual(plain(view.chart), { dates: ['2026-10-16'], values: [31] });
    /* The cost before came from this same container. */
    assert.equal(view.rows[0].delta.tone, 'down');
    assert.equal(view.rows[0].against, 'eerder bij deze container');
  }
  /* Opened from that container: neither row links back to it. */
  assert.deepEqual(plain(history.costHistoryView(entries, current, 14).rows.map((r) => r.linkId)), [null, null]);
  /* A trashed container: the copy row is gone with it. */
  const trashed = history.costHistoryView([{ ...entries[0], containerGone: true }, entries[1]], current);
  assert.deepEqual(plain(trashed.rows.map((r) => [r.linkId, r.gone])), [[null, true], [null, true]]);
  assert.equal(trashed.containers, 1);
  /* A cost changed by hand in between: the cost before is not this container's, so it reads "de vorige container". */
  const edited = history.costHistoryView([{ ...entries[0], previousLandedUnitEur: 33, deltaEur: -2, deltaPct: -6.1 }, entries[1]], current);
  assert.equal(edited.rows[0].against, 'de vorige container');
  /* Another number is another container. */
  const other = history.costHistoryView([entries[0], { ...entries[1], source: 'PO-2026-011' }], current);
  assert.equal(other.containers, 2);
  assert.deepEqual(plain(other.rows.map((r) => r.orderId)), [14, null]);
  assert.equal(other.rows[0].against, 'de vorige container');
});

test('an empty history of a product with a cost never says it has no cost from a container', () => {
  const link = { id: 14, text: 'PO-2026-014' };
  /* Product 310: a cost from PO-2026-014, no rows yet. */
  assert.deepEqual(plain(history.emptyCostHistory({ landedCostEur: 8.8667, landedCostSource: 'PO-2026-014' }, link)),
    { heading: 'Nog geen historiek voor deze kostprijs', source: { text: 'PO-2026-014', id: 14 } });
  /* The order not found (or the editor, which looks none up): the source as text. */
  assert.deepEqual(plain(history.emptyCostHistory({ landedCostEur: 8.8667, landedCostSource: 'PO-2026-014' })),
    { heading: 'Nog geen historiek voor deze kostprijs', source: { text: 'PO-2026-014', id: null } });
  /* Opened from that very order: no link back to it. */
  assert.deepEqual(plain(history.emptyCostHistory({ landedCostEur: 8.8667, landedCostSource: 'PO-2026-014' }, link, 14)),
    { heading: 'Nog geen historiek voor deze kostprijs', source: { text: 'PO-2026-014', id: null } });
  /* A cost without a source still has a cost. */
  assert.deepEqual(plain(history.emptyCostHistory({ landedCostEur: 3.1, landedCostSource: null })),
    { heading: 'Nog geen historiek voor deze kostprijs', source: null });
  /* No cost at all: the old sentence. */
  for (const product of [{ landedCostEur: null, landedCostSource: null }, { landedCostSource: '  ' }, {}, null]) {
    assert.deepEqual(plain(history.emptyCostHistory(product)), { heading: 'Nog geen kostprijs uit een container', source: null });
  }
});

/* ---- the screens: one way in from everywhere, the templates parse ----- */

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');
const templateOf = (text: string) => /template:\s*`([\s\S]*?)`,\s*(?:styles|styleUrl):/.exec(text)?.[1] ?? '';

test('the history component and its sheet parse, and the history never says "st" or "set"', async () => {
  const component = await read('../src/app/features/products/product-cost-history.ts');
  const sheet = await read('../src/app/features/products/product-cost-history-sheet.ts');
  for (const [name, text] of [['history', component], ['sheet', sheet]] as const) {
    assert.equal(parseTemplate(templateOf(text), `${name}.html`).errors, null, name);
  }
  assert.doesNotMatch(templateOf(component), /\bst\b|\bset\b|PctPipe|pct:/);
  assert.doesNotMatch(component, /'system'/, 'the system check lives in the model');
  assert.match(component, /catalog\.unitNames\(\)/);
  assert.match(sheet, /title="Kostprijshistoriek"/);
  /* The subtitle names the variant, so the colours of one series never read alike. */
  assert.match(sheet, /\{\{ title\(\)\.name \}\}@if \(title\(\)\.variant; as variant\) \{<span> · \{\{ variant \}\}<\/span>\}/);
  assert.match(component, /duurder dan \{\{ now\.against \}\}/);
  assert.match(component, /@if \(replaced\(\); as note\)/);
  /* The source order reaches the rows (the header links rows[0]) and the empty state words itself from the product. */
  assert.match(component, /costHistoryView\(this\.entries\(\), productCostBasis\(this\.product\(\)\), this\.currentOrderId\(\), this\.sourceLink\(\)\)/);
  assert.match(component, /emptyCostHistory\(this\.product\(\), this\.sourceLink\(\), this\.currentOrderId\(\)\)/);
  assert.match(templateOf(component), /<b>\{\{ empty\.heading \}\}<\/b>/);
  assert.doesNotMatch(templateOf(component), /Nog geen kostprijs uit een container/, 'the heading comes from the model');
  assert.match(templateOf(component), /@if \(now\.linkId\) \{<a \[routerLink\]="\['\/purchasing', now\.linkId\]">/);
});

test('desk, phone and editor each open the history sheet from the cost', async () => {
  const desk = await read('../src/app/features/products/product-desk.ts');
  const view = await read('../src/app/features/products/product-view.ts');
  const editor = await read('../src/app/features/products/product-editor.ts');
  /* Desk: the Kostprijs figure of the hero strip (the whole cell, its label with a chevron) and the flow step, as buttons. */
  assert.match(desk, /<button class="pdk-kpi" type="button" \(click\)="openHistory\(\)"[^>]*>\s*<small>Kostprijs <app-icon name="chevron-right"/);
  assert.match(desk, /<button class="linklike pdk-flow__link" type="button" \(click\)="openHistory\(\)">Historiek ›<\/button>/);
  assert.equal(desk.match(/<app-product-cost-history-sheet /g)?.length, 1);
  /* Catalogusprijs and Marge keep opening the build-up. */
  assert.equal(desk.match(/\(click\)="openPriceDetail\(\)"/g)?.length, 2);
  /* Phone: the "Kostprijs ›" figure of the hero and the Kostprijs cell of Prijs & marge, which also names the source (Bron). */
  assert.match(view, /<button type="button" \(click\)="openHistory\(\)">\s*<small>Kostprijs ›<\/small>/);
  assert.match(view, /<button class="ios-cell" type="button" \(click\)="openHistory\(\)">\s*<span class="ios-cell__body"><span class="ios-cell__title">Kostprijs<\/span><span class="ios-cell__sub pph-wrap">@if \(product\.landedCostSource; as source\) \{ geland · <span class="pph-nw">\{\{ source \}\}<\/span> · historiek \}/);
  assert.equal(view.match(/<app-product-cost-history-sheet /g)?.length, 1);
  assert.match(view, /openPriceInfo\(product: Product\): void \{\s*this\.priceTab\.set\('build'\);/);
  /* Editor: beside "Berekend uit", only for a saved product; no new styles there. */
  assert.match(editor, /@if \(draft\(\)\.id !== null\) \{<button class="linklike" type="button" \(click\)="costHistoryOpen\.set\(true\)">Kostprijshistoriek ›<\/button>\}/);
  assert.equal(editor.match(/<app-product-cost-history-sheet /g)?.length, 1);
  for (const [name, text] of [['desk', desk], ['view', view], ['editor', editor]] as const) {
    assert.equal(parseTemplate(templateOf(text), `${name}.html`).errors, null, name);
  }
});
