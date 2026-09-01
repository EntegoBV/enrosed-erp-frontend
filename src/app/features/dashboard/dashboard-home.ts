import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import {
  Product,
  PurchaseOrderView,
  QuoteRevision,
  SalesOrderView,
  Supplier,
} from '../../core/api/models';
import { PlannerStore } from '../../core/api/planner-api';
import { SalesApi } from '../../core/api/sales-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { Icon } from '../../shared/icon';
import { PageHeader } from '../../shared/page-header';
import { DateNlPipe, EurPipe, NumPipe } from '../../shared/pipes';
import { Skeleton } from '../../shared/skeleton';
import { isWebsiteQuoteRequest } from '../sales/quote-status';
import { PlannerCards, PlannerMilestone } from './planner-cards';

/**
 * The operational front door: what needs an answer, what is planned next and
 * three honest business totals. Detailed analysis deliberately lives under
 * /analyses so the start screen stays calm on a phone as well as a desktop.
 */
@Component({
  selector: 'app-dashboard-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, PageHeader, Skeleton, PlannerCards, DateNlPipe, EurPipe, NumPipe],
  template: `
    <app-page-header [title]="greeting()" [subtitle]="today()" />

    <main class="content home-page anim-stagger" [attr.aria-busy]="loading() || refreshing()">
      @if (loading()) {
        <section class="home-loading" aria-live="polite" aria-label="Home laden">
          <app-skeleton kind="card" [rows]="4" />
          <app-skeleton kind="stats" [rows]="3" />
        </section>
      } @else {
        @if (pinnedItems().length) {
          <section class="home-pins" aria-label="Vastgepind">
            @for (pin of pinnedItems(); track pin.id) {
              <div class="home-pin">
                <span class="home-pin__mark" aria-hidden="true">•</span>
                <span class="home-pin__copy">
                  <b>{{ pin.title }}</b>
                  @if (pin.onDate || pin.note) {
                    <small>
                      @if (pin.onDate) { {{ pin.onDate | dateNl }}@if (pin.atTime) { · {{ pin.atTime }} } }
                      @if (pin.note) { @if (pin.onDate) { · }{{ pin.note }} }
                    </small>
                  }
                </span>
              </div>
            }
            @if (hiddenPinnedCount()) {
              <span class="home-pins__more">+{{ hiddenPinnedCount() }} meer in de planning</span>
            }
          </section>
        }

        @if (dataWarnings().length) {
          <section class="home-warning" role="status">
            <span aria-hidden="true">!</span>
            <div>
              <strong>Een deel van Home is niet bijgewerkt</strong>
              <p>{{ warningLabel() }}. {{ warningDetail() || 'De overige gegevens blijven beschikbaar.' }}</p>
            </div>
            <button class="btn btn--sm" type="button" [disabled]="refreshing()" (click)="load()">
              {{ refreshing() ? 'Bezig…' : 'Opnieuw' }}
            </button>
          </section>
        }

        <div class="home-primary-grid">
          <section class="card work-card" aria-labelledby="home-work-title">
            <header class="work-card__head">
              <div>
                <span class="home-eyebrow">Dagstart</span>
                <h2 id="home-work-title">Nu doen</h2>
                <p>Gegroepeerd per werkstroom, met maximaal vier regels.</p>
              </div>
              @if (workGroupCount()) {
                <span class="work-card__count" [attr.aria-label]="workGroupCount() + ' werkstromen met aandacht'">
                  {{ workGroupCount() }}
                </span>
              } @else if (workCoverageComplete()) {
                <span class="work-card__done" aria-label="Geen open aandachtspunten">✓</span>
              }
            </header>

            <div class="work-list">
              @if (salesActionCount()) {
                <a class="work-row work-row--primary" [routerLink]="salesActionLink()">
                  <span class="work-row__icon"><app-icon name="sales" [size]="18" /></span>
                  <span class="work-row__copy">
                    <b>Offertes en aanvragen</b>
                    <small>{{ salesActionLabel() }}</small>
                  </span>
                  <strong class="work-row__number">{{ salesActionCount() }}</strong>
                  <span class="work-row__chev" aria-hidden="true">›</span>
                </a>
              }

              @if (purchaseAttentionOrders().length) {
                <a class="work-row" routerLink="/purchasing">
                  <span class="work-row__icon"><app-icon name="purchase" [size]="18" /></span>
                  <span class="work-row__copy">
                    <b>Inkoop controleren</b>
                    <small>Ontbrekende gegevens en afwijkingen nalopen.</small>
                  </span>
                  <strong class="work-row__number">{{ purchaseAttentionOrders().length }}</strong>
                  <span class="work-row__chev" aria-hidden="true">›</span>
                </a>
              }

              @if (zeroStockCount()) {
                <a class="work-row" routerLink="/stock">
                  <span class="work-row__icon"><app-icon name="stock" [size]="18" /></span>
                  <span class="work-row__copy">
                    <b>Voorraad aanvullen</b>
                    <small>Actieve artikelen met een bekende voorraad staan op nul.</small>
                  </span>
                  <strong class="work-row__number">{{ zeroStockCount() }}</strong>
                  <span class="work-row__chev" aria-hidden="true">›</span>
                </a>
              }

              @if (catalogAttention()) {
                <a class="work-row" routerLink="/website/products">
                  <span class="work-row__icon"><app-icon name="products" [size]="18" /></span>
                  <span class="work-row__copy">
                    <b>Websiteproducten aanvullen</b>
                    <small>Productdata of inhoud is nog niet publicatieklaar.</small>
                  </span>
                  <strong class="work-row__number">{{ catalogAttention() }}</strong>
                  <span class="work-row__chev" aria-hidden="true">›</span>
                </a>
              }

              @if (!workGroupCount() && workCoverageComplete()) {
                <div class="work-empty">
                  <span aria-hidden="true">✓</span>
                  <div><b>Alles voor nu bijgewerkt</b><p>Geen klantvragen of operationele blokkades die nu een antwoord vragen.</p></div>
                </div>
              } @else if (!workGroupCount()) {
                <div class="work-empty work-empty--unknown">
                  <span aria-hidden="true">!</span>
                  <div><b>Nog geen volledige all-clear</b><p>Een van de werkstromen kon niet worden gecontroleerd.</p></div>
                </div>
              }
            </div>
          </section>

          <app-planner-cards [compact]="true" [milestones]="purchaseMilestones()" />
        </div>

        <section class="home-section" aria-labelledby="home-kpi-title">
          <header class="home-section__head">
            <div>
              <span class="home-eyebrow">Kerncijfers</span>
              <h2 id="home-kpi-title">In één oogopslag</h2>
            </div>
            <a routerLink="/analyses">Alle analyses <span aria-hidden="true">›</span></a>
          </header>

          <div class="home-kpis">
            <a class="home-kpi home-kpi--dark" routerLink="/analyses/sales">
              <span class="home-kpi__icon"><app-icon name="sales" [size]="17" /></span>
              <span class="home-kpi__label">Verkooppijplijn</span>
              @if (salesReady()) {
                <strong>{{ pipelineValue() | eur: 0 }}</strong>
                <small>{{ openSales().length }} open {{ openSales().length === 1 ? 'offerte' : 'offertes' }}</small>
              } @else {
                <strong>—</strong><small>Nog niet beschikbaar</small>
              }
              <span class="home-kpi__chev" aria-hidden="true">›</span>
            </a>

            <a class="home-kpi" routerLink="/analyses/purchasing">
              <span class="home-kpi__icon"><app-icon name="purchase" [size]="17" /></span>
              <span class="home-kpi__label">Inkoop onderweg</span>
              @if (purchasesReady()) {
                <strong>{{ incomingValue() | eur: 0 }}</strong>
                <small>{{ incomingPieces() | num }} st · {{ incomingOrders().length }} {{ incomingOrders().length === 1 ? 'order' : 'orders' }}</small>
              } @else {
                <strong>—</strong><small>Nog niet beschikbaar</small>
              }
              <span class="home-kpi__chev" aria-hidden="true">›</span>
            </a>

            <a class="home-kpi" routerLink="/analyses/inventory">
              <span class="home-kpi__icon"><app-icon name="stock" [size]="17" /></span>
              <span class="home-kpi__label">Bekende voorraadkost</span>
              @if (productsReady()) {
                <strong>{{ inventoryPurchaseValue() | eur: 0 }}</strong>
                <small>{{ inventoryValuedPieces() | num }} st met bekende kost</small>
                @if (inventoryUnvaluedPieces() || inventoryUnknownSkuCount()) {
                  <em>Kostdekking is nog niet volledig</em>
                }
              } @else {
                <strong>—</strong><small>Nog niet beschikbaar</small>
              }
              <span class="home-kpi__chev" aria-hidden="true">›</span>
            </a>
          </div>
        </section>

        <a class="home-market-link" routerLink="/analyses/market">
          <span class="home-market-link__icon"><app-icon name="analytics" [size]="17" /></span>
          <span><b>Valuta en containermarkt</b><small>Koersen, containertarieven en historie staan rustig bij Analyses.</small></span>
          <i aria-hidden="true">›</i>
        </a>
      }
    </main>
  `,
  styles: `
    :host { display: block; }
    .home-page { max-width: 1180px; padding-bottom: 92px; }
    .home-loading { display: grid; gap: 14px; }
    .home-eyebrow { display: block; margin-bottom: 3px; color: var(--rose); font-size: 9.5px;
      font-weight: 800; letter-spacing: .11em; text-transform: uppercase; }

    .home-pins { display: flex; align-items: stretch; gap: 7px; margin-bottom: 11px; overflow: hidden; }
    .home-pin { display: flex; flex: 1 1 0; min-width: 0; align-items: center; gap: 8px; padding: 8px 11px;
      border: 1px solid var(--rose-line); border-radius: 11px; background: var(--rose-soft); }
    .home-pin__mark { color: var(--rose-dark); font-size: 18px; line-height: 1; }
    .home-pin__copy { display: grid; min-width: 0; }
    .home-pin__copy b,.home-pin__copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .home-pin__copy b { font-size: 12px; font-weight: 700; }
    .home-pin__copy small { color: var(--muted); font-size: 10.5px; }
    .home-pins__more { align-self: center; flex: none; color: var(--muted); font-size: 10.5px; white-space: nowrap; }

    .home-warning { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px;
      margin-bottom: 12px; padding: 10px 12px; border: 1px solid color-mix(in srgb,var(--warn) 26%,var(--line));
      border-radius: 12px; background: var(--warn-soft); }
    .home-warning>span { display: grid; width: 29px; height: 29px; place-items: center; border-radius: 50%;
      background: var(--surface); color: var(--warn); font-weight: 800; }
    .home-warning strong { display: block; font-size: 12.5px; }
    .home-warning p { margin-top: 1px; color: var(--muted); font-size: 10.5px; line-height: 1.4; }

    .home-primary-grid { display: grid; gap: 12px; align-items: start; }
    .work-card { overflow: hidden; }
    .work-card__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
      padding: 15px 16px 12px; border-bottom: 1px solid var(--line); }
    .work-card__head h2,.home-section__head h2 { font-size: 17px; letter-spacing: -.015em; }
    .work-card__head p { margin-top: 2px; color: var(--muted); font-size: 11.5px; }
    .work-card__count,.work-card__done { display: grid; width: 33px; height: 33px; flex: none; place-items: center;
      border-radius: 11px; background: var(--rose); color: #fff; font-size: 13px; font-weight: 820; }
    .work-card__done { background: var(--ok); }
    .work-list { display: grid; }
    .work-row { display: grid; grid-template-columns: auto minmax(0,1fr) auto auto; align-items: center; gap: 10px;
      min-height: 58px; padding: 8px 13px; border-bottom: 1px solid var(--line); color: inherit; text-decoration: none; }
    .work-row:last-child { border-bottom: 0; }
    .work-row:hover { background: var(--surface-2); }
    .work-row--primary { background: color-mix(in srgb,var(--rose-soft) 52%,var(--surface)); }
    .work-row__icon { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 10px;
      background: var(--surface-2); color: var(--rose-dark); box-shadow: inset 0 0 0 1px var(--line); }
    .work-row--primary .work-row__icon { background: var(--rose); color: #fff; box-shadow: none; }
    .work-row__copy { display: grid; min-width: 0; }
    .work-row__copy b { overflow: hidden; font-size: 13px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
    .work-row__copy small { overflow: hidden; color: var(--muted); font-size: 10.5px; text-overflow: ellipsis; white-space: nowrap; }
    .work-row__number { display: grid; min-width: 28px; height: 28px; place-items: center; padding-inline: 6px;
      border-radius: 9px; background: var(--surface-2); color: var(--ink-2); font-size: 11px; font-weight: 800; }
    .work-row--primary .work-row__number { background: var(--rose-soft); color: var(--rose-dark); }
    .work-row__chev { color: var(--muted-2); font-size: 17px; }
    .work-empty { display: flex; align-items: center; gap: 11px; padding: 17px 15px; }
    .work-empty>span { display: grid; width: 34px; height: 34px; flex: none; place-items: center; border-radius: 50%;
      background: var(--ok-soft); color: var(--ok); font-weight: 800; }
    .work-empty b { display: block; font-size: 13px; }
    .work-empty p { margin-top: 2px; color: var(--muted); font-size: 11px; }
    .work-empty--unknown>span { background: var(--warn-soft); color: var(--warn); }

    .home-section { margin-top: 24px; }
    .home-section__head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin-bottom: 9px;
      padding-inline: 2px; }
    .home-section__head>a { color: var(--rose-dark); font-size: 11.5px; font-weight: 700; text-decoration: none; }
    .home-section__head>a span { margin-left: 2px; font-size: 15px; }
    .home-kpis { display: grid; gap: 8px; }
    .home-kpi { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center;
      gap: 2px 9px; min-width: 0; min-height: 83px; padding: 12px 13px; border: 1px solid var(--line);
      border-radius: var(--r); background: var(--surface); color: inherit; text-decoration: none; box-shadow: var(--sh-1); }
    .home-kpi:hover { border-color: var(--rose-line); }
    .home-kpi__icon { display: grid; grid-row: 1 / span 3; width: 33px; height: 33px; place-items: center; border-radius: 10px;
      background: var(--surface-2); color: var(--rose-dark); }
    .home-kpi__label { color: var(--muted); font-size: 9px; font-weight: 780; letter-spacing: .06em; text-transform: uppercase; }
    .home-kpi strong { grid-column: 2; font-size: 20px; line-height: 1.05; letter-spacing: -.02em; }
    .home-kpi small { grid-column: 2; overflow: hidden; color: var(--muted); font-size: 10.5px; text-overflow: ellipsis; white-space: nowrap; }
    .home-kpi em { grid-column: 2; color: var(--warn); font-size: 9.5px; font-style: normal; }
    .home-kpi__chev { grid-column: 3; grid-row: 1 / span 4; color: var(--muted-2); font-size: 17px; }
    .home-kpi--dark { border-color: #302a27; background: #272220; color: #fff; }
    .home-kpi--dark .home-kpi__icon { background: #3b3431; color: #e8b7c0; }
    .home-kpi--dark :is(.home-kpi__label,small) { color: #cfc7c2; }

    .home-market-link { display: grid; grid-template-columns: auto minmax(0,1fr) auto; align-items: center; gap: 10px;
      margin-top: 14px; padding: 11px 13px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-2);
      color: inherit; text-decoration: none; }
    .home-market-link:hover { border-color: var(--rose-line); }
    .home-market-link__icon { display: grid; width: 31px; height: 31px; place-items: center; border-radius: 9px;
      background: var(--surface); color: var(--muted); }
    .home-market-link>span:nth-child(2) { display: grid; min-width: 0; }
    .home-market-link b { font-size: 12px; }
    .home-market-link small { overflow: hidden; color: var(--muted); font-size: 10.5px; text-overflow: ellipsis; white-space: nowrap; }
    .home-market-link i { color: var(--muted-2); font-size: 17px; font-style: normal; }

    @media (min-width: 760px) {
      .home-page { padding-bottom: 38px; }
      .home-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .home-kpi { min-height: 108px; align-content: center; }
    }
    @media (min-width: 1000px) {
      .home-primary-grid { grid-template-columns: minmax(0, 1fr); gap: 16px; }
    }
    @media (max-width: 579.98px) {
      .home-pins { display: grid; }
      .home-pins__more { padding-inline: 3px; }
      .home-warning { grid-template-columns: auto minmax(0,1fr); }
      .home-warning .btn { grid-column: 1 / -1; width: 100%; }
      .work-row { grid-template-columns: auto minmax(0,1fr) auto auto; gap: 8px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .work-row,.home-kpi,.home-market-link { transition: none; }
    }
  `,
})
export class DashboardHome {
  private readonly sales = inject(SalesApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly catalog = inject(CatalogApi);
  private readonly planner = inject(PlannerStore);

  readonly salesOrders = signal<SalesOrderView[]>([]);
  readonly purchases = signal<PurchaseOrderView[]>([]);
  readonly revisions = signal<QuoteRevision[]>([]);
  readonly products = signal<Product[]>([]);
  readonly suppliers = signal<Supplier[]>([]);
  readonly catalogAttention = signal(0);

  readonly salesReady = signal(false);
  readonly purchasesReady = signal(false);
  readonly revisionsReady = signal(false);
  readonly productsReady = signal(false);
  readonly catalogReady = signal(false);
  readonly loading = signal(true);
  readonly refreshing = signal(false);
  readonly dataWarnings = signal<string[]>([]);
  readonly warningDetail = signal<string | null>(null);
  private loadedOnce = false;

  readonly pinnedItems = computed(() => this.planner.items().filter((item) => item.pinned).slice(0, 2));
  readonly hiddenPinnedCount = computed(() => Math.max(0,
    this.planner.items().filter((item) => item.pinned).length - this.pinnedItems().length));

  readonly newWebsiteRequests = computed(() => this.salesOrders()
    .filter((row) => !row.awaitingResend && isWebsiteQuoteRequest(row.order)));
  readonly awaitingResend = computed(() => this.salesOrders().filter((row) =>
    (row.order.docType ?? 'OFFERTE') === 'OFFERTE' && row.awaitingResend));
  readonly salesActionCount = computed(() => this.newWebsiteRequests().length
    + this.revisions().length + this.awaitingResend().length);
  readonly salesActionLabel = computed(() => {
    const parts: string[] = [];
    const requests = this.newWebsiteRequests().length;
    const revisions = this.revisions().length;
    const resend = this.awaitingResend().length;
    if (requests) parts.push('Nieuwe websiteaanvragen');
    if (revisions) parts.push('Wijzigingen gevraagd');
    if (resend) parts.push('Opnieuw verzenden');
    return parts.join(' · ');
  });

  readonly purchaseAttentionOrders = computed(() => this.purchases()
    .filter((row) => (row.attention?.length ?? 0) > 0));
  readonly zeroStockCount = computed(() => this.products().filter((product) =>
    product.active && !product.demo && product.inventoryKnown === true && product.stockQuantity <= 0).length);
  readonly workGroupCount = computed(() =>
    Number(this.salesActionCount() > 0)
    + Number(this.purchaseAttentionOrders().length > 0)
    + Number(this.zeroStockCount() > 0)
    + Number(this.catalogAttention() > 0));
  readonly workCoverageComplete = computed(() => this.salesReady() && this.revisionsReady()
    && this.purchasesReady() && this.productsReady() && this.catalogReady());

  readonly openSales = computed(() => this.salesOrders().filter((row) =>
    (row.order.docType ?? 'OFFERTE') === 'OFFERTE'
    && ['CONCEPT', 'VERZONDEN', 'BEKEKEN', 'WIJZIGING_GEVRAAGD'].includes(row.order.status)));
  readonly pipelineValue = computed(() => this.openSales()
    .reduce((sum, row) => sum + row.priced.totals.total, 0));

  readonly incomingOrders = computed(() => this.purchases()
    .filter((row) => row.order.status === 'BESTELD' || row.order.status === 'ONDERWEG'));
  readonly incomingValue = computed(() => this.incomingOrders()
    .reduce((sum, row) => sum + row.costing.totals.totalEur, 0));
  readonly incomingPieces = computed(() => this.incomingOrders()
    .reduce((sum, row) => sum + row.costing.totals.pieces, 0));

  readonly valuedInventory = computed(() => this.products().filter((product) =>
    product.inventoryKnown === true && product.stockQuantity > 0 && product.landedCostEur != null));
  readonly inventoryValuedPieces = computed(() => this.valuedInventory()
    .reduce((sum, product) => sum + product.stockQuantity, 0));
  readonly inventoryPurchaseValue = computed(() => this.valuedInventory()
    .reduce((sum, product) => sum + product.stockQuantity * product.landedCostEur!, 0));
  readonly inventoryUnvaluedPieces = computed(() => this.products()
    .filter((product) => product.inventoryKnown === true && product.stockQuantity > 0 && product.landedCostEur == null)
    .reduce((sum, product) => sum + product.stockQuantity, 0));
  readonly inventoryUnknownSkuCount = computed(() => this.products()
    .filter((product) => product.inventoryKnown !== true).length);

  private readonly supplierNameById = computed(() =>
    new Map(this.suppliers().map((supplier) => [supplier.id, supplier.name])));
  readonly purchaseMilestones = computed(() => {
    const milestones: PlannerMilestone[] = [];
    for (const row of this.purchases()) {
      const name = row.order.alias || row.order.number;
      const supplier = this.supplierNameById().get(row.order.supplierId) ?? row.order.number;
      if (row.order.orderDate && row.order.status !== 'CONCEPT') {
        milestones.push({ date: row.order.orderDate, icon: '🛒', title: `${name} besteld`,
          sub: supplier, orderId: row.order.id });
      }
      if (row.order.shippedOn) {
        milestones.push({ date: row.order.shippedOn, icon: '🚢', title: `${name} vertrokken`,
          sub: row.order.trackingReference ? `T&T ${row.order.trackingReference}` : supplier,
          orderId: row.order.id });
      }
      if (row.order.expectedArrival && row.order.status !== 'ONTVANGEN') {
        milestones.push({ date: row.order.expectedArrival, icon: '📦', title: `${name} verwachte aankomst`,
          sub: `${row.costing.totals.pieces.toLocaleString('nl-BE')} st · ${supplier}`,
          orderId: row.order.id });
      }
      if (row.order.receivedOn) {
        milestones.push({ date: row.order.receivedOn, icon: '✓', title: `${name} ontvangen`,
          sub: supplier, orderId: row.order.id });
      }
    }
    return milestones;
  });

  constructor() {
    void this.load();
  }

  salesActionLink(): string {
    return this.revisions().length && !this.newWebsiteRequests().length && !this.awaitingResend().length
      ? '/revisions' : '/sales';
  }

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

  warningLabel(): string {
    return `Niet bijgewerkt: ${this.dataWarnings().join(', ')}`;
  }

  async load(): Promise<void> {
    if (this.refreshing()) return;
    if (this.loadedOnce) this.refreshing.set(true);
    else this.loading.set(true);

    try {
      const [sales, purchases, revisions, products, families, suppliers] = await Promise.allSettled([
        this.sales.orders(),
        this.sourcing.purchaseOrders(),
        this.sales.pendingRevisions(),
        this.catalog.products(),
        this.catalog.productFamilies(),
        this.sourcing.suppliers(),
      ] as const);

      const warnings: string[] = [];
      const failures: unknown[] = [];
      const noteFailure = (result: PromiseSettledResult<unknown>, label: string): void => {
        if (result.status !== 'rejected') return;
        warnings.push(label);
        failures.push(result.reason);
      };
      noteFailure(sales, 'verkoop');
      noteFailure(purchases, 'inkoop');
      noteFailure(revisions, 'offertewijzigingen');
      noteFailure(products, 'voorraad');
      noteFailure(families, 'websiteproducten');
      noteFailure(suppliers, 'leveranciers');

      if (sales.status === 'fulfilled') {
        this.salesOrders.set(sales.value);
        this.salesReady.set(true);
      }
      if (purchases.status === 'fulfilled') {
        this.purchases.set(purchases.value);
        this.purchasesReady.set(true);
      }
      if (revisions.status === 'fulfilled') {
        this.revisions.set(revisions.value);
        this.revisionsReady.set(true);
      }
      if (products.status === 'fulfilled') {
        this.products.set(products.value);
        this.productsReady.set(true);
      }
      if (suppliers.status === 'fulfilled') this.suppliers.set(suppliers.value);

      const currentProducts = products.status === 'fulfilled' ? products.value : this.products();
      if (families.status === 'fulfilled') {
        this.catalogAttention.set(families.value
          .filter((family) => family.active && family.publicationIssues.length > 0).length);
        this.catalogReady.set(true);
      } else if (products.status === 'fulfilled') {
        this.catalogAttention.set(currentProducts
          .filter((product) => product.active && (product.publicationIssues?.length ?? 0) > 0).length);
      }

      this.dataWarnings.set(warnings);
      this.warningDetail.set(failures.length
        ? messageOf(failures[0], 'De overige gegevens blijven beschikbaar.')
        : null);
    } catch (failure: unknown) {
      this.dataWarnings.set(['Home']);
      this.warningDetail.set(messageOf(failure, 'Het overzicht kon niet volledig worden opgebouwd.'));
    } finally {
      this.loadedOnce = true;
      this.loading.set(false);
      this.refreshing.set(false);
    }
  }
}
