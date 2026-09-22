import assert from 'node:assert/strict';
import test from 'node:test';
import {
  portalCartonContents,
  portalPrimaryPrice,
  portalQuantityUnit,
  portalSecondaryPrice,
  portalUnitNoun,
} from '../src/app/features/portal/portal-sales-unit.ts';

// UnitDto as the backend sends it on CustomerLine.unit / CatalogItem.unit.
const BOWL_EN = { key: 'bowl', one: 'bowl', few: 'bowls', many: 'bowls', other: 'bowls', short: 'bowls', per: 'per bowl' };
const BOWL_PL = { key: 'bowl', one: 'miseczka', few: 'miseczki', many: 'miseczek', other: 'miseczek', short: 'miseczek', per: 'za miseczkę' };
const BOWL_FR = { key: 'bowl', one: 'bol', few: 'bols', many: 'bols', other: 'bols', short: 'bols', per: 'par bol' };
const TEXT: Record<string, string> = { unitsPerCarton: '%s per carton', portalPerBox: 'per box' };
const t = (key: string) => TEXT[key] ?? key;

test('picks the plural form with the language\'s own rules', () => {
  assert.equal(portalUnitNoun(BOWL_EN, 1, 'en-GB'), 'bowl');
  assert.equal(portalUnitNoun(BOWL_EN, 16, 'en-GB'), 'bowls');
  assert.equal(portalUnitNoun(BOWL_PL, 1, 'pl-PL'), 'miseczka');
  assert.equal(portalUnitNoun(BOWL_PL, 3, 'pl-PL'), 'miseczki');
  assert.equal(portalUnitNoun(BOWL_PL, 12, 'pl-PL'), 'miseczek');
  assert.equal(portalUnitNoun(BOWL_PL, 22, 'pl-PL'), 'miseczki');
  assert.equal(portalUnitNoun(BOWL_FR, 0, 'fr-BE'), 'bol');
  assert.equal(portalUnitNoun(BOWL_FR, 2, 'fr-BE'), 'bols');
  assert.equal(portalUnitNoun(BOWL_EN, null, 'en-GB'), 'bowls');
});

test('names the quantity only for a piece basis with a server unit', () => {
  assert.equal(portalQuantityUnit({ salesUnit: 'PIECE', unit: BOWL_EN }, 16, 'en-GB'), 'bowls');
  assert.equal(portalQuantityUnit({ unit: BOWL_EN }, 1, 'en-GB'), 'bowl');
  // Displays keep their translated key; older servers send no unit.
  assert.equal(portalQuantityUnit({ salesUnit: 'DISPLAY', piecesPerDisplay: 8, unit: BOWL_EN }, 2, 'en-GB'), null);
  assert.equal(portalQuantityUnit({ salesUnit: 'PIECE' }, 16, 'en-GB'), null);
});

test('prices read "per bowl" for a piece basis and keep the display keys for sets', () => {
  assert.deepEqual(portalPrimaryPrice({ salesUnit: 'PIECE', unit: BOWL_EN, unitPrice: 5.75 }),
    { price: 5.75, labelKey: 'portalPerPiece', label: 'per bowl' });
  assert.deepEqual(portalPrimaryPrice({ salesUnit: 'PIECE', unitPrice: 5.75 }),
    { price: 5.75, labelKey: 'portalPerPiece', label: null });
  assert.deepEqual(portalPrimaryPrice({ salesUnit: 'PIECE', piecesPerDisplay: 8, unit: BOWL_EN, unitPrice: 3.95 }),
    { price: 31.6, labelKey: 'salesPricePerDisplay', label: null });
  assert.deepEqual(portalPrimaryPrice({ salesUnit: 'DISPLAY', piecesPerDisplay: 12, unit: BOWL_EN, unitPrice: 60 }),
    { price: 60, labelKey: 'salesPricePerDisplay', label: null });
  assert.equal(portalPrimaryPrice({ unit: BOWL_EN, unitPrice: null }), null);
});

test('the per-piece equivalent uses the unit and is approximate only beyond two decimals', () => {
  assert.deepEqual(portalSecondaryPrice({ salesUnit: 'DISPLAY', piecesPerDisplay: 12, unit: BOWL_EN, unitPrice: 60 }),
    { price: 5, labelKey: 'portalPerPiece', label: 'per bowl', approximate: false });
  const odd = portalSecondaryPrice({ salesUnit: 'DISPLAY', piecesPerDisplay: 3, unit: BOWL_EN, unitPrice: 10 });
  assert.equal(odd?.approximate, true);
  assert.equal(portalSecondaryPrice({ salesUnit: 'PIECE', piecesPerDisplay: 8, unitPrice: 3.95 })?.label, null);
  assert.equal(portalSecondaryPrice({ salesUnit: 'PIECE', unit: BOWL_EN, unitPrice: 3.95 }), null);
});

test('carton contents carry the unit noun, older servers keep the bare count', () => {
  assert.equal(portalCartonContents({ unit: BOWL_EN, piecesPerCarton: 40 }, t, 'en-GB'), '40 bowls per carton');
  assert.equal(portalCartonContents({ unit: BOWL_PL, piecesPerCarton: 24 }, t, 'pl-PL'), '24 miseczki per carton');
  assert.equal(portalCartonContents({ piecesPerCarton: 16 }, t, 'en-GB'), '16 per box');
  assert.equal(portalCartonContents({ salesUnit: 'DISPLAY', piecesPerDisplay: 8, unit: BOWL_EN, piecesPerCarton: 5 }, t, 'en-GB'),
    '5 per box');
  assert.equal(portalCartonContents({ piecesPerCarton: 1200 }, t, 'nl-BE'), '1.200 per box');
});
