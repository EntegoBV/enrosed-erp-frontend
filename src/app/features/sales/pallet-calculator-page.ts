import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthImage } from '../../core/api/auth-image';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import type { PalletProfile, Product } from '../../core/api/models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Icon } from '../../shared/icon';
import { LoadError } from '../../shared/load-error';
import { PageHeader } from '../../shared/page-header';
import { CbmPipe, NumPipe } from '../../shared/pipes';
import { filterProductPicker } from '../../shared/product-picker-filters';
import { salesPhotoUrl } from '../../shared/sales-photo';
import { Segmented, type SegmentOption } from '../../shared/segmented';
import { Skeleton } from '../../shared/skeleton';
import { capitalize, productSalesUnit } from '../products/product-sales-unit';
import { PALLET_PRODUCT_COLOURS } from './pallet-stack';
import {
  CONTAINERS, MAX_PLANNED_PALLETS, PALLET_CHOICES, PALLET_MAX_HEIGHT_CM, cartonCbm, cartonsFor, clampPalletHeight,
  containerCapacity, containerFill, palletFit, palletSpec, planPallets, productUnits, roomWithoutExtraPallet,
  separatePallets, shareOnePallet, unitsPerCarton,
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
  colour: string;
  photo: string | null;
  facts: string;
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
const collator = new Intl.Collator('nl-BE', { numeric: true, sensitivity: 'base' });

const PROBLEMS: Readonly<Record<string, string>> = {
  'afmetingen ontbreken': 'Omdoosmaten ontbreken',
  'doos past niet op de pallet': 'Omdoos te groot voor deze pallet',
  'te hoog of te zwaar': 'Omdoos te hoog of te zwaar',
};

function cm(value: number): string {
  return value.toLocaleString('nl-BE', { maximumFractionDigits: 1 });
}

function storedRow(value: unknown): value is CalcRow {
  const row = value as Partial<CalcRow> | null;
  return !!row && Number.isSafeInteger(row.productId) && UNITS.includes(row.unit as CalcUnit)
    && (row.quantity === null || (Number.isSafeInteger(row.quantity) && (row.quantity as number) >= 0))
    && Number.isSafeInteger(row.slot) && (row.slot as number) >= 0;
}

/**
 * Palletberekening (Verkoop): what fits on a pallet and in a 20ft or 40ft
 * container, for one product or a mix, counted in omdozen, displays and
 * pieces. Built for the fair: search, tap, read. Nothing is saved on the
 * server; the picks stay on this device until they are wiped. The numbers
 * come from pallet-calculator-model.ts (the backend's pallet rules).
 */
@Component({
  selector: 'app-pallet-calculator-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, CbmPipe, Icon, LoadError, NumPipe, PageHeader, RouterLink, Segmented, Skeleton],
  template: `
    <app-page-header title="Palletberekening" subtitle="Pallet, 20ft en 40ft">
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
          <label class="pc-search">
            <span class="sr-only">Product zoeken</span>
            <app-icon name="search" [size]="18" />
            <input class="input" type="search" inputmode="search" enterkeyhint="search" autocomplete="off"
                   placeholder="Zoek product, kleur, SKU of barcode" [value]="query()" [disabled]="!products()"
                   (input)="query.set(text($event))" (keydown.enter)="addFirst($event)" (keydown.escape)="query.set('')" />
          </label>
          @if (query().trim() && products()) {
            <ul class="pc-results" aria-label="Zoekresultaten">
              @if (full()) { <li class="pc-results__none">Maximaal {{ maxRows }} producten: verwijder er eerst een.</li> }
              @for (product of results(); track product.id) {
                <li>
                  <button class="pc-result" type="button" (click)="add(product)" [disabled]="added().has(product.id!) || full()">
                    @if (photoOf(product); as photo) { <img class="pc-thumb" [appAuthSrc]="photo" alt="" /> }
                    @else { <span class="pc-thumb pc-thumb--none"><app-icon name="products" [size]="18" /></span> }
                    <span class="pc-result__text"><b>{{ product.name }}</b><small>{{ identity(product) }}</small></span>
                    <span class="pc-result__add" aria-hidden="true"><app-icon [name]="added().has(product.id!) ? 'tick' : 'plus'" [size]="16" /></span>
                  </button>
                </li>
              } @empty {
                <li class="pc-results__none">Geen product gevonden</li>
              }
            </ul>
          }
        </div>

        <aside class="pc-side" aria-label="Resultaat">
          <section class="pc-panel pc-set" aria-label="Pallet">
            <app-segmented label="Pallettype" [variant]="segVariant()" [options]="palletOptions" [value]="profile()"
                           (changed)="profile.set($any($event))" />
            <div class="pc-set__row">
              <span class="pc-set__label" id="pc-height-label">Max. hoogte</span>
              <div class="pc-step" role="group" aria-labelledby="pc-height-label">
                <button type="button" (click)="setHeight(maxHeight() - 10)" aria-label="10 cm lager">−</button>
                <input type="text" inputmode="numeric" aria-labelledby="pc-height-label" [value]="maxHeight()"
                       (change)="typeHeight($event)" (keydown.enter)="blur($event)" />
                <button type="button" (click)="setHeight(maxHeight() + 10)" aria-label="10 cm hoger">+</button>
              </div>
              <span class="pc-set__hint">cm · max {{ pallet().maxWeightKg | num }} kg</span>
            </div>
          </section>

          <section class="pc-panel pc-sum" aria-live="polite">
            <p class="pc-eyebrow">{{ palletLabel() }}</p>
            @switch (summaryKind()) {
              @case ('empty') {
                @if (loading() && !products()) { <app-skeleton kind="lines" [rows]="2" /> }
                @else {
                  <h2 class="pc-sum__title">Wat past erop?</h2>
                  <p class="pc-sum__facts">Zoek een product om te beginnen.</p>
                }
              }
              @case ('capacity') {
                @if (lines()[0]; as line) {
                  @if (line.fit.cartonsPerPallet > 0) {
                    <h2 class="pc-sum__title">{{ line.fit.cartonsPerPallet | num }} omdozen <small>per pallet</small></h2>
                    @if (unitsLine(line, line.fit.cartonsPerPallet); as units) { <p class="pc-sum__units">{{ units }}</p> }
                    <p class="pc-sum__facts">{{ fitFacts(line.fit, line.fit.cartonsPerPallet * line.weightKg) }}</p>
                  } @else {
                    <h2 class="pc-sum__title">Past niet</h2>
                    <p class="pc-sum__facts pc-warn">{{ line.problem }}</p>
                  }
                }
              }
              @case ('choose') {
                <h2 class="pc-sum__title">Gemengde pallet</h2>
                @if (canShare()) {
                  <p class="pc-sum__facts">Verdeel één pallet of vul aantallen in.</p>
                  <button class="btn btn--primary btn--sm pc-sum__action" type="button" (click)="share()">
                    <app-icon name="layers" [size]="16" /><span>Verdeel 1 pallet</span>
                  </button>
                } @else {
                  <p class="pc-sum__facts pc-warn">Geen van deze omdozen past op deze pallet.</p>
                }
              }
              @case ('plan') {
                <h2 class="pc-sum__title">
                  @if (tooMany()) { Meer dan {{ maxPallets }} pallets }
                  @else if (plan().length === 0) { Past niet }
                  @else { {{ plan().length }} {{ plan().length === 1 ? 'pallet' : 'pallets' }} }
                  @if (lastFill(); as fill) { <small>{{ fill }}</small> }
                </h2>
                <p class="pc-sum__units">{{ totalsLine() }}</p>
                @if (totals().cbm > 0 || totals().weightKg > 0) {
                  <p class="pc-sum__facts">
                    @if (totals().cbm > 0) { {{ totals().cbm | cbm: 2 }} }
                    @if (totals().cbm > 0 && totals().weightKg > 0) { · }
                    @if (totals().weightKg > 0) { {{ totals().weightKg | num }} kg }
                  </p>
                }
                @for (line of unplaced(); track line.product.id) {
                  <p class="pc-sum__facts pc-warn">{{ line.product.name }}: {{ line.problem }}</p>
                }
                @if (palletGroups().length) {
                  <ol class="pc-pallets" aria-label="Pallets">
                    @for (group of palletGroups(); track group.from) {
                      <li class="pc-pallet">
                        <span class="pc-stack" aria-hidden="true">
                          @for (block of group.blocks; track $index) { <i [style.height.%]="block.pct" [style.background]="block.colour"></i> }
                        </span>
                        <span class="pc-pallet__text">
                          <b>{{ groupTitle(group) }}</b>
                          <small>{{ groupParts(group) }} · {{ group.heightCm | num }} cm · {{ group.weightKg | num }} kg</small>
                        </span>
                      </li>
                    }
                  </ol>
                }
                @if (room().length) {
                  <div class="pc-room">
                    <h3>Past nog bij, zonder extra pallet</h3>
                    @for (entry of room(); track entry.line.product.id) {
                      <div class="pc-room__row">
                        <i class="pc-dot" [style.background]="entry.line.colour" aria-hidden="true"></i>
                        <span>{{ entry.line.product.name }}</span>
                        <button class="btn btn--sm" type="button" (click)="addCartons(entry.line, entry.cartons)"
                                [attr.aria-label]="'Voeg ' + entry.cartons + ' omdozen ' + entry.line.product.name + ' toe'">
                          + {{ entry.cartons | num }} {{ entry.cartons === 1 ? 'omdoos' : 'omdozen' }}
                        </button>
                      </div>
                    }
                  </div>
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
                @if (canShare()) {
                  <button class="btn btn--sm pc-sum__action" type="button" (click)="share()">
                    <app-icon name="layers" [size]="16" /><span>Verdeel 1 pallet</span>
                  </button>
                }
              }
            }
          </section>
        </aside>

        <div class="pc-list">
          @for (line of lines(); track line.product.id) {
            <article class="pc-card" [style.--pc-colour]="line.colour" [attr.aria-label]="line.product.name">
              <header class="pc-card__head">
                @if (line.photo; as photo) { <img class="pc-thumb" [appAuthSrc]="photo" appAuthLazy alt="" /> }
                @else { <span class="pc-thumb pc-thumb--none"><app-icon name="products" [size]="18" /></span> }
                <div class="pc-card__title">
                  <h3><i class="pc-dot" [style.background]="line.colour" aria-hidden="true"></i>{{ line.product.name }}</h3>
                  <p>{{ line.facts }}</p>
                </div>
                <button class="pc-x" type="button" (click)="remove(line.product.id!)" [attr.aria-label]="'Verwijder ' + line.product.name">
                  <app-icon name="close" [size]="16" />
                </button>
              </header>
              @if (perCartonLine(line); as per) { <p class="pc-per">{{ per }}</p> }
              @if (line.problem) {
                <p class="pc-warn pc-problem">{{ line.problem }} · <a [routerLink]="['/products', line.product.id, 'edit']">Product aanvullen</a></p>
              }
              <table class="pc-table">
                <thead>
                  <tr>
                    <th scope="col"><span class="sr-only">Laadruimte</span></th>
                    <th scope="col">Omdozen</th>
                    @if (line.units.displaysPerCarton) { <th scope="col">Displays</th> }
                    @if (line.units.piecesPerCarton) { <th scope="col">{{ line.pieceLabel }}</th> }
                  </tr>
                </thead>
                <tbody>
                  <tr class="pc-table__pallet">
                    <th scope="row">Pallet</th>
                    <td>{{ cell(line.fit.cartonsPerPallet, 1) }}</td>
                    @if (line.units.displaysPerCarton; as per) { <td>{{ cell(line.fit.cartonsPerPallet, per) }}</td> }
                    @if (line.units.piecesPerCarton; as per) { <td>{{ cell(line.fit.cartonsPerPallet, per) }}</td> }
                  </tr>
                  @for (entry of line.containers; track entry.container.id) {
                    <tr>
                      <th scope="row">{{ entry.container.label }}@if (entry.capacity?.counted) { <small title="Bevestigd aantal van het product">geteld</small> }</th>
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
              <div class="pc-qty">
                <div class="pc-step" role="group" [attr.aria-label]="'Aantal ' + line.product.name">
                  <button type="button" (click)="step(line, -1)" [disabled]="!line.cartons" aria-label="Eén omdoos minder">−</button>
                  <input type="text" inputmode="numeric" placeholder="0" [attr.aria-label]="'Aantal ' + line.product.name"
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
            </article>
          } @empty {
            @if (products()) {
              <div class="pc-empty">
                <app-icon name="pallet" [size]="28" />
                <p>Zoek een product: je ziet meteen hoeveel omdozen, displays en stuks er op een pallet en in een container gaan.</p>
              </div>
            } @else if (loading()) {
              <div class="pc-panel"><app-skeleton kind="list" [rows]="3" /></div>
            }
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host{display:block}
    .pc{max-width:1240px;container:pc / inline-size}
    .pc-gap{margin-bottom:14px}
    .pc-grid{display:grid;gap:14px;grid-template-columns:minmax(0,1fr);grid-template-areas:"find" "side" "list"}
    .pc-find{grid-area:find;min-width:0}
    .pc-side{grid-area:side;min-width:0;display:flex;flex-direction:column;gap:12px}
    .pc-list{grid-area:list;min-width:0;display:flex;flex-direction:column;gap:12px}
    @container pc (min-width: 760px){
      .pc-grid{grid-template-columns:minmax(0,1fr) minmax(280px,340px);grid-template-rows:auto 1fr;grid-template-areas:"find side" "list side";align-items:start}
      .pc-side{position:sticky;top:calc(var(--appbar-h, 52px) + 14px)}
    }
    .pc-panel{border:1px solid var(--line);border-radius:18px;background:var(--surface);padding:16px 18px}
    .pc-search{position:relative;display:block}
    .pc-search app-icon{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none;display:flex}
    .pc-search .input{padding-left:42px;border-radius:999px}
    .pc-results{list-style:none;margin:8px 0 0;padding:6px;border:1px solid var(--line);border-radius:16px;background:var(--surface);display:flex;flex-direction:column;gap:2px;box-shadow:0 12px 30px rgb(26 22 20 / 8%)}
    .pc-result{display:flex;align-items:center;gap:12px;width:100%;min-height:56px;padding:6px 8px;border:0;border-radius:12px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
    .pc-result:hover:not(:disabled){background:var(--surface-2)}.pc-result:disabled{cursor:default;opacity:.55}
    .pc-result__text{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
    .pc-result__text b,.pc-result__text small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pc-result__text b{font-size:14px;font-weight:600}.pc-result__text small{font-size:12px;color:var(--muted)}
    .pc-result__add{flex:none;display:grid;place-items:center;width:32px;height:32px;border-radius:999px;background:var(--rose-soft);color:var(--rose-dark)}
    .pc-results__none{padding:14px 10px;font-size:13px;color:var(--muted)}
    .pc-thumb{flex:none;width:44px;height:44px;border-radius:10px;object-fit:cover;background:var(--surface-2)}
    .pc-thumb--none{display:grid;place-items:center;color:var(--muted)}
    .pc-set{display:flex;flex-direction:column;gap:12px}
    .pc-set__row{display:flex;align-items:center;flex-wrap:wrap;gap:8px 10px}
    .pc-set__label{font-size:13px;font-weight:600}.pc-set__hint{font-size:12px;color:var(--muted)}
    .pc-step{display:inline-flex;align-items:center;border:1px solid var(--line-strong);border-radius:999px;background:var(--surface);overflow:hidden}
    .pc-step:focus-within{border-color:var(--rose-mid);box-shadow:0 0 0 3px rgb(209 74 103 / 14%)}
    .pc-step button{display:grid;place-items:center;width:42px;height:42px;border:0;background:none;color:var(--ink);font-size:20px;line-height:1;cursor:pointer;-webkit-tap-highlight-color:transparent}
    .pc-step button:active:not(:disabled){background:var(--surface-2)}.pc-step button:disabled{opacity:.35;cursor:default}
    .pc-step input{width:64px;height:42px;border:0;padding:0;background:none;color:var(--ink);text-align:center;font-size:16px;font-weight:700;font-variant-numeric:tabular-nums}
    .pc-step input:focus{outline:none}
    .pc-eyebrow{margin:0 0 6px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:700}
    .pc-sum__title{margin:0;font-size:26px;line-height:1.15;font-weight:800;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
    .pc-sum__title small{margin-left:4px;font-size:15px;font-weight:600;letter-spacing:0;color:var(--muted)}
    .pc-sum__units{margin:6px 0 0;font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}
    .pc-sum__facts{margin:4px 0 0;font-size:13px;line-height:1.5;color:var(--muted)}
    .pc-sum__action{margin-top:14px}
    .pc-warn{color:var(--danger)}
    .pc-pallets{list-style:none;margin:14px 0 0;padding:12px 0 0;border-top:1px solid var(--line);display:flex;flex-direction:column;gap:10px}
    .pc-pallet{display:flex;align-items:center;gap:12px}
    .pc-stack{flex:none;width:30px;height:46px;display:flex;flex-direction:column-reverse;overflow:hidden;border-radius:4px 4px 1px 1px;background:var(--surface-2);border-bottom:4px solid color-mix(in srgb,#a87b4f 85%,var(--surface))}
    .pc-stack i{display:block;flex:none;box-shadow:inset 0 1px 0 rgb(255 255 255 / 35%)}
    .pc-pallet__text{flex:1;min-width:0}
    .pc-pallet__text b{display:block;font-size:14px;font-weight:700}
    .pc-pallet__text small{display:block;font-size:12px;line-height:1.45;color:var(--muted);overflow-wrap:anywhere}
    .pc-room{margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}
    .pc-room h3,.pc-cont__tile span{margin:0;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
    .pc-room h3{margin-bottom:4px}
    .pc-room__row{display:flex;align-items:center;gap:10px;min-height:44px}
    .pc-room__row span{flex:1;min-width:0;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pc-room__row .btn{flex:none}
    .pc-dot{display:inline-block;flex:none;width:9px;height:9px;border-radius:999px;margin-right:7px;vertical-align:1px}
    .pc-room__row .pc-dot{margin-right:0}
    .pc-cont{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:14px}
    .pc-cont__tile{display:flex;flex-direction:column;min-width:0;padding:9px 10px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}
    .pc-cont__tile b{font-size:17px;font-weight:800;font-variant-numeric:tabular-nums}
    .pc-cont__tile small{font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pc-cont__bar{display:block;height:4px;margin-top:6px;border-radius:999px;background:var(--line);overflow:hidden}
    .pc-cont__bar i{display:block;height:100%;border-radius:inherit;background:var(--rose)}
    .pc-card{display:flex;flex-direction:column;gap:10px;padding:14px 16px;border:1px solid var(--line);border-radius:18px;background:var(--surface);box-shadow:inset 4px 0 var(--pc-colour)}
    .pc-card__head{display:flex;align-items:center;gap:12px}
    .pc-card__title{flex:1;min-width:0}
    .pc-card__title h3{margin:0;font-size:15px;font-weight:700;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pc-card__title p{margin:2px 0 0;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pc-x{flex:none;display:grid;place-items:center;width:36px;height:36px;border:0;border-radius:999px;background:var(--surface-2);color:var(--muted);cursor:pointer}
    .pc-per{margin:0;font-size:13px;font-weight:600;color:var(--ink-2)}
    .pc-problem{margin:0;font-size:13px;font-weight:600}.pc-problem a{color:inherit}
    .pc-table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
    .pc-table th,.pc-table td{padding:7px 0 7px 8px;border-top:1px solid var(--line);font-size:14px;text-align:right;white-space:nowrap}
    .pc-table th:first-child{padding-left:0;text-align:left}
    .pc-table thead th{border-top:0;padding-top:0;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
    .pc-table tbody th{font-weight:600;color:var(--ink-2)}
    .pc-table tbody th small{margin-left:6px;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
    .pc-table__pallet td{font-size:16px;font-weight:800;color:var(--ink)}
    .pc-fit{margin:-2px 0 0;font-size:12px;color:var(--muted)}
    .pc-qty{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;padding-top:2px}
    .pc-qty app-segmented{flex:1 1 180px;min-width:0}
    .pc-qty__unit{font-size:13px;color:var(--muted)}
    .pc-qty__note{margin:-2px 0 0;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
    .pc-empty{display:flex;flex-direction:column;align-items:center;gap:10px;padding:34px 18px;border:1px dashed var(--line-strong);border-radius:18px;color:var(--muted);text-align:center}
    .pc-empty p{margin:0;max-width:36ch;font-size:14px;line-height:1.5}
    .pc :is(button,a,input):focus-visible{outline:2px solid var(--rose);outline-offset:2px}
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){
      .pc{padding-top:12px}.pc-desk-label{display:none}
      .pc-sum__title{font-size:23px}.pc-panel{padding:15px 16px}.pc-card{padding:13px 14px}
      .pc-step button{width:44px;height:44px}.pc-step input{height:44px}
    }
  `],
})
export class PalletCalculatorPage {
  private readonly catalog = inject(CatalogApi);
  private readonly desktop = inject(DesktopViewport);
  private readonly destroyRef = inject(DestroyRef);

