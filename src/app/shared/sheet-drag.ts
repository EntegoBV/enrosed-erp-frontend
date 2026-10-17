/**
 * Drag to dismiss a phone sheet by its grab or head: the numbers behind it.
 * Pure and import-free: node-tested.
 *
 * - A drag starts only after 8 px of vertical movement, so a tap on the head
 *   (or the × in it) stays a tap (critique B13).
 * - Pulled up, the sheet follows at a third of the distance (a rubber band).
 * - Released, it closes beyond 120 px or when flicked faster than 0.6 px/ms;
 *   otherwise it springs back.
 */

export const SHEET_DRAG_START_PX = 8;
export const SHEET_DRAG_CLOSE_PX = 120;
export const SHEET_DRAG_CLOSE_VELOCITY = 0.6;
const RUBBER_BAND = 0.35;

/** True once the finger has moved far enough vertically to be a drag. */
export function sheetDragStarted(rawDy: number): boolean {
  return Math.abs(rawDy) >= SHEET_DRAG_START_PX;
}

/** Where the sheet sits for a finger offset: down 1:1, up with the rubber band. */
export function sheetDragOffset(rawDy: number): number {
  return rawDy >= 0 ? rawDy : rawDy * RUBBER_BAND;
}

/** What a release does: close, or spring back. velocity in px/ms, downwards positive. */
export function sheetDragOutcome(dy: number, velocity: number): 'close' | 'snap' {
  return dy > SHEET_DRAG_CLOSE_PX || velocity > SHEET_DRAG_CLOSE_VELOCITY ? 'close' : 'snap';
}

/** The dimmed backdrop's opacity factor while dragging (1 at rest, fading as the sheet goes down). */
export function sheetBackdropFactor(dy: number): number {
  return Math.max(0, Math.min(1, 1 - Math.max(0, dy) / 600));
}
