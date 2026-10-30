import { capitalize, customerReading, otherBasisPrice, productSalesUnit, salesQuantityDetail, salesSetupText } from './product-sales-unit';
import { effectiveOrderStep, orderStepSentence } from './product-order-step';
import { ProductCostHistory } from './product-cost-history';
import { ProductChannelPrice } from './product-channel-price';
import { StockMovementSource } from './stock-movement-source';
import { looseStockText, stockAmountText, stockMovementDelta } from './stock-quantity';
import { ProductCostHistorySheet } from './product-cost-history-sheet';
import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, signal, viewChild, ViewEncapsulation } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { ProductSupplierAgreementApi, type ProductSupplierAgreement } from '../../core/api/product-supplier-agreement-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { AuthImage } from '../../core/api/auth-image';
import { PhotoLightbox } from '../../shared/photo-lightbox';
import { Category, StockLevel, Product, ProductCostHistoryEntry, ProductFamily, ProductPhotoOverview, ProductSupplierAgreementPhoto, PurchaseOrderView, ReceiptIssue, StockMovement, Supplier, ProductStock, ExpectedStock } from '../../core/api/models';
import { salesPhoto } from '../../shared/sales-photo';
import { photoKeyForProductPhoto, placeCards, resolvedPlaces, tileUses, variantShortLabel } from './product-photos-state';
import { ProductPlaceLine, ProductPlacesLine } from './product-places-line';
import { appliedParts, costBuild, impliedDutyPct, liveParts, type CostBuild, type CostDriftNotice, type PriceRow } from './product-price-build';
import { costQuantity, costWords, entryCostBasis, productCostBasis, sameCostBasis } from './product-cost-basis';

/** The stored cost explained and the road on to the catalogue price; today's container calculation apart, with the drift. */
interface PriceBuild { rows: PriceRow[]; source: string | null; live: CostBuild['live']; drift: CostDriftNotice | null; }
import { IosNav } from '../../shared/ios-nav';
import { ContextMenu, type ContextMenuItem } from '../../shared/context-menu';
import type { HostActionEvent, HostPageInput } from '../../core/platform/host-bridge';
import { menuRows } from '../../shared/host-page';
import { NavHistory } from '../../core/platform/nav-history-service';
import { capsuleLabel } from '../../core/platform/return-label';
import { colourHexOf } from '../purchasing/purchase-desk-format';
import { groupPublicationIssues } from './publication-groups';
import { Icon } from '../../shared/icon';
import {
  productCatalogNavigation,
  productVariantOptionLabel,
} from './product-variant-navigation';
import { autoCartonWeightKg, autoPiecesPerCarton } from './carton-auto';
import { gpCapacityHint, isAutoGpCapacity, readGpCapacity } from './carton-capacity';
import { Skeleton } from '../../shared/skeleton';
import { Sheet, Ui } from '../../shared/ui';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import { CbmPipe, CurPipe, DateNlPipe, DateTimeNlPipe, EurPipe, NumPipe, KgPipe } from '../../shared/pipes';
import { ProductMediaCard } from './product-media-card';
import { ProductSupplierAgreementPhotoViewer } from './product-supplier-agreement-photo-viewer';
import { orderedSupplierAgreementPhotos } from './product-supplier-agreement-state';
import { parseSupplierNote } from './supplier-note';
import { receivedContainersFor, type ReceivedContainer } from './received-containers';
import { LoadError, LOAD_ERROR_FALLBACK } from '../../shared/load-error';
import { containerOptionLabel, type BookingKind, type BookingLevel } from './stock-booking';
import { StockBookingSheet, type StockBooked } from './stock-booking-sheet';
import type { ProductSupplierRow } from '../../core/api/product-supplier-models';
import { StockBatchApi } from '../../core/api/stock-batch-api';
import type { ProductStockBatches, StockBatch } from '../../core/api/stock-batch-models';
import { batchFormat, eurText } from '../../core/api/stock-batch-units';
import {
  agreementSupplierChoices, issueSupplierName, otherActiveCount, sortSupplierRows, supplierRowHistory, supplierRowMeta,
} from './product-suppliers';
import {
  batchCostParts, batchCostText, batchesHelper, batchesNote, batchesTotal, batchRowTitle, batchSub, batchTags, batchTitle, partnerFoot, showBatches, splitBatches,
} from './product-batches';
import { ProductBatchSheet } from './product-batch-sheet';

/** Desk and phone name the same section differently; a link for one screen still lands on the other. */
const SECTION_ALIASES: Record<string, string> = {
  'pd-batches': 'product-batches', 'product-batches': 'pd-batches',
  'pd-suppliers': 'product-suppliers', 'product-suppliers': 'pd-suppliers',
};

/**
 * Read-first product master. The page deliberately separates the customer
 * story (photo, price, availability) from operational data. Editing remains
 * an explicit action, so a warehouse or sales colleague can safely browse it.
 */

export type { ReceivedContainer } from './received-containers';

