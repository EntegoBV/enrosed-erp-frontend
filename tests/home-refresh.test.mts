import assert from 'node:assert/strict';
import test from 'node:test';
import { FAST_MAX_AGE_MS, HOME_FETCH_KEYS, SLOW_MAX_AGE_MS, maxAgeOf, staleSources } from '../src/app/features/dashboard/home-refresh.ts';

/* Design §4 #5: a return to the home fetches only what is older than its own maximum age. */
test('a return fetches the fast sources after 20 s and the slow ones after 5 min; a call that never answered always', () => {
  const at = 1_000_000;
  const all = Object.fromEntries(HOME_FETCH_KEYS.map((key) => [key, at]));
  assert.deepEqual(staleSources(all, at + 10_000), []);
  assert.deepEqual(staleSources(all, at + FAST_MAX_AGE_MS + 1),
    ['verkoop', 'inkoop', 'kosten', 'inkomende betalingen', 'partnerfinanciering', 'planner', 'bell']);
  assert.deepEqual(staleSources(all, at + SLOW_MAX_AGE_MS + 1), [...HOME_FETCH_KEYS]);
  const { websiteproducten: _skip, ...missing } = all;
  assert.deepEqual(staleSources(missing, at + 1000), ['websiteproducten']);
  assert.deepEqual(staleSources({}, at), [...HOME_FETCH_KEYS]);
  assert.equal(maxAgeOf('klanten'), 300_000);
  assert.equal(maxAgeOf('bell'), 20_000);
});
