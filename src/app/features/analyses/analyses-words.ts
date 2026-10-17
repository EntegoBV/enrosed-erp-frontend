/**
 * The words of Analyses (redesign 2026-10-17): months as "mrt 2026", plurals
 * that say "1 factuur" and "5 facturen" (never "factuur/facturen"), the period
 * range "1 jan – 16 okt 2026" and short whole-euro amounts for the digest rows.
 *
 * Pure and import-free (node-tested, tests/analyses-words.test.mts): no
 * runtime import, and today is always passed in, never read from Date.
 */

export const MONTHS_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'] as const;
const WEEKDAYS_SHORT = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'] as const;

const WHOLE = new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 0 });

/** A whole number as nl-BE writes it: 84.994. */
export function wholeNumber(value: number): string {
  return WHOLE.format(Math.round(value)).replace('-', '−');
}

/** "1 factuur", "5 facturen", "1.200 stuks": the count with the right word. */
export function plural(count: number, one: string, many: string): string {
  return `${wholeNumber(count)} ${Math.round(count) === 1 ? one : many}`;
}

/** "€ 3.621", "− € 3.621": whole euros, the minus before the sign as the rest of the app writes it. */
export function eurShort(value: number): string {
  const rounded = Math.round(value);
  const text = `€ ${WHOLE.format(Math.abs(rounded))}`;
  return rounded < 0 ? `− ${text}` : text;
}

function validDay(day: string | null | undefined): day is string {
  return !!day && /^\d{4}-\d{2}-\d{2}$/.test(day);
}

/** "2026-03" → "mrt 2026"; anything else is returned as it came. */
export function monthLabel(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  const index = Number(match[2]) - 1;
  return index >= 0 && index < 12 ? `${MONTHS_SHORT[index]} ${match[1]}` : month;
}

/** "2026-03" → "mrt": the month word alone (the phone bars). */
export function monthShort(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  return index >= 0 && index < 12 ? MONTHS_SHORT[index] : month;
}

/**
 * The year band under month bars that span more than one calendar year: one
 * entry per year with its first bar (0-based) and its number of bars, so
 * "sep okt … sep okt" reads which September is which. One year: none.
 */
export function yearSpans(months: readonly string[]): { year: string; start: number; span: number }[] {
  const spans: { year: string; start: number; span: number }[] = [];
  months.forEach((month, index) => {
    const year = month.slice(0, 4);
    const last = spans[spans.length - 1];
    if (last && last.year === year) last.span += 1;
    else spans.push({ year, start: index, span: 1 });
  });
  return spans.length > 1 ? spans : [];
}

/** "2026-10-16" → "16 okt" (with the year when it differs from `year`). */
export function dayMonth(day: string, year?: string): string {
  if (!validDay(day)) return '';
  const text = `${Number(day.slice(8, 10))} ${MONTHS_SHORT[Number(day.slice(5, 7)) - 1]}`;
  return year && day.slice(0, 4) !== year ? `${text} ${day.slice(0, 4)}` : text;
}

/** "2026-10-16" → "vr 16 okt". */
export function weekdayDayMonth(day: string): string {
  if (!validDay(day)) return '';
  const weekday = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)))).getUTCDay();
  return `${WEEKDAYS_SHORT[weekday]} ${dayMonth(day)}`;
}

/** "2026-10-16" → "16 okt 2026". */
export function dayMonthYear(day: string): string {
  return validDay(day) ? `${dayMonth(day)} ${day.slice(0, 4)}` : '';
}

/**
 * A period as the tool row reads it: "1 jan – 16 okt 2026" (one year shown
 * once), "1 dec 2025 – 16 okt 2026", "vanaf 1 jan 2026", "t/m 16 okt 2026",
 * "alle jaren" without bounds.
 */
