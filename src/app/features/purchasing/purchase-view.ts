import { PurchaseSalesLinks } from './purchase-sales-links';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { Location } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { SourcingApi } from '../../core/api/sourcing-api';
import { SalesApi } from '../../core/api/sales-api';
import { CatalogApi } from '../../core/api/catalog-api';
import { AuthImage } from '../../core/api/auth-image';
import { PurchasePdfSheet } from './purchase-pdf-sheet';
import { quoteLinesOf } from './purchase-editor';
import { PurchaseQuoteSheet } from './purchase-quote-sheet';
import { PurchasePartnerSheet } from './purchase-partner-sheet';
import { PurchasePartnerPanel } from './purchase-partner-panel';
import { PurchasePartnerPayments } from './purchase-partner-payments';
import { PurchasePaymentOverview } from './purchase-payment-overview';
import { PurchaseNacalcOverview } from './purchase-nacalc-overview';
import { purchaseNacalc } from './purchase-nacalc-metrics';
import { purchaseNacalcSummary } from './purchase-payment-result-metrics';
import { Diary } from './diary';
import { Skeleton } from '../../shared/skeleton';
import { saveBlob } from '../../core/api/download';
import { Sheet, Ui } from '../../shared/ui';
import { messageOf } from '../../core/api/errors';
import { CbmPipe, EurPipe, NumPipe, PctPipe, EurUpPipe } from '../../shared/pipes';
import {
  Category, OtherCost, PartnerFinancing, Payee, Product, ProductFamily, PurchaseOrder, PurchaseOrderLine, PurchaseOrderView, ReceiptVarianceTotals, Supplier, StockLocation, PurchasePayment, PurchaseDocument, SalesOrderView, Customer, PAYMENT_TERMS,
} from '../../core/api/models';
import {
  COLOUR_SWATCHES, containerCountForFill, containerLabel,
} from '../../core/api/geo';
import { DateNlPipe } from '../../shared/pipes';
import {
  effectiveUsdToEur, hasSeparateCosts, purchaseCostLabels, separateCostsTotalLabel,
} from './purchase-cost-labels';
import { PurchaseActivity } from '../activity/purchase-activity';
import { receiptMetrics } from '../analyses/receipt-metrics';
import { STATUS_LABEL } from '../sales/quote-status';
import { isSettlementInvoice, partnerDocumentKind, separateCostPerPiece } from '../sales/partner-settlement';
import { PAYMENT_TOLERANCE_EUR, instalmentsOf, paymentPlanLabel } from './payment-plan';
import { PAYEE_LABEL, purchasePaymentLedger, type PurchasePaymentAction } from './purchase-payment-ledger';
import { purchaseGroupSettled, purchaseInstalmentState } from './purchase-instalment-state';
import { AuctionSettlementSheet, AuctionSheetLine } from '../sales/auction-settlement-sheet';
import { SalesCreditNoteSheet } from '../sales/sales-credit-note-sheet';
import { cartonQuantityNotice } from '../../shared/carton-quantity-notice';
import { productSalesUnit } from '../products/product-sales-unit';
import { purchaseColourHex, purchaseLineSections } from './purchase-line-display';
import { landedRangeText } from './purchase-product-line-groups';
import { toggleProductGroup as nextProductGroupDisclosure } from '../../shared/product-group-disclosure';
import { containerName } from './container-name';
import { BankingApi, type BankStatementLine } from '../../core/api/banking-api';
import { BankAccountsStore } from '../../core/api/bank-accounts';
import { lineMarkers } from '../finance/bank-markers';
import { bankTransactionDay } from '../../shared/bank-transaction-options';
import { IosNav } from '../../shared/ios-nav';
import { Icon } from '../../shared/icon';
import { Segmented, type SegmentOption } from '../../shared/segmented';
import { ContextMenu, type ContextMenuItem } from '../../shared/context-menu';
import { PurchaseNacalcGlance } from './purchase-nacalc-glance';
import { PurchaseStepConfirmSheet } from './purchase-step-confirm-sheet';
import { PurchaseStepHandoff } from './purchase-step-handoff';
import {
  STEP_BUTTON, costsAppliedFor, costsSupersededFor, landedTile, parseTab, paymentTile, paymentsDot, productsDot, progressSteps, readNextStep,
  replaceTabInUrl, rootSectionOf, statusTone, stepConfirm, tabOfSection, tabParam, tabSegments, type AskedStep, type PhoneStep, type PhoneTab,
} from './purchase-phone-model';
import { keepPhoneTabFocusInPlace, keepPhoneTabsStuck, phoneStickPoint, phoneTabsStuck, scrollPhoneTabsTop, tappedSelectedTab } from './purchase-phone-scroll';

/**
 * Read-only control room for one incoming container, on a phone (the desk
 * reads and edits in PurchaseDesk).
 *
 * A white summary card - status, route, name, progress with its days,
 * Totaal geland and what is due - over five tabs: Overzicht, Producten,
 * Kosten (with the complete Nacalculatie), Betalingen and Dossier. The tab
 * lives in ?tab=; the dock holds Bewerken and the next step, which always
 * asks first and then runs in the editor. Styles: styles/purchase-phone.scss.
 */
