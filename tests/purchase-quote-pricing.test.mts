import test from 'node:test';
import assert from 'node:assert/strict';
import { containerQuoteLineTotal, containerQuoteSubtotal, containerQuoteUnitPrice, validContainerMarkup } from '../src/app/features/purchasing/purchase-quote-pricing.ts';

test('zero markup preserves the container unit cost and quoted example total', () => {
  const unit = containerQuoteUnitPrice(2.9084, 0, 'PERCENT');
  assert.equal(unit, 2.9084);
  assert.equal(containerQuoteLineTotal(unit, 7200), 20940.48);
});

test('fixed euro markup is added per piece instead of treated as a percentage', () => {
  assert.equal(containerQuoteUnitPrice(2.9084, 0.5, 'EUR_PER_UNIT'), 3.4084);
  assert.equal(containerQuoteLineTotal(3.4084, 7200), 24540.48);
  assert.equal(containerQuoteUnitPrice(2.9084, 10, 'PERCENT'), 3.1992);
  assert.equal(containerQuoteUnitPrice(6.375, 0.0125, 'EUR_PER_UNIT'), 6.3875);
});

test('aggregate preview follows API rounding and markup validation rejects invalid or excessive precision', () => {
  assert.equal(containerQuoteLineTotal(0.0125, 2), 0.03);
  assert.equal(containerQuoteSubtotal([{ unitPrice: 0.0125, quantity: 2 }, { unitPrice: 0.0125, quantity: 2 }]), 0.05);
  assert.equal(validContainerMarkup(0, 'EUR_PER_UNIT'), true);
  assert.equal(validContainerMarkup(0.1234, 'EUR_PER_UNIT'), true);
  for (const value of [null, -1, NaN, Infinity, 0.12345]) assert.equal(validContainerMarkup(value, 'EUR_PER_UNIT'), false);
});
