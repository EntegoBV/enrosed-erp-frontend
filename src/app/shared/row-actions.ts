/**
 * The two gestures a list row answers to, shared by the sales and purchase
 * overviews: a drag to the left reveals or commits the delete at the row's
 * end, a drag to the right the archive at its start, and a finger or mouse
 * that stays put opens the row menu. Pure arithmetic; the lists own the
 * pointer plumbing.
 */
export const ROW_SWIPE_REVEAL_PX = 38;
export const ROW_SWIPE_COMMIT_PX = 130;
export const ROW_SWIPE_MAX_PX = 150;
export const ROW_SWIPE_ACTION_PX = 76;
export const ROW_LONG_PRESS_MS = 480;
export const ROW_LONG_PRESS_SLOP_PX = 8;

/** Which action sits under the drag: the delete at the end, the archive at the start. */
export type RowSwipeSide = 'start' | 'end';

export interface RowSwipeDecision {
  side: RowSwipeSide | null;
  action: 'close' | 'reveal' | 'commit';
}

/** Keeps the row on its rail; a side without an action never moves at all. */
export function clampRowSwipeOffset(offset: number, allowStart: boolean, allowEnd: boolean): number {
  if (offset > 0) return allowStart ? Math.min(ROW_SWIPE_MAX_PX, offset) : 0;
  if (offset < 0) return allowEnd ? Math.max(-ROW_SWIPE_MAX_PX, offset) : 0;
  return 0;
}

/** Turns where the row was let go into the one thing the list should do. */
export function rowSwipeDecision(offset: number): RowSwipeDecision {
  const distance = Math.abs(offset);
  if (distance < ROW_SWIPE_REVEAL_PX) return { side: null, action: 'close' };
  const side: RowSwipeSide = offset < 0 ? 'end' : 'start';
  return { side, action: distance >= ROW_SWIPE_COMMIT_PX ? 'commit' : 'reveal' };
}

/** A press that lasted and never wandered is a request for the row menu. */
export function isRowLongPress(elapsedMs: number, movedPx: number): boolean {
  return elapsedMs >= ROW_LONG_PRESS_MS && movedPx < ROW_LONG_PRESS_SLOP_PX;
}

/** The offset a row rests at while one of its actions stays revealed. */
export function restingRowOffset(open: RowSwipeSide | null): number {
  return open === 'end' ? -ROW_SWIPE_ACTION_PX : open === 'start' ? ROW_SWIPE_ACTION_PX : 0;
}
