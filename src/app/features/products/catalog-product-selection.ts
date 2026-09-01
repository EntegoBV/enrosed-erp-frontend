import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthImage } from '../../core/api/auth-image';
import { Category, Product } from '../../core/api/models';
import { Skeleton } from '../../shared/skeleton';
import { deselectProductIds, selectProductIds } from './catalog-product-selection-state';

@Component({
  selector: 'app-catalog-product-selection',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, FormsModule, Skeleton],
  template: `
    <section class="card product-selector" aria-labelledby="catalog-products-title">
      <div class="card__head product-selector__head">
        <div>
          <h2 id="catalog-products-title">Assortiment</h2>
          <p>{{ selectedProductCount() }} van {{ selectableIds().length }} producten opgenomen</p>
        </div>
      </div>

      <div class="selection-actions">
        <div class="selection-actions__group" role="group" aria-label="Selectie voor volledig assortiment">
          <small>Volledig assortiment</small>
          <span>
            <button class="btn btn--sm" type="button"
                    [disabled]="disabled() || allSelected()"
                    (click)="selectAll()">Alles selecteren</button>
            <button class="btn btn--sm" type="button"
                    [disabled]="disabled() || !selectedProductCount()"
                    (click)="clearAll()">Alles deselecteren</button>
          </span>
        </div>
        <div class="selection-actions__group" role="group" aria-label="Selectie binnen huidig filter">
          <small>Huidig filter</small>
          <span>
            <button class="btn btn--sm" type="button"
                    [disabled]="disabled() || !visibleProducts().length || visibleAllSelected()"
                    (click)="selectVisible()">Zichtbare selecteren</button>
            <button class="btn btn--sm" type="button"
                    [disabled]="disabled() || !visibleSelectedCount()"
                    (click)="clearVisible()">Zichtbare deselecteren</button>
          </span>
        </div>
      </div>

      <div class="selection-tools">
        <label class="product-search">
          <span class="sr-only">Producten zoeken</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>
          </svg>
          <input class="input" type="search" [ngModel]="query()"
                 [disabled]="disabled()"
                 (ngModelChange)="query.set($event)"
                 placeholder="Zoek naam, SKU, kleur of barcode…" />
        </label>
        <label class="selected-only">
          <input type="checkbox" [ngModel]="selectedOnly()"
                 [disabled]="disabled()"
                 (ngModelChange)="selectedOnly.set($event)" />
          Alleen opgenomen
        </label>
      </div>

      <div class="chips category-chips" aria-label="Filter producten op categorie">
        <button class="chip" type="button" [class.active]="categoryFilter() === null"
                [attr.aria-pressed]="categoryFilter() === null"
                [disabled]="disabled()"
                (click)="categoryFilter.set(null)">Alle</button>
        @for (category of categories(); track category.id) {
          <button class="chip" type="button"
                  [class.active]="categoryFilter() === category.id"
                  [attr.aria-pressed]="categoryFilter() === category.id"
                  [disabled]="disabled()"
                  (click)="categoryFilter.set(category.id)">{{ category.name }}</button>
        }
      </div>

      <div class="selection-summary" aria-live="polite">
        <span>{{ visibleProducts().length }} zichtbaar</span>
        <span>{{ visibleSelectedCount() }} daarvan gekozen</span>
      </div>

      @if (loadError()) {
        <div class="load-state load-state--error" role="alert">
          <div><b>Producten konden niet worden geladen</b><small>{{ loadError() }}</small></div>
          <button class="btn btn--sm" type="button" [disabled]="disabled() || loading()"
                  (click)="retry.emit()">{{ loading() ? 'Laden…' : 'Opnieuw proberen' }}</button>
        </div>
      } @else if (loading()) {
        <div class="load-state" role="status">
          <app-skeleton kind="list" [rows]="6" />
        </div>
      } @else {
        <div class="product-choice-list">
          @for (product of visibleProducts(); track product.id) {
            <label class="product-choice" [class.product-choice--selected]="isSelected(product)">
              <input type="checkbox" [checked]="isSelected(product)"
                     [disabled]="disabled()"
                     [attr.aria-label]="product.name + ' opnemen'"
                     (change)="toggle(product.id)" />
              @if (product.photos[0]; as photo) {
                <img [appAuthSrc]="photo.url" [alt]="product.name" />
              } @else {
                <span class="product-choice__empty" aria-hidden="true">◇</span>
              }
              <span class="product-choice__copy">
                <b>{{ product.name }}</b>
                <small>{{ productMeta(product) }}</small>
              </span>
              @if (showReferencePrices()) {
                <span class="product-choice__price"
                      [class.product-choice__price--missing]="!hasReferencePrice(product)">
                  <small>Referentieprijs</small>
                  <b>{{ referencePrice(product) }}</b>
                  <i>per stuk</i>
                </span>
              } @else if (product.colourHex) {
                <i class="colour-dot" [style.backgroundColor]="product.colourHex"
                   aria-hidden="true"></i>
              }
            </label>
          } @empty {
            <div class="load-state">
              <div>
                <b>Geen producten in deze selectie</b>
                <small>Pas je zoekopdracht of filters aan.</small>
              </div>
            </div>
          }
        </div>
      }
    </section>
  `,
  styles: `
    :host { display: block; min-width: 0; container: product-selector / inline-size; }
    .card__head > div { min-width: 0; }
    .card__head p { margin-top: 4px; color: var(--muted); font-size: 14px; line-height: 1.45; }
    .product-selector__head { align-items: flex-start; flex-wrap: wrap; gap: 8px; }
    .selection-actions {
      display: grid; gap: 8px; padding: 12px 14px; border-top: 1px solid var(--line);
      background: var(--surface-2);
    }
    .selection-actions__group { display: grid; min-width: 0; gap: 5px; }
    .selection-actions__group > small {
      color: var(--muted); font-size: 11px; font-weight: 750; letter-spacing: .04em;
      text-transform: uppercase;
    }
    .selection-actions__group > span { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .selection-actions .btn { min-height: 48px; padding-inline: 10px; font-size: 13px; white-space: normal; }
    .selection-tools { display: grid; gap: 8px; padding: 14px 14px 10px; }
    .product-search { position: relative; display: block; }
    .product-search svg {
      position: absolute; left: 12px; top: 50%; width: 17px; height: 17px;
      transform: translateY(-50%); fill: none; stroke: var(--muted); stroke-width: 1.8;
      pointer-events: none;
    }
    .product-search .input { min-height: 48px; padding-left: 39px; font-size: 16px; }
    .selected-only {
      display: flex; min-height: 48px; align-items: center; gap: 9px;
      color: var(--ink-2); font-size: 14px; font-weight: 700; cursor: pointer;
    }
    .selected-only input, .product-choice > input {
      width: 22px; height: 22px; flex: none; accent-color: var(--rose);
    }
    .category-chips { margin: 0; padding: 0 14px 7px; }
    .category-chips .chip { min-height: 48px; padding-inline: 14px; font-size: 14px; }
    .selection-summary {
      display: flex; justify-content: space-between; gap: 10px; padding: 10px 14px;
      border-block: 1px solid var(--line); color: var(--muted); font-size: 14px;
    }
    .product-choice-list { display: grid; }
    .product-choice {
      display: grid; grid-template-columns: 24px 60px minmax(0, 1fr) auto;
      min-width: 0; align-items: center; gap: 11px; min-height: 88px; padding: 12px 14px;
      border-bottom: 1px solid var(--line); background: var(--surface); cursor: pointer;
    }
    .product-choice:last-child { border-bottom: 0; }
    .product-choice--selected {
      background: color-mix(in srgb, var(--rose-soft) 42%, var(--surface));
    }
    .product-choice img, .product-choice__empty {
      display: grid; width: 60px; height: 60px; place-items: center; border: 1px solid var(--line);
      border-radius: 11px; background: var(--surface-2);
    }
    .product-choice img { box-sizing: border-box; padding: 5px; object-fit: contain; }
    .product-choice__copy { display: grid; min-width: 0; gap: 2px; }
    .product-choice__copy b, .product-choice__copy small {
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .product-choice__copy b { font-size: 15px; line-height: 1.3; }
    .product-choice__copy small { color: var(--muted); font-size: 14px; line-height: 1.4; }
    .product-choice__price {
      display: grid; min-width: 92px; justify-items: end; gap: 1px; text-align: right;
    }
    .product-choice__price small {
      color: var(--muted); font-size: 11px; font-weight: 700;
      letter-spacing: .04em; text-transform: uppercase;
    }
    .product-choice__price b { color: var(--rose-dark); font-size: 16px; white-space: nowrap; }
    .product-choice__price i { color: var(--muted); font-size: 11px; font-style: normal; }
    .product-choice__price--missing b { color: var(--warn); font-size: 14px; }
    .colour-dot {
      width: 15px; height: 15px; border: 1px solid rgb(0 0 0 / 12%); border-radius: 50%;
    }
    .load-state {
      display: flex; min-height: 150px; align-items: center; justify-content: center;
      gap: 14px; padding: 18px; color: var(--muted); text-align: center;
    }
    .load-state > div { display: grid; gap: 3px; }
    .load-state b { color: var(--ink-2); font-size: 15px; }
    .load-state small { font-size: 14px; }
    .load-state--error { border-top: 1px solid var(--line); color: var(--danger); }
    @container product-selector (min-width: 620px) {
      .selection-tools { grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
      .selection-actions { grid-template-columns: 1fr 1fr; }
    }
    @container catalog-page (min-width: 980px) {
      .product-choice-list { max-height: 58dvh; overflow-y: auto; overscroll-behavior: contain; }
    }
    @container product-selector (max-width: 520px) {
      .product-selector__head { display: grid; }
      .product-choice { grid-template-columns: 24px 60px minmax(0, 1fr); }
      .product-choice__price {
        grid-column: 3; min-width: 0; justify-items: start; margin-top: 4px; text-align: left;
      }
      .colour-dot { display: none; }
    }
  `,
})
export class CatalogProductSelection {
  private readonly referencePriceFormat = new Intl.NumberFormat('nl-BE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  readonly products = input<Product[]>([]);
  readonly categories = input<Category[]>([]);
  readonly selected = input<ReadonlySet<number>>(new Set());
  readonly loading = input(false);
  readonly loadError = input<string | null>(null);
  readonly disabled = input(false);
  readonly showReferencePrices = input(true);
  readonly selectedChange = output<Set<number>>();
  readonly retry = output<void>();

  readonly categoryFilter = signal<number | null>(null);
  readonly query = signal('');
  readonly selectedOnly = signal(false);

  readonly selectableIds = computed(() => this.products().flatMap((product) =>
    product.id === null ? [] : [product.id]));
  readonly selectedProductCount = computed(() => {
    const selected = this.selected();
    return this.selectableIds().filter((id) => selected.has(id)).length;
  });
  readonly allSelected = computed(() =>
    this.selectableIds().length > 0 && this.selectedProductCount() === this.selectableIds().length);

  readonly visibleProducts = computed(() => {
    const category = this.categoryFilter();
    const selected = this.selected();
    const needle = this.normalize(this.query());
    return this.products().filter((product) => {
      if (category !== null && product.categoryId !== category) return false;
      if (this.selectedOnly() && (product.id === null || !selected.has(product.id))) return false;
      if (!needle) return true;
      return this.normalize([
        product.name,
        product.sku,
        product.canonicalBarcode,
        product.colour,
        product.variantSize,
        product.barcodeInner,
        product.barcodeOuter,
      ].filter(Boolean).join(' ')).includes(needle);
    });
  });

  readonly visibleSelectedCount = computed(() => {
    const selected = this.selected();
    return this.visibleProducts().filter((product) =>
      product.id !== null && selected.has(product.id)).length;
  });
  readonly visibleAllSelected = computed(() =>
    this.visibleProducts().length > 0
    && this.visibleSelectedCount() === this.visibleProducts().filter((product) => product.id !== null).length);

  toggle(id: number | null): void {
    if (this.disabled() || id === null) return;
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selectedChange.emit(next);
  }

  selectAll(): void {
    if (this.disabled()) return;
    this.selectedChange.emit(selectProductIds(this.selected(), this.selectableIds()));
  }

  clearAll(): void {
    if (this.disabled()) return;
    this.selectedChange.emit(deselectProductIds(this.selected(), this.selectableIds()));
  }

  selectVisible(): void {
    if (this.disabled()) return;
    this.selectedChange.emit(selectProductIds(
      this.selected(),
      this.visibleProducts().map((product) => product.id),
    ));
  }

  clearVisible(): void {
    if (this.disabled()) return;
    this.selectedChange.emit(deselectProductIds(
      this.selected(),
      this.visibleProducts().map((product) => product.id),
    ));
  }

  isSelected(product: Product): boolean {
    return product.id !== null && this.selected().has(product.id);
  }

  productMeta(product: Product): string {
    const variant = [product.colour, product.variantSize].filter(Boolean).join(' · ');
    const dimensions = this.dimensions(product);
    return [product.sku || 'Zonder SKU', variant, dimensions].filter(Boolean).join(' · ');
  }

  hasReferencePrice(product: Product): boolean {
    const price = Number(product.computedSalesPriceEur);
    return Number.isFinite(price) && price > 0;
  }

  referencePrice(product: Product): string {
    if (!this.hasReferencePrice(product)) return 'Op aanvraag';
    return this.referencePriceFormat.format(product.computedSalesPriceEur);
  }

  private dimensions(product: Product): string | null {
    const values = [
      product.dimensions.lengthCm,
      product.dimensions.widthCm,
      product.dimensions.heightCm,
    ];
    if (!values.some((value) => value !== null)) return null;
    return `B×D×H ${values.map((value) => value ?? '—').join('×')} cm`;
  }

  private normalize(value: string): string {
    return value.trim().toLocaleLowerCase('nl-BE');
  }
}
