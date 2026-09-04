import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, signal } from '@angular/core';
import { LandedCostLine, Product } from '../../core/api/models';
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
import { FilePicker } from '../../shared/file-picker';
import { PurchaseEditor } from './purchase-editor';
import { PurchaseDeskPicker } from './purchase-desk-picker';
import { stripColour } from './purchase-desk-format';
import { messageOf } from '../../core/api/errors';

type RailTab = 'order' | 'costs' | 'pay' | 'files' | 'done';

type DeskRow =
  | { kind: 'section'; key: string; label: string; count: number }
  | { kind: 'group'; key: string; groupKey: string; label: string; lines: LandedCostLine[]; pieces: number;
      cartons: number; cbm: number; goodsEur: number; averageUnitEur: number; totalEur: number; leadProductId: number }
  | { kind: 'line'; key: string; line: LandedCostLine; variant: boolean };

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
            PurchasePdfSheet, PurchaseActivity, PurchaseDeskPicker, EurPipe, CurPipe, NumPipe, PctPipe, CbmPipe, DateNlPipe, FilePicker],
  template: `
    @if (view(); as data) {
      <app-page-header [title]="data.order.number"
                       [subtitle]="data.order.alias ? data.order.alias + ' · ' + supplierName() : supplierName()"
                       [showBack]="true" [showBell]="false"
                       [titleEditable]="true"
                       (titleChange)="patch({ number: $event })">
        @if (editing()) {
          <button class="btn btn--sm" type="button" [disabled]="saving()" (click)="cancelEdit()">Annuleren</button>
          <button class="btn btn--primary btn--sm" type="button" [disabled]="saving() || !dirty()" (click)="saveAndClose()">
            {{ saving() ? 'Bezig…' : 'Opslaan' }}
          </button>
        } @else {
          <button class="btn btn--sm" type="button" (click)="pdfOpen.set(true)"
                  [attr.aria-label]="'Download ' + data.order.number + ' als PDF'">PDF</button>
          <button class="btn btn--primary btn--sm" type="button" (click)="startEdit()">Bewerken</button>
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
                <p>{{ data.costing.lines.length }} regels · {{ data.costing.totals.pieces | num }} stuks · {{ data.costing.totals.cartons | num }} dozen · {{ data.costing.totals.cbm | cbm }}</p>
              </div>
              <span class="per-toggle" role="group" aria-label="Bedragen tonen als">
                <button type="button" [class.on]="perPiece()" [attr.aria-pressed]="perPiece()" (click)="perPiece.set(true)">Per stuk</button>
                <button type="button" [class.on]="!perPiece()" [attr.aria-pressed]="!perPiece()" (click)="perPiece.set(false)">Totaal</button>
              </span>
              @if (editing() && !isReceived()) {
                <button class="btn btn--primary btn--sm" type="button" (click)="openAdd()">
                  <span aria-hidden="true">＋</span> Product
                </button>
              }
            </div>

            @if (data.costing.lines.length) {
              <div class="desk-table-wrap">
              <table class="desk-table" [class.desk-table--editing]="editing()">
                <thead>
                  <tr>
                    <th class="c-product">Product</th>
                    <th class="c-qty">Aantal</th>
                    <th class="c-cartons">Dozen</th>
                    <th class="c-price">Prijs / stuk</th>
                    <th class="c-money">Goederen{{ perPiece() ? ' / stuk' : '' }}</th>
                    <th class="c-money">{{ perPiece() ? 'Geland / stuk' : 'Totaal geland' }}</th>
                    @if (editing()) { <th class="c-act"><span class="sr-only">Acties</span></th> }
                  </tr>
                </thead>
                <tbody>
                @for (row of tableRows(); track row.key) {
                  @switch (row.kind) {
                    @case ('section') {
                      <tr class="desk-section__row"><th [attr.colspan]="editing() ? 7 : 6">{{ row.label }} <small>{{ row.count }} product{{ row.count === 1 ? '' : 'en' }}</small></th></tr>
                    }
                    @case ('group') {
                      <tr class="desk-group" [class.desk-group--folded]="familyFolded(row.groupKey)">
                        <td class="c-product">
                          <button class="desk-group__toggle" type="button" (click)="toggleFamily(row.groupKey)"
                                  [attr.aria-expanded]="!familyFolded(row.groupKey)">
                            <i class="desk-group__chev" aria-hidden="true">›</i>
                            @if (photoOf(row.leadProductId); as photo) {
                              <img class="desk-product__photo" [appAuthSrc]="photo" alt="" draggable="false" />
                            } @else {
                              <span class="desk-product__photo desk-product__photo--empty" aria-hidden="true">◈</span>
                            }
                            <span class="desk-product__copy">
                              <strong>{{ row.label }}</strong>
                              <small>Reeks · {{ row.lines.length }} varianten · {{ row.cbm | cbm }}</small>
                            </span>
                          </button>
                        </td>
                        <td class="c-qty num"><b>{{ row.pieces | num }}</b></td>
                        <td class="c-cartons num"><b>{{ row.cartons | num }}</b></td>
                        <td class="c-price"></td>
                        <td class="c-money num">{{ (perPiece() && row.pieces > 0 ? row.goodsEur / row.pieces : row.goodsEur) | eur: decimals() }}</td>
                        <td class="c-money num c-money--total">{{ perPiece() ? (row.averageUnitEur | eur: 4) : (row.totalEur | eur) }}</td>
                        @if (editing()) { <td class="c-act"></td> }
                      </tr>
                    }
                    @case ('line') {
                      @let line = row.line;
                      <tr class="desk-row" [class.desk-row--open]="lineOpen(line.productId)" [class.desk-row--variant]="row.variant">
                        <td class="c-product">
                          <div class="desk-product">
                            <a class="desk-product__photo-link" [routerLink]="['/products', line.productId]" [title]="line.productName + ' openen'" tabindex="-1">
                              @if (photoOf(line.productId); as photo) {
                                <img class="desk-product__photo" [appAuthSrc]="photo" alt="" draggable="false" />
                              } @else {
                                <span class="desk-product__photo desk-product__photo--empty" aria-hidden="true">{{ purchaseLineNumber(line.productId) }}</span>
                              }
                            </a>
                            <div class="desk-product__copy">
                              <a class="desk-product__name" [routerLink]="['/products', line.productId]" [title]="line.productName + ' openen'">
                                @if (row.variant) {
                                  <strong>
                                    @if (productColour(line.productId)) {
                                      <i class="line-colour-dot" [class.line-colour-dot--empty]="!productColourHex(line.productId)"
                                         [style.background]="productColourHex(line.productId) || 'transparent'" aria-hidden="true"></i>
                                    }{{ productVariantLabel(line.productId) || line.productName }}
                                  </strong>
                                  <small>{{ baseName(line.productName, line.productId) }}</small>
                                } @else {
                                  <strong>{{ baseName(line.productName, line.productId) }}</strong>
                                }
                              </a>
                              <div class="desk-product__meta">
                            @if (!row.variant && productVariantLabel(line.productId); as variant) {
                              <span>
                                @if (productColour(line.productId)) {
                                  <i class="line-colour-dot" [class.line-colour-dot--empty]="!productColourHex(line.productId)"
                                     [style.background]="productColourHex(line.productId) || 'transparent'" aria-hidden="true"></i>
                                }{{ variant }}
                              </span>
                            }
                            @if (editing() && !isReceived() && cartonNotice(draftQuantity(line.productId, line.quantity), line.productId); as note) {
                              <span role="status">{{ note }}</span>
                            }
                            @if (shortShipped(line.productId); as ordered) {
                              <span class="is-warn">Besteld {{ ordered | num }} → ontvangen {{ line.quantity | num }}</span>
                            }
                            @if (isReceived()) {
                              <button class="desk-product__link" type="button" (click)="openIssue(line.productId)">Schade of tekort melden ›</button>
                            }
                              </div>
                            </div>
                          </div>
                        </td>
                        <td class="c-qty num">
                          @if (editing() && !isReceived()) {
                            <input class="input num right desk-cell" type="number" min="0" step="1" inputmode="numeric"
                                   [attr.aria-label]="'Aantal ' + line.productName"
                                   [ngModel]="quantityValue(line.productId, line.quantity)"
                                   (ngModelChange)="typeQuantity(line.productId, $event)"
                                   (blur)="leaveQuantity(line.productId)" />
                          } @else {
                            <b>{{ line.quantity | num }}</b>
                          }
                        </td>
                        <td class="c-cartons num">
                          <b>{{ line.cartons | num }}</b>
                          <small>{{ piecesPerCarton(line.productId) | num }}/doos · {{ line.cbm | cbm }}</small>
                        </td>
                        <td class="c-price">
                          @if (editing()) {
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
                              <select class="desk-mini desk-mini--last" aria-label="Wat de prijs dekt"
                                      [ngModel]="orderLine(line.productId)?.priceBasis ?? 'EXW'"
                                      (ngModelChange)="setPriceBasis(line.productId, $event)">
                                <option value="EXW">EXW</option><option value="DDP">DDP</option>
                              </select>
                            </div>
                          } @else {
                            <b class="num">{{ unitPriceOf(line) | cur: effectiveExwCurrency(line.productId) }}</b>
                            <small>{{ orderLine(line.productId)?.priceBasis ?? 'EXW' }}</small>
                          }
                        </td>
                        <td class="c-money num">{{ amt(line.goodsEur, line) | eur: decimals() }}</td>
                        <td class="c-money num c-money--total">
                          <button class="desk-total" type="button" (click)="toggleLine(line.productId)"
                                  [attr.aria-expanded]="lineOpen(line.productId)" [title]="'Kostopbouw van ' + line.productName">
                            <b>{{ perPiece() ? (line.landedUnitEur | eur: 4) : (line.totalEur | eur) }}</b>
                            <small>detail <i aria-hidden="true">›</i></small>
                          </button>
                        </td>
                        @if (editing()) {
                          <td class="c-act">
                            <button class="desk-remove" type="button" [disabled]="isReceived()"
                                    [attr.aria-label]="'Verwijder ' + line.productName" (click)="removeLine(line.productId)">×</button>
                          </td>
                        }
                      </tr>
                      @if (lineOpen(line.productId)) {
                        <tr class="desk-detail">
                          <td [attr.colspan]="editing() ? 7 : 6">
                            <div class="desk-detail__grid">
                              <div class="desk-detail__head"><span>Kostopbouw</span><span>{{ perPiece() ? 'per stuk' : 'hele regel · ' + (line.quantity | num) + ' st' }}</span></div>
                              <div class="desk-detail__line"><span>Goederen <small>{{ line.goodsUsd | cur: 'USD' }}</small></span><span>{{ amt(line.goodsEur, line) | eur: decimals() }}</span></div>
                              @if (line.originEur) {
                                <div class="desk-detail__line"><span>{{ costLabels().originCostsLabel }} <small>{{ costLabels().originRoute }}</small></span><span>{{ amt(line.originEur, line) | eur: decimals() }}</span></div>
                              }
                              @if (line.freightEur) {
                                <div class="desk-detail__line"><span>{{ costLabels().seaFreightLabel }} <small>{{ costLabels().seaFreightRoute }}</small></span><span>{{ amt(line.freightEur, line) | eur: decimals() }}</span></div>
                              }
                              <div class="desk-detail__line desk-detail__line--sub"><span>Douanewaarde</span><span>{{ amt(line.customsValueEur, line) | eur: decimals() }}</span></div>
                              <div class="desk-detail__line"><span>Invoerrecht {{ line.dutyRatePct | pct: 1 }} <small>{{ line.dutySource }}</small></span><span>{{ amt(line.dutyEur, line) | eur: decimals() }}</span></div>
                              @if (line.destinationEur) {
                                <div class="desk-detail__line"><span>{{ costLabels().destinationCostsLabel }}</span><span>{{ amt(line.destinationEur, line) | eur: decimals() }}</span></div>
                              }
                              @if (line.extraRevenueEur) {
                                <div class="desk-detail__line"><span>Enrosed kost</span><span>{{ amt(line.extraRevenueEur, line) | eur: decimals() }}</span></div>
                              }
                              <div class="desk-detail__line desk-detail__line--total"><span>Geland</span><span>{{ perPiece() ? (line.landedUnitEur | eur: 4) : (line.totalEur | eur) }}</span></div>
                            </div>
                          </td>
                        </tr>
                      }
                    }
                  }
                }
                </tbody>
                <tfoot>
                  <tr>
                    <th class="c-product">Totaal</th>
                    <th class="c-qty num">{{ data.costing.totals.pieces | num }}</th>
                    <th class="c-cartons num">{{ data.costing.totals.cartons | num }}</th>
                    <th class="c-price"></th>
                    <th class="c-money num">{{ data.costing.totals.goodsEur | eur }}</th>
                    <th class="c-money num c-money--total">{{ data.costing.totals.totalEur | eur }}</th>
                    @if (editing()) { <th class="c-act"></th> }
                  </tr>
                </tfoot>
              </table>
              </div>
            } @else {
              <div class="empty desk-empty">
                <div class="empty__icon" aria-hidden="true">◈</div>
                <div class="empty__title">Bouw je container op</div>
                <p class="empty__text">Voeg producten toe. Aantallen, dozen en containervulling worden direct doorgerekend.</p>
                @if (editing()) {
                  <button class="btn btn--primary" type="button" [disabled]="isReceived()" (click)="openPicker()">Eerste product toevoegen</button>
                } @else {
                  <button class="btn btn--primary" type="button" (click)="startEdit()">Bewerken</button>
                }
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
                  @if (!editing()) {
                    <div class="desk-panel__head"><strong>Ordergegevens</strong><button class="linklike" type="button" (click)="startEdit()">Bewerken</button></div>
                  }
                  <div class="desk-supplier">
                    <span class="desk-supplier__mark" aria-hidden="true">{{ supplierName().charAt(0) }}</span>
                    <span class="desk-supplier__copy">
                      <strong>{{ supplierName() }}</strong>
                      <app-supplier-address [supplier]="supplier()" [inline]="true" [showEmpty]="true" />
                    </span>
                    <small class="desk-supplier__cur">{{ supplier()?.currency }}</small>
                  </div>
                  @if (!editing()) {
                    <dl class="desk-facts">
                      <div><dt>Herkenbare naam</dt><dd>{{ data.order.alias || '—' }}</dd></div>
                      <div><dt>Orderdatum</dt><dd>{{ data.order.orderDate | dateNl }}</dd></div>
                      @if (isReceived() && data.order.receivedOn) { <div><dt>Ontvangen op</dt><dd>{{ data.order.receivedOn | dateNl }}</dd></div> }
                      @else { <div><dt>Verwacht op</dt><dd>{{ data.order.expectedArrival ? (data.order.expectedArrival | dateNl) : '—' }}</dd></div> }
                      <div><dt>Betaalafspraak</dt><dd>{{ paymentTermsLabel(data.order.paymentTerms) }}</dd></div>
                      @if (data.order.status !== 'CONCEPT') { <div><dt>Track &amp; trace</dt><dd>{{ data.order.trackingReference || '—' }}@if (data.order.shippedOn) { <small>vertrokken {{ data.order.shippedOn | dateNl }}</small> }</dd></div> }
                      <div><dt>Container</dt><dd>{{ containerLabel(data.order.containerType) }}</dd></div>
                      <div><dt>Route</dt><dd>{{ costLabels().loadingPort }} → {{ data.order.destinationPort || 'Rotterdam' }}</dd></div>
                      <div><dt>Lossen op</dt><dd>{{ receivingLocationName(data.order.receivingLocationId) }}</dd></div>
                    </dl>
                  } @else {
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
                }

                @case ('costs') {
                  @if (!editing()) {
                    <div class="desk-panel__head"><strong>Kosten &amp; koersen</strong><button class="linklike" type="button" (click)="startEdit()">Bewerken</button></div>
                    <div class="desk-rates">
                      <div><small>RMB → USD</small><b>{{ data.order.cnyToUsd }}</b></div>
                      <div><small>USD → EUR</small><b>{{ usdToEurRate() }}</b></div>
                      <div><small>Prijsbasis</small><b>{{ isDdp() ? 'DDP' : 'EXW' }}</b></div>
                    </div>
                    @if (!isDdp()) {
                      <dl class="desk-facts">
                        <div><dt>{{ costLabels().seaFreightLabel }}</dt><dd>{{ data.order.freightUsd | cur: 'USD' }}<small>{{ costLabels().seaFreightRoute }}</small></dd></div>
                        <div><dt>{{ costLabels().originCostsLabel }}</dt><dd>{{ data.order.originCosts | cur: data.order.originCurrency }}<small>{{ costLabels().originRoute }}</small></dd></div>
                        <div><dt>{{ costLabels().destinationCostsLabel }}</dt><dd>{{ data.order.destinationCostsEur | eur }}</dd></div>
                        <div><dt>Invoerrecht zonder HS</dt><dd>{{ data.order.defaultDutyRatePct | pct: 1 }}</dd></div>
                        <div><dt>Varianten</dt><dd>{{ (data.order.groupVariants ?? true) ? 'één kostprijs per reeks' : 'elke variant apart' }}</dd></div>
                      </dl>
                    }
                  }
                  <div class="desk-form">
                    @if (editing()) {
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
                    <div class="field">
                      <label for="dk-inspection">Inspectiekost <span class="opt"></span></label>
                      <div class="input-affix">
                        <input class="input num right" id="dk-inspection" type="number" step="50" min="0" inputmode="decimal" [ngModel]="data.order.inspectionCostEur" (ngModelChange)="patch({ inspectionCostEur: $event === '' || $event === null ? null : +$event })" />
                        <span class="input-affix__suffix">EUR</span>
                      </div>
                      <span class="hint">Apart lijntje, niet in de stukprijs verrekend.</span>
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
                    }

                    <p class="desk-form__group">Opbouw van de gelande kost</p>
                    @if (data.costing.totals.totalEur > 0) {
                      <div class="desk-mix" aria-hidden="true">
                        @for (part of costMix(); track part.key) { <i [class]="'desk-mix__' + part.key" [style.width.%]="part.pct" [title]="part.label"></i> }
                      </div>
                      <ul class="desk-mix__legend">
                        @for (part of costMix(); track part.key) { <li><i [class]="'desk-mix__' + part.key"></i>{{ part.label }} <b>{{ part.pct | num: 0 }}%</b></li> }
                      </ul>
                    }
                    <div class="desk-chain">
                      <div class="desk-chain__row"><i></i><span>{{ isDdp() ? 'Goederen (DDP)' : 'Goederen' }} <small>{{ data.costing.totals.goodsUsd | cur: 'USD' }}</small></span><b>{{ data.costing.totals.goodsEur | eur }}</b></div>
                      @if (!isDdp()) {
                        @if (data.costing.totals.originEur) { <div class="desk-chain__row"><i>+</i><span>{{ costLabels().originCostsLabel }} <small>{{ costLabels().originRoute }}</small></span><b>{{ data.costing.totals.originEur | eur }}</b></div> }
                        <div class="desk-chain__row"><i>+</i><span>{{ costLabels().seaFreightLabel }} <small>{{ costLabels().seaFreightRoute }}</small></span><b>{{ data.costing.totals.freightEur | eur }}</b></div>
                        <div class="desk-chain__row desk-chain__row--sub"><i>=</i><span>Douanewaarde</span><b>{{ data.costing.totals.customsValueEur | eur }}</b></div>
                        <div class="desk-chain__row"><i>+</i><span>Invoerrechten <small>gemiddeld {{ data.costing.totals.effectiveDutyPct | pct: 1 }}</small></span><b>{{ data.costing.totals.dutyEur | eur }}</b></div>
                        <div class="desk-chain__row"><i>+</i><span>{{ costLabels().destinationCostsLabel }}</span><b>{{ data.costing.totals.destinationEur | eur }}</b></div>
                      }
                      @if (data.costing.totals.extraRevenueEur) { <div class="desk-chain__row"><i>+</i><span>Enrosed kost <small>eigen opslag</small></span><b>{{ data.costing.totals.extraRevenueEur | eur }}</b></div> }
                      <div class="desk-chain__row desk-chain__row--total"><i>=</i><span>Totaal geland <small>{{ data.costing.totals.averageUnitEur | eur: 4 }} per stuk</small></span><b>{{ data.costing.totals.totalEur | eur }}</b></div>
                      @if (data.costing.totals.inspectionEur) {
                        <div class="desk-chain__row"><i>+</i><span>Inspectie <small>apart, niet in de stukprijs</small></span><b>{{ data.costing.totals.inspectionEur | eur }}</b></div>
                        <div class="desk-chain__row desk-chain__row--total"><i>=</i><span>Totaal incl. inspectie</span><b>{{ data.costing.totals.totalWithInspectionEur | eur }}</b></div>
                      }
                    </div>
                    @if (!isDdp() && data.costing.totals.goodsEur > 0) {
                      <div class="desk-overhead">
                        <span>Bovenop de goederen</span>
                        <b>+ {{ data.costing.totals.totalEur - data.costing.totals.goodsEur | eur }}</b>
                        <em>{{ overheadPct(data.costing.totals) | num: 0 }} % van de inkoop</em>
                      </div>
                    }
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
                  @if (data.costing.totals.extraRevenueEur) {
                    <div class="pay-note">
                      <span><b>Enrosed kost</b><small>eigen opslag · geen betaling</small></span>
                      <span class="num">{{ data.costing.totals.extraRevenueEur | eur }}</span>
                    </div>
                  }
                }

                @case ('files') {
                  <div class="desk-dossier">
                    <section>
                      <header class="desk-dossier__head"><strong>Dagboek</strong>
                        <button class="linklike" type="button" (click)="noteEditing.set(!noteEditing())">{{ noteEditing() ? 'Klaar' : 'Bewerken' }}</button></header>
                      @if (noteEditing()) {
                        <textarea class="textarea" rows="7" [ngModel]="data.order.notes" (ngModelChange)="patch({ notes: $event })"
                                  placeholder="Afspraken, laadinstructies of aandachtspunten - ontvangst, bijboeken en betalingen schrijven zich hier vanzelf bij"></textarea>
                      } @else if (data.order.notes) {
                        <div class="desk-dossier__diary"><app-diary [notes]="data.order.notes" /></div>
                      } @else {
                        <p class="desk-dossier__empty">Nog leeg — ontvangst, bijboeken en betalingen schrijven zich hier vanzelf bij.</p>
                      }
                    </section>
                    <section>
                      <header class="desk-dossier__head"><strong>Documenten <small>{{ (documents() ?? []).length }}</small></strong>
                        <button class="btn btn--sm" type="button" (click)="openDocument()">+ Document</button></header>
                      <button class="desk-drop" type="button" (click)="openDocument()" (dragover)="$event.preventDefault()" (drop)="dropDocument($event)">
                        <b>Sleep een bestand hierheen</b><small>of klik om te kiezen · PDF, foto of Office, tot 25 MB</small>
                      </button>
                      @if (documents(); as docs) {
                        @if (docs.length) {
                          <ul class="desk-docs">
                            @for (doc of docs; track doc.id) {
                              <li>
                                <span class="desk-docs__kind">{{ doc.kindLabel }}</span>
                                @if (renamingDoc()?.id === doc.id) {
                                  <input class="input input--sm" type="text" enterkeyhint="done" placeholder="Titel, bijv. KBC mei"
                                         [ngModel]="renamingDoc()!.label" (ngModelChange)="renamingDoc.set({ id: doc.id, label: $event })"
                                         (keydown.enter)="commitDocRename(doc)" (keydown.escape)="renamingDoc.set(null)" (blur)="commitDocRename(doc)" />
                                } @else {
                                  <span class="desk-docs__copy">
                                    <b>{{ doc.label || doc.originalFilename }}</b>
                                    <small>{{ doc.label ? doc.originalFilename + ' · ' : '' }}{{ sizeLabel(doc.sizeBytes) }} · {{ doc.addedAt | dateNl }}@if (doc.actor) { · {{ actorLabel(doc.actor) }} }</small>
                                  </span>
                                }
                                <span class="desk-docs__actions">
                                  <button class="desk-docs__icon" type="button" title="Titel aanpassen" (click)="renamingDoc.set({ id: doc.id, label: doc.label ?? '' })">✎</button>
                                  <button class="btn btn--sm" type="button" (click)="downloadDocument(doc)">Openen</button>
                                  <button class="desk-docs__icon" type="button" title="Verwijderen" aria-label="Document verwijderen" (click)="removeDocument(doc)">×</button>
                                </span>
                              </li>
                            }
                          </ul>
                        }
                      }
                    </section>
                    <section>
                      <header class="desk-dossier__head"><strong>Logboek</strong></header>
                      <app-purchase-activity [orderId]="data.order.id" [collapsible]="true" />
                    </section>
                  </div>
                }

                @case ('done') {
                  <div class="desk-done">
                    <ol class="desk-milestones">
                      @for (step of milestones(); track step.key) {
                        <li [class.is-done]="step.done" [class.is-now]="step.now">
                          <i aria-hidden="true">{{ step.done ? '✓' : '' }}</i>
                          <span><b>{{ step.label }}</b><small>{{ step.date ? (step.date | dateNl) + (step.text ? ' · ' + step.text : '') : step.text }}</small></span>
                        </li>
                      }
                    </ol>
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
                    @if (nextStep(); as step) {
                      <button class="btn btn--primary btn--block desk-done__cta" type="button" (click)="advanceStatus()">{{ step.action }} ›</button>
                    } @else if (isReceived() && !(data.order.stockBooked ?? true)) {
                      <button class="btn btn--primary btn--block desk-done__cta" type="button" [disabled]="booking()" (click)="bookStock()">{{ booking() ? 'Bezig…' : 'Voorraad bijboeken ›' }}</button>
                    }
                    <div class="desk-actions">
                      <button class="desk-action" type="button" (click)="apply()"><span><b>{{ costsApplied() ? 'Kostprijzen opnieuw toepassen' : 'Kostprijzen toepassen' }}</b><small>Zet de gelande kost per stuk op de productkaarten.</small></span><i aria-hidden="true">›</i></button>
                      <button class="desk-action" type="button" (click)="duplicate()"><span><b>Container kopiëren</b><small>Nieuwe calculatie met dezelfde producten en kosten.</small></span><i aria-hidden="true">›</i></button>
                      <button class="desk-action" type="button" (click)="pdfOpen.set(true)"><span><b>PDF maken</b><small>Voor de leverancier, of als intern dossier.</small></span><i aria-hidden="true">›</i></button>
                    </div>
                    @if (!isReceived()) {
                      <details class="desk-danger">
                        <summary>Meer acties</summary>
                        <p>Verwijderen kan niet ongedaan worden gemaakt.</p>
                        <button class="btn btn--danger btn--block" type="button" (click)="remove()">Calculatie verwijderen</button>
                      </details>
                    }
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

      @if (adding()) {
        <app-purchase-desk-picker [products]="available()" [categoryList]="categories()" [supplierName]="supplierName()"
                                  (picked)="addPicked($event)" (create)="newProduct()" (closed)="adding.set(false)" />
      }

      @if (stepPrompt(); as prompt) {
        <app-sheet [title]="prompt.to === 'ONDERWEG' ? 'Container vertrokken' : 'Bestelling vastleggen'" (closed)="stepPrompt.set(null)">
          <div body>
            @if (prompt.to === 'ONDERWEG') {
              <p>De container van <b>{{ supplierName() }}</b> gaat op <b>onderweg</b>: {{ data.costing.totals.pieces | num }} stuks in {{ data.costing.totals.cartons | num }} dozen,
                verwacht {{ data.order.expectedArrival ? (data.order.expectedArrival | dateNl) : 'op een nog onbekende datum' }}.</p>
              <div class="field mt-12">
                <label for="step-tracking">Track &amp; trace <span class="opt"></span></label>
                <input class="input" id="step-tracking" placeholder="Containernummer of link van de rederij"
                       [ngModel]="prompt.tracking" (ngModelChange)="stepPrompt.set({ ...prompt, tracking: $event })" />
                <span class="hint">De vertrekdatum wordt vandaag; volgens de betaalafspraak valt nu de volgende termijn.</span>
              </div>
              <div class="form-grid mt-12">
                <div class="field">
                  <label for="step-bl">Bill of lading <span class="opt"></span></label>
                  <input class="input" id="step-bl" placeholder="B/L-nummer van de rederij"
                         [ngModel]="prompt.billOfLading" (ngModelChange)="stepPrompt.set({ ...prompt, billOfLading: $event })" />
                </div>
                <div class="field">
                  <label for="step-bl-file">B/L-document <span class="opt"></span></label>
                  <input class="input" id="step-bl-file" type="file" accept=".pdf,.jpg,.jpeg,.png"
                         (change)="stepPrompt.set({ ...prompt, billFile: $any($event.target).files?.[0] ?? null })" />
                </div>
                <span class="hint span-2">Het document komt als "Bill of lading" bij de documenten van dit dossier, met het nummer als omschrijving. Zonder document bewaren we het nummer als track &amp; trace.</span>
              </div>
            } @else {
              <p>Hiermee leg je de bestelling bij <b>{{ supplierName() }}</b> vast: de aantallen en prijzen van dit moment gelden als besteld.</p>
              <dl class="desk-facts mt-12">
                <div><dt>Producten</dt><dd>{{ data.costing.lines.length }} regels · {{ data.costing.totals.pieces | num }} stuks · {{ data.costing.totals.cartons | num }} dozen</dd></div>
                <div><dt>Goederen</dt><dd>{{ data.costing.totals.goodsEur | eur }} <small>{{ data.costing.totals.goodsUsd | cur: 'USD' }}</small></dd></div>
                <div><dt>Totaal geland</dt><dd>{{ data.costing.totals.totalEur | eur }} <small>{{ data.costing.totals.averageUnitEur | eur: 4 }} per stuk</small></dd></div>
                <div><dt>Betaalafspraak</dt><dd>{{ paymentTermsLabel(data.order.paymentTerms) }}</dd></div>
              </dl>
              @if (dirty()) { <p class="hint mt-8">Je openstaande wijzigingen worden hierbij mee opgeslagen.</p> }
            }
          </div>
          <div foot style="display:contents">
            <button class="btn" type="button" (click)="stepPrompt.set(null)">Annuleren</button>
            <span class="spacer"></span>
            <button class="btn btn--primary" type="button" [disabled]="saving()" (click)="confirmAdvance()">
              {{ saving() ? 'Bezig…' : (prompt.to === 'ONDERWEG' ? 'Bewaren' : 'Bestelling vastleggen') }}
            </button>
          </div>
        </app-sheet>
      }

      @if (libraryOpen()) {
        <app-file-picker title="Document uit de bibliotheek" (picked)="pickLibraryDocument($event)" (closed)="libraryOpen.set(false)" />
      }
      @if (addingDocument(); as doc) {
        <app-sheet title="Document toevoegen" (closed)="addingDocument.set(null)">
          <div body>
            <div class="form-grid">
              <div class="field">
                <label for="dk-doc-kind">Soort</label>
                <select class="select" id="dk-doc-kind" [ngModel]="doc.kind" (ngModelChange)="addingDocument.set({ ...doc, kind: $event })">
                  @for (kind of documentKinds; track kind.value) { <option [value]="kind.value">{{ kind.label }}</option> }
                </select>
              </div>
              <div class="field">
                <label for="dk-doc-label">Omschrijving <span class="opt"></span></label>
                <input class="input" id="dk-doc-label" placeholder="bijv. KBC 23/08, factuur 2e helft"
                       [ngModel]="doc.label" (ngModelChange)="addingDocument.set({ ...doc, label: $event })" />
              </div>
              @if (doc.kind === 'PAYMENT_PROOF' && paymentsTo('SUPPLIER').length + paymentsTo('LOGISTICS').length) {
                <div class="field span-2">
                  <label for="dk-doc-payment">Hoort bij betaling <span class="opt"></span></label>
                  <select class="select" id="dk-doc-payment" [ngModel]="doc.paymentId ?? ''" (ngModelChange)="addingDocument.set({ ...doc, paymentId: $event ? +$event : null })">
                    <option value="">— geen —</option>
                    @for (payment of payments() ?? []; track payment.id) {
                      <option [value]="payment.id">{{ payment.paidOn | dateNl }} · {{ payment.amountEur | eur }}{{ payment.label ? ' · ' + payment.label : '' }}</option>
                    }
                  </select>
                </div>
              }
              <div class="field span-2">
                <label for="dk-doc-file">Bestand</label>
                <div class="doc-source">
                  <input class="input" id="dk-doc-file" type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx,.csv"
                         (change)="addingDocument.set({ ...doc, file: $any($event.target).files?.[0] ?? null })" />
                  <button class="btn" type="button" (click)="libraryOpen.set(true)">Uit bibliotheek</button>
                </div>
                <span class="hint">{{ doc.file ? doc.file.name + ' · ' : '' }}PDF, foto of Office-bestand, tot 25 MB.</span>
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
            <div class="field mt-8">
              <label for="issue-note">Wat was er mis? <span class="opt"></span></label>
              <textarea class="textarea" id="issue-note" rows="2" placeholder="bijv. glazen stolpen gebarsten, binnendoos te dun"
                        [ngModel]="report.note" (ngModelChange)="issue.set({ ...report, note: $event })"></textarea>
              <span class="hint">Blijft bij het product staan en komt als waarschuwing op de volgende leveranciersorder.</span>
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
                  <span class="hint hint--warn">Let op: dit gaat {{ payingOverage() | eur }} over het afgesproken bedrag heen (bijv. bankkosten of koersverschil). Bewaren kan gewoon.</span>
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
            <button class="btn btn--primary" type="button" [disabled]="payingBusy() || !(pay.amount > 0)" (click)="confirmPayment()">
              {{ payingBusy() ? 'Bezig…' : 'Betaling bewaren' }}
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
            <p class="hint mt-8">Al betaald? Noteer het hier, eventueel met het bankafschrift (max. 5 bestanden). Nog niet? Dan blijft de termijn open staan bij Betalingen.</p>
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
                <span class="hint">Bijv. het KBC-afschrift; hoogstens vijf bestanden.</span>
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
        <app-purchase-ordered-success [orderNumber]="data.order.number" [overviewAvailable]="false" (closed)="closeOrderPlaced()" (overview)="closeOrderPlaced()" />
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
    /* Sheets shared with the editor: note a payment, report damage, first instalment. */
    .pay-chips{display:flex;flex-wrap:wrap;gap:6px}.pay-chip{display:grid;min-width:72px;padding:8px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface);font:inherit;font-size:13px;font-weight:700;text-align:left;cursor:pointer}.pay-chip small{color:var(--muted);font-size:11px;font-weight:500}.pay-chip:hover{border-color:var(--rose-line);background:var(--rose-soft)}
    .issue-kind{margin-top:2px}.line-currency{min-width:74px;border-radius:0}.field .hint--warn{color:var(--danger);font-weight:650}
    :host{display:block;min-width:0}
    .doc-source{display:flex;gap:8px}.doc-source .input{flex:1;min-width:0}

    .desk-table-bar{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line)}
    .pay-note{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 12px;border:1px dashed var(--line-strong);border-radius:12px;color:var(--muted)}
    .pay-note>span:first-child{display:grid}.pay-note b{color:var(--ink-2);font-size:12.5px}.pay-note small{font-size:11px}.pay-note .num{font-weight:700}
    .desk-table-bar>div{flex:1;min-width:0}.desk-table-bar h2{font-size:15px}.desk-table-bar p{color:var(--muted);font-size:11.5px}
    .desk-table-wrap{overflow-x:auto}
    .desk-table{width:100%;min-width:726px;border-collapse:separate;border-spacing:0;table-layout:fixed;font-size:12.5px}.desk-table--editing{min-width:814px}
    .desk-table thead th{padding:9px 10px 9px 12px;border-bottom:1px solid var(--line);background:var(--surface-2);color:var(--muted);font-size:9.5px;font-weight:750;letter-spacing:.04em;text-align:right;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .desk-table thead th.c-product{text-align:left;padding-left:16px}
    .desk-table td{padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:middle;line-height:1.25}
    .desk-table td.c-product{padding-left:16px}
    .c-product{width:34%;min-width:200px}.c-qty{width:68px;text-align:right}.c-cartons{width:90px;text-align:right}.c-price{width:120px}.c-money{width:124px;text-align:right;font-variant-numeric:tabular-nums}.c-act{width:34px}
    .desk-table--editing .c-price{width:168px}.desk-table--editing .c-act{width:40px}
    .c-money--total{font-weight:750;color:var(--rose-dark)}
    .desk-section__row th{padding:12px 16px 5px;color:var(--rose);font-size:10px;font-weight:760;letter-spacing:.1em;text-align:left;text-transform:uppercase;background:var(--surface)}
    .desk-section__row th small{margin-left:6px;color:var(--muted);font-weight:600;letter-spacing:0;text-transform:none}
    .desk-group td{background:var(--surface-2);border-bottom:1px solid var(--line)}
    .desk-group__toggle{display:flex;width:100%;align-items:center;gap:11px;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
    .desk-group__chev{display:inline-block;width:14px;color:var(--muted);font-style:normal;font-size:16px;transform:rotate(90deg);transition:transform .15s ease}
    .desk-group--folded .desk-group__chev{transform:none}
    .desk-group .c-money,.desk-group .c-qty b,.desk-group .c-cartons b{font-weight:750}
    .desk-row--variant td.c-product{padding-left:46px}.desk-row--variant .desk-product__photo{width:36px;height:36px}
    .line-colour-dot{display:inline-block;width:10px;height:10px;margin-right:5px;border:1px solid rgb(0 0 0/.15);border-radius:50%;vertical-align:-1px}.line-colour-dot--empty{background:var(--surface)!important}
    .desk-row:hover td{background:color-mix(in srgb,var(--rose-soft) 45%,var(--surface))}
    .desk-row--open td{border-bottom:0;background:var(--surface-2)}
    .desk-product{display:flex;align-items:center;gap:11px}.desk-product__photo-link{flex:none;line-height:0}.desk-product__copy{display:grid;min-width:0}
    .desk-product__name{color:inherit;text-decoration:none}.desk-product__name:hover strong{text-decoration:underline}
    .desk-product__photo{width:44px;height:44px;flex:none;border:1px solid var(--line);border-radius:11px;object-fit:cover;background:#fff}
    .desk-product__photo--empty{display:grid;place-items:center;background:var(--surface-2);color:var(--muted);font-size:11px;font-weight:700}
    .desk-product__copy{line-height:1.25}.desk-product__copy strong{display:block;font-size:13.5px}.desk-product__copy small{display:block;color:var(--muted);font-size:11px}
    .desk-product__meta{display:flex;flex-wrap:wrap;align-items:center;margin-top:2px;color:var(--muted);font-size:11px}
    .desk-product__meta>*{white-space:nowrap}.desk-product__meta>*:not(:last-child)::after{content:'·';margin:0 6px;color:var(--line-strong)}.desk-product__meta .is-warn{color:var(--warn);font-weight:650}
    .desk-product__link{padding:0;border:0;background:none;color:var(--rose-dark);font:inherit;font-size:11px;font-weight:650;cursor:pointer}.desk-product__link:hover{text-decoration:underline}
    .desk-cell{min-height:34px;padding:5px 12px 5px 8px;font-size:13px}.desk-table--editing td.c-qty,.desk-table--editing td.c-price{padding-right:0}.desk-table--editing td.c-price .desk-cell{padding-right:8px}

    .c-qty b,.c-cartons b,.c-price>b{display:block;font-size:13.5px;font-variant-numeric:tabular-nums}.c-cartons small,.c-price>small{display:block;margin-top:2px;color:var(--muted);font-size:10.5px;white-space:nowrap}.c-cartons small{white-space:normal;line-height:1.2}
    .c-price{text-align:right}
    .desk-price{display:flex}.desk-price .desk-cell{flex:1;min-width:0;border-radius:var(--r-sm) 0 0 var(--r-sm)}
    .desk-mini{width:44px;min-width:0;min-height:34px;padding:0;border:1px solid var(--line-strong);text-align:center;border-left:0;background:var(--surface);color:var(--ink);font:inherit;font-size:11px}
    .desk-mini--last{border-radius:0 var(--r-sm) var(--r-sm) 0}
    .desk-price__hint{display:block;margin-top:2px;color:var(--muted);font-size:10px;white-space:nowrap}
    .desk-remove{width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--muted);font-size:18px;line-height:1;cursor:pointer}
    .desk-total{display:inline-grid;justify-items:end;gap:1px;margin:-4px 0;padding:4px 0 4px 6px;border:0;border-radius:8px;background:transparent;color:var(--rose-dark);font:inherit;font-weight:750;font-variant-numeric:tabular-nums;line-height:1.2;cursor:pointer}
    .desk-total small{display:inline-flex;align-items:center;gap:2px;color:var(--muted);font-size:9px;font-weight:600;letter-spacing:.03em;text-transform:uppercase}
    .desk-total i{display:inline-block;font-style:normal;font-size:12px;font-weight:700;transition:transform .15s ease}.desk-row--open .desk-total i{transform:rotate(90deg)}.desk-total:hover{background:var(--rose-soft)}
    .desk-remove:hover:enabled{background:var(--danger-soft);color:var(--danger)}.desk-remove:disabled{opacity:.35}
    .desk-detail td{padding:0 12px 12px;background:var(--surface-2)}
    .desk-detail__grid{display:grid;gap:0;max-width:560px;margin-left:auto;border:1px solid var(--line);border-radius:12px;background:var(--surface);overflow:hidden}
    .desk-detail__head,.desk-detail__line{display:grid;grid-template-columns:minmax(0,1fr) 130px;gap:10px;padding:6px 12px;font-size:12px}
    .desk-detail__head{color:var(--muted);font-size:9.5px;font-weight:750;letter-spacing:.08em;text-transform:uppercase;background:var(--surface-2)}
    .desk-detail__line span:not(:first-child),.desk-detail__head span:not(:first-child){text-align:right;font-variant-numeric:tabular-nums}
    .desk-detail__line small{display:block;color:var(--muted);font-size:9.5px}
    .desk-detail__line--sub{border-top:1px solid var(--line);font-weight:650}
    .desk-detail__line--total{border-top:2px solid var(--line-strong);font-weight:750}.desk-detail__line--total span:last-child{color:var(--rose-dark)}
    .desk-table tfoot th{padding:11px 10px;border-top:2px solid var(--line-strong);background:var(--surface-2);font-size:13px;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
    .desk-table tfoot th.c-product{text-align:left;padding-left:16px;color:var(--muted);font-size:10px;font-weight:750;letter-spacing:.08em;text-transform:uppercase}

    .desk-supplier{display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:8px 10px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}
    .desk-supplier__mark{display:grid;width:32px;height:32px;flex:none;place-items:center;border-radius:9px;background:var(--rose);color:#fff;font-weight:800}.desk-supplier__copy{display:grid;min-width:0;flex:1;line-height:1.25}.desk-supplier strong{overflow:hidden;font-size:13px;text-overflow:ellipsis;white-space:nowrap}.desk-supplier__cur{align-self:flex-start;padding:2px 7px;border-radius:999px;background:var(--surface);color:var(--muted);font-size:10.5px;font-weight:700}
    .desk-affix-select{min-width:64px;border-radius:0 var(--r-sm) var(--r-sm) 0}
    .desk-sum{padding:8px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}
    .desk-sum .stat-row{padding:4px 0;font-size:12px}.desk-sum .stat-row small{display:block;color:var(--muted);font-size:9.5px;font-weight:500}
    .desk-sum__sub{border-top:1px solid var(--line);font-weight:650}.desk-sum__total{border-top:2px solid var(--line-strong);font-size:13px}.desk-sum__total strong{color:var(--rose-dark)}
    .desk-pay-head{display:grid;gap:2px;margin-bottom:10px}.desk-pay-head strong{font-size:15px}.desk-pay-head small{color:var(--muted);font-size:11.5px}
    .desk-done{display:grid;gap:12px}
    .desk-done__attention{margin:0;padding:8px 12px 8px 26px;border:1px solid #eddcb9;border-radius:12px;background:var(--warn-soft);color:var(--ink-2);font-size:12px}
    .desk-rates{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;margin-bottom:12px;border:1px solid var(--line);border-radius:12px;background:var(--line);overflow:hidden}
    .desk-rates>div{display:grid;gap:1px;padding:9px 12px;background:var(--surface-2)}.desk-rates small{color:var(--muted);font-size:9.5px;font-weight:750;letter-spacing:.08em;text-transform:uppercase}.desk-rates b{font-size:14px;font-variant-numeric:tabular-nums}
    .desk-mix{display:flex;height:12px;border-radius:99px;background:var(--line);overflow:hidden}.desk-mix i{display:block;height:100%}
    .desk-mix__legend{display:flex;flex-wrap:wrap;gap:4px 12px;margin:8px 0 12px;padding:0;list-style:none;color:var(--muted);font-size:11px}.desk-mix__legend li{display:inline-flex;align-items:center;gap:5px}.desk-mix__legend i{width:9px;height:9px;border-radius:2px}.desk-mix__legend b{color:var(--ink-2)}
    .desk-mix__goods{background:var(--rose-dark)}.desk-mix__transport{background:var(--gold)}.desk-mix__duty{background:var(--warn)}.desk-mix__destination{background:var(--blue)}.desk-mix__extra{background:var(--muted)}
    .desk-dossier{display:grid;gap:16px}.desk-dossier__head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}.desk-dossier__head strong{font-size:13px}.desk-dossier__head strong small{margin-left:5px;color:var(--muted);font-weight:600}
    .desk-dossier__diary{padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}.desk-dossier__empty{margin:0;padding:12px;border:1px dashed var(--line-strong);border-radius:12px;color:var(--muted);font-size:12px}
    .desk-drop{display:grid;width:100%;gap:2px;margin-bottom:8px;padding:12px;border:1px dashed var(--line-strong);border-radius:12px;background:var(--surface-2);color:var(--ink-2);font:inherit;text-align:center;cursor:pointer}.desk-drop b{font-size:12.5px}.desk-drop small{color:var(--muted);font-size:11px}.desk-drop:hover{border-color:var(--rose);background:var(--rose-soft)}
    .desk-docs{margin:0;padding:0;list-style:none}.desk-docs li{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;padding:8px 0;border-top:1px solid var(--line)}
    .desk-docs__kind{padding:3px 7px;border-radius:999px;background:var(--rose-soft);color:var(--rose-dark);font-size:10px;font-weight:750;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}
    .desk-docs__copy{display:grid;min-width:0}.desk-docs__copy b{overflow:hidden;font-size:12.5px;text-overflow:ellipsis;white-space:nowrap}.desk-docs__copy small{overflow:hidden;color:var(--muted);font-size:11px;text-overflow:ellipsis;white-space:nowrap}
    .desk-docs__actions{display:flex;align-items:center;gap:4px}.desk-docs__icon{width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--muted);font-size:15px;cursor:pointer}.desk-docs__icon:hover{background:var(--surface-2);color:var(--ink)}
    .desk-milestones{margin:0;padding:0;list-style:none}.desk-milestones li{display:grid;grid-template-columns:24px minmax(0,1fr);gap:10px;padding:6px 0}
    .desk-milestones i{display:grid;width:22px;height:22px;place-items:center;border:2px solid var(--line-strong);border-radius:50%;color:#fff;font-size:11px;font-style:normal;font-weight:800;background:var(--surface)}
    .desk-milestones li.is-done i{border-color:var(--ok);background:var(--ok)}.desk-milestones li.is-now i{border-color:var(--rose)}
    .desk-milestones span{display:grid}.desk-milestones b{font-size:13px}.desk-milestones li:not(.is-done):not(.is-now) b{color:var(--muted);font-weight:600}.desk-milestones small{color:var(--muted);font-size:11px}
    .desk-done__cta{min-height:46px;font-size:14px}
  `],
})
export class PurchaseDesk extends PurchaseEditor {
  /** How the route opened us; the desk itself decides when editing ends. */
  readonly mode = input<'view' | 'edit'>('view');
  /** Reading is the default; Bewerken switches the inputs on. */
  readonly editing = linkedSignal(() => this.mode() === 'edit');

