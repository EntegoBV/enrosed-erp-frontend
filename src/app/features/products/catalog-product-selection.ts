import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthImage } from '../../core/api/auth-image';
import { Category, Product, ProductFamily } from '../../core/api/models';
import { ContextMenu, ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { MenuTrigger } from '../../shared/menu-trigger';
import { Skeleton } from '../../shared/skeleton';
import { catalogueFamilies, cataloguePhoto, CatalogueFamilySelection } from './catalog-studio';
import {
  deselectProductIds,
  groupProductsByCategory,
  productIdsBetween,
  selectProductIds,
} from './catalog-product-selection-state';

/** What the open menu is about: one product row, or one category chip. */
type MenuSubject =
  | { kind: 'product'; product: Product; anchor: MenuPoint }
  | { kind: 'category'; categoryId: number | null; name: string; anchor: MenuPoint };

/**
 * Which products go into the catalogue. The list reads like the catalogue
 * itself, category by category, and every row and chip has a menu behind
 * a right-click or a long press for the choices that touch more than one
 * product: the whole family, the whole category, only this one.
 */
@Component({
  selector: 'app-catalog-product-selection',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, FormsModule, Skeleton, ContextMenu, MenuTrigger],
  template: `
    <section class="card product-selector" aria-labelledby="catalog-products-title">
      <div class="product-selector__head">
        <span class="selection-step" aria-hidden="true">03</span>
        <div><h2 id="catalog-products-title">Uw collectie, compleet.</h2><p>{{ selectedFamilyCount() }} productgroepen · {{ selectedProductCount() }} varianten geselecteerd</p></div>
      </div>
      <div class="collection-scope">
        <button class="collection-all" type="button" [class.collection-all--selected]="allSelected()"
                [disabled]="disabled() || loading() || !selectableIds().length" (click)="selectAll()">
          <span class="collection-all__mark" aria-hidden="true">{{ allSelected() ? '✓' : '+' }}</span>
          <span><b>{{ loading() ? 'Assortiment laden…' : allSelected() ? 'Volledig assortiment opgenomen' : 'Volledig assortiment opnemen' }}</b><small>Alle {{ selectableIds().length }} varianten · ook zonder voorraad</small></span>
        </button>
        <div class="selected-categories" aria-label="Geselecteerde categorieën">
          @for (category of categoryChips(); track category.id) {
            @if (category.selected) { <span>{{ category.name }} <b>{{ category.selected }}</b></span> }
          }
        </div>
      </div>
      <details class="selection-editor" [open]="!!loadError()" (toggle)="selectionEditorOpen.set($any($event.target).open)">
        <summary><span>Assortiment aanpassen<small>Kies productgroepen of afzonderlijke kleuren en maten</small></span><i aria-hidden="true">+</i></summary>
      @if (selectionEditorOpen()) {
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
          Selectie
        </label>
      </div>

      <div class="chips category-chips" aria-label="Filter producten op categorie">
        <button class="chip" type="button" [class.active]="categoryFilter() === null"
                [attr.aria-pressed]="categoryFilter() === null"
                [disabled]="disabled()"
                (click)="categoryFilter.set(null)">Alle</button>
        @for (category of categoryChips(); track category.id) {
          <button class="chip chip--count" type="button"
                  appMenuTrigger [appMenuTriggerDisabled]="disabled()"
                  (menuTrigger)="openCategoryMenu($event, category.id, category.name)"
                  [class.active]="categoryFilter() === category.id"
                  [class.chip--partial]="category.selected > 0 && category.selected < category.total"
                  [class.chip--full]="category.total > 0 && category.selected === category.total"
                  [attr.aria-pressed]="categoryFilter() === category.id"
                  [attr.title]="category.selected + ' van ' + category.total + ' opgenomen · rechtermuisklik of lang drukken voor meer'"
                  [disabled]="disabled()"
                  (click)="categoryFilter.set(category.id)">{{ category.name }}<i>{{ category.selected }}/{{ category.total }}</i></button>
        }
      </div>

      <div class="selection-summary" aria-live="polite">
        <span>{{ visibleProducts().length }} zichtbaar · {{ visibleSelectedCount() }} gekozen</span>
        <span class="selection-summary__actions">
          <button class="linklike" type="button"
                  [disabled]="disabled() || !visibleProducts().length || visibleAllSelected()"
                  (click)="selectVisible()">Zichtbare opnemen</button>
          <button class="linklike" type="button"
                  [disabled]="disabled() || !visibleSelectedCount()"
                  (click)="clearVisible()">Zichtbare weghalen</button>
        </span>
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
          @for (group of familyGroups(); track group.key) {
            <div class="group-head">
              <div class="group-head__copy"><b>{{ group.name }}</b><small>{{ groupSelectedCount(group.products) }} / {{ group.products.length }} varianten</small></div>
              <span class="group-head__actions">
                <button class="linklike" type="button" [disabled]="disabled() || groupAllSelected(group.products)" (click)="selectMany(group.products)">Alles</button>
                <button class="linklike" type="button" [disabled]="disabled() || !groupSelectedCount(group.products)" (click)="clearMany(group.products)">Niets</button>
              </span>
            </div>
            @for (family of group.families; track family.key) {
              <div class="family-card" [class.family-card--selected]="groupAllSelected(wholeFamily(family))">
                <div class="family-card__head">
                  <label class="family-card__select">
                    <input type="checkbox" [checked]="groupAllSelected(wholeFamily(family))"
                           [indeterminate]="groupSelectedCount(wholeFamily(family)) > 0 && !groupAllSelected(wholeFamily(family))"
                           [disabled]="disabled()" [attr.aria-label]="'Alle varianten van ' + family.name + ' opnemen'"
                           (change)="toggleFamily(family)" />
                  </label>
                  <button class="family-card__open" type="button" [disabled]="disabled()"
                          [attr.aria-expanded]="expandedFamilies().has(family.key)"
                          [attr.aria-controls]="'catalog-' + family.key" (click)="toggleFamilyOpen(family.key)">
                    @if (family.photo; as photo) { <img [appAuthSrc]="photo.url" alt="" draggable="false" /> }
                    @else { <span class="family-card__empty" aria-hidden="true">E</span> }
                    <span class="family-card__copy"><b>{{ family.name }}</b>
                      <small>{{ groupSelectedCount(wholeFamily(family)) }} van {{ wholeFamily(family).length }} varianten opgenomen</small>
                      <span class="family-swatches" aria-hidden="true">
                        @for (variant of wholeFamily(family).slice(0, 8); track variant.id) {
                          @if (variant.colourHex) { <i [style.backgroundColor]="variant.colourHex" [class.family-swatches__muted]="!isSelected(variant)"></i> }
                        }
                      </span>
                    </span>
                    <span class="family-card__chevron" [class.family-card__chevron--open]="expandedFamilies().has(family.key)" aria-hidden="true">⌄</span>
                  </button>
                </div>
                @if (expandedFamilies().has(family.key)) {
                  <div class="family-card__variants" [id]="'catalog-' + family.key">
                    @for (product of family.products; track product.id) {
                      <div class="product-choice" [class.product-choice--selected]="isSelected(product)"
                           appMenuTrigger [appMenuTriggerDisabled]="disabled()"
                           (menuTrigger)="openProductMenu($event, product)" (click)="rowClicked($event, product)">
                        <input type="checkbox" [id]="'catalog-product-' + product.id" [checked]="isSelected(product)"
                               [disabled]="disabled()" [attr.aria-label]="product.name + ' opnemen'" (change)="toggle(product.id)" />
                        <label class="product-choice__photo" [attr.for]="'catalog-product-' + product.id">
                          @if (photoFor(product); as photo) { <img [appAuthSrc]="photo.url" alt="" draggable="false" /> }
                          @else { <span class="product-choice__empty" aria-hidden="true">◇</span> }
                        </label>
                        <label class="product-choice__copy" [attr.for]="'catalog-product-' + product.id">
                          <b>{{ variantLabel(product) }}</b><small>{{ product.sku || 'Zonder SKU' }}</small>
                          @if (product.carton.piecesPerCarton; as carton) { <small>{{ carton }} stuks per omdoos</small> }
                          @if (showReferencePrices()) {
                            <span class="product-choice__price" [class.product-choice__price--missing]="!hasReferencePrice(product)"><b>{{ referencePrice(product) }}</b>@if (hasReferencePrice(product)) { <i> / stuk</i> }</span>
                          }
                        </label>
                        <button class="product-choice__more" type="button" [disabled]="disabled()"
                                [attr.aria-label]="'Meer keuzes voor ' + product.name" (click)="moreClicked($event, product)">⋯</button>
                      </div>
                    }
                  </div>
                }
              </div>
            }
          } @empty {
            <div class="load-state"><div><b>Geen producten in deze selectie</b><small>Pas je zoekopdracht of filters aan.</small></div></div>
          }
        </div>
        <p class="selection-hint">Tip: rechtermuisklik of lang drukken op een product of categorie voor hele families en categorieën; Shift+klik kiest een reeks.</p>
      }
      <div class="selection-reset"><button class="linklike" type="button" [disabled]="disabled() || !selectedProductCount()" (click)="clearAll()">Selectie leegmaken</button></div>
      }
      </details>
    </section>

    @if (menu(); as subject) {
      <app-context-menu [title]="menuTitle(subject)" [items]="menuItems(subject)" [anchor]="subject.anchor"
                        (pick)="pickMenu(subject, $event)" (closed)="menu.set(null)" />
    }
  `,
  styles: `
    :host { display: block; min-width: 0; container: product-selector / inline-size; }
    .product-selector { overflow: hidden; border-radius: 22px; box-shadow: none; }
    .product-selector__head { display: flex; gap: 12px; align-items: flex-start; padding: 22px 22px 18px; }
    .selection-step { display: grid; width: 32px; height: 32px; flex: none; place-items: center; border-radius: 11px; background: var(--rose-soft); color: var(--rose-dark); font-size: 11px; font-weight: 800; }
    .product-selector__head h2 { margin: 0; font-size: 19px; font-weight: 720; letter-spacing: -.04em; }
    .product-selector__head p { margin: 5px 0 0; color: var(--muted); font-size: 12px; line-height: 1.45; }
    .collection-scope { padding: 0 22px 20px; }
    .collection-all { display: flex; width: 100%; min-height: 80px; align-items: center; gap: 12px; padding: 16px; border: 1px solid var(--line-strong); border-radius: 15px; background: var(--surface-2); color: var(--ink); text-align: left; cursor: pointer; }
    .collection-all--selected { border-color: var(--rose-line); background: color-mix(in srgb, var(--rose-soft) 50%, var(--surface)); }
    .collection-all__mark { display: grid; width: 26px; height: 26px; flex: none; place-items: center; border: 1px solid var(--line-strong); border-radius: 50%; font-size: 15px; }
    .collection-all--selected .collection-all__mark { background: var(--rose); border-color: var(--rose); color: #fff; }
    .collection-all > span:last-child { display: grid; gap: 4px; }
    .collection-all b { font-size: 14px; font-weight: 720; }
    .collection-all small { color: var(--muted); font-size: 12px; line-height: 1.4; }
    .selected-categories { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
    .selected-categories > span { padding: 6px 9px; border-radius: 7px; background: var(--surface-2); color: var(--muted); font-size: 10px; }
    .selected-categories b { margin-left: 4px; color: var(--ink-2); font-weight: 700; }
    .selection-editor { border-top: 1px solid var(--line); }
    .selection-editor > summary { display: flex; min-height: 75px; align-items: center; justify-content: space-between; gap: 14px; padding: 16px 22px; cursor: pointer; list-style: none; }
    .selection-editor > summary::-webkit-details-marker { display: none; }
    .selection-editor > summary > span { display: grid; gap: 4px; font-size: 14px; font-weight: 700; }
    .selection-editor > summary small { color: var(--muted); font-size: 12px; line-height: 1.4; font-weight: 400; }
    .selection-editor > summary > i { font-size: 24px; font-weight: 400; font-style: normal; color: var(--muted); transition: transform .2s; }
    .selection-editor[open] > summary > i { transform: rotate(45deg); }
    .selection-tools { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; padding: 0 18px 12px; }
    .product-search { position: relative; display: block; flex: 1; min-width: 180px; }
    .product-search svg { position: absolute; left: 12px; top: 50%; width: 17px; height: 17px; transform: translateY(-50%); fill: none; stroke: var(--muted); stroke-width: 1.8; pointer-events: none; }
    .product-search .input { min-height: 46px; padding-left: 38px; border-radius: 12px; font-size: 16px; }
    .selected-only { display: flex; min-height: 44px; align-items: center; gap: 7px; color: var(--muted); font-size: 12px; cursor: pointer; }
    .selected-only input { width: 20px; height: 20px; accent-color: var(--rose); }
    .category-chips { flex-wrap: nowrap; gap: 6px; overflow-x: auto; margin: 0; padding: 0 18px 12px; scrollbar-width: none; }
    .category-chips::-webkit-scrollbar { display: none; }
    .category-chips .chip { flex: none; min-height: 40px; padding-inline: 12px; font-size: 12px; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
    .chip--count i { margin-left: 4px; font-style: normal; opacity: .75; font-size: 10px; }
    .selection-summary { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 4px 12px; padding: 10px 18px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; }
    .selection-summary__actions { display: flex; gap: 12px; }
    .selection-summary__actions button { min-height: 36px; font-size: 11px; }
    .linklike:disabled { opacity: .4; cursor: default; text-decoration: none; }
    .product-choice-list { display: grid; padding: 0 12px 12px; background: var(--surface-2); }
    .group-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 16px 6px 10px; }
    .group-head__copy { display: grid; min-width: 0; gap: 2px; }
    .group-head__copy b { font-size: 12px; }
    .group-head__copy small { color: var(--muted); font-size: 10px; }
    .group-head__actions { display: flex; flex: none; gap: 12px; font-size: 11px; }
    .group-head__actions button { min-height: 36px; }
    .family-card { margin-bottom: 7px; border: 1px solid var(--line); border-radius: 14px; overflow: hidden; background: var(--surface); }
    .family-card--selected { border-color: color-mix(in srgb, var(--rose-line) 55%, var(--line)); }
    .family-card__head { display: flex; min-width: 0; align-items: stretch; }
    .family-card__select { display: grid; width: 44px; flex: none; place-items: center; cursor: pointer; }
    .family-card__select input { width: 21px; height: 21px; margin: 0; accent-color: var(--rose); }
    .family-card__open { display: flex; width: 100%; min-width: 0; align-items: center; gap: 12px; padding: 12px 14px 12px 0; border: 0; background: transparent; color: var(--ink); text-align: left; cursor: pointer; }
    .family-card__open > img, .family-card__empty { display: grid; width: 66px; height: 72px; flex: none; place-items: center; padding: 4px; box-sizing: border-box; border-radius: 9px; background: #fff; object-fit: contain; color: #bda292; font: 28px Georgia, serif; }
    .family-card__copy { display: grid; flex: 1; min-width: 0; gap: 4px; }
    .family-card__copy b { font-size: 14px; line-height: 1.3; font-weight: 700; overflow-wrap: anywhere; }
    .family-card__copy small { color: var(--muted); font-size: 11px; }
    .family-swatches { display: flex; gap: 3px; margin-top: 2px; }
    .family-swatches i { width: 10px; height: 10px; border: 1px solid #0002; border-radius: 50%; }
    .family-swatches__muted { opacity: .25; }
    .family-card__chevron { flex: none; color: var(--muted); font-size: 19px; transition: transform .2s; }
    .family-card__chevron--open { transform: rotate(180deg); }
    .family-card__variants { border-top: 1px solid var(--line); }
    .product-choice { display: grid; grid-template-columns: 22px 48px minmax(0, 1fr) 32px; align-items: center; gap: 10px; min-height: 80px; padding: 10px 12px; border-bottom: 1px solid var(--line); background: var(--surface); user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; touch-action: pan-y; }
    .product-choice:last-child { border: 0; }
    .product-choice--selected { background: color-mix(in srgb, var(--rose-soft) 25%, var(--surface)); }
    .product-choice > input { width: 20px; height: 20px; accent-color: var(--rose); }
    .product-choice__photo { cursor: pointer; }
    .product-choice img, .product-choice__empty { display: grid; width: 48px; height: 52px; place-items: center; box-sizing: border-box; padding: 3px; border-radius: 7px; background: #fff; object-fit: contain; pointer-events: none; }
    .product-choice__copy { display: grid; min-width: 0; gap: 2px; cursor: pointer; }
    .product-choice__copy > b { color: var(--ink); font-size: 13px; line-height: 1.4; }
    .product-choice__copy > small { color: var(--muted); font-size: 11px; line-height: 1.4; }
    .product-choice__price { display: block; margin-top: 4px; color: var(--rose-dark); font-size: 12px; }
    .product-choice__price i { color: var(--muted); font-size: 10px; font-style: normal; }
    .product-choice__more { display: grid; width: 32px; height: 44px; place-items: center; padding: 0; border: 0; background: transparent; color: var(--muted); font-size: 18px; cursor: pointer; }
    .selection-hint { margin: 0; padding: 12px 18px; color: var(--muted); font-size: 10px; line-height: 1.5; }
    .selection-reset { padding: 0 18px 14px; }
    .selection-reset button { min-height: 40px; font-size: 12px; color: var(--muted); }
    .load-state { display: flex; min-height: 150px; align-items: center; justify-content: center; gap: 14px; padding: 18px; color: var(--muted); text-align: center; }
    .load-state > div { display: grid; gap: 3px; }
    .load-state b { color: var(--ink-2); font-size: 14px; }
    .load-state small { font-size: 12px; }
    .load-state--error { border-top: 1px solid var(--line); color: var(--danger); }
    @container product-selector (max-width: 420px) {
      .product-selector__head { padding: 18px; }
      .product-selector__head h2 { font-size: 18px; }
      .collection-scope { padding: 0 18px 16px; }
      .collection-all { padding: 12px; }
      .collection-all b { font-size: 13px; }
      .collection-all small { font-size: 11px; }
      .selection-editor > summary { padding-inline: 18px; }
      .family-card__open { gap: 8px; padding-right: 10px; }
      .family-card__open > img, .family-card__empty { width: 54px; height: 64px; }
      .family-card__copy b { font-size: 13px; }
      .family-card__copy small { font-size: 10px; }
      .family-card__select { width: 38px; }
      .product-choice { grid-template-columns: 20px 44px minmax(0, 1fr) 28px; gap: 7px; padding-inline: 9px; }
      .product-choice img { width: 44px; }
      .selection-hint { display: none; }
    }
    @media (prefers-reduced-motion: reduce) { .family-card__chevron, .selection-editor > summary > i { transition: none; } }

  `,
})
export class CatalogProductSelection {
  private readonly router = inject(Router);
  private readonly referencePriceFormat = new Intl.NumberFormat('nl-BE', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  readonly products = input<Product[]>([]);
  readonly categories = input<Category[]>([]);
  readonly families = input<ProductFamily[]>([]);
  readonly expandedFamilies = signal<ReadonlySet<string>>(new Set());
  readonly selectionEditorOpen = signal(false);
  readonly photoFor = cataloguePhoto;
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
  readonly menu = signal<MenuSubject | null>(null);
  /** The row toggled last, as its place in the visible list; the other end of a shift-click. */
  private lastToggledIndex: number | null = null;

  readonly selectableIds = computed(() => this.products().flatMap((product) =>
    product.id === null ? [] : [product.id]));
  readonly selectedProductCount = computed(() => {
    const selected = this.selected();
    return this.selectableIds().filter((id) => selected.has(id)).length;
  });
  readonly allSelected = computed(() =>
    this.selectableIds().length > 0 && this.selectedProductCount() === this.selectableIds().length);
  readonly selectedFamilyCount = computed(() => catalogueFamilies(this.products().filter((product) => this.isSelected(product)), this.families()).length);

  /** Colour and size variants that share a family, so a menu can take them all at once. */
  private readonly familyMembers = computed(() => {
    const members = new Map<number, Product[]>();
    for (const product of this.products()) {
      if (product.familyId === null) continue;
      members.set(product.familyId, [...(members.get(product.familyId) ?? []), product]);
    }
    return members;
  });

  readonly categoryChips = computed(() => {
    const selected = this.selected();
    return this.categories().flatMap((category) => {
      if (category.id === null) return [];
      const inCategory = this.products().filter((product) => product.categoryId === category.id && product.id !== null);
      if (!inCategory.length) return [];
      return [{
        id: category.id,
        name: category.name,
        total: inCategory.length,
        selected: inCategory.filter((product) => selected.has(product.id!)).length,
      }];
    });
  });

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

  readonly groups = computed(() => groupProductsByCategory(this.visibleProducts(), this.categories()));
  /** The rows in the order they are on screen; a shift-click walks this list. */
  readonly familyGroups = computed(() => this.groups().map((group) => ({ ...group, families: catalogueFamilies(group.products, this.families()) })));
  private readonly orderedVisible = computed(() => this.familyGroups().flatMap((group) => group.families.flatMap((family) => this.expandedFamilies().has(family.key) ? family.products : [])));

  wholeFamily(family: CatalogueFamilySelection): Product[] {
    const first = family.products[0];
    return first?.familyId !== null && first?.familyId !== undefined ? this.familyMembers().get(first.familyId) ?? family.products : family.products;
  }

  toggleFamily(family: CatalogueFamilySelection): void {
    if (this.disabled()) return;
    const products = this.wholeFamily(family);
    if (this.groupAllSelected(products)) this.clearMany(products);
    else this.selectMany(products);
  }

  toggleFamilyOpen(key: string): void {
    const next = new Set(this.expandedFamilies());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.expandedFamilies.set(next);
    this.lastToggledIndex = null;
  }

  variantLabel(product: Product): string {
    return [product.colour, product.variantSize].filter(Boolean).join(' · ') || product.name;
  }

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
    this.lastToggledIndex = this.orderedVisible().findIndex((product) => product.id === id);
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selectedChange.emit(next);
  }

