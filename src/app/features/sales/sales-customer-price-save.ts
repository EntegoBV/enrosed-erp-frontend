import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal, type OnInit } from '@angular/core';
import { CustomerPriceApi, priceBasisRefusal, type CustomerPrice, type CustomerPriceBasis } from '../../core/api/customer-price-api';
import { messageOf } from '../../core/api/errors';
import type { PricedLine, Product, SalesOrder } from '../../core/api/models';
import { Icon } from '../../shared/icon';
import { Sheet, Ui } from '../../shared/ui';
import { dayText, todayIso } from '../customers/customer-price-state';
import { priceBasis } from '../products/catalog-prices';
import { euroText } from '../products/product-sales-unit';

/*
 * "Als klantprijs bewaren" (Emre, 2026-11-25: "als ik een factuur maak en andere prijzen noteer, ook een knop hebben
 * om die dan zijn catalogus prijs van dat te maken zodat ook die inlog prijzen van hun aanpassen meteen"): the prices
 * typed on a quote or invoice become the customer's own (klantprijzen). The server stores them like the customer
 * sheet does (PUT /api/customers/{id}/prices, source SALES_DOCUMENT with the document), so the customer's website
 * login shows them at once, new documents pin them and a price list made for the customer prints them. The
 * document itself does not change: a concept's lines move to the klantprijs in the draft (saved with Opslaan), a
 * sent or issued document keeps its lines as they are.
 */

/** One line whose typed price can become the customer's own. Prices are EUR excl. VAT on the product's sales unit. */
export interface CustomerPriceCandidate {
  productId: number;
  name: string;
  /** The line's own price, before discounts: what is stored. */
  price: number;
  /** "stolp", "display": what the price is for. */
  unit: string;
  basis: CustomerPriceBasis;
  piecesPerUnit: number | null;
  /** The customer's active price today; null: none; undefined: the server did not say (a line from before price sources). */
  customer: number | null | undefined;
  /** The catalogue price today on the line's basis; null: op aanvraag; undefined: not known. */
  standard: number | null | undefined;
  /** Why it cannot be stored as it is; null when it can. */
  problem: string | null;
}

const positive = (value: number | null | undefined): number | null =>
  value != null && Number.isFinite(value) && value > 0 ? value : null;
const sameAmount = (a: number, b: number): boolean => Math.abs(a - b) < 0.00005;
/** A klantprijs has at most two decimals; the server refuses more, it never rounds. */
const cents = (value: number): boolean => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;

/**
 * What a line of this product costs on the catalogue, as the server's unitPriceFor prices it (the editor's
 * standardPriceOf): the computed sales price, under an ORDER markup a fixed catalogue price or the landed cost plus
 * the order's markup. Only a fallback for a typed line the server has not priced yet (typed a moment ago, before
 * the next preview); container-cost pricing never comes here.
 */
export function catalogueUnitPrice(product: Product, order: Pick<SalesOrder, 'markupMode' | 'orderMarkupPct'>): number | null {
  if (order.markupMode !== 'ORDER') return positive(product.computedSalesPriceEur);
  if ((product.fixedSalesPriceEur ?? 0) > 0) return product.fixedSalesPriceEur!;
  const cost = product.landedCostEur ?? 0;
  return positive(Math.round(cost * (1 + (order.orderMarkupPct ?? 0) / 100) * 100) / 100);
}

/**
 * The lines of a document with a price staff typed on it (MANUAL) that is not the customer's price of today, in the
 * order the document lists them. `lines` are the document's lines as the screen holds them (the draft in the editor),
 * with a customer price typed over already marked MANUAL; `priced` the server's priced lines (their order, today's
 * figures: the server gives them for every line with a source); `agreed` the customer's active prices where the
 * screen has them loaded, used only for a line typed a moment ago that the server has not priced yet. Left out: every
 * line without a typed price - on the catalogue (none, or STANDARD), on the customer's price (CUSTOMER), and a line
 * without a source (from before price sources, or a website line: a price nobody typed here, the catalogue or list
 * price of its day, and the server gives such a line no figures once past concept) - an unavailable line, a price
 * equal to the customer's price of today, a typed price equal to the catalogue price while the customer has none for
 * the product, a product that is gone or a demo piece. A cancelled or refused document offers none: its prices never
 * held.
 */
