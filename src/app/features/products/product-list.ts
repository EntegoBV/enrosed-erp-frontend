import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { AuthImage } from '../../core/api/auth-image';
import { Category, Product, ProductFamily, StockLevel, ExpectedStock } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { DateNlPipe, EurPipe, NumPipe } from '../../shared/pipes';
import { escapeHtml, Ui } from '../../shared/ui';
import { messageOf } from '../../core/api/errors';
import { Privacy } from '../../core/api/privacy';
import { COLOUR_SWATCHES } from '../../core/api/geo';
import { describePublicationIssues } from './publication-issues';

/**
 * One row in the list: a product on its own, or a series (family) that
 * folds its colour and size variants away behind a head row.
 */
interface ProductGroup {
  key: string;
  family: ProductFamily | null;
  name: string;
  products: Product[];
  photo: string | null;
  colours: { name: string; hex: string | null }[];
  sizes: string[];
  stock: number;
  /** The variant whose figures stand for the series on the head row. */
  lead: Product;
  priceVaries: boolean;
  costVaries: boolean;
}

interface ProductSection {
  key: string;
  /** Null when the list is not cut up: one nameless section holds all. */
  name: string | null;
  count: number;
  groups: ProductGroup[];
}

/** Red is the house colour: it stands for a series unless told otherwise. */
function isRed(colour: string | null | undefined): boolean {
  const value = (colour ?? '').trim().toLowerCase();
  return value === 'rood' || value === 'red' || value === 'rouge' || value === 'rot';
}

