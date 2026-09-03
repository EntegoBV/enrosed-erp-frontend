import { ChangeDetectionStrategy, Component, computed, effect, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthImage } from '../../core/api/auth-image';
import { messageOf } from '../../core/api/errors';
import { Product } from '../../core/api/models';
import { PhotoLightbox } from '../../shared/photo-lightbox';
import { PageHeader } from '../../shared/page-header';
import { CbmPipe, CurPipe, DateNlPipe, DateTimeNlPipe, EurPipe, NumPipe } from '../../shared/pipes';
import { colourHexOf } from '../purchasing/purchase-desk-format';
import { ProductMediaCard } from './product-media-card';
import { ProductSupplierAgreementEditor } from './product-supplier-agreement-editor';
import { ProductSupplierAgreementPhotoViewer } from './product-supplier-agreement-photo-viewer';
import { ProductView } from './product-view';
import { NoteBlock, parseSupplierNote } from './supplier-note';

type BookingKind = 'RECOUNT' | 'DAMAGED' | 'DEMO';
interface IssueGroup { key: string; label: string; action: string; link: unknown[]; params: Record<string, string> | null; issues: string[]; }

interface Booking { kind: BookingKind; locationId: number | null; quantity: number | null; note: string; }

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
  imports: [
    NgTemplateOutlet, RouterLink, AuthImage, PhotoLightbox, ProductSupplierAgreementPhotoViewer, ProductSupplierAgreementEditor, ProductMediaCard, PageHeader,
    CbmPipe, CurPipe, DateNlPipe, DateTimeNlPipe, EurPipe, NumPipe,
  ],
  template: `
    @if (product(); as product) {
      <app-page-header [title]="product.name" [subtitle]="product.sku || ''" [showBack]="true" [showBell]="false">
        @if (variantNeighbours(); as around) {
          <span class="product-nav" role="group" aria-label="Producten en kleurvarianten">
            <a class="btn btn--sm product-nav__btn" [class.product-nav__btn--off]="!around.previous"
               [routerLink]="around.previous ? ['/products', around.previous.productId] : null"
               [attr.aria-disabled]="!around.previous"
               [title]="around.previous ? (around.previousChangesProduct ? 'Vorig product: ' + around.previous.groupName : 'Vorige kleur: ' + around.previous.optionLabel) : 'Dit is het eerste product'">‹</a>
            <small class="product-nav__pos">{{ around.total > 1 ? 'Kleur ' + (around.index + 1) + '/' + around.total : 'Product' }}</small>
            <a class="btn btn--sm product-nav__btn" [class.product-nav__btn--off]="!around.next"
               [routerLink]="around.next ? ['/products', around.next.productId] : null"
               [attr.aria-disabled]="!around.next"
               [title]="around.next ? (around.nextChangesProduct ? 'Volgend product: ' + around.next.groupName : 'Volgende kleur: ' + around.next.optionLabel) : 'Dit is het laatste product'">›</a>
          </span>
        }
        <a class="btn btn--sm" [routerLink]="['/products', product.id, 'edit']" [queryParams]="{ tab: 'media' }">Foto’s</a>
        <a class="btn btn--primary btn--sm" [routerLink]="['/products', product.id, 'edit']">Bewerken</a>
      </app-page-header>

      <div class="content desk">
        <!-- ============================ hero: what it is, and the six figures -->
        <header class="desk-hero">
          <div class="desk-hero__top">
            <div class="desk-hero__who">
              <span class="desk-hero__eyebrow">{{ categoryName() || 'Catalogus' }}@if (product.sku) { · {{ product.sku }} }</span>
              <h1>{{ product.name }}</h1>
              <p>
                @if (supplierName(); as name) {
                  <a class="pd-hero-link" [routerLink]="['/suppliers']" [queryParams]="{ q: name }">{{ name }} ›</a>
                } @else { Geen leverancier }
                @if (packagingLabel(product); as packaging) { · {{ packaging }} }
                @if (product.carton.piecesPerCarton) { · {{ product.carton.piecesPerCarton | num }} per omdoos }
              </p>
            </div>
            <div class="pd-chips" role="group" aria-label="Kenmerken">
              <span class="pd-chip" [class.pd-chip--ok]="product.active && !product.demo" [class.pd-chip--warn]="!product.active || product.demo">
                {{ product.active ? (product.demo ? 'Demo' : 'Actief') : 'Inactief' }}
              </span>
              @if (product.colour) {
                <span class="pd-chip">
                  @if (hexOf(product.colourHex, product.colour); as hex) { <i [style.background]="hex" aria-hidden="true"></i> }
                  {{ product.colour }}
                </span>
              }
              @if (product.variantSize) { <span class="pd-chip">Maat {{ product.variantSize }}</span> }
              @if (product.hsCode) { <span class="pd-chip mono">HS {{ product.hsCode }}</span> }
            </div>
          </div>

          <div class="desk-kpis" aria-label="Kerncijfers">
            <button class="desk-kpi desk-kpi--button" type="button" (click)="scrollTo('pd-stock')">
              <small>Voorraad</small>
              @if (stockLevels()) {
                <strong [class.is-bad]="stockTotal() <= 0">{{ stockTotal() | num }}</strong>
                <span>{{ stockSummary() }}</span>
              } @else if (product.inventoryKnown) {
                <strong [class.is-bad]="product.stockQuantity <= 0">{{ product.stockQuantity | num }}</strong>
                <span>stuks</span>
              } @else {
                <strong>—</strong>
                <span>nog niet bevestigd</span>
              }
            </button>
            @if (expected(); as exp) {
              <a class="desk-kpi desk-kpi--button" [routerLink]="['/purchasing', exp.orderIds[0]]"
                 [attr.title]="'Open ' + exp.orderNumbers.join(', ')">
                <small>Onderweg</small>
                <strong>+{{ exp.quantity | num }}</strong>
                <span>{{ exp.expectedArrival ? 'verwacht ' + (exp.expectedArrival | dateNl) + ' · ' : '' }}{{ exp.orderNumbers.join(', ') }}</span>
              </a>
            } @else {
              <div class="desk-kpi">
                <small>Onderweg</small>
                <strong>—</strong>
                <span>niets besteld</span>
              </div>
            }
            <button class="desk-kpi desk-kpi--button" type="button" (click)="openPriceDetail()">
              <small>Kostprijs</small>
              @if (product.landedCostEur; as landed) {
                <strong>{{ landed | eur: 2 }}</strong>
                <span>geland{{ product.landedCostSource ? ' · ' + product.landedCostSource : ', incl. transport en rechten' }}</span>
              } @else {
                <strong>—</strong>
                <span>nog geen kostprijs</span>
              }
            </button>
            <button class="desk-kpi desk-kpi--button" type="button" (click)="openPriceDetail()">
              <small>Catalogusprijs</small>
              @if (displayPrice(); as price) {
                <strong>{{ price | eur: 2 }}</strong>
                <span>{{ hasFixedSalesPrice(product) ? 'vaste verkoopprijs' : '+ ' + (product.markupPct | num) + ' % op de kostprijs' }}</span>
              } @else {
                <strong>—</strong>
                <span>nog geen prijs</span>
              }
            </button>
            <button class="desk-kpi desk-kpi--button desk-kpi--total" type="button" (click)="openPriceDetail()">
              <small>Marge per stuk</small>
              @if (margin(); as value) {
                <strong [class.is-bad]="value.eur < 0">{{ value.eur | eur: 2 }}</strong>
                <span>{{ value.pct }} % van de prijs</span>
              } @else {
                <strong>—</strong>
                <span>kostprijs of prijs ontbreekt</span>
              }
            </button>
            @if (publicationIssues().length; as open) {
              <button class="desk-kpi desk-kpi--go" type="button" (click)="scrollTo('pd-web')">
                <small>Publicatie</small>
                <strong>{{ open }} punt{{ open === 1 ? '' : 'en' }} open ›</strong>
                <span>{{ publicationSummary() }}</span>
              </button>
            } @else {
              <button class="desk-kpi desk-kpi--button" type="button" (click)="scrollTo('pd-web')">
                <small>Publicatie</small>
                <strong>{{ publicationSummary() }}</strong>
                <span>website & orderapp</span>
              </button>
            }
          </div>
        </header>

        <!-- ============================ the series: one quiet line, the other colours a click away -->
        @if (variantMembers().length > 1) {
          <p class="pd-series" aria-label="Productreeks">
            <span>Reeks · {{ family()?.name || product.name }}</span>
            @for (member of variantMembers(); track member.productId) {
              @let sibling = catalogueProduct(member.productId);
              @let current = member.productId === product.id;
              <a class="pd-series__chip" [class.pd-series__chip--now]="current" [class.pd-series__chip--off]="!member.active"
                 [routerLink]="current ? null : ['/products', member.productId]" [attr.aria-current]="current ? 'page' : null"
                 [title]="member.sku ? member.sku + (sibling ? ' · ' + sibling.stockQuantity.toLocaleString('nl-BE') + ' op voorraad' : '') : null">
                @if (hexOf(member.colourHex, member.colour); as hex) { <i [style.background]="hex" aria-hidden="true"></i> }
                {{ variantOptionLabel(member) }}@if (sibling) { <small>{{ sibling.stockQuantity | num }}</small> }
              </a>
            }
          </p>
        }

        <!-- ============================ the product: photo, identity and carton side by side -->
        <section class="pd-card" id="pd-product" aria-labelledby="pd-product-title">
          <div class="pd-card__head">
            <div><h2 id="pd-product-title">Product</h2><p>Foto, identificatie, verpakking en omdoos</p></div>
            <a class="linklike" [routerLink]="['/products', product.id, 'edit']">Bewerken ›</a>
          </div>
          <div class="pd-product">
            <div class="pd-gallery">
              @if (product.photos[galleryIndex()] || product.photos[0]; as photo) {
                <div class="pd-gallery__stage">
                  <button class="pd-gallery__main" type="button" (click)="lightbox.set(galleryIndex())"
                          (keydown.arrowleft)="stepGallery(-1, product.photos.length)" (keydown.arrowright)="stepGallery(1, product.photos.length)"
                          [attr.aria-label]="'Foto ' + (galleryIndex() + 1) + ' van ' + product.photos.length + ' vergroten'">
                    <img [appAuthSrc]="photo.url" [alt]="product.name + ' — foto ' + (galleryIndex() + 1)" draggable="false" />
                  </button>
                  @if (product.photos.length > 1) {
                    <button class="pd-gallery__step pd-gallery__step--prev" type="button" (click)="stepGallery(-1, product.photos.length)" aria-label="Vorige foto">‹</button>
                    <button class="pd-gallery__step pd-gallery__step--next" type="button" (click)="stepGallery(1, product.photos.length)" aria-label="Volgende foto">›</button>
                    <span class="pd-gallery__count">{{ galleryIndex() + 1 }} / {{ product.photos.length }}</span>
                  }
                </div>
                @if (product.photos.length > 1) {
                  <div class="pd-gallery__thumbs" aria-label="Kies een productfoto">
                    @for (item of product.photos; track item.id) {
                      <button type="button" [class.on]="$index === galleryIndex()" (click)="selectGalleryPhoto($index)"
                              [attr.aria-label]="'Toon foto ' + ($index + 1)">
                        <img [appAuthSrc]="item.url" alt="" draggable="false" loading="lazy" />
                      </button>
                    }
                  </div>
                }
                <a class="pd-gallery__manage" [routerLink]="['/products', product.id, 'edit']" [queryParams]="{ tab: 'media' }">
                  {{ product.photos.length }} foto{{ product.photos.length === 1 ? '' : '’s' }} · beheren ›
                </a>
              } @else {
                <a class="pd-gallery__empty" [routerLink]="['/products', product.id, 'edit']" [queryParams]="{ tab: 'media' }">
                  <b>Nog geen foto</b><small>Voeg er een toe ›</small>
                </a>
              }
            </div>

            <div>
              <div class="pd-kicker">Identificatie</div>
              <dl class="desk-facts pd-facts">
                <div><dt>Afmeting</dt><dd>{{ size(product.dimensions) }}<small>B × D × H</small></dd></div>
                <div><dt>Gewicht</dt><dd>{{ product.dimensions.weightKg ? (product.dimensions.weightKg | num) + ' kg' : '—' }}<small>per stuk</small></dd></div>
                <div><dt>Barcode stuk</dt><dd class="mono">
                  @if (product.barcodeInner; as code) {
                    <button class="pd-barcode" type="button" [title]="'Barcode-afbeelding (300 dpi) van ' + code" (click)="downloadBarcode(code)">{{ code }} <i aria-hidden="true">▥</i></button>
                  } @else { — }
                </dd></div>
                @if (product.packaging.kind !== 'NONE') {
                  <div><dt>{{ product.packaging.kind === 'DISPLAY' ? 'Display' : 'Geschenkverpakking' }}</dt><dd>
                    {{ size(product.packaging.dimensions) }}
                    <small>{{ product.packaging.dimensions.weightKg ? (product.packaging.dimensions.weightKg | num) + ' kg' : 'gewicht onbekend' }}@if (product.packaging.kind === 'DISPLAY' && product.packaging.piecesPerUnit) { · {{ product.packaging.piecesPerUnit | num }} stuks per display }</small>
                  </dd></div>
                  @if (product.packaging.barcode; as code) {
                    <div><dt>Barcode verpakking</dt><dd class="mono">
                      <button class="pd-barcode" type="button" [title]="'Barcode-afbeelding (300 dpi) van ' + code" (click)="downloadBarcode(code)">{{ code }} <i aria-hidden="true">▥</i></button>
                    </dd></div>
                  }
                } @else {
                  <div><dt>Verpakking</dt><dd class="pd-muted">Los, zonder verpakking</dd></div>
                }
                <div><dt>HS-code</dt><dd class="mono">{{ product.hsCode || '—' }}</dd></div>
                @if (product.description) {
                  <div><dt>Omschrijving</dt><dd class="pd-prose">{{ product.description }}</dd></div>
                }
              </dl>
            </div>

            <div>
              <div class="pd-kicker">Omdoos &amp; logistiek</div>
              <dl class="desk-facts pd-facts">
                <div><dt>Karton</dt><dd>{{ size(product.carton) }}<small>B × D × H</small></dd></div>
                <div><dt>Inhoud</dt><dd>{{ product.carton.piecesPerCarton | num }} stuks<small>{{ cartonPiecesAuto(product) ? 'berekend uit de maten' : 'per omdoos' }}</small></dd></div>
                <div><dt>Gewicht</dt><dd>@if (product.carton.weightKg) { {{ product.carton.weightKg | num }} kg } @else { — }<small>{{ product.carton.weightKg && cartonWeightAuto(product) ? 'berekend uit de stuks' : 'per omdoos' }}</small></dd></div>
                <div><dt>Volume</dt><dd>@if (product.cartonCbm) { {{ product.cartonCbm | cbm }} } @else { — }@if (product.pieceCbm) { <small>{{ product.pieceCbm | cbm }} per stuk</small> }</dd></div>
                <div><dt>Per 40' HC</dt><dd>@if (product.carton.hcCapacity; as hc) { {{ hc | num }} stuks } @else { — }@if (product.carton.hcCapacity) { <small>{{ product.carton.piecesPerHc ? 'handmatig geteld' : 'volle dozen op volume' }}</small> }</dd></div>
                <div><dt>Omdoosbarcode</dt><dd class="mono">
                  @if (product.barcodeOuter; as code) {
                    <button class="pd-barcode" type="button" [title]="'Barcode-afbeelding (300 dpi) van ' + code" (click)="downloadBarcode(code)">{{ code }} <i aria-hidden="true">▥</i></button>
                  } @else { — }
                </dd></div>
              </dl>
            </div>
          </div>
        </section>

        <!-- ============================ price: one line from factory to margin; the build-up on request -->
        <section class="pd-card" id="pd-price" aria-labelledby="pd-price-title">
          <div class="pd-card__head">
            <div><h2 id="pd-price-title">Prijs &amp; marge</h2><p>Per stuk, van fabrieksprijs tot wat er overblijft</p></div>
            <button class="linklike" type="button" [attr.aria-expanded]="priceOpen()" (click)="priceOpen.set(!priceOpen())">
              {{ priceOpen() ? 'Opbouw verbergen' : 'Opbouw tonen ›' }}
            </button>
          </div>
          <div class="pd-flow">
            <div class="pd-flow__step">
              <small>EXW-prijs</small>
              <b>@if (product.exwPrice; as price) { {{ price | cur: product.exwCurrency }} } @else { — }</b>
              <span>{{ product.extraUnitCost ? '+ ' + (product.extraUnitCost | cur: product.exwCurrency) + ' extra kost' : 'fabrieksprijs, excl. transport' }}</span>
            </div>
            <i aria-hidden="true">→</i>
            <div class="pd-flow__step">
              <small>Kostprijs</small>
              <b>@if (product.landedCostEur; as landed) { {{ landed | eur: 2 }} } @else { — }</b>
              <span>{{ product.landedCostSource ? 'geland · ' + product.landedCostSource : 'incl. transport en rechten' }}</span>
            </div>
            <i aria-hidden="true">→</i>
            <div class="pd-flow__step">
              <small>Prijsregel</small>
              <b>{{ hasFixedSalesPrice(product) ? 'Vaste prijs' : '+ ' + (product.markupPct | num) + ' %' }}</b>
              <span>{{ hasFixedSalesPrice(product) ? 'los van de kostprijs' : 'opslag op de kostprijs' }}</span>
            </div>
            <i aria-hidden="true">→</i>
            <div class="pd-flow__step pd-flow__step--price">
              <small>Catalogusprijs</small>
              <b>@if (displayPrice(); as price) { {{ price | eur: 2 }} } @else { — }</b>
              <span>{{ displayPrice() ? 'wat de klant betaalt' : 'nog geen prijs' }}</span>
            </div>
            <i aria-hidden="true">=</i>
            <div class="pd-flow__step pd-flow__step--margin" [class.is-bad]="(margin()?.eur ?? 0) < 0">
              <small>Marge per stuk</small>
              @if (margin(); as value) {
                <b>{{ value.eur | eur: 2 }}</b>
                <span>{{ value.pct }} % van de prijs</span>
              } @else {
                <b>—</b>
                <span>kostprijs of prijs ontbreekt</span>
              }
            </div>
          </div>
          @if (priceOpen()) {
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
                <p class="pd-empty">Prijsopbouw laden…</p>
              }
              <div>
                <div class="pd-kicker">Waar de cijfers vandaan komen</div>
                <dl class="desk-facts pd-facts">
                  <div><dt>Kostprijs</dt><dd>
                    @if (sourceOrderId(); as orderId) { <a [routerLink]="['/purchasing', orderId]">{{ product.landedCostSource }} ›</a> }
                    @else { {{ product.landedCostSource || 'Handmatig' }} }
                    <small>{{ product.landedCostSource ? 'de inkoopcalculatie: transport, rechten en Enrosed kost per stuk' : 'nog geen ontvangen container achter deze kostprijs' }}</small></dd></div>
                  <div><dt>Extra kost</dt><dd>@if (product.extraUnitCost; as extra) { {{ extra | cur: product.exwCurrency }} } @else { — }<small>per stuk, bv. display of giftbox, telt mee in de kostprijs</small></dd></div>
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
        </section>

        <!-- ============================ stock and website, side by side -->
        <div class="pd-duo">
          <section class="pd-card" id="pd-stock" aria-labelledby="pd-stock-title">
            <div class="pd-card__head">
              <div><h2 id="pd-stock-title">Voorraad</h2><p>Per locatie, in stuks · klik een locatie voor een hertelling</p></div>
              <b class="pd-total" [class.is-bad]="stockTotal() <= 0">{{ stockLevels() ? (stockTotal() | num) : '—' }}</b>
            </div>
            @if (stockLevels(); as levels) {
              <div class="pd-levels">
                @for (level of levels; track level.locationId) {
                  <button class="pd-level" type="button" [class.pd-level--on]="booking()?.locationId === level.locationId"
                          [title]="'Hertelling boeken voor ' + level.name" (click)="openBooking('RECOUNT', level.locationId)">
                    <span><b>{{ level.name }}</b><small>{{ level.kindLabel }} · {{ level.countsForWebsite ? 'alle verkoopkanalen' : 'enkel ter plaatse' }}</small></span>
                    <strong [class.pd-muted]="!level.quantity">{{ level.quantity | num }}</strong>
                  </button>
                } @empty {
                  <p class="pd-empty">Nog geen voorraadlocaties.</p>
                }
              </div>
            } @else {
              <p class="pd-empty">Voorraad laden…</p>
            }
            @if (booking(); as book) {
              <form class="pd-booking" (submit)="$event.preventDefault(); confirmBooking()">
                <div class="per-toggle" role="group" aria-label="Wat boek je?">
                  <button type="button" [class.on]="book.kind === 'RECOUNT'" (click)="setBookingKind('RECOUNT')">Hertelling</button>
                  <button type="button" [class.on]="book.kind === 'DAMAGED'" (click)="setBookingKind('DAMAGED')">Beschadigd</button>
                  <button type="button" [class.on]="book.kind === 'DEMO'" (click)="setBookingKind('DEMO')">Demo</button>
                </div>
                <p class="pd-booking__why">{{ bookingHelp(book.kind) }}</p>
                <div class="desk-form__duo">
                  @if ((stockLevels() ?? []).length > 1) {
                    <div class="field">
                      <label for="pd-book-loc">Locatie</label>
                      <select class="select" id="pd-book-loc" (change)="setBookingLocation(+$any($event.target).value)">
                        @for (level of stockLevels(); track level.locationId) {
                          <option [value]="level.locationId" [selected]="book.locationId === level.locationId">{{ level.name }} ({{ level.quantity | num }})</option>
                        }
                      </select>
                    </div>
                  }
                  <div class="field">
                    <label class="req" for="pd-book-qty">{{ book.kind === 'RECOUNT' ? 'Geteld' : 'Aantal stuks' }}</label>
                    <input class="input num right" id="pd-book-qty" type="number" min="0" step="1" inputmode="numeric" autofocus
                           [value]="book.quantity ?? ''" (input)="setBookingQuantity($any($event.target).value)" />
                  </div>
                </div>
                <div class="field">
                  <label for="pd-book-note">Notitie <span class="opt"></span></label>
                  <input class="input" id="pd-book-note"
                         [placeholder]="book.kind === 'RECOUNT' ? 'bijv. telling na inventaris' : book.kind === 'DAMAGED' ? 'bijv. gevallen bij het laden' : 'bijv. klant Janssens'"
                         [value]="book.note" (input)="setBookingNote($any($event.target).value)" />
                </div>
                @if (bookingPreview(); as preview) {
                  <p class="pd-booking__preview" [class.is-short]="preview.after < 0" [class.is-same]="preview.delta === 0">
                    @if (preview.after < 0) {
                      Meer dan er ligt op {{ preview.location }} ({{ preview.before | num }})
                    } @else if (preview.delta === 0) {
                      {{ preview.location }} blijft op {{ preview.before | num }}
                    } @else {
                      {{ preview.location }}: {{ preview.before | num }} → <b>{{ preview.after | num }}</b>
                      <em [class.is-minus]="preview.delta < 0" [class.is-plus]="preview.delta > 0">{{ preview.delta > 0 ? '+' : '' }}{{ preview.delta | num }}</em>
                    }
                  </p>
                }
                <div class="pd-actions">
                  <button class="btn btn--sm" type="button" (click)="booking.set(null)">Annuleren</button>
                  <button class="btn btn--sm btn--primary" type="submit" [disabled]="stockSaving() || !bookingReady()">{{ stockSaving() ? 'Bezig…' : bookingLabel(book.kind) }}</button>
                </div>
              </form>
            } @else {
              <div class="pd-actions">
                <button class="btn btn--sm btn--primary" type="button" (click)="openBooking('RECOUNT')">Hertelling</button>
                <button class="btn btn--sm" type="button" (click)="openBooking('DAMAGED')">Beschadigd</button>
                <button class="btn btn--sm" type="button" (click)="openBooking('DEMO')">Demo</button>
              </div>
            }
            @if (expected(); as exp) {
              <a class="pd-expected" [routerLink]="['/purchasing', exp.orderIds[0]]">
                <b>+{{ exp.quantity | num }} stuks onderweg</b>
                <small>{{ exp.orderNumbers.join(', ') }}{{ exp.expectedArrival ? ' · verwacht ' + (exp.expectedArrival | dateNl) : '' }} ›</small>
              </a>
            }
            @if (recentMoves(); as moves) {
              @if (moves.length) {
                <div class="pd-kicker pd-kicker--gap">Laatste bewegingen</div>
                <div class="pd-moves">
                  @for (move of moves; track move.id) {
                    <div class="pd-move">
                      <span><b>{{ move.kindLabel }}@if (move.reference) { · {{ move.reference }}}</b>
                        <small>{{ move.at | dateTimeNl }}@if (move.actor) { · {{ move.actor }}}@if (move.locationName) { · {{ move.locationName }}}</small></span>
                      <strong [class.is-minus]="move.delta < 0">{{ move.delta > 0 ? '+' : '' }}{{ move.delta | num }}</strong>
                    </div>
                  }
                </div>
                @if (!allMovesOpen() && hiddenMoves() > 0) {
                  <button class="linklike pd-more" type="button" (click)="allMovesOpen.set(true)">Meer ({{ hiddenMoves() }}) ›</button>
                }
              } @else {
                <p class="pd-empty pd-empty--gap">Nog geen voorraadbewegingen.</p>
              }
            }
          </section>

          <section class="pd-card" id="pd-web" aria-labelledby="pd-web-title">
            <div class="pd-card__head">
              <div><h2 id="pd-web-title">Website &amp; publicatie</h2><p>{{ publicationSummary() }}</p></div>
              <div class="pd-channels" aria-label="Verkoopkanalen">
                <span [class.is-live]="publicationActive() && websiteStatus() === 'PUBLISHED'"><i aria-hidden="true"></i>Website</span>
                <span [class.is-live]="publicationActive() && orderAppStatus() === 'PUBLISHED'"><i aria-hidden="true"></i>Orderapp</span>
              </div>
            </div>
            @if (familyLoading()) {
              <p class="pd-empty">Publicatiestatus laden…</p>
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
        </div>

        <!-- ============================ files: every library asset linked to this product -->
        @if (product.id !== null) {
          <app-product-media-card class="pd-card" id="pd-media" [productId]="product.id" />
        }

        <!-- ============================ supplier agreements: read as points, edit in place -->
        @if (agreementEditing()) {
          <div class="pd-card pd-card--editor" id="pd-agreements">
            <app-product-supplier-agreement-editor
              [productId]="product.id" [supplierId]="product.supplierId" [persistedSupplierId]="product.supplierId"
              [supplierName]="supplierName()" [note]="noteDraft()" [disabled]="noteSaving()"
              (noteChange)="noteDraft.set($event)" />
            <div class="pd-actions pd-actions--end">
              @if (agreementSiblings().length; as others) {
                <label class="pd-share">
                  <input type="checkbox" [checked]="shareAcrossColours()" (change)="setShareAcrossColours($any($event.target).checked)" />
                  <span><b>Ook voor de andere kleur{{ others === 1 ? '' : 'en' }} van deze reeks</b>
                    <small>{{ siblingNames() }} krijg{{ others === 1 ? 't' : 'en' }} dezelfde tekst en foto’s</small></span>
                </label>
              } @else {
                <span class="pd-hint pd-hint--inline">"- " begint een punt, Enter gaat verder, Tab maakt een subpunt.</span>
              }
              <button class="btn btn--sm" type="button" [disabled]="noteSaving()" (click)="cancelAgreement()">Annuleren</button>
              <button class="btn btn--sm btn--primary" type="button" [disabled]="noteSaving() || !agreementDirty()" (click)="saveAgreement(product)">{{ noteSaving() ? 'Bezig…' : 'Bewaren' }}</button>
            </div>
          </div>
        } @else {
          <section class="pd-card" id="pd-agreements" aria-labelledby="pd-agreements-title">
            <div class="pd-card__head">
              <div><h2 id="pd-agreements-title">Afspraken leverancier</h2><p>Engelse instructies en referentiefoto’s, alleen op de inkoop-PDF voor {{ supplierName() || 'de leverancier' }}</p></div>
              <button class="linklike" type="button" (click)="startAgreement(product)">{{ product.supplierNote || agreementPhotos().length ? 'Bewerken ›' : 'Afspraken vastleggen ›' }}</button>
            </div>
            <div class="pd-agreement">
              @if (noteBlocks().length) {
                <div class="pd-note" lang="en">
                  @for (block of noteBlocks(); track $index) {
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
              } @else {
                <p class="pd-empty">Nog geen instructies voor de leverancier. <button class="linklike" type="button" (click)="startAgreement(product)">Schrijf ze hier ›</button></p>
              }
              @if (agreementLoading()) {
                <p class="pd-empty">Referentiefoto’s laden…</p>
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
        }
        @if (receiptIssues().length) {
          <section class="pd-card pd-issues" id="pd-issues" aria-labelledby="pd-issues-title">
            <div class="pd-card__head">
              <div><h2 id="pd-issues-title">Eerdere leveringen met schade of tekort</h2><p>Staat als waarschuwing op de volgende leveranciersorder van dit product, met wat we noteerden</p></div>
              <a class="linklike" [routerLink]="['/analyses', 'purchasing']">Ontvangstanalyse ›</a>
            </div>
            <ul class="pd-issues__list">
              @for (issue of receiptIssues(); track issue.orderId) {
                <li>
                  <a class="pd-issues__order" [routerLink]="['/purchasing', issue.orderId]">{{ issue.orderNumber }}</a>
                  <span class="pd-issues__when">{{ issue.receivedOn ? (issue.receivedOn | dateNl) : '—' }}</span>
                  <span class="pd-issues__facts">{{ issue.ordered | num }} besteld · {{ issue.received | num }} ontvangen@if (issue.damaged) { · <b>{{ issue.damaged | num }} beschadigd</b> }@if (issue.missing) { · <b>{{ issue.missing | num }} te weinig</b> }</span>
                  @if (issue.note) { <span class="pd-issues__note">{{ issue.note }}</span> }
                  @else { <span class="pd-issues__note pd-issues__note--empty">Geen reden genoteerd. Zet ze bij de regel op de inkooporder.</span> }
                </li>
              }
            </ul>
          </section>
        }
      </div>

      <ng-template #noteText let-text>
        @for (part of noteParts(text); track $index) {
          @if (part.ref !== null && part.ref <= agreementPhotos().length) {
            <button class="pd-note__ref" type="button" [title]="'Reference ' + part.ref + ' bekijken'" (click)="agreementLightbox.set(part.ref - 1)">{{ part.text }}</button>
          } @else {
            {{ part.text }}
          }
        }
      </ng-template>

      <app-photo-lightbox [photos]="product.photos" [(index)]="lightbox" />
      <app-product-supplier-agreement-photo-viewer [photos]="agreementPhotos()" [(index)]="agreementLightbox" />
    }
  `,
  styles: [`
    :host{display:block;min-width:0}
    .pd-hero-link{color:inherit;text-decoration:none}.pd-hero-link:hover{text-decoration:underline}
    .pd-chips{display:flex;flex:none;flex-wrap:wrap;justify-content:flex-end;gap:4px;max-width:420px}
    .pd-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border:1px solid rgb(255 255 255/.16);border-radius:999px;background:rgb(255 255 255/.06);color:rgb(255 255 255/.8);font-size:11.5px;font-weight:650;white-space:nowrap}
    .pd-chip--ok{color:#9fe0b4;border-color:rgb(159 224 180/.35);background:rgb(159 224 180/.1)}.pd-chip--warn{color:#f4cf9a;border-color:rgb(244 207 154/.35);background:rgb(244 207 154/.1)}
    .pd-chip i,.pd-series__chip i{display:inline-block;width:10px;height:10px;border:1px solid rgb(0 0 0/.15);border-radius:50%}
    .desk-kpi strong.is-bad{color:#f6a3a3}

    /* ---- the series: a quiet line */
    .pd-series{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:12px 4px 0;color:var(--muted);font-size:11.5px}
    .pd-series>span{margin-right:4px;font-weight:650}
    .pd-series__chip{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--ink-2);font-size:11.5px;font-weight:600;text-decoration:none}
    .pd-series__chip small{color:var(--muted);font-size:10.5px;font-variant-numeric:tabular-nums}
    a.pd-series__chip[href]:hover{border-color:var(--rose);color:var(--rose-dark)}
    .pd-series__chip--now{border-color:var(--rose);background:var(--rose-soft);color:var(--rose-dark)}.pd-series__chip--off{opacity:.6}

    /* ---- cards */
    .pd-card{margin-top:14px;padding:16px 18px 18px;border:1px solid var(--line);border-radius:18px;background:var(--surface);box-shadow:var(--sh-1)}
    .pd-card__head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}
    .pd-card__head h2{margin:0;font-size:15px}.pd-card__head p{margin:1px 0 0;color:var(--muted);font-size:11.5px}
    .pd-kicker{margin:0 0 4px;color:var(--rose);font-size:10px;font-weight:760;letter-spacing:.1em;text-transform:uppercase}.pd-kicker--gap{margin-top:14px}
    .pd-muted{color:var(--muted);font-weight:500}.pd-prose{font-weight:500;line-height:1.4;white-space:pre-wrap}
    .pd-empty{margin:0;padding:10px 12px;border:1px dashed var(--line-strong);border-radius:12px;color:var(--muted);font-size:12px}.pd-empty--gap{margin-top:14px}
    .pd-facts>div{grid-template-columns:118px minmax(0,1fr)}.pd-facts>div:last-child{border-bottom:0}
    .pd-barcode{display:inline-flex;align-items:center;gap:5px;padding:0;border:0;background:none;color:var(--rose-dark);font:inherit;font-weight:650;cursor:pointer}.pd-barcode:hover{text-decoration:underline}.pd-barcode i{font-style:normal;font-size:13px;color:var(--muted)}
    .pd-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}

    /* ---- price: the flow, then the build-up on request */
    .pd-flow{display:flex;flex-wrap:wrap;align-items:stretch;gap:8px}
    .pd-flow__step{display:grid;flex:1 1 150px;align-content:start;gap:2px;min-width:0;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}
    .pd-flow__step small{color:var(--muted);font-size:9.5px;font-weight:750;letter-spacing:.08em;text-transform:uppercase}
    .pd-flow__step b{font-size:17px;font-variant-numeric:tabular-nums;line-height:1.15}
    .pd-flow__step span{overflow:hidden;color:var(--muted);font-size:11px;text-overflow:ellipsis;white-space:nowrap}
    .pd-flow>i{align-self:center;flex:none;color:var(--muted);font-style:normal;font-size:15px;font-weight:700}
    .pd-flow__step--price b{color:var(--rose-dark)}
    .pd-flow__step--margin{border-color:color-mix(in srgb,var(--ok) 45%,transparent);background:color-mix(in srgb,var(--ok) 9%,var(--surface))}.pd-flow__step--margin b{color:var(--ok)}
    .pd-flow__step--margin.is-bad{border-color:color-mix(in srgb,var(--danger) 45%,transparent);background:var(--danger-soft)}.pd-flow__step--margin.is-bad b{color:var(--danger)}
    .pd-price__detail{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(260px,1fr);gap:20px;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}
    .pd-aside{margin:8px 0 0;color:var(--muted);font-size:11.5px}.pd-aside b{color:var(--ink-2);font-variant-numeric:tabular-nums}

    /* ---- product: photo, identity and carton in three columns */
    .pd-product{display:grid;grid-template-columns:minmax(200px,240px) minmax(0,1fr) minmax(0,1fr);gap:24px;align-items:start}
    .pd-gallery{display:grid;gap:6px}
    .pd-gallery__stage{position:relative}
    .pd-gallery__main{display:block;width:100%;aspect-ratio:1;padding:0;border:1px solid var(--line);border-radius:14px;background:var(--surface-2);overflow:hidden;cursor:zoom-in}
    .pd-gallery__main img{display:block;width:100%;height:100%;object-fit:cover}
    .pd-gallery__step{position:absolute;top:50%;width:30px;height:30px;padding:0;border:0;border-radius:50%;background:rgb(255 255 255/.85);color:var(--ink);font-size:18px;line-height:1;box-shadow:var(--sh-1);cursor:pointer;transform:translateY(-50%);opacity:0;transition:opacity .12s}
    .pd-gallery__step--prev{left:8px}.pd-gallery__step--next{right:8px}.pd-gallery__stage:hover .pd-gallery__step,.pd-gallery__step:focus-visible{opacity:1}
    .pd-gallery__count{position:absolute;right:8px;bottom:8px;padding:2px 8px;border-radius:999px;background:rgb(16 13 12/.62);color:#fff;font-size:10.5px;font-weight:700;font-variant-numeric:tabular-nums}
    .pd-gallery__thumbs{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;scrollbar-width:thin}.pd-gallery__thumbs button{flex:none;width:48px;height:48px;padding:0;border:2px solid transparent;border-radius:10px;background:var(--surface-2);overflow:hidden;cursor:pointer}
    .pd-gallery__thumbs button.on{border-color:var(--rose)}.pd-gallery__thumbs img{display:block;width:100%;height:100%;object-fit:cover}
    .pd-gallery__manage{color:var(--muted);font-size:11.5px;text-decoration:none}.pd-gallery__manage:hover{color:var(--rose-dark);text-decoration:underline}
    .pd-gallery__empty{display:grid;place-content:center;gap:2px;aspect-ratio:1;border:1px dashed var(--line-strong);border-radius:14px;color:var(--muted);text-align:center;text-decoration:none}.pd-gallery__empty b{color:var(--ink-2);font-size:13px}.pd-gallery__empty small{font-size:11.5px}

    /* ---- stock and website */
    .pd-duo{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:14px}.pd-duo>.pd-card{margin-top:0}
    .pd-total{font-size:22px;font-weight:750;font-variant-numeric:tabular-nums;line-height:1}.pd-total.is-bad{color:var(--danger)}
    .pd-levels{display:grid;border-top:1px solid var(--line)}
    .pd-level{display:flex;width:100%;align-items:center;justify-content:space-between;gap:10px;padding:8px 6px;border:0;border-bottom:1px solid var(--line);border-radius:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
    .pd-level:hover{background:var(--surface-2)}.pd-level--on{background:var(--rose-soft)}
    .pd-level>span{display:grid;min-width:0}.pd-level b{font-size:12.5px}.pd-level small{color:var(--muted);font-size:10.5px}.pd-level strong{font-size:14px;font-variant-numeric:tabular-nums}
    .pd-booking{display:grid;gap:10px;margin-top:12px;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}
    .pd-booking .pd-actions{margin-top:0}.pd-booking .desk-form__duo{gap:8px}
    .pd-booking__why{margin:0;color:var(--muted);font-size:11.5px;line-height:1.4}
    .pd-booking__preview{display:flex;align-items:center;gap:6px;margin:0;padding:8px 10px;border-radius:10px;background:var(--surface);font-size:12.5px}
    .pd-booking__preview b{font-weight:750}.pd-booking__preview em{margin-left:auto;font-style:normal;font-weight:750;font-variant-numeric:tabular-nums}.pd-booking__preview em.is-minus{color:var(--danger)}.pd-booking__preview em.is-plus{color:var(--ok)}
    .pd-booking__preview.is-short{background:var(--danger-soft);color:var(--danger)}.pd-booking__preview.is-same{color:var(--muted)}
    .pd-expected{display:grid;margin-top:12px;padding:9px 12px;border-radius:12px;background:var(--rose-soft);color:var(--rose-dark);text-decoration:none}.pd-expected b{font-size:12.5px}.pd-expected small{font-size:11px}
    .pd-moves{display:grid}.pd-move{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid var(--line)}
    .pd-move>span{display:grid;min-width:0}.pd-move b{overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.pd-move small{overflow:hidden;color:var(--muted);font-size:10.5px;text-overflow:ellipsis;white-space:nowrap}
    .pd-move strong{font-size:13px;font-variant-numeric:tabular-nums;color:var(--ok)}.pd-move strong.is-minus{color:var(--danger)}
    .pd-more{margin-top:6px;font-size:12px}
    .pd-channels{display:flex;flex:none;gap:6px}.pd-channels span{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:11.5px;font-weight:650;white-space:nowrap}
    .pd-channels i{width:8px;height:8px;border-radius:50%;background:var(--line-strong)}.pd-channels span.is-live{border-color:color-mix(in srgb,var(--ok) 40%,transparent);color:var(--ok)}.pd-channels span.is-live i{background:var(--ok)}
    .pd-issues{margin:0;padding:0 0 0 18px;color:var(--ink-2);font-size:12px;line-height:1.5}
    .pd-links{margin-top:14px}.desk-action{text-decoration:none}

    /* ---- publication: the points, grouped by where they are fixed */
    .pd-fix{display:grid;gap:8px}
    .pd-fix__group{padding:8px 12px 10px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}
    .pd-fix__head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px}.pd-fix__head b{font-size:12.5px}.pd-fix__head b small{margin-left:6px;padding:1px 6px;border-radius:999px;background:var(--warn);color:#fff;font-size:10px;font-weight:750}
    .pd-fix__group ul{margin:0;padding:0 0 0 16px;color:var(--ink-2);font-size:12px;line-height:1.5}
    .pd-chain__row--margin{background:color-mix(in srgb,var(--ok) 9%,var(--surface))}.pd-chain__row--margin i{background:var(--ok);color:#fff}.pd-chain__row--margin b{color:var(--ok);font-weight:750}

    /* ---- supplier agreements */
    .pd-issues__list{display:grid;gap:8px;margin:0;padding:0;list-style:none}
    .pd-issues__list li{display:grid;grid-template-columns:auto auto minmax(0,1fr);gap:3px 12px;align-items:baseline;padding:10px 12px;border:1px solid #f0d2d9;border-left:3px solid var(--rose);border-radius:12px;background:#fff6f8}
    .pd-issues__order{color:var(--rose-dark);font-size:13px;font-weight:750;text-decoration:none}.pd-issues__order:hover{text-decoration:underline}
    .pd-issues__when{color:var(--muted);font-size:12px}.pd-issues__facts{font-size:12.5px}.pd-issues__facts b{color:var(--rose-dark)}
    .pd-issues__note{grid-column:1/-1;color:var(--ink-2);font-size:12.5px;font-style:italic}.pd-issues__note--empty{color:var(--muted)}
    .pd-card--editor{padding:0;overflow:hidden}.pd-card--editor app-product-supplier-agreement-editor{display:block}
    .pd-actions--end{justify-content:flex-end;align-items:center;margin:0;padding:10px 18px 14px;border-top:1px solid var(--line)}
    .pd-hint--inline{flex:1;margin:0;min-width:0}
    .pd-agreement{display:grid;gap:12px}
    .pd-note{margin:0;padding:10px 14px;border:1px solid #eddcb9;border-radius:12px;background:var(--warn-soft);color:var(--ink-2);font-size:12.5px;line-height:1.5}
    .pd-note p{margin:0;white-space:pre-line}.pd-note p+p,.pd-note ul+p,.pd-note p+ul{margin-top:6px}
    .pd-note ul{margin:0;padding-left:18px}.pd-note ul ul{margin-top:2px;padding-left:16px;color:var(--muted)}.pd-note li{margin:2px 0}
    .pd-refs{display:flex;flex-wrap:wrap;gap:10px}
    .pd-ref{position:relative;display:grid;gap:3px;width:118px;padding:0;border:0;background:none;color:var(--muted);font:inherit;font-size:11px;text-align:left;cursor:zoom-in}
    .pd-ref img{width:118px;height:118px;border:1px solid var(--line);border-radius:12px;object-fit:cover;background:var(--surface-2)}.pd-ref span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pd-ref i{position:absolute;top:6px;left:6px;padding:2px 7px;border-radius:999px;background:rgb(16 13 12/.72);color:#fff;font-size:10px;font-style:normal;font-weight:750}
    .pd-note__ref{display:inline;padding:0 5px;border:1px solid color-mix(in srgb,var(--rose) 35%,transparent);border-radius:999px;background:var(--surface);color:var(--rose-dark);font:inherit;font-size:11.5px;font-weight:650;cursor:pointer}.pd-note__ref:hover{background:var(--rose-soft)}
    .pd-share{display:flex;flex:1;align-items:center;gap:10px;min-width:0;cursor:pointer}.pd-share input{width:18px;height:18px;flex:none;accent-color:var(--rose)}
    .pd-share span{display:grid;min-width:0;line-height:1.25}.pd-share b{font-size:12.5px}.pd-share small{overflow:hidden;color:var(--muted);font-size:11px;text-overflow:ellipsis;white-space:nowrap}

    @media(max-width:1180px){
      .pd-product{grid-template-columns:minmax(180px,220px) minmax(0,1fr)}.pd-product>div:last-child{grid-column:1/-1}
      .pd-price__detail{grid-template-columns:1fr}
    }
    @media(max-width:980px){.pd-duo{grid-template-columns:1fr}}
  `],
})
export class ProductDesk extends ProductView {
  /** The build-up loads with the product, so "Opbouw tonen" opens at once. */
  constructor() {
    super();
    effect(() => {
      const product = this.product();
      if (product && product.id !== null && this.priceBuild() === null) void this.loadPriceBuild(product);
    });
  }

