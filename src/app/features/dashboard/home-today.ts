import type { TicaAnalyticsDay } from '../../core/api/tica-api';
import type { HostToday, HostTodayTask } from '../../core/platform/host';
import type { ForecastDay } from '../finance/cash-forecast';
import type { AgendaEntry } from './agenda-entries';
import type { CashHeadline } from './home-cash';
import type { HomeTarget, HomeTask, HomeTaskList } from './home-priority';
import type { PlannerMilestone } from './planner-cards';

/*
 * The Home's `today` snapshot for the native host (plan 3.6): what the phone Home computed, mapped for the Vandaag
 * widget and the Vandaag intent, never recomputed anywhere else. home-phone.ts posts it in host mode only and loads
 * this file through import(), so neither the PWA nor the initial bundle carries it. At most 8 KB, and only when it
 * changed: `at` is when the Home loaded its figures, so the snapshot moves when the Home reloads or a figure changes.
 * Pure apart from nextToday's memory of the last snapshot. Type imports only and no object spread (esbuild lowers it
 * to shared helpers): a runtime import or a helper here would move code between the initial chunks.
 */

/** The Home's signals as one plain object, read inside home-phone's effect. */
export interface TodaySources {
  /** The Home's day (HomeData.today: the phone's own calendar, the day 0 of the forecast and the tasks). */
  day: string;
  /** Today on the Brussels calendar (ticaToday), the portal's days: the TICA figure, as the Home's TICA card counts it. */
  ticaDay: string;
  /** HomeData.loadedAt: when the last load finished; null during the first one. */
  loadedAt: number | null;
  /** HomeData.settled: every source answered (or failed); `complete` waits for it. */
  settled: boolean;
  tasks: Pick<HomeTaskList, 'top' | 'more' | 'count' | 'complete'>;
  /** HomeData.warnings(): the status words of the sources that failed ("Niet volledig: …"). */
  warnings: readonly string[];
  cash: CashHeadline;
  /** The forecast's days (the Kas hero's line); null until it is built. */
  days: readonly Pick<ForecastDay, 'withEur'>[] | null;
  /** HomeData.payNowEur: Kosten & bank's "Nu te betalen" (due now); null while the costs or the purchase orders are missing. */
  payEur: number | null;
  /** WorkQueue.actionCount: the bell's number. */
  waiting: number;
  /** CashData's TICA days while the TICA card shows (ready, sold anything); null otherwise. */
  tica: readonly Pick<TicaAnalyticsDay, 'date' | 'revenueExcl' | 'quantity'>[] | null;
  /** What is still to come today (the Agenda card's rows). */
  agenda: readonly Pick<AgendaEntry, 'date' | 'atTime' | 'title' | 'type'>[];
  milestones: readonly Pick<PlannerMilestone, 'kind' | 'date' | 'orderId'>[];
  /** The containers' names (containerName) by purchase order id. */
  names: ReadonlyMap<number, string>;
  /** A task's router url (the task cells' routerLink), null for the bell and the planner. */
  link: (target: HomeTarget) => string | null;
}

const MAX_BYTES = 8 * 1024;
const TOP = 6;
const SPARK_DAYS = 30;

/** The agenda's types as the planner's kinds, so a row says what it is without the web's words. */
const AGENDA_KIND: Readonly<Record<AgendaEntry['type'], string>> = { afspraak: 'EVENT', taak: 'TASK', container: 'CONTAINER', geld: 'MONEY' };

const cents = (value: number): number => Math.round(value * 100) / 100;
const finite = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);

function taskOf(task: HomeTask, link: TodaySources['link']): HostTodayTask {
  const out: HostTodayTask = { key: task.key, tier: task.tier, title: task.title };
  if (task.context) out.context = task.context;
  if (task.chip?.label) out.chip = { label: task.chip.label, tone: task.chip.tone };
  if (finite(task.eur)) out.eur = cents(task.eur);
  const url = link(task.target);
  if (url) out.url = url;
  return out;
}

