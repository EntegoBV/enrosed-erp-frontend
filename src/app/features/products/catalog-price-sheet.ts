import {
  ChangeDetectionStrategy, Component, ElementRef, Injector, type OnInit, afterNextRender, computed, inject, input, linkedSignal, output, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthImage } from '../../core/api/auth-image';
import type { CatalogPriceIssue, CatalogPriceOverride } from '../../core/api/catalog-api';
import { CustomerPriceApi, priceBasisRefusal, type CustomerPrice } from '../../core/api/customer-price-api';
import { messageOf } from '../../core/api/errors';
import { SalesApi } from '../../core/api/sales-api';
import type { Category, Product, ProductFamily } from '../../core/api/models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { ContextMenu, type ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { DateField } from '../../shared/date-field';
import { DecimalInput } from '../../shared/decimal-input';
import { EurPipe } from '../../shared/pipes';
import { Sheet, Ui } from '../../shared/ui';
import { stripColour, variantOf } from '../purchasing/purchase-desk-format';
import {
  basisChanged, cataloguePrice, changesPrint, oneOffPrice, percentPrice, priceBasis, priceProblem, pricePrintable, standardPrice, todayIso,
  type PriceBasisNow, type StandardPrice,
} from './catalog-prices';
import {
  catalogCategorySearchName, catalogSearchKey, catalogSearchMatch, catalogSearchText, catalogSearchWords,
} from './catalog-product-selection-state';
import { cataloguePhoto } from './catalog-studio';
import { productSalesUnit } from './product-sales-unit';

interface PriceRow {
  id: number;
  product: Product;
  /** "Rozenstolp M": the product's name without its colour; the colours of one product share it. */
  name: string;
  /** "Rozenstolp M · Rood · 20 cm": the row menu's title and the field's name for a screen reader. */
  label: string;
  /** The label for a narrow row: the head gives way; the tail (" · Rood · 20 cm", or " 30 cm · Rood" when the name
      ends with its size) never does, because the rows of one family differ only there. */
  head: string;
  tail: string | null;
  sku: string;
  /** "per stolp", "per display": what every amount on the row is for. */
  per: string;
  /** "/ stolp", "/ display": the same after the phone's catalogue price, as the selection's reference prices say it. */
  slash: string;
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
  /** Taken in here: it joins the PDF on Toepassen. */
  added: boolean;
  /** What the search finds it by (catalogSearchText). */
  search: string;
}

/** The words of a stored price that does not apply, as the desk's Klant column says them. */
const OWN_STATE: Record<string, string> = { ACTIVE: 'klant', EXPIRED: 'verlopen', BASIS_CHANGED: 'prijsbasis gewijzigd' };
/** The phone's one-word chip, "Nakijken" as the customer's price block says it; the price and its unit keep the room. */
const OWN_CHIP: Record<string, string> = { ...OWN_STATE, BASIS_CHANGED: 'nakijken' };
const UNPRINTABLE = 'Display zonder aantal stuks: de PDF toont Prijs op aanvraag';
const STALE = 'Prijsbasis gewijzigd · vul opnieuw in';

function sameOverride(a: CatalogPriceOverride | undefined, b: CatalogPriceOverride | undefined): boolean {
  return a?.priceEur === b?.priceEur && !!a?.onRequest === !!b?.onRequest && a?.basis === b?.basis
    && (a?.piecesPerUnit ?? null) === (b?.piecesPerUnit ?? null);
}

/** "12,90", or "Op aanvraag": a price field's placeholder. */
function pricePlaceholder(eur: number | null): string {
  return eur === null ? 'Op aanvraag' : eur.toFixed(2).replace('.', ',');
}

/**
 * The colours of one product: one family, one size and one sales unit, so one
 * price can fit them all. Another size or unit of the family is a product of
 * its own (sizes have prices of their own); a product without a family stands
 * alone.
 */
function groupKey(product: Product): string {
  if (product.familyId === null) return `p${product.id}`;
  const size = product.variantSize?.trim().toLocaleLowerCase('nl-BE') ?? '';
  return `f${product.familyId}|${size}|${unitKey(product)}`;
}

/** What one typed number means: per piece (a stolp, a bowl, a stuk alike) or per display of so many pieces. */
function unitKey(product: Product): string {
  const unit = priceBasis(product);
  return `${unit.basis}|${unit.piecesPerUnit ?? ''}`;
}

/** A product with its colours below it: its price field types one price on every colour. */
interface PriceGroup {
  key: string;
  /** Every colour, in the catalogue's order, also those a search or "Alleen aangepast" hides. */
  rows: PriceRow[];
  /** "Diamantroos met display en geur · 4.5*4.5cm": the menu's title and the field's name. */
  label: string;
  head: string;
  tail: string | null;
  /** "4 kleuren"; "3 varianten" when the colours do not tell them apart. */
  count: string;
  /** Every colour has a colour of its own: the rows below say only "Rood". */
  byColour: boolean;
  /** "kleur" or "variant": what the menu says the change is for. */
  noun: string;
  photo: string | null;
  per: string;
  slash: string;
  catalogue: number | null;
  catalogueMixed: boolean;
  /** The customer's price of every colour alike; ownMixed when they differ. */
  own: CustomerPrice | null;
  ownMixed: boolean;
  placeholder: string;
  /** No € before the field: "Op aanvraag" or "Verschillend" fills it. */
  bare: boolean;
  /** The colours print different prices and none is typed on all: the field says "Verschillend". */
  mixed: boolean;
  /** The price typed on every colour alike; null while they differ or none is typed. */
  value: number | null;
  changed: boolean;
  onRequest: boolean;
  unprintable: boolean;
  message: string | null;
  /** "Alle 8 gevonden": one price for the rows a search shows, over products. */
  found: boolean;
  /** One unit basis among the rows: only then does one number fit them all (a product's colours always share it). */
  units: boolean;
  /** The rows share a basis but not the word ("per stolp / per stuk"): the line names both. */
  perWarn: boolean;
  /** Every row is taken in here. */
  added: boolean;
  /** Rows that print below their landed cost. */
  below: number;
}

/**
 * `sizes`: the family is in the list in more than one size. Only then does
 * the product's line show its size, kept whole like a colour on a row (the
 * name gives way): one size is a fact of the product, not what tells it apart.
 */
function priceGroup(key: string, rows: PriceRow[], families: ReadonlyMap<number, string>, sizes: boolean, noun?: string): PriceGroup {
  const first = rows[0];
  const shared = rows.every((row) => row.name === first.name);
  const name = shared ? first.name : (first.product.familyId !== null ? families.get(first.product.familyId) : null) || first.name;
  /* "Rozenstolp 30 cm" already names its size. */
  const size = first.product.variantSize?.trim() || null;
  const named = !!size && name.endsWith(size);
  const split = sizes && named && name.endsWith(` ${size}`);
  const colours = rows.map((row) => row.product.colour?.trim().toLocaleLowerCase('nl-BE') ?? '');
  const byColour = shared && colours.every(Boolean) && new Set(colours).size === rows.length;
  const what = noun ?? (byColour ? 'kleur' : 'variant');
  const typed = first.price;
  const value = typed && !typed.onRequest && typed.priceEur !== null
    && rows.every((row) => !!row.price && !row.price.onRequest && row.price.priceEur === typed.priceEur) ? typed.priceEur : null;
  /* What each colour prints now, a typed price included: the field shows one price only while they all print it. */
  const printed = (row: PriceRow): number | null => row.onRequest || row.unprintable ? null
    : row.price && row.price.priceEur !== null && !priceProblem(row.price.priceEur) ? row.price.priceEur : row.standard.eur;
  const shown = printed(first);
  const samePrint = rows.every((row) => printed(row) === shown);
  const sameOwn = rows.every((row) => row.stored?.priceExclVat === first.stored?.priceExclVat && row.stored?.status === first.stored?.status);
  /* A price typed on all of them that the colours refuse (a unit changed since, the server's word): the product says so too. */
  const refused = rows.find((row) => row.message)?.message ?? null;
  return {
    key, rows,
    label: size && !named ? `${name} · ${size}` : name,
    head: split ? name.slice(0, -size!.length).trimEnd() : name,
    tail: split ? `\u00a0${size}` : sizes && size && !named ? `\u00a0· ${size}` : null,
    count: `${rows.length} ${byColour ? 'kleuren' : 'varianten'}`,
    byColour,
    noun: what,
    photo: rows.find((row) => row.photo)?.photo ?? null,
    per: first.per,
    slash: first.slash,
    catalogue: first.catalogue,
    catalogueMixed: !rows.every((row) => row.catalogue === first.catalogue),
    own: sameOwn ? first.stored : null,
    ownMixed: !sameOwn,
    placeholder: samePrint ? pricePlaceholder(shown) : 'Verschillend',
    bare: value === null && (!samePrint || shown === null),
    mixed: value === null && !samePrint,
    value,
    changed: rows.some((row) => row.changed) && (value !== null || rows.every((row) => row.onRequest)),
    onRequest: rows.every((row) => row.onRequest),
    unprintable: rows.every((row) => row.unprintable),
    message: value === null ? null
      : priceProblem(value) ?? (refused && (rows.every((row) => row.message === refused) ? refused : `Nakijken per ${what}`)),
    found: false,
    units: true,
    perWarn: false,
    added: rows.every((row) => row.added),
    below: rows.filter((row) => row.belowCost).length,
  };
}

