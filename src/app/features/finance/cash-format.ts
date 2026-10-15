/*
 * Money and day formats of the cash forecast (Kaslijn, Kasprognose): nl-BE,
 * a negative amount as U+2212 and a space ('− € 7.449,81'). Pure, no
 * imports, deterministic (no Intl currency spacing quirks), so the pages and
 * the node tests read the same text. finance-format.ts stays Kosten & bank's
 * own; Analyses formats through this file.
 */

const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'] as const;
const WEEKDAYS = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'] as const;
const MINUS = '−';

/** Thousands with a dot: 32365 → '32.365'. */
function grouped(whole: number): string {
  return String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function centsOf(value: number): number {
  return Math.round(value * 100);
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** '€ 32.365,27', '− € 7.449,81', '€ 0,00'; '—' without a number. */
export function eur(value: number | null | undefined): string {
  if (!finite(value)) return '—';
  const cents = centsOf(value);
  const abs = Math.abs(cents);
  const text = `€ ${grouped(Math.floor(abs / 100))},${String(abs % 100).padStart(2, '0')}`;
  return cents < 0 ? `${MINUS} ${text}` : text;
}

/** Whole euros: '€ 32.365', '− € 7.450'. */
export function eurWhole(value: number | null | undefined): string {
  if (!finite(value)) return '—';
  const whole = Math.round(Math.abs(value));
  const text = `€ ${grouped(whole)}`;
  return value < 0 && whole !== 0 ? `${MINUS} ${text}` : text;
}

/** Short amounts for the month strip: '€ 46,3k', '− € 20,4k'; under € 1.000 whole euros ('€ 640'). */
export function eurK(value: number | null | undefined): string {
  if (!finite(value)) return '—';
  const abs = Math.abs(value);
  if (Math.round(abs) < 1000) return eurWhole(value);
  const tenths = Math.round(abs / 100);
  const text = `€ ${grouped(Math.floor(tenths / 10))},${tenths % 10}k`;
  return value < 0 ? `${MINUS} ${text}` : text;
}

/** With its sign: '+ € 1.906,00', '− € 7.449,81', '€ 0,00'. */
export function signedEur(value: number | null | undefined): string {
  if (!finite(value)) return '—';
  const cents = centsOf(value);
  return cents > 0 ? `+ ${eur(value)}` : eur(value);
}

function parts(day: string): { year: number; month: number; date: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day ?? '');
  return match ? { year: Number(match[1]), month: Number(match[2]), date: Number(match[3]) } : null;
}

/** '15/10'. */
export function dayMonth(day: string | null | undefined): string {
  const p = parts(day ?? '');
  return p ? `${String(p.date).padStart(2, '0')}/${String(p.month).padStart(2, '0')}` : '';
}

/** '15 okt'. */
export function dayMon(day: string | null | undefined): string {
  const p = parts(day ?? '');
  return p ? `${p.date} ${MONTHS[p.month - 1]}` : '';
}

/** 'do 15 okt'. */
export function weekdayDayMonth(day: string | null | undefined): string {
  const p = parts(day ?? '');
  if (!p) return '';
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.date)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${p.date} ${MONTHS[p.month - 1]}`;
}

/** '15 okt 2026'. */
export function dayMonthYear(day: string | null | undefined): string {
  const p = parts(day ?? '');
  return p ? `${p.date} ${MONTHS[p.month - 1]} ${p.year}` : '';
}

/** 'okt' for '2026-10' or '2026-10-15'. */
export function monthShort(day: string | null | undefined): string {
  const month = Number((day ?? '').slice(5, 7));
  return month >= 1 && month <= 12 ? MONTHS[month - 1] : '';
}
