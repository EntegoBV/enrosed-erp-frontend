/*
 * The home's figure helpers (spec-home §3, §6): the month and year windows
 * that follow the day, the month-on-month change, bar heights, the next
 * container moments of Inkoop & containers, the desk briefing sentence, the
 * greeting, the week number and the Markt block's own freight quote.
 *
 * Pure and node-tested: no imports at all. isoWeek is a local copy of
 * agenda-days.ts; the forwarder routes are a copy of market-analysis.ts
 * (a component, so it is not imported).
 */

const DAY_MS = 86_400_000;
const MONTHS_LONG = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const MONTHS_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const WEEKDAYS_LONG = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];
const WEEKDAYS_SHORT = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];

const utc = (iso: string): number => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) || 1);
const pad = (value: number): string => String(value).padStart(2, '0');
function isoOf(year: number, month1: number, day: number): string {
  const date = new Date(Date.UTC(year, month1 - 1, day));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
const addDays = (iso: string, days: number): string => new Date(utc(iso) + days * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string): number => Math.round((utc(to) - utc(from)) / DAY_MS);
const weekdayOf = (iso: string): number => new Date(utc(iso)).getUTCDay();
const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);

/* ------------------------------------------------------------- the date */

/** "Dagoverzicht" before 6, then Goedemorgen, Goedemiddag (from 12), Goedenavond (from 18). */
export function greeting(hour: number): string {
  if (hour < 6) return 'Dagoverzicht';
  if (hour < 12) return 'Goedemorgen';
  if (hour < 18) return 'Goedemiddag';
  return 'Goedenavond';
}

/** "donderdag 15 oktober". */
export function longDate(iso: string): string {
  return `${WEEKDAYS_LONG[weekdayOf(iso)]} ${Number(iso.slice(8, 10))} ${MONTHS_LONG[Number(iso.slice(5, 7)) - 1]}`;
}

/** "do 15 okt". */
export function shortDate(iso: string): string {
  return `${WEEKDAYS_SHORT[weekdayOf(iso)]} ${Number(iso.slice(8, 10))} ${MONTHS_SHORT[Number(iso.slice(5, 7)) - 1]}`;
}

/** ISO 8601 week number (copy of agenda-days.ts isoWeek). */
export function weekNumber(iso: string): number {
  const thursday = addDays(iso, 3 - ((weekdayOf(iso) + 6) % 7));
  const newYear = isoOf(Number(thursday.slice(0, 4)), 1, 1);
  return 1 + Math.floor((utc(thursday) - utc(newYear)) / (7 * DAY_MS));
}

/** The desk overline: "donderdag 15 oktober · week 42" (the page sets it in capitals). */
export function overline(iso: string): string {
  return `${longDate(iso)} · week ${weekNumber(iso)}`;
}

/** The first word of the display name ("Mock Medewerker" → "Mock"); null without one. */
export function firstName(display: string | null | undefined): string | null {
  const word = (display ?? '').trim().split(/\s+/)[0];
  return word || null;
}

/** How old a bank reading is, as the Kas card says it: "vandaag", "gisteren", "3 d geleden"; null when unknown. */
export function ageText(days: number | null | undefined): string | null {
  if (days === null || days === undefined || !Number.isFinite(days)) return null;
  if (days <= 0) return 'vandaag';
  return days === 1 ? 'gisteren' : `${days} d geleden`;
}

/* ------------------------------------------------------------ windows */

export interface MonthWindows {
  today: string;
  monthStart: string;
  yearStart: string;
  /** "oktober". */
  monthName: string;
  /** The same days of last month: the 1st up to the same day number, clamped to that month's end. */
  prevFrom: string;
  prevTo: string;
  /** "1–15 sep" ("1 sep" on the 1st). */
  prevLabel: string;
  /** The first of the month five months back: with this month, six month bars. */
  sixMonthStart: string;
}

/** The month and year windows of the day: they move at midnight and at the turn of a month (bug 6). */
export function monthWindows(today: string): MonthWindows {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const day = Number(today.slice(8, 10));
  const prevFrom = isoOf(year, month - 1, 1);
  const prevLast = new Date(Date.UTC(year, month - 1, 0)).getUTCDate();
  const prevDay = Math.min(day, prevLast);
  const prevTo = isoOf(Number(prevFrom.slice(0, 4)), Number(prevFrom.slice(5, 7)), prevDay);
  const prevMonth = MONTHS_SHORT[Number(prevFrom.slice(5, 7)) - 1];
  return {
    today, monthStart: isoOf(year, month, 1), yearStart: `${today.slice(0, 4)}-01-01`, monthName: MONTHS_LONG[month - 1],
    prevFrom, prevTo, prevLabel: prevDay === 1 ? `1 ${prevMonth}` : `1–${prevDay} ${prevMonth}`,
    sixMonthStart: isoOf(year, month - 5, 1),
  };
}