/**
 * "Alle 8 gevonden" (Emre, 2026-11-07: all the 12x25 domes at once): one
 * price for exactly the rows a search shows in the PDF, over products and
 * families. Only printable rows take it, and only while they share one unit
 * basis: a price per display next to one per piece is where a ×6 mistake hides.
 */
function foundGroup(shown: readonly PriceRow[], products: number): PriceGroup {
  const printable = shown.filter((row) => !row.unprintable);
  const rows = printable.length ? printable : [...shown];
  const base = priceGroup('found', rows, new Map(), false, 'variant');
  const words = [...new Set(printable.map((row) => row.per))];
  const label = `Alle ${shown.length} gevonden`;
  return {
    ...base, label, head: label, tail: null, count: products > 1 ? `${products} producten` : '', byColour: false, photo: null,
    per: words.join(' / ') || base.per, perWarn: words.length > 1, found: true,
    units: new Set(printable.map((row) => unitKey(row.product))).size <= 1,
    added: shown.every((row) => row.added), below: shown.filter((row) => row.belowCost).length,
  };
}

/** A product the PDF does not have yet, found by the search: a press takes in exactly the colours it shows. */
interface OutsideLine {
  key: string;
  rows: PriceRow[];
  photo: string | null;
  head: string;
  tail: string | null;
  label: string;
  /** "4 kleuren · per stolp", or a single colour's "SKU · per stolp". */
  desk: string;
  /** What follows the phone's "€ 13,00 / stolp": "4 kleuren", or the SKU. */
  phone: string;
  per: string;
  slash: string;
  catalogue: number | null;
  catalogueMixed: boolean;
  own: CustomerPrice | null;
  ownMixed: boolean;
}

/** One line of the list: a product above its colours, or a row (a colour below its product, or a product on its own). */
interface PriceEntry {
  key: string;
  group: PriceGroup | null;
  row: PriceRow | null;
  /** The product's line: "4 kleuren", or "1 van 4 kleuren" while the others are hidden. */
  count: string;
  /** A search or "Alleen aangepast" hides some of its colours: the product's line has no field and no menu then,
      so a price typed there can never reach a colour out of sight. */
  narrowed: boolean;
  /** The row's first line: a colour below its product says only "Rood". */
  name: string;
  tail: string | null;
  colour: boolean;
  tint: boolean;
  /** A row taken in here whose product line does not say so itself: the row says "nieuw". */
  fresh: boolean;
}

/** What every row is worked out from; a product outside the PDF uses the same to show its prices. */
interface RowContext {
  draft: ReadonlyMap<number, CatalogPriceOverride>;
  applied: ReadonlyMap<number, CatalogPriceOverride>;
  stored: ReadonlyMap<number, CustomerPrice>;
  issues: ReadonlyMap<number, string>;
  refusedBasis: ReadonlyMap<number, PriceBasisNow> | null;
  added: ReadonlySet<number>;
  texts: ReadonlyMap<number, string>;
  /** The customer's Geldig tot for the prices typed here ('' in a PDF). */
  until: string;
}

interface PriceMenu {
  title: string;
  ids: readonly number[];
  /** "kleur" when the menu is a product's, for all its colours; null for one row. */
  noun: string | null;
  anchor: MenuPoint;
}

/**
 * Prijzen aanpassen: the price of every product in this one PDF, and the
 * place to take more in. A row shows what the PDF prints without a change
 * (the field's placeholder: the customer's price while it applies, else the
 * catalogue price) and takes a one-off price, "Op aanvraag" from its menu, or
 * a percentage on the rows on screen. The colours of one product stand below
 * it (Emre, 2026-11-07): the product's field types its price on every colour,
 * a colour's own field changes only that colour. The search looks through the
 * whole catalogue (12x25 is 12*25): what the PDF does not have yet stands
 * under "Niet in deze PDF", one press takes it in ("Alle 8 opnemen" all of
 * it), and "Alle 8 gevonden" gives one price to every row the search shows
 * (Emre, same day: no more one product at a time between step 03 and here).
 * Nothing changes until Toepassen, which also adds the taken-in products to
 * the PDF's selection. mode "customer" is the same sheet on the customer's
 * Klantprijzen (Emre, same day: "alle stolpen aanpassen in 1 x"): the list is
 * the customer's priced products, the field is the new price, "Bewaren"
 * stores every typed price at once (optional Geldig tot), and there is no
 * PDF, no "Op aanvraag" and no keep box. In both, "Prijzen van klant…" puts
 * another customer's active prices in as typed prices (taking in what is not
 * listed yet), to look over before Toepassen or Bewaren (Emre, same day:
 * "prijzen van andere klant kunnen overnemen dat het snel kan"). With a
 * customer in the PDF,
 * "Ook bewaren als klantprijzen van …" also stores the typed prices as that
 * customer's own (PUT /api/customers/{id}/prices, source CATALOG_EXPORT),
 * with the PDF's validity date and the unit each was typed on: one the
 * product has left since is refused (nothing stored) and asks to be typed
 * again. "onder kost" compares with the landed cost and stops nothing.
 */
