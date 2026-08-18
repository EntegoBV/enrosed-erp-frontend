import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { AuthImage } from '../../core/api/auth-image';
import { Category, Product, Supplier } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { Privacy } from '../../core/api/privacy';
import { EurPipe, NumPipe, PctPipe } from '../../shared/pipes';

@Component({
  selector: 'app-product-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, RouterLink, FormsModule, AuthImage, PageHeader, EurPipe, NumPipe, PctPipe],
  template: `
    <app-page-header title="Catalogus" [subtitle]="products().length + ' producten'">
      <a class="btn btn--sm" routerLink="/catalog-export">Catalogus PDF</a>
      <a class="btn btn--primary btn--sm hide-mobile" routerLink="/products/new">+ Nieuw</a>
    </app-page-header>

    <div class="content">
      <div class="search-bar">
        <input class="input" type="search" placeholder="Zoek op naam, SKU, kleur of barcode…"
               [ngModel]="query()" (ngModelChange)="query.set($event)" />
      </div>

      <div class="chips">
        <button class="chip" type="button" [class.active]="categoryFilter() === null"
                (click)="categoryFilter.set(null)">Alle</button>
        @for (category of categories(); track category.id) {
          <button class="chip" type="button" [class.active]="categoryFilter() === category.id"
                  (click)="categoryFilter.set(category.id)">{{ category.name }}</button>
        }
      </div>

      <div class="card">
        <div class="list">
          @for (product of filtered(); track product.id) {
            <a class="list-item" [routerLink]="['/products', product.id]">
              @if (product.photos.length) {
                <img class="thumb" [appAuthSrc]="product.photos[0].url" [alt]="product.name" />
              } @else {
                <div class="thumb thumb--placeholder">◈</div>
              }
              <div class="list-item__body">
                <div class="list-item__title">{{ product.name }}</div>
                <div class="list-item__meta">
                  {{ product.sku }} · {{ sizeLabel(product) }}
                  @if (product.colour) { · {{ product.colour }} }
                </div>
                <div class="list-item__meta">
                  <span [class.warn-text]="product.stockQuantity <= 0">
                    voorraad {{ product.stockQuantity | num }}
                  </span>
                  @if (privacy.showPurchase()) {
                    @if (product.landedCostEur) {
                      · inkoop {{ product.landedCostEur | eur: 2 }} · opslag
                      {{ product.markupPct | pct: 0 }}
                    } @else {
                      · <span class="warn-text">nog geen kostprijs</span>
                    }
                  }
                </div>
              </div>
              <div class="list-item__end">
                <div class="strong num">{{ salesPrice(product) | eur }}</div>
                <div class="tiny muted">
                  {{ product.carton.piecesPerCarton | num }}/doos
                  @if (product.photos.length > 1) { · {{ product.photos.length }} foto's }
                </div>
              </div>
              <span class="list-item__chev">›</span>
            </a>
          } @empty {
            @if (loading()) {
              <app-skeleton kind="list" [rows]="6" />
            } @else {
              <div class="empty">
                <div class="empty__icon">◈</div>
                <div class="empty__title">Geen producten gevonden</div>
                <a class="btn btn--primary" routerLink="/products/new">Product toevoegen</a>
              </div>
            }
          }
        </div>
      </div>
    </div>

    <a class="fab" routerLink="/products/new">+ Product</a>
  `,
})
export class ProductList {
  private readonly catalog = inject(CatalogApi);
  private readonly sourcing = inject(SourcingApi);
  readonly privacy = inject(Privacy);

  readonly query = signal('');
  readonly categoryFilter = signal<number | null>(null);
  readonly loading = signal(true);

  readonly products = signal<Product[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly suppliers = signal<Supplier[]>([]);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const [products, categories, suppliers] = await Promise.all([
      this.catalog.products(),
      this.catalog.categories(),
      this.sourcing.suppliers(),
    ]);
    this.products.set(products);
    this.categories.set(categories);
    this.suppliers.set(suppliers);
    this.loading.set(false);
  }

  readonly filtered = computed(() => {
    const needle = this.query().toLowerCase().trim();
    const category = this.categoryFilter();
    return this.products().filter((product) => {
      if (category !== null && product.categoryId !== category) return false;
      if (!needle) return true;
      return [
        product.sku, product.name, product.colour,
        product.barcodeInner, product.barcodeOuter, product.hsCode,
      ].join(' ').toLowerCase().includes(needle);
    });
  });

  sizeLabel(product: Product): string {
    const { lengthCm, widthCm, heightCm } = product.dimensions;
    if (!lengthCm && !widthCm && !heightCm) return 'geen afmeting';
    return `${trim(lengthCm)} × ${trim(widthCm)} × ${trim(heightCm)} cm`;
  }

  /** The server only prices the catalogue on an order; here we show the markup. */
  salesPrice(product: Product): number {
    if (product.fixedSalesPriceEur) return product.fixedSalesPriceEur;
    const cost = product.landedCostEur ?? 0;
    return Math.round(cost * (1 + (product.markupPct ?? 0) / 100) * 100) / 100;
  }
}

function trim(value: number | null): string {
  return value === null ? '0' : String(value);
}
