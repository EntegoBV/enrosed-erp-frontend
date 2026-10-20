import type { DrillCell, DrillColumn, DrillFormat, DrillGroup, DrillLink, DrillRow, DrillTotal, DrillView } from './drill-model';

/*
 * The pure half of the Analyses drill-down (design/analyses2/design.md §A.2, §A.4): the desk column tracks, sorting
 * inside the groups, the group and total sums and the gap row that keeps the rows honest about the figure. The
 * dialog (an-drill.ts) only formats and renders what this returns.
 *
 * Pure and node-tested (tests/analyses-drill-kit.test.mts): type imports only.
 */

export type DrillSortDir = 'asc' | 'desc';
export interface DrillSort { key: string; dir: DrillSortDir }

export interface DrillTableColumn extends DrillColumn {
  /** Right-aligned: every format except text and day. */
  numeric: boolean;
  /** The desk grid track (the column's width or the A.1 default). */
  track: string;
}

export interface DrillTableSection {
  /** '' for the first, unnamed group. */
  key: string;
  group: DrillGroup | null;
  rows: DrillRow[];
  /** Σ per summed column (the valueKey column and the `sum` columns), null cells as 0. */
  sums: Readonly<Record<string, number>>;
}

export interface DrillTableTotal {
  label: string;
  /** The clicked figure itself, never the Σ of the rows. */
  value: number;
  format: DrillTotal['format'];
  /** Σ of every summed column over all rows; the figure's own column shows `value` instead. */
  sums: Readonly<Record<string, number>>;
}

export interface DrillTableGap {
  label: string;
  /** Figure − Σ rows (or figure − row count). */
  value: number;
  format: DrillTotal['format'];
}

export interface DrillTable {
  columns: DrillTableColumn[];
  /** `--wk-cols` of the desk table. */
  tracks: string;
  sections: DrillTableSection[];
  /**
   * The column that carries the figure in group, gap and total rows: the valueKey column, else the last; '' for a
   * count without a valueKey (the label cell then says the count).
   */
  valueColumn: string;
  /** The columns whose numbers add up in group and total rows. */
  summed: string[];
  total: DrillTableTotal | null;
  /** Shown only when the rows miss the figure by € 0,50 or more (or by a row). */
  gap: DrillTableGap | null;
  rowCount: number;
}

export const DEFAULT_GAP_LABEL = 'Niet toe te wijzen';

/** Text and dates sit left; money, counts, rates and day counts right. */
export function isNumericFormat(format: DrillFormat): boolean {
  return format !== 'text' && format !== 'day';
}

/** The A.1 defaults: the first column 1.6fr, text 1fr, days and dates 84 px, money and numbers 112 px. */
export function columnTrack(column: DrillColumn, index: number): string {
  if (column.width) return column.width;
  if (index === 0) return 'minmax(0,1.6fr)';
  if (column.format === 'text') return 'minmax(0,1fr)';
  if (column.format === 'day' || column.format === 'days') return '84px';
  return '112px';
}

/** The first click on a header: numbers and days from high to low, text from A to Z. */
export function firstSortDir(column: Pick<DrillColumn, 'format'>): DrillSortDir {
  return column.format === 'text' ? 'asc' : 'desc';
}

/** The next sort after a click on `key`: a new column starts at its first direction, the same column flips. */
export function nextSort(current: DrillSort, column: Pick<DrillColumn, 'key' | 'format'>): DrillSort {
  if (current.key === column.key) return { key: column.key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key: column.key, dir: firstSortDir(column) };
}

const NAMES = new Intl.Collator('nl', { sensitivity: 'base', numeric: true });

/** Two cells in a direction; an empty cell (null, '') always sorts last. */
export function compareCells(left: DrillCell | undefined, right: DrillCell | undefined, dir: DrillSortDir): number {
  const leftEmpty = left === null || left === undefined || left === '';
  const rightEmpty = right === null || right === undefined || right === '';
  if (leftEmpty || rightEmpty) return leftEmpty === rightEmpty ? 0 : leftEmpty ? 1 : -1;
  const order = typeof left === 'number' && typeof right === 'number' ? left - right : NAMES.compare(String(left), String(right));
  return dir === 'asc' ? order : -order;
}

