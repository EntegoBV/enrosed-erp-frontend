import { bankAmountsMatch } from '../../shared/bank-transaction-options';
import { TEMPORARY_DELETION_NOTICE } from '../../shared/deleted-item-notice';
import { PurchaseSalesLinks } from './purchase-sales-links';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, computed, effect, inject, input, linkedSignal, signal, untracked, viewChild } from '@angular/core';
import { Location } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { SalesApi } from '../../core/api/sales-api';
import { saveBlob } from '../../core/api/download';
import {
  CHINESE_DEPARTURE_PORTS,
  COLOUR_SWATCHES,
  CONTAINER_TYPES,
  DESTINATION_PORTS,
  OTHER_PORT_VALUE,
  PortOption,
  containerCountForFill,
  containerLabel,
} from '../../core/api/geo';
import { messageOf } from '../../core/api/errors';
import { isSettlementInvoice, partnerDocumentKind, separateCostPerPiece } from '../sales/partner-settlement';
import { AuctionSettlementSheet, AuctionSheetLine } from '../sales/auction-settlement-sheet';
import { Fx } from '../../core/api/fx';
import { PurchaseExtraSplit } from './purchase-extra-split';
import { PurchasePartnerPanel } from './purchase-partner-panel';
import { PurchasePartnerPayments } from './purchase-partner-payments';
import { PurchasePaymentOverview } from './purchase-payment-overview';
import { PurchaseNacalcOverview } from './purchase-nacalc-overview';
import { purchaseNacalc } from './purchase-nacalc-metrics';
import { landedUnit, landedUnitText, purchaseNacalcSummary } from './purchase-payment-result-metrics';
import { PurchasePaymentSheet, type PurchasePaymentDraft } from './purchase-payment-sheet';
import { splitTransfer } from './purchase-transfer-split';
import {
  inspectionRestOffered, invoiceDocumentKind, invoiceNumberKey, invoicesOf, paymentRoundOnServer, primaryInvoice, resolveInvoice,
} from './purchase-invoices';
import {
  alreadyLinkedText, carveForeignText, carveText, growLinkPlan, inspectionSplitBlocked, inspectionSplitEur, linkNotice, paymentFigure, pendingAlreadyLinked,
  pendingLinkPlan, pendingPartEur, surplusQuestion, transferCompanions, type TermStanding,
} from './purchase-payment-links';
import { PurchaseInvoiceSheet, type InvoiceSheetAction, type InvoiceSheetSubmit } from './purchase-invoice-sheet';
import type { InvoiceRequest } from './purchase-payment-workbench';
import { bankTransactionDay } from '../../shared/bank-transaction-options';
import { BankAccountsStore } from '../../core/api/bank-accounts';
import { BankingApi, type BankStatementLine } from '../../core/api/banking-api';
import { lineMarkers } from '../finance/bank-markers';
import { clearanceSuggestion } from '../finance/vat-return';
import { containerPayables } from '../finance/payables';
import { CashForecastApi } from '../../core/api/cash-forecast-api';
import { alsoContainerOptions, alsoNotice, alsoTotalEur, alsoWrites, proposeShare, type AlsoContainerOption } from './purchase-also-containers';
import { applyShare, shareBody, shareNewPart, sharePartsOf, shareStatus, shareToast } from './purchase-payment-share';
import { receiptLocalParts } from '../../shared/received-at';
import { PurchaseSettleSheet } from './purchase-settle-sheet';
import { PurchaseFirstInstalmentSheet } from './purchase-first-instalment-sheet';
import { ContextMenu, type ContextMenuItem } from '../../shared/context-menu';
import { SwipeActions } from '../../shared/swipe-actions';
import { PurchasePaymentPlanSheet } from './purchase-payment-plan-sheet';
import { PaymentProofPicker } from '../../shared/payment-proof-picker';
import { amountInputText, parsePurchasePaymentAmount, purchasePaymentOverage } from './purchase-payment-amount';
import {
  PAYEE_LABEL, SUPPLIER_CREDIT_REASON_LABEL, creditOffsetTargets, paymentOptionParts, purchaseCif, purchasePaymentLedger, settleCarriers, type Due,
  type LedgerPart, type PurchasePaymentAction, type PurchaseSettleRequest, type SupplierCreditAction,
} from './purchase-payment-ledger';
import { PurchaseSupplierCreditSheet, type SupplierCreditSheetAction, type SupplierCreditSubmit } from './purchase-supplier-credit-sheet';
import { formatEur, payeeMenuItems } from './purchase-payment-menus';
import { PurchasePartnerSheet } from './purchase-partner-sheet';
import {
  Allocation, Category, Clearance, Currency, DocumentKind, FreightRate, OtherCost, PAYMENT_TERMS, PartnerFinancing, Payee, Product, ProductFamily, PurchaseDocument, PurchaseInvoice, PurchaseOrder,
  PurchaseOrderLine, PurchaseOrderView, PurchasePayment, PurchasePaymentRow, PurchasePaymentWrite, PurchaseSupplierCredit, ReceivedLine, Supplier, StockLocation, SalesOrderView, Customer,
} from '../../core/api/models';
import { PurchaseQuoteSheet, PurchaseQuoteLine } from './purchase-quote-sheet';
import { FilePicker } from '../../shared/file-picker';
import { MediaApi } from '../../core/api/media-api';
import { MediaAssetSummary } from '../../core/api/media-models';
import { Diary } from './diary';
import { ProductDraft } from '../../shared/product-picker';
import { ProductPicker } from '../../shared/product-picker';
import { DateField } from '../../shared/date-field';
import { Skeleton } from '../../shared/skeleton';
import { LOAD_ERROR_FALLBACK, LoadError } from '../../shared/load-error';
import { Sheet, Ui, escapeHtml } from '../../shared/ui';
import { PAYMENT_TOLERANCE_EUR, instalmentsOf, paymentPlanLabel, splitTotal, paymentPlanError, type PaymentPlanFields } from './payment-plan';
import { purchaseGroupSettled, purchaseInstalmentState } from './purchase-instalment-state';
import { preservePurchaseDraft } from './purchase-payment-refresh';
import { CbmPipe, CurPipe, DateNlPipe, EurPipe, NumPipe, PctPipe, EurUpPipe, NumUpPipe, ceilTo } from '../../shared/pipes';
import { SupplierAddress } from '../../shared/supplier-address';
import { AuthImage } from '../../core/api/auth-image';
import {
  effectiveUsdToEur,
  hasSeparateCosts,
  purchaseCostLabels,
  separateCostsTotalLabel,
  withUsdToEur,
} from './purchase-cost-labels';
import { PurchaseOrderedSuccess } from './purchase-ordered-success';
import { PurchaseStatusSuccess } from './purchase-status-success';
import { PurchaseStatusBackSheet } from './purchase-status-back-sheet';
import { PurchaseApplyCostsSheet } from './purchase-apply-costs-sheet';
import { applyCostsPlan, applyCostsToast, missingProductIds } from './purchase-apply-costs';
import { statusBackOptions, type StatusBackSheetState, type StatusBackTarget } from './purchase-status-back';
import { PurchasePdfSheet } from './purchase-pdf-sheet';
import { PurchaseActivity } from '../activity/purchase-activity';
import { receiptLineMetrics, receiptMetrics } from '../analyses/receipt-metrics';
import { cartonQuantityNotice } from '../../shared/carton-quantity-notice';
import { productSalesUnit } from '../products/product-sales-unit';
import { latestOwnFreightQuote, purchaseFxDefaults, purchaseFxReference } from './purchase-price-context';
import { landedRangeText, purchaseLineSections } from './purchase-product-line-groups';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { containerName } from './container-name';
import {
  STEP_BUTTON, actionsMenu, editNextStep, linePriceText, parseTab, paymentsDot, productsDot, replaceTabInUrl, rootSectionOf, statusLabel, statusTone, stepConfirm,
  stepTarget, stepToward, tabOfSection, tabParam, tabSegments, unsavedSummary, type AskedStep, type PhoneStep, type PhoneTab,
} from './purchase-phone-model';
import { keepPhoneTabFocusInPlace, keepPhoneTabsStuck, phoneStickPoint, phoneTabsStuck, scrollPhoneTabsTop, tappedSelectedTab } from './purchase-phone-scroll';
import { IosNav } from '../../shared/ios-nav';
import { Icon } from '../../shared/icon';
import { Segmented, type SegmentOption } from '../../shared/segmented';
import { PurchaseNacalcGlance } from './purchase-nacalc-glance';
import { PurchaseStepConfirmSheet } from './purchase-step-confirm-sheet';

/**
 * Landed-cost calculation of a container.
 *
 * The screen order follows the road of the goods: goods, local origin costs
 * and sea freight form the customs value, duty per HS code is levied on
 * that, and only then do the costs from the port of arrival join.
 */
/** What the receive sheet edits before it is sent. */
interface ReceiveDraft {
  lines: {
    productId: number;
    name: string;
    sku: string;
    ordered: number;
    received: number;
    damaged: number;
    /** Frozen supplier/purchase value, not the full landed operational cost. */
    unitValueEur: number | null;
    /** What was wrong, noted at the shelf. */
    note: string;
  }[];
  bookStock: boolean;
  /** Open the shared final-payment sheet after receiving; payment is confirmed separately. */
  finalPayment: boolean;
  note: string;
  /** The day the container came in (ISO); today unless the buyer corrects it. */
  receivedOn?: string;
}

/** Today on this device as yyyy-mm-dd: the day the buyer sees, not the UTC one. */
function localIsoDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** The container's price basis: DDP when every line says so, EXW otherwise. */
function basisOf(order: PurchaseOrder): 'EXW' | 'DDP' {
  return order.lines.length > 0 && order.lines.every((line) => (line.priceBasis ?? 'EXW') === 'DDP') ? 'DDP' : 'EXW';
}

