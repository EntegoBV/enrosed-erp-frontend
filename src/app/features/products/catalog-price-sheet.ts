import { ChangeDetectionStrategy, Component, ElementRef, type OnInit, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthImage } from '../../core/api/auth-image';
import type { CatalogPriceIssue, CatalogPriceOverride } from '../../core/api/catalog-api';
import { CustomerPriceApi, priceBasisRefusal, type CustomerPrice } from '../../core/api/customer-price-api';
import { messageOf } from '../../core/api/errors';
import type { Product, ProductFamily } from '../../core/api/models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { ContextMenu, type ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { DecimalInput } from '../../shared/decimal-input';
import { EurPipe } from '../../shared/pipes';
import { Sheet, Ui } from '../../shared/ui';
import { stripColour, variantOf } from '../purchasing/purchase-desk-format';
import {
  basisChanged, cataloguePrice, changesPrint, oneOffPrice, percentPrice, priceBasis, priceProblem, pricePrintable, standardPrice, todayIso,
  type PriceBasisNow, type StandardPrice,
} from './catalog-prices';
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
  const unit = priceBasis(product);
  const size = product.variantSize?.trim().toLocaleLowerCase('nl-BE') ?? '';
  return `f${product.familyId}|${size}|${unit.basis}|${unit.piecesPerUnit ?? ''}`;
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
}

/**
 * `sizes`: the family is in the list in more than one size. Only then does
 * the product's line show its size, kept whole like a colour on a row (the
 * name gives way): one size is a fact of the product, not what tells it apart.
 */
function priceGroup(key: string, rows: PriceRow[], families: ReadonlyMap<number, string>, sizes: boolean): PriceGroup {
  const first = rows[0];
  const shared = rows.every((row) => row.name === first.name);
  const name = shared ? first.name : (first.product.familyId !== null ? families.get(first.product.familyId) : null) || first.name;
  /* "Rozenstolp 30 cm" already names its size. */
  const size = first.product.variantSize?.trim() || null;
  const named = !!size && name.endsWith(size);
  const split = sizes && named && name.endsWith(` ${size}`);
  const colours = rows.map((row) => row.product.colour?.trim().toLocaleLowerCase('nl-BE') ?? '');
  const byColour = shared && colours.every(Boolean) && new Set(colours).size === rows.length;
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
    noun: byColour ? 'kleur' : 'variant',
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
      : priceProblem(value) ?? (refused && (rows.every((row) => row.message === refused) ? refused : 'Nakijken per kleur')),
  };
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
}

interface PriceMenu {
  title: string;
  ids: readonly number[];
  /** "kleur" when the menu is a product's, for all its colours; null for one row. */
  noun: string | null;
  anchor: MenuPoint;
}

