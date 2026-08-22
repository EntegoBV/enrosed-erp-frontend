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
import { FreightRate, MarketSourceStatus, PurchaseOrderView, QuoteRevision, SalesOrderView } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Privacy } from '../../core/api/privacy';
import { CbmPipe, EurPipe, NumPipe, PctPipe } from '../../shared/pipes';
import { STATUS_LABEL, statusClass } from '../sales/quote-status';
import { containerLabel } from '../../core/api/geo';

const PURCHASE_STATUS_LABEL: Record<string, string> = {
  CONCEPT: 'Concept', BESTELD: 'Besteld', ONDERWEG: 'Onderweg', ONTVANGEN: 'Ontvangen',
};

interface FreightHorizon {
  label: string;
  pct: number | null;
  comparedOn: string | null;
  actualDays: number | null;
}

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
            @if (catalogAttention()) { {{ catalogAttention() }} families met aandacht }
            @else { {{ skuCount() }} producten }
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
            <b>{{ catalogAttention() }} productfamilie(s)</b> missen nog informatie voor website of
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
                <div class="market-analysis__range-label">Koopkracht vergeleken met</div>
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
                          {{ h.pct >= 0 ? '↑' : '↓' }}{{ (h.pct < 0 ? -h.pct : h.pct) | num: 1 }}%
                        </span>
                        <span class="hgrid__word">{{ h.pct >= 0 ? 'sterker' : 'zwakker' }}</span>
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

      <!-- Freight, phone-first: two dollar tiles you can quote from, one
           real trend chart in the same idiom as the FX card (months and
           horizons), and our own lanes as tappable tiles. -->
      <div class="card mt-12">
        <div class="card__head"><h2>Containervracht</h2>
          <span class="spacer"></span>
          <span class="tiny muted">USD per 40ft</span>
        </div>
        <div class="card__body">

          <div class="ftiles">
            @for (bench of dollarBenchmarks; track bench.code) {
              <button class="ftile ftile--btn" type="button"
                      [disabled]="!latestFor(bench.code)"
                      (click)="openHistory(bench.code, bench.title, 'USD ')">
                <span class="ftile__label">{{ bench.label }}</span>
                @if (latestFor(bench.code); as latest) {
                  <span class="ftile__value num">$ {{ latest.usdPerContainer | num: 0 }}</span>
                  <span class="ftile__sub">{{ bench.source }} · {{ shortDate(latest.quotedOn) }}
                    @if (indexChange(bench.code); as change) {
                      <b [class.ok-text]="change <= 0" [class.warn-text]="change > 0">
                        {{ change > 0 ? '+' : '' }}{{ change | num: 1 }}%</b>
                    }
                  </span>
                } @else {
                  <span class="ftile__value muted">—</span>
                  <span class="ftile__sub">{{ bench.source }} · volgt</span>
                }
              </button>
            }
          </div>

          @if (trendOptions().length) {
            <div class="ftrend">
              <div class="ftrend__head">
                <div>
                  <span class="label">Marktindex</span>
                  <div class="tiny muted">indexpunten, geen dollars — toont de richting</div>
                </div>
                <span class="spacer"></span>
                <div class="ftrend__seg">
                  @for (option of trendOptions(); track option.code) {
                    <button type="button" [class.on]="trendCode() === option.code"
                            (click)="trendCode.set(option.code)">{{ option.label }}</button>
                  }
                </div>
              </div>
              @if (latestFor(trendCode()); as latest) {
                <div class="ftrend__now">
                  <span class="num">{{ latest.usdPerContainer | num: 0 }}</span>
                  <span class="tiny muted">{{ trendUnit() }} · {{ shortDate(latest.quotedOn) }}</span>
                  @if (indexChange(trendCode()); as change) {
                    <span class="badge" [class]="change <= 0 ? 'badge--ok' : 'badge--warn'">
                      {{ change > 0 ? '+' : '' }}{{ change | num: 1 }}%
                    </span>
                  }
                </div>
              }
              @if (trendSeries(); as trend) {
                <app-sparkline class="fx-chart" [values]="trend.values"
                               [width]="320" [height]="42" />
                <div class="fx-months">
                  @for (tick of trendTicks(trend.dates, trend.values); track tick.pct) {
                    <span [style.left.%]="tick.pct">{{ tick.label }}
                      <em>{{ tick.value | num: 0 }}</em></span>
                  }
                </div>
                @if (rateHorizons(trendCode()).length) {
                  <div class="hgrid">
                    @for (h of rateHorizons(trendCode()); track h.label) {
                      <div class="hgrid__cell">
                        <span class="hgrid__label">{{ h.label }}</span>
                        @if (h.pct !== null) {
                          <span class="hgrid__value"
                                [class.hgrid__value--good]="h.pct <= 0"
                                [class.hgrid__value--bad]="h.pct > 0">
                            {{ h.pct > 0 ? '↑' : '↓' }}{{ (h.pct < 0 ? -h.pct : h.pct) | num: 1 }}%
                          </span>
                          <span class="hgrid__word">{{ h.pct > 0 ? 'duurder' : 'goedkoper' }}</span>
                        } @else {
                          <span class="hgrid__value muted">—</span>
                          <span class="hgrid__word">nog geen data</span>
                        }
                      </div>
                    }
                  </div>
                }
                <p class="tiny muted ftrend__note">
                  {{ trendLabel() }} ·
                  <button class="linklike" type="button"
                          (click)="openHistory(trendCode(), trendLabel(), '')">alle noteringen</button>
                </p>
              }
            </div>
          }

          <div class="fown">
            <div class="fown__head">
              <span class="label">Jouw offertes</span>
              <span class="spacer"></span>
              <button class="btn btn--sm" type="button" (click)="openRateSheet()">+ Tarief</button>
            </div>
            <div class="ftiles ftiles--3">
              @for (route of ownRoutes; track route.code) {
                <button class="ftile ftile--btn" type="button"
                        [attr.aria-label]="freightRouteAriaLabel(route)"
                        (click)="openFreightRoute(route)">
                  <span class="ftile__label">{{ route.short }}</span>
                  @if (latestFor(route.code); as latest) {
                    <span class="ftile__value ftile__value--sm num">{{ '$' + (latest.usdPerContainer | num: 0) }}</span>
                    <span class="ftile__sub">{{ shortDate(latest.quotedOn) }}
                      @if (indexChange(route.code); as change) {
                        <b [class.ok-text]="change <= 0" [class.warn-text]="change > 0">
                          {{ change > 0 ? '+' : '' }}{{ change | num: 0 }}%</b>
                      }
                    </span>
                  } @else {
                    <span class="ftile__value ftile__value--add">+</span>
                    <span class="ftile__sub">noteren</span>
                  }
                </button>
              }
            </div>
          </div>

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

          @if (historyFor(newRoute()).length) {
            <div class="recent-rates">
              <div class="recent-rates__head">
                <span class="label">Eerdere offertes</span>
                <span class="spacer"></span>
                <button class="linklike" type="button"
                        (click)="rateSheet.set(false); openHistory(newRoute(), routeTitle(newRoute()), 'USD ')">
                  trend &amp; alles
                </button>
              </div>
              @for (rate of historyFor(newRoute()).slice(0, 4); track rate.id) {
                <div class="recent-rates__row">
                  <span class="num">$ {{ rate.usdPerContainer | num: 0 }}</span>
                  <span class="tiny muted">{{ shortDate(rate.quotedOn) }}</span>
                  <span class="spacer"></span>
                  <button class="pallet__tool" type="button" aria-label="Verwijderen"
                          (click)="deleteRate(rate)">✕</button>
                </div>
              }
            </div>
          }
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
          @if (sourceFor(history.code); as source) {
            <div class="market-source-note" role="note">
              <div>
                <strong>{{ source.metric === 'INDEX_POINTS' ? 'Marktindex, geen prijs' : 'USD-marktbenchmark' }}</strong>
                <span>{{ source.scope }}</span>
              </div>
              <div class="source-meta">
                <span>{{ source.sourceName }}</span>
                @if (source.latestPublishedOn) { <span>Publicatie {{ source.latestPublishedOn }}</span> }
                @if (source.lastCheckedAt) { <span>Gecontroleerd {{ checkedOn(source.lastCheckedAt) }}</span> }
                <a [href]="source.sourceUrl" target="_blank" rel="noopener noreferrer"
                   [attr.aria-label]="'Open bron ' + source.sourceName">Bron</a>
              </div>
              @if (showSourceDetail(source)) {
                <div class="source-detail">{{ sourceGuidance(source) }}</div>
              }
            </div>
          }
          <div class="freight-analysis-card freight-analysis-card--sheet">
            <div class="freight-chart-panel" role="img"
                 [attr.aria-label]="chartAriaLabel(history.code, history.label)">
              <div class="freight-chart-panel__head">
                <strong>Verloop</strong>
                <span>{{ observationLabel(history.code) }}</span>
              </div>
              @if (seriesFor(history.code).length > 1) {
                <app-sparkline class="freight-chart"
                               [values]="seriesFor(history.code)" [width]="640" [height]="96" />
                <div class="freight-chart-axis">
                  <span>{{ firstDateLabel(history.code) }}</span>
                  <span>{{ latestDateLabel(history.code) }}</span>
                </div>
              } @else {
                <div class="freight-chart-empty">
                  <span class="freight-chart-empty__line"></span>
                  <span>Nog te weinig data voor een verloop</span>
                </div>
              }
            </div>
            <div class="freight-horizons" aria-label="Verschil per periode">
              @for (h of rateHorizons(history.code); track h.label) {
                <div class="freight-horizon">
                  <span class="freight-horizon__label">{{ h.label }}</span>
                  @if (h.pct !== null) {
                    <strong [class.freight-horizon__good]="h.pct <= 0"
                            [class.freight-horizon__bad]="h.pct > 0">
                      {{ h.pct > 0 ? '↑' : '↓' }}{{ (h.pct < 0 ? -h.pct : h.pct) | num: 1 }}%
                    </strong>
                    <span>{{ horizonWord(history.code, h.pct) }}</span>
                    <span class="freight-horizon__baseline">
                      vs {{ horizonBaselineLabel(h) }}
                    </span>
                  } @else {
                    <strong class="freight-horizon__missing">—</strong>
                    <span>Nog te weinig data</span>
                  }
                </div>
              }
            </div>
            <div class="freight-analysis-copy" aria-label="Analyse">
              <strong>Analyse</strong>
              @for (line of freightAnalysisLines(history.code); track line) {
                <p>{{ line }}</p>
              }
            </div>
            <p class="tiny muted freight-history-note">{{ horizonNote(history.code) }}</p>
          </div>
          @for (rate of historyFor(history.code); track rate.id) {
            <div class="market-row">
              <div>
                <div class="market-row__value num" style="font-size:15px">
                  {{ history.unit }}{{ rate.usdPerContainer | num: history.unit ? 0 : 1 }}
                  @if (!history.unit) { <span class="tiny muted">ptn</span> }
                </div>
                <div class="tiny muted">{{ rate.quotedOn }}</div>
              </div>
              @if (!sourceFor(history.code)) {
                <button class="pallet__tool" type="button" aria-label="Verwijderen"
                        (click)="deleteRate(rate)">✕</button>
              }
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
  /** The two dollar benchmarks - prices you can put next to a quote. */
  readonly dollarBenchmarks = [
    { code: 'WCI SHA-RTM', label: 'Shanghai → Rotterdam', source: 'Drewry',
      title: 'Shanghai → Rotterdam · Drewry WCI · USD per 40ft' },
    { code: 'FBX11 CN-NEUR', label: 'China → N-Europa', source: 'Freightos',
      title: 'China → Noord-Europa · Freightos FBX11 · USD per 40ft' },
  ];

  /** Series that can carry the trend chart, in order of preference. */
  private readonly trendCandidates = [
    { code: 'NCFI NINGBO', label: 'NCFI Ningbo', usd: false,
      title: 'NCFI composiet · vertrek Ningbo · indexpunten' },
    { code: 'CCFI CN-EUR', label: 'CCFI China', usd: false,
      title: 'CCFI Europa-route · indexpunten' },
    { code: 'WCI SHA-RTM', label: 'Drewry $', usd: true,
      title: 'Shanghai → Rotterdam · Drewry WCI · USD per 40ft' },
    { code: 'FBX11 CN-NEUR', label: 'FBX11 $', usd: true,
      title: 'China → Noord-Europa · Freightos FBX11 · USD per 40ft' },
  ];
  readonly trendOptions = computed(() =>
    this.trendCandidates.filter((option) => this.seriesFor(option.code).length > 1));
  readonly trendCode = signal('NCFI NINGBO');
  readonly trendLabel = computed(() =>
    this.trendCandidates.find((option) => option.code === this.trendCode())?.title ?? '');
  readonly trendUnit = computed(() =>
    this.trendCandidates.find((option) => option.code === this.trendCode())?.usd ? 'USD per 40ft' : 'indexpunten');
  /** Dated, oldest first - the chart and its month marks need both. */
  readonly trendSeries = computed(() => {
    const code = this.trendOptions().some((option) => option.code === this.trendCode())
        ? this.trendCode() : this.trendOptions()[0]?.code;
    if (!code) return null;
    const entries = this.freightRates()
        .filter((rate) => rate.route === code)
        .slice().sort((a, b) => a.quotedOn.localeCompare(b.quotedOn));
    return { dates: entries.map((e) => e.quotedOn), values: entries.map((e) => e.usdPerContainer) };
  });

  /** Our own lanes; quotes come from forwarders, typed in by hand. */
  readonly ownRoutes = [
    { code: 'NINGBO', label: 'Ningbo', short: 'Ningbo' },
    { code: 'GUANGZHOU', label: 'Nansha (Guangzhou)', short: 'Nansha' },
    { code: 'SHENZHEN', label: 'Yantian (Shenzhen)', short: 'Yantian' },
  ];
  readonly freightRates = signal<FreightRate[]>([]);
  readonly marketSources = signal<MarketSourceStatus[]>([]);
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
   * to its target date. The acceptance window grows with the horizon: one
   * month stays tight enough that a 9–14 day-old point can never pretend to
   * be a month. Horizons without a representative point still render as
   * explicitly unavailable; nothing is interpolated or invented.
   */
  rateHorizons(code: string): FreightHorizon[] {
    const horizons = [
      { label: '1 mnd', days: 30, toleranceDays: 8 },
      { label: '3 mnd', days: 91, toleranceDays: 14 },
      { label: '6 mnd', days: 182, toleranceDays: 21 },
      { label: '12 mnd', days: 365, toleranceDays: 28 },
    ];
    const entries = this.ratesFor(code);
    if (entries.length < 2) {
      return horizons.map(({ label }) => ({
        label, pct: null, comparedOn: null, actualDays: null,
      }));
    }
    const latest = entries.at(-1)!;
    const latestDate = new Date(latest.quotedOn).getTime();
    const day = 24 * 3600 * 1000;

    const result: FreightHorizon[] = [];
    for (const horizon of horizons) {
      const target = latestDate - horizon.days * day;
      let best: { distance: number; value: number; quotedOn: string; actualDays: number } | null = null;
      for (const entry of entries.slice(0, -1)) {
        const entryDate = new Date(entry.quotedOn).getTime();
        const distance = Math.abs(entryDate - target);
        if (!best || distance < best.distance) {
          best = {
            distance,
            value: entry.usdPerContainer,
            quotedOn: entry.quotedOn,
            actualDays: Math.round((latestDate - entryDate) / day),
          };
        }
      }
      if (!best || best.distance > horizon.toleranceDays * day) {
        result.push({
          label: horizon.label, pct: null, comparedOn: null, actualDays: null,
        });
        continue;
      }
      result.push({
        label: horizon.label,
        pct: ((latest.usdPerContainer - best.value) / best.value) * 100,
        comparedOn: best.quotedOn,
        actualDays: best.actualDays,
      });
    }
    return result;
  }

  horizonNote(code: string): string {
    const entries = this.ratesFor(code);
    const missing = this.rateHorizons(code).filter((horizon) => horizon.pct === null).length;
    const base = `Werkelijke vergelijkingsdatum staat per periode · ${entries.length} noteringen`;
    return missing > 0 ? `${base} · langere periodes volgen zodra er historiek is` : base;
  }

  openHistory(code: string, label: string, unit: string): void {
    this.historyRoute.set({ code, label, unit });
  }

  openRateSheet(route?: string): void {
    if (route) this.newRoute.set(route);
    this.rateSheet.set(true);
  }

  /* A tile with quotes opens the trend and full history; an empty one
     opens the note sheet. Adding a quote always goes through + Tarief. */
  openFreightRoute(route: { code: string; label: string }): void {
    if (this.latestFor(route.code)) {
      this.openHistory(route.code, this.routeTitle(route.code), 'USD ');
      return;
    }
    this.openRateSheet(route.code);
  }

  freightRouteAriaLabel(route: { code: string; label: string }): string {
    const action = this.latestFor(route.code) ? 'Trend en historiek bekijken' : 'Tarief noteren';
    return `${action} voor ${route.label} naar Rotterdam, USD per 40ft-container`;
  }

  /** Newest first: the question is what it costs now and how it got there. */
  historyFor(code: string): FreightRate[] {
    return this.ratesFor(code).reverse();
  }

  async deleteRate(rate: FreightRate): Promise<void> {
    if (rate.id == null) return;
    await this.sourcing.deleteFreightRate(rate.id);
    this.freightRates.set(await this.sourcing.freightRates());
  }

  readonly wciSeries = computed(() => this.freightRates()
      .filter((rate) => rate.route === 'WCI SHA-RTM')
      .map((rate) => rate.usdPerContainer));

  seriesFor(route: string): number[] {
    return this.ratesFor(route).map((rate) => rate.usdPerContainer);
  }

  /** Week-over-week change of an index, when two entries exist. */
  indexChange(route: string): number | null {
    const series = this.seriesFor(route);
    if (series.length < 2) return null;
    const previous = series[series.length - 2];
    return ((series[series.length - 1] - previous) / previous) * 100;
  }

  previousComparisonLabel(code: string): string {
    const entries = this.ratesFor(code);
    if (entries.length < 2) return 'vs vorige notering';
    const latest = new Date(entries.at(-1)!.quotedOn).getTime();
    const previous = new Date(entries.at(-2)!.quotedOn).getTime();
    const days = Math.round((latest - previous) / (24 * 3600 * 1000));
    return days >= 5 && days <= 10 ? 'vs vorige week' : 'vs vorige notering';
  }

  sourceFor(code: string): MarketSourceStatus | null {
    return this.marketSources().find((source) => source.code === code) ?? null;
  }

  sourceStateLabel(state: MarketSourceStatus['state']): string {
    if (state === 'CURRENT') return 'Actueel';
    if (state === 'CACHE_AFTER_FAILURE') return 'Cache';
    if (state === 'STALE') return 'Verouderd';
    if (state === 'DISABLED') return 'Uitgeschakeld';
    if (state === 'PROVIDER_ACCESS_REQUIRED') return 'Provider-toegang nodig';
    if (state === 'CACHE_AFTER_ACCESS_BLOCK') return 'Cache · toegang nodig';
    if (state === 'FAILED') return 'Bronfout';
    return 'Geen data';
  }

  sourceStateClass(state: MarketSourceStatus['state']): string {
    if (state === 'CURRENT') return 'source-state--ok';
    if (state === 'DISABLED' || state === 'NO_DATA') return 'source-state--neutral';
    return 'source-state--warn';
  }

  checkedOn(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('nl-BE', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(date);
  }

  indexTrend(code: string): string {
    const change = this.indexChange(code);
    const source = this.sourceFor(code);
    const subject = source?.metric === 'INDEX_POINTS'
      ? 'Index'
      : source ? 'Benchmark' : 'Eigen tarief';
    if (change === null) return `Nog geen tweede publicatie voor een trend.`;
    if (change <= -3) return `${subject} daalt duidelijk; vraag een scherpere nieuwe offerte.`;
    if (change < -0.5) return `${subject} daalt licht sinds de vorige notering.`;
    if (change < 0.5) return `${subject} bleef vrijwel gelijk.`;
    if (change < 3) return `${subject} stijgt licht sinds de vorige notering.`;
    return `${subject} stijgt duidelijk; controleer hoe je forwarder dit doorrekent.`;
  }

  /** Short, actionable analysis that stays next to the chart. */
  freightAnalysisLines(code: string): string[] {
    const entries = this.ratesFor(code);
    if (!entries.length) {
      return ['Nog geen meetpunt. Na de eerste synchronisatie verschijnt hier de marktanalyse.'];
    }
    if (entries.length === 1) {
      return [`Eerste meetpunt op ${this.shortDate(entries[0].quotedOn)}. Een tweede week is nodig om de richting te bepalen.`];
    }

    const lines = [this.indexTrend(code)];
    const longest = this.rateHorizons(code).slice().reverse()
        .find((horizon) => horizon.pct !== null);
    if (longest?.pct !== null && longest?.pct !== undefined) {
      const metric = this.sourceFor(code)?.metric === 'INDEX_POINTS' ? 'index' : 'benchmark';
      lines.push(`Over ${longest.label} staat de ${metric} ${Math.abs(longest.pct).toLocaleString('nl-BE', {
        minimumFractionDigits: 1, maximumFractionDigits: 1,
      })}% ${longest.pct > 0 ? 'hoger' : 'lager'} dan op ` +
          `${this.shortDate(longest.comparedOn!)} (${longest.actualDays} dagen).`);
    } else {
      lines.push('De langere vergelijking volgt zodra er voldoende wekelijkse historiek is.');
    }
    return lines;
  }

  /** Provider state only deserves extra space when the feed needs attention. */
  showSourceDetail(source: MarketSourceStatus): boolean {
    return source.state === 'FAILED' || source.state === 'STALE' ||
        source.state === 'CACHE_AFTER_FAILURE' ||
        source.state === 'PROVIDER_ACCESS_REQUIRED' ||
        source.state === 'CACHE_AFTER_ACCESS_BLOCK';
  }

  sourceGuidance(source: MarketSourceStatus): string {
    if (source.state === 'PROVIDER_ACCESS_REQUIRED') {
      return 'De provider blokkeert de automatische bronoproep. Koppel de toegestane feed, ' +
          'credentials of IP-allowlist; er is nog geen geldige cache.';
    }
    if (source.state === 'CACHE_AFTER_ACCESS_BLOCK') {
      return 'De provider blokkeert de nieuwe bronoproep. De laatst geldige cache blijft ' +
          'zichtbaar; controleer de feed, credentials of IP-allowlist.';
    }
    return source.detail;
  }

  horizonBaselineLabel(horizon: FreightHorizon): string {
    if (!horizon.comparedOn || horizon.actualDays === null) return '';
    return `${this.shortDate(horizon.comparedOn)} · ${horizon.actualDays} d`;
  }

  observationLabel(code: string): string {
    const count = this.ratesFor(code).length;
    return `${count} ${count === 1 ? 'meetpunt' : 'meetpunten'}`;
  }

  firstDateLabel(code: string): string {
    const first = this.ratesFor(code)[0];
    return first ? this.shortDate(first.quotedOn) : '';
  }

  latestDateLabel(code: string): string {
    const latest = this.ratesFor(code).at(-1);
    return latest ? this.shortDate(latest.quotedOn) : '';
  }

  chartAriaLabel(code: string, label: string): string {
    const entries = this.ratesFor(code);
    if (entries.length < 2) return `${label}: nog te weinig data voor een verloopgrafiek`;
    return `${label}: verloop van ${this.shortDate(entries[0].quotedOn)} tot ` +
        `${this.shortDate(entries.at(-1)!.quotedOn)}, ${entries.length} meetpunten`;
  }

  /** Month marks for an uneven weekly series: crowded ones are dropped. */
  trendTicks(dates: string[], values: number[]): { pct: number; label: string; value: number }[] {
    const all = this.monthTicks(dates, values, false);
    const kept: { pct: number; label: string; value: number }[] = [];
    for (const tick of all) {
      if (!kept.length || tick.pct - kept[kept.length - 1].pct >= 14) kept.push(tick);
    }
    return kept;
  }

  routeTitle(code: string): string {
    const route = this.ownRoutes.find((candidate) => candidate.code === code);
    return route ? `${route.label} → Rotterdam · USD per 40ft` : code;
  }

  shortDate(value: string): string {
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat('nl-BE', {
      day: 'numeric', month: 'short', year: '2-digit',
    }).format(date);
  }

  private ratesFor(code: string): FreightRate[] {
    return this.freightRates()
        .filter((rate) => rate.route === code)
        .slice()
        .sort((a, b) => a.quotedOn.localeCompare(b.quotedOn));
  }

  horizonWord(code: string, pct: number): string {
    if (this.sourceFor(code)?.metric === 'INDEX_POINTS') {
      return pct > 0 ? 'hoger' : 'lager';
    }
    return pct > 0 ? 'duurder' : 'goedkoper';
  }

  latestFor(route: string): FreightRate | null {
    return this.ratesFor(route).at(-1) ?? null;
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
      label: string; months: 1 | 3 | 6 | 12; pct: number | null; cny: number | null;
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
    const latestCny = rates.cny[latestIndex];
    /* We pay in euro but the EXW price is agreed in dollar OR yuan, so
       every horizon answers the question for both currencies. */
    const cheaper = (baseline: number | null, latest: number) =>
        baseline !== null && Number.isFinite(baseline) && baseline > 0
          && Number.isFinite(latest) && latest > 0
          ? (1 - baseline / latest) * 100 : null;
    const contexts = definitions.map((definition) => {
      const index = this.baselineIndex(rates, definition.months);
      /* Positive means that one dollar (or yuan) costs fewer euros now. */
      const usd = cheaper(index === null ? null : rates.usd[index], latestUsd);
      const cny = cheaper(index === null ? null : rates.cny[index], latestCny);
      /* One number: the euro's average buying power over our two purchase
         currencies - half the containers are priced in dollar, half in
         yuan, so a plain mean is the honest summary. */
      const pct = usd === null ? null : cny === null ? usd : (usd + cny) / 2;
      return { ...definition, index, pct, usd, cny };
    });
    const horizons = contexts.map(({ label, months, pct, cny }) => ({ label, months, pct, cny }));
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
    const baselineCny = rates.cny[baselineIndex];
    const usdCheaperPct = selected.usd!;
    const cnyCheaperPct = selected.cny;
    const powerPct = selected.pct;
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
    const abs = (value: number) => nl(Math.abs(value));
    const gain = (value: number) => value >= 0 ? 'won' : 'verloor';

    /* Why: which currency carried the move, and what that means for the
       two kinds of suppliers. */
    if (cnyCheaperPct === null) {
      lines.push(`Waarom: de euro ${gain(usdCheaperPct)} ${abs(usdCheaperPct)}% tegenover ` +
          `de dollar sinds ${baselineDate}.`);
    } else if (usdCheaperPct >= 0 && cnyCheaperPct >= 0 || usdCheaperPct < 0 && cnyCheaperPct < 0) {
      const better = powerPct >= 0;
      let tail: string;
      if (Math.abs(usdCheaperPct - cnyCheaperPct) < 0.5) {
        tail = ' — beide munten bewogen gelijk op.';
      } else if (Math.abs(usdCheaperPct) > Math.abs(cnyCheaperPct)) {
        tail = better
            ? ' — de winst zit vooral bij de dollar; de yuan verstevigde tegen de dollar ' +
              'en yuan-leveranciers profiteerden minder.'
            : ' — het verlies zit vooral bij de dollar; yuan-leveranciers bleven relatief ' +
              'goedkoper.';
      } else {
        tail = better
            ? ' — de winst zit vooral bij de yuan, die verzwakte tegen de dollar.'
            : ' — het verlies zit vooral bij de yuan, die verstevigde tegen de dollar.';
      }
      lines.push((better
          ? `Waarom nu beter: de euro won ${abs(usdCheaperPct)}% tegenover de dollar en ` +
            `${abs(cnyCheaperPct)}% tegenover de yuan sinds ${baselineDate}`
          : `Waarom toen beter: de euro stond ${abs(usdCheaperPct)}% sterker tegenover de ` +
            `dollar en ${abs(cnyCheaperPct)}% tegenover de yuan op ${baselineDate}`) + tail);
    } else {
      lines.push(usdCheaperPct >= 0
          ? `Gemengd beeld: de euro won ${abs(usdCheaperPct)}% op de dollar maar verloor ` +
            `${abs(cnyCheaperPct)}% op de yuan sinds ${baselineDate} — dollarleveranciers ` +
            `werden goedkoper, yuan-leveranciers duurder.`
          : `Gemengd beeld: de euro verloor ${abs(usdCheaperPct)}% op de dollar maar won ` +
            `${abs(cnyCheaperPct)}% op de yuan sinds ${baselineDate} — yuan-leveranciers ` +
            `werden goedkoper, dollarleveranciers duurder.`);
    }

    if (rangePos >= 0.85) {
      lines.push(`De euro staat nu dicht bij zijn sterkste punt van de afgelopen ${rangePeriod} ` +
          `tegenover de dollar — de winst zit er grotendeels al in.`);
    } else if (rangePos <= 0.15) {
      lines.push(`De euro staat nu dicht bij zijn zwakste punt van de afgelopen ${rangePeriod} ` +
          `tegenover de dollar.`);
    }

    /* What it means in money, per currency. */
    const eurPerTenKUsd = 10000 / baselineUsd - 10000 / latestUsd;
    const usdMoney = Math.round(Math.abs(eurPerTenKUsd));
    let money = usdMoney < 1
        ? `Per $10.000 aan inkoop: minder dan € 1 verschil`
        : `Per $10.000 aan inkoop: ongeveer € ${usdMoney.toLocaleString('nl-BE')} ` +
          `${eurPerTenKUsd > 0 ? 'minder' : 'meer'}`;
    if (cnyCheaperPct !== null && Number.isFinite(baselineCny) && baselineCny > 0) {
      const eurPerTenKCny = 10000 / baselineCny - 10000 / latestCny;
      const cnyMoney = Math.round(Math.abs(eurPerTenKCny));
      if (cnyMoney >= 1) {
        money += `; per ¥10.000: ongeveer € ${cnyMoney.toLocaleString('nl-BE')} ` +
            `${eurPerTenKCny > 0 ? 'minder' : 'meer'}`;
      }
    }
    lines.push(money + ` dan op ${baselineDate}.`);

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
    if (powerPct >= 0.5) {
      verdict = 'Sterker dan toen';
      tone = 'ok';
      lead = `Jullie koopkracht is ${nl(powerPct)}% sterker dan op ${baselineDate}` +
          ` (gemiddeld over dollar en yuan).`;
    } else if (powerPct <= -0.5) {
      verdict = 'Zwakker dan toen';
      tone = 'warn';
      lead = `Jullie koopkracht is ${nl(Math.abs(powerPct))}% zwakker dan op ${baselineDate}` +
          ` (gemiddeld over dollar en yuan).`;
    } else {
      verdict = 'Vrijwel gelijk';
      tone = 'neutral';
      lead = `Jullie koopkracht ligt op het niveau van ${baselineDate} (gemiddeld over dollar en yuan).`;
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
  readonly skuCount = signal(0);
  readonly catalogAttention = signal(0);
  readonly loading = signal(true);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    /* Market data loads independently: a slow external feed must never
       hold up the work overview. */
    void this.fx.load();
    void this.loadFreightMarket();

    const [orders, purchases, revisions, products, families] = await Promise.all([
      this.sales.orders(), this.sourcing.purchaseOrders(),
      this.sales.pendingRevisions(), this.catalog.products(),
      this.catalog.productFamilies().catch(() => []),
    ]);
    this.salesOrders.set(orders);
    this.purchases.set(purchases.slice(0, 5));
    this.revisions.set(revisions);
    this.productCount.set(families.length || products.length);
    this.skuCount.set(products.length);
    this.catalogAttention.set(families.length
      ? families.filter((family) => family.active && family.publicationIssues.length > 0).length
      : products.filter((product) =>
        product.active && (product.publicationIssues?.length ?? 0) > 0).length);
    this.loading.set(false);
  }

  private async loadFreightMarket(): Promise<void> {
    try {
      /* Own quotes and existing cache render immediately. The slower licensed
         provider checks then refresh statuses and observations in place. */
      this.freightRates.set(await this.sourcing.freightRates());
      this.marketSources.set(await this.sourcing.marketSourceStatuses());
      this.freightRates.set(await this.sourcing.freightRates());
    } catch {
      /* Market context is advisory and must never block the work dashboard. */
    }
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