export function customerPriceCandidates(order: Pick<SalesOrder, 'lines' | 'markupMode' | 'orderMarkupPct' | 'status'>,
                                        priced: readonly PricedLine[], products: readonly Product[],
                                        unitOf: (productId: number) => string,
                                        agreed?: ReadonlyMap<number, number> | null): CustomerPriceCandidate[] {
  if (order.status === 'GEANNULEERD' || order.status === 'AFGEWEZEN') return [];
  const byId = new Map(products.filter((product) => product.id != null).map((product) => [product.id!, product]));
  const result: CustomerPriceCandidate[] = [];
  for (const line of priced) {
    const own = order.lines.find((item) => item.productId === line.productId);
    if (!own || own.unavailable || line.unavailable) continue;
    const price = positive(own.unitPriceEur);
    if (price === null || own.priceSource !== 'MANUAL') continue;
    const product = byId.get(line.productId);
    if (!product || product.demo) continue;
    const customer = line.customerUnitPriceEur !== undefined ? positive(line.customerUnitPriceEur)
      : agreed ? agreed.get(line.productId) ?? null : undefined;
    const standard = line.standardUnitPriceEur !== undefined ? positive(line.standardUnitPriceEur) : catalogueUnitPrice(product, order);
    if (customer != null && sameAmount(price, customer)) continue;
    if (customer == null && standard != null && sameAmount(price, standard)) continue;
    const { basis, piecesPerUnit } = priceBasis(product);
    result.push({
      productId: line.productId, name: line.description, price, unit: unitOf(line.productId), basis, piecesPerUnit,
      customer, standard, problem: cents(price) ? null : 'Meer dan 2 decimalen: rond de prijs eerst af op de regel',
    });
  }
  return result;
}

/** What the sheet answers: the products stored and the customer's prices as the server now has them. */
export interface CustomerPricesSaved {
  prices: ReadonlyMap<number, number>;
  rows: CustomerPrice[];
}

interface SaveRow extends CustomerPriceCandidate {
  /** "klantprijs nu € 4,50", "standaard € 5,00", "klantprijs verlopen" */
  now: string;
}

/**
 * The sheet behind "Als klantprijs bewaren": the typed prices, each ticked, beside what the customer gets today.
 * It reads the customer's stored prices first (a price already stored drops out, an ended one gets its end date
 * cleared so the new price applies) and stores the ticked ones in one save.
 */
