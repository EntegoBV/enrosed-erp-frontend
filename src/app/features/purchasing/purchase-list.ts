import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SourcingApi } from '../../core/api/sourcing-api';
import { PurchaseOrderView, Supplier } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Privacy } from '../../core/api/privacy';
import { Sheet, Ui } from '../../shared/ui';
import { CbmPipe, DateNlPipe, EurPipe, NumPipe } from '../../shared/pipes';

@Component({
  selector: 'app-purchase-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, PageHeader, Sheet, EurPipe, NumPipe, CbmPipe, DateNlPipe],
  template: `
    <app-page-header title="Inkoop" [subtitle]="orders().length + ' containercalculaties'">
      <button class="btn btn--primary btn--sm hide-mobile" type="button" (click)="startNew()">
        + Nieuw
      </button>
    </app-page-header>

    <div class="content">
      <div class="alert alert--info">
        <span class="alert__icon">ℹ</span>
        <div>
          Inkoop gaat per container. Hier wordt de <b>kostprijs per stuk</b> berekend: EXW in
          USD of RMB, plus lokale kosten in China, zeevracht, invoerrechten per HS-code en de
          kosten vanaf de aankomsthaven.
        </div>
      </div>

      <div class="card mt-12"><div class="list">
        @for (row of orders(); track row.order.id) {
          <a class="list-item" [routerLink]="['/purchasing', row.order.id]">
            <div class="list-item__body">
              <div class="list-item__title">
                {{ row.order.number }} — {{ supplierName(row.order.supplierId) }}
              </div>
              <div class="list-item__meta">
                {{ row.order.orderDate | dateNl }} · {{ row.order.containerType }} ·
                {{ row.costing.totals.cartons | num }} kartons ·
                {{ row.costing.totals.cbm | cbm }}
              </div>
            </div>
            <div class="list-item__end">
              <div class="strong num">{{ row.costing.totals.totalEur | eur: 0 }}</div>
              <span class="badge badge--neutral">{{ row.order.status }}</span>
            </div>
            <span class="list-item__chev">›</span>
          </a>
        } @empty {
          <div class="empty">
            <div class="empty__icon">▩</div>
            <div class="empty__title">{{ loading() ? 'Laden…' : 'Nog geen inkooporders' }}</div>
            @if (!loading()) {
              <button class="btn btn--primary" type="button" (click)="startNew()">
                Nieuwe calculatie
              </button>
            }
          </div>
        }
      </div></div>
    </div>

    <button class="fab" type="button" (click)="startNew()">+ Calculatie</button>

    @if (picking()) {
      <app-sheet title="Nieuwe inkoopcalculatie" (closed)="picking.set(false)">
        <div body>
          <div class="field">
            <label for="po-supplier">Leverancier</label>
            <select class="select" id="po-supplier" [ngModel]="chosen()"
                    (ngModelChange)="chosen.set(+$event)">
              @for (supplier of suppliers(); track supplier.id) {
                <option [ngValue]="supplier.id">{{ supplier.name }} ({{ supplier.currency }})</option>
              }
            </select>
          </div>
          <div class="field-row">
            <div class="field"><label for="po-cny">Koers RMB → USD</label>
              <input class="input num right" id="po-cny" type="number" step="0.0001"
                     [ngModel]="cnyToUsd()" (ngModelChange)="cnyToUsd.set(+$event)" /></div>
            <div class="field"><label for="po-usd">Koers USD → EUR</label>
              <input class="input num right" id="po-usd" type="number" step="0.0001"
                     [ngModel]="usdToEur()" (ngModelChange)="usdToEur.set(+$event)" /></div>
          </div>
          <p class="small muted">
            De koersen worden op de order vastgeklikt, zodat een oude calculatie niet verandert
            als de koers beweegt.
          </p>
        </div>
        <div foot style="display:contents">
          <button class="btn" type="button" (click)="picking.set(false)">Annuleren</button>
          <button class="btn btn--primary" type="button" (click)="create()">Aanmaken</button>
        </div>
      </app-sheet>
    }
  `,
})
export class PurchaseList {
  private readonly sourcing = inject(SourcingApi);
  private readonly router = inject(Router);
  private readonly ui = inject(Ui);
  readonly privacy = inject(Privacy);

  readonly orders = signal<PurchaseOrderView[]>([]);
  readonly suppliers = signal<Supplier[]>([]);
  readonly loading = signal(true);
  readonly picking = signal(false);
  readonly chosen = signal<number | null>(null);
  readonly cnyToUsd = signal(0.1385);
  readonly usdToEur = signal(0.89);

  constructor() { void this.load(); }

  private async load(): Promise<void> {
    const [orders, suppliers] = await Promise.all([
      this.sourcing.purchaseOrders(), this.sourcing.suppliers()]);
    this.orders.set(orders);
    this.suppliers.set(suppliers);
    this.chosen.set(suppliers[0]?.id ?? null);
    this.loading.set(false);
  }

  supplierName(id: number): string {
    return this.suppliers().find((supplier) => supplier.id === id)?.name ?? 'Onbekend';
  }

  startNew(): void {
    if (!this.suppliers().length) {
      this.ui.toast('Maak eerst een leverancier aan', 'err');
      return;
    }
    this.picking.set(true);
  }

  async create(): Promise<void> {
    const supplierId = this.chosen();
    if (supplierId === null) return;
    const view = await this.sourcing.createPurchaseOrder(
      supplierId, this.cnyToUsd(), this.usdToEur(), 10);
    this.picking.set(false);
    await this.router.navigate(['/purchasing', view.order.id]);
  }
}