/* ------------------------------------------------------------- change */

/** Whole-percent change against the previous figure; null when there is nothing to compare with (0). */
export function deltaPct(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 100);
}

/** "▲ 13%", "▼ 4%", "= 0%"; "—" without a comparison. */
export function deltaText(pct: number | null): string {
  if (pct === null) return '—';
  if (pct === 0) return '= 0%';
  return `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}%`;
}

/* --------------------------------------------------------------- bars */

export interface Bar { key: string; label: string; value: number; /** 0–100 of the largest value; a negative value is 0. */ pct: number; current: boolean; }

/** Bar heights against the largest value; `currentKey` marks the bar that is still running (this month, today). */
export function bars(points: readonly { key: string; label: string; value: number }[], currentKey?: string): Bar[] {
  const max = Math.max(0, ...points.map((point) => (Number.isFinite(point.value) ? point.value : 0)));
  return points.map((point) => ({
    key: point.key, label: point.label, value: point.value, current: point.key === currentKey,
    pct: max > 0 && point.value > 0 ? Math.round((point.value / max) * 100) : 0,
  }));
}

/** Six month bars of the invoiced claims ("mei" … "okt"); the current month is partial. */
export function monthBars(monthly: readonly { month: string; invoicedEur: number }[], today: string): Bar[] {
  return bars(monthly.map((point) => ({ key: point.month, label: MONTHS_SHORT[Number(point.month.slice(5, 7)) - 1] ?? point.month, value: point.invoicedEur })),
    today.slice(0, 7));
}

/* ---------------------------------------------------------- containers */

export interface ContainerEventOrder {
  orderId: number;
  /** containerName(): the Herkenbare naam, else the PO number. */
  label: string;
  supplier: string;
  status: string;
  orderDate: string | null;
  shippedOn: string | null;
}

export interface ContainerEvent {
  orderId: number; label: string; supplier: string; date: string; status: string;
  /** "aankomst do 22 okt"; "aankomst verwacht di 13 okt" once that day has passed. */
  text: string;
  /** From the order (or the sailing day) to the expected arrival, 0–100. */
  progressPct: number;
  late: boolean;
}

/**
 * The next container moments: the expected arrivals of orders still under
 * way (purchasePlannerMilestones, handed in by the adapter), the nearest
 * first. An arrival whose day has passed without a receipt stays, marked
 * late: the container is still coming. History never shows here.
 */
export function nextContainerEvents(milestones: readonly { kind: string; date: string; orderId: number }[],
  orders: readonly ContainerEventOrder[], today: string, n = 3): ContainerEvent[] {
  const byId = new Map(orders.map((order) => [order.orderId, order]));
  return milestones
    .filter((stone) => stone.kind === 'EXPECTED_ARRIVAL' && byId.has(stone.orderId))
    .map((stone) => {
      const order = byId.get(stone.orderId)!;
      const start = order.shippedOn ?? order.orderDate ?? stone.date;
      const span = daysBetween(start, stone.date);
      const done = daysBetween(start, today);
      const late = stone.date < today;
      const progressPct = late || span <= 0 ? 100 : Math.max(0, Math.min(100, Math.round((done / span) * 100)));
      return { orderId: order.orderId, label: order.label, supplier: order.supplier, date: stone.date, status: order.status,
        text: `aankomst ${late ? 'verwacht ' : ''}${shortDate(stone.date)}`, progressPct, late };
    })
    .sort((left, right) => left.date.localeCompare(right.date) || left.label.localeCompare(right.label, 'nl') || left.orderId - right.orderId)
    .slice(0, n);
}

/* ------------------------------------------------------------ briefing */

export interface BriefingPart { text: string; strong?: boolean; /** The krap period: the page links it to the Kasprognose. */ krap?: boolean; }

export interface BriefingInput {
  /** Nu + Vandaag rows (HomeTaskList.count). */
  count: number;
  /** Every source answered (HomeTaskList.complete). */
  complete: boolean;
  /** Today's appointments. */
  events: readonly { atTime: string | null }[];
  /** "HH:mm". */
  nowTime: string;
  /** The first krap period within the horizon. */
  tight: { from: string; to: string } | null;
}

