import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { AnalyticsApi } from '../../core/api/analytics-api';
import type { WebsiteAnalyticsReport } from '../../core/api/analytics-api';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import { FinanceApi } from '../../core/api/finance-api';
import type {
  CompanyCost, Customer, IncomingPaymentRow, PartnerFinancing, Product, PurchaseOrderView, SalesOrderView, Supplier,
} from '../../core/api/models';
import { PlannerApi, PlannerStore } from '../../core/api/planner-api';
import type { PlannerItem } from '../../core/api/planner-api';
import { SalesApi } from '../../core/api/sales-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { WorkQueue } from '../../core/api/work-queue';
import { plannedBusinessDay } from '../../shared/business-days';
import { Ui } from '../../shared/ui';
import { partnerFinancingAnalysis } from '../analyses/analysis-metrics';
import { cashOptionsOf } from '../analyses/cash-options';
import { CashData } from '../analyses/cash-sources';
import type { CashPageData } from '../analyses/cash-sources';
import { DEFAULT_CASH_LOCATION } from '../analyses/cash-url';
import { readDismissed } from '../finance/cash-dismissed';
import { buildCashForecast } from '../finance/cash-forecast';
import type { CashForecast, ForecastVatQuarter } from '../finance/cash-forecast';
import { cashForecastInput, vooruitblikOf } from '../finance/cash-forecast-input';
import { weekdayDayMonth } from '../finance/cash-format';
import { receivableTotals } from '../finance/incoming-money';
import { agendaModel } from './agenda-entries';
import { localPlannerDate, purchasePlannerMilestones } from './dashboard-today-state';
import { cashHeadline, outlookFigures } from './home-cash';
import { monthWindows } from './home-figures';
import { readLater, writeLater } from './home-later';
import { COVERAGE_ORDER, homeMarker, homeTasks, laterNext, nextWorkday } from './home-priority';
import type { CoverageSource, HomeTask, LaterState } from './home-priority';
import { agendaInputOf, attentionOf, homeTaskInputOf, vatOf } from './home-sources';
import type { HomeCashSources } from './home-sources';

/*
 * Everything the home shows, loaded and derived once (spec-home §1, §7):
 * the page data (sales, purchases, products, families, suppliers, website,
 * costs, incoming payments, partner financing, customers, planner, bell),
 * the shared CashData with the 6-month forecast built at idle, the ranked
 * tasks (home-priority.ts), the agenda model (agenda-entries.ts) and the
 * row actions. Root, so the desk, the phone, the Agenda and Open punten
 * pages and every widget read the same copy; a page calls enterHome().
 *
 * Every source fails on its own and keeps its last good data; a failed one
 * reads "— · Opnieuw" on its widget and is named in the status, never a 0.
 */

/** The home's own calls, by the word the status names them with. */
export type HomeSource = 'verkoop' | 'inkoop' | 'voorraad' | 'websiteproducten' | 'leveranciers' | 'websitebezoek' | 'kosten'
  | 'inkomende betalingen' | 'partnerfinanciering' | 'klanten';
/** loading: never answered yet; failed: the last attempt failed (the last good data stays); ready: answered. */
export type SourceState = 'loading' | 'ready' | 'failed';

const PAGE_SOURCES: readonly HomeSource[] = ['verkoop', 'inkoop', 'voorraad', 'websiteproducten', 'leveranciers', 'websitebezoek', 'kosten',
  'inkomende betalingen', 'partnerfinanciering', 'klanten'];
/** The home calls the forecast needs; any of them failing makes it partial ("Prognose onvolledig"). */
const FORECAST_SOURCES: readonly HomeSource[] = ['verkoop', 'inkoop', 'kosten', 'inkomende betalingen', 'klanten'];
/** Named after the coverage words in the status, in this order. */
const OTHER_SOURCES: readonly HomeSource[] = ['voorraad', 'websiteproducten', 'leveranciers', 'websitebezoek', 'klanten'];
/** A visit older than this fetches the page data again (the old home fetched on every visit; the Agenda and Open pages sit in between). */
const PAGE_MAX_AGE_MS = 20_000;