@Component({
  selector: 'app-purchase-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PurchaseSalesLinks, Skeleton, LoadError, PurchaseQuoteSheet, PurchaseExtraSplit, PurchasePartnerPanel, PurchasePartnerPayments, PurchasePaymentOverview, PurchaseNacalcOverview, PurchasePaymentSheet, PurchaseInvoiceSheet, PurchaseSettleSheet, PurchaseSupplierCreditSheet, PurchaseFirstInstalmentSheet, ContextMenu, PurchasePaymentPlanSheet, PaymentProofPicker, PurchasePartnerSheet, AuctionSettlementSheet, FormsModule, RouterLink, Diary, ProductPicker, DateField, Sheet, AuthImage,
            SupplierAddress, PurchaseOrderedSuccess, PurchaseStatusSuccess, PurchaseStatusBackSheet, PurchaseApplyCostsSheet,
            PurchasePdfSheet, PurchaseActivity, EurPipe, EurUpPipe, NumUpPipe, CurPipe, NumPipe, PctPipe, CbmPipe, DateNlPipe, FilePicker,
            IosNav, Icon, Segmented, SwipeActions, PurchaseNacalcGlance, PurchaseStepConfirmSheet],
  template: `
    @if (view(); as data) {
      <div class="mpo-phone mpo-phone--edit">
        <app-ios-nav [title]="containerName(data.order)" [customLarge]="true" backLabel="" backAriaLabel="Terug naar de container" (back)="goBack()">
          <button trail class="ios-capsule ios-capsule--sm mpo-actions" type="button" aria-haspopup="dialog" [attr.aria-expanded]="actionsOpen()"
                  (click)="actionsOpen.set(true)">Acties <app-icon name="chevron-down" [size]="14" /></button>
          <!-- As the product editor: what is being edited, its status, and two figures that open their tab. -->
          <section hero class="mpo-summary mpo-summary--edit" id="purchase-overview" tabindex="-1" aria-labelledby="mpo-edit-title">
            <div class="mpo-summary__top">
              <span class="mpo-summary__eyebrow">Container bewerken</span>
              <span class="wk-pill" [class]="statusTone(data.order.status)"><span class="wk-pill__dot" aria-hidden="true"></span>{{ statusText(data.order.status) }}</span>
            </div>
            <h1 id="mpo-edit-title" class="mpo-summary__title" [title]="containerName(data.order)">{{ containerName(data.order) }}</h1>
            <p class="mpo-summary__sub" [title]="data.order.alias ? data.order.number + ' · ' + supplierName() : supplierName()">{{ data.order.alias ? data.order.number + ' · ' + supplierName() : supplierName() }}</p>
            <div class="mpo-tiles">
              <!-- The fill as the value, the pieces below it: an overfull container's '103% · 12.400 st' never runs past the tile. -->
              @let ladingFill = isDdp() ? null : data.costing.containerFill;
              @let ladingPieces = (data.costing.totals.pieces | num) + ' st';
              @let lading = ladingFill ? (ladingFill.fillPercent | num: 0) + '%' : ladingPieces;
              <button class="mpo-tile mpo-tile--neutral" type="button" [attr.aria-label]="'Lading ' + lading + (ladingFill ? ', ' + ladingPieces : '') + ', naar Producten'"
                      (click)="jumpToSection('purchase-products-section')">
                <span class="mpo-tile__label">Lading</span>
                <span class="mpo-tile__value" [class.mpo-tile__value--long]="lading.length > 10"
                      [class.fill-pct--full]="!!ladingFill && ladingFill.overflowCbm <= 0 && ladingFill.fillPercent >= 97"
                      [class.fill-pct--over]="!!ladingFill && ladingFill.fillPercent > 100 && ladingFill.fillPercent <= 105"
                      [class.fill-pct--danger]="!!ladingFill && ladingFill.fillPercent > 105">{{ lading }}</span>
                @if (ladingFill) { <span class="mpo-tile__sub">{{ ladingPieces }}</span> }
                <app-icon class="mpo-tile__chev" name="chevron-right" [size]="14" />
              </button>
              @let landed = data.costing.totals.totalEur | eur;
              <button class="mpo-tile mpo-tile--landed" type="button" [attr.aria-label]="'Totaal geland ' + landed + ', naar Kosten'" (click)="jumpToSection('purchase-costs-section')">
                <span class="mpo-tile__label">Totaal geland</span>
                <span class="mpo-tile__value" [class.mpo-tile__value--long]="landed.length > 10">{{ landed }}</span>
                <app-icon class="mpo-tile__chev" name="chevron-right" [size]="14" />
              </button>
            </div>
          </section>
          <div below class="ios-subbar mpo-tabs">
            <app-segmented class="ios-seg--stacked" variant="ios" semantics="tabs" label="Onderdelen van deze container" controls="mpo-panes"
                           [options]="tabOptions()" [value]="phoneTab()" (changed)="setPhoneTab($any($event))" (click)="tabsClicked($event)" />
          </div>
        </app-ios-nav>

        <div id="mpo-panes" class="mpo-panes">
          <!-- ===== Overzicht ===== -->
          <section class="mpo-pane" id="mpo-pane-overzicht" role="tabpanel" aria-label="Overzicht" [hidden]="phoneTab() !== 'overzicht'">
            @if (isReceived()) {
              <div class="ios-banner ios-banner--info mpo-received" role="status">
                @if (data.order.stockBooked === false) {
                  <span><b>Ontvangst gesloten.</b> Ontvangen, nog niet bijgeboekt: de stuks staan nog niet in de voorraad.</span>
                  <button class="ios-capsule ios-capsule--sm ios-capsule--tinted" type="button" [disabled]="booking()" (click)="stepOpen.set('BIJBOEKEN')">Bijboeken</button>
                } @else {
                  <span><b>Ontvangst gesloten.</b> De voorraad is bijgeboekt. Producten en aantallen staan vast; notities en kostengegevens kun je nog corrigeren.</span>
                }
              </div>
            }
            @if (data.attention?.length) {
              <div class="ios-banner mpo-attention" role="status">
                <span class="mpo-attention__count" aria-hidden="true">{{ data.attention!.length }}</span>
                <span class="mpo-attention__body"><b>Actie vereist</b>@for (item of data.attention; track item) { <span>{{ item }}</span> }</span>
              </div>
            }
            <app-purchase-nacalc-glance [nacalc]="nacalc()" [state]="paymentState()" (open)="jumpToSection('purchase-result-section')" />

            <div id="purchase-order-section" tabindex="-1">
              <section class="ios-section" aria-labelledby="mpo-supplier-title">
                <div class="ios-section__head"><h2 id="mpo-supplier-title">Leverancier</h2></div>
                <div class="ios-group ios-group--icons">
                  <div class="ios-cell ios-cell--tall">
                    <span class="ios-cell__lead"><span class="ios-tile tone-accent" aria-hidden="true">{{ supplierName().charAt(0) }}</span></span>
                    <span class="ios-cell__body">
                      <span class="ios-cell__title ios-cell__title--strong mpo-wrap">{{ supplierName() }}</span>
                      <span class="ios-cell__sub"><app-supplier-address [supplier]="supplier()" [inline]="true" [showEmpty]="true" /></span>
                    </span>
                    <span class="ios-cell__trail"><span class="ios-cell__value">{{ supplier()?.currency }}</span></span>
                  </div>
                </div>
              </section>

              <section class="ios-section" aria-labelledby="mpo-order-title">
                <div class="ios-section__head"><h2 id="mpo-order-title">Order</h2></div>
                <div class="ios-group">
                  <label class="ios-cell mpo-field-row" for="po-number">
                    <span class="ios-cell__body"><span class="ios-cell__title">Ordernummer</span></span>
                    <input #numberInput class="mpo-input mpo-input--wide" id="po-number" type="text" autocomplete="off" enterkeyhint="done"
                           [value]="data.order.number" (change)="setNumber(numberInput)" />
                  </label>
                  <label class="ios-cell mpo-field-row mpo-field-row--stack" for="po-alias">
                    <span class="ios-cell__body"><span class="ios-cell__title">Herkenbare naam</span>
                      <span class="ios-cell__sub mpo-wrap">Om calculatievarianten uit elkaar te houden</span></span>
                    <input class="mpo-input mpo-input--wide" id="po-alias" type="text" autocomplete="off" [ngModel]="data.order.alias"
                           (ngModelChange)="patch({ alias: $event })" placeholder="Bijv. voorjaar, kleurvariant…" />
                  </label>
                  <div class="ios-cell mpo-field-row">
                    <span class="ios-cell__body"><label class="ios-cell__title" for="po-date">Orderdatum</label></span>
                    <span class="mpo-date"><app-date-field fieldId="po-date" [value]="data.order.orderDate" (valueChange)="patch({ orderDate: $event })" /></span>
                  </div>
                  @if (!isReceived()) {
                    <div class="ios-cell mpo-field-row">
                      <span class="ios-cell__body"><label class="ios-cell__title" for="po-expected">Verwacht op</label>
                        <span class="ios-cell__sub mpo-wrap">Producten tonen dit als ‘te verwachten’</span></span>
                      <span class="mpo-date"><app-date-field fieldId="po-expected" [value]="data.order.expectedArrival ?? ''" (valueChange)="patch({ expectedArrival: $event || null })" /></span>
                    </div>
                  } @else {
                    <div class="ios-cell mpo-field-row">
                      <span class="ios-cell__body"><label class="ios-cell__title" for="po-received">Ontvangen op</label>
                        <span class="ios-cell__sub mpo-wrap">Corrigeer als de container op een andere dag binnenkwam</span></span>
                      <span class="mpo-date"><app-date-field fieldId="po-received" [value]="data.order.receivedOn ?? ''" (valueChange)="$event && patch({ receivedOn: $event })" /></span>
                    </div>
                  }
                  <button class="ios-cell" id="po-terms" type="button" [disabled]="saving() || payingBusy() || paymentPlanBusy()" (click)="openPaymentPlan()">
                    <span class="ios-cell__body"><span class="ios-cell__title">Betaalplan</span>
                      <span class="ios-cell__sub mpo-wrap">Bij Betalingen zie je per termijn wat open staat.</span></span>
                    <span class="ios-cell__trail"><span class="ios-cell__value mpo-value">{{ planLabel(data.order) }}</span></span>
                    <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                  </button>
                  @if (data.order.status !== 'CONCEPT') {
                    <label class="ios-cell mpo-field-row mpo-field-row--stack" for="mpo-tracking">
                      <span class="ios-cell__body"><span class="ios-cell__title">Track &amp; trace</span>
                        @if (data.order.shippedOn) { <span class="ios-cell__sub">Vertrokken op {{ data.order.shippedOn | dateNl }}</span> }</span>
                      <input class="mpo-input mpo-input--wide" id="mpo-tracking" type="text" autocomplete="off" placeholder="Containernummer, B/L of link van de rederij"
                             [ngModel]="data.order.trackingReference ?? ''" (ngModelChange)="patch({ trackingReference: $event || null })" />
                    </label>
                  }
                </div>
              </section>

              <section class="ios-section" aria-labelledby="mpo-route-title">
                <div class="ios-section__head"><h2 id="mpo-route-title">Route en container</h2></div>
                <div class="ios-group">
                  <label class="ios-cell mpo-field-row mpo-field-row--pick" for="po-container">
                    <span class="ios-cell__body"><span class="ios-cell__title">Type container</span></span>
                    <span class="mpo-pick"><select class="mpo-select" id="po-container" [ngModel]="data.order.containerType" (ngModelChange)="patch({ containerType: $event })">
                      @for (type of containerTypes; track type.value) { <option [value]="type.value">{{ type.label }}</option> }
                    </select><app-icon name="chevron-down" [size]="14" /></span>
                  </label>
                  <label class="ios-cell mpo-field-row mpo-field-row--pick" for="po-departure-port">
                    <span class="ios-cell__body"><span class="ios-cell__title">Vertrekhaven</span></span>
                    <span class="mpo-pick"><select class="mpo-select" id="po-departure-port"
                            [ngModel]="portSelection(data.order.departurePort, departurePorts, customDeparturePort())" (ngModelChange)="selectDeparturePort($event)">
                      @for (port of departurePorts; track port.value) { <option [value]="port.value">{{ port.label }}</option> }
                      <option [value]="otherPortValue">Andere haven…</option>
                    </select><app-icon name="chevron-down" [size]="14" /></span>
                  </label>
                  @if (usesCustomDeparturePort(data.order.departurePort)) {
                    <label class="ios-cell mpo-field-row mpo-field-row--stack" for="po-custom-departure-port">
                      <span class="ios-cell__body"><span class="ios-cell__title">Andere vertrekhaven</span></span>
                      <input class="mpo-input mpo-input--wide" id="po-custom-departure-port" autocomplete="off" placeholder="Typ de vertrekhaven"
                             [value]="customPortInput(data.order.departurePort, departurePorts, customDeparturePort())"
                             (blur)="setCustomDeparturePort($any($event.target).value)" />
                    </label>
                  }
                  <label class="ios-cell mpo-field-row mpo-field-row--pick" for="po-destination-port">
                    <span class="ios-cell__body"><span class="ios-cell__title">Aankomsthaven</span></span>
                    <span class="mpo-pick"><select class="mpo-select" id="po-destination-port"
                            [ngModel]="portSelection(data.order.destinationPort, destinationPorts, customDestinationPort(), 'Rotterdam')" (ngModelChange)="selectDestinationPort($event)">
                      @for (port of destinationPorts; track port.value) { <option [value]="port.value">{{ port.label }}</option> }
                      <option [value]="otherPortValue">Andere haven…</option>
                    </select><app-icon name="chevron-down" [size]="14" /></span>
                  </label>
                  @if (usesCustomDestinationPort(data.order.destinationPort)) {
                    <label class="ios-cell mpo-field-row mpo-field-row--stack" for="po-custom-destination-port">
                      <span class="ios-cell__body"><span class="ios-cell__title">Andere aankomsthaven</span></span>
                      <input class="mpo-input mpo-input--wide" id="po-custom-destination-port" autocomplete="off" placeholder="Typ de aankomsthaven"
                             [value]="customPortInput(data.order.destinationPort, destinationPorts, customDestinationPort())"
                             (blur)="setCustomDestinationPort($any($event.target).value)" />
                    </label>
                  }
                  <!-- What the container means for the VAT return (vat-return.ts): the purchase alone, an acquisition
                       or import VAT. A suggestion follows the port until it is confirmed here. -->
                  <label class="ios-cell mpo-field-row mpo-field-row--stack" for="po-clearance">
                    <span class="ios-cell__body"><span class="ios-cell__title">Inklaring</span>
                      <span class="ios-cell__sub mpo-wrap">bepaalt de btw-aangifte@if (!data.order.clearance) {<span class="warn-text"> · te bevestigen</span>}</span></span>
                    <span class="mpo-pick mpo-pick--wide"><select class="mpo-select" id="po-clearance" [ngModel]="data.order.clearance ?? ''" (ngModelChange)="patch({ clearance: $event || null })">
                      <option value="">Voorstel: {{ suggestedClearanceLabel(data.order.destinationPort) }}</option>
                      @for (option of clearanceOptions; track option.value) { <option [value]="option.value">{{ option.label }}</option> }
                    </select><app-icon name="chevron-down" [size]="14" /></span>
                  </label>
                  <!-- Where the container is unloaded: the stock of every line lands there on Ontvangen. -->
                  <label class="ios-cell mpo-field-row mpo-field-row--pick" for="po-receiving">
                    <span class="ios-cell__body"><span class="ios-cell__title">Lossen op</span></span>
                    <span class="mpo-pick"><select class="mpo-select" id="po-receiving" [ngModel]="data.order.receivingLocationId ?? mainLocationId()" (ngModelChange)="patch({ receivingLocationId: +$event })">
                      @for (location of stockLocations(); track location.id) { <option [value]="location.id">{{ location.name }}</option> }
                    </select><app-icon name="chevron-down" [size]="14" /></span>
                  </label>
                </div>
                <p class="ios-section__foot">Bepaalt de btw-aangifte. In Nederland klaart de fiscaal vertegenwoordiger in. Blijft daar en wordt daar verkocht (btw verlegd naar de klant): alleen de aankoop, rooster 81. Via Nederland naar ons in België: ook 86/55/59. Inklaring in België: 81 en de invoer-btw.</p>
              </section>

              <section class="ios-section" aria-labelledby="mpo-basis-title">
                <div class="ios-section__head"><h2 id="mpo-basis-title">Prijsbasis en munt</h2></div>
                <div class="ios-group">
                  <div class="ios-cell mpo-seg-row"><app-segmented variant="ios" label="Prijsbasis" [options]="basisOptions" [value]="isDdp() ? 'DDP' : isCif() ? 'CIF' : 'EXW'" (changed)="setOrderBasis($any($event))" /></div>
                  <div class="ios-cell mpo-seg-row"><app-segmented variant="ios" label="Munt van de leverancier" [options]="currencyOptions" [value]="orderCurrency()" (changed)="setOrderCurrency($any($event))" /></div>
                </div>
                <p class="ios-section__foot">@if (isDdp()) { Geleverd incl. rechten, voor de hele container: zeevracht en invoerrechten stappen opzij. } @else if (isCif()) { CIF: de leverancier regelt en factureert zeevracht (en lokale kosten China); invoerrechten en lokale kosten aankomst via Douane &amp; transport. } @else { Af fabriek: wij regelen zeevracht, invoerrechten en transport. } De stukprijzen staan in {{ orderCurrency() }}.</p>
              </section>
            </div>

            <div class="mpo-partner">
              <app-purchase-partner-panel [order]="data.order" [docs]="partnerDocs()" [advanceBasisEur]="data.costing.totals.totalWithSeparateCostsEur ?? null" [canQuote]="quoteLines().length > 0" [canAuction]="auctionLines().length > 0" (saved)="onPartnerSaved($event)" (quote)="quoteOpen.set(true)" (link)="partnerSheetOpen.set(true)" (auction)="auctionOpen.set(true)" (schedule)="jumpToSection('purchase-partner-section')" (unlink)="unlinkPartnerDoc($event)" />
            </div>
          </section>

          <!-- ===== Producten ===== -->
          <section class="mpo-pane" id="mpo-pane-producten" role="tabpanel" aria-label="Producten" [hidden]="phoneTab() !== 'producten'">
            <div id="purchase-products-section" tabindex="-1" aria-labelledby="mpo-edit-products-title">
              <div class="mpo-head">
                <span class="ios-tile ios-tile--lg ios-tile--soft tone-accent" aria-hidden="true"><app-icon name="products" [size]="19" /></span>
                <div class="mpo-head__copy"><h2 id="mpo-edit-products-title">Producten</h2>
                  <p>{{ data.costing.lines.length }} regels · {{ data.costing.totals.cartons | num }} dozen</p></div>
                <button class="ios-capsule ios-capsule--sm ios-capsule--tinted" type="button" [disabled]="isReceived()" (click)="openPicker()">＋ Product</button>
              </div>

              @if (isDdp()) {
                <section class="ios-card mpo-fill" id="purchase-capacity-section" tabindex="-1" aria-label="Lading">
                  <div class="mpo-fill__top">
                    <div class="mpo-fill__copy"><h3 class="mpo-fill__title">Geleverd DDP</h3>
                      <p class="mpo-fill__sub">{{ data.costing.totals.cbm | cbm }} · {{ data.costing.totals.cartons | num }} dozen · transport en rechten in de prijs</p></div>
                    <strong class="mpo-fill__pct">{{ data.costing.totals.pieces | num }} st</strong>
                  </div>
                </section>
              } @else if (data.costing.containerFill; as fill) {
                <section class="ios-card mpo-fill" id="purchase-capacity-section" tabindex="-1" aria-labelledby="mpo-edit-fill-title">
                  <div class="mpo-fill__top">
                    <div class="mpo-fill__copy"><h3 class="mpo-fill__title" id="mpo-edit-fill-title">Containervulling</h3>
                      <p class="mpo-fill__sub">{{ fill.containerCode }} · {{ fill.usedCbm | cbm }} van {{ fill.capacityCbm | cbm }}</p></div>
                    <strong class="mpo-fill__pct" [class.fill-pct--over]="fill.fillPercent > 100 && fill.fillPercent <= 105" [class.fill-pct--danger]="fill.fillPercent > 105"
                            [class.fill-pct--full]="fill.overflowCbm <= 0 && fill.fillPercent >= 97">{{ fill.fillPercent | pct: 0 }}</strong>
                  </div>
                  <div class="wk-meter" role="meter" aria-label="Containervulling" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="fill.fillPercent">
                    <i [class.tone-ok]="fill.fillPercent <= 100" [class.tone-warn]="fill.fillPercent > 100 && fill.fillPercent <= 105" [class.tone-danger]="fill.fillPercent > 105"
                       [style.width.%]="fill.fillPercent > 100 ? 100 : fill.fillPercent"></i>
                  </div>
                  <div class="mpo-fill__foot">
                    @if (fill.fillPercent > 105) {
                      <span class="mpo-fill__state mpo-fill__state--danger"><span aria-hidden="true">!</span> {{ fill.overflowCbm | cbm }} te veel · minimaal {{ containerCountForFill(fill) }} containers nodig</span>
                    } @else if (fill.fillPercent > 100) {
                      <span class="mpo-fill__state mpo-fill__state--tight"><span aria-hidden="true">!</span> {{ fill.overflowCbm | cbm }} boven de container - past vaak nog net</span>
                    } @else {
                      <span class="mpo-fill__state mpo-fill__state--ok"><span aria-hidden="true">✓</span> {{ fill.freeCbm | cbm }} vrije ruimte</span>
                    }
                    <span>{{ data.costing.totals.cartons | num }} dozen geladen</span>
                  </div>
                </section>
              }

              @if (data.costing.lines.length) {
                <div class="mpo-rate"><span>Geland</span>
                  <app-segmented variant="ios" label="Bedragen tonen als" [options]="amountModes" [value]="perPiece() ? 'piece' : 'total'" (changed)="perPiece.set($event === 'piece')" />
                </div>
                @for (section of lineSections(); track section.key) {
                  <section class="ios-section" [attr.aria-labelledby]="'purchase-line-category-' + section.key">
                    <div class="ios-section__head"><h2 [id]="'purchase-line-category-' + section.key">{{ section.label }}</h2>
                      <span class="ios-section__trail">{{ section.lines.length }} product{{ section.lines.length === 1 ? '' : 'en' }}</span></div>
                    @for (familyGroup of section.families; track familyGroup.key) {
                      <div class="ios-group ios-group--thumbs mpo-family" role="group" [attr.aria-labelledby]="'purchase-line-family-' + familyGroup.key">
                        <div class="ios-cell mpo-family__head">
                          <span class="ios-cell__body">
                            <span class="ios-cell__title ios-cell__title--strong mpo-wrap" [id]="'purchase-line-family-' + familyGroup.key">{{ familyGroup.label }}
                              @if (familyGroup.swatches.length) {
                                <span class="mpo-swatches" [attr.aria-label]="'Kleuren in ' + familyGroup.label">
                                  @for (swatch of familyGroup.swatches; track swatch.key) {
                                    <i class="line-colour-dot" [class.line-colour-dot--empty]="!colourHex(swatch.hex, swatch.label)"
                                       [style.background]="colourHex(swatch.hex, swatch.label) || 'transparent'" [title]="swatch.label"></i>
                                  }
                                </span>
                              }
                            </span>
                            <span class="ios-cell__sub">{{ familyGroup.familyId === null ? 'Los product' : 'Productreeks' }} · {{ familyGroup.lines.length }} {{ familyGroup.lines.length === 1 ? 'variant' : 'varianten' }}</span>
                            <span class="ios-cell__sub mpo-wrap">{{ familyGroup.pieces | num }} st · {{ familyGroup.cartons | num }} dozen · {{ familyGroup.cbm | cbm }}</span>
                          </span>
                          <span class="ios-cell__trail">
                            <span class="ios-cell__value ios-cell__value--strong">{{ perPiece() ? landedRangeText(familyGroup.unitMinEur, familyGroup.unitMaxEur) : (familyGroup.totalEur | eur) }}</span>
                            <span class="ios-cell__meta">{{ perPiece() ? 'Geland / stuk' : 'Totaal geland' }}</span>
                          </span>
                        </div>
                        @for (line of familyGroup.lines; track line.productId) {
                          @let display = setPiecesOf(line.productId);
                          @let ordered = shortShipped(line.productId);
                          @let cartonNote = isReceived() ? null : cartonNotice(draftQuantity(line.productId, line.quantity), line.productId);
                          <div class="ios-swipe" appSwipeActions #sw="swipeActions" [swipeEnd]="1" swipeFull="none" [swipeDisabled]="isReceived()">
                            <div class="ios-swipe__actions ios-swipe__actions--end">
                              <button class="ios-swipe__btn tone-danger" type="button" [attr.aria-label]="'Verwijder ' + line.productName" [disabled]="isReceived()" (click)="removeLine(line.productId); sw.close()">
                                <app-icon name="trash" [size]="18" />Verwijder</button>
                            </div>
                            <div class="ios-swipe__row">
                              <div class="ios-cell mpo-line">
                                <span class="ios-cell__lead">
                                  @if (photoOf(line.productId); as photo) { <img class="ios-thumb" [appAuthSrc]="photo" alt="" draggable="false" /> }
                                  @else { <span class="ios-tile tone-grey mpo-line__index" aria-hidden="true">{{ purchaseLineNumber(line.productId) }}</span> }
                                </span>
                                <span class="ios-cell__body mpo-line__body" role="button" tabindex="0" [attr.aria-label]="'Regel ' + line.productName + ' bewerken'"
                                      (click)="lineSheet.set(line.productId)" (keydown.enter)="lineSheet.set(line.productId)"
                                      (keydown.space)="$event.preventDefault(); lineSheet.set(line.productId)">
                                  <span class="ios-cell__title mpo-wrap">{{ line.productName }}</span>
                                  @if (productVariantLabel(line.productId); as variant) {
                                    <span class="ios-cell__sub mpo-wrap">@if (productColour(line.productId)) { <i class="line-colour-dot" [class.line-colour-dot--empty]="!productColourHex(line.productId)"
                                      [style.background]="productColourHex(line.productId) || 'transparent'" aria-hidden="true"></i> }{{ variant }}</span>
                                  }
                                  <span class="ios-cell__sub mpo-wrap">{{ line.cartons | num }} dozen · {{ line.cbm | cbm }}</span>
                                  <span class="ios-cell__sub mpo-wrap">@if (rowPriceText(line.productId); as price) {<span class="mpo-nowrap">{{ price }}</span> · }<span class="mpo-nowrap">{{ line.landedUnitEur | eurUp: 3 }}{{ display ? ' /display' : '' }} geland</span></span>
                                </span>
                                <span class="mpo-line__qty">
                                  <input class="mpo-input mpo-qty" [id]="'qty-' + line.productId" type="number" min="0" step="1" inputmode="numeric"
                                         [attr.aria-label]="'Aantal stuks ' + line.productName" [disabled]="isReceived()"
                                         [ngModel]="quantityValue(line.productId, line.quantity)" (ngModelChange)="typeQuantity(line.productId, $event)"
                                         (blur)="leaveQuantity(line.productId)" /><span class="mpo-line__unit" aria-hidden="true">st</span>
                                </span>
                              </div>
                              @if (cartonNote || ordered) {
                                <div class="mpo-line__notes">
                                  @if (cartonNote) { <span role="status">{{ cartonNote }}</span> }
                                  @if (ordered) { <span class="warn-text">Besteld {{ ordered | num }} → ontvangen {{ line.quantity | num }}</span> }
                                </div>
                              }
                            </div>
                          </div>
                        }
                      </div>
                    }
                  </section>
                }
              } @else {
                <div class="ios-empty">
                  <span class="ios-empty__icon" aria-hidden="true"><app-icon name="products" [size]="26" /></span>
                  <h3 class="ios-empty__title">Bouw je container op</h3>
                  <p class="ios-empty__text">Voeg producten toe. Aantallen, dozen en containervulling worden direct doorgerekend.</p>
                  <button class="ios-capsule ios-capsule--accent" type="button" [disabled]="isReceived()" (click)="openPicker()">Eerste product toevoegen</button>
                </div>
              }
            </div>
          </section>

          <!-- ===== Kosten ===== -->
          <section class="mpo-pane" id="mpo-pane-kosten" role="tabpanel" aria-label="Kosten" [hidden]="phoneTab() !== 'kosten'">
            <div id="purchase-costs-section" tabindex="-1" aria-labelledby="mpo-edit-costs-title">
              <div class="mpo-head">
                <span class="ios-tile ios-tile--lg ios-tile--soft tone-teal" aria-hidden="true"><app-icon name="tag" [size]="19" /></span>
                <div class="mpo-head__copy"><h2 id="mpo-edit-costs-title">Kosten</h2><p>{{ isDdp() ? 'DDP & koers' : 'Transport, invoer & koers' }}</p></div>
              </div>

              <section class="ios-section" aria-labelledby="exchange-title">
                <div class="ios-section__head"><h2 id="exchange-title">Wisselkoersen</h2></div>
                <div class="ios-group">
                  <div class="ios-cell mpo-field-row">
                    <span class="ios-cell__body"><label class="ios-cell__title" for="r-cny">RMB naar USD</label>
                      @if (marketRates(); as market) {
                        <span class="ios-cell__sub mpo-wrap">ECB {{ marketReference()!.cnyToUsd | num: 4 }} · met {{ market.marginPct }} % marge {{ market.cnyToUsd | num: 4 }}@if (data.order.cnyToUsd !== market.cnyToUsd) { · <button class="linklike" type="button" (click)="patch({ cnyToUsd: market.cnyToUsd })">overnemen</button> }</span>
                      }</span>
                    <input class="mpo-input" id="r-cny" type="number" step="0.0001" inputmode="decimal" [ngModel]="data.order.cnyToUsd" (ngModelChange)="patch({ cnyToUsd: +$event })" />
                  </div>
                  <div class="ios-cell mpo-field-row">
                    <span class="ios-cell__body"><label class="ios-cell__title" for="r-usd">USD naar EUR</label>
                      @if (marketRates(); as market) {
                        <span class="ios-cell__sub mpo-wrap">ECB {{ marketReference()!.usdToEur | num: 4 }} · met {{ market.marginPct }} % marge {{ market.usdToEur | num: 4 }}@if (usdToEurRate() !== market.usdToEur) { · <button class="linklike" type="button" (click)="setUsdToEur(market.usdToEur)">overnemen</button> }</span>
                      }
                      <span class="ios-cell__sub mpo-wrap">Geldt voor goederen én transport.</span></span>
                    <input class="mpo-input" id="r-usd" type="number" step="0.0001" inputmode="decimal" [ngModel]="usdToEurRate()" (ngModelChange)="setUsdToEur(+$event)" />
                  </div>
                </div>
                <p class="ios-section__foot">Eén USD-koers houdt goederen en transport consequent gelijk.</p>
              </section>

              <section class="ios-section" aria-labelledby="route-costs-title">
                <div class="ios-section__head"><h2 id="route-costs-title">{{ isDdp() ? 'Geleverd incl. rechten' : 'Van fabriek tot magazijn' }}</h2></div>
                <div class="ios-group">
                  @if (!isDdp()) {
                    <div class="ios-cell mpo-field-row">
                      <span class="ios-cell__body"><label class="ios-cell__title mpo-wrap" for="c-freight">{{ costLabels().seaFreightLabel }}</label>
                        <span class="ios-cell__sub mpo-wrap">{{ costLabels().seaFreightRoute }}
                          @if (isCif()) {
                            · betaald aan de leverancier (CIF)
                          } @else if (latestFreightReference(); as reference) {
                            · laatste eigen notering: <b>{{ reference.usdPerContainer | cur: 'USD' }}</b> · {{ reference.quotedOn | dateNl }}
                          } @else if (data.order.containerType === 'TWENTY_GP') {
                            · vul een eigen 20 ft-offerte in; een 40 ft-notering wordt niet hergebruikt
                          }</span></span>
                      <span class="mpo-affix"><input class="mpo-input" id="c-freight" type="number" step="50" min="0" inputmode="decimal" [ngModel]="data.order.freightUsd" (ngModelChange)="patch({ freightUsd: +$event })" /><span class="mpo-affix__unit">USD</span></span>
                    </div>
                    <div class="ios-cell mpo-field-row">
                      <span class="ios-cell__body"><label class="ios-cell__title mpo-wrap" for="c-origin">{{ costLabels().originCostsLabel }}</label>
                        <span class="ios-cell__sub mpo-wrap">{{ costLabels().originRoute }} · voortransport en exportdocumenten.</span></span>
                      <span class="mpo-affix"><input class="mpo-input" id="c-origin" type="number" step="50" min="0" inputmode="decimal" [ngModel]="data.order.originCosts" (ngModelChange)="patch({ originCosts: +$event })" />
                        <select class="mpo-select mpo-affix__unit" aria-label="Munt lokale oorsprongskosten" [ngModel]="data.order.originCurrency" (ngModelChange)="patch({ originCurrency: $event })">
                          <option value="USD">USD</option><option value="CNY">CNY</option><option value="EUR">EUR</option>
                        </select></span>
                    </div>
                    <div class="ios-cell mpo-field-row">
                      <span class="ios-cell__body"><label class="ios-cell__title mpo-wrap" for="c-dest">{{ costLabels().destinationCostsLabel }}</label>
                        <span class="ios-cell__sub mpo-wrap">Trucking en afhandeling na invoer.</span></span>
                      <span class="mpo-affix"><input class="mpo-input" id="c-dest" type="number" step="25" min="0" inputmode="decimal" [ngModel]="data.order.destinationCostsEur" (ngModelChange)="patch({ destinationCostsEur: +$event })" /><span class="mpo-affix__unit">EUR</span></span>
                    </div>
                    <div class="ios-cell mpo-field-row">
                      <span class="ios-cell__body"><label class="ios-cell__title mpo-wrap" for="c-duty">Invoerrecht zonder HS-code</label></span>
                      <span class="mpo-affix"><input class="mpo-input" id="c-duty" type="number" step="0.5" min="0" inputmode="decimal" [ngModel]="data.order.defaultDutyRatePct" (ngModelChange)="patch({ defaultDutyRatePct: +$event })" /><span class="mpo-affix__unit">%</span></span>
                    </div>
                  }
                  <!-- Our own costs side by side: the Enrosed kost goes into the piece price, the inspection stays a line of its own. -->
                  <div class="ios-cell mpo-field-row">
                    <span class="ios-cell__body"><label class="ios-cell__title" for="c-extra">Enrosed kost</label>
                      <span class="ios-cell__sub mpo-wrap">In de stukprijs · {{ manualExtra() ? 'zelf verdeeld per product' : 'verdeeld ' + allocationLabel(data.order.allocExtra) }}@if (!manualExtra()) { · <button class="linklike" type="button" (click)="openManualSplit()">zelf verdelen per product</button> }</span></span>
                    <span class="mpo-affix"><input class="mpo-input" id="c-extra" type="number" step="100" min="0" inputmode="decimal" [ngModel]="data.order.extraRevenueEur" (ngModelChange)="patch({ extraRevenueEur: +$event })" /><span class="mpo-affix__unit">EUR</span></span>
                  </div>
                  <div class="ios-cell mpo-field-row">
                    <span class="ios-cell__body"><label class="ios-cell__title" for="c-inspection">Inspectiekost</label>
                      <span class="ios-cell__sub mpo-wrap">{{ separateCaption() }}</span></span>
                    <span class="mpo-affix"><input class="mpo-input" id="c-inspection" type="number" step="50" min="0" inputmode="decimal" [ngModel]="data.order.inspectionCostEur"
                           (ngModelChange)="patch({ inspectionCostEur: $event === '' || $event === null ? null : +$event })" /><span class="mpo-affix__unit">EUR</span></span>
                  </div>
                  @if (manualExtra()) {
                    <div class="ios-cell mpo-block">
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
                    </div>
                  }
                  @for (cost of data.order.otherCosts ?? []; track $index; let i = $index) {
                    <div class="ios-cell mpo-other">
                      <input class="mpo-input mpo-input--wide mpo-other__name" type="text" maxlength="60" placeholder="Naam, bv. certificaat"
                             [attr.aria-label]="'Naam andere kost ' + (i + 1)" [ngModel]="cost.label" (ngModelChange)="setOtherCost(i, { label: $event })" />
                      <span class="mpo-affix"><input class="mpo-input" type="number" step="50" min="0" inputmode="decimal" [attr.aria-label]="'Bedrag andere kost ' + (i + 1)"
                             [ngModel]="cost.amountEur" (ngModelChange)="setOtherCost(i, { amountEur: $event === '' || $event === null ? null : +$event })" /><span class="mpo-affix__unit">EUR</span></span>
                      <button class="ios-circle mpo-other__remove" type="button" [attr.aria-label]="'Verwijder ' + (cost.label || 'andere kost')" (click)="removeOtherCost(i)"><app-icon name="close" [size]="16" /></button>
                    </div>
                  }
                  <button class="ios-cell ios-cell--action" type="button" (click)="addOtherCost()">
                    <span class="ios-cell__body"><span class="ios-cell__title mpo-link">+ Andere kost</span>
                      <span class="ios-cell__sub mpo-wrap">certificaat, labo, staal … {{ separateInPiece() ? 'in de stukprijs verdeeld' : 'apart, achteraf' }}</span></span>
                  </button>
                </div>
                <p class="ios-section__foot">{{ isDdp() ? 'De afgesproken prijzen zijn DDP: transport, lokale kosten en invoerrechten zitten erin en worden niet bijgerekend.' : 'Kosten vóór de EU-grens tellen mee in de douanewaarde.' }}</p>
              </section>

              <section class="ios-section">
                <div class="ios-group">
                  <button class="ios-cell mpo-keys" type="button" aria-haspopup="dialog" (click)="keysOpen.set(true)">
                    <span class="ios-cell__body"><span class="ios-cell__title">Verdeelsleutels</span>
                      <span class="ios-cell__sub mpo-wrap">Geavanceerd · hoe containerkosten over producten worden verdeeld</span></span>
                    <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                  </button>
                </div>
              </section>
            </div>

            <section class="ios-section" id="purchase-summary-section" tabindex="-1" aria-labelledby="mpo-summary-title">
              <div class="ios-section__head"><h2 id="mpo-summary-title">Totale kostprijs</h2>
                <span class="ios-section__trail">{{ data.costing.totals.pieces | num }} st · {{ data.costing.totals.cartons | num }} dozen</span></div>
              @if (isDdp()) {
                <!-- DDP: the supplier's container, not ours - what we get is the volume and the count. -->
                <div class="ios-card mpo-fill">
                  <div class="mpo-fill__top">
                    <div class="mpo-fill__copy"><h3 class="mpo-fill__title">Geleverd DDP</h3>
                      <p class="mpo-fill__sub">{{ data.costing.totals.cbm | cbm }} · {{ data.costing.totals.cartons | num }} dozen</p></div>
                    <strong class="mpo-fill__pct">{{ data.costing.totals.pieces | num }} st</strong>
                  </div>
                </div>
              } @else if (data.costing.containerFill; as fill) {
                <div class="ios-card mpo-fill">
                  <div class="mpo-fill__top">
                    <div class="mpo-fill__copy"><h3 class="mpo-fill__title">{{ containerLabel(data.order.containerType) }}</h3>
                      <p class="mpo-fill__sub">{{ fill.usedCbm | cbm }} van {{ fill.capacityCbm }} m³</p></div>
                    <strong class="mpo-fill__pct" [class.fill-pct--full]="fill.overflowCbm <= 0 && fill.fillPercent >= 97"
                            [class.fill-pct--over]="fill.fillPercent > 100 && fill.fillPercent <= 105" [class.fill-pct--danger]="fill.fillPercent > 105">{{ fill.fillPercent | num: 0 }}%</strong>
                  </div>
                  <div class="wk-meter" role="meter" aria-label="Containervulling" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="fill.fillPercent">
                    <i [class.tone-ok]="fill.fillPercent <= 100" [class.tone-warn]="fill.fillPercent > 100 && fill.fillPercent <= 105" [class.tone-danger]="fill.fillPercent > 105"
                       [style.width.%]="fill.fillPercent > 100 ? 100 : fill.fillPercent"></i>
                  </div>
                  @if (fill.fillPercent > 105) {
                    <p class="mpo-fill__alert mpo-fill__alert--danger"><b>{{ fill.fillPercent | num: 0 }}%</b> · te vol voor één {{ containerLabel(data.order.containerType) }}:
                      <b>{{ fill.overflowCbm | cbm }} te veel</b>. Op basis van volume zijn minimaal <b>{{ containerCountForFill(fill) }} containers</b> nodig;
                      splits de order of kies een groter type.</p>
                  } @else if (fill.fillPercent > 100) {
                    <!-- Just over the line: often still loadable with clever stacking. -->
                    <p class="mpo-fill__alert"><b>{{ fill.fillPercent | num: 0 }}%</b> · {{ fill.overflowCbm | cbm }} boven de {{ containerLabel(data.order.containerType) }}.
                      Vaak past dit nog net; reken niet op meer.</p>
                  }
                </div>
              }
              @if (!isDdp()) {
                <div class="ios-figures">
                  <div><small>Bovenop de goederen</small><strong>+ {{ data.costing.totals.totalEur - data.costing.totals.goodsEur | eur }}</strong>
                    <small>@if (data.costing.totals.goodsEur > 0) { {{ overheadPct(data.costing.totals) | num }} % van de inkoop } @else { nog geen goederen geladen }</small></div>
                  <div><small>Totaal geland</small><strong class="mpo-accent">{{ data.costing.totals.totalEur | eur }}</strong></div>
                </div>
              }
            <section class="ios-section">
              <div class="ios-section__head"><h2>{{ isDdp() ? '1 · Goederen, geleverd incl. rechten' : '1 · Tot de EU-grens' }}</h2></div>
              <div class="ios-group">
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">{{ isDdp() ? 'Goederen (DDP)' : 'Goederen' }}</span>
                  <span class="ios-cell__sub mpo-wrap">{{ data.costing.totals.goodsUsd | cur: 'USD' }}{{ isDdp() ? ' · transport en rechten inbegrepen' : '' }}</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value mpo-amount">{{ data.costing.totals.goodsEur | eur }}</span></span></div>
                @if (!isDdp()) {
                  @if (data.costing.totals.originEur) {
                    <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title mpo-wrap">{{ costLabels().originCostsLabel }}</span>
                      <span class="ios-cell__sub mpo-wrap">{{ costLabels().originRoute }}</span></span>
                      <span class="ios-cell__trail"><span class="ios-cell__value mpo-amount">{{ data.costing.totals.originEur | eur }}</span></span></div>
                  }
                  <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title mpo-wrap">{{ costLabels().seaFreightLabel }}</span>
                    <span class="ios-cell__sub mpo-wrap">{{ costLabels().seaFreightRoute }}</span></span>
                    <span class="ios-cell__trail"><span class="ios-cell__value mpo-amount">{{ data.costing.totals.freightEur | eur }}</span></span></div>
                  <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--strong">Douanewaarde</span></span>
                    <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">{{ data.costing.totals.customsValueEur | eur }}</span></span></div>
                }
              </div>
            </section>
            <section class="ios-section">
              <div class="ios-section__head"><h2>{{ isDdp() ? '2 · Eigen kosten' : '2 · Invoer & aankomst' }}</h2></div>
              <div class="ios-group">
                @if (!isDdp()) {
                  <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Invoerrechten</span>
                    <span class="ios-cell__sub">gem. {{ data.costing.totals.effectiveDutyPct | pct: 1 }}</span></span>
                    <span class="ios-cell__trail"><span class="ios-cell__value mpo-amount">{{ data.costing.totals.dutyEur | eur }}</span></span></div>
                  <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title mpo-wrap">{{ costLabels().destinationCostsLabel }}</span></span>
                    <span class="ios-cell__trail"><span class="ios-cell__value mpo-amount">{{ data.costing.totals.destinationEur | eur }}</span></span></div>
                }
                @if (data.costing.totals.extraRevenueEur) {
                  <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Enrosed kost</span></span>
                    <span class="ios-cell__trail"><span class="ios-cell__value mpo-amount">{{ data.costing.totals.extraRevenueEur | eur }}</span></span></div>
                }
              </div>
            </section>
            @if (data.costing.totals.separateCostsEur) {
              <section class="ios-section">
                <div class="ios-section__head"><h2>In de stukprijs verdeeld</h2></div>
                <div class="ios-group">
                  @if (data.costing.totals.inspectionEur) {
                    <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Inspectie</span></span>
                      <span class="ios-cell__trail"><span class="ios-cell__value mpo-amount">{{ data.costing.totals.inspectionEur | eur }}</span></span></div>
                  }
                  @for (cost of data.costing.totals.otherCosts ?? []; track $index) {
                    <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title mpo-wrap">{{ cost.label }}</span></span>
                      <span class="ios-cell__trail"><span class="ios-cell__value mpo-amount">{{ cost.amountEur | eur }}</span></span></div>
                  }
                  <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--strong mpo-wrap">{{ separateCostsTotalLabel(data.costing.totals) }}</span></span>
                    <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">{{ data.costing.totals.totalWithSeparateCostsEur | eur }}</span></span></div>
                </div>
              </section>
            }
            <section class="ios-section">
              <div class="ios-section__head"><h2>3 · Totaal</h2></div>
              <div class="ios-group">
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--strong">Totaal geland</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong mpo-accent">{{ data.costing.totals.totalEur | eur }}</span></span></div>
              </div>
            </section>
            </section>
            <!-- Nacalculatie: what the container really cost, complete and never collapsed. Every action goes through the editor's sheets. -->
            <section class="mpo-result mpo-host" id="purchase-result-section" tabindex="-1" aria-label="Nacalculatie">
              <app-purchase-nacalc-overview mode="edit" [view]="data" [ledger]="paymentLedger()" [nacalc]="nacalc()" [partner]="partnerFinancing()"
                [state]="paymentState()" [error]="paymentStateError()" [dirty]="dirty()" [busy]="payingBusy() || saving() || paymentStateLoading() || payments() === null"
                [orderId]="data.order.id"
                (openPayee)="openPayee($event)" (pay)="requestPayment($event)" (settle)="requestSettle($event)"
                (openPayments)="jumpToSection('purchase-payments-section')" (openPartner)="jumpToSection('purchase-partner-section')"
                (openReports)="jumpToSection('purchase-files-section')" (applyCosts)="apply()"
                (refresh)="refreshPaymentState(); reloadPartnerFinancing()" (refreshPartner)="reloadPartnerFinancing()" (credit)="requestCredit($event)" />
            </section>
          </section>

          <!-- ===== Betalingen ===== -->
          <section class="mpo-pane" id="mpo-pane-betalingen" role="tabpanel" aria-label="Betalingen" [hidden]="phoneTab() !== 'betalingen'">
            <!-- Money out, per payee: the supplier for the goods in its planned
                 terms, the forwarder and customs, the inspection and other named
                 costs, and the bijkomende kosten of paying. The Enrosed kost is
                 ours and nobody's invoice. -->
            <section class="mpo-host purchase-payments-plain" id="purchase-payments-section" tabindex="-1" aria-label="Betalingen">
              <app-purchase-payment-overview mode="edit" [ledger]="paymentLedger()" [state]="paymentState()" [error]="paymentStateError()"
                [busy]="payingBusy() || saving() || paymentStateLoading() || payments() === null" [dirty]="dirty()" [nacalc]="nacalcSummary()"
                [planLabel]="planLabel(data.order)" [supplierName]="supplierName()" [roundOnServer]="roundOnServer()" [bankLineLabel]="bankLineLabel"
                [notice]="paymentNoticeText()" (dismissNotice)="dismissPaymentNotice()"
                (add)="requestPayment($event)" (edit)="requestEdit($event)" (addTransfer)="requestAddTransfer($event)" (download)="downloadDocument($event)"
                (settle)="requestSettle($event)" (undoSettle)="requestUndoSettle($event.payee, $event.due)" (planChange)="openPaymentPlan()"
                (remove)="requestRemove($event)" (save)="save()" (refresh)="refreshPaymentState()" (openCosts)="jumpToSection('purchase-result-section')"
                (credit)="requestCredit($event)" (invoice)="requestInvoice($event)" (invoiceFile)="openDocumentFile($event)" (assignInvoice)="assignInvoiceToAll($event)"
                (inspectionVia)="setInspectionVia($event)" />
            </section>

            <!-- Money in: a partner who co-finances the container. -->
            @if (data.order.partnerCustomerId != null) {
              <section class="mpo-host" id="purchase-partner-section" tabindex="-1" aria-label="Partnerfinanciering">
                <app-purchase-partner-payments (quote)="quoteOpen.set(true)" (changed)="onPartnerLinked()" [order]="data.order" [docs]="partnerDocs()" [advanceBasisEur]="data.costing.totals.totalWithSeparateCostsEur ?? null" />
              </section>
            }
          </section>

          <!-- ===== Dossier ===== -->
          <section class="mpo-pane" id="mpo-pane-dossier" role="tabpanel" aria-label="Dossier" [hidden]="phoneTab() !== 'dossier'">
            <!-- The container's diary: agreements, then the receipt, the booking and every payment write themselves in here. -->
            <section class="ios-section" id="purchase-notes-section" tabindex="-1" aria-labelledby="purchase-note-title">
              <div class="ios-section__head"><h2 id="purchase-note-title">Dagboek</h2>
                <button class="ios-section__link" type="button" (click)="noteEditing.set(!noteEditing())">{{ noteEditing() ? 'Klaar' : 'Bewerken' }}</button></div>
              <div class="ios-card mpo-diary">
                @if (noteEditing()) {
                  <textarea class="mpo-notes" rows="8" aria-label="Dagboek van de container" [ngModel]="data.order.notes" (ngModelChange)="patch({ notes: $event })"
                            placeholder="Afspraken, laadinstructies of aandachtspunten - ontvangst, bijboeken en betalingen schrijven zich hier vanzelf bij"></textarea>
                } @else if (data.order.notes) {
                  <app-diary [notes]="data.order.notes" />
                } @else {
                  <p class="ios-caption mpo-diary__empty">Nog leeg - ontvangst, bijboeken en betalingen schrijven zich hier vanzelf bij. Tik Bewerken voor eigen afspraken.</p>
                }
              </div>
            </section>

            <!-- The paper trail of a container: only what was actually added. -->
            <section class="ios-section" id="purchase-files-section" tabindex="-1" aria-labelledby="purchase-files-title">
              @let docs = documents() ?? [];
              <div class="ios-section__head"><h2 id="purchase-files-title">Documenten</h2>
                <span class="ios-section__trail">{{ docs.length }} {{ docs.length === 1 ? 'bestand' : 'bestanden' }}</span></div>
              <div class="ios-group">
                @for (doc of docs; track doc.id) {
                  <div class="ios-cell mpo-doc">
                    <span class="ios-cell__body">
                      @if (renamingDoc()?.id === doc.id) {
                        <input class="mpo-input mpo-input--wide mpo-doc__rename" type="text" enterkeyhint="done" [attr.aria-label]="'Titel van ' + doc.originalFilename"
                               placeholder="Titel, bijv. KBC mei" [ngModel]="renamingDoc()!.label"
                               (ngModelChange)="renamingDoc.set({ id: doc.id, label: $event })"
                               (keydown.enter)="commitDocRename(doc)" (keydown.escape)="renamingDoc.set(null)"
                               (blur)="commitDocRename(doc)" />
                      } @else {
                        <span class="ios-cell__title mpo-wrap">{{ doc.kindLabel }}{{ doc.label ? ' · ' + doc.label : '' }}</span>
                      }
                      <span class="ios-cell__sub mpo-wrap">{{ doc.originalFilename }} · {{ sizeLabel(doc.sizeBytes) }} · {{ doc.addedAt | dateNl }}@if (doc.actor) { · {{ actorLabel(doc.actor) }} }</span>
                    </span>
                    <span class="mpo-doc__actions">
                      <!-- The title stays editable after the upload. -->
                      <button class="ios-circle" type="button" title="Titel aanpassen" [attr.aria-label]="'Titel aanpassen van ' + doc.originalFilename"
                              (click)="renamingDoc.set({ id: doc.id, label: doc.label ?? '' })"><app-icon name="pencil" [size]="16" /></button>
                      <button class="ios-capsule ios-capsule--sm ios-capsule--tinted" type="button" (click)="downloadDocument(doc)">Openen</button>
                      <button class="ios-circle" type="button" title="Verwijderen" aria-label="Document verwijderen" (click)="removeDocument(doc)"><app-icon name="close" [size]="16" /></button>
                    </span>
                  </div>
                } @empty {
                  <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__sub mpo-wrap">Nog geen bestanden bij deze container.</span></span></div>
                }
                <button class="ios-cell ios-cell--action" type="button" (click)="openDocument()">Document toevoegen</button>
              </div>
            </section>
            <div class="mpo-host">
              <app-purchase-sales-links [documents]="relatedSalesDocs()" [excludePartner]="data.order.partnerCustomerId != null" />
              <app-purchase-activity [orderId]="data.order.id" [collapsible]="true" />
            </div>
          </section>
        </div>

        <nav class="erp-workspace__mobile-actions mpo-savebar" [class.is-dirty]="dirty()" aria-label="Opslaan">
          <!-- A hairline along the top edge on Producten: how full the container is while you compose it. -->
          @if (phoneTab() === 'producten' && !isDdp() && data.costing.containerFill; as fill) {
            <div class="dock-fill mpo-savebar__fill" role="meter" aria-label="Containervulling"
                 aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="fill.fillPercent"
                 [class.dock-fill--full]="fill.overflowCbm <= 0 && fill.fillPercent >= 97"
                 [class.dock-fill--over]="fill.fillPercent > 100 && fill.fillPercent <= 105"
                 [class.dock-fill--danger]="fill.fillPercent > 105">
              <span class="dock-fill__label"><b>{{ fill.fillPercent | num: 0 }}%</b> · {{ fill.usedCbm | num: 1 }} van {{ fill.capacityCbm }} m³</span>
              <span class="dock-fill__track"><i [style.width.%]="fill.fillPercent > 100 ? 100 : fill.fillPercent"></i></span>
            </div>
          }
          <span class="mpo-savebar__state" role="status">
            @if (saving()) {
              <strong>Opslaan…</strong><small>Even geduld</small>
            } @else if (dirty()) {
              @let what = negativeExtra() ? 'Enrosed kost onder nul: eerst rechtzetten' : unsavedText();
              <strong>Niet opgeslagen</strong><small [title]="what">{{ what }}</small>
            } @else {
              <strong>Alles opgeslagen</strong><small>Je kunt verder bewerken</small>
            }
          </span>
          @if (dirty()) {
            <button class="btn btn--primary mpo-savebar__btn" type="button" [disabled]="saving() || negativeExtra()" (click)="save()"><span aria-hidden="true">✓</span> Opslaan</button>
          } @else if (editStep(); as step) {
            <button class="btn btn--primary mpo-savebar__btn" type="button" (click)="runEditStep(step)">{{ editStepLabel(step) }}</button>
          }
        </nav>
      </div>

      <!-- The phone's own sheets, at host level: never inside the sticky nav, the tabs or a pane. -->
      @if (actionsOpen()) {
        <app-context-menu title="Acties" variant="ios" cancelLabel="Annuleren" [items]="actionsMenuItems()" (pick)="pickAction($event)" (closed)="actionsOpen.set(false)" />
      }
      @if (stepOpen(); as step) {
        <app-purchase-step-confirm-sheet [text]="stepText(step)" [tracking]="data.order.trackingReference ?? ''" [busy]="saving()"
                                         (cancel)="stepOpen.set(null)" (confirmed)="confirmPhoneStep($event)" />
      }
      @if (lineSheetLine(); as line) {
        @let display = setPiecesOf(line.productId);
        @let ordered = shortShipped(line.productId);
        @let cartonNote = isReceived() ? null : cartonNotice(draftQuantity(line.productId, line.quantity), line.productId);
        <!-- One line at a time: the edits land in the draft at once, as the inline fields do; the save bar shows them. -->
        <app-sheet title="Regel bewerken" variant="ios" (closed)="lineSheet.set(null)">
          <div body class="mpo-sheet">
            <div class="ios-group ios-group--thumbs">
              <div class="ios-cell ios-cell--tall">
                <span class="ios-cell__lead">
                  @if (photoOf(line.productId); as photo) { <img class="ios-thumb" [appAuthSrc]="photo" alt="" draggable="false" /> }
                  @else { <span class="ios-tile tone-grey mpo-line__index" aria-hidden="true">{{ purchaseLineNumber(line.productId) }}</span> }
                </span>
                <span class="ios-cell__body">
                  <span class="ios-cell__title ios-cell__title--strong ios-cell__title--2">{{ line.productName }}</span>
                  <span class="ios-cell__sub mpo-wrap">Regel {{ purchaseLineNumber(line.productId) }}@if (productSku(line.productId); as sku) { · <span class="mono">{{ sku }}</span> } · {{ piecesPerCarton(line.productId) }}/doos</span>
                  @if (productVariantLabel(line.productId); as variant) {
                    <span class="ios-cell__sub mpo-wrap">@if (productColour(line.productId)) { <i class="line-colour-dot" [class.line-colour-dot--empty]="!productColourHex(line.productId)"
                      [style.background]="productColourHex(line.productId) || 'transparent'" aria-hidden="true"></i> }{{ variant }}</span>
                  }
                </span>
              </div>
            </div>
            <div class="mpo-sheet__block">
              <div class="ios-group">
                <label class="ios-cell mpo-field-row" [attr.for]="'qty-sheet-' + line.productId">
                  <span class="ios-cell__body"><span class="ios-cell__title">Aantal stuks</span></span>
                  <span class="mpo-line__qty"><input class="mpo-input mpo-qty" [id]="'qty-sheet-' + line.productId" type="number" min="0" step="1" inputmode="numeric"
                         [disabled]="isReceived()" [ngModel]="quantityValue(line.productId, line.quantity)" (ngModelChange)="typeQuantity(line.productId, $event)"
                         (blur)="leaveQuantity(line.productId)" /><span class="mpo-line__unit" aria-hidden="true">st</span></span>
                </label>
                <div class="ios-cell mpo-field-row">
                  <span class="ios-cell__body"><label class="ios-cell__title mpo-wrap" [attr.for]="'exw-sheet-' + line.productId">Afgesproken prijs per stuk</label>
                    <span class="ios-cell__sub">{{ isDdp() ? 'DDP' : 'EXW' }}</span></span>
                  <span class="mpo-affix"><span class="mpo-affix__unit mpo-affix__unit--lead" aria-hidden="true">{{ currencySymbol(effectiveExwCurrency(line.productId)) }}</span>
                    <input class="mpo-input" [id]="'exw-sheet-' + line.productId" type="number" min="0" step="0.01" inputmode="decimal"
                           [attr.aria-label]="'Prijs per stuk in ' + effectiveExwCurrency(line.productId)" [ngModel]="orderLine(line.productId)?.exwPrice"
                           [placeholder]="line.quantity ? (line.goodsUsd / line.quantity | numUp: 3) : ''" (ngModelChange)="setExwPrice(line.productId, $event)" /></span>
                </div>
              </div>
              @if (cartonNote || ordered) {
                <p class="ios-section__foot">@if (cartonNote) { <span role="status">{{ cartonNote }}</span> }@if (cartonNote && ordered) { · }@if (ordered) { <span class="warn-text">Besteld {{ ordered | num }} → ontvangen {{ line.quantity | num }}</span> }</p>
              }
            </div>
            @if (isReceived()) {
              <div class="ios-group">
                <button class="ios-cell ios-cell--action" type="button" (click)="lineSheet.set(null); openIssue(line.productId)">Schade of tekort melden</button>
              </div>
            }
            <section class="ios-section mpo-sheet__section">
              <div class="ios-section__head"><h2>Kostopbouw</h2></div>
              <div class="mpo-sheet__seg"><app-segmented variant="ios" label="Kostopbouw tonen als" [options]="lineModes" [value]="perPiece() ? 'piece' : 'total'" (changed)="perPiece.set($event === 'piece')" /></div>
              <div class="ios-group">
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Goederen</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value mpo-amount">{{ amt(line.goodsEur, line) | eurUp: decimals() }}</span></span></div>
                @if (line.originEur) {
                  <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title mpo-wrap">{{ costLabels().originCostsLabel }}</span><span class="ios-cell__sub mpo-wrap">{{ costLabels().originRoute }}</span></span>
                    <span class="ios-cell__trail"><span class="ios-cell__value mpo-amount">{{ amt(line.originEur, line) | eurUp: decimals() }}</span></span></div>
                }
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title mpo-wrap">{{ costLabels().seaFreightLabel }}</span><span class="ios-cell__sub mpo-wrap">{{ costLabels().seaFreightRoute }}</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value mpo-amount">{{ amt(line.freightEur, line) | eurUp: decimals() }}</span></span></div>
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--strong">Douanewaarde</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">{{ amt(line.customsValueEur, line) | eurUp: decimals() }}</span></span></div>
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Invoerrecht {{ line.dutyRatePct | pct: 1 }}</span><span class="ios-cell__sub mpo-wrap">({{ line.dutySource }})</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value mpo-amount">{{ amt(line.dutyEur, line) | eurUp: decimals() }}</span></span></div>
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title mpo-wrap">{{ costLabels().destinationCostsLabel }}</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value mpo-amount">{{ amt(line.destinationEur, line) | eurUp: decimals() }}</span></span></div>
                @if (line.extraRevenueEur) {
                  <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Enrosed kost</span><span class="ios-cell__sub">{{ perPiece() ? 'per stuk' : 'hele regel' }}</span></span>
                    <span class="ios-cell__trail"><span class="ios-cell__value mpo-amount">{{ amt(line.extraRevenueEur, line) | eurUp: decimals() }}</span></span></div>
                }
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--strong">{{ perPiece() ? (display ? 'Geland per display' : 'Geland per stuk') : 'Geland totaal' }}</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong mpo-accent">{{ perPiece() ? (line.landedUnitEur | eurUp: 3) : (line.totalEur | eur) }}</span>
                    @if (perPiece() && display) { <span class="ios-cell__meta">{{ line.landedUnitEur / display | eurUp: 3 }} /stuk</span> }</span></div>
              </div>
            </section>
            <div class="ios-group">
              <a class="ios-cell" [routerLink]="['/products', line.productId]" [title]="line.productName + ' openen'">
                <span class="ios-cell__body"><span class="ios-cell__title mpo-link">Product openen</span></span>
                <app-icon class="ios-cell__chev" name="external" [size]="16" />
              </a>
            </div>
            <div class="ios-group">
              <button class="ios-cell ios-cell--danger" type="button" [disabled]="isReceived()" (click)="removeLine(line.productId); lineSheet.set(null)">Regel verwijderen</button>
            </div>
          </div>
          <div foot style="display:contents"><button class="btn btn--primary" type="button" (click)="lineSheet.set(null)">Klaar</button></div>
        </app-sheet>
      }
      @if (keysOpen()) {
        <app-sheet title="Verdeelsleutels" variant="ios" (closed)="keysOpen.set(false)">
          <div body class="mpo-sheet">
            <div class="ios-group">
              <!-- A series is one product to the buyer: its colours and sizes land at one and the same unit cost. -->
              <label class="ios-cell mpo-field-row">
                <span class="ios-cell__body"><span class="ios-cell__title">Varianten als één product</span>
                  <span class="ios-cell__sub mpo-wrap">Kleuren en maten van dezelfde reeks krijgen samen één kostprijs per stuk; de aantallen worden opgeteld.</span></span>
                <input class="ios-switch" type="checkbox" [ngModel]="data.order.groupVariants ?? true" (ngModelChange)="patch({ groupVariants: $event })" />
              </label>
              @for (key of allocationKeys(); track key.field) {
                <label class="ios-cell mpo-field-row mpo-field-row--stack" [attr.for]="'a-' + key.field">
                  <span class="ios-cell__body"><span class="ios-cell__title mpo-wrap">{{ key.label }}</span>
                    @if (key.route) { <span class="ios-cell__sub mpo-wrap">{{ key.route }}</span> }</span>
                  <span class="mpo-pick mpo-pick--wide"><select class="mpo-select" [id]="'a-' + key.field" [ngModel]="allocationOf(data.order, key.field)" (ngModelChange)="setAllocation(key.field, $event)">
                    @if (key.field === 'allocSeparate') { <option value="SEPARATE">Achteraf, apart van de stukprijs</option> }
                    <option value="CBM">Naar volume (m³)</option>
                    <option value="VALUE">Naar goederenwaarde</option>
                    <option value="PIECES">Naar aantal stuks</option>
                    @if (key.field === 'allocExtra') { <option value="MANUAL">Zelf per product</option> }
                  </select><app-icon name="chevron-down" [size]="14" /></span>
                </label>
              }
            </div>
          </div>
          <div foot style="display:contents"><button class="btn btn--primary" type="button" (click)="keysOpen.set(false)">Klaar</button></div>
        </app-sheet>
      }

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
        <app-purchase-partner-sheet [order]="data.order" [currentShare]="partnerShare()" (closed)="partnerSheetOpen.set(false)" (linked)="onPartnerLinked()" />
      }
      @if (auctionOpen()) {
        <app-auction-settlement-sheet [lines]="auctionLines()" [customerId]="auctionCustomerId()" [customerName]="partnerCompany()"
                                      [purchaseOrderId]="data.order.id" [reference]="containerName(data.order)" [sourceId]="auctionSourceId()"
                                      [costSharePct]="auctionCostShare()" [separateUnitEur]="separateUnitEur()" [profitSharePct]="auctionProfitShare()"
                                      (funding)="jumpToSection('purchase-partner-section')" (closed)="auctionOpen.set(false)" />
      }

      @if (picking()) {
        <app-product-picker
          heading="Product toevoegen aan de container"
          [products]="available()"
          [categories]="categories()"
          [families]="families()"
          [groupByFamily]="true"
          [priceOf]="exwPriceOf"
          [currencyOf]="exwCurrencyOf"
          [enforceCartons]="false"
          mode="multi"
          [preserveSourceOrder]="true"
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
          [agreedEur]="planAgreedEur()" [paidEur]="paidTotalEur()" [scopedDues]="scopedSupplierDues()"
          (saved)="savePaymentPlan($event)" (closed)="paymentPlanOrder.set(null)" />
      }
      @if (paying(); as pay) {
        <app-purchase-payment-sheet [draft]="pay" [chips]="payChips()" [instalmentOptions]="paymentInstalmentOptions()"
          [openHint]="payingOpenHint()" [overageEur]="payingOverage()" [draftEur]="paymentDraftEur()" [rateEur]="paymentRateEur()"
          [originalPayee]="payingOriginal()?.payee ?? null" [originalSettles]="!!payingOriginal()?.settles"
          [busy]="payingBusy()" [loading]="paymentStateLoading()" [proofSlots]="proofSlots(pay.id)" [groupLabel]="paymentGroupLabel(pay.payee)" [creditOffset]="payingCreditOffset()"
          [cif]="paymentCif()" [transferEur]="paymentTransferEur()" [bankLinked]="payingOnBank()" [today]="bankToday()"
          [roundOnServer]="roundOnServer()" [invoices]="data.invoices ?? []" [viaSupplier]="!!data.order.inspectionViaSupplier" [orderPayments]="payments() ?? []"
          [parts]="payingParts()" [proofFiles]="payingProofFiles()" [bankLines]="bankLines() ?? []" [invoiceFiles]="payingInvoiceFiles()"
          [inspectionOffered]="payingInspectionOffered()" [payeePaymentCount]="payingPayeeCount()" [termStanding]="payingTermStanding()"
          [alsoState]="alsoState()" [supplierId]="data.order.supplierId ?? null" [orderName]="containerName(data.order)" [orderNumber]="data.order.number" [lineShares]="payingLineShares()"
          (alsoLoad)="loadAlso(data.order.id, data.order.supplierId ?? null, pay.payee)"
          (patch)="paying.set({ ...pay, ...$event })" (amountInput)="setPaymentAmount($event)" (amountEurInput)="setPaymentAmountEur($event)" (payeeChange)="setPaymentPayee($event)"
          (partInput)="setPaymentPart($event.part, $event.raw)" (confirm)="confirmPayment()" (cancel)="closePayment()" (remove)="removeEditing($event)"
          (unlinkLine)="unlinkSheetLine($event)" (removeProof)="removeSheetProof($event)" (removePart)="removeSheetPart($event)" (openDocument)="openDocumentFile({ documentId: $event, name: null })" />
      }
      @if (invoicing(); as invoiceAction) {
        <app-purchase-invoice-sheet [action]="invoiceAction" [invoices]="data.invoices ?? []" [agreed]="agreedByPayee()"
          [inspectionAgreedEur]="data.order.inspectionCostEur ?? 0" [eurOf]="invoiceEurOf" [busy]="payingBusy()"
          (submit)="submitInvoice($event)" (remove)="removeInvoice($event)" (openFile)="openDocumentFile({ documentId: $event, name: null })" (cancel)="closeInvoice()" />
      }
      @if (crediting(); as credit) {
        <app-purchase-supplier-credit-sheet [action]="credit" [view]="data" [targets]="creditTargets()" [supplierOpenEur]="creditSupplierOpen()"
          [busy]="payingBusy()" (submit)="submitCredit($event)" (cancel)="closeCredit()" />
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
      @if (payeeMenuOpen()) {
        <app-context-menu title="Betaling aan…" variant="ios" cancelLabel="Annuleren" [items]="payeeActionItems()"
          (pick)="payeeMenuOpen.set(false); requestPayment({ payee: $any($event.id) })" (closed)="payeeMenuOpen.set(false)" />
      }

      @if (libraryOpen()) {
        <app-file-picker title="Document uit de bibliotheek" (picked)="pickLibraryDocument($event)" (closed)="libraryOpen.set(false)" />
      }
      @if (addingDocument(); as doc) {
        <app-sheet title="Document toevoegen" (closed)="closeDocument()">
          <div body [attr.inert]="uploadingDocument() ? '' : null">
            <div class="form-grid">
              <div class="field">
                <label for="doc-kind">Soort</label>
                <select class="select" id="doc-kind" [ngModel]="doc.kind" (ngModelChange)="addingDocument.set({ ...doc, kind: $event })">
                  @for (kind of documentKindOptions(); track kind.value) { <option [value]="kind.value">{{ kind.label }}</option> }
                </select>
                @if (roundOnServer()) { <span class="hint">Een betaalbewijs voeg je toe bij de betaling zelf (Aanpassen).</span> }
              </div>
              <div class="field">
                <label for="doc-label">Omschrijving <span class="opt"></span></label>
                <input class="input" id="doc-label" placeholder="bijv. KBC 23/08, factuur 2e helft"
                       [ngModel]="doc.label" (ngModelChange)="addingDocument.set({ ...doc, label: $event })" />
              </div>
              @if (doc.kind === 'PAYMENT_PROOF' && (payments() ?? []).length) {
                <div class="field span-2">
                  <label for="doc-payment">Hoort bij betaling <span class="opt"></span></label>
                  <select class="select" id="doc-payment" [ngModel]="doc.paymentId ?? ''" (ngModelChange)="addingDocument.set({ ...doc, paymentId: $event ? +$event : null })">
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
                  <label for="doc-file">Bestand</label>
                <div class="doc-source">
                  <input class="input" id="doc-file" type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx,.csv"
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

      @if (firstInstalmentPrompt(); as first) {
        <app-purchase-first-instalment-sheet [prompt]="first" [supplierName]="supplierName()" [busy]="payingBusy()"
          (patch)="firstInstalmentPrompt.set({ ...first, ...$event })" (amountInput)="setFirstPaymentAmount($event)"
          (confirm)="confirmFirstInstalment()" (dismiss)="firstInstalmentPrompt.set(null)" />
      }

      @if (receiving(); as draft) {
        <!-- The container is in. Count what is there, note what broke, say
             what was paid, and decide whether the shelf gets it now. -->
        <app-sheet title="Container ontvangen" [wide]="true" (closed)="receiving.set(null)">
          <div body>
            <div class="field">
              <label for="rc-date">Ontvangen op</label>
              <app-date-field fieldId="rc-date" [value]="draft.receivedOn ?? ''" (valueChange)="receiving.set({ ...draft, receivedOn: $event })" />
              <span class="hint">Standaard vandaag; pas aan als de container eerder binnenkwam.</span>
            </div>
            <p class="hint">Vul per product in wat er werkelijk in de container zat. Staat alles zoals
              besteld, dan hoef je niets te wijzigen.</p>
            @if (receiveSummary(); as summary) {
              <div class="receive-preview" aria-label="Voorbeeld van de ontvangstsamenvatting">
                <span><small>Bruikbaar</small><b>{{ summary.usablePieces | num }} st</b></span>
                <span><small>Ontbreekt</small><b [class.warn-text]="summary.missingPieces">{{ summary.missingPieces | num }} st</b></span>
                <span><small>Beschadigd</small><b [class.danger-text]="summary.damagedPieces">{{ summary.damagedPieces | num }} st</b></span>
                <span><small>Inkoopimpact</small><b>{{ summary.totalLossValueEur | eur: 0 }}</b></span>
                @if (!summary.valuationComplete) {
                  <p>{{ summary.unvaluedLossPieces | num }} afwijkende stuks hebben nog geen inkoopwaarde.</p>
                }
              </div>
            }
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
                    <label class="receive-line__field receive-line__field--note">
                      <span>Wat was er mis?</span>
                      <input class="input" type="text" placeholder="bijv. glazen stolpen gebarsten, binnendoos te dun"
                             [ngModel]="line.note" (ngModelChange)="setIssueNote(line.productId, $event)" />
                    </label>
                  }
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
                <label class="receive-balance__final">
                  <input type="checkbox" [ngModel]="draft.finalPayment" (ngModelChange)="receiving.set({ ...draft, finalPayment: $event })" />
                  <span>Na ontvangst de slotbetaling van <b>{{ remainingEur() | eur }}</b> controleren en een banktransactie kiezen</span>
                </label>
              }
              <span class="hint">Douane, transport en inspectie noteer je apart bij Betalingen.</span>
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
        <app-purchase-ordered-success [orderNumber]="data.order.number" [overviewAvailable]="!handedFromView()"
                                      (closed)="closeOrderPlaced()"
                                      (overview)="openOrderView()" />
      }
      @if (statusCelebration(); as celebration) {
        <app-purchase-status-success [kind]="celebration" [orderNumber]="data.order.number"
                                     [showAction]="celebration === 'SHIPPED' ? !data.order.trackingReference : !(data.order.stockBooked ?? true)"
                                     (closed)="statusCelebration.set(null)"
                                     (action)="celebrationAction(celebration)" />
      }
      @if (stepBack() && stepBackSheet().options.length) {
        <app-purchase-status-back-sheet [current]="stepBackSheet().status" [options]="stepBackSheet().options"
                                        [dirty]="stepBackSheet().dirty" [busy]="stepBackBusy()"
                                        (confirm)="confirmStepBack($event)" (cancel)="closeStepBack()" />
      }
      @if (applyPlan(); as plan) {
        <app-purchase-apply-costs-sheet [plan]="plan" [orderId]="data.order.id" [busy]="applyBusy()"
                                        (confirm)="confirmApply()" (cancel)="closeApply()" />
      }
      @if (pdfOpen()) {
        <app-purchase-pdf-sheet [orderId]="data.order.id" [orderNumber]="data.order.number"
                                [dirty]="dirty()" [saving]="saving()"
                                [separateCosts]="hasSeparateCosts(data.order)"
                                (saveRequested)="save()" (closed)="pdfOpen.set(false)" />
      }
    } @else {
      <div class="mpo-phone mpo-phone--edit">
        <app-ios-nav title="Inkoop" [largeTitle]="false" backLabel="" backAriaLabel="Terug naar de container" (back)="goBack()" />
        @if (loadError(); as error) {
          <div class="mpo-loading"><app-load-error [message]="error" [busy]="loadRetrying()" (retry)="retryLoad()" /></div>
        } @else {
          <div class="mpo-loading" role="status" aria-live="polite" aria-label="Inkooporder laden">
            <app-skeleton kind="card" [rows]="3" />
            <app-skeleton kind="lines" [rows]="4" />
          </div>
        }
      </div>
    }
  `,
  styles: [`
    /* The phone layout lives in styles/purchase-phone.scss; these are the receive, issue and document sheets. */
    :host{display:block;min-width:0}
    .doc-source{display:flex;gap:8px}.doc-source .input{flex:1;min-width:0}
    .issue-kind{margin-top:2px}
    .receive-balance{display:grid;gap:8px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}.receive-balance b{font-size:13px}.receive-balance small{display:block;color:var(--muted);font-size:11.5px}.receive-balance__final{display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer}.receive-balance__final input{width:18px;height:18px;accent-color:var(--rose)}
    .receive-preview{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;margin:10px 0;border:1px solid var(--line);border-radius:12px;background:var(--line);overflow:hidden}.receive-preview>span{display:grid;padding:9px 10px;background:var(--surface)}.receive-preview small{color:var(--muted);font-size:9px;text-transform:uppercase}.receive-preview b{font-size:12.5px}.receive-preview>p{grid-column:1/-1;padding:8px 10px;background:var(--warn-soft);color:var(--ink-2);font-size:10.5px}
    .receive-lines{display:grid;gap:8px}.receive-line{display:grid;grid-template-columns:minmax(0,1fr) 110px 110px;gap:8px 10px;align-items:end;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}.receive-line--short{border-color:#eddcb9;background:var(--warn-soft)}.receive-line--damaged{border-color:#f1c8c4}.receive-line__name{display:grid;min-width:0}.receive-line__name b{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.receive-line__name small{color:var(--muted);font-size:11px}.receive-line__field{display:grid;gap:3px}.receive-line__field span{color:var(--muted);font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}.receive-line__note{grid-column:1/-1;color:var(--warn);font-size:11.5px;font-weight:650}
    @media(max-width:559px){.receive-line{grid-template-columns:1fr 1fr}.receive-line__name{grid-column:1/-1}}
    @media(min-width:560px){.receive-preview{grid-template-columns:repeat(4,minmax(0,1fr))}}
    .switch-row{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:4px 0 10px;cursor:pointer;border-bottom:1px solid var(--line);margin-bottom:4px}.switch-row>span{display:flex;flex-direction:column;gap:2px;min-width:0}.switch-row b{font-size:13px}.switch-row small{color:var(--muted);font-size:11.5px;line-height:1.35}.switch-row input{width:20px;height:20px;flex:none;accent-color:var(--rose)}
  `]
})
export class PurchaseEditor {
  /** One name for the container in sales texts: alias, else number. */
  readonly containerName = containerName;
  /** A series' landed figure per unit: one figure, or the range of its variants (F17). */
  readonly landedRangeText = landedRangeText;
  readonly desktop = inject(DesktopViewport);
  readonly pdfOpen = signal(false);
  /** The container as an offer: the sheet that picks the customer and opens the new quote. */
  readonly quoteOpen = signal(false);
  readonly quoteLines = computed<PurchaseQuoteLine[]>(() => quoteLinesOf(this.view()));

