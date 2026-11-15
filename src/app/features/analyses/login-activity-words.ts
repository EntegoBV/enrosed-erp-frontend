import type { LoginActivityKind, LoginDevice } from '../../core/api/login-request-api';
import { MONTHS_SHORT } from './analyses-words';

/**
 * The words of Bezoekers › Klantlogins and of its drill-downs: moments, lengths, what a visit did.
 * Pure and import-light (types and the month names), so the dialog (an-drill.ts) uses it too.
 */

const ZONE = 'Europe/Brussels';
const PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Year, month (1-12), day, hour and minute of an instant on the Belgian clock. */
export function belgianParts(iso: string): { year: string; month: number; day: number; hour: string; minute: string } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(PARTS.formatToParts(date).map((part) => [part.type, part.value]));
  return { year: parts['year'], month: Number(parts['month']), day: Number(parts['day']), hour: parts['hour'], minute: parts['minute'] };
}

/** "14 nov · 12:20", with the year when it is not `year` (this year by default); Belgian time. */
export function momentText(iso: string, year = String(new Date().getFullYear())): string {
  const parts = belgianParts(iso);
  if (!parts) return iso;
  const day = `${parts.day} ${MONTHS_SHORT[parts.month - 1]}${parts.year === year ? '' : ' ' + parts.year}`;
  return `${day} · ${parts.hour}:${parts.minute}`;
}

/** "vandaag 12:20", "gisteren 09:05", else "14 nov" (with the year when not this one): a compact last-seen. */
export function recentText(iso: string, now = new Date()): string {
  const parts = belgianParts(iso);
  const today = belgianParts(now.toISOString());
  if (!parts || !today) return iso;
  const dayOf = (p: { year: string; month: number; day: number }) => Date.UTC(Number(p.year), p.month - 1, p.day);
  const daysAgo = Math.round((dayOf(today) - dayOf(parts)) / 864e5);
  if (daysAgo === 0) return `vandaag ${parts.hour}:${parts.minute}`;
  if (daysAgo === 1) return `gisteren ${parts.hour}:${parts.minute}`;
  return `${parts.day} ${MONTHS_SHORT[parts.month - 1]}${parts.year === today.year ? '' : ' ' + parts.year}`;
}

/** "12:20" on the Belgian clock. */
export function clockText(iso: string): string {
  const parts = belgianParts(iso);
  return parts ? `${parts.hour}:${parts.minute}` : '';
}

/** "< 1 min" (a visit of one moment counts as one), "12 min", "1 u 05 min", "2 u". */
export function minutesText(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '—';
  if (minutes < 1) return '< 1 min';
  const whole = Math.round(minutes);
  if (whole < 60) return `${whole} min`;
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest === 0 ? `${hours} u` : `${hours} u ${String(rest).padStart(2, '0')} min`;
}

/** A length in seconds as minutesText writes it; null (not measured) reads "—". */
export function lengthText(seconds: number | null | undefined): string {
  return seconds === null || seconds === undefined ? '—' : minutesText(seconds / 60);
}

const KIND_WORDS: Partial<Record<LoginActivityKind, string>> = {
  PRICES: 'Prijzen', ORDER_PAGE: 'Bestelpagina', ORDER: 'Besteld', ORDER_CHANGE: 'Gewijzigd',
  ORDER_CANCEL: 'Geannuleerd', ORDERS: 'Bestellingen', PDF: 'PDF',
};
/** The order the "what" words stand in, most telling first. */
const KIND_ORDER: readonly LoginActivityKind[] = ['ORDER', 'ORDER_CHANGE', 'ORDER_CANCEL', 'ORDER_PAGE', 'PRICES', 'ORDERS', 'PDF'];

/** "Besteld · Bestelpagina · Prijzen": what a visit or a login did; empty when it only logged in or browsed. */
export function kindsText(kinds: readonly LoginActivityKind[], max = 3): string {
  const words = KIND_ORDER.filter((kind) => kinds.includes(kind)).map((kind) => KIND_WORDS[kind] as string);
  return words.length > max ? `${words.slice(0, max).join(' · ')} +${words.length - max}` : words.join(' · ');
}

/** The one most telling thing a visit or a login did ("Besteld" before "Prijzen"); empty when nothing stands out. */
export function mainKindText(kinds: readonly LoginActivityKind[]): string {
  const kind = KIND_ORDER.find((candidate) => kinds.includes(candidate));
  return kind ? KIND_WORDS[kind] as string : '';
}

const DEVICE_WORDS: Record<LoginDevice, string> = { MOBILE: 'Telefoon', TABLET: 'Tablet', DESKTOP: 'Computer' };

export function deviceText(device: LoginDevice | null | undefined): string {
  return device ? DEVICE_WORDS[device] ?? device : '';
}

/** How a visit began: the link, a login, or the browser that kept the login. */
export function startText(startKind: 'ACTIVATION' | 'LOGIN' | 'RETURN', history: boolean): string {
  if (startKind === 'ACTIVATION') return 'Wachtwoord gekozen';
  if (startKind === 'LOGIN') return 'Ingelogd';
  return history ? 'Gezien' : 'Teruggekomen';
}