@Component({
  selector: 'app-product-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [KgPipe, Skeleton, ProductCostHistory, ProductCostHistorySheet, ProductChannelPrice, StockMovementSource, RouterLink, NgTemplateOutlet, AuthImage, PhotoLightbox, ProductSupplierAgreementPhotoViewer, ProductMediaCard,
    ProductPlacesLine, IosNav, ContextMenu, Icon, Sheet, LoadError, StockBookingSheet, ProductBatchSheet, CbmPipe, CurPipe, DateNlPipe, DateTimeNlPipe, EurPipe, NumPipe,
  ],
  template: `
    @if (product(); as product) {
      <!-- The phone product page on the kit's iOS bar, like the phone purchase order: the page root carries
           the bar and every sheet host as direct children (N3), so the shell's push/pop never moves them. -->
      <div class="ios-page pd-phone">
        <app-ios-nav [title]="product.name" [customLarge]="true" [backLabel]="backText()" [backAriaLabel]="'Terug naar ' + backName()" (back)="goBack()"
                     [host]="hostPage()" (hostAction)="hostAction($event)">
          <span trail class="ios-glass-group">
            <!-- Condensed, Bewerken becomes a circle so the small title keeps its room. -->
            @if (barCondensed()) {
              <a class="ios-circle" [routerLink]="['/products', product.id, 'edit']" aria-label="Bewerken" title="Bewerken"><app-icon name="pencil" [size]="19" /></a>
            } @else {
              <a class="ios-capsule pph-edit" [routerLink]="['/products', product.id, 'edit']">Bewerken</a>
            }
            <button class="ios-circle" type="button" aria-label="Meer acties" aria-haspopup="dialog" [attr.aria-expanded]="moreMenu()" (click)="moreMenu.set(true)"><app-icon name="more" [size]="20" /></button>
          </span>
          <section hero class="pph-card" id="product-overview" tabindex="-1" aria-labelledby="product-title">
            <div class="pph-top">
              <div class="pph-photo-col">
                @let photos = galleryPhotos();
                @if (photos[galleryIndex()] || photos[0]; as photo) {
                  <button class="pph-photo" type="button" (click)="openCurrentGalleryPhoto()"
                          (pointerdown)="startGallerySwipe($event, photos.length)" (pointerup)="finishGallerySwipe($event, photos.length)" (pointercancel)="cancelGallerySwipe()"
                          (keydown.arrowleft)="stepGallery(-1, photos.length); $event.preventDefault()" (keydown.arrowright)="stepGallery(1, photos.length); $event.preventDefault()"
                          aria-keyshortcuts="ArrowLeft ArrowRight" [attr.aria-label]="'Foto ' + (galleryIndex() + 1) + ' van ' + photos.length + (currentSlideBadges().length ? ' (' + currentSlideBadges().join(', ') + ')' : '') + ' vergroten'">
                    <img [appAuthSrc]="photo.mediumUrl || photo.url" appAuthSize="medium" [alt]="product.name + ' — foto ' + (galleryIndex() + 1)" draggable="false" />
                    <span class="pph-photo__count">{{ galleryIndex() + 1 }} / {{ photos.length }} <span aria-hidden="true">⤢</span></span>
                  </button>
                  @if (currentSlideBadges().length) { <span class="pph-badges">{{ currentSlideBadges().join(' · ') }}</span> }
                  <span class="sr-only" role="status" aria-live="polite">Foto {{ galleryIndex() + 1 }} van {{ photos.length }}</span>
                } @else {
                  <span class="pph-photo pph-photo--empty" aria-hidden="true"><app-icon name="media" [size]="28" /></span>
                }
              </div>
              <div class="pph-id">
                <div class="pph-status">
                  <span class="wk-pill" [class.tone-ok]="product.active && !product.demo" [class.tone-warn]="!product.active || product.demo">{{ product.active ? (product.demo ? 'Demo' : 'Actief') : 'Inactief' }}</span>
                  @if (categoryName(); as category) { <span class="pph-cat">{{ category }}</span> }
                </div>
                <h1 id="product-title" class="pph-title">{{ product.name }}</h1>
                @if (product.colour || product.variantSize) {
                  <p class="pph-opt">@if (dotColour(product.colourHex, product.colour); as hex) { <i [style.background]="hex" aria-hidden="true"></i> }{{ product.colour }}@if (product.colour && product.variantSize) { · }{{ product.variantSize }}</p>
                }
                @if (product.sku) { <p class="pph-sku">{{ product.sku }}</p> }
                @if (supplierName(); as name) {
                  <span class="pph-supplier-line"><a class="pph-supplier" [routerLink]="['/suppliers']" [queryParams]="{ q: name }">{{ name }} ›</a>
                    @if (otherSuppliers(); as more) { <button class="linklike pph-supplier-more" type="button" (click)="scrollToDetailSection('product-suppliers')" [attr.aria-label]="more + ' andere leverancier' + (more === 1 ? '' : 's')">+{{ more }}</button> }</span>
                }
                @if (publicName(); as name) { <p class="pph-pub">Op de website: {{ name }}</p> }
              </div>
            </div>
            @if (variantMembers().length > 1) {
              <p class="pph-series">Reeks · {{ variantMembers().length }} kleuren</p>
              <div class="pph-variants" #variantRail role="list" aria-label="Kleuren in deze reeks">
                @for (member of variantMembers(); track member.productId) {
                  @let total = memberStock(member.productId);
                  @if (member.productId === product.id) {
                    <span class="pph-variant now" role="listitem" aria-current="page">@if (dotColour(member.colourHex, member.colour); as hex) { <i [style.background]="hex" aria-hidden="true"></i> }{{ variantOptionLabel(member) }}@if (total !== null) { <b>{{ total | num }}</b> }</span>
                  } @else {
                    <a class="pph-variant" role="listitem" [class.off]="!member.active" [routerLink]="['/products', member.productId]">@if (dotColour(member.colourHex, member.colour); as hex) { <i [style.background]="hex" aria-hidden="true"></i> }{{ variantOptionLabel(member) }}@if (total !== null) { <b>{{ total | num }}</b> }</a>
                  }
                }
              </div>
            } @else if (familyLoadError()) {
              <p class="pph-variant-error" role="alert">Varianten niet geladen. <button class="linklike" type="button" (click)="retryFamily()">Opnieuw proberen</button></p>
            }
            <div class="pph-figs">
              <button type="button" (click)="scrollToStock()">
                <small>Voorraad</small>
                @if (stockLevels()) { <strong [class.is-bad]="stockTotal() < 0">{{ stockTotal() | num }}<em>{{ unitFor(product, stockTotal()) }}</em></strong>@if (stockLooseTotal()) { <span>+ {{ looseText(stockLooseTotal(), product) }}</span> }<span>@for (part of locationLine(); track $index) {@if (!$first) { · }<span class="pph-nw">{{ part }}</span>}</span> }
                @else if (product.inventoryKnown) { <strong>{{ product.stockQuantity | num }}<em>{{ unitFor(product, product.stockQuantity) }}</em></strong><span>in voorraad</span> }
                @else { <strong>—</strong><span>nog niet bevestigd</span> }
              </button>
              <button type="button" (click)="openPriceInfo(product)">
                <small>Catalogusprijs</small>
                @if (displayPrice(); as price) {
                  <strong>{{ price | eur: 2 }}</strong>
                  <span>per {{ salesUnit(product).singular }}@if (otherPrice(product, price); as other) { · {{ other.text }}}</span>
                } @else { <strong>—</strong><span>nog geen prijs</span> }
              </button>
              <button type="button" (click)="openHistory()">
                <small>Kostprijs ›</small>
                @if (product.landedCostEur; as landed) { <strong>{{ landed | eur: 2 }}</strong> } @else { <strong>—</strong> }
                <span>@if (product.landedCostSource; as source) { geland · <span class="pph-nw">{{ source }}</span> } @else { incl. transport en rechten }</span>
                @if (driftNotice(); as drift) { <span class="pph-drift">nu {{ drift.unitEur | eur: 2 }} in <span class="pph-nw">{{ drift.orderNumber }}</span></span> }
              </button>
              <button type="button" [class.ok]="(margin()?.eur ?? 0) >= 0" [class.bad]="(margin()?.eur ?? 0) < 0" (click)="openPriceInfo(product)">
                <small>Marge</small>
                @if (margin(); as value) { <strong>{{ value.eur | eur: 2 }}</strong><span>{{ value.pct }} % van de prijs</span> }
                @else { <strong>—</strong><span>kostprijs of prijs ontbreekt</span> }
              </button>
            </div>
          </section>
        </app-ios-nav>

        @if (expected(); as exp) {
          <a class="pph-onway" [routerLink]="['/purchasing', exp.orderIds[0]]" [attr.title]="'Open ' + exp.orderNumbers.join(', ')">
            <span>+{{ exp.quantity | num }} {{ unitFor(product, exp.quantity) }} onderweg</span>
            <small>@for (order of exp.orderNumbers; track order) {@if (!$first) {, }<span class="pph-nw">{{ order }}</span>}{{ exp.expectedArrival ? ' · verwacht ' + (exp.expectedArrival | dateNl) : '' }} ›</small>
          </a>
        }

        <!-- 1 · what customers see for this colour -->
        <section class="ios-section" aria-labelledby="pph-places-title">
          <div class="ios-section__head"><h2 id="pph-places-title">{{ placeLine()?.heading || 'Foto’s' }}</h2></div>
          <div class="ios-group pph-group pph-places">
            @if (galleryPhotos().length) {
              @if (placeLine(); as line) { <app-product-places-line class="pph-places__line" [line]="line" /> }
              <div class="pph-places__actions"><a class="btn btn--sm pd-photo-manage" [routerLink]="['/products', product.id, 'edit']" [queryParams]="{ tab: 'media' }">Foto’s beheren</a></div>
            } @else {
              <div class="pph-nophoto"><span>Nog geen foto</span>
                <a class="btn btn--sm" [routerLink]="['/products', product.id, 'edit']" [queryParams]="{ tab: 'media' }">Foto’s toevoegen</a></div>
            }
          </div>
        </section>

        <!-- 2 · Voorraad -->
        <section class="ios-section" id="stock-card" aria-labelledby="stock-card-title">
          <div class="ios-section__head"><h2 id="stock-card-title">Voorraad</h2>
            @if (stockLevels()) { <span class="ios-section__trail">{{ stockAmount({quantity: stockTotal(), loosePieces: stockLooseTotal()}, product) }}</span> }</div>
          <div class="ios-group">
            @if (stockLevels(); as levels) {
              @for (level of levels; track level.locationId) {
                <button class="ios-cell" type="button" (click)="openBooking('RECOUNT', level.locationId)" [attr.aria-label]="'Hertelling op ' + level.name">
                  <span class="ios-cell__body"><span class="ios-cell__title">{{ level.name }}</span>
                    <span class="ios-cell__sub">{{ level.kindLabel }} · {{ level.countsForWebsite ? 'alle verkoopkanalen' : 'enkel ter plaatse' }}</span></span>
                  <span class="ios-cell__value num" [class.pph-zero]="!level.quantity && !level.loosePieces">{{ stockAmount(level, product) }}</span>
                  <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                </button>
              }
              <button class="ios-cell ios-cell--action" type="button" (click)="openBooking('RECOUNT')">Voorraad boeken…</button>
            } @else {
              <app-skeleton kind="group" [rows]="2" />
            }
          </div>
        </section>

        <!-- 2b · Batches: only after the start; the oldest goes out first -->
        @if (shownBatches(); as data) {
          <section class="ios-section" id="product-batches" aria-labelledby="pph-batches-title">
            <div class="ios-section__head"><h2 id="pph-batches-title">Batches</h2><span class="ios-section__trail">{{ batchesTotalValue() | eur: 0 }}</span></div>
            <div class="ios-group">
              @for (b of batchLists().active; track b.id) {
                <ng-container *ngTemplateOutlet="phoneBatch; context: { $implicit: b }" />
              }
              @if (batchLists().empty.length; as sold) {
                <button class="ios-cell ios-cell--action" type="button" [attr.aria-expanded]="emptyBatchesOpen()" (click)="emptyBatchesOpen.set(!emptyBatchesOpen())">Uitverkochte batches ({{ sold }})</button>
                @if (emptyBatchesOpen()) {
                  @for (b of batchLists().empty; track b.id) {
                    <ng-container *ngTemplateOutlet="phoneBatch; context: { $implicit: b }" />
                  }
                }
              }
            </div>
            @if (batchNote(); as note) { <p class="ios-section__foot is-warn">{{ note }}</p> }
            @else if (batchFoot(); as foot) { <p class="ios-section__foot">{{ foot }}</p> }
          </section>
        }
        <ng-template #phoneBatch let-b>
          <button class="ios-cell pph-batch" type="button" [title]="batchRowText(b)" (click)="batchSheet.set(b)">
            <span class="ios-cell__body">
              <span class="ios-cell__title pph-batch__title"><span class="pph-batch__name">{{ batchName(b) }}</span>@for (tag of batchTagsOf(b); track tag) {<i class="pph-batch-tag">{{ tag }}</i>}</span>
              <span class="ios-cell__sub">{{ batchSubOf(b) }}</span>
            </span>
            @let cost = batchCostPartsOf(b);
            <span class="ios-cell__trail"><span class="ios-cell__value num" [class.is-warn]="b.stale">{{ cost.cost }}</span>
              @if (cost.now) { <span class="ios-cell__meta num is-warn">{{ cost.now }}</span> }</span>
            <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
          </button>
        </ng-template>

        <!-- 3 · Laatste bewegingen -->
        @if (recentMoves(); as moves) {
          <section class="ios-section" aria-labelledby="pph-moves-title">
            <div class="ios-section__head"><h2 id="pph-moves-title">Laatste bewegingen</h2>
              @if (!allMovesOpen() && hiddenMoves() > 0) { <button class="ios-section__link" type="button" (click)="allMovesOpen.set(true)">Alle ({{ hiddenMoves() + 3 }})</button> }</div>
            <div class="ios-group">
              @for (move of moves; track move.id) {
                <div class="ios-cell pph-move">
                  <span class="ios-cell__body"><span class="ios-cell__title" [title]="move.kindLabel + (move.reference ? ' · ' + move.reference : '')">{{ move.kindLabel }}@if (move.reference) { · {{ move.reference }}}</span>
                    <span class="ios-cell__sub">{{ move.at | dateTimeNl }}@if (move.actor) { · {{ move.actor }}}@if (move.locationName) { · {{ move.locationName }}}</span><app-stock-movement-source [move]="move" /></span>
                  <span class="pph-delta" [class.minus]="move.delta * (move.unitPieces || 1) + (move.looseDelta || 0) < 0">{{ moveDelta(move, product) }}</span>
                </div>
              } @empty {
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__sub">Nog geen voorraadbewegingen.</span></span></div>
              }
            </div>
          </section>
        }

        <!-- 4 · Prijs & marge -->
        <section class="ios-section" id="product-core" aria-labelledby="pph-price-title">
          <div class="ios-section__head"><h2 id="pph-price-title">Prijs &amp; marge</h2><button class="ios-section__link" type="button" (click)="openPriceInfo(product)">Opbouw</button></div>
          <div class="ios-group">
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">EXW-prijs</span><span class="ios-cell__sub">{{ otherSuppliers() && supplierName() ? 'voorkeur · ' + supplierName() : 'fabrieksprijs' }}</span></span>
              <span class="ios-cell__value num">@if (product.exwPrice; as price) { {{ price | cur: product.exwCurrency }} } @else { — }</span></div>
            @if (product.extraUnitCost; as extra) {
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Extra kost</span><span class="ios-cell__sub">per {{ salesUnit(product).singular }}, bv. display of giftbox</span></span>
                <span class="ios-cell__value num">{{ extra | cur: product.exwCurrency }}</span></div>
            }
            <button class="ios-cell" type="button" (click)="openHistory()">
              <span class="ios-cell__body"><span class="ios-cell__title">Kostprijs</span><span class="ios-cell__sub pph-wrap">@if (product.landedCostSource; as source) { geland · <span class="pph-nw">{{ source }}</span> · historiek } @else { incl. transport en rechten · historiek }</span>@if (driftNotice(); as drift) {<span class="ios-cell__sub pph-wrap pph-drift">nu {{ drift.unitEur | eur: 2 }} in <span class="pph-nw">{{ drift.orderNumber }}</span></span>}</span>
              <span class="ios-cell__value num">@if (product.landedCostEur; as landed) { {{ landed | eur: 2 }} } @else { — }</span>
              <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
            </button>
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Prijsregel</span></span>
              <span class="ios-cell__value">{{ hasFixedSalesPrice(product) ? 'Vaste prijs' : '+ ' + (product.markupPct | num) + ' %' }}</span></div>
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Catalogusprijs</span>
                <span class="ios-cell__sub">per {{ salesUnit(product).singular }} · {{ hasFixedSalesPrice(product) ? 'vaste prijs' : '+ ' + (product.markupPct | num) + ' % op de kostprijs' }}</span></span>
              <span class="ios-cell__value ios-cell__value--strong num">@if (displayPrice(); as price) { {{ price | eur: 2 }} } @else { — }</span></div>
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Bestellen</span><span class="ios-cell__sub pph-wrap">{{ orderStepSentence(product) }}</span></span></div>
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Marge</span></span>
              @if (margin(); as value) { <span class="ios-cell__value num" [class.pph-ok]="value.eur >= 0" [class.pph-bad]="value.eur < 0">{{ value.eur | eur: 2 }} · {{ value.pct }} %</span> }
              @else { <span class="ios-cell__value">—</span> }</div>
          </div>
          <p class="ios-section__foot">Prijzen excl. btw</p>
          <app-product-channel-price [product]="product" />
        </section>

        <!-- 4b · Leveranciers: the Voorkeur first, each supplier with its own EXW price -->
        @if (supplierRows().length) {
          <section class="ios-section" id="product-suppliers" aria-labelledby="pph-suppliers-title">
            <div class="ios-section__head"><h2 id="pph-suppliers-title">Leveranciers</h2>
              <a class="ios-section__link" [routerLink]="['/products', product.id, 'edit']" [queryParams]="{ tab: 'purchasing' }">Bewerk</a></div>
            <div class="ios-group">
              @for (row of activeSupplierRows(); track row.id) {
                <ng-container *ngTemplateOutlet="phoneSupplier; context: { $implicit: row }" />
              }
              @if (inactiveSupplierRows().length; as off) {
                <button class="ios-cell ios-cell--action" type="button" [attr.aria-expanded]="inactiveSuppliersOpen()" (click)="inactiveSuppliersOpen.set(!inactiveSuppliersOpen())">
                  <span class="ios-cell__body">{{ off }} inactief</span><app-icon class="ios-cell__chev pph-fold" [class.open]="inactiveSuppliersOpen()" name="chevron-right" [size]="16" /></button>
                @if (inactiveSuppliersOpen()) {
                  @for (row of inactiveSupplierRows(); track row.id) {
                    <ng-container *ngTemplateOutlet="phoneSupplier; context: { $implicit: row }" />
                  }
                }
              }
            </div>
          </section>
        }
        <ng-template #phoneSupplier let-row>
          <div class="ios-cell pph-sup" [class.pph-sup--off]="!row.active">
            <span class="ios-cell__body">
              <span class="ios-cell__title pph-sup__title"><span class="pph-sup__name">{{ row.supplierName }}</span>@if (row.preferred) {<i class="wk-pill tone-accent">Voorkeur</i>} @else if (!row.active) {<i class="wk-pill">Inactief</i>}</span>
              @if (supplierPhoneSub(row); as sub) { <span class="ios-cell__sub">{{ sub }}</span> }
            </span>
            <span class="ios-cell__trail">
              <span class="ios-cell__value num">{{ supplierExw(row) }}</span>
              @if (supplierTrail(row); as trail) { <span class="ios-cell__meta num">{{ trail }}</span> }
            </span>
          </div>
        </ng-template>

        <!-- 5 · Website & publicatie, read-only (B14) -->
        <section class="ios-section" id="product-publication" aria-labelledby="pph-web-title">
          <div class="ios-section__head"><h2 id="pph-web-title">Website &amp; publicatie</h2></div>
          @if (familyLoading()) {
            <app-skeleton kind="group" [rows]="2" />
          } @else if (familyLoadError()) {
            <div class="ios-group">
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Publicatiestatus niet geladen</span></span>
                <button class="ios-capsule ios-capsule--sm ios-capsule--tinted" type="button" (click)="retryFamily()">Opnieuw proberen</button></div>
            </div>
          } @else {
            <div class="ios-group">
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Website</span></span>
                <span class="ios-cell__value pph-live" [class.on]="publicationActive() && websiteStatus() === 'PUBLISHED'">{{ publicationActive() && websiteStatus() === 'PUBLISHED' ? '● Live' : 'Niet live' }}</span></div>
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Orderapp</span></span>
                <span class="ios-cell__value pph-live" [class.on]="publicationActive() && orderAppStatus() === 'PUBLISHED'">{{ publicationActive() && orderAppStatus() === 'PUBLISHED' ? '● Live' : 'Niet live' }}</span></div>
              @if (family(); as family) {
                <div class="ios-cell ios-cell--tall"><span class="ios-cell__body"><span class="ios-cell__sub">Publieke naam</span><span class="ios-cell__title pph-wrap">{{ family.name }}</span></span></div>
              }
              <div class="ios-cell ios-cell--tall"><span class="ios-cell__body"><span class="ios-cell__sub">Publieke URL</span><span class="ios-cell__title pph-wrap mono">@if (publicHandle(); as handle) { /products/{{ handle }} } @else { nog geen }</span></span></div>
              @if (publicationIssues().length; as open) {
                <details class="ios-disclosure">
                  <summary><span class="pph-warn">{{ open }} punt{{ open === 1 ? '' : 'en' }} open</span><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></summary>
                  <div class="ios-disclosure__body pph-points">
                    @for (group of publicationGroups(); track group.key) {
                      <div class="pph-points__group"><b>{{ group.label }}</b>
                        <ul>@for (issue of group.issues; track issue) { <li>{{ issue }}</li> }</ul></div>
                    }
                  </div>
                </details>
              }
            </div>
            <p class="ios-section__foot">Publicatie wijzig je op de computer: Bewerken › Website &amp; orderapp.</p>
          }
        </section>

        <!-- 6 · Product -->
        <section class="ios-section" aria-labelledby="pph-product-title">
          <div class="ios-section__head"><h2 id="pph-product-title">Product</h2></div>
          <div class="ios-group">
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Afmeting</span><span class="ios-cell__sub">B × D × H</span></span><span class="ios-cell__value num">{{ size(product.dimensions) }}</span></div>
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Gewicht</span><span class="ios-cell__sub">per {{ salesUnit(product).piece.one }}</span></span><span class="ios-cell__value num">{{ product.dimensions.weightKg ? (product.dimensions.weightKg | kg) : '—' }}</span></div>
            @if (product.barcodeInner; as code) {
              <button class="ios-cell" type="button" [title]="'Barcode-afbeelding (300 dpi) van ' + code" (click)="downloadBarcode(code)">
                <span class="ios-cell__body"><span class="ios-cell__title">Barcode stuk</span><span class="ios-cell__sub">tik voor de afbeelding</span></span><span class="ios-cell__value mono">{{ code }}</span></button>
            } @else {
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Barcode stuk</span></span><span class="ios-cell__value">—</span></div>
            }
            @if (product.packaging.kind !== 'NONE') {
              <div class="ios-cell ios-cell--tall"><span class="ios-cell__body"><span class="ios-cell__title">{{ product.packaging.kind === 'DISPLAY' ? 'Display' : 'Geschenkdoosje' }}</span>
                <span class="ios-cell__sub pph-wrap">{{ product.packaging.dimensions.weightKg ? (product.packaging.dimensions.weightKg | kg) : 'gewicht onbekend' }}@if (product.packaging.piecesPerUnit) { · {{ product.packaging.piecesPerUnit | num }} {{ salesUnit(product).piece.other }}{{ product.packaging.kind === 'DISPLAY' ? ' per display' : '' }} }</span></span>
                <span class="ios-cell__value num">{{ size(product.packaging.dimensions) }}</span></div>
              @if (product.packaging.barcode; as code) {
                <button class="ios-cell" type="button" [title]="'Barcode-afbeelding (300 dpi) van ' + code" (click)="downloadBarcode(code)">
                  <span class="ios-cell__body"><span class="ios-cell__title">Barcode verpakking</span></span><span class="ios-cell__value mono">{{ code }}</span></button>
              }
            }
            @let setup = salesSetup(product);
            <div class="ios-cell ios-cell--tall"><span class="ios-cell__body"><span class="ios-cell__sub">Verkoop</span><span class="ios-cell__title pph-wrap">{{ setup.sentence }}</span>
              <span class="ios-cell__sub pph-wrap">Klant leest: {{ setup.reading.main }} · {{ setup.reading.detail }}</span></span></div>
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">HS-code</span></span><span class="ios-cell__value mono">{{ product.hsCode || '—' }}</span></div>
            @if (product.description) {
              <details class="ios-disclosure">
                <summary>Omschrijving<app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></summary>
                <div class="ios-disclosure__body"><p class="pph-prose">{{ product.description }}</p></div>
              </details>
            }
          </div>
        </section>

        <!-- 7 · Omdoos -->
        <section class="ios-section" id="product-packaging" aria-labelledby="pph-carton-title">
          <div class="ios-section__head"><h2 id="pph-carton-title">Omdoos</h2></div>
          <div class="ios-group">
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Karton</span><span class="ios-cell__sub">B × D × H</span></span><span class="ios-cell__value num">{{ size(product.carton) }}</span></div>
            <div class="ios-cell ios-cell--tall"><span class="ios-cell__body"><span class="ios-cell__title">Inhoud</span><span class="ios-cell__sub">{{ cartonPiecesAuto(product) ? 'auto' : 'handmatig' }}</span></span>
              <span class="ios-cell__trail"><span class="ios-cell__value num">{{ product.carton.piecesPerCarton | num }} {{ salesUnit(product).plural }}</span>
                @if (quantityDetail(product, product.carton.piecesPerCarton ?? 0); as detail) { <span class="ios-cell__meta pph-wrap">{{ detail }}</span> }</span></div>
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Gewicht</span><span class="ios-cell__sub">{{ product.carton.weightKg && cartonWeightAuto(product) ? 'auto' : 'handmatig' }}</span></span>
              <span class="ios-cell__value num">@if (product.carton.weightKg) { {{ product.carton.weightKg | kg }} } @else { — }</span></div>
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Volume</span>@if (product.pieceCbm) { <span class="ios-cell__sub">{{ product.pieceCbm | cbm: 5 }} per {{ salesUnit(product).singular }}</span> }</span>
              <span class="ios-cell__value num">@if (product.cartonCbm) { {{ product.cartonCbm | cbm }} } @else { — }</span></div>
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Per 20ft GP</span>@if (gpCapacity().value !== null) { <span class="ios-cell__sub" [title]="gpCapacityHint(gpCapacity(), product.carton)">{{ isAutoGpCapacity(gpCapacity()) ? 'Auto' : 'handmatig' }}</span> }</span>
              <span class="ios-cell__value num">@if (gpCapacity().value !== null) { {{ gpCapacity().value | num }} {{ salesUnit(product).plural }} } @else { — }</span></div>
            <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Per 40' HC</span>@if (product.carton.hcCapacity) { <span class="ios-cell__sub">{{ product.carton.piecesPerHc ? 'handmatig' : 'auto' }}</span> }</span>
              <span class="ios-cell__value num">@if (product.carton.hcCapacity; as hc) { {{ hc | num }} {{ salesUnit(product).plural }} } @else { — }</span></div>
            @if (product.barcodeOuter; as code) {
              @if (code.length === 13) {
                <button class="ios-cell" type="button" [title]="'Barcode-afbeelding (300 dpi) van ' + code" (click)="downloadBarcode(code)">
                  <span class="ios-cell__body"><span class="ios-cell__title">Omdoosbarcode</span></span><span class="ios-cell__value mono">{{ code }}</span></button>
              } @else {
                <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Omdoosbarcode</span></span><span class="ios-cell__value mono">{{ code }}</span></div>
              }
            } @else {
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">Omdoosbarcode</span></span><span class="ios-cell__value">—</span></div>
            }
          </div>
        </section>

        <!-- 8 · Documenten -->
        @if (product.id !== null) {
          <section class="ios-section" aria-label="Documenten">
            <app-product-media-card class="ios-group pph-media" id="product-media" [productId]="product.id" [compact]="true" />
          </section>
        }

        <!-- 9 · Afspraken leverancier, closed by default (open from #product-agreements) -->
        <section class="ios-section" aria-labelledby="pph-agreements-title">
          <div class="ios-section__head"><h2 id="pph-agreements-title">Afspraken leverancier</h2>
            @if (product.id !== null) { <a class="ios-section__link" [routerLink]="['/products', product.id, 'edit']" [queryParams]="{ tab: 'agreements' }">Bewerk</a> }</div>
          <div class="ios-group">
            @if (agreementChoices().length) {
              <label class="ios-cell pph-agree-pick"><span class="ios-cell__body"><span class="ios-cell__title">Leverancier</span></span>
                <select class="pph-agree-select" id="pph-agreement-supplier" (change)="selectAgreementSupplier($any($event.target).value)">
                  @for (choice of agreementChoices(); track choice.id) {
                    <option [value]="choice.id" [selected]="choice.id === shownAgreementSupplierId()">{{ choice.label }}</option>
                  }
                </select></label>
            }
            <details class="ios-disclosure" id="product-agreements" [open]="agreementsOpenAtStart">
              <summary><span class="pph-wrap">Engelse instructies · {{ agreementPhotos().length }} referentiefoto’s</span><app-icon class="ios-cell__chev" name="chevron-right" [size]="16" /></summary>
              <div class="ios-disclosure__body pph-agreement">
                <p class="pph-private" role="note"><b>Alleen leverancier</b> · Nooit online of in de websitegalerij</p>
                @if (supplierAgreement(); as agreement) {
                  @if (!agreement.available) {
                    <p class="pph-muted" role="note">{{ !product.supplierId ? 'Kies eerst een leverancier via Bewerken om afspraken vast te leggen.' : agreement.inherited ? 'Deze gedeelde afspraak past niet meer bij de leverancier of productreeks. Controleer de koppeling via Bewerken.' : 'De leveranciersafspraak is niet beschikbaar. Controleer de leverancier via Bewerken.' }}</p>
                  } @else if (agreement.variants.length > 1) {
                    <p class="pph-scope"><b>Gedeelde afspraak</b> · {{ agreementVariantNames() }}
                      @if (agreement.inherited) { <a [routerLink]="['/products', agreement.sourceProductId]" fragment="product-agreements">Bronproduct bekijken ›</a> }</p>
                  }
                }
                @if (supplierNoteBlocks().length) {
                  <div class="pph-note" lang="en">
                    @for (block of supplierNoteBlocks(); track $index) {
                      @if (block.kind === 'p') {
                        <p>{{ block.text }}</p>
                      } @else {
                        <ul>
                          @for (item of block.items; track $index) {
                            <li>{{ item.text }}
                              @if (item.children.length) { <ul>@for (sub of item.children; track $index) { <li>{{ sub }}</li> }</ul> }
                            </li>
                          }
                        </ul>
                      }
                    }
                  </div>
                }
                @if (agreementLoading()) {
                  <app-skeleton kind="lines" [rows]="2" />
                } @else if (agreementLoadError(); as agreementError) {
                  <p class="pph-muted" role="alert">{{ agreementError }} <button class="linklike" type="button" (click)="retrySupplierAgreement()">Opnieuw proberen</button></p>
                } @else if (agreementPhotos().length) {
                  <ol class="pph-refs" aria-label="Afspraakfoto’s in PDF-volgorde">
                    @for (photo of agreementPhotos(); track photo.id; let i = $index) {
                      <li><button type="button" (click)="agreementLightbox.set(i)" [attr.aria-label]="'Afspraakfoto ' + (i + 1) + ' vergroten'">
                        <img [appAuthSrc]="photo.viewUrl" [alt]="photo.caption || photo.originalFilename" loading="lazy" /><span>Reference {{ i + 1 }}</span></button>
                        @if (photo.caption) { <p lang="en">{{ photo.caption }}</p> }</li>
                    }
                  </ol>
                } @else if (!supplierNoteBlocks().length && supplierAgreement()?.available !== false) {
                  <p class="pph-muted">Nog geen productspecifieke afspraken voor deze leverancier.</p>
                }
              </div>
            </details>
          </div>
        </section>

        <!-- 10 · Eerder schade of tekort -->
        @if (receiptIssues().length) {
          <section class="ios-section" id="product-issues" aria-labelledby="product-issues-title">
            <div class="ios-section__head"><h2 id="product-issues-title">Eerder schade of tekort</h2></div>
            <div class="ios-group">
              @for (issue of receiptIssues(); track issue.orderId) {
                <a class="ios-cell ios-cell--tall" [routerLink]="['/purchasing', issue.orderId]">
                  <span class="ios-cell__body"><span class="ios-cell__title">{{ issue.orderNumber }}@if (issueSupplier(issue); as supplier) { · {{ supplier }}}</span>
                    <span class="ios-cell__sub pph-wrap">{{ issue.receivedOn ? (issue.receivedOn | dateNl) : '—' }} · {{ issue.ordered | num }} besteld · {{ issue.received | num }} ontvangen@if (issue.damaged) { · {{ issue.damaged | num }} beschadigd }@if (issue.missing) { · {{ issue.missing | num }} te weinig }@if (issue.laterDamaged || issue.laterMissing) { · na uitpakken gemeld: @if (issue.laterDamaged) { {{ issue.laterDamaged | num }} beschadigd }@if (issue.laterDamaged && issue.laterMissing) { en }@if (issue.laterMissing) { {{ issue.laterMissing | num }} te weinig } }</span>
                    @if (issue.note) { <span class="ios-cell__sub pph-wrap pph-note-line">{{ issue.note }}</span> }
                    @if (issue.laterNote) { <span class="ios-cell__sub pph-wrap pph-note-line">{{ issue.laterNote }}</span> }</span>
                  <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                </a>
              }
            </div>
          </section>
        }

        <app-photo-lightbox [photos]="galleryPhotos()" [(index)]="lightbox" />
        <app-product-supplier-agreement-photo-viewer [photos]="agreementPhotos()" [(index)]="agreementLightbox" />

        <ng-template #priceBuildTpl>
          <div class="price-build" role="region" aria-label="Prijsopbouw">
            @if (priceBuild(); as build) {
              @if (build.drift; as drift) {
                <p class="price-build__drift" role="note"><b>{{ drift.orderNumber }} rekent nu {{ drift.unitEur | eur: 2 }} {{ drift.per }}</b>@if (drift.basisNote; as note) { ({{ note }})} @else { ({{ drift.up ? '+' : '−' }}&nbsp;{{ drift.absEur | eur: 2 }})} · <a [routerLink]="['/purchasing', drift.orderId]" [queryParams]="{ apply: 1 }">Opnieuw toepassen ›</a></p>
              }
              <dl class="price-build__list">
                @for (row of build.rows; track row.label) {
                  <div [class.price-build__sum]="row.sum" [class.price-build__note]="row.note"
                       [class.price-build__aside]="row.aside">
                    <dt>{{ row.label }}@if (row.hint) { <small>{{ row.hint }}</small> }</dt>
                    <dd class="num">{{ row.eur | eur: 2 }}</dd>
                  </div>
                }
              </dl>
              @if (build.live; as live) {
                <p class="price-build__live">{{ live.title }}</p>
                <dl class="price-build__list">
                  @for (row of live.rows; track $index) {
                    <div [class.price-build__sum]="row.sum"><dt>{{ row.label }}@if (row.hint) { <small>{{ row.hint }}</small> }</dt><dd class="num">{{ row.eur | eur: 2 }}</dd></div>
                  }
                </dl>
              }
              @if (build.source) {
                <p class="price-build__source">Kostprijs toegepast uit <b>{{ build.source }}</b>.</p>
              } @else {
                <p class="price-build__source">Nog geen kostprijs uit een inkoopcalculatie; transport en invoerrechten komen erbij zodra een calculatie is toegepast.</p>
              }
            } @else {
              <app-skeleton kind="lines" [rows]="3" />
            }
          </div>
        </ng-template>

        @if (priceInfoOpen()) {
          <app-sheet [title]="priceTab() === 'history' ? 'Kostprijshistoriek' : 'Prijsopbouw'" variant="ios" (closed)="closePriceInfo()">
            <div body class="pph-sheet">
              <div class="per-toggle price-tabs" role="group" aria-label="Prijsdetail">
                <button type="button" [class.on]="priceTab() === 'build'" (click)="priceTab.set('build')">Opbouw</button>
                <button type="button" [class.on]="priceTab() === 'history'" (click)="priceTab.set('history')">Historiek</button>
              </div>
              @if (priceTab() === 'history') {
                @if (product.id; as id) { <app-product-cost-history [productId]="id" [product]="product" [sourceLink]="historySourceLink()" [preloaded]="costHistoryRows()" [drift]="driftNotice()" /> }
              } @else {
                <ng-container *ngTemplateOutlet="priceBuildTpl" />
              }
            </div>
            <div foot style="display:contents">
              <button class="ios-capsule ios-capsule--block ios-capsule--tinted" type="button" (click)="closePriceInfo()">Sluiten</button>
            </div>
          </app-sheet>
        }

        @if (historyOpen()) {
          <app-product-cost-history-sheet [product]="product" [sourceLink]="historySourceLink()" [preloaded]="costHistoryRows()" [drift]="driftNotice()" (closed)="historyOpen.set(false)" />
        }

        <!-- Voorraad boeken: the one sheet for every booking, at page level. -->
        @if (bookingSheet(); as booking) {
          <app-stock-booking-sheet [product]="product" [levels]="bookingLevels()" [containers]="receivedOrders()"
                                   [kind]="booking.kind" [locationId]="booking.locationId"
                                   (booked)="onBooked($event)" (closed)="bookingSheet.set(null)" />
        }
        @if (batchSheet(); as batch) {
          <app-product-batch-sheet [batch]="batch" [product]="product" (closed)="batchSheet.set(null)" />
        }
        @if (moreMenu()) {
          <app-context-menu title="Product" variant="ios" cancelLabel="Annuleren" [items]="moreItems" (pick)="pickMore($event, product)" (closed)="moreMenu.set(false)" />
        }
      </div>
    } @else if (loadError(); as error) {
      <div class="ios-page pd-phone">
        <app-ios-nav title="Product" [largeTitle]="false" backLabel="" backAriaLabel="Terug" (back)="goBack()" />
        <app-load-error [message]="error" [busy]="reloading()" (retry)="reload()" />
      </div>
    } @else {
      <div class="ios-page pd-phone">
        <app-ios-nav title="Product" [largeTitle]="false" [heroLoading]="true" backLabel="" backAriaLabel="Terug" (back)="goBack()" />
        <div class="pph-loading" role="status" aria-live="polite" aria-label="Product laden">
          <app-skeleton kind="card" [rows]="1" />
          <app-skeleton kind="group" [rows]="4" />
        </div>
      </div>
    }
  `,
  /* The area partial arrives with this screen's lazy chunk; its rules are scoped under app-product-view. */
  styleUrl: '../../../styles/products/_product-phone.scss',
  encapsulation: ViewEncapsulation.None,
})
export class ProductView {
  readonly salesUnit = productSalesUnit;
  /** "= € 35,40 per display van 12" under a price per diamant; "≈ € 4,16 per roos" under a price per display. */
  readonly otherPrice = otherBasisPrice;
  readonly quantityDetail = salesQuantityDetail;
  readonly capitalize = capitalize;

