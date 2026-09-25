import { PurchaseSalesLinks } from './purchase-sales-links';
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, computed, inject, input, linkedSignal, signal, viewChild } from '@angular/core';
import { LandedCostLine, Payee, Product } from '../../core/api/models';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PageHeader } from '../../shared/page-header';
import { PurchaseQuoteSheet } from './purchase-quote-sheet';
import { PurchasePartnerSheet } from './purchase-partner-sheet';
import { AuctionSettlementSheet } from '../sales/auction-settlement-sheet';
import { SalesCreditNoteSheet } from '../sales/sales-credit-note-sheet';
import { PurchaseExtraSplit } from './purchase-extra-split';
import { PurchasePartnerPanel } from './purchase-partner-panel';
import { PurchasePartnerPayments } from './purchase-partner-payments';
import { PurchaseReconciliation } from './purchase-reconciliation';
import { PurchasePaymentWorkbench } from './purchase-payment-workbench';
import { PurchasePaymentResult } from './purchase-payment-result';
import { purchaseNacalcSummary } from './purchase-payment-result-metrics';
import { PurchasePaymentSheet } from './purchase-payment-sheet';
import { PurchaseSettleSheet } from './purchase-settle-sheet';
import { PurchaseFirstInstalmentSheet } from './purchase-first-instalment-sheet';
import { Segmented, type SegmentOption } from '../../shared/segmented';
import { keyContext } from '../../shared/key-context';
import { PurchasePaymentPlanSheet } from './purchase-payment-plan-sheet';
import { PaymentProofPicker } from '../../shared/payment-proof-picker';
import { Diary } from './diary';
import { ProductPicker } from '../../shared/product-picker';
import { DateField } from '../../shared/date-field';
import { Skeleton } from '../../shared/skeleton';
import { Sheet } from '../../shared/ui';
import { paymentPlanLabel } from './payment-plan';
import { CbmPipe, CurPipe, DateNlPipe, EurPipe, NumPipe, PctPipe, EurUpPipe, NumUpPipe } from '../../shared/pipes';
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
import { STATUS_LABEL } from '../sales/quote-status';

type RailTab = 'order' | 'costs' | 'partner' | 'files' | 'done';

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
 * view. The main pane switches between the products, a real table you can
 * key through, and the payments workbench (⌥1 / ⌥2); everything else -
 * order facts, cost mechanics, partner financing, the dossier, closing the
 * container - lives in one tabbed rail beside the products. The logic is
 * the phone editor's: only the room it gets is different.
 */
