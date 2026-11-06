import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CustomerPriceApi, type ProductCustomerPrice } from '../../core/api/customer-price-api';
import type { Product } from '../../core/api/models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import { DateNlPipe, EurPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';
import { statusPill } from '../customers/customer-price-state';
import { productSalesUnit } from './product-sales-unit';

/** The desk list's width (.pcu-pop): with less room right of the chip it opens to the left. */
const LIST_WIDTH = 300;

/** The prices that still apply first, then by customer. */
function sortRows(rows: readonly ProductCustomerPrice[]): ProductCustomerPrice[] {
  return [...rows].sort((a, b) => Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE')
    || (a.customerName ?? '').localeCompare(b.customerName ?? '', 'nl', { numeric: true }));
}

/**
 * "3 klantprijzen" beside a product's catalogue price (product desk, phone
 * product page, the editor's price preview): the customers with an own price
 * for this product, so a new catalogue price never forgets them (round 3b,
 * decision 5). The desk lists them on hover (a click keeps the list open),
 * the phone in a sheet; a row goes to the customer. In the editor, once the
 * price in the form differs from the saved one (`changed`), the chip becomes
 * the quiet line "2 klanten hebben een eigen prijs" over the same list.
 * Nothing shows while loading, without prices, or when the list cannot be
 * had (an older server has no list per product; a refusal or a failure only
 * leaves the reminder out).
 */