  /* ---- the phone's confirmed next step: the read view's handoff, the save bar or Acties. The desk never calls these. */
  /** 'Track & trace invullen' after a departure: the screen stays in the editor instead of returning to the view. */
  readonly keepAfterStep = signal(false);
  /** The step was confirmed on the read view: back leads there, not one history entry back. */
  readonly handedFromView = signal(false);
  /** A step is still running or waiting on a sheet: a save, the count, the Kostprijzen toepassen sheet, a celebration, a payment. */
  readonly stepFlowBusy = computed(() => this.saving() || this.booking() || this.applyFor() !== null || this.applyBusy() || this.receiving() !== null
    || this.orderPlaced() || this.statusCelebration() !== null || this.firstInstalmentPrompt() !== null
    || this.paying() !== null || this.payingBusy());

  /**
   * A confirmed phone step (read-view handoff, save bar or Acties). False only
   * when the step no longer applies to the container; a save that is refused
   * says so itself. A departure writes a changed track & trace first, the way
   * the desk's confirmAdvance does.
   */
  runStep(step: PhoneStep, tracking: string | null): boolean {
    const data = this.view();
    if (!data) return false;
    if (step === 'BESTELLEN' || step === 'VERTROKKEN' || step === 'ONTVANGEN') {
      if (this.nextStep()?.to !== stepTarget(step)) return false;
      if (step === 'VERTROKKEN' && tracking !== null && tracking.trim() !== (data.order.trackingReference ?? '')) {
        this.patch({ trackingReference: tracking.trim() || null });
      }
      this.advanceStatus();
      return true;
    }
    if (data.order.status !== 'ONTVANGEN') return false;
    if (step === 'BIJBOEKEN') {
      if (data.order.stockBooked !== false) return false;
      // Booking replaces the draft with the server's order: unsaved notes or costs are saved first.
      if (this.dirty()) void this.save().then((saved) => { if (saved) void this.bookStock(); });
      else void this.bookStock();
      return true;
    }
    /* Kostprijzen toepassen asks in its own sheet (apply()): every product's cost now and next. */
    void this.apply();
    return true;
  }

  /** Cost breakdowns as totals or per piece; one switch for all lines. */
  /* Per piece is what the buying conversation is about; totals are the
     exception you toggle to. */
  readonly perPiece = signal(true);

  /** Every line amount through one gate, so the toggle cannot miss one. */
  /** Two decimals for totals, four for per-piece - tiny numbers need them. */
  readonly decimals = computed(() => this.perPiece() ? 3 : 2);

  amt(value: number, line: { quantity: number }): number {
    return this.perPiece() && line.quantity > 0 ? value / line.quantity : value;
  }

  /** Products and capacity lead; order setup and cost mechanics open on demand. */
  readonly openSections = signal(new Set<string>(['order']));
  /** Mirrors the shared record-workspace navigation without changing order data. */
  readonly workspaceSection = signal('purchase-order-section');

  sectionOpen(name: string): boolean {
    return this.openSections().has(name);
  }

  /* ---- the phone: five tabs, the save bar and Acties (the desk has its own shell) ---- */

  /** ?tab= from the route; Overzicht when absent. A field, not load(): the order may reload under it. */
  readonly tab = input<string>();
  readonly phoneTab = linkedSignal<PhoneTab>(() => parseTab(this.tab()));
  readonly tabOptions = computed<SegmentOption[]>(() => {
    const data = this.view();
    return tabSegments({
      producten: !!data && productsDot(data),
      betalingen: paymentsDot(this.paymentLedger()?.summary, this.paymentState()),
    });
  });
  readonly location = inject(Location);
  private readonly phoneHost = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Focusing a phone tab never moves the page, also just before the bar sticks (the desk has no tabs: nothing to do). */
  private readonly tabFocusKept = inject(DestroyRef).onDestroy(keepPhoneTabFocusInPlace(this.phoneHost.nativeElement));

  /** Switches the tab in place: the URL follows without a history entry, a stuck bar stays stuck over the new pane's top. */
  setPhoneTab(tab: PhoneTab, { scroll = true }: { scroll?: boolean } = {}): void {
    const stick = phoneStickPoint(this.phoneHost.nativeElement);
    const stuck = phoneTabsStuck(stick);
    this.phoneTab.set(tab);
    replaceTabInUrl(this.location, tab);
    if (scroll) keepPhoneTabsStuck(stick, stuck);
  }

  /** Tapping the tab that is already open, with the bar stuck, goes back to its top. */
  tabsClicked(event: Event): void {
    if (!tappedSelectedTab(event)) return;
    const stick = phoneStickPoint(this.phoneHost.nativeElement);
    if (phoneTabsStuck(stick)) scrollPhoneTabsTop(stick);
  }

  /**
   * Back: to the read view when it handed a step over (history is then
   * [list, edit]), else one entry back; the unsaved-changes guard asks first.
   */
  goBack(): void {
    const id = this.view()?.order.id ?? (Number(this.id()) || null);
    if (this.handedFromView() && id != null) {
      void this.router.navigate(['/purchasing', id], { replaceUrl: true, queryParams: { tab: tabParam(this.phoneTab()) } });
    } else if (window.history.length > 1) {
      this.location.back();
    } else if (id != null) {
      void this.router.navigate(['/purchasing', id]);
    }
  }

  readonly statusTone = statusTone;
  readonly statusText = statusLabel;
  readonly STEP_BUTTON = STEP_BUTTON;

  /** The save bar's step when nothing is unsaved: an empty concept asks for products first. */
  readonly editStep = computed(() => {
    const data = this.view();
    return data ? editNextStep({ status: data.order.status, lineCount: data.costing.lines.length, stockBooked: data.order.stockBooked }) : null;
  });

  editStepLabel(step: AskedStep | 'PRODUCTEN'): string {
    return step === 'PRODUCTEN' ? 'Producten toevoegen' : STEP_BUTTON[step];
  }

  runEditStep(step: AskedStep | 'PRODUCTEN'): void {
    if (step === 'PRODUCTEN') {
      this.setPhoneTab('producten');
      this.openPicker();
    } else {
      this.stepOpen.set(step);
    }
  }

  /** What the save bar says is not saved yet. */
  readonly unsavedText = computed(() => {
    const data = this.view();
    const saved = this.savedOrder();
    if (!data || !saved) return '';
    const labels = this.costLabels();
    return unsavedSummary(JSON.parse(saved) as PurchaseOrder, data.order,
      { seaFreight: labels.seaFreightLabel, origin: labels.originCostsLabel, destination: labels.destinationCostsLabel });
  });

  /** The step the confirmation sheet asks about; the save bar, Acties and the received banner open it. */
  readonly stepOpen = signal<AskedStep | null>(null);

  stepText(step: AskedStep) {
    const order = this.view()!.order;
    return stepConfirm(step, { number: order.number, planLabel: this.planLabel(order), location: this.receivingLocationName(order.receivingLocationId),
      dirty: this.dirty() });
  }

  confirmPhoneStep(event: { tracking: string | null }): void {
    const step = this.stepOpen();
    this.stepOpen.set(null);
    if (step && !this.runStep(step, event.tracking)) this.ui.toast('De container staat al verder; er is niets gewijzigd.');
  }

  /** The line in the Regel bewerken sheet; it goes when the line leaves the draft. */
  readonly lineSheet = signal<number | null>(null);
  readonly lineSheetLine = computed(() => {
    const productId = this.lineSheet();
    return productId === null ? null : this.view()?.costing.lines.find((line) => line.productId === productId) ?? null;
  });
  /** The Verdeelsleutels sheet. */
  readonly keysOpen = signal(false);
  readonly basisOptions: SegmentOption[] = [{ id: 'EXW', label: 'EXW' }, { id: 'CIF', label: 'CIF' }, { id: 'DDP', label: 'DDP' }];
  readonly currencyOptions: SegmentOption[] = [{ id: 'USD', label: '$ USD' }, { id: 'CNY', label: '¥ CNY' }, { id: 'EUR', label: '€ EUR' }];
  readonly amountModes: SegmentOption[] = [{ id: 'total', label: 'Totaal' }, { id: 'piece', label: 'Per stuk' }];
  readonly lineModes: SegmentOption[] = [{ id: 'piece', label: 'Per stuk' }, { id: 'total', label: 'Totaal' }];

  /** Ordernummer, written when the field is left; an emptied field keeps the number it had. */
  setNumber(field: HTMLInputElement): void {
    const value = field.value.trim();
    if (value && value !== this.view()?.order.number) this.patch({ number: value });
    else if (!value) field.value = this.view()?.order.number ?? '';
  }

  /** The price a line row states: the order's own 'afgesproken', else the product card's 'kaartprijs' in its own currency. */
  rowPriceText(productId: number): string | null {
    const pipe = new NumUpPipe();
    return linePriceText({ price: this.orderLine(productId)?.exwPrice, currency: this.effectiveExwCurrency(productId) },
      this.productCardPrice(productId), (value) => pipe.transform(value, 3));
  }

  productSku(productId: number): string | null {
    return this.productById().get(productId)?.sku || null;
  }

  /** Acties: what the old Afronden step and its Meer acties held. */
  readonly actionsOpen = signal(false);
  readonly actionsMenuItems = computed<ContextMenuItem[]>(() => {
    const data = this.view();
    if (!data) return [];
    return actionsMenu({
      status: data.order.status, step: this.nextStep()?.to ?? null, lineCount: data.costing.lines.length, stockBooked: data.order.stockBooked,
      costsApplied: this.costsApplied(), partner: data.order.partnerCustomerId != null, canQuote: this.quoteLines().length > 0,
      dirty: this.dirty(), saving: this.saving(), booking: this.booking(), deleting: this.deletingOrder(), stepBackBusy: this.stepBackBusy(),
    });
  });

  pickAction(item: ContextMenuItem): void {
    this.actionsOpen.set(false);
    switch (item.id) {
      case 'next': { const step = stepToward(this.nextStep()?.to); if (step) this.stepOpen.set(step); break; }
      case 'book': this.stepOpen.set('BIJBOEKEN'); break;
      case 'apply': this.apply(); break;
      case 'quote': this.quoteOpen.set(true); break;
      case 'copy': void this.duplicate(); break;
      case 'pdf': this.pdfOpen.set(true); break;
      case 'step-back': this.openStepBack(); break;
      case 'delete': this.remove(); break;
    }
  }

  private readonly paymentOverview = viewChild(PurchasePaymentOverview);

  /** From the Nacalculatie: the payee's sheet on top of the payments step. */
  openPayee(payee: Payee): void {
    this.jumpToSection('purchase-payments-section');
    this.paymentOverview()?.openPayee.set(payee);
  }

