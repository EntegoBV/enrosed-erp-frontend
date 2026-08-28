import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Skeleton } from '../../shared/skeleton';
import { Sparkline } from '../../shared/sparkline';
import { AuthImage } from '../../core/api/auth-image';
import { PlannerCards } from './planner-cards';
import { PlannerStore } from '../../core/api/planner-api';
import { Icon } from '../../shared/icon';
import { Sheet } from '../../shared/ui';
import { FormsModule } from '@angular/forms';
import { Fx, FxSeries } from '../../core/api/fx';
import { RouterLink } from '@angular/router';
import { SalesApi } from '../../core/api/sales-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { CatalogApi } from '../../core/api/catalog-api';
import { FreightRate, MarketSourceStatus, PurchaseOrderView, QuoteRevision, SalesOrderView, ExpectedStock, Product, Supplier } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { EurPipe, NumPipe, DateNlPipe } from '../../shared/pipes';
import { STATUS_LABEL, isWebsiteQuoteRequest, statusClass } from '../sales/quote-status';
import { containerLabel } from '../../core/api/geo';
import { messageOf } from '../../core/api/errors';

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
            EurPipe, NumPipe, DateNlPipe, PlannerCards, AuthImage],
  template: `
    <app-page-header [title]="greeting()" [subtitle]="today()">
    </app-page-header>

    <div class="content dashboard-page anim-stagger">
      @if (loading()) {
        <section class="dashboard-loading" aria-live="polite" aria-label="Dashboard laden">
          <app-skeleton kind="stats" [rows]="4" />
          <app-skeleton kind="card" [rows]="3" />
        </section>
      } @else {
        @for (pin of pinnedItems(); track pin.id) {
          <div class="pin-line">
            <span class="pin-line__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M12 16.5V21M8.5 4h7l-.9 6.3 3.4 3.2H6l3.4-3.2L8.5 4z"/></svg>
            </span>
            <span class="pin-line__what">
              <b>{{ pin.title }}</b>
              <small>@if (pin.onDate) { {{ pin.onDate | dateNl }}@if (pin.atTime) { · {{ pin.atTime }} } }
                @if (pin.note) { · {{ pin.note }} }</small>
            </span>
          </div>
        }

        @if (dataWarnings().length) {
          <section class="dashboard-sync-warning" role="alert">
            <span class="dashboard-sync-warning__icon" aria-hidden="true">!</span>
            <div>
              <strong>Niet alle cijfers konden worden bijgewerkt</strong>
              <p>{{ warningLabel() }}. {{ warningDetail() || 'Controleer de verbinding en probeer opnieuw.' }}
                De overige gegevens blijven beschikbaar.</p>
            </div>
            <button class="btn btn--sm" type="button" [disabled]="refreshing()" (click)="load()">
              {{ refreshing() ? 'Bezig…' : 'Opnieuw proberen' }}
            </button>
          </section>
        }

        <div class="dashboard-command-grid">
          <section class="card dashboard-work" aria-labelledby="dashboard-work-title">
            <header class="dashboard-card-head">
              <div>
                <span class="dashboard-eyebrow">Dagstart</span>
                <h2 id="dashboard-work-title">{{ dailyHeadline() }}</h2>
                <p>{{ dailySubline() }}</p>
              </div>
              @if (dailyActionCount()) {
                <span class="dashboard-total" aria-label="Aantal open aandachtspunten">
                  {{ dailyActionCount() }}
                </span>
              } @else {
                <span class="dashboard-done" aria-label="Geen open aandachtspunten">✓</span>
              }
            </header>

            <div class="dashboard-work-list">
              @for (row of websiteRequests().slice(0, 3); track row.order.id) {
                <a class="dashboard-work-row dashboard-work-row--primary"
                   [routerLink]="['/sales', row.order.id]">
                  <span class="dashboard-work-row__icon"><app-icon name="sales" [size]="18" /></span>
                  <span class="dashboard-work-row__body">
                    <strong>Nieuwe websiteaanvraag</strong>
                    <small>{{ row.order.number }} · {{ row.priced.totals.pieces | num }} st · {{ row.order.orderDate | dateNl }}</small>
                  </span>
                  <span class="dashboard-work-row__value num">{{ row.priced.totals.total | eur: 0 }}</span>
                  <span class="dashboard-work-row__arrow" aria-hidden="true">›</span>
                </a>
              }
              @if (websiteRequests().length > 3) {
                <a class="dashboard-more-row" routerLink="/sales">
                  Nog {{ websiteRequests().length - 3 }}
                  {{ websiteRequests().length - 3 === 1 ? 'websiteaanvraag' : 'websiteaanvragen' }} bekijken <span>›</span>
                </a>
              }

              @if (revisions().length) {
                <a class="dashboard-work-row dashboard-work-row--warn" routerLink="/revisions">
                  <span class="dashboard-work-row__icon"><app-icon name="exchange" [size]="18" /></span>
                  <span class="dashboard-work-row__body">
                    <strong>{{ revisions().length }}
                      {{ revisions().length === 1 ? 'offertewijziging' : 'offertewijzigingen' }} beoordelen</strong>
                    <small>De klant wacht op een antwoord of aangepaste versie.</small>
                  </span>
                  <span class="dashboard-work-row__arrow" aria-hidden="true">›</span>
                </a>
              }

              @for (row of visibleActions(); track row.order.id) {
                <a class="dashboard-work-row" [routerLink]="['/purchasing', row.order.id]">
                  <span class="dashboard-work-row__icon"><app-icon name="purchase" [size]="18" /></span>
                  <span class="dashboard-work-row__body">
                    <strong>{{ row.order.alias || row.order.number }}</strong>
                    <small>{{ row.attention![0] }}@if (row.attention!.length > 1) { · nog {{ row.attention!.length - 1 }}
                      {{ row.attention!.length - 1 === 1 ? 'punt' : 'punten' }} }</small>
                  </span>
                  <span class="dashboard-work-row__arrow" aria-hidden="true">›</span>
                </a>
              }
              @if (hiddenActionCount() > 0) {
                <button class="dashboard-more-row" type="button" (click)="actionsOpen.set(true)">
                  Nog {{ hiddenActionCount() }}
                  {{ hiddenActionCount() === 1 ? 'inkooporder' : 'inkooporders' }} tonen <span>⌄</span>
                </button>
              }

              @if (zeroStockCount()) {
                <a class="dashboard-work-row" routerLink="/stock">
                  <span class="dashboard-work-row__icon"><app-icon name="stock" [size]="18" /></span>
                  <span class="dashboard-work-row__body">
                    <strong>{{ zeroStockCount() }}
                      {{ zeroStockCount() === 1 ? 'actief artikel' : 'actieve artikelen' }} op nul</strong>
                    <small>Controleer of voorraad, inkoop of beschikbaarheid moet worden aangepast.</small>
                  </span>
                  <span class="dashboard-work-row__arrow" aria-hidden="true">›</span>
                </a>
              }

              @if (catalogAttention()) {
                <a class="dashboard-work-row" routerLink="/website/products">
                  <span class="dashboard-work-row__icon"><app-icon name="products" [size]="18" /></span>
                  <span class="dashboard-work-row__body">
                    <strong>{{ catalogAttention() }}
                      {{ catalogAttention() === 1 ? 'productfamilie is' : 'productfamilies zijn' }} niet publicatieklaar</strong>
                    <small>Ontbrekende productdata of website-inhoud staat in de werklijst.</small>
                  </span>
                  <span class="dashboard-work-row__arrow" aria-hidden="true">›</span>
                </a>
              }

              @if (!dailyActionCount() && dataWarnings().length) {
                <div class="dashboard-work-empty dashboard-work-empty--unknown">
                  <span aria-hidden="true">!</span>
                  <div>
                    <strong>Nog geen betrouwbare all-clear</strong>
                    <p>Een deel van het open werk kon niet worden gecontroleerd. Probeer de ontbrekende cijfers opnieuw te laden.</p>
                  </div>
                </div>
              } @else if (!dailyActionCount()) {
                <div class="dashboard-work-empty">
                  <span aria-hidden="true">✓</span>
                  <div>
                    <strong>Alles voor nu bijgewerkt</strong>
                    <p>Geen nieuwe websiteaanvragen, klantwijzigingen of operationele blokkades.</p>
                  </div>
                  <a class="btn btn--sm" routerLink="/sales">Verkoop bekijken</a>
                </div>
              }
            </div>
          </section>

          <section class="dashboard-snapshot" aria-labelledby="dashboard-snapshot-title">
            <div class="dashboard-section-copy">
              <span class="dashboard-eyebrow">Bedrijfsfoto</span>
              <h2 id="dashboard-snapshot-title">Verkoop, marge en voorraad</h2>
              <p>Tik op een cijfer voor de onderliggende orders en producten.</p>
            </div>
            <div class="kpis dashboard-kpis">
              <button class="kpi kpi--dark" type="button" (click)="kpiSheet.set('SALES')">
                <svg class="kpi__rose" viewBox="0 0 24 24" fill="none" stroke="#e8b7c0"
                     stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="8" r="3.2" />
                  <path d="M12 11.2V20" />
                  <path d="M12 16.5c-2.6 0-4.5-1.3-4.8-3.4 2.6 0 4.4 1.2 4.8 3.4z" />
                  <path d="M12 16.5c2.6 0 4.5-1.3 4.8-3.4-2.6 0-4.4 1.2-4.8 3.4z" />
                  <path d="M12 8m-1.4 0a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0-2.8 0" />
                </svg>
                <div class="kpi__label">Open offertes</div>
                <div class="kpi__value">{{ openValue() | eur: 0 }}</div>
                <div class="kpi__meta">{{ openOrders().length }} bij klanten of in concept</div>
              </button>
              <button class="kpi" type="button" (click)="kpiSheet.set('MARGIN')">
                <div class="kpi__label">Brutomarge offertes</div>
                <div class="kpi__value">{{ marginEur() | eur: 0 }}</div>
                <div class="kpi__meta">{{ marginPct() | num: 1 }}% op goederen</div>
              </button>
              <button class="kpi" type="button" (click)="kpiSheet.set('PURCHASE')">
                <div class="kpi__label">Inkoop onderweg</div>
                <div class="kpi__value">{{ incomingValue() | eur: 0 }}</div>
                <div class="kpi__meta">{{ incomingLabel() }}</div>
                @if (incomingPieces()) {
                  <div class="kpi__meta kpi__meta--expected">+{{ incomingPieces() | num }} st verwacht</div>
                }
              </button>
              <button class="kpi" type="button" (click)="kpiSheet.set('STOCK')">
                <div class="kpi__label">Voorraadwaarde</div>
                <div class="kpi__value">{{ stockValue() | eur: 0 }}</div>
                <div class="kpi__value-sub">kostprijs</div>
                <div class="kpi__meta">{{ stockPieces() | num }} st</div>
                <div class="kpi__meta kpi__meta--sales">verkoop {{ stockSalesValue() | eur: 0 }}</div>
              </button>
            </div>
          </section>
        </div>

        <section class="dashboard-block" aria-labelledby="dashboard-planning-title">
          <div class="dashboard-section-head">
            <div class="dashboard-section-copy">
              <span class="dashboard-eyebrow">Planning</span>
              <h2 id="dashboard-planning-title">Agenda en taken</h2>
              <p>Afspraken, eigen taken en containerdata op één tijdlijn.</p>
            </div>
          </div>
          <app-planner-cards class="planner-mount" [milestones]="purchaseMilestones()" />
        </section>

        <section class="dashboard-block" aria-labelledby="dashboard-incoming-title">
          <div class="dashboard-section-head">
            <div class="dashboard-section-copy">
              <span class="dashboard-eyebrow">Logistiek</span>
              <h2 id="dashboard-incoming-title">Onderweg naar het magazijn</h2>
              <p>{{ incomingPieces() | num }} st verwacht uit {{ incoming().length }} open
                {{ incoming().length === 1 ? 'inkooporder' : 'inkooporders' }}.</p>
            </div>
            <a class="dashboard-section-link" routerLink="/purchasing">Alle inkooporders <span>›</span></a>
          </div>
          <div class="card dashboard-incoming-card">
            @if (incomingStock().length) {
              <div class="list">
                @for (item of incomingStock().slice(0, 5); track item.productId) {
                  <a class="list-item" [routerLink]="item.orderId !== null ? ['/purchasing', item.orderId] : null">
                    @if (item.photo) {
                      <img class="thumb thumb--sm" [appAuthSrc]="item.photo" alt="" />
                    } @else {
                      <span class="thumb thumb--sm thumb--placeholder dashboard-product-placeholder" aria-hidden="true">
                        <app-icon name="products" [size]="18" />
                      </span>
                    }
                    <div class="list-item__body">
                      <div class="list-item__title">{{ item.name }}</div>
                      <div class="list-item__meta">{{ item.orderNumbers }}</div>
                    </div>
                    <div class="list-item__end">
                      <div class="strong num">+{{ item.quantity | num }}</div>
                      <span class="tiny muted">{{ item.arrival ? (item.arrival | dateNl) : 'Aankomstdatum nog invullen' }}</span>
                    </div>
                  </a>
                }
              </div>
            } @else {
              <div class="dashboard-empty-state">
                <span class="dashboard-empty-state__icon"><app-icon name="purchase" [size]="22" /></span>
                <div>
                  <strong>Geen inkomende producten gepland</strong>
                  <p>Bestelde of verscheepte voorraad verschijnt hier automatisch.</p>
                </div>
                <a class="btn btn--sm" routerLink="/purchasing">Inkoop openen</a>
              </div>
            }
          </div>
        </section>
      }

      <section class="dashboard-block dashboard-block--market" aria-labelledby="dashboard-market-title">
        <div class="dashboard-section-head">
          <div class="dashboard-section-copy">
            <span class="dashboard-eyebrow">Marktcontext</span>
            <h2 id="dashboard-market-title">Valuta en containervracht</h2>
            <p>Beslissingsinformatie voor inkoop; standaard compact gehouden.</p>
          </div>
        </div>
        @if (fx.failed() || freightMarketFailed()) {
          <div class="dashboard-market-state" role="status">
            <span aria-hidden="true">!</span>
            <div>
              <strong>Marktdata is tijdelijk onvolledig</strong>
              <p>De operationele cijfers hierboven blijven bruikbaar. Vernieuw alleen deze marktbronnen.</p>
            </div>
            <button class="btn btn--sm" type="button" [disabled]="marketRefreshing()" (click)="refreshMarket()">
              {{ marketRefreshing() ? 'Bezig…' : 'Marktdata vernieuwen' }}
            </button>
          </div>
        }
      @if (fx.series(); as rates) {
        <div class="card">
          <button class="card__head market-toggle" type="button" [attr.aria-expanded]="fxOpen()"
                  (click)="fxOpen.set(!fxOpen())">
            <h2>Wisselkoersen</h2>
            <span class="spacer"></span>
            <span class="tiny muted">ECB · {{ rates.asOf }}</span>
            <i class="market-toggle__chev" [class.market-toggle__chev--open]="fxOpen()" aria-hidden="true"></i>
          </button>
          @if (!fxOpen()) {
            <!-- Small by default: the figures at a glance; the charts and
                 the buying analysis come out when you tap. -->
            <div class="market-compact">
              <button class="market-compact__row" type="button" (click)="fxOpen.set(true)">
                <span>EUR → USD</span>
                <b class="num">{{ fxValue(rates.latestUsd, false) | num: 4 }}</b>
                <span class="badge" [class]="fxPct(rates, rates.usd, false) >= 0 ? 'badge--ok' : 'badge--warn'">
                  {{ fxPct(rates, rates.usd, false) >= 0 ? '+' : '' }}{{ fxPct(rates, rates.usd, false) | num: 1 }}%</span>
              </button>
              <button class="market-compact__row" type="button" (click)="fxOpen.set(true)">
                <span>EUR → CNY</span>
                <b class="num">{{ fxValue(rates.latestCny, false) | num: 4 }}</b>
                <span class="badge" [class]="fxPct(rates, rates.cny, false) >= 0 ? 'badge--ok' : 'badge--warn'">
                  {{ fxPct(rates, rates.cny, false) >= 0 ? '+' : '' }}{{ fxPct(rates, rates.cny, false) | num: 1 }}%</span>
              </button>
              <button class="market-compact__row" type="button" (click)="fxOpen.set(true)">
                <span>USD → CNY</span>
                <b class="num">{{ fxValue(latestCross(rates), false) | num: 4 }}</b>
                <span class="badge" [class]="fxPct(rates, crossOf(rates), false) >= 0 ? 'badge--ok' : 'badge--warn'">
                  {{ fxPct(rates, crossOf(rates), false) >= 0 ? '+' : '' }}{{ fxPct(rates, crossOf(rates), false) | num: 1 }}%</span>
              </button>
            </div>
          } @else {
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
          }
        </div>
      } @else if (!fx.failed()) {
        <app-skeleton kind="card" [rows]="1" />
      }

      <!-- Freight, phone-first: two dollar tiles you can quote from, one
           real trend chart in the same idiom as the FX card (months and
           horizons), and our own lanes as tappable tiles. -->
      <div class="card mt-12">
        <button class="card__head market-toggle" type="button" [attr.aria-expanded]="freightOpen()"
                (click)="freightOpen.set(!freightOpen())">
          <h2>Containervracht</h2>
          <span class="spacer"></span>
          <span class="tiny muted">USD per 40ft</span>
          <i class="market-toggle__chev" [class.market-toggle__chev--open]="freightOpen()" aria-hidden="true"></i>
        </button>
        @if (!freightOpen()) {
          <div class="market-compact">
            @for (route of ownRoutes; track route.code) {
              <button class="market-compact__row" type="button" (click)="freightOpen.set(true)">
                <span>{{ route.port }}</span>
                @if (latestFor(route.code); as latest) {
                  <b class="num">$ {{ latest.usdPerContainer | num: 0 }}</b>
                  <span class="tiny muted">{{ shortDate(latest.quotedOn) }}</span>
                } @else {
                  <b class="muted">—</b>
                  <span class="tiny muted">noteren</span>
                }
              </button>
            }
            @for (bench of dollarBenchmarks; track bench.code) {
              @if (latestFor(bench.code); as latest) {
                <button class="market-compact__row" type="button" (click)="freightOpen.set(true)">
                  <span>{{ bench.label }} <small class="muted">markt</small></span>
                  <b class="num">$ {{ latest.usdPerContainer | num: 0 }}</b>
                  @if (indexChange(bench.code); as change) {
                    <span class="badge" [class]="change <= 0 ? 'badge--ok' : 'badge--warn'">
                      {{ change > 0 ? '+' : '' }}{{ change | num: 1 }}%</span>
                  }
                </button>
              }
            }
          </div>
        } @else {
        <div class="card__body">

          <div class="fown fown--top">
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
                  <span class="ftile__label">{{ route.port }}
                    @if (route.city !== route.port) { <small>{{ route.city }}</small> }
                  </span>
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


          @if (trendOptions().length) {
            <div class="ftrend">
              <div class="ftrend__head">
                <div>
                  <span class="label">Richting van de markt</span>
                  <div class="tiny muted">indexpunten, geen dollars - elke index heeft zijn eigen periode</div>
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

          <div class="fown__head fown__head--split">
            <span class="label">Spotprijzen markt</span>
            <span class="spacer"></span>
            <span class="tiny muted">USD per 40ft · wekelijks automatisch</span>
          </div>
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

        </div>
        }
      </div>
      </section>

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

    @if (kpiSheet(); as kind) {
      <app-sheet [title]="kpiTitle(kind)" (closed)="kpiSheet.set(null)">
        <div body>
          @switch (kind) {
            @case ('SALES') {
              <p class="kpi-explain">Alles wat klanten hebben aangevraagd of gekregen maar nog niet
                afgerond is: samen <b>{{ openValue() | eur: 0 }}</b> over {{ openOrders().length }} order(s).</p>
              <ol class="kpi-list">
                @for (row of openOrders(); track row.order.id) {
                  <li>
                    <a class="kpi-list__row" [routerLink]="['/sales', row.order.id]" (click)="kpiSheet.set(null)">
                      <span class="kpi-list__what"><b>{{ row.order.number }}</b>
                        <small>{{ salesStatusLabel(row.order.status) }} · {{ row.priced.totals.pieces | num }} st</small></span>
                      <span class="num kpi-list__amount">{{ row.priced.totals.total | eur: 0 }}</span>
                    </a>
                  </li>
                }
              </ol>
            }
            @case ('MARGIN') {
              <p class="kpi-explain">Van elke <b>€ 100</b> aan goederen die je verkoopt, blijft
                <b class="ok-text">{{ marginPct() | num: 0 }} euro</b> over nadat de producten zelf
                betaald zijn. Transport en eigen kosten gaan daar nog af.</p>
              <!-- One bar says it: the sale is the cost plus what you keep. -->
              <div class="margin-bar" role="img"
                   [attr.aria-label]="'Goederenverkoop ' + (openGoods() | eur: 0) + ', waarvan winst ' + (marginEur() | eur: 0)">
                <i class="margin-bar__cost" [style.width.%]="100 - marginPct()"></i>
                <i class="margin-bar__win" [style.width.%]="marginPct()"></i>
              </div>
              <div class="stock-duo">
                <span><small>Goederenverkoop</small><b class="num">{{ openGoods() | eur: 0 }}</b></span>
                <span><small>Kostprijs</small><b class="num">{{ openGoods() - marginEur() | eur: 0 }}</b></span>
                <span><small>Winst</small><b class="num ok-text">{{ marginEur() | eur: 0 }}</b></span>
              </div>
              <h3 class="attach-title">Per order · dunste marge eerst</h3>
              <ol class="kpi-list">
                @for (row of ordersByMargin(); track row.order.id) {
                  <li>
                    <a class="kpi-list__row" [routerLink]="['/sales', row.order.id]" (click)="kpiSheet.set(null)">
                      <span class="kpi-list__what"><b>{{ row.order.number }}</b>
                        <small>verkoop {{ row.priced.totals.goodsTotal | eur: 0 }}</small></span>
                      <span class="num kpi-list__amount" [class.danger-text]="row.priced.totals.marginEur < 0">
                        {{ row.priced.totals.marginEur | eur: 0 }}
                        <small [class.danger-text]="row.priced.totals.marginPct < 0"
                               [class.muted]="row.priced.totals.marginPct >= 0">{{ row.priced.totals.marginPct | num: 0 }}%</small></span>
                    </a>
                  </li>
                }
              </ol>
            }
            @case ('PURCHASE') {
              <div class="stock-duo">
                <span><small>Waarde</small><b class="num">{{ incomingValue() | eur: 0 }}</b></span>
                <span><small>Stuks</small><b class="num">{{ incomingPieces() | num }}</b></span>
                <span><small>Eerstvolgend</small><b class="num">{{ nextArrivalLabel() }}</b></span>
              </div>
              @for (bucket of incomingBuckets(); track bucket.label) {
                <h3 class="attach-title">{{ bucket.label }} <small class="muted">{{ bucket.rows.length }}</small></h3>
                <ol class="kpi-list">
                  @for (row of bucket.rows; track row.order.id) {
                    <li>
                      <a class="kpi-list__row" [routerLink]="['/purchasing', row.order.id]" (click)="kpiSheet.set(null)">
                        <span class="kpi-list__what"><b>{{ row.order.alias || row.order.number }}</b>
                          <small>{{ supplierNameOf(row) }}
                            @if (row.order.expectedArrival) { · aankomst {{ row.order.expectedArrival | dateNl }} }
                            @if (row.attention?.length) { · <b class="warn-text">{{ row.attention!.length }} actie(s)</b> }</small></span>
                        <span class="num kpi-list__amount">{{ row.costing.totals.totalEur | eur: 0 }}
                          <small class="muted">{{ row.costing.totals.pieces | num }} st</small></span>
                      </a>
                    </li>
                  }
                </ol>
              }
              <p class="kpi-explain kpi-explain--foot">Zodra een container op Ontvangen gaat,
                schuift zijn waarde door naar de voorraad.</p>
            }
            @case ('STOCK') {
              <p class="kpi-explain">Dezelfde planken, twee brillen:
                gekost <b>{{ stockValue() | eur: 0 }}</b> (stuks × gelande kostprijs),
                waard <b>{{ stockSalesValue() | eur: 0 }}</b> tegen catalogusprijs -
                verkoop je alles, dan zit daar
                <b class="ok-text">{{ stockSalesValue() - stockValue() | eur: 0 }}</b> brutowinst in.
                Hieronder de grootste posten - daar zit je geld.</p>
              <div class="stock-duo">
                <span><small>Kostwaarde</small><b class="num">{{ stockValue() | eur: 0 }}</b></span>
                <span><small>Verkoopwaarde</small><b class="num">{{ stockSalesValue() | eur: 0 }}</b></span>
                <span><small>Potentieel</small><b class="num ok-text">{{ stockSalesValue() - stockValue() | eur: 0 }}</b></span>
              </div>
              <ol class="kpi-list">
                @for (item of stockTop(); track item.name) {
                  <li>
                    <span class="kpi-list__row kpi-list__row--bar">
                      <span class="kpi-list__what"><b>{{ item.name }}</b>
                        <small>{{ item.pieces | num }} st × {{ item.cost | eur: 2 }} · {{ item.share | num: 0 }}% van de waarde</small>
                        <i class="share-bar" aria-hidden="true"><i [style.width.%]="item.share"></i></i></span>
                      <span class="num kpi-list__amount">{{ item.value | eur: 0 }}</span>
                    </span>
                  </li>
                }
                @if (stockRest(); as rest) {
                  @if (rest.count) {
                    <li><span class="kpi-list__row">
                      <span class="kpi-list__what"><b class="muted">Overige {{ rest.count }} producten</b></span>
                      <span class="num kpi-list__amount muted">{{ rest.value | eur: 0 }}</span>
                    </span></li>
                  }
                }
              </ol>
            }
          }
        </div>
        <div foot style="display:contents">
          <span class="spacer"></span>
          <button class="btn" type="button" (click)="kpiSheet.set(null)">Sluiten</button>
        </div>
      </app-sheet>
    }
  `,
  styles: `
    :host { display:block }
    .dashboard-page { max-width:1360px }
    .dashboard-loading { display:grid;gap:16px }
    .dashboard-eyebrow { display:block;margin-bottom:4px;color:var(--rose);font-size:12px;
      font-weight:800;letter-spacing:.12em;text-transform:uppercase }
    .dashboard-section-copy { min-width:0 }
    .dashboard-section-copy h2,.dashboard-card-head h2 { color:var(--ink);font-size:19px;
      font-weight:760;letter-spacing:-.02em;line-height:1.2 }
    .dashboard-section-copy p,.dashboard-card-head p { margin-top:4px;color:var(--muted);
      font-size:14px;line-height:1.5 }

    .dashboard-sync-warning { display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;
      gap:12px;margin-bottom:14px;padding:13px 14px;border:1px solid color-mix(in srgb,var(--warn) 30%,var(--line));
      border-radius:var(--r);background:var(--warn-soft);color:var(--ink-2) }
    .dashboard-sync-warning__icon { display:grid;width:34px;height:34px;place-items:center;border-radius:50%;
      background:var(--surface);color:var(--warn);font-weight:850;box-shadow:var(--sh-1) }
    .dashboard-sync-warning strong { display:block;color:var(--ink);font-size:15px }
    .dashboard-sync-warning p { margin-top:2px;font-size:13.5px;line-height:1.45 }

    .dashboard-command-grid { display:grid;gap:18px;align-items:start }
    .dashboard-work { border-color:color-mix(in srgb,var(--rose-line) 72%,white);box-shadow:var(--sh-2) }
    .dashboard-card-head { display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:18px 18px 15px;
      border-bottom:1px solid var(--line);background:linear-gradient(135deg,var(--surface),color-mix(in srgb,var(--rose-soft) 58%,white)) }
    .dashboard-card-head>div { min-width:0 }
    .dashboard-total,.dashboard-done { display:grid;flex:none;width:38px;height:38px;place-items:center;border-radius:13px;
      background:var(--rose);color:#fff;font-size:15px;font-weight:820;box-shadow:0 7px 18px color-mix(in srgb,var(--rose) 23%,transparent) }
    .dashboard-done { background:var(--ok);box-shadow:0 7px 18px color-mix(in srgb,var(--ok) 20%,transparent) }
    .dashboard-work-list { display:flex;flex-direction:column }
    .dashboard-work-row { display:grid;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:11px;
      min-height:64px;padding:10px 14px;border-bottom:1px solid var(--line);background:var(--surface);
      color:inherit;text-decoration:none;transition:background .15s ease }
    .dashboard-work-row:last-child { border-bottom:0 }
    .dashboard-work-row:hover { background:var(--surface-2) }
    .dashboard-work-row--primary { background:color-mix(in srgb,var(--rose-soft) 64%,var(--surface)) }
    .dashboard-work-row--primary .dashboard-work-row__icon { background:var(--rose);color:#fff }
    .dashboard-work-row--warn .dashboard-work-row__icon { background:var(--warn-soft);color:var(--warn) }
    .dashboard-work-row__icon { display:grid;width:38px;height:38px;place-items:center;border-radius:12px;
      background:var(--surface-2);color:var(--rose-dark);box-shadow:inset 0 0 0 1px var(--line) }
    .dashboard-work-row__body { display:grid;min-width:0;gap:2px }
    .dashboard-work-row__body strong { overflow:hidden;font-size:15px;font-weight:720;text-overflow:ellipsis;white-space:nowrap }
    .dashboard-work-row__body small { overflow:hidden;color:var(--muted);font-size:13.5px;text-overflow:ellipsis;white-space:nowrap }
    .dashboard-work-row__value { color:var(--ink-2);font-size:14px;font-weight:720;white-space:nowrap }
    .dashboard-work-row__arrow { color:var(--muted-2);font-size:20px;line-height:1 }
    .dashboard-more-row { display:flex;min-height:48px;width:100%;align-items:center;justify-content:center;gap:6px;padding:8px 14px;
      border:0;border-bottom:1px solid var(--line);background:var(--surface-2);color:var(--rose);font:inherit;
      font-size:13.5px;font-weight:720;text-decoration:none;cursor:pointer }
    .dashboard-more-row span { font-size:16px }
    .dashboard-work-empty,.dashboard-empty-state { display:grid;grid-template-columns:auto minmax(0,1fr) auto;
      align-items:center;gap:13px;padding:18px }
    .dashboard-work-empty>span { display:grid;width:42px;height:42px;place-items:center;border-radius:50%;
      background:var(--ok-soft);color:var(--ok);font-size:18px;font-weight:850 }
    .dashboard-work-empty--unknown>span { background:var(--warn-soft);color:var(--warn) }
    .dashboard-work-empty strong,.dashboard-empty-state strong { display:block;font-size:15px }
    .dashboard-work-empty p,.dashboard-empty-state p { margin-top:2px;color:var(--muted);font-size:13.5px;line-height:1.45 }

    .dashboard-snapshot { min-width:0;padding:3px 0 }
    .dashboard-snapshot>.dashboard-section-copy { margin-bottom:10px;padding-inline:2px }
    .dashboard-kpis { grid-template-columns:repeat(2,minmax(0,1fr)) }
    .dashboard-kpis .kpi { min-height:126px;padding:15px;text-align:left }
    .dashboard-kpis .kpi__value { font-size:23px }
    .dashboard-kpis .kpi__meta { line-height:1.35 }

    .dashboard-block { margin-top:30px }
    .dashboard-section-head { display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:10px;padding-inline:2px }
    .dashboard-section-link { flex:none;min-height:44px;padding:11px 0;color:var(--rose);font-size:14px;font-weight:700;text-decoration:none }
    .dashboard-section-link span { margin-left:3px;font-size:17px;vertical-align:-1px }
    .dashboard-incoming-card { min-height:76px }
    .dashboard-product-placeholder { justify-content:center;color:var(--rose);font-size:0 }
    .dashboard-empty-state__icon { display:grid;width:44px;height:44px;place-items:center;border-radius:13px;
      background:var(--surface-2);color:var(--muted);box-shadow:inset 0 0 0 1px var(--line) }
    .dashboard-block--market { margin-top:34px;padding-top:24px;border-top:1px solid var(--line) }
    .dashboard-market-state { display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:12px;
      margin-bottom:12px;padding:12px 14px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--surface-2) }
    .dashboard-market-state>span { display:grid;width:32px;height:32px;place-items:center;border-radius:50%;
      background:var(--warn-soft);color:var(--warn);font-weight:800 }
    .dashboard-market-state strong { display:block;font-size:14.5px }
    .dashboard-market-state p { margin-top:2px;color:var(--muted);font-size:13.5px }

    @media (min-width:960px) {
      .dashboard-command-grid { grid-template-columns:minmax(0,1.24fr) minmax(380px,.76fr);gap:24px }
      .dashboard-work { min-height:100% }
    }
    @media (max-width:679.98px) {
      .dashboard-sync-warning { grid-template-columns:auto minmax(0,1fr) }
      .dashboard-sync-warning .btn { grid-column:1/-1;width:100% }
      .dashboard-card-head { padding:16px 14px 14px }
      .dashboard-work-row { grid-template-columns:auto minmax(0,1fr) auto;padding-inline:12px }
      .dashboard-work-row__value { grid-column:2;color:var(--ink);font-size:13px }
      .dashboard-work-row__arrow { grid-column:3;grid-row:1/span 2 }
      .dashboard-work-empty,.dashboard-empty-state { grid-template-columns:auto minmax(0,1fr);padding:16px 14px }
      .dashboard-work-empty .btn,.dashboard-empty-state .btn { grid-column:1/-1;width:100% }
      .dashboard-section-head { align-items:flex-start }
      .dashboard-section-copy h2,.dashboard-card-head h2 { font-size:17px }
      .dashboard-section-link { max-width:112px;text-align:right }
      .dashboard-market-state { grid-template-columns:auto minmax(0,1fr) }
      .dashboard-market-state .btn { grid-column:1/-1;width:100% }
      .dashboard-kpis .kpi { min-height:118px;padding:13px 12px }
      .dashboard-kpis .kpi__value { font-size:20px }
      .dashboard-kpis .kpi__meta { font-size:12.5px }
    }
    @media (max-width:379.98px) {
      .dashboard-section-head { display:grid;grid-template-columns:minmax(0,1fr);gap:2px }
      .dashboard-section-link { max-width:none;padding:4px 0 8px;text-align:left }
      .dashboard-kpis .kpi__label { font-size:10px;letter-spacing:.05em }
    }
    @media (prefers-reduced-motion:reduce) {
      .dashboard-work-row { transition:none }
    }
  `,
})
export class Dashboard {
  readonly desktop = inject(DesktopViewport);

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
  readonly trendCode = signal('CCFI CN-EUR');
  readonly trendLabel = computed(() =>
    this.trendCandidates.find((option) => option.code === this.trendCode())?.title ?? '');
  readonly trendUnit = computed(() =>
    this.trendCandidates.find((option) => option.code === this.trendCode())?.usd ? 'USD per 40ft' : 'indexpunten');
  /** Dated, oldest first - the chart and its month marks need both. */
  readonly trendSeries = computed(() => {
    const code = this.trendOptions().some((option) => option.code === this.trendCode())
        ? this.trendCode() : this.trendOptions()[0]?.code;
    if (!code) return null;
    const entries = this.ratesFor(code);
    return { dates: entries.map((e) => e.quotedOn), values: entries.map((e) => e.usdPerContainer) };
  });

