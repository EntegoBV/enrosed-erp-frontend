import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import {
  FreightPricingStrategy, LoadMode, OrderPallet, PalletProfile, SalesOrderView,
  Carrier, CarrierShipQuote,
} from '../../core/api/models';
import { CbmPipe, EurPipe, NumPipe, PctPipe } from '../../shared/pipes';
import { SalesApi } from '../../core/api/sales-api';

import { PALLET_PRODUCT_COLOURS, estimatePalletHeightCm, normalizeManualPalletType } from './pallet-stack';

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

type PlannerSection = 'mode' | 'layout' | 'freight';

/**
 * Shipping planner shared by the phone editor's sheet and the desk's wide
 * sheet: how the order travels, how the pallets are stacked, what the
 * freight costs.
 *
 * On a phone the three parts fold into an accordion under one summary
 * strip; on a desk they sit side by side with the pallet layout taking the
 * room. The component only explains and collects choices. The sales editor
 * keeps ownership of its serial save queue and the backend remains the only
 * place that calculates pallet fits, CBM and freight amounts.
 */
@Component({
  selector: 'app-shipping-planner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CbmPipe, EurPipe, NumPipe, PctPipe],
  template: `
    <div class="planner">
      <!-- ============================ the strip: where the order stands -->
      <div class="plan-summary" aria-label="Samenvatting van transport en levering">
        <button class="plan-summary__tile" type="button" (click)="openSection.set('mode')"
                [class.is-open]="openSection() === 'mode'" [attr.aria-current]="openSection() === 'mode' ? 'true' : null">
          <small>Lading</small>
          <strong>{{ loadSummary() }}</strong>
          <span>{{ loadDetail() }}</span>
        </button>
        <button class="plan-summary__tile" type="button" (click)="openSection.set('layout')"
                [class.is-open]="openSection() === 'layout'" [attr.aria-current]="openSection() === 'layout' ? 'true' : null"
                [class.is-ok]="layoutState() === 'ok'" [class.is-warn]="layoutState() === 'warn'">
          <small>Indeling</small>
          <strong>{{ layoutSummary() }}</strong>
          <span>{{ layoutDetail() }}</span>
        </button>
        <button class="plan-summary__tile" type="button" (click)="openSection.set('freight')"
                [class.is-open]="openSection() === 'freight'" [attr.aria-current]="openSection() === 'freight' ? 'true' : null"
                [class.is-warn]="freightPending()">
          <small>Vracht</small>
          <strong>@if (freightPending()) { later bepalen } @else { {{ view().priced.totals.freight | eur }} }</strong>
          <span>{{ strategyLabel(pricingStrategy()) }}</span>
        </button>
      </div>

      <div class="plan-columns">
        <!-- ============================ how it travels -->
        <section class="plan-section plan-section--mode" [class.plan-section--open]="openSection() === 'mode'">
          <button class="plan-section__toggle" type="button" (click)="toggleSection('mode')"
                  [attr.aria-expanded]="openSection() === 'mode'">
            <span><small class="eyebrow">Verzendwijze</small><strong>{{ loadMode() === 'PALLETS' ? 'Op pallets' : 'Losse dozen' }}</strong></span>
            <i aria-hidden="true">⌄</i>
          </button>
          <div class="plan-section__body">
            <div class="choice-grid" role="radiogroup" aria-label="Verzendwijze">
              <button class="choice-card" type="button" role="radio"
                      [class.choice-card--active]="loadMode() === 'PALLETS'"
                      [attr.aria-checked]="loadMode() === 'PALLETS'"
                      [disabled]="!canEdit()" (click)="chooseLoadMode('PALLETS')">
                <span class="choice-card__icon" aria-hidden="true">▦</span>
                <span class="choice-card__copy">
                  <strong>Op pallets</strong>
                  <small>Gestapeld op vloermaat en laadhoogte</small>
                </span>
                <span class="choice-card__check" aria-hidden="true">✓</span>
              </button>
              <button class="choice-card" type="button" role="radio"
                      [class.choice-card--active]="loadMode() === 'LOOSE_CARTONS'"
                      [attr.aria-checked]="loadMode() === 'LOOSE_CARTONS'"
                      [disabled]="!canEdit()" (click)="chooseLoadMode('LOOSE_CARTONS')">
                <span class="choice-card__icon" aria-hidden="true">▤</span>
                <span class="choice-card__copy">
                  <strong>Losse dozen</strong>
                  <small>Volume uit de buitenmaten van de omdozen</small>
                </span>
                <span class="choice-card__check" aria-hidden="true">✓</span>
              </button>
            </div>
            @if (loadMode() === 'LOOSE_CARTONS' && view().order.pallets.length) {
              @if (preservedLayoutMatches()) {
                <p class="note">Je handmatige palletindeling blijft bewaard, maar telt niet mee zolang ‘Losse dozen’ is gekozen.</p>
              } @else {
                <p class="note note--warn">De bewaarde palletindeling past niet meer bij de producten, aantallen of laadhoogte. Bij terugschakelen naar pallets herstellen we de automatische berekening.</p>
              }
            }
            @if (loadMode() === 'PALLETS') {
              <div class="settings">
                <div class="field-row">
                  <label for="shipping-pallet-profile">Pallettype</label>
                  <select id="shipping-pallet-profile" class="select" [value]="palletProfile()"
                          [disabled]="!canEdit()" (change)="setPalletProfile($any($event.target).value)">
                    <option value="EURO_120X80">Europallet · 120 × 80 cm</option>
                    <option value="BLOCK_120X100">Blokpallet · 120 × 100 cm</option>
                    <option value="HALF_80X60">Halve pallet · 80 × 60 cm</option>
                  </select>
                </div>
                <div class="field-row">
                  <label for="shipping-max-height">Max. pallethoogte <small>incl. pallet van {{ palletBaseHeightCm() | num }} cm</small></label>
                  <div class="unit-input">
                    <input id="shipping-max-height" class="input num" type="number" min="50" max="300" step="1" inputmode="numeric"
                           [value]="maxPalletHeightCm()" [disabled]="!canEdit()" (change)="setMaxHeight($any($event.target).value)" />
                    <span>cm</span>
                  </div>
                  @if (order().maxPalletHeightCm != null) {
                    <button class="text-action" type="button" [disabled]="!canEdit()" (click)="patch.emit({ maxPalletHeightCm: null })">Terug naar standaardhoogte</button>
                  }
                </div>
              </div>
            }
          </div>
        </section>

        <!-- ============================ the pallets, or the loose volume -->
        <section class="plan-section plan-section--layout" [class.plan-section--open]="openSection() === 'layout'">
          <button class="plan-section__toggle" type="button" (click)="toggleSection('layout')"
                  [attr.aria-expanded]="openSection() === 'layout'">
            <span><small class="eyebrow">{{ loadMode() === 'PALLETS' ? 'Palletindeling' : 'Volume' }}</small><strong>{{ layoutSummary() }}</strong></span>
            <i aria-hidden="true">⌄</i>
          </button>
          <div class="plan-section__body">
            @if (loadMode() === 'PALLETS') {
              @if (!view().order.pallets.length) {
                <!-- the calculator's proposal -->
                <dl class="tiles">
                  <div><dt>Pallets</dt><dd>{{ palletCount() | num }}</dd></div>
                  <div><dt>Dozen</dt><dd>{{ view().priced.totals.cartons | num }}</dd></div>
                  <div><dt>Volume</dt><dd>{{ view().priced.totals.cbm | cbm }}</dd></div>
                  <div><dt>Gewicht</dt><dd>{{ view().priced.totals.weightKg | num: 0 }} <small>kg</small></dd></div>
                </dl>
                @if (invalidPalletLines().length) {
                  <div class="warning" id="invalid-pallet-fit" role="alert">
                    <strong>Nog geen geldige stapeling</strong>
                    <span>Controleer omdoosafmetingen, gewicht of laadhoogte voor {{ invalidPalletLineNames() }}.</span>
                  </div>
                }
                <ul class="stack-list" aria-label="Stapeling per product">
                  @for (line of view().priced.lines; track line.productId; let i = $index) {
                    <li>
                      <i class="dot" [style.background]="productColour(line.productId)" aria-hidden="true"></i>
                      <span class="stack-list__name">{{ line.description }}</span>
                      @if (line.cartonsPerLayer && line.palletLayers) {
                        <span class="stack-list__facts">{{ line.cartons | num }} dozen · {{ line.pallets }} {{ line.pallets === 1 ? 'pallet' : 'pallets' }}
                          <small>{{ line.cartonsPerLayer }} per laag · {{ line.palletLayers }} {{ line.palletLayers === 1 ? 'laag' : 'lagen' }}@if (line.calculatedPalletHeightCm) { · {{ line.calculatedPalletHeightCm | num: 0 }} cm }</small></span>
                      } @else {
                        <span class="stack-list__facts danger-text">Geen geldige palletberekening</span>
                      }
                    </li>
                  }
                </ul>
                <p class="note">Dozen per laag × lagen binnen {{ maxPalletHeightCm() | num }} cm, begrensd door gewicht. Elke pallet draagt één product; wil je mengen of een uitzondering, deel dan zelf in.</p>
                <button class="btn btn--primary btn--block" type="button"
                        [disabled]="!canEdit() || !view().priced.lines.length || invalidPalletLines().length > 0"
                        [attr.aria-describedby]="invalidPalletLines().length ? 'invalid-pallet-fit' : null"
                        (click)="action.emit({ type: 'auto-layout' })">Zelf indelen vanuit dit voorstel</button>
              } @else {
                <!-- the hand-built layout -->
                <div class="tray" [class.tray--ok]="layoutOk()">
                  <div class="tray__progress">
                    <span><b>{{ assignedCartons() | num }}</b> van {{ view().priced.totals.cartons | num }} dozen geplaatst</span>
                    <em>{{ view().order.pallets.length }} {{ view().order.pallets.length === 1 ? 'pallet' : 'pallets' }}@if (layoutOk()) { · compleet }</em>
                  </div>
                  <div class="tray__bar" aria-hidden="true"><i [style.width.%]="assignedPercent()" [class.is-warn]="overassignedAny()"></i></div>
                  @if (unassignedLines().length) {
                    <div class="tray__chips" aria-label="Nog te plaatsen">
                      @for (line of unassignedLines(); track line.productId) {
                        <span class="chip"><i class="dot" [style.background]="productColour(line.productId)" aria-hidden="true"></i>{{ line.description }} <b>{{ line.remaining }}</b></span>
                      }
                    </div>
                  }
                  <div class="tray__actions">
                    <button class="btn btn--sm" type="button" [disabled]="!canEdit()" (click)="action.emit({ type: 'add-pallet' })"><span aria-hidden="true">＋</span> Pallet</button>
                    <button class="btn btn--sm" type="button" [disabled]="!canEdit() || invalidPalletLines().length > 0" (click)="redoLayout()">Automatisch herindelen</button>
                    <button class="btn btn--sm btn--quiet" type="button" [disabled]="!canEdit()" (click)="returnToAutomatic()">Eigen indeling wissen</button>
                  </div>
                </div>

                <p class="sr-only" aria-live="polite">{{ reorderAnnouncement() }}</p>
                <div class="pallet-grid">
                  <!-- Persistence rebuilds pallet rows after every save, so database ids are
                       intentionally not a UI identity: the position keeps a focused input intact. -->
                  @for (pallet of view().order.pallets; track $index; let pi = $index) {
                    @let stack = stackOf(pallet);
                    <article class="pallet" [attr.data-pallet-index]="pi"
                             [class.pallet--empty]="!pallet.items.length"
                             [class.pallet--dragging]="draggingIndex() === pi"
                             [class.pallet--target]="draggingIndex() !== null && dropTargetIndex() === pi && draggingIndex() !== pi">
                      <header class="pallet__head">
                        <button class="pallet__drag" type="button" [disabled]="!canEdit()"
                                [attr.aria-label]="'Pallet ' + (pi + 1) + ' verplaatsen. Sleep of gebruik de pijltjestoetsen.'"
                                (pointerdown)="startPalletDrag($event, pi)" (pointermove)="movePalletDrag($event)"
                                (pointerup)="finishPalletDrag($event)" (pointercancel)="cancelPalletDrag($event)"
                                (keydown)="movePalletWithKeyboard($event, pi)"><span aria-hidden="true">⠿</span></button>
                        <span class="pallet__number" aria-hidden="true">{{ pi + 1 }}</span>
                        <input class="pallet__name" [value]="pallet.label" [disabled]="!canEdit()" [attr.aria-label]="'Naam van pallet ' + (pi + 1)"
                               (change)="renamePallet(pi, $any($event.target).value)" />
                        <span class="pallet__facts" [class.is-warn]="stack.heightCm !== null && stack.heightCm > maxPalletHeightCm()">{{ palletCartons(pallet) | num }} {{ palletCartons(pallet) === 1 ? 'doos' : 'dozen' }}
                          @if (stack.heightCm !== null) { · {{ stack.measured ? '' : '≈ ' }}{{ stack.heightCm | num: 0 }} cm@if (stack.heightCm > maxPalletHeightCm()) { · te hoog } }</span>
                        <button class="pallet__remove" type="button" [disabled]="!canEdit()" [attr.aria-label]="'Pallet ' + (pi + 1) + ' verwijderen'" (click)="removePallet(pi)"><span aria-hidden="true">×</span></button>
                      </header>
                      <div class="pallet__stack" [title]="stack.heightCm !== null ? (stack.measured ? 'Gemeten hoogte' : 'Geschatte hoogte') + ' ' + stack.heightCm + ' cm van max. ' + maximumManualHeightCm() + ' cm' : 'Hoogte nog niet te schatten'" aria-hidden="true">
                        <i class="pallet__stack-fill" [class.is-warn]="stack.heightCm !== null && stack.heightCm > maxPalletHeightCm()" [style.width.%]="fillPercent(stack.heightCm)">
                          @for (item of pallet.items; track item.productId) {
                            <b [style.background]="productColour(item.productId)" [style.flex]="item.cartons"></b>
                          }
                        </i>
                      </div>
                      <div class="pallet__items">
                        @for (item of pallet.items; track item.productId) {
                          <div class="pallet__item">
                            <i class="dot" [style.background]="productColour(item.productId)" aria-hidden="true"></i>
                            <span class="pallet__item-name">{{ productLabel(item.productId) }}
                              <small>{{ remainingFor(item.productId) > 0 ? ('nog ' + remainingFor(item.productId) + ' te plaatsen') : (assignedFor(item.productId) > cartonsFor(item.productId) ? 'te veel toegewezen' : 'alles geplaatst') }}</small></span>
                            <div class="stepper" aria-label="Aantal dozen">
                              <button type="button" [disabled]="!canEdit()" [attr.aria-label]="'Doos verwijderen bij ' + productLabel(item.productId)"
                                      (click)="setItemCartons(pi, item.productId, item.cartons - 1)">−</button>
                              <input type="number" min="0" inputmode="numeric" [value]="item.cartons" [disabled]="!canEdit()"
                                     [attr.aria-label]="'Dozen ' + productLabel(item.productId)"
                                     (change)="setItemCartons(pi, item.productId, +$any($event.target).value)" />
                              <button type="button" [disabled]="!canEdit() || remainingFor(item.productId) <= 0" [attr.aria-label]="'Doos toevoegen bij ' + productLabel(item.productId)"
                                      (click)="setItemCartons(pi, item.productId, item.cartons + 1)">+</button>
                            </div>
                          </div>
                        } @empty {
                          <p class="pallet__empty">Lege pallet: zet er een product op, of
                            <button class="pallet__empty-remove" type="button" [disabled]="!canEdit()" (click)="removePallet(pi)">verwijder ze</button>.</p>
                        }
                        @if (canEdit() && assignable(pi).length) {
                          <div class="pallet__add" aria-label="Product op deze pallet zetten">
                            @for (line of assignable(pi); track line.productId) {
                              <button class="chip chip--add" type="button" (click)="addItem(pi, line.productId)">
                                <i class="dot" [style.background]="productColour(line.productId)" aria-hidden="true"></i>＋ {{ line.description }} <b>{{ line.remaining }}</b>
                              </button>
                            }
                          </div>
                        }
                      </div>
                      <details class="pallet__more">
                        <summary>{{ displayPalletType(pallet.type) }}@if (pallet.heightCm) { · gemeten {{ pallet.heightCm | num: 0 }} cm } @else { · hoogte automatisch }</summary>
                        <div class="pallet__more-body">
                          <div class="field-row">
                            <label [for]="'pallet-type-' + pi">Pallettype</label>
                            <select class="select" [id]="'pallet-type-' + pi" [value]="displayPalletType(pallet.type)" [disabled]="!canEdit()"
                                    (change)="setPalletType(pi, $any($event.target).value)">
                              <option value="Europallet">Europallet · 120 × 80</option>
                              <option value="Blokpallet 120×100">Blokpallet · 120 × 100</option>
                              <option value="Halve pallet 80×60">Halve pallet · 80 × 60</option>
                            </select>
                          </div>
                          <div class="field-row">
                            <label [for]="'pallet-height-' + pi">Gemeten hoogte <small>leeg gebruikt de schatting</small></label>
                            <div class="unit-input">
                              <input class="input num" [id]="'pallet-height-' + pi" type="number" [attr.min]="minimumManualHeightCm()" [attr.max]="maximumManualHeightCm()"
                                     inputmode="numeric" [value]="pallet.heightCm ?? ''" [disabled]="!canEdit()" placeholder="auto"
                                     (change)="setPalletHeight(pi, $any($event.target).value)" />
                              <span>cm</span>
                            </div>
                          </div>
                          <div class="pallet__order">
                            <button type="button" aria-label="Pallet omhoog" [disabled]="!canEdit() || pi === 0" (click)="movePallet(pi, -1)">↑</button>
                            <button type="button" aria-label="Pallet omlaag" [disabled]="!canEdit() || pi === view().order.pallets.length - 1" (click)="movePallet(pi, 1)">↓</button>
                            <span>Volgorde</span>
                          </div>
                        </div>
                      </details>
                    </article>
                  }
                </div>
              }
            } @else {
              <dl class="tiles">
                <div><dt>Dozen</dt><dd>{{ view().priced.totals.cartons | num }}</dd></div>
                <div><dt>Volume</dt><dd>{{ view().priced.totals.cbm | cbm }}</dd></div>
                <div><dt>Gewicht</dt><dd>{{ view().priced.totals.weightKg | num: 0 }} <small>kg</small></dd></div>
              </dl>
              @if (missingCartonDimensions().length) {
                <div class="warning" role="alert"><strong>Buitenmaten ontbreken</strong><span>{{ missingCartonDimensions().join(', ') }}. Het volume is daardoor nog niet compleet.</span></div>
              }
              <ul class="stack-list" aria-label="Volume per product">
                @for (line of view().priced.lines; track line.productId) {
                  <li>
                    <i class="dot" [style.background]="productColour(line.productId)" aria-hidden="true"></i>
                    <span class="stack-list__name">{{ line.description }}</span>
                    <span class="stack-list__facts">{{ line.cartons | num }} {{ line.cartons === 1 ? 'doos' : 'dozen' }} · {{ line.cbm | cbm }}</span>
                  </li>
                }
              </ul>
              <p class="note">Per product: buitenmaat omdoos (B × D × H) × aantal volle dozen. Palletmaten en pallethoogte tellen hier niet mee.</p>
            }
          </div>
        </section>

        <!-- ============================ what the freight costs -->
        <section class="plan-section plan-section--freight" [class.plan-section--open]="openSection() === 'freight'">
          <button class="plan-section__toggle" type="button" (click)="toggleSection('freight')"
                  [attr.aria-expanded]="openSection() === 'freight'">
            <span><small class="eyebrow">Vrachtprijs</small><strong>{{ strategyLabel(pricingStrategy()) }}</strong></span>
            <i aria-hidden="true">⌄</i>
          </button>
          <div class="plan-section__body">
            <div class="price-choices" role="radiogroup" aria-label="Berekening vrachtprijs">
              @if (loadMode() === 'PALLETS') {
                <button type="button" role="radio" [disabled]="!canEdit()" [class.price-choice--active]="pricingStrategy() === 'COUNTRY_PALLET'"
                        [attr.aria-checked]="pricingStrategy() === 'COUNTRY_PALLET'" (click)="choosePricing('COUNTRY_PALLET')">
                  <strong>Landentarief</strong><small>Per pallet, met het minimum van het land</small>
                </button>
              }
              @if (loadMode() === 'PALLETS' && carriers().length) {
                <button type="button" role="radio" [disabled]="!canEdit()" [class.price-choice--active]="pricingStrategy() === 'CARRIER'"
                        [attr.aria-checked]="pricingStrategy() === 'CARRIER'" (click)="choosePricing('CARRIER')">
                  <strong>Verzendorganisatie</strong><small>Staffel: zone per postcode, trap per pallet</small>
                </button>
              }
              <button type="button" role="radio" [disabled]="!canEdit()" [class.price-choice--active]="pricingStrategy() === 'PER_CBM'"
                      [attr.aria-checked]="pricingStrategy() === 'PER_CBM'" (click)="choosePricing('PER_CBM')">
                <strong>Per m³</strong><small>Eigen tarief op het omdoosvolume</small>
              </button>
              <button type="button" role="radio" [disabled]="!canEdit()" [class.price-choice--active]="pricingStrategy() === 'FIXED'"
                      [attr.aria-checked]="pricingStrategy() === 'FIXED'" (click)="choosePricing('FIXED')">
                <strong>Vast bedrag</strong><small>Eén totaalprijs voor dit document</small>
              </button>
              <button type="button" role="radio" [disabled]="!canEdit()" [class.price-choice--active]="pricingStrategy() === 'PICKUP'"
                      [attr.aria-checked]="pricingStrategy() === 'PICKUP'" (click)="choosePricing('PICKUP')">
                <strong>Afhalen</strong><small>De klant haalt op in het magazijn, geen vracht</small>
              </button>
            </div>

            @if (pricingStrategy() === 'CARRIER') {
              <div class="freight-detail">
                <div class="field-row">
                  <label for="freight-carrier">Verzendorganisatie</label>
                  <select class="select" id="freight-carrier" [disabled]="!canEdit()" [value]="order().freightCarrierId ?? ''" (change)="setCarrier($any($event.target).value)">
                    @for (carrier of carriers(); track carrier.id) { <option [value]="carrier.id">{{ carrier.name }}</option> }
                  </select>
                </div>
                <div class="field-row">
                  <label for="freight-carrier-extra">Transporttoeslag Enrosed <small>telt mee voor de klant, alleen wij zien hem apart</small></label>
                  <div class="unit-input unit-input--money">
                    <span>€</span>
                    <input id="freight-carrier-extra" class="input num" type="number" min="0" step="0.01" inputmode="decimal" [disabled]="!canEdit()"
                           [value]="order().freightCarrierExtraEur ?? ''" (change)="setCarrierExtra($any($event.target).value)" />
                  </div>
                </div>
                @if (carrierBreakdown(); as b) {
                  <dl class="breakdown">
                    <div><dt>Zone</dt><dd>{{ b.zoneName }} · {{ countryName() || view().order.countryCode }}@if (!b.postcodeMatched) { <small>· dichtstbijzijnde bij {{ customerPostcode() || '—' }}</small> }</dd></div>
                    <div><dt>Staffeltrap</dt><dd>{{ b.tierLabel }}</dd></div>
                    <div><dt>Basis</dt><dd>{{ b.baseEur | eur: 2 }}</dd></div>
                    @if (b.dieselEur) { <div><dt>Dieseltoeslag {{ b.dieselPct | pct: 0 }}</dt><dd>+ {{ b.dieselEur | eur: 2 }}</dd></div> }
                    @if (b.surchargePctEur) { <div><dt>Toeslag {{ b.surchargePct | pct: 0 }}</dt><dd>+ {{ b.surchargePctEur | eur: 2 }}</dd></div> }
                    @if (b.surchargeFixedEur) { <div><dt>Vaste toeslag</dt><dd>+ {{ b.surchargeFixedEur | eur: 2 }}</dd></div> }
                    @if (order().freightCarrierExtraEur; as extra) {
                      <div><dt>Transporttoeslag Enrosed <small>(intern)</small></dt><dd>+ {{ extra | eur: 2 }}</dd></div>
                      <div class="breakdown__total"><dt>Vracht voor de klant</dt><dd>{{ b.totalEur + extra | eur: 2 }}</dd></div>
                    } @else {
                      <div class="breakdown__total"><dt>Vracht</dt><dd>{{ b.totalEur | eur: 2 }}</dd></div>
                    }
                  </dl>
                  @if (b.surchargeNote) { <p class="note">{{ b.surchargeNote }}</p> }
                } @else if (!customerPostcode()) {
                  <p class="note note--warn">Vul de postcode bij de klant in: die bepaalt de zone. Zonder postcode kan de staffel geen prijs kiezen.</p>
                } @else if (carrierQuoteMissing()) {
                  <p class="note note--warn">Deze zending past niet in de staffel. Vraag een prijs op en kies dan een vast bedrag.</p>
                }
              </div>
            } @else if (pricingStrategy() === 'PER_CBM') {
              <div class="freight-detail">
                <div class="field-row">
                  <label for="freight-rate-cbm">Tarief per m³</label>
                  <div class="unit-input unit-input--money">
                    <span>€</span>
                    <input id="freight-rate-cbm" class="input num" type="number" min="0" step="0.01" inputmode="decimal" [disabled]="!canEdit()"
                           [value]="order().freightRatePerCbmEur ?? ''" (change)="setCbmRate($any($event.target).value)" />
                  </div>
                  <small class="hint">{{ view().priced.totals.cbm | cbm }} × tarief@if (!freightPending()) { = {{ view().priced.totals.freight | eur }} }</small>
                </div>
              </div>
            } @else if (pricingStrategy() === 'FIXED') {
              <div class="freight-detail">
                <div class="field-row">
                  <label for="freight-fixed">Vast vrachtbedrag</label>
                  <div class="unit-input unit-input--money">
                    <span>€</span>
                    <input id="freight-fixed" class="input num" type="number" min="0" step="0.01" inputmode="decimal" [disabled]="!canEdit()"
                           [value]="view().order.manualFreightEur ?? ''" (change)="setFixedFreight($any($event.target).value)" />
                  </div>
                  <small class="hint">Vervangt de automatische berekening.</small>
                </div>
              </div>
            }
            <label class="pending-toggle" [class.pending-toggle--on]="freightPending()">
              <input type="checkbox" [checked]="freightPending()" [disabled]="!canEdit()" (change)="setPending($any($event.target).checked)" />
              <span><strong>Vracht later bepalen</strong><small>{{ freightPending() ? 'De klant ziet nu nog geen vrachtbedrag.' : 'De gekozen berekening telt meteen mee.' }}</small></span>
            </label>
            @if (!freightPending() && view().priced.validation.freightPricingIssue) {
              <p class="note note--warn" role="status">{{ view().priced.validation.freightPricingIssue }}</p>
            }
          </div>
        </section>
      </div>
    </div>
  `,
  styles: [`
    :host{display:block}
    .planner{display:grid;gap:12px;color:var(--ink)}
    .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
    .eyebrow{display:block;color:var(--muted);font-size:9px;font-weight:760;letter-spacing:.1em;text-transform:uppercase}
    .dot{display:inline-block;width:9px;height:9px;flex:none;border-radius:50%;border:1px solid rgb(0 0 0/.12)}
    .note{margin:8px 1px 0;color:var(--muted);font-size:10.5px;line-height:1.45}.note--warn{color:var(--warn);font-weight:600}
    .hint{display:block;margin-top:4px;color:var(--muted);font-size:10.5px}
    .pill{flex:none;max-width:150px;overflow:hidden;padding:3px 8px;border-radius:999px;background:var(--surface-2);color:var(--muted);font-size:10px;font-style:normal;font-weight:700;text-overflow:ellipsis;white-space:nowrap}
    .pill--ok{background:var(--ok-soft);color:var(--ok)}.pill--warn{background:var(--warn-soft);color:var(--warn)}
    .warning{margin:8px 0 0;display:grid;gap:2px;padding:9px 11px;border-radius:10px;background:var(--warn-soft);color:var(--warn);font-size:11px;line-height:1.4}.warning strong{font-size:11.5px}
    /* ---- the strip */
    .plan-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
    .plan-summary__tile{display:grid;min-width:0;gap:1px;padding:9px 10px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2);color:var(--ink);font:inherit;text-align:left;cursor:pointer}
    .plan-summary__tile small{color:var(--muted);font-size:9px;font-weight:750;letter-spacing:.08em;text-transform:uppercase}
    .plan-summary__tile strong{overflow:hidden;font-size:13px;font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap}
    .plan-summary__tile span{overflow:hidden;color:var(--muted);font-size:10px;text-overflow:ellipsis;white-space:nowrap}
    .plan-summary__tile.is-ok strong{color:var(--ok)}.plan-summary__tile.is-warn strong{color:var(--warn)}
    .plan-summary__tile.is-open{border-color:var(--rose-line);background:var(--rose-soft);box-shadow:0 0 0 1px var(--rose-line)}
    /* ---- sections: an accordion on a phone, columns on a desk */
    .plan-columns{display:grid;gap:10px}
    .plan-section{min-width:0;border:1px solid var(--line);border-radius:14px;background:var(--surface);overflow:hidden}
    .plan-section__toggle{display:flex;width:100%;align-items:center;gap:10px;min-height:52px;padding:9px 12px;border:0;background:var(--surface);color:var(--ink);font:inherit;text-align:left;cursor:pointer}
    .plan-section__toggle>span{display:grid;flex:1;min-width:0;gap:1px}.plan-section__toggle strong{overflow:hidden;font-size:13.5px;text-overflow:ellipsis;white-space:nowrap}
    .plan-section__toggle i{color:var(--muted);font-style:normal;font-size:16px;transition:transform .18s}.plan-section--open .plan-section__toggle i{transform:rotate(180deg)}
    .plan-section__body{display:none;padding:0 12px 12px;border-top:1px solid var(--line)}.plan-section--open .plan-section__body{display:block}
    .plan-section__body>*:first-child{margin-top:10px}
    /* ---- verzendwijze */
    .choice-grid{display:grid;gap:8px}
    .choice-card{width:100%;min-height:64px;padding:10px;display:grid;grid-template-columns:36px minmax(0,1fr) 20px;gap:10px;align-items:center;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--ink);font:inherit;text-align:left;cursor:pointer}
    .choice-card:disabled,.price-choices button:disabled,.plan-summary__tile:disabled{cursor:default}
    .choice-card__icon{width:36px;height:36px;display:grid;place-items:center;border-radius:10px;background:var(--surface-2);color:var(--muted);font-size:17px}
    .choice-card__copy{min-width:0;display:flex;flex-direction:column;gap:1px}.choice-card__copy strong{font-size:12.5px}.choice-card__copy small{color:var(--muted);font-size:10.5px;line-height:1.35}
    .choice-card__check{width:20px;height:20px;display:grid;place-items:center;border:1px solid var(--line-strong);border-radius:50%;color:transparent;font-size:11px}
    .choice-card--active{border-color:var(--rose-line);background:var(--rose-soft);box-shadow:0 0 0 1px var(--rose-line)}
    .choice-card--active .choice-card__icon{background:var(--surface);color:var(--rose-dark)}.choice-card--active .choice-card__check{border-color:var(--rose-dark);background:var(--rose-dark);color:#fff}
    .settings{display:grid;gap:10px;margin-top:12px;padding-top:10px;border-top:1px dashed var(--line)}
    .field-row{display:grid;gap:4px}.field-row label{font-size:11px;font-weight:680}.field-row label small{display:block;color:var(--muted);font-size:9.5px;font-weight:520}
    .unit-input{display:flex}.unit-input input{min-width:0;flex:1;border-radius:9px 0 0 9px}
    .unit-input>span{min-width:38px;display:grid;place-items:center;border:1px solid var(--line-strong);border-left:0;border-radius:0 9px 9px 0;background:var(--surface-2);color:var(--muted);font-size:10.5px}
    .unit-input--money>span{order:-1;border-left:1px solid var(--line-strong);border-right:0;border-radius:9px 0 0 9px}.unit-input--money input{border-radius:0 9px 9px 0}
    .text-action{justify-self:start;min-height:34px;padding:4px 0;border:0;background:transparent;color:var(--rose-dark);font:inherit;font-size:10.5px;font-weight:680;cursor:pointer}
    /* ---- the calculator's proposal, and the loose volume */
    .tiles{margin:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
    .tiles>div{min-width:0;padding:8px 6px;border-radius:10px;background:var(--surface-2);text-align:center}
    .tiles dt{overflow:hidden;color:var(--muted);font-size:8.5px;font-weight:680;text-overflow:ellipsis;white-space:nowrap}
    .tiles dd{margin:2px 0 0;overflow:hidden;font-size:13px;font-weight:750;font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap}.tiles dd small{color:var(--muted);font-size:9px;font-weight:560}
    .stack-list{margin:10px 0 0;padding:0;list-style:none;border-top:1px solid var(--line)}
    .stack-list li{display:grid;grid-template-columns:9px minmax(0,1fr) auto;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--line);font-size:11px}
    .stack-list__name{min-width:0;overflow:hidden;font-weight:650;text-overflow:ellipsis;white-space:nowrap}
    .stack-list__facts{display:grid;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.stack-list__facts small{color:var(--muted);font-size:9.5px}
    .btn--block{width:100%;margin-top:10px}
    /* ---- the tray: what still has to go on a pallet */
    .tray{display:grid;gap:8px;padding:10px;border:1px solid #eddcb9;border-radius:12px;background:var(--warn-soft)}.tray--ok{border-color:color-mix(in srgb,var(--ok) 40%,transparent);background:color-mix(in srgb,var(--ok) 8%,var(--surface))}
    .tray__progress{display:flex;align-items:baseline;justify-content:space-between;gap:10px;font-size:11.5px}.tray__progress em{color:var(--warn);font-size:10.5px;font-style:normal;font-weight:700}.tray--ok .tray__progress em{color:var(--ok)}
    .tray__bar{height:6px;border-radius:99px;background:rgb(0 0 0/.08);overflow:hidden}.tray__bar i{display:block;height:100%;border-radius:99px;background:var(--ok)}.tray__bar i.is-warn{background:var(--danger)}
    .tray__chips{display:flex;flex-wrap:wrap;gap:6px}
    .chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:5px 9px;border:1px solid var(--line);border-radius:999px;background:var(--surface);font-size:11px;line-height:1.2}
    .chip b{padding:0 6px;border-radius:999px;background:var(--surface-2);font-size:10.5px}.chip--add{cursor:pointer;color:var(--rose-dark);font:inherit;font-size:11px;font-weight:650}.chip--add:hover{border-color:var(--rose-line);background:var(--rose-soft)}
    .tray__actions{display:flex;flex-wrap:wrap;gap:6px}.tray__actions .btn{min-height:36px}.btn--quiet{border-color:transparent;background:transparent;color:var(--rose-dark)}
    /* ---- the pallets */
    .pallet-grid{display:grid;gap:8px;margin-top:10px}
    .pallet{position:relative;min-width:0;border:1px solid var(--line);border-radius:12px;background:var(--surface);transition:transform .16s ease,opacity .16s ease,box-shadow .16s ease}
    .pallet--empty{border-style:dashed}.pallet--dragging{z-index:2;opacity:.56;transform:scale(.985)}.pallet--target{box-shadow:0 0 0 2px var(--rose-dark),0 8px 18px rgb(31 25 22/.12)}
    .pallet__head{display:grid;grid-template-columns:34px 26px minmax(0,1fr) auto 34px;align-items:center;gap:6px;padding:6px 6px 6px 4px}
    .pallet__drag,.pallet__remove{width:34px;height:38px;display:grid;place-items:center;padding:0;border:0;border-radius:9px;background:transparent;font:inherit;cursor:pointer}
    .pallet__drag{color:var(--muted);font-size:18px;touch-action:none;cursor:grab}.pallet__drag:active{cursor:grabbing;background:var(--rose-soft);color:var(--rose-dark)}
    .pallet__remove{color:var(--danger);font-size:22px}.pallet__remove:hover,.pallet__remove:focus-visible{background:var(--danger-soft)}.pallet__drag:disabled,.pallet__remove:disabled{cursor:default;opacity:.45}
    .pallet__number{width:26px;height:26px;display:grid;place-items:center;border-radius:8px;background:var(--rose-soft);color:var(--rose-dark);font-size:11px;font-weight:760}
    .pallet__name{min-width:0;height:34px;padding:0 6px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--ink);font:inherit;font-size:13px;font-weight:700}.pallet__name:hover:not(:disabled),.pallet__name:focus{border-color:var(--line-strong);background:var(--surface-2);outline:none}
    .pallet__facts{color:var(--muted);font-size:10.5px;white-space:nowrap;font-variant-numeric:tabular-nums}.pallet__facts.is-warn{color:var(--danger);font-weight:700}
    .pallet__empty-remove{padding:0;border:0;background:none;color:var(--rose-dark);font:inherit;font-weight:650;text-decoration:underline;cursor:pointer}
    .pallet__stack{margin:0 10px;height:10px;border-radius:99px;background:var(--surface-2);overflow:hidden}
    .pallet__stack-fill{display:flex;height:100%;max-width:100%;border-radius:99px;overflow:hidden;transition:width .2s ease}.pallet__stack-fill b{display:block;min-width:3px;height:100%}.pallet__stack-fill.is-warn{outline:2px solid var(--danger);outline-offset:-2px}
    .pallet__items{padding:6px 10px 8px}
    .pallet__item{display:grid;grid-template-columns:9px minmax(0,1fr) auto;align-items:center;gap:8px;min-height:48px;border-bottom:1px solid var(--line)}
    .pallet__item-name{display:grid;min-width:0;font-size:11.5px;line-height:1.3}.pallet__item-name small{color:var(--muted);font-size:9.5px}
    .pallet__empty{margin:6px 0;color:var(--muted);font-size:11px}
    .stepper{height:36px;display:flex;border:1px solid var(--line-strong);border-radius:9px;overflow:hidden;background:var(--surface)}
    .stepper button{width:36px;border:0;background:transparent;color:var(--ink);font:inherit;font-size:16px;cursor:pointer}.stepper button:disabled{color:var(--line-strong);cursor:default}
    .stepper input{width:44px;border:0;border-inline:1px solid var(--line);font:inherit;font-size:12px;font-weight:700;text-align:center;-moz-appearance:textfield}
    .stepper input::-webkit-inner-spin-button,.stepper input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
    .pallet__add{display:flex;flex-wrap:wrap;gap:6px;padding-top:8px}
    .pallet__more{border-top:1px solid var(--line)}.pallet__more summary{list-style:none;padding:8px 10px;color:var(--muted);font-size:10.5px;cursor:pointer}.pallet__more summary::-webkit-details-marker{display:none}.pallet__more summary::before{content:'⚙ ';color:var(--muted)}
    .pallet__more-body{display:grid;gap:10px;padding:0 10px 10px}
    .pallet__order{display:flex;align-items:center;gap:4px;color:var(--muted);font-size:10.5px}.pallet__order button{width:36px;height:34px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--rose-dark);font:inherit;cursor:pointer}.pallet__order button:disabled{opacity:.4;cursor:default}
    /* ---- freight */
    .price-choices{display:grid;gap:6px}
    .price-choices button{min-height:52px;padding:8px 10px;display:flex;flex-direction:column;justify-content:center;border:1px solid var(--line);border-radius:11px;background:var(--surface);color:var(--ink);font:inherit;text-align:left;cursor:pointer}
    .price-choices strong{font-size:11.5px}.price-choices small{margin-top:1px;color:var(--muted);font-size:9.5px;line-height:1.3}
    .price-choice--active{border-color:var(--rose-line)!important;background:var(--rose-soft)!important;box-shadow:0 0 0 1px var(--rose-line)}
    .freight-detail{display:grid;gap:10px;margin-top:10px;padding:10px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}
    .breakdown{margin:0;display:grid;gap:4px;padding:9px 11px;border:1px solid var(--line);border-radius:10px;background:var(--surface)}
    .breakdown div{display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:11.5px}.breakdown dt{color:var(--muted)}.breakdown dd{margin:0;font-weight:650;font-variant-numeric:tabular-nums}.breakdown dd small{color:var(--muted);font-weight:550}
    .breakdown__total{margin-top:2px;padding-top:6px;border-top:1px dashed var(--line);font-weight:760}.breakdown__total dt{color:var(--ink)}
    .pending-toggle{display:flex;align-items:center;gap:10px;margin-top:10px;padding:9px 11px;border:1px solid var(--line);border-radius:12px;background:var(--surface);cursor:pointer}
    .pending-toggle--on{border-color:#eddcb9;background:var(--warn-soft)}.pending-toggle input{width:20px;height:20px;flex:none;accent-color:var(--rose)}
    .pending-toggle span{display:grid;gap:1px;min-width:0}.pending-toggle strong{font-size:12px}.pending-toggle small{color:var(--muted);font-size:10.5px;line-height:1.3}
    /* ---- a desk: everything open, the pallets take the room */
    @media(min-width:800px){
      .plan-columns{grid-template-columns:minmax(270px,320px) minmax(0,1fr);grid-template-rows:auto 1fr;grid-template-areas:'mode layout' 'freight layout';align-items:start}
      .plan-section--mode{grid-area:mode}.plan-section--layout{grid-area:layout}.plan-section--freight{grid-area:freight}
      .plan-section__body{display:block}.plan-section__toggle{cursor:default}.plan-section__toggle i{display:none}
      .pallet-grid{grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}
      .plan-summary__tile.is-open{border-color:var(--line);background:var(--surface-2);box-shadow:none}
      .price-choices button{min-height:46px}
      .plan-summary__tile strong{font-size:15px}
    }
    @media(max-width:359px){.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.plan-summary{grid-template-columns:1fr}.plan-summary__tile{grid-template-columns:auto 1fr;align-items:center}}
    @media(prefers-reduced-motion:reduce){.pallet{transition:none}}
  `],
})
export class ShippingPlanner {
  readonly view = input.required<SalesOrderView>();
  readonly canEdit = input(true);
  readonly carriers = input<Carrier[]>([]);
  readonly customerPostcode = input<string | null>(null);
  readonly countryName = input<string | null>(null);

