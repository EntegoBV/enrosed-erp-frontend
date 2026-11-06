import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, afterRenderEffect, computed, inject, input, output,
  signal, untracked, viewChild,
} from '@angular/core';
import type { PricedLine, SalesLinePriceSource, SalesOrderLine } from '../../core/api/models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { clampMenuPosition, type MenuPoint } from '../../shared/context-menu-position';
import { Icon } from '../../shared/icon';
import { Sheet } from '../../shared/ui';
import { euroText } from '../products/product-sales-unit';
import { SalesMenuGesture } from './sales-menu-gesture';

/** What the marker beside one line's price says (round 3b): where the price comes from and today's two figures. */
export interface LinePriceState {
  /** null: a line from before round 3b, or one that follows the catalogue without saying so. */
  source: SalesLinePriceSource | null;
  /** The unit price the line carries, before discounts. */
  price: number;
  /** The catalogue price today, on the line's basis; null: op aanvraag. */
  standard: number | null;
  /** The customer's active price today; null when there is none (any more). */
  customer: number | null;
  /** The line follows the catalogue: STANDARD, or no price of its own. */
  onStandard: boolean;
  /** On a customer price that is no longer the customer's price of today: the marker's dot. */
  stale: boolean;
  /** "stolp", "display": what every figure is for. */
  unit: string;
}

/** A choice in the popover; it goes into the draft like a typed price and is saved with Opslaan. */
export type LinePriceChoice = { source: 'CUSTOMER'; unitPriceEur: number } | { source: 'STANDARD'; unitPriceEur: null };

const positive = (value: number | null | undefined): number | null =>
  value != null && Number.isFinite(value) && value > 0 ? value : null;
const sameAmount = (a: number, b: number): boolean => Math.abs(a - b) < 0.00005;

/**
 * The marker's state of one line, or null when there is nothing to say: the
 * customer has no price for the product and the line is not on one. The
 * draft's source wins over the server's (it may be newer than the last
 * preview). A new line without a typed price that the preview priced at the
 * customer's price is pinned to it on save (contract decision 2), so it
 * reads that way already. On a concept given another customer than the
 * saved one, a save pins a line on the old customer's price again (the new
 * customer's price, or back to the catalogue), as the preview already did:
 * such a line reads the preview's source and price, not the old pin.
 */
export function linePriceState(draft: SalesOrderLine | undefined, priced: PricedLine, unit: string,
                               customerChanged = false): LinePriceState | null {
  const customer = positive(priced.customerUnitPriceEur);
  const repinned = customerChanged && draft?.priceSource === 'CUSTOMER';
  const typed = repinned ? null : positive(draft?.unitPriceEur);
  let source = (repinned ? priced.priceSource : draft?.priceSource ?? priced.priceSource) ?? null;
  if (source === null && draft?.id == null && typed === null && customer !== null && sameAmount(priced.unitPrice, customer)) {
    source = 'CUSTOMER';
  }
  if (source !== 'CUSTOMER' && customer === null) return null;
  const price = typed ?? priced.unitPrice;
  return {
    source, price, customer, unit,
    standard: positive(priced.standardUnitPriceEur),
    onStandard: source === 'STANDARD' || (source !== 'CUSTOMER' && typed === null),
    stale: source === 'CUSTOMER' && (customer === null || !sameAmount(customer, price)),
  };
}

interface FigureRow { label: string; value: string; current: boolean }
interface PriceAction { label: string; choice: LinePriceChoice }

/**
 * The quiet "K" beside a line's price, staff only. Filled in the accent tone
 * while the line is on the customer's own price, with a dot when that price
 * changed since the line was pinned; faint and hollow on a line with another
 * price while the customer has one. Desk: hovering says "Klantprijs ·
 * standaard € 4,95", a click opens a small popover. Phone: a tap or a long
 * press opens a sheet. Both show the figures and, when the line may change,
 * "Standaardprijs gebruiken", "Klantprijs gebruiken" or "Nieuwe klantprijs
 * € x toepassen". With `labelText` the marker brings the field's label along
 * (a button inside a label would be invalid).
 */