@Component({
  selector: 'app-catalog-price-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, ContextMenu, DateField, DecimalInput, EurPipe, FormsModule, Sheet],
  template: `
    <app-sheet title="Prijzen aanpassen" variant="ios" [wide]="desktop.active()" (closed)="requestClose()">
      <div body class="cps" [class.cps--own]="!!customer()" [attr.inert]="busy() ? '' : null">
        @if (customer(); as who) {
          <p class="cps__for">@if (forCustomer()) {Klantprijzen van {{ who.name }}} @else {Voor {{ who.name }}@if (customerNote()) {<span> · {{ customerNote() }}</span>}}</p>
        }
        <div class="cps-tools">
          <label class="cps-search">
            <span class="sr-only">Zoek een product</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
            <!-- The desk starts typing here; the phone keeps its keyboard down until the field is tapped. -->
            <input class="input" type="search" placeholder="Zoek in de hele catalogus…" enterkeyhint="search"
                   [attr.data-initial-focus]="desktop.active() ? '' : null"
                   [ngModel]="query()" (ngModelChange)="query.set($event)" (keydown.enter)="jumpToPrice($event)" />
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
              <!-- On the rows on screen: a search or "Alleen aangepast" narrows it, and the button says to how many. -->
              <button class="btn btn--sm" type="button" [disabled]="percent() === null || !shownRows().length" (click)="applyPercent()">
                {{ narrowed() && shownRows().length ? '% op ' + shownRows().length : '% op alles' }}
              </button>
            </span>
            <!-- Another customer's active prices as typed prices here, looked over before Toepassen or Bewaren. -->
            <label class="cps-copy">
              <span class="sr-only">Prijzen overnemen van een andere klant</span>
              <select class="select" [disabled]="copying() || !donors()?.length" (change)="copyFrom($any($event.target))">
                <option value="" selected>{{ copying() ? 'Overnemen…' : donors() === null ? (donorsFailed() ? 'Klanten niet geladen' : 'Klanten laden…') : 'Prijzen van klant…' }}</option>
                @for (donor of donors() ?? []; track donor.id) { <option [value]="donor.id">{{ donor.name }}</option> }
              </select>
            </label>
            <button class="linklike cps-reset" type="button" [disabled]="!draft().size" (click)="resetAll()">Alles terug</button>
          </div>
        </div>
        @if (entries().length || outside().length) {
          <div class="cps-head" aria-hidden="true">
            <span>Product</span><span>Catalogus</span>@if (customer()) {<span>Klant</span>}<span>{{ forCustomer() ? 'Nieuwe prijs' : 'In deze PDF' }}</span>
          </div>
        }
        @if (outside().length) {
          <!-- First, so taking in stays in sight above the keyboard; the found line then covers what came in. -->
          <section class="cps-more" aria-labelledby="cps-more-title">
            <div class="cps-more__head">
              <span id="cps-more-title">{{ forCustomer() ? 'Zonder klantprijs' : 'Niet in deze PDF' }}</span>
              @if (outside().length > 1) {
                <button class="btn btn--sm" type="button" (click)="includeAll()">Alle {{ outsideCount() }} opnemen</button>
              }
            </div>
            <ul class="cps-rows cps-rows--more">
              @for (line of outside(); track line.key) {
                <!-- The whole line takes it in; the pill is its keyboard and screen-reader handle. -->
                <li class="cps-row cps-row--add" (click)="takeIn($event, line.rows)">
                  <span class="cps-row__photo">@if (line.photo) {<img [appAuthSrc]="line.photo" appAuthLazy alt="" />}</span>
                  <b class="cps-row__name"><span>{{ line.head }}</span>@if (line.tail) {<span class="cps-row__variant">{{ line.tail }}</span>}</b>
                  <span class="cps-row__meta">
                    <span class="cps-row__text cps-row__desk">{{ line.desk }}</span>
                    @if (line.catalogueMixed || line.catalogue === null) {
                      <span class="cps-row__text cps-row__phone">{{ line.phone }} · {{ line.per }}</span>
                    } @else {
                      <span class="cps-row__phone cps-row__price">{{ line.catalogue | eur }} {{ line.slash }}</span>
                      <span class="cps-row__text cps-row__phone cps-row__sku">&nbsp;· {{ line.phone }}</span>
                    }
                  </span>
                  <span class="cps-row__cat">
                    @if (line.catalogueMixed) { <span class="cps-row__mixed">verschillend</span> }
                    @else { {{ line.catalogue !== null ? (line.catalogue | eur) : 'op aanvraag' }} }
                  </span>
                  @if (customer()) {
                    <span class="cps-row__own">
                      @if (line.ownMixed) {
                        <span class="cps-row__mixed">verschillend</span>
                      } @else if (line.own; as own) {
                        <b [class.is-off]="own.status !== 'ACTIVE'">{{ own.priceExclVat | eur }}</b>
                      } @else { <b class="is-off">—</b> }
                    </span>
                  }
                  <span class="cps-row__field">
                    <button class="cps-row__take" type="button" [attr.aria-label]="(forCustomer() ? 'Opnemen: ' : 'Opnemen in deze PDF: ') + line.label">Opnemen</button>
                  </span>
                </li>
              }
            </ul>
          </section>
        }
        @if (entries().length || !outside().length) {
        <ul class="cps-rows">
          @for (entry of entries(); track entry.key) {
            @if (entry.group?.found && entry.group; as group) {
              <!-- Every row the search shows, over products: one price for all of them, never one out of sight. -->
              <li class="cps-row cps-row--head cps-row--found" [attr.data-key]="entry.key" [class.is-changed]="group.changed" [class.is-wrong]="!!group.message">
                <span class="cps-row__photo cps-row__photo--find" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg></span>
                <b class="cps-row__name"><span>{{ group.head }}</span></b>
                <span class="cps-row__meta">
                  @if (group.message) {
                    <span class="cps-row__text cps-row__message">{{ group.message }}</span>
                  } @else if (!group.units) {
                    <span class="cps-row__text cps-row__warn">Eenheden verschillen</span>
                  } @else {
                    <span class="cps-row__text cps-row__desk" [class.cps-row__warn]="group.perWarn">@if (group.count) {{{ group.count }} · }{{ group.per }}</span>
                    @if (group.catalogueMixed || group.catalogue === null || group.perWarn) {
                      <span class="cps-row__text cps-row__phone" [class.cps-row__warn]="group.perWarn">{{ group.per }}@if (group.count) { · {{ group.count }} }</span>
                    } @else {
                      <span class="cps-row__phone cps-row__price">{{ group.catalogue | eur }} {{ group.slash }}</span>
                      @if (group.count) { <span class="cps-row__text cps-row__phone cps-row__sku">&nbsp;· {{ group.count }}</span> }
                    }
                  }
                  <!-- The count in the words: a title never shows on the phone. -->
                  @if (group.below) { <i class="cps-tag cps-tag--warn">{{ group.below }} onder kost</i> }
                </span>
                <span class="cps-row__cat">@if (!group.catalogueMixed) { {{ group.catalogue !== null ? (group.catalogue | eur) : 'op aanvraag' }} }</span>
                @if (customer()) {
                  <span class="cps-row__own">
                    @if (!group.ownMixed) {
                      @if (group.own; as own) { <b [class.is-off]="own.status !== 'ACTIVE'">{{ own.priceExclVat | eur }}</b> } @else { <b class="is-off">—</b> }
                    }
                  </span>
                }
                @if (group.units) {
                  <span class="cps-row__field" [class.is-bare]="group.bare" [class.is-mixed]="group.mixed">
                    @if (group.onRequest || group.unprintable) {
                      <span class="cps-row__request" [attr.title]="group.unprintable ? unprintableTitle : null">Op aanvraag</span>
                    } @else {
                      @if (!group.bare) { <i aria-hidden="true">€</i> }
                      <input class="input" appDecimal [placeholder]="group.placeholder" [attr.aria-label]="fieldWord() + ' voor ' + group.label"
                             [ngModel]="group.value" (ngModelChange)="setGroupPrice(group, $event)" />
                    }
                  </span>
                }
                <button class="cps-row__more" type="button" [attr.aria-label]="'Meer voor ' + group.label" (click)="openMenu($event, group.label, shownRows(), 'variant')">⋯</button>
              </li>
            } @else if (entry.group; as group) {
              <!-- The product above its colours: its price goes to every colour, also one a search hides. -->
              <li class="cps-row cps-row--head" [attr.data-key]="entry.key" [class.is-changed]="group.changed" [class.is-wrong]="!!group.message">
                <span class="cps-row__photo">@if (group.photo) {<img [appAuthSrc]="group.photo" appAuthLazy alt="" />}</span>
                <b class="cps-row__name"><span>{{ group.head }}</span>@if (group.tail) {<span class="cps-row__variant">{{ group.tail }}</span>}</b>
                <span class="cps-row__meta">
                  @if (group.message) {
                    <span class="cps-row__text cps-row__message">{{ group.message }}</span>
                  } @else {
                    <span class="cps-row__text cps-row__desk">{{ entry.count }} · {{ group.per }}</span>
                    <!-- Without one catalogue price there is no "€ x / stolp" to show: the count and the unit then. -->
                    @if (group.catalogueMixed || group.catalogue === null) {
                      <span class="cps-row__text cps-row__phone">{{ entry.count }} · {{ group.per }}</span>
                    } @else {
                      <span class="cps-row__phone cps-row__price">@if (group.catalogue !== null) {{{ group.catalogue | eur }} }{{ group.slash }}</span>
                      <span class="cps-row__text cps-row__phone cps-row__sku">&nbsp;· {{ entry.count }}</span>
                    }
                  }
                  @if (group.added) { <i class="cps-tag cps-tag--new" [attr.title]="newTitle()">nieuw</i> }
                </span>
                <span class="cps-row__cat">
                  @if (group.catalogueMixed) { <span class="cps-row__mixed">verschillend</span> }
                  @else { {{ group.catalogue !== null ? (group.catalogue | eur) : 'op aanvraag' }} }
                </span>
                @if (customer()) {
                  <span class="cps-row__own">
                    @if (group.ownMixed) {
                      <span class="cps-row__mixed">verschillend</span>
                    } @else if (group.own; as own) {
                      <b [class.is-off]="own.status !== 'ACTIVE'">{{ own.priceExclVat | eur }}</b>
                      @if (own.status !== 'ACTIVE') { <small [attr.title]="ownTitle(own)">{{ ownWord(own) }}</small> }
                    } @else { <b class="is-off">—</b> }
                  </span>
                }
                @if (!entry.narrowed) {
                  <span class="cps-row__field" [class.is-bare]="group.bare" [class.is-mixed]="group.mixed">
                    @if (group.onRequest || group.unprintable) {
                      <span class="cps-row__request" [attr.title]="group.unprintable ? unprintableTitle : null">Op aanvraag</span>
                    } @else {
                      @if (!group.bare) { <i aria-hidden="true">€</i> }
                      <input class="input" appDecimal [placeholder]="group.placeholder"
                             [attr.aria-label]="fieldWord() + ' voor alle ' + group.count + ', ' + group.label"
                             [ngModel]="group.value" (ngModelChange)="setGroupPrice(group, $event)" />
                    }
                  </span>
                  <button class="cps-row__more" type="button" [attr.aria-label]="'Meer voor alle ' + group.count + ', ' + group.label"
                          (click)="openMenu($event, group.label, group.rows, group.noun)">⋯</button>
                }
              </li>
            } @else if (entry.row; as row) {
            <li class="cps-row" [attr.data-key]="entry.key" [class.cps-row--colour]="entry.colour" [class.cps-row--compact]="entry.tint"
                [class.has-note]="!!row.message || row.unprintable || row.belowCost || entry.fresh || !!row.stored"
                [class.is-changed]="row.changed" [class.is-wrong]="!!row.message">
              <span class="cps-row__photo">@if (row.photo) {<img [appAuthSrc]="row.photo" appAuthLazy alt="" />}</span>
              <!-- The rows of one family differ only in colour and size: the name gives way, the variant never. -->
              <b class="cps-row__name" [class.is-tint]="entry.tint"><span>{{ entry.name }}</span>@if (entry.tail) {<span class="cps-row__variant">{{ entry.tail }}</span>}</b>
              <span class="cps-row__meta">
                @if (row.message) {
                  <span class="cps-row__text cps-row__message">{{ row.message }}</span>
                } @else {
                  <!-- Below its product the unit is the product's: the colour keeps only its SKU. -->
                  <span class="cps-row__text cps-row__desk">{{ row.sku }}@if (!entry.colour) { · {{ row.per }} }</span>
                  <!-- Phone: "€ 21,60 / display" stays whole (a ×6 mistake hides in the unit); the SKU gives way first. -->
                  <span class="cps-row__phone cps-row__price">@if (row.catalogue !== null) {{{ row.catalogue | eur }} }{{ row.slash }}</span>
                  <span class="cps-row__text cps-row__phone cps-row__sku">&nbsp;· {{ row.sku }}</span>
                }
                <!-- One chip, the most urgent; the phone has room for no more next to the price and its unit. -->
                @if (row.unprintable) {
                  <i class="cps-tag cps-tag--warn" [attr.title]="unprintableTitle">onvolledig</i>
                } @else if (row.belowCost) {
                  <i class="cps-tag cps-tag--warn" [attr.title]="'Kostprijs ' + (row.product.landedCostEur | eur)">onder kost</i>
                } @else if (entry.fresh) {
                  <i class="cps-tag cps-tag--new" [attr.title]="newTitle()">nieuw</i>
                } @else if (!row.message && row.stored; as own) {
                  <!-- A refusal says what to do; the stored price's chip would only squeeze it on the phone. -->
                  <i class="cps-tag cps-row__phone" [class.cps-tag--own]="own.status === 'ACTIVE'" [attr.title]="ownTitle(own)">{{ ownChip(own) }}</i>
                }
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
              <!-- No € before "Op aanvraag": the sign comes with a price, typed or as the placeholder. -->
              <span class="cps-row__field" [class.is-bare]="row.standard.eur === null && row.price?.priceEur == null">
                @if (row.onRequest || row.unprintable) {
                  <span class="cps-row__request" [attr.title]="row.unprintable ? unprintableTitle : null">Op aanvraag</span>
                } @else {
                  @if (row.standard.eur !== null || row.price?.priceEur != null) { <i aria-hidden="true">€</i> }
                  <input class="input" appDecimal [placeholder]="placeholder(row.standard)" [attr.aria-label]="fieldWord() + ', ' + row.label"
                         [ngModel]="row.price?.priceEur ?? null" (ngModelChange)="setPrice(row.product, $event)" />
                }
              </span>
              <button class="cps-row__more" type="button" [attr.aria-label]="'Meer voor ' + row.label" (click)="openMenu($event, row.label, [row])">⋯</button>
            </li>
            }
          } @empty {
            <li class="cps__empty">{{ emptyText() }}</li>
          }
        </ul>
        }
        <!-- Inside the sheet: its overlay is a stacking context, a desk popover outside it would open under the sheet. -->
        @if (menu(); as open) {
          <app-context-menu class="cps-menu" variant="ios" [title]="open.title" [items]="menuItems(open)" [anchor]="open.anchor"
                            (pick)="pick(open, $event)" (closed)="menu.set(null)" />
        }
      </div>
      <div foot class="cps-foot">
        @if (forCustomer()) {
          <!-- For every price typed here; empty keeps each stored end date (one already passed is cleared). -->
          <div class="cps-until">
            <label for="cps-until">Geldig tot <span class="opt"></span></label>
            <app-date-field fieldId="cps-until" [value]="ownUntil()" (valueChange)="ownUntil.set($event)" />
            @if (untilPast()) { <small id="cps-until-past" role="alert">Ligt in het verleden</small> }
          </div>
        } @else if (customer(); as who) {
          <label class="cps-keep">
            <input type="checkbox" [checked]="keep()" [disabled]="busy() || !keepable().length" (change)="keep.set($any($event.target).checked)" />
            <!-- What the box is for (Emre asked, 2026-11-07): the prices become the customer's own, beyond this PDF. -->
            <span class="cps-keep__text">
              <span>Ook bewaren als klantprijzen van {{ who.name }}</span>
              <small>Ook op offertes, facturen en de website</small>
            </span>
          </label>
        }
        <button class="btn cps-foot__cancel" type="button" [disabled]="busy()" (click)="requestClose()">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="busy() || blocked()" [attr.aria-describedby]="untilPast() ? 'cps-until-past' : null" (click)="apply()">
          {{ busy() ? 'Bewaren…' : (forCustomer() ? 'Bewaren (' : 'Toepassen (') + changeCount() + ')' }}
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
    .cps-copy { display: block; min-width: 0; }
    .cps-copy .select { min-height: 36px; max-width: 220px; padding-top: 4px; padding-bottom: 4px; border-radius: 10px; font-size: 13px; }
    .cps-rows { display: grid; margin: 0; padding: 0; list-style: none; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); }
    .cps-row { display: grid; align-items: center; column-gap: 10px; row-gap: 1px; min-width: 0; padding: 9px 12px; }
    .cps-row + .cps-row { border-top: 1px solid var(--line); }
    .cps-row__photo { grid-area: photo; display: grid; width: 40px; height: 44px; place-items: center; overflow: hidden; border-radius: 8px; background: #fff; box-shadow: inset 0 0 0 1px var(--line); }
    .cps-row__photo img { width: 100%; height: 100%; padding: 2px; box-sizing: border-box; object-fit: contain; }
    .cps-row__name { grid-area: name; display: flex; align-self: end; min-width: 0; color: var(--ink); font-size: 14px; font-weight: 650; line-height: 1.3; white-space: nowrap; }
    .cps-row__name > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .cps-row__name > .cps-row__variant { flex: none; max-width: 75%; color: var(--rose-dark); }
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
    .cps-row__field.is-bare .input { padding-left: 10px; }
    /* The row menu names the whole variant: a long title wraps instead of losing the colour and size. */
    :host ::ng-deep .cps-menu .cm__head { white-space: normal; overflow-wrap: anywhere; }
    .is-changed .cps-row__field .input { border-color: var(--rose); background: color-mix(in srgb, var(--rose-soft) 45%, var(--surface)); font-weight: 700; }
    .is-wrong .cps-row__field .input { border-color: var(--danger); }
    .cps-row__request { display: grid; min-height: 40px; place-items: center; border-radius: 10px; background: var(--surface-2); color: var(--ink-2); font-size: 12.5px; font-weight: 650; }
    .is-changed .cps-row__request { background: var(--rose-soft); color: var(--rose-dark); }
    .cps-row__more { grid-area: more; display: grid; width: 28px; height: 40px; place-items: center; padding: 0; border: 0; background: transparent; color: var(--muted); font-size: 18px; cursor: pointer; }
    .cps__empty { padding: 22px 16px; color: var(--muted); font-size: 13px; text-align: center; }
    /* The colours below their product: lighter lines, a smaller photo set in under the product's, the colour as the name. */
    .cps-row--colour { padding-top: 6px; padding-bottom: 6px; }
    .cps-row + .cps-row--colour { border-top-color: color-mix(in srgb, var(--line) 45%, transparent); }
    .cps-row--colour .cps-row__photo { justify-self: end; width: 30px; height: 32px; border-radius: 7px; }
    .cps-row__name.is-tint { color: var(--rose-dark); font-weight: 600; }
    .cps-row__mixed { color: var(--muted); font-size: 12px; font-weight: 600; }
    /* "Verschillend" whole in the desk's field; the phone's bare field sets its own size. */
    .cps-row__field.is-mixed .input::placeholder { font-size: 12px; }
    /* The found line: one price for all the search shows; tinted, a magnifier where a product has its photo. */
    .cps-row--found { background: color-mix(in srgb, var(--surface-2) 75%, var(--surface)); }
    .cps-row--found:first-child { border-radius: 13px 13px 0 0; }
    .cps-row__photo--find { background: transparent; box-shadow: none; }
    .cps-row__photo--find svg { width: 20px; height: 20px; fill: none; stroke: var(--muted); stroke-width: 1.8; }
    .cps-row__warn { color: var(--warn); font-weight: 650; }
    .cps-tag--new { background: var(--rose-soft); color: var(--rose-dark); }
    /* Not in the PDF yet: a quieter, dashed list; the whole line takes the product in. */
    .cps-more { display: grid; gap: 6px; min-width: 0; }
    .cps-more__head { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 32px; padding: 0 2px 0 14px; color: var(--muted); font-size: 10.5px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
    .cps-more__head .btn { letter-spacing: 0; text-transform: none; }
    .cps-rows--more { border-style: dashed; background: color-mix(in srgb, var(--surface-2) 35%, var(--surface)); }
    .cps-row--add { cursor: pointer; }
    .cps-row--add:first-child { border-top-left-radius: 13px; border-top-right-radius: 13px; }
    .cps-row--add:last-child { border-bottom-left-radius: 13px; border-bottom-right-radius: 13px; }
    .cps-row--add:active { background: color-mix(in srgb, var(--rose-soft) 45%, transparent); }
    .cps-row__take { width: 100%; min-height: 40px; padding: 0 10px; border: 1px solid var(--rose); border-radius: 99px; background: var(--surface); color: var(--rose-dark); font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
    @media (hover: hover) { .cps-row--add:hover { background: color-mix(in srgb, var(--rose-soft) 30%, transparent); } }
    .cps-head { display: none; }
    .cps-foot { display: contents; }
    .cps-until { display: flex; flex: 1 1 auto; flex-wrap: wrap; align-items: center; gap: 4px 10px; min-width: 0; margin-right: auto; color: var(--ink-2); font-size: 13px; font-weight: 600; }
    .cps-until app-date-field { width: 168px; }
    .cps-until small { color: var(--warn); font-size: 11.5px; font-weight: 650; }
    .cps-keep { display: flex; flex: 1 1 auto; align-items: center; gap: 9px; min-width: 0; margin-right: auto; color: var(--ink-2); font-size: 13px; font-weight: 600; cursor: pointer; }
    .cps-keep input { width: 18px; height: 18px; flex: none; margin: 0; accent-color: var(--rose); }
    .cps-keep__text { display: grid; gap: 1px; min-width: 0; }
    .cps-keep__text > span { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; }
    .cps-keep__text small { color: var(--muted); font-size: 11.5px; font-weight: 500; line-height: 1.35; }
    @media (min-width: 1024px), (min-width: 680px) and (hover: hover) {
      .cps-head, .cps-row { grid-template-columns: 44px minmax(0, 1fr) 92px 128px 28px; grid-template-areas: 'photo name cat field more' 'photo meta cat field more'; column-gap: 14px; }
      .cps--own .cps-head, .cps--own .cps-row { grid-template-columns: 44px minmax(0, 1fr) 92px 124px 128px 28px; grid-template-areas: 'photo name cat own field more' 'photo meta cat own field more'; }
      .cps-row { padding: 9px 14px; }
      .cps-row--colour { padding-top: 6px; padding-bottom: 6px; }
      .cps-row__photo { width: 44px; }
      .cps-row__phone { display: none; }
      .cps-head { display: grid; padding: 0 14px; color: var(--muted); font-size: 10.5px; font-weight: 750; letter-spacing: .06em; text-transform: uppercase; }
      .cps-head span { text-align: right; }
      .cps-head span:first-child { grid-column: 1 / 3; text-align: left; }
      .cps-head span:last-child { grid-column: -3 / -2; }
      .cps-keep { max-width: 440px; }
      .cps-until ~ .btn { align-self: center; }
    }
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px) {
      .cps { padding: 0 16px; }
      .cps__for { text-align: center; }
      /* The name has the first line to itself (the colour must never be cut), the field the second. */
      .cps-row { grid-template-columns: 36px minmax(0, 1fr) 64px 28px; grid-template-areas: 'photo name name more' 'photo meta field field'; column-gap: 8px; row-gap: 4px; padding: 9px 10px; }
      .cps-row__photo { width: 36px; height: 40px; }
      .cps-row__name { align-self: center; }
      .cps-row__meta { align-self: center; gap: 0; }
      .cps-row__price { flex: none; white-space: nowrap; }
      /* Only the room left: the price and the chip keep their width, the chip shrinks only once the SKU is gone. */
      .cps-row__sku { flex: 1 1 0; }
      .cps-row__meta .cps-tag { flex: 0 1 auto; min-width: 0; margin-left: 5px; padding: 1px 6px; overflow: hidden; text-overflow: ellipsis; }
      .cps-row__more { height: 36px; margin: -8px 0; }
      .cps-row__cat, .cps-row__own, .cps-row__desk { display: none; }
      .cps-row__field .input { min-height: 38px; font-size: 16px; }
      .cps-row__take { min-height: 38px; }
      /* A product's line may take two lines: the end of its name tells sizes and versions apart ("… 25 cm", "… NO GIFTBOX"). */
      .cps-row--head .cps-row__name, .cps-row--add .cps-row__name { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; white-space: normal; overflow-wrap: anywhere; }
      /* An iOS section header over the list it names. */
      .cps-more__head { padding: 0 2px 0 6px; font-size: 13px; font-weight: 650; letter-spacing: 0; text-transform: none; }
      /* "Op aanvraag" as small as the chip of the same name, so the narrow field shows it whole. */
      .cps-row__field.is-bare .input::placeholder { font-size: 12.5px; }
      .cps-row__request { min-height: 38px; }
      .cps-row--colour .cps-row__photo { width: 28px; height: 30px; }
      /* A colour named by its colour alone is one line, its name and its field (as wide as the product's, "Op aanvraag"
         fits); a second only for a chip or a message. Variants with names of their own keep the row's two lines and SKU. */
      .cps-row--compact { grid-template-columns: 36px minmax(0, 1fr) 100px 28px; grid-template-areas: 'photo name field more' 'photo meta field more'; row-gap: 2px; padding: 5px 10px; }
      .cps-row--compact:not(.has-note) { grid-template-areas: 'photo name field more'; }
      .cps-row--compact:not(.has-note) .cps-row__meta { display: none; }
      .cps-row--compact .cps-row__price, .cps-row--compact .cps-row__sku { display: none; }
      .cps-row--compact .cps-row__meta .cps-tag { margin-left: 0; }
      .cps-row--compact .cps-row__message + .cps-tag { margin-left: 5px; }
      :host ::ng-deep .cps-menu .sheet--ios .sheet__head h2 { white-space: normal; overflow-wrap: anywhere; text-wrap: balance; }
      .cps-foot { display: grid; width: 100%; gap: 10px; }
      .cps-foot__cancel { display: none; }
      .cps-keep { margin: 0; padding: 2px 4px; }
      .cps-until { margin: 0; padding: 2px 4px; }
      .cps-until app-date-field { flex: 1 1 160px; width: auto; }
    }
  `,
})
export class CatalogPriceSheet implements OnInit {
  protected readonly desktop = inject(DesktopViewport);
  private readonly ui = inject(Ui);
  private readonly api = inject(CustomerPriceApi);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly sales = inject(SalesApi);