/** "3 tot 11 november", "28 oktober tot 3 november". */
export function fromToLong(from: string, to: string): string {
  const day = (iso: string): number => Number(iso.slice(8, 10));
  const month = (iso: string): string => MONTHS_LONG[Number(iso.slice(5, 7)) - 1];
  return from.slice(0, 7) === to.slice(0, 7) ? `${day(from)} tot ${day(to)} ${month(to)}` : `${day(from)} ${month(from)} tot ${day(to)} ${month(to)}`;
}

/**
 * The desk's one-line briefing (§3 D1a): "7 dingen te doen en 2 afspraken
 * vandaag. Eerste afspraak om 10:00. De bank wordt krap van 3 tot 11
 * november." Parts that would be empty are left out.
 */
export function briefing(input: BriefingInput): BriefingPart[] {
  const parts: BriefingPart[] = [];
  const m = input.events.length;
  const events: BriefingPart = { text: `${m} ${plural(m, 'afspraak', 'afspraken')}`, strong: true };
  if (!input.complete) {
    parts.push({ text: 'Nog niet alles geladen. ' });
    if (m) parts.push(events, { text: ' vandaag.' }); else parts.push({ text: 'Geen afspraken vandaag.' });
  } else if (input.count > 0) {
    parts.push({ text: `${input.count} ${plural(input.count, 'ding', 'dingen')}`, strong: true });
    if (m) parts.push({ text: ' te doen en ' }, events, { text: ' vandaag.' });
    else parts.push({ text: ' te doen. Geen afspraken vandaag.' });
  } else if (m) {
    parts.push({ text: 'Niets dringends vandaag, wel ' }, events, { text: '.' });
  } else {
    parts.push({ text: 'Niets dringends en geen afspraken vandaag.' });
  }
  const times = input.events.map((event) => event.atTime?.slice(0, 5) ?? '').filter(Boolean).sort();
  const coming = times.filter((time) => time >= input.nowTime);
  if (coming.length) {
    parts.push({ text: coming.length === times.length ? ' Eerste afspraak om ' : ' Volgende afspraak om ' }, { text: coming[0], strong: true }, { text: '.' });
  }
  if (input.tight) {
    parts.push({ text: ' De bank wordt krap van ' }, { text: fromToLong(input.tight.from, input.tight.to), strong: true, krap: true }, { text: '.' });
  }
  return parts;
}

/* -------------------------------------------------------------- market */

/** Our own forwarder's 40ft quotes (market-analysis.ts FREIGHT, group 'own'); the indexes are in points and never shown here. */
export const OWN_FREIGHT_ROUTES: readonly { code: string; short: string }[] = [
  { code: 'NINGBO', short: 'Ningbo → Rotterdam' },
  { code: 'GUANGZHOU', short: 'Nansha → Rotterdam' },
  { code: 'SHENZHEN', short: 'Yantian → Rotterdam' },
];

export interface OwnQuote { route: string; short: string; /** "Ningbo": the port the phone row names. */ origin: string; usd: number; quotedOn: string; }

/** The latest of our own forwarder quotes, by quote day; null when there is none. */
export function latestOwnQuote(rates: readonly { route: string; quotedOn: string; usdPerContainer: number }[]): OwnQuote | null {
  const routes = new Map(OWN_FREIGHT_ROUTES.map((route) => [route.code, route.short]));
  const own = rates.filter((rate) => routes.has(rate.route) && Number.isFinite(rate.usdPerContainer) && /^\d{4}-\d{2}-\d{2}/.test(rate.quotedOn ?? ''))
    .sort((left, right) => right.quotedOn.localeCompare(left.quotedOn) || OWN_FREIGHT_ROUTES.findIndex((route) => route.code === left.route)
      - OWN_FREIGHT_ROUTES.findIndex((route) => route.code === right.route))[0];
  if (!own) return null;
  const short = routes.get(own.route)!;
  return { route: own.route, short, origin: short.split(' ')[0], usd: own.usdPerContainer, quotedOn: own.quotedOn.slice(0, 10) };
}

/** "2 okt". */
export function dayMonthShort(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTHS_SHORT[Number(iso.slice(5, 7)) - 1]}`;
}

/** "🇧🇪 België" from "BE"; the code alone when the name is unknown, null without a code. */
export function countryWithFlag(code: string | null | undefined): string | null {
  const letters = (code ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(letters)) return letters || null;
  const flag = [...letters].map((letter) => String.fromCodePoint(127397 + letter.charCodeAt(0))).join('');
  try {
    return `${flag} ${new Intl.DisplayNames(['nl'], { type: 'region' }).of(letters) ?? letters}`;
  } catch {
    return `${flag} ${letters}`;
  }
}
