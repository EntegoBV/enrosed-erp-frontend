import { TEMPORARY_DELETION_NOTICE } from '../../shared/deleted-item-notice';
import { isAdvanceDocument, isPartnerDocument } from './sales-payment-state';
import { invoiceReceivable } from '../finance/incoming-money';
import { NgTemplateOutlet } from '@angular/common';
import { groupSalesInvoices, type SalesContainerGroup } from './sales-list-groups';
import { SalesContainerMenu } from './sales-container-menu';
import type { PartnerContainerDeletionResult } from '../../core/api/partner-container-deletion-api';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SalesApi } from '../../core/api/sales-api';
import { Country, Customer, LANGUAGES, QuoteStatus, SalesOrder, SalesOrderView } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { WorkQueue } from '../../core/api/work-queue';
import { escapeHtml, Sheet, Ui } from '../../shared/ui';
import { Skeleton } from '../../shared/skeleton';
import { CbmPipe, DateNlPipe, EurPipe, NumPipe, PctPipe } from '../../shared/pipes';
import { channelCode, channelLabel } from './sales-channels';
import {
  STATUS_LABEL, actionNeeded, isWebsiteQuoteRequest, statusClass, statusOf,
} from './quote-status';
import { messageOf } from '../../core/api/errors';
import { isSwipeDeletableSalesDocument } from './sales-list-swipe';
import { salesDocumentKind } from './partner-settlement';
import {
  ROW_LONG_PRESS_MS, ROW_LONG_PRESS_SLOP_PX, RowSwipeSide, clampRowSwipeOffset, restingRowOffset,
  rowSwipeDecision,
} from '../../shared/row-actions';

import { SalesDocumentNavigation, SalesScope, SalesTab } from './sales-document-navigation';