  /** Every product of the catalogue, in the PDF's order: the search finds and takes in those the PDF does not have yet. */
  readonly catalogue = input.required<readonly Product[]>();
  /** The products in the PDF now. */
  readonly selected = input.required<ReadonlySet<number>>();
  /** The families of the catalogue: a product whose colours carry other names is called by its family. */
  readonly families = input<readonly ProductFamily[]>([]);
  /** The categories: "domes" finds every dome. */
  readonly categories = input<readonly Category[]>([]);
  /** "customer": the customer's Klantprijzen, stored at once with Bewaren; "pdf": the prices of one catalogue PDF. */
  readonly mode = input<'pdf' | 'customer'>('pdf');
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
  /** The products taken in here, on Toepassen and before the prices: the page adds them to the PDF. */
  readonly included = output<number[]>();
  readonly saved = output<CustomerPrice[]>();
  /** The server refused a kept price typed on a unit the product has since left: the page loads the products again. */
  readonly productsStale = output<void>();
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
  readonly menu = signal<PriceMenu | null>(null);
  /** Taken in here and not in the PDF yet: rows like the others, joining the PDF on Toepassen. */
  readonly added = signal<ReadonlySet<number>>(new Set());
  readonly forCustomer = computed(() => this.mode() === 'customer');
  /** The other customers whose prices can be taken over; null while they load. */
  readonly donors = signal<{ id: number; name: string }[] | null>(null);
  readonly donorsFailed = signal(false);
  readonly copying = signal(false);
  /** The customer's Geldig tot for every price typed here (customer mode). */
  readonly ownUntil = signal('');
  readonly untilPast = computed(() => this.forCustomer() && !!this.ownUntil() && this.ownUntil() < todayIso());
  readonly fieldWord = computed(() => (this.forCustomer() ? 'Nieuwe prijs' : 'Prijs in deze PDF'));
  readonly newTitle = computed(() => (this.forCustomer() ? 'Krijgt een klantprijs bij Bewaren als je een prijs ingeeft' : 'Komt in de PDF bij Toepassen'));
  /** One-off prices from an earlier PDF that taking a product in cleared: "Niet opnemen" gives them back. */
  private readonly setAside = new Map<number, CatalogPriceOverride>();
  /** When a "Niet in deze PDF" line last took a product in. */
  private takenAt = -Infinity;
  /**
   * The kept prices the server refused (409 CUSTOMER_PRICE_BASIS_CHANGED), with the unit each was typed on. They hold
   * only until the page's products arrive again (basisChanged() then names them); a price typed on the same unit
   * before that is refused here, not sent again.
   */
  private readonly refused = signal<{ products: readonly Product[]; basis: ReadonlyMap<number, PriceBasisNow> } | null>(null);