  readonly products = signal<Product[] | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly query = signal('');
  readonly profile = signal<PalletProfile>('EURO_120X80');
  readonly maxHeight = signal(PALLET_MAX_HEIGHT_CM);
  readonly rows = signal<CalcRow[]>([]);
  readonly maxRows = MAX_ROWS;
  readonly maxPallets = MAX_PLANNED_PALLETS;

  readonly palletOptions: SegmentOption[] = PALLET_CHOICES.map((choice) =>
    ({ id: choice.id, label: `${choice.short} ${choice.size.replace(/ /g, '')}`, ariaLabel: `${choice.label} ${choice.size} cm` }));
  readonly segVariant = computed<'desk' | 'ios'>(() => (this.desktop.active() ? 'desk' : 'ios'));
  readonly pallet = computed(() => palletSpec(this.profile(), this.maxHeight()));
  readonly palletLabel = computed(() => {
    const choice = PALLET_CHOICES.find((candidate) => candidate.id === this.profile()) ?? PALLET_CHOICES[0];
    return `${choice.label} ${choice.size} · max ${this.maxHeight()} cm`;
  });

  private readonly byId = computed(() => new Map((this.products() ?? []).map((product) => [product.id as number, product])));
  readonly added = computed(() => new Set(this.rows().map((row) => row.productId)));
  readonly results = computed(() => filterProductPicker(this.products() ?? [], [],
    { query: this.query(), category: null, colour: null, limit: 8 }));

