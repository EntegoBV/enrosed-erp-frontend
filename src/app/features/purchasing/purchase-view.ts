import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SourcingApi } from '../../core/api/sourcing-api';
import { CatalogApi } from '../../core/api/catalog-api';
import { Privacy } from '../../core/api/privacy';
import { AuthImage } from '../../core/api/auth-image';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { saveBlob } from '../../core/api/download';
import { Ui } from '../../shared/ui';
import { CbmPipe, EurPipe, NumPipe, PctPipe } from '../../shared/pipes';
import { Product, PurchaseOrderView } from '../../core/api/models';
import { containerLabel } from '../../core/api/geo';
import { DateNlPipe } from '../../shared/pipes';

/**
 * Look first, edit second - the purchasing counterpart of the product view.
 *
 * Tapping a purchase order shows this read-only sheet: where the container
 * stands, what is in it and what it lands at per piece, without a single
 * input field to change something by accident. Editing lives behind the
 * Bewerken button.
 *
 * The privacy switch decides how much money is on screen: in the green
 * (customer-safe) state only the products remain - quantities and photos,
 * no costs.
 */
@Component({
  selector: 'app-purchase-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AuthImage, PageHeader, Skeleton, CbmPipe, DateNlPipe, EurPipe, NumPipe, PctPipe],
  template: `
    @if (view(); as data) {
      <app-page-header [title]="data.order.number"
                       [subtitle]="data.order.alias || supplierName()"
                       [showBack]="true" [showBell]="false">
        <button class="btn btn--sm" type="button" (click)="downloadPdf()">PDF</button>
        <a class="btn btn--primary btn--sm" [routerLink]="['/purchasing', data.order.id, 'edit']">
          Bewerken
        </a>
      </app-page-header>

      <div class="content anim-rise">
        <div class="card">
          <div class="card__body">
            <div class="stepper">
              @for (step of statusSteps; track step.value; let last = $last) {
                <div class="stepper__step"
                     [class.stepper__step--done]="stepIndex(data.order.status) > $index"
                     [class.stepper__step--now]="data.order.status === step.value">
                  <span class="stepper__dot">
                    @if (stepIndex(data.order.status) > $index) { ✓ } @else { {{ $index + 1 }} }
                  </span>
                  <span class="stepper__label">{{ step.label }}</span>
                </div>
                @if (!last) { <span class="stepper__line"
                     [class.stepper__line--done]="stepIndex(data.order.status) > $index"></span> }
              }
            </div>
          </div>
        </div>

        <div class="card mt-12">
          <div class="card__head"><h2>Producten</h2>
            <span class="spacer"></span>
            <span class="muted small">{{ data.costing.totals.pieces | num }} st ·
              {{ data.costing.totals.cartons | num }} dozen</span>
          </div>
          <div class="card__body card__body--flush">
            @for (line of data.costing.lines; track line.productId) {
              <button class="pv-line" type="button" [disabled]="!showMoney()"
                      (click)="toggleLine(line.productId)">
                @if (photoOf(line.productId); as url) {
                  <img class="pv-line__photo" [appAuthSrc]="url" alt="" />
                } @else {
                  <div class="pv-line__photo pv-line__photo--empty">◈</div>
                }
                <div class="pv-line__body">
                  <div class="pv-line__name">{{ line.productName }}</div>
                  <div class="pv-line__meta">
                    {{ line.quantity | num }} st · {{ line.cartons | num }} dozen ·
                    {{ line.cbm | cbm }}
                  </div>
                </div>
                @if (showMoney()) {
                  <div class="pv-line__cost">
                    <div class="num">{{ unitCost(line) | eur }}</div>
                    <div class="tiny muted">per stuk</div>
                  </div>
                  <span class="card__chev" [class.card__chev--open]="openLine() === line.productId">›</span>
                }
              </button>
              @if (showMoney() && openLine() === line.productId) {
                <!-- The same build-up as the container total, but for this
                     line alone - the answer to "why does this piece land
                     at that price". -->
                <div class="pv-detail">
                  <div class="stat-row"><span>Goederen</span>
                    <span class="num">{{ line.goodsEur | eur }}</span></div>
                  <div class="stat-row"><span>Lokale kosten China</span>
                    <span class="num">{{ line.originEur | eur }}</span></div>
                  <div class="stat-row"><span>Zeevracht</span>
                    <span class="num">{{ line.freightEur | eur }}</span></div>
                  <div class="stat-row"><span>Douanewaarde</span>
                    <span class="num">{{ line.customsValueEur | eur }}</span></div>
                  <div class="stat-row">
                    <span>Invoerrecht {{ line.dutyRatePct | pct: 1 }}
                      @if (line.dutySource) {
                        <span class="tiny muted">({{ line.dutySource }})</span>
                      }
                    </span>
                    <span class="num">{{ line.dutyEur | eur }}</span></div>
                  <div class="stat-row"><span>Kosten na aankomst</span>
                    <span class="num">{{ line.destinationEur | eur }}</span></div>
                  @if (line.extraRevenueEur) {
                    <div class="stat-row"><span>Extra opbrengst</span>
                      <span class="num">{{ line.extraRevenueEur | eur }}</span></div>
                  }
                  <div class="stat-row stat-row--total"><span>Totaal regel</span>
                    <span class="num">{{ line.totalEur | eur }}</span></div>
                  <div class="stat-row"><span>Per stuk geland</span>
                    <span class="num">{{ line.landedUnitEur | eur }}</span></div>
                </div>
              }
            }
          </div>
        </div>

        <div class="card mt-12">
          <div class="card__head"><h2>Gegevens</h2></div>
          <div class="card__body">
            <div class="stat-row"><span>Leverancier</span><span>{{ supplierName() }}</span></div>
            <div class="stat-row"><span>Datum</span><span>{{ data.order.orderDate | dateNl }}</span></div>
            <div class="stat-row"><span>Container</span><span>{{ containerLabel(data.order.containerType) }}</span></div>
            <div class="stat-row"><span>Aankomsthaven</span>
              <span>{{ data.order.destinationPort || '—' }}</span></div>
            @if (showMoney()) {
              <div class="stat-row"><span>Koers USD → EUR</span>
                <span class="num">{{ data.order.usdToEurGoods | num: 4 }}</span></div>
            }
            @if (data.order.notes) {
              <div class="stat-row"><span>Notitie</span><span>{{ data.order.notes }}</span></div>
            }
          </div>
        </div>

        @if (showMoney()) {
          <div class="card mt-12 internal-block">
            <div class="card__head"><h2>Kostenopbouw</h2></div>
            <div class="card__body">
              <div class="stat-row"><span>Goederen</span>
                <span class="num">{{ data.costing.totals.goodsEur | eur }}</span></div>
              <div class="stat-row"><span>Lokale kosten China</span>
                <span class="num">{{ data.costing.totals.originEur | eur }}</span></div>
              <div class="stat-row"><span>Zeevracht</span>
                <span class="num">{{ data.costing.totals.freightEur | eur }}</span></div>
              <div class="stat-row"><span>Douanewaarde</span>
                <span class="num">{{ data.costing.totals.customsValueEur | eur }}</span></div>
              <div class="stat-row"><span>Invoerrechten
                  ({{ data.costing.totals.effectiveDutyPct | pct: 1 }})</span>
                <span class="num">{{ data.costing.totals.dutyEur | eur }}</span></div>
              <div class="stat-row"><span>{{ data.order.destinationPort || 'Bestemming' }} → magazijn</span>
                <span class="num">{{ data.costing.totals.destinationEur | eur }}</span></div>
              @if (data.costing.totals.extraRevenueEur) {
                <div class="stat-row"><span>Extra opbrengst</span>
                  <span class="num">{{ data.costing.totals.extraRevenueEur | eur }}</span></div>
              }
              <div class="stat-row stat-row--total"><span>Totaal geland</span>
                <span class="num">{{ data.costing.totals.totalEur | eur }}</span></div>
              <div class="stat-row"><span>Gemiddeld per stuk</span>
                <span class="num">{{ data.costing.totals.averageUnitEur | eur }}</span></div>
            </div>
          </div>
        }

        @if (data.costing.containerFill; as fill) {
          <div class="card mt-12">
            <div class="card__head"><h2>Container</h2>
              <span class="spacer"></span>
              <span class="muted small">{{ fill.containerCode }}</span>
            </div>
            <div class="card__body">
              <div class="pv-fill">
                <div class="pv-fill__bar">
                  <div class="pv-fill__used" [style.width.%]="fillWidth(fill.fillPercent)"
                       [class.pv-fill__used--over]="fill.overflowCbm > 0"></div>
                </div>
                <div class="small muted mt-8">
                  {{ fill.usedCbm | cbm }} van {{ fill.capacityCbm | cbm }}
                  ({{ fill.fillPercent | pct: 0 }})
                  @if (fill.overflowCbm > 0) {
                    · <span class="warn-text">{{ fill.overflowCbm | cbm }} te veel</span>
                  } @else {
                    · {{ fill.freeCbm | cbm }} vrij
                  }
                </div>
              </div>
            </div>
          </div>
        }

      </div>
    } @else {
      <app-page-header title="Inkoop" [showBack]="true" [showBell]="false" />
      <div class="content">
        <app-skeleton kind="card" [rows]="3" />
        <app-skeleton kind="lines" [rows]="4" />
      </div>
    }
  `,
  styles: `
    .pv-line {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 16px;
      border-bottom: 1px solid var(--line);
      width: 100%; border-left: 0; border-right: 0; border-top: 0;
      background: none; font: inherit; text-align: left; color: inherit;
      cursor: pointer;
    }
    .pv-line:disabled { cursor: default; }
    .pv-line:last-child { border-bottom: 0; }
    .pv-detail {
      padding: 6px 16px 12px;
      background: var(--surface-2);
      border-bottom: 1px solid var(--line);
      animation: rise 0.2s ease;
    }
    .pv-line__photo {
      width: 46px; height: 46px; border-radius: 10px; object-fit: cover;
      border: 1px solid var(--line); background: var(--surface-2); flex: none;
    }
    .pv-line__photo--empty {
      display: flex; align-items: center; justify-content: center;
      color: var(--muted);
    }
    .pv-line__body { flex: 1; min-width: 0; }
    .pv-line__name { font-weight: 600; font-size: 14px; }
    .pv-line__meta { font-size: 12.5px; color: var(--muted); margin-top: 2px; }
    .pv-line__cost { text-align: right; }
    .pv-fill__bar {
      height: 10px; border-radius: 999px; background: var(--surface-2);
      overflow: hidden; border: 1px solid var(--line);
    }
    .pv-fill__used {
      height: 100%; border-radius: inherit; background: var(--accent);
      transition: width 0.5s ease;
    }
    .pv-fill__used--over { background: var(--warn); }
  `,
})
export class PurchaseView {
  readonly containerLabel = containerLabel;

