import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ROW_LONG_PRESS_MS,
  ROW_SWIPE_ACTION_PX,
  clampRowSwipeOffset,
  clampSwipeOffset,
  isRowLongPress,
  restingRowOffset,
  rowSwipeDecision,
  swipeGeometry,
  swipeRelease,
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

test('one swipe action keeps the classic geometry, more actions widen it by a button each', () => {
  assert.deepEqual(swipeGeometry(1), { rest: 76, commit: 130, max: 150 });
  assert.deepEqual(swipeGeometry(2), { rest: 152, commit: 206, max: 226 });
  assert.deepEqual(swipeGeometry(3), { rest: 228, commit: 282, max: 302 });
  assert.deepEqual(swipeGeometry(0), { rest: 0, commit: 0, max: 0 });
});

test('a multi-action row stops at the maximum of the side it moves to', () => {
  assert.equal(clampSwipeOffset(100, 2, 1), 100);
  assert.equal(clampSwipeOffset(900, 2, 1), 226);
  assert.equal(clampSwipeOffset(-900, 2, 1), -150);
  assert.equal(clampSwipeOffset(90, 0, 1), 0, 'no start actions: the row stays put');
  assert.equal(clampSwipeOffset(-90, 1, 0), 0, 'no end actions: the row stays put');
  assert.equal(clampSwipeOffset(0, 2, 2), 0);
});

test('letting go closes, reveals or commits, and only a side that allows it commits', () => {
  assert.deepEqual(swipeRelease(37, 2, 2, 'both'), { side: null, action: 'close' });
  assert.deepEqual(swipeRelease(-37, 2, 2, 'both'), { side: null, action: 'close' });
  assert.deepEqual(swipeRelease(38, 2, 2, 'both'), { side: 'start', action: 'reveal' });
  assert.deepEqual(swipeRelease(205, 2, 2, 'both'), { side: 'start', action: 'reveal' });
  assert.deepEqual(swipeRelease(206, 2, 2, 'both'), { side: 'start', action: 'commit' });
  assert.deepEqual(swipeRelease(-130, 2, 1, 'both'), { side: 'end', action: 'commit' });
  assert.deepEqual(swipeRelease(-226, 2, 2, 'start'), { side: 'end', action: 'reveal' },
    'the end side does not allow a full swipe');
  assert.deepEqual(swipeRelease(226, 2, 2, 'start'), { side: 'start', action: 'commit' });
  assert.deepEqual(swipeRelease(150, 1, 1, 'end'), { side: 'start', action: 'reveal' });
  assert.deepEqual(swipeRelease(-150, 1, 1, 'end'), { side: 'end', action: 'commit' });
});

test("'none' never commits, however far the row goes", () => {
  assert.deepEqual(swipeRelease(150, 1, 1, 'none'), { side: 'start', action: 'reveal' });
  assert.deepEqual(swipeRelease(-150, 1, 1, 'none'), { side: 'end', action: 'reveal' });
  assert.deepEqual(swipeRelease(-900, 0, 1, 'none'), { side: 'end', action: 'reveal' });
});
