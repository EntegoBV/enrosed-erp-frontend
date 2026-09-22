import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import type { Packaging, Product, UnitName } from '../src/app/core/api/models.ts';
import * as units from '../src/app/features/products/product-sales-unit.ts';

const {
  customerUnitPreview, primarySalesPrice, productSalesUnit, rememberUnitNames, salesQuantityDetail,
  salesQuantityLabel, secondarySalesPrice, unitCount, unitName,
} = units;

// The Dutch answer of GET /api/products/unit-names (backend unit-names.csv).
const NAMES: UnitName[] = [
  { key: 'stuk', one: 'stuk', other: 'stuks', per: 'per stuk', short: 'st.' },
  { key: 'bowl', one: 'bowl', other: 'bowls', per: 'per bowl', short: 'bowls' },
  { key: 'stolp', one: 'stolp', other: 'stolpen', per: 'per stolp', short: 'stolpen' },
];

function product(packaging: Partial<Packaging> = {}, piecesPerCarton: number | null = null): Product {
  return {
    packaging: {
      kind: 'NONE', dimensions: { lengthCm: 10, widthCm: 10, heightCm: 12, weightKg: 0.4 }, barcode: null,
      piecesPerUnit: null, salesUnit: 'PIECE', ...packaging,
    },
    carton: { lengthCm: null, widthCm: null, heightCm: null, piecesPerCarton, weightKg: null },
  } as Product;
}
const bowl = (packaging: Partial<Packaging> = {}) => product({ unitKey: 'bowl', ...packaging });
const bowlDisplay = (salesUnit: 'PIECE' | 'DISPLAY') =>
  bowl({ kind: 'DISPLAY', piecesPerUnit: 8, salesUnit });

test('reads today\'s "stuk" wording until the unit list has arrived', () => {
  rememberUnitNames([]);
  const unit = productSalesUnit(bowl());
  assert.equal(unit.piece.key, 'stuk');
  assert.equal(unit.singular, 'stuk');
  assert.equal(unit.plural, 'stuks');
  assert.equal(unit.short, 'st.');
  assert.equal(unit.priceLabel, 'Stukprijs');
  assert.equal(unit.pluralLabel, 'Stuks');
});

test('a piece-basis product speaks its own unit once the names are known', () => {
  rememberUnitNames(NAMES);
  const unit = productSalesUnit(bowl());
  assert.deepEqual(
    [unit.singular, unit.plural, unit.short, unit.priceLabel, unit.pluralLabel],
    ['bowl', 'bowls', 'bowls', 'Prijs per bowl', 'Bowls'],
  );
  assert.equal(unit.isDisplay, false);
  assert.deepEqual(primarySalesPrice(bowl(), 3.95), { price: 3.95, label: 'Prijs per bowl', singular: 'bowl' });
  // Stuk keeps the exact labels of before.
  assert.equal(productSalesUnit(product()).priceLabel, 'Stukprijs');
  assert.equal(productSalesUnit(product({ unitKey: 'stuk' })).plural, 'stuks');
});

test('keys are cleaned like the server does; blank or unknown keys read as stuk', () => {
  rememberUnitNames(NAMES);
  assert.equal(unitName(' Bowl ').key, 'bowl');
  assert.equal(unitName('').key, 'stuk');
  assert.equal(unitName(null).key, 'stuk');
  assert.equal(unitName('kandelaar').key, 'stuk');
  assert.equal(productSalesUnit(product({ unitKey: 'kandelaar' })).plural, 'stuks');
  assert.equal(productSalesUnit(null).plural, 'stuks');
});

test('a display basis keeps display wording and names the pieces inside with the unit', () => {
  rememberUnitNames(NAMES);
  const unit = productSalesUnit(bowlDisplay('DISPLAY'));
  assert.deepEqual([unit.singular, unit.plural, unit.short, unit.priceLabel], ['display', 'displays', 'display', 'Displayprijs']);
  assert.equal(unit.piece.other, 'bowls');
  assert.equal(salesQuantityDetail(bowlDisplay('DISPLAY'), 0), '8 bowls per display');
  assert.equal(salesQuantityDetail(bowlDisplay('DISPLAY'), 2), '2 × 8 = 16 bowls');
  assert.equal(salesQuantityDetail(bowlDisplay('PIECE'), 16), '2 displays van 8 bowls');
  assert.equal(salesQuantityDetail(bowlDisplay('PIECE'), 8), '1 display van 8 bowls');
  assert.equal(salesQuantityDetail(bowlDisplay('PIECE'), 12), '8 bowls per display');
  assert.equal(salesQuantityDetail(bowl(), 12), null);
});

