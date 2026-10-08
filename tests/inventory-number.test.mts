import assert from 'node:assert/strict';
import test from 'node:test';
import { decimalError, decimalText, parseDecimal } from '../src/app/features/inventory/inventory-number.ts';

test('an amount is read the Belgian way: the dot groups thousands, the comma is the decimal sign', () => {
  /* The sheet prints "Afspraak € 12.500,00": typing 12.500 is twelve thousand five hundred, never 12,5. */
  assert.equal(parseDecimal('12.500'), 12500);
  assert.equal(parseDecimal('12.500,50'), 12500.5);
  assert.equal(parseDecimal('12 500,50'), 12500.5);
  assert.equal(parseDecimal('12\u00a0500,50'), 12500.5);
  assert.equal(parseDecimal('12\u202f500,50'), 12500.5);
  assert.equal(parseDecimal('1.234.567,89'), 1234567.89);
  assert.equal(parseDecimal('12500'), 12500);
  assert.equal(parseDecimal('12500,5'), 12500.5);
  assert.equal(parseDecimal('1,5'), 1.5);
  assert.equal(parseDecimal('0,6812'), 0.6812);
  assert.equal(parseDecimal(' 2,0106 '), 2.0106);
  assert.equal(parseDecimal('0'), 0);
  assert.equal(parseDecimal('-3,5'), -3.5);
  assert.equal(parseDecimal('1.045'), 1045);
});

test('an empty field is null and anything that needs a guess is refused', () => {
  assert.equal(parseDecimal(''), null);
  assert.equal(parseDecimal('   '), null);
  for (const text of ['12.5', '12.50', '0.75', '2.1060', '1,234.50', '12,5,0', '12.500.5', '1.2345', '12 5', '1 2345', '1.234 567', '12,', ',5', '.5',
    'abc', '12e3', '€ 12', '12,5 EUR', '1..000', '--5']) {
    assert.ok(Number.isNaN(parseDecimal(text)), `"${text}" must be refused`);
    assert.match(decimalError(text) ?? '', /komma/, `"${text}" must say how to write it`);
  }
  assert.equal(decimalError(''), null);
  assert.equal(decimalError('12.500,50'), null);
  assert.equal(decimalError('12.500'), null);
});

test('a number is written as it is read back', () => {
  assert.equal(decimalText(12500, 2), '12.500,00');
  assert.equal(decimalText(12500.5, 2), '12.500,50');
  assert.equal(decimalText(450, 2), '450,00');
  assert.equal(decimalText(0.6812, 2), '0,6812');
  assert.equal(decimalText(2.5, 2), '2,50');
  assert.equal(decimalText(1045), '1.045');
  assert.equal(decimalText(104), '104');
  assert.equal(decimalText(0), '0');
  assert.equal(decimalText(1234567.89, 2), '1.234.567,89');
  assert.equal(decimalText(-3.5), '-3,5');
  assert.equal(decimalText(null), '');
  assert.equal(decimalText(undefined), '');
  for (const [value, decimals] of [[12500, 2], [0.6812, 2], [1045, 0], [1234567.89, 2], [0.1 + 0.2, 2], [2.0106, 2]] as const) {
    assert.equal(parseDecimal(decimalText(value, decimals)), Math.round(value * 10_000) / 10_000);
  }
});