/**
 * Prijzen aanpassen: the price of every selected product in this one PDF.
 * A row shows what the PDF prints without a change (the field's placeholder:
 * the customer's price while it applies, else the catalogue price) and takes
 * a one-off price, "Op aanvraag" from its menu, or a percentage on all of
 * them. The colours of one product stand below it (Emre, 2026-11-07): the
 * product's field types its price on every colour, a colour's own field
 * changes only that colour. Nothing changes until Toepassen; with a customer,
 * "Ook bewaren als klantprijzen van …" also stores the typed prices as that
 * customer's own (PUT /api/customers/{id}/prices, source CATALOG_EXPORT),
 * with the PDF's validity date and the unit each was typed on: one the
 * product has left since is refused (nothing stored) and asks to be typed
 * again. "onder kost" compares with the landed cost and stops nothing.
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
          @for (entry of entries(); track entry.key) {
            @if (entry.group; as group) {
              <!-- The product above its colours: its price goes to every colour, also one a search hides. -->
              <li class="cps-row cps-row--head" [class.is-changed]="group.changed" [class.is-wrong]="!!group.message">
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
                             [attr.aria-label]="'Prijs in deze PDF voor alle ' + group.count + ', ' + group.label"
                             [ngModel]="group.value" (ngModelChange)="setGroupPrice(group, $event)" />
                    }
                  </span>
                  <button class="cps-row__more" type="button" [attr.aria-label]="'Meer voor alle ' + group.count + ', ' + group.label"
                          (click)="openMenu($event, group.label, group.rows, group.noun)">⋯</button>
                }
              </li>
            } @else if (entry.row; as row) {
            <li class="cps-row" [class.cps-row--colour]="entry.colour" [class.cps-row--compact]="entry.tint" [class.has-note]="!!row.message || row.unprintable || row.belowCost || !!row.stored"
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
                  <input class="input" appDecimal [placeholder]="placeholder(row.standard)" [attr.aria-label]="'Prijs in deze PDF, ' + row.label"
                         [ngModel]="row.price?.priceEur ?? null" (ngModelChange)="setPrice(row.product, $event)" />
                }
              </span>
              <button class="cps-row__more" type="button" [attr.aria-label]="'Meer voor ' + row.label" (click)="openMenu($event, row.label, [row])">⋯</button>
            </li>
            }
          } @empty {
            <li class="cps__empty">{{ onlyChanged() && !query().trim() ? 'Nog geen aangepaste prijzen.' : 'Geen producten gevonden.' }}</li>
          }
        </ul>
        <!-- Inside the sheet: its overlay is a stacking context, a desk popover outside it would open under the sheet. -->
        @if (menu(); as open) {
          <app-context-menu class="cps-menu" variant="ios" [title]="open.title" [items]="menuItems(open)" [anchor]="open.anchor"
                            (pick)="pick(open, $event)" (closed)="menu.set(null)" />
        }
      </div>
      <div foot class="cps-foot">
        @if (customer(); as who) {
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
    .cps-head { display: none; }
    .cps-foot { display: contents; }
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
    }
  `,
})
export class CatalogPriceSheet implements OnInit {
  protected readonly desktop = inject(DesktopViewport);
  private readonly ui = inject(Ui);
  private readonly api = inject(CustomerPriceApi);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The selected products, in the catalogue's order. */
  readonly products = input.required<readonly Product[]>();
  /** The families of the catalogue: a product whose colours carry other names is called by its family. */
  readonly families = input<readonly ProductFamily[]>([]);
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
  /**
   * The kept prices the server refused (409 CUSTOMER_PRICE_BASIS_CHANGED), with the unit each was typed on. They hold
   * only until the page's products arrive again (basisChanged() then names them); a price typed on the same unit
   * before that is refused here, not sent again.
   */
  private readonly refused = signal<{ products: readonly Product[]; basis: ReadonlyMap<number, PriceBasisNow> } | null>(null);

  readonly rows = computed<PriceRow[]>(() => {
    const draft = this.draft();
    const applied = this.overrides();
    const stored = this.customerPrices();
    const issues = new Map(this.issues().map((issue) => [issue.productId, issue.message]));
    const refusal = this.refused();
    const refusedBasis = refusal && refusal.products === this.products() ? refusal.basis : null;
    return this.products().flatMap((product) => {
      if (product.id === null) return [];
      const id = product.id;
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
      return [{
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
        changed: !!price && changesPrint(product, price, standard),
        onRequest: !!price?.onRequest,
        unprintable: !pricePrintable(product),
        message: problem ?? (moved ? `Nu ${now} · vul opnieuw in` : stale ? STALE : rejected),
        belowCost: shown !== null && cost !== null && cost > 0 && shown < cost,
        photo: photo?.smallUrl || photo?.url || null,
      }];
    });
  });
  /** The rows by product, at the place of the product's first colour; a product of one colour stays a row. */
  readonly groups = computed<PriceGroup[]>(() => {
    const families = new Map(this.families().flatMap((family) => family.id === null || !family.name?.trim() ? [] : [[family.id, family.name.trim()] as const]));
    const members = new Map<string, PriceRow[]>();
    const sizes = new Map<number, Set<string>>();
    for (const row of this.rows()) {
      const key = groupKey(row.product);
      const list = members.get(key);
      if (list) list.push(row);
      else members.set(key, [row]);
      const family = row.product.familyId;
      if (family === null) continue;
      const seen = sizes.get(family) ?? new Set<string>();
      seen.add(row.product.variantSize?.trim().toLocaleLowerCase('nl-BE') ?? '');
      sizes.set(family, seen);
    }
    return [...members].map(([key, rows]) => priceGroup(key, rows, families,
      rows[0].product.familyId !== null && (sizes.get(rows[0].product.familyId)?.size ?? 0) > 1));
  });
  readonly entries = computed<PriceEntry[]>(() => {
    const needle = this.query().trim().toLocaleLowerCase('nl-BE');
    const only = this.onlyChanged();
    const shown = (row: PriceRow): boolean => !only || row.changed || !!row.message;
    const found = (row: PriceRow): boolean => !needle
      || [row.product.name, row.sku, row.product.colour, row.product.variantSize, row.product.canonicalBarcode]
        .filter(Boolean).join(' ').toLocaleLowerCase('nl-BE').includes(needle);
    return this.groups().flatMap((group): PriceEntry[] => {
      if (group.rows.length === 1) {
        const row = group.rows[0];
        return shown(row) && found(row)
          ? [{ key: `r${row.id}`, group: null, row, count: '', narrowed: false, name: row.head, tail: row.tail, colour: false, tint: false }] : [];
      }
      /* A search for the product keeps all its colours; one for a colour or a SKU shows the colours it finds. */
      const named = !!needle && group.label.toLocaleLowerCase('nl-BE').includes(needle);
      const rows = group.rows.filter((row) => shown(row) && (named || found(row)));
      if (!rows.length) return [];
      const narrowed = rows.length < group.rows.length;
      return [
        { key: `g${group.key}`, group, row: null, count: narrowed ? `${rows.length} van ${group.count}` : group.count, narrowed,
          name: '', tail: null, colour: false, tint: false },
        ...rows.map((row): PriceEntry => ({
          key: `r${row.id}`, group: null, row, count: '', narrowed: false,
          name: group.byColour ? row.product.colour!.trim() : row.head,
          tail: group.byColour ? null : row.tail,
          colour: true, tint: group.byColour,
        })),
      ];
    });
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

  /** One row's menu, or a product's (noun "kleur"): then every choice is for all its colours. */
  openMenu(event: MouseEvent, title: string, rows: readonly PriceRow[], noun: string | null = null): void {
    const rect = (event.currentTarget as HTMLElement | null)?.getBoundingClientRect();
    this.menu.set({
      title, ids: rows.map((row) => row.id), noun,
      anchor: rect ? { x: rect.left, y: rect.bottom + 4 } : { x: event.clientX, y: event.clientY },
    });
  }

  menuItems(open: PriceMenu): ContextMenuItem[] {
    const rows = this.menuRows(open);
    const first = rows[0];
    if (!first) return [];
    const same = rows.every((row) => row.standard.eur === first.standard.eur && row.standard.source === first.standard.source);
    const standard = !same ? `Verschilt per ${open.noun ?? 'kleur'}` : first.standard.eur === null ? 'Prijs op aanvraag'
      : `${this.placeholder(first.standard)} · ${first.standard.source === 'CUSTOMER' ? 'klantprijs' : 'catalogusprijs'}`;
    return [
      rows.every((row) => row.unprintable)
        ? { id: 'request', label: 'Op aanvraag', hint: 'Display zonder aantal stuks', checked: true, disabled: true }
        : { id: 'request', label: 'Op aanvraag', hint: open.noun ? `Geen prijs in deze PDF, voor elke ${open.noun}` : 'Geen prijs in deze PDF',
            checked: rows.every((row) => row.onRequest) },
      { id: 'standard', label: 'Terug naar standaard', hint: standard, disabled: !rows.some((row) => !!row.price), divider: true },
    ];
  }

  pick(open: PriceMenu, item: ContextMenuItem): void {
    this.menu.set(null);
    const rows = this.menuRows(open);
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
    const keep = customer && this.keep() ? this.keepable() : [];
    if (customer && keep.length) {
      /* The PDF's validity goes along unless it already lies in the past. Without one, a stored end date that is still
         ahead stays (the server keeps a field the change leaves out), and one that already passed is cleared, so the
         kept price applies again. The stored note always stays. */
      const until = this.validUntil() && this.validUntil() >= todayIso() ? this.validUntil() : null;
      const today = todayIso();
      const ended = (row: PriceRow): boolean => !!row.stored?.validUntil && row.stored.validUntil < today;
      this.busy.set(true);
      try {
        const saved = await this.api.save(customer.id, {
          source: 'CATALOG_EXPORT',
          changes: keep.map((row) => ({
            productId: row.id, priceExclVat: row.price!.priceEur,
            /* The unit the row named when the price was typed: the server refuses it once the product has left it. */
            basis: row.price!.basis, piecesPerUnit: row.price!.piecesPerUnit ?? null,
            ...(until ? { validUntil: until } : ended(row) ? { validUntil: null } : {}),
          })),
        });
        this.saved.emit(saved);
        this.ui.toast(`${keep.length} ${keep.length === 1 ? 'prijs' : 'prijzen'} bewaard voor ${customer.name}`);
      } catch (failure) {
        const stale = priceBasisRefusal(failure);
        if (stale) {
          /* Nothing was stored. The rows it names ask to be typed again, the page loads the products with their unit
             of now, and the sheet stays open with every typed price. */
          const named = new Set(stale.productIds);
          this.refused.set({
            products: this.products(),
            basis: new Map(keep.filter((row) => !named.size || named.has(row.id))
              .map((row) => [row.id, { basis: row.price!.basis, piecesPerUnit: row.price!.piecesPerUnit ?? null }])),
          });
          this.productsStale.emit();
          this.ui.toast('Niets bewaard: de prijsbasis is gewijzigd', 'err');
          setTimeout(() => this.host.nativeElement.querySelector('.cps-row.is-wrong')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60);
          return;
        }
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
