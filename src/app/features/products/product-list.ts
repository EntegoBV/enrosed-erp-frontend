import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { AuthImage } from '../../core/api/auth-image';
import { Category, Product, ProductFamily } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { Privacy } from '../../core/api/privacy';
import { EurPipe, NumPipe } from '../../shared/pipes';
import { escapeHtml, Ui } from '../../shared/ui';
import { messageOf } from '../../core/api/errors';

@Component({
  selector: 'app-product-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, RouterLink, FormsModule, AuthImage, PageHeader, EurPipe, NumPipe],
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
            <div class="swipe swipe--desktop-action"
                 [class.swipe--open]="swiped() === product.id">
            <a class="list-item swipe__row" [class.list-item--inactive]="!product.active"
               [routerLink]="['/products', product.id]"
               (touchstart)="swipeStart($event, product)"
               (touchmove)="swipeMove($event, product)"
               (touchend)="swipeEnd()"
               (touchcancel)="swipeEnd(true)"
               (click)="blockWhenSwiped($event, product.id)">
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
                  } @else if (publicationIssues(product).length) {
                    <span class="master-chip master-chip--warn">
                      {{ publicationIssues(product).length }} aandacht
                    </span>
                  }
                </div>
                <div class="list-item__meta">
                  {{ product.sku }} · {{ sizeLabel(product) }}
                  @if (product.colour) { · {{ product.colour }} }
                  @if (product.variantSize) { · {{ product.variantSize }} }
                </div>
                @if (familyFor(product); as family) {
                  <div class="list-item__family">
                    <span>{{ family.name || family.familyKey }}</span>
                    <small>{{ family.variantCount }} variant(en)</small>
                  </div>
                }
                @if (publicationActive(product)
                    && (websiteStatus(product) === 'PUBLISHED' || orderAppStatus(product) === 'PUBLISHED')) {
                  <div class="list-item__channels">
                    @if (websiteStatus(product) === 'PUBLISHED') {
                      <span class="master-chip master-chip--live">Website</span>
                    }
                    @if (orderAppStatus(product) === 'PUBLISHED') {
                      <span class="master-chip master-chip--live">Orderapp</span>
                    }
                  </div>
                }
                <div class="list-item__meta">
                  @if (product.inventoryKnown) {
                    <span [class.warn-text]="product.stockQuantity <= 0">
                      voorraad {{ product.stockQuantity | num }}
                    </span>
                  } @else {
                    <span>voorraad onbekend</span>
                  }
                </div>
                @if (privacy.showPurchase()) {
                  <div class="list-item__pricing" aria-label="Interne prijsinformatie">
                    <span class="master-chip master-chip--internal">intern</span>
                    <span>{{ pricingStrategyLabel(product) }}</span>
                    @if (unitMargin(product); as margin) {
                      <span class="num" [class.warn-text]="margin.eur < 0">
                        Marge {{ margin.eur | eur: 2 }}/stuk
                      </span>
                    } @else {
                      <span class="warn-text">Marge niet beschikbaar</span>
                    }
                  </div>
                }
              </div>
              <div class="list-item__end">
                @if (salesPrice(product); as price) {
                  <div class="strong num">{{ price | eur }}</div>
                } @else {
                  <div class="strong muted">—</div>
                }
                <div class="tiny muted">
                  {{ product.carton.piecesPerCarton | num }}/doos
                  @if (product.photos.length > 1) { · {{ product.photos.length }} foto's }
                </div>
              </div>
              <span class="list-item__chev">›</span>
            </a>
            <button class="swipe__delete" type="button"
                    [disabled]="deleting() !== null"
                    [attr.aria-label]="'Product ' + product.name + ' verwijderen'"
                    [attr.title]="'Product verwijderen'"
                    (click)="remove(product)">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
                   stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
                   stroke-linejoin="round" aria-hidden="true" focusable="false">
                <path d="M4 7h16" /><path d="M9 7V5h6v2" />
                <path d="M6.5 7l1 13h9l1-13" /><path d="M10 11v6" /><path d="M14 11v6" />
              </svg>
            </button>
            </div>
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
    .list-item__family { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 7px;
      margin-top: 3px; color: var(--ink-2); font-size: 10.5px; }
    .list-item__family small { padding-left: 7px; border-left: 1px solid var(--line);
      color: var(--muted); font-size: 9.5px; }
    .list-item__pricing {
      display: flex; flex-wrap: wrap; align-items: center; gap: 4px 7px;
      margin-top: 4px; color: var(--muted); font-size: 10.5px; line-height: 1.35;
    }
    .list-item__pricing > span:not(:first-child) { padding-left: 7px; border-left: 1px solid var(--line); }
    .master-chip { flex: 0 0 auto; display: inline-flex; align-items: center; min-height: 18px;
      padding: 1px 6px; border-radius: 999px; font-size: 9px; font-weight: 750;
      letter-spacing: .03em; text-transform: uppercase; }
    .master-chip--live { color: var(--ok); background: var(--ok-soft); }
    .master-chip--warn { color: var(--warn); background: var(--warn-soft); }
    .master-chip--internal { color: var(--warn); background: var(--warn-soft); }
    .master-chip--muted { color: var(--muted); background: var(--surface-2); border: 1px solid var(--line); }
  `,
})
export class ProductList {
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);
  readonly privacy = inject(Privacy);

  readonly query = signal('');
  readonly categoryFilter = signal<number | null>(null);
  readonly statusFilter = signal<'ALL' | 'NEEDS_WORK' | 'WEBSITE' | 'ORDER_APP' | 'INACTIVE'>('ALL');
  readonly loading = signal(true);
  readonly deleting = signal<number | null>(null);
  readonly swiped = signal<number | null>(null);

  private touchX = 0;
  private touchY = 0;
  private swipeHandled = false;
  private swipeResetTimer: ReturnType<typeof setTimeout> | null = null;

  readonly products = signal<Product[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly families = signal<ProductFamily[]>([]);
  private readonly familyMap = computed(() =>
    new Map(this.families().filter((family) => family.id !== null)
      .map((family) => [family.id!, family])));

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const [products, categories, families] = await Promise.all([
      this.catalog.products(),
      this.catalog.categories(),
      this.catalog.productFamilies().catch(() => []),
    ]);
    this.products.set(products);
    this.categories.set(categories);
    this.families.set(families);
    this.loading.set(false);
  }

  readonly filtered = computed(() => {
    const needle = this.query().toLowerCase().trim();
    const category = this.categoryFilter();
    const status = this.statusFilter();
    return this.products().filter((product) => {
      if (category !== null && product.categoryId !== category) return false;
      if (status === 'NEEDS_WORK' && (!product.active || !this.publicationIssues(product).length)) return false;
      if (status === 'WEBSITE'
          && (!this.publicationActive(product) || this.websiteStatus(product) !== 'PUBLISHED')) return false;
      if (status === 'ORDER_APP'
          && (!this.publicationActive(product) || this.orderAppStatus(product) !== 'PUBLISHED')) return false;
      if (status === 'INACTIVE' && product.active) return false;
      if (!needle) return true;
      return [
        product.sku, product.name, product.colour, product.variantSize,
        product.barcodeInner, product.barcodeOuter, product.hsCode,
        this.familyFor(product)?.name, this.familyFor(product)?.familyKey,
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

  swipeStart(event: TouchEvent, product: Product): void {
    if (product.id === null || event.touches.length !== 1 || this.deleting() !== null) return;
    if (this.swipeResetTimer !== null) clearTimeout(this.swipeResetTimer);
    this.touchX = event.touches[0].clientX;
    this.touchY = event.touches[0].clientY;
    this.swipeHandled = false;
    if (this.swiped() !== null && this.swiped() !== product.id) this.swiped.set(null);
  }

  swipeMove(event: TouchEvent, product: Product): void {
    if (product.id === null || event.touches.length !== 1 || this.swipeHandled
        || this.deleting() !== null) return;
    const dx = event.touches[0].clientX - this.touchX;
    const dy = event.touches[0].clientY - this.touchY;
    if (Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < -140) {
      this.swipeHandled = true;
      this.remove(product);
      return;
    }
    if (dx < -24) {
      this.swiped.set(product.id);
      return;
    }
    if (dx > 24) {
      this.swipeHandled = true;
      this.swiped.set(null);
    }
  }

  swipeEnd(cancelled = false): void {
    if (cancelled) {
      this.swipeHandled = false;
      this.swiped.set(null);
      return;
    }
    if (this.swipeHandled) {
      /* Keep the synthetic click after touchend from opening the row, then
         release the guard so a cancelled confirmation never leaves it stuck. */
      this.swipeResetTimer = setTimeout(() => {
        this.swipeHandled = false;
        this.swipeResetTimer = null;
      }, 400);
    }
  }

  blockWhenSwiped(event: Event, productId: number | null): void {
    if (this.swiped() === productId || this.swipeHandled) {
      event.preventDefault();
      event.stopPropagation();
      if (!this.swipeHandled) this.swiped.set(null);
    }
  }

  remove(product: Product): void {
    if (product.id === null || this.deleting() !== null) return;
    const productId = product.id;
    const family = this.familyFor(product);
    const familyMessage = family === null
      ? ''
      : family.variantCount > 1
        ? ' Alleen deze kleurvariant/SKU wordt verwijderd; de familie en andere kleuren blijven bestaan.'
        : ' De websitefamilie en haar content blijven bewaard, maar worden zonder variant niet gepubliceerd.';
    const historyMessage = ' Staat dit product al op een order of offerte, dan blijft het bewaard en kun je het alleen inactief zetten.';
    this.swiped.set(null);
    this.ui.confirm(
      {
        title: 'Product verwijderen',
        message: `<b>${escapeHtml(product.name)}</b> verwijderen?${familyMessage}${historyMessage}`,
        confirmLabel: 'Verwijderen',
        danger: true,
      },
      async () => {
        this.deleting.set(productId);
        try {
          await this.catalog.deleteProduct(productId);
          this.products.update((products) => products.filter((item) => item.id !== productId));
          if (family?.id !== null && family?.id !== undefined) {
            this.families.update((families) => families.map((item) => item.id === family.id
              ? { ...item, variantCount: Math.max(0, item.variantCount - 1) }
              : item));
          }
          this.ui.toast('Product verwijderd');
        } catch (failure: unknown) {
          this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
        } finally {
          this.deleting.set(null);
        }
      },
    );
  }

  sizeLabel(product: Product): string {
    const { lengthCm, widthCm, heightCm } = product.dimensions;
    if (!lengthCm && !widthCm && !heightCm) return 'geen afmeting';
    return `B × D × H ${dimension(lengthCm)} × ${dimension(widthCm)} × ${dimension(heightCm)} cm`;
  }

  /** The active price strategy is calculated once by the backend. */
  salesPrice(product: Product): number | null {
    return product.computedSalesPriceEur > 0 ? product.computedSalesPriceEur : null;
  }

  pricingStrategyLabel(product: Product): string {
    return this.hasFixedSalesPrice(product)
      ? 'Vaste verkoopprijs'
      : `${product.markupPct ?? 0} % opslag op kostprijs`;
  }

  unitMargin(product: Product): { eur: number } | null {
    const landedCost = product.landedCostEur;
    if (landedCost === null || landedCost <= 0) return null;
    const price = this.salesPrice(product);
    if (price === null) return null;
    return { eur: Math.round((price - landedCost) * 100) / 100 };
  }

  familyFor(product: Product): ProductFamily | null {
    if (product.familyId != null) return this.familyMap().get(product.familyId) ?? null;
    return product.familyKey
      ? this.families().find((family) => family.familyKey === product.familyKey) ?? null
      : null;
  }

  publicationIssues(product: Product): string[] {
    return this.familyFor(product)?.publicationIssues ?? product.publicationIssues ?? [];
  }

  websiteStatus(product: Product): Product['websiteStatus'] {
    return this.familyFor(product)?.websiteStatus ?? product.websiteStatus;
  }

  orderAppStatus(product: Product): Product['orderAppStatus'] {
    return this.familyFor(product)?.orderAppStatus ?? product.orderAppStatus;
  }

  publicationActive(product: Product): boolean {
    return product.active && (this.familyFor(product)?.active ?? true);
  }

  private hasFixedSalesPrice(product: Product): boolean {
    return product.fixedSalesPriceEur !== null && product.fixedSalesPriceEur > 0;
  }
}

function dimension(value: number | null): string {
  return value !== null && value > 0 ? String(value) : '—';
}
