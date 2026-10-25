import assert from 'node:assert/strict';
import test from 'node:test';
import {
  batchFormat, eurText, unitsCount, unitsText, type UnitWords,
} from '../src/app/core/api/stock-batch-units.ts';

/* Intl writes a no-break space between € and the figure; compare with a plain space. */
const plain = (text: string) => text.replace(/[  ]/g, ' ');

const display: UnitWords = { singular: 'display', plural: 'displays' };
const piece: UnitWords = { singular: 'stuk', plural: 'stuks' };

test('unitsCount: whole units, loose pieces, zero and negatives', () => {
  assert.equal(unitsCount(1260, 12), '105');
  assert.equal(unitsCount(1264, 12), '105 + 4 los');
  assert.equal(unitsCount(4, 12), '4 los');
  assert.equal(unitsCount(0, 12), '0');
  assert.equal(unitsCount(-1264, 12), '−105 + 4 los');
  assert.equal(unitsCount(-4, 12), '−4 los');
  assert.equal(unitsCount(-24, 12), '−2');
});

test('unitsCount per piece, thousands and a unit below one piece', () => {
  assert.equal(unitsCount(380, 1), '380');
  assert.equal(unitsCount(6000, 1), '6.000');
  assert.equal(unitsCount(18000, 12), '1.500');
  assert.equal(unitsCount(7, 0), '7', 'a unit of 0 pieces counts as 1');
  assert.equal(unitsCount(-0, 12), '0');
});

test('unitsText names the unit, singular for one, loose pieces after', () => {
  assert.equal(unitsText(1260, 12, display), '105 displays');
  assert.equal(unitsText(1264, 12, display), '105 displays + 4 los');
  assert.equal(unitsText(4, 12, display), '4 los');
  assert.equal(unitsText(12, 12, display), '1 display');
  assert.equal(unitsText(16, 12, display), '1 display + 4 los');
  assert.equal(unitsText(0, 12, display), '0 displays');
  assert.equal(unitsText(-1264, 12, display), '−105 displays + 4 los');
  assert.equal(unitsText(-4, 12, display), '−4 los');
});

test('unitsText per piece', () => {
  assert.equal(unitsText(380, 1, piece), '380 stuks');
  assert.equal(unitsText(1, 1, piece), '1 stuk');
  assert.equal(unitsText(0, 1, piece), '0 stuks');
  assert.equal(unitsText(1100, 1, piece), '1.100 stuks');
  assert.equal(unitsText(-3, 1, piece), '−3 stuks');
});

test('eurText: nl-BE euro in 2, 4 or 0 digits; nothing reads as a dash', () => {
  assert.equal(plain(eurText(8.318)), '€ 8,32');
  assert.equal(plain(eurText(8.318, 2)), '€ 8,32');
  assert.equal(plain(eurText(8.318, 4)), '€ 8,3180');
  assert.equal(plain(eurText(12341.4, 0)), '€ 12.341');
  assert.equal(plain(eurText(12340.55, 2)), '€ 12.340,55');
  assert.equal(plain(eurText(0)), '€ 0,00');
  assert.equal(plain(eurText(-0.001)), '€ 0,00', 'never "€ -0,00"');
  assert.equal(plain(eurText(-2.0678, 4)), '€ -2,0678');
  assert.equal(eurText(null), '—');
  assert.equal(eurText(undefined), '—');
  assert.equal(eurText(Number.NaN), '—');
  assert.equal(eurText(null, 4), '—');
});

test('batchFormat carries the unit words into units() and the shared count/eur', () => {
  const fmt = batchFormat(display);
  assert.deepEqual(fmt.unit, display);
  assert.equal(fmt.count(1264, 12), '105 + 4 los');
  assert.equal(fmt.units(1264, 12), '105 displays + 4 los');
  assert.equal(fmt.units(12, 12), '1 display');
  assert.equal(plain(fmt.eur(8.318)), '€ 8,32');
  assert.equal(plain(fmt.eur(8.318, 4)), '€ 8,3180');
  assert.equal(plain(fmt.eur(873.39, 0)), '€ 873');
  assert.equal(fmt.eur(null), '—');
  assert.equal(batchFormat(piece).units(380, 1), '380 stuks');
});
