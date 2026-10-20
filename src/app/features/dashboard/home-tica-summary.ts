import type { TicaAnalyticsDay, TicaSettlement, TicaStatus } from '../../core/api/tica-api';

/*
 * The home's TICA card (Emre, 2026-10-20: "Tica componentje ook op onze
 * dashboard ... met dag verkoop"): today's portal sales, the last seven
 * days, this month and the latest settlement, from the analytics days and
 * settlements CashData already loads for the Kasprognose. Revenue is the
 * portal's net (after discount, excl. btw), as on TICA verkopen; days are
 * Brussels days (the portal's wall clock).
 *
 * Pure and node-tested: type imports only.
 */

const MONTHS_LONG = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const MONTHS_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const STATUS: Readonly<Record<TicaSettlement['status'], TicaHomeSettlement['status']>> = { DRAFT: 'concept', OPEN: 'open', PAID: 'betaald' };

export interface TicaHomeDay { date: string; revenueExcl: number; transactions: number; quantity: number; }
export interface TicaHomeSettlement { netReceivable: number; status: 'concept' | 'open' | 'betaald'; period: string; }
export interface TicaHomeSummary {
  today: TicaHomeDay;
  /** Seven days, oldest first and today last; a day without sales is 0. */
  week: TicaHomeDay[];
  weekTotal: Omit<TicaHomeDay, 'date'>;
  /** Today's average price per piece, else the seven days'; null without pieces sold. */
  perPiece: { eur: number; basis: 'vandaag' | '7 dagen' } | null;
  month: Omit<TicaHomeDay, 'date'>;
  settlement: TicaHomeSettlement | null;
}

const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const zero = (date: string): TicaHomeDay => ({ date, revenueExcl: 0, transactions: 0, quantity: 0 });

function plusDays(iso: string, days: number): string {
  return new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + days)).toISOString().slice(0, 10);
}

function total(days: readonly TicaHomeDay[]): Omit<TicaHomeDay, 'date'> {
  return {
    revenueExcl: money(days.reduce((sum, day) => sum + day.revenueExcl, 0)),
    transactions: days.reduce((sum, day) => sum + day.transactions, 0),
    quantity: days.reduce((sum, day) => sum + day.quantity, 0),
  };
}

/** "september" for a whole month, "1–15 sep" inside one, "28 sep – 4 okt" across two. */
export function settlementPeriod(from: string, to: string): string {
  const [fromMonth, toMonth] = [Number(from.slice(5, 7)) - 1, Number(to.slice(5, 7)) - 1];
  const [fromDay, toDay] = [Number(from.slice(8, 10)), Number(to.slice(8, 10))];
  if (from.slice(0, 7) === to.slice(0, 7)) {
    return fromDay === 1 && plusDays(to, 1).slice(8, 10) === '01' ? MONTHS_LONG[fromMonth] : `${fromDay}–${toDay} ${MONTHS_SHORT[toMonth]}`;
  }
  return `${fromDay} ${MONTHS_SHORT[fromMonth]} – ${toDay} ${MONTHS_SHORT[toMonth]}`;
}

/** The card's figures for `today` (a Brussels 'YYYY-MM-DD'). */
export function ticaHomeSummary(days: readonly TicaAnalyticsDay[], settlements: readonly TicaSettlement[], today: string): TicaHomeSummary {
  const byDate = new Map<string, TicaHomeDay>();
  for (const day of days) {
    const row = byDate.get(day.date) ?? zero(day.date);
    byDate.set(day.date, { date: day.date, revenueExcl: money(row.revenueExcl + day.revenueExcl),
      transactions: row.transactions + day.transactionCount, quantity: row.quantity + day.quantity });
  }
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = plusDays(today, index - 6);
    return byDate.get(date) ?? zero(date);
  });
  const todayRow = week[6];
  const weekTotal = total(week);
  const monthStart = `${today.slice(0, 7)}-01`;
  const perPiece = todayRow.quantity > 0 ? { eur: money(todayRow.revenueExcl / todayRow.quantity), basis: 'vandaag' as const }
    : weekTotal.quantity > 0 ? { eur: money(weekTotal.revenueExcl / weekTotal.quantity), basis: '7 dagen' as const } : null;
  const latest = [...settlements].sort((a, b) => b.documentDate.localeCompare(a.documentDate) || b.id - a.id)[0];
  return {
    today: todayRow, week, weekTotal, perPiece,
    month: total([...byDate.values()].filter((day) => day.date >= monthStart && day.date <= today)),
    settlement: latest ? { netReceivable: latest.netReceivable, status: STATUS[latest.status], period: settlementPeriod(latest.periodFrom, latest.periodTo) } : null,
  };
}

/** Brussels 'YYYY-MM-DD' and 'HH:MM' of an instant. */
function brussels(instant: Date): { day: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const part = (type: string): string => parts.find((row) => row.type === type)?.value ?? '';
  return { day: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}

/**
 * How fresh the figures are: "bijgewerkt 14:05" (today) or "bijgewerkt 19 okt" for the sub, or a warning
 * when fetching fails or is switched off. Null status (not loaded, or the call failed): nothing.
 */
export function ticaFreshness(status: TicaStatus | null, now: Date): { sub: string | null; warning: string | null } {
  if (!status) return { sub: null, warning: null };
  if (status.syncState === 'ERROR') return { sub: null, warning: 'Ophalen mislukt' };
  if (status.syncState === 'DISABLED' || status.syncState === 'NOT_CONFIGURED') return { sub: null, warning: 'Ophalen staat uit' };
  const at = status.lastSuccessAt ? new Date(status.lastSuccessAt) : null;
  if (!at || !Number.isFinite(at.getTime())) return { sub: 'nog niet opgehaald', warning: null };
  const last = brussels(at);
  if (last.day === brussels(now).day) return { sub: `bijgewerkt ${last.time}`, warning: null };
  return { sub: `bijgewerkt ${Number(last.day.slice(8, 10))} ${MONTHS_SHORT[Number(last.day.slice(5, 7)) - 1]}`, warning: null };
}
