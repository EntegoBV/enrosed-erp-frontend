import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { AuthImage } from '../../core/api/auth-image';
import { Category, Product, ProductFamily } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { EurPipe, NumPipe } from '../../shared/pipes';
import { escapeHtml, Ui } from '../../shared/ui';
import { messageOf } from '../../core/api/errors';

interface ProductSwipe {
  pointerId: number;
  productId: number;
  startX: number;
  startY: number;
  startOffset: number;
  horizontal: boolean;
  row: HTMLElement;
}

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
                    [disabled]="familyLoading() || familyLoadError()"
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
        @if (familyLoadError()) {
          <div class="family-load-warning" role="alert">
            <span>Publicatiestatus en varianten zijn niet geladen.</span>
            <button type="button" [disabled]="familyLoading()" (click)="retryFamilies()">
              {{ familyLoading() ? 'Laden…' : 'Opnieuw proberen' }}
            </button>
          </div>
        }
      </section>

      <p class="product-swipe-hint">
        <span aria-hidden="true">←</span>
        Sleep een product naar links voor verwijderen
      </p>

      <div class="card">
        <div class="list">
          @for (product of filtered(); track product.id) {
            <div class="swipe"
                 [class.swipe--open]="swiped() === product.id"
                 [class.swipe--dragging]="draggingProductId() === product.id"
                 [style.--swipe-offset]="draggingProductId() === product.id
                   ? swipeOffset() + 'px' : null">
            <a class="list-item swipe__row" [class.list-item--inactive]="!product.active"
               [routerLink]="['/products', product.id]"
               (pointerdown)="startSwipe($event, product)"
               (pointermove)="moveSwipe($event, product)"
               (pointerup)="finishSwipe($event)"
               (pointercancel)="cancelSwipe($event)"
               (dragstart)="$event.preventDefault()"
               (click)="blockWhenSwiped($event, product.id)">
              @if (product.photos.length) {
                <img class="thumb" [appAuthSrc]="product.photos[0].url" [alt]="product.name"
                     draggable="false" />
              } @else {
                <div class="thumb thumb--placeholder">◈</div>
              }
              <div class="list-item__body">
                <div class="product-row__primary">
                  <div class="product-row__title">
                    <strong>{{ product.name }}</strong>
                    @if (variantLabel(product); as variant) {
                      <span>· {{ variant }}</span>
                    }
                  </div>
                  <div class="product-row__badges">
                    @if (familyFor(product); as family) {
                      @if (family.variantCount > 1) {
                        <span class="master-chip master-chip--variant">
                          {{ family.variantCount }} varianten
                        </span>
                      }
                    }
                    @if (attentionLabel(product); as attention) {
                      <span class="master-chip"
                            [class.master-chip--muted]="!product.active"
                            [class.master-chip--warn]="product.active">
                        {{ attention }}
                      </span>
                    }
                  </div>
                </div>
                <div class="product-row__facts">
                  <span class="mono">{{ product.sku || 'Geen SKU' }}</span>
                  @if (product.inventoryKnown) {
                    <span [class.warn-text]="product.stockQuantity <= 0">
                      {{ product.stockQuantity | num }} op voorraad
                    </span>
                  } @else {
                    <span>Voorraad onbekend</span>
                  }
                  <span>{{ product.carton.piecesPerCarton | num }} st/doos</span>
                  <span>{{ sizeLabel(product) }}</span>
                </div>
              </div>
              <div class="list-item__end">
                @if (salesPrice(product); as price) {
                  <div class="strong num">{{ price | eur }}</div>
                } @else {
                  <div class="strong muted">—</div>
                }
              </div>
              <span class="list-item__chev">›</span>
            </a>
            <button class="swipe__delete" type="button"
                    [disabled]="deleting() !== null"
                    [attr.aria-label]="'Product ' + product.name + ' verwijderen'"
                    [attr.title]="'Product verwijderen'"
                    (focus)="revealDelete(product.id)"
                    (keydown.escape)="closeDelete($event)"
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
    .family-load-warning {
      grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center;
      justify-content: space-between; gap: 7px 12px; margin-top: 9px; padding: 8px 10px;
      border: 1px solid #eddcb9; border-radius: 10px; background: var(--warn-soft);
      color: var(--ink-2); font-size: 11px;
    }
    .family-load-warning button {
      padding: 3px 0; border: 0; background: transparent; color: var(--rose-dark);
      font-size: 11px; font-weight: 750; cursor: pointer;
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
    .product-row__primary {
      display: flex; min-width: 0; flex-wrap: wrap; align-items: center;
      justify-content: space-between; gap: 4px 8px;
    }
    .product-row__title { display: flex; min-width: 0; align-items: baseline; gap: 4px; }
    .product-row__title strong { overflow: hidden; min-width: 0; font-size: 13.5px;
      text-overflow: ellipsis; white-space: nowrap; }
    .product-row__title span { flex: 0 1 auto; overflow: hidden; color: var(--muted);
      font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
    .product-row__badges { display: flex; flex: 0 0 auto; gap: 4px; }
    .product-row__facts { display: flex; min-width: 0; flex-wrap: wrap; gap: 2px 0;
      margin-top: 4px; color: var(--muted); font-size: 10.5px; line-height: 1.35; }
    .product-row__facts span + span::before { margin: 0 6px; color: var(--muted-2); content: '·'; }
    .swipe--dragging { user-select: none; }
    .swipe--dragging .swipe__row {
      transform: translateX(var(--swipe-offset, 0px)); transition: none; cursor: grabbing;
    }
    .master-chip { flex: 0 0 auto; display: inline-flex; align-items: center; min-height: 18px;
      padding: 1px 6px; border-radius: 999px; font-size: 9px; font-weight: 750;
      letter-spacing: .03em; text-transform: uppercase; }
    .master-chip--variant { color: var(--ink-2); background: var(--surface-2); }
    .master-chip--warn { color: var(--warn); background: var(--warn-soft); }
    .master-chip--muted { color: var(--muted); background: var(--surface-2); border: 1px solid var(--line); }
  `,
})
export class ProductList {
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);

  readonly query = signal('');
  readonly categoryFilter = signal<number | null>(null);
  readonly statusFilter = signal<'ALL' | 'NEEDS_WORK' | 'WEBSITE' | 'ORDER_APP' | 'INACTIVE'>('ALL');
  readonly loading = signal(true);
  readonly deleting = signal<number | null>(null);
  readonly swiped = signal<number | null>(null);
  readonly draggingProductId = signal<number | null>(null);
  readonly swipeOffset = signal(0);

  private pointerSwipe: ProductSwipe | null = null;
  private swipeHandled = false;
  private swipeResetTimer: ReturnType<typeof setTimeout> | null = null;

  readonly products = signal<Product[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly families = signal<ProductFamily[]>([]);
  readonly familyLoading = signal(true);
  readonly familyLoadError = signal(false);
  private readonly familyMap = computed(() =>
    new Map(this.families().filter((family) => family.id !== null)
      .map((family) => [family.id!, family])));

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const familyRequest = this.loadFamilies();
    const [products, categories] = await Promise.all([
      this.catalog.products(),
      this.catalog.categories(),
    ]);
    this.products.set(products);
    this.categories.set(categories);
    this.loading.set(false);
    await familyRequest;
  }

  async retryFamilies(): Promise<void> {
    if (!this.familyLoading()) await this.loadFamilies();
  }

  private async loadFamilies(): Promise<void> {
    this.familyLoading.set(true);
    this.familyLoadError.set(false);
    try {
      this.families.set(await this.catalog.productFamilies());
    } catch {
      this.families.set([]);
      this.familyLoadError.set(true);
      this.statusFilter.set('ALL');
    } finally {
      this.familyLoading.set(false);
    }
  }

  readonly filtered = computed(() => {
    const needle = this.query().toLowerCase().trim();
    const category = this.categoryFilter();
    const status = this.familyLoadError() ? 'ALL' : this.statusFilter();
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
    this.query().trim().length > 0 || this.categoryFilter() !== null
      || (!this.familyLoadError() && this.statusFilter() !== 'ALL'),
  );

  resetFilters(): void {
    this.query.set('');
    this.categoryFilter.set(null);
    this.statusFilter.set('ALL');
  }

  startSwipe(event: PointerEvent, product: Product): void {
    if (product.id === null || !event.isPrimary || event.button !== 0
        || this.deleting() !== null) return;
    if (this.swipeResetTimer !== null) clearTimeout(this.swipeResetTimer);
    this.swipeHandled = false;
    if (this.swiped() !== null && this.swiped() !== product.id) this.swiped.set(null);
    const row = event.currentTarget as HTMLElement;
    this.pointerSwipe = {
      pointerId: event.pointerId,
      productId: product.id,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: this.swiped() === product.id ? -76 : 0,
      horizontal: false,
      row,
    };
    try {
      row.setPointerCapture(event.pointerId);
    } catch {
      this.pointerSwipe = null;
    }
  }

  moveSwipe(event: PointerEvent, product: Product): void {
    const active = this.pointerSwipe;
    if (!active || active.pointerId !== event.pointerId || active.productId !== product.id
        || this.deleting() !== null) return;
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (!active.horizontal) {
      if (Math.hypot(dx, dy) < 8) return;
      if (Math.abs(dx) <= Math.abs(dy) * 1.2) return;
      active.horizontal = true;
      this.swipeHandled = true;
      this.draggingProductId.set(active.productId);
    }
    event.preventDefault();
    event.stopPropagation();
    this.swipeOffset.set(Math.max(-76, Math.min(0, active.startOffset + dx)));
  }

  finishSwipe(event: PointerEvent): void {
    const active = this.pointerSwipe;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.horizontal) {
      event.preventDefault();
      event.stopPropagation();
      this.swiped.set(this.swipeOffset() <= -38 ? active.productId : null);
      this.deferSwipeClickRelease();
    }
    this.releaseSwipePointer(active);
    this.resetPointerSwipe();
  }

  cancelSwipe(event: PointerEvent): void {
    const active = this.pointerSwipe;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.horizontal) this.deferSwipeClickRelease();
    else this.swipeHandled = false;
    this.releaseSwipePointer(active);
    this.resetPointerSwipe();
  }

  blockWhenSwiped(event: Event, productId: number | null): void {
    if (this.swiped() === productId || this.swipeHandled) {
      event.preventDefault();
      event.stopPropagation();
      if (!this.swipeHandled) this.swiped.set(null);
    }
  }

  revealDelete(productId: number | null): void {
    if (productId !== null && this.deleting() === null) this.swiped.set(productId);
  }

  closeDelete(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.swiped.set(null);
    (event.currentTarget as HTMLElement).closest('.swipe')
      ?.querySelector<HTMLElement>('.swipe__row')?.focus();
  }

  private deferSwipeClickRelease(): void {
    if (this.swipeResetTimer !== null) clearTimeout(this.swipeResetTimer);
    this.swipeResetTimer = setTimeout(() => {
      this.swipeHandled = false;
      this.swipeResetTimer = null;
    }, 400);
  }

  private releaseSwipePointer(active: ProductSwipe): void {
    try {
      if (active.row.hasPointerCapture(active.pointerId)) {
        active.row.releasePointerCapture(active.pointerId);
      }
    } catch {
      /* A cancelled pointer has already been released by the browser. */
    }
  }

  private resetPointerSwipe(): void {
    this.pointerSwipe = null;
    this.draggingProductId.set(null);
    this.swipeOffset.set(0);
  }

  remove(product: Product): void {
    if (product.id === null || this.deleting() !== null) return;
    const productId = product.id;
    const family = this.familyFor(product);
    const familyMessage = family === null
      ? ''
      : family.variantCount > 1
        ? ' Alleen dit product/SKU wordt verwijderd; het model en de andere producten blijven bestaan.'
        : ' De gedeelde websitegegevens blijven bewaard, maar worden zonder product niet gepubliceerd.';
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

  variantLabel(product: Product): string | null {
    const parts = [product.colour, product.variantSize]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));
    return parts.length ? parts.join(' · ') : null;
  }

  attentionLabel(product: Product): string | null {
    if (!product.active) return 'Inactief';
    if (this.familyLoading() || this.familyLoadError()) return null;
    const issueCount = this.publicationIssues(product).length;
    return issueCount ? `${issueCount} aandacht` : null;
  }

  familyFor(product: Product): ProductFamily | null {
    return product.familyId == null ? null : this.familyMap().get(product.familyId) ?? null;
  }

  publicationIssues(product: Product): string[] {
    if (this.familyLoading() || this.familyLoadError()) return [];
    const family = this.familyFor(product);
    if (family) return family.publicationIssues;
    if (product.websiteStatus === 'DRAFT' && product.orderAppStatus === 'DRAFT') return [];
    return product.publicationIssues ?? [];
  }

  websiteStatus(product: Product): Product['websiteStatus'] {
    return this.familyFor(product)?.websiteStatus ?? 'DRAFT';
  }

  orderAppStatus(product: Product): Product['orderAppStatus'] {
    return this.familyFor(product)?.orderAppStatus ?? 'DRAFT';
  }

  publicationActive(product: Product): boolean {
    return product.active && (this.familyFor(product)?.active ?? false);
  }
}

function dimension(value: number | null): string {
  return value !== null && value > 0 ? String(value) : '—';
}