  readonly lines = computed<CalcLine[]>(() => {
    const products = this.byId();
    const pallet = this.pallet();
    return this.rows().flatMap((row) => {
      const product = products.get(row.productId);
      return product ? [this.line(row, product, pallet)] : [];
    });
  });

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
          name: lines.get(part.key)?.product.name ?? '', cartons: part.cartons, colour: lines.get(part.key)?.colour ?? '',
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

  constructor() {
    this.restore();
    effect(() => {
      const state = { profile: this.profile(), maxHeightCm: this.maxHeight(), rows: this.rows() };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* private mode: the picks live as long as the page */ }
    });
    void this.load();
  }

  async load(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    try {
      const [products] = await Promise.all([this.catalog.products(), this.catalog.unitNames().catch(() => [])]);
      if (this.destroyRef.destroyed) return;
      const usable = products
        .filter((product) => product.id !== null && product.active && !product.demo)
        .sort((left, right) => collator.compare(left.name, right.name) || collator.compare(left.colour ?? '', right.colour ?? ''));
      this.products.set(usable);
      const known = new Set(usable.map((product) => product.id));
      this.rows.update((rows) => rows.filter((row) => known.has(row.productId)));
      this.loadError.set(null);
    } catch (error) {
      if (!this.destroyRef.destroyed) this.loadError.set(messageOf(error, 'De producten konden niet worden opgehaald. Probeer opnieuw.'));
    } finally {
      if (!this.destroyRef.destroyed) this.loading.set(false);
    }
  }

  add(product: Product): void {
    const id = product.id;
    if (id === null || this.added().has(id) || this.full()) return;
    this.rows.update((rows) => {
      const used = new Set(rows.map((row) => row.slot % PALLET_PRODUCT_COLOURS.length));
      const slot = PALLET_PRODUCT_COLOURS.findIndex((_, index) => !used.has(index));
      return [...rows, { productId: id, quantity: null, unit: 'carton', slot: slot < 0 ? rows.length : slot }];
    });
    this.query.set('');
  }

  addFirst(event: Event): void {
    event.preventDefault();
    if (!this.query().trim()) return;
    const first = this.results().find((product) => product.id !== null && !this.added().has(product.id));
    if (first) this.add(first);
  }

  remove(productId: number): void {
    this.rows.update((rows) => rows.filter((row) => row.productId !== productId));
  }

  clear(): void {
    this.rows.set([]);
    this.query.set('');
  }

  setHeight(value: number): void {
    this.maxHeight.set(clampPalletHeight(value));
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
    this.patch(line.product.id!, { quantity: digits ? Number(digits) : null });
  }

  /** One omdoos more or less, written in the chosen unit. */
  step(line: CalcLine, direction: 1 | -1): void {
    const per = unitsPerCarton(line.unit, line.units) ?? 1;
    const cartons = Math.max(0, line.cartons + direction);
    this.patch(line.product.id!, { quantity: cartons ? cartons * per : null, unit: line.unit });
  }

  /** Another unit keeps the same omdozen. */
  setUnit(line: CalcLine, unit: CalcUnit): void {
    const per = unitsPerCarton(unit, line.units);
    if (!per) return;
    this.patch(line.product.id!, { unit, quantity: line.cartons ? line.cartons * per : line.row.quantity === null ? null : 0 });
  }

  addCartons(line: CalcLine, cartons: number): void {
    const per = unitsPerCarton(line.unit, line.units) ?? 1;
    this.patch(line.product.id!, { quantity: (line.cartons + cartons) * per, unit: line.unit });
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

  photoOf(product: Product): string | null {
    return salesPhotoUrl(product);
  }

  identity(product: Product): string {
    return [product.colour, product.variantSize, product.sku].filter(Boolean).join(' · ') || 'Zonder SKU';
  }

  cell(cartons: number, per: number): string {
    return cartons > 0 ? (cartons * per).toLocaleString('nl-BE') : '–';
  }

  /** "1 omdoos = 12 displays = 144 stuks". */
  perCartonLine(line: CalcLine): string | null {
    const { displaysPerCarton, piecesPerCarton } = line.units;
    const parts = ['1 omdoos'];
    if (displaysPerCarton) parts.push(`${displaysPerCarton.toLocaleString('nl-BE')} ${displaysPerCarton === 1 ? 'display' : 'displays'}`);
    if (piecesPerCarton) parts.push(`${piecesPerCarton.toLocaleString('nl-BE')} ${this.pieceWord(line, piecesPerCarton)}`);
    return parts.length > 1 ? parts.join(' = ') : null;
  }

  /** "96 displays · 576 stuks" for a number of omdozen. */
  unitsLine(line: CalcLine, cartons: number): string | null {
    const parts: string[] = [];
    if (line.units.displaysPerCarton) parts.push(`${(cartons * line.units.displaysPerCarton).toLocaleString('nl-BE')} displays`);
    if (line.units.piecesPerCarton) {
      const pieces = cartons * line.units.piecesPerCarton;
      parts.push(`${pieces.toLocaleString('nl-BE')} ${this.pieceWord(line, pieces)}`);
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
    const cartons = `${line.cartons.toLocaleString('nl-BE')} ${line.cartons === 1 ? 'omdoos' : 'omdozen'}`;
    if (line.unit === 'carton') {
      const units = this.unitsLine(line, line.cartons);
      return units ? `= ${units}` : null;
    }
    const per = unitsPerCarton(line.unit, line.units) ?? 1;
    const exact = (line.row.quantity ?? 0) === line.cartons * per;
    const units = this.unitsLine(line, line.cartons);
    return `${exact ? '=' : 'Afgerond:'} ${cartons}${!exact && units ? ` (${units})` : ''}`;
  }

  totalsLine(): string {
    const totals = this.totals();
    const parts = [`${totals.cartons.toLocaleString('nl-BE')} ${totals.cartons === 1 ? 'omdoos' : 'omdozen'}`];
    if (totals.displays !== null) parts.push(`${totals.displays.toLocaleString('nl-BE')} displays`);
    if (totals.pieces !== null) parts.push(`${totals.pieces.toLocaleString('nl-BE')} stuks`);
    return parts.join(' · ');
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

  groupParts(group: PalletGroup): string {
    if (group.parts.length === 1) {
      const part = group.parts[0];
      return `${part.name} · ${part.cartons.toLocaleString('nl-BE')} ${part.cartons === 1 ? 'omdoos' : 'omdozen'}`;
    }
    return group.parts.map((part) => `${part.name} ${part.cartons.toLocaleString('nl-BE')}`).join(' · ');
  }

  barWidth(share: number): number {
    const rest = share - Math.floor(share - 1e-9);
    return Math.round(Math.min(1, share > 0 ? rest : 0) * 100);
  }

  private patch(productId: number, change: Partial<CalcRow>): void {
    this.rows.update((rows) => rows.map((row) => (row.productId === productId ? { ...row, ...change } : row)));
  }

  private pieceWord(line: CalcLine, count: number): string {
    const piece = productSalesUnit(line.product).piece;
    return count === 1 ? piece.one : piece.other;
  }

  private line(row: CalcRow, product: Product, pallet: ReturnType<typeof palletSpec>): CalcLine {
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
    const size = carton.lengthCm && carton.widthCm && carton.heightCm
      ? `${cm(carton.lengthCm)} × ${cm(carton.widthCm)} × ${cm(carton.heightCm)} cm` : null;
    const problem = fit.problem ? PROBLEMS[fit.problem] ?? fit.problem : units.perCarton === null ? 'Doosinhoud ontbreekt' : null;
    return {
      row, product, unit, units, fit, cartons, weightKg, problem, unitOptions,
      colour: PALLET_PRODUCT_COLOURS[row.slot % PALLET_PRODUCT_COLOURS.length],
      photo: salesPhotoUrl(product),
      facts: [product.colour, product.sku, size, weightKg ? `${weightKg.toLocaleString('nl-BE')} kg` : null].filter(Boolean).join(' · '),
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
      const stored = JSON.parse(raw) as { profile?: unknown; maxHeightCm?: unknown; rows?: unknown };
      const profile = PALLET_CHOICES.find((choice) => choice.id === stored.profile);
      if (profile) this.profile.set(profile.id);
      if (typeof stored.maxHeightCm === 'number') this.maxHeight.set(clampPalletHeight(stored.maxHeightCm));
      if (Array.isArray(stored.rows)) {
        const seen = new Set<number>();
        this.rows.set(stored.rows.filter(storedRow).filter((row) => !seen.has(row.productId) && !!seen.add(row.productId)).slice(0, MAX_ROWS));
      }
    } catch { /* private mode or an older shape: start empty */ }
  }
}
