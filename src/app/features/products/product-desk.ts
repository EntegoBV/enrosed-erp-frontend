import { ProductCostHistory } from './product-cost-history';
import { ProductCostHistorySheet } from './product-cost-history-sheet';
import { ChangeDetectionStrategy, Component, DestroyRef, ViewEncapsulation, computed, effect, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthImage } from '../../core/api/auth-image';
import { Product } from '../../core/api/models';
import { Icon } from '../../shared/icon';
import { keyContext } from '../../shared/key-context';
import { PhotoLightbox } from '../../shared/photo-lightbox';
import { PageHeader } from '../../shared/page-header';
import { CbmPipe, CurPipe, DateNlPipe, DateTimeNlPipe, EurPipe, KgPipe, NumPipe } from '../../shared/pipes';
import { colourHexOf } from '../purchasing/purchase-desk-format';
import { ProductMediaCard } from './product-media-card';
import { ProductPlacesLine } from './product-places-line';
import { ProductSupplierAgreementPhotoViewer } from './product-supplier-agreement-photo-viewer';
import { ProductView } from './product-view';
import { LoadError } from '../../shared/load-error';
import { Skeleton } from '../../shared/skeleton';
import { StockBookingSheet } from './stock-booking-sheet';

/** A media query as a signal, for the component that asks (removes its listener on destroy). */
function mediaSignal(query: string) {
  const matches = signal(false);
  const list = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
  if (list) {
    matches.set(list.matches);
    const change = (event: MediaQueryListEvent) => matches.set(event.matches);
    list.addEventListener('change', change);
    inject(DestroyRef).onDestroy(() => list.removeEventListener('change', change));
  }
  return matches.asReadonly();
}

interface IssueGroup { key: string; label: string; action: string; link: unknown[]; params: Record<string, string> | null; issues: string[]; }

/**
 * The product desk: the product dossier on a wide screen, built like the
 * purchase desk. A dark hero answers the six questions at a glance - stock,
 * on the water, landed cost, catalogue price, margin, publication. Below
 * it the page reads top-down in full-width cards: the price as one line
 * from factory price to margin (the build-up unfolds on request), the
 * product with photo, identity and carton side by side, then stock and
 * website next to each other, and the supplier agreements.
 *
 * It inherits every loader and booking from the phone view and only brings
 * its own screen; editing stays an explicit step in the editor.
 */