  /**
   * Phone: the tab the section lives on, then its top under the stuck bar
   * (a tab's root or the card) or the card itself. Desk: opens a collapsed
   * section first, then lands it below the sticky workspace rail.
   */
  jumpToSection(sectionId: string, disclosure?: 'order' | 'costs', scroll = true): void {
    if (!this.desktop.active()) {
      const tab = tabOfSection(sectionId);
      this.setPhoneTab(tab, { scroll: false });
      if (!scroll) return;
      requestAnimationFrame(() => {
        const target = document.getElementById(sectionId);
        if (sectionId === rootSectionOf(tab) || sectionId === 'purchase-overview') scrollPhoneTabsTop(phoneStickPoint(this.phoneHost.nativeElement));
        else target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target?.focus({ preventScroll: true });
      });
      return;
    }
    if (disclosure && !this.sectionOpen(disclosure)) {
      const next = new Set(this.openSections());
      next.add(disclosure);
      this.openSections.set(next);
    }
    this.workspaceSection.set(sectionId);
    if (!scroll) return;
    requestAnimationFrame(() => {
      const target = document.getElementById(sectionId);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target?.focus({ preventScroll: true });
    });
  }

  readonly containerTypes = CONTAINER_TYPES;
  readonly containerLabel = containerLabel;
  readonly containerCountForFill = containerCountForFill;

  /** The one-way street a container travels: the sailing is a step of its
      own again - a payment falls due on it, and the tracking starts there. */
  readonly statusSteps = [
    { value: 'CONCEPT' as const, label: 'Concept', action: 'Bestellen' },
    { value: 'BESTELD' as const, label: 'Besteld', action: 'Container vertrokken' },
    { value: 'ONDERWEG' as const, label: 'Vertrokken', action: 'Container ontvangen' },
    { value: 'ONTVANGEN' as const, label: 'Ontvangen', action: '' },
  ];