/** The rows in a sort; equal rows keep the order they came in (a builder's own order). */
export function sortRows(rows: readonly DrillRow[], sort: DrillSort): DrillRow[] {
  return rows.map((row, index) => ({ row, index }))
    .sort((left, right) => compareCells(left.row.cells[sort.key], right.row.cells[sort.key], sort.dir) || left.index - right.index)
    .map(({ row }) => row);
}

function numberOf(cell: DrillCell | undefined): number {
  return typeof cell === 'number' && Number.isFinite(cell) ? cell : 0;
}

/** Σ of one column over rows; null and text cells count as 0. */
export function columnSum(rows: readonly DrillRow[], key: string): number {
  return rows.reduce((sum, row) => sum + numberOf(row.cells[key]), 0);
}

/** The columns that add up: the valueKey column when the figure is a sum, and every `sum` column; never text or dates. */
export function summedColumns(view: Pick<DrillView, 'columns' | 'valueKey' | 'total'>): string[] {
  return view.columns
    .filter((column) => isNumericFormat(column.format)
      && (column.sum === true || (column.key === view.valueKey && view.total?.of !== 'rows')))
    .map((column) => column.key);
}

/**
 * The figure against its rows (rule A.4): Σ of the valueKey column for a sum, the row count for a count. Null when
 * the view has no figure.
 */
export function drillGap(view: Pick<DrillView, 'rows' | 'valueKey' | 'total' | 'gapLabel'>): DrillTableGap & { show: boolean } | null {
  const total = view.total;
  if (!total) return null;
  if (total.of === 'rows') {
    const value = total.value - view.rows.length;
    return { label: view.gapLabel || DEFAULT_GAP_LABEL, value, format: 'int', show: value !== 0 };
  }
  const value = Math.round((total.value - (view.valueKey ? columnSum(view.rows, view.valueKey) : 0)) * 100) / 100;
  return { label: view.gapLabel || DEFAULT_GAP_LABEL, value, format: total.format, show: Math.abs(value) >= 0.5 };
}

/** The desk table and the phone cells of one view in one sort: sections in group order, their sums, the gap and the total. */
export function drillTable(view: DrillView, sort: DrillSort = view.sort): DrillTable {
  const columns = view.columns.map((column, index) => ({ ...column, numeric: isNumericFormat(column.format), track: columnTrack(column, index) }));
  const summed = summedColumns(view);
  const sums = (rows: readonly DrillRow[]): Record<string, number> =>
    Object.fromEntries(summed.map((key) => [key, Math.round(columnSum(rows, key) * 100) / 100]));
  const groups = view.groups ?? [];
  const known = new Set(groups.map((group) => group.key));
  const sorted = sortRows(view.rows, sort);
  const sections: DrillTableSection[] = [];
  const loose = sorted.filter((row) => !row.group || !known.has(row.group));
  if (loose.length) sections.push({ key: '', group: null, rows: loose, sums: sums(loose) });
  for (const group of groups) {
    const rows = sorted.filter((row) => row.group === group.key);
    if (rows.length) sections.push({ key: group.key, group, rows, sums: sums(rows) });
  }
  const gap = drillGap(view);
  const total = view.total;
  return {
    columns,
    tracks: columns.map((column) => column.track).join(' '),
    sections,
    valueColumn: view.valueKey ?? (total?.of === 'rows' ? '' : view.columns.at(-1)?.key ?? ''),
    summed,
    total: total ? { label: total.label || 'Totaal', value: total.value, format: total.format, sums: sums(view.rows) } : null,
    gap: gap?.show ? { label: gap.label, value: gap.value, format: gap.format } : null,
    rowCount: view.rows.length,
  };
}

/** What a row or foot link does; the template switches on this instead of testing keys with `in`. */
export function linkKind(link: DrillLink | null | undefined): 'route' | 'href' | 'run' | null {
  if (!link) return null;
  if ('path' in link) return 'route';
  if ('href' in link) return 'href';
  return 'run' in link ? 'run' : null;
}

/** Where each column goes in a phone cell: one title, the sub cells, and the value (the valueKey column, else the 'value' column). */
export function phoneParts(view: Pick<DrillView, 'columns' | 'valueKey'>): { title: string | null; subs: string[]; value: string | null } {
  const title = view.columns.find((column) => column.phone === 'title')?.key ?? view.columns[0]?.key ?? null;
  const value = view.valueKey ?? view.columns.find((column) => column.phone === 'value')?.key ?? null;
  return { title, subs: view.columns.filter((column) => column.phone === 'sub' && column.key !== value).map((column) => column.key), value };
}
