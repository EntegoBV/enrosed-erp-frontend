import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
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
  Supplier,
} from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { PageHeader } from '../../shared/page-header';
import { DateField } from '../../shared/date-field';
import { DateNlPipe, EurPipe, NumPipe, PctPipe } from '../../shared/pipes';
import { Ui } from '../../shared/ui';
import { inventoryAnalysis, salesAnalysis } from './analysis-metrics';
import { MarketAnalysis } from './market-analysis';
import { WebsiteAnalytics } from './website-analytics';
import { inDateRange, supplierReceiptPerformance } from './receipt-metrics';

type AnalysisSection = 'overview' | 'sales' | 'inventory' | 'purchasing' | 'market' | 'website';

const ANALYSIS_TABS: ReadonlyArray<{ id: AnalysisSection; label: string }> = [
  { id: 'overview', label: 'Overzicht' },
  { id: 'sales', label: 'Verkoop' },
  { id: 'inventory', label: 'Voorraad' },
  { id: 'purchasing', label: 'Inkoop' },
  { id: 'market', label: 'Markt & container' },
  { id: 'website', label: 'Website' },
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
const TODAY = localIsoDay();
const CURRENT_YEAR_START = `${TODAY.slice(0, 4)}-01-01`;

/** Company-wide analysis with durable receipt losses as its operational drill-down. */
@Component({
  selector: 'app-analyses-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    RouterLink,
    PageHeader,
    DateField,
    DateNlPipe,
    EurPipe,
    NumPipe,
    PctPipe,
    MarketAnalysis, WebsiteAnalytics,
  ],
  template: `
    <app-page-header title="Analyses" [subtitle]="sectionSubtitle()">
      @if (section() !== 'market') {
        <button class="btn btn--sm" type="button" [disabled]="loading() || refreshing()"
                (click)="refresh()">{{ refreshing() ? 'Vernieuwen…' : 'Vernieuwen' }}</button>
      }
    </app-page-header>

    <main class="content analyses-page" [attr.aria-busy]="loading() || filtering()">
      <nav class="analysis-tabs" aria-label="Analyseonderdelen">
        @for (tab of analysisTabs; track tab.id) {
          <a [routerLink]="['/analyses', tab.id]" [class.active]="section() === tab.id"
             [attr.aria-current]="section() === tab.id ? 'page' : null">{{ tab.label }}</a>
        }
      </nav>

      @if (section() === 'overview') {
      <section class="analysis-section" aria-labelledby="company-picture-title">
        <header class="section-copy">
          <span class="eyebrow">Bedrijfsfoto</span>
          <h2 id="company-picture-title">Waarde die vandaag beweegt</h2>
          <p>Dezelfde actuele bronnen als het dashboard, met ontvangstkwaliteit erbij.</p>
        </header>

        @if (loading()) {
          <div class="analysis-kpis" aria-label="Analyses laden">
            @for (card of [1, 2, 3, 4]; track card) {
              <div class="card metric-card metric-card--loading"><span></span><b></b><i></i></div>
            }
          </div>
        } @else {
          @if (dataWarnings().length) {
            <div class="analysis-warning" role="status">
              Niet alle actuele cijfers konden laden: {{ dataWarnings().join(', ') }}.
            </div>
          }
          <div class="analysis-kpis">
            <article class="card metric-card metric-card--quality">
              <span class="metric-card__label">Perfect ontvangen</span>
              <strong>{{ supplierPerformance().perfectPct === null ? '—' : (supplierPerformance().perfectPct | pct: 1) }}</strong>
              <p>{{ supplierPerformance().perfectOrders }} van {{ supplierPerformance().comparableOrders }} vergelijkbare orders
                @if (supplierPerformance().unknownOrders) { · {{ supplierPerformance().unknownOrders }} zonder bestelsnapshot }</p>
              <div class="metric-card__sub">
                <span>Op tijd</span>
                <b>{{ supplierPerformance().onTimePct === null ? '—' : (supplierPerformance().onTimePct | pct: 0) }}</b>
                <small>{{ supplierPerformance().onTimeOrders }} van {{ supplierPerformance().datedOrders }} ontvangsten · tegen laatst opgeslagen ETA</small>
              </div>
            </article>

            <article class="card metric-card">
              <span class="metric-card__label">Inkoop onderweg</span>
              <strong>{{ incomingValue() | eur: 0 }}</strong>
              <p>{{ incomingPieces() | num }} stuks in {{ incomingOrders().length }} container(s)</p>
              <div class="metric-card__sub">
                <span>Onderweg</span><b>{{ sailingCount() }}</b>
                <small>{{ orderedCount() }} besteld · {{ sailingCount() }} vertrokken</small>
              </div>
            </article>

            <article class="card metric-card">
              <span class="metric-card__label">Voorraadwaarde</span>
              <strong>{{ inventoryPurchaseValue() | eur: 0 }}</strong>
              <p>Kostwaarde van {{ inventoryValuedPieces() | num }} bekende stuks
                @if (inventoryUnvaluedPieces()) { · {{ inventoryUnvaluedPieces() | num }} bekende stuks zonder kost }
                @if (inventoryUnknownSkuCount()) { · {{ inventoryUnknownSkuCount() }} SKU's zonder betrouwbare voorraadstand }</p>
              <div class="metric-card__sub">
                <span>Verkoopwaarde</span><b>{{ inventorySalesValue() | eur: 0 }}</b>
                <small>{{ inventoryUplift() === null ? 'Kostdekking onvolledig' : (inventoryUplift() | eur: 0) + ' potentieel verschil' }}</small>
              </div>
            </article>

            <article class="card metric-card metric-card--dark">
              <span class="metric-card__label">Verkooppijplijn</span>
              <strong>{{ pipelineValue() | eur: 0 }}</strong>
              <p>{{ openSales().length }} open offerte(s)
                @if (pipelineMissingCostLines()) { · {{ pipelineMissingCostLines() }} productregel(s) zonder kost }</p>
              <div class="metric-card__sub">
                <span>Brutomarge</span><b>{{ pipelineMissingCostLines() ? '—' : (pipelineMargin() | eur: 0) }}</b>
                <small>{{ pipelineMissingCostLines()
                  ? 'Onvolledig: niet alle productregels hebben een kost'
                  : pipelineMarginPct() === null ? 'Marge onbekend zonder goederenwaarde' : (pipelineMarginPct() | pct: 1) + ' op goederen' }}</small>
              </div>
            </article>
          </div>
        }
      </section>

      <section class="analysis-section overview-actions" aria-labelledby="attention-title">
        <header class="section-copy">
          <span class="eyebrow">Aandacht</span>
          <h2 id="attention-title">Waar nu opvolging nodig is</h2>
          <p>Direct door naar het onderdeel waar je het kunt beoordelen.</p>
        </header>
        <div class="attention-grid">
          <a class="card attention-card" routerLink="/analyses/sales">
            <span>Open verkoop</span>
            <strong>{{ salesMetrics().pipeline.count }} offerte(s)</strong>
            <small>{{ salesMetrics().invoices.overdue }} vervallen factuur/facturen · {{ salesMetrics().invoices.overdueValueEur | eur: 0 }}</small>
          </a>
          <a class="card attention-card" routerLink="/analyses/inventory">
            <span>Voorraad</span>
            <strong>{{ inventoryMetrics().zeroStock.withoutIncomingCount }} zonder voorraad én inkoop</strong>
            <small>{{ inventoryMetrics().dataGaps.unknownStockSkuCount }} SKU's zonder betrouwbare voorraadstand</small>
          </a>
          <a class="card attention-card" routerLink="/analyses/purchasing">
            <span>Inkoop</span>
            <strong>{{ report().totals.affectedOrders }} order(s) met afwijkingen</strong>
            <small>{{ report().totals.totalLossValueEur | eur: 0 }} bekende impact</small>
          </a>
          <a class="card attention-card" routerLink="/analyses/market">
            <span>Markt &amp; container</span>
            <strong>Koersen en vracht</strong>
            <small>Compacte actuele referenties en eigen offertes</small>
          </a>
        </div>
      </section>
      }

      @if (section() === 'sales') {
      <section class="analysis-section" aria-labelledby="sales-analysis-title">
        <header class="section-copy section-copy--split">
          <div>
            <span class="eyebrow">Verkoopanalyse</span>
            <h2 id="sales-analysis-title">Van offerte tot betaling</h2>
            <p>De periode volgt de aanmaakdatum van de verkoopdocumenten.</p>
          </div>
          <button class="btn btn--sm" type="button" (click)="showSalesAllTime()">Alle jaren</button>
        </header>

        <div class="card period-filter">
          <label><span>Van</span><app-date-field fieldId="sales-analysis-from" [value]="salesFromDate()"
            (valueChange)="salesFromDate.set($event)" /></label>
          <label><span>Tot en met</span><app-date-field fieldId="sales-analysis-to" [value]="salesToDate()"
            (valueChange)="salesToDate.set($event)" /></label>
          <p>Bedragen zijn volgens de huidige orderberekening; oude documenten hebben nog geen bevroren historische prijs.</p>
        </div>

        <div class="analysis-kpis analysis-kpis--sales">
          <article class="card metric-card metric-card--dark">
            <span class="metric-card__label">Open pijplijn</span>
            <strong>{{ salesMetrics().pipeline.calculatedValueEur | eur: 0 }}</strong>
            <p>{{ salesMetrics().pipeline.count }} offerte(s) · {{ salesMetrics().pipeline.pieces | num }} stuks</p>
          </article>
          <article class="card metric-card metric-card--quality">
            <span class="metric-card__label">Geaccepteerd</span>
            <strong>{{ salesMetrics().accepted.calculatedValueEur | eur: 0 }}</strong>
            <p>{{ salesMetrics().accepted.count }} offerte(s) in deze periode</p>
          </article>
          <article class="card metric-card">
            <span class="metric-card__label">Open facturen</span>
            <strong>{{ salesMetrics().invoices.outstandingValueEur | eur: 0 }}</strong>
            <p>{{ salesMetrics().invoices.outstanding }} factuur/facturen</p>
          </article>
          <article class="card metric-card" [class.metric-card--danger]="salesMetrics().invoices.overdue > 0">
            <span class="metric-card__label">Vervallen</span>
            <strong>{{ salesMetrics().invoices.overdueValueEur | eur: 0 }}</strong>
            <p>{{ salesMetrics().invoices.overdue }} factuur/facturen na vervaldatum</p>
          </article>
        </div>

        <div class="card funnel-card" aria-label="Offertefunnel">
          <div class="funnel-step"><span>Aangemaakt</span><b>{{ salesMetrics().funnel.created }}</b><small>100%</small></div>
          <span class="funnel-arrow" aria-hidden="true">›</span>
          <div class="funnel-step"><span>Verzonden</span><b>{{ salesMetrics().funnel.sent }}</b><small>{{ salesMetrics().funnel.sendRatePct === null ? '—' : (salesMetrics().funnel.sendRatePct | pct: 0) }}</small></div>
          <span class="funnel-arrow" aria-hidden="true">›</span>
          <div class="funnel-step"><span>Bekeken</span><b>{{ salesMetrics().funnel.viewed }}</b><small>{{ salesMetrics().funnel.viewRatePct === null ? '—' : (salesMetrics().funnel.viewRatePct | pct: 0) }}</small></div>
          <span class="funnel-arrow" aria-hidden="true">›</span>
          <div class="funnel-step funnel-step--accent"><span>Geaccepteerd</span><b>{{ salesMetrics().funnel.accepted }}</b><small>{{ salesMetrics().funnel.conversionRatePct === null ? '—' : (salesMetrics().funnel.conversionRatePct | pct: 0) }} van gesloten</small></div>
        </div>

        <div class="analysis-columns">
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
          <p>Een actuele momentopname uit de productkaart en open inkooporders.</p>
        </header>

        <div class="analysis-kpis">
          <article class="card metric-card metric-card--dark">
            <span class="metric-card__label">Kostwaarde voorraad</span>
            <strong>{{ inventoryMetrics().stock.costValueEur | eur: 0 }}</strong>
            <p>{{ inventoryMetrics().stock.valuedPieces | num }} gewaardeerde stuks</p>
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

      @if (section() === 'market') {
        <app-market-analysis />
      }

      @if (section() === 'website') {
        <app-website-analytics />
      }

      @if (section() === 'purchasing') {
      <section class="analysis-section purchase-summary" aria-labelledby="purchase-summary-title">
        <header class="section-copy">
          <span class="eyebrow">Inkoopanalyse</span>
          <h2 id="purchase-summary-title">Onderweg en ontvangen kwaliteit</h2>
          <p>Actuele containerwaarde plus blijvend geregistreerde tekorten en schade.</p>
        </header>
        <div class="analysis-kpis">
          <article class="card metric-card metric-card--dark"><span class="metric-card__label">Inkoop onderweg</span><strong>{{ incomingValue() | eur: 0 }}</strong><p>{{ incomingPieces() | num }} stuks in {{ incomingOrders().length }} order(s)</p></article>
          <article class="card metric-card metric-card--quality"><span class="metric-card__label">Perfect ontvangen</span><strong>{{ supplierPerformance().perfectPct === null ? '—' : (supplierPerformance().perfectPct | pct: 1) }}</strong><p>{{ supplierPerformance().perfectOrders }} van {{ supplierPerformance().comparableOrders }} vergelijkbare orders</p></article>
          <article class="card metric-card"><span class="metric-card__label">Bekende verliesimpact</span><strong>{{ report().totals.totalLossValueEur | eur: 0 }}</strong><p>{{ report().totals.missingPieces + report().totals.damagedPieces | num }} afwijkende stuks</p></article>
          <article class="card metric-card"><span class="metric-card__label">Zonder waarde</span><strong>{{ report().totals.unvaluedLossPieces | num }} st</strong><p>Vul de ontvangstwaarde in om de impact compleet te maken</p></article>
        </div>
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
    </main>
  `,
  styles: `
    :host{display:block}.analyses-page{max-width:1180px;padding-bottom:110px}.analysis-section+.analysis-section{margin-top:34px}
    .analysis-tabs{position:sticky;z-index:5;top:58px;display:flex;gap:5px;margin:-2px -2px 20px;padding:7px 2px;overflow-x:auto;background:color-mix(in srgb,var(--bg) 92%,transparent);backdrop-filter:blur(10px);scrollbar-width:none}.analysis-tabs::-webkit-scrollbar{display:none}.analysis-tabs a{flex:none;padding:8px 11px;border:1px solid var(--line);border-radius:99px;background:var(--surface);color:var(--muted);font-size:11px;font-weight:730;text-decoration:none;white-space:nowrap}.analysis-tabs a:hover{border-color:var(--rose-line);color:var(--ink)}.analysis-tabs a.active{border-color:var(--rose);background:var(--rose-soft);color:var(--rose-dark)}
    .section-copy{margin-bottom:12px;padding:0 2px}.section-copy .eyebrow{display:block;color:var(--rose);font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.section-copy h1,.section-copy h2{margin-top:3px;font-size:21px}.section-copy p{margin-top:4px;color:var(--muted);font-size:12.5px}.section-copy--receipt,.section-copy--split{display:flex;align-items:end;justify-content:space-between;gap:12px}
    .attention-grid{display:grid;gap:9px}.attention-card{display:grid;gap:3px;padding:15px;color:inherit;text-decoration:none;transition:border-color .15s,transform .15s}.attention-card:hover{border-color:var(--rose-line);transform:translateY(-1px)}.attention-card>span{color:var(--rose);font-size:9.5px;font-weight:780;letter-spacing:.06em;text-transform:uppercase}.attention-card>strong{font-size:15px}.attention-card>small{color:var(--muted);font-size:10.5px}
    .period-filter{display:grid;gap:10px;margin-bottom:10px;padding:13px}.period-filter label{display:grid;gap:4px}.period-filter label>span{color:var(--muted);font-size:9.5px;font-weight:760;text-transform:uppercase}.period-filter p{align-self:end;color:var(--muted);font-size:10.5px;line-height:1.35}.metric-card--danger{border-color:var(--danger);background:var(--danger-soft)}.metric-card--danger>strong{color:var(--danger)}
    .funnel-card{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;margin-top:10px;padding:13px}.funnel-step{display:grid;padding:8px;border-radius:10px;background:var(--surface-2)}.funnel-step span{color:var(--muted);font-size:9px;font-weight:750;text-transform:uppercase}.funnel-step b{margin-top:2px;font-size:18px}.funnel-step small{color:var(--muted);font-size:9.5px}.funnel-step--accent{background:var(--ok-soft)}.funnel-step--accent b{color:var(--ok)}.funnel-arrow{display:none;color:var(--muted-2);font-size:22px}
    .analysis-columns{display:grid;gap:10px;margin-top:10px}.analysis-list{overflow:hidden}.analysis-list>header{display:flex;align-items:end;justify-content:space-between;gap:10px;padding:13px 14px;border-bottom:1px solid var(--line);background:var(--surface-2)}.analysis-list>header span{color:var(--rose);font-size:9px;font-weight:780;letter-spacing:.06em;text-transform:uppercase}.analysis-list>header h3{margin-top:2px;font-size:14px}.analysis-list>header>small{color:var(--muted);font-size:9.5px;text-align:right}.rank-row,.stock-row,.attention-row,.capital-row{color:inherit;text-decoration:none}.rank-row{display:grid;grid-template-columns:24px minmax(0,1fr) auto;align-items:center;gap:9px;padding:11px 14px}.rank-row+.rank-row{border-top:1px solid var(--line)}.rank-row:hover,.stock-row:hover,.attention-row:hover,.capital-row:hover{background:var(--surface-2)}.rank-row .rank{display:grid;width:22px;height:22px;place-items:center;border-radius:50%;background:var(--surface-2);color:var(--muted);font-size:9.5px;font-weight:750}.rank-row div,.stock-row div,.attention-row>div,.capital-row div{display:grid;min-width:0}.rank-row b,.stock-row b,.attention-row b,.capital-row b{overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.rank-row small,.stock-row small,.attention-row small,.capital-row small{color:var(--muted);font-size:9.5px}.rank-row>strong,.attention-row>strong,.capital-row>strong{font-size:12px;text-align:right}.list-empty{padding:17px;color:var(--muted);font-size:11px}
    .attention-list{margin-top:10px}.attention-row{display:grid;gap:8px;padding:12px 14px;border-left:3px solid transparent}.attention-row+.attention-row{border-top:1px solid var(--line)}.attention-row--danger{border-left-color:var(--danger)}.reason-chips{display:flex!important;flex-flow:row wrap!important;gap:4px}.reason-chips span{padding:3px 6px;border-radius:99px;background:var(--warn-soft);color:var(--warn);font-size:9px;font-weight:700}.attention-row--danger .reason-chips span{background:var(--danger-soft);color:var(--danger)}
    .data-gap-strip{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px;padding:9px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}.data-gap-strip span{padding:5px 8px;border-radius:8px;background:var(--surface);color:var(--muted);font-size:9.5px}.data-gap-strip b{color:var(--ink)}.stock-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 14px}.stock-row+.stock-row{border-top:1px solid var(--line)}.stock-row>span{max-width:45%;color:var(--warn);font-size:9.5px;font-weight:700;text-align:right}.stock-row>span.ok-text{color:var(--ok)}.capital-list{margin-top:10px}.capital-row{display:grid;grid-template-columns:54px minmax(0,1fr) auto auto;align-items:center;gap:9px;padding:11px 14px}.capital-row+.capital-row{border-top:1px solid var(--line)}.capital-row__bar{height:5px;overflow:hidden;border-radius:99px;background:var(--surface-2)}.capital-row__bar i{display:block;height:100%;border-radius:inherit;background:var(--rose)}.capital-row>small{min-width:42px;text-align:right}.purchase-summary+.receipt-section{margin-top:22px}
    .analysis-kpis{display:grid;gap:10px}.metric-card{position:relative;min-width:0;padding:17px;overflow:hidden}.metric-card__label{display:block;color:var(--muted);font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase}.metric-card>strong{display:block;margin-top:5px;color:var(--ink);font-size:27px;line-height:1}.metric-card>p{margin-top:7px;color:var(--muted);font-size:12px}.metric-card__sub{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:2px 8px;margin-top:14px;padding-top:11px;border-top:1px solid var(--line)}.metric-card__sub span{color:var(--muted);font-size:10px;text-transform:uppercase}.metric-card__sub b{font-size:15px;text-align:right}.metric-card__sub small{grid-column:1/-1;color:var(--muted);font-size:10.5px}.metric-card--quality:before{content:'';position:absolute;inset:0 auto 0 0;width:4px;background:var(--ok)}.metric-card--dark{border-color:#302a27;background:#272220;color:#fff}.metric-card--dark :is(.metric-card__label,.metric-card>p,.metric-card__sub span,.metric-card__sub small){color:#cfc7c2}.metric-card--dark>strong,.metric-card--dark .metric-card__sub b{color:#fff}.metric-card--dark .metric-card__sub{border-color:#49413d}
    .metric-card--loading span,.metric-card--loading b,.metric-card--loading i{display:block;border-radius:99px;background:var(--surface-2);animation:pulse 1.1s ease-in-out infinite}.metric-card--loading span{width:42%;height:10px}.metric-card--loading b{width:65%;height:28px;margin-top:14px}.metric-card--loading i{width:82%;height:9px;margin-top:16px}.analysis-warning,.valuation-note{margin-bottom:10px;padding:10px 12px;border:1px solid #eddcb9;border-radius:12px;background:var(--warn-soft);color:var(--ink-2);font-size:12px}
    .receipt-filters{display:grid;gap:10px;margin-bottom:12px;padding:14px}.receipt-filters label{display:grid;gap:4px;min-width:0}.receipt-filters label>span{color:var(--muted);font-size:10px;font-weight:750;text-transform:uppercase}.receipt-filters__actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}.receipt-filters__actions .btn{min-height:44px}
    .receipt-error{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px}.receipt-error p{margin-top:3px;color:var(--muted);font-size:12px}
    .receipt-totals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:10px}.receipt-total{padding:13px}.receipt-total>span{display:block;color:var(--muted);font-size:9.5px;font-weight:760;text-transform:uppercase}.receipt-total>strong{display:block;margin-top:3px;font-size:20px}.receipt-total>small{display:block;margin-top:3px;color:var(--muted);font-size:10.5px}.receipt-total--loss{border-color:var(--rose-line);background:var(--rose-soft)}.receipt-total--loss strong{color:var(--rose-dark)}.receipt-total--warn{border-color:#eddcb9;background:var(--warn-soft)}
    .variance-list{display:grid;gap:10px}.variance-order{overflow:hidden}.variance-order__head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 14px;border-bottom:1px solid var(--line);background:var(--surface-2)}.variance-order__head>a{display:grid;min-width:0;color:inherit;text-decoration:none}.variance-order__head>a>span{color:var(--rose);font-size:9.5px;font-weight:760;text-transform:uppercase}.variance-order__head>a>strong{overflow:hidden;font-size:14px;text-overflow:ellipsis;white-space:nowrap}.variance-order__head>a>small{color:var(--muted);font-size:10.5px}.variance-order__head>a:hover strong{color:var(--rose-dark);text-decoration:underline}.variance-order__value{display:grid;flex:none;text-align:right}.variance-order__value b{font-size:14px}.variance-order__value small{color:var(--warn);font-size:9.5px}.variance-order__value a{margin-top:5px;color:var(--rose-dark);font-size:11px;font-weight:720;text-decoration:none}.variance-order__value a:hover{text-decoration:underline}
    .variance-lines{display:grid}.variance-line{display:grid;gap:11px;padding:14px}.variance-line+.variance-line{border-top:1px solid var(--line)}.variance-line__product{display:grid;min-width:0}.variance-line__product>strong{overflow:hidden;font-size:13.5px;text-overflow:ellipsis;white-space:nowrap}.variance-line__product>span{color:var(--muted);font-size:10.5px}.variance-line__chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}.variance-line__chips span{padding:3px 7px;border-radius:99px;background:var(--danger-soft);color:var(--danger);font-size:10px;font-weight:700}.variance-line__chips .ok{background:var(--ok-soft);color:var(--ok)}.variance-line__impact{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-radius:10px;background:var(--surface-2)}.variance-line__impact span{color:var(--muted);font-size:10px;text-transform:uppercase}.variance-line__impact b{font-size:13px}.variance-line__valuation{display:grid;gap:4px}.variance-line__valuation>label{color:var(--muted);font-size:10px;font-weight:700;text-transform:uppercase}.variance-line__valuation>small{color:var(--warn);font-size:10px}.value-edit{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center}.value-edit>span{align-self:stretch;display:grid;place-items:center;padding:0 9px;border:1px solid var(--line);border-right:0;border-radius:var(--r-sm) 0 0 var(--r-sm);background:var(--surface-2);color:var(--muted);font-size:12px}.value-edit .input{min-width:0;border-radius:0}.value-edit .btn{min-height:44px;border-radius:0 var(--r-sm) var(--r-sm) 0}.receipt-empty{display:flex;align-items:center;gap:12px;padding:18px}.receipt-empty>span{display:grid;width:38px;height:38px;flex:none;place-items:center;border-radius:50%;background:var(--ok-soft);color:var(--ok);font-weight:800}.receipt-empty p{margin-top:2px;color:var(--muted);font-size:12px}
    @media(min-width:680px){.analysis-tabs{top:0}.analysis-kpis,.attention-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.period-filter{grid-template-columns:190px 190px minmax(0,1fr);align-items:end}.funnel-card{grid-template-columns:repeat(7,auto);justify-content:space-between}.funnel-arrow{display:block}.analysis-columns{grid-template-columns:repeat(2,minmax(0,1fr))}.attention-row{grid-template-columns:minmax(180px,.7fr) minmax(240px,1fr) auto;align-items:center}.receipt-filters{grid-template-columns:repeat(3,minmax(0,1fr)) auto;align-items:end}.receipt-filters__actions{grid-template-columns:auto auto}.receipt-totals{grid-template-columns:repeat(4,minmax(0,1fr))}.variance-line{grid-template-columns:minmax(220px,1fr) 145px minmax(235px,.8fr);align-items:end}.variance-line__impact{display:grid;align-content:center;text-align:right}.variance-line__impact b{margin-top:2px}.analyses-page{padding-bottom:40px}}
    @media(min-width:980px){.analysis-kpis,.attention-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
    @keyframes pulse{50%{opacity:.48}}
  `,
})
export class AnalysesPage {
  private readonly sourcing = inject(SourcingApi);
  private readonly catalog = inject(CatalogApi);
  private readonly sales = inject(SalesApi);
  private readonly route = inject(ActivatedRoute);
  private readonly ui = inject(Ui);

