import type { PartnerChannel } from '../../core/api/partner-portal-api';
import type { PartnerSalesFilteredTotals, PartnerSalesState, StaffPartnerReport } from '../../core/api/partner-sales-api';
import { addDays, productTitle, searchText } from '../partner/partner-format';
import { buyerLine, costsEur, reportPieces } from '../partner/partner-report-format';

/**
 * The Veilingverkopen filters (Status, Soort, Periode) as words, URL values
 * and the server's list query, plus the sums and date lines of the table.
 * Pure; dates are calendar days (yyyy-mm-dd) as the rest of the portal.
 */

/* ---------------------------------------------------------------- status */

export type StatusChoice = 'te-bevestigen' | 'bevestigd' | 'gefactureerd' | 'ingetrokken' | 'alles';

export const STATUS_CHOICES: readonly { id: StatusChoice; label: string; state: PartnerSalesState }[] = [
  { id: 'te-bevestigen', label: 'Te bevestigen', state: 'UNCONFIRMED' },
  { id: 'bevestigd', label: 'Bevestigd', state: 'CONFIRMED' },
  { id: 'gefactureerd', label: 'Gefactureerd', state: 'INVOICED' },
  { id: 'ingetrokken', label: 'Ingetrokken', state: 'VOIDED' },
  { id: 'alles', label: 'Alles', state: 'ALL' },
];

export function parseStatus(value: string | null | undefined): StatusChoice | null {
  return STATUS_CHOICES.find((choice) => choice.id === value)?.id ?? null;
}

export function stateOf(choice: StatusChoice): PartnerSalesState {
  return STATUS_CHOICES.find((option) => option.id === choice)!.state;
}

/**
 * Where a melding stands for the filter (the server's order VOIDED > INVOICED > CONFIRMED > UNCONFIRMED): a part on
 * a document makes it confirmed, so Deels gefactureerd reads Bevestigd while something of it is still open.
 */
export function reportState(report: Pick<StaffPartnerReport, 'status' | 'confirmed'>): Exclude<PartnerSalesState, 'OPEN' | 'ALL'> {
  if (report.status === 'VOIDED') return 'VOIDED';
  if (report.status === 'INVOICED') return 'INVOICED';
  return report.confirmed || report.status === 'PARTLY_INVOICED' ? 'CONFIRMED' : 'UNCONFIRMED';
}

export function matchesState(report: Pick<StaffPartnerReport, 'status' | 'confirmed'>, state: PartnerSalesState): boolean {
  if (state === 'ALL') return true;
  const own = reportState(report);
  return state === 'OPEN' ? own === 'CONFIRMED' || own === 'UNCONFIRMED' : own === state;
}

/** The staff pill: Te bevestigen, Bevestigd, Deels gefactureerd, Gefactureerd · F-…, Ingetrokken. */
export function staffStatus(report: StaffPartnerReport, invoiceNumber: string | null): { label: string; tone: string } {
  switch (report.status) {
    case 'VOIDED': return { label: 'Ingetrokken', tone: 'tone-grey' };
    case 'INVOICED': return { label: invoiceNumber ? `Gefactureerd · ${invoiceNumber}` : 'Gefactureerd', tone: 'tone-green' };
    case 'PARTLY_INVOICED': return { label: 'Deels gefactureerd', tone: 'tone-blue' };
    default: return report.confirmed ? { label: 'Bevestigd', tone: 'tone-teal' } : { label: 'Te bevestigen', tone: 'tone-amber' };
  }
}

/* ------------------------------------------------------------------ soort */

export type ChannelChoice = 'alle' | 'veiling' | 'direct';

export const CHANNEL_CHOICES: readonly { id: ChannelChoice; label: string }[] = [
  { id: 'alle', label: 'Alle' }, { id: 'veiling', label: 'Veiling' }, { id: 'direct', label: 'Direct' },
];

export function parseChannel(value: string | null | undefined): ChannelChoice {
  return value === 'veiling' || value === 'direct' ? value : 'alle';
}

export function channelOf(choice: ChannelChoice): PartnerChannel | null {
  return choice === 'veiling' ? 'AUCTION' : choice === 'direct' ? 'DIRECT' : null;
}

