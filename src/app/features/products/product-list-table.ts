import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { AuthImage } from '../../core/api/auth-image';
import type { ExpectedStock, Product } from '../../core/api/models';
import { ContextMenu, type ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { Icon } from '../../shared/icon';
import { keyContext } from '../../shared/key-context';
import { DateNlPipe, EurPipe, NumPipe } from '../../shared/pipes';
import { onderwegOrdersLabel, productMargin, type Margin, type Onderweg } from './product-figures';
import { headerAriaSort, nextHeaderSort, type ListSort, type SortColumn } from './product-list-query';
import type { productSalesUnit } from './product-sales-unit';

/** One row of the list: a product on its own, or a series that folds its variants away. */
export interface ListGroup {
  key: string;
  name: string;
  products: Product[];
  photo: string | null;
  colours: { name: string; hex: string | null }[];
  stock: number;
  lead: Product;
  priceVaries: boolean;
  costVaries: boolean;
}

export interface ListSection {
  key: string;
  name: string | null;
  count: number;
  groups: ListGroup[];
}

/**
 * What the table reads from the list. The list owns the data, the filters
 * and every action; the table only lays it out and handles the keyboard.
 */
export interface ProductListTableHost {
  sections(): ListSection[];
  demoGroups(): ListGroup[];
  showDemoFold(): boolean;
  demoCount(): number;
  toggleDemo(): void;
  sortKey(): ListSort;
  setSort(sort: ListSort): void;
  isOpen(group: ListGroup): boolean;
  toggle(group: ListGroup): void;
  groupSummary(group: ListGroup): string;
  groupAllDemo(group: ListGroup): boolean;
  groupAttention(group: ListGroup): string | null;
  groupTooltip(group: ListGroup): string;
  groupOnderweg(group: ListGroup): Onderweg | null;
  otherLocationsLine(products: readonly Product[]): string | null;
  colourHex(product: Product): string | null;
  variantLabel(product: Product): string | null;
  productMeta(product: Product): string;
  stockOf(product: Product): number;
  stockLabel(quantity: number | null): string;
  stockBreakdown(product: Product): string | null;
  groupBreakdown(group: ListGroup): string | null;
  expectedFor(product: Product): ExpectedStock | null;
  purchasePrice(product: Product): number | null;
  salesPrice(product: Product): number | null;
  salesUnit: typeof productSalesUnit;
  salesPhotoUrl(product: Product): string | null;
  attentionLabel(product: Product, ownOnly?: boolean): string | null;
  issueTooltip(product: Product, ownOnly: boolean): string;
  publicationActive(product: Product): boolean;
  websiteStatus(product: Product): Product['websiteStatus'];
  orderAppStatus(product: Product): Product['orderAppStatus'];
  familyKnown(): boolean;
  /** The product being deleted: only its row leaves with motion. */
  removingId(): number | null;
  remove(product: Product): void;
}

/** The two channel dots of a row: what is live, in words for the tooltip. */
interface Channels { website: boolean; app: boolean; title: string }

/**
 * Producten on the desk (≥900): one kit table with category group rows,
 * the series fold, sortable headers and the six figures per row. Purely
 * presentational: no styles array (styles/products/_list.scss) and no data
 * of its own.
 */
@Component({
  selector: 'app-product-list-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, RouterLink, AuthImage, Icon, ContextMenu, EurPipe, NumPipe, DateNlPipe],
  template: `
    @let list = host();
    <div class="wk-table pl-table" role="table" aria-label="Producten" (keydown)="onKeydown($event)" (focusin)="onFocusIn($event)">
      <div class="wk-thead" role="row">
        <span class="wk-th" role="columnheader"><span class="sr-only">Foto</span></span>
        <span class="wk-th" role="columnheader" [attr.aria-sort]="ariaSort('name')">
          <button class="wk-th__btn" type="button" (click)="sort('name')">Product @if (ariaSort('name'); as dir) { <app-icon [name]="dir === 'ascending' ? 'chevron-up' : 'chevron-down'" [size]="12" /> }</button>
        </span>
        <span class="wk-th wk-th--num" role="columnheader" [attr.aria-sort]="ariaSort('stock')">
          <button class="wk-th__btn" type="button" (click)="sort('stock')">Voorraad @if (ariaSort('stock'); as dir) { <app-icon [name]="dir === 'ascending' ? 'chevron-up' : 'chevron-down'" [size]="12" /> }</button>
        </span>
        <span class="wk-th wk-th--num pl-col--onderweg" role="columnheader">Onderweg</span>
        <span class="wk-th wk-th--num" role="columnheader" [attr.aria-sort]="ariaSort('cost')">
          <button class="wk-th__btn" type="button" (click)="sort('cost')">Kostprijs @if (ariaSort('cost'); as dir) { <app-icon [name]="dir === 'ascending' ? 'chevron-up' : 'chevron-down'" [size]="12" /> }</button>
        </span>
        <span class="wk-th wk-th--num" role="columnheader" [attr.aria-sort]="ariaSort('price')">
          <button class="wk-th__btn" type="button" (click)="sort('price')">Catalogusprijs @if (ariaSort('price'); as dir) { <app-icon [name]="dir === 'ascending' ? 'chevron-up' : 'chevron-down'" [size]="12" /> }</button>
        </span>
        <span class="wk-th wk-th--num pl-col--marge" role="columnheader">Marge</span>
        <span class="wk-th pl-col--pub" role="columnheader"><span class="pl-pub__head">Publicatie</span><span class="sr-only pl-pub__head--dot">Publicatie</span></span>
        <span class="wk-th" role="columnheader"><span class="sr-only">Acties</span></span>
      </div>

      @for (section of list.sections(); track section.key) {
        @if (section.name !== null) {
          <div class="wk-group" role="row">
            <span class="wk-group__label" role="cell">{{ section.name }} <span class="wk-group__count">{{ sectionCount(section) }}</span></span>
          </div>
        }
        @for (group of section.groups; track group.key) {
          <ng-container *ngTemplateOutlet="groupRows; context: { $implicit: group }" />
        }
      }

      @if (list.demoGroups().length) {
        <div class="wk-group pl-demo" role="row">
          <span class="wk-group__label" role="cell">
            <button class="wk-group__toggle" type="button" [attr.aria-expanded]="list.showDemoFold()" aria-label="Demoproducten tonen of verbergen"
                    (click)="list.toggleDemo()"><app-icon name="chevron-down" [size]="14" /></button>
            Demoproducten <span class="wk-group__count">{{ list.demoCount() }}</span>
          </span>
        </div>
        @if (list.showDemoFold()) {
          @for (group of list.demoGroups(); track group.key) {
            <ng-container *ngTemplateOutlet="groupRows; context: { $implicit: group }" />
          }
        }
      }
    </div>

    <ng-template #groupRows let-group>
      @if (group.products.length === 1) {
        <ng-container *ngTemplateOutlet="productRow; context: { $implicit: group.products[0], nested: false }" />
      } @else {
        @let open = list.isOpen(group);
        @let onway = list.groupOnderweg(group);
        @let margin = marginOf(group.lead);
        @let rowKey = 'h:' + group.key;
        <!-- The whole series head folds (B10); the lead opens through ⋯ › Openen or a variant. -->
        <div class="wk-tr wk-tr--link pl-tr pl-tr--head" role="row" [attr.aria-expanded]="open" [attr.data-row]="rowKey"
             [attr.tabindex]="tabIndexOf(rowKey)" (click)="rowClick($event, group, null)">
          <span class="wk-td" role="cell">
            @if (group.photo) { <img class="pl-thumb" [appAuthSrc]="group.photo" alt="" draggable="false" /> }
            @else { <span class="pl-thumb pl-thumb--empty" aria-hidden="true">◈</span> }
          </span>
          <span class="wk-td pl-cell pl-cell--name" role="cell">
            <span class="pl-name"><b>{{ group.name }}</b>
              @if (list.groupAllDemo(group)) { <span class="wk-pill pl-pill--demo">demo</span> }
              @if (list.groupAttention(group); as attention) { <span class="wk-pill tone-warn pl-pill--narrow" [attr.title]="list.groupTooltip(group)">{{ attention }}</span> }
            </span>
            <span class="pl-sub">
              <span class="pl-fold" [class.pl-fold--open]="open">{{ list.groupSummary(group) }} <app-icon name="chevron-right" [size]="13" /></span>
              @if (group.colours.length) {
                <span class="pl-dots" aria-hidden="true">
                  @for (colour of group.colours.slice(0, 8); track colour.name) {
                    <i [style.background]="colour.hex || 'var(--surface-2)'" [class.pl-dot--empty]="!colour.hex" [title]="colour.name"></i>
                  }
                  @if (group.colours.length > 8) { <small>+{{ group.colours.length - 8 }}</small> }
                </span>
              }
            </span>
          </span>
          <span class="wk-td wk-td--num pl-cell" role="cell" [attr.title]="list.groupBreakdown(group)">
            <span class="pl-num" [class.pl-num--zero]="!group.stock">{{ list.stockLabel(group.stock) }}</span>
            @if (list.otherLocationsLine(group.products); as other) { <span class="pl-cell__sub">{{ other }}</span> }
            @if (onway) { <ng-container *ngTemplateOutlet="under; context: { $implicit: onway }" /> }
          </span>
          <span class="wk-td wk-td--num pl-cell pl-col--onderweg" role="cell">
            <ng-container *ngTemplateOutlet="onwayCell; context: { $implicit: onway }" />
          </span>
          <span class="wk-td wk-td--num pl-cell" role="cell">
            @if (list.purchasePrice(group.lead); as cost) {
              <span class="pl-num">{{ cost | eur }}@if (group.costVaries) {<i class="pl-varies" title="Verschilt per variant">≠</i>}</span>
            } @else { <span class="pl-num pl-num--zero">—</span> }
          </span>
          <span class="wk-td wk-td--num pl-cell" role="cell">
            @if (list.salesPrice(group.lead); as price) {
              <span class="pl-num">{{ price | eur }}@if (group.priceVaries) {<i class="pl-varies" title="Verschilt per variant">≠</i>}</span>
              <span class="pl-cell__sub">per {{ list.salesUnit(group.lead).singular }}</span>
            } @else { <span class="pl-num pl-num--zero">—</span> }
          </span>
          <span class="wk-td wk-td--num pl-cell pl-col--marge" role="cell">
            <ng-container *ngTemplateOutlet="marginCell; context: { $implicit: margin, product: group.lead }" />
          </span>
          <span class="wk-td pl-cell pl-col--pub" role="cell">
            @if (list.groupAttention(group); as attention) {
              <span class="wk-pill tone-warn pl-pill--wide" [attr.title]="list.groupTooltip(group)">{{ attention }}</span>
            } @else if (allInactive(group)) {
              <span class="wk-pill pl-pill--wide">Inactief</span>
            } @else {
              <ng-container *ngTemplateOutlet="channelsCell; context: { $implicit: channelsOf(group.lead) }" />
            }
            <ng-container *ngTemplateOutlet="pubDot; context: { $implicit: channelsOf(group.lead), group: group }" />
          </span>
          <span class="wk-td wk-td--actions" role="cell">
            <button class="wk-btn wk-btn--ghost wk-btn--icon wk-btn--sm" type="button" tabindex="-1" [attr.aria-label]="'Acties voor ' + group.name"
                    (click)="openMenu($event, group.lead, true)"><app-icon name="more" [size]="16" /></button>
          </span>
        </div>
        @if (open) {
          @for (product of group.products; track product.id) {
            <ng-container *ngTemplateOutlet="productRow; context: { $implicit: product, nested: true, head: rowKey }" />
          }
        }
      }
    </ng-template>

    <ng-template #productRow let-product let-nested="nested" let-head="head">
      @let exp = list.expectedFor(product);
      @let onway = exp ? { quantity: exp.quantity, earliest: exp.expectedArrival, orderNumbers: exp.orderNumbers, orderIds: exp.orderIds } : null;
      @let margin = marginOf(product);
      @let rowKey = 'p:' + product.id;
      <div class="wk-tr wk-tr--link pl-tr" role="row" [class.wk-tr--sub]="nested" [class.pl-tr--variant]="nested"
           [class.pl-tr--inactive]="!product.active" [attr.data-row]="rowKey" [attr.data-head]="head || null"
           [attr.tabindex]="tabIndexOf(rowKey)" (click)="rowClick($event, null, product)"
           [animate.enter]="nested ? 'mo-enter' : ''" [animate.leave]="list.removingId() === product.id ? 'mo-leave' : ''">
        <span class="wk-td" role="cell">
          @if (list.salesPhotoUrl(product); as photo) { <img class="pl-thumb" [class.pl-thumb--sm]="nested" [appAuthSrc]="photo" alt="" draggable="false" /> }
          @else { <span class="pl-thumb pl-thumb--empty" [class.pl-thumb--sm]="nested" aria-hidden="true">◈</span> }
        </span>
        <span class="wk-td pl-cell pl-cell--name" role="cell">
          <span class="pl-name">
            @if (nested) {
              @if (list.colourHex(product); as hex) { <i class="pl-cdot" [style.background]="hex" aria-hidden="true"></i> }
              <a class="pl-link" [routerLink]="['/products', product.id]" tabindex="-1"><b>{{ list.variantLabel(product) || product.name }}</b></a>
            } @else {
              <a class="pl-link" [routerLink]="['/products', product.id]" tabindex="-1"><b>{{ product.name }}</b></a>
            }
            @if (product.demo) { <span class="wk-pill pl-pill--demo">demo</span> }
            @if (list.attentionLabel(product, nested); as attention) {
              <span class="wk-pill pl-pill--narrow" [class.tone-warn]="product.active"
                    [attr.title]="product.active ? list.issueTooltip(product, nested) : null">{{ attention }}</span>
            }
          </span>
          <span class="pl-sub">
            @if (nested) { <span class="mono">{{ product.sku || 'Geen SKU' }}</span> }
            @else { <span>{{ list.productMeta(product) }}</span> }
          </span>
        </span>
        <span class="wk-td wk-td--num pl-cell" role="cell" [attr.title]="list.stockBreakdown(product)">
          <span class="pl-num" [class.pl-num--zero]="!list.stockOf(product)">{{ list.stockLabel(list.stockOf(product)) }}</span>
          @if (list.otherLocationsLine([product]); as other) { <span class="pl-cell__sub">{{ other }}</span> }
          @if (onway) { <ng-container *ngTemplateOutlet="under; context: { $implicit: onway }" /> }
        </span>
        <span class="wk-td wk-td--num pl-cell pl-col--onderweg" role="cell">
          <ng-container *ngTemplateOutlet="onwayCell; context: { $implicit: onway }" />
        </span>
        <span class="wk-td wk-td--num pl-cell" role="cell">
          @if (list.purchasePrice(product); as cost) { <span class="pl-num">{{ cost | eur }}</span> }
          @else { <span class="pl-num pl-num--zero">—</span> }
        </span>
        <span class="wk-td wk-td--num pl-cell" role="cell">
          @if (list.salesPrice(product); as price) {
            <span class="pl-num">{{ price | eur }}</span>
            <span class="pl-cell__sub">per {{ list.salesUnit(product).singular }}</span>
          } @else { <span class="pl-num pl-num--zero">—</span> }
        </span>
        <span class="wk-td wk-td--num pl-cell pl-col--marge" role="cell">
          <ng-container *ngTemplateOutlet="marginCell; context: { $implicit: margin, product: product }" />
        </span>
        <span class="wk-td pl-cell pl-col--pub" role="cell">
          @if (list.attentionLabel(product, nested); as attention) {
            <span class="wk-pill pl-pill--wide" [class.tone-warn]="product.active"
                  [attr.title]="product.active ? list.issueTooltip(product, nested) : null">{{ attention }}</span>
          } @else {
            <ng-container *ngTemplateOutlet="channelsCell; context: { $implicit: channelsOf(product) }" />
          }
          <ng-container *ngTemplateOutlet="pubDot; context: { $implicit: channelsOf(product), group: null }" />
        </span>
        <span class="wk-td wk-td--actions" role="cell">
          <button class="wk-btn wk-btn--ghost wk-btn--icon wk-btn--sm" type="button" tabindex="-1" [attr.aria-label]="'Acties voor ' + product.name"
                  (click)="openMenu($event, product, false)"><app-icon name="more" [size]="16" /></button>
        </span>
      </div>
    </ng-template>

    <!-- Below 1360 Onderweg has no column: it reads under Voorraad, the date on its own line under it (B2). -->
    <ng-template #under let-onway>
      <span class="pl-under" [attr.title]="'Op ' + onway.orderNumbers.join(', ')">
        <span class="pl-exp">+{{ onway.quantity | num }} verwacht</span>
        @if (onway.earliest) { <span class="pl-under__date">{{ onway.earliest | dateNl }}</span> }
      </span>
    </ng-template>

    <ng-template #onwayCell let-onway>
      @if (onway) {
        <span class="pl-num pl-exp" [attr.title]="'Op ' + onway.orderNumbers.join(', ')">+{{ onway.quantity | num }}</span>
        <span class="pl-cell__sub">{{ onway.earliest ? (onway.earliest | dateNl) : ordersLabel(onway.orderNumbers) }}</span>
      } @else { <span class="pl-num pl-num--zero">—</span> }
    </ng-template>

    <ng-template #marginCell let-margin let-product="product">
      @if (margin) {
        <span class="pl-num pl-margin" [class.pl-margin--bad]="margin.eur < 0"
              [attr.title]="(margin.eur | eur) + ' per ' + list.salesUnit(product).singular">{{ margin.pct }} %</span>
      } @else { <span class="pl-num pl-num--zero">—</span> }
    </ng-template>

    <ng-template #channelsCell let-channels>
      <span class="pl-pub" [attr.title]="channels.title">
        <span [class.on]="channels.website"><i></i>Website</span>
        <span [class.on]="channels.app"><i></i>App</span>
      </span>
    </ng-template>

    <ng-template #pubDot let-channels let-group="group">
      <span class="pl-pubdot" [class.on]="channels.website && channels.app" role="img"
            [attr.aria-label]="channels.title" [attr.title]="channels.title"></span>
    </ng-template>

    @if (menu(); as open) {
      <app-context-menu [title]="open.product.name" [anchor]="open.at" [items]="open.items" (pick)="pick($event)" (closed)="menu.set(null)" />
    }
  `,
})
export class ProductListTable {
  readonly host = input.required<ProductListTableHost>();
  private readonly router = inject(Router);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The row that takes Tab (roving tabindex); null = the first row. */
  private readonly focused = signal<string | null>(null);
  readonly menu = signal<{ product: Product; at: MenuPoint; items: ContextMenuItem[] } | null>(null);

  private readonly firstRow = computed(() => {
    const list = this.host();
    const group = list.sections()[0]?.groups[0] ?? (list.showDemoFold() ? list.demoGroups()[0] : undefined);
    if (!group) return null;
    return group.products.length === 1 ? `p:${group.products[0].id}` : `h:${group.key}`;
  });

  tabIndexOf(key: string): number {
    return (this.focused() ?? this.firstRow()) === key ? 0 : -1;
  }

  ariaSort(column: SortColumn): 'ascending' | 'descending' | null {
    return headerAriaSort(column, this.host().sortKey());
  }

  sort(column: SortColumn): void {
    this.host().setSort(nextHeaderSort(column, this.host().sortKey()));
  }

  readonly ordersLabel = onderwegOrdersLabel;

  /** "7 producten · 2 reeksen"; reeksen only when the section has any. */
  sectionCount(section: ListSection): string {
    const series = section.groups.filter((group) => group.products.length > 1).length;
    return `${section.count} product${section.count === 1 ? '' : 'en'}${series ? ` · ${series} reeks${series === 1 ? '' : 'en'}` : ''}`;
  }

  marginOf(product: Product): Margin | null {
    return productMargin(this.host().salesPrice(product), this.host().purchasePrice(product));
  }

  allInactive(group: ListGroup): boolean {
    return group.products.every((product) => !product.active);
  }

  channelsOf(product: Product): Channels {
    const list = this.host();
    const live = list.familyKnown() && list.publicationActive(product);
    const website = live && list.websiteStatus(product) === 'PUBLISHED';
    const app = live && list.orderAppStatus(product) === 'PUBLISHED';
    const title = list.familyKnown()
      ? `Website: ${website ? 'live' : 'niet live'} · Orderapp: ${app ? 'live' : 'niet live'}`
      : 'Publicatiestatus niet geladen';
    return { website, app, title };
  }

  /** A click on a series head folds it; on a product row it opens the product (a link or button inside keeps its own click). */
  rowClick(event: MouseEvent, group: ListGroup | null, product: Product | null): void {
    const target = event.target as Element;
    if (target.closest('a, button')) return;
    if (group) this.host().toggle(group);
    else if (product?.id != null) void this.router.navigate(['/products', product.id]);
  }

  onFocusIn(event: FocusEvent): void {
    const row = (event.target as Element).closest<HTMLElement>('[data-row]');
    const key = row?.dataset['row'];
    if (key && key !== this.focused()) this.focused.set(key);
  }

  private rows(): HTMLElement[] {
    return [...this.element.nativeElement.querySelectorAll<HTMLElement>('[data-row]')];
  }

  private focusRow(row: HTMLElement | undefined): void {
    if (!row) return;
    this.focused.set(row.dataset['row'] ?? null);
    row.focus();
  }

  private groupOf(key: string): ListGroup | null {
    const list = this.host();
    const groupKey = key.slice(2);
    for (const section of list.sections()) {
      const found = section.groups.find((group) => group.key === groupKey);
      if (found) return found;
    }
    return list.demoGroups().find((group) => group.key === groupKey) ?? null;
  }

  private productOf(key: string): Product | null {
    const id = Number(key.slice(2));
    const list = this.host();
    for (const group of [...list.sections().flatMap((section) => section.groups), ...list.demoGroups()]) {
      const found = group.products.find((product) => product.id === id);
      if (found) return found;
    }
    return null;
  }

  /**
   * ↑ ↓ through the rows, → opens a series, ← closes it (or goes to its
   * head), Enter opens (a head folds), E edits, ⌫ / Delete asks to delete a
   * product. Off while typing or with a sheet or menu open.
   */
  onKeydown(event: KeyboardEvent): void {
    const context = keyContext(event, this.element.nativeElement);
    if (context.typing || context.overlayOpen || context.mod || event.altKey) return;
    const row = (event.target as Element).closest<HTMLElement>('[data-row]');
    const key = row?.dataset['row'];
    if (!row || !key) return;
    const isHead = key.startsWith('h:');
    const rows = this.rows();
    const index = rows.indexOf(row);
    const list = this.host();
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); this.focusRow(rows[index + 1]); return;
      case 'ArrowUp': event.preventDefault(); this.focusRow(rows[index - 1]); return;
      case 'ArrowRight': {
        const group = isHead ? this.groupOf(key) : null;
        if (group && !list.isOpen(group)) { event.preventDefault(); list.toggle(group); }
        return;
      }
      case 'ArrowLeft': {
        event.preventDefault();
        if (isHead) {
          const group = this.groupOf(key);
          if (group && list.isOpen(group)) list.toggle(group);
        } else if (row.dataset['head']) {
          this.focusRow(rows.find((item) => item.dataset['row'] === row.dataset['head']));
        }
        return;
      }
      case 'Enter': {
        event.preventDefault();
        if (isHead) { const group = this.groupOf(key); if (group) list.toggle(group); return; }
        const product = this.productOf(key);
        if (product?.id != null) void this.router.navigate(['/products', product.id]);
        return;
      }
      case 'e': case 'E': {
        const product = isHead ? this.groupOf(key)?.lead : this.productOf(key);
        if (product?.id != null) { event.preventDefault(); void this.router.navigate(['/products', product.id, 'edit']); }
        return;
      }
      case 'Backspace': case 'Delete': {
        if (isHead) return;
        const product = this.productOf(key);
        if (product) { event.preventDefault(); list.remove(product); }
        return;
      }
    }
  }

  openMenu(event: MouseEvent, product: Product, head: boolean): void {
    event.stopPropagation();
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const items: ContextMenuItem[] = [
      { id: 'open', label: 'Openen', iconName: 'chevron-right' },
      { id: 'edit', label: 'Bewerken', iconName: 'pencil' },
    ];
    if (!head) items.push({ id: 'delete', label: 'Verwijderen…', iconName: 'trash', danger: true, divider: true });
    this.menu.set({ product, at: { x: box.right - 4, y: box.bottom + 4 }, items });
  }

  pick(item: ContextMenuItem): void {
    const product = this.menu()?.product;
    this.menu.set(null);
    if (!product || product.id === null) return;
    if (item.id === 'open') void this.router.navigate(['/products', product.id]);
    else if (item.id === 'edit') void this.router.navigate(['/products', product.id, 'edit']);
    else if (item.id === 'delete') this.host().remove(product);
  }
}