  /** Which drawer of the rail is open; the order facts first, as on paper. */
  readonly railTab = signal<RailTab>('order');

  /** Series folded shut; a long container reads by series first. */
  private readonly foldedFamilies = signal<Set<string>>(new Set());

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

  /**
   * The table, row by row: a category caption only when there are several,
   * a series header with its totals whenever a series has more than one
   * variant, and the lines - indented under their series, or on their own.
   */
  readonly tableRows = computed<DeskRow[]>(() => {
    const sections = this.lineSections();
    const folded = this.foldedFamilies();
    const rows: DeskRow[] = [];
    for (const section of sections) {
      if (sections.length > 1) {
        rows.push({ kind: 'section', key: 's:' + section.key, label: section.label, count: section.lines.length });
      }
      for (const family of section.families) {
        const grouped = family.familyId !== null && family.lines.length > 1;
        if (grouped) {
          rows.push({
            kind: 'group', key: 'g:' + family.key, groupKey: family.key, label: family.label,
            lines: family.lines, pieces: family.pieces, cartons: family.cartons, cbm: family.cbm,
            goodsEur: family.lines.reduce((sum, line) => sum + line.goodsEur, 0),
            averageUnitEur: family.averageUnitEur, totalEur: family.totalEur,
            leadProductId: family.lines[0].productId,
          });
          if (folded.has(family.key)) continue;
        }
        for (const line of family.lines) rows.push({ kind: 'line', key: 'l:' + line.productId, line, variant: grouped });
      }
    }
    return rows;
  });

