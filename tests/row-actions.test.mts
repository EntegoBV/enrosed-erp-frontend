import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ROW_LONG_PRESS_MS,
  ROW_SWIPE_ACTION_PX,
  clampRowSwipeOffset,
  isRowLongPress,
  restingRowOffset,
  rowSwipeDecision,
} from '../src/app/shared/row-actions.ts';

test('a drag to the left reveals or commits the delete at the end of the row', () => {
  assert.deepEqual(rowSwipeDecision(-37), { side: null, action: 'close' });
  assert.deepEqual(rowSwipeDecision(-38), { side: 'end', action: 'reveal' });
  assert.deepEqual(rowSwipeDecision(-129), { side: 'end', action: 'reveal' });
  assert.deepEqual(rowSwipeDecision(-130), { side: 'end', action: 'commit' });
});

test('a drag to the right does the same for the archive at the start of the row', () => {
  assert.deepEqual(rowSwipeDecision(37), { side: null, action: 'close' });
  assert.deepEqual(rowSwipeDecision(38), { side: 'start', action: 'reveal' });
  assert.deepEqual(rowSwipeDecision(130), { side: 'start', action: 'commit' });
  assert.deepEqual(rowSwipeDecision(0), { side: null, action: 'close' });
});

test('the row only moves towards a side that has an action', () => {
  assert.equal(clampRowSwipeOffset(90, true, true), 90);
  assert.equal(clampRowSwipeOffset(900, true, true), 150);
  assert.equal(clampRowSwipeOffset(90, false, true), 0, 'nothing to archive: the row stays put');
  assert.equal(clampRowSwipeOffset(-90, true, false), 0, 'nothing to delete: the row stays put');
  assert.equal(clampRowSwipeOffset(-900, true, true), -150);
});

test('a long press is a press that lasted and never wandered', () => {
  assert.equal(isRowLongPress(ROW_LONG_PRESS_MS, 0), true);
  assert.equal(isRowLongPress(ROW_LONG_PRESS_MS - 1, 0), false);
  assert.equal(isRowLongPress(ROW_LONG_PRESS_MS + 200, 8), false, 'a finger that moved is a scroll, not a press');
});

test('a revealed action parks the row one button width to its side', () => {
  assert.equal(restingRowOffset('end'), -ROW_SWIPE_ACTION_PX);
  assert.equal(restingRowOffset('start'), ROW_SWIPE_ACTION_PX);
  assert.equal(restingRowOffset(null), 0);
});