  readonly analysisTabs = ANALYSIS_TABS;
  readonly section = toSignal(this.route.paramMap.pipe(map((params) =>
    analysisSection(params.get('section')))), { initialValue: 'overview' as AnalysisSection });
  readonly sectionSubtitle = computed(() => ({
    overview: 'De belangrijkste signalen op één plek',
    sales: 'Pijplijn, conversie en facturen',
    inventory: 'Kapitaal, dekking en aankomende voorraad',
    purchasing: 'Ontvangstkwaliteit en inkoopimpact',
    market: 'Wisselkoers en compacte containerprijzen',
    website: 'Wie de website bezoekt, vanwaar, wanneer en waar ze naartoe gaan',
  })[this.section()]);

  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly filtering = signal(false);
  readonly receiptError = signal('');
  readonly dataWarnings = signal<string[]>([]);
  readonly report = signal<ReceiptVarianceReport>(EMPTY_REPORT);
  readonly purchases = signal<PurchaseOrderView[]>([]);
  readonly suppliers = signal<Supplier[]>([]);
  readonly products = signal<Product[]>([]);
  readonly salesOrders = signal<SalesOrderView[]>([]);
  readonly customers = signal<Customer[]>([]);
  readonly expectedStock = signal<ExpectedStock[]>([]);

