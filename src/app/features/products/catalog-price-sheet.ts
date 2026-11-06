import { ChangeDetectionStrategy, Component, type OnInit, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthImage } from '../../core/api/auth-image';
import type { CatalogPriceIssue, CatalogPriceOverride } from '../../core/api/catalog-api';
import { CustomerPriceApi, type CustomerPrice } from '../../core/api/customer-price-api';
import { messageOf } from '../../core/api/errors';
import type { Product } from '../../core/api/models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { ContextMenu, type ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { DecimalInput } from '../../shared/decimal-input';
import { EurPipe } from '../../shared/pipes';
import { Sheet, Ui } from '../../shared/ui';
import { stripColour, variantOf } from '../purchasing/purchase-desk-format';
import {
  basisChanged, cataloguePrice, changesPrint, oneOffPrice, percentPrice, priceProblem, pricePrintable, standardPrice, todayIso,
  type StandardPrice,
} from './catalog-prices';
import { cataloguePhoto } from './catalog-studio';
import { productSalesUnit } from './product-sales-unit';

interface PriceRow {
  id: number;
  product: Product;
  name: string;
  variant: string | null;
  sku: string;
  /** "per stolp", "per display": what every amount on the row is for. */
  per: string;
  catalogue: number | null;
  stored: CustomerPrice | null;
  standard: StandardPrice;
  price: CatalogPriceOverride | null;
  changed: boolean;
  onRequest: boolean;
  /** A display sold per display without its piece count: the PDF prints "Prijs op aanvraag" whatever is typed. */
  unprintable: boolean;
  /** Why the row cannot go into the PDF as it is: a typed price, a unit changed since, or the server's refusal. */
  message: string | null;
  belowCost: boolean;
  photo: string | null;
}

/** The words of a stored price that does not apply, as chip and as the desk's Klant column says them. */
const OWN_STATE: Record<string, string> = { ACTIVE: 'klant', EXPIRED: 'verlopen', BASIS_CHANGED: 'prijsbasis gewijzigd' };
const UNPRINTABLE = 'Display zonder aantal stuks: de PDF toont Prijs op aanvraag';

function sameOverride(a: CatalogPriceOverride | undefined, b: CatalogPriceOverride | undefined): boolean {
  return a?.priceEur === b?.priceEur && !!a?.onRequest === !!b?.onRequest && a?.basis === b?.basis
    && (a?.piecesPerUnit ?? null) === (b?.piecesPerUnit ?? null);
}

/**
 * Prijzen aanpassen: the price of every selected product in this one PDF.
 * A row shows what the PDF prints without a change (the field's placeholder:
 * the customer's price while it applies, else the catalogue price) and takes
 * a one-off price, "Op aanvraag" from its menu, or a percentage on all of
 * them. Nothing changes until Toepassen; with a customer, "Ook bewaren als
 * prijzen van …" also stores the typed prices as that customer's own
 * (PUT /api/customers/{id}/prices, source CATALOG_EXPORT), with the PDF's
 * validity date. "onder kost" compares with the landed cost and stops
 * nothing.
 */
