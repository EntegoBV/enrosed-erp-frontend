import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Skeleton } from '../../shared/skeleton';
import { Sparkline } from '../../shared/sparkline';
import { Icon } from '../../shared/icon';
import { Sheet } from '../../shared/ui';
import { FormsModule } from '@angular/forms';
import { Fx, FxSeries } from '../../core/api/fx';
import { RouterLink } from '@angular/router';
import { SalesApi } from '../../core/api/sales-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { CatalogApi } from '../../core/api/catalog-api';
import { FreightRate, PurchaseOrderView, QuoteRevision, SalesOrderView } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Privacy } from '../../core/api/privacy';
import { EurPipe, NumPipe, PctPipe } from '../../shared/pipes';
import { STATUS_LABEL, statusClass } from '../sales/quote-status';
import { containerLabel } from '../../core/api/geo';

const PURCHASE_STATUS_LABEL: Record<string, string> = {
  CONCEPT: 'Concept', BESTELD: 'Besteld', ONDERWEG: 'Onderweg', ONTVANGEN: 'Ontvangen',
};

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, Sparkline, Icon, Sheet, FormsModule, RouterLink, PageHeader, EurPipe, NumPipe, PctPipe],
  template: `
    <app-page-header [title]="greeting()" [subtitle]="today()">
    </app-page-header>

    <!-- Sections stack: future blocks (stock levels, reports, fair
         planning) slot in as another .section-title + card pair. -->
    <div class="content anim-stagger">
      @if (loading()) {
        <app-skeleton kind="stats" [rows]="4" />
      } @else {
      <div class="kpis">
        <a class="kpi kpi--dark" routerLink="/sales">
          <svg class="kpi__rose" viewBox="0 0 24 24" fill="none" stroke="#e8b7c0"
               stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="8" r="3.2" />
            <path d="M12 11.2V20" />
            <path d="M12 16.5c-2.6 0-4.5-1.3-4.8-3.4 2.6 0 4.4 1.2 4.8 3.4z" />
            <path d="M12 16.5c2.6 0 4.5-1.3 4.8-3.4-2.6 0-4.4 1.2-4.8 3.4z" />
            <path d="M12 8m-1.4 0a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0-2.8 0" />
          </svg>
          <div class="kpi__label">Open verkoop</div>
          <div class="kpi__value">{{ openValue() | eur: 0 }}</div>
          <div class="kpi__meta">{{ openOrders().length }} order(s)</div>
        </a>
        @if (privacy.showPurchase()) {
          <div class="kpi">
            <div class="kpi__label">Brutomarge</div>
            <div class="kpi__value">{{ marginPct() | pct: 1 }}</div>
            <div class="kpi__meta">{{ marginEur() | eur: 0 }} op open orders</div>
          </div>
          <div class="kpi">
            <div class="kpi__label">Inkoop onderweg</div>
            <div class="kpi__value">{{ incomingValue() | eur: 0 }}</div>
            <div class="kpi__meta">{{ incoming().length }} container(s)</div>
          </div>
        } @else {
          <div class="kpi">
            <div class="kpi__label">Orders open</div>
            <div class="kpi__value">{{ openOrders().length }}</div>
            <div class="kpi__meta">in behandeling</div>
          </div>
          <div class="kpi">
            <div class="kpi__label">Containers</div>
            <div class="kpi__value">{{ incoming().length }}</div>
            <div class="kpi__meta">onderweg</div>
          </div>
        }
        <a class="kpi" routerLink="/products">
          <div class="kpi__label">Catalogus</div>
          <div class="kpi__value">{{ productCount() }}</div>
          <div class="kpi__meta">producten</div>
        </a>
      </div>
      }

      @if (revisions().length) {
        <a class="alert alert--warn mt-12" routerLink="/revisions"
           style="text-decoration:none;color:inherit">
          <span class="alert__icon">⇄</span>
          <div>
            <b>{{ revisions().length }} klant(en)</b> vragen een wijziging op hun offerte.
            Tik om te behandelen.
          </div>
        </a>
      }

      <div class="section-title">Markt</div>
      @if (fx.series(); as rates) {
        <div class="card">
          <div class="card__head"><h2>Wisselkoersen</h2>
            <span class="spacer"></span>
            <span class="tiny muted">ECB · {{ rates.asOf }}</span>
          </div>
          <div class="card__body">
            <!-- Tap flips the pair: sometimes you think in "what does one
                 dollar cost", sometimes in "what does my euro buy". -->
            <!-- Tap flips the pair; the chart spans half a year with month
                 marks - a bare line said "something moved" but not when. -->
            <button class="market-row market-row--btn market-row--stack" type="button"
                    (click)="flipUsd.set(!flipUsd())">
              <div class="market-row__top">
                <div class="market-row__label">{{ flipUsd() ? 'USD → EUR' : 'EUR → USD' }}
                  <app-icon name="exchange" [size]="12" /></div>
                <span class="spacer"></span>
                <div class="market-row__value num">
                  {{ fxValue(rates.latestUsd, flipUsd()) | num: 4 }}</div>
                <span class="badge" [class]="fxPct(rates.usd, flipUsd()) >= 0 ? 'badge--ok' : 'badge--warn'">
                  {{ fxPct(rates.usd, flipUsd()) >= 0 ? '+' : '' }}{{ fxPct(rates.usd, flipUsd()) | num: 1 }}%
                </span>
              </div>
              <app-sparkline class="fx-chart" [values]="fxSeries(chartSlice(rates.usd), flipUsd())"
                             [width]="320" [height]="42" />
              <div class="fx-months">
                @for (tick of monthTicks(chartDates(rates), chartSlice(rates.usd), flipUsd()); track tick.pct) {
                  <span [style.left.%]="tick.pct">{{ tick.label }}
                    <em>{{ tick.value | num: 2 }}</em></span>
                }
              </div>
            </button>
            <button class="market-row market-row--btn market-row--stack" type="button"
                    (click)="flipCny.set(!flipCny())">
              <div class="market-row__top">
                <div class="market-row__label">{{ flipCny() ? 'CNY → EUR' : 'EUR → CNY' }}
                  <app-icon name="exchange" [size]="12" /></div>
                <span class="spacer"></span>
                <div class="market-row__value num">
                  {{ fxValue(rates.latestCny, flipCny()) | num: 4 }}</div>
                <span class="badge" [class]="fxPct(rates.cny, flipCny()) >= 0 ? 'badge--ok' : 'badge--warn'">
                  {{ fxPct(rates.cny, flipCny()) >= 0 ? '+' : '' }}{{ fxPct(rates.cny, flipCny()) | num: 1 }}%
                </span>
              </div>
              <app-sparkline class="fx-chart" [values]="fxSeries(chartSlice(rates.cny), flipCny())"
                             [width]="320" [height]="42" />
              <div class="fx-months">
                @for (tick of monthTicks(chartDates(rates), chartSlice(rates.cny), flipCny()); track tick.pct) {
                  <span [style.left.%]="tick.pct">{{ tick.label }}
                    <em>{{ tick.value | num: 2 }}</em></span>
                }
              </div>
            </button>
            <!-- The cross that CNY-quoted EXW prices actually follow: a
                 weakening yuan against the dollar is a second discount on
                 top of the euro effect. -->
            <button class="market-row market-row--btn market-row--stack" type="button"
                    (click)="flipCross.set(!flipCross())">
              <div class="market-row__top">
                <div class="market-row__label">{{ flipCross() ? 'CNY → USD' : 'USD → CNY' }}
                  <app-icon name="exchange" [size]="12" /></div>
                <span class="spacer"></span>
                <div class="market-row__value num">
                  {{ fxValue(latestCross(rates), flipCross()) | num: 4 }}</div>
                <span class="badge" [class]="fxPct(crossOf(rates), flipCross()) >= 0 ? 'badge--ok' : 'badge--warn'">
                  {{ fxPct(crossOf(rates), flipCross()) >= 0 ? '+' : '' }}{{ fxPct(crossOf(rates), flipCross()) | num: 1 }}%
                </span>
              </div>
              <app-sparkline class="fx-chart" [values]="fxSeries(chartSlice(crossOf(rates)), flipCross())"
                             [width]="320" [height]="42" />
              <div class="fx-months">
                @for (tick of monthTicks(chartDates(rates), chartSlice(crossOf(rates)), flipCross()); track tick.pct) {
                  <span [style.left.%]="tick.pct">{{ tick.label }}
                    <em>{{ tick.value | num: 2 }}</em></span>
                }
              </div>
            </button>
            <!-- What the movement MEANS for this business, not just the
                 number: purchasing pays in dollars and yuan. -->
            @if (analysis(rates); as a) {
              <div class="market-analysis">
                <div class="market-analysis__verdict">
                  <span class="badge" [class]="'badge--' + a.tone">{{ a.verdict }}</span>
                  <span class="market-analysis__lead">{{ a.lead }}</span>
                </div>
                <!-- Is now a better moment than then? Green = the dollar is
                     cheaper today than at that point. -->
                <div class="market-analysis__horizons">
                  @for (h of a.horizons; track h.label) {
                    <span class="hchip" [class.hchip--good]="h.pct >= 0"
                          [class.hchip--bad]="h.pct < 0">
                      vs {{ h.label }}: {{ (h.pct < 0 ? -h.pct : h.pct) | num: 1 }}%
                      {{ h.pct >= 0 ? 'goedkoper' : 'duurder' }}
                    </span>
                  }
                </div>
                @for (line of a.lines; track line) {
                  <div class="market-analysis__line">
                    <span class="market-analysis__dot"></span>{{ line }}
                  </div>
                }
              </div>
            }
          </div>
        </div>
      } @else if (!fx.failed()) {
        <app-skeleton kind="card" [rows]="1" />
      }

      <div class="card mt-12">
        <div class="card__head"><h2>Containervracht</h2>
          <span class="spacer"></span>
          <button class="btn btn--sm" type="button" (click)="rateSheet.set(true)">+ Tarief</button>
        </div>
        <div class="card__body">
          @if (wciSeries().length) {
            <button class="market-row market-row--btn" type="button"
                    (click)="openHistory('WCI SHA-RTM', 'Shanghai → Rotterdam', '$')">
              <div>
                <div class="market-row__label">Shanghai → Rotterdam</div>
                <div class="market-row__value num">$ {{ wciLatest() | num: 0 }}</div>
                <div class="tiny muted">Drewry WCI · wekelijks · per 40ft</div>
              </div>
              <app-sparkline class="market-row__spark" [values]="wciSeries()" />
            </button>
          }
          @for (route of ownRoutes; track route.code) {
            <button class="market-row market-row--btn" type="button"
                    [disabled]="!latestFor(route.code)"
                    (click)="openHistory(route.code, route.label + ' → Rotterdam', '$')">
              <div>
                <div class="market-row__label">{{ route.label }} → Rotterdam</div>
                @if (latestFor(route.code); as latest) {
                  <div class="market-row__value num">$ {{ latest.usdPerContainer | num: 0 }}</div>
                  <div class="tiny muted">eigen notering · {{ latest.quotedOn }}</div>
                } @else {
                  <div class="tiny muted">nog geen notering — noteer wat je forwarder vraagt</div>
                }
              </div>
              @if (seriesFor(route.code).length > 1) {
                <app-sparkline class="market-row__spark" [values]="seriesFor(route.code)" />
              }
            </button>
          }
        </div>
      </div>

      <div class="section-title">Recente verkooporders</div>
      <div class="card">
        <div class="list">
          @for (row of recentSales(); track row.order.id) {
            <a class="list-item" [routerLink]="['/sales', row.order.id]">
              <div class="list-item__body">
                <div class="list-item__title">{{ row.order.number }}</div>
                <div class="list-item__meta">
                  {{ row.priced.totals.pieces | num }} st ·
                  {{ row.priced.totals.palletsStrict }} pallet(s)
                </div>
              </div>
              <div class="list-item__end">
                <div class="strong num">{{ row.priced.totals.total | eur: 0 }}</div>
                <span class="badge" [class]="'badge--' + cls(row.order.status)">
                  {{ label(row.order.status) }}
                </span>
              </div>
              <span class="list-item__chev">›</span>
            </a>
          } @empty {
            <div class="empty"><div class="empty__title">
              Nog geen verkooporders</div></div>
          }
        </div>
      </div>

      <div class="section-title">Inkoop</div>
      <div class="card">
        <div class="list">
          @for (row of purchases(); track row.order.id) {
            <a class="list-item" [routerLink]="['/purchasing', row.order.id]">
              <div class="list-item__body">
                <div class="list-item__title">{{ row.order.number }}</div>
                <div class="list-item__meta">
                  {{ containerLabel(row.order.containerType) }} ·
                  {{ row.costing.totals.cartons | num }} kartons
                </div>
              </div>
              <div class="list-item__end">
                @if (privacy.showPurchase()) {
                  <div class="strong num">{{ row.costing.totals.totalEur | eur: 0 }}</div>
                }
                <div class="tiny muted">{{ purchaseStatusLabel(row.order.status) }}</div>
              </div>
              <span class="list-item__chev">›</span>
            </a>
          } @empty {
            <div class="empty"><div class="empty__title">
              Nog geen inkooporders</div></div>
          }
        </div>
      </div>
    </div>

    @if (rateSheet()) {
      <app-sheet title="Vrachttarief noteren" (closed)="rateSheet.set(false)">
        <div body>
          <div class="field">
            <label for="fr-route">Route</label>
            <select class="select" id="fr-route" [ngModel]="newRoute()"
                    (ngModelChange)="newRoute.set($event)">
              @for (route of ownRoutes; track route.code) {
                <option [value]="route.code">{{ route.label }} → Rotterdam</option>
              }
            </select>
          </div>
          <div class="field">
            <label class="req" for="fr-usd">USD per 40ft-container</label>
            <input class="input num right" id="fr-usd" type="number" min="0" step="50"
                   inputmode="decimal" [ngModel]="newRate()"
                   (ngModelChange)="newRate.set(+$event)" />
            <span class="hint">Wat de forwarder offreert; de grafiek bouwt zichzelf op.</span>
          </div>
          <div class="field">
            <label for="fr-date">Datum <span class="opt"></span></label>
            <input class="input" id="fr-date" type="date" [ngModel]="newDate()"
                   (ngModelChange)="newDate.set($event)" />
            <span class="hint">Laat op vandaag staan, of noteer een oudere offerte om de
              historiek aan te vullen.</span>
          </div>
        </div>
        <div foot style="display:contents">
          <button class="btn" type="button" (click)="rateSheet.set(false)">Annuleren</button>
          <button class="btn btn--primary" type="button" [disabled]="!newRate()"
                  (click)="saveRate()">Bewaren</button>
        </div>
      </app-sheet>
    }

    @if (historyRoute(); as history) {
      <app-sheet [title]="history.label" (closed)="historyRoute.set(null)">
        <div body>
          @for (rate of historyFor(history.code); track rate.id) {
            <div class="market-row">
              <div>
                <div class="market-row__value num" style="font-size:15px">
                  {{ history.unit }}{{ rate.usdPerContainer | num: history.unit ? 0 : 1 }}
                  @if (!history.unit) { <span class="tiny muted">ptn</span> }
                </div>
                <div class="tiny muted">{{ rate.quotedOn }}</div>
              </div>
              <button class="pallet__tool" type="button" aria-label="Verwijderen"
                      (click)="deleteRate(rate)">✕</button>
            </div>
          } @empty {
            <div class="empty"><div class="empty__title">Nog geen historiek</div></div>
          }
        </div>
        <div foot style="display:contents">
          <button class="btn btn--primary btn--block" type="button"
                  (click)="historyRoute.set(null)">Sluiten</button>
        </div>
      </app-sheet>
    }
  `,
})
export class Dashboard {

