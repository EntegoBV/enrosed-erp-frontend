import type { PlannerItem } from '../../core/api/planner-api';
import type { PlannerMilestone } from './planner-cards';

/*
 * The agenda model behind the home strip, the desk week, the month grid and
 * the Agenda page (spec-home §5.1): appointments, tasks, container moments and
 * money moments as one kind of entry per day, plus the per-day markers, the
 * rest of today, Komend, the pin countdown and the desk's "Daarna" line.
 *
 * Rules that fix the old planner: container history (ordered, shipped,
 * received before today) is muted and never counts in a marker; Komend starts
 * tomorrow and holds dated open tasks; a past pinned appointment drops off.
 *
 * Pure and node-tested: only `import type`; PIN_MIN_EUR is a local copy of
 * cash-forecast.ts, kept equal by a test.
 */

/** Money moments from this amount on get a marker and a place in Komend and Daarna (copy of cash-forecast.ts PIN_MIN_EUR). */
export const PIN_MIN_EUR = 5000;

export type AgendaType = 'afspraak' | 'container' | 'geld' | 'taak';
export type PlannerItemLite = Pick<PlannerItem, 'id' | 'kind' | 'title' | 'onDate' | 'atTime' | 'note' | 'done' | 'pinned' | 'parentId'>;
export type AgendaLink = { path: (string | number)[]; query?: Record<string, string | number> } | null;

export interface AgendaEntry {
  key: string; date: string; atTime: string | null; type: AgendaType; title: string; sub: string | null;
  /** A money moment's term ("1/3 bij bestelling", "70% bij vertrek"), apart from the container name in `title`; null otherwise. */
  term: string | null;
  eur: number | null /* signed */; past: boolean; late: boolean; done: boolean; pinned: boolean; deadline: boolean;
  plannerId: number | null; orderId: number | null; link: AgendaLink;
  /** The container moment behind a 'container' entry; null otherwise. */
  milestoneKind: PlannerMilestone['kind'] | null;
}

export interface AgendaInput {
  today: string;
  /** 'HH:mm' now; timed entries before it are past. */
  nowTime: string;
  items: readonly PlannerItemLite[];
  milestones: readonly PlannerMilestone[];
  /** Money moments: the forecast's BASE items when it is ready, else open invoices on their due day and recurring costs. */
  money: readonly { date: string; eur: number; title: string; term?: string | null; party: string | null; orderId: number | null; link: AgendaLink }[];
  /** The advances without a due day (agendaUndated): not on any day, one line of their own (critique B4). */
  undated?: AgendaUndated | null;
  moneySource: 'prognose' | 'facturen' | null;
  /** The VAT filing deadline in reach; it links to its quarter's return unless `link` says otherwise. */
  vatDeadline: { date: string; label: string; eur: number | null; link?: AgendaLink } | null;
  tight: { from: string; to: string } | null;
}

export interface DayMarkers {
  /** At most three, in the order afspraak, taak, container, geld. */
  types: AgendaType[];
  more: boolean;
  lateTask: boolean;
  bigMoney: boolean;
}

export interface AgendaModel {
  byDay: Map<string, AgendaEntry[]>;
  markers(date: string): DayMarkers;
  /** What is still to come today for the home's Agenda card, in the day's order (appointments first); money only when it earns a marker. */
  restOfToday: AgendaEntry[];
  komend(from?: string, limit?: number, to?: string): AgendaEntry[];
  pin: (AgendaEntry & { inDays: number }) | null;
  /** How many pins qualify (for "+n vastgepind" beside the countdown). */
  pinCount: number;
  after(windowEnd: string, n?: number): AgendaEntry[];
  openTaskCount: number;
  krapDays: Set<string>;
  /** The advances without a due day, as handed in: the desk's "zonder datum" and the Agenda page's last Komend row. */
  undated: AgendaUndated | null;
}

/** The sum of the advance rows without a due day (signed cash incl. btw, as the forecast holds them). */
export interface AgendaUndated { count: number; eur: number }

const DAY_MS = 86_400_000;
const utc = (iso: string): number => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const addDays = (iso: string, days: number): string => new Date(utc(iso) + days * DAY_MS).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string): number => Math.round((utc(to) - utc(from)) / DAY_MS);
const MARKER_LINE = /^\s*\[home:[^\]]*\]\s*$/;
const TYPE_ORDER: readonly AgendaType[] = ['afspraak', 'taak', 'container', 'geld'];

/** The first line of a note that people wrote (the home's "[home:…]" marker lines left out). */
function noteLine(note: string | null | undefined): string | null {
  const line = (note ?? '').split('\n').map((part) => part.trim()).find((part) => part && !MARKER_LINE.test(part));
  return line || null;
}

