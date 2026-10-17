import { DestroyRef, Injectable, Signal, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { CashForecastApi } from '../../core/api/cash-forecast-api';
import { messageOf } from '../../core/api/errors';
import type { PurchaseOrderForecast, PurchaseOrderForecastWrite } from '../../core/api/models';
import { Ui } from '../../shared/ui';
import { addDismissed, readDismissed } from '../finance/cash-dismissed';
import { buildCashForecast, poSheet, suggestOrderDate } from '../finance/cash-forecast';
import type { CashForecast, CashForecastInput, ForecastOptions, ForecastRule, OrderDateSuggestion, PoSheet } from '../finance/cash-forecast';
import { cashForecastInput } from '../finance/cash-forecast-input';
import { dayMon, eur } from '../finance/cash-format';
import { cashOptionsOf } from './cash-options';
import { CashPageData, CashSources } from './cash-sources';
import { cashLink, cashQueryParams, parseCashLocation, withoutScenarioDefaults } from './cash-url';
import type { CashLocation } from './cash-url';
import { CHOICE_FIELDS, adjusted, forecastReady, forecastWrite } from './cash-view';

const SAVE_DELAY_MS = 600;
/** The choices a link can carry for every container (the rest only exists per order). */
const LINK_FIELDS = ['priceMode', 'markupPct', 'markupEurPerUnit', 'costBasis', 'sellWeeks', 'paymentDays', 'seasonal'] as const;

/**
 * Analyses › Kasprognose as one state: the address (horizon, sheet, link
 * defaults), the forecast built from CashSources and the page's data, and
 * the writes (stored choices per container, the buffer, "Niet deze").
 * Desk, phone, the container sheet and the Overzicht card all read it.
 * Scoped to AnalysesPage.
 */
@Injectable()
export class CashState {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(CashForecastApi);
  private readonly ui = inject(Ui);
  readonly sources = inject(CashSources);

  readonly location = toSignal(this.route.queryParamMap.pipe(map((params) => parseCashLocation((key) => params.get(key)))),
    { initialValue: parseCashLocation(() => null) });
  readonly dismissed = signal<string[]>(readDismissed());

  private page: Signal<CashPageData> | null = null;
  private pageLoading: Signal<boolean> = signal(true);
  /** Today as the page keeps it (a signal: the forecast rolls over at midnight and after a refresh). */
  private todaySignal: Signal<string> = signal('');
  private pageSeen = false;
  /** True when the page has partner financings with an advance schedule (critique N13). */
  private schedulesNeeded: Signal<boolean> = signal(false);
  private scheduleSeen = false;

  /** Choices typed here and not yet saved (or, on a server without this round, kept for this visit only). */
  private readonly pending = signal<ReadonlyMap<number, PurchaseOrderForecastWrite>>(new Map());
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  readonly choiceErrors = signal<Readonly<Record<number, string>>>({});
  readonly bufferSaving = signal(false);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      for (const [orderId, timer] of this.timers) { clearTimeout(timer); void this.flush(orderId); }
      this.timers.clear();
    });
  }

  attach(page: Signal<CashPageData>, loading: Signal<boolean>, today: Signal<string>, schedulesNeeded?: Signal<boolean>): void {
    this.page = page;
    this.pageLoading = loading;
    this.todaySignal = today;
    if (schedulesNeeded) this.schedulesNeeded = schedulesNeeded;
  }

  get today(): string { return this.todaySignal(); }
  readonly cashRound = computed(() => this.sources.cashRound());
  /** The stored choices or the settings could not load: the container controls and the buffer wait for "Opnieuw". */
  readonly choicesFailed = computed(() => this.sources.choicesFailed());

  /** "Opnieuw" after the choices failed to load. */
  retryChoices(): void { void this.sources.reload(this.todaySignal()); }

  /** The stored choice per order: the server's rows with what is still waiting to be saved on top. */
  readonly stored = computed<PurchaseOrderForecast[]>(() => {
    const pending = this.pending();
    const rows = new Map(this.sources.forecasts().map((row) => [row.orderId, row]));
    for (const [orderId, write] of pending) {
      rows.set(orderId, { orderId, ...write, updatedAt: rows.get(orderId)?.updatedAt ?? null, actor: rows.get(orderId)?.actor ?? null });
    }
    return [...rows.values()].filter((row) => adjusted(row));
  });

  /** The input with the server's stored choices (the expensive part, rebuilt only when the data changes). */
  private readonly inputCore = computed<CashForecastInput | null>(() => {
    if (!this.page) return null;
    /* The first page load must finish; a refresh keeps the last good data on screen meanwhile. */
    if (this.pageLoading() && !this.pageSeen) return null;
    this.pageSeen = true;
    /* The first build waits for this round's advance schedules; later rounds keep the last figures meanwhile. */
    if (!this.scheduleSeen) {
      if (!forecastReady(this.sources.generation(), this.sources.schedulesFor(), this.schedulesNeeded())) return null;
      this.scheduleSeen = true;
    }
    const sources = this.sources.sourcesWith(this.page(), this.todaySignal());
    return sources ? cashForecastInput(sources) : null;
  });

  readonly input = computed<CashForecastInput | null>(() => {
    const core = this.inputCore();
    if (!core) return null;
    return this.pending().size ? { ...core, stored: this.stored() } : core;
  });

  readonly options = computed<ForecastOptions>(() => cashOptionsOf(this.location(), this.todaySignal(), this.dismissed()));

  readonly forecast = computed<CashForecast | null>(() => {
    const input = this.input();
    return input ? buildCashForecast(input, this.options()) : null;
  });

  readonly sheet = computed<PoSheet | null>(() => {
    const input = this.input();
    const po = this.location().po;
    return input && po !== null ? poSheet(input, this.options(), po) : null;
  });

  /** The first included Concept with a better order day (only computed where it is shown). */
  readonly suggestion = computed<{ suggestion: OrderDateSuggestion; number: string } | null>(() => {
    const input = this.input();
    const forecast = this.forecast();
    if (!input || !forecast) return null;
    for (const source of forecast.scenario.sources) {
      if (source.status !== 'CONCEPT' || !source.included || typeof source.id !== 'number') continue;
      const suggestion = suggestOrderDate(input, this.options(), source.id);
      const order = input.orders.find((row) => row.orderId === source.id);
      if (suggestion && order && suggestion.suggestedDate !== suggestion.currentDate) return { suggestion, number: order.number };
    }
    return null;
  });

  storedFor(orderId: number): PurchaseOrderForecast | null {
    return this.stored().find((row) => row.orderId === orderId) ?? null;
  }

  /* ------------------------------------------------------------ address */

  navigate(patch: Partial<CashLocation>, push = false): void {
    const next = { ...this.location(), ...patch };
    void this.router.navigate([], { relativeTo: this.route, queryParams: cashQueryParams(next), replaceUrl: !push });
  }

  openPo(orderId: number): void { this.navigate({ po: orderId }, true); }
  closePo(): void { this.navigate({ po: null }, true); }
  setHorizon(horizon: 3 | 6 | 12): void { this.navigate({ horizon }); }
  setStock(on: boolean): void { this.navigate({ includeStock: on }); }
  clearDefaults(): void { this.navigate(withoutScenarioDefaults(this.location())); }

  setDefault<K extends typeof LINK_FIELDS[number]>(field: K, value: CashLocation[K]): void {
    this.navigate({ [field]: value } as Partial<CashLocation>);
  }

  toggleRule(rule: ForecastRule): void {
    const location = this.location();
    if (rule === 'openQuotes') { this.navigate({ openQuotesOn: !location.openQuotesOn }); return; }
    const off = location.rulesOff.includes(rule) ? location.rulesOff.filter((row) => row !== rule) : [...location.rulesOff, rule];
    this.navigate({ rulesOff: off });
  }

  async copyLink(): Promise<void> {
    const link = cashLink(window.location.origin, this.location());
    try {
      await navigator.clipboard.writeText(link);
      this.ui.toast('Link gekopieerd');
    } catch {
      this.ui.toast('Kopiëren lukte niet; de link staat in de adresbalk', 'err');
    }
  }

  /* ------------------------------------------------------- stored choices */

  /**
   * One control of a container changed. With the server's round: the full
   * write of that order (stored values + this change), saved 600 ms after
   * the last change. Without it the link defaults take the price and pace
   * choices, and the rest lives for this visit only. Nothing happens while
   * the stored choices are unknown: the write would be built without them.
   */
  changeChoice(orderId: number, change: Partial<PurchaseOrderForecastWrite>): void {
    if (!this.sources.choicesKnown()) return;
    if (!this.cashRound()) {
      const linkChange: Partial<CashLocation> = {};
      const local: Partial<PurchaseOrderForecastWrite> = {};
      for (const [field, value] of Object.entries(change) as [keyof PurchaseOrderForecastWrite, unknown][]) {
        if ((LINK_FIELDS as readonly string[]).includes(field)) (linkChange as Record<string, unknown>)[field] = value;
        else (local as Record<string, unknown>)[field] = value;
      }
      if (Object.keys(linkChange).length) this.navigate(linkChange);
      if (Object.keys(local).length) this.setPending(orderId, forecastWrite(this.storedFor(orderId), local));
      return;
    }
    this.setPending(orderId, forecastWrite(this.storedFor(orderId), change));
    this.clearChoiceError(orderId);
    const timer = this.timers.get(orderId);
    if (timer) clearTimeout(timer);
    this.timers.set(orderId, setTimeout(() => { this.timers.delete(orderId); void this.flush(orderId); }, SAVE_DELAY_MS));
  }

  /** "Terug naar standaard": every stored choice of the order goes. */
  async resetChoice(orderId: number): Promise<void> {
    if (!this.sources.choicesKnown()) return;
    const timer = this.timers.get(orderId);
    if (timer) { clearTimeout(timer); this.timers.delete(orderId); }
    const before = this.storedFor(orderId);
    this.dropPending(orderId);
    this.clearChoiceError(orderId);
    if (!this.cashRound()) return;
    try {
      await this.api.deleteForecast(orderId);
      this.sources.acceptForecast(orderId, null);
    } catch (failure) {
      if (before) this.setPending(orderId, forecastWrite(before, {}));
      this.choiceErrors.update((errors) => ({ ...errors, [orderId]: messageOf(failure, 'Terug naar standaard lukte niet') }));
    }
  }

  /** Saves the order date a Concept is tried with, with an undo. */
  tryOrderDate(orderId: number, date: string): void {
    if (!this.sources.choicesKnown()) return;
    const before = this.storedFor(orderId)?.orderDateOverride ?? null;
    this.changeChoice(orderId, { orderDateOverride: date, included: true });
    this.ui.toast(`Besteldatum ${dayMon(date)} in het scenario`, 'ok', { label: 'Ongedaan maken', run: () => this.changeChoice(orderId, { orderDateOverride: before }) });
  }

  private clearChoiceError(orderId: number): void {
    this.choiceErrors.update((errors) => {
      if (!(orderId in errors)) return errors;
      const next = { ...errors };
      delete next[orderId];
      return next;
    });
  }

  private setPending(orderId: number, write: PurchaseOrderForecastWrite): void {
    this.pending.update((current) => new Map(current).set(orderId, write));
  }

  private dropPending(orderId: number, ifSame?: PurchaseOrderForecastWrite): void {
    this.pending.update((current) => {
      if (!current.has(orderId) || (ifSame && current.get(orderId) !== ifSame)) return current;
      const next = new Map(current);
      next.delete(orderId);
      return next;
    });
  }

  private async flush(orderId: number): Promise<void> {
    const write = this.pending().get(orderId);
    if (!write) return;
    try {
      const empty = CHOICE_FIELDS.every((field) => write[field] === null);
      if (empty) {
        await this.api.deleteForecast(orderId);
        this.sources.acceptForecast(orderId, null);
      } else {
        this.sources.acceptForecast(orderId, await this.api.saveForecast(orderId, write));
      }
      this.dropPending(orderId, write);
    } catch (failure) {
      /* The server refused: the inline message says why, the control goes back to what is stored. */
      this.dropPending(orderId, write);
      this.choiceErrors.update((errors) => ({ ...errors, [orderId]: messageOf(failure, 'Bewaren bij de container lukte niet') }));
    }
  }

  /* --------------------------------------------------------------- others */

  dismiss(key: string): void {
    this.dismissed.set(addDismissed(key));
  }

  async saveBuffer(value: number | null): Promise<boolean> {
    if (!this.cashRound() || this.bufferSaving()) return false;
    this.bufferSaving.set(true);
    try {
      const settings = await this.api.saveSettings(value);
      this.sources.acceptSettings(settings);
      this.ui.toast(`Buffer ${eur(settings.cashBufferEur)} bewaard`);
      return true;
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'De buffer bewaren lukte niet'), 'err');
      return false;
    } finally {
      this.bufferSaving.set(false);
    }
  }
}
