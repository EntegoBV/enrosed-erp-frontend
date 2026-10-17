import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, effect, inject, signal, afterRenderEffect, ElementRef, untracked, viewChild } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Location, NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { DESK_TAB_ROW } from './analyses-desk-tabs';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import {
  Customer,
  ExpectedStock,
  Product,
  PurchaseOrderView,
  ReceiptVarianceReport,
  ReceiptVarianceRow,
  SalesOrderView,
  Supplier, CompanyCost, IncomingPaymentRow, PartnerFinancing,
} from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { Icon } from '../../shared/icon';
import { PageHeader } from '../../shared/page-header';
import { DateField } from '../../shared/date-field';
import { DateNlPipe, EurPipe, NumPipe, PctPipe } from '../../shared/pipes';
import { Ui } from '../../shared/ui';
import { inventoryAnalysis, partnerFinancingAnalysis, resultAnalysis, salesAnalysis } from './analysis-metrics';
import { FinanceApi } from '../../core/api/finance-api';
import { channelLabel } from '../sales/sales-channels';
import { categoryLabel } from '../finance/cost-categories';
import { costChargeIn, openOf } from '../finance/finance-metrics';
import { MarketAnalysis } from './market-analysis';
import { ContainerCostAnalysis } from './container-cost-analysis';
import { purchaseExternalCost } from '../purchasing/purchase-reconciliation-metrics';
import { WebsiteAnalytics } from './website-analytics';
import { averageLeadDays, inDateRange, supplierReceiptPerformance, supplierScorecards } from './receipt-metrics';
import { TrendChart, TrendSeries } from '../../shared/trend-chart';
import { incomingMoneyTotals } from '../finance/incoming-money';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { CashDesk } from './cash-desk';
import { CashOverviewCard } from './cash-overview-card';
import { CashPhone } from './cash-phone';
import { CashPageData, CashSources } from './cash-sources';
import { CashState } from './cash-state';
import { IosNav } from '../../shared/ios-nav';
import { NotificationBell } from '../../shared/notification-bell';
import { Sheet } from '../../shared/ui';
import { WorkQueue } from '../../core/api/work-queue';
import { NavHistory } from '../../core/platform/nav-history-service';
import { capsuleLabel, isWorkspaceUrl, screenLabel } from '../../core/platform/return-label';
import { originOf } from './analyses-origin';
import { Skeleton } from '../../shared/skeleton';
import { Fx } from '../../core/api/fx';
import { eurWhole } from '../finance/cash-format';
import { containerName } from '../purchasing/container-name';
import { containerCostRows, containerCostTotals } from '../purchasing/purchase-reconciliation-metrics';
import { purchasePaymentResult } from '../purchasing/purchase-payment-result-metrics';
import { containerPaymentResultTotals } from './container-payment-result-metrics';
import { changeOverMonths } from './market-math';
import type { Months } from './market-math';
import { AnVisitorsRow } from './analyses-visitors-row';
import { LoadError } from '../../shared/load-error';
import { AnHow, HOW_TEXTS } from './analyses-how';
import { AnPeriodPicker, AnPeriodSheet } from './analyses-period-picker';
import { DEFAULT_PERIOD, SALES_PERIOD_KEYS, parsePeriod, periodLabel, periodParams, periodRange, samePeriod, yearStart } from './analyses-period';
import type { PeriodChoice } from './analyses-period';
import { advanceTermsSub, dollarValue, marketLines, openContainersLine, overdueSub, paymentResultLine, plural, rangeLabel, rangeLabelShort, varianceAttention, weekdayDayMonth } from './analyses-words';

type AnalysisSection = 'cash' | 'overview' | 'sales' | 'inventory' | 'purchasing' | 'result' | 'market' | 'website';

const ANALYSIS_TABS: ReadonlyArray<{ id: AnalysisSection; label: string; icon: string; tone: string }> = [
  { id: 'cash', label: 'Kasprognose', icon: 'bank', tone: 'green' },
  { id: 'overview', label: 'Overzicht', icon: 'analytics', tone: 'blue' },
  { id: 'sales', label: 'Verkoop', icon: 'sales', tone: 'rose' },
  { id: 'inventory', label: 'Voorraad', icon: 'stock', tone: 'green' },
  { id: 'purchasing', label: 'Inkoop', icon: 'purchase', tone: 'amber' },
  { id: 'result', label: 'Resultaat', icon: 'exchange', tone: 'purple' },
  { id: 'market', label: 'Markt & container', icon: 'truck', tone: 'blue' },
  { id: 'website', label: 'Bezoekers', icon: 'countries', tone: 'purple' },
];

interface VarianceGroup {
  orderId: number;
  orderNumber: string;
  orderAlias: string | null;
  supplierName: string;
  receivedOn: string | null;
  expectedArrival: string | null;
  missingPieces: number;
  damagedPieces: number;
  totalLossValueEur: number;
  unvaluedLossPieces: number;
  rows: ReceiptVarianceRow[];
}

const EMPTY_REPORT: ReceiptVarianceReport = {
  totals: {
    affectedOrders: 0,
    affectedLines: 0,
    orderedPieces: 0,
    receivedPieces: 0,
    missingPieces: 0,
    overReceivedPieces: 0,
    damagedPieces: 0,
    usablePieces: 0,
    missingValueEur: 0,
    damagedValueEur: 0,
    totalLossValueEur: 0,
    unvaluedLossPieces: 0,
    valuationComplete: true,
  },
  rows: [],
};
/** The tabs that read the page's own load (Markt and Bezoekers load their own data; critique B6). */
const DATA_TABS = new Set<AnalysisSection>(['cash', 'overview', 'sales', 'inventory', 'purchasing', 'result']);

/** Toolbar title and subtitle per tab (design §2.1); Overzicht has no crumb and is called "Analyses". */
const TAB_HEADS: Record<AnalysisSection, { title: string; subtitle: string }> = {
  cash: { title: 'Kasprognose', subtitle: 'Banksaldo vandaag en wat er komt' },
  overview: { title: 'Analyses', subtitle: 'Overzicht · de belangrijkste cijfers per onderdeel' },
  sales: { title: 'Verkoop', subtitle: 'Van offerte tot betaling' },
  inventory: { title: 'Voorraad', subtitle: 'Waarde, tekorten en wat onderweg is' },
  purchasing: { title: 'Inkoop', subtitle: 'Containerkost, kwaliteit, partners en afwijkingen' },
  result: { title: 'Resultaat', subtitle: 'Marge op goederen min eigen kosten' },
  market: { title: 'Markt & container', subtitle: 'Wisselkoersen, koopkracht en containervracht' },
  website: { title: 'Bezoekers', subtitle: 'Wie de website bezoekt en wat ze doen' },
};
const ANALYSES_PARENT = { label: 'Analyses', url: '/analyses/overview' };
/** Tabs whose body is still today's markup: on the phone they get the page inset (each body package removes its tab). */
const LEGACY_BODIES = new Set<AnalysisSection>(['sales', 'inventory', 'purchasing', 'result', 'market', 'website']);
/** The phone ⋯ sheet: the links the desk shows in the tool row. */
const MENU_LINKS: Partial<Record<AnalysisSection, { label: string; url: string; icon: string }[]>> = {
  sales: [{ label: 'Alle verkooporders', url: '/sales', icon: 'sales' }],
  inventory: [{ label: 'Jaarinventaris', url: '/stock/inventaris', icon: 'stock' }],
  purchasing: [{ label: 'Kosten & bank', url: '/costs', icon: 'bank' }],
  result: [{ label: 'Alle kosten', url: '/costs', icon: 'receipt' }],
};
type PageSheet = 'period' | 'how' | 'menu' | null;

/** One "Aandacht" row of Overzicht. */
interface AttentionRow {
  key: string;
  count: number;
  tone: 'warn' | 'danger' | null;
  title: string;
  sub: string;
  value: string | null;
  valueTone: 'danger' | null;
  meta: string | null;
  metaTone: 'danger' | null;
  link: string;
  query: Record<string, string> | null;
}

/** Markt's stored period on this device (market-analysis.ts keeps it), 6 months by default. */
function storedMarketMonths(): Months {
  try {
    const months = (JSON.parse(localStorage.getItem('enrosed.market') ?? '{}') as { months?: number }).months;
    return months === 1 || months === 3 || months === 6 || months === 12 ? months : 6;
  } catch { return 6; }
}
const SALES_PERIOD_NOTE = 'Geldt voor Verkoop en Resultaat. Facturen tellen op hun documentdatum, ontvangsten op hun betaaldatum.';

