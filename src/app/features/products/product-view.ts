import { primarySalesPrice, productSalesUnit, secondarySalesPrice, salesQuantityDetail } from './product-sales-unit';
import { ProductCostHistory } from './product-cost-history';
import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';
import { Location, NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { ProductSupplierAgreementApi, type ProductSupplierAgreement } from '../../core/api/product-supplier-agreement-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { AuthImage } from '../../core/api/auth-image';
import { PhotoLightbox } from '../../shared/photo-lightbox';
import { Category, LandedCostLine, Product, ProductFamily, ProductSupplierAgreementPhoto, PurchaseOrderView, ReceiptIssue, StockMovement, Supplier, ProductStock, ExpectedStock } from '../../core/api/models';

interface PriceRow { label: string; hint?: string; eur: number; sum?: boolean; note?: boolean; aside?: boolean; }
interface PriceBuild { rows: PriceRow[]; source: string | null; sourceFound: boolean; }
import { PageHeader } from '../../shared/page-header';
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

/**
 * Read-first product master. The page deliberately separates the customer
 * story (photo, price, availability) from operational data. Editing remains
 * an explicit action, so a warehouse or sales colleague can safely browse it.
 */
type TakeoutKind = 'DAMAGED' | 'DEMO' | 'SHORTAGE';

export interface ReceivedContainer {
  id: number;
  number: string;
  receivedOn: string | null;
}

/** The received containers that carried this product, newest first, so a report can name its origin. */
export function receivedContainersFor(orders: readonly PurchaseOrderView[], productId: number): ReceivedContainer[] {
  return orders
    .filter((row) => row.order.status === 'ONTVANGEN'
      && row.order.lines.some((line) => line.productId === productId))
    .map((row) => ({ id: row.order.id, number: row.order.number, receivedOn: row.order.receivedOn ?? null }))
    .sort((left, right) => (right.receivedOn ?? '').localeCompare(left.receivedOn ?? '') || right.id - left.id)
    .slice(0, 12);
}

@Component({
  selector: 'app-product-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [KgPipe, Skeleton, ProductCostHistory, RouterLink, NgTemplateOutlet, AuthImage, PhotoLightbox, ProductSupplierAgreementPhotoViewer, ProductMediaCard,
    PageHeader, Icon, Sheet, CbmPipe, CurPipe, DateNlPipe, DateTimeNlPipe, EurPipe, NumPipe,
  ],
  template: `
    @if (product(); as product) {

      @if (desktop.active()) {
        <app-page-header title="Productdetails" [subtitle]="categoryName() || 'Catalogus'"
                         [showBack]="true" [showBell]="false">
          <!-- Walk through this model's colours, then continue with the next
               product model in the canonical catalogue order. -->
          @if (variantNeighbours(); as around) {
            <span class="product-nav" role="group" aria-label="Producten en kleurvarianten">
              <a class="product-nav__btn" [class.product-nav__btn--off]="!around.previous"
                 [routerLink]="around.previous ? ['/products', around.previous.productId] : null"
                 [attr.aria-disabled]="!around.previous"
                 [attr.aria-label]="around.previous
                   ? (around.previousChangesProduct ? 'Vorig product: ' + around.previous.groupName : 'Vorige kleur: ' + around.previous.optionLabel)
                   : 'Geen vorig product'"
                 [title]="around.previous
                   ? (around.previousChangesProduct ? 'Vorig product: ' + around.previous.groupName : 'Vorige kleur: ' + around.previous.optionLabel)
                   : 'Dit is het eerste product'">‹</a>
              <small class="product-nav__pos" [title]="around.current.groupName + ' · ' + around.current.optionLabel">
                {{ around.total > 1 ? 'Kleur ' + (around.index + 1) + '/' + around.total : 'Product' }}
              </small>
              <a class="product-nav__btn" [class.product-nav__btn--off]="!around.next"
                 [routerLink]="around.next ? ['/products', around.next.productId] : null"
                 [attr.aria-disabled]="!around.next"
                 [attr.aria-label]="around.next
                   ? (around.nextChangesProduct ? 'Volgend product: ' + around.next.groupName : 'Volgende kleur: ' + around.next.optionLabel)
                   : 'Geen volgend product'"
                 [title]="around.next
                   ? (around.nextChangesProduct ? 'Volgend product: ' + around.next.groupName : 'Volgende kleur: ' + around.next.optionLabel)
                   : 'Dit is het laatste product'">›</a>
            </span>
          }
          <a class="btn btn--primary btn--sm" [routerLink]="['/products', product.id, 'edit']">
            Bewerken
          </a>
        </app-page-header>
      }

      <div class="content product-view-page erp-workspace erp-workspace--product erp-workspace--view">
        <div class="product-view-canvas erp-workspace__main">
          <section class="pd-overview" id="product-overview" aria-labelledby="product-title">
            @if (!desktop.active()) {
              <div class="pd-bar">
                <button class="pd-back" type="button" aria-label="Terug" (click)="goBack()"><span aria-hidden="true">‹</span></button>
                <span>{{ categoryName() || 'Catalogus' }}</span>
                <span class="pd-status" [class.pd-status--warn]="!product.active || product.demo">{{ product.active ? (product.demo ? 'Demo' : 'Actief') : 'Inactief' }}</span>
              </div>
            }
            <div class="pd-identity">
              @if (desktop.active()) {
                <div class="pd-eyebrow"><span>{{ categoryName() || 'Catalogus' }}</span><span class="pd-status" [class.pd-status--warn]="!product.active || product.demo">{{ product.active ? (product.demo ? 'Demo' : 'Actief') : 'Inactief' }}</span></div>
              }
              <h1 id="product-title">{{ product.name }}</h1>
              @if (product.colour || product.variantSize) {
                <p class="pd-option">@if (product.colourHex) { <i [style.backgroundColor]="product.colourHex" aria-hidden="true"></i> }{{ product.colour }}@if (product.colour && product.variantSize) { · }{{ product.variantSize }}</p>
              }
              @if (product.sku) { <p class="pd-sku">{{ product.sku }}</p> }
              @if (supplierName(); as name) { <a class="pd-supplier" [routerLink]="['/suppliers']" [queryParams]="{ q: name }">{{ name }} <span aria-hidden="true">↗</span></a> }
            </div>

            <div class="pd-gallery" role="region" aria-roledescription="carousel" [attr.aria-label]="'Foto’s van ' + product.name">
              @if (product.photos[galleryIndex()] || product.photos[0]; as photo) {
                <button class="pd-photo" type="button" (click)="openCurrentGalleryPhoto()"
                        (pointerdown)="startGallerySwipe($event, product.photos.length)" (pointerup)="finishGallerySwipe($event, product.photos.length)" (pointercancel)="cancelGallerySwipe()"
                        (keydown.arrowleft)="stepGallery(-1, product.photos.length); $event.preventDefault()" (keydown.arrowright)="stepGallery(1, product.photos.length); $event.preventDefault()"
                        (keydown.home)="selectGalleryPhoto(0); $event.preventDefault()" (keydown.end)="selectGalleryPhoto(product.photos.length - 1); $event.preventDefault()"
                        aria-keyshortcuts="ArrowLeft ArrowRight Home End" [attr.aria-label]="'Foto ' + (galleryIndex() + 1) + ' van ' + product.photos.length + ' vergroten'">
                  <img [appAuthSrc]="photo.mediumUrl || photo.url" appAuthSize="medium" [alt]="product.name + ' — foto ' + (galleryIndex() + 1)" draggable="false" />
                  <span class="pd-photo-count">{{ galleryIndex() + 1 }} / {{ product.photos.length }} <span aria-hidden="true">⤢</span></span>
                </button>
                @if (product.photos.length > 1) {
                  <div class="pd-thumbnails" aria-label="Kies een foto, dezelfde variant">
                    @for (item of product.photos; track item.id) {
                      <button type="button" [class.is-selected]="$index === galleryIndex()" [attr.aria-pressed]="$index === galleryIndex()" [attr.aria-label]="'Toon foto ' + ($index + 1)" (click)="selectGalleryPhoto($index)">
                        <img [appAuthSrc]="item.url" alt="" draggable="false" loading="lazy" />
                      </button>
                    }
                  </div>
                }
                <span class="sr-only" role="status" aria-live="polite">Foto {{ galleryIndex() + 1 }} van {{ product.photos.length }}</span>
              } @else {
                <div class="pd-no-photo"><app-icon name="media" [size]="30" /><span>Nog geen foto</span><small>Toevoegen via Bewerken</small></div>
              }
            </div>

            @if (familyLoading()) {
              <div class="pd-variants pd-variant-state" role="status">Varianten laden…</div>
            } @else if (familyLoadError()) {
              <div class="pd-variants pd-variant-state" role="alert"><span>Varianten niet geladen.</span><button class="btn btn--sm" type="button" (click)="retryFamily()">Opnieuw proberen</button></div>
            } @else if (variantMembers().length > 1) {
              <section class="pd-variants" aria-labelledby="variant-links-title">
                <div class="pd-section-label"><b id="variant-links-title">Variant</b><span>{{ variantMembers().length }} in deze reeks</span></div>
                <div class="pd-variant-rail" #variantRail>
                  @for (member of variantMembers(); track member.productId) {
                    @if (member.productId === product.id) {
                      <span class="pd-variant is-current" aria-current="page">@if (member.colourHex) { <i [style.backgroundColor]="member.colourHex" aria-hidden="true"></i> }{{ variantOptionLabel(member) }}<span aria-hidden="true">✓</span></span>
                    } @else {
                      <a class="pd-variant" [routerLink]="['/products', member.productId]">@if (member.colourHex) { <i [style.backgroundColor]="member.colourHex" aria-hidden="true"></i> }{{ variantOptionLabel(member) }}</a>
                    }
                  }
                </div>
              </section>
            }

            <div class="pd-facts">
              <div class="pd-fact">
                <small>Voorraad</small>
                @if (stockLevels()) { <strong class="num" [class.warn-text]="stockTotal() < 0">{{ stockTotal() | num }} <em>{{ salesUnit(product).short }}</em></strong><span>{{ stockSummary() === salesUnit(product).plural ? 'in voorraad' : stockSummary() }}</span> }
                @else if (product.inventoryKnown) { <strong class="num" [class.warn-text]="product.stockQuantity < 0">{{ product.stockQuantity | num }} <em>{{ salesUnit(product).short }}</em></strong><span>in voorraad</span> }
                @else { <strong>—</strong><span>Nog niet bevestigd</span> }
              </div>
              <div class="pd-fact pd-fact--price">
                <small>Catalogusprijs</small>
                @if (primaryPrice(product, displayPrice()); as primary) { <strong class="num">{{ primary.price | eur: 2 }}</strong> } @else { <strong>—</strong> }
                @if (primaryPrice(product, displayPrice()); as primary) { <span>per {{ primary.singular }} · excl. btw</span> }
                @if (secondaryPrice(product, displayPrice()); as equivalent) {
                  <span>{{ equivalent.price | eur: 2 }} {{ equivalent.label }} · {{ equivalent.piecesPerDisplay }} stuks/display</span>
                }
              </div>
            </div>
            @if (expected(); as exp) {
              <a class="pd-expected" [routerLink]="['/purchasing', exp.orderIds[0]]" [attr.title]="'Open ' + exp.orderNumbers.join(', ')"><span>{{ exp.quantity | num }} {{ salesUnit(product).plural }} onderweg</span><small>{{ exp.expectedArrival ? 'Verwacht ' + (exp.expectedArrival | dateNl) : 'Bekijk inkooporder' }} ›</small></a>
            }
            <app-photo-lightbox [photos]="product.photos" [(index)]="lightbox" />
          </section>

          <!-- Desktop: the build-up or the stock book unfolds in its own
               panel right under the hero; on a phone they come up as sheets. -->
          @if (priceOpen() && desktop.active()) {
            <section class="fold-panel" aria-label="Prijsopbouw">
              <ng-container *ngTemplateOutlet="priceBuildTpl" />
            </section>
          }
          <ng-template #priceBuildTpl>
            <div class="stock-book price-build" role="region" aria-label="Prijsopbouw">
              @if (priceBuild(); as build) {
                <dl class="price-build__list">
                  @for (row of build.rows; track row.label) {
                    <div [class.price-build__sum]="row.sum" [class.price-build__note]="row.note"
                         [class.price-build__aside]="row.aside">
                      <dt>{{ row.label }}@if (row.hint) { <small>{{ row.hint }}</small> }</dt>
                      <dd class="num">{{ row.eur | eur: 2 }}</dd>
                    </div>
                  }
                </dl>
                @if (build.source) {
                  <p class="price-build__source">
                    Kostprijs uit calculatie <b>{{ build.source }}</b>{{ build.sourceFound ? '' : ' - die calculatie is niet meer beschikbaar, dus zonder uitsplitsing' }}.
                  </p>
                } @else {
                  <p class="price-build__source">Nog geen kostprijs uit een inkoopcalculatie; transport en invoerrechten komen erbij zodra een calculatie is toegepast.</p>
                }
              } @else {
                <p class="hint">Prijsopbouw laden…</p>
              }
            </div>
          </ng-template>

          <div class="details-grid erp-workspace__layout">
            <div class="details-col erp-workspace__main">
            <section class="info-card info-card--internal product-dossier-card erp-workspace__section"
                     id="product-core" aria-labelledby="dossier-title">
              <header class="erp-workspace__section-head">
                <span class="info-card__icon" aria-hidden="true"><app-icon name="products" [size]="19" /></span>
                <div><h2 id="dossier-title">Product &amp; prijzen</h2><p>Identificatie, inkoop en verkoop</p></div>
              </header>

              <div class="tiles-kicker tiles-kicker--first">Identificatie</div>
              <div class="tiles">
                <div class="tile"><span>Afmeting B × D × H</span><b class="num">{{ size(product.dimensions) }}</b></div>
                <div class="tile"><span>Gewicht per stuk</span>
                  <b class="num">{{ product.dimensions.weightKg ? (product.dimensions.weightKg | kg) : '—' }}</b></div>
                @if (product.packaging.kind !== 'NONE') {
                  <div class="tile"><span>{{ product.packaging.kind === 'DISPLAY' ? 'Display' : 'Geschenkverpakking' }} B × D × H</span>
                    <b class="num">{{ size(product.packaging.dimensions) }}</b></div>
                  @if (product.packaging.piecesPerUnit) {
                    <div class="tile"><span>Stuks in de {{ product.packaging.kind === 'DISPLAY' ? 'display' : 'geschenkverpakking' }}</span>
                      <b class="num">{{ product.packaging.piecesPerUnit | num }}</b></div>
                  }
                  <div class="tile"><span>Gewicht {{ product.packaging.kind === 'DISPLAY' ? 'display' : 'geschenkverpakking' }}</span>
                    <b class="num">{{ product.packaging.dimensions.weightKg ? (product.packaging.dimensions.weightKg | kg) : '—' }}</b></div>
                  @if (product.packaging.barcode; as code) {
                    <div class="tile"><span>Barcode {{ product.packaging.kind === 'DISPLAY' ? 'display' : 'geschenkverpakking' }}</span>
                      <b class="mono">
                        <button class="barcode-link" type="button" [title]="'Barcode-afbeelding (300 dpi) van ' + code"
                                (click)="downloadBarcode(code)">
                          {{ code }}
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6v12M7 6v12M10 6v12M13 6v12M16 6v12M19 6v12" /></svg>
                        </button>
                      </b></div>
                  }
                }
                <div class="tile"><span>Barcode stuk</span>
                  <b class="mono">
                    <!-- The code as a print-ready image: for the label printer,
                         the supplier or the designer. -->
                    @if (product.barcodeInner; as code) {
                      <button class="barcode-link" type="button" [title]="'Barcode-afbeelding (300 dpi) van ' + code"
                              (click)="downloadBarcode(code)">
                        {{ code }}
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6v12M7 6v12M10 6v12M13 6v12M16 6v12M19 6v12" /></svg>
                      </button>
                    } @else { — }
                  </b></div>
              </div>

              <!-- Purchase and sale share one grid, so the pairs land next to
                   each other: the two inputs, then cost against price, the
                   paperwork, and the margin as the full-width closer. -->
              <div class="tiles-kicker">Inkoop &amp; verkoop</div>
              <div class="tiles">
                <div class="tile"><span>EXW-prijs</span><b class="num">
                  @if (product.exwPrice; as price) { {{ price | cur: product.exwCurrency }} } @else { — }
                </b><small>fabrieksprijs, excl. transport</small></div>
                <div class="tile"><span>Extra kost per {{ salesUnit(product).singular }}</span><b class="num">
                  @if (product.extraUnitCost; as extra) { {{ extra | cur: product.exwCurrency }} } @else { — }
                </b><small>bv. display of giftbox</small></div>
                <button class="tile tile--price" type="button" (click)="openPriceInfo(product)">
                  <i class="tile-chev" aria-hidden="true"></i>
                  <span>Kostprijs incl. rechten</span><b class="num">
                  @if (product.landedCostEur; as landed) { {{ landed | eur: 2 }} } @else { — }
                </b><small>geland: mét transport en invoer</small></button>
                <button class="tile tile--price" type="button" (click)="openPriceInfo(product)">
                  <i class="tile-chev" aria-hidden="true"></i>
                  <span>Catalogusprijs per {{ salesUnit(product).singular }}</span><b class="num">
                  @if (displayPrice(); as price) { {{ price | eur: 2 }} } @else { — }
                </b><small>{{ hasFixedSalesPrice(product)
                  ? 'vaste verkoopprijs'
                  : 'kostprijs + ' + (product.markupPct | num) + ' % opslag' }}</small></button>
                <div class="tile"><span>HS-code</span><b class="mono">{{ product.hsCode || '—' }}</b></div>
                @if (sourceOrderId(); as orderId) {
                  <a class="tile tile--link" [routerLink]="['/purchasing', orderId]">
                    <span>Bron kostprijs</span><b>{{ product.landedCostSource }} ›</b>
                  </a>
                } @else {
                  <div class="tile"><span>Bron kostprijs</span><b>{{ product.landedCostSource || '—' }}</b></div>
                }
                <button class="tile tile--price tile--price-result" type="button" (click)="openPriceInfo(product)">
                  <i class="tile-chev" aria-hidden="true"></i>
                  <span>Marge per {{ salesUnit(product).singular }}</span>
                  @if (margin(); as value) {
                    <b class="num" [class.warn-text]="value.eur < 0">{{ value.eur | eur: 2 }} · {{ value.pct }} %</b>
                  } @else {
                    <b class="muted">Niet beschikbaar</b>
                  }
                  <small>catalogusprijs min kostprijs</small></button>
              </div>
            </section>
            <section class="info-card info-card--internal agreement-card erp-workspace__section"
                     id="product-agreements" aria-labelledby="supplier-agreement-card-title">
              <header class="erp-workspace__section-head">
                <span class="info-card__icon" aria-hidden="true"><app-icon name="pdf" [size]="19" /></span>
                <div>
                  <h2 id="supplier-agreement-card-title">Afspraken leverancier</h2>
                  <p>Engelse instructies en PDF-referentiefoto’s</p>
                </div>
                @if (product.id !== null) {
                  <a class="agreement-edit" [routerLink]="['/products', product.id, 'edit']"
                     [queryParams]="{ tab: 'agreements' }">Bewerk ›</a>
                }
              </header>

              <div class="agreement-private" role="note">
                <i aria-hidden="true">●</i>
                <span><b>Alleen leverancier</b><small>Nooit online of in de websitegalerij</small></span>
              </div>

              @if (supplierAgreement(); as agreement) {
                @if (!agreement.available) {
                  <p class="agreement-state" role="note">{{ !product.supplierId ? 'Kies eerst een leverancier via Bewerken om afspraken vast te leggen.' : agreement.inherited ? 'Deze gedeelde afspraak past niet meer bij de leverancier of productreeks. Controleer de koppeling via Bewerken.' : 'De leveranciersafspraak is niet beschikbaar. Controleer de leverancier via Bewerken.' }}</p>
                } @else if (agreement.variants.length > 1) {
                  <p class="pd-agreement-scope"><b>Gedeelde afspraak</b><span>{{ agreementVariantNames() }}</span>
                    @if (agreement.inherited) { <a [routerLink]="['/products', agreement.sourceProductId]" fragment="product-agreements">Bronproduct bekijken ›</a> }
                  </p>
                }
              }
              @if (supplierNoteBlocks().length) {
                <div class="agreement-instruction">
                  <span>Product instruction (English)</span>
                  <div class="agreement-note" lang="en">
                    @for (block of supplierNoteBlocks(); track $index) {
                      @if (block.kind === 'p') {
                        <p>{{ block.text }}</p>
                      } @else {
                        <ul>
                          @for (item of block.items; track $index) {
                            <li>{{ item.text }}
                              @if (item.children.length) {
                                <ul>@for (sub of item.children; track $index) { <li>{{ sub }}</li> }</ul>
                              }
                            </li>
                          }
                        </ul>
                      }
                    }
                  </div>
                </div>
              }

              @if (agreementLoading()) {
                <p class="agreement-state" role="status">Leveranciersafspraak laden…</p>
              } @else if (agreementLoadError(); as agreementError) {
                <div class="agreement-state agreement-state--error" role="alert">
                  <span>{{ agreementError }}</span>
                  <button class="btn btn--sm" type="button" (click)="retrySupplierAgreement()">
                    Opnieuw proberen
                  </button>
                </div>
              } @else if (agreementPhotos().length) {
                <ol class="agreement-gallery" aria-label="Afspraakfoto’s in PDF-volgorde">
                  @for (photo of agreementPhotos(); track photo.id; let i = $index) {
                    <li>
                      <button type="button" (click)="agreementLightbox.set(i)"
                              [attr.aria-label]="'Afspraakfoto ' + (i + 1) + ' vergroten'">
                        <img [appAuthSrc]="photo.viewUrl"
                             [alt]="photo.caption || photo.originalFilename" loading="lazy" />
                        <span>Reference {{ i + 1 }}</span>
                      </button>
                      @if (photo.caption) { <p lang="en">{{ photo.caption }}</p> }
                    </li>
                  }
                </ol>
              } @else if (!supplierNoteBlocks().length && supplierAgreement()?.available !== false) {
                <p class="agreement-state">Nog geen productspecifieke afspraken voor deze leverancier.</p>
              }
            </section>
            <app-product-supplier-agreement-photo-viewer class="agreement-viewer"
              [photos]="agreementPhotos()" [(index)]="agreementLightbox" />
            </div>
            <div class="details-col erp-workspace__aside">
            <section class="info-card omdoos-card erp-workspace__section"
                     id="product-packaging" aria-labelledby="carton-details-title">
              <header class="erp-workspace__section-head">
                <span class="info-card__icon" aria-hidden="true"><app-icon name="purchase" [size]="19" /></span>
                <div><h2 id="carton-details-title">Omdoos</h2><p>Verpakking en logistiek</p></div>
              </header>
              <div class="tiles">
                <div class="tile"><span>Karton B × D × H</span><b class="num">{{ size(product.carton) }}</b></div>
                <div class="tile"><span>Inhoud</span><b class="num">
                  @if (cartonPiecesAuto(product)) { <small class="muted">auto</small> }
                  {{ product.carton.piecesPerCarton | num }} {{ salesUnit(product).plural }}</b>@if (quantityDetail(product, product.carton.piecesPerCarton ?? 0); as detail) { <small>{{ detail }}</small> }</div>
                <div class="tile"><span>Gewicht</span><b class="num">
                  @if (product.carton.weightKg) {
                    @if (cartonWeightAuto(product)) { <small class="muted">auto</small> }
                    {{ product.carton.weightKg | kg }}
                  } @else { — }
                </b></div>
                <div class="tile"><span>Volume</span><b class="num">
                  @if (product.cartonCbm) { {{ product.cartonCbm | cbm }} } @else { — }
                </b></div>
                <div class="tile"><span>Per 20ft GP</span><b class="num">
                  @if (gpCapacity().value !== null) {
                    {{ gpCapacity().value | num }} {{ salesUnit(product).plural }}
                    <small class="muted" [title]="gpCapacityHint(gpCapacity(), product.carton)">{{ isAutoGpCapacity(gpCapacity()) ? 'Auto' : 'handmatig bevestigd' }}</small>
                  } @else { — }
                </b></div>
                <div class="tile"><span>Per 40' HC</span><b class="num">
                  @if (product.carton.hcCapacity; as hc) {
                    @if (!product.carton.piecesPerHc) { <small class="muted">auto</small> }
                    {{ hc | num }} {{ salesUnit(product).plural }}
                  } @else { — }
                </b></div>
                <div class="tile"><span>Omdoosbarcode</span><b class="mono">
                  @if (product.barcodeOuter; as code) {
                    @if (code.length === 13) {
                      <button class="barcode-link" type="button" [title]="'Barcode-afbeelding (300 dpi) van ' + code"
                              (click)="downloadBarcode(code)">
                        {{ code }}
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6v12M7 6v12M10 6v12M13 6v12M16 6v12M19 6v12" /></svg>
                      </button>
                    } @else { {{ code }} }
                  } @else { — }
                </b></div>
              </div>
            </section>
            <section class="info-card erp-workspace__section" id="stock-card" aria-labelledby="stock-card-title">
              <header class="erp-workspace__section-head">
                <span class="info-card__icon" aria-hidden="true"><app-icon name="stock" [size]="19" /></span>
                <div><h2 id="stock-card-title">Voorraad</h2><p>Locaties en laatste bewegingen</p></div>
                @if (stockLevels()) {
                  <strong class="stock-card__total num" [class.warn-text]="stockTotal() <= 0">
                    {{ stockTotal() | num }}
                  </strong>
                }
              </header>
              <div class="stock-rows stock-rows--card">
                @if (stockLevels(); as levels) {
                  @for (level of levels; track level.locationId) {
                    <div class="stock-row">
                      <span class="stock-row__where">
                        <b>{{ level.name }}</b>
                        <small>{{ level.kindLabel }}{{ level.countsForWebsite ? ' · alle verkoopkanalen' : ' · enkel ter plaatse' }}</small>
                      </span>
                      <strong class="num stock-row__qty" [class.muted]="!level.quantity">{{ level.quantity | num }}</strong>
                    </div>
                  }
                }
                @if (recentMoves(); as moves) {
                  @if (moves.length) { <div class="stock-rows__head">Laatste bewegingen</div> }
                  @for (move of moves; track move.id) {
                    <div class="stock-row stock-row--move">
                      <span class="stock-row__where">
                        <b>{{ move.kindLabel }}@if (move.reference) { · {{ move.reference }}}</b>
                        <small>{{ move.at | dateTimeNl }} · {{ move.actor }}@if (move.locationName) { · {{ move.locationName }}}</small>
                      </span>
                      <strong class="num stock-row__delta" [class.stock-row__delta--minus]="move.delta < 0">{{ move.delta > 0 ? '+' : '' }}{{ move.delta | num }}</strong>
                    </div>
                  }
                }
                @if (!allMovesOpen() && hiddenMoves() > 0) {
                  <button class="stock-more" type="button" (click)="allMovesOpen.set(true)">
                    Meer ({{ hiddenMoves() }}) ›
                  </button>
                }
                <div class="stock-row__actions">
                  <button type="button" (click)="correctOpen.set(true)">Corrigeren</button>
                  <button type="button" (click)="openTakeout('DAMAGED')">Beschadigd</button>
                  <button type="button" (click)="openTakeout('SHORTAGE')">Te weinig</button>
                  <button type="button" (click)="openTakeout('DEMO')">Demo</button>
                </div>
              </div>
            </section>
            </div>
          </div>

          @if (receiptIssues().length) {
            <section class="info-card info-card--internal erp-workspace__section" id="product-issues" aria-labelledby="product-issues-title">
              <header class="erp-workspace__section-head">
                <span class="info-card__icon" aria-hidden="true">!</span>
                <div><h2 id="product-issues-title">Eerder schade of tekort</h2><p>Staat als waarschuwing op de volgende leveranciersorder</p></div>
              </header>
              <ul class="issue-list">
                @for (issue of receiptIssues(); track issue.orderId) {
                  <li>
                    <a [routerLink]="['/purchasing', issue.orderId]">{{ issue.orderNumber }}</a>
                    <small>{{ issue.receivedOn ? (issue.receivedOn | dateNl) : '—' }} · {{ issue.ordered | num }} besteld · {{ issue.received | num }} ontvangen@if (issue.damaged) { · {{ issue.damaged | num }} beschadigd }@if (issue.missing) { · {{ issue.missing | num }} te weinig }@if (issue.laterDamaged || issue.laterMissing) { · na uitpakken gemeld: @if (issue.laterDamaged) { {{ issue.laterDamaged | num }} beschadigd }@if (issue.laterDamaged && issue.laterMissing) { en }@if (issue.laterMissing) { {{ issue.laterMissing | num }} te weinig } }</small>
                    @if (issue.note) { <em>{{ issue.note }}</em> }
                    @if (issue.laterNote) { <em>{{ issue.laterNote }}</em> }
                  </li>
                }
              </ul>
            </section>
          }
          @if (product.id !== null) {
            <app-product-media-card class="info-card erp-workspace__section" id="product-media"
                                    [productId]="product.id" [compact]="!desktop.active()" />
          }

          @if (desktop.active()) {
          <details class="info-card publication-card erp-workspace__section" id="product-publication">
            <summary>
              <span class="info-card__icon" aria-hidden="true">WEB</span>
              <span class="publication-card__heading">
                <b>Website &amp; publicatie</b>
                <small>{{ publicationSummary() }}</small>
              </span>
              @if (!familyLoading() && !familyLoadError() && publicationIssues().length) {
                <span class="badge badge--warn">{{ publicationIssues().length }} aandacht</span>
              }
              @if (familyLoadError()) {
                <span class="badge badge--warn">niet geladen</span>
              }
              <span class="publication-card__chev" aria-hidden="true">⌄</span>
            </summary>
            <div class="publication-card__body" aria-live="polite">
              @if (familyLoading()) {
                <p class="publication-loading">Publicatiestatus en varianten laden…</p>
              } @else if (familyLoadError()) {
                <div class="family-load-error" role="alert">
                  <div>
                    <b>Publicatiestatus niet geladen</b>
                    <p>De dagelijkse productgegevens hierboven zijn wel beschikbaar.</p>
                  </div>
                  <button class="btn btn--sm" type="button" (click)="retryFamily()">Opnieuw proberen</button>
                </div>
              } @else {
                <div class="publication-strip">
                  <div class="publication-strip__main">
                    <span>Publieke productpagina</span>
                    @if (publicHandle()) {
                      <strong class="mono">/products/{{ publicHandle() }}</strong>
                    } @else {
                      <strong>Nog geen publieke URL</strong>
                    }
                  </div>
                  <div class="publication-strip__states" aria-label="Verkoopkanalen">
                    <span [class.live]="publicationActive() && websiteStatus() === 'PUBLISHED'">Website</span>
                    <span [class.live]="publicationActive() && orderAppStatus() === 'PUBLISHED'">Orderapp</span>
                  </div>
                </div>

                @if (publicationIssues().length) {
                  <div class="publication-alert">
                    <span aria-hidden="true">!</span>
                    <div>
                      <b>{{ publicationIssues().length }} punt(en) voor publicatie</b>
                      <p>Open Bewerken en daarna Website &amp; publicatie om ze op te lossen.</p>
                    </div>
                  </div>
                }

                @if (family(); as family) {
                  <div class="website-copy">
                    <span>Websitecopy</span>
                    <b>{{ family.name }}</b>
                    @if (family.summary) { <p>{{ family.summary }}</p> }
                    @if (family.description) { <p>{{ family.description }}</p> }
                    <small>
                      {{ family.collectionKey || family.categoryName || 'Geen collectie' }}
                      · geldt voor alle gekoppelde producten
                    </small>
                  </div>
                } @else {
                  <p class="publication-loading">Voor dit product zijn nog geen gedeelde websitegegevens gestart.</p>
                }

                @if (product.id !== null) {
                  <a class="btn btn--primary public-copy-cta"
                     [routerLink]="['/products', product.id, 'translations']">
                    Publieke naam &amp; vertalingen aanpassen
                  </a>
                }
              }
            </div>
          </details>
          }
        </div>
      </div>
      @if (!desktop.active()) {
        <nav class="erp-workspace__mobile-actions product-view-dock" aria-label="Productacties">
          <a class="btn btn--primary erp-workspace__primary" [routerLink]="['/products', product.id, 'edit']">
            Bewerken
          </a>
        </nav>
      }
      <!-- Phone: the build-up and the stock book come up as sheets, not
           somewhere further down the page. -->
      @if ((priceOpen() && !desktop.active()) || priceInfoOpen()) {
        <app-sheet [title]="priceTab() === 'history' ? 'Kostprijshistoriek' : 'Prijsopbouw'" (closed)="closePriceInfo()">
          <div body>
            <div class="per-toggle price-tabs" role="group" aria-label="Prijsdetail">
              <button type="button" [class.on]="priceTab() === 'build'" (click)="priceTab.set('build')">Opbouw</button>
              <button type="button" [class.on]="priceTab() === 'history'" (click)="priceTab.set('history')">Historiek</button>
            </div>
            @if (priceTab() === 'history') {
              @if (product.id; as id) { <app-product-cost-history [productId]="id" /> }
            } @else {
              <ng-container *ngTemplateOutlet="priceBuildTpl" />
            }
          </div>
          <div foot style="display:contents">
            <span class="spacer"></span>
            <button class="btn" type="button" (click)="closePriceInfo()">Sluiten</button>
          </div>
        </app-sheet>
      }

      <!-- Broken or given away as demo: the piece leaves the shelf with a
           note that says why - right here, not in the editor. -->
      @if (takeout(); as out) {
        <app-sheet [title]="takeoutTitle(out.kind)" (closed)="takeout.set(null)">
          <div body>
            <div class="per-toggle takeout-kind" role="group" aria-label="Wat is er gebeurd?">
              <button type="button" [class.on]="out.kind === 'DAMAGED'"
                      (click)="takeout.set({ ...out, kind: 'DAMAGED' })">Stuk / beschadigd</button>
              <button type="button" [class.on]="out.kind === 'SHORTAGE'"
                      (click)="takeout.set({ ...out, kind: 'SHORTAGE' })">Te weinig geleverd</button>
              <button type="button" [class.on]="out.kind === 'DEMO'"
                      (click)="takeout.set({ ...out, kind: 'DEMO', purchaseOrderId: null })">Demo</button>
            </div>
            @if (out.kind !== 'DEMO') {
              <div class="field mt-12">
                <label for="out-po">Uit welke container? <span class="opt"></span></label>
                <select class="select" id="out-po"
                        (change)="takeout.set({ ...out, purchaseOrderId: $any($event.target).value ? +$any($event.target).value : null })">
                  <option value="" [selected]="out.purchaseOrderId === null">Niet aan een container gekoppeld</option>
                  @for (order of receivedOrders(); track order.id) {
                    <option [value]="order.id" [selected]="out.purchaseOrderId === order.id">{{ containerLabel(order) }}</option>
                  }
                </select>
                <small class="takeout-hint">{{ out.purchaseOrderId === null
                  ? 'Gekoppeld aan een container komt de melding in het dossier van die order en als waarschuwing op de volgende leveranciersorder.'
                  : 'De melding komt in het dossier van deze container en op de volgende leveranciersorder van dit product.' }}</small>
              </div>
            }
            <div class="form-grid mt-12">
              @if ((stockLevels() ?? []).length > 1) {
                <div class="field">
                  <label for="out-loc">Locatie</label>
                  <select class="select" id="out-loc"
                          (change)="takeout.set({ ...out, locationId: +$any($event.target).value })">
                    @for (level of stockLevels(); track level.locationId) {
                      <option [value]="level.locationId" [selected]="out.locationId === level.locationId">
                        {{ level.name }} ({{ level.quantity | num }})
                      </option>
                    }
                  </select>
                </div>
              }
              <div class="field">
                <label class="req" for="out-qty">Aantal</label>
                <input class="input num right" id="out-qty" type="number" min="1" step="1" inputmode="numeric"
                       [value]="out.quantity || ''"
                       (input)="takeout.set({ ...out, quantity: +$any($event.target).value })" />
              </div>
              <div class="field span-2">
                <label for="out-note">Notitie <span class="opt"></span></label>
                <input class="input" id="out-note"
                       [placeholder]="out.kind === 'DAMAGED' ? 'bijv. gebarsten bij het uitpakken' : out.kind === 'SHORTAGE' ? 'bijv. doos 12 bevatte 18 in plaats van 24' : 'bijv. klant Janssens'"
                       [value]="out.note"
                       (input)="takeout.set({ ...out, note: $any($event.target).value })" />
              </div>
            </div>
          </div>
          <div foot style="display:contents">
            <span class="spacer"></span>
            <button class="btn" type="button" (click)="takeout.set(null)">Annuleren</button>
            <button class="btn btn--primary" type="button" [disabled]="stockSaving() || !(out.quantity > 0)"
                    (click)="confirmTakeout()">{{ stockSaving() ? 'Bezig…' : 'Melden' }}</button>
          </div>
        </app-sheet>
      }

      <!-- A recount: type the number, it books as a correction at once. -->
      @if (correctOpen()) {
        <app-sheet title="Voorraad corrigeren" (closed)="correctOpen.set(false)">
          <div body>
            <div class="correct-levels">
              @for (level of stockLevels(); track level.locationId) {
                <label class="correct-levels__tile">
                  <small>{{ level.name }}</small>
                  <input class="correct-levels__qty num" type="number" min="0" step="1" inputmode="numeric"
                         [attr.aria-label]="level.name" [value]="level.quantity"
                         (keydown.enter)="$any($event.target).blur()"
                         (change)="bookCorrection(level.locationId, $any($event.target))" />
                </label>
              }
            </div>
            <p class="hint">Tik een getal aan en het wordt meteen als correctie geboekt.</p>
          </div>
          <div foot style="display:contents">
            <span class="spacer"></span>
            <button class="btn" type="button" (click)="correctOpen.set(false)">Sluiten</button>
          </div>
        </app-sheet>
      }

    } @else {
      <app-page-header title="Product" subtitle="Laden…" [showBack]="true" [showBell]="false" />
      <div class="content" role="status" aria-live="polite" aria-label="Product laden">
        <app-skeleton kind="card" [rows]="1" />
        <app-skeleton kind="stats" [rows]="3" />
        <app-skeleton kind="lines" [rows]="6" />
      </div>
    }
  `,
  styleUrl: './product-view-overview.scss',
  styles: `
    .product-view-page { background: transparent; }
    .product-view-canvas { display: block; width: 100%; max-width: 1080px; margin: 0 auto; }
    .product-view-page .erp-workspace__section, #product-overview { scroll-margin-top: calc(var(--appbar-h) + 16px); }
    .product-view-dock .erp-workspace__primary { flex: 1; }
    .fold-panel { margin-top: 10px; padding: 6px 14px 12px; border: 1px solid rgb(255 255 255 / 70%);
      border-radius: var(--r); background: var(--surface); box-shadow: var(--sh-1); animation: rise .18s ease backwards; }
    .fold-panel .stock-book { margin-top: 4px; padding: 0; border: 0; background: transparent; }

    /* Detail tiles: label above value, hairline grid, the inkoop idiom. */
    .tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; background: var(--line); }
    .tile { min-width: 0; display: flex; flex-direction: column; gap: 1px; padding: 10px 13px; background: var(--surface); }
    .tiles > .tile:last-child:nth-child(odd) { grid-column: 1 / -1; }
    .tile > span { color: var(--muted); font-size: 9px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; }
    .tile > b { font-size: 12.5px; font-weight: 650; overflow-wrap: anywhere; }
    button.tile { border: 0; font: inherit; color: inherit; text-align: left; cursor: pointer; }
    a.tile { color: inherit; text-decoration: none; }
    a.tile:hover > b { text-decoration: underline dotted; }
    button.tile:hover > b { text-decoration: underline dotted; }
    button.tile:active { opacity: .75; }
    /* The buying-and-selling money tiles carry only a whisper of the
       house brown, with the chevron ring saying they open. */
    .tile--price { position: relative; padding-right: 34px; background: var(--rose-soft); }
    .tile--price > b { font-weight: 800; }
    .tile-chev { position: absolute; top: 9px; right: 9px; display: grid; place-items: center;
      width: 20px; height: 20px; border-radius: 50%; background: var(--surface); color: var(--rose-dark);
      box-shadow: 0 1px 3px rgb(26 22 20 / 10%); }
    .tile-chev::before { content: ''; width: 6px; height: 6px; margin-left: -2px;
      border-right: 1.6px solid currentColor; border-bottom: 1.6px solid currentColor; transform: rotate(-45deg); }
    .tile > small { margin-top: 1px; color: var(--muted); font-size: 9.5px; line-height: 1.35; }
    .tile .muted { font-size: 10px; font-weight: 500; }
    .tile--price-result { align-items: center; text-align: center; }
    .tile--price-result > b { color: var(--ok); }
    .tile--price-result > b.warn-text { color: var(--danger); }
    .tiles-kicker { padding: 11px 13px 4px; border-top: 1px solid var(--line); background: var(--surface);
      color: var(--warn); font-size: 9px; font-weight: 780; letter-spacing: .09em; text-transform: uppercase; }
    .tiles-kicker--first { border-top: 0; }
    .stock-rows--sheet { margin-top: 4px; }
    .stock-rows__head { padding: 10px 2px 4px; color: var(--muted); font-size: 10px; font-weight: 750; letter-spacing: .07em; text-transform: uppercase; }
    .stock-rows--sheet .stock-row__actions { gap: 8px; padding-top: 12px; }
    .stock-rows--sheet .stock-row__actions a { padding: 8px 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); font-size: 12.5px; }
    .stock-rows { margin-top: 10px; border-top: 1px solid var(--line); }
    .stock-rows--card { margin-top: 0; padding: 2px 14px 10px; border-top: 0; }
    .stock-card__total { font-size: 17px; font-weight: 800; letter-spacing: -.02em; }
    .stock-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 2px;
      border-bottom: 1px solid var(--line); }
    .stock-row__where { display: grid; min-width: 0; }
    .stock-row__where b { font-size: 13px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .stock-row__where small { color: var(--muted); font-size: 11px; }
    .stock-row__qty { font-size: 14px; font-weight: 750; }
    .stock-row--move .stock-row__where b { font-weight: 600; color: var(--ink-2); }
    .stock-row__delta { font-size: 13px; font-weight: 750; color: var(--ok, #2e7d4f); }
    .stock-row__delta--minus { color: var(--danger); }
    .stock-row__actions { display: flex; flex-wrap: wrap; gap: 14px; padding: 9px 2px 0; font-size: 12.5px; font-weight: 650; }
    .stock-row__actions button { padding: 0; border: 0; background: none; color: var(--rose-dark);
      font: inherit; font-size: 12.5px; font-weight: 650; cursor: pointer; }
    .stock-more { margin: 2px 0 0; padding: 6px 2px 0; border: 0; background: none; color: var(--muted);
      font: inherit; font-size: 12px; font-weight: 650; cursor: pointer; }
    .takeout-hint { display: block; margin-top: 5px; color: var(--muted); font-size: 12px; line-height: 1.4; }
    .takeout-kind { margin-bottom: 4px; }
    .correct-levels { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .correct-levels__tile { display: grid; gap: 3px; padding: 10px 11px; border: 1px solid var(--line);
      border-radius: 12px; background: var(--surface-2); }
    .correct-levels__tile small { color: var(--muted); font-size: 10px; font-weight: 700;
      letter-spacing: .05em; text-transform: uppercase; }
    .correct-levels__qty { width: 100%; border: 0; background: transparent; font: inherit;
      font-size: 16px; font-weight: 750; }

    .expected { color: var(--warn); font-style: normal; font-weight: 700; text-decoration: none; }
    /* On the water: always its own, last line under the stock. */
    .expected--line { display: block; margin-top: 2px; }
    a.expected:hover { text-decoration: underline; }
    .stock-book { margin-top: 9px; padding: 4px 13px 10px; border: 1px solid var(--line);
      border-radius: var(--r-sm); background: var(--surface-2); }
    .price-build__list { margin: 0; padding: 0; }
    .price-build__list > div { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px;
      align-items: baseline; padding: 7px 0; border-bottom: 1px solid var(--line); }
    .price-build__list > div:last-child { border-bottom: 0; }
    .price-build__list dt { color: var(--ink-2); font-size: 12px; }
    .price-build__list dt small { display: block; color: var(--muted); font-size: 10.5px; }
    /* Only the sums carry weight; the steps in between stay light. */
    .price-build__list dd { margin: 0; color: var(--ink-2); font-size: 12.5px; font-weight: 500;
      font-variant-numeric: tabular-nums; white-space: nowrap; }
    .price-build__sum { border-top: 1px solid var(--line-strong); margin-top: -1px; }
    .price-build__sum dt, .price-build__sum dd { color: var(--ink); font-weight: 750; }
    .price-build__note dt { color: var(--muted); font-weight: 500; font-size: 11.5px; }
    .price-build__note dd { color: var(--ok, #2e7d4f); font-weight: 700; }
    .price-build__aside dt, .price-build__aside dd { color: var(--muted); font-weight: 500; font-size: 11.5px; }
    .price-build__source { margin-top: 8px; color: var(--muted); font-size: 11px; line-height: 1.4; }
    .price-build__source b { color: var(--ink-2); }
    .stock-book__levels { list-style: none; margin: 6px 0 4px; padding: 0 0 6px; border-bottom: 1px solid var(--line-strong); }
    .stock-book__levels li { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 5px 0; font-size: 12.5px; }
    .stock-book__levels small { margin-left: 6px; padding: 0 6px; border-radius: 999px; background: var(--ok-soft); color: var(--ok); font-size: 10px; font-weight: 700; }
    .stock-book ol { list-style: none; margin: 0; padding: 0; }
    .stock-book li { display: grid; grid-template-columns: 56px 1fr auto; align-items: center; gap: 10px;
      padding: 8px 0; border-bottom: 1px solid var(--line); }
    .stock-book li:last-child { border-bottom: 0; }
    .stock-book__delta { font-weight: 750; color: var(--ok, #2e7d4f); }
    .stock-book__delta--minus { color: var(--danger); }
    .stock-book__what { display: grid; min-width: 0; }
    .stock-book__what b { font-weight: 650; font-size: 12.5px; }
    .stock-book__what small { color: var(--muted); font-size: 11px; }
    .stock-book__after { color: var(--muted); font-size: 12px; white-space: nowrap; }
    .stock-book__edit { display: inline-block; margin-top: 8px; color: var(--rose-dark);
      font-size: 12.5px; font-weight: 650; text-decoration: none; }
    .variant-swatch { width: 12px; height: 12px; border: 1px solid rgb(255 255 255 / 25%); border-radius: 50%; }

    .publication-strip { display: flex; align-items: center; justify-content: space-between; gap: 12px;
      margin-top: 16px; padding: 12px; border: 1px solid var(--rose-line);
      border-radius: var(--r-sm); background: var(--rose-soft); }
    .publication-strip__main { min-width: 0; display: flex; flex-direction: column; }
    .publication-strip__main > span { color: var(--muted); font-size: 9.5px; font-weight: 750;
      letter-spacing: .09em; text-transform: uppercase; }
    .publication-strip__main strong { font-size: 12.5px; }
    .publication-strip__states { flex: 0 0 auto; display: flex; flex-direction: column;
      align-items: flex-end; gap: 3px; }
    .publication-strip__states span { color: var(--muted); font-size: 10px; font-weight: 650; }
    .publication-strip__states span::before { display: inline-block; width: 7px; height: 7px;
      margin-right: 5px; border-radius: 50%; background: var(--muted-2); content: ''; }
    .publication-strip__states span.live { color: var(--ok); }
    .publication-strip__states span.live::before { background: var(--ok); box-shadow: 0 0 0 3px var(--ok-soft); }
    .publication-alert { display: flex; gap: 9px; margin-top: 9px; padding: 10px 11px;
      border: 1px solid #eddcb9; border-radius: var(--r-sm); background: var(--warn-soft); }
    .publication-alert > span { display: grid; flex: 0 0 auto; width: 22px; height: 22px; place-items: center;
      border-radius: 50%; background: var(--warn); color: #fff; font-size: 12px; font-weight: 800; }
    .publication-alert b { font-size: 11.5px; }
    .publication-alert p { margin-top: 1px; color: var(--muted); font-size: 10.5px; line-height: 1.4; }
    .public-copy-cta { min-height: 48px; margin-top: 12px; }
    .details-grid, .details-col { display: grid; gap: 12px; min-width: 0; }
    .details-grid { margin-top: 14px; }
    .details-grid > .details-col { display: contents; }
    .product-dossier-card { order: 1; }
    .omdoos-card { order: 2; }
    #stock-card { order: 3; }
    .agreement-card { order: 4; }
    .agreement-viewer { order: 5; }
    .info-card { overflow: hidden; border: 1px solid rgb(255 255 255 / 70%); border-radius: var(--r);
      background: var(--surface); box-shadow: var(--sh-1); }
    .info-card > header { display: flex; align-items: center; gap: 10px; min-height: 64px;
      padding: 12px 14px; border-bottom: 1px solid var(--line); }
    .info-card__icon { display: grid; flex: 0 0 auto; width: 32px; height: 32px; place-items: center;
      border-radius: 10px; background: var(--rose-soft); color: var(--rose); font: 750 9.5px/1 var(--mono); }
    .info-card header > div { min-width: 0; flex: 1; }
    .info-card h2 { font-size: 14px; line-height: 1.2; }
    .info-card header p { margin-top: 2px; color: var(--muted); font-size: 10.5px; }
    .info-card--internal { border-color: #eddcb9; }
    .info-card--internal .info-card__icon { background: var(--warn-soft); color: var(--warn); }
    .agreement-edit { flex:none; color:var(--rose-dark);font-size:11px;font-weight:750;text-decoration:none }
    .agreement-private { display:flex;align-items:center;gap:9px;margin:12px 14px 0;padding:9px 11px;
      border:1px solid #eddcb9;border-radius:var(--r-sm);background:var(--warn-soft) }
    .agreement-private>i { color:var(--warn);font-size:8px }
    .agreement-private>span { display:grid;gap:1px }
    .agreement-private b { color:var(--warn);font-size:10.5px;text-transform:uppercase;letter-spacing:.06em }
    .agreement-private small { color:var(--muted);font-size:9.5px }
    .agreement-instruction { margin:10px 14px 0;padding:11px 12px;border-left:3px solid var(--warn);
      border-radius:0 var(--r-sm) var(--r-sm) 0;background:var(--surface-2) }
    .agreement-instruction>span { color:var(--muted);font-size:9.5px;font-weight:760;letter-spacing:.05em;text-transform:uppercase }
    .agreement-note { margin-top:6px;color:var(--ink);font-size:13px;line-height:1.5 }
    .agreement-note p { margin:0;white-space:pre-wrap;overflow-wrap:anywhere }
    .agreement-note p + p, .agreement-note p + ul, .agreement-note ul + p { margin-top:6px }
    .agreement-note ul { margin:0;padding-left:18px }
    .agreement-note li { overflow-wrap:anywhere }
    .agreement-note li + li { margin-top:3px }
    .agreement-note ul ul { margin-top:3px;padding-left:16px;color:var(--ink-2);font-size:12.5px;list-style:circle }
    .agreement-gallery { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin:11px 14px 14px;padding:0;list-style:none }
    .agreement-gallery li { min-width:0 }
    .agreement-gallery button { position:relative;width:100%;aspect-ratio:1;padding:0;overflow:hidden;border:1px solid var(--line);
      border-radius:11px;background:var(--surface-2);cursor:zoom-in }
    .agreement-gallery img { width:100%;height:100%;object-fit:cover }
    .agreement-gallery button span { position:absolute;left:5px;bottom:5px;padding:3px 6px;border-radius:999px;
      background:rgb(20 14 12/.76);color:#fff;font-size:9px;font-weight:760 }
    .agreement-gallery p { margin:4px 2px 0;color:var(--ink-2);font-size:10px;line-height:1.35;
      overflow-wrap:anywhere }
    .agreement-state { margin:0;padding:14px;color:var(--muted);font-size:11.5px;line-height:1.45 }
    .issue-list { display:grid;gap:8px;margin:0;padding:12px 14px 14px;list-style:none }
    .issue-list li { display:grid;gap:2px;padding:9px 11px;border:1px solid #f0d2d9;border-left:3px solid var(--rose);border-radius:11px;background:#fff6f8 }
    .issue-list a { color:var(--rose-dark);font-size:13px;font-weight:750;text-decoration:none }
    .issue-list small { color:var(--ink-2);font-size:11.5px }
    .issue-list em { color:var(--ink-2);font-size:12px }
    .agreement-state--error { display:flex;align-items:center;justify-content:space-between;gap:10px;color:var(--danger) }

    .barcode-link { display: inline-flex; align-items: center; gap: 6px; padding: 0; border: 0; background: none;
      color: inherit; font: inherit; cursor: pointer; }
    .barcode-link svg { width: 16px; height: 16px; fill: none; stroke: var(--rose-dark); stroke-width: 1.8;
      stroke-linecap: round; }
    .barcode-link:hover { text-decoration: underline dotted; }

    @media (min-width: 680px) {
      .stock-rows--fold { margin-top: 10px; border-top: 1px solid var(--line); }
      .details-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; align-items: start; }
      .product-dossier-card, .agreement-card { grid-column: 1 / -1; }
    }
    .price-tabs{margin-bottom:12px}
  `,
})
export class ProductView {
  readonly salesUnit = productSalesUnit;
  readonly primaryPrice = primarySalesPrice;
  readonly secondaryPrice = secondarySalesPrice;
  readonly quantityDetail = salesQuantityDetail;
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
  private readonly location = inject(Location);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly ui = inject(Ui);

