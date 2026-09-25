/*
 * Selection in the workspace tables, the way a desktop mail app does it:
 * a click picks one, ⌘/Ctrl-click toggles, Shift-click spans from the
 * anchor, arrows move and Shift+arrows extend. Rows are named by key; the
 * table passes its visible order. Pure: node-tested.
 */

export interface TableSelection {
  keys: readonly string[];
  /** Where a Shift range starts. */
  anchor: string | null;
  /** The row the keyboard is on. */
  focus: string | null;
}

export const EMPTY_SELECTION: TableSelection = { keys: [], anchor: null, focus: null };

export function selectOne(key: string): TableSelection {
  return { keys: [key], anchor: key, focus: key };
}

export function toggle(selection: TableSelection, key: string): TableSelection {
  const keys = selection.keys.includes(key) ? selection.keys.filter((row) => row !== key) : [...selection.keys, key];
  return { keys, anchor: key, focus: key };
}

/** Everything between the anchor and the key, both included, in table order. */
export function selectRange(order: readonly string[], anchor: string | null, key: string): TableSelection {
  const from = anchor === null ? -1 : order.indexOf(anchor);
  const to = order.indexOf(key);
  if (from < 0 || to < 0) return selectOne(key);
  const [start, end] = from <= to ? [from, to] : [to, from];
  return { keys: order.slice(start, end + 1), anchor, focus: key };
}

/** One row up or down; extend keeps the anchor and spans to the new row. Stops at both ends. */
export function moveFocus(order: readonly string[], selection: TableSelection, delta: number, extend: boolean): TableSelection {
  if (!order.length) return selection;
  const current = selection.focus === null ? -1 : order.indexOf(selection.focus);
  const next = current < 0 ? (delta > 0 ? 0 : order.length - 1) : Math.min(order.length - 1, Math.max(0, current + delta));
  const key = order[next];
  if (!extend) return selectOne(key);
  return selectRange(order, selection.anchor ?? selection.focus ?? key, key);
}

export function selectAll(order: readonly string[], selection: TableSelection = EMPTY_SELECTION): TableSelection {
  if (!order.length) return EMPTY_SELECTION;
  const focus = selection.focus && order.includes(selection.focus) ? selection.focus : order[0];
  return { keys: [...order], anchor: order[0], focus };
}

/** Drops rows a filter hid, so bulk actions never touch what is off screen. */
export function prune(selection: TableSelection, visible: readonly string[]): TableSelection {
  const set = new Set(visible);
  const keys = selection.keys.filter((key) => set.has(key));
  return {
    keys,
    anchor: selection.anchor && set.has(selection.anchor) ? selection.anchor : null,
    focus: selection.focus && set.has(selection.focus) ? selection.focus : null,
  };
}

export type SortDirection = 'asc' | 'desc';

/** A stable sort on one column; equal values fall back to the row key, so the order never jitters. */
export function sortRows<T extends { key: string }>(rows: readonly T[], value: (row: T) => string | number | null, direction: SortDirection): T[] {
  const sign = direction === 'asc' ? 1 : -1;
  return rows.map((row, index) => ({ row, index, value: value(row) }))
    .sort((a, b) => {
      const left = a.value, right = b.value;
      let compared = 0;
      if (left === null || right === null) compared = left === right ? 0 : left === null ? 1 : -1;
      else if (typeof left === 'number' && typeof right === 'number') compared = (left - right) * sign;
      else compared = String(left).localeCompare(String(right), 'nl', { numeric: true }) * sign;
      return compared || a.row.key.localeCompare(b.row.key) || a.index - b.index;
    })
    .map(({ row }) => row);
}