/** Company-wide analysis with durable receipt losses as its operational drill-down. */
@Component({
  selector: 'app-analyses-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [CashState],
  /* The area's styles stay in this lazy chunk (styles.css is at the 1 MB initial budget); every rule is scoped under the page. */
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../../styles/analyses.scss', '../../../styles/analyses-legacy.scss'],
  host: { '(document:visibilitychange)': 'visible()' },
  imports: [Icon, TrendChart, CashDesk, CashOverviewCard, CashPhone, AnHow, AnPeriodPicker, AnPeriodSheet, AnVisitorsRow, LoadError, IosNav, NotificationBell, NgTemplateOutlet, Sheet, Skeleton,
    FormsModule,
    RouterLink,
    PageHeader,
    DateField,
    DateNlPipe,
    EurPipe,
    NumPipe,
    PctPipe,
    MarketAnalysis, WebsiteAnalytics, ContainerCostAnalysis,
  ],
  template: `
    @if (desk.active()) {
    <app-page-header [title]="head().title" [subtitle]="head().subtitle" [parent]="parent()">
      <button class="btn" type="button" [disabled]="busy()" (click)="refresh()"><app-icon name="refresh" [size]="15" />{{ busy() ? 'Vernieuwen…' : 'Vernieuwen' }}</button>
    </app-page-header>

    <main class="content analyses-page an" [attr.aria-busy]="busy() || filtering()">
      @if (deskTabRow) {
      <nav #analysisNavigation class="analysis-tabs" aria-label="Analyseonderdelen">
        @for (tab of analysisTabs; track tab.id) {
          <a [routerLink]="['/analyses', tab.id]" [class.active]="section() === tab.id"
             [attr.aria-current]="section() === tab.id ? 'page' : null">
            <span class="analysis-tab-icon" [attr.data-tone]="tab.tone"><app-icon [name]="tab.icon" [size]="18" /></span>
            <span>{{ tab.label }}</span>
          </a>
        }
      </nav>
      }
      <!-- 680–1023: the sidebar is a rail without sub-items, so the tabs show as chips (design §2.2). -->
      <nav class="wk-chips an-tabs" aria-label="Analyseonderdelen">
        @for (item of analysisTabs; track item.id) {
          <a class="wk-chip" [class.is-on]="section() === item.id" [routerLink]="['/analyses', item.id]" [replaceUrl]="true"
             [attr.aria-current]="section() === item.id ? 'page' : null">{{ item.label }}</a>
        }
      </nav>

      @for (tab of [section()]; track tab) {
        <div class="an-body mo-fade"><ng-container *ngTemplateOutlet="body; context: { $implicit: tab }" /></div>
      }
    </main>
    } @else if (section() === 'cash') {
      <app-cash-phone [tabs]="analysisTabs" [pageWarnings]="dataWarnings()" [backLabel]="backLabel()" [backAriaLabel]="backAria()"
                      [bellCount]="bellCount()" [bellLabel]="bellLabel()" (back)="goBack()" (bell)="openBell()" (refreshed)="refresh()" />
    } @else {
      <div class="ios-page an an-phone" [attr.aria-busy]="busy() || filtering()">
        <app-ios-nav [title]="head().title" [subtitle]="phoneCaption()" [backLabel]="backLabel()" [backAriaLabel]="backAria()" (back)="goBack()">
          <span trail class="ios-glass-group">
            <button class="ios-circle an-bell" type="button" [attr.aria-label]="bellLabel()" (click)="openBell()">
              <app-icon name="bell" [size]="20" />
              @if (bellCount()) { <span class="an-badge" aria-hidden="true">{{ bellCount() > 9 ? '9+' : bellCount() }}</span> }
            </button>
            <button class="ios-circle" type="button" aria-label="Vernieuwen" [disabled]="busy()" (click)="refresh()"><app-icon name="refresh" [size]="19" /></button>
            <button class="ios-circle" type="button" aria-label="Meer acties" (click)="sheet.set('menu')"><app-icon name="more" [size]="20" /></button>
          </span>
        </app-ios-nav>
        <nav #phoneChips class="ios-chips an-chips" aria-label="Analyseonderdelen">
          @for (item of analysisTabs; track item.id) {
            <a class="ios-chip" [routerLink]="['/analyses', item.id]" [replaceUrl]="true" [attr.aria-pressed]="section() === item.id"
               [attr.aria-current]="section() === item.id ? 'page' : null">{{ item.label }}</a>
          }
        </nav>
        @for (tab of [section()]; track tab) {
          <div class="an-body mo-fade" [class.an-body--legacy]="legacyTab(tab)"><ng-container *ngTemplateOutlet="body; context: { $implicit: tab }" /></div>
        }
      </div>
    }

    <!-- Page level: the bell and the sheets never sit in the sticky nav, the tool row or the faded body (critique B7, N5). -->
    @if (!desk.active()) { <app-notification-bell class="an-bell-host" /> }
    @switch (sheet()) {
      @case ('period') {
        <app-sheet title="Periode" variant="ios" (closed)="sheet.set(null)">
          <app-an-period-sheet body [value]="salesPeriod()" [today]="today()" [note]="salesNote"
                               (picked)="setSalesPeriod($event); sheet.set(null)" (changed)="setSalesPeriod($event)" />
        </app-sheet>
      }
      @case ('how') {
        <app-sheet title="Hoe gerekend" variant="ios" (closed)="sheet.set(null)">
          <div body class="an-sheet-text">@for (line of howLines(); track $index) { <p>{{ line }}</p> }</div>
        </app-sheet>
      }
      @case ('menu') {
        <app-sheet [title]="head().title" variant="ios" (closed)="sheet.set(null)">
          <div body class="ios-group">
            <button class="ios-cell" type="button" (click)="sheet.set('how')"><app-icon name="info" [size]="18" />
              <span class="ios-cell__body"><span class="ios-cell__title">Hoe gerekend</span></span></button>
            @for (link of menuLinks(); track link.url) {
              <a class="ios-cell" [routerLink]="link.url" (click)="sheet.set(null)"><app-icon [name]="link.icon" [size]="18" />
                <span class="ios-cell__body"><span class="ios-cell__title">{{ link.label }}</span></span><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></a>
            }
          </div>
        </app-sheet>
      }
    }

    <ng-template #body let-tab>
      @if (desk.active()) {
      @switch (tab) {
        @case ('overview') {
          <div class="an-bar"><span class="an-bar__text">Dit jaar, {{ yearRangeText() }}@if (loadedAt()) { · bijgewerkt {{ loadedAt() }} }</span>
            <div class="an-bar__end"><app-an-how [lines]="how.overview" /></div></div>
        }
        @case ('sales') {
          <div class="an-bar">
            <app-an-period [value]="salesPeriod()" [today]="today()" [note]="salesNote" idPrefix="an-sales" (changed)="setSalesPeriod($event)" />
            <span class="an-bar__text">{{ salesRangeText() }} · op documentdatum</span>
            <div class="an-bar__end"><app-an-how [lines]="how.sales" /><a class="wk-btn" routerLink="/sales">Verkooporders ›</a></div>
          </div>
        }
        @case ('inventory') {
          <div class="an-bar"><span class="an-bar__text">Momentopname {{ todayText() }}@if (loadedAt()) { {{ loadedAt() }} } · tempo over de facturen van {{ inventoryMetrics().velocity.days }} dagen</span>
            <div class="an-bar__end"><app-an-how [lines]="how.inventory" /><a class="wk-btn" routerLink="/stock/inventaris">Jaarinventaris ›</a></div></div>
        }
        @case ('purchasing') {
          <div class="an-bar"><div class="an-bar__end"><app-an-how [lines]="purchasingHow" /><a class="wk-btn" routerLink="/costs">Kosten &amp; bank ›</a></div></div>
        }
        @case ('result') {
          <div class="an-bar">
            <app-an-period [value]="salesPeriod()" [today]="today()" [note]="salesNote" idPrefix="an-result" (changed)="setSalesPeriod($event)" />
            <span class="an-bar__text">{{ salesRangeText() }} · alles excl. btw</span>
            <div class="an-bar__end"><app-an-how [lines]="how.result" /><a class="wk-btn" routerLink="/costs">Alle kosten ›</a></div>
          </div>
        }
      }
      } @else {
      @switch (tab) {
        @case ('sales') { <ng-container *ngTemplateOutlet="phonePeriod; context: { $implicit: ' · op documentdatum' }" /> }
        @case ('result') { <ng-container *ngTemplateOutlet="phonePeriod; context: { $implicit: ' · alles excl. btw' }" /> }
        @case ('inventory') {
          <div class="an-bar"><span class="an-bar__text">Momentopname {{ todayText() }}@if (loadedAt()) { {{ loadedAt() }} } · tempo over 90 dagen</span></div>
        }
      }
      }
      @if (tab !== 'cash' && dataTab(tab) && dataWarnings().length && !loadFailed()) {
        @if (desk.active()) {
          <div class="wk-banner wk-banner--warn wk-banner--inset" role="status"><app-icon name="alert" [size]="16" />
            <span class="wk-banner__text">Niet alle actuele cijfers konden laden: {{ dataWarnings().join(', ') }}.</span>
            <span class="wk-banner__actions"><button class="wk-btn wk-btn--sm" type="button" [disabled]="busy()" (click)="refresh()">Opnieuw</button></span>
          </div>
        } @else {
          <div class="ios-banner" role="status"><span>Niet alle actuele cijfers konden laden: {{ dataWarnings().join(', ') }}.</span>
            <button class="ios-capsule ios-capsule--sm ios-capsule--tinted" type="button" [disabled]="busy()" (click)="refresh()">Opnieuw</button></div>
        }
      }
      @if (tab !== 'cash' && dataTab(tab) && loadFailed()) {
        <app-load-error [busy]="busy()" (retry)="refresh()" />
      } @else {

      @if (section() === 'cash') {
        <app-cash-desk [pageWarnings]="dataWarnings()" />
      }

      @if (section() === 'overview') {
        <app-cash-overview-card />
        @if (loading()) {
          <div class="an-kpis" aria-label="Cijfers laden">
            @for (n of [1, 2, 3, 4]; track n) { <div class="an-kpi an-kpi--loading"><span></span><span></span><span></span></div> }
          </div>
        } @else {
          @let perf = yearPerformance();
          <div class="an-kpis">
            <div class="an-kpi" data-kpi="perfect">
              <span class="an-kpi__label">Perfect ontvangen</span>
              <span class="an-kpi__value">{{ perf.perfectPct === null ? '—' : (perf.perfectPct | pct: 1) }}</span>
              <span class="an-kpi__sub">dit jaar · {{ perf.perfectOrders }} van {{ plural(perf.comparableOrders, 'vergelijkbare order', 'vergelijkbare orders') }}@if (perf.unknownOrders) { · {{ perf.unknownOrders }} zonder bestelsnapshot }</span>
              <span class="an-kpi__foot">Op tijd {{ perf.onTimePct === null ? '—' : (perf.onTimePct | pct: 0) }} · {{ perf.onTimeOrders }} van {{ plural(perf.datedOrders, 'ontvangst', 'ontvangsten') }}</span>
            </div>
            <div class="an-kpi" data-kpi="incoming">
              <span class="an-kpi__label">Besteld en onderweg</span>
              <span class="an-kpi__value">{{ failed('inkoop') ? '—' : whole(incomingValue()) }}</span>
              <span class="an-kpi__sub">{{ incomingPieces() | num }} st in {{ plural(incomingOrders().length, 'container', 'containers') }} · externe kost</span>
              <span class="an-kpi__foot">{{ orderedCount() }} besteld · {{ sailingCount() }} vertrokken</span>
            </div>
            <div class="an-kpi" data-kpi="stock">
              <span class="an-kpi__label">Voorraadwaarde</span>
              <span class="an-kpi__value">{{ failed('voorraad') ? '—' : whole(inventoryPurchaseValue()) }}</span>
              <span class="an-kpi__sub">{{ inventoryValuedPieces() | num }} st met kost@if (inventoryUnvaluedPieces()) { · {{ inventoryUnvaluedPieces() | num }} zonder kost }@if (inventoryUnknownSkuCount()) { · {{ plural(inventoryUnknownSkuCount(), 'SKU', 'SKU’s') }} zonder betrouwbare stand }</span>
              <span class="an-kpi__foot">Verkoopwaarde {{ whole(inventorySalesValue()) }} · {{ inventoryUplift() === null ? 'kostdekking onvolledig' : signedWhole(inventoryUplift()!) }}</span>
            </div>
            <div class="an-kpi" data-kpi="pipeline">
              <span class="an-kpi__label">Verkooppijplijn</span>
              <span class="an-kpi__value">{{ failed('verkoop') ? '—' : whole(pipelineValue()) }}</span>
              <span class="an-kpi__sub">{{ plural(openSales().length, 'open offerte', 'open offertes') }}@if (pipelineMissingCostLines()) { · {{ plural(pipelineMissingCostLines(), 'productregel', 'productregels') }} zonder kost }</span>
              @if (pipelineMissingCostLines()) {
                <span class="an-kpi__foot is-warn">Brutomarge — · nog niet alle kosten bekend</span>
              } @else {
                <span class="an-kpi__foot">Brutomarge {{ whole(pipelineMargin()) }} · {{ pipelineMarginPct() === null ? 'marge onbekend zonder goederenwaarde' : (pipelineMarginPct() | pct: 1) + ' op goederen' }}</span>
              }
            </div>
          </div>
        }
        <div class="an-cols">
          <div class="an-col">
            <section class="an-card" aria-labelledby="an-ov-parts">
              <header class="an-card__head"><h2 class="an-card__title" id="an-ov-parts">Per onderdeel</h2><span class="an-card__trail">dit jaar</span></header>
              <div class="an-card__body">
                @if (loading()) { <app-skeleton class="an-skeleton" [kind]="desk.active() ? 'list' : 'group'" [rows]="4" /> } @else {
                  @let ys = ytdSales();
                  <a class="an-row an-row--chev an-row--icons" routerLink="/analyses/sales">
                    <span class="an-tile tone-accent"><app-icon name="sales" [size]="17" /></span>
                    <span class="an-row__body"><span class="an-row__title">Verkoop</span>
                      <span class="an-row__sub">Omzet excl. btw · {{ plural(ys.invoices.issued, 'factuur', 'facturen') }}</span>
                      <span class="an-row__sub">{{ whole(ys.invoices.issuedValueEur) }} gefactureerd incl. btw</span></span>
                    <span class="an-row__end"><span class="an-row__value">{{ failed('verkoop') ? '—' : whole(ys.invoices.revenueExclEur) }}</span>
                      <span class="an-row__meta" [attr.data-tone]="ys.invoices.marginEur < 0 ? 'warn' : null">marge {{ ys.invoices.missingCostLines ? '—' : whole(ys.invoices.marginEur) }}</span></span>
                    <span class="an-row__chev" aria-hidden="true">›</span>
                  </a>
                  @let yr = ytdResult();
                  <a class="an-row an-row--chev an-row--icons" routerLink="/analyses/result">
                    <span class="an-tile tone-plum"><app-icon name="receipt" [size]="17" /></span>
                    <span class="an-row__body"><span class="an-row__title">Resultaat</span>
                      <span class="an-row__sub">Marge op goederen min eigen kosten ({{ whole(yr.costsEur) }})</span></span>
                    <span class="an-row__end"><span class="an-row__value" [attr.data-tone]="yr.resultEur < 0 ? 'danger' : null">{{ failed('verkoop') ? '—' : whole(yr.resultEur) }}</span>
                      <span class="an-row__meta">excl. btw</span></span>
                    <span class="an-row__chev" aria-hidden="true">›</span>
                  </a>
                  @let inv = inventoryMetrics();
                  <a class="an-row an-row--chev an-row--icons" routerLink="/analyses/inventory">
                    <span class="an-tile tone-green"><app-icon name="stock" [size]="17" /></span>
                    <span class="an-row__body"><span class="an-row__title">Voorraad</span>
                      <span class="an-row__sub">{{ inv.stock.knownPieces | num }} st</span>
                      <span class="an-row__sub">{{ plural(inv.zeroStock.withoutIncomingCount, 'product', 'producten') }} op nul zonder aanvulling</span></span>
                    <span class="an-row__end"><span class="an-row__value">{{ failed('voorraad') ? '—' : whole(inv.stock.costValueEur) }}</span>
                      <span class="an-row__meta">kostwaarde</span></span>
                    <span class="an-row__chev" aria-hidden="true">›</span>
                  </a>
                  @let cd = containerDigest();
                  <a class="an-row an-row--chev an-row--icons" routerLink="/analyses/purchasing">
                    <span class="an-tile tone-amber"><app-icon name="purchase" [size]="17" /></span>
                    <span class="an-row__body"><span class="an-row__title">Inkoop</span>
                      <span class="an-row__sub">{{ openContainersLine(cd.count) }}</span>
                      @if (paymentResultLine(cd.payment.netResultEur, cd.payment.eligibleCount); as line) { <span class="an-row__sub">{{ line }}</span> }</span>
                    <span class="an-row__end"><span class="an-row__value">{{ failed('inkoop') ? '—' : whole(cd.totals.remainingEur) }}</span>
                      <span class="an-row__meta">{{ cd.totals.provisionalCount }} nog voorlopig</span></span>
                    <span class="an-row__chev" aria-hidden="true">›</span>
                  </a>
                  <a class="an-row an-row--chev an-row--icons" routerLink="/analyses/market">
                    <span class="an-tile tone-teal"><app-icon name="layers" [size]="17" /></span>
                    <span class="an-row__body"><span class="an-row__title">Markt &amp; container</span>
                      @if (marketDigest(); as m) {
                        <span class="an-row__sub">{{ m.lines[0] }}</span>
                        @if (m.lines[1]) { <span class="an-row__sub">{{ m.lines[1] }}</span> }
                      } @else { <span class="an-row__sub">{{ fx.failed() ? 'Koersen niet beschikbaar' : 'Koersen laden…' }}</span> }</span>
                    <span class="an-row__end"><span class="an-row__value">{{ marketDigest()?.dollar ?? '—' }}</span>
                      <span class="an-row__meta">voor € 1</span></span>
                    <span class="an-row__chev" aria-hidden="true">›</span>
                  </a>
                  @defer (on viewport) {
                    <a class="an-row an-row--chev an-row--icons" routerLink="/analyses/website" appAnVisitorsRow></a>
                  } @placeholder {
                    <a class="an-row an-row--chev an-row--icons" routerLink="/analyses/website">
                      <span class="an-tile tone-blue"><app-icon name="globe" [size]="17" /></span>
                      <span class="an-row__body"><span class="an-row__title">Bezoekers</span><span class="an-row__sub">Laatste 30 dagen</span></span>
                      <span class="an-row__end"><span class="an-row__value">—</span></span><span class="an-row__chev" aria-hidden="true">›</span>
                    </a>
                  }
                }
              </div>
            </section>
          </div>
          <div class="an-col">
            <section class="an-card" aria-labelledby="an-ov-attn">
              <header class="an-card__head"><h2 class="an-card__title" id="an-ov-attn">Aandacht</h2>
                @if (!loading()) { <span class="an-card__trail">{{ plural(attentionCount(), 'punt', 'punten') }}</span> }</header>
              <div class="an-card__body">
                @if (loading()) { <app-skeleton class="an-skeleton" [kind]="desk.active() ? 'list' : 'group'" [rows]="4" /> } @else {
                  @for (row of attention(); track row.key) {
                    <a class="an-row an-row--chev" [class.is-muted]="row.count === 0" [routerLink]="row.link" [queryParams]="row.query">
                      <span class="an-count" [class.is-zero]="row.count === 0" [attr.data-tone]="row.count ? row.tone : null">{{ row.count | num }}</span>
                      <span class="an-row__body"><span class="an-row__title">{{ row.title }}</span><span class="an-row__sub">{{ row.sub }}</span></span>
                      <span class="an-row__end">
                        @if (row.value !== null) { <span class="an-row__value" [attr.data-tone]="row.valueTone">{{ row.value }}</span> }
                        @if (row.meta) { <span class="an-row__meta" [attr.data-tone]="row.metaTone">{{ row.meta }}</span> }
                      </span>
                      <span class="an-row__chev" aria-hidden="true">›</span>
                    </a>
                  }
                }
              </div>
            </section>
          </div>
        </div>
      }

      @if (section() === 'sales') {
      <section class="analysis-section" aria-labelledby="sales-analysis-title">
        <header class="section-copy">
          <span class="eyebrow">Verkoopanalyse</span>
          <h2 id="sales-analysis-title">Van offerte tot betaling</h2>
        </header>

        <div class="analysis-kpis analysis-kpis--flow">
          <article class="card metric-card metric-card--dark">
            <span class="metric-card__label">Gefactureerd</span>
            <strong>{{ salesMetrics().invoices.issuedValueEur | eur: 0 }}</strong>
            <p>{{ salesMetrics().invoices.issued }} factuur/facturen incl. btw
              @if (salesMetrics().invoices.averageClaimEur !== null) { · gem. {{ salesMetrics().invoices.averageClaimEur | eur: 0 }} }
              @if (salesMetrics().invoices.creditNoteCount) { · waarvan gecrediteerd − {{ salesMetrics().invoices.creditedEur | eur: 0 }} ({{ salesMetrics().invoices.creditNoteCount }} {{ salesMetrics().invoices.creditNoteCount === 1 ? 'creditnota' : 'creditnota\u2019s' }}) }</p>
          </article>
          <article class="card metric-card metric-card--quality">
            <span class="metric-card__label">Brutomarge</span>
            <strong>{{ salesMetrics().invoices.missingCostLines ? '—' : (salesMetrics().invoices.marginEur | eur: 0) }}</strong>
            <p>{{ salesMetrics().invoices.missingCostLines
              ? salesMetrics().invoices.missingCostLines + ' factuurregel(s) zonder kost'
              : salesMetrics().invoices.marginPct === null ? 'op uitgegeven facturen' : (salesMetrics().invoices.marginPct | pct: 1) + ' op goederen' }}</p>
          </article>
          <article class="card metric-card">
            <span class="metric-card__label">Reguliere verkooppijplijn</span>
            <strong>{{ salesMetrics().pipeline.calculatedValueEur | eur: 0 }}</strong>
            <p>{{ salesMetrics().pipeline.count }} offerte(s) · {{ salesMetrics().pipeline.pieces | num }} stuks</p>
          </article>
          <article class="card metric-card">
            <span class="metric-card__label">Geaccepteerd</span>
            <strong>{{ salesMetrics().accepted.calculatedValueEur | eur: 0 }}</strong>
            <p>{{ salesMetrics().accepted.count }} offerte(s) in deze periode</p>
          </article>
          <article class="card metric-card">
            <span class="metric-card__label">Open facturen</span>
            <strong>{{ salesMetrics().invoices.outstandingValueEur | eur: 0 }}</strong>
            <p>{{ salesMetrics().invoices.outstanding }} factuur/facturen
              @if (salesMetrics().invoices.avgDaysToPaid !== null) { · betaald na gem. {{ salesMetrics().invoices.avgDaysToPaid }} dagen }</p>
          </article>
          <article class="card metric-card" [class.metric-card--danger]="salesMetrics().invoices.overdue > 0">
            <span class="metric-card__label">Vervallen</span>
            <strong>{{ salesMetrics().invoices.overdueValueEur | eur: 0 }}</strong>
            <p>{{ salesMetrics().invoices.overdue }} factuur/facturen na vervaldatum</p>
          </article>
          <a class="card metric-card" routerLink="/costs" [queryParams]="{ view: 'incoming', tab: 'received', from: salesFromDate() || null, to: salesToDate() || null, period: salesFromDate() || salesToDate() ? null : 'all' }"><span class="metric-card__label">Ontvangen in deze periode</span><strong>{{ incoming().receivedEur | eur: 0 }}</strong><p>{{ incoming().count }} echte betalingen op ontvangstdatum · incl. btw</p></a>
          <a class="card metric-card" routerLink="/costs" [queryParams]="{ view: 'incoming', tab: 'received', from: salesFromDate() || null, to: salesToDate() || null, period: salesFromDate() || salesToDate() ? null : 'all' }"><span class="metric-card__label">Partnervoorschotten ontvangen</span><strong>{{ incoming().partnerAdvanceEur | eur: 0 }}</strong><p>financiering · {{ incoming().partnerSettlementEur | eur: 0 }} daarnaast uit afrekeningen</p></a>
        </div>

        <article class="card funnel-card" aria-label="Offertefunnel">
          <header class="funnel-card__head">
            <div><span>Offertes</span><h3>Van aangemaakt tot geaccepteerd</h3></div>
            <small>{{ salesMetrics().funnel.created }} aangemaakt · {{ salesMetrics().funnel.closed }} gesloten · {{ salesMetrics().funnel.created - salesMetrics().funnel.closed }} nog open</small>
          </header>
          @for (step of funnelSteps(); track step.key) {
            <div class="funnel-row" [class.funnel-row--accent]="step.accent">
              <div class="funnel-row__label"><b>{{ step.label }}</b><small>{{ step.rate }}</small></div>
              <div class="funnel-row__track"><i [style.width.%]="step.width"></i></div>
              <b class="funnel-row__count">{{ step.count | num }}</b>
            </div>
          }
          <footer class="funnel-card__foot">
            <span>Afgewezen <b>{{ salesMetrics().funnel.rejected }}</b></span>
            <span>Verlopen <b>{{ salesMetrics().funnel.expired }}</b></span>
            <span>Conversie <b>{{ salesMetrics().funnel.conversionRatePct === null ? '—' : (salesMetrics().funnel.conversionRatePct | pct: 0) }}</b> van de gesloten offertes</span>
          </footer>
        </article>

        <article class="card analysis-list trend-card">
          <header><div><span>Verloop</span><h3>Gefactureerd per maand</h3></div><small>incl. btw · geaccepteerde offertes als referentie</small></header>
          <div class="trend-card__body">
            <app-trend-chart [series]="salesTrend()" prefix="€ " [decimals]="0" [height]="190"
                             ariaLabel="Gefactureerd per maand" emptyText="Nog geen facturen of geaccepteerde offertes in deze periode" />
          </div>
        </article>

        <article class="card analysis-list channel-card">
          <header><div><span>Kanalen</span><h3>Omzet per verkoopkanaal</h3></div><small>uitgegeven facturen · excl. btw</small></header>
          @for (channel of salesMetrics().channels; track channel.channel) {
            <div class="channel-row">
              <div><b>{{ channelLabel(channel.channel) }}</b><small>{{ channel.invoiceCount }} factuur/facturen · marge {{ channel.marginEur | eur: 0 }}</small></div>
              <span class="channel-row__bar"><i [style.width.%]="channel.sharePct"></i></span>
              <strong>{{ channel.revenueExclEur | eur: 0 }}</strong>
              <small>{{ channel.sharePct | pct: 0 }}</small>
            </div>
          } @empty { <p class="list-empty">Geen uitgegeven facturen in deze periode.</p> }
        </article>

        <div class="analysis-columns analysis-columns--three">
          <article class="card analysis-list">
            <header><div><span>Landen</span><h3>Gefactureerd per land</h3></div><small>betalingsvorderingen · incl. btw</small></header>
            @for (country of salesMetrics().topCountries; track country.countryCode ?? 'none') {
              <div class="rank-row">
                <span class="rank">{{ $index + 1 }}</span>
                <div><b>{{ countryLabel(country.countryCode) }}</b><small>{{ country.orderCount }} factuur/facturen</small></div>
                <strong>{{ country.calculatedValueEur | eur: 0 }}</strong>
              </div>
            } @empty { <p class="list-empty">Geen uitgegeven facturen in deze periode.</p> }
          </article>
          <article class="card analysis-list">
            <header><div><span>Klanten</span><h3>Hoogste factuurwaarde</h3></div><small>incl. btw</small></header>
            @for (customer of salesMetrics().topCustomers; track customer.customerId ?? customer.name) {
              <div class="rank-row">
                <span class="rank">{{ $index + 1 }}</span>
                <div><b>{{ customer.name }}</b><small>{{ customer.orderCount }} factuur/facturen · {{ customer.pieces | num }} stuks</small></div>
                <strong>{{ customer.calculatedValueEur | eur: 0 }}</strong>
              </div>
            } @empty { <p class="list-empty">Geen uitgegeven facturen in deze periode.</p> }
          </article>
          <article class="card analysis-list">
            <header><div><span>Producten</span><h3>Hoogste goederenwaarde</h3></div><small>excl. vracht en btw</small></header>
            @for (product of salesMetrics().topProducts; track product.productId) {
              <a class="rank-row" [routerLink]="['/products', product.productId]">
                <span class="rank">{{ $index + 1 }}</span>
                <div><b>{{ product.name }}</b><small>{{ product.sku || 'Geen SKU' }} · {{ product.pieces | num }} stuks</small></div>
                <strong>{{ product.calculatedGoodsValueEur | eur: 0 }}</strong>
              </a>
            } @empty { <p class="list-empty">Geen uitgegeven factuurregels in deze periode.</p> }
          </article>
        </div>

        <article class="card analysis-list attention-list">
          <header><div><span>Opvolgen</span><h3>Verkooporders die aandacht vragen</h3></div><small>{{ salesMetrics().attentionOrders.length }} zichtbaar</small></header>
          @for (order of salesMetrics().attentionOrders; track order.orderId) {
            <a class="attention-row" [class.attention-row--danger]="order.severity === 'danger'"
               [routerLink]="['/sales', order.orderId]">
              <div><b>{{ order.number }}</b><small>{{ order.customerName }} · {{ order.orderDate | dateNl }}</small></div>
              <div class="reason-chips">@for (reason of order.reasons; track reason) { <span>{{ attentionReason(reason) }}</span> }</div>
              <strong>{{ order.calculatedValueEur | eur: 0 }}</strong>
            </a>
          } @empty { <p class="list-empty">Geen verkooporders vragen nu aandacht.</p> }
        </article>
      </section>
      }

      @if (section() === 'inventory') {
      <section class="analysis-section" aria-labelledby="inventory-analysis-title">
        <header class="section-copy">
          <span class="eyebrow">Voorraadanalyse</span>
          <h2 id="inventory-analysis-title">Waarde, tekorten en wat onderweg is</h2>
          <p>Een actuele momentopname uit de productkaart en open inkooporders; het tempo komt van de facturen van de laatste {{ inventoryMetrics().velocity.days }} dagen.</p>
        </header>

        <div class="analysis-kpis analysis-kpis--flow">
          <article class="card metric-card metric-card--dark">
            <span class="metric-card__label">Kostwaarde voorraad</span>
            <strong>{{ inventoryMetrics().stock.costValueEur | eur: 0 }}</strong>
            <p>{{ inventoryMetrics().stock.valuedPieces | num }} gewaardeerde stuks</p>
            <p>Bevat de Enrosed kost. Voor de boekhouding: <a routerLink="/stock/inventaris" style="color:inherit;font-weight:700;white-space:nowrap">Jaarinventaris ›</a></p>
          </article>
          <article class="card metric-card">
            <span class="metric-card__label">Eigen voorraadwaarde</span>
            <strong>{{ inventoryMetrics().stock.ownCostValueEur | eur: 0 }}</strong>
            <p>@if (inventoryMetrics().stock.partnerPieces) { daarnaast ligt hier {{ inventoryMetrics().stock.partnerCostValueEur | eur: 0 }} voor een partner: {{ inventoryMetrics().stock.partnerPieces | num }} stuks al gefactureerd, nog te verzenden } @else { niets van de voorraad is al aan een partner gefactureerd }</p>
          </article>
          <article class="card metric-card">
            <span class="metric-card__label">Verkoopwaarde</span>
            <strong>{{ inventoryMetrics().stock.salesValueEur | eur: 0 }}</strong>
            <p>{{ inventoryMetrics().stock.saleablePieces | num }} actieve verkoopbare stuks</p>
          </article>
          <article class="card metric-card">
            <span class="metric-card__label">Bekende voorraad</span>
            <strong>{{ inventoryMetrics().stock.knownPieces | num }} st</strong>
            <p>{{ inventoryMetrics().stock.knownSkuCount }} SKU's · {{ inventoryMetrics().stock.unknownSkuCount }} onbekend</p>
          </article>
          <article class="card metric-card metric-card--quality">
            <span class="metric-card__label">Onderweg</span>
            <strong>{{ inventoryMetrics().incoming.pieces | num }} st</strong>
            <p>{{ inventoryMetrics().incoming.skuCount }} SKU's · eerst verwacht {{ inventoryMetrics().incoming.nextArrival | dateNl }}</p>
          </article>
          <article class="card metric-card">
            <span class="metric-card__label">Verkooptempo</span>
            <strong>{{ inventoryMetrics().velocity.weeklyPieces | num }}</strong>
            <p>stuks per week · {{ inventoryMetrics().velocity.piecesSold | num }} gefactureerd in {{ inventoryMetrics().velocity.days }} dagen over {{ inventoryMetrics().velocity.skuCount }} SKU's</p>
          </article>
          <article class="card metric-card" [class.metric-card--danger]="inventoryMetrics().reorder.count > 0">
            <span class="metric-card__label">Snel bestellen</span>
            <strong>{{ inventoryMetrics().reorder.count }} {{ inventoryMetrics().reorder.count === 1 ? 'SKU' : 'SKU’s' }}</strong>
            <p>Binnen {{ inventoryMetrics().reorder.horizonWeeks }} weken op, ook met wat onderweg is</p>
          </article>
        </div>

        <div class="data-gap-strip" role="status">
          <span><b>{{ inventoryMetrics().dataGaps.unknownStockSkuCount }}</b> voorraad onbekend</span>
          <span><b>{{ inventoryMetrics().dataGaps.unvaluedStockSkuCount }}</b> zonder kostwaarde</span>
          <span><b>{{ inventoryMetrics().dataGaps.missingCartonSkuCount }}</b> zonder outer carton</span>
          <span><b>{{ inventoryMetrics().dataGaps.negativeStockSkuCount }}</b> negatief</span>
        </div>

        <div class="analysis-columns">
          <article class="card analysis-list">
            <header><div><span>Direct controleren</span><h3>Nulvoorraad</h3></div><small>{{ inventoryMetrics().zeroStock.withoutIncomingCount }} zonder aanvulling</small></header>
            @for (row of inventoryMetrics().zeroStock.rows; track row.productId) {
              <a class="stock-row" [routerLink]="['/products', row.productId]">
                <div><b>{{ row.name }}</b><small>{{ row.sku || 'Geen SKU' }}@if (row.colour) { · {{ row.colour }} }</small></div>
                <span [class.ok-text]="row.expectedPieces > 0">{{ row.expectedPieces > 0 ? (row.expectedPieces | num) + ' onderweg' : 'Geen inkoop onderweg' }}</span>
              </a>
            } @empty { <p class="list-empty">Geen actieve producten met nulvoorraad.</p> }
          </article>
          <article class="card analysis-list">
            <header><div><span>Verpakking</span><h3>Minder dan één outer carton</h3></div><small>{{ inventoryMetrics().belowCarton.count }} SKU's</small></header>
            @for (row of inventoryMetrics().belowCarton.rows; track row.productId) {
              <a class="stock-row" [routerLink]="['/products', row.productId]">
                <div><b>{{ row.name }}</b><small>{{ row.sku || 'Geen SKU' }} · {{ row.stockPieces | num }} op voorraad</small></div>
                <span>{{ row.missingPiecesToCarton | num }} nodig voor carton</span>
              </a>
            } @empty { <p class="list-empty">Alle bekende positieve voorraden vullen minstens één outer carton.</p> }
          </article>
        </div>

        <div class="analysis-columns">
          <article class="card analysis-list">
            <header><div><span>Bestellen</span><h3>Raakt binnenkort op</h3></div><small>op het tempo van {{ inventoryMetrics().velocity.days }} dagen</small></header>
            @for (row of inventoryMetrics().reorder.rows; track row.productId) {
              <a class="stock-row" [routerLink]="['/products', row.productId]">
                <div><b>{{ row.name }}</b><small>{{ row.sku || 'Geen SKU' }}@if (row.colour) { · {{ row.colour }} } · {{ row.stockPieces | num }} op voorraad@if (row.expectedPieces) { · {{ row.expectedPieces | num }} onderweg } · {{ row.weeklyPieces }} st/week</small></div>
                <span [class.ok-text]="(row.weeksLeftWithIncoming ?? 0) >= 4">{{ weeksLabel(row.weeksLeftWithIncoming) }}</span>
              </a>
            } @empty { <p class="list-empty">Niets raakt binnen {{ inventoryMetrics().reorder.horizonWeeks }} weken op, of er werd nog niets gefactureerd.</p> }
          </article>
          <article class="card analysis-list">
            <header><div><span>Stilstaand</span><h3>Trage verkopers</h3></div><small>{{ inventoryMetrics().slowMovers.valueEur | eur: 0 }} in {{ inventoryMetrics().slowMovers.count }} SKU's</small></header>
            @for (row of inventoryMetrics().slowMovers.rows; track row.productId) {
              <a class="stock-row" [routerLink]="['/products', row.productId]">
                <div><b>{{ row.name }}</b><small>{{ row.sku || 'Geen SKU' }}@if (row.colour) { · {{ row.colour }} } · {{ row.stockPieces | num }} stuks zonder verkoop</small></div>
                <span class="capital-text">{{ row.costValueEur | eur: 0 }}</span>
              </a>
            } @empty { <p class="list-empty">Elke gewaardeerde voorraadpositie verkocht in de laatste {{ inventoryMetrics().velocity.days }} dagen.</p> }
          </article>
        </div>

        <article class="card analysis-list capital-list">
          <header><div><span>Kapitaal</span><h3>Grootste voorraadposities</h3></div><small>op bekende kostwaarde</small></header>
          @for (row of inventoryMetrics().topCapital; track row.productId) {
            <a class="capital-row" [routerLink]="['/products', row.productId]">
              <span class="capital-row__bar"><i [style.width.%]="row.sharePct"></i></span>
              <div><b>{{ row.name }}</b><small>{{ row.sku || 'Geen SKU' }}@if (row.colour) { · {{ row.colour }} } · {{ row.stockPieces | num }} stuks</small></div>
              <strong>{{ row.costValueEur | eur: 0 }}</strong>
              <small>{{ row.sharePct | pct: 1 }}</small>
            </a>
          } @empty { <p class="list-empty">Nog geen actuele voorraad met kostwaarde.</p> }
        </article>
      </section>
      }

      @if (section() === 'result') {
      <section class="analysis-section" aria-labelledby="result-analysis-title">
        <header class="section-copy section-copy--split">
          <div>
            <span class="eyebrow">Resultaat</span>
            <h2 id="result-analysis-title">Wat we overhouden</h2>
            <p>De marge op de goederen van de uitgegeven facturen, min de kosten die we zelf maakten. Verkoop telt op de factuurdatum, kosten op hun datum; alles excl. btw.</p>
          </div>
        </header>
        <div class="analysis-kpis analysis-kpis--flow">
          <article class="card metric-card metric-card--dark"><span class="metric-card__label">Omzet</span><strong>{{ result().revenueEur | eur: 0 }}</strong><p>{{ result().invoiceCount }} uitgegeven factuur/facturen · excl. btw</p></article>
          <article class="card metric-card metric-card--quality"><span class="metric-card__label">Marge op goederen</span><strong>{{ result().marginEur | eur: 0 }}</strong><p>{{ result().marginPct === null ? 'kost van de goederen ' + (result().goodsCostEur | eur: 0) : (result().marginPct | pct: 1) + ' · goederen kostten ' + (result().goodsCostEur | eur: 0) }}@if (result().missingCostLines) { · {{ result().missingCostLines }} regel(s) zonder kost }</p></article>
          <article class="card metric-card"><span class="metric-card__label">Eigen kosten</span><strong>{{ result().costsEur | eur: 0 }}</strong><p>@if (result().depreciationEur > 0) { waarvan {{ result().depreciationEur | eur: 0 }} afschrijvingen · }@if (result().unpaidCostsEur) { {{ result().unpaidCostsEur | eur: 0 }} nog te betalen incl. btw } @else { alles betaald }</p></article>
          <article class="card metric-card" [class.metric-card--danger]="result().resultEur < 0"><span class="metric-card__label">Resultaat</span><strong>{{ result().resultEur | eur: 0 }}</strong><p>marge min eigen kosten</p></article>
          <article class="card metric-card"><span class="metric-card__label">Ingekocht</span><strong>{{ result().purchasedEur | eur: 0 }}</strong><p>{{ result().receivedContainers }} container(s) ontvangen, externe kost volgens actuele afrekening</p></article>
        </div>
        <div class="analysis-columns">
          <article class="card analysis-list scorecard-card">
            <header><div><span>Kanalen</span><h3>Per verkoopkanaal</h3></div><small>omzet, marge en de kosten die erbij horen</small></header>
            @if (result().byChannel.length) {
              <div class="scorecard-scroll">
                <table class="scorecard">
                  <thead><tr><th>Kanaal</th><th>Facturen</th><th>Omzet</th><th>Marge</th><th>Kosten</th><th>Resultaat</th></tr></thead>
                  <tbody>
                    @for (row of result().byChannel; track row.channel) {
                      <tr>
                        <td data-label="Kanaal">{{ channelLabel(row.channel) }}</td>
                        <td data-label="Facturen">{{ row.invoiceCount }}</td>
                        <td data-label="Omzet">{{ row.revenueEur | eur: 0 }}</td>
                        <td data-label="Marge">{{ row.marginEur | eur: 0 }}</td>
                        <td data-label="Kosten">{{ row.costsEur ? (row.costsEur | eur: 0) : '—' }}</td>
                        <td data-label="Resultaat" [class.scorecard__warn]="row.resultEur < 0">{{ row.resultEur | eur: 0 }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else { <p class="list-empty">Nog geen facturen of kanaalkosten in deze periode.</p> }
          </article>
          <article class="card analysis-list">
            <header><div><span>Kosten</span><h3>Per categorie</h3></div><small><a routerLink="/costs">alle kosten ›</a></small></header>
            @for (row of result().byCategory; track row.category) {
              <div class="channel-row">
                <div><b>{{ categoryLabel(row.category) }}</b></div>
                <span class="channel-row__bar"><i [style.width.%]="row.sharePct"></i></span>
                <strong>{{ row.amountEur | eur: 0 }}</strong>
                <small>{{ row.sharePct | pct: 0 }}</small>
              </div>
            } @empty { <p class="list-empty">Nog geen kosten geboekt in deze periode.</p> }
          </article>
        </div>
        <article class="card analysis-list scorecard-card">
          <header><div><span>Verloop</span><h3>Per maand</h3></div><small>oudste maand eerst</small></header>
          @if (result().monthly.length) {
            <div class="scorecard-scroll">
              <table class="scorecard">
                <thead><tr><th>Maand</th><th>Omzet</th><th>Marge</th><th>Eigen kosten</th><th>Resultaat</th></tr></thead>
                <tbody>
                  @for (row of result().monthly; track row.month) {
                    <tr>
                      <td data-label="Maand">{{ row.month }}</td>
                      <td data-label="Omzet">{{ row.revenueEur | eur: 0 }}</td>
                      <td data-label="Marge">{{ row.marginEur | eur: 0 }}</td>
                      <td data-label="Eigen kosten">{{ row.costsEur | eur: 0 }}</td>
                      <td data-label="Resultaat" [class.scorecard__warn]="row.resultEur < 0">{{ row.resultEur | eur: 0 }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else { <p class="list-empty">Nog niets in deze periode.</p> }
        </article>
      </section>
      }

      @if (section() === 'market') {
        <app-market-analysis />
      }

      @if (section() === 'website') {
        <app-website-analytics />
      }

      @if (section() === 'purchasing') {
      <app-container-cost-analysis [purchases]="purchases()" [loading]="loading()" />
      <section class="analysis-section purchase-summary" aria-labelledby="purchase-summary-title">
        <header class="section-copy">
          <span class="eyebrow">Inkoopanalyse</span>
          <h2 id="purchase-summary-title">Onderweg en ontvangen kwaliteit</h2>
          <p>Actuele containerwaarde plus blijvend geregistreerde tekorten en schade.</p>
        </header>
        <div class="analysis-kpis analysis-kpis--flow">
          <article class="card metric-card metric-card--dark"><span class="metric-card__label">Inkoop onderweg</span><strong>{{ incomingValue() | eur: 0 }}</strong><p>{{ incomingPieces() | num }} stuks in {{ incomingOrders().length }} order(s)</p></article>
          <article class="card metric-card metric-card--quality"><span class="metric-card__label">Perfect ontvangen</span><strong>{{ supplierPerformance().perfectPct === null ? '—' : (supplierPerformance().perfectPct | pct: 1) }}</strong><p>{{ supplierPerformance().perfectOrders }} van {{ supplierPerformance().comparableOrders }} vergelijkbare orders</p></article>
          <article class="card metric-card"><span class="metric-card__label">Op tijd</span><strong>{{ supplierPerformance().onTimePct === null ? '—' : (supplierPerformance().onTimePct | pct: 0) }}</strong><p>{{ supplierPerformance().onTimeOrders }} van {{ supplierPerformance().datedOrders }} ontvangsten tegen de laatst opgeslagen ETA</p></article>
          <article class="card metric-card"><span class="metric-card__label">Doorlooptijd</span><strong>{{ leadDays() === null ? '—' : leadDays() + ' dagen' }}</strong><p>Van bestelling tot ontvangst, gemiddeld over de gefilterde orders</p></article>
          <article class="card metric-card"><span class="metric-card__label">Bekende verliesimpact</span><strong>{{ report().totals.totalLossValueEur | eur: 0 }}</strong><p>{{ report().totals.missingPieces + report().totals.damagedPieces | num }} afwijkende stuks</p></article>
          <article class="card metric-card"><span class="metric-card__label">Zonder waarde</span><strong>{{ report().totals.unvaluedLossPieces | num }} st</strong><p>Vul de ontvangstwaarde in om de impact compleet te maken</p></article>
        </div>

        <article class="card analysis-list scorecard-card">
          <header><div><span>Leveranciers</span><h3>Scorekaart per leverancier</h3></div><small>ontvangen orders in de gekozen periode</small></header>
          @if (supplierCards().length) {
            <div class="scorecard-scroll">
              <table class="scorecard">
                <thead><tr><th>Leverancier</th><th>Orders</th><th>Waarde</th><th>Perfect</th><th>Op tijd</th><th>Doorlooptijd</th><th>Laatste ontvangst</th></tr></thead>
                <tbody>
                  @for (card of supplierCards(); track card.supplierId) {
                    <tr>
                      <td data-label="Leverancier"><a [routerLink]="['/suppliers', card.supplierId]">{{ card.name }}</a></td>
                      <td data-label="Orders">{{ card.orders }}</td>
                      <td data-label="Waarde">{{ card.totalEur | eur: 0 }}</td>
                      <td data-label="Perfect" [class.scorecard__warn]="card.perfectPct !== null && card.perfectPct < 80">{{ card.perfectPct === null ? '—' : (card.perfectPct | pct: 0) }}</td>
                      <td data-label="Op tijd" [class.scorecard__warn]="card.onTimePct !== null && card.onTimePct < 80">{{ card.onTimePct === null ? '—' : (card.onTimePct | pct: 0) }}</td>
                      <td data-label="Doorlooptijd">{{ card.avgLeadDays === null ? '—' : card.avgLeadDays + ' d' }}</td>
                      <td data-label="Laatste ontvangst">{{ card.latestReceivedOn | dateNl }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="list-empty">Nog geen ontvangen orders in deze periode.</p>
          }
        </article>

        <header class="section-copy section-copy--sub">
          <span class="eyebrow">Partnercontainers</span>
          <h2>Zelf betaald of met een partner</h2>
          <p>De partner financiert de afgesproken kosten vooraf of samen met ons. Elke termijn krijgt een eigen voorschotfactuur. Het resultaat volgt uit uitgegeven deel- en slotafrekeningen, naar de werkelijk afgerekende hoeveelheden.</p>
        </header>
        <div class="analysis-kpis analysis-kpis--flow">
          <article class="card metric-card metric-card--dark"><span class="metric-card__label">Kosten partnercontainers</span><strong>{{ financing().partner.landedEur | eur: 0 }}</strong><p>{{ financing().partner.count }} containers · werkelijke kosten en nog open verplichtingen</p></article>
          <article class="card metric-card"><span class="metric-card__label">Afgesproken voorfinanciering</span><strong>{{ financing().committedAdvanceEur | eur: 0 }}</strong><p>{{ financing().invoicedEur | eur: 0 }} voorschot gefactureerd · excl. btw</p></article>
          <article class="card metric-card" [class.metric-card--danger]="financing().overdueUnbilledAdvanceEur > 0"><span class="metric-card__label">Voorschotten nog factureren</span><strong>{{ financing().unbilledAdvanceEur | eur: 0 }}</strong><p>{{ financing().unbilledAdvanceCount }} geplande termijnen · excl. btw@if (financing().overdueUnbilledAdvanceEur > 0) { · {{ financing().overdueUnbilledAdvanceEur | eur: 0 }} met vervaldatum bereikt }</p></article>
          <article class="card metric-card"><span class="metric-card__label">Netto van partners ontvangen</span><strong>{{ financing().receivedEur | eur: 0 }}</strong><p>ontvangsten min terugbetalingen · incl. btw</p></article>
          <article class="card metric-card"><span class="metric-card__label">Nog te ontvangen</span><strong>{{ financing().openEur | eur: 0 }}</strong><p>resterende uitgegeven facturen, na deelbetalingen · incl. btw</p></article>
          <article class="card metric-card"><span class="metric-card__label">Eigen kasinleg</span><strong>{{ financing().ownExposureEur | eur: 0 }}</strong><p>betaalde containerkosten min ontvangen partnergeld, minimaal nul</p></article>
          <article class="card metric-card" [class.metric-card--danger]="financing().resultEur < 0"><span class="metric-card__label">Gerealiseerd partnerresultaat</span><strong>{{ financing().resultEur | eur: 0 }}</strong><p>uitgegeven deel- en slotafrekeningen · voorschotten tellen niet als winst</p></article>
          <article class="card metric-card"><span class="metric-card__label">Credit voor partners</span><strong>{{ financing().creditEur | eur: 0 }}</strong><p>tegoeden op creditnota\u2019s en afrekeningen, te verrekenen of terug te betalen</p></article>
          <article class="card metric-card" [class.metric-card--danger]="financing().awaitingSettlement > 0"><span class="metric-card__label">Nog af te rekenen</span><strong>{{ financing().awaitingSettlement }}</strong><p>partnercontainer{{ financing().awaitingSettlement === 1 ? '' : 's' }} ontvangen, veilingoverzicht nog niet afgerekend</p></article>
        </div>
        <article class="card analysis-list scorecard-card">
          <header><div><span>Partners</span><h3>Per partnercontainer</h3></div><small>{{ financing().rows.length }} container{{ financing().rows.length === 1 ? '' : 's' }}</small></header>
          @if (financing().rows.length) {
            <div class="scorecard-scroll">
              <table class="scorecard">
                <thead><tr><th>Container</th><th>Partner</th><th>Externe kost</th><th>Ontvangen</th><th>Open / eigen kas</th><th>Resultaat</th><th>Documenten</th></tr></thead>
                <tbody>
                  @for (row of financing().rows; track row.purchaseOrderId) {
                    <tr>
                      <td data-label="Container"><a [routerLink]="['/purchasing', row.purchaseOrderId]">{{ row.alias || row.number }}</a>@if (row.alias) { <small class="muted"> {{ row.number }}</small> }</td>
                      <td data-label="Partner">{{ row.partnerName }}@if (row.sharePct !== null) { <small class="muted"> · {{ row.sharePct | num }} %</small> }</td>
                      <td data-label="Externe kost">{{ row.landedEur | eur: 0 }}<small class="muted"> {{ row.costFinalized ? 'definitief' : 'verwacht' }}</small></td>
                      <td data-label="Ontvangen">{{ row.receivedEur | eur: 0 }}<small class="muted"> {{ row.invoicedEur | eur: 0 }} voorschot gefactureerd excl. btw</small>@if (row.creditedEur) { <small class="muted"> {{ row.creditedEur | eur: 0 }} gecrediteerd</small> }@if (row.unbilledAdvanceCount) { <a [routerLink]="['/purchasing', row.purchaseOrderId]" [queryParams]="{ section: 'payments' }">{{ row.unbilledAdvanceCount }} termijnen factureren · {{ row.unbilledAdvanceEur | eur: 0 }}</a>@if (row.nextAdvanceDueDate) { <small class="muted">volgende vervaldatum {{ row.nextAdvanceDueDate | dateNl }}</small> } }</td>
                      <td data-label="Open / eigen kas" [class.scorecard__warn]="row.openEur > 0">{{ row.openEur | eur: 0 }} open<small class="muted"> {{ row.ownExposureEur | eur: 0 }} eigen kasinleg</small></td>
                      <td data-label="Resultaat" [class.scorecard__warn]="row.resultEur < 0">{{ row.resultEur | eur: 0 }}<small class="muted"> {{ row.settled ? 'volledig afgerekend' : row.remainingQuantity > 0 ? (row.remainingQuantity | num) + ' stuks resteren' : 'afrekening nog uitgeven' }}</small>@if (row.creditEur) { <small class="muted"> {{ row.creditEur | eur: 0 }} credit</small> }</td>
                      <td data-label="Documenten">@for (doc of row.documents; track doc.id; let last = $last) {<a [routerLink]="['/sales', doc.id, 'edit']">{{ doc.number }}</a><small class="muted"> {{ doc.docType === 'CREDITNOTA' ? (doc.status === 'CONCEPT' ? 'creditnota · concept' : 'creditnota') : doc.status === 'CONCEPT' ? 'concept' : doc.docType === 'OFFERTE' ? 'offerte' : doc.settlement ? 'afrekening' : 'voorschot' }}</small>{{ last ? '' : ' · ' }}}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else {
            <p class="list-empty">Nog geen container met een partner: alles betalen we zelf.</p>
          }
        </article>
      </section>

      <section class="analysis-section receipt-section" aria-labelledby="receipt-analysis-title">
        <header class="section-copy section-copy--receipt">
          <div>
            <span class="eyebrow">Inkoopcontrole</span>
            <h2 id="receipt-analysis-title">Ontvangstafwijkingen</h2>
            <p>Tekorten en schade blijven hier staan, ook nadat de container is afgerond.</p>
          </div>
          @if (focusedOrderId() !== null) {
            <button class="btn btn--sm" type="button" (click)="clearOrderFocus()">Alle orders tonen</button>
          }
        </header>

        <form class="card receipt-filters" (submit)="$event.preventDefault(); applyFilters()">
          <label>
            <span>Van</span>
            <app-date-field fieldId="analysis-from" [value]="fromDate()"
                            (valueChange)="fromDate.set($event)" />
          </label>
          <label>
            <span>Tot en met</span>
            <app-date-field fieldId="analysis-to" [value]="toDate()"
                            (valueChange)="toDate.set($event)" />
          </label>
          <label>
            <span>Leverancier</span>
            <select class="input" [ngModel]="supplierId() ?? ''" name="supplier"
                    (ngModelChange)="changeSupplier($event)">
              <option value="">Alle leveranciers</option>
              @for (supplier of suppliers(); track supplier.id) {
                <option [value]="supplier.id">{{ supplier.name }}</option>
              }
            </select>
          </label>
          <div class="receipt-filters__actions">
            <button class="btn" type="button" (click)="showAllTime()">Alle jaren</button>
            <button class="btn btn--primary" type="submit" [disabled]="filtering()">
              {{ filtering() ? 'Laden…' : 'Toepassen' }}
            </button>
          </div>
        </form>

        @if (receiptError()) {
          <div class="card receipt-error" role="alert">
            <div><b>Ontvangstafwijkingen niet beschikbaar</b><p>{{ receiptError() }}</p></div>
            <button class="btn btn--sm" type="button" (click)="loadVariances()">Opnieuw</button>
          </div>
        } @else {
          <div class="receipt-totals" aria-label="Samenvatting ontvangstafwijkingen">
            <article class="card receipt-total receipt-total--loss">
              <span>Inkoopimpact</span>
              <strong>{{ report().totals.totalLossValueEur | eur: 0 }}</strong>
              <small>{{ report().totals.affectedOrders }} order(s) · {{ report().totals.affectedLines }} regels</small>
            </article>
            <article class="card receipt-total">
              <span>Ontbreekt</span>
              <strong>{{ report().totals.missingPieces | num }} st</strong>
              <small>{{ report().totals.missingValueEur | eur: 0 }}</small>
            </article>
            <article class="card receipt-total">
              <span>Beschadigd</span>
              <strong>{{ report().totals.damagedPieces | num }} st</strong>
              <small>{{ report().totals.damagedValueEur | eur: 0 }}</small>
            </article>
            <article class="card receipt-total" [class.receipt-total--warn]="!report().totals.valuationComplete">
              <span>Zonder waarde</span>
              <strong>{{ report().totals.unvaluedLossPieces | num }} st</strong>
              <small>{{ report().totals.valuationComplete ? 'Alles gewaardeerd' : 'Vul waarde per stuk aan' }}</small>
            </article>
          </div>

          @if (!report().totals.valuationComplete) {
            <div class="valuation-note" role="status">
              De bekende waarde is {{ report().totals.totalLossValueEur | eur: 0 }}.
              {{ report().totals.unvaluedLossPieces | num }} afwijkende stuks tellen pas mee zodra hun ontvangstwaarde is ingevuld.
            </div>
          }

          <div class="variance-list">
            @for (group of varianceGroups(); track group.orderId) {
              <article class="card variance-order">
                <header class="variance-order__head">
                  <a [routerLink]="['/purchasing', group.orderId]">
                    <span>{{ group.supplierName }}</span>
                    <strong>{{ group.orderAlias || group.orderNumber }}</strong>
                    <small>{{ group.orderNumber }} · ontvangen {{ group.receivedOn | dateNl }}</small>
                  </a>
                  <span class="variance-order__value">
                    <b>{{ group.totalLossValueEur | eur: 0 }}</b>
                    @if (group.unvaluedLossPieces) { <small>+ {{ group.unvaluedLossPieces }} st onbekend</small> }
                    <a [routerLink]="['/purchasing', group.orderId]">Open order ›</a>
                  </span>
                </header>

                <div class="variance-lines">
                  @for (row of group.rows; track row.lineId ?? row.productId) {
                    <div class="variance-line">
                      <div class="variance-line__product">
                        <strong>{{ row.productName }}</strong>
                        <span>{{ row.productSku || 'Geen SKU' }} · {{ row.usablePieces | num }} bruikbaar van {{ row.orderedPieces | num }}</span>
                        <div class="variance-line__chips">
                          @if (row.missingPieces) { <span>{{ row.missingPieces | num }} ontbreekt</span> }
                          @if (row.damagedPieces) { <span>{{ row.damagedPieces | num }} beschadigd</span> }
                          @if (row.overReceivedPieces) { <span class="ok">+{{ row.overReceivedPieces | num }} extra</span> }
                        </div>
                      </div>
                      <div class="variance-line__impact">
                        <span>Impact</span>
                        <b>{{ row.totalLossValueEur === null ? 'Onbekend' : (row.totalLossValueEur | eur: 2) }}</b>
                      </div>
                      <div class="variance-line__valuation">
                        <label [attr.for]="valueInputId(row)">Inkoopwaarde per stuk</label>
                        <div class="value-edit">
                          <span>€</span>
                          <input class="input num" [id]="valueInputId(row)" type="number" min="0" step="0.0001"
                                 inputmode="decimal" [disabled]="row.lineId === null || savingValue() === valueKey(row)"
                                 [ngModel]="draftValue(row)" [ngModelOptions]="{ standalone: true }"
                                 (ngModelChange)="setDraftValue(row, $event)" />
                          <button class="btn btn--sm" type="button"
                                  [attr.aria-label]="'Bewaar inkoopwaarde voor ' + row.productName"
                                  [disabled]="row.lineId === null || savingValue() === valueKey(row)"
                                  (click)="saveValue(row)">
                            {{ savingValue() === valueKey(row) ? '…' : 'Bewaar' }}
                          </button>
                        </div>
                        @if (row.lineId === null) { <small>Historische regel zonder regelnummer</small> }
                      </div>
                    </div>
                  }
                </div>
              </article>
            } @empty {
              <div class="card receipt-empty">
                <span aria-hidden="true">✓</span>
                <div><b>Geen afwijkingen in deze selectie</b>
                  <p>Er zijn geen ontbrekende of beschadigde stuks gevonden.</p></div>
              </div>
            }
          </div>
        }
      </section>
      }
      }
    </ng-template>

    <ng-template #phonePeriod let-basis>
      <div class="an-bar">
        <button class="ios-capsule ios-capsule--sm ios-capsule--tinted an-pick-phone" type="button" aria-haspopup="dialog" (click)="sheet.set('period')">
          <app-icon name="calendar" [size]="15" />{{ salesPeriodLabel() }}<app-icon name="chevron-down" [size]="14" /></button>
        <span class="an-bar__text">{{ salesRangeShort() }}{{ basis }}</span>
      </div>
    </ng-template>
  `,
})
export class AnalysesPage {
  private readonly sourcing = inject(SourcingApi);
  private readonly catalog = inject(CatalogApi);
  private readonly sales = inject(SalesApi);
  private readonly finance = inject(FinanceApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly documentTitle = inject(Title);
  private readonly ui = inject(Ui);
  readonly desk = inject(DesktopViewport);
  private readonly cashSources = inject(CashSources);
  private readonly cashState = inject(CashState);

  private readonly analysisNavigation = viewChild<ElementRef<HTMLElement>>('analysisNavigation');
  private readonly market = viewChild(MarketAnalysis);
  private readonly bell = viewChild(NotificationBell);
  private readonly phoneChips = viewChild<ElementRef<HTMLElement>>('phoneChips');
  private readonly navHistory = inject(NavHistory);
  private readonly location = inject(Location);
  private readonly work = inject(WorkQueue);
  private readonly website = viewChild(WebsiteAnalytics);
  readonly analysisTabs = ANALYSIS_TABS;
  /** The old desk tab row, off since the redesign (analyses-desk-tabs.ts). */
  readonly deskTabRow = DESK_TAB_ROW;
  readonly section = toSignal(this.route.paramMap.pipe(map((params) =>
    analysisSection(params.get('section')))), { initialValue: 'cash' as AnalysisSection });
  private readonly queryParams = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  readonly head = computed(() => TAB_HEADS[this.section()]);
  /** The crumb "Analyses ›" on the seven tabs; Overzicht is the area's own top (critique N1). */
  readonly parent = computed(() => this.section() === 'overview' ? null : ANALYSES_PARENT);
  readonly how = HOW_TEXTS;
  readonly purchasingHow = [...HOW_TEXTS['purchasing-kosten'], ...HOW_TEXTS['purchasing-kwaliteit'], ...HOW_TEXTS['purchasing-partners'], ...HOW_TEXTS['purchasing-afwijkingen']];
  readonly salesNote = SALES_PERIOD_NOTE;
  readonly sheet = signal<PageSheet>(null);
  /** Phone caption under the large title: the subtitle, or the year so far on Overzicht. */
  readonly phoneCaption = computed(() => this.section() === 'overview' ? `Dit jaar · t/m ${weekdayDayMonth(this.today())}` : this.head().subtitle);
  readonly howLines = computed<readonly string[]>(() => {
    const section = this.section();
    if (section === 'purchasing') return this.purchasingHow;
    return section === 'market' || section === 'website' ? [] : HOW_TEXTS[section];
  });
  readonly menuLinks = computed(() => MENU_LINKS[this.section()] ?? []);

  /*
   * Phone back (critique B8): the screen below this one in the in-app history. The chips replace the URL,
   * so it stays the origin across tab switches; another Analyses tab, a workspace or none read "‹ Meer".
   */
  readonly origin = computed(() => originOf(this.navHistory.below(), screenLabel, isWorkspaceUrl));
  /** The capsule text; '' (a chevron circle) when the name is longer than ten characters. */
  readonly backLabel = computed(() => capsuleLabel(this.origin().label));
  readonly backAria = computed(() => this.origin().label ? `Terug naar ${this.origin().label}` : 'Terug');

  /* The bell as a proxy circle in the phone trail (critique B7, the home's pattern). */
  readonly bellCount = this.work.actionCount;
  readonly bellLabel = computed(() => {
    const count = this.work.actionCount();
    return count === 0 ? 'Meldingen' : count === 1 ? '1 klant wacht' : `${count} klanten wachten`;
  });

  /** Today, kept fresh: refreshed when the page becomes visible again and on Vernieuwen (design §2.8). */
  readonly today = signal(localIsoDay());
  readonly todayText = computed(() => weekdayDayMonth(this.today()));
  readonly yearRangeText = computed(() => rangeLabel(yearStart(this.today()), this.today()));

  /**
   * The page's own data: idle until the first data tab shows, loading during
   * that first load, ready after it (critique B6). A refresh keeps 'ready'
   * and shows refreshing() instead, so the figures stay on screen.
   */
  readonly data = signal<'idle' | 'loading' | 'ready'>('idle');
  readonly loading = computed(() => this.data() !== 'ready');
  /** Every source failed: the tab shows app-load-error instead of zeros. */
  readonly loadFailed = signal(false);
  /** "21:14": when the page's data last arrived. */
  readonly loadedAt = signal('');
  readonly refreshing = signal(false);
  /** The toolbar's Vernieuwen per tab: Markt and Bezoekers reload their own sources. */
  readonly busy = computed(() => {
    switch (this.section()) {
      case 'market': return this.market()?.loading() ?? false;
      case 'website': {
        const website = this.website();
        return website ? (website.source() === 'INTERNAL' ? website.loading() : website.googleBusy()) : false;
      }
      default: return this.data() === 'loading' || this.refreshing();
    }
  });
  readonly filtering = signal(false);
  readonly receiptError = signal('');
  readonly dataWarnings = signal<string[]>([]);
  readonly report = signal<ReceiptVarianceReport>(EMPTY_REPORT);
  /** Overzicht's own receipt variances: this year, no supplier, no order (critique B5). */
  readonly overviewReport = signal<ReceiptVarianceReport>(EMPTY_REPORT);
  readonly purchases = signal<PurchaseOrderView[]>([]);
  readonly suppliers = signal<Supplier[]>([]);
  readonly products = signal<Product[]>([]);
  readonly salesOrders = signal<SalesOrderView[]>([]);
  readonly incomingPayments = signal<IncomingPaymentRow[]>([]);
  readonly partnerSummaries = signal<PartnerFinancing[]>([]);
  readonly customers = signal<Customer[]>([]);
  readonly costs = signal<CompanyCost[]>([]);
  readonly expectedStock = signal<ExpectedStock[]>([]);

  readonly fromDate = signal(yearStart(this.today()));
  readonly toDate = signal(this.today());
  /** Verkoop and Resultaat share one period (design §2.4); the dates follow today. */
  readonly salesPeriod = signal<PeriodChoice>(parsePeriod((key) => this.route.snapshot.queryParamMap.get(key), SALES_PERIOD_KEYS));
  readonly salesRange = computed(() => periodRange(this.salesPeriod(), this.today()));
  readonly salesFromDate = computed(() => this.salesRange().from);
  readonly salesToDate = computed(() => this.salesRange().to);
  readonly salesRangeText = computed(() => rangeLabel(this.salesFromDate(), this.salesToDate()));
  readonly salesRangeShort = computed(() => rangeLabelShort(this.salesFromDate(), this.salesToDate(), this.today()));
  readonly salesPeriodLabel = computed(() => periodLabel(this.salesPeriod(), this.today()));
  readonly supplierId = signal<number | null>(null);
  private readonly appliedFromDate = signal(yearStart(this.today()));
  private readonly appliedToDate = signal(this.today());
  private readonly appliedSupplierId = signal<number | null>(null);
  readonly focusedOrderId = signal<number | null>(null);
  readonly savingValue = signal<string | null>(null);
  readonly valueDrafts = signal<Record<string, string>>({});

  readonly receivedForPerformance = computed(() => this.purchases().filter((row) =>
    row.order.status === 'ONTVANGEN'
    && inDateRange(row.order.receivedOn, this.appliedFromDate() || undefined, this.appliedToDate() || undefined)
    && (this.appliedSupplierId() === null || row.order.supplierId === this.appliedSupplierId())
    && (this.focusedOrderId() === null || row.order.id === this.focusedOrderId())));
  readonly supplierPerformance = computed(() => supplierReceiptPerformance(
    this.receivedForPerformance().map((row) => ({
      receivedOn: row.order.receivedOn,
      expectedArrival: row.order.expectedArrival,
      lines: row.order.lines,
    }))));

  readonly incomingOrders = computed(() => this.purchases()
    .filter((row) => row.order.status === 'BESTELD' || row.order.status === 'ONDERWEG'));
  readonly incomingValue = computed(() => this.incomingOrders()
    .reduce((sum, row) => sum + purchaseExternalCost(row), 0));
  readonly incomingPieces = computed(() => this.incomingOrders()
    .reduce((sum, row) => sum + row.costing.totals.pieces, 0));
  readonly orderedCount = computed(() => this.incomingOrders()
    .filter((row) => row.order.status === 'BESTELD').length);
  readonly sailingCount = computed(() => this.incomingOrders()
    .filter((row) => row.order.status === 'ONDERWEG').length);

  readonly valuedInventory = computed(() => this.products().filter((product) =>
    product.inventoryKnown === true && product.stockQuantity > 0 && product.landedCostEur != null));
  readonly unvaluedInventory = computed(() => this.products().filter((product) =>
    product.inventoryKnown === true && product.stockQuantity > 0 && product.landedCostEur == null));
  readonly inventoryUnknownSkuCount = computed(() => this.products()
    .filter((product) => product.inventoryKnown !== true).length);
  readonly inventoryValuedPieces = computed(() => this.valuedInventory()
    .reduce((sum, product) => sum + product.stockQuantity, 0));
  readonly inventoryUnvaluedPieces = computed(() => this.unvaluedInventory()
    .reduce((sum, product) => sum + product.stockQuantity, 0));
  readonly inventoryPurchaseValue = computed(() => this.valuedInventory()
    .reduce((sum, product) => sum + product.stockQuantity * product.landedCostEur!, 0));
  readonly saleableInventory = computed(() => this.products().filter((product) =>
    product.active && !product.demo && product.inventoryKnown === true && product.stockQuantity > 0));
  readonly inventorySalesValue = computed(() => this.saleableInventory()
    .reduce((sum, product) => sum + product.stockQuantity * product.computedSalesPriceEur, 0));
  readonly inventoryUplift = computed<number | null>(() => {
    const products = this.saleableInventory();
    if (products.some((product) => product.landedCostEur == null)) return null;
    const cost = products.reduce((sum, product) => sum + product.stockQuantity * product.landedCostEur!, 0);
    return this.inventorySalesValue() - cost;
  });

  readonly openSales = computed(() => this.salesOrders().filter((row) =>
    (row.order.docType ?? 'OFFERTE') === 'OFFERTE'
    && ['CONCEPT', 'VERZONDEN', 'BEKEKEN', 'WIJZIGING_GEVRAAGD'].includes(row.order.status)));
  readonly pipelineValue = computed(() => this.openSales()
    .reduce((sum, row) => sum + row.priced.totals.total, 0));
  readonly pipelineMargin = computed(() => this.openSales()
    .reduce((sum, row) => sum + row.priced.totals.marginEur, 0));
  readonly pipelineGoods = computed(() => this.openSales()
    .reduce((sum, row) => sum + row.priced.totals.goodsTotal, 0));
  readonly pipelineMissingCostLines = computed(() => this.openSales()
    .reduce((sum, row) => sum + row.priced.validation.productsWithoutCost.length, 0));
  readonly pipelineMarginPct = computed<number | null>(() => this.pipelineGoods() > 0
    ? (this.pipelineMargin() / this.pipelineGoods()) * 100 : null);

  readonly salesMetrics = computed(() => salesAnalysis(this.salesOrders(), this.customers(), {
    from: this.salesFromDate() || undefined,
    to: this.salesToDate() || undefined,
    today: this.today(),
    topLimit: 8,
  }));
  readonly financing = computed(() => partnerFinancingAnalysis(this.purchases(), this.salesOrders(), this.customers(), this.partnerSummaries()));
  readonly incoming = computed(() => incomingMoneyTotals(this.incomingPayments(), this.salesFromDate(), this.salesToDate()));
  /* Investments charge the period with their depreciation (finance-metrics); what is still open reads the payments. */
  readonly result = computed(() => resultAnalysis(this.salesOrders(), this.purchases(), this.costs(), {
    from: this.salesFromDate() || undefined, to: this.salesToDate() || undefined, costCharge: (cost, from, to) => costChargeIn(cost, from, to, this.today()), openEur: openOf,
  }));
  readonly channelLabel = channelLabel;
  readonly categoryLabel = categoryLabel;

  readonly inventoryMetrics = computed(() => inventoryAnalysis(
    this.products(), this.expectedStock(), { topLimit: 10, sales: this.salesOrders(), today: this.today() }));

  /** The month by month view as two lines: what was invoiced, what was accepted. */
  readonly salesTrend = computed<TrendSeries[]>(() => {
    const monthly = this.salesMetrics().monthly;
    if (!monthly.some((point) => point.invoicedEur > 0 || point.acceptedEur > 0)) return [];
    const dates = monthly.map((point) => `${point.month}-01`);
    return [
      { label: 'Gefactureerd', dates, values: monthly.map((point) => point.invoicedEur), tone: 'accent' },
      { label: 'Geaccepteerde offertes', dates, values: monthly.map((point) => point.acceptedEur), tone: 'muted' },
    ];
  });

  /** Each stage of the quote funnel as a bar against the number created, with the rate that got it there. */
  readonly funnelSteps = computed(() => {
    const funnel = this.salesMetrics().funnel;
    const width = (count: number) => funnel.created > 0 ? Math.max(count > 0 ? 2 : 0, (count / funnel.created) * 100) : 0;
    const rate = (value: number | null, of: string) => value === null ? `nog geen ${of}` : `${Math.round(value)} % van ${of}`;
    return [
      { key: 'created', label: 'Aangemaakt', count: funnel.created, width: width(funnel.created), rate: 'alle offertes in de periode', accent: false },
      { key: 'sent', label: 'Verzonden', count: funnel.sent, width: width(funnel.sent), rate: rate(funnel.sendRatePct, 'aangemaakt'), accent: false },
      { key: 'viewed', label: 'Bekeken door de klant', count: funnel.viewed, width: width(funnel.viewed), rate: rate(funnel.viewRatePct, 'verzonden'), accent: false },
      { key: 'accepted', label: 'Geaccepteerd', count: funnel.accepted, width: width(funnel.accepted), rate: rate(funnel.conversionRatePct, 'gesloten'), accent: true },
    ];
  });


  readonly supplierCards = computed(() => supplierScorecards(this.receivedForPerformance().map((row) => ({
    supplierId: row.order.supplierId,
    supplierName: this.supplierName(row.order.supplierId),
    orderDate: row.order.orderDate,
    receivedOn: row.order.receivedOn,
    expectedArrival: row.order.expectedArrival,
    lines: row.order.lines,
    totalEur: purchaseExternalCost(row),
  }))));
  readonly leadDays = computed(() => averageLeadDays(this.receivedForPerformance().map((row) => row.order)));
  private readonly regionNames = new Intl.DisplayNames(['nl'], { type: 'region' });

  readonly varianceGroups = computed<VarianceGroup[]>(() => {
    const groups = new Map<number, VarianceGroup>();
    for (const row of this.report().rows) {
      const current = groups.get(row.orderId) ?? {
        orderId: row.orderId,
        orderNumber: row.orderNumber,
        orderAlias: row.orderAlias,
        supplierName: row.supplierName,
        receivedOn: row.receivedOn,
        expectedArrival: row.expectedArrival,
        missingPieces: 0,
        damagedPieces: 0,
        totalLossValueEur: 0,
        unvaluedLossPieces: 0,
        rows: [],
      };
      current.missingPieces += row.missingPieces;
      current.damagedPieces += row.damagedPieces;
      current.totalLossValueEur += row.totalLossValueEur ?? 0;
      if (!row.valuationComplete) current.unvaluedLossPieces += row.missingPieces + row.damagedPieces;
      current.rows.push(row);
      groups.set(row.orderId, current);
    }
    return [...groups.values()].sort((left, right) =>
      (right.receivedOn ?? '').localeCompare(left.receivedOn ?? '') || right.orderId - left.orderId);
  });

  /* ---------- Overzicht: its own periods, never another tab's filter (critique B5) */
  readonly fx = inject(Fx);
  readonly whole = eurWhole;
  readonly plural = plural;
  readonly openContainersLine = openContainersLine;
  readonly paymentResultLine = paymentResultLine;
  private readonly marketMonths = storedMarketMonths();
  readonly yearStartDay = computed(() => yearStart(this.today()));
  /** Year to date for the Verkoop and Resultaat rows. */
  readonly ytdSales = computed(() => salesAnalysis(this.salesOrders(), this.customers(), {
    from: this.yearStartDay(), to: this.today(), today: this.today(), topLimit: 8,
  }));
  readonly ytdResult = computed(() => resultAnalysis(this.salesOrders(), this.purchases(), this.costs(), {
    from: this.yearStartDay(), to: this.today(), costCharge: (cost, from, to) => costChargeIn(cost, from, to, this.today()), openEur: openOf,
  }));
  /** All years: what waits, whatever period Verkoop shows (overdue invoices). */
  readonly allSales = computed(() => salesAnalysis(this.salesOrders(), this.customers(), { today: this.today(), topLimit: 1 }));
  /** Perfect / Op tijd over this calendar year's receipts, without Inkoop's supplier or order focus (design §5.8). */
  readonly yearPerformance = computed(() => supplierReceiptPerformance(this.purchases()
    .filter((row) => row.order.status === 'ONTVANGEN' && inDateRange(row.order.receivedOn, this.yearStartDay(), this.today()))
    .map((row) => ({ receivedOn: row.order.receivedOn, expectedArrival: row.order.expectedArrival, lines: row.order.lines }))));
  /** The Inkoop digest row: the active containers of Containerkost (same helpers, same filter). */
  readonly containerDigest = computed(() => {
    const rows = containerCostRows(this.purchases(), 'active', '').map((row) => ({ ...row, paymentResult: purchasePaymentResult(row.view) }));
    return { count: rows.length, totals: containerCostTotals(rows), payment: containerPaymentResultTotals(rows) };
  });
  readonly marketDigest = computed(() => {
    const series = this.fx.series();
    if (!series) return null;
    const change = changeOverMonths({ dates: series.dates, values: series.usd }, this.marketMonths);
    return { lines: marketLines(series.latestCny, change?.pct ?? null, this.marketMonths), dollar: dollarValue(series.latestUsd) };
  });
  readonly attention = computed<AttentionRow[]>(() => {
    const missing = this.pipelineMissingCostLines();
    const invoices = this.allSales().invoices;
    const inventory = this.inventoryMetrics();
    const report = this.overviewReport();
    const financing = this.financing();
    const overdueAdvance = financing.overdueUnbilledAdvanceEur;
    const orders = new Map<number, { name: string; missingPieces: number; damagedPieces: number }>();
    for (const row of report.rows) {
      const order = orders.get(row.orderId) ?? { name: this.containerOf(row.orderId, row.orderNumber, row.orderAlias), missingPieces: 0, damagedPieces: 0 };
      order.missingPieces += row.missingPieces;
      order.damagedPieces += row.damagedPieces;
      orders.set(row.orderId, order);
    }
    const variance = varianceAttention([...orders.values()]);
    const terms = financing.rows.map((row) => ({ name: containerName({ id: row.purchaseOrderId, number: row.number, alias: row.alias }), terms: row.unbilledAdvanceCount, nextDue: row.nextAdvanceDueDate }));
    const plain = { value: null, valueTone: null, meta: null, metaTone: null, query: null } as const;
    return [
      { ...plain, key: 'quotes', count: this.openSales().length, tone: null, title: 'Open offertes', link: '/analyses/sales',
        sub: `${eurWhole(this.pipelineValue())} in de pijplijn${missing ? ` · ${plural(missing, 'regel', 'regels')} zonder kost` : ''}` },
      { ...plain, key: 'overdue', count: invoices.overdue, tone: 'danger', title: 'Vervallen facturen', link: '/analyses/sales', sub: overdueSub(invoices.overdue),
        value: eurWhole(invoices.overdueValueEur), valueTone: invoices.overdue ? 'danger' : null },
      { ...plain, key: 'stock', count: inventory.zeroStock.withoutIncomingCount, tone: 'warn', title: 'Producten zonder voorraad én inkoop', link: '/analyses/inventory',
        sub: `${plural(inventory.dataGaps.unknownStockSkuCount, 'SKU', 'SKU’s')} zonder betrouwbare voorraadstand` },
      { ...plain, key: 'variance', count: report.totals.affectedOrders, tone: 'warn', title: variance.title, sub: variance.sub, link: '/analyses/purchasing',
        query: { deel: 'afwijkingen' }, value: eurWhole(report.totals.totalLossValueEur), meta: 'bekende impact' },
      { ...plain, key: 'settle', count: financing.awaitingSettlement, tone: 'warn', title: 'Partnercontainers af te rekenen', link: '/analyses/purchasing',
        query: { deel: 'partners' }, sub: financing.awaitingSettlement ? 'Ontvangen; het veilingoverzicht wacht' : 'Geen ontvangen partnercontainer wacht' },
      { ...plain, key: 'advance', count: financing.unbilledAdvanceCount, tone: overdueAdvance > 0 ? 'danger' : null, title: 'Voorschottermijnen te factureren',
        link: '/analyses/purchasing', query: { deel: 'partners' }, sub: advanceTermsSub(terms, this.today()),
        value: eurWhole(financing.unbilledAdvanceEur), valueTone: overdueAdvance > 0 ? 'danger' : null,
        meta: overdueAdvance > 0 ? `waarvan ${eurWhole(overdueAdvance)} vervallen` : 'excl. btw', metaTone: overdueAdvance > 0 ? 'danger' : null },
    ];
  });
  readonly attentionCount = computed(() => this.attention().filter((row) => row.count > 0).length);

  /** What the Kasprognose reads from this page's own load (spec §4.1: never fetched twice). */
  private readonly cashPage = computed<CashPageData>(() => ({
    purchases: this.purchases(), suppliers: this.suppliers(), products: this.products(), salesOrders: this.salesOrders(),
    customers: this.customers(), costs: this.costs(), incomingPayments: this.incomingPayments(),
  }));

  constructor() {
    this.cashState.attach(this.cashPage, this.loading, this.today);
    /* The page's data load the first time a data tab shows; Markt and Bezoekers never trigger it (critique B6). */
    effect(() => {
      const section = this.section();
      if (DATA_TABS.has(section) && untracked(this.data) === 'idle') untracked(() => void this.load());
    });
    /* Overzicht's Markt row reads the ECB rates (the same root Fx as Markt); loaded once, quietly. */
    effect(() => {
      if (this.section() !== 'overview') return;
      untracked(() => { if (!this.fx.series() && !this.fx.failed()) void this.fx.load(); });
    });
    /* The bank and forecast data load the first time Kasprognose or Overzicht is shown. */
    effect(() => {
      const section = this.section();
      if (section === 'cash' || section === 'overview') untracked(() => this.cashSources.ensure(this.today()));
    });
    /*
     * The period lives in the URL on Verkoop and Resultaat only (critique N9): a link with the keys sets it;
     * a link without them (the sidebar) gets the current choice written back.
     */
    effect(() => {
      const params = this.queryParams();
      const section = this.section();
      if (section !== 'sales' && section !== 'result') return;
      untracked(() => {
        const keys = [SALES_PERIOD_KEYS.preset, SALES_PERIOD_KEYS.from, SALES_PERIOD_KEYS.to];
        if (keys.some((key) => params.has(key))) {
          const parsed = parsePeriod((key) => params.get(key), SALES_PERIOD_KEYS);
          if (!samePeriod(parsed, this.salesPeriod())) this.salesPeriod.set(parsed);
        } else if (!samePeriod(this.salesPeriod(), DEFAULT_PERIOD)) {
          this.writeParams(periodParams(this.salesPeriod(), SALES_PERIOD_KEYS));
        }
      });
    });
    /* "Analyses · Verkoop — Enrosed" (critique N19): after PageHeader's own title effect. */
    afterRenderEffect(() => {
      const section = this.section();
      this.documentTitle.setTitle(section === 'overview' ? 'Analyses — Enrosed' : `Analyses · ${TAB_HEADS[section].title} — Enrosed`);
    });
    /* The advance schedules need the page's partner financings: once per round, after the page loaded. */
    effect(() => {
      const round = this.cashSources.generation();
      if (round === 0 || this.loading()) return;
      const financings = this.partnerSummaries();
      untracked(() => void this.cashSources.loadSchedules(financings, round));
    });
    /* The current chip in view on the phone, centred, without animation. */
    afterRenderEffect(() => {
      this.section();
      const chips = this.phoneChips()?.nativeElement;
      const current = chips?.querySelector<HTMLElement>('[aria-current="page"]');
      if (chips && current) chips.scrollTo({ left: current.offsetLeft - chips.clientWidth / 2 + current.offsetWidth / 2, behavior: 'instant' });
    });
    afterRenderEffect(() => {
      this.section();
      const navigation = this.analysisNavigation()?.nativeElement;
      const active = navigation?.querySelector<HTMLElement>('a.active');
      if (navigation && active) {
        navigation.scrollTo({ left: active.offsetLeft - navigation.clientWidth / 2 + active.offsetWidth / 2, behavior: 'instant' });
      }
    });
    const orderId = Number(this.route.snapshot.queryParamMap.get('orderId'));
    if (Number.isInteger(orderId) && orderId > 0) {
      this.focusedOrderId.set(orderId);
      this.fromDate.set('');
      this.toDate.set('');
      this.appliedFromDate.set('');
      this.appliedToDate.set('');
    }
  }

  /** Vernieuwen reloads what the visible tab shows (critique B6: branch on the tab before any guard). */
  async refresh(): Promise<void> {
    const section = this.section();
    if (section === 'market') {
      const market = this.market();
      if (market && !market.loading()) await market.load();
      return;
    }
    if (section === 'website') { this.website()?.reloadSelected(); return; }
    if (this.data() === 'loading' || this.refreshing()) return;
    this.today.set(localIsoDay());
    this.refreshing.set(true);
    try {
      await Promise.all([this.load(), this.cashSources.state() === 'idle' ? Promise.resolve() : this.cashSources.reload(this.today())]);
    } finally { this.refreshing.set(false); }
  }

  /** The page became visible again: a new day rolls the presets and "vandaag" over. */
  visible(): void {
    if (document.visibilityState !== 'visible') return;
    const day = localIsoDay();
    if (day !== this.today()) this.today.set(day);
  }

  dataTab(section: AnalysisSection): boolean { return DATA_TABS.has(section); }
  /** A source whose last load failed: its figures read "—" instead of zero. */
  failed(label: string): boolean { return this.dataWarnings().includes(label); }
  signedWhole(value: number): string { return value < 0 ? eurWhole(value) : `+ ${eurWhole(value)}`; }
  /** A purchase order by its container name (containerName()), from the loaded orders or the report row. */
  containerOf(orderId: number, number: string, alias: string | null): string {
    const view = this.purchases().find((row) => row.order.id === orderId);
    return containerName(view ? view.order : { id: orderId, number, alias });
  }
  legacyTab(section: AnalysisSection): boolean { return LEGACY_BODIES.has(section); }

  openBell(): void { this.bell()?.open(); }

  /** History back when the origin is the screen below; else to the origin with the pop motion. */
  goBack(): void {
    const origin = this.origin();
    if (origin.url === this.navHistory.below()) this.location.back();
    else void this.router.navigateByUrl(origin.url, { info: { nav: 'pop' } });
  }

  setSalesPeriod(choice: PeriodChoice): void {
    this.salesPeriod.set(choice);
    this.writeParams(periodParams(choice, SALES_PERIOD_KEYS));
  }

  private writeParams(params: Record<string, string | null>): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: params, queryParamsHandling: 'merge', replaceUrl: true });
  }

  async load(): Promise<void> {
    if (this.data() === 'idle') this.data.set('loading');
    this.receiptError.set('');
    try {
      const filters = this.filters();
      const overviewFilters = this.overviewFilters();
      const sameFilters = this.sameFilters(filters, overviewFilters);
      const [report, purchases, suppliers, products, sales, customers, expectedStock, costs, incoming, partners, overview] = await Promise.allSettled([
        this.sourcing.receiptVariances(filters),
        this.sourcing.purchaseOrders(),
        this.sourcing.suppliers(),
        this.catalog.products(),
        this.sales.orders(),
        this.sales.customers(),
        this.sourcing.expectedStock(),
        this.finance.costs(),
        this.sales.incomingPayments(), this.sourcing.partnerFinancings(),
        sameFilters ? Promise.resolve(null) : this.sourcing.receiptVariances(overviewFilters),
      ] as const);
      const warnings: string[] = [];
      if (report.status === 'fulfilled') this.acceptReport(report.value);
      else this.receiptError.set(messageOf(report.reason, 'De ontvangstafwijkingen konden niet worden geladen.'));
      /* Overzicht reuses Afwijkingen' report while its filter is the default (this year, everything). */
      const overviewReport = sameFilters ? report : overview;
      if (overviewReport.status === 'fulfilled' && overviewReport.value) this.overviewReport.set(overviewReport.value);
      if (purchases.status === 'fulfilled') this.purchases.set(purchases.value); else warnings.push('inkoop');
      if (suppliers.status === 'fulfilled') this.suppliers.set(suppliers.value); else warnings.push('leveranciers');
      if (products.status === 'fulfilled') this.products.set(products.value); else warnings.push('voorraad');
      if (sales.status === 'fulfilled') this.salesOrders.set(sales.value); else warnings.push('verkoop');
      if (customers.status === 'fulfilled') this.customers.set(customers.value); else warnings.push('klanten');
      if (expectedStock.status === 'fulfilled') this.expectedStock.set(expectedStock.value); else warnings.push('verwachte voorraad');
      if (costs.status === 'fulfilled') this.costs.set(costs.value); else warnings.push('kosten');
      if (incoming.status === 'fulfilled') this.incomingPayments.set(incoming.value); else warnings.push('inkomende betalingen');
      if (partners.status === 'fulfilled') this.partnerSummaries.set(partners.value); else warnings.push('partnerfinanciering');
      this.dataWarnings.set(warnings);
      this.loadFailed.set([report, purchases, suppliers, products, sales, customers, expectedStock, costs, incoming, partners].every((call) => call.status === 'rejected'));
      const now = new Date();
      this.loadedAt.set(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
    } finally {
      this.data.set('ready');
    }
  }

  async loadVariances(): Promise<void> {
    if (this.filtering()) return;
    this.filtering.set(true);
    this.receiptError.set('');
    try {
      const filters = this.filters();
      const report = await this.sourcing.receiptVariances(filters);
      this.acceptReport(report);
      if (this.sameFilters(filters, this.overviewFilters())) this.overviewReport.set(report);
    } catch (failure: unknown) {
      this.receiptError.set(messageOf(failure, 'De ontvangstafwijkingen konden niet worden geladen.'));
    } finally {
      this.filtering.set(false);
    }
  }

  applyFilters(): void {
    this.appliedFromDate.set(this.fromDate());
    this.appliedToDate.set(this.toDate());
    this.appliedSupplierId.set(this.supplierId());
    void this.loadVariances();
  }

  showAllTime(): void {
    this.fromDate.set('');
    this.toDate.set('');
    this.appliedFromDate.set('');
    this.appliedToDate.set('');
    this.appliedSupplierId.set(this.supplierId());
    this.focusedOrderId.set(null);
    void this.loadVariances();
  }

  clearOrderFocus(): void {
    this.focusedOrderId.set(null);
    this.fromDate.set(yearStart(this.today()));
    this.toDate.set(this.today());
    this.appliedFromDate.set(yearStart(this.today()));
    this.appliedToDate.set(this.today());
    this.appliedSupplierId.set(this.supplierId());
    void this.loadVariances();
  }

  changeSupplier(value: string | number | null): void {
    const parsed = Number(value);
    this.supplierId.set(value === '' || value === null || !Number.isFinite(parsed) ? null : parsed);
  }

  supplierName(id: number): string {
    return this.suppliers().find((supplier) => supplier.id === id)?.name ?? `Leverancier ${id}`;
  }

  countryLabel(code: string | null): string {
    if (!code) return 'Land onbekend';
    try { return this.regionNames.of(code) ?? code; } catch { return code; }
  }

  weeksLabel(weeks: number | null): string {
    if (weeks === null) return 'Geen verkoop';
    if (weeks < 1) return 'Minder dan een week';
    return `Nog ${weeks} weken`;
  }

  attentionReason(reason: string): string {
    const labels: Record<string, string> = {
      OVERDUE_INVOICE: 'Factuur vervallen',
      OUTSTANDING_INVOICE: 'Factuur open',
      QUOTE_AWAITING_RESPONSE: 'Offerte wacht op klant',
      QUOTE_AWAITING_RESEND: 'Wijziging opnieuw versturen',
      MISSING_COST: 'Kostprijs ontbreekt',
    };
    return labels[reason] ?? reason.toLocaleLowerCase().replaceAll('_', ' ');
  }

  valueKey(row: ReceiptVarianceRow): string { return `${row.orderId}:${row.lineId ?? 'legacy'}`; }
  valueInputId(row: ReceiptVarianceRow): string { return `receipt-value-${row.orderId}-${row.lineId ?? row.productId}`; }
  draftValue(row: ReceiptVarianceRow): string {
    return this.valueDrafts()[this.valueKey(row)] ?? (row.receiptUnitValueEur?.toString() ?? '');
  }

  setDraftValue(row: ReceiptVarianceRow, value: string | number | null): void {
    this.valueDrafts.update((drafts) => ({ ...drafts, [this.valueKey(row)]: value == null ? '' : String(value) }));
  }

  async saveValue(row: ReceiptVarianceRow): Promise<void> {
    if (row.lineId === null) return;
    const raw = this.draftValue(row).trim().replace(',', '.');
    const value = raw === '' ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      this.ui.toast('Vul een geldige waarde per stuk in', 'err');
      return;
    }
    const key = this.valueKey(row);
    this.savingValue.set(key);
    try {
      await this.sourcing.setReceiptLineValue(row.orderId, row.lineId, value);
      this.ui.toast(value === null ? 'Ontvangstwaarde gewist' : 'Ontvangstwaarde bewaard', 'ok');
      await this.loadVariances();
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Ontvangstwaarde bewaren mislukt'), 'err');
    } finally {
      this.savingValue.set(null);
    }
  }

  private overviewFilters() {
    return { from: yearStart(this.today()), to: this.today(), supplierId: null, orderId: null };
  }

  private sameFilters(left: ReturnType<AnalysesPage['filters']>, right: ReturnType<AnalysesPage['overviewFilters']>): boolean {
    return left.from === right.from && left.to === right.to && left.supplierId === right.supplierId && left.orderId === right.orderId;
  }

  private filters() {
    return {
      from: this.appliedFromDate() || null,
      to: this.appliedToDate() || null,
      supplierId: this.appliedSupplierId(),
      orderId: this.focusedOrderId(),
    };
  }

  private acceptReport(report: ReceiptVarianceReport): void {
    this.report.set(report);
    this.valueDrafts.set(Object.fromEntries(report.rows.map((row) =>
      [this.valueKey(row), row.receiptUnitValueEur?.toString() ?? ''])));
  }
}

function localIsoDay(date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function analysisSection(value: string | null): AnalysisSection {
  return ANALYSIS_TABS.some((tab) => tab.id === value) ? value as AnalysisSection : 'cash';
}
