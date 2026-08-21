import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { AuthImage } from '../../core/api/auth-image';
import { PhotoLightbox } from '../../shared/photo-lightbox';
import { Category, Product, ProductFamily, ProductFamilyMember, Supplier } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Privacy } from '../../core/api/privacy';
import { CbmPipe, CurPipe, EurPipe, NumPipe } from '../../shared/pipes';

interface GalleryPointer {
  pointerId: number;
  startX: number;
  startY: number;
  axis: 'pending' | 'horizontal' | 'vertical';
  stage: HTMLElement;
}

/**
 * Read-first product master. The page deliberately separates the customer
 * story (photo, price, availability) from operational data. Editing remains
 * an explicit action, so a warehouse or sales colleague can safely browse it.
 */
@Component({
  selector: 'app-product-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink, AuthImage, PhotoLightbox, PageHeader, CbmPipe, CurPipe, EurPipe, NumPipe,
  ],
  template: `
    @if (product(); as product) {
      <app-page-header [title]="product.name" [subtitle]="headerLine()"
                       [showBack]="true" [showBell]="false">
        <a class="btn btn--primary btn--sm" [routerLink]="['/products', product.id, 'edit']">
          Bewerken
        </a>
      </app-page-header>

      <div class="content product-view-page">
        <div class="product-view-canvas">
          <section class="product-hero" aria-label="Productoverzicht">
            <div class="gallery" role="region" aria-roledescription="carousel"
                 [attr.aria-label]="product.name + ' productfoto’s'">
              @if (activePhoto(); as photo) {
                <button class="gallery__stage" type="button"
                        [class.gallery__stage--dragging]="galleryDragging()"
                        [style.--gallery-drag-x]="galleryDragging() ? galleryDragX() + 'px' : null"
                        (pointerdown)="startGalleryDrag($event)"
                        (pointermove)="moveGalleryDrag($event)"
                        (pointerup)="finishGalleryDrag($event)"
                        (pointercancel)="cancelGalleryDrag($event)"
                        (dragstart)="$event.preventDefault()"
                        (keydown)="handleGalleryKey($event)"
                        (click)="openActivePhoto($event)"
                        [attr.aria-label]="'Foto ' + (activePhotoIndex() + 1) + ' van '
                          + product.photos.length
                          + ' vergroten. Sleep horizontaal of gebruik de pijltoetsen om te wisselen.'">
                  <img [appAuthSrc]="photo.url"
                       [alt]="product.name + ' — foto ' + (activePhotoIndex() + 1)"
                       draggable="false" />
                  <span class="gallery__count">{{ activePhotoIndex() + 1 }} / {{ product.photos.length }}</span>
                  <span class="gallery__zoom" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
                         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/>
                    </svg>
                  </span>
                </button>

                @if (product.photos.length > 1) {
                  <nav class="gallery__pager" aria-label="Door productfoto's bladeren">
                    <button class="gallery__step" type="button" (click)="stepPhoto(-1)"
                            aria-label="Vorige foto">‹</button>
                    <div class="gallery__dots" role="group" aria-label="Fotopositie">
                      @for (item of product.photos; track item.id) {
                        <button class="gallery__dot" type="button"
                                [class.active]="activePhotoIndex() === $index"
                                [attr.aria-current]="activePhotoIndex() === $index ? 'true' : null"
                                [attr.aria-label]="'Toon foto ' + ($index + 1) + ' van ' + product.photos.length"
                                (click)="selectPhoto($index)"></button>
                      }
                    </div>
                    <button class="gallery__step" type="button" (click)="stepPhoto(1)"
                            aria-label="Volgende foto">›</button>
                  </nav>
                  <span class="sr-only" role="status" aria-live="polite">
                    Foto {{ activePhotoIndex() + 1 }} van {{ product.photos.length }}
                  </span>
                  <div class="gallery__thumbs" role="group" aria-label="Kies een productfoto">
                    @for (item of product.photos; track item.id) {
                      <button type="button" [class.active]="activePhotoIndex() === $index"
                              [attr.aria-pressed]="activePhotoIndex() === $index"
                              [attr.aria-label]="'Toon foto ' + ($index + 1)"
                              (click)="selectPhoto($index)">
                        <img [appAuthSrc]="item.url" alt="" draggable="false" />
                      </button>
                    }
                  </div>
                }
                <app-photo-lightbox [photos]="product.photos" [(index)]="lightbox" />
              } @else {
                <div class="gallery__empty">
                  <span aria-hidden="true">◇</span>
                  <b>Nog geen productfoto</b>
                  <small>Voeg in Bewerken een hoofdfoto toe.</small>
                </div>
              }
            </div>

            <div class="hero-summary">
              <div class="hero-summary__topline">
                <span class="badge" [class.badge--ok]="product.active"
                      [class.badge--warn]="!product.active">
                  {{ product.active ? 'Actief' : 'Inactief' }}
                </span>
                @if (categoryName()) { <span class="hero-summary__category">{{ categoryName() }}</span> }
              </div>

              <div class="hero-summary__price-stock">
                <div>
                  <span>Catalogusprijs</span>
                  @if (displayPrice(); as price) {
                    <strong class="num">{{ price | eur: 2 }}</strong>
                  } @else {
                    <strong>—</strong>
                  }
                  <small>{{ hasFixedSalesPrice(product) ? 'vaste prijs' : 'kostprijs + opslag' }}</small>
                </div>
                <div>
                  <span>Voorraad</span>
                  @if (product.inventoryKnown) {
                    <strong class="num" [class.warn-text]="product.stockQuantity <= 0">
                      {{ product.stockQuantity | num }}
                    </strong>
                    <small>stuks</small>
                  } @else {
                    <strong>—</strong>
                    <small>nog niet bevestigd</small>
                  }
                </div>
              </div>

              <div class="hero-summary__identity">
                @if (product.colour) {
                  <span>
                    @if (product.colourHex) {
                      <i class="variant-swatch" [style.backgroundColor]="product.colourHex" aria-hidden="true"></i>
                    }
                    <b>Kleur</b>{{ product.colour }}
                  </span>
                }
                @if (product.variantSize) { <span><b>Maat</b>{{ product.variantSize }}</span> }
                @if (product.sku) { <span><b>SKU</b><span class="mono">{{ product.sku }}</span></span> }
              </div>
            </div>
          </section>

          @if (familyLoading()) {
            <div class="variant-group-state" role="status">Varianten laden…</div>
          } @else if (familyLoadError()) {
            <div class="variant-group-state variant-group-state--error" role="alert">
              <span>Varianten zijn niet geladen.</span>
              <button class="btn btn--sm" type="button" (click)="retryFamily()">Opnieuw proberen</button>
            </div>
          } @else if (variantMembers().length > 1) {
            <section class="variant-links" aria-labelledby="variant-links-title">
              <b id="variant-links-title">Varianten</b>
              <div>
                @for (member of variantMembers(); track member.productId) {
                  @if (member.productId === product.id) {
                    <span class="product-variant-link product-variant-link--current" aria-current="page">
                      @if (member.colourHex) {
                        <i [style.backgroundColor]="member.colourHex" aria-hidden="true"></i>
                      }
                      {{ variantMemberLabel(member) }}
                    </span>
                  } @else {
                    <a class="product-variant-link" [routerLink]="['/products', member.productId]">
                      @if (member.colourHex) {
                        <i [style.backgroundColor]="member.colourHex" aria-hidden="true"></i>
                      }
                      {{ variantMemberLabel(member) }}
                    </a>
                  }
                }
              </div>
            </section>
          }

          <div class="details-grid">
            <section class="info-card" aria-labelledby="product-details-title">
              <header>
                <span class="info-card__icon" aria-hidden="true">01</span>
                <div><h2 id="product-details-title">Productdetails</h2><p>Identificatie van het artikel</p></div>
              </header>
              <dl class="detail-list">
                <div><dt>Leverancier</dt><dd>{{ supplierName() || '—' }}</dd></div>
                <div><dt>Afmeting (B × D × H)</dt><dd class="num">{{ size(product.dimensions) }}</dd></div>
                <div><dt>Barcode stuk</dt><dd class="mono">{{ product.barcodeInner || '—' }}</dd></div>
              </dl>
            </section>

            <section class="info-card" aria-labelledby="carton-details-title">
              <header>
                <span class="info-card__icon" aria-hidden="true">02</span>
                <div><h2 id="carton-details-title">Omdoos</h2><p>Verpakking en logistiek</p></div>
              </header>
              <dl class="detail-list">
                <div><dt>Karton (B × D × H)</dt><dd class="num">{{ size(product.carton) }}</dd></div>
                <div><dt>Inhoud</dt><dd class="num">{{ product.carton.piecesPerCarton | num }} stuks</dd></div>
                <div><dt>Gewicht</dt><dd class="num">
                  {{ product.carton.weightKg ? (product.carton.weightKg | num) + ' kg' : '—' }}
                </dd></div>
                <div><dt>Volume</dt><dd class="num">
                  @if (product.cartonCbm) { {{ product.cartonCbm | cbm }} } @else { — }
                </dd></div>
                <div><dt>Omdoosbarcode</dt><dd class="mono">{{ product.barcodeOuter || '—' }}</dd></div>
              </dl>
            </section>

            @if (privacy.showPurchase()) {
              <section class="info-card info-card--internal" aria-labelledby="purchase-details-title">
                <header>
                  <span class="info-card__icon" aria-hidden="true">03</span>
                  <div><h2 id="purchase-details-title">Inkoop</h2><p>Alleen intern zichtbaar</p></div>
                  <span class="badge badge--warn">intern</span>
                </header>
                <dl class="detail-list">
                  <div><dt>EXW-prijs</dt><dd class="num">
                    @if (product.exwPrice; as price) { {{ price | cur: product.exwCurrency }} } @else { — }
                  </dd></div>
                  <div><dt>Extra kost per stuk</dt><dd class="num">
                    @if (product.extraUnitCost; as extra) { {{ extra | cur: product.exwCurrency }} } @else { — }
                  </dd></div>
                  <div class="detail-list__emphasis"><dt>Kostprijs incl. rechten</dt><dd class="num">
                    @if (product.landedCostEur; as landed) { {{ landed | eur: 2 }} } @else { — }
                  </dd></div>
                  @if (product.landedCostSource) {
                    <div><dt>Bron kostprijs</dt><dd>{{ product.landedCostSource }}</dd></div>
                  }
                  <div><dt>HS-code</dt><dd class="mono">{{ product.hsCode || '—' }}</dd></div>
                </dl>
              </section>
            }

            <section class="info-card" aria-labelledby="sales-details-title">
              <header>
                <span class="info-card__icon" aria-hidden="true">{{ privacy.showPurchase() ? '04' : '03' }}</span>
                <div><h2 id="sales-details-title">Verkoop</h2><p>Prijsregel en rendabiliteit</p></div>
              </header>
              <dl class="detail-list">
                <div><dt>Prijsregel</dt><dd>
                  {{ hasFixedSalesPrice(product)
                    ? 'Vaste verkoopprijs'
                    : (product.markupPct | num) + ' % opslag op kostprijs' }}
                </dd></div>
                @if (privacy.showPurchase()) {
                  <div><dt>Marge per stuk</dt>
                    @if (margin(); as value) {
                      <dd class="num" [class.warn-text]="value.eur < 0">{{ value.eur | eur: 2 }}</dd>
                    } @else {
                      <dd class="muted">Niet beschikbaar</dd>
                    }
                  </div>
                }
              </dl>
            </section>
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
    }
  `,
  styles: `
    .product-view-page { background: radial-gradient(circle at 50% 0, var(--rose-soft), transparent 300px); }
    .product-view-canvas { width: 100%; max-width: 1080px; margin: 0 auto; }

    .product-hero {
      overflow: hidden; border: 1px solid rgb(255 255 255 / 70%); border-radius: var(--r-lg);
      background: var(--surface); box-shadow: var(--sh-2);
    }
    .gallery { min-width: 0; padding: 12px; background: linear-gradient(145deg, #f6f1ed, #eee7e1); }
    .gallery__stage {
      position: relative; width: 100%; aspect-ratio: 1; overflow: hidden; padding: 0;
      border: 1px solid rgb(26 22 20 / 7%); border-radius: 18px; background: #fff;
      cursor: grab; touch-action: pan-y; user-select: none;
    }
    .gallery__stage:active, .gallery__stage--dragging { cursor: grabbing; }
    .gallery__stage img {
      width: 100%; height: 100%; object-fit: contain; pointer-events: none;
      transform: translateX(var(--gallery-drag-x, 0px));
      transition: transform .2s cubic-bezier(.2,.8,.2,1);
    }
    .gallery__stage--dragging img { transition: none; }
    .gallery__stage:focus-visible { outline: 3px solid var(--rose); outline-offset: 3px; }
    .gallery__count, .gallery__zoom {
      position: absolute; bottom: 10px; display: inline-flex; align-items: center; justify-content: center;
      background: rgb(25 20 18 / 68%); color: #fff; backdrop-filter: blur(8px);
    }
    .gallery__count { left: 10px; min-height: 28px; padding: 4px 9px; border-radius: 999px;
      font-size: 10.5px; font-weight: 700; }
    .gallery__zoom { right: 10px; width: 32px; height: 32px; border-radius: 50%; }
    .gallery__thumbs {
      display: flex; gap: 7px; min-width: 0; margin-top: 2px; padding: 2px 1px 5px;
      overflow-x: auto; overscroll-behavior-inline: contain; scrollbar-width: thin;
    }
    .gallery__thumbs button {
      flex: 0 0 54px; width: 54px; height: 54px; overflow: hidden; padding: 2px; border: 2px solid transparent;
      border-radius: 11px; background: rgb(255 255 255 / 68%); cursor: pointer;
    }
    .gallery__thumbs button.active { border-color: var(--rose); background: var(--surface); }
    .gallery__thumbs button:focus-visible { outline: 3px solid var(--rose-line); outline-offset: 2px; }
    .gallery__thumbs img { width: 100%; height: 100%; border-radius: 7px; object-fit: cover; }
    .gallery__empty { min-height: 280px; display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 4px; border: 1px dashed var(--line-strong); border-radius: 18px;
      background: rgb(255 255 255 / 55%); color: var(--muted); text-align: center; }
    .gallery__empty > span { font-size: 38px; line-height: 1; opacity: .55; }
    .gallery__empty b { color: var(--ink-2); font-size: 13px; }
    .gallery__empty small { font-size: 11.5px; }

    .hero-summary { min-width: 0; padding: 18px; }
    .hero-summary__topline { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .hero-summary__category { overflow: hidden; color: var(--muted); font-size: 11.5px;
      text-overflow: ellipsis; white-space: nowrap; }
    .hero-summary__price-stock { display: grid; grid-template-columns: 1.35fr .65fr; gap: 9px; margin-top: 14px; }
    .hero-summary__price-stock > div { min-width: 0; display: flex; flex-direction: column; padding: 13px;
      border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface-2); }
    .hero-summary__price-stock span { color: var(--muted); font-size: 10px; font-weight: 700;
      letter-spacing: .07em; text-transform: uppercase; }
    .hero-summary__price-stock strong { overflow: hidden; margin-top: 1px; font-size: 22px;
      line-height: 1.25; letter-spacing: -.025em; text-overflow: ellipsis; white-space: nowrap; }
    .hero-summary__price-stock small { color: var(--muted); font-size: 10.5px; }
    .hero-summary__identity { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }
    .hero-summary__identity > span { display: inline-flex; gap: 6px; padding: 5px 9px; border-radius: 999px;
      background: var(--surface-2); color: var(--ink-2); font-size: 11.5px; }
    .hero-summary__identity b { color: var(--muted); font-weight: 600; }
    .variant-swatch { width: 12px; height: 12px; border: 1px solid rgb(26 22 20 / 12%); border-radius: 50%; }

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
    .details-grid { display: grid; gap: 12px; margin-top: 14px; }
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

    .detail-list { margin: 0; padding: 6px 14px 10px; }
    .detail-list > div { display: grid; grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr);
      align-items: baseline; gap: 12px; padding: 9px 0; border-bottom: 1px solid var(--line); }
    .detail-list > div:last-child { border-bottom: 0; }
    .detail-list dt { color: var(--muted); font-size: 11.5px; }
    .detail-list dd { min-width: 0; color: var(--ink-2); font-size: 12.5px; font-weight: 620;
      overflow-wrap: anywhere; text-align: right; }
    .detail-list__emphasis dt, .detail-list__emphasis dd { color: var(--ink); font-weight: 750; }

    @media (min-width: 760px) {
      .product-hero { display: grid; grid-template-columns: minmax(0, .95fr) minmax(0, 1.05fr); }
      .gallery { padding: 16px; }
      .hero-summary { display: flex; flex-direction: column; justify-content: center; padding: 24px; }
      .details-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .gallery__stage img { transition: none; }
    }
  `,
})
export class ProductView {
  readonly lightbox = signal(-1);
  readonly activePhotoIndex = signal(0);
  readonly galleryDragging = signal(false);
  readonly galleryDragX = signal(0);

