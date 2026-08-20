import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { saveBlob } from '../../core/api/download';
import { CONTAINER_TYPES, DESTINATION_PORTS, containerLabel } from '../../core/api/geo';
import { messageOf } from '../../core/api/errors';
import { Allocation, Currency, Product, PurchaseOrder, PurchaseOrderLine, PurchaseOrderView, Supplier } from '../../core/api/models';
import { Privacy } from '../../core/api/privacy';
import { PageHeader } from '../../shared/page-header';
import { ProductDraft } from '../../shared/product-picker';
import { ProductPicker } from '../../shared/product-picker';
import { DateField } from '../../shared/date-field';
import { Ui } from '../../shared/ui';
import { CbmPipe, CurPipe, EurPipe, NumPipe, PctPipe } from '../../shared/pipes';
import { SupplierAddress } from '../../shared/supplier-address';
import {
  effectiveUsdToEur,
  purchaseCostLabels,
  withUsdToEur,
} from './purchase-cost-labels';
import { PurchaseOrderedSuccess } from './purchase-ordered-success';

/**
 * Landed-cost calculation of a container.
 *
 * The screen order follows the road of the goods: goods, local origin costs
 * and sea freight form the customs value, duty per HS code is levied on
 * that, and only then do the costs from the port of arrival join.
 */
