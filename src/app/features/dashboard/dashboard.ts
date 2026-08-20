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
import { CbmPipe, EurPipe, NumPipe, PctPipe } from '../../shared/pipes';
import { STATUS_LABEL, statusClass } from '../sales/quote-status';
import { containerLabel } from '../../core/api/geo';

const PURCHASE_STATUS_LABEL: Record<string, string> = {
  CONCEPT: 'Concept', BESTELD: 'Besteld', ONDERWEG: 'Onderweg', ONTVANGEN: 'Ontvangen',
};

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, Sparkline, Icon, Sheet, FormsModule, RouterLink, PageHeader,
            EurPipe, NumPipe, PctPipe, CbmPipe],
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
          <div class="kpi__meta">
            @if (catalogAttention()) { {{ catalogAttention() }} met aandacht }
            @else { productmaster compleet }
          </div>
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

      @if (catalogAttention()) {
        <a class="alert alert--warn mt-12" routerLink="/products"
           style="text-decoration:none;color:inherit">
          <span class="alert__icon">◈</span>
          <div>
            <b>{{ catalogAttention() }} product(en)</b> missen nog informatie voor website of
            orderapp. Tik om de productmaster af te werken.
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
                <span class="badge" [class]="fxPct(rates, rates.usd, flipUsd()) >= 0 ? 'badge--ok' : 'badge--warn'">
                  {{ fxPct(rates, rates.usd, flipUsd()) >= 0 ? '+' : '' }}{{ fxPct(rates, rates.usd, flipUsd()) | num: 1 }}% · 1 mnd
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
                <span class="badge" [class]="fxPct(rates, rates.cny, flipCny()) >= 0 ? 'badge--ok' : 'badge--warn'">
                  {{ fxPct(rates, rates.cny, flipCny()) >= 0 ? '+' : '' }}{{ fxPct(rates, rates.cny, flipCny()) | num: 1 }}% · 1 mnd
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
                <span class="badge" [class]="fxPct(rates, crossOf(rates), flipCross()) >= 0 ? 'badge--ok' : 'badge--warn'">
                  {{ fxPct(rates, crossOf(rates), flipCross()) >= 0 ? '+' : '' }}{{ fxPct(rates, crossOf(rates), flipCross()) | num: 1 }}% · 1 mnd
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
                <div class="market-analysis__range-label">Vergelijk met</div>
                <!-- These are controls, not passive statistics: the complete
                     buying analysis below follows the selected period. -->
                <div class="hgrid" role="group" aria-label="Kies de analyseperiode">
                  @for (h of a.horizons; track h.label) {
                    <button class="hgrid__cell" type="button"
                            [class.hgrid__cell--active]="analysisMonths() === h.months"
                            [attr.aria-pressed]="analysisMonths() === h.months"
                            [disabled]="h.pct === null"
                            (click)="analysisMonths.set(h.months)">
                      <span class="hgrid__label">{{ h.label }}</span>
                      @if (h.pct !== null) {
                        <span class="hgrid__value"
                              [class.hgrid__value--good]="h.pct >= 0"
                              [class.hgrid__value--bad]="h.pct < 0">
                          {{ h.pct >= 0 ? '↓' : '↑' }}{{ (h.pct < 0 ? -h.pct : h.pct) | num: 1 }}%
                        </span>
                        <span class="hgrid__word">{{ h.pct >= 0 ? 'goedkoper' : 'duurder' }}</span>
                      } @else {
                        <span class="hgrid__value hgrid__value--missing">—</span>
                        <span class="hgrid__word">geen data</span>
                      }
                    </button>
                  }
                </div>
                <div class="market-analysis__verdict">
                  <span class="badge" [class]="'badge--' + a.tone">{{ a.verdict }}</span>
                  <span class="market-analysis__lead">{{ a.lead }}</span>
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
          <button class="btn btn--sm" type="button" (click)="openRateSheet()"
                  aria-label="Forwarderofferte voor containervracht noteren">+ Tarief</button>
        </div>
        <div class="card__body">
          <div class="market-hint" style="margin:0 0 8px" role="note">
            <strong>USD per 40ft-container.</strong> Shanghai is de wekelijkse
            Drewry-marktbenchmark; de havenroutes tonen je exacte forwarderoffertes.
            <strong>CCFI</strong> (China Containerized Freight Index) meet heel de
            Chinese kust → Europa, <strong>NCFI</strong> (Ningbo Containerized
            Freight Index) het vertrek uit Ningbo — in punten t.o.v. het basisjaar
            (1000): niet de prijs maar de richting. Daalt de index, dan hoort je
            volgende offerte mee te dalen.
          </div>
          @if (wciSeries().length) {
            <button class="market-row market-row--btn" type="button"
                    aria-label="Historiek van de Drewry-marktbenchmark Shanghai naar Rotterdam bekijken"
                    (click)="openHistory('WCI SHA-RTM', 'Shanghai → Rotterdam · USD per 40ft', 'USD ')">
              <div>
                <div class="market-row__label">Shanghai → Rotterdam</div>
                <div class="market-row__value num">USD {{ wciLatest() | num: 0 }}</div>
                <div class="tiny muted">Drewry WCI · wekelijkse marktbenchmark · 40ft</div>
              </div>
              <app-sparkline class="market-row__spark" [values]="wciSeries()" />
            </button>
          }
          <!-- Index rows: points, not dollars. The trend is the signal;
               the forwarder quote below stays the price. -->
          @for (index of marketIndices; track index.code) {
            @if (latestFor(index.code); as latest) {
              <button class="market-row market-row--btn" type="button"
                      (click)="openHistory(index.code, index.title, '')">
                <div>
                  <div class="market-row__label">{{ index.label }}</div>
                  <div class="market-row__value num">{{ latest.usdPerContainer | num: 0 }}
                    <span class="tiny muted">ptn</span>
                    @if (indexChange(index.code); as change) {
                      <span class="badge"
                            [class]="change <= 0 ? 'badge--ok' : 'badge--warn'">
                        {{ change > 0 ? '+' : '' }}{{ change | num: 1 }}%
                      </span>
                    }
                  </div>
                  <div class="tiny muted">{{ index.sub }} · {{ latest.quotedOn }}</div>
                </div>
                @if (seriesFor(index.code).length > 1) {
                  <app-sparkline class="market-row__spark" [values]="seriesFor(index.code)" />
                }
              </button>
            }
          }
          @for (route of ownRoutes; track route.code) {
            <button class="market-row market-row--btn" type="button"
                    [attr.aria-label]="freightRouteAriaLabel(route)"
                    (click)="openFreightRoute(route)">
              <div>
                <div class="market-row__label">{{ route.label }} → Rotterdam</div>
                @if (latestFor(route.code); as latest) {
                  <div class="market-row__value num">USD {{ latest.usdPerContainer | num: 0 }}
                    @if (route.indexCode && latestFor(route.indexCode); as index) {
                      <span class="index-chip index-chip--tap" role="button" tabindex="0"
                            [title]="route.indexName + ' — tik voor historiek'"
                            (click)="$event.stopPropagation();
                                     openHistory(route.indexCode!, route.indexTitle!, '')"
                            (keydown.enter)="$event.stopPropagation();
                                     openHistory(route.indexCode!, route.indexTitle!, '')">
                        {{ route.indexName }} {{ index.usdPerContainer | num: 0 }} ptn
                        @if (indexChange(route.indexCode); as change) {
                          <em [class.up]="change > 0" [class.down]="change <= 0">
                            {{ change > 0 ? '+' : '' }}{{ change | num: 1 }}%</em>
                        }
                      </span>
                    }
                  </div>
                  <div class="tiny muted">exacte forwarderofferte · {{ latest.quotedOn }} · 40ft</div>
                } @else {
                  <div class="tiny muted">Nog geen forwarderofferte
                    @if (route.indexCode && latestFor(route.indexCode); as index) {
                      · <span class="index-link" role="button" tabindex="0"
                              (click)="$event.stopPropagation();
                                       openHistory(route.indexCode!, route.indexTitle!, '')"
                              (keydown.enter)="$event.stopPropagation();
                                       openHistory(route.indexCode!, route.indexTitle!, '')">
                        markt: {{ route.indexName }} {{ index.usdPerContainer | num: 0 }} ptn
                        @if (indexChange(route.indexCode); as change) {
                          ({{ change > 0 ? '+' : '' }}{{ change | num: 1 }}%)
                        }
                      </span>
                    }
                  </div>
                  <div class="strong">Tarief noteren <span aria-hidden="true">›</span></div>
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
                  @if (row.order.loadMode === 'LOOSE_CARTONS') {
                    {{ row.priced.totals.cartons | num }}
                    {{ row.priced.totals.cartons === 1 ? 'doos' : 'dozen' }} ·
                    {{ row.priced.totals.cbm | cbm }}
                  } @else {
                    {{ row.priced.totals.palletsManual || row.priced.totals.palletsStrict }}
                    {{ (row.priced.totals.palletsManual || row.priced.totals.palletsStrict) === 1
                        ? 'pallet' : 'pallets' }}
                  }
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
          @if (rateHorizons(history.code).length) {
            <!-- Same reading as the FX tiles: is it cheaper now than then?
                 For freight a falling number is the green one. -->
            <div class="hgrid" style="margin-bottom:8px">
              @for (h of rateHorizons(history.code); track h.label) {
                <div class="hgrid__cell">
                  <span class="hgrid__label">{{ h.label }}</span>
                  <span class="hgrid__value"
                        [class.hgrid__value--good]="h.pct <= 0"
                        [class.hgrid__value--bad]="h.pct > 0">
                    {{ h.pct > 0 ? '↑' : '↓' }}{{ (h.pct < 0 ? -h.pct : h.pct) | num: 1 }}%
                  </span>
                  <span class="hgrid__word">{{ h.pct > 0 ? 'duurder' : 'goedkoper' }}</span>
                </div>
              }
            </div>
            <p class="tiny muted" style="margin:0 0 10px">
              {{ horizonNote(history.code) }}
            </p>
          }
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

  /* indexCode couples a port row to its public weekly index, so the own
     USD quote and the market's points sit side by side on one row. */
  readonly ownRoutes = [
    { code: 'NINGBO', label: 'Ningbo', indexCode: 'NCFI NINGBO', indexName: 'NCFI',
      indexTitle: 'NCFI composiet · vertrek Ningbo · indexpunten' },
    /* No public per-port index exists for South China; the whole-coast
       CCFI is the honest market context for both. */
    { code: 'GUANGZHOU', label: 'Nansha (Guangzhou)', indexCode: 'CCFI CN-EUR',
      indexName: 'CCFI', indexTitle: 'CCFI Europa-route · indexpunten' },
    { code: 'SHENZHEN', label: 'Yantian (Shenzhen)', indexCode: 'CCFI CN-EUR',
      indexName: 'CCFI', indexTitle: 'CCFI Europa-route · indexpunten' },
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
  readonly analysisMonths = signal<1 | 3 | 6 | 12>(1);

  readonly historyRoute = signal<{ code: string; label: string; unit: string } | null>(null);

  fxValue(rate: number, flipped: boolean): number {
    return flipped ? 1 / rate : rate;
  }

  fxSeries(series: number[], flipped: boolean): number[] {
    return flipped ? series.map((value) => 1 / value) : series;
  }

  /** Calendar-month change, using the same ECB baseline as the analysis. */
  fxPct(rates: FxSeries, series: number[], flipped: boolean): number {
    const baseline = this.baselineIndex(rates, 1);
    if (baseline === null || series.length !== rates.dates.length) return 0;
    const values = this.fxSeries(series, flipped);
    return ((values[values.length - 1] - values[baseline]) / values[baseline]) * 100;
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

  /**
   * Change versus roughly 1, 3, 6 and 12 months back, computed from the
   * DATED entries of a route - the log is weekly-ish with holes (holiday
   * weeks have no reprint), so each horizon looks for the entry closest
   * to its target date and gives up beyond three weeks' distance rather
   * than compare against a wrong era. Horizons without data simply do
   * not render; nothing is interpolated or invented.
   */
  rateHorizons(code: string): { label: string; pct: number }[] {
    const entries = this.freightRates()
        .filter((rate) => rate.route === code)
        .slice()
        .sort((a, b) => a.quotedOn.localeCompare(b.quotedOn));
    if (entries.length < 2) return [];
    const latest = entries[entries.length - 1];
    const latestDate = new Date(latest.quotedOn).getTime();
    const day = 24 * 3600 * 1000;

    const result: { label: string; pct: number }[] = [];
    for (const horizon of [
      { label: '1 mnd', days: 30 },
      { label: '3 mnd', days: 91 },
      { label: '6 mnd', days: 182 },
      { label: '12 mnd', days: 365 },
    ]) {
      const target = latestDate - horizon.days * day;
      let best: { distance: number; value: number } | null = null;
      for (const entry of entries.slice(0, -1)) {
        const distance = Math.abs(new Date(entry.quotedOn).getTime() - target);
        if (!best || distance < best.distance) {
          best = { distance, value: entry.usdPerContainer };
        }
      }
      if (!best || best.distance > 21 * day) continue;
      result.push({
        label: horizon.label,
        pct: ((latest.usdPerContainer - best.value) / best.value) * 100,
      });
    }
    return result;
  }

  horizonNote(code: string): string {
    const entries = this.freightRates().filter((rate) => rate.route === code);
    const missing = 4 - this.rateHorizons(code).length;
    const base = `t.o.v. de dichtstbijzijnde notering per periode · ${entries.length} noteringen`;
    return missing > 0 ? `${base} · langere periodes volgen zodra er historiek is` : base;
  }

  openHistory(code: string, label: string, unit: string): void {
    this.historyRoute.set({ code, label, unit });
  }

  openRateSheet(route?: string): void {
    if (route) this.newRoute.set(route);
    this.rateSheet.set(true);
  }

  openFreightRoute(route: { code: string; label: string }): void {
    if (this.latestFor(route.code)) {
      this.openHistory(route.code, `${route.label} → Rotterdam · USD per 40ft`, 'USD ');
      return;
    }
    this.openRateSheet(route.code);
  }

  freightRouteAriaLabel(route: { code: string; label: string }): string {
    const action = this.latestFor(route.code) ? 'Historiek bekijken' : 'Tarief noteren';
    return `${action} voor ${route.label} naar Rotterdam, USD per 40ft-container`;
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

  /* The two public weekly indices next to the own forwarder quotes.
     CCFI covers the whole Chinese coast per destination; NCFI is the
     Ningbo-departure composite - the closest open numbers to
     "Ningbo/Guangzhou/Shenzhen -> Europe", since no per-port index is
     published publicly. */
  readonly marketIndices = [
    { code: 'CCFI CN-EUR', label: 'China → Europa · CCFI',
      title: 'CCFI Europa-route · indexpunten',
      sub: 'alle Chinese havens · wekelijks' },
  ];

  /** Week-over-week change of an index, when two entries exist. */
  indexChange(route: string): number | null {
    const series = this.seriesFor(route);
    if (series.length < 2) return null;
    const previous = series[series.length - 2];
    return ((series[series.length - 1] - previous) / previous) * 100;
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

  /** The last published ECB day on or before the calendar baseline. */
  private baselineIndex(rates: FxSeries, months: 1 | 3 | 6 | 12): number | null {
    if (rates.dates.length < 2 || rates.dates.length !== rates.usd.length ||
        rates.dates.length !== rates.cny.length) return null;

    const latest = new Date(`${rates.dates[rates.dates.length - 1]}T00:00:00Z`);
    if (Number.isNaN(latest.getTime())) return null;

    /* Clamp month-end dates: 31 August - 6 months is 28/29 February,
       never an overflow into March. */
    const targetMonth = new Date(Date.UTC(
        latest.getUTCFullYear(), latest.getUTCMonth() - months, 1));
    const monthEnd = new Date(Date.UTC(
        targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate();
    const target = new Date(Date.UTC(
        targetMonth.getUTCFullYear(), targetMonth.getUTCMonth(),
        Math.min(latest.getUTCDate(), monthEnd)));

    let baseline = -1;
    for (let i = 0; i < rates.dates.length - 1; i++) {
      const date = new Date(`${rates.dates[i]}T00:00:00Z`);
      if (Number.isNaN(date.getTime())) return null;
      if (date <= target) baseline = i;
      else break;
    }
    if (baseline < 0) return null;

    /* A weekend/holiday gap is expected; an old, sparse observation is not
       a truthful one-, three-, six- or twelve-month comparison. */
    const chosen = new Date(`${rates.dates[baseline]}T00:00:00Z`);
    const maxGapMs = 10 * 24 * 60 * 60 * 1000;
    return target.getTime() - chosen.getTime() <= maxGapMs ? baseline : null;
  }

  private analysisPeriod(months: 1 | 3 | 6 | 12): string {
    if (months === 1) return 'een maand';
    if (months === 3) return 'drie maanden';
    if (months === 6) return 'zes maanden';
    return 'twaalf maanden';
  }

  private analysisDate(value: string): string {
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('nl-BE', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    }).format(date);
  }

  /**
   * Buying-desk analysis from the ECB series. Every sentence uses the
   * selected calendar baseline, while freight deliberately remains a
   * separate comparison with its previous recorded quote.
   */
  analysis(rates: FxSeries): {
    verdict: string; tone: string; lead: string; lines: string[];
    horizons: {
      label: string; months: 1 | 3 | 6 | 12; pct: number | null;
    }[];
  } | null {
    if (rates.usd.length < 2) return null;
    const nl = (value: number, decimals = 1) =>
        value.toFixed(decimals).replace('.', ',');

    const definitions = [
      { label: '1 mnd', months: 1 as const },
      { label: '3 mnd', months: 3 as const },
      { label: '6 mnd', months: 6 as const },
      { label: '12 mnd', months: 12 as const },
    ];
    const latestIndex = rates.usd.length - 1;
    const latestUsd = rates.usd[latestIndex];
    const contexts = definitions.map((definition) => {
      const index = this.baselineIndex(rates, definition.months);
      const baselineUsd = index === null ? null : rates.usd[index];
      const valid = baselineUsd !== null && Number.isFinite(baselineUsd) &&
          baselineUsd > 0 && Number.isFinite(latestUsd) && latestUsd > 0;
      /* Positive means that one dollar literally costs fewer euros now. */
      const pct = valid ? (1 - baselineUsd! / latestUsd) * 100 : null;
      return { ...definition, index, pct };
    });
    const horizons = contexts.map(({ label, months, pct }) => ({ label, months, pct }));
    const selectedMonths = this.analysisMonths();
    const selected = contexts.find((context) => context.months === selectedMonths);
    const period = this.analysisPeriod(selectedMonths);
    const rangePeriod = selectedMonths === 1 ? 'maand' : period;

    if (!selected || selected.index === null || selected.pct === null) {
      return {
        verdict: 'Onvoldoende historie',
        tone: 'neutral',
        lead: `Voor ${period} zijn nog niet genoeg ECB-koersen beschikbaar.`,
        lines: ['Kies hierboven een beschikbare kortere periode.'],
        horizons,
      };
    }

    const baselineIndex = selected.index;
    const baselineDate = this.analysisDate(rates.dates[baselineIndex]);
    const baselineUsd = rates.usd[baselineIndex];
    const usdCheaperPct = selected.pct;
    const windowUsd = rates.usd.slice(baselineIndex)
        .filter((value) => Number.isFinite(value) && value > 0);
    const min = Math.min(...windowUsd);
    const max = Math.max(...windowUsd);
    /* 1 = euro at its strongest (dollar cheapest), 0 = weakest. */
    const rangePos = max === min ? 0.5 : (latestUsd - min) / (max - min);

    const baselineCross = rates.cny[baselineIndex] / baselineUsd;
    const latestCross = rates.cny[latestIndex] / latestUsd;
    /* Positive = fewer yuan per dollar today, so the yuan strengthened. */
    const yuanStrengthPct = Number.isFinite(baselineCross) && baselineCross > 0 &&
        Number.isFinite(latestCross) && latestCross > 0
      ? (baselineCross / latestCross - 1) * 100
      : null;

    const lines: string[] = [];
    if (Math.abs(usdCheaperPct) < 0.05) {
      lines.push(`Dollar: minder dan 0,1% prijsverschil tegenover ${period} geleden.`);
    } else {
      lines.push(`Dollar: ${nl(Math.abs(usdCheaperPct))}% ` +
          `${usdCheaperPct >= 0 ? 'goedkoper' : 'duurder'} dan ${period} geleden.`);
    }

    if (rangePos >= 0.85) {
      lines.push(`In de afgelopen ${rangePeriod} staat de euro nu dicht bij zijn sterkste ` +
          `punt tegenover de dollar.`);
    } else if (rangePos <= 0.15) {
      lines.push(`In de afgelopen ${rangePeriod} staat de euro nu dicht bij zijn zwakste ` +
          `punt tegenover de dollar.`);
    }

    if (yuanStrengthPct === null) {
      lines.push(`Yuan/dollaranalyse is niet beschikbaar voor deze periode.`);
    } else if (Math.abs(yuanStrengthPct) < 0.05) {
      lines.push(`Yuan: minder dan 0,1% verschil tegenover de dollar over dezelfde periode.`);
    } else {
      lines.push(yuanStrengthPct > 0
          ? `Yuan verstevigt ${nl(yuanStrengthPct)}% tegen de dollar over dezelfde ` +
            `periode — het voordeel geldt vooral voor EXW in USD, minder voor CNY.`
          : `Yuan verzwakt ${nl(Math.abs(yuanStrengthPct))}% tegen de dollar over ` +
            `dezelfde periode — EXW in CNY werd daarmee relatief voordeliger dan EXW in USD.`);
    }

    const eurSavingPerTenK = 10000 / baselineUsd - 10000 / latestUsd;
    const roundedSaving = Math.round(Math.abs(eurSavingPerTenK));
    if (roundedSaving < 1) {
      lines.push(`Per $10.000 aan inkoop is het verschil tegenover ${period} geleden minder dan € 1.`);
    } else if (eurSavingPerTenK > 0) {
      lines.push(`Per $10.000 aan inkoop bespaar je tegenover ${period} geleden ongeveer ` +
          `€ ${roundedSaving.toLocaleString('nl-BE')}.`);
    } else {
      lines.push(`Per $10.000 aan inkoop betaal je tegenover ${period} geleden ongeveer ` +
          `€ ${roundedSaving.toLocaleString('nl-BE')} meer.`);
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

    /* Comparative verdict only: the dashboard describes, never predicts. */
    let verdict: string;
    let tone: string;
    let lead: string;
    if (usdCheaperPct >= 0.5) {
      verdict = 'Goedkoper dan toen';
      tone = 'ok';
      lead = `Een dollar kost nu ${nl(usdCheaperPct)}% minder euro dan op ${baselineDate}.`;
    } else if (usdCheaperPct <= -0.5) {
      verdict = 'Duurder dan toen';
      tone = 'warn';
      lead = `Een dollar kost nu ${nl(Math.abs(usdCheaperPct))}% meer euro dan op ${baselineDate}.`;
    } else {
      verdict = 'Vrijwel gelijk';
      tone = 'neutral';
      lead = `De dollarkosten liggen dicht bij het niveau van ${baselineDate}.`;
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
  readonly catalogAttention = signal(0);
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
    this.catalogAttention.set(products.filter((product) =>
      product.active && (product.publicationIssues?.length ?? 0) > 0).length);
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
