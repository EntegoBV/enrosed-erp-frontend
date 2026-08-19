import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { AuthImage } from '../../core/api/auth-image';
import { Category, Product } from '../../core/api/models';
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
      <section class="catalog-tools" aria-label="Producten zoeken en filteren">
        <div class="catalog-search">
          <label class="sr-only" for="catalog-search-input">Zoeken</label>
          <svg class="catalog-search__icon" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" />
          </svg>
          <input class="input catalog-search__input" id="catalog-search-input" type="search"
                 placeholder="Zoek naam, SKU, kleur of barcode…"
                 [ngModel]="query()" (ngModelChange)="query.set($event)" />
          @if (query()) {
            <button class="catalog-search__clear" type="button" aria-label="Zoekopdracht wissen"
                    (click)="query.set('')">×</button>
          }
        </div>

        <div class="filter-grid">
          <label class="filter-field">
            <span class="filter-field__label">Categorie</span>
            <select class="select filter-field__select" aria-label="Filter op categorie"
                    [ngModel]="categoryFilter()" (ngModelChange)="categoryFilter.set($event)">
              <option [ngValue]="null">Alle categorieën</option>
              @for (category of categories(); track category.id) {
                <option [ngValue]="category.id">{{ category.name }}</option>
              }
            </select>
          </label>

          <label class="filter-field">
            <span class="filter-field__label">Publicatie</span>
            <select class="select filter-field__select" aria-label="Filter op publicatiestatus"
                    [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event)">
              <option value="ALL">Alle statussen</option>
              <option value="NEEDS_WORK">Aandacht nodig</option>
              <option value="WEBSITE">Website live</option>
              <option value="ORDER_APP">Orderapp live</option>
              <option value="INACTIVE">Inactief</option>
            </select>
          </label>
        </div>

        <div class="filter-summary" aria-live="polite">
          <span><strong>{{ filtered().length }}</strong> van {{ products().length }} producten</span>
          @if (hasFilters()) {
            <button class="filter-reset" type="button" (click)="resetFilters()">Filters wissen</button>
          }
        </div>
      </section>

      <div class="card">
        <div class="list">
          @for (product of filtered(); track product.id) {
            <a class="list-item" [class.list-item--inactive]="!product.active"
               [routerLink]="['/products', product.id]">
              @if (product.photos.length) {
                <img class="thumb" [appAuthSrc]="product.photos[0].url" [alt]="product.name" />
              } @else {
                <div class="thumb thumb--placeholder">◈</div>
              }
              <div class="list-item__body">
                <div class="list-item__title-row">
                  <div class="list-item__title">{{ product.name }}</div>
                  @if (!product.active) {
                    <span class="master-chip master-chip--muted">inactief</span>
                  } @else if (product.publicationIssues?.length) {
                    <span class="master-chip master-chip--warn">
                      {{ product.publicationIssues.length }} aandacht
                    </span>
                  }
                </div>
                <div class="list-item__meta">
                  {{ product.sku }} · {{ sizeLabel(product) }}
                  @if (product.colour) { · {{ product.colour }} }
                </div>
                @if (product.active
                    && (product.websiteStatus === 'PUBLISHED' || product.orderAppStatus === 'PUBLISHED')) {
                  <div class="list-item__channels">
                    @if (product.websiteStatus === 'PUBLISHED') {
                      <span class="master-chip master-chip--live">Website</span>
                    }
                    @if (product.orderAppStatus === 'PUBLISHED') {
                      <span class="master-chip master-chip--live">Orderapp</span>
                    }
                  </div>
                }
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
  styles: `
    .catalog-tools {
      width: 100%; min-width: 0; margin-bottom: 14px; padding: 12px;
      border: 1px solid var(--line); border-radius: var(--r);
      background: color-mix(in srgb, var(--surface) 88%, var(--surface-2));
      box-shadow: 0 5px 18px rgb(31 25 22 / 4%);
    }
    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
    }
    .catalog-search { position: relative; display: block; min-width: 0; }
    .catalog-search__icon {
      position: absolute; z-index: 1; left: 13px; top: 50%; transform: translateY(-52%);
      width: 18px; height: 18px; color: var(--muted); fill: none; stroke: currentColor;
      stroke-width: 1.8; stroke-linecap: round; pointer-events: none;
    }
    .catalog-search__input { padding-left: 42px; padding-right: 42px; }
    .catalog-search__clear {
      position: absolute; right: 5px; top: 50%; transform: translateY(-50%);
      width: 36px; height: 36px; padding: 0; border: 0; border-radius: 50%;
      background: transparent; color: var(--muted); font-size: 24px; line-height: 1;
      cursor: pointer;
    }
    .catalog-search__clear:hover { background: var(--surface-2); color: var(--ink); }
    .filter-grid {
      display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 9px; min-width: 0; margin-top: 11px;
    }
    .filter-field { display: block; min-width: 0; }
    .filter-field__label {
      display: block; margin: 0 0 5px 2px; color: var(--muted);
      font-size: 10px; font-weight: 750; letter-spacing: .055em; text-transform: uppercase;
    }
    .filter-field__select {
      display: block; min-width: 0; max-width: 100%; min-height: 42px;
      padding: 9px 30px 9px 10px; font-size: 13px; font-weight: 650;
      text-overflow: ellipsis;
    }
    .filter-summary {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      min-width: 0; margin-top: 10px; color: var(--muted); font-size: 12px;
    }
    .filter-summary strong { color: var(--ink); font-variant-numeric: tabular-nums; }
    .filter-reset {
      flex: 0 0 auto; padding: 4px 0; border: 0; background: transparent;
      color: var(--rose-dark); font-size: 12px; font-weight: 700; cursor: pointer;
    }
    @media (min-width: 720px) {
      .catalog-tools {
        display: grid; grid-template-columns: minmax(260px, 1fr) minmax(340px, .8fr);
        column-gap: 12px; align-items: end;
      }
      .filter-grid { margin-top: 0; }
      .filter-summary { grid-column: 1 / -1; }
    }
    .list-item--inactive { opacity: .66; }
    .list-item__title-row { display: flex; align-items: center; gap: 7px; min-width: 0; }
    .list-item__title-row .list-item__title { min-width: 0; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap; }
    .list-item__channels { display: flex; gap: 5px; margin-top: 3px; }
    .master-chip { flex: 0 0 auto; display: inline-flex; align-items: center; min-height: 18px;
      padding: 1px 6px; border-radius: 999px; font-size: 9px; font-weight: 750;
      letter-spacing: .03em; text-transform: uppercase; }
    .master-chip--live { color: var(--ok); background: var(--ok-soft); }
    .master-chip--warn { color: var(--warn); background: var(--warn-soft); }
    .master-chip--muted { color: var(--muted); background: var(--surface-2); border: 1px solid var(--line); }
  `,
})
export class ProductList {
  private readonly catalog = inject(CatalogApi);
  readonly privacy = inject(Privacy);

