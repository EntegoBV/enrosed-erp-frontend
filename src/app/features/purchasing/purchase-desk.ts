import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PageHeader } from '../../shared/page-header';
import { Diary } from './diary';
import { ProductPicker } from '../../shared/product-picker';
import { DateField } from '../../shared/date-field';
import { Sheet } from '../../shared/ui';
import { CbmPipe, CurPipe, DateNlPipe, EurPipe, NumPipe, PctPipe } from '../../shared/pipes';
import { SupplierAddress } from '../../shared/supplier-address';
import { AuthImage } from '../../core/api/auth-image';
import { PurchaseOrderedSuccess } from './purchase-ordered-success';
import { PurchaseStatusSuccess } from './purchase-status-success';
import { PurchasePdfSheet } from './purchase-pdf-sheet';
import { PurchaseActivity } from '../activity/purchase-activity';
import { PurchaseEditor } from './purchase-editor';

type RailTab = 'order' | 'costs' | 'pay' | 'files' | 'done';

/**
 * The container on a desk: one screen, no scrolling to find things.
 *
 * A phone walks a buyer through steps; a desk shows the whole container at
 * once. The command bar keeps status, next step and the live figures in
 * view, the products are a real table you can key through, and everything
 * else - order facts, cost mechanics, payments, the dossier, closing the
 * container - lives in one tabbed rail beside it. The logic is the phone
 * editor's, untouched: only the room it gets is different.
 */