@Component({
  selector: 'app-product-customer-prices',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, Sheet, DateNlPipe, EurPipe],
  host: {
    '[class.pcu-none]': '!rows().length',
    '(pointerenter)': 'hoverIn($event)',
    '(pointerleave)': 'hoverOut($event)',
    '(focusout)': 'focusOut($event)',
    '(document:pointerdown)': 'outside($event)',
    '(document:keydown.escape)': 'escape()',
  },
  template: `
    @if (rows().length) {
      @if (asLine()) {
        <button class="pcu-trigger pcu-line" type="button" aria-haspopup="dialog" [attr.aria-expanded]="open()" (click)="toggle()">{{ line() }} ›</button>
      } @else {
        <button class="pcu-trigger wk-pill pcu-chip" [class.tone-accent]="active() > 0" [class.tone-grey]="!active()" type="button"
                aria-haspopup="dialog" [attr.aria-expanded]="open()" (click)="toggle()">{{ chip() }}</button>
      }
      @if (open()) {
        @if (desktop.active()) {
          <div class="wk-popover pcu-pop" [class.pcu-pop--end]="alignEnd()" role="dialog" aria-label="Klantprijzen">
            <p class="pcu-pop__head">Klantprijzen per {{ per() }}</p>
            @for (row of rows(); track row.customerId) {
              @let pill = statusPill(row.status);
              <a class="pcu-row" [class.pcu-row--off]="row.status !== 'ACTIVE'" [routerLink]="['/customers']" [queryParams]="{ q: row.customerName }">
                <strong class="pcu-row__name" [title]="row.customerName">{{ row.customerName }}</strong>
                <strong class="pcu-row__price">{{ row.priceExclVat | eur: 2 }}</strong>
                @if (row.validUntil || pill) {
                  <i class="pcu-row__meta">@if (row.validUntil) { tot {{ row.validUntil | dateNl }} }@if (pill) { <em class="wk-pill" [class.tone-warn]="row.status === 'BASIS_CHANGED'" [class.tone-grey]="row.status !== 'BASIS_CHANGED'">{{ pill.label }}</em> }</i>
                }
              </a>
            }
          </div>
        } @else {
          <app-sheet title="Klantprijzen" variant="ios" [backdropCloses]="true" (closed)="close()">
            <div body>
              <div class="ios-group">
                @for (row of rows(); track row.customerId) {
                  @let pill = statusPill(row.status);
                  <a class="ios-cell" [routerLink]="['/customers']" [queryParams]="{ q: row.customerName }">
                    <span class="ios-cell__body"><span class="ios-cell__title">{{ row.customerName }}</span>
                      @if (row.validUntil || pill) {
                        <span class="ios-cell__sub pcu-sub">@if (row.validUntil) { tot {{ row.validUntil | dateNl }} }@if (pill) { <i class="wk-pill" [class.tone-warn]="row.status === 'BASIS_CHANGED'" [class.tone-grey]="row.status !== 'BASIS_CHANGED'">{{ pill.label }}</i> }</span>
                      }</span>
                    <span class="ios-cell__value num" [class.ios-cell__value--strong]="row.status === 'ACTIVE'">{{ row.priceExclVat | eur: 2 }}</span>
                    <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                  </a>
                }
              </div>
              <p class="ios-section__foot">Per {{ per() }}, excl. btw</p>
            </div>
            <div foot style="display:contents">
              <button class="ios-capsule ios-capsule--block ios-capsule--tinted" type="button" (click)="close()">Sluiten</button>
            </div>
          </app-sheet>
        }
      }
    }
  `,
  styles: `
    :host { position: relative; display: inline-block; max-width: 100%; justify-self: start; vertical-align: middle; }
    /* Without prices the host takes no room: no gap or margin in the step, the cell title or the preview. */
    :host(.pcu-none) { display: none; }
    /* The editor's dark price preview, a flex column: under the price, never stretched. */
    :host(.pcu-dark) { align-self: flex-start; margin-top: 8px; }
    .pcu-chip { border: 0; font-family: inherit; cursor: pointer; }
    .pcu-chip:hover { background: color-mix(in srgb, var(--tone) 22%, var(--surface)); }
    .pcu-line { padding: 0; border: 0; background: none; color: var(--muted); font: inherit; font-size: 12px; line-height: 1.35; text-align: left; cursor: pointer; }
    .pcu-line:hover { color: var(--ink); }
    :host(.pcu-dark) .pcu-chip { background: rgb(255 255 255 / 12%); color: color-mix(in srgb, var(--tone) 30%, #fff); }
    :host(.pcu-dark) .pcu-line { color: #e6d8d1; }
    :host(.pcu-dark) .pcu-line:hover { color: #fff; }
    /* The list and the sheet sit inside their host's text (a white price preview, a nowrap cell title): the body's type again. */
    .pcu-pop, app-sheet { color: var(--ink); font-size: 15px; font-weight: 400; line-height: 1.5; letter-spacing: normal; text-align: left; text-transform: none; white-space: normal; }
    .pcu-pop { right: auto; left: 0; gap: 0; width: 300px; max-height: 360px; padding: 8px 12px; overflow-y: auto; overscroll-behavior: contain; }
    .pcu-pop--end { right: 0; left: auto; }
    .pcu-pop__head { margin: 2px 0 2px; color: var(--muted); font-size: 10.5px; font-weight: 750; letter-spacing: .07em; line-height: 1.3; text-transform: uppercase; }
    .pcu-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; gap: 1px 12px; padding: 7px 0; border-top: 1px solid var(--line); color: var(--ink); text-decoration: none; }
    .pcu-pop__head + .pcu-row { border-top: 0; }
    .pcu-row__name { min-width: 0; overflow: hidden; font-size: 13px; font-weight: 650; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
    .pcu-row__price { font-size: 13px; font-weight: 700; line-height: 1.35; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .pcu-row--off .pcu-row__price { color: var(--muted); font-weight: 600; }
    .pcu-row:hover .pcu-row__name, .pcu-row:focus-visible .pcu-row__name { color: var(--rose-dark); }
    .pcu-row__meta { display: flex; grid-column: 1 / -1; align-items: center; gap: 6px; color: var(--muted); font-size: 11.5px; font-style: normal; line-height: 1.35; }
    .pcu-row__meta em, .pcu-sub i { font-style: normal; }
    .pcu-sub { display: flex; align-items: center; gap: 6px; }
    /* Phone: a finger-sized target around the small chip and the line. */
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px) {
      .pcu-chip, .pcu-line { position: relative; }
      .pcu-chip::before, .pcu-line::before { content: ''; position: absolute; inset: -12px -6px; }
    }
  `,
})
export class ProductCustomerPrices {
  private readonly api = inject(CustomerPriceApi);
  private readonly destroy = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly desktop = inject(DesktopViewport);
  /** The product as saved: its id, and the unit its prices are on. */
  readonly product = input<Product | null>(null);
  /** The editor: the catalogue price in the form differs from the saved one. */
  readonly changed = input(false);

