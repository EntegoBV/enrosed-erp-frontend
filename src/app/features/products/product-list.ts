import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { Location, NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
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
import { COLOUR_SWATCHES } from '../../core/api/geo';
import { Icon } from '../../shared/icon';
import { describePublicationIssues } from './publication-issues';
import { salesPhotoUrl } from '../../shared/sales-photo';
import { productSalesUnit } from './product-sales-unit';
import { PhotoExportSheet } from './photo-export-sheet';
import { LoadError, LOAD_ERROR_FALLBACK } from '../../shared/load-error';
import {
  SORT_OPTIONS, STATUS_OPTIONS, listQueryString, readListQuery, type ListCategory, type ListSort, type ListStatus,
} from './product-list-query';
import { onderwegSummary, type Onderweg } from './product-figures';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { ContextMenu, type ContextMenuItem } from '../../shared/context-menu';
import { Sheet } from '../../shared/ui';
import { ProductListStyles } from './product-list-styles';

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

type SortKey = ListSort;

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
  imports: [Skeleton, RouterLink, FormsModule, AuthImage, PageHeader, Icon, EurPipe, NumPipe, DateNlPipe, NgTemplateOutlet,
    PhotoExportSheet, LoadError, ContextMenu, Sheet,
    ProductListStyles],
  template: `
    <app-page-header title="Producten" [subtitle]="listSubtitle()">
      @if (desktop.active()) {
        <a class="btn btn--sm btn--icon-mobile" routerLink="/catalog-export" title="Catalogus PDF" aria-label="Catalogus PDF">
          <app-icon name="pdf" [size]="18" /><span class="hide-mobile">Catalogus PDF</span>
        </a>
        <button class="btn btn--sm btn--icon-mobile" type="button" title="Foto’s exporteren"
                aria-label="Foto’s exporteren" aria-haspopup="dialog" (click)="photoExportOpen.set(true)">
          <app-icon name="media" [size]="18" /><span class="hide-mobile">Foto’s exporteren</span>
        </button>
        <a class="btn btn--primary btn--sm hide-mobile" routerLink="/products/new">+ Nieuw</a>
      } @else {
        <!-- Voorraad is one tap from the list; the PDF and the photo export sit behind ⋯. -->
        <a class="btn btn--sm btn--icon-mobile" routerLink="/stock" title="Voorraad" aria-label="Voorraad">
          <app-icon name="stock" [size]="18" />
        </a>
        <button class="btn btn--sm btn--icon-mobile" type="button" title="Meer" aria-label="Meer acties"
                aria-haspopup="menu" (click)="moreMenuOpen.set(true)">
          <app-icon name="more" [size]="18" />
        </button>
      }
    </app-page-header>

    @if (desktop.active()) {
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
                   [ngModel]="query()" (ngModelChange)="setQuery($event)" />
            @if (query()) {
              <button class="catalog-search__clear" type="button" aria-label="Zoekopdracht wissen"
                      (click)="setQuery('')">×</button>
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
              <button class="wk-btn wk-btn--sm" type="button" [class.is-busy]="familyLoading()" [disabled]="familyLoading()"
                      (click)="retryFamilies()"><app-icon name="refresh" [size]="13" />Opnieuw proberen</button>
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
                <ng-container *ngTemplateOutlet="productGroup; context: { $implicit: group }" />
              }
              </div>
            </div>
          </section>
        } @empty {
          <div class="card">
            <div class="list">
              @if (loadError(); as error) {
                <app-load-error [message]="error" [busy]="loading()" (retry)="reload()" />
              } @else if (loading()) {
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

      @if (demoGroups().length && !loading()) {
        <!-- Demo pieces: ideas we show, nothing the shelf sells. Folded away
             so the working list stays about sellable stock. -->
        <div class="content demo-fold-wrap">
          <section class="section section--demo">
            <button class="demo-fold" type="button" [attr.aria-expanded]="showDemoFold()"
                    (click)="demoOpen.set(!showDemoFold())">
              <span class="demo-chip">demo</span>
              <span class="demo-fold__label">Demoproducten</span>
              <small>{{ demoCount() }}</small>
              <i class="demo-fold__chev" [class.demo-fold__chev--open]="showDemoFold()" aria-hidden="true"></i>
            </button>
            @if (showDemoFold()) {
              <div class="card">
                <div class="list">
                  @for (group of demoGroups(); track group.key) {
                    <ng-container *ngTemplateOutlet="productGroup; context: { $implicit: group }" />
                  }
                </div>
              </div>
            }
          </section>
        </div>
      }
    } @else {
      <div class="content plp">
        <div class="ios-search plp-search">
          <label class="ios-search__field"><app-icon name="search" [size]="16" />
            <input type="search" placeholder="Zoek naam, SKU of barcode" aria-label="Producten zoeken"
                   [value]="query()" (input)="setQuery($any($event.target).value)" />
            <button class="ios-search__clear" type="button" aria-label="Zoekterm wissen" (click)="setQuery('')"><app-icon name="close" [size]="14" /></button>
          </label>
          <button class="ios-circle plp-filter" type="button" aria-label="Filters en volgorde" aria-haspopup="dialog"
                  (click)="filterSheetOpen.set(true)">
            <app-icon name="filter" [size]="18" />
            @if (sheetFilterCount(); as n) { <span class="ios-count plp-filter__badge">{{ n }}</span> }
          </button>
        </div>
        <div class="ios-chips plp-chips" role="group" aria-label="Categorie en aandacht">
          <button class="ios-chip" type="button" [attr.aria-pressed]="categoryFilter() === null" (click)="setCategory(null)">Alle</button>
          @for (chip of categoryChips(); track chip.key) {
            <button class="ios-chip" type="button" [attr.aria-pressed]="categoryFilter() === chip.id" (click)="setCategory(chip.id)">
              {{ chip.label }} <span class="plp-chip-count">{{ chip.count }}</span>
            </button>
          }
          @if (attentionCount() !== null) {
            <button class="ios-chip plp-chip--warn" type="button" [attr.aria-pressed]="statusFilter() === 'NEEDS_WORK'" (click)="toggleAttention()">
              Aandacht @if (attentionCount()) { <span class="ios-chip__badge plp-chip__badge--warn">{{ attentionCount() }}</span> }
            </button>
          }
        </div>
        @if (familyLoadError()) {
          <div class="family-load-warning plp-warning" role="alert">
            <span>Publicatiestatus en varianten zijn niet geladen.</span>
            <button class="wk-btn wk-btn--sm" type="button" [class.is-busy]="familyLoading()" [disabled]="familyLoading()"
                    (click)="retryFamilies()"><app-icon name="refresh" [size]="13" />Opnieuw proberen</button>
          </div>
        }

        @for (section of sections(); track section.key) {
          <section class="ios-section">
            @if (section.name !== null) {
              <div class="ios-section__head"><h2>{{ section.name }}</h2><span class="ios-section__trail">{{ section.count }}</span></div>
            }
            <div class="ios-group ios-group--thumbs">
              @for (group of section.groups; track group.key) {
                <ng-container *ngTemplateOutlet="phoneGroup; context: { $implicit: group }" />
              }
            </div>
          </section>
        } @empty {
          @if (loadError(); as error) {
            <app-load-error [message]="error" [busy]="loading()" (retry)="reload()" />
          } @else if (loading()) {
            <app-skeleton kind="group" [rows]="6" />
          } @else if (products().length) {
            <div class="ios-empty">
              <span class="ios-empty__icon"><app-icon name="search" [size]="26" /></span>
              <p class="ios-empty__title">Geen producten gevonden</p>
              <p class="ios-empty__text">Pas je zoekopdracht of filters aan.</p>
              <button class="ios-capsule ios-capsule--tinted" type="button" (click)="resetFilters()">Filters wissen</button>
            </div>
          } @else if (!demoGroups().length) {
            <div class="ios-empty">
              <span class="ios-empty__icon"><app-icon name="products" [size]="26" /></span>
              <p class="ios-empty__title">Nog geen producten</p>
              <p class="ios-empty__text">Voeg je eerste product toe; kleuren en maten hang je daarna aan de reeks.</p>
              <a class="ios-capsule ios-capsule--tinted" routerLink="/products/new">+ Nieuw product</a>
            </div>
          }
        }

        @if (demoGroups().length && !loading()) {
          <section class="ios-section plp-demo">
            <button class="ios-section__head plp-demo__head" type="button" [attr.aria-expanded]="showDemoFold()" (click)="demoOpen.set(!showDemoFold())">
              <h2>Demoproducten</h2>
              <span class="ios-section__trail">{{ demoCount() }} <app-icon class="plp-demo__chev" [class.plp-demo__chev--open]="showDemoFold()" name="chevron-down" [size]="14" /></span>
            </button>
            @if (showDemoFold()) {
              <div class="ios-group ios-group--thumbs">
                @for (group of demoGroups(); track group.key) {
                  <ng-container *ngTemplateOutlet="phoneGroup; context: { $implicit: group }" />
                }
              </div>
            }
          </section>
        }
      </div>
    }

    <ng-template #productGroup let-group>

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
                      @if (groupAllDemo(group)) { <span class="demo-chip">demo</span> }
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
                      <small class="stock-expected">+{{ exp | num }} verwacht</small>
                    }
                  </div>
                  <!-- Variants mostly share a price, so the head shows the
                       lead variant's; a faint mark says when they differ. -->
                  <div class="product-row__prices">
                    <div>
                      <span>Kostprijs</span>
                      @if (purchasePrice(group.lead); as price) {
                        <strong class="num">{{ price | eur }}@if (group.costVaries) {<i class="varies" title="Verschilt per variant">≠</i>}</strong>
                      } @else {
                        <strong class="muted">—</strong>
                      }
                    </div>
                    <div>
                      <span>Catalogusprijs</span>
                      @if (salesPrice(group.lead); as price) {
                        <strong class="num">{{ price | eur }}@if (group.priceVaries) {<i class="varies" title="Verschilt per variant">≠</i>}</strong>
                        <small>per {{ salesUnit(group.lead).singular }}</small>
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
    </ng-template>

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
        @if (salesPhotoUrl(product); as photo) {
          <img class="thumb" [class.thumb--sm]="nested" [appAuthSrc]="photo"
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
              @if (product.demo) { <span class="demo-chip">demo</span> }
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
                +{{ exp.quantity | num }} verwacht{{ exp.expectedArrival ? ' · ' + (exp.expectedArrival | dateNl) : '' }}
              </small>
            }
          </div>
          <div class="product-row__prices">
          <div>
            <span>Kostprijs</span>
            @if (purchasePrice(product); as price) {
              <strong class="num">{{ price | eur }}</strong>
            } @else {
              <strong class="muted">—</strong>
            }
          </div>
          <div>
            <span>Catalogusprijs</span>
            @if (salesPrice(product); as price) {
              <strong class="num">{{ price | eur }}</strong>
              <small>per {{ salesUnit(product).singular }}</small>
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

    <ng-template #phoneGroup let-group>
      @if (group.products.length === 1) {
        <ng-container *ngTemplateOutlet="phoneRow; context: { $implicit: group.products[0], nested: false }" />
      } @else {
        <!-- The series head folds its colours open in place; the whole row is the toggle. -->
        @let onway = groupOnderweg(group);
        <button class="plp-row plp-head" type="button" [class.plp-head--open]="isOpen(group)"
                [attr.aria-expanded]="isOpen(group)" (click)="toggle(group)">
          @if (group.photo) {
            <img class="ios-thumb" [appAuthSrc]="group.photo" [alt]="group.name" draggable="false" />
          } @else {
            <span class="ios-thumb plp-thumb--empty" aria-hidden="true">◈</span>
          }
          <span class="plp-body">
            <span class="plp-name">{{ group.name }}</span>
            <span class="plp-meta">
              <span>{{ groupSummary(group) }}</span>
              @if (group.colours.length) {
                <span class="plp-dots" aria-hidden="true">
                  @for (colour of group.colours.slice(0, 8); track colour.name) {
                    <i [style.background]="colour.hex || 'var(--surface-2)'" [class.plp-dot--empty]="!colour.hex"></i>
                  }
                  @if (group.colours.length > 8) { <small>+{{ group.colours.length - 8 }}</small> }
                </span>
              }
              <app-icon class="plp-chev" name="chevron-down" [size]="14" />
            </span>
            @if (groupAllDemo(group) || groupAttention(group)) {
              <span class="plp-chips-line">
                @if (groupAllDemo(group)) { <span class="plp-chip plp-chip--demo">demo</span> }
                @if (groupAttention(group); as attention) { <span class="plp-chip" [attr.title]="groupTooltip(group)">{{ attention }}</span> }
              </span>
            }
            <span class="plp-price">
              @if (salesPrice(group.lead); as price) {
                <span class="plp-nw"><b>{{ price | eur }}</b>@if (group.priceVaries) {<i class="plp-varies" title="Verschilt per variant">≠</i>} per {{ salesUnit(group.lead).singular }}</span>
              } @else { <span>Nog geen prijs</span> }
              @if (purchasePrice(group.lead); as cost) {
                · <span class="plp-nw">kost {{ cost | eur }}@if (group.costVaries) {<i class="plp-varies" title="Verschilt per variant">≠</i>}</span>
              }
            </span>
          </span>
          <span class="plp-end" [attr.aria-label]="endLabel(group.stock, group.lead, onway)">
            <strong [class.zero]="!group.stock">{{ stockLabel(group.stock) }}</strong>
            <small>{{ group.stock === 1 ? salesUnit(group.lead).singular : salesUnit(group.lead).plural }}</small>
            @if (onway) {
              <span class="exp">+{{ onway.quantity | num }}</span>
              @if (onway.earliest) { <small class="plp-date">{{ onway.earliest | dateNl }}</small> }
            }
          </span>
        </button>
        @if (isOpen(group)) {
          @for (product of group.products; track product.id) {
            <ng-container *ngTemplateOutlet="phoneRow; context: { $implicit: product, nested: true }" />
          }
        }
      }
    </ng-template>

    <ng-template #phoneRow let-product let-nested="nested">
      @let exp = expectedFor(product);
      <div class="swipe plp-swipe" [class.plp-swipe--nested]="nested"
           [class.swipe--open]="swiped() === product.id"
           [class.swipe--dragging]="draggingProductId() === product.id"
           [style.--swipe-offset]="draggingProductId() === product.id ? swipeOffset() + 'px' : null"
           [animate.enter]="nested ? 'mo-enter' : ''" [animate.leave]="removingId() === product.id ? 'mo-leave' : ''">
        <a class="swipe__row plp-row" [class.plp-row--nested]="nested" [class.plp-row--inactive]="!product.active"
           [routerLink]="['/products', product.id]"
           (pointerdown)="startSwipe($event, product)"
           (pointermove)="moveSwipe($event, product)"
           (pointerup)="finishSwipe($event)"
           (pointercancel)="cancelSwipe($event)"
           (dragstart)="$event.preventDefault()"
           (click)="blockWhenSwiped($event, product.id)">
          @if (salesPhotoUrl(product); as photo) {
            <img class="ios-thumb" [class.ios-thumb--sm]="nested" [appAuthSrc]="photo" [alt]="product.name" draggable="false" />
          } @else {
            <span class="ios-thumb plp-thumb--empty" [class.ios-thumb--sm]="nested" aria-hidden="true">◈</span>
          }
          <span class="plp-body">
            @if (nested) {
              <span class="plp-name plp-name--variant">
                @if (colourHex(product); as hex) { <i class="plp-cdot" [style.background]="hex" aria-hidden="true"></i> }
                {{ variantLabel(product) || product.name }}
              </span>
              <span class="plp-meta mono">{{ product.sku || 'Geen SKU' }}</span>
            } @else {
              <span class="plp-name">{{ product.name }}</span>
              <span class="plp-meta">{{ productMeta(product) }}</span>
            }
            @if (product.demo || attentionLabel(product, nested)) {
              <span class="plp-chips-line">
                @if (product.demo) { <span class="plp-chip plp-chip--demo">demo</span> }
                @if (attentionLabel(product, nested); as attention) {
                  <span class="plp-chip" [class.plp-chip--muted]="!product.active"
                        [attr.title]="product.active ? issueTooltip(product, nested) : null">{{ attention }}</span>
                }
              </span>
            }
            <span class="plp-price">
              @if (salesPrice(product); as price) { <span class="plp-nw"><b>{{ price | eur }}</b> per {{ salesUnit(product).singular }}</span> } @else { <span>Nog geen prijs</span> }
              @if (purchasePrice(product); as cost) { · <span class="plp-nw">kost {{ cost | eur }}</span> }
            </span>
          </span>
          <span class="plp-end" [attr.title]="stockBreakdown(product)"
                [attr.aria-label]="endLabel(stockOf(product), product, exp ? { quantity: exp.quantity, earliest: exp.expectedArrival } : null)">
            <strong [class.zero]="!stockOf(product)">{{ stockLabel(stockOf(product)) }}</strong>
            <small>{{ stockOf(product) === 1 ? salesUnit(product).singular : salesUnit(product).plural }}</small>
            @if (exp) {
              <span class="exp" [attr.title]="'Op ' + exp.orderNumbers.join(', ')">+{{ exp.quantity | num }}</span>
              @if (exp.expectedArrival) { <small class="plp-date">{{ exp.expectedArrival | dateNl }}</small> }
            }
          </span>
        </a>
        <button class="swipe__delete" type="button"
                [disabled]="deleting() !== null"
                [attr.aria-label]="'Product ' + product.name + ' verwijderen'"
                [attr.title]="'Product verwijderen'"
                (focus)="revealDelete(product.id)"
                (keydown.escape)="closeDelete($event)"
                (click)="remove(product)">
          <app-icon name="trash" [size]="20" />
        </button>
      </div>
    </ng-template>

    <a class="fab" routerLink="/products/new">+ Product</a>

    @if (photoExportOpen()) {
      <app-photo-export-sheet (closed)="photoExportOpen.set(false)" />
    }
    @if (moreMenuOpen()) {
      <app-context-menu title="Producten" variant="ios" cancelLabel="Annuleren" [items]="moreItems" (pick)="pickMore($event)" (closed)="moreMenuOpen.set(false)" />
    }
    @if (filterSheetOpen()) {
      <app-sheet variant="ios" title="Filters en volgorde" (closed)="filterSheetOpen.set(false)">
        <div body class="plp-sheet">
          <section class="ios-section">
            <div class="ios-section__head"><h2>Publicatie</h2></div>
            <div class="ios-group" role="radiogroup" aria-label="Publicatie">
              @for (option of statusOptions; track option.key) {
                <button class="ios-cell" type="button" role="radio" [attr.aria-checked]="statusFilter() === option.key"
                        [disabled]="familyLoadError() && option.key !== 'ALL'" (click)="statusFilter.set(option.key)">
                  <span class="ios-cell__body"><span class="ios-cell__title">{{ option.label }}</span></span>
                  @if (statusFilter() === option.key) { <app-icon class="ios-cell__tick" name="tick" [size]="18" /> }
                </button>
              }
            </div>
          </section>
          <section class="ios-section">
            <div class="ios-section__head"><h2>Volgorde</h2></div>
            <div class="ios-group" role="radiogroup" aria-label="Volgorde">
              @for (option of sortOptions(); track option.key) {
                <button class="ios-cell" type="button" role="radio" [attr.aria-checked]="sortKey() === option.key" (click)="sortKey.set(option.key)">
                  <span class="ios-cell__body"><span class="ios-cell__title">{{ option.label }}</span></span>
                  @if (sortKey() === option.key) { <app-icon class="ios-cell__tick" name="tick" [size]="18" /> }
                </button>
              }
            </div>
          </section>
        </div>
        <div foot style="display:contents">
          @if (sheetFilterCount()) { <button class="btn" type="button" (click)="clearSheetFilters()">Filters wissen</button> }
          <span class="spacer"></span>
          <button class="btn btn--primary" type="button" (click)="filterSheetOpen.set(false)">Klaar</button>
        </div>
      </app-sheet>
    }
    <!-- The list's partial arrives with this lazy chunk (see ProductListStyles). -->
    <app-product-list-styles />
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
    @media (min-width: 680px) {
      .filter-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; }
    }
    .list-item--inactive { opacity: .66; }
    .demo-chip { flex: none; padding: 1px 7px; border-radius: 6px; background: var(--warn-soft);
      border: 1px dashed var(--warn); color: var(--warn); font-size: 9.5px; font-weight: 800;
      letter-spacing: .07em; text-transform: uppercase; }
    .demo-fold-wrap { padding-top: 0; margin-top: -20px; }
    .demo-fold { display: flex; align-items: center; gap: 8px; width: 100%; padding: 11px 14px;
      margin-bottom: 8px; border: 1px dashed var(--line-strong); border-radius: var(--r-sm);
      background: var(--surface-2); color: var(--ink-2); font: inherit; font-size: 12.5px;
      font-weight: 650; text-align: left; cursor: pointer; }
    .demo-fold:hover { background: var(--surface); }
    .demo-fold__label { flex: none; }
    .demo-fold small { color: var(--muted); }
    .demo-fold__chev { width: 7px; height: 7px; margin-left: auto; border-right: 1.6px solid var(--muted);
      border-bottom: 1.6px solid var(--muted); transform: rotate(45deg); transition: transform .15s ease; }
    .demo-fold__chev--open { transform: rotate(-135deg); }
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
    .product-row__prices small { overflow: hidden; color: var(--muted); font-size: 9.5px; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
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
  /** Thumbnails follow the Hoofdfoto rule, the same photo quotes and invoices print. */
  readonly salesPhotoUrl = salesPhotoUrl;
  /** What each price is for: "per diamant", "per display". */
  readonly salesUnit = productSalesUnit;

  readonly desktop = inject(DesktopViewport);
  private readonly location = inject(Location);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly query = signal('');
  /** The search as the address bar has it: written 300 ms after the typing stops. */
  private readonly urlQuery = signal('');
  private queryTimer: ReturnType<typeof setTimeout> | null = null;
  readonly categoryFilter = signal<ListCategory>(null);
  readonly statusFilter = signal<ListStatus>('ALL');
  readonly sortKey = signal<SortKey>('STOCK_SMART');
  readonly statusOptions = STATUS_OPTIONS;
  /** Phone: the ⋯ menu in the bar and the "Filters en volgorde" sheet. */
  readonly moreMenuOpen = signal(false);
  readonly filterSheetOpen = signal(false);
  readonly moreItems: ContextMenuItem[] = [
    { id: 'pdf', label: 'Catalogus PDF', iconName: 'pdf' },
    { id: 'photos', label: 'Foto’s exporteren', iconName: 'media' },
  ];
  /** The row being deleted: only that one leaves with motion, never rows a filter hides. */
  readonly removingId = signal<number | null>(null);
  readonly filtersOpen = signal(false);
  /** The photo ZIP export sheet (also reachable from Instellingen → Catalogusdata). */
  readonly photoExportOpen = signal(false);
  /** How many of category, status and sorting stand off their default. */
  readonly activeFilterCount = computed(() =>
    (this.categoryFilter() !== null ? 1 : 0)
    + (!this.familyLoadError() && this.statusFilter() !== 'ALL' ? 1 : 0)
    + (this.sortKey() !== 'STOCK_SMART' ? 1 : 0));
  readonly sortOptions = computed(() => SORT_OPTIONS);
  readonly sortLabel = computed(() =>
    this.sortOptions().find((option) => option.key === this.sortKey())?.label ?? SORT_OPTIONS[0].label);
  readonly loading = signal(true);
  /** The products or categories did not load: the list says so instead of a skeleton forever. */
  readonly loadError = signal<string | null>(null);
  readonly deleting = signal<number | null>(null);
  readonly swiped = signal<number | null>(null);
  readonly draggingProductId = signal<number | null>(null);
  readonly swipeOffset = signal(0);

  private pointerSwipe: ProductSwipe | null = null;
  private swipeHandled = false;
  private swipeResetTimer: ReturnType<typeof setTimeout> | null = null;

  readonly products = signal<Product[]>([]);
  readonly categories = signal<Category[]>([]);
  private readonly categoryMap = computed(() =>
    new Map(this.categories().map((category) => [category.id, category])));
  readonly families = signal<ProductFamily[]>([]);
  readonly familyLoading = signal(true);
  readonly familyLoadError = signal(false);
  private readonly familyMap = computed(() =>
    new Map(this.families().filter((family) => family.id !== null)
      .map((family) => [family.id!, family])));

  constructor() {
    /* Names the unit under each price ("per diamant"); "per stuk" until it arrives. */
    void this.catalog.unitNames().catch(() => undefined);
    /* The list opens as the address says (back from a product restores it), then writes every change back. */
    const initial = readListQuery(this.route.snapshot.queryParams);
    this.query.set(initial.q);
    this.urlQuery.set(initial.q);
    this.categoryFilter.set(initial.category);
    this.statusFilter.set(initial.status);
    this.sortKey.set(initial.sort);
    this.openOverrides.set(new Map(initial.open.map((key) => [key, true])));
    effect(() => {
      const search = listQueryString({
        q: this.urlQuery(),
        category: this.categoryFilter(),
        status: this.familyLoadError() ? 'ALL' : this.statusFilter(),
        sort: this.sortKey(),
        open: [...this.openOverrides()].filter(([, open]) => open).map(([key]) => key),
      });
      untracked(() => this.writeUrl(search));
    });
    this.destroyRef.onDestroy(() => { if (this.queryTimer !== null) clearTimeout(this.queryTimer); });
    void this.load();
  }

  /** Location.replaceState: no history entry and no navigation, only while the list is the screen. */
  private writeUrl(search: string): void {
    const [path, current = ''] = this.location.path().split('?');
    if (path !== '/products' || !this.router.url.startsWith('/products')) return;
    if ((current ? `?${current}` : '') === search) return;
    this.location.replaceState('/products', search.slice(1));
  }

  setQuery(value: string): void {
    this.query.set(value);
    if (this.queryTimer !== null) clearTimeout(this.queryTimer);
    this.queryTimer = setTimeout(() => { this.queryTimer = null; this.urlQuery.set(value); }, 300);
  }

  setCategory(category: ListCategory): void {
    this.categoryFilter.set(category);
  }

  /** Aandacht and the Publicatie choice set the same filter: one replaces the other. */
  toggleAttention(): void {
    this.statusFilter.set(this.statusFilter() === 'NEEDS_WORK' ? 'ALL' : 'NEEDS_WORK');
  }

  pickMore(item: ContextMenuItem): void {
    this.moreMenuOpen.set(false);
    if (item.id === 'pdf') void this.router.navigateByUrl('/catalog-export');
    else if (item.id === 'photos') this.photoExportOpen.set(true);
  }

  /** The phone filter badge: publication (other than Aandacht, which has its chip) and order off their default. */
  readonly sheetFilterCount = computed(() =>
    (!this.familyLoadError() && this.statusFilter() !== 'ALL' && this.statusFilter() !== 'NEEDS_WORK' ? 1 : 0)
    + (this.sortKey() !== 'STOCK_SMART' ? 1 : 0));

  clearSheetFilters(): void {
    if (this.statusFilter() !== 'NEEDS_WORK') this.statusFilter.set('ALL');
    this.sortKey.set('STOCK_SMART');
  }

  /** "78 producten · 30 reeksen": reeksen are series of two or more; empty while loading. */
  readonly listSubtitle = computed(() => {
    if (this.loading() || this.loadError()) return '';
    const families = new Map<number, number>();
    for (const product of this.products()) {
      if (product.familyId != null) families.set(product.familyId, (families.get(product.familyId) ?? 0) + 1);
    }
    const series = [...families.values()].filter((count) => count >= 2).length;
    const count = this.products().length;
    return `${count} product${count === 1 ? '' : 'en'}${series ? ` · ${series} reeks${series === 1 ? '' : 'en'}` : ''}`;
  });

  /** The category chips with their product counts, in the categories' own order; "Zonder categorie" when any. */
  readonly categoryChips = computed(() => {
    const counts = new Map<number | null, number>();
    for (const product of this.products()) {
      if (product.demo) continue;
      const id = product.categoryId ?? null;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const chips: { key: string; id: ListCategory; label: string; count: number }[] = this.categories()
      .filter((category) => category.id !== null && counts.has(category.id))
      .map((category) => ({ key: `c${category.id}`, id: category.id!, label: category.name, count: counts.get(category.id!) ?? 0 }));
    if (counts.has(null)) chips.push({ key: 'none', id: 'none', label: 'Zonder categorie', count: counts.get(null) ?? 0 });
    return chips;
  });

  /**
   * Aandacht: the rows (series heads and single products, demo excluded) the
   * NEEDS_WORK filter shows with today's category and search; null while the
   * publication state is not known.
   */
  readonly attentionCount = computed<number | null>(() => {
    if (this.familyLoading() || this.familyLoadError()) return null;
    const groups = new Map<string, boolean>();
    for (const product of this.products()) {
      if (!this.passes(product, this.categoryFilter(), this.query().toLowerCase().trim(), 'NEEDS_WORK')) continue;
      const key = product.familyId == null ? `p${product.id}` : `f${product.familyId}`;
      groups.set(key, (groups.get(key) ?? true) && !!product.demo);
    }
    return [...groups.values()].filter((allDemo) => !allDemo).length;
  });

  /** What a series has on the way: the sum, the earliest date, its orders. */
  groupOnderweg(group: ProductGroup): Onderweg | null {
    return onderwegSummary(group.products.map((product) => this.expectedFor(product)));
  }

  /** The end column read aloud: "6.000 bowls, +15.000 verwacht, 20/12/2026". */
  endLabel(stock: number, product: Product, onway: { quantity: number; earliest: string | null } | null): string {
    const unit = this.salesUnit(product);
    const parts = [`${this.stockLabel(stock)} ${stock === 1 ? unit.singular : unit.plural}`];
    if (onway) {
      parts.push(`+${onway.quantity.toLocaleString('nl-BE')} verwacht`);
      if (onway.earliest) parts.push(onway.earliest.split('-').reverse().join('/'));
    }
    return parts.join(', ');
  }

  /** A loose product's line under its name: "{kleur} · {SKU}". */
  productMeta(product: Product): string {
    return [this.variantLabel(product), product.sku || 'Geen SKU'].filter(Boolean).join(' · ');
  }

  reload(): void {
    if (!this.loading()) void this.load();
  }

  private async load(): Promise<void> {
    /* The rows paint as soon as the products are set, and the families name
       and group them; so the products wait for the families and the list
       shows once, with the right names. A failed family request still lets
       the list through, with the retry beside it. */
    this.loading.set(true);
    this.loadError.set(null);
    let products: Product[];
    let categories: Category[];
    try {
      [products, categories] = await Promise.all([
        this.catalog.products(),
        this.catalog.categories(),
        this.loadFamilies(),
      ]);
    } catch (failure: unknown) {
      this.loadError.set(messageOf(failure, LOAD_ERROR_FALLBACK));
      this.loading.set(false);
      return;
    }
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
  }

  async retryFamilies(): Promise<void> {
    if (!this.familyLoading()) await this.loadFamilies();
  }

  private async loadFamilies(): Promise<void> {
    this.familyLoading.set(true);
    this.familyLoadError.set(false);
    try {
      this.families.set(await this.catalog.productFamilies({ maxAgeMs: 20_000 }));
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
    return this.products().filter((product) => this.passes(product, category, needle, status));
  });

  /** One predicate for the list and for the Aandacht count, so the chip always equals the rows it shows. */
  private passes(product: Product, category: ListCategory, needle: string, status: ListStatus): boolean {
    if (category === 'none' ? product.categoryId != null : category !== null && product.categoryId !== category) return false;
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
  }

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
      if (!group.photo) group.photo = salesPhotoUrl(product);
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
      group.photo = salesPhotoUrl(group.lead) ?? group.photo;
      group.priceVaries = group.products.some((p) => this.salesPrice(p) !== this.salesPrice(group.lead));
      group.costVaries = group.products.some((p) => this.purchasePrice(p) !== this.purchasePrice(group.lead));
    }
    return groups.sort((a, b) => this.compareGroups(a, b));
  });

  /** Fully-demo series and loose demo pieces live behind the fold at the bottom. */
  readonly demoGroups = computed(() => this.groups().filter((group) => this.groupAllDemo(group)));
  readonly demoOpen = signal(true);
  readonly showDemoFold = computed(() => this.demoOpen() || this.query().trim().length > 0);

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
    /* The default reading order of a warehouse: what you can sell now on
       top (most first), then what is on the water, then the empty shelves,
       and demo pieces - not for sale - at the very bottom. */
    const tier = (p: Product) =>
      p.demo ? 3 : (this.stockOf(p) > 0 ? 0 : (this.expectedFor(p) ? 1 : 2));
    switch (this.sortKey()) {
      case 'STOCK_SMART': return (a, b) => tier(a) - tier(b)
        || (this.stockOf(b) - this.stockOf(a))
        || text((p) => p.name)(a, b);
      case 'NAME_DESC': return text((p) => p.name, true);
      case 'SKU': return text((p) => p.sku);
      case 'STOCK_DESC': return num((p) => this.stockOf(p), true);
      case 'STOCK_ASC': return num((p) => this.stockOf(p));
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
  readonly demoCount = computed(() =>
    this.demoGroups().reduce((sum, group) => sum + group.products.length, 0));

  groupAllDemo(group: ProductGroup): boolean {
    return group.products.length > 0 && group.products.every((product) => product.demo);
  }

  private compareGroups(a: ProductGroup, b: ProductGroup): number {
    const key = this.sortKey();
    if (key === 'NAME_ASC' || key === 'NAME_DESC') {
      return (key === 'NAME_DESC' ? -1 : 1)
        * a.name.localeCompare(b.name, 'nl', { numeric: true, sensitivity: 'base' });
    }
    if (key === 'STOCK_SMART') {
      const tier = (g: ProductGroup) => g.products.every((p) => p.demo) ? 3
        : (g.stock > 0 ? 0 : (g.products.some((p) => this.expectedFor(p)) ? 1 : 2));
      return tier(a) - tier(b) || (b.stock - a.stock)
        || a.name.localeCompare(b.name, 'nl', { numeric: true, sensitivity: 'base' });
    }
    return this.comparator()(a.products[0], b.products[0]);
  }

  /**
   * The groups cut into category sections, in the categories' own order;
   * products without one come last. A single filtered category needs no
   * heading, nor does a search - there the hits should stand alone.
   */
  readonly sections = computed<ProductSection[]>(() => {
    const groups = this.groups().filter((group) => !this.groupAllDemo(group));
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
        const category = this.categoryMap().get(categoryId);
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

  private readonly stockBreakdowns = computed(() => {
    const names = this.locationNames();
    const result = new Map<number, string>();
    if (names.size <= 1) return result;
    const lines = new Map<number, string[]>();
    for (const level of this.levels()) {
      const own = lines.get(level.productId) ?? [];
      own.push(`${names.get(level.locationId) ?? '?'}: ${level.quantity.toLocaleString('nl-BE')}`);
      lines.set(level.productId, own);
    }
    for (const [productId, own] of lines) result.set(productId, own.join(' · '));
    return result;
  });

  stockBreakdown(product: Product): string | null {
    if (this.locationNames().size <= 1) return null;
    return this.stockBreakdowns().get(product.id!) ?? '';
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
    this.sortKey.set('STOCK_SMART');
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
          this.removingId.set(productId);
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
          setTimeout(() => this.removingId.set(null), 400);
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
