import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { AuthImage } from '../../core/api/auth-image';
import { PhotoLightbox } from '../../shared/photo-lightbox';
import { Category, Product, Supplier } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Privacy } from '../../core/api/privacy';
import { CbmPipe, CurPipe, EurPipe, NumPipe, PctPipe } from '../../shared/pipes';

/**
 * Look first, edit second.
 *
 * Tapping a product in the catalogue shows this compact card view: all data
 * readable together, without input fields that change something by
 * accident. Whoever really wants to edit goes through the Bewerken button
 * to the existing edit screen.
 *
 * The purchase and margin figures follow the privacy switch: in the green
 * (customer-safe) state the whole purchasing card disappears.
 */
@Component({
  selector: 'app-product-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AuthImage, PhotoLightbox, PageHeader, CbmPipe, CurPipe, EurPipe, NumPipe, PctPipe],
  template: `
    @if (product(); as product) {
      <app-page-header [title]="product.name" [subtitle]="headerLine()"
                       [showBack]="true" [showBell]="false">
        <a class="btn btn--primary btn--sm" [routerLink]="['/products', product.id, 'edit']">
          Bewerken
        </a>
      </app-page-header>

      <div class="content">
        @if (product.photos.length) {
          <div class="view__photos" [class.view__photos--single]="product.photos.length === 1">
            @for (photo of product.photos; track photo.id) {
              <button class="view__photo-btn" type="button" (click)="lightbox.set($index)"
                      [attr.aria-label]="'Foto ' + ($index + 1) + ' vergroten'">
                <img class="view__photo" [appAuthSrc]="photo.url" [alt]="product.name" />
                <span class="view__zoom" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none"
                       stroke="currentColor" stroke-width="2" stroke-linecap="round"
                       stroke-linejoin="round">
                    <path d="M9 3H3v6" /><path d="M3 3l7 7" />
                    <path d="M15 21h6v-6" /><path d="M21 21l-7-7" />
                  </svg>
                </span>
              </button>
            }
          </div>
          @if (product.photos.length > 1) {
            <div class="view__dots">
              @for (photo of product.photos; track photo.id) {
                <span class="view__dot"></span>
              }
            </div>
          }
          <app-photo-lightbox [photos]="product.photos" [(index)]="lightbox" />
        }

        @if (!product.active) {
          <div class="alert alert--warn">Dit product staat inactief.</div>
        }
        <div class="spec-grid">
          <div class="spec">
            <span class="spec__label">Voorraad</span>
            <span class="spec__value" [class.warn-text]="product.stockQuantity <= 0">
              {{ product.stockQuantity | num }}</span>
            <span class="spec__sub">stuks</span>
          </div>
          <div class="spec">
            <span class="spec__label">Kleur</span>
            <span class="spec__value">{{ product.colour || '—' }}</span>
            <span class="spec__sub">{{ categoryName() || ' ' }}</span>
          </div>
          <div class="spec">
            <span class="spec__label">Afmeting</span>
            <span class="spec__value spec__value--sm num">{{ size(product.dimensions) }}</span>
            <span class="spec__sub">l × b × h</span>
          </div>
          <div class="spec">
            <span class="spec__label">Barcode stuk</span>
            <span class="spec__value spec__value--sm num">{{ product.barcodeInner || '—' }}</span>
            <span class="spec__sub">EAN-13</span>
          </div>
          <div class="spec spec--wide">
            <span class="spec__label">Leverancier</span>
            <span class="spec__value spec__value--sm">{{ supplierName() || '—' }}</span>
          </div>
        </div>

        <div class="card">
          <div class="card__head"><h2>Omdoos</h2></div>
          <div class="card__body">
            <div class="stat-row"><span>Kartonafmeting</span>
              <span class="num">{{ size(product.carton) }}</span></div>
            <div class="stat-row"><span>Stuks per karton</span>
              <span class="num">{{ product.carton.piecesPerCarton | num }}</span></div>
            @if (product.carton.weightKg) {
              <div class="stat-row"><span>Gewicht per karton</span>
                <span class="num">{{ product.carton.weightKg | num }} kg</span></div>
            }
            @if (product.cartonCbm) {
              <div class="stat-row"><span>Volume per karton</span>
                <span class="num">{{ product.cartonCbm | cbm }}</span></div>
            }
            <div class="stat-row"><span>Omdoosbarcode</span>
              <span class="num">{{ product.barcodeOuter || '—' }}</span></div>
          </div>
        </div>

        @if (privacy.showPurchase()) {
          <div class="card mt-16">
            <div class="card__head"><h2>Inkoop</h2></div>
            <div class="card__body">
              <div class="stat-row"><span>EXW-prijs</span>
                <span class="num">
                  @if (product.exwPrice; as price) {
                    {{ price | cur: product.exwCurrency }}
                  } @else { — }
                </span></div>
              @if (product.extraUnitCost) {
                <div class="stat-row"><span>Extra kost per stuk</span>
                  <span class="num">{{ product.extraUnitCost | eur }}</span></div>
              }
              <div class="stat-row"><span>Kostprijs incl. rechten</span>
                <span class="num">
                  @if (product.landedCostEur; as landed) {
                    {{ landed | eur: 2 }}
                    @if (product.landedCostSource) {
                      <span class="tiny muted">({{ product.landedCostSource }})</span>
                    }
                  } @else { — }
                </span></div>
              <div class="stat-row"><span>HS-code</span>
                <span class="num">{{ product.hsCode || '—' }}</span></div>
            </div>
          </div>
        }

        <div class="card mt-16 mb-24">
          <div class="card__head"><h2>Verkoop</h2></div>
          <div class="card__body">
            <div class="stat-row"><span>Verkoopprijs</span>
              <span class="num">
                @if (product.fixedSalesPriceEur; as fixed) {
                  {{ fixed | eur: 2 }} <span class="tiny muted">(vast)</span>
                } @else if (salesPrice(); as derived) {
                  {{ derived | eur: 2 }} <span class="tiny muted">(kostprijs + opslag)</span>
                } @else { — }
              </span></div>
            @if (privacy.showPurchase() && margin(); as m) {
              <div class="stat-row"><span>Marge</span>
                <span class="num" [class.warn-text]="m.eur < 0">
                  {{ m.eur | eur: 2 }} ({{ m.pct | num }} %)</span></div>
            }
          </div>
        </div>

      </div>
    }
  `,
  styles: `
    /* One big photo at a time, snapped to the centre; swipe for the rest. */
    .view__photos {
      display: flex; gap: 12px; overflow-x: auto;
      scroll-snap-type: x mandatory;
      padding: 2px calc(50% - min(24vw, 90px)) 6px;
      margin-bottom: 6px;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none;
    }
    .view__photos::-webkit-scrollbar { display: none; }
    .view__photos--single { justify-content: center; padding-inline: 0; }
    .view__photo-btn {
      position: relative;
      border: 0; padding: 0; background: none; cursor: zoom-in; flex: 0 0 auto;
      scroll-snap-align: center;
      transition: transform 0.15s ease;
    }
    .view__photo-btn:active { transform: scale(0.98); }
    .view__photo {
      width: min(48vw, 180px); height: min(48vw, 180px);
      object-fit: cover; border-radius: var(--r);
      border: 1px solid var(--line);
      background: var(--surface-2);
      display: block;
    }
    .view__zoom {
      position: absolute; right: 6px; bottom: 6px;
      display: inline-flex; align-items: center; justify-content: center;
      width: 26px; height: 26px; border-radius: 50%;
      background: rgb(20 14 12 / 55%); color: #fff;
      backdrop-filter: blur(4px); pointer-events: none;
    }
    /* Bento tiles: chunky, glanceable, no label-value line soup. */
    .spec-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
      margin-bottom: 18px;
    }
    .spec {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 12px 14px;
      display: flex; flex-direction: column; gap: 2px;
      min-width: 0;
    }
    .spec--wide { grid-column: 1 / -1; }
    .spec__label {
      font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--muted);
    }
    .spec__value {
      font-size: 22px; font-weight: 800; letter-spacing: -0.01em;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .spec__value--sm { font-size: 14.5px; font-weight: 700; }
    .spec__sub { font-size: 11.5px; color: var(--muted); }

    .view__dots {
      display: flex; justify-content: center; gap: 6px; margin-bottom: 14px;
    }
    .view__dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: color-mix(in srgb, var(--ink) 22%, transparent);
    }
  `,
})
export class ProductView {
  /** Which photo the lightbox shows; -1 is closed. */
  readonly lightbox = signal(-1);

