import { ActivatedRoute } from '@angular/router';
import { TEMPORARY_DELETION_NOTICE } from '../../shared/deleted-item-notice';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, ViewEncapsulation, computed, effect, inject, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SourcingApi } from '../../core/api/sourcing-api';
import { PurchaseOrderView, Supplier } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import {
  CONTAINER_TYPES, DEFAULT_PURCHASE_CONTAINER_TYPE, PURCHASE_CONTAINER_TYPES, PurchaseContainerType, containerLabel,
} from '../../core/api/geo';
import { escapeHtml, Sheet, Ui } from '../../shared/ui';
import { Skeleton } from '../../shared/skeleton';
import { Icon } from '../../shared/icon';
import { Segmented, type SegmentOption } from '../../shared/segmented';
import { ContextMenu, type ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { LOAD_ERROR_FALLBACK, LoadError } from '../../shared/load-error';
import { keyContext } from '../../shared/key-context';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { containerPayables } from '../finance/payables';
import { containerName, containerNumberHint } from './container-name';
import { statusTone } from './purchase-phone-model';
import { fillTone, groupSums, keepEuro, listPayments, matchesQuery, phoneTrail, statusLine, type ListPayment } from './purchase-list-model';
import { CbmPipe, DateNlPipe, EurPipe, NumPipe } from '../../shared/pipes';
import { messageOf } from '../../core/api/errors';
import { SupplierAddress } from '../../shared/supplier-address';
import { Auth } from '../../core/api/auth';
import { Fx } from '../../core/api/fx';
import { purchaseFxDefaults, purchaseFxReference } from './purchase-price-context';
import {
  ROW_LONG_PRESS_MS, ROW_LONG_PRESS_SLOP_PX, RowSwipeSide, clampRowSwipeOffset, restingRowOffset,
  rowSwipeDecision,
} from '../../shared/row-actions';

/**
 * The list's area stylesheet (Inkoop redesign, 2026-10-17): styles/purchase-list.scss
 * stays global CSS with every rule under app-purchase-list, loaded with this
 * screen's lazy chunk instead of styles.scss (the initial bundle's 1 MB error
 * budget). Encapsulation None keeps the selectors as written; renders nothing.
 */
@Component({
  selector: 'app-purchase-list-styles',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { hidden: '' },
  template: '',
  styleUrl: '../../../styles/purchase-list.scss',
})
export class PurchaseListStyles {}

const PURCHASE_STATUS_LABEL: Record<string, string> = {
  CONCEPT: 'Concept', BESTELD: 'Besteld', ONDERWEG: 'Vertrokken', ONTVANGEN: 'Ontvangen',
};

@Component({
  selector: 'app-purchase-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, NgTemplateOutlet, PageHeader, Sheet, Skeleton, SupplierAddress, Icon, Segmented, ContextMenu, LoadError, PurchaseListStyles,
            EurPipe, NumPipe, CbmPipe, DateNlPipe],
  template: `
    <app-purchase-list-styles />
    <app-page-header title="Inkoop" [subtitle]="desktop.active() ? activeOrders().length + ' containercalculaties' : phoneCaption()">
      @if (desktop.active()) {
        <app-segmented class="pl-tabs" label="Werklijst of archief" semantics="tabs" [options]="tabOptions()"
                       [value]="archiveTab() ? 'archive' : 'active'" (changed)="showArchive($event === 'archive')" />
        <div class="wk-search pl-search">
          <app-icon name="search" [size]="16" />
          <input #searchField type="search" data-page-search [placeholder]="compactBar() ? 'Zoek container of PO' : 'Zoek container, PO of leverancier'" aria-label="Inkooporders zoeken"
                 autocomplete="off" [value]="query()" (input)="query.set($any($event.target).value)" (keydown.escape)="escapeSearch($event)" />
          <kbd class="wk-kbd" aria-hidden="true">/</kbd>
          <button class="wk-search__clear" type="button" aria-label="Zoekopdracht wissen" (click)="query.set('')"><app-icon name="close" [size]="14" /></button>
        </div>
        <button class="btn btn--primary btn--sm" type="button" (click)="startNew()"><app-icon name="plus" [size]="16" />Nieuw</button>
      }
    </app-page-header>

    @if (desktop.active()) {
      <div class="content pl">
        <!-- Status chips with their counts (they follow the search), and what the shown containers still ask. -->
        <div class="wk-subbar pl-subbar">
          <div class="wk-chips" role="group" aria-label="Filter op status">
            @for (chip of chips(); track chip.key) {
              <button class="wk-chip" type="button" [class.tone-warn]="chip.key === 'ATTENTION' && chip.count > 0"
                      [attr.aria-pressed]="statusFilter() === chip.key" [disabled]="chip.key !== 'ALL' && !chip.count && statusFilter() !== chip.key"
                      (click)="statusFilter.set(chip.key)">{{ chip.label }} <span class="wk-seg__count">{{ chip.count }}</span></button>
            }
          </div>
          <span class="wk-subbar__end pl-subbar__end">{{ filtered().length }} van {{ pile().length }} · Nu te betalen <b class="pl-warn pl-nw">{{ shownSums().nowEur | eur: 0 }}</b> · Later <span class="pl-nw">{{ shownSums().laterEur | eur: 0 }}</span></span>
        </div>

        @if (loadError(); as error) {
          <div class="wk-card"><app-load-error [message]="error" [busy]="loading()" (retry)="reload()" /></div>
        } @else if (loading()) {
          <div class="wk-card pl-card" role="status" aria-label="Inkooporders laden"><app-skeleton kind="table" [rows]="8" /></div>
        } @else if (!supplierSections().length) {
          <div class="wk-card">
            <ng-container *ngTemplateOutlet="emptyState" />
          </div>
        } @else {
          <div class="wk-card pl-card">
            <div class="wk-table pl-table" role="table" [attr.aria-label]="archiveTab() ? 'Archief' : 'Inkooporders'">
              <div class="wk-thead" role="row">
                <span class="wk-th" role="columnheader">Container</span>
                <span class="wk-th" role="columnheader" data-hide="sm">Lading</span>
                <span class="wk-th" role="columnheader">Status</span>
                <span class="wk-th" role="columnheader">Betaling</span>
                <span class="wk-th wk-th--num" role="columnheader">Totaal geland</span>
                <span class="wk-th" role="columnheader"><span class="sr-only">Acties</span></span>
              </div>
              @for (group of supplierSections(); track group.supplierId) {
                <div class="wk-group pl-group" role="row">
                  <span class="wk-group__label" role="rowheader">
                    <button class="wk-group__toggle" type="button" [attr.aria-expanded]="!folded(group.supplierId)"
                            [attr.aria-label]="(folded(group.supplierId) ? 'Toon de orders van ' : 'Verberg de orders van ') + group.name"
                            (click)="toggleFold(group.supplierId)"><app-icon name="chevron-down" [size]="14" /></button>
                    <span class="pl-group__name">{{ group.name }}</span>
                    <span class="wk-group__count">· {{ group.rows.length }} order{{ group.rows.length === 1 ? '' : 's' }}@if (group.sums.nowEur > 0) { · <span class="pl-warn pl-nw">{{ group.sums.nowEur | eur: 0 }} nu te betalen</span> }</span>
                  </span>
                </div>
                @if (!folded(group.supplierId)) {
                  @for (row of group.rows; track row.order.id) {
                    @let pay = paymentOf(row);
                    <div class="swipe pl-swipe" role="none"
                         [animate.leave]="leavingId() === row.order.id ? 'mo-leave' : ''"
                         [class.swipe--open]="rowOpenSide(row.order.id) === 'end'"
                         [class.swipe--open-start]="rowOpenSide(row.order.id) === 'start'"
                         [class.swipe--dragging]="draggingOrderId() === row.order.id"
                         [style.--swipe-offset]="draggingOrderId() === row.order.id ? swipeOffset() + 'px' : null"
                         (pointerdown)="notePointer($event)">
                      <button class="swipe__archive" type="button" (click)="toggleArchive(row)"
                              [disabled]="archivingOrderId() !== null"
                              [attr.aria-label]="(row.order.archivedAt ? 'Terugzetten uit archief: ' : 'Archiveren: ') + containerName(row.order)">
                        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          <path d="M3 6h18v4H3z" /><path d="M5 10v9h14v-9" /><path d="M10 14h4" />
                        </svg>
                        <span>{{ row.order.archivedAt ? 'Terug' : 'Archief' }}</span>
                      </button>
                      <a class="wk-tr wk-tr--link swipe__row pl-row" role="row" [routerLink]="['/purchasing', row.order.id]"
                         (pointerdown)="startSwipe($event, row)"
                         (pointermove)="moveSwipe($event, row)"
                         (pointerup)="finishSwipe($event, row)"
                         (pointercancel)="cancelSwipe($event)"
                         (wheel)="wheelSwipe($event, row)"
                         (contextmenu)="openRowMenu($event, row)"
                         (dragstart)="$event.preventDefault()"
                         (click)="blockWhenSwiped($event)"
                         (keydown)="rowKey($event, row)">
                        <span class="wk-td wk-td--wrap pl-cell" role="cell">
                          <b class="pl-name">{{ containerName(row.order) }}</b>
                          <span class="pl-sub">{{ subLine(row) }}@if (row.order.partnerCustomerId != null) { <span class="pl-tag">Partner</span> }<span class="pl-lading-inline"> · {{ row.costing.totals.cartons | num }} dozen@if (fillOf(row); as fill) { · <span [class]="'pl-fill pl-fill--' + fill.tone">{{ fill.pct | num: 0 }} %</span> }</span></span>
                        </span>
                        <span class="wk-td wk-td--wrap pl-cell" role="cell" data-hide="sm">
                          <span class="pl-main">{{ shortContainer(row.order.containerType) }} · <span class="pl-nw">{{ row.costing.totals.cartons | num }} dozen</span></span>
                          <span class="pl-sub"><span class="pl-nw">{{ row.costing.totals.cbm | cbm }}</span>@if (fillOf(row); as fill) { · <span [class]="'pl-fill pl-fill--' + fill.tone">{{ fill.pct | num: 0 }} %</span> }</span>
                        </span>
                        <span class="wk-td wk-td--wrap pl-cell" role="cell">
                          <span class="wk-pill" [class]="statusTone(row.order.status)"><span class="wk-pill__dot" aria-hidden="true"></span>{{ statusLabel(row.order.status) }}</span>
                          <span class="pl-sub">{{ statusLineOf(row) }}</span>
                        </span>
                        <span class="wk-td wk-td--wrap pl-cell" role="cell">
                          @switch (pay?.state) {
                            @case ('due') { <span class="pl-main pl-warn pl-nw">{{ pay!.nowEur | eur: 0 }} nu</span>@if (pay!.laterEur > 0) { <span class="pl-sub pl-nw">{{ pay!.laterEur | eur: 0 }} later</span> } }
                            @case ('later') { <span class="pl-main">Niets nu</span><span class="pl-sub pl-nw">{{ pay!.laterEur | eur: 0 }} later</span> }
                            @case ('paid') { <span class="pl-main pl-ok">Alles betaald</span> }
                            @case ('concept') { <span class="pl-main pl-muted">—</span><span class="pl-sub">nog niet besteld</span> }
                            @default { <span class="pl-main pl-muted">—</span> }
                          }
                        </span>
                        <span class="wk-td wk-td--num pl-total" role="cell">{{ row.costing.totals.totalEur | eur: 0 }}</span>
                        <span class="wk-td pl-actions-cell" role="cell"></span>
                        @if (row.attention?.length) {
                          <span class="pl-attn" [attr.title]="row.attention!.join(' · ')">
                            <b>{{ row.attention!.length }}</b>
                            <span>{{ keepEuro(row.attention![0]) }}{{ row.attention!.length > 1 ? ' · +' + (row.attention!.length - 1) : '' }}</span>
                          </span>
                        }
                      </a>
                      <button class="wk-btn wk-btn--ghost wk-btn--sm wk-btn--icon pl-more" type="button" aria-haspopup="menu"
                              [attr.aria-label]="'Acties voor ' + containerName(row.order)" (click)="openRowMenu($event, row)"><app-icon name="more" [size]="16" /></button>
                      @if (row.order.status !== 'ONTVANGEN') {
                        <button class="swipe__delete" type="button" (click)="remove(row.order.id, row.order.number)"
                                [disabled]="deletingOrderId() === row.order.id"
                                [attr.aria-busy]="deletingOrderId() === row.order.id"
                                [attr.aria-label]="'Inkooporder ' + containerName(row.order) + ' verwijderen'"
                                title="Inkooporder verwijderen">
                          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
                               stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                               aria-hidden="true" focusable="false">
                            <path d="M4 7h16" /><path d="M9 7V5h6v2" />
                            <path d="M6.5 7l1 13h9l1-13" /><path d="M10 11v6" /><path d="M14 11v6" />
                          </svg>
                        </button>
                      }
                    </div>
                  }
                }
              }
            </div>
          </div>
        }
      </div>
    } @else {
      <div class="content pl pl--phone">
        <app-segmented variant="ios" class="pl-tabs" label="Werklijst of archief" semantics="tabs" [options]="tabOptions()"
                       [value]="archiveTab() ? 'archive' : 'active'" (changed)="showArchive($event === 'archive')" />
        <!-- The search and, on its right, the status filter as a round button over the native picker (no separate filter row: five rows stay in view). -->
        <div class="ios-search pl-isearch">
          <div class="ios-search__field">
            <app-icon name="search" [size]="17" />
            <input type="search" data-page-search placeholder="Zoek container, PO of product" aria-label="Inkooporders zoeken"
                   autocomplete="off" enterkeyhint="search" [value]="query()" (input)="query.set($any($event.target).value)" />
            @if (query()) {
              <button class="ios-search__clear" type="button" aria-label="Zoekopdracht wissen" (click)="query.set('')"><app-icon name="close" [size]="16" /></button>
            }
          </div>
          <span class="pl-filter" [class.pl-filter--on]="statusFilter() !== 'ALL'">
            <app-icon name="filter" [size]="20" />
            @if (statusFilter() !== 'ALL') { <span class="pl-filter__badge" aria-hidden="true">{{ filtered().length }}</span> }
            <select class="pl-filter__native" aria-label="Filter op status" [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event)">
              @for (chip of chips(); track chip.key) {
                <option [value]="chip.key" [disabled]="chip.key !== 'ALL' && !chip.count && statusFilter() !== chip.key">{{ chip.label }}{{ chip.key !== 'ALL' && chip.count ? ' (' + chip.count + ')' : '' }}</option>
              }
            </select>
          </span>
        </div>

        @if (loadError(); as error) {
          <app-load-error [message]="error" [busy]="loading()" (retry)="reload()" />
        } @else if (loading()) {
          <div class="pl-loading" role="status" aria-label="Inkooporders laden"><app-skeleton kind="group" [rows]="5" /></div>
        } @else if (!supplierSections().length) {
          <ng-container *ngTemplateOutlet="emptyState" />
        } @else {
          @for (group of supplierSections(); track group.supplierId) {
            <section class="ios-section pl-section">
              <div class="ios-section__head"><span class="pl-supplier" role="heading" aria-level="2">{{ group.name }}</span><span class="ios-section__trail">{{ group.rows.length }}</span></div>
              <div class="ios-group">
                @for (row of group.rows; track row.order.id) {
                  @let pay = paymentOf(row);
                  @let trail = trailOf(row);
                  <div class="swipe pl-swipe" role="none"
                       [animate.leave]="leavingId() === row.order.id ? 'mo-leave' : ''"
                       [class.swipe--open]="rowOpenSide(row.order.id) === 'end'"
                       [class.swipe--open-start]="rowOpenSide(row.order.id) === 'start'"
                       [class.swipe--dragging]="draggingOrderId() === row.order.id"
                       [style.--swipe-offset]="draggingOrderId() === row.order.id ? swipeOffset() + 'px' : null">
                    <button class="swipe__archive" type="button" (click)="toggleArchive(row)"
                            [disabled]="archivingOrderId() !== null"
                            [attr.aria-label]="(row.order.archivedAt ? 'Terugzetten uit archief: ' : 'Archiveren: ') + containerName(row.order)">
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M3 6h18v4H3z" /><path d="M5 10v9h14v-9" /><path d="M10 14h4" />
                      </svg>
                      <span>{{ row.order.archivedAt ? 'Terug' : 'Archief' }}</span>
                    </button>
                    <a class="ios-cell swipe__row pl-prow" [routerLink]="['/purchasing', row.order.id]"
                       (pointerdown)="startSwipe($event, row)"
                       (pointermove)="moveSwipe($event, row)"
                       (pointerup)="finishSwipe($event, row)"
                       (pointercancel)="cancelSwipe($event)"
                       (wheel)="wheelSwipe($event, row)"
                       (contextmenu)="openRowMenu($event, row)"
                       (dragstart)="$event.preventDefault()"
                       (click)="blockWhenSwiped($event)">
                      <span class="ios-cell__body">
                        <span class="pl-ptitle">{{ containerName(row.order) }}</span>
                        <span class="pl-psub">{{ subLine(row) }}@if (row.order.partnerCustomerId != null) { <span class="pl-tag">Partner</span> }</span>
                        @if (row.attention?.length) {
                          <span class="pl-pattn"><b>{{ row.attention!.length }}</b><span>{{ keepEuro(row.attention!.join(' · ')) }}</span></span>
                        }
                      </span>
                      <span class="ios-cell__trail pl-ptrail">
                        <span class="pl-ptotal">{{ row.costing.totals.totalEur | eur: 0 }}</span>
                        <span class="wk-pill" [class]="statusTone(row.order.status)">{{ statusLabel(row.order.status) }}</span>
                        @if (trail.due) { <span class="pl-pline pl-warn">{{ pay!.nowEur | eur: 0 }} nu</span> } @else { <span class="pl-pline">{{ trail.text }}</span> }
                      </span>
                    </a>
                    @if (row.order.status !== 'ONTVANGEN') {
                      <button class="swipe__delete" type="button" (click)="remove(row.order.id, row.order.number)"
                              [disabled]="deletingOrderId() === row.order.id"
                              [attr.aria-busy]="deletingOrderId() === row.order.id"
                              [attr.aria-label]="'Inkooporder ' + containerName(row.order) + ' verwijderen'"
                              title="Inkooporder verwijderen">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
                             stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
                             aria-hidden="true" focusable="false">
                          <path d="M4 7h16" /><path d="M9 7V5h6v2" />
                          <path d="M6.5 7l1 13h9l1-13" /><path d="M10 11v6" /><path d="M14 11v6" />
                        </svg>
                      </button>
                    }
                  </div>
                }
              </div>
            </section>
          }
        }
      </div>
    }

    <ng-template #emptyState>
      @if (query().trim()) {
        <div [class]="desktop.active() ? 'wk-empty' : 'ios-empty'">
          <h2 [class]="desktop.active() ? 'wk-empty__title' : 'ios-empty__title'">Niets gevonden voor “{{ query().trim() }}”</h2>
          <p [class]="desktop.active() ? 'wk-empty__text' : 'ios-empty__text'">Zoek op herkenbare naam, PO-nummer, leverancier of product.</p>
          <button [class]="desktop.active() ? 'wk-btn' : 'ios-capsule ios-capsule--tinted'" type="button" (click)="query.set('')">Zoekopdracht wissen</button>
        </div>
      } @else if (statusFilter() !== 'ALL') {
        <div [class]="desktop.active() ? 'wk-empty' : 'ios-empty'">
          <h2 [class]="desktop.active() ? 'wk-empty__title' : 'ios-empty__title'">Niets met deze status</h2>
          <button [class]="desktop.active() ? 'wk-btn' : 'ios-capsule ios-capsule--tinted'" type="button" (click)="statusFilter.set('ALL')">Alle tonen</button>
        </div>
      } @else if (archiveTab()) {
        <div [class]="desktop.active() ? 'wk-empty' : 'ios-empty'">
          <h2 [class]="desktop.active() ? 'wk-empty__title' : 'ios-empty__title'">Niets in het archief</h2>
          <p [class]="desktop.active() ? 'wk-empty__text' : 'ios-empty__text'">Gearchiveerde containers blijven hier zoals ze waren.</p>
        </div>
      } @else {
        <div [class]="desktop.active() ? 'wk-empty' : 'ios-empty'">
          <h2 [class]="desktop.active() ? 'wk-empty__title' : 'ios-empty__title'">Nog geen inkooporders</h2>
          <p [class]="desktop.active() ? 'wk-empty__text' : 'ios-empty__text'">Maak een calculatie voor een container; bestellen doe je later.</p>
          <button [class]="desktop.active() ? 'wk-btn wk-btn--primary' : 'ios-capsule ios-capsule--tinted'" type="button" (click)="startNew()">Nieuwe calculatie</button>
        </div>
      }
    </ng-template>

    <button class="fab" type="button" (click)="startNew()">+ Calculatie</button>

    @if (rowMenu(); as menu) {
      <app-context-menu [title]="containerName(menu.row.order)" [items]="rowMenuItems(menu.row)" [anchor]="menu.anchor"
                        variant="ios" cancelLabel="Annuleren" (pick)="pickRowMenu($event, menu.row)" (closed)="rowMenu.set(null)" />
    }

    @if (picking()) {
      <app-sheet title="Nieuwe inkoopcalculatie" variant="ios" (closed)="picking.set(false)">
        <div body>
          <div class="field">
            <label for="po-supplier">Leverancier</label>
            <select class="select" id="po-supplier" [ngModel]="chosen()"
                    (ngModelChange)="chosen.set(+$event)">
              @for (supplier of suppliers(); track supplier.id) {
                <option [ngValue]="supplier.id">{{ supplier.name }} ({{ supplier.currency }})</option>
              }
            </select>
          </div>
          @if (chosenSupplier(); as supplier) {
            <div class="chosen-supplier" aria-label="Gekozen leverancier">
              <span class="chosen-supplier__mark" aria-hidden="true">
                {{ supplier.name.charAt(0) || '?' }}
              </span>
              <span class="chosen-supplier__copy">
                <strong>{{ supplier.name }}</strong>
                <app-supplier-address [supplier]="supplier" [inline]="true" />
                <small>
                  {{ supplier.incoterm || 'Geen incoterm' }}
                  @if (supplier.portOfLoading) { · {{ supplier.portOfLoading }} }
                </small>
              </span>
            </div>
          }
          <fieldset class="container-choice">
            <legend>Container</legend>
            <div class="container-choice__grid" aria-label="Containertype kiezen">
              @for (type of purchaseContainerTypes; track type.value) {
                <button class="container-choice__option" type="button"
                        [class.container-choice__option--on]="chosenContainerType() === type.value"
                        [attr.aria-pressed]="chosenContainerType() === type.value"
                        (click)="chosenContainerType.set(type.value)">
                  <span>{{ type.shortLabel }}</span>
                  <strong>{{ type.capacityCbm }} m³</strong>
                  <small>{{ type.note }}</small>
                </button>
              }
            </div>
            <p>Deze laadruimte stuurt de vulgraad, vrije ruimte en eventuele overloop.</p>
          </fieldset>
          <div class="field-row">
            <div class="field"><label for="po-cny">Koers RMB → USD</label>
              <input class="input num right" id="po-cny" type="number" step="0.0001"
                     [ngModel]="cnyToUsd()" (ngModelChange)="setCnyToUsd($event)" />
              @if (automaticRates(); as automatic) {
                <span class="hint">
                  Automatisch · ECB {{ marketReference()!.cnyToUsd | num: 4 }} +
                  {{ automatic.marginPct | num: 0 }}% marge = {{ automatic.cnyToUsd | num: 4 }} ·
                  {{ automatic.asOf | dateNl }}
                </span>
              } @else if (fx.failed()) {
                <span class="hint hint--warn">Actuele koers niet beschikbaar · vul handmatig in</span>
              } @else {
                <span class="hint">Actuele veilige inkoopkoers laden…</span>
              }
            </div>
            <div class="field"><label for="po-usd">Koers USD → EUR</label>
              <input class="input num right" id="po-usd" type="number" step="0.0001"
                     [ngModel]="usdToEur()" (ngModelChange)="setUsdToEur($event)" />
              @if (automaticRates(); as automatic) {
                <span class="hint">
                  Automatisch · ECB {{ marketReference()!.usdToEur | num: 4 }} +
                  {{ automatic.marginPct | num: 0 }}% marge = {{ automatic.usdToEur | num: 4 }} ·
                  {{ automatic.asOf | dateNl }}
                </span>
              } @else if (fx.failed()) {
                <span class="hint hint--warn">Actuele koers niet beschikbaar · vul handmatig in</span>
              } @else {
                <span class="hint">Actuele veilige inkoopkoers laden…</span>
              }
            </div>
          </div>
          <p class="small muted">
            De koersen worden op de order vastgeklikt, zodat een oude calculatie niet verandert
            als de koers beweegt.
          </p>
          <p class="po-creator-note">
            <span aria-hidden="true">●</span>
            Aangemeld als <b>{{ auth.username() || 'onbekend' }}</b> · wordt als maker opgeslagen
          </p>
        </div>
        <div foot style="display:contents">
          <button class="btn" type="button" (click)="picking.set(false)">Annuleren</button>
          <button class="btn btn--primary" type="button" [disabled]="!ratesReady() || creating()" (click)="create()">{{ creating() ? 'Bezig…' : 'Aanmaken' }}</button>
        </div>
      </app-sheet>
    }
  `,
  styles: [`
    .swipe--dragging { user-select: none; }
    .swipe--dragging .swipe__row { transform: translateX(var(--swipe-offset, 0px)); transition: none; }
    .swipe__row { touch-action: pan-y; }
    .chosen-supplier{display:grid;grid-template-columns:36px minmax(0,1fr);gap:9px;margin:0 0 14px;padding:10px;border:1px solid var(--line);border-radius:13px;background:var(--surface-2)}
    .chosen-supplier__mark{display:grid;width:36px;height:36px;place-items:center;border-radius:10px;background:var(--rose-soft);color:var(--rose-dark);font-weight:760;text-transform:uppercase}
    .chosen-supplier__copy{display:flex;min-width:0;flex-direction:column}.chosen-supplier__copy strong{overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.chosen-supplier__copy small{color:var(--muted);font-size:9.5px}
    .container-choice{min-width:0;margin:0 0 15px;padding:0;border:0}.container-choice legend{margin-bottom:7px;color:var(--ink-2);font-size:12px;font-weight:700}.container-choice__grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px}.container-choice__option{display:grid;min-width:0;gap:2px;padding:10px 8px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:var(--ink-2);font:inherit;text-align:left;cursor:pointer}.container-choice__option span{font-size:12px;font-weight:760}.container-choice__option strong{font-size:15px}.container-choice__option small{overflow:hidden;color:var(--muted);font-size:9.5px;text-overflow:ellipsis;white-space:nowrap}.container-choice__option--on{border-color:var(--rose);background:var(--rose-soft);box-shadow:0 0 0 1px color-mix(in srgb,var(--rose) 12%,transparent);color:var(--rose-dark)}.container-choice__option--on small{color:var(--rose-dark)}.container-choice>p{margin:6px 1px 0;color:var(--muted);font-size:10.5px}
    .po-creator-note{display:flex;align-items:center;gap:6px;margin-top:10px;color:var(--muted);font-size:11.5px}.po-creator-note span{color:var(--ok);font-size:7px}.po-creator-note b{color:var(--ink-2)}
  `],
})
export class PurchaseList {
  statusLabel(status: string): string {
    return PURCHASE_STATUS_LABEL[status] ?? status;
  }