/** The 25th that closes a quarter (a local copy of finance-metrics filingDeadline). */
const filingDeadline = (year: number, quarter: number): string =>
  (quarter === 4 ? `${year + 1}-01-25` : `${year}-${String(quarter * 3 + 1).padStart(2, '0')}-25`);

type ForecastMoneyItem = { layer: string; overdue: boolean; certainty: string; source: { type: string; year?: number; quarter?: number } };

/** An advance row without a due day: the forecast parks it on today as EXPECTED (a dated one is FIXED, an overdue one is a task row). */
const undatedAdvance = (item: ForecastMoneyItem): boolean =>
  item.layer === 'BASE' && !item.overdue && item.source.type === 'advance' && item.certainty !== 'FIXED';

/**
 * The forecast items the agenda shows as money moments: the BASE layer only (scenario sales are estimates),
 * never an overdue item - the forecast dates those today, and they are the home's task rows (overdue
 * invoices and costs, container terms), as the invoice fallback leaves out what is past its due day - and
 * not the VAT return of `vatDeadline`, which the agenda shows as its deadline entry. Nor what has no day of
 * its own (design §4 #2): the open-credit tegoed (Kas "na tegoed", the Ook nog row) and the advances
 * without a due day (agendaUndated) - the forecast parks both on today.
 */
export function agendaForecastMoney<T extends ForecastMoneyItem>(items: readonly T[], vatDeadline: string): T[] {
  return items.filter((item) => item.layer === 'BASE' && !item.overdue && item.source.type !== 'credit' && !undatedAdvance(item)
    && !(item.source.type === 'vat' && item.source.year !== undefined && item.source.quarter !== undefined
      && filingDeadline(item.source.year, item.source.quarter) === vatDeadline));
}

/** The advances agendaForecastMoney leaves out for having no due day, as one count and sum; null when there are none. */
export function agendaUndated<T extends ForecastMoneyItem & { amountEur: number }>(items: readonly T[]): AgendaUndated | null {
  const rows = items.filter(undatedAdvance);
  if (!rows.length) return null;
  return { count: rows.length, eur: rows.reduce((sum, item) => sum + Math.round(item.amountEur * 100), 0) / 100 };
}

const big = (entry: AgendaEntry): boolean => entry.type === 'geld' && (entry.deadline || Math.abs(entry.eur ?? 0) >= PIN_MIN_EUR);
/** What earns a dot in the grid: appointments, open tasks, future arrivals and big or deadline money. */
const marks = (entry: AgendaEntry, today: string): boolean =>
  entry.type === 'afspraak' || (entry.type === 'taak' && !entry.done)
  || (entry.type === 'container' && entry.milestoneKind === 'EXPECTED_ARRIVAL' && entry.date >= today) || big(entry);

/** Within a day: appointments (all-day first, then by time), tasks, containers, money; then the title. */
function compareInDay(left: AgendaEntry, right: AgendaEntry): number {
  return TYPE_ORDER.indexOf(left.type) - TYPE_ORDER.indexOf(right.type)
    || (left.atTime ?? '').localeCompare(right.atTime ?? '')
    || left.title.localeCompare(right.title, 'nl')
    || left.key.localeCompare(right.key);
}

const compareByDate = (left: AgendaEntry, right: AgendaEntry): number =>
  left.date.localeCompare(right.date) || compareInDay(left, right);