@Component({
  selector: 'app-purchase-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PurchaseSalesLinks, PurchaseQuoteSheet, PurchasePartnerSheet, AuctionSettlementSheet, SalesCreditNoteSheet, PurchasePartnerPanel, PurchasePartnerPayments, PurchasePaymentOverview, PurchaseNacalcOverview, RouterLink, AuthImage, Skeleton, CbmPipe, DateNlPipe,
            EurPipe, EurUpPipe, NumPipe, PctPipe, Diary, PurchasePdfSheet, PurchaseActivity, Sheet,
            IosNav, Icon, Segmented, ContextMenu, PurchaseNacalcGlance, PurchaseStepConfirmSheet],
  template: `
    @if (view(); as data) {
      <div class="mpo-phone mpo-phone--view">
        <app-ios-nav [title]="containerName(data.order)" [customLarge]="true" backLabel="" backAriaLabel="Terug" (back)="goBack()">
          <span trail class="ios-glass-group">
            <button class="ios-circle" type="button" aria-label="PDF downloaden" (click)="pdfOpen.set(true)"><app-icon name="pdf" [size]="19" /></button>
            <button class="ios-circle" type="button" aria-label="Meer acties" aria-haspopup="dialog" [attr.aria-expanded]="moreMenu()" (click)="moreMenu.set(true)"><app-icon name="more" [size]="20" /></button>
          </span>
          <!-- The container at a glance: status, route, name, progress with its days and the two figures that matter. -->
          <section hero class="mpo-summary" id="purchase-overview" tabindex="-1" aria-labelledby="mpo-title">
            <div class="mpo-summary__top">
              <span class="wk-pill" [class]="statusTone(data.order.status)"><span class="wk-pill__dot" aria-hidden="true"></span>{{ statusLabel(data.order.status) }}</span>
              <span class="mpo-summary__route" [title]="routeText()">{{ routeText() }}</span>
            </div>
            <h1 id="mpo-title" class="mpo-summary__title" [title]="containerName(data.order)">{{ containerName(data.order) }}</h1>
            <p class="mpo-summary__sub" [title]="data.order.alias ? data.order.number + ' · ' + supplierName() : supplierName()">{{ data.order.alias ? data.order.number + ' · ' + supplierName() : supplierName() }}</p>
            <p class="mpo-summary__meta">gemaakt door {{ creatorName(data) }}</p>
            <ol class="mpo-progress" aria-label="Voortgang van de inkooporder">
              @for (step of progress(); track step.label) {
                <li class="mpo-progress__step" [class.is-done]="step.state === 'done'" [class.is-now]="step.state === 'now'" [class.is-todo]="step.state === 'todo'"
                    [attr.aria-current]="step.state === 'now' ? 'step' : null">
                  <span class="mpo-progress__bar" aria-hidden="true"></span>
                  <span class="mpo-progress__label">{{ step.label }}</span>
                  @if (step.date) { <span class="mpo-progress__date">{{ step.prefix ? 'verwacht ' : '' }}{{ step.date | dateNl }}</span> }
                </li>
              }
            </ol>
            <div class="mpo-tiles">
              @let landed = landedTileOf(data);
              @let landedText = landed.valueEur | eur;
              <button class="mpo-tile mpo-tile--landed" type="button" [attr.aria-label]="'Totaal geland ' + landedText + ', ' + landed.sub + ', naar Kosten'"
                      (click)="scrollToCard('purchase-costs-section', 'purchase-costs-section')">
                <span class="mpo-tile__label">Totaal geland</span>
                <span class="mpo-tile__value" [class.mpo-tile__value--long]="landedText.length > 10">{{ landedText }}</span>
                <span class="mpo-tile__sub">{{ landed.sub }}</span>
                <app-icon class="mpo-tile__chev" name="chevron-right" [size]="14" />
              </button>
              @let pay = payTile();
              @let payText = pay.valueEur === null ? '' : (pay.valueEur | eur);
              <button class="mpo-tile" type="button" [class.mpo-tile--warn]="pay.tone === 'warn'" [class.mpo-tile--ok]="pay.tone === 'ok'" [class.mpo-tile--neutral]="pay.tone === 'neutral'"
                      [attr.aria-label]="pay.label + (payText ? ' ' + payText : '') + (pay.sub ? ', ' + pay.sub : '') + ', naar Betalingen'"
                      (click)="scrollToCard('purchase-payments-section', 'purchase-payments-section')">
                <span class="mpo-tile__label">{{ pay.label }}</span>
                @if (payText) { <span class="mpo-tile__value" [class.mpo-tile__value--long]="payText.length > 10">{{ payText }}</span> }
                @if (pay.sub) { <span class="mpo-tile__sub" [title]="pay.sub">{{ pay.sub }}</span> }
                <app-icon class="mpo-tile__chev" name="chevron-right" [size]="14" />
              </button>
            </div>
          </section>
          <div below class="ios-subbar mpo-tabs">
            <app-segmented class="ios-seg--stacked" variant="ios" semantics="tabs" label="Onderdelen van deze container" controls="mpo-panes"
                           [options]="tabOptions()" [value]="activeTab()" (changed)="selectTab($any($event))" (click)="tabsClicked($event)" />
          </div>
        </app-ios-nav>

        <div id="mpo-panes" class="mpo-panes">
          <!-- ===== Overzicht ===== -->
          <section class="mpo-pane" id="mpo-pane-overzicht" role="tabpanel" aria-label="Overzicht" [hidden]="activeTab() !== 'overzicht'">
            <div class="ios-figures mpo-figures">
              <div><small>Lading</small><strong>{{ data.costing.totals.pieces | num }} st</strong><small>{{ data.costing.totals.cartons | num }} dozen</small></div>
              <div><small>Volume</small><strong>{{ data.costing.totals.cbm | cbm }}</strong>
                @if (isDdp()) { <small>geleverd DDP</small> } @else if (data.costing.containerFill; as fill) { <small>van {{ fill.capacityCbm }} m³</small> }</div>
              @if (!isDdp() && data.costing.containerFill; as fill) {
                <div><small>Vulling</small>
                  <strong [class.fill-pct--over]="fill.fillPercent > 100 && fill.fillPercent <= 105" [class.fill-pct--danger]="fill.fillPercent > 105"
                          [class.fill-pct--full]="fill.overflowCbm <= 0 && fill.fillPercent >= 97">{{ fill.fillPercent | pct: 0 }}</strong>
                  <small>@if (fill.fillPercent > 100) { {{ fill.overflowCbm | cbm }} te veel } @else { {{ fill.freeCbm | cbm }} vrij }</small></div>
              } @else if (isDdp()) {
                <div><small>Prijsbasis</small><strong>DDP</strong><small>transport en rechten in de prijs</small></div>
              } @else {
                <div><small>Productregels</small><strong>{{ data.costing.lines.length }} regels</strong></div>
              }
            </div>

            @if (data.attention?.length) {
              <div class="ios-banner mpo-attention" role="status">
                <span class="mpo-attention__count" aria-hidden="true">{{ data.attention!.length }}</span>
                <span class="mpo-attention__body"><b>Actie vereist</b>@for (item of data.attention; track item) { <span>{{ item }}</span> }</span>
              </div>
            }

            @if (receiptSummary(); as receipt) {
              <section class="ios-section" id="purchase-receipt-section" tabindex="-1" aria-labelledby="mpo-receipt-title">
                <div class="ios-section__head"><h2 id="mpo-receipt-title">Ontvangstcontrole</h2></div>
                <div class="ios-group ios-group--icons">
                  <div class="ios-cell ios-cell--tall">
                    <span class="ios-cell__lead"><span class="ios-tile ios-tile--soft" [class.tone-warn]="!!receipt.affectedLines" [class.tone-ok]="!receipt.affectedLines && receiptSnapshotComplete()"
                      [class.tone-grey]="!receipt.affectedLines && !receiptSnapshotComplete()" aria-hidden="true">{{ receipt.affectedLines ? '!' : receiptSnapshotComplete() ? '✓' : '?' }}</span></span>
                    <span class="ios-cell__body">
                      <span class="ios-cell__title ios-cell__title--strong mpo-wrap">{{ receipt.affectedLines
                        ? receipt.affectedLines + ' afwijkende productregel(s)'
                        : receiptSnapshotComplete() ? 'Alles volgens bestelling' : 'Ontvangst vastgelegd' }}</span>
                      <span class="ios-cell__sub mpo-wrap">Ontvangen {{ data.order.receivedOn | dateNl }} · {{ receipt.usablePieces | num }} stuks bruikbaar@if (!receiptSnapshotComplete()) { · bestelsnapshot onvolledig }</span>
                    </span>
                  </div>
                  <a class="ios-cell" routerLink="/analyses/purchasing" [queryParams]="{ orderId: data.order.id }">
                    <span class="ios-cell__lead"><span class="ios-tile tone-blue" aria-hidden="true"><app-icon name="analytics" [size]="17" /></span></span>
                    <span class="ios-cell__body"><span class="ios-cell__title">Open analyse</span></span>
                    <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                  </a>
                </div>
                <div class="ios-figures mpo-receipt__figures">
                  <div><small>Besteld</small><strong>{{ receiptSnapshotComplete() ? (receipt.orderedPieces | num) : '—' }}</strong></div>
                  <div><small>Ontbreekt</small><strong [class.warn-text]="receipt.missingPieces">{{ receipt.missingPieces | num }}</strong></div>
                  <div><small>Beschadigd</small><strong [class.danger-text]="receipt.damagedPieces">{{ receipt.damagedPieces | num }}</strong></div>
                  <div><small>Inkoopimpact</small><strong>{{ receipt.totalLossValueEur | eur: 0 }}</strong></div>
                </div>
                @if (!receipt.valuationComplete) {
                  <p class="ios-section__foot warn-text">{{ receipt.unvaluedLossPieces | num }} afwijkende stuks hebben nog geen bevroren inkoopwaarde en tellen nog niet mee in het bedrag.</p>
                }
              </section>
            }

            <app-purchase-nacalc-glance [nacalc]="nacalc()" [state]="paymentState()" (open)="scrollToCard('purchase-result-section', 'purchase-costs-section')" />

            <section class="ios-section" id="purchase-actions-section" tabindex="-1" aria-labelledby="mpo-actions-title">
              <div class="ios-section__head"><h2>Volgende stap</h2></div>
              <div class="ios-card mpo-next">
                @if (data.order.status === 'ONTVANGEN' && data.order.stockBooked === false) {
                  <h3 id="mpo-actions-title">Klaar voor de volgende stap?</h3>
                  <p>Ontvangen, nog niet bijgeboekt: de stuks staan nog niet in de voorraad.</p>
                } @else {
                  <h3 id="mpo-actions-title">{{ actionTitle(data.order.status, data.costing.lines.length) }}</h3>
                  <p>{{ actionDescription(data.order.status, data.costing.lines.length) }}</p>
                }
              </div>
              <div class="ios-group">
                <a class="ios-cell" [routerLink]="['/purchasing', data.order.id, 'edit']" [queryParams]="editQuery()">
                  <span class="ios-cell__body"><span class="ios-cell__title">{{ data.costing.lines.length ? 'Order bewerken' : 'Producten toevoegen' }}</span></span>
                  <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                </a>
                <button class="ios-cell" type="button" (click)="pdfOpen.set(true)">
                  <span class="ios-cell__body"><span class="ios-cell__title">PDF downloaden</span></span>
                  <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                </button>
                <button class="ios-cell" type="button" [disabled]="!quoteLinesOf(data).length" (click)="quoteOpen.set(true)">
                  <span class="ios-cell__body"><span class="ios-cell__title">{{ data.order.partnerCustomerId ? 'Conceptvoorschotfacturen maken' : 'Verkoopofferte maken' }}</span></span>
                  <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                </button>
              </div>
            </section>

            <section class="ios-section" aria-labelledby="mpo-order-title">
              <div class="ios-section__head"><h2 id="mpo-order-title">Order</h2></div>
              <div class="ios-group">
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Leverancier</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value mpo-value">{{ supplierName() }}</span></span></div>
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Orderdatum</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value mpo-value">{{ data.order.orderDate | dateNl }}</span></span></div>
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Gemaakt door</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value mpo-value">{{ creatorName(data) }}</span></span></div>
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Betaalplan</span>
                  <span class="ios-cell__sub mpo-wrap">{{ planLabel() }}</span></span></div>
                @if (data.order.trackingReference) {
                  <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Track &amp; trace</span></span>
                    <span class="ios-cell__trail"><span class="ios-cell__value mpo-value mono">{{ data.order.trackingReference }}</span></span></div>
                }
                @if (data.order.status === 'ONTVANGEN' && data.order.receivedOn) {
                  <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Ontvangen op</span></span>
                    <span class="ios-cell__trail"><span class="ios-cell__value mpo-value">{{ data.order.receivedOn | dateNl }}</span></span></div>
                }
              </div>
            </section>

            <section class="ios-section" aria-labelledby="mpo-route-title">
              <div class="ios-section__head"><h2 id="mpo-route-title">Route en container</h2></div>
              <div class="ios-group">
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Route</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value mpo-value">{{ routeText() }}</span></span></div>
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Container</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value mpo-value">{{ containerLabel(data.order.containerType) }}</span></span></div>
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Lossen op</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value mpo-value">{{ receivingLocationName(data.order.receivingLocationId) }}</span></span></div>
              </div>
            </section>

            <div class="mpo-partner">
              <app-purchase-partner-panel [order]="data.order" [docs]="partnerDocs()" [advanceBasisEur]="data.costing.totals.totalWithSeparateCostsEur ?? null" [canQuote]="quoteLinesOf(data).length > 0" [canAuction]="auctionLines().length > 0" (saved)="onPartnerSaved($event)" (quote)="quoteOpen.set(true)" (link)="partnerSheetOpen.set(true)" (auction)="auctionOpen.set(true)" (schedule)="scrollToCard('purchase-partner-section', 'purchase-payments-section')" (unlink)="unlinkPartnerDoc($event)" />
            </div>
          </section>

          <!-- ===== Producten ===== -->
          <section class="mpo-pane" id="mpo-pane-producten" role="tabpanel" aria-label="Producten" [hidden]="activeTab() !== 'producten'">
            <div id="purchase-products-section" tabindex="-1" aria-labelledby="mpo-products-title">
              <div class="mpo-head">
                <span class="ios-tile ios-tile--lg ios-tile--soft tone-accent" aria-hidden="true"><app-icon name="products" [size]="19" /></span>
                <div class="mpo-head__copy"><h2 id="mpo-products-title">Producten</h2>
                  <p>{{ data.costing.lines.length }} regels · {{ data.costing.totals.pieces | num }} st · {{ data.costing.totals.cartons | num }} dozen</p></div>
              </div>

              @if (isDdp()) {
                <!-- DDP: the supplier's container - its fill is their concern. -->
                <section class="ios-card mpo-fill" id="purchase-capacity-section" tabindex="-1" aria-label="Lading">
                  <div class="mpo-fill__top">
                    <div class="mpo-fill__copy"><h3 class="mpo-fill__title">Geleverd DDP</h3>
                      <p class="mpo-fill__sub">{{ data.costing.totals.cbm | cbm }} · {{ data.costing.totals.cartons | num }} dozen · transport en rechten in de prijs</p></div>
                    <strong class="mpo-fill__pct">{{ data.costing.totals.pieces | num }} st</strong>
                  </div>
                </section>
              } @else if (data.costing.containerFill; as fill) {
                <section class="ios-card mpo-fill" id="purchase-capacity-section" tabindex="-1" aria-labelledby="mpo-fill-title">
                  <div class="mpo-fill__top">
                    <div class="mpo-fill__copy"><h3 class="mpo-fill__title" id="mpo-fill-title">Containervulling</h3>
                      <p class="mpo-fill__sub">{{ fill.containerCode }} · {{ fill.usedCbm | cbm }} van {{ fill.capacityCbm | cbm }}</p></div>
                    <strong class="mpo-fill__pct" [class.fill-pct--over]="fill.fillPercent > 100 && fill.fillPercent <= 105" [class.fill-pct--danger]="fill.fillPercent > 105"
                            [class.fill-pct--full]="fill.overflowCbm <= 0 && fill.fillPercent >= 97">{{ fill.fillPercent | pct: 0 }}</strong>
                  </div>
                  <div class="wk-meter" role="meter" aria-label="Containervulling" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="fill.fillPercent">
                    <i [class.tone-ok]="fill.fillPercent <= 100" [class.tone-warn]="fill.fillPercent > 100 && fill.fillPercent <= 105" [class.tone-danger]="fill.fillPercent > 105"
                       [style.width.%]="fillWidth(fill.fillPercent)"></i>
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

              <div class="mpo-rate">
                <span>Geland · 1 USD = {{ usdToEurRate() | num: 4 }} EUR</span>
                @if (data.costing.lines.length) {
                  <app-segmented variant="ios" label="Bedragen tonen als" [options]="amountModes" [value]="perPiece() ? 'piece' : 'total'" (changed)="perPiece.set($event === 'piece')" />
                }
              </div>

              @for (section of lineSections(); track section.key) {
                <section class="ios-section" [attr.aria-labelledby]="categoryHeadingId(section.key)">
                  <div class="ios-section__head"><h2 [id]="categoryHeadingId(section.key)">{{ section.name }}</h2>
                    <span class="ios-section__trail">{{ section.groups.length }} {{ section.groups.length === 1 ? 'model' : 'modellen' }} · {{ section.lineCount }} {{ section.lineCount === 1 ? 'variant' : 'varianten' }}</span></div>
                  <div class="ios-group ios-group--thumbs">
                    @for (group of section.groups; track group.key) {
                      <button class="ios-cell mpo-model" type="button" [id]="productGroupPanelId(group.key) + '-toggle'"
                              [attr.aria-expanded]="group.standalone ? null : productGroupOpen(group.key)"
                              [attr.aria-controls]="group.standalone ? null : productGroupPanelId(group.key)"
                              (click)="group.standalone ? lineSheet.set(group.entries[0].line.productId) : toggleProductGroup(group.key)">
                        <span class="ios-cell__lead">
                          @if (group.photoUrl; as photo) { <img class="ios-thumb" [appAuthSrc]="photo" alt="" /> }
                          @else { <span class="ios-thumb mpo-thumb--empty" aria-hidden="true">◈</span> }
                        </span>
                        <span class="ios-cell__body">
                          <span class="ios-cell__title ios-cell__title--strong mpo-wrap">{{ group.name }}</span>
                          <span class="ios-cell__sub mpo-model__kind">{{ group.standalone ? 'Product' : 'Productmodel' }} · {{ group.entries.length }} {{ group.entries.length === 1 ? 'variant' : 'varianten' }}
                            @if (group.swatches.length) {
                              <span class="mpo-swatches" aria-label="Kleuren in dit model">
                                @for (swatch of group.swatches.slice(0, 8); track swatch.label) {
                                  <i class="product-colour-dot" [class.product-colour-dot--empty]="!swatch.hex" [style.background]="swatch.hex || 'transparent'" [title]="swatch.label"></i>
                                }
                                @if (group.swatches.length > 8) { <small>+{{ group.swatches.length - 8 }}</small> }
                              </span>
                            }
                          </span>
                          <span class="ios-cell__sub mpo-wrap">{{ group.totals.pieces | num }} st · {{ group.totals.cartons | num }} dozen · {{ group.totals.cbm | cbm }}</span>
                        </span>
                        <span class="ios-cell__trail">
                          <span class="ios-cell__value ios-cell__value--strong">{{ perPiece() ? landedRangeText(group.totals.unitMinEur, group.totals.unitMaxEur) : (group.totals.totalEur | eur) }}</span>
                          <span class="ios-cell__meta">{{ perPiece() ? 'Geland / stuk' : 'Totaal geland' }}</span>
                        </span>
                        <app-icon class="ios-cell__chev" [name]="group.standalone ? 'chevron-right' : productGroupOpen(group.key) ? 'chevron-up' : 'chevron-down'" [size]="16" />
                      </button>
                      @if (!group.standalone && productGroupOpen(group.key)) {
                        <div class="mpo-variants" [id]="productGroupPanelId(group.key)" role="region" [attr.aria-labelledby]="productGroupPanelId(group.key) + '-toggle'">
                          @for (entry of group.entries; track entry.line.productId) {
                            @let display = setPiecesOf(entry.line.productId);
                            <button class="ios-cell mpo-variant" type="button" (click)="lineSheet.set(entry.line.productId)">
                              <span class="ios-cell__lead">
                                @if (photoOf(entry.line.productId); as url) { <img class="ios-thumb ios-thumb--sm" [appAuthSrc]="url" alt="" /> }
                                @else { <span class="ios-thumb ios-thumb--sm mpo-thumb--empty" aria-hidden="true">◈</span> }
                              </span>
                              <span class="ios-cell__body">
                                <span class="ios-cell__title mpo-wrap">{{ variantTitle(entry.product, entry.line.productName) }}</span>
                                <span class="ios-cell__sub mpo-wrap">{{ entry.line.quantity | num }} st · {{ entry.line.cartons | num }} dozen · {{ entry.line.cbm | cbm }}</span>
                              </span>
                              <span class="ios-cell__trail">
                                @if (perPiece()) {
                                  <span class="ios-cell__value">{{ entry.line.landedUnitEur | eurUp: 3 }}</span>
                                  @if (display) { <span class="ios-cell__meta">/display · {{ entry.line.landedUnitEur / display | eurUp: 3 }} /stuk</span> }
                                } @else {
                                  <span class="ios-cell__value">{{ entry.line.totalEur | eur }}</span>
                                }
                              </span>
                              <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                            </button>
                          }
                        </div>
                      }
                    }
                  </div>
                </section>
              } @empty {
                <div class="ios-empty">
                  <span class="ios-empty__icon" aria-hidden="true"><app-icon name="products" [size]="26" /></span>
                  <h3 class="ios-empty__title">Nog geen producten geladen</h3>
                  <p class="ios-empty__text">Voeg producten en aantallen toe om de containervulling en kostprijs te berekenen.</p>
                  <a class="ios-capsule ios-capsule--accent" [routerLink]="['/purchasing', data.order.id, 'edit']" [queryParams]="{ tab: 'producten' }">Producten toevoegen</a>
                </div>
              }
            </div>
          </section>

          <!-- ===== Kosten ===== -->
          <section class="mpo-pane" id="mpo-pane-kosten" role="tabpanel" aria-label="Kosten" [hidden]="activeTab() !== 'kosten'">
            <div id="purchase-costs-section" tabindex="-1" aria-labelledby="mpo-costs-title">
              <div class="mpo-head">
                <span class="ios-tile ios-tile--lg ios-tile--soft tone-teal" aria-hidden="true"><app-icon name="tag" [size]="19" /></span>
                <div class="mpo-head__copy"><h2 id="mpo-costs-title">Kosten</h2><p>Gelande kostprijs · interne calculatie</p></div>
                <span class="wk-pill tone-grey">Intern</span>
              </div>
              @if (!isDdp()) {
                <!-- What the road adds on top of the goods - the figure a buyer negotiates on; the total is the star. -->
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
                    <span class="ios-cell__sub mpo-wrap">{{ data.costing.totals.goodsUsd | num: 2 }} USD{{ isDdp() ? ' · transport en rechten inbegrepen' : '' }}</span></span>
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
                  @if (data.costing.totals.separateCostsEur) {
                    @if (data.costing.totals.inspectionEur) {
                      <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Inspectie</span>
                        <span class="ios-cell__sub">{{ separateInPiece() ? 'in de stukprijs verdeeld' : 'apart' }}</span></span>
                        <span class="ios-cell__trail"><span class="ios-cell__value mpo-amount">{{ data.costing.totals.inspectionEur | eur }}</span></span></div>
                    }
                    @for (cost of data.costing.totals.otherCosts ?? []; track $index) {
                      <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title mpo-wrap">{{ cost.label }}</span>
                        <span class="ios-cell__sub">{{ separateInPiece() ? 'in de stukprijs verdeeld' : 'apart' }}</span></span>
                        <span class="ios-cell__trail"><span class="ios-cell__value mpo-amount">{{ cost.amountEur | eur }}</span></span></div>
                    }
                    <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--strong mpo-wrap">{{ separateCostsTotalLabel(data.costing.totals) }}</span></span>
                      <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">{{ data.costing.totals.totalWithSeparateCostsEur | eur }}</span></span></div>
                  }
                </div>
              </section>
              <section class="ios-section">
                <div class="ios-section__head"><h2>3 · Totaal</h2></div>
                <div class="ios-group">
                  <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--strong">Totaal geland</span></span>
                    <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong mpo-accent">{{ data.costing.totals.totalEur | eur }}</span></span></div>
                </div>
                <p class="ios-section__foot">Koers 1 USD = {{ usdToEurRate() | num: 4 }} EUR</p>
              </section>
            </div>

            <!-- Nacalculatie: what the container really cost, complete and never collapsed. Recording and settling happen in the editor. -->
            <section class="mpo-result mpo-host" id="purchase-result-section" tabindex="-1" aria-label="Nacalculatie">
              <app-purchase-nacalc-overview mode="read" [view]="data" [ledger]="paymentLedger()" [nacalc]="nacalc()" [partner]="partnerFinancing()"
                [state]="paymentState()" [error]="paymentsError()" [orderId]="data.order.id"
                (openPayee)="openPayee($event)" (pay)="recordPayment($event)" (settle)="settleInEditor()"
                (openPayments)="scrollToCard('purchase-payments-section', 'purchase-payments-section')"
                (openPartner)="scrollToCard('purchase-partner-section', 'purchase-payments-section')"
                (openReports)="scrollToCard('purchase-reports-section', 'purchase-files-section')"
                (applyCosts)="openStep('KOSTPRIJZEN')"
                (refresh)="reloadPayments()" (refreshPartner)="loadPartnerFinancing()" (credit)="noteCreditInEditor()" />
            </section>
          </section>

          <!-- ===== Betalingen ===== -->
          <section class="mpo-pane" id="mpo-pane-betalingen" role="tabpanel" aria-label="Betalingen" [hidden]="activeTab() !== 'betalingen'">
            <!-- Money out, per payee: supplier, forwarder and customs, inspection,
                 and the bijkomende kosten of paying. Recording opens the editor. -->
            <section class="mpo-host purchase-payments-plain" id="purchase-payments-section" tabindex="-1" aria-label="Betalingen">
              <app-purchase-payment-overview mode="read" [ledger]="paymentLedger()" [state]="paymentState()" [error]="paymentsError()"
                [planLabel]="planLabel()" [supplierName]="supplierName()" [nacalc]="nacalcSummary()" [bankLineLabel]="bankLineLabel"
                (add)="recordPayment($event)" (download)="downloadDocument($event)" (invoiceFile)="openDocumentFile($event)" (refresh)="reloadPayments()" (openEditor)="editPayments()"
                (openCosts)="scrollToCard('purchase-result-section', 'purchase-costs-section')" />
            </section>
            <!-- Money in: a partner who co-finances the container. -->
            @if (data.order.partnerCustomerId != null) {
              <section class="mpo-host" id="purchase-partner-section" tabindex="-1" aria-label="Partnerfinanciering">
                <app-purchase-partner-payments (quote)="quoteOpen.set(true)" (changed)="reloadPartnerDocs()" (creditNote)="creditNoteOpen.set(true)" [order]="data.order" [docs]="partnerDocs()" [advanceBasisEur]="data.costing.totals.totalWithSeparateCostsEur ?? null" />
              </section>
            }
          </section>

          <!-- ===== Dossier ===== -->
          <section class="mpo-pane" id="mpo-pane-dossier" role="tabpanel" aria-label="Dossier" [hidden]="activeTab() !== 'dossier'">
            <div id="purchase-files-section" tabindex="-1">
              @if (data.order.notes) {
                <!-- The container's diary: agreements, the receipt, the booking and every payment. -->
                <section class="ios-section" aria-labelledby="mpo-diary-title">
                  <div class="ios-section__head"><h2 id="mpo-diary-title">Dagboek</h2></div>
                  <div class="ios-card mpo-diary"><app-diary [notes]="data.order.notes" /></div>
                </section>
              }
              @if (data.receiptReports?.length) {
                <section class="ios-section" id="purchase-reports-section" tabindex="-1" aria-labelledby="mpo-reports-title">
                  <div class="ios-section__head"><h2 id="mpo-reports-title">Schade en tekorten</h2>
                    <span class="ios-section__trail">{{ data.receiptReports!.length }} melding{{ data.receiptReports!.length === 1 ? '' : 'en' }}</span></div>
                  <div class="ios-group">
                    @for (report of data.receiptReports; track $index) {
                      <div class="ios-cell ios-cell--tall mpo-report">
                        <span class="ios-cell__body">
                          <span class="ios-cell__title mpo-wrap">{{ report.productName }} <span class="wk-pill" [class.tone-accent]="report.source === 'LATER'">{{ report.source === 'LATER' ? 'Na uitpakken' : 'Bij ontvangst' }}</span></span>
                          <span class="ios-cell__sub mpo-wrap">{{ report.sku || '' }}{{ report.on ? ' · ' + (report.on | dateNl) : '' }}{{ report.actor ? ' · ' + report.actor : '' }}</span>
                          @if (report.note) { <span class="ios-cell__sub mpo-wrap mpo-report__note">{{ report.note }}</span> }
                        </span>
                        <span class="ios-cell__trail"><span class="ios-cell__value mpo-value danger-text">@if (report.damaged) { {{ report.damaged | num }} beschadigd }@if (report.damaged && report.missing) { · }@if (report.missing) { {{ report.missing | num }} te weinig }</span></span>
                      </div>
                    }
                  </div>
                  <p class="ios-section__foot">Staat als waarschuwing op de volgende leveranciersorder van deze producten.</p>
                </section>
              }
              <section class="ios-section" aria-labelledby="mpo-docs-title">
                @let docs = documents() ?? [];
                <div class="ios-section__head"><h2 id="mpo-docs-title">Documenten</h2>
                  <span class="ios-section__trail">{{ docs.length }} {{ docs.length === 1 ? 'bestand' : 'bestanden' }}</span></div>
                <div class="ios-group">
                  @for (doc of docs; track doc.id) {
                    <div class="ios-cell">
                      <span class="ios-cell__body">
                        <span class="ios-cell__title mpo-wrap">{{ doc.kindLabel }}{{ doc.label ? ' · ' + doc.label : '' }}</span>
                        <span class="ios-cell__sub mpo-wrap">{{ doc.originalFilename }} · {{ doc.addedAt | dateNl }}@if (doc.actor) { · {{ actorLabel(doc.actor) }} }</span>
                      </span>
                      <button class="ios-capsule ios-capsule--sm ios-capsule--tinted" type="button" (click)="downloadDocument(doc)">Openen</button>
                    </div>
                  } @empty {
                    <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__sub mpo-wrap">Nog geen bestanden bij deze container.</span></span></div>
                  }
                  <a class="ios-cell" routerLink="/files" [queryParams]="{ view: 'purchase', doel: data.order.id }">
                    <span class="ios-cell__body"><span class="ios-cell__title mpo-link">In Documenten &amp; media</span></span>
                    <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                  </a>
                </div>
              </section>
              <div class="mpo-host">
                <app-purchase-sales-links [documents]="relatedSalesDocs()" [excludePartner]="data.order.partnerCustomerId != null" />
                <app-purchase-activity [orderId]="data.order.id" [collapsible]="true" />
              </div>
            </div>
          </section>
        </div>

        <nav class="erp-workspace__mobile-actions mpo-dock" aria-label="Containeracties">
          @if (readStep(); as step) {
            <a class="btn mpo-dock__edit" [routerLink]="['/purchasing', data.order.id, 'edit']" [queryParams]="{ tab: tabParam(activeTab()) }">
              <app-icon name="pencil" [size]="17" />Bewerken</a>
            <button class="btn btn--primary erp-workspace__primary" type="button" (click)="openStep(step)">{{ STEP_BUTTON[step] }}</button>
          } @else {
            <a class="btn btn--primary erp-workspace__primary" [routerLink]="['/purchasing', data.order.id, 'edit']" [queryParams]="editQuery()">Bewerken</a>
          }
        </nav>
      </div>

      <!-- Sheets and menus at host level: never inside the sticky nav, the tabs or a pane. -->
      @if (moreMenu()) {
        <app-context-menu title="Container" variant="ios" cancelLabel="Annuleren" [items]="moreItems()" (pick)="pickMore($event)" (closed)="moreMenu.set(false)" />
      }
      @if (stepOpen(); as step) {
        <app-purchase-step-confirm-sheet [text]="stepText(step)" [tracking]="data.order.trackingReference ?? ''" [busy]="false"
                                         (cancel)="stepOpen.set(null)" (confirmed)="confirmStep($event)" />
      }
      @if (lineSheetLine(); as sheet) {
        @let entry = sheet.entry;
        @let display = setPiecesOf(entry.line.productId);
        <app-sheet title="Productregel" variant="ios" (closed)="lineSheet.set(null)">
          <div body class="mpo-sheet">
            <div class="ios-group ios-group--thumbs">
              <div class="ios-cell ios-cell--tall">
                <span class="ios-cell__lead">
                  @if (photoOf(entry.line.productId); as url) { <img class="ios-thumb" [appAuthSrc]="url" alt="" /> }
                  @else { <span class="ios-thumb mpo-thumb--empty" aria-hidden="true">◈</span> }
                </span>
                <span class="ios-cell__body">
                  <span class="ios-cell__title ios-cell__title--strong ios-cell__title--2">{{ sheet.group.standalone ? entry.line.productName : variantTitle(entry.product, entry.line.productName) }}</span>
                  <span class="ios-cell__sub mpo-wrap">@if (sheet.group.standalone) { Regel {{ entry.displayIndex }} · {{ sheet.section.name }} } @else { Variant {{ sheet.index + 1 }} van {{ sheet.group.entries.length }} }@if (entry.product?.sku; as sku) { · <span class="mono">{{ sku }}</span> }</span>
                  @if (entry.product?.colour || entry.product?.variantSize) {
                    <span class="ios-cell__sub mpo-wrap">@if (entry.product?.colour; as colour) { <i class="product-colour-dot" [class.product-colour-dot--empty]="!colourHex(entry.product)" [style.background]="colourHex(entry.product) || 'transparent'" aria-hidden="true"></i> {{ colour }} }@if (entry.product?.colour && entry.product?.variantSize) { · }{{ entry.product?.variantSize }}</span>
                  }
                </span>
              </div>
            </div>
            <div class="ios-group">
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Aantal</span></span><span class="ios-cell__trail"><span class="ios-cell__value mpo-amount">{{ entry.line.quantity | num }} st</span></span></div>
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Dozen</span></span><span class="ios-cell__trail"><span class="ios-cell__value mpo-amount">{{ entry.line.cartons | num }}</span></span></div>
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Volume</span></span><span class="ios-cell__trail"><span class="ios-cell__value mpo-amount">{{ entry.line.cbm | cbm }}</span></span></div>
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">{{ display ? 'Geland / display' : 'Geland / stuk' }}</span></span>
                <span class="ios-cell__trail"><span class="ios-cell__value mpo-amount">{{ entry.line.landedUnitEur | eurUp: 3 }}</span>
                  @if (display) { <span class="ios-cell__meta">{{ entry.line.landedUnitEur / display | eurUp: 3 }} /stuk</span> }</span></div>
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--strong">Regeltotaal</span></span><span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">{{ entry.line.totalEur | eur }}</span></span></div>
            </div>
            @if (data.order.status !== 'ONTVANGEN') {
              @if (cartonNotice(entry.line.quantity, entry.line.productId); as cartonNote) { <p class="ios-section__foot">{{ cartonNote }}</p> }
            } @else {
              <div class="ios-group mpo-sheet__gap">
                <button class="ios-cell ios-cell--action" type="button" (click)="lineSheet.set(null); openIssue(entry.line.productId, entry.line.productName)">Schade of tekort melden</button>
              </div>
            }
            <section class="ios-section mpo-sheet__section">
              <div class="ios-section__head"><h2>Kostopbouw</h2></div>
              <div class="mpo-sheet__seg"><app-segmented variant="ios" label="Kostopbouw tonen als" [options]="lineModes" [value]="perPiece() ? 'piece' : 'line'" (changed)="perPiece.set($event === 'piece')" /></div>
              <div class="ios-group">
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Goederen</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value mpo-amount">{{ amt(entry.line.goodsEur, entry.line) | eurUp: decimals() }}</span></span></div>
                @if (entry.line.originEur) {
                  <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title mpo-wrap">{{ costLabels().originCostsLabel }}</span><span class="ios-cell__sub mpo-wrap">{{ costLabels().originRoute }}</span></span>
                    <span class="ios-cell__trail"><span class="ios-cell__value mpo-amount">{{ amt(entry.line.originEur, entry.line) | eurUp: decimals() }}</span></span></div>
                }
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title mpo-wrap">{{ costLabels().seaFreightLabel }}</span><span class="ios-cell__sub mpo-wrap">{{ costLabels().seaFreightRoute }}</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value mpo-amount">{{ amt(entry.line.freightEur, entry.line) | eurUp: decimals() }}</span></span></div>
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--strong">Douanewaarde</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">{{ amt(entry.line.customsValueEur, entry.line) | eurUp: decimals() }}</span></span></div>
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Invoerrecht {{ entry.line.dutyRatePct | pct: 1 }}</span>
                  @if (entry.line.dutySource) { <span class="ios-cell__sub mpo-wrap">({{ entry.line.dutySource }})</span> }</span>
                  <span class="ios-cell__trail"><span class="ios-cell__value mpo-amount">{{ amt(entry.line.dutyEur, entry.line) | eurUp: decimals() }}</span></span></div>
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title mpo-wrap">{{ costLabels().destinationCostsLabel }}</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value mpo-amount">{{ amt(entry.line.destinationEur, entry.line) | eurUp: decimals() }}</span></span></div>
                @if (entry.line.extraRevenueEur) {
                  <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Enrosed kost</span></span>
                    <span class="ios-cell__trail"><span class="ios-cell__value mpo-amount">{{ amt(entry.line.extraRevenueEur, entry.line) | eurUp: decimals() }}</span></span></div>
                }
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--strong">{{ perPiece() ? (display ? 'Geland per display' : 'Geland per stuk') : 'Geland totaal' }}</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong mpo-accent">{{ perPiece() ? (entry.line.landedUnitEur | eurUp: 3) : (entry.line.totalEur | eur) }}</span>
                    @if (perPiece() && display) { <span class="ios-cell__meta">{{ entry.line.landedUnitEur / display | eurUp: 3 }} /stuk</span> }</span></div>
              </div>
            </section>
            <div class="ios-group">
              <a class="ios-cell" [routerLink]="['/products', entry.line.productId]">
                <span class="ios-cell__body"><span class="ios-cell__title mpo-link">Product openen</span></span>
                <app-icon class="ios-cell__chev" name="external" [size]="16" />
              </a>
            </div>
          </div>
          <div foot style="display:contents"><button class="btn btn--primary" type="button" (click)="lineSheet.set(null)">Klaar</button></div>
        </app-sheet>
      }
      @if (quoteOpen()) {
        <app-purchase-quote-sheet [advanceBasisEur]="data.costing.totals.totalWithSeparateCostsEur ?? null" [reconciliation]="data.reconciliation" [order]="data.order" [lines]="quoteLinesOf(data)" [presetCustomerId]="data.order.partnerCustomerId ?? null" [presetCostPct]="data.order.partnerCostPct ?? null" [presetSharePct]="data.order.partnerSharePct ?? null" (closed)="quoteOpen.set(false)" />
      }
      @if (partnerSheetOpen()) {
        <app-purchase-partner-sheet [order]="data.order" [currentShare]="partnerDocs()[0]?.order?.partnerSharePct ?? null" (closed)="partnerSheetOpen.set(false)" (linked)="reloadPartnerDocs()" />
      }
      @if (auctionOpen()) {
        <app-auction-settlement-sheet [lines]="auctionLines()" [customerId]="partnerDocs()[0]?.order?.customerId ?? data.order.partnerCustomerId ?? null" [customerName]="partnerCompany()"
                                      [purchaseOrderId]="data.order.id" [reference]="containerName(data.order)" [sourceId]="auctionSourceId()"
                                      [costSharePct]="auctionCostShare()" [separateUnitEur]="separateUnitEur()" [profitSharePct]="auctionProfitShare()"
                                      (funding)="scrollToCard('purchase-partner-section', 'purchase-payments-section')" (closed)="auctionOpen.set(false)" />
      }
      @if (creditNoteOpen()) {
        <app-sales-credit-note-sheet [purchaseOrderId]="data.order.id" (closed)="creditNoteOpen.set(false)" />
      }
      @if (pdfOpen()) {
        <app-purchase-pdf-sheet [orderId]="data.order.id" [orderNumber]="data.order.number"
                                [separateCosts]="hasSeparateCosts(data.order)"
                                (closed)="pdfOpen.set(false)" />
      }
      @if (issue(); as report) {
        <app-sheet [title]="'Schade of tekort · ' + report.productName" (closed)="issue.set(null)">
          <div body>
            <div class="per-toggle" role="group" aria-label="Wat is er aan de hand?">
              <button type="button" [class.on]="report.kind === 'DAMAGED'"
                      (click)="issue.set({ ...report, kind: 'DAMAGED' })">Beschadigd</button>
              <button type="button" [class.on]="report.kind === 'SHORT'"
                      (click)="issue.set({ ...report, kind: 'SHORT' })">Minder aangekomen</button>
            </div>
            <div class="field mt-12">
              <label class="req" for="pv-issue-qty">Aantal stuks</label>
              <input class="input num right" id="pv-issue-qty" type="number" min="1" step="1" inputmode="numeric"
                     [value]="report.quantity || ''" (input)="issue.set({ ...report, quantity: +$any($event.target).value })" />
            </div>
            <div class="field mt-8">
              <label for="pv-issue-note">Wat was er mis? <span class="opt"></span></label>
              <textarea class="textarea" id="pv-issue-note" rows="2" placeholder="bijv. glazen stolpen gebarsten"
                        [value]="report.note" (input)="issue.set({ ...report, note: $any($event.target).value })"></textarea>
              <span class="hint">Blijft bij het product staan en komt op de volgende leveranciersorder.</span>
            </div>
            @if (issueLine(); as line) {
              <p class="hint mt-8">
                @if (report.kind === 'DAMAGED') {
                  Nu {{ line.damagedQuantity ?? 0 }} beschadigd van {{ line.quantity | num }} ontvangen; wat erbij komt gaat als beschadigd uit de voorraad.
                } @else {
                  Ontvangen telt nu {{ line.quantity | num }} stuks; het verschil gaat uit de voorraad.
                }
              </p>
            }
          </div>
          <div foot style="display:contents">
            <span class="spacer"></span>
            <button class="btn" type="button" (click)="issue.set(null)">Annuleren</button>
            <button class="btn btn--primary" type="button" [disabled]="issueBusy() || !(report.quantity > 0)" (click)="confirmIssue()">
              {{ issueBusy() ? 'Bezig…' : 'Melden' }}
            </button>
          </div>
        </app-sheet>
      }
    } @else {
      <div class="mpo-phone mpo-phone--view">
        <app-ios-nav title="Inkoop" [largeTitle]="false" backLabel="" backAriaLabel="Terug" (back)="goBack()" />
        <div class="mpo-loading" role="status" aria-live="polite" aria-label="Inkooporder laden">
          <app-skeleton kind="card" [rows]="3" />
          <app-skeleton kind="lines" [rows]="4" />
        </div>
      </div>
    }
  `,
  styles: `
    :host{display:block;min-width:0}
  `,
})
export class PurchaseView {
  /** One name for the container in sales texts: alias, else number. */
  readonly containerName = containerName;
  readonly pdfOpen = signal(false);
  readonly quoteOpen = signal(false);
  readonly quoteLinesOf = quoteLinesOf;
  /** The section the screen shows: a tab's root, or a deep link's card (the screen sets it for ?section=). */
  readonly workspaceSection = signal<string>('purchase-overview');
  private readonly location = inject(Location);
  private readonly routerNav = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  /** Focusing a tab never moves the page, also just before the bar sticks. */
  private readonly tabFocusKept = inject(DestroyRef).onDestroy(keepPhoneTabFocusInPlace(this.host.nativeElement));
  private readonly stepHandoff = inject(PurchaseStepHandoff);

