import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { AuthImage } from '../../core/api/auth-image';
import { PhotoLightbox } from '../../shared/photo-lightbox';
import { Category, LandedCostLine, Product, ProductFamily, ProductFamilyMember, PurchaseOrderView, StockMovement, Supplier, ProductStock, ExpectedStock } from '../../core/api/models';

interface PriceRow { label: string; hint?: string; eur: number; sum?: boolean; note?: boolean; aside?: boolean; }
interface PriceBuild { rows: PriceRow[]; source: string | null; sourceFound: boolean; }
import { PageHeader } from '../../shared/page-header';
import { orderLikeTheList } from './catalogue-order';
import { autoCartonWeightKg, autoPiecesPerCarton } from './carton-auto';
import { Sheet, Ui } from '../../shared/ui';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import { CbmPipe, CurPipe, DateNlPipe, DateTimeNlPipe, EurPipe, NumPipe } from '../../shared/pipes';

/**
 * Read-first product master. The page deliberately separates the customer
 * story (photo, price, availability) from operational data. Editing remains
 * an explicit action, so a warehouse or sales colleague can safely browse it.
 */
@Component({
  selector: 'app-product-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink, NgTemplateOutlet, AuthImage, PhotoLightbox, PageHeader, Sheet, CbmPipe, CurPipe, DateNlPipe, DateTimeNlPipe, EurPipe, NumPipe,
  ],
  template: `
    @if (product(); as product) {
      <app-page-header [title]="product.name" [subtitle]="headerLine()"
                       [showBack]="true" [showBell]="false">
        <!-- Desktop: step to the next or previous product without going
             back to the list, the same arrows as while editing. -->
        @if (neighbours(); as around) {
          <span class="product-nav" role="group" aria-label="Vorig of volgend product">
            <a class="btn btn--sm product-nav__btn" [class.product-nav__btn--off]="!around.previous"
               [routerLink]="around.previous ? ['/products', around.previous.id] : null"
               [attr.aria-disabled]="!around.previous"
               [title]="around.previous ? 'Vorige: ' + around.previous.name : 'Dit is het eerste product'">‹</a>
            <small class="product-nav__pos">{{ around.index + 1 }}/{{ around.total }}</small>
            <a class="btn btn--sm product-nav__btn" [class.product-nav__btn--off]="!around.next"
               [routerLink]="around.next ? ['/products', around.next.id] : null"
               [attr.aria-disabled]="!around.next"
               [title]="around.next ? 'Volgende: ' + around.next.name : 'Dit is het laatste product'">›</a>
          </span>
        }
        <a class="btn btn--primary btn--sm" [routerLink]="['/products', product.id, 'edit']">
          Bewerken
        </a>
      </app-page-header>

      <div class="content product-view-page">
        <div class="product-view-canvas">
          <section class="phero" aria-label="Productoverzicht">
            <div class="phero__top">
              <div class="phero__id">
                <span class="phero__eyebrow">{{ categoryName() || 'Catalogus' }}</span>
                <h1>{{ product.name }}</h1>
                @if (supplierName(); as name) {
                  <a class="phero__supplier" [routerLink]="['/suppliers']" [queryParams]="{ q: name }">{{ name }} ›</a>
                }
                <p class="phero__meta">
                  @if (product.colour) {
                    <span>
                      @if (product.colourHex) {
                        <i class="variant-swatch" [style.backgroundColor]="product.colourHex" aria-hidden="true"></i>
                      }
                      {{ product.colour }}
                    </span>
                  }
                  @if (product.variantSize) { <span>Maat {{ product.variantSize }}</span> }
                  @if (product.sku) { <span class="mono">{{ product.sku }}</span> }
                </p>
              </div>
              <span class="phero__status" [class.phero__status--warn]="!product.active || product.demo">
                {{ product.active ? (product.demo ? 'Demo' : 'Actief') : 'Inactief' }}
              </span>
            </div>

            @if (!product.photos.length) {
              <p class="phero__nofoto">Nog geen productfoto — voeg er een toe via Bewerken.</p>
            }

            <!-- The photos ride along in the facts row: one thumb with a
                 "+n ›" badge on the phone, the full strip on desktop. -->
            <div class="phero__facts" [class.phero__facts--photo]="product.photos.length > 0">
              @if (product.photos.length) {
                <div class="phero__shots" role="group" [attr.aria-label]="product.photos.length + ' foto’s'">
                  @for (photo of product.photos; track photo.id) {
                    <button class="phero__shot" type="button" (click)="lightbox.set($index)"
                            [attr.aria-label]="'Foto ' + ($index + 1) + ' van ' + product.photos.length + ' vergroten'">
                      <img [appAuthSrc]="photo.url" [alt]="product.name + ' — foto ' + ($index + 1)"
                           draggable="false" loading="lazy" />
                      @if ($index === 0 && product.photos.length > 1) {
                        <span aria-hidden="true">+{{ product.photos.length - 1 }} ›</span>
                      }
                    </button>
                  }
                </div>
              }
              <!-- The stock tile walks down to the stock card: locations
                   and the latest movements live on the page itself. -->
              <button class="phero__fact" type="button" (click)="scrollToStock()">
                <small>Voorraad</small>
                @if (stockLevels()) {
                  <strong class="num" [class.phero__neg]="stockTotal() <= 0">{{ stockTotal() | num }}</strong>
                  <span>{{ stockSummary() }} ›</span>
                } @else if (product.inventoryKnown) {
                  <strong class="num" [class.phero__neg]="product.stockQuantity <= 0">
                    {{ product.stockQuantity | num }}
                  </strong>
                  <span>stuks ›</span>
                } @else {
                  <strong>—</strong>
                  <span>nog niet bevestigd ›</span>
                }
              </button>
              <!-- The price tile opens the build-up: every euro from the
                   factory price to the catalogue price. -->
              <button class="phero__fact" type="button" [class.phero__fact--open]="priceOpen()"
                      [attr.aria-expanded]="priceOpen()" (click)="togglePrice(product)">
                <small>Catalogusprijs</small>
                @if (displayPrice(); as price) {
                  <strong class="num">{{ price | eur: 2 }}</strong>
                } @else {
                  <strong>—</strong>
                }
                @if (margin(); as value) {
                  <span class="phero__gain" [class.phero__gain--neg]="value.eur < 0">
                    marge {{ value.eur | eur: 2 }} · {{ value.pct }} %
                  </span>
                } @else {
                  <span>{{ hasFixedSalesPrice(product) ? 'vaste prijs' : 'kost + opslag' }} ›</span>
                }
              </button>
            </div>

            @if (expected(); as exp) {
              <a class="phero__expected" [routerLink]="['/purchasing', exp.orderIds[0]]"
                 [attr.title]="'Open ' + exp.orderNumbers.join(', ')">
                +{{ exp.quantity | num }} stuks onderweg{{ exp.expectedArrival ? ' · verwacht ' + (exp.expectedArrival | dateNl) : '' }} ›
              </a>
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

          <div class="details-grid">
            <div class="details-col">
            <section class="info-card info-card--internal" aria-labelledby="dossier-title">
              <header>
                <span class="info-card__icon" aria-hidden="true">01</span>
                <div><h2 id="dossier-title">Product &amp; prijzen</h2><p>Identificatie, inkoop en verkoop</p></div>
              </header>

              <div class="tiles-kicker tiles-kicker--first">Identificatie</div>
              <div class="tiles">
                <div class="tile"><span>Afmeting B × D × H</span><b class="num">{{ size(product.dimensions) }}</b></div>
                <div class="tile"><span>Gewicht per stuk</span>
                  <b class="num">{{ product.dimensions.weightKg ? (product.dimensions.weightKg | num) + ' kg' : '—' }}</b></div>
                @if (product.packaging.kind !== 'NONE') {
                  <div class="tile"><span>{{ product.packaging.kind === 'DISPLAY' ? 'Display' : 'Geschenkverpakking' }} B × D × H</span>
                    <b class="num">{{ size(product.packaging.dimensions) }}</b></div>
                  @if (product.packaging.piecesPerUnit) {
                    <div class="tile"><span>Stuks in de {{ product.packaging.kind === 'DISPLAY' ? 'display' : 'geschenkverpakking' }}</span>
                      <b class="num">{{ product.packaging.piecesPerUnit | num }}</b></div>
                  }
                  <div class="tile"><span>Gewicht {{ product.packaging.kind === 'DISPLAY' ? 'display' : 'geschenkverpakking' }}</span>
                    <b class="num">{{ product.packaging.dimensions.weightKg ? (product.packaging.dimensions.weightKg | num) + ' kg' : '—' }}</b></div>
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
                <div class="tile"><span>Extra kost per stuk</span><b class="num">
                  @if (product.extraUnitCost; as extra) { {{ extra | cur: product.exwCurrency }} } @else { — }
                </b><small>bv. display of giftbox</small></div>
                <button class="tile tile--emphasis" type="button" (click)="openPriceInfo(product)">
                  <span>Kostprijs incl. rechten</span><b class="num">
                  @if (product.landedCostEur; as landed) { {{ landed | eur: 2 }} } @else { — }
                </b><small>geland: mét transport en invoer</small></button>
                <button class="tile tile--emphasis" type="button" (click)="openPriceInfo(product)">
                  <span>Catalogusprijs</span><b class="num">
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
                <button class="tile tile--result" type="button" (click)="openPriceInfo(product)">
                  <span>Marge per stuk</span>
                  @if (margin(); as value) {
                    <b class="num" [class.warn-text]="value.eur < 0">{{ value.eur | eur: 2 }} · {{ value.pct }} %</b>
                  } @else {
                    <b class="muted">Niet beschikbaar</b>
                  }
                  <small>catalogusprijs min kostprijs</small></button>
              </div>
            </section>
            @if (familyLoading() || familyLoadError() || variantMembers().length > 1) {
              <section class="info-card" aria-labelledby="linked-products-title">
                <header>
                  <span class="info-card__icon" aria-hidden="true">03</span>
                  <div><h2 id="linked-products-title">Gekoppelde producten</h2><p>Varianten in dezelfde reeks</p></div>
                </header>
                @if (familyLoading()) {
                  <p class="linked-state" role="status">Varianten laden…</p>
                } @else if (familyLoadError()) {
                  <div class="linked-state linked-state--error" role="alert">
                    <span>Varianten zijn niet geladen.</span>
                    <button class="btn btn--sm" type="button" (click)="retryFamily()">Opnieuw proberen</button>
                  </div>
                } @else {
                  <div class="linked-list">
                    @for (member of variantMembers(); track member.productId) {
                      @if (member.productId === product.id) {
                        <span class="linked-row linked-row--current" aria-current="page">
                          @if (member.colourHex) {
                            <i [style.backgroundColor]="member.colourHex" aria-hidden="true"></i>
                          }
                          <b>{{ variantMemberLabel(member) }}</b>
                          <small>huidig</small>
                        </span>
                      } @else {
                        <a class="linked-row" [routerLink]="['/products', member.productId]">
                          @if (member.colourHex) {
                            <i [style.backgroundColor]="member.colourHex" aria-hidden="true"></i>
                          }
                          <b>{{ variantMemberLabel(member) }}</b>
                          <span aria-hidden="true">›</span>
                        </a>
                      }
                    }
                  </div>
                }
              </section>
            }
            </div>
            <div class="details-col">
            <section class="info-card" aria-labelledby="carton-details-title">
              <header>
                <span class="info-card__icon" aria-hidden="true">02</span>
                <div><h2 id="carton-details-title">Omdoos</h2><p>Verpakking en logistiek</p></div>
              </header>
              <div class="tiles">
                <div class="tile"><span>Karton B × D × H</span><b class="num">{{ size(product.carton) }}</b></div>
                <div class="tile"><span>Inhoud</span><b class="num">
                  @if (cartonPiecesAuto(product)) { <small class="muted">auto</small> }
                  {{ product.carton.piecesPerCarton | num }} stuks</b></div>
                <div class="tile"><span>Gewicht</span><b class="num">
                  @if (product.carton.weightKg) {
                    @if (cartonWeightAuto(product)) { <small class="muted">auto</small> }
                    {{ product.carton.weightKg | num }} kg
                  } @else { — }
                </b></div>
                <div class="tile"><span>Volume</span><b class="num">
                  @if (product.cartonCbm) { {{ product.cartonCbm | cbm }} } @else { — }
                </b></div>
                <div class="tile"><span>Per 40' HC</span><b class="num">
                  @if (product.carton.hcCapacity; as hc) {
                    @if (!product.carton.piecesPerHc) { <small class="muted">auto</small> }
                    {{ hc | num }} stuks
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
            <section class="info-card" id="stock-card" aria-labelledby="stock-card-title">
              <header>
                <span class="info-card__icon" aria-hidden="true">04</span>
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
                  <button type="button" (click)="openTakeout('DEMO')">Demo</button>
                </div>
              </div>
            </section>
            </div>
          </div>

          <details class="info-card publication-card">
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
              }
            </div>
          </details>
        </div>
      </div>
      <!-- Phone: the build-up and the stock book come up as sheets, not
           somewhere further down the page. -->
      @if ((priceOpen() && !desktop.active()) || priceInfoOpen()) {
        <app-sheet title="Prijsopbouw" (closed)="closePriceInfo()">
          <div body><ng-container *ngTemplateOutlet="priceBuildTpl" /></div>
          <div foot style="display:contents">
            <span class="spacer"></span>
            <button class="btn" type="button" (click)="closePriceInfo()">Sluiten</button>
          </div>
        </app-sheet>
      }

      <!-- Broken or given away as demo: the piece leaves the shelf with a
           note that says why - right here, not in the editor. -->
      @if (takeout(); as out) {
        <app-sheet [title]="out.kind === 'DAMAGED' ? 'Stuk / beschadigd' : 'Demo weggegeven'" (closed)="takeout.set(null)">
          <div body>
            <div class="per-toggle takeout-kind" role="group" aria-label="Wat is er gebeurd?">
              <button type="button" [class.on]="out.kind === 'DAMAGED'"
                      (click)="takeout.set({ ...out, kind: 'DAMAGED' })">Stuk / beschadigd</button>
              <button type="button" [class.on]="out.kind === 'DEMO'"
                      (click)="takeout.set({ ...out, kind: 'DEMO' })">Demo weggegeven</button>
            </div>
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
                       [placeholder]="out.kind === 'DAMAGED' ? 'bijv. gevallen bij het laden' : 'bijv. klant Janssens'"
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

    }
  `,
  styles: `
    .product-view-page { background: radial-gradient(circle at 50% 0, var(--rose-soft), transparent 300px); }
    .product-view-canvas { width: 100%; max-width: 1080px; margin: 0 auto; }

    .phero { overflow: hidden; padding: 16px; border-radius: 22px;
      background: linear-gradient(145deg, #27211f, #151210); color: #fff; box-shadow: var(--sh-2); }
    .phero__top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .phero__id { min-width: 0; }
    .phero__eyebrow { color: #efb8c4; font-size: 10px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
    .phero h1 { margin: 3px 0 0; color: #fff; font-size: clamp(20px, 5.5vw, 28px); line-height: 1.15; letter-spacing: -.03em; }
    .phero__supplier { display: block; margin: 3px 0 0; color: rgb(255 255 255 / 60%); font-size: 12px; text-decoration: none; }
    .phero__supplier:active { color: rgb(255 255 255 / 85%); }
    .phero__meta { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 0; }
    .phero__meta span { display: inline-flex; align-items: center; gap: 5px; padding: 3.5px 9px;
      border-radius: 999px; background: rgb(255 255 255 / 10%); color: rgb(255 255 255 / 85%); font-size: 11px; }
    .phero__status { flex: none; padding: 5px 11px; border-radius: 999px;
      background: rgb(255 255 255 / 14%); color: #fff; font-size: 11px; font-weight: 750; }
    .phero__status--warn { background: rgb(255 213 122 / 18%); color: #ffd57a; }
    /* Photos in the facts row: the phone shows one thumb with a "+n ›"
       badge, desktop the whole strip - the tiles keep a fixed width there. */
    .phero__shots { display: flex; gap: 7px; min-width: 0; align-self: stretch; overflow-x: auto; scrollbar-width: none; }
    .phero__shots::-webkit-scrollbar { display: none; }
    .phero__shot { position: relative; flex: none; width: 62px; height: 100%; min-height: 62px; padding: 0; overflow: hidden;
      border: 1px solid rgb(255 255 255 / 18%); border-radius: 13px; background: rgb(255 255 255 / 6%);
      cursor: pointer; transition: transform .12s ease; }
    .phero__shot:active { transform: scale(.95); }
    .phero__shot:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    .phero__shot img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .phero__shot span { position: absolute; right: 4px; bottom: 4px; padding: 2px 6px; border-radius: 999px;
      background: rgb(20 16 14 / 62%); color: #fff; font-size: 9px; font-weight: 750; }
    .phero__nofoto { margin: 12px 0 0; color: rgb(255 255 255 / 55%); font-size: 11.5px; }
    .phero__facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 13px; }
    .phero__facts--photo { grid-template-columns: auto repeat(2, minmax(0, 1fr)); }
    .phero__fact { min-width: 0; display: grid; gap: 1px; align-content: start; padding: 10px 11px;
      border: 0; border-radius: 13px; background: rgb(255 255 255 / 9%); color: inherit; font: inherit; text-align: left; }
    button.phero__fact { cursor: pointer; }
    button.phero__fact:active { background: rgb(255 255 255 / 16%); }
    .phero__fact--open { background: rgb(255 255 255 / 18%); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 35%); }
    .phero__fact small { overflow: hidden; color: rgb(255 255 255 / 55%); font-size: 8.5px; font-weight: 780;
      letter-spacing: .07em; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
    .phero__fact strong { overflow: hidden; font-size: clamp(13px, 4vw, 18px); letter-spacing: -.02em;
      text-overflow: ellipsis; white-space: nowrap; }
    /* A phone fits the photo plus three tiles only when everything breathes
       a little less. The value must always survive whole. */
    @media (max-width: 679px) {
      .phero__facts { gap: 6px; }
      .phero__fact { padding: 8px 8px; border-radius: 12px; }
      .phero__shot { width: 56px; }
      .phero__shots .phero__shot:not(:first-child) { display: none; }
    }
    .phero__fact > span { overflow: hidden; color: rgb(255 255 255 / 50%); font-size: 9.5px;
      text-overflow: ellipsis; white-space: nowrap; }
    .phero__neg { color: #ff9d92; }
    .phero__gain { color: #7ddfa6 !important; }
    .phero__gain--neg { color: #ff9d92 !important; }
    .phero__expected { display: block; margin-top: 8px; padding: 8px 11px; border-radius: 11px;
      background: rgb(255 213 122 / 14%); color: #ffd57a; font-size: 11.5px; font-weight: 700; text-decoration: none; }
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
    .tile--emphasis { background: var(--rose-soft); }
    .tile--emphasis > b { font-weight: 800; }
    .tile > small { margin-top: 1px; color: var(--muted); font-size: 9.5px; line-height: 1.35; }
    .tile .muted { font-size: 10px; font-weight: 500; }
    .tile--result { background: var(--ok-soft); align-items: center; text-align: center; }
    .tile--result > b { color: var(--ok); }
    .tile--result > b.warn-text { color: var(--danger); }
    .tiles-kicker { padding: 11px 13px 4px; border-top: 1px solid var(--line); background: var(--surface);
      color: var(--warn); font-size: 9px; font-weight: 780; letter-spacing: .09em; text-transform: uppercase; }
    .tiles-kicker--first { border-top: 0; }
    .linked-state { margin: 0; padding: 12px 14px; color: var(--muted); font-size: 12px; }
    .linked-state--error { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .linked-list { display: grid; }
    .linked-row { display: flex; align-items: center; gap: 9px; padding: 11px 14px; border-bottom: 1px solid var(--line);
      color: inherit; font-size: 13px; text-decoration: none; }
    .linked-row:last-child { border-bottom: 0; }
    .linked-row i { flex: none; width: 14px; height: 14px; border: 1px solid rgb(26 22 20 / 12%); border-radius: 50%; }
    .linked-row b { flex: 1; min-width: 0; overflow: hidden; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
    .linked-row > span { color: var(--muted-2); }
    a.linked-row:hover { background: var(--surface-2); }
    .linked-row--current { background: var(--rose-soft); }
    .linked-row--current small { padding: 2px 8px; border-radius: 999px; background: var(--surface);
      color: var(--rose-dark); font-size: 10px; font-weight: 700; }

    .stock-rows--sheet { margin-top: 4px; }
    /* Desktop idiom only (the rail breakpoint); a phone has no room next
       to Bewerken, and swiping back to the list is one gesture there. */
    .product-nav { display: none; align-items: center; gap: 4px; margin-right: 6px; }
    @media (min-width: 680px) { .product-nav { display: inline-flex; } }
    .product-nav__btn { min-width: 32px; padding: 0 9px; font-size: 18px; line-height: 1; text-decoration: none; }
    .product-nav__btn--off { opacity: .35; pointer-events: none; }
    .product-nav__pos { min-width: 40px; color: var(--muted); font-size: 11px; text-align: center;
      font-variant-numeric: tabular-nums; }
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
    .details-grid, .details-col { display: grid; gap: 12px; min-width: 0; }
    .details-grid { margin-top: 14px; }
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

    .barcode-link { display: inline-flex; align-items: center; gap: 6px; padding: 0; border: 0; background: none;
      color: inherit; font: inherit; cursor: pointer; }
    .barcode-link svg { width: 16px; height: 16px; fill: none; stroke: var(--rose-dark); stroke-width: 1.8;
      stroke-linecap: round; }
    .barcode-link:hover { text-decoration: underline dotted; }

    @media (min-width: 680px) {
      .phero { padding: 20px 22px; }
      .phero__facts--photo { grid-template-columns: minmax(0, 1fr) 220px 220px; }
      .phero__shot { width: 84px; }
      .phero__shot span { display: none; }
      .stock-rows--fold { margin-top: 10px; border-top: 1px solid var(--line); }
      /* Two independent stacks: the dossier with its linked products on
         the left, Omdoos with the stock on the right. */
      .details-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; align-items: start; }
      .details-col { gap: 14px; }
    }
  `,
})
export class ProductView {
  readonly lightbox = signal(-1);