  private readonly sourcing = inject(SourcingApi);
  private readonly catalog = inject(CatalogApi);
  private readonly route = inject(ActivatedRoute);
  private readonly ui = inject(Ui);
  readonly privacy = inject(Privacy);

  readonly view = signal<PurchaseOrderView | null>(null);
  private readonly products = signal<Product[]>([]);
  private readonly suppliers = signal<{ id: number | null; name: string }[]>([]);

  readonly statusSteps = [
    { value: 'CONCEPT', label: 'Concept' },
    { value: 'BESTELD', label: 'Besteld' },
    { value: 'ONDERWEG', label: 'Onderweg' },
    { value: 'ONTVANGEN', label: 'Ontvangen' },
  ];

  readonly showMoney = computed(() => this.privacy.showPurchase());

  /** Which product line shows its cost build-up; null is all folded. */
  readonly openLine = signal<number | null>(null);

  toggleLine(productId: number): void {
    this.openLine.set(this.openLine() === productId ? null : productId);
  }

  constructor() {
    const id = +(this.route.snapshot.paramMap.get('id') ?? 0);
    void this.load(id);
  }

  private async load(id: number): Promise<void> {
    const [view, products, suppliers] = await Promise.all([
      this.sourcing.purchaseOrder(id), this.catalog.products(), this.sourcing.suppliers()]);
    this.view.set(view);
    this.products.set(products);
    this.suppliers.set(suppliers);
  }

  supplierName(): string {
    const id = this.view()?.order.supplierId;
    return this.suppliers().find((supplier) => supplier.id === id)?.name ?? '';
  }

  photoOf(productId: number): string | null {
    const product = this.products().find((candidate) => candidate.id === productId);
    return product?.photos?.[0]?.url ?? null;
  }

  stepIndex(status: string): number {
    return this.statusSteps.findIndex((step) => step.value === status);
  }

  fillWidth(percent: number): number {
    return Math.min(100, percent);
  }

  unitCost(line: { landedUnitEur: number }): number {
    return line.landedUnitEur;
  }

  async downloadPdf(): Promise<void> {
    const data = this.view();
    if (!data) return;
    const internal = this.privacy.showPurchase();
    const blob = await this.sourcing.purchasePdf(data.order.id, internal);
    saveBlob(blob, `${data.order.number}${internal ? '' : '-klantweergave'}.pdf`);
    this.ui.toast(internal
      ? 'Interne PDF gedownload — extra opbrengst als aparte regel'
      : 'Klantweergave gedownload — extra opbrengst zit in de stukprijs');
  }
}