  /** The PDF's products with those taken in here, in the catalogue's order: the rows of the list. */
  readonly products = computed(() => {
    const selected = this.selected();
    const added = this.added();
    return this.catalogue().filter((product) => product.id !== null && (selected.has(product.id) || added.has(product.id)));
  });
  private readonly familyNames = computed(() => new Map(this.families().flatMap((family) =>
    family.id === null || !family.name?.trim() ? [] : [[family.id, family.name.trim()] as const])));
  /** What every product is found by, the same words as step 03's search. */
  private readonly searchTexts = computed(() => {
    const families = this.familyNames();
    const categories = new Map(this.categories().flatMap((category) => category.id === null ? [] : [[category.id, catalogCategorySearchName(category)] as const]));
    return new Map(this.catalogue().flatMap((product) => product.id === null ? [] : [[product.id, catalogSearchText(product,
      product.familyId === null ? null : families.get(product.familyId),
      product.categoryId === null ? null : categories.get(product.categoryId))] as const]));
  });
  readonly words = computed(() => catalogSearchWords(this.query()));
  /** A search or "Alleen aangepast" leaves rows out: the % tool says on how many it works. */
  readonly narrowed = computed(() => this.words().length > 0 || this.onlyChanged());

  /** What every row is worked out from. A refusal holds until the catalogue arrives again, whatever is taken in meanwhile. */
  private readonly rowContext = computed<RowContext>(() => {
    const refusal = this.refused();
    return {
      draft: this.draft(), applied: this.overrides(), stored: this.customerPrices(),
      issues: new Map(this.issues().map((issue) => [issue.productId, issue.message])),
      refusedBasis: refusal && refusal.products === this.catalogue() ? refusal.basis : null,
      added: this.added(), texts: this.searchTexts(), until: this.forCustomer() ? this.ownUntil() : '',
    };
  });