export function rangeLabel(from: string | null | undefined, to: string | null | undefined): string {
  const start = validDay(from) ? from : null;
  const end = validDay(to) ? to : null;
  if (!start && !end) return 'alle jaren';
  if (start && !end) return `vanaf ${dayMonthYear(start)}`;
  if (!start && end) return `t/m ${dayMonthYear(end)}`;
  if (start === end) return dayMonthYear(start!);
  return start!.slice(0, 4) === end!.slice(0, 4)
    ? `${dayMonth(start!)} – ${dayMonthYear(end!)}`
    : `${dayMonthYear(start!)} – ${dayMonthYear(end!)}`;
}

/** The same range without the year when it is the current one: "1 jan – 16 okt" (phone tool row). */
export function rangeLabelShort(from: string | null | undefined, to: string | null | undefined, today: string): string {
  const year = today.slice(0, 4);
  const start = validDay(from) ? from : null;
  const end = validDay(to) ? to : null;
  if (start && end && start.slice(0, 4) === year && end.slice(0, 4) === year) {
    return start === end ? dayMonth(start) : `${dayMonth(start)} – ${dayMonth(end)}`;
  }
  return rangeLabel(from, to);
}

/** Day counts: "1 dag", "7 dagen". */
export function daysLabel(days: number): string {
  return plural(days, 'dag', 'dagen');
}

/* ---------- Overzicht (design §3.2, critique B2, B5, N6, N7, N17): the digest and Aandacht rows */

/** "betaalresultaat − € 3.621" / "netto extra opbrengst € 412" (the Containerkost card's names), none without eligible containers. */
export function paymentResultLine(netResultEur: number, eligibleCount: number): string | null {
  if (eligibleCount <= 0) return null;
  return netResultEur < 0 ? `betaalresultaat ${eurShort(netResultEur)}` : `netto extra opbrengst ${eurShort(netResultEur)}`;
}

/** "Nog te betalen op 10 containers". */
export function openContainersLine(containerCount: number): string {
  return `Nog te betalen op ${plural(containerCount, 'container', 'containers')}`;
}

/**
 * The euro against the yuan and the dollar: line 1 "€ 1 = ¥ 7,4993", line 2 "euro 4,9 % zwakker tegenover de dollar (6 mnd)";
 * `short` (the phone row) says "t.o.v." so line 2 keeps to two lines at 360.
 */
export function marketLines(latestCny: number, usdChangePct: number | null, months: number, short = false): [string, string | null] {
  const yuan = `€ 1 = ¥ ${latestCny.toLocaleString('nl-BE', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
  if (usdChangePct === null || !Number.isFinite(usdChangePct)) return [yuan, null];
  const pct = Math.abs(usdChangePct).toLocaleString('nl-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const word = usdChangePct > 0 ? 'sterker' : usdChangePct < 0 ? 'zwakker' : 'even sterk';
  const against = short ? 't.o.v.' : 'tegenover';
  return [yuan, usdChangePct === 0 ? `euro even sterk ${against} de dollar (${months} mnd)` : `euro ${pct} % ${word} ${against} de dollar (${months} mnd)`];
}

/** "$ 1,1208". */
export function dollarValue(latestUsd: number): string {
  return `$ ${latestUsd.toLocaleString('nl-BE', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
}

/** "▲ 234 %", "▼ 12 %", "= 0 %"; null without a period to compare with. */
export function deltaMeta(current: number, previous: number): { text: string; tone: 'ok' | 'warn' | null } | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct > 0) return { text: `▲ ${wholeNumber(pct)} %`, tone: 'ok' };
  if (pct < 0) return { text: `▼ ${wholeNumber(Math.abs(pct))} %`, tone: 'warn' };
  return { text: '= 0 %', tone: null };
}

export interface VarianceOrderDigest {
  name: string;
  missingPieces: number;
  damagedPieces: number;
}