  readonly containerLabel = containerLabel;
  readonly containerName = containerName;
  readonly statusTone = statusTone;
  readonly keepEuro = keepEuro;
  readonly desktop = inject(DesktopViewport);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly searchField = viewChild<ElementRef<HTMLInputElement>>('searchField');

  private readonly sourcing = inject(SourcingApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly ui = inject(Ui);
  readonly fx = inject(Fx);
  readonly auth = inject(Auth);

  readonly orders = signal<PurchaseOrderView[]>([]);
  readonly statusOptions: { key: string; label: string }[] = [
    { key: 'ALL', label: 'Alle' }, { key: 'CONCEPT', label: 'Concept' }, { key: 'BESTELD', label: 'Besteld' },
    { key: 'ONDERWEG', label: 'Vertrokken' }, { key: 'ONTVANGEN', label: 'Ontvangen' }, { key: 'ATTENTION', label: 'Actie vereist' },
  ];
  readonly statusFilter = signal('ALL');
  /** The drawer under the working list. */
  readonly archiveTab = signal(false);
  readonly activeOrders = computed(() => this.orders().filter((row) => !row.order.archivedAt));
  readonly archivedOrders = computed(() => this.orders().filter((row) => !!row.order.archivedAt));

  showArchive(on: boolean): void {
    if (this.archiveTab() === on) return;
    this.archiveTab.set(on);
    this.openRow.set(null);
  }

  /** The search over the current tab: herkenbare naam, PO number, supplier, maker and products (purchase-list-model). */
  readonly query = signal('');
  /** The current tab's containers. */
  readonly pile = computed(() => this.archiveTab() ? this.archivedOrders() : this.activeOrders());
  private readonly searched = computed(() => {
    const query = this.query();
    return this.pile().filter((row) => matchesQuery(row, this.supplierName(row.order.supplierId), query));
  });
  private readonly statusCounts = computed(() => {
    const counts = new Map<string, number>();
    let attention = 0;
    for (const row of this.searched()) {
      counts.set(row.order.status, (counts.get(row.order.status) ?? 0) + 1);
      if (row.attention?.length) attention++;
    }
    counts.set('ATTENTION', attention);
    return counts;
  });
  readonly filtered = computed(() => {
    const key = this.statusFilter();
    const pile = this.searched();
    const rows = key === 'ALL' ? pile
      : key === 'ATTENTION' ? pile.filter((row) => row.attention?.length)
      : pile.filter((row) => row.order.status === key);
    /* Newest first: the order you placed this week is the one you want. */
    return rows.slice().sort((a, b) => b.order.orderDate.localeCompare(a.order.orderDate)
      || (b.order.id ?? 0) - (a.order.id ?? 0));
  });

  /** One block per supplier, ordered by whoever has the newest order; with what the block still asks now. */
  readonly supplierSections = computed(() => {
    const groups = new Map<number, { supplierId: number; name: string; rows: PurchaseOrderView[]; sums: { nowEur: number; laterEur: number } }>();
    for (const row of this.filtered()) {
      const id = row.order.supplierId;
      let group = groups.get(id);
      if (!group) {
        group = { supplierId: id, name: this.supplierName(id), rows: [], sums: { nowEur: 0, laterEur: 0 } };
        groups.set(id, group);
      }
      group.rows.push(row);
    }
    for (const group of groups.values()) group.sums = groupSums(group.rows.map((row) => this.paymentOf(row)));
    return [...groups.values()];
  });

  /** The Betaling column: the same open container amounts as Kosten & bank's Te betalen (F10). */
  private readonly payments = computed(() => { const rows = this.orders(); return listPayments(rows, containerPayables(rows)); });
  paymentOf(row: PurchaseOrderView): ListPayment | undefined { return this.payments().get(row.order.id); }
  readonly shownSums = computed(() => groupSums(this.filtered().map((row) => this.paymentOf(row))));

  /** Status chips with their counts; they follow the search. */
  readonly chips = computed(() => this.statusOptions.map((option) => ({
    ...option, count: option.key === 'ALL' ? this.searched().length : this.statusCounts().get(option.key) ?? 0,
  })));
  readonly tabOptions = computed<SegmentOption[]>(() => [
    { id: 'active', label: 'Inkooporders', count: this.activeOrders().length },
    { id: 'archive', label: 'Archief', count: this.archivedOrders().length },
  ]);
  /** The phone's large-title caption: the count and what is due now; with a search or filter, what shows of how many. */
  readonly phoneCaption = computed(() => {
    const narrowed = this.query().trim() !== '' || this.statusFilter() !== 'ALL';
    const now = narrowed ? this.shownSums().nowEur : groupSums(this.pile().map((row) => this.paymentOf(row))).nowEur;
    const euro = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(now);
    const head = narrowed ? `${this.filtered().length} van ${this.pile().length}`
      : this.archiveTab() ? `${this.archivedOrders().length} in het archief` : `${this.activeOrders().length} containercalculaties`;
    return now > 0 ? `${head} · ${euro} ${narrowed ? 'nu' : 'nu te betalen'}` : head;
  });

  /** '{PO} · {maker} · {orderdatum}': the PO number only when the title is a name, the maker only when known (F12). */
  subLine(row: PurchaseOrderView): string {
    const parts = [containerNumberHint(containerName(row.order), row.order.number), row.createdBy?.displayName || null,
      new DateNlPipe().transform(row.order.orderDate)];
    return parts.filter(Boolean).join(' · ');
  }
  statusLineOf(row: PurchaseOrderView): string { return statusLine(row.order); }
  trailOf(row: PurchaseOrderView): { text: string; due: boolean } { return phoneTrail(row.order, this.paymentOf(row)); }
  shortContainer(type: string | null | undefined): string {
    return CONTAINER_TYPES.find((option) => option.value === type)?.shortLabel ?? containerLabel(type);
  }
  /** The fill as the desk shows it: none for a container priced delivered duty paid (no own loading). */
  fillOf(row: PurchaseOrderView): { pct: number; tone: string } | null {
    const fill = row.costing.containerFill;
    const lines = row.order.lines ?? [];
    if (!fill || !(fill.capacityCbm > 0) || (lines.length > 0 && lines.every((line) => (line.priceBasis ?? 'EXW') === 'DDP'))) return null;
    return { pct: fill.fillPercent, tone: fillTone(fill.fillPercent, fill.overflowCbm) || 'plain' };
  }
  readonly suppliers = signal<Supplier[]>([]);
  private readonly supplierById = computed(() =>
    new Map(this.suppliers().map((supplier) => [supplier.id, supplier])));
  readonly loading = signal(true);
  /** The list could not load (B2): app-load-error with 'Opnieuw proberen'. */
  readonly loadError = signal<string | null>(null);
  readonly picking = signal(false);
  /** 'Aanmaken' runs once (F3). */
  readonly creating = signal(false);
  readonly chosen = signal<number | null>(null);
  readonly purchaseContainerTypes = PURCHASE_CONTAINER_TYPES;
  readonly chosenContainerType = signal<PurchaseContainerType>(DEFAULT_PURCHASE_CONTAINER_TYPE);
  readonly cnyToUsd = signal<number | null>(null);
  readonly usdToEur = signal<number | null>(null);
  readonly marketReference = computed(() => purchaseFxReference(this.fx.series()));
  readonly automaticRates = computed(() => purchaseFxDefaults(this.marketReference()));
  readonly ratesReady = computed(() => positiveRate(this.cnyToUsd()) && positiveRate(this.usdToEur()));
  private cnyRateEdited = false;
  private usdRateEdited = false;

  /** Up to 1100px wide the toolbar is tight: the search gets a shorter placeholder so neither it nor the title is cut (N10). */
  readonly compactBar = signal(false);

  constructor() {
    if (typeof matchMedia === 'function') {
      const narrow = matchMedia('(max-width: 1100px)');
      const follow = (): void => this.compactBar.set(narrow.matches);
      follow();
      narrow.addEventListener('change', follow);
      inject(DestroyRef).onDestroy(() => narrow.removeEventListener('change', follow));
    }
    void this.load();
    /* Fill each untouched field as soon as the daily reference arrives. */
    effect(() => this.applyAutomaticRates(this.automaticRates()));
    if (!this.fx.series()) void this.fx.load();
  }

  reload(): void { void this.load(); }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    let orders: PurchaseOrderView[], suppliers: Supplier[];
    try {
      [orders, suppliers] = await Promise.all([this.sourcing.purchaseOrders(), this.sourcing.suppliers()]);
    } catch (failure: unknown) {
      this.loadError.set(messageOf(failure, LOAD_ERROR_FALLBACK));
      this.loading.set(false);
      return;
    }
    /* The partner tag comes from the order itself (F11): no sales list on this screen. */
    this.orders.set(orders);
    this.restoreFolds();
    this.suppliers.set(suppliers);
    this.chosen.set(suppliers[0]?.id ?? null);
    this.loading.set(false);
    this.openRequestedCalculation();
    if (this.picking() && !suppliers.length) {
      this.picking.set(false);
      this.ui.toast('Maak eerst een leverancier aan', 'err');
    }
  }