  readonly fx = inject(Fx);

  /* ---- freight-rate log --------------------------------------------- */

  readonly ownRoutes = [
    { code: 'NINGBO', label: 'Ningbo' },
    { code: 'GUANGZHOU', label: 'Guangzhou' },
    { code: 'SHENZHEN', label: 'Shenzhen' },
  ];
  readonly freightRates = signal<FreightRate[]>([]);
  readonly rateSheet = signal(false);
  readonly newRoute = signal('NINGBO');
  readonly newRate = signal(0);
  readonly newDate = signal(new Date().toISOString().slice(0, 10));

  /* Flipped = "what does one dollar/yuan cost" instead of "what does my
     euro buy". */
  readonly flipUsd = signal(false);
  readonly flipCny = signal(false);

  readonly historyRoute = signal<{ code: string; label: string; unit: string } | null>(null);

  fxValue(rate: number, flipped: boolean): number {
    return flipped ? 1 / rate : rate;
  }

  fxSeries(series: number[], flipped: boolean): number[] {
    return flipped ? series.map((value) => 1 / value) : series;
  }

  /**
   * Change over the past month (~22 working days), matching the hint's
   * horizon - the chart tells the half-year story, the number tells what
   * changed since the last container was priced.
   */
  fxPct(series: number[], flipped: boolean): number {
    const values = this.fxSeries(series, flipped).slice(-23);
    return ((values[values.length - 1] - values[0]) / values[0]) * 100;
  }