  private readonly catalogueById = computed(() =>
    new Map(this.catalogueProducts().map((product) => [product.id, product])));

  catalogueProduct(id: number): Product | undefined {
    return this.catalogueById().get(id);
  }

  /** Per-piece rows of the build-up: a mark, the label without its "+", and the last one as the total. */
  readonly chainRows = computed(() => {
    const rows = (this.priceBuild()?.rows ?? []).filter((row) => !row.aside);
    const lastSum = rows.map((row) => !!row.sum).lastIndexOf(true);
    return rows.map((row, index) => ({
      mark: row.note ? '◆' : row.sum ? '=' : row.label.startsWith('+') ? '+' : '·',
      label: row.label.replace(/^\+\s*/, ''),
      hint: row.note ? 'catalogusprijs min kostprijs, wat er per stuk overblijft' : row.hint,
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
      return pieces > 1 ? `Display van ${pieces.toLocaleString('nl-BE')} stuks` : 'Display';
    }
    return 'Geschenkverpakking';
  }

  /* ---- the supplier note as points, and editing it right here */
  readonly noteBlocks = computed(() => parseSupplierNote(this.product()?.supplierNote));
  readonly agreementEditing = signal(false);
  readonly noteDraft = signal<string | null>(null);
  readonly noteSaving = signal(false);
  readonly agreementDirty = computed(() =>
    (this.noteDraft() ?? '').trim() !== (this.product()?.supplierNote ?? '').trim());

  startAgreement(product: Product): void {
    this.noteDraft.set(product.supplierNote);
    this.agreementEditing.set(true);
  }

  /** Photos save as they go inside the editor; only the note waits for Bewaren. */
  cancelAgreement(): void {
    this.agreementEditing.set(false);
    this.retrySupplierAgreement();
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

  /* ---- the same agreement for every colour of the series, when asked */
  private static readonly SHARE_KEY = 'enrosed.agreements.share-colours';
  readonly shareAcrossColours = signal<boolean>((() => {
    try { return localStorage.getItem(ProductDesk.SHARE_KEY) === '1'; } catch { return false; }
  })());

  setShareAcrossColours(on: boolean): void {
    this.shareAcrossColours.set(on);
    try { localStorage.setItem(ProductDesk.SHARE_KEY, on ? '1' : '0'); } catch { /* remembered for this visit only */ }
  }

  /** The other colours of the series at the same supplier: agreements are per supplier. */
  readonly agreementSiblings = computed(() => {
    const product = this.product();
    if (!product) return [];
    return this.variantMembers()
      .filter((member) => member.productId !== product.id)
      .map((member) => this.catalogueProduct(member.productId))
      .filter((sibling): sibling is Product => !!sibling && sibling.id !== null && sibling.supplierId === product.supplierId);
  });

  readonly siblingNames = computed(() => this.agreementSiblings()
    .map((sibling) => sibling.colour || sibling.variantSize || sibling.sku || String(sibling.id)).join(', '));

  async saveAgreement(product: Product): Promise<void> {
    if (product.id === null) return;
    this.noteSaving.set(true);
    try {
      const note = (this.noteDraft() ?? '').trim();
      const saved = await this.catalog.updateProduct(product.id, { ...product, supplierNote: note || null });
      this.product.set(saved);
      const shared = this.shareAcrossColours() ? await this.shareAgreement(product.id, note || null) : 0;
      this.agreementEditing.set(false);
      this.retrySupplierAgreement();
      this.ui.toast(shared ? `Afspraken bewaard, ook voor ${shared} andere kleur${shared === 1 ? '' : 'en'}` : 'Afspraken bewaard');
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'Bewaren mislukt'), 'err');
    } finally {
      this.noteSaving.set(false);
    }
  }

  /**
   * Copies the note and the reference photos to the other colours: the
   * note replaces theirs, photos they do not have yet (same file name and
   * size) are added with their caption. Their own extra photos stay.
   */
  private async shareAgreement(productId: number, note: string | null): Promise<number> {
    const photos = await this.catalog.supplierAgreementPhotos(productId);
    let shared = 0;
    for (const sibling of this.agreementSiblings()) {
      const id = sibling.id!;
      const fresh = await this.catalog.product(id);
      await this.catalog.updateProduct(id, { ...fresh, supplierNote: note });
      const theirs = await this.catalog.supplierAgreementPhotos(id);
      for (const photo of photos) {
        if (theirs.some((own) => own.originalFilename === photo.originalFilename && own.sizeBytes === photo.sizeBytes)) continue;
        const blob = await this.catalog.photoBlob(photo.viewUrl);
        await this.catalog.uploadSupplierAgreementPhoto(id,
          new File([blob], photo.originalFilename, { type: photo.contentType }), photo.caption);
      }
      shared++;
    }
    return shared;
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

  /* ---- one booking flow: a recount, damaged pieces or a demo, with the effect shown first */
  readonly booking = signal<Booking | null>(null);

  private levelOf(locationId: number | null) {
    return (this.stockLevels() ?? []).find((level) => level.locationId === locationId) ?? null;
  }

  /** A location row opens a recount of that location; the buttons pick the busiest one. */
  openBooking(kind: BookingKind, locationId?: number): void {
    const levels = this.stockLevels() ?? [];
    const location = locationId ?? (levels.find((level) => level.quantity > 0) ?? levels[0])?.locationId ?? null;
    const level = this.levelOf(location);
    this.booking.set({ kind, locationId: location, quantity: kind === 'RECOUNT' ? (level?.quantity ?? null) : null, note: '' });
  }

  setBookingKind(kind: BookingKind): void {
    this.booking.update((book) => book && ({
      ...book, kind,
      quantity: kind === 'RECOUNT' ? (this.levelOf(book.locationId)?.quantity ?? null) : (book.kind === 'RECOUNT' ? null : book.quantity),
    }));
  }

  setBookingLocation(locationId: number): void {
    this.booking.update((book) => book && ({
      ...book, locationId,
      quantity: book.kind === 'RECOUNT' ? (this.levelOf(locationId)?.quantity ?? null) : book.quantity,
    }));
  }

  setBookingQuantity(raw: string): void {
    const value = raw.trim() === '' ? null : Math.max(0, Math.floor(Number(raw)));
    this.booking.update((book) => book && ({ ...book, quantity: value === null || Number.isNaN(value) ? null : value }));
  }

  setBookingNote(note: string): void {
    this.booking.update((book) => book && ({ ...book, note }));
  }

  /** What the booking does to the location, before anything is saved. */
  readonly bookingPreview = computed(() => {
    const book = this.booking();
    if (!book || book.quantity === null) return null;
    const level = this.levelOf(book.locationId);
    const before = level?.quantity ?? this.product()?.stockQuantity ?? 0;
    const after = book.kind === 'RECOUNT' ? book.quantity : before - book.quantity;
    return { location: level?.name ?? 'Voorraad', before, after, delta: after - before };
  });

  readonly bookingReady = computed(() => {
    const book = this.booking();
    const preview = this.bookingPreview();
    if (!book || !preview || book.quantity === null) return false;
    return book.kind === 'RECOUNT' ? preview.delta !== 0 : book.quantity > 0 && preview.after >= 0;
  });

  bookingHelp(kind: BookingKind): string {
    switch (kind) {
      case 'RECOUNT': return 'Tel wat er ligt; het verschil boekt als correctie.';
      case 'DAMAGED': return 'Stuk of beschadigd: de stuks gaan uit de voorraad, met een notitie waarom.';
      default: return 'Weggegeven als demo: uit de voorraad, nooit verkocht.';
    }
  }

  bookingLabel(kind: BookingKind): string {
    return kind === 'RECOUNT' ? 'Boek hertelling' : kind === 'DAMAGED' ? 'Boek beschadigd' : 'Boek demo';
  }

  async confirmBooking(): Promise<void> {
    const product = this.product();
    const book = this.booking();
    const preview = this.bookingPreview();
    if (!product || product.id === null || !book || !preview || !this.bookingReady()) return;
    this.stockSaving.set(true);
    try {
      if (book.kind === 'RECOUNT') {
        await this.catalog.setStock(product.id, book.quantity!, book.locationId, book.note.trim() || null);
        this.ui.toast(`Hertelling geboekt: ${preview.delta > 0 ? '+' : ''}${preview.delta.toLocaleString('nl-BE')} op ${preview.location}`);
      } else {
        await this.catalog.takeOutStock(product.id, {
          locationId: book.locationId, quantity: book.quantity!, kind: book.kind, note: book.note.trim() || null,
        });
        this.ui.toast(book.kind === 'DAMAGED' ? 'Beschadigde stuks geboekt' : 'Demo geboekt');
      }
      this.booking.set(null);
      this.refreshStock(product.id);
    } catch (failure) {
      this.ui.toast(messageOf(failure, 'Boeken mislukt'), 'err');
    } finally {
      this.stockSaving.set(false);
    }
  }

  scrollTo(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