test('the per-piece equivalent uses the unit phrase', () => {
  rememberUnitNames(NAMES);
  assert.deepEqual(secondarySalesPrice(bowlDisplay('DISPLAY'), 31.6),
    { price: 3.95, label: 'per bowl', piecesPerDisplay: 8, perDisplay: '8 bowls/display' });
  assert.deepEqual(secondarySalesPrice(bowlDisplay('PIECE'), 3.95),
    { price: 3.95, label: 'per bowl', piecesPerDisplay: 8, perDisplay: '8 bowls/display' });
  assert.equal(secondarySalesPrice(bowl(), 3.95), null);
  // A set stays the primary figure for display-packaged products.
  assert.deepEqual(primarySalesPrice(bowlDisplay('PIECE'), 3.95), { price: 31.6, label: 'Setprijs', singular: 'set' });
});

test('summed quantities name the shared unit, "stuks" for a mix and neutral units with displays', () => {
  rememberUnitNames(NAMES);
  assert.equal(salesQuantityLabel([bowl(), bowl()]), 'bowls');
  assert.equal(salesQuantityLabel([bowl(), product({ unitKey: 'stolp' })]), 'stuks');
  assert.equal(salesQuantityLabel([bowl(), undefined]), 'stuks');
  assert.equal(salesQuantityLabel([bowl(), bowlDisplay('DISPLAY')]), 'verkoopeenheden');
  assert.equal(salesQuantityLabel([]), 'stuks');
});

test('counts pick the singular only for one', () => {
  rememberUnitNames(NAMES);
  const unit = productSalesUnit(product({ unitKey: 'stolp' }));
  assert.equal(unitCount(unit, 1), '1 stolp');
  assert.equal(unitCount(unit, 1200), '1.200 stolpen');
  assert.equal(unitCount(productSalesUnit(bowlDisplay('DISPLAY')), 4), '4 displays');
});

test('previews what the customer reads next to the price', () => {
  rememberUnitNames(NAMES);
  // Intl puts a no-break space after the euro sign.
  const preview = (...args: Parameters<typeof customerUnitPreview>) => customerUnitPreview(...args).replace(/\u00a0/g, ' ');
  assert.equal(preview(product({ unitKey: 'stolp' }), 8.95, 10),
    'Klant leest: € 8,95 per stolp · 10 stolpen per doos');
  assert.equal(preview(product({ unitKey: 'stolp' }), 8.95, 1),
    'Klant leest: € 8,95 per stolp · 1 stolp per doos');
  assert.equal(preview(bowl(), 0, null), 'Klant leest: prijs per bowl');
  // Display-packaged products lead with the set price, like the documents and the website.
  assert.equal(preview(bowlDisplay('PIECE'), 3.95, 40),
    'Klant leest: € 31,60 per display (8 bowls) · € 3,95 per bowl · 40 bowls per doos');
  assert.equal(preview(bowlDisplay('PIECE'), 0, 40),
    'Klant leest: prijs per display (8 bowls) · 40 bowls per doos');
  // "≈" only when the set price does not split evenly over its pieces.
  assert.equal(preview(bowlDisplay('DISPLAY'), 31.6, 5),
    'Klant leest: € 31,60 per display (8 bowls) · € 3,95 per bowl · 5 displays per doos');
  assert.equal(preview(bowlDisplay('DISPLAY'), 33.3, null),
    'Klant leest: € 33,30 per display (8 bowls) · ≈ € 4,16 per bowl');
});

// product-family-shared-fields.ts imports siblings without an extension, which
// node cannot resolve; run it through the TypeScript transpiler with the real
// unit helper and inert carton helpers instead.
const sharedSource = await readFile(new URL('../src/app/features/products/product-family-shared-fields.ts', import.meta.url), 'utf8');
const sharedModule = { exports: {} as Record<string, any> };
vm.runInNewContext(ts.transpileModule(sharedSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, {
  module: sharedModule, exports: sharedModule.exports,
  require: (id: string) => ({
    './product-sales-unit': units,
    './carton-auto': { autoPiecesPerCarton: () => null },
    './carton-capacity': { calculateGpCapacity: () => ({ value: null, source: 'UNKNOWN' }), isAutoGpCapacity: () => false },
  } as Record<string, unknown>)[id],
});
const { PRODUCT_FAMILY_SHARED_FIELD_GROUPS, productFamilySharedFieldValue } = sharedModule.exports;

test('the family PACKAGING bundle says it carries the unit and shows it', () => {
  rememberUnitNames(NAMES);
  const packaging = PRODUCT_FAMILY_SHARED_FIELD_GROUPS
    .flatMap((group: any) => group.fields).find((field: any) => field.key === 'PACKAGING');
  assert.match(packaging.summary, /eenheid/);
  assert.equal(productFamilySharedFieldValue('PACKAGING', bowl()), 'Geen verkoopverpakking · eenheid bowl');
  assert.equal(productFamilySharedFieldValue('PACKAGING', product()), 'Geen verkoopverpakking · eenheid stuk');
  assert.equal(productFamilySharedFieldValue('PACKAGING', bowlDisplay('PIECE')),
    'Display · 10 × 10 × 12 cm · 0,4 kg · 8 bowls · eenheid bowl · prijs en aantal per bowl');
  assert.match(productFamilySharedFieldValue('CARTON', { ...bowl(), carton: { ...bowl().carton, piecesPerCarton: 40 } }), / 40 bowls /);
});