  /** Our own lanes; quotes come from forwarders, typed in by hand. */
  readonly ownRoutes = [
    { code: 'NINGBO', label: 'Ningbo', port: 'Ningbo', city: 'Ningbo' },
    { code: 'GUANGZHOU', label: 'Nansha (Guangzhou)', port: 'Nansha', city: 'Guangzhou' },
    { code: 'SHENZHEN', label: 'Yantian (Shenzhen)', port: 'Yantian', city: 'Shenzhen' },
  ];
  readonly freightRates = signal<FreightRate[]>([]);
  readonly marketSources = signal<MarketSourceStatus[]>([]);
  private readonly ratesByRoute = computed(() => {
    const routes = new Map<string, FreightRate[]>();
    for (const rate of this.freightRates()) {
      const entries = routes.get(rate.route) ?? [];
      entries.push(rate);
      routes.set(rate.route, entries);
    }
    for (const entries of routes.values()) {
      entries.sort((a, b) => a.quotedOn.localeCompare(b.quotedOn));
    }
    return routes;
  });
  private readonly marketSourceByCode = computed(() =>
    new Map(this.marketSources().map((source) => [source.code, source])));
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
    return this.ratesFor(code).slice().reverse();
  }

  async deleteRate(rate: FreightRate): Promise<void> {
    if (rate.id == null) return;
    await this.sourcing.deleteFreightRate(rate.id);
    this.freightRates.set(await this.sourcing.freightRates());
  }

  readonly wciSeries = computed(() => this.ratesFor('WCI SHA-RTM')
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
    return this.marketSourceByCode().get(code) ?? null;
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
    return this.ratesByRoute().get(code) ?? [];
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

    /* Why, told from our chair: we pay euro, the supplier is paid in
       dollar or yuan. What did each agreement type do to our cost, and
       what did it do to the supplier's own earnings (he counts in yuan)? */
    if (cnyCheaperPct === null) {
      lines.push(`De euro ${gain(usdCheaperPct)} ${abs(usdCheaperPct)}% tegenover de dollar ` +
          `sinds ${baselineDate}.`);
    } else {
      const usdBetter = usdCheaperPct >= 0;
      const cnyBetter = cnyCheaperPct >= 0;
      const dollarMovedMore = Math.abs(usdCheaperPct) > Math.abs(cnyCheaperPct) + 0.5;
      const yuanMovedMore = Math.abs(cnyCheaperPct) > Math.abs(usdCheaperPct) + 0.5;
      if (usdBetter && cnyBetter) {
        lines.push(`Waarom nu beter: de euro won ${abs(usdCheaperPct)}% op de dollar en ` +
            `${abs(cnyCheaperPct)}% op de yuan sinds ${baselineDate} — dezelfde EXW-prijs ` +
            `kost je nu minder euro, in beide munten.`);
        if (dollarMovedMore) {
          lines.push(`De dollar zakte harder dan de yuan. Een leverancier met een ` +
              `dollarafspraak krijgt nu minder yuan voor zijn dollars — hij verdient minder ` +
              `en zal zijn dollarprijs willen verhogen. Bij een yuan-afspraak blijft zijn ` +
              `opbrengst gelijk, maar jouw voordeel is daar kleiner ` +
              `(${abs(cnyCheaperPct)}% in plaats van ${abs(usdCheaperPct)}%).`);
        } else if (yuanMovedMore) {
          lines.push(`De yuan zakte harder dan de dollar. Een yuan-afspraak is nu het ` +
              `voordeligst (${abs(cnyCheaperPct)}% tegenover ${abs(usdCheaperPct)}%); een ` +
              `leverancier met een dollarafspraak krijgt juist méér yuan per dollar en zit ` +
              `comfortabel — daar is prijsdruk van zijn kant onwaarschijnlijk.`);
        } else {
          lines.push(`Dollar en yuan bewogen gelijk op: dollar- of yuan-afspraak maakt nu ` +
              `geen verschil, en de leverancier merkt er in zijn yuan weinig van.`);
        }
      } else if (!usdBetter && !cnyBetter) {
        lines.push(`Waarom toen beter: de euro verloor ${abs(usdCheaperPct)}% op de dollar ` +
            `en ${abs(cnyCheaperPct)}% op de yuan sinds ${baselineDate} — dezelfde ` +
            `EXW-prijs kost je nu meer euro, in beide munten.`);
        if (dollarMovedMore) {
          lines.push(`De dollar werd harder duurder dan de yuan. Een dollarafspraak kost je ` +
              `nu het meest extra; die leverancier krijgt méér yuan per dollar en verdient ` +
              `dus beter dan toen — ruimte om over zijn dollarprijs te onderhandelen. Een ` +
              `yuan-afspraak kost ${abs(cnyCheaperPct)}% extra.`);
        } else if (yuanMovedMore) {
          lines.push(`De yuan werd harder duurder dan de dollar. Een yuan-afspraak kost je ` +
              `nu het meest extra (${abs(cnyCheaperPct)}% tegenover ${abs(usdCheaperPct)}%); ` +
              `met een dollarafspraak beperk je de schade.`);
        } else {
          lines.push(`Dollar en yuan werden gelijk op duurder: de munt van de afspraak ` +
              `maakt nu geen verschil.`);
        }
      } else if (usdBetter) {
        lines.push(`Gemengd: de euro won ${abs(usdCheaperPct)}% op de dollar maar verloor ` +
            `${abs(cnyCheaperPct)}% op de yuan sinds ${baselineDate}. Een dollarafspraak ` +
            `werd goedkoper, een yuan-afspraak duurder. De dollarleverancier krijgt minder ` +
            `yuan per dollar — hij verdient minder en zal zijn dollarprijs willen verhogen.`);
      } else {
        lines.push(`Gemengd: de euro verloor ${abs(usdCheaperPct)}% op de dollar maar won ` +
            `${abs(cnyCheaperPct)}% op de yuan sinds ${baselineDate}. Een yuan-afspraak ` +
            `werd goedkoper, een dollarafspraak duurder. De dollarleverancier krijgt méér ` +
            `yuan per dollar en verdient beter — daar valt over de prijs te praten.`);
      }
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

  /** Friendly during office hours; unambiguous during overnight work. */
  greeting(): string {
    const hour = new Date().getHours();
    if (hour < 6) return 'Dagoverzicht';
    if (hour < 12) return 'Goedemorgen';
    if (hour < 18) return 'Goedemiddag';
    return 'Goedenavond';
  }

  today(): string {
    return new Intl.DateTimeFormat('nl-BE',
        { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  }

  private readonly sales = inject(SalesApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly catalog = inject(CatalogApi);

  readonly salesOrders = signal<SalesOrderView[]>([]);
  readonly purchases = signal<PurchaseOrderView[]>([]);
  readonly allPurchases = signal<PurchaseOrderView[]>([]);
  readonly fxOpen = signal(false);
  readonly kpiSheet = signal<'SALES' | 'MARGIN' | 'PURCHASE' | 'STOCK' | null>(null);
  private readonly planner = inject(PlannerStore);
  readonly pinnedItems = computed(() => this.planner.items().filter((item) => item.pinned));

  kpiTitle(kind: 'SALES' | 'MARGIN' | 'PURCHASE' | 'STOCK'): string {
    return kind === 'SALES' ? 'Open offertes'
      : kind === 'MARGIN' ? 'Brutomarge'
      : kind === 'PURCHASE' ? 'Inkoop onderweg' : 'Voorraadwaarde';
  }

  salesStatusLabel(status: string): string {
    return status === 'CONCEPT' ? 'concept' : status === 'VERZONDEN' ? 'verzonden'
      : status === 'BEKEKEN' ? 'bekeken' : status === 'WIJZIGING_GEVRAAGD' ? 'wijziging gevraagd' : status.toLowerCase();
  }

  /** Containers grouped by leg: on the water first, then still at the factory. */
  readonly incomingBuckets = computed(() => {
    const sailing: PurchaseOrderView[] = [];
    const ordered: PurchaseOrderView[] = [];
    for (const row of this.incoming()) {
      (row.order.status === 'ONDERWEG' ? sailing : ordered).push(row);
    }
    const buckets = [];
    if (sailing.length) buckets.push({ label: 'Op zee', rows: sailing });
    if (ordered.length) buckets.push({ label: 'Besteld, nog niet vertrokken', rows: ordered });
    return buckets;
  });

  readonly nextArrivalLabel = computed(() => {
    const dates = this.incoming()
      .map((row) => row.order.expectedArrival)
      .filter((date): date is string => !!date)
      .sort();
    if (!dates.length) return '—';
    return new Date(dates[0]).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' });
  });

  readonly suppliers = signal<Supplier[]>([]);
  private readonly supplierNameById = computed(() =>
    new Map(this.suppliers().map((supplier) => [supplier.id, supplier.name])));

  /** The containers write their own lines into the agenda: ordered, sailed,
      expected and received - derived live, so never stale. */
  readonly purchaseMilestones = computed(() => {
    const stones = [];
    for (const row of this.allPurchases()) {
      const name = row.order.alias || row.order.number;
      if (row.order.orderDate && row.order.status !== 'CONCEPT') {
        stones.push({ date: row.order.orderDate, icon: '🛒', title: `${name} besteld`,
          sub: this.supplierNameOf(row), orderId: row.order.id });
      }
      if (row.order.shippedOn) {
        stones.push({ date: row.order.shippedOn, icon: '🚢', title: `${name} vertrokken`,
          sub: row.order.trackingReference ? 'T&T ' + row.order.trackingReference : null, orderId: row.order.id });
      }
      if (row.order.expectedArrival && row.order.status !== 'ONTVANGEN') {
        stones.push({ date: row.order.expectedArrival, icon: '📦', title: `${name} verwachte aankomst`,
          sub: `${row.costing.totals.pieces.toLocaleString('nl-BE')} st · ${this.supplierNameOf(row)}`,
          orderId: row.order.id });
      }
      if (row.order.receivedOn) {
        stones.push({ date: row.order.receivedOn, icon: '✅', title: `${name} ontvangen`,
          sub: this.supplierNameOf(row), orderId: row.order.id });
      }
    }
    return stones;
  });

  supplierNameOf(row: PurchaseOrderView): string {
    return this.supplierNameById().get(row.order.supplierId) ?? row.order.number;
  }

  /** The shelf's heaviest lines by value, the ones worth watching. */
  readonly stockTop = computed(() => this.products()
    .filter((product) => (product.stockQuantity ?? 0) > 0)
    .map((product) => ({
      name: product.name + (product.colour ? ' - ' + product.colour : ''),
      pieces: product.stockQuantity ?? 0,
      cost: product.landedCostEur ?? 0,
      value: (product.stockQuantity ?? 0) * (product.landedCostEur ?? 0),
    }))
    .sort((a, b) => b.value - a.value)
    .map((item) => ({ ...item, share: this.stockValue() > 0 ? (item.value / this.stockValue()) * 100 : 0 }))
    .slice(0, 8));

  /** Whatever falls outside the top rows, as one closing line. */
  readonly stockRest = computed(() => {
    const top = this.stockTop();
    const topValue = top.reduce((sum, item) => sum + item.value, 0);
    const all = this.products().filter((product) => (product.stockQuantity ?? 0) > 0).length;
    return { count: Math.max(0, all - top.length), value: Math.max(0, this.stockValue() - topValue) };
  });
  readonly freightOpen = signal(false);
  readonly freightMarketFailed = signal(false);
  readonly marketRefreshing = signal(false);
  readonly products = signal<Product[]>([]);
  private readonly productById = computed(() =>
    new Map(this.products().map((product) => [product.id, product])));

  /** What the shelf is worth at cost: pieces times landed cost, demo included. */
  readonly stockValue = computed(() => this.products()
    .reduce((sum, product) => sum + (product.stockQuantity ?? 0) * (product.landedCostEur ?? 0), 0));
  readonly stockPieces = computed(() => this.products()
    .reduce((sum, product) => sum + (product.stockQuantity ?? 0), 0));

  /** The same shelf at catalogue prices: fixed price, or cost plus markup. */
  readonly stockSalesValue = computed(() => this.products()
    .reduce((sum, product) => sum + (product.stockQuantity ?? 0) * this.salesPriceOf(product), 0));

  private salesPriceOf(product: Product): number {
    if (product.fixedSalesPriceEur) return product.fixedSalesPriceEur;
    const cost = product.landedCostEur ?? 0;
    return cost * (1 + (product.markupPct ?? 0) / 100);
  }
  readonly expected = signal<ExpectedStock[]>([]);

  /** Orders that wait on us: a missing tracking number, an instalment due. */
  /* The phone shows three action lines; the rest waits behind one
     button. Desktop has the room and always shows everything. */
  readonly actionsOpen = signal(false);
  readonly visibleActions = computed(() => {
    const rows = this.purchaseActions();
    if (this.actionsOpen()) return rows;
    return rows.slice(0, this.desktop.active() ? 5 : 3);
  });
  readonly hiddenActionCount = computed(() =>
    this.purchaseActions().length - this.visibleActions().length);

  readonly purchaseActions = computed(() =>
    this.allPurchases()
      .filter((row) => (row.attention?.length ?? 0) > 0)
      .sort((a, b) => (b.attention!.length - a.attention!.length)));
  readonly actionCount = computed(() =>
    this.allPurchases().reduce((sum, row) => sum + (row.attention?.length ?? 0), 0));

  /** What is on the water, soonest first, with the product's name. */
  readonly incomingStock = computed(() => {
    const byId = this.productById();
    return this.expected()
      .slice()
      .sort((a, b) => (a.expectedArrival ?? '9999').localeCompare(b.expectedArrival ?? '9999'))
      .map((item) => ({
        productId: item.productId,
        name: byId.get(item.productId)?.name ?? `product ${item.productId}`,
        photo: byId.get(item.productId)?.photos?.[0]?.url ?? null,
        quantity: item.quantity,
        arrival: item.expectedArrival,
        orderId: item.orderIds[0] ?? null,
        orderNumbers: item.orderNumbers.join(', '),
      }));
  });
  readonly incomingPieces = computed(() =>
    this.expected().reduce((sum, item) => sum + item.quantity, 0));
  readonly revisions = signal<QuoteRevision[]>([]);
  readonly productCount = signal(0);
  readonly skuCount = signal(0);
  readonly catalogAttention = signal(0);
  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly dataWarnings = signal<string[]>([]);
  readonly warningDetail = signal<string | null>(null);
  private loadedOnce = false;

  /** Website requests are ordinary concept quotes with a stable source marker. */
  readonly websiteRequests = computed(() => this.salesOrders()
    .filter((row) => isWebsiteQuoteRequest(row.order))
    .slice()
    .sort((left, right) => right.order.orderDate.localeCompare(left.order.orderDate)));

  /** A factual stock signal: only active, non-demo variants with known inventory count. */
  readonly zeroStockCount = computed(() => this.products().filter((product) =>
    product.active && !product.demo && product.inventoryKnown === true &&
    (product.stockQuantity ?? 0) <= 0).length);

  readonly dailyActionCount = computed(() => this.websiteRequests().length + this.revisions().length +
    this.actionCount() + this.zeroStockCount() + this.catalogAttention());

  dailyHeadline(): string {
    const count = this.dailyActionCount();
    if (count) return `${count} aandachtspunt${count === 1 ? '' : 'en'}`;
    return this.dataWarnings().length ? 'Overzicht nog niet volledig' : 'Alles voor nu bijgewerkt';
  }

  dailySubline(): string {
    if (this.websiteRequests().length) {
      return `${this.websiteRequests().length} nieuwe websiteaanvraag${this.websiteRequests().length === 1 ? '' : 'en'} wacht${this.websiteRequests().length === 1 ? '' : 'en'} als eerste.`;
    }
    if (this.revisions().length) return 'Begin bij de klanten die een aangepaste offerte verwachten.';
    if (this.actionCount()) return 'De open punten zitten nu vooral bij lopende inkooporders.';
    if (this.zeroStockCount()) return 'Verkoop en inkoop zijn rustig; controleer de artikelen zonder voorraad.';
    if (this.catalogAttention()) return 'De operatie is rustig; productdata voor publicatie blijft nog open.';
    if (this.dataWarnings().length) return 'Herlaad de ontbrekende bronnen voordat je de dagstart afrondt.';
    return 'Geen klantaanvragen of operationele blokkades die nu een antwoord vragen.';
  }

  warningLabel(): string {
    return `Niet bijgewerkt: ${this.dataWarnings().join(', ')}`;
  }

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    if (this.refreshing()) return;
    if (this.loadedOnce) this.refreshing.set(true);
    else {
      this.loading.set(true);
      this.dataWarnings.set([]);
      this.warningDetail.set(null);
    }

    /* Market data loads independently: a slow external feed must never
       hold up the work overview. */
    this.fx.failed.set(false);
    void this.fx.load();
    void this.loadFreightMarket();

    try {
      const [orders, purchases, revisions, products, families, suppliers, expected] =
        await Promise.allSettled([
          this.sales.orders(), this.sourcing.purchaseOrders(),
          this.sales.pendingRevisions(), this.catalog.products(),
          this.catalog.productFamilies(), this.sourcing.suppliers(),
          this.sourcing.expectedStock(),
        ] as const);

      const warnings: string[] = [];
      const failures: unknown[] = [];
      const noteFailure = (result: PromiseSettledResult<unknown>, label: string): void => {
        if (result.status !== 'rejected') return;
        warnings.push(label);
        failures.push(result.reason);
      };

      noteFailure(orders, 'verkoop');
      noteFailure(purchases, 'inkoop');
      noteFailure(revisions, 'offertewijzigingen');
      noteFailure(products, 'voorraad en producten');
      noteFailure(suppliers, 'leveranciers');
      noteFailure(expected, 'verwachte voorraad');
      noteFailure(families, 'websiteproductdata');

      if (orders.status === 'fulfilled') this.salesOrders.set(orders.value);
      if (purchases.status === 'fulfilled') {
        this.allPurchases.set(purchases.value);
        this.purchases.set(purchases.value.slice(0, 5));
      }
      if (revisions.status === 'fulfilled') this.revisions.set(revisions.value);
      if (products.status === 'fulfilled') this.products.set(products.value);
      if (suppliers.status === 'fulfilled') this.suppliers.set(suppliers.value);
      if (expected.status === 'fulfilled') this.expected.set(expected.value);

      const currentProducts = products.status === 'fulfilled' ? products.value : this.products();
      if (families.status === 'fulfilled') {
        this.productCount.set(families.value.length || currentProducts.length);
        this.catalogAttention.set(families.value.length
          ? families.value.filter((family) => family.active && family.publicationIssues.length > 0).length
          : currentProducts.filter((product) =>
            product.active && (product.publicationIssues?.length ?? 0) > 0).length);
      } else if (products.status === 'fulfilled') {
        /* Variant issues are a safe fallback when the family endpoint is temporarily unavailable. */
        this.productCount.set(currentProducts.length);
        this.catalogAttention.set(currentProducts.filter((product) =>
          product.active && (product.publicationIssues?.length ?? 0) > 0).length);
      }
      if (products.status === 'fulfilled') this.skuCount.set(products.value.length);

      this.dataWarnings.set(warnings);
      this.warningDetail.set(failures.length
        ? messageOf(failures[0], 'Controleer de verbinding en probeer opnieuw.')
        : null);
    } catch (failure: unknown) {
      this.dataWarnings.set(['dashboard']);
      this.warningDetail.set(messageOf(
        failure,
        'Het overzicht kon niet volledig worden opgebouwd. Probeer opnieuw.',
      ));
    } finally {
      this.loadedOnce = true;
      this.loading.set(false);
      this.refreshing.set(false);
    }
  }

  private async loadFreightMarket(): Promise<void> {
    this.freightMarketFailed.set(false);
    try {
      /* Own quotes and existing cache render immediately. The slower licensed
         provider checks then refresh statuses and observations in place. */
      this.freightRates.set(await this.sourcing.freightRates());
      this.marketSources.set(await this.sourcing.marketSourceStatuses());
      this.freightRates.set(await this.sourcing.freightRates());
    } catch {
      /* Market context is advisory and must never block the work dashboard. */
      this.freightMarketFailed.set(true);
    }
  }

  async refreshMarket(): Promise<void> {
    if (this.marketRefreshing()) return;
    this.marketRefreshing.set(true);
    this.fx.failed.set(false);
    try {
      await Promise.all([this.fx.load(), this.loadFreightMarket()]);
    } finally {
      this.marketRefreshing.set(false);
    }
  }

  readonly openOrders = computed(() =>
    this.salesOrders().filter((row) =>
      (row.order.docType ?? 'OFFERTE') === 'OFFERTE' &&
      ['CONCEPT', 'VERZONDEN', 'BEKEKEN', 'WIJZIGING_GEVRAAGD'].includes(row.order.status)));

  readonly openValue = computed(() =>
    this.openOrders().reduce((sum, row) => sum + row.priced.totals.total, 0));
  readonly marginEur = computed(() =>
    this.openOrders().reduce((sum, row) => sum + row.priced.totals.marginEur, 0));
  readonly openGoods = computed(() =>
    this.openOrders().reduce((sum, row) => sum + row.priced.totals.goodsTotal, 0));

  /** Thinnest first: the orders where the money leaks are the ones to open. */
  readonly ordersByMargin = computed(() =>
    this.openOrders().slice().sort((a, b) => a.priced.totals.marginPct - b.priced.totals.marginPct));

  readonly marginPct = computed(() => {
    const goods = this.openGoods();
    return goods > 0 ? (this.marginEur() / goods) * 100 : 0;
  });

  /* Counted over every order, not the five newest: an old container on
     the water is exactly the one you must not lose sight of. */
  readonly incoming = computed(() =>
    this.allPurchases().filter((row) => ['BESTELD', 'ONDERWEG'].includes(row.order.status)));

  /** "1 besteld · 1 op zee" says more than a bare container count. */
  readonly incomingLabel = computed(() => {
    let ordered = 0;
    let sailing = 0;
    for (const row of this.incoming()) {
      if (row.order.status === 'BESTELD') ordered++;
      else if (row.order.status === 'ONDERWEG') sailing++;
    }
    const parts = [];
    if (ordered) parts.push(`${ordered} besteld`);
    if (sailing) parts.push(`${sailing} op zee`);
    return parts.length ? parts.join(' · ') : 'geen containers onderweg';
  });
  readonly incomingValue = computed(() =>
    this.incoming().reduce((sum, row) => sum + row.costing.totals.totalEur, 0));

  readonly recentSales = computed(() => this.salesOrders().slice(0, 5));

  label = (status: SalesOrderView['order']['status']) => STATUS_LABEL[status];
  cls = statusClass;
}