  /**
   * Where each month starts in the series, with the rate it opened on -
   * the mark answers "when" and "at what" in one glance.
   */
  monthTicks(dates: string[], series: number[], flipped: boolean)
      : { pct: number; label: string; value: number }[] {
    const names = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun',
        'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
    const values = this.fxSeries(series, flipped);
    const ticks: { pct: number; label: string; value: number }[] = [];
    for (let i = 1; i < dates.length; i++) {
      if (dates[i].slice(5, 7) !== dates[i - 1].slice(5, 7)) {
        ticks.push({
          pct: (i / (dates.length - 1)) * 100,
          label: names[+dates[i].slice(5, 7) - 1],
          value: values[i],
        });
      }
    }
    /* The last tick sits too close to the right edge to stay readable. */
    return ticks.filter((tick) => tick.pct < 90);
  }

  openHistory(code: string, label: string, unit: string): void {
    this.historyRoute.set({ code, label, unit });
  }

  /** Newest first: the question is what it costs now and how it got there. */
  historyFor(code: string): FreightRate[] {
    return this.freightRates()
        .filter((rate) => rate.route === code)
        .slice()
        .reverse();
  }

  async deleteRate(rate: FreightRate): Promise<void> {
    if (rate.id == null) return;
    await this.sourcing.deleteFreightRate(rate.id);
    this.freightRates.set(await this.sourcing.freightRates());
  }