  readonly product = signal<Product | null>(null);
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

  /* The stock book, fetched the first time the tile is opened. */
  /** Pieces on the water for this product, from ordered and shipped containers. */
  readonly expected = signal<ExpectedStock | null>(null);
  readonly stockHistory = signal<StockMovement[] | null>(null);
  readonly stockLevels = signal<ProductStock[] | null>(null);
  readonly stockTotal = computed(() => (this.stockLevels() ?? []).reduce((sum, level) => sum + level.quantity, 0));
  /** "stuks" alone with one location; otherwise "9.400 magazijn · 600 TICA". */
  readonly stockSummary = computed(() => {
    const levels = this.stockLevels() ?? [];
    if (levels.length <= 1) return productSalesUnit(this.product()).plural;
    return levels.map((level) => `${level.quantity.toLocaleString('nl-BE')} ${level.name}`).join(' · ');
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
  goBack(): void {
    if (window.history.length <= 1) { void this.router.navigateByUrl('/products'); return; }
    this.location.back();
  }

  selectGalleryPhoto(index: number): void {
    const total = this.product()?.photos.length ?? 0;
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
  /** Id of the purchase calculation the cost price came from, when it still exists. */
  readonly sourceOrderId = signal<number | null>(null);
  /** The card tiles open the build-up as a sheet on every screen size. */
  readonly priceInfoOpen = signal(false);

  readonly priceTab = signal<'build' | 'history'>('build');

  openPriceInfo(product: Product): void {
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
   * Rebuilds the road from factory price to catalogue price. The per-piece
   * transport, duty and handling live on the purchase calculation the
   * cost price came from; when that calculation is gone, the cost price
   * is shown as one line.
   */
  protected async loadPriceBuild(product: Product): Promise<void> {
    const source = product.landedCostSource;
    let line: LandedCostLine | null = null;
    let view: PurchaseOrderView | undefined;
    if (source) {
      try {
        const orders = await this.sourcing.purchaseOrders();
        view = orders.find((item) => item.order.number === source);
        line = view?.costing.lines.find((item) => item.productId === product.id) ?? null;
      } catch {
        line = null;
      }
    }
    /* The same words as on the calculation, so both screens read alike. */
    const labels = view?.costLabels;
    if (this.product()?.id !== product.id) return;

    const rows: PriceRow[] = [];
    const per = (total: number, quantity: number) => quantity > 0 ? total / quantity : 0;
    if (line && line.quantity > 0) {
      rows.push({ label: 'Inkoopprijs (EXW)', hint: `${line.quantity.toLocaleString('nl-BE')} ${productSalesUnit(product).plural} in ${source}`, eur: per(line.goodsEur, line.quantity) });
      if (line.originEur) {
        rows.push({ label: `+ ${labels?.originCostsLabel || 'Lokale kosten bij vertrek'}`,
          hint: `${labels?.originRoute ? labels.originRoute + ' · ' : ''}vervoer naar de haven, export, laden`,
          eur: per(line.originEur, line.quantity) });
      }
      if (line.freightEur) {
        rows.push({ label: `+ ${labels?.seaFreightLabel || 'Zeevracht'}`,
          hint: `${labels?.seaFreightRoute ? labels.seaFreightRoute + ' · ' : ''}containerprijs verdeeld per m³`,
          eur: per(line.freightEur, line.quantity) });
      }
      if (line.dutyEur || line.dutyRatePct) {
        rows.push({ label: `+ Invoerrechten ${line.dutyRatePct} %`,
          hint: `douane, op basis van HS-code ${product.hsCode || line.dutySource}`,
          eur: per(line.dutyEur, line.quantity) });
      }
      if (line.destinationEur) {
        rows.push({ label: `+ ${labels?.destinationCostsLabel || 'Kosten na aankomst'}`,
          hint: 'havenkosten, inklaring en levering aan het magazijn',
          eur: per(line.destinationEur, line.quantity) });
      }
      if (line.extraRevenueEur) {
        rows.push({ label: '+ Enrosed kost', hint: 'vast bedrag per container, verdeeld over de stuks',
          eur: per(line.extraRevenueEur, line.quantity) });
      }
      rows.push({ label: `Kostprijs per ${productSalesUnit(product).singular}`, eur: product.landedCostEur ?? line.landedUnitEur, sum: true });
    } else if (product.landedCostEur) {
      rows.push({ label: `Kostprijs per ${productSalesUnit(product).singular}`, hint: 'incl. transport en rechten', eur: product.landedCostEur, sum: true });
    }
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
    const costEquivalent = secondarySalesPrice(product, product.landedCostEur);
    if (costEquivalent) rows.push({ label: `Kostprijs ${costEquivalent.label} · ${costEquivalent.piecesPerDisplay} stuks/display`, eur: costEquivalent.price, aside: true });
    const priceEquivalent = secondarySalesPrice(product, price);
    if (priceEquivalent) rows.push({ label: `Catalogusprijs ${priceEquivalent.label} · ${priceEquivalent.piecesPerDisplay} stuks/display`, eur: priceEquivalent.price, aside: true });
    this.priceBuild.set({ rows, source, sourceFound: line !== null });
  }

  /** Three latest lines of the stock book; "Meer" unfolds the rest. */
  readonly allMovesOpen = signal(false);
  readonly hiddenMoves = computed(() => Math.max(0, (this.stockHistory()?.length ?? 0) - 3));
  readonly recentMoves = computed(() => {
    const history = this.stockHistory();
    if (!history) return null;
    return this.allMovesOpen() ? history : history.slice(0, 3);
  });

  /* ---- stock actions, right on the page ---- */
  readonly correctOpen = signal(false);
  readonly stockSaving = signal(false);
  readonly takeout = signal<{
    kind: TakeoutKind; locationId: number | null; quantity: number; note: string; purchaseOrderId: number | null;
  } | null>(null);
  /** Received containers that carried this product: what a damage or shortage report can point at. */
  readonly receivedOrders = signal<ReceivedContainer[]>([]);

  openTakeout(kind: TakeoutKind): void {
    const levels = this.stockLevels() ?? [];
    const preferred = levels.find((level) => level.quantity > 0) ?? levels[0];
    this.takeout.set({ kind, locationId: preferred?.locationId ?? null, quantity: 0, note: '', purchaseOrderId: null });
  }

  takeoutTitle(kind: TakeoutKind): string {
    return kind === 'DAMAGED' ? 'Stuk / beschadigd' : kind === 'SHORTAGE' ? 'Te weinig geleverd' : 'Demo weggegeven';
  }

  containerLabel(order: ReceivedContainer): string {
    return order.receivedOn ? `${order.number} · ontvangen ${this.dateLabel(order.receivedOn)}` : order.number;
  }

  private dateLabel(day: string): string {
    const [year, month, date] = day.split('-');
    return `${date}/${month}/${year}`;
  }

  async confirmTakeout(): Promise<void> {
    const product = this.product();
    const out = this.takeout();
    if (!product || product.id === null || !out || !(out.quantity > 0)) return;
    this.stockSaving.set(true);
    try {
      const note = out.note.trim() || null;
      const container = out.kind === 'DEMO' ? null : this.receivedOrders().find((order) => order.id === out.purchaseOrderId) ?? null;
      if (container && out.kind !== 'DEMO') {
        await this.sourcing.reportAfterReceipt(container.id, {
          productId: product.id, locationId: out.locationId, quantity: out.quantity, kind: out.kind, note,
        });
      } else {
        await this.catalog.takeOutStock(product.id, {
          locationId: out.locationId, quantity: out.quantity, kind: out.kind, note,
        });
      }
      this.takeout.set(null);
      const booked = out.kind === 'DAMAGED' ? 'Beschadigde stuks geboekt' : out.kind === 'SHORTAGE' ? 'Tekort geboekt' : 'Demo geboekt';
      this.ui.toast(container ? `${booked} · gemeld op ${container.number}` : booked);
      this.refreshStock(product.id);
      void this.sourcing.receiptIssues(product.id).then((issues) => this.receiptIssues.set(issues)).catch(() => {});
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'Boeken mislukt'), 'err');
    } finally {
      this.stockSaving.set(false);
    }
  }

  async bookCorrection(locationId: number, input: HTMLInputElement): Promise<void> {
    const product = this.product();
    if (!product || product.id === null) return;
    const quantity = Math.max(0, Math.floor(Number(input.value) || 0));
    this.stockSaving.set(true);
    try {
      await this.catalog.setStock(product.id, quantity, locationId);
      this.ui.toast('Correctie geboekt');
      this.refreshStock(product.id);
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'Correctie boeken mislukt'), 'err');
    } finally {
      this.stockSaving.set(false);
    }
  }

