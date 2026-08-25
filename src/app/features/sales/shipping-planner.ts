import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import {
  FreightPricingStrategy, LoadMode, OrderPallet, PalletProfile, SalesOrderView,
  Carrier, CarrierShipQuote,
} from '../../core/api/models';
import { CbmPipe, EurPipe, NumPipe, PctPipe } from '../../shared/pipes';
import { SalesApi } from '../../core/api/sales-api';

/** Canonical B × D labels; also upgrades the two historical D × B values. */
export function normalizeManualPalletType(value: string): string {
  const trimmed = value.trim();
  const key = trimmed.toLocaleLowerCase('nl-BE').replace(/\s+/g, '').replace(/x/g, '×');
  if (key === 'blokpallet120×100' || key === 'blokpallet100×120') {
    return 'Blokpallet 120×100';
  }
  if (key === 'halvepallet80×60' || key === 'halvepallet60×80') {
    return 'Halve pallet 80×60';
  }
  if (key === 'europallet' || key === 'europallet120×80') return 'Europallet';
  return trimmed;
}

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

/**
 * Mobile-first shipping planner used inside the sales editor sheet.
 *
 * The component only explains and collects choices. The sales editor keeps
 * ownership of its serial save queue and the backend remains the only place
 * that calculates pallet fits, CBM and freight amounts.
 */