  readonly wciSeries = computed(() => this.freightRates()
      .filter((rate) => rate.route === 'WCI SHA-RTM')
      .map((rate) => rate.usdPerContainer));

  wciLatest(): number {
    const series = this.wciSeries();
    return series[series.length - 1] ?? 0;
  }

  seriesFor(route: string): number[] {
    return this.freightRates()
        .filter((rate) => rate.route === route)
        .map((rate) => rate.usdPerContainer);
  }

  latestFor(route: string): FreightRate | null {
    const rates = this.freightRates().filter((rate) => rate.route === route);
    return rates[rates.length - 1] ?? null;
  }

  async saveRate(): Promise<void> {
    await this.sourcing.addFreightRate(this.newRoute(), this.newRate(),
        this.newDate() || null);
    this.freightRates.set(await this.sourcing.freightRates());
    this.rateSheet.set(false);
    this.newRate.set(0);
    this.newDate.set(new Date().toISOString().slice(0, 10));
  }

  /**
   * What the currency move means at the buying desk, in one sentence.
   *
   * The euro-dollar rate decides what Chinese purchasing costs: suppliers
   * quote USD or CNY, and the yuan shadows the dollar closely enough that
   * one story covers both.
   */
  readonly flipCross = signal(false);

  /* Derived once per fetched series; the template asks for it often. */
  private readonly crossCache = new WeakMap<FxSeries, number[]>();

