/* Short Dutch date and money wording shared by the Kosten & bank rows. */

const DAY_MONTH = new Intl.DateTimeFormat('nl-BE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('nl-BE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const MONTH_YEAR = new Intl.DateTimeFormat('nl-BE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const WEEKDAY = new Intl.DateTimeFormat('nl-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

const asDate = (day: string): Date => new Date(`${day.slice(0, 10)}T12:00:00Z`);
const clean = (text: string): string => text.replace(/\./g, '');

/** '12 sep' */
export function dayMonth(day: string | null | undefined): string {
  return day ? clean(DAY_MONTH.format(asDate(day))) : '—';
}

/** '12 sep 2026' */
export function dayMonthYear(day: string | null | undefined): string {
  return day ? clean(DAY_MONTH_YEAR.format(asDate(day))) : '—';
}

/** 'september 2026' */
export function monthLabel(month: string): string {
  return MONTH_YEAR.format(asDate(`${month.slice(0, 7)}-01`));
}

/** 'VANDAAG', 'GISTEREN' or 'MA 21 SEP' for day-grouped phone lists. */
export function dayHeading(day: string, today: string): string {
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return 'Vandaag';
  if (diff === 1) return 'Gisteren';
  return clean(WEEKDAY.format(asDate(day)));
}

/** '14:32' in Brussels (or the entry's own zone). */
export function clockOf(instant: string, timeZone = 'Europe/Brussels'): string {
  if (!Number.isFinite(Date.parse(instant))) return '';
  try {
    return new Intl.DateTimeFormat('nl-BE', { hour: '2-digit', minute: '2-digit', timeZone }).format(new Date(instant));
  } catch { return ''; }
}

/** '+ € 1.250,50' / '− € 80,00' for signed bank amounts. */
export function signedEur(amount: number): string {
  const text = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' }).format(Math.abs(amount));
  return amount < 0 ? `− ${text}` : `+ ${text}`;
}

/** Payee tones, the same as Inkoop: Leverancier accent, Douane & transport blue, Inspectie amber, Bijkomende kosten grey. */
export const PAYEE_TONES: Readonly<Record<string, string>> = { SUPPLIER: 'accent', LOGISTICS: 'blue', SEPARATE: 'amber', OTHER: 'grey' };