@Component({
  selector: 'app-product-desk',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onDocumentKey($event)' },
  imports: [Icon, ProductCostHistory, ProductCostHistorySheet, NgTemplateOutlet, RouterLink, AuthImage, PhotoLightbox, ProductSupplierAgreementPhotoViewer, ProductMediaCard, ProductPlacesLine, PageHeader, LoadError, Skeleton, StockBookingSheet,
    CbmPipe, CurPipe, DateNlPipe, DateTimeNlPipe, EurPipe, KgPipe, NumPipe,
  ],
  template: `
    @if (product(); as product) {
      <app-page-header [title]="product.name" [subtitle]="deskSubtitle()" [showBell]="false">
        @if (variantNeighbours(); as around) {
          <span class="product-nav" role="group" aria-label="Producten en kleurvarianten">
            <a class="product-nav__btn" [class.product-nav__btn--off]="!around.previous" data-step="previous"
               [routerLink]="around.previous ? ['/products', around.previous.productId] : null"
               [attr.aria-disabled]="!around.previous"
               [title]="around.previous ? (around.previousChangesProduct ? 'Vorig product: ' + around.previous.groupName : 'Vorige kleur: ' + around.previous.optionLabel) : 'Dit is het eerste product'">‹</a>
            <small class="product-nav__pos">{{ around.total > 1 ? 'Kleur ' + (around.index + 1) + '/' + around.total : 'Product' }}</small>
            <a class="product-nav__btn" [class.product-nav__btn--off]="!around.next" data-step="next"
               [routerLink]="around.next ? ['/products', around.next.productId] : null"
               [attr.aria-disabled]="!around.next"
               [title]="around.next ? (around.nextChangesProduct ? 'Volgend product: ' + around.next.groupName : 'Volgende kleur: ' + around.next.optionLabel) : 'Dit is het laatste product'">›</a>
          </span>
        }
        <button class="btn btn--sm" type="button" title="Voorraad boeken (B)" (click)="openBooking('RECOUNT')"><app-icon name="stock" [size]="16" />Voorraad boeken</button>
        <a class="btn btn--primary btn--sm" [routerLink]="['/products', product.id, 'edit']" title="Bewerken (E)"><app-icon name="pencil" [size]="15" />Bewerken</a>
      </app-page-header>

      <div class="content pdk">
        <!-- ============================ hero: what it is, and the six figures -->
        <header class="pdk-hero">
          <div class="pdk-hero__top" [class.pdk-hero__top--series]="variantMembers().length > 1">
            @if (galleryPhotos()[0]; as photo) {
              <button class="pdk-hero__photo" type="button" (click)="lightbox.set(0)" [attr.aria-label]="'Foto van ' + product.name + ' vergroten'">
                <img [appAuthSrc]="photo.mediumUrl || photo.url" appAuthSize="medium" alt="" draggable="false" />
              </button>
            } @else {
              <span class="pdk-hero__photo pdk-hero__photo--empty" aria-hidden="true">◈</span>
            }
            <div class="pdk-id">
              <span class="pdk-eyebrow">{{ categoryName() || 'Producten' }}@if (product.sku) { · {{ product.sku }} }</span>
              <h2 class="pdk-title">{{ product.name }}</h2>
              <p class="pdk-line">
                @if (supplierName(); as name) {
                  <a [routerLink]="['/suppliers']" [queryParams]="{ q: name }">{{ name }} ›</a>
                } @else { <span>Geen leverancier</span> }
                @if (packagingLabel(product); as packaging) { <span class="sep">·</span><span>{{ packaging }}</span> }
                @if (product.carton.piecesPerCarton) { <span class="sep">·</span><span>{{ product.carton.piecesPerCarton | num }} per omdoos</span> }
              </p>
              <div class="pdk-chips" role="group" aria-label="Kenmerken">
                <span class="pdk-chip" [class.tone-ok]="product.active && !product.demo" [class.tone-warn]="!product.active || product.demo">
                  {{ product.active ? (product.demo ? 'Demo' : 'Actief') : 'Inactief' }}
                </span>
                @if (product.colour) {
                  <span class="pdk-chip">
                    @if (hexOf(product.colourHex, product.colour); as hex) { <i [style.background]="hex" aria-hidden="true"></i> }
                    {{ product.colour }}
                  </span>
                }
                @if (product.variantSize) { <span class="pdk-chip">Maat {{ product.variantSize }}</span> }
                @if (product.hsCode) { <span class="pdk-chip mono">HS {{ product.hsCode }}</span> }
              </div>
            </div>
            @if (variantMembers().length > 1) {
              <nav class="pdk-series" aria-label="Productreeks">
                <small>Reeks · {{ variantMembers().length }} kleuren</small>
                <div class="pdk-series__chips">
                  @for (member of variantMembers(); track member.productId) {
                    @let current = member.productId === product.id;
                    @let total = memberStock(member.productId);
                    <a class="pdk-series__chip" [class.now]="current" [class.off]="!member.active"
                       [routerLink]="current ? null : ['/products', member.productId]" [attr.aria-current]="current ? 'page' : null"
                       [title]="member.sku ? member.sku + (total !== null ? ' · ' + (total | num) + ' op voorraad' : '') : ''">
                      @if (hexOf(member.colourHex, member.colour); as hex) { <i [style.background]="hex" aria-hidden="true"></i> }
                      {{ variantOptionLabel(member) }}@if (total !== null) { <b>{{ total | num }}</b> }
                    </a>
                  }
                </div>
              </nav>
            }
          </div>

          <div class="pdk-strip" aria-label="Kerncijfers">
            <button class="pdk-kpi" type="button" (click)="scrollTo('pd-stock')">
              <small>Voorraad</small>
              @if (stockLevels()) {
                <strong [class.is-bad]="stockTotal() <= 0">{{ stockTotal() | num }}<em>{{ unitWord(product, stockTotal()) }}</em></strong>
                <span>@for (part of stockSplit(); track $index) {@if (!$first) { · }<span class="pdk-nw">{{ part }}</span>}</span>
              } @else if (product.inventoryKnown) {
                <strong [class.is-bad]="product.stockQuantity <= 0">{{ product.stockQuantity | num }}<em>{{ unitWord(product, product.stockQuantity) }}</em></strong>
                <span>—</span>
              } @else {
                <strong>—</strong>
                <span>nog niet bevestigd</span>
              }
            </button>
            @if (expected(); as exp) {
              <a class="pdk-kpi pdk-kpi--accent" [routerLink]="['/purchasing', exp.orderIds[0]]" [attr.title]="'Open ' + exp.orderNumbers.join(', ')">
                <small>Onderweg</small>
                <strong>+{{ exp.quantity | num }}</strong>
                <span>@for (order of exp.orderNumbers; track order) {@if (!$first) {, }<span class="pdk-nw">{{ order }}</span>} · {{ exp.expectedArrival ? 'verwacht ' + (exp.expectedArrival | dateNl) : 'datum nog open' }}</span>
              </a>
            } @else {
              <div class="pdk-kpi pdk-kpi--static">
                <small>Onderweg</small>
                <strong>—</strong>
                <span>niets besteld</span>
              </div>
            }
            <button class="pdk-kpi" type="button" (click)="openHistory()" title="Kostprijshistoriek">
              <small>Kostprijs <app-icon name="chevron-right" [size]="12" /></small>
              @if (product.landedCostEur; as landed) {
                <strong>{{ landed | eur: 2 }}</strong>
                <span>@if (product.landedCostSource; as source) { geland · <span class="pdk-nw">{{ source }}</span> } @else { geland, incl. transport en rechten }</span>
              } @else {
                <strong>—</strong>
                <span>nog geen kostprijs</span>
              }
            </button>
            <button class="pdk-kpi" type="button" (click)="openPriceDetail()">
              <small>Catalogusprijs</small>
              @if (displayPrice(); as price) {
                <strong>{{ price | eur: 2 }}<em>per {{ salesUnit(product).singular }}</em></strong>
                <span>{{ hasFixedSalesPrice(product) ? 'vaste prijs' : '+ ' + (product.markupPct | num) + ' % op de kostprijs' }}@if (otherPrice(product, price); as other) { · {{ other.text }}}</span>
              } @else {
                <strong>—</strong>
                <span>nog geen prijs</span>
              }
            </button>
            <button class="pdk-kpi" type="button" [class.pdk-kpi--ok]="(margin()?.eur ?? 0) >= 0" [class.pdk-kpi--bad]="(margin()?.eur ?? 0) < 0" (click)="openPriceDetail()">
              <small>Marge</small>
              @if (margin(); as value) {
                <strong>{{ value.eur | eur: 2 }}<em>per {{ salesUnit(product).singular }}</em></strong>
                <span>{{ value.pct }} % van de prijs</span>
              } @else {
                <strong>—</strong>
                <span>kostprijs of prijs ontbreekt</span>
              }
            </button>
            @if (publicationIssues().length; as open) {
              <button class="pdk-kpi pdk-kpi--warn" type="button" (click)="scrollTo('pd-web')">
                <small>Publicatie</small>
                <strong class="pdk-kpi__word">{{ open }} punt{{ open === 1 ? '' : 'en' }} open ›</strong>
                <span>{{ publicationSummary() }}</span>
              </button>
            } @else {
              <button class="pdk-kpi" type="button" (click)="scrollTo('pd-web')">
                <small>Publicatie</small>
                <strong class="pdk-kpi__word">{{ publicationSummary() }}</strong>
                <span>website &amp; orderapp</span>
              </button>
            }
          </div>
        </header>

        <!-- ============================ the cards: two self-stacking columns from 1200 px, one column below -->
        @if (twoColumns()) {
          <div class="pdk-cols">
            <div class="pdk-col">
              <ng-container *ngTemplateOutlet="priceCard" />
              <ng-container *ngTemplateOutlet="productCard" />
              <ng-container *ngTemplateOutlet="agreementsCard" />
              <ng-container *ngTemplateOutlet="mediaCard" />
              <ng-container *ngTemplateOutlet="issuesCard" />
            </div>
            <div class="pdk-col">
              <ng-container *ngTemplateOutlet="stockCard" />
              <ng-container *ngTemplateOutlet="cartonCard" />
              <ng-container *ngTemplateOutlet="webCard" />
            </div>
          </div>
        } @else {
          <div class="pdk-col">
            <ng-container *ngTemplateOutlet="priceCard" />
            <div class="pdk-duo">
              <ng-container *ngTemplateOutlet="stockCard" />
              <ng-container *ngTemplateOutlet="webCard" />
            </div>
            <ng-container *ngTemplateOutlet="productCard" />
            <ng-container *ngTemplateOutlet="cartonCard" />
            <ng-container *ngTemplateOutlet="agreementsCard" />
            <ng-container *ngTemplateOutlet="mediaCard" />
            <ng-container *ngTemplateOutlet="issuesCard" />
          </div>
        }
      </div>

      <!-- ============================ Prijs & marge: one line from factory to margin; the build-up on request -->
      <ng-template #priceCard>
        <section class="pdk-card" id="pd-price" aria-labelledby="pd-price-title">
          <div class="pdk-card__head">
            <div><h2 id="pd-price-title">Prijs &amp; marge</h2><p>Per {{ salesUnit(product).singular }}, van fabrieksprijs tot wat er overblijft</p></div>
            <button class="linklike" type="button" [attr.aria-expanded]="priceOpen()" (click)="priceOpen.set(!priceOpen())">
              {{ priceOpen() ? 'Opbouw verbergen' : 'Opbouw tonen ›' }}
            </button>
          </div>
          <div class="pdk-flow">
            <div class="pdk-flow__step">
              <small>EXW-prijs</small>
              <b>@if (product.exwPrice; as price) { {{ price | cur: product.exwCurrency }} } @else { — }</b>
              <span>{{ product.extraUnitCost ? '+ ' + (product.extraUnitCost | cur: product.exwCurrency) + ' extra kost' : 'fabrieksprijs' }}</span>
            </div>
            <i class="pdk-flow__op" aria-hidden="true">→</i>
            <div class="pdk-flow__step">
              <small>Kostprijs</small>
              <b>@if (product.landedCostEur; as landed) { {{ landed | eur: 2 }} } @else { — }</b>
              <span>@if (product.landedCostSource; as source) { geland · <span class="pdk-nw">{{ source }}</span> } @else { incl. transport en rechten }</span>
              <button class="linklike pdk-flow__link" type="button" (click)="openHistory()">Historiek ›</button>
            </div>
            <i class="pdk-flow__op" aria-hidden="true">→</i>
            <div class="pdk-flow__step">
              <small>Prijsregel</small>
              <b>{{ hasFixedSalesPrice(product) ? 'Vaste prijs' : '+ ' + (product.markupPct | num) + ' %' }}</b>
              <span>{{ hasFixedSalesPrice(product) ? 'los van de kostprijs' : 'opslag op de kostprijs' }}</span>
            </div>
            <i class="pdk-flow__op pdk-flow__op--break" aria-hidden="true">→</i>
            <div class="pdk-flow__step pdk-flow__step--price">
              <small>Catalogusprijs</small>
              <b>@if (displayPrice(); as price) { {{ price | eur: 2 }} } @else { — }</b>
              <span>per {{ salesUnit(product).singular }}@if (otherPrice(product, displayPrice()); as other) { · {{ other.text }}}</span>
            </div>
            <i class="pdk-flow__op" aria-hidden="true">=</i>
            <div class="pdk-flow__step pdk-flow__step--margin" [class.is-bad]="(margin()?.eur ?? 0) < 0">
              <small>Marge</small>
              @if (margin(); as value) {
                <b>{{ value.eur | eur: 2 }}</b>
                <span>per {{ salesUnit(product).singular }} · {{ value.pct }} % van de prijs</span>
              } @else {
                <b>—</b>
                <span>kostprijs of prijs ontbreekt</span>
              }
            </div>
          </div>
          <p class="pdk-flow-note">{{ orderStepSentence(product) }} · prijzen excl. btw</p>
          @if (priceOpen()) {
            <div class="pd-price__tabs per-toggle" role="group" aria-label="Prijsdetail">
              <button type="button" [class.on]="priceTab() === 'build'" (click)="priceTab.set('build')">Opbouw</button>
              <button type="button" [class.on]="priceTab() === 'history'" (click)="priceTab.set('history')">Historiek</button>
            </div>
            @if (priceTab() === 'history') {
              <div class="pd-price__history">
                <app-product-cost-history [productId]="product.id!" [product]="product" [sourceLink]="historySourceLink()" />
              </div>
            } @else {
            <div class="pd-price__detail">
              @if (priceBuild(); as build) {
                @if (build.rows.length) {
                  <div class="desk-chain">
                    @for (row of chainRows(); track $index) {
                      <div class="desk-chain__row" [class.desk-chain__row--sub]="row.sum && !row.last" [class.desk-chain__row--total]="row.last" [class.pd-chain__row--margin]="row.margin">
                        <i aria-hidden="true">{{ row.mark }}</i>
                        <span>{{ row.label }}@if (row.hint) { <small>{{ row.hint }}</small> }</span>
                        <b>{{ row.eur | eur: 2 }}</b>
                      </div>
                    }
                  </div>
                  @if (asideRows().length) {
                    <p class="pd-aside">
                      @for (row of asideRows(); track $index; let last = $last) {{{ row.label }} <b>{{ row.eur | eur: 2 }}</b>@if (!last) { · }}
                    </p>
                  }
                } @else {
                  <p class="pd-empty">Nog geen kostprijs of catalogusprijs. <a [routerLink]="['/products', product.id, 'edit']">Vul ze in via Bewerken ›</a></p>
                }
              } @else {
                <app-skeleton kind="lines" [rows]="3" />
              }
              <div>
                <div class="pd-kicker">Waar de cijfers vandaan komen</div>
                <dl class="desk-facts pd-facts">
                  <div><dt>Kostprijs</dt><dd>
                    @if (sourceOrderId(); as orderId) { <a [routerLink]="['/purchasing', orderId]">{{ product.landedCostSource }} ›</a> }
                    @else { {{ product.landedCostSource || 'Handmatig' }} }
                    <small>{{ product.landedCostSource ? 'de inkoopcalculatie: transport, rechten en Enrosed kost per stuk' : 'nog geen ontvangen container achter deze kostprijs' }}</small></dd></div>
                  <div><dt>Extra kost</dt><dd>@if (product.extraUnitCost; as extra) { {{ extra | cur: product.exwCurrency }} } @else { — }<small>per {{ salesUnit(product).singular }}, bv. display of giftbox, telt mee in de kostprijs</small></dd></div>
                  <div><dt>Prijsregel</dt><dd>{{ hasFixedSalesPrice(product) ? (product.fixedSalesPriceEur | eur: 2) : (product.markupPct | num) + ' % opslag' }}<small>{{ hasFixedSalesPrice(product) ? 'vaste verkoopprijs, los van de kostprijs' : 'op de gelande kostprijs; de marge is wat overblijft' }}</small></dd></div>
                </dl>
                <div class="desk-actions pd-links">
                  <a class="desk-action" [routerLink]="['/products', product.id, 'edit']" [queryParams]="{ tab: 'purchasing' }">
                    <span><b>Inkoop bewerken</b><small>EXW-prijs, extra kost en HS-code</small></span><i aria-hidden="true">›</i>
                  </a>
                  <a class="desk-action" [routerLink]="['/products', product.id, 'edit']" [queryParams]="{ tab: 'sales' }">
                    <span><b>Verkoopprijs bewerken</b><small>opslag of vaste prijs</small></span><i aria-hidden="true">›</i>
                  </a>
                </div>
              </div>
            </div>
            }
          }
        </section>
      </ng-template>

      <!-- ============================ Product: gallery and identification -->
      <ng-template #productCard>
        <section class="pdk-card" id="pd-product" aria-labelledby="pd-product-title">
          <div class="pdk-card__head">
            <div><h2 id="pd-product-title">Product</h2><p>Foto, identificatie en verpakking</p></div>
            <a class="linklike" [routerLink]="['/products', product.id, 'edit']">Bewerken ›</a>
          </div>
          <div class="pdk-product">
            <div class="pd-gallery">
              @let photos = galleryPhotos();
              @if (photos[galleryIndex()] || photos[0]; as photo) {
                <div class="pd-gallery__stage">
                  <button class="pd-gallery__main" type="button" (click)="lightbox.set(galleryIndex())"
                          (keydown.arrowleft)="stepGallery(-1, photos.length)" (keydown.arrowright)="stepGallery(1, photos.length)"
                          [attr.aria-label]="'Foto ' + (galleryIndex() + 1) + ' van ' + photos.length + (currentSlideBadges().length ? ' (' + currentSlideBadges().join(', ') + ')' : '') + ' vergroten'">
                    <img [appAuthSrc]="photo.mediumUrl || photo.url" appAuthSize="medium" [alt]="product.name + ' — foto ' + (galleryIndex() + 1)" draggable="false" />
                  </button>
                  @if (currentSlideBadges().length) {
                    <span class="pd-gallery__badges" aria-hidden="true">@for (badge of currentSlideBadges(); track badge) { <span>{{ badge }}</span> }</span>
                  }
                  @if (photos.length > 1) {
                    <button class="pd-gallery__step pd-gallery__step--prev" type="button" (click)="stepGallery(-1, photos.length)" aria-label="Vorige foto">‹</button>
                    <button class="pd-gallery__step pd-gallery__step--next" type="button" (click)="stepGallery(1, photos.length)" aria-label="Volgende foto">›</button>
                    <span class="pd-gallery__count">{{ galleryIndex() + 1 }} / {{ photos.length }}</span>
                  }
                </div>
                @if (photos.length > 1) {
                  <div class="pd-gallery__thumbs" aria-label="Kies een productfoto">
                    @for (item of photos; track item.id) {
                      <button type="button" [class.on]="$index === galleryIndex()" (click)="selectGalleryPhoto($index)"
                              [attr.aria-label]="'Toon foto ' + ($index + 1)">
                        <img [appAuthSrc]="item.url" alt="" draggable="false" loading="lazy" />
                      </button>
                    }
                  </div>
                }
                <a class="btn btn--sm pd-gallery__manage" [routerLink]="['/products', product.id, 'edit']" [queryParams]="{ tab: 'media' }">Foto’s beheren</a>
              } @else {
                <div class="pd-gallery__empty">
                  <b>Nog geen foto</b>
                  <a class="btn btn--sm" [routerLink]="['/products', product.id, 'edit']" [queryParams]="{ tab: 'media' }">Foto’s toevoegen</a>
                </div>
              }
              <!-- What customers see for this colour, as the server resolved it; the two links open that picker in the editor. -->
              @if (placeLine(); as line) { <app-product-places-line class="pd-gallery__places" [line]="line" /> }
            </div>
            <div>
              <div class="pd-kicker">Identificatie</div>
              <dl class="desk-facts pd-facts">
                <div><dt>Afmeting</dt><dd>{{ size(product.dimensions) }}<small>B × D × H</small></dd></div>
                <div><dt>Gewicht</dt><dd>{{ product.dimensions.weightKg ? (product.dimensions.weightKg | kg) : '—' }}<small>per {{ salesUnit(product).piece.one }}</small></dd></div>
                <div><dt>Barcode stuk</dt><dd class="mono">
                  @if (product.barcodeInner; as code) {
                    <button class="pd-barcode" type="button" [title]="'Barcode-afbeelding (300 dpi) van ' + code" (click)="downloadBarcode(code)">{{ code }} <i aria-hidden="true">▥</i></button>
                  } @else { — }
                </dd></div>
                @if (product.packaging.kind !== 'NONE') {
                  <div><dt>{{ product.packaging.kind === 'DISPLAY' ? 'Display' : 'Geschenkdoosje' }}</dt><dd>
                    {{ size(product.packaging.dimensions) }}
                    <small>{{ product.packaging.dimensions.weightKg ? (product.packaging.dimensions.weightKg | kg) : 'gewicht onbekend' }}@if (product.packaging.kind === 'DISPLAY' && product.packaging.piecesPerUnit) { · {{ product.packaging.piecesPerUnit | num }} {{ salesUnit(product).piece.other }} per display }</small>
                  </dd></div>
                  @if (product.packaging.barcode; as code) {
                    <div><dt>Barcode verpakking</dt><dd class="mono">
                      <button class="pd-barcode" type="button" [title]="'Barcode-afbeelding (300 dpi) van ' + code" (click)="downloadBarcode(code)">{{ code }} <i aria-hidden="true">▥</i></button>
                    </dd></div>
                  }
                } @else {
                  <div><dt>Verpakking</dt><dd class="pd-muted">Los, zonder verpakking</dd></div>
                }
                @let setup = salesSetup(product);
                <div><dt>Verkoop</dt><dd class="pd-prose">{{ setup.sentence }}<small>Klant leest: {{ setup.reading.main }} · {{ setup.reading.detail }}</small></dd></div>
                <div><dt>HS-code</dt><dd class="mono">{{ product.hsCode || '—' }}</dd></div>
                @if (product.description) {
                  <div><dt>Omschrijving</dt><dd class="pd-prose">
                    <span class="pdk-desc" [class.pdk-desc--open]="descriptionOpen()">{{ product.description }}</span>
                    @if (longDescription(product.description)) {
                      <button class="linklike pdk-more" type="button" [attr.aria-expanded]="descriptionOpen()" (click)="descriptionOpen.set(!descriptionOpen())">{{ descriptionOpen() ? 'Minder' : 'Meer ›' }}</button>
                    }
                  </dd></div>
                }
              </dl>
            </div>
          </div>
        </section>
      </ng-template>

      <!-- ============================ Omdoos & logistiek -->
      <ng-template #cartonCard>
        <section class="pdk-card" id="pd-carton" aria-labelledby="pd-carton-title">
          <div class="pdk-card__head">
            <div><h2 id="pd-carton-title">Omdoos &amp; logistiek</h2><p>Karton, inhoud en wat er in een container gaat</p></div>
          </div>
          <dl class="desk-facts pd-facts">
            <div><dt>Karton</dt><dd>{{ size(product.carton) }}<small>B × D × H</small></dd></div>
            <div><dt>Inhoud</dt><dd>{{ product.carton.piecesPerCarton | num }} {{ salesUnit(product).plural }}<small>{{ cartonPiecesAuto(product) ? 'berekend uit de maten' : 'per omdoos' }}</small>@if (quantityDetail(product, product.carton.piecesPerCarton ?? 0); as detail) { <small>{{ detail }}</small> }</dd></div>
            <div><dt>Gewicht</dt><dd>@if (product.carton.weightKg) { {{ product.carton.weightKg | kg }} } @else { — }<small>{{ product.carton.weightKg && cartonWeightAuto(product) ? 'berekend uit de stuks' : 'per omdoos' }}</small></dd></div>
            <div><dt>Volume</dt><dd>@if (product.cartonCbm) { {{ product.cartonCbm | cbm }} } @else { — }@if (product.pieceCbm) { <small>{{ product.pieceCbm | cbm: 5 }} per {{ salesUnit(product).singular }}</small> }</dd></div>
            <div><dt>Per 20ft GP</dt><dd>@if (gpCapacity().value !== null) { {{ gpCapacity().value | num }} {{ salesUnit(product).plural }}<small [title]="gpCapacityHint(gpCapacity(), product.carton)">{{ isAutoGpCapacity(gpCapacity()) ? 'Auto' : 'handmatig bevestigd' }}</small> } @else { —<small>onvoldoende gegevens</small> }</dd></div>
            <div><dt>Per 40' HC</dt><dd>@if (product.carton.hcCapacity; as hc) { {{ hc | num }} {{ salesUnit(product).plural }} } @else { — }@if (product.carton.hcCapacity) { <small>{{ product.carton.piecesPerHc ? 'handmatig geteld' : 'volle dozen op volume' }}</small> }</dd></div>
            <div><dt>Omdoosbarcode</dt><dd class="mono">
              @if (product.barcodeOuter; as code) {
                <button class="pd-barcode" type="button" [title]="'Barcode-afbeelding (300 dpi) van ' + code" (click)="downloadBarcode(code)">{{ code }} <i aria-hidden="true">▥</i></button>
              } @else { — }
            </dd></div>
          </dl>
        </section>
      </ng-template>

      <!-- ============================ Voorraad: locations, booking, on the way, the last moves -->
      <ng-template #stockCard>
        <section class="pdk-card" id="pd-stock" aria-labelledby="pd-stock-title">
          <div class="pdk-card__head">
            <div><h2 id="pd-stock-title">Voorraad</h2><p>Per locatie, in {{ salesUnit(product).plural }} · klik een locatie voor een hertelling</p></div>
            <b class="pdk-total" [class.is-bad]="stockTotal() <= 0">@if (stockLevels()) { {{ stockTotal() | num }}<em>{{ unitWord(product, stockTotal()) }}</em> } @else { — }</b>
          </div>
          @if (stockLevels(); as levels) {
            <div class="pdk-levels">
              @for (level of levels; track level.locationId) {
                <button class="pdk-level" type="button" [class.on]="bookingSheet()?.locationId === level.locationId"
                        [title]="'Hertelling boeken voor ' + level.name" (click)="openBooking('RECOUNT', level.locationId)">
                  <span><b>{{ level.name }}</b><small>{{ level.kindLabel }} · {{ level.countsForWebsite ? 'alle verkoopkanalen' : 'enkel ter plaatse' }}</small></span>
                  <strong [class.zero]="!level.quantity">{{ level.quantity | num }}</strong>
                </button>
              } @empty {
                <p class="pd-empty">Nog geen voorraadlocaties.</p>
              }
            </div>
          } @else {
            <app-skeleton kind="lines" [rows]="2" />
          }
          <div class="pdk-book" role="group" aria-label="Voorraad boeken">
            <button class="wk-btn wk-btn--sm" type="button" (click)="openBooking('RECOUNT')">Hertelling</button>
            <button class="wk-btn wk-btn--sm" type="button" (click)="openBooking('DAMAGED')">Beschadigd</button>
            <button class="wk-btn wk-btn--sm" type="button" (click)="openBooking('SHORTAGE')">Te weinig</button>
            <button class="wk-btn wk-btn--sm" type="button" (click)="openBooking('DEMO')">Demo</button>
            @if ((stockLevels() ?? []).length > 1) { <button class="wk-btn wk-btn--sm" type="button" (click)="openBooking('TRANSFER')">Verplaatsen</button> }
          </div>
          @if (expected(); as exp) {
            <a class="pdk-onway" [routerLink]="['/purchasing', exp.orderIds[0]]">
              <b>+{{ exp.quantity | num }} {{ unitWord(product, exp.quantity) }} onderweg</b>
              <small>{{ exp.orderNumbers.join(', ') }}{{ exp.expectedArrival ? ' · verwacht ' + (exp.expectedArrival | dateNl) : '' }} ›</small>
            </a>
          }
          @if (recentMoves(); as moves) {
            @if (moves.length) {
              <div class="pd-kicker pd-kicker--gap">Laatste bewegingen</div>
              <div class="pdk-moves">
                @for (move of moves; track move.id) {
                  <div class="pdk-move">
                    <span><b>{{ move.kindLabel }}@if (move.reference) { · {{ move.reference }}}</b>
                      <small>{{ move.at | dateTimeNl }}@if (move.actor) { · {{ move.actor }}}@if (move.locationName) { · {{ move.locationName }}}</small></span>
                    <strong [class.minus]="move.delta < 0">{{ move.delta > 0 ? '+' : '' }}{{ move.delta | num }}</strong>
                  </div>
                }
              </div>
              @if (!allMovesOpen() && hiddenMoves() > 0) {
                <button class="linklike pdk-more" type="button" (click)="allMovesOpen.set(true)">Meer ({{ hiddenMoves() }}) ›</button>
              }
            } @else {
              <p class="pd-empty pd-empty--gap">Nog geen voorraadbewegingen.</p>
            }
          }
        </section>
      </ng-template>

      <!-- ============================ Website & publicatie (today's card) -->
      <ng-template #webCard>
        <section class="pdk-card" id="pd-web" aria-labelledby="pd-web-title">
          <div class="pdk-card__head">
            <div><h2 id="pd-web-title">Website &amp; publicatie</h2><p>{{ publicationSummary() }}</p></div>
            <div class="pd-channels" aria-label="Verkoopkanalen">
              <span [class.is-live]="publicationActive() && websiteStatus() === 'PUBLISHED'"><i aria-hidden="true"></i>Website</span>
              <span [class.is-live]="publicationActive() && orderAppStatus() === 'PUBLISHED'"><i aria-hidden="true"></i>Orderapp</span>
            </div>
          </div>
          @if (familyLoading()) {
            <app-skeleton kind="lines" [rows]="3" />
          } @else if (familyLoadError()) {
            <p class="pd-empty">De publicatiestatus is niet geladen. <button class="linklike" type="button" (click)="retryFamily()">Opnieuw proberen</button></p>
          } @else {
            <dl class="desk-facts pd-facts">
              <div><dt>Publieke URL</dt><dd class="mono">@if (publicHandle(); as handle) { /products/{{ handle }} } @else { <span class="pd-muted">nog geen</span> }</dd></div>
              @if (family(); as family) {
                <div><dt>Publieke naam</dt><dd>{{ family.name }}</dd></div>
                <div><dt>Collectie</dt><dd>{{ family.collectionKey || family.categoryName || '—' }}</dd></div>
                @if (family.summary) { <div><dt>Samenvatting</dt><dd class="pd-prose">{{ family.summary }}</dd></div> }
              }
            </dl>
            @if (publicationIssues().length; as open) {
              <div class="pd-kicker pd-kicker--gap">Nog {{ open }} punt{{ open === 1 ? '' : 'en' }} vóór publicatie</div>
              <div class="pd-fix">
                @for (group of issueGroups(); track group.key) {
                  <div class="pd-fix__group">
                    <div class="pd-fix__head">
                      <b>{{ group.label }}<small>{{ group.issues.length }}</small></b>
                      <a class="linklike" [routerLink]="group.link" [queryParams]="group.params">{{ group.action }} ›</a>
                    </div>
                    <ul>@for (issue of group.issues; track issue) { <li>{{ issue }}</li> }</ul>
                  </div>
                }
              </div>
            }
            @if (!family()) {
              <p class="pd-empty">Voor dit product zijn nog geen gedeelde websitegegevens gestart.</p>
            }
            <div class="desk-actions pd-links">
              <a class="desk-action" [routerLink]="['/products', product.id, 'translations']">
                <span><b>Publieke naam &amp; vertalingen</b><small>wat de klant leest, per taal</small></span><i aria-hidden="true">›</i>
              </a>
              <a class="desk-action" [routerLink]="['/products', product.id, 'edit']" [queryParams]="{ tab: 'publication' }">
                <span><b>Website &amp; publicatie bewerken</b><small>status, collectie en aandachtspunten</small></span><i aria-hidden="true">›</i>
              </a>
            </div>
          }
        </section>
      </ng-template>

      <!-- ============================ Documenten & media -->
      <ng-template #mediaCard>
        @if (product.id !== null) {
          <app-product-media-card class="pdk-card" id="pd-media" [productId]="product.id" />
        }
      </ng-template>

      <!-- ============================ Afspraken leverancier: folded to 136 px, the references visible -->
      <ng-template #agreementsCard>
        <section class="pdk-card" id="pd-agreements" aria-labelledby="pd-agreements-title">
          <div class="pdk-card__head">
            <div><h2 id="pd-agreements-title">Afspraken leverancier</h2><p>Engelse instructies en referentiefoto’s voor leveranciersdocumenten en inspectie-export · {{ supplierName() || 'de leverancier' }}</p></div>
            <span class="pdk-card__trail">
              @if (agreementPhotos().length) { <small>{{ agreementPhotos().length }} referentiefoto’s</small> }
              <a class="linklike" [routerLink]="['/products', product.id, 'edit']" [queryParams]="{ tab: 'agreements' }">Bewerken ›</a>
            </span>
          </div>
          <div class="pd-agreement">
            @if (supplierAgreement(); as agreement) {
              @if (!agreement.available) {
                <p class="pd-empty" role="note">{{ !product.supplierId ? 'Kies eerst een leverancier via Bewerken om afspraken vast te leggen.' : agreement.inherited ? 'Deze gedeelde afspraak past niet meer bij de leverancier of productreeks. Controleer de koppeling via Bewerken.' : 'De leveranciersafspraak is niet beschikbaar. Controleer de leverancier via Bewerken.' }}</p>
              } @else if (agreement.variants.length > 1) {
                <div class="pd-effective-agreement"><b>Gedeelde afspraak</b><span>{{ agreementVariantNames() }}</span>
                  @if (agreement.inherited) { <a class="linklike" [routerLink]="['/products', agreement.sourceProductId]" fragment="pd-agreements">Bronproduct bekijken ›</a> }
                </div>
              }
            }
            @if (supplierNoteBlocks().length) {
              <div class="pd-note" lang="en" [class.pdk-note--folded]="noteFolds() && !noteOpen()">
                @for (block of supplierNoteBlocks(); track $index) {
                  @if (block.kind === 'p') {
                    <p><ng-container *ngTemplateOutlet="noteText; context: { $implicit: block.text }" /></p>
                  } @else {
                    <ul>
                      @for (item of block.items; track $index) {
                        <li><ng-container *ngTemplateOutlet="noteText; context: { $implicit: item.text }" />
                          @if (item.children.length) {
                            <ul>@for (sub of item.children; track $index) { <li><ng-container *ngTemplateOutlet="noteText; context: { $implicit: sub }" /></li> }</ul>
                          }
                        </li>
                      }
                    </ul>
                  }
                }
              </div>
              @if (noteFolds()) {
                <button class="linklike pdk-more" type="button" [attr.aria-expanded]="noteOpen()" (click)="noteOpen.set(!noteOpen())">
                  {{ noteOpen() ? 'Inklappen' : 'Alles lezen · ' + noteLineCount() + ' regels ›' }}</button>
              }
            } @else if (!agreementLoading() && !agreementLoadError() && supplierAgreement()?.available !== false) {
              <p class="pd-empty">Nog geen instructies voor de leverancier.</p>
            }
            @if (agreementLoading()) {
              <app-skeleton kind="lines" [rows]="2" />
            } @else if (agreementLoadError(); as error) {
              <p class="pd-empty">{{ error }} <button class="linklike" type="button" (click)="retrySupplierAgreement()">Opnieuw proberen</button></p>
            } @else if (agreementPhotos().length) {
              <div class="pd-refs" role="list">
                @for (photo of agreementPhotos(); track photo.id) {
                  <button class="pd-ref" type="button" role="listitem" (click)="agreementLightbox.set($index)"
                          [attr.aria-label]="'Referentiefoto ' + ($index + 1) + ' vergroten'">
                    <img [appAuthSrc]="photo.viewUrl" alt="" loading="lazy" />
                    <i>Reference {{ $index + 1 }}</i>
                    <span>{{ photo.caption || photo.originalFilename }}</span>
                  </button>
                }
              </div>
            }
          </div>
        </section>
      </ng-template>

      <!-- ============================ Schade/tekort on earlier deliveries -->
      <ng-template #issuesCard>
        @if (receiptIssues().length) {
          <section class="pdk-card pd-issues" id="pd-issues" aria-labelledby="pd-issues-title">
            <div class="pdk-card__head">
              <div><h2 id="pd-issues-title">Eerdere leveringen met schade of tekort</h2><p>Staat als waarschuwing op de volgende leveranciersorder van dit product, met wat we noteerden</p></div>
              <a class="linklike" [routerLink]="['/analyses', 'purchasing']">Ontvangstanalyse ›</a>
            </div>
            <ul class="pd-issues__list">
              @for (issue of receiptIssues(); track issue.orderId) {
                <li>
                  <a class="pd-issues__order" [routerLink]="['/purchasing', issue.orderId]">{{ issue.orderNumber }}</a>
                  <span class="pd-issues__when">{{ issue.receivedOn ? (issue.receivedOn | dateNl) : '—' }}</span>
                  <span class="pd-issues__facts">{{ issue.ordered | num }} besteld · {{ issue.received | num }} ontvangen@if (issue.damaged) { · <b>{{ issue.damaged | num }} beschadigd</b> }@if (issue.missing) { · <b>{{ issue.missing | num }} te weinig</b> }@if (issue.laterDamaged || issue.laterMissing) { · <i>na uitpakken gemeld: @if (issue.laterDamaged) {{{ issue.laterDamaged | num }} beschadigd}@if (issue.laterDamaged && issue.laterMissing) { en }@if (issue.laterMissing) {{{ issue.laterMissing | num }} te weinig}</i> }</span>
                  @if (issue.note) { <span class="pd-issues__note">{{ issue.note }}</span> }
                  @else if (!issue.laterNote) { <span class="pd-issues__note pd-issues__note--empty">Geen reden genoteerd. Zet ze bij de regel op de inkooporder.</span> }
                  @if (issue.laterNote) { <span class="pd-issues__note">{{ issue.laterNote }}</span> }
                </li>
              }
            </ul>
          </section>
        }
      </ng-template>

      <ng-template #noteText let-text>
        @for (part of noteParts(text); track $index) {
          @if (part.ref !== null && part.ref <= agreementPhotos().length) {
            <button class="pd-note__ref" type="button" [title]="'Reference ' + part.ref + ' bekijken'" (click)="agreementLightbox.set(part.ref - 1)">{{ part.text }}</button>
          } @else {
            {{ part.text }}
          }
        }
      </ng-template>

      <app-photo-lightbox [photos]="galleryPhotos()" [(index)]="lightbox" />
      <app-product-supplier-agreement-photo-viewer [photos]="agreementPhotos()" [(index)]="agreementLightbox" />
      @if (historyOpen()) {
        <app-product-cost-history-sheet [product]="product" [sourceLink]="historySourceLink()" (closed)="historyOpen.set(false)" />
      }
      <!-- Voorraad boeken: the one sheet for every booking, at page level. -->
      @if (bookingSheet(); as booking) {
        <app-stock-booking-sheet [product]="product" [levels]="bookingLevels()" [containers]="receivedOrders()"
                                 [kind]="booking.kind" [locationId]="booking.locationId"
                                 (booked)="onBooked($event)" (closed)="bookingSheet.set(null)" />
      }
    } @else if (loadError(); as error) {
      <app-page-header title="Product" [showBell]="false" />
      <div class="content pdk">
        <app-load-error [message]="error" [busy]="reloading()" (retry)="reload()" />
      </div>
    } @else {
      <!-- Never a blank page while the product loads: the header and the shape of what comes (B6). -->
      <app-page-header title="Product" [showBell]="false" />
      <div class="content pdk" role="status" aria-live="polite" aria-label="Product laden">
        <div class="pdk-hero pdk-skel">
          <div class="pdk-skel__top"><span class="skel pdk-skel__photo"></span><span class="pdk-skel__lines"><span class="skel skel--line" style="width:30%"></span><span class="skel skel--line" style="width:55%"></span><span class="skel skel--line skel--thin" style="width:40%"></span></span></div>
          <div class="pdk-strip">@for (cell of [1, 2, 3, 4, 5, 6]; track cell) { <span class="pdk-kpi pdk-skel__kpi"><span class="skel skel--line skel--thin" style="width:50%"></span><span class="skel skel--line" style="width:70%"></span></span> }</div>
        </div>
        <div class="pdk-cols pdk-cols--skel">
          <div class="pdk-col"><div class="pdk-card"><app-skeleton kind="lines" [rows]="5" /></div><div class="pdk-card"><app-skeleton kind="lines" [rows]="6" /></div></div>
          <div class="pdk-col"><div class="pdk-card"><app-skeleton kind="lines" [rows]="4" /></div></div>
        </div>
      </div>
    }
  `,
  /* The area partial arrives with this screen's lazy chunk; its rules are scoped under app-product-desk. */
  styleUrls: ['../../../styles/products/_product-desk.scss', '../../../styles/products/_product-desk-kept.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class ProductDesk extends ProductView {
  /** From 1200 px the cards stand in two self-stacking columns. */
  readonly twoColumns = mediaSignal('(min-width: 1200px)');
  readonly descriptionOpen = signal(false);
  readonly noteOpen = signal(false);
  private openedFor: number | null = null;

  /** The build-up loads with the product, so "Opbouw tonen" opens at once. */
  constructor() {
    super();
    effect(() => {
      const product = this.product();
      if (product && product.id !== null && this.priceBuild() === null) void this.loadPriceBuild(product);
    });
    /* Another product: its description and supplier note open folded. The series chips' stock is ProductView's memberStock. */
    effect(() => {
      const id = this.product()?.id ?? null;
      if (id === null || this.openedFor === id) return;
      this.openedFor = id;
      this.descriptionOpen.set(false);
      this.noteOpen.set(false);
    });
  }

  /** "{SKU} · {publieke naam}" when the series sells under another name than the product, else the SKU. */
  readonly deskSubtitle = computed(() => {
    const product = this.product();
    if (!product) return '';
    const publicName = this.family()?.name?.trim();
    const parts = [product.sku || ''];
    if (publicName && publicName !== product.name.trim()) parts.push(publicName);
    return parts.filter(Boolean).join(' · ');
  });

  /** ["Zaltbommel 6.000", "Tica Brussel 0"], each location kept with its figure on one line; "alle locaties" with one location. */
  readonly stockSplit = computed(() => {
    const levels = this.stockLevels() ?? [];
    if (levels.length <= 1) return ['alle locaties'];
    return levels.map((level) => `${level.name} ${level.quantity.toLocaleString('nl-BE')}`);
  });

  unitWord(product: Product, quantity: number): string {
    const unit = this.salesUnit(product);
    return quantity === 1 ? unit.singular : unit.plural;
  }

  longDescription(text: string): boolean {
    return text.length > 180 || text.split('\n').length > 3;
  }

  /** The supplier note folds to 136 px once it is longer than about five lines. */
  readonly noteLineCount = computed(() => this.supplierNoteBlocks().reduce((sum, block) =>
    sum + (block.kind === 'p' ? Math.max(1, block.text.split('\n').length)
      : block.items.reduce((items, item) => items + 1 + item.children.length, 0)), 0));
  readonly noteFolds = computed(() => this.noteLineCount() > 5);

  /**
   * E Bewerken, B Voorraad boeken, ⌥ ← / ⌥ → the previous or next colour
   * (the stepper's own links). Off while typing, with a sheet open or with
   * a photo enlarged (the lightboxes are no kit overlay).
   */
  onDocumentKey(event: KeyboardEvent): void {
    const product = this.product();
    if (!product || product.id === null) return;
    if (this.lightbox() >= 0 || this.agreementLightbox() >= 0) return;
    const context = keyContext(event, null);
    if (context.typing || context.overlayOpen || context.mod) return;
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      const around = this.variantNeighbours();
      const target = event.key === 'ArrowLeft' ? around?.previous : around?.next;
      if (!target) return;
      event.preventDefault();
      void this.router.navigate(['/products', target.productId]);
      return;
    }
    if (event.altKey || event.shiftKey) return;
    if (event.key === 'e' || event.key === 'E') {
      event.preventDefault();
      void this.router.navigate(['/products', product.id, 'edit']);
    } else if (event.key === 'b' || event.key === 'B') {
      event.preventDefault();
      this.openBooking('RECOUNT');
    }
  }


  /** Per-piece rows of the build-up: a mark, the label without its "+", and the last one as the total. */
  readonly chainRows = computed(() => {
    const rows = (this.priceBuild()?.rows ?? []).filter((row) => !row.aside);
    const lastSum = rows.map((row) => !!row.sum).lastIndexOf(true);
    return rows.map((row, index) => ({
      mark: row.note ? '◆' : row.sum ? '=' : row.label.startsWith('+') ? '+' : '·',
      label: row.label.replace(/^\+\s*/, ''),
      hint: row.note ? `catalogusprijs min kostprijs, wat er per ${this.salesUnit(this.product()).singular} overblijft` : row.hint,
      eur: row.eur,
      sum: !!row.sum,
      last: index === lastSum,
      margin: !!row.note,
    }));
  });

  readonly asideRows = computed(() => (this.priceBuild()?.rows ?? []).filter((row) => row.aside));

  readonly hexOf = colourHexOf;

  packagingLabel(product: Product): string | null {
    const packaging = product.packaging;
    if (!packaging || packaging.kind === 'NONE') return null;
    if (packaging.kind === 'DISPLAY') {
      const pieces = packaging.piecesPerUnit ?? 0;
      return pieces > 1 ? `Display van ${pieces.toLocaleString('nl-BE')} ${this.salesUnit(product).piece.other}` : 'Display';
    }
    return 'Geschenkdoosje';
  }

  /** "Reference 2" in the note is a link to that photo. */
  noteParts(text: string): { text: string; ref: number | null }[] {
    const parts: { text: string; ref: number | null }[] = [];
    const pattern = /\b(?:reference|ref\.?|photo|foto)\s*#?\s*(\d{1,2})\b/gi;
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      const at = match.index ?? 0;
      if (at > last) parts.push({ text: text.slice(last, at), ref: null });
      parts.push({ text: match[0], ref: Number(match[1]) });
      last = at + match[0].length;
    }
    if (last < text.length) parts.push({ text: text.slice(last), ref: null });
    return parts;
  }

  /* ---- publication points, grouped by where they are fixed */
  readonly issueGroups = computed<IssueGroup[]>(() => {
    const id = this.product()?.id;
    const edit = ['/products', id, 'edit'];
    const groups: IssueGroup[] = [
      { key: 'copy', label: 'Websitetekst', action: 'Tekst schrijven', link: ['/products', id, 'translations'], params: null, issues: [] },
      { key: 'photos', label: 'Foto’s', action: 'Foto’s beheren', link: edit, params: { tab: 'media' }, issues: [] },
      { key: 'collection', label: 'Collectie op de website', action: 'Categorieën openen', link: ['/website/categories'], params: null, issues: [] },
      { key: 'settings', label: 'Publicatie-instellingen', action: 'Openen', link: edit, params: { tab: 'publication' }, issues: [] },
    ];
    for (const issue of this.publicationIssues()) {
      const key = /foto/i.test(issue) ? 'photos'
        : /collectie/i.test(issue) ? 'collection'
        : /samenvatting|beschrijving|seo|vertaald|highlights|formaat|alt-tekst|kleurnaam|\bnaam\b|\bmaat\b/i.test(issue) ? 'copy'
        : 'settings';
      groups.find((group) => group.key === key)!.issues.push(issue);
    }
    return groups.filter((group) => group.issues.length);
  });

  /** A money tile in the hero unfolds the build-up and walks down to it. */
  openPriceDetail(): void {
    this.priceOpen.set(true);
    this.scrollTo('pd-price');
  }

  scrollTo(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
