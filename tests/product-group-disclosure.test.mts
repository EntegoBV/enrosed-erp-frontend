import assert from 'node:assert/strict';
import test from 'node:test';
import { toggleProductGroup } from '../src/app/shared/product-group-disclosure.ts';

test('product groups start and reset fully collapsed', () => {
  let openGroups: ReadonlySet<string> = new Set();
  assert.deepEqual([...openGroups], []);

  openGroups = toggleProductGroup(openGroups, 'family-rose');
  assert.deepEqual([...openGroups], ['family-rose']);

  openGroups = new Set();
  assert.deepEqual([...openGroups], []);
});

test('toggling a product group returns a new state without mutating the current state', () => {
  const current: ReadonlySet<string> = new Set(['family-rose']);
  const next = toggleProductGroup(current, 'standalone-foam');

  assert.deepEqual([...current], ['family-rose']);
  assert.deepEqual([...next], ['family-rose', 'standalone-foam']);
  assert.notEqual(next, current);
});

test('toggling an open product group closes only that group', () => {
  const current: ReadonlySet<string> = new Set(['family-rose', 'standalone-foam']);
  const next = toggleProductGroup(current, 'family-rose');

  assert.deepEqual([...next], ['standalone-foam']);
});
