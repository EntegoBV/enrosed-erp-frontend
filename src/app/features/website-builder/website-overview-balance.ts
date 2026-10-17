/**
 * The two columns of the desk Overzicht (critique N29, review round 1): Te
 * doen on the left; Live op de website and Recent gewijzigd on the right
 * from the first frame (Recent loads its own rows, so it never moves after
 * landing); "Websiteteksten per taal" goes under the column that leaves the
 * smaller gap. Decided once when the data has answered; never reflowed.
 * Heights are estimates in px. Pure and import-free (node-tested).
 */
export interface OverviewHeights {
  todo: number;
  live: number;
  recent: number;
  langs: number;
}

const GAP = 16;

/** 'left' when the language card under Te doen leaves the columns closer than under Recent. */
export function langsColumn(heights: OverviewHeights): 'left' | 'right' {
  const right = heights.live + GAP + heights.recent;
  const underLeft = Math.abs(heights.todo + GAP + heights.langs - right);
  const underRight = Math.abs(heights.todo - (right + GAP + heights.langs));
  return underLeft < underRight ? 'left' : 'right';
}

/** The Te doen card: head, section headings, rows (12 at most, then "Nog n tonen"); the empty state when none. */
export function todoCardHeight(rows: number, sections: number): number {
  return rows ? 48 + sections * 30 + Math.min(rows, 12) * 52 + (rows > 12 ? 40 : 0) : 190;
}