  readonly fromDate = signal(CURRENT_YEAR_START);
  readonly toDate = signal(TODAY);
  readonly salesFromDate = signal(CURRENT_YEAR_START);
  readonly salesToDate = signal(TODAY);
  readonly supplierId = signal<number | null>(null);
  private readonly appliedFromDate = signal(CURRENT_YEAR_START);
  private readonly appliedToDate = signal(TODAY);
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
    .reduce((sum, row) => sum + row.costing.totals.totalEur, 0));
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
    today: TODAY,
    topLimit: 8,
  }));
  readonly inventoryMetrics = computed(() => inventoryAnalysis(
    this.products(), this.expectedStock(), { topLimit: 10 }));

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

  constructor() {
    const orderId = Number(this.route.snapshot.queryParamMap.get('orderId'));
    if (Number.isInteger(orderId) && orderId > 0) {
      this.focusedOrderId.set(orderId);
      this.fromDate.set('');
      this.toDate.set('');
      this.appliedFromDate.set('');
      this.appliedToDate.set('');
    }
    void this.load();
  }

  async refresh(): Promise<void> {
    if (this.loading() || this.refreshing()) return;
    this.refreshing.set(true);
    try { await this.load(); } finally { this.refreshing.set(false); }
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.receiptError.set('');
    try {
      const [report, purchases, suppliers, products, sales, customers, expectedStock] = await Promise.allSettled([
        this.sourcing.receiptVariances(this.filters()),
        this.sourcing.purchaseOrders(),
        this.sourcing.suppliers(),
        this.catalog.products(),
        this.sales.orders(),
        this.sales.customers(),
        this.sourcing.expectedStock(),
      ] as const);
      const warnings: string[] = [];
      if (report.status === 'fulfilled') this.acceptReport(report.value);
      else this.receiptError.set(messageOf(report.reason, 'De ontvangstafwijkingen konden niet worden geladen.'));
      if (purchases.status === 'fulfilled') this.purchases.set(purchases.value); else warnings.push('inkoop');
      if (suppliers.status === 'fulfilled') this.suppliers.set(suppliers.value); else warnings.push('leveranciers');
      if (products.status === 'fulfilled') this.products.set(products.value); else warnings.push('voorraad');
      if (sales.status === 'fulfilled') this.salesOrders.set(sales.value); else warnings.push('verkoop');
      if (customers.status === 'fulfilled') this.customers.set(customers.value); else warnings.push('klanten');
      if (expectedStock.status === 'fulfilled') this.expectedStock.set(expectedStock.value); else warnings.push('verwachte voorraad');
      this.dataWarnings.set(warnings);
    } finally {
      this.loading.set(false);
    }
  }

  async loadVariances(): Promise<void> {
    if (this.filtering()) return;
    this.filtering.set(true);
    this.receiptError.set('');
    try {
      this.acceptReport(await this.sourcing.receiptVariances(this.filters()));
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
    this.fromDate.set(CURRENT_YEAR_START);
    this.toDate.set(TODAY);
    this.appliedFromDate.set(CURRENT_YEAR_START);
    this.appliedToDate.set(TODAY);
    this.appliedSupplierId.set(this.supplierId());
    void this.loadVariances();
  }

  changeSupplier(value: string | number | null): void {
    const parsed = Number(value);
    this.supplierId.set(value === '' || value === null || !Number.isFinite(parsed) ? null : parsed);
  }

  showSalesAllTime(): void {
    this.salesFromDate.set('');
    this.salesToDate.set('');
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
  return ANALYSIS_TABS.some((tab) => tab.id === value) ? value as AnalysisSection : 'overview';
}