@Component({
  selector: 'app-catalog-price-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, ContextMenu, DecimalInput, EurPipe, FormsModule, Sheet],
  template: `
    <app-sheet title="Prijzen aanpassen" variant="ios" [wide]="desktop.active()" (closed)="requestClose()">
      <div body class="cps" [class.cps--own]="!!customer()" [attr.inert]="busy() ? '' : null">
        @if (customer(); as who) {
          <p class="cps__for">Voor {{ who.name }}@if (customerNote()) {<span> · {{ customerNote() }}</span>}</p>
        }
        <div class="cps-tools">
          <label class="cps-search">
            <span class="sr-only">Zoek een product</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
            <input class="input" type="search" placeholder="Zoek naam, SKU of kleur…" [ngModel]="query()" (ngModelChange)="query.set($event)" />
          </label>
          <div class="cps-tools__row">
            <button class="chip" type="button" [class.active]="onlyChanged()" [attr.aria-pressed]="onlyChanged()"
                    (click)="onlyChanged.set(!onlyChanged())">Alleen aangepast</button>
            <!-- A sign of its own: the decimal keypad of a phone has no minus. -->
            <span class="cps-pct">
              <button class="cps-pct__sign" type="button" [attr.aria-label]="sign() < 0 ? 'Korting, tik voor opslag' : 'Opslag, tik voor korting'"
                      (click)="sign.set(sign() < 0 ? 1 : -1)">{{ sign() < 0 ? '−' : '+' }}</button>
              <input class="input" appDecimal placeholder="10" aria-label="Percentage" [ngModel]="percent()"
                     (ngModelChange)="percent.set($event)" (keydown.enter)="applyPercent()" />
              <button class="btn btn--sm" type="button" [disabled]="percent() === null" (click)="applyPercent()">% op alles</button>
            </span>
            <button class="linklike cps-reset" type="button" [disabled]="!draft().size" (click)="resetAll()">Alles terug</button>
          </div>
        </div>
        <div class="cps-head" aria-hidden="true">
          <span>Product</span><span>Catalogus</span>@if (customer()) {<span>Klant</span>}<span>In deze PDF</span>
        </div>
        <ul class="cps-rows">
          @for (row of visibleRows(); track row.id) {
            <li class="cps-row" [class.is-changed]="row.changed" [class.is-wrong]="!!row.message">
              <span class="cps-row__photo">@if (row.photo) {<img [appAuthSrc]="row.photo" appAuthLazy alt="" />}</span>
              <b class="cps-row__name">{{ row.name }}@if (row.variant) {<span> · {{ row.variant }}</span>}</b>
              <span class="cps-row__meta">
                @if (row.message) {
                  <span class="cps-row__text cps-row__message">{{ row.message }}</span>
                } @else {
                  <span class="cps-row__text cps-row__desk">{{ row.sku }} · {{ row.per }}</span>
                  <span class="cps-row__text cps-row__phone">@if (row.catalogue !== null) {{{ row.catalogue | eur }} }{{ row.per }} · {{ row.sku }}</span>
                }
                @if (row.stored; as own) {
                  <i class="cps-tag cps-row__phone" [class.cps-tag--own]="own.status === 'ACTIVE'" [attr.title]="ownTitle(own)">{{ ownWord(own) }}</i>
                }
                @if (row.unprintable) { <i class="cps-tag cps-tag--warn" [attr.title]="unprintableTitle">onvolledig</i> }
                @if (row.belowCost) { <i class="cps-tag cps-tag--warn" [attr.title]="'Kostprijs ' + (row.product.landedCostEur | eur)">onder kost</i> }
              </span>
              <span class="cps-row__cat">{{ row.catalogue !== null ? (row.catalogue | eur) : 'op aanvraag' }}</span>
              @if (customer()) {
                <span class="cps-row__own">
                  @if (row.stored; as own) {
                    <b [class.is-off]="own.status !== 'ACTIVE'">{{ own.priceExclVat | eur }}</b>
                    @if (own.status !== 'ACTIVE') { <small [attr.title]="ownTitle(own)">{{ ownWord(own) }}</small> }
                  } @else { <b class="is-off">—</b> }
                </span>
              }
              <span class="cps-row__field">
                @if (row.onRequest || row.unprintable) {
                  <span class="cps-row__request" [attr.title]="row.unprintable ? unprintableTitle : null">Op aanvraag</span>
                } @else {
                  <i aria-hidden="true">€</i>
                  <input class="input" appDecimal [placeholder]="placeholder(row.standard)" [attr.aria-label]="'Prijs in deze PDF, ' + row.name"
                         [ngModel]="row.price?.priceEur ?? null" (ngModelChange)="setPrice(row.product, $event)" />
                }
              </span>
              <button class="cps-row__more" type="button" [attr.aria-label]="'Meer voor ' + row.name" (click)="openMenu($event, row)">⋯</button>
            </li>
          } @empty {
            <li class="cps__empty">{{ onlyChanged() && !query().trim() ? 'Nog geen aangepaste prijzen.' : 'Geen producten gevonden.' }}</li>
          }
        </ul>
        <!-- Inside the sheet: its overlay is a stacking context, a desk popover outside it would open under the sheet. -->
        @if (menu(); as open) {
          <app-context-menu variant="ios" [title]="open.row.name" [items]="menuItems(open.row)" [anchor]="open.anchor"
                            (pick)="pick(open.row, $event)" (closed)="menu.set(null)" />
        }
      </div>
      <div foot class="cps-foot">
        @if (customer(); as who) {
          <label class="cps-keep">
            <input type="checkbox" [checked]="keep()" [disabled]="busy() || !keepable().length" (change)="keep.set($any($event.target).checked)" />
            <span>Ook bewaren als prijzen van {{ who.name }}</span>
          </label>
        }
        <button class="btn cps-foot__cancel" type="button" [disabled]="busy()" (click)="requestClose()">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="busy() || blocked()" (click)="apply()">
          {{ busy() ? 'Bewaren…' : 'Toepassen (' + changeCount() + ')' }}
        </button>
      </div>
    </app-sheet>
  `,
  styles: `
    .cps { display: grid; gap: 12px; min-width: 0; }
    .cps__for { margin: 0; color: var(--muted); font-size: 13px; font-weight: 600; line-height: 1.4; overflow-wrap: anywhere; }
    .cps-tools { display: grid; gap: 8px; min-width: 0; }
    .cps-search { position: relative; display: block; }
    .cps-search svg { position: absolute; left: 12px; top: 50%; width: 17px; height: 17px; transform: translateY(-50%); fill: none; stroke: var(--muted); stroke-width: 1.8; pointer-events: none; }
    .cps-search .input { min-height: 44px; padding-left: 38px; border-radius: 12px; }
    .cps-tools__row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; min-width: 0; }
    .cps-tools__row .chip { min-height: 36px; }
    .cps-pct { display: inline-flex; align-items: center; gap: 6px; }
    .cps-pct__sign { width: 36px; height: 36px; flex: none; padding: 0; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--surface); color: var(--ink); font-family: inherit; font-size: 18px; font-weight: 650; line-height: 1; cursor: pointer; }
    .cps-pct .input { width: 58px; min-height: 36px; padding: 5px 9px; border-radius: 10px; text-align: right; }
    .cps-pct .btn { min-height: 36px; white-space: nowrap; }
    .cps-reset { min-height: 36px; margin-left: auto; font-size: 13px; }
    .cps-rows { display: grid; margin: 0; padding: 0; list-style: none; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
    .cps-row { display: grid; align-items: center; column-gap: 10px; row-gap: 1px; min-width: 0; padding: 9px 12px; }
    .cps-row + .cps-row { border-top: 1px solid var(--line); }
    .cps-row__photo { grid-area: photo; display: grid; width: 40px; height: 44px; place-items: center; overflow: hidden; border-radius: 8px; background: #fff; box-shadow: inset 0 0 0 1px var(--line); }
    .cps-row__photo img { width: 100%; height: 100%; padding: 2px; box-sizing: border-box; object-fit: contain; }
    .cps-row__name { grid-area: name; align-self: end; min-width: 0; overflow: hidden; color: var(--ink); font-size: 14px; font-weight: 650; line-height: 1.3; text-overflow: ellipsis; white-space: nowrap; }
    .cps-row__name span { color: var(--rose-dark); }
    .cps-row__meta { grid-area: meta; display: flex; align-self: start; align-items: center; gap: 5px; min-width: 0; color: var(--muted); font-size: 12px; line-height: 1.35; }
    .cps-row__text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cps-row__message { color: var(--danger); font-weight: 600; }
    .cps-tag { flex: none; padding: 1px 7px; border-radius: 99px; background: var(--surface-2); color: var(--ink-2); font-size: 10.5px; font-style: normal; font-weight: 700; white-space: nowrap; }
    .cps-tag--own { background: var(--rose-soft); color: var(--rose-dark); }
    .cps-tag--warn { background: var(--warn-soft); color: var(--warn); }
    .cps-row__cat, .cps-row__own { display: grid; justify-items: end; gap: 1px; min-width: 0; font-size: 13px; font-variant-numeric: tabular-nums; }
    .cps-row__cat { grid-area: cat; color: var(--ink-2); }
    .cps-row__own { grid-area: own; }
    .cps-row__own b { font-weight: 650; color: var(--rose-dark); }
    .cps-row__own b.is-off { color: var(--muted); font-weight: 500; text-decoration: line-through; }
    .cps-row__own small { max-width: 100%; overflow: hidden; color: var(--warn); font-size: 11px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
    .cps-row__field { grid-area: field; position: relative; min-width: 0; }
    .cps-row__field > i { position: absolute; top: 50%; left: 10px; color: var(--muted); font-size: 14px; font-style: normal; transform: translateY(-50%); pointer-events: none; }
    .cps-row__field .input { min-height: 40px; padding: 6px 10px 6px 24px; border-radius: 10px; text-align: right; font-variant-numeric: tabular-nums; }
    .cps-row__field .input::placeholder { color: color-mix(in srgb, var(--muted) 75%, transparent); }
    .is-changed .cps-row__field .input { border-color: var(--rose); background: color-mix(in srgb, var(--rose-soft) 45%, var(--surface)); font-weight: 700; }
    .is-wrong .cps-row__field .input { border-color: var(--danger); }
    .cps-row__request { display: grid; min-height: 40px; place-items: center; border-radius: 10px; background: var(--surface-2); color: var(--ink-2); font-size: 12.5px; font-weight: 650; }
    .is-changed .cps-row__request { background: var(--rose-soft); color: var(--rose-dark); }
    .cps-row__more { grid-area: more; display: grid; width: 28px; height: 40px; place-items: center; padding: 0; border: 0; background: transparent; color: var(--muted); font-size: 18px; cursor: pointer; }
    .cps__empty { padding: 22px 16px; color: var(--muted); font-size: 13px; text-align: center; }
    .cps-head { display: none; }
    .cps-foot { display: contents; }
    .cps-keep { display: flex; flex: 1 1 auto; align-items: center; gap: 9px; min-width: 0; margin-right: auto; color: var(--ink-2); font-size: 13px; font-weight: 600; cursor: pointer; }
    .cps-keep input { width: 18px; height: 18px; flex: none; margin: 0; accent-color: var(--rose); }
    .cps-keep span { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; }
    @media (min-width: 1024px), (min-width: 680px) and (hover: hover) {
      .cps-head, .cps-row { grid-template-columns: 44px minmax(0, 1fr) 92px 128px 28px; grid-template-areas: 'photo name cat field more' 'photo meta cat field more'; column-gap: 14px; }
      .cps--own .cps-head, .cps--own .cps-row { grid-template-columns: 44px minmax(0, 1fr) 92px 124px 128px 28px; grid-template-areas: 'photo name cat own field more' 'photo meta cat own field more'; }
      .cps-row { padding: 9px 14px; }
      .cps-row__photo { width: 44px; }
      .cps-row__phone { display: none; }
      .cps-head { display: grid; padding: 0 14px; color: var(--muted); font-size: 10.5px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
      .cps-head span { text-align: right; }
      .cps-head span:first-child { grid-column: 1 / 3; text-align: left; }
      .cps-head span:last-child { grid-column: -3 / -2; }
      .cps-keep { max-width: 440px; }
    }
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px) {
      .cps { padding: 0 16px; }
      .cps__for { text-align: center; }
      /* The name has the first line to itself (the colour must never be cut), the field the second. */
      .cps-row { grid-template-columns: 36px minmax(0, 1fr) 64px 28px; grid-template-areas: 'photo name name more' 'photo meta field field'; column-gap: 8px; row-gap: 4px; padding: 9px 10px; }
      .cps-row__photo { width: 36px; height: 40px; }
      .cps-row__name { align-self: center; }
      .cps-row__meta { align-self: center; }
      .cps-row__more { height: 36px; margin: -8px 0; }
      .cps-row__cat, .cps-row__own, .cps-row__desk { display: none; }
      .cps-row__field .input { min-height: 38px; font-size: 16px; }
      .cps-row__request { min-height: 38px; }
      .cps-foot { display: grid; width: 100%; gap: 10px; }
      .cps-foot__cancel { display: none; }
      .cps-keep { margin: 0; padding: 2px 4px; }
    }
  `,
})
export class CatalogPriceSheet implements OnInit {
  protected readonly desktop = inject(DesktopViewport);
  private readonly ui = inject(Ui);
  private readonly api = inject(CustomerPriceApi);