@Component({
  selector: 'app-sales-customer-price-save',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Sheet],
  template: `
    <app-sheet title="Als klantprijs bewaren" variant="ios" (closed)="close()">
      <div body class="scp">
        <p class="scp__lead">{{ customerName() || 'De klant' }} ziet deze prijzen meteen na inloggen op de website; nieuwe offertes en facturen nemen ze over.</p>
        @if (loadFailed()) {
          <p class="scp__note" role="alert">Klantprijzen niet geladen. <button class="scp__retry" type="button" (click)="load()">Opnieuw</button></p>
        } @else if (stored() && !rows().length) {
          <p class="scp__note">Deze prijzen zijn al klantprijzen van {{ customerName() || 'deze klant' }}.</p>
        } @else {
          <div class="scp__list" role="group" aria-label="Prijzen om te bewaren">
            @for (row of rows(); track row.productId) {
              <button class="scp__row" type="button" role="checkbox" [attr.aria-checked]="isTicked(row)"
                      [attr.aria-disabled]="!!row.problem || busy() || null" (click)="toggle(row)">
                <span class="ios-check" [class.is-on]="isTicked(row)" aria-hidden="true"><app-icon name="tick" [size]="14" /></span>
                <span class="scp__body">
                  <span class="scp__name">{{ row.name }}</span>
                  <span class="scp__now" [class.scp__now--warn]="!!row.problem">{{ row.problem || row.now }}</span>
                </span>
                <span class="scp__price"><b>{{ euro(row.price) }}</b><small>per {{ row.unit }}</small></span>
              </button>
            }
          </div>
        }
      </div>
      <div foot style="display:contents">
        @if (stored() && !rows().length) {
          <button class="btn btn--primary" type="button" (click)="close()">Sluiten</button>
        } @else {
          <button class="btn" type="button" [disabled]="busy()" (click)="close()">Annuleren</button>
          <button class="btn btn--primary" type="button" [disabled]="!ready() || busy()" (click)="save()">
            {{ busy() ? 'Bewaren…' : tickedRows().length > 1 ? 'Bewaren (' + tickedRows().length + ')' : 'Bewaren' }}
          </button>
        }
      </div>
    </app-sheet>
  `,
  styles: `
    .scp { display: grid; gap: 12px; }
    .scp__lead { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .scp__note { margin: 0; color: var(--ink-2); font-size: 14px; }
    .scp__retry { padding: 0; border: 0; background: none; color: var(--rose-dark); font: inherit; font-weight: 650; cursor: pointer; }
    .scp__list { display: grid; overflow: hidden; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
    .scp__row {
      display: flex; align-items: center; gap: 12px; width: 100%; min-height: 52px; padding: 8px 14px; border: 0;
      background: transparent; color: var(--ink); font: inherit; text-align: left; cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    .scp__row + .scp__row { border-top: 1px solid var(--line); }
    .scp__row[aria-disabled='true'] { cursor: default; }
    .scp__row[aria-disabled='true'] .ios-check { opacity: .45; }
    .scp__row:focus-visible { outline: 2px solid color-mix(in srgb, var(--rose) 55%, transparent); outline-offset: -2px; }
    @media (hover: hover) { .scp__row:not([aria-disabled='true']):hover { background: var(--surface-2); } }
    .scp__body { display: grid; flex: 1; gap: 1px; min-width: 0; }
    /* Two lines before it cuts: the colour at the end of a long name must stay readable. */
    .scp__name {
      display: -webkit-box; overflow: hidden; font-size: 14.5px; font-weight: 600; line-height: 1.3;
      -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere;
    }
    .scp__now { overflow: hidden; color: var(--muted); font-size: 12.5px; line-height: 1.3; text-overflow: ellipsis; white-space: nowrap; }
    .scp__now--warn { color: var(--warn); white-space: normal; }
    .scp__price { display: grid; flex: none; justify-items: end; gap: 1px; text-align: right; }
    .scp__price b { font-size: 15px; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .scp__price small { color: var(--muted); font-size: 12px; white-space: nowrap; }
    /* The phone's iOS sheet has no side padding of its own: its content keeps the inset of the grouped lists. */
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px) {
      .scp { padding: 0 var(--ios-inset, 16px); }
      .scp__lead, .scp__note { padding: 0 4px; }
      .scp__list { border: 0; border-radius: var(--ios-radius, 16px); }
      .scp__row { min-height: 60px; }
      .scp__name { font-size: 16px; }
      .scp__now { font-size: 13px; }
      .scp__price b { font-size: 16px; }
    }
  `,
})
export class SalesCustomerPriceSave implements OnInit {
  private readonly api = inject(CustomerPriceApi);
  private readonly ui = inject(Ui);
  private readonly destroyRef = inject(DestroyRef);

  readonly customerId = input.required<number>();
  readonly customerName = input('');
  /** The quote or invoice the prices come from; the server writes its number on the history and in the Logboek. */
  readonly salesOrderId = input.required<number>();
  readonly candidates = input.required<readonly CustomerPriceCandidate[]>();
  readonly saved = output<CustomerPricesSaved>();
  readonly closed = output<void>();

