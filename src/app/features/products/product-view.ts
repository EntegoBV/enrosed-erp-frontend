import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { AuthImage } from '../../core/api/auth-image';
import { Category, Product, Supplier } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Privacy } from '../../core/api/privacy';
import { CbmPipe, CurPipe, EurPipe, NumPipe, PctPipe } from '../../shared/pipes';

/**
 * Eerst kijken, dan pas bewerken.
 *
 * Een tik op een product in de catalogus toont deze compacte kaartweergave:
 * alle gegevens leesbaar bij elkaar, zonder invoervelden die per ongeluk iets
 * wijzigen. Wie echt iets wil aanpassen gaat via de knop Bewerken naar het
 * bestaande bewerkscherm.
 *
 * De inkoop- en margecijfers volgen de privacyschakelaar: in de groene
 * (klantveilige) stand verdwijnt de hele inkoopkaart.
 */
@Component({
  selector: 'app-product-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AuthImage, PageHeader, CbmPipe, CurPipe, EurPipe, NumPipe, PctPipe],
  template: `
    @if (product(); as product) {
      <app-page-header [title]="product.name" [subtitle]="product.sku ?? ''"
                       [showBack]="true" [showBell]="false">
        <a class="btn btn--primary btn--sm" [routerLink]="['/products', product.id, 'edit']">
          Bewerken
        </a>
      </app-page-header>

      <div class="content">
        @if (product.photos.length) {
          <div class="view__photos">
            @for (photo of product.photos; track photo.id) {
              <img class="view__photo" [appAuthSrc]="photo.url" [alt]="product.name" />
            }
          </div>
        }

        <div class="card">
          <div class="card__head"><h2>Product</h2>
            <span class="spacer"></span>
            @if (!product.active) { <span class="badge badge--warn">Inactief</span> }
          </div>
          <div class="card__body">
            <div class="stat-row"><span>Leverancier</span>
              <span>{{ supplierName() || '—' }}</span></div>
            <div class="stat-row"><span>Categorie</span>
              <span>{{ categoryName() || '—' }}</span></div>
            <div class="stat-row"><span>Kleur</span>
              <span>{{ product.colour || '—' }}</span></div>
            <div class="stat-row"><span>Afmeting</span>
              <span class="num">{{ size(product.dimensions) }}</span></div>
            <div class="stat-row"><span>Barcode (stuk)</span>
              <span class="num">{{ product.barcodeInner || '—' }}</span></div>
            <div class="stat-row"><span>Voorraad</span>
              <span class="num" [class.warn-text]="product.stockQuantity <= 0">
                {{ product.stockQuantity | num }} stuks</span></div>
          </div>
        </div>

        <div class="card mt-16">
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

        <div class="card mt-16">
          <div class="card__head"><h2>Verkoop</h2></div>
          <div class="card__body">
            @if (privacy.showPurchase()) {
              <div class="stat-row"><span>Opslag op kostprijs</span>
                <span class="num">
                  @if (product.markupPct; as markup) { {{ markup | pct: 0 }} } @else { — }
                </span></div>
            }
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
    .view__photos {
      display: flex; gap: 10px; overflow-x: auto;
      padding-bottom: 6px; margin-bottom: 16px;
      -webkit-overflow-scrolling: touch;
    }
    .view__photo {
      width: 108px; height: 108px; flex: 0 0 auto;
      object-fit: cover; border-radius: var(--r-sm);
      border: 1px solid var(--line);
      background: var(--surface-2);
    }
  `,
})
export class ProductView {
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

  /** Zonder vaste prijs geldt kostprijs + opslag, net zoals op de offerte. */
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