  goBack(): void {
    if (window.history.length <= 1) { void this.routerNav.navigateByUrl('/purchasing'); return; }
    this.location.back();
  }

  /* ---- the five tabs ------------------------------------------------- */

  /** ?tab= from the route; Overzicht when absent. */
  readonly tab = input<string>();
  /** ?section= from the route (PurchaseScreen acts on it): a deep link's card wins over ?tab=. */
  readonly section = input<string>();
  readonly activeTab = computed<PhoneTab>(() => tabOfSection(this.workspaceSection()));
  readonly tabOptions = computed<SegmentOption[]>(() => {
    const data = this.view();
    return tabSegments({
      producten: !!data && productsDot(data),
      betalingen: paymentsDot(this.paymentLedger()?.summary, this.paymentState()),
    });
  });
  readonly tabParam = tabParam;

  /** Switches the tab in place: the URL follows without a history entry, a stuck bar stays stuck over the new pane's top. */
  selectTab(tab: PhoneTab, options: { scroll?: boolean } = {}): void {
    const stick = phoneStickPoint(this.host.nativeElement);
    const stuck = phoneTabsStuck(stick);
    this.workspaceSection.set(rootSectionOf(tab));
    replaceTabInUrl(this.location, tab);
    if (options.scroll !== false) keepPhoneTabsStuck(stick, stuck);
  }