  readonly rows = computed<PriceRow[]>(() => {
    const context = this.rowContext();
    return this.products().flatMap((product) => product.id === null ? [] : [this.rowOf(product, context)]);
  });

  private rowOf(product: Product, context: RowContext): PriceRow {
    const { draft, applied, stored, issues, refusedBasis } = context;
    const id = product.id!;
    const unit = productSalesUnit(product);
    const own = stored.get(id) ?? null;
    const standard = standardPrice(product, own);
    const price = draft.get(id) ?? null;
    const problem = price && !price.onRequest ? priceProblem(price.priceEur) : null;
    const was = refusedBasis?.get(id);
    /* Typed on a unit the product has left: the row names the unit of now (once the page knows it) until typed again. */
    const moved = !!price && basisChanged(product, price);
    const stale = moved || (!!price && !!was && was.basis === price.basis && was.piecesPerUnit === (price.piecesPerUnit ?? null));
    const now = unit.isDisplay ? unit.piecesPerDisplay ? `per display van ${unit.piecesPerDisplay}` : 'per display' : unit.piece.per;
    /* The server's word stays on the row only while the row is as it was sent. */
    const rejected = issues.has(id) && sameOverride(price ?? undefined, applied.get(id)) ? issues.get(id)! : null;
    const shown = price?.onRequest ? null : price && price.priceEur !== null && !problem ? price.priceEur : standard.eur;
    const cost = product.landedCostEur;
    const photo = cataloguePhoto(product);
    const name = stripColour(product.name?.trim() ?? '', product.colour);
    /* "Rozenstolp S" and "Hartbox 28 cm" already name their size: not repeated, but kept whole with the variant. */
    const size = product.variantSize?.trim() || null;
    const named = !!size && name.endsWith(size);
    const variant = variantOf({ colour: product.colour, variantSize: named ? null : size });
    const split = named && name.endsWith(` ${size}`);
    return {
      id, product, name,
      label: variant ? `${name} · ${variant}` : name,
      head: split ? name.slice(0, -size!.length).trimEnd() : name,
      tail: split ? `\u00a0${size}${variant ? ` · ${variant}` : ''}` : variant ? `\u00a0· ${variant}` : null,
      sku: product.sku || 'Zonder SKU',
      per: unit.isDisplay ? 'per display' : unit.piece.per,
      slash: `/ ${unit.isDisplay ? 'display' : unit.piece.one}`,
      catalogue: cataloguePrice(product),
      stored: own && own.status !== 'PRODUCT_GONE' ? own : null,
      standard, price,
      /* For the customer every typed price counts where none applies yet, also one equal to the catalogue price: it
         pins the price for them. With a price of their own: another amount or unit, or the same with a new Geldig tot. */
      changed: !!price && (!this.forCustomer() ? changesPrint(product, price, standard)
        : !price.onRequest && price.priceEur !== null && (own?.status !== 'ACTIVE' || price.priceEur !== own.priceExclVat
          || basisChanged(product, price) || (!!context.until && context.until !== (own.validUntil ?? '')))),
      onRequest: !!price?.onRequest,
      /* Printing is the PDF's concern: a customer's price for a display without its piece count still goes on offers. */
      unprintable: !this.forCustomer() && !pricePrintable(product),
      message: problem ?? (moved ? `Nu ${now} · vul opnieuw in` : stale ? STALE : rejected),
      belowCost: shown !== null && cost !== null && cost > 0 && shown < cost,
      photo: photo?.smallUrl || photo?.url || null,
      added: context.added.has(id),
      search: context.texts.get(id) ?? '',
    };
  }

  /**
   * Rows by product (family, size and sales unit), at the place of the product's first colour. `beside`: products
   * that count for the sizes too (the PDF's, next to the lines outside it), so a size that tells two lines apart shows.
   */
  private groupRows(rows: readonly PriceRow[], beside: readonly Product[] = []): PriceGroup[] {
    const families = this.familyNames();
    const members = new Map<string, PriceRow[]>();
    const sizes = new Map<number, Set<string>>();
    for (const row of rows) {
      const key = groupKey(row.product);
      const list = members.get(key);
      if (list) list.push(row);
      else members.set(key, [row]);
    }
    for (const product of [...rows.map((row) => row.product), ...beside]) {
      if (product.familyId === null) continue;
      const seen = sizes.get(product.familyId) ?? new Set<string>();
      seen.add(product.variantSize?.trim().toLocaleLowerCase('nl-BE') ?? '');
      sizes.set(product.familyId, seen);
    }
    return [...members].map(([key, list]) => priceGroup(key, list, families,
      list[0].product.familyId !== null && (sizes.get(list[0].product.familyId)?.size ?? 0) > 1));
  }

  /** The rows by product; a product of one colour stays a row. */
  readonly groups = computed<PriceGroup[]>(() => this.groupRows(this.rows()));
  /** The list as the search and "Alleen aangepast" show it. */
  private readonly listed = computed<PriceEntry[]>(() => {
    const words = this.words();
    const only = this.onlyChanged();
    /* Taken in counts as a change: it never hides behind the chip. */
    const shown = (row: PriceRow): boolean => !only || row.changed || row.added || !!row.message;
    const found = (row: PriceRow): boolean => !words.length || catalogSearchMatch(row.search, words);
    return this.groups().flatMap((group): PriceEntry[] => {
      if (group.rows.length === 1) {
        const row = group.rows[0];
        return shown(row) && found(row)
          ? [{ key: `r${row.id}`, group: null, row, count: '', narrowed: false, name: row.head, tail: row.tail, colour: false, tint: false, fresh: row.added }]
          : [];
      }
      /* A search for the product keeps all its colours; one for a colour or a SKU shows the colours it finds. */
      const named = words.length > 0 && catalogSearchMatch(catalogSearchKey(group.label), words);
      const rows = group.rows.filter((row) => shown(row) && (named || found(row)));
      if (!rows.length) return [];
      const narrowed = rows.length < group.rows.length;
      return [
        { key: `g${group.key}`, group, row: null, count: narrowed ? `${rows.length} van ${group.count}` : group.count, narrowed,
          name: '', tail: null, colour: false, tint: false, fresh: false },
        ...rows.map((row): PriceEntry => ({
          key: `r${row.id}`, group: null, row, count: '', narrowed: false,
          name: group.byColour ? row.product.colour!.trim() : row.head,
          tail: group.byColour ? null : row.tail,
          colour: true, tint: group.byColour, fresh: row.added && !group.added,
        })),
      ];
    });
  });
  /** The rows on screen, each once: what the found line and the % tool work on. */
  readonly shownRows = computed(() => this.listed().flatMap((entry) => (entry.row ? [entry.row] : [])));
  /**
   * The list, led by "Alle n gevonden" while a search shows rows of more than
   * one product (or part of one): never with "Alleen aangepast", where rows
   * would come and go under the fingers while typing.
   */
  readonly entries = computed<PriceEntry[]>(() => {
    const listed = this.listed();
    if (!this.words().length || this.onlyChanged()) return listed;
    const rows = this.shownRows();
    if (rows.length < 2) return listed;
    const products = new Set(rows.map((row) => groupKey(row.product))).size;
    const heads = listed.filter((entry) => entry.group);
    /* One whole product: its own line already takes one price for all. */
    if (products === 1 && heads.length === 1 && !heads[0].narrowed) return listed;
    return [{ key: 'found', group: foundGroup(rows, products), row: null, count: '', narrowed: false,
      name: '', tail: null, colour: false, tint: false, fresh: false }, ...listed];
  });
  /** Found products the PDF does not have, by product like the list, built from the matching colours only. */
  readonly outside = computed<OutsideLine[]>(() => {
    const words = this.words();
    if (!words.length) return [];
    const context = this.rowContext();
    const inside = new Set(this.products().map((product) => product.id));
    const rows = this.catalogue().flatMap((product) => product.id === null || inside.has(product.id)
      || !catalogSearchMatch(context.texts.get(product.id) ?? '', words) ? [] : [this.rowOf(product, context)]);
    return this.groupRows(rows, this.products()).map((group): OutsideLine => {
      if (group.rows.length > 1) {
        return {
          key: `o${group.key}`, rows: group.rows, photo: group.photo, head: group.head, tail: group.tail, label: group.label,
          desk: `${group.count} · ${group.per}`, phone: group.count, per: group.per, slash: group.slash,
          catalogue: group.catalogue, catalogueMixed: group.catalogueMixed, own: group.own, ownMixed: group.ownMixed,
        };
      }
      const row = group.rows[0];
      return {
        key: `o${row.id}`, rows: [row], photo: row.photo, head: row.head, tail: row.tail, label: row.label,
        desk: `${row.sku} · ${row.per}`, phone: row.sku, per: row.per, slash: row.slash,
        catalogue: row.catalogue, catalogueMixed: false, own: row.stored, ownMixed: false,
      };
    });
  });
  readonly outsideCount = computed(() => this.outside().reduce((sum, line) => sum + line.rows.length, 0));
  readonly emptyText = computed(() => this.words().length ? 'Geen producten gevonden.'
    : this.onlyChanged() ? 'Nog geen aangepaste prijzen.'
      : this.products().length ? 'Geen producten gevonden.' : 'Zoek een product om op te nemen, of neem de prijzen van een klant over.');
  /** What Toepassen changes in the PDF: a new price, or a product taken in (once, also when it has a price). */
  readonly changeCount = computed(() => (this.forCustomer() ? this.keepable().length
    : this.rows().filter((row) => (row.changed && !row.message) || row.added).length));
  /** A typed price that cannot go, or one on a unit the product is no longer sold in: fix it first. */
  readonly blocked = computed(() => this.untilPast() || this.rows().some((row) => !!row.price && !!row.message && row.message !== this.refusalOf(row)));
  /** The typed prices that can become the customer's own; "Op aanvraag" is for this PDF only. */
  readonly keepable = computed(() => this.rows().filter((row) => row.changed && !row.message && !row.onRequest && row.price?.priceEur != null));
  private readonly dirty = computed(() => {
    const draft = this.draft();
    const applied = this.overrides();
    /* For the customer only typed prices are at stake; a product taken in without one stores nothing. */
    if (this.forCustomer()) return draft.size > 0;
    return this.added().size > 0 || draft.size !== applied.size || [...draft].some(([id, price]) => !sameOverride(price, applied.get(id)));
  });