  /** After a booking every figure on the page tells the new truth. */
  protected refreshStock(productId: number): void {
    this.catalog.productStock(productId).then((levels) => this.stockLevels.set(levels)).catch(() => {});
    this.loadStockHistory(productId);
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
    afterRenderEffect(() => {
      this.product()?.id;
      this.desktop.active();
      this.revealSelectedVariant(this.variantRail()?.nativeElement);
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
      void this.loadSupplierAgreement(productId, this.loadVersion);
    }
  }

  private async loadProduct(id: number): Promise<void> {
    void this.loadCatalogueNavigation();
    this.loadStockHistory(id);
    void this.sourcing.expectedStock()
      .then((items) => this.expected.set(items.find((item) => item.productId === id) ?? null))
      .catch(() => this.expected.set(null));
    const version = ++this.loadVersion;
    this.product.set(null);
    this.priceOpen.set(false);
    this.priceInfoOpen.set(false);
    this.priceBuild.set(null);
    this.stockHistory.set(null);
    this.allMovesOpen.set(false);
    this.correctOpen.set(false);
    this.takeout.set(null);
    this.family.set(null);
    this.familyLoadError.set(false);
    this.familyLoading.set(false);
    this.lightbox.set(-1);
    this.galleryIndex.set(0);
    this.cancelGallerySwipe();
    this.gallerySuppressClickUntil = 0;
    this.agreementLightbox.set(-1);
    this.agreementPhotos.set([]);
    this.supplierAgreement.set(null);
    this.receiptIssues.set([]);
    this.receivedOrders.set([]);
    this.agreementLoadError.set(null);
    void this.sourcing.receiptIssues(id)
      .then((issues) => { if (version === this.loadVersion) this.receiptIssues.set(issues); })
      .catch(() => { /* the history is a bonus on the page */ });
    void this.sourcing.purchaseOrders()
      .then((orders) => { if (version === this.loadVersion) this.receivedOrders.set(receivedContainersFor(orders, id)); })
      .catch(() => { /* without the list a report simply has no container to point at */ });
    void this.loadSupplierAgreement(id, version);

    const [product, categories, suppliers] = await Promise.all([
      this.catalog.product(id),
      this.catalog.categories(),
      this.sourcing.suppliers(),
    ]);
    if (version !== this.loadVersion) return;
    /* The variant group belongs to the first paint: it loads before the
       product shows, so no block appears a moment later. */
    if (product.familyId != null) await this.loadFamily(product.familyId, version);
    if (version !== this.loadVersion) return;
    this.product.set(product);
    this.stockLevels.set(null);
    if (product.id !== null) {
      this.catalog.productStock(product.id).then((levels) => this.stockLevels.set(levels)).catch(() => this.stockLevels.set([]));
    }
    this.categories.set(categories);
    this.suppliers.set(suppliers);
    this.sourceOrderId.set(null);
    if (product.landedCostSource) {
      void this.sourcing.purchaseOrders().then((orders) => {
        if (version !== this.loadVersion) return;
        this.sourceOrderId.set(
          orders.find((item) => item.order.number === product.landedCostSource)?.order.id ?? null);
      }).catch(() => {});
    }
    const requestedSection = ['product-overview', 'product-core', 'product-packaging', 'stock-card', 'product-media', 'product-agreements', 'product-publication', 'pd-agreements']
      .find((id) => `#${id}` === window.location.hash);
    if (requestedSection) setTimeout(() => { if (version === this.loadVersion) this.scrollToDetailSection(requestedSection); }, 0);
  }

  private loadCatalogueNavigation(): Promise<void> {
    if (this.catalogueNavigationLoaded) return Promise.resolve();
    if (this.catalogueNavigationRequest) return this.catalogueNavigationRequest;
    this.catalogueNavigationRequest = Promise.all([
      this.catalog.products(),
      this.catalog.productFamilies(),
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

  private async loadSupplierAgreement(productId: number, version: number): Promise<void> {
    this.agreementLoading.set(true);
    this.agreementLoadError.set(null);
    try {
      const agreement = await this.supplierAgreementApi.get(productId);
      if (version !== this.loadVersion) return;
      this.supplierAgreement.set(agreement);
      this.agreementPhotos.set(agreement.available ? orderedSupplierAgreementPhotos(agreement.photos) : []);
    } catch (failure: unknown) {
      if (version !== this.loadVersion) return;
      this.agreementPhotos.set([]);
      this.supplierAgreement.set(null);
      this.agreementLoadError.set(messageOf(
        failure, 'De leveranciersafspraak kon niet worden geladen.'));
    } finally {
      if (version === this.loadVersion) this.agreementLoading.set(false);
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
    if (this.familyLoading()) return 'Publicatiestatus laden…';
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