  /** Tapping the tab that is already open, with the bar stuck, goes back to its top. */
  tabsClicked(event: Event): void {
    if (!tappedSelectedTab(event)) return;
    const stick = phoneStickPoint(this.host.nativeElement);
    if (phoneTabsStuck(stick)) scrollPhoneTabsTop(stick);
  }

  readonly containerLabel = containerLabel;
  readonly containerCountForFill = containerCountForFill;

  private readonly sourcing = inject(SourcingApi);
  private readonly sales = inject(SalesApi);
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);

  readonly id = input<string>('');
  readonly view = signal<PurchaseOrderView | null>(null);

  /* Damage or a shortage, reported from the phone at the shelf: the same
     line rewrite the desk does, saved as one order update. */
  readonly issue = signal<{ productId: number; productName: string; kind: 'DAMAGED' | 'SHORT'; quantity: number; note: string } | null>(null);
  readonly issueBusy = signal(false);
  readonly issueLine = computed<PurchaseOrderLine | null>(() => {
    const report = this.issue();
    if (!report) return null;
    return this.view()?.order.lines.find((line) => line.productId === report.productId) ?? null;
  });

  openIssue(productId: number, productName: string): void {
    const line = this.view()?.order.lines.find((item) => item.productId === productId);
    this.issue.set({ productId, productName, kind: 'DAMAGED', quantity: 0, note: line?.issueNote ?? '' });
  }

  async confirmIssue(): Promise<void> {
    const data = this.view();
    const report = this.issue();
    const line = this.issueLine();
    if (!data || !report || !line || !(report.quantity > 0) || this.issueBusy()) return;
    let patch: Partial<PurchaseOrderLine>;
    const issueNote = report.note.trim() || line.issueNote || null;
    if (report.kind === 'DAMAGED') {
      const damaged = (line.damagedQuantity ?? 0) + report.quantity;
      if (damaged > line.quantity) { this.ui.toast('Meer beschadigd dan ontvangen kan niet', 'err'); return; }
      patch = { damagedQuantity: damaged, issueNote };
    } else {
      const quantity = line.quantity - report.quantity;
      if (quantity < 0) { this.ui.toast('Zoveel stuks staan er niet op de regel', 'err'); return; }
      if (quantity < (line.damagedQuantity ?? 0)) { this.ui.toast('Minder dan het aantal beschadigde stuks kan niet', 'err'); return; }
      patch = { quantity, issueNote };
    }
    this.issueBusy.set(true);
    try {
      const order = {
        ...data.order,
        lines: data.order.lines.map((item) => item.productId === report.productId ? { ...item, ...patch } : item),
      };
      this.view.set(await this.sourcing.updatePurchaseOrder(data.order.id, order));
      this.issue.set(null);
      this.ui.toast(report.kind === 'DAMAGED' ? 'Schade gemeld en uit de voorraad geboekt' : 'Tekort gemeld en uit de voorraad geboekt');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Melden mislukt'), 'err');
    } finally {
      this.issueBusy.set(false);
    }
  }
  /** Prefer the server aggregate; derive a compatible fallback during a rolling deployment. */
  readonly receiptSummary = computed<ReceiptVarianceTotals | null>(() => {
    const data = this.view();
    if (!data || data.order.status !== 'ONTVANGEN') return null;
    if (data.receiptVariance) return data.receiptVariance;
    const metrics = receiptMetrics(data.order.lines.map((line) => ({
      orderedPieces: line.orderedQuantity ?? line.quantity,
      receivedPieces: line.quantity,
      damagedPieces: line.damagedQuantity ?? 0,
      unitValueEur: line.receiptUnitValueEur,
    })));
    return {
      affectedOrders: metrics.affectedLines > 0 ? 1 : 0,
      affectedLines: metrics.affectedLines,
      orderedPieces: metrics.orderedPieces,
      receivedPieces: metrics.receivedPieces,
      missingPieces: metrics.missingPieces,
      overReceivedPieces: metrics.overReceivedPieces,
      damagedPieces: metrics.damagedPieces,
      usablePieces: metrics.usablePieces,
      missingValueEur: metrics.missingValueEur,
      damagedValueEur: metrics.damagedValueEur,
      totalLossValueEur: metrics.totalLossValueEur,
      unvaluedLossPieces: metrics.unvaluedLossPieces,
      valuationComplete: metrics.valuationComplete,
    };
  });
  readonly receiptSnapshotComplete = computed(() => {
    const data = this.view();
    return !!data && data.order.lines.length > 0
      && data.order.lines.every((line) => line.orderedQuantity != null);
  });
  readonly payments = signal<PurchasePayment[] | null>(null);
  readonly paymentsError = signal<string | null>(null);
  readonly documents = signal<PurchaseDocument[] | null>(null);
  /** The document request failed: proof coverage is unknown, not missing. */
  readonly documentsFailed = signal(false);
  /** Sales documents of a partner who co-orders this container at our landed cost. */
  readonly partnerDocs = signal<SalesOrderView[]>([]);
  readonly relatedSalesDocs = signal<SalesOrderView[]>([]);
  /** The partner behind those documents, by company name. */
  readonly partnerCompany = signal('');
  readonly partnerSheetOpen = signal(false);
  readonly auctionOpen = signal(false);
  /** Lead seam: mounts app-sales-credit-note-sheet (partner mode) after the auction sheet. */
  readonly creditNoteOpen = signal(false);
  readonly partnerCustomer = signal<Customer | null>(null);
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
  readonly auctionSourceId = computed(() => this.partnerDocs().find((doc) => !isSettlementInvoice(doc.order))?.order.id ?? null);
  readonly auctionCostShare = computed(() => this.auctionSourceId() === null
    ? 100 : Math.min(100, Math.max(0, 100 - (this.partnerCustomer()?.partnerCostPct ?? 100))));
  readonly auctionProfitShare = computed(() => this.partnerDocs()[0]?.order.partnerSharePct ?? this.view()?.order.partnerSharePct ?? this.partnerCustomer()?.partnerSharePct ?? 50);

  private async loadPartnerDocs(id: number): Promise<void> {
    try {
      const all = await this.sales.orders();
      this.relatedSalesDocs.set(all.filter((view) => view.order.partnerPurchaseOrderId === id || view.order.sourcePurchaseOrderId === id));
      const deals = all.filter((view) => view.order.partnerPurchaseOrderId === id && view.order.purpose !== 'STANDARD');
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

  reloadPartnerDocs(): void {
    const id = this.view()?.order.id;
    if (id == null) return;
    void this.loadPartnerDocs(id);
    /* A linked document may have given the container its partner. */
    void this.sourcing.purchaseOrder(id).then((fresh) => {
      this.view.update((current) => current ? { ...current, order: { ...current.order,
        partnerCustomerId: fresh.order.partnerCustomerId ?? null, partnerCostPct: fresh.order.partnerCostPct ?? null, partnerSharePct: fresh.order.partnerSharePct ?? null } } : current);
      this.loadPartnerFinancing();
    }).catch(() => undefined);
  }

  /** The panel saved the partner: the fresh view replaces the old one, the documents and the financing follow. */
  onPartnerSaved(fresh: PurchaseOrderView): void {
    this.view.update((current) => current ? { ...current, order: fresh.order, costing: fresh.costing } : fresh);
    void this.loadPartnerDocs(fresh.order.id);
    this.loadPartnerFinancing();
  }

  /** The partner's money in, for the Nacalculatie's Partner block; fetched once per partner container and after a partner change. */
  readonly partnerFinancing = signal<PartnerFinancing | null | 'loading' | 'error'>(null);
  private partnerFinancingVersion = 0;

  loadPartnerFinancing(): void {
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

  /** The Nacalculatie in four lines for the Betalingen card, and the whole story for the Kosten tab. */
  readonly nacalcSummary = computed(() => {
    const data = this.view();
    return data ? purchaseNacalcSummary(data, this.paymentLedger()) : null;
  });
  readonly nacalc = computed(() => {
    const data = this.view();
    const partner = this.partnerFinancing();
    return data ? purchaseNacalc({ view: data, ledger: this.paymentLedger(), summary: this.nacalcSummary(),
      partner: partner === 'loading' || partner === 'error' ? null : partner }) : null;
  });

  /** Correcting or settling a payment happens in the editor: open it on Betalingen. */
  editPayments(): void {
    const id = this.view()?.order.id;
    if (id == null) return;
    void this.routerNav.navigate(['/purchasing', id, 'edit'], { queryParams: { section: 'ledger' } });
  }

  /** Credits are noted in the editor: it opens on the Tegoed noteren sheet. */
  noteCreditInEditor(): void {
    const id = this.view()?.order.id;
    if (id == null) return;
    void this.routerNav.navigate(['/purchasing', id, 'edit'], { queryParams: { section: 'credit' } });
  }

  /** Settling happens in the editor: open it on the Nacalculatie. */
  settleInEditor(): void {
    const id = this.view()?.order.id;
    if (id == null) return;
    void this.routerNav.navigate(['/purchasing', id, 'edit'], { queryParams: { section: 'payment-result' } });
  }

  unlinkPartnerDoc(doc: SalesOrderView): void {
    this.ui.confirm({
      title: 'Koppeling verwijderen',
      message: `${doc.order.number} telt daarna niet meer als partnerdocument van deze container.`,
      confirmLabel: 'Ontkoppelen', danger: true,
    }, async () => {
      try {
        await this.sales.setPartnerDeal(doc.order.id, { purchaseOrderId: null, sharePct: null, reference: null });
        this.ui.toast('Koppeling verwijderd');
        this.reloadPartnerDocs();
      } catch (failure: unknown) {
        this.ui.toast(messageOf(failure, 'Ontkoppelen mislukt'), 'err');
      }
    });
  }
  readonly statusLabel$ = STATUS_LABEL;

  /**
   * The plan's instalments against what was paid, as the editor shows them:
   * the money paid so far fills the steps in order, a partly covered step
   * asks the rest, the first unpaid step whose moment has come is due.
   */
  readonly plannedInstalments = computed(() => {
    const data = this.view();
    if (!data) return [];
    return purchaseInstalmentState(data, instalmentsOf(data.order, PAYMENT_TERMS), this.payments());
  });

  /** The same money-out picture as the editor and the desk, read-only here. */
  readonly paymentLedger = computed(() => {
    const data = this.view();
    if (!data || this.paymentsError()) return null;
    const totals = data.costing.totals;
    return purchasePaymentLedger({
      view: data, payments: this.payments(), documents: this.documentsFailed() ? null : this.documents(), terms: this.plannedInstalments(),
      settled: (payee) => purchaseGroupSettled(data, this.payments(), payee), toleranceEur: PAYMENT_TOLERANCE_EUR,
      totalLabel: totals.separateCostsEur ? separateCostsTotalLabel(totals) : 'Totaal geland',
      planLabel: this.planLabel(),
      bankedPaymentIds: this.bankedPaymentIds(),
    });
  });

  /* ---- the bank lines, once per order: older lines mark a container payment only by text ('containerbetaling #id') */
  private readonly banking = inject(BankingApi);
  private readonly bankAccounts = inject(BankAccountsStore);
  readonly bankLines = signal<BankStatementLine[]>([]);
  readonly bankedPaymentIds = computed(() => {
    const ids = new Set<number>();
    for (const markers of lineMarkers(this.bankLines()).values()) {
      for (const marker of markers) if (marker.kind === 'containerbetaling') ids.add(marker.id);
    }
    return ids;
  });
  /** '{account} · {dd/MM}' of a loaded bank line, for the bank pills of the payments. */
  readonly bankLineLabel = (lineId: number): string | null => {
    const line = this.bankLines().find(item => item.id === lineId);
    if (!line) return null;
    const account = this.bankAccounts.options().find(option => option.key === line.account)?.label ?? line.account;
    const day = bankTransactionDay(line);
    return `${account} · ${day.slice(8, 10)}/${day.slice(5, 7)}`;
  };
  private async loadBankLines(): Promise<void> {
    void this.bankAccounts.load();
    // A failure is ignored, as in the editor: the markers are a hint.
    try { this.bankLines.set(await this.banking.list()); } catch { /* without them only hard links count */ }
  }

  /** Opens a container file by id: an invoice's file or an invoice file without data. */
  async openDocumentFile(file: { documentId: number; name: string | null }): Promise<void> {
    const data = this.view();
    if (!data) return;
    const known = (this.documents() ?? []).find(doc => doc.id === file.documentId);
    if (known) { await this.downloadDocument(known); return; }
    try { saveBlob(await this.sourcing.documentFile(data.order.id, file.documentId), file.name || 'factuur'); }
    catch { this.ui.toast('Document openen mislukt', 'err'); }
  }
  readonly paymentState = computed<'loading' | 'error' | 'ready'>(() => this.paymentsError() ? 'error' : this.payments() === null ? 'loading' : 'ready');
  readonly planLabel = computed(() => {
    const order = this.view()?.order;
    return order ? paymentPlanLabel(order, PAYMENT_TERMS) : '';
  });

  /** Recording happens in the editor: it opens on the payment sheet and returns here once it closes. */
  recordPayment(action: PurchasePaymentAction): void {
    const id = this.view()?.order.id;
    if (id == null) return;
    void this.routerNav.navigate(['/purchasing', id, 'edit'], {
      queryParams: { section: 'pay', payee: action.payee, due: action.due ?? null }, replaceUrl: true,
    });
  }

  private readonly paymentOverview = viewChild(PurchasePaymentOverview);

  /** From the Nacalculatie: the payee's sheet on top of the payments card. */
  openPayee(payee: Payee): void {
    this.scrollToCard('purchase-payments-section', 'purchase-payments-section');
    this.paymentOverview()?.openPayee.set(payee);
  }

  /** Opens the tab a card lives on, then scrolls to it: a tab's root lands at the top under the stuck bar. */
  scrollToCard(elementId: string, nav: string): void {
    const tab = tabOfSection(nav);
    this.selectTab(tab, { scroll: false });
    requestAnimationFrame(() => {
      const target = document.getElementById(elementId);
      if (elementId === rootSectionOf(tab)) scrollPhoneTabsTop(phoneStickPoint(this.host.nativeElement));
      else target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target?.focus({ preventScroll: true });
    });
  }

  reloadPayments(): void {
    const id = this.view()?.order.id;
    if (id != null) void this.loadPayments(id);
  }

  private async loadPayments(id: number): Promise<void> {
    this.paymentsError.set(null);
    this.payments.set(null);
    try {
      const list = await this.sourcing.payments(id);
      if (Number(this.id()) === id) this.payments.set(list);
    } catch (failure: unknown) {
      if (Number(this.id()) === id) this.paymentsError.set(messageOf(failure, 'De betalingen konden niet worden geladen.'));
    }
  }

  async downloadDocument(doc: PurchaseDocument): Promise<void> {
    try { saveBlob(await this.sourcing.documentFile(doc.orderId, doc.id), doc.originalFilename); }
    catch { this.ui.toast('Document openen mislukt', 'err'); }
  }

  creatorName(data: PurchaseOrderView): string {
    return data.createdBy?.displayName || 'maker onbekend';
  }

  readonly partnerKind = partnerDocumentKind;

  actorLabel(actor: string): string {
    const canonical = actor.trim().toLocaleLowerCase('nl-BE');
    if (canonical === 'emre') return 'Emre';
    if (canonical === 'berat') return 'Berat';
    return actor;
  }
  private readonly products = signal<Product[]>([]);
  private readonly families = signal<ProductFamily[]>([]);
  private readonly categories = signal<Category[]>([]);
  private readonly suppliers = signal<Supplier[]>([]);

  readonly lineSections = computed(() =>
    purchaseLineSections(
      this.view()?.costing.lines ?? [],
      this.products(),
      this.categories(),
      this.families(),
      COLOUR_SWATCHES,
    ));

  /** Cost breakdown as totals or per piece. */
  readonly perPiece = signal(true);
  /** A series' landed figure per unit: one figure, or the range of its variants (F17). */
  readonly landedRangeText = landedRangeText;

  /** Two decimals for totals, four for per-piece - tiny numbers need them. */
  readonly decimals = computed(() => this.perPiece() ? 3 : 2);

  readonly openProductGroups = signal<ReadonlySet<string>>(new Set());

  constructor() {
    /* Carton notices speak the product's unit ("1 bowl meer"); "stuks" until the list arrives. */
    void this.catalog.unitNames().catch(() => undefined);
    effect(() => this.loadRouteOrder());
    effect(() => this.applyRouteTab());
  }

  /** The order the route names. Only the id reloads it: whatever load() reads (the tab) stays untracked. */
  private loadRouteOrder(): void {
    const orderId = Number(this.id());
    if (Number.isInteger(orderId) && orderId > 0) untracked(() => void this.load(orderId));
  }

  /**
   * A route with another ?tab= (Back onto this screen) opens that tab. A deep
   * link's ?section= in the same navigation wins: PurchaseScreen opens its
   * card, and this effect runs after the screen's.
   */
  private applyRouteTab(): void {
    const tab = parseTab(this.tab());
    const section = this.section();
    if (section === 'payments' || section === 'ledger' || section === 'payment-result') return;
    untracked(() => this.workspaceSection.set(rootSectionOf(tab)));
  }

  readonly stockLocations = signal<StockLocation[]>([]);

  receivingLocationName(id: number | null | undefined): string {
    const locations = this.stockLocations();
    const main = locations.find((location) => location.code === 'MAIN') ?? locations[0];
    return locations.find((location) => location.id === (id ?? main?.id))?.name ?? 'Magazijn';
  }

  private async load(id: number): Promise<void> {
    this.view.set(null);
    this.workspaceSection.set(rootSectionOf(parseTab(this.tab())));
    this.lineSheet.set(null);
    this.stepOpen.set(null);
    this.openProductGroups.set(new Set());
    void this.loadPayments(id);
    void this.loadBankLines();
    // Unknown until they arrive, so the ledger never warns about proofs of the previous order.
    this.documents.set(null);
    this.documentsFailed.set(false);
    void this.sourcing.documents(id).then((list) => {
      if (Number(this.id()) === id) this.documents.set(list);
    }).catch(() => {
      if (Number(this.id()) !== id) return;
      this.documents.set([]);
      this.documentsFailed.set(true);
    });
    void this.loadPartnerDocs(id);
    /* The families decide how the product list groups and sorts, so they arrive
       with the order: the list must not paint and then jump into its groups. A
       failing catalogue endpoint still never blocks the screen. */
    const [view, products, categories, suppliers, families] = await Promise.all([
      this.sourcing.purchaseOrder(id),
      this.catalog.products(),
      this.catalog.categories().catch(() => [] as Category[]),
      this.sourcing.suppliers(),
      this.catalog.productFamilies().catch(() => [] as ProductFamily[]),
    ]);
    this.catalog.stockLocations().then((locations) => this.stockLocations.set(locations)).catch(() => undefined);
    this.families.set(families);
    this.products.set(products);
    this.categories.set(categories);
    this.suppliers.set(suppliers);
    this.view.set(view);
    this.loadPartnerFinancing();
  }

  amt(value: number, line: { quantity: number }): number {
    return this.perPiece() && line.quantity > 0 ? value / line.quantity : value;
  }

  /** Every line priced delivered duty paid: the road and the customs are in the price. */
  readonly isDdp = computed(() => {
    const lines = this.view()?.order.lines ?? [];
    return lines.length > 0 && lines.every((line) => (line.priceBasis ?? 'EXW') === 'DDP');
  });

  /** Transport, duty, handling and Enrosed kost as a share of the goods. */
  overheadPct(totals: { totalEur: number; goodsEur: number }): number {
    return totals.goodsEur > 0 ? Math.round(((totals.totalEur - totals.goodsEur) / totals.goodsEur) * 100) : 0;
  }

  productGroupPanelId(key: string): string {
    return `purchase-product-group-${key.replace(/[^a-z0-9_-]/gi, '-')}`;
  }

  productGroupOpen(key: string): boolean { return this.openProductGroups().has(key); }

  toggleProductGroup(key: string): void {
    this.openProductGroups.update((openGroups) => nextProductGroupDisclosure(openGroups, key));
  }

  supplier(): Supplier | null {
    const id = this.view()?.order.supplierId;
    return this.suppliers().find((supplier) => supplier.id === id) ?? null;
  }

  supplierName(): string {
    return this.supplier()?.name ?? 'Onbekende leverancier';
  }

  readonly costLabels = computed(() => purchaseCostLabels(this.view(), this.supplier()));

  hasSeparateCosts(order: PurchaseOrder): boolean {
    return hasSeparateCosts(order);
  }

  separateCostsTotalLabel(totals: { otherCosts?: OtherCost[]; separateCostsInPiecePrice?: boolean }): string {
    return separateCostsTotalLabel(totals);
  }

  readonly separateInPiece = computed(() => (this.view()?.order.allocSeparate ?? 'SEPARATE') !== 'SEPARATE');

  usdToEurRate(): number {
    return effectiveUsdToEur(this.view()?.order);
  }

  photoOf(productId: number): string | null {
    const product = this.products().find((candidate) => candidate.id === productId);
    return product?.photos?.[0]?.url ?? null;
  }

  colourHex(product: Product | null): string | null {
    return purchaseColourHex(product, COLOUR_SWATCHES);
  }

  variantTitle(product: Product | null, fallback: string): string {
    if (!product) return fallback;
    const parts = [product.colour, product.variantSize]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));
    return parts.length ? parts.join(' · ') : fallback;
  }

  categoryHeadingId(key: string): string {
    return `purchase-category-${key.replace(/[^a-z0-9-]/gi, '-')}`;
  }

  cartonNotice(quantity: number, productId: number): string | null {
    const product = this.products().find((candidate) => candidate.id === productId);
    return cartonQuantityNotice(quantity, product?.carton.piecesPerCarton, productSalesUnit(product));
  }

  /** A product sold per display: its pieces, so the landed cost reads per display with the price per piece under it; null per piece. */
  setPiecesOf(productId: number): number | null {
    const unit = productSalesUnit(this.products().find((candidate) => candidate.id === productId));
    return unit.isDisplay ? unit.piecesPerDisplay : null;
  }

  statusLabel(status: string): string {
    if (status === 'ONTVANGEN') return 'Ontvangen';
    if (status === 'ONDERWEG') return 'Vertrokken';
    if (status === 'BESTELD') return 'Besteld';
    return 'Concept';
  }

  actionTitle(status: string, lineCount: number): string {
    if (!lineCount) return 'Voeg eerst producten toe';
    if (status === 'ONTVANGEN') return 'Container afgerond';
    if (status === 'ONDERWEG') return 'Klaar voor ontvangst?';
    if (status === 'BESTELD') return 'Is de container vertrokken?';
    return 'Klaar om te bestellen?';
  }

  actionDescription(status: string, lineCount: number): string {
    if (!lineCount) {
      return 'Deze container is nog leeg. Voeg productregels toe voordat je de lading en kosten afrondt.';
    }
    if (status === 'ONTVANGEN') {
      return 'De voorraad is bijgeboekt. Je kunt de calculatie nog controleren of als PDF bewaren.';
    }
    if (status === 'ONDERWEG') {
      return 'Controleer bij aankomst de werkelijk ontvangen aantallen voordat je de voorraad bijboekt.';
    }
    if (status === 'BESTELD') {
      return 'Zet de order op Vertrokken zodra het schip vaart; dan valt de volgende betaling en start de tracking.';
    }
    return 'Controleer lading, containerruimte en kosten voordat je de bestelling vastlegt.';
  }

  fillWidth(percent: number): number {
    return Math.min(100, Math.max(0, percent));
  }

  /* ---- the summary card ------------------------------------------------ */

  readonly statusTone = statusTone;
  readonly progress = computed(() => {
    const data = this.view();
    return data ? progressSteps(data.order, data.createdAt) : [];
  });
  readonly routeText = computed(() => `${this.costLabels().loadingPort} → ${this.costLabels().destinationPort}`);
  readonly payTile = computed(() => paymentTile(this.paymentLedger()?.summary ?? null, this.paymentState(), this.planLabel(), PAYEE_LABEL));

  landedTileOf(data: PurchaseOrderView): { valueEur: number; sub: string } {
    return landedTile(data.costing.totals, this.isDdp());
  }

  /** Into the editor on the tab that is open here; an empty container opens on Producten. */
  editQuery(): { tab: string | null } {
    return { tab: this.view()?.costing.lines.length ? tabParam(this.activeTab()) : 'producten' };
  }

  readonly amountModes: SegmentOption[] = [{ id: 'total', label: 'Totaal' }, { id: 'piece', label: 'Per stuk' }];
  readonly lineModes: SegmentOption[] = [{ id: 'piece', label: 'Per stuk' }, { id: 'line', label: 'Hele regel' }];

  /* ---- a product line in a sheet --------------------------------------- */

  readonly lineSheet = signal<number | null>(null);
  readonly lineSheetLine = computed(() => {
    const productId = this.lineSheet();
    if (productId === null) return null;
    for (const section of this.lineSections()) {
      for (const group of section.groups) {
        const index = group.entries.findIndex((entry) => entry.line.productId === productId);
        if (index >= 0) return { entry: group.entries[index], group, section, index };
      }
    }
    return null;
  });

  /* ---- the ⋯ menu ------------------------------------------------------- */

  readonly moreMenu = signal(false);
  readonly moreItems = computed<ContextMenuItem[]>(() => {
    const data = this.view();
    if (!data) return [];
    const items: ContextMenuItem[] = [
      { id: 'quote', label: data.order.partnerCustomerId != null ? 'Conceptvoorschotfacturen maken' : 'Verkoopofferte maken', iconName: 'sales',
        disabled: !quoteLinesOf(data).length },
      { id: 'files', label: 'Documenten & media', iconName: 'folder' },
    ];
    if (data.order.status === 'ONTVANGEN') items.push({ id: 'analysis', label: 'Ontvangstanalyse', iconName: 'analytics' });
    return items;
  });

  pickMore(item: ContextMenuItem): void {
    this.moreMenu.set(false);
    const id = this.view()?.order.id;
    if (id == null) return;
    if (item.id === 'quote') this.quoteOpen.set(true);
    else if (item.id === 'files') void this.routerNav.navigate(['/files'], { queryParams: { view: 'purchase', doel: id } });
    else if (item.id === 'analysis') void this.routerNav.navigate(['/analyses/purchasing'], { queryParams: { orderId: id } });
  }

  /* ---- the next step: asked here, run by the editor --------------------- */

  readonly STEP_BUTTON = STEP_BUTTON;
  private readonly costsApplied = computed(() => {
    const data = this.view();
    return !!data && costsAppliedFor(data.costing.lines, this.products(), data.order.number);
  });
  readonly readStep = computed<PhoneStep | null>(() => {
    const data = this.view();
    if (!data) return null;
    return readNextStep({ status: data.order.status, lineCount: data.costing.lines.length, stockBooked: data.order.stockBooked,
      costsApplied: this.costsApplied(), superseded: costsSupersededFor(data.costing.lines, this.products(), data.order.number) });
  });
  readonly stepOpen = signal<AskedStep | null>(null);

  /** Kostprijzen toepassen skips this view's question: the editor opens its sheet with every product's cost now and next. */
  openStep(step: PhoneStep): void {
    if (step === 'KOSTPRIJZEN') this.handOff(step, null);
    else this.stepOpen.set(step);
  }

  stepText(step: AskedStep) {
    const order = this.view()!.order;
    return stepConfirm(step, { number: order.number, planLabel: this.planLabel(), location: this.receivingLocationName(order.receivingLocationId),
      dirty: false });
  }

  /**
   * Confirmed: the editor runs the step behind its own sheets and comes back
   * here by itself (PurchaseScreen). The handoff stays in memory: a link or a
   * reload never changes a status.
   */
  confirmStep(event: { tracking: string | null }): void {
    const step = this.stepOpen();
    if (!step) return;
    this.stepOpen.set(null);
    this.handOff(step, event.tracking);
  }

  private handOff(step: PhoneStep, tracking: string | null): void {
    const data = this.view();
    if (!data) return;
    const tab = this.activeTab();
    this.stepHandoff.offer({ orderId: data.order.id, step, tracking, tab, at: Date.now() });
    void this.routerNav.navigate(['/purchasing', data.order.id, 'edit'], { queryParams: { tab: tabParam(tab) }, replaceUrl: true });
  }
}
