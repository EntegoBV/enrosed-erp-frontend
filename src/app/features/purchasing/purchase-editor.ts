import { bankAmountsMatch } from '../../shared/bank-transaction-options';
import { TEMPORARY_DELETION_NOTICE } from '../../shared/deleted-item-notice';
import { PurchaseSalesLinks } from './purchase-sales-links';
import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
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
import { purchaseNacalcSummary } from './purchase-payment-result-metrics';
import { PurchasePaymentSheet, type PurchasePaymentDraft } from './purchase-payment-sheet';
import { splitTransfer } from './purchase-transfer-split';
import { invoiceDocumentKind, paymentRoundOnServer, primaryInvoice } from './purchase-invoices';
import { inspectionSplitEur, pendingLinkPlan } from './purchase-payment-links';
import { PurchaseInvoiceSheet, type InvoiceSheetAction, type InvoiceSheetSubmit } from './purchase-invoice-sheet';
import type { InvoiceRequest } from './purchase-payment-workbench';
import { bankTransactionDay } from '../../shared/bank-transaction-options';
import { BankAccountsStore } from '../../core/api/bank-accounts';
import { BankingApi, type BankMovementRequest, type BankStatementLine } from '../../core/api/banking-api';
import { bankMarker, lineMarkers } from '../finance/bank-markers';
import { clearanceSuggestion } from '../finance/vat-return';
import { defaultBankAccount, readPayToBank, writePayToBank } from '../finance/pay-to-bank-preference';
import { receiptInstant, receiptLocalParts } from '../../shared/received-at';
import { PurchaseSettleSheet } from './purchase-settle-sheet';
import { PurchaseFirstInstalmentSheet } from './purchase-first-instalment-sheet';
import { ContextMenu } from '../../shared/context-menu';
import { PurchasePaymentPlanSheet } from './purchase-payment-plan-sheet';
import { PaymentProofPicker } from '../../shared/payment-proof-picker';
import { parsePurchasePaymentAmount, purchasePaymentOverage } from './purchase-payment-amount';
import {
  PAYEE_LABEL, SUPPLIER_CREDIT_REASON_LABEL, creditOffsetTargets, paymentOptionParts, purchaseCif, purchasePaymentLedger, settleCarriers, type Due,
  type LedgerPart, type PurchasePaymentAction, type PurchaseSettleRequest, type SupplierCreditAction,
} from './purchase-payment-ledger';
import { PurchaseSupplierCreditSheet, type SupplierCreditSheetAction, type SupplierCreditSubmit } from './purchase-supplier-credit-sheet';
import { formatEur, payeeMenuItems, paymentsNavLabel } from './purchase-payment-menus';
import { PurchasePartnerSheet } from './purchase-partner-sheet';
import {
  Allocation, Category, Clearance, Currency, DocumentKind, FreightRate, OtherCost, PAYMENT_TERMS, PartnerFinancing, Payee, Product, ProductFamily, PurchaseDocument, PurchaseInvoice, PurchaseOrder,
  PurchaseOrderLine, PurchaseOrderView, PurchasePayment, PurchasePaymentWrite, PurchaseSupplierCredit, ReceivedLine, Supplier, StockLocation, SalesOrderView, Customer,
} from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { PurchaseQuoteSheet, PurchaseQuoteLine } from './purchase-quote-sheet';
import { FilePicker } from '../../shared/file-picker';
import { MediaApi } from '../../core/api/media-api';
import { MediaAssetSummary } from '../../core/api/media-models';
import { Diary } from './diary';
import { ProductDraft } from '../../shared/product-picker';
import { ProductPicker } from '../../shared/product-picker';
import { DateField } from '../../shared/date-field';
import { Skeleton } from '../../shared/skeleton';
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
import { statusBackOptions, type StatusBackSheetState, type StatusBackTarget } from './purchase-status-back';
import { PurchasePdfSheet } from './purchase-pdf-sheet';
import { PurchaseActivity } from '../activity/purchase-activity';
import { receiptLineMetrics, receiptMetrics } from '../analyses/receipt-metrics';
import { cartonQuantityNotice } from '../../shared/carton-quantity-notice';
import { productSalesUnit } from '../products/product-sales-unit';
import { latestOwnFreightQuote, purchaseFxDefaults, purchaseFxReference } from './purchase-price-context';
import { purchaseLineSections } from './purchase-product-line-groups';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { containerName } from './container-name';

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
  imports: [PurchaseSalesLinks, Skeleton, PurchaseQuoteSheet, PurchaseExtraSplit, PurchasePartnerPanel, PurchasePartnerPayments, PurchasePaymentOverview, PurchaseNacalcOverview, PurchasePaymentSheet, PurchaseInvoiceSheet, PurchaseSettleSheet, PurchaseSupplierCreditSheet, PurchaseFirstInstalmentSheet, ContextMenu, PurchasePaymentPlanSheet, PaymentProofPicker, PurchasePartnerSheet, AuctionSettlementSheet, FormsModule, RouterLink, PageHeader, Diary, ProductPicker, DateField, Sheet, AuthImage,
            SupplierAddress, PurchaseOrderedSuccess, PurchaseStatusSuccess, PurchaseStatusBackSheet,
            PurchasePdfSheet, PurchaseActivity, EurPipe, EurUpPipe, NumUpPipe, CurPipe, NumPipe, PctPipe, CbmPipe, DateNlPipe, FilePicker],
  template: `
    @if (view(); as data) {
      <app-page-header [title]="data.order.number"
                       [subtitle]="data.order.alias ? data.order.alias + ' · ' + supplierName() : supplierName()"
                       [showBack]="true" [showBell]="false"
                       [titleEditable]="true"
                       (titleChange)="patch({ number: $event })">
        <button class="btn btn--sm pdf-header-button" type="button" (click)="pdfOpen.set(true)"
                [attr.aria-label]="'Download ' + data.order.number + ' als PDF'">
          PDF
        </button>
        @if (dirty()) {
          <button class="btn btn--primary btn--sm" type="button"
                  [disabled]="saving() || negativeExtra()" (click)="save()">
            {{ saving() ? 'Bezig…' : 'Opslaan' }}
          </button>
        } @else if (nextStep(); as step) {
          <button class="btn btn--primary btn--sm" type="button" (click)="advanceStatus()">
            {{ step.action }}
          </button>
        } @else {
          <button class="btn btn--primary btn--sm" type="button" disabled>Opgeslagen</button>
        }
      </app-page-header>

      <div class="content po-page erp-workspace erp-workspace--purchase erp-workspace--edit">

        @if (isReceived()) {
          <div class="alert alert--info po-notice">
            <span class="alert__icon" aria-hidden="true">✓</span>
            <div>
              <b>Ontvangst gesloten.</b> De voorraad is bijgeboekt. Producten en aantallen
              staan vast; notities en kostengegevens kun je nog corrigeren.
            </div>
          </div>
        }

        <section class="po-overview erp-workspace__hero" id="purchase-overview"
                 aria-labelledby="po-overview-title" tabindex="-1">
          <div class="po-overview__top">
            <div class="po-overview__copy">
              <span class="po-eyebrow">Inkoopcontainer</span>
              <h1 id="po-overview-title">{{ supplierName() }}</h1>
              <p>
                {{ data.order.orderDate | dateNl }}
                @if (data.order.alias) { <span aria-hidden="true"> · </span>{{ data.order.alias }} }
                <span aria-hidden="true"> · </span>gemaakt door {{ creatorName(data) }}
                @if (!data.order.clearance) { <span aria-hidden="true"> · </span>inklaring te bevestigen }
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
                   [class.stepper__step--done]="stepIndex(data.order.status) >= $index"
                   [class.stepper__step--arrived]="step.value === 'ONTVANGEN' && data.order.status === 'ONTVANGEN'"
                   [class.stepper__step--now]="stepIndex(data.order.status) === $index">
                <span class="stepper__dot" aria-hidden="true">
                  @if (stepIndex(data.order.status) >= $index) { ✓ } @else { {{ $index + 1 }} }
                </span>
                <span class="stepper__label">{{ step.label }}</span>
              </div>
              @if (!last) {
                <span class="stepper__line"
                      [class.stepper__line--done]="stepIndex(data.order.status) > $index"
                      [class.stepper__line--half]="stepIndex(data.order.status) === $index"></span>
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
                <strong [class.fill-pct--full]="fill.overflowCbm <= 0 && fill.fillPercent >= 97"
                        [class.fill-pct--over]="fill.fillPercent > 100 && fill.fillPercent <= 105"
                        [class.fill-pct--danger]="fill.fillPercent > 105">{{ fill.fillPercent | num: 0 }}% · {{ data.costing.totals.pieces | num }} st</strong>
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

        <nav class="erp-workspace__nav purchase-editor__mobile-nav workflow-nav workflow-nav--wide" aria-label="Onderdelen van deze inkooporder">
          <button class="erp-workspace__nav-item workflow-nav__item" type="button"
                  [class.erp-workspace__nav-item--active]="workspaceSection() === 'purchase-order-section'"
                  [class.workflow-nav__active]="workspaceSection() === 'purchase-order-section'"
                  [attr.aria-current]="workspaceSection() === 'purchase-order-section' ? 'location' : null"
                  (click)="jumpToSection('purchase-order-section', 'order')">
            <span class="workflow-nav__mark erp-workspace__nav-index" aria-hidden="true">1</span>
            <span class="workflow-nav__copy"><b>Order</b><small>{{ containerLabel(data.order.containerType) }}</small></span>
          </button>
          <button class="erp-workspace__nav-item workflow-nav__item" type="button"
                  [class.erp-workspace__nav-item--active]="workspaceSection() === 'purchase-products-section'"
                  [class.workflow-nav__active]="workspaceSection() === 'purchase-products-section'"
                  [attr.aria-current]="workspaceSection() === 'purchase-products-section' ? 'location' : null"
                  (click)="jumpToSection('purchase-products-section')">
            <span class="workflow-nav__mark erp-workspace__nav-index" aria-hidden="true">2</span>
            <span class="workflow-nav__copy"><b>Producten</b><small>{{ data.costing.lines.length }} regels</small></span>
          </button>
          <button class="erp-workspace__nav-item workflow-nav__item" type="button"
                  [class.erp-workspace__nav-item--active]="workspaceSection() === 'purchase-costs-section'"
                  [class.workflow-nav__active]="workspaceSection() === 'purchase-costs-section'"
                  [attr.aria-current]="workspaceSection() === 'purchase-costs-section' ? 'location' : null"
                  (click)="jumpToSection('purchase-costs-section', 'costs')">
            <span class="workflow-nav__mark erp-workspace__nav-index" aria-hidden="true">3</span>
            <span class="workflow-nav__copy"><b>Kosten</b><small>{{ data.costing.totals.totalEur | eur }}</small></span>
          </button>
          <button class="erp-workspace__nav-item workflow-nav__item" type="button"
                  [class.erp-workspace__nav-item--active]="workspaceSection() === 'purchase-payments-section'"
                  [class.workflow-nav__active]="workspaceSection() === 'purchase-payments-section'"
                  [attr.aria-current]="workspaceSection() === 'purchase-payments-section' ? 'location' : null"
                  (click)="jumpToSection('purchase-payments-section')">
            <span class="workflow-nav__mark erp-workspace__nav-index" aria-hidden="true">4</span>
            <span class="workflow-nav__copy"><b>Betalingen</b><small>{{ paymentNavLabel() }}</small></span>
          </button>
          <button class="erp-workspace__nav-item workflow-nav__item" type="button"
                  [class.erp-workspace__nav-item--active]="workspaceSection() === 'purchase-files-section'"
                  [class.workflow-nav__active]="workspaceSection() === 'purchase-files-section'"
                  [attr.aria-current]="workspaceSection() === 'purchase-files-section' ? 'location' : null"
                  (click)="jumpToSection('purchase-files-section')">
            <span class="workflow-nav__mark erp-workspace__nav-index" aria-hidden="true">5</span>
            <span class="workflow-nav__copy"><b>Dossier</b><small>{{ (documents() ?? []).length }} bestanden</small></span>
          </button>
          <button class="erp-workspace__nav-item erp-workspace__nav-item--action workflow-nav__item" type="button"
                  [class.erp-workspace__nav-item--active]="workspaceSection() === 'purchase-actions-section'"
                  [class.workflow-nav__active]="workspaceSection() === 'purchase-actions-section'"
                  [attr.aria-current]="workspaceSection() === 'purchase-actions-section' ? 'location' : null"
                  (click)="jumpToSection('purchase-actions-section')">
            <span class="workflow-nav__mark erp-workspace__nav-index" aria-hidden="true">6</span>
            <span class="workflow-nav__copy"><b>Volgende stap</b><small>{{ nextStep()?.action || 'Afgerond' }}</small></span>
          </button>
        </nav>

        <div class="purchase-grid erp-workspace__layout"
             [attr.data-phone-step]="phoneStep()">
          <main class="purchase-main erp-workspace__main">
            <section class="card flow-card erp-workspace__section" id="purchase-order-section"
                     tabindex="-1">
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
                    } @else {
                      <div class="field">
                        <label for="po-received">Ontvangen op</label>
                        <app-date-field fieldId="po-received" [value]="data.order.receivedOn ?? ''"
                                        (valueChange)="$event && patch({ receivedOn: $event })" />
                        <span class="hint">Corrigeer als de container op een andere dag binnenkwam.</span>
                      </div>
                    }
                    <div class="field">
                      <label for="po-terms">Betaalplan</label>
                      <button class="btn purchase-payment-plan-trigger" id="po-terms" type="button" [disabled]="saving() || payingBusy() || paymentPlanBusy()" (click)="openPaymentPlan()">{{ planLabel(data.order) }} <span>Wijzigen</span></button>
                      <span class="hint">Bij Betalingen (stap 4) zie je per termijn wat open staat.</span>
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
                    <!-- What the container means for the VAT return (vat-return.ts): the
                         purchase alone, an acquisition or import VAT. A suggestion follows
                         the port until it is confirmed here. -->
                    <div class="field">
                      <label for="po-clearance">Inklaring</label>
                      <select class="select" id="po-clearance"
                              [ngModel]="data.order.clearance ?? ''"
                              (ngModelChange)="patch({ clearance: $event || null })">
                        <option value="">Voorstel: {{ suggestedClearanceLabel(data.order.destinationPort) }}</option>
                        @for (option of clearanceOptions; track option.value) {
                          <option [value]="option.value">{{ option.label }}</option>
                        }
                      </select>
                      <span class="hint">Bepaalt de btw-aangifte. In Nederland klaart de fiscaal vertegenwoordiger in. Blijft daar en wordt daar verkocht (btw verlegd naar de klant): alleen de aankoop, rooster 81. Via Nederland naar ons in België: ook 86/55/59. Inklaring in België: 81 en de invoer-btw.</span>
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
                    <div class="field">
                      <span class="label">Prijsbasis en munt van de leverancier</span>
                      <div class="fin-chips po-basis" role="group" aria-label="Prijsbasis en munt">
                        <button type="button" class="fin-chip" [class.on]="!isDdp() && !isCif()" (click)="setOrderBasis('EXW')">EXW</button>
                        <button type="button" class="fin-chip" [class.on]="isCif()" (click)="setOrderBasis('CIF')">CIF</button>
                        <button type="button" class="fin-chip" [class.on]="isDdp()" (click)="setOrderBasis('DDP')">DDP</button>
                        <span class="po-basis__sep" aria-hidden="true"></span>
                        <button type="button" class="fin-chip" [class.on]="orderCurrency() === 'USD'" (click)="setOrderCurrency('USD')">$ USD</button>
                        <button type="button" class="fin-chip" [class.on]="orderCurrency() === 'CNY'" (click)="setOrderCurrency('CNY')">¥ CNY</button>
                        <button type="button" class="fin-chip" [class.on]="orderCurrency() === 'EUR'" (click)="setOrderCurrency('EUR')">€ EUR</button>
                      </div>
                      <span class="hint">@if (isDdp()) { Geleverd incl. rechten, voor de hele container: zeevracht en invoerrechten stappen opzij. } @else if (isCif()) { CIF: de leverancier regelt en factureert zeevracht (en lokale kosten China); invoerrechten en lokale kosten aankomst via Douane &amp; transport. } @else { Af fabriek: wij regelen zeevracht, invoerrechten en transport. } De stukprijzen staan in {{ orderCurrency() }}.</span>
                    </div>
                  </div>
                </div>
              }
              <app-purchase-partner-panel [order]="data.order" [docs]="partnerDocs()" [advanceBasisEur]="data.costing.totals.totalWithSeparateCostsEur ?? null" [canQuote]="quoteLines().length > 0" [canAuction]="auctionLines().length > 0" (saved)="onPartnerSaved($event)" (quote)="quoteOpen.set(true)" (link)="partnerSheetOpen.set(true)" (auction)="auctionOpen.set(true)" (schedule)="jumpToSection('purchase-partner-section')" (unlink)="unlinkPartnerDoc($event)" />
            </section>

            <section class="card flow-card products-card erp-workspace__section"
                     id="purchase-products-section" tabindex="-1"
                     aria-labelledby="purchase-products-title">
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
                @if (data.costing.lines.length) {
                  @for (section of lineSections(); track section.key) {
                    <section class="po-line-section"
                             [attr.aria-labelledby]="'purchase-line-category-' + section.key">
                      <header class="po-line-section__head">
                        <h3 [id]="'purchase-line-category-' + section.key">{{ section.label }}</h3>
                        <span>{{ section.lines.length }} product{{ section.lines.length === 1 ? '' : 'en' }}</span>
                      </header>
                  @for (familyGroup of section.families; track familyGroup.key) {
                  <section class="po-family"
                           [attr.aria-labelledby]="'purchase-line-family-' + familyGroup.key">
                    <header class="po-family__head">
                      <span class="po-family__identity">
                        <small>{{ familyGroup.familyId === null ? 'Los product' : 'Productreeks' }}</small>
                        <strong [id]="'purchase-line-family-' + familyGroup.key">{{ familyGroup.label }}</strong>
                        @if (familyGroup.swatches.length) {
                          <span class="po-family__swatches"
                                [attr.aria-label]="'Kleuren in ' + familyGroup.label">
                            @for (swatch of familyGroup.swatches; track swatch.key) {
                              <i class="line-colour-dot"
                                 [class.line-colour-dot--empty]="!colourHex(swatch.hex, swatch.label)"
                                 [style.background]="colourHex(swatch.hex, swatch.label) || 'transparent'"
                                 [title]="swatch.label"></i>
                            }
                          </span>
                        }
                      </span>
                      <span class="po-family__totals">
                        <strong>{{ familyGroup.lines.length }}
                          {{ familyGroup.lines.length === 1 ? 'variant' : 'varianten' }}</strong>
                        <small>{{ familyGroup.pieces | num }} st · {{ familyGroup.cartons | num }} dozen ·
                          {{ familyGroup.cbm | cbm }}</small>
                        <small class="po-family__cost-label">
                          {{ perPiece() ? 'Gem. geland / stuk' : 'Totaal geland' }}
                        </small>
                        <b>{{ perPiece()
                          ? (familyGroup.averageUnitEur | eurUp: 3)
                          : (familyGroup.totalEur | eur) }}</b>
                      </span>
                    </header>
                    <div class="po-family__variants">
                  @for (line of familyGroup.lines; track line.productId) {
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
                          <span class="po-line__index" aria-hidden="true">{{ purchaseLineNumber(line.productId) }}</span>
                        }
                        <span class="po-line__identity">
                          <strong>{{ line.productName }}</strong>
                          @if (productVariantLabel(line.productId); as variant) {
                            <span class="po-line__variant">
                              @if (productColour(line.productId)) {
                                <i class="line-colour-dot"
                                   [class.line-colour-dot--empty]="!productColourHex(line.productId)"
                                   [style.background]="productColourHex(line.productId) || 'transparent'"
                                   aria-hidden="true"></i>
                              }
                              {{ variant }}
                            </span>
                          }
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
                               [disabled]="isReceived()" [ngModel]="quantityValue(line.productId, line.quantity)"
                               (ngModelChange)="typeQuantity(line.productId, $event)"
                               (blur)="leaveQuantity(line.productId)" />
                        @if (!isReceived()) {
                          @if (cartonNotice(draftQuantity(line.productId, line.quantity), line.productId); as cartonNote) {
                            <span class="hint carton-quantity-note" role="status">{{ cartonNote }}</span>
                          }
                        }
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
                        <label [attr.for]="'exw-' + line.productId">Afgesproken prijs per stuk <span class="opt">{{ isDdp() ? 'DDP' : 'EXW' }}</span></label>
                        <div class="input-affix input-affix--prefixed">
                          <span class="input-affix__prefix" aria-hidden="true">{{ currencySymbol(effectiveExwCurrency(line.productId)) }}</span>
                          <input class="input num right" [id]="'exw-' + line.productId"
                                 type="number" min="0" step="0.01" inputmode="decimal"
                                 [attr.aria-label]="'Prijs per stuk in ' + effectiveExwCurrency(line.productId)"
                                 [ngModel]="orderLine(line.productId)?.exwPrice"
                                 [placeholder]="line.quantity
                                   ? (line.goodsUsd / line.quantity | numUp: 3) : ''"
                                 (ngModelChange)="setExwPrice(line.productId, $event)" />
                        </div>
                      </div>
                    </div>

                    <details class="line-breakdown">
                      <summary>
                        <span class="line-breakdown__label">
                          <span>Kostopbouw</span>
                          <small>{{ perPiece() ? 'geland per stuk' : 'geland totaal' }}</small>
                        </span>
                        <span class="line-breakdown__value">
                          <strong class="line-breakdown__total">
                            {{ perPiece() ? (line.landedUnitEur | eurUp: 3)
                              : (line.totalEur | eur) }}
                          </strong>
                          <svg class="line-breakdown__chevron" viewBox="0 0 20 20"
                               width="18" height="18" aria-hidden="true">
                            <path d="m6.5 8 3.5 3.5L13.5 8" fill="none"
                                  stroke="currentColor" stroke-width="1.8"
                                  stroke-linecap="round" stroke-linejoin="round" />
                          </svg>
                        </span>
                      </summary>
                      <div class="line-breakdown__body">
                        <div class="line-breakdown__mode">
                          <span class="per-toggle line-breakdown__toggle" role="group" aria-label="Kostopbouw tonen als">
                            <button type="button" [class.on]="!perPiece()" [attr.aria-pressed]="!perPiece()" (click)="perPiece.set(false)">Totaal</button>
                            <button type="button" [class.on]="perPiece()" [attr.aria-pressed]="perPiece()" (click)="perPiece.set(true)">Per stuk</button>
                          </span>
                        </div>
                        <div class="stat-row stat-row--muted">
                          <span>Goederen</span>
                          <span class="num">{{ amt(line.goodsEur, line) | eurUp: decimals() }}</span>
                        </div>
                        @if (line.originEur) {
                          <div class="stat-row stat-row--muted">
                            <span>{{ costLabels().originCostsLabel }}
                              <small>{{ costLabels().originRoute }}</small>
                            </span>
                            <span class="num">{{ amt(line.originEur, line) | eurUp: decimals() }}</span>
                          </div>
                        }
                        <div class="stat-row stat-row--muted">
                          <span>{{ costLabels().seaFreightLabel }}
                            <small>{{ costLabels().seaFreightRoute }}</small>
                          </span>
                          <span class="num">{{ amt(line.freightEur, line) | eurUp: decimals() }}</span>
                        </div>
                        <div class="stat-row stat-row--muted line-divider">
                          <span>Douanewaarde</span>
                          <span class="num">{{ amt(line.customsValueEur, line) | eurUp: decimals() }}</span>
                        </div>
                        <div class="stat-row stat-row--muted">
                          <span>Invoerrecht {{ line.dutyRatePct | pct: 1 }}
                            <span class="tiny">({{ line.dutySource }})</span>
                          </span>
                          <span class="num">{{ amt(line.dutyEur, line) | eurUp: decimals() }}</span>
                        </div>
                        <div class="stat-row stat-row--muted">
                          <span>{{ costLabels().destinationCostsLabel }}</span>
                          <span class="num">{{ amt(line.destinationEur, line) | eurUp: decimals() }}</span>
                        </div>
                        @if (line.extraRevenueEur) {
                          <div class="stat-row stat-row--muted">
                            <span>
                              Enrosed kost
                              <small>{{ perPiece() ? 'per stuk' : 'hele regel' }}</small>
                            </span>
                            <span class="num">
                              {{ amt(line.extraRevenueEur, line) | eurUp: decimals() }}
                            </span>
                          </div>
                        }
                      </div>
                    </details>
                  </article>
                  }
                    </div>
                  </section>
                  }
                    </section>
                  }
                } @else {
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

            <section class="card flow-card erp-workspace__section" id="purchase-costs-section"
                     tabindex="-1">
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
                        @if (marketRates(); as market) {
                          <span class="hint hint--market">ECB {{ marketReference()!.cnyToUsd | num: 4 }} · met {{ market.marginPct }} % marge {{ market.cnyToUsd | num: 4 }}@if (data.order.cnyToUsd !== market.cnyToUsd) { · <button class="linklike" type="button" (click)="patch({ cnyToUsd: market.cnyToUsd })">overnemen</button> }</span>
                        }
                      </div>
                      <div class="field">
                        <label for="r-usd">USD naar EUR</label>
                        <input class="input num right" id="r-usd" type="number"
                               step="0.0001" inputmode="decimal"
                               [ngModel]="usdToEurRate()"
                               (ngModelChange)="setUsdToEur(+$event)" />
                        @if (marketRates(); as market) {
                          <span class="hint hint--market">ECB {{ marketReference()!.usdToEur | num: 4 }} · met {{ market.marginPct }} % marge {{ market.usdToEur | num: 4 }}@if (usdToEurRate() !== market.usdToEur) { · <button class="linklike" type="button" (click)="setUsdToEur(market.usdToEur)">overnemen</button> }</span>
                        }
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
                        <span class="hint">
                          {{ costLabels().seaFreightRoute }}
                          @if (isCif()) {
                            · betaald aan de leverancier (CIF)
                          } @else if (latestFreightReference(); as reference) {
                            · laatste eigen notering:
                            <b>{{ reference.usdPerContainer | cur: 'USD' }}</b>
                            · {{ reference.quotedOn | dateNl }}
                          } @else if (data.order.containerType === 'TWENTY_GP') {
                            · vul een eigen 20 ft-offerte in; een 40 ft-notering wordt niet hergebruikt
                          }
                        </span>
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
                      <!-- Our own costs side by side: the Enrosed kost goes into the piece
                           price, the inspection stays a line of its own. -->
                      <div class="field-duo span-2">
                        <div class="field">
                          <label for="c-extra">Enrosed kost <span class="opt"></span></label>
                          <div class="input-affix">
                            <input class="input num right" id="c-extra" type="number"
                                   step="100" min="0" inputmode="decimal"
                                   [ngModel]="data.order.extraRevenueEur"
                                   (ngModelChange)="patch({ extraRevenueEur: +$event })" />
                            <span class="input-affix__suffix">EUR</span>
                          </div>
                          <span class="hint">In de stukprijs · {{ manualExtra() ? 'zelf verdeeld per product' : 'verdeeld ' + allocationLabel(data.order.allocExtra) }}@if (!manualExtra()) { · <button class="linklike" type="button" (click)="openManualSplit()">zelf verdelen per product</button> }</span>

                        </div>
                        <div class="field">
                          <label for="c-inspection">Inspectiekost <span class="opt"></span></label>
                          <div class="input-affix">
                            <input class="input num right" id="c-inspection" type="number"
                                   step="50" min="0" inputmode="decimal"
                                   [ngModel]="data.order.inspectionCostEur"
                                   (ngModelChange)="patch({ inspectionCostEur: $event === '' || $event === null ? null : +$event })" />
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
                      <div class="other-costs span-2" aria-label="Andere kosten">
                        @for (cost of data.order.otherCosts ?? []; track $index; let i = $index) {
                          <div class="other-cost">
                            <input class="input" type="text" maxlength="60"
                                   placeholder="Naam, bv. certificaat"
                                   [attr.aria-label]="'Naam andere kost ' + (i + 1)"
                                   [ngModel]="cost.label"
                                   (ngModelChange)="setOtherCost(i, { label: $event })" />
                            <div class="input-affix">
                              <input class="input num right" type="number"
                                     step="50" min="0" inputmode="decimal"
                                     [attr.aria-label]="'Bedrag andere kost ' + (i + 1)"
                                     [ngModel]="cost.amountEur"
                                     (ngModelChange)="setOtherCost(i, { amountEur: $event === '' || $event === null ? null : +$event })" />
                              <span class="input-affix__suffix">EUR</span>
                            </div>
                            <button class="other-cost__remove" type="button"
                                    [attr.aria-label]="'Verwijder ' + (cost.label || 'andere kost')"
                                    (click)="removeOtherCost(i)">×</button>
                          </div>
                        }
                        <button class="other-costs__add" type="button" (click)="addOtherCost()">
                          <span aria-hidden="true">+</span>
                          <b>Andere kost</b>
                          <small>certificaat, labo, staal … {{ separateInPiece() ? 'in de stukprijs verdeeld' : 'apart, achteraf' }}</small>
                        </button>
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
                            @if (key.field === 'allocSeparate') { <option value="SEPARATE">Achteraf, apart van de stukprijs</option> }
                            <option value="CBM">Naar volume (m³)</option>
                            <option value="VALUE">Naar goederenwaarde</option>
                            <option value="PIECES">Naar aantal stuks</option>
                            @if (key.field === 'allocExtra') { <option value="MANUAL">Zelf per product</option> }
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

          <aside class="purchase-summary erp-workspace__sidebar" aria-label="Containersamenvatting">
            <section class="card summary-card erp-workspace__section" id="purchase-summary-section"
                     tabindex="-1">
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
                      <strong [class.fill-pct--full]="fill.overflowCbm <= 0 && fill.fillPercent >= 97"
                              [class.fill-pct--over]="fill.fillPercent > 100 && fill.fillPercent <= 105"
                              [class.fill-pct--danger]="fill.fillPercent > 105">{{ fill.fillPercent | num: 0 }}%</strong>
                    </div>
                    <span>{{ fill.usedCbm | cbm }} van {{ fill.capacityCbm }} m³</span>
                  </div>
                  <div class="meter__track fill-meter"
                       role="meter" aria-label="Containervulling"
                       aria-valuemin="0" aria-valuemax="100"
                       [attr.aria-valuenow]="fill.fillPercent">
                    <div class="meter__fill"
                         [class.meter__fill--warn]="fill.fillPercent > 100 && fill.fillPercent <= 105"
                         [class.meter__fill--danger]="fill.fillPercent > 105"
                         [class.meter__fill--full]="fill.overflowCbm <= 0 && fill.fillPercent >= 97"
                         [style.width.%]="fill.fillPercent > 100 ? 100 : fill.fillPercent"></div>
                  </div>
                  @if (fill.fillPercent > 105) {
                    <div class="alert alert--danger capacity-alert">
                      <span class="alert__icon" aria-hidden="true">!</span>
                      <div>
                        <b>{{ fill.fillPercent | num: 0 }}%</b> · te vol voor één {{ containerLabel(data.order.containerType) }}:
                        <b>{{ fill.overflowCbm | cbm }} te veel</b>.
                        Op basis van volume zijn minimaal <b>{{ containerCountForFill(fill) }} containers</b> nodig;
                        splits de order of kies een groter type.
                      </div>
                    </div>
                  } @else if (fill.fillPercent > 100) {
                    <!-- Just over the line: often still loadable with clever stacking. -->
                    <div class="alert capacity-alert capacity-alert--tight">
                      <span class="alert__icon" aria-hidden="true">!</span>
                      <div>
                        <b>{{ fill.fillPercent | num: 0 }}%</b> · {{ fill.overflowCbm | cbm }} boven de {{ containerLabel(data.order.containerType) }}.
                        Vaak past dit nog net; reken niet op meer.
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
                  @if (data.costing.totals.separateCostsEur) {
                    <div class="cost-summary__group">
                      <span class="cost-section">In de stukprijs verdeeld</span>
                      @if (data.costing.totals.inspectionEur) {
                        <div class="stat-row">
                          <span>Inspectie</span>
                          <span class="num">{{ data.costing.totals.inspectionEur | eur }}</span>
                        </div>
                      }
                      @for (cost of data.costing.totals.otherCosts ?? []; track $index) {
                        <div class="stat-row">
                          <span>{{ cost.label }}</span>
                          <span class="num">{{ cost.amountEur | eur }}</span>
                        </div>
                      }
                      <div class="stat-row cost-summary__subtotal">
                        <span>{{ separateCostsTotalLabel(data.costing.totals) }}</span>
                        <span class="num">{{ data.costing.totals.totalWithSeparateCostsEur | eur }}</span>
                      </div>
                    </div>
                  }

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

            <!-- Nacalculatie: what the container really cost, under Kosten. Every action goes through the editor's sheets. -->
            <section class="card erp-workspace__section purchase-result-card" id="purchase-result-section" tabindex="-1" aria-label="Nacalculatie">
              <span class="section-kicker">Nacalculatie</span>
              <app-purchase-nacalc-overview mode="edit" [view]="data" [ledger]="paymentLedger()" [nacalc]="nacalc()" [partner]="partnerFinancing()"
                [state]="paymentState()" [error]="paymentStateError()" [dirty]="dirty()" [busy]="payingBusy() || saving() || paymentStateLoading() || payments() === null"
                [orderId]="data.order.id"
                (openPayee)="openPayee($event)" (pay)="requestPayment($event)" (settle)="requestSettle($event)"
                (openPayments)="jumpToSection('purchase-payments-section')" (openPartner)="jumpToSection('purchase-partner-section')"
                (openReports)="jumpToSection('purchase-files-section')" (applyCosts)="jumpToSection('purchase-actions-section')"
                (refresh)="refreshPaymentState(); reloadPartnerFinancing()" (refreshPartner)="reloadPartnerFinancing()" (credit)="requestCredit($event)" />
            </section>

            <!-- Money out, per payee: the supplier for the goods in its planned
                 terms, the forwarder and customs, the inspection and other named
                 costs, and the bijkomende kosten of paying. The Enrosed kost is
                 ours and nobody's invoice. -->
            <section class="card erp-workspace__section purchase-payments-plain"
                     id="purchase-payments-section" tabindex="-1"
                     aria-labelledby="purchase-payments-title">
              <app-purchase-payment-overview mode="edit" [ledger]="paymentLedger()" [state]="paymentState()" [error]="paymentStateError()"
                [busy]="payingBusy() || saving() || paymentStateLoading() || payments() === null" [dirty]="dirty()" [nacalc]="nacalcSummary()"
                [planLabel]="planLabel(data.order)" [supplierName]="supplierName()" [roundOnServer]="roundOnServer()" [bankLineLabel]="bankLineLabel"
                (add)="requestPayment($event)" (edit)="requestEdit($event)" (download)="downloadDocument($event)"
                (settle)="requestSettle($event)" (undoSettle)="requestUndoSettle($event.payee, $event.due)" (planChange)="openPaymentPlan()"
                (remove)="requestRemove($event)" (save)="save()" (refresh)="refreshPaymentState()" (openCosts)="jumpToSection('purchase-result-section')"
                (credit)="requestCredit($event)" (invoice)="requestInvoice($event)" (invoiceFile)="openDocumentFile($event)"
                (inspectionVia)="setInspectionVia($event)" />
            </section>

            <!-- Money in: a partner who co-finances the container. -->
            @if (data.order.partnerCustomerId != null) {
              <section class="erp-workspace__section purchase-partner-card" id="purchase-partner-section" tabindex="-1" aria-label="Partnerfinanciering">
                <app-purchase-partner-payments (quote)="quoteOpen.set(true)" (changed)="onPartnerLinked()" [order]="data.order" [docs]="partnerDocs()" [advanceBasisEur]="data.costing.totals.totalWithSeparateCostsEur ?? null" />
              </section>
            }

            <!-- The container's diary: agreements, then the receipt, the
                 booking and every payment write themselves in here. -->
            <section class="card note-card erp-workspace__section erp-workspace__support-card"
                     id="purchase-notes-section" tabindex="-1"
                     aria-labelledby="purchase-note-title">
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
            <section class="card files-card erp-workspace__section erp-workspace__support-card"
                     id="purchase-files-section" tabindex="-1"
                     aria-labelledby="purchase-files-title">
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
                        @if (renamingDoc()?.id === doc.id) {
                          <input class="input input--sm files-list__rename" type="text" enterkeyhint="done"
                                 placeholder="Titel, bijv. KBC mei" [ngModel]="renamingDoc()!.label"
                                 (ngModelChange)="renamingDoc.set({ id: doc.id, label: $event })"
                                 (keydown.enter)="commitDocRename(doc)" (keydown.escape)="renamingDoc.set(null)"
                                 (blur)="commitDocRename(doc)" />
                        } @else {
                          <span class="files-list__name">
                            <b>{{ doc.kindLabel }}{{ doc.label ? ' · ' + doc.label : '' }}</b>
                            <small>{{ doc.originalFilename }} · {{ sizeLabel(doc.sizeBytes) }} · {{ doc.addedAt | dateNl }}@if (doc.actor) { · {{ actorLabel(doc.actor) }} }</small>
                          </span>
                        }
                        <span class="files-list__actions">
                          <!-- The title stays editable after the upload. -->
                          <button class="files-list__pencil" type="button" title="Titel aanpassen"
                                  [attr.aria-label]="'Titel aanpassen van ' + doc.originalFilename"
                                  (click)="renamingDoc.set({ id: doc.id, label: doc.label ?? '' })">
                            <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                              <path d="M4 20h4l10-10-4-4L4 16v4z" /><path d="m13 7 4 4" />
                            </svg>
                          </button>
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
              <div class="files-card__links"><app-purchase-sales-links [documents]="relatedSalesDocs()" [excludePartner]="data.order.partnerCustomerId != null" /></div>
            </section>

            <app-purchase-activity class="purchase-activity-step"
                                   [orderId]="data.order.id" [collapsible]="true" />

            <section class="card action-card erp-workspace__section erp-workspace__priority-card"
                     id="purchase-actions-section" tabindex="-1"
                     aria-labelledby="purchase-actions-title">
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
                <button class="btn btn--block" type="button" [disabled]="!quoteLines().length" (click)="quoteOpen.set(true)">
                  {{ data.order.partnerCustomerId ? 'Conceptvoorschotfacturen maken' : 'Verkoopofferte maken' }}
                </button>
              </div>

              @if (!isReceived()) {
                <details class="danger-zone">
                  <summary>Meer acties</summary>
                  <div>
                    @if (data.order.status === 'BESTELD' || data.order.status === 'ONDERWEG') {
                      <!-- A status set by mistake goes back here; the sheet names what changes. -->
                      <button class="btn btn--block mb-8" type="button" [disabled]="stepBackBusy()" (click)="openStepBack()">
                        Status terugzetten…
                      </button>
                    }
                    <p>Tijdelijk verwijderen. Herstellen kan via Instellingen → Beheer → Verwijderde items.</p>
                    <button class="btn btn--danger btn--block" type="button"
                            [disabled]="deletingOrder() || saving()" (click)="remove()">
                      {{ deletingOrder() ? 'Verwijderen…' : 'Calculatie verwijderen' }}
                    </button>
                  </div>
                </details>
              }
            </section>
          </aside>
        </div>
      </div>

      @if (!desktop.active()) {
        <nav class="purchase-mobile-dock erp-workspace__mobile-dock"
             aria-label="Inkooporder navigatie en acties">
          <!-- A hairline along the top edge: how full the container is while
               you are composing it, without stealing room from the buttons. -->
          @if (phoneStep() === 1 && !isDdp() && data.costing.containerFill; as fill) {
            <div class="dock-fill" role="meter" aria-label="Containervulling"
                 aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="fill.fillPercent"
                 [class.dock-fill--full]="fill.overflowCbm <= 0 && fill.fillPercent >= 97"
                 [class.dock-fill--over]="fill.fillPercent > 100 && fill.fillPercent <= 105"
                 [class.dock-fill--danger]="fill.fillPercent > 105">
              <span class="dock-fill__label"><b>{{ fill.fillPercent | num: 0 }}%</b> · {{ fill.usedCbm | num: 1 }} van {{ fill.capacityCbm }} m³</span>
              <span class="dock-fill__track"><i [style.width.%]="fill.fillPercent > 100 ? 100 : fill.fillPercent"></i></span>
            </div>
          }
          @if (phoneStep() > 0) {
            <button class="purchase-mobile-dock__back" type="button"
                    (click)="previousPhoneStep()"
                    [attr.aria-label]="'Terug naar ' + phoneStepLabels[phoneStep() - 1]">‹</button>
          }
          <span class="purchase-mobile-dock__context">
            <small>Stap {{ phoneStep() + 1 }} van {{ phoneStepLabels.length }}</small>
            <strong>{{ phoneStepLabels[phoneStep()] }}</strong>
          </span>
          @if (phoneStep() === 3) {
            <button class="btn purchase-mobile-dock__pdf" type="button" aria-label="Betaling noteren"
                    [disabled]="payingBusy() || paymentStateLoading() || payments() === null" (click)="payeeMenuOpen.set(true)">＋ Betaling</button>
          } @else {
            <button class="btn purchase-mobile-dock__pdf" type="button"
                    (click)="pdfOpen.set(true)"
                    [attr.aria-label]="'Download ' + data.order.number + ' als PDF'">
              PDF
            </button>
          }
          <button class="btn purchase-mobile-dock__save" type="button"
                  [class.btn--primary]="dirty()"
                  [disabled]="saving() || !dirty() || negativeExtra()" (click)="save()">
            {{ saving() ? 'Opslaan…' : 'Opslaan' }}
          </button>
          @if (phoneStep() < phoneStepLabels.length - 1) {
            <button class="purchase-mobile-dock__next" type="button"
                    (click)="nextPhoneStep()"
                    [attr.aria-label]="'Volgende: ' + phoneStepLabels[phoneStep() + 1]">›</button>
          } @else if (!dirty() && nextStep(); as step) {
            <button class="btn btn--primary purchase-mobile-dock__primary" type="button"
                    (click)="advanceStatus()">
              {{ step.action }}
            </button>
          }
        </nav>
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
          [cif]="paymentCif()" [transferEur]="paymentTransferEur()" [bankLinked]="payingOnBank()" [bankAccount]="paymentBankAccount()" [today]="bankToday()"
          [roundOnServer]="roundOnServer()" [invoices]="data.invoices ?? []" [viaSupplier]="!!data.order.inspectionViaSupplier" [orderPayments]="payments() ?? []"
          [parts]="payingParts()" [proofFiles]="payingProofFiles()" [bankLines]="bankLines() ?? []"
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
                  @for (kind of documentKinds; track kind.value) { <option [value]="kind.value">{{ kind.label }}</option> }
                </select>
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
        <app-purchase-ordered-success [orderNumber]="data.order.number"
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
      @if (pdfOpen()) {
        <app-purchase-pdf-sheet [orderId]="data.order.id" [orderNumber]="data.order.number"
                                [dirty]="dirty()" [saving]="saving()"
                                [separateCosts]="hasSeparateCosts(data.order)"
                                (saveRequested)="save()" (closed)="pdfOpen.set(false)" />
      }
    } @else {
      <app-page-header title="Inkoop" subtitle="Inkooporder laden…"
                       [showBack]="true" [showBell]="false" />
      <div class="content po-page" role="status" aria-live="polite" aria-label="Inkooporder laden">
        <app-skeleton kind="card" [rows]="1" />
        <app-skeleton kind="stats" [rows]="3" />
        <app-skeleton kind="list" [rows]="4" />
      </div>
    }
  `,
  styles: [`

    .doc-source{display:flex;gap:8px}.doc-source .input{flex:1;min-width:0}
    :host{display:block;min-width:0}.po-page{max-width:1180px}.po-notice{margin-bottom:12px}
    .po-overview{position:relative;margin-bottom:14px;padding:16px;border:1px solid var(--rose-line);border-radius:22px;background:linear-gradient(145deg,var(--surface),var(--rose-soft));box-shadow:var(--sh-1);overflow:hidden}
    .po-overview:before{content:'';position:absolute;inset:0 auto 0 0;width:4px;background:var(--rose)}
    .po-overview__top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.po-overview__copy{min-width:0}
    :is(.po-eyebrow,.section-kicker){display:block;color:var(--rose);font-size:10px;font-weight:750;letter-spacing:.1em;text-transform:uppercase}
    .po-overview h1{margin-top:3px;overflow:hidden;font-size:22px;text-overflow:ellipsis;white-space:nowrap}.po-overview__copy p{color:var(--muted);font-size:12px}
    .po-status{display:flex;flex:none;align-items:center;gap:5px;padding:5px 8px;border:1px solid var(--rose-line);border-radius:99px;background:var(--surface);color:var(--rose-dark);font-size:11.5px;font-weight:700}
    .po-status__dot{width:7px;height:7px;border-radius:50%;background:currentColor}.po-status--done{color:var(--ok);border-color:#c6e5d5;background:var(--ok-soft)}.overview-stepper{margin:16px 0}
    .po-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;border:1px solid var(--line);border-radius:14px;background:var(--line);overflow:hidden}
    .po-fact--total strong{color:var(--rose-dark)}
    .fill-overview strong.fill-pct--full,.po-fact strong.fill-pct--full{color:var(--ok)}.fill-overview strong.fill-pct--over,.po-fact strong.fill-pct--over{color:var(--warn)}.fill-overview strong.fill-pct--danger,.po-fact strong.fill-pct--danger{color:var(--danger)}.meter__fill--danger{background:var(--danger)}.capacity-alert--tight{border:1px solid #eddcb9;background:var(--warn-soft);color:var(--ink-2)}.capacity-alert--tight .alert__icon{background:var(--warn);color:#fff}
    .po-fact{min-width:0;padding:9px 10px;background:var(--surface)}.po-fact__label{display:block;color:var(--muted);font-size:9.5px;text-transform:uppercase}.po-fact strong{display:block;overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}
    .purchase-mobile-dock{display:flex;align-items:center;gap:7px}.dock-fill{position:absolute;top:0;right:14px;left:14px;height:3px;pointer-events:none}.dock-fill__track{display:block;height:3px;overflow:hidden;border-radius:0 0 3px 3px;background:var(--line)}.dock-fill__track i{display:block;height:100%;border-radius:inherit;background:var(--rose);transition:width .2s ease}.dock-fill__label{position:absolute;top:-22px;right:0;padding:2px 8px;border:1px solid var(--line);border-radius:99px;background:rgb(255 255 255 / 90%);color:var(--muted);font-size:9.5px;font-weight:650;line-height:1.4;white-space:nowrap;box-shadow:0 2px 8px rgb(26 22 20 / 8%);backdrop-filter:blur(8px)}.dock-fill__label b{color:var(--rose-dark);font-weight:800}.dock-fill--full .dock-fill__track i{background:var(--ok)}.dock-fill--full .dock-fill__label b{color:var(--ok)}.dock-fill--over .dock-fill__track i{background:var(--warn)}.dock-fill--over .dock-fill__label b{color:var(--warn)}.dock-fill--danger .dock-fill__track i{background:var(--danger)}.dock-fill--danger .dock-fill__label b{color:var(--danger)}
    .purchase-mobile-dock__back,.purchase-mobile-dock__next{width:42px;height:42px;display:grid;flex:none;place-items:center;padding:0;border:0;border-radius:13px;background:var(--surface-2);color:var(--ink);font:inherit;font-size:23px;cursor:pointer}
    .purchase-mobile-dock__next{background:var(--ink);color:#fff}
    .purchase-mobile-dock__context{min-width:48px;display:grid;flex:1;line-height:1.15}
    .purchase-mobile-dock__context small{color:var(--muted);font-size:8.5px;font-weight:650;text-transform:uppercase}
    .purchase-mobile-dock__context strong{overflow:hidden;font-size:11.5px;text-overflow:ellipsis;white-space:nowrap}
    .purchase-mobile-dock .btn{min-height:42px;margin:0;padding-inline:10px}
    .purchase-mobile-dock__pdf{flex:none}
    .purchase-mobile-dock__save:disabled{opacity:.58}
    .purchase-mobile-dock__primary{flex:none}
    @media(max-width:390px){.purchase-mobile-dock__context{display:none}.purchase-mobile-dock__save,.purchase-mobile-dock__pdf{padding-inline:9px!important}.purchase-mobile-dock__save,.purchase-mobile-dock__primary{flex:1}}
    @media(max-width:679px){
      .pdf-header-button{display:none}
      .po-page{padding-bottom:calc(var(--tabbar-h) + var(--safe-b) + 128px)}
      .purchase-grid .erp-workspace__section,.purchase-grid .purchase-activity-step{display:none}
      .purchase-grid[data-phone-step="0"] #purchase-order-section,
      .purchase-grid[data-phone-step="1"] #purchase-products-section,
      .purchase-grid[data-phone-step="2"] #purchase-costs-section,
      .purchase-grid[data-phone-step="2"] #purchase-summary-section,
      .purchase-grid[data-phone-step="3"] #purchase-payments-section,
      .purchase-grid[data-phone-step="3"] #purchase-partner-section,
      .purchase-grid[data-phone-step="2"] #purchase-result-section,
      .purchase-grid[data-phone-step="4"] #purchase-notes-section,
      .purchase-grid[data-phone-step="4"] #purchase-files-section,
      .purchase-grid[data-phone-step="4"] .purchase-activity-step,
      .purchase-grid[data-phone-step="5"] #purchase-actions-section{display:block}
      .purchase-grid[data-phone-step="0"] .purchase-summary,
      .purchase-grid[data-phone-step="1"] .purchase-summary{display:none}
      .purchase-grid[data-phone-step="3"] .purchase-main,
      .purchase-grid[data-phone-step="4"] .purchase-main,
      .purchase-grid[data-phone-step="5"] .purchase-main{display:none}
    }

    :is(.purchase-main,.purchase-summary){min-width:0}:is(.purchase-main,.purchase-summary)>.card+.card{margin-top:12px}:is(.flow-card,.summary-card,.action-card){overflow:hidden}
    .erp-workspace__main>.card+.card,.erp-workspace__sidebar>.card+.card{margin-top:0}.purchase-summary.erp-workspace__sidebar{margin-top:0}
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
    .po-line__link{display:flex;flex:1;min-width:0;align-items:center;gap:inherit;color:inherit;text-decoration:none}.po-line__link:hover strong{color:var(--rose-dark);text-decoration:underline}
    .line-issue{display:block;padding:4px 0 0;border:0;background:transparent;color:var(--muted);font:inherit;font-size:11.5px;font-weight:650;text-align:left;cursor:pointer}.line-issue:hover{color:var(--rose-dark)}.issue-kind{margin-top:2px}
    .files-card .action-card__head,.note-card .action-card__head{padding:14px 18px 10px}.note-card__field{display:block;width:100%;padding:0 18px 14px;border:0;background:transparent;color:var(--ink);font:inherit;font-size:13px;line-height:1.5;resize:vertical;outline:none;box-sizing:border-box}.note-card__head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.note-card__head .linklike{flex:none;margin-top:2px}.note-card__diary{padding:0 18px 12px}.note-card__empty{margin:0;padding:0 18px 14px;color:var(--muted);font-size:12px}.po-attention{display:flex;align-items:flex-start;gap:10px;margin:12px 0;padding:10px 12px;border:1px solid #eddcb9;border-radius:12px;background:var(--warn-soft)}.po-attention__body{display:grid;gap:2px;min-width:0;font-size:12.5px;color:var(--ink-2)}.po-attention__body b{color:var(--warn);font-size:11px;letter-spacing:.06em;text-transform:uppercase}.attention-dot{display:inline-grid;place-items:center;flex:none;min-width:20px;height:20px;padding:0 5px;border-radius:999px;background:var(--warn);color:#fff;font-size:11px;font-weight:800;line-height:1}.files-card .action-card__buttons{padding:0 18px 14px;margin-top:0}.files-card__links{padding:0 18px 6px}
    .pay-line__remove{width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:var(--muted);font-size:16px;line-height:1;cursor:pointer}.pay-line__remove:hover{background:var(--danger-soft);color:var(--danger)}
    .files-list__actions{display:flex;align-items:center;gap:6px}
    .files-list{list-style:none;margin:0 18px 4px;padding:0;border-top:1px solid var(--line)}.files-list li{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)}.files-list__name{display:grid;min-width:0}.files-list__name b{font-size:12.5px;font-weight:650}.files-list__name small{color:var(--muted);font-size:11px}.files-card__hint{padding:6px 18px 14px}.files-list__rename{flex:1;min-width:0}.files-list__pencil{display:inline-grid;place-items:center;width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--muted);cursor:pointer}.files-list__pencil:hover{background:var(--surface-2);color:var(--ink)}.files-list__pencil svg{fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
    .receive-balance{display:grid;gap:8px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}.receive-balance b{font-size:13px}.receive-balance small{display:block;color:var(--muted);font-size:11.5px}.receive-balance__final{display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer}.receive-balance__final input{width:18px;height:18px;accent-color:var(--rose)}
    .receive-preview{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;margin:10px 0;border:1px solid var(--line);border-radius:12px;background:var(--line);overflow:hidden}.receive-preview>span{display:grid;padding:9px 10px;background:var(--surface)}.receive-preview small{color:var(--muted);font-size:9px;text-transform:uppercase}.receive-preview b{font-size:12.5px}.receive-preview>p{grid-column:1/-1;padding:8px 10px;background:var(--warn-soft);color:var(--ink-2);font-size:10.5px}
    .receive-lines{display:grid;gap:8px}.receive-line{display:grid;grid-template-columns:minmax(0,1fr) 110px 110px;gap:8px 10px;align-items:end;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}.receive-line--short{border-color:#eddcb9;background:var(--warn-soft)}.receive-line--damaged{border-color:#f1c8c4}.receive-line__name{display:grid;min-width:0}.receive-line__name b{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.receive-line__name small{color:var(--muted);font-size:11px}.receive-line__field{display:grid;gap:3px}.receive-line__field span{color:var(--muted);font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}.receive-line__note{grid-column:1/-1;color:var(--warn);font-size:11.5px;font-weight:650}
    @media(max-width:559px){.receive-line{grid-template-columns:1fr 1fr}.receive-line__name{grid-column:1/-1}}
    @media(min-width:560px){.receive-preview{grid-template-columns:repeat(4,minmax(0,1fr))}}
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
    .line-breakdown summary{display:flex;flex-wrap:nowrap;align-items:center;justify-content:space-between;gap:10px;min-height:46px;padding:6px 10px}.line-breakdown__label{display:flex;flex:1;min-width:0;flex-direction:row;align-items:baseline;gap:6px;font-size:12px}.line-breakdown__label small{overflow:hidden;color:var(--muted);font-size:10.5px;text-overflow:ellipsis;white-space:nowrap}.line-breakdown__value{display:inline-flex;flex:none;align-items:center;gap:6px;white-space:nowrap}.line-breakdown__mode{display:flex;justify-content:flex-end;padding:8px 0 2px}
    .loading-card{display:flex;min-height:160px;align-items:center;justify-content:center;color:var(--muted)}.loading-card__mark{display:none}

    @media(min-width:560px){.rate-grid{grid-template-columns:repeat(2,1fr)}.po-facts{grid-template-columns:repeat(3,1fr)}.line-breakdown summary{display:flex}.line-breakdown__value{padding-top:0}}
    @media(min-width: 680px){:is(.section-toggle,.section-heading){padding-inline:18px}:is(.section-body,.summary-body,.action-card){padding:18px}.po-line{padding:16px}.order-fields{grid-template-columns:repeat(6,minmax(0,1fr))}.order-fields>.field{grid-column:span 3}.order-fields>.order-route-field{grid-column:span 2}.order-fields>.span-2{grid-column:1/-1}}
    @media(min-width:680px){.purchase-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(330px,.85fr);gap:16px;align-items:start}.purchase-summary{margin-top:0}}
  `]
})
export class PurchaseEditor {
  /** One name for the container in sales texts: alias, else number. */
  readonly containerName = containerName;
  readonly desktop = inject(DesktopViewport);
  readonly pdfOpen = signal(false);
  /** The container as an offer: the sheet that picks the customer and opens the new quote. */
  readonly quoteOpen = signal(false);
  readonly quoteLines = computed<PurchaseQuoteLine[]>(() => quoteLinesOf(this.view()));
  readonly phoneStep = signal(0);
  readonly phoneStepLabels = ['Order', 'Producten', 'Kosten', 'Betalingen', 'Dossier', 'Afronden'] as const;
  private readonly phoneStepIds = [
    'purchase-order-section', 'purchase-products-section', 'purchase-costs-section',
    'purchase-payments-section', 'purchase-files-section', 'purchase-actions-section',
  ] as const;
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