type SortKey = 'NAME_ASC' | 'NAME_DESC' | 'SKU' | 'STOCK_DESC' | 'STOCK_ASC'
  | 'PRICE_ASC' | 'PRICE_DESC' | 'COST_ASC' | 'COST_DESC';

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
  imports: [Skeleton, RouterLink, FormsModule, AuthImage, PageHeader, EurPipe, NumPipe, DateNlPipe, NgTemplateOutlet],
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

        <!-- Filters and sorting fold away behind one button: the search box
             is what you reach for; the rest is there when you need it. -->
        <button class="filter-toggle" type="button"
                [class.filter-toggle--active]="activeFilterCount() > 0"
                [attr.aria-expanded]="filtersOpen()"
                (click)="filtersOpen.set(!filtersOpen())">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 6h16M7 12h10M10 18h4" />
          </svg>
          <span class="hide-mobile">Filters</span>
          @if (activeFilterCount(); as n) {
            <b class="filter-toggle__count">{{ n }}</b>
          }
          <i class="filter-toggle__chev" [class.filter-toggle__chev--open]="filtersOpen()"></i>
        </button>

        @if (filtersOpen()) {
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

          <!-- Sorting as a compact icon control: on a phone a third full
               select pushed the filter bar onto a second row. -->
          <div class="filter-field filter-sort">
            <span class="filter-field__label" aria-hidden="true">Sorteren</span>
            <div class="filter-sort__box">
              <svg class="filter-sort__icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h12M4 12h8M4 17h5" /><path d="M17 10v10m0 0-3-3m3 3 3-3" />
              </svg>
              <span class="filter-sort__text hide-mobile">{{ sortLabel() }}</span>
              <select class="filter-sort__native" aria-label="Sorteren"
                      [title]="'Sorteren: ' + sortLabel()"
                      [ngModel]="sortKey()" (ngModelChange)="sortKey.set($event)">
                @for (option of sortOptions(); track option.key) {
                  <option [value]="option.key">{{ option.label }}</option>
                }
              </select>
            </div>
          </div>

        </div>

        }

        @if (filtersOpen() || hasFilters()) {
          <div class="filter-summary" aria-live="polite">
            <span><strong>{{ filtered().length }}</strong> van {{ products().length }} producten</span>
            @if (hasFilters()) {
              <button class="filter-reset" type="button" (click)="resetFilters()">Filters wissen</button>
            }
          </div>
        }
        @if (familyLoadError()) {
          <div class="family-load-warning" role="alert">
            <span>Publicatiestatus en varianten zijn niet geladen.</span>
            <button type="button" [disabled]="familyLoading()" (click)="retryFamilies()">
              {{ familyLoading() ? 'Laden…' : 'Opnieuw proberen' }}
            </button>
          </div>
        }
      </section>

      @for (section of sections(); track section.key) {
        <!-- One card per category, its name above the white: the eye finds
             "Glas" faster than it reads twelve product names. -->
        <section class="section" [style.animation-delay.ms]="$index * 40">
          @if (section.name !== null) {
            <h2 class="section-head">
              <span>{{ section.name }}</span>
              <small>{{ section.count }}</small>
            </h2>
          }
          <div class="card">
            <div class="list">
            @for (group of section.groups; track group.key) {
            @if (group.products.length === 1) {
              <ng-container *ngTemplateOutlet="productRow; context: { $implicit: group.products[0], nested: false }" />
            } @else {
              <!-- The series head: one line per product range, the variants
                   fold out below it. Less scrolling past six shades of the
                   same vase. -->
              <button class="list-item group-head" type="button"
                      [class.group-head--open]="isOpen(group)"
                      [attr.aria-expanded]="isOpen(group)"
                      (click)="toggle(group)">
                @if (group.photo) {
                  <img class="thumb" [appAuthSrc]="group.photo" [alt]="group.name" draggable="false" />
                } @else {
                  <div class="thumb thumb--placeholder">◈</div>
                }
                <div class="list-item__body">
                  <div class="product-row__primary">
                    <div class="product-row__title">
                      <strong>{{ group.name }}</strong>
                    </div>
                    <div class="product-row__badges">
                      @if (groupAttention(group); as attention) {
                        <span class="master-chip master-chip--warn"
                              [attr.title]="groupTooltip(group)">{{ attention }}</span>
                      }
                    </div>
                  </div>
                  <div class="group-head__meta">
                    <span class="group-head__count">
                      {{ groupSummary(group) }}
                      <svg class="group-head__chev" viewBox="0 0 12 12" aria-hidden="true">
                        <path d="M2.5 4.5 6 8l3.5-3.5" />
                      </svg>
                    </span>
                    @if (group.colours.length) {
                      <span class="group-head__dots" aria-hidden="true">
                        @for (colour of group.colours.slice(0, 8); track colour.name) {
                          <i [style.background]="colour.hex || 'var(--surface-2)'"
                             [class.dot--empty]="!colour.hex" [title]="colour.name"></i>
                        }
                        @if (group.colours.length > 8) {
                          <small>+{{ group.colours.length - 8 }}</small>
                        }
                      </span>
                    }
                  </div>
                </div>
                <div class="list-item__end group-head__end">
                  <div class="product-row__stock">
                    <span>Voorraad</span>
                    @if (group.stock) {
                      <strong class="stock">{{ groupStock(group) }}</strong>
                    } @else {
                      <strong class="stock stock--none">0</strong>
                    }
                    @if (expectedForGroup(group); as exp) {
                      <small class="stock-expected">+{{ exp | num }} te verwachten</small>
                    }
                  </div>
                  <!-- Variants mostly share a price, so the head shows the
                       lead variant's; a faint mark says when they differ. -->
                  <div class="product-row__prices">
                    @if (privacy.showPurchase()) {
                      <div>
                        <span>Kostprijs</span>
                        @if (purchasePrice(group.lead); as price) {
                          <strong class="num">{{ price | eur }}@if (group.costVaries) {<i class="varies" title="Verschilt per variant">≠</i>}</strong>
                        } @else {
                          <strong class="muted">—</strong>
                        }
                      </div>
                    }
                    <div>
                      <span>Catalogusprijs</span>
                      @if (salesPrice(group.lead); as price) {
                        <strong class="num">{{ price | eur }}@if (group.priceVaries) {<i class="varies" title="Verschilt per variant">≠</i>}</strong>
                      } @else {
                        <strong class="muted">—</strong>
                      }
                    </div>
                  </div>
                </div>
              </button>
              @if (isOpen(group)) {
                <div class="group-body">
                  @for (product of group.products; track product.id) {
                    <ng-container *ngTemplateOutlet="productRow; context: { $implicit: product, nested: true }" />
                  }
                </div>
              }
            }
            }
            </div>
          </div>
        </section>
      } @empty {
        <div class="card">
          <div class="list">
            @if (loading()) {
              <app-skeleton kind="list" [rows]="6" />
            } @else {
              <div class="empty">
                <div class="empty__icon">◈</div>
                <div class="empty__title">Geen producten gevonden</div>
                <a class="btn btn--primary" routerLink="/products/new">Product toevoegen</a>
              </div>
            }
          </div>
        </div>
      }
    </div>

    <ng-template #productRow let-product let-nested="nested">
      <div class="swipe"
           [class.swipe--nested]="nested"
           [class.swipe--open]="swiped() === product.id"
           [class.swipe--dragging]="draggingProductId() === product.id"
           [style.--swipe-offset]="draggingProductId() === product.id
             ? swipeOffset() + 'px' : null">
      <a class="list-item swipe__row" [class.list-item--inactive]="!product.active"
         [class.list-item--nested]="nested"
         [routerLink]="['/products', product.id]"
         (pointerdown)="startSwipe($event, product)"
         (pointermove)="moveSwipe($event, product)"
         (pointerup)="finishSwipe($event)"
         (pointercancel)="cancelSwipe($event)"
         (dragstart)="$event.preventDefault()"
         (click)="blockWhenSwiped($event, product.id)">
        @if (product.photos.length) {
          <img class="thumb" [class.thumb--sm]="nested" [appAuthSrc]="product.photos[0].url"
               [alt]="product.name" draggable="false" />
        } @else {
          <div class="thumb thumb--placeholder" [class.thumb--sm]="nested">◈</div>
        }
        <div class="list-item__body">
          <div class="product-row__primary">
            <div class="product-row__title">
              @if (!nested) {
                <strong>{{ product.name }}</strong>
              }
              @if (variantLabel(product); as variant) {
                <span class="variant-label">
                  @if (!nested) { · }
                  {{ variant }}
                  <!-- The dot only where it tells colours apart: inside an
                       opened series. On a lone product it is just noise. -->
                  @if (nested && colourHex(product); as hex) {
                    <i class="colour-dot" [style.background]="hex" [title]="product.colour"></i>
                  }
                </span>
              }
            </div>
            <div class="product-row__badges">
              <!-- Inside a series a variant shows the points that concern
                   it: the shared ones plus its own, never another colour's.
                   Hovering lists them in words. -->
              @if (attentionLabel(product, nested); as attention) {
                <span class="master-chip"
                      [class.master-chip--muted]="!product.active"
                      [class.master-chip--warn]="product.active"
                      [attr.title]="product.active ? issueTooltip(product, nested) : null">
                  {{ attention }}
                </span>
              }
            </div>
          </div>
          <div class="product-row__sku mono">{{ product.sku || 'Geen SKU' }}</div>
        </div>
        <div class="list-item__end product-row__end">
          <div class="product-row__stock" [attr.title]="stockBreakdown(product)">
            <span>Voorraad</span>
            @if (stockOf(product)) {
              <strong class="stock">{{ stockLabel(stockOf(product)) }}</strong>
            } @else {
              <strong class="stock stock--none">0</strong>
            }
            @if (expectedFor(product); as exp) {
              <!-- On the water: what the catalogue may promise soon, and when. -->
              <small class="stock-expected" [attr.title]="'Op ' + exp.orderNumbers.join(', ')">
                +{{ exp.quantity | num }} te verwachten{{ exp.expectedArrival ? ' · ' + (exp.expectedArrival | dateNl) : '' }}
              </small>
            }
          </div>
          <div class="product-row__prices">
          @if (privacy.showPurchase()) {
            <div>
              <span>Kostprijs</span>
              @if (purchasePrice(product); as price) {
                <strong class="num">{{ price | eur }}</strong>
              } @else {
                <strong class="muted">—</strong>
              }
            </div>
          }
          <div>
            <span>Catalogusprijs</span>
            @if (salesPrice(product); as price) {
              <strong class="num">{{ price | eur }}</strong>
            } @else {
              <strong class="muted">—</strong>
            }
          </div>
          </div>
        </div>
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
    </ng-template>

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
    .catalog-search { position: relative; display: block; min-width: 0; flex: 1; }
    .catalog-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 9px; }
    .filter-toggle {
      display: inline-flex; align-items: center; gap: 6px; min-height: 42px; padding: 0 12px;
      border: 1px solid var(--line-strong); border-radius: var(--r-sm); background: var(--surface);
      color: var(--ink-2); font: inherit; font-size: 13px; font-weight: 650; cursor: pointer;
    }
    .filter-toggle:hover { background: var(--surface-2); }
    .filter-toggle--active { border-color: var(--rose-line); color: var(--rose-dark); background: var(--rose-soft); }
    .filter-toggle svg { width: 18px; height: 18px; fill: none; stroke: currentColor;
      stroke-width: 1.8; stroke-linecap: round; }
    .filter-toggle__count {
      min-width: 18px; padding: 0 5px; border-radius: 9px; background: var(--rose); color: #fff;
      font-size: 11px; font-weight: 700; line-height: 18px; text-align: center;
    }
    .filter-toggle__chev {
      width: 7px; height: 7px; margin-left: 2px; border-right: 1.6px solid currentColor;
      border-bottom: 1.6px solid currentColor; transform: translateY(-2px) rotate(45deg);
      transition: transform .15s ease; opacity: .7;
    }
    .filter-toggle__chev--open { transform: translateY(2px) rotate(-135deg); }
    .filter-grid, .filter-summary, .family-load-warning { flex: 1 0 100%; }
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
      display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
      gap: 9px; min-width: 0; margin-top: 2px;
    }
    .filter-sort__box {
      position: relative; display: flex; align-items: center; gap: 7px; min-height: 42px;
      padding: 0 11px; border: 1px solid var(--line-strong); border-radius: var(--r-sm);
      background: var(--surface); color: var(--ink-2);
    }
    .filter-sort__box:hover { background: var(--surface-2); }
    .filter-sort__icon { width: 18px; height: 18px; fill: none; stroke: currentColor;
      stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .filter-sort__text { font-size: 13px; font-weight: 650; white-space: nowrap; }
    /* The real select lies invisibly over the box: the native picker opens
       on tap, the box is just how it looks. */
    .filter-sort__native { position: absolute; inset: 0; width: 100%; height: 100%;
      opacity: 0; cursor: pointer; font-size: 16px; }
    .filter-field { display: block; min-width: 0; }
    .filter-field__label {
      display: block; margin: 0 0 5px 2px; color: var(--muted);
      font-size: 10px; font-weight: 750; letter-spacing: .055em; text-transform: uppercase;
    }
    .filter-sort .filter-field__label { visibility: hidden; }
    .filter-field__select {
      display: block; min-width: 0; max-width: 100%; min-height: 42px;
      padding: 9px 30px 9px 10px; font-size: 13px; font-weight: 650;
      text-overflow: ellipsis;
    }
    .filter-summary {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      min-width: 0; margin-top: 0; color: var(--muted); font-size: 12px;
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
    @media (min-width: 680px) {
      .filter-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; }
    }
    .list-item--inactive { opacity: .66; }
    .product-row__primary {
      display: flex; min-width: 0; flex-wrap: wrap; align-items: center;
      justify-content: space-between; gap: 4px 8px;
    }
    /* Wraps: a long name takes the whole line and the colour label drops
       under it, instead of both fighting for one line. */
    .product-row__title { display: flex; flex-wrap: wrap; min-width: 0; align-items: baseline; gap: 2px 4px; }
    /* A long name gives way with an ellipsis; the colour label stays whole
       - "· Roc" told nobody anything. */
    .product-row__title strong { flex: 0 1 auto; overflow: hidden; min-width: 0; font-size: 13.5px;
      text-overflow: ellipsis; white-space: nowrap; }
    .product-row__title span { flex: 0 0 auto; color: var(--muted); font-size: 11px;
      white-space: nowrap; }
    .product-row__badges { display: flex; flex: 0 0 auto; gap: 4px; }
    .product-row__sku { margin-top: 4px; color: var(--muted); font-size: 10.5px; }
    .product-row__end { display: flex; align-items: center; gap: 8px; }
    .product-row__stock { display: grid; justify-items: end; gap: 4px; }
    .product-row__stock span { color: var(--muted); font-size: 8px; font-weight: 700;
      letter-spacing: .055em; line-height: 1.15; text-transform: uppercase; }
    .stock { display: inline-flex; align-items: center; padding: 0 7px; min-height: 18px;
      border-radius: 999px; background: var(--surface-2); border: 1px solid var(--line);
      color: var(--ink-2); font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums;
      white-space: nowrap; }
    /* Nothing on the shelf: a plain figure, no badge to shout about it. */
    .stock--none { padding: 0; border: 0; background: transparent; color: var(--muted); font-weight: 600; }
    .stock-expected { display: block; margin-top: 2px; color: var(--warn); font-size: 10px; font-weight: 700;
      white-space: nowrap; text-transform: none; letter-spacing: 0; }
    .product-row__prices { display: grid; gap: 4px; width: 84px; box-sizing: border-box;
      padding-left: 8px; border-left: 1px solid var(--line); }
    @media (min-width: 680px) {
      .product-row__end { gap: 10px; }
      .product-row__prices { width: 96px; padding-left: 10px; }
    }
    .product-row__prices > div { display: grid; }
    .product-row__prices span { color: var(--muted); font-size: 8px; font-weight: 700;
      letter-spacing: .055em; line-height: 1.15; text-transform: uppercase; }
    .product-row__prices strong { font-size: 11.5px; line-height: 1.3; }
    .swipe--dragging { user-select: none; }
    .swipe--dragging .swipe__row {
      transform: translateX(var(--swipe-offset, 0px)); transition: none; cursor: grabbing;
    }
    .master-chip { flex: 0 0 auto; display: inline-flex; align-items: center; min-height: 18px;
      padding: 1px 6px; border-radius: 999px; font-size: 9px; font-weight: 750;
      letter-spacing: .03em; text-transform: uppercase; }
    .master-chip--warn { color: var(--warn); background: var(--warn-soft); }
    .master-chip--muted { color: var(--muted); background: var(--surface-2); border: 1px solid var(--line); }

    .section { animation: section-in .28s ease both; }
    .section + .section { margin-top: 18px; }
    @keyframes section-in {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: none; }
    }
    @media (prefers-reduced-motion: reduce) { .section { animation: none; } }
    .section-head {
      display: flex; align-items: baseline; gap: 8px; margin: 0 0 8px 4px;
      color: var(--ink-2); font-size: 11.5px; font-weight: 800; letter-spacing: .08em;
      text-transform: uppercase;
    }
    .section-head small { color: var(--muted); font-size: 11px; font-weight: 650; letter-spacing: 0; }
    .group-head { width: 100%; border: 0; border-bottom: 1px solid var(--line); font: inherit;
      text-align: left; cursor: pointer; }
    .group-head:hover { background: var(--surface-2); }
    /* Opened: a quiet grey tint and a thin bar, the same in every theme -
       the accent colour would shout over the whole list. */
    .group-head--open { background: var(--surface-2); box-shadow: inset 3px 0 0 var(--line-strong, var(--muted)); }
    .group-head__meta { display: flex; align-items: center; gap: 8px; margin-top: 4px; min-width: 0; }
    .group-head__count { color: var(--muted); font-size: 11px; white-space: nowrap; }
    .group-head__dots { display: inline-flex; align-items: center; gap: 3px; }
    .group-head__dots i { width: 11px; height: 11px; border-radius: 50%;
      border: 1px solid rgb(0 0 0 / 14%); display: inline-block; }
    .group-head__dots .dot--empty { border-style: dashed; }
    .group-head__dots small { color: var(--muted); font-size: 10px; margin-left: 2px; }
    .group-head__end { display: flex; align-items: center; gap: 10px; flex: 0 0 auto; }
    .varies { font-style: normal; color: var(--muted); font-size: 9px; margin-left: 3px;
      vertical-align: top; cursor: help; }
    /* The fold hint lives in the text line, so the figures column stays
       aligned with every other row. */
    .group-head__count { display: inline-flex; align-items: center; gap: 5px; }
    /* A small ringed chevron: readable as "this folds open" at a glance,
       without the weight of a button. */
    .group-head__chev { width: 18px; height: 18px; padding: 3px; box-sizing: border-box;
      border: 1px solid var(--line-strong); border-radius: 50%; background: var(--surface);
      fill: none; stroke: var(--ink-2); stroke-width: 1.8; stroke-linecap: round;
      stroke-linejoin: round; transition: transform .15s ease, background .15s ease; }
    .group-head:hover .group-head__chev { background: var(--surface-2); }
    .group-head--open .group-head__chev { transform: rotate(180deg); background: var(--surface-2); }

    /* The opened series: its variants sit in a tinted well with a bar on the
       left, so the eye sees at once what belongs to the head above. */
    .group-body { background: var(--surface-2); box-shadow: inset 3px 0 0 var(--line-strong, var(--muted));
      border-bottom: 1px solid var(--line); }
    .group-body .swipe:last-child .list-item { border-bottom: 0; }
    .list-item--nested { padding-left: 30px; min-height: 50px; background: var(--surface-2); }
    .thumb--sm { width: 36px; height: 36px; }

    .variant-label { display: inline-flex; align-items: center; gap: 5px; }
    .colour-dot { flex: none; width: 10px; height: 10px; border-radius: 50%; display: inline-block;
      border: 1px solid rgb(0 0 0 / 14%); }
  `,
})
export class ProductList {
  private readonly catalog = inject(CatalogApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);
  readonly privacy = inject(Privacy);

  readonly query = signal('');
  readonly categoryFilter = signal<number | null>(null);
  readonly statusFilter = signal<'ALL' | 'NEEDS_WORK' | 'WEBSITE' | 'ORDER_APP' | 'INACTIVE'>('ALL');
  readonly sortKey = signal<SortKey>('NAME_ASC');
  readonly filtersOpen = signal(false);
  /** How many of category, status and sorting stand off their default. */
  readonly activeFilterCount = computed(() =>
    (this.categoryFilter() !== null ? 1 : 0)
    + (!this.familyLoadError() && this.statusFilter() !== 'ALL' ? 1 : 0)
    + (this.sortKey() !== 'NAME_ASC' ? 1 : 0));
  readonly sortOptions = computed<{ key: SortKey; label: string }[]>(() => [
    { key: 'NAME_ASC', label: 'Naam A–Z' },
    { key: 'NAME_DESC', label: 'Naam Z–A' },
    { key: 'SKU', label: 'SKU' },
    { key: 'STOCK_DESC', label: 'Voorraad hoog → laag' },
    { key: 'STOCK_ASC', label: 'Voorraad laag → hoog' },
    { key: 'PRICE_ASC', label: 'Catalogusprijs laag → hoog' },
    { key: 'PRICE_DESC', label: 'Catalogusprijs hoog → laag' },
    ...(this.privacy.showPurchase()
      ? [{ key: 'COST_ASC' as const, label: 'Kostprijs laag → hoog' },
         { key: 'COST_DESC' as const, label: 'Kostprijs hoog → laag' }]
      : []),
  ]);
  readonly sortLabel = computed(() =>
    this.sortOptions().find((option) => option.key === this.sortKey())?.label ?? 'Naam A–Z');
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
    /* Stock per location arrives beside the products; until then the
       product's own figure (the warehouse) stands in. */
    void Promise.all([this.catalog.stockLevels(), this.catalog.stockLocations()])
      .then(([levels, locations]) => {
        this.levels.set(levels);
        this.locationNames.set(new Map(locations.filter((l) => l.id !== null).map((l) => [l.id!, l.name])));
      })
      .catch(() => undefined);
    void this.sourcing.expectedStock()
      .then((expected) => this.expected.set(new Map(expected.map((item) => [item.productId, item]))))
      .catch(() => undefined);
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

  /**
   * Products folded per series. Search keeps a series open so the hit is
   * visible; a tap on the head overrides that for this visit.
   */
  private readonly openOverrides = signal<Map<string, boolean>>(new Map());

  readonly groups = computed<ProductGroup[]>(() => {
    const byKey = new Map<string, ProductGroup>();
    for (const product of this.filtered()) {
      const key = product.familyId == null ? `p${product.id}` : `f${product.familyId}`;
      let group = byKey.get(key);
      if (!group) {
        const family = this.familyFor(product);
        group = {
          key, family, name: family?.name || product.name, products: [], photo: null,
          colours: [], sizes: [], stock: 0, lead: product, priceVaries: false, costVaries: false,
        };
        byKey.set(key, group);
      }
      group.products.push(product);
      if (!group.photo && product.photos.length) group.photo = product.photos[0].url;
      const colour = product.colour?.trim();
      if (colour && !group.colours.some((item) => item.name === colour)) {
        group.colours.push({ name: colour, hex: this.colourHex(product) });
      }
      const size = product.variantSize?.trim();
      if (size && !group.sizes.includes(size)) group.sizes.push(size);
      group.stock += this.stockOf(product);
    }
    const groups = [...byKey.values()];
    const compare = this.comparator();
    for (const group of groups) {
      group.products.sort(compare);
      /* The card's featured variant leads; otherwise the red one - the
         house colour - and failing that the series' first variant, not
         whichever happens to sort first. */
      const byPosition = [...group.products].sort((a, b) =>
        (a.variantPosition ?? Number.MAX_SAFE_INTEGER) - (b.variantPosition ?? Number.MAX_SAFE_INTEGER)
        || (a.id ?? 0) - (b.id ?? 0));
      group.lead = group.products.find((p) => p.id === group.family?.cardFeaturedProductId)
        ?? byPosition.find((p) => isRed(p.colour))
        ?? byPosition[0];
      if (group.lead.photos.length) group.photo = group.lead.photos[0].url;
      group.priceVaries = group.products.some((p) => this.salesPrice(p) !== this.salesPrice(group.lead));
      group.costVaries = group.products.some((p) => this.purchasePrice(p) !== this.purchasePrice(group.lead));
    }
    return groups.sort((a, b) => this.compareGroups(a, b));
  });

  /** Alphabetical unless told otherwise; names compare the Belgian way (é, ij). */
  private comparator(): (a: Product, b: Product) => number {
    const text = (pick: (p: Product) => string | null | undefined, reverse = false) =>
      (a: Product, b: Product) => (reverse ? -1 : 1)
        * (pick(a) ?? '').localeCompare(pick(b) ?? '', 'nl', { numeric: true, sensitivity: 'base' });
    const num = (pick: (p: Product) => number | null, reverse = false) =>
      (a: Product, b: Product) => {
        const left = pick(a), right = pick(b);
        if (left === null && right === null) return 0;
        if (left === null) return 1;
        if (right === null) return -1;
        return (reverse ? -1 : 1) * (left - right);
      };
    switch (this.sortKey()) {
      case 'NAME_DESC': return text((p) => p.name, true);
      case 'SKU': return text((p) => p.sku);
      case 'STOCK_DESC': return num((p) => p.stockQuantity ?? 0, true);
      case 'STOCK_ASC': return num((p) => p.stockQuantity ?? 0);
      case 'PRICE_ASC': return num((p) => this.salesPrice(p));
      case 'PRICE_DESC': return num((p) => this.salesPrice(p), true);
      case 'COST_ASC': return num((p) => this.purchasePrice(p));
      case 'COST_DESC': return num((p) => this.purchasePrice(p), true);
      default: return text((p) => p.name);
    }
  }

  /**
   * A series sorts by its best-placed variant, except by name, where the
   * series name counts - the variants share it anyway.
   */
  private compareGroups(a: ProductGroup, b: ProductGroup): number {
    const key = this.sortKey();
    if (key === 'NAME_ASC' || key === 'NAME_DESC') {
      return (key === 'NAME_DESC' ? -1 : 1)
        * a.name.localeCompare(b.name, 'nl', { numeric: true, sensitivity: 'base' });
    }
    return this.comparator()(a.products[0], b.products[0]);
  }

  /**
   * The groups cut into category sections, in the categories' own order;
   * products without one come last. A single filtered category needs no
   * heading, nor does a search - there the hits should stand alone.
   */
  readonly sections = computed<ProductSection[]>(() => {
    const groups = this.groups();
    if (!groups.length) return [];
    if (this.categoryFilter() !== null || this.query().trim()) {
      return [{ key: 'all', name: null, count: groups.length, groups }];
    }
    const order = new Map(this.categories().map((category, index) => [category.id, index]));
    const byCategory = new Map<number | null, ProductSection>();
    for (const group of groups) {
      const categoryId = group.lead.categoryId ?? null;
      let section = byCategory.get(categoryId);
      if (!section) {
        const category = this.categories().find((item) => item.id === categoryId);
        section = {
          key: categoryId === null ? 'none' : `c${categoryId}`,
          name: category?.name ?? 'Zonder categorie',
          count: 0, groups: [],
        };
        byCategory.set(categoryId, section);
      }
      section.groups.push(group);
      section.count += group.products.length;
    }
    return [...byCategory.entries()]
      .sort(([a], [b]) => (a === null ? Infinity : order.get(a) ?? Infinity)
        - (b === null ? Infinity : order.get(b) ?? Infinity))
      .map(([, section]) => section);
  });

  isOpen(group: ProductGroup): boolean {
    return this.openOverrides().get(group.key) ?? this.query().trim().length > 0;
  }

  toggle(group: ProductGroup): void {
    const open = this.isOpen(group);
    this.openOverrides.update((map) => new Map(map).set(group.key, !open));
  }

  groupSummary(group: ProductGroup): string {
    const parts: string[] = [];
    if (group.colours.length > 1) parts.push(`${group.colours.length} kleuren`);
    if (group.sizes.length > 1) parts.push(`${group.sizes.length} maten`);
    return parts.length ? parts.join(' · ') : `${group.products.length} varianten`;
  }

  groupAttention(group: ProductGroup): string | null {
    if (this.familyLoading() || this.familyLoadError()) return null;
    const issues = group.family?.publicationIssues.length ?? 0;
    return issues ? `${issues} aandacht` : null;
  }

  /** The product's own swatch, or the standard one for that colour name. */
  colourHex(product: Product): string | null {
    const colour = product.colour?.trim();
    if (!colour) return null;
    return product.colourHex || COLOUR_SWATCHES[colour] || null;
  }

  groupStock(group: ProductGroup): string {
    return this.stockLabel(group.stock);
  }

  /** Pieces per location, loaded once beside the products; the list shows the total. */
  private readonly levels = signal<StockLevel[]>([]);
  private readonly expected = signal(new Map<number, ExpectedStock>());

  expectedFor(product: Product): ExpectedStock | null {
    return this.expected().get(product.id!) ?? null;
  }

  expectedForGroup(group: ProductGroup): number {
    return group.products.reduce((sum, product) => sum + (this.expectedFor(product)?.quantity ?? 0), 0);
  }
  private readonly locationNames = signal(new Map<number, string>());
  private readonly stockTotals = computed(() => {
    const totals = new Map<number, number>();
    for (const level of this.levels()) totals.set(level.productId, (totals.get(level.productId) ?? 0) + level.quantity);
    return totals;
  });

  stockOf(product: Product): number {
    return this.stockTotals().get(product.id!) ?? product.stockQuantity ?? 0;
  }

  stockBreakdown(product: Product): string | null {
    const names = this.locationNames();
    if (names.size <= 1) return null;
    const own = this.levels().filter((level) => level.productId === product.id);
    return own.map((level) => `${names.get(level.locationId) ?? '?'}: ${level.quantity.toLocaleString('nl-BE')}`).join(' · ');
  }

  stockLabel(quantity: number | null): string {
    return (quantity ?? 0).toLocaleString('nl-BE');
  }

  variantLabel(product: Product): string | null {
    const parts = [product.colour, product.variantSize]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));
    return parts.length ? parts.join(' · ') : null;
  }

  readonly hasFilters = computed(() =>
    this.query().trim().length > 0 || this.categoryFilter() !== null
      || (!this.familyLoadError() && this.statusFilter() !== 'ALL'),
  );

  resetFilters(): void {
    this.query.set('');
    this.categoryFilter.set(null);
    this.statusFilter.set('ALL');
    this.sortKey.set('NAME_ASC');
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
        ? ' Alleen dit product/SKU wordt verwijderd; de andere gekoppelde producten en gedeelde websitegegevens blijven bestaan.'
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

  /** The active price strategy is calculated once by the backend. */
  salesPrice(product: Product): number | null {
    return product.computedSalesPriceEur > 0 ? product.computedSalesPriceEur : null;
  }

  purchasePrice(product: Product): number | null {
    return product.landedCostEur !== null && product.landedCostEur > 0
      ? product.landedCostEur
      : null;
  }

  attentionLabel(product: Product, ownOnly = false): string | null {
    if (!product.active) return 'Inactief';
    if (this.familyLoading() || this.familyLoadError()) return null;
    const issueCount = (ownOnly ? this.variantIssues(product) : this.publicationIssues(product)).length;
    return issueCount ? `${issueCount} aandacht` : null;
  }

  /** The series' shared issues plus those naming this variant. */
  variantIssues(product: Product): string[] {
    const ownKey = product.canonicalVariantKey ?? String(product.id);
    return this.publicationIssues(product).filter((issue) => {
      const match = /\.variants\.([^.]+)\./.exec(issue);
      return !match || match[1] === ownKey;
    });
  }

  issueTooltip(product: Product, ownOnly: boolean): string {
    const issues = ownOnly ? this.variantIssues(product) : this.publicationIssues(product);
    return describePublicationIssues(issues, this.variantNames(product.familyId)).join('\n');
  }

  groupTooltip(group: ProductGroup): string {
    return describePublicationIssues(group.family?.publicationIssues ?? [],
      this.variantNames(group.family?.id ?? null)).join('\n');
  }

  private variantNames(familyId: number | null): Map<string, string> {
    const names = new Map<string, string>();
    if (familyId == null) return names;
    for (const product of this.products()) {
      if (product.familyId !== familyId) continue;
      names.set(product.canonicalVariantKey ?? String(product.id),
        this.variantLabel(product) ?? product.name);
    }
    return names;
  }

  familyFor(product: Product): ProductFamily | null {
    return product.familyId == null ? null : this.familyMap().get(product.familyId) ?? null;
  }

  publicationIssues(product: Product): string[] {
    if (this.familyLoading() || this.familyLoadError()) return [];
    const family = this.familyFor(product);
    if (family) return family.publicationIssues;
    return [];
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
