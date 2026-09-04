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
import { Category, Product } from '../../core/api/models';
import { ContextMenu, ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { MenuTrigger } from '../../shared/menu-trigger';
import { Skeleton } from '../../shared/skeleton';
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
      <div class="card__head product-selector__head">
        <div>
          <h2 id="catalog-products-title">Assortiment</h2>
          <p>{{ selectedProductCount() }} van {{ selectableIds().length }} producten opgenomen
            @if (selectedFamilyCount()) { · {{ selectedFamilyCount() }} families }</p>
        </div>
        <div class="selection-quick" role="group" aria-label="Snelle selectie">
          <button class="btn btn--sm" type="button"
                  [disabled]="disabled() || allSelected()"
                  (click)="selectAll()">Alles</button>
          <button class="btn btn--sm" type="button"
                  [disabled]="disabled() || !selectedProductCount()"
                  (click)="clearAll()">Niets</button>
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
          @for (group of groups(); track group.key) {
            <div class="group-head">
              <div class="group-head__copy">
                <b>{{ group.name }}</b>
                <small>{{ groupSelectedCount(group.products) }} van {{ group.products.length }} opgenomen</small>
              </div>
              <span class="group-head__actions">
                <button class="linklike" type="button" [disabled]="disabled() || groupAllSelected(group.products)"
                        (click)="selectMany(group.products)">Alles</button>
                <button class="linklike" type="button" [disabled]="disabled() || !groupSelectedCount(group.products)"
                        (click)="clearMany(group.products)">Niets</button>
              </span>
            </div>
            @for (product of group.products; track product.id) {
              <label class="product-choice" [class.product-choice--selected]="isSelected(product)"
                     appMenuTrigger [appMenuTriggerDisabled]="disabled()"
                     (menuTrigger)="openProductMenu($event, product)"
                     (click)="rowClicked($event, product)">
                <input type="checkbox" [checked]="isSelected(product)"
                       [disabled]="disabled()"
                       [attr.aria-label]="product.name + ' opnemen'"
                       (change)="toggle(product.id)" />
                @if (product.photos[0]; as photo) {
                  <img [appAuthSrc]="photo.url" [alt]="product.name" draggable="false" />
                } @else {
                  <span class="product-choice__empty" aria-hidden="true">◇</span>
                }
                <span class="product-choice__copy">
                  <b>{{ product.name }}</b>
                  <small>{{ productMeta(product) }}</small>
                  @if (familySize(product) > 1) {
                    <em class="product-choice__family">{{ familySelectedCount(product) }}/{{ familySize(product) }} van de familie</em>
                  }
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
                <button class="product-choice__more" type="button" [disabled]="disabled()"
                        [attr.aria-label]="'Meer keuzes voor ' + product.name"
                        (click)="moreClicked($event, product)">⋯</button>
              </label>
            }
          } @empty {
            <div class="load-state">
              <div>
                <b>Geen producten in deze selectie</b>
                <small>Pas je zoekopdracht of filters aan.</small>
              </div>
            </div>
          }
        </div>
        <p class="selection-hint">Tip: rechtermuisklik of lang drukken op een product of categorie voor hele families en categorieën; Shift+klik kiest een reeks.</p>
      }
    </section>

    @if (menu(); as subject) {
      <app-context-menu [title]="menuTitle(subject)" [items]="menuItems(subject)" [anchor]="subject.anchor"
                        (pick)="pickMenu(subject, $event)" (closed)="menu.set(null)" />
    }
  `,
  styles: `
    :host { display: block; min-width: 0; container: product-selector / inline-size; }
    .card__head > div { min-width: 0; }
    .card__head p { margin-top: 4px; color: var(--muted); font-size: 14px; line-height: 1.45; }
    .product-selector__head { align-items: flex-start; flex-wrap: wrap; gap: 8px; }
    .selection-quick { display: flex; gap: 6px; }
    .selection-quick .btn { min-height: 40px; }
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
    .category-chips .chip {
      min-height: 44px; padding-inline: 14px; font-size: 14px;
      user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
    }
    .chip--count i {
      margin-left: 2px; padding: 1px 7px; border-radius: 999px; background: var(--surface-2);
      color: var(--muted); font-size: 11px; font-style: normal; font-weight: 700;
    }
    .chip--partial i { background: var(--warn-soft); color: var(--warn); }
    .chip--full i { background: var(--ok-soft); color: var(--ok); }
    .chip.active i { background: rgb(255 255 255 / 22%); color: #fff; }
    .selection-summary {
      display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 12px; padding: 10px 14px;
      border-block: 1px solid var(--line); color: var(--muted); font-size: 13.5px;
    }
    .selection-summary__actions { display: flex; gap: 14px; }
    .linklike:disabled { opacity: .4; cursor: default; text-decoration: none; }
    .product-choice-list { display: grid; }
    .group-head {
      position: sticky; top: 0; z-index: 1; display: flex; align-items: center; justify-content: space-between;
      gap: 10px; padding: 9px 14px; border-bottom: 1px solid var(--line);
      background: var(--surface-2);
    }
    .group-head__copy { display: grid; min-width: 0; }
    .group-head__copy b { font-size: 13px; letter-spacing: .01em; }
    .group-head__copy small { color: var(--muted); font-size: 12px; }
    .group-head__actions { display: flex; flex: none; gap: 12px; font-size: 13px; }
    .product-choice {
      position: relative;
      display: grid; grid-template-columns: 24px 60px minmax(0, 1fr) auto 32px;
      min-width: 0; align-items: center; gap: 11px; min-height: 84px; padding: 10px 8px 10px 14px;
      border-bottom: 1px solid var(--line); background: var(--surface); cursor: pointer;
      user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; touch-action: pan-y;
    }
    .product-choice:last-child { border-bottom: 0; }
    .product-choice:hover { background: var(--surface-2); }
    .product-choice--selected {
      background: color-mix(in srgb, var(--rose-soft) 42%, var(--surface));
      box-shadow: inset 3px 0 0 var(--rose);
    }
    .product-choice--selected:hover { background: color-mix(in srgb, var(--rose-soft) 60%, var(--surface)); }
    .product-choice img, .product-choice__empty {
      display: grid; width: 60px; height: 60px; place-items: center; border: 1px solid var(--line);
      border-radius: 11px; background: var(--surface-2);
    }
    .product-choice img { box-sizing: border-box; padding: 5px; object-fit: contain; pointer-events: none; }
    .product-choice__copy { display: grid; min-width: 0; gap: 2px; }
    .product-choice__copy b, .product-choice__copy small {
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .product-choice__copy b { font-size: 15px; line-height: 1.3; }
    .product-choice__copy small { color: var(--muted); font-size: 13.5px; line-height: 1.4; }
    .product-choice__family { color: var(--rose-dark); font-size: 11.5px; font-style: normal; font-weight: 650; }
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
    .product-choice__more {
      display: grid; width: 32px; height: 32px; place-items: center; border: 1px solid transparent;
      border-radius: 50%; background: transparent; color: var(--muted); font-size: 18px; line-height: 1; cursor: pointer;
    }
    .product-choice__more:hover, .product-choice__more:focus-visible { border-color: var(--line-strong); background: var(--surface); color: var(--ink); }
    .selection-hint { margin: 0; padding: 10px 14px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; }
    .load-state {
      display: flex; min-height: 150px; align-items: center; justify-content: center;
      gap: 14px; padding: 18px; color: var(--muted); text-align: center;
    }
    .load-state > div { display: grid; gap: 3px; }
    .load-state b { color: var(--ink-2); font-size: 15px; }
    .load-state small { font-size: 14px; }
    .load-state--error { border-top: 1px solid var(--line); color: var(--danger); }
    @media (hover: hover) {
      .product-choice__more { opacity: 0; transition: opacity .12s; }
      .product-choice:hover .product-choice__more, .product-choice__more:focus-visible { opacity: 1; }
    }
    @container product-selector (min-width: 620px) {
      .selection-tools { grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
    }
    @container catalog-page (min-width: 980px) {
      .product-choice-list { max-height: 62dvh; overflow-y: auto; overscroll-behavior: contain; }
    }
    @container product-selector (max-width: 520px) {
      .product-selector__head { display: grid; }
      .product-choice { grid-template-columns: 24px 60px minmax(0, 1fr) 32px; }
      .product-choice__price {
        grid-column: 3; min-width: 0; justify-items: start; margin-top: 4px; text-align: left;
      }
      .colour-dot { display: none; }
      .selection-hint { display: none; }
    }
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
  readonly selectedFamilyCount = computed(() => {
    const selected = this.selected();
    const families = new Set<number>();
    for (const product of this.products()) {
      if (product.id !== null && product.familyId !== null && selected.has(product.id)) families.add(product.familyId);
    }
    return families.size;
  });

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
  private readonly orderedVisible = computed(() => this.groups().flatMap((group) => group.products));

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