@Component({
  selector: 'app-purchase-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageHeader, ProductPicker, DateField,
            SupplierAddress, PurchaseOrderedSuccess,
            EurPipe, CurPipe, NumPipe, PctPipe, CbmPipe],
  template: `
    @if (view(); as data) {
      <app-page-header [title]="data.order.number" [subtitle]="supplierName()"
                       [showBack]="true" [showBell]="false"
                       [titleEditable]="true"
                       (titleChange)="patch({ number: $event })">
        <button class="btn btn--sm" type="button" (click)="downloadPdf()"
                [attr.aria-label]="'Download ' + data.order.number + ' als PDF'">
          PDF
        </button>
      </app-page-header>

      <div class="content po-page">
        @if (!privacy.showPurchase()) {
          <div class="alert alert--ok po-notice">
            <span class="alert__icon" aria-hidden="true">✓</span>
            <div>
              <b>Klantveilige weergave.</b> Inkoopbedragen, wisselkoersen en kostprijzen
              zijn verborgen. De container en aantallen kun je wel veilig beheren.
            </div>
          </div>
        }

        @if (isReceived()) {
          <div class="alert alert--info po-notice">
            <span class="alert__icon" aria-hidden="true">✓</span>
            <div>
              <b>Ontvangst gesloten.</b> De voorraad is bijgeboekt. Producten en aantallen
              staan vast; notities en kostengegevens kun je nog corrigeren.
            </div>
          </div>
        }

        <section class="po-overview" aria-labelledby="po-overview-title">
          <div class="po-overview__top">
            <div class="po-overview__copy">
              <span class="po-eyebrow">Inkoopcontainer</span>
              <h1 id="po-overview-title">{{ supplierName() }}</h1>
              <p>
                {{ data.order.orderDate }}
                @if (data.order.alias) { <span aria-hidden="true"> · </span>{{ data.order.alias }} }
              </p>
            </div>
            <span class="po-status"
                  [class.po-status--done]="isReceived()">
              <span class="po-status__dot" aria-hidden="true"></span>
              {{ data.order.status === 'CONCEPT' ? 'Concept'
                : data.order.status === 'ONTVANGEN' ? 'Ontvangen' : 'Besteld' }}
            </span>
          </div>

          <div class="stepper overview-stepper" aria-label="Voortgang van de inkooporder">
            @for (step of statusSteps; track step.value; let last = $last) {
              <div class="stepper__step"
                   [class.stepper__step--done]="stepIndex(data.order.status) > $index"
                   [class.stepper__step--now]="stepIndex(data.order.status) === $index">
                <span class="stepper__dot" aria-hidden="true">
                  @if (stepIndex(data.order.status) > $index) { ✓ } @else { {{ $index + 1 }} }
                </span>
                <span class="stepper__label">{{ step.label }}</span>
              </div>
              @if (!last) {
                <span class="stepper__line"
                      [class.stepper__line--done]="stepIndex(data.order.status) > $index"></span>
              }
            }
          </div>

          <div class="po-facts">
            <div class="po-fact">
              <span class="po-fact__label">Herkomst</span>
              <strong>{{ originLabel() }}</strong>
            </div>
            <div class="po-fact">
              <span class="po-fact__label">Container</span>
              <strong>{{ containerLabel(data.order.containerType) }}</strong>
            </div>
            <div class="po-fact">
              <span class="po-fact__label">Bestemming</span>
              <strong>{{ data.order.destinationPort || 'Rotterdam' }}</strong>
            </div>
            <div class="po-fact">
              <span class="po-fact__label">Lading</span>
              @if (data.costing.containerFill; as fill) {
                <strong>{{ fill.fillPercent | num: 0 }}% · {{ data.costing.totals.pieces | num }} st</strong>
              } @else {
                <strong>{{ data.costing.totals.pieces | num }} st</strong>
              }
            </div>
          </div>
        </section>

        <div class="purchase-grid">
          <main class="purchase-main">
            <section class="card flow-card">
              <button class="section-toggle" type="button"
                      [attr.aria-expanded]="sectionOpen('order')"
                      aria-controls="purchase-order-fields"
                      (click)="toggleSection('order')">
                <span class="section-step" aria-hidden="true">1</span>
                <span class="section-title-block">
                  <span class="section-kicker">Voorbereiding</span>
                  <span class="section-name">Ordergegevens</span>
                  @if (!sectionOpen('order')) {
                    <span class="section-summary">{{ orderSummary() }}</span>
                  }
                </span>
                <svg class="section-chevron" [class.section-chevron--open]="sectionOpen('order')"
                     viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
                  <path d="m6.5 8 3.5 3.5L13.5 8" fill="none" stroke="currentColor"
                        stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>

              @if (sectionOpen('order')) {
                <div class="section-body" id="purchase-order-fields">
                  <div class="supplier-context">
                    <span class="supplier-context__mark" aria-hidden="true">
                      {{ supplierName().charAt(0) }}
                    </span>
                    <span class="supplier-context__copy">
                      <span>Leverancier</span>
                      <strong>{{ supplierName() }}</strong>
                      @if (privacy.showPurchase()) {
                        <app-supplier-address [supplier]="supplier()" [inline]="true"
                                              [showEmpty]="true" />
                      }
                    </span>
                    <span class="supplier-context__country">{{ supplier()?.currency }}</span>
                  </div>

                  <div class="form-grid order-fields">
                    <div class="field">
                      <label for="po-alias">Herkenbare naam <span class="opt"></span></label>
                      <input class="input" id="po-alias" [ngModel]="data.order.alias"
                             (ngModelChange)="patch({ alias: $event })"
                             placeholder="Bijv. voorjaar, kleurvariant…" />
                      <span class="hint">Handig om calculatievarianten uit elkaar te houden.</span>
                    </div>
                    <div class="field">
                      <label for="po-date">Orderdatum</label>
                      <app-date-field fieldId="po-date" [value]="data.order.orderDate"
                                      (valueChange)="patch({ orderDate: $event })" />
                    </div>
                    <div class="field">
                      <label for="po-container">Type container</label>
                      <select class="select" id="po-container"
                              [ngModel]="data.order.containerType"
                              (ngModelChange)="patch({ containerType: $event })">
                        @for (type of containerTypes; track type.value) {
                          <option [value]="type.value">{{ type.label }}</option>
                        }
                      </select>
                    </div>
                    <div class="field">
                      <label for="c-port">Aankomsthaven</label>
                      <select class="select" id="c-port"
                              [ngModel]="data.order.destinationPort"
                              (ngModelChange)="patch({ destinationPort: $event })">
                        @for (port of ports; track port) {
                          <option [value]="port">{{ port }}</option>
                        }
                      </select>
                    </div>
                    <div class="field span-2">
                      <label for="po-notes">Interne notitie <span class="opt"></span></label>
                      <textarea class="textarea" id="po-notes" rows="3"
                                [ngModel]="data.order.notes"
                                (ngModelChange)="patch({ notes: $event })"
                                placeholder="Afspraken, laad-instructies of aandachtspunten"></textarea>
                    </div>
                  </div>
                </div>
              }
            </section>

            <section class="card flow-card products-card" aria-labelledby="purchase-products-title">
              <div class="section-heading">
                <span class="section-step" aria-hidden="true">2</span>
                <span class="section-title-block">
                  <span class="section-kicker">Samenstellen</span>
                  <h2 class="section-name" id="purchase-products-title">Producten</h2>
                  <span class="section-summary">
                    {{ data.costing.lines.length }} regels · {{ data.costing.totals.cartons | num }} dozen
                  </span>
                </span>
                <button class="btn btn--sm add-product" type="button"
                        [disabled]="isReceived()" (click)="openPicker()">
                  <span aria-hidden="true">+</span> Product
                </button>
              </div>

              @if (privacy.showPurchase() && data.costing.lines.length) {
                <div class="product-tools">
                  <span class="product-tools__label">Kostopbouw tonen als</span>
                  <div class="per-toggle" role="group" aria-label="Weergave kostopbouw">
                    <button type="button" [class.on]="!perPiece()"
                            [attr.aria-pressed]="!perPiece()"
                            (click)="perPiece.set(false)">Totaal</button>
                    <button type="button" [class.on]="perPiece()"
                            [attr.aria-pressed]="perPiece()"
                            (click)="perPiece.set(true)">Per stuk</button>
                  </div>
                </div>
              }

              <div class="product-lines">
                @for (line of data.costing.lines; track line.productId; let lineIndex = $index) {
                  <article class="po-line">
                    <header class="po-line__head">
                      <span class="po-line__index" aria-hidden="true">{{ lineIndex + 1 }}</span>
                      <span class="po-line__identity">
                        <strong>{{ line.productName }}</strong>
                        <span>{{ line.cartons | num }} dozen · {{ line.cbm | cbm }}</span>
                      </span>
                      <button class="line-remove" type="button" [disabled]="isReceived()"
                              [attr.aria-label]="'Verwijder ' + line.productName"
                              (click)="removeLine(line.productId)">
                        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
                          <path d="M6.5 6.5v8m3.5-8v8m3.5-8v8M4 4.5h12m-9.5 0 .7-2h5.6l.7 2m1 0-.7 12H5.7L5 4.5"
                                fill="none" stroke="currentColor" stroke-width="1.45"
                                stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                      </button>
                    </header>

                    <div class="form-grid po-line__inputs">
                      <div class="field" [class.span-2]="!privacy.showPurchase()">
                        <label [attr.for]="'qty-' + line.productId">Aantal stuks</label>
                        <input class="input num right" [id]="'qty-' + line.productId"
                               type="number" min="0" step="1" inputmode="numeric"
                               [disabled]="isReceived()" [ngModel]="line.quantity"
                               (ngModelChange)="setQuantity(line.productId, +$event)" />
                        @if (shortShipped(line.productId); as ordered) {
                          <span class="hint warn-text">
                            Besteld {{ ordered | num }} → ontvangen {{ line.quantity | num }}
                          </span>
                        }
                      </div>

                      @if (privacy.showPurchase()) {
                        <div class="field">
                          <label [attr.for]="'exw-' + line.productId">Afgesproken EXW-prijs</label>
                          <div class="input-affix">
                            <input class="input num right" [id]="'exw-' + line.productId"
                                   type="number" min="0" step="0.01" inputmode="decimal"
                                   [ngModel]="orderLine(line.productId)?.exwPrice"
                                   [placeholder]="line.quantity
                                     ? (line.goodsUsd / line.quantity | num: 4) : ''"
                                   (ngModelChange)="setExwPrice(line.productId, $event)" />
                            <select class="input-affix__suffix line-currency"
                                    aria-label="Munt EXW-prijs"
                                    [ngModel]="orderLine(line.productId)?.exwCurrency ?? 'USD'"
                                    (ngModelChange)="setExwCurrency(line.productId, $event)">
                              <option value="USD">USD</option>
                              <option value="CNY">CNY</option>
                              <option value="EUR">EUR</option>
                            </select>
                          </div>
                          <span class="hint">Leeg gebruikt de actuele prijs van het product.</span>
                        </div>
                      }
                    </div>

                    @if (privacy.showPurchase()) {
                      <details class="line-breakdown">
                        <summary>
                          <span class="line-breakdown__label">
                            <span>Kostopbouw</span>
                            <small>{{ perPiece() ? 'per stuk' : 'hele regel' }}</small>
                          </span>
                          <span class="line-breakdown__value">
                            <svg class="line-breakdown__chevron" viewBox="0 0 20 20"
                                 width="18" height="18" aria-hidden="true">
                              <path d="m6.5 8 3.5 3.5L13.5 8" fill="none"
                                    stroke="currentColor" stroke-width="1.8"
                                    stroke-linecap="round" stroke-linejoin="round" />
                            </svg>
                            <strong class="line-breakdown__total">
                              {{ perPiece() ? (line.landedUnitEur | eur: 4)
                                : (line.totalEur | eur) }}
                            </strong>
                          </span>
                        </summary>
                        <div class="line-breakdown__body">
                          <div class="stat-row stat-row--muted">
                            <span>Goederen</span>
                            <span class="num">{{ amt(line.goodsEur, line) | eur: decimals() }}</span>
                          </div>
                          @if (line.originEur) {
                            <div class="stat-row stat-row--muted">
                              <span>{{ costLabels().originCostsLabel }}
                                <small>{{ costLabels().originRoute }}</small>
                              </span>
                              <span class="num">{{ amt(line.originEur, line) | eur: decimals() }}</span>
                            </div>
                          }
                          <div class="stat-row stat-row--muted">
                            <span>{{ costLabels().seaFreightLabel }}
                              <small>{{ costLabels().seaFreightRoute }}</small>
                            </span>
                            <span class="num">{{ amt(line.freightEur, line) | eur: decimals() }}</span>
                          </div>
                          <div class="stat-row stat-row--muted line-divider">
                            <span>Douanewaarde</span>
                            <span class="num">{{ amt(line.customsValueEur, line) | eur: decimals() }}</span>
                          </div>
                          <div class="stat-row stat-row--muted">
                            <span>Invoerrecht {{ line.dutyRatePct | pct: 1 }}
                              <span class="tiny">({{ line.dutySource }})</span>
                            </span>
                            <span class="num">{{ amt(line.dutyEur, line) | eur: decimals() }}</span>
                          </div>
                          <div class="stat-row stat-row--muted">
                            <span>{{ costLabels().destinationCostsLabel }}</span>
                            <span class="num">{{ amt(line.destinationEur, line) | eur: decimals() }}</span>
                          </div>
                          @if (line.extraRevenueEur) {
                            <div class="stat-row stat-row--muted">
                              <span>
                                Extra opbrengst
                                <small>{{ perPiece() ? 'per stuk' : 'hele regel' }}</small>
                              </span>
                              <span class="num">
                                {{ amt(line.extraRevenueEur, line) | eur: decimals() }}
                              </span>
                            </div>
                          }
                        </div>
                      </details>
                    }
                  </article>
                } @empty {
                  <div class="empty product-empty">
                    <div class="empty__icon" aria-hidden="true">◈</div>
                    <div class="empty__title">Bouw je container op</div>
                    <p class="empty__text">
                      Voeg producten toe. Aantallen, dozen en containervulling
                      worden direct doorgerekend.
                    </p>
                    <button class="btn btn--primary" type="button"
                            [disabled]="isReceived()" (click)="openPicker()">
                      Eerste product toevoegen
                    </button>
                  </div>
                }
              </div>
            </section>

            @if (privacy.showPurchase()) {
              <section class="card flow-card">
                <button class="section-toggle" type="button"
                        [attr.aria-expanded]="sectionOpen('costs')"
                        aria-controls="purchase-cost-fields"
                        (click)="toggleSection('costs')">
                  <span class="section-step" aria-hidden="true">3</span>
                  <span class="section-title-block">
                    <span class="section-kicker">Doorrekenen</span>
                    <span class="section-name">Transport, invoer &amp; koers</span>
                    @if (!sectionOpen('costs')) {
                      <span class="section-summary">{{ costsSummary() }}</span>
                    }
                  </span>
                  <svg class="section-chevron" [class.section-chevron--open]="sectionOpen('costs')"
                       viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
                    <path d="m6.5 8 3.5 3.5L13.5 8" fill="none" stroke="currentColor"
                          stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </button>

                @if (sectionOpen('costs')) {
                  <div class="section-body cost-fields" id="purchase-cost-fields">
                    <section class="cost-group" aria-labelledby="exchange-title">
                      <div class="cost-group__intro">
                        <div>
                          <span class="cost-group__step">A</span>
                          <h3 id="exchange-title">Wisselkoersen</h3>
                        </div>
                        <p>Eén USD-koers houdt goederen en transport consequent gelijk.</p>
                      </div>
                      <div class="rate-grid">
                        <div class="field">
                          <label for="r-cny">RMB naar USD</label>
                          <input class="input num right" id="r-cny" type="number"
                                 step="0.0001" inputmode="decimal"
                                 [ngModel]="data.order.cnyToUsd"
                                 (ngModelChange)="patch({ cnyToUsd: +$event })" />
                        </div>
                        <div class="field">
                          <label for="r-usd">USD naar EUR</label>
                          <input class="input num right" id="r-usd" type="number"
                                 step="0.0001" inputmode="decimal"
                                 [ngModel]="usdToEurRate()"
                                 (ngModelChange)="setUsdToEur(+$event)" />
                          <span class="hint">Geldt voor goederen én transport.</span>
                        </div>
                      </div>
                    </section>

                    <section class="cost-group" aria-labelledby="route-costs-title">
                      <div class="cost-group__intro">
                        <div>
                          <span class="cost-group__step">B</span>
                          <h3 id="route-costs-title">Van fabriek tot magazijn</h3>
                        </div>
                        <p>Kosten vóór de EU-grens tellen mee in de douanewaarde.</p>
                      </div>
                      <div class="form-grid">
                        <div class="field">
                          <label class="req" for="c-freight">{{ costLabels().seaFreightLabel }}</label>
                          <div class="input-affix">
                            <input class="input num right" id="c-freight" type="number"
                                   step="50" min="0" inputmode="decimal"
                                   [ngModel]="data.order.freightUsd"
                                   (ngModelChange)="patch({ freightUsd: +$event })" />
                            <span class="input-affix__suffix">USD</span>
                          </div>
                          <span class="hint">{{ costLabels().seaFreightRoute }}</span>
                        </div>
                        <div class="field">
                          <label for="c-origin">{{ costLabels().originCostsLabel }}</label>
                          <div class="input-affix">
                            <input class="input num right" id="c-origin" type="number"
                                   step="50" min="0" inputmode="decimal"
                                   [ngModel]="data.order.originCosts"
                                   (ngModelChange)="patch({ originCosts: +$event })" />
                            <select class="input-affix__suffix cost-currency"
                                    aria-label="Munt lokale oorsprongskosten"
                                    [ngModel]="data.order.originCurrency"
                                    (ngModelChange)="patch({ originCurrency: $event })">
                              <option value="USD">USD</option>
                              <option value="CNY">CNY</option>
                              <option value="EUR">EUR</option>
                            </select>
                          </div>
                          <span class="hint">{{ costLabels().originRoute }} · voortransport en exportdocumenten.</span>
                        </div>
                        <div class="field">
                          <label for="c-dest">
                            {{ costLabels().destinationCostsLabel }}
                          </label>
                          <div class="input-affix">
                            <input class="input num right" id="c-dest" type="number"
                                   step="25" min="0" inputmode="decimal"
                                   [ngModel]="data.order.destinationCostsEur"
                                   (ngModelChange)="patch({ destinationCostsEur: +$event })" />
                            <span class="input-affix__suffix">EUR</span>
                          </div>
                          <span class="hint">Trucking en afhandeling na invoer.</span>
                        </div>
                        <div class="field">
                          <label for="c-duty">Invoerrecht zonder HS-code</label>
                          <div class="input-affix">
                            <input class="input num right" id="c-duty" type="number"
                                   step="0.5" min="0" inputmode="decimal"
                                   [ngModel]="data.order.defaultDutyRatePct"
                                   (ngModelChange)="patch({ defaultDutyRatePct: +$event })" />
                            <span class="input-affix__suffix">%</span>
                          </div>
                        </div>
                        <div class="field span-2">
                          <label for="c-extra">Extra gewenste opbrengst <span class="opt"></span></label>
                          <div class="input-affix">
                            <input class="input num right" id="c-extra" type="number"
                                   step="100" min="0" inputmode="decimal"
                                   [ngModel]="data.order.extraRevenueEur"
                                   (ngModelChange)="patch({ extraRevenueEur: +$event })" />
                            <span class="input-affix__suffix">EUR</span>
                          </div>
                        </div>
                      </div>
                    </section>

                    <details class="allocation-settings">
                      <summary>
                        <span>
                          <strong>Geavanceerd: verdeelsleutels</strong>
                          <small>Bepaal hoe containerkosten over producten worden verdeeld.</small>
                        </span>
                      </summary>
                      <div class="form-grid allocation-settings__body">
                        @for (key of allocationKeys(); track key.field) {
                          <div class="field">
                            <label [attr.for]="'a-' + key.field">{{ key.label }}</label>
                            <select class="select" [id]="'a-' + key.field"
                                    [ngModel]="allocationOf(data.order, key.field)"
                                    (ngModelChange)="setAllocation(key.field, $event)">
                              <option value="CBM">Naar volume (m³)</option>
                              <option value="VALUE">Naar goederenwaarde</option>
                              <option value="PIECES">Naar aantal stuks</option>
                            </select>
                            @if (key.route) {
                              <span class="hint">{{ key.route }}</span>
                            }
                          </div>
                        }
                      </div>
                    </details>
                  </div>
                }
              </section>
            }
          </main>

          <aside class="purchase-summary" aria-label="Containersamenvatting">
            <section class="card summary-card">
              <div class="section-heading summary-heading">
                <span class="section-step" aria-hidden="true">
                  {{ privacy.showPurchase() ? 4 : 3 }}
                </span>
                <span class="section-title-block">
                  <span class="section-kicker">Controleren</span>
                  <h2 class="section-name">
                    {{ privacy.showPurchase() ? 'Totale kostprijs' : 'Container' }}
                  </h2>
                  <span class="section-summary">
                    {{ data.costing.totals.pieces | num }} st ·
                    {{ data.costing.totals.cartons | num }} dozen
                  </span>
                </span>
              </div>

              <div class="summary-body">
                @if (data.costing.containerFill; as fill) {
                  <div class="fill-overview">
                    <div>
                      <span class="fill-overview__label">
                        {{ containerLabel(data.order.containerType) }}
                      </span>
                      <strong>{{ fill.fillPercent | num: 0 }}%</strong>
                    </div>
                    <span>{{ fill.usedCbm | cbm }} van {{ fill.capacityCbm }} m³</span>
                  </div>
                  <div class="meter__track fill-meter"
                       role="meter" aria-label="Containervulling"
                       aria-valuemin="0" aria-valuemax="100"
                       [attr.aria-valuenow]="fill.fillPercent">
                    <div class="meter__fill"
                         [class.meter__fill--warn]="fill.fillPercent > 97"
                         [style.width.%]="fill.fillPercent"></div>
                  </div>
                  @if (fill.overflowCbm > 0) {
                    <div class="alert alert--danger capacity-alert">
                      <span class="alert__icon" aria-hidden="true">!</span>
                      <div>
                        Te vol voor één {{ containerLabel(data.order.containerType) }}:
                        <b>{{ fill.overflowCbm | cbm }} te veel</b>.
                      </div>
                    </div>
                  }
                }

                @if (privacy.showPurchase()) {
                  <div class="cost-hero">
                    <div>
                      <div class="cost-hero__label">Totaal geland</div>
                      <div class="cost-hero__value">{{ data.costing.totals.totalEur | eur }}</div>
                    </div>
                    <div class="cost-hero__unit">
                      <div class="cost-hero__label">Gemiddeld per stuk</div>
                      <div class="cost-hero__value cost-hero__value--rose">
                        {{ data.costing.totals.averageUnitEur | eur: 4 }}
                      </div>
                    </div>
                  </div>

                  <div class="cost-summary">
                    <div class="cost-summary__group">
                      <span class="cost-section">Tot de EU-grens</span>
                      <div class="stat-row">
                        <span>Goederen
                          <small>{{ data.costing.totals.goodsUsd | cur: 'USD' }}</small>
                        </span>
                        <span class="num">{{ data.costing.totals.goodsEur | eur }}</span>
                      </div>
                      @if (data.costing.totals.originEur) {
                        <div class="stat-row">
                          <span>{{ costLabels().originCostsLabel }}
                            <small>{{ costLabels().originRoute }}</small>
                          </span>
                          <span class="num">{{ data.costing.totals.originEur | eur }}</span>
                        </div>
                      }
                      <div class="stat-row">
                        <span>{{ costLabels().seaFreightLabel }}
                          <small>{{ costLabels().seaFreightRoute }}</small>
                        </span>
                        <span class="num">{{ data.costing.totals.freightEur | eur }}</span>
                      </div>
                      <div class="stat-row cost-summary__subtotal">
                        <span>Douanewaarde</span>
                        <span class="num">{{ data.costing.totals.customsValueEur | eur }}</span>
                      </div>
                    </div>

                    <div class="cost-summary__group">
                      <span class="cost-section">Invoer &amp; aankomst</span>
                      <div class="stat-row">
                        <span>Invoerrechten
                          <small>gem. {{ data.costing.totals.effectiveDutyPct | pct: 1 }}</small>
                        </span>
                        <span class="num">{{ data.costing.totals.dutyEur | eur }}</span>
                      </div>
                      <div class="stat-row">
                        <span>{{ costLabels().destinationCostsLabel }}</span>
                        <span class="num">{{ data.costing.totals.destinationEur | eur }}</span>
                      </div>
                      @if (data.costing.totals.extraRevenueEur) {
                        <div class="stat-row">
                          <span>Extra opbrengst</span>
                          <span class="num">{{ data.costing.totals.extraRevenueEur | eur }}</span>
                        </div>
                      }
                    </div>
                  </div>
                } @else {
                  <div class="safe-summary">
                    <span aria-hidden="true">✓</span>
                    <p>Kosten en totalen blijven verborgen in deze klantveilige weergave.</p>
                  </div>
                }
              </div>
            </section>

            <section class="card action-card" aria-labelledby="purchase-actions-title">
              <div class="action-card__head">
                <span class="po-eyebrow">Afronden</span>
                <h2 id="purchase-actions-title">
                  {{ nextStep() ? 'Klaar voor de volgende stap?' : 'Container afgerond' }}
                </h2>
                <p>
                  @if (data.order.status === 'CONCEPT') {
                    Controleer de producten en kosten voordat je de bestelling vastlegt.
                  } @else if (!isReceived()) {
                    Pas eventuele tekorten aan vóór je de voorraad bijboekt.
                  } @else {
                    De voorraad is bijgeboekt. Je kunt nog een variant maken of kostprijzen toepassen.
                  }
                </p>
              </div>

              <div class="action-card__buttons">
                @if (nextStep(); as step) {
                  <button class="btn btn--primary btn--block" type="button"
                          (click)="advanceStatus()">
                    {{ step.action }}
                  </button>
                }
                @if (privacy.showPurchase()) {
                  <button class="btn btn--block" type="button" (click)="apply()">
                    Kostprijzen toepassen
                  </button>
                }
                <button class="btn btn--block" type="button" (click)="duplicate()">
                  Kopiëren als variant
                </button>
              </div>

              @if (!isReceived()) {
                <details class="danger-zone">
                  <summary>Meer acties</summary>
                  <div>
                    <p>Verwijderen kan niet ongedaan worden gemaakt.</p>
                    <button class="btn btn--danger btn--block" type="button"
                            (click)="remove()">
                      Calculatie verwijderen
                    </button>
                  </div>
                </details>
              }
            </section>
          </aside>
        </div>
      </div>

      @if (picking()) {
        <app-product-picker
          [class.customer-safe]="!privacy.showPurchase()"
          heading="Product toevoegen aan de container"
          [products]="available()"
          [priceOf]="privacy.showPurchase() ? exwPriceOf : hiddenPriceOf"
          [enforceCartons]="false"
          (picked)="addLine($event)"
          (cancelled)="picking.set(false)"
          [allowCreate]="privacy.showPurchase()"
          [createCurrency]="supplier()?.currency ?? 'USD'"
          (create)="quickCreate($event)"
        />
      }

      @if (orderPlaced()) {
        <app-purchase-ordered-success [orderNumber]="data.order.number"
                                      (closed)="closeOrderPlaced()"
                                      (overview)="openOrderView()" />
      }
    } @else {
      <div class="content po-page">
        <div class="loading-card" role="status" aria-live="polite">
          <span class="loading-card__mark" aria-hidden="true"></span>
          <span>Inkooporder laden…</span>
        </div>
      </div>
    }
  `,
  styles: [`
    :host{display:block;min-width:0}.po-page{max-width:1180px}.po-notice{margin-bottom:12px}
    .po-overview{position:relative;margin-bottom:14px;padding:16px;border:1px solid var(--rose-line);border-radius:22px;background:linear-gradient(145deg,var(--surface),var(--rose-soft));box-shadow:var(--sh-1);overflow:hidden}
    .po-overview:before{content:'';position:absolute;inset:0 auto 0 0;width:4px;background:var(--rose)}
    .po-overview__top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.po-overview__copy{min-width:0}
    :is(.po-eyebrow,.section-kicker){display:block;color:var(--rose);font-size:10px;font-weight:750;letter-spacing:.1em;text-transform:uppercase}
    .po-overview h1{margin-top:3px;overflow:hidden;font-size:22px;text-overflow:ellipsis;white-space:nowrap}.po-overview__copy p{color:var(--muted);font-size:12px}
    .po-status{display:flex;flex:none;align-items:center;gap:5px;padding:5px 8px;border:1px solid var(--rose-line);border-radius:99px;background:var(--surface);color:var(--rose-dark);font-size:11.5px;font-weight:700}
    .po-status__dot{width:7px;height:7px;border-radius:50%;background:currentColor}.po-status--done{color:var(--ok)}.overview-stepper{margin:16px 0}
    .po-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;border:1px solid var(--line);border-radius:14px;background:var(--line);overflow:hidden}
    .po-fact{min-width:0;padding:9px 10px;background:var(--surface)}.po-fact__label{display:block;color:var(--muted);font-size:9.5px;text-transform:uppercase}.po-fact strong{display:block;overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}

    :is(.purchase-main,.purchase-summary){min-width:0}:is(.purchase-main,.purchase-summary)>.card+.card{margin-top:12px}:is(.flow-card,.summary-card,.action-card){overflow:hidden}
    :is(.section-toggle,.section-heading){display:flex;width:100%;min-height:72px;align-items:center;gap:10px;padding:12px 14px;border:0;background:var(--surface);text-align:left}
    .section-toggle{cursor:pointer}.section-step{display:grid;width:34px;height:34px;flex:0 0 34px;place-items:center;border:1px solid var(--rose-line);border-radius:11px;background:var(--rose-soft);color:var(--rose-dark);font-weight:750}
    .section-title-block{display:block;min-width:0;flex:1}.section-name{display:block;font-size:15px;font-weight:700}.section-summary{display:block;overflow:hidden;color:var(--muted);font-size:11.5px;text-overflow:ellipsis;white-space:nowrap}
    .section-chevron{flex:none;color:var(--muted)}.section-chevron--open{transform:rotate(180deg)}.section-body{padding:14px 14px 0;border-top:1px solid var(--line);background:var(--surface-2)}

    .supplier-context{display:flex;align-items:center;gap:9px;margin-bottom:14px;padding:10px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}
    .supplier-context__mark{display:grid;width:34px;height:34px;place-items:center;border-radius:10px;background:var(--rose);color:#fff}.supplier-context__copy{display:flex;min-width:0;flex:1;flex-direction:column}.supplier-context__copy>span,.supplier-context__country{color:var(--muted);font-size:10px}.supplier-context__copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.supplier-context__copy app-supplier-address{margin-top:1px}
    :is(.order-fields,.po-line__inputs) .field{min-width:0}

  `, `

    .products-card{overflow:visible}:is(.products-card .section-heading,.summary-heading){border-bottom:1px solid var(--line)}.add-product{flex:none;min-height:40px;padding-inline:11px}
    .product-tools{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;border-bottom:1px solid var(--line);background:var(--surface-2)}.product-tools__label{color:var(--muted);font-size:11px}
    .po-line{padding:14px;border-bottom:1px solid var(--line)}.po-line:last-child{border:0}.po-line__head{display:flex;align-items:center;gap:9px;margin-bottom:12px}
    .po-line__index{width:24px;color:var(--muted);font-size:11px;text-align:center}.po-line__identity{display:flex;min-width:0;flex:1;flex-direction:column}.po-line__identity strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.po-line__identity span{color:var(--muted);font-size:12px}
    .line-remove{display:grid;width:42px;height:42px;place-items:center;border:0;border-radius:50%;background:transparent;color:var(--muted)}.line-remove:active{background:var(--danger-soft);color:var(--danger)}:is(.line-currency,.cost-currency){min-width:74px;border-radius:0 var(--r-sm) var(--r-sm) 0}

    :is(.line-breakdown,.allocation-settings){overflow:hidden;border:1px solid var(--line);border-radius:14px;background:var(--surface)}
    :is(.line-breakdown,.allocation-settings) summary{display:flex;min-height:50px;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;list-style:none}
    .line-breakdown summary::-webkit-details-marker{display:none}
    .line-breakdown__label{display:flex;min-width:0;flex:1;flex-direction:column;font-size:12px}.line-breakdown__label small{color:var(--muted);font-size:10px}.line-breakdown__total{color:var(--rose)}
    .line-breakdown__value{display:flex;align-items:center;gap:5px}.line-breakdown__chevron{flex:none;color:var(--muted);transition:transform .18s ease}.line-breakdown[open] .line-breakdown__chevron{transform:rotate(180deg)}
    .line-breakdown__body{padding:3px 10px 8px;border-top:1px solid var(--line)}.line-divider{border-top:1px solid var(--line)}.line-breakdown__body .stat-row small{display:block;color:var(--muted);font-size:9.5px;font-weight:500}.product-empty{padding-block:34px}

    .cost-fields{padding-bottom:14px}.cost-group{padding:11px 10px 0;border:1px solid var(--line);border-radius:14px;background:var(--surface)}.cost-group+.cost-group{margin-top:10px}
    .cost-group__intro{margin-bottom:10px}.cost-group__intro>div{display:flex;gap:7px}.cost-group__step{color:var(--rose);font-size:11px}.cost-group h3{font-size:13px}.cost-group__intro p{color:var(--muted);font-size:11px}.rate-grid{display:grid}
    .allocation-settings{margin-top:10px}.allocation-settings summary{display:block}.allocation-settings summary span{display:flex;flex-direction:column}.allocation-settings summary small{color:var(--muted);font-size:10px}.allocation-settings__body{padding:10px 10px 0;border-top:1px solid var(--line)}

    .purchase-summary{margin-top:12px}.summary-body{padding:14px}.fill-overview{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:7px;color:var(--muted);font-size:11px}.fill-overview>div{display:flex;align-items:baseline;gap:6px}.fill-overview strong{color:var(--ink);font-size:21px}.fill-meter{height:11px}.capacity-alert{margin-top:10px}
    .cost-summary__group+.cost-summary__group{border-top:1px solid var(--line)}.cost-summary .stat-row{padding:4px 0;font-size:12px}.safe-summary{display:flex;gap:8px;margin-top:14px;padding:10px;border-radius:12px;background:var(--ok-soft);color:var(--ok);font-size:12px}
    .action-card{padding:14px}.action-card__head h2{font-size:16px}.action-card__head p{color:var(--muted);font-size:11.5px}.action-card__buttons{display:grid;gap:7px;margin-top:12px}.danger-zone{margin-top:7px;border-top:1px solid var(--line)}.danger-zone summary{padding:11px;color:var(--muted);font-size:11px;text-align:center}.danger-zone p{color:var(--muted);font-size:10px;text-align:center}
    .loading-card{display:flex;min-height:160px;align-items:center;justify-content:center;color:var(--muted)}.loading-card__mark{display:none}

    @media(min-width:560px){.rate-grid{grid-template-columns:repeat(2,1fr)}.po-facts{grid-template-columns:repeat(4,1fr)}}
    @media(min-width:700px){:is(.section-toggle,.section-heading,.product-tools){padding-inline:18px}:is(.section-body,.summary-body,.action-card){padding:18px}.po-line{padding:16px 18px}}
    @media(min-width:1000px){.purchase-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(310px,.7fr);gap:16px}.purchase-summary{margin-top:0}}
  `]
})
export class PurchaseEditor {
  /** Cost breakdowns as totals or per piece; one switch for all lines. */
  /* Per piece is what the buying conversation is about; totals are the
     exception you toggle to. */
  readonly perPiece = signal(true);