  private readonly sales = inject(SalesApi);
  readonly carrierBreakdown = signal<CarrierShipQuote | null>(null);
  readonly carrierQuoteMissing = signal(false);

  /** Which part unfolds on a phone; a desk shows all three. */
  readonly openSection = signal<PlannerSection>('layout');

  constructor() {
    /* The breakdown mirrors what the backend already priced: same zone
       resolution, same rungs - fetched purely to show the why. */
    effect(() => {
      const data = this.view();
      const carrierId = data.order.freightCarrierId;
      const postcode = this.customerPostcode();
      if (this.pricingStrategy() !== 'CARRIER' || !carrierId || !data.order.countryCode) {
        this.carrierBreakdown.set(null);
        this.carrierQuoteMissing.set(false);
        return;
      }
      const totals = data.priced.totals;
      const pallets = totals.palletsManual || totals.palletsStrict;
      void this.sales.carrierQuote(carrierId, {
        country: data.order.countryCode,
        postcode,
        pallets,
        palletType: data.order.palletProfile === 'BLOCK_120X100' ? 'BLOCK'
          : data.order.palletProfile === 'HALF_80X60' ? 'HALF' : 'EURO',
        weightKg: totals.weightKg ?? null,
      }).then((quote) => {
        this.carrierBreakdown.set(quote);
        this.carrierQuoteMissing.set(quote === null && pallets > 0);
      }).catch(() => {
        this.carrierBreakdown.set(null);
        this.carrierQuoteMissing.set(false);
      });
    });
  }

