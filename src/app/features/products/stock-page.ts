import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, ViewEncapsulation, computed, effect, inject, signal, untracked } from '@angular/core';
import { Location, NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { AuthImage } from '../../core/api/auth-image';
import { Category, ExpectedStock, Product, ProductFamily, StockLevel, StockLocation, StockMovement } from '../../core/api/models';
import { COLOUR_SWATCHES } from '../../core/api/geo';
import { messageOf } from '../../core/api/errors';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { Icon } from '../../shared/icon';
import { Segmented, type SegmentOption } from '../../shared/segmented';
import { ContextMenu, type ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { keyContext } from '../../shared/key-context';
import { rovingRow } from './product-list-query';
import { DateNlPipe, DateTimeNlPipe, EurPipe, NumPipe } from '../../shared/pipes';
import { Sheet, Ui } from '../../shared/ui';
import { salesPhotoUrl } from '../../shared/sales-photo';
import { LoadError, LOAD_ERROR_FALLBACK } from '../../shared/load-error';
import { productSalesUnit, unitCount } from './product-sales-unit';
import { stockCellEdit, undoAllowed, type BookingKind, type BookingLevel } from './stock-booking';
import { StockBookingSheet, type StockBooked } from './stock-booking-sheet';
import { distinctOrderCount, knownValueSum, locationSplit, locationValues, onderwegOrdersLabel, onderwegSummary, stockValue, type Onderweg } from './product-figures';

interface StockRow {
  product: Product;
  byLocation: Map<number, number>;
  total: number;
  /** Euros at landed cost; null without a cost (or without stock). */
  value: number | null;
}

/** A series and its variants, or a lone product on its own. */
interface StockGroup {
  key: string;
  name: string;
  photo: string | null;
  colours: { name: string; hex: string | null }[];
  rows: StockRow[];
  byLocation: Map<number, number>;
  total: number;
  value: number | null;
  onway: Onderweg | null;
  /** The unit word for the series' sums, only when every variant shares it. */
  unit: { singular: string; plural: string } | null;
  demo: boolean;
}

/** value: null when nothing in the section has a cost (it reads "—", never "€ 0"). */
interface StockSection { key: string; name: string | null; groups: StockGroup[]; count: number; value: number | null }

type StockSort = 'STOCK_SMART' | 'NAME_ASC' | 'NAME_DESC' | 'STOCK_DESC' | 'STOCK_ASC' | 'EXPECTED' | 'VALUE_DESC' | 'VALUE_ASC';

/** A media query as a signal (removes its listener on destroy). */
function mediaSignal(query: string) {
  const matches = signal(false);
  const list = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
  if (list) {
    matches.set(list.matches);
    const change = (event: MediaQueryListEvent) => matches.set(event.matches);
    list.addEventListener('change', change);
    inject(DestroyRef).onDestroy(() => list.removeEventListener('change', change));
  }
  return matches.asReadonly();
}

/**
 * Voorraad: what lies where, in each product's own unit, and what it is
 * worth at landed cost. The desk is one kit table (category group rows with
 * their value, the series fold, a column per location, Totaal, Onderweg,
 * Waarde); the phone is inset groups with a location segment. Every booking
 * goes through Voorraad boeken; the "Aantallen bewerken" mode books a typed
 * count on leaving the field, guarded and with undo. Styles:
 * styles/products/_stock.scss (styleUrl, scoped under app-stock-page).
 */
@Component({
  selector: 'app-stock-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onDocumentKey($event)' },
  imports: [NgTemplateOutlet, RouterLink, AuthImage, PageHeader, Skeleton, Icon, Segmented, ContextMenu, NumPipe, EurPipe, DateNlPipe, DateTimeNlPipe,
    Sheet, LoadError, StockBookingSheet],
  template: `
    <app-page-header [showBack]="true" backTo="/products" title="Voorraad" [subtitle]="loading() || loadError() ? '' : (desktop.active() ? subtitle() : phoneCaption())">
      @if (desktop.active()) {
        <label class="wk-search sk-search">
          <app-icon name="search" [size]="15" />
          <input type="search" data-page-search placeholder="Zoek naam, SKU of kleur" aria-label="Voorraad zoeken"
                 [value]="query()" (input)="setQuery($any($event.target).value)" (keydown.escape)="clearSearch($event)" />
          <button class="wk-search__clear" type="button" aria-label="Zoekterm wissen" (click)="setQuery('')"><app-icon name="close" [size]="13" /></button>
          <span class="wk-kbd" aria-hidden="true">/</span>
        </label>
        <a class="btn btn--sm" routerLink="/stock/inventaris" title="Jaarinventaris"><app-icon name="list" [size]="16" /><span class="sk-tool__label">Jaarinventaris</span></a>
      }
      @if (editing()) {
        <button class="btn btn--primary btn--sm" type="button" (click)="editing.set(false)">Klaar</button>
      } @else {
        <button class="btn btn--sm" type="button" [disabled]="loading() || !!loadError()" (click)="editing.set(true)">{{ desktop.active() ? 'Aantallen bewerken' : 'Bewerken' }}</button>
      }
    </app-page-header>

    @if (desktop.active()) {
      <div class="content sk-content">
        @if (!loading() && !loadError()) {
          <!-- What the stock is worth: the total at landed cost, per location, what is on the way and what has no cost. -->
          <div class="sk-sum" role="group" aria-label="Voorraadwaarde">
            <div [title]="'Voorraad op alle locaties × de gelande kostprijs van vandaag. De jaarinventaris waardeert per container (FIFO).'">
              <small>Waarde tegen kostprijs</small><strong>{{ totalValue().value | eur: 0 }}</strong><span>alle locaties × gelande kostprijs</span>
            </div>
            @for (location of summaryLocations(); track location.id) {
              <div><small>{{ location.name }}</small><strong>{{ (valueByLocation().get(location.id!) ?? 0) | eur: 0 }}</strong>
                <span>{{ location.kindLabel || (location.kind === 'WAREHOUSE' ? 'Magazijn' : 'Verkooppunt') }} · {{ location.countsForWebsite ? 'alle verkoopkanalen' : 'enkel ter plaatse' }}</span></div>
            }
            @if (moreLocations(); as more) {
              <div><small>Andere locaties</small><strong>+{{ more }} locaties</strong><span>kies ze in de keuzebalk</span></div>
            }
            <div><small>Onderweg</small><strong>{{ onwayProducts() }} product{{ onwayProducts() === 1 ? '' : 'en' }}</strong><span>op {{ onwayOrders() }} inkooporder{{ onwayOrders() === 1 ? '' : 's' }}</span></div>
            @if (totalValue().withoutCost; as missing) {
              <div class="sk-sum__warn"><small>Zonder kostprijs</small><strong>{{ missing }} product{{ missing === 1 ? '' : 'en' }}</strong><span>met voorraad, niet in de waarde</span></div>
            }
          </div>
        }

        <div class="wk-subbar sk-subbar">
          @if (activeLocations().length > 1) {
            <app-segmented label="Locatie" [options]="locationOptions()" [value]="view() === null ? 'all' : '' + view()" (changed)="setView($event)" />
          }
          <button class="wk-chip" type="button" aria-haspopup="menu" [attr.aria-pressed]="categoryFilter() !== null" (click)="openMenu($event, null)">
            {{ categoryLabel() }} <app-icon name="chevron-down" [size]="13" /></button>
          <button class="wk-chip" type="button" [attr.aria-pressed]="hideEmpty()" (click)="hideEmpty.set(!hideEmpty())">Leeg verbergen</button>
          <div class="wk-subbar__end sk-subbar__end">
            @if (hasFilters()) { <button class="wk-link" type="button" (click)="resetFilters()">Filters wissen</button> }
            <a class="wk-link" routerLink="/stock-locations">Locaties beheren ›</a>
          </div>
        </div>

        @if (editing()) {
          <div class="sk-editbar" role="status">
            <!-- Below 1360 with three or more locations the columns fold into the segment: there is a location to choose first (B4). -->
            <span>{{ shownLocations().length
              ? 'Typ het getelde aantal en verlaat het veld: het boekt meteen als correctie. Leeg of ongeldig zet het oude aantal terug.'
              : 'Kies een locatie in de keuzebalk om te tellen. Typ dan het getelde aantal en verlaat het veld: het boekt meteen als correctie.' }}</span>
            <button class="btn btn--primary btn--sm" type="button" (click)="editing.set(false)">Klaar</button>
          </div>
        }

        <div class="wk-card sk-card">
          @if (loadError(); as error) {
            <app-load-error [message]="error" [busy]="loading()" (retry)="reload()" />
          } @else if (loading()) {
            <app-skeleton kind="table" [rows]="8" />
          } @else if (!sections().length && !demoGroups().length) {
            <div class="wk-empty">
              <div class="wk-empty__icon"><app-icon name="search" [size]="22" /></div>
              <h2 class="wk-empty__title">Geen producten gevonden</h2>
              <p class="wk-empty__text">Pas je zoekopdracht of filters aan.</p>
              <div class="wk-empty__actions"><button class="wk-btn" type="button" (click)="resetFilters()">Filters wissen</button></div>
            </div>
          } @else {
            <div class="wk-table sk-table mo-fade" role="table" aria-label="Voorraad" [style.--wk-cols]="columns()" (keydown)="onTableKey($event)" (focusin)="onTableFocus($event)">
              <div class="wk-thead" role="row">
                <span class="wk-th" role="columnheader"><span class="sr-only">Foto</span></span>
                <span class="wk-th" role="columnheader" [attr.aria-sort]="ariaSort('NAME_ASC', 'NAME_DESC')"><button class="wk-th__btn" type="button" (click)="sortBy('NAME_ASC', 'NAME_DESC')">Product</button></span>
                @for (location of shownLocations(); track location.id) {
                  <span class="wk-th wk-th--num" role="columnheader"><span class="sk-th-wrap">{{ location.name }}</span></span>
                }
                <span class="wk-th wk-th--num" role="columnheader" [attr.aria-sort]="ariaSort('STOCK_DESC', 'STOCK_ASC')"><button class="wk-th__btn" type="button" (click)="sortBy('STOCK_DESC', 'STOCK_ASC')">Totaal</button></span>
                @if (!narrow()) {
                  <span class="wk-th wk-th--num" role="columnheader" [attr.aria-sort]="sortKey() === 'EXPECTED' ? 'descending' : null">
                    <button class="wk-th__btn" type="button" title="Te verwachten eerst" (click)="sortBy('EXPECTED', null)">Onderweg</button></span>
                }
                <span class="wk-th wk-th--num" role="columnheader" [attr.aria-sort]="ariaSort('VALUE_DESC', 'VALUE_ASC')"><button class="wk-th__btn" type="button" (click)="sortBy('VALUE_DESC', 'VALUE_ASC')">Waarde</button></span>
                <span class="wk-th" role="columnheader"><span class="sr-only">Acties</span></span>
              </div>
              @for (section of sections(); track section.key) {
                @if (section.name !== null) {
                  <div class="wk-group sk-group" role="row">
                    <span class="wk-group__label sk-group__label" role="cell">{{ section.name }} <span class="wk-group__count">{{ section.count }} product{{ section.count === 1 ? '' : 'en' }}</span></span>
                    <span class="sk-gvalue" role="cell" [class.none]="section.value === null">{{ section.value === null ? '—' : (section.value | eur: 0) }}</span>
                  </div>
                }
                @for (group of section.groups; track group.key) {
                  <ng-container *ngTemplateOutlet="deskGroup; context: { $implicit: group }" />
                }
              }
              @if (demoGroups().length) {
                <div class="wk-group sk-group" role="row">
                  <span class="wk-group__label sk-group__label" role="cell">
                    <button class="wk-group__toggle" type="button" [attr.aria-expanded]="showDemo()" aria-label="Demoproducten tonen of verbergen" (click)="demoOpen.set(!showDemo())"><app-icon name="chevron-down" [size]="14" /></button>
                    Demoproducten <span class="wk-group__count">{{ demoCount() }}</span></span>
                  <span class="sk-gvalue" role="cell" [class.none]="demoValue() === null">{{ demoValue() === null ? '—' : (demoValue() | eur: 0) }}</span>
                </div>
                @if (showDemo()) {
                  @for (group of demoGroups(); track group.key) {
                    <ng-container *ngTemplateOutlet="deskGroup; context: { $implicit: group }" />
                  }
                }
              }
            </div>
          }
        </div>
      </div>
    } @else {
      <div class="content skp">
        @if (activeLocations().length > 1 && activeLocations().length <= 3) {
          <div class="skp-seg"><app-segmented variant="ios" label="Locatie" [options]="phoneLocationOptions()" [value]="view() === null ? 'all' : '' + view()" (changed)="setView($event)" /></div>
        } @else if (activeLocations().length > 3) {
          <div class="skp-seg"><button class="ios-capsule ios-capsule--sm ios-capsule--tinted" type="button" (click)="openMenu($event, 'location')">{{ view() === null ? 'Alle locaties' : locationName(view()!) }} ▾</button></div>
        }
        <div class="ios-search skp-search"><label class="ios-search__field"><app-icon name="search" [size]="16" />
          <input type="search" placeholder="Zoek naam, SKU of kleur" aria-label="Voorraad zoeken" [value]="query()" (input)="setQuery($any($event.target).value)" />
          <button class="ios-search__clear" type="button" aria-label="Zoekterm wissen" (click)="setQuery('')"><app-icon name="close" [size]="14" /></button></label></div>
        <div class="ios-chips" role="group" aria-label="Categorie">
          <button class="ios-chip" type="button" [attr.aria-pressed]="categoryFilter() === null" (click)="categoryFilter.set(null)">Alle</button>
          @for (category of usedCategories(); track category.key) {
            <button class="ios-chip" type="button" [attr.aria-pressed]="categoryFilter() === category.id" (click)="categoryFilter.set(category.id)">{{ category.name }}</button>
          }
        </div>
        @if (editing()) {
          <div class="ios-banner skp-editbar" role="status">{{ editLocation() === null
            ? 'Kies hierboven een locatie en typ het getelde aantal; het boekt meteen als correctie.'
            : 'Typ het getelde aantal en verlaat het veld: het boekt meteen als correctie. Leeg of ongeldig zet het oude aantal terug.' }}</div>
        }
        @if (loadError(); as error) {
          <app-load-error [message]="error" [busy]="loading()" (retry)="reload()" />
        } @else if (loading()) {
          <app-skeleton kind="group" [rows]="6" />
        } @else {
          @for (section of sections(); track section.key) {
            <section class="ios-section">
              @if (section.name !== null) {
                <div class="ios-section__head"><h2>{{ section.name }}</h2><span class="ios-section__trail">{{ section.value === null ? '—' : (section.value | eur: 0) }}</span></div>
              }
              <div class="ios-group ios-group--thumbs">
                @for (group of section.groups; track group.key) {
                  <ng-container *ngTemplateOutlet="phoneGroup; context: { $implicit: group }" />
                }
              </div>
            </section>
          } @empty {
            @if (!demoGroups().length) {
              <div class="ios-empty">
                <span class="ios-empty__icon"><app-icon name="search" [size]="26" /></span>
                <p class="ios-empty__title">Geen producten gevonden</p>
                <p class="ios-empty__text">Pas je zoekopdracht of filters aan.</p>
                <button class="ios-capsule ios-capsule--tinted" type="button" (click)="resetFilters()">Filters wissen</button>
              </div>
            }
          }
          @if (demoGroups().length) {
            <section class="ios-section">
              <button class="ios-section__head skp-demo__head" type="button" [attr.aria-expanded]="showDemo()" (click)="demoOpen.set(!showDemo())">
                <h2>Demoproducten</h2><span class="ios-section__trail">{{ demoValue() === null ? '—' : (demoValue() | eur: 0) }}</span></button>
              @if (showDemo()) {
                <div class="ios-group ios-group--thumbs">
                  @for (group of demoGroups(); track group.key) {
                    <ng-container *ngTemplateOutlet="phoneGroup; context: { $implicit: group }" />
                  }
                </div>
              }
            </section>
          }
        }
      </div>
    }

    <!-- ===== desk rows ===== -->
    <ng-template #deskGroup let-group>
      @if (group.rows.length === 1) {
        <ng-container *ngTemplateOutlet="deskRow; context: { $implicit: group.rows[0], nested: false }" />
      } @else {
        @let open = isOpen(group);
        <div class="wk-tr wk-tr--link sk-tr sk-tr--head" role="row" [attr.tabindex]="rowTab('h:' + group.key)" [attr.aria-expanded]="open" [attr.data-row]="'h:' + group.key" (click)="toggle(group)">
          <span class="wk-td" role="cell">
            @if (group.photo) { <img class="sk-thumb" [appAuthSrc]="group.photo" alt="" draggable="false" /> } @else { <span class="sk-thumb sk-thumb--empty" aria-hidden="true">◈</span> }
          </span>
          <span class="wk-td sk-cell sk-cell--name" role="cell">
            <b class="sk-name">{{ group.name }}</b>
            <span class="sk-sub"><span class="sk-fold" [class.sk-fold--open]="open">{{ group.colours.length > 1 ? group.colours.length + ' kleuren' : group.rows.length + ' varianten' }} <app-icon name="chevron-right" [size]="13" /></span>
              @if (group.colours.length) {
                <span class="sk-dots" aria-hidden="true">@for (colour of group.colours.slice(0, 8); track colour.name) { <i [style.background]="colour.hex || 'var(--surface-2)'" [title]="colour.name"></i> }</span>
              }</span>
          </span>
          @for (location of shownLocations(); track location.id) {
            <span class="wk-td wk-td--num sk-cell" role="cell"><span class="sk-loc" [class.zero]="!group.byLocation.get(location.id)">{{ (group.byLocation.get(location.id) ?? 0) | num }}</span></span>
          }
          <span class="wk-td wk-td--num sk-cell" role="cell">
            <span class="sk-total">{{ group.total | num }}</span>
            @if (group.unit) { <span class="sk-unit">{{ group.total === 1 ? group.unit.singular : group.unit.plural }}</span> }
            @if (splitLine(group.byLocation); as split) { <span class="sk-unit">{{ split }}</span> }
            @if (narrow() && group.onway) { <ng-container *ngTemplateOutlet="under; context: { $implicit: group.onway }" /> }
          </span>
          @if (!narrow()) {
            <span class="wk-td wk-td--num sk-cell" role="cell"><ng-container *ngTemplateOutlet="onwayCell; context: { $implicit: group.onway }" /></span>
          }
          <span class="wk-td wk-td--num sk-cell" role="cell"><span class="sk-value" [class.none]="group.value === null">{{ group.value === null ? '—' : (group.value | eur: 0) }}</span></span>
          <span class="wk-td" role="cell"></span>
        </div>
        @if (open) {
          @for (row of group.rows; track row.product.id) {
            <ng-container *ngTemplateOutlet="deskRow; context: { $implicit: row, nested: true }" />
          }
        }
      }
    </ng-template>

    <ng-template #deskRow let-row let-nested="nested">
      @let exp = expectedFor(row.product.id);
      @let onway = exp ? { quantity: exp.quantity, earliest: exp.expectedArrival, orderNumbers: exp.orderNumbers, orderIds: exp.orderIds } : null;
      <div class="wk-tr wk-tr--link sk-tr" role="row" [attr.tabindex]="rowTab('p:' + row.product.id)" [class.wk-tr--sub]="nested" [class.sk-tr--variant]="nested"
           [attr.data-row]="'p:' + row.product.id" (click)="rowClick($event, row)"
           [animate.enter]="nested ? 'mo-enter' : ''">
        <span class="wk-td" role="cell">
          @if (salesPhotoUrl(row.product); as photo) { <img class="sk-thumb" [class.sk-thumb--sm]="nested" [appAuthSrc]="photo" alt="" draggable="false" /> }
          @else { <span class="sk-thumb sk-thumb--empty" [class.sk-thumb--sm]="nested" aria-hidden="true">◈</span> }
        </span>
        <span class="wk-td sk-cell sk-cell--name" role="cell">
          @if (nested) {
            <b class="sk-name">@if (colourHex(row.product); as hex) { <i class="sk-cdot" [style.background]="hex" aria-hidden="true"></i> }{{ variantLabel(row.product) || row.product.name }}</b>
            <span class="sk-sub mono">{{ row.product.sku || 'Geen SKU' }}</span>
          } @else {
            <b class="sk-name">{{ row.product.name }}</b>
            <span class="sk-sub">{{ productMeta(row.product) }}</span>
          }
        </span>
        @for (location of shownLocations(); track location.id) {
          <span class="wk-td wk-td--num sk-cell" role="cell">
            @if (editing()) {
              <input class="sk-qty" type="text" inputmode="numeric" autocomplete="off" [attr.aria-label]="row.product.name + ' op ' + location.name"
                     [value]="row.byLocation.get(location.id) ?? 0" (click)="$event.stopPropagation()"
                     (keydown.enter)="$any($event.target).blur()"
                     (keydown.escape)="$any($event.target).value = row.byLocation.get(location.id) ?? 0; $any($event.target).blur()"
                     (change)="setQuantity(row, location.id, $any($event.target))" />
            } @else {
              <span class="sk-loc" [class.zero]="!row.byLocation.get(location.id)">{{ (row.byLocation.get(location.id) ?? 0) | num }}</span>
            }
          </span>
        }
        <span class="wk-td wk-td--num sk-cell" role="cell">
          <span class="sk-total">{{ row.total | num }}</span>
          <span class="sk-unit">{{ row.total === 1 ? unitOf(row.product).singular : unitOf(row.product).plural }}</span>
          @if (splitLine(row.byLocation); as split) { <span class="sk-unit">{{ split }}</span> }
          @if (narrow() && onway) { <ng-container *ngTemplateOutlet="under; context: { $implicit: onway }" /> }
        </span>
        @if (!narrow()) {
          <span class="wk-td wk-td--num sk-cell" role="cell"><ng-container *ngTemplateOutlet="onwayCell; context: { $implicit: onway }" /></span>
        }
        <span class="wk-td wk-td--num sk-cell" role="cell"><span class="sk-value" [class.none]="row.value === null">{{ row.value === null ? '—' : (row.value | eur: 0) }}</span></span>
        <span class="wk-td wk-td--actions sk-act" role="cell">
          @if (editing()) {
            <button class="wk-btn wk-btn--sm wk-btn--icon sk-issue" type="button" title="Beschadigd, tekort of demo boeken"
                    [attr.aria-label]="'Beschadigd, tekort of demo boeken voor ' + row.product.name" (click)="$event.stopPropagation(); openBooking(row, 'DAMAGED', view())">!</button>
          } @else {
            @if (activeLocations().length > 1) {
              <button class="wk-btn wk-btn--ghost wk-btn--sm wk-btn--icon" type="button" title="Verplaatsen" aria-label="Verplaatsen" tabindex="-1"
                      (click)="$event.stopPropagation(); openBooking(row, 'TRANSFER', view())"><app-icon name="exchange" [size]="15" /></button>
            }
            <button class="wk-btn wk-btn--ghost wk-btn--sm wk-btn--icon" type="button" [attr.aria-label]="'Acties voor ' + row.product.name" tabindex="-1"
                    (click)="$event.stopPropagation(); openMenu($event, row)"><app-icon name="more" [size]="15" /></button>
          }
        </span>
      </div>
    </ng-template>

    <!-- Below 1360 Onderweg folds under Totaal (B4), the date on its own line. -->
    <ng-template #under let-onway>
      <span class="sk-under" [attr.title]="'Op ' + onway.orderNumbers.join(', ')"><span class="sk-exp">+{{ onway.quantity | num }} verwacht</span>
        @if (onway.earliest) { <span>{{ onway.earliest | dateNl }}</span> }</span>
    </ng-template>
    <ng-template #onwayCell let-onway>
      @if (onway) {
        <span class="sk-exp" [attr.title]="'Op ' + onway.orderNumbers.join(', ')">+{{ onway.quantity | num }}</span>
        <span class="sk-unit">{{ onway.earliest ? (onway.earliest | dateNl) : ordersLabel(onway.orderNumbers) }}</span>
      } @else { <span class="sk-loc zero">—</span> }
    </ng-template>

    <!-- ===== phone rows ===== -->
    <ng-template #phoneGroup let-group>
      @if (group.rows.length === 1) {
        <ng-container *ngTemplateOutlet="phoneRow; context: { $implicit: group.rows[0], nested: false }" />
      } @else {
        @let open = isOpen(group);
        <button class="skp-row" type="button" [class.skp-row--open]="open" [attr.aria-expanded]="open" (click)="toggle(group)">
          @if (group.photo) { <img class="ios-thumb" [appAuthSrc]="group.photo" alt="" draggable="false" /> } @else { <span class="ios-thumb skp-thumb--empty" aria-hidden="true">◈</span> }
          <span class="skp-body">
            <span class="skp-name">{{ group.name }}</span>
            <span class="skp-meta skp-meta--fold">
              <span>{{ group.colours.length > 1 ? group.colours.length + ' kleuren' : group.rows.length + ' varianten' }}</span>
              @if (group.colours.length) {
                <span class="skp-dots" aria-hidden="true">@for (colour of group.colours.slice(0, 8); track colour.name) { <i [style.background]="colour.hex || 'var(--surface-2)'"></i> }@if (group.colours.length > 8) { <small>+{{ group.colours.length - 8 }}</small> }</span>
              }
              <app-icon class="skp-chev" name="chevron-down" [size]="14" />
            </span>
            @if (phoneFigures(group.byLocation, group.value); as parts) { <ng-container *ngTemplateOutlet="figureLine; context: { $implicit: parts }" /> }
          </span>
          <span class="skp-end">
            <strong [class.zero]="!figureOf(group.byLocation, group.total)">{{ figureOf(group.byLocation, group.total) | num }}</strong>
            @if (group.unit) { <small>{{ figureOf(group.byLocation, group.total) === 1 ? group.unit.singular : group.unit.plural }}</small> }
            @if (group.onway) { <span class="exp">+{{ group.onway.quantity | num }}</span> }
          </span>
        </button>
        @if (open) {
          @for (row of group.rows; track row.product.id) {
            <ng-container *ngTemplateOutlet="phoneRow; context: { $implicit: row, nested: true }" />
          }
        }
      }
    </ng-template>

    <ng-template #phoneRow let-row let-nested="nested">
      @let exp = expectedFor(row.product.id);
      <div class="skp-row skp-row--product" [class.skp-row--nested]="nested" role="button" tabindex="0"
           (click)="rowClick($event, row)" (keydown.enter)="openBook(row)" [animate.enter]="nested ? 'mo-enter' : ''">
        @if (salesPhotoUrl(row.product); as photo) { <img class="ios-thumb" [class.ios-thumb--sm]="nested" [appAuthSrc]="photo" alt="" draggable="false" /> }
        @else { <span class="ios-thumb skp-thumb--empty" [class.ios-thumb--sm]="nested" aria-hidden="true">◈</span> }
        <span class="skp-body">
          @if (nested) {
            <span class="skp-name skp-name--variant">@if (colourHex(row.product); as hex) { <i class="skp-cdot" [style.background]="hex" aria-hidden="true"></i> }{{ variantLabel(row.product) || row.product.name }}</span>
          } @else {
            <span class="skp-name">{{ row.product.name }}</span>
          }
          <span class="skp-meta">{{ nested ? (row.product.sku || 'Geen SKU') : productMeta(row.product) }}</span>
          @if (phoneFigures(row.byLocation, row.value); as parts) { <ng-container *ngTemplateOutlet="figureLine; context: { $implicit: parts }" /> }
        </span>
        <span class="skp-end">
          @if (editing() && editLocation() !== null) {
            <input class="skp-qty" type="text" inputmode="numeric" autocomplete="off" [attr.aria-label]="row.product.name + ' op ' + locationName(editLocation()!)"
                   [value]="row.byLocation.get(editLocation()!) ?? 0" (click)="$event.stopPropagation()"
                   (keydown.enter)="$event.stopPropagation(); $any($event.target).blur()" (change)="setQuantity(row, editLocation()!, $any($event.target))" />
          } @else {
            <strong [class.zero]="!figureOf(row.byLocation, row.total)">{{ figureOf(row.byLocation, row.total) | num }}</strong>
          }
          <small>{{ figureOf(row.byLocation, row.total) === 1 ? unitOf(row.product).singular : unitOf(row.product).plural }}</small>
          @if (exp) { <span class="exp">+{{ exp.quantity | num }}</span> }
        </span>
        <!-- One tap to move between locations, as before the redesign. -->
        @if (!editing() && activeLocations().length > 1) {
          <button class="skp-move" type="button" title="Verplaatsen" [attr.aria-label]="'Verplaatsen: ' + row.product.name"
                  (click)="$event.stopPropagation(); openBooking(row, 'TRANSFER', view())" (keydown.enter)="$event.stopPropagation()">
            <app-icon name="exchange" [size]="16" /></button>
        }
      </div>
    </ng-template>

    <!-- The second meta line: each location with its figure (and the value) kept on one line. -->
    <ng-template #figureLine let-parts>
      <span class="skp-meta skp-meta--figs">@for (part of parts; track $index) {@if (!$first) { · }<span class="skp-nw">{{ part }}</span>}</span>
    </ng-template>

    <!-- One sheet per product: the figures per location, the actions and
         the book. Voorraad boeken opens on top of it (the sheet stack). -->
    @if (book(); as book) {
      <app-sheet [title]="book.row.product.name" [variant]="desktop.active() ? 'default' : 'ios'" (closed)="closeBook()">
        <div body class="sk-book">
          <p class="book-sub">{{ book.row.product.sku || 'Geen SKU' }}@if (book.row.product.colour) { · {{ book.row.product.colour }}}
            · <b>{{ book.row.total | num }} {{ book.row.total === 1 ? unitOf(book.row.product).singular : unitOf(book.row.product).plural }}</b></p>
          <div class="history-levels">
            @for (location of activeLocations(); track location.id) {
              <!-- Read-only: a tap opens Hertelling for that location, with the effect shown first. -->
              <button class="history-levels__tile history-levels__tile--button" type="button"
                      [attr.aria-label]="'Hertelling op ' + location.name"
                      (click)="openBooking(book.row, 'RECOUNT', location.id)">
                <small>{{ location.name }}</small>
                <b class="history-levels__qty num">{{ (book.row.byLocation.get(location.id!) ?? 0) | num }}</b>
              </button>
            }
            @if (expectedFor(book.row.product.id!); as exp) {
              <a class="history-levels__link" [routerLink]="['/purchasing', exp.orderIds[0]]" (click)="closeBook()"
                 [attr.title]="'Open ' + exp.orderNumbers.join(', ')">
                <small>Te verwachten</small><b class="num expected">+{{ exp.quantity | num }}</b>
                <em>{{ exp.orderNumbers.join(', ') }}{{ exp.expectedArrival ? ' · ' + (exp.expectedArrival | dateNl) : '' }} ›</em>
              </a>
            }
          </div>
          <p class="hint">{{ desktop.active() ? 'Klik' : 'Tik' }} een locatie aan voor een hertelling.</p>

          <div class="book-actions" role="group" aria-label="Acties">
            <button class="book-action" type="button" (click)="openBooking(book.row, 'RECOUNT', view())">
              <i aria-hidden="true">=</i><span>Hertelling</span>
            </button>
            @if (activeLocations().length > 1) {
              <button class="book-action" type="button" (click)="openBooking(book.row, 'TRANSFER', view())">
                <i aria-hidden="true">⇄</i><span>Verplaatsen</span>
              </button>
            }
            <button class="book-action" type="button" (click)="openBooking(book.row, 'DAMAGED', view())">
              <i aria-hidden="true" class="book-action__warn">!</i><span>Beschadigd / Demo</span>
            </button>
            <a class="book-action" [routerLink]="['/products', book.row.product.id]" (click)="closeBook()">
              <i aria-hidden="true">›</i><span>Product</span>
            </a>
          </div>

          <h3 class="history-title">Geschiedenis</h3>
          @if (book.moves; as moves) {
            @if (moves.length) {
              <ol class="history-list">
                @for (move of historyOpen() ? moves : moves.slice(0, 2); track move.id) {
                  <li>
                    <span class="history-delta num" [class.history-delta--minus]="move.delta < 0">{{ move.delta > 0 ? '+' : '' }}{{ move.delta | num }}</span>
                    <span class="history-what">
                      <b>{{ move.kindLabel }}@if (move.reference) { · {{ move.reference }}}</b>
                      <small>{{ move.at | dateTimeNl }} · {{ move.actor }}@if (move.locationName) { · {{ move.locationName }}}</small>
                    </span>
                    <span class="history-after num">= {{ move.quantityAfter | num }}</span>
                  </li>
                }
              </ol>
              @if (moves.length > 2) {
                <button class="history-more" type="button" [attr.aria-expanded]="historyOpen()" (click)="historyOpen.set(!historyOpen())">
                  {{ historyOpen() ? 'Minder tonen' : 'Alles tonen (' + moves.length + ')' }}
                </button>
              }
            } @else { <p class="hint">Nog geen bewegingen geboekt.</p> }
          } @else { <app-skeleton kind="lines" [rows]="2" /> }
        </div>
        <div foot style="display:contents">
          <span class="spacer"></span>
          <button class="btn" type="button" (click)="closeBook()">Sluiten</button>
        </div>
      </app-sheet>
    }

    <!-- Voorraad boeken, a sibling at page level (stacked over the product sheet when that is open). -->
    @if (booking(); as open) {
      <app-stock-booking-sheet [product]="open.row.product" [levels]="open.levels" [kind]="open.kind" [locationId]="open.locationId"
                               (booked)="onBooked($event)" (closed)="bookingFor.set(null)" />
    }
    @if (menu(); as open) {
      <app-context-menu [title]="open.title" [anchor]="open.at" [items]="open.items" [variant]="desktop.active() ? 'default' : 'ios'"
                        cancelLabel="Annuleren" (pick)="pickMenu($event)" (closed)="menu.set(null)" />
    }
  `,
  /* The area partial arrives with this screen's lazy chunk; its rules are scoped under app-stock-page. */
  styleUrl: '../../../styles/products/_stock.scss',
  encapsulation: ViewEncapsulation.None,
})
export class StockPage {
  private readonly catalog = inject(CatalogApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly desktop = inject(DesktopViewport);
  /** Below 1360 Onderweg folds under Totaal and three or more locations fold into the segment (B4). */
  readonly narrow = mediaSignal('(max-width: 1359.98px)');
  private readonly cramped = mediaSignal('(max-width: 1099.98px)');
  /** Thumbnails follow the Hoofdfoto rule, the same photo quotes and invoices print. */
  readonly salesPhotoUrl = salesPhotoUrl;
  /** "bowl" / "bowls": every figure here is in the product's own unit, never "stuks" for all. */
  readonly unitOf = productSalesUnit;
  readonly ordersLabel = onderwegOrdersLabel;

  readonly loading = signal(true);
  /** The page could not load: it says so, with a retry, instead of "Geen producten gevonden". */
  readonly loadError = signal<string | null>(null);
  readonly products = signal<Product[]>([]);
  readonly locations = signal<StockLocation[]>([]);
  readonly levels = signal<StockLevel[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly expected = signal<Map<number, ExpectedStock>>(new Map());
  readonly families = signal<ProductFamily[]>([]);
  private readonly familyNames = computed(() => new Map(this.families().map((family) => [family.id, family.name])));

  readonly query = signal('');
  /** null = every location side by side. */
  readonly view = signal<number | null>(null);
  readonly categoryFilter = signal<number | 'none' | null>(null);
  readonly hideEmpty = signal(false);
  readonly sortKey = signal<StockSort>('STOCK_SMART');
  readonly demoOpen = signal(false);
  readonly editing = signal(false);
  readonly menu = signal<{ title: string; at: MenuPoint; items: ContextMenuItem[]; row: StockRow | null; kind: 'row' | 'category' | 'location' } | null>(null);

  readonly activeLocations = computed(() => this.locations().filter((location) => location.active && location.id !== null)
    .sort((a, b) => a.position - b.position));

  constructor() {
    /* Names each product's unit ("bowls", "displays"); "stuks" until the list arrives. */
    void this.catalog.unitNames().catch(() => undefined);
    /* ?locatie=&q=&categorie= read once, written back with replaceState (no history entry). */
    const params = this.route.snapshot.queryParamMap;
    this.query.set(params.get('q') ?? '');
    const location = Number(params.get('locatie'));
    if (Number.isSafeInteger(location) && location > 0) this.view.set(location);
    const category = params.get('categorie');
    this.categoryFilter.set(category === 'geen' ? 'none' : category && /^\d+$/.test(category) ? Number(category) : null);
    effect(() => {
      const parts: string[] = [];
      if (this.query().trim()) parts.push(`q=${encodeURIComponent(this.query().trim())}`);
      if (this.view() !== null) parts.push(`locatie=${this.view()}`);
      const cat = this.categoryFilter();
      if (cat !== null) parts.push(`categorie=${cat === 'none' ? 'geen' : cat}`);
      const search = parts.join('&');
      untracked(() => {
        const [path, current = ''] = this.location.path().split('?');
        if (path === '/stock' && current !== search) this.location.replaceState('/stock', search);
      });
    });
    void this.load();
  }

  reload(): void {
    if (!this.loading()) void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [products, locations, levels, categories, expected, families] = await Promise.all([
        this.catalog.products(), this.catalog.stockLocations(), this.catalog.stockLevels(),
        this.catalog.categories().catch(() => [] as Category[]),
        this.sourcing.expectedStock().catch(() => [] as ExpectedStock[]),
        this.catalog.productFamilies({ maxAgeMs: 20_000 }).catch(() => [] as ProductFamily[]),
      ]);
      this.families.set(families);
      this.products.set(products);
      this.locations.set(locations);
      this.levels.set(levels);
      this.categories.set(categories);
      this.expected.set(new Map(expected.map((item) => [item.productId, item])));
      if (this.view() !== null && !this.activeLocations().some((location) => location.id === this.view())) this.view.set(null);
    } catch (failure: unknown) {
      this.loadError.set(messageOf(failure, LOAD_ERROR_FALLBACK));
    } finally {
      this.loading.set(false);
    }
  }

  locationName(id: number | null): string {
    return this.locations().find((location) => location.id === id)?.name ?? '';
  }

  expectedFor(productId: number | null): ExpectedStock | null {
    return productId === null ? null : this.expected().get(productId) ?? null;
  }

  colourHex(product: Product): string | null {
    const colour = product.colour?.trim();
    if (!colour) return null;
    return product.colourHex || COLOUR_SWATCHES[colour] || null;
  }

  variantLabel(product: Product): string | null {
    const parts = [product.colour, product.variantSize].map((value) => value?.trim()).filter((value): value is string => Boolean(value));
    return parts.length ? parts.join(' · ') : null;
  }

  productMeta(product: Product): string {
    return [this.variantLabel(product), product.sku || 'Geen SKU'].filter(Boolean).join(' · ');
  }

  /* ---- the rows, their value and their groups ---- */
  readonly rows = computed<StockRow[]>(() => {
    const byProduct = new Map<number, Map<number, number>>();
    for (const level of this.levels()) {
      const map = byProduct.get(level.productId) ?? new Map<number, number>();
      map.set(level.locationId, level.quantity);
      byProduct.set(level.productId, map);
    }
    return this.products()
      .filter((product) => product.active)
      .map((product) => {
        const byLocation = byProduct.get(product.id!) ?? new Map<number, number>();
        let total = 0;
        for (const quantity of byLocation.values()) total += quantity;
        const cost = product.landedCostEur;
        const value = total > 0 && cost !== null && cost > 0 ? Math.round(total * cost * 100) / 100 : null;
        return { product, byLocation, total, value };
      });
  });

  /** Waarde tegen kostprijs over every location (demo pieces with a cost included, N15). */
  readonly totalValue = computed(() => stockValue(this.rows().map((row) => ({ quantity: row.total, cost: row.product.landedCostEur }))));
  readonly valueByLocation = computed(() => locationValues(this.levels().filter((level) => this.rows().some((row) => row.product.id === level.productId)),
    new Map(this.rows().map((row) => [row.product.id!, row.product.landedCostEur]))));
  readonly summaryLocations = computed(() => this.activeLocations().slice(0, 3));
  readonly moreLocations = computed(() => Math.max(0, this.activeLocations().length - 3));
  readonly onwayProducts = computed(() => this.rows().filter((row) => (this.expectedFor(row.product.id)?.quantity ?? 0) > 0).length);
  readonly onwayOrders = computed(() => distinctOrderCount([...this.expected().values()]));

  readonly subtitle = computed(() => {
    const families = new Map<number, number>();
    for (const row of this.rows()) if (row.product.familyId != null) families.set(row.product.familyId, (families.get(row.product.familyId) ?? 0) + 1);
    const series = [...families.values()].filter((count) => count >= 2).length;
    const locations = this.activeLocations().length;
    return `${series ? `${series} reeks${series === 1 ? '' : 'en'} · ` : ''}${locations} locatie${locations === 1 ? '' : 's'}`;
  });
  readonly phoneCaption = computed(() => {
    const locations = this.activeLocations().length;
    return `${this.totalValue().value.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })} tegen kostprijs · ${locations} locatie${locations === 1 ? '' : 's'}`;
  });

  readonly locationOptions = computed<SegmentOption[]>(() => [
    { id: 'all', label: 'Alle locaties' },
    ...this.activeLocations().map((location) => ({ id: String(location.id), label: location.name })),
  ]);
  readonly phoneLocationOptions = computed<SegmentOption[]>(() => [
    { id: 'all', label: 'Alle' },
    ...this.activeLocations().map((location) => ({ id: String(location.id), label: location.name })),
  ]);

  setView(id: string): void {
    this.view.set(id === 'all' ? null : Number(id));
  }

  /** The location columns: the chosen one, all of them, or none below 1360 with three or more (B4). */
  readonly shownLocations = computed(() => {
    const active = this.activeLocations();
    const view = this.view();
    if (view !== null) return active.filter((location) => location.id === view) as (StockLocation & { id: number })[];
    if (this.narrow() && active.length >= 3) return [];
    return active as (StockLocation & { id: number })[];
  });
  /** The phone edit mode books on the chosen location, or the only one. */
  readonly editLocation = computed(() => this.view() ?? (this.activeLocations().length === 1 ? this.activeLocations()[0].id : null));

  readonly columns = computed(() => {
    const count = this.shownLocations().length;
    if (!this.narrow()) return `40px minmax(0,1fr) ${'100px '.repeat(count)}112px 132px 104px 64px`;
    /* Below 1100 (and with the rail) the columns tighten so the table fits the card. */
    if (this.cramped()) return `40px minmax(150px,1fr) ${'88px '.repeat(count)}96px 88px 56px`;
    return `40px minmax(220px,1fr) ${'88px '.repeat(count)}104px 96px 56px`;
  });

  /** "Zaltbommel 1.960 · Tica Brussel 8": only when the location columns are folded away and two locations hold stock. */
  splitLine(byLocation: Map<number, number>): string | null {
    if (this.shownLocations().length || this.view() !== null) return null;
    const entries = this.activeLocations().map((location) => ({ name: location.name, quantity: byLocation.get(location.id!) ?? 0 }));
    return entries.filter((entry) => entry.quantity).length >= 2 ? locationSplit(entries) : null;
  }

  /** Phone: the figure of the chosen segment, else the total. */
  figureOf(byLocation: Map<number, number>, total: number): number {
    const view = this.view();
    return view === null ? total : byLocation.get(view) ?? 0;
  }

  /**
   * Phone, the second meta line under "4 kleuren" or the SKU: where the
   * stock lies (two or more locations hold it and the segment is Alle) and
   * what it is worth; null when there is neither.
   */
  phoneFigures(byLocation: Map<number, number>, value: number | null): string[] | null {
    const parts: string[] = [];
    if (this.view() === null) {
      /* One part per location that holds stock ("Zaltbommel 1.960"), so a name never parts from its figure. */
      const held = this.activeLocations().map((location) => ({ name: location.name, quantity: byLocation.get(location.id!) ?? 0 }))
        .filter((entry) => entry.quantity !== 0);
      if (held.length >= 2) parts.push(...held.map((entry) => locationSplit([entry])));
    }
    if (value !== null) parts.push(value.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }));
    return parts.length ? parts : null;
  }

  readonly filtered = computed(() => {
    const needle = this.query().trim().toLowerCase();
    const category = this.categoryFilter();
    return this.rows().filter(({ product, total }) =>
      (category === null || (category === 'none' ? product.categoryId == null : product.categoryId === category))
      && (!this.hideEmpty() || total !== 0 || (this.expectedFor(product.id)?.quantity ?? 0) > 0)
      && (!needle || [product.name, product.sku, product.colour, product.variantSize].join(' ').toLowerCase().includes(needle)));
  });

  private readonly groups = computed<StockGroup[]>(() => {
    const byKey = new Map<string, StockGroup>();
    for (const row of this.filtered()) {
      const product = row.product;
      const key = product.familyId == null ? `p${product.id}` : `f${product.familyId}`;
      let group = byKey.get(key);
      if (!group) {
        group = { key, name: (product.familyId != null && this.familyNames().get(product.familyId)) || product.name,
          photo: null, colours: [], rows: [], byLocation: new Map(), total: 0, value: null, onway: null, unit: null, demo: true };
        byKey.set(key, group);
      }
      group.rows.push(row);
      if (!group.photo) group.photo = salesPhotoUrl(product);
      const colour = product.colour?.trim();
      if (colour && !group.colours.some((item) => item.name === colour)) group.colours.push({ name: colour, hex: this.colourHex(product) });
      for (const [locationId, quantity] of row.byLocation) group.byLocation.set(locationId, (group.byLocation.get(locationId) ?? 0) + quantity);
      group.total += row.total;
      if (row.value !== null) group.value = Math.round(((group.value ?? 0) + row.value) * 100) / 100;
      group.demo = group.demo && !!product.demo;
    }
    const groups = [...byKey.values()];
    for (const group of groups) {
      group.onway = onderwegSummary(group.rows.map((row) => this.expectedFor(row.product.id)));
      const units = new Set(group.rows.map((row) => productSalesUnit(row.product).plural));
      group.unit = units.size === 1 ? productSalesUnit(group.rows[0].product) : null;
      group.rows.sort((a, b) => this.compareRows(a, b));
    }
    return groups.sort((a, b) => this.compareGroups(a, b));
  });

  private byName(a: string, b: string): number {
    return a.localeCompare(b, 'nl', { numeric: true, sensitivity: 'base' });
  }

  private compareRows(a: StockRow, b: StockRow): number {
    const tier = (row: StockRow) => row.product.demo ? 3 : row.total > 0 ? 0 : this.expectedFor(row.product.id) ? 1 : 2;
    switch (this.sortKey()) {
      case 'NAME_ASC': return this.byName(a.product.name, b.product.name);
      case 'NAME_DESC': return this.byName(b.product.name, a.product.name);
      case 'STOCK_DESC': return b.total - a.total || this.byName(a.product.name, b.product.name);
      case 'STOCK_ASC': return a.total - b.total || this.byName(a.product.name, b.product.name);
      case 'VALUE_DESC': return (b.value ?? -1) - (a.value ?? -1) || this.byName(a.product.name, b.product.name);
      case 'VALUE_ASC': return (a.value ?? Infinity) - (b.value ?? Infinity) || this.byName(a.product.name, b.product.name);
      case 'EXPECTED': return (this.expectedFor(b.product.id)?.quantity ?? 0) - (this.expectedFor(a.product.id)?.quantity ?? 0) || this.byName(a.product.name, b.product.name);
      default: return tier(a) - tier(b) || b.total - a.total || this.byName(a.product.name, b.product.name);
    }
  }

  /** The list's default order (Standaardvolgorde): stock first, then on the way, then empty, demo last. */
  private compareGroups(a: StockGroup, b: StockGroup): number {
    const tier = (group: StockGroup) => group.demo ? 3 : group.total > 0 ? 0 : group.onway ? 1 : 2;
    switch (this.sortKey()) {
      case 'NAME_ASC': return this.byName(a.name, b.name);
      case 'NAME_DESC': return this.byName(b.name, a.name);
      case 'STOCK_DESC': return b.total - a.total || this.byName(a.name, b.name);
      case 'STOCK_ASC': return a.total - b.total || this.byName(a.name, b.name);
      case 'VALUE_DESC': return (b.value ?? -1) - (a.value ?? -1) || this.byName(a.name, b.name);
      case 'VALUE_ASC': return (a.value ?? Infinity) - (b.value ?? Infinity) || this.byName(a.name, b.name);
      case 'EXPECTED': return (b.onway?.quantity ?? 0) - (a.onway?.quantity ?? 0) || this.byName(a.name, b.name);
      default: return tier(a) - tier(b) || b.total - a.total || this.byName(a.name, b.name);
    }
  }

  /** Fully-demo series and loose demo pieces (also "Zonder categorie" ones) live in the fold at the end. */
  readonly demoGroups = computed(() => this.groups().filter((group) => group.demo));
  readonly showDemo = computed(() => this.demoOpen() || this.query().trim().length > 0);
  readonly demoCount = computed(() => this.demoGroups().reduce((sum, group) => sum + group.rows.length, 0));
  readonly demoValue = computed(() => knownValueSum(this.demoGroups().map((group) => group.value)));

  /** The groups cut into category sections with their value, in the categories' own order; a search shows one list. */
  readonly sections = computed<StockSection[]>(() => {
    const groups = this.groups().filter((group) => !group.demo);
    if (!groups.length) return [];
    const count = (list: StockGroup[]) => list.reduce((sum, group) => sum + group.rows.length, 0);
    const value = (list: StockGroup[]) => knownValueSum(list.map((group) => group.value));
    if (this.query().trim() || this.categoryFilter() !== null) return [{ key: 'all', name: null, groups, count: count(groups), value: value(groups) }];
    const order = new Map(this.categories().map((category, index) => [category.id, index]));
    const byCategory = new Map<number | null, StockGroup[]>();
    for (const group of groups) {
      const id = group.rows[0].product.categoryId ?? null;
      byCategory.set(id, [...(byCategory.get(id) ?? []), group]);
    }
    return [...byCategory.entries()]
      .sort(([a], [b]) => (a === null ? Infinity : order.get(a) ?? Infinity) - (b === null ? Infinity : order.get(b) ?? Infinity))
      .map(([id, list]) => ({
        key: id === null ? 'none' : `c${id}`,
        name: this.categories().find((category) => category.id === id)?.name ?? 'Zonder categorie',
        groups: list, count: count(list), value: value(list),
      }));
  });

  /** The categories that hold products, for the chips and the menu. */
  readonly usedCategories = computed(() => {
    const used = new Set(this.rows().filter((row) => !row.product.demo).map((row) => row.product.categoryId ?? null));
    const list: { key: string; id: number | 'none'; name: string }[] = this.categories()
      .filter((category) => category.id !== null && used.has(category.id))
      .map((category) => ({ key: `c${category.id}`, id: category.id!, name: category.name }));
    if (used.has(null)) list.push({ key: 'none', id: 'none', name: 'Zonder categorie' });
    return list;
  });
  readonly categoryLabel = computed(() => {
    const category = this.categoryFilter();
    return category === null ? 'Categorie' : this.usedCategories().find((item) => item.id === category)?.name ?? 'Categorie';
  });

  /** Which series are folded open; a search opens everything that matches. */
  private readonly openOverrides = signal(new Map<string, boolean>());
  isOpen(group: StockGroup): boolean {
    return this.openOverrides().get(group.key) ?? this.query().trim().length > 0;
  }
  toggle(group: StockGroup): void {
    const open = this.isOpen(group);
    this.openOverrides.update((map) => new Map(map).set(group.key, !open));
  }

  readonly hasFilters = computed(() => this.query().trim().length > 0 || this.categoryFilter() !== null || this.view() !== null || this.hideEmpty());

  resetFilters(): void {
    this.query.set('');
    this.categoryFilter.set(null);
    this.view.set(null);
    this.hideEmpty.set(false);
    this.sortKey.set('STOCK_SMART');
  }

  setQuery(value: string): void {
    this.query.set(value);
  }

  clearSearch(event: Event): void {
    if (!this.query()) { (event.target as HTMLElement).blur(); return; }
    event.preventDefault();
    this.query.set('');
  }

  /** A header click: its order, the reverse, then back to the standard order (Onderweg: "Te verwachten eerst" or standard). */
  sortBy(first: StockSort, second: StockSort | null): void {
    const current = this.sortKey();
    this.sortKey.set(current === first ? (second ?? 'STOCK_SMART') : current === second ? 'STOCK_SMART' : first);
  }

  ariaSort(first: StockSort, second: StockSort): 'ascending' | 'descending' | null {
    const current = this.sortKey();
    if (current !== first && current !== second) return null;
    return current.endsWith('ASC') ? 'ascending' : 'descending';
  }

  /* ---- menus ---- */
  openMenu(event: MouseEvent, row: StockRow | null | 'location'): void {
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const at = { x: row === null ? box.left : box.right, y: box.bottom + 6 };
    if (row === 'location') {
      this.menu.set({ title: 'Locatie', at, row: null, kind: 'location', items: [
        { id: 'all', label: 'Alle locaties', checked: this.view() === null },
        ...this.activeLocations().map((location) => ({ id: String(location.id), label: location.name, checked: this.view() === location.id })),
      ] });
    } else if (row === null) {
      this.menu.set({ title: 'Categorie', at, row: null, kind: 'category', items: [
        { id: 'all', label: 'Alle categorieën', checked: this.categoryFilter() === null },
        ...this.usedCategories().map((category) => ({ id: String(category.id), label: category.name, checked: this.categoryFilter() === category.id })),
      ] });
    } else {
      this.menu.set({ title: row.product.name, at, row, kind: 'row', items: [
        { id: 'book', label: 'Voorraad boeken…', iconName: 'stock' },
        { id: 'history', label: 'Geschiedenis', iconName: 'recent' },
        { id: 'open', label: 'Product openen', iconName: 'chevron-right' },
      ] });
    }
  }

  pickMenu(item: ContextMenuItem): void {
    const open = this.menu();
    this.menu.set(null);
    if (!open) return;
    if (open.kind === 'category') this.categoryFilter.set(item.id === 'all' ? null : item.id === 'none' ? 'none' : Number(item.id));
    else if (open.kind === 'location') this.setView(item.id);
    else if (open.row) {
      if (item.id === 'book') this.openBooking(open.row, 'RECOUNT', this.view());
      else if (item.id === 'history') this.openBook(open.row);
      else void this.router.navigate(['/products', open.row.product.id]);
    }
  }

  /* ---- the stock sheet of one product ---- */
  private readonly bookProductId = signal<number | null>(null);
  private readonly bookMoves = signal<StockMovement[] | null>(null);
  readonly historyOpen = signal(false);

  /** The sheet follows the live row, so a booked figure shows at once. */
  readonly book = computed(() => {
    const id = this.bookProductId();
    if (id === null) return null;
    const row = this.rows().find((item) => item.product.id === id);
    return row ? { row, moves: this.bookMoves() } : null;
  });

  rowClick(event: MouseEvent, row: StockRow): void {
    if ((event.target as Element).closest('a, button, input')) return;
    this.openBook(row);
  }

  openBook(row: StockRow): void {
    this.bookProductId.set(row.product.id!);
    this.historyOpen.set(false);
    void this.loadMoves(row.product.id!);
  }

  closeBook(): void {
    this.bookProductId.set(null);
  }

  private async loadMoves(productId: number): Promise<void> {
    this.bookMoves.set(null);
    try {
      const moves = await this.catalog.stockMovements(productId);
      if (this.bookProductId() === productId) this.bookMoves.set(moves);
    } catch {
      if (this.bookProductId() === productId) this.bookMoves.set([]);
    }
  }

  /* ---- Voorraad boeken ---- */
  readonly bookingFor = signal<{ productId: number; kind: BookingKind; locationId: number | null } | null>(null);
  /** The sheet follows the live row, so its levels are always today's. */
  readonly booking = computed(() => {
    const open = this.bookingFor();
    if (!open) return null;
    const row = this.rows().find((item) => item.product.id === open.productId);
    if (!row) return null;
    const levels: BookingLevel[] = this.activeLocations().map((location) => ({
      locationId: location.id!, name: location.name, quantity: row.byLocation.get(location.id!) ?? 0,
    }));
    return { row, levels, kind: open.kind, locationId: open.locationId };
  });

  openBooking(row: StockRow, kind: BookingKind, locationId: number | null | undefined): void {
    if (kind === 'TRANSFER' && this.activeLocations().length < 2) {
      this.ui.toast('Maak eerst een tweede locatie aan onder Voorraadlocaties', 'err');
      return;
    }
    this.bookingFor.set({ productId: row.product.id!, kind, locationId: locationId ?? null });
  }

  /** After a booking the table and the open product sheet's history tell the new truth. */
  async onBooked(event: StockBooked): Promise<void> {
    const productId = this.bookingFor()?.productId ?? null;
    this.bookingFor.set(null);
    void event;
    try {
      this.levels.set(await this.catalog.stockLevels());
    } catch { /* the toast already said it was booked; the figures catch up on the next load */ }
    if (productId !== null && this.bookProductId() === productId) void this.loadMoves(productId);
  }

  /* ---- keyboard ---- */
  /** '/' focuses the search (until the shell listens everywhere). */
  onDocumentKey(event: KeyboardEvent): void {
    if (event.key !== '/' || !this.desktop.active()) return;
    const context = keyContext(event, null);
    if (context.typing || context.overlayOpen || context.mod) return;
    const field = document.querySelector<HTMLInputElement>('app-stock-page [data-page-search]');
    if (!field) return;
    event.preventDefault();
    field.focus();
  }

  /** The row that takes Tab (roving tabindex): the last focused one while it is on screen, else the first. */
  private readonly focusedRow = signal<string | null>(null);
  private rowKeyOf(group: StockGroup): string {
    return group.rows.length === 1 ? `p:${group.rows[0].product.id}` : `h:${group.key}`;
  }
  private readonly shownRows = computed(() => {
    const keys = new Set<string>();
    const add = (group: StockGroup) => {
      keys.add(this.rowKeyOf(group));
      if (group.rows.length > 1 && this.isOpen(group)) for (const row of group.rows) keys.add(`p:${row.product.id}`);
    };
    for (const section of this.sections()) section.groups.forEach(add);
    if (this.showDemo()) this.demoGroups().forEach(add);
    return keys;
  });
  private readonly firstRow = computed(() => {
    const group = this.sections()[0]?.groups[0] ?? (this.showDemo() ? this.demoGroups()[0] : undefined);
    return group ? this.rowKeyOf(group) : null;
  });

  rowTab(key: string): number {
    return rovingRow(this.focusedRow(), this.shownRows(), this.firstRow()) === key ? 0 : -1;
  }

  onTableFocus(event: FocusEvent): void {
    const key = (event.target as Element).closest<HTMLElement>('[data-row]')?.dataset['row'];
    if (key && key !== this.focusedRow()) this.focusedRow.set(key);
  }

  /** ↑ ↓ through the rows, Enter opens the product sheet (a head folds), B opens Voorraad boeken. */
  onTableKey(event: KeyboardEvent): void {
    const context = keyContext(event, this.element.nativeElement);
    if (context.typing || context.overlayOpen || context.mod || event.altKey) return;
    const row = (event.target as Element).closest<HTMLElement>('[data-row]');
    const key = row?.dataset['row'];
    if (!row || !key) return;
    const rows = [...this.element.nativeElement.querySelectorAll<HTMLElement>('.sk-table [data-row]')];
    const index = rows.indexOf(row);
    const product = key.startsWith('p:') ? this.rows().find((item) => item.product.id === Number(key.slice(2))) ?? null : null;
    if (event.key === 'ArrowDown') { event.preventDefault(); rows[index + 1]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); rows[index - 1]?.focus(); }
    else if (event.key === 'Enter') {
      event.preventDefault();
      if (product) this.openBook(product);
      else { const group = this.groups().find((item) => `h:${item.key}` === key); if (group) this.toggle(group); }
    } else if ((event.key === 'b' || event.key === 'B') && product) {
      event.preventDefault();
      this.openBooking(product, 'RECOUNT', this.view());
    }
  }

  /* ---- typing a count straight into the table ---- */

  /**
   * A figure typed in a cell is booked at once as a manual correction, with
   * an undo on the toast. Empty, letters, a minus or a decimal is no count:
   * the old figure comes back and nothing is booked.
   */
  async setQuantity(row: StockRow, locationId: number, field: HTMLInputElement): Promise<void> {
    const before = row.byLocation.get(locationId) ?? 0;
    const edit = stockCellEdit(field.value, before);
    if (edit.action !== 'book') {
      field.value = String(before);
      if (edit.action === 'revert') this.ui.toast('Niet geboekt: geen geldig aantal', 'err');
      return;
    }
    const productId = row.product.id!;
    const quantity = edit.quantity;
    try {
      await this.catalog.setStock(productId, quantity, locationId, 'Voorraadoverzicht');
      this.storeLevel(productId, locationId, quantity);
      const unit = productSalesUnit(row.product);
      this.ui.toast(`${row.product.name}: ${unitCount(unit, quantity)} op ${this.locationName(locationId)}`, 'ok',
        { label: 'Ongedaan maken', run: () => void this.undoQuantity(productId, locationId, before, quantity) });
    } catch (failure: unknown) {
      field.value = String(before);
      this.ui.toast(messageOf(failure, 'Voorraad zetten mislukt'), 'err');
    }
  }

  /**
   * Puts the old figure back, only while the booked figure still stands on
   * the server: a sale, a receipt or a booking from another screen or device
   * since then is never erased by the absolute write.
   */
  private async undoQuantity(productId: number, locationId: number, before: number, booked: number): Promise<void> {
    let current: number;
    try {
      current = (await this.catalog.productStock(productId)).find((level) => level.locationId === locationId)?.quantity ?? 0;
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Terugzetten mislukt'), 'err');
      return;
    }
    if (!undoAllowed(current, booked)) {
      this.storeLevel(productId, locationId, current);
      this.ui.toast('Niet teruggezet: het aantal is intussen gewijzigd', 'err');
      return;
    }
    try {
      await this.catalog.setStock(productId, before, locationId, 'Ongedaan gemaakt');
      this.storeLevel(productId, locationId, before);
      this.ui.toast(`Teruggezet naar ${before.toLocaleString('nl-BE')}`, 'ok');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Terugzetten mislukt'), 'err');
    }
  }

  private storeLevel(productId: number, locationId: number, quantity: number): void {
    this.levels.update((levels) => {
      const rest = levels.filter((level) => !(level.productId === productId && level.locationId === locationId));
      return [...rest, { productId, locationId, quantity }];
    });
    if (this.bookProductId() === productId) void this.loadMoves(productId);
  }
}