  /** Shift+click stretches the last choice over every row in between. */
  rowClicked(event: MouseEvent, product: Product): void {
    if (!event.shiftKey || this.disabled() || product.id === null) return;
    const ordered = this.orderedVisible();
    const index = ordered.findIndex((row) => row.id === product.id);
    if (index < 0 || this.lastToggledIndex === null) return;
    event.preventDefault();
    const ids = productIdsBetween(ordered.map((row) => row.id), this.lastToggledIndex, index);
    const anchor = ordered[this.lastToggledIndex];
    const select = anchor?.id !== null && anchor !== undefined && this.selected().has(anchor.id);
    this.selectedChange.emit(select
      ? selectProductIds(this.selected(), ids)
      : deselectProductIds(this.selected(), ids));
    this.lastToggledIndex = index;
  }

  moreClicked(event: MouseEvent, product: Product): void {
    event.preventDefault();
    event.stopPropagation();
    const button = event.currentTarget as HTMLElement | null;
    const rect = button?.getBoundingClientRect();
    this.openProductMenu(rect ? { x: rect.left, y: rect.bottom + 4 } : { x: event.clientX, y: event.clientY }, product);
  }

  openProductMenu(anchor: MenuPoint, product: Product): void {
    if (this.disabled()) return;
    this.menu.set({ kind: 'product', product, anchor });
  }

