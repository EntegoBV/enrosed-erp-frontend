import assert from 'node:assert/strict';
import test from 'node:test';
import { cartonQuantityNotice } from '../src/app/shared/carton-quantity-notice.ts';

test('shows the next full outer carton below one carton', () => {
  assert.equal(
    cartonQuantityNotice(5, 6),
    'Geen volle omdoos (6/doos) · 1 stuk meer = 6.',
  );
});

test('shows both neighbouring full-carton quantities above one carton', () => {
  assert.equal(
    cartonQuantityNotice(7, 6),
    'Geen volle omdoos (6/doos) · 1 stuk minder = 6, of 5 stuks meer = 12.',
  );
  assert.equal(
    cartonQuantityNotice(17, 6),
    'Geen volle omdoos (6/doos) · 5 stuks minder = 12, of 1 stuk meer = 18.',
  );
});

test('stays silent for a full carton or unusable input', () => {
  assert.equal(cartonQuantityNotice(12, 6), null);
  assert.equal(cartonQuantityNotice(0, 6), null);
  assert.equal(cartonQuantityNotice(-1, 6), null);
  assert.equal(cartonQuantityNotice(5.5, 6), null);
  assert.equal(cartonQuantityNotice(5, null), null);
  assert.equal(cartonQuantityNotice(5, 0), null);
  assert.equal(cartonQuantityNotice(5, 1), null);
  assert.equal(cartonQuantityNotice(5, 2.5), null);
});