  /**
   * The ordered quantity when the receipt counted something else, or null.
   * Only the receipt makes a difference: a count changed while ordered or
   * under way is the new agreement, not a short delivery (older orders may
   * still hold the first snapshot from before that rule). The costing rows
   * the template renders do not carry the snapshot; the raw order lines do.
   */
  shortShipped(productId: number): number | null {
    const view = this.view();
    if (view?.order.status !== 'ONTVANGEN') return null;
    const line = view.order.lines.find((l) => l.productId === productId);
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
        () => this.statusCelebration.set('SHIPPED'),
      );
      return;
    }
    this.enqueue(
      (order) => ({ ...order, status: step.to as PurchaseOrder['status'] }),
      () => this.orderPlaced.set(true),
    );
  }

  /* ---- status one step back ----------------------------------------- */

  /** The Status terugzetten sheet: a container set to Vertrokken or Besteld by mistake goes back. */
  readonly stepBack = signal(false);
  /** Where this container may go back to; Concept says why when the server would refuse it. */
  readonly stepBackOptions = computed(() => {
    const data = this.view();
    if (!data) return [];
    return statusBackOptions({
      status: data.order.status, payments: this.payments(), paymentStateError: this.paymentStateError(),
      paidEur: data.order.paidTotalEur, creditCount: (data.supplierCredits ?? []).length,
    });
  });
  readonly stepBackBusy = computed(() => this.saving() || this.deletingOrder() || this.paymentPlanBusy() || this.payingBusy());
  /**
   * What the open sheet showed when its button was tapped. The draft carries
   * the target status while the save runs, so the sheet keeps this until the
   * server answers: no 'Nu: Besteld' before it agreed, and a refused save
   * leaves the choice where it was instead of one step further back.
   */
  private readonly stepBackPending = signal<StatusBackSheetState | null>(null);
  /** What the sheet shows: the container's status, its options and unsaved edits; frozen while a step back saves. */
  readonly stepBackSheet = computed<StatusBackSheetState>(() => this.stepBackPending() ?? {
    status: this.view()?.order.status ?? 'CONCEPT', options: this.stepBackOptions(), dirty: this.dirty(),
  });

  openStepBack(): void {
    if (this.stepBackOptions().length) this.stepBack.set(true);
  }

  closeStepBack(): void {
    this.stepBack.set(false);
  }

  /**
   * Puts the container back on an earlier status through the normal save,
   * draft included. The departure date goes with Vertrokken: a later real
   * departure sets the true day. A refused save puts the status and the date
   * back in the draft, so the screen never shows a status the server refused.
   * No celebration and no first-instalment prompt: nothing was reached.
   */
  async confirmStepBack(to: StatusBackTarget): Promise<void> {
    const data = this.view();
    const option = this.stepBackOptions().find((item) => item.to === to);
    if (!data || !option || option.blocked || this.stepBackBusy()) return;
    const { status, shippedOn } = data.order;
    this.stepBackPending.set(this.stepBackSheet());
    try {
      this.view.set({ ...data, order: { ...data.order, status: to, shippedOn: null } });
      const saved = await this.save({ stepBack: true });
      if (!saved) {
        const current = this.view();
        if (current?.order.id === data.order.id) this.view.set({ ...current, order: { ...current.order, status, shippedOn } });
        return;
      }
      this.stepBack.set(false);
      this.ui.toast(`Status teruggezet naar ${option.label}`, 'ok');
    } finally {
      this.stepBackPending.set(null);
    }
  }



  photoOf(productId: number): string | null {
    const product = this.productById().get(productId);
    return product?.photos?.[0]?.url ?? null;
  }

  purchaseLineNumber(productId: number): number {
    const index = this.unfilteredPurchaseLines().findIndex((line) => line.productId === productId);
    return index < 0 ? 0 : index + 1;
  }

  productColour(productId: number): string | null {
    return this.productById().get(productId)?.colour?.trim() || null;
  }

  productVariantLabel(productId: number): string | null {
    const product = this.productById().get(productId);
    if (!product) return null;
    const parts = [product.colour, product.variantSize]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));
    return parts.length ? parts.join(' · ') : null;
  }

  productColourHex(productId: number): string | null {
    const product = this.productById().get(productId);
    return this.colourHex(product?.colourHex, product?.colour ?? '');
  }

  colourHex(explicit: string | null | undefined, label: string): string | null {
    if (explicit?.trim()) return explicit.trim();
    const normalized = label.trim().toLocaleLowerCase('nl-BE');
    return Object.entries(COLOUR_SWATCHES).find(([name]) =>
      name.toLocaleLowerCase('nl-BE') === normalized)?.[1] ?? null;
  }

  /* ---- payments --------------------------------------------------- */
  readonly payments = signal<PurchasePayment[] | null>(null);
  /** The payment sheet's draft; amountEur is the bank's euro debit of a USD/CNY payment, only sent when filled in. */
  readonly paying = signal<PurchasePaymentDraft | null>(null);
  readonly paymentStateError = signal<string | null>(null);
  readonly paymentStateLoading = signal(false);
  private paymentRefreshVersion = 0;

  /** A stream is settled once a payment on it says so: nothing stays open, the difference is ours. */
  reconciliationStream(payee: Payee) {
    return this.view()?.reconciliation?.streams.find((stream) => stream.payee === payee);
  }

  settledFor(payee: Payee): boolean {
    return purchaseGroupSettled(this.view(), this.payments(), payee);
  }

  /** The inspection and the other named costs on the order: paid apart, to whoever did the work. */
  readonly separateOwed = computed(() => this.reconciliationStream('SEPARATE')?.plannedEur ?? this.view()?.costing.totals.separateCostsEur ?? 0);

  /** What was agreed on a stream; the other payments have no agreement, only what they cost. */
  owedFor(payee: Payee): number {
    switch (payee) {
      case 'SUPPLIER': return this.supplierOwed();
      case 'LOGISTICS': return this.logisticsOwed();
      case 'SEPARATE': return this.separateOwed();
      default: return 0;
    }
  }

  /** The plan in words, for the hint under a split of one's own. */
  planLabel(order: PurchaseOrder): string { return paymentPlanLabel(order, PAYMENT_TERMS); }
  splitTotalOf(order: PurchaseOrder): number { return splitTotal(order.payPctOrdered, order.payPctShipped, order.payPctArrived); }

  readonly paymentPlanOrder = signal<PurchaseOrder | null>(null);
  readonly paymentPlanBusy = signal(false);
  readonly paymentPlanFailure = signal<string | null>(null);

  openPaymentPlan(): void {
    const data = this.view();
    if (!data || this.saving() || this.payingBusy() || this.paymentPlanBusy()) return;
    this.paymentPlanFailure.set(null);
    this.paymentPlanOrder.set(JSON.parse(this.savedOrder()) as PurchaseOrder);
  }

  async savePaymentPlan(changes: PaymentPlanFields): Promise<void> {
    const data = this.view();
    if (!data || !this.paymentPlanOrder() || this.paymentPlanBusy() || this.saving() || this.payingBusy()) return;
    const error = paymentPlanError(changes);
    if (error) { this.paymentPlanFailure.set(error); return; }
    const baseline = JSON.parse(this.savedOrder()) as PurchaseOrder;
    this.paymentPlanBusy.set(true);
    this.paymentPlanFailure.set(null);
    try {
      // Only the agreement is written. Other in-progress edits remain a local draft.
      const fresh = await this.sourcing.updatePurchaseOrder(data.order.id, { ...baseline, ...changes });
      if (this.view()?.order.id !== data.order.id) return;
      const draft = preservePurchaseDraft(this.view()!.order, baseline, fresh.order);
      ++this.previewVersion;
      this.savedOrder.set(JSON.stringify(fresh.order));
      this.view.set({ ...fresh, order: draft });
      this.paymentPlanOrder.set(null);
      await this.refreshPaymentState(data.order.id);
      if (this.view()?.order.id === data.order.id) this.ui.toast('Betaalafspraak opgeslagen; eerdere betalingen blijven behouden.', 'ok');
    } catch (failure: unknown) {
      if (this.view()?.order.id === data.order.id) this.paymentPlanFailure.set(messageOf(failure, 'De betaalafspraak kon niet worden opgeslagen. De huidige afspraak blijft behouden.'));
    } finally {
      this.paymentPlanBusy.set(false);
    }
  }

  /** A selected bank transaction keeps its actual debit when foreign goods amounts change. */
  setPaymentAmount(raw: string | number | null): void {
    if (this.payingBusy()) return;
    this.paying.update(pay => {
      if (!pay || pay.bankLinkPending || (pay.bankTransaction && pay.currency === 'EUR')) return pay;
      const amount = parsePurchasePaymentAmount(raw);
      const changed = amount !== pay.amount;
      return { ...pay, amountInput: raw == null ? '' : String(raw), amount, ...(pay.bankTransaction ? { amountEurInput: amountInputText(Math.abs(pay.bankTransaction.amountEur)), amountEur: Math.abs(pay.bankTransaction.amountEur) } : changed ? { amountEurInput: '', amountEur: null } : {}) };
    });
  }

  /** 'Afgeschreven in euro': what the bank really debited for a USD/CNY payment; empty means the order rate. */
  setPaymentAmountEur(raw: string | number | null): void {
    if (this.payingBusy()) return;
    this.paying.update(pay => pay ? { ...pay, amountEurInput: raw == null ? '' : String(raw), amountEur: parsePurchasePaymentAmount(raw) } : pay);
  }

  /** 'Dekt meer dan de goederen': the sea freight or the inspection the supplier billed, in the payment's currency. */
  setPaymentPart(part: 'freight' | 'separate', raw: string | number | null): void {
    if (this.payingBusy()) return;
    const input = raw == null ? '' : String(raw);
    const amount = parsePurchasePaymentAmount(raw);
    this.paying.update(pay => {
      if (!pay || pay.bankLinkPending) return pay;
      const changed = part === 'freight' ? { ...pay, freightAmountInput: input, freightAmount: amount }
        : { ...pay, separateAmountInput: input, separateAmount: amount };
      if (pay.bankTransaction && pay.currency === 'EUR') {
        const goods = Math.round((Math.abs(pay.bankTransaction.amountEur) - (changed.freightAmount ?? 0) - (changed.separateAmount ?? 0)) * 100) / 100;
        return { ...changed, amount: goods > 0 ? goods : null, amountInput: amountInputText(goods) };
      }
      return changed;
    });
  }

  /** The transfer as the ledger will store it: the goods and the extra streams, and what leaves the bank in euro. */
  readonly paymentTransfer = computed(() => {
    const pay = this.paying();
    return pay && pay.amount !== null ? splitTransfer({ ...pay, amount: pay.amount }, (amount, currency) => this.eurOf(amount, currency)) : null;
  });
  /**
   * The euro of the whole transfer. Once the goods payment is posted the split
   * stands: the ledger's figures for what is saved, the planned shares for the
   * rest. Before that a typed debit already covers goods and parts; without
   * one the goods count as the draft values them (a stored euro survives) and
   * the parts at the order rate on top.
   */
  readonly paymentTransferEur = computed(() => {
    const pay = this.paying();
    const split = this.paymentTransfer();
    if (!pay || pay.amount === null || !split) return 0;
    if (pay.planned) {
      const payments = this.payments() ?? [];
      const parts = pay.planned.parts.reduce((sum, part, index) => sum + (payments.find(payment => payment.id === pay.partIds?.[index])?.amountEur ?? this.writeEur(part)), 0);
      return Math.round((pay.planned.goodsEur + parts) * 100) / 100;
    }
    if (split.writes[0].amountEur != null) return split.bankEur;
    return Math.round((this.paymentDraftEur() + split.bankEur - this.writeEur(split.writes[0])) * 100) / 100;
  });
  /** The euro of one planned write: its share of the typed debit, else the order rate. */
  private writeEur(write: PurchasePaymentWrite): number {
    return write.amountEur ?? Math.round(this.eurOf(write.amount, write.currency) * 100) / 100;
  }
  /** The goods payment alone, for the overage hint: its frozen figure, its share of the typed debit, else the draft's value. */
  readonly paymentGoodsEur = computed(() => {
    const pay = this.paying();
    return pay?.planned ? pay.planned.goodsEur : this.paymentTransfer()?.writes[0].amountEur ?? this.paymentDraftEur();
  });
  readonly paymentCif = computed(() => { const data = this.view(); return !!data && purchaseCif(data); });

  /* ---- the bank lines of the order screen, and which payments already sit on the bank */
  private readonly banking = inject(BankingApi);
  private readonly bankAccounts = inject(BankAccountsStore);
  /** Every bank line, once per order screen: the text markers of lines older than the hard link. */
  readonly bankLines = signal<BankStatementLine[] | null>(null);
  readonly bankedPaymentIds = computed(() => {
    const ids = new Set<number>();
    for (const markers of lineMarkers(this.bankLines() ?? []).values()) {
      for (const marker of markers) if (marker.kind === 'containerbetaling') ids.add(marker.id);
    }
    return ids;
  });
  /** A payment already on the bank gets no second line: the hard link first, an older line's marker as fallback. */
  paymentOnBank(pay: { id?: number | null }): boolean {
    if (!pay.id) return false;
    return (this.payments() ?? []).some(payment => payment.id === pay.id && payment.bankStatementLineId != null) || this.bankedPaymentIds().has(pay.id);
  }
  readonly payingOnBank = computed(() => { const pay = this.paying(); return !!pay && this.paymentOnBank(pay); });

  /** The bank side of the order screen: the accounts (their names in the sheet), and the lines once. */
  private async loadBankLines(): Promise<void> {
    void this.bankAccounts.load();
    if (this.bankLines() !== null) return;
    try { this.bankLines.set(await this.banking.list()); } catch { /* the marks are a hint; without them the sheet still asks */ }
  }

  /** The bank's day: a payment dated after it cannot be on a statement yet. */
  bankToday(): string { return receiptLocalParts(Date.now(), BANK_ZONE).day; }

  /* ---- "Deze transactie dekt ook andere containers" (owner addition 2026-10-15): the other containers of the transfer */
  private readonly cashApi = inject(CashForecastApi);
  /** `failed`: the containers or their payments did not load; the sheet says so and offers to load again (never an empty list that hides an open payment). */
  readonly alsoState = signal<{ loading: boolean; supported: boolean; options: AlsoContainerOption[]; failed?: boolean }>({ loading: false, supported: true, options: [] });
  private alsoFor: string | null = null;
  /**
   * Once per order screen and payee: the containers with an open amount or an
   * open payment of that payee (the supplier's first, those with an open
   * payment before them); a server without parts per order says so. With
   * 'Verdelen over containers' chosen the first rows are proposed.
   */
  async loadAlso(orderId: number, supplierId: number | null, payee: Payee = 'SUPPLIER'): Promise<void> {
    const key = `${orderId}:${payee}`;
    if (this.alsoFor === key) { this.proposeShareRows(); return; }
    this.alsoFor = key;
    this.alsoState.set({ loading: true, supported: true, options: [] });
    try {
      // The payments are what links an open one instead of a second: a failed list fails the load (toast, retry by opening again), so an
      // open payment is never hidden behind 'Nieuw'. Only a server without the list (404/405, no reason of its own) offers the open terms alone.
      const [settings, views, suppliers, rows] = await Promise.all([this.cashApi.settings(), this.sourcing.purchaseOrders(), this.sourcing.suppliers(),
        this.sourcing.purchasePayments().catch((failure: unknown) => { if (this.shareMissing(failure)) return [] as PurchasePaymentRow[]; throw failure; })]);
      if (this.alsoFor !== key) return;
      this.paymentRows.set({ orderId, rows });
      const names = new Map(suppliers.filter(row => row.id != null).map(row => [row.id!, row.name]));
      this.alsoState.set({ loading: false, supported: settings !== null,
        options: alsoContainerOptions(containerPayables(views), views.map(view => ({ id: view.order.id, supplierId: view.order.supplierId ?? null })), names, orderId, supplierId,
          { payments: rows, views, payee }) });
      this.proposeShareRows();
    } catch (failure: unknown) {
      if (this.alsoFor !== key) return;
      this.alsoFor = null;
      this.alsoState.set({ loading: false, supported: true, options: [], failed: true });
      this.ui.toast(messageOf(failure, 'Containers laden mislukt'), 'err');
    }
  }
  /**
   * 'Verdelen over containers' just chosen, no row yet: the same supplier's
   * open payments on this payment's term noted within a week, split 'Volgens
   * afspraak' (once; the owner adds, removes and types from there).
   */
  private proposeShareRows(): void {
    const pay = this.paying(), data = this.view();
    if (!pay || !data || pay.surplus !== 'SHARE' || (pay.alsoParts ?? []).length || pay.shareProposed || this.alsoState().loading) return;
    const part = this.payingParts().find(item => item.id === pay.pendingPartId);
    const line = pay.pendingLines?.length === 1 ? pay.pendingLines[0] : null;
    if (!part || !line) return;
    const rows = proposeShare(this.alsoState().options, { orderId: data.order.id, due: part.payment.instalmentDue ?? null,
      label: part.payment.label ?? (pay.label || null), paidOn: part.paidOn }, data.order.supplierId ?? null);
    const applied = rows.length ? applyShare('AFSPRAAK', line.amountEur, pendingPartEur(part, pay.partEdits?.[part.id], null), rows) : null;
    this.paying.set({ ...pay, shareProposed: true, ...(applied
      ? { alsoParts: applied.parts, shareOwn: applied.own, shareOwnInput: amountInputText(applied.own), shareMode: 'AFSPRAAK' as const } : { alsoParts: rows }) });
  }
  /**
   * After a refused share or transfer: the containers as the server has them
   * now. A row keeps its part and takes its open payment's euro again; a row
   * whose payment is gone or on the bank is dropped (the refusal says why).
   * A share 'Volgens afspraak' or 'Gelijk verdelen' splits again over what
   * the server has now (a changed payment weighs its new euro), so the
   * pressed button and the amounts agree; a row without a weight makes the
   * amounts typed (MANUAL).
   */
  private async refreshAlsoRows(orderId: number, supplierId: number | null, payee: Payee): Promise<void> {
    this.alsoFor = null;
    await this.loadAlso(orderId, supplierId, payee);
    const pay = this.paying();
    // Not loaded: the rows stay as they are (the server checks each payment's euro again), the sheet offers to load again.
    if (!pay || this.view()?.order.id !== orderId || this.alsoState().failed) return;
    const options = this.alsoState().options;
    const rows = (pay.alsoParts ?? []).flatMap(part => {
      if (part.paymentId == null) return [part];
      const payment = options.find(option => option.orderId === part.orderId)?.openPayments?.find(item => item.id === part.paymentId);
      return payment ? [{ ...part, paymentEur: payment.amountEur, paymentAmount: payment.amount, paymentCurrency: payment.currency, paidOn: payment.paidOn }] : [];
    });
    const mode = pay.id && pay.surplus === 'SHARE' ? pay.shareMode : undefined;
    if (mode !== 'AFSPRAAK' && mode !== 'EQUAL') { this.paying.set({ ...pay, alsoParts: rows }); return; }
    const part = this.payingParts().find(item => item.id === pay.pendingPartId);
    const line = pay.pendingLines?.length === 1 ? pay.pendingLines[0] : null;
    const applied = part && line && rows.length ? applyShare(mode, line.amountEur, pendingPartEur(part, pay.partEdits?.[part.id], null), rows) : null;
    // No row left: nothing to split yet, the mode stays for the next container added.
    this.paying.set({ ...pay, ...(applied
      ? { alsoParts: applied.parts, shareOwn: applied.own, shareOwnInput: amountInputText(applied.own) }
      : { alsoParts: rows, ...(rows.length ? { shareMode: 'MANUAL' as const } : {}) }) });
  }

  /** Every container payment as GET /purchase-payments lists them (once per order screen): which other containers a bank line of this one carries. */
  readonly paymentRows = signal<{ orderId: number; rows: PurchasePaymentRow[] } | null>(null);
  private async loadPaymentRows(orderId: number, force = false): Promise<void> {
    if (!force && this.paymentRows()?.orderId === orderId) return;
    try {
      const rows = await this.sourcing.purchasePayments();
      if (this.view()?.order.id === orderId) this.paymentRows.set({ orderId, rows });
    } catch { /* a hint only: the sheet then names this container's own payments on the line */ }
  }
  /** 'Deze transactie draagt ook: PO-2026-039 € 3.801,13, …': the other containers' payments on the lines of the payment in the sheet. */
  readonly payingLineShares = computed(() => {
    const data = this.view(), loaded = this.paymentRows();
    if (!data || !loaded || loaded.orderId !== data.order.id) return [];
    const lines = new Set(this.payingParts().map(part => part.bankStatementLineId).filter((id): id is number => id != null));
    return loaded.rows.filter(row => row.bankStatementLineId != null && lines.has(row.bankStatementLineId) && row.orderId !== data.order.id)
      .map(row => ({ lineId: row.bankStatementLineId!, name: containerName({ id: row.orderId, number: row.orderNumber, alias: row.orderAlias }), amountEur: row.amountEur }))
      .sort((left, right) => left.name.localeCompare(right.name, 'nl', { numeric: true }));
  });
  /** The other containers' parts this save sends: a new EUR supplier payment on a picked transaction only. */
  private alsoPartsOf(pay: PurchasePaymentDraft) {
    return !pay.id && pay.bankTransaction && pay.alsoOpen && pay.payee === 'SUPPLIER' && pay.currency === 'EUR' ? pay.alsoParts ?? [] : [];
  }

  /** The euro value of the draft: the bank amount when filled in, else the stored value of unchanged money, else the order rate. */
  readonly paymentDraftEur = computed(() => {
    const pay = this.paying();
    if (!pay || pay.amount === null) return 0;
    if (pay.currency !== 'EUR' && pay.amountEur != null && pay.amountEur > 0) return pay.amountEur;
    const previous = (this.payments() ?? []).find(payment => payment.id === pay.id);
    if (previous && previous.currency === pay.currency && Math.round(previous.amount * 100) === Math.round(pay.amount * 100)) return previous.amountEur;
    return Math.round(this.eurOf(pay.amount, pay.currency) * 100) / 100;
  });

  /** The order-rate value of the foreign amount, for the placeholder and the hint of the bank amount field. */
  readonly paymentRateEur = computed(() => {
    const pay = this.paying();
    if (!pay || pay.amount === null || pay.currency === 'EUR') return 0;
    return Math.round(this.eurOf(pay.amount, pay.currency) * 100) / 100;
  });

  closePayment(): void { if (!this.payingBusy()) this.paying.set(null); }

  /**
   * Opens the noted payment for correction: the day, the amount, the words, who got it; a foreign payment brings its booked euro value.
   * A payment paid in parts opens on its root (the transfer whose id is the group's), with every transfer listed in the sheet.
   */
  editPayment(payment: PurchasePayment): void {
    if (this.payingBusy() || this.paymentStateLoading() || this.dirty() || this.paymentPlanBusy()) return;
    const members = this.groupOf(payment);
    // The payment the screen handed over is the root when it is one (it carries what the screen shows); else the group's root.
    const root = payment.id === (payment.groupId ?? payment.id) ? payment
      : members.find(member => member.id === payment.groupId) ?? members[0] ?? payment;
    const main = root.invoiceId == null ? this.unresolvedMainInvoice(root, members) : null;
    this.paying.set({ ...this.storedPaymentDraft(root, members), label: root.label ?? '', payee: root.payee ?? 'SUPPLIER', files: [], settles: !!root.settles,
      instalmentDue: root.instalmentDue ?? null,
      invoiceId: main ?? root.invoiceId ?? null, invoiceIdChanged: main !== null });
    void this.loadBankLines();
    // A transaction shared with other containers names them under Betaalbewijs.
    if (members.some(member => member.bankStatementLineId != null)) void this.loadPaymentRows(root.orderId);
  }

  /** The money, the day and the transfers of a saved payment as the sheet starts from them; a foreign payment brings its booked euro value. */
  private storedPaymentDraft(root: PurchasePayment, members: readonly PurchasePayment[]): Pick<PurchasePaymentDraft,
    'id' | 'amount' | 'amountInput' | 'currency' | 'paidOn' | 'amountEurInput' | 'amountEur' | 'groupIds'> {
    const foreign = root.currency !== 'EUR' && Number.isFinite(root.amountEur) && root.amountEur > 0;
    return { id: root.id, amount: root.amount, amountInput: amountInputText(root.amount), currency: root.currency, paidOn: root.paidOn,
      amountEurInput: foreign ? amountInputText(root.amountEur) : '', amountEur: foreign ? root.amountEur : null,
      groupIds: [root.id, ...members.filter(member => member.id !== root.id).map(member => member.id)] };
  }

  /**
   * The payee has two or more invoices and none is this payment's yet (the
   * automatic rule only picks the payee's only invoice): the sheet starts on
   * the main one, so saving the payment assigns it (Emre, 2026-10-15).
   */
  private unresolvedMainInvoice(root: PurchasePayment, members: readonly PurchasePayment[]): number | null {
    const invoices = this.view()?.invoices ?? [];
    const payee = root.payee ?? 'SUPPLIER';
    if (invoicesOf(invoices, payee).length < 2) return null;
    const ids = new Set(members.map(member => member.id));
    if (invoices.some(invoice => invoice.paymentIds?.some(id => ids.has(id)))) return null;
    return primaryInvoice(invoices, payee)?.id ?? null;
  }

  /** Every transfer of the payment's group, by day; a payment never split is a group of one. */
  private groupOf(payment: PurchasePayment): PurchasePayment[] {
    const key = payment.groupId ?? payment.id;
    const payee = payment.payee ?? 'SUPPLIER';
    const members = (this.payments() ?? []).filter(item => (item.groupId ?? item.id) === key && (item.payee ?? 'SUPPLIER') === payee);
    return (members.length ? members : [payment]).sort((left, right) => left.paidOn.localeCompare(right.paidOn) || left.id - right.id);
  }

  paymentGroupLabel(payee: Payee): string {
    return PAYEE_LABEL[payee];
  }

  /* ---- the round of 2026-10-15: invoices, bank transactions as proof, payments in parts, inspection via the supplier */

  /** The server knows invoices and payments in parts; against an older one every new action stays hidden. */
  readonly roundOnServer = computed(() => paymentRoundOnServer(this.view()));
  /** The ledger row of the payment in the sheet: its transfers and its proof files. */
  readonly payingRow = computed(() => {
    const id = this.paying()?.id;
    return id ? this.paymentLedger()?.rows.find(row => row.parts.some(part => part.id === id)) ?? null : null;
  });
  readonly payingParts = computed<LedgerPart[]>(() => {
    const row = this.payingRow();
    if (row) return row.parts;
    const id = this.paying()?.id;
    const stored = id ? (this.payments() ?? []).find(payment => payment.id === id) : undefined;
    return stored ? [{ id: stored.id, payment: stored, paidOn: stored.paidOn, amount: stored.amount, currency: stored.currency, amountEur: stored.amountEur,
      bankStatementLineId: stored.bankStatementLineId ?? null, onBank: this.paymentOnBank(stored), proofs: null }] : [];
  });
  readonly payingProofFiles = computed(() => this.payingRow()?.proofs ?? []);
  /** Older invoice files hung on the payment in the sheet: listed under Factuur, they take one of its five places. */
  readonly payingInvoiceFiles = computed(() => this.payingRow()?.invoiceFiles ?? []);
  /**
   * 'Rest als inspectie via leverancier' only where the server takes it
   * (inspectionRestOffered): a euro supplier goods payment (not the CIF
   * freight term) of a container with an inspection cost, no inspection noted
   * on the same transfer, and the inspection via the supplier not booked yet.
   */
  readonly payingInspectionOffered = computed(() => {
    const pay = this.paying(), data = this.view();
    if (!pay || !data || this.payingCreditOffset()) return false;
    const part = this.payingParts().find(item => item.id === (pay.pendingPartId ?? pay.id)) ?? null;
    const payments = this.payments() ?? [];
    const companions = part ? transferCompanions(part.payment, payments, pay.groupIds ?? []).length : 0;
    return inspectionRestOffered({ payee: pay.payee, instalmentDue: pay.instalmentDue ?? null, currency: part?.currency ?? pay.currency }, data.order, payments, companions);
  });
  /**
   * Where the edited payment's term stands against the Afspraak, the payment
   * itself counted as the server has it: the supplier term it counts for,
   * else its payee as a whole. The sheet says what more paid does to it
   * ('De termijn komt dan € 300,00 boven de afspraak') before the owner
   * chooses 'Bedrag aanpassen' or adds a transaction. Null for Andere kosten
   * or without the server's figures.
   */
  readonly payingTermStanding = computed<TermStanding | null>(() => {
    const pay = this.paying(), report = this.view()?.reconciliation;
    if (!pay?.id || !report) return null;
    const stored = (this.payments() ?? []).find(payment => payment.id === pay.id);
    const payee = stored?.payee ?? pay.payee;
    if (payee === 'OTHER') return null;
    const due = payee === 'SUPPLIER' ? stored?.instalmentDue ?? null : null;
    const term = due ? report.supplierInstalments?.find(step => step.due === due) : undefined;
    if (term) return { label: term.label, term: true, plannedEur: term.plannedEur, paidEur: term.paidEur };
    const stream = report.streams.find(item => item.payee === payee);
    return stream ? { label: PAYEE_LABEL[payee], term: false, plannedEur: stream.plannedEur, paidEur: stream.paidEur } : null;
  });
  /** How many payments the sheet's payee has (a payment in parts once): 'Geldt voor alle betalingen van Leverancier (n)'. */
  readonly payingPayeeCount = computed(() => {
    const payee = this.paying()?.payee;
    return payee ? (this.paymentLedger()?.rows ?? []).filter(row => row.payee === payee).length : 0;
  });
  /**
   * What the last link changed, for the Betalingen screen: 'Bedrag en datum
   * gevolgd van de transactie: … (was …)'. Kept per order until dismissed.
   */
  readonly paymentNotice = signal<{ orderId: number; text: string } | null>(null);
  readonly paymentNoticeText = computed(() => { const notice = this.paymentNotice(); return notice && notice.orderId === this.view()?.order.id ? notice.text : null; });
  dismissPaymentNotice(): void { this.paymentNotice.set(null); }
  /** '{account} · {dd/MM}' of a loaded bank line, for the ledgers' bank pills. */
  readonly bankLineLabel = (lineId: number): string | null => {
    const line = this.bankLines()?.find(item => item.id === lineId);
    if (!line) return null;
    const account = this.bankAccounts.options().find(option => option.key === line.account)?.label ?? line.account;
    const day = bankTransactionDay(line);
    return `${account} · ${day.slice(8, 10)}/${day.slice(5, 7)}`;
  };
  /** The Afspraak per payee in euro, for the invoice sheet's comparison. */
  readonly agreedByPayee = computed<Partial<Record<Payee, number | null>>>(() => Object.fromEntries(
    (this.paymentLedger()?.payees ?? []).map(item => [item.payee, item.agreedEur])) as Partial<Record<Payee, number | null>>);
  /** An invoice's euro at the container rate: the transport rate for Douane & transport, the goods rate otherwise (as the server books it). */
  readonly invoiceEurOf = (amount: number, currency: Currency, payee: Payee): number => {
    const order = this.view()?.order;
    if (!order || currency === 'EUR') return amount;
    const usdToEur = payee === 'LOGISTICS' && order.usdToEurTransport ? order.usdToEurTransport : order.usdToEurGoods ?? 1;
    return currency === 'USD' ? amount * usdToEur : amount * (order.cnyToUsd ?? 1) * usdToEur;
  };

  /** Loads the bank lines again after a link or an unlink, so the sheet and the pills show what the bank now carries. */
  private async reloadBankLines(lines: readonly BankStatementLine[] = []): Promise<void> {
    if (lines.length) {
      const ids = new Set(lines.map(line => line.id));
      this.bankLines.update(current => [...lines, ...(current ?? []).filter(line => !ids.has(line.id))]);
      return;
    }
    try { this.bankLines.set(await this.banking.list()); } catch { /* a hint only; the next screen load brings them */ }
  }

  /**
   * After an immediate action the sheet stays open on the same payment: the
   * root may have moved when a part was removed. Its money, day and euro come
   * from the stored root again (never the removed part's), and what an
   * earlier failed save left behind goes; the typed words, payee, term,
   * invoice choice and files stay.
   */
  private rebindPaying(previousIds: readonly number[]): void {
    const payments = this.payments() ?? [];
    const survivor = payments.find(payment => previousIds.includes(payment.id));
    if (!survivor) { this.paying.set(null); return; }
    const members = this.groupOf(survivor);
    const root = members.find(member => member.id === (survivor.groupId ?? survivor.id)) ?? members[0];
    this.paying.update(current => current ? { ...current, ...this.storedPaymentDraft(root, members),
      pendingLines: [], pendingPartId: null, partEdits: {}, bankLinkError: '',
      bankTransaction: null, bankLinkPending: false, bankLinkComplete: false, bankSavedPayment: undefined, inspectionExpectedEur: undefined,
      ...(root.id !== current.id ? { inspectionSplit: null, inspectionSplitInput: '' } : {}) } : current);
  }

  /** 'Losmaken' in the sheet: the bank transaction comes off at once (every payment on it), the sheet stays on the payment. */
  unlinkSheetLine(line: BankStatementLine): void {
    const data = this.view();
    const pay = this.paying();
    if (!data || !pay?.id || this.payingBusy()) return;
    const part = this.payingParts().find(item => item.bankStatementLineId === line.id);
    const day = bankTransactionDay(line).split('-').reverse().join('/');
    const more = part && Math.round(Math.abs(line.amountEur) * 100) - Math.round(part.amountEur * 100) > 2
      ? ' Ook de andere betalingen op deze transactie worden losgemaakt.' : '';
    const ids = pay.groupIds ?? [pay.id];
    this.ui.confirm({ title: 'Banktransactie losmaken', message: `Banktransactie van ${day} (${formatEur(Math.abs(line.amountEur))}) losmaken? Dit gebeurt meteen.${more}`,
      confirmLabel: 'Losmaken' }, async () => {
      if (this.payingBusy() || this.view()?.order.id !== data.order.id) return;
      this.payingBusy.set(true);
      try {
        await this.banking.unlinkPayments(line.id);
        await this.refreshPaymentState(data.order.id);
        await this.reloadBankLines();
        if (this.view()?.order.id !== data.order.id) return;
        this.rebindPaying(ids);
        this.ui.toast('Banktransactie losgemaakt', 'ok');
      } catch (failure: unknown) {
        this.ui.toast(messageOf(failure, 'Losmaken mislukt'), 'err');
      } finally {
        this.payingBusy.set(false);
      }
    });
  }

  /** 'Deel verwijderen': one unlinked transfer of a payment paid in parts goes at once. */
  removeSheetPart(part: LedgerPart): void {
    const data = this.view();
    const pay = this.paying();
    if (!data || !pay?.id || this.payingBusy()) return;
    const day = part.paidOn.slice(8, 10) + '/' + part.paidOn.slice(5, 7);
    const ids = (pay.groupIds ?? [pay.id]).filter(id => id !== part.id);
    this.ui.confirm({ title: 'Deel verwijderen', message: `Deel van ${day} (${formatEur(part.amountEur)}) verwijderen? De betaling telt daarna ${formatEur(part.amountEur)} minder.`,
      confirmLabel: 'Verwijderen', danger: true }, async () => {
      if (this.payingBusy() || this.view()?.order.id !== data.order.id) return;
      this.payingBusy.set(true);
      try {
        await this.sourcing.deletePayment(data.order.id, part.id);
        await Promise.all([this.refreshPaymentState(data.order.id), this.loadDocuments(data.order.id)]);
        if (this.view()?.order.id !== data.order.id) return;
        this.rebindPaying(ids);
        this.ui.toast('Deel verwijderd', 'ok');
      } catch (failure: unknown) {
        this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
      } finally {
        this.payingBusy.set(false);
      }
    });
  }

  /** The ✕ of a proof file in the sheet: the file goes at once, the payment stays. */
  removeSheetProof(doc: PurchaseDocument): void {
    if (this.payingBusy()) return;
    this.ui.confirm({ title: 'Bestand verwijderen', message: `Bestand <b>${escapeHtml(doc.originalFilename)}</b> verwijderen?`, confirmLabel: 'Verwijderen', danger: true },
      async () => {
        if (this.payingBusy()) return;
        this.payingBusy.set(true);
        try {
          await this.sourcing.deleteDocument(doc.orderId, doc.id);
          await this.loadDocuments(doc.orderId);
        } catch (failure: unknown) {
          this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
        } finally {
          this.payingBusy.set(false);
        }
      });
  }

  /** Opens a container file by id: an invoice's file, or one the sheet lists. */
  async openDocumentFile(file: { documentId: number; name: string | null }): Promise<void> {
    const data = this.view();
    if (!data) return;
    const known = (this.documents() ?? []).find(doc => doc.id === file.documentId);
    if (known) { await this.downloadDocument(known); return; }
    try { saveBlob(await this.sourcing.documentFile(data.order.id, file.documentId), file.name || 'factuur'); }
    catch { this.ui.toast('Document openen mislukt', 'err'); }
  }

  /* ---- Factuur toevoegen / aanpassen / 'Gegevens invullen' */
  readonly invoicing = signal<InvoiceSheetAction | null>(null);

  requestInvoice(request: InvoiceRequest): void {
    if (this.payingBusy() || !this.roundOnServer()) return;
    this.invoicing.set({ payee: request.payee, invoice: request.invoice, file: request.file });
  }

  closeInvoice(): void { if (!this.payingBusy()) this.invoicing.set(null); }

  /** Uploads a new file (once; a retry reuses it), then posts or puts the invoice and refreshes. */
  async submitInvoice(submission: InvoiceSheetSubmit): Promise<void> {
    const data = this.view();
    const action = this.invoicing();
    if (!data || !action || this.payingBusy()) return;
    const id = data.order.id;
    this.payingBusy.set(true);
    try {
      let documentId = submission.body.documentId ?? null;
      if (submission.file) {
        const doc = await this.sourcing.addDocument(id, submission.file, invoiceDocumentKind(submission.body.payee), null, null);
        documentId = doc.id;
        if (this.view()?.order.id === id) this.documents.update(current => [...(current ?? []), doc]);
        this.invoicing.update(current => current ? { ...current, documentId: doc.id, documentName: doc.originalFilename } : current);
      }
      const body = { ...submission.body, documentId };
      if (submission.invoiceId != null) await this.sourcing.updateInvoice(id, submission.invoiceId, body);
      else await this.sourcing.addInvoice(id, body);
      if (this.view()?.order.id !== id) return;
      await Promise.all([this.refreshPaymentState(id), this.loadDocuments(id)]);
      if (this.view()?.order.id !== id) return;
      this.invoicing.set(null);
      this.ui.toast('Factuur bewaard', 'ok');
      // 'Ander bestand': the file it replaced would stay as an invoice file without data; ask once whether it goes.
      const previous = action.invoice;
      if (submission.invoiceId != null && previous?.documentId != null && previous.documentId !== documentId) {
        this.offerRemoveReplacedFile(id, previous.documentId, previous.documentName);
      }
    } catch (failure: unknown) {
      if (this.view()?.order.id === id) this.ui.toast(messageOf(failure, 'Factuur bewaren mislukt'), 'err');
    } finally {
      this.payingBusy.set(false);
    }
  }

  /** After 'Ander bestand': the replaced file goes on a yes; otherwise it stays with the container as an invoice file without data. */
  private offerRemoveReplacedFile(orderId: number, documentId: number, name: string | null): void {
    this.ui.confirm({ title: 'Vorig bestand verwijderen',
      message: `Vorig bestand <b>${escapeHtml(name || 'factuur')}</b> verwijderen? Anders blijft het bij de container als factuurbestand zonder gegevens.`,
      confirmLabel: 'Verwijderen', danger: true }, async () => {
      if (this.payingBusy() || this.view()?.order.id !== orderId) return;
      this.payingBusy.set(true);
      try {
        await this.sourcing.deleteDocument(orderId, documentId);
        await Promise.all([this.refreshPaymentState(orderId), this.loadDocuments(orderId)]);
        if (this.view()?.order.id === orderId) this.ui.toast('Vorig bestand verwijderd', 'ok');
      } catch (failure: unknown) {
        if (this.view()?.order.id === orderId) this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
      } finally {
        this.payingBusy.set(false);
      }
    });
  }

  /**
   * 'Toewijzen aan alle betalingen': every payment of the invoice's payee
   * (each payment in parts whole) points to this invoice, in one call.
   */
  assignInvoiceToAll(invoice: PurchaseInvoice): void {
    const data = this.view();
    if (!data || this.payingBusy() || !this.roundOnServer()) return;
    const id = data.order.id;
    const count = (this.paymentLedger()?.rows ?? []).filter(row => row.payee === invoice.payee).length;
    this.ui.confirm({ title: 'Toewijzen aan alle betalingen',
      message: `Factuur <b>${escapeHtml(invoice.number)}</b> toewijzen aan alle ${count} ${count === 1 ? 'betaling' : 'betalingen'} van ${PAYEE_LABEL[invoice.payee]}? Een betaling die nu bij een andere factuur hoort, gaat naar deze factuur.`,
      confirmLabel: 'Toewijzen' }, async () => {
      if (this.payingBusy() || this.view()?.order.id !== id) return;
      this.payingBusy.set(true);
      try {
        await this.sourcing.assignInvoiceToAll(id, invoice.id);
        await this.refreshPaymentState(id);
        if (this.view()?.order.id === id) this.ui.toast(`Factuur ${invoice.number} geldt voor alle betalingen van ${PAYEE_LABEL[invoice.payee]}`, 'ok');
      } catch (failure: unknown) {
        if (this.view()?.order.id === id) this.ui.toast(messageOf(failure, 'Toewijzen mislukt'), 'err');
      } finally {
        this.payingBusy.set(false);
      }
    });
  }

  removeInvoice(invoice: PurchaseInvoice): void {
    const data = this.view();
    if (!data || this.payingBusy()) return;
    const id = data.order.id;
    this.ui.confirm({ title: 'Factuur verwijderen',
      message: `Factuur <b>${escapeHtml(invoice.number)}</b> verwijderen? Het bestand blijft bij de container; de betalingen blijven staan.`,
      confirmLabel: 'Verwijderen', danger: true }, async () => {
      if (this.payingBusy() || this.view()?.order.id !== id) return;
      this.payingBusy.set(true);
      try {
        await this.sourcing.deleteInvoice(id, invoice.id);
        await Promise.all([this.refreshPaymentState(id), this.loadDocuments(id)]);
        if (this.view()?.order.id !== id) return;
        this.invoicing.set(null);
        this.ui.toast('Factuur verwijderd', 'ok');
      } catch (failure: unknown) {
        if (this.view()?.order.id === id) this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
      } finally {
        this.payingBusy.set(false);
      }
    });
  }

  /**
   * 'Inspectie via leverancier' on or off. Afterwards the payment state is
   * refreshed; the endpoint's answer never becomes the view (the editor would
   * read the order as unsaved).
   */
  setInspectionVia(value: boolean): void {
    const data = this.view();
    if (!data || this.payingBusy() || !this.roundOnServer()) return;
    const id = data.order.id;
    const write = async () => {
      if (this.payingBusy() || this.view()?.order.id !== id) return;
      this.payingBusy.set(true);
      try {
        await this.sourcing.setInspectionViaSupplier(id, value);
        if (this.view()?.order.id !== id) return;
        await this.refreshPaymentState(id);
        if (this.view()?.order.id === id) this.ui.toast(value ? 'Inspectie via leverancier staat aan' : 'Inspectie via leverancier staat uit', 'ok');
      } catch (failure: unknown) {
        if (this.view()?.order.id === id) this.ui.toast(messageOf(failure, 'Opslaan mislukt'), 'err');
      } finally {
        this.payingBusy.set(false);
      }
    };
    if (value) { void write(); return; }
    this.ui.confirm({ title: 'Inspectie via leverancier',
      message: 'Inspectie via leverancier uitzetten? De inspectie hoort dan niet meer bij de factuur van de leverancier.', confirmLabel: 'Uitzetten' }, write);
  }

  /** A new payment whose payee has two or more invoices starts on the primary one (explicit); one invoice or none stays automatic. */
  private preselectedInvoice(payee: Payee): number | null {
    const invoices = (this.view()?.invoices ?? []).filter(invoice => invoice.payee === payee);
    return invoices.length >= 2 ? primaryInvoice(invoices, payee)?.id ?? null : null;
  }

  /** The files picked for the bank statement, five at most. */
  pickProofFiles(event: Event): File[] {
    const files = (event.target as HTMLInputElement | null)?.files;
    return files ? Array.from(files).slice(0, 5) : [];
  }
  readonly payingBusy = signal(false);

  /** What the supplier is owed: goods, plus the sea freight when it is in the price. */
  readonly supplierOwed = computed(() => this.reconciliationStream('SUPPLIER')?.plannedEur ?? this.view()?.payable?.supplierEur ?? this.view()?.costing.totals.goodsEur ?? 0);
  /** What the plan's percentages split: the goods only; a CIF supplier's sea freight is its own term. */
  readonly planAgreedEur = computed(() => Math.max(0, Math.round((this.supplierOwed() - (this.view()?.payable?.supplierFreightEur ?? 0)) * 100) / 100));
  readonly logisticsOwed = computed(() => this.reconciliationStream('LOGISTICS')?.plannedEur ?? this.view()?.payable?.logisticsEur ?? 0);
  paymentsTo(payee: Payee): PurchasePayment[] {
    return (this.payments() ?? []).filter((payment) => (payment.payee ?? 'SUPPLIER') === payee);
  }
  paidTo(payee: Payee): number {
    return this.reconciliationStream(payee)?.paidEur ?? this.paymentsTo(payee).reduce((sum, payment) => sum + payment.amountEur, 0);
  }
  /* The supplier stream, as the plan and the balance see it. */
  readonly paidTotalEur = computed(() => this.paidTo('SUPPLIER'));
  readonly remainingEur = computed(() => this.openFor('SUPPLIER'));
  /** Fractions of the goods that still fit in what is open: after 2/3 only the rest remains. */
  /**
   * One tap fills in what the plan asks: every open instalment of the agreed
   * plan, then the rest. Without a plan the classic fractions stand in.
   */
  readonly payChips = computed(() => {
    const goods = this.supplierOwed();
    const rest = Math.max(0, this.remainingEur());
    const planned = this.plannedInstalments()
      .filter((step) => step.state !== 'paid' && step.amount > 0)
      .map((step) => ({ label: step.label, amount: step.amount, due: step.due }));
    const chips: { label: string; amount: number; due: PurchasePayment['instalmentDue'] }[] = planned
      .filter((chip) => chip.amount > 0 && chip.amount <= rest + 0.005);
    if (rest > 0.005 && !chips.some((chip) => Math.abs(chip.amount - rest) < 0.005)) {
      chips.push({ label: 'Rest', amount: Math.round(rest * 100) / 100, due: null });
    }
    return chips;
  });

  /** What is still open on the stream a payment goes to. */
  openFor(payee: Payee): number {
    const stream = this.reconciliationStream(payee);
    if (stream) return stream.remainingEur;
    if (this.settledFor(payee) || payee === 'OTHER') return 0;
    const owed = this.owedFor(payee);
    const open = Math.round(Math.max(0, owed - this.paidTo(payee)) * 100) / 100;
    /* Short by the small change of paying counts as paid; nothing is asked for it. */
    return this.paidTo(payee) > 0 && open <= PAYMENT_TOLERANCE_EUR ? 0 : open;
  }

  /** A payment beyond what is open is a mistake; the sheet says so before the server does. */
  readonly payingOverage = computed(() => {
    const pay = this.paying();
    if (!pay || pay.amount === null || !((pay.amount ?? 0) > 0)) return 0;
    if (pay.payee === 'OTHER') return 0;
    const owed = this.owedFor(pay.payee);
    if (!(owed > 0)) return 0;
    const previous = (this.payments() ?? []).find(payment => payment.id === pay.id && (payment.payee ?? 'SUPPLIER') === pay.payee);
    return purchasePaymentOverage(owed, this.paidTo(pay.payee), this.paymentGoodsEur(), previous?.amountEur ?? 0);
  });

  eurOf(amount: number, currency: Currency): number {
    const order = this.view()?.order;
    if (!order) return amount;
    if (currency === 'USD') return amount * (order.usdToEurGoods ?? 1);
    if (currency === 'CNY') return amount * (order.cnyToUsd ?? 1) * (order.usdToEurGoods ?? 1);
    return amount;
  }

  private async loadPayments(orderId: number): Promise<void> {
    const version = this.paymentRefreshVersion;
    try {
      const payments = await this.sourcing.payments(orderId);
      if (Number(this.id()) === orderId && version === this.paymentRefreshVersion) this.payments.set(payments);
    }
    catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Betalingen laden mislukt; vernieuw de order'), 'err');
    }
  }

  /** Publish the ledger and its calculation together; a failed refresh must never keep an old slot status. */
  async refreshPaymentState(orderId = this.view()?.order.id): Promise<boolean> {
    if (orderId == null || this.view()?.order.id !== orderId) return false;
    const version = ++this.paymentRefreshVersion;
    ++this.previewVersion;
    if (this.previewTimer !== null) { clearTimeout(this.previewTimer); this.previewTimer = null; }
    this.paymentStateLoading.set(true);
    this.paymentStateError.set(null);
    const active = () => version === this.paymentRefreshVersion
      && Number(this.id()) === orderId && this.view()?.order.id === orderId;
    try {
      const [payments, fresh] = await Promise.all([
        this.sourcing.payments(orderId), this.sourcing.purchaseOrder(orderId),
      ]);
      if (!active()) return false;
      // A user may continue typing while the request is in flight. Only publish
      // a preview matching that exact draft, including new server diary entries.
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = this.view()!;
        const snapshot = JSON.stringify(current.order);
        const baseline = JSON.parse(this.savedOrder()) as PurchaseOrder;
        const order = preservePurchaseDraft(current.order, baseline, fresh.order);
        const dirty = JSON.stringify(order) !== JSON.stringify(fresh.order);
        const next = dirty ? await this.sourcing.previewPurchaseOrder(orderId, order) : fresh;
        if (!active()) return false;
        if (snapshot !== JSON.stringify(this.view()!.order)) continue;
        ++this.previewVersion;
        this.savedOrder.set(JSON.stringify(fresh.order));
        this.payments.set(payments);
        this.view.set({ ...next, order });
        this.paymentStateError.set(null);
        return true;
      }
      throw new Error('De order werd tijdens het vernieuwen gewijzigd. Laad het betalingsoverzicht opnieuw.');
    } catch (failure: unknown) {
      if (active()) {
        ++this.previewVersion;
        this.payments.set(null);
        this.view.update(current => current ? { ...current, reconciliation: null } : current);
        this.paymentStateError.set(messageOf(failure, 'Het betalingsoverzicht kon niet worden vernieuwd. Laad het opnieuw.'));
      }
      return false;
    } finally {
      if (version === this.paymentRefreshVersion) this.paymentStateLoading.set(false);
    }
  }

  openPayment(amount?: number, label?: string, payee: Payee = 'SUPPLIER', instalmentDue: PurchasePayment['instalmentDue'] = null): void {
    if (this.payingBusy() || this.paymentStateLoading() || this.paymentStateError() || this.dirty() || this.paymentPlanBusy()) return;
    const rest = Math.max(0, this.openFor(payee));
    /* An instalment can ask more than what is still open when earlier
       payments did not line up exactly; never prefill beyond the rest. */
    const capped = rest > 0.005 ? Math.min(amount ?? rest, rest) : (amount ?? rest);
    this.paying.set({
      amount: capped > 0 ? Math.round(capped * 100) / 100 : null,
      amountInput: amountInputText(Math.round(capped * 100) / 100),
      currency: 'EUR',
      paidOn: new Date().toISOString().slice(0, 10),
      label: label ?? (payee === 'SUPPLIER' ? (rest > 0.005 && this.paidTotalEur() > 0 ? 'Saldo' : '')
        : payee === 'LOGISTICS' ? 'Douane & transport' : payee === 'SEPARATE' ? 'Inspectie' : ''),
      payee,
      files: [],
      settles: false,
      instalmentDue: payee === 'SUPPLIER' && Array.isArray(this.view()?.reconciliation?.supplierInstalments) ? instalmentDue : null,
      invoiceId: this.preselectedInvoice(payee), invoiceIdChanged: false,
    });
  }

  /**
   * The plan's instalments against what was paid: instalments are ticked
   * off in order by the paid total, the first unpaid one whose moment has
   * come is "due", the rest wait.
   */
  readonly plannedInstalments = computed(() => {
    const data = this.view();
    if (!data || this.paymentStateError()) return [];
    return purchaseInstalmentState(data, instalmentsOf(data.order, PAYMENT_TERMS), this.payments());
  });

  /** The terms a payment can count for; a netted one (offsetEur) is never settled on its own, see PurchasePaymentScope. */
  readonly paymentInstalmentOptions = computed(() => {
    const data = this.view();
    return data && Array.isArray(data.reconciliation?.supplierInstalments)
      ? data.reconciliation!.supplierInstalments!.map(({ due, label, offsetEur }) =>
        ({ due, label, netted: Math.round((Number.isFinite(offsetEur) ? offsetEur as number : 0) * 100) !== 0 })) : [];
  });

  /**
   * Saves the sheet, each step retry-safe through the draft and the server's
   * retry rules: an inline new invoice (file, then the invoice); the payment
   * (a new transfer with its parts, or the corrections of a saved payment: the
   * unlinked transfers of a payment in parts first, then one PUT on the root
   * for the whole group); the proof files; the picked bank transactions (one
   * for the whole payment or a part of it, or several that make the amount);
   * last the inspection split off a goods payment, after the links.
   */
  async confirmPayment(): Promise<void> {
    const data = this.view();
    const pay = this.paying();
    if (!data || !pay || pay.amount === null || !Number.isFinite(pay.amount) || !((pay.amount ?? 0) > 0)
      || !pay.paidOn || this.payingBusy() || this.paymentStateLoading() || this.paymentStateError()
      || this.dirty() || this.paymentPlanBusy()) return;
    if (pay.instalmentDue != null && !Array.isArray(data.reconciliation?.supplierInstalments)) {
      this.ui.toast('Laad de order opnieuw voordat je een betaling aan een termijn koppelt.', 'err');
      return;
    }
    // Closing a netted term alone takes it out of the netting and reopens the term it was netted with.
    if (pay.settles && pay.payee === 'SUPPLIER' && pay.instalmentDue != null
      && this.paymentInstalmentOptions().some(option => option.due === pay.instalmentDue && option.netted)) {
      this.ui.toast('Deze termijn is verrekend met een andere termijn. Reken alles aan de leverancier af, niet deze termijn alleen.', 'err');
      return;
    }
    if (pay.files.length > this.proofSlots(pay.id)) { this.ui.toast('Er passen maximaal vijf bestanden bij één betaling. Verwijder eerst bestanden uit de selectie.', 'err'); return; }
    const round = this.roundOnServer();
    // 'Factuur toevoegen…' with a number the payee already has: that is another invoice (only after a lost answer of this sheet's own
    // call is it ours, invoiceAttempt). Nothing is written; the typed data and the file stay for the owner to pick that invoice.
    const typedKey = invoiceNumberKey(pay.newInvoice?.number);
    const duplicate = round && pay.newInvoice?.open && pay.createdInvoiceId == null && typedKey && pay.invoiceAttempt !== typedKey
      ? invoicesOf(data.invoices ?? [], pay.payee).find(invoice => invoiceNumberKey(invoice.number) === typedKey) ?? null : null;
    if (duplicate) { this.ui.toast(`Factuur ${duplicate.number} bestaat al: kies die bij Factuur, of gebruik een ander nummer.`, 'err'); return; }
    // 'Bestand bij de factuur' goes to the invoice the sheet showed; without one it is kept, never dropped.
    const fileInvoice = round && pay.invoiceFile ? this.invoiceFileTarget(pay) : null;
    if (round && pay.invoiceFile && !fileInvoice) { this.ui.toast('Kies eerst de factuur waar het bestand bij hoort.', 'err'); return; }
    if ((pay.pendingPartAmountInput ?? '').trim() && pay.pendingPartAmount == null) { this.ui.toast('Vul een positief deel in, of laat het leeg voor de hele betaling.', 'err'); return; }
    const offset = !!this.payingCreditOffset();
    const parts = pay.id ? this.payingParts() : [];
    const grouped = parts.length > 1;
    // A retry after a lost answer: the refreshed payment already carries every picked transaction, so there is nothing left to link.
    const alreadyLinked = round && pendingAlreadyLinked(pay.pendingLines ?? [], parts);
    const pendingLines = alreadyLinked ? [] : pay.pendingLines ?? [];
    // The picked transactions are checked against that part's amount before any inspection split.
    const pendingPart = pay.id ? parts.find(part => part.id === (pay.pendingPartId ?? pay.id)) ?? null : null;
    // The same rule as the sheet: with this round the part as booked (the payment follows the transaction); an older server
    // writes the draft first, so a payment never split counts as the draft values its money.
    const pendingEur = !pendingPart ? 0 : pendingPartEur(pendingPart, pay.partEdits?.[pendingPart.id], grouped || round ? null : this.paymentDraftEur());
    // The inspection noted with the goods of this transfer goes on the same transaction when together they make it.
    const companions = pendingPart && round ? transferCompanions(pendingPart.payment, this.payments() ?? [], pay.groupIds ?? []) : [];
    // A USD/CNY transfer is compared in its own currency, as the server does: whole, or the part named in that currency.
    const foreign = pendingPart && pendingPart.currency !== 'EUR'
      ? { amount: pay.partEdits?.[pendingPart.id]?.amount ?? pendingPart.amount, currency: pendingPart.currency, part: pay.pendingPartAmount ?? null } : null;
    // 'Transactie toevoegen' on a payment fully on the bank: the one picked transaction grows it (bank-part with 'ADJUST').
    const plan = !pendingPart || !pendingLines.length ? { kind: 'none' as const } : pay.addTransfer ? growLinkPlan(pendingLines)
      : pendingLinkPlan(pendingEur, pendingLines, round, pay.surplus ?? null, companions, foreign);
    if (plan.kind === 'invalid') { this.ui.toast(plan.message, 'err'); return; }
    if (plan.kind === 'higher') { this.ui.toast(`${surplusQuestion(plan.extraEur)}: kies eerst wat er met het verschil gebeurt.`, 'err'); return; }
    // 'Verdelen over containers': the parts must make the transaction before anything is written.
    const shareParts = plan.kind === 'share' ? pay.alsoParts ?? [] : [];
    if (plan.kind === 'share' && (!shareParts.length || shareParts.some(part => !((part.amount ?? 0) > 0)) || !((pay.shareOwn ?? 0) > 0)
      || !shareStatus(pay.shareOwn ?? null, shareParts, pendingLines[0].amountEur).matches)) {
      this.ui.toast(`Verdeel eerst de transactie: samen moeten de delen ${formatEur(Math.abs(pendingLines[0].amountEur))} zijn.`, 'err'); return;
    }
    const also = this.alsoPartsOf(pay);
    if (also.some(part => part.amount === null)) { this.ui.toast('Vul bij elke andere container een positief bedrag in.', 'err'); return; }
    if (pay.bankTransaction && !bankAmountsMatch(this.paymentTransferEur() + alsoTotalEur(also), Math.abs(pay.bankTransaction.amountEur))) {
      this.ui.toast(also.length ? 'Samen mogen de containers maximaal € 0,02 afwijken van de gekozen banktransactie.'
        : 'Het totaal van de betaling mag maximaal € 0,02 afwijken van de gekozen banktransactie.', 'err'); return;
    }
    const stored = pay.id ? (this.payments() ?? []).find(payment => payment.id === pay.id) : undefined;
    // A larger transaction whose rest becomes the inspection carries the split itself: a typed split is never sent on top.
    const split = round && !!pay.id && !grouped && !offset && pay.payee === 'SUPPLIER' && (stored?.payee ?? 'SUPPLIER') === 'SUPPLIER'
      && pay.instalmentDue !== 'FREIGHT' && !(pay.surplus && pendingLines.length) && (pay.inspectionSplit ?? 0) > 0 ? pay.inspectionSplit! : null;
    // A carve or a split over several transactions changes the goods payment: the inspection is split off in a later save, never in the same one.
    if (split !== null && inspectionSplitBlocked(plan)) { this.ui.toast('Eerst de banktransacties koppelen, daarna de inspectie afsplitsen.', 'err'); return; }
    this.payingBusy.set(true);
    let paymentSaved = false;
    let invoiceFiled = false;
    const done: string[] = [];
    try {
      // 1. 'Factuur toevoegen…' inline: the invoice with its file in one call, once; the payment then points to it.
      let invoiceId = pay.invoiceId ?? null;
      let invoiceChanged = !!pay.invoiceIdChanged;
      const sameSheet = (current: PurchasePaymentDraft | null) => !!current && (current.id ?? null) === (pay.id ?? null);
      // 'Voor alle deelbetalingen': beside another invoice of the payee every payment points to the new one; the payee's only invoice is everyone's already.
      const others = (number: string) => invoicesOf(data.invoices ?? [], pay.payee).some(invoice => invoice.number.trim().toLowerCase() !== number.trim().toLowerCase());
      try {
        if (round && pay.createdInvoiceId != null) { invoiceId = pay.createdInvoiceId; invoiceChanged = true; }
        else if (round && pay.newInvoice?.open && pay.newInvoice.amount !== null) {
          const fresh = pay.newInvoice;
          const forAll = (fresh.forAll ?? true) && others(fresh.number);
          // A lost answer of this sheet's own call (invoiceAttempt, marked before the call): the refreshed container has the invoice.
          // Any other invoice with the number was refused above, so `known` is always the one this sheet made.
          const known = pay.invoiceAttempt === typedKey
            ? invoicesOf(data.invoices ?? [], pay.payee).find(invoice => invoiceNumberKey(invoice.number) === typedKey) ?? null : null;
          const body = { payee: pay.payee, number: fresh.number.trim(), invoiceDate: fresh.invoiceDate, amount: fresh.amount!, currency: fresh.currency,
            amountEur: null, documentId: null, notes: null };
          if (!known) this.paying.update(current => sameSheet(current) ? { ...current!, invoiceAttempt: typedKey } : current);
          // The file belongs to the invoice (the container), never to this one payment: one call with the data and the file.
          const created = known ?? (fresh.file ? await this.sourcing.addInvoiceWithFile(data.order.id, body, fresh.file, forAll)
            : await this.sourcing.addInvoice(data.order.id, body));
          // The retry found the invoice without the file it was sent with: the file follows, to the invoice.
          if (known && fresh.file && known.documentId == null) await this.sourcing.attachInvoiceFile(data.order.id, known.id, fresh.file);
          invoiceId = created.id;
          invoiceChanged = true;
          this.paying.update(current => sameSheet(current) ? { ...current!, createdInvoiceId: created.id, invoiceId: created.id, invoiceIdChanged: true,
            invoiceAssignedToAll: !!fresh.file && forAll && !known } : current);
          if (forAll && (!fresh.file || known)) {
            await this.sourcing.assignInvoiceToAll(data.order.id, created.id);
            this.paying.update(current => sameSheet(current) ? { ...current!, invoiceAssignedToAll: true } : current);
          }
        }
        // A retry after the invoice was made but its assignment failed.
        const assigning = this.paying();
        if (round && invoiceId !== null && pay.createdInvoiceId != null && assigning?.newInvoice && (assigning.newInvoice.forAll ?? true)
          && !assigning.invoiceAssignedToAll && others(assigning.newInvoice.number)) {
          await this.sourcing.assignInvoiceToAll(data.order.id, invoiceId);
          this.paying.update(current => sameSheet(current) ? { ...current!, invoiceAssignedToAll: true } : current);
        }
        // 'Bestand bij de factuur': the invoice the sheet showed had no file; it goes to that invoice in one call (once: a refreshed
        // invoice that has one is left alone). The file leaves the draft only then; a failed upload keeps it for the retry.
        if (fileInvoice && pay.invoiceFile && fileInvoice.documentId == null) {
          await this.sourcing.attachInvoiceFile(data.order.id, fileInvoice.id, pay.invoiceFile);
          invoiceFiled = true;
        }
        if (fileInvoice && pay.invoiceFile) this.paying.update(current => sameSheet(current) ? { ...current!, invoiceFile: null, invoiceFileFor: null } : current);
      } catch (failure: unknown) {
        // The invoice may exist after a lost answer: show the container as the server has it, so a retry recognises it.
        await this.refreshPaymentState(data.order.id);
        throw failure;
      }
      // 2. The payment. The bank's euro amount travels only when it was filled in for a USD/CNY payment; the server keeps the order rate otherwise.
      // Once the goods payment is posted the split stands: the goods go without a euro (the stored share survives unchanged money), only the pending parts follow.
      const frozen = pay.planned;
      const linkDay = plan.kind === 'links' ? bankTransactionDay(pendingLines[0]) : null;
      const [goods, ...fresh] = splitTransfer({ ...pay, amount: pay.amount, ...(frozen ? { amountEur: null, freightAmount: null, separateAmount: null } : {}),
        ...(linkDay ? { paidOn: linkDay } : {}),
        ...(round ? { invoiceId, inspectionViaSupplier: pay.inspectionViaSupplier ?? true } : {}) },
        (amount, currency) => this.eurOf(amount, currency)).writes;
      // A PUT sends the invoice only when the select changed (null included); omitted keeps the stored choice.
      if (pay.id && !invoiceChanged) delete goods.invoiceId;
      let atomicLine: BankStatementLine | null = null;
      let atomicIds: number[] | null = null;
      let saved: PurchasePayment;
      // Whether this save writes the payment; a link alone (untouched) or a retry (retained) writes nothing first.
      let wrote = true;
      if (pay.bankTransaction && !pay.id && also.some(part => part.paymentId != null)) {
        // Another container's instalment is already noted (Emre, 2026-10-16): that payment is linked, never a second one. This payment and
        // its parts are new; one purchase-share call, its answer in request order. A lost answer: the same body again gets the same rows.
        try {
          const result = await this.banking.sharePurchasePayment(pay.bankTransaction.id,
            [shareNewPart(data.order.id, goods), ...fresh.map(write => shareNewPart(data.order.id, write)), ...sharePartsOf(also)]);
          saved = result.payments[0];
          atomicLine = result.line;
          atomicIds = result.payments.slice(0, 1 + fresh.length).map(payment => payment.id);
          this.alsoFor = null;
          void this.loadPaymentRows(data.order.id, true);
        } catch (failure: unknown) {
          if (this.shareRefused(failure)) void this.refreshAlsoRows(data.order.id, data.order.supplierId ?? null, pay.payee);
          throw this.shareMissing(failure) ? new Error(SHARE_SERVER_PENDING) : failure;
        }
      } else if (pay.bankTransaction && !pay.id) {
        // One transfer for several containers: the other containers' parts name their own order, in the same atomic call.
        const result = await this.banking.addPurchasePayment(pay.bankTransaction.id, data.order.id, [goods, ...fresh, ...alsoWrites(also, goods.paidOn)]);
        const own = result.payments.filter(payment => payment.orderId == null || payment.orderId === data.order.id);
        saved = own[0];
        atomicLine = result.line;
        atomicIds = own.map(payment => payment.id);
        if (also.length) this.alsoFor = null;
      } else {
        const retained = (pay.bankLinkPending || pay.bankLinkComplete) ? pay.bankSavedPayment ?? (this.payments() ?? []).find(payment => payment.id === pay.id) : null;
        // A saved payment whose words, payee, term, money and invoice stayed as stored is not written again: a link carries the money
        // and the day itself (no PUT then link), a proof file or an invoice file only uploads. An older server's /links still writes the
        // bank's day first.
        const untouched = pay.id && stored && !invoiceChanged && plan.kind !== 'links' && !frozen && this.storedUnchanged(pay, stored, parts) ? stored : null;
        if (retained) { saved = retained; wrote = false; }
        else if (untouched) { saved = untouched; wrote = false; }
        else if (pay.id && grouped) saved = await this.saveGroup(data.order.id, pay, parts, invoiceChanged ? invoiceId : undefined);
        else saved = pay.id ? await this.sourcing.updatePayment(data.order.id, pay.id, goods) : await this.sourcing.addPayment(data.order.id, goods);
      }
      paymentSaved = true;
      if (this.view()?.order.id !== data.order.id) return;
      const planned = frozen ? { ...frozen, goodsEur: saved.amountEur } : fresh.length ? { goodsEur: saved.amountEur, parts: fresh } : undefined;
      // The same sheet (an inline invoice may have patched it in step 1): record what was saved, so a retry never posts it again.
      this.paying.update(current => current && (current === pay || (current.id ?? null) === (pay.id ?? null)) ? { ...current, id: saved.id, ...(planned ? { planned } : {}),
        ...(wrote ? { paymentWritten: true } : {}),
        ...(atomicIds ? { partIds: atomicIds.slice(1), bankLinkPending: true, bankLinkComplete: true, bankSavedPayment: saved, freightAmount: null, freightAmountInput: '', separateAmount: null, separateAmountInput: '' } : {}) } : current);
      if (atomicLine) this.bankLines.update(lines => [atomicLine!, ...(lines ?? []).filter(line => line.id !== atomicLine!.id)]);
      // The extra streams of a manual transfer, one by one; a saved part leaves the draft so retry never posts it twice.
      const ids = atomicIds ?? [saved.id, ...(pay.partIds ?? [])];
      for (const part of planned?.parts.slice(ids.length - 1) ?? []) {
        const freight = part.instalmentDue === 'FREIGHT';
        let extra: PurchasePayment;
        try { extra = await this.sourcing.addPayment(data.order.id, part); }
        catch (failure: unknown) {
          await this.refreshPaymentState(data.order.id);
          if (this.view()?.order.id === data.order.id) this.ui.toast(`Betaling bewaard, maar het deel ${freight ? 'zeevracht (CIF)' : 'inspectie'} is niet genoteerd. ${messageOf(failure, 'Probeer het opnieuw.')}`, 'err');
          return;
        }
        ids.push(extra.id);
        this.paying.update(current => current?.id === saved.id ? { ...current, partIds: ids.slice(1),
          ...(freight ? { freightAmount: null, freightAmountInput: '' } : { separateAmount: null, separateAmountInput: '' }) } : current);
      }
      // 3. Proof files go to the root; invoices no longer hang on a payment.
      for (const file of pay.files.slice(0, 5)) {
        const document = await this.sourcing.addDocument(data.order.id, file, 'PAYMENT_PROOF', pay.label || null, saved.id);
        if (this.view()?.order.id === data.order.id) this.documents.update(current => [...(current ?? []), document]);
        // A later upload may fail. Keep only pending files, so retry neither
        // creates a second payment nor uploads the successful proof twice.
        this.paying.update(current => current?.id === saved.id ? { ...current, files: current.files.filter(item => item !== file) } : current);
      }
      // The bank line of a new transfer comes last, with every payment of the transfer in it: a failed line never leaves an orphan.
      let bank: 'none' | 'noted' | 'failed' = 'none';
      if (pay.bankTransaction) {
        this.paying.update(current => current?.id === saved.id ? { ...current, bankLinkPending: true, bankSavedPayment: saved, bankLinkError: '' } : current);
        try {
          const line = atomicLine ?? (pay.bankLinkComplete ? this.bankLines()?.find(line => line.id === pay.bankTransaction!.id) : null) ?? await this.banking.linkPayments(pay.bankTransaction.id, { purchasePaymentIds: ids });
          this.paying.update(current => current?.id === saved.id ? { ...current, bankLinkComplete: true } : current);
          this.bankLines.update(lines => [line, ...(lines ?? []).filter(existing => existing.id !== line.id)]);
          bank = 'noted';
        } catch (failure) {
          bank = 'failed';
          this.paying.update(current => current?.id === saved.id ? { ...current, bankLinkError: `Betaling bewaard. Alleen de bankkoppeling is nog niet gelukt: ${messageOf(failure, 'Probeer de koppeling opnieuw.')} Opnieuw proberen maakt geen extra betaling.` } : current);
        }
      }
      // 4. The transactions picked in a saved payment, then 5. the inspection split: from here a retry continues without writing the payment again.
      let notice: string | null = null;
      if (plan.kind !== 'none' || split !== null || alreadyLinked) {
        this.paying.update(current => current?.id === saved.id ? { ...current, bankLinkPending: true, bankSavedPayment: saved, bankLinkError: '' } : current);
        let after: PurchasePayment | null = null;
        if (alreadyLinked) {
          this.paying.update(current => current?.id === saved.id ? { ...current, pendingLines: [], pendingPartId: null, surplus: null, addTransfer: false } : current);
          done.push(alreadyLinkedText((pay.pendingLines ?? []).length, null, null));
        }
        if (plan.kind !== 'none' && pendingPart) {
          try {
            if (plan.kind === 'part') {
              // A USD/CNY part goes in the payment's own currency (`amount`); otherwise the server takes the line as it is.
              const result = await this.sourcing.linkPaymentPart(pendingPart.id, plan.lineId, plan.amount ?? null,
                { higher: plan.surplus ?? null, withPaymentIds: plan.withPaymentIds });
              await this.reloadBankLines(result.lines);
              after = result.payments.find(payment => payment.id === pendingPart.id) ?? null;
              const line = pendingLines[0];
              // The server's sentence when it sends one; else the same words from the answer.
              if (result.notice) notice = result.notice;
              else if (!plan.whole) notice = plan.amount != null && foreign ? carveForeignText(plan.amount, line.amountEur, foreign.amount, foreign.currency)
                : carveText(pendingPart.amountEur, line.amountEur);
              else if (after) {
                const inspection = plan.surplus === 'INSPECTION' ? result.payments.find(payment => payment.id !== pendingPart.id
                  && (payment.payee ?? 'SUPPLIER') === 'SEPARATE' && payment.bankStatementLineId === plan.lineId) ?? null : null;
                notice = linkNotice(pendingPart, after, inspection?.amountEur ?? null);
              }
              done.push(!plan.whole ? 'Deel van de betaling gekoppeld' : plan.surplus === 'INSPECTION' ? 'Banktransactie gekoppeld · rest als inspectie' : 'Banktransactie gekoppeld');
            } else if (plan.kind === 'lines') {
              const result = await this.sourcing.linkPaymentLines(pendingPart.id, plan.lineIds.map(bankStatementLineId => ({ bankStatementLineId })));
              await this.reloadBankLines(result.lines);
              done.push(`Betaling verdeeld over ${plan.lineIds.length} transacties`);
            } else if (plan.kind === 'share') {
              // 'Verdelen over containers': this payment and every other container's part in one call; the server checks the euro the sheet saw
              // (not after this save wrote the payment) and answers an identical retry with the same rows.
              const result = await this.banking.sharePurchasePayment(plan.lineId, shareBody({ paymentId: pendingPart.id, partEur: pay.shareOwn!,
                expectedEur: wrote ? null : pendingPart.amountEur }, shareParts, pendingPart.payment.payee ?? 'SUPPLIER'));
              await this.reloadBankLines([result.line]);
              this.alsoFor = null;
              void this.loadPaymentRows(data.order.id, true);
              const own = result.parts[0];
              after = result.payments[0] ?? null;
              if (own?.outcome === 'CARVED' && own.wasEur != null) notice = carveText(own.wasEur, own.amountEur);
              else if (own && after && own.wasEur != null && own.wasPaidOn) notice = linkNotice({ amountEur: own.wasEur, paidOn: own.wasPaidOn }, after);
              done.push(shareToast([{ name: containerName(data.order), amountEur: own?.amountEur ?? pay.shareOwn! },
                ...shareParts.map((part, index) => ({ name: containerName({ id: part.orderId, number: part.number, alias: part.alias }),
                  amountEur: result.parts[index + 1]?.amountEur ?? part.amount! }))]));
            } else if (plan.kind === 'grow') {
              // The payment grows by a new transfer of this line (the server's addTransfer); the linked transfers stay as they are.
              const result = await this.sourcing.linkPaymentPart(pendingPart.id, plan.lineId, null, { higher: 'ADJUST' });
              await this.reloadBankLines(result.lines);
              const was = parts.reduce((sum, part) => sum + Math.round(part.amountEur * 100), 0) / 100;
              notice = result.notice ?? `Transactie van ${formatEur(plan.addEur)} toegevoegd; de betaling is nu ${formatEur(Math.round((was + plan.addEur) * 100) / 100)} (was ${formatEur(was)}).`;
              done.push('Transactie toegevoegd');
            } else {
              const line = await this.banking.linkPayments(plan.lineId, { purchasePaymentIds: [pendingPart.id] });
              await this.reloadBankLines([line]);
              done.push('Banktransactie gekoppeld');
            }
            this.paying.update(current => current?.id === saved.id ? { ...current, pendingLines: [], pendingPartId: null, surplus: null, addTransfer: false, ...NO_SHARE } : current);
          } catch (failure: unknown) {
            await this.refreshPaymentState(data.order.id);
            if (this.view()?.order.id !== data.order.id) return;
            // A lost answer: the server did link, the refreshed payment carries every picked transaction. Clear the pick and go on.
            if (round && pendingAlreadyLinked(pendingLines, this.payingParts())) {
              this.paying.update(current => current?.id === saved.id ? { ...current, pendingLines: [], pendingPartId: null, surplus: null, addTransfer: false, ...NO_SHARE, bankLinkError: '' } : current);
              if (plan.kind === 'share') { this.alsoFor = null; void this.loadPaymentRows(data.order.id, true); }
              // The answer and its notice were lost: the payment before this save against the refreshed one says what changed.
              done.push(alreadyLinkedText(pendingLines.length, paymentFigure(parts), paymentFigure(this.payingParts())));
            } else {
              const reason = plan.kind === 'share' && this.shareMissing(failure) ? SHARE_SERVER_PENDING : messageOf(failure, 'De koppeling is nog niet gelukt.');
              // A refused share: the containers as the server has them now (a row whose payment went is dropped; the refusal says why).
              if (plan.kind === 'share' && this.shareRefused(failure)) void this.refreshAlsoRows(data.order.id, data.order.supplierId ?? null, pendingPart.payment.payee ?? 'SUPPLIER');
              // A refusal when this sheet wrote nothing (the link alone carries the payment): nothing to protect, so the choice is
              // open again (another 'Bedrag aanpassen', no transaction) and the words do not claim a saved payment.
              const written = !!this.paying()?.paymentWritten;
              this.paying.update(current => current?.id === saved.id ? { ...current, ...(written
                ? { bankLinkError: `Betaling bewaard. ${reason} Opnieuw proberen maakt geen extra betaling.` }
                : { bankLinkPending: false, bankSavedPayment: undefined, ...(plan.kind === 'share' ? {} : { surplus: null }), bankLinkError: reason }) } : current);
              this.ui.toast(plan.kind === 'share' ? reason : messageOf(failure, 'Koppelen mislukt'), 'err');
              return;
            }
          }
        }
        if (split !== null) {
          try {
            // The goods payment's euro as the server has it after this save (the link's answer, else the write's), frozen at the first try:
            // a retry after a lost answer sends the same body, which the server answers unchanged.
            const expected = this.paying()?.inspectionExpectedEur ?? after?.amountEur ?? saved.amountEur;
            this.paying.update(current => current?.id === saved.id ? { ...current, inspectionExpectedEur: expected } : current);
            const amountEur = inspectionSplitEur({ amount: saved.amount, currency: saved.currency, amountEur: expected }, split);
            await this.sourcing.splitInspection(saved.id, saved.currency === 'EUR'
              ? { amountEur, expectedAmountEur: expected } : { amountEur, amount: split, expectedAmountEur: expected });
            this.paying.update(current => current?.id === saved.id ? { ...current, inspectionSplit: null, inspectionSplitInput: '' } : current);
            done.push('Inspectie afgesplitst');
          } catch (failure: unknown) {
            await this.refreshPaymentState(data.order.id);
            if (this.view()?.order.id !== data.order.id) return;
            this.paying.update(current => current?.id === saved.id ? { ...current, bankLinkError: `Betaling bewaard. ${messageOf(failure, 'De inspectie is nog niet afgesplitst.')} Opnieuw proberen maakt geen extra betaling.` } : current);
            this.ui.toast(messageOf(failure, 'Afsplitsen mislukt'), 'err');
            return;
          }
        }
      }
      if (notice) this.paymentNotice.set({ orderId: data.order.id, text: notice });
      await Promise.all([this.refreshPaymentState(data.order.id), pay.files.length || pay.newInvoice?.file || pay.invoiceFile ? this.loadDocuments(data.order.id) : Promise.resolve()]);
      if (this.view()?.order.id !== data.order.id) return;
      // A failed line keeps the sheet open with every id of the transfer, so one more 'bewaren' sends the line again.
      if (bank !== 'failed') this.paying.set(null);
      const filed = pay.files.length ? ['bewijs'] : [];
      // A saved payment: what this save did; a proof file by itself is only 'Bewijs toegevoegd' (nothing else was written).
      const linked = done.length > 0;
      if (pay.id && pay.files.length) done.push(pay.files.length === 1 ? 'Bewijs toegevoegd' : `${pay.files.length} bewijzen toegevoegd`);
      if (pay.id && invoiceFiled) done.push('Factuurbestand toegevoegd');
      if (pay.id && wrote && !linked) done.unshift('Betaling aangepast');
      const alsoText = also.length && bank === 'noted' ? ` · ${alsoNotice(also)}` : '';
      this.ui.toast(bank === 'noted' ? `Betaling bewaard en banktransactie gekoppeld${alsoText}` : bank === 'failed' ? 'Betaling bewaard, banktransactie nog niet gekoppeld.'
        : done.length ? done.join(' · ') : pay.id ? 'Geen wijzigingen' : filed.length ? `Betaling en ${filed[0]} bewaard` : 'Betaling bewaard',
        bank === 'failed' ? 'err' : 'ok');
    } catch (failure: unknown) {
      if (paymentSaved && this.view()?.order.id === data.order.id) await this.refreshPaymentState(data.order.id);
      if (this.view()?.order.id === data.order.id) this.ui.toast(messageOf(failure,
        paymentSaved ? 'Betaling bewaard, maar niet alle bewijzen konden worden toegevoegd. Probeer de resterende bestanden opnieuw.' : 'Betaling bewaren mislukt'), 'err');
    } finally {
      this.payingBusy.set(false);
    }
  }

  /** The server refused the share (a 4xx with its reason): nothing was linked, the rows are refreshed. */
  private shareRefused(failure: unknown): boolean {
    const status = (failure as { status?: number } | null)?.status;
    return status === 400 || status === 409 || status === 422 || (status === 404 && !this.shareMissing(failure));
  }
  /** A server without POST …/purchase-share: 404/405 without a reason of its own. */
  private shareMissing(failure: unknown): boolean {
    const response = failure as { status?: number; error?: { message?: unknown } | null } | null;
    return (response?.status === 404 || response?.status === 405) && !(typeof response.error?.message === 'string' && response.error.message.trim());
  }

  /**
   * Nothing of the saved payment itself changed: its words, payee, term,
   * settlement, money and day (a USD/CNY payment's bank euro too), no
   * corrected transfer of a payment in parts and no part noted beside it.
   */
  private storedUnchanged(pay: PurchasePaymentDraft, stored: PurchasePayment, parts: readonly LedgerPart[]): boolean {
    if ((pay.freightAmount ?? 0) > 0 || (pay.separateAmount ?? 0) > 0 || !this.sameStoredWords(pay, stored)) return false;
    if (stored.currency !== 'EUR' && parts.length <= 1 && Math.round((pay.amountEur ?? -1) * 100) !== Math.round(stored.amountEur * 100)) return false;
    return !Object.entries(pay.partEdits ?? {}).some(([id, edit]) => {
      const part = parts.find(item => item.id === Number(id));
      return !part || edit.amount === null || Math.round(edit.amount * 100) !== Math.round(part.amount * 100) || edit.amountEur != null;
    });
  }

  /** The words, payee, term and settlement of the sheet are the stored payment's, and so are its money and day (a link alone changes those). */
  private sameStoredWords(pay: PurchasePaymentDraft, stored: PurchasePayment): boolean {
    return (pay.label || '') === (stored.label ?? '') && pay.payee === (stored.payee ?? 'SUPPLIER') && !!pay.settles === !!stored.settles
      && (pay.instalmentDue ?? null) === (stored.instalmentDue ?? null) && pay.paidOn === stored.paidOn && pay.currency === stored.currency
      && Math.round((pay.amount ?? 0) * 100) === Math.round(stored.amount * 100);
  }

  /**
   * The invoice a draft resolves to when its select stays on automatic, by
   * the sheet's (and the server's) rule: the payee's only one, or for an
   * inspection paid via the supplier the supplier's main invoice.
   */
  private resolvedInvoiceOf(pay: PurchasePaymentDraft): number | null {
    const data = this.view();
    if (!data) return null;
    const line = (pay.id ? this.payingParts()[0]?.bankStatementLineId : null) ?? pay.bankTransaction?.id ?? null;
    return resolveInvoice({ payee: pay.payee, invoiceId: null, bankStatementLineId: line }, data.invoices ?? [], this.payments() ?? [], data.order.inspectionViaSupplier);
  }

  /** Where 'Bestand bij de factuur' goes: the invoice the sheet showed when the file was chosen, else the chosen or automatic one. */
  private invoiceFileTarget(pay: PurchasePaymentDraft): PurchaseInvoice | null {
    const id = pay.invoiceFileFor ?? pay.invoiceId ?? this.resolvedInvoiceOf(pay);
    return id == null ? null : (this.view()?.invoices ?? []).find(item => item.id === id) ?? null;
  }

  /**
   * A payment paid in parts: first one PUT per corrected unlinked transfer
   * (its own stored day, payee, term, settlement and label; its new money),
   * then one PUT on the root with applyToGroup, which carries the label,
   * payee, term, settlement and invoice to every transfer. The root's own
   * money goes with that PUT (its correction, else as stored, without a
   * euro), so the group's money never changes by accident.
   */
  private async saveGroup(orderId: number, pay: PurchasePaymentDraft, parts: readonly LedgerPart[], invoiceId: number | null | undefined): Promise<PurchasePayment> {
    const root = parts.find(part => part.id === pay.id) ?? parts[0];
    const write = (part: LedgerPart, edit: NonNullable<PurchasePaymentDraft['partEdits']>[number] | undefined) => ({
      paidOn: part.paidOn, amount: edit?.amount ?? part.amount, currency: part.currency,
      ...(edit && part.currency !== 'EUR' && edit.amountEur != null ? { amountEur: edit.amountEur } : {}),
    });
    let partWritten = false;
    for (const part of parts) {
      const edit = pay.partEdits?.[part.id];
      if (part.id === root.id || !edit || edit.amount === null || part.bankStatementLineId != null) continue;
      if (Math.round(edit.amount * 100) === Math.round(part.amount * 100) && edit.amountEur == null) continue;
      const stored = part.payment;
      try {
        await this.sourcing.updatePayment(orderId, part.id, { ...write(part, edit), label: stored.label ?? null, payee: stored.payee ?? 'SUPPLIER',
          settles: !!stored.settles, instalmentDue: stored.instalmentDue ?? null });
      } catch (failure: unknown) {
        // An earlier transfer of this save did go through: show the group as the server now has it.
        if (partWritten) await this.refreshPaymentState(orderId);
        throw failure;
      }
      partWritten = true;
      this.paying.update(current => {
        if (!current?.partEdits) return current;
        const { [part.id]: _saved, ...rest } = current.partEdits;
        return { ...current, partEdits: rest };
      });
    }
    const rootEdit = root.bankStatementLineId == null ? pay.partEdits?.[root.id] : undefined;
    let saved: PurchasePayment;
    try {
      saved = await this.sourcing.updatePayment(orderId, root.id, {
        ...write(root, rootEdit), label: pay.label || null, payee: pay.payee, settles: pay.settles,
        instalmentDue: pay.payee === 'SUPPLIER' ? pay.instalmentDue ?? null : null,
        ...(invoiceId !== undefined ? { invoiceId } : {}), applyToGroup: true,
      });
    } catch (failure: unknown) {
      // A corrected transfer is saved and its edit left the draft: refresh, so the sheet and the ledger show its new amount, not the old one.
      if (partWritten) await this.refreshPaymentState(orderId);
      throw failure;
    }
    this.paying.update(current => current ? { ...current, partEdits: {} } : current);
    return saved;
  }

  /** From the edit sheet: close it and ask to remove the payment it showed. */
  removeEditing(paymentId: number): void {
    const payment = (this.payments() ?? []).find((item) => item.id === paymentId);
    this.paying.set(null);
    if (payment) this.removePayment(payment);
  }

  removePayment(payment: PurchasePayment): void {
    if (this.payingBusy() || this.paymentStateLoading() || this.view()?.order.id !== payment.orderId) return;
    this.ui.confirm(
      { title: 'Betaling verwijderen', message: `Betaling van <b>${payment.amountEur.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR' })}</b> verwijderen?`
          + (this.view()?.creditOffsets?.some(offset => offset.paymentId === payment.id)
            ? ' Het verrekende tegoed staat daarna weer open op de container waar het genoteerd is.' : ''),
        confirmLabel: 'Verwijderen', danger: true },
      async () => {
        if (this.payingBusy() || this.view()?.order.id !== payment.orderId) return;
        this.payingBusy.set(true);
        try {
          await this.sourcing.deletePayment(payment.orderId, payment.id);
          await this.refreshPaymentState(payment.orderId);
        } catch (failure: unknown) {
          this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
        } finally {
          this.payingBusy.set(false);
        }
      });
  }

  /* ---- the money-out picture and its actions ----------------------- */

  /** Betalingen as one server-derived view model: per payee, due now or later, the ledger and what to do. */
  readonly paymentLedger = computed(() => {
    const data = this.view();
    if (!data || this.paymentStateError()) return null;
    const totals = data.costing.totals;
    return purchasePaymentLedger({
      view: data, payments: this.payments(), documents: this.documentsFailed() ? null : this.documents(), terms: this.plannedInstalments(),
      settled: payee => purchaseGroupSettled(data, this.payments(), payee), toleranceEur: PAYMENT_TOLERANCE_EUR,
      totalLabel: totals.separateCostsEur ? separateCostsTotalLabel(totals) : 'Totaal geland',
      planLabel: this.planLabel(data.order),
      bankedPaymentIds: this.bankedPaymentIds(),
    });
  });
  readonly paymentState = computed<'loading' | 'refreshing' | 'error' | 'ready'>(() => this.paymentStateError() ? 'error'
    : this.payments() === null ? 'loading' : this.paymentStateLoading() ? 'refreshing' : 'ready');

  /** What is still open for the term or payee the payment sheet is filled in for. */
  readonly payingOpenHint = computed(() => {
    const pay = this.paying();
    if (!pay) return null;
    if (pay.payee === 'SUPPLIER' && pay.instalmentDue) {
      const term = this.plannedInstalments().find(step => step.due === pay.instalmentDue);
      return term ? { label: term.label, amountEur: term.amount } : null;
    }
    return { label: PAYEE_LABEL[pay.payee], amountEur: this.openFor(pay.payee) };
  });

  /** The stored payment the sheet corrects, to warn when it moves to another payee. */
  /** The payment being edited offsets a credit of another container: the sheet locks its amount, currency and payee. */
  readonly payingCreditOffset = computed(() => {
    const id = this.paying()?.id;
    return id ? this.view()?.creditOffsets?.find(offset => offset.paymentId === id) ?? null : null;
  });
  readonly payingOriginal = computed(() => {
    const id = this.paying()?.id;
    const stored = id ? (this.payments() ?? []).find(payment => payment.id === id) : undefined;
    return stored ? { payee: stored.payee ?? 'SUPPLIER', settles: !!stored.settles } : null;
  });

  /**
   * Every payment write also rewrites the order's diary on the server, so it
   * never lands on top of unsaved order edits: save first, then go on.
   */
  whenSaved(run: () => void): void {
    if (!this.dirty()) { run(); return; }
    if (this.saving() || this.payingBusy() || this.paymentPlanBusy()) return;
    this.ui.confirm({
      title: 'Eerst opslaan?',
      message: 'De order heeft niet-opgeslagen wijzigingen. Die worden eerst opgeslagen; daarna ga je verder.',
      confirmLabel: 'Opslaan en verder',
    }, async () => {
      const saved = await this.save();
      if (saved && !this.dirty() && this.view()?.order.id === saved.order.id) run();
    });
  }

  requestPayment(action: PurchasePaymentAction): void {
    this.whenSaved(() => this.openPayment(action.amount, action.label, action.payee, action.due ?? null));
  }

  requestEdit(payment: PurchasePayment): void { this.whenSaved(() => this.editPayment(payment)); }

  /** 'Transactie toevoegen…' from a ⋯ menu: the payment's sheet opens with the bank picker for one more transfer. */
  requestAddTransfer(payment: PurchasePayment): void {
    this.whenSaved(() => {
      this.editPayment(payment);
      const parts = this.payingParts();
      const newest = parts[parts.length - 1];
      if (newest && parts.every(part => part.bankStatementLineId != null)) {
        this.paying.update(pay => pay ? { ...pay, addTransfer: true, pendingPartId: newest.id, pendingLines: [], surplus: null } : pay);
      }
    });
  }

  requestSettle(request: PurchaseSettleRequest): void { this.whenSaved(() => this.openSettle(request)); }

  requestUndoSettle(payee: Payee, due?: Due | null): void { this.whenSaved(() => this.undoSettle(payee, due)); }

  requestMove(payment: PurchasePayment, payee: Payee): void { this.whenSaved(() => this.movePayment(payment, payee)); }

  requestRemove(payment: PurchasePayment): void { this.whenSaved(() => this.removePayment(payment)); }

  /** Afrekenen: one existing payment gets the settles mark; no money moves. */
  readonly settling = signal<{ payee: Payee; scope: 'GROUP' | 'TERM'; due: Due | null; paymentId: number | null } | null>(null);
  readonly settleCarrierOptions = computed(() => {
    const draft = this.settling();
    return draft ? settleCarriers(this.payments() ?? [], draft.payee, draft.scope, draft.due, this.view()?.reconciliation?.supplierInstalments)
      : { options: [], defaultId: null };
  });
  readonly settlePayee = computed(() => {
    const payee = this.settling()?.payee;
    return payee ? this.paymentLedger()?.payees.find(item => item.payee === payee) ?? null : null;
  });

  openSettle(request: PurchaseSettleRequest): void {
    if (this.payingBusy() || this.paymentStateLoading() || this.paymentStateError() || this.paymentPlanBusy() || this.dirty()
      || this.payments() === null || request.payee === 'OTHER') return;
    const scope = request.payee === 'SUPPLIER' && request.scope === 'TERM' && request.due ? 'TERM' : 'GROUP';
    const due = scope === 'TERM' ? request.due : null;
    // Netted supplier terms: the default carrier is a payment of the covered term, so the settlement keeps each term's own + / −.
    const carriers = settleCarriers(this.payments() ?? [], request.payee, scope, due, this.view()?.reconciliation?.supplierInstalments);
    const paymentId = carriers.options.some(option => option.id === request.paymentId) ? request.paymentId ?? null : carriers.defaultId;
    this.settling.set({ payee: request.payee, scope, due, paymentId });
  }

  setSettleScope(scope: 'GROUP' | 'TERM', due: Due | null): void {
    const draft = this.settling();
    if (!draft || this.payingBusy()) return;
    const next = draft.payee === 'SUPPLIER' && scope === 'TERM' ? 'TERM' : 'GROUP';
    const nextDue = next === 'TERM' ? due : null;
    this.settling.set({ payee: draft.payee, scope: next, due: nextDue,
      paymentId: settleCarriers(this.payments() ?? [], draft.payee, next, nextDue, this.view()?.reconciliation?.supplierInstalments).defaultId });
  }

  closeSettle(): void { if (!this.payingBusy()) this.settling.set(null); }

  async confirmSettle(): Promise<void> {
    const data = this.view();
    const draft = this.settling();
    if (!data || !draft || this.payingBusy() || this.paymentStateLoading() || this.paymentStateError() || this.paymentPlanBusy()
      || this.dirty() || this.payments() === null || draft.payee === 'OTHER') return;
    if (draft.scope === 'TERM' && !Array.isArray(data.reconciliation?.supplierInstalments)) {
      this.ui.toast('Laad de order opnieuw voordat je een betaling aan een termijn koppelt.', 'err');
      return;
    }
    const carrier = (this.payments() ?? []).find(payment => payment.id === draft.paymentId);
    if (!carrier || carrier.orderId !== data.order.id || (carrier.payee ?? 'SUPPLIER') !== draft.payee) return;
    const term = draft.scope === 'TERM' ? data.reconciliation?.supplierInstalments?.find(item => item.due === draft.due)?.label : undefined;
    this.payingBusy.set(true);
    try {
      // Amount and currency are sent back unchanged, so the server keeps the booked euro value; a payment in parts settles as one.
      await this.sourcing.updatePayment(data.order.id, carrier.id, {
        paidOn: carrier.paidOn, amount: carrier.amount, currency: carrier.currency, label: carrier.label ?? null,
        payee: carrier.payee ?? 'SUPPLIER', settles: true,
        instalmentDue: draft.payee === 'SUPPLIER' && draft.scope === 'TERM' ? draft.due : null,
        ...((this.payments() ?? []).filter(item => (item.groupId ?? item.id) === (carrier.groupId ?? carrier.id)).length > 1 ? { applyToGroup: true } : {}),
      });
      if (this.view()?.order.id !== data.order.id) return;
      await this.refreshPaymentState(data.order.id);
      if (this.view()?.order.id !== data.order.id) return;
      this.settling.set(null);
      this.ui.toast(`${term ?? PAYEE_LABEL[draft.payee]} afgerekend`, 'ok');
    } catch (failure: unknown) {
      if (this.view()?.order.id === data.order.id) this.ui.toast(messageOf(failure, 'Afrekenen mislukt'), 'err');
    } finally {
      this.payingBusy.set(false);
    }
  }

  /** Takes the settles mark off again, one payment at a time; what is unpaid is open again. */
  undoSettle(payee: Payee, due?: Due | null): void {
    const data = this.view();
    if (!data || this.payingBusy() || this.paymentStateLoading() || this.paymentStateError() || this.paymentPlanBusy()
      || this.dirty() || this.payments() === null) return;
    const flagged = (this.payments() ?? []).filter(payment => (payment.payee ?? 'SUPPLIER') === payee && payment.settles
      && (due === undefined || (due === null ? payment.instalmentDue == null : payment.instalmentDue === due)));
    // One write per payment paid in parts, on its root with applyToGroup: never once per transfer.
    const targets = [...new Map(flagged.map(payment => {
      const key = payment.groupId ?? payment.id;
      const members = (this.payments() ?? []).filter(item => (item.groupId ?? item.id) === key)
        .sort((left, right) => left.paidOn.localeCompare(right.paidOn) || left.id - right.id);
      const root = members.find(member => member.id === key) ?? members[0] ?? payment;
      return [root.id, { root, group: members.length > 1 }] as const;
    })).values()];
    if (!targets.length) return;
    const label = (due && data.reconciliation?.supplierInstalments?.find(term => term.due === due)?.label) || PAYEE_LABEL[payee];
    this.ui.confirm({
      title: 'Afrekening ongedaan maken',
      message: `<b>${escapeHtml(label)}</b> weer openzetten? Wat nog niet betaald is, staat daarna opnieuw open.`,
      confirmLabel: 'Openzetten',
    }, async () => {
      if (this.payingBusy() || this.view()?.order.id !== data.order.id) return;
      this.payingBusy.set(true);
      let failure: unknown = null;
      try {
        for (const { root: payment, group } of targets) {
          try {
            await this.sourcing.updatePayment(data.order.id, payment.id, {
              paidOn: payment.paidOn, amount: payment.amount, currency: payment.currency, label: payment.label ?? null,
              payee: payment.payee ?? 'SUPPLIER', settles: false,
              instalmentDue: (payment.payee ?? 'SUPPLIER') === 'SUPPLIER' ? payment.instalmentDue ?? null : null,
              ...(group ? { applyToGroup: true } : {}),
            });
          } catch (error: unknown) {
            failure = error;
            break;
          }
          if (this.view()?.order.id !== data.order.id) return;
        }
        if (this.view()?.order.id !== data.order.id) return;
        await this.refreshPaymentState(data.order.id);
        if (this.view()?.order.id !== data.order.id) return;
        if (failure) { this.ui.toast(messageOf(failure, 'Afrekening ongedaan maken mislukt'), 'err'); return; }
        this.settling.set(null);
        this.ui.toast('Afrekening ongedaan gemaakt', 'ok');
      } finally {
        this.payingBusy.set(false);
      }
    });
  }

  /* ---- Tegoed leverancier: what the supplier owes back ----------- */
  readonly crediting = signal<SupplierCreditSheetAction | null>(null);
  /** Offset only: the other ordered containers of this supplier; null while they load. */
  readonly creditTargets = signal<PurchaseOrderView[] | null>(null);
  readonly creditSupplierOpen = computed(() => this.paymentLedger()?.payees.find(item => item.payee === 'SUPPLIER')?.openEur ?? 0);

  /** Every credit write also rewrites the order's diary on the server: save first, like a payment. */
  requestCredit(action: SupplierCreditAction): void {
    if (action.kind === 'open-offset') {
      if (action.credit.offsetOrderId != null) void this.router.navigate(['/purchasing', action.credit.offsetOrderId], { queryParams: { section: 'ledger' } });
      return;
    }
    this.whenSaved(() => this.openCredit(action));
  }

  openCredit(action: SupplierCreditAction): void {
    const data = this.view();
    if (!data || this.payingBusy() || this.paymentStateLoading() || this.paymentStateError() || this.paymentPlanBusy() || this.dirty()) return;
    if (action.kind === 'add') { this.crediting.set(action); return; }
    if (action.kind === 'remove') { this.removeCredit(action.credit); return; }
    if (action.kind === 'undo-refund') { this.undoRefund(action.credit); return; }
    if (action.kind === 'open-offset') return;
    if (action.kind === 'offset') void this.loadCreditTargets(data.order.id, data.order.supplierId);
    this.crediting.set({ kind: action.kind, credit: action.credit });
  }

  closeCredit(): void { if (!this.payingBusy()) this.crediting.set(null); }

  private async loadCreditTargets(orderId: number, supplierId: number): Promise<void> {
    this.creditTargets.set(null);
    try {
      const views = await this.sourcing.purchaseOrders();
      if (this.view()?.order.id === orderId) this.creditTargets.set(creditOffsetTargets(views, { id: orderId, supplierId }));
    } catch (failure: unknown) {
      if (this.view()?.order.id !== orderId) return;
      this.creditTargets.set([]);
      this.ui.toast(messageOf(failure, 'Containers van deze leverancier laden mislukt'), 'err');
    }
  }

  async submitCredit(submission: SupplierCreditSubmit): Promise<void> {
    const data = this.view();
    if (!data || this.payingBusy() || this.dirty()) return;
    const id = data.order.id;
    this.payingBusy.set(true);
    try {
      switch (submission.kind) {
        case 'add': await this.sourcing.addSupplierCredit(id, submission.body); break;
        case 'edit': case 'refund': await this.sourcing.updateSupplierCredit(id, submission.creditId, submission.body); break;
        case 'offset': await this.sourcing.offsetSupplierCredit(id, submission.creditId, submission.body); break;
      }
      if (this.view()?.order.id !== id) return;
      await this.refreshPaymentState(id);
      if (this.view()?.order.id !== id) return;
      this.crediting.set(null);
      this.ui.toast(submission.kind === 'offset' ? `Tegoed verrekend met ${submission.targetNumber}`
        : submission.kind === 'add' ? 'Tegoed leverancier genoteerd' : submission.kind === 'edit' ? 'Tegoed aangepast' : 'Terugbetaling genoteerd', 'ok');
    } catch (failure: unknown) {
      if (this.view()?.order.id === id) this.ui.toast(messageOf(failure, 'Tegoed bewaren mislukt'), 'err');
    } finally {
      this.payingBusy.set(false);
    }
  }

  private removeCredit(credit: PurchaseSupplierCredit): void {
    this.creditConfirm(credit, {
      title: 'Tegoed verwijderen',
      message: `Tegoed van <b>${formatEur(credit.amountEur)}</b> (${escapeHtml(SUPPLIER_CREDIT_REASON_LABEL[credit.reason] ?? '')}) verwijderen? De eindkost van de leverancier stijgt dan weer.`,
      confirmLabel: 'Verwijderen', danger: true,
    }, id => this.sourcing.deleteSupplierCredit(id, credit.id), 'Tegoed verwijderd', 'Verwijderen mislukt');
  }

  private undoRefund(credit: PurchaseSupplierCredit): void {
    this.creditConfirm(credit, {
      title: 'Terugbetaling ongedaan maken',
      message: `De terugbetaling van <b>${formatEur(credit.amountEur)}</b> ongedaan maken? Het tegoed staat daarna weer open.`,
      confirmLabel: 'Openzetten',
    }, id => this.sourcing.updateSupplierCredit(id, credit.id, { status: 'OPEN' }), 'Tegoed staat weer open', 'Ongedaan maken mislukt');
  }

  private creditConfirm(
    credit: PurchaseSupplierCredit, options: { title: string; message: string; confirmLabel: string; danger?: boolean },
    write: (orderId: number) => Promise<unknown>, done: string, failed: string,
  ): void {
    const data = this.view();
    if (!data || !(data.supplierCredits ?? []).some(item => item.id === credit.id)) return;
    const id = data.order.id;
    this.ui.confirm(options, async () => {
      if (this.payingBusy() || this.view()?.order.id !== id) return;
      this.payingBusy.set(true);
      try {
        await write(id);
        if (this.view()?.order.id !== id) return;
        await this.refreshPaymentState(id);
        if (this.view()?.order.id === id) this.ui.toast(done, 'ok');
      } catch (failure: unknown) {
        if (this.view()?.order.id === id) this.ui.toast(messageOf(failure, failed), 'err');
      } finally {
        this.payingBusy.set(false);
      }
    });
  }

  /** 'Aan wie?' in the payment sheet: a new payee drops the term and the settlement, and an untouched prefill follows. */
  setPaymentPayee(payee: Payee): void {
    const pay = this.paying();
    if (!pay || this.payingBusy() || pay.payee === payee) return;
    // Back to the stored payee of an edited payment: its term and settlement come back with it.
    const stored = pay.id ? (this.payments() ?? []).find(item => item.id === pay.id) : undefined;
    const restore = stored && (stored.payee ?? 'SUPPLIER') === payee ? stored : null;
    const next = { ...pay, payee, instalmentDue: restore?.instalmentDue ?? null, settles: !!restore?.settles };
    // The invoice follows the payee: a new payment takes the new payee's preselection (its primary when it has two or more invoices);
    // a chosen invoice of another payee goes back to automatic.
    const own = (this.view()?.invoices ?? []).filter(invoice => invoice.payee === payee).sort((left, right) => left.id - right.id);
    const preselect = own.length >= 2 ? own[0].id : null;
    if (!pay.id && !pay.invoiceIdChanged) { if (preselect !== null || pay.invoiceId != null) next.invoiceId = preselect; }
    else if (pay.invoiceId != null && !(this.view()?.invoices ?? []).some(invoice => invoice.id === pay.invoiceId
      && (invoice.payee === payee || (payee === 'SEPARATE' && invoice.payee === 'SUPPLIER' && !!this.view()?.order.inspectionViaSupplier)))) {
      next.invoiceId = null;
      next.invoiceIdChanged = true;
    }
    const prefill = Math.round(Math.max(0, this.openFor(pay.payee)) * 100);
    if (!pay.id && (pay.amount === null || Math.round(pay.amount * 100) === prefill)) {
      const rest = Math.round(Math.max(0, this.openFor(payee)) * 100) / 100;
      next.amount = rest > 0 ? rest : null;
      next.amountInput = amountInputText(rest);
      if (['', 'Saldo', 'Douane & transport', 'Inspectie'].includes(pay.label)) {
        next.label = payee === 'SUPPLIER' ? (rest > 0.005 && this.paidTotalEur() > 0 ? 'Saldo' : '')
          : payee === 'LOGISTICS' ? 'Douane & transport' : payee === 'SEPARATE' ? 'Inspectie' : '';
      }
    }
    this.paying.set(next);
  }

  /** From the desk menu: the same payment, booked at another payee. */
  movePayment(payment: PurchasePayment, payee: Payee): void {
    const data = this.view();
    if (!data || payment.orderId !== data.order.id || (payment.payee ?? 'SUPPLIER') === payee || this.payingBusy()
      || this.paymentStateLoading() || this.paymentStateError() || this.paymentPlanBusy() || this.dirty() || this.payments() === null) return;
    const key = payment.groupId ?? payment.id;
    const found = (this.payments() ?? []).filter(item => (item.groupId ?? item.id) === key);
    const members = found.length ? found : [payment];
    const group = members.length > 1;
    const total = members.reduce((sum, member) => sum + Math.round(member.amountEur * 100), 0) / 100;
    const amount = total.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR' });
    this.ui.confirm({
      title: 'Betaling verplaatsen',
      message: `Betaling van <b>${escapeHtml(amount)}</b>${group ? ` (${members.length} transacties)` : ''} verplaatsen naar <b>${escapeHtml(PAYEE_LABEL[payee])}</b>? Een afrekening op deze betaling vervalt.`,
      confirmLabel: 'Verplaatsen',
    }, async () => {
      if (this.payingBusy() || this.view()?.order.id !== data.order.id) return;
      this.payingBusy.set(true);
      try {
        await this.sourcing.updatePayment(data.order.id, payment.id, {
          paidOn: payment.paidOn, amount: payment.amount, currency: payment.currency, label: payment.label ?? null,
          payee, settles: false, instalmentDue: null, ...(group ? { applyToGroup: true } : {}),
        });
        if (this.view()?.order.id !== data.order.id) return;
        await this.refreshPaymentState(data.order.id);
        if (this.view()?.order.id !== data.order.id) return;
        this.ui.toast(`Betaling verplaatst naar ${PAYEE_LABEL[payee]}`, 'ok');
      } catch (failure: unknown) {
        if (this.view()?.order.id === data.order.id) this.ui.toast(messageOf(failure, 'Verplaatsen mislukt'), 'err');
      } finally {
        this.payingBusy.set(false);
      }
    });
  }

  /** A payment in a picker: date, payee, term, amount and description, so two alike payments differ. */
  paymentOptionLabel(payment: PurchasePayment): string {
    const parts = paymentOptionParts(payment, this.view()?.reconciliation?.supplierInstalments);
    return [parts.paidOn.split('-').reverse().join('-'), parts.payeeLabel, parts.termLabel,
      Number.isFinite(parts.amountEur) ? formatEur(parts.amountEur) : null, parts.label].filter(Boolean).join(' · ');
  }

  /** Moments that supplier payments are tied to; the plan may not drop them. */
  readonly scopedSupplierDues = computed(() => [...new Set((this.payments() ?? [])
    .filter(payment => (payment.payee ?? 'SUPPLIER') === 'SUPPLIER' && payment.instalmentDue)
    .map(payment => payment.instalmentDue!))]);

  readonly paymentsPdfBusy = signal(false);

  /** The same PDF as in the Nacalculatie; only of what is saved. */
  async downloadPaymentsPdf(): Promise<void> {
    const data = this.view();
    if (!data || this.dirty() || this.paymentsPdfBusy()) return;
    this.paymentsPdfBusy.set(true);
    try {
      saveBlob(await this.sourcing.purchasePaymentsPdf(data.order.id), `${data.order.number.replace(/[^\p{L}\p{N}._-]/gu, '-')}-betalingen-kostprijs.pdf`);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'PDF maken mislukt'), 'err');
    } finally {
      this.paymentsPdfBusy.set(false);
    }
  }

  /** 'Betaling aan…' from the phone dock. */
  readonly payeeMenuOpen = signal(false);
  readonly payeeActionItems = computed(() => payeeMenuItems(this.paymentLedger()));

  /** Transport and inspection still open when the container comes in; they are paid apart. */
  readonly receiveOpenPayees = computed(() => (this.paymentLedger()?.payees ?? [])
    .filter(item => (item.payee === 'LOGISTICS' || item.payee === 'SEPARATE') && item.openEur > 0)
    .map(item => ({ label: item.label, openEur: item.openEur })));

  /* ---- documents ---------------------------------------------------- */
  readonly documents = signal<PurchaseDocument[] | null>(null);
  /** The last document request failed: proof coverage is unknown, not missing. */
  readonly documentsFailed = signal(false);
  readonly addingDocument = signal<{ kind: DocumentKind; label: string; paymentId: number | null; file: File | null; files?: File[] } | null>(null);
  readonly uploadingDocument = signal(false);
  readonly documentKinds: { value: DocumentKind; label: string }[] = [
    { value: 'PAYMENT_PROOF', label: 'Betaalbewijs' }, { value: 'COMMERCIAL_INVOICE', label: 'Commercial invoice' },
    { value: 'INVOICE', label: 'Factuur' }, { value: 'PACKING_LIST', label: 'Packing list' }, { value: 'BILL_OF_LADING', label: 'Bill of lading' },
    { value: 'CUSTOMS', label: 'Douanedocument' }, { value: 'OTHER', label: 'Andere' },
  ];
  /**
   * The kinds the sheet offers: a server without invoices does not know the
   * kind INVOICE yet. With it a betaalbewijs is added in the payment sheet
   * only (one list there, Emre 2026-10-15), never as a loose dossier file.
   */
  readonly documentKindOptions = computed(() => this.roundOnServer() ? this.documentKinds.filter(kind => kind.value !== 'PAYMENT_PROOF')
    : this.documentKinds.filter(kind => kind.value !== 'INVOICE'));

  private documentLoadVersion = 0;

  protected async loadDocuments(orderId: number): Promise<void> {
    if (Number(this.id()) !== orderId) return;
    const version = ++this.documentLoadVersion;
    // The route is authoritative while catalogue context still holds back view.
    // A later refresh or another visit must also invalidate this response.
    const active = () => Number(this.id()) === orderId && version === this.documentLoadVersion;
    try {
      const docs = await this.sourcing.documents(orderId);
      if (active()) { this.documents.set(docs); this.documentsFailed.set(false); }
    } catch {
      // The dossier shows an empty list; the payments ledger treats the proofs as unknown.
      if (active()) { this.documents.set([]); this.documentsFailed.set(true); }
    }
  }

  /* ---- partner container --------------------------------------------- */
  /** Sales documents of a partner who co-orders this container at our landed cost: quote, invoice, settlement. */
  readonly partnerDocs = signal<SalesOrderView[]>([]);
  readonly relatedSalesDocs = signal<SalesOrderView[]>([]);
  readonly partnerCompany = signal('');
  readonly partnerSheetOpen = signal(false);
  /** The share the container already runs on, from its first linked document. */
  readonly partnerShare = computed(() => this.partnerDocs()[0]?.order.partnerSharePct ?? null);

  onPartnerLinked(): void {
    const id = this.view()?.order.id;
    if (id == null) return;
    void this.loadPartnerDocs(id);
    /* A linked document may have given the container its partner; pick that up without touching the draft. */
    void this.sourcing.purchaseOrder(id).then((fresh) => this.carryPartner(fresh)).catch(() => undefined);
  }

  /** The container took, changed or lost its partner in the panel: only those three fields move into the draft. */
  onPartnerSaved(fresh: PurchaseOrderView): void {
    this.carryPartner(fresh);
    void this.loadPartnerDocs(fresh.order.id);
  }

  private carryPartner(fresh: PurchaseOrderView): void {
    this.view.update((current) => current ? { ...current, order: { ...current.order,
      partnerCustomerId: fresh.order.partnerCustomerId ?? null,
      partnerCostPct: fresh.order.partnerCostPct ?? null,
      partnerSharePct: fresh.order.partnerSharePct ?? null } } : current);
    this.reloadPartnerFinancing();
  }

  /* ---- the nacalculatie -------------------------------------------------- */
  /** The partner's money in, for the Nacalculatie's Partner block: fetched once per partner container, again after a partner change. */
  readonly partnerFinancing = signal<PartnerFinancing | null | 'loading' | 'error'>(null);
  private partnerFinancingVersion = 0;
  private partnerFinancingKey = '';
  /** Follows the loaded order and its partner; draft edits keep the key and fetch nothing. */
  private readonly partnerFinancingWatch = effect(() => {
    const data = this.view();
    const key = data ? `${data.order.id}|${data.order.partnerCustomerId ?? ''}` : '';
    untracked(() => {
      if (key === this.partnerFinancingKey) return;
      this.partnerFinancingKey = key;
      this.reloadPartnerFinancing();
    });
  });

  reloadPartnerFinancing(): void {
    const data = this.view();
    const version = ++this.partnerFinancingVersion;
    if (!data || data.order.partnerCustomerId == null) { this.partnerFinancing.set(null); return; }
    this.partnerFinancing.set('loading');
    this.sourcing.partnerFinancing(data.order.id).then((financing) => {
      if (version === this.partnerFinancingVersion) this.partnerFinancing.set(financing);
    }).catch(() => {
      if (version === this.partnerFinancingVersion) this.partnerFinancing.set('error');
    });
  }

  /** The Nacalculatie in four lines, for the Betalingen cards; the ledger sharpens its state. */
  readonly nacalcSummary = computed(() => {
    const data = this.view();
    return data ? purchaseNacalcSummary(data, this.paymentLedger()) : null;
  });
  /**
   * The header's landed cost per unit, judged as the Nacalculatie does: the
   * container's figure when it means something (one product, or one family
   * in one unit and display size; a display per display with its piece price), else the
   * products' range ('2 producten · € 2,600 – € 8,867 per stuk'). Never an
   * average over different products (Emre, 2026-10-15).
   */
  readonly landedUnit = computed(() => {
    const data = this.view();
    if (!data) return null;
    const mix = this.nacalcSummary()?.mix;
    const uniform = mix && mix.count > 0 ? mix.uniform : new Set(data.costing.lines.map(line => line.productId)).size <= 1;
    return landedUnit(data.costing.lines, data.costing.totals.averageUnitEur, uniform, productId => this.setPiecesOf(productId));
  });
  readonly landedUnitText = computed(() => { const up = new EurUpPipe(); return landedUnitText(this.landedUnit(), value => up.transform(value, 3)); });

  /** The whole story: server report, ledger and partner financing joined by purchaseNacalc. */
  readonly nacalc = computed(() => {
    const data = this.view();
    const partner = this.partnerFinancing();
    return data ? purchaseNacalc({ view: data, ledger: this.paymentLedger(), summary: this.nacalcSummary(),
      partner: partner === 'loading' || partner === 'error' ? null : partner }) : null;
  });

  unlinkPartnerDoc(doc: SalesOrderView): void {
    this.ui.confirm({
      title: 'Koppeling verwijderen',
      message: `${doc.order.number} telt daarna niet meer als partnerdocument van deze container.`,
      confirmLabel: 'Ontkoppelen', danger: true,
    }, async () => {
      try {
        await this.sales.setPartnerDeal(doc.order.id, { purchaseOrderId: null, sharePct: null, reference: null });
        this.ui.toast('Koppeling verwijderd');
        this.onPartnerLinked();
      } catch (failure: unknown) {
        this.ui.toast(messageOf(failure, 'Ontkoppelen mislukt'), 'err');
      }
    });
  }

  protected async loadPartnerDocs(orderId: number): Promise<void> {
    try {
      const all = await this.sales.orders();
      if (Number(this.id()) !== orderId) return;
      this.relatedSalesDocs.set(all.filter((view) => view.order.partnerPurchaseOrderId === orderId || view.order.sourcePurchaseOrderId === orderId));
      const deals = all.filter((view) => view.order.partnerPurchaseOrderId === orderId && view.order.purpose !== 'STANDARD');
      this.partnerDocs.set(deals);
      const customerId = deals[0]?.order.customerId;
      if (!customerId) { this.partnerCompany.set(''); this.partnerCustomer.set(null); return; }
      const customers = await this.sales.customers().catch(() => [] as Customer[]);
      if (Number(this.id()) !== orderId) return;
      const customer = customers.find((row) => row.id === customerId) ?? null;
      this.partnerCustomer.set(customer);
      this.partnerCompany.set(customer?.company ?? '');
    } catch {
      this.partnerDocs.set([]);
    }
  }

  /* ---- auction settlement ---------------------------------------------- */
  readonly partnerCustomer = signal<Customer | null>(null);
  readonly auctionOpen = signal(false);
  /** Lead seam: the desk mounts app-sales-credit-note-sheet (partner mode) on this. */
  readonly creditNoteOpen = signal(false);
  /** The container's products as they appear on the partner's auction statement. */
  /** Inspection and other costs kept apart from the piece price, per piece, for the settlement preview. */
  readonly separateUnitEur = computed(() => this.view()?.reconciliation ? 0 : separateCostPerPiece(this.view()?.costing.totals));
  readonly auctionLines = computed<AuctionSheetLine[]>(() => {
    const reconciliation = this.view()?.reconciliation;
    if (reconciliation) return reconciliation.lines.filter((line) => line.productId != null && line.unitCostQuantity > 0).map((line) => ({
      productId: line.productId!, name: line.productName, quantity: line.unitCostQuantity,
      landedUnitEur: line.forecastExternalEur / line.unitCostQuantity,
    }));
    return (this.view()?.costing.lines ?? []).map((line) => ({ productId: line.productId, name: line.productName, quantity: line.quantity, landedUnitEur: line.landedUnitEur }));
  });
  /** The cost document the partner paid, when there is one. */
  readonly auctionSourceId = computed(() => this.partnerDocs().find((doc) => !isSettlementInvoice(doc.order))?.order.id ?? null);
  /** Without a cost document we financed the whole container; with one, what the partner did not pay up front. */
  readonly auctionCostShare = computed(() => this.auctionSourceId() === null
    ? 100 : Math.min(100, Math.max(0, 100 - (this.partnerCustomer()?.partnerCostPct ?? 100))));
  readonly auctionProfitShare = computed(() => this.partnerDocs()[0]?.order.partnerSharePct ?? this.view()?.order.partnerSharePct ?? this.partnerCustomer()?.partnerSharePct ?? 50);
  readonly auctionCustomerId = computed(() => this.partnerDocs()[0]?.order.customerId ?? this.view()?.order.partnerCustomerId ?? null);

  readonly partnerKind = partnerDocumentKind;

  proofsOf(paymentId: number): PurchaseDocument[] {
    return (this.documents() ?? []).filter((doc) => doc.paymentId === paymentId);
  }

  proofSlots(paymentId?: number | null): number {
    return Math.max(0, 5 - (paymentId ? this.proofsOf(paymentId).length : 0));
  }

  sizeLabel(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' kB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /* ---- a document from the library becomes a purchase document */
  readonly libraryOpen = signal(false);

  async pickLibraryDocument(assets: MediaAssetSummary[]): Promise<void> {
    const asset = assets[0];
    this.libraryOpen.set(false);
    if (!asset) return;
    try {
      const blob = await this.media.download(asset.id);
      const file = new File([blob], asset.originalFilename || asset.name, { type: asset.contentType });
      this.addingDocument.update((draft) => draft
        ? { ...draft, file, label: draft.label || asset.name }
        : { kind: 'OTHER' as DocumentKind, label: asset.name, paymentId: null, file });
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'Het bestand kon niet uit de bibliotheek worden gehaald.'), 'err');
    }
  }

  openDocument(): void {
    this.addingDocument.set({ kind: this.roundOnServer() ? 'OTHER' : 'PAYMENT_PROOF', label: '', paymentId: null, file: null, files: [] });
  }

  closeDocument(): void { if (!this.uploadingDocument()) this.addingDocument.set(null); }

  async confirmDocument(): Promise<void> {
    const data = this.view();
    const doc = this.addingDocument();
    const files = doc?.kind === 'PAYMENT_PROOF' && doc.files?.length ? doc.files.slice(0, 5) : doc?.file ? [doc.file] : [];
    if (!data || !doc || !files.length || this.uploadingDocument()) return;
    if (doc.kind === 'PAYMENT_PROOF' && files.length > this.proofSlots(doc.paymentId)) { this.ui.toast('Er passen maximaal vijf bewijzen bij één betaling.', 'err'); return; }
    this.uploadingDocument.set(true);
    try {
      for (const file of files) {
        const document = await this.sourcing.addDocument(data.order.id, file, doc.kind, doc.label || null, doc.paymentId);
        if (this.view()?.order.id === data.order.id) this.documents.update(current => [...(current ?? []), document]);
        this.addingDocument.update(current => current ? { ...current, file: current.file === file ? null : current.file,
          files: current.files?.filter(item => item !== file) } : current);
      }
      await this.loadDocuments(data.order.id);
      if (this.view()?.order.id !== data.order.id) return;
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
    return files ? Array.from(files).slice(0, 5) : [];
  }

  /* ---- just ordered: the first instalment ---------------------------- */
  readonly firstInstalmentPrompt = signal<{ label: string; amount: number | null; amountInput: string; currency: Currency; paidOn: string; files: File[]; due: PurchasePayment['instalmentDue'] } | null>(null);

  private promptFirstInstalment(): void {
    const first = this.plannedInstalments().find((step) => step.state === 'due');
    if (!first) return;
    this.firstInstalmentPrompt.set({ label: first.label, amount: first.amount, amountInput: amountInputText(first.amount), due: first.due, currency: 'EUR',
      paidOn: new Date().toISOString().slice(0, 10), files: [] });
  }

  async confirmFirstInstalment(): Promise<void> {
    const first = this.firstInstalmentPrompt();
    if (!first || first.amount === null || !((first.amount ?? 0) > 0) || this.payingBusy() || this.paying()) return;
    this.paying.set({ ...first, payee: 'SUPPLIER', settles: false, instalmentDue: first.due ?? null,
      invoiceId: this.preselectedInvoice('SUPPLIER'), invoiceIdChanged: false });
    this.firstInstalmentPrompt.set(null);
  }

  setFirstPaymentAmount(raw: string | number | null): void {
    if (this.payingBusy()) return;
    this.firstInstalmentPrompt.update(first => first ? { ...first, amountInput: raw == null ? '' : String(raw), amount: parsePurchasePaymentAmount(raw) } : first);
  }

  /** The server wrote a line in the notes; pick it up without disturbing the draft. */
  private async reloadOrderQuietly(): Promise<void> {
    const data = this.view();
    if (!data) return;
    if (this.dirty()) {
      await this.preview();
      return;
    }
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
  readonly receiveSummary = computed(() => {
    const draft = this.receiving();
    return draft ? receiptMetrics(draft.lines.map((line) => ({
      orderedPieces: line.ordered,
      receivedPieces: line.received,
      damagedPieces: line.damaged,
      unitValueEur: line.unitValueEur,
      note: '',
    }))) : null;
  });

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
        const costing = current.costing.lines.find((candidate) => candidate.productId === line.productId);
        const currency = line.exwCurrency ?? product?.exwCurrency;
        const priceKnown = (line.exwPrice ?? product?.exwPrice) != null;
        const fxKnown = currency === 'EUR' || (current.order.usdToEurGoods > 0
          && (currency !== 'CNY' || current.order.cnyToUsd > 0));
        const calculatedUnitValue = priceKnown && fxKnown && costing && costing.quantity > 0
          ? costing.goodsEur / costing.quantity : null;
        return {
          productId: line.productId,
          name: product?.name ?? `Product ${line.productId}`,
          sku: product?.sku ?? '',
          ordered: line.orderedQuantity ?? line.quantity,
          received: line.quantity,
          damaged: 0,
          unitValueEur: line.receiptUnitValueEur ?? calculatedUnitValue,
          note: line.issueNote ?? '',
        };
      }),
      bookStock: true,
      finalPayment: false,
      note: '',
      receivedOn: localIsoDay(),
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

  setIssueNote(productId: number, note: string): void {
    this.receiving.update((draft) => draft && ({
      ...draft,
      lines: draft.lines.map((line) => line.productId === productId ? { ...line, note } : line),
    }));
  }

  setDamaged(productId: number, damaged: number): void {
    this.receiving.update((draft) => draft && {
      ...draft,
      lines: draft.lines.map((line) => line.productId === productId
        ? { ...line, damaged: Math.min(Math.max(0, damaged || 0), line.received) }
        : line),
    });
  }

  receiptLineImpact(line: ReceiveDraft['lines'][number]): number | null {
    return receiptLineMetrics({
      orderedPieces: line.ordered,
      receivedPieces: line.received,
      damagedPieces: line.damaged,
      unitValueEur: line.unitValueEur,
    }).totalLossValueEur;
  }

  async confirmReceive(): Promise<void> {
    const data = this.view();
    const draft = this.receiving();
    if (!data || !draft || this.booking()) return;
    this.booking.set(true);
    try {
      const lines: ReceivedLine[] = draft.lines.map((line) => ({
        productId: line.productId, received: line.received, damaged: line.damaged,
        unitValueEur: line.unitValueEur,
        issueNote: line.received !== line.ordered || line.damaged > 0 ? (line.note.trim() || null) : null }));
      // Receive using only confirmed payments. The optional final payment opens the
      // shared payment sheet afterwards, where the actual bank row can be selected.
      const supplierPaidCents = Math.round(this.paidTotalEur() * 100);
      const finalPaymentAmount = draft.finalPayment && this.remainingEur() > 0.005 ? Math.round(this.remainingEur() * 100) / 100 : null;
      const result = await this.sourcing.receivePurchaseOrder(data.order.id, {
        lines, bookStock: draft.bookStock, paidTotalEur: (supplierPaidCents / 100) || null,
        receivedOn: draft.receivedOn || null, note: draft.note || null,
      });
      ++this.previewVersion;
      this.view.set(result);
      this.savedOrder.set(JSON.stringify(result.order));
      this.receiving.set(null);
      this.statusCelebration.set('RECEIVED');
      const refreshed = await this.refreshPaymentState(result.order.id);
      this.products.set(await this.catalog.products(result.order.supplierId));
      if (finalPaymentAmount && refreshed && this.view()?.order.id === result.order.id) {
        this.openPayment(finalPaymentAmount, 'Slotbetaling', 'SUPPLIER');
        this.paying.update(payment => payment ? { ...payment, settles: true } : payment);
      }
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
  /**
   * Where the container clears customs, as the VAT return reads it; null stays
   * 'te bevestigen' with the port's suggestion. The labels are short enough for
   * a phone's select; the hint under it names the fiscal representative.
   */
  readonly clearanceOptions: readonly { value: Clearance; label: string }[] = [
    { value: 'NL_FISCAL_REP_SOLD_IN_NL', label: 'Blijft in Nederland · daar verkocht' },
    { value: 'NL_FISCAL_REP_TO_BE', label: 'Via Nederland naar ons in België' },
    { value: 'BE_CUSTOMS', label: 'Inklaring in België (douane)' },
  ];

  /** The suggestion in a few words: the closed select on a phone has room for about thirty characters after 'Voorstel: '. */
  suggestedClearanceLabel(destinationPort: string | null | undefined): string {
    const suggested = clearanceSuggestion(destinationPort);
    return suggested === 'BE_CUSTOMS' ? 'inklaring in België' : suggested === 'NL_FISCAL_REP_TO_BE' ? 'via Nederland naar België' : 'blijft in Nederland';
  }
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

  protected readonly sourcing = inject(SourcingApi);
  protected readonly sales = inject(SalesApi);
  private readonly catalog = inject(CatalogApi);
  /* Warms the unit names so carton notices say "1 bowl meer"; "stuks" until they
     arrive. A field rather than constructor work: the constructor only wires the route. */
  private readonly unitNamesLoad = this.catalog.unitNames().catch(() => undefined);

  /** Active stock locations; the container is unloaded at one of them. */
  readonly stockLocations = signal<StockLocation[]>([]);
  readonly mainLocationId = computed(() =>
    this.stockLocations().find((location) => location.code === 'MAIN')?.id ?? this.stockLocations()[0]?.id ?? null);
  receivingLocationName(id: number | null | undefined): string {
    const locations = this.stockLocations();
    return locations.find((location) => location.id === (id ?? this.mainLocationId()))?.name ?? 'Magazijn';
  }
  private readonly router = inject(Router);
  protected readonly ui = inject(Ui);
  protected readonly media = inject(MediaApi);

  readonly id = input<string>('');

  /* ---- today's market rates, next to the rates the order was calculated with ---- */
  private readonly fx = inject(Fx);
  readonly marketReference = computed(() => purchaseFxReference(this.fx.series()));
  readonly marketRates = computed(() => purchaseFxDefaults(this.marketReference()));
  private readonly marketLoaded = (() => { if (!this.fx.series()) void this.fx.load(); return true; })();

  /* ---- the Enrosed kost by hand ------------------------------------------ */
  readonly extraSplitOpen = signal(false);
  readonly manualExtra = computed(() => this.view()?.order.allocExtra === 'MANUAL');
  readonly extraSplitSpread = computed(() => round2((this.view()?.order.lines ?? []).reduce((sum, line) => sum + (line.extraShareEur ?? 0), 0)));
  /** The container's Enrosed kost below zero: the order cannot be saved until it is put right. */
  readonly negativeExtra = computed(() => this.manualExtra() && this.extraSplitSpread() < 0);
  readonly extraSplitRemainder = computed(() => round2((this.view()?.order.extraRevenueEur || 0) - this.extraSplitSpread()));
  readonly extraSplitPct = computed(() => { const target = this.view()?.order.extraRevenueEur || 0; return target > 0 ? Math.min(100, this.extraSplitSpread() / target * 100) : 0; });

  allocationLabel(allocation: Allocation | null | undefined): string {
    return allocation === 'CBM' ? 'naar volume' : allocation === 'VALUE' ? 'naar goederenwaarde' : allocation === 'MANUAL' ? 'zelf per product' : 'naar aantal stuks';
  }

  /** Switches the Enrosed kost to a hand-made split, starting from what the key gave each line; the amounts then sit on the product rows. */
  startManualSplit(): void {
    const data = this.view();
    if (!data || data.order.allocExtra === 'MANUAL') return;
    const lines = data.order.lines.map((line) => {
      const costed = data.costing.lines.find((row) => row.productId === line.productId);
      return { ...line, extraShareEur: round2(costed?.extraRevenueEur ?? 0) };
    });
    this.patch({ allocExtra: 'MANUAL', lines });
  }

  /** Back to a key: the shares go, the pieces count spreads the Enrosed kost again. */
  endManualSplit(): void {
    const data = this.view();
    if (!data) return;
    this.patch({ allocExtra: 'PIECES', lines: data.order.lines.map((line) => ({ ...line, extraShareEur: null })) });
  }

  /** The split window: the key goes to by hand when it was not yet, the amounts start from the key's split. */
  openManualSplit(): void {
    this.startManualSplit();
    this.extraSplitOpen.set(true);
  }

  /** Klaar: what was spread above the Enrosed kost becomes the Enrosed kost; below it the target stays, for the rest to follow. */
  closeExtraSplit(): void {
    if (this.manualExtra() && this.extraSplitRemainder() < -0.004) this.patch({ extraRevenueEur: this.extraSplitSpread() });
    this.extraSplitOpen.set(false);
  }

  /** The window names the product; the costed line it is measured against comes from the draft. */
  setTargetUnitFor(productId: number, raw: unknown): void {
    const line = this.view()?.costing.lines.find((row) => row.productId === productId);
    if (line) this.setTargetUnit(productId, line, raw);
  }

  setExtraShare(productId: number, raw: unknown): void {
    const value = Number(String(raw ?? '').replace(',', '.'));
    this.patchShare(productId, Number.isFinite(value) ? round2(value) : 0);
  }

  /** One line's share changes, and the container's Enrosed kost becomes the sum of all of them. */
  private patchShare(productId: number, extraShareEur: number): void {
    const data = this.view();
    if (!data) return;
    const lines = data.order.lines.map((line) => (line.productId === productId ? { ...line, extraShareEur } : line));
    this.patch({ lines, extraRevenueEur: round2(lines.reduce((sum, line) => sum + (line.extraShareEur ?? 0), 0)) });
  }

  /** The Enrosed kost inside one piece of a costed line. */
  extraPerPiece(line: { quantity: number; extraRevenueEur: number }): number {
    return line.quantity > 0 ? line.extraRevenueEur / line.quantity : 0;
  }

  /** The landed piece price without any Enrosed kost: what a target price is measured against. */
  basePerPiece(line: { quantity: number; totalEur: number; extraRevenueEur: number }): number {
    return line.quantity > 0 ? (line.totalEur - line.extraRevenueEur) / line.quantity : 0;
  }

  /** The other way round: a target landed price per piece, and the line's Enrosed kost follows from it. */
  setTargetUnit(productId: number, line: { quantity: number; totalEur: number; extraRevenueEur: number }, raw: unknown): void {
    const target = Number(String(raw ?? '').replace(',', '.'));
    if (!Number.isFinite(target)) return;
    /* Below the bare cost the share goes negative on purpose: it shows, and the total decides. */
    this.patchShare(productId, round2((target - this.basePerPiece(line)) * line.quantity));
  }

  /** Three decimals, rounded up: the way every piece amount on the order reads. */
  fixed3(value: number | null | undefined): string {
    return Number.isFinite(value as number) ? ceilTo(value, 3).toFixed(3) : '';
  }

  /** Spreads the whole Enrosed kost by a key, cents landing on the last line, as a start to adjust by hand. */
  fillExtraSplit(key: 'PIECES' | 'VALUE' | 'CBM' | 'EVEN'): void {
    const data = this.view();
    if (!data || !data.order.lines.length) return;
    const target = data.order.extraRevenueEur || 0;
    const weights = data.order.lines.map((line) => {
      const costed = data.costing.lines.find((row) => row.productId === line.productId);
      return key === 'PIECES' ? line.quantity : key === 'VALUE' ? (costed?.goodsEur ?? 0) : key === 'CBM' ? (costed?.cbm ?? 0) : 1;
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const shares = weights.map((weight) => (total > 0 ? round2(target * weight / total) : 0));
    const given = round2(shares.reduce((sum, share) => sum + share, 0));
    shares[shares.length - 1] = round2(shares[shares.length - 1] + target - given);
    this.patch({ lines: data.order.lines.map((line, at) => ({ ...line, extraShareEur: Math.max(0, shares[at]) })) });
  }

  extraSplitRestToLast(): void {
    const data = this.view();
    if (!data || !data.order.lines.length) return;
    const last = data.order.lines.length - 1;
    const rest = this.extraSplitRemainder();
    const lines = data.order.lines.map((line, at) => (at === last ? { ...line, extraShareEur: round2((line.extraShareEur ?? 0) + rest) } : line));
    this.patch({ lines, extraRevenueEur: round2(lines.reduce((sum, line) => sum + (line.extraShareEur ?? 0), 0)) });
  }

  readonly allocationKeys = computed(() => {
    const labels = this.costLabels();
    const extra = { field: 'allocExtra' as const, label: 'Enrosed kost',
      route: 'Commerciële opslag per verdeelsleutel' };
    const separate = { field: 'allocSeparate' as const, label: 'Inspectie & andere kosten',
      route: 'Standaard achteraf: apart van de stukprijs, wel in het totaal' };
    if (this.isDdp()) return [extra, separate];
    return [
      { field: 'allocFreight' as const, label: labels.seaFreightLabel,
        route: labels.seaFreightRoute },
      { field: 'allocOrigin' as const, label: labels.originCostsLabel,
        route: labels.originRoute },
      { field: 'allocDestination' as const, label: labels.destinationCostsLabel,
        route: '' },
      extra,
      separate,
    ];
  });

  readonly view = signal<PurchaseOrderView | null>(null);
  readonly adjustments = signal<PurchaseOrderView['adjustments']>([]);
  readonly products = signal<Product[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly families = signal<ProductFamily[]>([]);
  private readonly productById = computed(() => new Map(this.products().flatMap((product) =>
    product.id === null ? [] : [[product.id, product] as const])));
  readonly lineSections = computed(() => purchaseLineSections(
    this.view()?.costing.lines ?? [], this.products(), this.categories(),
    this.families(), null));
  private readonly unfilteredPurchaseLines = computed(() => this.lineSections()
    .flatMap((section) => section.lines));
  /** Product ids as the product list shows them, section by section and family by family. */
  readonly lineOrder = computed(() => this.lineSections()
    .flatMap((section) => section.families.flatMap((family) => family.lines.map((line) => line.productId))));
  readonly freightRates = signal<FreightRate[]>([]);
  /** The order's supplier; drives the header and the origin-cost label. */
  readonly supplier = signal<Supplier | null>(null);
  readonly latestFreightReference = computed(() => {
    const order = this.view()?.order;
    return order ? latestOwnFreightQuote(
      this.freightRates(), order.departurePort, order.destinationPort, order.containerType,
    ) : null;
  });

  readonly picking = signal(false);
  /** Opens only after the server confirms CONCEPT -> BESTELD. */
  readonly orderPlaced = signal(false);
  /** Which little scene plays: the ship at Vertrokken, the boxes at Ontvangen. */
  readonly statusCelebration = signal<'SHIPPED' | 'RECEIVED' | null>(null);

  celebrationAction(kind: 'SHIPPED' | 'RECEIVED'): void {
    this.statusCelebration.set(null);
    if (kind === 'SHIPPED') {
      // Track & trace invullen: the field on Overzicht, and the screen stays here instead of returning to the view.
      this.keepAfterStep.set(true);
      this.setPhoneTab('overzicht');
      setTimeout(() => document.getElementById('mpo-tracking')?.focus(), 150);
    } else {
      void this.bookStock();
    }
  }

  constructor() {
    effect(() => {
      const routeId = this.id();
      if (routeId) untracked(() => { void this.load(+routeId); });
    });
  }

  /**
   * The order could not load (B2): the screen shows app-load-error with
   * 'Opnieuw proberen' instead of an endless skeleton. Only while no order shows.
   */
  readonly loadError = signal<string | null>(null);
  readonly loadRetrying = signal(false);
  async retryLoad(): Promise<void> {
    const orderId = Number(this.id());
    if (!orderId || this.loadRetrying()) return;
    this.loadRetrying.set(true);
    try { await this.load(orderId); } finally { this.loadRetrying.set(false); }
  }

  protected async load(orderId: number): Promise<void> {
    ++this.paymentRefreshVersion;
    ++this.previewVersion;
    ++this.documentLoadVersion;
    this.documents.set(null);
    this.loadError.set(null);
    if (this.view()?.order.id !== orderId) {
      this.view.set(null);
      /* The Kostprijzen toepassen sheet was for the order being left. */
      this.applyFor.set(null);
    }
    this.paymentStateError.set(null);
    this.paymentStateLoading.set(false);
    this.payments.set(null);
    this.families.set([]);
    /* F23: what needs only the id starts at once, beside the order (each guards by id/version),
       instead of waiting behind the order and the families. */
    void this.loadPayments(orderId);
    void this.loadDocuments(orderId);
    void this.loadBankLines();
    void this.loadPartnerDocs(orderId);
    const failed = (failure: unknown): void => {
      if (Number(this.id()) === orderId) this.loadError.set(messageOf(failure, LOAD_ERROR_FALLBACK));
    };
    /* The families decide how the product list groups and sorts, so they load
       with the order: the list must not paint and then jump into its groups. An
       unavailable catalogue endpoint still never holds up opening the order. */
    let view: PurchaseOrderView;
    let families: ProductFamily[];
    try {
      [view, families] = await Promise.all([
        this.sourcing.purchaseOrder(orderId),
        this.catalog.productFamilies().catch(() => [] as ProductFamily[]),
      ]);
    } catch (failure: unknown) { failed(failure); return; }
    if (Number(this.id()) !== orderId) return;
    this.families.set(families);
    this.savedOrder.set(JSON.stringify(view.order));
    let products: Product[], categories: Category[], suppliers: Supplier[], locations: StockLocation[], freightRates: FreightRate[];
    try {
      [products, categories, suppliers, locations, freightRates] = await Promise.all([
        this.catalog.products(view.order.supplierId),
        this.catalog.categories().catch(() => [] as Category[]),
        this.sourcing.suppliers(),
        this.catalog.stockLocations().catch(() => [] as StockLocation[]),
        /* A market-context hint must never block opening the order. */
        this.sourcing.freightRates().catch(() => [] as FreightRate[])]);
    } catch (failure: unknown) { failed(failure); return; }
    if (Number(this.id()) !== orderId) return;
    this.products.set(products);
    this.categories.set(categories);
    this.freightRates.set(freightRates);
    this.stockLocations.set(locations.filter((location) => location.active));
    this.supplier.set(suppliers.find((s) => s.id === view.order.supplierId) ?? null);
    /* Publish the order only after its header context is ready. Otherwise the
       app bar first paints a placeholder supplier and visibly jumps when the
       supplier request finishes. */
    this.view.set(view);
  }

  supplierName(): string { return this.supplier()?.name ?? 'Onbekend'; }

  creatorName(data: PurchaseOrderView): string {
    return data.createdBy?.displayName || 'maker onbekend';
  }

  actorLabel(actor: string): string {
    const canonical = actor.trim().toLocaleLowerCase('nl-BE');
    if (canonical === 'emre') return 'Emre';
    if (canonical === 'berat') return 'Berat';
    return actor;
  }

  readonly available = computed(() => {
    const used = new Set((this.view()?.order.lines ?? []).map((line) => line.productId));
    return this.products().filter((product) => !used.has(product.id!));
  });

  /** Receipt booked stock already; changing the booked lines would corrupt history. */
  readonly isReceived = computed(() => this.view()?.order.status === 'ONTVANGEN');

  allocationOf(order: PurchaseOrder, field: keyof PurchaseOrder): Allocation {
    if (field === 'allocSeparate') return order.allocSeparate ?? 'SEPARATE';
    return order[field] as Allocation;
  }

  /** Whether a key spreads the inspection and other named costs into the piece prices. */
  readonly separateInPiece = computed(() => (this.view()?.order.allocSeparate ?? 'SEPARATE') !== 'SEPARATE');
  readonly separateCaption = computed(() => this.separateInPiece()
    ? 'In de stukprijs, verdeeld ' + this.allocationLabel(this.view()?.order.allocSeparate) + '.'
    : 'Achteraf: apart van de stukprijs, wel in het totaal.');

  /* ---- draft, preview, save ---------------------------------------- */

  /* The order on screen is a draft: every edit lands here at once and the
     figures are recalculated by the server without saving. Only Opslaan
     (or a status step, which is an action) writes the order. */
  protected readonly savedOrder = signal<string>('');
  readonly saving = signal(false);
  readonly deletingOrder = signal(false);
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
    if (!data || this.deletingOrder() || this.paymentPlanBusy() || this.payingBusy()) return;
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
      if (version === this.previewVersion && !this.deletingOrder()) this.ui.toast(messageOf(failure, 'Berekening vernieuwen mislukt'), 'err');
    }
  }

  /**
   * Writes the draft; the server answers with the order as it stands.
   * stepBack marks the one save that may put the status on an earlier step;
   * its caller says what happened, so the plain 'Opgeslagen' stays out.
   */
  async save(options: { stepBack?: boolean } = {}): Promise<PurchaseOrderView | null> {
    const data = this.view();
    if (!data || this.saving() || this.deletingOrder() || this.paymentPlanBusy() || this.payingBusy()) return null;
    if (this.negativeExtra()) {
      this.ui.toast('De Enrosed kost van de container staat in totaal onder nul; zet dat eerst recht', 'err');
      return null;
    }
    if (this.previewTimer !== null) { clearTimeout(this.previewTimer); this.previewTimer = null; }
    this.saving.set(true);
    try {
      const result = await this.sourcing.updatePurchaseOrder(data.order.id, data.order, { stepBack: options.stepBack === true });
      ++this.previewVersion;
      this.view.set(result);
      this.savedOrder.set(JSON.stringify(result.order));
      this.adjustments.set(result.adjustments ?? []);
      /* Loose purchasing quantities stay untouched. The quiet inline notice
         already explains the neighbouring full cartons while editing. */
      if (!options.stepBack) this.ui.toast('Opgeslagen');
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
    if (this.saving() || this.deletingOrder() || this.payingBusy() || this.paymentPlanBusy() || this.uploadingDocument()) return false;
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
    if (this.dirty() || this.payingBusy() || this.paymentPlanBusy() || this.uploadingDocument()) event.preventDefault();
  }

  /** Familiar desktop shortcut; the mobile dock keeps the same action within thumb reach. */
  @HostListener('window:keydown', ['$event'])
  saveShortcut(event: KeyboardEvent): void {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
    event.preventDefault();
    if (this.dirty() && !this.saving()) void this.save();
  }

  piecesPerCarton(productId: number): number {
    return this.products().find((product) => product.id === productId)?.carton.piecesPerCarton ?? 1;
  }

  cartonNotice(quantity: number, productId: number): string | null {
    const product = this.products().find((candidate) => candidate.id === productId);
    return cartonQuantityNotice(quantity, product?.carton.piecesPerCarton, productSalesUnit(product));
  }

  /** A product sold per display: its pieces, so a per-unit cost reads '/display' with the price per piece beside it; null per piece. */
  setPiecesOf(productId: number): number | null {
    const unit = productSalesUnit(this.products().find((candidate) => candidate.id === productId));
    return unit.isDisplay ? unit.piecesPerDisplay : null;
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

  /** A new named cost next to the inspection; the server drops it again when it stays empty. */
  addOtherCost(): void {
    this.enqueue((order) => ({
      ...order,
      otherCosts: [...(order.otherCosts ?? []), { label: '', amountEur: null }],
    }));
  }

  setOtherCost(index: number, changes: Partial<OtherCost>): void {
    this.enqueue((order) => ({
      ...order,
      otherCosts: (order.otherCosts ?? []).map((cost, i) => (i === index ? { ...cost, ...changes } : cost)),
    }));
  }

  removeOtherCost(index: number): void {
    this.enqueue((order) => ({
      ...order,
      otherCosts: (order.otherCosts ?? []).filter((_, i) => i !== index),
    }));
  }

  hasSeparateCosts(order: PurchaseOrder): boolean {
    return hasSeparateCosts(order);
  }

  separateCostsTotalLabel(totals: { otherCosts?: OtherCost[]; separateCostsInPiecePrice?: boolean }): string {
    return separateCostsTotalLabel(totals);
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
    /* Choosing the hand-made split is the same as opening it: nobody should pick it and see nothing. */
    if (field === 'allocExtra' && value === 'MANUAL') { this.openManualSplit(); return; }
    this.patch({ [field]: value } as Partial<PurchaseOrder>);
  }

  setQuantity(productId: number, quantity: number): void {
    if (this.isReceived()) return;
    this.setLine(productId, { quantity });
  }

  /**
   * What is being typed in a quantity field, per line, until the field is
   * left. The field used to mirror the server's calculation line, which
   * lags a keystroke or two behind: clearing it wrote a zero back into the
   * box while you were still typing, so "50" became "050". While a draft
   * exists the box shows exactly what you typed; the order line follows
   * every complete number at once and the calculation catches up quietly.
   */
  readonly quantityDrafts = signal<Record<number, string>>({});

  /** The text the quantity box shows: the draft while typing, else the order line. */
  quantityValue(productId: number, shown: number): string | number {
    const draft = this.quantityDrafts()[productId];
    return draft !== undefined ? draft : this.draftQuantity(productId, shown);
  }

  /** The quantity as the draft order has it, before the calculation caught up. */
  draftQuantity(productId: number, shown: number): number {
    return this.orderLine(productId)?.quantity ?? shown;
  }

  typeQuantity(productId: number, raw: string | number | null): void {
    if (this.isReceived()) return;
    const text = raw === null || raw === undefined ? '' : String(raw).trim();
    this.quantityDrafts.update((drafts) => ({ ...drafts, [productId]: text }));
    const parsed = Number(text);
    if (text !== '' && Number.isInteger(parsed) && parsed >= 0) this.setLine(productId, { quantity: parsed });
  }

  /** An emptied box means "unchanged": the order line keeps its last complete number. */
  leaveQuantity(productId: number): void {
    this.quantityDrafts.update((drafts) => {
      if (!(productId in drafts)) return drafts;
      const next = { ...drafts };
      delete next[productId];
      return next;
    });
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
      : { exwPrice: +String(raw), exwCurrency: line?.exwCurrency ?? this.orderCurrency() });
  }

  setExwCurrency(productId: number, currency: Currency): void {
    if (this.orderLine(productId)?.exwPrice == null) return;
    this.setLine(productId, { exwCurrency: currency });
  }

  effectiveExwCurrency(productId: number): Currency {
    return this.orderLine(productId)?.exwCurrency
      ?? this.products().find((product) => product.id === productId)?.exwCurrency
      ?? 'USD';
  }

  /** The sign in front of a purchase price, instead of a currency picker on every line. */
  currencySymbol(currency: Currency | null | undefined): string {
    return currency === 'CNY' ? '¥' : currency === 'EUR' ? '€' : '$';
  }

  /** The currency the container's prices are in: the first priced line, else the supplier's. */
  readonly orderCurrency = computed<Currency>(() => {
    const priced = (this.view()?.order.lines ?? []).find((line) => line.exwPrice != null && line.exwCurrency);
    return priced?.exwCurrency ?? this.supplier()?.currency ?? 'USD';
  });

  /** One currency for the whole container: every line with its own price follows. */
  setOrderCurrency(currency: Currency): void {
    this.enqueue((order) => ({
      ...order,
      lines: order.lines.map((line) => (line.exwPrice == null ? line : { ...line, exwCurrency: currency })),
    }));
  }

  /**
   * EXW, CIF or DDP is how the supplier quotes the whole container, never one
   * line. CIF keeps the lines EXW and lets the supplier invoice the sea
   * freight (freightViaSupplier); EXW and DDP clear that flag again.
   */
  setOrderBasis(basis: 'EXW' | 'CIF' | 'DDP'): void {
    const priceBasis = basis === 'DDP' ? 'DDP' : 'EXW';
    this.enqueue((order) => ({
      ...order,
      ...(basis === 'CIF' ? { freightViaSupplier: true } : order.freightViaSupplier ? { freightViaSupplier: null } : {}),
      lines: order.lines.map((line) => ({ ...line, priceBasis })),
    }));
  }

  /** Current product-card price; this is a master-data reference, not payment history. */
  productCardPrice(productId: number): { amount: number; currency: Currency } | null {
    const product = this.products().find((candidate) => candidate.id === productId);
    return product?.exwPrice == null
      ? null
      : { amount: product.exwPrice, currency: product.exwCurrency ?? 'USD' };
  }

  /* ---- damage or shortfall on a received order, via one small button ---- */
  readonly noteEditing = signal(false);
  /* ---- renaming an uploaded document's title ---- */
  readonly renamingDoc = signal<{ id: number; label: string } | null>(null);

  async commitDocRename(doc: PurchaseDocument): Promise<void> {
    const editing = this.renamingDoc();
    if (!editing || editing.id !== doc.id) return;
    this.renamingDoc.set(null);
    const label = editing.label.trim();
    if (label === (doc.label ?? '')) return;
    const data = this.view();
    if (!data) return;
    try {
      await this.sourcing.renameDocument(data.order.id, doc.id, label || null);
      await this.loadDocuments(data.order.id);
      this.ui.toast('Titel aangepast', 'ok');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Titel aanpassen mislukt'), 'err');
    }
  }

  readonly issue = signal<{ productId: number; kind: 'DAMAGED' | 'SHORT'; quantity: number; note: string } | null>(null);

  readonly issueLine = computed(() => {
    const report = this.issue();
    if (!report) return null;
    return this.view()?.costing.lines.find((line) => line.productId === report.productId) ?? null;
  });

  openIssue(productId: number): void {
    const line = this.orderLine(productId);
    this.issue.set({ productId, kind: 'DAMAGED', quantity: 0, note: line?.issueNote ?? '' });
  }

  /** Writes the report into the lines and saves: the backend books the stock difference. */
  async confirmIssue(): Promise<void> {
    const report = this.issue();
    const line = this.orderLine(report?.productId ?? -1);
    if (!report || !line || !(report.quantity > 0)) return;
    const issueNote = report.note.trim() || line.issueNote || null;
    if (report.kind === 'DAMAGED') {
      const damaged = (line.damagedQuantity ?? 0) + report.quantity;
      if (damaged > line.quantity) { this.ui.toast('Meer beschadigd dan ontvangen kan niet', 'err'); return; }
      this.setLine(report.productId, { damagedQuantity: damaged, issueNote });
    } else {
      const quantity = line.quantity - report.quantity;
      if (quantity < 0) { this.ui.toast('Zoveel stuks staan er niet op de regel', 'err'); return; }
      if (quantity < (line.damagedQuantity ?? 0)) { this.ui.toast('Minder dan het aantal beschadigde stuks kan niet', 'err'); return; }
      this.setLine(report.productId, { quantity, issueNote });
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
      // DDP already includes the sea freight: a CIF flag would be ignored, so it goes.
      ...(basis === 'DDP' && order.freightViaSupplier ? { freightViaSupplier: null } : {}),
      lines: order.lines.map((line) => ({ ...line, priceBasis: basis })),
    }));
  }

  readonly isDdp = computed(() => {
    const lines = this.view()?.order.lines ?? [];
    return lines.length > 0 && lines.every((line) => (line.priceBasis ?? 'EXW') === 'DDP');
  });
  /** CIF: EXW lines, and the supplier invoices the sea freight (and origin costs). */
  readonly isCif = computed(() => !this.isDdp() && !!this.view()?.order.freightViaSupplier);

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
  readonly exwCurrencyOf = (product: Product): Currency => product.exwCurrency ?? 'USD';

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
      supplierId: data.order.supplierId, supplierNote: null, active: true,
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

  /* ---- Kostprijzen toepassen: the sheet shows every product's cost now and next first */
  /**
   * The order the sheet was opened for. The desk keeps this screen when it
   * moves to another order (a container link in the history, Back), so the
   * sheet belongs to that one order and never comes back for another.
   */
  readonly applyFor = signal<number | null>(null);
  readonly applyBusy = signal(false);
  /**
   * Products of lines the supplier's list lacks: a placed order keeps a line
   * of another supplier. Fetched by id when the sheet opens, so that row too
   * shows its cost now, its unit and its history.
   */
  readonly applyOtherProducts = signal<Product[]>([]);
  /** The rows of the saved calculation against the products as they stand; live while the sheet is open. */
  readonly applyPlan = computed(() => {
    const data = this.view();
    return data && data.order.id === this.applyFor()
      ? applyCostsPlan(data.order, data.costing.lines, [...this.products(), ...this.applyOtherProducts()]) : null;
  });

  /**
   * Opens the sheet. The server applies the saved order, so unsaved edits
   * are saved first; the supplier's products are fetched again so "Nu"
   * shows the cost they carry right now.
   */
  async apply(): Promise<void> {
    const data = this.view();
    if (!data || this.applyFor() === data.order.id || this.applyBusy() || this.saving()) return;
    if (this.dirty()) {
      const saved = await this.save();
      if (!saved || this.view()?.order.id !== data.order.id) return;
    }
    void this.catalog.unitNames().catch(() => undefined);
    this.applyOtherProducts.set([]);
    this.applyFor.set(data.order.id);
    let products = this.products();
    try {
      products = await this.catalog.products(data.order.supplierId);
      if (this.view()?.order.id === data.order.id) this.products.set(products);
    } catch { /* the list from opening the order still names every product */ }
    const current = this.view();
    if (current?.order.id !== data.order.id) return;
    const missing = missingProductIds(current.costing.lines, products);
    if (!missing.length) return;
    /* A product that cannot be fetched stays unknown: its row says so and names no unit. */
    const found = await Promise.all(missing.map((id) => this.catalog.product(id).catch(() => null)));
    if (this.applyFor() === data.order.id) this.applyOtherProducts.set(found.filter((product): product is Product => product !== null));
  }

  closeApply(): void {
    if (!this.applyBusy()) this.applyFor.set(null);
  }

  async confirmApply(): Promise<void> {
    const data = this.view();
    const plan = this.applyPlan();
    if (!data || !plan || this.applyBusy()) return;
    this.applyBusy.set(true);
    try {
      await this.sourcing.applyLandedCosts(data.order.id);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Kostprijzen toepassen mislukt'), 'err');
      return;
    } finally {
      this.applyBusy.set(false);
    }
    this.applyFor.set(null);
    this.ui.toast(applyCostsToast(plan));
    try {
      const products = await this.catalog.products(data.order.supplierId);
      if (this.view()?.order.id === data.order.id) this.products.set(products);
    } catch { /* the costs are applied; the list catches up on the next load */ }
    await this.reloadOrderQuietly();
  }

  remove(): void {
    const data = this.view();
    if (!data || this.isReceived() || this.deletingOrder() || this.saving() || this.ui.confirmRequest() !== null) return;
    this.ui.confirm(
      { title: 'Calculatie verwijderen',
        message: `Inkooporder <b>${escapeHtml(data.order.number)}</b> tijdelijk verwijderen?<br><br>`
          + (this.dirty() ? 'Niet-opgeslagen wijzigingen gaan verloren.<br><br>' : '')
          + TEMPORARY_DELETION_NOTICE,
        confirmLabel: 'Verwijderen', danger: true },
      () => { void this.deleteAndLeave(data); });
  }

  private async deleteAndLeave(data: PurchaseOrderView): Promise<void> {
    if (this.deletingOrder() || this.saving() || this.isReceived()) return;
    this.deletingOrder.set(true);
    if (this.previewTimer !== null) { clearTimeout(this.previewTimer); this.previewTimer = null; }
    ++this.previewVersion;
    try {
      await this.sourcing.deletePurchaseOrder(data.order.id);
      /* Navigation must never offer to save the deleted draft again. */
      this.savedOrder.set(JSON.stringify(this.view()?.order ?? data.order));
      this.deletingOrder.set(false);
      this.ui.toast('Inkooporder tijdelijk verwijderd');
      await this.router.navigate(['/purchasing']);
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'Inkooporder verwijderen mislukt'), 'err');
    } finally { this.deletingOrder.set(false); }
  }
}

/** Container payments are booked on the bank as Belgian local time, like the costs. */
const BANK_ZONE = 'Europe/Brussels';
/** A server before 'Verdelen over containers' (2026-10-16). */
const SHARE_SERVER_PENDING = 'Verdelen over containers kan zodra de server bijgewerkt is.';
/** The share's fields go with the pick they belong to. */
const NO_SHARE: Partial<PurchasePaymentDraft> = { alsoParts: [], shareOwn: null, shareOwnInput: '', shareMode: undefined, shareProposed: false };
/** The product lines of the container as a quote would carry them: product and pieces. */
const round2 = (value: number): number => Math.round(value * 100) / 100;

export function quoteLinesOf(view: PurchaseOrderView | null | undefined): PurchaseQuoteLine[] {
  if (!view) return [];
  const costing = new Map(view.costing.lines.map((line) => [line.productId, line] as const));
  return view.order.lines
    .filter((line) => line.productId !== null && line.quantity > 0)
    .map((line) => ({
      productId: line.productId!,
      name: costing.get(line.productId!)?.productName ?? `Product ${line.productId}`,
      quantity: line.quantity,
      landedUnitEur: costing.get(line.productId!)?.landedUnitEur ?? null,
    }));
}