  /* ---- adding products: the sheet reports a pick, the desk lands the line ---- */
  readonly adding = signal(false);

  openAdd(): void {
    this.adding.set(true);
  }

  addPicked(choice: { product: Product; quantity: number }): void {
    this.addLine(choice);
    this.ui.toast(`${choice.product.name} · ${choice.quantity} st toegevoegd`);
  }

  baseName(name: string, productId: number): string {
    return stripColour(name, this.productColour(productId));
  }

  /** Where the landed euro goes, as shares of the total. */
  readonly costMix = computed(() => {
    const totals = this.view()?.costing.totals;
    if (!totals || totals.totalEur <= 0) return [];
    const parts = [
      { key: 'goods', label: 'Goederen', value: totals.goodsEur },
      { key: 'transport', label: 'Transport & oorsprong', value: totals.originEur + totals.freightEur },
      { key: 'duty', label: 'Invoerrechten', value: totals.dutyEur },
      { key: 'destination', label: 'Aankomst', value: totals.destinationEur },
      { key: 'extra', label: 'Enrosed kost', value: totals.extraRevenueEur },
    ];
    return parts.filter((part) => part.value > 0)
      .map((part) => ({ ...part, pct: (part.value / totals.totalEur) * 100 }));
  });

  /** The container's road, as far as it got. */
  readonly milestones = computed(() => {
    const data = this.view();
    if (!data) return [];
    const order = data.order;
    const index = this.stepIndex(order.status);
    const booked = order.stockBooked === true;
    const steps = [
      { key: 'made', label: 'Calculatie gemaakt', done: true, date: order.orderDate, text: this.creatorName(data) },
      { key: 'ordered', label: 'Besteld', done: index >= 1, date: null as string | null, text: index >= 1 ? 'aantallen en prijzen liggen vast' : 'nog een concept' },
      { key: 'shipped', label: 'Vertrokken', done: index >= 2, date: order.shippedOn ?? null,
        text: index >= 2 ? (order.trackingReference ?? '') : 'nog bij de leverancier' },
      { key: 'received', label: 'Ontvangen', done: index >= 3, date: order.receivedOn ?? null,
        text: index >= 3 ? this.receivingLocationName(order.receivingLocationId)
          : (order.expectedArrival ? 'verwacht ' + order.expectedArrival.split('-').reverse().join('/') : 'nog onderweg') },
      { key: 'booked', label: 'Voorraad bijgeboekt', done: booked, date: null as string | null,
        text: booked ? 'de stuks staan in de voorraad' : (index >= 3 ? 'nog bij te boeken' : 'na ontvangst') },
    ];
    const firstOpen = steps.find((step) => !step.done);
    return steps.map((step) => ({ ...step, now: step === firstOpen }));
  });