  /** "Je verkoopt diamanten, per 12 in een display. …" and what the customer reads, at the catalogue price. */
  salesSetup(product: Product): { sentence: string; reading: { main: string; detail: string } } {
    const step = effectiveOrderStep(product);
    return {
      sentence: salesSetupText(product, step),
      reading: customerReading(product, this.displayPrice(), product.carton.piecesPerCarton, step),
    };
  }
  /** "Klant bestelt per" as one phrase, for a line of its own: "Klant bestelt per stolp". */
  orderStepSentence(product: Product): string {
    return orderStepSentence(product, productSalesUnit(product));
  }
  readonly lightbox = signal(-1);
  readonly galleryIndex = signal(0);
  readonly agreementLightbox = signal(-1);
  readonly desktop = inject(DesktopViewport);
  private readonly variantRail = viewChild<ElementRef<HTMLElement>>('variantRail');
  private galleryPointer: { id: number; x: number; y: number } | null = null;
  private gallerySuppressClickUntil = 0;

  protected readonly catalog = inject(CatalogApi);
  private readonly supplierAgreementApi = inject(ProductSupplierAgreementApi);
  protected readonly sourcing = inject(SourcingApi);
  private readonly route = inject(ActivatedRoute);
  protected readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly ui = inject(Ui);