function cashOf(head: CashHeadline, days: TodaySources['days']): NonNullable<HostToday['cash']> {
  const cash: NonNullable<HostToday['cash']> = { state: head.state };
  if (finite(head.startEur)) cash.startEur = cents(head.startEur);
  if (head.lowest) cash.lowest = { day: head.lowest.day, eur: cents(head.lowest.eur), warn: head.lowest.warn };
  if (head.tight) cash.tight = { from: head.tight.from, to: head.tight.to, lowestEur: cents(head.tight.lowestEur) };
  if (head.state === 'ready' && days?.length) cash.spark = days.slice(0, SPARK_DAYS).map((day) => Math.round(day.withEur));
  /* The Kas hero's own link: Saldo invullen without a reading, the Kasprognose otherwise; the failed bank only retries. */
  if (head.state === 'no-reading') cash.url = '/costs?view=bank';
  else if (head.state !== 'no-bank') cash.url = '/analyses/cash';
  return cash;
}

/** The snapshot of these sources; `now` stands in for `at` until the first load finished. */
export function todayOf(sources: TodaySources, now = Date.now()): HostToday {
  const { day, tasks } = sources;
  const today: HostToday = {
    type: 'today', at: new Date(sources.loadedAt ?? now).toISOString(), day,
    complete: sources.settled && tasks.complete && sources.warnings.length === 0, missing: [...sources.warnings],
    cash: cashOf(sources.cash, sources.days),
    tasks: {
      count: tasks.count,
      nu: [...tasks.top, ...tasks.more].filter((task) => task.tier === 'nu').length,
      top: tasks.top.slice(0, TOP).map((task) => taskOf(task, sources.link)),
    },
    waiting: { count: Math.max(0, sources.waiting) },
  };
  if (finite(sources.payEur)) today.payNowEur = cents(sources.payEur);
  if (sources.tica) {
    const rows = sources.tica.filter((row) => row.date === sources.ticaDay);
    today.tica = { todayEur: cents(rows.reduce((sum, row) => sum + row.revenueExcl, 0)), todayPieces: rows.reduce((sum, row) => sum + row.quantity, 0) };
  }
  const agenda = sources.agenda.slice(0, 3).map((entry) => {
    const row: NonNullable<HostToday['agenda']>[number] = { title: entry.title, kind: AGENDA_KIND[entry.type], url: `/dashboard/agenda?dag=${entry.date}` };
    if (entry.atTime) row.time = entry.atTime.slice(0, 5);
    return row;
  });
  if (agenda.length) today.agenda = agenda;
  const arrivals = sources.milestones.filter((milestone) => milestone.kind === 'EXPECTED_ARRIVAL')
    .sort((left, right) => left.date.localeCompare(right.date) || left.orderId - right.orderId)
    .slice(0, 5)
    .map((milestone) => ({ orderId: milestone.orderId, name: sources.names.get(milestone.orderId) ?? `Inkoop #${milestone.orderId}`,
      day: milestone.date, late: milestone.date < day }));
  if (arrivals.length) today.arrivals = arrivals;
  return fit(today);
}

/** At most MAX_BYTES of UTF-8: the context lines go first, then the sparkline, then rows beyond three. */
function fit(today: HostToday): HostToday {
  const size = (value: HostToday): number => new TextEncoder().encode(JSON.stringify(value)).length;
  const steps: ((value: HostToday) => void)[] = [
    (value) => value.tasks.top.forEach((task) => delete task.context),
    (value) => { if (value.cash) delete value.cash.spark; },
    (value) => { value.tasks.top = value.tasks.top.slice(0, 3); delete value.agenda; delete value.arrivals; },
    (value) => value.tasks.top.forEach((task) => { task.title = task.title.slice(0, 120).trim(); }),
  ];
  for (const step of steps) {
    if (size(today) <= MAX_BYTES) break;
    step(today);
  }
  return today;
}

let lastSent = '';

/** The snapshot to post, or null when it equals the last one this web view posted (while the first load runs, once). */
export function nextToday(sources: TodaySources, now = Date.now()): HostToday | null {
  const today = todayOf(sources, now);
  const key = sources.loadedAt === null ? JSON.stringify(today).replace(today.at, 'loading') : JSON.stringify(today);
  if (key === lastSent) return null;
  lastSent = key;
  return today;
}