  /** Every line amount through one gate, so the toggle cannot miss one. */
  /** Two decimals for totals, four for per-piece - tiny numbers need them. */
  readonly decimals = computed(() => this.perPiece() ? 4 : 2);

  amt(value: number, line: { quantity: number }): number {
    return this.perPiece() && line.quantity > 0 ? value / line.quantity : value;
  }

  /** Products and capacity lead; order setup and cost mechanics open on demand. */
  readonly openSections = signal(new Set<string>());

  toggleSection(name: string): void {
    const next = new Set(this.openSections());
    if (next.has(name)) { next.delete(name); } else { next.add(name); }
    this.openSections.set(next);
  }

  sectionOpen(name: string): boolean {
    return this.openSections().has(name);
  }

  orderSummary(): string {
    const data = this.view();
    if (!data) return '';
    return [this.supplierName(), containerLabel(data.order.containerType),
        data.order.destinationPort].filter(Boolean).join(' · ');
  }

  costsSummary(): string {
    const data = this.view();
    if (!data) return '';
    return `1 USD = ${effectiveUsdToEur(data.order)} EUR · vracht $${data.order.freightUsd}`;
  }

  readonly containerTypes = CONTAINER_TYPES;
  readonly containerLabel = containerLabel;

  /** The one-way street a container travels. */
  /* Three visible steps: "onderweg" added a tap without adding
     information - the stock only moves on receipt anyway. Orders still
     in ONDERWEG from before simply show as Besteld. */
  readonly statusSteps = [
    { value: 'CONCEPT' as const, label: 'Concept', action: 'Bestellen' },
    { value: 'BESTELD' as const, label: 'Besteld', action: 'Container ontvangen' },
    { value: 'ONTVANGEN' as const, label: 'Ontvangen', action: '' },
  ];