  private readonly catalog = inject(CatalogApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ui = inject(Ui);

  readonly product = signal<Product | null>(null);

  /* The stock book, fetched the first time the tile is opened. */
  /** Pieces on the water for this product, from ordered and shipped containers. */
  readonly expected = signal<ExpectedStock | null>(null);
  readonly stockHistory = signal<StockMovement[] | null>(null);
  readonly stockLevels = signal<ProductStock[] | null>(null);
  readonly stockTotal = computed(() => (this.stockLevels() ?? []).reduce((sum, level) => sum + level.quantity, 0));
  /** "stuks" alone with one location; otherwise "9.400 magazijn · 600 TICA". */
  readonly stockSummary = computed(() => {
    const levels = this.stockLevels() ?? [];
    if (levels.length <= 1) return 'stuks';
    return levels.map((level) => `${level.quantity.toLocaleString('nl-BE')} ${level.name}`).join(' · ');
  });

  /* ---- the price, taken apart ---- */
  readonly priceOpen = signal(false);
  readonly desktop = inject(DesktopViewport);

  /** "auto" when the stored figure is exactly what the sizes derive. */
  cartonPiecesAuto(product: Product): boolean {
    return autoPiecesPerCarton(product) === product.carton.piecesPerCarton;
  }

  cartonWeightAuto(product: Product): boolean {
    const derived = autoCartonWeightKg(product, product.carton.piecesPerCarton);
    return derived !== null && derived === product.carton.weightKg;
  }
  scrollToStock(): void {
    document.getElementById('stock-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  readonly priceBuild = signal<PriceBuild | null>(null);
  /** Id of the purchase calculation the cost price came from, when it still exists. */
  readonly sourceOrderId = signal<number | null>(null);
  /** The card tiles open the build-up as a sheet on every screen size. */
  readonly priceInfoOpen = signal(false);

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
  private async loadPriceBuild(product: Product): Promise<void> {
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
      rows.push({ label: 'Inkoopprijs (EXW)', hint: `${line.quantity.toLocaleString('nl-BE')} stuks in ${source}`, eur: per(line.goodsEur, line.quantity) });
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
      rows.push({ label: 'Kostprijs per stuk', eur: product.landedCostEur ?? line.landedUnitEur, sum: true });
    } else if (product.landedCostEur) {
      rows.push({ label: 'Kostprijs per stuk', hint: 'incl. transport en rechten', eur: product.landedCostEur, sum: true });
    }
    const price = this.displayPrice();
    if (price !== null) {
      if (this.hasFixedSalesPrice(product)) {
        rows.push({ label: 'Vaste verkoopprijs', eur: price });
      } else if (product.landedCostEur) {
        rows.push({ label: `+ Opslag ${product.markupPct ?? 0} %`, eur: price - product.landedCostEur });
      }
      rows.push({ label: 'Catalogusprijs', eur: price, sum: true });
      const margin = this.margin();
      if (margin) rows.push({ label: `Marge per stuk · ${margin.pct} %`, eur: margin.eur, note: true });
    }
    /* Sold as a display: the same figures once more for a full display,
       quietly under the per-piece sum. */
    const pieces = product.packaging?.kind === 'DISPLAY' ? (product.packaging.piecesPerUnit ?? 0) : 0;
    if (pieces > 1) {
      if (product.landedCostEur) {
        rows.push({ label: `Kostprijs per display · ${pieces} stuks`, eur: product.landedCostEur * pieces, aside: true });
      }
      if (price !== null) {
        rows.push({ label: `Catalogusprijs per display · ${pieces} stuks`, eur: price * pieces, aside: true });
      }
    }
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
    kind: 'DAMAGED' | 'DEMO'; locationId: number | null; quantity: number; note: string;
  } | null>(null);

  openTakeout(kind: 'DAMAGED' | 'DEMO'): void {
    const levels = this.stockLevels() ?? [];
    const preferred = levels.find((level) => level.quantity > 0) ?? levels[0];
    this.takeout.set({ kind, locationId: preferred?.locationId ?? null, quantity: 0, note: '' });
  }

  async confirmTakeout(): Promise<void> {
    const product = this.product();
    const out = this.takeout();
    if (!product || product.id === null || !out || !(out.quantity > 0)) return;
    this.stockSaving.set(true);
    try {
      await this.catalog.takeOutStock(product.id, {
        locationId: out.locationId, quantity: out.quantity, kind: out.kind,
        note: out.note.trim() || null,
      });
      this.takeout.set(null);
      this.ui.toast(out.kind === 'DAMAGED' ? 'Beschadigde stuks geboekt' : 'Demo geboekt');
      this.refreshStock(product.id);
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
  private refreshStock(productId: number): void {
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
  private readonly categories = signal<Category[]>([]);

  /** Every product in the catalogue's default order, for the header arrows. */
  private readonly catalogueOrder = signal<Product[]>([]);
  readonly neighbours = computed(() => {
    const id = this.product()?.id ?? null;
    const order = this.catalogueOrder();
    if (id === null || !order.length) return null;
    const index = order.findIndex((item) => item.id === id);
    if (index < 0) return null;
    return {
      index, total: order.length,
      previous: index > 0 ? order[index - 1] : null,
      next: index < order.length - 1 ? order[index + 1] : null,
    };
  });
  private readonly suppliers = signal<Supplier[]>([]);
  private loadVersion = 0;

  readonly variantMembers = computed(() => {
    const productId = this.product()?.id;
    return [...(this.family()?.members ?? [])]
      .filter((member) => member.active || member.productId === productId)
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
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = Number(params.get('id'));
      if (Number.isInteger(id) && id > 0) void this.loadProduct(id);
    });
  }

  retryFamily(): void {
    const familyId = this.product()?.familyId;
    if (familyId != null && !this.familyLoading()) {
      void this.loadFamily(familyId, this.loadVersion);
    }
  }

  private async loadProduct(id: number): Promise<void> {
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

    const [product, categories, suppliers] = await Promise.all([
      this.catalog.product(id),
      this.catalog.categories(),
      this.sourcing.suppliers(),
    ]);
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
    if (!this.catalogueOrder().length) {
      void this.catalog.products()
        .then((all) => this.catalogueOrder.set(orderLikeTheList(all, categories)))
        .catch(() => this.catalogueOrder.set([]));
    }
    if (product.familyId != null) await this.loadFamily(product.familyId, version);
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

  headerLine(): string {
    const product = this.product();
    if (!product) return '';
    return product.sku ?? '';
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

  variantMemberLabel(member: ProductFamilyMember): string {
    const variant = [member.colour, member.size]
      .map((value) => value?.trim())
      .filter((value): value is string => !!value)
      .join(' · ');
    return variant || member.name || member.sku || `Product ${member.productId}`;
  }

  size(box: { lengthCm: number | null; widthCm: number | null; heightCm: number | null }): string {
    const dimensions = [box.lengthCm, box.widthCm, box.heightCm];
    if (!dimensions.some((value) => value !== null && value > 0)) return '—';
    return `${dimensions.map((value) => value !== null && value > 0 ? value : '—').join(' × ')} cm`;
  }
}