@Component({
  selector: 'app-shipping-planner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CbmPipe, EurPipe, NumPipe, PctPipe],
  template: `
    <div class="planner">
      <section aria-labelledby="load-choice-title">
        <div class="planner__intro">
          <div>
            <span class="eyebrow">Verzendwijze</span>
            <h3 id="load-choice-title">Hoe gaat deze bestelling mee?</h3>
          </div>
          <span class="result-pill">
            {{ view().priced.totals.cartons | num }}
            {{ view().priced.totals.cartons === 1 ? 'doos' : 'dozen' }}
          </span>
        </div>

        <div class="choice-grid" role="radiogroup" aria-label="Verzendwijze">
          <button class="choice-card" type="button" role="radio"
                  [class.choice-card--active]="loadMode() === 'PALLETS'"
                  [attr.aria-checked]="loadMode() === 'PALLETS'"
                  [disabled]="!canEdit()" (click)="chooseLoadMode('PALLETS')">
            <span class="choice-card__icon" aria-hidden="true">▦</span>
            <span class="choice-card__copy">
              <strong>Op pallets</strong>
              <small>Stapelen op vloermaat en beschikbare laadhoogte</small>
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
            <p class="preserved-layout">
              Je handmatige palletindeling blijft bewaard, maar telt niet mee zolang
              ‘Losse dozen’ is gekozen.
            </p>
          } @else {
            <p class="preserved-layout preserved-layout--warn">
              De bewaarde palletindeling past niet meer bij de producten, aantallen of laadhoogte.
              Bij terugschakelen naar pallets herstellen we daarom de automatische berekening.
            </p>
          }
        }
      </section>

      @if (loadMode() === 'PALLETS') {
        @if (!view().order.pallets.length) {
          <section class="calculation" aria-labelledby="pallet-result-title">
          <div class="calculation__head">
            <div>
              <span class="eyebrow">Voorstel</span>
              <h3 id="pallet-result-title">Automatische indeling</h3>
            </div>
            <span class="calculation__status">
              {{ palletCount() }} {{ palletCount() === 1 ? 'pallet' : 'pallets' }}
            </span>
          </div>
          <dl class="result-grid">
            <div><dt>Pallets</dt><dd>{{ palletCount() | num }}</dd></div>
            <div><dt>Laadhoogte</dt><dd>{{ maxPalletHeightCm() | num }} <small>cm</small></dd></div>
            <div><dt>Volume dozen</dt><dd>{{ view().priced.totals.cbm | cbm }}</dd></div>
          </dl>
          <p class="formula-note">
            Dozen per laag × lagen binnen {{ maxPalletHeightCm() | num }} cm,
            begrensd door gewicht. De pallet van {{ palletBaseHeightCm() | num }} cm telt mee.
          </p>
          @if (invalidPalletLines().length) {
            <div class="layout-warning invalid-fit" id="invalid-pallet-fit" role="alert">
              <strong>Zelf aanpassen is nog niet mogelijk</strong>
              <span>
                Controleer omdoosafmetingen, gewicht of laadhoogte voor
                {{ invalidPalletLineNames() }}.
              </span>
            </div>
          }

          <details class="pallet-settings">
            <summary>
              <span>
                <strong>Berekeningsinstellingen</strong>
                <small>{{ palletProfileLabel() }} · max. {{ maxPalletHeightCm() | num }} cm</small>
              </span>
            </summary>
            <div class="pallet-settings__body">
              <div class="field-row">
                <label for="shipping-pallet-profile">Pallettype</label>
                <select id="shipping-pallet-profile" class="select" [value]="palletProfile()"
                        [disabled]="!canEdit()"
                        (change)="setPalletProfile($any($event.target).value)">
                  <option value="EURO_120X80">Europallet · B × D · 120 × 80 cm</option>
                  <option value="BLOCK_120X100">Blokpallet · B × D · 120 × 100 cm</option>
                  <option value="HALF_80X60">Halve pallet · B × D · 80 × 60 cm</option>
                </select>
              </div>
              <div class="height-row">
                <div>
                  <label for="shipping-max-height">Max. totale pallethoogte</label>
                  <small>Inclusief pallet. Standaard afgestemd op de laadhoogte.</small>
                </div>
                <div class="height-input">
                  <input id="shipping-max-height" class="input num" type="number"
                         min="50" max="300" step="1" inputmode="numeric"
                         [value]="maxPalletHeightCm()" [disabled]="!canEdit()"
                         (change)="setMaxHeight($any($event.target).value)" />
                  <span>cm</span>
                </div>
              </div>
              @if (order().maxPalletHeightCm != null) {
                <button class="text-action" type="button" [disabled]="!canEdit()"
                        (click)="patch.emit({ maxPalletHeightCm: null })">
                  Terug naar standaardhoogte
                </button>
              }
              <div class="stacking-list" aria-label="Berekening per product">
                @for (line of view().priced.lines; track line.productId) {
                  <div>
                    <span>{{ line.description }}</span>
                    @if (line.cartonsPerLayer && line.palletLayers) {
                      <small>
                        Max. {{ line.cartonsPerPallet }} dozen/pallet ·
                        {{ line.cartonsPerLayer }} per laag · hoogste stapel
                        {{ line.palletLayers }} {{ line.palletLayers === 1 ? 'laag' : 'lagen' }}
                        @if (line.calculatedPalletHeightCm) {
                          · {{ line.calculatedPalletHeightCm | num }} cm
                        }
                      </small>
                    } @else {
                      <small class="danger-text">Geen geldige palletberekening</small>
                    }
                  </div>
                }
              </div>
            </div>
          </details>

          <div class="manual-start">
            <span>
              <strong>Uitzondering in de indeling?</strong>
              <small>Maak van dit voorstel direct een bewerkbare palletlijst.</small>
            </span>
            <button class="btn btn--primary" type="button"
                    [disabled]="!canEdit() || !view().priced.lines.length
                      || invalidPalletLines().length > 0"
                    [attr.aria-describedby]="invalidPalletLines().length
                      ? 'invalid-pallet-fit' : null"
                    (click)="action.emit({ type: 'auto-layout' })">
              Zelf aanpassen
            </button>
          </div>
        </section>
        } @else {
          <section class="calculation manual-workspace" aria-labelledby="manual-layout-title">
            <div class="calculation__head manual-workspace__head">
              <div>
                <span class="eyebrow">Verzendindeling</span>
                <h3 id="manual-layout-title">Zelf ingedeeld</h3>
                <p>
                  {{ view().order.pallets.length }}
                  {{ view().order.pallets.length === 1 ? 'pallet' : 'pallets' }} ·
                  pas alleen de uitzonderingen aan
                </p>
              </div>
              <span class="layout-badge" [class.layout-badge--warn]="!layoutOk()">
                {{ layoutOk() ? 'compleet' : layoutStatus() }}
              </span>
            </div>

            @if (!layoutOk()) {
              <div class="layout-warning" role="status">{{ layoutStatus() }}.</div>
            }

            <div class="manual-toolbar" aria-label="Acties voor eigen palletindeling">
              <button class="manual-toolbar__add" type="button" [disabled]="!canEdit()"
                      (click)="action.emit({ type: 'add-pallet' })">
                <span aria-hidden="true">＋</span> Pallet toevoegen
              </button>
              <button class="manual-toolbar__reset" type="button" [disabled]="!canEdit()"
                      (click)="returnToAutomatic()">
                Terug naar automatisch voorstel
              </button>
            </div>

            <p class="sr-only" aria-live="polite">{{ reorderAnnouncement() }}</p>
            <div class="pallet-list">
              <!-- Persistence rebuilds pallet rows after every save, so database ids are
                   intentionally not a UI identity. Tracking the position keeps an open
                   card and its focused input intact while the fresh response arrives. -->
              @for (pallet of view().order.pallets; track $index; let pi = $index) {
                <div class="pallet-card-shell" [attr.data-pallet-index]="pi"
                     [class.pallet-card-shell--dragging]="draggingIndex() === pi"
                     [class.pallet-card-shell--target]="draggingIndex() !== null
                       && dropTargetIndex() === pi && draggingIndex() !== pi">
                  <button class="pallet-card__drag" type="button" [disabled]="!canEdit()"
                          [attr.aria-label]="'Pallet ' + (pi + 1)
                            + ' verplaatsen. Sleep of gebruik de pijltjestoetsen.'"
                          (pointerdown)="startPalletDrag($event, pi)"
                          (pointermove)="movePalletDrag($event)"
                          (pointerup)="finishPalletDrag($event)"
                          (pointercancel)="cancelPalletDrag($event)"
                          (keydown)="movePalletWithKeyboard($event, pi)">
                    <span aria-hidden="true">⠿</span>
                  </button>
                  <button class="pallet-card__remove" type="button" [disabled]="!canEdit()"
                          [attr.aria-label]="'Pallet ' + (pi + 1) + ' verwijderen'"
                          (click)="removePallet(pi)">
                    <span aria-hidden="true">×</span>
                  </button>
                  <details class="pallet-card">
                  <summary>
                    <span class="pallet-card__number">{{ pi + 1 }}</span>
                    <span class="pallet-card__title">
                      <strong>{{ pallet.label || 'Pallet ' + (pi + 1) }}</strong>
                      <small>
                        {{ palletCartons(pallet) | num }}
                        {{ palletCartons(pallet) === 1 ? 'doos' : 'dozen' }}
                        @if (pallet.heightCm) { · {{ pallet.heightCm | num }} cm }
                      </small>
                    </span>
                    <span class="pallet-card__chev" aria-hidden="true">⌄</span>
                  </summary>
                  <div class="pallet-card__body">
                    <div class="pallet-card__meta">
                      <div class="field-row">
                        <label [for]="'pallet-label-' + pi">Naam</label>
                        <input class="input" [id]="'pallet-label-' + pi" [value]="pallet.label"
                               [disabled]="!canEdit()"
                               (change)="renamePallet(pi, $any($event.target).value)" />
                      </div>
                      <div class="field-row">
                        <label [for]="'pallet-type-' + pi">Pallettype voor deze pallet</label>
                        <select class="select" [id]="'pallet-type-' + pi"
                                [value]="displayPalletType(pallet.type)"
                                [disabled]="!canEdit()"
                                (change)="setPalletType(pi, $any($event.target).value)">
                          <option value="Europallet">Europallet · B × D · 120 × 80</option>
                          <option value="Blokpallet 120×100">Blokpallet · B × D · 120 × 100</option>
                          <option value="Halve pallet 80×60">Halve pallet · B × D · 80 × 60</option>
                        </select>
                      </div>
                      <div class="height-row height-row--pallet">
                        <div>
                          <label [for]="'pallet-height-' + pi">Gemeten hoogte</label>
                          <small>Optioneel; leeg gebruikt de berekening.</small>
                        </div>
                        <div class="height-input">
                          <input class="input num" [id]="'pallet-height-' + pi" type="number"
                                 [attr.min]="minimumManualHeightCm()"
                                 [attr.max]="maximumManualHeightCm()" inputmode="numeric"
                                 [value]="pallet.heightCm ?? ''" [disabled]="!canEdit()"
                                 placeholder="auto"
                                 (change)="setPalletHeight(pi, $any($event.target).value)" />
                          <span>cm</span>
                        </div>
                      </div>
                    </div>

                    <div class="pallet-products">
                      @for (item of pallet.items; track item.productId) {
                        <div class="pallet-product">
                          <span class="pallet-product__name">{{ productLabel(item.productId) }}</span>
                          <div class="stepper" aria-label="Aantal dozen">
                            <button type="button" [disabled]="!canEdit()"
                                    [attr.aria-label]="'Doos verwijderen bij ' + productLabel(item.productId)"
                                    (click)="setItemCartons(pi, item.productId, item.cartons - 1)">−</button>
                            <input type="number" min="0" inputmode="numeric" [value]="item.cartons"
                                   [disabled]="!canEdit()"
                                   [attr.aria-label]="'Dozen ' + productLabel(item.productId)"
                                   (change)="setItemCartons(pi, item.productId,
                                             +$any($event.target).value)" />
                            <button type="button" [disabled]="!canEdit() || remainingFor(item.productId) <= 0"
                                    [attr.aria-label]="'Doos toevoegen bij ' + productLabel(item.productId)"
                                    (click)="setItemCartons(pi, item.productId, item.cartons + 1)">+</button>
                          </div>
                        </div>
                      }
                      @if (assignable(pi).length) {
                        <select class="select add-product" aria-label="Product op pallet zetten"
                                [disabled]="!canEdit()"
                                (change)="addItem(pi, +$any($event.target).value);
                                          $any($event.target).selectedIndex = 0">
                          <option value="" selected disabled>Product toevoegen…</option>
                          @for (line of assignable(pi); track line.productId) {
                            <option [value]="line.productId">
                              {{ line.description }} · {{ line.remaining }} dozen over
                            </option>
                          }
                        </select>
                      }
                    </div>

                    <div class="pallet-card__actions">
                      <button type="button" aria-label="Pallet omhoog" [disabled]="!canEdit() || pi === 0"
                              (click)="movePallet(pi, -1)">↑</button>
                      <button type="button" aria-label="Pallet omlaag"
                              [disabled]="!canEdit() || pi === view().order.pallets.length - 1"
                              (click)="movePallet(pi, 1)">↓</button>
                      <span class="pallet-card__move-help">Volgorde aanpassen</span>
                    </div>
                  </div>
                </details>
                </div>
              }
            </div>
          </section>
        }
      } @else {
        <section class="calculation calculation--loose" aria-labelledby="loose-result-title">
          <div class="calculation__head">
            <div>
              <span class="eyebrow">Berekening</span>
              <h3 id="loose-result-title">{{ view().priced.totals.cbm | cbm }} losse lading</h3>
            </div>
            <span class="calculation__status">omdoosdata</span>
          </div>
          <dl class="result-grid">
            <div><dt>Dozen</dt><dd>{{ view().priced.totals.cartons | num }}</dd></div>
            <div><dt>Volume</dt><dd>{{ view().priced.totals.cbm | cbm }}</dd></div>
            <div><dt>Gewicht</dt><dd>{{ view().priced.totals.weightKg | num }} <small>kg</small></dd></div>
          </dl>
          <p class="formula-note">
            Per product: buitenmaat omdoos (B × D × H) × aantal volle dozen. Palletmaten en
            pallethoogte tellen in deze keuze niet mee.
          </p>
          @if (missingCartonDimensions().length) {
            <div class="layout-warning" role="alert">
              Buitenmaten ontbreken voor: {{ missingCartonDimensions().join(', ') }}.
              Het volume is daardoor nog niet compleet.
            </div>
          }
          <details class="volume-breakdown">
            <summary>
              <span>Zo is het volume opgebouwd</span>
              <small>
                {{ view().priced.lines.length }}
                {{ view().priced.lines.length === 1 ? 'product' : 'producten' }}
              </small>
            </summary>
            <div class="volume-breakdown__body">
              @for (line of view().priced.lines; track line.productId) {
                <div>
                  <span>{{ line.description }}</span>
                  <strong>
                    {{ line.cartons | num }} {{ line.cartons === 1 ? 'doos' : 'dozen' }}
                    · {{ line.cbm | cbm }}
                  </strong>
                </div>
              }
            </div>
          </details>
        </section>
      }

      <section class="freight-price" aria-labelledby="freight-price-title">
        <div class="planner__intro">
          <div>
            <span class="eyebrow">Vrachtprijs</span>
            <h3 id="freight-price-title">Hoe berekenen we de vracht?</h3>
          </div>
          @if (order().freight !== 'TE_BEPALEN') {
            <strong>{{ view().priced.totals.freight | eur }}</strong>
          }
        </div>

        <div class="price-choices" role="radiogroup" aria-label="Berekening vrachtprijs">
          @if (loadMode() === 'PALLETS') {
            <button type="button" role="radio" [disabled]="!canEdit()"
                    [class.price-choice--active]="pricingStrategy() === 'COUNTRY_PALLET'"
                    [attr.aria-checked]="pricingStrategy() === 'COUNTRY_PALLET'"
                    (click)="choosePricing('COUNTRY_PALLET')">
              <strong>Landentarief</strong>
              <small>Per pallet, met het minimumtarief van het land</small>
            </button>
          }
          @if (loadMode() === 'PALLETS' && carriers().length) {
            <button type="button" role="radio" [disabled]="!canEdit()"
                    [class.price-choice--active]="pricingStrategy() === 'CARRIER'"
                    [attr.aria-checked]="pricingStrategy() === 'CARRIER'"
                    (click)="choosePricing('CARRIER')">
              <strong>Verzendorganisatie</strong>
              <small>Staffel: zone per postcode, trap per pallet</small>
            </button>
          }
          <button type="button" role="radio" [disabled]="!canEdit()"
                  [class.price-choice--active]="pricingStrategy() === 'FIXED'"
                  [attr.aria-checked]="pricingStrategy() === 'FIXED'"
                  (click)="choosePricing('FIXED')">
            <strong>Vast bedrag</strong>
            <small>Een totaalprijs voor deze offerte</small>
          </button>
          <button type="button" role="radio" [disabled]="!canEdit()"
                  [class.price-choice--active]="pricingStrategy() === 'PICKUP'"
                  [attr.aria-checked]="pricingStrategy() === 'PICKUP'"
                  (click)="choosePricing('PICKUP')">
            <strong>Afhalen</strong>
            <small>De klant haalt op in het magazijn — geen vracht</small>
          </button>
        </div>

        @if (pricingStrategy() === 'CARRIER') {
          <div class="carrier-panel">
            <label class="price-input" for="freight-carrier">
              <span>Verzendorganisatie</span>
              <select class="select" id="freight-carrier" [disabled]="!canEdit()"
                      [value]="order().freightCarrierId ?? ''"
                      (change)="setCarrier($any($event.target).value)">
                @for (carrier of carriers(); track carrier.id) {
                  <option [value]="carrier.id">{{ carrier.name }}</option>
                }
              </select>
            </label>
            <label class="price-input" for="freight-carrier-extra">
              <span class="price-input__copy">
                <span>Transporttoeslag Enrosed</span>
                <small>Telt mee in het vrachtbedrag voor de klant;
                  alleen wij zien het apart.</small>
              </span>
              <span class="money-input">
                <span>€</span>
                <input id="freight-carrier-extra" class="input num" type="number" min="0"
                       step="0.01" inputmode="decimal" [disabled]="!canEdit()"
                       [value]="order().freightCarrierExtraEur ?? ''"
                       (change)="setCarrierExtra($any($event.target).value)" />
              </span>
            </label>
            @if (carrierBreakdown(); as b) {
              <dl class="carrier-breakdown">
                <div><dt>Zone</dt><dd>{{ b.zoneName }} · {{ countryName() || view().order.countryCode }}
                  @if (!b.postcodeMatched) { <small>· dichtstbijzijnde bij {{ customerPostcode() || '—' }}</small> }
                </dd></div>
                <div><dt>Staffeltrap</dt><dd>{{ b.tierLabel }}</dd></div>
                <div><dt>Basis</dt><dd>{{ b.baseEur | eur: 2 }}</dd></div>
                @if (b.dieselEur) {
                  <div><dt>Dieseltoeslag {{ b.dieselPct | pct: 0 }}</dt><dd>+ {{ b.dieselEur | eur: 2 }}</dd></div>
                }
                @if (b.surchargePctEur) {
                  <div><dt>Toeslag {{ b.surchargePct | pct: 0 }}</dt><dd>+ {{ b.surchargePctEur | eur: 2 }}</dd></div>
                }
                @if (b.surchargeFixedEur) {
                  <div><dt>Vaste toeslag</dt><dd>+ {{ b.surchargeFixedEur | eur: 2 }}</dd></div>
                }
                @if (order().freightCarrierExtraEur; as extra) {
                  <div><dt>Transporttoeslag Enrosed <small>(intern)</small></dt><dd>+ {{ extra | eur: 2 }}</dd></div>
                  <div class="carrier-breakdown__total"><dt>Vracht voor de klant</dt>
                    <dd>{{ b.totalEur + extra | eur: 2 }}</dd></div>
                } @else {
                  <div class="carrier-breakdown__total"><dt>Vracht</dt><dd>{{ b.totalEur | eur: 2 }}</dd></div>
                }
              </dl>
              @if (b.surchargeNote) { <p class="carrier-note">{{ b.surchargeNote }}</p> }
            } @else if (!customerPostcode()) {
              <p class="carrier-note">Vul de postcode bij de klant in: die bepaalt de zone.
                Zonder postcode kan de staffel geen prijs kiezen.</p>
            } @else if (carrierQuoteMissing()) {
              <p class="carrier-note">Deze zending past niet in de staffel — vraag een prijs op
                en kies dan een vast bedrag.</p>
            }
          </div>
        } @else if (pricingStrategy() === 'PER_CBM') {
          <label class="price-input" for="freight-rate-cbm">
            <span>Tarief per m³</span>
            <span class="money-input">
              <span>€</span>
              <input id="freight-rate-cbm" class="input num" type="number" min="0"
                     step="0.01" inputmode="decimal" [disabled]="!canEdit()"
                     [value]="order().freightRatePerCbmEur ?? ''"
                     (change)="setCbmRate($any($event.target).value)" />
            </span>
            @if (freightPending()) {
              <small>Het tarief wordt bewaard. Zet ‘Vracht later bepalen’ uit zodra het klaar is.</small>
            } @else {
              <small>
                Op basis van het exacte omdoosvolume:
                {{ view().priced.totals.freight | eur }} in de offerte.
              </small>
            }
          </label>
        } @else if (pricingStrategy() === 'FIXED') {
          <label class="price-input" for="freight-fixed">
            <span>Vast vrachtbedrag</span>
            <span class="money-input">
              <span>€</span>
              <input id="freight-fixed" class="input num" type="number" min="0"
                     step="0.01" inputmode="decimal" [disabled]="!canEdit()"
                     [value]="view().order.manualFreightEur ?? ''"
                     (change)="setFixedFreight($any($event.target).value)" />
            </span>
            <small>Dit bedrag vervangt de automatische berekening.</small>
          </label>
        }
        <label class="pending-toggle">
          <input type="checkbox" [checked]="freightPending()" [disabled]="!canEdit()"
                 (change)="setPending($any($event.target).checked)" />
          <span>
            <strong>Vracht later bepalen</strong>
            <small>
              {{ freightPending()
                  ? 'De klant ziet nu nog geen vrachtbedrag.'
                  : 'De gekozen prijsstrategie wordt direct gebruikt.' }}
            </small>
          </span>
        </label>
        @if (!freightPending() && view().priced.validation.freightPricingIssue) {
          <p class="pricing-warning" role="status">
            {{ view().priced.validation.freightPricingIssue }}
          </p>
        }
      </section>
    </div>
  `,
  styles: [`
    :host { display:block }
    .planner { display:grid;gap:16px;color:var(--ink) }
    .sr-only { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0 }
    section { min-width:0 }
    h3 { margin:1px 0 0;font-size:15px;line-height:1.3 }
    .eyebrow { display:block;color:var(--muted);font-size:9px;font-weight:760;letter-spacing:.1em;text-transform:uppercase }
    .planner__intro,.calculation__head { display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px }
    .result-pill,.calculation__status,.layout-badge { flex:none;padding:4px 7px;border-radius:999px;background:var(--surface-2);color:var(--muted);font-size:9.5px;font-weight:700;white-space:nowrap }

    .carrier-panel { display:grid;gap:9px;margin-bottom:10px }
    .carrier-breakdown { margin:0;padding:9px 11px;display:grid;gap:4px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2) }
    .carrier-breakdown div { display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:11.5px }
    .carrier-breakdown dt { color:var(--muted) }
    .carrier-breakdown dd { margin:0;font-weight:650;font-variant-numeric:tabular-nums }
    .carrier-breakdown dd small { color:var(--muted);font-weight:550 }
    .carrier-breakdown__total { margin-top:2px;padding-top:6px;border-top:1px dashed var(--line);font-weight:760 }
    .carrier-breakdown__total dt { color:var(--ink) }
    .carrier-note { margin:0;color:var(--muted);font-size:10.5px;line-height:1.45 }
    .choice-grid { display:grid;gap:8px }
    .choice-card { width:100%;min-height:72px;padding:11px;display:grid;grid-template-columns:40px minmax(0,1fr) 22px;gap:10px;align-items:center;border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--ink);font:inherit;text-align:left;cursor:pointer }
    .choice-card:disabled,.price-choices button:disabled { cursor:default }
    .choice-card__icon { width:40px;height:40px;display:grid;place-items:center;border-radius:11px;background:var(--surface-2);color:var(--muted);font-size:18px }
    .choice-card__copy { min-width:0;display:flex;flex-direction:column;gap:2px }
    .choice-card__copy strong { font-size:13px }
    .choice-card__copy small { color:var(--muted);font-size:10.5px;line-height:1.35 }
    .choice-card__check { width:20px;height:20px;display:grid;place-items:center;border:1px solid var(--line-strong);border-radius:50%;color:transparent;font-size:11px }
    .choice-card--active { border-color:var(--rose-line);background:var(--rose-soft);box-shadow:0 0 0 1px var(--rose-line) }
    .choice-card--active .choice-card__icon { background:var(--surface);color:var(--rose-dark) }
    .choice-card--active .choice-card__check { border-color:var(--rose-dark);background:var(--rose-dark);color:#fff }
    .preserved-layout { margin:7px 2px 0;color:var(--muted);font-size:9.5px;line-height:1.4 }
    .preserved-layout--warn { color:var(--warn) }

    .calculation,.freight-price { padding:13px;border:1px solid var(--line);border-radius:16px;background:var(--surface) }
    .calculation__status { background:var(--ok-soft);color:var(--ok) }
    .result-grid { margin:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px }
    .result-grid>div { min-width:0;padding:9px 7px;border-radius:10px;background:var(--surface-2);text-align:center }
    .result-grid dt { overflow:hidden;color:var(--muted);font-size:8.5px;font-weight:680;text-overflow:ellipsis;white-space:nowrap }
    .result-grid dd { margin:3px 0 0;overflow:hidden;font-size:13px;font-weight:750;font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap }
    .result-grid dd small { color:var(--muted);font-size:9px;font-weight:560 }
    .formula-note { margin:9px 1px 0;color:var(--muted);font-size:10.5px;line-height:1.45 }

  `, `

    .pallet-settings,.pallet-card { margin-top:10px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2);overflow:hidden }
    summary { list-style:none;cursor:pointer }
    summary::-webkit-details-marker { display:none }
    .pallet-settings>summary { min-height:48px;padding:9px 10px;display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11.5px;font-weight:680 }
    .pallet-settings>summary:after { content:'⌄';color:var(--muted);font-size:14px;transition:transform .18s }
    .pallet-settings[open]>summary:after { transform:rotate(180deg) }
    .pallet-settings>summary>span { min-width:0;display:flex;flex:1;flex-direction:column;gap:1px }
    .pallet-settings>summary small { overflow:hidden;color:var(--muted);font-size:9.5px;font-weight:520;text-overflow:ellipsis;white-space:nowrap }
    .pallet-settings__body { padding:11px;border-top:1px solid var(--line);background:var(--surface) }
    .field-row { display:grid;gap:5px }
    .field-row+* { margin-top:10px }
    label { font-size:11px;font-weight:680 }
    .height-row { margin-top:10px;display:grid;grid-template-columns:minmax(0,1fr) 116px;gap:10px;align-items:end }
    .height-row>div:first-child { display:flex;flex-direction:column }
    .height-row small { margin-top:2px;color:var(--muted);font-size:9.5px;line-height:1.35 }
    .height-input,.money-input { display:flex }
    .height-input input { min-width:0;border-radius:9px 0 0 9px }
    .height-input>span { min-width:38px;display:grid;place-items:center;border:1px solid var(--line-strong);border-left:0;border-radius:0 9px 9px 0;background:var(--surface-2);color:var(--muted);font-size:10px }
    .text-action,.pallet-card__actions button { min-height:40px;padding:6px;border:0;background:transparent;color:var(--rose-dark);font:inherit;font-size:10.5px;font-weight:680;cursor:pointer }
    .text-action { margin-top:5px }
    .stacking-list { margin-top:8px;border-top:1px solid var(--line) }
    .stacking-list>div { padding:8px 1px;display:flex;flex-direction:column;border-bottom:1px solid var(--line) }
    .stacking-list span { overflow:hidden;font-size:10.5px;font-weight:650;text-overflow:ellipsis;white-space:nowrap }
    .stacking-list small { margin-top:1px;color:var(--muted);font-size:9.5px }
    .volume-breakdown { margin-top:10px;border:1px solid var(--line);border-radius:11px;background:var(--surface-2);overflow:hidden }
    .volume-breakdown>summary { min-height:44px;padding:8px 10px;display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10.5px;font-weight:680 }
    .volume-breakdown>summary small { color:var(--muted);font-size:9px;font-weight:520 }
    .volume-breakdown__body { padding:2px 10px 7px;border-top:1px solid var(--line);background:var(--surface) }
    .volume-breakdown__body>div { min-height:42px;display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid var(--line);font-size:10px }
    .volume-breakdown__body>div:last-child { border-bottom:0 }
    .volume-breakdown__body span { min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap }
    .volume-breakdown__body strong { flex:none;font-size:9.5px;font-variant-numeric:tabular-nums }

  `, `

    .manual-start { margin-top:10px;padding:10px;display:flex;align-items:center;justify-content:space-between;gap:10px;border-radius:12px;background:var(--surface-2) }
    .manual-start>span { min-width:0;display:flex;flex-direction:column;gap:1px }
    .manual-start strong { font-size:10.5px }
    .manual-start small { color:var(--muted);font-size:9.5px;line-height:1.35 }
    .manual-start .btn { min-height:40px;flex:none }
    .manual-workspace { background:var(--surface-2) }
    .manual-workspace__head { margin-bottom:9px }
    .manual-workspace__head>div { min-width:0 }
    .manual-workspace__head p { margin:2px 0 0;color:var(--muted);font-size:9.5px;line-height:1.35 }
    .layout-badge { max-width:108px;overflow:hidden;background:var(--ok-soft);color:var(--ok);text-overflow:ellipsis }
    .layout-badge--warn { background:var(--warn-soft);color:var(--warn) }
    .layout-warning { margin-bottom:9px;padding:8px 9px;border-radius:9px;background:var(--warn-soft);color:var(--warn);font-size:10.5px }
    .invalid-fit { margin:10px 0 0;display:flex;flex-direction:column;gap:2px;line-height:1.4 }
    .invalid-fit strong { font-size:11px }
    .manual-toolbar { margin-bottom:10px;display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px }
    .manual-toolbar button { min-height:42px;padding:7px 10px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);font:inherit;font-size:10px;font-weight:680;cursor:pointer }
    .manual-toolbar__add span { color:var(--rose-dark);font-size:13px }
    .manual-toolbar .manual-toolbar__reset { border-color:transparent;background:transparent;color:var(--rose-dark) }
    .manual-toolbar button:disabled { cursor:default;opacity:.6 }
    .pallet-list { display:grid;gap:8px }
    .pallet-card-shell { position:relative;min-width:0;border-radius:12px;transition:transform .16s ease,opacity .16s ease,box-shadow .16s ease }
    .pallet-card-shell--dragging { z-index:2;opacity:.56;transform:scale(.985) }
    .pallet-card-shell--target { box-shadow:0 0 0 2px var(--rose-dark),0 8px 18px rgb(31 25 22/.12) }
    .pallet-card { margin:0;background:var(--surface) }
    .pallet-card>summary { min-height:56px;padding:8px 50px;display:grid;grid-template-columns:30px minmax(0,1fr) 16px;gap:8px;align-items:center }
    .pallet-card__drag,.pallet-card__remove { position:absolute;z-index:3;top:7px;width:42px;height:42px;display:grid;place-items:center;padding:0;border:0;border-radius:10px;background:transparent;font:inherit;cursor:pointer }
    .pallet-card__drag { left:4px;color:var(--muted);font-size:20px;line-height:1;touch-action:none;cursor:grab }
    .pallet-card__drag:active { cursor:grabbing;background:var(--rose-soft);color:var(--rose-dark) }
    .pallet-card__remove { right:4px;color:var(--danger);font-size:24px;font-weight:420 }
    .pallet-card__remove:hover,.pallet-card__remove:focus-visible { background:var(--danger-soft) }
    .pallet-card__drag:disabled,.pallet-card__remove:disabled { cursor:default;opacity:.45 }
    .pallet-card__number { width:30px;height:30px;display:grid;place-items:center;border-radius:9px;background:var(--rose-soft);color:var(--rose-dark);font-size:11px;font-weight:760 }
    .pallet-card__title { min-width:0;display:flex;flex-direction:column }
    .pallet-card__title strong,.pallet-card__title small { overflow:hidden;text-overflow:ellipsis;white-space:nowrap }
    .pallet-card__title strong { font-size:12px }
    .pallet-card__title small { color:var(--muted);font-size:9.5px }
    .pallet-card__chev { color:var(--muted);transition:transform .18s }
    .pallet-card[open] .pallet-card__chev { transform:rotate(180deg) }
    .pallet-card__body { border-top:1px solid var(--line) }
    .pallet-card__meta { padding:10px;background:var(--surface-2) }
    .height-row--pallet { grid-template-columns:minmax(0,1fr) 110px }
    .pallet-products { padding:5px 10px 10px }
    .pallet-product { min-height:54px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;border-bottom:1px solid var(--line) }
    .pallet-product__name { min-width:0;font-size:11px;line-height:1.35 }
    .stepper { height:38px;display:flex;border:1px solid var(--line-strong);border-radius:9px;overflow:hidden;background:var(--surface) }
    .stepper button { width:38px;border:0;background:transparent;color:var(--ink);font:inherit;font-size:15px;cursor:pointer }
    .stepper input { width:42px;border:0;border-inline:1px solid var(--line);font:inherit;font-size:11.5px;text-align:center;-moz-appearance:textfield }
    .stepper input::-webkit-inner-spin-button,.stepper input::-webkit-outer-spin-button { -webkit-appearance:none;margin:0 }
    .add-product { margin-top:8px }
    .pallet-card__actions { padding:3px 8px;display:grid;grid-template-columns:40px 40px minmax(0,1fr);align-items:center;border-top:1px solid var(--line) }
    .pallet-card__move-help { padding-right:5px;color:var(--muted);font-size:9.5px;text-align:right }
    .pallet-card__actions .danger-action { color:var(--danger) }
  `, `

    .freight-price { background:var(--surface-2) }
    .freight-price>.planner__intro strong { font-size:14px;font-variant-numeric:tabular-nums }
    .price-choices { display:grid;gap:6px }
    .price-choices button { min-height:54px;padding:8px 10px;display:flex;flex-direction:column;justify-content:center;border:1px solid var(--line);border-radius:11px;background:var(--surface);color:var(--ink);font:inherit;text-align:left;cursor:pointer }
    .price-choices strong { font-size:11.5px }
    .price-choices small { margin-top:1px;color:var(--muted);font-size:9.5px }
    .price-choices .price-choice--active { border-color:var(--rose-line);background:var(--rose-soft);box-shadow:0 0 0 1px var(--rose-line) }
    .price-input { margin-top:10px;padding:10px;display:grid;grid-template-columns:minmax(0,1fr) 138px;gap:4px 10px;align-items:center;border:1px solid var(--line);border-radius:11px;background:var(--surface) }
    .price-input>small { grid-column:1/-1;color:var(--muted);font-size:9.5px;font-weight:520 }
    .price-input__copy { min-width:0;display:grid;gap:2px }
    .price-input__copy>small { color:var(--muted);font-size:9.5px;font-weight:520;line-height:1.4 }
    .money-input>span { min-width:34px;display:grid;place-items:center;border:1px solid var(--line-strong);border-right:0;border-radius:9px 0 0 9px;background:var(--surface-2);color:var(--muted);font-size:11px }
    .money-input input { min-width:0;border-radius:0 9px 9px 0 }
    .pending-toggle { min-height:56px;margin-top:9px;padding:9px 10px;display:flex;align-items:flex-start;gap:9px;border:1px solid var(--line);border-radius:11px;background:var(--surface);cursor:pointer }
    .pending-toggle input { width:20px;height:20px;margin:1px 0;flex:none;accent-color:var(--rose-dark) }
    .pending-toggle>span { min-width:0;display:flex;flex-direction:column }
    .pending-toggle strong { font-size:10.5px }
    .pending-toggle small { margin-top:1px;color:var(--muted);font-size:9.5px;font-weight:520 }
    .pricing-warning { margin:8px 0 0;padding:8px 9px;border-radius:9px;background:var(--warn-soft);color:var(--warn);font-size:10px }

    @media (min-width:680px) {
      .choice-grid { grid-template-columns:1fr 1fr }
      .price-choices { grid-template-columns:repeat(3,minmax(0,1fr)) }
      .price-choices button { min-height:70px }
    }
    @media (max-width:350px) {
      .result-grid { grid-template-columns:1fr }
      .result-grid>div { display:flex;align-items:center;justify-content:space-between;text-align:left }
      .result-grid dd { margin:0 }
      .height-row,.height-row--pallet,.price-input { grid-template-columns:1fr }
      .manual-start { align-items:stretch;flex-direction:column }
      .manual-start .btn { width:100% }
      .manual-toolbar { grid-template-columns:1fr }
      .price-input>small { grid-column:1 }
      .height-input,.money-input { width:100% }
      .height-input input,.money-input input { flex:1 }
    }
    @media (prefers-reduced-motion:reduce) {
      .pallet-card-shell { transition:none }
    }
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

  private assignedFor(productId: number): number {
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
      return loose === 1 ? '1 doos niet toegewezen' : `${loose} dozen niet toegewezen`;
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
