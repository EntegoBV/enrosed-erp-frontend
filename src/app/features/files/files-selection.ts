/**
 * The desk's selection, Finder style: a click picks one item and sets the
 * anchor, ⌘/Ctrl-click toggles, Shift-click spans from the anchor in the
 * order the rows are shown (across group rows), and the arrow keys move a
 * focus that Shift extends. Items are keys: files and folders share one
 * list, so a key says which is which. Pure and import-free: node-tested.
 */

export type RowKey = string;

export function fileKey(id: number): RowKey { return `f${id}`; }
export function folderKey(id: number): RowKey { return `d${id}`; }

export function parseRowKey(key: RowKey): { type: 'file' | 'folder'; id: number } | null {
  const match = /^([fd])(\d+)$/.exec(key);
  return match ? { type: match[1] === 'f' ? 'file' : 'folder', id: Number(match[2]) } : null;
}

export interface SelectionState {
  selected: ReadonlySet<RowKey>;
  /** Where a Shift-click range starts. */
  anchor: RowKey | null;
  /** The row the keyboard is on. */
  focus: RowKey | null;
}

export const EMPTY_SELECTION: SelectionState = { selected: new Set(), anchor: null, focus: null };

/** A plain click: only this item, and the range starts here. */
export function clickSelect(_state: SelectionState, key: RowKey): SelectionState {
  return { selected: new Set([key]), anchor: key, focus: key };
}

/** ⌘/Ctrl-click: in or out of the selection; the next range starts here. */
export function toggleSelect(state: SelectionState, key: RowKey): SelectionState {
  const selected = new Set(state.selected);
  if (selected.has(key)) selected.delete(key); else selected.add(key);
  return { selected, anchor: key, focus: key };
}

/** Shift-click: everything from the anchor to here, in the shown order. Without an anchor, just this one. */
export function rangeSelect(state: SelectionState, ordered: readonly RowKey[], key: RowKey): SelectionState {
  const from = state.anchor === null ? -1 : ordered.indexOf(state.anchor);
  const to = ordered.indexOf(key);
  if (from < 0 || to < 0) return clickSelect(state, key);
  const [start, end] = from <= to ? [from, to] : [to, from];
  return { selected: new Set(ordered.slice(start, end + 1)), anchor: state.anchor, focus: key };
}

/**
 * The key the focus lands on after an arrow press. A list moves by one; a
 * grid moves by one sideways and by a row (columns) up or down. The focus
 * never leaves the list: past the top it stays, past the bottom it drops to
 * the last item only when that sits on a lower row.
 */
export function moveFocus(ordered: readonly RowKey[], focus: RowKey | null, delta: number, columns = 1): RowKey | null {
  if (!ordered.length) return null;
  const index = focus === null ? -1 : ordered.indexOf(focus);
  if (index < 0) return delta > 0 ? ordered[0] : ordered[ordered.length - 1];
  const next = index + delta;
  if (next < 0) return ordered[index];
  if (next >= ordered.length) {
    const vertical = Math.abs(delta) > 1 && columns > 1;
    const lastRow = Math.floor((ordered.length - 1) / columns);
    return vertical && lastRow > Math.floor(index / columns) ? ordered[ordered.length - 1] : ordered[index];
  }
  return ordered[next];
}

/** An arrow press: move and select that one, or with Shift extend the range from the anchor. */
export function moveSelect(state: SelectionState, ordered: readonly RowKey[], delta: number, extend: boolean, columns = 1): SelectionState {
  const focus = moveFocus(ordered, state.focus, delta, columns);
  if (focus === null) return state;
  if (!extend) return clickSelect(state, focus);
  const anchored = state.anchor ?? state.focus ?? focus;
  return rangeSelect({ ...state, anchor: anchored }, ordered, focus);
}

/** ⌘/Ctrl-A: every row that is shown. */
export function selectAll(state: SelectionState, ordered: readonly RowKey[]): SelectionState {
  return { selected: new Set(ordered), anchor: ordered[0] ?? null, focus: state.focus ?? ordered[0] ?? null };
}

/** Nothing selected; the keyboard keeps its place. */
export function clearSelection(state: SelectionState): SelectionState {
  return { selected: new Set(), anchor: null, focus: state.focus };
}

/** Drops keys that are no longer shown (after a reload or a filter). */
export function pruneSelection(state: SelectionState, ordered: readonly RowKey[]): SelectionState {
  const visible = new Set(ordered);
  const selected = new Set([...state.selected].filter((key) => visible.has(key)));
  if (selected.size === state.selected.size && (state.anchor === null || visible.has(state.anchor))
    && (state.focus === null || visible.has(state.focus))) return state;
  return {
    selected,
    anchor: state.anchor !== null && visible.has(state.anchor) ? state.anchor : null,
    focus: state.focus !== null && visible.has(state.focus) ? state.focus : null,
  };
}