  readonly product = signal<Product | null>(null);
  /** The carousel opens on the photo the ERP lists, quotes and invoices show; the others keep their order. */
  readonly galleryPhotos = computed(() => {
    const product = this.product();
    if (!product) return [];
    const first = salesPhoto(product);
    const index = first ? product.photos.findIndex((photo) => photo.id === first.id) : -1;
    return index <= 0 ? [...product.photos]
      : [product.photos[index], ...product.photos.slice(0, index), ...product.photos.slice(index + 1)];
  });
  /** What every place shows for this colour; fetched for a series product with photos, an optional enhancement. */
  readonly photoOverview = signal<ProductPhotoOverview | null>(null);
  /**
   * Where customers see the current slide: "Website", "Catalogus", "Bestelpagina",
   * read from the places (built from the old fields for a server that sends none).
   */
  readonly currentSlideBadges = computed(() => {
    const photo = this.galleryPhotos()[this.galleryIndex()];
    if (!photo) return [];
    const uses = tileUses({ key: photoKeyForProductPhoto(photo) }, resolvedPlaces(this.photoOverview()));
    return [
      ...(uses.website ? ['Website'] : []),
      ...(uses.catalogue ? ['Catalogus'] : []),
      ...(uses.series.includes('quote') ? ['Bestelpagina'] : []),
    ];
  });
  /** The colour as the photo section names it ("Kersenroze", or with its size when two colours share the name). */
  readonly photoColour = computed(() => {
    const product = this.product();
    return product ? variantShortLabel(product, this.family()?.members ?? [], this.photoOverview()?.variantLabel ?? null) : '';
  });
  /**
   * "Dit zien klanten bij {kleur}": the photo of Website, Catalogus and Offertes
   * en facturen. Only a server that resolves the places can say it; Website and
   * Catalogus link to their picker while that card has one to open.
   */
  readonly placeLine = computed<ProductPlaceLine | null>(() => {
    const product = this.product();
    const overview = this.photoOverview();
    if (!product || product.id === null || !overview?.places) return null;
    const colour = this.photoColour();
    return {
      productId: product.id,
      heading: `Dit zien klanten bij ${colour}`,
      items: placeCards(overview, colour, product).map((card) => {
        const pick = card.key === 'documents' ? null : card.actions.find((action) => action.id === 'pick') ?? null;
        return {
          key: card.key, name: card.name, photoUrl: card.photo?.smallUrl ?? null, alt: card.alt, empty: card.chip,
          kies: pick ? (card.key === 'website' ? 'website' as const : 'catalogus' as const) : null,
          linkLabel: pick?.ariaLabel ?? null,
        };
      }),
    };
  });
  readonly gpCapacity = computed(() => {
    const product = this.product();
    return product ? readGpCapacity(product.carton) : { value: null, source: 'UNKNOWN' as const };
  });
  readonly isAutoGpCapacity = isAutoGpCapacity;
  readonly gpCapacityHint = gpCapacityHint;
  readonly agreementPhotos = signal<ProductSupplierAgreementPhoto[]>([]);
  readonly supplierAgreement = signal<ProductSupplierAgreement | null>(null);
  readonly agreementVariantNames = computed(() => this.supplierAgreement()?.variants.map((variant) => variant.color || variant.name || variant.sku).join(', ') ?? '');
  /** Earlier containers on which this product arrived short or damaged. */
  readonly receiptIssues = signal<ReceiptIssue[]>([]);
  /** The supplier note as points and sub-points, the way the PDF prints it. */
  readonly supplierNoteBlocks = computed(() => parseSupplierNote(this.supplierAgreement()?.available ? this.supplierAgreement()?.note : null));
  readonly agreementLoading = signal(false);
  readonly agreementLoadError = signal<string | null>(null);