  /** The customer's prices as stored; null while they load. */
  readonly stored = signal<CustomerPrice[] | null>(null);
  readonly loadFailed = signal(false);
  readonly busy = signal(false);
  /** Products the user unticked; every other row that can be stored is ticked. */
  private readonly unticked = signal<ReadonlySet<number>>(new Set());
  /** Products the server refused because their unit changed since the screen loaded. */
  private readonly refused = signal<ReadonlySet<number>>(new Set());

  readonly euro = euroText;

  /** The candidates against the stored prices: one already stored at that amount drops out. */
  readonly rows = computed<SaveRow[]>(() => {
    const stored = new Map((this.stored() ?? []).map((row) => [row.productId, row]));
    const refused = this.refused();
    const result: SaveRow[] = [];
    for (const candidate of this.candidates()) {
      const row = stored.get(candidate.productId);
      const active = row?.status === 'ACTIVE' ? positive(row.priceExclVat) : null;
      if (active !== null && sameAmount(active, candidate.price)) continue;
      const problem = refused.has(candidate.productId) ? 'De prijsbasis is gewijzigd: laad het document opnieuw' : candidate.problem;
      result.push({ ...candidate, problem, now: this.nowText(candidate, row) });
    }
    return result;
  });
  readonly tickedRows = computed(() => this.rows().filter((row) => this.isTicked(row)));
  readonly ready = computed(() => this.stored() !== null && this.tickedRows().length > 0);

  /* Not in the constructor: the required inputs are only set by now (NG0950). */
  ngOnInit(): void {
    void this.load();
  }

  isTicked(row: SaveRow): boolean {
    return !row.problem && !this.unticked().has(row.productId);
  }

  toggle(row: SaveRow): void {
    if (row.problem || this.busy()) return;
    this.unticked.update((set) => {
      const next = new Set(set);
      if (next.has(row.productId)) next.delete(row.productId); else next.add(row.productId);
      return next;
    });
  }

  /** What the customer gets today, as the stored rows say once they are in (the server's figures before). */
  private nowText(candidate: CustomerPriceCandidate, row: CustomerPrice | undefined): string {
    if (this.stored() !== null) {
      /* A stored end date that is still ahead stays with the new price: it is named. */
      if (row?.status === 'ACTIVE') return `nu klantprijs ${euroText(row.priceExclVat)}${row.validUntil ? ' · tot ' + dayText(row.validUntil) : ''}`;
      if (row?.status === 'EXPIRED') return `klantprijs ${euroText(row.priceExclVat)} verlopen`;
      if (row?.status === 'BASIS_CHANGED') return `klantprijs ${euroText(row.priceExclVat)} op oude eenheid`;
    } else if (candidate.customer != null) {
      return `nu klantprijs ${euroText(candidate.customer)}`;
    }
    return candidate.standard != null ? `nu standaard ${euroText(candidate.standard)}` : 'nieuwe klantprijs';
  }

  async load(): Promise<void> {
    this.loadFailed.set(false);
    try {
      const rows = await this.api.list(this.customerId());
      if (!this.destroyRef.destroyed) this.stored.set(rows);
    } catch {
      if (!this.destroyRef.destroyed) this.loadFailed.set(true);
    }
  }

  close(): void {
    if (this.busy()) return;
    this.closed.emit();
  }