  openCategoryMenu(anchor: MenuPoint, categoryId: number | null, name: string): void {
    if (this.disabled()) return;
    this.menu.set({ kind: 'category', categoryId, name, anchor });
  }

  menuTitle(subject: MenuSubject): string {
    return subject.kind === 'product' ? subject.product.name : subject.name;
  }

  menuItems(subject: MenuSubject): ContextMenuItem[] {
    if (subject.kind === 'category') {
      const members = this.categoryProducts(subject.categoryId);
      const chosen = members.filter((product) => this.isSelected(product)).length;
      return [
        { id: 'category-all', label: `Alles uit ${subject.name} opnemen`, hint: `${members.length} producten`, icon: '☑', disabled: chosen === members.length },
        { id: 'category-none', label: `Alles uit ${subject.name} weghalen`, hint: `${chosen} opgenomen`, icon: '☐', disabled: chosen === 0 },
        { id: 'category-only', label: `Alleen ${subject.name}`, hint: 'De rest van de catalogus valt weg', icon: '◎', divider: true },
        { id: 'category-filter', label: `Toon enkel ${subject.name}`, icon: '⌕', divider: true, disabled: this.categoryFilter() === subject.categoryId },
      ];
    }
    const product = subject.product;
    const selected = this.isSelected(product);
    const family = this.familyMembers().get(product.familyId ?? -1) ?? [];
    const familyChosen = family.filter((member) => this.isSelected(member)).length;
    const category = this.categories().find((row) => row.id === product.categoryId);
    const categoryName = category?.name ?? 'deze categorie';
    const categoryMembers = this.categoryProducts(product.categoryId);
    const categoryChosen = categoryMembers.filter((member) => this.isSelected(member)).length;
    const items: ContextMenuItem[] = [
      selected
        ? { id: 'toggle', label: 'Uit de catalogus halen', icon: '☐' }
        : { id: 'toggle', label: 'Opnemen in de catalogus', icon: '☑' },
    ];
    if (family.length > 1) {
      items.push(
        { id: 'family-all', label: 'Hele familie opnemen', hint: `${family.length} varianten`, icon: '❖', divider: true, disabled: familyChosen === family.length },
        { id: 'family-none', label: 'Hele familie weghalen', hint: `${familyChosen} opgenomen`, icon: '❖', disabled: familyChosen === 0 },
      );
    }
    items.push(
      { id: 'category-all', label: `Alles uit ${categoryName} opnemen`, hint: `${categoryMembers.length} producten`, icon: '☑', divider: true, disabled: categoryChosen === categoryMembers.length },
      { id: 'category-none', label: `Alles uit ${categoryName} weghalen`, hint: `${categoryChosen} opgenomen`, icon: '☐', disabled: categoryChosen === 0 },
      { id: 'only', label: 'Alleen dit product', hint: 'Al het andere valt weg', icon: '◎', divider: true },
      { id: 'open', label: 'Product openen', hint: 'Naar de productkaart', icon: '↗', divider: true, disabled: product.id === null },
    );
    return items;
  }