  toggleSection(section: PlannerSection): void {
    this.openSection.set(section);
  }

  setCarrierExtra(raw: string): void {
    if (!this.canEdit()) return;
    const value = raw.trim() === '' ? null : Math.max(0, Number(raw) || 0);
    this.patch.emit({ freightCarrierExtraEur: value, freightPricingStrategy: 'CARRIER' });
  }

  setCarrier(raw: string): void {
    const id = Number(raw);
    if (!this.canEdit() || !Number.isInteger(id) || id <= 0) return;
    this.patch.emit({ freightCarrierId: id, freightPricingStrategy: 'CARRIER' });
  }
  readonly patch = output<ShippingOrderPatch>();
  readonly action = output<ShippingPalletAction>();

  readonly draggingIndex = signal<number | null>(null);
  readonly dropTargetIndex = signal<number | null>(null);
  readonly reorderAnnouncement = signal('');
  private dragPointerId: number | null = null;
  private dragSourceIndex: number | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragScrollHost: HTMLElement | null = null;

  readonly order = computed(() => this.view().order);
  readonly loadMode = computed<LoadMode>(() => this.order().loadMode ?? 'PALLETS');
  readonly palletProfile = computed<PalletProfile>(
    () => this.order().palletProfile ?? 'EURO_120X80');
  readonly maxPalletHeightCm = computed(() =>
    this.view().priced.totals.palletMaxHeightCm ?? this.order().maxPalletHeightCm ?? 260);
  readonly palletBaseHeightCm = computed(() =>
    this.view().priced.totals.palletBaseHeightCm ?? 14.4);
  readonly palletCount = computed(() => {
    const totals = this.view().priced.totals;
    return totals.palletsManual || totals.palletsStrict;
  });
  readonly pricingStrategy = computed<FreightPricingStrategy>(() => {
    const order = this.order();
    if (order.freightPricingStrategy) return order.freightPricingStrategy;
    if (order.manualFreightEur != null) return 'FIXED';
    return this.loadMode() === 'LOOSE_CARTONS' ? 'PER_CBM' : 'COUNTRY_PALLET';
  });
  readonly freightPending = computed(() => this.order().freight === 'TE_BEPALEN');
  readonly missingCartonDimensions = computed(() =>
    this.view().priced.validation.productsWithoutCartonDimensions ?? []);
  readonly invalidPalletLines = computed(() => this.view().priced.lines
    .filter((line) => line.cartons > 0 && line.cartonsPerPallet <= 0));
  readonly preservedLayoutMatches = computed(() => {
    const data = this.view();
    if (!data.order.pallets.length) return true;
    if (data.order.pallets.some((pallet) => !pallet.items.length
        || pallet.items.some((item) => item.cartons <= 0))) return false;
    if (data.order.pallets.some((pallet) => pallet.heightCm != null
        && (pallet.heightCm < this.palletBaseHeightCm()
          || pallet.heightCm > this.maxPalletHeightCm()))) return false;
    const lineIds = new Set(data.priced.lines.map((line) => line.productId));
    if (data.order.pallets.some((pallet) =>
        pallet.items.some((item) => !lineIds.has(item.productId)))) return false;
    return data.priced.lines.every((line) =>
      data.order.pallets.flatMap((pallet) => pallet.items)
        .filter((item) => item.productId === line.productId)
        .reduce((sum, item) => sum + item.cartons, 0) === line.cartons);
  });

