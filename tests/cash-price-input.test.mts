import assert from 'node:assert/strict';
import test from 'node:test';
import { marginFromMarkup, markupFromPriceInput, parseCashAmount } from '../src/app/features/analyses/cash-price-input.ts';

test('a requested sales margin converts to markup without confusing the two percentages', () => {
  assert.deepEqual(markupFromPriceInput('50', 'margin'), { value: 100, error: null });
  assert.deepEqual(markupFromPriceInput('50', 'markup'), { value: 50, error: null });
  assert.deepEqual(markupFromPriceInput('40', 'margin'), { value: 66.7, error: null });
  assert.ok(Math.abs(marginFromMarkup(50) - 100 / 3) < 0.000001);
  assert.equal(marginFromMarkup(100), 50);
});

test('decimal comma, trim and explicit zero are valid choices', () => {
  assert.deepEqual(markupFromPriceInput(' 37,5 ', 'markup'), { value: 37.5, error: null });
  assert.deepEqual(markupFromPriceInput('33,33', 'margin'), { value: 50, error: null });
  assert.deepEqual(parseCashAmount('2,4473'), { value: 2.4473, error: null });
  for (const basis of ['markup', 'margin'] as const) assert.deepEqual(markupFromPriceInput('0', basis), { value: 0, error: null });
  assert.deepEqual(parseCashAmount('0'), { value: 0, error: null });
});

test('an empty or malformed edit never silently becomes zero', () => {
  for (const raw of ['', ' ', '\n', '1e2', '0x20', '1.000,00', 'NaN', 'Infinity', '-1', '12abc', '1,2,3']) {
    assert.equal(parseCashAmount(raw).value, null, raw);
    assert.equal(markupFromPriceInput(raw, 'margin').value, null, raw);
    assert.equal(markupFromPriceInput(raw, 'markup').value, null, raw);
  }
});

test('limits match the saved forecast and a 100 percent margin cannot divide by zero', () => {
  assert.deepEqual(markupFromPriceInput('1000', 'markup'), { value: 1000, error: null });
  assert.equal(markupFromPriceInput('1000,1', 'markup').value, null);
  for (const raw of ['90,91', '99,9', '100', '150']) assert.equal(markupFromPriceInput(raw, 'margin').value, null, raw);
  assert.deepEqual(markupFromPriceInput('90,9', 'margin'), { value: 998.9, error: null });
  assert.deepEqual(parseCashAmount('100000'), { value: 100000, error: null });
  assert.equal(parseCashAmount('100000,01').value, null);
  assert.equal(parseCashAmount('2,12345').value, null);
});
