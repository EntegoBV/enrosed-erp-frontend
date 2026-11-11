import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, inject, signal, viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthImage } from '../../core/api/auth-image';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import type { Category, PalletProfile, Product, ProductFamily } from '../../core/api/models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { HostBridge } from '../../core/platform/host-bridge';
import { Icon } from '../../shared/icon';
import { LoadError } from '../../shared/load-error';
import { scrollBehavior } from '../../shared/motion';
import { PageHeader } from '../../shared/page-header';
import { CbmPipe, NumPipe } from '../../shared/pipes';
import { salesPhotoUrl } from '../../shared/sales-photo';
import { Segmented, type SegmentOption } from '../../shared/segmented';
import { Skeleton } from '../../shared/skeleton';
import { Sheet, Ui } from '../../shared/ui';
import { effectiveOrderStep } from '../products/product-order-step';
import { capitalize, productSalesUnit } from '../products/product-sales-unit';
import { PalletBrowser } from './pallet-browser';
import {
  palletBrowserSections, rememberRecent, tilesByProduct, type PalletBrowserColour, type PalletBrowserTile,
} from './pallet-browser-model';
import { PALLET_PRODUCT_COLOURS } from './pallet-stack';
import {
  CONTAINERS, MAX_PLANNED_PALLETS, PALLET_CHOICES, PALLET_FORMER_STANDARD_CM, PALLET_MAX_HEIGHT_CM, cartonCbm, cartonsFor, clampPalletHeight,
  containerCapacity, containerFill, palletFit, palletHeightLimit, palletSpec, planPallets, productUnits, roomWithoutExtraPallet,
  separatePallets, shareOnePallet, startUnit, unitsPerCarton,
  type CalcUnit, type ContainerCapacity, type ContainerChoice, type PalletFit, type PlanLine, type ProductUnits,
} from './pallet-calculator-model';

/** One picked product: what was typed, in which unit, and its colour on the pallets. */
interface CalcRow {
  productId: number;
  quantity: number | null;
  unit: CalcUnit;
  slot: number;
}

interface CalcLine {
  row: CalcRow;
  product: Product;
  /** The tile the product folds into; null only when the catalogue lost it. */
  tile: PalletBrowserTile | null;
  /** The range name and the tile's label, plus the colour when two rows share a tile. */
  title: string;
  colours: PalletBrowserColour[];
  colour: string;
  photo: string | null;
  units: ProductUnits;
  /** The pieces column: "Stuks", "Bowls". */
  pieceLabel: string;
  unitOptions: SegmentOption[];
  unit: CalcUnit;
  fit: PalletFit;
  containers: { container: ContainerChoice; capacity: ContainerCapacity | null }[];
  cartons: number;
  plan: PlanLine;
  cbm: number | null;
  weightKg: number;
  /** Missing data or a carton that fits no pallet, in words; null when the numbers stand. */
  problem: string | null;
}

interface PalletGroup {
  from: number;
  to: number;
  full: boolean;
  fill: number;
  heightCm: number;
  weightKg: number;
  blocks: { colour: string; pct: number }[];
  parts: { name: string; cartons: number; colour: string }[];
}

const STORAGE_KEY = 'enrosed.palletCalculator';
const UNITS: readonly CalcUnit[] = ['carton', 'display', 'piece'];
const MAX_ROWS = 12;
const MAX_RECENT = 12;
const collator = new Intl.Collator('nl-BE', { numeric: true, sensitivity: 'base' });

const PROBLEMS: Readonly<Record<string, string>> = {
  'afmetingen ontbreken': 'Omdoosmaten ontbreken',
  'doos past niet op de pallet': 'Omdoos te groot voor deze pallet',
  'te hoog of te zwaar': 'Omdoos te hoog of te zwaar',
};

function cm(value: number): string {
  return value.toLocaleString('nl-BE', { maximumFractionDigits: 1 });
}

function count(value: number, one: string, other: string): string {
  return `${value.toLocaleString('nl-BE')} ${value === 1 ? one : other}`;
}

function storedRow(value: unknown): value is CalcRow {
  const row = value as Partial<CalcRow> | null;
  return !!row && Number.isSafeInteger(row.productId) && UNITS.includes(row.unit as CalcUnit)
    && (row.quantity === null || (Number.isSafeInteger(row.quantity) && (row.quantity as number) >= 0))
    && Number.isSafeInteger(row.slot) && (row.slot as number) >= 0;
}

/** The row back at its place, in its own colour unless a newer card took it; null when it cannot come back. */
function withRow(rows: readonly CalcRow[], row: CalcRow, index: number): CalcRow[] | null {
  if (rows.length >= MAX_ROWS || rows.some((other) => other.productId === row.productId)) return null;
  const used = new Set(rows.map((other) => other.slot % PALLET_PRODUCT_COLOURS.length));
  const free = PALLET_PRODUCT_COLOURS.findIndex((_, slot) => !used.has(slot));
  const slot = !used.has(row.slot % PALLET_PRODUCT_COLOURS.length) ? row.slot : free < 0 ? rows.length : free;
  const next = [...rows];
  next.splice(Math.min(index, next.length), 0, { ...row, slot });
  return next;
}

/**
 * Palletberekening (Verkoop): what fits on a pallet and in a 20ft or 40ft
 * container, for one product or a mix, counted in omdozen, displays and
 * pieces. Built for the fair: photo first, one tap adds, the answer stays in
 * sight. The browser (pallet-browser.ts) shows one tile per carton with its
 * pallet figure; a tap puts the product's card on top. The phone reads
 * browser, cards, result (a glass capsule carries the result while it is out
 * of view); the desk keeps the result sticky on the right. Nothing is saved
 * on the server; the picks and the recent products stay on this device until
 * they are wiped. The numbers come from pallet-calculator-model.ts (the
 * backend's pallet rules).
 */