  private galleryPointer: GalleryPointer | null = null;
  private galleryGestureHandled = false;
  private galleryClickResetTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly catalog = inject(CatalogApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  readonly privacy = inject(Privacy);

  readonly product = signal<Product | null>(null);
  readonly family = signal<ProductFamily | null>(null);
  readonly familyLoading = signal(false);
  readonly familyLoadError = signal(false);
  private readonly categories = signal<Category[]>([]);
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
    return { eur: Math.round((price - landed) * 100) / 100 };
  });

  readonly activePhoto = computed(() => {
    const photos = this.product()?.photos ?? [];
    if (!photos.length) return null;
    const index = Math.min(Math.max(this.activePhotoIndex(), 0), photos.length - 1);
    return photos[index];
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
    const version = ++this.loadVersion;
    this.product.set(null);
    this.family.set(null);
    this.familyLoadError.set(false);
    this.familyLoading.set(false);
    this.activePhotoIndex.set(0);
    this.lightbox.set(-1);
    this.resetGalleryPointer();

    const [product, categories, suppliers] = await Promise.all([
      this.catalog.product(id),
      this.catalog.categories(),
      this.sourcing.suppliers(),
    ]);
    if (version !== this.loadVersion) return;
    this.product.set(product);
    this.categories.set(categories);
    this.suppliers.set(suppliers);
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

  openActivePhoto(event: MouseEvent): void {
    if (this.galleryGestureHandled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    this.lightbox.set(this.activePhotoIndex());
  }

  selectPhoto(index: number): void {
    const count = this.product()?.photos.length ?? 0;
    if (!count) return;
    this.activePhotoIndex.set(Math.max(0, Math.min(index, count - 1)));
  }

  stepPhoto(direction: -1 | 1): void {
    const count = this.product()?.photos.length ?? 0;
    if (count < 2) return;
    this.activePhotoIndex.update((index) => (index + direction + count) % count);
  }

  handleGalleryKey(event: KeyboardEvent): void {
    const count = this.product()?.photos.length ?? 0;
    if (count < 2) return;
    switch (event.key) {
      case 'ArrowLeft':
        event.preventDefault();
        this.stepPhoto(-1);
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.stepPhoto(1);
        break;
      case 'Home':
        event.preventDefault();
        this.selectPhoto(0);
        break;
      case 'End':
        event.preventDefault();
        this.selectPhoto(count - 1);
        break;
    }
  }

  startGalleryDrag(event: PointerEvent): void {
    if (!event.isPrimary || event.button !== 0 || (this.product()?.photos.length ?? 0) < 2) return;
    if (this.galleryClickResetTimer !== null) {
      clearTimeout(this.galleryClickResetTimer);
      this.galleryClickResetTimer = null;
    }
    this.galleryGestureHandled = false;
    const stage = event.currentTarget as HTMLElement;
    this.galleryPointer = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      axis: 'pending',
      stage,
    };
    try {
      stage.setPointerCapture(event.pointerId);
    } catch {
      this.galleryPointer = null;
    }
  }

  moveGalleryDrag(event: PointerEvent): void {
    const active = this.galleryPointer;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    if (active.axis === 'pending') {
      if (Math.hypot(dx, dy) < 8) return;
      active.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'horizontal' : 'vertical';
    }
    if (active.axis !== 'horizontal') return;
    event.preventDefault();
    event.stopPropagation();
    this.galleryGestureHandled = true;
    this.galleryDragging.set(true);
    const limit = Math.max(70, Math.min(active.stage.clientWidth * .32, 150));
    this.galleryDragX.set(Math.max(-limit, Math.min(limit, dx)));
  }

  finishGalleryDrag(event: PointerEvent): void {
    const active = this.galleryPointer;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.startX;
    const moved = Math.hypot(dx, event.clientY - active.startY);
    const horizontal = active.axis === 'horizontal';
    if (active.axis !== 'pending' && moved >= 8) {
      event.preventDefault();
      event.stopPropagation();
      this.galleryGestureHandled = true;
      this.deferGalleryClickRelease();
    }
    const threshold = Math.max(44, Math.min(active.stage.clientWidth * .14, 88));
    this.releaseGalleryPointer(active);
    this.resetGalleryPointer();
    if (horizontal && Math.abs(dx) >= threshold) this.stepPhoto(dx < 0 ? 1 : -1);
  }

  cancelGalleryDrag(event: PointerEvent): void {
    const active = this.galleryPointer;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.axis === 'horizontal') {
      this.galleryGestureHandled = true;
      this.deferGalleryClickRelease();
    }
    this.releaseGalleryPointer(active);
    this.resetGalleryPointer();
  }

  private deferGalleryClickRelease(): void {
    if (this.galleryClickResetTimer !== null) clearTimeout(this.galleryClickResetTimer);
    this.galleryClickResetTimer = setTimeout(() => {
      this.galleryGestureHandled = false;
      this.galleryClickResetTimer = null;
    }, 400);
  }

  private releaseGalleryPointer(active: GalleryPointer): void {
    try {
      if (active.stage.hasPointerCapture(active.pointerId)) {
        active.stage.releasePointerCapture(active.pointerId);
      }
    } catch {
      /* Pointer cancellation releases capture before Angular receives it. */
    }
  }

  private resetGalleryPointer(): void {
    this.galleryPointer = null;
    this.galleryDragging.set(false);
    this.galleryDragX.set(0);
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
