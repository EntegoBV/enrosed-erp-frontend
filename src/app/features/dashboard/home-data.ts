import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { AnalyticsApi } from '../../core/api/analytics-api';
import type { WebsiteAnalyticsReport } from '../../core/api/analytics-api';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import { FinanceApi } from '../../core/api/finance-api';
import type {
  CompanyCost, Customer, IncomingPaymentRow, PartnerFinancing, Product, PurchaseOrderView, SalesOrderView, StockLevel, Supplier,
} from '../../core/api/models';
import { PlannerApi, PlannerStore } from '../../core/api/planner-api';
import type { PlannerItem } from '../../core/api/planner-api';
import { SalesApi } from '../../core/api/sales-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { TicaApi } from '../../core/api/tica-api';
import type { TicaAnalyticsDay } from '../../core/api/tica-api';
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
import { cashForecastInput, forecastStartEur, vooruitblikOf } from '../finance/cash-forecast-input';
import { weekdayDayMonth } from '../finance/cash-format';
import { receivableTotals } from '../finance/incoming-money';
import { agendaModel } from './agenda-entries';
import { localPlannerDate, purchasePlannerMilestones } from './dashboard-today-state';
import { SCHEDULES_WAIT_MS, TASKS_REVEAL_CAP_MS, cashHeadline, forecastGate, outlookFigures, tasksReveal } from './home-cash';
import { monthWindows } from './home-figures';
import { readLater, writeLater } from './home-later';
import { coverageOf, forecastAnswer, homeMarker, homeTasks, laterNext, nextWorkday } from './home-priority';
import type { CoverageAnswer, CoverageSource, HomeTask, LaterState } from './home-priority';
import { noteAnswer, staleSources } from './home-refresh';
import type { HomeFetchKey } from './home-refresh';
import { agendaInputOf, attentionOf, homeTaskInputOf, vatOf } from './home-sources';
import type { HomeCashSources } from './home-sources';