@Component({
  selector: 'app-pallet-calculator-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AuthImage, CbmPipe, Icon, LoadError, NgTemplateOutlet, NumPipe, PageHeader, PalletBrowser, RouterLink, Segmented, Sheet, Skeleton,
  ],
  template: `
    <app-page-header title="Palletberekening" [subtitle]="desktop.active() ? 'Pallet, 20ft en 40ft' : palletLabel()">
      @if (desktop.active()) {
        <label class="wk-search pc-search">
          <app-icon name="search" [size]="15" />
          <input type="search" data-page-search autocomplete="off" placeholder="Zoek naam, kleur of SKU" aria-label="Product zoeken"
                 [value]="query()" [disabled]="!products()" (input)="query.set(text($event))"
                 (keydown.enter)="searchEnter($event)" (keydown.escape)="searchEscape($event)" />
          <button class="wk-search__clear" type="button" aria-label="Zoekterm wissen" (click)="query.set('')"><app-icon name="close" [size]="13" /></button>
          <span class="wk-kbd" aria-hidden="true">/</span>
        </label>
      } @else {
        <button class="btn btn--sm btn--icon-mobile" type="button" (click)="palletSheet.set(true)"
                aria-label="Pallet instellen" title="Pallet instellen" aria-haspopup="dialog">
          <app-icon name="pallet" [size]="18" />
        </button>
      }
      @if (rows().length) {
        <button class="btn btn--sm btn--icon-mobile" type="button" (click)="clear()" aria-label="Alles wissen" title="Alles wissen">
          <app-icon name="trash" [size]="16" /><span class="pc-desk-label">Wissen</span>
        </button>
      }
    </app-page-header>
    <div class="content pc">
      @if (loadError(); as error) {
        <div class="pc-panel pc-gap"><app-load-error title="Producten konden niet worden geladen" [message]="error" [busy]="loading()" (retry)="load()" /></div>
      }
      <div class="pc-grid">
        <div class="pc-find">
          @if (products() || loading()) {
            <app-pallet-browser [sections]="sections()" [recent]="recentTiles()" [picked]="pickedTiles()" [pallet]="pallet()"
                                [variant]="segVariant()" [loading]="!products()" [full]="full()" [maxRows]="maxRows"
                                [hint]="!rows().length" [foldable]="rows().length > 0" [(open)]="browserOpen" [(query)]="query"
                                (chosen)="choose($event)" />
          }
        </div>

        <div class="pc-side">
          @if (desktop.active()) {
            <section class="pc-panel pc-set" aria-label="Pallet"><ng-container [ngTemplateOutlet]="palletSettings" /></section>
          }
          @if (desktop.active() || summaryKind() === 'choose' || summaryKind() === 'plan') {
            <section class="pc-panel pc-sum" aria-live="polite" #sum>
              <p class="pc-eyebrow">Resultaat</p>
              @switch (summaryKind()) {
                @case ('empty') {
                  @if (loading() && !products()) { <app-skeleton kind="lines" [rows]="2" /> }
                  @else { <h2 class="pc-sum__title">Wat past erop?</h2> }
                }
                @case ('capacity') {
                  @if (lines()[0]; as line) {
                    @if (line.fit.cartonsPerPallet > 0) {
                      <h2 class="pc-sum__title">{{ line.fit.cartonsPerPallet | num }} {{ line.fit.cartonsPerPallet === 1 ? 'omdoos' : 'omdozen' }} <small>per pallet</small></h2>
                      @if (unitsLine(line, line.fit.cartonsPerPallet); as units) { <p class="pc-sum__units">{{ units }}</p> }
                    } @else {
                      <h2 class="pc-sum__title">Past niet</h2>
                      <p class="pc-sum__facts pc-warn">{{ line.problem }}</p>
                    }
                  }
                }
                @case ('choose') {
                  <h2 class="pc-sum__title">Gemengde pallet</h2>
                  @if (canShare()) {
                    <p class="pc-sum__facts">Vul aantallen in of verdeel één pallet.</p>
                    <button class="btn btn--primary btn--sm pc-sum__action" type="button" (click)="share()">
                      <app-icon name="layers" [size]="16" /><span>Verdeel 1 pallet</span>
                    </button>
                  } @else {
                    <p class="pc-sum__facts pc-warn">Geen van deze omdozen past op deze pallet.</p>
                  }
                }
                @case ('plan') {
                  <h2 class="pc-sum__title">{{ palletsText() }}@if (lastFill(); as fill) { <small>{{ fill }}</small> }</h2>
                  <p class="pc-sum__units">{{ totalsLine() }}</p>
                  @if (totals().cbm > 0 || totals().weightKg > 0) {
                    <p class="pc-sum__facts">
                      @if (totals().cbm > 0) { {{ totals().cbm | cbm: 2 }} }
                      @if (totals().cbm > 0 && totals().weightKg > 0) { · }
                      @if (totals().weightKg > 0) { {{ totals().weightKg | num }} kg }
                    </p>
                  }
                  <div class="pc-cont" aria-label="Containers">
                    @for (fill of containerFills(); track fill.container.id) {
                      <div class="pc-cont__tile">
                        <span>{{ fill.container.label }}</span>
                        <b>{{ fill.share * 100 | num }} %</b>
                        <small>{{ fill.incomplete ? 'maten ontbreken' : fill.needed <= 1 ? 'past' : fill.needed + ' containers' }}</small>
                        <i class="pc-cont__bar" aria-hidden="true"><i [style.width.%]="barWidth(fill.share)"></i></i>
                      </div>
                    }
                  </div>
                  @if (palletGroups().length) {
                    <ol class="pc-pallets" aria-label="Pallets">
                      @for (group of palletGroups(); track group.from) {
                        <li class="pc-pallet">
                          <span class="pc-stack" aria-hidden="true">
                            @for (block of group.blocks; track $index) { <i [style.height.%]="block.pct" [style.background]="block.colour"></i> }
                          </span>
                          <span class="pc-pallet__text">
                            <b>{{ groupTitle(group) }}</b>
                            <small>{{ group.heightCm | num }} cm · {{ group.weightKg | num }} kg</small>
                          </span>
                          <span class="pc-parts">
                            @for (part of group.parts; track $index) {
                              <span><i class="pc-dot" [style.--dot]="part.colour"></i><span aria-hidden="true">{{ group.parts.length === 1 ? cartonsText(part.cartons) : (part.cartons | num) }}</span><span class="sr-only">{{ part.name }}: {{ cartonsText(part.cartons) }}</span></span>
                            }
                          </span>
                        </li>
                      }
                    </ol>
                  }
                  @for (line of unplaced(); track line.row.productId) {
                    <p class="pc-sum__facts pc-warn pc-unplaced"><span>{{ line.title }}</span>: {{ line.problem }}</p>
                  }
                  @if (room().length) {
                    <div class="pc-room">
                      <h3>Past nog bij, zonder extra pallet</h3>
                      @for (entry of room(); track entry.line.row.productId) {
                        <div class="pc-room__row">
                          <i class="pc-dot" [style.--dot]="entry.line.colour" aria-hidden="true"></i>
                          <span>{{ entry.line.title }}</span>
                          <button class="btn btn--sm" type="button" (click)="addCartons(entry.line, entry.cartons)"
                                  [attr.aria-label]="'Voeg ' + entry.cartons + ' omdozen ' + entry.line.title + ' toe'">
                            + {{ cartonsText(entry.cartons) }}
                          </button>
                        </div>
                      }
                    </div>
                  }
                  @if (canShare()) {
                    <button class="btn btn--sm pc-sum__action" type="button" (click)="share()">
                      <app-icon name="layers" [size]="16" /><span>Verdeel 1 pallet</span>
                    </button>
                  }
                }
              }
            </section>
          }
        </div>

        <div class="pc-list">
          @for (line of lines(); track line.row.productId) {
            <article class="pc-card" [class.mo-enter]="entering() === line.row.productId" [class.pc-card--flash]="flash() === line.row.productId"
                     [attr.data-row]="line.row.productId" [style.--pc-colour]="line.colour" [attr.aria-label]="line.title" animate.leave="mo-leave">
              <header class="pc-card__head">
                @if (line.photo; as photo) { <img class="pc-thumb" [appAuthSrc]="photo" appAuthLazy alt="" /> }
                @else { <span class="pc-thumb pc-thumb--none"><app-icon name="products" [size]="20" /></span> }
                <div class="pc-card__title">
                  <h3 class="pc-card__name">{{ line.title }}</h3>
                  @if (line.colours.length > 1) {
                    <p class="pc-card__sub pc-colours" role="img" [attr.aria-label]="line.colours.length + ' kleuren: ' + colourNames(line.colours)">
                      @for (colour of line.colours.slice(0, 6); track colour.name) { <i class="pc-dot" [style.--dot]="colour.hex"></i> }
                      @if (line.colours.length > 6) { <span>+{{ line.colours.length - 6 }}</span> }
                    </p>
                  } @else if (line.colours.length === 1) {
                    <p class="pc-card__sub">{{ line.colours[0].name }}</p>
                  }
                </div>
                <button class="pc-icon" type="button" (click)="info.set(line.row.productId)" aria-haspopup="dialog"
                        [attr.aria-label]="'Gegevens van ' + line.title"><app-icon name="info" [size]="18" /></button>
                <button class="pc-icon" type="button" (click)="remove(line)" [attr.aria-label]="'Verwijder ' + line.title">
                  <app-icon name="close" [size]="16" />
                </button>
              </header>
              @if (line.problem) {
                <p class="pc-warn pc-problem">{{ line.problem }} · <a [routerLink]="['/products', line.product.id, 'edit']">Aanvullen</a></p>
              }
              <div class="pc-body">
                <table class="pc-table">
                  <thead>
                    <tr>
                      <th scope="col"><span class="sr-only">Laadruimte</span></th>
                      <th scope="col" [class.is-unit]="line.unitOptions.length > 1 && line.unit === 'carton'">Omdozen</th>
                      @if (line.units.displaysPerCarton) { <th scope="col" [class.is-unit]="line.unit === 'display'">Displays</th> }
                      @if (line.units.piecesPerCarton) { <th scope="col" [class.is-unit]="line.unit === 'piece'">{{ line.pieceLabel }}</th> }
                    </tr>
                  </thead>
                  <tbody>
                    @if (line.units.displaysPerCarton || line.units.piecesPerCarton) {
                      <tr class="pc-table__per">
                        <th scope="row">Omdoos</th>
                        <td>1</td>
                        @if (line.units.displaysPerCarton; as per) { <td>{{ per | num }}</td> }
                        @if (line.units.piecesPerCarton; as per) { <td>{{ per | num }}</td> }
                      </tr>
                    }
                    <tr class="pc-table__pallet">
                      <th scope="row">Pallet</th>
                      <td>{{ cell(line.fit.cartonsPerPallet, 1) }}</td>
                      @if (line.units.displaysPerCarton; as per) { <td>{{ cell(line.fit.cartonsPerPallet, per) }}</td> }
                      @if (line.units.piecesPerCarton; as per) { <td>{{ cell(line.fit.cartonsPerPallet, per) }}</td> }
                    </tr>
                    @for (entry of line.containers; track entry.container.id) {
                      <tr>
                        <th scope="row">{{ entry.container.label }}@if (entry.capacity?.counted) { <small class="pc-tag" title="Bevestigd aantal van het product">geteld</small> }</th>
                        <td>{{ cell(entry.capacity?.cartons ?? 0, 1) }}</td>
                        @if (line.units.displaysPerCarton; as per) { <td>{{ cell(entry.capacity?.cartons ?? 0, per) }}</td> }
                        @if (line.units.piecesPerCarton; as per) { <td>{{ cell(entry.capacity?.cartons ?? 0, per) }}</td> }
                      </tr>
                    }
                  </tbody>
                </table>
                @if (line.fit.cartonsPerPallet > 0) {
                  <p class="pc-fit">{{ fitFacts(line.fit, line.fit.cartonsPerPallet * line.weightKg) }}</p>
                }
                <div class="pc-qtyblock">
                  <div class="pc-qty">
                    <div class="pc-step" role="group" [attr.aria-label]="'Aantal ' + line.title">
                      <button type="button" (click)="step(line, -1)" [disabled]="!line.cartons" aria-label="Eén omdoos minder">−</button>
                      <input type="text" inputmode="numeric" placeholder="0" [attr.aria-label]="'Aantal ' + line.title"
                             [value]="line.row.quantity ?? ''" (input)="setQuantity(line, $event)" (keydown.enter)="blur($event)" />
                      <button type="button" (click)="step(line, 1)" aria-label="Eén omdoos meer">+</button>
                    </div>
                    @if (line.unitOptions.length > 1) {
                      <app-segmented label="Eenheid" [variant]="segVariant()" [options]="line.unitOptions" [value]="line.unit"
                                     (changed)="setUnit(line, $any($event))" />
                    } @else {
                      <span class="pc-qty__unit">omdozen</span>
                    }
                  </div>
                  @if (quantityNote(line); as note) { <p class="pc-qty__note">{{ note }}</p> }
                </div>
              </div>
            </article>
          } @empty {
            @if (loading() && rows().length) {
              <div class="pc-panel"><app-skeleton kind="list" [rows]="rows().length > 2 ? 3 : rows().length" /></div>
            }
          }
        </div>
      </div>
    </div>

    <ng-template #palletSettings>
      <app-segmented label="Pallettype" [variant]="segVariant()" [options]="palletOptions" [value]="profile()"
                     (changed)="profile.set($any($event))" />
      <div class="pc-set__row">
        <span class="pc-set__label" id="pc-height-label">Max. hoogte</span>
        <div class="pc-step" role="group" aria-labelledby="pc-height-label">
          <button type="button" (click)="setHeight(maxHeight() - 10)" aria-label="10 cm lager">−</button>
          <input type="text" inputmode="numeric" aria-labelledby="pc-height-label" [value]="maxHeight()"
                 (change)="typeHeight($event)" (keydown.enter)="blur($event)" />
          <button type="button" [disabled]="maxHeight() >= heightLimit()" (click)="setHeight(maxHeight() + 10)" aria-label="10 cm hoger">+</button>
        </div>
        <span class="pc-set__hint">cm</span>
      </div>
      <p class="pc-set__hint">incl. pallet · max {{ pallet().maxWeightKg | num }} kg per pallet</p>
    </ng-template>

    @if (palletSheet() && !desktop.active()) {
      <app-sheet title="Pallet" variant="ios" (closed)="palletSheet.set(false)">
        <div body class="pc-set pc-sheet"><ng-container [ngTemplateOutlet]="palletSettings" /></div>
        <div foot style="display:contents"><button class="btn btn--primary" type="button" (click)="palletSheet.set(false)">Klaar</button></div>
      </app-sheet>
    }

    @if (infoLine(); as line) {
      <app-sheet [title]="line.title" variant="ios" (closed)="info.set(null)">
        <div body class="pc-sheet">
          <dl class="pc-facts">
            <div><dt>Omdoos</dt><dd>{{ cartonSize(line) }}</dd></div>
            <div><dt>Gewicht</dt><dd>{{ line.weightKg ? cm(line.weightKg) + ' kg' : 'Onbekend' }}</dd></div>
            <div><dt>Inhoud</dt><dd>{{ contents(line) }}</dd></div>
            @if (line.cbm) { <div><dt>Volume</dt><dd>{{ line.cbm | cbm }}</dd></div> }
            <div><dt>Op de pallet</dt><dd>{{ line.fit.cartonsPerPallet > 0 ? fitFacts(line.fit, line.fit.cartonsPerPallet * line.weightKg) : line.problem }}</dd></div>
            <div><dt>Containers</dt><dd>@for (text of containerSources(line); track text) { <span>{{ text }}</span> }</dd></div>
            <div><dt>Klant bestelt per</dt><dd>{{ orderUnit(line.product) }}</dd></div>
            <div><dt>Varianten</dt>
              <dd>
                @for (variant of line.tile?.products ?? [line.product]; track variant.id) {
                  <span class="pc-variant"><i class="pc-dot" [style.--dot]="dotOf(line, variant)"></i>{{ variant.colour || variant.name }} <small>{{ variant.sku }}</small></span>
                }
              </dd>
            </div>
          </dl>
          <p class="pc-note">Geteld is het bevestigde aantal van het product, de rest gaat op volume: 20ft 28 m³, 40ft 58 m³, 40ft HC 68 m³.</p>
        </div>
        <div foot style="display:contents">
          @if (line.problem) { <a class="btn btn--primary" [routerLink]="['/products', line.product.id, 'edit']">Product aanvullen</a> }
          @else { <a class="btn btn--primary" [routerLink]="['/products', line.product.id]">Product openen</a> }
        </div>
      </app-sheet>
    }

    @if (floatShown() && capsule(); as answer) {
      <button class="ios-float pc-float" type="button" (click)="toSummary()"
              [attr.aria-label]="'Naar het resultaat: ' + answer.pallets + (answer.container ? ', ' + answer.container : '')">
        <span class="pc-float__icon" aria-hidden="true"><app-icon name="pallet" [size]="16" /></span>
        <b aria-hidden="true">{{ answer.pallets }}</b>
        @if (answer.container) { <span class="pc-float__more" aria-hidden="true">· {{ answer.container }}</span> }
      </button>
    }
    <p class="sr-only" aria-live="polite">{{ status() }}</p>
  `,
  styles: [`
    :host{display:block}
    .pc{max-width:1240px;container:pc / inline-size}
    .pc-gap{margin-bottom:14px}
    .pc-grid{display:flex;flex-direction:column;gap:14px}
    .pc-find{min-width:0}
    .pc-side{display:contents}
    .pc-set{order:-1}.pc-sum{order:2;scroll-margin-top:calc(var(--appbar-h, 52px) + 8px)}
    .pc-list{order:1;min-width:0;display:flex;flex-direction:column;gap:12px}
    @container pc (min-width: 760px){
      .pc-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,340px);grid-template-rows:auto 1fr;grid-template-areas:"find side" "list side";align-items:start}
      .pc-find{grid-area:find}.pc-list{grid-area:list}
      .pc-side{grid-area:side;position:sticky;top:calc(var(--appbar-h, 52px) + 14px);display:flex;flex-direction:column;gap:12px;min-width:0}
    }
    .pc-panel{border:1px solid var(--line);border-radius:18px;background:var(--surface);padding:16px 18px}
    .pc-set{display:flex;flex-direction:column;gap:12px}
    .pc-set__row{display:flex;align-items:center;flex-wrap:wrap;gap:8px 10px}
    .pc-set__label{font-size:13px;font-weight:600}.pc-set__hint{margin:0;font-size:12px;color:var(--muted)}
    .pc-step{display:inline-flex;align-items:center;border:1px solid var(--line-strong);border-radius:999px;background:var(--surface);overflow:hidden}
    .pc-step:focus-within{border-color:var(--rose-mid);box-shadow:0 0 0 3px rgb(209 74 103 / 14%)}
    .pc-step button{display:grid;place-items:center;width:42px;height:42px;border:0;background:none;color:var(--ink);font-size:20px;line-height:1;cursor:pointer;-webkit-tap-highlight-color:transparent}
    .pc-step button:active:not(:disabled){background:var(--surface-2)}.pc-step button:disabled{opacity:.35;cursor:default}
    .pc-step input{width:64px;height:42px;border:0;padding:0;background:none;color:var(--ink);text-align:center;font-size:16px;font-weight:700;font-variant-numeric:tabular-nums}
    .pc-step input:focus{outline:none}
    .pc-eyebrow,.pc-room h3,.pc-cont__tile span,.pc-table thead th,.pc-tag{margin:0;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
    .pc-eyebrow{margin-bottom:6px}
    .pc-sum__title{margin:0;font-size:26px;line-height:1.15;font-weight:800;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
    .pc-sum__title small{margin-left:6px;font-size:15px;font-weight:600;letter-spacing:0;color:var(--muted)}
    .pc-sum__units{margin:6px 0 0;font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}
    .pc-sum__facts{margin:4px 0 0;font-size:13px;line-height:1.5;color:var(--muted)}
    .pc-sum__action{margin-top:14px}
    .pc-warn{color:var(--warn)}
    .pc-unplaced{display:flex;font-weight:600;white-space:nowrap}
    .pc-cont{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:14px}
    .pc-cont__tile{display:flex;flex-direction:column;min-width:0;padding:9px 10px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}
    .pc-cont__tile b{font-size:17px;font-weight:800;font-variant-numeric:tabular-nums}
    .pc-cont__tile small{font-size:11px;color:var(--muted)}
    .pc-cont__bar{display:block;height:4px;margin-top:6px;border-radius:999px;background:var(--line);overflow:hidden}
    .pc-cont__bar i{display:block;height:100%;border-radius:inherit;background:var(--rose)}
    .pc-pallets{list-style:none;margin:14px 0 0;padding:12px 0 0;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:10px}
    .pc-pallet{display:flex;align-items:center;gap:12px}
    .pc-stack{flex:none;width:30px;height:46px;display:flex;flex-direction:column-reverse;overflow:hidden;border-radius:4px 4px 1px 1px;background:var(--surface-2);border-bottom:4px solid color-mix(in srgb,#a87b4f 85%,var(--surface))}
    .pc-stack i{display:block;flex:none;box-shadow:inset 0 1px 0 rgb(255 255 255 / 35%)}
    .pc-pallet__text{flex:1;min-width:0;font-size:12px;line-height:1.45;color:var(--muted)}
    .pc-pallet__text>*{display:block}.pc-pallet__text b{font-size:14px;color:var(--ink)}
    .pc-parts{max-width:55%;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:2px 10px;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums}
    .pc-parts>span,.pc-variant{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
    .pc-room{margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}
    .pc-room h3{margin-bottom:4px}
    .pc-room__row{display:flex;align-items:center;gap:10px;min-height:44px;font-size:13px}
    .pc-room__row .btn{flex:none}
    .pc-room__row span,.pc-unplaced span,.pc-cont__tile small,.pc-pallet__text>*,.pc-card__sub,.pc-float__more{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
    .pc-room__row span{flex:1}
    .pc-dot{display:inline-block;flex:none;width:9px;height:9px;border-radius:50%;background:var(--dot,var(--surface));box-shadow:inset 0 0 0 .5px rgb(26 22 20 / 30%)}
    .pc-card{display:flex;flex-direction:column;gap:10px;padding:14px 16px;border:1px solid var(--line);border-radius:18px;background:var(--surface);box-shadow:inset 4px 0 var(--pc-colour);scroll-margin:calc(var(--appbar-h, 52px) + 8px) 0 96px;--mo-row-h:760px}
    .pc-card--flash{animation:pc-flash .9s var(--ease-out,ease)}
    @keyframes pc-flash{from{box-shadow:inset 4px 0 var(--pc-colour),0 0 0 4px var(--pc-colour)}}
    .pc-card__head{display:flex;align-items:center;gap:12px}
    .pc-thumb{flex:none;width:52px;height:52px;border-radius:12px;object-fit:cover;background:var(--surface-2)}
    .pc-thumb--none{display:grid;place-items:center;color:var(--muted)}
    .pc-card__title{flex:1;min-width:0}
    .pc-card__name{display:-webkit-box;margin:0;overflow:hidden;font-size:15px;font-weight:700;line-height:1.3;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow-wrap:anywhere}
    .pc-card__sub{margin:3px 0 0;font-size:12px;color:var(--muted)}
    .pc-colours{display:flex;align-items:center;gap:4px;font-weight:600}
    .pc-icon{position:relative;isolation:isolate;display:grid;place-items:center;flex:none;width:44px;height:44px;margin:-4px -4px -4px -8px;padding:0;border:0;background:none;color:var(--ink-2);cursor:pointer;-webkit-tap-highlight-color:transparent}
    .pc-icon::before{content:'';position:absolute;inset:4px;z-index:-1;border-radius:50%;background:var(--surface-2);box-shadow:inset 0 0 0 1px var(--line)}
    .pc-icon:active::before{background:var(--line)}
    .pc-problem{margin:0;font-size:13px;font-weight:600}.pc-problem a{color:inherit}
    .pc-body{display:flex;flex-direction:column;gap:10px;min-width:0}
    .pc-table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
    .pc-table th,.pc-table td{padding:7px 0 7px 8px;border-top:1px solid var(--line);font-size:14px;text-align:right;white-space:nowrap}
    .pc-table th:first-child{padding-left:0;text-align:left}
    .pc-table thead th{border-top:0;padding-top:0}
    .pc-table thead .is-unit{color:var(--rose-dark);text-decoration:underline 2px;text-underline-offset:5px}
    .pc-table tbody th{font-weight:600;color:var(--ink-2)}
    .pc-tag{margin-left:6px;font-size:10px}
    .pc-table .pc-table__per :is(th,td){font-size:13px;font-weight:500;color:var(--muted)}
    .pc-table__pallet td{font-size:16px;font-weight:800;color:var(--ink)}
    @container pc (max-width: 339.98px){.pc-tag{display:block;margin:1px 0 0}}
    .pc-fit{margin:-2px 0 0;font-size:12px;color:var(--muted)}
    .pc-qtyblock{display:flex;flex-direction:column;gap:6px;min-width:0}
    .pc-qty{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;padding-top:2px}
    .pc-qty app-segmented{flex:1 1 180px;min-width:0;max-width:480px}
    .pc-qty__unit{font-size:13px;color:var(--muted)}
    .pc-qty__note{margin:0;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
    @container pc-card (min-width: 600px){
      .pc-body{display:grid;grid-template-columns:minmax(0,1fr) 236px;column-gap:24px;align-items:start}
      .pc-qtyblock{grid-column:2;grid-row:1 / span 2;padding-top:18px}
    }
    .pc-facts{margin:0}
    .pc-facts>div{display:grid;grid-template-columns:2fr 3fr;gap:12px;padding:10px 0;border-top:1px solid var(--line)}
    .pc-facts>:first-child{border-top:0}
    .pc-facts dt{color:var(--muted);font-size:13px}
    .pc-facts dd{display:grid;margin:0;font-size:14px;font-weight:600;overflow-wrap:anywhere}
    .pc-variant small{color:var(--muted);font-weight:500}
    .pc-note{margin:12px 0 0;font-size:12.5px;line-height:1.45;color:var(--muted)}
    .pc-float{animation:mo-lift-in var(--dur-2,.2s) var(--ease-out,ease) backwards;cursor:pointer}
    .pc-float__icon{display:grid;flex:none;place-items:center;width:32px;height:32px;border-radius:50%;background:var(--rose-soft);color:var(--rose-dark)}
    .pc-float b{font-size:14px;font-weight:750;white-space:nowrap}
    .pc-float__more{color:var(--muted)}
    .pc :is(button,a,input):focus-visible{outline:2px solid var(--rose);outline-offset:2px}
    @media (min-width: 1024px), (min-width: 680px) and (hover: hover){
      .pc-search{width:300px}.pc-search input::-webkit-search-cancel-button{display:none}
      .pc-card{container:pc-card / inline-size}
      .pc-qty app-segmented{max-width:360px}.pc-set app-segmented{align-self:flex-start}
    }
    @media (min-width: 1024px) and (max-width: 1179.98px), (min-width: 680px) and (max-width: 1179.98px) and (hover: hover){
      .pc-search{width:236px;transition:width var(--dur-2,.2s) var(--ease-out,ease)}.pc-search:focus-within{width:300px}
    }
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){
      .pc-desk-label{display:none}
      .pc-sum__title{font-size:23px}.pc-panel{padding:15px 16px}.pc-card{padding:13px 14px}
      .pc-step button{width:44px;height:44px}.pc-step input{height:44px}
      .pc-sheet{padding:0 16px}
    }
  `],
})
export class PalletCalculatorPage {
  private readonly catalog = inject(CatalogApi);
  readonly desktop = inject(DesktopViewport);
  private readonly hostBridge = inject(HostBridge);
  private readonly ui = inject(Ui);
  private readonly injector = inject(Injector);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly products = signal<Product[] | null>(null);
  private readonly categories = signal<Category[]>([]);
  private readonly families = signal<ProductFamily[]>([]);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly query = signal('');
  readonly profile = signal<PalletProfile>('EURO_120X80');
  /**
   * The height the user holds. A pallet type shows at most what it allows (a europallet 260 cm), and a
   * higher pick comes back when the type that allows it is chosen again while the page stays open.
   */
  private readonly pickedHeight = signal(PALLET_MAX_HEIGHT_CM);
  readonly heightLimit = computed(() => palletHeightLimit(this.profile()));
  readonly maxHeight = computed(() => Math.min(this.pickedHeight(), this.heightLimit()));
  readonly rows = signal<CalcRow[]>([]);
  /** Product ids, newest first: the Recent chip. */
  private readonly recentIds = signal<number[]>([]);
  readonly browserOpen = signal(true);
  readonly palletSheet = signal(false);
  /** The product id whose facts sheet is open. */
  readonly info = signal<number | null>(null);
  /** The card that just came in (its rise) and the card a tile pointed to (its ring). */
  readonly entering = signal<number | null>(null);
  readonly flash = signal<number | null>(null);
  readonly status = signal('');
  readonly summaryInView = signal(true);
  readonly maxRows = MAX_ROWS;