  pickMenu(subject: MenuSubject, item: ContextMenuItem): void {
    this.menu.set(null);
    if (this.disabled()) return;
    const product = subject.kind === 'product' ? subject.product : null;
    const categoryId = subject.kind === 'product' ? subject.product.categoryId : subject.categoryId;
    switch (item.id) {
      case 'toggle': this.toggle(product?.id ?? null); break;
      case 'family-all': this.selectMany(this.familyMembers().get(product?.familyId ?? -1) ?? []); break;
      case 'family-none': this.clearMany(this.familyMembers().get(product?.familyId ?? -1) ?? []); break;
      case 'category-all': this.selectMany(this.categoryProducts(categoryId)); break;
      case 'category-none': this.clearMany(this.categoryProducts(categoryId)); break;
      case 'category-only': this.selectedChange.emit(new Set(this.categoryProducts(categoryId).flatMap((row) => row.id === null ? [] : [row.id]))); break;
      case 'category-filter': this.categoryFilter.set(categoryId); break;
      case 'only': if (product?.id !== null && product?.id !== undefined) this.selectedChange.emit(new Set([product.id])); break;
      case 'open': if (product?.id !== null && product?.id !== undefined) void this.router.navigate(['/products', product.id]); break;
      default: break;
    }
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
    this.selectMany(this.visibleProducts());
  }

  clearVisible(): void {
    this.clearMany(this.visibleProducts());
  }

  selectMany(products: readonly Product[]): void {
    if (this.disabled()) return;
    this.selectedChange.emit(selectProductIds(this.selected(), products.map((product) => product.id)));
  }

  clearMany(products: readonly Product[]): void {
    if (this.disabled()) return;
    this.selectedChange.emit(deselectProductIds(this.selected(), products.map((product) => product.id)));
  }

  groupSelectedCount(products: readonly Product[]): number {
    return products.filter((product) => this.isSelected(product)).length;
  }

  groupAllSelected(products: readonly Product[]): boolean {
    const selectable = products.filter((product) => product.id !== null);
    return selectable.length > 0 && selectable.every((product) => this.isSelected(product));
  }

  familySize(product: Product): number {
    return product.familyId === null ? 1 : (this.familyMembers().get(product.familyId)?.length ?? 1);
  }

  familySelectedCount(product: Product): number {
    if (product.familyId === null) return this.isSelected(product) ? 1 : 0;
    return (this.familyMembers().get(product.familyId) ?? []).filter((member) => this.isSelected(member)).length;
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

  private categoryProducts(categoryId: number | null): Product[] {
    return this.products().filter((product) => product.categoryId === categoryId);
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