  /**
   * The ordered quantity when it no longer matches the line, or null.
   * The costing rows the template renders do not carry the snapshot; the
   * raw order lines do.
   */
  shortShipped(productId: number): number | null {
    const line = this.view()?.order.lines.find((l) => l.productId === productId);
    if (!line || line.orderedQuantity === null || line.orderedQuantity === undefined) return null;
    return line.orderedQuantity !== line.quantity ? line.orderedQuantity : null;
  }

  stepIndex(status: string): number {
    if (status === 'ONDERWEG') status = 'BESTELD';
    return this.statusSteps.findIndex((step) => step.value === status);
  }

  /** The transition the header button offers, or null when the road ends. */
  nextStep(): { action: string; to: string } | null {
    const index = this.stepIndex(this.view()?.order.status ?? 'CONCEPT');
    if (index < 0 || index >= this.statusSteps.length - 1) return null;
    return {
      action: this.statusSteps[index].action,
      to: this.statusSteps[index + 1].value,
    };
  }

  /**
   * Moves the container one step forward.
   *
   * Ordering snapshots the agreed quantities (the backend does that);
   * receiving books the stock, so that one asks first. Adjust short-shipped
   * lines before pressing receive - the order keeps "ordered X" next to
   * every changed line.
   */
  advanceStatus(): void {
    const data = this.view();
    const step = this.nextStep();
    if (!data || !step) return;

    if (step.to === 'ONTVANGEN') {
      this.ui.confirm(
        {
          title: 'Container ontvangen',
          message: 'De voorraad wordt bijgeboekt met de aantallen zoals ze nu op de order '
            + 'staan. Minder ontvangen dan besteld? Pas de aantallen eerst aan; de order '
            + 'onthoudt wat er besteld was.',
          confirmLabel: 'Ontvangen en bijboeken',
        },
        () => { this.enqueue((order) => ({ ...order, status: 'ONTVANGEN' })); },
      );
      return;
    }
    this.enqueue(
      (order) => ({ ...order, status: step.to as PurchaseOrder['status'] }),
      () => this.orderPlaced.set(true),
    );
  }

