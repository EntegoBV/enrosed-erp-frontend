import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import type {
  Carrier, FreightPricingStrategy, LoadMode, OrderPallet, PalletProfile, PalletRule, SalesOrderView,
} from '../../core/api/models';
import { AuthImage } from '../../core/api/auth-image';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { ContextMenu, type ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { Icon } from '../../shared/icon';
import { scrollBehavior } from '../../shared/motion';
import { EurPipe } from '../../shared/pipes';
import { Segmented, type SegmentOption } from '../../shared/segmented';
import { Sheet, Ui } from '../../shared/ui';
import { PALLET_FORMER_STANDARD_CM, PALLET_MAX_HEIGHT_CM, clampPalletHeight, palletHeightLimit } from './pallet-calculator-model';
import { PalletGlyph } from './pallet-glyph';
import { PalletSheet } from './pallet-sheet';
import { automaticPallets, normalizeManualPalletType, palletTypeLabel } from './pallet-stack';
import { PlannerFreight } from './planner-freight';
import { PlannerLoad } from './planner-load';
import { PlannerPallet, omdozen } from './planner-pallet';
import {
  autoPallets, checkLayout, fillWords, freightStrategy, handPallets, layoutPill, mixedLayout, mixedRoom, palletCount,
  placements, plannerLines, plannerSpec, serverPallets, strategyLabel, type MixedLayout, type PlannerLine,
} from './shipping-planner-model';

export { normalizeManualPalletType } from './pallet-stack';

/**
 * The shipping fields added to an order by the logistics contract.
 * They deliberately remain separate from pricing and from the manual pallet
 * list: changing from pallets to loose cartons must not destroy warehouse work.
 */
export interface ShippingOrderPatch {
  loadMode?: LoadMode;
  palletProfile?: PalletProfile;
  maxPalletHeightCm?: number | null;
  freightPricingStrategy?: FreightPricingStrategy;
  freightRatePerCbmEur?: number | null;
  manualFreightEur?: number | null;
  freightCarrierId?: number | null;
  freightCarrierExtraEur?: number | null;
  freight?: 'BEREKEND' | 'TE_BEPALEN' | 'AANGEVULD';
  pallets?: OrderPallet[];
}

export type ShippingPalletAction =
  | { type: 'auto-layout' }
  | { type: 'add-pallet' }
  | { type: 'clear-layout' }
  | { type: 'move-pallet'; index: number; direction: -1 | 1 }
  | { type: 'reorder-pallet'; fromIndex: number; toIndex: number }
  | { type: 'remove-pallet'; index: number }
  | { type: 'rename-pallet'; index: number; label: string }
  | { type: 'set-pallet-type'; index: number; palletType: string }
  | { type: 'set-pallet-height'; index: number; heightCm: number | null }
  | { type: 'add-item'; palletIndex: number; productId: number }
  | { type: 'set-item-cartons'; palletIndex: number; productId: number; cartons: number };

const CBM = new Intl.NumberFormat('nl-BE', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/**
 * Transport & levering, shared by the phone editor's sheet and the desk's
 * wide sheet: the answer first (how many pallets, how full, the freight),
 * then the pallets one by one, the products and the freight.
 *
 * Automatisch is the backend's count and layout, which the freight follows:
 * under palletRule MIXED (new and concept documents) the products stack
 * together the way Palletberekening stacks them; under STRICT (documents
 * past concept, which keep their count) every product stands on pallets of
 * its own, and when mixing saves a pallet Palletberekening's mix is one tap
 * away. An older server sends no layout: its palletsStrict is laid out
 * here. Zelf indelen starts from the automatic pallets. The planner only
 * emits patches and pallet actions: the sales editor keeps its serial save
 * queue, and the backend stays the one that calculates fits, m³ and freight.
 *
 * Overlays (the pallet sheet, Lading, the menus) sit at the root of this
 * template, outside .sp-layout: its container query traps position:fixed.
 */
@Component({
  selector: 'app-shipping-planner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, ContextMenu, EurPipe, Icon, NgTemplateOutlet, PalletGlyph, PalletSheet, PlannerFreight, PlannerLoad,
    PlannerPallet, RouterLink, Segmented, Sheet],
  template: `
    <div class="sp">
      <section class="sp-hero" aria-label="Lading">
        <div class="sp-hero__answer">
          @if (!desk() && canEdit() && lines().length) {
            <button class="sp-hero__spec" type="button" aria-haspopup="dialog" aria-label="Lading aanpassen" (click)="loadOpen.set(true)">
              <span>{{ specText() }}</span><app-icon name="chevron-right" [size]="14" />
            </button>
          } @else {
            <p class="sp-hero__spec"><span>{{ specText() }}</span></p>
          }
          <h3 class="sp-hero__title">{{ heroTitle() }}@if (fill()) { <small>{{ fill() }}</small> }
            @if (heroPill(); as pill) { <span class="badge" [class]="'badge--' + pill.tone">{{ pill.text }}</span> }</h3>
          @if (lines().length) { <p class="sp-hero__facts">{{ factsText() }}</p> }
        </div>
        @if (!desk()) {
          <button class="sp-hero__freight" type="button" aria-label="Naar vracht" (click)="toFreight()">
            @if (pending()) { <b class="is-warn">later</b><small>te bepalen</small> }
            @else if (freightIssue()) { <b class="is-danger">nakijken</b><small>{{ strategyText() }}</small> }
            @else { <b>{{ view().priced.totals.freight | eur }}</b><small>{{ strategyText() }}</small> }
          </button>
        } @else if (showSwitch()) {
          <ng-container [ngTemplateOutlet]="modeSwitch" />
        }
      </section>
      @if (!desk() && showSwitch()) { <ng-container [ngTemplateOutlet]="modeSwitch" /> }
      @if (infoOpen() && showSwitch()) {
        @if (rule() === 'MIXED') {
          <p class="sp-caption" id="sp-caption">Automatisch zet elk product in eigen lagen en stapelt die samen op zo weinig mogelijk pallets; bij Zelf indelen kies jij wat waar staat en telt de vracht jouw pallets.</p>
        } @else {
          <p class="sp-caption" id="sp-caption">Automatisch zet elk product op eigen pallets en volgt de aantallen; bij Zelf indelen kies jij wat waar staat en telt de vracht jouw pallets.</p>
        }
      }
      @if (!lines().length) { <p class="sp-empty">Voeg producten toe: de pallets verschijnen hier vanzelf.</p> }

      <div class="sp-layout">
        <div class="sp-cols">
          <div class="sp-main">
            @if (problems().length) {
              <section class="sp-sec" aria-labelledby="sp-check">
                <div class="sp-sec__head"><h4 id="sp-check">Nakijken</h4></div>
                <div class="sp-group sp-prods">
                  @for (line of problems(); track line.productId) {
                    <div class="sp-prod" [style.--sp-colour]="line.colour">
                      <ng-container [ngTemplateOutlet]="thumb" [ngTemplateOutletContext]="{ $implicit: line }" />
                      <span class="sp-prod__name">{{ line.name }}</span>
                      <span class="sp-prod__sub">{{ line.problem }}</span>
                      <a class="sp-prod__trail sp-link" [routerLink]="['/products', line.productId, 'edit']">Aanvullen</a>
                    </div>
                  }
                </div>
              </section>
            }

            @if (palletsMode() && (manual() || autoShown())) {
              <section class="sp-sec" aria-labelledby="sp-pallets">
                <div class="sp-sec__head"><h4 id="sp-pallets">Pallets</h4>
                  @if (desk() && manual() && canEdit()) {
                    <button class="btn btn--sm" type="button" aria-label="Pallet toevoegen" (click)="addPallet()"><app-icon name="plus" [size]="14" />Pallet</button>
                  } @else { <span>{{ manual() ? handRows().length : autoCount() }}</span> }
                </div>
                @if (manual()) {
                  <div [class.sp-grid]="desk()" [class.sp-group]="!desk()">
                    @for (pallet of handRows(); track $index; let i = $index) {
                      <app-planner-pallet [pallet]="pallet" [look]="desk() ? 'card' : 'row'" [editable]="canEdit()" [count]="handRows().length"
                                          [lines]="lines()" [placements]="placed()" [chips]="chipsFor() === i"
                                          [dragging]="draggingIndex() === i" [target]="draggingIndex() !== null && draggingIndex() !== i && dropIndex() === i"
                                          (act)="run($event)" (open)="sheetIndex.set($event)" (menu)="cardMenu.set($event)" (chipsToggle)="toggleChips($event)"
                                          (pointerdown)="dragStart($event, i)" (pointermove)="dragMove($event)"
                                          (pointerup)="dragEnd($event)" (pointercancel)="dragCancel($event)" />
                    }
                    @if (!desk() && canEdit()) {
                      <button class="sp-add" type="button" aria-label="Pallet toevoegen" (click)="addPallet()"><app-icon name="plus" [size]="20" />Pallet</button>
                    }
                  </div>
                } @else {
                  <div [class.sp-tiles]="desk()" [class.sp-group]="!desk()">
                    @for (pallet of autoRows(); track pallet.from) { <app-planner-pallet [pallet]="pallet" look="row" /> }
                  </div>
                  @if (canEdit() && mixed(); as mix) {
                    <div class="sp-offer">
                      <app-pallet-glyph [blocks]="mix.blocks" />
                      <span class="sp-offer__text"><b>Gemengd: {{ mix.count }} {{ mix.count === 1 ? 'pallet' : 'pallets' }}</b><small>{{ mix.saving }} minder</small></span>
                      <button class="btn btn--sm btn--primary" type="button" [disabled]="pricing()"
                              [attr.aria-label]="'Gemengd indelen op ' + mix.count + (mix.count === 1 ? ' pallet' : ' pallets')" (click)="applyMixed(mix)">Indelen</button>
                    </div>
                  }
                }
                @if (manual() && canEdit() && profileOffer()) {
                  <div class="sp-offer">
                    <span class="sp-offer__text"><b>{{ spec().name }}</b><small>Nieuw pallettype</small></span>
                    <button class="btn btn--sm btn--primary" type="button" [disabled]="pricing()" (click)="redoLayout()">Indeling opnieuw maken</button>
                  </div>
                }
              </section>
            }

            @if (cells().length) {
              <section class="sp-sec" aria-labelledby="sp-products">
                <div class="sp-sec__head"><h4 id="sp-products">Producten</h4></div>
                <div class="sp-group sp-prods">
                  @for (line of cells(); track line.productId) {
                    @if (!palletsMode()) {
                      <div class="sp-prod" [style.--sp-colour]="line.colour">
                        <ng-container [ngTemplateOutlet]="thumb" [ngTemplateOutletContext]="{ $implicit: line }" />
                        <span class="sp-prod__name">{{ line.name }}</span>
                        <span class="sp-prod__sub">{{ omdozen(line.cartons) }} · {{ cbm(line.cbm) }}</span>
                      </div>
                    } @else if (manual()) {
                      @let place = placed().get(line.productId);
                      @if (canEdit() && place && place.remaining > 0) {
                        <button class="sp-prod" type="button" aria-haspopup="menu" [style.--sp-colour]="line.colour" (click)="openPlace($event, line)">
                          <ng-container [ngTemplateOutlet]="handCell" [ngTemplateOutletContext]="{ $implicit: line }" />
                        </button>
                      } @else {
                        <div class="sp-prod" [style.--sp-colour]="line.colour">
                          <ng-container [ngTemplateOutlet]="handCell" [ngTemplateOutletContext]="{ $implicit: line }" />
                        </div>
                      }
                    } @else {
                      <button class="sp-prod" type="button" [style.--sp-colour]="line.colour" [attr.aria-expanded]="detailFor() === line.productId"
                              (click)="detailFor.set(detailFor() === line.productId ? null : line.productId)">
                        <ng-container [ngTemplateOutlet]="thumb" [ngTemplateOutletContext]="{ $implicit: line }" />
                        <span class="sp-prod__name">{{ line.name }}</span>
                        @let onPallets = palletsOf().get(line.productId) ?? line.pallets;
                        @let room = roomOf().get(line.productId) ?? 0;
                        <span class="sp-prod__sub">{{ detailFor() === line.productId ? stacking(line) : omdozen(line.cartons) + ' · ' + onPallets + (onPallets === 1 ? ' pallet' : ' pallets') }}</span>
                        @if (room > 0) {
                          <span class="sp-prod__trail"><span class="sp-room" [attr.aria-label]="'Nog ' + room + ' omdozen passen zonder extra pallet'">+{{ room }} past</span></span>
                        }
                      </button>
                    }
                  }
                </div>
              </section>
            }
          </div>

          <aside class="sp-aside">
            @if (desk() && canEdit() && lines().length) {
              <section class="sp-panel" aria-labelledby="sp-load"><h4 id="sp-load">Lading</h4><ng-container [ngTemplateOutlet]="load" /></section>
            }
            <div class="sp-panel">
              <app-planner-freight id="sp-freight" [view]="view()" [canEdit]="canEdit()" [carriers]="carriers()" [desk]="desk()"
                                   [customerPostcode]="customerPostcode()" [countryName]="countryName()" [splitFreight]="splitFreight()"
                                   (patch)="patch.emit($event)" />
            </div>
          </aside>
        </div>
      </div>
      <p class="sr-only" aria-live="polite">{{ announcement() }}</p>
    </div>

    <ng-template #modeSwitch>
      <div class="sp-mode">
        <app-segmented label="Indeling" [variant]="desk() ? 'desk' : 'ios'" [options]="modeOptions()" [value]="manual() ? 'manual' : 'auto'"
                       (changed)="setMode($event)" />
        <button class="sp-info" type="button" aria-label="Uitleg indeling" aria-controls="sp-caption" [attr.aria-expanded]="infoOpen()"
                (click)="infoOpen.set(!infoOpen())"><app-icon name="info" [size]="desk() ? 16 : 18" /></button>
      </div>
    </ng-template>
    <ng-template #thumb let-line>
      @if (line.photoUrl) { <img class="sp-thumb" [appAuthSrc]="line.photoUrl" appAuthLazy alt="" /> }
      @else { <span class="sp-thumb"><app-icon name="products" [size]="18" /></span> }
    </ng-template>
    <ng-template #handCell let-line>
      @let place = placed().get(line.productId);
      <ng-container [ngTemplateOutlet]="thumb" [ngTemplateOutletContext]="{ $implicit: line }" />
      <span class="sp-prod__name">{{ line.name }}</span>
      <span class="sp-prod__sub">{{ (place?.placed ?? 0).toLocaleString('nl-BE') }} van {{ line.cartons.toLocaleString('nl-BE') }} geplaatst</span>
      <span class="sp-prod__trail">
        @if (place?.over) { <span class="badge badge--danger">{{ place!.over }} te veel</span> }
        @else if (place?.remaining) { <span class="badge badge--warn">{{ place!.remaining }} los</span> }
        @else { <app-icon name="tick" [size]="18" /> }
      </span>
    </ng-template>
    <ng-template #load>
      <app-planner-load [mode]="loadMode()" [profile]="spec().profile" [heightCm]="heightCm()" [maxCm]="heightLimit()" [overridden]="heightOverridden()"
                        [baseCm]="spec().baseHeightCm" [canEdit]="canEdit()" [desk]="desk()" [layoutNote]="layoutNote()"
                        (modeChange)="chooseLoadMode($event)" (profileChange)="setPalletProfile($event)" (heightChange)="setMaxHeight($event)" />
    </ng-template>

    @if (sheetPallet(); as pallet) {
      <app-pallet-sheet [pallet]="pallet" [lines]="lines()" [placements]="placed()" [spec]="spec()" [count]="handRows().length" [canEdit]="canEdit()"
                        (act)="run($event)" (move)="moveFromSheet($event)" (remove)="removePallet($event)" (closed)="sheetIndex.set(null)" />
    }
    @if (loadOpen()) {
      <app-sheet title="Lading" variant="ios" (closed)="loadOpen.set(false)">
        <div body class="sp-loadsheet"><ng-container [ngTemplateOutlet]="load" /></div>
        <div foot style="display:contents"><button class="btn btn--primary" type="button" (click)="loadOpen.set(false)">Klaar</button></div>
      </app-sheet>
    }
    @if (placeFor(); as place) {
      <app-context-menu title="Op welke pallet?" variant="ios" [items]="placeItems()" [anchor]="place.point"
                        (pick)="placeOn($event)" (closed)="placeFor.set(null)" />
    }
    @if (cardMenu(); as menu) {
      <app-context-menu [title]="handRows()[menu.index]?.label ?? 'Pallet'" variant="ios" [items]="cardMenuItems()" [anchor]="menu.point"
                        (pick)="cardPick($event)" (closed)="cardMenu.set(null)" />
    }
  `,
  styles: [`
    :host{display:block;color:var(--ink)}
    .sp{display:grid;gap:18px;min-width:0}
    .sp-hero{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"spec spec" "title freight" "facts facts";align-items:center;gap:2px 12px;padding:12px 16px 14px;border-radius:var(--ios-radius,22px);background:var(--surface)}
    .sp-hero__answer{display:contents}
    .sp-hero__spec{grid-area:spec;display:flex;align-items:center;gap:4px;max-width:100%;min-height:44px;margin:-10px 0 -6px;padding:0;border:0;background:none;color:var(--muted);font-size:11px;font-weight:700;letter-spacing:.06em;text-align:left;text-transform:uppercase;cursor:pointer}
    p.sp-hero__spec{min-height:0;margin:0 0 4px;cursor:default}
    .sp-hero__spec span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sp-hero__title{grid-area:title;display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;min-width:0;font-size:23px;line-height:1.15;font-weight:800;letter-spacing:-.01em;font-variant-numeric:tabular-nums}
    .sp-hero__title small{font-size:15px;font-weight:600;letter-spacing:0;color:var(--muted)}
    .sp-hero__title .badge{align-self:center;letter-spacing:0}
    .sp-hero__facts{grid-area:facts;margin-top:3px;overflow:hidden;color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap}
    .sp-hero__freight{grid-area:freight;display:grid;justify-items:end;gap:1px;min-height:44px;padding:0;border:0;background:none;color:var(--ink);text-align:right;cursor:pointer}
    .sp-hero__freight b{font-size:19px;font-weight:750;font-variant-numeric:tabular-nums;white-space:nowrap}
    .sp-hero__freight small{color:var(--muted);font-size:12px;white-space:nowrap}
    .is-warn{color:var(--warn)}.is-danger{color:var(--danger)}
    .sp-mode{display:flex;align-items:center;gap:8px;min-width:0}
    .sp-mode app-segmented{flex:1;min-width:0}
    .sp-info{flex:none;display:grid;place-items:center;width:44px;height:44px;padding:0;border:0;border-radius:50%;background:none;color:var(--muted);cursor:pointer}
    .sp-info[aria-expanded=true]{color:var(--rose)}
    .sp-caption{margin:-8px 4px 0;color:var(--muted);font-size:12.5px;line-height:1.4}
    .sp-empty{padding:0 16px;color:var(--muted);font-size:14px}
    .sp-layout{container:sp/inline-size;min-width:0}
    .sp-cols{display:grid;gap:18px;align-items:start}
    .sp-main,.sp-aside{display:grid;gap:18px;min-width:0}
    @container sp (min-width: 720px){.sp-cols{grid-template-columns:minmax(0,1fr) 300px;gap:14px}}
    .sp-sec{display:grid;gap:7px;min-width:0}
    .sp-sec__head{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:20px;padding:0 16px;color:var(--muted);font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}
    .sp-sec__head h4{font-size:13px;font-weight:600;letter-spacing:.02em;text-transform:uppercase}
    .sp-group{overflow:hidden;border-radius:var(--ios-radius,22px);background:var(--surface)}
    .sp-group>*+*{border-top:.5px solid var(--ios-sep)}
    .sp-add{display:flex;align-items:center;gap:10px;width:100%;min-height:52px;padding:8px 16px;border:0;background:var(--surface);color:var(--rose);font-size:16px;font-weight:500;cursor:pointer}
    .sp-offer{display:flex;align-items:center;gap:12px;padding:10px 12px 10px 16px;border-radius:var(--ios-radius,22px);background:color-mix(in srgb,var(--rose) 9%,var(--surface))}
    .sp-offer__text{flex:1;min-width:0}
    .sp-offer b,.sp-offer small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .sp-offer b{font-size:15px}.sp-offer small{color:var(--muted);font-size:13px}
    .sp-offer .btn{flex:none}
    .sp-prod{display:grid;grid-template-columns:40px minmax(0,1fr) auto;grid-template-areas:"thumb name name" "thumb sub trail";align-items:center;column-gap:12px;row-gap:1px;width:100%;min-height:60px;padding:8px 16px;border:0;background:var(--surface);color:var(--ink);text-align:left;box-shadow:inset 4px 0 var(--sp-colour,var(--muted-2))}
    button.sp-prod{cursor:pointer;-webkit-tap-highlight-color:transparent}button.sp-prod:active{background:var(--surface-2)}
    .sp-thumb{grid-area:thumb;display:grid;place-items:center;width:40px;height:40px;border-radius:10px;background:var(--surface-2);color:var(--muted);object-fit:cover}
    .sp-prod__name{grid-area:name;min-width:0;overflow:hidden;font-size:15px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}
    .sp-prod__sub{grid-area:sub;min-width:0;overflow:hidden;color:var(--muted);font-size:13px;font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap}
    .sp-prod__trail{grid-area:trail;display:flex;align-items:center;color:var(--ok)}
    .sp-room{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:999px;background:var(--rose-soft);color:var(--rose-dark);font-size:12px;font-weight:700;white-space:nowrap}
    .sp-link{color:var(--rose);font-size:15px;font-weight:600;text-decoration:none}
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px){.sp,.sp-loadsheet{padding-inline:var(--ios-inset,16px)}}
    @media (min-width: 1024px), (min-width: 680px) and (hover: hover){
      .sp{gap:14px}
      .sp-hero{display:flex;flex-wrap:wrap;align-items:center;gap:8px 18px;padding:14px 16px;border:1px solid var(--line);border-radius:16px;background:var(--surface-2)}
      .sp-hero__answer{display:block;flex:1 1 260px;min-width:0}
      .sp-hero__title{font-size:26px}
      .sp-mode{flex:none}.sp-info{width:32px;height:32px}
      .sp-caption{margin:-6px 2px 0}
      .sp-empty{padding:0 2px}
      .sp-main,.sp-aside{gap:14px}
      .sp-aside{position:sticky;top:0}
      .sp-sec__head{padding:0 2px}
      .sp-sec__head h4,.sp-panel h4{color:var(--rose);font-size:10px;font-weight:760;letter-spacing:.1em;text-transform:uppercase}
      .sp-group{border:1px solid var(--line);border-radius:14px}
      .sp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
      .sp-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px}
      .sp-tiles app-planner-pallet{overflow:hidden;border:1px solid var(--line);border-radius:12px}
      .sp-prods{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;overflow:visible;border:0;border-radius:0;background:none}
      .sp-prods>*+*{border-top:0}
      .sp-prods .sp-prod{grid-template-columns:32px minmax(0,1fr) auto;min-height:48px;padding:6px 12px;border:1px solid var(--line);border-radius:12px}
      .sp-prods .sp-thumb{width:32px;height:32px;border-radius:8px}
      .sp-prod__name{font-size:13px}.sp-prod__sub{font-size:12px}.sp-link{font-size:13px}
      .sp-offer{border-radius:14px}
      .sp-panel{display:grid;gap:10px;padding:12px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}
    }
  `],
})
export class ShippingPlanner {
  readonly view = input.required<SalesOrderView>();
  readonly canEdit = input(true);
  readonly carriers = input<Carrier[]>([]);
  readonly customerPostcode = input<string | null>(null);
  readonly countryName = input<string | null>(null);
  /** A financially locked split part: only its own transport amount stays editable. */
  readonly splitFreight = input(false);
  /** The figures are being worked out again: no layout may be cut from the ones on screen. */
  readonly pricing = input(false);
  readonly patch = output<ShippingOrderPatch>();
  readonly action = output<ShippingPalletAction>();

  private readonly ui = inject(Ui);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly desk = inject(DesktopViewport).active;

  readonly order = computed(() => this.view().order);
  readonly loadMode = computed<LoadMode>(() => this.order().loadMode ?? 'PALLETS');
  readonly palletsMode = computed(() => this.loadMode() === 'PALLETS');
  readonly manual = computed(() => this.palletsMode() && this.order().pallets.length > 0);
  readonly spec = computed(() => plannerSpec(this.view()));
  readonly lines = computed(() => plannerLines(this.view(), this.spec()));
  readonly problems = computed(() => this.lines().filter((line) => line.problem));
  /** How Automatisch counts; an older server knows only every product on pallets of its own. */
  readonly rule = computed<PalletRule>(() => this.view().priced.totals.palletRule ?? 'STRICT');
  readonly autoCount = computed(() => automaticPallets(this.view().priced.totals));
  /** The server's automatic pallets; an older server's strict count is laid out here. */
  readonly autoRows = computed(() => serverPallets(this.view(), this.lines(), this.spec()) ?? autoPallets(this.lines(), this.spec()));
  /** The rows only when they add up to the server's count: never two different counts on one screen. */
  readonly autoShown = computed(() => this.autoRows().length > 0 && palletCount(this.autoRows()) === this.autoCount());
  readonly handRows = computed(() => handPallets(this.view(), this.lines(), this.spec()));
  readonly placed = computed(() => placements(this.order(), this.lines()));
  /**
   * Palletberekening's mix one tap away, only where Automatisch does not mix already and only on a
   * concept: a document that left concept keeps the count and freight it was sent with.
   */
  readonly mixed = computed<MixedLayout | null>(() => (this.palletsMode() && !this.manual() && this.autoShown()
    && this.rule() === 'STRICT' && this.view().order.status === 'CONCEPT'
    ? mixedLayout(this.lines(), this.spec(), this.autoCount()) : null));
  /** Per product, the automatic pallets it stands on. */
  readonly palletsOf = computed(() => {
    const counts = new Map<number, number>();
    for (const row of this.autoShown() ? this.autoRows() : []) {
      for (const part of row.parts) counts.set(part.productId, (counts.get(part.productId) ?? 0) + row.to - row.from + 1);
    }
    return counts;
  });
  /** "+22 past": what still goes on without an extra pallet, on the product's own last pallet or, mixed, on the same pallets. */
  readonly roomOf = computed(() => (this.rule() === 'MIXED'
    ? mixedRoom(this.lines(), this.spec(), this.autoCount())
    : new Map(this.lines().map((line) => [line.productId, line.cartonHeightCm === null ? 0 : line.room]))));
  readonly cells = computed(() => (this.palletsMode() && !this.manual() ? this.lines().filter((line) => !line.problem) : this.lines()));
  readonly heightCm = computed(() => this.order().maxPalletHeightCm ?? Math.round(this.spec().maxHeightCm));
  /** The highest height that can be picked: 260 cm for a europallet, 300 for the other types. */
  readonly heightLimit = computed(() => palletHeightLimit(this.spec().profile));
  /**
   * "Standaard" (and an emptied field meaning it) while the document carries a height other than the
   * standard. A document from before 2026-11-07 has none, reads 260 and gets no button. The 220 cm of
   * 7-10 November was the standard of those days: what was sent, invoiced, advanced, split or ordered
   * on it never moves by one tap, so it offers "Standaard" only on a concept nothing has come from
   * (the server's own line for its one-time move, as far as this screen knows it); stepping or typing
   * another height stays possible everywhere.
   */
  readonly heightOverridden = computed(() => {
    const view = this.view();
    const order = view.order;
    const own = order.maxPalletHeightCm;
    if (own == null || own === PALLET_MAX_HEIGHT_CM) return false;
    if (own !== PALLET_FORMER_STANDARD_CM) return true;
    return order.status === 'CONCEPT' && !order.sentAt && !order.sourceQuoteId && !view.webOrder
      && !view.invoicedAsId && !view.advanceInvoices?.length && !view.advanceBilling && !view.fulfillment;
  });
  readonly showSwitch = computed(() => this.canEdit() && this.palletsMode() && this.lines().length > 0);
  readonly modeOptions = computed<SegmentOption[]>(() => [
    { id: 'auto', label: 'Automatisch' },
    { id: 'manual', label: 'Zelf indelen', disabled: this.pricing() && !this.manual() },
  ]);

  readonly pending = computed(() => this.order().freight === 'TE_BEPALEN');
  readonly freightIssue = computed(() => !!this.view().priced.validation.freightPricingIssue);
  readonly strategyText = computed(() => strategyLabel(freightStrategy(this.order()), this.carriers(), this.order().freightCarrierId));

  readonly specText = computed(() => {
    if (!this.palletsMode()) return 'Losse dozen';
    const text = `${this.spec().name} · max ${this.heightCm()} cm`;
    if (this.canEdit() || !this.lines().length) return text;
    return `${text} · ${this.manual() ? 'zelf ingedeeld' : 'automatisch'}`;
  });
  readonly heroTitle = computed(() => {
    if (!this.lines().length) return 'Nog geen producten';
    if (!this.palletsMode()) return omdozen(this.view().priced.totals.cartons);
    const count = this.manual() ? this.order().pallets.length : this.autoCount();
    if (!count && this.problems().length) return 'Past niet';
    return `${count.toLocaleString('nl-BE')} ${count === 1 ? 'pallet' : 'pallets'}`;
  });
  readonly fill = computed(() => {
    if (!this.palletsMode()) return '';
    return fillWords(this.manual() ? this.handRows() : this.autoShown() ? this.autoRows() : []);
  });
  readonly heroPill = computed<{ text: string; tone: string } | null>(() => {
    if (!this.palletsMode() || !this.lines().length) return null;
    if (this.manual()) return layoutPill(checkLayout(this.view()));
    const misfits = this.problems().length;
    return misfits && this.autoCount() > 0 ? { text: `${misfits} past niet`, tone: 'warn' } : null;
  });
  readonly factsText = computed(() => {
    const totals = this.view().priced.totals;
    /* Loose cartons carry the count in the title already. */
    const facts = this.palletsMode() ? [omdozen(totals.cartons), `${CBM.format(totals.cbm)} m³`] : [`${CBM.format(totals.cbm)} m³`];
    if (totals.weightKg > 0) facts.push(`${Math.round(totals.weightKg).toLocaleString('nl-BE')} kg`);
    return facts.join(' · ');
  });
  /** In loose mode with a hand layout: whether it comes back with the pallets. */
  readonly layoutNote = computed(() => {
    if (this.palletsMode() || !this.order().pallets.length) return null;
    return this.preservedLayoutMatches() ? 'Eigen indeling bewaard' : 'Eigen indeling vervalt';
  });
  readonly preservedLayoutMatches = computed(() => {
    const data = this.view();
    const spec = this.spec();
    if (!data.order.pallets.length) return true;
    if (data.order.pallets.some((pallet) => !pallet.items.length || pallet.items.some((item) => item.cartons <= 0))) return false;
    if (data.order.pallets.some((pallet) => pallet.heightCm != null
        && (pallet.heightCm < spec.baseHeightCm || pallet.heightCm > spec.maxHeightCm))) return false;
    const lineIds = new Set(data.priced.lines.map((line) => line.productId));
    if (data.order.pallets.some((pallet) => pallet.items.some((item) => !lineIds.has(item.productId)))) return false;
    return data.priced.lines.every((line) => data.order.pallets.flatMap((pallet) => pallet.items)
      .filter((item) => item.productId === line.productId)
      .reduce((sum, item) => sum + item.cartons, 0) === line.cartons);
  });

  /* ---- what is open */
  readonly infoOpen = signal(false);
  readonly loadOpen = signal(false);
  readonly sheetIndex = signal<number | null>(null);
  readonly sheetPallet = computed(() => {
    const index = this.sheetIndex();
    return index === null || !this.manual() ? null : this.handRows()[index] ?? null;
  });
  readonly placeFor = signal<{ productId: number; point: MenuPoint } | null>(null);
  readonly cardMenu = signal<{ index: number; point: MenuPoint } | null>(null);
  readonly chipsFor = signal<number | null>(null);
  readonly detailFor = signal<number | null>(null);
  /** After a pallet type change on a hand layout: offer to lay it out again. */
  readonly profileOffer = signal(false);
  readonly announcement = signal('');

  readonly placeItems = computed<ContextMenuItem[]>(() => {
    if (!this.placeFor()) return [];
    const rows = this.handRows();
    return [
      ...rows.map((row) => ({ id: String(row.index), label: row.label,
        hint: row.parts.length ? `${omdozen(row.cartons)} · ${Math.round(row.fill * 100)} %` : 'leeg' })),
      { id: 'new', label: 'Nieuwe pallet', iconName: 'plus', divider: rows.length > 0 },
    ];
  });
  readonly cardMenuItems = computed<ContextMenuItem[]>(() => {
    const menu = this.cardMenu();
    if (!menu) return [];
    return [
      { id: 'edit', label: 'Soort en hoogte…', iconName: 'pallet' },
      { id: 'up', label: 'Naar voren', iconName: 'chevron-up', disabled: menu.index === 0 },
      { id: 'down', label: 'Naar achteren', iconName: 'chevron-down', disabled: menu.index >= this.handRows().length - 1 },
      { id: 'remove', label: 'Pallet verwijderen', iconName: 'trash', danger: true, divider: true },
    ];
  });

  /* The undo toasts work through this planner: they go when it goes. */
  private readonly toasts: number[] = [];
  /** What freight a switch to loose cartons replaced, so switching straight back restores it. */
  private looseSwitch: { strategy: FreightPricingStrategy; prefill: number | null } | null = null;
  private drag: { id: number; from: number; x: number; y: number; scroller: HTMLElement | null } | null = null;
  readonly draggingIndex = signal<number | null>(null);
  readonly dropIndex = signal<number | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => { for (const id of this.toasts) this.ui.dismissToast(id); });
  }

  omdozen(count: number): string {
    return omdozen(count);
  }

  cbm(value: number): string {
    return `${CBM.format(value)} m³`;
  }

  /** "4 per laag × 7 lagen · 259 cm · gewicht bepaalt". */
  stacking(line: PlannerLine): string {
    const parts = [`${line.perLayer} per laag × ${line.fullLayers} ${line.fullLayers === 1 ? 'laag' : 'lagen'}`];
    if (line.cartonHeightCm !== null) parts.push(`${Math.round(this.spec().baseHeightCm + line.cartonHeightCm * line.fullLayers)} cm`);
    if (line.weightLimited) parts.push('gewicht bepaalt');
    return parts.join(' · ');
  }

  toFreight(): void {
    this.host.nativeElement.querySelector('#sp-freight')?.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
  }

  private undoable(text: string, run: () => void): void {
    this.toasts.push(this.ui.toast(text, 'ok', { label: 'Ongedaan maken', run: () => {
      /* The list changes under them: nothing stays open on a pallet that may no longer be there. */
      this.sheetIndex.set(null);
      this.cardMenu.set(null);
      this.placeFor.set(null);
      this.chipsFor.set(null);
      run();
    } }));
  }

  private announce(text: string): void {
    this.announcement.set(text);
  }

  /* ---- Automatisch | Zelf indelen */

  setMode(mode: string): void {
    if (!this.canEdit()) return;
    if (mode === 'manual' && !this.manual()) {
      if (!this.pricing()) this.action.emit({ type: 'auto-layout' });
      return;
    }
    if (mode === 'auto' && this.manual()) {
      const snapshot = structuredClone(this.order().pallets);
      this.profileOffer.set(false);
      this.chipsFor.set(null);
      this.action.emit({ type: 'clear-layout' });
      this.undoable('Eigen indeling gewist', () => this.patch.emit({ pallets: snapshot }));
    }
  }

  applyMixed(mix: MixedLayout): void {
    if (!this.canEdit() || this.pricing()) return;
    this.patch.emit({ pallets: structuredClone(mix.pallets) });
    this.undoable('Gemengd ingedeeld', () => this.action.emit({ type: 'clear-layout' }));
  }

  /** The type changed under a hand layout: the same automatic start, now on the new pallet. */
  redoLayout(): void {
    if (!this.canEdit() || this.pricing()) return;
    const snapshot = structuredClone(this.order().pallets);
    this.profileOffer.set(false);
    this.action.emit({ type: 'auto-layout' });
    this.undoable('Indeling opnieuw gemaakt', () => this.patch.emit({ pallets: snapshot }));
  }

  /* ---- the hand-built pallets */

  /** Every pallet action passes here: typed omdozen are capped at what is still free, a product already on the pallet grows. */
  run(action: ShippingPalletAction): void {
    if (!this.canEdit()) return;
    if (action.type === 'set-item-cartons' || action.type === 'add-item') {
      const { palletIndex, productId } = action;
      const item = this.order().pallets[palletIndex]?.items.find((candidate) => candidate.productId === productId);
      const free = this.placed().get(productId)?.remaining ?? 0;
      if (action.type === 'add-item' && item) {
        action = { type: 'set-item-cartons', palletIndex, productId, cartons: item.cartons + free };
      } else if (action.type === 'set-item-cartons') {
        action = { ...action, cartons: Math.min((item?.cartons ?? 0) + free, Math.max(0, Math.floor(action.cartons || 0))) };
      }
    }
    if (action.type === 'reorder-pallet') this.announce(`Pallet ${action.fromIndex + 1} verplaatst naar positie ${action.toIndex + 1}.`);
    this.action.emit(action);
  }

  addPallet(): void {
    if (!this.canEdit()) return;
    const index = this.order().pallets.length;
    this.action.emit({ type: 'add-pallet' });
    if (this.desk()) this.chipsFor.set(index);
    else this.sheetIndex.set(index);
  }

  toggleChips(index: number): void {
    this.chipsFor.set(this.chipsFor() === index ? null : index);
  }

  removePallet(index: number): void {
    const pallet = this.order().pallets[index];
    if (!this.canEdit() || !pallet) return;
    const label = this.handRows()[index]?.label ?? `Pallet ${index + 1}`;
    const snapshot = structuredClone(this.order().pallets);
    this.sheetIndex.set(null);
    this.chipsFor.set(null);
    this.action.emit({ type: 'remove-pallet', index });
    this.announce(`${label} verwijderd.`);
    if (pallet.items.length) this.undoable(`${label} verwijderd`, () => this.patch.emit({ pallets: snapshot }));
  }

  /** Naar voren / naar achteren in the sheet: the sheet follows its pallet. */
  moveFromSheet(direction: -1 | 1): void {
    const index = this.sheetIndex();
    if (index === null) return;
    if (this.move(index, direction)) this.sheetIndex.set(index + direction);
  }

  private move(index: number, direction: -1 | 1): boolean {
    const target = index + direction;
    if (!this.canEdit() || target < 0 || target >= this.order().pallets.length) return false;
    this.action.emit({ type: 'move-pallet', index, direction });
    this.announce(`Pallet ${index + 1} verplaatst naar positie ${target + 1}.`);
    return true;
  }

  cardPick(item: ContextMenuItem): void {
    const menu = this.cardMenu();
    this.cardMenu.set(null);
    if (!menu) return;
    if (item.id === 'edit') this.sheetIndex.set(menu.index);
    else if (item.id === 'up') this.move(menu.index, -1);
    else if (item.id === 'down') this.move(menu.index, 1);
    else if (item.id === 'remove') this.removePallet(menu.index);
  }

  openPlace(event: MouseEvent, line: PlannerLine): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.placeFor.set({ productId: line.productId, point: { x: rect.left + 16, y: rect.bottom - 4 } });
  }

  /** All of the product's loose omdozen onto the chosen pallet, or onto a new one. */
  placeOn(item: ContextMenuItem): void {
    const place = this.placeFor();
    this.placeFor.set(null);
    if (!place || !this.canEdit()) return;
    if (item.id === 'new') {
      const palletIndex = this.order().pallets.length;
      this.action.emit({ type: 'add-pallet' });
      this.action.emit({ type: 'add-item', palletIndex, productId: place.productId });
      return;
    }
    this.run({ type: 'add-item', palletIndex: Number(item.id), productId: place.productId });
  }

  /* ---- Lading */

  chooseLoadMode(mode: LoadMode): void {
    if (!this.canEdit() || mode === this.loadMode()) return;
    const order = this.order();
    const current = freightStrategy(order);
    const changes: ShippingOrderPatch = { loadMode: mode };
    const switchBack = this.looseSwitch;
    if (mode === 'LOOSE_CARTONS' && (current === 'COUNTRY_PALLET' || current === 'CARRIER')) {
      /* Pallet freight cannot price loose cartons: today's amount becomes the fixed one instead of € 0. */
      const freight = this.view().priced.totals.freight;
      const prefill = order.manualFreightEur ?? (this.pending() || !(freight > 0) ? null : freight);
      this.looseSwitch = { strategy: current, prefill };
      Object.assign(changes, { freightPricingStrategy: 'FIXED', freightRatePerCbmEur: null, manualFreightEur: prefill });
    } else if (mode === 'PALLETS' && switchBack && current === 'FIXED' && order.manualFreightEur === switchBack.prefill) {
      /* Straight back, nothing touched in between: the pallet freight returns. */
      this.looseSwitch = null;
      Object.assign(changes, { freightPricingStrategy: switchBack.strategy, freightRatePerCbmEur: null, manualFreightEur: null });
    } else {
      Object.assign(changes, {
        freightPricingStrategy: current,
        freightRatePerCbmEur: current === 'PER_CBM' ? order.freightRatePerCbmEur : null,
        manualFreightEur: current === 'FIXED' ? order.manualFreightEur : null,
      });
    }
    if (mode === 'PALLETS' && !this.preservedLayoutMatches()) changes.pallets = [];
    this.patch.emit(changes);
  }

  /** Pallets of the old type take the new one; the layout itself may no longer fit, so laying it out again is offered. */
  setPalletProfile(profile: PalletProfile): void {
    if (!this.canEdit() || profile === this.spec().profile) return;
    /* A height the new type does not allow comes down with it (a europallet stops at 260 cm): the server
       would refuse the switch otherwise. */
    const changes: ShippingOrderPatch = { palletProfile: profile };
    if (this.heightCm() > palletHeightLimit(profile)) changes.maxPalletHeightCm = palletHeightLimit(profile);
    const pallets = this.order().pallets;
    if (!pallets.length) { this.patch.emit(changes); return; }
    const from = palletTypeLabel(this.spec().profile);
    const to = palletTypeLabel(profile);
    this.patch.emit({ ...changes,
      pallets: pallets.map((pallet) => (normalizeManualPalletType(pallet.type) === from ? { ...pallet, type: to } : pallet)) });
    this.profileOffer.set(true);
  }

  /**
   * ±10 cm or typed, within the bounds of the pallet type; "Standaard" or an emptied field (only offered
   * while heightOverridden) sends the standard's number: the server keeps a document's own height when
   * none is sent.
   */
  setMaxHeight(value: number | null): void {
    if (this.canEdit()) {
      this.patch.emit({ maxPalletHeightCm: value === null ? PALLET_MAX_HEIGHT_CM : clampPalletHeight(value, this.spec().profile) });
    }
  }

  /* ---- desk: drag a card by its glyph */

  dragStart(event: PointerEvent, index: number): void {
    const handle = (event.target as Element | null)?.closest?.('[data-drag-handle]');
    if (!this.canEdit() || event.button !== 0 || !handle) return;
    event.preventDefault();
    const host = event.currentTarget as HTMLElement;
    this.drag = { id: event.pointerId, from: index, x: event.clientX, y: event.clientY, scroller: host.closest<HTMLElement>('.sheet__body') };
    try { host.setPointerCapture(event.pointerId); } catch { /* losing capture merely cancels the drag */ }
  }

  dragMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.id) return;
    if (this.draggingIndex() === null && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 7) return;
    event.preventDefault();
    if (this.draggingIndex() === null) { this.draggingIndex.set(drag.from); this.dropIndex.set(drag.from); }
    const over = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-pallet-index]');
    const target = Number(over?.dataset['palletIndex']);
    if (Number.isInteger(target) && target >= 0 && target < this.order().pallets.length) this.dropIndex.set(target);
    const scroller = drag.scroller;
    if (scroller) {
      const rect = scroller.getBoundingClientRect();
      const edge = Math.min(72, rect.height / 4);
      if (event.clientY < rect.top + edge) scroller.scrollTop -= 14;
      else if (event.clientY > rect.bottom - edge) scroller.scrollTop += 14;
    }
  }

  dragEnd(event: PointerEvent): void {
    if (!this.drag || event.pointerId !== this.drag.id) return;
    const from = this.draggingIndex();
    const to = this.dropIndex();
    this.dragCancel(event);
    if (from !== null && to !== null && from !== to) this.run({ type: 'reorder-pallet', fromIndex: from, toIndex: to });
  }

  dragCancel(event: PointerEvent): void {
    if (!this.drag || event.pointerId !== this.drag.id) return;
    const host = event.currentTarget as HTMLElement;
    try { if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    this.drag = null;
    this.draggingIndex.set(null);
    this.dropIndex.set(null);
  }
}
