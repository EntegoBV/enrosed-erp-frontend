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