  readonly ports = DESTINATION_PORTS;

  /**
   * Where the origin costs are incurred, named after the supplier's country.
   * "Local costs China" was hardcoded once, but not every supplier is Chinese.
   */
  readonly costLabels = computed(() => purchaseCostLabels(this.view(), this.supplier()));
  readonly originLabel = computed(() => this.costLabels().originCountry);

  private readonly sourcing = inject(SourcingApi);
  private readonly catalog = inject(CatalogApi);
  private readonly router = inject(Router);
  private readonly ui = inject(Ui);
  readonly privacy = inject(Privacy);

  readonly id = input<string>('');

  readonly allocationKeys = computed(() => {
    const labels = this.costLabels();
    return [
      { field: 'allocFreight' as const, label: labels.seaFreightLabel,
        route: labels.seaFreightRoute },
      { field: 'allocOrigin' as const, label: labels.originCostsLabel,
        route: labels.originRoute },
      { field: 'allocDestination' as const, label: labels.destinationCostsLabel,
        route: '' },
      { field: 'allocExtra' as const, label: 'Extra opbrengst',
        route: 'Commerciële opslag per verdeelsleutel' },
    ];
  });

  readonly view = signal<PurchaseOrderView | null>(null);
  readonly adjustments = signal<PurchaseOrderView['adjustments']>([]);
  readonly products = signal<Product[]>([]);
  /** The order's supplier; drives the header and the origin-cost label. */
  readonly supplier = signal<Supplier | null>(null);

