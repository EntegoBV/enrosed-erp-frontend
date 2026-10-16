/*
 * What counts as important on the home (spec-home §4): every source that can
 * ask for work today becomes one HomeTask in one of three tiers - Nu (money
 * or a deadline slips today), Vandaag (someone waits, or a deadline is close)
 * and Ook nog (housekeeping without a deadline). The home shows at most
 * HOME_TASK_CAP rows of Nu and Vandaag; the rest stays one tap away.
 *
 * Pure and node-tested: no runtime imports. The helpers it needs (workdays,
 * the VAT filing deadline, nl-BE formatting) are local copies; the adapter
 * (home-sources.ts) hands in plain data, including the sentences that
 * finance-attention.ts already writes for Kosten & bank.
 */

/* ============================================================ thresholds */
/* The ONE place for the home's thresholds. */

export const HOME_TASK_CAP = 7;                     // rows from Nu + Vandaag on the home
export const OVERDUE_INVOICE_MIN_EUR = 1000;        // per invoice; smaller ones → Ook nog
export const OVERDUE_INVOICE_NU_DAYS = 45;          // the oldest big invoice more than 45 d late → Nu
export const CUSTOMER_WAIT_NU_WORKDAYS = 2;         // a customer waiting ≥ 2 workdays → Nu
export const VAT_SHOW_DAYS = 10;                    // the return appears 10 d before the deadline (the 25th)
export const VAT_NU_DAYS = 3;                       // and is Nu from 3 d before
export const VAT_LATE_SHOW_DAYS = 14;               // unpaid after the deadline: Nu "n d te laat", for at most 14 d
export const KRAP_WITHIN_DAYS = 14;                 // "Bank wordt krap" when tightWith[0].from ≤ today + 14 (Nu)
export const ADVANCE_SOON_DAYS = 7;                 // voorschotfactuur due ≤ 7 d → Vandaag; later → Ook nog
export const ARRIVAL_SOON_DAYS = 1;                 // a container arriving today or tomorrow → Vandaag
export const PINNED_TASK_AHEAD_DAYS = 7;            // a pinned task dated ≤ 7 d ahead (or undated) → Vandaag
export const LATER_ESCALATE_COUNT = 3;              // the 3rd "Later" moves the item up one tier
export const SOURCE_ORDER = ['container-due', 'advance', 'overdue-invoices', 'krap', 'overdue-costs', 'vat', 'customers', 'login',
  'planner', 'arrival', 'purchase-check', 'settlement', 'bank-lines', 'recurring-due', 'open-credits', 'small-invoices', 'advance-later',
  'regimes', 'catalog'] as const;

/** Not a home threshold: a copy of finance-attention.ts OVERDUE_COST_DAYS for the "Waarom" text; a test keeps the two equal. */
export const OVERDUE_COST_DAYS_COPY = 30;

/* ================================================================= types */

export type Tier = 'nu' | 'vandaag' | 'ooknog';
export type HomeSource = typeof SOURCE_ORDER[number];
export type HomeTarget = { kind: 'route'; path: (string | number)[]; query?: Record<string, string> }
  | { kind: 'finance'; location: Record<string, string> }   // Angular side → financeQueryParams (finance/finance-url.ts)
  | { kind: 'bell' } | { kind: 'planner'; id: number } | { kind: 'cash' };
export type HomeAction = 'klaar' | 'morgen' | 'later' | 'taak';
export type ChipTone = 'danger' | 'warn' | 'accent' | 'grey';

export interface HomeTask {
  key: string; source: HomeSource; tier: Tier; escalated: boolean;
  title: string; context: string; chip: { label: string; tone: ChipTone };
  eur: number | null; count: number | null; daysLate: number; due: string | null;
  verb: string; target: HomeTarget; plannerId: number | null;
  actions: HomeAction[];
  /** Later is undone when the detail changes (the WorkQueue key rule, work-queue.ts:124-133). */
  detail: string;
}

export const COVERAGE_ORDER = ['agenda', 'meldingen', 'verkoop', 'inkoop', 'partnerfinanciering', 'inkomende betalingen',
  'kosten', 'bank', 'kasprognose'] as const;
export type CoverageSource = typeof COVERAGE_ORDER[number];
/** A coverage source on the last load: not answered yet, answered, or failed. */
export type CoverageAnswer = 'loading' | 'ready' | 'failed';

/**
 * The Kasprognose's answer from the Kas headline's state (home-cash.ts). A bank that could not load is named
 * 'bank' only (amendment B: bankMissing → coverage bank); the forecast fails with it only when another of its
 * sources failed too (`otherFailures`), as it does in 'partial'.
 */