@Component({
  selector: 'app-purchase-desk',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PurchaseSalesLinks, Skeleton, PurchaseQuoteSheet, PurchasePartnerSheet, AuctionSettlementSheet, SalesCreditNoteSheet, PurchasePartnerPanel, PurchasePartnerPayments, PurchaseReconciliation, PurchasePaymentWorkbench, PurchasePaymentResult, PurchasePaymentSheet, PurchaseSettleSheet, PurchaseFirstInstalmentSheet, Segmented, PurchasePaymentPlanSheet, PaymentProofPicker, PurchaseExtraSplit, FormsModule, RouterLink, PageHeader, Diary, ProductPicker, DateField, Sheet, AuthImage,
            SupplierAddress, PurchaseOrderedSuccess, PurchaseStatusSuccess,
            PurchasePdfSheet, PurchaseActivity, PurchaseDeskPicker, EurPipe, EurUpPipe, NumUpPipe, CurPipe, NumPipe, PctPipe, CbmPipe, DateNlPipe, FilePicker],
  template: `
    @if (view(); as data) {
      <app-page-header [title]="data.order.number"
                       [subtitle]="data.order.alias ? data.order.alias + ' · ' + supplierName() : supplierName()"
                       [showBack]="true" [showBell]="false"
                       [titleEditable]="true"
                       (titleChange)="patch({ number: $event })">
        @if (editing()) {
          <button class="btn btn--sm" type="button" [disabled]="saving()" (click)="cancelEdit()">Annuleren</button>
          <button class="btn btn--primary btn--sm" type="button" [disabled]="saving() || !dirty() || negativeExtra()" (click)="saveAndClose()">
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
              <span>{{ data.costing.totals.averageUnitEur | eurUp: 3 }} per stuk@if (hasSeparateCosts(data.order) && data.costing.totals.separateCostsEur) { · waarvan {{ data.costing.totals.separateCostsEur | eur: 0 }} inspectie &amp; andere }</span>
            </div>
            @let money = paymentLedger()?.summary;
            <button class="desk-kpi desk-kpi--button" type="button" (click)="showPayments()" [class.is-warn]="(money?.dueNowEur ?? 0) > 0">
              <small>Nu te betalen</small>
              <strong>@if (paymentStateError()) { — } @else { {{ (money?.dueNowEur ?? 0) | eur: 0 }} }</strong>
              <span>@if (paymentStateError()) { Opnieuw laden } @else if (paymentStateLoading() || !money) { Bijwerken… } @else if (data.order.status === 'CONCEPT') { Nog niet besteld } @else if (money.openEur === 0 && money.paidTotalEur > 0) { Alles betaald } @else { {{ money.paidTotalEur | eur: 0 }} betaald@if (money.laterEur > 0) { · {{ money.laterEur | eur: 0 }} later } }</span>
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

        @if (attentionShown().length) {
          <div class="desk-attention" role="status">
            <b>{{ attentionShown().length }}</b>
            <span>@for (item of attentionShown(); track item; let last = $last) {{{ item }}@if (!last) { · }}</span>
            @if (paymentAttention()) { <button class="linklike" type="button" (click)="showPayments()">Betalingen ›</button> }
            <button class="linklike" type="button" (click)="showRail('done')">Bekijken ›</button>
          </div>
        }

        <div class="desk-body" [class.desk-body--payments]="mainView() === 'payments'">
          <!-- ============================ the table: every line, keyed through -->
          <main class="desk-main">
            <div class="desk-viewbar">
              <app-segmented label="Weergave" semantics="tabs" [options]="viewOptions()" [value]="mainView()" (changed)="mainView.set($event === 'payments' ? 'payments' : 'products')" />
            </div>
            @if (mainView() === 'payments') {
              <app-purchase-payment-workbench id="purchase-payments-section" tabindex="-1"
                [ledger]="paymentLedger()" [state]="paymentState()" [error]="paymentStateError()"
                [busy]="payingBusy() || saving() || paymentStateLoading() || payments() === null" [dirty]="dirty()" [saving]="saving()"
                [pdfBusy]="paymentsPdfBusy()" [orderId]="data.order.id" [planLabel]="planLabel(data.order)"
                [partnerLinked]="hasPartnerTab()" [nacalc]="nacalcSummary()"
                (add)="requestPayment($event)" (edit)="requestEdit($event)" (proof)="attachProof($event)" (download)="downloadDocument($event)"
                (settle)="requestSettle($event)" (undoSettle)="requestUndoSettle($event.payee, $event.due)" (planChange)="openPaymentPlan()"
                (move)="requestMove($event.payment, $event.payee)" (remove)="requestRemove($event)" (refresh)="refreshPaymentState()"
                (save)="save()" (exportPdf)="downloadPaymentsPdf()" (openCosts)="$event === 'plan' ? showCosts() : showNacalculatie()" (openPartner)="openPartner()" />
            } @else {
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
                    <th class="c-price">Prijs / stuk <span class="c-price__basis">{{ isDdp() ? 'DDP' : 'EXW' }}</span></th>
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
                        <td class="c-money num">{{ (perPiece() && row.pieces > 0 ? row.goodsEur / row.pieces : row.goodsEur) | eurUp: decimals() }}</td>
                        <td class="c-money num c-money--total">{{ perPiece() ? (row.averageUnitEur | eurUp: 3) : (row.totalEur | eur) }}</td>
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
                              <span class="desk-price__sym" aria-hidden="true">{{ currencySymbol(effectiveExwCurrency(line.productId)) }}</span>
                              <input class="input num right desk-cell" type="number" min="0" step="0.01" inputmode="decimal"
                                     [attr.aria-label]="'Prijs per stuk ' + line.productName + ' in ' + effectiveExwCurrency(line.productId)"
                                     [ngModel]="orderLine(line.productId)?.exwPrice"
                                     [placeholder]="line.quantity ? (line.goodsUsd / line.quantity | numUp: 3) : ''"
                                     (ngModelChange)="setExwPrice(line.productId, $event)" />
                            </div>
                          } @else {
                            <b class="num">{{ currencySymbol(effectiveExwCurrency(line.productId)) }} {{ unitPriceOf(line) | num: 2 }}</b>
                          }
                        </td>
                        <td class="c-money num">{{ amt(line.goodsEur, line) | eurUp: decimals() }}</td>
                        <td class="c-money num c-money--total">
                          <button class="desk-total" type="button" (click)="toggleLine(line.productId)"
                                  [attr.aria-expanded]="lineOpen(line.productId)" [title]="'Kostopbouw van ' + line.productName">
                            <b>{{ perPiece() ? (line.landedUnitEur | eurUp: 3) : (line.totalEur | eur) }}</b>
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
                              <div class="desk-detail__line"><span>Goederen <small>{{ line.goodsUsd | cur: 'USD' }}</small></span><span>{{ amt(line.goodsEur, line) | eurUp: decimals() }}</span></div>
                              @if (line.originEur) {
                                <div class="desk-detail__line"><span>{{ costLabels().originCostsLabel }} <small>{{ costLabels().originRoute }}</small></span><span>{{ amt(line.originEur, line) | eurUp: decimals() }}</span></div>
                              }
                              @if (line.freightEur) {
                                <div class="desk-detail__line"><span>{{ costLabels().seaFreightLabel }} <small>{{ costLabels().seaFreightRoute }}</small></span><span>{{ amt(line.freightEur, line) | eurUp: decimals() }}</span></div>
                              }
                              <div class="desk-detail__line desk-detail__line--sub"><span>Douanewaarde</span><span>{{ amt(line.customsValueEur, line) | eurUp: decimals() }}</span></div>
                              <div class="desk-detail__line"><span>Invoerrecht {{ line.dutyRatePct | pct: 1 }} <small>{{ line.dutySource }}</small></span><span>{{ amt(line.dutyEur, line) | eurUp: decimals() }}</span></div>
                              @if (line.destinationEur) {
                                <div class="desk-detail__line"><span>{{ costLabels().destinationCostsLabel }}</span><span>{{ amt(line.destinationEur, line) | eurUp: decimals() }}</span></div>
                              }
                              @if (line.extraRevenueEur) {
                                <div class="desk-detail__line"><span>Enrosed kost</span><span>{{ amt(line.extraRevenueEur, line) | eurUp: decimals() }}</span></div>
                              }
                              <div class="desk-detail__line desk-detail__line--total"><span>Geland</span><span>{{ perPiece() ? (line.landedUnitEur | eurUp: 3) : (line.totalEur | eur) }}</span></div>
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
            }
          </main>

          <!-- ============================ the rail: everything else, one tab away -->
          <aside class="desk-rail" aria-label="Order, kosten, betalingen en dossier">
            <nav class="desk-tabs" role="tablist">
              <button type="button" role="tab" [class.on]="activeRailTab() === 'order'" [attr.aria-selected]="activeRailTab() === 'order'" (click)="railTab.set('order')">Order</button>
              <button type="button" role="tab" [class.on]="activeRailTab() === 'costs'" [attr.aria-selected]="activeRailTab() === 'costs'" (click)="railTab.set('costs')">Kosten</button>
              @if (hasPartnerTab()) {
                <button type="button" role="tab" [class.on]="activeRailTab() === 'partner'" [attr.aria-selected]="activeRailTab() === 'partner'" (click)="railTab.set('partner')">Partner</button>
              }
              <button type="button" role="tab" [class.on]="activeRailTab() === 'files'" [attr.aria-selected]="activeRailTab() === 'files'" (click)="railTab.set('files')">Dossier</button>
              <button type="button" role="tab" [class.on]="activeRailTab() === 'done'" [attr.aria-selected]="activeRailTab() === 'done'" (click)="railTab.set('done')">Afronden</button>
            </nav>

            <div class="desk-panel">
              @switch (activeRailTab()) {
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
                      <div><dt>Betaalplan</dt><dd>{{ paymentTermsLabel(data.order.paymentTerms) }} <button class="linklike" type="button" (click)="showPayments()">Betalingen ›</button></dd></div>
                      @if (data.order.status !== 'CONCEPT') { <div><dt>Track &amp; trace</dt><dd>{{ data.order.trackingReference || '—' }}@if (data.order.shippedOn) { <small>vertrokken {{ data.order.shippedOn | dateNl }}</small> }</dd></div> }
                      <div><dt>Container</dt><dd>{{ containerLabel(data.order.containerType) }}</dd></div>
                      <div><dt>Route</dt><dd>{{ costLabels().loadingPort }} → {{ data.order.destinationPort || 'Rotterdam' }}</dd></div>
                      <div><dt>Lossen op</dt><dd>{{ receivingLocationName(data.order.receivingLocationId) }}</dd></div>
                      <div><dt>Prijsbasis</dt><dd>{{ isDdp() ? 'DDP, geleverd incl. rechten' : 'EXW, af fabriek' }}<small>stukprijzen in {{ orderCurrency() }}</small></dd></div>
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
                      <label for="dk-terms">Betaalplan</label>
                      <button class="btn purchase-payment-plan-trigger" id="dk-terms" type="button" [disabled]="saving() || payingBusy() || paymentPlanBusy()" (click)="openPaymentPlan()">{{ planLabel(data.order) }} <span>Wijzigen</span></button>
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
                    <div class="field">
                      <span class="label">Prijsbasis en munt van de leverancier</span>
                      <div class="fin-chips po-basis" role="group" aria-label="Prijsbasis en munt">
                        <button type="button" class="fin-chip" [class.on]="!isDdp()" (click)="setOrderBasis('EXW')">EXW</button>
                        <button type="button" class="fin-chip" [class.on]="isDdp()" (click)="setOrderBasis('DDP')">DDP</button>
                        <span class="po-basis__sep" aria-hidden="true"></span>
                        <button type="button" class="fin-chip" [class.on]="orderCurrency() === 'USD'" (click)="setOrderCurrency('USD')">$ USD</button>
                        <button type="button" class="fin-chip" [class.on]="orderCurrency() === 'CNY'" (click)="setOrderCurrency('CNY')">¥ CNY</button>
                        <button type="button" class="fin-chip" [class.on]="orderCurrency() === 'EUR'" (click)="setOrderCurrency('EUR')">€ EUR</button>
                      </div>
                      <span class="hint">{{ isDdp() ? 'Geleverd incl. rechten, voor de hele container: zeevracht en invoerrechten stappen opzij.' : 'Af fabriek: wij regelen zeevracht, invoerrechten en transport.' }} De stukprijzen staan in {{ orderCurrency() }}.</span>
                    </div>
                  </div>
                  }
                  <app-purchase-partner-panel [order]="data.order" [docs]="partnerDocs()" [advanceBasisEur]="data.costing.totals.totalWithSeparateCostsEur ?? null" [canQuote]="quoteLines().length > 0" [canAuction]="auctionLines().length > 0" (saved)="onPartnerSaved($event)" (quote)="quoteOpen.set(true)" (link)="partnerSheetOpen.set(true)" (auction)="auctionOpen.set(true)" (schedule)="openPartner()" (unlink)="unlinkPartnerDoc($event)" />
                }

                @case ('costs') {
                  <div class="desk-costs-switch"><app-segmented label="Kosten" [options]="costsOptions" [value]="costsPane()" (changed)="costsPane.set($event === 'actual' ? 'actual' : 'plan')" /></div>
                  @if (costsPane() === 'actual') {
                    <app-purchase-payment-result [view]="data" [ledger]="paymentLedger()" actions="inline" [busy]="payingBusy() || saving() || paymentStateLoading() || payments() === null"
                      (open)="showPayments($event)" (settle)="requestSettle($event)" (undoSettle)="requestUndoSettle($event.payee)" />
                    <app-purchase-reconciliation [data]="data.reconciliation" [orderId]="data.order.id" [orderNumber]="data.order.number" [dirty]="dirty()" [showStreams]="false" [hosted]="true" (openPayments)="showPayments()" />
                  } @else {
                  @if (!editing()) {
                    <div class="desk-panel__head"><strong>Kosten &amp; koersen</strong><button class="linklike" type="button" (click)="startEdit()">Bewerken</button></div>
                    <div class="desk-rates">
                      <div><small>RMB → USD</small><b>{{ data.order.cnyToUsd }}</b>@if (marketReference(); as market) { <i>ECB {{ market.cnyToUsd | num: 4 }}</i> }</div>
                      <div><small>USD → EUR</small><b>{{ usdToEurRate() }}</b>@if (marketReference(); as market) { <i>ECB {{ market.usdToEur | num: 4 }}</i> }</div>
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
                        <input class="input num right" id="dk-cny" type="number" step="0.0001" inputmode="decimal" [ngModel]="data.order.cnyToUsd" (ngModelChange)="patch({ cnyToUsd: +$event })" />
                        @if (marketRates(); as market) {
                          <span class="hint hint--market">ECB {{ marketReference()!.cnyToUsd | num: 4 }} · met {{ market.marginPct }} % marge {{ market.cnyToUsd | num: 4 }}@if (data.order.cnyToUsd !== market.cnyToUsd) { · <button class="linklike" type="button" (click)="patch({ cnyToUsd: market.cnyToUsd })">overnemen</button> }</span>
                        }</div>
                      <div class="field"><label for="dk-usd">USD → EUR</label>
                        <input class="input num right" id="dk-usd" type="number" step="0.0001" inputmode="decimal" [ngModel]="usdToEurRate()" (ngModelChange)="setUsdToEur(+$event)" />
                        @if (marketRates(); as market) {
                          <span class="hint hint--market">ECB {{ marketReference()!.usdToEur | num: 4 }} · met {{ market.marginPct }} % marge {{ market.usdToEur | num: 4 }}@if (usdToEurRate() !== market.usdToEur) { · <button class="linklike" type="button" (click)="setUsdToEur(market.usdToEur)">overnemen</button> }</span>
                        }</div>
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
                    <div class="desk-form__duo">
                      <div class="field">
                        <label for="dk-extra">Enrosed kost <span class="opt"></span></label>
                        <div class="input-affix">
                          <input class="input num right" id="dk-extra" type="number" step="100" min="0" inputmode="decimal" [ngModel]="data.order.extraRevenueEur" (ngModelChange)="patch({ extraRevenueEur: +$event })" />
                          <span class="input-affix__suffix">EUR</span>
                        </div>
                        <span class="hint">In de stukprijs · {{ manualExtra() ? 'zelf verdeeld per product' : 'verdeeld ' + allocationLabel(data.order.allocExtra) }}@if (!manualExtra()) { · <button class="linklike" type="button" (click)="openManualSplit()">zelf verdelen per product</button> }</span>

                      </div>
                      <div class="field">
                        <label for="dk-inspection">Inspectiekost <span class="opt"></span></label>
                        <div class="input-affix">
                          <input class="input num right" id="dk-inspection" type="number" step="50" min="0" inputmode="decimal" [ngModel]="data.order.inspectionCostEur" (ngModelChange)="patch({ inspectionCostEur: $event === '' || $event === null ? null : +$event })" />
                          <span class="input-affix__suffix">EUR</span>
                        </div>
                        <span class="hint">{{ separateCaption() }}</span>
                      </div>
                      @if (manualExtra()) {
                        <div class="po-split po-split--line" [class.po-split--over]="extraSplitRemainder() < -0.004" [class.po-split--done]="extraSplitRemainder() >= -0.004 && extraSplitRemainder() <= 0.004">
                          <p class="po-split__sum"><b>{{ extraSplitSpread() | eur: 0 }}</b> van {{ data.order.extraRevenueEur | eur: 0 }} verdeeld
                            @if (extraSplitRemainder() > 0.004) { <em>· nog {{ extraSplitRemainder() | eur: 0 }}</em> }
                            @else if (extraSplitRemainder() < -0.004) { <em>· {{ -extraSplitRemainder() | eur: 0 }} erboven</em> }
                            @else { <em>· alles verdeeld</em> }</p>
                          @if (negativeExtra()) { <p class="po-split__warn">Totaal onder nul: eerst rechtzetten, dan bewaren.</p> }
                          <span class="po-split__actions">
                            <button class="linklike" type="button" (click)="extraSplitOpen.set(true)">Verdeling aanpassen ›</button>
                            <button class="linklike" type="button" (click)="endManualSplit()">weer automatisch</button>
                          </span>
                        </div>
                      }
                    </div>
                    <div class="other-costs" aria-label="Andere kosten">
                      @for (cost of data.order.otherCosts ?? []; track $index; let i = $index) {
                        <div class="other-cost">
                          <input class="input" type="text" maxlength="60" placeholder="Naam, bv. certificaat" [attr.aria-label]="'Naam andere kost ' + (i + 1)" [ngModel]="cost.label" (ngModelChange)="setOtherCost(i, { label: $event })" />
                          <div class="input-affix">
                            <input class="input num right" type="number" step="50" min="0" inputmode="decimal" [attr.aria-label]="'Bedrag andere kost ' + (i + 1)" [ngModel]="cost.amountEur" (ngModelChange)="setOtherCost(i, { amountEur: $event === '' || $event === null ? null : +$event })" />
                            <span class="input-affix__suffix">EUR</span>
                          </div>
                          <button class="other-cost__remove" type="button" [attr.aria-label]="'Verwijder ' + (cost.label || 'andere kost')" (click)="removeOtherCost(i)">×</button>
                        </div>
                      }
                      <button class="other-costs__add" type="button" (click)="addOtherCost()">
                        <span aria-hidden="true">+</span><b>Andere kost</b><small>certificaat, labo, staal … {{ separateInPiece() ? 'in de stukprijs verdeeld' : 'apart, achteraf' }}</small>
                      </button>
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
                            @if (key.field === 'allocSeparate') { <option value="SEPARATE">Achteraf, apart van de stukprijs</option> }
                            <option value="CBM">Naar volume (m³)</option><option value="VALUE">Naar goederenwaarde</option><option value="PIECES">Naar aantal stuks</option>
                            @if (key.field === 'allocExtra') { <option value="MANUAL">Zelf per product</option> }
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
                      @if (data.costing.totals.extraRevenueEur) { <div class="desk-chain__row"><i>+</i><span>Enrosed kost <small>{{ data.order.allocExtra === 'MANUAL' ? 'zelf verdeeld' : 'eigen opslag' }} · <button class="linklike" type="button" (click)="openManualSplit()">{{ data.order.allocExtra === 'MANUAL' ? 'aanpassen' : 'zelf verdelen' }}</button></small></span><b>{{ data.costing.totals.extraRevenueEur | eur }}</b></div> }
                      @if (data.costing.totals.separateCostsEur) {
                        @if (data.costing.totals.inspectionEur) {
                          <div class="desk-chain__row"><i>+</i><span>Inspectie <small>{{ separateInPiece() ? 'in de stukprijs verdeeld' : 'apart' }}</small></span><b>{{ data.costing.totals.inspectionEur | eur }}</b></div>
                        }
                        @for (cost of data.costing.totals.otherCosts ?? []; track $index) {
                          <div class="desk-chain__row"><i>+</i><span>{{ cost.label }} <small>{{ separateInPiece() ? 'in de stukprijs verdeeld' : 'apart' }}</small></span><b>{{ cost.amountEur | eur }}</b></div>
                        }
                      }
                      <div class="desk-chain__row desk-chain__row--total"><i>=</i><span>{{ data.costing.totals.separateCostsEur ? separateCostsTotalLabel(data.costing.totals) : 'Totaal geland' }} <small>{{ data.costing.totals.averageUnitEur | eurUp: 3 }} per stuk</small></span><b>{{ data.costing.totals.totalWithSeparateCostsEur | eur }}</b></div>
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
                }

                @case ('partner') {
                  <app-purchase-partner-payments (quote)="quoteOpen.set(true)" (changed)="onPartnerLinked()" (creditNote)="creditNoteOpen.set(true)" [order]="data.order" [docs]="partnerDocs()" [advanceBasisEur]="data.costing.totals.totalWithSeparateCostsEur ?? null" />
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
                      <header class="desk-dossier__head"><strong>Schade en tekorten <small>{{ (data.receiptReports ?? []).length }}</small></strong></header>
                      @if (data.receiptReports?.length) {
                        <ul class="desk-reports">
                          @for (report of data.receiptReports; track $index) {
                            <li [class.desk-reports__row--later]="report.source === 'LATER'">
                              <span class="desk-reports__tag">{{ report.source === 'LATER' ? 'Na uitpakken' : 'Bij ontvangst' }}</span>
                              <span class="desk-reports__what"><b>{{ report.productName }}</b><small>{{ report.sku || '' }}{{ report.on ? ' · ' + (report.on | dateNl) : '' }}{{ report.actor ? ' · ' + report.actor : '' }}</small></span>
                              <span class="desk-reports__count">@if (report.damaged) { <b>{{ report.damaged | num }}</b> beschadigd }@if (report.damaged && report.missing) { · }@if (report.missing) { <b>{{ report.missing | num }}</b> te weinig }</span>
                              @if (report.note) { <em class="desk-reports__note">{{ report.note }}</em> }
                            </li>
                          }
                        </ul>
                        <p class="desk-dossier__hint">Staat als waarschuwing op de volgende leveranciersorder van deze producten.</p>
                      } @else {
                        <p class="desk-dossier__empty">Niets gemeld: ontvangen zoals besteld. Schade of tekort meld je op de productpagina, gekoppeld aan deze container.</p>
                      }
                    </section>
                    <section>
                      <header class="desk-dossier__head"><strong>Documenten <small>{{ (documents() ?? []).length }}</small></strong>
                        <span class="desk-dossier__head-actions"><a class="linklike" routerLink="/files" [queryParams]="{ view: 'purchase', doel: data.order.id }">In Documenten &amp; media ›</a>
                        <button class="btn btn--sm" type="button" (click)="openDocument()">+ Document</button></span></header>
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
                    <app-purchase-sales-links [documents]="relatedSalesDocs()" [excludePartner]="data.order.partnerCustomerId != null" />
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
                      <button class="desk-action" type="button" [disabled]="!quoteLines().length" (click)="quoteOpen.set(true)"><span><b>{{ data.order.partnerCustomerId ? 'Conceptvoorschotfacturen maken' : 'Verkoopofferte maken' }}</b><small>{{ data.order.partnerCustomerId ? 'Eén conceptfactuur per voorschottermijn, nog niet verstuurd.' : 'Dezelfde producten en aantallen op een nieuwe offerte voor een klant.' }}</small></span><i aria-hidden="true">›</i></button>
                      <button class="desk-action" type="button" (click)="pdfOpen.set(true)"><span><b>PDF maken</b><small>Voor de leverancier, controleur of als intern dossier.</small></span><i aria-hidden="true">›</i></button>
                    </div>
                    @if (!isReceived()) {
                      <details class="desk-danger">
                        <summary>Meer acties</summary>
                        <p>Tijdelijk verwijderen. Herstellen kan via Instellingen → Beheer → Verwijderde items.</p>
                        <button class="btn btn--danger btn--block" type="button" [disabled]="deletingOrder() || saving()" (click)="remove()">{{ deletingOrder() ? 'Verwijderen…' : 'Calculatie verwijderen' }}</button>
                      </details>
                    }
                  </div>
                }
              }
            </div>
          </aside>
        </div>
      </div>

      @if (quoteOpen()) {
        @if (view(); as data) {
          <app-purchase-quote-sheet [advanceBasisEur]="data.costing.totals.totalWithSeparateCostsEur ?? null" [reconciliation]="data.reconciliation" [order]="data.order" [lines]="quoteLines()" [presetCustomerId]="data.order.partnerCustomerId ?? null" [presetCostPct]="data.order.partnerCostPct ?? null" [presetSharePct]="data.order.partnerSharePct ?? null" (closed)="quoteOpen.set(false)" />
        }
      }
      @if (extraSplitOpen()) {
        <app-purchase-extra-split [order]="data.order" [costing]="data.costing" [sequence]="lineOrder()"
                                  (shareChange)="setExtraShare($event.productId, $event.raw)" (targetChange)="setTargetUnitFor($event.productId, $event.raw)"
                                  (fill)="fillExtraSplit($event)" (rest)="extraSplitRestToLast()"
                                  (automatic)="endManualSplit(); extraSplitOpen.set(false)" (closed)="closeExtraSplit()" />
      }
      @if (partnerSheetOpen()) {
        @if (view(); as data) {
          <app-purchase-partner-sheet [order]="data.order" [currentShare]="partnerShare()" (closed)="partnerSheetOpen.set(false)" (linked)="onPartnerLinked()" />
        }
      }
      @if (auctionOpen()) {
        @if (view(); as data) {
          <app-auction-settlement-sheet [lines]="auctionLines()" [customerId]="auctionCustomerId()" [customerName]="partnerCompany()"
                                        [purchaseOrderId]="data.order.id" [reference]="data.order.number" [sourceId]="auctionSourceId()"
                                        [costSharePct]="auctionCostShare()" [separateUnitEur]="separateUnitEur()" [profitSharePct]="auctionProfitShare()"
                                        (funding)="openPartner()" (closed)="auctionOpen.set(false)" />
        }
      }
      @if (creditNoteOpen()) {
        @if (view(); as data) {
          <app-sales-credit-note-sheet [purchaseOrderId]="data.order.id" (closed)="creditNoteOpen.set(false)" />
        }
      }

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
                <span class="hint">De vertrekdatum wordt vandaag; volgens het betaalplan valt nu de volgende termijn.</span>
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
                <div><dt>Totaal geland</dt><dd>{{ data.costing.totals.totalEur | eur }} <small>{{ data.costing.totals.averageUnitEur | eurUp: 3 }} per stuk</small></dd></div>
                <div><dt>Betaalplan</dt><dd>{{ paymentTermsLabel(data.order.paymentTerms) }}</dd></div>
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
        <app-sheet title="Document toevoegen" (closed)="closeDocument()">
          <div body [attr.inert]="uploadingDocument() ? '' : null">
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
              @if (doc.kind === 'PAYMENT_PROOF' && (payments() ?? []).length) {
                <div class="field span-2">
                  <label for="dk-doc-payment">Hoort bij betaling <span class="opt"></span></label>
                  <select class="select" id="dk-doc-payment" [ngModel]="doc.paymentId ?? ''" (ngModelChange)="addingDocument.set({ ...doc, paymentId: $event ? +$event : null })">
                    <option value="">— geen —</option>
                    @for (payment of payments() ?? []; track payment.id) {
                      <option [value]="payment.id">{{ paymentOptionLabel(payment) }}</option>
                    }
                  </select>
                </div>
              }
              <div class="field span-2">
                @if (doc.kind === 'PAYMENT_PROOF') {
                  <app-payment-proof-picker [files]="doc.files ?? []" [maxFiles]="proofSlots(doc.paymentId)" [disabled]="uploadingDocument()"
                    (filesChange)="addingDocument.set({ ...doc, files: $event, file: null })" />
                } @else {
                  <label for="dk-doc-file">Bestand</label>
                <div class="doc-source">
                  <input class="input" id="dk-doc-file" type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx,.csv"
                         (change)="addingDocument.set({ ...doc, file: $any($event.target).files?.[0] ?? null })" />
                  <button class="btn" type="button" (click)="libraryOpen.set(true)">Uit bibliotheek</button>
                </div>
                <span class="hint">{{ doc.file ? doc.file.name + ' · ' : '' }}PDF, foto of Office-bestand, tot 25 MB.</span>
                }
              </div>
            </div>
          </div>
          <div foot style="display:contents">
            <button class="btn" type="button" (click)="closeDocument()">Annuleren</button>
            <button class="btn btn--primary" type="button" [disabled]="uploadingDocument() || !(doc.file || doc.files?.length)" (click)="confirmDocument()">
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

      @if (paymentPlanOrder(); as agreement) {
        <app-purchase-payment-plan-sheet [order]="agreement" [busy]="paymentPlanBusy()" [error]="paymentPlanFailure()"
          [agreedEur]="supplierOwed()" [paidEur]="paidTotalEur()" [scopedDues]="scopedSupplierDues()"
          (saved)="savePaymentPlan($event)" (closed)="paymentPlanOrder.set(null)" />
      }
      @if (paying(); as pay) {
        <app-purchase-payment-sheet [draft]="pay" [chips]="payChips()" [instalmentOptions]="paymentInstalmentOptions()"
          [openHint]="payingOpenHint()" [overageEur]="payingOverage()" [draftEur]="paymentDraftEur()"
          [originalPayee]="payingOriginal()?.payee ?? null" [originalSettles]="!!payingOriginal()?.settles"
          [busy]="payingBusy()" [loading]="paymentStateLoading()" [proofSlots]="proofSlots(pay.id)" [groupLabel]="paymentGroupLabel(pay.payee)"
          (patch)="paying.set({ ...pay, ...$event })" (amountInput)="setPaymentAmount($event)" (payeeChange)="setPaymentPayee($event)"
          (confirm)="confirmPayment()" (cancel)="closePayment()" (remove)="removeEditing($event)" />
      }
      @if (settling(); as settle) {
        @if (settlePayee(); as payee) {
          <app-purchase-settle-sheet [draft]="settle" [payee]="payee" [carriers]="settleCarrierOptions().options"
            [canonical]="!!paymentLedger()?.canonical" [busy]="payingBusy()"
            (scope)="setSettleScope($event.scope, $event.due)" (carrier)="settling.set({ ...settle, paymentId: $event })"
            (confirm)="confirmSettle()" (undo)="settling.set(null); requestUndoSettle(settle.payee, settle.scope === 'TERM' ? settle.due : undefined)"
            (cancel)="closeSettle()" (editCarrier)="settling.set(null); requestEdit($event)" />
        }
      }
      @if (firstInstalmentPrompt(); as first) {
        <app-purchase-first-instalment-sheet [prompt]="first" [supplierName]="supplierName()" [busy]="payingBusy()"
          (patch)="firstInstalmentPrompt.set({ ...first, ...$event })" (amountInput)="setFirstPaymentAmount($event)"
          (confirm)="confirmFirstInstalment()" (dismiss)="firstInstalmentPrompt.set(null)" />
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
            <div class="receive-balance mt-12" aria-label="Betalingen bij ontvangst">
              <b>Betalingen bij ontvangst</b>
              <small>Leverancier: {{ paidTotalEur() | eur }} betaald van {{ supplierOwed() | eur }} · {{ remainingEur() | eur }} open</small>
              @for (open of receiveOpenPayees(); track open.label) { <small>{{ open.label }}: {{ open.openEur | eur }} open</small> }
              @if (remainingEur() > 0.005) {
                <label class="receive-balance__final"><input type="checkbox" [ngModel]="draft.finalPayment" (ngModelChange)="receiving.set({ ...draft, finalPayment: $event })" /><span>Slotbetaling van <b>{{ remainingEur() | eur }}</b> aan de leverancier noteren en de leverancier afrekenen</span></label>
              }
              <span class="hint">Douane, transport en inspectie noteer je apart bij Betalingen.</span>
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
                                [separateCosts]="hasSeparateCosts(data.order)"
                                (saveRequested)="save()" (closed)="pdfOpen.set(false)" />
      }
    } @else {
      <app-page-header title="Inkoop" subtitle="Inkooporder laden…" [showBack]="true" [showBell]="false" />
      <div class="content desk-skeleton" role="status" aria-live="polite" aria-label="Inkooporder laden">
        <app-skeleton kind="card" [rows]="1" />
        <app-skeleton kind="stats" [rows]="4" />
        <app-skeleton kind="list" [rows]="5" />
      </div>
    }
  `,
  styles: [`

    /* Sheets of the desk template: report damage, add a document, receive. */
    .issue-kind{margin-top:2px}
    :host{display:block;min-width:0}
    .doc-source{display:flex;gap:8px}.doc-source .input{flex:1;min-width:0}

    .desk-table-bar{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line)}
    .desk-table-bar>div{flex:1;min-width:0}.desk-table-bar h2{font-size:15px}.desk-table-bar p{color:var(--muted);font-size:11.5px}
    .desk-table-wrap{overflow-x:auto}
    .desk-table{width:100%;min-width:726px;border-collapse:separate;border-spacing:0;table-layout:fixed;font-size:12.5px}.desk-table--editing{min-width:814px}.desk-table--extra{min-width:840px}.desk-table--editing.desk-table--extra{min-width:960px}
    .c-price__basis{margin-left:3px;color:var(--muted);font-weight:600;opacity:.75}
    .desk-table--editing td.c-qty .desk-cell{padding-inline:6px;text-align:center}
    .desk-price--target{margin-top:4px}.desk-price__sym--wide{padding:0 5px;font-size:9.5px;letter-spacing:.02em;text-transform:uppercase}.desk-table--editing.desk-table--extra{min-width:1000px}
    .desk-table--editing td.c-price .desk-price{width:auto;max-width:128px;margin-left:auto}.desk-table--editing td.c-extra .desk-price{width:auto;max-width:132px;margin-left:auto}.desk-table td.c-extra small{display:block;margin-top:2px;color:var(--muted);font-size:10.5px;white-space:nowrap}
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
    .desk-price{display:flex}.desk-price .desk-cell{flex:1;min-width:0;border-radius:0 var(--r-sm) var(--r-sm) 0}.desk-price__sym{display:inline-flex;align-items:center;padding:0 7px;border:1px solid var(--line-strong);border-right:0;border-radius:var(--r-sm) 0 0 var(--r-sm);background:var(--surface-2);color:var(--muted);font-size:12px;font-weight:700}
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
    /* A narrow desk (an unfolded Fold, a small tablet): every line becomes a
       card, product on top, the numbers in a labelled grid under it. */
    @media(max-width:899px){
      .desk-table-bar{flex-wrap:wrap;gap:10px}.desk-table-bar>div{flex-basis:100%}
      .desk-table-wrap{overflow:visible}
      .desk-table,.desk-table--editing{min-width:0;display:block}
      .desk-table thead{display:none}
      .desk-table tbody,.desk-table tfoot{display:block}
      .desk-table tr.desk-section__row,.desk-table tr.desk-detail{display:block}.desk-section__row th{display:block;padding:12px 14px 4px}
      .desk-table tr.desk-detail>td{display:block;width:auto;padding:0 14px 12px}
      .desk-table tr.desk-row,.desk-table tr.desk-group{position:relative;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));grid-template-areas:'product product product product product' 'qty cartons price goods landed';gap:8px 8px;padding:12px 14px;border-bottom:1px solid var(--line)}
      .desk-table tr.desk-group{grid-template-areas:'product product product product product' 'qty cartons cartons landed landed'}
      .desk-table td,.desk-table--editing td.c-qty,.desk-table--editing td.c-price{display:block;width:auto;min-width:0;padding:0;border:0;text-align:left;background:transparent}
      .desk-table td:empty{display:none}
      .desk-row td.c-product,.desk-group td.c-product{grid-area:product;padding-right:34px}
      .desk-row--variant td.c-product{padding-left:0}
      .desk-table td.c-qty{grid-area:qty}.desk-table td.c-cartons{grid-area:cartons}.desk-table td.c-price{grid-area:price}
      .desk-table td.c-money:not(.c-money--total){grid-area:goods}.desk-table td.c-money--total{grid-area:landed}
      .desk-group td.c-money:not(.c-money--total){grid-area:cartons}
      .desk-table td.c-act{position:absolute;top:8px;right:8px;display:block;width:auto}
      .desk-table td.c-qty::before,.desk-table td.c-cartons::before,.desk-table td.c-price::before,.desk-table td.c-money::before{display:block;margin-bottom:3px;color:var(--muted);font-size:9.5px;font-weight:750;letter-spacing:.04em;text-transform:uppercase}
      .desk-table tr.desk-row td.c-qty,.desk-table tr.desk-row td.c-cartons,.desk-table tr.desk-row td.c-price,.desk-table tr.desk-row td.c-money,.desk-table tr.desk-group td.c-qty,.desk-table tr.desk-group td.c-cartons,.desk-table tr.desk-group td.c-money{display:flex;flex-direction:column;align-items:center;text-align:center}
      .desk-table tr.desk-row td::before,.desk-table tr.desk-group td::before{text-align:center}
      .desk-table tr.desk-row td b,.desk-table tr.desk-group td b{line-height:1.3;white-space:nowrap}.desk-table tr.desk-row td small{white-space:nowrap}
      .desk-table tr.desk-row td.c-money--total .desk-total{justify-items:center;text-align:center}
      .desk-table--editing tr.desk-row td.c-price .desk-price{width:100%}
      .desk-table td.c-qty::before{content:'Aantal'}.desk-table td.c-cartons::before{content:'Dozen'}.desk-table td.c-price::before{content:'Prijs / stuk'}
      .desk-table td.c-money:not(.c-money--total)::before{content:'Goederen'}.desk-table td.c-money--total::before{content:'Geland'}
      .desk-cell{width:100%}.desk-table--editing td.c-price .desk-cell{padding-right:8px}
      .desk-row:hover td{background:transparent}
      .desk-table tfoot tr{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 22px;padding:12px 14px;border-top:2px solid var(--line-strong);background:var(--surface-2)}
      .desk-table tfoot th{display:block;padding:0;border:0;text-align:center;white-space:nowrap}
      .desk-table tfoot th:empty{display:none}
      .desk-table tfoot th.c-product{flex-basis:100%;text-align:center}
      .desk-table tfoot th::before{color:var(--muted);font-size:10px;font-weight:750;letter-spacing:.06em;text-transform:uppercase}
      .desk-table tfoot th.c-qty::before{content:'Stuks · '}.desk-table tfoot th.c-cartons::before{content:'Dozen · '}
      .desk-table tfoot th.c-money:not(.c-money--total)::before{content:'Goederen · '}.desk-table tfoot th.c-money--total::before{content:'Geland · '}
      .desk-table td.c-money.c-extra::before{content:'Enrosed kost'}.desk-table tfoot th.c-money.c-extra::before{content:'Enrosed kost · '}
    }

    .desk-supplier{display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:8px 10px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}
    .desk-supplier__mark{display:grid;width:32px;height:32px;flex:none;place-items:center;border-radius:9px;background:var(--rose);color:#fff;font-weight:800}.desk-supplier__copy{display:grid;min-width:0;flex:1;line-height:1.25}.desk-supplier strong{overflow:hidden;font-size:13px;text-overflow:ellipsis;white-space:nowrap}.desk-supplier__cur{align-self:flex-start;padding:2px 7px;border-radius:999px;background:var(--surface);color:var(--muted);font-size:10.5px;font-weight:700}
    .desk-affix-select{min-width:64px;border-radius:0 var(--r-sm) var(--r-sm) 0}
    .desk-sum{padding:8px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}
    .desk-sum .stat-row{padding:4px 0;font-size:12px}.desk-sum .stat-row small{display:block;color:var(--muted);font-size:9.5px;font-weight:500}
    .desk-sum__sub{border-top:1px solid var(--line);font-weight:650}.desk-sum__total{border-top:2px solid var(--line-strong);font-size:13px}.desk-sum__total strong{color:var(--rose-dark)}
    .desk-done{display:grid;gap:12px}
    .desk-done__attention{margin:0;padding:8px 12px 8px 26px;border:1px solid #eddcb9;border-radius:12px;background:var(--warn-soft);color:var(--ink-2);font-size:12px}
    .desk-rates{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;margin-bottom:12px;border:1px solid var(--line);border-radius:12px;background:var(--line);overflow:hidden}
    .desk-rates>div{display:grid;gap:1px;padding:9px 12px;background:var(--surface-2)}.desk-rates small{color:var(--muted);font-size:9.5px;font-weight:750;letter-spacing:.08em;text-transform:uppercase}.desk-rates b{font-size:14px;font-variant-numeric:tabular-nums}.desk-rates i{color:var(--muted);font-size:10px;font-style:normal;font-variant-numeric:tabular-nums}
    .desk-mix{display:flex;height:12px;border-radius:99px;background:var(--line);overflow:hidden}.desk-mix i{display:block;height:100%}
    .desk-mix__legend{display:flex;flex-wrap:wrap;gap:4px 12px;margin:8px 0 12px;padding:0;list-style:none;color:var(--muted);font-size:11px}.desk-mix__legend li{display:inline-flex;align-items:center;gap:5px}.desk-mix__legend i{width:9px;height:9px;border-radius:2px}.desk-mix__legend b{color:var(--ink-2)}
    .desk-mix__goods{background:var(--rose-dark)}.desk-mix__transport{background:var(--gold)}.desk-mix__duty{background:var(--warn)}.desk-mix__destination{background:var(--blue)}.desk-mix__extra{background:var(--muted)}
    .desk-dossier{display:grid;gap:16px}.desk-dossier__head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}.desk-dossier__head-actions{display:inline-flex;gap:6px}.desk-dossier__head strong{font-size:13px}.desk-dossier__head strong small{margin-left:5px;color:var(--muted);font-weight:600}
    .desk-reports{display:grid;gap:6px;margin:0;padding:0;list-style:none}.desk-reports li{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:6px 10px;padding:9px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}.desk-reports__row--later{border-color:var(--rose-line);background:var(--rose-soft)}.desk-reports__tag{padding:2px 8px;border-radius:999px;background:var(--surface-2);color:var(--muted);font-size:10px;font-weight:750;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}.desk-reports__row--later .desk-reports__tag{background:var(--rose);color:#fff}.desk-reports__what{display:grid;min-width:0}.desk-reports__what b{overflow:hidden;font-size:13px;text-overflow:ellipsis;white-space:nowrap}.desk-reports__what small{color:var(--muted);font-size:11px}.desk-reports__count{color:var(--danger);font-size:12px;font-weight:650;white-space:nowrap}.desk-reports__count b{font-size:14px}.desk-reports__note{grid-column:2/-1;color:var(--ink-2);font-size:12px}.desk-dossier__hint{margin:6px 0 0;color:var(--muted);font-size:11.5px}
    .desk-partner__lead{margin:0 0 8px;color:var(--ink-2);font-size:12.5px;line-height:1.45}.desk-partner-docs{display:grid;gap:6px;margin:0;padding:0;list-style:none}.desk-partner-docs li{display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}.desk-partner-docs__what{display:grid;min-width:0;flex:1;color:inherit;text-decoration:none}.desk-partner-docs__what b{font-size:13px}.desk-partner-docs__what small{color:var(--muted);font-size:11px}.desk-partner-docs__amount{font-variant-numeric:tabular-nums;font-weight:650;white-space:nowrap}.desk-partner-docs__unlink{flex:none;width:26px;height:26px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--muted);font-size:15px;line-height:1;cursor:pointer}.desk-partner-docs__unlink:hover{border-color:var(--danger);color:var(--danger)}
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
  /** From the reading view too: the window works on the draft, so editing starts first. */
  override openManualSplit(): void {
    if (!this.editing()) this.startEdit();
    super.openManualSplit();
  }

  readonly statusLabel$ = STATUS_LABEL;
  /** How the route opened us; the desk itself decides when editing ends. */
  readonly mode = input<'view' | 'edit'>('view');
  /** Reading is the default; Bewerken switches the inputs on. */
  readonly editing = linkedSignal(() => this.mode() === 'edit');

  /** Which drawer of the rail is open; the order facts first, as on paper. */
  readonly railTab = signal<RailTab>('order');
  /** The main pane: the products table, or the payments workbench across the full width. */
  readonly mainView = signal<'products' | 'payments'>('products');
  /** Kosten shows the calculation or, once paying, the Nacalculatie. */
  readonly costsPane = signal<'plan' | 'actual'>('plan');
  readonly hasPartnerTab = computed(() => this.view()?.order.partnerCustomerId != null);
  /** A partner that was unlinked takes its tab along; the rail falls back to the order. */
  readonly activeRailTab = computed<RailTab>(() => this.railTab() === 'partner' && !this.hasPartnerTab() ? 'order' : this.railTab());
  readonly viewOptions = computed<SegmentOption[]>(() => [
    { id: 'products', label: 'Producten' },
    { id: 'payments', label: 'Betalingen', dot: (this.paymentLedger()?.summary.dueNowEur ?? 0) > 0 ? 'warn' : null },
  ]);
  readonly costsOptions: SegmentOption[] = [{ id: 'plan', label: 'Calculatie' }, { id: 'actual', label: 'Nacalculatie' }];
  /** The server's attention list names a payment: offer the way there. */
  readonly paymentAttention = computed(() => (this.view()?.attention ?? []).some(PurchaseDesk.isPaymentAttention));
  /** In the payments view the strip already answers what is due; the banner keeps only the rest. */
  readonly attentionShown = computed(() => {
    const items = this.view()?.attention ?? [];
    return this.mainView() === 'payments' ? items.filter(item => !PurchaseDesk.isPaymentAttention(item)) : items;
  });
  /** The Nacalculatie in one glance, for the workbench's side card. */
  readonly nacalcSummary = computed(() => {
    const data = this.view();
    return data ? purchaseNacalcSummary(data) : null;
  });
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly workbench = viewChild(PurchasePaymentWorkbench);

  private static isPaymentAttention(item: string): boolean {
    return item.startsWith('Betaling open') || item === 'Nog geen betaling genoteerd' || /nog te betalen\.?$/.test(item);
  }

  /** The payments workbench, scrolled into view below the app bar; with a payee, that payee's row selected. */
  showPayments(payee?: Payee): void {
    this.mainView.set('payments');
    requestAnimationFrame(() => {
      const target = document.getElementById('purchase-payments-section');
      target?.scrollIntoView({ block: 'start' });
      target?.focus({ preventScroll: true });
      if (payee) this.workbench()?.focusPayee(payee);
    });
  }

  /** A rail drawer lives beside the products; opening one leaves the payments view. */
  showRail(tab: RailTab): void {
    this.mainView.set('products');
    this.railTab.set(tab);
  }

  /** Partner financing (money in) has its own drawer; without a partner the link means the payments. */
  openPartner(): void {
    if (this.hasPartnerTab()) this.showRail('partner');
    else this.showPayments();
  }

  showCosts(): void {
    this.showRail('costs');
    this.costsPane.set('plan');
  }

  showNacalculatie(): void {
    this.showRail('costs');
    this.costsPane.set('actual');
    requestAnimationFrame(() => {
      const target = document.getElementById('purchase-payment-result');
      target?.scrollIntoView({ block: 'start' });
      target?.focus({ preventScroll: true });
    });
  }

  /** ⌥1 products, ⌥2 payments; on a Mac ⌥1 types '¡', so the physical key counts. */
  @HostListener('document:keydown', ['$event'])
  onDeskKey(event: KeyboardEvent): void {
    if (!event.altKey || event.metaKey || event.ctrlKey || !this.view()) return;
    if (event.code !== 'Digit1' && event.code !== 'Digit2') return;
    const context = keyContext(event, this.host.nativeElement);
    if (context.typing || context.overlayOpen || !context.inScope) return;
    event.preventDefault();
    if (event.code === 'Digit2') this.showPayments();
    else this.mainView.set('products');
  }

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
    const order = this.view()?.order;
    if (order && (order.paymentTerms ?? 'THIRDS') === 'CUSTOM') return paymentPlanLabel(order, this.paymentTermOptions);
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
    this.showRail('order');
    setTimeout(() => document.getElementById('dk-tracking')?.focus(), 150);
  }

  /** The fields live in the products table and the rail, so editing leaves the payments view. */
  startEdit(): void {
    this.editing.set(true);
    this.mainView.set('products');
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