/* ---------------------------------------------------------------- periode */

export type PeriodKind = 'week' | 'maand' | 'vorige-maand' | 'alles' | 'van-tot';

export interface PeriodChoice {
  kind: PeriodKind;
  /** van–tot only (yyyy-mm-dd, inclusive; either may be empty). */
  from?: string;
  to?: string;
}

export const PERIOD_CHOICES: readonly { id: Exclude<PeriodKind, 'van-tot'>; label: string }[] = [
  { id: 'week', label: 'Deze week' }, { id: 'maand', label: 'Deze maand' }, { id: 'vorige-maand', label: 'Vorige maand' },
  { id: 'alles', label: 'Alles' },
];

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "week", "maand", "vorige-maand", "alles", or "2026-11-01..2026-11-10" (either end may be empty). */
export function parsePeriod(value: string | null | undefined): PeriodChoice {
  if (value === 'week' || value === 'maand' || value === 'vorige-maand' || value === 'alles') return { kind: value };
  const match = /^(\d{4}-\d{2}-\d{2})?\.\.(\d{4}-\d{2}-\d{2})?$/.exec(value ?? '');
  if (match && (match[1] || match[2])) return { kind: 'van-tot', from: match[1] ?? '', to: match[2] ?? '' };
  return { kind: 'alles' };
}

export function periodParam(period: PeriodChoice): string | null {
  if (period.kind === 'alles') return null;
  if (period.kind !== 'van-tot') return period.kind;
  return `${period.from ?? ''}..${period.to ?? ''}`;
}

