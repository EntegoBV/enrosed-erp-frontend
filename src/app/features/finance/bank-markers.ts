/*
 * Links between money that left and the bank. A payment on a cost and a
 * container payment link hard to their bank line (the server sets the id);
 * older lines written by "Betaald zetten" carry a marker in their reference
 * instead: "kost #123", "kostbetaling #7", "containerbetaling #456". The hard
 * link wins, then the marker, then the ±7-day amount match; all three only
 * drive hints and link chips, never money maths. Pure: node-tested.
 */

export type MarkerKind = 'kost' | 'kostbetaling' | 'containerbetaling';

export interface BankMarker {
  kind: MarkerKind;
  id: number;
}

/** The text a bank line carries in its reference. */
export function bankMarker(kind: MarkerKind, id: number): string {
  return `${kind} #${id}`;
}

const MARKER = /\b(kost|kostbetaling|containerbetaling) #(\d+)\b/gi;

/** The markers per bank line id; lines without one are left out. */
export function lineMarkers(lines: readonly { id: number; reference: string | null }[]): Map<number, BankMarker[]> {
  const map = new Map<number, BankMarker[]>();
  for (const line of lines) {
    const found: BankMarker[] = [];
    for (const match of (line.reference ?? '').matchAll(MARKER)) {
      found.push({ kind: match[1].toLowerCase() as MarkerKind, id: Number(match[2]) });
    }
    if (found.length) map.set(line.id, found);
  }
  return map;
}

/** A paid row that should have left the bank. */
export interface OutgoingRow {
  kind: MarkerKind;
  id: number;
  paidOn: string | null;
  /** Positive: the amount of the payment, the EUR paid for container payments. */
  amountEur: number;
  /** The bank line the server linked this payment to; it matches without any amount or date check. */
  linkedLineId: number | null;
  /** A cost's only payment also answers to the older "kost #<costId>" marker of lines written before payments existed. */
  legacyCostId?: number | null;
}

export interface BankLineLike {
  id: number;
  amountEur: number;
  bookedAt: string;
  timeZone: string;
  reference: string | null;
}

export const MATCH_WINDOW_DAYS = 7;

function localDay(instant: string, timeZone: string): string {
  if (!Number.isFinite(Date.parse(instant))) return '';
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(instant));
    const part = (type: string) => parts.find((row) => row.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch { return instant.slice(0, 10); }
}

function dayDistance(a: string, b: string): number {
  return Math.abs(Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000));
}

const cents = (value: number): number => Math.round(value * 100);

/**
 * Which bank line accounts for each paid row. A row is on the bank when a
 * line carries its hard link, when an outgoing line carries its marker, or
 * else when an unmarked outgoing line has the same cents on a local day
 * within ±7 days of the payment. Hard links go first, then markers, each
 * line matches once, and the closest date wins.
 */
export function matchOutgoings<T extends OutgoingRow>(rows: readonly T[], lines: readonly BankLineLike[]): Map<T, BankLineLike> {
  const matched = new Map<T, BankLineLike>();
  const paid = rows.filter((row) => !!row.paidOn && row.amountEur > 0);
  const byId = new Map(lines.map((line) => [line.id, line]));
  const outgoing = lines.filter((line) => line.amountEur < 0);
  const markers = lineMarkers(outgoing);
  const byMarker = new Map<string, BankLineLike>();
  for (const line of outgoing) {
    for (const marker of markers.get(line.id) ?? []) {
      const key = `${marker.kind}#${marker.id}`;
      if (!byMarker.has(key)) byMarker.set(key, line);
    }
  }
  const taken = new Set<number>();
  const open: T[] = [];
  for (const row of paid) {
    const linked = row.linkedLineId !== null ? byId.get(row.linkedLineId) : undefined;
    if (linked) { matched.set(row, linked); taken.add(linked.id); }
  }
  for (const row of paid) {
    if (matched.has(row)) continue;
    const line = byMarker.get(`${row.kind}#${row.id}`) ?? (row.legacyCostId ? byMarker.get(`kost#${row.legacyCostId}`) : undefined);
    if (line && !taken.has(line.id)) { matched.set(row, line); taken.add(line.id); }
    else open.push(row);
  }
  const free = outgoing.filter((line) => !markers.has(line.id) && !taken.has(line.id)).map((line) => ({ line, day: localDay(line.bookedAt, line.timeZone) }));
  const pairs: { row: number; line: number; distance: number }[] = [];
  open.forEach((row, rowIndex) => {
    free.forEach(({ line, day }, lineIndex) => {
      if (-cents(line.amountEur) !== cents(row.amountEur) || !day) return;
      const distance = dayDistance(day, row.paidOn!);
      if (distance <= MATCH_WINDOW_DAYS) pairs.push({ row: rowIndex, line: lineIndex, distance });
    });
  });
  pairs.sort((a, b) => a.distance - b.distance || a.row - b.row || free[a.line].line.id - free[b.line].line.id);
  const usedLines = new Set<number>();
  for (const pair of pairs) {
    if (matched.has(open[pair.row]) || usedLines.has(pair.line)) continue;
    matched.set(open[pair.row], free[pair.line].line);
    usedLines.add(pair.line);
  }
  return matched;
}

/**
 * The paid rows from sinceDay on (inclusive) that no outgoing bank line
 * accounts for (see matchOutgoings). Without sinceDay (no bank reading yet)
 * nothing is listed.
 */
export function unbankedOutgoings<T extends OutgoingRow>(rows: readonly T[], lines: readonly BankLineLike[], sinceDay: string | null): T[] {
  if (!sinceDay) return [];
  const candidates = rows.filter((row) => !!row.paidOn && row.paidOn >= sinceDay && row.amountEur > 0);
  const matched = matchOutgoings(candidates, lines);
  return candidates.filter((row) => !matched.has(row));
}

export const UNBANKED_WINDOW_DAYS = 90;

/**
 * From which day paid rows should show up on the bank: after the earliest
 * of the accounts' latest checks (an end-of-day reading already holds its
 * whole day, so the day after), but never further back than 90 days.
 * Without any reading there is nothing to compare with: null.
 */
export function unbankedSinceDay(checks: readonly { day: string; endOfDay: boolean }[], today: string): string | null {
  const days = checks.filter((check) => /^\d{4}-\d{2}-\d{2}$/.test(check.day))
    .map((check) => (check.endOfDay ? shiftDay(check.day, 1) : check.day));
  if (!days.length) return null;
  const earliest = days.sort()[0];
  const floor = shiftDay(today, -UNBANKED_WINDOW_DAYS);
  return earliest > floor ? earliest : floor;
}

function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