/** "08:40" of an epoch time, local. */
function clockOf(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** Runs at idle (Safari has no requestIdleCallback: a short timeout then). */
function whenIdle(run: () => void): () => void {
  const host = window as Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (typeof host.requestIdleCallback === 'function') {
    const id = host.requestIdleCallback(run, { timeout: 1500 });
    return () => host.cancelIdleCallback?.(id);
  }
  const id = setTimeout(run, 50);
  return () => clearTimeout(id);
}

@Injectable({ providedIn: 'root' })
export class HomeData {
  private readonly salesApi = inject(SalesApi);
  private readonly finance = inject(FinanceApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly catalog = inject(CatalogApi);
  private readonly analytics = inject(AnalyticsApi);
  private readonly plannerApi = inject(PlannerApi);
  private readonly ui = inject(Ui);
  readonly planner = inject(PlannerStore);
  readonly work = inject(WorkQueue);
  readonly cashData = inject(CashData);

  /* ------------------------------------------------------------ the day */

  /** The local calendar day; checkDay() moves it (and reloads) at midnight. */
  readonly today = signal(localPlannerDate(new Date()));
  /** The clock, moved by checkDay() every minute: "Wacht 17 u", the rest of today, the greeting. */
  readonly now = signal(Date.now());
  readonly nowTime = computed(() => clockOf(this.now()));
  readonly hour = computed(() => new Date(this.now()).getHours());
  /** This month, last month's same days, this year, six bar months: they follow the day (bug 6). */
  readonly windows = computed(() => monthWindows(this.today()));

  /* ------------------------------------------------------------ page data */

  readonly salesOrders = signal<SalesOrderView[]>([]);
  readonly purchases = signal<PurchaseOrderView[]>([]);
  readonly products = signal<Product[]>([]);
  readonly suppliers = signal<Supplier[]>([]);
  readonly website = signal<WebsiteAnalyticsReport | null>(null);
  readonly costs = signal<CompanyCost[]>([]);
  readonly incomingPayments = signal<IncomingPaymentRow[]>([]);
  readonly partnerSummaries = signal<PartnerFinancing[]>([]);
  readonly customers = signal<Customer[]>([]);
  /** Families (else products) not ready for the website: Website "Aanvullen" and the Ook nog row. */
  readonly catalogAttention = signal(0);

  private readonly states = signal<Record<HomeSource, SourceState>>(
    Object.fromEntries(PAGE_SOURCES.map((source) => [source, 'loading'])) as Record<HomeSource, SourceState>);
  /** The first load is under way (nothing to show yet). */
  readonly loading = signal(true);
  /** A later load is under way; the last data stays on screen. */
  readonly refreshing = signal(false);
  /** When the last load finished (epoch ms): "Alles bijgewerkt om 08:12". */
  readonly loadedAt = signal<number | null>(null);
  private readonly loadedOnce = signal(false);
  private readonly bellAnswered = signal(false);
  private busy = false;
  /** Home routes on screen (enterHome): the forecast and the advance schedules follow CashData only while one is. */
  private readonly active = signal(0);
  /** The CashData round the partner financings answered in: the advance schedules load with those, never with an older visit's. */
  private readonly partnersRound = signal(0);

  /** One source's state. */
  stateOf(source: HomeSource): SourceState {
    return this.states()[source];
  }

  /** Several sources as one widget state: any failed → failed, any still loading → loading. */
  combined(...sources: HomeSource[]): SourceState {
    const states = this.states();
    if (sources.some((source) => states[source] === 'failed')) return 'failed';
    return sources.some((source) => states[source] === 'loading') ? 'loading' : 'ready';
  }

  /* -------------------------------------------------------------- derived */

  readonly financing = computed(() => partnerFinancingAnalysis(this.purchases(), this.salesOrders(), [], this.partnerSummaries()));
  readonly receivables = computed(() => receivableTotals(this.salesOrders()));
  readonly supplierNames = computed(() =>
    new Map(this.suppliers().flatMap((supplier) => supplier.id == null ? [] : [[supplier.id, supplier.name] as const])));
  /** The containers' own agenda lines (ordered, sailed, expected, received). */
  readonly milestones = computed(() => purchasePlannerMilestones(this.purchases(), this.supplierNames()));
  /** Orders with a remark (Inkoop "Controleren" and the Ook nog row). */
  readonly purchaseAttention = computed(() => this.purchases().filter((row) => (row.attention?.length ?? 0) > 0));

  /* ---------------------------------------------------------------- cash */

  /** The Kasprognose's "Niet deze" choices, read on every load (Analyses may have changed them). */
  private readonly dismissed = signal<string[]>(readDismissed());
  /** The 6-month forecast with Analyses' defaults: both show the same lowest point. Null until built. */
  readonly forecast = signal<CashForecast | null>(null);
  /** The VAT quarters that forecast was built from: the closed quarter's net after its deadline (vatOf). */
  private readonly forecastVat = signal<ForecastVatQuarter[]>([]);
  /** The forecast is being (re)built at idle. */
  readonly computing = signal(false);
  /** How long the last build took (ms), for the timing note; also a performance measure 'home-forecast'. */
  readonly forecastMs = signal<number | null>(null);

  private readonly cashPage = computed<CashPageData>(() => ({
    purchases: this.purchases(), suppliers: this.suppliers(), products: this.products(), salesOrders: this.salesOrders(),
    customers: this.customers(), costs: this.costs(), incomingPayments: this.incomingPayments(),
  }));
  /** The forecast's sources, once the page loaded and the bank is in. */
  private readonly forecastSources = computed(() => (this.loadedOnce() ? this.cashData.sourcesWith(this.cashPage(), this.today()) : null));
  private readonly cashOptions = computed(() => cashOptionsOf(DEFAULT_CASH_LOCATION, this.today(), this.dismissed()));

  /** The Vooruitblik (Kosten & bank's equation): cheap, there as soon as the bank is. */
  readonly outlook = computed(() => {
    const sources = this.forecastSources();
    return sources ? vooruitblikOf(sources) : null;
  });

  /** The desk Kas card's "Nu te betalen" and "Nog te ontvangen", each null when a source behind it failed (never a partial sum). */
  readonly outlookFigures = computed(() => {
    const states = this.states();
    return outlookFigures(this.outlook(), {
      costs: states.kosten === 'failed', purchases: states.inkoop === 'failed', sales: states.verkoop === 'failed',
      recurring: this.cashData.warnings().includes('vaste kosten'),
    });
  });

  /**
   * "Prognose onvolledig: …": CashData's words, then the home's own failed forecast sources. Without partner
   * financing the advance schedules cannot load, so that failure reads as CashData's own word for them, 'partners'.
   */
  readonly cashWarnings = computed(() => {
    const states = this.states();
    return [...new Set([...this.cashData.warnings(), ...(states.partnerfinanciering === 'failed' ? ['partners'] : []),
      ...FORECAST_SOURCES.filter((source) => states[source] === 'failed')])];
  });

  /** The Kas headline (state, bank, lowest point, first krap period). */
  readonly cash = computed(() => cashHeadline(this.forecast(), {
    bankMissing: this.cashData.state() === 'ready' && this.cashData.bankMissing(),
    warnings: this.cashWarnings(),
    computing: this.computing() || (!!this.forecastSources() && !this.forecast()),
    startEur: this.outlook()?.bankEur ?? null,
  }));

  /** What the home reads of CashData for its own counts. */
  private readonly homeCash = computed<HomeCashSources>(() => {
    const ready = this.cashData.state() === 'ready';
    return {
      bankAccounts: this.cashData.bankAccounts(), balances: this.cashData.balances(), statements: this.cashData.statements(),
      recurring: ready && !this.cashData.warnings().includes('vaste kosten') ? this.cashData.recurring() : null,
      bankLoaded: ready && !this.cashData.bankMissing(),
    };
  });

  /* --------------------------------------------------------------- tasks */

  /** The Later state (home-later.ts); hidden rows come back the next workday or when their detail changes. */
  readonly laterState = signal<LaterState>(readLater(localPlannerDate(new Date())));

  /** Which sources answered on the last load (CoverageSource, §4.4); a source still loading counts as not covered. */
  readonly coverage = computed<Record<CoverageSource, boolean>>(() => {
    const states = this.states();
    const cash = this.cash();
    return {
      agenda: this.planner.loaded() && !this.planner.error(),
      meldingen: this.bellAnswered() && !this.work.error(),
      verkoop: states.verkoop === 'ready', inkoop: states.inkoop === 'ready', partnerfinanciering: states.partnerfinanciering === 'ready',
      'inkomende betalingen': states['inkomende betalingen'] === 'ready', kosten: states.kosten === 'ready',
      bank: this.cashData.state() === 'ready' && !this.cashData.bankMissing(),
      kasprognose: cash.state === 'ready' || cash.state === 'no-reading',
    };
  });

  /** Every source has answered (or failed): from here "Niet volledig" names real failures, before it the page says "Bijwerken…". */
  readonly settled = computed(() => !this.loading() && this.bellAnswered()
    && !this.planner.loading() && (this.planner.loaded() || !!this.planner.error())
    && this.cash().state !== 'loading' && this.cash().state !== 'computing');

  /** The ranked list without the clock and Later (the expensive part, rebuilt only when the data changes). */
  private readonly taskBase = computed(() => {
    const sales = this.salesOrders();
    const costs = this.costs();
    const states = this.states();
    const attention = attentionOf({ today: this.today(), costs, sales, costsOk: states.kosten === 'ready', salesOk: states.verkoop === 'ready',
      cash: this.homeCash(), incoming: this.incomingPayments() });
    return homeTaskInputOf({
      today: this.today(), nowMs: 0, planner: this.planner.items(), actions: this.work.actions(), loginRequests: this.work.loginRequestCount(),
      purchases: this.purchases(), financing: this.financing(), sales, customers: this.customers(), costs, attention,
      cash: this.homeCash(), forecast: this.forecast(), vatQuarters: this.forecastVat(), headline: this.cash(), milestones: this.milestones(),
      catalog: this.catalogAttention(),
      later: {}, sources: this.coverage(),
    });
  });

  /** Nu / Vandaag / Ook nog, the cap, counts and coverage (home-priority.ts). */
  readonly tasks = computed(() => homeTasks({ ...this.taskBase(), nowMs: this.now(), later: this.laterState() }));

  /** The status words: the failed coverage sources in their order, then the other failed calls. Empty when all is well. */
  readonly warnings = computed(() => {
    const states = this.states();
    const cash = this.cash();
    const failed: string[] = [];
    for (const source of COVERAGE_ORDER) {
      if (source === 'agenda' && this.planner.error()) failed.push(source);
      else if (source === 'meldingen' && this.work.error()) failed.push(source);
      else if (source === 'bank' && cash.state === 'no-bank') failed.push(source);
      else if (source === 'kasprognose' && cash.state === 'partial') failed.push(source);
      else if (states[source as HomeSource] === 'failed') failed.push(source);
    }
    for (const source of OTHER_SOURCES) if (states[source] === 'failed') failed.push(source);
    return [...new Set(failed)];
  });

  /* -------------------------------------------------------------- agenda */

  readonly agenda = computed(() => agendaModel(agendaInputOf({
    today: this.today(), nowTime: this.nowTime(), planner: this.planner.items(), milestones: this.milestones(),
    forecast: this.forecast(), headline: this.cash(), sales: this.salesOrders(), salesOk: this.states().verkoop === 'ready',
    customers: this.customers(), cash: this.homeCash(), vat: vatOf(this.homeCash(), this.forecast(), this.forecastVat(), this.today()),
  })));

  constructor() {
    /*
     * The forecast at idle, after first paint; a newer input cancels the pending build. Only while a home
     * route is on screen (Analyses changing CashData does not rebuild it in the background), and not again
     * for the input it was last built from.
     */
    let built: { sources: unknown; options: unknown } | null = null;
    effect((onCleanup) => {
      const sources = this.forecastSources();
      const options = this.cashOptions();
      if (!sources || !this.active() || (built?.sources === sources && built.options === options)) return;
      this.computing.set(true);
      const cancel = whenIdle(() => {
        const started = performance.now();
        const input = cashForecastInput(sources);
        const forecast = buildCashForecast(input, options);
        const took = performance.now() - started;
        try { performance.measure('home-forecast', { start: started, duration: took }); } catch { /* older browsers */ }
        built = { sources, options };
        this.forecastMs.set(Math.round(took));
        this.forecastVat.set(input.vatQuarters);
        this.forecast.set(forecast);
        this.computing.set(false);
      });
      onCleanup(() => {
        cancel();
        this.computing.set(false);
      });
    });
    /*
     * The advance schedules: once per CashData round, while a home route is on screen, and only with the
     * partner financings that answered in this round (amendment B). loadSchedules claims a round for whoever
     * calls first, so an older visit's financings must never claim Analyses' round.
     */
    effect(() => {
      const round = this.cashData.generation();
      if (round === 0 || !this.active() || this.partnersRound() !== round) return;
      const financings = this.partnerSummaries();
      untracked(() => void this.cashData.loadSchedules(financings, round));
    });
  }

  /* ---------------------------------------------------------------- load */

  /**
   * A home route was entered: the day is checked, CashData ensured, and the page data fetched when it is
   * older than 20 s or CashData started a new round (its advance schedules need this round's financings).
   * Returns the leave function for the route's onDestroy.
   */
  enter(): () => void {
    this.active.update((count) => count + 1);
    this.checkDay();
    const round = this.cashData.generation();
    this.cashData.ensure(this.today());
    const at = this.loadedAt();
    if (at === null || Date.now() - at > PAGE_MAX_AGE_MS || this.cashData.generation() !== round) void this.fetchPage();
    return () => this.active.update((count) => Math.max(0, count - 1));
  }

  /** The clock moves; on a new day everything loads again (a home left open overnight). */
  checkDay(): void {
    this.now.set(Date.now());
    const date = localPlannerDate(new Date());
    if (date === this.today()) return;
    this.today.set(date);
    void this.load();
  }

  /** "Opnieuw" and "Vernieuwen": the page data and CashData, both fetched again. */
  async load(): Promise<void> {
    if (this.cashData.state() === 'idle') this.cashData.ensure(this.today());
    else void this.cashData.reload(this.today());
    await this.fetchPage();
  }

  private async fetchPage(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    if (this.loadedOnce()) this.refreshing.set(true); else this.loading.set(true);
    this.dismissed.set(readDismissed());
    try {
      const [sales, purchases, products, families, suppliers, website, costs, incoming, partners, customers] = await Promise.allSettled([
        this.salesApi.orders(), this.sourcing.purchaseOrders(), this.catalog.products(), this.catalog.productFamilies(), this.sourcing.suppliers(),
        this.analytics.websiteReport(7), this.finance.costs(), this.salesApi.incomingPayments(), this.sourcing.partnerFinancings(),
        this.salesApi.customers(), this.planner.reload(), this.work.refresh().then(() => this.bellAnswered.set(true)),
      ] as const);
      const next = { ...this.states() };
      const take = <T>(result: PromiseSettledResult<T>, source: HomeSource, apply: (value: T) => void): void => {
        if (result.status === 'fulfilled') { apply(result.value); next[source] = 'ready'; } else next[source] = 'failed';
      };
      take(sales, 'verkoop', (value) => this.salesOrders.set(value));
      take(purchases, 'inkoop', (value) => this.purchases.set(value));
      take(products, 'voorraad', (value) => this.products.set(value));
      take(suppliers, 'leveranciers', (value) => this.suppliers.set(value));
      take(website, 'websitebezoek', (value) => this.website.set(value));
      take(costs, 'kosten', (value) => this.costs.set(value));
      take(incoming, 'inkomende betalingen', (value) => this.incomingPayments.set(value));
      take(partners, 'partnerfinanciering', (value) => {
        this.partnerSummaries.set(value);
        this.partnersRound.set(this.cashData.generation());
      });
      take(customers, 'klanten', (value) => this.customers.set(value));
      take(families, 'websiteproducten', (value) => this.catalogAttention.set(value
        .filter((family) => family.active && family.publicationIssues.length > 0).length));
      if (families.status === 'rejected' && products.status === 'fulfilled') {
        /* The old fallback: products not ready for publication, while the families could not load. */
        this.catalogAttention.set(products.value.filter((product) => product.active && (product.publicationIssues?.length ?? 0) > 0).length);
      }
      this.states.set(next);
    } finally {
      this.loadedAt.set(Date.now());
      this.loadedOnce.set(true);
      this.loading.set(false);
      this.refreshing.set(false);
      this.busy = false;
    }
  }

  /* -------------------------------------------------------------- actions */

  private plannerItem(task: HomeTask): PlannerItem | null {
    return task.plannerId === null ? null : this.planner.items().find((item) => item.id === task.plannerId) ?? null;
  }

  private async savePlanner(item: PlannerItem, failText: string): Promise<boolean> {
    try {
      await this.plannerApi.update(item);
      await this.planner.reload(true);
      return true;
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, failText), 'err');
      return false;
    }
  }

  /** Klaar: ticks a planner task, with "Ongedaan maken". */
  async klaar(task: HomeTask): Promise<void> {
    const item = this.plannerItem(task);
    if (!item || !await this.savePlanner({ ...item, done: true }, 'Afvinken mislukt')) return;
    this.ui.toast('Taak afgevinkt', 'ok', { label: 'Ongedaan maken', run: () => void this.savePlanner(item, 'Terugzetten mislukt') });
  }

  /** Morgen: a due task moves to the next workday (the planner's own rule), with "Ongedaan maken"; a later or undated one never moves. */
  async morgen(task: HomeTask): Promise<void> {
    const item = this.plannerItem(task);
    if (!item || !task.actions.includes('morgen')) return;
    const day = localPlannerDate(plannedBusinessDay(new Date(), 1));
    if (!await this.savePlanner({ ...item, onDate: day }, 'Verplaatsen mislukt')) return;
    this.ui.toast(`Verplaatst naar ${weekdayDayMonth(day)}`, 'ok', { label: 'Ongedaan maken', run: () => void this.savePlanner(item, 'Terugzetten mislukt') });
  }

  /** Later: hidden until the next workday (the 3rd time moves it up a group), with "Ongedaan maken". */
  later(task: HomeTask): void {
    const today = this.today();
    const before = this.laterState();
    this.laterState.set(writeLater(laterNext(before, task, today), today));
    this.ui.toast(`Verborgen tot ${weekdayDayMonth(nextWorkday(today))}`, 'ok', {
      label: 'Ongedaan maken', run: () => this.laterState.set(writeLater(before, this.today())),
    });
  }

  /**
   * "Taak van maken": the planner's edit sheet on a new task for today,
   * whose note carries the context and, on its own last line, the marker
   * that stands in for this item while the task is open.
   */
  makeTask(task: HomeTask, cards: { openEdit(item: PlannerItem): void }): void {
    cards.openEdit({ id: null, kind: 'TASK', title: task.title, onDate: this.today(), atTime: null, done: false,
      note: `${task.context}\n${homeMarker(task)}` });
  }
}

/**
 * For a home route's constructor: enters the home (day, CashData, page data)
 * and keeps the day current from a 60 s interval and on window focus.
 */
export function enterHome(): HomeData {
  const data = inject(HomeData);
  const tick = (): void => data.checkDay();
  const timer = window.setInterval(tick, 60_000);
  window.addEventListener('focus', tick);
  const leave = data.enter();
  inject(DestroyRef).onDestroy(() => {
    window.clearInterval(timer);
    window.removeEventListener('focus', tick);
    leave();
  });
  return data;
}