export function forecastAnswer(state: 'loading' | 'computing' | 'ready' | 'partial' | 'no-bank' | 'no-reading', otherFailures: boolean): CoverageAnswer {
  switch (state) {
    case 'ready': case 'no-reading': return 'ready';
    case 'partial': return 'failed';
    case 'no-bank': return otherFailures ? 'failed' : 'ready';
    default: return 'loading';
  }
}

/**
 * Coverage (§4.4) and the failed sources in COVERAGE_ORDER, from one answer per source: the Te doen note
 * ("Niet volledig: …", the list's `missing` once everything answered) and the status in the header name the
 * same sources in the same order.
 */
export function coverageOf(answers: Readonly<Record<CoverageSource, CoverageAnswer>>): { covered: Record<CoverageSource, boolean>; failed: CoverageSource[] } {
  return {
    covered: Object.fromEntries(COVERAGE_ORDER.map((source) => [source, answers[source] === 'ready'])) as Record<CoverageSource, boolean>,
    failed: COVERAGE_ORDER.filter((source) => answers[source] === 'failed'),
  };
}

export interface LaterEntry { until: string; detail: string; count: number; }
export type LaterState = Readonly<Record<string, LaterEntry>>;

export interface HomeTaskInput {
  today: string; nowMs: number;
  planner: readonly { id: number; kind: 'EVENT' | 'TASK'; title: string; onDate: string | null; done: boolean; pinned: boolean; note: string | null }[];
  /** The bell's action items (WorkQueue.actions()); `at` is an ISO instant. */
  customers: readonly { kind: string; title: string; orderNumber: string; customer: string | null; at: string | null; detail: string }[];
  loginRequests: number;
  /** Container terms due now, one per order; label = containerName(). */
  containerDue: readonly { orderId: number; label: string; eur: number; termLabel?: string | null }[];
  /** Unbilled advances (partnerFinancingAnalysis); `first` is the earliest, `orderIds` every order involved. */
  advances: { count: number; eur: number; overdueEur: number; first: { orderId: number; label: string; due: string | null } | null;
    orderIds?: readonly number[] };
  settlements: number;
  invoicesOverdue: readonly { id: number; number: string; customer: string; dueDate: string; remainingEur: number }[];
  /** The 'overdue-costs' item of financeAttention(): its count, sum, title and target. */
  overdueCosts: { count: number; eur: number; oldestDays: number; title: string; location: Record<string, string> } | null;
  /**
   * The bank's paid VAT periods ('2026-Q3'), or null when the bank did not load; and the signed cash of the
   * forecast's BASE VAT items keyed by the filing deadline of their period (negative = to pay).
   */
  vat: { paidPeriods: readonly string[] | null; eurByDeadline: Readonly<Record<string, number>> };
  tight: { from: string; to: string; lowestEur: number; lowestDay: string; bufferEur: number } | null;
  arrivals: readonly { orderId: number; label: string; date: string; sub: string }[];
  purchaseCheck: number; catalog: number;
  /** Kosten & bank items (financeAttention): their sentence, sum and finance target; `detail` is the home's context line. */
  housekeeping: readonly { kind: 'bank-lines' | 'recurring-due' | 'open-credits' | 'regimes'; count: number; eur: number | null;
    title: string; detail: string; location: Record<string, string> }[];
  later: LaterState;
  /** The `<key>#<hash>` of every [home:…] marker in the notes of open planner tasks (homeMarkersOf). */
  taskKeys: readonly string[];
  sources: Readonly<Record<CoverageSource, boolean>>;
}

export interface HomeTaskList {
  top: HomeTask[]; more: HomeTask[]; ookNog: HomeTask[];
  count: number; total: number; complete: boolean; missing: string[]; allClear: boolean;
}

/* =============================================================== helpers */

const DAY_MS = 86_400_000;
const utc = (iso: string): number => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const isoOfMs = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function addDays(iso: string, days: number): string {
  return isoOfMs(utc(iso) + days * DAY_MS);
}

/** Whole calendar days from one day to the next (negative when `to` is earlier). */
function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

const weekday = (iso: string): number => new Date(utc(iso)).getUTCDay();   // 0 Sunday … 6 Saturday

