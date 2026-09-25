import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPTY_SELECTION, moveFocus, prune, selectAll, selectOne, selectRange, sortRows, toggle,
} from '../src/app/features/finance/finance-selection.ts';

const order = ['a', 'b', 'c', 'd', 'e'];

test('a click selects one, a toggle adds and removes, a range spans from the anchor', () => {
  assert.deepEqual(selectOne('b'), { keys: ['b'], anchor: 'b', focus: 'b' });
  const both = toggle(selectOne('b'), 'd');
  assert.deepEqual(both.keys, ['b', 'd']);
  assert.equal(both.anchor, 'd');
  assert.deepEqual(toggle(both, 'b').keys, ['d']);
  assert.deepEqual(selectRange(order, 'b', 'd'), { keys: ['b', 'c', 'd'], anchor: 'b', focus: 'd' });
  assert.deepEqual(selectRange(order, 'd', 'a').keys, ['a', 'b', 'c', 'd'], 'upwards too');
  assert.deepEqual(selectRange(order, null, 'c'), selectOne('c'), 'without an anchor a range is one row');
  assert.deepEqual(selectRange(order, 'gone', 'c'), selectOne('c'));
});

test('arrows move one row and stop at both ends; Shift extends from the anchor', () => {
  assert.deepEqual(moveFocus(order, EMPTY_SELECTION, 1, false), selectOne('a'), 'down from nothing starts at the top');
  assert.deepEqual(moveFocus(order, EMPTY_SELECTION, -1, false), selectOne('e'), 'up from nothing starts at the bottom');
  assert.deepEqual(moveFocus(order, selectOne('e'), 1, false), selectOne('e'));
  assert.deepEqual(moveFocus(order, selectOne('a'), -1, false), selectOne('a'));
  const extended = moveFocus(order, moveFocus(order, selectOne('b'), 1, true), 1, true);
  assert.deepEqual(extended, { keys: ['b', 'c', 'd'], anchor: 'b', focus: 'd' });
  assert.deepEqual(moveFocus(order, extended, -1, true).keys, ['b', 'c']);
  assert.deepEqual(moveFocus(order, selectOne('a'), -1, true).keys, ['a']);
  assert.deepEqual(moveFocus([], selectOne('a'), 1, false), selectOne('a'));
});

test('select all keeps the keyboard where it was', () => {
  assert.deepEqual(selectAll(order, selectOne('c')), { keys: order, anchor: 'a', focus: 'c' });
  assert.deepEqual(selectAll(order).focus, 'a');
  assert.deepEqual(selectAll([], selectOne('c')), EMPTY_SELECTION);
});

test('a filter prunes the selection to what is still on screen', () => {
  const selection = { keys: ['a', 'c', 'e'], anchor: 'e', focus: 'c' };
  assert.deepEqual(prune(selection, ['a', 'b', 'c']), { keys: ['a', 'c'], anchor: null, focus: 'c' });
  assert.deepEqual(prune(selection, []), EMPTY_SELECTION);
});

test('sorting is stable, ties fall back to the key, and empty values go last', () => {
  const rows = [
    { key: 'cost:3', amount: 10, name: 'b' }, { key: 'cost:1', amount: 30, name: 'a' },
    { key: 'cost:2', amount: 10, name: null }, { key: 'cost:4', amount: 20, name: 'c' },
  ];
  assert.deepEqual(sortRows(rows, (row) => row.amount, 'desc').map((row) => row.key), ['cost:1', 'cost:4', 'cost:2', 'cost:3']);
  assert.deepEqual(sortRows(rows, (row) => row.amount, 'asc').map((row) => row.key), ['cost:2', 'cost:3', 'cost:4', 'cost:1']);
  assert.deepEqual(sortRows(rows, (row) => row.name, 'asc').map((row) => row.key), ['cost:1', 'cost:3', 'cost:4', 'cost:2']);
  assert.deepEqual(sortRows(rows, (row) => row.name, 'desc').map((row) => row.key), ['cost:4', 'cost:3', 'cost:1', 'cost:2']);
});