  /**
   * One save for every ticked row, each on the unit the screen knows the product by (the server refuses it once the
   * product has left that unit: 409, nothing stored). A stored end date that is still ahead stays; one that already
   * passed is cleared, else the new price would not apply.
   */
  async save(): Promise<void> {
    if (!this.ready() || this.busy()) return;
    const today = todayIso();
    const stored = new Map((this.stored() ?? []).map((row) => [row.productId, row]));
    const rows = this.tickedRows();
    this.busy.set(true);
    try {
      const answer = await this.api.save(this.customerId(), {
        source: 'SALES_DOCUMENT',
        salesOrderId: this.salesOrderId(),
        changes: rows.map((row) => {
          const ended = stored.get(row.productId)?.validUntil;
          return {
            productId: row.productId, priceExclVat: row.price, basis: row.basis, piecesPerUnit: row.piecesPerUnit,
            ...(ended && ended < today ? { validUntil: null } : {}),
          };
        }),
      });
      const name = this.customerName();
      this.ui.toast(`${rows.length} ${rows.length === 1 ? 'klantprijs' : 'klantprijzen'} bewaard${name ? ' voor ' + name : ''}`);
      this.saved.emit({ prices: new Map(rows.map((row) => [row.productId, row.price])), rows: answer });
    } catch (failure: unknown) {
      const stale = priceBasisRefusal(failure);
      if (stale) {
        this.refused.set(new Set(stale.productIds.length ? stale.productIds : rows.map((row) => row.productId)));
        this.ui.toast('Niets bewaard: de prijsbasis van een product is gewijzigd', 'err');
      } else {
        this.ui.toast(messageOf(failure, 'De klantprijzen zijn niet bewaard. Probeer opnieuw.'), 'err');
      }
    } finally {
      this.busy.set(false);
    }
  }
}

/**
 * The button that opens the sheet, shown only while a document has typed prices that are not the customer's own.
 * Desk: a small button in the products bar, the K of the line marker before its label. Phone: a large pressable
 * row under the lines (Emre: on the phone everything is small already), with the count in its second line.
 */
@Component({
  selector: 'app-customer-price-save-trigger',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (variant() === 'phone') {
      <button class="cpt-row" type="button" (click)="pressed.emit()">
        <span class="cpt-k" aria-hidden="true">K</span>
        <span class="cpt-row__copy">
          <b>Als klantprijs bewaren</b>
          <small>{{ count() }} eigen {{ count() === 1 ? 'prijs' : 'prijzen' }} · ook in de websitelogin</small>
        </span>
        <span class="cpt-row__chev" aria-hidden="true">›</span>
      </button>
    } @else {
      <button class="btn btn--sm cpt-desk" type="button" (click)="pressed.emit()"
              [title]="count() + ' eigen ' + (count() === 1 ? 'prijs' : 'prijzen') + ' als klantprijs bewaren: ook in de websitelogin van de klant'">
        <span class="cpt-k" aria-hidden="true">K</span> Als klantprijs bewaren@if (count() > 1) { ({{ count() }})}
      </button>
    }
  `,
  styles: `
    :host { display: contents; }
    .cpt-k {
      display: inline-grid; flex: none; width: 15px; height: 15px; place-items: center; border-radius: 5px;
      background: var(--rose-soft); color: var(--rose-dark); font-size: 9px; font-weight: 800; line-height: 1;
    }
    .cpt-desk { gap: 6px; white-space: nowrap; }
    .cpt-row {
      display: flex; align-items: center; gap: 12px; width: 100%; min-height: 56px; margin: 4px 0 2px; padding: 10px 14px;
      border: 1px solid color-mix(in srgb, var(--rose) 28%, var(--line)); border-radius: 14px; background: var(--surface);
      color: var(--ink); font: inherit; text-align: left; cursor: pointer; -webkit-tap-highlight-color: transparent;
    }
    .cpt-row:active { background: var(--rose-soft); }
    .cpt-row .cpt-k { width: 28px; height: 28px; border-radius: 8px; font-size: 13px; }
    .cpt-row__copy { display: grid; flex: 1; gap: 1px; min-width: 0; }
    .cpt-row__copy b { font-size: 15.5px; font-weight: 650; }
    .cpt-row__copy small { overflow: hidden; color: var(--muted); font-size: 12.5px; text-overflow: ellipsis; white-space: nowrap; }
    .cpt-row__chev { flex: none; color: var(--muted-2); font-size: 20px; line-height: 1; }
  `,
})
export class CustomerPriceSaveTrigger {
  readonly count = input.required<number>();
  readonly variant = input<'desk' | 'phone'>('desk');
  readonly pressed = output<void>();
}