  /** SKU and sales price together under the title - no scrolling for the
      number people look up most. */
  headerLine(): string {
    const product = this.product();
    if (!product) return '';
    const price = product.fixedSalesPriceEur ?? this.salesPrice();
    const formatted = price == null ? null : new Intl.NumberFormat('nl-BE',
        { style: 'currency', currency: 'EUR' }).format(price);
    /* Margin only in the internal state - this line is the first thing a
       customer looking along would read. */
    const m = this.privacy.showPurchase() ? this.margin() : null;
    const margin = m ? new Intl.NumberFormat('nl-BE',
        { style: 'currency', currency: 'EUR' }).format(m.eur) + ' marge' : null;
    return [product.sku, formatted, margin].filter(Boolean).join(' · ');
  }

  private readonly catalog = inject(CatalogApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly route = inject(ActivatedRoute);
  readonly privacy = inject(Privacy);

  readonly product = signal<Product | null>(null);
  private readonly categories = signal<Category[]>([]);
  private readonly suppliers = signal<Supplier[]>([]);

  readonly supplierName = computed(() =>
    this.suppliers().find((s) => s.id === this.product()?.supplierId)?.name ?? '');
  readonly categoryName = computed(() =>
    this.categories().find((c) => c.id === this.product()?.categoryId)?.name ?? '');

  /** Without a fixed price, cost plus markup applies - just like the quote. */
  readonly salesPrice = computed(() => {
    const product = this.product();
    if (!product?.landedCostEur || product.markupPct === null) return null;
    return product.landedCostEur * (1 + product.markupPct / 100);
  });

  readonly margin = computed(() => {
    const product = this.product();
    const price = product?.fixedSalesPriceEur ?? this.salesPrice();
    const landed = product?.landedCostEur;
    if (!price || !landed) return null;
    return { eur: price - landed, pct: ((price - landed) / landed) * 100 };
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
    });
  }

  size(box: { lengthCm: number | null; widthCm: number | null; heightCm: number | null }): string {
    return box.lengthCm && box.widthCm && box.heightCm
      ? `${box.lengthCm} × ${box.widthCm} × ${box.heightCm} cm`
      : '—';
  }
}
