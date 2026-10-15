import { Injectable, computed, inject, signal } from '@angular/core';
import { BankingApi } from '../../core/api/banking-api';
import type { BankAccount, BankStatementLine } from '../../core/api/banking-api';
import { CashForecastApi } from '../../core/api/cash-forecast-api';
import { FinanceApi } from '../../core/api/finance-api';
import type {
  BankBalance, CashForecastSettings, CompanyCost, CompanyProfile, Customer, IncomingPaymentRow, PartnerAdvanceSchedule, PartnerFinancing,
  Product, PurchaseOrderForecast, PurchaseOrderView, PurchasePaymentRow, RecurringCost, SalesOrderView, Supplier,
} from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { bankAccountKey, bankCheckpoint, canonicalBankAccount } from '../finance/bank-reconciliation';
import type { CashForecastSources } from '../finance/cash-forecast-input';
import { paymentLocalDay } from '../finance/incoming-money';
import { financingsWithSchedule, threeMonthsBack } from './cash-view';

/** What Analyses already loads for its other tabs; the Kasprognose reuses it and never fetches it again (spec §4.1). */
export interface CashPageData {
  purchases: PurchaseOrderView[]; suppliers: Supplier[]; products: Product[]; salesOrders: SalesOrderView[];
  customers: Customer[]; costs: CompanyCost[]; incomingPayments: IncomingPaymentRow[];
}

/**
 * The statements' `from`: the first day of the month three months back, or
 * earlier when an active account's latest reading is older (so its balance
 * can be walked forward from that reading), counted or not.
 */
export function statementsFromOf(today: string, accounts: readonly BankAccount[], balances: readonly BankBalance[]): string {
  let from = threeMonthsBack(today);
  const archived = new Set(accounts.filter((account) => account.archived).map((account) => bankAccountKey(account.key)));
  const latest = new Map<string, BankBalance>();
  for (const row of balances) {
    const key = canonicalBankAccount(row.account, accounts);
    const known = latest.get(key);
    if (!known || bankCheckpoint(row) > bankCheckpoint(known)) latest.set(key, row);
  }
  for (const [key, row] of latest) {
    if (archived.has(bankAccountKey(key))) continue;
    const at = bankCheckpoint(row);
    const day = Number.isFinite(at) ? paymentLocalDay({ receivedAt: new Date(at).toISOString(), timeZone: row.timeZone || 'Europe/Brussels' }) : row.date;
    if (day && day < from) from = day;
  }
  return from;
}

/** How old a round may be before ensure() fetches again (spec-home amendment B). */
export const CASH_DATA_MAX_AGE_MS = 120_000;

/**
 * The bank and forecast data of Analyses › Kasprognose, the Overzicht card
 * and the home's Kas card, loaded lazily the first time one of them is shown.
 * Each source fails on its own and keeps its last good data; the failures
 * read as one warning. One copy for the app (root), so the home and Analyses
 * share a fetch; ensure() fetches again once a round is two minutes old or
 * from another day, reload() ("Opnieuw", "Vernieuwen") always.
 */