  readonly rows = signal<readonly ProductCustomerPrice[]>([]);
  readonly open = signal(false);
  /** Desk: the list opens to the left when the window has no room right of the chip. */
  readonly alignEnd = signal(false);
  readonly statusPill = statusPill;
  /** A click keeps the desk list open; a hover-opened one closes when the pointer leaves. */
  private pinned = false;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private request = 0;
  private loaded: string | null = null;

  readonly active = computed(() => this.rows().filter((row) => row.status === 'ACTIVE').length);
  readonly chip = computed(() => {
    const count = this.rows().length;
    return `${count} ${count === 1 ? 'klantprijs' : 'klantprijzen'}`;
  });
  /** The line counts the prices that still apply: those customers keep theirs when the catalogue price moves. */
  readonly line = computed(() => {
    const count = this.active();
    return `${count} ${count === 1 ? 'klant heeft' : 'klanten hebben'} een eigen prijs`;
  });
  readonly asLine = computed(() => this.changed() && this.active() > 0);
  readonly per = computed(() => productSalesUnit(this.product()).singular);

  constructor() {
    effect(() => {
      const product = this.product();
      const packaging = product?.packaging;
      /* Asked again for another product, and after a save that changed the price basis (prices can turn to Nakijken). */
      const key = product?.id == null ? null : `${product.id}:${packaging?.kind}:${packaging?.salesUnit}:${packaging?.piecesPerUnit}`;
      untracked(() => {
        if (key === this.loaded) return;
        this.loaded = key;
        this.close();
        void this.load(product?.id ?? null);
      });
    });
    this.destroy.onDestroy(() => this.stopTimer());
  }

  private async load(id: number | null): Promise<void> {
    const version = ++this.request;
    this.rows.set([]);
    if (id === null) return;
    try {
      const rows = await this.api.productPrices(id);
      if (!this.destroy.destroyed && version === this.request) this.rows.set(Array.isArray(rows) ? sortRows(rows) : []);
    } catch {
      /* No list per product on an older server (404), none for a refusal: the screen simply has no chip. */
    }
  }

  /** Desk: a hovering mouse shows the list; touch and pen wait for the tap. */
  hoverIn(event: PointerEvent): void {
    if (event.pointerType !== 'mouse' || !this.desktop.active() || !this.rows().length) return;
    this.stopTimer();
    if (!this.open()) this.show();
  }

  hoverOut(event: PointerEvent): void {
    if (event.pointerType !== 'mouse' || this.pinned || !this.open() || !this.desktop.active()) return;
    this.stopTimer();
    /* A moment's grace to cross the gap between the chip and the list. */
    this.closeTimer = setTimeout(() => { this.closeTimer = null; this.open.set(false); }, 180);
  }

  /** The phone opens its sheet; on the desk a click keeps the list open and a second one closes it. */
  toggle(): void {
    this.stopTimer();
    if (!this.desktop.active()) { this.open.set(true); return; }
    if (this.open() && this.pinned) { this.close(); return; }
    this.pinned = true;
    if (!this.open()) this.show();
  }

  outside(event: Event): void {
    if (this.open() && this.desktop.active() && !this.host.nativeElement.contains(event.target as Node)) this.close();
  }

  focusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (this.open() && this.desktop.active() && next && !this.host.nativeElement.contains(next)) this.close();
  }

  /** The phone's sheet handles Escape itself. */
  escape(): void {
    if (!this.open() || !this.desktop.active()) return;
    this.close();
    this.host.nativeElement.querySelector<HTMLElement>('.pcu-trigger')?.focus();
  }

  close(): void {
    this.stopTimer();
    this.pinned = false;
    this.open.set(false);
  }

  private show(): void {
    const left = this.host.nativeElement.getBoundingClientRect().left;
    this.alignEnd.set(left + LIST_WIDTH + 16 > document.documentElement.clientWidth);
    this.open.set(true);
  }

  private stopTimer(): void {
    if (this.closeTimer === null) return;
    clearTimeout(this.closeTimer);
    this.closeTimer = null;
  }
}