@Component({
  selector: 'app-sales-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, PageHeader, Sheet, Skeleton, NgTemplateOutlet,
            EurPipe, NumPipe, PctPipe, CbmPipe, DateNlPipe, SalesDocumentNavigation, SalesContainerMenu],
  template: `
    <app-page-header title="Verkoop" [subtitle]="rows().length + ' orders'">
      <button class="btn btn--primary btn--sm hide-mobile" type="button" (click)="startNew()">
        {{ businessScope() === 'PARTNER' ? 'Container kiezen' : '+ Nieuw' }}
      </button>
    </app-page-header>

    <div class="content">
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
        [counts]="documentCounts()" [loading]="loading()" [outstandingOnly]="outstandingOnly()"
        (scopeChange)="switchScope($event)" (tabChange)="switchTab($event)" (outstandingChange)="filterOutstanding($event)" />

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
            <span>Websiteaanvragen</span>
            <b>{{ websiteRequests().length }}</b>
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
            <span><strong>{{ rows().length }}</strong> van {{ docCount(docTab()) }}
              {{ docTab() === 'FACTUUR' ? 'facturen' : docTab() === 'ARCHIEF' ? 'in het archief' : 'offertes' }}</span>
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
            <button class="swipe__archive" type="button" (click)="toggleArchive(row)"
                    [disabled]="archivingOrderId() !== null || containerDeletingId() !== null"
                    [attr.aria-label]="(row.order.archivedAt ? 'Terugzetten uit archief: ' : 'Archiveren: ')
                      + documentLabel(row.order) + ' ' + row.order.number">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M3 6h18v4H3z" /><path d="M5 10v9h14v-9" /><path d="M10 14h4" />
              </svg>
              <span>{{ row.order.archivedAt ? 'Terug' : 'Archief' }}</span>
            </button>
            <a class="list-item swipe__row" [routerLink]="['/sales', row.order.id]"
               (pointerdown)="startSwipe($event, row)"
               (pointermove)="moveSwipe($event, row)"
               (pointerup)="finishSwipe($event, row)"
               (pointercancel)="cancelSwipe($event)"
               (wheel)="wheelSwipe($event, row)"
               (contextmenu)="openRowMenu($event, row)"
               (dragstart)="$event.preventDefault()"
               (click)="blockWhenSwiped($event)">
              <div class="list-item__body">
                <div class="list-item__title">{{ grouped ? row.order.number : customerName(row) }}</div>
                <!-- No country chip: it repeats what the customer name already
                     implies and pushed the date into "18/0...". -->
                <div class="list-item__meta list-item__meta--wrap">
                  {{ documentLabel(row.order) }} ·
                  @if (!grouped) { {{ row.order.number }} · }{{ row.order.orderDate | dateNl }}
                  @if (row.order.sourceQuoteId && row.sourceQuoteNumber) {
                    · uit <a class="so-link" [routerLink]="['/sales', row.order.sourceQuoteId]" (click)="$event.stopPropagation()" [attr.aria-label]="'Offerte ' + row.sourceQuoteNumber + ' openen'">{{ row.sourceQuoteNumber }}</a>
                  }
                  @if (row.invoicedAs && row.invoicedAsId) {
                    · factuur <a class="so-link" [routerLink]="['/sales', row.invoicedAsId]" (click)="$event.stopPropagation()" [attr.aria-label]="'Factuur ' + row.invoicedAs + ' openen'">{{ row.invoicedAs }}</a>
                  }
                  @if (!grouped && channelCode(row.order.salesChannel) !== 'DIRECT') { · <span class="channel-tag">{{ channelLabel(row.order.salesChannel) }}</span> }
                  @if (docTab() === 'FACTUUR' && row.order.invoiceDueDate) {
                    · vervalt {{ row.order.invoiceDueDate | dateNl }}
                  }
                </div>
                <div class="list-item__meta list-item__meta--wrap">
                  @if (partner(row.order)) {
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
                @if (websiteRequest(row.order)) {
                  <span class="so-source-mini">Websiteaanvraag</span>
                }
                <div class="strong num">{{ row.priced.totals.total | eur: (partner(row.order) ? 2 : 0) }}</div>
                @if (row.order.docType === 'FACTUUR' && row.order.status !== 'CONCEPT') {
                  <small>{{ receivable(row).receivedEur | eur }} ontvangen · {{ receivable(row).remainingEur | eur }} open</small>
                }
                <span class="so-status-mini" [class]="'so-status-mini so-status-mini--' + statusOf(row).cls">
                  <i aria-hidden="true"></i>{{ statusOf(row).label }}
                </span>
                @if (row.order.goodsShippedAt) {
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
            @if (canDelete(row.order)) {
              <button class="swipe__delete" type="button"
                      [disabled]="deletingOrderId() !== null || containerDeletingId() !== null"
                      [attr.aria-busy]="deletingOrderId() === row.order.id"
                      (click)="remove(row)"
                      [attr.aria-label]="documentLabel(row.order) + ' ' + row.order.number + ' verwijderen'"
                      [title]="documentLabel(row.order) + ' verwijderen'">
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
                <div class="sales-container__header" (contextmenu)="openContainerMenu($event, entry)">
                <button class="sales-container__toggle" type="button"
                        [id]="entry.key + '-toggle'" [attr.aria-expanded]="groupOpen(entry.key)"
                        [attr.aria-controls]="entry.key + '-invoices'" (click)="toggleGroup(entry.key)">
                  <span class="sales-container__identity">
                    <span class="sales-container__eyebrow">Partnercontainer</span>
                    <strong>{{ customerName(entry.rows[0]) }}</strong>
                    <span class="sales-container__meta">{{ entry.purchaseOrderNumber || 'Inkoop #' + entry.purchaseOrderId }} · {{ entry.summary.count }} {{ entry.summary.count === 1 ? 'factuur' : 'facturen' }}@if (entry.summary.containerPieces !== null) { · {{ entry.summary.containerPieces | num }} stuks in container }</span>
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
                <button class="sales-container__menu" type="button" aria-haspopup="dialog"
                        [attr.aria-label]="'Acties voor partnercontainer ' + (entry.purchaseOrderNumber || 'Inkoop #' + entry.purchaseOrderId)"
                        [disabled]="containerDeletingId() !== null || deletingOrderId() !== null || archivingOrderId() !== null"
                        (click)="openContainerMenu($event, entry)"><span aria-hidden="true">⋯</span></button>
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

    <button class="fab" type="button" (click)="startNew()">{{ businessScope() === 'PARTNER' ? 'Container kiezen' : '+ Order' }}</button>

    @if (containerMenu(); as menuContainer) {
      <app-sales-container-menu [container]="menuContainer" [customerName]="customerName(menuContainer.rows[0])"
        [externalBusy]="deletingOrderId() !== null || archivingOrderId() !== null"
        (closed)="containerMenu.set(null)" (busyChange)="containerDeletingId.set($event ? menuContainer.purchaseOrderId : null)"
        (deleted)="containerDeleted($event)" />
    }
    @if (rowMenu(); as menuRow) {
      <app-sheet [title]="documentLabel(menuRow.order) + ' ' + menuRow.order.number" (closed)="rowMenu.set(null)">
        <div body>
          <p class="row-menu__who">{{ customerName(menuRow) }} · {{ label(menuRow.order.status) }}
            · {{ menuRow.priced.totals.total | eur: (partner(menuRow.order) ? 2 : 0) }}</p>
          <div class="desk-actions">
            <a class="desk-action" [routerLink]="['/sales', menuRow.order.id]" (click)="rowMenu.set(null)">
              <i aria-hidden="true">›</i>
              <span><b>Openen</b><small>Bekijken of bewerken</small></span>
            </a>
            <button class="desk-action" type="button" [disabled]="archivingOrderId() !== null || containerDeletingId() !== null"
                    (click)="toggleArchive(menuRow)">
              <i aria-hidden="true">▤</i>
              <span>
                <b>{{ menuRow.order.archivedAt ? 'Terugzetten uit archief' : 'Archiveren' }}</b>
                <small>{{ menuRow.order.archivedAt ? 'Terug naar de werklijst' : 'Uit de werklijst, naar het tabblad Archief' }}</small>
              </span>
            </button>
            @if (canDelete(menuRow.order)) {
              <button class="desk-action desk-action--danger" type="button"
                      [disabled]="deletingOrderId() !== null || containerDeletingId() !== null" (click)="rowMenu.set(null); remove(menuRow)">
                <i aria-hidden="true">×</i>
                <span><b>Verwijderen</b><small>Tijdelijk, na bevestiging</small></span>
              </button>
            }
          </div>
        </div>
      </app-sheet>
    }

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
    .sales-container__menu{align-self:center;flex:0 0 44px;width:44px;height:44px;margin-right:10px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--ink-2);font-family:inherit;font-size:23px;font-weight:700;line-height:1;cursor:pointer}.sales-container__menu:hover{background:var(--rose-soft);color:var(--rose-dark)}.sales-container__menu:focus-visible{outline:3px solid var(--rose);outline-offset:2px}.sales-container__menu:disabled{opacity:.45;cursor:wait}
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
    .so-link { color: var(--rose-dark); font-weight: 650; text-decoration: underline; text-underline-offset: 2px; }
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
    .website-request-item { background:color-mix(in srgb,var(--rose-soft) 55%,var(--surface)) }
    .website-request-item__icon { border:1px solid var(--rose-line);background:#fff!important;
      color:var(--rose-dark);font-weight:850 }

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
    .filter-reset { border:0;background:transparent;color:var(--rose-dark);font-size:12px;font-weight:700;cursor:pointer }
    .search-control--bar { flex:1 1 200px;min-width:0 }
    .sales-filterbar__count { margin-left:auto;white-space:nowrap }
    .po-filter { position:relative;display:inline-flex;align-items:center;gap:7px;min-height:36px;max-width:46vw;
      padding:0 12px;border:1px solid var(--line);border-radius:999px;background:var(--surface);
      color:var(--ink-2);font-size:12.5px;font-weight:650 }
    .po-filter span { overflow:hidden;text-overflow:ellipsis;white-space:nowrap }
    .po-filter--on { border-color:var(--rose-line);background:var(--rose-soft);color:var(--rose-dark) }
    .po-filter svg { width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round }
    .po-filter__native { position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer;font-size:16px }
    .order-finder {
      min-width: 0;
      margin-bottom: 14px;
      padding: 16px;
      border: 1px solid var(--line);
      border-radius: var(--r);
      background: var(--surface);
      box-shadow: var(--shadow-sm);
    }
    .order-finder__head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 15px;
    }
    .order-finder__head h2 { margin: 0; font-size: 16px; letter-spacing: -.01em; }
    .order-finder__head p {
      margin: 3px 0 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.4;
    }
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
    .filter-controls { display: grid; gap: 12px; min-width: 0; }
    .filter-field { display: flex; min-width: 0; flex-direction: column; gap: 5px; }
    .filter-field > label,
    .desktop-status__label {
      color: var(--ink-2);
      font-size: 12px;
      font-weight: 700;
    }
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
    .desktop-status { display: none; }
    .filter-result {
      display: flex;
      min-width: 0;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 7px 12px;
      margin-top: 14px;
      padding-top: 12px;
      border-top: 1px solid var(--line);
      color: var(--ink-2);
      font-size: 12px;
    }
    .filter-result__copy strong { color: var(--ink); font-size: 14px; }
    .filter-result__copy span { color: var(--muted); }
    .active-filters { display: flex; min-width: 0; flex-wrap: wrap; gap: 5px; }
    .active-filters > span {
      display: block;
      max-width: 100%;
      padding: 3px 8px;
      overflow: hidden;
      border-radius: 999px;
      background: var(--rose-soft);
      color: var(--rose-dark);
      font-size: 11px;
      font-weight: 650;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .empty p { margin: 5px 0 13px; font-size: 13px; }

    @media (max-width: 560px) {
      .sales-load-error { grid-template-columns:auto minmax(0,1fr) }
      .sales-load-error .btn { grid-column:1/-1;width:100% }
    }

    @media (min-width: 620px) {
      .filter-controls { grid-template-columns: minmax(0, 1.5fr) minmax(190px, .75fr); }
    }

    @media (min-width: 680px) {
      .order-finder { padding: 18px; }
      .filter-controls { grid-template-columns: minmax(320px, 560px); }
      .mobile-status { display: none; }
      .desktop-status { display: block; margin-top: 14px; }
      .desktop-status__label { margin-bottom: 6px; }
      .status-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 7px;
      }
      .status-option {
        display: flex;
        min-width: 0;
        min-height: 40px;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 10px;
        border: 1px solid var(--line);
        border-radius: 10px;
        background: var(--surface-2);
        color: var(--ink-2);
        font-size: 12px;
        font-weight: 650;
        text-align: left;
        cursor: pointer;
      }
      .status-option:hover { border-color: var(--rose-line); background: var(--rose-soft); }
      .status-option--active {
        border-color: var(--rose);
        background: var(--rose);
        color: white;
      }
      .status-option--active:hover { border-color: var(--rose-dark); background: var(--rose-dark); }
      .status-option > span:first-child {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .status-option__count {
        display: grid;
        flex: 0 0 auto;
        min-width: 22px;
        height: 22px;
        padding: 0 5px;
        place-items: center;
        border-radius: 999px;
        background: rgb(0 0 0 / 6%);
        font-size: 10px;
        font-variant-numeric: tabular-nums;
      }
      .status-option--active .status-option__count { background: rgb(255 255 255 / 22%); }
    }
    .channel-tag{padding:1px 7px;border-radius:999px;background:var(--rose-soft);color:var(--rose-dark);font-size:10px;font-weight:750;letter-spacing:.03em;text-transform:uppercase;vertical-align:middle}
  `,
})
export class SalesList {
  private readonly sales = inject(SalesApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly ui = inject(Ui);
  private readonly work = inject(WorkQueue);

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
  readonly partner = isPartnerDocument;
  readonly receivable = invoiceReceivable;
  readonly newDocType = signal<'OFFERTE' | 'FACTUUR'>('OFFERTE');
  readonly websiteOnly = signal(false);

  /** One row shows an action at a time; a committed delete still asks for confirmation. */
  readonly openRow = signal<{ id: number; side: RowSwipeSide } | null>(null);
  readonly draggingOrderId = signal<number | null>(null);
  readonly swipeOffset = signal(0);
  readonly deletingOrderId = signal<number | null>(null);
  readonly archivingOrderId = signal<number | null>(null);
  readonly containerMenu = signal<SalesContainerGroup | null>(null);
  readonly containerDeletingId = signal<number | null>(null);
  private loadVersion = 0;
  /** The row whose menu is open, from a long press or a right-click. */
  readonly rowMenu = signal<SalesOrderView | null>(null);
  private swipeHandled = false;
  private pointerSwipe: { pointerId: number; orderId: number; startX: number; startY: number;
    startOffset: number; horizontal: boolean; row: HTMLElement;
    hold: ReturnType<typeof setTimeout> | null } | null = null;
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
    this.websiteOnly.set(false);
    this.outstandingOnly.set(false);
    this.openRow.set(null);
    this.expandedGroups.set(new Set());
    this.rememberNavigation();
  }