  /** The selected products, in the catalogue's order. */
  readonly products = input.required<readonly Product[]>();
  /** The one-off prices as applied now. */
  readonly overrides = input<ReadonlyMap<number, CatalogPriceOverride>>(new Map());
  /** A stored customer; a free recipient name has no prices of its own. */
  readonly customer = input<{ id: number; name: string } | null>(null);
  readonly customerPrices = input<ReadonlyMap<number, CustomerPrice>>(new Map());
  /** "3 klantprijzen", "Klantprijzen laden…": after the customer's name. */
  readonly customerNote = input('');
  /** The PDF's "Geldig tot", which typed prices take along when they are stored for the customer. */
  readonly validUntil = input('');
  /** The server's last refusal (CATALOG_PRICES_INVALID), shown on the rows it names until they change. */
  readonly issues = input<readonly CatalogPriceIssue[]>([]);
  readonly applied = output<Map<number, CatalogPriceOverride>>();
  readonly saved = output<CustomerPrice[]>();
  readonly closed = output<void>();

  /** The prices being typed; Toepassen hands them to the page. */
  readonly draft = linkedSignal<Map<number, CatalogPriceOverride>>(() => new Map(this.overrides()));
  readonly query = signal('');
  readonly onlyChanged = signal(false);
  readonly percent = signal<number | null>(null);
  /** −1 for a discount on every price, +1 for a surcharge. */
  readonly sign = signal<-1 | 1>(-1);
  readonly keep = signal(false);
  readonly busy = signal(false);
  readonly menu = signal<{ row: PriceRow; anchor: MenuPoint } | null>(null);