  ngOnInit(): void {
    /* Opened from the server's refusal: the rows it names come first. */
    if (this.issues().length) this.onlyChanged.set(true);
    void this.loadDonors();
  }

  private async loadDonors(): Promise<void> {
    try {
      const own = this.customer()?.id ?? null;
      const customers = await this.sales.customers();
      this.donors.set(customers
        .flatMap((customer) => customer.id === null || customer.id === own ? [] : [{ id: customer.id, name: customer.company?.trim() || `Klant #${customer.id}` }])
        .sort((left, right) => left.name.localeCompare(right.name, 'nl-BE')));
    } catch {
      this.donorsFailed.set(true);
    }
  }

  /** The select's choice; it goes back to its prompt right away, so the same customer can be chosen again. */
  copyFrom(select: HTMLSelectElement): void {
    const id = Number(select.value);
    select.value = '';
    const donor = this.donors()?.find((candidate) => candidate.id === id);
    if (donor) void this.copy(donor);
  }

  /**
   * Another customer's active prices as typed prices here, on each product's
   * unit of now (an active price is on it); products not listed yet are taken
   * in. Expired prices, prices on a unit the product has left and products
   * outside the catalogue stay out. The list then shows what changed, to look
   * over before Toepassen or Bewaren; nothing is stored before that.
   */
  private async copy(donor: { id: number; name: string }): Promise<void> {
    if (this.copying()) return;
    this.copying.set(true);
    try {
      const prices = await this.api.list(donor.id);
      const products = new Map(this.catalogue().flatMap((product) => product.id === null ? [] : [[product.id, product] as const]));
      const usable = prices.filter((price) => price.status === 'ACTIVE' && products.has(price.productId));
      const skipped = prices.length - usable.length;
      if (!usable.length) {
        this.ui.toast(prices.length ? `Geen bruikbare prijzen bij ${donor.name} (verlopen of andere eenheid)` : `${donor.name} heeft geen klantprijzen`, 'err');
        return;
      }
      const selected = this.selected();
      const draft = new Map(this.draft());
      const take: number[] = [];
      for (const price of usable) {
        draft.set(price.productId, oneOffPrice(products.get(price.productId)!, price.priceExclVat));
        if (!selected.has(price.productId)) take.push(price.productId);
      }
      if (take.length) this.added.update((current) => new Set([...current, ...take]));
      this.draft.set(draft);
      this.query.set('');
      this.onlyChanged.set(true);
      const count = `${usable.length} ${usable.length === 1 ? 'prijs' : 'prijzen'} van ${donor.name} overgenomen`;
      this.ui.toast(skipped ? `${count} · ${skipped} overgeslagen` : count);
    } catch (failure) {
      this.ui.toast(messageOf(failure, `De prijzen van ${donor.name} konden niet geladen worden.`), 'err');
    } finally {
      this.copying.set(false);
    }
  }

  placeholder(standard: StandardPrice): string {
    return pricePlaceholder(standard.eur);
  }

  readonly unprintableTitle = UNPRINTABLE;

  ownWord(own: CustomerPrice): string {
    return OWN_STATE[own.status] ?? '';
  }