  readonly query = signal('');
  readonly categoryFilter = signal<number | null>(null);
  readonly statusFilter = signal<'ALL' | 'NEEDS_WORK' | 'WEBSITE' | 'ORDER_APP' | 'INACTIVE'>('ALL');
  readonly loading = signal(true);

  readonly products = signal<Product[]>([]);
  readonly categories = signal<Category[]>([]);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const [products, categories] = await Promise.all([
      this.catalog.products(),
      this.catalog.categories(),
    ]);
    this.products.set(products);
    this.categories.set(categories);
    this.loading.set(false);
  }

  readonly filtered = computed(() => {
    const needle = this.query().toLowerCase().trim();
    const category = this.categoryFilter();
    const status = this.statusFilter();
    return this.products().filter((product) => {
      if (category !== null && product.categoryId !== category) return false;
      if (status === 'NEEDS_WORK' && (!product.active || !product.publicationIssues?.length)) return false;
      if (status === 'WEBSITE'
          && (!product.active || product.websiteStatus !== 'PUBLISHED')) return false;
      if (status === 'ORDER_APP'
          && (!product.active || product.orderAppStatus !== 'PUBLISHED')) return false;
      if (status === 'INACTIVE' && product.active) return false;
      if (!needle) return true;
      return [
        product.sku, product.name, product.colour,
        product.barcodeInner, product.barcodeOuter, product.hsCode,
      ].join(' ').toLowerCase().includes(needle);
    });
  });

  readonly hasFilters = computed(() =>
    this.query().trim().length > 0 || this.categoryFilter() !== null || this.statusFilter() !== 'ALL',
  );

  resetFilters(): void {
    this.query.set('');
    this.categoryFilter.set(null);
    this.statusFilter.set('ALL');
  }

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