  toggleSection(name: string): void {
    const next = new Set(this.openSections());
    if (next.has(name)) { next.delete(name); } else { next.add(name); }
    this.openSections.set(next);
    if (next.has(name)) {
      this.workspaceSection.set(name === 'order' ? 'purchase-order-section' : 'purchase-costs-section');
    }
  }

  sectionOpen(name: string): boolean {
    return this.openSections().has(name);
  }

  nextPhoneStep(): void {
    this.movePhoneStep(1);
  }

  previousPhoneStep(): void {
    this.movePhoneStep(-1);
  }

  private movePhoneStep(direction: -1 | 1): void {
    const next = Math.max(0, Math.min(this.phoneStepLabels.length - 1, this.phoneStep() + direction));
    const disclosure = next === 0 ? 'order' : next === 2 ? 'costs' : undefined;
    this.jumpToSection(this.phoneStepIds[next], disclosure);
  }

  /** The phone step that shows a section: a step of its own, or a card living on one. */
  private phoneStepFor(sectionId: string): number {
    const index = (this.phoneStepIds as readonly string[]).indexOf(sectionId);
    if (index >= 0) return index;
    if (sectionId === 'purchase-result-section') return 2;
    if (sectionId === 'purchase-partner-section') return 3;
    return -1;
  }

