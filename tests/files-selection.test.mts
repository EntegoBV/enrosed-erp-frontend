import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EMPTY_SELECTION, clearSelection, clickSelect, fileKey, folderKey, moveFocus, moveSelect, parseRowKey,
  pruneSelection, rangeSelect, selectAll, toggleSelect,
} from '../src/app/features/files/files-selection.ts';

/* Two groups as shown: a folder row, then files 1-3 under "Vandaag" and 4-6 under "Gisteren". */
const ordered = [folderKey(9), fileKey(1), fileKey(2), fileKey(3), fileKey(4), fileKey(5), fileKey(6)];
const keys = (state: { selected: ReadonlySet<string> }) => [...state.selected].sort();

test('row keys tell files and folders apart', () => {
  assert.deepEqual(parseRowKey(fileKey(12)), { type: 'file', id: 12 });
  assert.deepEqual(parseRowKey(folderKey(3)), { type: 'folder', id: 3 });
  assert.equal(parseRowKey('x1'), null);
});

test('a click selects one item and resets the anchor', () => {
  let state = clickSelect(EMPTY_SELECTION, fileKey(2));
  state = toggleSelect(state, fileKey(5));
  state = clickSelect(state, fileKey(3));
  assert.deepEqual(keys(state), ['f3']);
  assert.equal(state.anchor, 'f3');
  assert.equal(state.focus, 'f3');
});

test('toggle adds and removes and moves the anchor', () => {
  let state = clickSelect(EMPTY_SELECTION, fileKey(1));
  state = toggleSelect(state, fileKey(4));
  assert.deepEqual(keys(state), ['f1', 'f4']);
  assert.equal(state.anchor, 'f4');
  state = toggleSelect(state, fileKey(1));
  assert.deepEqual(keys(state), ['f4']);
});

test('a shift range spans group boundaries forwards and backwards', () => {
  const start = clickSelect(EMPTY_SELECTION, fileKey(2));
  const forward = rangeSelect(start, ordered, fileKey(5));
  assert.deepEqual(keys(forward), ['f2', 'f3', 'f4', 'f5']);
  assert.equal(forward.anchor, 'f2');
  const backward = rangeSelect(forward, ordered, folderKey(9));
  assert.deepEqual(keys(backward), ['d9', 'f1', 'f2']);
  assert.equal(backward.anchor, 'f2');
  assert.equal(backward.focus, 'd9');
});

test('a range without an anchor is just that item', () => {
  const state = rangeSelect(EMPTY_SELECTION, ordered, fileKey(4));
  assert.deepEqual(keys(state), ['f4']);
  assert.equal(state.anchor, 'f4');
  const gone = rangeSelect({ ...EMPTY_SELECTION, anchor: fileKey(99) }, ordered, fileKey(3));
  assert.deepEqual(keys(gone), ['f3']);
});

test('list moves clamp at both ends', () => {
  assert.equal(moveFocus(ordered, null, 1), 'd9');
  assert.equal(moveFocus(ordered, null, -1), 'f6');
  assert.equal(moveFocus(ordered, 'f2', 1), 'f3');
  assert.equal(moveFocus(ordered, 'd9', -1), 'd9');
  assert.equal(moveFocus(ordered, 'f6', 1), 'f6');
  assert.equal(moveFocus([], null, 1), null);
});

test('grid moves by a row of 4 and never wanders off', () => {
  /* 0 1 2 3 / 4 5 6 */
  assert.equal(moveFocus(ordered, 'f1', 4), 'f5', 'down');
  assert.equal(moveFocus(ordered, 'f5', -4), 'f1', 'up');
  assert.equal(moveFocus(ordered, 'f2', 1, 4), 'f3', 'right');
  assert.equal(moveFocus(ordered, 'f2', -1, 4), 'f1', 'left');
  assert.equal(moveFocus(ordered, 'f1', -4, 4), 'f1', 'up from the top row stays');
  assert.equal(moveFocus(ordered, 'f3', 4, 4), 'f6', 'down past the end drops to the last item on the row below');
  assert.equal(moveFocus(ordered, 'f5', 4, 4), 'f5', 'down from the last row stays');
  assert.equal(moveFocus(ordered, 'f6', 1, 4), 'f6', 'right at the end stays');
});

test('arrow selection follows the focus; shift extends from the anchor', () => {
  let state = clickSelect(EMPTY_SELECTION, fileKey(2));
  state = moveSelect(state, ordered, 1, false);
  assert.deepEqual(keys(state), ['f3']);
  state = moveSelect(state, ordered, 1, true);
  state = moveSelect(state, ordered, 1, true);
  assert.deepEqual(keys(state), ['f3', 'f4', 'f5']);
  assert.equal(state.anchor, 'f3');
});

test('select all and clear', () => {
  const all = selectAll(clickSelect(EMPTY_SELECTION, fileKey(3)), ordered);
  assert.equal(all.selected.size, ordered.length);
  assert.equal(all.focus, 'f3');
  const cleared = clearSelection(all);
  assert.equal(cleared.selected.size, 0);
  assert.equal(cleared.anchor, null);
  assert.equal(cleared.focus, 'f3');
  const pruned = pruneSelection(all, [fileKey(1), fileKey(3)]);
  assert.deepEqual(keys(pruned), ['f1', 'f3']);
  assert.equal(pruneSelection(pruned, [fileKey(1), fileKey(3)]), pruned);
});