@Component({
  selector: 'app-line-price-source',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Sheet],
  host: { '[class.lps-host--label]': '!!labelText()' },
  template: `
    @if (labelText()) { <label [attr.for]="labelFor() || null">{{ labelText() }}</label> }
    <span class="lps-anchor">
      <button #mark class="lps" type="button" [class.lps--own]="own()" [class.lps--stale]="state().stale"
              [attr.aria-label]="summary()" aria-haspopup="dialog" [attr.aria-expanded]="open()"
              (click)="toggle()" (mouseenter)="hovered.set(true)" (mouseleave)="hovered.set(false)"
              (focus)="focusTip()" (blur)="focused.set(false)"><span aria-hidden="true">K</span></button>
      @if (desktop.active() && (hovered() || focused()) && !open()) {
        <span class="lps-tip" role="tooltip">{{ summary() }}</span>
      }
    </span>
    @if (open()) {
      @if (desktop.active()) {
        <div class="lpp-backdrop" (click)="close()" (contextmenu)="$event.preventDefault(); close()"></div>
        <div #pop class="lpp" role="dialog" [attr.aria-label]="heading() || 'Prijs'" tabindex="-1"
             [style.left.px]="position().x" [style.top.px]="position().y" (keydown.escape)="close()">
          <dl class="lpp__rows">
            @for (row of rows(); track row.label) {
              <div class="lpp__row" [class.is-current]="row.current">
                <dt>{{ row.label }}</dt><dd>{{ row.value }}<small> per {{ state().unit }}</small></dd>
              </div>
            }
          </dl>
          @if (hint()) { <p class="lpp__hint">{{ hint() }}</p> }
          @if (editable() && actions().length) {
            <div class="lpp__actions">
              @for (action of actions(); track action.label) {
                <button class="lpp__action" type="button" (click)="choose(action)">{{ action.label }}</button>
              }
            </div>
          }
        </div>
      } @else {
        <app-sheet [title]="heading() || 'Prijs'" variant="ios" (closed)="close()">
          <div body class="lps-sheet">
            <div class="ios-group">
              @for (row of rows(); track row.label) {
                <div class="ios-cell">
                  <span class="ios-cell__body"><span class="ios-cell__title" [class.ios-cell__title--strong]="row.current">{{ row.label }}</span></span>
                  <span class="ios-cell__trail">
                    <span class="ios-cell__value" [class.ios-cell__value--strong]="row.current">{{ row.value }}</span>
                    <span class="ios-cell__meta">per {{ state().unit }}</span>
                  </span>
                  @if (row.current) { <app-icon class="ios-cell__tick" name="tick" [size]="18" /> }
                </div>
              }
            </div>
            @if (hint()) { <p class="ios-section__foot">{{ hint() }}</p> }
            @if (editable() && actions().length) {
              <div class="ios-group lps-sheet__actions">
                @for (action of actions(); track action.label) {
                  <button class="ios-cell ios-cell--action" type="button" (click)="choose(action)">{{ action.label }}</button>
                }
              </div>
            }
          </div>
        </app-sheet>
      }
    }
  `,
  styles: `
    /* Inline before a unit ("K per stolp"): its margin box stays inside the line, so a row with it is not taller. */
    :host { display: inline-flex; vertical-align: middle; margin: -2px 4px -2px 0; }
    :host(.lps-host--label) { display: flex; align-items: center; gap: 6px; min-width: 0; margin: 0; vertical-align: baseline; }
    /* The field's own label, as .field > label words it. */
    label { min-width: 0; color: var(--ink-2); font-size: 12.5px; font-weight: 650; }
    .lps-anchor { position: relative; display: inline-flex; flex: none; }
    .lps {
      position: relative; display: inline-grid; width: 15px; height: 15px; place-items: center; padding: 0;
      border: 0; border-radius: 5px; background: transparent; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--muted) 42%, transparent);
      color: color-mix(in srgb, var(--muted) 85%, transparent); font: inherit; font-size: 9px; font-weight: 800; line-height: 1;
      cursor: pointer; -webkit-tap-highlight-color: transparent; -webkit-touch-callout: none; user-select: none;
    }
    /* A finger-sized target around a quiet glyph, where a finger taps it: under a mouse it covered the
       bottom of the desk's price field, two pixels above the glyph. */
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px), (pointer: coarse) {
      .lps::after { content: ''; position: absolute; inset: -11px -9px; }
    }
    .lps--own { background: var(--rose-soft); box-shadow: none; color: var(--rose-dark); }
    .lps--stale::before {
      content: ''; position: absolute; top: -3px; right: -3px; width: 6px; height: 6px; border-radius: 50%;
      background: var(--warn); box-shadow: 0 0 0 1.5px var(--surface); pointer-events: none;
    }
    .lps:focus-visible { outline: 2px solid color-mix(in srgb, var(--rose) 55%, transparent); outline-offset: 2px; }
    /* Under the marker: above it, it would cover the very price it explains. */
    .lps-tip {
      position: absolute; top: calc(100% + 7px); left: 50%; z-index: 30; padding: 5px 9px; border-radius: 8px;
      background: var(--ink); color: var(--surface); font-size: 11.5px; font-weight: 600; line-height: 1.3;
      text-align: left; white-space: nowrap; transform: translateX(-50%); pointer-events: none;
      box-shadow: 0 6px 16px rgb(0 0 0 / 16%);
    }
    .lpp-backdrop { position: fixed; inset: 0; z-index: 60; }
    .lpp {
      position: fixed; z-index: 61; width: max-content; min-width: 210px; max-width: min(300px, calc(100vw - 16px)); padding: 8px;
      border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--ink); text-align: left;
      white-space: normal; box-shadow: 0 12px 32px rgb(0 0 0 / 14%), 0 2px 6px rgb(0 0 0 / 8%);
      animation: mo-lift-in var(--dur-1, .12s) var(--ease-out, ease-out);
    }
    .lpp:focus { outline: none; }
    .lpp__rows { display: grid; gap: 2px; margin: 0; padding: 2px 4px 4px; }
    .lpp__row { display: flex; align-items: baseline; justify-content: space-between; gap: 14px; font-size: 12.5px; }
    .lpp__row dt { color: var(--muted); font-weight: 600; }
    .lpp__row dd { margin: 0; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .lpp__row small { color: var(--muted); font-size: 11px; }
    .lpp__row.is-current dt, .lpp__row.is-current dd { color: var(--rose-dark); font-weight: 700; }
    .lpp__hint { margin: 2px 4px 4px; color: var(--muted); font-size: 11.5px; }
    .lpp__actions { display: grid; gap: 2px; margin-top: 4px; padding-top: 6px; border-top: 1px solid var(--line); }
    .lpp__action {
      padding: 7px 8px; border: 0; border-radius: 8px; background: transparent; color: var(--rose-dark);
      font: inherit; font-size: 13px; font-weight: 650; text-align: left; cursor: pointer;
    }
    .lpp__action:hover, .lpp__action:focus-visible { background: var(--surface-2); outline: none; }
    .lps-sheet { display: grid; gap: 14px; }
    .lps-sheet .ios-section__foot { margin-top: -6px; }
    .lps-sheet__actions .ios-cell { justify-content: flex-start; }
  `,
})
export class LinePriceSource {
  protected readonly desktop = inject(DesktopViewport);
  private readonly destroyRef = inject(DestroyRef);

