import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ChangeDetectionStrategy, Component, ElementRef, HostListener, ViewEncapsulation, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Skeleton } from '../../shared/skeleton';
import { FormsModule } from '@angular/forms';
import { SourcingApi } from '../../core/api/sourcing-api';
import { PurchaseOrderView, Supplier } from '../../core/api/models';
import type { SupplierProductRow } from '../../core/api/product-supplier-models';
import { AuthImage } from '../../core/api/auth-image';
import { PageHeader } from '../../shared/page-header';
import { ISO_COUNTRIES, countryName } from '../../core/api/geo';
import { escapeHtml, Sheet, Ui } from '../../shared/ui';
import { SupplierAddress } from '../../shared/supplier-address';
import { Icon } from '../../shared/icon';
import { ContextMenu, type ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import { LOAD_ERROR_FALLBACK, LoadError } from '../../shared/load-error';
import { keyContext } from '../../shared/key-context';
import { CurPipe, DateNlPipe, EurPipe } from '../../shared/pipes';
import { messageOf } from '../../core/api/errors';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { containerPayables } from '../finance/payables';
import { statusLabel, statusTone } from '../purchasing/purchase-phone-model';
import { containerCellSub, containerCounts, supplierOverview, type SupplierContainer } from './supplier-overview';
import { sortSupplierProducts, supplierProductCount, supplierProductSub, supplierProductTitle } from './supplier-products';

/**
 * Leveranciers' area stylesheet (Inkoop redesign, 2026-10-17): styles/suppliers.scss
 * stays global CSS with every rule under app-supplier-list, loaded with this
 * screen's lazy chunk instead of styles.scss (the initial bundle's 1 MB error
 * budget). Encapsulation None keeps the selectors as written; renders nothing.
 */
@Component({
  selector: 'app-supplier-list-styles',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { hidden: '' },
  template: '',
  styleUrl: '../../../styles/suppliers.scss',
})
export class SupplierListStyles {}

/** A subtitle while the list is not known yet: keeps the line's height and says nothing (no false '0'), as the Inkoop list does. */
const NOT_KNOWN_YET = '\u00a0';

function blank(): Supplier {
  return {
    id: null, name: '', country: 'CN', addressLine1: null, addressLine2: null,
    postalCode: null, city: '', region: null, contact: '', email: '', phone: '',
    currency: 'USD', incoterm: 'FOB', portOfLoading: '', leadTimeDays: 35, notes: '',
  };
}

/**
 * Leveranciers (Inkoop redesign I7, 2026-10-17). Desk: one table of every
 * supplier with its containers and what they ask now and later, the chosen
 * supplier in full below it (critique B7). Phone: a list, and a sheet per
 * supplier with its containers and open amounts. The containers come from the
 * same list request the Inkoop screen makes (supplierOverview). Producten
 * (2026-10-25): the products the supplier makes, one request per supplier
 * shown (sourcing.supplierProducts), on the desk under Containers and in the
 * phone sheet after them.
 */
@Component({
  selector: 'app-supplier-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Skeleton, FormsModule, RouterLink, NgTemplateOutlet, AuthImage, PageHeader, Sheet, SupplierAddress, Icon, ContextMenu, LoadError, SupplierListStyles, EurPipe, CurPipe, DateNlPipe],
  template: `
    <app-supplier-list-styles />
    <app-page-header [showBack]="true" title="Leveranciers" [subtitle]="subtitle()">
      @if (desktop.active()) {
        <div class="wk-search sup-search">
          <app-icon name="search" [size]="16" />
          <input #searchField type="search" data-page-search placeholder="Zoek op naam, stad of haven" aria-label="Leveranciers zoeken"
                 autocomplete="off" [value]="query()" (input)="setQuery($any($event.target).value)" (keydown.escape)="escapeSearch($event)" />
          <kbd class="wk-kbd" aria-hidden="true">/</kbd>
          <button class="wk-search__clear" type="button" aria-label="Zoekopdracht wissen" (click)="setQuery('')"><app-icon name="close" [size]="14" /></button>
        </div>
        <button class="btn btn--primary btn--sm" type="button" (click)="open(null)"><app-icon name="plus" [size]="16" />Nieuw</button>
      }
    </app-page-header>

    @if (desktop.active()) {
      <!-- Desk: every supplier with what it asks in one table, the chosen one in full below it (critique B7: no short column beside a long detail). -->
      <div class="content sup">
        @if (loadError(); as error) {
          <div class="wk-card"><app-load-error [message]="error" [busy]="loading()" (retry)="reload()" /></div>
        } @else if (loading() && !suppliers().length) {
          <!-- Only the first load: after Opslaan or Verwijderen the table and the detail stay while the list refreshes. -->
          <div class="wk-card" role="status" aria-label="Leveranciers laden"><app-skeleton kind="table" [rows]="4" /></div>
        } @else if (!suppliers().length) {
          <div class="wk-card"><div class="wk-empty">
            <h2 class="wk-empty__title">Nog geen leveranciers</h2>
            <p class="wk-empty__text">Voeg je eerste leverancier toe; daarna kies je hem bij een nieuwe calculatie.</p>
            <div class="wk-empty__actions"><button class="wk-btn wk-btn--primary" type="button" (click)="open(null)">Nieuwe leverancier</button></div>
          </div></div>
        } @else if (!filtered().length) {
          <div class="wk-card"><div class="wk-empty">
            <h2 class="wk-empty__title">Geen leverancier gevonden</h2>
            <div class="wk-empty__actions"><button class="wk-btn" type="button" (click)="setQuery('')">Zoekopdracht wissen</button></div>
          </div></div>
        } @else {
          <div class="wk-card sup-card">
            <div class="wk-table sup-table">
              <div class="wk-thead" aria-hidden="true">
                <span class="wk-th">Leverancier</span>
                <span class="wk-th">Munt</span>
                <span class="wk-th">Containers</span>
                <span class="wk-th wk-th--num">Nu te betalen</span>
                <span class="wk-th wk-th--num">Later</span>
                <span class="wk-th wk-th--num">Laatste order</span>
              </div>
              <div class="sup-rows" role="listbox" aria-label="Leveranciers" (keydown)="listKey($event)">
                @for (supplier of filtered(); track supplier.id) {
                  @let row = overviewOf(supplier.id);
                  <div class="wk-tr wk-tr--link sup-row" role="option" [id]="'sup-' + supplier.id" [attr.aria-selected]="selectedId() === supplier.id"
                       [attr.tabindex]="selectedId() === supplier.id ? 0 : -1" (click)="select(supplier)">
                    <span class="wk-td wk-td--wrap sup-cell"><b class="sup-name">{{ supplier.name }}</b><span class="sup-sub">{{ supplierLocation(supplier) || 'Adres nog niet ingevuld' }}</span></span>
                    <span class="wk-td"><span class="wk-pill">{{ supplier.currency }}</span></span>
                    @if (containersState() === 'ready') {
                      <span class="wk-td wk-td--wrap sup-cell"><b>{{ row?.containers?.length ?? 0 }}</b><span class="sup-sub">{{ containerCounts(row) }}</span></span>
                      <span class="wk-td wk-td--num" [class.sup-warn]="(row?.nowEur ?? 0) > 0">{{ (row?.nowEur ?? 0) | eur: 0 }}</span>
                      <span class="wk-td wk-td--num">{{ (row?.laterEur ?? 0) | eur: 0 }}</span>
                      <span class="wk-td wk-td--num">{{ row?.lastOrderDate ? (row!.lastOrderDate | dateNl) : '—' }}</span>
                    } @else {
                      <span class="wk-td sup-muted">{{ containersState() === 'error' ? '—' : '…' }}</span>
                      <span class="wk-td wk-td--num sup-muted">{{ containersState() === 'error' ? '—' : '…' }}</span>
                      <span class="wk-td wk-td--num sup-muted">{{ containersState() === 'error' ? '—' : '…' }}</span>
                      <span class="wk-td wk-td--num sup-muted">{{ containersState() === 'error' ? '—' : '…' }}</span>
                    }
                  </div>
                }
              </div>
            </div>
          </div>

          @if (selectedSupplier(); as supplier) {
            @let row = overviewOf(supplier.id);
            <section class="wk-card sup-detail" aria-labelledby="sup-detail-name">
              <header class="sup-detail__head">
                <span class="sup-mark" aria-hidden="true">{{ supplier.name.charAt(0) || '?' }}</span>
                <div class="sup-detail__who">
                  <h2 id="sup-detail-name">{{ supplier.name }}</h2>
                  <p>{{ supplierLocation(supplier) || 'Adres nog niet ingevuld' }} · factureert in {{ supplier.currency }}@if (supplier.incoterm) { · {{ supplier.incoterm }} }</p>
                </div>
                <div class="sup-detail__actions">
                  <button class="wk-btn wk-btn--primary" type="button" (click)="newCalculation(supplier)"><app-icon name="plus" [size]="16" />Nieuwe calculatie</button>
                  <button class="wk-btn" type="button" (click)="open(supplier)"><app-icon name="pencil" [size]="16" />Bewerken</button>
                  <button class="wk-btn wk-btn--ghost wk-btn--icon" type="button" aria-haspopup="menu" [attr.aria-label]="'Meer acties voor ' + supplier.name"
                          (click)="openMenu($event, supplier)"><app-icon name="more" [size]="16" /></button>
                </div>
              </header>
              <div class="wk-strip sup-strip" aria-label="Wat deze leverancier nog vraagt">
                <div class="wk-strip__item"><span class="wk-strip__label">Nu te betalen</span><span class="wk-strip__value" [class.sup-warn]="(row?.nowEur ?? 0) > 0">{{ containersState() === 'ready' ? ((row?.nowEur ?? 0) | eur: 0) : '—' }}</span></div>
                <div class="wk-strip__item"><span class="wk-strip__label">Later</span><span class="wk-strip__value">{{ containersState() === 'ready' ? ((row?.laterEur ?? 0) | eur: 0) : '—' }}</span></div>
                <div class="wk-strip__item"><span class="wk-strip__label">Tegoed open</span><span class="wk-strip__value">{{ containersState() === 'ready' ? ((row?.creditOpenEur ?? 0) | eur: 0) : '—' }}</span></div>
              </div>
              <section class="sup-sec" aria-labelledby="sup-containers-title">
                <h3 class="sup-sec__title" id="sup-containers-title">Containers</h3>
                @if (containersState() === 'loading') {
                  <app-skeleton kind="table" [rows]="3" />
                } @else if (containersState() === 'error') {
                  <p class="sup-muted" role="alert">Containers konden niet laden · <button class="wk-link" type="button" (click)="loadContainers()">Opnieuw</button></p>
                } @else if (!row?.containers?.length) {
                  <p class="sup-muted">Nog geen containers bij deze leverancier.</p>
                } @else {
                  <div class="wk-table sup-ctable" role="table" aria-label="Containers">
                    <div class="wk-thead" role="row">
                      <span class="wk-th" role="columnheader">Container</span>
                      <span class="wk-th" role="columnheader">Status</span>
                      <span class="wk-th wk-th--num" role="columnheader">Totaal geland</span>
                      <span class="wk-th" role="columnheader">Betaling</span>
                    </div>
                    @for (container of row!.containers; track container.id) {
                      <a class="wk-tr wk-tr--link sup-crow" role="row" [routerLink]="['/purchasing', container.id]">
                        <span class="wk-td wk-td--wrap sup-cell" role="cell"><b class="sup-name">{{ container.name }}</b>
                          <span class="sup-sub">{{ containerSub(container) }}@if (container.partner) { <span class="sup-tag">Partner</span> }@if (container.archived) { <span class="sup-tag sup-tag--muted">Gearchiveerd</span> }</span></span>
                        <span class="wk-td wk-td--wrap sup-cell" role="cell"><span class="wk-pill" [class]="statusTone(container.status)">{{ statusText(container.status) }}</span>
                          <span class="sup-sub">{{ container.status === 'ONTVANGEN' && container.receivedOn ? 'ontvangen ' + (container.receivedOn | dateNl) : (container.orderDate | dateNl) }}</span></span>
                        <span class="wk-td wk-td--num sup-total" role="cell">{{ container.totalEur | eur: 0 }}</span>
                        <span class="wk-td wk-td--wrap sup-cell" role="cell">
                          @switch (container.payment?.state) {
                            @case ('due') { <span class="sup-warn sup-nw">{{ container.payment!.nowEur | eur: 0 }} nu</span>@if (container.payment!.laterEur > 0) { <span class="sup-sub sup-nw">{{ container.payment!.laterEur | eur: 0 }} later</span> } }
                            @case ('later') { <span class="sup-nw">{{ container.payment!.laterEur | eur: 0 }} later</span> }
                            @case ('paid') { <span class="sup-ok">Alles betaald</span> }
                            @case ('concept') { <span class="sup-muted">nog niet besteld</span> }
                            @default { <span class="sup-muted">—</span> }
                          }
                        </span>
                      </a>
                    }
                  </div>
                }
              </section>
              <!-- Producten (several suppliers, 2026-10-25): what this supplier makes, with its version, EXW and last order; inactive rows folded. -->
              <section class="sup-sec" aria-labelledby="sup-products-title">
                @let listState = productsStateOf(supplier.id);
                <h3 class="sup-sec__title" id="sup-products-title">Producten@if (listState === 'ready') { <span class="sup-sec__count">{{ productCounts().active }}</span> }</h3>
                @if (listState === 'loading') {
                  <app-skeleton kind="table" [rows]="3" />
                } @else if (listState === 'error') {
                  <p class="sup-muted" role="alert">Producten konden niet laden · <button class="wk-link" type="button" (click)="loadProducts(supplier.id)">Opnieuw</button></p>
                } @else if (!products().length) {
                  <p class="sup-muted">Nog geen producten bij deze leverancier.</p>
                } @else {
                  <div class="wk-table sup-ptable" role="table" aria-label="Producten">
                    <div class="wk-thead" role="row">
                      <span class="wk-th" role="columnheader">Product</span>
                      <span class="wk-th wk-th--num" role="columnheader">EXW</span>
                      <span class="wk-th wk-th--num" role="columnheader">Laatst besteld</span>
                    </div>
                    <div class="sup-pbody" role="rowgroup">
                      @for (product of activeProducts(); track product.rowId) {
                        <ng-container *ngTemplateOutlet="deskProduct; context: { $implicit: product }" />
                      }
                      @if (inactiveProducts().length) {
                        <div class="wk-tr sup-pfold" role="row">
                          <span class="wk-td" role="cell"><button class="wk-link" type="button" [attr.aria-expanded]="showInactiveProducts()" (click)="toggleInactiveProducts()">{{ inactiveProducts().length }} inactief <span class="sup-fold__chev" aria-hidden="true">›</span></button></span>
                        </div>
                        @if (showInactiveProducts()) {
                          @for (product of inactiveProducts(); track product.rowId) {
                            <ng-container *ngTemplateOutlet="deskProduct; context: { $implicit: product }" />
                          }
                        }
                      }
                    </div>
                  </div>
                }
              </section>
              <div class="sup-pair">
                <section class="sup-sec" aria-labelledby="sup-terms-title">
                  <h3 class="sup-sec__title" id="sup-terms-title">Inkoopafspraken</h3>
                  <dl class="wk-kv">
                    <div><dt>Factureert in</dt><dd>{{ supplier.currency }}</dd></div>
                    <div><dt>Incoterm</dt><dd>{{ supplier.incoterm || '—' }}</dd></div>
                    <div><dt>Laadhaven</dt><dd>{{ supplier.portOfLoading || '—' }}</dd></div>
                    <div><dt>Levertijd</dt><dd>{{ supplier.leadTimeDays }} dagen</dd></div>
                  </dl>
                </section>
                <section class="sup-sec" aria-labelledby="sup-contact-title">
                  <h3 class="sup-sec__title" id="sup-contact-title">Adres en contact</h3>
                  <app-supplier-address [supplier]="supplier" />
                  <div class="sup-contact">
                    @if (supplier.contact) { <b>{{ supplier.contact }}</b> }
                    @if (supplier.email) { <a class="wk-link" [href]="'mailto:' + supplier.email">{{ supplier.email }}</a> }
                    @if (supplier.phone) { <a class="wk-link" [href]="'tel:' + supplier.phone">{{ supplier.phone }}</a> }
                    @if (!supplier.contact && !supplier.email && !supplier.phone) { <span class="sup-muted">Contactgegevens nog niet ingevuld</span> }
                  </div>
                </section>
              </div>
              @if (supplier.notes) {
                <section class="sup-sec" aria-labelledby="sup-notes-title">
                  <h3 class="sup-sec__title" id="sup-notes-title">Interne notitie</h3>
                  <p class="sup-notes">{{ supplier.notes }}</p>
                </section>
              }
            </section>
          }
        }
      </div>
    } @else {
      <div class="content sup sup--phone">
        <div class="ios-search sup-isearch">
          <div class="ios-search__field">
            <app-icon name="search" [size]="17" />
            <input type="search" data-page-search placeholder="Zoek op naam, stad of haven" aria-label="Leveranciers zoeken" autocomplete="off"
                   enterkeyhint="search" [value]="query()" (input)="setQuery($any($event.target).value)" />
            @if (query()) { <button class="ios-search__clear" type="button" aria-label="Zoekopdracht wissen" (click)="setQuery('')"><app-icon name="close" [size]="16" /></button> }
          </div>
        </div>
        @if (loadError(); as error) {
          <app-load-error [message]="error" [busy]="loading()" (retry)="reload()" />
        } @else if (loading() && !suppliers().length) {
          <div class="sup-loading" role="status" aria-label="Leveranciers laden"><app-skeleton kind="group" [rows]="4" /></div>
        } @else if (!suppliers().length) {
          <div class="ios-empty">
            <h2 class="ios-empty__title">Nog geen leveranciers</h2>
            <p class="ios-empty__text">Voeg je eerste leverancier toe; daarna kies je hem bij een nieuwe calculatie.</p>
            <button class="ios-capsule ios-capsule--tinted" type="button" (click)="open(null)">Nieuwe leverancier</button>
          </div>
        } @else if (!filtered().length) {
          <div class="ios-empty">
            <h2 class="ios-empty__title">Geen leverancier gevonden</h2>
            <button class="ios-capsule ios-capsule--tinted" type="button" (click)="setQuery('')">Zoekopdracht wissen</button>
          </div>
        } @else {
          <div class="ios-group">
            @for (supplier of filtered(); track supplier.id) {
              <!-- Same gesture as before: swipe left reveals delete, a committed swipe asks straight away. -->
              <div class="swipe sup-swipe" [class.swipe--open]="swiped() === supplier.id">
                <button class="ios-cell swipe__row" type="button"
                        (touchstart)="swipeStart($event, supplier.id!)"
                        (touchmove)="swipeMove($event, supplier.id!)"
                        (click)="openUnlessSwiped($event, supplier)">
                  <span class="ios-cell__body">
                    <span class="ios-cell__title sup-wrap">{{ supplier.name }}</span>
                    <span class="ios-cell__sub sup-wrap">{{ supplierLocation(supplier) || 'Adres nog niet ingevuld' }}</span>
                  </span>
                  <span class="ios-cell__trail"><span class="wk-pill">{{ supplier.currency }}</span></span>
                  <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                </button>
                <button class="swipe__delete" type="button" (click)="removeFromList(supplier)" [attr.aria-label]="'Leverancier ' + supplier.name + ' verwijderen'">
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
                       stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M4 7h16" /><path d="M9 7V5h6v2" />
                    <path d="M6.5 7l1 13h9l1-13" /><path d="M10 11v6" /><path d="M14 11v6" />
                  </svg>
                </button>
              </div>
            }
          </div>
        }
      </div>
      <button class="fab" type="button" (click)="open(null)">+ Leverancier</button>
    }

    <!-- One product row of a supplier: photo, name · kleur · maat on one line (ellipsis), version · ref · last order under it. -->
    <ng-template #deskProduct let-product>
      <a class="wk-tr wk-tr--link sup-prow" role="row" [class.sup-prow--off]="!product.active || !product.productActive"
         [attr.title]="product.productActive ? null : 'Product inactief'" [routerLink]="['/products', product.productId]">
        <span class="wk-td sup-prod" role="cell">
          @if (product.photoUrl) { <img class="sup-prod__photo" [appAuthSrc]="product.photoUrl" appAuthLazy alt="" draggable="false" /> }
          @else { <span class="sup-prod__photo sup-prod__photo--none" aria-hidden="true">◈</span> }
          <span class="sup-prod__body">
            <span class="sup-prod__line"><b class="sup-prod__name">{{ productTitle(product) }}</b>@if (product.preferred) { <span class="wk-pill tone-accent">Voorkeur</span> }@if (!product.active) { <span class="wk-pill wk-pill--outline">Inactief</span> }</span>
            <span class="sup-prod__sub">{{ productSub(product) }}</span>
          </span>
        </span>
        <span class="wk-td wk-td--num sup-prod__price" role="cell">@if (product.exwPrice != null) { {{ product.exwPrice | cur: (product.exwCurrency ?? 'USD') }} } @else { — }</span>
        <span class="wk-td wk-td--num" role="cell">{{ product.lastOrder?.orderDate | dateNl }}</span>
      </a>
    </ng-template>
    <ng-template #phoneProduct let-product>
      <a class="ios-cell" [class.sup-prow--off]="!product.active || !product.productActive" [routerLink]="['/products', product.productId]" (click)="close()">
        @if (product.photoUrl) { <img class="ios-thumb" [appAuthSrc]="product.photoUrl" appAuthLazy alt="" draggable="false" /> }
        @else { <span class="ios-thumb sup-thumb--none" aria-hidden="true">◈</span> }
        <span class="ios-cell__body">
          <span class="ios-cell__title">{{ productTitle(product) }}</span>
          <span class="ios-cell__sub">{{ productSub(product) }}</span>
        </span>
        <span class="ios-cell__trail">
          <span class="ios-cell__value ios-cell__value--strong sup-prod__price">@if (product.exwPrice != null) { {{ product.exwPrice | cur: (product.exwCurrency ?? 'USD') }} } @else { — }</span>
          @if (product.preferred) { <span class="ios-cell__meta sup-pref">Voorkeur</span> } @else if (!product.active) { <span class="ios-cell__meta">Inactief</span> }
        </span>
        <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
      </a>
    </ng-template>

    @if (menu(); as open) {
      <app-context-menu class="sup-menu" [title]="open.supplier.name" [items]="menuItems" [anchor]="open.anchor" variant="ios" cancelLabel="Annuleren"
                        (pick)="menu.set(null); removeFromList(open.supplier)" (closed)="menu.set(null)" />
    }

    @if (editing()) {
      <app-sheet [title]="editMode()
                   ? (draft().id ? 'Leverancier bewerken' : 'Nieuwe leverancier')
                   : draft().name"
                 variant="ios" (closed)="close()">
        <div body>
          @if (!editMode()) {
            @let row = overviewOf(draft().id);
            <!-- Phone: the supplier in full, with its containers and what they still ask. -->
            <div class="sup-sheet">
              <div class="sup-hero">
                <span class="sup-mark" aria-hidden="true">{{ draft().name.charAt(0) || '?' }}</span>
                <span class="sup-hero__copy"><b>{{ draft().name }}</b><span>{{ supplierLocation(draft()) || 'Locatie nog niet ingevuld' }}</span></span>
                <span class="wk-pill">{{ draft().currency }}</span>
              </div>
              <div class="sup-capsules">
                <!-- Bewerken is the sheet's primary at its foot (the iOS sheet pattern), not a second button here. -->
                <button class="ios-capsule ios-capsule--tinted" type="button" (click)="newCalculation(draft())"><app-icon name="plus" [size]="16" />Nieuwe calculatie</button>
              </div>
              <div class="ios-figures sup-figures">
                <div><small>Nu te betalen</small><strong [class.sup-warn]="(row?.nowEur ?? 0) > 0">{{ containersState() === 'ready' ? ((row?.nowEur ?? 0) | eur: 0) : '—' }}</strong></div>
                <div><small>Later</small><strong>{{ containersState() === 'ready' ? ((row?.laterEur ?? 0) | eur: 0) : '—' }}</strong></div>
                <div class="sup-figures__wide"><small>Tegoed open bij deze leverancier</small><strong>{{ containersState() === 'ready' ? ((row?.creditOpenEur ?? 0) | eur: 0) : '—' }}</strong></div>
              </div>
              <section class="ios-section">
                <div class="ios-section__head"><h2>Containers</h2><span class="ios-section__trail">{{ row?.containers?.length ?? 0 }}</span></div>
                @if (containersState() === 'loading') {
                  <app-skeleton kind="group" [rows]="2" />
                } @else if (containersState() === 'error') {
                  <p class="ios-section__foot" role="alert">Containers konden niet laden · <button class="wk-link" type="button" (click)="loadContainers()">Opnieuw</button></p>
                } @else if (!row?.containers?.length) {
                  <p class="ios-section__foot">Nog geen containers bij deze leverancier.</p>
                } @else {
                  <div class="ios-group">
                    @for (container of row!.containers; track container.id) {
                      <a class="ios-cell" [routerLink]="['/purchasing', container.id]" (click)="close()">
                        <span class="ios-cell__body">
                          <span class="ios-cell__title sup-wrap">{{ container.name }}</span>
                          <span class="ios-cell__sub sup-wrap">{{ containerCellSub(container, statusText(container.status)) }}</span>
                        </span>
                        <span class="ios-cell__trail">
                          <span class="ios-cell__value ios-cell__value--strong">{{ container.totalEur | eur: 0 }}</span>
                          @switch (container.payment?.state) {
                            @case ('due') { <span class="ios-cell__meta sup-warn">{{ container.payment!.nowEur | eur: 0 }} nu</span> }
                            @case ('later') { <span class="ios-cell__meta">{{ container.payment!.laterEur | eur: 0 }} later</span> }
                            @case ('paid') { <span class="ios-cell__meta sup-ok">betaald</span> }
                            @case ('concept') { <span class="ios-cell__meta">nog niet besteld</span> }
                          }
                        </span>
                        <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                      </a>
                    }
                  </div>
                }
              </section>
              <section class="ios-section">
                @let listState = productsStateOf(draft().id);
                <div class="ios-section__head"><h2>Producten</h2>@if (listState === 'ready') { <span class="ios-section__trail">{{ productCounts().active }}</span> }</div>
                @if (listState === 'loading') {
                  <app-skeleton kind="group" [rows]="2" />
                } @else if (listState === 'error') {
                  <p class="ios-section__foot" role="alert">Producten konden niet laden · <button class="wk-link" type="button" (click)="loadProducts(draft().id)">Opnieuw</button></p>
                } @else if (!products().length) {
                  <p class="ios-section__foot">Nog geen producten bij deze leverancier.</p>
                } @else {
                  <div class="ios-group ios-group--thumbs">
                    @for (product of activeProducts(); track product.rowId) {
                      <ng-container *ngTemplateOutlet="phoneProduct; context: { $implicit: product }" />
                    }
                    @if (inactiveProducts().length) {
                      <button class="ios-cell ios-cell--action sup-pfold" type="button" [attr.aria-expanded]="showInactiveProducts()" (click)="toggleInactiveProducts()">{{ inactiveProducts().length }} inactief <span class="sup-fold__chev" aria-hidden="true">›</span></button>
                      @if (showInactiveProducts()) {
                        @for (product of inactiveProducts(); track product.rowId) {
                          <ng-container *ngTemplateOutlet="phoneProduct; context: { $implicit: product }" />
                        }
                      }
                    }
                  </div>
                }
              </section>
              <section class="ios-section">
                <div class="ios-section__head"><h2>Inkoopafspraken</h2></div>
                <div class="ios-group">
                  <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Factureert in</span></span><span class="ios-cell__trail"><span class="ios-cell__value">{{ draft().currency }}</span></span></div>
                  <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Incoterm</span></span><span class="ios-cell__trail"><span class="ios-cell__value">{{ draft().incoterm || '—' }}</span></span></div>
                  <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Laadhaven</span></span><span class="ios-cell__trail"><span class="ios-cell__value sup-wrap">{{ draft().portOfLoading || '—' }}</span></span></div>
                  <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Levertijd</span></span><span class="ios-cell__trail"><span class="ios-cell__value">{{ draft().leadTimeDays }} dagen</span></span></div>
                </div>
              </section>
              <section class="ios-section">
                <div class="ios-section__head"><h2>Adres</h2></div>
                <div class="ios-group sup-address"><app-supplier-address [supplier]="draft()" [showEmpty]="true" /></div>
              </section>
              <section class="ios-section">
                <div class="ios-section__head"><h2>Contact</h2></div>
                <div class="ios-group">
                  @if (draft().contact) { <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title sup-wrap">{{ draft().contact }}</span></span></div> }
                  @if (draft().email) { <a class="ios-cell" [href]="'mailto:' + draft().email"><span class="ios-cell__body"><span class="ios-cell__title sup-link sup-wrap">{{ draft().email }}</span></span></a> }
                  @if (draft().phone) { <a class="ios-cell" [href]="'tel:' + draft().phone"><span class="ios-cell__body"><span class="ios-cell__title sup-link">{{ draft().phone }}</span></span></a> }
                  @if (!draft().contact && !draft().email && !draft().phone) {
                    <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title sup-muted">Contactgegevens nog niet ingevuld</span></span></div>
                  }
                </div>
              </section>
              @if (draft().notes) {
                <section class="ios-section">
                  <div class="ios-section__head"><h2>Interne notitie</h2></div>
                  <div class="ios-group"><p class="sup-notes sup-notes--cell">{{ draft().notes }}</p></div>
                </section>
              }
            </div>
          } @else {
            <div class="sup-form">
            <p class="legend"><b>*</b> verplicht · adresvelden mogen leeg blijven.</p>

            <section class="form-section" aria-labelledby="supplier-company-form-title">
              <div class="form-section__head">
                <span>1</span>
                <div><h3 id="supplier-company-form-title">Bedrijf &amp; contact</h3>
                  <p>Wie levert en wie kunnen we bereiken?</p></div>
              </div>
              <div class="form-grid">
                <div class="field span-2">
                  <label class="req" for="s-name">Bedrijfsnaam</label>
                  <input class="input" id="s-name" required autocomplete="organization"
                         [attr.aria-invalid]="saveAttempted() && !draft().name.trim()"
                         [ngModel]="draft().name" (ngModelChange)="patch({ name: $event })" />
                  @if (saveAttempted() && !draft().name.trim()) {
                    <span class="field-error" role="alert">Vul een bedrijfsnaam in.</span>
                  }
                </div>
                <div class="field"><label for="s-contact">Contactpersoon</label>
                  <input class="input" id="s-contact" autocomplete="name"
                         [ngModel]="draft().contact"
                         (ngModelChange)="patch({ contact: $event })" /></div>
                <div class="field"><label for="s-email">E-mail</label>
                  <input class="input" id="s-email" type="email" autocomplete="email"
                         [ngModel]="draft().email"
                         (ngModelChange)="patch({ email: $event })" /></div>
                <div class="field"><label for="s-phone">Telefoon</label>
                  <input class="input" id="s-phone" type="tel" autocomplete="tel"
                         [ngModel]="draft().phone"
                         (ngModelChange)="patch({ phone: $event })" /></div>
              </div>
            </section>

            <section class="form-section" aria-labelledby="supplier-address-form-title">
              <div class="form-section__head">
                <span>2</span>
                <div><h3 id="supplier-address-form-title">Adres</h3>
                  <p>Ook geschikt voor Chinese districten, zones en provincies.</p></div>
              </div>
              <div class="form-grid">
                <div class="field span-2"><label for="s-address-1">Adresregel 1</label>
                  <input class="input" id="s-address-1" autocomplete="address-line1"
                         [ngModel]="draft().addressLine1"
                         (ngModelChange)="patch({ addressLine1: $event })"
                         placeholder="Gebouw, straat of industriepark" />
                  <span class="hint">Gebouw, straat of industriepark</span></div>
                <div class="field span-2"><label for="s-address-2">Adresregel 2</label>
                  <input class="input" id="s-address-2" autocomplete="address-line2"
                         [ngModel]="draft().addressLine2"
                         (ngModelChange)="patch({ addressLine2: $event })"
                         placeholder="District, zone, verdieping of extra aanwijzing" />
                  <span class="hint">District, zone of andere extra adresinformatie</span></div>
                <div class="field"><label for="s-city">Stad</label>
                  <input class="input" id="s-city" autocomplete="address-level2"
                         [ngModel]="draft().city" (ngModelChange)="patch({ city: $event })"
                         placeholder="Bijv. Shenzhen" /></div>
                <div class="field"><label for="s-region">Provincie/regio</label>
                  <input class="input" id="s-region" autocomplete="address-level1"
                         [ngModel]="draft().region" (ngModelChange)="patch({ region: $event })"
                         placeholder="Bijv. Guangdong" /></div>
                <div class="field"><label for="s-postal">Postcode</label>
                  <input class="input" id="s-postal" autocomplete="postal-code"
                         [ngModel]="draft().postalCode"
                         (ngModelChange)="patch({ postalCode: $event })" /></div>
                <div class="field"><label for="s-country">Land</label>
                  <select class="select" id="s-country" autocomplete="country"
                          [ngModel]="draft().country"
                          (ngModelChange)="patch({ country: $event })">
                    <option value="">Land nog niet gekozen</option>
                    @if (draft().country && !countryKnown(draft().country)) {
                      <option [value]="draft().country">{{ draft().country }}</option>
                    }
                    @for (option of isoCountries; track option.code) {
                      <option [value]="option.code">{{ option.name }}</option>
                    }
                  </select></div>
              </div>
            </section>

            <section class="form-section" aria-labelledby="supplier-buying-form-title">
              <div class="form-section__head">
                <span>3</span>
                <div><h3 id="supplier-buying-form-title">Inkoopafspraken</h3>
                  <p>Valuta, transportafspraak en planning.</p></div>
              </div>
              <div class="form-grid">
                <div class="field"><label class="req" for="s-currency">Factureert in</label>
                  <select class="select" id="s-currency" [ngModel]="draft().currency"
                          (ngModelChange)="patch({ currency: $event })">
                    <option value="USD">USD</option><option value="CNY">CNY</option>
                    <option value="EUR">EUR</option>
                  </select></div>
                <div class="field"><label for="s-incoterm">Incoterm</label>
                  <select class="select" id="s-incoterm" [ngModel]="draft().incoterm"
                          (ngModelChange)="patch({ incoterm: $event })">
                    <option value="EXW">EXW</option><option value="FOB">FOB</option>
                    <option value="CIF">CIF</option>
                  </select></div>
                <div class="field"><label for="s-port">Laadhaven <span class="opt"></span></label>
                  <input class="input" id="s-port" [ngModel]="draft().portOfLoading"
                         (ngModelChange)="patch({ portOfLoading: $event })"
                         placeholder="Bijv. Yantian / Shenzhen" /></div>
                <div class="field"><label for="s-lead">Levertijd (dagen)</label>
                  <input class="input num right" id="s-lead" type="number" min="0" step="1"
                         inputmode="numeric" [ngModel]="draft().leadTimeDays"
                         (ngModelChange)="patch({ leadTimeDays: +$event })" /></div>
                <div class="field span-2"><label for="s-notes">Interne notities <span class="opt"></span></label>
                  <textarea class="textarea" id="s-notes" rows="3" [ngModel]="draft().notes"
                            (ngModelChange)="patch({ notes: $event })"></textarea></div>
              </div>
            </section>
            </div>
            @if (draft().id && !desktop.active()) {
              <!-- Phone: Verwijderen as its own cell under the form (the iOS sheet pattern, as on Douane); three capsules did not fit a 360 px foot. -->
              <div class="ios-group sup-delete"><button class="ios-cell ios-cell--danger" type="button" [disabled]="saving()" (click)="remove()">Verwijderen</button></div>
            }
          }
        </div>
        <div foot style="display:contents">
          @if (!editMode()) {
            <button class="btn" type="button" (click)="close()">Sluiten</button>
            <span class="spacer"></span>
            <button class="btn btn--primary" type="button" (click)="editMode.set(true)">
              Bewerken
            </button>
          } @else {
            @if (draft().id && desktop.active()) {
              <button class="btn btn--danger" type="button" [disabled]="saving()"
                      (click)="remove()">Verwijderen</button>
            }
            <span class="spacer"></span>
            <button class="btn" type="button" [disabled]="saving()" (click)="cancelEdit()">
              Annuleren
            </button>
            <button class="btn btn--primary" type="button"
                    [disabled]="saving()" (click)="save()">
              {{ saving() ? 'Opslaan…' : 'Opslaan' }}
            </button>
          }
        </div>
      </app-sheet>
    }
  `,
  styles: [`
    :host{display:block}
    .form-section{margin:0 0 12px;padding:12px 12px 0;border:1px solid var(--line);border-radius:16px;background:var(--surface)}.form-section__head{display:flex;align-items:flex-start;gap:9px;margin-bottom:12px}.form-section__head>span{display:grid;width:30px;height:30px;flex:none;place-items:center;border-radius:9px;background:var(--rose-soft);color:var(--rose-dark);font-size:11px;font-weight:760}.form-section__head h3{font-size:13px}.form-section__head p{color:var(--muted);font-size:10.5px}.field-error{color:var(--danger);font-size:11px}.input[aria-invalid="true"]{border-color:var(--danger)}
    @media(min-width: 680px){.form-section{padding:15px 15px 1px}}
  `],
})
export class SupplierList {
  readonly isoCountries = ISO_COUNTRIES;
  readonly desktop = inject(DesktopViewport);
  readonly containerCounts = containerCounts;
  readonly containerCellSub = containerCellSub;
  readonly statusTone = statusTone;
  readonly statusText = statusLabel;
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly searchField = viewChild<ElementRef<HTMLInputElement>>('searchField');

  readonly suppliers = signal<Supplier[]>([]);
  readonly query = signal('');
  readonly editing = signal(false);
  readonly editMode = signal(false);
  readonly selected = signal<Supplier | null>(null);
  readonly draft = signal<Supplier>(blank());
  readonly loading = signal(true);
  /** The suppliers could not load (B2): app-load-error with 'Opnieuw proberen'. */
  readonly loadError = signal<string | null>(null);
  /** The count once the list is known; while it loads (or failed) a blank line of the same height, never a false '0 leveranciers' (I-B14). */
  readonly subtitle = computed(() => (this.loading() && !this.suppliers().length) || this.loadError()
    ? NOT_KNOWN_YET : `${this.suppliers().length} leveranciers`);
  readonly saving = signal(false);
  readonly saveAttempted = signal(false);
  /** The desk's chosen supplier (the detail below the table). */
  readonly selectedId = signal<number | null>(null);

  /* ---- the containers: one list request, grouped per supplier (F20) */
  readonly orders = signal<PurchaseOrderView[]>([]);
  readonly containersState = signal<'loading' | 'ready' | 'error'>('loading');
  private readonly overview = computed(() => {
    const rows = this.orders();
    return supplierOverview(rows, containerPayables(rows));
  });
  overviewOf(id: number | null | undefined) { return id == null ? undefined : this.overview().get(id); }

  /* ---- the products this supplier makes (several suppliers, 2026-10-25): one request per supplier shown */
  readonly productTitle = supplierProductTitle;
  readonly productSub = supplierProductSub;
  /** The supplier the product list belongs to; an answer that arrives after another supplier was chosen is dropped. */
  readonly productsFor = signal<number | null>(null);
  readonly productsState = signal<'loading' | 'ready' | 'error'>('loading');
  readonly products = signal<SupplierProductRow[]>([]);
  readonly showInactiveProducts = signal(false);
  readonly activeProducts = computed(() => this.products().filter((row) => row.active));
  readonly inactiveProducts = computed(() => this.products().filter((row) => !row.active));
  readonly productCounts = computed(() => supplierProductCount(this.products()));
  private productsRequest = 0;

  constructor() {
    /* Deep links (the product hero) filter the list straight to one supplier and choose it. */
    const q = inject(ActivatedRoute).snapshot.queryParamMap.get('q');
    if (q) this.query.set(q);
    void this.load();
    void this.loadContainers();
    /* Desk: the chosen supplier's products load with it; the phone loads them when its sheet opens. */
    effect(() => {
      if (!this.desktop.active()) return;
      const id = this.selectedId();
      untracked(() => {
        if (id != null && this.productsFor() !== id) void this.loadProducts(id);
      });
    });
  }

  /** The list's state for this supplier: another supplier's list (or none yet) reads as loading. */
  productsStateOf(id: number | null | undefined): 'loading' | 'ready' | 'error' {
    return id != null && this.productsFor() === id ? this.productsState() : 'loading';
  }

  async loadProducts(supplierId: number | null | undefined): Promise<void> {
    if (supplierId == null) return;
    const request = ++this.productsRequest;
    this.productsFor.set(supplierId);
    this.productsState.set('loading');
    this.products.set([]);
    this.showInactiveProducts.set(false);
    try {
      const rows = await this.sourcing.supplierProducts(supplierId);
      if (request !== this.productsRequest || this.productsFor() !== supplierId) return;
      this.products.set(sortSupplierProducts(rows));
      this.productsState.set('ready');
    } catch {
      if (request === this.productsRequest && this.productsFor() === supplierId) this.productsState.set('error');
    }
  }

  toggleInactiveProducts(): void {
    this.showInactiveProducts.update((open) => !open);
  }

  reload(): void { void this.load(); }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.suppliers.set((await this.sourcing.suppliers()).map((supplier) => this.withAddressDefaults(supplier)));
      this.keepSelection();
    } catch (failure: unknown) {
      this.loadError.set(messageOf(failure, LOAD_ERROR_FALLBACK));
    } finally {
      this.loading.set(false);
    }
  }

  async loadContainers(): Promise<void> {
    this.containersState.set('loading');
    try {
      this.orders.set(await this.sourcing.purchaseOrders());
      this.containersState.set('ready');
    } catch {
      this.containersState.set('error');
    }
  }

  readonly filtered = computed(() => {
    const needle = this.query().trim().toLowerCase();
    if (!needle) return this.suppliers();
    return this.suppliers().filter((supplier) => [
      supplier.name, supplier.contact, supplier.addressLine1, supplier.addressLine2,
      supplier.postalCode, supplier.city, supplier.region, supplier.country,
      countryName(supplier.country), supplier.portOfLoading, supplier.email,
    ].join(' ').toLowerCase().includes(needle));
  });
  readonly selectedSupplier = computed(() => this.filtered().find((supplier) => supplier.id === this.selectedId()) ?? null);

  setQuery(value: string): void {
    this.query.set(value);
    this.keepSelection();
  }

  /** The first supplier (or the first hit of the search) stays chosen; a chosen one that still shows stays. */
  private keepSelection(): void {
    const shown = this.filtered();
    if (!shown.some((supplier) => supplier.id === this.selectedId())) this.selectedId.set(shown[0]?.id ?? null);
  }

  select(supplier: Supplier): void {
    this.selectedId.set(supplier.id);
  }

  /** '{PO} · {orderdatum}': the number only when the title is a name. */
  containerSub(container: SupplierContainer): string {
    const parts = [container.name !== container.number ? container.number : '', new DateNlPipe().transform(container.orderDate)];
    return parts.filter(Boolean).join(' · ');
  }

  /** 'Nieuwe calculatie': the Inkoop list opens its sheet with this supplier chosen (F19). */
  newCalculation(supplier: Supplier): void {
    if (supplier.id == null) return;
    this.editing.set(false);
    void this.router.navigate(['/purchasing'], { queryParams: { nieuw: 1, leverancier: supplier.id } });
  }

  /* ---- the desk's ⋯ menu */
  readonly menu = signal<{ supplier: Supplier; anchor: MenuPoint | null } | null>(null);
  readonly menuItems: ContextMenuItem[] = [{ id: 'delete', label: 'Verwijderen…', iconName: 'trash', hint: 'Na bevestiging', danger: true }];
  openMenu(event: MouseEvent, supplier: Supplier): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.menu.set({ supplier, anchor: { x: rect.left, y: rect.bottom + 4 } });
  }

  /* ---- keyboard (desk): / search, Esc clears then leaves, ↑/↓ the chosen supplier, Enter Bewerken, N a new supplier */
  escapeSearch(event: Event): void {
    event.preventDefault();
    if (this.query()) this.setQuery('');
    else (event.target as HTMLInputElement).blur();
  }

  listKey(event: KeyboardEvent): void {
    const shown = this.filtered();
    const index = shown.findIndex((supplier) => supplier.id === this.selectedId());
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = shown[Math.min(shown.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))];
      if (!next) return;
      this.selectedId.set(next.id);
      requestAnimationFrame(() => document.getElementById('sup-' + next.id)?.focus());
    } else if (event.key === 'Enter' && index >= 0) {
      event.preventDefault();
      this.open(shown[index]);
    }
  }

  @HostListener('document:keydown', ['$event'])
  onKey(event: KeyboardEvent): void {
    if (!this.desktop.active() || event.metaKey || event.ctrlKey || event.altKey) return;
    const context = keyContext(event, this.host.nativeElement);
    if (context.typing || context.overlayOpen || !context.inScope) return;
    if (event.key === '/') {
      event.preventDefault();
      this.searchField()?.nativeElement.focus();
    } else if ((event.key === 'n' || event.key === 'N') && !event.shiftKey) {
      event.preventDefault();
      this.open(null);
    }
  }

  /** A row on the phone opens its sheet; on the desk Bewerken opens the form (the detail is already on the page). */
  open(supplier: Supplier | null): void {
    const normalized = supplier ? this.withAddressDefaults(supplier) : null;
    this.selected.set(normalized);
    this.draft.set(normalized ? { ...normalized } : blank());
    this.editMode.set(!supplier || this.desktop.active());
    this.saveAttempted.set(false);
    this.editing.set(true);
    if (supplier && !this.desktop.active()) void this.loadProducts(supplier.id);
  }

  close(): void {
    if (this.saving()) return;
    this.editing.set(false);
    this.editMode.set(false);
    this.selected.set(null);
  }

  cancelEdit(): void {
    const supplier = this.selected();
    if (!supplier || this.desktop.active()) { this.close(); return; }
    this.draft.set({ ...supplier });
    this.editMode.set(false);
    this.saveAttempted.set(false);
  }

  supplierLocation(supplier: Supplier): string {
    return [supplier.city, supplier.region, countryName(supplier.country)]
      .map((value) => value?.trim()).filter(Boolean).join(' · ');
  }

  countryKnown(code: string): boolean {
    return ISO_COUNTRIES.some((country) => country.code === code);
  }

  patch(changes: Partial<Supplier>): void {
    this.draft.update((supplier) => ({ ...supplier, ...changes }));
  }

  async save(): Promise<void> {
    if (this.saving()) return;
    this.saveAttempted.set(true);
    const supplier = this.draft();
    if (!supplier.name.trim()) return;
    this.saving.set(true);
    try {
      const saved = supplier.id === null ? await this.sourcing.createSupplier(supplier) : await this.sourcing.updateSupplier(supplier.id, supplier);
      this.editing.set(false);
      if (saved?.id != null) this.selectedId.set(saved.id);
      await this.load();
      this.ui.toast('Leverancier opgeslagen');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Opslaan mislukt'), 'err');
    } finally {
      this.saving.set(false);
    }
  }

  /* ---- swipe to delete, the purchase-list way ---- */
  readonly swiped = signal<number | null>(null);
  private touchX = 0;
  private touchY = 0;
  private swipeHandled = false;

  swipeStart(event: TouchEvent, id: number): void {
    this.touchX = event.touches[0].clientX;
    this.touchY = event.touches[0].clientY;
    this.swipeHandled = false;
    if (this.swiped() !== null && this.swiped() !== id) this.swiped.set(null);
  }

  swipeMove(event: TouchEvent, id: number): void {
    if (this.swipeHandled) return;
    const dx = event.touches[0].clientX - this.touchX;
    const dy = event.touches[0].clientY - this.touchY;
    if (Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < -140) {
      this.swipeHandled = true;
      const supplier = this.filtered().find((candidate) => candidate.id === id);
      if (supplier) this.removeFromList(supplier);
      return;
    }
    if (dx < -24) { this.swiped.set(id); return; }
    if (dx > 24) { this.swipeHandled = true; this.swiped.set(null); }
  }

  openUnlessSwiped(event: Event, supplier: Supplier): void {
    if (this.swiped() !== null || this.swipeHandled) {
      event.preventDefault();
      if (!this.swipeHandled) this.swiped.set(null);
      return;
    }
    this.open(supplier);
  }

  removeFromList(supplier: Supplier): void {
    this.ui.confirm(
      { title: 'Leverancier verwijderen', message: `<b>${escapeHtml(supplier.name)}</b> verwijderen?`,
        confirmLabel: 'Verwijderen', danger: true },
      async () => {
        try {
          await this.sourcing.deleteSupplier(supplier.id!);
          this.swiped.set(null);
          await this.load();
          this.ui.toast('Leverancier verwijderd');
        } catch (failure: unknown) {
          this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
        }
      });
  }

  remove(): void {
    const supplier = this.draft();
    this.ui.confirm(
      { title: 'Leverancier verwijderen', message: `<b>${escapeHtml(supplier.name)}</b> verwijderen?`,
        confirmLabel: 'Verwijderen', danger: true },
      async () => {
        try {
          await this.sourcing.deleteSupplier(supplier.id!);
          this.editing.set(false);
          await this.load();
          this.ui.toast('Leverancier verwijderd');
        } catch (failure: unknown) {
          this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
        }
      });
  }

  private withAddressDefaults(supplier: Supplier): Supplier {
    return {
      ...supplier,
      addressLine1: supplier.addressLine1 ?? null,
      addressLine2: supplier.addressLine2 ?? null,
      postalCode: supplier.postalCode ?? null,
      region: supplier.region ?? null,
    };
  }
}
