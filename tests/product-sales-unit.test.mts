import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import type { Packaging, Product, UnitName } from '../src/app/core/api/models.ts';
import * as units from '../src/app/features/products/product-sales-unit.ts';

const {
  basisOptionFigure, convertedPrice, convertPriceLabel, customerReading, erpReading, otherBasisPrice, packagingSummary, priceBasisChange,
  priceBasisConfirmation, priceBasisWarning, productSalesUnit, rememberUnitNames, salesQuantityDetail, salesQuantityLabel,
  salesSetupSentence, salesSetupText, unitCount, unitName,
} = units;

// The Dutch answer of GET /api/products/unit-names (backend unit-names.csv).
const NAMES: UnitName[] = [
  { key: 'stuk', one: 'stuk', other: 'stuks', per: 'per stuk', short: 'st.' },
  { key: 'bowl', one: 'bowl', other: 'bowls', per: 'per bowl', short: 'bowls' },
  { key: 'stolp', one: 'stolp', other: 'stolpen', per: 'per stolp', short: 'stolpen' },
  { key: 'diamant', one: 'diamant', other: 'diamanten', per: 'per diamant', short: 'diamanten' },
  { key: 'roos', one: 'roos', other: 'rozen', per: 'per roos', short: 'rozen' },
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
  assert.equal(otherBasisPrice(bowl(), 3.95), null, 'no display, no other side');
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
  assert.deepEqual([unit.singular, unit.plural, unit.short, unit.priceLabel], ['display', 'displays', 'display', 'Prijs per display']);
  assert.equal(unit.piece.other, 'bowls');
  assert.equal(salesQuantityDetail(bowlDisplay('DISPLAY'), 0), '8 bowls per display');
  assert.equal(salesQuantityDetail(bowlDisplay('DISPLAY'), 2), '2 × 8 = 16 bowls');
  assert.equal(salesQuantityDetail(bowlDisplay('PIECE'), 16), '2 displays van 8 bowls');
  assert.equal(salesQuantityDetail(bowlDisplay('PIECE'), 8), '1 display van 8 bowls');
  assert.equal(salesQuantityDetail(bowlDisplay('PIECE'), 12), '8 bowls per display');
  assert.equal(salesQuantityDetail(bowl(), 12), null);
});

// Intl puts a no-break space after the euro sign.
const plain = (text: string) => text.replace(/\u00a0/g, ' ');
const diamonds = (salesUnit: 'PIECE' | 'DISPLAY' = 'PIECE') =>
  product({ kind: 'DISPLAY', piecesPerUnit: 12, salesUnit, unitKey: 'diamant' });
const stemRoses = () => product({ kind: 'DISPLAY', piecesPerUnit: 12, salesUnit: 'DISPLAY', unitKey: 'roos' });

test('the word under a price names what it is for; the display side goes below it', () => {
  rememberUnitNames(NAMES);
  // DIAM-D-RD: € 2,95 per diamant in a display of 12 (the "2.95 per set" bug of 2026-10-15).
  assert.equal(productSalesUnit(diamonds()).singular, 'diamant');
  const diam = otherBasisPrice(diamonds(), 2.95)!;
  assert.deepEqual({ ...diam, price: Math.round(diam.price * 100) / 100, text: plain(diam.text) },
    { sign: '=', price: 35.4, unit: 'display', per: 'per display van 12', text: '= € 35,40 per display van 12' });
  // 12 Steelrozen: € 49,95 per display of 12 roses does not split to the cent.
  assert.equal(productSalesUnit(stemRoses()).singular, 'display');
  const roses = otherBasisPrice(stemRoses(), 49.95)!;
  assert.deepEqual({ ...roses, text: plain(roses.text) },
    { sign: '≈', price: 49.95 / 12, unit: 'roos', per: 'per roos', text: '≈ € 4,16 per roos' });
  // "≈" only when the split is not exact: € 31,60 over 8 bowls is € 3,95.
  assert.equal(plain(otherBasisPrice(bowlDisplay('DISPLAY'), 31.6)!.text), '= € 3,95 per bowl');
  assert.equal(plain(otherBasisPrice(bowlDisplay('PIECE'), 3.95)!.text), '= € 31,60 per display van 8');
  // A landed cost of four decimals times 12 is a rounded figure.
  assert.equal(plain(otherBasisPrice(diamonds(), 0.5634)!.text), '≈ € 6,76 per display van 12');
});