/** The Aandacht row of receipt variances: title by count, the one order by name, or the count with the pieces. */
export function varianceAttention(orders: readonly VarianceOrderDigest[]): { title: string; sub: string } {
  const missing = orders.reduce((sum, order) => sum + order.missingPieces, 0);
  const damaged = orders.reduce((sum, order) => sum + order.damagedPieces, 0);
  const pieces = [missing ? `${wholeNumber(missing)} st ontbreken` : '', damaged ? `${wholeNumber(damaged)} st beschadigd` : ''].filter(Boolean).join(' · ');
  if (orders.length === 0) return { title: 'Orders met ontvangstafwijkingen', sub: 'Geen tekorten of schade dit jaar' };
  if (orders.length === 1) return { title: 'Order met ontvangstafwijkingen', sub: [orders[0].name, pieces].filter(Boolean).join(' · ') };
  return { title: 'Orders met ontvangstafwijkingen', sub: [plural(orders.length, 'order', 'orders'), pieces].filter(Boolean).join(' · ') };
}

export interface AdvanceTermDigest {
  name: string;
  terms: number;
  nextDue: string | null;
}

/**
 * "Voorschottermijnen te factureren" (critique N7): "3 termijnen · volgende 30 okt";
 * with one container its name instead: "Half Heart Mix Container · volgende 30 okt".
 */
export function advanceTermsSub(containers: readonly AdvanceTermDigest[], today: string): string {
  const open = containers.filter((container) => container.terms > 0);
  if (!open.length) return 'Geen geplande termijnen open';
  const next = open.map((container) => container.nextDue).filter((day): day is string => !!day).sort()[0] ?? null;
  const nextText = next ? ` · volgende ${dayMonth(next, today.slice(0, 4))}` : '';
  if (open.length === 1) return `${open[0].name}${nextText}`;
  return `${plural(open.reduce((sum, container) => sum + container.terms, 0), 'termijn', 'termijnen')}${nextText}`;
}

/** "Niets na de vervaldatum" / "1 factuur na de vervaldatum" / "3 facturen na de vervaldatum". */
export function overdueSub(count: number): string {
  return count === 0 ? 'Niets na de vervaldatum' : `${plural(count, 'factuur', 'facturen')} na de vervaldatum`;
}

/* ---------- Resultaat: margin and own costs per month as bars (design §3.6) */

export interface MonthBarInput { month: string; marginEur: number; costsEur: number; resultEur: number }
export interface MonthBar {
  month: string;
  /** Margin bar: top and height in % of the plot; negative margins hang below the zero line. */
  marginTop: number; marginHeight: number; marginNegative: boolean;
  /** Own costs hang below the zero line. */
  costTop: number; costHeight: number;
  resultEur: number;
}
export interface MonthBarsGeometry { zeroPct: number; ticks: { value: number; pct: number }[]; bars: MonthBar[] }

/** A rounded step for the axis: 1, 2 or 5 times a power of ten. */
function niceStep(span: number): number {
  if (!(span > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(span));
  const unit = span / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

/**
 * The geometry of the month bars: the top is the largest margin (or 0), the
 * bottom the deepest loss or cost month (or 0), rounded out to a nice step;
 * three ticks: top, zero, bottom (zero alone when nothing moved).
 */
export function monthBars(rows: readonly MonthBarInput[]): MonthBarsGeometry {
  const high = Math.max(0, ...rows.map((row) => row.marginEur));
  const low = Math.min(0, ...rows.map((row) => Math.min(row.marginEur, -Math.abs(row.costsEur))));
  const step = niceStep(Math.max(high, -low) / 2);
  const top = high > 0 ? Math.ceil(high / step) * step : 0;
  const bottom = low < 0 ? Math.floor(low / step) * step : 0;
  const span = top - bottom || 1;
  const pct = (value: number) => ((top - value) / span) * 100;
  const zeroPct = pct(0);
  const ticks = [...new Set([top, 0, bottom])].map((value) => ({ value, pct: pct(value) }));
  const bars = rows.map((row) => {
    const margin = row.marginEur;
    const cost = Math.abs(row.costsEur);
    return {
      month: row.month,
      marginTop: margin >= 0 ? pct(margin) : zeroPct, marginHeight: (Math.abs(margin) / span) * 100, marginNegative: margin < 0,
      costTop: zeroPct, costHeight: (cost / span) * 100,
      resultEur: row.resultEur,
    };
  });
  return { zeroPct, ticks, bars };
}