  /**
   * /purchasing?nieuw=1&leverancier={id} (Leveranciers' 'Nieuwe calculatie', F19): the new-calculation
   * sheet opens with that supplier chosen; the query leaves the address so Back does not open it again.
   */
  private openRequestedCalculation(): void {
    const params = this.route.snapshot.queryParamMap;
    if (params.get('nieuw') !== '1') return;
    const id = Number(params.get('leverancier'));
    void this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
    if (!this.suppliers().length) return;
    if (this.supplierById().has(id)) this.chosen.set(id);
    this.startNew();
  }

  supplierName(id: number): string {
    return this.supplierById().get(id)?.name ?? 'Onbekend';
  }


  readonly chosenSupplier = computed(() => {
    const id = this.chosen();
    return id === null ? null : this.supplierById().get(id) ?? null;
  });

  /** One row shows an action at a time, like iOS; a committed delete still asks for confirmation. */
  readonly openRow = signal<{ id: number; side: RowSwipeSide } | null>(null);
  readonly draggingOrderId = signal<number | null>(null);
  readonly swipeOffset = signal(0);
  readonly deletingOrderId = signal<number | null>(null);
  readonly archivingOrderId = signal<number | null>(null);
  /** The row whose menu is open (⋯, a long press or a right-click), and where it opens on a desk. */
  readonly rowMenu = signal<{ row: PurchaseOrderView; anchor: MenuPoint | null } | null>(null);
  /** The row that is being archived or deleted: only that one leaves with a motion. */
  readonly leavingId = signal<number | null>(null);
  private lastPointer: MenuPoint | null = null;
  private swipeHandled = false;
  private pointerSwipe: { pointerId: number; orderId: number; startX: number; startY: number;
    startOffset: number; horizontal: boolean; row: HTMLElement;
    hold: ReturnType<typeof setTimeout> | null } | null = null;
  private swipeResetTimer: ReturnType<typeof setTimeout> | null = null;
  /* Trackpads swipe with a horizontal scroll: gathered per gesture. */
  private wheelTotal = 0;
  private wheelOrderId: number | null = null;
  private wheelTimer: ReturnType<typeof setTimeout> | null = null;