  private readonly browser = viewChild(PalletBrowser);
  private readonly summary = viewChild<ElementRef<HTMLElement>>('sum');
  private flashTimer: ReturnType<typeof setTimeout> | undefined;

  readonly palletOptions: SegmentOption[] = PALLET_CHOICES.map((choice) =>
    ({ id: choice.id, label: `${choice.short} ${choice.size.replace(/ /g, '')}`, ariaLabel: `${choice.label} ${choice.size} cm` }));
  readonly segVariant = computed<'desk' | 'ios'>(() => (this.desktop.active() ? 'desk' : 'ios'));
  readonly pallet = computed(() => palletSpec(this.profile(), this.maxHeight()));
  readonly palletLabel = computed(() => {
    const choice = PALLET_CHOICES.find((candidate) => candidate.id === this.profile()) ?? PALLET_CHOICES[0];
    return `${choice.label} ${choice.size} · max ${this.maxHeight()} cm`;
  });

  private readonly byId = computed(() => new Map((this.products() ?? []).map((product) => [product.id as number, product])));
  readonly sections = computed(() => palletBrowserSections(this.products() ?? [], this.families(), this.categories()));
  private readonly tileOf = computed(() => tilesByProduct(this.sections()));

  readonly recentTiles = computed(() => {
    const tiles = this.tileOf();
    const seen = new Set<string>();
    const recent: PalletBrowserTile[] = [];
    for (const id of this.recentIds()) {
      const tile = tiles.get(id);
      if (!tile || seen.has(tile.key)) continue;
      seen.add(tile.key);
      recent.push(tile);
      if (recent.length === 8) break;
    }
    return recent;
  });