  /** A file dropped on the dossier goes straight into the document sheet. */
  dropDocument(event: DragEvent): void {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0] ?? null;
    if (!file) return;
    this.openDocument();
    this.addingDocument.update((draft) => draft ? { ...draft, file } : draft);
  }

  /** Lines whose cost build-up is unfolded under the row. */
  private readonly openLines = signal<Set<number>>(new Set());

  lineOpen(productId: number): boolean {
    return this.openLines().has(productId);
  }

  toggleLine(productId: number): void {
    this.openLines.update((open) => {
      const next = new Set(open);
      if (next.has(productId)) next.delete(productId); else next.add(productId);
      return next;
    });
  }

  /** The agreed price on the line, or the product card's while none is set. */
  unitPriceOf(line: { productId: number; quantity: number; goodsUsd: number }): number {
    const agreed = this.orderLine(line.productId)?.exwPrice;
    if (agreed != null) return agreed;
    return this.productCardPrice(line.productId)?.amount ?? 0;
  }

  paymentTermsLabel(value: string | null | undefined): string {
    return this.paymentTermOptions.find((option) => option.value === (value ?? 'THIRDS'))?.label ?? '—';
  }

  /** The next step waits for a word: nothing changes status from one click. */
  readonly stepPrompt = signal<{ to: 'BESTELD' | 'ONDERWEG'; tracking: string; billOfLading: string; billFile: File | null } | null>(null);

  override advanceStatus(): void {
    const step = this.nextStep();
    const data = this.view();
    if (!data || !step) return;
    if (step.to === 'ONTVANGEN') {
      super.advanceStatus();
      return;
    }
    this.stepPrompt.set({ to: step.to as 'BESTELD' | 'ONDERWEG', tracking: data.order.trackingReference ?? '', billOfLading: '', billFile: null });
  }

  confirmAdvance(): void {
    const prompt = this.stepPrompt();
    const data = this.view();
    if (!prompt || !data) return;
    if (prompt.to === 'ONDERWEG') {
      const bill = prompt.billOfLading.trim();
      this.patch({ trackingReference: prompt.tracking.trim() || bill || null });
      if (prompt.billFile) void this.attachBillOfLading(data.order.id, prompt.billFile, bill);
    }
    this.stepPrompt.set(null);
    super.advanceStatus();
  }

  /** The B/L handed over at departure lands in the dossier's documents, numbered. */
  private async attachBillOfLading(orderId: number, file: File, number: string): Promise<void> {
    try {
      await this.sourcing.addDocument(orderId, file, 'BILL_OF_LADING', number ? `B/L ${number}` : null, null);
      await this.loadDocuments(orderId);
      this.ui.toast('Bill of lading bij de documenten gezet');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Bill of lading opslaan mislukt'), 'err');
    }
  }

  /** The celebration's follow-up, landing where the desk keeps it. */
  override celebrationAction(kind: 'SHIPPED' | 'RECEIVED'): void {
    this.statusCelebration.set(null);
    if (kind === 'RECEIVED') {
      void this.bookStock();
      return;
    }
    this.startEdit();
    this.railTab.set('order');
    setTimeout(() => document.getElementById('dk-tracking')?.focus(), 150);
  }

  startEdit(): void {
    this.editing.set(true);
  }

  /** Back to reading; an unsaved draft is dropped after a word of warning. */
  cancelEdit(): void {
    const data = this.view();
    if (data && this.dirty()) {
      this.ui.confirm({
        title: 'Wijzigingen weggooien?',
        message: 'De aanpassingen van dit moment zijn nog niet opgeslagen.',
        confirmLabel: 'Weggooien',
      }, () => {
        void this.load(data.order.id);
        this.editing.set(false);
      });
      return;
    }
    this.editing.set(false);
  }

  async saveAndClose(): Promise<void> {
    const saved = await this.save();
    if (saved) this.editing.set(false);
  }
}