  readonly state = input.required<LinePriceState>();
  /** Whether the line's price may change here; without it the popover only shows the figures. */
  readonly editable = input(false);
  /** The popover's title: the line's product. */
  readonly heading = input('');
  /** The phone's price label, brought along: "Prijs per stolp". */
  readonly labelText = input('');
  readonly labelFor = input('');
  readonly use = output<LinePriceChoice>();

  readonly open = signal(false);
  readonly hovered = signal(false);
  readonly focused = signal(false);
  readonly position = signal<MenuPoint>({ x: 8, y: 8 });

  private readonly mark = viewChild.required<ElementRef<HTMLButtonElement>>('mark');
  private readonly pop = viewChild<ElementRef<HTMLElement>>('pop');
  private anchor: MenuPoint | null = null;

  readonly own = computed(() => this.state().source === 'CUSTOMER');
  /** The tooltip and the marker's name: "Klantprijs · standaard € 4,95", or "Klantprijs € 4,20 beschikbaar". */
  readonly summary = computed(() => {
    const state = this.state();
    if (state.source !== 'CUSTOMER') return `Klantprijs ${euroText(state.customer!)} beschikbaar`;
    const standard = state.standard === null ? 'geen standaardprijs' : `standaard ${euroText(state.standard)}`;
    const now = !state.stale ? '' : state.customer === null ? ' · niet meer actief' : ` · nieuw ${euroText(state.customer)}`;
    return `Klantprijs · ${standard}${now}`;
  });
  readonly rows = computed<FigureRow[]>(() => {
    const state = this.state();
    const standard: FigureRow = { label: 'Standaardprijs', value: state.standard === null ? 'op aanvraag' : euroText(state.standard), current: state.onStandard };
    if (state.source === 'CUSTOMER') return [{ label: 'Klantprijs', value: euroText(state.price), current: true }, standard];
    /* On the catalogue the customer's price is only a hint (below); a typed price shows next to both. */
    if (state.onStandard) return [standard];
    return [{ label: 'Eigen prijs', value: euroText(state.price), current: true },
      { label: 'Klantprijs', value: euroText(state.customer!), current: false }, standard];
  });
  readonly hint = computed(() => {
    const state = this.state();
    if (state.source === 'CUSTOMER') return state.customer === null ? 'Geen actieve klantprijs meer' : '';
    return state.onStandard ? `Klantprijs ${euroText(state.customer!)} beschikbaar` : '';
  });
  readonly actions = computed<PriceAction[]>(() => {
    const state = this.state();
    const toStandard: PriceAction = { label: 'Standaardprijs gebruiken', choice: { source: 'STANDARD', unitPriceEur: null } };
    if (state.source === 'CUSTOMER') {
      return state.stale && state.customer !== null
        ? [{ label: `Nieuwe klantprijs ${euroText(state.customer)} toepassen`, choice: { source: 'CUSTOMER', unitPriceEur: state.customer } }, toStandard]
        : [toStandard];
    }
    const toCustomer: PriceAction = { label: 'Klantprijs gebruiken', choice: { source: 'CUSTOMER', unitPriceEur: state.customer! } };
    return state.onStandard ? [toCustomer] : [toCustomer, toStandard];
  });