export function agendaModel(input: AgendaInput): AgendaModel {
  const { today, nowTime } = input;
  const entries: AgendaEntry[] = [];
  const blank = { sub: null, term: null, eur: null, past: false, late: false, done: false, pinned: false, deadline: false,
    plannerId: null, orderId: null, link: null, milestoneKind: null, atTime: null };

  for (const item of input.items) {
    if (!item.onDate || item.id === null) continue;
    const task = item.kind === 'TASK';
    entries.push({
      ...blank, key: `${task ? 'taak' : 'afspraak'}:${item.id}`, date: item.onDate, atTime: task ? null : item.atTime ?? null,
      type: task ? 'taak' : 'afspraak', title: item.title, sub: noteLine(item.note),
      past: task ? false : item.onDate < today || (item.onDate === today && !!item.atTime && item.atTime.slice(0, 5) < nowTime),
      late: task && !item.done && item.onDate < today, done: task && item.done, pinned: !!item.pinned, plannerId: item.id,
    });
  }
  for (const stone of input.milestones) {
    const history = stone.kind !== 'EXPECTED_ARRIVAL';
    entries.push({
      ...blank, key: `container:${stone.kind}:${stone.orderId}:${stone.date}`, date: stone.date, type: 'container',
      title: stone.title, sub: stone.sub, past: history && stone.date < today,
      late: !history && stone.date < today, orderId: stone.orderId, link: { path: ['/purchasing', stone.orderId] },
      milestoneKind: stone.kind,
    });
  }
  input.money.forEach((money, index) => {
    entries.push({
      ...blank, key: `geld:${money.date}:${index}`, date: money.date, type: 'geld', title: money.title, term: money.term ?? null, sub: money.party,
      eur: money.eur, past: money.date < today, orderId: money.orderId, link: money.link,
    });
  });
  if (input.vatDeadline) {
    const vat = input.vatDeadline;
    /* The 25th closes the quarter before its month: 25 Oct → Q3, 25 Jan → Q4 of the year before. */
    const month = Number(vat.date.slice(5, 7));
    const year = Number(vat.date.slice(0, 4)) - (month === 1 ? 1 : 0);
    const quarter = month === 1 ? 4 : Math.max(1, Math.floor((month - 1) / 3));
    entries.push({
      ...blank, key: `btw:${vat.date}`, date: vat.date, type: 'geld', title: vat.label, sub: 'uiterste dag', eur: vat.eur,
      past: vat.date < today, deadline: true,
      link: vat.link ?? { path: ['/costs'], query: { view: 'analysis', tab: 'vat', year, quarter } },
    });
  }

  const byDay = new Map<string, AgendaEntry[]>();
  for (const entry of entries) {
    const day = byDay.get(entry.date) ?? [];
    day.push(entry);
    byDay.set(entry.date, day);
  }
  for (const day of byDay.values()) day.sort(compareInDay);

  const krapDays = new Set<string>();
  if (input.tight && input.tight.from <= input.tight.to) {
    for (let day = input.tight.from; day <= input.tight.to; day = addDays(day, 1)) krapDays.add(day);
  }

  const markers = (date: string): DayMarkers => {
    const marked = (byDay.get(date) ?? []).filter((entry) => marks(entry, today));
    const types = TYPE_ORDER.filter((type) => marked.some((entry) => entry.type === type));
    return {
      types: types.slice(0, 3), more: types.length > 3 || marked.length > 3,
      lateTask: marked.some((entry) => entry.type === 'taak' && entry.late), bigMoney: marked.some(big),
    };
  };

  /* The card shows four rows: appointments (all-day, then by time) before tasks, containers and money, so an
     appointment never hides behind invoices; small money stays in Agenda › Dag, as in Komend and the markers. */
  const restOfToday = (byDay.get(today) ?? [])
    .filter((entry) => !entry.done && (!entry.atTime || entry.atTime.slice(0, 5) >= nowTime) && (entry.type !== 'geld' || big(entry)));

  /* Komend: open things from a day on; small money stays in the day lists, history never comes back. */
  const komend = (from = addDays(today, 1), limit = 3, to?: string): AgendaEntry[] => entries
    .filter((entry) => entry.date >= from && (!to || entry.date <= to) && !entry.done && !entry.past
      && (entry.type !== 'geld' || big(entry)))
    .sort(compareByDate)
    .slice(0, limit);

  const pins = input.items
    .filter((item) => item.pinned && item.id !== null && !!item.onDate
      && (item.kind === 'TASK' ? !item.done : item.onDate >= today))
    .sort((left, right) => left.onDate!.localeCompare(right.onDate!) || (left.atTime ?? '').localeCompare(right.atTime ?? '')
      || left.title.localeCompare(right.title, 'nl'));
  const pinItem = pins[0];
  const pinEntry = pinItem ? entries.find((entry) => entry.plannerId === pinItem.id) ?? null : null;
  const pin = pinEntry ? { ...pinEntry, inDays: daysBetween(today, pinEntry.date) } : null;

  const krapStart: AgendaEntry | null = input.tight
    ? { ...blank, key: `krap:${input.tight.from}`, date: input.tight.from, type: 'geld', title: 'Krap begint',
      link: { path: ['/analyses/cash'] } }
    : null;
  const after = (windowEnd: string, n = 5): AgendaEntry[] => [...entries, ...(krapStart ? [krapStart] : [])]
    .filter((entry) => entry.date > windowEnd && !entry.done && !entry.past
      && (entry.pinned || entry.deadline || entry.milestoneKind === 'EXPECTED_ARRIVAL' || big(entry) || entry === krapStart))
    .sort(compareByDate)
    .slice(0, n);

  const openTaskCount = input.items.filter((item) => item.kind === 'TASK' && !item.done).length;

  return { byDay, markers, restOfToday, komend, pin, pinCount: pins.length, after, openTaskCount, krapDays, undated: input.undated ?? null };
}
