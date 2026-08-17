import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SalesApi } from '../../core/api/sales-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { CatalogApi } from '../../core/api/catalog-api';
import { PurchaseOrderView, QuoteRevision, SalesOrderView } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Privacy } from '../../core/api/privacy';
import { EurPipe, NumPipe, PctPipe } from '../../shared/pipes';
import { STATUS_LABEL, statusClass } from '../sales/quote-status';

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageHeader, EurPipe, NumPipe, PctPipe],
  template: `
    <app-page-header title="Dashboard" subtitle="Verkoop en inkoop in één blik">
    </app-page-header>

    <div class="content">
      <div class="kpis">
        <div class="kpi kpi--dark">
          <div class="kpi__label">Open verkoop</div>
          <div class="kpi__value">{{ openValue() | eur: 0 }}</div>
          <div class="kpi__meta">{{ openOrders().length }} order(s)</div>
        </div>
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
        <div class="kpi">
          <div class="kpi__label">Catalogus</div>
          <div class="kpi__value">{{ productCount() }}</div>
          <div class="kpi__meta">producten</div>
        </div>
      </div>

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

      <div class="section-title">Snel starten</div>
      <div class="row wrap">
        <a class="btn btn--primary" routerLink="/sales">+ Verkooporder</a>
        <a class="btn" routerLink="/purchasing">+ Inkoopcalculatie</a>
        <a class="btn" routerLink="/products">Catalogus</a>
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
              {{ loading() ? 'Laden…' : 'Nog geen verkooporders' }}</div></div>
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
                  {{ row.order.containerType }} ·
                  {{ row.costing.totals.cartons | num }} kartons
                </div>
              </div>
              <div class="list-item__end">
                @if (privacy.showPurchase()) {
                  <div class="strong num">{{ row.costing.totals.totalEur | eur: 0 }}</div>
                }
                <div class="tiny muted">{{ row.order.status }}</div>
              </div>
              <span class="list-item__chev">›</span>
            </a>
          } @empty {
            <div class="empty"><div class="empty__title">
              {{ loading() ? 'Laden…' : 'Nog geen inkooporders' }}</div></div>
          }
        </div>
      </div>
    </div>
  `,
})
export class Dashboard {
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