  /* ---- the strip and the section headers ---- */
  loadSummary(): string {
    const totals = this.view().priced.totals;
    if (this.loadMode() === 'LOOSE_CARTONS') {
      return `${this.formatNumber(totals.cartons)} ${totals.cartons === 1 ? 'doos' : 'dozen'}`;
    }
    const count = this.palletCount();
    return `${this.formatNumber(count)} ${count === 1 ? 'pallet' : 'pallets'}`;
  }

  loadDetail(): string {
    const totals = this.view().priced.totals;
    if (this.loadMode() === 'LOOSE_CARTONS') return `losse dozen · ${this.formatCbm(totals.cbm)}`;
    return `${this.formatNumber(totals.cartons)} dozen · ${this.formatCbm(totals.cbm)}`;
  }

  layoutSummary(): string {
    if (this.loadMode() === 'LOOSE_CARTONS') return this.formatCbm(this.view().priced.totals.cbm);
    if (!this.view().order.pallets.length) return 'Automatisch voorstel';
    return 'Zelf ingedeeld';
  }

  layoutDetail(): string {
    if (this.loadMode() === 'LOOSE_CARTONS') {
      return this.missingCartonDimensions().length ? 'buitenmaten ontbreken' : 'uit de omdoosmaten';
    }
    if (!this.view().order.pallets.length) {
      return this.invalidPalletLines().length ? 'stapeling niet mogelijk' : `max. ${this.formatNumber(this.maxPalletHeightCm())} cm`;
    }
    return this.layoutOk() ? 'compleet' : this.layoutStatus();
  }