/** The working days (Mon–Fri) after `fromIso` up to and including `toIso`; 0 when `toIso` is not later. */
export function workdaysBetween(fromIso: string, toIso: string): number {
  let count = 0;
  for (let day = addDays(fromIso, 1); day <= toIso; day = addDays(day, 1)) {
    const dow = weekday(day);
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

/** The first working day after `iso`. */
export function nextWorkday(iso: string): string {
  let day = addDays(iso, 1);
  while (weekday(day) === 0 || weekday(day) === 6) day = addDays(day, 1);
  return day;
}

/** Quarterly filers file and pay by the 25th of the month after the quarter (copy of finance-metrics.ts filingDeadline). */
export function filingDeadlineOf(year: number, quarter: number): string {
  return quarter === 4 ? `${year + 1}-01-25` : `${year}-${String(quarter * 3 + 1).padStart(2, '0')}-25`;
}

/**
 * HomeTaskInput.vat.eurByDeadline: the signed cash of the forecast's BASE VAT items per filing deadline
 * (negative = to pay). From the day after its deadline the forecast lets the closed quarter go, while an
 * unpaid return still is "n d te laat" here (amendment G2): then the quarter's known net as of today
 * (cashForecastInput's vatQuarters) stands in, when it is something to pay.
 */
export function vatCashByDeadline(
  items: readonly { layer: string; amountEur: number; source: { type: string; year?: number; quarter?: number } }[],
  quarters: readonly { year: number; quarter: number; knownNetEur: number }[], today: string,
): Record<string, number> {
  const cash: Record<string, number> = {};
  const cents = (value: number): number => Math.round((Number.isFinite(value) ? value : 0) * 100);
  for (const item of items) {
    if (item.layer !== 'BASE' || item.source.type !== 'vat' || item.source.year === undefined || item.source.quarter === undefined) continue;
    const deadline = filingDeadlineOf(item.source.year, item.source.quarter);
    cash[deadline] = (cents(cash[deadline] ?? 0) + cents(item.amountEur)) / 100;
  }
  const year = Number(today.slice(0, 4));
  const quarter = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;
  const closed = quarter === 1 ? { year: year - 1, quarter: 4 } : { year, quarter: quarter - 1 };
  const deadline = filingDeadlineOf(closed.year, closed.quarter);
  const known = quarters.find((row) => row.year === closed.year && row.quarter === closed.quarter)?.knownNetEur;
  if (deadline < today && cash[deadline] === undefined && known !== undefined && cents(known) < 0) cash[deadline] = cents(known) / 100;
  return cash;
}

/** The day of an instant in Brussels (the customer's `at` is UTC). */
function brusselsDay(instant: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date(instant));
}

const eurFormat = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
/** "€ 1.000", "− € 7.940". */
export function eurText(value: number): string {
  const rounded = Math.round(value);
  return (rounded < 0 ? '− ' : '') + eurFormat.format(Math.abs(rounded));
}

const dayFormat = new Intl.DateTimeFormat('nl-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthFormat = new Intl.DateTimeFormat('nl-BE', { month: 'short', timeZone: 'UTC' });
/** "di 13 okt". */
export function dayText(iso: string): string {
  return dayFormat.format(new Date(utc(iso)));
}
/** "3–11 nov", or "28 okt–3 nov" across a month. */
function rangeText(from: string, to: string): string {
  const month = (iso: string): string => monthFormat.format(new Date(utc(iso)));
  const day = (iso: string): number => Number(iso.slice(8, 10));
  if (from === to) return `${day(from)} ${month(from)}`;
  return from.slice(0, 7) === to.slice(0, 7)
    ? `${day(from)}–${day(to)} ${month(to)}`
    : `${day(from)} ${month(from)}–${day(to)} ${month(to)}`;
}

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);

/* ------------------------------------------------- "Taak van maken" marker */

/** 32-bit FNV-1a of a text, as 8 hex digits. */
export function fnv1a8(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

const MARKER_LINE = /^\s*\[home:([^\]#\s]+)#([0-9a-f]{8})\]\s*$/;

/** The marker line a task made from a home item carries: "[home:<key>#<hash of its detail>]". */
export function homeMarker(task: Pick<HomeTask, 'key' | 'detail'>): string {
  return `[home:${task.key}#${fnv1a8(task.detail)}]`;
}

/** The `<key>#<hash>` of every marker line in a note. */
export function homeMarkersOf(note: string | null | undefined): string[] {
  return (note ?? '').split('\n').flatMap((line) => {
    const match = MARKER_LINE.exec(line);
    return match ? [`${match[1]}#${match[2]}`] : [];
  });
}

/** A note as people read it: the marker lines taken out (null when nothing else is left). */
export function stripHomeMarkers(note: string | null | undefined): string | null {
  const text = (note ?? '').split('\n').filter((line) => !MARKER_LINE.test(line)).join('\n').trim();
  return text || null;
}

/* ================================================================= model */

const TIER_UP: Readonly<Record<Tier, Tier>> = { ooknog: 'vandaag', vandaag: 'nu', nu: 'nu' };
const SYSTEM_ACTIONS: HomeAction[] = ['later', 'taak'];
const financeTarget = (location: Record<string, string>): HomeTarget => ({ kind: 'finance', location: { ...location } });

type Candidate = Omit<HomeTask, 'escalated'> & { escalated?: boolean };

function plannerTasks(input: HomeTaskInput): Candidate[] {
  const { today } = input;
  const out: Candidate[] = [];
  for (const item of input.planner) {
    if (item.kind !== 'TASK' || item.done) continue;
    const onDate = item.onDate;
    let tier: Tier | null = null;
    let chip: HomeTask['chip'] = { label: 'Vandaag', tone: 'warn' };
    let daysLate = 0;
    if (onDate && onDate < today) {
      tier = 'nu';
      daysLate = daysBetween(onDate, today);
      chip = { label: `${daysLate} d te laat`, tone: 'danger' };
    } else if (onDate === today) {
      tier = 'vandaag';
    } else if (item.pinned && (!onDate || onDate <= addDays(today, PINNED_TASK_AHEAD_DAYS))) {
      tier = 'vandaag';
      chip = { label: 'Vastgepind', tone: 'accent' };
    }
    if (!tier) continue;
    const noteLine = stripHomeMarkers(item.note)?.split('\n')[0]?.trim();
    /* Morgen only moves a task that is due: a pinned task planned later (or without a day) is never pulled forward or given a day. */
    const due = !!onDate && onDate <= today;
    out.push({
      key: `planner:${item.id}`, source: 'planner', tier, title: item.title,
      context: ['Taak', onDate ? `gepland ${dayText(onDate)}` : 'zonder dag', noteLine].filter(Boolean).join(' · '),
      chip, eur: null, count: null, daysLate, due: onDate,
      verb: due ? 'Morgen' : 'Openen', target: { kind: 'planner', id: item.id }, plannerId: item.id,
      actions: due ? ['klaar', 'morgen'] : ['klaar'], detail: `${onDate ?? ''}|${item.title}`,
    });
  }
  return out;
}

const CUSTOMER_KINDS: readonly { kind: string; one: string; many: string }[] = [
  { kind: 'WEBSITE_AANVRAAG', one: 'websiteaanvraag', many: 'websiteaanvragen' },
  { kind: 'VOORSTEL', one: 'wijziging', many: 'wijzigingen' },
  { kind: 'LEVERTERMIJN', one: 'levertermijn', many: 'levertermijnen' },
  { kind: 'VRACHT', one: 'vracht', many: 'vrachten' },
  { kind: 'OPNIEUW_VERSTUREN', one: 'opnieuw versturen', many: 'opnieuw te versturen' },
];

function customersTask(input: HomeTaskInput): Candidate | null {
  const items = input.customers;
  if (!items.length) return null;
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const known = new Set(CUSTOMER_KINDS.map((row) => row.kind));
  const parts = [
    ...CUSTOMER_KINDS.filter((row) => counts.has(row.kind)).map((row) => {
      const n = counts.get(row.kind)!;
      return n === 1 ? row.one : `${n} ${row.many}`;
    }),
    ...[...counts].filter(([kind]) => !known.has(kind)).sort(([a], [b]) => a.localeCompare(b))
      .map(([kind, n]) => (n === 1 ? kind.toLowerCase() : `${n} × ${kind.toLowerCase()}`)),
  ];
  const times = items.flatMap((item) => (item.at && !Number.isNaN(Date.parse(item.at)) ? [Date.parse(item.at)] : []));
  const oldest = times.length ? Math.min(...times) : null;
  let tier: Tier = 'vandaag';
  let chip: HomeTask['chip'] = { label: 'Klant wacht', tone: 'warn' };
  if (oldest !== null) {
    const hours = Math.max(0, Math.floor((input.nowMs - oldest) / 3_600_000));
    const workdays = workdaysBetween(brusselsDay(new Date(oldest).toISOString()), input.today);
    if (workdays >= CUSTOMER_WAIT_NU_WORKDAYS) tier = 'nu';
    chip = hours < 24 || workdays === 0
      ? { label: hours < 1 ? 'Wacht < 1 u' : `Wacht ${hours} u`, tone: tier === 'nu' ? 'danger' : 'warn' }
      : { label: `Wacht ${workdays} ${plural(workdays, 'werkdag', 'werkdagen')}`, tone: tier === 'nu' ? 'danger' : 'warn' };
  }
  return {
    key: 'customers', source: 'customers', tier, escalated: tier === 'nu', title: 'Klanten wachten', context: parts.join(' · '),
    chip, eur: null, count: items.length, daysLate: 0, due: null,
    verb: 'Openen', target: { kind: 'bell' }, plannerId: null, actions: SYSTEM_ACTIONS,
    detail: items.map((item) => `${item.kind}|${item.orderNumber}`).sort().join(','),
  };
}

function containerDueTask(input: HomeTaskInput): Candidate | null {
  const rows = input.containerDue;
  if (!rows.length) return null;
  const n = rows.length;
  const ids = rows.map((row) => row.orderId).sort((a, b) => a - b);
  const eur = rows.reduce((sum, row) => sum + Math.round(row.eur * 100), 0) / 100;
  const term = n === 1 ? rows[0].termLabel : rows.map((row) => row.label).join(', ');
  return {
    key: `container-due:${ids.join(',')}`, source: 'container-due', tier: 'nu',
    title: n === 1 ? `Containertermijn ${rows[0].label} betalen` : `${n} containertermijnen betalen`,
    context: ['Volgens de afspraak bij de container', term].filter(Boolean).join(' · '),
    chip: { label: 'Nu betalen', tone: 'danger' }, eur, count: n, daysLate: 0, due: input.today,
    verb: 'Betalen', target: financeTarget({ view: 'open', tab: 'containers' }), plannerId: null, actions: SYSTEM_ACTIONS,
    detail: rows.map((row) => `${row.orderId}:${row.eur}`).sort().join(','),
  };
}

function advanceTask(input: HomeTaskInput): Candidate | null {
  const { advances, today } = input;
  if (advances.count <= 0 || !advances.first) return null;
  const first = advances.first;
  const due = first.due;
  let tier: Tier;
  let source: HomeSource = 'advance';
  let chip: HomeTask['chip'];
  let daysLate = 0;
  if (advances.overdueEur > 0) {
    tier = 'nu';
    daysLate = due && due < today ? daysBetween(due, today) : 0;
    chip = { label: daysLate ? `${daysLate} d over datum` : 'Over datum', tone: 'danger' };
  } else if (due && due <= addDays(today, ADVANCE_SOON_DAYS)) {
    tier = 'vandaag';
    const inDays = daysBetween(today, due);
    chip = { label: inDays <= 0 ? 'Vandaag' : inDays === 1 ? 'Morgen' : `over ${inDays} d`, tone: 'warn' };
  } else {
    tier = 'ooknog';
    source = 'advance-later';
    chip = due ? { label: `over ${daysBetween(today, due)} d`, tone: 'grey' } : { label: 'Geen datum', tone: 'grey' };
  }
  const n = advances.count;
  const ids = [...(advances.orderIds?.length ? advances.orderIds : [first.orderId])].sort((a, b) => a - b);
  const context = [
    `${eurText(advances.eur)} gepland, nog niet gefactureerd`, 'excl. btw',
    advances.overdueEur > 0 ? `${eurText(advances.overdueEur)} over datum` : null,
    `eerst ${first.label}${due ? ` · ${dayText(due)}` : ''}`,
  ].filter(Boolean).join(' · ');
  return {
    key: `advance:${ids.join(',')}`, source, tier,
    title: n === 1 ? `Voorschotfactuur ${first.label} maken` : `${n} voorschotfacturen maken`,
    context, chip, eur: advances.eur, count: n, daysLate, due,
    verb: 'Maken', target: { kind: 'route', path: ['/purchasing', first.orderId], query: { section: 'payments' } },
    plannerId: null, actions: SYSTEM_ACTIONS,
    detail: `${n}|${advances.eur}|${advances.overdueEur}|${first.orderId}|${due ?? ''}`,
  };
}

function invoiceTasks(input: HomeTaskInput): Candidate[] {
  const { today } = input;
  const late = input.invoicesOverdue.filter((row) => row.remainingEur > 0 && row.dueDate < today);
  const target: HomeTarget = { kind: 'route', path: ['/sales'], query: { scope: 'ALL', tab: 'FACTUUR', payment: 'open' } };
  const row = (rows: typeof late, big: boolean): Candidate | null => {
    if (!rows.length) return null;
    const oldest = [...rows].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.number.localeCompare(b.number))[0];
    const days = daysBetween(oldest.dueDate, today);
    const tier: Tier = !big ? 'ooknog' : days > OVERDUE_INVOICE_NU_DAYS ? 'nu' : 'vandaag';
    const n = rows.length;
    return {
      key: big ? 'overdue-invoices' : 'small-invoices', source: big ? 'overdue-invoices' : 'small-invoices', tier,
      escalated: tier === 'nu',
      title: n === 1 ? `Factuur ${rows[0].number} opvolgen` : `${n} facturen opvolgen`,
      context: big ? `Over de vervaldag · oudste ${oldest.customer}, ${days} ${plural(days, 'dag', 'dagen')}`
        : `Over de vervaldag · elk onder ${eurText(OVERDUE_INVOICE_MIN_EUR)} · oudste ${oldest.customer}`,
      chip: { label: `${days} d te laat`, tone: tier === 'nu' ? 'danger' : tier === 'vandaag' ? 'warn' : 'grey' },
      eur: rows.reduce((sum, item) => sum + Math.round(item.remainingEur * 100), 0) / 100, count: n,
      daysLate: days, due: oldest.dueDate, verb: 'Opvolgen', target, plannerId: null, actions: SYSTEM_ACTIONS,
      detail: rows.map((item) => `${item.id}:${item.remainingEur}`).sort().join(','),
    };
  };
  return [
    row(late.filter((item) => item.remainingEur >= OVERDUE_INVOICE_MIN_EUR), true),
    row(late.filter((item) => item.remainingEur < OVERDUE_INVOICE_MIN_EUR), false),
  ].filter((item): item is Candidate => item !== null);
}

function vatTask(input: HomeTaskInput): Candidate | null {
  const { today } = input;
  const year = Number(today.slice(0, 4));
  const quarter = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;
  const period = quarter === 1 ? { year: year - 1, quarter: 4 } : { year, quarter: quarter - 1 };
  const key = `${period.year}-Q${period.quarter}`;
  if (input.vat.paidPeriods?.includes(key)) return null;
  const deadline = filingDeadlineOf(period.year, period.quarter);
  const daysTo = daysBetween(today, deadline);
  const cash = input.vat.eurByDeadline[deadline];
  const toPay = cash !== undefined && cash < 0 ? Math.round(-cash * 100) / 100 : null;
  let tier: Tier;
  let chip: HomeTask['chip'];
  let daysLate = 0;
  if (daysTo > VAT_SHOW_DAYS) return null;
  if (daysTo >= 0) {
    tier = daysTo <= VAT_NU_DAYS ? 'nu' : 'vandaag';
    chip = { label: daysTo === 0 ? 'vandaag uiterste dag' : `nog ${daysTo} ${plural(daysTo, 'dag', 'dagen')}`, tone: tier === 'nu' ? 'danger' : 'warn' };
  } else {
    /* After the 25th only a known, unpaid amount to pay keeps the row: a refund or a zero quarter drops off. */
    daysLate = -daysTo;
    if (input.vat.paidPeriods === null || toPay === null || daysLate > VAT_LATE_SHOW_DAYS) return null;
    tier = 'nu';
    chip = { label: `${daysLate} d te laat`, tone: 'danger' };
  }
  return {
    key: `vat:${key}`, source: 'vat', tier, title: `Btw-aangifte Q${period.quarter} indienen`,
    context: `uiterste dag ${dayText(deadline)}`, chip, eur: toPay, count: null, daysLate, due: deadline,
    verb: 'Aangifte', target: financeTarget({ view: 'analysis', tab: 'vat', year: String(period.year), quarter: String(period.quarter) }),
    plannerId: null, actions: SYSTEM_ACTIONS, detail: `${key}|${toPay ?? ''}`,
  };
}

function krapTask(input: HomeTaskInput): Candidate | null {
  const { tight, today } = input;
  if (!tight || tight.from > addDays(today, KRAP_WITHIN_DAYS)) return null;
  const inDays = daysBetween(today, tight.from);
  return {
    key: `krap:${tight.from}`, source: 'krap', tier: 'nu', title: `Bank wordt krap · ${rangeText(tight.from, tight.to)}`,
    context: `laagste ${eurText(tight.lowestEur)} op ${dayText(tight.lowestDay)} · buffer ${eurText(tight.bufferEur)}`,
    chip: { label: inDays <= 0 ? 'nu' : `over ${inDays} d`, tone: 'danger' },
    eur: tight.lowestEur, count: null, daysLate: 0, due: tight.from,
    verb: 'Bekijken', target: { kind: 'cash' }, plannerId: null, actions: SYSTEM_ACTIONS,
    detail: `${tight.from}|${tight.to}|${Math.round(tight.lowestEur)}`,
  };
}

function simpleTasks(input: HomeTaskInput): Candidate[] {
  const { today } = input;
  const out: Candidate[] = [];
  const base = { escalated: false, eur: null, daysLate: 0, due: null, plannerId: null, actions: SYSTEM_ACTIONS };
  if (input.loginRequests > 0) {
    const n = input.loginRequests;
    out.push({ ...base, key: 'login', source: 'login', tier: 'vandaag', title: 'Login-aanvragen goedkeuren',
      context: 'Wachten op goedkeuring', chip: { label: 'Klant wacht', tone: 'warn' }, count: n,
      verb: 'Bekijken', target: { kind: 'route', path: ['/klantlogins'] }, detail: String(n) });
  }
  if (input.overdueCosts && input.overdueCosts.count > 0) {
    const costs = input.overdueCosts;
    out.push({ ...base, key: 'overdue-costs', source: 'overdue-costs', tier: 'vandaag', title: costs.title,
      context: `De oudste staat er al ${costs.oldestDays} dagen`, chip: { label: `${costs.oldestDays} d open`, tone: 'warn' },
      eur: costs.eur, count: costs.count, verb: 'Betalen', target: financeTarget(costs.location), detail: `${costs.count}|${costs.eur}` });
  }
  for (const arrival of input.arrivals) {
    const inDays = daysBetween(today, arrival.date);
    if (inDays < 0 || inDays > ARRIVAL_SOON_DAYS) continue;
    const when = inDays === 0 ? 'vandaag' : inDays === 1 ? 'morgen' : dayText(arrival.date);
    out.push({ ...base, key: `arrival:${arrival.orderId}:${arrival.date}`, source: 'arrival', tier: 'vandaag',
      title: `${arrival.label} komt ${when} aan`, context: ['Ontvangst voorbereiden', arrival.sub].filter(Boolean).join(' · '),
      chip: { label: when.charAt(0).toUpperCase() + when.slice(1), tone: 'accent' }, count: null, due: arrival.date,
      verb: 'Openen', target: { kind: 'route', path: ['/purchasing', arrival.orderId] }, detail: arrival.date });
  }
  if (input.purchaseCheck > 0) {
    const n = input.purchaseCheck;
    out.push({ ...base, key: 'purchase-check', source: 'purchase-check', tier: 'ooknog', title: 'Inkoop controleren',
      context: `${n} ${plural(n, 'order', 'orders')} met een opmerking`, chip: { label: 'Nakijken', tone: 'grey' }, count: n,
      verb: 'Bekijken', target: { kind: 'route', path: ['/purchasing'] }, detail: String(n) });
  }
  if (input.settlements > 0) {
    const n = input.settlements;
    out.push({ ...base, key: 'settlement', source: 'settlement', tier: 'ooknog', title: 'Veilingafrekening maken',
      context: 'Partnercontainers ontvangen; het veilingoverzicht wacht', chip: { label: 'Afrekenen', tone: 'grey' }, count: n,
      verb: 'Maken', target: { kind: 'route', path: ['/analyses/purchasing'] }, detail: String(n) });
  }
  if (input.catalog > 0) {
    const n = input.catalog;
    out.push({ ...base, key: 'catalog', source: 'catalog', tier: 'ooknog', title: 'Websiteproducten aanvullen',
      context: 'Nog niet publicatieklaar', chip: { label: 'Aanvullen', tone: 'grey' }, count: n,
      verb: 'Bekijken', target: { kind: 'route', path: ['/website/products'] }, detail: String(n) });
  }
  const chips: Readonly<Record<HomeTaskInput['housekeeping'][number]['kind'], string>> = {
    'bank-lines': 'Koppelen', 'recurring-due': 'Boeken', 'open-credits': 'Tegoed', regimes: 'Bevestigen',
  };
  for (const item of input.housekeeping) {
    if (item.count <= 0) continue;
    out.push({ ...base, key: item.kind, source: item.kind, tier: 'ooknog', title: item.title, context: item.detail,
      chip: { label: chips[item.kind], tone: 'grey' }, eur: item.eur, count: item.count,
      verb: 'Bekijken', target: financeTarget(item.location), detail: `${item.count}|${item.eur ?? ''}` });
  }
  return out;
}

/** Within a tier: the longest late first, then the nearest due day, then the biggest amount, then the source, then the title. */
export function compareTasks(left: HomeTask, right: HomeTask): number {
  return right.daysLate - left.daysLate
    || (left.due ?? '9999-12-31').localeCompare(right.due ?? '9999-12-31')
    || Math.abs(right.eur ?? 0) - Math.abs(left.eur ?? 0)
    || SOURCE_ORDER.indexOf(left.source) - SOURCE_ORDER.indexOf(right.source)
    || left.title.localeCompare(right.title, 'nl')
    || left.key.localeCompare(right.key);
}

export function homeTasks(input: HomeTaskInput): HomeTaskList {
  const { today } = input;
  const taskKeys = new Set(input.taskKeys);
  const candidates: Candidate[] = [
    ...plannerTasks(input),
    customersTask(input), containerDueTask(input), advanceTask(input),
    ...invoiceTasks(input), vatTask(input), krapTask(input), ...simpleTasks(input),
  ].filter((task): task is Candidate => task !== null);

  const shown: HomeTask[] = [];
  for (const candidate of candidates) {
    const task: HomeTask = { ...candidate, escalated: candidate.escalated ?? false };
    /* "Taak van maken": an open planner task stands in for this exact item. */
    if (task.plannerId === null && taskKeys.has(`${task.key}#${fnv1a8(task.detail)}`)) continue;
    const later = input.later[task.key];
    if (later) {
      if (later.detail === task.detail && today < later.until) continue;
      if (later.count >= LATER_ESCALATE_COUNT && task.tier !== 'nu') {
        task.tier = TIER_UP[task.tier];
        task.escalated = true;
        if (task.chip.tone === 'grey') task.chip = { ...task.chip, tone: 'warn' };
      }
    }
    shown.push(task);
  }

  const nu = shown.filter((task) => task.tier === 'nu').sort(compareTasks);
  const vandaag = shown.filter((task) => task.tier === 'vandaag').sort(compareTasks);
  const ookNog = shown.filter((task) => task.tier === 'ooknog').sort(compareTasks);
  const ranked = [...nu, ...vandaag];
  const missing = COVERAGE_ORDER.filter((source) => !input.sources[source]);
  const count = ranked.length;
  return {
    top: ranked.slice(0, HOME_TASK_CAP), more: ranked.slice(HOME_TASK_CAP), ookNog,
    count, total: count + ookNog.length, complete: missing.length === 0, missing: [...missing],
    allClear: missing.length === 0 && count === 0,
  };
}

/** The next Later state after one more "Later" on this task: hidden until the next workday, and counted. */
export function laterNext(state: LaterState, task: Pick<HomeTask, 'key' | 'detail'>, today: string): Record<string, LaterEntry> {
  const previous = state[task.key];
  return { ...state, [task.key]: { until: nextWorkday(today), detail: task.detail, count: (previous?.count ?? 0) + 1 } };
}

/** The Later state without entries that ended more than 30 days ago, and at most `max` keys (the latest kept). */
export function laterPruned(state: LaterState, today: string, max = 200): Record<string, LaterEntry> {
  const cutoff = addDays(today, -30);
  const kept = Object.entries(state).filter(([, entry]) => entry && typeof entry.until === 'string' && entry.until >= cutoff)
    .sort(([, a], [, b]) => b.until.localeCompare(a.until)).slice(0, max);
  return Object.fromEntries(kept);
}

/** "Waarom deze volgorde": the rules in words, built from the thresholds above. */
export function whyOrderLines(): string[] {
  const arrival = ARRIVAL_SOON_DAYS === 1 ? 'vandaag of morgen' : `binnen ${ARRIVAL_SOON_DAYS} dagen`;
  return [
    `Nu: geld of een termijn loopt vandaag uit — containertermijnen die nu vervallen, voorschotfacturen over datum, taken van vroeger, `
      + `de btw-aangifte vanaf ${VAT_NU_DAYS} dagen voor de 25e, de bank die binnen ${KRAP_WITHIN_DAYS} dagen krap wordt, `
      + `klanten die ${CUSTOMER_WAIT_NU_WORKDAYS} werkdagen of langer wachten, facturen meer dan ${OVERDUE_INVOICE_NU_DAYS} dagen te laat.`,
    `Vandaag: iemand wacht op ons of een termijn valt binnen ${VAT_SHOW_DAYS} dagen — klanten, login-aanvragen, taken voor vandaag, `
      + `facturen over de vervaldag vanaf ${eurText(OVERDUE_INVOICE_MIN_EUR)}, kosten langer dan ${OVERDUE_COST_DAYS_COPY} dagen open, `
      + `voorschotfacturen binnen ${ADVANCE_SOON_DAYS} dagen, een container die ${arrival} aankomt, `
      + `de btw-aangifte vanaf ${VAT_SHOW_DAYS} dagen voor de 25e.`,
    `Ook nog: opruimen zonder termijn. Nooit bij de eerste ${HOME_TASK_CAP}.`,
    'Binnen een groep: eerst wat het langst te laat is, dan het hoogste bedrag.',
    `Later verbergt tot de volgende werkdag. Na ${LATER_ESCALATE_COUNT} keer Later schuift een punt een groep hoger.`,
  ];
}