  readonly lines = computed<CalcLine[]>(() => {
    const products = this.byId();
    const tiles = this.tileOf();
    const pallet = this.pallet();
    const perTile = new Map<string, number>();
    for (const row of this.rows()) {
      const key = tiles.get(row.productId)?.key;
      if (key) perTile.set(key, (perTile.get(key) ?? 0) + 1);
    }
    return this.rows().flatMap((row) => {
      const product = products.get(row.productId);
      if (!product) return [];
      const tile = tiles.get(row.productId) ?? null;
      return [this.line(row, product, tile, !!tile && (perTile.get(tile.key) ?? 0) > 1, pallet)];
    });
  });

  /** Tile key → the colour of its card; the browser marks those tiles. */
  readonly pickedTiles = computed(() => {
    const picked = new Map<string, string>();
    for (const line of this.lines()) if (line.tile && !picked.has(line.tile.key)) picked.set(line.tile.key, line.colour);
    return picked;
  });

  readonly infoLine = computed(() => this.lines().find((line) => line.row.productId === this.info()) ?? null);

  /** Absurd quantities (a typo of seven digits) are not worked out pallet by pallet. */
  readonly tooMany = computed(() => separatePallets(this.lines().map((line) => line.plan)) > MAX_PLANNED_PALLETS);
  readonly plan = computed(() => (this.tooMany() ? [] : planPallets(this.lines().map((line) => line.plan), this.pallet())));
  readonly canShare = computed(() => this.lines().length > 1 && this.lines().some((line) => line.fit.cartonsPerPallet > 0));
  readonly full = computed(() => this.rows().length >= MAX_ROWS);
  readonly unplaced = computed(() => this.lines().filter((line) => line.cartons > 0 && line.fit.cartonsPerPallet <= 0));
  readonly summaryKind = computed<'empty' | 'capacity' | 'choose' | 'plan'>(() => {
    const lines = this.lines();
    if (!lines.length) return 'empty';
    if (lines.some((line) => line.cartons > 0)) return 'plan';
    return lines.length === 1 ? 'capacity' : 'choose';
  });

