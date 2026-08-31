import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import {
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
import { inDateRange, supplierReceiptPerformance } from './receipt-metrics';

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
  imports: [FormsModule, RouterLink, PageHeader, DateField, DateNlPipe, EurPipe, NumPipe, PctPipe],
  template: `
    <app-page-header title="Analyses" subtitle="Ontvangstkwaliteit en bedrijfswaarde">
      <button class="btn btn--sm" type="button" [disabled]="loading() || refreshing()"
              (click)="refresh()">{{ refreshing() ? 'Vernieuwen…' : 'Vernieuwen' }}</button>
    </app-page-header>

    <main class="content analyses-page" [attr.aria-busy]="loading() || filtering()">
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
    </main>
  `,
  styles: `
    :host{display:block}.analyses-page{max-width:1180px;padding-bottom:110px}.analysis-section+.analysis-section{margin-top:34px}
    .section-copy{margin-bottom:12px;padding:0 2px}.section-copy .eyebrow{display:block;color:var(--rose);font-size:10px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.section-copy h1,.section-copy h2{margin-top:3px;font-size:21px}.section-copy p{margin-top:4px;color:var(--muted);font-size:12.5px}.section-copy--receipt{display:flex;align-items:end;justify-content:space-between;gap:12px}
    .analysis-kpis{display:grid;gap:10px}.metric-card{position:relative;min-width:0;padding:17px;overflow:hidden}.metric-card__label{display:block;color:var(--muted);font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase}.metric-card>strong{display:block;margin-top:5px;color:var(--ink);font-size:27px;line-height:1}.metric-card>p{margin-top:7px;color:var(--muted);font-size:12px}.metric-card__sub{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:2px 8px;margin-top:14px;padding-top:11px;border-top:1px solid var(--line)}.metric-card__sub span{color:var(--muted);font-size:10px;text-transform:uppercase}.metric-card__sub b{font-size:15px;text-align:right}.metric-card__sub small{grid-column:1/-1;color:var(--muted);font-size:10.5px}.metric-card--quality:before{content:'';position:absolute;inset:0 auto 0 0;width:4px;background:var(--ok)}.metric-card--dark{border-color:#302a27;background:#272220;color:#fff}.metric-card--dark :is(.metric-card__label,.metric-card>p,.metric-card__sub span,.metric-card__sub small){color:#cfc7c2}.metric-card--dark>strong,.metric-card--dark .metric-card__sub b{color:#fff}.metric-card--dark .metric-card__sub{border-color:#49413d}
    .metric-card--loading span,.metric-card--loading b,.metric-card--loading i{display:block;border-radius:99px;background:var(--surface-2);animation:pulse 1.1s ease-in-out infinite}.metric-card--loading span{width:42%;height:10px}.metric-card--loading b{width:65%;height:28px;margin-top:14px}.metric-card--loading i{width:82%;height:9px;margin-top:16px}.analysis-warning,.valuation-note{margin-bottom:10px;padding:10px 12px;border:1px solid #eddcb9;border-radius:12px;background:var(--warn-soft);color:var(--ink-2);font-size:12px}
    .receipt-filters{display:grid;gap:10px;margin-bottom:12px;padding:14px}.receipt-filters label{display:grid;gap:4px;min-width:0}.receipt-filters label>span{color:var(--muted);font-size:10px;font-weight:750;text-transform:uppercase}.receipt-filters__actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}.receipt-filters__actions .btn{min-height:44px}
    .receipt-error{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px}.receipt-error p{margin-top:3px;color:var(--muted);font-size:12px}
    .receipt-totals{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:10px}.receipt-total{padding:13px}.receipt-total>span{display:block;color:var(--muted);font-size:9.5px;font-weight:760;text-transform:uppercase}.receipt-total>strong{display:block;margin-top:3px;font-size:20px}.receipt-total>small{display:block;margin-top:3px;color:var(--muted);font-size:10.5px}.receipt-total--loss{border-color:var(--rose-line);background:var(--rose-soft)}.receipt-total--loss strong{color:var(--rose-dark)}.receipt-total--warn{border-color:#eddcb9;background:var(--warn-soft)}
    .variance-list{display:grid;gap:10px}.variance-order{overflow:hidden}.variance-order__head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 14px;border-bottom:1px solid var(--line);background:var(--surface-2)}.variance-order__head>a{display:grid;min-width:0;color:inherit;text-decoration:none}.variance-order__head>a>span{color:var(--rose);font-size:9.5px;font-weight:760;text-transform:uppercase}.variance-order__head>a>strong{overflow:hidden;font-size:14px;text-overflow:ellipsis;white-space:nowrap}.variance-order__head>a>small{color:var(--muted);font-size:10.5px}.variance-order__head>a:hover strong{color:var(--rose-dark);text-decoration:underline}.variance-order__value{display:grid;flex:none;text-align:right}.variance-order__value b{font-size:14px}.variance-order__value small{color:var(--warn);font-size:9.5px}.variance-order__value a{margin-top:5px;color:var(--rose-dark);font-size:11px;font-weight:720;text-decoration:none}.variance-order__value a:hover{text-decoration:underline}
    .variance-lines{display:grid}.variance-line{display:grid;gap:11px;padding:14px}.variance-line+.variance-line{border-top:1px solid var(--line)}.variance-line__product{display:grid;min-width:0}.variance-line__product>strong{overflow:hidden;font-size:13.5px;text-overflow:ellipsis;white-space:nowrap}.variance-line__product>span{color:var(--muted);font-size:10.5px}.variance-line__chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}.variance-line__chips span{padding:3px 7px;border-radius:99px;background:var(--danger-soft);color:var(--danger);font-size:10px;font-weight:700}.variance-line__chips .ok{background:var(--ok-soft);color:var(--ok)}.variance-line__impact{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-radius:10px;background:var(--surface-2)}.variance-line__impact span{color:var(--muted);font-size:10px;text-transform:uppercase}.variance-line__impact b{font-size:13px}.variance-line__valuation{display:grid;gap:4px}.variance-line__valuation>label{color:var(--muted);font-size:10px;font-weight:700;text-transform:uppercase}.variance-line__valuation>small{color:var(--warn);font-size:10px}.value-edit{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center}.value-edit>span{align-self:stretch;display:grid;place-items:center;padding:0 9px;border:1px solid var(--line);border-right:0;border-radius:var(--r-sm) 0 0 var(--r-sm);background:var(--surface-2);color:var(--muted);font-size:12px}.value-edit .input{min-width:0;border-radius:0}.value-edit .btn{min-height:44px;border-radius:0 var(--r-sm) var(--r-sm) 0}.receipt-empty{display:flex;align-items:center;gap:12px;padding:18px}.receipt-empty>span{display:grid;width:38px;height:38px;flex:none;place-items:center;border-radius:50%;background:var(--ok-soft);color:var(--ok);font-weight:800}.receipt-empty p{margin-top:2px;color:var(--muted);font-size:12px}
    @media(min-width:680px){.analysis-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.receipt-filters{grid-template-columns:repeat(3,minmax(0,1fr)) auto;align-items:end}.receipt-filters__actions{grid-template-columns:auto auto}.receipt-totals{grid-template-columns:repeat(4,minmax(0,1fr))}.variance-line{grid-template-columns:minmax(220px,1fr) 145px minmax(235px,.8fr);align-items:end}.variance-line__impact{display:grid;align-content:center;text-align:right}.variance-line__impact b{margin-top:2px}.analyses-page{padding-bottom:40px}}
    @keyframes pulse{50%{opacity:.48}}
  `,
})
export class AnalysesPage {
  private readonly sourcing = inject(SourcingApi);
  private readonly catalog = inject(CatalogApi);
  private readonly sales = inject(SalesApi);
  private readonly route = inject(ActivatedRoute);
  private readonly ui = inject(Ui);

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

  readonly fromDate = signal(CURRENT_YEAR_START);
  readonly toDate = signal(TODAY);
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
      const [report, purchases, suppliers, products, sales] = await Promise.allSettled([
        this.sourcing.receiptVariances(this.filters()),
        this.sourcing.purchaseOrders(),
        this.sourcing.suppliers(),
        this.catalog.products(),
        this.sales.orders(),
      ] as const);
      const warnings: string[] = [];
      if (report.status === 'fulfilled') this.acceptReport(report.value);
      else this.receiptError.set(messageOf(report.reason, 'De ontvangstafwijkingen konden niet worden geladen.'));
      if (purchases.status === 'fulfilled') this.purchases.set(purchases.value); else warnings.push('inkoop');
      if (suppliers.status === 'fulfilled') this.suppliers.set(suppliers.value); else warnings.push('leveranciers');
      if (products.status === 'fulfilled') this.products.set(products.value); else warnings.push('voorraad');
      if (sales.status === 'fulfilled') this.salesOrders.set(sales.value); else warnings.push('verkoop');
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