function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function monthEnd(iso: string): string {
  const [y, m] = [Number(iso.slice(0, 4)), Number(iso.slice(5, 7))];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${iso.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

/** Monday of the week of a day. */
export function weekStart(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const back = (date.getUTCDay() + 6) % 7;
  return addDays(iso, -back);
}

/** The sold_on range of a period against today (both inclusive); null ends are open. */
export function periodRange(period: PeriodChoice, today: string): { from: string | null; to: string | null } {
  switch (period.kind) {
    case 'week': return { from: weekStart(today), to: addDays(weekStart(today), 6) };
    case 'maand': return { from: monthStart(today), to: monthEnd(today) };
    case 'vorige-maand': {
      const last = addDays(monthStart(today), -1);
      return { from: monthStart(last), to: last };
    }
    case 'van-tot': {
      let from = period.from && ISO_DAY.test(period.from) ? period.from : null;
      let to = period.to && ISO_DAY.test(period.to) ? period.to : null;
      if (from && to && from > to) [from, to] = [to, from];
      return { from, to };
    }
    default: return { from: null, to: null };
  }
}

const SHORT_DAY = new Intl.DateTimeFormat('nl-BE', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const SHORT_DAY_YEAR = new Intl.DateTimeFormat('nl-BE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const WEEK_DAY = new Intl.DateTimeFormat('nl-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const WEEK_DAY_YEAR = new Intl.DateTimeFormat('nl-BE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function utcDay(iso: string): Date | null {
  return ISO_DAY.test(iso) ? new Date(`${iso}T00:00:00Z`) : null;
}

/** "10 nov", "3 dec 2025" (the year only when it is not this year). */
export function shortDay(iso: string, today: string): string {
  const date = utcDay(iso);
  if (!date) return iso;
  return (iso.slice(0, 4) === today.slice(0, 4) ? SHORT_DAY : SHORT_DAY_YEAR).format(date).replace(/\.$/, '');
}

/** The period chip's words: "Deze week", or "1 nov – 10 nov" / "vanaf 1 nov" / "tot 10 nov". */
export function periodLabel(period: PeriodChoice, today: string): string {
  if (period.kind !== 'van-tot') return PERIOD_CHOICES.find((choice) => choice.id === period.kind)?.label ?? 'Alles';
  const { from, to } = periodRange(period, today);
  if (from && to) return from === to ? shortDay(from, today) : `${shortDay(from, today)} – ${shortDay(to, today)}`;
  if (from) return `vanaf ${shortDay(from, today)}`;
  if (to) return `tot ${shortDay(to, today)}`;
  return 'Alles';
}

/* --------------------------------------------------------------- dates */

/** "di 10 nov" (+ the year when it is not this year). */
export function soldDay(iso: string, today: string): string {
  const date = utcDay(iso);
  if (!date) return iso;
  return (iso.slice(0, 4) === today.slice(0, 4) ? WEEK_DAY : WEEK_DAY_YEAR).format(date).replace(/\.$/, '').replace(/\.(?= )/g, '');
}

function localParts(instant: string | null | undefined): { day: string; time: string } | null {
  const date = instant ? new Date(instant) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { day, time: `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` };
}

/**
 * The sub-line under the sold-on day: "gemeld 14:05" when it was reported that same day, else "gemeld 12 nov
 * 14:05" (the year when not this year), so the date never hides behind a time again.
 */
export function reportedLine(report: Pick<StaffPartnerReport, 'soldOn' | 'createdAt'>, today: string): string {
  const at = localParts(report.createdAt);
  if (!at) return '';
  return at.day === report.soldOn ? `gemeld ${at.time}` : `gemeld ${shortDay(at.day, today)} ${at.time}`;
}

/* ----------------------------------------------------------- sums, search */

function cents(value: number | null | undefined): number {
  return Math.round((Number(value) || 0) * 100);
}

/** The table's total row over these meldingen (voided ones left out), in pieces and cents. */
export function totalsOf(reports: readonly StaffPartnerReport[]): PartnerSalesFilteredTotals {
  let n = 0, pieces = 0, gross = 0, costs = 0, buyback = 0, net = 0;
  for (const report of reports) {
    if (report.status === 'VOIDED') continue;
    n++;
    pieces += reportPieces(report).sale;
    gross += cents(report.totals.grossEur);
    costs += cents(costsEur(report.totals));
    buyback += cents(report.totals.buybackEur);
    net += cents(report.totals.netEur);
  }
  return { reports: n, salePieces: pieces, grossEur: gross / 100, costsEur: costs / 100, buybackEur: buyback / 100, netEur: net / 100 };
}

/**
 * What Factureren can still take of a melding: the netto and pieces of its open parts (the server's open-part rule,
 * part by part, as the summary and the home card count it). `partial` = some of it is on a document already. A melding
 * without parts (an older server) counts whole.
 */
export function openPartOf(report: StaffPartnerReport): { netEur: number; salePieces: number; buybackPieces: number; partial: boolean } {
  const parts = report.parts ?? [];
  const whole = reportPieces(report);
  if (!parts.length) return { netEur: report.totals.netEur, salePieces: whole.sale, buybackPieces: whole.buyback, partial: false };
  let net = 0, sale = 0, buyback = 0, held = false;
  for (const part of parts) {
    if (!part.open) { held = true; continue; }
    net += cents(part.netEur);
    const pieces = part.pieces ?? part.quantity;
    if (part.lineType === 'BUYBACK') buyback += pieces; else sale += pieces;
  }
  return { netEur: net / 100, salePieces: sale, buybackPieces: buyback, partial: held && report.status !== 'VOIDED' };
}

/** The search: number (VV-12 or 12), product, buyer, partner, note. */
export function reportMatches(report: StaffPartnerReport, query: string): boolean {
  const words = searchText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = searchText([
    report.number, String(report.id), report.customerName, buyerLine(report), report.note ?? '',
    ...report.entries.map((entry) => `${productTitle(entry)} ${entry.sku ?? ''}`),
  ].join(' '));
  return words.every((word) => haystack.includes(word));
}

/** Meldingen per sold-on day, newest day first; within a day newest melding first. */
export function byDay(reports: readonly StaffPartnerReport[]): { day: string; reports: StaffPartnerReport[] }[] {
  const days = new Map<string, StaffPartnerReport[]>();
  for (const report of [...reports].sort((a, b) => b.soldOn.localeCompare(a.soldOn) || b.id - a.id)) {
    const list = days.get(report.soldOn) ?? [];
    list.push(report);
    days.set(report.soldOn, list);
  }
  return [...days].map(([day, list]) => ({ day, reports: list }));
}