  readonly rows = computed<PriceRow[]>(() => {
    const draft = this.draft();
    const applied = this.overrides();
    const stored = this.customerPrices();
    const issues = new Map(this.issues().map((issue) => [issue.productId, issue.message]));
    return this.products().flatMap((product) => {
      if (product.id === null) return [];
      const id = product.id;
      const unit = productSalesUnit(product);
      const own = stored.get(id) ?? null;
      const standard = standardPrice(product, own);
      const price = draft.get(id) ?? null;
      const problem = price && !price.onRequest ? priceProblem(price.priceEur) : null;
      const stale = !!price && basisChanged(product, price);
      /* The server's word stays on the row only while the row is as it was sent. */
      const refused = issues.has(id) && sameOverride(price ?? undefined, applied.get(id)) ? issues.get(id)! : null;
      const shown = price?.onRequest ? null : price && price.priceEur !== null && !problem ? price.priceEur : standard.eur;
      const cost = product.landedCostEur;
      const photo = cataloguePhoto(product);
      return [{
        id, product,
        name: stripColour(product.name?.trim() ?? '', product.colour),
        variant: variantOf(product),
        sku: product.sku || 'Zonder SKU',
        per: unit.isDisplay ? 'per display' : unit.piece.per,
        catalogue: cataloguePrice(product),
        stored: own && own.status !== 'PRODUCT_GONE' ? own : null,
        standard, price,
        changed: !!price && changesPrint(product, price, standard),
        onRequest: !!price?.onRequest,
        unprintable: !pricePrintable(product),
        message: problem ?? (stale ? 'Prijsbasis gewijzigd · vul opnieuw in' : refused),
        belowCost: shown !== null && cost !== null && cost > 0 && shown < cost,
        photo: photo?.smallUrl || photo?.url || null,
      }];
    });
  });
  readonly visibleRows = computed(() => {
    const needle = this.query().trim().toLocaleLowerCase('nl-BE');
    return this.rows().filter((row) => (!this.onlyChanged() || row.changed || !!row.message)
      && (!needle || [row.product.name, row.sku, row.product.colour, row.product.variantSize, row.product.canonicalBarcode]
        .filter(Boolean).join(' ').toLocaleLowerCase('nl-BE').includes(needle)));
  });
  readonly changeCount = computed(() => this.rows().filter((row) => row.changed && !row.message).length);
  /** A typed price that cannot go, or one on a unit the product is no longer sold in: fix it first. */
  readonly blocked = computed(() => this.rows().some((row) => !!row.price && !!row.message && row.message !== this.refusalOf(row)));
  /** The typed prices that can become the customer's own; "Op aanvraag" is for this PDF only. */
  readonly keepable = computed(() => this.rows().filter((row) => row.changed && !row.message && !row.onRequest && row.price?.priceEur != null));
  private readonly dirty = computed(() => {
    const draft = this.draft();
    const applied = this.overrides();
    return draft.size !== applied.size || [...draft].some(([id, price]) => !sameOverride(price, applied.get(id)));
  });