  /** CNY per USD - the cross a Chinese EXW price actually moves with. */
  crossOf(rates: FxSeries): number[] {
    let cross = this.crossCache.get(rates);
    if (!cross) {
      cross = rates.cny.map((value, i) => value / rates.usd[i]);
      this.crossCache.set(rates, cross);
    }
    return cross;
  }

  latestCross(rates: FxSeries): number {
    return rates.latestCny / rates.latestUsd;
  }

  /* The charts stay at six months (a year of month labels does not fit a
     phone); the analysis below reads the full year. */
  private static readonly CHART_DAYS = 126;

  chartSlice(series: number[]): number[] {
    return series.slice(-Dashboard.CHART_DAYS);
  }

  chartDates(rates: FxSeries): string[] {
    return rates.dates.slice(-Dashboard.CHART_DAYS);
  }

  /**
   * The buying-desk analysis, computed fresh from the ECB series (and the
   * freight log when it has data). No external "analyst" API: every signal
   * here is arithmetic on primary data, so it needs no keys, cannot go
   * stale behind a paywall, and every sentence can be traced to a number.
   *
   * Signals:
   * - dollar over one month and over the visible half year;
   * - where today sits in the 6-month range (bottom = dollar at its
   *   cheapest point, a concrete buying moment);
   * - the USD/CNY cross (EURCNY / EURUSD): when the yuan weakens against
   *   the dollar, CNY-quoted EXW prices get an extra discount on top;
   * - what the month's move means per $10,000 of purchasing;
   * - the freight trend from the WCI log, because a cheap dollar can be
   *   eaten by an expensive container.
   */
  analysis(rates: FxSeries): {
    verdict: string; tone: string; lead: string; lines: string[];
    horizons: { label: string; pct: number }[];
  } | null {
    const usd = rates.usd;
    if (usd.length < 30) return null;
    const pct = (series: number[], back: number) => {
      const i = Math.max(0, series.length - 1 - back);
      return ((series[series.length - 1] - series[i]) / series[i]) * 100;
    };
    const nl = (value: number, decimals = 1) =>
        value.toFixed(decimals).replace('.', ',');

    const usdMonth = pct(usd, 22);
    /* Buying moments compared with 3, 6 and 12 months back; positive =
       the dollar is cheaper now than it was then. */
    const horizons = [
      { label: '3 mnd', back: 65 },
      { label: '6 mnd', back: 130 },
      { label: '12 mnd', back: usd.length - 1 },
    ].filter((h, i, all) => h.back <= usd.length - 1
        && (i === 0 || h.back > all[i - 1].back))
      .map((h) => ({ label: h.label, pct: pct(usd, h.back) }));
    const min = Math.min(...usd);
    const max = Math.max(...usd);
    /* 1 = euro at its strongest (dollar cheapest), 0 = weakest. */
    const rangePos = max === min ? 0.5 : (usd[usd.length - 1] - min) / (max - min);

    /* Rising = yuan weakening against the dollar. */
    const crossMonth = pct(this.crossOf(rates), 22);

    const lines: string[] = [];
    lines.push(`Dollar: ${nl(Math.abs(usdMonth))}% ` +
        `${usdMonth >= 0 ? 'goedkoper' : 'duurder'} dan een maand geleden.`);

    if (rangePos >= 0.85) {
      lines.push(`De euro staat op zijn sterkste punt in twaalf maanden — ` +
          `dollarinkoop is nu op zijn goedkoopst binnen die periode.`);
    } else if (rangePos <= 0.15) {
      lines.push(`De euro staat op zijn zwakste punt in twaalf maanden — ` +
          `wie kan wachten, koopt waarschijnlijk beter later.`);
    }

    if (Math.abs(crossMonth) >= 0.4) {
      lines.push(crossMonth > 0
          ? `Yuan verzwakt ${nl(crossMonth)}% tegen de dollar — EXW-prijzen in ` +
            `CNY leveren bovenop het dollareffect extra voordeel op.`
          : `Yuan verstevigt ${nl(Math.abs(crossMonth))}% tegen de dollar — het ` +
            `voordeel geldt vooral voor EXW in USD, minder voor CNY.`);
    }

    const perTenK = Math.abs(usdMonth) * 10000 / 100 /
        rates.latestUsd;
    if (Math.abs(usdMonth) >= 0.3) {
      lines.push(`Per $10.000 aan inkoop scheelt de maandbeweging zo'n ` +
          `€ ${Math.round(perTenK)}.`);
    }

    /* Freight from the WCI log, when the scraper or the owner fed it. */
    const wci = this.seriesFor('WCI SHA-RTM');
    if (wci.length > 1) {
      const freight = ((wci[wci.length - 1] - wci[wci.length - 2]) /
          wci[wci.length - 2]) * 100;
      if (Math.abs(freight) >= 1) {
        lines.push(`Zeevracht Shanghai → Rotterdam: ` +
            `${freight <= 0 ? '−' : '+'}${nl(Math.abs(freight))}% vs de vorige ` +
            `notering (${'$'}${Math.round(wci[wci.length - 1]).toLocaleString('nl-BE')}/40ft).`);
      }
    }

    /* Verdict: strong signals first, then the range as tiebreaker. */
    let verdict: string;
    let tone: string;
    let lead: string;
    if (usdMonth >= 1 || (usdMonth >= 0.3 && rangePos >= 0.8)) {
      verdict = 'Gunstig koopmoment';
      tone = 'ok';
      lead = 'De euro koopt merkbaar meer dollar dan vorige maand.';
    } else if (usdMonth <= -1) {
      verdict = 'Ongunstig';
      tone = 'warn';
      lead = 'Dezelfde EXW-prijs kost nu duidelijk meer euro\u2019s dan vorige maand.';
    } else {
      verdict = 'Neutraal';
      tone = 'neutral';
      lead = 'Geen uitgesproken voor- of nadeel tegenover vorige maand.';
    }
    return { verdict, tone, lead, lines, horizons };
  }
  purchaseStatusLabel(status: string): string {
    return PURCHASE_STATUS_LABEL[status] ?? status;
  }