  private readonly paymentOverview = viewChild(PurchasePaymentOverview);

  /** From the Nacalculatie: the payee's sheet on top of the payments step. */
  openPayee(payee: Payee): void {
    this.jumpToSection('purchase-payments-section');
    this.paymentOverview()?.openPayee.set(payee);
  }

  /** Opens a collapsed editor section first, then lands it below the sticky workspace rail. */
  jumpToSection(sectionId: string, disclosure?: 'order' | 'costs', scroll = true): void {
    if (disclosure && !this.sectionOpen(disclosure)) {
      const next = new Set(this.openSections());
      next.add(disclosure);
      this.openSections.set(next);
    }
    if (!this.desktop.active()) {
      const phoneStep = this.phoneStepFor(sectionId);
      if (phoneStep >= 0) this.phoneStep.set(phoneStep);
      this.workspaceSection.set(phoneStep >= 0 ? this.phoneStepIds[phoneStep] : sectionId);
      if (!scroll) return;
      /* A step starts at the top; a card further down a step is scrolled to. */
      if (this.phoneStepIds[phoneStep] === sectionId) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      requestAnimationFrame(() => {
        const target = document.getElementById(sectionId);
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target?.focus({ preventScroll: true });
      });
      return;
    }
    this.workspaceSection.set(sectionId);
    if (!scroll) return;
    requestAnimationFrame(() => {
      const target = document.getElementById(sectionId);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target?.focus({ preventScroll: true });
    });
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
      return { ...pay, amountInput: raw == null ? '' : String(raw), amount, ...(pay.bankTransaction ? { amountEurInput: String(Math.abs(pay.bankTransaction.amountEur)).replace('.', ','), amountEur: Math.abs(pay.bankTransaction.amountEur) } : changed ? { amountEurInput: '', amountEur: null } : {}) };
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
        return { ...changed, amount: goods > 0 ? goods : null, amountInput: goods > 0 ? String(goods).replace('.', ',') : '' };
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

  /* ---- 'Ook als bankbeweging noteren': the one line of a transfer, and which payments already sit on the bank */
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
  readonly paymentBankAccount = computed(() => defaultBankAccount(this.bankAccounts.options(), this.paying()?.bankAccount ?? '', readPayToBank(globalThis.localStorage).accountKey));

  /** The bank side of the order screen: the accounts for the sheet's chips, and the lines once. */
  private async loadBankLines(): Promise<void> {
    void this.bankAccounts.load();
    if (this.bankLines() !== null) return;
    try { this.bankLines.set(await this.banking.list()); } catch { /* the marks are a hint; without them the sheet still asks */ }
  }

  /** The bank's day: a payment dated after it cannot be on a statement yet. */
  bankToday(): string { return receiptLocalParts(Date.now(), BANK_ZONE).day; }

  /** The one outgoing bank line of a transfer: every payment of it linked, the marker kept for older readers. */
  private transferLine(pay: PurchasePaymentDraft, orderNumber: string, ids: number[], amountEur: number, account: string): BankMovementRequest {
    const now = receiptLocalParts(Date.now(), BANK_ZONE);
    return {
      account, amountEur, direction: 'OUTGOING',
      bookedAt: receiptInstant(pay.paidOn, pay.paidOn === now.day ? now.time : '12:00:00', BANK_ZONE), timeZone: BANK_ZONE,
      reference: `${pay.label || 'Betaling'} · ${orderNumber} · ${bankMarker('containerbetaling', ids[0])}`,
      counterparty: pay.payee === 'SUPPLIER' ? this.supplier()?.name ?? PAYEE_LABEL.SUPPLIER : PAYEE_LABEL[pay.payee],
      purchasePaymentIds: ids, requestId: crypto.randomUUID(),
    };
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
    const foreign = root.currency !== 'EUR' && Number.isFinite(root.amountEur) && root.amountEur > 0;
    this.paying.set({ id: root.id, amount: root.amount, amountInput: String(root.amount).replace('.', ','), currency: root.currency, paidOn: root.paidOn,
      label: root.label ?? '', payee: root.payee ?? 'SUPPLIER', files: [], settles: !!root.settles,
      instalmentDue: root.instalmentDue ?? null,
      amountEurInput: foreign ? String(root.amountEur).replace('.', ',') : '', amountEur: foreign ? root.amountEur : null,
      toBank: readPayToBank(globalThis.localStorage).on, bankAccount: '',
      groupIds: [root.id, ...members.filter(member => member.id !== root.id).map(member => member.id)],
      invoiceId: root.invoiceId ?? null, invoiceIdChanged: false });
    void this.loadBankLines();
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

  /** After an immediate action the sheet stays open on the same payment: the root may have moved when a part was removed. */
  private rebindPaying(previousIds: readonly number[]): void {
    const payments = this.payments() ?? [];
    const survivor = payments.find(payment => previousIds.includes(payment.id));
    if (!survivor) { this.paying.set(null); return; }
    const members = this.groupOf(survivor);
    const root = members.find(member => member.id === (survivor.groupId ?? survivor.id)) ?? members[0];
    this.paying.update(current => current ? { ...current, id: root.id, amount: root.amount, amountInput: String(root.amount).replace('.', ','),
      paidOn: root.paidOn, currency: root.currency, groupIds: [root.id, ...members.filter(member => member.id !== root.id).map(member => member.id)],
      pendingLines: [], pendingPartId: null, partEdits: {}, bankLinkError: '' } : current);
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
    } catch (failure: unknown) {
      if (this.view()?.order.id === id) this.ui.toast(messageOf(failure, 'Factuur bewaren mislukt'), 'err');
    } finally {
      this.payingBusy.set(false);
    }
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
      amountInput: capped > 0 ? String(Math.round(capped * 100) / 100).replace('.', ',') : '',
      currency: 'EUR',
      paidOn: new Date().toISOString().slice(0, 10),
      label: label ?? (payee === 'SUPPLIER' ? (rest > 0.005 && this.paidTotalEur() > 0 ? 'Saldo' : '')
        : payee === 'LOGISTICS' ? 'Douane & transport' : payee === 'SEPARATE' ? 'Inspectie' : ''),
      payee,
      files: [],
      settles: false,
      instalmentDue: payee === 'SUPPLIER' && Array.isArray(this.view()?.reconciliation?.supplierInstalments) ? instalmentDue : null,
      toBank: readPayToBank(globalThis.localStorage).on, bankAccount: '',
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
    const offset = !!this.payingCreditOffset();
    const parts = pay.id ? this.payingParts() : [];
    const grouped = parts.length > 1;
    const pendingLines = pay.pendingLines ?? [];
    // The picked transactions are checked against that part's amount before any inspection split.
    const pendingPart = pay.id ? parts.find(part => part.id === (pay.pendingPartId ?? pay.id)) ?? null : null;
    const pendingEdit = pendingPart ? pay.partEdits?.[pendingPart.id] : undefined;
    const pendingEur = !pendingPart ? 0 : pendingEdit && pendingEdit.amount !== null
      ? (pendingPart.currency === 'EUR' ? pendingEdit.amount : pendingEdit.amountEur ?? Math.round(pendingPart.amountEur * pendingEdit.amount / pendingPart.amount * 100) / 100)
      : !grouped && pay.currency === 'EUR' ? pay.amount : pendingPart.amountEur;
    const plan = pendingPart && pendingLines.length ? pendingLinkPlan(pendingEur, pendingLines, round) : { kind: 'none' as const };
    if (plan.kind === 'invalid') { this.ui.toast(plan.message, 'err'); return; }
    /* 'Ook als bankbeweging noteren': a known account and a day the bank has reached; never for an offset, a payment in parts or picked transactions. */
    const bankOffered = !pay.bankTransaction && typeof pay.toBank === 'boolean' && !this.paymentOnBank(pay) && !offset && !grouped && !pendingLines.length;
    const account = bankOffered && pay.toBank ? this.bankAccounts.options().find(option => option.key === this.paymentBankAccount()) ?? null : null;
    if (bankOffered && pay.toBank && (!account || pay.paidOn > this.bankToday())) return;
    if (pay.bankTransaction && !bankAmountsMatch(this.paymentTransferEur(), Math.abs(pay.bankTransaction.amountEur))) {
      this.ui.toast('Het totaal van de betaling mag maximaal € 0,02 afwijken van de gekozen banktransactie.', 'err'); return;
    }
    const stored = pay.id ? (this.payments() ?? []).find(payment => payment.id === pay.id) : undefined;
    const split = round && !!pay.id && !grouped && !offset && pay.payee === 'SUPPLIER' && (stored?.payee ?? 'SUPPLIER') === 'SUPPLIER'
      && pay.instalmentDue !== 'FREIGHT' && (pay.inspectionSplit ?? 0) > 0 ? pay.inspectionSplit! : null;
    this.payingBusy.set(true);
    let paymentSaved = false;
    const done: string[] = [];
    try {
      // 1. 'Factuur toevoegen…' inline: the file once, then the invoice once; the payment then points to it.
      let invoiceId = pay.invoiceId ?? null;
      let invoiceChanged = !!pay.invoiceIdChanged;
      if (round && pay.createdInvoiceId != null) { invoiceId = pay.createdInvoiceId; invoiceChanged = true; }
      else if (round && pay.newInvoice?.open && pay.newInvoice.amount !== null) {
        const fresh = pay.newInvoice;
        let documentId = pay.createdDocumentId ?? null;
        if (fresh.file && documentId === null) {
          const document = await this.sourcing.addDocument(data.order.id, fresh.file, invoiceDocumentKind(pay.payee), null, null);
          documentId = document.id;
          if (this.view()?.order.id === data.order.id) this.documents.update(current => [...(current ?? []), document]);
          this.paying.update(current => current && current.id === pay.id ? { ...current, createdDocumentId: document.id } : current);
        }
        const created = await this.sourcing.addInvoice(data.order.id, { payee: pay.payee, number: fresh.number.trim(), invoiceDate: fresh.invoiceDate,
          amount: fresh.amount!, currency: fresh.currency, amountEur: null, documentId, notes: null });
        invoiceId = created.id;
        invoiceChanged = true;
        this.paying.update(current => current && current.id === pay.id ? { ...current, createdInvoiceId: created.id, invoiceId: created.id, invoiceIdChanged: true } : current);
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
      if (pay.bankTransaction && !pay.id) {
        const result = await this.banking.addPurchasePayment(pay.bankTransaction.id, data.order.id, [goods, ...fresh]);
        saved = result.payments[0];
        atomicLine = result.line;
        atomicIds = result.payments.map(payment => payment.id);
      } else {
        const retained = (pay.bankLinkPending || pay.bankLinkComplete) ? pay.bankSavedPayment ?? (this.payments() ?? []).find(payment => payment.id === pay.id) : null;
        if (retained) saved = retained;
        else if (pay.id && grouped) saved = await this.saveGroup(data.order.id, pay, parts, invoiceChanged ? invoiceId : undefined);
        else saved = pay.id ? await this.sourcing.updatePayment(data.order.id, pay.id, goods) : await this.sourcing.addPayment(data.order.id, goods);
      }
      paymentSaved = true;
      if (this.view()?.order.id !== data.order.id) return;
      const planned = frozen ? { ...frozen, goodsEur: saved.amountEur } : fresh.length ? { goodsEur: saved.amountEur, parts: fresh } : undefined;
      this.paying.update(current => current === pay ? { ...current, id: saved.id, ...(planned ? { planned } : {}),
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
      } else if (account) {
        try {
          const line = await this.banking.create(this.transferLine(pay, data.order.number, ids, this.paymentTransferEur(), account.key));
          this.bankLines.update(lines => [line, ...(lines ?? [])]);
          bank = 'noted';
        } catch { bank = 'failed'; }
      }
      // 4. The transactions picked in a saved payment, then 5. the inspection split: from here a retry continues without writing the payment again.
      if (plan.kind !== 'none' || split !== null) {
        this.paying.update(current => current?.id === saved.id ? { ...current, bankLinkPending: true, bankSavedPayment: saved, bankLinkError: '' } : current);
        try {
          if (plan.kind !== 'none' && pendingPart) {
            if (plan.kind === 'part') {
              const result = await this.sourcing.linkPaymentPart(pendingPart.id, plan.lineId);
              await this.reloadBankLines(result.lines);
              done.push(plan.whole ? 'Banktransactie gekoppeld' : 'Deel van de betaling gekoppeld');
            } else if (plan.kind === 'lines') {
              const result = await this.sourcing.linkPaymentLines(pendingPart.id, plan.lineIds.map(bankStatementLineId => ({ bankStatementLineId })));
              await this.reloadBankLines(result.lines);
              done.push(`Betaling verdeeld over ${plan.lineIds.length} transacties`);
            } else {
              const line = await this.banking.linkPayments(plan.lineId, { purchasePaymentIds: [pendingPart.id] });
              await this.reloadBankLines([line]);
              done.push('Banktransactie gekoppeld');
            }
            this.paying.update(current => current?.id === saved.id ? { ...current, pendingLines: [], pendingPartId: null } : current);
          }
          if (split !== null) {
            // The goods payment's euro as loaded (a link never changes it; a money correction in this save does, and then the server's answer
            // counts), frozen at the first try: a retry after a lost answer sends the same body, which the server answers unchanged.
            const sameMoney = !!stored && stored.currency === pay.currency && Math.round(stored.amount * 100) === Math.round(pay.amount * 100);
            const expected = this.paying()?.inspectionExpectedEur ?? (sameMoney ? stored!.amountEur : saved.amountEur);
            this.paying.update(current => current?.id === saved.id ? { ...current, inspectionExpectedEur: expected } : current);
            const amountEur = inspectionSplitEur({ amount: saved.amount, currency: saved.currency, amountEur: expected }, split);
            await this.sourcing.splitInspection(saved.id, saved.currency === 'EUR'
              ? { amountEur, expectedAmountEur: expected } : { amountEur, amount: split, expectedAmountEur: expected });
            this.paying.update(current => current?.id === saved.id ? { ...current, inspectionSplit: null, inspectionSplitInput: '' } : current);
            done.push('Inspectie afgesplitst');
          }
        } catch (failure: unknown) {
          await this.refreshPaymentState(data.order.id);
          if (this.view()?.order.id !== data.order.id) return;
          this.paying.update(current => current?.id === saved.id ? { ...current, bankLinkError: `Betaling bewaard. ${messageOf(failure, 'De koppeling is nog niet gelukt.')} Opnieuw proberen maakt geen extra betaling.` } : current);
          this.ui.toast(messageOf(failure, 'Koppelen mislukt'), 'err');
          return;
        }
      }
      if (bankOffered) writePayToBank(globalThis.localStorage, { on: !!pay.toBank, accountKey: account?.key ?? readPayToBank(globalThis.localStorage).accountKey });
      await Promise.all([this.refreshPaymentState(data.order.id), pay.files.length || pay.newInvoice?.file ? this.loadDocuments(data.order.id) : Promise.resolve()]);
      if (this.view()?.order.id !== data.order.id) return;
      // A failed line keeps the sheet open with every id of the transfer, so one more 'bewaren' sends the line again.
      if (bank !== 'failed') this.paying.set(null);
      const filed = pay.files.length ? ['bewijs'] : [];
      this.ui.toast(bank === 'noted' ? (pay.bankTransaction ? 'Betaling bewaard en banktransactie gekoppeld' : `Betaling genoteerd · ook op ${account!.label}`) : bank === 'failed' ? (pay.bankTransaction ? 'Betaling bewaard, banktransactie nog niet gekoppeld.' : 'Betaling genoteerd, maar de bankbeweging is niet bewaard.')
        : done.length ? done.join(' · ') : pay.id ? 'Betaling aangepast' : filed.length ? `Betaling en ${filed[0]} bewaard` : 'Betaling bewaard',
        bank === 'failed' ? 'err' : 'ok');
    } catch (failure: unknown) {
      if (paymentSaved && this.view()?.order.id === data.order.id) await this.refreshPaymentState(data.order.id);
      if (this.view()?.order.id === data.order.id) this.ui.toast(messageOf(failure,
        paymentSaved ? 'Betaling bewaard, maar niet alle bewijzen konden worden toegevoegd. Probeer de resterende bestanden opnieuw.' : 'Betaling bewaren mislukt'), 'err');
    } finally {
      this.payingBusy.set(false);
    }
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
    for (const part of parts) {
      const edit = pay.partEdits?.[part.id];
      if (part.id === root.id || !edit || edit.amount === null || part.bankStatementLineId != null) continue;
      if (Math.round(edit.amount * 100) === Math.round(part.amount * 100) && edit.amountEur == null) continue;
      const stored = part.payment;
      await this.sourcing.updatePayment(orderId, part.id, { ...write(part, edit), label: stored.label ?? null, payee: stored.payee ?? 'SUPPLIER',
        settles: !!stored.settles, instalmentDue: stored.instalmentDue ?? null });
      this.paying.update(current => {
        if (!current?.partEdits) return current;
        const { [part.id]: _saved, ...rest } = current.partEdits;
        return { ...current, partEdits: rest };
      });
    }
    const rootEdit = root.bankStatementLineId == null ? pay.partEdits?.[root.id] : undefined;
    const saved = await this.sourcing.updatePayment(orderId, root.id, {
      ...write(root, rootEdit), label: pay.label || null, payee: pay.payee, settles: pay.settles,
      instalmentDue: pay.payee === 'SUPPLIER' ? pay.instalmentDue ?? null : null,
      ...(invoiceId !== undefined ? { invoiceId } : {}), applyToGroup: true,
    });
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
  readonly paymentNavLabel = computed(() => paymentsNavLabel(this.paymentLedger(), {
    error: !!this.paymentStateError(), loading: this.paymentStateLoading() || this.payments() === null,
    concept: this.view()?.order.status === 'CONCEPT',
  }));

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
      next.amountInput = rest > 0 ? String(rest).replace('.', ',') : '';
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
      this.relatedSalesDocs.set(all.filter((view) => view.order.partnerPurchaseOrderId === orderId || view.order.sourcePurchaseOrderId === orderId));
      const deals = all.filter((view) => view.order.partnerPurchaseOrderId === orderId && view.order.purpose !== 'STANDARD');
      this.partnerDocs.set(deals);
      const customerId = deals[0]?.order.customerId;
      if (!customerId) { this.partnerCompany.set(''); this.partnerCustomer.set(null); return; }
      const customers = await this.sales.customers().catch(() => [] as Customer[]);
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
    this.addingDocument.set({ kind: 'PAYMENT_PROOF', label: '', paymentId: null, file: null, files: [] });
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
    this.firstInstalmentPrompt.set({ label: first.label, amount: first.amount, amountInput: String(first.amount).replace('.', ','), due: first.due, currency: 'EUR',
      paidOn: new Date().toISOString().slice(0, 10), files: [] });
  }

  async confirmFirstInstalment(): Promise<void> {
    const first = this.firstInstalmentPrompt();
    if (!first || first.amount === null || !((first.amount ?? 0) > 0) || this.payingBusy() || this.paying()) return;
    this.paying.set({ ...first, payee: 'SUPPLIER', settles: false, instalmentDue: first.due ?? null,
      toBank: readPayToBank(globalThis.localStorage).on, bankAccount: '', invoiceId: this.preselectedInvoice('SUPPLIER'), invoiceIdChanged: false });
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
      if (!this.sectionOpen('order')) this.toggleSection('order');
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

  protected async load(orderId: number): Promise<void> {
    ++this.paymentRefreshVersion;
    ++this.previewVersion;
    ++this.documentLoadVersion;
    this.documents.set(null);
    if (this.view()?.order.id !== orderId) this.view.set(null);
    this.paymentStateError.set(null);
    this.paymentStateLoading.set(false);
    this.payments.set(null);
    this.families.set([]);
    /* The families decide how the product list groups and sorts, so they load
       with the order: the list must not paint and then jump into its groups. An
       unavailable catalogue endpoint still never holds up opening the order. */
    const [view, families] = await Promise.all([
      this.sourcing.purchaseOrder(orderId),
      this.catalog.productFamilies().catch(() => [] as ProductFamily[]),
    ]);
    if (Number(this.id()) !== orderId) return;
    this.families.set(families);
    void this.loadPayments(orderId);
    void this.loadDocuments(orderId);
    void this.loadBankLines();
    void this.loadPartnerDocs(orderId);
    this.savedOrder.set(JSON.stringify(view.order));
    const [products, categories, suppliers, locations, freightRates] = await Promise.all([
      this.catalog.products(view.order.supplierId),
      this.catalog.categories().catch(() => [] as Category[]),
      this.sourcing.suppliers(),
      this.catalog.stockLocations().catch(() => [] as StockLocation[]),
      /* A market-context hint must never block opening the order. */
      this.sourcing.freightRates().catch(() => [] as FreightRate[])]);
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
  private readonly savedOrder = signal<string>('');
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