  /* ---- several suppliers (2026-10-25): the product's rows, the Voorkeur first ---- */
  /** Null while loading; a failed request leaves [] and the hero keeps today's supplier name. */
  readonly productSuppliers = signal<ProductSupplierRow[] | null>(null);
  readonly supplierRows = computed(() => sortSupplierRows(this.productSuppliers() ?? []));
  readonly activeSupplierRows = computed(() => this.supplierRows().filter((row) => row.active));
  readonly inactiveSupplierRows = computed(() => this.supplierRows().filter((row) => !row.active));
  readonly inactiveSuppliersOpen = signal(false);
  /** The "+{n}" beside the Voorkeur's name: the other active suppliers. */
  readonly otherSuppliers = computed(() => otherActiveCount(this.supplierRows()));
  /** The agreements of which supplier the page reads; null = the Voorkeur (today's agreement). */
  readonly agreementSupplierId = signal<number | null>(null);
  /** The choice above the agreements, only with two or more suppliers. */
  readonly agreementChoices = computed(() => this.supplierRows().length >= 2 ? agreementSupplierChoices(this.supplierRows()) : []);
  readonly shownAgreementSupplierId = computed(() =>
    this.agreementSupplierId() ?? this.supplierRows().find((row) => row.preferred)?.supplierId ?? this.product()?.supplierId ?? null);
  /** The supplier the agreements belong to, as the card head names it. */
  readonly agreementSupplierName = computed(() => {
    const id = this.agreementSupplierId();
    return (id === null ? null : this.supplierRows().find((row) => row.supplierId === id)?.supplierName) ?? this.supplierName();
  });
  private readonly money = new CurPipe();

  /** "$ 9,10 + $ 0,15", "—" without a price; never wraps. */
  supplierPrice(row: ProductSupplierRow): string {
    if (row.exwPrice === null || row.exwPrice === undefined) return '—';
    const currency = row.exwCurrency ?? row.supplierCurrency ?? 'USD';
    const extra = row.extraUnitCost && row.extraUnitCost > 0 ? ` + ${this.money.transform(row.extraUnitCost, currency)}` : '';
    return `${this.money.transform(row.exwPrice, currency)}${extra}`;
  }

  /** Line 2 of a row: "Versie B · ref PB-1530 · MOQ 600 · laatst PO-2026-005 · kostprijs € 8,32". */
  supplierLine(row: ProductSupplierRow): string {
    return [supplierRowMeta(row), supplierRowHistory(row, (value) => eurText(value, 2))].filter(Boolean).join(' · ');
  }

  /** Phone: the EXW price alone ("$ 9,10"), "—" without one; the extra cost goes under it. */
  supplierExw(row: ProductSupplierRow): string {
    if (row.exwPrice === null || row.exwPrice === undefined) return '—';
    return this.money.transform(row.exwPrice, row.exwCurrency ?? row.supplierCurrency ?? 'USD');
  }

  /** Phone, under the price: the extra cost and the incoterm ("+ $ 0,15 · FOB"). */
  supplierTrail(row: ProductSupplierRow): string {
    const currency = row.exwCurrency ?? row.supplierCurrency ?? 'USD';
    const extra = row.exwPrice !== null && row.extraUnitCost && row.extraUnitCost > 0 ? `+ ${this.money.transform(row.extraUnitCost, currency)}` : null;
    return [extra, row.supplierIncoterm].filter(Boolean).join(' · ');
  }

  /** Phone, under the name: version, reference, MOQ, lead time and the last order ("… · laatst PO-2026-005"). */
  supplierPhoneSub(row: ProductSupplierRow): string {
    return [supplierRowMeta(row), row.lastOrder ? `laatst ${row.lastOrder.number}` : null].filter(Boolean).join(' · ');
  }

  /** The supplier of an earlier receipt issue, only when the product has two or more suppliers. */
  issueSupplier(issue: ReceiptIssue): string | null {
    return issueSupplierName(issue, this.supplierRows());
  }

  /** The Afspraken choice: another supplier's note and photos, read-only; the Voorkeur is today's agreement. */
  selectAgreementSupplier(value: string): void {
    const product = this.product();
    const id = Number(value);
    if (!product || product.id === null || !Number.isInteger(id)) return;
    const preferred = this.supplierRows().find((row) => row.preferred)?.supplierId ?? product.supplierId;
    const next = id === preferred ? null : id;
    if (next === this.agreementSupplierId()) return;
    this.agreementSupplierId.set(next);
    this.agreementLightbox.set(-1);
    void this.loadSupplierAgreement(product.id, this.loadVersion, next);
  }

