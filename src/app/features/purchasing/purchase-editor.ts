import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { saveBlob } from '../../core/api/download';
import {
  CHINESE_DEPARTURE_PORTS,
  CONTAINER_TYPES,
  DESTINATION_PORTS,
  OTHER_PORT_VALUE,
  PortOption,
  containerLabel,
} from '../../core/api/geo';
import { messageOf } from '../../core/api/errors';
import {
  Allocation, Currency, DocumentKind, PAYMENT_TERMS, Payee, Product, PurchaseDocument, PurchaseOrder, PurchaseOrderLine,
  PurchaseOrderView, PurchasePayment, ReceivedLine, Supplier, StockLocation,
} from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Diary } from './diary';
import { ProductDraft } from '../../shared/product-picker';
import { ProductPicker } from '../../shared/product-picker';
import { DateField } from '../../shared/date-field';
import { Sheet, Ui } from '../../shared/ui';
import { CbmPipe, CurPipe, DateNlPipe, EurPipe, NumPipe, PctPipe } from '../../shared/pipes';
import { SupplierAddress } from '../../shared/supplier-address';
import { AuthImage } from '../../core/api/auth-image';
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
/** What the receive sheet edits before it is sent. */
interface ReceiveDraft {
  lines: { productId: number; name: string; sku: string; ordered: number; received: number; damaged: number }[];
  bookStock: boolean;
  /** Note the open balance as a final payment while receiving. */
  finalPayment: boolean;
  note: string;
}

/** The container's price basis: DDP when every line says so, EXW otherwise. */
function basisOf(order: PurchaseOrder): 'EXW' | 'DDP' {
  return order.lines.length > 0 && order.lines.every((line) => (line.priceBasis ?? 'EXW') === 'DDP') ? 'DDP' : 'EXW';
}