  ownChip(own: CustomerPrice): string {
    return OWN_CHIP[own.status] ?? '';
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

  /** The product's field: one price on every colour, or every colour back to its standard when emptied. */
  setGroupPrice(group: PriceGroup, value: number | null): void {
    /* A field that showed no shared price, only its placeholder, has nothing to empty: a stray space or letter there
       (Enter in the search jumps into it) must not wipe the prices typed per row. */
    if (value === null && group.value === null) return;
    this.draft.update((draft) => {
      const next = new Map(draft);
      for (const row of group.rows) {
        if (value === null) next.delete(row.id);
        else next.set(row.id, oneOffPrice(row.product, value));
      }
      return next;
    });
  }

  resetAll(): void {
    this.draft.set(new Map());
  }

  /** Every price on screen that has one, from what it would print without a change (never compounding): whole cents, half up. */
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
    for (const row of this.shownRows()) {
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

  /**
   * Takes these products in: rows like the others from now on, in the PDF on
   * Toepassen. A price left from an earlier PDF does not come back with them;
   * they start from what they print now. The desk then types straight into
   * the price for all of them.
   */
  include(rows: readonly PriceRow[]): void {
    const selected = this.selected();
    const ids = rows.map((row) => row.id).filter((id) => !selected.has(id));
    if (!ids.length) return;
    this.added.update((current) => new Set([...current, ...ids]));
    const draft = this.draft();
    const left = ids.filter((id) => draft.has(id));
    if (left.length) {
      const next = new Map(draft);
      for (const id of left) {
        this.setAside.set(id, draft.get(id)!);
        next.delete(id);
      }
      this.draft.set(next);
    }
    afterNextRender(() => {
      const host = this.host.nativeElement;
      if (this.outside().length) {
        /* More to take in: the list stays still, so the next line stays under the finger; the desk keyboard goes on to it. */
        if (this.desktop.active()) host.querySelector<HTMLElement>('.cps-row--add .cps-row__take')?.focus({ preventScroll: true });
        return;
      }
      const entries = this.entries();
      const target = entries.find((entry) => entry.group?.found)
        ?? entries.find((entry) => !!entry.group && !entry.narrowed && entry.group.rows.some((row) => ids.includes(row.id)))
        ?? entries.find((entry) => !!entry.row && ids.includes(entry.row.id));
      if (!target) return;
      const line = host.querySelector<HTMLElement>(`[data-key="${CSS.escape(target.key)}"]`);
      line?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      /* A focus without a tap opens no keyboard on the phone; there the line only comes into view. Without a price field
         ("Eenheden verschillen", "Op aanvraag") the desk focus goes to the line's ⋯, never to nowhere. */
      if (this.desktop.active()) line?.querySelector<HTMLElement>('.cps-row__field input, .cps-row__more')?.focus({ preventScroll: true });
    }, { injector: this.injector });
  }

  /**
   * A press on a "Niet in deze PDF" line. The line leaves at once and the next one slides up under the pointer, so a
   * repeat (the second click of a double click, a quick second tap) is not a second product taken in.
   */
  takeIn(event: MouseEvent, rows: readonly PriceRow[]): void {
    if (event.detail > 1 || event.timeStamp - this.takenAt < 500) return;
    this.takenAt = event.timeStamp;
    this.include(rows);
  }

  includeAll(): void {
    this.include(this.outside().flatMap((line) => line.rows));
  }

  /**
   * Enter in the search: on the desk to the price for everything found, else the first price on the list (with none,
   * the caret stays); the phone's Zoek key only puts the keyboard away, it never opens the number pad by itself.
   */
  jumpToPrice(event: Event): void {
    event.preventDefault();
    if (!this.desktop.active()) {
      (event.target as HTMLElement | null)?.blur();
      return;
    }
    const host = this.host.nativeElement;
    (host.querySelector<HTMLInputElement>('.cps-row--found .cps-row__field input')
      ?? host.querySelector<HTMLInputElement>('.cps-rows:not(.cps-rows--more) .cps-row__field input'))?.focus();
  }

  /** One row's menu, or a product's (noun "kleur"): then every choice is for all its colours. */
  openMenu(event: MouseEvent, title: string, rows: readonly PriceRow[], noun: string | null = null): void {
    const rect = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect();
    this.menu.set({
      title, ids: rows.map((row) => row.id), noun,
      anchor: rect ? { x: rect.left, y: rect.bottom + 4 } : { x: event.clientX, y: event.clientY },
    });
  }

  menuItems(open: PriceMenu): ContextMenuItem[] {
    const all = this.menuRows(open);
    /* The found line's menu holds displays without a piece count too: they leave with "Niet opnemen", the price
       choices are for the others (a product's colours share one unit, so there all or none print). */
    const printable = all.filter((row) => !row.unprintable);
    const rows = printable.length ? printable : all;
    const first = rows[0];
    if (!first) return [];
    const same = rows.every((row) => row.standard.eur === first.standard.eur && row.standard.source === first.standard.source);
    const standard = !same ? `Verschilt per ${open.noun ?? 'kleur'}` : first.standard.eur === null ? 'Prijs op aanvraag'
      : `${this.placeholder(first.standard)} · ${first.standard.source === 'CUSTOMER' ? 'klantprijs' : 'catalogusprijs'}`;
    /* A customer's price is a price: "Op aanvraag" is for one PDF only, and undoing a typed price leaves what is stored. */
    if (this.forCustomer()) {
      return [
        { id: 'standard', label: 'Ongedaan maken', hint: standard, disabled: !rows.some((row) => !!row.price) },
        ...(all.some((row) => row.added) ? [{ id: 'drop', label: 'Niet opnemen', hint: 'Geen klantprijs', divider: true }] : []),
      ];
    }
    return [
      rows.every((row) => row.unprintable)
        ? { id: 'request', label: 'Op aanvraag', hint: 'Display zonder aantal stuks', checked: true, disabled: true }
        : { id: 'request', label: 'Op aanvraag', hint: open.noun ? `Geen prijs in deze PDF, voor elke ${open.noun}` : 'Geen prijs in deze PDF',
            checked: rows.every((row) => row.onRequest) },
      { id: 'standard', label: 'Terug naar standaard', hint: standard, disabled: !rows.some((row) => !!row.price), divider: true },
      ...(all.some((row) => row.added) ? [{ id: 'drop', label: 'Niet opnemen', hint: 'Toch niet in deze PDF', divider: true }] : []),
    ];
  }

  pick(open: PriceMenu, item: ContextMenuItem): void {
    this.menu.set(null);
    const all = this.menuRows(open);
    if (item.id === 'drop') {
      /* Only what was taken in here; a product already in the PDF leaves it in step 03. A one-off price that taking it
         in set aside comes back while the page still holds it, so taking in and leaving again changes nothing. */
      const ids = new Set(all.filter((row) => row.added).map((row) => row.id));
      this.added.update((current) => new Set([...current].filter((id) => !ids.has(id))));
      const applied = this.overrides();
      const next = new Map([...this.draft()].filter(([id]) => !ids.has(id)));
      for (const id of ids) {
        const left = this.setAside.get(id);
        if (left && sameOverride(left, applied.get(id))) next.set(id, left);
        this.setAside.delete(id);
      }
      this.draft.set(next);
      return;
    }
    const printable = all.filter((row) => !row.unprintable);
    const rows = printable.length ? printable : all;
    const request = rows.every((row) => row.onRequest);
    const next = new Map(this.draft());
    for (const row of rows) {
      if (item.id === 'standard' || (item.id === 'request' && request)) next.delete(row.id);
      else if (item.id === 'request') next.set(row.id, oneOffPrice(row.product, null, true));
    }
    this.draft.set(next);
  }

  /** The menu's rows as they are now, not as they were when it opened. */
  private menuRows(open: PriceMenu): PriceRow[] {
    const ids = new Set(open.ids);
    return this.rows().filter((row) => ids.has(row.id));
  }

  async apply(): Promise<void> {
    if (this.busy() || this.blocked()) return;
    const customer = this.customer();
    if (this.forCustomer()) {
      const keep = this.keepable();
      if (!keep.length && this.ownUntil()) {
        this.ui.toast('Geldig tot gaat mee met de prijzen die je hier ingeeft: geef eerst een prijs in', 'err');
        return;
      }
      if (customer && keep.length) {
        const saved = await this.store(customer.id, keep, 'CUSTOMER_SCREEN', this.ownUntil());
        if (!saved) return;
        this.saved.emit(saved);
        this.ui.toast(`${keep.length} ${keep.length === 1 ? 'klantprijs' : 'klantprijzen'} bewaard`);
      }
      this.closed.emit();
      return;
    }
    const keep = customer && this.keep() ? this.keepable() : [];
    let kept = 0;
    if (customer && keep.length) {
      const saved = await this.store(customer.id, keep, 'CATALOG_EXPORT', this.validUntil());
      if (!saved) return;
      this.saved.emit(saved);
      kept = keep.length;
    }
    /* Taken in and still in the catalogue (a reload can drop one meanwhile); they join the PDF before the prices apply. */
    const known = new Set(this.catalogue().map((product) => product.id));
    const selected = this.selected();
    const fresh = [...this.added()].filter((id) => known.has(id) && !selected.has(id));
    const told = [
      ...(kept ? [`${kept} ${kept === 1 ? 'prijs' : 'prijzen'} bewaard voor ${customer!.name}`] : []),
      ...(fresh.length ? [`+${fresh.length} ${fresh.length === 1 ? 'variant' : 'varianten'} in de PDF`] : []),
    ];
    if (told.length) this.ui.toast(told.join(' · '));
    if (fresh.length) this.included.emit(fresh);
    this.applied.emit(new Map(this.draft()));
  }

  /**
   * PUTs these typed prices as the customer's own, each on the unit it was typed on. `until` goes along unless it lies
   * in the past; without one, a stored end date that is still ahead stays (the server keeps a field the change leaves
   * out) and one that already passed is cleared, so the price applies again; the stored note always stays. Null when
   * nothing was stored: a unit changed since (409) marks the rows it names and has the page load the products again.
   */
  private async store(customerId: number, keep: readonly PriceRow[], source: 'CATALOG_EXPORT' | 'CUSTOMER_SCREEN', until: string): Promise<CustomerPrice[] | null> {
    const today = todayIso();
    const date = until && until >= today ? until : null;
    const ended = (row: PriceRow): boolean => !!row.stored?.validUntil && row.stored.validUntil < today;
    this.busy.set(true);
    try {
      return await this.api.save(customerId, {
        source,
        changes: keep.map((row) => ({
          productId: row.id, priceExclVat: row.price!.priceEur,
          /* The unit the row named when the price was typed: the server refuses it once the product has left it. */
          basis: row.price!.basis, piecesPerUnit: row.price!.piecesPerUnit ?? null,
          ...(date ? { validUntil: date } : ended(row) ? { validUntil: null } : {}),
        })),
      });
    } catch (failure) {
      const stale = priceBasisRefusal(failure);
      if (stale) {
        /* Nothing was stored. The rows it names ask to be typed again, the page loads the products with their unit
           of now, and the sheet stays open with every typed price. */
        const named = new Set(stale.productIds);
        this.refused.set({
          products: this.catalogue(),
          basis: new Map(keep.filter((row) => !named.size || named.has(row.id))
            .map((row) => [row.id, { basis: row.price!.basis, piecesPerUnit: row.price!.piecesPerUnit ?? null }])),
        });
        this.productsStale.emit();
        this.ui.toast('Niets bewaard: de prijsbasis is gewijzigd', 'err');
        setTimeout(() => this.host.nativeElement.querySelector('.cps-row.is-wrong')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60);
        return null;
      }
      this.ui.toast(messageOf(failure, 'De klantprijzen zijn niet bewaard. Probeer opnieuw.'), 'err');
      return null;
    } finally {
      this.busy.set(false);
    }
  }

  requestClose(): void {
    if (this.busy()) return;
    if (!this.dirty()) {
      this.closed.emit();
      return;
    }
    /* Products taken in are more than prices: the question names both. */
    const customer = this.forCustomer();
    const title = customer ? 'Prijzen niet bewaren?' : this.added().size ? 'Wijzigingen niet toepassen?' : 'Prijzen niet toepassen?';
    this.ui.confirm({ title, message: 'Wat je hier aanpaste, gaat verloren.', confirmLabel: customer ? 'Niet bewaren' : 'Niet toepassen', danger: true },
      () => this.closed.emit());
  }

  private refusalOf(row: PriceRow): string | null {
    const issue = this.issues().find((candidate) => candidate.productId === row.id);
    return issue && sameOverride(row.price ?? undefined, this.overrides().get(row.id)) ? issue.message : null;
  }
}