  layoutState(): 'ok' | 'warn' | 'plain' {
    if (this.loadMode() === 'LOOSE_CARTONS') return this.missingCartonDimensions().length ? 'warn' : 'plain';
    if (!this.view().order.pallets.length) return this.invalidPalletLines().length ? 'warn' : 'plain';
    return this.layoutOk() ? 'ok' : 'warn';
  }

  strategyLabel(strategy: FreightPricingStrategy): string {
    switch (strategy) {
      case 'COUNTRY_PALLET': return 'Landentarief';
      case 'CARRIER': return this.carriers().find((carrier) => carrier.id === this.order().freightCarrierId)?.name
        ?? 'Verzendorganisatie';
      case 'PER_CBM': return 'Per m³';
      case 'FIXED': return 'Vast bedrag';
      case 'PICKUP': return 'Afhalen';
      default: return strategy;
    }
  }

  private formatNumber(value: number): string {
    return new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 0 }).format(value);
  }

  private formatCbm(value: number): string {
    return `${new Intl.NumberFormat('nl-BE', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(value)} m³`;
  }

  /* ---- the pallets as they stack up ---- */
  productColour(productId: number): string {
    const index = this.view().priced.lines.findIndex((line) => line.productId === productId);
    return PALLET_PRODUCT_COLOURS[(index < 0 ? 0 : index) % PALLET_PRODUCT_COLOURS.length];
  }

  stackOf(pallet: OrderPallet): { heightCm: number | null; measured: boolean } {
    return estimatePalletHeightCm(pallet, this.view().priced.lines, this.palletBaseHeightCm());
  }

  /** Where the stack stands against the loading height; never past the bar. */
  fillPercent(heightCm: number | null): number {
    if (heightCm === null) return 0;
    const max = this.maxPalletHeightCm() || 1;
    return Math.max(4, Math.min(100, (heightCm / max) * 100));
  }

  cartonsFor(productId: number): number {
    return this.view().priced.lines.find((line) => line.productId === productId)?.cartons ?? 0;
  }

  assignedCartons(): number {
    return this.view().order.pallets.flatMap((pallet) => pallet.items)
      .reduce((sum, item) => sum + item.cartons, 0);
  }

  assignedPercent(): number {
    const total = this.view().priced.totals.cartons;
    return total > 0 ? Math.min(100, (this.assignedCartons() / total) * 100) : 0;
  }

  overassignedAny(): boolean {
    return this.overassigned();
  }

  unassignedLines(): { productId: number; description: string; remaining: number }[] {
    return this.view().priced.lines
      .map((line) => ({ productId: line.productId, description: line.description,
        remaining: this.remainingFor(line.productId) }))
      .filter((line) => line.remaining > 0);
  }

  /** Rebuilds the layout from the calculator's stacking, dropping the hand-made one. */
  redoLayout(): void {
    if (!this.canEdit()) return;
    const confirmed = window.confirm(
      'Je eigen indeling wordt vervangen door een nieuwe automatische indeling. Doorgaan?',
    );
    if (confirmed) this.action.emit({ type: 'auto-layout' });
  }

  chooseLoadMode(mode: LoadMode): void {
    if (!this.canEdit() || mode === this.loadMode()) return;
    const current = this.pricingStrategy();
    const strategy = mode === 'LOOSE_CARTONS'
        && (current === 'COUNTRY_PALLET' || current === 'CARRIER')
      ? 'FIXED' : current;
    const changes: ShippingOrderPatch = {
      loadMode: mode,
      freightPricingStrategy: strategy,
      freightRatePerCbmEur: strategy === 'PER_CBM'
        ? this.order().freightRatePerCbmEur : null,
      manualFreightEur: strategy === 'FIXED' ? this.order().manualFreightEur : null,
    };
    if (mode === 'PALLETS' && !this.preservedLayoutMatches()) changes.pallets = [];
    this.patch.emit(changes);
  }

  setPalletProfile(profile: PalletProfile): void {
    if (this.canEdit()) this.patch.emit({ palletProfile: profile });
  }

  setMaxHeight(raw: string): void {
    if (!this.canEdit()) return;
    const height = Math.max(50, Math.min(300, Math.round(Number(raw) || 260)));
    this.patch.emit({ maxPalletHeightCm: height });
  }

  palletProfileLabel(): string {
    return {
      EURO_120X80: 'Euro · B × D · 120 × 80',
      BLOCK_120X100: 'Blok · B × D · 120 × 100',
      HALF_80X60: 'Half · B × D · 80 × 60',
    }[this.palletProfile()];
  }

  invalidPalletLineNames(): string {
    return this.invalidPalletLines().map((line) => line.description).join(', ');
  }

  choosePricing(strategy: FreightPricingStrategy): void {
    if (!this.canEdit()) return;
    const fixed = strategy === 'FIXED'
      ? this.order().manualFreightEur
        ?? (this.freightPending() ? null : this.view().priced.totals.freight)
      : null;
    this.patch.emit({
      freight: this.freightPending() ? 'TE_BEPALEN' : 'BEREKEND',
      freightPricingStrategy: strategy,
      freightRatePerCbmEur: strategy === 'PER_CBM'
        ? this.order().freightRatePerCbmEur : null,
      manualFreightEur: fixed,
      freightCarrierId: strategy === 'CARRIER'
        ? this.order().freightCarrierId
          ?? this.carriers().find((carrier) => carrier.active)?.id ?? this.carriers()[0]?.id
        : this.order().freightCarrierId,
    });
  }

  setPending(pending: boolean): void {
    if (this.canEdit()) this.patch.emit({ freight: pending ? 'TE_BEPALEN' : 'BEREKEND' });
  }

  setCbmRate(raw: string): void {
    if (!this.canEdit()) return;
    const value = raw.trim() === '' ? null : Math.max(0, Number(raw) || 0);
    this.patch.emit({ freight: this.freightPending() ? 'TE_BEPALEN' : 'BEREKEND',
      freightPricingStrategy: 'PER_CBM',
      freightRatePerCbmEur: value, manualFreightEur: null });
  }

  setFixedFreight(raw: string): void {
    if (!this.canEdit()) return;
    const value = raw.trim() === '' ? null : Math.max(0, Number(raw) || 0);
    this.patch.emit({ freight: this.freightPending() ? 'TE_BEPALEN' : 'BEREKEND',
      freightPricingStrategy: 'FIXED',
      freightRatePerCbmEur: null, manualFreightEur: value });
  }

  palletCartons(pallet: OrderPallet): number {
    return pallet.items.reduce((sum, item) => sum + item.cartons, 0);
  }

  productLabel(productId: number): string {
    return this.view().priced.lines.find((line) => line.productId === productId)?.description
      ?? `Product #${productId}`;
  }

  assignedFor(productId: number): number {
    return this.view().order.pallets
      .flatMap((pallet) => pallet.items)
      .filter((item) => item.productId === productId)
      .reduce((sum, item) => sum + item.cartons, 0);
  }

  remainingFor(productId: number): number {
    const line = this.view().priced.lines.find((item) => item.productId === productId);
    return line ? Math.max(0, line.cartons - this.assignedFor(productId)) : 0;
  }

  assignable(palletIndex: number): { productId: number; description: string; remaining: number }[] {
    const onPallet = new Set(
      this.view().order.pallets[palletIndex]?.items.map((item) => item.productId) ?? []);
    return this.view().priced.lines
      .filter((line) => !onPallet.has(line.productId))
      .map((line) => ({ productId: line.productId, description: line.description,
        remaining: this.remainingFor(line.productId) }))
      .filter((line) => line.remaining > 0);
  }

  layoutOk(): boolean {
    const pallets = this.view().order.pallets;
    const lineIds = new Set(this.view().priced.lines.map((line) => line.productId));
    return pallets.every((pallet) => pallet.items.length > 0
        && pallet.items.every((item) => item.cartons > 0 && lineIds.has(item.productId))
        && (pallet.heightCm == null
          || (pallet.heightCm >= this.palletBaseHeightCm()
            && pallet.heightCm <= this.maxPalletHeightCm())))
      && this.view().priced.totals.unassignedCartons === 0
      && !this.overassigned();
  }

  layoutStatus(): string {
    if (this.view().order.pallets.some((pallet) => !pallet.items.length)) {
      return 'lege pallet verwijderen';
    }
    if (this.view().order.pallets.some((pallet) =>
        pallet.items.some((item) => item.cartons <= 0))) {
      return 'ongeldig aantal dozen';
    }
    const lineIds = new Set(this.view().priced.lines.map((line) => line.productId));
    if (this.view().order.pallets.some((pallet) =>
        pallet.items.some((item) => !lineIds.has(item.productId)))) {
      return 'verwijderd product aanwezig';
    }
    if (this.view().order.pallets.some((pallet) => pallet.heightCm != null
        && (pallet.heightCm < this.palletBaseHeightCm()
          || pallet.heightCm > this.maxPalletHeightCm()))) {
      return 'pallethoogte buiten laadhoogte';
    }
    if (this.overassigned()) return 'te veel dozen toegewezen';
    const loose = this.view().priced.totals.unassignedCartons;
    if (loose > 0) {
      return loose === 1 ? '1 doos niet toegewezen' : `${this.formatNumber(loose)} dozen niet toegewezen`;
    }
    return 'compleet';
  }

  private overassigned(): boolean {
    return this.view().priced.lines.some((line) => this.assignedFor(line.productId) > line.cartons);
  }

  renamePallet(index: number, label: string): void {
    if (this.canEdit()) this.action.emit({ type: 'rename-pallet', index, label: label.trim() });
  }

  displayPalletType(value: string): string {
    return normalizeManualPalletType(value);
  }

  setPalletType(index: number, palletType: string): void {
    if (this.canEdit()) {
      this.action.emit({
        type: 'set-pallet-type',
        index,
        palletType: normalizeManualPalletType(palletType),
      });
    }
  }

  setPalletHeight(index: number, raw: string): void {
    if (!this.canEdit()) return;
    const rounded = Math.round(Number(raw));
    const heightCm = raw.trim() === '' || !Number.isFinite(rounded) || rounded <= 0
      ? null
      : Math.max(this.minimumManualHeightCm(), Math.min(this.maximumManualHeightCm(), rounded));
    this.action.emit({ type: 'set-pallet-height', index, heightCm });
  }

  minimumManualHeightCm(): number {
    return Math.ceil(this.palletBaseHeightCm());
  }

  maximumManualHeightCm(): number {
    return Math.floor(this.maxPalletHeightCm());
  }

  addItem(palletIndex: number, productId: number): void {
    if (this.canEdit() && productId) this.action.emit({ type: 'add-item', palletIndex, productId });
  }

  setItemCartons(palletIndex: number, productId: number, cartons: number): void {
    if (!this.canEdit()) return;
    this.action.emit({ type: 'set-item-cartons', palletIndex, productId,
      cartons: Math.max(0, Math.floor(cartons || 0)) });
  }

  movePallet(index: number, direction: -1 | 1): void {
    if (!this.canEdit()) return;
    const target = index + direction;
    if (target < 0 || target >= this.view().order.pallets.length) return;
    this.action.emit({ type: 'move-pallet', index, direction });
    this.reorderAnnouncement.set(
      `Pallet ${index + 1} verplaatst naar positie ${target + 1}.`,
    );
  }

  removePallet(index: number): void {
    if (!this.canEdit()) return;
    this.action.emit({ type: 'remove-pallet', index });
    this.reorderAnnouncement.set(`Pallet ${index + 1} verwijderd.`);
  }

  startPalletDrag(event: PointerEvent, index: number): void {
    if (!this.canEdit() || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.dragPointerId = event.pointerId;
    this.dragSourceIndex = index;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.dragScrollHost = (event.currentTarget as HTMLElement)
      .closest<HTMLElement>('.sheet__body');
    const handle = event.currentTarget as HTMLElement;
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      /* Losing capture merely cancels the drag; it must never save anything. */
    }
  }

  movePalletDrag(event: PointerEvent): void {
    if (event.pointerId !== this.dragPointerId || this.dragSourceIndex === null) return;
    const moved = Math.hypot(
      event.clientX - this.dragStartX,
      event.clientY - this.dragStartY,
    );
    if (moved < 7 && this.draggingIndex() === null) return;
    event.preventDefault();
    if (this.draggingIndex() === null) {
      this.draggingIndex.set(this.dragSourceIndex);
      this.dropTargetIndex.set(this.dragSourceIndex);
    }
    const shell = document.elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>('[data-pallet-index]');
    const rawIndex = shell?.dataset['palletIndex'];
    const target = rawIndex == null ? Number.NaN : Number(rawIndex);
    if (Number.isInteger(target) && target >= 0
        && target < this.view().order.pallets.length) {
      this.dropTargetIndex.set(target);
    }
    this.scrollWhileDragging(event.clientY);
  }

  finishPalletDrag(event: PointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const source = this.draggingIndex();
    const target = this.dropTargetIndex();
    this.releasePointer(event);
    this.resetPalletDrag();
    if (source === null || target === null || source === target) return;
    this.action.emit({ type: 'reorder-pallet', fromIndex: source, toIndex: target });
    this.reorderAnnouncement.set(
      `Pallet ${source + 1} verplaatst naar positie ${target + 1}.`,
    );
  }

  cancelPalletDrag(event: PointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    this.releasePointer(event);
    this.resetPalletDrag();
  }

  movePalletWithKeyboard(event: KeyboardEvent, index: number): void {
    if (!this.canEdit() || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    const toIndex = index + (event.key === 'ArrowUp' ? -1 : 1);
    if (toIndex < 0 || toIndex >= this.view().order.pallets.length) return;
    event.preventDefault();
    event.stopPropagation();
    this.action.emit({ type: 'reorder-pallet', fromIndex: index, toIndex });
    this.reorderAnnouncement.set(
      `Pallet ${index + 1} verplaatst naar positie ${toIndex + 1}.`,
    );
  }

  private scrollWhileDragging(pointerY: number): void {
    const host = this.dragScrollHost;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const edge = Math.min(72, rect.height / 4);
    if (pointerY < rect.top + edge) host.scrollTop -= 14;
    else if (pointerY > rect.bottom - edge) host.scrollTop += 14;
  }

  private releasePointer(event: PointerEvent): void {
    const handle = event.currentTarget as HTMLElement;
    try {
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    } catch {
      /* The browser may already have released capture on cancellation. */
    }
  }

  private resetPalletDrag(): void {
    this.dragPointerId = null;
    this.dragSourceIndex = null;
    this.dragScrollHost = null;
    this.draggingIndex.set(null);
    this.dropTargetIndex.set(null);
  }

  returnToAutomatic(): void {
    if (!this.canEdit()) return;
    const confirmed = window.confirm(
      'Je eigen palletindeling wordt verwijderd. Terug naar het automatische voorstel?',
    );
    if (confirmed) this.action.emit({ type: 'clear-layout' });
  }
}