@Component({
  selector: 'app-purchase-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, PageHeader, Diary, ProductPicker, DateField, Sheet, AuthImage,
            SupplierAddress, PurchaseOrderedSuccess,
            EurPipe, CurPipe, NumPipe, PctPipe, CbmPipe, DateNlPipe],
  template: `
    @if (view(); as data) {
      <app-page-header [title]="data.order.number"
                       [subtitle]="data.order.alias ? data.order.alias + ' · ' + supplierName() : supplierName()"
                       [showBack]="true" [showBell]="false"
                       [titleEditable]="true"
                       (titleChange)="patch({ number: $event })">
        <button class="btn btn--sm" type="button" (click)="downloadPdf()"
                [attr.aria-label]="'Download ' + data.order.number + ' als PDF'">
          PDF
        </button>
        <button class="btn btn--primary btn--sm" type="button"
                [disabled]="saving() || !dirty()" (click)="save()">
          {{ saving() ? 'Bezig…' : (dirty() ? 'Opslaan' : 'Opgeslagen') }}
        </button>
      </app-page-header>

      <div class="content po-page">

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
                {{ data.order.orderDate | dateNl }}
                @if (data.order.alias) { <span aria-hidden="true"> · </span>{{ data.order.alias }} }
              </p>
            </div>
            <span class="po-status"
                  [class.po-status--done]="isReceived()">
              <span class="po-status__dot" aria-hidden="true"></span>
              {{ data.order.status === 'CONCEPT' ? 'Concept' : data.order.status === 'BESTELD' ? 'Besteld'
                : data.order.status === 'ONDERWEG' ? 'Vertrokken' : 'Ontvangen' }}
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

          @if (data.attention?.length) {
            <div class="po-attention" role="status">
              <span class="attention-dot">{{ data.attention!.length }}</span>
              <div class="po-attention__body">
                <b>Actie vereist</b>
                @for (item of data.attention; track item) { <span>{{ item }}</span> }
              </div>
            </div>
          }

          <div class="po-facts">
            <div class="po-fact">
              <span class="po-fact__label">Vertrekhaven</span>
              <strong>{{ costLabels().loadingPort }}</strong>
            </div>
            <div class="po-fact">
              <span class="po-fact__label">Container</span>
              <strong>{{ containerLabel(data.order.containerType) }}</strong>
            </div>
            <div class="po-fact">
              <span class="po-fact__label">Aankomsthaven</span>
              <strong>{{ data.order.destinationPort || 'Rotterdam' }}</strong>
            </div>
            <div class="po-fact">
              <span class="po-fact__label">Lossen op</span>
              <strong>{{ receivingLocationName(data.order.receivingLocationId) }}</strong>
            </div>
            <div class="po-fact">
              <span class="po-fact__label">Lading</span>
              @if (!isDdp() && data.costing.containerFill; as fill) {
                <strong [class.fill-pct--full]="fill.overflowCbm <= 0 && fill.fillPercent >= 97">{{ fill.fillPercent | num: 0 }}% · {{ data.costing.totals.pieces | num }} st</strong>
              } @else {
                <strong>{{ data.costing.totals.pieces | num }} st</strong>
              }
            </div>
            <!-- Six facts fill the grid on every width; the landed total is
                 the one figure a buyer wants at the top anyway. Shown as a
                 dash when purchase figures are hidden. -->
            <div class="po-fact po-fact--total">
              <span class="po-fact__label">Totaal geland</span>
              <strong>{{ data.costing.totals.totalEur | eur }}</strong>
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
                      <app-supplier-address [supplier]="supplier()" [inline]="true"
                                            [showEmpty]="true" />
                    </span>
                    <span class="supplier-context__country">{{ supplier()?.currency }}</span>
                  </div>

                  <div class="form-grid order-fields">
                    <div class="order-fields__group"><span>Order</span></div>
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
                    @if (!isReceived()) {
                      <div class="field">
                        <label for="po-expected">Verwacht op <span class="opt"></span></label>
                        <app-date-field fieldId="po-expected" [value]="data.order.expectedArrival ?? ''"
                                        (valueChange)="patch({ expectedArrival: $event || null })" />
                        <span class="hint">De producten tonen dit als "te verwachten" tot de container binnen is.</span>
                      </div>
                    } @else if (data.order.receivedOn) {
                      <div class="field">
                        <label>Ontvangen op</label>
                        <div class="input" style="background:var(--surface-2)">{{ data.order.receivedOn | dateNl }}</div>
                      </div>
                    }
                    <div class="field">
                      <label for="po-terms">Betaalafspraak</label>
                      <select class="select" id="po-terms" [ngModel]="data.order.paymentTerms ?? 'THIRDS'"
                              (ngModelChange)="patch({ paymentTerms: $event })">
                        @for (terms of paymentTermOptions; track terms.value) {
                          <option [value]="terms.value">{{ terms.label }}</option>
                        }
                      </select>
                      <span class="hint">De betalingen rechts volgen dit plan: per termijn zie je wat open staat.</span>
                    </div>
                    @if (data.order.status !== 'CONCEPT') {
                      <div class="field">
                        <label for="po-tracking">Track &amp; trace <span class="opt"></span></label>
                        <input class="input" id="po-tracking" placeholder="Containernummer, B/L of link van de rederij"
                               [ngModel]="data.order.trackingReference ?? ''"
                               (ngModelChange)="patch({ trackingReference: $event || null })" />
                        @if (data.order.shippedOn) {
                          <span class="hint">Vertrokken op {{ data.order.shippedOn | dateNl }}.</span>
                        }
                      </div>
                    }
                    <div class="order-fields__group"><span>Route</span>
                      <small>{{ costLabels().loadingPort }} → {{ costLabels().destinationPort }} · {{ containerLabel(data.order.containerType) }} · lossen op {{ receivingLocationName(data.order.receivingLocationId) }}</small></div>
                    <div class="field order-route-field">
                      <label for="po-container">Type container</label>
                      <select class="select" id="po-container"
                              [ngModel]="data.order.containerType"
                              (ngModelChange)="patch({ containerType: $event })">
                        @for (type of containerTypes; track type.value) {
                          <option [value]="type.value">{{ type.label }}</option>
                        }
                      </select>
                    </div>
                    <div class="field port-field order-route-field">
                      <label for="po-departure-port">Vertrekhaven</label>
                      <select class="select" id="po-departure-port"
                              [ngModel]="portSelection(
                                data.order.departurePort, departurePorts, customDeparturePort())"
                              (ngModelChange)="selectDeparturePort($event)">
                        @for (port of departurePorts; track port.value) {
                          <option [value]="port.value">{{ port.label }}</option>
                        }
                        <option [value]="otherPortValue">Andere haven…</option>
                      </select>
                      @if (usesCustomDeparturePort(data.order.departurePort)) {
                        <input class="input port-field__custom" id="po-custom-departure-port"
                               aria-label="Andere vertrekhaven"
                               autocomplete="off" placeholder="Typ de vertrekhaven"
                               [value]="customPortInput(
                                 data.order.departurePort, departurePorts, customDeparturePort())"
                               (blur)="setCustomDeparturePort($any($event.target).value)" />
                      }
                    </div>
                    <div class="field port-field order-route-field">
                      <label for="po-destination-port">Aankomsthaven</label>
                      <select class="select" id="po-destination-port"
                              [ngModel]="portSelection(
                                data.order.destinationPort, destinationPorts,
                                customDestinationPort(), 'Rotterdam')"
                              (ngModelChange)="selectDestinationPort($event)">
                        @for (port of destinationPorts; track port.value) {
                          <option [value]="port.value">{{ port.label }}</option>
                        }
                        <option [value]="otherPortValue">Andere haven…</option>
                      </select>
                      @if (usesCustomDestinationPort(data.order.destinationPort)) {
                        <input class="input port-field__custom" id="po-custom-destination-port"
                               aria-label="Andere aankomsthaven"
                               autocomplete="off" placeholder="Typ de aankomsthaven"
                               [value]="customPortInput(
                                 data.order.destinationPort, destinationPorts,
                                 customDestinationPort())"
                               (blur)="setCustomDestinationPort($any($event.target).value)" />
                      }
                    </div>
                    <!-- Where the container is unloaded: the stock of every
                         line lands there on Ontvangen. -->
                    <div class="field">
                      <label for="po-receiving">Lossen op</label>
                      <select class="select" id="po-receiving"
                              [ngModel]="data.order.receivingLocationId ?? mainLocationId()"
                              (ngModelChange)="patch({ receivingLocationId: +$event })">
                        @for (location of stockLocations(); track location.id) {
                          <option [value]="location.id">{{ location.name }}</option>
                        }
                      </select>
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

              <div class="product-lines">
                <div class="po-lines">
                @for (line of data.costing.lines; track line.productId; let lineIndex = $index) {
                  <article class="po-line">
                    <header class="po-line__head">
                      <!-- The photo says which product faster than a number; the number
                           stays for a product without one. Photo and name walk
                           through to the product itself. -->
                      <a class="po-line__link" [routerLink]="['/products', line.productId]"
                         [title]="line.productName + ' openen'">
                        @if (photoOf(line.productId); as photo) {
                          <img class="po-line__photo" [appAuthSrc]="photo" alt="" draggable="false" />
                        } @else {
                          <span class="po-line__index" aria-hidden="true">{{ lineIndex + 1 }}</span>
                        }
                        <span class="po-line__identity">
                          <strong>{{ line.productName }}</strong>
                          <span>{{ line.cartons | num }} dozen · {{ line.cbm | cbm }}</span>
                        </span>
                      </a>
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
                      <div class="field">
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
                        @if (isReceived()) {
                          <!-- A box opened weeks later can still hold broken
                               glass or come up short: a quiet line under the
                               count it corrects, the details in a sheet. -->
                          <button class="line-issue" type="button" (click)="openIssue(line.productId)">
                            Schade of tekort melden ›
                          </button>
                        }
                      </div>


                      <div class="field">
                        <label [attr.for]="'exw-' + line.productId">Afgesproken prijs per stuk</label>
                        <div class="input-affix">
                          <input class="input num right" [id]="'exw-' + line.productId"
                                 type="number" min="0" step="0.01" inputmode="decimal"
                                 [ngModel]="orderLine(line.productId)?.exwPrice"
                                 [placeholder]="line.quantity
                                   ? (line.goodsUsd / line.quantity | num: 4) : ''"
                                 (ngModelChange)="setExwPrice(line.productId, $event)" />
                          <select class="input-affix__suffix line-currency"
                                  aria-label="Munt van de prijs"
                                  [ngModel]="orderLine(line.productId)?.exwCurrency ?? 'USD'"
                                  (ngModelChange)="setExwCurrency(line.productId, $event)">
                            <option value="USD">USD</option>
                            <option value="CNY">CNY</option>
                            <option value="EUR">EUR</option>
                          </select>
                          <!-- What the price covers decides what the calculation adds. -->
                          <select class="input-affix__suffix line-basis"
                                  aria-label="Wat de prijs dekt"
                                  [ngModel]="orderLine(line.productId)?.priceBasis ?? 'EXW'"
                                  (ngModelChange)="setPriceBasis(line.productId, $event)">
                            <option value="EXW">EXW</option>
                            <option value="DDP">DDP</option>
                          </select>
                        </div>
                        @if ((orderLine(line.productId)?.priceBasis ?? 'EXW') === 'DDP') {
                          <span class="hint">Geleverd incl. rechten, voor de hele container.</span>
                        } @else {
                          <span class="hint">Bij leeg gebruikt actuele prijs.</span>
                        }
                      </div>
                    </div>

                    <details class="line-breakdown">
                      <summary>
                        <span class="line-breakdown__label">
                          <span>Kostopbouw</span>
                        </span>
                        <span class="per-toggle line-breakdown__toggle"
                              role="group" aria-label="Kostopbouw tonen als"
                              (click)="$event.stopPropagation()">
                          <button type="button" [class.on]="!perPiece()"
                                  [attr.aria-pressed]="!perPiece()"
                                  (click)="perPiece.set(false)">Totaal</button>
                          <button type="button" [class.on]="perPiece()"
                                  [attr.aria-pressed]="perPiece()"
                                  (click)="perPiece.set(true)">Per stuk</button>
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
                              Enrosed kost
                              <small>{{ perPiece() ? 'per stuk' : 'hele regel' }}</small>
                            </span>
                            <span class="num">
                              {{ amt(line.extraRevenueEur, line) | eur: decimals() }}
                            </span>
                          </div>
                        }
                      </div>
                    </details>
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
              </div>
            </section>

            <section class="card flow-card">
              <button class="section-toggle" type="button"
                      [attr.aria-expanded]="sectionOpen('costs')"
                      aria-controls="purchase-cost-fields"
                      (click)="toggleSection('costs')">
                <span class="section-step" aria-hidden="true">3</span>
                <span class="section-title-block">
                  <span class="section-kicker">Doorrekenen</span>
                  <span class="section-name">{{ isDdp() ? 'DDP & koers' : 'Transport, invoer & koers' }}</span>
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
                        <h3 id="route-costs-title">{{ isDdp() ? 'Geleverd incl. rechten' : 'Van fabriek tot magazijn' }}</h3>
                      </div>
                      <p>{{ isDdp() ? 'De afgesproken prijzen zijn DDP: transport, lokale kosten en invoerrechten zitten erin en worden niet bijgerekend.' : 'Kosten vóór de EU-grens tellen mee in de douanewaarde.' }}</p>
                    </div>
                    <div class="form-grid">
                      @if (!isDdp()) {
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
                      }
                      <div class="field span-2">
                        <label for="c-extra">Enrosed kost <span class="opt"></span></label>
                        <div class="input-affix">
                          <input class="input num right" id="c-extra" type="number"
                                 step="100" min="0" inputmode="decimal"
                                 [ngModel]="data.order.extraRevenueEur"
                                 (ngModelChange)="patch({ extraRevenueEur: +$event })" />
                          <span class="input-affix__suffix">EUR</span>
                        </div>
                        <span class="hint">Nieuwe calculaties starten op € 2.000 per container.</span>
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
                      <!-- A series is one product to the buyer: its colours and
                           sizes land at one and the same unit cost. -->
                      <label class="switch-row span-2">
                        <span><b>Varianten als één product</b>
                          <small>Kleuren en maten van dezelfde reeks krijgen samen één kostprijs per stuk; de aantallen worden opgeteld.</small></span>
                        <input type="checkbox" [ngModel]="data.order.groupVariants ?? true"
                               (ngModelChange)="patch({ groupVariants: $event })" />
                      </label>
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
          </main>

          <aside class="purchase-summary" aria-label="Containersamenvatting">
            <section class="card summary-card">
              <div class="section-heading summary-heading">
                <span class="section-step" aria-hidden="true">
                  4
                </span>
                <span class="section-title-block">
                  <span class="section-kicker">Controleren</span>
                  <h2 class="section-name">
                    Totale kostprijs
                  </h2>
                  <span class="section-summary">
                    {{ data.costing.totals.pieces | num }} st ·
                    {{ data.costing.totals.cartons | num }} dozen
                  </span>
                </span>
              </div>

              <div class="summary-body">
                @if (isDdp()) {
                  <!-- DDP: the supplier's container, not ours - how full it is
                       is their concern; what we get is the volume and the count. -->
                  <div class="fill-overview">
                    <div>
                      <span class="fill-overview__label">Geleverd DDP</span>
                      <strong>{{ data.costing.totals.pieces | num }} st</strong>
                    </div>
                    <span>{{ data.costing.totals.cbm | cbm }} · {{ data.costing.totals.cartons | num }} dozen</span>
                  </div>
                } @else if (data.costing.containerFill; as fill) {
                  <div class="fill-overview">
                    <div>
                      <span class="fill-overview__label">
                        {{ containerLabel(data.order.containerType) }}
                      </span>
                      <strong [class.fill-pct--full]="fill.overflowCbm <= 0 && fill.fillPercent >= 97">{{ fill.fillPercent | num: 0 }}%</strong>
                    </div>
                    <span>{{ fill.usedCbm | cbm }} van {{ fill.capacityCbm }} m³</span>
                  </div>
                  <div class="meter__track fill-meter"
                       role="meter" aria-label="Containervulling"
                       aria-valuemin="0" aria-valuemax="100"
                       [attr.aria-valuenow]="fill.fillPercent">
                    <div class="meter__fill"
                         [class.meter__fill--warn]="fill.overflowCbm > 0"
                         [class.meter__fill--full]="fill.overflowCbm <= 0 && fill.fillPercent >= 97"
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

                <!-- DDP: the sum below already ends on the landed total; this box
                     would only repeat it. -->
                @if (!isDdp()) {
                <div class="cost-hero">
                  <!-- What the road adds on top of the goods - the figure a
                       buyer negotiates on; an average per piece over mixed
                       products said nothing. Quiet, the total is the star. -->
                  @if (!isDdp()) {
                  <div class="cost-hero__aside">
                    <div class="cost-hero__label">Bovenop de goederen</div>
                    <div class="cost-hero__value cost-hero__value--quiet">
                      + {{ data.costing.totals.totalEur - data.costing.totals.goodsEur | eur }}
                    </div>
                    <div class="cost-hero__sub">
                      @if (data.costing.totals.goodsEur > 0) {
                        {{ overheadPct(data.costing.totals) | num }} % van de inkoop
                      } @else {
                        nog geen goederen geladen
                      }
                    </div>
                  </div>
                  }
                  <div class="cost-hero__unit">
                    <div class="cost-hero__label">Totaal geland</div>
                    <div class="cost-hero__value cost-hero__value--rose">{{ data.costing.totals.totalEur | eur }}</div>
                  </div>
                </div>
                }

                <div class="cost-summary">
                  <div class="cost-summary__group">
                    <span class="cost-section">{{ isDdp() ? '1 · Goederen, geleverd incl. rechten' : '1 · Tot de EU-grens' }}</span>
                    <div class="stat-row">
                      <span>{{ isDdp() ? 'Goederen (DDP)' : 'Goederen' }}
                        <small>{{ data.costing.totals.goodsUsd | cur: 'USD' }}{{ isDdp() ? ' · transport en rechten inbegrepen' : '' }}</small>
                      </span>
                      <span class="num">{{ data.costing.totals.goodsEur | eur }}</span>
                    </div>
                    @if (!isDdp()) {
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
                    }
                  </div>

                  <div class="cost-summary__group">
                    <span class="cost-section">{{ isDdp() ? '2 · Eigen kosten' : '2 · Invoer & aankomst' }}</span>
                    @if (!isDdp()) {
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
                    }
                    @if (data.costing.totals.extraRevenueEur) {
                      <div class="stat-row">
                        <span>Enrosed kost</span>
                        <span class="num">{{ data.costing.totals.extraRevenueEur | eur }}</span>
                      </div>
                    }
                  </div>

                  <div class="cost-summary__group">
                    <span class="cost-section">3 · Totaal</span>
                    <div class="stat-row cost-summary__subtotal">
                      <span>Totaal geland</span>
                      <strong class="num">{{ data.costing.totals.totalEur | eur }}</strong>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <!-- Money goes two ways. To the factory for the goods (and the
                 sea freight when the price is CIF), in the agreed instalments;
                 to the forwarder and customs for the road, once the box is
                 here. The Enrosed kost is ours and nobody's invoice. -->
            <section class="card payments-card" aria-labelledby="purchase-payments-title">
              <div class="action-card__head">
                <span class="po-eyebrow">Betalingen</span>
                <h2 id="purchase-payments-title">
                  @if (paidAll() > 0) { {{ paidAll() | eur }} betaald } @else { Nog niets betaald }
                </h2>
                <p>Te betalen: {{ owedAll() | eur }} · open {{ openAll() | eur }}</p>
              </div>

              <div class="pay-stream">
                <div class="pay-stream__head">
                  <span><b>Aan de leverancier</b><small>{{ data.payable?.freightInSupplierPrice ? 'goederen + zeevracht (in de prijs)' : 'de goederen' }}</small></span>
                  <span class="num"><b>{{ paidTo('SUPPLIER') | eur }}</b><small>van {{ supplierOwed() | eur }}</small></span>
                </div>
                <div class="payments-meter"><div class="payments-meter__fill" [style.width.%]="pct(paidTo('SUPPLIER'), supplierOwed())"></div></div>
                @if (plannedInstalments(); as plan) {
                  @if (plan.length) {
                    <ol class="instalments">
                      @for (step of plan; track step.label) {
                        <li [class.instalments__item--paid]="step.state === 'paid'" [class.instalments__item--due]="step.state === 'due'">
                          <i aria-hidden="true">{{ step.state === 'paid' ? '✓' : (step.state === 'due' ? '!' : '·') }}</i>
                          <span class="instalments__what">
                            <b>{{ step.label }}</b>
                            <small>{{ step.amount | eur }}{{ step.state === 'due' ? ' · nu te betalen' : (step.state === 'later' ? ' · later' : '') }}</small>
                          </span>
                          @if (step.state === 'due') {
                            <button class="btn btn--sm" type="button" (click)="openPayment(step.amount, step.label, 'SUPPLIER')">Noteren</button>
                          }
                        </li>
                      }
                    </ol>
                  }
                }
                @for (payment of paymentsTo('SUPPLIER'); track payment.id) {
                  <div class="pay-line">
                    <span class="pay-line__what"><b>{{ payment.label || 'Betaling' }}</b>
                      <small>{{ payment.paidOn | dateNl }}@if (payment.currency !== 'EUR') { · {{ payment.amount | cur: payment.currency }}}@if (proofsOf(payment.id).length) { · {{ proofsOf(payment.id).length }} bewijs}</small></span>
                    <span class="num pay-line__amount">{{ payment.amountEur | eur }}</span>
                    <button class="pay-line__remove" type="button" title="Verwijderen" [attr.aria-label]="'Betaling verwijderen'" (click)="removePayment(payment)">×</button>
                  </div>
                }
                @if (openFor('SUPPLIER') > 0 || !(supplierOwed() > 0)) {
                  <button class="pay-stream__add" type="button" (click)="openPayment(undefined, undefined, 'SUPPLIER')">+ Betaling aan de leverancier</button>
                } @else {
                  <p class="pay-stream__done">✓ Volledig betaald</p>
                }
              </div>

              @if (!isDdp()) {
                <div class="pay-stream">
                  <div class="pay-stream__head">
                    <span><b>Douane &amp; transport tot lossen op {{ receivingLocationName(data.order.receivingLocationId) }}</b><small>invoerrechten, {{ data.payable?.freightInSupplierPrice ? '' : 'zeevracht, ' }}lokale kosten, aankomst · na aankomst</small></span>
                    <span class="num"><b>{{ paidTo('LOGISTICS') | eur }}</b><small>van {{ logisticsOwed() | eur }}</small></span>
                  </div>
                  <div class="payments-meter"><div class="payments-meter__fill" [style.width.%]="pct(paidTo('LOGISTICS'), logisticsOwed())"></div></div>
                  @for (payment of paymentsTo('LOGISTICS'); track payment.id) {
                    <div class="pay-line">
                      <span class="pay-line__what"><b>{{ payment.label || 'Betaling' }}</b>
                        <small>{{ payment.paidOn | dateNl }}@if (payment.currency !== 'EUR') { · {{ payment.amount | cur: payment.currency }}}</small></span>
                      <span class="num pay-line__amount">{{ payment.amountEur | eur }}</span>
                      <button class="pay-line__remove" type="button" title="Verwijderen" [attr.aria-label]="'Betaling verwijderen'" (click)="removePayment(payment)">×</button>
                    </div>
                  }
                  @if (openFor('LOGISTICS') > 0 || !(logisticsOwed() > 0)) {
                    <button class="pay-stream__add" type="button" (click)="openPayment(undefined, undefined, 'LOGISTICS')">+ Betaling douane &amp; transport</button>
                  } @else {
                    <p class="pay-stream__done">✓ Volledig betaald</p>
                  }
                </div>
              }

              @if (data.costing.totals.extraRevenueEur) {
                <p class="pay-ours">Enrosed kost {{ data.costing.totals.extraRevenueEur | eur }} is onze eigen opslag - geen betaling.</p>
              }
            </section>

            <!-- The container's diary: agreements, then the receipt, the
                 booking and every payment write themselves in here. -->
            <section class="card note-card" aria-labelledby="purchase-note-title">
              <div class="action-card__head note-card__head">
                <div>
                  <span class="po-eyebrow">Notitie</span>
                  <h2 id="purchase-note-title">Dagboek van de container</h2>
                </div>
                <button class="linklike" type="button" (click)="noteEditing.set(!noteEditing())">
                  {{ noteEditing() ? 'Klaar' : 'Bewerken' }}
                </button>
              </div>
              @if (noteEditing()) {
                <textarea class="note-card__field" rows="8" [ngModel]="data.order.notes"
                          (ngModelChange)="patch({ notes: $event })"
                          placeholder="Afspraken, laadinstructies of aandachtspunten - ontvangst, bijboeken en betalingen schrijven zich hier vanzelf bij"></textarea>
              } @else if (data.order.notes) {
                <div class="note-card__diary"><app-diary [notes]="data.order.notes" /></div>
              } @else {
                <p class="note-card__empty">Nog leeg - ontvangst, bijboeken en betalingen schrijven zich hier vanzelf bij. Tik Bewerken voor eigen afspraken.</p>
              }
            </section>

            <!-- The paper trail of a container: only what was actually added. -->
            <section class="card files-card" aria-labelledby="purchase-files-title">
              <div class="action-card__head">
                <span class="po-eyebrow">Bestanden</span>
                <h2 id="purchase-files-title">Documenten</h2>
                <p>{{ (documents() ?? []).length ? (documents()!.length + ' bestand' + (documents()!.length === 1 ? '' : 'en')) : 'Nog geen bestanden bij deze container.' }}</p>
              </div>
              @if (documents(); as docs) {
                @if (docs.length) {
                  <ul class="files-list">
                    @for (doc of docs; track doc.id) {
                      <li>
                        <span class="files-list__name">
                          <b>{{ doc.kindLabel }}{{ doc.label ? ' · ' + doc.label : '' }}</b>
                          <small>{{ doc.originalFilename }} · {{ sizeLabel(doc.sizeBytes) }} · {{ doc.addedAt | dateNl }}</small>
                        </span>
                        <span class="files-list__actions">
                          <button class="btn btn--sm" type="button" (click)="downloadDocument(doc)">Openen</button>
                          <button class="pay-line__remove" type="button" title="Verwijderen" aria-label="Document verwijderen" (click)="removeDocument(doc)">×</button>
                        </span>
                      </li>
                    }
                  </ul>
                }
              }
              <div class="action-card__buttons">
                <button class="btn btn--block" type="button" (click)="openDocument()">Document toevoegen</button>
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
                    Bij ontvangst tel je wat er echt in de container zat; bijboeken kan meteen of later.
                  } @else if (!(data.order.stockBooked ?? true)) {
                    Ontvangen, nog niet bijgeboekt: de stuks staan nog niet in de voorraad.
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
                @if (isReceived() && !(data.order.stockBooked ?? true)) {
                  <!-- Received but not on the shelf yet: the one action left. -->
                  <button class="btn btn--primary btn--block" type="button" [disabled]="booking()"
                          (click)="bookStock()">
                    {{ booking() ? 'Bezig…' : 'Voorraad bijboeken' }}
                  </button>
                }
                <button class="btn btn--block" type="button" (click)="apply()">
                  {{ costsApplied() ? 'Opnieuw kostprijzen toepassen' : 'Kostprijzen toepassen' }}
                </button>
                <button class="btn btn--block" type="button" (click)="duplicate()">
                  Deze container kopiëren
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
          heading="Product toevoegen aan de container"
          [products]="available()"
          [priceOf]="exwPriceOf"
          [enforceCartons]="false"
          mode="multi"
          [stockAware]="false"
          (picked)="addLine($event)"
          (pickedMany)="addLines($event)"
          (cancelled)="picking.set(false)"
          [allowCreate]="true"
          [createCurrency]="supplier()?.currency ?? 'USD'"
          (create)="quickCreate($event)"
        />
      }

      @if (issue(); as report) {
        <app-sheet [title]="'Schade of tekort · ' + (issueLine()?.productName ?? '')" (closed)="issue.set(null)">
          <div body>
            <div class="per-toggle issue-kind" role="group" aria-label="Wat is er aan de hand?">
              <button type="button" [class.on]="report.kind === 'DAMAGED'"
                      (click)="issue.set({ ...report, kind: 'DAMAGED' })">Beschadigd</button>
              <button type="button" [class.on]="report.kind === 'SHORT'"
                      (click)="issue.set({ ...report, kind: 'SHORT' })">Minder aangekomen</button>
            </div>
            <div class="field mt-12">
              <label class="req" for="issue-qty">Aantal stuks</label>
              <input class="input num right" id="issue-qty" type="number" min="1" step="1" inputmode="numeric"
                     [ngModel]="report.quantity || null" (ngModelChange)="issue.set({ ...report, quantity: +$event })" />
            </div>
            @if (issueLine(); as line) {
              @if (report.kind === 'DAMAGED') {
                <p class="hint mt-8">Nu {{ orderLine(line.productId)?.damagedQuantity ?? 0 }} beschadigd van {{ line.quantity | num }} ontvangen.
                  {{ report.quantity > 0 ? 'Er komen ' + report.quantity + ' bij; die gaan als beschadigd uit de voorraad.' : '' }}</p>
              } @else {
                <p class="hint mt-8">Ontvangen telt nu {{ line.quantity | num }} stuks.
                  {{ report.quantity > 0 ? 'Wordt ' + (line.quantity - report.quantity) + '; het verschil gaat uit de voorraad.' : '' }}</p>
              }
            }
          </div>
          <div foot style="display:contents">
            <span class="spacer"></span>
            <button class="btn" type="button" (click)="issue.set(null)">Annuleren</button>
            <button class="btn btn--primary" type="button"
                    [disabled]="saving() || !(report.quantity > 0)" (click)="confirmIssue()">
              {{ saving() ? 'Bezig…' : 'Melden' }}
            </button>
          </div>
        </app-sheet>
      }

      @if (paying(); as pay) {
        <app-sheet [title]="pay.payee === 'LOGISTICS' ? 'Betaling douane & transport' : 'Betaling aan de leverancier'" (closed)="paying.set(null)">
          <div body>
            <!-- Deposits are fractions of the goods: one tap fills them in. -->
            <div class="pay-chips" role="group" aria-label="Snel invullen">
              @for (chip of (pay.payee === 'SUPPLIER' ? payChips() : []); track chip.label) {
                <button class="pay-chip" type="button" (click)="paying.set({ ...pay, amount: chip.amount, currency: 'EUR', label: chip.label })">
                  {{ chip.label }}<small>{{ chip.amount | eur }}</small>
                </button>
              }
            </div>
            <div class="form-grid mt-12">
              <div class="field">
                <label for="pay-amount">Bedrag</label>
                <div class="input-affix">
                  <input class="input num right" id="pay-amount" type="number" min="0" step="0.01" inputmode="decimal"
                         [ngModel]="pay.amount" (ngModelChange)="paying.set({ ...pay, amount: +$event })" />
                  <select class="input-affix__suffix line-currency" aria-label="Munt"
                          [ngModel]="pay.currency" (ngModelChange)="paying.set({ ...pay, currency: $event })">
                    <option value="EUR">EUR</option>
                    <option value="USD">USD</option>
                    <option value="CNY">CNY</option>
                  </select>
                </div>
                @if (pay.currency !== 'EUR' && pay.amount > 0) {
                  <span class="hint">≈ {{ eurOf(pay.amount, pay.currency) | eur }} aan de koers van deze order.</span>
                }
                @if (payingOverage() > 0) {
                  <span class="hint hint--warn">Er staat nog {{ openFor(pay.payee) | eur }} open; dit bedrag gaat daar {{ payingOverage() | eur }} overheen.</span>
                } @else if (pay.amount > 0 && openFor(pay.payee) > 0) {
                  <span class="hint">Nog open: {{ openFor(pay.payee) | eur }}.</span>
                }
              </div>
              <div class="field">
                <label for="pay-date">Betaald op</label>
                <app-date-field fieldId="pay-date" [value]="pay.paidOn" (valueChange)="paying.set({ ...pay, paidOn: $event })" />
              </div>
              <div class="field span-2">
                <label for="pay-label">Omschrijving <span class="opt"></span></label>
                <input class="input" id="pay-label" placeholder="Bijv. aanbetaling 30%, saldo, slotbetaling"
                       [ngModel]="pay.label" (ngModelChange)="paying.set({ ...pay, label: $event })" />
              </div>
            </div>
          </div>
          <div foot style="display:contents">
            <button class="btn" type="button" (click)="paying.set(null)">Annuleren</button>
            <button class="btn btn--primary" type="button" [disabled]="payingBusy() || !(pay.amount > 0) || payingOverage() > 0" (click)="confirmPayment()">
              {{ payingBusy() ? 'Bezig…' : 'Betaling bewaren' }}
            </button>
          </div>
        </app-sheet>
      }

      @if (addingDocument(); as doc) {
        <app-sheet title="Document toevoegen" (closed)="addingDocument.set(null)">
          <div body>
            <div class="form-grid">
              <div class="field">
                <label for="doc-kind">Soort</label>
                <select class="select" id="doc-kind" [ngModel]="doc.kind" (ngModelChange)="addingDocument.set({ ...doc, kind: $event })">
                  @for (kind of documentKinds; track kind.value) { <option [value]="kind.value">{{ kind.label }}</option> }
                </select>
              </div>
              <div class="field">
                <label for="doc-label">Omschrijving <span class="opt"></span></label>
                <input class="input" id="doc-label" placeholder="bijv. KBC 23/08, factuur 2e helft"
                       [ngModel]="doc.label" (ngModelChange)="addingDocument.set({ ...doc, label: $event })" />
              </div>
              @if (doc.kind === 'PAYMENT_PROOF' && paymentsTo('SUPPLIER').length + paymentsTo('LOGISTICS').length) {
                <div class="field span-2">
                  <label for="doc-payment">Hoort bij betaling <span class="opt"></span></label>
                  <select class="select" id="doc-payment" [ngModel]="doc.paymentId ?? ''" (ngModelChange)="addingDocument.set({ ...doc, paymentId: $event ? +$event : null })">
                    <option value="">— geen —</option>
                    @for (payment of payments() ?? []; track payment.id) {
                      <option [value]="payment.id">{{ payment.paidOn | dateNl }} · {{ payment.amountEur | eur }}{{ payment.label ? ' · ' + payment.label : '' }}</option>
                    }
                  </select>
                </div>
              }
              <div class="field span-2">
                <label for="doc-file">Bestand</label>
                <input class="input" id="doc-file" type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx,.csv"
                       (change)="addingDocument.set({ ...doc, file: $any($event.target).files?.[0] ?? null })" />
                <span class="hint">PDF, foto of Office-bestand, tot 25 MB.</span>
              </div>
            </div>
          </div>
          <div foot style="display:contents">
            <button class="btn" type="button" (click)="addingDocument.set(null)">Annuleren</button>
            <button class="btn btn--primary" type="button" [disabled]="uploadingDocument() || !doc.file" (click)="confirmDocument()">
              {{ uploadingDocument() ? 'Bezig…' : 'Bewaren' }}
            </button>
          </div>
        </app-sheet>
      }

      @if (firstInstalmentPrompt(); as first) {
        <!-- Just ordered: the first instalment falls due now. Ask once, with
             room for the bank statement. -->
        <app-sheet title="Eerste betaling" (closed)="firstInstalmentPrompt.set(null)">
          <div body>
            <p>De bestelling staat vast. Volgens de betaalafspraak is nu <b>{{ first.label }}</b> aan de beurt:
              <b>{{ first.amount | eur }}</b> aan {{ supplierName() }}.</p>
            <p class="hint mt-8">Al betaald? Noteer het hier, eventueel met het bankafschrift (max. 2 bestanden). Nog niet? Dan blijft de termijn open staan bij Betalingen.</p>
            <div class="form-grid mt-12">
              <div class="field">
                <label for="first-amount">Betaald bedrag</label>
                <div class="input-affix">
                  <input class="input num right" id="first-amount" type="number" min="0" step="0.01" inputmode="decimal"
                         [ngModel]="first.amount" (ngModelChange)="firstInstalmentPrompt.set({ ...first, amount: +$event })" />
                  <select class="input-affix__suffix line-currency" aria-label="Munt" [ngModel]="first.currency"
                          (ngModelChange)="firstInstalmentPrompt.set({ ...first, currency: $event })">
                    <option value="EUR">EUR</option><option value="USD">USD</option><option value="CNY">CNY</option>
                  </select>
                </div>
              </div>
              <div class="field">
                <label for="first-date">Betaald op</label>
                <app-date-field fieldId="first-date" [value]="first.paidOn" (valueChange)="firstInstalmentPrompt.set({ ...first, paidOn: $event })" />
              </div>
              <div class="field span-2">
                <label for="first-proof">Betalingsbewijs <span class="opt"></span></label>
                <input class="input" id="first-proof" type="file" multiple accept=".pdf,.jpg,.jpeg,.png"
                       (change)="firstInstalmentPrompt.set({ ...first, files: fileList($any($event.target).files) })" />
                <span class="hint">Bijv. het KBC-afschrift; hoogstens twee bestanden.</span>
              </div>
            </div>
          </div>
          <div foot style="display:contents">
            <button class="btn" type="button" (click)="firstInstalmentPrompt.set(null)">Nog niet betaald</button>
            <button class="btn btn--primary" type="button" [disabled]="payingBusy() || !(first.amount > 0)" (click)="confirmFirstInstalment()">
              {{ payingBusy() ? 'Bezig…' : 'Betaald - noteren' }}
            </button>
          </div>
        </app-sheet>
      }

      @if (receiving(); as draft) {
        <!-- The container is in. Count what is there, note what broke, say
             what was paid, and decide whether the shelf gets it now. -->
        <app-sheet title="Container ontvangen" [wide]="true" (closed)="receiving.set(null)">
          <div body>
            <p class="hint">Vul per product in wat er werkelijk in de container zat. Staat alles zoals
              besteld, dan hoef je niets te wijzigen.</p>
            <div class="receive-lines">
              @for (line of draft.lines; track line.productId) {
                <div class="receive-line" [class.receive-line--short]="line.received < line.ordered"
                     [class.receive-line--damaged]="line.damaged > 0">
                  <div class="receive-line__name">
                    <b>{{ line.name }}</b>
                    <small>{{ line.sku }} · besteld {{ line.ordered | num }}</small>
                  </div>
                  <label class="receive-line__field">
                    <span>Ontvangen</span>
                    <input class="input num right" type="number" min="0" step="1" inputmode="numeric"
                           [ngModel]="line.received" (ngModelChange)="setReceived(line.productId, +$event)" />
                  </label>
                  <label class="receive-line__field">
                    <span>Beschadigd</span>
                    <input class="input num right" type="number" min="0" step="1" inputmode="numeric"
                           [ngModel]="line.damaged" (ngModelChange)="setDamaged(line.productId, +$event)" />
                  </label>
                  @if (line.received !== line.ordered || line.damaged > 0) {
                    <span class="receive-line__note">
                      @if (line.received < line.ordered) { {{ line.ordered - line.received | num }} te weinig }
                      @if (line.received > line.ordered) { {{ line.received - line.ordered | num }} te veel }
                      @if (line.damaged > 0) { · {{ line.damaged | num }} kapot }
                    </span>
                  }
                </div>
              }
            </div>

            <div class="receive-balance mt-12">
              <div>
                <b>Betaald tot nu: {{ paidTotalEur() | eur }}</b>
                <small>Goederenwaarde {{ data.costing.totals.goodsEur | eur }} · totaal geland {{ data.costing.totals.totalEur | eur }}</small>
              </div>
              @if (remainingEur() > 0.005) {
                <label class="receive-balance__final">
                  <input type="checkbox" [ngModel]="draft.finalPayment" (ngModelChange)="receiving.set({ ...draft, finalPayment: $event })" />
                  <span>Slotbetaling van <b>{{ remainingEur() | eur }}</b> meteen noteren</span>
                </label>
              } @else {
                <span class="hint">Volledig betaald volgens de betalingen hierboven.</span>
              }
            </div>

            <div class="field mt-12">
              <label for="rc-note">Opmerking bij de ontvangst <span class="opt"></span></label>
              <textarea class="textarea" id="rc-note" rows="2" [ngModel]="draft.note"
                        (ngModelChange)="receiving.set({ ...draft, note: $event })"
                        placeholder="Bijv. doos 3 nat aangekomen, foto's gemaild naar leverancier"></textarea>
              <span class="hint">Komt met de datum in de notitie van de order; tekorten en schade worden er automatisch bij gezet.</span>
            </div>

            <label class="switch-row mt-12">
              <span><b>Meteen bijboeken op {{ receivingLocationName(data.order.receivingLocationId) }}</b>
                <small>Ontvangen min beschadigd gaat in de voorraad. Uit: later via "Voorraad bijboeken".</small></span>
              <input type="checkbox" [ngModel]="draft.bookStock" (ngModelChange)="receiving.set({ ...draft, bookStock: $event })" />
            </label>
          </div>
          <div foot style="display:contents">
            <button class="btn" type="button" (click)="receiving.set(null)">Annuleren</button>
            <button class="btn btn--primary" type="button" [disabled]="booking()" (click)="confirmReceive()">
              {{ booking() ? 'Bezig…' : (draft.bookStock ? 'Ontvangen en bijboeken' : 'Ontvangen') }}
            </button>
          </div>
        </app-sheet>
      }

      @if (orderPlaced()) {
        <app-purchase-ordered-success [orderNumber]="data.order.number"
                                      (closed)="closeOrderPlaced()"
                                      (overview)="openOrderView()" />
      }
    } @else {
      <app-page-header title="Inkoop" subtitle="Inkooporder laden…"
                       [showBack]="true" [showBell]="false" />
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
    .po-fact--total strong{color:var(--rose-dark)}
    .fill-overview strong.fill-pct--full,.po-fact strong.fill-pct--full{color:var(--ok)}
    .po-fact{min-width:0;padding:9px 10px;background:var(--surface)}.po-fact__label{display:block;color:var(--muted);font-size:9.5px;text-transform:uppercase}.po-fact strong{display:block;overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}

    :is(.purchase-main,.purchase-summary){min-width:0}:is(.purchase-main,.purchase-summary)>.card+.card{margin-top:12px}:is(.flow-card,.summary-card,.action-card){overflow:hidden}
    :is(.section-toggle,.section-heading){display:flex;width:100%;min-height:72px;align-items:center;gap:10px;padding:12px 14px;border:0;background:var(--surface);text-align:left}
    .section-toggle{cursor:pointer}.section-step{display:grid;width:34px;height:34px;flex:0 0 34px;place-items:center;border:1px solid var(--rose-line);border-radius:11px;background:var(--rose-soft);color:var(--rose-dark);font-weight:750}
    .section-title-block{display:block;min-width:0;flex:1}.section-name{display:block;font-size:15px;font-weight:700}.section-summary{display:block;overflow:hidden;color:var(--muted);font-size:11.5px;text-overflow:ellipsis;white-space:nowrap}
    .section-chevron{flex:none;color:var(--muted)}.section-chevron--open{transform:rotate(180deg)}.section-body{padding:14px 14px 0;border-top:1px solid var(--line);background:var(--surface-2)}

    .supplier-context{display:flex;align-items:center;gap:9px;margin-bottom:14px;padding:10px;border:1px solid var(--line);border-radius:14px;background:var(--surface)}
    .supplier-context__mark{display:grid;width:34px;height:34px;place-items:center;border-radius:10px;background:var(--rose);color:#fff}.supplier-context__copy{display:flex;min-width:0;flex:1;flex-direction:column}.supplier-context__copy>span,.supplier-context__country{color:var(--muted);font-size:10px}.supplier-context__copy strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.supplier-context__copy app-supplier-address{margin-top:1px}
    :is(.order-fields,.po-line__inputs) .field{min-width:0}.order-fields__group{grid-column:1/-1;display:flex;align-items:baseline;gap:10px;margin-top:6px;padding-top:12px;border-top:1px solid var(--line)}.order-fields__group:first-child{margin-top:0;padding-top:0;border-top:0}.order-fields__group span{color:var(--rose);font-size:10px;font-weight:760;letter-spacing:.1em;text-transform:uppercase}.order-fields__group small{color:var(--muted);font-size:11.5px}.port-field__custom{margin-top:7px}

  `, `

    .products-card{overflow:visible}:is(.products-card .section-heading,.summary-heading){border-bottom:1px solid var(--line)}.add-product{flex:none;min-height:40px;padding-inline:11px}
    .po-line{padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--surface);box-shadow:0 1px 2px rgb(31 25 22 / 4%)}.po-line+.po-line{margin-top:10px}.po-line__head{display:flex;align-items:center;gap:9px;margin-bottom:12px}
    .po-lines{padding:12px;border-radius:16px;background:var(--surface-2)}
    .po-line__index{display:grid;width:36px;height:36px;place-items:center;border:1px solid var(--line);border-radius:10px;background:var(--surface-2);color:var(--muted);font-size:11px;font-weight:700}.po-line__photo{width:36px;height:36px;flex:none;border:1px solid var(--line);border-radius:10px;object-fit:cover;background:#fff}.po-line__identity{display:flex;min-width:0;flex:1;flex-direction:column}.po-line__identity strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.po-line__identity span{color:var(--muted);font-size:12px}
    .purchase-summary .cost-hero{grid-template-columns:1fr;gap:8px}.purchase-summary .cost-hero__unit{min-width:0;padding:10px 0 0;border-left:0;border-top:1px solid var(--line);text-align:left;align-self:auto}
    .pay-stream__head{flex-wrap:wrap}.pay-stream__head>span:last-child{text-align:right;margin-left:auto}
    .po-line__link{display:flex;flex:1;min-width:0;align-items:center;gap:inherit;color:inherit;text-decoration:none}.po-line__link:hover strong{color:var(--rose-dark);text-decoration:underline}
    .line-issue{display:block;padding:4px 0 0;border:0;background:transparent;color:var(--muted);font:inherit;font-size:11.5px;font-weight:650;text-align:left;cursor:pointer}.line-issue:hover{color:var(--rose-dark)}.issue-kind{margin-top:2px}
    .payments-card .action-card__head,.files-card .action-card__head,.note-card .action-card__head{padding:14px 18px 10px}.note-card__field{display:block;width:100%;padding:0 18px 14px;border:0;background:transparent;color:var(--ink);font:inherit;font-size:13px;line-height:1.5;resize:vertical;outline:none;box-sizing:border-box}.note-card__head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.note-card__head .linklike{flex:none;margin-top:2px}.note-card__diary{padding:0 18px 12px}.note-card__empty{margin:0;padding:0 18px 14px;color:var(--muted);font-size:12px}.po-attention{display:flex;align-items:flex-start;gap:10px;margin:12px 0;padding:10px 12px;border:1px solid #eddcb9;border-radius:12px;background:var(--warn-soft)}.po-attention__body{display:grid;gap:2px;min-width:0;font-size:12.5px;color:var(--ink-2)}.po-attention__body b{color:var(--warn);font-size:11px;letter-spacing:.06em;text-transform:uppercase}.attention-dot{display:inline-grid;place-items:center;flex:none;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:var(--warn);color:#fff;font-size:11px;font-weight:800;line-height:1}.files-card .action-card__buttons{padding:0 18px 14px;margin-top:0}.payments-card .action-card__head h2{font-size:16px}.field .hint--warn{color:var(--danger);font-weight:650}.pay-stream__done{margin:8px 0 2px;color:var(--ok,#2e7d4f);font-size:12.5px;font-weight:650}.payments-meter{height:6px;margin:0 18px 12px;border-radius:999px;background:var(--line);overflow:hidden}.payments-meter__fill{height:100%;background:var(--ok,#2e7d4f);border-radius:999px;transition:width .2s ease}.payments-list{list-style:none;margin:0 18px;padding:0;border-top:1px solid var(--line)}.payments-list li{display:grid;grid-template-columns:minmax(0,1fr) auto 28px;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--line)}.payments-list__what{display:grid;min-width:0}.payments-list__what b{font-size:12.5px;font-weight:650}.payments-list__what small{color:var(--muted);font-size:11px}.payments-list__amount{font-weight:700;font-size:13px}.payments-list__remove{width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--muted);font-size:18px;line-height:1;cursor:pointer}.payments-list__remove:hover{background:var(--danger-soft);color:var(--danger)}
    .instalments{list-style:none;margin:0 18px 6px;padding:0}.instalments li{display:grid;grid-template-columns:22px minmax(0,1fr) auto;align-items:center;gap:8px;padding:7px 0}.instalments i{display:grid;width:20px;height:20px;place-items:center;border-radius:50%;background:var(--line);color:var(--muted);font-size:11px;font-style:normal;font-weight:800}.instalments__item--paid i{background:var(--ok-soft);color:var(--ok)}.instalments__item--due i{background:var(--warn-soft);color:var(--warn)}.instalments__what{display:grid;min-width:0}.instalments__what b{font-size:12.5px;font-weight:650}.instalments__what small{color:var(--muted);font-size:11px}.instalments__item--due .instalments__what small{color:var(--warn);font-weight:650}.instalments__item--paid .instalments__what b{color:var(--muted);text-decoration:line-through}
    .pay-stream{margin:0 18px 12px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}.pay-stream__head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.pay-stream__head>span{display:grid;min-width:0}.pay-stream__head b{font-size:13px}.pay-stream__head small{color:var(--muted);font-size:11px}.pay-stream__head .num{text-align:right}.pay-stream .payments-meter{margin:8px 0 4px}.pay-stream .instalments{margin:0}.pay-line{display:grid;grid-template-columns:minmax(0,1fr) auto 24px;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--line)}.pay-line__what{display:grid;min-width:0}.pay-line__what b{font-size:12.5px;font-weight:650}.pay-line__what small{color:var(--muted);font-size:11px}.pay-line__amount{font-weight:700;font-size:13px}.pay-line__remove{width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:var(--muted);font-size:16px;line-height:1;cursor:pointer}.pay-line__remove:hover{background:var(--danger-soft);color:var(--danger)}.pay-stream__add{display:block;width:100%;margin-top:6px;padding:7px 0;border:0;background:transparent;color:var(--rose-dark);font:inherit;font-size:12.5px;font-weight:650;text-align:left;cursor:pointer}.pay-ours{margin:0 18px 14px;color:var(--muted);font-size:11.5px}
    .files-list__actions{display:flex;align-items:center;gap:6px}
    .files-list{list-style:none;margin:0 18px 4px;padding:0;border-top:1px solid var(--line)}.files-list li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)}.files-list__name{display:grid;min-width:0}.files-list__name b{font-size:12.5px;font-weight:650}.files-list__name small{color:var(--muted);font-size:11px}.files-card__hint{padding:6px 18px 14px}
    .pay-chips{display:flex;flex-wrap:wrap;gap:6px}.pay-chip{display:grid;min-width:72px;padding:8px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface);font:inherit;font-size:13px;font-weight:700;text-align:left;cursor:pointer}.pay-chip small{color:var(--muted);font-size:11px;font-weight:500}.pay-chip:hover{border-color:var(--rose-line);background:var(--rose-soft)}
    .receive-balance{display:grid;gap:8px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}.receive-balance b{font-size:13px}.receive-balance small{display:block;color:var(--muted);font-size:11.5px}.receive-balance__final{display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer}.receive-balance__final input{width:18px;height:18px;accent-color:var(--rose)}
    .receive-lines{display:grid;gap:8px}.receive-line{display:grid;grid-template-columns:minmax(0,1fr) 110px 110px;gap:8px 10px;align-items:end;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}.receive-line--short{border-color:#eddcb9;background:var(--warn-soft)}.receive-line--damaged{border-color:#f1c8c4}.receive-line__name{display:grid;min-width:0}.receive-line__name b{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.receive-line__name small{color:var(--muted);font-size:11px}.receive-line__field{display:grid;gap:3px}.receive-line__field span{color:var(--muted);font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}.receive-line__note{grid-column:1/-1;color:var(--warn);font-size:11.5px;font-weight:650}
    @media(max-width:559px){.receive-line{grid-template-columns:1fr 1fr}.receive-line__name{grid-column:1/-1}}
    .switch-row{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:4px 0 10px;cursor:pointer;border-bottom:1px solid var(--line);margin-bottom:4px}.switch-row>span{display:flex;flex-direction:column;gap:2px;min-width:0}.switch-row b{font-size:13px}.switch-row small{color:var(--muted);font-size:11.5px;line-height:1.35}.switch-row input{width:20px;height:20px;flex:none;accent-color:var(--rose)}
    .line-remove{display:grid;width:42px;height:42px;place-items:center;border:0;border-radius:50%;background:transparent;color:var(--muted)}.line-remove:active{background:var(--danger-soft);color:var(--danger)}:is(.line-currency,.cost-currency){min-width:74px;border-radius:0}.line-basis{min-width:72px;border-radius:0 var(--r-sm) var(--r-sm) 0;border-left:0}

    :is(.line-breakdown,.allocation-settings){overflow:hidden;border:1px solid var(--line);border-radius:14px;background:var(--surface)}
    :is(.line-breakdown,.allocation-settings) summary{display:flex;min-height:50px;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;list-style:none}
    .line-breakdown summary::-webkit-details-marker{display:none}
    .line-breakdown summary{display:grid;grid-template-columns:minmax(0,1fr) auto}.line-breakdown__label{display:flex;min-width:0;flex:1;flex-direction:column;font-size:12px}.line-breakdown__toggle{flex:none}.line-breakdown__toggle button{min-height:28px;padding:3px 7px;font-size:10px}.line-breakdown__total{color:var(--rose)}
    .line-breakdown__value{display:flex;align-items:center;gap:5px}.line-breakdown__chevron{flex:none;color:var(--muted);transition:transform .18s ease}.line-breakdown[open] .line-breakdown__chevron{transform:rotate(180deg)}
    .line-breakdown__value{grid-column:1/-1;justify-content:flex-end;padding-top:2px}
    .line-breakdown__body{padding:3px 10px 8px;border-top:1px solid var(--line)}.line-divider{border-top:1px solid var(--line)}.line-breakdown__body .stat-row small{display:block;color:var(--muted);font-size:9.5px;font-weight:500}.product-empty{padding-block:34px}

    .cost-fields{padding-bottom:14px}.cost-group{padding:11px 10px 0;border:1px solid var(--line);border-radius:14px;background:var(--surface)}.cost-group+.cost-group{margin-top:10px}
    .cost-group__intro{margin-bottom:10px}.cost-group__intro>div{display:flex;gap:7px}.cost-group__step{color:var(--rose);font-size:11px}.cost-group h3{font-size:13px}.cost-group__intro p{color:var(--muted);font-size:11px}.rate-grid{display:grid}
    .allocation-settings{margin-top:10px}.allocation-settings summary{display:block}.allocation-settings summary span{display:flex;flex-direction:column}.allocation-settings summary small{color:var(--muted);font-size:10px}.allocation-settings__body{padding:10px 10px 0;border-top:1px solid var(--line)}

    .purchase-summary{margin-top:12px}.summary-body{padding:14px}.fill-overview{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:7px;color:var(--muted);font-size:11px}.fill-overview>div{display:flex;align-items:baseline;gap:6px}.fill-overview strong{color:var(--ink);font-size:21px}.fill-meter{height:11px}.capacity-alert{margin-top:10px}
    .cost-summary__group+.cost-summary__group{border-top:1px solid var(--line)}.cost-summary .stat-row{padding:4px 0;font-size:12px}.safe-summary{display:flex;gap:8px;margin-top:14px;padding:10px;border-radius:12px;background:var(--ok-soft);color:var(--ok);font-size:12px}
    .action-card{padding:14px}.action-card__head h2{font-size:16px}.action-card__head p{color:var(--muted);font-size:11.5px}.action-card__buttons{display:grid;gap:7px;margin-top:12px}.danger-zone{margin-top:7px;border-top:1px solid var(--line)}.danger-zone summary{padding:11px;color:var(--muted);font-size:11px;text-align:center}.danger-zone p{color:var(--muted);font-size:10px;text-align:center}
    .loading-card{display:flex;min-height:160px;align-items:center;justify-content:center;color:var(--muted)}.loading-card__mark{display:none}

    @media(min-width:560px){.rate-grid{grid-template-columns:repeat(2,1fr)}.po-facts{grid-template-columns:repeat(3,1fr)}.line-breakdown summary{display:flex}.line-breakdown__value{padding-top:0}}
    @media(min-width: 680px){:is(.section-toggle,.section-heading){padding-inline:18px}:is(.section-body,.summary-body,.action-card){padding:18px}.po-line{padding:16px}.order-fields{grid-template-columns:repeat(6,minmax(0,1fr))}.order-fields>.field{grid-column:span 3}.order-fields>.order-route-field{grid-column:span 2}.order-fields>.span-2{grid-column:1/-1}}
    @media(min-width:680px){.purchase-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(330px,.85fr);gap:16px;align-items:start}.purchase-summary{margin-top:0}}
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
        `${this.costLabels().loadingPort} → ${this.costLabels().destinationPort}`]
      .filter(Boolean).join(' · ');
  }

  costsSummary(): string {
    const data = this.view();
    if (!data) return '';
    if (this.isDdp()) return `1 USD = ${effectiveUsdToEur(data.order)} EUR · DDP, transport en rechten inbegrepen`;
    return `1 USD = ${effectiveUsdToEur(data.order)} EUR · vracht $${data.order.freightUsd}`;
  }

  readonly containerTypes = CONTAINER_TYPES;
  readonly containerLabel = containerLabel;

  /** The one-way street a container travels: the sailing is a step of its
      own again - a payment falls due on it, and the tracking starts there. */
  readonly statusSteps = [
    { value: 'CONCEPT' as const, label: 'Concept', action: 'Bestellen' },
    { value: 'BESTELD' as const, label: 'Besteld', action: 'Container vertrokken' },
    { value: 'ONDERWEG' as const, label: 'Vertrokken', action: 'Container ontvangen' },
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
      this.openReceive();
      return;
    }
    if (step.to === 'ONDERWEG') {
      this.enqueue(
        (order) => ({ ...order, status: 'ONDERWEG' }),
        () => {
          this.ui.toast('Container vertrokken - vul het track & trace-nummer in bij Ordergegevens', 'ok');
          if (!this.sectionOpen('order')) this.toggleSection('order');
        },
      );
      return;
    }
    this.enqueue(
      (order) => ({ ...order, status: step.to as PurchaseOrder['status'] }),
      () => this.orderPlaced.set(true),
    );
  }



  photoOf(productId: number): string | null {
    const product = this.products().find((item) => item.id === productId);
    return product?.photos?.[0]?.url ?? null;
  }

  /* ---- payments --------------------------------------------------- */
  readonly payments = signal<PurchasePayment[] | null>(null);
  readonly paying = signal<{ amount: number; currency: Currency; paidOn: string; label: string; payee: Payee } | null>(null);
  readonly payingBusy = signal(false);

  /** What the supplier is owed: goods, plus the sea freight when it is in the price. */
  readonly supplierOwed = computed(() => this.view()?.payable?.supplierEur ?? this.view()?.costing.totals.goodsEur ?? 0);
  readonly logisticsOwed = computed(() => this.view()?.payable?.logisticsEur ?? 0);
  readonly owedAll = computed(() => this.supplierOwed() + this.logisticsOwed());
  paymentsTo(payee: Payee): PurchasePayment[] {
    return (this.payments() ?? []).filter((payment) => (payment.payee ?? 'SUPPLIER') === payee);
  }
  paidTo(payee: Payee): number {
    return this.paymentsTo(payee).reduce((sum, payment) => sum + payment.amountEur, 0);
  }
  readonly paidAll = computed(() => (this.payments() ?? []).reduce((sum, payment) => sum + payment.amountEur, 0));
  readonly openAll = computed(() => Math.max(0, this.owedAll() - this.paidAll()));
  pct(paid: number, owed: number): number {
    return owed > 0 ? Math.min(100, Math.round((paid / owed) * 100)) : 0;
  }
  /* The supplier stream, as the plan and the balance see it. */
  readonly paidTotalEur = computed(() => this.paidTo('SUPPLIER'));
  readonly remainingEur = computed(() => this.supplierOwed() - this.paidTotalEur());
  /** Fractions of the goods that still fit in what is open: after 2/3 only the rest remains. */
  readonly payChips = computed(() => {
    const goods = this.supplierOwed();
    const rest = Math.max(0, this.remainingEur());
    const chips = [
      { label: '1/3', amount: Math.round((goods / 3) * 100) / 100 },
      { label: '1/2', amount: Math.round((goods / 2) * 100) / 100 },
      { label: '2/3', amount: Math.round((goods * 2 / 3) * 100) / 100 },
    ].filter((chip) => chip.amount > 0 && chip.amount <= rest + 0.005);
    if (rest > 0.005) chips.push({ label: 'Rest', amount: Math.round(rest * 100) / 100 });
    return chips;
  });

  /** What is still open on the stream a payment goes to. */
  openFor(payee: Payee): number {
    const owed = payee === 'SUPPLIER' ? this.supplierOwed() : this.logisticsOwed();
    return Math.round(Math.max(0, owed - this.paidTo(payee)) * 100) / 100;
  }

  /** A payment beyond what is open is a mistake; the sheet says so before the server does. */
  readonly payingOverage = computed(() => {
    const pay = this.paying();
    if (!pay || !(pay.amount > 0)) return 0;
    const owed = pay.payee === 'SUPPLIER' ? this.supplierOwed() : this.logisticsOwed();
    if (!(owed > 0)) return 0;
    return Math.max(0, Math.round((this.eurOf(pay.amount, pay.currency) - this.openFor(pay.payee)) * 100) / 100);
  });

  eurOf(amount: number, currency: Currency): number {
    const order = this.view()?.order;
    if (!order) return amount;
    if (currency === 'USD') return amount * (order.usdToEurGoods ?? 1);
    if (currency === 'CNY') return amount * (order.cnyToUsd ?? 1) * (order.usdToEurGoods ?? 1);
    return amount;
  }

  private async loadPayments(orderId: number): Promise<void> {
    try { this.payments.set(await this.sourcing.payments(orderId)); } catch { this.payments.set([]); }
  }

  openPayment(amount?: number, label?: string, payee: Payee = 'SUPPLIER'): void {
    const rest = payee === 'SUPPLIER' ? Math.max(0, this.remainingEur()) : Math.max(0, this.logisticsOwed() - this.paidTo('LOGISTICS'));
    /* An instalment can ask more than what is still open when earlier
       payments did not line up exactly; never prefill beyond the rest. */
    const capped = rest > 0.005 ? Math.min(amount ?? rest, rest) : (amount ?? rest);
    this.paying.set({
      amount: Math.round(capped * 100) / 100,
      currency: 'EUR',
      paidOn: new Date().toISOString().slice(0, 10),
      label: label ?? (payee === 'SUPPLIER' ? (rest > 0.005 && this.paidTotalEur() > 0 ? 'Saldo' : '') : 'Douane & transport'),
      payee,
    });
  }

  /**
   * The plan's instalments against what was paid: instalments are ticked
   * off in order by the paid total, the first unpaid one whose moment has
   * come is "due", the rest wait.
   */
  readonly plannedInstalments = computed(() => {
    const data = this.view();
    if (!data) return [];
    const terms = PAYMENT_TERMS.find((item) => item.value === (data.order.paymentTerms ?? 'THIRDS'));
    if (!terms || !terms.instalments.length) return [];
    const goods = this.supplierOwed();
    if (!(goods > 0)) return [];
    const reached: Record<'ORDERED' | 'SHIPPED' | 'ARRIVED', boolean> = {
      ORDERED: data.order.status !== 'CONCEPT',
      SHIPPED: data.order.status === 'ONDERWEG' || data.order.status === 'ONTVANGEN',
      ARRIVED: data.order.status === 'ONTVANGEN',
    };
    /* Ticked off against the running total, a few cents of slack: 2/3 noted
       as € 232,39 must still cover two instalments of € 116,20, and "the
       rest" closes the last one even when the thirds did not add up exactly. */
    const paid = this.paidTotalEur();
    let cumulative = 0;
    let earlierOpen = false;
    /* An unpaid step never asks more than what is genuinely open, or the
       note sheet would refuse its own suggestion. */
    let stillOpen = Math.max(0, goods - paid);
    return terms.instalments.map((step) => {
      const amount = Math.round(goods * step.share * 100) / 100;
      cumulative += amount;
      let state: 'paid' | 'due' | 'later';
      if (!earlierOpen && paid >= Math.min(cumulative, goods) - 0.05) {
        state = 'paid';
        return { label: step.label, amount, state };
      }
      state = reached[step.due] ? 'due' : 'later'; earlierOpen = true;
      const ask = Math.round(Math.min(amount, stillOpen) * 100) / 100;
      stillOpen = Math.max(0, stillOpen - ask);
      return { label: step.label, amount: ask, state };
    });
  });

  async confirmPayment(): Promise<void> {
    const data = this.view();
    const pay = this.paying();
    if (!data || !pay || this.payingBusy()) return;
    this.payingBusy.set(true);
    try {
      await this.sourcing.addPayment(data.order.id, {
        paidOn: pay.paidOn, amount: pay.amount, currency: pay.currency, label: pay.label || null, payee: pay.payee });
      await this.loadPayments(data.order.id);
      await this.reloadOrderQuietly();
      this.paying.set(null);
      this.ui.toast('Betaling bewaard', 'ok');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Betaling bewaren mislukt'), 'err');
    } finally {
      this.payingBusy.set(false);
    }
  }

  removePayment(payment: PurchasePayment): void {
    this.ui.confirm(
      { title: 'Betaling verwijderen', message: `Betaling van <b>${payment.amountEur.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR' })}</b> verwijderen?`,
        confirmLabel: 'Verwijderen', danger: true },
      async () => {
        try {
          await this.sourcing.deletePayment(payment.orderId, payment.id);
          await this.loadPayments(payment.orderId);
        } catch (failure: unknown) {
          this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
        }
      });
  }

  /* ---- documents ---------------------------------------------------- */
  readonly documents = signal<PurchaseDocument[] | null>(null);
  readonly addingDocument = signal<{ kind: DocumentKind; label: string; paymentId: number | null; file: File | null } | null>(null);
  readonly uploadingDocument = signal(false);
  readonly documentKinds: { value: DocumentKind; label: string }[] = [
    { value: 'PAYMENT_PROOF', label: 'Betalingsbewijs' }, { value: 'COMMERCIAL_INVOICE', label: 'Commercial invoice' },
    { value: 'PACKING_LIST', label: 'Packing list' }, { value: 'BILL_OF_LADING', label: 'Bill of lading' },
    { value: 'CUSTOMS', label: 'Douanedocument' }, { value: 'OTHER', label: 'Andere' },
  ];

  private async loadDocuments(orderId: number): Promise<void> {
    try { this.documents.set(await this.sourcing.documents(orderId)); } catch { this.documents.set([]); }
  }

  proofsOf(paymentId: number): PurchaseDocument[] {
    return (this.documents() ?? []).filter((doc) => doc.paymentId === paymentId);
  }

  sizeLabel(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' kB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  openDocument(): void {
    this.addingDocument.set({ kind: 'PAYMENT_PROOF', label: '', paymentId: null, file: null });
  }

  async confirmDocument(): Promise<void> {
    const data = this.view();
    const doc = this.addingDocument();
    if (!data || !doc || !doc.file || this.uploadingDocument()) return;
    this.uploadingDocument.set(true);
    try {
      await this.sourcing.addDocument(data.order.id, doc.file, doc.kind, doc.label || null, doc.paymentId);
      await this.loadDocuments(data.order.id);
      this.addingDocument.set(null);
      this.ui.toast('Document bewaard', 'ok');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Document bewaren mislukt'), 'err');
    } finally {
      this.uploadingDocument.set(false);
    }
  }

  async downloadDocument(doc: PurchaseDocument): Promise<void> {
    try {
      saveBlob(await this.sourcing.documentFile(doc.orderId, doc.id), doc.originalFilename);
    } catch {
      this.ui.toast('Document openen mislukt', 'err');
    }
  }

  removeDocument(doc: PurchaseDocument): void {
    this.ui.confirm(
      { title: 'Document verwijderen', message: `<b>${doc.originalFilename}</b> verwijderen?`, confirmLabel: 'Verwijderen', danger: true },
      async () => {
        try {
          await this.sourcing.deleteDocument(doc.orderId, doc.id);
          await this.loadDocuments(doc.orderId);
        } catch (failure: unknown) {
          this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
        }
      });
  }

  fileList(files: FileList | null): File[] {
    return files ? Array.from(files).slice(0, 2) : [];
  }

  /* ---- just ordered: the first instalment ---------------------------- */
  readonly firstInstalmentPrompt = signal<{ label: string; amount: number; currency: Currency; paidOn: string; files: File[] } | null>(null);

  private promptFirstInstalment(): void {
    const first = this.plannedInstalments().find((step) => step.state === 'due');
    if (!first) return;
    this.firstInstalmentPrompt.set({ label: first.label, amount: first.amount, currency: 'EUR',
      paidOn: new Date().toISOString().slice(0, 10), files: [] });
  }

  async confirmFirstInstalment(): Promise<void> {
    const data = this.view();
    const first = this.firstInstalmentPrompt();
    if (!data || !first || this.payingBusy()) return;
    this.payingBusy.set(true);
    try {
      const payment = await this.sourcing.addPayment(data.order.id, {
        paidOn: first.paidOn, amount: first.amount, currency: first.currency, label: first.label, payee: 'SUPPLIER' });
      for (const file of first.files.slice(0, 2)) {
        await this.sourcing.addDocument(data.order.id, file, 'PAYMENT_PROOF', first.label, payment.id);
      }
      await Promise.all([this.loadPayments(data.order.id), this.loadDocuments(data.order.id)]);
      await this.reloadOrderQuietly();
      this.firstInstalmentPrompt.set(null);
      this.ui.toast(first.files.length ? 'Betaling en bewijs bewaard' : 'Betaling bewaard', 'ok');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Betaling bewaren mislukt'), 'err');
    } finally {
      this.payingBusy.set(false);
    }
  }

  /** The server wrote a line in the notes; pick it up without disturbing the draft. */
  private async reloadOrderQuietly(): Promise<void> {
    const data = this.view();
    if (!data || this.dirty()) return;
    try {
      const fresh = await this.sourcing.purchaseOrder(data.order.id);
      ++this.previewVersion;
      this.view.set(fresh);
      this.savedOrder.set(JSON.stringify(fresh.order));
    } catch { /* the note shows after the next load */ }
  }

  /* ---- receiving the container ------------------------------------- */
  readonly receiving = signal<ReceiveDraft | null>(null);
  readonly booking = signal(false);

  /** Opens the count sheet; the draft is saved first so the counts land on what is on screen. */
  async openReceive(): Promise<void> {
    const data = this.view();
    if (!data) return;
    if (this.dirty()) {
      const saved = await this.save();
      if (!saved) return;
    }
    const current = this.view()!;
    this.receiving.set({
      lines: current.order.lines.map((line) => {
        const product = this.products().find((p) => p.id === line.productId);
        return {
          productId: line.productId,
          name: product?.name ?? `Product ${line.productId}`,
          sku: product?.sku ?? '',
          ordered: line.orderedQuantity ?? line.quantity,
          received: line.quantity,
          damaged: 0,
        };
      }),
      bookStock: true,
      finalPayment: false,
      note: '',
    });
  }

  setReceived(productId: number, received: number): void {
    this.receiving.update((draft) => draft && {
      ...draft,
      lines: draft.lines.map((line) => line.productId === productId
        ? { ...line, received: Math.max(0, received || 0), damaged: Math.min(line.damaged, Math.max(0, received || 0)) }
        : line),
    });
  }

  setDamaged(productId: number, damaged: number): void {
    this.receiving.update((draft) => draft && {
      ...draft,
      lines: draft.lines.map((line) => line.productId === productId
        ? { ...line, damaged: Math.min(Math.max(0, damaged || 0), line.received) }
        : line),
    });
  }

  async confirmReceive(): Promise<void> {
    const data = this.view();
    const draft = this.receiving();
    if (!data || !draft || this.booking()) return;
    this.booking.set(true);
    try {
      const lines: ReceivedLine[] = draft.lines.map((line) => ({
        productId: line.productId, received: line.received, damaged: line.damaged }));
      if (draft.finalPayment && this.remainingEur() > 0.005) {
        await this.sourcing.addPayment(data.order.id, {
          paidOn: new Date().toISOString().slice(0, 10), amount: Math.round(this.remainingEur() * 100) / 100,
          currency: 'EUR', label: 'Slotbetaling', payee: 'SUPPLIER' });
        await this.loadPayments(data.order.id);
      }
      const result = await this.sourcing.receivePurchaseOrder(data.order.id, {
        lines, bookStock: draft.bookStock, paidTotalEur: this.paidTotalEur() || null,
        receivedOn: null, note: draft.note || null,
      });
      ++this.previewVersion;
      this.view.set(result);
      this.savedOrder.set(JSON.stringify(result.order));
      this.receiving.set(null);
      this.ui.toast(draft.bookStock ? 'Container ontvangen en voorraad bijgeboekt' : 'Container ontvangen - nog niet bijgeboekt', 'ok');
      this.products.set(await this.catalog.products(result.order.supplierId));
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Ontvangen mislukt'), 'err');
    } finally {
      this.booking.set(false);
    }
  }

  async bookStock(): Promise<void> {
    const data = this.view();
    if (!data || this.booking()) return;
    this.booking.set(true);
    try {
      const result = await this.sourcing.bookPurchaseStock(data.order.id);
      ++this.previewVersion;
      this.view.set(result);
      this.savedOrder.set(JSON.stringify(result.order));
      this.ui.toast('Voorraad bijgeboekt', 'ok');
      this.products.set(await this.catalog.products(result.order.supplierId));
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Bijboeken mislukt'), 'err');
    } finally {
      this.booking.set(false);
    }
  }

  readonly paymentTermOptions = PAYMENT_TERMS;
  readonly departurePorts = CHINESE_DEPARTURE_PORTS;
  readonly destinationPorts = DESTINATION_PORTS;
  readonly otherPortValue = OTHER_PORT_VALUE;
  readonly customDeparturePort = signal(false);
  readonly customDestinationPort = signal(false);

  portSelection(
    rawValue: string | null | undefined,
    options: readonly PortOption[],
    forceCustom: boolean,
    fallback = 'Ningbo',
  ): string {
    if (forceCustom) return OTHER_PORT_VALUE;
    const value = rawValue?.trim() || fallback;
    return this.isKnownPort(value, options) ? value : OTHER_PORT_VALUE;
  }

  customPortInput(
    rawValue: string | null | undefined,
    options: readonly PortOption[],
    forceCustom: boolean,
  ): string {
    const value = rawValue?.trim() ?? '';
    return forceCustom && this.isKnownPort(value, options) ? '' : value;
  }

  usesCustomDeparturePort(value: string | null | undefined): boolean {
    return this.customDeparturePort()
      || !this.isKnownPort(value?.trim() || 'Ningbo', this.departurePorts);
  }

  usesCustomDestinationPort(value: string | null | undefined): boolean {
    return this.customDestinationPort()
      || !this.isKnownPort(value?.trim() || 'Rotterdam', this.destinationPorts);
  }

  selectDeparturePort(value: string): void {
    if (value === OTHER_PORT_VALUE) {
      this.customDeparturePort.set(true);
      return;
    }
    this.customDeparturePort.set(false);
    this.patch({ departurePort: value });
  }

  selectDestinationPort(value: string): void {
    if (value === OTHER_PORT_VALUE) {
      this.customDestinationPort.set(true);
      return;
    }
    this.customDestinationPort.set(false);
    this.patch({ destinationPort: value });
  }

  setCustomDeparturePort(value: string): void {
    const port = this.normalizedKnownPort(value, this.departurePorts);
    if (!port || this.isKnownPort(port, this.departurePorts)) {
      this.customDeparturePort.set(false);
    }
    this.patch({ departurePort: port || 'Ningbo' });
  }

  setCustomDestinationPort(value: string): void {
    const port = this.normalizedKnownPort(value, this.destinationPorts);
    if (!port || this.isKnownPort(port, this.destinationPorts)) {
      this.customDestinationPort.set(false);
    }
    this.patch({ destinationPort: port || 'Rotterdam' });
  }

  private isKnownPort(value: string, options: readonly PortOption[]): boolean {
    return options.some((option) => option.value === value);
  }

  private normalizedKnownPort(value: string, options: readonly PortOption[]): string {
    const trimmed = value.trim();
    return options.find((option) => option.value.toLocaleLowerCase() === trimmed.toLocaleLowerCase())
      ?.value ?? trimmed;
  }

  /**
   * Where the origin costs are incurred, named after the supplier's country.
   * "Local costs China" was hardcoded once, but not every supplier is Chinese.
   */
  readonly costLabels = computed(() => purchaseCostLabels(this.view(), this.supplier()));

  private readonly sourcing = inject(SourcingApi);
  private readonly catalog = inject(CatalogApi);

  /** Active stock locations; the container is unloaded at one of them. */
  readonly stockLocations = signal<StockLocation[]>([]);
  readonly mainLocationId = computed(() =>
    this.stockLocations().find((location) => location.code === 'MAIN')?.id ?? this.stockLocations()[0]?.id ?? null);
  receivingLocationName(id: number | null | undefined): string {
    const locations = this.stockLocations();
    return locations.find((location) => location.id === (id ?? this.mainLocationId()))?.name ?? 'Magazijn';
  }
  private readonly router = inject(Router);
  private readonly ui = inject(Ui);

  readonly id = input<string>('');

  readonly allocationKeys = computed(() => {
    const labels = this.costLabels();
    const extra = { field: 'allocExtra' as const, label: 'Enrosed kost',
      route: 'Commerciële opslag per verdeelsleutel' };
    if (this.isDdp()) return [extra];
    return [
      { field: 'allocFreight' as const, label: labels.seaFreightLabel,
        route: labels.seaFreightRoute },
      { field: 'allocOrigin' as const, label: labels.originCostsLabel,
        route: labels.originRoute },
      { field: 'allocDestination' as const, label: labels.destinationCostsLabel,
        route: '' },
      extra,
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
    void this.loadPayments(orderId);
    void this.loadDocuments(orderId);
    this.savedOrder.set(JSON.stringify(view.order));
    const [products, suppliers, locations] = await Promise.all([
      this.catalog.products(view.order.supplierId), this.sourcing.suppliers(),
      this.catalog.stockLocations().catch(() => [] as StockLocation[])]);
    this.products.set(products);
    this.stockLocations.set(locations.filter((location) => location.active));
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

  /* ---- draft, preview, save ---------------------------------------- */

  /* The order on screen is a draft: every edit lands here at once and the
     figures are recalculated by the server without saving. Only Opslaan
     (or a status step, which is an action) writes the order. */
  private readonly savedOrder = signal<string>('');
  readonly saving = signal(false);
  readonly dirty = computed(() => {
    const data = this.view();
    return !!data && JSON.stringify(data.order) !== this.savedOrder();
  });
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private previewVersion = 0;

  /** Applies a change to the draft and refreshes the calculation. */
  private enqueue(
    make: (order: PurchaseOrder) => PurchaseOrder,
    afterSave?: (saved: PurchaseOrderView) => void,
  ): void {
    const data = this.view();
    if (!data) return;
    const order = make(data.order);
    this.view.set({ ...data, order });
    if (afterSave) {
      /* A status step is an action, not a keystroke: it saves at once, draft included. */
      void this.save().then((saved) => { if (saved) afterSave(saved); });
      return;
    }
    this.schedulePreview();
  }

  /** Recalculates shortly after the last keystroke - the server owns the maths. */
  private schedulePreview(): void {
    if (this.previewTimer !== null) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => { this.previewTimer = null; void this.preview(); }, 250);
  }

  private async preview(): Promise<void> {
    const data = this.view();
    if (!data) return;
    const version = ++this.previewVersion;
    try {
      const fresh = await this.sourcing.previewPurchaseOrder(data.order.id, data.order);
      const current = this.view();
      /* Only the newest preview may land, and only onto the draft it was made for. */
      if (version !== this.previewVersion || !current) return;
      this.view.set({ ...fresh, order: current.order });
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Berekening vernieuwen mislukt'), 'err');
    }
  }

  /** Writes the draft; the server answers with the order as it stands. */
  async save(): Promise<PurchaseOrderView | null> {
    const data = this.view();
    if (!data || this.saving()) return null;
    if (this.previewTimer !== null) { clearTimeout(this.previewTimer); this.previewTimer = null; }
    this.saving.set(true);
    try {
      const result = await this.sourcing.updatePurchaseOrder(data.order.id, data.order);
      ++this.previewVersion;
      this.view.set(result);
      this.savedOrder.set(JSON.stringify(result.order));
      this.adjustments.set(result.adjustments ?? []);
      if (result.adjustments?.length) {
        /* Warning only: purchasing never rounds. A supplier can ship a sample of
           three pieces, and silently inflating an order costs real money. */
        const first = result.adjustments[0];
        this.ui.toast(
          `Let op: ${first.requested} stuks is geen volle doos (${first.piecesPerCarton}/doos)`,
          'err');
      } else {
        this.ui.toast('Opgeslagen');
      }
      /* Stock levels may have just been booked. The order is already saved here,
         so a failed refresh is reported separately. */
      try {
        this.products.set(await this.catalog.products(result.order.supplierId));
      } catch (failure: unknown) {
        this.ui.toast(
          messageOf(failure, 'Order opgeslagen, maar productgegevens vernieuwen mislukt'), 'err');
      }
      return result;
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Opslaan mislukt'), 'err');
      return null;
    } finally {
      this.saving.set(false);
    }
  }

  /** Leaving with unsaved work asks first; saving in progress holds the door. */
  canDeactivate(): boolean | Promise<boolean> {
    if (this.saving()) return false;
    if (!this.dirty()) return true;
    return new Promise<boolean>((resolve) => {
      this.ui.confirm(
        {
          title: 'Niet-opgeslagen wijzigingen',
          message: 'Deze inkooporder heeft wijzigingen die nog niet zijn opgeslagen. Opslaan voor je verdergaat?',
          confirmLabel: 'Opslaan',
          secondaryLabel: 'Niet opslaan',
        },
        async () => { await this.save(); resolve(!this.dirty()); },
        () => resolve(true),
      );
    });
  }

  @HostListener('window:beforeunload', ['$event'])
  warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty()) event.preventDefault();
  }

  piecesPerCarton(productId: number): number {
    return this.products().find((product) => product.id === productId)?.carton.piecesPerCarton ?? 1;
  }

  stockOf(productId: number): number {
    return this.products().find((product) => product.id === productId)?.stockQuantity ?? 0;
  }

  /** Transport, duty, handling and Enrosed kost as a share of the goods. */
  overheadPct(totals: { totalEur: number; goodsEur: number }): number {
    return totals.goodsEur > 0 ? Math.round(((totals.totalEur - totals.goodsEur) / totals.goodsEur) * 100) : 0;
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
    this.promptFirstInstalment();
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

  /* ---- damage or shortfall on a received order, via one small button ---- */
  readonly noteEditing = signal(false);
  readonly issue = signal<{ productId: number; kind: 'DAMAGED' | 'SHORT'; quantity: number } | null>(null);

  readonly issueLine = computed(() => {
    const report = this.issue();
    if (!report) return null;
    return this.view()?.costing.lines.find((line) => line.productId === report.productId) ?? null;
  });

  openIssue(productId: number): void {
    this.issue.set({ productId, kind: 'DAMAGED', quantity: 0 });
  }

  /** Writes the report into the lines and saves: the backend books the stock difference. */
  async confirmIssue(): Promise<void> {
    const report = this.issue();
    const line = this.orderLine(report?.productId ?? -1);
    if (!report || !line || !(report.quantity > 0)) return;
    if (report.kind === 'DAMAGED') {
      const damaged = (line.damagedQuantity ?? 0) + report.quantity;
      if (damaged > line.quantity) { this.ui.toast('Meer beschadigd dan ontvangen kan niet', 'err'); return; }
      this.setLine(report.productId, { damagedQuantity: damaged });
    } else {
      const quantity = line.quantity - report.quantity;
      if (quantity < 0) { this.ui.toast('Zoveel stuks staan er niet op de regel', 'err'); return; }
      if (quantity < (line.damagedQuantity ?? 0)) { this.ui.toast('Minder dan het aantal beschadigde stuks kan niet', 'err'); return; }
      this.setLine(report.productId, { quantity });
    }
    await this.save();
    this.issue.set(null);
  }

  /**
   * DDP is how a supplier quotes a whole container, not one line: choosing
   * it on any line sets every line, and the transport section steps aside.
   */
  setPriceBasis(productId: number, basis: 'EXW' | 'DDP'): void {
    this.enqueue((order) => ({
      ...order,
      lines: order.lines.map((line) => ({ ...line, priceBasis: basis })),
    }));
  }

  readonly isDdp = computed(() => {
    const lines = this.view()?.order.lines ?? [];
    return lines.length > 0 && lines.every((line) => (line.priceBasis ?? 'EXW') === 'DDP');
  });

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

  /**
   * Creates a product from the measurements typed in the picker and puts
   * it on the order in one go - measure the article in your hand, done.
   * Photos, barcodes and translations can follow later on the product.
   */
  async quickCreate(draft: ProductDraft): Promise<void> {
    const data = this.view();
    if (!data) return;
    const created = await this.catalog.createProduct({
      id: null, familyId: null, canonicalVariantKey: null, canonicalBarcode: null,
      variantPosition: 0,
      inventoryKnown: true, sku: null, name: draft.name,
      dimensions: { lengthCm: draft.lengthCm, widthCm: draft.widthCm,
          heightCm: draft.heightCm },
      packaging: { kind: 'NONE', dimensions: { lengthCm: null, widthCm: null, heightCm: null }, barcode: null },
      colour: null, colourHex: null, variantSize: null,
      description: '', categoryId: null,
      supplierId: data.order.supplierId, active: true,
      barcodeInner: '', barcodeOuter: '', hsCode: '',
      carton: { lengthCm: draft.cartonLengthCm, widthCm: draft.cartonWidthCm,
          heightCm: draft.cartonHeightCm,
          piecesPerCarton: draft.piecesPerCarton, weightKg: draft.weightKg },
      exwPrice: draft.exwPrice, exwCurrency: draft.exwCurrency as Currency, extraUnitCost: 0,
      landedCostEur: null, landedCostSource: null,
      markupPct: 45, fixedSalesPriceEur: null,
      computedSalesPriceEur: 0,
      stockQuantity: 0, photos: [],
      familyKey: null, publicHandle: null,
      websiteStatus: 'DRAFT', orderAppStatus: 'DRAFT',
      texts: [], publicationIssues: [],
    });
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
        orderedQuantity: null,
        /* A DDP container stays DDP: a new line follows the others. */
        priceBasis: basisOf(order) }],
    }));
  }

  /** Several products at once, each with its own quantity. */
  addLines(choices: { product: Product; quantity: number }[]): void {
    this.picking.set(false);
    if (this.isReceived() || !choices.length) return;
    this.enqueue((order) => ({
      ...order,
      lines: [...order.lines, ...choices.map((choice) => ({
        id: null, productId: choice.product.id!, quantity: choice.quantity,
        exwPrice: null, exwCurrency: null, extraUnitCost: null,
        orderedQuantity: null, priceBasis: basisOf(order) }))],
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
    try {
      const blob = await this.sourcing.purchasePdf(data.order.id, true);
      saveBlob(blob, `${data.order.number}.pdf`);
      this.ui.toast('PDF gedownload — Enrosed kost als aparte regel');
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

  /** Did an earlier apply of this order land on its products? */
  readonly costsApplied = computed(() => {
    const data = this.view();
    if (!data) return false;
    const byId = new Map(this.products().map((product) => [product.id, product]));
    return data.costing.lines.some((line) => byId.get(line.productId)?.landedCostSource === data.order.number);
  });

  apply(): void {
    const data = this.view();
    if (!data) return;
    const again = this.costsApplied();
    this.ui.confirm(
      {
        title: again ? 'Opnieuw kostprijzen toepassen' : 'Kostprijzen toepassen',
        message: 'De berekende kostprijs per stuk wordt op de producten in de catalogus '
          + 'gezet en overschrijft wat daar staat. Alle marges op verkooporders rekenen '
          + 'vanaf dan met deze cijfers.',
        confirmLabel: again ? 'Opnieuw toepassen' : 'Toepassen',
      },
      async () => {
        await this.sourcing.applyLandedCosts(data.order.id);
        this.products.set(await this.catalog.products(data.order.supplierId));
        await this.reloadOrderQuietly();
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