  readonly containerLabel = containerLabel;

  /** Warm at nine in the morning, calm at eleven at night. */
  greeting(): string {
    const hour = new Date().getHours();
    if (hour < 6) return 'Nog wakker?';
    if (hour < 12) return 'Goeiemorgen';
    if (hour < 18) return 'Goeiemiddag';
    return 'Goeieavond';
  }

  today(): string {
    return new Intl.DateTimeFormat('nl-BE',
        { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  }

  private readonly sales = inject(SalesApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly catalog = inject(CatalogApi);
  readonly privacy = inject(Privacy);

  readonly salesOrders = signal<SalesOrderView[]>([]);
  readonly purchases = signal<PurchaseOrderView[]>([]);
  readonly revisions = signal<QuoteRevision[]>([]);
  readonly productCount = signal(0);
  readonly loading = signal(true);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    /* Market data loads independently: a slow external feed must never
       hold up the work overview. */
    void this.fx.load();
    void this.sourcing.freightRates()
        .then((rates) => this.freightRates.set(rates))
        .catch(() => undefined);

    const [orders, purchases, revisions, products] = await Promise.all([
      this.sales.orders(), this.sourcing.purchaseOrders(),
      this.sales.pendingRevisions(), this.catalog.products(),
    ]);
    this.salesOrders.set(orders);
    this.purchases.set(purchases.slice(0, 5));
    this.revisions.set(revisions);
    this.productCount.set(products.length);
    this.loading.set(false);
  }

  readonly openOrders = computed(() =>
    this.salesOrders().filter((row) =>
      ['CONCEPT', 'VERZONDEN', 'BEKEKEN', 'WIJZIGING_GEVRAAGD'].includes(row.order.status)));

  readonly openValue = computed(() =>
    this.openOrders().reduce((sum, row) => sum + row.priced.totals.total, 0));
  readonly marginEur = computed(() =>
    this.openOrders().reduce((sum, row) => sum + row.priced.totals.marginEur, 0));
  readonly marginPct = computed(() => {
    const goods = this.openOrders().reduce((sum, row) => sum + row.priced.totals.goodsTotal, 0);
    return goods > 0 ? (this.marginEur() / goods) * 100 : 0;
  });

  readonly incoming = computed(() =>
    this.purchases().filter((row) => ['BESTELD', 'ONDERWEG'].includes(row.order.status)));
  readonly incomingValue = computed(() =>
    this.incoming().reduce((sum, row) => sum + row.costing.totals.totalEur, 0));

  readonly recentSales = computed(() => this.salesOrders().slice(0, 5));

  label = (status: SalesOrderView['order']['status']) => STATUS_LABEL[status];
  cls = statusClass;
}