  rowOpenSide(id: number): RowSwipeSide | null {
    const open = this.openRow();
    return open !== null && open.id === id ? open.side : null;
  }

  /** A received container is history: it can be archived, never deleted. */
  private canDelete(row: PurchaseOrderView): boolean {
    return row.order.status !== 'ONTVANGEN';
  }

  startSwipe(event: PointerEvent, row: PurchaseOrderView): void {
    if (row.order.id === null || !event.isPrimary || event.button !== 0
        || this.deletingOrderId() !== null || this.archivingOrderId() !== null) return;
    if (this.swipeResetTimer !== null) clearTimeout(this.swipeResetTimer);
    this.swipeHandled = false;
    const open = this.openRow();
    if (open !== null && open.id !== row.order.id) this.openRow.set(null);
    const target = event.currentTarget as HTMLElement;
    const active = {
      pointerId: event.pointerId, orderId: row.order.id,
      startX: event.clientX, startY: event.clientY,
      startOffset: restingRowOffset(this.rowOpenSide(row.order.id)),
      horizontal: false, row: target,
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

  moveSwipe(event: PointerEvent, row: PurchaseOrderView): void {
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
    this.swipeOffset.set(clampRowSwipeOffset(active.startOffset + dx, true, this.canDelete(row)));
  }

  finishSwipe(event: PointerEvent, row: PurchaseOrderView): void {
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
  private settleSwipe(row: PurchaseOrderView, offset: number): void {
    const decision = rowSwipeDecision(offset);
    if (decision.action === 'commit') {
      this.openRow.set(null);
      if (decision.side === 'end') this.remove(row.order.id, row.order.number);
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

  /** A hard two-finger swipe on a trackpad reads as the same gesture, both ways. */
  wheelSwipe(event: WheelEvent, row: PurchaseOrderView): void {
    if (row.order.id === null || this.deletingOrderId() !== null || this.archivingOrderId() !== null) return;
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
    this.wheelTimer = setTimeout(() => { this.wheelOrderId = null; this.wheelTotal = 0; }, 250);
    /* Scrolling right slides the row left onto the bin; the other way onto the archive. */
    const offset = clampRowSwipeOffset(-this.wheelTotal, true, this.canDelete(row));
    if (rowSwipeDecision(offset).action === 'commit') {
      this.wheelOrderId = null;
      this.wheelTotal = 0;
    }
    this.settleSwipe(row, offset);
  }

  /** The row's choices as a menu: ⋯, a long press on a phone, a right-click on a desk. */
  openRowMenu(event: Event | null, row: PurchaseOrderView): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.openRow.set(null);
    const mouse = event instanceof MouseEvent && (event.clientX || event.clientY) ? { x: event.clientX, y: event.clientY } : null;
    const target = event?.currentTarget instanceof Element ? event.currentTarget.getBoundingClientRect() : null;
    this.rowMenu.set({ row, anchor: mouse ?? (target ? { x: target.left, y: target.bottom } : this.lastPointer) });
  }

  /** Where the last press on a row was: a long press opens the menu there. */
  notePointer(event: PointerEvent): void { this.lastPointer = { x: event.clientX, y: event.clientY }; }

  /** Openen names the container in a line (N11); Archiveren or Terugzetten; Verwijderen… unless received. */
  rowMenuItems(row: PurchaseOrderView): ContextMenuItem[] {
    const order = row.order;
    const total = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(row.costing.totals.totalEur);
    const received = order.status === 'ONTVANGEN' && order.receivedOn ? ` · ontvangen ${new DateNlPipe().transform(order.receivedOn)}` : '';
    const items: ContextMenuItem[] = [
      { id: 'open', label: 'Openen', iconName: 'chevron-right', hint: `${this.supplierName(order.supplierId)} · ${this.statusLabel(order.status)} · ${total}${received}` },
      { id: 'archive', label: order.archivedAt ? 'Terugzetten uit archief' : 'Archiveren', iconName: order.archivedAt ? 'restore' : 'archive',
        hint: order.archivedAt ? 'Terug naar de werklijst' : 'Uit de werklijst, naar het tabblad Archief', disabled: this.archivingOrderId() !== null },
    ];
    if (order.status !== 'ONTVANGEN') {
      items.push({ id: 'delete', label: 'Verwijderen…', iconName: 'trash', hint: 'Tijdelijk, na bevestiging', danger: true, divider: true,
        disabled: this.deletingOrderId() !== null });
    }
    return items;
  }

  pickRowMenu(item: ContextMenuItem, row: PurchaseOrderView): void {
    this.rowMenu.set(null);
    if (item.id === 'open') void this.router.navigate(['/purchasing', row.order.id]);
    else if (item.id === 'archive') void this.toggleArchive(row);
    else if (item.id === 'delete') this.remove(row.order.id, row.order.number);
  }

  /** Off the working list into the archive drawer, or back; the order itself stays as it is. */
  async toggleArchive(row: PurchaseOrderView): Promise<void> {
    if (this.archivingOrderId() !== null || row.order.id === null) return;
    const id = row.order.id;
    const toArchive = !row.order.archivedAt;
    this.rowMenu.set(null);
    this.openRow.set(null);
    this.archivingOrderId.set(id);
    try {
      const updated = toArchive
        ? await this.sourcing.archivePurchaseOrder(id) : await this.sourcing.unarchivePurchaseOrder(id);
      this.leavingId.set(id);
      this.orders.update((rows) => rows.map((candidate) => candidate.order.id === id ? updated : candidate));
      this.ui.toast(toArchive ? `${row.order.number} gearchiveerd` : `${row.order.number} terug op de lijst`);
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

  private resetPointerSwipe(): void {
    this.pointerSwipe = null;
    this.draggingOrderId.set(null);
    this.swipeOffset.set(0);
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

  /** A tap on a swiped-open row folds it back instead of navigating. */
  blockWhenSwiped(event: Event): void {
    if (this.openRow() !== null || this.swipeHandled) {
      event.preventDefault();
      event.stopPropagation();
      if (!this.swipeHandled) this.openRow.set(null);
    }
  }

  remove(id: number, number: string): void {
    if (this.deletingOrderId() !== null || this.ui.confirmRequest() !== null) return;
    const row = this.orders().find((candidate) => candidate.order.id === id);
    if (row?.order.status === 'ONTVANGEN') {
      this.openRow.set(null);
      this.ui.toast('Ontvangen inkooporders kunnen niet worden verwijderd', 'err');
      return;
    }
    this.ui.confirm(
      { title: 'Inkooporder verwijderen',
        message: `Inkooporder <b>${escapeHtml(number)}</b> tijdelijk verwijderen?`
          + '<br><br>' + TEMPORARY_DELETION_NOTICE,
        confirmLabel: 'Verwijderen', danger: true },
      async () => {
        this.deletingOrderId.set(id);
        try {
          await this.sourcing.deletePurchaseOrder(id);
          this.openRow.set(null);
          this.leavingId.set(id);
          this.orders.update((orders) =>
            orders.filter((candidate) => candidate.order.id !== id));
          this.ui.toast('Inkooporder verwijderd');
        } catch (failure: unknown) {
          this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
        } finally {
          this.deletingOrderId.set(null);
        }
      });
  }

  startNew(): void {
    /* Only judge the supplier list once it is actually loaded - an
       in-flight empty list is not "no suppliers". */
    if (!this.loading() && !this.suppliers().length) {
      this.ui.toast('Maak eerst een leverancier aan', 'err');
      return;
    }
    this.cnyRateEdited = false;
    this.usdRateEdited = false;
    this.chosenContainerType.set(DEFAULT_PURCHASE_CONTAINER_TYPE);
    this.cnyToUsd.set(null);
    this.usdToEur.set(null);
    this.applyAutomaticRates(this.automaticRates());
    this.picking.set(true);
  }

  setCnyToUsd(value: number | string | null): void {
    this.cnyRateEdited = true;
    this.cnyToUsd.set(Number(value));
  }

  setUsdToEur(value: number | string | null): void {
    this.usdRateEdited = true;
    this.usdToEur.set(Number(value));
  }

  private applyAutomaticRates(rates: ReturnType<typeof purchaseFxDefaults>): void {
    if (!rates) return;
    if (!this.cnyRateEdited) this.cnyToUsd.set(rates.cnyToUsd);
    if (!this.usdRateEdited) this.usdToEur.set(rates.usdToEur);
  }

  async create(): Promise<void> {
    const supplierId = this.chosen();
    const cnyToUsd = this.cnyToUsd();
    const usdToEur = this.usdToEur();
    if (this.creating() || supplierId === null || !positiveRate(cnyToUsd) || !positiveRate(usdToEur)) return;
    this.creating.set(true);
    try {
      const view = await this.sourcing.createPurchaseOrder(
        supplierId, cnyToUsd, usdToEur, 10, this.chosenContainerType());
      this.picking.set(false);
      await this.router.navigate(['/purchasing', view.order.id, 'edit']);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Calculatie aanmaken mislukt'), 'err');
    } finally {
      this.creating.set(false);
    }
  }

  /* ---- supplier groups folded shut, remembered on this device ---------- */
  private readonly foldedIds = signal<Set<number>>(new Set());
  private static readonly FOLD_KEY = 'enrosed.inkoop.folded';
  folded(supplierId: number): boolean { return this.foldedIds().has(supplierId); }
  toggleFold(supplierId: number): void {
    const next = new Set(this.foldedIds());
    if (next.has(supplierId)) next.delete(supplierId); else next.add(supplierId);
    this.foldedIds.set(next);
    try { localStorage.setItem(PurchaseList.FOLD_KEY, JSON.stringify([...next])); } catch { /* a convenience: without storage the fold lasts this visit */ }
  }
  private restoreFolds(): void {
    try {
      const raw = JSON.parse(localStorage.getItem(PurchaseList.FOLD_KEY) ?? '[]');
      if (Array.isArray(raw)) this.foldedIds.set(new Set(raw.filter((id): id is number => Number.isInteger(id))));
    } catch { /* nothing remembered */ }
  }

  /* ---- keyboard (desk): / search, Esc clears then leaves, ↑/↓ between rows, Shift+F10 the row menu, N a new calculation */
  escapeSearch(event: Event): void {
    const input = event.target as HTMLInputElement;
    event.preventDefault();
    if (this.query()) this.query.set('');
    else input.blur();
  }

  rowKey(event: KeyboardEvent, row: PurchaseOrderView): void {
    if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
      event.preventDefault();
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      this.openRow.set(null);
      this.rowMenu.set({ row, anchor: { x: rect.left + 24, y: rect.bottom } });
    }
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
      const rows = [...this.host.nativeElement.querySelectorAll<HTMLElement>('.pl-row')];
      if (!rows.length) return;
      event.preventDefault();
      const index = rows.indexOf(document.activeElement as HTMLElement);
      const next = index < 0 ? (event.key === 'ArrowDown' ? 0 : rows.length - 1)
        : Math.min(rows.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)));
      rows[next].focus();
    }
  }
}

function positiveRate(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}
