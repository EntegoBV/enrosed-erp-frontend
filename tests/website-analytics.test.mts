import assert from 'node:assert/strict';
import test from 'node:test';
import { deltaOf, durationLabel } from '../src/app/features/analyses/website-analytics-math.ts';

test('a delta compares with the period before and stays silent without one', () => {
  assert.deepEqual(deltaOf(120, 100), { pct: 20, direction: 'up' });
  assert.deepEqual(deltaOf(80, 100), { pct: -20, direction: 'down' });
  assert.deepEqual(deltaOf(100, 100), { pct: 0, direction: 'flat' });
  assert.equal(deltaOf(5, 0), null);
  assert.equal(deltaOf(Number.NaN, 3), null);
});

test('a session length reads as minutes and seconds', () => {
  assert.equal(durationLabel(0), '—');
  assert.equal(durationLabel(45), '45 s');
  assert.equal(durationLabel(60), '1 min');
  assert.equal(durationLabel(80.4), '1 min 20 s');
});