  readonly picking = signal(false);
  /** Opens only after the server confirms CONCEPT -> BESTELD. */
  readonly orderPlaced = signal(false);

  constructor() {
    effect(() => {
      const routeId = this.id();
      if (routeId) void this.load(+routeId);
    });
  }

  private async load(orderId: number): Promise<void> {
    const view = await this.sourcing.purchaseOrder(orderId);
    const [products, suppliers] = await Promise.all([
      this.catalog.products(view.order.supplierId), this.sourcing.suppliers()]);
    this.products.set(products);
    this.supplier.set(suppliers.find((s) => s.id === view.order.supplierId) ?? null);
    /* Publish the order only after its header context is ready. Otherwise the
       app bar first paints a placeholder supplier and visibly jumps when the
       supplier request finishes. */
    this.view.set(view);
  }

  supplierName(): string { return this.supplier()?.name ?? 'Onbekend'; }

  readonly available = computed(() => {
    const used = new Set((this.view()?.order.lines ?? []).map((line) => line.productId));
    return this.products().filter((product) => !used.has(product.id!));
  });

  /** Receipt booked stock already; changing the booked lines would corrupt history. */
  readonly isReceived = computed(() => this.view()?.order.status === 'ONTVANGEN');

  allocationOf(order: PurchaseOrder, field: keyof PurchaseOrder): Allocation {
    return order[field] as Allocation;
  }