  /* ---- stock batches (2026-10-25): shown only after the start ---- */
  private readonly stockBatchApi = inject(StockBatchApi);
  readonly batches = signal<ProductStockBatches | null>(null);
  readonly batchSheet = signal<StockBatch | null>(null);
  readonly emptyBatchesOpen = signal(false);
  protected readonly batchFmt = computed(() => batchFormat(productSalesUnit(this.product())));
  /** The batches to show, or null: not started, failed, or nothing to show. */
  readonly shownBatches = computed(() => showBatches(this.batches()) ? this.batches() : null);
  readonly batchLists = computed(() => splitBatches(this.batches()?.batches ?? []));
  readonly batchNote = computed(() => { const data = this.shownBatches(); return data ? batchesNote(data, this.batchFmt()) : null; });
  readonly batchFoot = computed(() => { const data = this.shownBatches(); return data ? partnerFoot(data, this.batchFmt()) : null; });
  readonly batchesHelperText = computed(() => { const data = this.shownBatches(); return data ? batchesHelper(data, this.batchFmt()) : ''; });
  /** Own plus partner batches: the figure the card's head shows (desk and phone). */
  readonly batchesTotalValue = computed(() => { const data = this.shownBatches(); return data ? batchesTotal(data) : 0; });
  readonly batchName = batchTitle;
  readonly batchTagsOf = batchTags;
  batchSubOf(batch: StockBatch): string { return batchSub(batch, this.batchFmt()); }
  batchCostOf(batch: StockBatch): string { return batchCostText(batch, this.batchFmt()); }
  batchCostPartsOf(batch: StockBatch): { cost: string; now: string | null } { return batchCostParts(batch, this.batchFmt()); }
  batchRowText(batch: StockBatch): string { return batchRowTitle(batch, this.batchFmt()); }

  private loadBatches(productId: number, version: number): void {
    this.stockBatchApi.forProduct(productId)
      .then((data) => { if (version === this.loadVersion) this.batches.set(data); })
      .catch(() => { if (version === this.loadVersion) this.batches.set(null); });
  }

  /* The stock book, fetched the first time the tile is opened. */
  /** Pieces on the water for this product, from ordered and shipped containers. */
  readonly expected = signal<ExpectedStock | null>(null);
  readonly stockHistory = signal<StockMovement[] | null>(null);
  readonly stockLevels = signal<ProductStock[] | null>(null);
  readonly stockTotal = computed(() => (this.stockLevels() ?? []).reduce((sum, level) => sum + level.quantity, 0));
  readonly stockLooseTotal = computed(() => (this.stockLevels() ?? []).reduce((sum, level) => sum + (level.loosePieces ?? 0), 0));
  readonly stockAmount = stockAmountText;
  readonly looseText = looseStockText;
  readonly moveDelta = stockMovementDelta;
  /** The unit ("stuks", "bowls") alone with one location; otherwise "9.400 magazijn · 600 TICA". */
  readonly stockSummary = computed(() => {
    const levels = this.stockLevels() ?? [];
    if (levels.length <= 1) return productSalesUnit(this.product()).plural;
    return levels.map((level) => `${stockAmountText(level, this.product())} ${level.name}`).join(' · ');
  });

  /* ---- the price, taken apart ---- */
  readonly priceOpen = signal(false);
  /** "auto" when the stored figure is exactly what the sizes derive. */
  cartonPiecesAuto(product: Product): boolean {
    return autoPiecesPerCarton(product) === product.carton.piecesPerCarton;
  }

  cartonWeightAuto(product: Product): boolean {
    const derived = autoCartonWeightKg(product, product.carton.piecesPerCarton);
    return derived !== null && derived === product.carton.weightKg;
  }
  /** Back as the stack has it (the screen below), else to Producten. */
  goBack(): void {
    this.navHistory.back('/products');
  }

  /* ---- the phone page (ProductView renders below 680 px only; ProductDesk from 680) ---- */
  private readonly navHistory = inject(NavHistory);
  private readonly iosNav = viewChild(IosNav);
  /** A colour dot: the product's own swatch, or the standard one for that name. */
  readonly dotColour = colourHexOf;
  /** The screen below in the stack ("Producten", "Voorraad", "Order"); Producten without history. */
  readonly backName = computed(() => this.navHistory.belowLabel() || 'Producten');
  /** A capsule while it fits and the bar is large; the 44 px circle once the bar condenses (N3). */
  readonly barCondensed = computed(() => this.iosNav()?.condensed() ?? false);
  readonly backText = computed(() => (this.barCondensed() ? '' : capsuleLabel(this.backName())));
  readonly moreMenu = signal(false);
  readonly moreItems: ContextMenuItem[] = [
    { id: 'book', label: 'Voorraad boeken', iconName: 'stock' },
    { id: 'photos', label: 'Foto’s beheren', iconName: 'media' },
    { id: 'names', label: 'Namen & vertalingen', iconName: 'globe' },
    { id: 'build', label: 'Prijsopbouw', iconName: 'list' },
    { id: 'history', label: 'Kostprijshistoriek', iconName: 'recent' },
  ];
  /** The native host's chrome: Bewerken as the primary, the '…' rows as the menu. */
  readonly hostPage = computed<HostPageInput | null>(() => {
    const product = this.product();
    if (!product) return null;
    return { primary: { id: `nav:/products/${product.id}/edit`, label: 'Bewerken', icon: 'pencil' }, actions: [], menu: menuRows(this.moreItems) };
  });

  hostAction(event: HostActionEvent): void {
    const product = this.product();
    const item = this.moreItems.find((candidate) => candidate.id === event.id);
    if (product && item) this.pickMore(item, product);
  }
  /** The Afspraken disclosure opens itself when the link points at it (#product-agreements). */
  readonly agreementsOpenAtStart = typeof window !== 'undefined' && window.location.hash === '#product-agreements';
  readonly publicationGroups = computed(() => groupPublicationIssues(this.publicationIssues()));
  /** The series' public name when it differs from the product's own. */
  readonly publicName = computed(() => {
    const name = this.family()?.name?.trim();
    return name && name !== this.product()?.name.trim() ? name : null;
  });
  /** ["Zaltbommel 1.960", "Tica Brussel 8"], each location kept with its figure on one line; "in voorraad" with one location. */
  readonly locationLine = computed(() => {
    const levels = this.stockLevels() ?? [];
    if (levels.length <= 1) return ['in voorraad'];
    return levels.map((level) => `${level.name} ${stockAmountText(level, this.product())}`);
  });
  /**
   * Every product's stock over all locations, asked once after the product
   * shows: the colour chips (B7), on the desk and the phone. A booking here
   * patches the booked product's levels in (refreshStock).
   */
  private readonly memberLevels = signal<StockLevel[] | null>(null);
  /** The request failed: each chip shows its product's own stock figure, as before the redesign. */
  private readonly memberLevelsFailed = signal(false);
  private memberLevelsFor: number | null = null;

  memberStock(productId: number): number | null {
    const levels = this.memberLevels();
    if (!levels) {
      return this.memberLevelsFailed() ? this.catalogueProducts().find((item) => item.id === productId)?.stockQuantity ?? null : null;
    }
    return levels.filter((level) => level.productId === productId).reduce((sum, level) => sum + level.quantity, 0);
  }

  unitFor(product: Product, quantity: number): string {
    const unit = productSalesUnit(product);
    return quantity === 1 ? unit.singular : unit.plural;
  }

  pickMore(item: ContextMenuItem, product: Product): void {
    this.moreMenu.set(false);
    if (product.id === null) return;
    switch (item.id) {
      case 'book': this.openBooking('RECOUNT'); break;
      case 'photos': void this.router.navigate(['/products', product.id, 'edit'], { queryParams: { tab: 'media' } }); break;
      case 'names': void this.router.navigate(['/products', product.id, 'translations']); break;
      case 'build': this.openPriceInfo(product); break;
      default: this.openHistory();
    }
  }

  selectGalleryPhoto(index: number): void {
    const total = this.galleryPhotos().length;
    if (!total) return;
    this.galleryIndex.set(Math.max(0, Math.min(index, total - 1)));
  }

  stepGallery(direction: -1 | 1, total: number): void {
    if (total < 2) return;
    this.galleryIndex.update((index) => (index + direction + total) % total);
  }

  openCurrentGalleryPhoto(): void {
    if (performance.now() < this.gallerySuppressClickUntil) return;
    this.lightbox.set(this.galleryIndex());
  }

