import { ChangeDetectionStrategy, Component, computed, effect, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthImage } from '../../core/api/auth-image';
import { Product } from '../../core/api/models';
import { PhotoLightbox } from '../../shared/photo-lightbox';
import { PageHeader } from '../../shared/page-header';
import { CbmPipe, CurPipe, DateNlPipe, DateTimeNlPipe, EurPipe, NumPipe } from '../../shared/pipes';
import { colourHexOf } from '../purchasing/purchase-desk-format';
import { ProductSupplierAgreementPhotoViewer } from './product-supplier-agreement-photo-viewer';
import { ProductView } from './product-view';

type RailTab = 'stock' | 'web' | 'series';

/**
 * The product desk: the product dossier on a wide screen, built like the
 * purchase desk. A dark hero answers the six questions at a glance - stock,
 * on the water, landed cost, catalogue price, margin, publication - and the
 * body puts the dossier (photo and identity, the price build-up, carton and
 * logistics, supplier agreements) in one wide column next to a sticky rail
 * for stock bookings, publication and the colour series.
 *
 * It inherits every loader and booking from the phone view and only brings
 * its own screen; editing stays an explicit step in the editor.
 */
@Component({
  selector: 'app-product-desk',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink, AuthImage, PhotoLightbox, ProductSupplierAgreementPhotoViewer, PageHeader,
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
              @if (variantMembers().length > 1) {
                <p class="desk-hero__meta pd-series" aria-label="Productreeks">
                  <span>Reeks</span>
                  @for (member of variantMembers(); track member.productId) {
                    @if (member.productId === product.id) {
                      <b class="pd-series__chip pd-series__chip--now" aria-current="page">
                        @if (hexOf(member.colourHex, member.colour); as hex) { <i [style.background]="hex" aria-hidden="true"></i> }
                        {{ variantOptionLabel(member) }}
                      </b>
                    } @else {
                      <a class="pd-series__chip" [routerLink]="['/products', member.productId]">
                        @if (hexOf(member.colourHex, member.colour); as hex) { <i [style.background]="hex" aria-hidden="true"></i> }
                        {{ variantOptionLabel(member) }}
                      </a>
                    }
                  }
                </p>
              }
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
            <button class="desk-kpi desk-kpi--button" type="button" (click)="railTab.set('stock')">
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
            <button class="desk-kpi desk-kpi--button" type="button" (click)="scrollTo('pd-price')">
              <small>Kostprijs</small>
              @if (product.landedCostEur; as landed) {
                <strong>{{ landed | eur: 2 }}</strong>
                <span>geland{{ product.landedCostSource ? ' · ' + product.landedCostSource : ', incl. transport en rechten' }}</span>
              } @else {
                <strong>—</strong>
                <span>nog geen kostprijs</span>
              }
            </button>
            <button class="desk-kpi desk-kpi--button" type="button" (click)="scrollTo('pd-price')">
              <small>Catalogusprijs</small>
              @if (displayPrice(); as price) {
                <strong>{{ price | eur: 2 }}</strong>
                <span>{{ hasFixedSalesPrice(product) ? 'vaste verkoopprijs' : '+ ' + (product.markupPct | num) + ' % op de kostprijs' }}</span>
              } @else {
                <strong>—</strong>
                <span>nog geen prijs</span>
              }
            </button>
            <button class="desk-kpi desk-kpi--button desk-kpi--total" type="button" (click)="scrollTo('pd-price')">
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
              <button class="desk-kpi desk-kpi--go" type="button" (click)="railTab.set('web')">
                <small>Publicatie</small>
                <strong>{{ open }} punt{{ open === 1 ? '' : 'en' }} open ›</strong>
                <span>{{ publicationSummary() }}</span>
              </button>
            } @else {
              <button class="desk-kpi desk-kpi--button" type="button" (click)="railTab.set('web')">
                <small>Publicatie</small>
                <strong>{{ publicationSummary() }}</strong>
                <span>website & orderapp</span>
              </button>
            }
          </div>
        </header>

        <div class="desk-body">
          <!-- ============================ the dossier -->
          <main class="desk-main pd-main">
            <section class="pd-section" id="pd-product">
              <div class="pd-section__head">
                <div><h2>Product</h2><p>Foto, identificatie en verpakking</p></div>
                <a class="linklike" [routerLink]="['/products', product.id, 'edit']">Bewerken ›</a>
              </div>
              <div class="pd-identity">
                <div class="pd-gallery">
                  @if (product.photos[galleryIndex()] || product.photos[0]; as photo) {
                    <button class="pd-gallery__main" type="button" (click)="lightbox.set(galleryIndex())"
                            [attr.aria-label]="'Foto ' + (galleryIndex() + 1) + ' van ' + product.photos.length + ' vergroten'">
                      <img [appAuthSrc]="photo.url" [alt]="product.name + ' — foto ' + (galleryIndex() + 1)" draggable="false" />
                    </button>
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
                  } @else {
                    <a class="pd-gallery__empty" [routerLink]="['/products', product.id, 'edit']" [queryParams]="{ tab: 'media' }">
                      <b>Nog geen foto</b><small>Voeg er een toe ›</small>
                    </a>
                  }
                </div>
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
            </section>

            <section class="pd-section" id="pd-price">
              <div class="pd-section__head">
                <div><h2>Prijs &amp; marge</h2><p>Van fabrieksprijs tot catalogusprijs, per stuk</p></div>
                @if (sourceOrderId(); as orderId) {
                  <a class="linklike" [routerLink]="['/purchasing', orderId]">Bron {{ product.landedCostSource }} ›</a>
                } @else if (product.landedCostSource) {
                  <span class="pd-muted">Bron {{ product.landedCostSource }}</span>
                }
              </div>
              <div class="pd-price">
                <div class="pd-price__chain">
                @if (priceBuild(); as build) {
                  @if (build.rows.length) {
                    <div class="desk-chain">
                      @for (row of chainRows(); track $index) {
                        <div class="desk-chain__row" [class.desk-chain__row--sub]="row.sum && !row.last" [class.desk-chain__row--total]="row.last">
                          <i aria-hidden="true">{{ row.mark }}</i>
                          <span>{{ row.label }}@if (row.hint) { <small>{{ row.hint }}</small> }</span>
                          <b>{{ row.eur | eur: 2 }}</b>
                        </div>
                      }
                    </div>
                    @if (margin(); as value) {
                      <div class="desk-overhead" [class.pd-overhead--bad]="value.eur < 0">
                        <span>Marge per stuk: catalogusprijs min kostprijs</span>
                        <b>{{ value.eur | eur: 2 }}</b><em>{{ value.pct }} %</em>
                      </div>
                    }
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
                </div>
                <dl class="desk-facts pd-facts pd-facts--price">
                  <div><dt>EXW-prijs</dt><dd>@if (product.exwPrice; as price) { {{ price | cur: product.exwCurrency }} } @else { — }<small>fabrieksprijs, excl. transport</small></dd></div>
                  <div><dt>Extra kost</dt><dd>@if (product.extraUnitCost; as extra) { {{ extra | cur: product.exwCurrency }} } @else { — }<small>per stuk, bv. display of giftbox</small></dd></div>
                  <div><dt>Prijsregel</dt><dd>{{ hasFixedSalesPrice(product) ? (product.fixedSalesPriceEur | eur: 2) : (product.markupPct | num) + ' % opslag' }}<small>{{ hasFixedSalesPrice(product) ? 'vaste verkoopprijs' : 'op de gelande kostprijs' }}</small></dd></div>
                  <div><dt>Kostprijs</dt><dd>@if (product.landedCostEur; as landed) { {{ landed | eur: 2 }} } @else { — }<small>{{ product.landedCostSource ? 'uit ' + product.landedCostSource : 'incl. transport en rechten' }}</small></dd></div>
                </dl>
              </div>
            </section>

            <section class="pd-section" id="pd-carton">
              <div class="pd-section__head">
                <div><h2>Omdoos &amp; logistiek</h2><p>Wat er in een doos en in een container past</p></div>
              </div>
              <div class="pd-stats">
                <div class="pd-stat"><small>Karton B × D × H</small><b>{{ size(product.carton) }}</b></div>
                <div class="pd-stat"><small>Inhoud</small><b>{{ product.carton.piecesPerCarton | num }} stuks</b>@if (cartonPiecesAuto(product)) { <span>berekend uit de maten</span> }</div>
                <div class="pd-stat"><small>Gewicht</small><b>@if (product.carton.weightKg) { {{ product.carton.weightKg | num }} kg } @else { — }</b>@if (product.carton.weightKg && cartonWeightAuto(product)) { <span>berekend uit de stuks</span> }</div>
                <div class="pd-stat"><small>Volume</small><b>@if (product.cartonCbm) { {{ product.cartonCbm | cbm }} } @else { — }</b>@if (product.pieceCbm) { <span>{{ product.pieceCbm | cbm }} per stuk</span> }</div>
                <div class="pd-stat"><small>Per 40' HC</small><b>@if (product.carton.hcCapacity; as hc) { {{ hc | num }} stuks } @else { — }</b>@if (product.carton.hcCapacity) { <span>{{ product.carton.piecesPerHc ? 'geteld' : 'volle dozen op volume' }}</span> }</div>
                <div class="pd-stat"><small>Omdoosbarcode</small><b class="mono">
                  @if (product.barcodeOuter; as code) {
                    <button class="pd-barcode" type="button" [title]="'Barcode-afbeelding (300 dpi) van ' + code" (click)="downloadBarcode(code)">{{ code }} <i aria-hidden="true">▥</i></button>
                  } @else { — }
                </b></div>
              </div>
            </section>

            <section class="pd-section" id="pd-agreements">
              <div class="pd-section__head">
                <div><h2>Afspraken leverancier</h2><p>Engelse instructies en referentiefoto’s op de inkoop-PDF</p></div>
                <a class="linklike" [routerLink]="['/products', product.id, 'edit']" [queryParams]="{ tab: 'agreements' }">Bewerken ›</a>
              </div>
              @if (product.supplierNote) {
                <p class="pd-note">{{ product.supplierNote }}</p>
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
                      <span>{{ photo.caption || 'Foto ' + ($index + 1) }}</span>
                    </button>
                  }
                </div>
              } @else if (!product.supplierNote) {
                <p class="pd-empty">Nog geen productspecifieke afspraken voor deze leverancier.</p>
              }
            </section>
          </main>

          <!-- ============================ the rail: stock, publication, series -->
          <aside class="desk-rail" aria-label="Voorraad, website en reeks">
            <div class="desk-tabs" role="tablist">
              <button type="button" role="tab" [class.on]="railTab() === 'stock'" [attr.aria-selected]="railTab() === 'stock'" (click)="railTab.set('stock')">Voorraad</button>
              <button type="button" role="tab" [class.on]="railTab() === 'web'" [attr.aria-selected]="railTab() === 'web'" (click)="railTab.set('web')">
                Website @if (publicationIssues().length) { <i class="desk-tabs__dot" aria-hidden="true"></i> }
              </button>
              @if (variantMembers().length > 1) {
                <button type="button" role="tab" [class.on]="railTab() === 'series'" [attr.aria-selected]="railTab() === 'series'" (click)="railTab.set('series')">Reeks · {{ variantMembers().length }}</button>
              }
            </div>
            <div class="desk-panel">
              @switch (railTab()) {
                @case ('stock') {
                  <div class="pd-rail-head">
                    <div><strong>Voorraad</strong><small>per locatie, in stuks</small></div>
                    <b class="pd-rail-total" [class.is-bad]="stockTotal() <= 0">{{ stockLevels() ? (stockTotal() | num) : '—' }}</b>
                  </div>
                  @if (stockLevels(); as levels) {
                    <div class="pd-levels">
                      @for (level of levels; track level.locationId) {
                        <div class="pd-level">
                          <span><b>{{ level.name }}</b><small>{{ level.kindLabel }} · {{ level.countsForWebsite ? 'alle verkoopkanalen' : 'enkel ter plaatse' }}</small></span>
                          @if (correctOpen()) {
                            <input class="input num right pd-level__input" type="number" min="0" step="1" inputmode="numeric"
                                   [attr.aria-label]="'Nieuwe stand ' + level.name" [value]="level.quantity"
                                   (keydown.enter)="$any($event.target).blur()"
                                   (change)="bookCorrection(level.locationId, $any($event.target))" />
                          } @else {
                            <strong [class.pd-muted]="!level.quantity">{{ level.quantity | num }}</strong>
                          }
                        </div>
                      } @empty {
                        <p class="pd-empty">Nog geen voorraadlocaties.</p>
                      }
                    </div>
                    @if (correctOpen()) {
                      <p class="pd-hint">Tik een nieuwe stand en het boekt meteen als correctie. <button class="linklike" type="button" (click)="correctOpen.set(false)">Klaar</button></p>
                    }
                  } @else {
                    <p class="pd-empty">Voorraad laden…</p>
                  }
                  @if (!takeout()) {
                    <div class="pd-rail-actions">
                      <button class="btn btn--sm" type="button" [class.btn--primary]="correctOpen()" (click)="correctOpen.set(!correctOpen())">Corrigeren</button>
                      <button class="btn btn--sm" type="button" (click)="openTakeout('DAMAGED')">Beschadigd</button>
                      <button class="btn btn--sm" type="button" (click)="openTakeout('DEMO')">Demo</button>
                    </div>
                  }
                  @if (takeout(); as out) {
                    <form class="pd-takeout desk-form" (submit)="$event.preventDefault(); confirmTakeout()">
                      <div class="per-toggle" role="group" aria-label="Wat is er gebeurd?">
                        <button type="button" [class.on]="out.kind === 'DAMAGED'" (click)="takeout.set({ ...out, kind: 'DAMAGED' })">Stuk / beschadigd</button>
                        <button type="button" [class.on]="out.kind === 'DEMO'" (click)="takeout.set({ ...out, kind: 'DEMO' })">Demo weggegeven</button>
                      </div>
                      <div class="desk-form__duo">
                        @if ((stockLevels() ?? []).length > 1) {
                          <div class="field">
                            <label for="pd-out-loc">Locatie</label>
                            <select class="select" id="pd-out-loc" (change)="takeout.set({ ...out, locationId: +$any($event.target).value })">
                              @for (level of stockLevels(); track level.locationId) {
                                <option [value]="level.locationId" [selected]="out.locationId === level.locationId">{{ level.name }} ({{ level.quantity | num }})</option>
                              }
                            </select>
                          </div>
                        }
                        <div class="field">
                          <label class="req" for="pd-out-qty">Aantal</label>
                          <input class="input num right" id="pd-out-qty" type="number" min="1" step="1" inputmode="numeric" autofocus
                                 [value]="out.quantity || ''" (input)="takeout.set({ ...out, quantity: +$any($event.target).value })" />
                        </div>
                      </div>
                      <div class="field">
                        <label for="pd-out-note">Notitie <span class="opt"></span></label>
                        <input class="input" id="pd-out-note" [placeholder]="out.kind === 'DAMAGED' ? 'bijv. gevallen bij het laden' : 'bijv. klant Janssens'"
                               [value]="out.note" (input)="takeout.set({ ...out, note: $any($event.target).value })" />
                      </div>
                      <div class="pd-rail-actions">
                        <button class="btn btn--sm" type="button" (click)="takeout.set(null)">Annuleren</button>
                        <button class="btn btn--sm btn--primary" type="submit" [disabled]="stockSaving() || !(out.quantity > 0)">{{ stockSaving() ? 'Bezig…' : 'Melden' }}</button>
                      </div>
                    </form>
                  }
                  @if (expected(); as exp) {
                    <a class="pd-expected" [routerLink]="['/purchasing', exp.orderIds[0]]">
                      <b>+{{ exp.quantity | num }} stuks onderweg</b>
                      <small>{{ exp.orderNumbers.join(', ') }}{{ exp.expectedArrival ? ' · verwacht ' + (exp.expectedArrival | dateNl) : '' }} ›</small>
                    </a>
                  }
                  @if (recentMoves(); as moves) {
                    @if (moves.length) {
                      <div class="pd-rail-sub">Laatste bewegingen</div>
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
                      <p class="pd-empty">Nog geen voorraadbewegingen.</p>
                    }
                  }
                }
                @case ('web') {
                  <div class="pd-rail-head">
                    <div><strong>Website &amp; publicatie</strong><small>{{ publicationSummary() }}</small></div>
                  </div>
                  @if (familyLoading()) {
                    <p class="pd-empty">Publicatiestatus laden…</p>
                  } @else if (familyLoadError()) {
                    <p class="pd-empty">De publicatiestatus is niet geladen. <button class="linklike" type="button" (click)="retryFamily()">Opnieuw proberen</button></p>
                  } @else {
                    <div class="pd-channels" aria-label="Verkoopkanalen">
                      <span [class.is-live]="publicationActive() && websiteStatus() === 'PUBLISHED'"><i aria-hidden="true"></i>Website</span>
                      <span [class.is-live]="publicationActive() && orderAppStatus() === 'PUBLISHED'"><i aria-hidden="true"></i>Orderapp</span>
                    </div>
                    <dl class="desk-facts">
                      <div><dt>Publieke URL</dt><dd class="mono">@if (publicHandle(); as handle) { /products/{{ handle }} } @else { <span class="pd-muted">nog geen</span> }</dd></div>
                      @if (family(); as family) {
                        <div><dt>Publieke naam</dt><dd>{{ family.name }}</dd></div>
                        <div><dt>Collectie</dt><dd>{{ family.collectionKey || family.categoryName || '—' }}</dd></div>
                        @if (family.summary) { <div><dt>Samenvatting</dt><dd class="pd-prose">{{ family.summary }}</dd></div> }
                      }
                    </dl>
                    @if (publicationIssues().length; as open) {
                      <div class="pd-rail-sub">{{ open }} punt{{ open === 1 ? '' : 'en' }} voor publicatie</div>
                      <ul class="pd-issues">
                        @for (issue of publicationIssues(); track issue) { <li>{{ issue }}</li> }
                      </ul>
                    }
                    @if (!family()) {
                      <p class="pd-empty">Voor dit product zijn nog geen gedeelde websitegegevens gestart.</p>
                    }
                    <div class="desk-actions pd-rail-links">
                      <a class="desk-action" [routerLink]="['/products', product.id, 'translations']">
                        <span><b>Publieke naam &amp; vertalingen</b><small>wat de klant leest, per taal</small></span><i aria-hidden="true">›</i>
                      </a>
                      <a class="desk-action" [routerLink]="['/products', product.id, 'edit']" [queryParams]="{ tab: 'publication' }">
                        <span><b>Website &amp; publicatie bewerken</b><small>status, collectie en aandachtspunten</small></span><i aria-hidden="true">›</i>
                      </a>
                    </div>
                  }
                }
                @case ('series') {
                  <div class="pd-rail-head">
                    <div><strong>Productreeks</strong><small>{{ family()?.name || product.name }} · {{ variantMembers().length }} varianten</small></div>
                  </div>
                  <div class="pd-variants">
                    @for (member of variantMembers(); track member.productId) {
                      @let sibling = catalogueProduct(member.productId);
                      <a class="pd-variant" [class.pd-variant--now]="member.productId === product.id"
                         [routerLink]="['/products', member.productId]" [attr.aria-current]="member.productId === product.id ? 'page' : null">
                        @if (sibling?.photos?.[0]; as photo) { <img [appAuthSrc]="photo.url" alt="" loading="lazy" /> } @else { <i aria-hidden="true">◈</i> }
                        <span>
                          <b>@if (hexOf(member.colourHex, member.colour); as hex) { <i class="pd-dot" [style.background]="hex" aria-hidden="true"></i> }{{ variantOptionLabel(member) }}</b>
                          <small>{{ member.sku || '—' }}@if (!member.active) { · inactief }</small>
                        </span>
                        @if (sibling) {
                          <em><b>{{ sibling.stockQuantity | num }}</b><small>{{ sibling.computedSalesPriceEur > 0 ? (sibling.computedSalesPriceEur | eur: 2) : '—' }}</small></em>
                        }
                      </a>
                    }
                  </div>
                }
              }
            </div>
          </aside>
        </div>
      </div>

      <app-photo-lightbox [photos]="product.photos" [(index)]="lightbox" />
      <app-product-supplier-agreement-photo-viewer [photos]="agreementPhotos()" [(index)]="agreementLightbox" />
    }
  `,
  styles: [`
    :host{display:block;min-width:0}
    .pd-hero-link{color:inherit;text-decoration:none}.pd-hero-link:hover{text-decoration:underline}
    .pd-series{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px!important}
    .pd-series>span{color:rgb(255 255 255/.55);font-size:10px;font-weight:750;letter-spacing:.1em;text-transform:uppercase}
    .pd-series__chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid rgb(255 255 255/.28);border-radius:999px;background:rgb(255 255 255/.08);color:#fff;font-size:11.5px;font-weight:650;text-decoration:none}
    .pd-series__chip:hover{background:rgb(255 255 255/.16)}.pd-series__chip--now{border-color:#fff;background:#fff;color:var(--ink)}
    .pd-series__chip i,.pd-chip i,.pd-dot{display:inline-block;width:10px;height:10px;border:1px solid rgb(0 0 0/.15);border-radius:50%}
    .pd-chips{display:flex;flex:none;flex-wrap:wrap;justify-content:flex-end;gap:4px;max-width:420px}
    .pd-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border:1px solid rgb(255 255 255/.16);border-radius:999px;background:rgb(255 255 255/.06);color:rgb(255 255 255/.8);font-size:11.5px;font-weight:650;white-space:nowrap}
    .pd-chip--ok{color:#9fe0b4;border-color:rgb(159 224 180/.35);background:rgb(159 224 180/.1)}.pd-chip--warn{color:#f4cf9a;border-color:rgb(244 207 154/.35);background:rgb(244 207 154/.1)}
    .desk-kpi strong.is-bad{color:#f6a3a3}

    .pd-main{display:grid}
    .pd-section{padding:16px 18px 18px}.pd-section+.pd-section{border-top:1px solid var(--line)}
    .pd-section__head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}
    .pd-section__head h2{margin:0;font-size:15px}.pd-section__head p{margin:1px 0 0;color:var(--muted);font-size:11.5px}
    .pd-muted{color:var(--muted);font-weight:500}.pd-prose{font-weight:500;line-height:1.4;white-space:pre-wrap}
    .pd-empty{margin:0;padding:10px 12px;border:1px dashed var(--line-strong);border-radius:12px;color:var(--muted);font-size:12px}
    .pd-hint{margin:8px 0 0;color:var(--muted);font-size:11.5px}

    .pd-identity{display:grid;grid-template-columns:minmax(220px,300px) minmax(0,1fr);gap:20px;align-items:start}
    .pd-gallery{display:grid;gap:6px}
    .pd-gallery__main{display:block;width:100%;aspect-ratio:1;padding:0;border:1px solid var(--line);border-radius:14px;background:var(--surface-2);overflow:hidden;cursor:zoom-in}
    .pd-gallery__main img{display:block;width:100%;height:100%;object-fit:cover}
    .pd-gallery__thumbs{display:flex;flex-wrap:wrap;gap:6px}.pd-gallery__thumbs button{width:52px;height:52px;padding:0;border:2px solid transparent;border-radius:10px;background:var(--surface-2);overflow:hidden;cursor:pointer}
    .pd-gallery__thumbs button.on{border-color:var(--rose)}.pd-gallery__thumbs img{display:block;width:100%;height:100%;object-fit:cover}
    .pd-gallery__empty{display:grid;place-content:center;gap:2px;aspect-ratio:1;border:1px dashed var(--line-strong);border-radius:14px;color:var(--muted);text-align:center;text-decoration:none}.pd-gallery__empty b{color:var(--ink-2);font-size:13px}.pd-gallery__empty small{font-size:11.5px}
    .pd-facts>div{grid-template-columns:132px minmax(0,1fr)}.pd-facts>div:last-child{border-bottom:0}
    .pd-barcode{display:inline-flex;align-items:center;gap:5px;padding:0;border:0;background:none;color:var(--rose-dark);font:inherit;font-weight:650;cursor:pointer}.pd-barcode:hover{text-decoration:underline}.pd-barcode i{font-style:normal;font-size:13px;color:var(--muted)}

    .pd-price{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(240px,1fr);gap:20px;align-items:start}
    .pd-facts--price>div{grid-template-columns:96px minmax(0,1fr)}
    .pd-overhead--bad{background:var(--danger-soft);color:var(--danger)}
    .pd-aside{margin:8px 0 0;color:var(--muted);font-size:11.5px}.pd-aside b{color:var(--ink-2);font-variant-numeric:tabular-nums}

    .pd-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
    .pd-stat{display:grid;gap:2px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}
    .pd-stat small{color:var(--muted);font-size:9.5px;font-weight:750;letter-spacing:.08em;text-transform:uppercase}.pd-stat b{font-size:14px;font-variant-numeric:tabular-nums}.pd-stat span{color:var(--muted);font-size:11px}
    .pd-note{margin:0 0 12px;padding:10px 12px;border:1px solid #eddcb9;border-radius:12px;background:var(--warn-soft);color:var(--ink-2);font-size:12.5px;line-height:1.45;white-space:pre-wrap}
    .pd-refs{display:flex;flex-wrap:wrap;gap:10px}
    .pd-ref{display:grid;gap:4px;width:118px;padding:0;border:0;background:none;color:var(--muted);font:inherit;font-size:11px;text-align:left;cursor:zoom-in}
    .pd-ref img{width:118px;height:118px;border:1px solid var(--line);border-radius:12px;object-fit:cover;background:var(--surface-2)}.pd-ref span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

    .pd-rail-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}.pd-rail-head strong{display:block;font-size:13px}.pd-rail-head small{color:var(--muted);font-size:11px}
    .pd-rail-total{font-size:22px;font-weight:750;font-variant-numeric:tabular-nums}.pd-rail-total.is-bad{color:var(--danger)}
    .pd-levels{display:grid}.pd-level{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--line)}
    .pd-level>span{display:grid;min-width:0}.pd-level b{font-size:12.5px}.pd-level small{color:var(--muted);font-size:10.5px}.pd-level strong{font-size:14px;font-variant-numeric:tabular-nums}
    .pd-level__input{width:92px;min-height:32px}
    .pd-rail-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
    .pd-takeout{margin-top:12px;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2)}
    .pd-expected{display:grid;margin-top:12px;padding:9px 12px;border-radius:12px;background:var(--rose-soft);color:var(--rose-dark);text-decoration:none}.pd-expected b{font-size:12.5px}.pd-expected small{font-size:11px}
    .pd-rail-sub{margin:14px 0 4px;color:var(--rose);font-size:10px;font-weight:760;letter-spacing:.1em;text-transform:uppercase}
    .pd-moves{display:grid}.pd-move{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 0;border-top:1px solid var(--line)}
    .pd-move>span{display:grid;min-width:0}.pd-move b{overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.pd-move small{overflow:hidden;color:var(--muted);font-size:10.5px;text-overflow:ellipsis;white-space:nowrap}
    .pd-move strong{font-size:13px;font-variant-numeric:tabular-nums;color:var(--ok)}.pd-move strong.is-minus{color:var(--danger)}
    .pd-more{margin-top:6px;font-size:12px}
    .pd-channels{display:flex;gap:6px;margin-bottom:10px}.pd-channels span{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:11.5px;font-weight:650}
    .pd-channels i{width:8px;height:8px;border-radius:50%;background:var(--line-strong)}.pd-channels span.is-live{border-color:color-mix(in srgb,var(--ok) 40%,transparent);color:var(--ok)}.pd-channels span.is-live i{background:var(--ok)}
    .pd-issues{margin:0;padding:0 0 0 18px;color:var(--ink-2);font-size:12px;line-height:1.5}
    .pd-rail-links{margin-top:14px}.desk-action{text-decoration:none}
    .pd-variants{display:grid}
    .pd-variant{display:grid;grid-template-columns:40px minmax(0,1fr) auto;align-items:center;gap:10px;padding:8px 6px;border-top:1px solid var(--line);color:inherit;text-decoration:none;border-radius:10px}
    .pd-variant:hover{background:var(--surface-2)}.pd-variant--now{background:var(--rose-soft)}
    .pd-variant img,.pd-variant>i{width:40px;height:40px;border:1px solid var(--line);border-radius:10px;object-fit:cover;background:var(--surface-2)}.pd-variant>i{display:grid;place-items:center;color:var(--muted);font-style:normal}
    .pd-variant>span{display:grid;min-width:0}.pd-variant b{display:flex;align-items:center;gap:6px;font-size:12.5px}.pd-variant small{color:var(--muted);font-size:10.5px}
    .pd-variant em{display:grid;justify-items:end;font-style:normal}.pd-variant em b{font-size:13px;font-variant-numeric:tabular-nums}.pd-variant em small{font-size:10.5px}

    /* The dossier is narrower than a purchase table, so the rail keeps its
       place beside it down to 1100px; the price grid folds instead. */
    @media(min-width:1100px) and (max-width:1439px){
      :host .desk-body{grid-template-columns:minmax(0,1fr) 320px}
      :host .desk-rail{position:sticky;max-height:calc(100dvh - var(--appbar-h,62px) - 28px)}
      .pd-identity{grid-template-columns:minmax(180px,220px) minmax(0,1fr)}
      .pd-price{grid-template-columns:1fr}
    }
    @media(max-width:1099px){.pd-price{grid-template-columns:1fr}.pd-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
  `],
})
export class ProductDesk extends ProductView {
  readonly railTab = signal<RailTab>('stock');

  /** The build-up is on the page itself, so it loads with the product. */
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
    const rows = (this.priceBuild()?.rows ?? []).filter((row) => !row.aside && !row.note);
    return rows.map((row, index) => ({
      mark: row.sum ? '=' : row.label.startsWith('+') ? '+' : '·',
      label: row.label.replace(/^\+\s*/, ''),
      hint: row.hint,
      eur: row.eur,
      sum: !!row.sum,
      last: index === rows.length - 1 && !!row.sum,
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

  /** One booking at a time: opening the take-out form ends a recount. */
  override openTakeout(kind: 'DAMAGED' | 'DEMO'): void {
    this.correctOpen.set(false);
    super.openTakeout(kind);
  }

  scrollTo(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