  /* Saves run strictly in sequence; see the sales editor for the race
     this prevents. Each queued change is applied onto the freshest order. */
  private saveQueue: Promise<void> = Promise.resolve();

  private enqueue(
    make: (order: PurchaseOrder) => PurchaseOrder,
    afterSave?: (saved: PurchaseOrderView) => void,
  ): void {
    this.saveQueue = this.saveQueue.then(async () => {
      const data = this.view();
      if (!data) return;
      try {
        const saved = await this.save(make(data.order));
        afterSave?.(saved);
      } catch (failure: unknown) {
        /* A rejected save must not reject the queue: the next correction still
           has to reach the server without forcing the user to reload. */
        this.ui.toast(messageOf(failure, 'Opslaan mislukt'), 'err');
      }
    });
  }

  private async save(order: PurchaseOrder): Promise<PurchaseOrderView> {
    const result = await this.sourcing.updatePurchaseOrder(order.id, order);
    this.view.set(result);
    this.adjustments.set(result.adjustments ?? []);
    if (result.adjustments?.length) {
      /* Warning only: purchasing never rounds. A supplier can ship a sample of
         three pieces, and silently inflating an order costs real money. */
      const first = result.adjustments[0];
      this.ui.toast(
        `Let op: ${first.requested} stuks is geen volle doos (${first.piecesPerCarton}/doos)`,
        'err');
    }
    /* Stock levels may have just been booked. The order is already saved here,
       so a failed refresh is reported separately and must not poison autosave. */
    try {
      this.products.set(await this.catalog.products(order.supplierId));
    } catch (failure: unknown) {
      this.ui.toast(
        messageOf(failure, 'Order opgeslagen, maar productgegevens vernieuwen mislukt'), 'err');
    }
    return result;
  }

  piecesPerCarton(productId: number): number {
    return this.products().find((product) => product.id === productId)?.carton.piecesPerCarton ?? 1;
  }

  stockOf(productId: number): number {
    return this.products().find((product) => product.id === productId)?.stockQuantity ?? 0;
  }

  patch(changes: Partial<PurchaseOrder>): void {
    this.enqueue((order) => ({ ...order, ...changes }));
  }

  usdToEurRate(): number {
    return effectiveUsdToEur(this.view()?.order);
  }

  setUsdToEur(rate: number): void {
    this.enqueue((order) => withUsdToEur(order, rate));
  }

  closeOrderPlaced(): void {
    this.orderPlaced.set(false);
  }

