import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, effect, inject, signal, afterRenderEffect, ElementRef, untracked, viewChild } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { toSignal } from '@angular/core/rxjs-interop';
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
  Supplier, CompanyCost, IncomingPaymentRow, PartnerFinancing, StockLevel,
} from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { TicaApi, TicaAnalyticsDay } from '../../core/api/tica-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { Icon } from '../../shared/icon';
import { PageHeader } from '../../shared/page-header';
import { EurPipe, NumPipe, PctPipe } from '../../shared/pipes';
import { Ui } from '../../shared/ui';
import {
  inventoryAnalysis, lastSoldOn, missingCostRows, openPipelineQuotes, partnerFinancingAnalysis, receivedContainerRows, resultAnalysis, resultCostRows, salesAnalysis,
  salesDocumentRows, salesLineRows,
} from './analysis-metrics';
import { withTicaResult, withTicaSales } from './tica-analysis';
import { ticaBreakdown, ticaLineRange, type TicaBreakdown } from './tica-breakdown';
import { productSalesUnit, unitCount } from '../products/product-sales-unit';
import { FinanceApi } from '../../core/api/finance-api';
import { channelLabel } from '../sales/sales-channels';
import { categoryLabel } from '../finance/cost-categories';
import { costChargeIn, openOf } from '../finance/finance-metrics';
import { MarketAnalysis } from './market-analysis';
import { ContainerCostAnalysis } from './container-cost-analysis';
import { purchaseExternalCost } from '../purchasing/purchase-reconciliation-metrics';
import { WebsiteAnalytics } from './website-analytics';
import { averageLeadDays, inDateRange, receiptOrderRows, supplierReceiptPerformance, supplierScorecards } from './receipt-metrics';
import type { SupplierScorecard } from './receipt-metrics';
import { TrendChart, TrendSeries } from '../../shared/trend-chart';
import { incomingMoneyTotals } from '../finance/incoming-money';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { CashDesk } from './cash-desk';
import { CashPhone } from './cash-phone';
import { CashPageData, CashSources } from './cash-sources';
import { CashState } from './cash-state';
import { financingsWithSchedule, underBuffer } from './cash-view';
import { IosNav } from '../../shared/ios-nav';
import { NotificationBell } from '../../shared/notification-bell';
import { Sheet } from '../../shared/ui';
import { WorkQueue } from '../../core/api/work-queue';
import { NavHistory } from '../../core/platform/nav-history-service';
import { capsuleLabel, isWorkspaceUrl, screenLabel } from '../../core/platform/return-label';
import { originOf } from './analyses-origin';
import { analysesTabForKey } from './analyses-keys';
import { keyContext } from '../../shared/key-context';
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
import { ResultMonthBars } from './result-month-bars';
import { withAllLocations, fractionalDisplayCount } from './analyses-stock';
import { LoadError } from '../../shared/load-error';
import { AnHow, HOW_TEXTS } from './analyses-how';
import { AnPeriodPicker, AnPeriodSheet } from './analyses-period-picker';
import {
  DEFAULT_PERIOD, RECEIPT_PERIOD_KEYS, SALES_PERIOD_KEYS, parseOrderId, parsePart, parsePeriod, parseReceiptPeriod, parseSupplier, partParams,
  periodLabel, periodParams, periodRange, samePeriod, yearStart,
} from './analyses-period';
import type { InkoopPart } from './analyses-period';
import { Segmented } from '../../shared/segmented';
import type { SegmentOption } from '../../shared/segmented';
import { scrollBehavior } from '../../shared/motion';
import type { CostCharge, PartnerFinancingRow, SalesProductMetric } from './analysis-metrics';
import { AnDrill } from './an-drill';
import { AnDrillHost } from './drill-host';
import type { DrillView } from './drill-model';
import {
  acceptedView, channelView, countryView, customerView, funnelView, invoicedView, marginViews, openInvoicesView, openQuotesView, overdueView,
  productView, revenueViews, ticaMonthRows, ticaUnmatchedView,
} from './drill-sales';
import type { FunnelStep, SalesDrillContext } from './drill-sales';
import { incomingView, qualityViews, QUALITY_KEYS, reorderView, stockValueView, zeroNoIncomingView } from './drill-stock';
import {
  impactViews, partnersAwaitingView, partnersOpenView, partnersUnbilledView, receiptsView, supplierView, varianceGroups, varianceOrdersView,
} from './drill-purchase';
import type { ReceiptFigure, ReceivedOrderRow, VarianceGroup } from './drill-purchase';
import { categoryView, channelView as resultChannelView, costsView, generalCostsView, monthView, receivedView } from './drill-result';
import type { ResultDrillContext } from './drill-result';
import type { PeriodChoice } from './analyses-period';
import {
  advanceTermsSub, dayMonth, dollarValue, monthLabel, marketLines, openContainersLine, overdueSub, paymentResultLine, plural, rangeLabel, rangeLabelShort, varianceAttention,
  weekdayDayMonth, wholeNumber,
} from './analyses-words';

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
/** Lists that stop at 5 on the desk too, beside a shorter card (limitOf). */
const SHORT_LISTS = new Set(['follow']);

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
const LEGACY_BODIES = new Set<AnalysisSection>(['market', 'website']);
/** One link of the phone ⋯ sheet: a route (with its query), or an outside page in a new tab. */
interface MenuLink { label: string; url: string; icon: string; query?: Record<string, string | null> | null; external?: true }
/** The phone ⋯ sheet: the links the desk shows in the tool row (Resultaat's carries the period, menuLinks). */
const MENU_LINKS: Partial<Record<AnalysisSection, MenuLink[]>> = {
  sales: [{ label: 'Alle verkooporders', url: '/sales', icon: 'sales' }],
  inventory: [{ label: 'Jaarinventaris', url: '/stock/inventaris', icon: 'stock' }],
  result: [{ label: 'Alle kosten', url: '/costs', icon: 'receipt' }],
  website: [{ label: 'Dit toestel uitsluiten', url: 'https://www.enrosed.com/?intern=1', icon: 'globe', external: true }],
};
type PageSheet = 'period' | 'receipt' | 'partner' | 'value' | 'how' | 'menu' | null;
const RECEIPT_PERIOD_NOTE = 'Geldt voor Kwaliteit en Afwijkingen. Een order telt op zijn ontvangstdatum.';
const VARIANCE_FAILED = 'De ontvangstafwijkingen konden niet worden geladen.';
const PART_LABELS: Record<InkoopPart, string> = { kosten: 'Containerkost', kwaliteit: 'Kwaliteit', partners: 'Partners', afwijkingen: 'Afwijkingen' };
const PART_PHONE: Record<InkoopPart, string> = { kosten: 'Kosten', kwaliteit: 'Kwaliteit', partners: 'Partners', afwijkingen: 'Afwijkingen' };

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
}

type SalesTileKey = 'revenue' | 'margin' | 'invoiced' | 'received' | 'openQuotes' | 'accepted' | 'openInvoices' | 'overdue';
type ResultTileKey = 'revenue' | 'margin' | 'costs' | 'result' | 'received';
type StockTileKey = 'cost' | 'sales' | 'incoming' | 'reorder';
type PartnerTileKey = 'advance' | 'unbilled' | 'received' | 'open' | 'own' | 'result' | 'credit' | 'settle';

/** A figure tile: its four lines, and whether a click opens the list behind it (never on "—" or zero). */
interface KpiTile<K extends string = SalesTileKey> {
  key: K;
  label: string;
  value: string;
  /** A small word after the value ("SKU's", "containers"). */
  unit?: string;
  tone: 'danger' | 'warn' | null;
  sub: string;
  subWarn?: boolean;
  foot: string;
  footWarn?: boolean;
  drill: boolean;
}

/** Markt's stored period on this device (market-analysis.ts keeps it), 6 months by default. */
function storedMarketMonths(): Months {
  try {
    const months = (JSON.parse(localStorage.getItem('enrosed.market') ?? '{}') as { months?: number }).months;
    return months === 1 || months === 3 || months === 6 || months === 12 ? months : 6;
  } catch { return 6; }
}
/** Overzicht's Verkoop and Resultaat rows show this year: their link says so (D-O1, the page keeps its period across tabs). */
const YEAR_QUERY: Record<string, string> = { periode: 'jaar' };
const SALES_PERIOD_NOTE = 'Geldt voor Verkoop en Resultaat. Facturen tellen op hun documentdatum, ontvangsten op hun betaaldatum.';

