import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { Location, NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { AuthImage } from '../../core/api/auth-image';
import { Category, Product, ProductFamily, StockLevel, ExpectedStock, StockLocation } from '../../core/api/models';
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
  SORT_OPTIONS, STATUS_OPTIONS, listQueryString, readListQuery, sortButtonLabel, type ListCategory, type ListSort, type ListStatus,
} from './product-list-query';
import { onderwegSummary, type Onderweg } from './product-figures';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { ContextMenu, type ContextMenuItem } from '../../shared/context-menu';
import { Sheet } from '../../shared/ui';
import { ProductListStyles } from './product-list-styles';
import { ProductListTable, type ProductListTableHost } from './product-list-table';
import type { MenuPoint } from '../../shared/context-menu-position';
import { keyContext } from '../../shared/key-context';

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
  host: { '(document:keydown)': 'onDocumentKey($event)' },
  imports: [Skeleton, RouterLink, AuthImage, PageHeader, Icon, EurPipe, NumPipe, DateNlPipe, NgTemplateOutlet,
    PhotoExportSheet, LoadError, ContextMenu, Sheet, ProductListTable,
    ProductListStyles],
  template: `
    <app-page-header title="Producten" [subtitle]="listSubtitle()">
      @if (desktop.active()) {
        <label class="wk-search pl-search">
          <app-icon name="search" [size]="15" />
          <input type="search" data-page-search placeholder="Zoek naam, SKU, kleur of barcode" aria-label="Producten zoeken"
                 [value]="query()" (input)="setQuery($any($event.target).value)" (keydown.escape)="clearSearch($event)" />
          <button class="wk-search__clear" type="button" aria-label="Zoekterm wissen" (click)="setQuery('')"><app-icon name="close" [size]="13" /></button>
          <span class="wk-kbd" aria-hidden="true">/</span>
        </label>
        <a class="btn btn--sm pl-tool" routerLink="/catalog-export" title="Catalogus PDF" aria-label="Catalogus PDF">
          <app-icon name="pdf" [size]="16" /><span class="pl-tool__label">Catalogus PDF</span>
        </a>
        <button class="btn btn--sm pl-tool" type="button" title="Foto’s exporteren"
                aria-label="Foto’s exporteren" aria-haspopup="dialog" (click)="photoExportOpen.set(true)">
          <app-icon name="media" [size]="16" /><span class="pl-tool__label">Foto’s exporteren</span>
        </button>
        <a class="btn btn--primary btn--sm" routerLink="/products/new">+ Nieuw</a>
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
      <div class="content pl-content">
        <div class="wk-subbar pl-subbar">
          <div class="pl-subbar__chips" role="group" aria-label="Categorie">
            @if (categoriesFolded()) {
              <button class="wk-chip" type="button" aria-haspopup="menu" [attr.aria-pressed]="categoryFilter() !== null"
                      (click)="openMenu('category', $event)">{{ categoryChipLabel() }} <app-icon name="chevron-down" [size]="13" /></button>
            } @else {
              <button class="wk-chip" type="button" [attr.aria-pressed]="categoryFilter() === null" (click)="setCategory(null)">
                Alle <span class="pl-chip-count">{{ chipTotal() }}</span></button>
              @for (chip of categoryChips(); track chip.key) {
                <button class="wk-chip" type="button" [attr.aria-pressed]="categoryFilter() === chip.id" (click)="setCategory(chip.id)">
                  {{ chip.label }} <span class="pl-chip-count">{{ chip.count }}</span></button>
              }
            }
          </div>
          <span class="pl-subbar__sep" aria-hidden="true"></span>
          @if (attentionCount() !== null) {
            <button class="wk-chip tone-warn" type="button" [attr.aria-pressed]="statusFilter() === 'NEEDS_WORK'" (click)="toggleAttention()">
              Aandacht <span class="pl-chip-count">{{ attentionCount() }}</span></button>
          }
          <button class="wk-chip" type="button" aria-haspopup="menu" [attr.aria-pressed]="statusFilter() !== 'ALL' && statusFilter() !== 'NEEDS_WORK'"
                  [disabled]="familyLoading() || familyLoadError()" (click)="openMenu('status', $event)">
            {{ statusChipLabel() }} <app-icon name="chevron-down" [size]="13" /></button>
          <div class="wk-subbar__end pl-subbar__end">
            <button class="wk-btn wk-btn--ghost wk-btn--sm" type="button" aria-haspopup="menu" (click)="openMenu('sort', $event)">
              <app-icon name="order" [size]="14" />{{ sortButton() }}</button>
            @if (!loading()) { <span class="pl-subbar__count">{{ filtered().length }} van {{ products().length }}</span> }
            @if (hasFilters()) { <button class="wk-link" type="button" (click)="resetFilters()">Filters wissen</button> }
          </div>
        </div>

        @if (familyLoadError()) {
          <div class="family-load-warning pl-warning" role="alert">
            <span>Publicatiestatus en varianten zijn niet geladen.</span>
            <button class="wk-btn wk-btn--sm" type="button" [class.is-busy]="familyLoading()" [disabled]="familyLoading()"
                    (click)="retryFamilies()"><app-icon name="refresh" [size]="13" />Opnieuw proberen</button>
          </div>
        }

        @if (loadError(); as error) {
          <div class="wk-card"><app-load-error [message]="error" [busy]="loading()" (retry)="reload()" /></div>
        } @else if (loading()) {
          <div class="wk-card pl-card"><app-skeleton kind="table" [rows]="8" /></div>
        } @else if (!sections().length && !demoGroups().length) {
          <div class="wk-card">
            @if (products().length) {
              <div class="wk-empty">
                <div class="wk-empty__icon"><app-icon name="search" [size]="22" /></div>
                <h2 class="wk-empty__title">Geen producten gevonden</h2>
                <p class="wk-empty__text">Pas je zoekopdracht of filters aan.</p>
                <div class="wk-empty__actions"><button class="wk-btn" type="button" (click)="resetFilters()">Filters wissen</button></div>
              </div>
            } @else {
              <div class="wk-empty">
                <div class="wk-empty__icon"><app-icon name="products" [size]="22" /></div>
                <h2 class="wk-empty__title">Nog geen producten</h2>
                <p class="wk-empty__text">Voeg je eerste product toe; kleuren en maten hang je daarna aan de reeks.</p>
                <div class="wk-empty__actions"><a class="wk-btn wk-btn--primary" routerLink="/products/new">+ Nieuw product</a></div>
              </div>
            }
          </div>
        } @else if (wide()) {
          <div class="wk-card pl-card mo-fade">
            <app-product-list-table [host]="this" />
          </div>
        } @else {
          <!-- 680–899: the phone rows in cards, a section per category. -->
          @for (section of sections(); track section.key) {
            <section class="pl-msection">
              @if (section.name !== null) {
                <h2 class="pl-msection__head">{{ section.name }} <small>{{ section.count }}</small></h2>
              }
              <div class="ios-group ios-group--thumbs pl-mgroup">
                @for (group of section.groups; track group.key) {
                  <ng-container *ngTemplateOutlet="phoneGroup; context: { $implicit: group }" />
                }
              </div>
            </section>
          }
          @if (demoGroups().length) {
            <section class="pl-msection">
              <button class="pl-msection__head pl-msection__toggle" type="button" [attr.aria-expanded]="showDemoFold()" (click)="toggleDemo()">
                Demoproducten <small>{{ demoCount() }}</small> <app-icon class="plp-demo__chev" [class.plp-demo__chev--open]="showDemoFold()" name="chevron-down" [size]="14" />
              </button>
              @if (showDemoFold()) {
                <div class="ios-group ios-group--thumbs pl-mgroup">
                  @for (group of demoGroups(); track group.key) {
                    <ng-container *ngTemplateOutlet="phoneGroup; context: { $implicit: group }" />
                  }
                </div>
              }
            </section>
          }
        }
      </div>
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
    @if (deskMenu(); as menu) {
      <app-context-menu [title]="menu.title" [anchor]="menu.at" [items]="menu.items" (pick)="pickDeskMenu($event)" (closed)="deskMenu.set(null)" />
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
})
export class ProductList implements ProductListTableHost {
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
  /** Desk widths: the table from 900, the full column set and the category chips from 1360. */
  readonly wide = this.media('(min-width: 900px)');
  readonly full = this.media('(min-width: 1360px)');

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

  private media(query: string) {
    const matches = signal(false);
    const list = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
    if (list) {
      matches.set(list.matches);
      const change = (event: MediaQueryListEvent) => matches.set(event.matches);
      list.addEventListener('change', change);
      this.destroyRef.onDestroy(() => list.removeEventListener('change', change));
    }
    return matches.asReadonly();
  }

  /* ---- the desk subbar and its menus ---- */
  readonly deskMenu = signal<{ kind: 'category' | 'status' | 'sort'; title: string; at: MenuPoint; items: ContextMenuItem[] } | null>(null);
  /** Below 1360, or with more than five categories, the chips fold into one "Categorie ▾". */
  readonly categoriesFolded = computed(() => !this.full() || this.categoryChips().filter((chip) => chip.id !== 'none').length > 5);
  readonly chipTotal = computed(() => this.products().filter((product) => !product.demo).length);
  readonly categoryChipLabel = computed(() => {
    const category = this.categoryFilter();
    if (category === null) return 'Categorie';
    return this.categoryChips().find((chip) => chip.id === category)?.label ?? 'Categorie';
  });
  readonly statusChipLabel = computed(() => {
    const status = this.statusFilter();
    return status === 'ALL' || status === 'NEEDS_WORK' ? 'Publicatie' : STATUS_OPTIONS.find((option) => option.key === status)?.label ?? 'Publicatie';
  });
  readonly sortButton = computed(() => sortButtonLabel(this.sortKey()));

  openMenu(kind: 'category' | 'status' | 'sort', event: MouseEvent): void {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const at = { x: kind === 'sort' ? box.right : box.left, y: box.bottom + 6 };
    if (kind === 'category') {
      this.deskMenu.set({ kind, at, title: 'Categorie', items: [
        { id: 'all', label: `Alle categorieën · ${this.chipTotal()}`, checked: this.categoryFilter() === null },
        ...this.categoryChips().map((chip) => ({ id: String(chip.id), label: `${chip.label} · ${chip.count}`, checked: this.categoryFilter() === chip.id })),
      ] });
    } else if (kind === 'status') {
      this.deskMenu.set({ kind, at, title: 'Publicatie', items: STATUS_OPTIONS.map((option) => ({
        id: option.key, label: option.label, checked: this.statusFilter() === option.key || (option.key === 'ALL' && this.statusFilter() === 'NEEDS_WORK'),
      })) });
    } else {
      this.deskMenu.set({ kind, at, title: 'Volgorde', items: SORT_OPTIONS.map((option) => ({ id: option.key, label: option.label, checked: this.sortKey() === option.key })) });
    }
  }

  pickDeskMenu(item: ContextMenuItem): void {
    const menu = this.deskMenu();
    this.deskMenu.set(null);
    if (!menu) return;
    if (menu.kind === 'category') this.setCategory(item.id === 'all' ? null : item.id === 'none' ? 'none' : Number(item.id));
    else if (menu.kind === 'status') this.statusFilter.set(item.id as ListStatus);
    else this.sortKey.set(item.id as ListSort);
  }

  setSort(sort: ListSort): void {
    this.sortKey.set(sort);
  }

  toggleDemo(): void {
    this.demoOpen.set(!this.showDemoFold());
  }

  /** Esc in the search clears it first; a second Esc leaves the field. */
  clearSearch(event: Event): void {
    if (!this.query()) { (event.target as HTMLElement).blur(); return; }
    event.preventDefault();
    this.setQuery('');
  }

  /** '/' focuses the search (until the shell listens for it everywhere). */
  onDocumentKey(event: KeyboardEvent): void {
    if (event.key !== '/' || !this.desktop.active()) return;
    const context = keyContext(event, null);
    if (context.typing || context.overlayOpen || context.mod) return;
    const field = document.querySelector<HTMLInputElement>('app-product-list [data-page-search]');
    if (!field) return;
    event.preventDefault();
    field.focus();
  }

  familyKnown(): boolean {
    return !this.familyLoading() && !this.familyLoadError();
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
        this.activeLocations.set(locations.filter((l) => l.active && l.id !== null).sort((a, b) => a.position - b.position));
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

  private readonly activeLocations = signal<StockLocation[]>([]);

  /**
   * "Tica Brussel 8": what lies outside the first location, so a second
   * location's stock shows on the row; null when only the first holds any.
   */
  otherLocationsLine(products: readonly Product[]): string | null {
    const others = this.activeLocations().slice(1);
    if (!others.length) return null;
    const ids = new Set(products.map((product) => product.id));
    const parts = others.map((location) => {
      const quantity = this.levels().filter((level) => level.locationId === location.id && ids.has(level.productId))
        .reduce((sum, level) => sum + level.quantity, 0);
      return quantity ? `${location.name} ${quantity.toLocaleString('nl-BE')}` : null;
    }).filter((part): part is string => part !== null);
    return parts.length ? parts.join(' · ') : null;
  }

  /** The series' stock per location, for the tooltip. */
  groupBreakdown(group: ProductGroup): string | null {
    const names = this.locationNames();
    if (names.size <= 1) return null;
    const ids = new Set(group.products.map((product) => product.id));
    const totals = new Map<number, number>();
    for (const level of this.levels()) {
      if (ids.has(level.productId)) totals.set(level.locationId, (totals.get(level.locationId) ?? 0) + level.quantity);
    }
    return [...totals].map(([id, quantity]) => `${names.get(id) ?? '?'}: ${quantity.toLocaleString('nl-BE')}`).join(' · ');
  }

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

  /** Clears the search at once, the address bar too: a typing timer still running cannot bring it back. */
  resetFilters(): void {
    if (this.queryTimer !== null) { clearTimeout(this.queryTimer); this.queryTimer = null; }
    this.query.set('');
    this.urlQuery.set('');
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