  constructor() {
    /* A long press on the phone (and a right click or the menu key on the desk) opens it too; a tap is the click below. */
    afterNextRender(() => {
      const gesture = new SalesMenuGesture(this.mark().nativeElement, () => false, () => this.show());
      this.destroyRef.onDestroy(() => gesture.destroy());
    });
    /* The desk popover opens under the marker, kept inside the window, and takes the focus. */
    afterRenderEffect(() => {
      const element = this.pop()?.nativeElement;
      if (!element || !this.anchor) return;
      const rect = element.getBoundingClientRect();
      const next = clampMenuPosition(this.anchor, { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight });
      untracked(() => this.position.set(next));
      if (!element.contains(document.activeElement)) (element.querySelector<HTMLElement>('button') ?? element).focus({ preventScroll: true });
    });
  }

  /** The tooltip follows a keyboard's focus, not the focus a click leaves behind. */
  focusTip(): void {
    this.focused.set(this.mark().nativeElement.matches(':focus-visible'));
  }

  toggle(): void {
    if (this.open()) this.close();
    else this.show();
  }

  show(): void {
    const rect = this.mark().nativeElement.getBoundingClientRect();
    this.anchor = { x: Math.round(rect.left - 8), y: Math.round(rect.bottom + 6) };
    this.position.set(this.anchor);
    this.hovered.set(false);
    this.open.set(true);
  }

  close(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.anchor = null;
    /* The phone sheet gives the focus back itself. */
    if (this.desktop.active()) this.mark().nativeElement.focus({ preventScroll: true });
  }

  choose(action: PriceAction): void {
    this.close();
    this.use.emit(action.choice);
  }
}