test('no other side without a display of two or more, or without a price', () => {
  rememberUnitNames(NAMES);
  assert.equal(otherBasisPrice(bowl(), 3.95), null);
  assert.equal(otherBasisPrice(product({ kind: 'GIFT_BOX', piecesPerUnit: 1, unitKey: 'bowl' }), 3.95), null);
  assert.equal(otherBasisPrice(bowl({ kind: 'DISPLAY', piecesPerUnit: 1 }), 3.95), null);
  assert.equal(otherBasisPrice(bowl({ kind: 'DISPLAY', piecesPerUnit: null }), 3.95), null);
  for (const price of [0, -1, null, undefined, Number.NaN]) assert.equal(otherBasisPrice(diamonds(), price), null, String(price));
  assert.equal(otherBasisPrice(null, 2.95), null);
});

test('no sales or product price helper speaks of a "set" any more', () => {
  rememberUnitNames(NAMES);
  for (const item of [diamonds(), diamonds('DISPLAY'), stemRoses(), bowlDisplay('PIECE'), bowlDisplay('DISPLAY'), bowl(), product()]) {
    const unit = productSalesUnit(item);
    const words = [
      ...Object.values(unit).filter((value) => typeof value === 'string'),
      JSON.stringify(otherBasisPrice(item, 2.95)),
      salesQuantityDetail(item, 24) ?? '',
      JSON.stringify(customerReading(item, 2.95, 12, 'PACKAGE')),
      salesSetupText(item, 'PACKAGE'),
      basisOptionFigure(item, 2.95, 'PIECE') ?? '',
      basisOptionFigure(item, 2.95, 'DISPLAY') ?? '',
      packagingSummary(item),
    ].join(' | ');
    assert.doesNotMatch(words, /\bsets?\b|setprijs/i, words);
  }
  assert.equal('primarySalesPrice' in units, false);
  assert.equal('secondarySalesPrice' in units, false);
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

const stolp = () => product({ unitKey: 'stolp' }, 10);
const carton = (item: Product, piecesPerCarton: number) => ({ ...item, carton: { ...item.carton, piecesPerCarton } }) as Product;

test('the card sentence says packaging, price basis and order step, and marks what the controls set', () => {
  rememberUnitNames(NAMES);
  const parts = salesSetupSentence(diamonds(), 'PACKAGE');
  assert.equal(parts.map((part) => part.text).join(''),
    'Je verkoopt diamanten, per 12 in een display. Je prijs geldt per diamant; de klant bestelt per display.');
  assert.deepEqual(parts.filter((part) => part.mark).map((part) => part.text), ['diamanten', 'display', 'diamant', 'display']);
  assert.equal(salesSetupText(stemRoses(), 'UNIT'),
    'Je verkoopt rozen, per 12 in een display. Je prijs geldt per display; de klant bestelt per display.');
  assert.equal(salesSetupText(stolp(), 'UNIT'), 'Je verkoopt stolpen, los. Je prijs geldt per stolp; de klant bestelt per stolp.');
  assert.equal(salesSetupText(bowl({ kind: 'GIFT_BOX', piecesPerUnit: 1 }), 'CARTON'),
    'Je verkoopt bowls, elk in een geschenkdoosje. Je prijs geldt per bowl; de klant bestelt per volle omdoos.');
  assert.equal(salesSetupText(product({ kind: 'DISPLAY', piecesPerUnit: null, unitKey: 'diamant' }), 'UNIT'),
    'Je verkoopt diamanten in een display. Je prijs geldt per diamant; de klant bestelt per diamant.');
});

test('"Zo leest de klant het" leads with the display price, like the documents and the website', () => {
  rememberUnitNames(NAMES);
  const read = (...args: Parameters<typeof customerReading>) => {
    const { main, detail } = customerReading(...args);
    return `${plain(main)} | ${plain(detail)}`;
  };
  assert.equal(read(carton(diamonds(), 12), 2.95, 12, 'PACKAGE'),
    '€ 35,40 per display van 12 diamanten | € 2,95 per diamant · bestellen per display · 12 diamanten per doos');
  assert.equal(read(carton(stemRoses(), 4), 49.95, 4, 'UNIT'),
    '€ 49,95 per display van 12 rozen | ≈ € 4,16 per roos · bestellen per display · 4 displays per doos');
  assert.equal(read(bowlDisplay('DISPLAY'), 31.6, 5, 'CARTON'),
    '€ 31,60 per display van 8 bowls | € 3,95 per bowl · bestellen per volle omdoos · 5 displays per doos');
  assert.equal(read(stolp(), 8.95, 10, 'UNIT'), '€ 8,95 per stolp | bestellen per stolp · 10 stolpen per doos');
  assert.equal(read(stolp(), 8.95, 1, 'CARTON'), '€ 8,95 per stolp | bestellen per volle omdoos · 1 stolp per doos');
  assert.equal(read(bowl({ kind: 'GIFT_BOX', piecesPerUnit: 1 }), 0, null, 'UNIT'), 'prijs per bowl | in geschenkdoosje · bestellen per bowl');
  assert.equal(read(diamonds(), 0, 12, 'PACKAGE'), 'prijs per display van 12 diamanten | bestellen per display · 12 diamanten per doos');
});

test('"Zo rekent het ERP" says what the price field, a quantity and stock count in', () => {
  rememberUnitNames(NAMES);
  const rows = (...args: Parameters<typeof erpReading>) => erpReading(...args).map((row) => `${row.label}: ${plain(row.value)}`);
  assert.deepEqual(rows(diamonds(), 2.95, 12), ['Prijsveld: € 2,95 per diamant', 'Aantal 12: = 1 display', 'Voorraad en omdoos: in diamanten']);
  assert.deepEqual(rows(stemRoses(), 49.95, 4), ['Prijsveld: € 49,95 per display', 'Aantal 1: = 12 rozen', 'Voorraad en omdoos: in displays']);
  assert.deepEqual(rows(stolp(), 8.95, 10), ['Prijsveld: € 8,95 per stolp', 'Aantal 10: = 1 omdoos', 'Voorraad en omdoos: in stolpen']);
  assert.deepEqual(rows(stolp(), 0, 1), ['Prijsveld: per stolp', 'Voorraad en omdoos: in stolpen']);
});

test('the option you are not on shows what today\'s price would mean there', () => {
  rememberUnitNames(NAMES);
  assert.equal(plain(basisOptionFigure(diamonds(), 2.95, 'DISPLAY')!), '€ 2,95 per display ≈ € 0,25 per diamant');
  assert.equal(basisOptionFigure(diamonds(), 2.95, 'PIECE'), null, 'the current option needs no figure');
  assert.equal(plain(basisOptionFigure(stemRoses(), 49.95, 'PIECE')!), '€ 49,95 per roos = € 599,40 per display');
  assert.equal(basisOptionFigure(stolp(), 8.95, 'DISPLAY'), null, 'no display');
  assert.equal(basisOptionFigure(diamonds(), 0, 'DISPLAY'), null, 'no price');
});

test('Basisgegevens keeps one line about the packaging', () => {
  rememberUnitNames(NAMES);
  assert.equal(packagingSummary(diamonds()), 'Display met 12 diamanten · prijs per diamant');
  assert.equal(packagingSummary(stemRoses()), 'Display met 12 rozen · prijs per display');
  assert.equal(packagingSummary(product({ kind: 'DISPLAY', piecesPerUnit: null, unitKey: 'diamant' })), 'Display, aantal nog in te vullen · prijs per diamant');
  assert.equal(packagingSummary(bowl({ kind: 'GIFT_BOX', piecesPerUnit: 1 })), 'Geschenkdoosje · prijs per bowl');
  assert.equal(packagingSummary(stolp()), 'Geen verpakking, los · prijs per stolp');
});

test('a saved product changing its price basis is named, and only the price can be converted', () => {
  rememberUnitNames(NAMES);
  const saved = { ...carton(diamonds(), 12), id: 45 } as Product;
  assert.equal(priceBasisChange(null, diamonds()), null, 'a new product has nothing to change');
  assert.equal(priceBasisChange(saved, saved), null);
  assert.equal(priceBasisChange(saved, { ...saved, packaging: { ...saved.packaging, unitKey: 'roos', orderStep: 'UNIT' } }), null,
    'unit and order step are words and rounding, not a basis');
  const toDisplay = priceBasisChange(saved, { ...saved, packaging: { ...saved.packaging, salesUnit: 'DISPLAY' } })!;
  assert.deepEqual(toDisplay, { to: 'DISPLAY', pieces: 12, leftDisplay: false });
  assert.equal(convertedPrice(2.95, toDisplay), 35.4);
  const roses = { ...carton(stemRoses(), 4), id: 60 } as Product;
  const toPiece = priceBasisChange(roses, { ...roses, packaging: { ...roses.packaging, salesUnit: 'PIECE' } })!;
  assert.deepEqual(toPiece, { to: 'PIECE', pieces: 12, leftDisplay: false });
  assert.equal(convertedPrice(49.95, toPiece), 4.16, 'to the cent');
  // Leaving the display while the price is per display: the server stores per piece.
  const left = priceBasisChange(roses, { ...roses, packaging: { ...roses.packaging, kind: 'NONE' } })!;
  assert.deepEqual(left, { to: 'PIECE', pieces: 12, leftDisplay: true });
  assert.equal(convertedPrice(49.95, { to: 'DISPLAY', pieces: null, leftDisplay: false }), null, 'no count, no conversion');
  assert.equal(convertedPrice(0, toDisplay), null);
  // The button's sign follows the figures around it: "≈" when it does not split to the cent.
  assert.equal(plain(convertPriceLabel(2.95, toDisplay)), 'Prijs × 12 = € 35,40 invullen');
  assert.equal(plain(convertPriceLabel(49.95, toPiece)), 'Prijs ÷ 12 ≈ € 4,16 invullen');
  assert.equal(plain(convertPriceLabel(31.6, { to: 'PIECE', pieces: 8, leftDisplay: false })), 'Prijs ÷ 8 = € 3,95 invullen');
  assert.equal(convertPriceLabel(49.95, null), '');
});

test('the warning names the numbers that are not converted', () => {
  rememberUnitNames(NAMES);
  const saved = { ...carton(diamonds(), 12), id: 45 } as Product;
  const draft = { ...saved, packaging: { ...saved.packaging, salesUnit: 'DISPLAY' } } as Product;
  assert.equal(plain(priceBasisWarning(draft, priceBasisChange(saved, draft)!, 2.95, 12)),
    'Let op: het prijsveld wordt de prijs van een volledig display. Nu € 2,95, dus ≈ € 0,25 per diamant. Voorraad, doosinhoud (12) en kostprijs worden niet omgerekend; pas ze zelf aan.');
  const roses = { ...carton(stemRoses(), 4), id: 60 } as Product;
  const perRose = { ...roses, packaging: { ...roses.packaging, salesUnit: 'PIECE' } } as Product;
  assert.equal(plain(priceBasisWarning(perRose, priceBasisChange(roses, perRose)!, 49.95, 4)),
    'Let op: het prijsveld wordt de prijs van één roos: nu € 49,95 per roos. Voorraad, doosinhoud (4) en kostprijs worden niet omgerekend; pas ze zelf aan.');
  const loose = { ...roses, packaging: { ...roses.packaging, kind: 'NONE' } } as Product;
  assert.equal(plain(priceBasisWarning(loose, priceBasisChange(roses, loose)!, 49.95, 4)),
    'Deze prijs gold per display van 12. Zonder display geldt hij per roos: nu € 49,95 per roos. Voorraad, doosinhoud (4) en kostprijs worden niet omgerekend; pas ze zelf aan.');
  assert.equal(plain(priceBasisConfirmation(saved, draft, priceBasisChange(saved, draft)!, 35.4, 12, 96)),
    'De prijs geldt dan per display van 12 in plaats van per diamant. Het prijsveld wordt € 35,40 per display. Voorraad (96), doosinhoud (12) en kostprijs worden niet omgerekend.'
    + ' Bestaande offertes houden hun bedragen, maar hun aantallen tellen voortaan in displays: 10 diamanten op een offerte worden 10 displays. Controleer open offertes.');
  assert.equal(plain(priceBasisConfirmation(roses, loose, priceBasisChange(roses, loose)!, 4.16, 4, 40)),
    'De prijs geldt dan per roos in plaats van per display van 12. Het prijsveld wordt € 4,16 per roos. Voorraad (40), doosinhoud (4) en kostprijs worden niet omgerekend.'
    + ' Bestaande offertes houden hun bedragen, maar hun aantallen tellen voortaan in rozen: 10 displays op een offerte worden 10 rozen. Controleer open offertes.');
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
const { PRODUCT_FAMILY_SHARED_FIELD_GROUPS, productFamilyPriceBasisWarnings, productFamilySharedFieldValue } = sharedModule.exports;

test('the family PACKAGING bundle says it carries the unit, the price basis and "klant bestelt per", and shows them', () => {
  rememberUnitNames(NAMES);
  const packaging = PRODUCT_FAMILY_SHARED_FIELD_GROUPS
    .flatMap((group: any) => group.fields).find((field: any) => field.key === 'PACKAGING');
  assert.match(packaging.summary, /eenheid/);
  assert.match(packaging.summary, /waarvoor de prijs geldt en per hoeveel de klant bestelt \(stuk, display of omdoos\);/);
  assert.equal(packaging.label, 'Geschenkdoosje of display', 'one word for the gift box, as on the card');
  assert.equal(productFamilySharedFieldValue('PACKAGING', bowl()), 'Geen verkoopverpakking · eenheid bowl · klant bestelt per volle omdoos');
  assert.equal(productFamilySharedFieldValue('PACKAGING', product()), 'Geen verkoopverpakking · eenheid stuk · klant bestelt per volle omdoos');
  assert.equal(productFamilySharedFieldValue('PACKAGING', product({ unitKey: 'stolp', orderStep: 'UNIT' })),
    'Geen verkoopverpakking · eenheid stolp · klant bestelt per stolp');
  assert.equal(productFamilySharedFieldValue('PACKAGING', bowlDisplay('PIECE')),
    'Display · 10 × 10 × 12 cm · 0,4 kg · 8 bowls · eenheid bowl · prijs per bowl · klant bestelt per volle omdoos');
  assert.equal(productFamilySharedFieldValue('PACKAGING', bowl({ kind: 'DISPLAY', piecesPerUnit: 8, salesUnit: 'PIECE', orderStep: 'PACKAGE' })),
    'Display · 10 × 10 × 12 cm · 0,4 kg · 8 bowls · eenheid bowl · prijs per bowl · klant bestelt per display');
  // A display basis already counts displays: "per verpakking" is one display there, worded as the unit.
  assert.match(productFamilySharedFieldValue('PACKAGING', bowl({ kind: 'DISPLAY', piecesPerUnit: 8, salesUnit: 'DISPLAY', orderStep: 'PACKAGE' })),
    / · prijs per display · klant bestelt per display$/);
  assert.match(productFamilySharedFieldValue('PACKAGING', bowl({ kind: 'GIFT_BOX', orderStep: 'PACKAGE' })), / · klant bestelt per bowl$/);
  assert.match(productFamilySharedFieldValue('CARTON', { ...bowl(), carton: { ...bowl().carton, piecesPerCarton: 40 } }), / 40 bowls /);
});

test('copying the packaging to colours on another price basis names each one, and what is not converted', () => {
  rememberUnitNames(NAMES);
  const red = { ...carton(diamonds('DISPLAY'), 12), id: 45, colour: 'Red', computedSalesPriceEur: 35.4, stockQuantity: 8 } as Product;
  const navy = { ...carton(diamonds(), 12), id: 46, colour: 'Navy', computedSalesPriceEur: 2.95, fixedSalesPriceEur: 2.95, stockQuantity: 96 } as Product;
  const white = { ...carton(diamonds('DISPLAY'), 12), id: 47, colour: 'White', computedSalesPriceEur: 35.4, stockQuantity: 4 } as Product;
  const target = (item: Product) => ({ productId: item.id!, name: 'Diamantroos', sku: null, colour: item.colour ?? null, colourHex: null, size: null, active: true });
  const targets = [navy, white].map(target);
  const all = new Set([46, 47]);
  // Spread into this realm: the module ran in a vm context with its own Array.
  const warnings = (fields: string[], ids = all) => [...productFamilyPriceBasisWarnings(red, targets, [red, navy, white], ids, new Set(fields))]
    .map((warning: { productId: number; text: string }) => ({ ...warning, text: plain(warning.text) }));
  assert.deepEqual(warnings(['PACKAGING']), [{ productId: 46,
    text: 'Navy: € 2,95 geldt dan per display van 12 in plaats van per diamant. Prijs, voorraad (96) en doosinhoud (12) worden niet omgerekend.' }],
    'White already sells per display of 12: nothing to say');
  assert.deepEqual(warnings(['PACKAGING', 'SALES_PRICE', 'CARTON']).map((warning: { text: string }) => warning.text),
    ['Navy: de prijs geldt dan per display van 12 in plaats van per diamant. Voorraad (96) wordt niet omgerekend.'],
    'a price and carton count copied along fit the new basis');
  assert.deepEqual(warnings(['SALES_PRICE']), [], 'without the packaging the basis stays');
  assert.deepEqual(warnings(['PACKAGING'], new Set([47])), [], 'only ticked colours');
  // The other way, and a display of another size on the same basis.
  const loose = { ...red, packaging: { ...red.packaging, salesUnit: 'PIECE' } } as Product;
  assert.match(plain(productFamilyPriceBasisWarnings(loose, targets, [loose, navy, white], all, new Set(['PACKAGING']))[0].text),
    /^White: € 35,40 geldt dan per diamant in plaats van per display van 12\./);
  const six = { ...white, packaging: { ...white.packaging, piecesPerUnit: 6 } } as Product;
  assert.match(plain(productFamilyPriceBasisWarnings(red, [target(six)], [red, six], new Set([47]), new Set(['PACKAGING']))[0].text),
    /^White: € 35,40 geldt dan per display van 12 in plaats van per display van 6\./);
});
