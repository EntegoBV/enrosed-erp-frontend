import { SalesSplitSheet } from './sales-split-sheet';
import { salesSplitBlockReason } from './sales-split-state';
import { fulfillmentStatusOf } from './quote-status';
import type { SalesSplitResult } from '../../core/api/models';
import { TEMPORARY_DELETION_NOTICE } from '../../shared/deleted-item-notice';
import { isAdvanceDocument, isPartnerDocument } from './sales-payment-state';
import { invoiceReceivable } from '../finance/incoming-money';
import { NgTemplateOutlet } from '@angular/common';
import { groupSalesInvoices, type SalesContainerGroup, type SalesSplitGroup } from './sales-list-groups';
import { SalesContainerMenu } from './sales-container-menu';
import { SalesMenuTrigger } from './sales-menu-trigger';
import { isSalesMenuInteractiveChild } from './sales-menu-gesture';
import type { PartnerContainerDeletionResult } from '../../core/api/partner-container-deletion-api';
import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, ViewEncapsulation, computed, effect, inject, signal, viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SalesApi } from '../../core/api/sales-api';
import { Country, Customer, LANGUAGES, QuoteStatus, SalesOrder, SalesOrderView } from '../../core/api/models';
import type { HostActionEvent, HostPageInput } from '../../core/platform/host-bridge';
import { PageHeader } from '../../shared/page-header';
import { WorkQueue } from '../../core/api/work-queue';
import { escapeHtml, Sheet, Ui } from '../../shared/ui';
import { Skeleton } from '../../shared/skeleton';
import { Icon } from '../../shared/icon';
import { Segmented, type SegmentOption } from '../../shared/segmented';
import { ContextMenu, type ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { LoadError } from '../../shared/load-error';
import { keyContext } from '../../shared/key-context';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { CbmPipe, DateNlPipe, EurPipe, NumPipe, PctPipe } from '../../shared/pipes';
import { channelCode, channelLabel } from './sales-channels';
import {
  actionNeeded, countsAsNewWebsiteItem, customerCanStillChange,
  isWebOrder, isWebOrderConflict, isWebsiteQuoteRequest, statusOf, webOrderDeletable, webOrderListPill,
  webOrderRevision,
} from './quote-status';
import { messageOf } from '../../core/api/errors';
import { isSwipeDeletableSalesDocument } from './sales-list-swipe';
import { WEB_ORDER_RELOADED } from './sales-invoice-actions';
import { creditNoteSettlement, creditReasonLabel, isCreditNote } from './sales-credit-note';
import { blankCustomer, defaultCustomerCountry, VAT_REQUIRED_MESSAGE, vatCountryMismatch, vatNumberMissing } from '../customers/customer-form';
import { salesDocumentKind } from './partner-settlement';
import { billingKind, isAdvanceBillingInvoice } from './sales-advance-billing';
import {
  ROW_LONG_PRESS_SLOP_PX, RowSwipeSide, clampRowSwipeOffset, restingRowOffset,
  rowSwipeDecision,
} from '../../shared/row-actions';
import { dayParts, keepEuro } from '../purchasing/purchase-list-model';
import {
  containerHead, containerHint, countText, customerSections, documentSub, invoiceOverdue, listCaption, listMoney, matchesWords, paymentCell, phoneLines,
  roundedAway, salesTone, splitHead, statusParts, trailEuro,
  type LinePart, type PaymentCell, type PhoneHead, type PhoneLines, type SalesDocsFilter, type SalesScope, type SalesTab,
} from './sales-list-model';

/**
 * The list's area stylesheet (Verkoop on the Inkoop recipe, 2026-10-19):
 * styles/sales-list.scss stays global CSS with every rule under
 * app-sales-list, loaded with this screen's lazy chunk instead of
 * styles.scss (the initial bundle's 1 MB error budget). Encapsulation None
 * keeps the selectors as written; renders nothing.
 */
@Component({
  selector: 'app-sales-list-styles',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { hidden: '' },
  template: '',
  styleUrl: '../../../styles/sales-list.scss',
})
export class SalesListStyles {}

/** A subtitle or caption while the list is not known yet: keeps the line's height and says nothing (no false '0'). */
const NOT_KNOWN_YET = '\u00a0';

/** Today as the server writes due dates ('YYYY-MM-DD'). */
const todayIso = (): string => new Date().toISOString().slice(0, 10);

@Component({
  selector: 'app-sales-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, PageHeader, Sheet, Skeleton, NgTemplateOutlet, Icon, Segmented, ContextMenu, LoadError, SalesListStyles,
            EurPipe, NumPipe, PctPipe, CbmPipe, DateNlPipe, SalesContainerMenu, SalesMenuTrigger, SalesSplitSheet],
  template: `
    <app-sales-list-styles />
    <app-page-header title="Verkoop" [subtitle]="desktop.active() ? deskSubtitle() : phoneCaption()" [host]="hostPage()" (hostAction)="hostAction($event)">
      @if (desktop.active()) {
        <app-segmented class="sl-tabs" label="Documenten" semantics="tabs" controls="sales-document-results" [options]="tabOptions()"
                       [value]="docTab()" (changed)="switchTab($any($event))" />
        <div class="wk-search sl-search">
          <app-icon name="search" [size]="16" />
          <input #searchField id="sales-search" type="search" data-page-search [placeholder]="compactBar() ? 'Zoek klant of nummer' : 'Zoek klant, factuur of container'"
                 aria-label="Zoek klant, documentnummer of containerreferentie" autocomplete="off"
                 [value]="query()" (input)="query.set($any($event.target).value)" (keydown.escape)="escapeSearch($event)" />
          <kbd class="wk-kbd" aria-hidden="true">/</kbd>
          <button class="wk-search__clear" type="button" aria-label="Zoekopdracht wissen" (click)="query.set('')"><app-icon name="close" [size]="14" /></button>
        </div>
        <button class="btn btn--primary btn--sm" type="button" (click)="startNew()">
          @if (businessScope() === 'PARTNER') { Container kiezen } @else { <app-icon name="plus" [size]="16" />Nieuw }
        </button>
      }
    </app-page-header>

    <p id="sales-menu-help" class="sr-only">Acties: houd de rij ingedrukt op een aanraakscherm, gebruik de rechtermuisknop of druk op Shift+F10.</p>

    @if (desktop.active()) {
      <div class="content sl">
        <!-- Soort verkoop, the status chips with their counts (they follow the search), the tab's own toggles, the customer;
             at the end what the shown documents still hold. -->
        <div #subbar class="wk-subbar sl-subbar">
          <span class="wk-chip sl-select" [class.is-on]="businessScope() !== 'ALL'" [attr.title]="scopeHint()">
            <span class="sl-select__label">{{ scopeLabel() }}</span><app-icon name="chevron-down" [size]="12" />
            <select class="sl-select__native" aria-label="Soort verkoop" (change)="switchScope($any($event.target).value)">
              <option value="ALL" [selected]="businessScope() === 'ALL'">Alles</option>
              <option value="STANDARD" [selected]="businessScope() === 'STANDARD'">Reguliere verkoop</option>
              <option value="PARTNER" [selected]="businessScope() === 'PARTNER'">Partnercontainers</option>
            </select>
          </span>
          <div class="wk-chips" role="group" aria-label="Filter op status">
            @for (chip of chips(); track chip.value) {
              <button class="wk-chip" type="button" [attr.aria-pressed]="!attentionOnly() && filter() === chip.value"
                      (click)="selectStatus(chip.value)">{{ chip.label }} @if (ready()) { <span class="wk-seg__count">{{ chip.count }}</span> }</button>
            }
            <button class="wk-chip" type="button" [class.tone-warn]="actionCount() > 0" [attr.aria-pressed]="attentionOnly()"
                    [disabled]="!actionCount() && !attentionOnly()" (click)="pickAttention()">Actie vereist @if (ready()) { <span class="wk-seg__count">{{ actionCount() }}</span> }</button>
          </div>
          @if (docTab() === 'OFFERTE' && (websiteRequests().length || ordersToTake().length || websiteOnly() || toTakeOnly())) {
            <div class="wk-chips" role="group" aria-label="Websitebestellingen">
              @if (websiteRequests().length || websiteOnly()) {
                <button class="wk-chip" type="button" [attr.aria-pressed]="websiteOnly()" (click)="websiteOnly.set(!websiteOnly())">Website <span class="wk-seg__count">{{ websiteRequests().length }}</span></button>
              }
              @if (ordersToTake().length || toTakeOnly()) {
                <button class="wk-chip" type="button" [attr.aria-pressed]="toTakeOnly()" (click)="toTakeOnly.set(!toTakeOnly())">In verwerking te nemen <span class="wk-seg__count">{{ ordersToTake().length }}</span></button>
              }
            </div>
          } @else if (docTab() === 'FACTUUR') {
            <div class="wk-chips" role="group" aria-label="Facturen of creditnota’s">
              <button class="wk-chip" type="button" [attr.aria-pressed]="outstandingOnly()" title="Inclusief openstaande facturen en creditnota’s met een tegoed in het archief."
                      (click)="filterOutstanding(!outstandingOnly())">Nog te ontvangen</button>
              <button class="wk-chip" type="button" [attr.aria-pressed]="docsFilter() === 'f'" (click)="filterDocs(docsFilter() === 'f' ? 'all' : 'f')">Facturen @if (ready()) { <span class="wk-seg__count">{{ docsCounts().f }}</span> }</button>
              <button class="wk-chip" type="button" [attr.aria-pressed]="docsFilter() === 'cn'" (click)="filterDocs(docsFilter() === 'cn' ? 'all' : 'cn')">Creditnota’s @if (ready()) { <span class="wk-seg__count">{{ docsCounts().cn }}</span> }</button>
            </div>
          }
          @if (customersWithOrders().length > 1 || customerFilter() !== '') {
            <span class="wk-chip sl-select" [class.is-on]="customerFilter() !== ''">
              <span class="sl-select__label">{{ customerFilter() === '' ? 'Klant' : activeCustomerLabel() }}</span><app-icon name="chevron-down" [size]="12" />
              <select class="sl-select__native" aria-label="Filter op klant" [ngModel]="customerFilter()" (ngModelChange)="customerFilter.set($event)">
                <option [ngValue]="''">Alle klanten</option>
                @for (customer of customersWithOrders(); track customer.id) {
                  <option [ngValue]="customer.id">{{ customerLabel(customer.id) }}</option>
                }
              </select>
            </span>
          }
          <!-- The counts and sums only once the list is known: while it loads or failed they would read '0' and '€ 0'.
               'n van m' only when something narrows the list (else the tab and 'Alle' say it) and 'Open' as on the rows:
               at 1080 the Facturen subbar keeps to two lines. -->
          @if (ready()) {
            <span class="wk-subbar__end sl-subbar__end">@if (activeFilterCount()) { {{ rows().length }} van {{ pile().length }} · }@if (docTab() === 'OFFERTE') { Waarde <b>{{ shownMoney().offerEur | eur: 0 }}</b> excl. btw } @else { Open <b [class.sl-warn]="shownMoney().overdueEur > 0">{{ shownMoney().openEur | eur: 0 }}</b>@if (shownMoney().overdueEur > 0) { · Vervallen <span class="sl-warn sl-nw">{{ shownMoney().overdueEur | eur: 0 }}</span> }@if (shownMoney().tegoedEur > 0) { · Tegoeden <span class="sl-nw">{{ shownMoney().tegoedEur | eur: 0 }}</span> } }</span>
          }
          @if (activeFilterCount()) {
            <button class="wk-btn wk-btn--ghost wk-btn--sm sl-clear" type="button" (click)="clearFilters()">Filters wissen</button>
          }
        </div>

        <!-- A failed refresh keeps the list it had (a banner); only a first load that failed has nothing to show. -->
        @if (ready() && loadError(); as error) {
          <div class="wk-banner wk-banner--danger wk-banner--inset" role="alert">
            <app-icon name="alert" [size]="16" />
            <span class="wk-banner__text"><b>Verkoopoverzicht kon niet worden vernieuwd</b> · {{ error }}</span>
            <span class="wk-banner__actions"><button class="wk-btn wk-btn--sm" type="button" [disabled]="loading()" (click)="load()">Opnieuw proberen</button></span>
          </div>
        }
        @if (!ready() && loadError(); as error) {
          <div class="wk-card"><app-load-error title="Verkoopoverzicht kon niet worden geladen" [message]="error" [busy]="loading()" (retry)="load()" /></div>
        } @else if (!ready()) {
          <div class="wk-card sl-card" role="status" aria-label="Verkoopdocumenten laden"><app-skeleton kind="table" [rows]="8" /></div>
        } @else if (!customerSections().length) {
          <div class="wk-card">
            <ng-container *ngTemplateOutlet="emptyState" />
          </div>
        } @else {
          <div class="wk-card sl-card">
            <div class="wk-table sl-table" [class.sl-table--quotes]="docTab() === 'OFFERTE'" id="sales-document-results" role="table"
                 [attr.aria-label]="docTab() === 'OFFERTE' ? 'Offertes' : docTab() === 'FACTUUR' ? 'Facturen' : 'Archief'">
              <div class="wk-thead" role="row">
                <span class="wk-th" role="columnheader">Document</span>
                <span class="wk-th" role="columnheader" data-hide="sm">Inhoud</span>
                <span class="wk-th" role="columnheader">Status</span>
                @if (docTab() !== 'OFFERTE') { <span class="wk-th" role="columnheader">Betaling</span> }
                <span class="wk-th wk-th--num" role="columnheader">Totaal excl. btw</span>
                <span class="wk-th" role="columnheader"><span class="sr-only">Acties</span></span>
              </div>
              @for (section of customerSections(); track section.id) {
                <div class="wk-group sl-group" role="row">
                  <span class="wk-group__label" role="rowheader">
                    <button class="wk-group__toggle" type="button" [attr.aria-expanded]="!folded(section.id)"
                            [attr.aria-label]="(folded(section.id) ? 'Toon de documenten van ' : 'Verberg de documenten van ') + section.name"
                            (click)="toggleFold(section.id)"><app-icon name="chevron-down" [size]="14" /></button>
                    <span class="sl-group__name">{{ section.name }}</span>
                    <span class="wk-group__count">· {{ section.count }} {{ section.count === 1 ? 'document' : 'documenten' }}@if (section.money.openEur > 0) { · <span class="sl-nw" [class.sl-warn]="section.money.overdueCount > 0">{{ section.money.openEur | eur: 0 }} open</span> }</span>
                  </span>
                </div>
                @if (!folded(section.id)) {
                  @for (entry of section.entries; track entry.key) {
                    @if (entry.kind === 'PARTNER_CONTAINER') {
                      <!-- The container inside its customer: every figure of the old card on the columns; hold, right-click or ⋯ for its menu. -->
                      <div class="sl-head-wrap" role="none">
                        <div class="wk-tr wk-tr--sub sl-head" role="row">
                          <span class="sl-head__cell" role="rowheader">
                            <button class="sales-container__toggle" type="button"
                                    appSalesMenu [appSalesMenuDisabled]="containerDeletingId() !== null || deletingOrderId() !== null || archivingOrderId() !== null"
                                    (salesMenu)="openContainerMenu(null, entry)" aria-haspopup="dialog" aria-describedby="sales-menu-help"
                                    [id]="entry.key + '-toggle'" [attr.aria-expanded]="groupOpen(entry.key)"
                                    [attr.aria-controls]="entry.key + '-invoices'" (click)="toggleGroup(entry.key)"
                                    title="De facturen hieronder volgen je huidige filters.">
                              <span class="sl-cell">
                                <span class="sl-eyebrow"><app-icon name="chevron-down" [size]="12" />Partnercontainer</span>
                                <b class="sl-name" [attr.title]="entry.purchaseOrderNumber && entry.purchaseOrderNumber !== entry.purchaseOrderName ? 'Inkooporder ' + entry.purchaseOrderNumber : null">{{ entry.purchaseOrderName }}</b>
                                <span class="sl-sub">{{ entry.summary.count }} {{ entry.summary.count === 1 ? 'factuur' : 'facturen' }}@if (entry.summary.containerPieces !== null) {<span class="sl-inhoud-inline"> · {{ entry.summary.containerPieces | num }} stuks in container</span>}</span>
                              </span>
                              <span class="sl-cell" data-hide="sm">@if (entry.summary.containerPieces !== null) { <span class="sl-main">{{ entry.summary.containerPieces | num }} stuks in container</span> }</span>
                              <span class="sl-cell sl-badges">
                                @for (status of entry.summary.statuses; track status.label) {
                                  <span class="wk-pill" [class]="salesTone(status.cls)" [class.sl-pill--concept]="status.concept">{{ status.count }} {{ status.label }}@if (status.concept) { · nog niet uitgereikt }@if (status.inactive) { · buiten totaal }</span>
                                }
                                @if (entry.summary.attentionCount) { <span class="sl-sub sl-warn">{{ entry.summary.attentionCount }} {{ entry.summary.attentionCount === 1 ? 'factuur vraagt' : 'facturen vragen' }} aandacht</span> }
                              </span>
                              @if (docTab() !== 'OFFERTE') {
                                <span class="sl-cell">
                                  <!-- The head's cells do not clip (no wk-td): only the amounts stay whole, the words wrap in the column. -->
                                  @if (entry.summary.issuedCount) {
                                    <span class="sl-main"><span class="sl-nw">{{ entry.summary.remainingEur | eur }}</span> open</span>
                                    <span class="sl-sub"><span class="sl-nw">{{ entry.summary.receivedEur | eur }}</span> ontvangen · incl. btw</span>
                                  }
                                  @if (entry.summary.creditEur > 0) { <span class="sl-sub sl-credit"><span class="sl-nw">{{ entry.summary.creditEur | eur }}</span> credit incl. btw</span> }
                                </span>
                              }
                              <span class="sl-cell sl-total">
                                <span>{{ entry.summary.totalEur | eur }}</span>
                                @if (entry.summary.draftCount && entry.summary.issuedCount) { <small class="sl-sub">waarvan concept <span class="sl-nw">{{ entry.summary.draftEur | eur }}</span></small> }
                              </span>
                              <span class="sl-cell" aria-hidden="true"></span>
                            </button>
                          </span>
                        </div>
                        <button class="wk-btn wk-btn--ghost wk-btn--sm wk-btn--icon sl-more" type="button" aria-haspopup="dialog"
                                [attr.aria-label]="'Acties voor container ' + entry.purchaseOrderName" (click)="openContainerMenu($event, entry)"><app-icon name="more" [size]="16" /></button>
                      </div>
                      <div class="sl-members" role="rowgroup" [id]="entry.key + '-invoices'" [hidden]="!groupOpen(entry.key)" [attr.aria-labelledby]="entry.key + '-toggle'">
                        @if (groupOpen(entry.key)) {
                          @for (row of entry.rows; track row.order.id) {
                            <ng-container *ngTemplateOutlet="deskRow; context: { $implicit: row, nested: true }" />
                          }
                        }
                      </div>
                    } @else if (entry.kind === 'SPLIT_ORDER') {
                      <div class="sl-head-wrap" role="none">
                        <div class="wk-tr wk-tr--sub sl-head" role="row">
                          <span class="sl-head__cell" role="rowheader">
                            <button class="sales-container__toggle" type="button" [id]="entry.key + '-toggle'" [attr.aria-expanded]="groupOpen(entry.key)"
                                    [attr.aria-controls]="entry.key + '-parts'" (click)="toggleGroup(entry.key)"
                                    title="Elk deel heeft een eigen document- en leverstatus.">
                              <span class="sl-cell">
                                <span class="sl-eyebrow"><app-icon name="chevron-down" [size]="12" />Gesplitste order</span>
                                <b class="sl-name">{{ entry.rows[0].order.number }}</b>
                                <span class="sl-sub">{{ entry.summary.parts }} van 2 delen in dit overzicht<span class="sl-inhoud-inline"> · {{ entry.summary.pieces | num }} stuks</span></span>
                              </span>
                              <span class="sl-cell" data-hide="sm"><span class="sl-main">{{ entry.summary.pieces | num }} stuks</span></span>
                              <span class="sl-cell sl-badges">
                                @if (entry.summary.unavailableCount) { <span class="wk-pill tone-amber">{{ entry.summary.unavailableCount }} niet beschikbaar</span> }
                                @if (entry.summary.waitingCount) { <span class="wk-pill tone-amber"><span class="wk-pill__dot" aria-hidden="true"></span>{{ entry.summary.waitingCount }} wacht op voorraad</span> }
                                @if (entry.summary.shippedCount) { <span class="wk-pill tone-ok"><span class="wk-pill__dot" aria-hidden="true"></span>{{ entry.summary.shippedCount }} verzonden</span> }
                                @if (!entry.summary.waitingCount && !entry.summary.shippedCount && entry.summary.pieces > 0) { <span class="wk-pill tone-blue"><span class="wk-pill__dot" aria-hidden="true"></span>Leveringen gepland</span> }
                              </span>
                              @if (docTab() !== 'OFFERTE') { <span class="sl-cell" aria-hidden="true"></span> }
                              <span class="sl-cell sl-total"><span>{{ entry.summary.totalEur | eur }}</span></span>
                              <span class="sl-cell" aria-hidden="true"></span>
                            </button>
                          </span>
                        </div>
                      </div>
                      <div class="sl-members" role="rowgroup" [id]="entry.key + '-parts'" [hidden]="!groupOpen(entry.key)" [attr.aria-labelledby]="entry.key + '-toggle'">
                        @if (groupOpen(entry.key)) {
                          @for (row of entry.rows; track row.order.id) {
                            <ng-container *ngTemplateOutlet="deskRow; context: { $implicit: row, nested: true }" />
                          }
                        }
                      </div>
                    } @else {
                      <ng-container *ngTemplateOutlet="deskRow; context: { $implicit: entry.row, nested: false }" />
                    }
                  }
                }
              }
            </div>
          </div>
        }
      </div>
    } @else {
      <div class="content sl--phone">
        <app-segmented variant="ios" class="sl-tabs" label="Documenten" semantics="tabs" controls="sales-document-results" [options]="tabOptions()"
                       [value]="docTab()" (changed)="switchTab($any($event))" />
        <!-- The search and, on its right, the round filter button: Soort verkoop, Status, Klant and the Facturen choices
             sit in one sheet, so no filter row pushes the documents down. -->
        <div class="ios-search sl-isearch">
          <div class="ios-search__field">
            <app-icon name="search" [size]="17" />
            <input id="sales-search" type="search" data-page-search [placeholder]="smallPhone() ? 'Zoek klant of nummer' : 'Zoek klant, factuur of container'"
                   aria-label="Zoek klant, documentnummer of containerreferentie" autocomplete="off" enterkeyhint="search"
                   [value]="query()" (input)="query.set($any($event.target).value)" />
            @if (query()) {
              <button class="ios-search__clear" type="button" aria-label="Zoekopdracht wissen" (click)="query.set('')"><app-icon name="close" [size]="16" /></button>
            }
          </div>
          <button class="sl-filter" type="button" aria-haspopup="dialog" [class.sl-filter--on]="sheetFilterCount() > 0"
                  [attr.aria-label]="sheetFilterCount() ? 'Filters, ' + sheetFilterCount() + ' actief' : 'Filters'" (click)="filtersOpen.set(true)">
            <app-icon name="filter" [size]="20" />
            @if (sheetFilterCount(); as active) { <span class="sl-filter__badge" aria-hidden="true">{{ active }}</span> }
          </button>
        </div>
        <!-- Only what applies: empty in daily use, so five documents stay in view. -->
        @if (phoneChips(); as quick) {
          <div class="ios-chips sl-ichips" role="group" aria-label="Snelfilters">
            @if (quick.attention) {
              <button class="ios-chip" type="button" [attr.aria-pressed]="attentionOnly()" (click)="pickAttention()">Actie vereist @if (ready()) { <span class="ios-chip__badge sl-ichip__badge--warn">{{ actionCount() }}</span> }</button>
            }
            @if (quick.website) {
              <button class="ios-chip" type="button" [attr.aria-pressed]="websiteOnly()" (click)="websiteOnly.set(!websiteOnly())">Website <span class="ios-chip__badge">{{ websiteRequests().length }}</span></button>
            }
            @if (quick.toTake) {
              <button class="ios-chip" type="button" [attr.aria-pressed]="toTakeOnly()" (click)="toTakeOnly.set(!toTakeOnly())">In verwerking te nemen <span class="ios-chip__badge">{{ ordersToTake().length }}</span></button>
            }
            @if (quick.outstanding) {
              <button class="ios-chip" type="button" aria-pressed="true" (click)="filterOutstanding(false)">Nog te ontvangen <app-icon name="close" [size]="14" /></button>
            }
          </div>
        }

        @if (ready() && loadError(); as error) {
          <div class="ios-banner ios-banner--danger" role="alert">
            <span><b>Verkoopoverzicht kon niet worden vernieuwd</b><br />{{ error }}</span>
            <button class="ios-capsule ios-capsule--sm ios-capsule--tinted" type="button" [disabled]="loading()" (click)="load()">Opnieuw proberen</button>
          </div>
        }
        @if (!ready() && loadError(); as error) {
          <app-load-error title="Verkoopoverzicht kon niet worden geladen" [message]="error" [busy]="loading()" (retry)="load()" />
        } @else if (!ready()) {
          <div class="sl-loading" role="status" aria-label="Verkoopdocumenten laden"><app-skeleton kind="group" [rows]="5" /></div>
        } @else if (!customerSections().length) {
          <ng-container *ngTemplateOutlet="emptyState" />
        } @else {
          <div id="sales-document-results" role="tabpanel" [attr.aria-label]="docTab() === 'OFFERTE' ? 'Offertes' : docTab() === 'FACTUUR' ? 'Facturen' : 'Archief'">
            @for (section of customerSections(); track section.id) {
              <section class="ios-section sl-section">
                <div class="ios-section__head"><span class="sl-customer" role="heading" aria-level="2">{{ section.name }}</span><span class="ios-section__trail">{{ section.count }}</span></div>
                <div class="ios-group">
                  @for (entry of section.entries; track entry.key) {
                    @if (entry.kind === 'PARTNER_CONTAINER') {
                      <!-- The container inside its customer, with a document's anatomy: its name, 'Partnercontainer · n facturen'
                           and the amber line; the total and one status ('€ x open', '€ x tegoed' or a pill). Its other figures
                           sit in the head of its menu (hold it or right-click); a tap opens its documents in place. -->
                      @let head = phoneHeadOf(entry);
                      <button class="ios-cell sl-phead" type="button"
                              appSalesMenu [appSalesMenuDisabled]="containerDeletingId() !== null || deletingOrderId() !== null || archivingOrderId() !== null"
                              (salesMenu)="openContainerMenu(null, entry)" aria-haspopup="dialog" aria-describedby="sales-menu-help"
                              [id]="entry.key + '-toggle'" [attr.aria-expanded]="groupOpen(entry.key)"
                              [attr.aria-controls]="entry.key + '-invoices'" (click)="toggleGroup(entry.key)"
                              title="De facturen hieronder volgen je huidige filters.">
                        <span class="ios-cell__body">
                          <span class="sl-ptitle" [attr.title]="entry.purchaseOrderNumber && entry.purchaseOrderNumber !== entry.purchaseOrderName ? 'Inkooporder ' + entry.purchaseOrderNumber : null">{{ entry.purchaseOrderName }}</span>
                          <span class="sl-psub">{{ head.sub }}</span>
                          @if (head.attention; as attn) { <span class="sl-pattn"><b>{{ attn.count }}</b><span>{{ keepEuro(attn.text) }}</span></span> }
                        </span>
                        <span class="ios-cell__trail sl-ptrail">
                          <span class="sl-ptotal">{{ head.total }}</span>
                          @if (head.status; as status) {
                            @if (status.kind === 'open') { <span class="sl-pline sl-pline--open" [class.sl-warn]="status.overdue">{{ status.text }}</span> }
                            @else if (status.kind === 'tegoed') { <span class="sl-pline sl-pline--wrap sl-credit">{{ status.text }}</span> }
                            @else { <span class="wk-pill" [class]="salesTone(status.cls)">{{ status.text }}</span> }
                          }
                        </span>
                        <app-icon class="ios-cell__chev sl-pchev" name="chevron-right" [size]="16" />
                      </button>
                      <div class="sl-pmembers" role="group" [id]="entry.key + '-invoices'" [hidden]="!groupOpen(entry.key)" [attr.aria-labelledby]="entry.key + '-toggle'">
                        @if (groupOpen(entry.key)) {
                          @for (row of entry.rows; track row.order.id) {
                            <ng-container *ngTemplateOutlet="phoneRow; context: { $implicit: row, nested: true }" />
                          }
                        }
                      </div>
                    } @else if (entry.kind === 'SPLIT_ORDER') {
                      <!-- The split order the same way: its number, 'Gesplitste order · 2 delen · n stuks', the amber line; the
                           total and its delivery in one pill. Each part keeps its own document and delivery status below. -->
                      @let head = phoneHeadOf(entry);
                      <button class="ios-cell sl-phead" type="button" [id]="entry.key + '-toggle'" [attr.aria-expanded]="groupOpen(entry.key)"
                              [attr.aria-controls]="entry.key + '-parts'" (click)="toggleGroup(entry.key)"
                              title="Elk deel heeft een eigen document- en leverstatus.">
                        <span class="ios-cell__body">
                          <span class="sl-ptitle">{{ entry.rows[0].order.number }}</span>
                          <span class="sl-psub">{{ head.sub }}</span>
                          @if (head.attention; as attn) { <span class="sl-pattn"><b>{{ attn.count }}</b><span>{{ keepEuro(attn.text) }}</span></span> }
                        </span>
                        <span class="ios-cell__trail sl-ptrail">
                          <span class="sl-ptotal">{{ head.total }}</span>
                          @if (head.status; as status) { <span class="wk-pill" [class]="salesTone(status.cls)">{{ status.text }}</span> }
                        </span>
                        <app-icon class="ios-cell__chev sl-pchev" name="chevron-right" [size]="16" />
                      </button>
                      <div class="sl-pmembers" role="group" [id]="entry.key + '-parts'" [hidden]="!groupOpen(entry.key)" [attr.aria-labelledby]="entry.key + '-toggle'">
                        @if (groupOpen(entry.key)) {
                          @for (row of entry.rows; track row.order.id) {
                            <ng-container *ngTemplateOutlet="phoneRow; context: { $implicit: row, nested: true }" />
                          }
                        }
                      </div>
                    } @else {
                      <ng-container *ngTemplateOutlet="phoneRow; context: { $implicit: entry.row, nested: false }" />
                    }
                  }
                </div>
              </section>
            }
          </div>
        }
      </div>
    }

    <ng-template #emptyState>
      @if (query().trim()) {
        <div [class]="desktop.active() ? 'wk-empty' : 'ios-empty'">
          <h2 [class]="desktop.active() ? 'wk-empty__title' : 'ios-empty__title'">Niets gevonden voor “{{ query().trim() }}”</h2>
          <p [class]="desktop.active() ? 'wk-empty__text' : 'ios-empty__text'">Zoek op klant, documentnummer of container.</p>
          <button [class]="desktop.active() ? 'wk-btn' : 'ios-capsule ios-capsule--tinted'" type="button" (click)="query.set('')">Zoekopdracht wissen</button>
        </div>
      } @else if (activeFilterCount()) {
        <div [class]="desktop.active() ? 'wk-empty' : 'ios-empty'">
          <h2 [class]="desktop.active() ? 'wk-empty__title' : 'ios-empty__title'">Niets met deze filters</h2>
          <button [class]="desktop.active() ? 'wk-btn' : 'ios-capsule ios-capsule--tinted'" type="button" (click)="clearFilters()">Filters wissen</button>
        </div>
      } @else if (docTab() === 'ARCHIEF') {
        <div [class]="desktop.active() ? 'wk-empty' : 'ios-empty'">
          <h2 [class]="desktop.active() ? 'wk-empty__title' : 'ios-empty__title'">Niets in het archief</h2>
          <p [class]="desktop.active() ? 'wk-empty__text' : 'ios-empty__text'">Gearchiveerde documenten blijven hier zoals ze waren.</p>
        </div>
      } @else {
        <div [class]="desktop.active() ? 'wk-empty' : 'ios-empty'">
          <h2 [class]="desktop.active() ? 'wk-empty__title' : 'ios-empty__title'">{{ docTab() === 'OFFERTE' ? 'Nog geen offertes' : 'Nog geen facturen' }}</h2>
          <p [class]="desktop.active() ? 'wk-empty__text' : 'ios-empty__text'">{{ businessScope() === 'PARTNER' ? 'Partnerdocumenten maak je vanuit de betreffende inkoopcontainer.' : 'Hier verschijnen de documenten voor de gekozen soort verkoop.' }}</p>
          @if (businessScope() === 'PARTNER') {
            <a [class]="desktop.active() ? 'wk-btn wk-btn--primary' : 'ios-capsule ios-capsule--tinted'" routerLink="/purchasing">Naar partnercontainers</a>
          } @else {
            <button [class]="desktop.active() ? 'wk-btn wk-btn--primary' : 'ios-capsule ios-capsule--tinted'" type="button" (click)="startNew()">{{ docTab() === 'FACTUUR' ? 'Nieuwe factuur' : 'Nieuwe offerte' }}</button>
          }
        </div>
      }
    </ng-template>

    <!-- A desk row: the document number on the left, its customer is the group above. Drag left for the bin, drag right
         for the archive; hold it, right-click it or use ⋯ for the same choices as a menu. -->
    <ng-template #deskRow let-row let-nested="nested">
      @let attn = rowAttention(row);
      @let status = statusOf(row);
      @let parts = statusPartsOf(row);
      <div class="swipe sl-swipe" role="none" [class.sl-swipe--nested]="nested"
           [animate.leave]="leavingId() === row.order.id ? 'mo-leave' : ''"
           [class.swipe--open]="rowOpenSide(row.order.id) === 'end'"
           [class.swipe--open-start]="rowOpenSide(row.order.id) === 'start'"
           [class.swipe--dragging]="draggingOrderId() === row.order.id"
           [style.--swipe-offset]="draggingOrderId() === row.order.id ? swipeOffset() + 'px' : null"
           (pointerdown)="notePointer($event)">
        @if (canArchive(row)) {
          <button class="swipe__archive" type="button" (click)="toggleArchive(row)"
                  [disabled]="archivingOrderId() !== null || containerDeletingId() !== null"
                  [attr.aria-label]="(row.order.archivedAt ? 'Terugzetten uit archief: ' : 'Archiveren: ') + documentLabelOf(row) + ' ' + row.order.number">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M3 6h18v4H3z" /><path d="M5 10v9h14v-9" /><path d="M10 14h4" />
            </svg>
            <span>{{ row.order.archivedAt ? 'Terug' : 'Archief' }}</span>
          </button>
        }
        <a class="wk-tr wk-tr--link swipe__row sl-row" role="row" [routerLink]="['/sales', row.order.id]"
           appSalesMenu [appSalesMenuDisabled]="deletingOrderId() !== null || archivingOrderId() !== null || containerDeletingId() !== null"
           (salesMenu)="openRowMenu(null, row)" aria-haspopup="menu" aria-describedby="sales-menu-help"
           (pointerdown)="startSwipe($event, row)"
           (pointermove)="moveSwipe($event, row)"
           (pointerup)="finishSwipe($event, row)"
           (pointercancel)="cancelSwipe($event)"
           (wheel)="wheelSwipe($event, row)"
           (dragstart)="$event.preventDefault()"
           (click)="blockWhenSwiped($event)">
          <span class="wk-td wk-td--wrap sl-cell" role="cell">
            <b class="sl-name">{{ row.order.number }}</b>
            <span class="sl-sub">{{ docSubOf(row) }}@if (channelCode(row.order.salesChannel) !== 'DIRECT' && !webOrder(row)) { <span class="sl-tag sl-tag--channel">{{ channelLabel(row.order.salesChannel) }}</span> }@if (partner(row.order) && !nested && channelCode(row.order.salesChannel) !== 'PARTNER') { <span class="sl-tag">Partner</span> }<span class="sl-inhoud-inline"> · <ng-container *ngTemplateOutlet="inhoud; context: { $implicit: row }" /></span></span>
          </span>
          <span class="wk-td wk-td--wrap sl-cell" role="cell" data-hide="sm"><ng-container *ngTemplateOutlet="inhoud; context: { $implicit: row }" /></span>
          <span class="wk-td wk-td--wrap sl-cell" role="cell">
            <span class="wk-pill" [class]="salesTone(status.cls)"><span class="wk-pill__dot" aria-hidden="true"></span>{{ status.label }}</span>
            @if (parts.length) {
              <span class="sl-sub">@for (part of parts; track $index) {@if (!$first) { · }<span class="sl-part" [class]="part.cls ? salesTone(part.cls) : ''">{{ part.text }}</span>}</span>
            }
          </span>
          @if (docTab() !== 'OFFERTE') {
            @let pay = paymentOf(row);
            <span class="wk-td wk-td--wrap sl-cell" role="cell">
              @switch (pay.state) {
                @case ('open') {
                  <span class="sl-main sl-nw" [class.sl-warn]="pay.overdue">{{ pay.openEur | eur }} open</span>
                  @if (pay.receivedEur > 0) { <span class="sl-sub sl-nw">{{ pay.receivedEur | eur }} ontvangen</span> }
                }
                @case ('settled') { <span class="sl-main" [class.sl-ok]="pay.receivedEur > 0">{{ pay.receivedEur > 0 ? 'Betaald' : 'Niets open' }}</span> }
                @case ('concept') { <span class="sl-main sl-muted">—</span><span class="sl-sub">nog niet uitgereikt</span> }
                @case ('credit') { <span class="sl-main sl-credit">{{ creditLine(row) }}</span> }
                @default { <span class="sl-main sl-muted">—</span> }
              }
              @if (row.creditedEur && (pay.state === 'open' || pay.state === 'settled')) { <span class="sl-sub sl-credit sl-nw">{{ row.creditedEur | eur }} gecrediteerd</span> }
            </span>
          }
          <span class="wk-td wk-td--num sl-cell sl-total" role="cell"><span [class.so-credit]="creditNoteRow(row)">{{ creditNoteRow(row) ? '− ' : '' }}{{ row.priced.totals.total | eur: (row.fulfillment || partner(row.order) ? 2 : 0) }}</span>@if (row.priced.validation.freightPricingIssue && !creditNoteRow(row)) { <small class="warn-text">excl. vracht</small> }</span>
          <span class="wk-td sl-actions-cell" role="cell"></span>
          @if (attn.length) {
            <span class="sl-attn" [attr.title]="attn.join(' · ')">
              <b>{{ attn.length }}</b>
              <span>{{ keepEuro(attn[0]) }}{{ attn.length > 1 ? ' · +' + (attn.length - 1) : '' }}</span>
            </span>
          }
        </a>
        <button class="wk-btn wk-btn--ghost wk-btn--sm wk-btn--icon sl-more" type="button" aria-haspopup="menu"
                [attr.aria-label]="'Acties voor ' + documentLabelOf(row) + ' ' + row.order.number" (click)="openRowMenu($event, row)"><app-icon name="more" [size]="16" /></button>
        @if (canDelete(row)) {
          <button class="swipe__delete" type="button"
                  [disabled]="deletingOrderId() !== null || containerDeletingId() !== null"
                  [attr.aria-busy]="deletingOrderId() === row.order.id"
                  (click)="remove(row)"
                  [attr.aria-label]="documentLabelOf(row) + ' ' + row.order.number + ' verwijderen'"
                  [title]="documentLabelOf(row) + ' verwijderen'">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                 aria-hidden="true" focusable="false">
              <path d="M4 7h16" /><path d="M9 7V5h6v2" />
              <path d="M6.5 7l1 13h9l1-13" /><path d="M10 11v6" /><path d="M14 11v6" />
            </svg>
          </button>
        }
      </div>
    </ng-template>

    <!-- A phone row: the document number, its customer is the section above; the trail holds the total, the status and
         what is open, in whole euros. Inhoud, marge and the exact amounts sit in the menu's Openen hint. Under a partner
         container no 'Partner & veiling' tag: the head says it; TICA or Beurs keep theirs. Drag left for the bin, drag
         right for the archive; hold it for the same choices as a menu. -->
    <ng-template #phoneRow let-row let-nested="nested">
      @let attn = rowAttention(row);
      @let status = statusOf(row);
      @let lines = phoneLinesOf(row);
      <div class="swipe sl-swipe" role="none" [class.sl-swipe--nested]="nested"
           [animate.leave]="leavingId() === row.order.id ? 'mo-leave' : ''"
           [class.swipe--open]="rowOpenSide(row.order.id) === 'end'"
           [class.swipe--open-start]="rowOpenSide(row.order.id) === 'start'"
           [class.swipe--dragging]="draggingOrderId() === row.order.id"
           [style.--swipe-offset]="draggingOrderId() === row.order.id ? swipeOffset() + 'px' : null">
        @if (canArchive(row)) {
          <button class="swipe__archive" type="button" (click)="toggleArchive(row)"
                  [disabled]="archivingOrderId() !== null || containerDeletingId() !== null"
                  [attr.aria-label]="(row.order.archivedAt ? 'Terugzetten uit archief: ' : 'Archiveren: ') + documentLabelOf(row) + ' ' + row.order.number">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M3 6h18v4H3z" /><path d="M5 10v9h14v-9" /><path d="M10 14h4" />
            </svg>
            <span>{{ row.order.archivedAt ? 'Terug' : 'Archief' }}</span>
          </button>
        }
        <a class="ios-cell swipe__row sl-prow" [routerLink]="['/sales', row.order.id]"
           appSalesMenu [appSalesMenuDisabled]="deletingOrderId() !== null || archivingOrderId() !== null || containerDeletingId() !== null"
           (salesMenu)="openRowMenu(null, row)" aria-haspopup="dialog" aria-describedby="sales-menu-help"
           (pointerdown)="startSwipe($event, row)"
           (pointermove)="moveSwipe($event, row)"
           (pointerup)="finishSwipe($event, row)"
           (pointercancel)="cancelSwipe($event)"
           (wheel)="wheelSwipe($event, row)"
           (dragstart)="$event.preventDefault()"
           (click)="blockWhenSwiped($event)">
          <span class="ios-cell__body">
            <span class="sl-ptitle">{{ row.order.number }}</span>
            <span class="sl-psub">{{ documentLabelOf(row) }} · {{ row.order.orderDate | dateNl }}@if (channelCode(row.order.salesChannel) !== 'DIRECT' && !webOrder(row) && !(nested && partner(row.order) && channelCode(row.order.salesChannel) === 'PARTNER')) { <span class="sl-tag sl-tag--channel">{{ channelLabel(row.order.salesChannel) }}</span> }@if (partner(row.order) && !nested && channelCode(row.order.salesChannel) !== 'PARTNER') { <span class="sl-tag">Partner</span> }</span>
            @if (lines.facts.length) {
              <span class="sl-psub">@for (part of lines.facts; track $index) {@if (!$first) { · }<span class="sl-part" [class]="part.cls ? salesTone(part.cls) : ''">{{ part.text }}</span>}</span>
            }
            @if (attn.length) {
              <span class="sl-pattn"><b>{{ attn.length }}</b><span>{{ keepEuro(attn.join(' · ')) }}</span></span>
            }
          </span>
          <span class="ios-cell__trail sl-ptrail">
            <span class="sl-ptotal" [class.so-credit]="creditNoteRow(row)">{{ creditNoteRow(row) ? '− ' : '' }}{{ trailEuro(row.priced.totals.total) }}</span>
            @if (row.priced.validation.freightPricingIssue && !creditNoteRow(row)) { <small class="warn-text">excl. vracht</small> }
            <span class="wk-pill" [class]="salesTone(status.cls)">{{ status.label }}</span>
            @switch (lines.trail.kind) {
              @case ('open') { <span class="sl-pline sl-pline--open" [class.sl-warn]="lines.trail.overdue">{{ lines.trail.text }}</span> }
              @case ('credit') { <span class="sl-pline sl-pline--wrap sl-credit">{{ lines.trail.text }}</span> }
              @case ('day') {
                @let day = dayParts(lines.trail.text);
                <span class="sl-pline sl-pline--wrap" [class.sl-warn]="lines.trail.overdue">{{ day.lead }}<span class="sl-nw">{{ day.day }}</span></span>
              }
            }
          </span>
        </a>
        @if (canDelete(row)) {
          <button class="swipe__delete" type="button"
                  [disabled]="deletingOrderId() !== null || containerDeletingId() !== null"
                  [attr.aria-busy]="deletingOrderId() === row.order.id"
                  (click)="remove(row)"
                  [attr.aria-label]="documentLabelOf(row) + ' ' + row.order.number + ' verwijderen'"
                  [title]="documentLabelOf(row) + ' verwijderen'">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
                 stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                 aria-hidden="true" focusable="false">
              <path d="M4 7h16" /><path d="M9 7V5h6v2" />
              <path d="M6.5 7l1 13h9l1-13" /><path d="M10 11v6" /><path d="M14 11v6" />
            </svg>
          </button>
        }
      </div>
    </ng-template>

    <!-- The Inhoud column; below an 860 px card the same facts fold into the Document sub. -->
    <ng-template #inhoud let-row>
      @if (creditNoteRow(row)) {
        <!-- Only what the note holds: an amount-only note read "0 st · 0 regels · 1 bedrag". No margin on a credit note. -->
        <span class="sl-main">@if (row.priced.lines.length) { {{ row.priced.totals.pieces | num }} st · {{ row.priced.lines.length }} {{ row.priced.lines.length === 1 ? 'regel' : 'regels' }} }@if (row.priced.lines.length && (row.order.extraLines ?? []).length) { · }@if ((row.order.extraLines ?? []).length) { {{ (row.order.extraLines ?? []).length }} {{ (row.order.extraLines ?? []).length === 1 ? 'bedrag' : 'bedragen' }} }</span>
      } @else if (partner(row.order)) {
        <span class="sl-main">{{ row.order.extraLines?.[0]?.description || 'Gekoppeld aan de partnercontainer' }}</span>
      } @else {
        @let loose = row.order.loadMode === 'LOOSE_CARTONS';
        @let pallets = row.priced.totals.palletsManual || row.priced.totals.palletsStrict;
        <span class="sl-main"><span class="sl-nw">{{ row.priced.totals.pieces | num }} st</span> · <span class="sl-nw">@if (loose) { {{ row.priced.totals.cartons | num }} {{ row.priced.totals.cartons === 1 ? 'doos' : 'dozen' }} } @else { {{ pallets }} {{ pallets === 1 ? 'pallet' : 'pallets' }} }</span></span>
        @if (loose || row.priced.totals.marginPct) {
          <span class="sl-sub"><span class="sl-isep"> · </span>@if (loose) { <span class="sl-nw">{{ row.priced.totals.cbm | cbm }}</span> }@if (loose && row.priced.totals.marginPct) { · }@if (row.priced.totals.marginPct) { <span class="sl-nw">marge {{ row.priced.totals.marginPct | pct: 0 }}</span> }</span>
        }
      }
    </ng-template>

    <button class="fab" type="button" [class.fab--text]="businessScope()==='PARTNER'" (click)="startNew()">{{ businessScope() === 'PARTNER' ? 'Container kiezen' : '+ Order' }}</button>

    @if (containerMenu(); as menuContainer) {
      <app-sales-container-menu [container]="menuContainer" [customerName]="customerName(menuContainer.rows[0])"
        [facts]="desktop.active() ? [] : containerHintOf(menuContainer)" [externalBusy]="deletingOrderId() !== null || archivingOrderId() !== null"
        (closed)="containerMenu.set(null)" (busyChange)="containerDeletingId.set($event ? menuContainer.purchaseOrderId : null)"
        (deleted)="containerDeleted($event)" />
    }
    @if (rowMenu(); as menu) {
      <app-context-menu class="sl-menu" [title]="rowMenuTitle(menu.row)" [items]="rowMenuItems(menu.row)" [anchor]="menu.anchor"
                        variant="ios" cancelLabel="Annuleren" (pick)="pickRowMenu($event, menu.row)" (closed)="rowMenu.set(null)" />
    }

    <!-- The phone's Filters: what the desk subbar holds, in kit sections; the badge on the round button counts the choices made here. -->
    @if (filtersOpen()) {
      <app-sheet variant="ios" title="Filters" (closed)="filtersOpen.set(false)">
        <div body class="sl-fsheet">
          @if (ready()) { <p class="sl-fcount" aria-live="polite"><strong>{{ rows().length }}</strong> van {{ pile().length }} {{ pileWord() }}</p> }
          <section class="ios-section">
            <div class="ios-section__head"><h2>Soort verkoop</h2></div>
            <div class="ios-group" role="radiogroup" aria-label="Soort verkoop">
              @for (option of scopeOptions; track option.id) {
                <button class="ios-cell" type="button" role="radio" [attr.aria-checked]="businessScope() === option.id" (click)="businessScope() !== option.id && switchScope(option.id)">
                  <span class="ios-cell__body"><span class="ios-cell__title">{{ option.label }}</span></span>
                  @if (businessScope() === option.id) { <app-icon class="ios-cell__tick" name="tick" [size]="18" /> }
                </button>
              }
            </div>
            <p class="ios-section__foot">{{ scopeHint() }}</p>
          </section>
          <section class="ios-section">
            <div class="ios-section__head"><h2>Status</h2></div>
            <div class="ios-group" role="radiogroup" aria-label="Status">
              @for (chip of chips(); track chip.value) {
                <button class="ios-cell" type="button" role="radio" [attr.aria-checked]="!attentionOnly() && filter() === chip.value" (click)="selectStatus(chip.value)">
                  <span class="ios-cell__body"><span class="ios-cell__title">{{ chip.label }}</span></span>
                  @if (ready()) { <span class="ios-cell__value">{{ chip.count }}</span> }
                  @if (!attentionOnly() && filter() === chip.value) { <app-icon class="ios-cell__tick" name="tick" [size]="18" /> }
                </button>
              }
            </div>
          </section>
          @if (docTab() === 'FACTUUR') {
            <section class="ios-section">
              <div class="ios-section__head"><h2>Facturen</h2></div>
              <div class="ios-group">
                <label class="ios-cell">
                  <span class="ios-cell__body"><span class="ios-cell__title">Alleen nog te ontvangen</span></span>
                  <input class="ios-switch" type="checkbox" role="switch" [checked]="outstandingOnly()" (change)="filterOutstanding($any($event.target).checked)" />
                </label>
              </div>
              <p class="ios-section__foot">Inclusief openstaande facturen en creditnota’s met een tegoed in het archief.</p>
              <div class="ios-group sl-fdocs" role="radiogroup" aria-label="Facturen of creditnota’s">
                @for (option of docsOptions(); track option.id) {
                  <button class="ios-cell" type="button" role="radio" [attr.aria-checked]="docsFilter() === option.id" (click)="filterDocs(option.id)">
                    <span class="ios-cell__body"><span class="ios-cell__title">{{ option.label }}</span></span>
                    @if (ready()) { <span class="ios-cell__value">{{ option.count }}</span> }
                    @if (docsFilter() === option.id) { <app-icon class="ios-cell__tick" name="tick" [size]="18" /> }
                  </button>
                }
              </div>
            </section>
          }
          @if (customersWithOrders().length > 1 || customerFilter() !== '') {
            <section class="ios-section">
              <div class="ios-section__head"><h2>Klant</h2></div>
              <div class="ios-group">
                <label class="ios-cell">
                  <span class="ios-cell__body"><span class="ios-cell__title">Klant</span></span>
                  <span class="ios-cell__value sl-fvalue">{{ activeCustomerLabel() }}</span>
                  <app-icon class="ios-cell__chev" name="chevron-down" [size]="16" />
                  <select class="sl-select__native" aria-label="Filter op klant" [ngModel]="customerFilter()" (ngModelChange)="customerFilter.set($event)">
                    <option [ngValue]="''">Alle klanten</option>
                    @for (customer of customersWithOrders(); track customer.id) {
                      <option [ngValue]="customer.id">{{ customerLabel(customer.id) }}</option>
                    }
                  </select>
                </label>
              </div>
            </section>
          }
        </div>
        <div foot style="display:contents">
          @if (sheetFilterCount()) { <button class="btn" type="button" (click)="clearSheetFilters()">Filters wissen</button> }
          <span class="spacer"></span>
          <button class="btn btn--primary" type="button" (click)="filtersOpen.set(false)">Klaar</button>
        </div>
      </app-sheet>
    }

    @if (splitRow(); as splitData) { <app-sales-split-sheet [view]="splitData" (busyChange)="splitBusy.set($event)" (saved)="splitSaved($event)" (closed)="closeSplit()" /> }

    @if (picking()) {
      <app-sheet [title]="newDocType() === 'FACTUUR' ? 'Nieuwe factuur' : 'Nieuwe offerte'" variant="ios"
                 (closed)="picking.set(false)">
        <div body class="sl-new">
          @if (loading()) {
            <app-skeleton kind="lines" [rows]="3" />
          } @else if (!addingCustomer()) {
            <p class="tiny muted">Reguliere verkoop aan een klant. Samen inkopen met een partner start vanuit de container; zo blijven voorschot en slotfactuur correct gekoppeld.</p>
            <a class="btn btn--sm" routerLink="/purchasing" (click)="picking.set(false)">Partnercontainer kiezen ›</a>
            <div class="per-toggle doc-choice" role="group" aria-label="Documenttype">
              <button type="button" [class.on]="newDocType() === 'OFFERTE'"
                      (click)="newDocType.set('OFFERTE')">Offerte</button>
              <button type="button" [class.on]="newDocType() === 'FACTUUR'"
                      (click)="newDocType.set('FACTUUR')">Factuur</button>
            </div>
            @if (newDocType() === 'FACTUUR') {
              <p class="tiny muted" style="margin:-4px 0 10px">
                Meteen een factuur, zonder offerte vooraf — voor directe verkoop.
                Vanuit een geaccepteerde offerte maak je een factuur via de offerte zelf.
              </p>
            }
            <div class="field">
              <label class="req" for="so-customer">Klant</label>
              <select class="select" id="so-customer" [ngModel]="chosen()"
                      (ngModelChange)="selectCustomer($event)">
                @for (customer of customers(); track customer.id) {
                  <option [ngValue]="customer.id">
                    {{ customer.company }} — {{ customer.city }} ({{ customer.countryCode }})
                  </option>
                }
              </select>
            </div>
            <button class="btn btn--block" type="button" (click)="startAddCustomer()">
              + Klant staat er nog niet bij
            </button>
            <p class="tiny muted mt-8">
              Op de beurs staat de klant vaak nog niet in het systeem. Voeg hem hier meteen toe
              zonder de order te verlaten.
            </p>
          } @else {
            <p class="legend"><b>*</b> verplicht — de rest kan je later aanvullen.</p>
            <div class="form-grid">
              <div class="field span-2">
                <label class="req" for="nc-company">Bedrijfsnaam</label>
                <input class="input" id="nc-company" [ngModel]="newCustomer().company"
                       (ngModelChange)="patchNew({ company: $event })" />
              </div>
              <div class="field">
                <label for="nc-contact">Contactpersoon <span class="opt"></span></label>
                <input class="input" id="nc-contact" [ngModel]="newCustomer().contact"
                       (ngModelChange)="patchNew({ contact: $event })" />
              </div>
              <div class="field">
                <label for="nc-email">E-mail <span class="opt"></span></label>
                <input class="input" id="nc-email" type="email" [ngModel]="newCustomer().email"
                       (ngModelChange)="patchNew({ email: $event })" />
                <span class="hint">Nodig zodra je de offerte wil versturen.</span>
              </div>
              <div class="field">
                <label class="req" for="nc-country">Land</label>
                <select class="select" id="nc-country" [ngModel]="newCustomer().countryCode"
                        (ngModelChange)="patchNew({ countryCode: $event })">
                  @for (country of countries(); track country.code) {
                    <option [value]="country.code">{{ country.name }}</option>
                  }
                </select>
              </div>
              <div class="field">
                <label class="req" for="nc-vat">BTW-nummer</label>
                <input class="input" id="nc-vat" [ngModel]="newCustomer().vatNumber" placeholder="bijv. BE0123456789"
                       (ngModelChange)="patchNew({ vatNumber: $event })" />
                @if (newVatCountryMismatch(); as mismatch) {
                  <span class="hint hint--warn">Landcode {{ mismatch.prefix }} in het BTW-nummer verschilt van het land ({{ mismatch.country }}). Opslaan mag; wij controleren het handmatig.</span>
                } @else {
                  <span class="hint">Verplicht. Klopt het niet met het land, dan controleren we het zelf na.</span>
                }
              </div>
              <div class="field">
                <label class="req" for="nc-language">Taal</label>
                <select class="select" id="nc-language" [ngModel]="newCustomer().language"
                        (ngModelChange)="patchNew({ language: $event })">
                  @for (language of languages; track language.code) {
                    <option [value]="language.code">{{ language.label }}</option>
                  }
                </select>
                <span class="hint">De offerte vertrekt in deze taal.</span>
              </div>
              <div class="field">
                <label for="nc-city">Stad <span class="opt"></span></label>
                <input class="input" id="nc-city" [ngModel]="newCustomer().city"
                       (ngModelChange)="patchNew({ city: $event })" />
              </div>
            </div>
          }
        </div>
        <div foot style="display:contents">
          @if (addingCustomer()) {
            <button class="btn" type="button" (click)="addingCustomer.set(false)">Terug</button>
            <button class="btn btn--primary" type="button" [disabled]="busy()"
                    (click)="saveNewCustomer()">Klant opslaan</button>
          } @else {
            <button class="btn" type="button" [disabled]="creating()"
                    (click)="picking.set(false)">Annuleren</button>
            <button class="btn btn--primary" type="button"
                    [disabled]="loading() || creating() || chosen() === null"
                    [attr.aria-busy]="creating()"
                    (click)="create()">
              {{ creating() ? 'Aanmaken…' : 'Openen' }}
            </button>
          }
        </div>
      </app-sheet>
    }
  `,
  styles: `
    .swipe--dragging { user-select:none }
    .swipe--dragging .swipe__row { transform:translateX(var(--swipe-offset, 0px));transition:none }
    .swipe__row, .sales-container__toggle, .sl-phead { touch-action:pan-y }
    /* The long press opens the menu (the directive): no iOS callout or text selection on the way. */
    @media(pointer:coarse){[appSalesMenu]{-webkit-touch-callout:none;user-select:none}}
    .doc-choice { margin-bottom:12px }
  `,
})
export class SalesList {
  readonly splitRow = signal<SalesOrderView | null>(null);
  readonly splitBusy = signal(false);
  readonly splitBlockReason = salesSplitBlockReason;
  readonly fulfillmentStatus = fulfillmentStatusOf;
  unavailableCount(row: SalesOrderView): number {
    return (row.order.lines ?? []).filter(line => line.unavailable === true).length;
  }
  openSplit(row: SalesOrderView): void {
    if (this.splitBusy() || this.splitBlockReason(row)) return;
    this.rowMenu.set(null); this.openRow.set(null); this.splitRow.set(row);
  }
  closeSplit(): void { if (!this.splitBusy()) { this.splitRow.set(null); void this.load(); } }
  canDeactivate(): boolean { return !this.splitBusy(); }
  @HostListener('window:beforeunload', ['$event'])
  warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.splitBusy()) return;
    event.preventDefault(); event.returnValue = '';
  }
  async splitSaved(result: SalesSplitResult): Promise<void> {
    this.splitBusy.set(false);
    this.splitRow.set(null);
    this.expandedGroups.update(keys => new Set([...keys, `split-${result.groupId}-${result.current.order.customerId ?? 'unknown'}`]));
    this.ui.toast(`Order gesplitst · ${result.later.order.number} voor de nalevering`);
    void this.work.refresh(true);
    await this.load();
  }

  private readonly sales = inject(SalesApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly ui = inject(Ui);
  private readonly work = inject(WorkQueue);
  readonly desktop = inject(DesktopViewport);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly searchField = viewChild<ElementRef<HTMLInputElement>>('searchField');
  private readonly subbar = viewChild<ElementRef<HTMLElement>>('subbar');

  readonly filters: { value: QuoteStatus | ''; label: string }[] = [
    { value: '', label: 'Alle orders' },
    { value: 'CONCEPT', label: 'Concept' },
    { value: 'VERZONDEN', label: 'Verzonden' },
    { value: 'UITGEREIKT', label: 'Uitgereikt' },
    { value: 'BEKEKEN', label: 'Bekeken' },
    { value: 'WIJZIGING_GEVRAAGD', label: 'Wijziging gevraagd' },
    { value: 'GEACCEPTEERD', label: 'Geaccepteerd' },
    { value: 'AFGEWEZEN', label: 'Afgewezen' },
    { value: 'VERLOPEN', label: 'Verlopen' },
    { value: 'GEANNULEERD', label: 'Geannuleerd' },
    { value: 'BETAALD', label: 'Betaald' },
  ];

  readonly filter = signal<QuoteStatus | ''>('');
  readonly docTab = signal<SalesTab>('OFFERTE');
  readonly businessScope = signal<SalesScope>('ALL');

  /** The native host's chrome: the '+' (Order, or Container kiezen in the partner scope) and the section's title menu. */
  readonly hostPage = computed<HostPageInput>(() => ({
    accessory: this.businessScope() === 'PARTNER'
      ? { id: 'startNew', label: 'Container kiezen', icon: 'purchase' }
      : { id: 'startNew', label: 'Order', icon: 'plus', prominent: true },
    titleMenu: 'auto',
  }));

  hostAction(event: HostActionEvent): void {
    if (event.id === 'startNew') this.startNew();
  }
  readonly outstandingOnly = signal(false);
  /** Facturen tab: everything, invoices only, or credit notes only (query param docs). */
  readonly docsFilter = signal<SalesDocsFilter>('all');
  readonly partner = isPartnerDocument;
  readonly creditNoteRow = (row: SalesOrderView): boolean => isCreditNote(row.order);
  readonly creditReason = (row: SalesOrderView): string => creditReasonLabel(row.order.creditReason);
  /** '€ 120,20 verrekend · € 100,00 tegoed' — zero parts left out, 'afgehandeld' when nothing is open. */
  creditLine(row: SalesOrderView): string {
    const settlement = creditNoteSettlement(row.paymentSummary, row.order.status);
    const eur = (value: number) => new EurPipe().transform(value);
    if (['GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN'].includes(row.order.status)) return `${eur(settlement.tegoedEur)} vervallen`;
    const parts: string[] = [];
    if (settlement.offsetEur > 0) parts.push(`${eur(settlement.offsetEur)} verrekend`);
    if (settlement.refundedEur > 0) parts.push(`${eur(settlement.refundedEur)} terugbetaald`);
    parts.push(settlement.openEur > 0 ? `${eur(settlement.openEur)} tegoed` : 'afgehandeld');
    return parts.join(' · ');
  }
  readonly docsCounts = computed(() => {
    const rows = this.inTab();
    const cn = rows.filter((row) => isCreditNote(row.order)).length;
    return { f: rows.length - cn, cn };
  });
  filterDocs(value: SalesDocsFilter): void {
    this.docsFilter.set(value);
    this.openRow.set(null);
    this.rememberNavigation();
  }
  readonly newDocType = signal<'OFFERTE' | 'FACTUUR'>('OFFERTE');
  readonly websiteOnly = signal(false);
  /** Only the website orders the customer can still change: the ones waiting for "In verwerking nemen". */
  readonly toTakeOnly = signal(false);

  /** One row shows an action at a time; a committed delete still asks for confirmation. */
  readonly openRow = signal<{ id: number; side: RowSwipeSide } | null>(null);
  readonly draggingOrderId = signal<number | null>(null);
  readonly swipeOffset = signal(0);
  readonly deletingOrderId = signal<number | null>(null);
  readonly archivingOrderId = signal<number | null>(null);
  readonly containerMenu = signal<SalesContainerGroup | null>(null);
  readonly containerDeletingId = signal<number | null>(null);
  private loadVersion = 0;
  /** The row whose menu is open (⋯, a long press, a right-click or Shift+F10), and where it opens on a desk. */
  readonly rowMenu = signal<{ row: SalesOrderView; anchor: MenuPoint | null } | null>(null);
  /** The row that is being archived or deleted: only that one leaves with a motion. */
  readonly leavingId = signal<number | null>(null);
  private lastPointer: (MenuPoint & { at: number }) | null = null;
  private swipeHandled = false;
  private pointerSwipe: { pointerId: number; orderId: number; startX: number; startY: number;
    startOffset: number; horizontal: boolean; row: HTMLElement } | null = null;
  private swipeResetTimer: ReturnType<typeof setTimeout> | null = null;
  private wheelTotal = 0;
  private wheelOrderId: number | null = null;
  private wheelTimer: ReturnType<typeof setTimeout> | null = null;

  rowOpenSide(id: number): RowSwipeSide | null {
    const open = this.openRow();
    return open !== null && open.id === id ? open.side : null;
  }

  switchTab(tab: SalesTab): void {
    if (this.docTab() === tab) return;
    this.docTab.set(tab);
    /* Quote statuses and invoice statuses are different vocabularies. */
    this.filter.set('');
    this.attentionOnly.set(false);
    this.websiteOnly.set(false);
    this.toTakeOnly.set(false);
    this.outstandingOnly.set(false);
    this.docsFilter.set('all');
    this.openRow.set(null);
    this.expandedGroups.set(new Set());
    this.rememberNavigation();
  }

  switchScope(scope: SalesScope): void {
    this.businessScope.set(scope);
    this.websiteOnly.set(false);
    this.toTakeOnly.set(false);
    this.openRow.set(null);
    this.expandedGroups.set(new Set());
    this.rememberNavigation();
  }

  filterOutstanding(value: boolean): void {
    this.outstandingOnly.set(value);
    this.rememberNavigation();
  }

  private rememberNavigation(): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { scope: this.businessScope(), tab: this.docTab(), payment: this.outstandingOnly() ? 'open' : null, docs: this.docTab() === 'FACTUUR' && this.docsFilter() !== 'all' ? this.docsFilter() : null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  readonly documentCounts = computed(() => ({ OFFERTE: this.docCount('OFFERTE'), FACTUUR: this.docCount('FACTUUR'), ARCHIEF: this.docCount('ARCHIEF') }));

  docCount(tab: SalesTab): number {
    return this.rowsByDocument()[tab].length;
  }

  /** Rows of the active tab, before search and filters; on Facturen `withArchive` (Nog te ontvangen) adds the archive's invoices and credit notes. */
  private inTab(withArchive = this.outstandingOnly()): SalesOrderView[] {
    if (this.docTab() === 'FACTUUR' && withArchive) {
      const grouped = this.rowsByDocument();
      return [...grouped.FACTUUR, ...grouped.ARCHIEF.filter((row) => (row.order.docType ?? 'OFFERTE') !== 'OFFERTE')];
    }
    return this.rowsByDocument()[this.docTab()];
  }

  readonly visibleFilters = computed(() => this.docTab() === 'FACTUUR'
    ? this.filters.filter((option) => ['', 'CONCEPT', 'UITGEREIKT', 'VERZONDEN', 'BETAALD', 'GEANNULEERD'].includes(option.value))
    : this.docTab() === 'ARCHIEF' ? this.filters
    : this.filters.filter((option) => !['BETAALD', 'UITGEREIKT'].includes(option.value)));

  /** The amber under-row line, inkoop-style: everything still waiting on us. */
  attention = (row: SalesOrderView): string[] | null => {
    const items: string[] = [];
    if (isCreditNote(row.order)) {
      if (!['CONCEPT', 'GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN'].includes(row.order.status) && invoiceReceivable(row).creditEur > 0) items.push('Tegoed af te handelen');
      return items.length ? items : null;
    }
    const fullyCredited = this.fullyCredited(row);
    const task = this.todo(row.order, row.awaitingResend, fullyCredited, isAdvanceBillingInvoice(row));
    if (task) items.push(task);
    /* An overdue invoice already reads "Betaling opvolgen"; no second label. A fully credited one has nothing left to chase. */
    if (!fullyCredited && this.overdue(row.order) && !items.includes('Betaling opvolgen')) items.push('Vervallen');
    return items.length ? items : null;
  };

  /** The credit notes took the whole claim back: nothing to ship or chase any more. */
  fullyCredited(row: SalesOrderView): boolean {
    const total = Math.abs(row.paymentSummary?.invoiceTotalEur ?? row.priced.totals.totalInclVat);
    return (row.creditedEur ?? 0) > 0 && total > 0 && row.creditedEur! >= total - 0.005;
  }
  overdue(order: SalesOrder): boolean {
    return invoiceOverdue(order, todayIso());
  }
  readonly query = signal('');
  readonly picking = signal(false);
  readonly chosen = signal<number | null>(null);
  readonly creating = signal(false);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  readonly all = signal<SalesOrderView[]>([]);
  readonly customers = signal<Customer[]>([]);
  private readonly customerById = computed(() =>
    new Map(this.customers().map((customer) => [customer.id, customer])));
  private readonly rowsByDocument = computed(() => {
    const quotes: SalesOrderView[] = [];
    const invoices: SalesOrderView[] = [];
    const archived: SalesOrderView[] = [];
    for (const row of this.all()) {
      if (this.businessScope() === 'STANDARD' && isPartnerDocument(row.order)) continue;
      if (this.businessScope() === 'PARTNER' && !isPartnerDocument(row.order)) continue;
      if (row.order.archivedAt) archived.push(row);
      else ((row.order.docType ?? 'OFFERTE') !== 'OFFERTE' ? invoices : quotes).push(row);
    }
    return { OFFERTE: quotes, FACTUUR: invoices, ARCHIEF: archived };
  });
  /** Per status, over what the search and the other filters leave: the chips' counts. */
  private readonly statusCounts = computed(() => {
    const counts = new Map<string, number>();
    for (const row of this.searched()) {
      counts.set(row.order.status, (counts.get(row.order.status) ?? 0) + 1);
    }
    return counts;
  });
  readonly languages = LANGUAGES;
  readonly countries = signal<Country[]>([]);

  /* Add a customer quickly without leaving the screen. */
  readonly addingCustomer = signal(false);
  readonly busy = signal(false);
  readonly newCustomer = signal<Customer>(blankCustomer('BE'));

  constructor() {
    const query = this.route.snapshot.queryParamMap;
    const scope = query.get('scope');
    if (scope === 'ALL' || scope === 'STANDARD' || scope === 'PARTNER') this.businessScope.set(scope);
    const tab = query.get('tab');
    if (tab === 'OFFERTE' || tab === 'FACTUUR' || tab === 'ARCHIEF') this.docTab.set(tab);
    if (query.get('payment') === 'open') { this.docTab.set('FACTUUR'); this.outstandingOnly.set(true); }
    const docs = query.get('docs');
    if (docs === 'f' || docs === 'cn') { this.docTab.set('FACTUUR'); this.docsFilter.set(docs); }
    /* Before the first load answers: the folds of this device (not in load(), which also runs after every change). */
    this.restoreFolds();
    if (typeof matchMedia === 'function') {
      const destroyRef = inject(DestroyRef);
      for (const [query, target] of [['(max-width: 1100px)', this.compactBar], ['(max-width: 389px)', this.smallPhone]] as const) {
        const media = matchMedia(query);
        const follow = (): void => target.set(media.matches);
        follow();
        media.addEventListener('change', follow);
        destroyRef.onDestroy(() => media.removeEventListener('change', follow));
      }
    }
    /* The subbar wraps on a narrow desk: the table head and the customer rows stick under its real height. */
    effect((onCleanup) => {
      const bar = this.subbar()?.nativeElement;
      if (!bar || typeof ResizeObserver !== 'function') return;
      const host = this.host.nativeElement;
      const observer = new ResizeObserver(() => host.style.setProperty('--sl-subbar-h', `${bar.offsetHeight}px`));
      observer.observe(bar);
      onCleanup(() => { observer.disconnect(); host.style.removeProperty('--sl-subbar-h'); });
    });
    void this.work.refresh();
    void this.load();
    /* The phone home's '+' lands here with ?nieuw=1: open the new-order sheet once and drop the flag so a reload does not reopen it. */
    if (query.get('nieuw') === '1') {
      void this.router.navigate([], { queryParams: { nieuw: null }, queryParamsHandling: 'merge', replaceUrl: true, relativeTo: this.route });
      this.startNew();
    }
  }

  async load(): Promise<void> {
    if (this.loading() && this.all().length) return;
    const version = ++this.loadVersion;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [orders, customers, countries] = await Promise.all([
        this.sales.orders(), this.sales.customers(), this.sales.countries(),
      ]);
      if (version !== this.loadVersion) return;
      this.all.set(orders);
      this.customers.set(customers);
      this.countries.set(countries);
      const selected = this.chosen();
      this.chosen.set(customers.some((customer) => customer.id === selected)
        ? selected : customers[0]?.id ?? null);
      /* The user may already be in the new-order sheet; now the real
         decision can be made. */
      if (this.picking() && !customers.length) {
        this.addingCustomer.set(true);
        this.startAddCustomer();
      }
    } catch (failure: unknown) {
      if (version !== this.loadVersion) return;
      this.loadError.set(messageOf(
        failure,
        'Controleer de verbinding met Enrosed en probeer opnieuw.',
      ));
    } finally {
      if (version === this.loadVersion) this.loading.set(false);
    }
  }

  startAddCustomer(): void {
    /* Klanten's defaults (Vooruitbetaling, BE first), so a customer made here matches one made there. */
    this.newCustomer.set(blankCustomer(defaultCustomerCountry(this.countries().map((country) => country.code)) || 'BE'));
    this.addingCustomer.set(true);
  }

  readonly newVatCountryMismatch = computed(() =>
    vatCountryMismatch(this.newCustomer().vatNumber, this.newCustomer().countryCode));

  patchNew(changes: Partial<Customer>): void {
    this.newCustomer.update((customer) => ({ ...customer, ...changes }));
  }

  /** Saves the new customer and selects them for this order right away. */
  async saveNewCustomer(): Promise<void> {
    if (this.busy()) return;
    if (!this.newCustomer().company.trim()) {
      this.ui.toast('Bedrijfsnaam is verplicht', 'err');
      return;
    }
    /* The server refuses a customer without a VAT number: the same check as Klanten. */
    if (vatNumberMissing(this.newCustomer().vatNumber)) {
      this.ui.toast(VAT_REQUIRED_MESSAGE, 'err');
      setTimeout(() => document.getElementById('nc-vat')?.focus(), 100);
      return;
    }
    this.busy.set(true);
    try {
      const saved = await this.sales.createCustomer(this.newCustomer());
      this.customers.update((list) => [...list, saved]);
      this.chosen.set(saved.id);
      this.addingCustomer.set(false);
      this.ui.toast(`${saved.company} toegevoegd`);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Klant opslaan mislukt'), 'err');
    } finally {
      this.busy.set(false);
    }
  }

  /** The tab's documents after the Facturen / Creditnota's choice: the m of 'n van m' (with 'Nog te ontvangen' the archive's open ones too). */
  readonly pile = computed(() => this.ofDocs(this.inTab()));
  /** The Facturen / Creditnota's choice over `documents`. */
  private ofDocs(documents: SalesOrderView[]): SalesOrderView[] {
    const docs = this.docTab() === 'FACTUUR' ? this.docsFilter() : 'all';
    return docs === 'all' ? documents : documents.filter((row) => isCreditNote(row.order) === (docs === 'cn'));
  }

  /** Every filter but the status chips and Actie vereist: what those chips count, so their counts follow the search. */
  readonly searched = computed(() => {
    const keep = this.narrowing(this.inTab(), this.outstandingOnly());
    return this.pile().filter(keep);
  });

  /**
   * Every filter but the status chips and Actie vereist as one test: the customer, the website toggles, Nog te
   * ontvangen (`outstanding`) and the search, which also finds a container by the names its `documents` carry.
   */
  private narrowing(documents: readonly SalesOrderView[], outstanding: boolean): (row: SalesOrderView) => boolean {
    const customer = this.customerFilter();
    const websiteOnly = this.websiteOnly();
    const toTakeOnly = this.toTakeOnly();
    const query = this.query().trim();
    // A container is found by our own name and by its PO number: the server's live fields, else the advance's cargo snapshot.
    const containerOf = (row: SalesOrderView): number | null =>
      (isPartnerDocument(row.order) ? row.order.partnerPurchaseOrderId : row.order.sourcePurchaseOrderId) ?? null;
    const purchaseNames = new Map<number, Set<string>>();
    for (const row of documents) {
      const purchaseId = containerOf(row);
      if (purchaseId == null) continue;
      const contents = row.advanceContents;
      const names = [row.partnerContainerName, row.partnerContainerNumber,
        contents?.purchaseOrderId === purchaseId ? contents.purchaseOrderNumber : null]
        .map((name) => name?.trim() ?? '').filter((name) => !!name);
      if (!names.length) continue;
      const known = purchaseNames.get(purchaseId) ?? new Set<string>();
      names.forEach((name) => known.add(name));
      purchaseNames.set(purchaseId, known);
    }
    return (row) => {
      const credit = isCreditNote(row.order);
      if (outstanding && (['CONCEPT', 'GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN'].includes(row.order.status)
          || (credit ? invoiceReceivable(row).creditEur <= 0 : invoiceReceivable(row).remainingEur <= 0))) return false;
      if (customer !== '' && row.order.customerId !== customer) return false;
      if (websiteOnly && !countsAsNewWebsiteItem(row)) return false;
      if (toTakeOnly && !customerCanStillChange(row)) return false;
      if (!query) return true;
      const purchaseId = containerOf(row);
      const names = purchaseId != null ? purchaseNames.get(purchaseId) : undefined;
      const container = purchaseId != null
        ? names ? [...names].join(' ') : `Inkoop #${purchaseId}`
        : '';
      /* Every word must occur, accents folded: 'cafe 2026' finds Café Brel's ENR-2026-0041. */
      return matchesWords(this.customerName(row) + ' ' + row.order.number + ' ' + container + ' ' + (row.creditedInvoiceNumber ?? '') + ' '
        + (row.creditNotes ?? []).map((note) => note.number).join(' '), query);
    };
  }

  /** The shown documents: the search and the filters, then a status chip or Actie vereist. */
  readonly rows = computed(() => this.searched().filter((row) => this.chipKeeps(row)));
  /** The status chip and Actie vereist let the row through. */
  private chipKeeps(row: SalesOrderView): boolean {
    const status = this.filter();
    return (!status || row.order.status === status) && (!this.attentionOnly() || this.needsAction(row));
  }

  /**
   * The documents the sums read. On Facturen the archive's open invoices and credit notes count too, Nog te ontvangen
   * on or off: Home and Kosten & bank count them (receivableTotals has no archive filter), so the list never reads less
   * open than they do. These are exactly the rows Nog te ontvangen shows; a document with nothing open adds nothing.
   */
  private readonly moneyRows = computed(() => {
    if (this.docTab() !== 'FACTUUR' || this.outstandingOnly()) return this.rows();
    const documents = this.inTab(true);
    const keep = this.narrowing(documents, true);
    return this.ofDocs(documents).filter((row) => keep(row) && this.chipKeeps(row));
  });

  /** Filtering remains document-based; container sections only organize the matching invoices. */
  readonly groupedRows = computed(() => groupSalesInvoices(this.rows(), row => !!this.attention(row)?.length));
  readonly expandedGroups = signal<ReadonlySet<string>>(new Set());

  groupOpen(key: string): boolean { return this.expandedGroups().has(key); }

  toggleGroup(key: string): void {
    this.openRow.set(null);
    this.expandedGroups.update(current => {
      const expanded = new Set(current);
      if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
      return expanded;
    });
  }

  /** The phone's Filters sheet (Soort verkoop, Status, Klant, the Facturen choices). */
  readonly filtersOpen = signal(false);
  readonly customerFilter = signal<number | ''>('');

  /** Only customers that actually carry orders, in company order. */
  readonly customersWithOrders = computed(() => {
    const ids = new Set(this.all().map((row) => row.order.customerId));
    return this.customers()
      .filter((customer) => ids.has(customer.id))
      .sort((a, b) => a.company.localeCompare(b.company, 'nl'));
  });

  readonly activeCustomerLabel = computed(() =>
    this.customerFilter() === '' ? 'Alle klanten' : this.customerLabel(this.customerFilter() as number));

  /** The company, with its city when another customer carries the same name (two "Entego"s: Mol and Tessenderlo-Ham). */
  private readonly customerLabels = computed(() => {
    const byName = new Map<string, number>();
    for (const customer of this.customers()) {
      const name = customer.company.trim().toLowerCase();
      byName.set(name, (byName.get(name) ?? 0) + 1);
    }
    const labels = new Map<number, string>();
    for (const customer of this.customers()) {
      if (customer.id == null) continue;
      const twin = (byName.get(customer.company.trim().toLowerCase()) ?? 0) > 1;
      labels.set(customer.id, twin && customer.city ? customer.company + ' · ' + customer.city : customer.company);
    }
    return labels;
  });
  customerLabel(id: number | null): string {
    if (id == null) return 'Geen klant';
    return this.customerLabels().get(id) ?? this.customerById().get(id)?.company ?? 'Geen klant';
  }

  readonly activeFilterCount = computed(() =>
    (this.filter() ? 1 : 0) + (this.attentionOnly() ? 1 : 0) + (this.customerFilter() !== '' ? 1 : 0)
      + (this.query().trim() ? 1 : 0) + (this.websiteOnly() ? 1 : 0) + (this.toTakeOnly() ? 1 : 0) + (this.outstandingOnly() ? 1 : 0) + (this.docTab() === 'FACTUUR' && this.docsFilter() !== 'all' ? 1 : 0));

  /** A status chip (or the phone's picker) and Actie vereist exclude each other, as on Inkoop. */
  selectStatus(status: QuoteStatus | ''): void {
    this.filter.set(status);
    this.attentionOnly.set(false);
  }

  clearFilters(): void {
    this.query.set('');
    this.filter.set('');
    this.attentionOnly.set(false);
    this.customerFilter.set('');
    this.websiteOnly.set(false);
    this.toTakeOnly.set(false);
    this.outstandingOnly.set(false);
    this.docsFilter.set('all');
    this.rememberNavigation();
  }

  customerName(row: SalesOrderView): string {
    return this.customerById().get(row.order.customerId)?.company ?? 'Geen klant';
  }

  /** A website order stays until it is cancelled or declined: the customer sees it under their orders. */
  canDelete(row: SalesOrderView): boolean {
    return isSwipeDeletableSalesDocument(row.order) && webOrderDeletable(row);
  }

  /**
   * Archiving is a staff change: on an order the customer can still change it
   * would take the order into processing and mail the customer. That happens
   * only through the button on the document.
   */
  canArchive(row: SalesOrderView): boolean {
    return !customerCanStillChange(row);
  }

  documentLabel(order: SalesOrder): string {
    const row = this.all().find((item) => item.order.id === order.id);
    return billingKind(row) ?? salesDocumentKind(order, row?.settlement?.finalSettlement);
  }

  /** The same kind read off the row itself, for the template: documentLabel scans the whole list on every call (V-L5). */
  documentLabelOf(row: SalesOrderView): string {
    return billingKind(row) ?? salesDocumentKind(row.order, row.settlement?.finalSettlement);
  }

  startSwipe(event: PointerEvent, row: SalesOrderView): void {
    if (!event.isPrimary || event.button !== 0 || this.deletingOrderId() !== null
        || this.archivingOrderId() !== null || this.containerDeletingId() !== null) return;
    if (isSalesMenuInteractiveChild(event.currentTarget as HTMLElement, event.target)) return;
    if (this.swipeResetTimer !== null) clearTimeout(this.swipeResetTimer);
    this.swipeHandled = false;
    const open = this.openRow();
    if (open !== null && open.id !== row.order.id) this.openRow.set(null);
    const target = event.currentTarget as HTMLElement;
    const active = {
      pointerId: event.pointerId,
      orderId: row.order.id,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: restingRowOffset(this.rowOpenSide(row.order.id)),
      horizontal: false,
      row: target,
    };
    this.pointerSwipe = active;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      this.pointerSwipe = null;
    }
  }

  moveSwipe(event: PointerEvent, row: SalesOrderView): void {
    const active = this.pointerSwipe;
    if (!active || active.pointerId !== event.pointerId || active.orderId !== row.order.id) return;
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (!active.horizontal) {
      if (Math.hypot(dx, dy) < ROW_LONG_PRESS_SLOP_PX) return;
      if (Math.abs(dx) <= Math.abs(dy) * 1.2) return;
      active.horizontal = true;
      this.swipeHandled = true;
      this.draggingOrderId.set(active.orderId);
    }
    event.preventDefault();
    event.stopPropagation();
    this.swipeOffset.set(clampRowSwipeOffset(active.startOffset + dx, this.canArchive(row), this.canDelete(row)));
  }

  finishSwipe(event: PointerEvent, row: SalesOrderView): void {
    const active = this.pointerSwipe;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.horizontal) {
      event.preventDefault();
      event.stopPropagation();
      this.settleSwipe(row, this.swipeOffset());
      this.deferSwipeClickRelease();
    }
    this.releaseSwipePointer(active);
    this.resetPointerSwipe();
  }

  /** Where the row was let go decides: bin, archive, a button left showing, or folded back. */
  private settleSwipe(row: SalesOrderView, offset: number): void {
    const decision = rowSwipeDecision(offset);
    if (decision.action === 'commit') {
      this.openRow.set(null);
      if (decision.side === 'end') this.remove(row);
      else void this.toggleArchive(row);
      return;
    }
    this.openRow.set(decision.action === 'reveal' && decision.side !== null
      ? { id: row.order.id, side: decision.side } : null);
  }

  cancelSwipe(event: PointerEvent): void {
    const active = this.pointerSwipe;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.horizontal) this.deferSwipeClickRelease();
    else this.swipeHandled = false;
    this.releaseSwipePointer(active);
    this.resetPointerSwipe();
  }

  /** A horizontal two-finger trackpad gesture follows the same thresholds, both ways. */
  wheelSwipe(event: WheelEvent, row: SalesOrderView): void {
    if (this.deletingOrderId() !== null || this.archivingOrderId() !== null || this.containerDeletingId() !== null) return;
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    event.preventDefault();
    if (this.wheelOrderId !== row.order.id) {
      const open = this.openRow();
      if (open !== null && open.id !== row.order.id) this.openRow.set(null);
      this.wheelOrderId = row.order.id;
      this.wheelTotal = 0;
    }
    this.wheelTotal += event.deltaX;
    if (this.wheelTimer !== null) clearTimeout(this.wheelTimer);
    this.wheelTimer = setTimeout(() => {
      this.wheelOrderId = null;
      this.wheelTotal = 0;
    }, 250);
    /* Scrolling right slides the row left onto the bin; the other way onto the archive. */
    const offset = clampRowSwipeOffset(-this.wheelTotal, this.canArchive(row), this.canDelete(row));
    if (rowSwipeDecision(offset).action === 'commit') {
      this.wheelOrderId = null;
      this.wheelTotal = 0;
    }
    this.settleSwipe(row, offset);
  }

  /** The row's choices as a menu: ⋯, a long press on a phone, a right-click or Shift+F10 on a desk. */
  openRowMenu(event: Event | null, row: SalesOrderView): void {
    event?.preventDefault();
    event?.stopPropagation();
    if (this.containerDeletingId() !== null) return;
    if (this.pointerSwipe) { this.releaseSwipePointer(this.pointerSwipe); this.resetPointerSwipe(); }
    this.containerMenu.set(null);
    this.openRow.set(null);
    this.rowMenu.set({ row, anchor: this.menuAnchor(event) });
  }

  /**
   * Where the desk menu opens: the click on ⋯ (or the button itself from the keyboard), else the press that just
   * opened it (a right-click or a long press, from the directive), else under the focused row (Shift+F10).
   */
  private menuAnchor(event: Event | null): MenuPoint | null {
    if (event instanceof MouseEvent && (event.clientX || event.clientY)) return { x: event.clientX, y: event.clientY };
    if (event?.currentTarget instanceof Element) {
      const rect = event.currentTarget.getBoundingClientRect();
      return { x: rect.left, y: rect.bottom };
    }
    const pointer = this.lastPointer;
    if (pointer && Date.now() - pointer.at < 1500) return { x: pointer.x, y: pointer.y };
    const focused = this.host.nativeElement.ownerDocument.activeElement;
    if (focused instanceof HTMLElement && focused.classList.contains('sl-row')) {
      const rect = focused.getBoundingClientRect();
      return { x: rect.left + 24, y: rect.bottom };
    }
    return pointer ? { x: pointer.x, y: pointer.y } : null;
  }

  /** Where the last press on a row was: a right-click or a long press opens the menu there. */
  notePointer(event: PointerEvent): void { this.lastPointer = { x: event.clientX, y: event.clientY, at: Date.now() }; }

  openContainerMenu(event: Event | null, container: SalesContainerGroup): void {
    event?.preventDefault(); event?.stopPropagation();
    if (this.containerDeletingId() !== null || this.deletingOrderId() !== null
      || this.archivingOrderId() !== null || this.ui.confirmRequest() !== null) return;
    this.rowMenu.set(null); this.openRow.set(null);
    this.containerMenu.set(container);
  }

  async containerDeleted(result: PartnerContainerDeletionResult): Promise<void> {
    const ids = new Set(result.deletedInvoiceIds);
    // The server returns the complete cascade, including invoices hidden by filters.
    this.loadVersion++;
    this.loading.set(false);
    this.all.update(rows => rows.filter(row => !ids.has(row.order.id)));
    this.expandedGroups.update(keys => new Set([...keys].filter(key => !key.startsWith(`container-${result.purchaseOrderId}-customer-`))));
    this.containerMenu.set(null); this.containerDeletingId.set(null); this.openRow.set(null);
    this.ui.toast(`Container en ${ids.size} ${ids.size === 1 ? 'voorschotfactuur' : 'voorschotfacturen'} tijdelijk verwijderd`);
    await this.load();
    // Notification refresh failure must not turn a successful deletion into a retry.
    void this.work.refresh(true).catch(() => undefined);
  }

  /** Off the working list into the archive drawer, or back; the document itself stays as it is. */
  async toggleArchive(row: SalesOrderView): Promise<void> {
    if (!this.canArchive(row) || this.archivingOrderId() !== null || this.containerDeletingId() !== null) return;
    const id = row.order.id;
    const toArchive = !row.order.archivedAt;
    const label = this.documentLabel(row.order);
    this.rowMenu.set(null);
    this.openRow.set(null);
    this.archivingOrderId.set(id);
    try {
      const revision = webOrderRevision(row);
      const updated = toArchive
        ? await this.sales.archiveOrder(id, revision) : await this.sales.unarchiveOrder(id, revision);
      this.leavingId.set(id);
      this.all.update((rows) => rows.map((candidate) => candidate.order.id === id ? updated : candidate));
      this.ui.toast(toArchive ? `${label} ${row.order.number} gearchiveerd` : `${label} ${row.order.number} terug op de lijst`);
    } catch (failure: unknown) {
      this.actionFailed(failure, toArchive ? 'Archiveren mislukt' : 'Terugzetten mislukt');
    } finally {
      this.archivingOrderId.set(null);
    }
  }

  /** A tap after swiping closes the action rather than opening the document. */
  blockWhenSwiped(event: Event): void {
    if (this.openRow() !== null || this.swipeHandled) {
      event.preventDefault();
      event.stopPropagation();
      if (!this.swipeHandled) this.openRow.set(null);
    }
  }

  remove(row: SalesOrderView): void {
    const order = row.order;
    if (!this.canDelete(row) || this.deletingOrderId() !== null || this.containerDeletingId() !== null
        || this.ui.confirmRequest() !== null) return;
    const label = this.documentLabel(order);
    const customer = this.customerName(row);
    this.openRow.set(null);
    this.ui.confirm(
      {
        title: `${label} verwijderen`,
        message: `Weet je zeker dat je ${label.toLowerCase()} <b>${escapeHtml(order.number)}</b> `
          + `van <b>${escapeHtml(customer)}</b> wilt verwijderen?<br><br>`
          + ((order.docType ?? 'OFFERTE') === 'OFFERTE'
              && (order.status !== 'CONCEPT' || order.sentAt !== null)
            ? 'De gedeelde klantlink werkt daarna niet meer.<br><br>'
            : '')
          + TEMPORARY_DELETION_NOTICE,
        confirmLabel: 'Verwijderen',
        danger: true,
      },
      async () => {
        if (this.deletingOrderId() !== null || this.containerDeletingId() !== null) return;
        this.deletingOrderId.set(order.id);
        try {
          await this.sales.deleteOrder(order.id, webOrderRevision(row));
          this.leavingId.set(order.id);
          this.all.update((orders) =>
            orders.filter((candidate) => candidate.order.id !== order.id));
          this.openRow.set(null);
          await this.work.refresh(true);
          this.ui.toast(`${label} verwijderd`);
        } catch (failure: unknown) {
          this.actionFailed(failure, `${label} verwijderen mislukt`);
        } finally {
          if (this.deletingOrderId() === order.id) this.deletingOrderId.set(null);
        }
      },
    );
  }

  private deferSwipeClickRelease(): void {
    if (this.swipeResetTimer !== null) clearTimeout(this.swipeResetTimer);
    this.swipeResetTimer = setTimeout(() => {
      this.swipeHandled = false;
      this.swipeResetTimer = null;
    }, 400);
  }

  private releaseSwipePointer(active: { pointerId: number; row: HTMLElement }): void {
    try {
      if (active.row.hasPointerCapture(active.pointerId)) {
        active.row.releasePointerCapture(active.pointerId);
      }
    } catch {
      /* A cancelled pointer has already been released by the browser. */
    }
  }

  private resetPointerSwipe(): void {
    this.pointerSwipe = null;
    this.draggingOrderId.set(null);
    this.swipeOffset.set(0);
  }

  /**
   * Toasts a failed row action. When the customer changed or cancelled the
   * order after this list loaded, the rows are stale: they are fetched again
   * and the toast says so, as on the document screens.
   */
  private actionFailed(failure: unknown, fallback: string): void {
    if (!isWebOrderConflict(failure)) { this.ui.toast(messageOf(failure, fallback), 'err'); return; }
    this.ui.toast(WEB_ORDER_RELOADED, 'err');
    void this.load();
  }

  statusOf = statusOf;
  readonly channelCode = channelCode;
  readonly channelLabel = channelLabel;

  /** The order marker remains visible in filters and rows, independent of a
      personally dismissed bell item. What still waits for a first look:
      website requests, and website orders nobody took into processing yet. */
  readonly websiteRequests = computed(() => this.all().filter((row) =>
    !row.order.archivedAt && !row.invoicedAsId
    && (row.order.docType ?? 'OFFERTE') === 'OFFERTE' && countsAsNewWebsiteItem(row)));
  /** Website orders the customer can still change; staff take them with the button on the document. */
  readonly ordersToTake = computed(() => this.all().filter((row) =>
    !row.order.archivedAt && (row.order.docType ?? 'OFFERTE') === 'OFFERTE' && customerCanStillChange(row)));
  readonly websiteRequest = isWebsiteQuoteRequest;
  readonly webOrder = isWebOrder;

  /** Where a website order stands between the customer and us; one pill, the first that applies. */
  readonly webOrderPill = webOrderListPill;

  /** What we still must do with this document, or nothing. A voorschotfactuur (noGoods) has nothing to ship. */
  todo = (order: SalesOrder, awaitingResend = false, fullyCredited = false, noGoods = false): string | null => {
    if (order.docType === 'CREDITNOTA') return null;
    if ((order.docType ?? 'OFFERTE') === 'FACTUUR') {
      if (order.status === 'CONCEPT' || fullyCredited) return null;
      if (this.overdue(order)) return 'Betaling opvolgen';
      if (!isAdvanceDocument(order) && !noGoods && !order.goodsShippedAt) return 'Bestelling nog te verzenden';
      return null;
    }
    return actionNeeded(order, awaitingResend);
  };

  startNew(): void {
    if (this.businessScope() === 'PARTNER') {
      void this.router.navigate(['/purchasing']);
      return;
    }
    this.newDocType.set(this.docTab() === 'FACTUUR' ? 'FACTUUR' : 'OFFERTE');
    this.picking.set(true);
    /* While the data is still loading the sheet shows a skeleton; load()
       makes the no-customers-yet call once it actually knows. Deciding on
       an empty in-flight list opened the add-customer form by accident. */
    if (this.loading()) return;
    this.addingCustomer.set(!this.customers().length);
    if (this.addingCustomer()) this.startAddCustomer();
  }

  selectCustomer(value: number | null): void {
    const customerId = Number(value);
    this.chosen.set(Number.isInteger(customerId) && customerId > 0 ? customerId : null);
  }

  async create(): Promise<void> {
    if (this.creating()) return;
    const customerId = this.chosen();
    if (customerId === null) {
      this.ui.toast('Kies eerst een klant', 'err');
      return;
    }
    const customer = this.customers().find((c) => c.id === customerId);
    if (!customer) {
      this.chosen.set(null);
      this.ui.toast('De gekozen klant bestaat niet meer', 'err');
      return;
    }

    this.creating.set(true);
    let view: SalesOrderView;
    try {
      view = await this.sales.createOrder(
        customerId, customer.countryCode, customer.incoterm || 'DAP', this.newDocType());
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Order aanmaken mislukt'), 'err');
      this.creating.set(false);
      return;
    }

    this.picking.set(false);
    try {
      const opened = await this.router.navigate(['/sales', view.order.id, 'edit']);
      if (opened) {
        this.creating.set(false);
        return;
      }
    } catch {
      /* Keep the freshly created order reachable below. */
    }

    this.all.update((orders) => orders.some((row) => row.order.id === view.order.id)
      ? orders : [view, ...orders]);
    this.creating.set(false);
    this.ui.toast(
      `Order ${view.order.number} is aangemaakt. Open hem vanuit het overzicht.`, 'err');
  }

  /* ---- the list (Inkoop recipe, 2026-10-19): tabs, chips, customer groups, sums --------------------------------- */

  /**
   * The documents are known: before the first answer, or after a failed first load, no count or sum shows (never a
   * false '0'). A reload keeps them, and so does a failed one: the list stays with a banner above it.
   */
  readonly ready = computed(() => this.all().length > 0 || (!this.loading() && !this.loadError()));
  /** Actie vereist: only the documents whose amber line says something. */
  readonly attentionOnly = signal(false);
  /** Up to 1100px wide the toolbar is tight: the search gets a shorter placeholder so neither it nor the title is cut. */
  readonly compactBar = signal(false);
  /** Phones under 390px: the phone search reads like the compact desk; at 375 the full placeholder (228 px) lost its last letters. */
  readonly smallPhone = signal(false);
  readonly keepEuro = keepEuro;
  readonly dayParts = dayParts;
  readonly salesTone = salesTone;
  readonly trailEuro = trailEuro;

  readonly tabOptions = computed<SegmentOption[]>(() => {
    const counts = this.documentCounts(), ready = this.ready(), work = this.workTabs();
    const tab = (id: SalesTab, label: string): SegmentOption =>
      ({ id, label, count: ready ? counts[id] : null, dot: work.has(id) ? 'warn' : null });
    return [tab('OFFERTE', 'Offertes'), tab('FACTUUR', 'Facturen'), tab('ARCHIEF', 'Archief')];
  });
  /** The tabs that hold something of the bell's (the same source): their warn dot. */
  private readonly workTabs = computed(() => {
    const ids = new Set(this.work.actions().map((item) => item.orderId).filter((id): id is number => id != null));
    const byDocument = this.rowsByDocument();
    return new Set((['OFFERTE', 'FACTUUR', 'ARCHIEF'] as const).filter((tab) => byDocument[tab].some((row) => ids.has(row.order.id))));
  });

  /** The live documents of the scope (Offertes and Facturen); the per-tab counts stand on the tabs. */
  readonly deskSubtitle = computed(() => this.ready()
    ? countText(this.docCount('OFFERTE') + this.docCount('FACTUUR'), 'document', 'documenten') : NOT_KNOWN_YET);
  /** The phone's large-title caption: the tab's count, on Facturen what is still to receive; narrowed, what shows of how many. */
  readonly phoneCaption = computed(() => {
    if (!this.ready()) return NOT_KNOWN_YET;
    const open = this.docTab() === 'OFFERTE' ? 0 : this.shownMoney().openEur;
    return listCaption(this.docTab(), this.rows().length, this.pile().length, this.activeFilterCount() > 0, open);
  });
  /** The word after 'n van m' in the phone's Filters sheet. */
  readonly pileWord = computed(() => this.docTab() === 'OFFERTE' ? 'offertes' : this.docTab() === 'ARCHIEF' ? 'in het archief'
    : this.docsFilter() === 'cn' ? 'creditnota’s' : 'facturen');

  readonly scopeLabel = computed(() => ({ ALL: 'Alle verkoop', STANDARD: 'Reguliere verkoop', PARTNER: 'Partnercontainers' })[this.businessScope()]);
  readonly scopeHint = computed(() => ({
    STANDARD: 'Offertes, facturen en creditnota’s voor verkoop aan je klanten.',
    PARTNER: 'Voorschotten, veilingafrekeningen en creditnota’s van gezamenlijke inkopen.',
    ALL: 'Reguliere verkoop en partnerdocumenten in één overzicht.',
  })[this.businessScope()]);

  /** Status chips of the tab's vocabulary that have a count (or are chosen), with 'Alle' first; they follow the search. */
  readonly chips = computed(() => {
    const counts = this.statusCounts();
    const chosen = this.filter();
    return this.visibleFilters()
      .filter((option) => option.value === '' || option.value === chosen || (counts.get(option.value) ?? 0) > 0)
      .map((option) => ({ value: option.value, label: option.value === '' ? 'Alle' : option.label,
        count: option.value === '' ? this.searched().length : counts.get(option.value) ?? 0 }));
  });
  readonly actionCount = computed(() => this.searched().filter((row) => this.needsAction(row)).length);
  pickAttention(): void {
    const on = !this.attentionOnly();
    this.attentionOnly.set(on);
    if (on) this.filter.set('');
  }

  /** What the shown documents still hold, on Facturen with the archive's open ones (moneyRows): the subbar's end and the phone caption. */
  readonly shownMoney = computed(() => listMoney(this.moneyRows(), invoiceReceivable, todayIso()));

  /** One block per customer (a desk group, a phone section), on top of the container and split groups (they stay per customer inside it). */
  readonly customerSections = computed(() =>
    customerSections(this.groupedRows(), (id) => this.customerCompany(id), invoiceReceivable, todayIso()));
  private customerCompany(id: number | null): string {
    return id === null ? 'Geen klant' : this.customerLabel(id);
  }

  /** The bell's website items per document: the reasons they add to the amber line (the other kinds repeat todo()). */
  private readonly webWork = computed(() => {
    const titles = new Map<number, string[]>();
    for (const item of this.work.actions()) {
      if (item.kind !== 'WEBSITE_AANVRAAG' || item.orderId == null) continue;
      titles.set(item.orderId, [...(titles.get(item.orderId) ?? []), item.title]);
    }
    return titles;
  });
  /** The amber line of a row: what waits on us, and the bell's website items for this document. */
  rowAttention(row: SalesOrderView): string[] {
    const items = [...(this.attention(row) ?? [])];
    for (const title of this.webWork().get(row.order.id) ?? []) if (!items.includes(title)) items.push(title);
    return items;
  }
  needsAction(row: SalesOrderView): boolean {
    return this.rowAttention(row).length > 0;
  }

  /** 'Verkoopfactuur · 18/10/2026 · uit ENR-2026-0041': the linked documents as text, the row menu opens them. */
  docSubOf(row: SalesOrderView): string {
    const credit = isCreditNote(row.order);
    return documentSub({ kind: this.documentLabelOf(row), date: row.order.orderDate,
      sourceQuote: row.order.sourceQuoteId ? row.sourceQuoteNumber : null,
      invoicedAs: row.invoicedAsId ? row.invoicedAs : null,
      creditedInvoice: credit ? row.creditedInvoiceNumber : null,
      creditReason: credit ? this.creditReason(row) : null });
  }
  /** The line under the status pill (sales-list-model statusParts). */
  statusPartsOf(row: SalesOrderView): LinePart[] {
    const delivery = this.fulfillmentStatus(row);
    return statusParts({
      order: row.order, invoiced: !!(row.invoicedAsId || row.invoicedAs), remainingEur: invoiceReceivable(row).remainingEur,
      overdue: this.overdue(row.order), webOrder: this.webOrder(row), webPill: this.webOrderPill(row),
      websiteRequest: this.websiteRequest(row.order),
      delivery: delivery ? { part: row.fulfillment?.part ?? null, label: delivery.label, cls: delivery.cls } : null,
      shipped: !!row.order.goodsShippedAt && !row.fulfillment, unavailable: this.unavailableCount(row),
    });
  }
  /** The Betaling cell: the same receivable as Kosten & bank. */
  paymentOf(row: SalesOrderView): PaymentCell {
    return paymentCell(row.order, invoiceReceivable(row), this.overdue(row.order));
  }
  /** The phone row's facts line and third trailing line (sales-list-model phoneLines); a credit note hands in what it still holds. */
  phoneLinesOf(row: SalesOrderView): PhoneLines {
    return phoneLines(this.statusPartsOf(row), this.paymentOf(row),
      isCreditNote(row.order) ? creditNoteSettlement(row.paymentSummary, row.order.status).openEur : null);
  }
  /** A phone head: a partner container or a split order with a document's anatomy (sales-list-model containerHead, splitHead). */
  phoneHeadOf(entry: SalesContainerGroup | SalesSplitGroup): PhoneHead {
    const reasons = (row: SalesOrderView): string[] => this.rowAttention(row);
    return entry.kind === 'PARTNER_CONTAINER' ? containerHead(entry, invoiceReceivable, todayIso(), reasons) : splitHead(entry, reasons);
  }
  /** On the phone the container menu's head carries what the head cell leaves out; the desk head shows it all. */
  containerHintOf(container: SalesContainerGroup): string[] {
    return containerHint(container, invoiceReceivable, todayIso());
  }

  /* ---- the phone list: the round filter button and its sheet, the chips that apply ---------------------------- */
  readonly scopeOptions: { id: SalesScope; label: string }[] = [
    { id: 'ALL', label: 'Alles' }, { id: 'STANDARD', label: 'Reguliere verkoop' }, { id: 'PARTNER', label: 'Partnercontainers' },
  ];
  /** Within Facturen: everything, the invoices or the credit notes, with their counts. */
  readonly docsOptions = computed<{ id: SalesDocsFilter; label: string; count: number }[]>(() => {
    const counts = this.docsCounts();
    return [{ id: 'all', label: 'Alle', count: counts.f + counts.cn }, { id: 'f', label: 'Facturen', count: counts.f },
      { id: 'cn', label: 'Creditnota’s', count: counts.cn }];
  });
  /** The phone's chips row, only what applies: Actie vereist, the website toggles on Offertes, Nog te ontvangen once it is on. Null: no row. */
  readonly phoneChips = computed(() => {
    const tab = this.docTab();
    const chips = {
      attention: this.actionCount() > 0 || this.attentionOnly(),
      website: tab === 'OFFERTE' && (this.websiteRequests().length > 0 || this.websiteOnly()),
      toTake: tab === 'OFFERTE' && (this.ordersToTake().length > 0 || this.toTakeOnly()),
      outstanding: tab === 'FACTUUR' && this.outstandingOnly(),
    };
    return chips.attention || chips.website || chips.toTake || chips.outstanding ? chips : null;
  });
  /** The filter button's badge: how many of the sheet's choices stand off their default. */
  readonly sheetFilterCount = computed(() => (this.businessScope() !== 'ALL' ? 1 : 0) + (this.filter() ? 1 : 0)
    + (this.customerFilter() !== '' ? 1 : 0)
    + (this.docTab() === 'FACTUUR' ? (this.outstandingOnly() ? 1 : 0) + (this.docsFilter() !== 'all' ? 1 : 0) : 0));
  /** The sheet's Filters wissen: its own choices back to their default; the search and the chips row stay as they are. */
  clearSheetFilters(): void {
    this.filter.set('');
    this.customerFilter.set('');
    this.outstandingOnly.set(false);
    this.docsFilter.set('all');
    if (this.businessScope() !== 'ALL') this.switchScope('ALL');
    else this.rememberNavigation();
  }

  /* ---- the row menu: Openen, the linked documents, Order splitsen, Archiveren, Verwijderen… */
  rowMenuTitle(row: SalesOrderView): string {
    return `${this.webOrder(row) ? 'Bestelling' : this.documentLabelOf(row)} ${row.order.number}`;
  }

  rowMenuItems(row: SalesOrderView): ContextMenuItem[] {
    const order = row.order;
    const credit = isCreditNote(order);
    const total = `${credit ? '− ' : ''}${new EurPipe().transform(row.priced.totals.total, row.fulfillment || this.partner(order) ? 2 : 0)}`;
    /* The phone row has no Inhoud and no Betaling column: there the hint also carries the m³, the margin and the money facts. */
    const facts = this.desktop.active() ? [this.inhoudText(row)] : [this.inhoudText(row, true), ...this.phoneMoneyFacts(row)];
    const items: ContextMenuItem[] = [{ id: 'open', label: 'Openen', iconName: 'chevron-right',
      hint: [this.customerName(row), statusOf(row).label, total, ...facts].filter(Boolean).join(' · ') }];
    if (order.sourceQuoteId && row.sourceQuoteNumber) items.push({ id: 'quote', label: `Naar offerte ${row.sourceQuoteNumber}`, iconName: 'document' });
    if (row.invoicedAsId && row.invoicedAs) items.push({ id: 'invoice', label: `Naar factuur ${row.invoicedAs}`, iconName: 'receipt' });
    if (credit && row.creditedInvoiceId && row.creditedInvoiceNumber) {
      items.push({ id: 'credited', label: `Naar factuur ${row.creditedInvoiceNumber}`, iconName: 'receipt', hint: this.creditReason(row) });
    }
    if (!this.partner(order) && !row.fulfillment && !this.webOrder(row)) {
      const blocked = this.splitBlockReason(row);
      items.push({ id: 'split', label: 'Order splitsen', iconName: 'exchange', hint: blocked || 'Verplaats producten naar een latere levering',
        disabled: !!blocked || this.splitBusy() });
    }
    if (this.canArchive(row)) {
      items.push({ id: 'archive', label: order.archivedAt ? 'Terugzetten uit archief' : 'Archiveren', iconName: order.archivedAt ? 'restore' : 'archive',
        hint: order.archivedAt ? 'Terug naar de werklijst' : 'Uit de werklijst, naar het tabblad Archief',
        disabled: this.archivingOrderId() !== null || this.containerDeletingId() !== null });
    }
    if (this.canDelete(row)) {
      items.push({ id: 'delete', label: 'Verwijderen…', iconName: 'trash', hint: 'Tijdelijk, na bevestiging', danger: true, divider: true,
        disabled: this.deletingOrderId() !== null || this.containerDeletingId() !== null });
    }
    return items;
  }

  pickRowMenu(item: ContextMenuItem, row: SalesOrderView): void {
    this.rowMenu.set(null);
    const target = item.id === 'open' ? row.order.id : item.id === 'quote' ? row.order.sourceQuoteId
      : item.id === 'invoice' ? row.invoicedAsId : item.id === 'credited' ? row.creditedInvoiceId : null;
    if (target != null) void this.router.navigate(['/sales', target]);
    else if (item.id === 'split') this.openSplit(row);
    else if (item.id === 'archive') void this.toggleArchive(row);
    else if (item.id === 'delete') this.remove(row);
  }

  /**
   * The Inhoud column in a few words, for the Openen hint. Full on the phone, which has no Inhoud column: the m³ and the
   * margin too (never on a credit note or a partner document), a credit note's parts, a partner document's line.
   */
  private inhoudText(row: SalesOrderView, full = false): string {
    const num = (value: number): string => new NumPipe().transform(value);
    const totals = row.priced.totals;
    if (isCreditNote(row.order)) {
      const lines = row.priced.lines.length, amounts = (row.order.extraLines ?? []).length;
      if (!full) return lines ? `${num(totals.pieces)} st` : '';
      return [lines ? `${num(totals.pieces)} st · ${countText(lines, 'regel', 'regels')}` : '', amounts ? countText(amounts, 'bedrag', 'bedragen') : '']
        .filter(Boolean).join(' · ');
    }
    if (this.partner(row.order)) return full ? row.order.extraLines?.[0]?.description || 'Gekoppeld aan de partnercontainer' : '';
    const loose = row.order.loadMode === 'LOOSE_CARTONS';
    const pallets = totals.palletsManual || totals.palletsStrict;
    const parts = [`${num(totals.pieces)} st`, loose ? `${num(totals.cartons)} ${totals.cartons === 1 ? 'doos' : 'dozen'}` : `${pallets} ${pallets === 1 ? 'pallet' : 'pallets'}`];
    if (full && loose) parts.push(new CbmPipe().transform(totals.cbm));
    if (full && totals.marginPct) parts.push(`marge ${new PctPipe().transform(totals.marginPct, 0)}`);
    return parts.join(' · ');
  }

  /**
   * What the phone row leaves to the menu: the exact open amount when the trail rounded it, the due day behind it,
   * what came in and what was credited; on a credit note what was verrekend or paid back and the exact tegoed.
   */
  private phoneMoneyFacts(row: SalesOrderView): string[] {
    const eur = (value: number): string => new EurPipe().transform(value);
    const pay = this.paymentOf(row);
    const invoice = pay.state === 'open' || pay.state === 'settled';
    const credit = pay.state === 'credit' ? creditNoteSettlement(row.paymentSummary, row.order.status) : null;
    return [pay.state === 'open' && roundedAway(pay.openEur) ? `${eur(pay.openEur)} open` : null, this.phoneLinesOf(row).unshown,
      invoice && pay.receivedEur > 0 ? `${eur(pay.receivedEur)} ontvangen` : null,
      invoice && row.creditedEur ? `${eur(row.creditedEur)} gecrediteerd` : null,
      credit && credit.offsetEur > 0 ? `${eur(credit.offsetEur)} verrekend` : null,
      credit && credit.refundedEur > 0 ? `${eur(credit.refundedEur)} terugbetaald` : null,
      credit && roundedAway(credit.openEur) ? `${eur(credit.openEur)} tegoed` : null].filter((fact): fact is string => !!fact);
  }

  /* ---- customer groups folded shut, remembered on this device ---------- */
  private readonly foldedIds = signal<ReadonlySet<number>>(new Set());
  private static readonly FOLD_KEY = 'enrosed.verkoop.folded';
  folded(customerId: number): boolean { return this.foldedIds().has(customerId); }
  toggleFold(customerId: number): void {
    const next = new Set(this.foldedIds());
    if (next.has(customerId)) next.delete(customerId); else next.add(customerId);
    this.foldedIds.set(next);
    try { localStorage.setItem(SalesList.FOLD_KEY, JSON.stringify([...next])); } catch { /* a convenience: without storage the fold lasts this visit */ }
  }
  private restoreFolds(): void {
    try {
      const raw = JSON.parse(localStorage.getItem(SalesList.FOLD_KEY) ?? '[]');
      if (Array.isArray(raw)) this.foldedIds.set(new Set(raw.filter((id): id is number => Number.isInteger(id))));
    } catch { /* nothing remembered */ }
  }

  /* ---- keyboard (desk): / search, Esc clears then leaves, ↑/↓ between rows, N a new document; Shift+F10 is the directive's */
  escapeSearch(event: Event): void {
    const input = event.target as HTMLInputElement;
    event.preventDefault();
    if (this.query()) this.query.set('');
    else input.blur();
  }

  @HostListener('document:keydown', ['$event'])
  onListKey(event: KeyboardEvent): void {
    if (!this.desktop.active() || event.metaKey || event.ctrlKey || event.altKey) return;
    const context = keyContext(event, this.host.nativeElement);
    if (context.typing || context.overlayOpen || !context.inScope) return;
    if (event.key === '/') {
      event.preventDefault();
      this.searchField()?.nativeElement.focus();
    } else if ((event.key === 'n' || event.key === 'N') && !event.shiftKey) {
      event.preventDefault();
      this.startNew();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const rows = [...this.host.nativeElement.querySelectorAll<HTMLElement>('.sl-row')];
      if (!rows.length) return;
      event.preventDefault();
      const index = rows.indexOf(this.host.nativeElement.ownerDocument.activeElement as HTMLElement);
      const next = index < 0 ? (event.key === 'ArrowDown' ? 0 : rows.length - 1)
        : Math.min(rows.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)));
      rows[next].focus();
    }
  }
}