/** Company-wide analysis with durable receipt losses as its operational drill-down. */
@Component({
  selector: 'app-analyses-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [CashState],
  /* The area's styles stay in this lazy chunk (styles.css is at the 1 MB initial budget); every rule is scoped under the page. */
  encapsulation: ViewEncapsulation.None,
  styleUrls: ['../../../styles/analyses.scss', '../../../styles/analyses-tabs.scss', '../../../styles/analyses-sources.scss', '../../../styles/analyses-drill.scss'],
  host: { '(document:visibilitychange)': 'visible()', '(document:keydown)': 'deskKey($event)' },
  imports: [Icon, TrendChart, AnDrill, CashDesk, CashPhone, AnHow, AnPeriodPicker, AnPeriodSheet, AnVisitorsRow, ResultMonthBars, LoadError, IosNav, NotificationBell, NgTemplateOutlet, Segmented, Sheet, Skeleton,
    RouterLink,
    PageHeader,
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
        <app-ios-nav [title]="phoneTitle()" [subtitle]="phoneCaption()" [backLabel]="backLabel()" [backAriaLabel]="backAria()" (back)="goBack()">
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
      @case ('receipt') {
        <app-sheet title="Periode" variant="ios" (closed)="sheet.set(null)">
          <app-an-period-sheet body [value]="receiptPeriod()" [today]="today()" [note]="receiptNote"
                               (picked)="setReceiptPeriod($event); sheet.set(null)" (changed)="setReceiptPeriod($event)" />
        </app-sheet>
      }
      @case ('partner') {
        @if (partnerSheetRow(); as row) {
          <app-sheet [title]="partnerName(row)" variant="ios" (closed)="sheet.set(null)">
            <div body class="an-sheet-body">
              <div class="ios-group">
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Partner</span></span><span class="ios-cell__value">{{ row.partnerName }}@if (row.sharePct !== null) { · {{ row.sharePct | num }} % }</span></div>
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Externe kost</span><span class="ios-cell__sub">{{ row.costFinalized ? 'definitief' : 'verwacht' }}</span></span><span class="ios-cell__value">{{ whole(row.landedEur) }}</span></div>
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Ontvangen</span><span class="ios-cell__sub">incl. btw</span></span><span class="ios-cell__value">{{ whole(row.receivedEur) }}</span></div>
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Voorschot gefactureerd</span><span class="ios-cell__sub">excl. btw</span></span><span class="ios-cell__value">{{ whole(row.invoicedEur) }}</span></div>
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Gecrediteerd</span></span><span class="ios-cell__value">{{ whole(row.creditedEur) }}</span></div>
                <a class="ios-cell" [routerLink]="['/purchasing', row.purchaseOrderId]" [queryParams]="{ section: 'payments' }" (click)="sheet.set(null)">
                  <span class="ios-cell__body"><span class="ios-cell__title">Te factureren</span>
                    <span class="ios-cell__sub">{{ row.unbilledAdvanceCount ? plural(row.unbilledAdvanceCount, 'termijn', 'termijnen') : 'geen termijnen' }}@if (row.nextAdvanceDueDate) { · volgende {{ dayText(row.nextAdvanceDueDate) }} } · naar betalingen</span></span>
                  <span class="ios-cell__value" [class.is-danger]="row.overdueUnbilledAdvanceEur > 0">{{ whole(row.unbilledAdvanceEur) }}</span><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></a>
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Open</span><span class="ios-cell__sub">incl. btw</span></span><span class="ios-cell__value" [class.is-warn]="row.openEur > 0">{{ whole(row.openEur) }}</span></div>
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Eigen kasinleg</span></span><span class="ios-cell__value">{{ whole(row.ownExposureEur) }}</span></div>
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Resultaat</span><span class="ios-cell__sub">{{ partnerState(row) }}</span></span><span class="ios-cell__value" [class.is-danger]="row.resultEur < 0">{{ whole(row.resultEur) }}</span></div>
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Credit</span></span><span class="ios-cell__value">{{ whole(row.creditEur) }}</span></div>
              </div>
              <div class="ios-section">
                <div class="ios-section__head"><h3 class="ios-section__title">Documenten</h3></div>
                <div class="ios-group">
                  @for (doc of row.documents; track doc.id) {
                    <a class="ios-cell" [routerLink]="['/sales', doc.id, 'edit']" (click)="sheet.set(null)"><span class="ios-cell__body"><span class="ios-cell__title">{{ doc.number }}</span><span class="ios-cell__sub">{{ documentKind(doc) }}</span></span><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></a>
                  } @empty { <div class="ios-cell"><span class="ios-cell__sub">Geen documenten</span></div> }
                </div>
              </div>
              <a class="ios-capsule ios-capsule--accent ios-capsule--block" [routerLink]="['/purchasing', row.purchaseOrderId]" (click)="sheet.set(null)">Inkooporder openen</a>
            </div>
          </app-sheet>
        }
      }
      @case ('value') {
        @if (valueSheetRow(); as row) {
          <app-sheet title="Waarde per stuk" variant="ios" (closed)="sheet.set(null)">
            <div body class="an-sheet-body">
              <p class="ios-caption an-value-sheet__what">{{ productLabel(row) }} · {{ containerOf(row.orderId, row.orderNumber, row.orderAlias) }}</p>
              <div class="ios-group"><label class="ios-cell an-value-cell"><span class="ios-cell__body"><span class="ios-cell__title">Waarde per stuk</span></span>
                <span class="an-money an-money--ios"><span aria-hidden="true">€</span><input type="text" inputmode="decimal" autocomplete="off" [value]="draftValue(row)" [disabled]="savingValue() === valueKey(row)"
                  (input)="setDraftValue(row, $any($event.target).value)" (keydown.enter)="saveValue(row)" /></span></label></div>
              <p class="ios-section__foot" [class.is-warn]="row.receiptUnitValueEur === null">{{ valueHint(row) }}</p>
            </div>
            <div foot class="an-sheet-foot">
              <button class="btn btn--primary" type="button" [attr.aria-label]="'Bewaar waarde per stuk voor ' + productLabel(row)" [disabled]="!canSaveValue(row)" (click)="saveValue(row)">{{ savingValue() === valueKey(row) ? 'Bewaren…' : 'Bewaren' }}</button>
            </div>
          </app-sheet>
        }
      }
      @case ('how') {
        <app-sheet title="Hoe gerekend" variant="ios" (closed)="sheet.set(null)">
          <div body class="an-sheet-text">@for (line of howLines(); track $index) { <p>{{ line }}</p> }</div>
        </app-sheet>
      }
      @case ('menu') {
        <app-sheet [title]="phoneTitle()" variant="ios" (closed)="sheet.set(null)">
          <div body class="ios-group">
            @if (howLines().length) {
              <button class="ios-cell" type="button" (click)="sheet.set('how')"><app-icon name="info" [size]="18" />
                <span class="ios-cell__body"><span class="ios-cell__title">Hoe gerekend</span></span></button>
            }
            @if (section() === 'market') {
              <button class="ios-cell" type="button" (click)="addRate()"><app-icon name="plus" [size]="18" />
                <span class="ios-cell__body"><span class="ios-cell__title">Tarief toevoegen</span></span></button>
            }
            @for (link of menuLinks(); track link.url) {
              @if (link.external) {
                <a class="ios-cell" [href]="link.url" target="_blank" rel="noopener" (click)="sheet.set(null)"><app-icon [name]="link.icon" [size]="18" />
                  <span class="ios-cell__body"><span class="ios-cell__title">{{ link.label }}</span></span><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></a>
              } @else {
                <a class="ios-cell" [routerLink]="link.url" [queryParams]="link.query ?? null" (click)="sheet.set(null)"><app-icon [name]="link.icon" [size]="18" />
                  <span class="ios-cell__body"><span class="ios-cell__title">{{ link.label }}</span></span><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></a>
              }
            }
          </div>
        </app-sheet>
      }
    }
    <!-- The one drill-down of every tab (design/analyses2 §A.2): page level, outside the faded body and the Kasprognose size container. -->
    <app-an-drill />

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
          <div class="an-bar"><span class="an-bar__text">Momentopname {{ todayText() }}@if (loadedAt()) { {{ loadedAt() }} } · tempo: facturen van {{ inventoryMetrics().velocity.days }} dagen, zonder TICA</span>
            <div class="an-bar__end"><app-an-how [lines]="how.inventory" /><a class="wk-btn" routerLink="/stock/inventaris">Jaarinventaris ›</a></div></div>
        }
        @case ('purchasing') {
          <div class="an-bar">
            <app-segmented label="Deel" semantics="tabs" [options]="partOptions()" [value]="part()" (changed)="setPart($any($event))" />
            <div class="an-bar__end"><app-an-how [lines]="howLines()" />
              @if (part() === 'kosten') { <a class="wk-btn" routerLink="/costs">Kosten &amp; bank ›</a> }
              @if (part() === 'partners') { <a class="wk-btn" routerLink="/sales">Verkooporders ›</a> }
            </div>
          </div>
        }
        @case ('result') {
          <div class="an-bar">
            <app-an-period [value]="salesPeriod()" [today]="today()" [note]="salesNote" idPrefix="an-result" (changed)="setSalesPeriod($event)" />
            <span class="an-bar__text">{{ salesRangeText() }} · alles excl. btw</span>
            <div class="an-bar__end"><app-an-how [lines]="how.result" /><a class="wk-btn" routerLink="/costs" [queryParams]="costsQuery()">Alle kosten ›</a></div>
          </div>
        }
      }
      } @else {
      @switch (tab) {
        @case ('sales') { <ng-container *ngTemplateOutlet="phonePeriod; context: { $implicit: ' · op documentdatum' }" /> }
        @case ('result') { <ng-container *ngTemplateOutlet="phonePeriod; context: { $implicit: ' · alles excl. btw' }" /> }
        @case ('inventory') {
          <div class="an-bar"><span class="an-bar__text">Momentopname {{ todayText() }}@if (loadedAt()) { {{ loadedAt() }} } · tempo: {{ inventoryMetrics().velocity.days }} dagen, zonder TICA</span></div>
        }
        @case ('purchasing') {
          <div class="an-bar an-bar--seg">
            <app-segmented class="an-parts" variant="ios" label="Deel" semantics="tabs" [options]="partOptionsPhone()" [value]="part()" (changed)="setPart($any($event))" />
          </div>
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
        <div class="an-cols">
          <div class="an-col">
            <section class="an-card" aria-labelledby="an-ov-parts">
              <header class="an-card__head"><h2 class="an-card__title" id="an-ov-parts">Per onderdeel</h2><span class="an-card__trail">dit jaar</span></header>
              <div class="an-card__body">
                @if (loading()) { <app-skeleton class="an-skeleton" [kind]="desk.active() ? 'list' : 'group'" [rows]="4" /> } @else {
                  @let cash = cashRow();
                  <a class="an-row an-row--chev an-row--icons" routerLink="/analyses/cash">
                    <span class="an-tile tone-ok"><app-icon name="bank" [size]="17" /></span>
                    <span class="an-row__body"><span class="an-row__title">Kasprognose</span><span class="an-row__sub">{{ cash.sub }}</span></span>
                    <span class="an-row__end"><span class="an-row__value" [attr.data-tone]="cash.tone">{{ cash.value }}</span>
                      @if (cash.meta) { <span class="an-row__meta">{{ cash.meta }}</span> }</span>
                    <span class="an-row__chev" aria-hidden="true">›</span>
                  </a>
                  @let ys = ytdSales();
                  <a class="an-row an-row--chev an-row--icons" routerLink="/analyses/sales" [queryParams]="yearQuery">
                    <span class="an-tile tone-accent"><app-icon name="sales" [size]="17" /></span>
                    <span class="an-row__body"><span class="an-row__title">Verkoop</span>
                      <!-- The phone words are shorter so each sub keeps to two lines at 360 (critique B2.1); every number stays. -->
                      <span class="an-row__sub">{{ channelVolume(ys.invoices.revenueInvoiceCount, ys.ticaTransactions) }}</span>
                      <span class="an-row__sub">{{ failed('verkoop') ? '—' : whole(ys.invoices.issuedValueEur) }} {{ desk.active() ? 'gefactureerd incl. btw' : 'gefactureerd' }}</span></span>
                    <span class="an-row__end"><span class="an-row__value">{{ failed('verkoop') || failed('TICA verkopen') ? '—' : whole(ys.revenueExclEur) }}</span>
                      <span class="an-row__meta">excl. btw</span></span>
                    <span class="an-row__chev" aria-hidden="true">›</span>
                  </a>
                  @let yr = ytdResult();
                  @let yrUnknown = failed('verkoop') || failed('TICA verkopen') || failed('kosten');
                  <a class="an-row an-row--chev an-row--icons" routerLink="/analyses/result" [queryParams]="yearQuery">
                    <span class="an-tile tone-plum"><app-icon name="receipt" [size]="17" /></span>
                    <span class="an-row__body"><span class="an-row__title">Resultaat</span>
                      <span class="an-row__sub">marge {{ yrUnknown || yr.missingCostLines ? '—' : whole(yr.marginEur) }} − kosten {{ failed('kosten') ? '—' : whole(yr.costsEur) }}</span></span>
                    <span class="an-row__end"><span class="an-row__value" [attr.data-tone]="!yrUnknown && !yr.missingCostLines && yr.resultEur < 0 ? 'danger' : null">{{ yrUnknown || yr.missingCostLines ? '—' : whole(yr.resultEur) }}</span>
                      <span class="an-row__meta">excl. btw</span></span>
                    <span class="an-row__chev" aria-hidden="true">›</span>
                  </a>
                  @let inv = inventoryMetrics();
                  <a class="an-row an-row--chev an-row--icons" routerLink="/analyses/inventory">
                    <span class="an-tile tone-green"><app-icon name="stock" [size]="17" /></span>
                    <span class="an-row__body"><span class="an-row__title">Voorraad</span>
                      <span class="an-row__sub">{{ inv.physicalStock.knownPieces | num }} fysieke stuks</span></span>
                    <span class="an-row__end"><span class="an-row__value">{{ failed('voorraad') ? '—' : whole(inv.stock.costValueEur) }}</span>
                      <span class="an-row__meta">kostwaarde</span></span>
                    <span class="an-row__chev" aria-hidden="true">›</span>
                  </a>
                  @let cd = containerDigest();
                  <a class="an-row an-row--chev an-row--icons" routerLink="/analyses/purchasing">
                    <span class="an-tile tone-amber"><app-icon name="purchase" [size]="17" /></span>
                    <span class="an-row__body"><span class="an-row__title">Inkoop</span>
                      <span class="an-row__sub">{{ openContainersLine(cd.openCount, cd.totals.provisionalCount) }}</span>
                      @if (paymentResultLine(cd.payment.netResultEur, cd.payment.eligibleCount); as line) { <span class="an-row__sub">{{ line }}</span> }</span>
                    <span class="an-row__end"><span class="an-row__value">{{ failed('inkoop') ? '—' : whole(cd.totals.remainingEur) }}</span>
                      <span class="an-row__meta">nog te betalen</span></span>
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
                  <!-- A count opens the list behind it (design/analyses2 §B.2); a zero row is plain and muted. -->
                  @for (row of attention(); track row.key) {
                    @if (row.count > 0) {
                      <button class="an-row an-row--chev" type="button" aria-haspopup="dialog" (click)="openAttention(row.key)">
                        <ng-container *ngTemplateOutlet="attentionBody; context: { $implicit: row }" />
                        <span class="an-row__chev" aria-hidden="true">›</span>
                      </button>
                    } @else {
                      <div class="an-row an-row--chev is-muted"><ng-container *ngTemplateOutlet="attentionBody; context: { $implicit: row }" /><span aria-hidden="true"></span></div>
                    }
                  }
                }
              </div>
            </section>
          </div>
        </div>
      }

      @if (section() === 'sales') {
        @let m = salesMetrics();
        @if (loading()) {
          <div class="an-kpis" aria-label="Verkoop laden">@for (n of [1, 2, 3, 4, 5, 6, 7, 8]; track n) { <div class="an-kpi an-kpi--loading"><span></span><span></span><span></span></div> }</div>
        } @else {
          <!-- A tile opens the list behind its figure (design/analyses2 §B.3); "—" or zero is a plain tile; Ontvangen links to Kosten & bank. -->
          <div class="an-kpis">
            @for (k of salesTiles(); track k.key) {
              @if (k.key === 'received') {
                <a class="an-kpi an-kpi--link" data-kpi="received" routerLink="/costs" [queryParams]="incomingQuery()"><ng-container *ngTemplateOutlet="kpiBody; context: { $implicit: k }" /></a>
              } @else if (k.drill) {
                <button class="an-kpi an-kpi--drill" type="button" aria-haspopup="dialog" [attr.data-kpi]="k.key" (click)="openTile(k.key)"><ng-container *ngTemplateOutlet="kpiBody; context: { $implicit: k }" /></button>
              } @else {
                <div class="an-kpi" [attr.data-kpi]="k.key"><ng-container *ngTemplateOutlet="kpiBody; context: { $implicit: k }" /></div>
              }
            }
          </div>
        }
        <div class="an-cols">
          <div class="an-col">
            <section class="an-card" aria-labelledby="an-funnel-title">
              <header class="an-card__head"><h2 class="an-card__title" id="an-funnel-title">Offertes</h2><span class="an-card__sub">van aangemaakt tot geaccepteerd</span>
                @if (!loading()) { <span class="an-card__trail">{{ funnelTrail() }}</span> }</header>
              <div class="an-card__body">
                @if (loading()) { <app-skeleton class="an-skeleton" [kind]="desk.active() ? 'list' : 'group'" [rows]="4" /> } @else {
                  <!-- Every step with offertes opens them (design/analyses2 §B.3); Conversie is the Geaccepteerd step's rate. -->
                  <div class="an-funnel">
                    @for (step of funnelSteps(); track step.key) {
                      @if (step.count > 0) {
                        <button class="an-funnel__row" type="button" aria-haspopup="dialog" [class.an-funnel__row--accent]="step.accent" (click)="openFunnel(step.key)">
                          <ng-container *ngTemplateOutlet="funnelStep; context: { $implicit: step }" /></button>
                      } @else {
                        <div class="an-funnel__row" [class.an-funnel__row--accent]="step.accent"><ng-container *ngTemplateOutlet="funnelStep; context: { $implicit: step }" /></div>
                      }
                    }
                  </div>
                  <p class="an-funnel__foot">
                    @for (item of funnelFoot(); track item.key) {
                      @if (item.count > 0) {
                        <button class="an-funnel__item" type="button" aria-haspopup="dialog" (click)="openFunnel(item.key)">{{ item.label }} <b>{{ item.count | num }}</b></button>
                      } @else { <span>{{ item.label }} <b>{{ item.count | num }}</b></span> }
                    }
                  </p>
                }
              </div>
            </section>
            <section class="an-card" aria-labelledby="an-trend-title">
              <header class="an-card__head"><h2 class="an-card__title" id="an-trend-title">Omzet per maand</h2>
                <span class="an-card__trail">excl. btw</span></header>
              <div class="an-card__body an-card__pad">
                @if (loading()) { <app-skeleton kind="card" /> } @else {
                  <app-trend-chart [series]="salesTrend()" prefix="€ " [decimals]="0" [height]="desk.active() ? 190 : 160"
                                   ariaLabel="Omzet en geaccepteerde offertes per maand, excl. btw" emptyText="Nog geen omzet of geaccepteerde offertes in deze periode" />
                }
              </div>
            </section>
          </div>
          <div class="an-col">
            <section class="an-card" aria-labelledby="an-channel-title">
              <header class="an-card__head"><h2 class="an-card__title" id="an-channel-title">Omzet per kanaal</h2><span class="an-card__trail">excl. btw</span></header>
              <div class="an-card__body">
                @if (loading()) { <app-skeleton class="an-skeleton" [kind]="desk.active() ? 'list' : 'group'" [rows]="3" /> } @else {
                  <!-- A channel opens its documents; TICA leads to the TICA list of the period (its card below has the rest). -->
                  @for (channel of m.channels; track channel.channel) {
                    @if (channel.channel === 'TICA' && channel.ticaTransactions) {
                      <a class="an-row an-share" routerLink="/tica" [queryParams]="ticaQuery()"><ng-container *ngTemplateOutlet="channelBody; context: { $implicit: channel }" /></a>
                    } @else if (channel.revenueExclEur !== 0 && !failed('verkoop')) {
                      <button class="an-row an-share" type="button" aria-haspopup="dialog" (click)="openChannel(channel.channel, channel.revenueExclEur)"><ng-container *ngTemplateOutlet="channelBody; context: { $implicit: channel }" /></button>
                    } @else {
                      <div class="an-row an-share"><ng-container *ngTemplateOutlet="channelBody; context: { $implicit: channel }" /></div>
                    }
                  } @empty { <p class="an-empty">Geen facturen of TICA-verkopen in deze periode.</p> }
                }
              </div>
            </section>
            <section class="an-card" aria-labelledby="an-follow-title">
              <!-- A to-do list is today's, over every year (D-S2): whatever period the tab shows. -->
              @let follow = allSales().attentionOrders;
              <header class="an-card__head"><h2 class="an-card__title" id="an-follow-title">Opvolgen</h2><span class="an-card__sub">vandaag</span>
                @if (!loading()) { <span class="an-card__trail">{{ follow.length }}</span> }</header>
              <div class="an-card__body">
                @if (loading()) { <app-skeleton class="an-skeleton" [kind]="desk.active() ? 'list' : 'group'" [rows]="4" /> } @else {
                  @for (order of take('follow', follow); track order.orderId) {
                    <a class="an-row an-row--nolead an-row--chev" [class.mo-fade]="$index >= limitOf('follow')" [routerLink]="['/sales', order.orderId]">
                      <span class="an-row__body"><span class="an-row__title">{{ order.number }}</span>
                        <span class="an-row__sub">{{ order.customerName }} · {{ dayText(order.orderDate) }}</span>
                        <span class="an-row__chips">@for (reason of order.reasons; track reason) { <span class="an-chip" [attr.data-tone]="order.severity === 'danger' ? 'danger' : 'muted'">{{ reason }}</span> }</span></span>
                      <span class="an-row__end"><span class="an-row__value">{{ whole(order.calculatedValueEur) }}</span>
                        <span class="an-row__meta">{{ followMeta(order.docType) }}</span></span>
                      <span class="an-row__chev" aria-hidden="true">›</span>
                    </a>
                  } @empty { <p class="an-empty">Geen verkooporders vragen nu aandacht.</p> }
                  <ng-container *ngTemplateOutlet="more; context: { key: 'follow', total: follow.length }" />
                }
              </div>
            </section>
          </div>
        </div>
        <div class="an-cols an-cols--3">
          <section class="an-card" aria-labelledby="an-countries-title">
            <header class="an-card__head"><h2 class="an-card__title" id="an-countries-title">Landen</h2><span class="an-card__trail">excl. btw</span></header>
            <div class="an-card__body">
              @if (loading()) { <app-skeleton class="an-skeleton" [kind]="desk.active() ? 'list' : 'group'" [rows]="3" /> } @else {
                @for (country of take('countries', m.topCountries); track country.countryCode ?? 'none') {
                  <button class="an-row an-row--chev" type="button" aria-haspopup="dialog" [class.mo-fade]="$index >= listLimit()" [disabled]="!country.revenueExclEur"
                          (click)="openCountry(country.countryCode, country.revenueExclEur)">
                    <span class="an-rank">{{ $index + 1 }}</span>
                    <span class="an-row__body"><span class="an-row__title">{{ countryLabel(country.countryCode) }}</span><span class="an-row__sub">{{ plural(country.orderCount, 'factuur', 'facturen') }}</span></span>
                    <span class="an-row__end"><span class="an-row__value">{{ whole(country.revenueExclEur) }}</span></span>
                    <span class="an-row__chev" aria-hidden="true">{{ country.revenueExclEur ? '›' : '' }}</span>
                  </button>
                } @empty { <p class="an-empty">Geen uitgegeven facturen in deze periode.</p> }
                <ng-container *ngTemplateOutlet="more; context: { key: 'countries', total: m.topCountries.length }" />
              }
            </div>
          </section>
          <section class="an-card" aria-labelledby="an-customers-title">
            <header class="an-card__head"><h2 class="an-card__title" id="an-customers-title">Klanten</h2><span class="an-card__trail">excl. btw</span></header>
            <div class="an-card__body">
              @if (loading()) { <app-skeleton class="an-skeleton" [kind]="desk.active() ? 'list' : 'group'" [rows]="3" /> } @else {
                @for (customer of take('customers', m.topCustomers); track customer.customerId ?? customer.name) {
                  <button class="an-row an-row--chev" type="button" aria-haspopup="dialog" [class.mo-fade]="$index >= listLimit()" (click)="openCustomer(customer.customerId, customer.name, customer.revenueExclEur)">
                    <span class="an-rank">{{ $index + 1 }}</span>
                    <span class="an-row__body"><span class="an-row__title">{{ failed('klanten') ? '—' : customer.name }}</span>
                      <span class="an-row__sub">{{ plural(customer.orderCount, 'factuur', 'facturen') }} · {{ customer.pieces | num }} st</span></span>
                    <span class="an-row__end"><span class="an-row__value">{{ whole(customer.revenueExclEur) }}</span></span>
                    <span class="an-row__chev" aria-hidden="true">›</span>
                  </button>
                } @empty { <p class="an-empty">Geen uitgegeven facturen in deze periode.</p> }
                <ng-container *ngTemplateOutlet="more; context: { key: 'customers', total: m.topCustomers.length }" />
              }
            </div>
          </section>
          <section class="an-card" aria-labelledby="an-products-title">
            <header class="an-card__head"><h2 class="an-card__title" id="an-products-title">Producten</h2><span class="an-card__trail">goederen excl. btw</span></header>
            <div class="an-card__body">
              @if (loading()) { <app-skeleton class="an-skeleton" [kind]="desk.active() ? 'list' : 'group'" [rows]="3" /> } @else {
                @for (product of take('products', m.topProducts); track product.productId) {
                  <button class="an-row an-row--chev" type="button" aria-haspopup="dialog" [class.mo-fade]="$index >= listLimit()" (click)="openProduct(product)">
                    <span class="an-rank">{{ $index + 1 }}</span>
                    <span class="an-row__body"><span class="an-row__title">{{ productName(product.productId, product.name) }}</span>
                      <span class="an-row__sub">{{ product.sku || 'Geen SKU' }} · {{ unitWords(product.productId, product.pieces) }}</span></span>
                    <span class="an-row__end"><span class="an-row__value">{{ whole(product.calculatedGoodsValueEur) }}</span></span>
                    <span class="an-row__chev" aria-hidden="true">›</span>
                  </button>
                } @empty { <p class="an-empty">Geen uitgegeven factuurregels in deze periode.</p> }
                <ng-container *ngTemplateOutlet="more; context: { key: 'products', total: m.topProducts.length }" />
              }
            </div>
          </section>
        </div>
        <!-- TICA: what its channel row cannot say (averages, discount, products, vestigingen); omzet stays in Omzet per kanaal. -->
        @if (!loading() && ticaLines()) {
          @let tc = ticaCard();
          <section class="an-card an-tica" aria-labelledby="an-tica-title">
            <header class="an-card__head"><h2 class="an-card__title" id="an-tica-title">TICA</h2><span class="an-card__sub">na korting excl. btw@if (ticaFrom(); as from) { · vanaf {{ dayText(from) }} }</span>
              <span class="an-card__trail"><a class="an-link" routerLink="/tica" [queryParams]="ticaQuery()">TICA verkopen ›</a></span></header>
            <div class="an-card__body">
              @if (tc.state === 'loading') {
                <app-skeleton class="an-skeleton" [kind]="desk.active() ? 'list' : 'group'" [rows]="3" />
              } @else if (tc.state === 'failed' || !tc.data) {
                <p class="an-empty">TICA-regels konden niet worden geladen.</p>
                <button class="an-more" type="button" (click)="loadTicaCard(ticaLines()!)">Opnieuw proberen</button>
              } @else {
                @let t = tc.data;
                <dl class="an-tica__figs">
                  <div><dt>Gem. per stuk</dt><dd>{{ t.perPieceEur === null ? '—' : (t.perPieceEur | eur) }}</dd><dd class="an-tica__sub">{{ t.pieces | num }} st</dd></div>
                  <div><dt>Gem. per verkoop</dt><dd>{{ t.perSaleEur === null ? '—' : (t.perSaleEur | eur) }}</dd><dd class="an-tica__sub">{{ plural(t.transactions, 'verkoop', 'verkopen') }}</dd></div>
                  <div><dt>Korting</dt><dd>{{ whole(t.discountEur) }}</dd><dd class="an-tica__sub">{{ discountShare(t.discountEur, t.netEur + t.discountEur) }}</dd></div>
                  <div [class.is-warn]="t.unmatchedLines > 0"><dt>Niet herkend</dt>
                    <dd>@if (t.unmatchedLines > 0) { <button class="an-tica__drill" type="button" aria-haspopup="dialog" (click)="openTicaUnmatched()">{{ plural(t.unmatchedLines, 'regel', 'regels') }} <span aria-hidden="true">›</span></button> }
                      @else { {{ plural(t.unmatchedLines, 'regel', 'regels') }} }</dd><dd class="an-tica__sub">zonder ERP-product</dd></div>
                </dl>
                <div class="an-tica__lists" [class.an-tica__lists--two]="t.locations.length > 1">
                  <div>
                    <h3 class="an-tica__h">Producten</h3>
                    @for (product of take('tica', t.products); track product.key) {
                      <a class="an-row" [class.an-row--chev]="!!product.productId" [class.mo-fade]="$index >= listLimit()"
                         [routerLink]="product.productId ? ['/products', product.productId] : '/tica'" [queryParams]="product.productId ? null : ticaQuery()">
                        <span class="an-rank">{{ $index + 1 }}</span>
                        <span class="an-row__body"><span class="an-row__title">{{ product.name }}</span>
                          <span class="an-row__sub">{{ product.pieces | num }} st · gem. {{ product.perPieceEur === null ? '—' : (product.perPieceEur | eur) }}@if (!product.productId) { · niet herkend }</span></span>
                        <span class="an-row__end"><span class="an-row__value">{{ whole(product.netEur) }}</span></span>
                        @if (product.productId) { <span class="an-row__chev" aria-hidden="true">›</span> }
                      </a>
                    } @empty { <p class="an-empty">Geen TICA-regels in deze periode.</p> }
                    <ng-container *ngTemplateOutlet="more; context: { key: 'tica', total: t.products.length }" />
                    @if (!t.complete) { <p class="an-empty">Producten uit de nieuwste 5.000 regels.</p> }
                  </div>
                  @if (t.locations.length > 1) {
                    <div>
                      <h3 class="an-tica__h">Vestigingen</h3>
                      @for (place of t.locations; track place.location) {
                        <div class="an-row an-row--nolead">
                          <span class="an-row__body"><span class="an-row__title">{{ place.location }}</span>
                            <span class="an-row__sub">{{ plural(place.transactions, 'verkoop', 'verkopen') }} · {{ place.pieces | num }} st</span></span>
                          <span class="an-row__end"><span class="an-row__value">{{ whole(place.netEur) }}</span></span>
                        </div>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          </section>
        }
      }

      @if (section() === 'inventory') {
        @let im = inventoryMetrics();
        @if (loading()) {
          <div class="an-kpis" aria-label="Voorraad laden">@for (n of [1, 2, 3, 4]; track n) { <div class="an-kpi an-kpi--loading"><span></span><span></span><span></span></div> }</div>
        } @else {
          <!-- A tile opens the list behind its figure (design/analyses2 §B.5); "—" or zero is a plain tile. -->
          <div class="an-kpis">
            @for (k of stockTiles(); track k.key) {
              @if (k.drill) {
                <button class="an-kpi an-kpi--drill" type="button" aria-haspopup="dialog" [attr.data-kpi]="k.key" (click)="openStockTile(k.key)"><ng-container *ngTemplateOutlet="kpiBody; context: { $implicit: k }" /></button>
              } @else {
                <div class="an-kpi" [attr.data-kpi]="k.key"><ng-container *ngTemplateOutlet="kpiBody; context: { $implicit: k }" /></div>
              }
            }
          </div>
          <!-- Each count after "met stand" opens the products it counts; "onbekend" counts active, non-demo products only (D-V5). -->
          <p class="an-quality" role="status">Datakwaliteit:
            <span><b>{{ im.stock.knownSkuCount | num }}</b> {{ im.stock.knownSkuCount === 1 ? 'SKU' : 'SKU’s' }} met stand</span>
            @for (item of qualityItems(); track item.key) {
              · @if (item.count > 0) {
                <button class="an-link is-warn" type="button" aria-haspopup="dialog" (click)="openQuality($index)"><b>{{ item.count | num }}</b> {{ item.label }}</button>
              } @else { <span><b>0</b> {{ item.label }}</span> }
            }</p>
        }
        <div class="an-cols">
          <div class="an-col">
            <section class="an-card" aria-labelledby="an-zero-title">
              <header class="an-card__head"><h2 class="an-card__title" id="an-zero-title">Nulvoorraad</h2>
                @if (!loading()) { <span class="an-card__trail">{{ im.zeroStock.withoutIncomingCount }} zonder aanvulling · {{ im.zeroStock.count }} in totaal</span> }</header>
              <div class="an-card__body">
                @if (loading()) { <app-skeleton class="an-skeleton" [kind]="desk.active() ? 'list' : 'group'" [rows]="4" /> } @else {
                  @for (row of take('zero', im.zeroStock.rows); track row.productId) {
                    <a class="an-row an-row--nolead an-row--chev" [class.mo-fade]="$index >= listLimit()" [routerLink]="['/products', row.productId]">
                      <span class="an-row__body"><span class="an-row__title">{{ row.name }}</span><span class="an-row__sub">{{ row.sku || 'Geen SKU' }}@if (row.colour) { · {{ row.colour }} }@if (lastSold().get(row.productId); as day) { · laatst verkocht {{ dayText(day) }} }</span></span>
                      <span class="an-row__end">@if (row.expectedPieces > 0) { <span class="an-row__meta" data-tone="ok">{{ unitWords(row.productId, row.expectedPieces) }} onderweg</span> }
                        @else { <span class="an-row__meta" data-tone="warn">Geen inkoop onderweg</span> }</span>
                      <span class="an-row__chev" aria-hidden="true">›</span>
                    </a>
                  } @empty { <p class="an-empty">Geen actieve producten met nulvoorraad.</p> }
                  <ng-container *ngTemplateOutlet="more; context: { key: 'zero', total: im.zeroStock.rows.length }" />
                }
              </div>
            </section>
            <section class="an-card" aria-labelledby="an-carton-title">
              <header class="an-card__head"><h2 class="an-card__title" id="an-carton-title">Minder dan één omdoos</h2>
                @if (!loading()) { <span class="an-card__trail">{{ plural(im.belowCarton.count, 'SKU', 'SKU’s') }}</span> }</header>
              <div class="an-card__body">
                @if (loading()) { <app-skeleton class="an-skeleton" [kind]="desk.active() ? 'list' : 'group'" [rows]="2" /> } @else {
                  @for (row of take('carton', im.belowCarton.rows); track row.productId) {
                    <a class="an-row an-row--nolead an-row--chev" [class.mo-fade]="$index >= listLimit()" [routerLink]="['/products', row.productId]">
                      <span class="an-row__body"><span class="an-row__title">{{ row.name }}</span><span class="an-row__sub">{{ row.sku || 'Geen SKU' }} · {{ unitWords(row.productId, row.stockPieces) }} op voorraad</span></span>
                      <span class="an-row__end"><span class="an-row__meta" data-tone="warn">{{ unitWords(row.productId, row.missingPiecesToCarton ?? 0) }} nodig voor omdoos</span></span>
                      <span class="an-row__chev" aria-hidden="true">›</span>
                    </a>
                  } @empty { <p class="an-empty">Alle bekende positieve voorraden vullen minstens één omdoos.</p> }
                  <ng-container *ngTemplateOutlet="more; context: { key: 'carton', total: im.belowCarton.rows.length }" />
                }
              </div>
            </section>
          </div>
          <div class="an-col">
            <section class="an-card" aria-labelledby="an-incoming-title">
              <header class="an-card__head"><h2 class="an-card__title" id="an-incoming-title">Onderweg</h2>
                @if (!loading()) { <span class="an-card__trail">{{ plural(im.incoming.skuCount, 'SKU', 'SKU’s') }}</span> }</header>
              <div class="an-card__body">
                @if (loading()) { <app-skeleton class="an-skeleton" [kind]="desk.active() ? 'list' : 'group'" [rows]="4" /> } @else {
                  @for (row of take('incoming', incomingRows()); track row.productId) {
                    <a class="an-row an-row--nolead an-row--chev" [class.mo-fade]="$index >= listLimit()" [routerLink]="['/products', row.productId]">
                      <span class="an-row__body"><span class="an-row__title">{{ row.name }}@if (row.colour) { · {{ row.colour }} }</span>
                        <span class="an-row__sub">{{ row.sku || 'Geen SKU' }} · {{ row.containers }}</span></span>
                      <span class="an-row__end"><span class="an-row__value">{{ unitWords(row.productId, row.pieces) }}</span>
                        <span class="an-row__meta">{{ row.expectedArrival ? dayText(row.expectedArrival) : 'zonder ETA' }}</span></span>
                      <span class="an-row__chev" aria-hidden="true">›</span>
                    </a>
                  } @empty { <p class="an-empty">Niets onderweg: geen open inkooporders met producten.</p> }
                  <ng-container *ngTemplateOutlet="more; context: { key: 'incoming', total: incomingRows().length }" />
                }
              </div>
            </section>
            <section class="an-card" aria-labelledby="an-reorder-title">
              <header class="an-card__head"><h2 class="an-card__title" id="an-reorder-title">Raakt binnenkort op</h2><span class="an-card__trail">op het tempo van {{ im.velocity.days }} dagen</span></header>
              <div class="an-card__body">
                @if (loading()) { <app-skeleton class="an-skeleton" [kind]="desk.active() ? 'list' : 'group'" [rows]="2" /> } @else {
                  @for (row of take('reorder', im.reorder.rows); track row.productId) {
                    <a class="an-row an-row--nolead an-row--chev" [class.mo-fade]="$index >= listLimit()" [routerLink]="['/products', row.productId]">
                      <span class="an-row__body"><span class="an-row__title">{{ row.name }}</span>
                        <span class="an-row__sub">{{ row.sku || 'Geen SKU' }}@if (row.colour) { · {{ row.colour }} } · {{ unitWords(row.productId, row.stockPieces) }} op voorraad@if (row.expectedPieces) { · onderweg {{ unitWords(row.productId, row.expectedPieces) }}@if (row.nextArrival) { · {{ dayText(row.nextArrival) }} } } · {{ row.weeklyPieces | num }}/week</span></span>
                      <span class="an-row__end"><span class="an-row__meta" [attr.data-tone]="(row.weeksLeft ?? 0) >= 4 ? 'ok' : 'warn'">{{ weeksLabel(row.weeksLeft) }}</span></span>
                      <span class="an-row__chev" aria-hidden="true">›</span>
                    </a>
                  } @empty { <p class="an-empty">Niets raakt binnen {{ im.reorder.horizonWeeks }} weken op, of er werd nog niets gefactureerd.</p> }
                  <ng-container *ngTemplateOutlet="more; context: { key: 'reorder', total: im.reorder.rows.length }" />
                }
              </div>
            </section>
          </div>
        </div>
        @let merged = slowSameAsCapital();
        <section class="an-card" aria-labelledby="an-capital-title">
          <header class="an-card__head"><h2 class="an-card__title" id="an-capital-title">Grootste voorraadposities</h2>
            <span class="an-card__trail">{{ im.capital.length > im.topCapital.length ? 'top ' + im.topCapital.length + ' op kostwaarde' : 'op kostwaarde' }}@if (merged && !loading()) { · alles zonder verkoop in {{ im.velocity.days }} dagen: {{ whole(im.slowMovers.valueEur) }} in {{ plural(im.slowMovers.count, 'SKU', 'SKU’s') }} }
              @if (!loading() && im.capital.length && !failed('voorraad')) { <button class="an-link" type="button" aria-haspopup="dialog" (click)="openStockTile('cost')">Alle ›</button> }</span></header>
          <div class="an-card__body">
            @if (loading()) { <app-skeleton class="an-skeleton" [kind]="desk.active() ? 'list' : 'group'" [rows]="4" /> } @else {
              @for (row of take('capital', im.topCapital); track row.productId) {
                <a class="an-row an-share an-row--link" [class.mo-fade]="$index >= listLimit()" [routerLink]="['/products', row.productId]">
                  <span class="an-row__body"><span class="an-row__title">{{ row.name }}</span>
                    <span class="an-row__sub">{{ row.sku || 'Geen SKU' }}@if (row.colour) { · {{ row.colour }} } · {{ unitWords(row.productId, row.stockPieces) }}{{ merged ? ' zonder verkoop' : '' }}</span></span>
                  <span class="an-meter"><i [style.width.%]="row.sharePct"></i></span>
                  <span class="an-row__value">{{ whole(row.costValueEur) }}</span>
                  <span class="an-row__meta">{{ row.sharePct | pct: 1 }}</span>
                </a>
              } @empty { <p class="an-empty">Nog geen actuele voorraad met kostwaarde.</p> }
              <ng-container *ngTemplateOutlet="more; context: { key: 'capital', total: im.topCapital.length }" />
            }
          </div>
        </section>
        @if (!merged && !loading()) {
          <section class="an-card" aria-labelledby="an-slow-title">
            <header class="an-card__head"><h2 class="an-card__title" id="an-slow-title">Trage verkopers</h2>
              <span class="an-card__trail">{{ whole(im.slowMovers.valueEur) }} in {{ plural(im.slowMovers.count, 'SKU', 'SKU’s') }}</span></header>
            <div class="an-card__body">
              @for (row of take('slow', im.slowMovers.rows); track row.productId) {
                <a class="an-row an-row--nolead an-row--chev" [class.mo-fade]="$index >= listLimit()" [routerLink]="['/products', row.productId]">
                  <span class="an-row__body"><span class="an-row__title">{{ row.name }}</span>
                    <span class="an-row__sub">{{ row.sku || 'Geen SKU' }}@if (row.colour) { · {{ row.colour }} } · {{ unitWords(row.productId, row.stockPieces) }} zonder verkoop</span></span>
                  <span class="an-row__end"><span class="an-row__value">{{ whole(row.costValueEur) }}</span></span>
                  <span class="an-row__chev" aria-hidden="true">›</span>
                </a>
              } @empty { <p class="an-empty">Elke gewaardeerde voorraadpositie verkocht in de laatste {{ im.velocity.days }} dagen.</p> }
              <ng-container *ngTemplateOutlet="more; context: { key: 'slow', total: im.slowMovers.rows.length }" />
            </div>
          </section>
        }
      }

      @if (section() === 'result') {
        @let r = result();
        @if (loading()) {
          <div class="an-kpis an-kpis--5" aria-label="Resultaat laden">@for (n of [1, 2, 3, 4, 5]; track n) { <div class="an-kpi an-kpi--loading"><span></span><span></span><span></span></div> }</div>
        } @else {
          <!-- A tile opens the list behind its figure (design/analyses2 §B.4); Resultaat itself is the bars and Per maand below. -->
          <div class="an-kpis an-kpis--5">
            @for (k of resultTiles(); track k.key) {
              @if (k.drill) {
                <button class="an-kpi an-kpi--drill" type="button" aria-haspopup="dialog" [attr.data-kpi]="k.key" (click)="openResultTile(k.key)"><ng-container *ngTemplateOutlet="kpiBody; context: { $implicit: k }" /></button>
              } @else {
                <div class="an-kpi" [attr.data-kpi]="k.key"><ng-container *ngTemplateOutlet="kpiBody; context: { $implicit: k }" /></div>
              }
            }
          </div>
        }
        <section class="an-card" aria-labelledby="an-bars-title">
          <header class="an-card__head"><h2 class="an-card__title" id="an-bars-title">Marge en kosten per maand</h2>
            <span class="an-card__trail an-legend"><span><i class="an-legend__m"></i>marge op goederen</span><span><i class="an-legend__c"></i>eigen kosten</span></span></header>
          <div class="an-card__body">
            @if (loading()) { <app-skeleton kind="card" /> }
            @else if (!r.monthly.length) { <p class="an-empty">Nog niets in deze periode.</p> }
            @else if (r.missingCostLines) {
              <p class="an-empty">Marge en resultaat zijn onvolledig: productkosten ontbreken.
                <button class="an-link" type="button" aria-haspopup="dialog" (click)="openResultTile('margin')">Regels zonder kost ›</button></p>
            }
            @else { <app-an-month-bars [months]="r.monthly" [height]="desk.active() ? 180 : 132" [compact]="!desk.active()" (picked)="openMonth($event)" /> }
          </div>
        </section>
        <!-- Per verkoopkanaal (1–3 rows) and Kosten per categorie are full-width cards: side by side the short channel card left a hole of 250+ px (design §2.1.5). -->
        <section class="an-card" aria-labelledby="an-rchannel-title">
          <header class="an-card__head"><h2 class="an-card__title" id="an-rchannel-title">Per verkoopkanaal</h2><span class="an-card__trail">resultaat, excl. btw</span></header>
          <div class="an-card__body">
            @if (loading()) { <app-skeleton class="an-skeleton" [kind]="desk.active() ? 'list' : 'group'" [rows]="3" /> } @else {
              <!-- A channel opens its documents, TICA and costs; Algemene kosten (no channel) makes the rows add up to Resultaat (D-O5). -->
              @for (row of r.byChannel; track row.channel) {
                @if (row.revenueEur !== 0 || row.marginEur !== 0 || row.costsEur !== 0) {
                  <button class="an-row an-row--nolead an-row--chev" type="button" aria-haspopup="dialog" (click)="openResultChannel(row.channel)">
                    <ng-container *ngTemplateOutlet="resultChannelBody; context: { $implicit: row }" /><span class="an-row__chev" aria-hidden="true">›</span></button>
                } @else {
                  <div class="an-row an-row--nolead"><ng-container *ngTemplateOutlet="resultChannelBody; context: { $implicit: row }" /></div>
                }
              }
              @if (r.generalCostsEur) {
                <button class="an-row an-row--nolead an-row--chev" type="button" aria-haspopup="dialog" (click)="openResultChannel(null)">
                  <span class="an-row__body"><span class="an-row__title">Algemene kosten</span><span class="an-row__sub">kosten zonder verkoopkanaal</span></span>
                  <span class="an-row__end"><span class="an-row__value">{{ whole(-r.generalCostsEur) }}</span></span><span class="an-row__chev" aria-hidden="true">›</span></button>
              }
              @if (!r.byChannel.length && !r.generalCostsEur) { <p class="an-empty">Nog geen facturen of kosten in deze periode.</p> }
            }
          </div>
        </section>
        <section class="an-card" aria-labelledby="an-rcat-title">
          <header class="an-card__head"><h2 class="an-card__title" id="an-rcat-title">Kosten per categorie</h2></header>
          <div class="an-card__body">
            @if (loading()) { <app-skeleton class="an-skeleton" [kind]="desk.active() ? 'list' : 'group'" [rows]="3" /> } @else {
              <!-- Each category opens its costs, with Kosten & bank on that category in the foot (D-O9). -->
              @for (row of take('categories', r.byCategory); track row.category) {
                @if (row.amountEur !== 0) {
                  <button class="an-row an-share" type="button" aria-haspopup="dialog" [class.mo-fade]="$index >= limitOf('categories')" (click)="openCategory(row.category, row.amountEur)">
                    <ng-container *ngTemplateOutlet="categoryBody; context: { $implicit: row }" /></button>
                } @else {
                  <div class="an-row an-share" [class.mo-fade]="$index >= limitOf('categories')"><ng-container *ngTemplateOutlet="categoryBody; context: { $implicit: row }" /></div>
                }
              } @empty { <p class="an-empty">Nog geen kosten geboekt in deze periode.</p> }
              <ng-container *ngTemplateOutlet="more; context: { key: 'categories', total: r.byCategory.length }" />
            }
          </div>
        </section>
        <section class="an-card" aria-labelledby="an-months-title">
          <header class="an-card__head"><h2 class="an-card__title" id="an-months-title">Per maand</h2><span class="an-card__trail">{{ desk.active() ? 'oudste maand eerst' : 'nieuwste maand eerst' }}</span></header>
          @if (loading()) { <div class="an-card__body"><app-skeleton class="an-skeleton" [kind]="desk.active() ? 'list' : 'group'" [rows]="4" /></div> }
          @else if (!r.monthly.length) { <p class="an-empty">Nog niets in deze periode.</p> }
          @else if (desk.active()) {
            <div class="an-table-wrap" tabindex="0" role="region" aria-label="Resultaat per maand">
              <table class="an-table">
                <thead><tr><th>Maand</th><th>Omzet</th><th>Marge</th><th>Eigen kosten</th><th>Resultaat</th></tr></thead>
                <tbody>
                  @for (row of r.monthly; track row.month) {
                    <tr><td>@if (monthActive(row)) { <button class="an-link" type="button" aria-haspopup="dialog" (click)="openMonth(row.month)">{{ monthLabel(row.month) }}</button> } @else { {{ monthLabel(row.month) }} }</td>
                      <td>{{ whole(row.revenueEur) }}</td><td>{{ r.missingCostLines ? '—' : whole(row.marginEur) }}</td><td>{{ whole(row.costsEur) }}</td>
                      <td [class.is-danger]="!r.missingCostLines && row.resultEur < 0">{{ r.missingCostLines ? '—' : whole(row.resultEur) }}</td></tr>
                  }
                </tbody>
                <!-- The total row is the tiles' figures. -->
                <tfoot><tr><td>Totaal</td><td>{{ whole(r.revenueEur) }}</td><td>{{ r.missingCostLines ? '—' : whole(r.marginEur) }}</td><td>{{ whole(r.costsEur) }}</td>
                  <td [class.is-danger]="!r.missingCostLines && r.resultEur < 0">{{ r.missingCostLines ? '—' : whole(r.resultEur) }}</td></tr></tfoot>
              </table>
            </div>
          } @else {
            <div class="an-card__body">
              @for (row of take('months', monthsNewestFirst()); track row.month) {
                @if (monthActive(row)) {
                  <button class="an-row an-row--nolead an-row--chev" type="button" aria-haspopup="dialog" [class.mo-fade]="$index >= listLimit()" (click)="openMonth(row.month)">
                    <ng-container *ngTemplateOutlet="monthBody; context: { $implicit: row, unknown: r.missingCostLines > 0 }" /><span class="an-row__chev" aria-hidden="true">›</span></button>
                } @else {
                  <div class="an-row an-row--nolead" [class.mo-fade]="$index >= listLimit()"><ng-container *ngTemplateOutlet="monthBody; context: { $implicit: row, unknown: r.missingCostLines > 0 }" /></div>
                }
              }
              <ng-container *ngTemplateOutlet="more; context: { key: 'months', total: r.monthly.length }" />
            </div>
          }
        </section>
      }

      @if (section() === 'market') {
        <app-market-analysis><app-an-how how [lines]="how.market" /></app-market-analysis>
      }

      @if (section() === 'website') {
        <app-website-analytics><app-an-how how [lines]="how.website" /></app-website-analytics>
      }

      @if (section() === 'purchasing') {
        @switch (part()) {
          @case ('kosten') { <app-container-cost-analysis [purchases]="purchases()" [loading]="loading()" /> }
          @case ('kwaliteit') {
            <ng-container *ngTemplateOutlet="receiptBar; context: { $implicit: false }" />
            @if (loading()) {
              <div class="an-kpis an-kpis--3" aria-label="Kwaliteit laden">@for (n of [1, 2, 3]; track n) { <div class="an-kpi an-kpi--loading"><span></span><span></span><span></span></div> }</div>
            } @else {
              <!-- Each figure opens the received orders, ordered for it (design/analyses2 §B.6); the loss figures live on Afwijkingen. -->
              <div class="an-kpis an-kpis--3">
                @for (k of qualityTiles(); track k.key) {
                  @if (k.drill) {
                    <button class="an-kpi an-kpi--drill" type="button" aria-haspopup="dialog" [attr.data-kpi]="k.key" (click)="openReceipts(k.key)"><ng-container *ngTemplateOutlet="kpiBody; context: { $implicit: k }" /></button>
                  } @else {
                    <div class="an-kpi" [attr.data-kpi]="k.key"><ng-container *ngTemplateOutlet="kpiBody; context: { $implicit: k }" /></div>
                  }
                }
              </div>
              <section class="an-card" aria-labelledby="an-score-title">
                <header class="an-card__head"><h2 class="an-card__title" id="an-score-title">Scorekaart per leverancier</h2><span class="an-card__trail">ontvangen orders in de gekozen periode</span></header>
                <!-- A supplier opens its received orders (D-V1: there is no /suppliers/:id; its foot searches the supplier list). -->
                @if (!supplierCards().length) { <p class="an-empty">Nog geen ontvangen orders in deze periode.</p> }
                @else if (desk.active()) {
                  <div class="an-table-wrap" tabindex="0" role="region" aria-label="Scorekaart per leverancier">
                    <table class="an-table">
                      <thead><tr><th>Leverancier</th><th>Orders</th><th>Externe kost</th><th>Perfect</th><th>Op tijd</th><th>Doorlooptijd</th><th>Laatste ontvangst</th></tr></thead>
                      <tbody>
                        @for (card of supplierCards(); track card.supplierId) {
                          <tr>
                            <td><button class="an-link" type="button" aria-haspopup="dialog" (click)="openSupplier(card)">{{ card.name }}</button></td>
                            <td>{{ plural(card.orders, 'order', 'orders') }}</td>
                            <td>{{ whole(card.totalEur) }}</td>
                            <td [class.is-warn]="card.perfectPct !== null && card.perfectPct < 80">{{ card.perfectPct === null ? '—' : (card.perfectPct | pct: 0) }}</td>
                            <td [class.is-warn]="card.onTimePct !== null && card.onTimePct < 80">{{ card.onTimePct === null ? '—' : (card.onTimePct | pct: 0) }}</td>
                            <td>{{ card.avgLeadDays === null ? '—' : card.avgLeadDays + ' d' }}</td>
                            <td>{{ dayText(card.latestReceivedOn) }}</td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                } @else {
                  <div class="an-card__body">
                    @for (card of supplierCards(); track card.supplierId) {
                      <button class="an-row an-row--nolead an-row--chev" type="button" aria-haspopup="dialog" (click)="openSupplier(card)">
                        <span class="an-row__body"><span class="an-row__title">{{ card.name }}</span>
                          <span class="an-row__sub">{{ plural(card.orders, 'order', 'orders') }} · {{ whole(card.totalEur) }} · {{ card.avgLeadDays === null ? '—' : card.avgLeadDays + ' d' }} · laatst {{ dayText(card.latestReceivedOn) }}</span></span>
                        <span class="an-row__end"><span class="an-row__value" [attr.data-tone]="card.perfectPct !== null && card.perfectPct < 80 ? 'warn' : null">{{ card.perfectPct === null ? '—' : (card.perfectPct | pct: 0) }}</span>
                          <span class="an-row__meta" [attr.data-tone]="card.onTimePct !== null && card.onTimePct < 80 ? 'warn' : null">op tijd {{ card.onTimePct === null ? '—' : (card.onTimePct | pct: 0) }}</span></span>
                        <span class="an-row__chev" aria-hidden="true">›</span>
                      </button>
                    }
                  </div>
                }
              </section>
            }
          }
          @case ('partners') {
            @if (loading()) {
              <div class="an-kpis" aria-label="Partners laden">@for (n of [1, 2, 3, 4, 5, 6, 7, 8]; track n) { <div class="an-kpi an-kpi--loading"><span></span><span></span><span></span></div> }</div>
            } @else {
              @let f = financing();
              <!-- Eight figures in four columns; the three to-dos open their containers (design/analyses2 §B.6). -->
              <div class="an-kpis">
                @for (k of partnerTiles(); track k.key) {
                  @if (k.drill) {
                    <button class="an-kpi an-kpi--drill" type="button" aria-haspopup="dialog" [attr.data-kpi]="k.key" (click)="openPartnerTile(k.key)"><ng-container *ngTemplateOutlet="kpiBody; context: { $implicit: k }" /></button>
                  } @else {
                    <div class="an-kpi" [attr.data-kpi]="k.key"><ng-container *ngTemplateOutlet="kpiBody; context: { $implicit: k }" /></div>
                  }
                }
              </div>
              <section class="an-card" aria-labelledby="an-partner-title">
                <header class="an-card__head"><h2 class="an-card__title" id="an-partner-title">Per partnercontainer</h2><span class="an-card__trail">{{ plural(f.partner.count, 'container', 'containers') }} · externe kost {{ whole(f.partner.landedEur) }}</span></header>
                @if (!f.rows.length) { <p class="an-empty">Nog geen container met een partner: alles betalen we zelf.</p> }
                @else if (desk.active()) {
                  <div class="an-table-wrap" tabindex="0" role="region" aria-label="Per partnercontainer">
                    <table class="an-table an-ptable" data-detail>
                      <thead><tr><th>Container</th><th>Externe kost</th><th>Ontvangen</th><th>Te factureren</th><th>Open</th><th>Eigen kas</th><th>Resultaat</th><th class="an-col-docs">Documenten</th></tr></thead>
                      <tbody>
                        @for (row of f.rows; track row.purchaseOrderId) {
                          <tr>
                            <td><a [routerLink]="['/purchasing', row.purchaseOrderId]">{{ partnerName(row) }}</a>
                              <small>@if (row.alias) { {{ row.number }} · }{{ row.partnerName }}@if (row.sharePct !== null) { · {{ row.sharePct | num }}&nbsp;% }</small>
                              <span class="an-docs an-docs--inline"><ng-container *ngTemplateOutlet="partnerDocs; context: { $implicit: row }" /></span></td>
                            <td>{{ whole(row.landedEur) }}<small>{{ row.costFinalized ? 'definitief' : 'verwacht' }}</small></td>
                            <td>{{ whole(row.receivedEur) }}<small>gefactureerd {{ whole(row.invoicedEur) }}</small>@if (row.creditedEur) { <small>{{ whole(row.creditedEur) }} gecrediteerd</small> }</td>
                            <td>@if (row.unbilledAdvanceCount) {
                                <a [routerLink]="['/purchasing', row.purchaseOrderId]" [queryParams]="{ section: 'payments' }" [class.is-danger]="row.overdueUnbilledAdvanceEur > 0">{{ whole(row.unbilledAdvanceEur) }} ›</a>
                                <small>{{ plural(row.unbilledAdvanceCount, 'termijn', 'termijnen') }}@if (row.nextAdvanceDueDate) { · volgende {{ dayText(row.nextAdvanceDueDate) }} }</small>
                              } @else { — }</td>
                            <td [class.is-warn]="row.openEur > 0">{{ whole(row.openEur) }}</td>
                            <td>{{ whole(row.ownExposureEur) }}</td>
                            <td [class.is-danger]="row.resultEur < 0">{{ whole(row.resultEur) }}<small>{{ partnerState(row) }}</small>@if (row.creditEur) { <small>{{ whole(row.creditEur) }} credit</small> }</td>
                            <td class="an-col-docs"><span class="an-docs"><ng-container *ngTemplateOutlet="partnerDocs; context: { $implicit: row }" /></span></td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                } @else {
                  <div class="an-card__body">
                    @for (row of f.rows; track row.purchaseOrderId) {
                      <button class="an-row an-row--nolead an-row--chev" type="button" data-detail (click)="partnerSheetId.set(row.purchaseOrderId); sheet.set('partner')">
                        <span class="an-row__body"><span class="an-row__title ios-cell__title--2">{{ partnerName(row) }}</span>
                          <span class="an-row__sub">{{ row.partnerName }}@if (row.sharePct !== null) { · {{ row.sharePct | num }} % } · {{ whole(row.landedEur) }} {{ row.costFinalized ? 'definitief' : 'verwacht' }}</span></span>
                        <span class="an-row__end">
                          @if (row.unbilledAdvanceEur > 0) {
                            <span class="an-row__value" [attr.data-tone]="row.overdueUnbilledAdvanceEur > 0 ? 'danger' : 'warn'">{{ whole(row.unbilledAdvanceEur) }}</span><span class="an-row__meta" data-tone="warn">te factureren</span>
                          } @else {
                            <span class="an-row__value">{{ whole(row.ownExposureEur) }}</span><span class="an-row__meta">eigen kas</span>
                          }
                        </span>
                        <span class="an-row__chev" aria-hidden="true">›</span>
                      </button>
                    }
                  </div>
                }
              </section>
            }
          }
          @case ('afwijkingen') {
            <ng-container *ngTemplateOutlet="receiptBar; context: { $implicit: true }" />
            @if (receiptError()) {
              <div [class]="desk.active() ? 'wk-banner wk-banner--danger wk-banner--inset' : 'ios-banner ios-banner--danger'" role="alert">
                <span class="wk-banner__text"><b>Ontvangstafwijkingen niet beschikbaar.</b> {{ receiptError() }}</span>
                <button [class]="desk.active() ? 'wk-btn wk-btn--sm' : 'ios-capsule ios-capsule--sm ios-capsule--tinted'" type="button" (click)="loadVariances()">Opnieuw</button>
              </div>
            } @else if (loading()) {
              <div class="an-kpis" aria-label="Afwijkingen laden">@for (n of [1, 2, 3, 4]; track n) { <div class="an-kpi an-kpi--loading"><span></span><span></span><span></span></div> }</div>
            } @else {
              @let t = report().totals;
              <!-- Counts in each product's sales unit (D-V3); Inkoopimpact opens it per product and per supplier, the order cards below are the rest. -->
              <div class="an-kpis" [attr.aria-busy]="filtering()">
                @if (t.affectedLines > 0) {
                  <button class="an-kpi an-kpi--drill" type="button" aria-haspopup="dialog" data-kpi="impact" (click)="openImpact()"><ng-container *ngTemplateOutlet="impactBody; context: { $implicit: t }" /></button>
                } @else {
                  <div class="an-kpi" data-kpi="impact"><ng-container *ngTemplateOutlet="impactBody; context: { $implicit: t }" /></div>
                }
                <div class="an-kpi"><span class="an-kpi__label">Ontbreekt</span><span class="an-kpi__value">{{ t.missingPieces | num }}</span>
                  <span class="an-kpi__sub">{{ whole(t.missingValueEur) }}</span><span class="an-kpi__foot"></span></div>
                <div class="an-kpi"><span class="an-kpi__label">Beschadigd</span><span class="an-kpi__value">{{ t.damagedPieces | num }}</span>
                  <span class="an-kpi__sub">{{ whole(t.damagedValueEur) }}</span><span class="an-kpi__foot"></span></div>
                <div class="an-kpi"><span class="an-kpi__label">Zonder waarde</span><span class="an-kpi__value" [attr.data-tone]="t.valuationComplete ? null : 'warn'">{{ t.unvaluedLossPieces | num }}</span>
                  <span class="an-kpi__sub">{{ t.valuationComplete ? 'alles gewaardeerd' : 'vul de waarde per stuk aan' }}</span><span class="an-kpi__foot"></span></div>
              </div>
              @for (group of varianceGroups(); track group.orderId) {
                <section class="an-card an-order" [id]="'an-order-' + group.orderId" [class.is-focus]="focusedOrderId() === group.orderId" [attr.aria-label]="containerOf(group.orderId, group.orderNumber, group.orderAlias)">
                  <header class="an-card__head an-order__head">
                    <a class="an-order__who" [routerLink]="['/purchasing', group.orderId]">
                      <span class="an-order__supplier">{{ group.supplierName }}</span>
                      <span class="an-order__name">{{ containerOf(group.orderId, group.orderNumber, group.orderAlias) }}</span>
                      <span class="an-order__meta">@if (containerOf(group.orderId, group.orderNumber, group.orderAlias) !== group.orderNumber) { {{ group.orderNumber }} · }ontvangen {{ dayText(group.receivedOn) }}</span>
                    </a>
                    <span class="an-order__end"><b>{{ whole(group.totalLossValueEur) }}</b>
                      @if (group.unvaluedLossPieces) { <small>+ {{ group.unvaluedLossPieces | num }} zonder waarde</small> }</span>
                  </header>
                  <div class="an-card__body">
                    @for (row of group.rows; track row.lineId ?? row.productId) {
                      <div class="an-vline">
                        <div class="an-vline__product">
                          <b>{{ productLabel(row) }}</b>
                          <span>{{ row.productSku || 'Geen SKU' }} · {{ row.usablePieces | num }} bruikbaar van {{ row.orderedPieces | num }}</span>
                          <span class="an-row__chips">
                            @if (row.missingPieces) { <span class="an-chip" data-tone="danger">{{ row.missingPieces | num }} ontbreekt</span> }
                            @if (row.damagedPieces) { <span class="an-chip" data-tone="danger">{{ row.damagedPieces | num }} beschadigd</span> }
                            @if (row.overReceivedPieces) { <span class="an-chip" data-tone="ok">+{{ row.overReceivedPieces | num }} extra</span> }
                          </span>
                        </div>
                        <div class="an-vline__impact"><span>Impact</span><b>{{ row.totalLossValueEur === null ? 'Onbekend' : (row.totalLossValueEur | eur: 2) }}</b></div>
                        @if (desk.active()) {
                          <div class="an-vline__value">
                            <label [attr.for]="valueInputId(row)">Waarde per stuk</label>
                            <div class="an-money">
                              <span aria-hidden="true">€</span>
                              <input [id]="valueInputId(row)" type="text" inputmode="decimal" autocomplete="off" [disabled]="row.lineId === null || savingValue() === valueKey(row)"
                                     [value]="draftValue(row)" (input)="setDraftValue(row, $any($event.target).value)" (keydown.enter)="saveValue(row)" />
                              <button class="wk-btn wk-btn--sm" type="button" [attr.aria-label]="'Bewaar waarde per stuk voor ' + productLabel(row)"
                                      [disabled]="!canSaveValue(row)" (click)="saveValue(row)">{{ savingValue() === valueKey(row) ? '…' : 'Bewaren' }}</button>
                            </div>
                            <small [class.is-warn]="row.lineId !== null && row.receiptUnitValueEur === null">{{ valueHint(row) }}</small>
                          </div>
                        } @else {
                          <button class="an-vline__cell" type="button" [disabled]="row.lineId === null" (click)="openValueSheet(row)">
                            <span>Waarde per stuk</span><b>{{ row.receiptUnitValueEur === null ? '—' : unitValue(row.receiptUnitValueEur) }}</b>
                            <small [class.is-warn]="row.lineId !== null && row.receiptUnitValueEur === null">{{ valueHint(row) }}</small>
                          </button>
                        }
                      </div>
                    }
                  </div>
                </section>
              } @empty {
                <div class="an-card an-done">
                  <span class="an-done__icon" aria-hidden="true">✓</span>
                  <div><b>Geen afwijkingen in deze selectie</b><p>Er zijn geen ontbrekende of beschadigde stuks gevonden.</p></div>
                </div>
              }
            }
          }
        }
      }
      }
    </ng-template>

    <ng-template #kpiBody let-k>
      <span class="an-kpi__label">{{ k.label }}</span><span class="an-kpi__value" [attr.data-tone]="k.tone">{{ k.value }}@if (k.unit) { <small>{{ k.unit }}</small> }</span>
      <span class="an-kpi__sub" [class.is-warn]="k.subWarn">{{ k.sub }}</span><span class="an-kpi__foot" [class.is-warn]="k.footWarn">{{ k.foot }}</span>
    </ng-template>

    <ng-template #funnelStep let-step>
      <div><b>{{ step.label }}</b><small>{{ step.rate }}</small></div>
      <span class="an-meter" [class.an-meter--ok]="step.accent"><i [style.width.%]="step.width"></i></span>
      <span class="an-funnel__n">{{ step.count | num }}</span>
    </ng-template>

    <ng-template #channelBody let-channel>
      <span class="an-row__body"><span class="an-row__title">{{ channelLabel(channel.channel) }}</span>
        <span class="an-row__sub">{{ channelVolume(channel.invoiceCount, channel.ticaTransactions) }} · marge {{ channel.missingCostLines || channel.ticaMissingCostLines ? '—' : whole(channel.marginEur) }}</span></span>
      <span class="an-meter"><i [style.width.%]="channel.sharePct"></i></span>
      <span class="an-row__value">{{ whole(channel.revenueExclEur) }}</span>
      <span class="an-row__meta">{{ channel.sharePct | pct: 0 }}</span>
    </ng-template>

    <ng-template #resultChannelBody let-row>
      @let unknown = row.missingCostLines > 0 || row.ticaMissingCostLines > 0;
      <span class="an-row__body"><span class="an-row__title">{{ channelLabel(row.channel) }}</span>
        <span class="an-row__sub">omzet {{ whole(row.revenueEur) }} · marge {{ unknown ? '—' : whole(row.marginEur) }} · kosten {{ row.costsEur ? whole(row.costsEur) : '—' }}</span></span>
      <span class="an-row__end"><span class="an-row__value" [attr.data-tone]="!unknown && row.resultEur < 0 ? 'danger' : null">{{ unknown ? '—' : whole(row.resultEur) }}</span></span>
    </ng-template>

    <ng-template #categoryBody let-row>
      <span class="an-row__body"><span class="an-row__title">{{ categoryLabel(row.category) }}</span></span>
      <span class="an-meter"><i [style.width.%]="row.sharePct"></i></span>
      <span class="an-row__value">{{ whole(row.amountEur) }}</span>
      <span class="an-row__meta">{{ row.sharePct | pct: 0 }}</span>
    </ng-template>

    <ng-template #monthBody let-row let-unknown="unknown">
      <span class="an-row__body"><span class="an-row__title">{{ monthLabel(row.month) }}</span>
        <span class="an-row__sub">omzet {{ whole(row.revenueEur) }} · marge {{ unknown ? 'onbekend' : whole(row.marginEur) }} · kosten {{ whole(row.costsEur) }}</span></span>
      <span class="an-row__end"><span class="an-row__value" [attr.data-tone]="!unknown && row.resultEur < 0 ? 'danger' : null">{{ unknown ? '—' : whole(row.resultEur) }}</span></span>
    </ng-template>

    <ng-template #impactBody let-t>
      <span class="an-kpi__label">Inkoopimpact</span><span class="an-kpi__value">{{ whole(t.totalLossValueEur) }}</span>
      <span class="an-kpi__sub">{{ plural(t.affectedOrders, 'order', 'orders') }} · {{ plural(t.affectedLines, 'regel', 'regels') }}</span><span class="an-kpi__foot"></span>
    </ng-template>

    <ng-template #attentionBody let-row>
      <span class="an-count" [class.is-zero]="row.count === 0" [attr.data-tone]="row.count ? row.tone : null">{{ row.count | num }}</span>
      <span class="an-row__body"><span class="an-row__title">{{ row.title }}</span><span class="an-row__sub">{{ row.sub }}</span></span>
      <span class="an-row__end">
        @if (row.value !== null) { <span class="an-row__value" [attr.data-tone]="row.valueTone">{{ row.value }}</span> }
        @if (row.meta) { <span class="an-row__meta" [attr.data-tone]="row.metaTone">{{ row.meta }}</span> }
      </span>
    </ng-template>

    <ng-template #receiptBar let-withChip>
      @if (desk.active()) {
        <div class="an-bar an-bar--sub">
          <app-an-period [value]="receiptPeriod()" [today]="today()" [note]="receiptNote" idPrefix="an-receipt" (changed)="setReceiptPeriod($event)" />
          <select class="an-select" aria-label="Leverancier" [value]="receiptSupplier() ?? ''" (change)="setSupplier($any($event.target).value)">
            <option value="">Alle leveranciers</option>
            @for (supplier of suppliers(); track supplier.id) { <option [value]="supplier.id" [selected]="supplier.id === receiptSupplier()">{{ supplier.name }}</option> }
          </select>
          <span class="an-bar__text">{{ receiptRangeText() }} · op ontvangstdatum</span>
          @if (withChip && focusedOrderId() !== null) {
            <button class="wk-chip is-on" type="button" [attr.aria-label]="'Alle orders tonen, niet alleen ' + focusName()" (click)="clearOrderFocus()">Alleen {{ focusName() }} <span aria-hidden="true">✕</span></button>
          }
        </div>
      } @else {
        <div class="an-bar an-bar--sub">
          <button class="ios-capsule ios-capsule--sm ios-capsule--tinted an-pick-phone" type="button" aria-haspopup="dialog" (click)="sheet.set('receipt')">
            <app-icon name="calendar" [size]="15" />{{ receiptPeriodLabel() }}<app-icon name="chevron-down" [size]="14" /></button>
          <select class="an-capsule-select" aria-label="Leverancier" [value]="receiptSupplier() ?? ''" (change)="setSupplier($any($event.target).value)">
            <option value="">Alle leveranciers</option>
            @for (supplier of suppliers(); track supplier.id) { <option [value]="supplier.id" [selected]="supplier.id === receiptSupplier()">{{ supplier.name }}</option> }
          </select>
          @if (withChip && focusedOrderId() !== null) {
            <button class="ios-chip an-focus-chip" type="button" aria-pressed="true" [attr.aria-label]="'Alle orders tonen, niet alleen ' + focusName()" (click)="clearOrderFocus()">Alleen {{ focusName() }} ✕</button>
          }
        </div>
      }
    </ng-template>

    <ng-template #partnerDocs let-row>
      @for (doc of row.documents; track doc.id) {
        <span><a [routerLink]="['/sales', doc.id, 'edit']">{{ doc.number }}</a><small> · {{ documentKind(doc) }}</small></span>
      } @empty { <small>geen documenten</small> }
    </ng-template>

    <ng-template #more let-key="key" let-total="total">
      @if (total > limitOf(key)) {
        <button class="an-more" type="button" [attr.aria-expanded]="openLists().has(key)" (click)="toggleList(key)">{{ openLists().has(key) ? 'Minder tonen' : 'Alle ' + total + ' tonen' }}</button>
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
  private readonly tica = inject(TicaApi);
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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly analysisTabs = ANALYSIS_TABS;
  /** The old desk tab row, off since the redesign (analyses-desk-tabs.ts). */
  readonly deskTabRow = DESK_TAB_ROW;
  readonly section = toSignal(this.route.paramMap.pipe(map((params) =>
    analysisSection(params.get('section')))), { initialValue: 'cash' as AnalysisSection });
  private readonly queryParams = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  readonly head = computed(() => TAB_HEADS[this.section()]);
  /** The phone's large title: the chip's own word on Overzicht (the desk header keeps "Analyses", the area's top). */
  readonly phoneTitle = computed(() => this.section() === 'overview' ? 'Overzicht' : this.head().title);
  /** The crumb "Analyses ›" on the seven tabs; Overzicht is the area's own top (critique N1). */
  readonly parent = computed(() => this.section() === 'overview' ? null : ANALYSES_PARENT);
  readonly how = HOW_TEXTS;
  readonly salesNote = SALES_PERIOD_NOTE;
  readonly yearQuery = YEAR_QUERY;
  readonly sheet = signal<PageSheet>(null);
  private focusScrolled = false;
  private varianceTimer: ReturnType<typeof setTimeout> | undefined;
  private varianceRound = 0;
  private loadedFilterKey = '';
  /** Phone caption under the large title: the subtitle, or the year so far on Overzicht. */
  readonly phoneCaption = computed(() => this.section() === 'overview' ? `Dit jaar · t/m ${weekdayDayMonth(this.today())}` : this.head().subtitle);
  readonly howLines = computed<readonly string[]>(() => {
    const section = this.section();
    return section === 'purchasing' ? HOW_TEXTS[`purchasing-${this.part()}`] : HOW_TEXTS[section];
  });
  readonly menuLinks = computed<MenuLink[]>(() => {
    const section = this.section();
    if (section === 'result') return (MENU_LINKS.result ?? []).map((link) => ({ ...link, query: this.costsQuery() }));
    if (section !== 'purchasing') return MENU_LINKS[section] ?? [];
    if (this.part() === 'kosten') return [{ label: 'Kosten & bank', url: '/costs', icon: 'bank' }];
    return this.part() === 'partners' ? [{ label: 'Alle verkooporders', url: '/sales', icon: 'sales' }] : [];
  });

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
  /** Pieces per location (critique N14); null until loaded or when the call failed (then the warehouse figure counts). */
  readonly stockLevels = signal<StockLevel[] | null>(null);
  /** Voorraad and Overzicht count every location; Kasprognose keeps its own inputs. */
  readonly stockProducts = computed(() => { const levels = this.stockLevels(); return levels ? withAllLocations(this.products(), levels) : this.products(); });
  readonly salesOrders = signal<SalesOrderView[]>([]);
  readonly ticaDays = signal<TicaAnalyticsDay[]>([]);
  /**
   * Verkoop's TICA card: the period's lines (loaded when the tab shows and TICA sold in the period), keyed by their
   * range so a newer period wins; omzet and transacties stay in Omzet per kanaal.
   */
  readonly ticaLines = computed(() => (this.section() === 'sales' && !this.loading()
    ? ticaLineRange(this.salesFromDate(), this.salesToDate(), this.ticaDays(), this.today()) : null));
  readonly ticaCard = signal<{ key: string; state: 'loading' | 'ready' | 'failed'; data: TicaBreakdown | null }>({ key: '', state: 'loading', data: null });
  readonly incomingPayments = signal<IncomingPaymentRow[]>([]);
  readonly partnerSummaries = signal<PartnerFinancing[]>([]);
  readonly customers = signal<Customer[]>([]);
  readonly costs = signal<CompanyCost[]>([]);
  readonly expectedStock = signal<ExpectedStock[]>([]);

  /** Verkoop and Resultaat share one period (design §2.4); the dates follow today. */
  readonly salesPeriod = signal<PeriodChoice>(parsePeriod((key) => this.route.snapshot.queryParamMap.get(key), SALES_PERIOD_KEYS));
  readonly salesRange = computed(() => periodRange(this.salesPeriod(), this.today()));
  readonly salesFromDate = computed(() => this.salesRange().from);
  readonly salesToDate = computed(() => this.salesRange().to);
  readonly salesRangeText = computed(() => rangeLabel(this.salesFromDate(), this.salesToDate()));
  readonly salesRangeShort = computed(() => rangeLabelShort(this.salesFromDate(), this.salesToDate(), this.today()));
  readonly salesPeriodLabel = computed(() => periodLabel(this.salesPeriod(), this.today()));
  /*
   * Inkoop (design §3.5, critique B10, N8): four parts, ?deel; Kwaliteit and Afwijkingen share one receipt
   * period and supplier (?ontvangst/ovan/otot, ?leverancier); ?orderId focuses Afwijkingen on one order.
   */
  private readonly urlGet = (key: string) => this.route.snapshot.queryParamMap.get(key);
  readonly part = signal<InkoopPart>(parsePart(this.urlGet));
  readonly receiptPeriod = signal<PeriodChoice>(parseReceiptPeriod(this.urlGet));
  readonly receiptSupplier = signal<number | null>(parseSupplier(this.urlGet));
  readonly focusedOrderId = signal<number | null>(parseOrderId(this.urlGet));
  readonly receiptRange = computed(() => periodRange(this.receiptPeriod(), this.today()));
  readonly receiptRangeText = computed(() => rangeLabel(this.receiptRange().from, this.receiptRange().to));
  readonly receiptPeriodLabel = computed(() => periodLabel(this.receiptPeriod(), this.today()));
  readonly receiptNote = RECEIPT_PERIOD_NOTE;
  /** Kwaliteit's report: the receipt filter without the order focus (N8). */
  private readonly unfocusedReport = signal<ReceiptVarianceReport>(EMPTY_REPORT);
  /* Kwaliteit shows no variance figures since round 2 (they are Afwijkingen'); the report counts the part's orders. */
  readonly qualityReport = computed(() => this.focusedOrderId() === null ? this.report() : this.unfocusedReport());
  readonly partnerSheetId = signal<number | null>(null);
  readonly partnerSheetRow = computed(() => this.financing().rows.find((row) => row.purchaseOrderId === this.partnerSheetId()) ?? null);
  readonly valueSheetKey = signal<string | null>(null);
  readonly valueSheetRow = computed(() => this.report().rows.find((row) => this.valueKey(row) === this.valueSheetKey()) ?? null);
  readonly partOptions = computed<SegmentOption[]>(() => this.partsWith(PART_LABELS, true));
  readonly partOptionsPhone = computed<SegmentOption[]>(() => this.partsWith(PART_PHONE, false));
  readonly nextAdvanceDue = computed(() => this.financing().rows.map((row) => row.nextAdvanceDueDate).filter((day): day is string => !!day).sort()[0] ?? null);
  readonly focusName = computed(() => {
    const id = this.focusedOrderId();
    if (id === null) return '';
    const row = this.report().rows.find((candidate) => candidate.orderId === id);
    return this.containerOf(id, row?.orderNumber ?? '', row?.orderAlias ?? null);
  });
  readonly savingValue = signal<string | null>(null);
  readonly valueDrafts = signal<Record<string, string>>({});

  readonly receivedForPerformance = computed(() => this.purchases().filter((row) =>
    row.order.status === 'ONTVANGEN'
    && inDateRange(row.order.receivedOn, this.receiptRange().from || undefined, this.receiptRange().to || undefined)
    && (this.receiptSupplier() === null || row.order.supplierId === this.receiptSupplier())));
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
  readonly orderedCount = computed(() => this.incomingOrders()
    .filter((row) => row.order.status === 'BESTELD').length);
  readonly sailingCount = computed(() => this.incomingOrders()
    .filter((row) => row.order.status === 'ONDERWEG').length);

  /** What is open today, every year: the pipeline of Verkoop (partner funding left out), not bound to its period. */
  readonly openSales = computed(() => openPipelineQuotes(this.salesOrders()));
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

  /* ---------- the drill-downs (design/analyses2 §A, §B): every row list comes from the data the tiles read */
  readonly drillHost = inject(AnDrillHost);
  /** Verkoop's documents of the period, every year's (the snapshots), and the period's TICA months. */
  readonly salesDocs = computed(() => salesDocumentRows(this.salesOrders(), this.customers(),
    { from: this.salesFromDate() || null, to: this.salesToDate() || null, today: this.today() }));
  readonly allDocs = computed(() => salesDocumentRows(this.salesOrders(), this.customers(), { today: this.today() }));
  readonly ticaMonths = computed(() => ticaMonthRows(this.ticaDays(), this.salesFromDate() || null, this.salesToDate() || null));
  /** "Dit jaar · 1 jan – 20 okt 2026": the scope line of Verkoop's dialogs. */
  readonly salesScope = computed(() => {
    const label = this.salesPeriodLabel(), range = this.salesRangeText();
    return !this.salesFromDate() && !this.salesToDate() ? label : `${label} · ${range}`;
  });
  private readonly drillContext = computed<SalesDrillContext>(() => ({ period: this.salesScope(), channelName: channelLabel }));

  readonly salesMetrics = computed(() => withTicaSales(salesAnalysis(this.salesOrders(), this.customers(), {
    from: this.salesFromDate() || undefined,
    to: this.salesToDate() || undefined,
    today: this.today(),
    topLimit: 8,
  }), this.ticaDays()));
  readonly financing = computed(() => partnerFinancingAnalysis(this.purchases(), this.salesOrders(), this.customers(), this.partnerSummaries()));
  /** Partners' eight tiles (C.5): subs of at most four words, the explanations behind Hoe gerekend. */
  readonly partnerTiles = computed<KpiTile<PartnerTileKey>[]>(() => {
    const f = this.financing(), desk = this.desk.active(), next = this.nextAdvanceDue(), overdue = f.overdueUnbilledAdvanceEur;
    return [
      { key: 'advance', label: desk ? 'Afgesproken voorfinanciering' : 'Voorfinanciering', value: this.whole(f.committedAdvanceEur), tone: null, sub: 'excl. btw',
        foot: `${this.whole(f.invoicedEur)} voorschot gefactureerd`, drill: false },
      { key: 'unbilled', label: desk ? 'Voorschotten nog factureren' : 'Nog factureren', value: this.whole(f.unbilledAdvanceEur), tone: overdue > 0 ? 'danger' : null,
        sub: `excl. btw · ${plural(f.unbilledAdvanceCount, 'termijn', 'termijnen')}`,
        foot: overdue > 0 ? `${this.whole(overdue)} met vervaldatum bereikt` : next ? `volgende vervaldatum ${this.dayText(next)}` : '', footWarn: overdue > 0,
        drill: f.unbilledAdvanceCount > 0 },
      { key: 'received', label: desk ? 'Netto van partners ontvangen' : 'Netto ontvangen', value: this.whole(f.receivedEur), tone: null, sub: 'incl. btw', foot: '', drill: false },
      { key: 'open', label: 'Nog te ontvangen', value: this.whole(f.openEur), tone: null, sub: 'incl. btw', foot: '', drill: f.openEur > 0 },
      { key: 'own', label: 'Eigen kasinleg', value: this.whole(f.ownExposureEur), tone: null, sub: 'betaald min partnergeld', foot: '', drill: false },
      { key: 'result', label: desk ? 'Gerealiseerd partnerresultaat' : 'Partnerresultaat', value: this.whole(f.resultEur), tone: f.resultEur < 0 ? 'danger' : null,
        sub: 'uit afrekeningen', foot: '', drill: false },
      { key: 'credit', label: 'Credit voor partners', value: this.whole(f.creditEur), tone: null, sub: 'te verrekenen', foot: '', drill: false },
      { key: 'settle', label: 'Nog af te rekenen', value: wholeNumber(f.awaitingSettlement), unit: f.awaitingSettlement === 1 ? 'container' : 'containers',
        tone: f.awaitingSettlement > 0 ? 'warn' : null, sub: 'veilingoverzicht wacht', foot: '', drill: f.awaitingSettlement > 0 },
    ];
  });
  readonly incoming = computed(() => incomingMoneyTotals(this.incomingPayments(), this.salesFromDate(), this.salesToDate()));
  /* Investments charge the period with their depreciation (finance-metrics); what is still open reads the payments. */
  readonly result = computed(() => withTicaResult(resultAnalysis(this.salesOrders(), this.purchases(), this.costs(), {
    from: this.salesFromDate() || undefined, to: this.salesToDate() || undefined, costCharge: (cost, from, to) => costChargeIn(cost, from, to, this.today()), openEur: openOf,
    today: this.today(),
  }), this.ticaDays()));
  readonly monthsNewestFirst = computed(() => [...this.result().monthly].reverse());
  /** Resultaat's cost parts of the period (resultCostRows): Eigen kosten, the categories and the channels list them. */
  private readonly costCharge: CostCharge = (cost, from, to) => costChargeIn(cost, from, to, this.today());
  readonly costRows = computed(() => resultCostRows(this.costs(), { from: this.salesFromDate() || null, to: this.salesToDate() || null,
    costCharge: this.costCharge, openEur: openOf }));
  private readonly resultContext = computed<ResultDrillContext>(() => ({ period: this.salesScope(), channelName: channelLabel, categoryName: categoryLabel,
    costsQuery: this.costsQuery() }));
  /** Resultaat's five tiles (C.3): "—" for each source a figure reads (D-O3); the Resultaat tile is the bars and Per maand below. */
  readonly resultTiles = computed<KpiTile<ResultTileKey>[]>(() => {
    const r = this.result(), salesDown = this.failed('verkoop') || this.failed('TICA verkopen'), costsDown = this.failed('kosten');
    const missing = r.missingCostLines;
    const tica = r.ticaTransactions ? plural(r.ticaTransactions, 'TICA-verkoop', 'TICA-verkopen') : '';
    const credits = r.creditNoteCount ? plural(r.creditNoteCount, 'creditnota', 'creditnota’s') : '';
    const cost = `kost ${this.whole(r.goodsCostEur)}`;
    return [
      { key: 'revenue', label: 'Omzet', value: salesDown ? '—' : this.whole(r.revenueEur), tone: null,
        sub: `excl. btw · ${plural(r.revenueInvoiceCount, 'factuur', 'facturen')}`, foot: [tica, credits].filter(Boolean).join(' · '), drill: !salesDown && r.revenueEur !== 0 },
      { key: 'margin', label: 'Marge op goederen', value: salesDown || missing ? '—' : this.whole(r.marginEur), tone: !salesDown && !missing && r.marginEur < 0 ? 'danger' : null,
        sub: missing ? `${plural(missing, 'regel', 'regels')} zonder kost` : r.marginPct === null ? cost : `${pctText(r.marginPct, 1)} · ${cost}`, subWarn: missing > 0,
        foot: '', drill: !salesDown && (missing > 0 || r.marginEur !== 0) },
      { key: 'costs', label: 'Eigen kosten', value: costsDown ? '—' : this.whole(r.costsEur), tone: null,
        sub: costsDown ? '' : r.unpaidCostsEur ? `${this.whole(r.unpaidCostsEur)} open incl. btw` : 'alles betaald',
        foot: !costsDown && r.depreciationEur > 0 ? `waarvan ${this.whole(r.depreciationEur)} afschrijvingen` : '', drill: !costsDown && (r.costsEur !== 0 || r.unpaidCostsEur !== 0) },
      { key: 'result', label: 'Resultaat', value: salesDown || costsDown || missing ? '—' : this.whole(r.resultEur),
        tone: !salesDown && !costsDown && !missing && r.resultEur < 0 ? 'danger' : null, sub: missing ? 'onvolledig: kost ontbreekt' : 'marge min kosten', foot: '', drill: false },
      { key: 'received', label: 'Containers ontvangen', value: this.failed('inkoop') ? '—' : this.whole(r.purchasedEur), tone: null,
        sub: plural(r.receivedContainers, 'container', 'containers'), foot: 'telt niet in het resultaat', drill: !this.failed('inkoop') && r.receivedContainers > 0 },
    ];
  });
  /** A month of Per maand or the bars with something in it opens its rows. */
  monthActive(row: { revenueEur: number; marginEur: number; costsEur: number }): boolean {
    return row.revenueEur !== 0 || row.marginEur !== 0 || row.costsEur !== 0;
  }
  readonly monthLabel = monthLabel;
  readonly channelLabel = channelLabel;
  channelVolume(invoiceCount: number, ticaTransactions = 0): string {
    return [invoiceCount || !ticaTransactions ? plural(invoiceCount, 'factuur', 'facturen') : '',
      ticaTransactions ? plural(ticaTransactions, 'TICA-verkoop', 'TICA-verkopen') : ''].filter(Boolean).join(' · ');
  }
  /** "waarvan voorschot € 77.376 · gecrediteerd − € 80" (parts left out when zero). */
  readonly invoicedFoot = computed(() => {
    const invoices = this.salesMetrics().invoices;
    return [invoices.advanceClaimEur ? `waarvan voorschot ${this.whole(invoices.advanceClaimEur)}` : '',
      invoices.creditedEur ? `gecrediteerd ${this.whole(-invoices.creditedEur)}` : ''].filter(Boolean).join(' · ');
  });
  /** Ontvangen opens Kosten & bank on the incoming payments of the same period. */
  readonly incomingQuery = computed(() => ({ view: 'incoming', tab: 'received', from: this.salesFromDate() || null, to: this.salesToDate() || null,
    period: this.salesFromDate() || this.salesToDate() ? null : 'all' }));
  /**
   * "8 open · 3 gesloten" (D-S7): Aangemaakt is the first bar and Geannuleerd sits in the foot, so the trail keeps
   * what neither says; "n overige" only when some quote is in none of them.
   */
  readonly funnelTrail = computed(() => {
    const funnel = this.salesMetrics().funnel;
    const other = funnel.created - funnel.open - funnel.closed - funnel.cancelled;
    /* A no-break space keeps each number with its word when the trail wraps on the phone. */
    return [`${funnel.open}\u00a0open`, `${funnel.closed}\u00a0gesloten`, other > 0 ? `${other}\u00a0overige` : ''].filter(Boolean).join(' · ');
  });
  /** Afgewezen · Verlopen · Geannuleerd under the bars; each with offertes opens them. */
  readonly funnelFoot = computed(() => {
    const funnel = this.salesMetrics().funnel;
    return [{ key: 'rejected' as const, label: 'Afgewezen', count: funnel.rejected }, { key: 'expired' as const, label: 'Verlopen', count: funnel.expired },
      { key: 'cancelled' as const, label: 'Geannuleerd', count: funnel.cancelled }];
  });

  /** The eight Verkoop tiles (C.2): "—" for a source that failed (D-O3), the snapshots say "vandaag" and cover every year. */
  readonly salesTiles = computed<KpiTile[]>(() => {
    const m = this.salesMetrics(), inv = m.invoices, all = this.allSales().invoices, received = this.incoming();
    const salesDown = this.failed('verkoop'), down = salesDown || this.failed('TICA verkopen');
    const missing = m.missingCostLines;
    const credits = inv.creditNoteCount ? plural(inv.creditNoteCount, 'creditnota', 'creditnota’s') : '';
    const tica = m.ticaTransactions ? plural(m.ticaTransactions, 'TICA-verkoop', 'TICA-verkopen') : '';
    const pct = m.marginPct === null ? 'op verkochte goederen' : `${m.marginPct.toLocaleString('nl-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} % op goederen`;
    const quotes = this.openSales().length;
    return [
      { key: 'revenue', label: 'Omzet', value: down ? '—' : this.whole(m.revenueExclEur), tone: null,
        sub: `excl. btw · ${plural(inv.revenueInvoiceCount, 'factuur', 'facturen')}`, foot: [tica, credits].filter(Boolean).join(' · '),
        drill: !down && m.revenueExclEur !== 0 },
      { key: 'margin', label: 'Brutomarge', value: down || missing ? '—' : this.whole(m.marginEur), tone: !down && !missing && m.marginEur < 0 ? 'danger' : null,
        sub: missing ? `${plural(missing, 'regel', 'regels')} zonder kost` : pct, subWarn: missing > 0, foot: '',
        drill: !down && (missing > 0 || m.marginEur !== 0) },
      { key: 'invoiced', label: 'Gefactureerd', value: salesDown ? '—' : this.whole(inv.issuedValueEur), tone: null,
        sub: `incl. btw · ${plural(inv.issued, 'factuur', 'facturen')}`, foot: this.invoicedFoot(), drill: !salesDown && inv.issuedValueEur !== 0 },
      { key: 'received', label: 'Ontvangen', value: this.failed('inkomende betalingen') ? '—' : this.whole(received.receivedEur), tone: null,
        sub: `incl. btw · ${plural(received.count, 'betaling', 'betalingen')}`,
        foot: `klanten ${this.whole(received.standardEur)} · voorschot ${this.whole(received.partnerAdvanceEur)} · afrekening ${this.whole(received.partnerSettlementEur)}`, drill: false },
      { key: 'openQuotes', label: 'Open offertes', value: salesDown ? '—' : this.whole(this.pipelineValue()), tone: null,
        sub: `vandaag · ${plural(quotes, 'offerte', 'offertes')}`, foot: this.pipelineMissingCostLines() ? 'marge onbekend' : `marge ${this.whole(this.pipelineMargin())}`,
        footWarn: this.pipelineMissingCostLines() > 0, drill: !salesDown && quotes > 0 },
      { key: 'accepted', label: 'Geaccepteerd', value: salesDown ? '—' : this.whole(m.accepted.calculatedValueEur), tone: null,
        sub: `excl. btw · ${plural(m.accepted.count, 'offerte', 'offertes')}`, foot: '', drill: !salesDown && m.accepted.count > 0 },
      { key: 'openInvoices', label: 'Open facturen', value: salesDown ? '—' : this.whole(all.outstandingValueEur), tone: null,
        sub: `vandaag · ${plural(all.outstanding, 'factuur', 'facturen')}`, foot: inv.avgDaysToPaid === null ? '' : `betaaltermijn gem. ${plural(inv.avgDaysToPaid, 'dag', 'dagen')}`,
        drill: !salesDown && all.outstanding > 0 },
      { key: 'overdue', label: 'Vervallen', value: salesDown ? '—' : this.whole(all.overdueValueEur), tone: !salesDown && all.overdue > 0 ? 'danger' : null,
        sub: `vandaag · ${plural(all.overdue, 'factuur', 'facturen')}`, foot: '', drill: !salesDown && all.overdue > 0 },
    ];
  });

  /* Lists: 8 rows on the desk, 5 on the phone, the rest behind "Alle n tonen" (design §2.1, §2.3). */
  readonly openLists = signal<ReadonlySet<string>>(new Set());
  readonly listLimit = computed(() => this.desk.active() ? 8 : 5);
  /**
   * A list beside a shorter card stops at 5 on the desk too, so both columns end close together (design §2.1.5):
   * Verkoop's Opvolgen beside Omzet per kanaal.
   */
  limitOf(key: string): number { return SHORT_LISTS.has(key) ? 5 : this.listLimit(); }
  take<T>(key: string, rows: readonly T[]): readonly T[] {
    const limit = this.limitOf(key);
    return this.openLists().has(key) || rows.length <= limit ? rows : rows.slice(0, limit);
  }
  toggleList(key: string): void {
    this.openLists.update((open) => { const next = new Set(open); if (!next.delete(key)) next.add(key); return next; });
  }
  /** "7.200 stuks", "1.500 displays": a count in the product's own sales unit (design §5.10). */
  unitWords(productId: number, count: number): string {
    const product = this.products().find((candidate) => candidate.id === productId);
    if (!product) return `${new Intl.NumberFormat('nl-BE').format(count)} stuks`;
    const unit = productSalesUnit(product);
    return (unit.isDisplay ? fractionalDisplayCount(count, unit.piecesPerDisplay, unit.piece) : null) ?? unitCount(unit, count);
  }
  readonly categoryLabel = categoryLabel;

  /** The last invoice day per product: Nulvoorraad's order and the Aandacht list. */
  readonly lastSold = computed(() => lastSoldOn(this.salesOrders()));
  /* A failed sales load leaves the pace unknown (D-V4): never "every valued product is slow". */
  readonly inventoryMetrics = computed(() => inventoryAnalysis(this.stockProducts(), this.expectedStock(),
    { topLimit: 10, sales: this.failed('verkoop') ? undefined : this.salesOrders(), today: this.today(), lastSold: this.lastSold() }));

  /** Voorraad's four tiles (C.4): "—" for a source that failed (D-O3); Onderweg in euro and containers (D-V3). */
  readonly stockTiles = computed<KpiTile<StockTileKey>[]>(() => {
    const im = this.inventoryMetrics(), stockDown = this.failed('voorraad'), buyDown = this.failed('inkoop');
    const paceDown = stockDown || this.failed('verkoop');
    const orders = this.incomingOrders();
    const first = orders.map((row) => row.order.expectedArrival).filter((day): day is string => !!day).sort()[0] ?? null;
    const uplift = im.stock.potentialUpliftEur, reorder = im.reorder.count;
    return [
      { key: 'cost', label: 'Kostwaarde', value: stockDown ? '—' : this.whole(im.stock.costValueEur), tone: null,
        sub: `${plural(im.physicalStock.valuedPieces, 'gewaardeerd stuk', 'gewaardeerde stuks')}`,
        foot: `eigen ${this.whole(im.stock.ownCostValueEur)} · partner ${this.whole(im.stock.partnerCostValueEur)}`, drill: !stockDown && im.capital.length > 0 },
      { key: 'sales', label: 'Verkoopwaarde', value: stockDown ? '—' : this.whole(im.stock.salesValueEur), tone: null, sub: 'lijstprijs excl. btw',
        foot: uplift === null ? 'kostdekking onvolledig' : `marge op voorraad ${this.whole(uplift)}`, footWarn: uplift === null,
        drill: !stockDown && im.stock.salesValueEur !== 0 },
      { key: 'incoming', label: 'Onderweg', value: buyDown ? '—' : this.whole(this.incomingValue()), tone: null,
        sub: orders.length ? `${plural(orders.length, 'container', 'containers')}${first ? ` · eerst ${this.dayText(first)}` : ''}` : 'niets besteld',
        foot: orders.length ? `${this.orderedCount()} besteld · ${this.sailingCount()} vertrokken` : '', drill: !buyDown && orders.length > 0 },
      { key: 'reorder', label: 'Raakt op', value: paceDown ? '—' : wholeNumber(reorder), unit: paceDown ? '' : reorder === 1 ? 'SKU' : 'SKU’s',
        tone: !paceDown && reorder > 0 ? 'danger' : null, sub: `binnen ${im.reorder.horizonWeeks} weken`,
        foot: paceDown ? '' : `tempo ${wholeNumber(im.velocity.weeklyPieces)} per week`, drill: !paceDown && reorder > 0 },
    ];
  });
  /** Datakwaliteit (C.4): each count after "met stand" opens the products it counts. */
  readonly qualityItems = computed(() => {
    const gaps = this.inventoryMetrics().dataGaps;
    return [
      { key: 'unknown', count: gaps.unknownStockSkuCount, label: 'onbekend' },
      { key: 'unvalued', count: gaps.unvaluedStockSkuCount, label: 'zonder kostprijs' },
      { key: 'missingCarton', count: gaps.missingCartonSkuCount, label: 'zonder omdoos' },
      { key: 'negative', count: gaps.negativeStockSkuCount, label: 'negatief' },
    ] as const;
  });

  /** Onderweg as a list (design §5.11): soonest arrival first, then the most pieces; containers by name (N11). */
  readonly incomingRows = computed(() => [...this.inventoryMetrics().incoming.rows]
    .sort((left, right) => (left.expectedArrival ?? '9999').localeCompare(right.expectedArrival ?? '9999') || right.pieces - left.pieces)
    .map((row) => ({ ...row, containers: row.orderIds.map((id, index) => this.containerOf(id, row.orderNumbers[index] ?? `Inkoop #${id}`, null)).join(', ') })));
  /** Trage verkopers folds into the capital card when it lists the same products (design §3.4). */
  readonly slowSameAsCapital = computed(() => {
    const metrics = this.inventoryMetrics();
    const slow = metrics.slowMovers.rows.map((row) => row.productId).sort((a, b) => a - b).join(',');
    const capital = metrics.topCapital.map((row) => row.productId).sort((a, b) => a - b).join(',');
    return slow.length > 0 && slow === capital && metrics.slowMovers.count === metrics.topCapital.length;
  });

  /** Omzet per maand (D-S4): the omzet of the invoices and TICA, beside the accepted quotes; one VAT basis, excl. btw. */
  readonly salesTrend = computed<TrendSeries[]>(() => {
    const metrics = this.salesMetrics(), monthly = metrics.monthly;
    if (!monthly.some((point) => point.revenueExclEur !== 0 || point.acceptedEur !== 0) && !metrics.ticaMonthly.some(point => point.revenueExclEur !== 0)) return [];
    const months = [...new Set([...monthly.map(point => point.month), ...metrics.ticaMonthly.map(point => point.month)])].sort();
    const dates = months.map(month => `${month}-01`);
    const revenue = (month: string) => (monthly.find(point => point.month === month)?.revenueExclEur ?? 0)
      + (metrics.ticaMonthly.find(point => point.month === month)?.revenueExclEur ?? 0);
    return [
      { label: 'Omzet excl. btw', dates, values: months.map(month => Math.round(revenue(month) * 100) / 100), tone: 'accent' },
      { label: 'Geaccepteerde offertes excl. btw', dates, values: months.map(month => monthly.find(point => point.month === month)?.acceptedEur ?? 0), tone: 'muted' },
    ];
  });

  /** Each stage of the quote funnel as a bar against the number created, with the rate that got it there. */
  readonly funnelSteps = computed(() => {
    const funnel = this.salesMetrics().funnel;
    const width = (count: number) => funnel.created > 0 ? Math.max(count > 0 ? 2 : 0, (count / funnel.created) * 100) : 0;
    const rate = (value: number | null, of: string) => value === null ? `nog geen ${of}` : `${Math.round(value)} % van ${of}`;
    return [
      { key: 'created' as const, label: 'Aangemaakt', count: funnel.created, width: width(funnel.created), rate: 'alle offertes in de periode', accent: false },
      { key: 'sent' as const, label: 'Verzonden', count: funnel.sent, width: width(funnel.sent), rate: rate(funnel.sendRatePct, 'aangemaakt'), accent: false },
      { key: 'viewed' as const, label: 'Bekeken door de klant', count: funnel.viewed, width: width(funnel.viewed), rate: rate(funnel.viewRatePct, 'verzonden'), accent: false },
      { key: 'accepted' as const, label: 'Geaccepteerd', count: funnel.accepted, width: width(funnel.accepted), rate: rate(funnel.conversionRatePct, 'gesloten'), accent: true },
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
  /** Afgesproken: the average lead time (> 0) of the suppliers of the received orders in view. */
  readonly agreedLeadDays = computed<number | null>(() => {
    const ids = new Set(this.receivedForPerformance().map((row) => row.order.supplierId));
    const days = this.suppliers().filter((supplier) => supplier.id !== null && ids.has(supplier.id) && supplier.leadTimeDays > 0).map((supplier) => supplier.leadTimeDays);
    return days.length ? Math.round(days.reduce((sum, value) => sum + value, 0) / days.length) : null;
  });
  /** The received orders of Kwaliteit, one row each with the tests of its figures (receiptOrderRows) and their names. */
  readonly receivedOrderRows = computed<ReceivedOrderRow[]>(() => {
    const views = this.receivedForPerformance();
    return receiptOrderRows(views.map((row) => ({ id: row.order.id, orderDate: row.order.orderDate, receivedOn: row.order.receivedOn,
      expectedArrival: row.order.expectedArrival, lines: row.order.lines }))).map((row, index) => {
      const order = views[index].order;
      const lead = this.suppliers().find((supplier) => supplier.id === order.supplierId)?.leadTimeDays ?? 0;
      return { ...row, name: containerName(order), supplierId: order.supplierId, supplierName: this.supplierName(order.supplierId), agreedDays: lead > 0 ? lead : null };
    });
  });
  /** "Dit jaar · 1 jan – 21 okt 2026 · op ontvangstdatum · Yunnan": the scope line of Kwaliteit's and Afwijkingen' dialogs. */
  readonly receiptScope = computed(() => {
    const range = this.receiptRange(), supplier = this.receiptSupplier();
    return [this.receiptPeriodLabel(), range.from || range.to ? this.receiptRangeText() : '', 'op ontvangstdatum',
      supplier === null ? '' : this.supplierName(supplier)].filter(Boolean).join(' · ');
  });
  /** Kwaliteit's three tiles (C.5): each opens the received orders, ordered for its figure. */
  readonly qualityTiles = computed<KpiTile<ReceiptFigure>[]>(() => {
    const perf = this.supplierPerformance(), lead = this.leadDays(), agreed = this.agreedLeadDays(), any = perf.receivedOrders > 0;
    return [
      { key: 'perfect', label: 'Perfect ontvangen', value: perf.perfectPct === null ? '—' : pctText(perf.perfectPct, 1), tone: null,
        sub: `${wholeNumber(perf.perfectOrders)} van ${plural(perf.comparableOrders, 'order', 'orders')}`, foot: '', drill: any && perf.perfectPct !== null },
      { key: 'ontime', label: 'Op tijd', value: perf.onTimePct === null ? '—' : pctText(perf.onTimePct, 0), tone: null,
        sub: `${wholeNumber(perf.onTimeOrders)} van ${wholeNumber(perf.datedOrders)} · laatste ETA`, foot: '', drill: any && perf.onTimePct !== null },
      { key: 'lead', label: 'Doorlooptijd', value: lead === null ? '—' : plural(lead, 'dag', 'dagen'), tone: null, sub: 'besteld tot ontvangst',
        foot: agreed === null ? '' : `afgesproken ${wholeNumber(agreed)} d`, drill: any && lead !== null },
    ];
  });
  private readonly regionNames = new Intl.DisplayNames(['nl'], { type: 'region' });

  /** Afwijkingen' order cards: the report's lines per order (the rule of the Overzicht dialog too, drill-purchase.ts). */
  readonly varianceGroups = computed<VarianceGroup[]>(() => varianceGroups(this.report().rows));

  /* ---------- Overzicht: its own periods, never another tab's filter (critique B5) */
  readonly fx = inject(Fx);
  /** Whole euros (Kasprognose's format); the sign, € and the number never part over two lines. */
  readonly whole = (value: number | null | undefined): string => eurWhole(value).replace(/ /g, '\u00a0');
  readonly plural = plural;
  readonly openContainersLine = openContainersLine;
  readonly paymentResultLine = paymentResultLine;
  /* Read again on every tab switch: a period picked on Markt (same page instance) shows on Overzicht. */
  private readonly marketMonths = computed(() => { this.section(); return storedMarketMonths(); });
  readonly yearStartDay = computed(() => yearStart(this.today()));
  /** Year to date for the Verkoop and Resultaat rows. */
  readonly ytdSales = computed(() => withTicaSales(salesAnalysis(this.salesOrders(), this.customers(), {
    from: this.yearStartDay(), to: this.today(), today: this.today(), topLimit: 8,
  }), this.ticaDays()));
  readonly ytdResult = computed(() => withTicaResult(resultAnalysis(this.salesOrders(), this.purchases(), this.costs(), {
    from: this.yearStartDay(), to: this.today(), costCharge: (cost, from, to) => costChargeIn(cost, from, to, this.today()), openEur: openOf,
  }), this.ticaDays()));
  /** All years: what waits, whatever period Verkoop shows (overdue invoices). */
  readonly allSales = computed(() => salesAnalysis(this.salesOrders(), this.customers(), { today: this.today(), topLimit: 1 }));
  /** The Inkoop digest row: the active containers of Containerkost (same helpers, same filter); "op n" counts those with something open (D-O2). */
  readonly containerDigest = computed(() => {
    const rows = containerCostRows(this.purchases(), 'active', '').map((row) => ({ ...row, paymentResult: purchasePaymentResult(row.view) }));
    return { openCount: rows.filter((row) => row.reconciliation.totals.remainingEur > 0).length, totals: containerCostTotals(rows), payment: containerPaymentResultTotals(rows) };
  });
  readonly marketDigest = computed(() => {
    const series = this.fx.series();
    if (!series) return null;
    const months = this.marketMonths();
    const change = changeOverMonths({ dates: series.dates, values: series.usd }, months);
    return { lines: marketLines(series.latestCny, change?.pct ?? null, months), dollar: dollarValue(series.latestUsd) };
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
    const unvalued = report.totals.unvaluedLossPieces;
    const plain = { value: null, valueTone: null, meta: null, metaTone: null } as const;
    return [
      { ...plain, key: 'quotes', count: this.openSales().length, tone: null, title: 'Open offertes',
        sub: missing ? `${plural(missing, 'regel', 'regels')} zonder kost` : 'vandaag, alle jaren',
        value: this.openSales().length ? this.whole(this.pipelineValue()) : null, meta: this.openSales().length ? 'excl. btw' : null },
      { ...plain, key: 'overdue', count: invoices.overdue, tone: 'danger', title: 'Vervallen facturen', sub: overdueSub(invoices.overdue),
        value: this.whole(invoices.overdueValueEur), valueTone: invoices.overdue ? 'danger' : null, meta: 'incl. btw' },
      { ...plain, key: 'stock', count: inventory.zeroStock.withoutIncomingCount, tone: 'warn', title: 'Producten zonder voorraad én inkoop',
        sub: 'actief, niets besteld' },
      { ...plain, key: 'variance', count: report.totals.affectedOrders, tone: 'warn', title: variance.title, sub: variance.sub,
        value: this.whole(report.totals.totalLossValueEur), meta: unvalued ? `+ ${unvalued.toLocaleString('nl-BE')} zonder waarde` : 'bekende impact' },
      { ...plain, key: 'settle', count: financing.awaitingSettlement, tone: 'warn', title: 'Partnercontainers af te rekenen',
        sub: financing.awaitingSettlement ? 'Ontvangen; het veilingoverzicht wacht' : 'Geen ontvangen partnercontainer wacht' },
      { ...plain, key: 'advance', count: financing.unbilledAdvanceCount, tone: overdueAdvance > 0 ? 'danger' : null, title: 'Voorschottermijnen te factureren',
        sub: advanceTermsSub(terms, this.today()),
        value: this.whole(financing.unbilledAdvanceEur), valueTone: overdueAdvance > 0 ? 'danger' : null,
        meta: overdueAdvance > 0 ? `waarvan ${this.whole(overdueAdvance)} vervallen` : 'excl. btw', metaTone: overdueAdvance > 0 ? 'danger' : null },
    ];
  });
  /**
   * Overzicht's Kasprognose row (C.1, the card that stood on top): the lowest point over the Kasprognose horizon, warn
   * under the buffer and danger below zero, with the bank today ("saldo ontbreekt" in relative mode).
   */
  readonly cashRow = computed<{ value: string; tone: 'warn' | 'danger' | null; meta: string | null; sub: string }>(() => {
    const forecast = this.cashState.forecast();
    if (this.cashSources.state() === 'ready' && this.cashSources.bankMissing()) return { value: '—', tone: null, meta: null, sub: 'Banksaldo kon niet laden' };
    if (!forecast) return { value: '—', tone: null, meta: null, sub: 'Banksaldo laden…' };
    const low = forecast.lowestWith;
    return {
      value: this.whole(low.eur), tone: low.eur < 0 ? 'danger' : underBuffer(forecast, low.eur) ? 'warn' : null,
      meta: `laagste · ${weekdayDayMonth(low.day)}`,
      sub: forecast.mode === 'relative' ? 'saldo ontbreekt' : `op de bank ${this.whole(forecast.startEur)}`,
    };
  });
  readonly attentionCount = computed(() => this.attention().filter((row) => row.count > 0).length);

  /** Advance schedules to wait for before the first forecast (critique N13): only with partner financings that have one. */
  private readonly schedulesNeeded = computed(() => !this.dataWarnings().includes('partnerfinanciering')
    && financingsWithSchedule(this.partnerSummaries()).length > 0);

  /** What the Kasprognose reads from this page's own load (spec §4.1: never fetched twice). */
  private readonly cashPage = computed<CashPageData>(() => ({
    purchases: this.purchases(), suppliers: this.suppliers(), products: this.products(), salesOrders: this.salesOrders(),
    customers: this.customers(), costs: this.costs(), incomingPayments: this.incomingPayments(),
  }));

  constructor() {
    this.cashState.attach(this.cashPage, this.loading, this.today, this.schedulesNeeded);
    effect(() => {
      const range = this.ticaLines();
      if (range && untracked(this.ticaCard).key !== `${range.from}|${range.to}`) untracked(() => void this.loadTicaCard(range));
    });
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
    /*
     * Inkoop in the URL (critique N9): a link with any Inkoop key sets the part, receipt period, supplier and
     * order focus; a bare link (the sidebar, a chip) gets the current state written back.
     */
    effect(() => {
      const params = this.queryParams();
      if (this.section() !== 'purchasing') return;
      untracked(() => {
        const get = (key: string) => params.get(key);
        if (!['deel', 'orderId', 'leverancier', ...Object.values(RECEIPT_PERIOD_KEYS)].some((key) => params.has(key))) {
          /* The default state has no keys: no second navigation then. */
          const state = this.inkoopParams();
          if (Object.values(state).some((value) => value !== null)) this.writeParams(state);
          return;
        }
        const focus = parseOrderId(get);
        if (focus !== this.focusedOrderId()) { this.focusedOrderId.set(focus); this.focusScrolled = false; }
        const part = parsePart(get);
        if (part !== this.part()) this.part.set(part);
        const period = parseReceiptPeriod(get);
        if (!samePeriod(period, this.receiptPeriod())) this.receiptPeriod.set(period);
        const supplier = parseSupplier(get);
        if (supplier !== this.receiptSupplier()) this.receiptSupplier.set(supplier);
      });
    });
    /* Filters apply at once; the variance report reloads 300 ms after the last change. */
    effect(() => {
      const key = JSON.stringify(this.filters());
      if (this.data() !== 'ready') return;
      untracked(() => {
        if (key === this.loadedFilterKey) return;
        clearTimeout(this.varianceTimer);
        this.varianceTimer = setTimeout(() => void this.loadVariances(), 300);
      });
    });
    /* ?orderId: once the report is on screen, the focused order scrolls into view with its ring (design §3.5). */
    afterRenderEffect(() => {
      const id = this.focusedOrderId();
      if (id === null || this.focusScrolled || this.part() !== 'afwijkingen' || this.section() !== 'purchasing' || !this.varianceGroups().length) return;
      const card = document.getElementById(`an-order-${id}`);
      if (!card) return;
      this.focusScrolled = true;
      card.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
    });
  }

  /* ---------- the drill-downs: each opener builds its views from the computed value its trigger shows (rule A.4) */

  /** Overzicht › Aandacht: each row with a count opens the list behind it. */
  openAttention(key: string): void {
    const views = this.attentionViews(key);
    if (views) this.drillHost.open(views);
  }

  private attentionViews(key: string): DrillView[] | null {
    switch (key) {
      case 'quotes': return [this.openQuotesDrill()];
      case 'overdue': return [overdueView(this.allDocs(), this.allSales().invoices.overdueValueEur)];
      case 'stock': {
        const zero = this.inventoryMetrics().zeroStock;
        return [zeroNoIncomingView(zero.rows, this.lastSold(), zero.withoutIncomingCount)];
      }
      case 'variance': {
        const report = this.overviewReport();
        return [varianceOrdersView(varianceGroups(report.rows), report.totals.totalLossValueEur, report.totals.unvaluedLossPieces,
          `Dit jaar · ${this.yearRangeText()} · op ontvangstdatum`, (group) => this.containerOf(group.orderId, group.orderNumber, group.orderAlias))];
      }
      case 'settle': return [this.partnerView('settle')];
      case 'advance': return [this.partnerView('unbilled')];
      default: return null;
    }
  }

  /** Open offertes (Overzicht and Verkoop): every year's open regular quotes, the pipeline's margin in the summary. */
  private openQuotesDrill(): DrillView {
    const missing = this.pipelineMissingCostLines(), pct = this.pipelineMarginPct();
    const summary = missing ? `marge onbekend: ${plural(missing, 'regel', 'regels')} zonder kost`
      : `marge ${this.whole(this.pipelineMargin())}${pct === null ? '' : ` · ${pct.toLocaleString('nl-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} % op goederen`}`;
    const ids = new Set(this.openSales().map((row) => row.order.id));
    return openQuotesView(this.allDocs().filter((doc) => ids.has(doc.id)), this.pipelineValue(), summary);
  }

  /** Verkoop's tiles. */
  openTile(key: KpiTile['key']): void {
    const m = this.salesMetrics(), ctx = this.drillContext(), docs = this.salesDocs(), to = this.salesToDate() || null;
    switch (key) {
      case 'revenue': this.drillHost.open(revenueViews(docs, this.ticaMonths(), m.revenueExclEur, ctx, to)); break;
      case 'margin': this.drillHost.open(marginViews(docs, this.ticaMonths(), missingCostRows(this.salesOrders(), { from: this.salesFromDate() || null, to }),
        { marginEur: m.marginEur, marginPct: m.marginPct, missingCostLines: m.missingCostLines }, ctx, to, this.ticaLines())); break;
      case 'invoiced': this.drillHost.open([invoicedView(docs, m.invoices.issuedValueEur, m.invoices.averageClaimEur, ctx, this.whole)]); break;
      case 'openQuotes': this.drillHost.open([this.openQuotesDrill()]); break;
      case 'accepted': this.drillHost.open([acceptedView(docs, m.accepted.calculatedValueEur, ctx)]); break;
      case 'openInvoices': this.drillHost.open([openInvoicesView(this.allDocs(), this.allSales().invoices.outstandingValueEur)]); break;
      case 'overdue': this.drillHost.open([overdueView(this.allDocs(), this.allSales().invoices.overdueValueEur)]); break;
      case 'received': break;
    }
  }

  /** A funnel bar or foot item; Geaccepteerd is the accepted quotes with their invoice. */
  openFunnel(step: FunnelStep | 'accepted'): void {
    const m = this.salesMetrics();
    if (step === 'accepted') { this.drillHost.open([acceptedView(this.salesDocs(), m.accepted.calculatedValueEur, this.drillContext())]); return; }
    this.drillHost.open([funnelView(step, this.salesDocs(), m.funnel[step], this.drillContext())]);
  }

  openChannel(code: string, figure: number): void {
    this.drillHost.open([channelView(code, this.salesDocs(), figure, this.drillContext())]);
  }

  openCountry(code: string | null, figure: number): void {
    this.drillHost.open([countryView(code, this.countryLabel(code), this.salesDocs(), figure, this.drillContext())]);
  }

  openCustomer(customerId: number | null, name: string, figure: number): void {
    this.drillHost.open([customerView(customerId, this.failed('klanten') ? '—' : name, this.salesDocs(), figure, this.drillContext(), this.whole)]);
  }

  openProduct(product: SalesProductMetric): void {
    const lines = salesLineRows(this.salesOrders(), product.productId, { from: this.salesFromDate() || null, to: this.salesToDate() || null });
    this.drillHost.open([productView(product.productId, this.productName(product.productId, product.name), lines, this.salesDocs(),
      product.calculatedGoodsValueEur, this.drillContext(), (id, count) => this.unitWords(id, count))]);
  }

  /** TICA › Niet herkend: the articles without an ERP product, from the card's own lines. */
  openTicaUnmatched(): void {
    const card = this.ticaCard().data, range = this.ticaLines();
    if (!card || !range) return;
    this.drillHost.open([ticaUnmatchedView(card.products, card.unmatchedLines, range, rangeLabel(range.from, range.to))]);
  }

  /* ---------- Resultaat (§B.4): Omzet and Marge open Verkoop's lists with Resultaat's figures (the same rules) */

  openResultTile(key: ResultTileKey): void {
    const r = this.result(), ctx = this.drillContext(), docs = this.salesDocs(), from = this.salesFromDate() || null, to = this.salesToDate() || null;
    switch (key) {
      case 'revenue': this.drillHost.open(revenueViews(docs, this.ticaMonths(), r.revenueEur, ctx, to)); break;
      case 'margin': this.drillHost.open(marginViews(docs, this.ticaMonths(), missingCostRows(this.salesOrders(), { from, to }),
        { marginEur: r.marginEur, marginPct: r.marginPct, missingCostLines: r.missingCostLines }, ctx, to,
        ticaLineRange(this.salesFromDate(), this.salesToDate(), this.ticaDays(), this.today()))); break;
      case 'costs': this.drillHost.open([costsView(this.costRows(), r.byCategory.map((row) => row.category), r.costsEur, this.resultContext())]); break;
      case 'received': this.drillHost.open([receivedView(receivedContainerRows(this.purchases(), { from, to }), r.purchasedEur, this.resultContext(),
        { container: (row) => this.containerOf(row.id, row.number, row.alias), supplier: (id) => this.supplierName(id), amount: this.whole })]); break;
      case 'result': break;
    }
  }

  /** Kosten per categorie: one category's cost parts. */
  openCategory(code: string, figure: number): void {
    this.drillHost.open([categoryView(code, this.costRows(), figure, this.resultContext())]);
  }

  /** A month of the bars or of Per maand: its documents, TICA and costs, the costs clipped to the period. */
  openMonth(month: string): void {
    const r = this.result(), row = r.monthly.find((candidate) => candidate.month === month);
    if (!row) return;
    const [year, index] = month.split('-').map(Number);
    const first = `${month}-01`, last = `${month}-${String(new Date(Date.UTC(year, index, 0)).getUTCDate()).padStart(2, '0')}`;
    const from = this.salesFromDate(), to = this.salesToDate();
    const costs = resultCostRows(this.costs(), { from: from && from > first ? from : first, to: to && to < last ? to : last, costCharge: this.costCharge, openEur: openOf });
    this.drillHost.open([monthView(month, monthLabel(month), this.salesDocs(), this.ticaMonths(), costs, { resultEur: row.resultEur, complete: !r.missingCostLines },
      this.resultContext())]);
  }

  /** Per verkoopkanaal: a channel's documents, TICA and costs; null = Algemene kosten (costs on no channel). */
  openResultChannel(code: string | null): void {
    const r = this.result();
    if (code === null) { this.drillHost.open([generalCostsView(this.costRows(), r.generalCostsEur, this.resultContext())]); return; }
    const row = r.byChannel.find((candidate) => candidate.channel === code);
    if (!row) return;
    this.drillHost.open([resultChannelView(code, this.salesDocs(), this.ticaMonths(), this.costRows(),
      { resultEur: row.resultEur, complete: !row.missingCostLines && !row.ticaMissingCostLines }, this.resultContext())]);
  }

  /* ---------- Voorraad (§B.5) */

  openStockTile(key: StockTileKey): void {
    const im = this.inventoryMetrics(), unit = (id: number, count: number) => this.unitWords(id, count);
    switch (key) {
      case 'cost': case 'sales':
        this.drillHost.open([stockValueView(im.capital, im.gapRows.unvalued,
          { costValueEur: im.stock.costValueEur, salesValueEur: im.stock.salesValueEur, upliftEur: im.stock.potentialUpliftEur }, key, unit, this.whole)]); break;
      case 'incoming':
        this.drillHost.open([incomingView(this.incomingOrders(), this.incomingValue(), { container: (view) => containerName(view.order),
          supplier: (id) => this.supplierName(id), cost: purchaseExternalCost }, `${this.orderedCount()} besteld · ${this.sailingCount()} vertrokken`)]); break;
      case 'reorder': {
        const supplierOf = (id: number | null) => { const supplier = this.suppliers().find((row) => row.id === id); return supplier ? { name: supplier.name, leadTimeDays: supplier.leadTimeDays } : null; };
        this.drillHost.open([reorderView(im.reorder.rows, im.reorder.count, this.today(), supplierOf, unit, im.velocity.days)]); break;
      }
    }
  }

  /** Datakwaliteit: the four counts as segments, on the one clicked. */
  openQuality(index: number): void {
    const im = this.inventoryMetrics(), gaps = im.dataGaps;
    this.drillHost.open(qualityViews(im.gapRows, { unknown: gaps.unknownStockSkuCount, unvalued: gaps.unvaluedStockSkuCount, missingCarton: gaps.missingCartonSkuCount,
      negative: gaps.negativeStockSkuCount }, (id, count) => this.unitWords(id, count)), Math.max(0, Math.min(index, QUALITY_KEYS.length - 1)));
  }

  /* ---------- Inkoop › Kwaliteit, Partners, Afwijkingen (§B.6) */

  openReceipts(by: ReceiptFigure): void {
    this.drillHost.open([receiptsView(by, this.receivedOrderRows(), this.supplierPerformance(), { averageDays: this.leadDays(), agreedDays: this.agreedLeadDays() },
      this.receiptScope())]);
  }

  /** Scorekaart: a supplier's received orders (D-V1: the supplier list opens from its foot). */
  openSupplier(card: SupplierScorecard): void {
    this.drillHost.open([supplierView(card, this.receivedOrderRows(), this.receiptScope(), this.whole)]);
  }

  openPartnerTile(key: PartnerTileKey): void {
    if (key === 'unbilled' || key === 'open' || key === 'settle') this.drillHost.open([this.partnerView(key)]);
  }

  private partnerView(key: 'unbilled' | 'open' | 'settle'): DrillView {
    const f = this.financing(), name = (row: PartnerFinancingRow) => this.partnerName(row);
    if (key === 'unbilled') return partnersUnbilledView(f.unbilledAdvances, f.unbilledAdvanceEur, name);
    if (key === 'open') return partnersOpenView(f.rows, f.openEur, name);
    const received = new Map(this.purchases().map((row) => [row.order.id, row.order.receivedOn ?? null]));
    return partnersAwaitingView(f.rows, received, f.awaitingSettlement, name);
  }

  /** Afwijkingen › Inkoopimpact: per product and per supplier, in the report's selection (the order focus included). */
  openImpact(): void {
    const report = this.report(), focus = this.focusedOrderId() === null ? '' : ` · alleen ${this.focusName()}`;
    this.drillHost.open(impactViews(report.rows, report.totals, `${this.receiptScope()}${focus}`, (row) => this.productLabel(row)));
  }

  /** Producten names come from the catalogue (D-S10); the invoice line's text when the product is gone. */
  productName(productId: number, fallback: string): string {
    const product = this.products().find((candidate) => candidate.id === productId);
    return product ? product.colour ? `${product.name} · ${product.colour}` : product.name : fallback;
  }

  /** Opvolgen's value says what it is (D-S8): what is open on an invoice, a quote's total, a credit note's tegoed. */
  followMeta(docType: 'OFFERTE' | 'FACTUUR' | 'CREDITNOTA'): string {
    return docType === 'FACTUUR' ? 'open incl. btw' : docType === 'OFFERTE' ? 'offerte excl. btw' : 'tegoed incl. btw';
  }

  /** "2,0 % van € 3.400 bruto". */
  discountShare(discountEur: number, grossEur: number): string {
    if (grossEur <= 0) return `op ${this.whole(grossEur)} bruto`;
    return `${(discountEur / grossEur * 100).toLocaleString('nl-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} % van ${this.whole(grossEur)} bruto`;
  }

  /** The TICA card's own start when its lines cover less of the period than the TICA channel row (D-S11); else null. */
  readonly ticaFrom = computed(() => {
    const range = this.ticaLines(), from = this.salesFromDate();
    if (!range) return null;
    return this.ticaDays().some((day) => day.date < range.from && (!from || day.date >= from) && (day.transactionCount > 0 || day.revenueExcl !== 0)) ? range.from : null;
  });

  /** Kosten & bank › Kosten of the period (Resultaat's "Alle kosten"); "Alle jaren" opens every period there. */
  readonly costsQuery = computed<Record<string, string | null>>(() => ({ view: 'costs', tab: 'company', from: this.salesFromDate() || null, to: this.salesToDate() || null,
    period: this.salesFromDate() || this.salesToDate() ? null : 'all' }));

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

  /**
   * ⌥1…⌥8 on the desk open the tabs in sidebar order (design §2.5): never while typing, behind a sheet, menu or
   * one of the page's popovers (Periode, Hoe gerekend, Buffer), or with the focus outside the page. Like the
   * chips, the switch replaces the address.
   */
  deskKey(event: KeyboardEvent): void {
    if (this.drillHost.views()) return;
    if (!this.desk.active() || event.defaultPrevented) return;
    const tab = analysesTabForKey(event);
    if (!tab) return;
    const context = keyContext(event, this.host.nativeElement);
    if (context.typing || context.overlayOpen || !context.inScope || this.host.nativeElement.querySelector('.wk-popover')) return;
    event.preventDefault();
    if (tab !== this.section()) void this.router.navigate(['/analyses', tab], { replaceUrl: true });
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

  async loadTicaCard(range: { from: string; to: string }): Promise<void> {
    const key = `${range.from}|${range.to}`;
    this.ticaCard.set({ key, state: 'loading', data: null });
    try {
      const page = await this.tica.allSales(range.from, range.to, 5000);
      if (this.ticaCard().key === key) this.ticaCard.set({ key, state: 'ready', data: ticaBreakdown(page, page.lines, page.complete) });
    } catch {
      if (this.ticaCard().key === key) this.ticaCard.set({ key, state: 'failed', data: null });
    }
  }
  /** TICA verkopen for the same period ('Alle' and periods past 366 days open at the card's own range). */
  ticaQuery(): Record<string, string> {
    const range = this.ticaLines();
    return range ? { from: range.from, to: range.to } : {};
  }
  /** A purchase order by its container name (containerName()), from the loaded orders or the report row. */
  containerOf(orderId: number, number: string, alias: string | null): string {
    const view = this.purchases().find((row) => row.order.id === orderId);
    return containerName(view ? view.order : { id: orderId, number, alias });
  }
  legacyTab(section: AnalysisSection): boolean { return LEGACY_BODIES.has(section); }

  openBell(): void { this.bell()?.open(); }

  /** Markt's one writing action, from the phone's ⋯ sheet. */
  addRate(): void {
    this.sheet.set(null);
    this.market()?.openAdd();
  }

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
    /* The variance ticket: a filter change while this load runs starts a newer loadVariances(), whose report wins. */
    const round = ++this.varianceRound;
    this.receiptError.set('');
    try {
      const filters = this.filters();
      this.loadedFilterKey = JSON.stringify(filters);
      const overviewFilters = this.overviewFilters();
      const sameFilters = this.sameFilters(filters, overviewFilters);
      const [report, purchases, suppliers, products, sales, customers, expectedStock, costs, incoming, partners, overview, unfocused, levels, tica] = await Promise.allSettled([
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
        filters.orderId === null ? Promise.resolve(null) : this.sourcing.receiptVariances({ ...filters, orderId: null }),
        this.catalog.stockLevels(),
        this.tica.analytics(),
      ] as const);
      const warnings: string[] = [];
      if (round === this.varianceRound) {
        if (report.status === 'fulfilled') this.acceptReport(report.value);
        else this.receiptError.set(messageOf(report.reason, VARIANCE_FAILED));
        if (unfocused.status === 'fulfilled' && unfocused.value) this.unfocusedReport.set(unfocused.value);
        this.filtering.set(false);
      }
      /* Overzicht reuses Afwijkingen' report while its filter is the default (this year, everything); that filter never changes, so an older round still fits it. */
      const overviewReport = sameFilters ? report : overview;
      if (overviewReport.status === 'fulfilled' && overviewReport.value) this.overviewReport.set(overviewReport.value);
      if (purchases.status === 'fulfilled') this.purchases.set(purchases.value); else warnings.push('inkoop');
      if (suppliers.status === 'fulfilled') this.suppliers.set(suppliers.value); else warnings.push('leveranciers');
      if (products.status === 'fulfilled') this.products.set(products.value); else warnings.push('voorraad');
      if (sales.status === 'fulfilled') this.salesOrders.set(sales.value); else warnings.push('verkoop');
      if (tica.status === 'fulfilled') this.ticaDays.set(tica.value); else warnings.push('TICA verkopen');
      if (customers.status === 'fulfilled') this.customers.set(customers.value); else warnings.push('klanten');
      if (expectedStock.status === 'fulfilled') this.expectedStock.set(expectedStock.value); else warnings.push('verwachte voorraad');
      if (costs.status === 'fulfilled') this.costs.set(costs.value); else warnings.push('kosten');
      if (incoming.status === 'fulfilled') this.incomingPayments.set(incoming.value); else warnings.push('inkomende betalingen');
      if (partners.status === 'fulfilled') this.partnerSummaries.set(partners.value); else warnings.push('partnerfinanciering');
      if (levels.status === 'fulfilled' && Array.isArray(levels.value)) this.stockLevels.set(levels.value);
      else { this.stockLevels.set(null); warnings.push('voorraadlocaties'); }
      this.dataWarnings.set(warnings);
      this.loadFailed.set([report, purchases, suppliers, products, sales, customers, expectedStock, costs, incoming, partners, levels].every((call) => call.status === 'rejected'));
      const now = new Date();
      this.loadedAt.set(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
    } finally {
      this.data.set('ready');
      /* Vernieuwen: a TICA card already on screen loads its lines again (a first load starts it from the effect). */
      const range = this.ticaLines();
      if (range && this.ticaCard().key === `${range.from}|${range.to}`) void this.loadTicaCard(range);
    }
  }

  async loadVariances(): Promise<void> {
    const round = ++this.varianceRound;
    this.filtering.set(true);
    this.receiptError.set('');
    const filters = this.filters();
    this.loadedFilterKey = JSON.stringify(filters);
    try {
      const [report, unfocused] = await Promise.allSettled([this.sourcing.receiptVariances(filters),
        filters.orderId === null ? Promise.resolve(null) : this.sourcing.receiptVariances({ ...filters, orderId: null })]);
      if (round !== this.varianceRound) return;
      if (report.status === 'fulfilled') {
        this.acceptReport(report.value);
        if (this.sameFilters(filters, this.overviewFilters())) this.overviewReport.set(report.value);
      } else this.receiptError.set(messageOf(report.reason, VARIANCE_FAILED));
      if (unfocused.status === 'fulfilled' && unfocused.value) this.unfocusedReport.set(unfocused.value);
    } finally {
      if (round === this.varianceRound) this.filtering.set(false);
    }
  }

  setPart(part: InkoopPart): void {
    this.part.set(part);
    this.writeParams(partParams(part, this.focusedOrderId() !== null));
  }

  setReceiptPeriod(choice: PeriodChoice): void {
    this.receiptPeriod.set(choice);
    this.writeParams(this.receiptParams());
  }

  setSupplier(value: string | number | null): void {
    const parsed = Number(value);
    this.receiptSupplier.set(value === '' || value === null || !Number.isSafeInteger(parsed) || parsed <= 0 ? null : parsed);
    this.writeParams({ leverancier: this.receiptSupplier() === null ? null : String(this.receiptSupplier()) });
  }

  /** "Alleen … ✕": the focus goes, and with it ?orderId; the receipt period is the link's own or the default (N8). */
  clearOrderFocus(): void {
    this.focusedOrderId.set(null);
    const params = this.route.snapshot.queryParamMap;
    this.receiptPeriod.set(parsePeriod((key) => params.get(key), RECEIPT_PERIOD_KEYS, DEFAULT_PERIOD));
    this.writeParams({ orderId: null, ...partParams(this.part()), ...this.receiptParams() });
  }

  private receiptParams(): Record<string, string | null> {
    const params = periodParams(this.receiptPeriod(), RECEIPT_PERIOD_KEYS);
    /* With an order focus the default is "Alle jaren", so "Dit jaar" must be written out. */
    const period = this.receiptPeriod();
    if (this.focusedOrderId() !== null && 'preset' in period && period.preset === 'jaar') params[RECEIPT_PERIOD_KEYS.preset] = 'jaar';
    return params;
  }

  private inkoopParams(): Record<string, string | null> {
    return { ...partParams(this.part(), this.focusedOrderId() !== null), ...this.receiptParams(), leverancier: this.receiptSupplier() === null ? null : String(this.receiptSupplier()),
      orderId: this.focusedOrderId() === null ? null : String(this.focusedOrderId()) };
  }

  private partsWith(labels: Record<InkoopPart, string>, desk: boolean): SegmentOption[] {
    const financing = this.financing();
    const warn = financing.awaitingSettlement > 0 || financing.overdueUnbilledAdvanceEur > 0;
    /* Every order with variances in the receipt filter, never only the focused one (?orderId). */
    const affected = this.qualityReport().totals.affectedOrders;
    return (['kosten', 'kwaliteit', 'partners', 'afwijkingen'] as const).map((id) => ({
      id, label: labels[id],
      dot: id === 'partners' && warn ? (financing.overdueUnbilledAdvanceEur > 0 ? 'danger' : 'warn') : null,
      count: desk && id === 'afwijkingen' && affected > 0 ? affected : null,
    }));
  }

  /** "23 sep", with the year when it is not this year. */
  dayText(day: string | null | undefined): string { return day ? dayMonth(day, this.today().slice(0, 4)) : '—'; }

  partnerName(row: PartnerFinancingRow): string { return containerName({ id: row.purchaseOrderId, number: row.number, alias: row.alias }); }

  partnerState(row: PartnerFinancingRow): string {
    return row.settled ? 'volledig afgerekend' : row.remainingQuantity > 0 ? `${new Intl.NumberFormat('nl-BE').format(row.remainingQuantity)} st resteren` : 'afrekening nog uitgeven';
  }

  documentKind(doc: PartnerFinancingRow['documents'][number]): string {
    if (doc.docType === 'CREDITNOTA') return doc.status === 'CONCEPT' ? 'creditnota · concept' : 'creditnota';
    if (doc.status === 'CONCEPT') return 'concept';
    return doc.docType === 'OFFERTE' ? 'offerte' : doc.settlement ? 'afrekening' : 'voorschot';
  }

  /** The catalogue's name and colour for a variance line; the line's own text when the product is gone (design §5.19). */
  productLabel(row: ReceiptVarianceRow): string {
    const product = this.products().find((candidate) => candidate.id === row.productId);
    if (!product) return row.productName;
    return product.colour ? `${product.name} · ${product.colour}` : product.name;
  }

  /** "€ 1,26": a stored value per piece (up to four decimals). */
  unitValue(value: number): string {
    return `€ ${value.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
  }

  /** Critique B3: the stored value counts in the impact; empty means unknown, never the cost price. */
  valueHint(row: ReceiptVarianceRow): string {
    if (row.lineId === null) return 'Historische regel zonder regelnummer';
    if (row.receiptUnitValueEur === null) return 'Nog geen waarde: vul de waarde per stuk in.';
    return `Telt mee in de impact: ${new Intl.NumberFormat('nl-BE').format(row.missingPieces + row.damagedPieces)} st × ${this.unitValue(row.receiptUnitValueEur)}.`;
  }

  /** Bewaren only for a valid, changed, non-empty value (no "Wissen": empty means unknown). */
  canSaveValue(row: ReceiptVarianceRow): boolean {
    if (row.lineId === null || this.savingValue() === this.valueKey(row)) return false;
    const value = parseValue(this.draftValue(row));
    return value !== null && Number.isFinite(value) && value >= 0 && value !== row.receiptUnitValueEur;
  }

  openValueSheet(row: ReceiptVarianceRow): void {
    this.valueSheetKey.set(this.valueKey(row));
    this.sheet.set('value');
  }

  supplierName(id: number): string {
    return this.suppliers().find((supplier) => supplier.id === id)?.name ?? `Leverancier ${id}`;
  }

  countryLabel(code: string | null): string {
    if (!code) return 'Land onbekend';
    try { return this.regionNames.of(code) ?? code; } catch { return code; }
  }

  /** Raakt binnenkort op: how long the shelf lasts on its own (D-V6: what is on the water is in the sub). */
  weeksLabel(weeks: number | null): string {
    if (weeks === null) return 'Geen verkoop';
    if (weeks <= 0) return 'nu op';
    if (weeks < 1) return 'op binnen een week';
    return `op in ${plural(Math.round(weeks), 'week', 'weken')}`;
  }

  valueKey(row: ReceiptVarianceRow): string { return `${row.orderId}:${row.lineId ?? 'legacy'}`; }
  valueInputId(row: ReceiptVarianceRow): string { return `receipt-value-${row.orderId}-${row.lineId ?? row.productId}`; }
  draftValue(row: ReceiptVarianceRow): string {
    return this.valueDrafts()[this.valueKey(row)] ?? formatValue(row.receiptUnitValueEur);
  }

  setDraftValue(row: ReceiptVarianceRow, value: string | number | null): void {
    this.valueDrafts.update((drafts) => ({ ...drafts, [this.valueKey(row)]: value == null ? '' : String(value) }));
  }

  async saveValue(row: ReceiptVarianceRow): Promise<void> {
    if (row.lineId === null) return;
    if (!this.canSaveValue(row)) return;
    const value = parseValue(this.draftValue(row));
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      this.ui.toast('Vul een geldige waarde per stuk in', 'err');
      return;
    }
    const key = this.valueKey(row);
    this.savingValue.set(key);
    try {
      await this.sourcing.setReceiptLineValue(row.orderId, row.lineId, value);
      this.ui.toast('Ontvangstwaarde bewaard', 'ok');
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
      from: this.receiptRange().from || null,
      to: this.receiptRange().to || null,
      supplierId: this.receiptSupplier(),
      orderId: this.focusedOrderId(),
    };
  }

  private acceptReport(report: ReceiptVarianceReport): void {
    this.report.set(report);
    this.valueDrafts.set(Object.fromEntries(report.rows.map((row) => [this.valueKey(row), formatValue(row.receiptUnitValueEur)])));
  }
}

/** "92,3 %": a percentage as the tiles write it. */
function pctText(value: number, decimals: number): string {
  return `${value.toLocaleString('nl-BE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} %`;
}

/** A stored value per piece as the field shows it: "1,26" (no grouping, up to four decimals). */
function formatValue(value: number | null): string {
  return value === null ? '' : value.toLocaleString('nl-BE', { useGrouping: false, maximumFractionDigits: 4 });
}

/** The field's text as a number; a comma is accepted. Empty is null. */
function parseValue(text: string): number | null {
  const raw = text.trim().replace(/\s/g, '').replace(',', '.');
  return raw === '' ? null : Number(raw);
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