  ngOnInit(): void {
    /* Opened from the server's refusal: the rows it names come first. */
    if (this.issues().length) this.onlyChanged.set(true);
  }

  placeholder(standard: StandardPrice): string {
    return standard.eur === null ? 'Op aanvraag' : standard.eur.toFixed(2).replace('.', ',');
  }

  readonly unprintableTitle = UNPRINTABLE;

  ownWord(own: CustomerPrice): string {
    return OWN_STATE[own.status] ?? '';
  }

  ownTitle(own: CustomerPrice): string {
    const amount = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' }).format(own.priceExclVat);
    if (own.status === 'EXPIRED' && own.validUntil) return `Klantprijs ${amount}, verlopen op ${own.validUntil.split('-').reverse().join('/')}`;
    if (own.status === 'BASIS_CHANGED') return `Klantprijs ${amount}, gezet toen het product anders verkocht werd`;
    return `Klantprijs ${amount}`;
  }

  setPrice(product: Product, value: number | null): void {
    if (product.id === null) return;
    const id = product.id;
    this.draft.update((draft) => {
      const next = new Map(draft);
      if (value === null) next.delete(id);
      else next.set(id, oneOffPrice(product, value));
      return next;
    });
  }

  resetAll(): void {
    this.draft.set(new Map());
  }