  startGallerySwipe(event: PointerEvent, total: number): void {
    if (!event.isPrimary) { this.cancelGallerySwipe(); return; }
    if (total < 2 || (event.pointerType === 'mouse' && event.button !== 0)) return;
    this.galleryPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  finishGallerySwipe(event: PointerEvent, total: number): void {
    const start = this.galleryPointer;
    if (!start || start.id !== event.pointerId) return;
    this.galleryPointer = null;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId);
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 42 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.15) return;
    event.preventDefault();
    this.gallerySuppressClickUntil = performance.now() + 350;
    this.stepGallery(deltaX < 0 ? 1 : -1, total);
  }

  cancelGallerySwipe(): void {
    this.galleryPointer = null;
  }

  scrollToStock(): void {
    this.scrollToDetailSection('stock-card');
  }

  scrollToDetailSection(
    id: string,
    event?: Event,
  ): void {
    event?.preventDefault();
    const target = document.getElementById(id);
    if (!target) return;
    if (target instanceof HTMLDetailsElement) target.open = true;
    target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    const url = new URL(window.location.href);
    url.hash = id;
    window.history.replaceState(window.history.state, '', url);
  }
  readonly priceBuild = signal<PriceBuild | null>(null);
  /** The source container now calculates another cost: the price card, the cost tiles and the history say so. */
  readonly driftNotice = computed(() => this.priceBuild()?.drift ?? null);
  private priceBuildRequest: { productId: number; request: Promise<void> } | null = null;
  /** The cost history fetched for the build-up, handed to the Historiek so it does not ask again. */
  private readonly costHistory = signal<{ productId: number; rows: ProductCostHistoryEntry[] } | null>(null);
  readonly costHistoryRows = computed(() => {
    const history = this.costHistory();
    return history && history.productId === this.product()?.id ? history.rows : null;
  });
  /** Id of the purchase calculation the cost price came from, when it still exists. */
  readonly sourceOrderId = signal<number | null>(null);
  /** The card tiles open the build-up as a sheet on every screen size. */
  readonly priceInfoOpen = signal(false);

  readonly priceTab = signal<'build' | 'history'>('build');

  /** Kostprijshistoriek as its own sheet: the cost tiles, the desk's cost figure and the flow step open it. */
  readonly historyOpen = signal(false);
  /** The order of the cost's source, so the history keeps the Bron tile's link: on the rows that name it, or in an empty history. */
  readonly historySourceLink = computed(() => {
    const id = this.sourceOrderId();
    const text = this.product()?.landedCostSource;
    return id !== null && text ? { id, text } : null;
  });

  openHistory(): void {
    this.historyOpen.set(true);
  }

  openPriceInfo(product: Product): void {
    this.priceTab.set('build');
    this.priceInfoOpen.set(true);
    if (product.id !== null && this.priceBuild() === null) {
      void this.loadPriceBuild(product);
    }
  }

  closePriceInfo(): void {
    this.priceOpen.set(false);
    this.priceInfoOpen.set(false);
  }

  togglePrice(product: Product): void {
    const open = !this.priceOpen();
    this.priceOpen.set(open);
    if (open && product.id !== null && this.priceBuild() === null) {
      void this.loadPriceBuild(product);
    }
  }

  /**
   * Rebuilds the road from factory price to catalogue price. The cost part
   * comes from the product's cost history and the one container that set it
   * (by the newest row's order id; by the cost's source number when the row
   * kept none): the stored cost from its own parts, and that container's
   * calculation of today as a block of its own, never mixed. One request per
   * product open; the page starts it on load, so the drift shows on the tiles.
   */
  protected loadPriceBuild(product: Product): Promise<void> {
    if (product.id === null) return Promise.resolve();
    if (this.priceBuildRequest?.productId !== product.id) {
      this.priceBuildRequest = { productId: product.id, request: this.buildPrice(product, product.id, this.loadVersion) };
    }
    return this.priceBuildRequest.request;
  }

  private async buildPrice(product: Product, id: number, version: number): Promise<void> {
    const history = await this.catalog.productCostHistory(id).catch(() => null);
    if (version !== this.loadVersion) return;
    if (history) this.costHistory.set({ productId: id, rows: history });
    /* A failed request says "niet geladen", never "niet bewaard". */
    const applied = appliedParts(product, history);
    const newest = applied.row;
    const source = product.landedCostSource;
    /* The full list is loaded for the containers anyway; only a cost known by its number alone looks in it. */
    const byNumber = async () => source ? (await this.purchaseOrdersFor(id)).find((item) => item.order.number === source) ?? null : null;
    let view: PurchaseOrderView | null = null;
    try {
      if (newest?.purchaseOrderId == null) view = await byNumber();
      else if (!newest.containerGone) view = await this.sourcing.purchaseOrder(newest.purchaseOrderId).catch(byNumber);
    } catch {
      view = null;
    }
    if (version !== this.loadVersion || this.product()?.id !== id) return;
    this.sourceOrderId.set(view?.order.id ?? null);

    const line = view?.costing.lines.find((item) => item.productId === id) ?? null;
    const current = productCostBasis(product);
    /* The stored cost reads in the basis it was applied on; today's calculation in today's. */
    const appliedBasis = newest && applied.matches ? entryCostBasis(newest, current) : current;
    const sameBasis = sameCostBasis(appliedBasis, current);
    /* The words of the rest of the chain ("per display"); the stored basis only when it is not today's. */
    const per = `per ${productSalesUnit(product).singular}`;
    const orderText = view?.order.number ?? newest?.source ?? source;
    const cost = costBuild({
      storedEur: product.landedCostEur,
      applied,
      live: liveParts(line),
      order: view ? { id: view.order.id, number: view.order.number } : null,
      appliedPer: sameBasis ? per : costWords(appliedBasis).per,
      livePer: per,
      sameBasis,
      /* The same words as on the calculation, so both screens read alike. */
      appliedWords: {
        labels: view?.costLabels, hsCode: product.hsCode,
        dutyPct: applied.parts ? impliedDutyPct(applied.parts) : null,
        goodsHint: newest?.quantity && orderText ? `${costQuantity(appliedBasis, newest.quantity)} in ${orderText}` : null,
      },
      liveWords: {
        labels: view?.costLabels, hsCode: product.hsCode, dutyPct: line?.dutyRatePct ?? null,
        goodsHint: line && view ? `${costQuantity(current, line.quantity)} in ${view.order.number}` : null,
      },
    });

    const rows: PriceRow[] = [...cost.applied];
    const price = this.displayPrice();
    if (price !== null) {
      if (this.hasFixedSalesPrice(product)) {
        rows.push({ label: 'Vaste verkoopprijs', eur: price });
      } else if (product.landedCostEur) {
        rows.push({ label: `+ Opslag ${product.markupPct ?? 0} %`, eur: price - product.landedCostEur });
      }
      rows.push({ label: `Catalogusprijs per ${productSalesUnit(product).singular}`, eur: price, sum: true });
      const margin = this.margin();
      if (margin) rows.push({ label: `Marge per ${productSalesUnit(product).singular} · ${margin.pct} %`, eur: margin.eur, note: true });
    }
    /* The other side of a display, after the figures in their own unit. */
    const costOther = otherBasisPrice(product, product.landedCostEur);
    if (costOther) rows.push({ label: `${costOther.sign} Kostprijs ${costOther.per}`, eur: costOther.price, aside: true });
    const priceOther = otherBasisPrice(product, price);
    if (priceOther) rows.push({ label: `${priceOther.sign} Catalogusprijs ${priceOther.per}`, eur: priceOther.price, aside: true });
    this.priceBuild.set({ rows, source, live: cost.live, drift: cost.drift });
  }

  /** Three latest lines of the stock book; "Meer" unfolds the rest. */
  readonly allMovesOpen = signal(false);
  readonly hiddenMoves = computed(() => Math.max(0, (this.stockHistory()?.length ?? 0) - 3));
  readonly recentMoves = computed(() => {
    const history = this.stockHistory();
    if (!history) return null;
    return this.allMovesOpen() ? history : history.slice(0, 3);
  });

  /* ---- stock bookings: one sheet (Voorraad boeken) for every kind ---- */
  readonly stockSaving = signal(false);
  /** Received containers that carried this product: what a damage or shortage report can point at. */
  readonly receivedOrders = signal<ReceivedContainer[]>([]);
  /** The open Voorraad boeken sheet: which kind, on which location. */
  readonly bookingSheet = signal<{ kind: BookingKind; locationId: number | null } | null>(null);
  readonly bookingLevels = computed<BookingLevel[]>(() =>
    (this.stockLevels() ?? []).map((level) => ({ locationId: level.locationId, name: level.name, quantity: level.quantity, loosePieces: level.loosePieces, piecesPerUnit: level.piecesPerUnit })));

  /** A location row opens a recount of that location; the buttons start on the first location with stock. */
  openBooking(kind: BookingKind, locationId?: number | null): void {
    this.bookingSheet.set({ kind, locationId: locationId ?? null });
  }

  containerLabel(order: ReceivedContainer): string {
    return containerOptionLabel(order);
  }

  /** The sheet booked (and toasted): every figure on the page follows, the Schade/tekort list too after a container report. */
  onBooked(event: StockBooked): void {
    this.bookingSheet.set(null);
    const id = this.product()?.id;
    if (id === null || id === undefined) return;
    this.refreshStock(id);
    if (event.containerId !== null) {
      void this.sourcing.receiptIssues(id).then((issues) => this.receiptIssues.set(issues)).catch(() => {});
    }
  }

  /** After a booking every figure on the page tells the new truth, the series chips too. */
  protected refreshStock(productId: number): void {
    this.catalog.productStock(productId).then((levels) => {
      this.stockLevels.set(levels);
      this.memberLevels.update((all) => all && [
        ...all.filter((level) => level.productId !== productId),
        ...levels.map((level) => ({ productId, locationId: level.locationId, quantity: level.quantity })),
      ]);
    }).catch(() => {});
    this.loadStockHistory(productId);
    this.loadBatches(productId, this.loadVersion);
    this.catalog.product(productId).then((product) => this.product.set(product)).catch(() => {});
  }

  private loadStockHistory(productId: number): void {
    this.catalog.stockMovements(productId)
      .then((history) => this.stockHistory.set(history))
      .catch(() => this.stockHistory.set([]));
  }
  readonly family = signal<ProductFamily | null>(null);
  readonly familyLoading = signal(false);
  readonly familyLoadError = signal(false);
  protected readonly categories = signal<Category[]>([]);
  protected readonly catalogueProducts = signal<Product[]>([]);
  private readonly catalogueFamilies = signal<ProductFamily[]>([]);
  private catalogueNavigationLoaded = false;
  private catalogueNavigationRequest: Promise<void> | null = null;

  readonly variantOptionLabel = productVariantOptionLabel;
  readonly variantNeighbours = computed(() =>
    productCatalogNavigation(
      this.catalogueProducts(),
      this.catalogueFamilies(),
      this.categories(),
      this.product()?.id ?? null,
    ));
  protected readonly suppliers = signal<Supplier[]>([]);
  private loadVersion = 0;

  readonly variantMembers = computed(() => {
    return [...(this.family()?.members ?? [])]
      .sort((a, b) => a.position - b.position || a.productId - b.productId);
  });

  readonly supplierName = computed(() =>
    this.suppliers().find((supplier) => supplier.id === this.product()?.supplierId)?.name ?? '');
  readonly categoryName = computed(() =>
    this.categories().find((category) => category.id === this.product()?.categoryId)?.name ?? '');

  readonly displayPrice = computed(() => {
    const product = this.product();
    if (!product) return null;
    return product.computedSalesPriceEur > 0 ? product.computedSalesPriceEur : null;
  });

  readonly publicHandle = computed(() => this.family()?.publicHandle || null);
  readonly websiteStatus = computed(() => this.family()?.websiteStatus ?? 'DRAFT');
  readonly orderAppStatus = computed(() => this.family()?.orderAppStatus ?? 'DRAFT');
  readonly publicationActive = computed(() =>
    !!this.product()?.active && (this.family()?.active ?? false));
  readonly publicationIssues = computed(() => {
    if (this.familyLoading() || this.familyLoadError()) return [];
    const family = this.family();
    if (family) return family.publicationIssues;
    return [];
  });

  readonly margin = computed(() => {
    const price = this.displayPrice();
    const landed = this.product()?.landedCostEur;
    if (price === null || landed === null || landed === undefined || landed <= 0) return null;
    const eur = Math.round((price - landed) * 100) / 100;
    return { eur, pct: Math.round((eur / price) * 100) };
  });

  constructor() {
    /* Names the product's unit ("bowls") in every label; "stuks" until it arrives. */
    void this.catalog.unitNames().catch(() => undefined);
    afterRenderEffect(() => {
      this.product()?.id;
      this.desktop.active();
      this.revealSelectedVariant(this.variantRail()?.nativeElement);
    });
    effect(() => {
      const product = this.product();
      if (!product || product.id === null || product.familyId == null || this.memberLevelsFor === product.id) return;
      this.memberLevelsFor = product.id;
      this.memberLevels.set(null);
      this.memberLevelsFailed.set(false);
      void this.catalog.stockLevels().then((levels) => {
        if (this.product()?.id === product.id) this.memberLevels.set(levels);
      }).catch(() => {
        if (this.product()?.id === product.id) this.memberLevelsFailed.set(true);
      });
    });
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = Number(params.get('id'));
      if (Number.isInteger(id) && id > 0) void this.loadProduct(id);
    });
  }

  private revealSelectedVariant(rail: HTMLElement | undefined): void {
    const selected = rail?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!rail || !selected) return;
    const bounds = rail.getBoundingClientRect();
    const item = selected.getBoundingClientRect();
    if (item.left < bounds.left) rail.scrollLeft += item.left - bounds.left - 1;
    else if (item.right > bounds.right) rail.scrollLeft += item.right - bounds.right + 1;
  }

  retryFamily(): void {
    const familyId = this.product()?.familyId;
    if (familyId != null && !this.familyLoading()) {
      void this.loadFamily(familyId, this.loadVersion);
    }
  }

  retrySupplierAgreement(): void {
    const productId = this.product()?.id;
    if (productId !== null && productId !== undefined && !this.agreementLoading()) {
      void this.loadSupplierAgreement(productId, this.loadVersion, this.agreementSupplierId());
    }
  }

  /** The product request failed (a 404 shows the server's message): the page says so, with a retry. */
  readonly loadError = signal<string | null>(null);
  readonly reloading = signal(false);
  private loadedId: number | null = null;
  /** One purchase-order request per product open, for the containers and for a cost source known only by its number. */
  private ordersRequest: { productId: number; request: Promise<PurchaseOrderView[]> } | null = null;

  protected purchaseOrdersFor(productId: number | null): Promise<PurchaseOrderView[]> {
    if (this.ordersRequest && this.ordersRequest.productId === productId) return this.ordersRequest.request;
    return this.sourcing.purchaseOrders();
  }

  reload(): void {
    if (this.loadedId === null || this.reloading()) return;
    this.reloading.set(true);
    void this.loadProduct(this.loadedId);
  }

  private async loadProduct(id: number): Promise<void> {
    void this.loadCatalogueNavigation();
    this.loadStockHistory(id);
    void this.sourcing.expectedStock()
      .then((items) => this.expected.set(items.find((item) => item.productId === id) ?? null))
      .catch(() => this.expected.set(null));
    const version = ++this.loadVersion;
    this.loadedId = id;
    this.loadError.set(null);
    this.product.set(null);
    this.priceOpen.set(false);
    this.priceInfoOpen.set(false);
    this.historyOpen.set(false);
    this.priceTab.set('build');
    this.priceBuild.set(null);
    this.priceBuildRequest = null;
    this.costHistory.set(null);
    this.stockHistory.set(null);
    this.allMovesOpen.set(false);
    this.bookingSheet.set(null);
    this.family.set(null);
    this.familyLoadError.set(false);
    this.familyLoading.set(false);
    this.lightbox.set(-1);
    this.galleryIndex.set(0);
    this.photoOverview.set(null);
    this.cancelGallerySwipe();
    this.gallerySuppressClickUntil = 0;
    this.agreementLightbox.set(-1);
    this.agreementPhotos.set([]);
    this.supplierAgreement.set(null);
    this.receiptIssues.set([]);
    this.receivedOrders.set([]);
    this.agreementLoadError.set(null);
    this.agreementSupplierId.set(null);
    this.productSuppliers.set(null);
    this.inactiveSuppliersOpen.set(false);
    this.batches.set(null);
    this.batchSheet.set(null);
    this.emptyBatchesOpen.set(false);
    /* One loader for both topics: the supplier rows (cards, hero "+n", the Afspraken choice) and the batches. */
    void this.catalog.productSuppliers(id)
      .then((rows) => { if (version === this.loadVersion) this.productSuppliers.set(rows); })
      .catch(() => { if (version === this.loadVersion) this.productSuppliers.set([]); });
    this.loadBatches(id, version);
    void this.sourcing.receiptIssues(id)
      .then((issues) => { if (version === this.loadVersion) this.receiptIssues.set(issues); })
      .catch(() => { /* the history is a bonus on the page */ });
    this.ordersRequest = { productId: id, request: this.sourcing.purchaseOrders() };
    void this.ordersRequest.request
      .then((orders) => { if (version === this.loadVersion) this.receivedOrders.set(receivedContainersFor(orders, id)); })
      .catch(() => { /* without the list a report simply has no container to point at */ });
    void this.loadSupplierAgreement(id, version);

    let product: Product;
    let categories: Category[];
    let suppliers: Supplier[];
    try {
      /* The product is the page; categories and suppliers only name things, so they fail soft. */
      [product, categories, suppliers] = await Promise.all([
        this.catalog.product(id),
        this.catalog.categories().catch(() => [] as Category[]),
        this.sourcing.suppliers().catch(() => [] as Supplier[]),
      ]);
    } catch (failure: unknown) {
      if (version === this.loadVersion) {
        this.loadError.set(messageOf(failure, LOAD_ERROR_FALLBACK));
        this.reloading.set(false);
      }
      return;
    }
    if (version !== this.loadVersion) return;
    this.reloading.set(false);
    /* The variant group belongs to the first paint: it loads before the
       product shows, so no block appears a moment later. */
    if (product.familyId != null) await this.loadFamily(product.familyId, version);
    if (version !== this.loadVersion) return;
    this.product.set(product);
    /* The places only exist for a series; a loose product needs no extra request. */
    if (product.id !== null && product.familyId != null && product.photos.length) void this.loadPhotoOverview(product.id, version);
    this.stockLevels.set(null);
    if (product.id !== null) {
      this.catalog.productStock(product.id).then((levels) => this.stockLevels.set(levels)).catch(() => this.stockLevels.set([]));
    }
    this.categories.set(categories);
    this.suppliers.set(suppliers);
    this.sourceOrderId.set(null);
    /* The build-up also finds the cost's source order and whether it now calculates another cost. */
    void this.loadPriceBuild(product);
    const requestedSection = ['product-overview', 'product-core', 'product-packaging', 'stock-card', 'product-media', 'product-agreements', 'product-publication', 'pd-agreements',
      'pd-suppliers', 'product-suppliers', 'pd-batches', 'product-batches']
      .find((id) => `#${id}` === window.location.hash);
    if (requestedSection) this.scrollWhenShown(requestedSection, version);
  }

  /**
   * The suppliers and batches arrive after the product: a link to them
   * (from a purchase order) waits until the section stands, up to 3 s,
   * and lands on the other screen's name of the same section.
   */
  private scrollWhenShown(id: string, version: number, tries = 30): void {
    setTimeout(() => {
      if (version !== this.loadVersion) return;
      const target = [id, SECTION_ALIASES[id]].find((name) => name && document.getElementById(name));
      if (target) {
        this.scrollToDetailSection(target);
        this.holdSection(target, version);
      } else if (tries > 1) this.scrollWhenShown(id, version, tries - 1);
    }, tries === 30 ? 0 : 100);
  }

  /**
   * Cards above the section (stock, price build-up) still fill in after that first scroll, and the browser's
   * scroll anchoring then carries the section out of view: keep it in place for a moment, until the user scrolls.
   */
  private holdSection(id: string, version: number, rounds = 6): void {
    let userMoved = false;
    const stop = () => { userMoved = true; };
    const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
    for (const type of events) window.addEventListener(type, stop, { once: true, passive: true });
    const step = (left: number) => setTimeout(() => {
      const target = document.getElementById(id);
      const live = !userMoved && version === this.loadVersion && !!target;
      if (live && target) {
        const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
        if (Math.abs(target.getBoundingClientRect().top - margin) > 4) target.scrollIntoView({ block: 'start' });
      }
      if (live && left > 1) step(left - 1);
      else for (const type of events) window.removeEventListener(type, stop);
    }, 250);
    step(rounds);
  }

  private loadCatalogueNavigation(): Promise<void> {
    if (this.catalogueNavigationLoaded) return Promise.resolve();
    if (this.catalogueNavigationRequest) return this.catalogueNavigationRequest;
    this.catalogueNavigationRequest = Promise.all([
      this.catalog.products(),
      this.catalog.productFamilies({ maxAgeMs: 20_000 }),
    ]).then(([products, families]) => {
      this.catalogueProducts.set(products);
      this.catalogueFamilies.set(families);
      this.catalogueNavigationLoaded = true;
    }).catch(() => {
      /* Navigation is an enhancement; a catalogue-index failure may never
         hold the operational product dossier hostage. */
    }).finally(() => {
      this.catalogueNavigationRequest = null;
    });
    return this.catalogueNavigationRequest;
  }

  /** Today's agreement (supplierId null = the Voorkeur) or another supplier's; a late answer of another product or choice is dropped. */
  private async loadSupplierAgreement(productId: number, version: number, supplierId: number | null = null): Promise<void> {
    const current = () => version === this.loadVersion && supplierId === this.agreementSupplierId();
    this.agreementLoading.set(true);
    this.agreementLoadError.set(null);
    try {
      const agreement = await this.supplierAgreementApi.get(productId, supplierId);
      if (!current()) return;
      this.supplierAgreement.set(agreement);
      this.agreementPhotos.set(agreement.available ? orderedSupplierAgreementPhotos(agreement.photos) : []);
    } catch (failure: unknown) {
      if (!current()) return;
      this.agreementPhotos.set([]);
      this.supplierAgreement.set(null);
      this.agreementLoadError.set(messageOf(
        failure, 'De leveranciersafspraak kon niet worden geladen.'));
    } finally {
      if (current()) this.agreementLoading.set(false);
    }
  }

  private async loadPhotoOverview(productId: number, version: number): Promise<void> {
    try {
      const overview = await this.catalog.productPhotoOverview(productId);
      if (version === this.loadVersion) this.photoOverview.set(overview);
    } catch {
      /* The badges and the places line are a bonus; the carousel itself never waits for them. */
    }
  }

  private async loadFamily(familyId: number, version: number): Promise<void> {
    this.familyLoading.set(true);
    this.familyLoadError.set(false);
    try {
      const family = await this.catalog.productFamily(familyId);
      if (version !== this.loadVersion) return;
      this.family.set(family);
    } catch {
      if (version !== this.loadVersion) return;
      this.family.set(null);
      this.familyLoadError.set(true);
    } finally {
      if (version === this.loadVersion) this.familyLoading.set(false);
    }
  }

  /** Saves the EAN-13 as a 300 dpi PNG, ready for a label printer or a designer. */
  async downloadBarcode(code: string): Promise<void> {
    try {
      saveBlob(await this.catalog.barcodeImage(code), `EAN-${code}.png`);
    } catch {
      this.ui.toast('Barcode-afbeelding maken mislukt', 'err');
    }
  }

  hasFixedSalesPrice(product: Product): boolean {
    return product.fixedSalesPriceEur !== null && product.fixedSalesPriceEur > 0;
  }

  publicationSummary(): string {
    if (this.familyLoading()) return '—';
    if (this.familyLoadError()) return 'Publicatiestatus niet geladen';
    if (!this.family()) return 'Niet gekoppeld';
    if (!this.publicationActive()) return 'Inactief';
    const live = [
      this.websiteStatus() === 'PUBLISHED' ? 'website' : null,
      this.orderAppStatus() === 'PUBLISHED' ? 'orderapp' : null,
    ].filter(Boolean);
    if (live.length) return `Live op ${live.join(' en ')}`;
    if (this.publicationIssues().length) return 'Nog niet compleet';
    return 'Concept';
  }

  size(box: { lengthCm: number | null; widthCm: number | null; heightCm: number | null }): string {
    const dimensions = [box.lengthCm, box.widthCm, box.heightCm];
    if (!dimensions.some((value) => value !== null && value > 0)) return '—';
    return `${dimensions.map((value) => value !== null && value > 0 ? value : '—').join(' × ')} cm`;
  }
}