@Component({
  selector: 'app-purchase-desk',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, PageHeader, Diary, ProductPicker, DateField, Sheet, AuthImage,
            SupplierAddress, PurchaseOrderedSuccess, PurchaseStatusSuccess,
            PurchasePdfSheet, PurchaseActivity, EurPipe, CurPipe, NumPipe, PctPipe, CbmPipe, DateNlPipe],
  template: `
    @if (view(); as data) {
      <app-page-header [title]="data.order.number"
                       [subtitle]="data.order.alias ? data.order.alias + ' · ' + supplierName() : supplierName()"
                       [showBack]="true" [showBell]="false"
                       [titleEditable]="true"
                       (titleChange)="patch({ number: $event })">
        <button class="btn btn--sm" type="button" (click)="pdfOpen.set(true)"
                [attr.aria-label]="'Download ' + data.order.number + ' als PDF'">PDF</button>
        @if (dirty()) {
          <button class="btn btn--primary btn--sm" type="button" [disabled]="saving()" (click)="save()">
            {{ saving() ? 'Bezig…' : 'Opslaan' }}
          </button>
        } @else if (nextStep(); as step) {
          <button class="btn btn--primary btn--sm" type="button" (click)="advanceStatus()">{{ step.action }}</button>
        } @else {
          <button class="btn btn--primary btn--sm" type="button" disabled>Opgeslagen</button>
        }
      </app-page-header>

      <div class="content desk">
        <!-- ============================ hero: who, how far, and the figures that matter -->
        <header class="desk-hero">
          <div class="desk-hero__top">
            <div class="desk-hero__who">
              <span class="desk-hero__eyebrow">Inkoopcontainer</span>
              <h1>{{ supplierName() }}</h1>
              <p>{{ containerLabel(data.order.containerType) }} · {{ costLabels().loadingPort }} → {{ data.order.destinationPort || 'Rotterdam' }}
                · lossen op {{ receivingLocationName(data.order.receivingLocationId) }}</p>
              <p class="desk-hero__meta">{{ data.order.orderDate | dateNl }} · {{ creatorName(data) }}@if (data.order.expectedArrival) { · verwacht {{ data.order.expectedArrival | dateNl }} }@if (data.order.trackingReference) { · {{ data.order.trackingReference }} }</p>
            </div>
            <div class="desk-status" role="group" aria-label="Voortgang van de inkooporder">
              @for (step of statusSteps; track step.value; let last = $last) {
                <span class="desk-status__step"
                      [class.desk-status__step--done]="stepIndex(data.order.status) > $index"
                      [class.desk-status__step--now]="stepIndex(data.order.status) === $index"
                      [class.desk-status__step--arrived]="step.value === 'ONTVANGEN' && isReceived()">
                  <i aria-hidden="true">@if (stepIndex(data.order.status) > $index) { ✓ } @else { {{ $index + 1 }} }</i>{{ step.label }}
                </span>
                @if (!last) { <span class="desk-status__line" [class.desk-status__line--done]="stepIndex(data.order.status) > $index" aria-hidden="true"></span> }
              }
            </div>
          </div>

          <div class="desk-kpis" aria-label="Kerncijfers">
            <div class="desk-kpi">
              <small>Lading</small>
              @if (!isDdp() && data.costing.containerFill; as fill) {
                <strong [class.is-ok]="fill.overflowCbm <= 0 && fill.fillPercent >= 97"
                        [class.is-warn]="fill.fillPercent > 100 && fill.fillPercent <= 105"
                        [class.is-bad]="fill.fillPercent > 105">{{ fill.fillPercent | num: 0 }}%</strong>
                <i class="desk-kpi__meter" aria-hidden="true"><i [class.is-warn]="fill.fillPercent > 100 && fill.fillPercent <= 105"
                   [class.is-bad]="fill.fillPercent > 105" [style.width.%]="fill.fillPercent > 100 ? 100 : fill.fillPercent"></i></i>
                <span>{{ fill.usedCbm | cbm }} van {{ fill.capacityCbm }} m³</span>
              } @else {
                <strong>{{ data.costing.totals.cbm | cbm }}</strong>
                <span>{{ isDdp() ? 'geleverd DDP' : 'volume' }}</span>
              }
            </div>
            <div class="desk-kpi">
              <small>Stuks</small>
              <strong>{{ data.costing.totals.pieces | num }}</strong>
              <span>{{ data.costing.totals.cartons | num }} dozen · {{ data.costing.lines.length }} regels</span>
            </div>
            <div class="desk-kpi">
              <small>Goederen</small>
              <strong>{{ data.costing.totals.goodsEur | eur: 0 }}</strong>
              <span>{{ data.costing.totals.goodsUsd | cur: 'USD' }}</span>
            </div>
            <div class="desk-kpi desk-kpi--total">
              <small>Totaal geland</small>
              <strong>{{ data.costing.totals.totalEur | eur: 0 }}</strong>
              <span>{{ data.costing.totals.averageUnitEur | eur: 4 }} per stuk</span>
            </div>
            <button class="desk-kpi desk-kpi--button" type="button" (click)="railTab.set('pay')" [class.is-warn]="openAll() > 0">
              <small>Te betalen</small>
              <strong>{{ openAll() | eur: 0 }}</strong>
              <span>{{ paidAll() | eur: 0 }} betaald</span>
            </button>
            @if (nextStep(); as step) {
              <button class="desk-kpi desk-kpi--go" type="button" (click)="advanceStatus()">
                <small>Volgende stap</small>
                <strong>{{ step.action }} ›</strong>
                <span>{{ dirty() ? 'slaat eerst op' : 'klaar wanneer jij het bent' }}</span>
              </button>
            } @else if (isReceived() && !(data.order.stockBooked ?? true)) {
              <button class="desk-kpi desk-kpi--go" type="button" [disabled]="booking()" (click)="bookStock()">
                <small>Volgende stap</small>
                <strong>{{ booking() ? 'Bezig…' : 'Voorraad bijboeken ›' }}</strong>
                <span>de stuks staan nog niet in de voorraad</span>
              </button>
            } @else {
              <div class="desk-kpi desk-kpi--total">
                <small>Status</small>
                <strong>Afgerond ✓</strong>
                <span>ontvangen en bijgeboekt</span>
              </div>
            }
          </div>
        </header>

        @if (data.attention?.length) {
          <div class="desk-attention" role="status">
            <b>{{ data.attention!.length }}</b>
            <span>@for (item of data.attention; track item; let last = $last) {{{ item }}@if (!last) { · }}</span>
            <button class="linklike" type="button" (click)="railTab.set('done')">Bekijken ›</button>
          </div>
        }

        <div class="desk-body">
          <!-- ============================ the table: every line, keyed through -->
          <main class="desk-main">
            <div class="desk-table-bar">
              <div>
                <h2>Producten</h2>
                <p>{{ data.costing.lines.length }} regels · {{ data.costing.totals.pieces | num }} stuks · {{ data.costing.totals.cartons | num }} dozen</p>
              </div>
              <span class="per-toggle" role="group" aria-label="Bedragen tonen als">
                <button type="button" [class.on]="perPiece()" [attr.aria-pressed]="perPiece()" (click)="perPiece.set(true)">Per stuk</button>
                <button type="button" [class.on]="!perPiece()" [attr.aria-pressed]="!perPiece()" (click)="perPiece.set(false)">Totaal</button>
              </span>
              <button class="btn btn--primary btn--sm" type="button" [disabled]="isReceived()" (click)="openPicker()">
                <span aria-hidden="true">＋</span> Product
              </button>
            </div>

            @if (data.costing.lines.length) {
              <div class="desk-table-wrap">
              <table class="desk-table">
                <thead>
                  <tr>
                    <th class="c-product">Product</th>
                    <th class="c-qty">Aantal</th>
                    <th class="c-cartons">Dozen</th>
                    <th class="c-price">Prijs / stuk</th>
                    <th class="c-money">Goederen</th>
                    <th class="c-money">{{ perPiece() ? 'Geland / stuk' : 'Totaal geland' }}</th>
                    <th class="c-act"><span class="sr-only">Acties</span></th>
                  </tr>
                </thead>
                @for (section of lineSections(); track section.key) {
                  <tbody class="desk-section">
                    <tr class="desk-section__row"><th colspan="7">{{ section.label }} <small>{{ section.lines.length }} product{{ section.lines.length === 1 ? '' : 'en' }}</small></th></tr>
                    @for (familyGroup of section.families; track familyGroup.key) {
                      @if (familyGroup.familyId !== null || familyGroup.lines.length > 1) {
                        <tr class="desk-family" [class.desk-family--folded]="familyFolded(familyGroup.key)">
                          <td colspan="7">
                            <button type="button" class="desk-family__toggle" (click)="toggleFamily(familyGroup.key)"
                                    [attr.aria-expanded]="!familyFolded(familyGroup.key)">
                              <i class="desk-family__chev" aria-hidden="true">›</i>
                              <strong>{{ familyGroup.label }}</strong>
                              @if (familyGroup.swatches.length) {
                                <span class="desk-family__swatches" [attr.aria-label]="'Kleuren in ' + familyGroup.label">
                                  @for (swatch of familyGroup.swatches; track swatch.key) {
                                    <i class="line-colour-dot" [class.line-colour-dot--empty]="!colourHex(swatch.hex, swatch.label)"
                                       [style.background]="colourHex(swatch.hex, swatch.label) || 'transparent'" [title]="swatch.label"></i>
                                  }
                                </span>
                              }
                              <small>{{ familyGroup.lines.length }} {{ familyGroup.lines.length === 1 ? 'variant' : 'varianten' }} ·
                                {{ familyGroup.pieces | num }} st · {{ familyGroup.cartons | num }} dozen · {{ familyGroup.cbm | cbm }}</small>
                              <b>{{ perPiece() ? (familyGroup.averageUnitEur | eur: 4) : (familyGroup.totalEur | eur) }}</b>
                            </button>
                          </td>
                        </tr>
                      }
                      @if (!familyFolded(familyGroup.key)) {
                        @for (line of familyGroup.lines; track line.productId) {
                          <tr class="desk-row" [class.desk-row--variant]="familyGroup.familyId !== null">
                            <td class="c-product">
                              <a class="desk-product" [routerLink]="['/products', line.productId]" [title]="line.productName + ' openen'">
                                @if (photoOf(line.productId); as photo) {
                                  <img class="desk-product__photo" [appAuthSrc]="photo" alt="" draggable="false" />
                                } @else {
                                  <span class="desk-product__photo desk-product__photo--empty" aria-hidden="true">{{ purchaseLineNumber(line.productId) }}</span>
                                }
                                <span class="desk-product__copy">
                                  <strong>{{ line.productName }}</strong>
                                  @if (productVariantLabel(line.productId); as variant) {
                                    <small>
                                      @if (productColour(line.productId)) {
                                        <i class="line-colour-dot" [class.line-colour-dot--empty]="!productColourHex(line.productId)"
                                           [style.background]="productColourHex(line.productId) || 'transparent'" aria-hidden="true"></i>
                                      }{{ variant }}
                                    </small>
                                  }
                                </span>
                              </a>
                              @if (!isReceived() && cartonNotice(line.quantity, line.productId); as note) {
                                <span class="desk-note" role="status">{{ note }}</span>
                              }
                              @if (shortShipped(line.productId); as ordered) {
                                <span class="desk-note desk-note--warn">Besteld {{ ordered | num }} → ontvangen {{ line.quantity | num }}</span>
                              }
                              @if (isReceived()) {
                                <button class="linklike desk-note" type="button" (click)="openIssue(line.productId)">Schade of tekort melden ›</button>
                              }
                            </td>
                            <td class="c-qty">
                              <input class="input num right desk-cell" type="number" min="0" step="1" inputmode="numeric"
                                     [attr.aria-label]="'Aantal ' + line.productName"
                                     [disabled]="isReceived()" [ngModel]="line.quantity"
                                     (ngModelChange)="setQuantity(line.productId, +$event)" />
                            </td>
                            <td class="c-cartons num">
                              <b>{{ line.cartons | num }}</b>
                              <small>{{ piecesPerCarton(line.productId) | num }}/doos · {{ line.cbm | cbm }}</small>
                            </td>
                            <td class="c-price">
                              <div class="desk-price">
                                <input class="input num right desk-cell" type="number" min="0" step="0.01" inputmode="decimal"
                                       [attr.aria-label]="'Prijs per stuk ' + line.productName"
                                       [ngModel]="orderLine(line.productId)?.exwPrice"
                                       [placeholder]="line.quantity ? (line.goodsUsd / line.quantity | num: 4) : ''"
                                       (ngModelChange)="setExwPrice(line.productId, $event)" />
                                <select class="desk-mini" aria-label="Munt van de prijs"
                                        [disabled]="isReceived() || orderLine(line.productId)?.exwPrice == null"
                                        [ngModel]="effectiveExwCurrency(line.productId)"
                                        (ngModelChange)="setExwCurrency(line.productId, $event)">
                                  <option value="USD">USD</option><option value="CNY">CNY</option><option value="EUR">EUR</option>
                                </select>
                              </div>
                              <div class="desk-price__under">
                                <select class="desk-basis" aria-label="Wat de prijs dekt"
                                        [ngModel]="orderLine(line.productId)?.priceBasis ?? 'EXW'"
                                        (ngModelChange)="setPriceBasis(line.productId, $event)">
                                  <option value="EXW">EXW</option><option value="DDP">DDP</option>
                                </select>
                                @if (orderLine(line.productId)?.exwPrice == null && productCardPrice(line.productId); as currentPrice) {
                                  <small>kaart {{ currentPrice.amount | cur: currentPrice.currency }}</small>
                                }
                              </div>
                            </td>
                            <td class="c-money num">{{ amt(line.goodsEur, line) | eur: decimals() }}</td>
                            <td class="c-money num c-money--total">{{ perPiece() ? (line.landedUnitEur | eur: 4) : (line.totalEur | eur) }}</td>
                            <td class="c-act">
                              <button class="desk-remove" type="button" [disabled]="isReceived()"
                                      [attr.aria-label]="'Verwijder ' + line.productName" (click)="removeLine(line.productId)">×</button>
                            </td>
                          </tr>
                        }
                      }
                    }
                  </tbody>
                }
                <tfoot>
                  <tr>
                    <th class="c-product">Totaal</th>
                    <th class="c-qty num">{{ data.costing.totals.pieces | num }}</th>
                    <th class="c-cartons num">{{ data.costing.totals.cartons | num }}</th>
                    <th class="c-price"></th>
                    <th class="c-money num">{{ data.costing.totals.goodsEur | eur }}</th>
                    <th class="c-money num c-money--total">{{ perPiece() ? (data.costing.totals.averageUnitEur | eur: 4) : (data.costing.totals.totalEur | eur) }}</th>
                    <th class="c-act"></th>
                  </tr>
                </tfoot>
              </table>
              </div>
            } @else {
              <div class="empty desk-empty">
                <div class="empty__icon" aria-hidden="true">◈</div>
                <div class="empty__title">Bouw je container op</div>
                <p class="empty__text">Voeg producten toe. Aantallen, dozen en containervulling worden direct doorgerekend.</p>
                <button class="btn btn--primary" type="button" [disabled]="isReceived()" (click)="openPicker()">Eerste product toevoegen</button>
              </div>
            }

            @if (!isDdp() && data.costing.containerFill; as fill) {
              @if (fill.fillPercent > 105) {
                <div class="alert alert--danger desk-alert">
                  <span class="alert__icon" aria-hidden="true">!</span>
                  <div><b>{{ fill.fillPercent | num: 0 }}%</b> · te vol voor één {{ containerLabel(data.order.containerType) }}: <b>{{ fill.overflowCbm | cbm }} te veel</b>.
                    Op basis van volume zijn minimaal <b>{{ containerCountForFill(fill) }} containers</b> nodig; splits de order of kies een groter type.</div>
                </div>
              } @else if (fill.fillPercent > 100) {
                <div class="alert desk-alert desk-alert--tight">
                  <span class="alert__icon" aria-hidden="true">!</span>
                  <div><b>{{ fill.fillPercent | num: 0 }}%</b> · {{ fill.overflowCbm | cbm }} boven de {{ containerLabel(data.order.containerType) }}. Vaak past dit nog net; reken niet op meer.</div>
                </div>
              }
            }
          </main>

          <!-- ============================ the rail: everything else, one tab away -->
          <aside class="desk-rail" aria-label="Order, kosten, betalingen en dossier">
            <nav class="desk-tabs" role="tablist">
              <button type="button" role="tab" [class.on]="railTab() === 'order'" [attr.aria-selected]="railTab() === 'order'" (click)="railTab.set('order')">Order</button>
              <button type="button" role="tab" [class.on]="railTab() === 'costs'" [attr.aria-selected]="railTab() === 'costs'" (click)="railTab.set('costs')">Kosten</button>
              <button type="button" role="tab" [class.on]="railTab() === 'pay'" [attr.aria-selected]="railTab() === 'pay'" (click)="railTab.set('pay')">
                Betalingen @if (openAll() > 0) { <i class="desk-tabs__dot" aria-hidden="true"></i> }
              </button>
              <button type="button" role="tab" [class.on]="railTab() === 'files'" [attr.aria-selected]="railTab() === 'files'" (click)="railTab.set('files')">Dossier</button>
              <button type="button" role="tab" [class.on]="railTab() === 'done'" [attr.aria-selected]="railTab() === 'done'" (click)="railTab.set('done')">Afronden</button>
            </nav>

            <div class="desk-panel">
              @switch (railTab()) {
                @case ('order') {
                  <div class="desk-supplier">
                    <strong>{{ supplierName() }}</strong>
                    <app-supplier-address [supplier]="supplier()" [inline]="true" [showEmpty]="true" />
                    <small>{{ supplier()?.currency }}</small>
                  </div>
                  <div class="desk-form">
                    <div class="field">
                      <label for="dk-alias">Herkenbare naam <span class="opt"></span></label>
                      <input class="input" id="dk-alias" [ngModel]="data.order.alias" (ngModelChange)="patch({ alias: $event })" placeholder="Bijv. voorjaar, kleurvariant…" />
                    </div>
                    <div class="desk-form__duo">
                      <div class="field">
                        <label for="dk-date">Orderdatum</label>
                        <app-date-field fieldId="dk-date" [value]="data.order.orderDate" (valueChange)="patch({ orderDate: $event })" />
                      </div>
                      @if (!isReceived()) {
                        <div class="field">
                          <label for="dk-expected">Verwacht op <span class="opt"></span></label>
                          <app-date-field fieldId="dk-expected" [value]="data.order.expectedArrival ?? ''" (valueChange)="patch({ expectedArrival: $event || null })" />
                        </div>
                      } @else if (data.order.receivedOn) {
                        <div class="field"><label>Ontvangen op</label><div class="input desk-readonly">{{ data.order.receivedOn | dateNl }}</div></div>
                      }
                    </div>
                    <div class="field">
                      <label for="dk-terms">Betaalafspraak</label>
                      <select class="select" id="dk-terms" [ngModel]="data.order.paymentTerms ?? 'THIRDS'" (ngModelChange)="patch({ paymentTerms: $event })">
                        @for (terms of paymentTermOptions; track terms.value) { <option [value]="terms.value">{{ terms.label }}</option> }
                      </select>
                    </div>
                    @if (data.order.status !== 'CONCEPT') {
                      <div class="field">
                        <label for="dk-tracking">Track &amp; trace <span class="opt"></span></label>
                        <input class="input" id="dk-tracking" placeholder="Containernummer, B/L of link" [ngModel]="data.order.trackingReference ?? ''" (ngModelChange)="patch({ trackingReference: $event || null })" />
                        @if (data.order.shippedOn) { <span class="hint">Vertrokken op {{ data.order.shippedOn | dateNl }}.</span> }
                      </div>
                    }
                    <p class="desk-form__group">Route</p>
                    <div class="field">
                      <label for="dk-container">Type container</label>
                      <select class="select" id="dk-container" [ngModel]="data.order.containerType" (ngModelChange)="patch({ containerType: $event })">
                        @for (type of containerTypes; track type.value) { <option [value]="type.value">{{ type.label }}</option> }
                      </select>
                    </div>
                    <div class="desk-form__duo">
                      <div class="field">
                        <label for="dk-from">Vertrekhaven</label>
                        <select class="select" id="dk-from" [ngModel]="portSelection(data.order.departurePort, departurePorts, customDeparturePort())" (ngModelChange)="selectDeparturePort($event)">
                          @for (port of departurePorts; track port.value) { <option [value]="port.value">{{ port.label }}</option> }
                          <option [value]="otherPortValue">Andere haven…</option>
                        </select>
                        @if (usesCustomDeparturePort(data.order.departurePort)) {
                          <input class="input mt-8" aria-label="Andere vertrekhaven" autocomplete="off" placeholder="Typ de vertrekhaven"
                                 [value]="customPortInput(data.order.departurePort, departurePorts, customDeparturePort())" (blur)="setCustomDeparturePort($any($event.target).value)" />
                        }
                      </div>
                      <div class="field">
                        <label for="dk-to">Aankomsthaven</label>
                        <select class="select" id="dk-to" [ngModel]="portSelection(data.order.destinationPort, destinationPorts, customDestinationPort(), 'Rotterdam')" (ngModelChange)="selectDestinationPort($event)">
                          @for (port of destinationPorts; track port.value) { <option [value]="port.value">{{ port.label }}</option> }
                          <option [value]="otherPortValue">Andere haven…</option>
                        </select>
                        @if (usesCustomDestinationPort(data.order.destinationPort)) {
                          <input class="input mt-8" aria-label="Andere aankomsthaven" autocomplete="off" placeholder="Typ de aankomsthaven"
                                 [value]="customPortInput(data.order.destinationPort, destinationPorts, customDestinationPort())" (blur)="setCustomDestinationPort($any($event.target).value)" />
                        }
                      </div>
                    </div>
                    <div class="field">
                      <label for="dk-receiving">Lossen op</label>
                      <select class="select" id="dk-receiving" [ngModel]="data.order.receivingLocationId ?? mainLocationId()" (ngModelChange)="patch({ receivingLocationId: +$event })">
                        @for (location of stockLocations(); track location.id) { <option [value]="location.id">{{ location.name }}</option> }
                      </select>
                    </div>
                  </div>
                }

                @case ('costs') {
                  <div class="desk-form">
                    <p class="desk-form__group">Wisselkoersen</p>
                    <div class="desk-form__duo">
                      <div class="field"><label for="dk-cny">RMB → USD</label>
                        <input class="input num right" id="dk-cny" type="number" step="0.0001" inputmode="decimal" [ngModel]="data.order.cnyToUsd" (ngModelChange)="patch({ cnyToUsd: +$event })" /></div>
                      <div class="field"><label for="dk-usd">USD → EUR</label>
                        <input class="input num right" id="dk-usd" type="number" step="0.0001" inputmode="decimal" [ngModel]="usdToEurRate()" (ngModelChange)="setUsdToEur(+$event)" /></div>
                    </div>
                    <p class="desk-form__group">{{ isDdp() ? 'Geleverd incl. rechten' : 'Van fabriek tot magazijn' }}</p>
                    @if (isDdp()) {
                      <p class="hint">De afgesproken prijzen zijn DDP: transport, lokale kosten en invoerrechten zitten erin.</p>
                    } @else {
                      <div class="field">
                        <label class="req" for="dk-freight">{{ costLabels().seaFreightLabel }}</label>
                        <div class="input-affix">
                          <input class="input num right" id="dk-freight" type="number" step="50" min="0" inputmode="decimal" [ngModel]="data.order.freightUsd" (ngModelChange)="patch({ freightUsd: +$event })" />
                          <span class="input-affix__suffix">USD</span>
                        </div>
                        <span class="hint">{{ costLabels().seaFreightRoute }}@if (latestFreightReference(); as reference) { · laatste notering <b>{{ reference.usdPerContainer | cur: 'USD' }}</b> ({{ reference.quotedOn | dateNl }}) }</span>
                      </div>
                      <div class="field">
                        <label for="dk-origin">{{ costLabels().originCostsLabel }}</label>
                        <div class="input-affix">
                          <input class="input num right" id="dk-origin" type="number" step="50" min="0" inputmode="decimal" [ngModel]="data.order.originCosts" (ngModelChange)="patch({ originCosts: +$event })" />
                          <select class="input-affix__suffix desk-affix-select" aria-label="Munt lokale oorsprongskosten" [ngModel]="data.order.originCurrency" (ngModelChange)="patch({ originCurrency: $event })">
                            <option value="USD">USD</option><option value="CNY">CNY</option><option value="EUR">EUR</option>
                          </select>
                        </div>
                        <span class="hint">{{ costLabels().originRoute }}</span>
                      </div>
                      <div class="desk-form__duo">
                        <div class="field">
                          <label for="dk-dest">{{ costLabels().destinationCostsLabel }}</label>
                          <div class="input-affix">
                            <input class="input num right" id="dk-dest" type="number" step="25" min="0" inputmode="decimal" [ngModel]="data.order.destinationCostsEur" (ngModelChange)="patch({ destinationCostsEur: +$event })" />
                            <span class="input-affix__suffix">EUR</span>
                          </div>
                        </div>
                        <div class="field">
                          <label for="dk-duty">Invoerrecht zonder HS</label>
                          <div class="input-affix">
                            <input class="input num right" id="dk-duty" type="number" step="0.5" min="0" inputmode="decimal" [ngModel]="data.order.defaultDutyRatePct" (ngModelChange)="patch({ defaultDutyRatePct: +$event })" />
                            <span class="input-affix__suffix">%</span>
                          </div>
                        </div>
                      </div>
                    }
                    <div class="field">
                      <label for="dk-extra">Enrosed kost <span class="opt"></span></label>
                      <div class="input-affix">
                        <input class="input num right" id="dk-extra" type="number" step="100" min="0" inputmode="decimal" [ngModel]="data.order.extraRevenueEur" (ngModelChange)="patch({ extraRevenueEur: +$event })" />
                        <span class="input-affix__suffix">EUR</span>
                      </div>
                    </div>

                    <details class="desk-details">
                      <summary>Verdeelsleutels &amp; varianten</summary>
                      <label class="desk-switch">
                        <span><b>Varianten als één product</b><small>Kleuren en maten van dezelfde reeks krijgen samen één kostprijs per stuk.</small></span>
                        <input type="checkbox" [ngModel]="data.order.groupVariants ?? true" (ngModelChange)="patch({ groupVariants: $event })" />
                      </label>
                      @for (key of allocationKeys(); track key.field) {
                        <div class="field">
                          <label [attr.for]="'dk-a-' + key.field">{{ key.label }}</label>
                          <select class="select" [id]="'dk-a-' + key.field" [ngModel]="allocationOf(data.order, key.field)" (ngModelChange)="setAllocation(key.field, $event)">
                            <option value="CBM">Naar volume (m³)</option><option value="VALUE">Naar goederenwaarde</option><option value="PIECES">Naar aantal stuks</option>
                          </select>
                        </div>
                      }
                    </details>

                    <p class="desk-form__group">Opbouw</p>
                    <div class="desk-sum">
                      <div class="stat-row"><span>{{ isDdp() ? 'Goederen (DDP)' : 'Goederen' }} <small>{{ data.costing.totals.goodsUsd | cur: 'USD' }}</small></span><span class="num">{{ data.costing.totals.goodsEur | eur }}</span></div>
                      @if (!isDdp()) {
                        @if (data.costing.totals.originEur) { <div class="stat-row"><span>{{ costLabels().originCostsLabel }}</span><span class="num">{{ data.costing.totals.originEur | eur }}</span></div> }
                        <div class="stat-row"><span>{{ costLabels().seaFreightLabel }}</span><span class="num">{{ data.costing.totals.freightEur | eur }}</span></div>
                        <div class="stat-row desk-sum__sub"><span>Douanewaarde</span><span class="num">{{ data.costing.totals.customsValueEur | eur }}</span></div>
                        <div class="stat-row"><span>Invoerrechten <small>gem. {{ data.costing.totals.effectiveDutyPct | pct: 1 }}</small></span><span class="num">{{ data.costing.totals.dutyEur | eur }}</span></div>
                        <div class="stat-row"><span>{{ costLabels().destinationCostsLabel }}</span><span class="num">{{ data.costing.totals.destinationEur | eur }}</span></div>
                      }
                      @if (data.costing.totals.extraRevenueEur) { <div class="stat-row"><span>Enrosed kost</span><span class="num">{{ data.costing.totals.extraRevenueEur | eur }}</span></div> }
                      <div class="stat-row desk-sum__total"><span>Totaal geland</span><strong class="num">{{ data.costing.totals.totalEur | eur }}</strong></div>
                      @if (!isDdp() && data.costing.totals.goodsEur > 0) {
                        <p class="hint">Bovenop de goederen: + {{ data.costing.totals.totalEur - data.costing.totals.goodsEur | eur }} ({{ overheadPct(data.costing.totals) | num }} %)</p>
                      }
                    </div>
                  </div>
                }

                @case ('pay') {
                  <div class="desk-pay-head">
                    <strong>@if (paidAll() > 0) { {{ paidAll() | eur }} betaald } @else { Nog niets betaald }</strong>
                    <small>Te betalen {{ owedAll() | eur }} · open {{ openAll() | eur }}</small>
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
                              <span class="instalments__what"><b>{{ step.label }}</b>
                                <small>{{ step.amount | eur }}{{ step.state === 'due' ? ' · nu te betalen' : (step.state === 'later' ? ' · later' : '') }}</small></span>
                              @if (step.state === 'due') { <button class="btn btn--sm" type="button" (click)="openPayment(step.amount, step.label, 'SUPPLIER')">Noteren</button> }
                            </li>
                          }
                        </ol>
                      }
                    }
                    @for (payment of paymentsTo('SUPPLIER'); track payment.id) {
                      <div class="pay-line">
                        <span class="pay-line__what"><b>{{ payment.label || 'Betaling' }}</b>
                          <small>{{ payment.paidOn | dateNl }}@if (payment.actor) { · {{ actorLabel(payment.actor) }}}@if (payment.currency !== 'EUR') { · {{ payment.amount | cur: payment.currency }}}@if (proofsOf(payment.id).length) { · {{ proofsOf(payment.id).length }} bewijs}</small></span>
                        <span class="num pay-line__amount">{{ payment.amountEur | eur }}</span>
                        <button class="pay-line__remove" type="button" title="Verwijderen" aria-label="Betaling verwijderen" (click)="removePayment(payment)">×</button>
                      </div>
                    }
                    @if (!(openFor('SUPPLIER') > 0) && supplierOwed() > 0) { <p class="pay-stream__done">✓ Volledig betaald</p> }
                    <button class="pay-stream__add" type="button" (click)="openPayment(undefined, undefined, 'SUPPLIER')">+ Betaling aan de leverancier</button>
                  </div>
                  @if (!isDdp()) {
                    <div class="pay-stream">
                      <div class="pay-stream__head">
                        <span><b>Douane &amp; transport</b><small>invoerrechten, {{ data.payable?.freightInSupplierPrice ? '' : 'zeevracht, ' }}lokale kosten · na aankomst</small></span>
                        <span class="num"><b>{{ paidTo('LOGISTICS') | eur }}</b><small>van {{ logisticsOwed() | eur }}</small></span>
                      </div>
                      <div class="payments-meter"><div class="payments-meter__fill" [style.width.%]="pct(paidTo('LOGISTICS'), logisticsOwed())"></div></div>
                      @for (payment of paymentsTo('LOGISTICS'); track payment.id) {
                        <div class="pay-line">
                          <span class="pay-line__what"><b>{{ payment.label || 'Betaling' }}</b>
                            <small>{{ payment.paidOn | dateNl }}@if (payment.actor) { · {{ actorLabel(payment.actor) }}}@if (payment.currency !== 'EUR') { · {{ payment.amount | cur: payment.currency }}}</small></span>
                          <span class="num pay-line__amount">{{ payment.amountEur | eur }}</span>
                          <button class="pay-line__remove" type="button" title="Verwijderen" aria-label="Betaling verwijderen" (click)="removePayment(payment)">×</button>
                        </div>
                      }
                      @if (!(openFor('LOGISTICS') > 0) && logisticsOwed() > 0) { <p class="pay-stream__done">✓ Volledig betaald</p> }
                      <button class="pay-stream__add" type="button" (click)="openPayment(undefined, undefined, 'LOGISTICS')">+ Betaling douane &amp; transport</button>
                    </div>
                  }
                  @if (data.costing.totals.extraRevenueEur) { <p class="hint">Enrosed kost {{ data.costing.totals.extraRevenueEur | eur }} is onze eigen opslag - geen betaling.</p> }
                }

                @case ('files') {
                  <div class="desk-files-head">
                    <strong>Dagboek van de container</strong>
                    <button class="linklike" type="button" (click)="noteEditing.set(!noteEditing())">{{ noteEditing() ? 'Klaar' : 'Bewerken' }}</button>
                  </div>
                  @if (noteEditing()) {
                    <textarea class="textarea" rows="7" [ngModel]="data.order.notes" (ngModelChange)="patch({ notes: $event })"
                              placeholder="Afspraken, laadinstructies of aandachtspunten - ontvangst, bijboeken en betalingen schrijven zich hier vanzelf bij"></textarea>
                  } @else if (data.order.notes) {
                    <app-diary [notes]="data.order.notes" />
                  } @else {
                    <p class="hint">Nog leeg - ontvangst, bijboeken en betalingen schrijven zich hier vanzelf bij.</p>
                  }

                  <div class="desk-files-head mt-12">
                    <strong>Documenten <small>{{ (documents() ?? []).length }}</small></strong>
                    <button class="btn btn--sm" type="button" (click)="openDocument()">+ Document</button>
                  </div>
                  @if (documents(); as docs) {
                    @if (docs.length) {
                      <ul class="files-list">
                        @for (doc of docs; track doc.id) {
                          <li>
                            @if (renamingDoc()?.id === doc.id) {
                              <input class="input input--sm files-list__rename" type="text" enterkeyhint="done" placeholder="Titel, bijv. KBC mei"
                                     [ngModel]="renamingDoc()!.label" (ngModelChange)="renamingDoc.set({ id: doc.id, label: $event })"
                                     (keydown.enter)="commitDocRename(doc)" (keydown.escape)="renamingDoc.set(null)" (blur)="commitDocRename(doc)" />
                            } @else {
                              <span class="files-list__name">
                                <b>{{ doc.kindLabel }}{{ doc.label ? ' · ' + doc.label : '' }}</b>
                                <small>{{ doc.originalFilename }} · {{ sizeLabel(doc.sizeBytes) }} · {{ doc.addedAt | dateNl }}@if (doc.actor) { · {{ actorLabel(doc.actor) }} }</small>
                              </span>
                            }
                            <span class="files-list__actions">
                              <button class="files-list__pencil" type="button" title="Titel aanpassen" (click)="renamingDoc.set({ id: doc.id, label: doc.label ?? '' })">✎</button>
                              <button class="btn btn--sm" type="button" (click)="downloadDocument(doc)">Openen</button>
                              <button class="pay-line__remove" type="button" title="Verwijderen" aria-label="Document verwijderen" (click)="removeDocument(doc)">×</button>
                            </span>
                          </li>
                        }
                      </ul>
                    } @else {
                      <p class="hint">Nog geen bestanden bij deze container.</p>
                    }
                  }
                  <div class="mt-12"><app-purchase-activity [orderId]="data.order.id" [collapsible]="true" /></div>
                }

                @case ('done') {
                  <div class="desk-done">
                    <strong>{{ nextStep() ? 'Klaar voor de volgende stap?' : 'Container afgerond' }}</strong>
                    <p class="hint">
                      @if (data.order.status === 'CONCEPT') { Controleer de producten en kosten voordat je de bestelling vastlegt. }
                      @else if (!isReceived()) { Bij ontvangst tel je wat er echt in de container zat; bijboeken kan meteen of later. }
                      @else if (!(data.order.stockBooked ?? true)) { Ontvangen, nog niet bijgeboekt: de stuks staan nog niet in de voorraad. }
                      @else { De voorraad is bijgeboekt. Je kunt nog een variant maken of kostprijzen toepassen. }
                    </p>
                    @if (data.attention?.length) {
                      <ul class="desk-done__attention">
                        @for (item of data.attention; track item) { <li>{{ item }}</li> }
                      </ul>
                    }
                    @if (data.receiptVariance; as variance) {
                      @if (variance.affectedLines > 0) {
                        <div class="desk-sum">
                          <div class="stat-row"><span>Ontbrekende stuks</span><span class="num">{{ variance.missingPieces | num }}</span></div>
                          <div class="stat-row"><span>Beschadigd</span><span class="num">{{ variance.damagedPieces | num }}</span></div>
                          <div class="stat-row desk-sum__total"><span>Inkoopimpact</span><strong class="num">{{ variance.totalLossValueEur | eur }}</strong></div>
                        </div>
                      }
                    }
                    <div class="desk-done__buttons">
                      @if (nextStep(); as step) { <button class="btn btn--primary btn--block" type="button" (click)="advanceStatus()">{{ step.action }}</button> }
                      @if (isReceived() && !(data.order.stockBooked ?? true)) {
                        <button class="btn btn--primary btn--block" type="button" [disabled]="booking()" (click)="bookStock()">{{ booking() ? 'Bezig…' : 'Voorraad bijboeken' }}</button>
                      }
                      <button class="btn btn--block" type="button" (click)="apply()">{{ costsApplied() ? 'Opnieuw kostprijzen toepassen' : 'Kostprijzen toepassen' }}</button>
                      <button class="btn btn--block" type="button" (click)="duplicate()">Deze container kopiëren</button>
                      <button class="btn btn--block" type="button" (click)="pdfOpen.set(true)">PDF maken</button>
                      @if (!isReceived()) { <button class="btn btn--danger btn--block" type="button" (click)="remove()">Calculatie verwijderen</button> }
                    </div>
                  </div>
                }
              }
            </div>
          </aside>
        </div>
      </div>

      @if (picking()) {
        <app-product-picker heading="Product toevoegen aan de container" [products]="available()" [categories]="categories()"
                            [families]="families()" [groupByFamily]="true" [priceOf]="exwPriceOf" [currencyOf]="exwCurrencyOf"
                            [enforceCartons]="false" mode="multi" [preserveSourceOrder]="true" [stockAware]="false"
                            (picked)="addLine($event)" (pickedMany)="addLines($event)" (cancelled)="picking.set(false)"
                            [allowCreate]="true" [createCurrency]="supplier()?.currency ?? 'USD'" (create)="quickCreate($event)" />
      }

      @if (issue(); as report) {
        <app-sheet [title]="'Schade of tekort · ' + (issueLine()?.productName ?? '')" (closed)="issue.set(null)">
          <div body>
            <div class="per-toggle" role="group" aria-label="Wat is er aan de hand?">
              <button type="button" [class.on]="report.kind === 'DAMAGED'" (click)="issue.set({ ...report, kind: 'DAMAGED' })">Beschadigd</button>
              <button type="button" [class.on]="report.kind === 'SHORT'" (click)="issue.set({ ...report, kind: 'SHORT' })">Minder aangekomen</button>
            </div>
            <div class="field mt-12">
              <label class="req" for="issue-qty">Aantal stuks</label>
              <input class="input num right" id="issue-qty" type="number" min="1" step="1" inputmode="numeric" [ngModel]="report.quantity || null" (ngModelChange)="issue.set({ ...report, quantity: +$event })" />
            </div>
            @if (issueLine(); as line) {
              @if (report.kind === 'DAMAGED') {
                <p class="hint mt-8">Nu {{ orderLine(line.productId)?.damagedQuantity ?? 0 }} beschadigd van {{ line.quantity | num }} ontvangen. {{ report.quantity > 0 ? 'Er komen ' + report.quantity + ' bij; die gaan als beschadigd uit de voorraad.' : '' }}</p>
              } @else {
                <p class="hint mt-8">Ontvangen telt nu {{ line.quantity | num }} stuks. {{ report.quantity > 0 ? 'Wordt ' + (line.quantity - report.quantity) + '; het verschil gaat uit de voorraad.' : '' }}</p>
              }
            }
          </div>
          <div foot style="display:contents">
            <span class="spacer"></span>
            <button class="btn" type="button" (click)="issue.set(null)">Annuleren</button>
            <button class="btn btn--primary" type="button" [disabled]="saving() || !(report.quantity > 0)" (click)="confirmIssue()">{{ saving() ? 'Bezig…' : 'Melden' }}</button>
          </div>
        </app-sheet>
      }

      @if (paying(); as pay) {
        <app-sheet [title]="pay.payee === 'LOGISTICS' ? 'Betaling douane & transport' : 'Betaling aan de leverancier'" (closed)="paying.set(null)">
          <div body>
            <div class="pay-chips" role="group" aria-label="Snel invullen">
              @for (chip of (pay.payee === 'SUPPLIER' ? payChips() : []); track chip.label) {
                <button class="pay-chip" type="button" (click)="paying.set({ ...pay, amount: chip.amount, currency: 'EUR', label: chip.label })">{{ chip.label }}<small>{{ chip.amount | eur }}</small></button>
              }
            </div>
            <div class="form-grid mt-12">
              <div class="field">
                <label for="pay-amount">Bedrag</label>
                <div class="input-affix">
                  <input class="input num right" id="pay-amount" type="number" min="0" step="0.01" inputmode="decimal" [ngModel]="pay.amount" (ngModelChange)="paying.set({ ...pay, amount: +$event })" />
                  <select class="input-affix__suffix desk-affix-select" aria-label="Munt" [ngModel]="pay.currency" (ngModelChange)="paying.set({ ...pay, currency: $event })">
                    <option value="EUR">EUR</option><option value="USD">USD</option><option value="CNY">CNY</option>
                  </select>
                </div>
                @if (pay.currency !== 'EUR' && pay.amount > 0) { <span class="hint">≈ {{ eurOf(pay.amount, pay.currency) | eur }} aan de koers van deze order.</span> }
                @if (payingOverage() > 0) { <span class="hint hint--warn">Let op: dit gaat {{ payingOverage() | eur }} over het afgesproken bedrag heen. Bewaren kan gewoon.</span> }
                @else if (pay.amount > 0 && openFor(pay.payee) > 0) { <span class="hint">Nog open: {{ openFor(pay.payee) | eur }}.</span> }
              </div>
              <div class="field">
                <label for="pay-date">Betaald op</label>
                <app-date-field fieldId="pay-date" [value]="pay.paidOn" (valueChange)="paying.set({ ...pay, paidOn: $event })" />
              </div>
              <div class="field span-2">
                <label for="pay-label">Omschrijving <span class="opt"></span></label>
                <input class="input" id="pay-label" placeholder="Bijv. aanbetaling 30%, saldo, slotbetaling" [ngModel]="pay.label" (ngModelChange)="paying.set({ ...pay, label: $event })" />
              </div>
            </div>
          </div>
          <div foot style="display:contents">
            <button class="btn" type="button" (click)="paying.set(null)">Annuleren</button>
            <button class="btn btn--primary" type="button" [disabled]="payingBusy() || !(pay.amount > 0)" (click)="confirmPayment()">{{ payingBusy() ? 'Bezig…' : 'Betaling bewaren' }}</button>
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
                <input class="input" id="doc-label" placeholder="bijv. KBC 23/08, factuur 2e helft" [ngModel]="doc.label" (ngModelChange)="addingDocument.set({ ...doc, label: $event })" />
              </div>
              @if (doc.kind === 'PAYMENT_PROOF' && paymentsTo('SUPPLIER').length + paymentsTo('LOGISTICS').length) {
                <div class="field span-2">
                  <label for="doc-payment">Hoort bij betaling <span class="opt"></span></label>
                  <select class="select" id="doc-payment" [ngModel]="doc.paymentId ?? ''" (ngModelChange)="addingDocument.set({ ...doc, paymentId: $event ? +$event : null })">
                    <option value="">— geen —</option>
                    @for (payment of payments() ?? []; track payment.id) { <option [value]="payment.id">{{ payment.paidOn | dateNl }} · {{ payment.amountEur | eur }}{{ payment.label ? ' · ' + payment.label : '' }}</option> }
                  </select>
                </div>
              }
              <div class="field span-2">
                <label for="doc-file">Bestand</label>
                <input class="input" id="doc-file" type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx,.csv" (change)="addingDocument.set({ ...doc, file: $any($event.target).files?.[0] ?? null })" />
                <span class="hint">PDF, foto of Office-bestand, tot 25 MB.</span>
              </div>
            </div>
          </div>
          <div foot style="display:contents">
            <button class="btn" type="button" (click)="addingDocument.set(null)">Annuleren</button>
            <button class="btn btn--primary" type="button" [disabled]="uploadingDocument() || !doc.file" (click)="confirmDocument()">{{ uploadingDocument() ? 'Bezig…' : 'Bewaren' }}</button>
          </div>
        </app-sheet>
      }

      @if (firstInstalmentPrompt(); as first) {
        <app-sheet title="Eerste betaling" (closed)="firstInstalmentPrompt.set(null)">
          <div body>
            <p>De bestelling staat vast. Volgens de betaalafspraak is nu <b>{{ first.label }}</b> aan de beurt: <b>{{ first.amount | eur }}</b> aan {{ supplierName() }}.</p>
            <p class="hint mt-8">Al betaald? Noteer het hier, eventueel met het bankafschrift (max. 5 bestanden). Nog niet? Dan blijft de termijn open staan bij Betalingen.</p>
            <div class="form-grid mt-12">
              <div class="field">
                <label for="first-amount">Betaald bedrag</label>
                <div class="input-affix">
                  <input class="input num right" id="first-amount" type="number" min="0" step="0.01" inputmode="decimal" [ngModel]="first.amount" (ngModelChange)="firstInstalmentPrompt.set({ ...first, amount: +$event })" />
                  <select class="input-affix__suffix desk-affix-select" aria-label="Munt" [ngModel]="first.currency" (ngModelChange)="firstInstalmentPrompt.set({ ...first, currency: $event })">
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
                <input class="input" id="first-proof" type="file" multiple accept=".pdf,.jpg,.jpeg,.png" (change)="firstInstalmentPrompt.set({ ...first, files: fileList($any($event.target).files) })" />
                <span class="hint">Bijv. het KBC-afschrift; hoogstens vijf bestanden.</span>
              </div>
            </div>
          </div>
          <div foot style="display:contents">
            <button class="btn" type="button" (click)="firstInstalmentPrompt.set(null)">Nog niet betaald</button>
            <button class="btn btn--primary" type="button" [disabled]="payingBusy() || !(first.amount > 0)" (click)="confirmFirstInstalment()">{{ payingBusy() ? 'Bezig…' : 'Betaald - noteren' }}</button>
          </div>
        </app-sheet>
      }

      @if (receiving(); as draft) {
        <app-sheet title="Container ontvangen" [wide]="true" (closed)="receiving.set(null)">
          <div body>
            <p class="hint">Vul per product in wat er werkelijk in de container zat. Staat alles zoals besteld, dan hoef je niets te wijzigen.</p>
            @if (receiveSummary(); as summary) {
              <div class="receive-preview" aria-label="Voorbeeld van de ontvangstsamenvatting">
                <span><small>Bruikbaar</small><b>{{ summary.usablePieces | num }} st</b></span>
                <span><small>Ontbreekt</small><b [class.warn-text]="summary.missingPieces">{{ summary.missingPieces | num }} st</b></span>
                <span><small>Beschadigd</small><b [class.danger-text]="summary.damagedPieces">{{ summary.damagedPieces | num }} st</b></span>
                <span><small>Inkoopimpact</small><b>{{ summary.totalLossValueEur | eur: 0 }}</b></span>
                @if (!summary.valuationComplete) { <p>{{ summary.unvaluedLossPieces | num }} afwijkende stuks hebben nog geen inkoopwaarde.</p> }
              </div>
            }
            <div class="receive-lines">
              @for (line of draft.lines; track line.productId) {
                <div class="receive-line" [class.receive-line--short]="line.received < line.ordered" [class.receive-line--damaged]="line.damaged > 0">
                  <div class="receive-line__name"><b>{{ line.name }}</b><small>{{ line.sku }} · besteld {{ line.ordered | num }}</small></div>
                  <label class="receive-line__field"><span>Ontvangen</span>
                    <input class="input num right" type="number" min="0" step="1" inputmode="numeric" [ngModel]="line.received" (ngModelChange)="setReceived(line.productId, +$event)" /></label>
                  <label class="receive-line__field"><span>Beschadigd</span>
                    <input class="input num right" type="number" min="0" step="1" inputmode="numeric" [ngModel]="line.damaged" (ngModelChange)="setDamaged(line.productId, +$event)" /></label>
                  @if (line.received !== line.ordered || line.damaged > 0) {
                    <span class="receive-line__note">
                      @if (line.received < line.ordered) { {{ line.ordered - line.received | num }} te weinig }
                      @if (line.received > line.ordered) { {{ line.received - line.ordered | num }} te veel }
                      @if (line.damaged > 0) { · {{ line.damaged | num }} kapot }
                      @if (receiptLineImpact(line); as impact) { · {{ impact | eur: 2 }} inkoopimpact }
                    </span>
                  }
                </div>
              }
            </div>
            <div class="receive-balance mt-12">
              <div><b>Betaald tot nu: {{ paidTotalEur() | eur }}</b><small>Goederenwaarde {{ data.costing.totals.goodsEur | eur }} · totaal geland {{ data.costing.totals.totalEur | eur }}</small></div>
              @if (remainingEur() > 0.005) {
                <label class="receive-balance__final"><input type="checkbox" [ngModel]="draft.finalPayment" (ngModelChange)="receiving.set({ ...draft, finalPayment: $event })" /><span>Slotbetaling van <b>{{ remainingEur() | eur }}</b> meteen noteren</span></label>
              } @else { <span class="hint">Volledig betaald volgens de betalingen hierboven.</span> }
            </div>
            <div class="field mt-12">
              <label for="rc-note">Opmerking bij de ontvangst <span class="opt"></span></label>
              <textarea class="textarea" id="rc-note" rows="2" [ngModel]="draft.note" (ngModelChange)="receiving.set({ ...draft, note: $event })" placeholder="Bijv. doos 3 nat aangekomen, foto's gemaild naar leverancier"></textarea>
            </div>
            <label class="desk-switch mt-12">
              <span><b>Meteen bijboeken op {{ receivingLocationName(data.order.receivingLocationId) }}</b><small>Ontvangen min beschadigd gaat in de voorraad. Uit: later via "Voorraad bijboeken".</small></span>
              <input type="checkbox" [ngModel]="draft.bookStock" (ngModelChange)="receiving.set({ ...draft, bookStock: $event })" />
            </label>
          </div>
          <div foot style="display:contents">
            <button class="btn" type="button" (click)="receiving.set(null)">Annuleren</button>
            <button class="btn btn--primary" type="button" [disabled]="booking()" (click)="confirmReceive()">{{ booking() ? 'Bezig…' : (draft.bookStock ? 'Ontvangen en bijboeken' : 'Ontvangen') }}</button>
          </div>
        </app-sheet>
      }

      @if (orderPlaced()) {
        <app-purchase-ordered-success [orderNumber]="data.order.number" (closed)="closeOrderPlaced()" (overview)="openOrderView()" />
      }
      @if (statusCelebration(); as celebration) {
        <app-purchase-status-success [kind]="celebration" [orderNumber]="data.order.number"
                                     [showAction]="celebration === 'SHIPPED' ? !data.order.trackingReference : !(data.order.stockBooked ?? true)"
                                     (closed)="statusCelebration.set(null)" (action)="celebrationAction(celebration)" />
      }
      @if (pdfOpen()) {
        <app-purchase-pdf-sheet [orderId]="data.order.id" [orderNumber]="data.order.number" [dirty]="dirty()" [saving]="saving()"
                                (saveRequested)="save()" (closed)="pdfOpen.set(false)" />
      }
    } @else {
      <app-page-header title="Inkoop" subtitle="Inkooporder laden…" [showBack]="true" [showBell]="false" />
      <div class="content"><div class="desk-loading" role="status" aria-live="polite">Inkooporder laden…</div></div>
    }
  `,
  styles: [`
    :host{display:block;min-width:0}
    .desk{width:100%;max-width:1560px;box-sizing:border-box;padding:14px 24px 60px}
    .sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}

    /* ---- hero: the dark card the sales editor wears too */
    .desk-hero{overflow:hidden;border-radius:22px;color:#fff;background:radial-gradient(circle at 92% 0%,color-mix(in srgb,var(--rose-mid) 42%,transparent),transparent 42%),linear-gradient(145deg,#211a17,#33251f 62%,color-mix(in srgb,var(--rose-dark) 58%,#211a17));box-shadow:0 12px 32px rgb(26 22 20/.15)}
    .desk-hero__top{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:18px 20px 14px}
    .desk-hero__who{min-width:0;flex:1}
    .desk-hero__eyebrow{display:block;color:rgb(255 255 255/.58);font-size:10px;font-weight:750;letter-spacing:.14em;text-transform:uppercase}
    .desk-hero__who h1{margin:2px 0 4px;overflow:hidden;font-size:22px;font-weight:750;letter-spacing:-.01em;text-overflow:ellipsis;white-space:nowrap}
    .desk-hero__who p{margin:0;color:rgb(255 255 255/.78);font-size:12.5px}
    .desk-hero__who p.desk-hero__meta{margin-top:2px;color:rgb(255 255 255/.55);font-size:11.5px}
    .desk-status{display:flex;flex:none;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:4px;max-width:520px}
    .desk-status__step{display:inline-flex;align-items:center;gap:6px;padding:5px 11px 5px 5px;border:1px solid rgb(255 255 255/.16);border-radius:999px;background:rgb(255 255 255/.06);color:rgb(255 255 255/.62);font-size:11.5px;font-weight:650;white-space:nowrap}
    .desk-status__step i{display:grid;width:20px;height:20px;place-items:center;border-radius:50%;background:rgb(255 255 255/.12);color:#fff;font-size:10px;font-style:normal;font-weight:800}
    .desk-status__step--done,.desk-status__step--arrived{color:#9fe0b4;border-color:rgb(159 224 180/.35);background:rgb(159 224 180/.1)}.desk-status__step--done i,.desk-status__step--arrived i{background:#2e7d4f;color:#fff}
    .desk-status__step--now{color:#fff;border-color:rgb(255 255 255/.5);background:rgb(255 255 255/.16)}.desk-status__step--now i{background:#fff;color:var(--rose-dark)}
    .desk-status__line{width:12px;height:2px;background:rgb(255 255 255/.18)}.desk-status__line--done{background:#2e7d4f}

    .desk-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:1px;border-top:1px solid rgb(255 255 255/.12);background:rgb(255 255 255/.12)}
    .desk-kpi{display:grid;min-width:0;align-content:start;gap:2px;padding:12px 16px 13px;border:0;background:rgb(33 26 23/.55);color:#fff;font:inherit;text-align:left}
    .desk-kpi small{color:rgb(255 255 255/.55);font-size:9.5px;font-weight:750;letter-spacing:.1em;text-transform:uppercase}
    .desk-kpi strong{font-size:19px;font-weight:750;font-variant-numeric:tabular-nums;line-height:1.15}
    .desk-kpi span{overflow:hidden;color:rgb(255 255 255/.6);font-size:11px;text-overflow:ellipsis;white-space:nowrap}
    .desk-kpi--total strong{color:#f4cf9a}
    .desk-kpi--button{cursor:pointer}.desk-kpi--button:hover{background:rgb(255 255 255/.08)}.desk-kpi--button.is-warn strong{color:#f4cf9a}
    .desk-kpi strong.is-ok{color:#9fe0b4}.desk-kpi strong.is-warn{color:#f4cf9a}.desk-kpi strong.is-bad{color:#f6a3a3}
    .desk-kpi__meter{display:block;height:5px;margin:3px 0 2px;border-radius:99px;background:rgb(255 255 255/.15);overflow:hidden}
    .desk-kpi__meter i{display:block;height:100%;background:#9fe0b4;border-radius:99px}.desk-kpi__meter i.is-warn{background:#f4cf9a}.desk-kpi__meter i.is-bad{background:#f6a3a3}
    .desk-kpi--go{background:var(--rose);cursor:pointer}.desk-kpi--go:hover:not(:disabled){background:var(--rose-mid)}.desk-kpi--go:disabled{cursor:default}
    .desk-kpi--go small{color:rgb(255 255 255/.7)}.desk-kpi--go strong{font-size:15px}.desk-kpi--go span{color:rgb(255 255 255/.7)}

    .desk-attention{display:flex;align-items:center;gap:10px;margin-top:12px;padding:9px 14px;border:1px solid #eddcb9;border-radius:12px;background:var(--warn-soft);color:var(--ink-2);font-size:12.5px}
    .desk-attention b{display:inline-grid;place-items:center;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:var(--warn);color:#fff;font-size:11px}
    .desk-attention span{flex:1;min-width:0}
    .desk-alert{margin:12px 16px 16px}.desk-alert--tight{border:1px solid #eddcb9;background:var(--warn-soft);color:var(--ink-2)}.desk-alert--tight .alert__icon{background:var(--warn);color:#fff}

    /* ---- body: table + rail */
    .desk-body{display:grid;grid-template-columns:minmax(0,1fr) 350px;gap:16px;align-items:start;margin-top:14px}
    .desk-main{min-width:0;border:1px solid var(--line);border-radius:18px;background:var(--surface);box-shadow:var(--sh-1)}
    .desk-table-bar{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line)}
    .desk-table-bar>div{flex:1;min-width:0}.desk-table-bar h2{font-size:15px}.desk-table-bar p{color:var(--muted);font-size:11.5px}
    .desk-table-wrap{overflow-x:auto}
    .desk-table{width:100%;border-collapse:separate;border-spacing:0;font-size:12.5px}
    .desk-table thead th{padding:9px 10px;border-bottom:1px solid var(--line);background:var(--surface-2);color:var(--muted);font-size:10px;font-weight:750;letter-spacing:.08em;text-align:right;text-transform:uppercase;white-space:nowrap}
    .desk-table thead th.c-product{text-align:left;padding-left:16px}
    .desk-table td{padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
    .desk-table td.c-product{padding-left:16px}
    .c-product{width:auto;min-width:220px}.c-qty{width:84px}.c-cartons{width:92px}.c-price{width:170px}.c-money{width:112px;text-align:right;font-variant-numeric:tabular-nums}.c-act{width:34px}
    .c-money--total{font-weight:750;color:var(--rose-dark)}
    .desk-section__row th{padding:12px 16px 5px;color:var(--rose);font-size:10px;font-weight:760;letter-spacing:.1em;text-align:left;text-transform:uppercase;background:var(--surface)}
    .desk-section__row th small{margin-left:6px;color:var(--muted);font-weight:600;letter-spacing:0;text-transform:none}
    .desk-family td{padding:0;background:var(--surface-2)}
    .desk-family__toggle{display:flex;width:100%;align-items:center;gap:8px;padding:8px 16px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
    .desk-family__toggle strong{font-size:12.5px}.desk-family__toggle small{flex:1;min-width:0;overflow:hidden;color:var(--muted);font-size:11px;text-overflow:ellipsis;white-space:nowrap}
    .desk-family__toggle b{color:var(--rose-dark);font-variant-numeric:tabular-nums}
    .desk-family__chev{display:inline-block;color:var(--muted);font-style:normal;font-size:16px;transform:rotate(90deg);transition:transform .15s ease}
    .desk-family--folded .desk-family__chev{transform:none}
    .desk-family__swatches{display:inline-flex;gap:3px}
    .line-colour-dot{display:inline-block;width:10px;height:10px;border:1px solid rgb(0 0 0/.15);border-radius:50%;vertical-align:-1px;margin-right:4px}.line-colour-dot--empty{background:var(--surface)!important}
    .desk-row:hover td{background:color-mix(in srgb,var(--rose-soft) 45%,var(--surface))}
    .desk-row--variant td.c-product{padding-left:30px}
    .desk-product{display:flex;align-items:center;gap:10px;color:inherit;text-decoration:none}
    .desk-product:hover strong{color:var(--rose-dark);text-decoration:underline}
    .desk-product__photo{width:40px;height:40px;flex:none;border:1px solid var(--line);border-radius:10px;object-fit:cover;background:#fff}
    .desk-product__photo--empty{display:grid;place-items:center;background:var(--surface-2);color:var(--muted);font-size:11px;font-weight:700}
    .desk-product__copy{display:grid;min-width:0;line-height:1.25}.desk-product__copy strong{font-size:13px}.desk-product__copy small{color:var(--muted);font-size:11px}
    .desk-note{display:block;margin:3px 0 0 50px;padding:0;border:0;background:none;color:var(--muted);font:inherit;font-size:11px;text-align:left}
    .desk-note--warn{color:var(--warn);font-weight:650}
    button.desk-note{cursor:pointer}button.desk-note:hover{color:var(--rose-dark)}
    .desk-cell{min-height:34px;padding:5px 8px;font-size:13px}
    .c-cartons b{display:block;font-variant-numeric:tabular-nums}.c-cartons small{display:block;color:var(--muted);font-size:10px;white-space:nowrap}
    .desk-price{display:flex}.desk-price .desk-cell{flex:1;min-width:0;border-radius:var(--r-sm) 0 0 var(--r-sm)}
    .desk-mini{min-height:34px;padding:0 3px;border:1px solid var(--line-strong);border-left:0;border-radius:0 var(--r-sm) var(--r-sm) 0;background:var(--surface);color:var(--ink);font:inherit;font-size:11px}
    .desk-price__under{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:2px;padding:0 2px}
    .desk-basis{padding:0;border:0;background:transparent;color:var(--rose-dark);font:inherit;font-size:10.5px;font-weight:700;cursor:pointer}
    .desk-price__under small{color:var(--muted);font-size:10px;white-space:nowrap}
    .desk-remove{width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--muted);font-size:18px;line-height:1;cursor:pointer}
    .desk-remove:hover:enabled{background:var(--danger-soft);color:var(--danger)}.desk-remove:disabled{opacity:.35}
    .desk-table tfoot th{padding:11px 10px;border-top:2px solid var(--line-strong);background:var(--surface-2);font-size:13px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
    .desk-table tfoot th.c-product{text-align:left;padding-left:16px;color:var(--muted);font-size:10px;font-weight:750;letter-spacing:.08em;text-transform:uppercase}
    .desk-empty{padding:40px 20px}

    /* ---- rail */
    .desk-rail{position:sticky;top:calc(var(--appbar-h,62px) + 14px);display:flex;flex-direction:column;max-height:calc(100dvh - var(--appbar-h,62px) - 28px);border:1px solid var(--line);border-radius:18px;background:var(--surface);box-shadow:var(--sh-1);overflow:hidden}
    .desk-tabs{display:flex;flex:none;gap:2px;padding:6px;border-bottom:1px solid var(--line);background:var(--surface-2)}
    .desk-tabs button{position:relative;flex:1;min-height:34px;padding:0 6px;border:0;border-radius:10px;background:transparent;color:var(--muted);font:inherit;font-size:12px;font-weight:650;cursor:pointer;white-space:nowrap}
    .desk-tabs button:hover{color:var(--ink)}.desk-tabs button.on{background:var(--surface);color:var(--rose-dark);box-shadow:var(--sh-1)}
    .desk-tabs__dot{position:absolute;top:7px;right:7px;width:6px;height:6px;border-radius:50%;background:var(--warn)}
    .desk-panel{flex:1;min-height:0;padding:14px;overflow-y:auto}
    .desk-supplier{display:grid;gap:2px;margin-bottom:12px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}
    .desk-supplier strong{font-size:13px}.desk-supplier small{color:var(--muted);font-size:11px}
    .desk-form{display:grid;gap:10px}.desk-form .field{min-width:0}
    .desk-form__duo{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .desk-form__group{margin:6px 0 -2px;color:var(--rose);font-size:10px;font-weight:760;letter-spacing:.1em;text-transform:uppercase}
    .desk-form__group:first-child{margin-top:0}
    .desk-readonly{background:var(--surface-2)}
    .desk-affix-select{min-width:64px;border-radius:0 var(--r-sm) var(--r-sm) 0}
    .desk-details{border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}
    .desk-details summary{padding:9px 12px;font-size:12.5px;font-weight:650;cursor:pointer}
    .desk-details>*:not(summary){margin:0 12px 10px}
    .desk-switch{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;cursor:pointer}
    .desk-switch>span{display:grid;gap:2px;min-width:0}.desk-switch b{font-size:12.5px}.desk-switch small{color:var(--muted);font-size:11px;line-height:1.35}.desk-switch input{width:20px;height:20px;flex:none;accent-color:var(--rose)}
    .desk-sum{padding:8px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}
    .desk-sum .stat-row{padding:4px 0;font-size:12px}.desk-sum .stat-row small{display:block;color:var(--muted);font-size:9.5px;font-weight:500}
    .desk-sum__sub{border-top:1px solid var(--line);font-weight:650}.desk-sum__total{border-top:2px solid var(--line-strong);font-size:13px}.desk-sum__total strong{color:var(--rose-dark)}
    .desk-pay-head{display:grid;gap:2px;margin-bottom:10px}.desk-pay-head strong{font-size:15px}.desk-pay-head small{color:var(--muted);font-size:11.5px}
    .desk-files-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}.desk-files-head strong{font-size:13px}
    .desk-done{display:grid;gap:10px}.desk-done strong{font-size:15px}
    .desk-done__attention{margin:0;padding:8px 12px 8px 26px;border:1px solid #eddcb9;border-radius:12px;background:var(--warn-soft);color:var(--ink-2);font-size:12px}
    .desk-done__buttons{display:grid;gap:7px}

    /* ---- shared pieces the sheets and payments were born with */
    .pay-stream{margin-bottom:10px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}.pay-stream__head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.pay-stream__head>span{display:grid;min-width:0}.pay-stream__head b{font-size:13px}.pay-stream__head small{color:var(--muted);font-size:11px}.pay-stream__head .num{text-align:right}
    .payments-meter{height:6px;margin:8px 0 4px;border-radius:999px;background:var(--line);overflow:hidden}.payments-meter__fill{height:100%;background:var(--ok);border-radius:999px;transition:width .2s ease}
    .instalments{list-style:none;margin:0;padding:0}.instalments li{display:grid;grid-template-columns:22px minmax(0,1fr) auto;align-items:center;gap:8px;padding:7px 0}.instalments i{display:grid;width:20px;height:20px;place-items:center;border-radius:50%;background:var(--line);color:var(--muted);font-size:11px;font-style:normal;font-weight:800}.instalments__item--paid i{background:var(--ok-soft);color:var(--ok)}.instalments__item--due i{background:var(--warn-soft);color:var(--warn)}.instalments__what{display:grid;min-width:0}.instalments__what b{font-size:12.5px;font-weight:650}.instalments__what small{color:var(--muted);font-size:11px}.instalments__item--due .instalments__what small{color:var(--warn);font-weight:650}.instalments__item--paid .instalments__what b{color:var(--muted);text-decoration:line-through}
    .pay-line{display:grid;grid-template-columns:minmax(0,1fr) auto 24px;align-items:center;gap:8px;padding:6px 0;border-top:1px solid var(--line)}.pay-line__what{display:grid;min-width:0}.pay-line__what b{font-size:12.5px;font-weight:650}.pay-line__what small{color:var(--muted);font-size:11px}.pay-line__amount{font-weight:700;font-size:13px}.pay-line__remove{width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:var(--muted);font-size:16px;line-height:1;cursor:pointer}.pay-line__remove:hover{background:var(--danger-soft);color:var(--danger)}.pay-stream__add{display:block;width:100%;margin-top:6px;padding:7px 0;border:0;background:transparent;color:var(--rose-dark);font:inherit;font-size:12.5px;font-weight:650;text-align:left;cursor:pointer}.pay-stream__done{margin:8px 0 2px;color:var(--ok);font-size:12.5px;font-weight:650}
    .files-list{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}.files-list li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)}.files-list__name{display:grid;min-width:0}.files-list__name b{font-size:12.5px;font-weight:650}.files-list__name small{color:var(--muted);font-size:11px}.files-list__rename{flex:1;min-width:0}.files-list__actions{display:flex;align-items:center;gap:6px}.files-list__pencil{width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--muted);cursor:pointer}.files-list__pencil:hover{background:var(--surface-2);color:var(--ink)}
    .pay-chips{display:flex;flex-wrap:wrap;gap:6px}.pay-chip{display:grid;min-width:72px;padding:8px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface);font:inherit;font-size:13px;font-weight:700;text-align:left;cursor:pointer}.pay-chip small{color:var(--muted);font-size:11px;font-weight:500}.pay-chip:hover{border-color:var(--rose-line);background:var(--rose-soft)}
    .receive-balance{display:grid;gap:8px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}.receive-balance b{font-size:13px}.receive-balance small{display:block;color:var(--muted);font-size:11.5px}.receive-balance__final{display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer}.receive-balance__final input{width:18px;height:18px;accent-color:var(--rose)}
    .receive-preview{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;margin:10px 0;border:1px solid var(--line);border-radius:12px;background:var(--line);overflow:hidden}.receive-preview>span{display:grid;padding:9px 10px;background:var(--surface)}.receive-preview small{color:var(--muted);font-size:9px;text-transform:uppercase}.receive-preview b{font-size:12.5px}.receive-preview>p{grid-column:1/-1;padding:8px 10px;background:var(--warn-soft);color:var(--ink-2);font-size:10.5px}
    .receive-lines{display:grid;gap:8px}.receive-line{display:grid;grid-template-columns:minmax(0,1fr) 110px 110px;gap:8px 10px;align-items:end;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}.receive-line--short{border-color:#eddcb9;background:var(--warn-soft)}.receive-line--damaged{border-color:#f1c8c4}.receive-line__name{display:grid;min-width:0}.receive-line__name b{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.receive-line__name small{color:var(--muted);font-size:11px}.receive-line__field{display:grid;gap:3px}.receive-line__field span{color:var(--muted);font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}.receive-line__note{grid-column:1/-1;color:var(--warn);font-size:11.5px;font-weight:650}
    .hint--warn{color:var(--danger);font-weight:650}

    @media(max-width:1380px){.desk-body{grid-template-columns:minmax(0,1fr) 320px}.c-money:not(.c-money--total){display:none}.c-product{min-width:180px}.c-price{width:156px}.c-qty{width:76px}.c-cartons{width:80px}}
    @media(max-width:1180px){.desk-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}
    @media(max-width:980px){.desk{padding-inline:14px}.desk-hero__top{flex-direction:column}.desk-status{justify-content:flex-start;max-width:none}.desk-body{grid-template-columns:1fr}.desk-rail{position:static;max-height:none}.c-money:not(.c-money--total){display:table-cell}}
  `],
})
export class PurchaseDesk extends PurchaseEditor {
  /** Which drawer of the rail is open; the order facts first, as on paper. */
  readonly railTab = signal<RailTab>('order');

  /** Families folded shut in the table - a long container reads better by series. */
  private readonly foldedFamilies = signal<Set<string>>(new Set());

  /** True when at least one product series can be folded. */
  readonly hasFamilies = computed(() => this.lineSections()
    .some((section) => section.families.some((family) => family.familyId !== null)));

  familyFolded(key: string): boolean {
    return this.foldedFamilies().has(key);
  }

  toggleFamily(key: string): void {
    this.foldedFamilies.update((folded) => {
      const next = new Set(folded);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }
}