  switchScope(scope: SalesScope): void {
    this.businessScope.set(scope);
    this.websiteOnly.set(false);
    this.openRow.set(null);
    this.expandedGroups.set(new Set());
    this.rememberNavigation();
  }

  filterOutstanding(value: boolean): void {
    this.outstandingOnly.set(value);
    this.rememberNavigation();
  }

  private rememberNavigation(): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { scope: this.businessScope(), tab: this.docTab(), payment: this.outstandingOnly() ? 'open' : null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  readonly documentCounts = computed(() => ({ OFFERTE: this.docCount('OFFERTE'), FACTUUR: this.docCount('FACTUUR'), ARCHIEF: this.docCount('ARCHIEF') }));

  docCount(tab: SalesTab): number {
    return this.rowsByDocument()[tab].length;
  }

  /** Rows of the active tab, before search and filters. */
  private inTab(): SalesOrderView[] {
    if (this.docTab() === 'FACTUUR' && this.outstandingOnly()) {
      const grouped = this.rowsByDocument();
      return [...grouped.FACTUUR, ...grouped.ARCHIEF.filter((row) => row.order.docType === 'FACTUUR')];
    }
    return this.rowsByDocument()[this.docTab()];
  }

  readonly visibleFilters = computed(() => this.docTab() === 'FACTUUR'
    ? this.filters.filter((option) => ['', 'CONCEPT', 'UITGEREIKT', 'VERZONDEN', 'BETAALD'].includes(option.value))
    : this.docTab() === 'ARCHIEF' ? this.filters
    : this.filters.filter((option) => !['BETAALD', 'UITGEREIKT'].includes(option.value)));

  /** The amber under-row line, inkoop-style: everything still waiting on us. */
  attention = (row: SalesOrderView): string[] | null => {
    const items: string[] = [];
    const task = this.todo(row.order, row.awaitingResend);
    if (task) items.push(task);
    /* An overdue invoice already reads "Betaling opvolgen"; no second label. */
    if (this.overdue(row.order) && !items.includes('Betaling opvolgen')) items.push('Vervallen');
    return items.length ? items : null;
  };

  overdue(order: SalesOrder): boolean {
    return (order.docType ?? 'OFFERTE') === 'FACTUUR'
      && (order.status === 'VERZONDEN' || order.status === 'UITGEREIKT')
      && !!order.invoiceDueDate
      && order.invoiceDueDate < new Date().toISOString().slice(0, 10);
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
      else ((row.order.docType ?? 'OFFERTE') === 'FACTUUR' ? invoices : quotes).push(row);
    }
    return { OFFERTE: quotes, FACTUUR: invoices, ARCHIEF: archived };
  });
  private readonly statusCounts = computed(() => {
    const counts = new Map<string, number>();
    for (const row of this.inTab()) {
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
    void this.work.refresh();
    void this.load();
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
    this.newCustomer.set(blankCustomer(this.countries()[0]?.code ?? 'BE'));
    this.addingCustomer.set(true);
  }

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

  readonly rows = computed(() => {
    const status = this.filter();
    const customer = this.customerFilter();
    const websiteOnly = this.websiteOnly();
    const needle = this.query().toLowerCase().trim();
    const documents = this.inTab();
    const purchaseNames = new Map<number, string>();
    for (const row of documents) {
      const purchaseId = isPartnerDocument(row.order) ? row.order.partnerPurchaseOrderId : null;
      const contents = row.advanceContents;
      if (purchaseId != null && contents?.purchaseOrderId === purchaseId && contents.purchaseOrderNumber?.trim()
          && !purchaseNames.has(purchaseId)) purchaseNames.set(purchaseId, contents.purchaseOrderNumber);
    }
    return documents.filter((row) => {
      if (this.outstandingOnly() && (['CONCEPT', 'GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN'].includes(row.order.status) || invoiceReceivable(row).remainingEur <= 0)) return false;
      if (status && row.order.status !== status) return false;
      if (customer !== '' && row.order.customerId !== customer) return false;
      if (websiteOnly && !isWebsiteQuoteRequest(row.order)) return false;
      if (!needle) return true;
      const purchaseId = isPartnerDocument(row.order) ? row.order.partnerPurchaseOrderId : null;
      const container = purchaseId != null
        ? purchaseNames.get(purchaseId) ?? `Inkoop #${purchaseId}`
        : '';
      return (this.customerName(row) + ' ' + row.order.number + ' ' + container)
        .toLowerCase()
        .includes(needle);
    });
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
    (this.filter() ? 1 : 0) + (this.customerFilter() !== '' ? 1 : 0)
      + (this.query().trim() ? 1 : 0) + (this.websiteOnly() ? 1 : 0) + (this.outstandingOnly() ? 1 : 0));

  readonly activeStatusLabel = computed(() =>
    this.filters.find((option) => option.value === this.filter())?.label ?? 'Alle orders');

  selectStatus(status: QuoteStatus | ''): void {
    this.filter.set(status);
  }

  clearFilters(): void {
    this.query.set('');
    this.filter.set('');
    this.customerFilter.set('');
    this.websiteOnly.set(false);
    this.outstandingOnly.set(false);
    this.rememberNavigation();
  }

  statusCount(status: QuoteStatus | ''): number {
    return status ? this.statusCounts().get(status) ?? 0 : this.inTab().length;
  }

  customerName(row: SalesOrderView): string {
    return this.customerById().get(row.order.customerId)?.company ?? 'Geen klant';
  }

  canDelete(order: SalesOrder): boolean {
    return isSwipeDeletableSalesDocument(order);
  }

  documentLabel(order: SalesOrder): string {
    return salesDocumentKind(order, this.all().find((row) => row.order.id === order.id)?.settlement?.finalSettlement);
  }

  startSwipe(event: PointerEvent, row: SalesOrderView): void {
    if (!event.isPrimary || event.button !== 0 || this.deletingOrderId() !== null
        || this.archivingOrderId() !== null || this.containerDeletingId() !== null) return;
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
      hold: null as ReturnType<typeof setTimeout> | null,
    };
    /* A press that stays put opens the row menu: the long press of a phone,
       and just as well a mouse button held down. */
    active.hold = setTimeout(() => {
      if (this.pointerSwipe !== active || active.horizontal) return;
      this.swipeHandled = true;
      this.releaseSwipePointer(active);
      this.resetPointerSwipe();
      this.deferSwipeClickRelease();
      this.openRowMenu(null, row);
    }, ROW_LONG_PRESS_MS);
    this.pointerSwipe = active;
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      this.clearHold(active);
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
      this.clearHold(active);
      if (Math.abs(dx) <= Math.abs(dy) * 1.2) return;
      active.horizontal = true;
      this.swipeHandled = true;
      this.draggingOrderId.set(active.orderId);
    }
    event.preventDefault();
    event.stopPropagation();
    this.swipeOffset.set(clampRowSwipeOffset(active.startOffset + dx, true, this.canDelete(row.order)));
  }

  finishSwipe(event: PointerEvent, row: SalesOrderView): void {
    const active = this.pointerSwipe;
    if (!active || active.pointerId !== event.pointerId) return;
    this.clearHold(active);
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
    this.clearHold(active);
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
    const offset = clampRowSwipeOffset(-this.wheelTotal, true, this.canDelete(row.order));
    if (rowSwipeDecision(offset).action === 'commit') {
      this.wheelOrderId = null;
      this.wheelTotal = 0;
    }
    this.settleSwipe(row, offset);
  }

  /** The row's choices as a menu: a long press on a phone, a right-click on a desk. */
  openRowMenu(event: Event | null, row: SalesOrderView): void {
    event?.preventDefault();
    if (this.containerDeletingId() !== null) return;
    this.containerMenu.set(null);
    this.openRow.set(null);
    this.rowMenu.set(row);
  }

  openContainerMenu(event: Event, container: SalesContainerGroup): void {
    event.preventDefault(); event.stopPropagation();
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
    if (this.archivingOrderId() !== null || this.containerDeletingId() !== null) return;
    const id = row.order.id;
    const toArchive = !row.order.archivedAt;
    const label = this.documentLabel(row.order);
    this.rowMenu.set(null);
    this.openRow.set(null);
    this.archivingOrderId.set(id);
    try {
      const updated = toArchive
        ? await this.sales.archiveOrder(id) : await this.sales.unarchiveOrder(id);
      this.all.update((rows) => rows.map((candidate) => candidate.order.id === id ? updated : candidate));
      this.ui.toast(toArchive ? `${label} ${row.order.number} gearchiveerd` : `${label} ${row.order.number} terug op de lijst`);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, toArchive ? 'Archiveren mislukt' : 'Terugzetten mislukt'), 'err');
    } finally {
      this.archivingOrderId.set(null);
    }
  }

  private clearHold(active: { hold: ReturnType<typeof setTimeout> | null }): void {
    if (active.hold !== null) {
      clearTimeout(active.hold);
      active.hold = null;
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
    if (!this.canDelete(order) || this.deletingOrderId() !== null || this.containerDeletingId() !== null
        || this.ui.confirmRequest() !== null) return;
    const label = this.documentLabel(order);
    const customer = this.customerName(row);
    this.openRow.set(null);
    this.ui.confirm(
      {
        title: `${label} verwijderen`,
        message: `Weet je zeker dat je ${label.toLowerCase()} <b>${escapeHtml(order.number)}</b> `
          + `van <b>${escapeHtml(customer)}</b> wilt verwijderen?<br><br>`
          + ((order.docType ?? 'OFFERTE') !== 'FACTUUR'
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
          await this.sales.deleteOrder(order.id);
          this.all.update((orders) =>
            orders.filter((candidate) => candidate.order.id !== order.id));
          this.openRow.set(null);
          await this.work.refresh(true);
          this.ui.toast(`${label} verwijderd`);
        } catch (failure: unknown) {
          this.ui.toast(messageOf(failure, `${label} verwijderen mislukt`), 'err');
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

  label = (status: QuoteStatus) => STATUS_LABEL[status];
  statusOf = statusOf;
  readonly channelCode = channelCode;
  readonly channelLabel = channelLabel;
  cls = statusClass;

  /** What is waiting on us; the same source as the bell and the dot. */
  readonly openWork = this.work.actions;

  /** The order marker remains visible in filters and rows, independent of a
      personally dismissed bell item. */
  readonly websiteRequests = computed(() => this.all().filter((row) =>
    !row.order.archivedAt && !row.invoicedAsId
    && (row.order.docType ?? 'OFFERTE') === 'OFFERTE' && isWebsiteQuoteRequest(row.order)));
  readonly attentionCount = computed(() => this.openWork().length);
  readonly websiteRequest = isWebsiteQuoteRequest;

  workIcon(kind: string): string {
    switch (kind) {
      case 'WEBSITE_AANVRAAG': return '↗';
      case 'LEVERTERMIJN': return '◷';
      case 'VRACHT': return '▤';
      case 'VOORSTEL': return '⇄';
      default: return '◉';
    }
  }
  /** What we still must do with this document, or nothing. */
  todo = (order: SalesOrder, awaitingResend = false): string | null => {
    if ((order.docType ?? 'OFFERTE') === 'FACTUUR') {
      if (order.status === 'CONCEPT') return null;
      if (this.overdue(order)) return 'Betaling opvolgen';
      if (!isAdvanceDocument(order) && !order.goodsShippedAt) return 'Bestelling nog te verzenden';
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
}

function blankCustomer(countryCode: string): Customer {
  return {
    id: null, company: '', contact: '', email: '', phone: '', vatNumber: '',
    countryCode, language: 'NL', address: '', postalCode: '', city: '',
    incoterm: 'DAP', paymentTerms: '30 dagen', notes: '',
  };
}