/*
 * Everything the home shows, loaded and derived once (spec-home §1, §7):
 * the page data (sales with the TICA days, purchases, products with their
 * stock per location, families, suppliers, website, costs, incoming
 * payments, partner financing, customers, planner, bell),
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
/** The calls Te doen waits for on the first load, with the planner and the bell (§4 #4): the slow families never hold it up. */
const TASK_SOURCES: readonly HomeSource[] = ['verkoop', 'inkoop', 'kosten', 'inkomende betalingen', 'partnerfinanciering', 'klanten'];
/** The home calls the forecast is built from (with CashData): once all answered (ready or failed) it may be built. */
const FORECAST_INPUTS: readonly HomeSource[] = ['verkoop', 'inkoop', 'voorraad', 'leveranciers', 'kosten', 'inkomende betalingen', 'klanten'];
/** Named after the coverage words in the status, in this order. */
const OTHER_SOURCES: readonly HomeSource[] = ['voorraad', 'websiteproducten', 'leveranciers', 'websitebezoek', 'klanten'];

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
  private readonly tica = inject(TicaApi);
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
  /**
   * TICA's portal sales per day, fetched with the sales (design/analyses2 D-H1): Resultaat dit jaar adds them as
   * Analyses does (withTicaResult). Its own state, outside the HomeSource set: while it loads the tile waits, a
   * failure reads "—" on the result and the margin and is named in the status; the last good days stay.
   */
  readonly ticaDays = signal<TicaAnalyticsDay[]>([]);
  readonly ticaState = signal<SourceState>('loading');
  /**
   * Every product's stock per location, fetched with the products (D-H2): Bekende voorraadkost counts every
   * location, as Analyses › Voorraad (withAllLocations). Undefined until the first answer; null when it failed
   * without an earlier answer (the warehouse figure counts then, named in the status).
   */
  readonly stockLevels = signal<StockLevel[] | null | undefined>(undefined);
  private readonly levelsFailed = signal(false);

  private readonly states = signal<Record<HomeSource, SourceState>>(
    Object.fromEntries(PAGE_SOURCES.map((source) => [source, 'loading'])) as Record<HomeSource, SourceState>);
  /**
   * The first load has not yet heard from Te doen's own sources (TASK_SOURCES, the planner, the bell); the
   * figure blocks fill in per source meanwhile (§4 #4).
   */
  readonly loading = signal(true);
  /** A load is under way: the first one until every source answered, a later one with the last data on screen. */
  readonly refreshing = signal(false);
  /** When the last load finished, every source answered (epoch ms): "Alles bijgewerkt om 08:12". */
  readonly loadedAt = signal<number | null>(null);
  private readonly loadedOnce = signal(false);
  /** When each call last answered well (home-refresh.ts): a return fetches only the stale ones. */
  private readonly fetchedAt: Partial<Record<HomeFetchKey, number>> = {};
  /** The forecast's own calls (FORECAST_INPUTS) answered once: from here the forecast may be built. */
  private readonly inputsAnswered = signal(false);
  /** TASKS_REVEAL_CAP_MS after the first load's task sources answered: Te doen shows without the Kasprognose (B2). */
  private readonly revealCap = signal(false);
  /** The first load's catalog count answered (the families, else the products fallback): Te doen's reveal waits for it (B2). */
  private readonly catalogAnswered = signal(false);
  private readonly bellAnswered = signal(false);
  private busy = false;
  /** Home routes on screen (enterHome): the forecast and the advance schedules follow CashData only while one is. */
  private readonly active = signal(0);
  /** The CashData round the partner financings answered in: the advance schedules load with those, never with an older visit's. */
  private readonly partnersRound = signal(0);
  /** The round whose advance schedules answered (or were already claimed), and the round whose SCHEDULES_WAIT_MS ran out. */
  private readonly schedulesDone = signal(0);
  private readonly schedulesTimedOut = signal(0);
  /** The forecast is built only with this round's advance schedules (critique B1); see forecastGate. */
  private readonly scheduleGate = computed(() => forecastGate({
    partnersFailed: this.states().partnerfinanciering === 'failed', partnersRound: this.partnersRound(),
    schedulesDone: this.schedulesDone(), timedOut: this.schedulesTimedOut(),
  }));

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
  /**
   * The forecast's sources, once its own calls answered (FORECAST_INPUTS) and the bank is in. The Vooruitblik reads them
   * at once; the forecast itself waits for the advance schedules too (scheduleGate), so the bank never waits for them.
   */
  private readonly forecastSources = computed(() => (this.inputsAnswered() ? this.cashData.sourcesWith(this.cashPage(), this.today()) : null));
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

  /**
   * The bank shown while the forecast is being built: the forecast's own start (forecastStartEur - the accounts that
   * count in cash), never the Vooruitblik's bankEur, which also holds the accounts that do not. So "Op de bank" keeps
   * one figure from the first paint on, also while the build waits for the advance schedules (B1).
   */
  private readonly provisionalStart = computed(() => {
    const sources = this.forecastSources();
    return sources ? forecastStartEur(sources) : null;
  });

  /** The Kas headline (state, bank, lowest point, first krap period). */
  readonly cash = computed(() => {
    const forecast = this.forecast();
    const computing = this.computing() || (!!this.forecastSources() && !forecast);
    return cashHeadline(forecast, {
      bankMissing: this.cashData.state() === 'ready' && this.cashData.bankMissing(),
      warnings: this.cashWarnings(),
      computing,
      startEur: computing && !forecast ? this.provisionalStart() : null,
    });
  });

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

  /** How each coverage source (§4.4) answered on the last load. A bank that could not load is 'bank', not also 'kasprognose' (forecastAnswer). */
  private readonly answers = computed<Record<CoverageSource, CoverageAnswer>>(() => {
    const states = this.states();
    const answered = (ready: boolean, failed: boolean): CoverageAnswer => (failed ? 'failed' : ready ? 'ready' : 'loading');
    const cashReady = this.cashData.state() === 'ready';
    return {
      agenda: answered(this.planner.loaded(), !!this.planner.error()),
      meldingen: answered(this.bellAnswered(), !!this.work.error()),
      verkoop: states.verkoop, inkoop: states.inkoop, partnerfinanciering: states.partnerfinanciering,
      'inkomende betalingen': states['inkomende betalingen'], kosten: states.kosten,
      bank: answered(cashReady, cashReady && this.cashData.bankMissing()),
      kasprognose: forecastAnswer(this.cash().state, this.cashWarnings().some((word) => word !== 'bank')),
    };
  });
  private readonly coverageParts = computed(() => coverageOf(this.answers()));

  /** Which sources answered on the last load (CoverageSource, §4.4); a source still loading counts as not covered. */
  readonly coverage = computed(() => this.coverageParts().covered);

  /** Every source has answered (or failed): from here "Niet volledig" names real failures, before it the page says "Bijwerken…". */
  readonly settled = computed(() => this.loadedOnce() && !this.loading() && this.bellAnswered()
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

  /**
   * Te doen may show (critique B2): its sources answered, the Kas is past computing and the catalog count answered
   * (or 1.5 s passed). Until then
   * every Te doen surface - the desk card and its pill, the brief, the phone section and its count, Open punten,
   * Alle - shows its skeleton, so the list appears once instead of growing and reordering per source.
   */
  readonly tasksReady = computed(() => tasksReveal({ loading: this.loading(), cashState: this.cash().state, capPassed: this.revealCap(),
    catalogLoading: !this.catalogAnswered() }));

  /**
   * The status words: the failed coverage sources in their order (the same words as the Te doen note, from the
   * same answers), then the other failed calls. Empty when all is well.
   */
  readonly warnings = computed(() => {
    const states = this.states();
    return [...new Set<string>([...this.coverageParts().failed, ...OTHER_SOURCES.filter((source) => states[source] === 'failed'),
      ...(this.ticaState() === 'failed' ? ['TICA verkopen'] : []), ...(this.levelsFailed() ? ['voorraadlocaties'] : [])])];
  });

  /* -------------------------------------------------------------- agenda */

  readonly agenda = computed(() => agendaModel(agendaInputOf({
    today: this.today(), nowTime: this.nowTime(), planner: this.planner.items(), milestones: this.milestones(),
    forecast: this.forecast(), headline: this.cash(), purchases: this.purchases(), sales: this.salesOrders(), salesOk: this.states().verkoop === 'ready',
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
      if (!sources || !this.active() || !this.scheduleGate() || (built?.sources === sources && built.options === options)) return;
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
      /* Done for this round also when Analyses claimed it first (loadSchedules returns at once then; a known limit). */
      untracked(() => void this.cashData.loadSchedules(financings, round).finally(() => this.schedulesDone.set(round)));
    });
    /* A hung schedule call must not leave "Kasprognose wordt berekend…" on screen: the gate opens after SCHEDULES_WAIT_MS. */
    effect((onCleanup) => {
      const round = this.partnersRound();
      if (round === 0) return;
      const timer = setTimeout(() => this.schedulesTimedOut.set(round), SCHEDULES_WAIT_MS);
      onCleanup(() => clearTimeout(timer));
    });
  }

  /* ---------------------------------------------------------------- load */

  /**
   * A home route was entered: the day is checked, CashData ensured, and the calls fetched again that are older
   * than their own maximum age (home-refresh.ts: 20 s, or 5 min for what hardly changes); partner financing too
   * when CashData started a new round (its advance schedules need this round's financings). The first visit
   * fetches everything. Returns the leave function for the route's onDestroy.
   */
  enter(): () => void {
    this.active.update((count) => count + 1);
    this.checkDay();
    const round = this.cashData.generation();
    this.cashData.ensure(this.today());
    if (!this.loadedOnce()) void this.fetchPage();
    else {
      const stale = new Set(staleSources(this.fetchedAt, Date.now()));
      if (this.cashData.generation() !== round) stale.add('partnerfinanciering');
      if (stale.size) void this.fetchPage(stale);
    }
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

  /** "Opnieuw" and "Vernieuwen": all the page data and CashData, fetched again. */
  async load(): Promise<void> {
    if (this.cashData.state() === 'idle') this.cashData.ensure(this.today());
    else void this.cashData.reload(this.today());
    await this.fetchPage();
  }

  /**
   * The page data. The first load applies each source as it answers (§4 #4): `loading` ends once Te doen's sources,
   * the planner and the bell answered, the forecast may be built once its own calls did, and `refreshing` and
   * `loadedAt` wait for all. A later load keeps the last data on screen and swaps the new data in at once, as before;
   * `only` limits it to the stale calls (enter), with the same flags for what it asked.
   */
  private async fetchPage(only?: ReadonlySet<HomeFetchKey>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const first = !this.loadedOnce();
    const want = (key: HomeFetchKey): boolean => first || !only || only.has(key);
    /* A good answer is stamped; a failed one loses its stamp, so the next return fetches it again (never fresh). */
    const stamp = (key: HomeFetchKey, ok = true): void => noteAnswer(this.fetchedAt, key, ok, Date.now());
    this.refreshing.set(true);
    if (first) this.loading.set(true);
    this.dismissed.set(readDismissed());
    const batch: (() => void)[] = [];
    const land = (apply: () => void): void => { if (first) apply(); else batch.push(apply); };
    const taskWait = new Set<string>([...TASK_SOURCES, 'planner', 'bell']);
    const inputWait = new Set<string>(FORECAST_INPUTS);
    const answered = (key: string): void => {
      if (!first) return;
      if (taskWait.delete(key) && taskWait.size === 0) this.endFirstLoad();
      if (inputWait.delete(key) && inputWait.size === 0) this.inputsAnswered.set(true);
    };
    const track = <T>(source: HomeSource, call: () => Promise<T>, apply: (value: T) => void): Promise<void> => (want(source) ? call().then(
      (value) => { stamp(source); land(() => { apply(value); this.setState(source, 'ready'); }); },
      () => { stamp(source, false); land(() => this.setState(source, 'failed')); },
    ).finally(() => answered(source)) : Promise.resolve());
    try {
      const products = want('voorraad') ? this.catalog.products() : null;
      const families = want('websiteproducten') ? this.catalog.productFamilies() : null;
      await Promise.all([
        track('verkoop', () => this.salesApi.orders(), (value) => this.salesOrders.set(value)),
        /* TICA with the sales and the locations with the products: they follow those calls' age, each with its own state. */
        want('verkoop') ? this.tica.analytics().then(
          (days) => land(() => { this.ticaDays.set(days); this.ticaState.set('ready'); }),
          () => land(() => this.ticaState.set('failed'))) : Promise.resolve(),
        want('voorraad') ? this.catalog.stockLevels().then(
          (levels) => land(() => {
            const ok = Array.isArray(levels);
            this.levelsFailed.set(!ok);
            this.stockLevels.update((last) => (ok ? levels : last ?? null));
          }),
          () => land(() => { this.levelsFailed.set(true); this.stockLevels.update((last) => last ?? null); })) : Promise.resolve(),
        track('inkoop', () => this.sourcing.purchaseOrders(), (value) => this.purchases.set(value)),
        track('voorraad', () => products!, (value) => this.products.set(value)),
        track('leveranciers', () => this.sourcing.suppliers(), (value) => this.suppliers.set(value)),
        track('websitebezoek', () => this.analytics.websiteReport(7), (value) => this.website.set(value)),
        track('kosten', () => this.finance.costs(), (value) => this.costs.set(value)),
        track('inkomende betalingen', () => this.salesApi.incomingPayments(), (value) => this.incomingPayments.set(value)),
        track('partnerfinanciering', () => this.sourcing.partnerFinancings(), (value) => {
          this.partnerSummaries.set(value);
          this.partnersRound.set(this.cashData.generation());
        }),
        track('klanten', () => this.salesApi.customers(), (value) => this.customers.set(value)),
        track('websiteproducten', () => families!, (value) => this.catalogAttention.set(value
          .filter((family) => family.active && family.publicationIssues.length > 0).length)),
        /*
         * The catalog count: the families (track above), else the old fallback once the products answered - products
         * not ready for publication. On the first load Te doen's reveal waits for it (its Ook nog row, B2).
         */
        (families ? families.then(() => undefined, async () => {
          const rows = products ? await products.catch(() => null) : null;
          if (rows) land(() => this.catalogAttention.set(rows.filter((product) => product.active && (product.publicationIssues?.length ?? 0) > 0).length));
        }) : Promise.resolve()).finally(() => { if (first) this.catalogAnswered.set(true); }),
        want('planner') ? this.planner.reload().then(() => { if (!this.planner.error()) stamp('planner'); }, () => undefined)
          .finally(() => answered('planner')) : Promise.resolve(),
        want('bell') ? this.work.refresh().then(() => { this.bellAnswered.set(true); if (!this.work.error()) stamp('bell'); }, () => undefined)
          .finally(() => answered('bell')) : Promise.resolve(),
      ]);
      /* The planner and the bell keep their own error (they never reject): a failed one loses its stamp too. */
      if (want('planner') && this.planner.error()) stamp('planner', false);
      if (want('bell') && this.work.error()) stamp('bell', false);
      for (const apply of batch) apply();
    } finally {
      if (first) {
        this.inputsAnswered.set(true);
        this.catalogAnswered.set(true);
        this.endFirstLoad();
      }
      this.loadedAt.set(Date.now());
      this.loadedOnce.set(true);
      this.refreshing.set(false);
      this.busy = false;
    }
  }

  private setState(source: HomeSource, state: SourceState): void {
    this.states.update((states) => (states[source] === state ? states : { ...states, [source]: state }));
  }

  /** Te doen's sources answered on the first load: the list may show, at the latest TASKS_REVEAL_CAP_MS later. */
  private endFirstLoad(): void {
    if (!this.loading()) return;
    this.loading.set(false);
    setTimeout(() => this.revealCap.set(true), TASKS_REVEAL_CAP_MS);
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