@Injectable({ providedIn: 'root' })
export class CashData {
  private readonly banking = inject(BankingApi);
  private readonly finance = inject(FinanceApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly sales = inject(SalesApi);
  private readonly cashApi = inject(CashForecastApi);

  /** idle: never asked; loading: the first or a new round is under way; ready: at least one round finished. */
  readonly state = signal<'idle' | 'loading' | 'ready'>('idle');
  readonly refreshing = signal(false);
  /** The bank could not load and there is no earlier bank data. */
  readonly bankMissing = signal(false);
  readonly warnings = signal<string[]>([]);
  /** Bumped by every new round; the page loads the advance schedules once per round. */
  readonly generation = signal(0);
  /** When the last round finished (epoch ms), and for which day it loaded; null before the first. */
  readonly loadedAt = signal<number | null>(null);
  readonly loadedFor = signal<string | null>(null);

  readonly bankAccounts = signal<BankAccount[]>([]);
  readonly balances = signal<BankBalance[]>([]);
  readonly statements = signal<BankStatementLine[]>([]);
  readonly statementsFrom = signal<string | null>(null);
  readonly recurring = signal<RecurringCost[]>([]);
  readonly purchasePayments = signal<PurchasePaymentRow[]>([]);
  readonly advanceSchedules = signal<PartnerAdvanceSchedule[]>([]);
  readonly company = signal<CompanyProfile | null>(null);
  readonly forecasts = signal<PurchaseOrderForecast[]>([]);
  readonly settings = signal<CashForecastSettings | null>(null);
  /*
   * Whether the stored choices and the settings each answered at least once
   * (a 404 counts: a server without this round answers [] and null). A
   * write is the full row of an order (§4.4), so one built while the stored
   * choices never loaded would wipe them on the server.
   */
  private readonly forecastsAnswered = signal(false);
  private readonly settingsAnswered = signal(false);
  /** Both answered at least once: what is stored is known. */
  readonly choicesKnown = computed(() => this.forecastsAnswered() && this.settingsAnswered());
  /** A round finished and the stored choices or the settings still never answered: nothing may write them. */
  readonly choicesFailed = computed(() => this.state() === 'ready' && !this.choicesKnown());
  /** The server knows this round and what it stores is loaded: stored choices and the buffer can be saved. */
  readonly cashRound = computed(() => this.choicesKnown() && this.settings() !== null);

  private bankLoaded = false;
  private schedulesRound = -1;
  private readonly failed = signal<Record<string, true>>({});

  /**
   * Loads when nothing is loaded yet, when the last round was for another day
   * or is older than `maxAgeMs`; otherwise (or while a round runs) nothing.
   */
  ensure(today: string, maxAgeMs = CASH_DATA_MAX_AGE_MS): void {
    if (this.refreshing()) return;
    const loadedAt = this.loadedAt();
    if (this.state() === 'idle' || this.loadedFor() !== today || loadedAt === null || Date.now() - loadedAt > maxAgeMs) {
      void this.reload(today);
    }
  }

  async reload(today: string): Promise<void> {
    if (this.refreshing()) return;
    this.refreshing.set(true);
    if (this.state() === 'idle') this.state.set('loading');
    this.generation.update((value) => value + 1);
    const failed: Record<string, true> = {};
    try {
      const [accounts, balances, recurring, payments, company, forecasts, settings] = await Promise.allSettled([
        this.banking.accounts(), this.finance.bankBalances(), this.finance.recurringCosts(), this.sourcing.purchasePayments(),
        this.sales.company(), this.cashApi.forecasts(), this.cashApi.settings(),
      ] as const);
      if (accounts.status === 'fulfilled') this.bankAccounts.set(accounts.value); else failed['bank'] = true;
      if (balances.status === 'fulfilled') this.balances.set(balances.value); else failed['bank'] = true;
      if (recurring.status === 'fulfilled') this.recurring.set(recurring.value); else failed['vaste kosten'] = true;
      if (payments.status === 'fulfilled') this.purchasePayments.set(payments.value); else failed['betalingen'] = true;
      if (company.status === 'fulfilled') this.company.set(company.value); else failed['bedrijfsgegevens'] = true;
      if (forecasts.status === 'fulfilled') { this.forecasts.set(forecasts.value); this.forecastsAnswered.set(true); } else failed['prognosekeuzes'] = true;
      if (settings.status === 'fulfilled') { this.settings.set(settings.value); this.settingsAnswered.set(true); } else failed['prognosekeuzes'] = true;
      if (!failed['bank']) {
        const from = statementsFromOf(today, this.bankAccounts(), this.balances());
        try {
          this.statements.set(await this.banking.list(from));
          this.statementsFrom.set(from);
          this.bankLoaded = true;
        } catch {
          failed['bank'] = true;
        }
      }
    } finally {
      this.failed.update((current) => ({ ...Object.fromEntries(Object.entries(current).filter(([word]) => word === 'partners')), ...failed }));
      this.warnings.set(this.warningWords());
      this.bankMissing.set(!this.bankLoaded);
      this.loadedAt.set(Date.now());
      this.loadedFor.set(today);
      this.state.set('ready');
      this.refreshing.set(false);
    }
  }

  /** The advance schedules of the financings that still invoice advances; once per round, after the page has its financings. */
  async loadSchedules(financings: readonly PartnerFinancing[], round: number): Promise<void> {
    if (round <= 0 || this.schedulesRound === round) return;
    this.schedulesRound = round;
    const results = await Promise.allSettled(financingsWithSchedule(financings).map((id) => this.sourcing.partnerAdvanceSchedule(id)));
    const loaded = results.filter((result): result is PromiseFulfilledResult<PartnerAdvanceSchedule> => result.status === 'fulfilled').map((result) => result.value);
    const failures = results.length - loaded.length;
    if (!failures) this.advanceSchedules.set(loaded);
    else {
      const fresh = new Map(loaded.map((row) => [row.purchaseOrderId, row]));
      this.advanceSchedules.update((current) => [...current.filter((row) => !fresh.has(row.purchaseOrderId)), ...fresh.values()]);
    }
    this.failed.update((current) => {
      const next = { ...current };
      if (failures) next['partners'] = true; else delete next['partners'];
      return next;
    });
    this.warnings.set(this.warningWords());
  }

  /** A stored choice came back from the server (null: the row was removed). */
  acceptForecast(orderId: number, row: PurchaseOrderForecast | null): void {
    this.forecasts.update((list) => {
      const rest = list.filter((item) => item.orderId !== orderId);
      return row && row.updatedAt !== null ? [...rest, row].sort((left, right) => left.orderId - right.orderId) : rest;
    });
  }

  acceptSettings(settings: CashForecastSettings): void {
    this.settings.set(settings);
  }

  /** Everything cashForecastInput needs, or null while the bank is not there yet. */
  sourcesWith(page: CashPageData, today: string): CashForecastSources | null {
    if (this.state() === 'idle' || (this.state() === 'loading' && !this.bankLoaded) || !this.bankLoaded) return null;
    return {
      today, bankAccounts: this.bankAccounts(), balances: this.balances(), statements: this.statements(), incomingPayments: page.incomingPayments,
      costs: page.costs, recurring: this.recurring(), purchaseViews: page.purchases, purchasePayments: this.purchasePayments(), suppliers: page.suppliers,
      salesOrders: page.salesOrders, customers: page.customers, advanceSchedules: this.advanceSchedules(), company: this.company(),
      forecasts: this.forecasts(), settings: this.settings(), products: page.products, statementsFrom: this.statementsFrom(),
    };
  }

  private warningWords(): string[] {
    const order = ['bank', 'kosten', 'vaste kosten', 'betalingen', 'partners', 'prognosekeuzes', 'bedrijfsgegevens'];
    const failed = this.failed();
    return order.filter((word) => failed[word]);
  }
}

/** The former name, kept for one release. */
export { CashData as CashSources };