  readonly totals = computed(() => {
    let cartons = 0; let displays = 0; let pieces = 0; let cbm = 0; let weightKg = 0;
    let withDisplays = false; let withPieces = false;
    for (const line of this.lines()) {
      if (!line.cartons) continue;
      cartons += line.cartons;
      if (line.units.displaysPerCarton) { displays += line.cartons * line.units.displaysPerCarton; withDisplays = true; }
      if (line.units.piecesPerCarton) { pieces += line.cartons * line.units.piecesPerCarton; withPieces = true; }
      cbm += line.cartons * (line.cbm ?? 0);
      weightKg += line.cartons * line.weightKg;
    }
    return { cartons, displays: withDisplays ? displays : null, pieces: withPieces ? pieces : null, cbm, weightKg };
  });

  readonly palletGroups = computed<PalletGroup[]>(() => {
    const pallet = this.pallet();
    const usable = pallet.maxHeightCm - pallet.baseHeightCm;
    const lines = new Map(this.lines().map((line) => [line.product.id as number, line]));
    const groups: PalletGroup[] = [];
    let previousKey: number | null = null;
    this.plan().forEach((planned, index) => {
      const fullKey = planned.full ? planned.parts[0].key : null;
      const last = groups.at(-1);
      if (last && fullKey !== null && fullKey === previousKey) { last.to = index + 1; return; }
      previousKey = fullKey;
      groups.push({
        from: index + 1, to: index + 1, full: planned.full, fill: planned.fill,
        heightCm: planned.heightCm, weightKg: planned.weightKg,
        blocks: planned.parts.map((part) => ({
          colour: lines.get(part.key)?.colour ?? 'var(--muted)',
          pct: Math.min(100, (part.layers * (lines.get(part.key)?.plan.cartonHeightCm ?? 0) / usable) * 100),
        })),
        parts: planned.parts.map((part) => ({
          name: lines.get(part.key)?.title ?? '', cartons: part.cartons, colour: lines.get(part.key)?.colour ?? '',
        })),
      });
    });
    return groups;
  });

