import { SalesSplitSheet } from './sales-split-sheet';
import { salesSplitBlockReason } from './sales-split-state';
import { fulfillmentStatusOf } from './quote-status';
import type { SalesSplitResult } from '../../core/api/models';
import { TEMPORARY_DELETION_NOTICE } from '../../shared/deleted-item-notice';
import { isAdvanceDocument, isPartnerDocument } from './sales-payment-state';
import { invoiceReceivable } from '../finance/incoming-money';
import { NgTemplateOutlet } from '@angular/common';
import { groupSalesInvoices, type SalesContainerGroup } from './sales-list-groups';
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
import { keepEuro } from '../purchasing/purchase-list-model';
import {
  countText, customerSections, documentSub, invoiceOverdue, listCaption, listMoney, matchesWords, paymentCell, salesTone, statusParts,
  type LinePart, type PaymentCell, type SalesDocsFilter, type SalesScope, type SalesTab,
} from './sales-list-model';

import { SalesDocumentNavigation } from './sales-document-navigation';

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
            EurPipe, NumPipe, PctPipe, CbmPipe, DateNlPipe, SalesDocumentNavigation, SalesContainerMenu, SalesMenuTrigger, SalesSplitSheet],
  template: `
    <app-sales-list-styles />
    <app-page-header title="Verkoop" [subtitle]="desktop.active() ? deskSubtitle() : phoneCaption()">
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
              <span class="sl-select__label">{{ activeCustomerLabel() }}</span><app-icon name="chevron-down" [size]="12" />
              <select class="sl-select__native" aria-label="Filter op klant" [ngModel]="customerFilter()" (ngModelChange)="customerFilter.set($event)">
                <option [ngValue]="''">Alle klanten</option>
                @for (customer of customersWithOrders(); track customer.id) {
                  <option [ngValue]="customer.id">{{ customer.company }}</option>
                }
              </select>
            </span>
          }
          <!-- The counts and sums only once the list is known: while it loads or failed they would read '0' and '€ 0'. -->
          @if (ready()) {
            <span class="wk-subbar__end sl-subbar__end">{{ rows().length }} van {{ pile().length }}@if (docTab() === 'OFFERTE') { · Waarde <b>{{ shownMoney().offerEur | eur: 0 }}</b> excl. btw } @else { · Nog te ontvangen <b [class.sl-warn]="shownMoney().overdueEur > 0">{{ shownMoney().openEur | eur: 0 }}</b>@if (shownMoney().overdueEur > 0) { · Vervallen <span class="sl-warn sl-nw">{{ shownMoney().overdueEur | eur: 0 }}</span> }@if (shownMoney().tegoedEur > 0) { · Tegoeden <span class="sl-nw">{{ shownMoney().tegoedEur | eur: 0 }}</span> } }</span>
          }
          @if (activeFilterCount()) {
            <button class="wk-btn wk-btn--ghost wk-btn--sm sl-clear" type="button" (click)="clearFilters()">Filters wissen</button>
          }
        </div>

        @if (loadError(); as error) {
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
                                  @if (entry.summary.issuedCount) {
                                    <span class="sl-main sl-nw">{{ entry.summary.remainingEur | eur }} open</span>
                                    <span class="sl-sub sl-nw">{{ entry.summary.receivedEur | eur }} ontvangen · incl. btw</span>
                                  }
                                  @if (entry.summary.creditEur > 0) { <span class="sl-sub sl-credit sl-nw">{{ entry.summary.creditEur | eur }} credit incl. btw</span> }
                                </span>
                              }
                              <span class="sl-cell sl-total">
                                <span>{{ entry.summary.totalEur | eur }}</span>
                                @if (entry.summary.draftCount && entry.summary.issuedCount) { <small class="sl-sub">waarvan concept {{ entry.summary.draftEur | eur }}</small> }
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
        @if (loadError()) {
          <section class="sales-load-error" role="alert">
            <span aria-hidden="true">!</span>
            <div><b>Verkoopoverzicht kon niet worden vernieuwd</b><small>{{ loadError() }}</small></div>
            <button class="btn" type="button" [disabled]="loading()" (click)="load()">
              {{ loading() ? 'Laden…' : 'Opnieuw proberen' }}
            </button>
          </section>
        }
        <!-- What waits on us sits at the top, not tucked under Meer: this is
             the list you keep up with, not something you go look up. -->
        @if (attentionCount()) {
          <!-- The card appears and disappears; without its own bottom margin it
               lands right on top of the search bar. -->
          <div class="card" style="border-color:var(--rose-line);margin-bottom:14px">
            <div class="card__head">
              <h2>Klant wacht op ons</h2>
              <span class="spacer"></span>
              <span class="badge badge--todo">{{ attentionCount() }}</span>
            </div>
            <div class="card__body card__body--flush">
              <div class="list">
                @for (item of openWork(); track $index) {
                  <a class="list-item" [routerLink]="['/sales', item.orderId]">
                    <span class="thumb thumb--placeholder">{{ workIcon(item.kind) }}</span>
                    <div class="list-item__body">
                      <div class="list-item__title">{{ item.title }}</div>
                      <div class="list-item__meta">
                        {{ item.orderNumber }}@if (item.customer) { · {{ item.customer }} }
                      </div>
                    </div>
                    <span class="list-item__chev">›</span>
                  </a>
                }
              </div>
            </div>
          </div>
        }

        <app-sales-document-navigation [scope]="businessScope()" [tab]="docTab()"
          [counts]="documentCounts()" [loading]="loading()" [outstandingOnly]="outstandingOnly()" [docs]="docsFilter()" [docsCounts]="docsCounts()"
          (scopeChange)="switchScope($event)" (tabChange)="switchTab($event)" (outstandingChange)="filterOutstanding($event)" (docsChange)="filterDocs($event)" />

        <!-- One quiet row: search grows, two pills open native pickers,
             the count sits at the end - no card, no grid of chips. -->
        <!-- One Filter button; the choices unfold underneath, catalogue-style. -->
        <div class="sales-filterbar">
          <div class="search-control search-control--bar">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="6.5"></circle>
              <path d="m16 16 4 4"></path>
            </svg>
            <input class="input" id="sales-search" type="search" inputmode="search"
                   autocomplete="off" aria-label="Zoek klant, documentnummer of containerreferentie" placeholder="Zoek klant, factuur of container…"
                   [ngModel]="query()" (ngModelChange)="query.set($event)" />
            @if (query()) {
              <button class="search-clear" type="button" aria-label="Zoekopdracht wissen"
                      (click)="query.set('')">×</button>
            }
          </div>
          <button class="filter-toggle" type="button" aria-label="Filters tonen of verbergen"
                  [class.filter-toggle--active]="activeFilterCount() > 0"
                  [attr.aria-expanded]="filtersOpen()"
                  (click)="filtersOpen.set(!filtersOpen())">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
            <span class="hide-mobile">Filters</span>
            @if (activeFilterCount(); as n) { <b class="filter-toggle__count">{{ n }}</b> }
            <i class="filter-toggle__chev" [class.filter-toggle__chev--open]="filtersOpen()"></i>
          </button>
          @if (docTab() === 'OFFERTE' && websiteRequests().length) {
            <button class="website-filter" type="button"
                    [class.website-filter--active]="websiteOnly()"
                    [attr.aria-pressed]="websiteOnly()"
                    (click)="websiteOnly.set(!websiteOnly())">
              <span>Website</span>
              <b>{{ websiteRequests().length }}</b>
            </button>
          }
          @if (docTab() === 'OFFERTE' && ordersToTake().length) {
            <button class="website-filter" type="button"
                    [class.website-filter--active]="toTakeOnly()"
                    [attr.aria-pressed]="toTakeOnly()"
                    (click)="toTakeOnly.set(!toTakeOnly())">
              <span>In verwerking te nemen</span>
              <b>{{ ordersToTake().length }}</b>
            </button>
          }
          @if (filtersOpen()) {
            <div class="filter-grid">
              <label class="filter-field">
                <span class="filter-field__label">Status</span>
                <select class="select filter-field__select" [ngModel]="filter()" (ngModelChange)="selectStatus($event)">
                  @for (option of visibleFilters(); track option.value) {
                    <option [ngValue]="option.value">{{ option.label }} ({{ statusCount(option.value) }})</option>
                  }
                </select>
              </label>
              <label class="filter-field">
                <span class="filter-field__label">Klant</span>
                <select class="select filter-field__select" [ngModel]="customerFilter()" (ngModelChange)="customerFilter.set($event)">
                  <option [ngValue]="''">Alle klanten</option>
                  @for (customer of customersWithOrders(); track customer.id) {
                    <option [ngValue]="customer.id">{{ customer.company }}</option>
                  }
                </select>
              </label>
            </div>
            <div class="filter-summary">
              <span><strong>{{ rows().length }}</strong> van {{ pile().length }} {{ pileWord() }}</span>
              @if (activeFilterCount()) {
                <button class="filter-reset" type="button" (click)="clearFilters()">Filters wissen</button>
              }
            </div>
          }
        </div>

        <ng-template #documentRow let-row let-grouped="grouped">
              <!-- Drag left for the bin, drag right for the archive; hold the
                   row (or right-click it) for the same choices as a menu. -->
              <div class="swipe" [class.swipe--grouped]="grouped"
                   [class.swipe--open]="rowOpenSide(row.order.id) === 'end'"
                   [class.swipe--open-start]="rowOpenSide(row.order.id) === 'start'"
                   [class.swipe--dragging]="draggingOrderId() === row.order.id"
                   [style.--swipe-offset]="draggingOrderId() === row.order.id ? swipeOffset() + 'px' : null">
              @if (canArchive(row)) {
              <button class="swipe__archive" type="button" (click)="toggleArchive(row)"
                      [disabled]="archivingOrderId() !== null || containerDeletingId() !== null"
                      [attr.aria-label]="(row.order.archivedAt ? 'Terugzetten uit archief: ' : 'Archiveren: ')
                        + documentLabelOf(row) + ' ' + row.order.number">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M3 6h18v4H3z" /><path d="M5 10v9h14v-9" /><path d="M10 14h4" />
                </svg>
                <span>{{ row.order.archivedAt ? 'Terug' : 'Archief' }}</span>
              </button>
              }
              <a class="list-item swipe__row" [routerLink]="['/sales', row.order.id]"
                 appSalesMenu [appSalesMenuDisabled]="deletingOrderId() !== null || archivingOrderId() !== null || containerDeletingId() !== null"
                 (salesMenu)="openRowMenu(null, row)" aria-haspopup="dialog" aria-describedby="sales-menu-help"
                 (pointerdown)="startSwipe($event, row)"
                 (pointermove)="moveSwipe($event, row)"
                 (pointerup)="finishSwipe($event, row)"
                 (pointercancel)="cancelSwipe($event)"
                 (wheel)="wheelSwipe($event, row)"
                 (dragstart)="$event.preventDefault()"
                 (click)="blockWhenSwiped($event)">
                <div class="list-item__body">
                  <div class="list-item__title">{{ grouped ? row.order.number : customerName(row) }}</div>
                  <!-- No country chip: it repeats what the customer name already
                       implies and pushed the date into "18/0...". -->
                  <div class="list-item__meta list-item__meta--wrap">
                    {{ documentLabelOf(row) }} ·
                    @if (!grouped) { {{ row.order.number }} · }{{ row.order.orderDate | dateNl }}
                    @if (row.order.sourceQuoteId && row.sourceQuoteNumber) { · uit {{ row.sourceQuoteNumber }} }
                    @if (row.invoicedAs && row.invoicedAsId) { · factuur {{ row.invoicedAs }} }
                    @if (creditNoteRow(row) && row.creditedInvoiceNumber) { · op {{ row.creditedInvoiceNumber }} · {{ creditReason(row) }} }
                    @if (!grouped && channelCode(row.order.salesChannel) !== 'DIRECT' && !webOrder(row)) { · <span class="channel-tag">{{ channelLabel(row.order.salesChannel) }}</span> }
                    @if (docTab() === 'FACTUUR' && row.order.invoiceDueDate && !creditNoteRow(row)) {
                      · vervalt {{ row.order.invoiceDueDate | dateNl }}
                    }
                  </div>
                  <div class="list-item__meta list-item__meta--wrap">
                    @if (creditNoteRow(row)) {
                      <!-- Only what the note holds: an amount-only note read "0 st · 0 regels · 1 bedrag". -->
                      @if (row.priced.lines.length) { {{ row.priced.totals.pieces | num }} st · {{ row.priced.lines.length }} {{ row.priced.lines.length === 1 ? 'regel' : 'regels' }} }@if (row.priced.lines.length && (row.order.extraLines ?? []).length) { · }@if ((row.order.extraLines ?? []).length) { {{ (row.order.extraLines ?? []).length }} {{ (row.order.extraLines ?? []).length === 1 ? 'bedrag' : 'bedragen' }} }
                    } @else if (partner(row.order)) {
                      {{ row.order.extraLines?.[0]?.description || 'Gekoppeld aan de partnercontainer' }}
                    } @else {
                    {{ row.priced.totals.pieces | num }} st ·
                    @if (row.order.loadMode === 'LOOSE_CARTONS') {
                      {{ row.priced.totals.cartons | num }}
                      {{ row.priced.totals.cartons === 1 ? 'doos' : 'dozen' }} ·
                      {{ row.priced.totals.cbm | cbm }}
                    } @else {
                      {{ row.priced.totals.palletsManual || row.priced.totals.palletsStrict }}
                      {{ (row.priced.totals.palletsManual || row.priced.totals.palletsStrict) === 1
                          ? 'pallet' : 'pallets' }}
                    }
                    @if (!partner(row.order) && row.priced.totals.marginPct) {
                      · marge {{ row.priced.totals.marginPct | pct: 0 }}
                    }
                    }
                  </div>
                </div>
                <div class="list-item__end list-item__end--stacked">
                  @if (webOrder(row)) {
                    <span class="so-source-mini">Websitebestelling</span>
                    @if (webOrderPill(row); as pill) {
                      <span [class]="'so-status-mini so-status-mini--' + pill.cls"><i aria-hidden="true"></i>{{ pill.label }}</span>
                    }
                  } @else if (websiteRequest(row.order)) {
                    <span class="so-source-mini">Websiteaanvraag</span>
                  }
                  <div class="strong num" [class.so-credit]="creditNoteRow(row)">{{ creditNoteRow(row) ? '− ' : '' }}{{ row.priced.totals.total | eur: (row.fulfillment || partner(row.order) ? 2 : 0) }}</div>
                  @if (row.priced.validation.freightPricingIssue && !creditNoteRow(row)) { <small class="warn-text">excl. vracht</small> }
                  @if (creditNoteRow(row) && row.order.status !== 'CONCEPT') {
                    <small class="so-credit-tegoed">{{ creditLine(row) }}</small>
                  } @else if (row.order.docType === 'FACTUUR' && row.order.status !== 'CONCEPT') {
                    <small>{{ receivable(row).receivedEur | eur }} ontvangen · {{ receivable(row).remainingEur | eur }} open</small>
                    @if (row.creditedEur) { <small class="so-credited">{{ row.creditedEur | eur }} gecrediteerd</small> }
                  }
                  <span class="so-status-mini" [class]="'so-status-mini so-status-mini--' + statusOf(row).cls">
                    <i aria-hidden="true"></i>{{ statusOf(row).label }}
                  </span>
                  @if (unavailableCount(row); as count) {
                    <span class="so-status-mini so-status-mini--gold">{{ count }} {{ count === 1 ? 'product' : 'producten' }} niet beschikbaar</span>
                  }
                  @if (fulfillmentStatus(row); as delivery) {
                    <span [class]="'so-status-mini so-status-mini--' + delivery.cls"><i aria-hidden="true"></i>Deel {{ row.fulfillment?.part }} · {{ delivery.label }}</span>
                  }
                  @if (row.order.goodsShippedAt && !row.fulfillment) {
                    <span class="so-status-mini so-status-mini--ok">
                      <i aria-hidden="true"></i>Bestelling verzonden
                    </span>
                  }
                  @if (attention(row); as attn) {
                    <span class="so-status-mini so-status-mini--warn" [attr.title]="attn.join(' · ')">
                      <i aria-hidden="true"></i>{{ attn[0] }}{{ attn.length > 1 ? ' +' + (attn.length - 1) : '' }}
                    </span>
                  }
                </div>
                <span class="list-item__chev">›</span>
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

        <div class="card" id="sales-document-results" role="tabpanel" [attr.aria-labelledby]="'sales-tab-' + docTab()" [attr.aria-busy]="loading()" tabindex="0">
          <div class="list">
            @for (entry of groupedRows(); track entry.key) {
              @if (entry.kind === 'PARTNER_CONTAINER') {
                <section class="sales-container" [class.sales-container--open]="groupOpen(entry.key)">
                  <div class="sales-container__header">
                  <button class="sales-container__toggle" type="button"
                          appSalesMenu [appSalesMenuDisabled]="containerDeletingId() !== null || deletingOrderId() !== null || archivingOrderId() !== null"
                          (salesMenu)="openContainerMenu(null, entry)" aria-haspopup="dialog" aria-describedby="sales-menu-help"
                          [id]="entry.key + '-toggle'" [attr.aria-expanded]="groupOpen(entry.key)"
                          [attr.aria-controls]="entry.key + '-invoices'" (click)="toggleGroup(entry.key)">
                    <span class="sales-container__identity">
                      <span class="sales-container__eyebrow">Partnercontainer</span>
                      <strong>{{ customerName(entry.rows[0]) }}</strong>
                      <span class="sales-container__meta" [attr.title]="entry.purchaseOrderNumber && entry.purchaseOrderNumber !== entry.purchaseOrderName ? 'Inkooporder ' + entry.purchaseOrderNumber : null">{{ entry.purchaseOrderName }} · {{ entry.summary.count }} {{ entry.summary.count === 1 ? 'factuur' : 'facturen' }}@if (entry.summary.containerPieces !== null) { · {{ entry.summary.containerPieces | num }} stuks in container }</span>
                      <span class="sales-container__badges">
                        @for (status of entry.summary.statuses; track status.label) {
                          <span [class]="'so-status-mini so-status-mini--' + status.cls"
                                [class.sales-container__status--concept]="status.concept">
                            <i aria-hidden="true"></i>{{ status.count }} {{ status.label }}@if (status.concept) { · nog niet uitgereikt }@if (status.inactive) { · buiten totaal }
                          </span>
                        }
                        @if (entry.summary.attentionCount) { <span class="so-status-mini so-status-mini--warn">{{ entry.summary.attentionCount }} {{ entry.summary.attentionCount === 1 ? 'factuur vraagt' : 'facturen vragen' }} aandacht</span> }
                      </span>
                    </span>
                    <span class="sales-container__totals">
                      <small>Getoonde facturen · excl. btw</small><strong>{{ entry.summary.totalEur | eur }}</strong>
                      @if (entry.summary.draftCount && entry.summary.issuedCount) { <small>Waarvan concept {{ entry.summary.draftEur | eur }}</small> }
                      @if (entry.summary.issuedCount) { <small>{{ entry.summary.receivedEur | eur }} ontvangen · {{ entry.summary.remainingEur | eur }} open incl. btw</small> }
                      @if (entry.summary.creditEur > 0) { <small>{{ entry.summary.creditEur | eur }} credit incl. btw</small> }
                    </span>
                    <span class="sales-container__chevron" aria-hidden="true"></span>
                  </button>
                  </div>
                  <div class="sales-container__invoices" [id]="entry.key + '-invoices'"
                       [hidden]="!groupOpen(entry.key)" role="group" [attr.aria-labelledby]="entry.key + '-toggle'">
                    @if (groupOpen(entry.key)) {
                      <div class="sales-container__tools"><span>De facturen hieronder volgen je huidige filters.</span><a [routerLink]="['/purchasing', entry.purchaseOrderId]" [queryParams]="{ section: 'payments' }">Container en betaalafspraken ›</a></div>
                      @for (row of entry.rows; track row.order.id) {
                        <ng-container [ngTemplateOutlet]="documentRow" [ngTemplateOutletContext]="{ $implicit: row, grouped: true }" />
                      }
                    }
                  </div>
                </section>
              } @else if (entry.kind === 'SPLIT_ORDER') {
                <section class="sales-container sales-container--split" [class.sales-container--open]="groupOpen(entry.key)">
                  <div class="sales-container__header">
                    <button class="sales-container__toggle" type="button" [id]="entry.key + '-toggle'" [attr.aria-expanded]="groupOpen(entry.key)" [attr.aria-controls]="entry.key + '-parts'" (click)="toggleGroup(entry.key)">
                      <span class="sales-container__identity">
                        <span class="sales-container__eyebrow">Gesplitste order</span><strong>{{ customerName(entry.rows[0]) }}</strong>
                        <span class="sales-container__meta">{{ entry.summary.parts }} van 2 delen in dit overzicht · {{ entry.summary.pieces | num }} stuks</span>
                        <span class="sales-container__badges">
                          @if (entry.summary.unavailableCount) { <span class="so-status-mini so-status-mini--gold">{{ entry.summary.unavailableCount }} niet beschikbaar</span> }
                          @if (entry.summary.waitingCount) { <span class="so-status-mini so-status-mini--gold"><i aria-hidden="true"></i>{{ entry.summary.waitingCount }} wacht op voorraad</span> }
                          @if (entry.summary.shippedCount) { <span class="so-status-mini so-status-mini--ok"><i aria-hidden="true"></i>{{ entry.summary.shippedCount }} verzonden</span> }
                          @if (!entry.summary.waitingCount && !entry.summary.shippedCount && entry.summary.pieces > 0) { <span class="so-status-mini so-status-mini--blue"><i aria-hidden="true"></i>Leveringen gepland</span> }
                        </span>
                      </span>
                      <span class="sales-container__totals"><small>Getoonde delen · excl. btw</small><strong>{{ entry.summary.totalEur | eur }}</strong></span><span class="sales-container__chevron" aria-hidden="true"></span>
                    </button>
                  </div>
                  <div class="sales-container__invoices" [id]="entry.key + '-parts'" [hidden]="!groupOpen(entry.key)" role="group" [attr.aria-labelledby]="entry.key + '-toggle'">
                    @if (groupOpen(entry.key)) {
                      <div class="sales-container__tools"><span>Elk deel heeft een eigen document- en leverstatus.</span></div>
                      @for (row of entry.rows; track row.order.id) { <ng-container [ngTemplateOutlet]="documentRow" [ngTemplateOutletContext]="{ $implicit: row, grouped: true }" /> }
                    }
                  </div>
                </section>
              } @else {
                <ng-container [ngTemplateOutlet]="documentRow" [ngTemplateOutletContext]="{ $implicit: entry.row, grouped: false }" />
              }
            } @empty {
              @if (loading()) {
                <app-skeleton kind="list" [rows]="5" />
              } @else if (loadError()) {
                <div class="empty">
                  <div class="empty__icon">!</div>
                  <div class="empty__title">Orders niet geladen</div>
                  <p class="muted">Gebruik ‘Opnieuw proberen’ bovenaan.</p>
                </div>
              } @else if (activeFilterCount()) {
                <div class="empty">
                  <div class="empty__icon">⌕</div>
                  <div class="empty__title">Geen orders gevonden</div>
                  <p class="muted">Pas de zoekterm of offertestatus aan.</p>
                  <button class="btn" type="button" (click)="clearFilters()">
                    Filters wissen
                  </button>
                </div>
              } @else {
                <div class="empty">
                  <div class="empty__icon">▤</div>
                  <div class="empty__title">{{ docTab() === 'OFFERTE' ? 'Nog geen offertes' : docTab() === 'FACTUUR' ? 'Nog geen facturen' : 'Het archief is leeg' }}</div>
                  <p class="muted">{{ businessScope() === 'PARTNER' ? 'Partnerdocumenten maak je vanuit de betreffende inkoopcontainer.' : 'Hier verschijnen de documenten voor de gekozen soort verkoop.' }}</p>
                  @if (businessScope() === 'PARTNER') { <a class="btn btn--primary" routerLink="/purchasing">Naar partnercontainers</a> } @else if (docTab() !== 'ARCHIEF') { <button class="btn btn--primary" type="button" (click)="startNew()">
                    Nieuwe order
                  </button> }
                </div>
              }
            }
          </div>
        </div>
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
            <span class="sl-sub">{{ docSubOf(row) }}@if (channelCode(row.order.salesChannel) !== 'DIRECT' && !webOrder(row)) { <span class="sl-tag sl-tag--channel">{{ channelLabel(row.order.salesChannel) }}</span> }@if (partner(row.order) && !nested) { <span class="sl-tag">Partner</span> }<span class="sl-inhoud-inline"> · <ng-container *ngTemplateOutlet="inhoud; context: { $implicit: row }" /></span></span>
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
        [externalBusy]="deletingOrderId() !== null || archivingOrderId() !== null"
        (closed)="containerMenu.set(null)" (busyChange)="containerDeletingId.set($event ? menuContainer.purchaseOrderId : null)"
        (deleted)="containerDeleted($event)" />
    }
    @if (rowMenu(); as menu) {
      <app-context-menu class="sl-menu" [title]="rowMenuTitle(menu.row)" [items]="rowMenuItems(menu.row)" [anchor]="menu.anchor"
                        variant="ios" cancelLabel="Annuleren" (pick)="pickRowMenu($event, menu.row)" (closed)="rowMenu.set(null)" />
    }

    @if (splitRow(); as splitData) { <app-sales-split-sheet [view]="splitData" (busyChange)="splitBusy.set($event)" (saved)="splitSaved($event)" (closed)="closeSplit()" /> }

    @if (picking()) {
      <app-sheet [title]="newDocType() === 'FACTUUR' ? 'Nieuwe factuur' : 'Nieuwe offerte'"
                 (closed)="picking.set(false)">
        <div body>
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
    .sales-container:not(:last-child){border-bottom:1px solid var(--line)}
    .sales-container__header{display:flex;align-items:stretch;background:var(--surface)}
    .sales-container__toggle{display:grid;grid-template-columns:minmax(0,1fr) auto 16px;grid-template-areas:'identity totals chevron';align-items:center;gap:18px;flex:1;min-width:0;min-height:98px;padding:19px 20px;border:0;background:transparent;color:var(--ink);font:inherit;text-align:left;cursor:pointer;transition:background .18s ease}
    .sales-container__toggle:hover,.sales-container--open>.sales-container__header{background:color-mix(in srgb,var(--rose-soft) 55%,var(--surface))}
    .sales-container__toggle:focus-visible{outline:3px solid var(--rose);outline-offset:-3px}
    .sales-container__toggle{touch-action:pan-y}
    @media(pointer:coarse){[appSalesMenu]{-webkit-touch-callout:none;user-select:none}}
    .sales-container__identity{grid-area:identity;display:grid;gap:5px;min-width:0}
    .sales-container__identity>strong{font-size:16px;overflow-wrap:anywhere}
    .sales-container__eyebrow{font-size:10px;font-weight:750;letter-spacing:.06em;text-transform:uppercase;color:var(--rose-dark)}
    .sales-container__meta{font-size:12px;line-height:1.45;color:var(--muted);overflow-wrap:anywhere}
    .sales-container__badges{display:flex;flex-wrap:wrap;gap:5px;margin-top:3px}
    .sales-container__totals{grid-area:totals;display:grid;gap:4px;text-align:right;font-variant-numeric:tabular-nums}
    .sales-container__totals>strong{font-size:19px;letter-spacing:-.02em}
    .sales-container__totals>small{font-size:11px;color:var(--muted);line-height:1.4}
    .sales-container__chevron{grid-area:chevron;width:8px;height:8px;border-right:2px solid var(--rose-dark);border-bottom:2px solid var(--rose-dark);transform:rotate(45deg);transition:transform .2s ease}
    .sales-container--open .sales-container__chevron{transform:rotate(225deg)}
    .sales-container__invoices:not([hidden]){border-top:1px solid var(--rose-line);animation:container-invoices-enter .18s ease-out}
    .sales-container__tools{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;padding:11px 20px;background:var(--surface-2);font-size:11px;line-height:1.5;color:var(--muted)}
    .sales-container__tools a{color:var(--rose-dark);font-weight:650;text-underline-offset:3px}
    .sales-container__invoices>.swipe:not(:last-child){border-bottom:1px solid var(--line)}
    .swipe--grouped .list-item{border-bottom:0;padding-left:26px}
    .swipe--grouped .list-item__title{font-size:13px}
    @keyframes container-invoices-enter{from{opacity:.4;transform:translateY(-3px)}to{opacity:1;transform:none}}
    @media(max-width:600px){
      .sales-container__toggle{grid-template-columns:minmax(0,1fr) 16px;grid-template-areas:'identity chevron' 'totals totals';gap:12px;padding:16px}
      .sales-container__totals{text-align:left;border-top:1px solid var(--line);padding-top:10px}
      .sales-container__totals>strong{font-size:20px}
      .sales-container__tools{padding:11px 16px}
      .swipe--grouped .list-item{padding-left:16px}
    }
    @media(prefers-reduced-motion:reduce){.sales-container__toggle,.sales-container__chevron{transition:none}.sales-container__invoices:not([hidden]){animation:none}}
    .swipe--dragging { user-select:none }
    .swipe--dragging .swipe__row { transform:translateX(var(--swipe-offset, 0px));transition:none }
    .swipe__row { touch-action:pan-y }
    .so-status-mini { display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:3px 9px;
      border-radius:999px;background:color-mix(in srgb,currentColor 10%,transparent);
      font-size:10.5px;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis }
    .so-status-mini i { width:6px;height:6px;flex:none;border-radius:50%;background:currentColor }
    @media(max-width:600px){.list-item__end .so-status-mini{white-space:normal;text-align:left;overflow-wrap:anywhere;line-height:1.35}}
    .so-status-mini--ok { color:var(--ok) }
    .so-status-mini--danger { color:var(--danger) }
    .so-status-mini--gold { color:var(--gold) }
    .so-status-mini--rose { color:var(--rose-dark) }
    .so-status-mini--blue { color:var(--blue) }
    .so-status-mini--neutral { color:var(--muted) }
    .so-status-mini--warn { color:var(--warn) }
    .sales-container__status--concept { color:var(--ink);font-weight:700;background:var(--surface-2) }
    .so-source-mini { display:inline-flex;align-items:center;max-width:100%;padding:4px 9px;
      border:1px solid color-mix(in srgb,var(--rose) 38%,transparent);border-radius:999px;
      background:var(--rose);color:#fff;font-size:10px;font-weight:780;line-height:1.2;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 4px 12px rgb(103 31 52/14%) }

    .doc-choice { margin-bottom:12px }
    .sales-filterbar { display:flex;flex-wrap:wrap;align-items:center;gap:9px;margin-bottom:12px;padding:12px;
      border:1px solid var(--line);border-radius:var(--r);background:color-mix(in srgb,var(--surface) 88%,var(--surface-2));
      box-shadow:0 5px 18px rgb(31 25 22/4%) }
    .sales-load-error { display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;
      gap:12px;margin-bottom:14px;padding:14px;border:1px solid var(--danger);border-radius:var(--r-sm);
      background:var(--danger-soft);color:var(--danger) }
    .sales-load-error>span { display:grid;width:38px;height:38px;place-items:center;border-radius:50%;
      background:var(--surface);font-size:18px;font-weight:800 }
    .sales-load-error>div { display:grid;gap:2px;min-width:0 }
    .sales-load-error b { font-size:15px }
    .sales-load-error small { color:var(--muted);font-size:14px;line-height:1.45 }
    .sales-load-error .btn { min-height:48px }
    .filter-toggle { display:inline-flex;align-items:center;gap:7px;min-height:42px;padding:0 13px;border:1px solid var(--line);
      border-radius:13px;background:var(--surface);color:var(--ink-2);font:inherit;font-size:13px;font-weight:650;cursor:pointer }
    .filter-toggle--active { border-color:var(--rose-line);color:var(--rose-dark);background:var(--rose-soft) }
    .filter-toggle svg { width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round }
    .filter-toggle__count { display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;border-radius:999px;
      background:var(--rose);color:#fff;font-size:10.5px }
    .filter-toggle__chev { width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;
      transform:rotate(45deg);transition:transform .15s ease }
    .filter-toggle__chev--open { transform:rotate(-135deg) }
    .website-filter { display:inline-flex;align-items:center;gap:7px;min-height:42px;padding:0 12px;
      border:1px solid var(--rose-line);border-radius:13px;background:var(--rose-soft);
      color:var(--rose-dark);font:inherit;font-size:12px;font-weight:720;cursor:pointer }
    .website-filter b { display:grid;min-width:20px;height:20px;padding:0 5px;place-items:center;
      border-radius:999px;background:#fff;color:var(--rose-dark);font-size:10px;font-variant-numeric:tabular-nums }
    .website-filter--active { border-color:var(--rose);background:var(--rose);color:#fff }
    .website-filter--active b { color:var(--rose-dark) }
    .filter-grid { flex:1 0 100%;display:grid;gap:10px }
    @media (min-width:680px) { .filter-grid { grid-template-columns:1fr 1fr } }
    .filter-field__label { display:block;margin:0 0 5px 2px;color:var(--muted);font-size:10px;font-weight:750;letter-spacing:.055em;text-transform:uppercase }
    .filter-field__select { min-height:42px;font-size:13px;font-weight:650 }
    .filter-summary { flex:1 0 100%;display:flex;align-items:center;justify-content:space-between;color:var(--muted);font-size:12px }
    .filter-summary strong { color:var(--ink) }
    .search-control--bar { flex:1 1 200px;min-width:0 }
    .filter-reset {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      gap: 6px;
      min-height: 36px;
      padding: 5px 8px 5px 10px;
      border: 1px solid var(--rose-line);
      border-radius: 999px;
      background: var(--rose-soft);
      color: var(--rose-dark);
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .filter-reset span {
      display: grid;
      min-width: 20px;
      height: 20px;
      padding: 0 5px;
      place-items: center;
      border-radius: 999px;
      background: var(--rose);
      color: white;
      font-size: 10px;
      font-variant-numeric: tabular-nums;
    }
    .filter-field { display: flex; min-width: 0; flex-direction: column; gap: 5px; }
    .search-control { position: relative; min-width: 0; }
    .search-control > svg {
      position: absolute;
      top: 50%;
      left: 14px;
      width: 18px;
      height: 18px;
      transform: translateY(-50%);
      fill: none;
      stroke: var(--muted);
      stroke-linecap: round;
      stroke-width: 1.8;
      pointer-events: none;
    }
    .search-control .input { padding-right: 46px; padding-left: 42px; }
    .search-control .input::-webkit-search-cancel-button { appearance: none; }
    .search-clear {
      position: absolute;
      top: 50%;
      right: 5px;
      display: grid;
      width: 36px;
      height: 36px;
      padding: 0;
      transform: translateY(-50%);
      place-items: center;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--muted);
      font-size: 22px;
      cursor: pointer;
    }
    .search-clear:hover { background: var(--surface-2); color: var(--ink); }
    .empty p { margin: 5px 0 13px; font-size: 13px; }

    @media (max-width: 560px) {
      .sales-load-error { grid-template-columns:auto minmax(0,1fr) }
      .sales-load-error .btn { grid-column:1/-1;width:100% }
    }

    .channel-tag{padding:1px 7px;border-radius:999px;background:var(--rose-soft);color:var(--rose-dark);font-size:10px;font-weight:750;letter-spacing:.03em;text-transform:uppercase;vertical-align:middle}
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
  readonly outstandingOnly = signal(false);
  /** Facturen tab: everything, invoices only, or credit notes only (query param docs). */
  readonly docsFilter = signal<SalesDocsFilter>('all');
  readonly partner = isPartnerDocument;
  readonly receivable = invoiceReceivable;
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

  /** Rows of the active tab, before search and filters. */
  private inTab(): SalesOrderView[] {
    if (this.docTab() === 'FACTUUR' && this.outstandingOnly()) {
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
      const media = matchMedia('(max-width: 1100px)');
      const follow = (): void => this.compactBar.set(media.matches);
      follow();
      media.addEventListener('change', follow);
      destroyRef.onDestroy(() => media.removeEventListener('change', follow));
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
  readonly pile = computed(() => {
    const docs = this.docTab() === 'FACTUUR' ? this.docsFilter() : 'all';
    const documents = this.inTab();
    return docs === 'all' ? documents : documents.filter((row) => isCreditNote(row.order) === (docs === 'cn'));
  });

  /** Every filter but the status chips and Actie vereist: what those chips count, so their counts follow the search. */
  readonly searched = computed(() => {
    const customer = this.customerFilter();
    const websiteOnly = this.websiteOnly();
    const toTakeOnly = this.toTakeOnly();
    const query = this.query().trim();
    const documents = this.inTab();
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
    return this.pile().filter((row) => {
      const credit = isCreditNote(row.order);
      if (this.outstandingOnly() && (['CONCEPT', 'GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN'].includes(row.order.status)
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
    });
  });

  /** The shown documents: the search and the filters, then a status chip or Actie vereist. */
  readonly rows = computed(() => {
    const status = this.filter();
    const attentionOnly = this.attentionOnly();
    return this.searched().filter((row) => (!status || row.order.status === status) && (!attentionOnly || this.needsAction(row)));
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
    this.customerById().get(this.customerFilter() as number)?.company ?? 'Alle klanten');

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

  statusCount(status: QuoteStatus | ''): number {
    return status ? this.statusCounts().get(status) ?? 0 : this.searched().length;
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

  /** What is waiting on us; the same source as the bell and the dot. */
  readonly openWork = this.work.actions;

  /** The order marker remains visible in filters and rows, independent of a
      personally dismissed bell item. What still waits for a first look:
      website requests, and website orders nobody took into processing yet. */
  readonly websiteRequests = computed(() => this.all().filter((row) =>
    !row.order.archivedAt && !row.invoicedAsId
    && (row.order.docType ?? 'OFFERTE') === 'OFFERTE' && countsAsNewWebsiteItem(row)));
  /** Website orders the customer can still change; staff take them with the button on the document. */
  readonly ordersToTake = computed(() => this.all().filter((row) =>
    !row.order.archivedAt && (row.order.docType ?? 'OFFERTE') === 'OFFERTE' && customerCanStillChange(row)));
  readonly attentionCount = computed(() => this.openWork().length);
  readonly websiteRequest = isWebsiteQuoteRequest;
  readonly webOrder = isWebOrder;

  /** Where a website order stands between the customer and us; one pill, the first that applies. */
  readonly webOrderPill = webOrderListPill;

  workIcon(kind: string): string {
    switch (kind) {
      case 'WEBSITE_AANVRAAG': return '↗';
      case 'LEVERTERMIJN': return '◷';
      case 'VRACHT': return '▤';
      case 'VOORSTEL': return '⇄';
      case 'OPNIEUW_VERSTUREN': return '↻';
      default: return '◉';
    }
  }
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

  /* ---- the desk list (Inkoop recipe, 2026-10-19): tabs, chips, customer groups, sums --------------------------- */

  /** The documents are known: before the first answer, or after a failed load, no count or sum shows (never a false '0'); a reload keeps them. */
  readonly ready = computed(() => !this.loadError() && (!this.loading() || this.all().length > 0));
  /** Actie vereist: only the documents whose amber line says something. */
  readonly attentionOnly = signal(false);
  /** Up to 1100px wide the toolbar is tight: the search gets a shorter placeholder so neither it nor the title is cut. */
  readonly compactBar = signal(false);
  readonly keepEuro = keepEuro;
  readonly salesTone = salesTone;

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
    const narrowed = this.activeFilterCount() > 0;
    const open = this.docTab() === 'OFFERTE' ? 0 : (narrowed ? this.shownMoney() : this.pileMoney()).openEur;
    return listCaption(this.docTab(), this.rows().length, this.pile().length, narrowed, open);
  });
  /** The word after 'n van m' on the phone's filter line. */
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

  /** What the shown documents still hold (the subbar's end), and the whole tab (the phone caption). */
  readonly shownMoney = computed(() => listMoney(this.rows(), invoiceReceivable, todayIso()));
  private readonly pileMoney = computed(() => listMoney(this.pile(), invoiceReceivable, todayIso()));

  /** One block per customer on the desk, on top of the container and split groups (they stay per customer inside it). */
  readonly customerSections = computed(() =>
    customerSections(this.groupedRows(), (id) => this.customerCompany(id), invoiceReceivable, todayIso()));
  private customerCompany(id: number | null): string {
    return (id === null ? undefined : this.customerById().get(id)?.company) ?? 'Geen klant';
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
  /** The amber line of a desk row: what waits on us, and the bell's website items for this document. */
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

  /* ---- the row menu: Openen, the linked documents, Order splitsen, Archiveren, Verwijderen… */
  rowMenuTitle(row: SalesOrderView): string {
    return `${this.webOrder(row) ? 'Bestelling' : this.documentLabelOf(row)} ${row.order.number}`;
  }

  rowMenuItems(row: SalesOrderView): ContextMenuItem[] {
    const order = row.order;
    const credit = isCreditNote(order);
    const total = `${credit ? '− ' : ''}${new EurPipe().transform(row.priced.totals.total, row.fulfillment || this.partner(order) ? 2 : 0)}`;
    const items: ContextMenuItem[] = [{ id: 'open', label: 'Openen', iconName: 'chevron-right',
      hint: [this.customerName(row), statusOf(row).label, total, this.inhoudText(row)].filter(Boolean).join(' · ') }];
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

  /** The Inhoud column in a few words, for the Openen hint: the phone row has no Inhoud. */
  private inhoudText(row: SalesOrderView): string {
    const num = (value: number): string => new NumPipe().transform(value);
    const totals = row.priced.totals;
    if (isCreditNote(row.order)) return row.priced.lines.length ? `${num(totals.pieces)} st` : '';
    if (this.partner(row.order)) return '';
    const pallets = totals.palletsManual || totals.palletsStrict;
    return `${num(totals.pieces)} st · ${row.order.loadMode === 'LOOSE_CARTONS'
      ? `${num(totals.cartons)} ${totals.cartons === 1 ? 'doos' : 'dozen'}` : `${pallets} ${pallets === 1 ? 'pallet' : 'pallets'}`}`;
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