  /** Every price that has one, from what it would print without a change (never compounding): whole cents, half up. */
  applyPercent(): void {
    const typed = this.percent();
    if (typed === null) return;
    const pct = typed < 0 ? typed : this.sign() * typed;
    if (pct === 0 || !(pct > -100) || pct > 1000 || Math.abs(pct * 100 - Math.round(pct * 100)) > 1e-6) {
      this.ui.toast('Kies een percentage onder 100 % korting, met hoogstens 2 decimalen.', 'err');
      return;
    }
    const next = new Map(this.draft());
    let count = 0;
    for (const row of this.rows()) {
      if (row.onRequest || row.standard.eur === null) continue;
      const price = percentPrice(row.standard.eur, pct);
      if (priceProblem(price)) continue;
      next.set(row.id, oneOffPrice(row.product, price));
      count++;
    }
    this.draft.set(next);
    this.percent.set(null);
    const sign = pct > 0 ? '+' : '−';
    this.ui.toast(`${sign}${Math.abs(pct).toLocaleString('nl-BE')} % op ${count} ${count === 1 ? 'prijs' : 'prijzen'}`);
  }

  openMenu(event: MouseEvent, row: PriceRow): void {
    const rect = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect();
    this.menu.set({ row, anchor: rect ? { x: rect.left, y: rect.bottom + 4 } : { x: event.clientX, y: event.clientY } });
  }

  menuItems(row: PriceRow): ContextMenuItem[] {
    const standard = row.standard.eur === null ? 'Prijs op aanvraag'
      : `${this.placeholder(row.standard)} · ${row.standard.source === 'CUSTOMER' ? 'klantprijs' : 'catalogusprijs'}`;
    return [
      row.unprintable
        ? { id: 'request', label: 'Op aanvraag', hint: 'Display zonder aantal stuks', checked: true, disabled: true }
        : { id: 'request', label: 'Op aanvraag', hint: 'Geen prijs in deze PDF', checked: row.onRequest },
      { id: 'standard', label: 'Terug naar standaard', hint: standard, disabled: !row.price, divider: true },
    ];
  }

  pick(row: PriceRow, item: ContextMenuItem): void {
    this.menu.set(null);
    const next = new Map(this.draft());
    if (item.id === 'standard' || (item.id === 'request' && row.onRequest)) next.delete(row.id);
    else if (item.id === 'request') next.set(row.id, oneOffPrice(row.product, null, true));
    this.draft.set(next);
  }

  async apply(): Promise<void> {
    if (this.busy() || this.blocked()) return;
    const customer = this.customer();
    const keep = customer && this.keep() ? this.keepable() : [];
    if (customer && keep.length) {
      /* The PDF's validity goes along, unless it already lies in the past. */
      const until = this.validUntil() && this.validUntil() >= todayIso() ? this.validUntil() : null;
      this.busy.set(true);
      try {
        const saved = await this.api.save(customer.id, {
          source: 'CATALOG_EXPORT',
          changes: keep.map((row) => ({ productId: row.id, priceExclVat: row.price!.priceEur, validUntil: until })),
        });
        this.saved.emit(saved);
        this.ui.toast(`${keep.length} ${keep.length === 1 ? 'prijs' : 'prijzen'} bewaard voor ${customer.name}`);
      } catch (failure) {
        this.ui.toast(messageOf(failure, 'De klantprijzen zijn niet bewaard. Probeer opnieuw.'), 'err');
        return;
      } finally {
        this.busy.set(false);
      }
    }
    this.applied.emit(new Map(this.draft()));
  }

  requestClose(): void {
    if (this.busy()) return;
    if (!this.dirty()) {
      this.closed.emit();
      return;
    }
    this.ui.confirm({ title: 'Prijzen niet toepassen?', message: 'Wat je hier aanpaste, gaat verloren.', confirmLabel: 'Niet toepassen', danger: true },
      () => this.closed.emit());
  }

  private refusalOf(row: PriceRow): string | null {
    const issue = this.issues().find((candidate) => candidate.productId === row.id);
    return issue && sameOverride(row.price ?? undefined, this.overrides().get(row.id)) ? issue.message : null;
  }
}