  openOrderView(): void {
    const id = this.view()?.order.id;
    this.orderPlaced.set(false);
    if (id) void this.router.navigate(['/purchasing', id]);
  }

  setAllocation(field: keyof PurchaseOrder, value: Allocation): void {
    this.patch({ [field]: value } as Partial<PurchaseOrder>);
  }

  setQuantity(productId: number, quantity: number): void {
    if (this.isReceived()) return;
    this.setLine(productId, { quantity });
  }

  /** The order line behind a calculation line, with the raw input. */
  orderLine(productId: number): PurchaseOrderLine | undefined {
    return this.view()?.order.lines.find((line) => line.productId === productId);
  }

  /**
   * Price agreed at the fair or the factory table? Enter it here, in the
   * currency it was named in. Clearing hands the line back to the price on
   * the product itself.
   */
  setExwPrice(productId: number, raw: unknown): void {
    const empty = raw === null || raw === undefined || raw === '';
    const line = this.orderLine(productId);
    this.setLine(productId, empty
      ? { exwPrice: null, exwCurrency: null }
      : { exwPrice: +String(raw), exwCurrency: line?.exwCurrency ?? 'USD' });
  }

  setExwCurrency(productId: number, currency: Currency): void {
    this.setLine(productId, { exwCurrency: currency });
  }

  private setLine(productId: number, patch: Partial<PurchaseOrderLine>): void {
    this.enqueue((order) => ({
      ...order,
      lines: order.lines.map((line) =>
        line.productId === productId ? { ...line, ...patch } : line),
    }));
  }

  removeLine(productId: number): void {
    if (this.isReceived()) return;
    this.enqueue((order) => ({
      ...order,
      lines: order.lines.filter((line) => line.productId !== productId),
    }));
  }

  openPicker(): void {
    if (this.isReceived()) return;
    this.picking.set(true);
  }

  /** In the purchase picker the price shows the supplier's EXW price. */
  readonly exwPriceOf = (product: Product): number => product.exwPrice ?? 0;
  /** Avoid exposing the true value to the shared picker in customer-safe mode. */
  readonly hiddenPriceOf = (_product: Product): number => 0;

  /**
   * Creates a product from the measurements typed in the picker and puts
   * it on the order in one go - measure the article in your hand, done.
   * Photos, barcodes and translations can follow later on the product.
   */
  async quickCreate(draft: ProductDraft): Promise<void> {
    const data = this.view();
    if (!data) return;
    const created = await this.catalog.createProduct({
      id: null, sku: null, name: draft.name,
      dimensions: { lengthCm: draft.lengthCm, widthCm: draft.widthCm,
          heightCm: draft.heightCm },
      colour: '', description: '', categoryId: null,
      supplierId: data.order.supplierId, active: true,
      barcodeInner: '', barcodeOuter: '', hsCode: '',
      carton: { lengthCm: draft.cartonLengthCm, widthCm: draft.cartonWidthCm,
          heightCm: draft.cartonHeightCm,
          piecesPerCarton: draft.piecesPerCarton, weightKg: draft.weightKg },
      exwPrice: draft.exwPrice, exwCurrency: draft.exwCurrency, extraUnitCost: 0,
      landedCostEur: null, landedCostSource: null,
      markupPct: 45, fixedSalesPriceEur: null,
      stockQuantity: 0, photos: [],
    } as unknown as Product);
    this.products.set(await this.catalog.products(data.order.supplierId));
    this.addLine({ product: created, quantity: draft.piecesPerCarton });
    this.ui.toast(`${draft.name} aangemaakt en op de order gezet`);
  }

  addLine(choice: { product: Product; quantity: number }): void {
    this.picking.set(false);
    if (this.isReceived()) return;
    this.enqueue((order) => ({
      ...order,
      lines: [...order.lines, {
        id: null, productId: choice.product.id!, quantity: choice.quantity,
        exwPrice: null, exwCurrency: null, extraUnitCost: null,
        /* Added after ordering means nothing was agreed for it yet. */
        orderedQuantity: null }],
    }));
  }

  newProduct(): void {
    const data = this.view();
    this.picking.set(false);
    void this.router.navigate(['/products', 'new'], {
      queryParams: { supplier: data?.order.supplierId, returnTo: `/purchasing/${data?.order.id}` },
    });
  }

  /**
   * The calculation as a PDF.
   *
   * What goes on it follows the double-tap switch: with the purchase
   * figures on screen, the desired extra revenue is on the sheet too.
   * Hidden, that line disappears but stays folded into the total - that
   * sheet you can show a customer.
   *
   * Deliberately the same switch and no second checkbox: otherwise you
   * cover the screen and still print the wrong sheet.
   */
  async downloadPdf(): Promise<void> {
    const data = this.view();
    if (!data) return;
    const internal = this.privacy.showPurchase();
    try {
      const blob = await this.sourcing.purchasePdf(data.order.id, internal);
      saveBlob(blob, `${data.order.number}${internal ? '' : '-klantweergave'}.pdf`);
      this.ui.toast(internal
        ? 'Interne PDF gedownload — extra opbrengst als aparte regel'
        : 'Klantweergave gedownload — extra opbrengst zit in de stukprijs');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'PDF maken mislukt'), 'err');
    }
  }

  /** Copies the calculation to price a variant quickly. */
  async duplicate(): Promise<void> {
    const data = this.view();
    if (!data) return;
    try {
      const copy = await this.sourcing.duplicatePurchaseOrder(data.order.id);
      this.ui.toast('Kopie gemaakt: ' + copy.order.number);
      await this.router.navigate(['/purchasing', copy.order.id, 'edit']);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Kopiëren mislukt'), 'err');
    }
  }

  apply(): void {
    const data = this.view();
    if (!data) return;
    this.ui.confirm(
      {
        title: 'Kostprijzen toepassen',
        message: 'De berekende kostprijs per stuk wordt op de producten in de catalogus '
          + 'gezet en overschrijft wat daar staat. Alle marges op verkooporders rekenen '
          + 'vanaf dan met deze cijfers.',
        confirmLabel: 'Toepassen',
      },
      async () => {
        await this.sourcing.applyLandedCosts(data.order.id);
        this.ui.toast('Kostprijzen bijgewerkt in de catalogus');
      },
    );
  }

  remove(): void {
    const data = this.view();
    if (!data) return;
    this.ui.confirm(
      { title: 'Calculatie verwijderen',
        message: `Inkooporder <b>${data.order.number}</b> verwijderen?`,
        confirmLabel: 'Verwijderen', danger: true },
      async () => {
        await this.sourcing.deletePurchaseOrder(data.order.id);
        this.ui.toast('Calculatie verwijderd');
        await this.router.navigate(['/purchasing']);
      });
  }
}
