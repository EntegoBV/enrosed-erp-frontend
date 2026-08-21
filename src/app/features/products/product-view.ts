import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { AuthImage } from '../../core/api/auth-image';
import { PhotoLightbox } from '../../shared/photo-lightbox';
import { Category, Product, ProductFamily, Supplier } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Privacy } from '../../core/api/privacy';
import { CbmPipe, CurPipe, EurPipe, NumPipe } from '../../shared/pipes';

/**
 * Read-first product master. The page deliberately separates the customer
 * story (photo, price, availability) from operational data. Editing remains
 * an explicit action, so a warehouse or sales colleague can safely browse it.
 */
@Component({
  selector: 'app-product-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AuthImage, PhotoLightbox, PageHeader, CbmPipe, CurPipe, EurPipe, NumPipe],
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
            <div class="gallery">
              @if (activePhoto(); as photo) {
                <button class="gallery__stage" type="button" (click)="openActivePhoto()"
                        [attr.aria-label]="'Foto ' + (activePhotoIndex() + 1) + ' van ' + product.photos.length + ' vergroten'">
                  <img [appAuthSrc]="photo.url"
                       [alt]="product.name + ' — foto ' + (activePhotoIndex() + 1)" />
                  <span class="gallery__count">{{ activePhotoIndex() + 1 }} / {{ product.photos.length }}</span>
                  <span class="gallery__zoom" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
                         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/>
                    </svg>
                  </span>
                </button>

                @if (product.photos.length > 1) {
                  <div class="gallery__thumbs" role="group" aria-label="Kies een productfoto">
                    @for (item of product.photos; track item.id) {
                      <button type="button" [class.active]="activePhotoIndex() === $index"
                              [attr.aria-pressed]="activePhotoIndex() === $index"
                              [attr.aria-label]="'Toon foto ' + ($index + 1)"
                              (click)="activePhotoIndex.set($index)">
                        <img [appAuthSrc]="item.url" alt="" />
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

              <div class="publication-strip">
                <div class="publication-strip__main">
                  <span>Publicatie</span>
                  <strong>{{ publicationSummary() }}</strong>
                  @if (publicHandle()) {
                    <small class="mono">/products/{{ publicHandle() }}</small>
                  }
                </div>
                <div class="publication-strip__states" aria-label="Verkoopkanalen">
                  <span [class.live]="publicationActive() && websiteStatus() === 'PUBLISHED'">
                    Website
                  </span>
                  <span [class.live]="publicationActive() && orderAppStatus() === 'PUBLISHED'">
                    Orderapp
                  </span>
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
                <details class="website-preview">
                  <summary>Website-informatie bekijken</summary>
                  <div>
                    <b>{{ family.name }}</b>
                    @if (family.summary) { <p>{{ family.summary }}</p> }
                    @if (family.description) { <p>{{ family.description }}</p> }
                    <small>
                      {{ family.collectionKey || family.categoryName || 'Geen collectie' }}
                      · {{ family.variantCount }} product(en)
                    </small>
                  </div>
                </details>
              }
            </div>
          </section>

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
                @if (family(); as family) {
                  <div><dt>Productfamilie</dt><dd>{{ family.name }} <span class="mono">· {{ family.familyKey }}</span></dd></div>
                }
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
                <div><h2 id="sales-details-title">Verkoop</h2><p>Prijs voor catalogus en orderapp</p></div>
              </header>
              <dl class="detail-list">
                <div class="detail-list__emphasis"><dt>Verkoopprijs</dt><dd class="num">
                  @if (displayPrice(); as price) { {{ price | eur: 2 }} } @else { — }
                </dd></div>
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
      cursor: zoom-in;
    }
    .gallery__stage img { width: 100%; height: 100%; object-fit: contain; }
    .gallery__stage:focus-visible { outline: 3px solid var(--rose); outline-offset: 3px; }
    .gallery__count, .gallery__zoom {
      position: absolute; bottom: 10px; display: inline-flex; align-items: center; justify-content: center;
      background: rgb(25 20 18 / 68%); color: #fff; backdrop-filter: blur(8px);
    }
    .gallery__count { left: 10px; min-height: 28px; padding: 4px 9px; border-radius: 999px;
      font-size: 10.5px; font-weight: 700; }
    .gallery__zoom { right: 10px; width: 32px; height: 32px; border-radius: 50%; }
    .gallery__thumbs { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 9px; }
    .gallery__thumbs button {
      width: 54px; height: 54px; overflow: hidden; padding: 2px; border: 2px solid transparent;
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
    .product-copy { margin-top: 14px; color: var(--ink-2); font-size: 13.5px; line-height: 1.6;
      white-space: pre-line; }
    .product-copy--empty { color: var(--muted); font-style: italic; }

    .publication-strip { display: flex; align-items: center; justify-content: space-between; gap: 12px;
      margin-top: 16px; padding: 12px; border: 1px solid var(--rose-line);
      border-radius: var(--r-sm); background: var(--rose-soft); }
    .publication-strip__main { min-width: 0; display: flex; flex-direction: column; }
    .publication-strip__main > span { color: var(--muted); font-size: 9.5px; font-weight: 750;
      letter-spacing: .09em; text-transform: uppercase; }
    .publication-strip__main strong { font-size: 12.5px; }
    .publication-strip__main small { overflow: hidden; color: var(--muted); font-size: 10px;
      text-overflow: ellipsis; white-space: nowrap; }
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
    .website-preview { margin-top: 9px; overflow: hidden; border: 1px solid var(--line);
      border-radius: var(--r-sm); background: var(--surface-2); }
    .website-preview summary { padding: 10px 12px; color: var(--ink-2); font-size: 11px;
      font-weight: 680; cursor: pointer; }
    .website-preview > div { padding: 0 12px 12px; }
    .website-preview b { font-size: 12px; }
    .website-preview p { margin-top: 5px; color: var(--muted); font-size: 11px; line-height: 1.5;
      white-space: pre-line; }
    .website-preview small { display: block; margin-top: 8px; color: var(--muted); font-size: 10px; }

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
  `,
})
export class ProductView {
  readonly lightbox = signal(-1);
  readonly activePhotoIndex = signal(0);

  private readonly catalog = inject(CatalogApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly route = inject(ActivatedRoute);
  readonly privacy = inject(Privacy);

  readonly product = signal<Product | null>(null);
  readonly family = signal<ProductFamily | null>(null);
  private readonly categories = signal<Category[]>([]);
  private readonly suppliers = signal<Supplier[]>([]);

  readonly supplierName = computed(() =>
    this.suppliers().find((supplier) => supplier.id === this.product()?.supplierId)?.name ?? '');
  readonly categoryName = computed(() =>
    this.categories().find((category) => category.id === this.product()?.categoryId)?.name ?? '');

  readonly displayPrice = computed(() => {
    const product = this.product();
    if (!product) return null;
    return product.computedSalesPriceEur > 0 ? product.computedSalesPriceEur : null;
  });

  readonly publicHandle = computed(() =>
    this.family()?.publicHandle || this.product()?.publicHandle || null);
  readonly websiteStatus = computed(() =>
    this.family()?.websiteStatus ?? this.product()?.websiteStatus ?? 'DRAFT');
  readonly orderAppStatus = computed(() =>
    this.family()?.orderAppStatus ?? this.product()?.orderAppStatus ?? 'DRAFT');
  readonly publicationActive = computed(() =>
    this.family()?.active ?? this.product()?.active ?? false);
  readonly publicationIssues = computed(() => {
    const family = this.family();
    if (family) return family.publicationIssues;
    const product = this.product();
    if (!product || (product.websiteStatus === 'DRAFT' && product.orderAppStatus === 'DRAFT')) {
      return [];
    }
    return product.publicationIssues ?? [];
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
    const id = Number(this.route.snapshot.paramMap.get('id'));
    void Promise.all([
      this.catalog.product(id),
      this.catalog.categories(),
      this.sourcing.suppliers(),
    ]).then(([product, categories, suppliers]) => {
      this.product.set(product);
      this.categories.set(categories);
      this.suppliers.set(suppliers);
      this.activePhotoIndex.set(0);
      if (product.familyId != null) {
        void this.catalog.productFamily(product.familyId)
          .then((family) => this.family.set(family))
          .catch(() => this.family.set(null));
      }
    });
  }

  openActivePhoto(): void {
    this.lightbox.set(this.activePhotoIndex());
  }

  hasFixedSalesPrice(product: Product): boolean {
    return product.fixedSalesPriceEur !== null && product.fixedSalesPriceEur > 0;
  }

  headerLine(): string {
    const product = this.product();
    if (!product) return '';
    const price = this.displayPrice();
    const formatted = price == null ? null : new Intl.NumberFormat('nl-BE',
      { style: 'currency', currency: 'EUR' }).format(price);
    return [product.sku, formatted].filter(Boolean).join(' · ');
  }

  publicationSummary(): string {
    if (!this.publicationActive()) return 'Inactief';
    const live = [
      this.websiteStatus() === 'PUBLISHED' ? 'website' : null,
      this.orderAppStatus() === 'PUBLISHED' ? 'orderapp' : null,
    ].filter(Boolean);
    if (live.length) return `Live op ${live.join(' en ')}`;
    if (this.publicationIssues().length) return 'Nog niet compleet';
    if (this.websiteStatus() === 'READY' || this.orderAppStatus() === 'READY') {
      return 'Klaar om te publiceren';
    }
    return 'Concept';
  }

  size(box: { lengthCm: number | null; widthCm: number | null; heightCm: number | null }): string {
    const dimensions = [box.lengthCm, box.widthCm, box.heightCm];
    if (!dimensions.some((value) => value !== null && value > 0)) return '—';
    return `${dimensions.map((value) => value !== null && value > 0 ? value : '—').join(' × ')} cm`;
  }
}