  /** How many more omdozen of each product go on without an extra pallet; worked out for small plans only (each is a re-plan). */
  readonly room = computed(() => {
    const count = this.plan().length;
    if (count === 0 || count > 30) return [];
    const pallet = this.pallet();
    const plan = this.lines().map((line) => line.plan);
    return this.lines()
      .map((line) => ({ line, cartons: roomWithoutExtraPallet(plan, line.plan.key, pallet, count) }))
      .filter((entry) => entry.cartons > 0);
  });

  readonly containerFills = computed(() => CONTAINERS.map((container, index) =>
    containerFill(this.lines().map((line) => ({ cartons: line.cartons, capacity: line.containers[index].capacity })), container)));

  /**
   * The phone capsule's answer: the pallets, then the smallest container
   * that takes everything ("20ft 13 %"), else how many 40ft HC; no container
   * part while sizes are missing.
   */
  readonly capsule = computed(() => {
    if (this.summaryKind() !== 'plan') return null;
    const fills = this.containerFills();
    const fit = fills.find((fill) => !fill.incomplete && fill.needed <= 1);
    const largest = fills.at(-1);
    const container = fit ? `${fit.container.label} ${Math.round(fit.share * 100)} %`
      : largest && !largest.incomplete && largest.needed > 1 ? `${largest.needed} × ${largest.container.label}` : null;
    return { pallets: this.palletsText(), container };
  });
  readonly floatShown = computed(() => !this.desktop.active() && this.summaryKind() === 'plan' && !this.summaryInView());

