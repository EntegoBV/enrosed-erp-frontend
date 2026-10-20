/**
 * The one Analyses drill-down (design/analyses2/design.md §A): what a click on
 * a figure opens. Types only, so the node-tested row builders import it with
 * `import type`. AnDrillHost (drill-host.ts) opens a view; AnDrill
 * (an-drill.ts) renders it at page level: a wide dialog with a kit table on
 * the desk, an iOS sheet with inset cells on the phone.
 *
 * The rule: the rows add up to the figure that was clicked. When they cannot
 * (a credit note shows no margin, a TICA day has no lines), the dialog shows
 * one muted row with `gapLabel` and the difference, never a silent mismatch.
 */

/** How the dialog writes a cell. Numbers stay numbers in the rows; only the dialog formats. */
export type DrillFormat =
  | 'text'      // as given
  | 'eur'       // € 1.234 (whole euros)
  | 'eur2'      // € 1.234,56
  | 'eur4'      // € 1,2345 (unit costs)
  | 'eurSigned' // + € 1.234 / − € 1.234 (cash in and out)
  | 'usd'       // $ 1.234
  | 'int'       // 1.234
  | 'rate'      // 7,4993 (four decimals)
  | 'pct'       // 31,2 %
  | 'day'       // 3 nov (with the year when it is not this year)
  | 'days';     // 12 d

export type DrillTone = 'ok' | 'warn' | 'danger' | 'muted';
export type DrillCell = string | number | null;

export interface DrillColumn {
  key: string;
  label: string;
  format: DrillFormat;
  /** Desk grid track. Default: 'minmax(0,1.6fr)' for the first column, 'minmax(0,1fr)' for text, '112px' for money and numbers, '84px' for days. */
  width?: string;
  /** Where the cell goes in a phone inset cell: one 'title' per view, 'sub' cells join with ' · ', the value is the view's valueKey column. */
  phone: 'title' | 'sub' | 'value' | 'none';
  /** Also summed in group and total rows (the valueKey column always is). */
  sum?: boolean;
}

/** A row or foot link: a route (an <a>, so Cmd-click opens a tab), an outside page, or an action on the screen (the PO sheet). */
export type DrillLink =
  | { path: readonly (string | number)[]; query?: Readonly<Record<string, string | number | null>> | null }
  | { href: string }
  | { run: () => void };

export interface DrillRow {
  key: string;
  cells: Readonly<Record<string, DrillCell>>;
  /** One-word pill after the title: 'Creditnota', 'Voorschot', 'TICA', 'Partner', 'Concept'. */
  pill?: string | null;
  /** Tone of the value cell. */
  tone?: DrillTone | null;
  /** Key of its group (DrillView.groups); rows without one sit in a first, unnamed group. */
  group?: string | null;
  link?: DrillLink | null;
}

export interface DrillGroup {
  key: string;
  label: string;
}

/** The figure the rows add up to: a sum of the valueKey column, or a number of rows. */
export interface DrillTotal {
  value: number;
  format: 'eur' | 'eur2' | 'eurSigned' | 'usd' | 'int';
  of: 'sum' | 'rows';
  /** Label of the total row; default 'Totaal'. */
  label?: string;
}

export interface DrillView {
  /** Stable id ('sales.revenue', 'result.month.2026-10'): node tests and the focus return use it. */
  id: string;
  /** Segment label when one click opens several views ('Per document', 'Per klant'). */
  tab?: string;
  title: string;
  /** Period and basis in one line: 'Dit jaar · 1 jan – 20 okt 2026 · excl. btw'. */
  scope: string;
  /** For a ratio or a date figure: the figure in words ('12 van 13 perfect · 92,3 %'). */
  summary?: string | null;
  /** At most one short sentence under the list. */
  note?: string | null;
  columns: readonly DrillColumn[];
  rows: readonly DrillRow[];
  /** Group order; with groups the valueKey column is the last column. */
  groups?: readonly DrillGroup[];
  /** The column the clicked figure adds up; null for a plain list. */
  valueKey: string | null;
  total: DrillTotal | null;
  /** Why the rows may differ from the total; shown only when they do (≥ € 0,50, or another row count). */
  gapLabel?: string | null;
  sort: { key: string; dir: 'asc' | 'desc' };
  /** Shown instead of the rows: 'Geen facturen in deze periode.' */
  empty: string;
  foot?: { label: string; link: DrillLink } | null;
}