  constructor() {
    this.restore();
    effect(() => {
      /* standardCm is the standard the height was saved under: a device that holds that number never picked
         one and follows a later standard (restore). */
      const state = { profile: this.profile(), heightCm: this.maxHeight(), standardCm: PALLET_MAX_HEIGHT_CM, rows: this.rows(), recent: this.recentIds() };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* private mode: the picks live as long as the page */ }
    });
    /* The capsule shows while the result is out of view (the tab bar's band counts as out of view). */
    effect((onCleanup) => {
      const summary = this.summary()?.nativeElement;
      if (!summary || typeof IntersectionObserver === 'undefined') { this.summaryInView.set(true); return; }
      const observer = new IntersectionObserver(([entry]) => this.summaryInView.set(entry.isIntersecting), { rootMargin: '0px 0px -96px 0px' });
      observer.observe(summary);
      onCleanup(() => observer.disconnect());
    });
    this.destroyRef.onDestroy(() => clearTimeout(this.flashTimer));
    void this.load();
  }

  async load(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    try {
      const [products, categories, families] = await Promise.all([
        this.catalog.products(),
        this.catalog.categories().catch(() => [] as Category[]),
        this.catalog.productFamilies({ maxAgeMs: 20_000 }).catch(() => [] as ProductFamily[]),
        this.catalog.unitNames().catch(() => []),
      ]);
      if (this.destroyRef.destroyed) return;
      const usable = products
        .filter((product) => product.id !== null && product.active && !product.demo)
        .sort((left, right) => collator.compare(left.name, right.name) || collator.compare(left.colour ?? '', right.colour ?? ''));
      this.categories.set(categories);
      this.families.set(families);
      this.products.set(usable);
      const known = new Set(usable.map((product) => product.id));
      this.rows.update((rows) => rows.filter((row) => known.has(row.productId)));
      this.recentIds.update((ids) => ids.filter((id) => known.has(id)));
      if (!this.rows().length) this.browserOpen.set(true);
      this.loadError.set(null);
    } catch (error) {
      if (!this.destroyRef.destroyed) this.loadError.set(messageOf(error, 'De producten konden niet worden opgehaald. Probeer opnieuw.'));
    } finally {
      if (!this.destroyRef.destroyed) this.loading.set(false);
    }
  }

  /** A tile: its product on top, or the card it already has. */
  choose(tile: PalletBrowserTile): void {
    const tiles = this.tileOf();
    const row = this.rows().find((candidate) => tiles.get(candidate.productId)?.key === tile.key);
    if (row) this.reveal(row.productId);
    else this.add(tile);
  }

  /** The new card goes on top, in the unit the customer orders in; the browser folds away. */
  private add(tile: PalletBrowserTile): void {
    const product = tile.lead;
    const id = product.id;
    if (id === null || this.full()) return;
    const unit = startUnit(effectiveOrderStep(product), productUnits(product), productSalesUnit(product).isDisplay);
    this.rows.update((rows) => {
      const used = new Set(rows.map((row) => row.slot % PALLET_PRODUCT_COLOURS.length));
      const slot = PALLET_PRODUCT_COLOURS.findIndex((_, index) => !used.has(index));
      return [{ productId: id, quantity: null, unit, slot: slot < 0 ? rows.length : slot }, ...rows];
    });
    this.recentIds.update((ids) => rememberRecent(ids, id, MAX_RECENT));
    this.browserOpen.set(false);
    this.query.set('');
    this.entering.set(id);
    this.hostBridge.haptic('selection');
    this.status.set(`${[tile.name, tile.label].filter(Boolean).join(' · ')} toegevoegd`);
    afterNextRender(() => this.card(id)?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() }), { injector: this.injector });
  }

  /** A tile already in the calculation: the browser folds and its card comes to the centre with a short ring. */
  private reveal(productId: number): void {
    this.browserOpen.set(false);
    this.query.set('');
    /* The ring replaces the card's animation; a rise class left on it would replay when the ring ends. */
    this.entering.set(null);
    this.flash.set(null);
    clearTimeout(this.flashTimer);
    afterNextRender(() => {
      this.card(productId)?.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
      this.flash.set(productId);
      this.flashTimer = setTimeout(() => this.flash.set(null), 900);
    }, { injector: this.injector });
  }

  remove(line: CalcLine): void {
    const rows = this.rows();
    const index = rows.findIndex((row) => row.productId === line.row.productId);
    if (index < 0) return;
    const row = rows[index];
    this.rows.set(rows.filter((_, at) => at !== index));
    this.status.set('');
    /* The last card gone: the browser fills the page again, as on an empty start. */
    if (rows.length === 1) this.browserOpen.set(true);
    this.ui.toast(`${line.title} verwijderd`, 'ok', {
      label: 'Ongedaan maken',
      run: () => {
        const restored = withRow(this.rows(), row, index);
        if (!restored) return;
        if (!this.rows().length) this.browserOpen.set(false);
        this.rows.set(restored);
      },
    });
  }

  /** Wissen: every card goes, the browser opens on its first chip; Ongedaan maken brings the cards back. */
  clear(): void {
    const rows = this.rows();
    if (!rows.length) return;
    this.rows.set([]);
    this.browser()?.reset();
    this.query.set('');
    this.browserOpen.set(true);
    this.status.set('');
    this.ui.toast('Berekening gewist', 'ok', {
      label: 'Ongedaan maken',
      run: () => {
        let restored = this.rows();
        rows.forEach((row, index) => { restored = withRow(restored, row, index) ?? restored; });
        this.rows.set(restored);
        if (restored.length) this.browserOpen.set(false);
      },
    });
  }

  /** Enter in the desk search adds the first match. */
  searchEnter(event: Event): void {
    event.preventDefault();
    this.browser()?.chooseFirst();
  }

  /** Esc clears the search first; a second Esc leaves the field. */
  searchEscape(event: Event): void {
    if (!this.query()) { (event.target as HTMLElement).blur(); return; }
    event.preventDefault();
    this.query.set('');
  }

  toSummary(): void {
    this.summary()?.nativeElement.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
  }

  setHeight(value: number): void {
    this.pickedHeight.set(clampPalletHeight(value, this.profile()));
  }

  /** A typed height within the bounds; anything unreadable shows the height that stays. */
  typeHeight(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value.replace(',', '.'));
    if (Number.isFinite(value) && value > 0) this.setHeight(value);
    input.value = String(this.maxHeight());
  }

  setQuantity(line: CalcLine, event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 7);
    if (input.value !== digits) input.value = digits;
    this.patch(line.row.productId, { quantity: digits ? Number(digits) : null });
  }

  /** One omdoos more or less, written in the chosen unit. */
  step(line: CalcLine, direction: 1 | -1): void {
    const per = unitsPerCarton(line.unit, line.units) ?? 1;
    const cartons = Math.max(0, line.cartons + direction);
    this.patch(line.row.productId, { quantity: cartons ? cartons * per : null, unit: line.unit });
  }

  /** Another unit keeps the same omdozen. */
  setUnit(line: CalcLine, unit: CalcUnit): void {
    const per = unitsPerCarton(unit, line.units);
    if (!per) return;
    this.patch(line.row.productId, { unit, quantity: line.cartons ? line.cartons * per : line.row.quantity === null ? null : 0 });
  }

  addCartons(line: CalcLine, cartons: number): void {
    const per = unitsPerCarton(line.unit, line.units) ?? 1;
    this.patch(line.row.productId, { quantity: (line.cartons + cartons) * per, unit: line.unit });
  }

  /** One pallet shared out by layers; the quantities become whole omdozen. */
  share(): void {
    const shared = shareOnePallet(this.lines().map((line) => line.plan), this.pallet());
    this.rows.update((rows) => rows.map((row) => shared.has(row.productId)
      ? { ...row, unit: 'carton', quantity: shared.get(row.productId) || null } : row));
  }

  text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  blur(event: Event): void {
    (event.target as HTMLInputElement).blur();
  }

  cm(value: number): string {
    return cm(value);
  }

  cell(cartons: number, per: number): string {
    return cartons > 0 ? (cartons * per).toLocaleString('nl-BE') : '–';
  }

  cartonsText(cartons: number): string {
    return count(cartons, 'omdoos', 'omdozen');
  }

  colourNames(colours: readonly PalletBrowserColour[]): string {
    return colours.map((colour) => colour.name).join(', ');
  }

  /** "96 displays · 576 stuks" for a number of omdozen. */
  unitsLine(line: CalcLine, cartons: number): string | null {
    const parts: string[] = [];
    if (line.units.displaysPerCarton) parts.push(count(cartons * line.units.displaysPerCarton, 'display', 'displays'));
    if (line.units.piecesPerCarton) {
      const piece = productSalesUnit(line.product).piece;
      parts.push(count(cartons * line.units.piecesPerCarton, piece.one, piece.other));
    }
    return parts.length ? parts.join(' · ') : null;
  }

  fitFacts(fit: PalletFit, weightKg: number): string {
    const facts = [`${fit.perLayer} per laag × ${fit.layers} ${fit.layers === 1 ? 'laag' : 'lagen'}`, `${Math.round(fit.heightCm)} cm`];
    if (weightKg > 0) facts.push(`${Math.round(weightKg).toLocaleString('nl-BE')} kg`);
    if (fit.limitedBy === 'gewicht') facts.push('gewicht bepaalt');
    return facts.join(' · ');
  }

  /** The rounding to whole omdozen, or the omdozen in the other units. */
  quantityNote(line: CalcLine): string | null {
    if (!line.cartons) return null;
    if (line.unit === 'carton') {
      const units = this.unitsLine(line, line.cartons);
      return units ? `= ${units}` : null;
    }
    const per = unitsPerCarton(line.unit, line.units) ?? 1;
    const exact = (line.row.quantity ?? 0) === line.cartons * per;
    const units = this.unitsLine(line, line.cartons);
    return `${exact ? '=' : 'Afgerond:'} ${this.cartonsText(line.cartons)}${!exact && units ? ` (${units})` : ''}`;
  }

  /** The omdozen, displays and pieces of the plan; the pieces in their own word when every product shares it. */
  totalsLine(): string {
    const totals = this.totals();
    const parts = [this.cartonsText(totals.cartons)];
    if (totals.displays !== null) parts.push(count(totals.displays, 'display', 'displays'));
    if (totals.pieces !== null) {
      const words = new Map(this.lines().filter((line) => line.cartons && line.units.piecesPerCarton)
        .map((line) => { const piece = productSalesUnit(line.product).piece; return [piece.key, piece] as const; }));
      const piece = words.size === 1 ? [...words.values()][0] : { one: 'stuk', other: 'stuks' };
      parts.push(count(totals.pieces, piece.one, piece.other));
    }
    return parts.join(' · ');
  }

  palletsText(): string {
    if (this.tooMany()) return `Meer dan ${MAX_PLANNED_PALLETS} pallets`;
    const pallets = this.plan().length;
    return pallets === 0 ? 'Past niet' : count(pallets, 'pallet', 'pallets');
  }

  /** "vol", "72 % vol" for one pallet, "laatste 72 %" for more. */
  lastFill(): string | null {
    const plan = this.plan();
    const last = plan.at(-1);
    if (!last) return null;
    if (last.full) return 'vol';
    const pct = `${Math.round(last.fill * 100)} %`;
    return plan.length === 1 ? `${pct} vol` : `laatste ${pct}`;
  }

  groupTitle(group: PalletGroup): string {
    const name = group.from === group.to ? `Pallet ${group.from}` : `Pallet ${group.from}–${group.to}`;
    return `${name} · ${group.full ? 'vol' : `${Math.round(group.fill * 100)} %`}`;
  }

  barWidth(share: number): number {
    const rest = share - Math.floor(share - 1e-9);
    return Math.round(Math.min(1, share > 0 ? rest : 0) * 100);
  }

  /* ------------------------------------------------------------ the facts sheet */

  cartonSize(line: CalcLine): string {
    const { lengthCm, widthCm, heightCm } = line.product.carton;
    return lengthCm && widthCm && heightCm ? `${cm(lengthCm)} × ${cm(widthCm)} × ${cm(heightCm)} cm` : 'Maten ontbreken';
  }

  /** "24 stolpen", "12 displays · 144 bowls". */
  contents(line: CalcLine): string {
    return line.units.perCarton === null ? 'Doosinhoud ontbreekt' : this.unitsLine(line, 1) ?? 'Doosinhoud ontbreekt';
  }

  /** "Geteld: 40ft, 40ft HC" and "Op volume: 20ft". */
  containerSources(line: CalcLine): string[] {
    const counted = line.containers.filter((entry) => entry.capacity?.counted).map((entry) => entry.container.label);
    const volume = line.containers.filter((entry) => entry.capacity && !entry.capacity.counted).map((entry) => entry.container.label);
    const texts = [...(counted.length ? [`Geteld: ${counted.join(', ')}`] : []), ...(volume.length ? [`Op volume: ${volume.join(', ')}`] : [])];
    return texts.length ? texts : ['Maten ontbreken'];
  }

  /** "Klant bestelt per": Omdoos, Display or the piece word. */
  orderUnit(product: Product): string {
    const step = effectiveOrderStep(product);
    return step === 'CARTON' ? 'Omdoos' : step === 'PACKAGE' ? 'Display' : capitalize(productSalesUnit(product).singular);
  }

  dotOf(line: CalcLine, variant: Product): string | null {
    return line.colours.find((colour) => collator.compare(colour.name, variant.colour?.trim() ?? '') === 0)?.hex ?? null;
  }

  private card(productId: number): HTMLElement | null {
    return this.element.nativeElement.querySelector<HTMLElement>(`.pc-card[data-row="${productId}"]`);
  }

  private patch(productId: number, change: Partial<CalcRow>): void {
    this.rows.update((rows) => rows.map((row) => (row.productId === productId ? { ...row, ...change } : row)));
  }

  private line(row: CalcRow, product: Product, tile: PalletBrowserTile | null, twin: boolean, pallet: ReturnType<typeof palletSpec>): CalcLine {
    const units = productUnits(product);
    const piece = productSalesUnit(product).piece;
    const unitOptions: SegmentOption[] = [{ id: 'carton', label: 'Omdoos' }];
    if (units.displaysPerCarton) unitOptions.push({ id: 'display', label: 'Display' });
    if (units.piecesPerCarton) unitOptions.push({ id: 'piece', label: capitalize(piece.one) });
    const unit = unitOptions.some((option) => option.id === row.unit) ? row.unit : 'carton';
    const carton = product.carton;
    const fit = palletFit(carton, pallet);
    const cartons = cartonsFor(row.quantity, unit, units);
    const weightKg = carton.weightKg && carton.weightKg > 0 ? carton.weightKg : 0;
    const problem = fit.problem ? PROBLEMS[fit.problem] ?? fit.problem : units.perCarton === null ? 'Doosinhoud ontbreekt' : null;
    const colour = product.colour?.trim() || null;
    return {
      row, product, tile, unit, units, fit, cartons, weightKg, problem, unitOptions,
      title: [tile?.name ?? product.name, tile?.label, twin ? colour : null].filter(Boolean).join(' · '),
      colours: tile?.colours ?? (colour ? [{ name: colour, hex: product.colourHex }] : []),
      colour: PALLET_PRODUCT_COLOURS[row.slot % PALLET_PRODUCT_COLOURS.length],
      photo: tile?.photo ?? salesPhotoUrl(product),
      pieceLabel: capitalize(piece.other),
      containers: CONTAINERS.map((container) => ({ container, capacity: containerCapacity(product, units, container) })),
      plan: { key: product.id as number, cartons, fit, cartonHeightCm: carton.heightCm ?? 0, cartonWeightKg: weightKg },
      cbm: (product.cartonCbm && product.cartonCbm > 0 ? product.cartonCbm : null) ?? cartonCbm(carton),
    };
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as { profile?: unknown; heightCm?: unknown; standardCm?: unknown; rows?: unknown; recent?: unknown };
      const profile = PALLET_CHOICES.find((choice) => choice.id === stored.profile);
      if (profile) this.profile.set(profile.id);
      /* A height equal to the standard it was saved under was never picked: the device follows today's
         standard. A state without standardCm was saved while the standard was 220 cm (7-10 November 2026);
         a 220 picked on purpose in those days cannot be told from it and follows too. */
      const savedUnder = typeof stored.standardCm === 'number' ? stored.standardCm : PALLET_FORMER_STANDARD_CM;
      if (typeof stored.heightCm === 'number' && stored.heightCm !== savedUnder) {
        this.pickedHeight.set(clampPalletHeight(stored.heightCm, this.profile()));
      }
      if (Array.isArray(stored.rows)) {
        const seen = new Set<number>();
        this.rows.set(stored.rows.filter(storedRow).filter((row) => !seen.has(row.productId) && !!seen.add(row.productId)).slice(0, MAX_ROWS));
      }
      if (Array.isArray(stored.recent)) {
        this.recentIds.set([...new Set(stored.recent.filter((id): id is number => Number.isSafeInteger(id)))].slice(0, MAX_RECENT));
      }
      this.browserOpen.set(!this.rows().length);
    } catch { /* private mode or an older shape: start empty */ }
  }
}
