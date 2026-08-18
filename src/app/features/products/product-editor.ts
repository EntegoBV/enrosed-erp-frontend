import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { Category, Currency, HsCode, Product, Supplier } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { PhotoManager } from '../../shared/photo-manager';
import { Privacy } from '../../core/api/privacy';
import { Sheet, Ui } from '../../shared/ui';
import { CbmPipe, EurPipe, NumPipe, PctPipe } from '../../shared/pipes';
import { messageOf } from '../../core/api/errors';
import { STANDARD_COLOURS } from '../../core/api/geo';

function blankProduct(supplierId: number | null, currency: Currency): Product {
  return {
    id: null, sku: null, name: '',
    dimensions: { lengthCm: null, widthCm: null, heightCm: null },
    colour: '', categoryId: null, supplierId, active: true,
    barcodeInner: '', barcodeOuter: '', hsCode: '',
    carton: { lengthCm: null, widthCm: null, heightCm: null, piecesPerCarton: 1, weightKg: null },
    exwPrice: 0, exwCurrency: currency, extraUnitCost: 0,
    landedCostEur: null, landedCostSource: null,
    markupPct: 45, fixedSalesPriceEur: null,
    stockQuantity: 0,
    photos: [],
  };
}

@Component({
  selector: 'app-product-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageHeader, PhotoManager, Sheet,
            EurPipe, NumPipe, PctPipe, CbmPipe],
  template: `
    <app-page-header
      [title]="isNew() ? 'Nieuw product' : draft().name || 'Product'"
      [subtitle]="isNew() ? 'Aan een leverancier koppelen' : (draft().sku ?? '')"
      [showBack]="true"
      [showBell]="false"
    >
      <button class="btn btn--primary btn--sm" type="button" [disabled]="saving()"
              (click)="save()">{{ saving() ? 'Bezig…' : 'Opslaan' }}</button>
    </app-page-header>

    <div class="content">
      <p class="legend"><b>*</b> verplicht · de rest kan later.</p>

      <!-- ============================================ product -->
      <div class="card">
        <div class="card__head"><h2>Product</h2></div>
        <div class="card__body">
          <div class="form-grid">
            <div class="field span-2">
              <label class="req" for="p-supplier">Leverancier</label>
              <select class="select" id="p-supplier" [ngModel]="draft().supplierId"
                      (ngModelChange)="setSupplier(+$event)">
                @for (supplier of suppliers(); track supplier.id) {
                  <option [ngValue]="supplier.id">
                    {{ supplier.name }} — {{ supplier.city }} ({{ supplier.currency }})
                  </option>
                }
              </select>
            </div>
            <div class="field">
              <label class="req" for="p-name">Naam</label>
              <input class="input" id="p-name" [ngModel]="draft().name"
                     (ngModelChange)="patch({ name: $event })" />
            </div>
            <div class="field">
              <label for="p-category">Categorie <span class="opt"></span></label>
              <select class="select" id="p-category" [ngModel]="draft().categoryId"
                      (ngModelChange)="patch({ categoryId: $event === null ? null : +$event })">
                <option [ngValue]="null">— geen categorie —</option>
                @for (category of categories(); track category.id) {
                  <option [ngValue]="category.id">{{ category.name }}</option>
                }
              </select>
              <span class="hint">Vaste lijst; beheer je bij Instellingen.</span>
            </div>
            <div class="field span-2">
              <label for="p-colour">Kleur <span class="opt"></span></label>
              <select class="select" id="p-colour" [ngModel]="colourChoice()"
                      (ngModelChange)="pickColour($event)">
                <option value="">Geen kleur</option>
                @for (option of standardColours; track option) {
                  <option [value]="option">{{ option }}</option>
                }
                <option value="__other__">Anders…</option>
              </select>
              @if (customColour()) {
                <input class="input mt-8" aria-label="Eigen kleur"
                       placeholder="Eigen kleur…" [ngModel]="draft().colour"
                       (ngModelChange)="patch({ colour: $event })" />
              }
              <span class="hint">
                Kleuren uit de lijst worden op offertes en in de catalogus
                <b>automatisch vertaald</b>; een eigen kleur vertaal je via het CSV-bestand.
              </span>
            </div>
          </div>

          <div class="field" style="margin-top:4px">
            <label>Afmeting van het product (cm) — lengte × breedte × hoogte</label>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
              <input class="input num right" type="number" step="0.1" min="0" inputmode="decimal"
                     aria-label="Lengte" [ngModel]="draft().dimensions.lengthCm"
                     (ngModelChange)="patchDimensions({ lengthCm: num($event) })" />
              <input class="input num right" type="number" step="0.1" min="0" inputmode="decimal"
                     aria-label="Breedte" [ngModel]="draft().dimensions.widthCm"
                     (ngModelChange)="patchDimensions({ widthCm: num($event) })" />
              <input class="input num right" type="number" step="0.1" min="0" inputmode="decimal"
                     aria-label="Hoogte" [ngModel]="draft().dimensions.heightCm"
                     (ngModelChange)="patchDimensions({ heightCm: num($event) })" />
            </div>
            <span class="hint">Het artikel zelf, los van de doos waarin het verscheept wordt.</span>
          </div>

          <div class="field">
            <label for="p-inner">Barcode (stuk) <span class="opt"></span></label>
            <input class="input mono" id="p-inner" inputmode="numeric"
                   [ngModel]="draft().barcodeInner" placeholder="EAN-13"
                   (ngModelChange)="patch({ barcodeInner: $event }); check($event, 'inner')" />
            @if (innerCheck(); as result) {
              <span class="hint" [class.danger-text]="!result.valid">{{ result.message }}</span>
            }
          </div>
        </div>
      </div>

      <!-- ============================================ foto's -->
      <div class="card">
        <div class="card__head">
          <h2>Foto's</h2>
          <span class="spacer"></span>
          <span class="badge badge--neutral">{{ draft().photos.length }}</span>
        </div>
        <div class="card__body">
          @if (isNew()) {
            <p class="small muted">
              Sla het product eerst op; daarna kan je er foto's aan toevoegen.
            </p>
          } @else {
            <app-photo-manager
              [productId]="draft().id!"
              [photos]="draft().photos"
              (changed)="draft.set($event)"
            />
          }
        </div>
      </div>

      <!-- ============================================ verpakking -->
      <div class="card">
        <div class="card__head"><h2>Omdoos</h2></div>
        <div class="card__body">
          <div class="field">
            <label>Kartonafmeting (cm) — lengte × breedte × hoogte</label>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
              <input class="input num right" type="number" step="0.1" min="0" inputmode="decimal"
                     aria-label="Karton lengte" [ngModel]="draft().carton.lengthCm"
                     (ngModelChange)="patchCarton({ lengthCm: num($event) })" />
              <input class="input num right" type="number" step="0.1" min="0" inputmode="decimal"
                     aria-label="Karton breedte" [ngModel]="draft().carton.widthCm"
                     (ngModelChange)="patchCarton({ widthCm: num($event) })" />
              <input class="input num right" type="number" step="0.1" min="0" inputmode="decimal"
                     aria-label="Karton hoogte" [ngModel]="draft().carton.heightCm"
                     (ngModelChange)="patchCarton({ heightCm: num($event) })" />
            </div>
          </div>
          <div class="form-grid">
            <div class="field">
              <label class="req" for="p-ppc">Stuks per karton</label>
              <input class="input num right" id="p-ppc" type="number" min="1" step="1"
                     inputmode="numeric" [ngModel]="draft().carton.piecesPerCarton"
                     (ngModelChange)="patchCarton({ piecesPerCarton: +$event })" />
            </div>
            <div class="field">
              <label for="p-weight">Gewicht per karton <span class="opt"></span></label>
              <div class="input-affix">
                <input class="input num right" id="p-weight" type="number" min="0" step="0.5"
                       inputmode="decimal" [ngModel]="draft().carton.weightKg"
                       (ngModelChange)="patchCarton({ weightKg: num($event) })" />
                <span class="input-affix__suffix">kg</span>
              </div>
            </div>
            <div class="field">
              <label for="p-outer">Omdoosbarcode <span class="opt"></span></label>
              <input class="input mono" id="p-outer" inputmode="numeric"
                     [ngModel]="draft().barcodeOuter" placeholder="EAN-13 of ITF-14"
                     (ngModelChange)="patch({ barcodeOuter: $event }); check($event, 'outer')" />
              @if (outerCheck(); as result) {
                <span class="hint" [class.danger-text]="!result.valid">{{ result.message }}</span>
              }
            </div>
          </div>
          <div class="alert alert--info mt-8">
            <span class="alert__icon">◈</span>
            <div>
              <b>{{ cartonCbm() | cbm }} per doos</b> ({{ pieceCbm() | num: 5 }} m³ per stuk).
            </div>
          </div>
        </div>
      </div>

      <!-- ============================================ inkoop -->
      @if (privacy.showPurchase()) {
      <div class="card">
        <div class="card__head"><h2>Inkoop</h2>
          <span class="spacer"></span>
          <span class="badge badge--warn">intern</span></div>
        <div class="card__body">
          <div class="form-grid">
            <div class="field">
              <label class="req" for="p-exw">EXW prijs</label>
              <input class="input num right" id="p-exw" type="number" min="0" step="0.01"
                     inputmode="decimal" [ngModel]="draft().exwPrice"
                     (ngModelChange)="patch({ exwPrice: +$event })" />
            </div>
            <div class="field">
              <label for="p-cur">Munt</label>
              <select class="select" id="p-cur" [ngModel]="draft().exwCurrency"
                      (ngModelChange)="patch({ exwCurrency: $event })">
                <option value="USD">USD — dollar</option>
                <option value="CNY">CNY — Chinese yuan</option>
                <option value="EUR">EUR — euro</option>
              </select>
            </div>
            <div class="field">
              <label for="p-extra">Extra kost per stuk <span class="opt"></span></label>
              <div class="input-affix">
                <input class="input num right" id="p-extra" type="number" min="0" step="0.01"
                       inputmode="decimal" [ngModel]="draft().extraUnitCost"
                       (ngModelChange)="patch({ extraUnitCost: +$event })" />
                <span class="input-affix__suffix">{{ draft().exwCurrency }}</span>
              </div>
            </div>
            <div class="field">
              <label for="p-hs">HS-code <span class="opt"></span></label>
              <select class="select" id="p-hs" [ngModel]="draft().hsCode"
                      (ngModelChange)="patch({ hsCode: $event })">
                <option value="">— geen tariefcode —</option>
                @for (code of hsCodes(); track code.code) {
                  <option [value]="code.code">
                    {{ code.code }} — {{ code.description }} ({{ code.dutyRatePct }} %)
                  </option>
                }
              </select>
              <span class="hint">Bepaalt het invoerrecht op de inkoopcalculatie.</span>
            </div>
          </div>

          @if (draft().landedCostEur) {
            <div class="stat-row stat-row--sub">
              <span>Kostprijs incl. vracht &amp; rechten</span>
              <span class="num strong rose-text">{{ draft().landedCostEur | eur: 4 }}</span>
            </div>
            <div class="stat-row stat-row--muted">
              <span>Berekend uit {{ draft().landedCostSource }}</span><span></span>
            </div>
          } @else {
            <div class="alert alert--warn mt-8">
              <span class="alert__icon">!</span>
              <div>Nog geen kostprijs. Zet dit product op een inkoopcalculatie.</div>
            </div>
          }
        </div>
      </div>

      }

      <!-- ============================================ verkoop -->
      <div class="card">
        <div class="card__head"><h2>Verkoop</h2></div>
        <div class="card__body">
          <div class="form-grid">
            <div class="field">
              <label for="p-markup">Opslag op kostprijs</label>
              <div class="input-affix">
                <input class="input num right" id="p-markup" type="number" min="0" step="1"
                       inputmode="decimal" [ngModel]="draft().markupPct"
                       (ngModelChange)="patch({ markupPct: +$event })" />
                <span class="input-affix__suffix">%</span>
              </div>
            </div>
            <div class="field">
              <label for="p-price">Vaste verkoopprijs <span class="opt"></span></label>
              <div class="input-affix">
                <!-- The landed cost sits in the box as placeholder: the number
                     you price against belongs where your eyes already are. -->
                <input class="input num right" id="p-price" type="number" min="0" step="0.01"
                       inputmode="decimal" [ngModel]="draft().fixedSalesPriceEur"
                       [placeholder]="draft().landedCostEur
                         ? 'kostprijs ' + (draft().landedCostEur | eur: 2) : ''"
                       (ngModelChange)="patch({ fixedSalesPriceEur: num($event) })" />
                <span class="input-affix__suffix">EUR</span>
              </div>
              @if (draft().landedCostEur; as landed) {
                @if (draft().fixedSalesPriceEur; as fixed) {
                  <span class="hint"
                        [class.warn-text]="fixed < landed">
                    Kostprijs incl. rechten {{ landed | eur: 2 }} —
                    @if (fixed < landed) {
                      deze prijs ligt <b>onder kostprijs</b>
                    } @else {
                      marge {{ fixed - landed | eur: 2 }}
                      ({{ (fixed - landed) / landed * 100 | num }} %)
                    }
                  </span>
                } @else {
                  <span class="hint">
                    Kostprijs incl. rechten {{ landed | eur: 2 }} · leeg = kostprijs + opslag
                  </span>
                }
              } @else {
                <span class="hint">Leeg = kostprijs + opslag</span>
              }
            </div>
          </div>
          <div class="stat-row stat-row--muted">
            <span>Voorraad</span>
            <span class="num">{{ draft().stockQuantity | num }} stuks</span>
          </div>
          <div class="stat-row stat-row--total">
            <span>Catalogusprijs</span>
            <span class="num">{{ salesPrice() | eur }}</span>
          </div>
          @if (privacy.showPurchase()) {
            <div class="stat-row stat-row--muted">
              <span>Brutomarge per stuk</span>
              <span class="num">
                {{ salesPrice() - (draft().landedCostEur ?? 0) | eur }} ·
                {{ realisedMargin() | pct: 1 }}
              </span>
            </div>
          }
        </div>
      </div>

      <button class="btn btn--primary btn--block mt-16" type="button" [disabled]="saving()"
              (click)="save()">{{ isNew() ? 'Product aanmaken' : 'Wijzigingen opslaan' }}</button>
      @if (!isNew()) {
        <button class="btn btn--block mt-8" type="button" (click)="startCopy()">
          Kopiëren naar een andere kleur
        </button>
        <button class="btn btn--danger btn--block mt-8" type="button" (click)="remove()">
          Product verwijderen
        </button>
      }

      @if (copying()) {
        <app-sheet title="Product kopiëren" (closed)="copying.set(false)">
          <div body>
            <p class="small muted" style="margin-bottom:14px">
              Maakt een nieuw product met dezelfde maten, prijzen en verpakking. Foto's en
              barcodes gaan <b>niet</b> mee: die verschillen per kleur, en twee artikelen met
              dezelfde EAN geeft in het magazijn van je klant een probleem dat niemand meteen
              ziet.
            </p>
            <div class="field">
              <label class="req" for="copy-colour">Kleur van de kopie</label>
              <input class="input" id="copy-colour" [ngModel]="copyColour()"
                     (ngModelChange)="copyColour.set($event)" list="colourList"
                     placeholder="Roze" />
            </div>
          </div>
          <div foot style="display:contents">
            <button class="btn" type="button" (click)="copying.set(false)">Annuleren</button>
            <button class="btn btn--primary" type="button" [disabled]="saving()"
                    (click)="copy()">Kopie maken</button>
          </div>
        </app-sheet>
      }
    </div>
  `,
})
export class ProductEditor {
  private readonly catalog = inject(CatalogApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly router = inject(Router);
  private readonly ui = inject(Ui);
  readonly privacy = inject(Privacy);

  readonly id = input<string>('');
  readonly supplier = input<string>('');
  readonly returnTo = input<string>('');

  readonly standardColours = STANDARD_COLOURS;
  /** True while a colour outside the standard list is being typed. */
  readonly customColour = signal(false);

  /** What the select should show for the current draft colour. */
  colourChoice(): string {
    if (this.customColour()) return '__other__';
    const colour = this.draft().colour ?? '';
    if (!colour) return '';
    return (this.standardColours as readonly string[]).includes(colour) ? colour : '__other__';
  }

  pickColour(choice: string): void {
    if (choice === '__other__') {
      /* Keep whatever was there; the free-entry field takes over. */
      this.customColour.set(true);
      return;
    }
    this.customColour.set(false);
    this.patch({ colour: choice });
  }

  readonly draft = signal<Product>(blankProduct(null, 'USD'));
  readonly suppliers = signal<Supplier[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly hsCodes = signal<HsCode[]>([]);
  readonly saving = signal(false);
  readonly copying = signal(false);
  readonly copyColour = signal('');
  readonly innerCheck = signal<{ valid: boolean; message: string } | null>(null);
  readonly outerCheck = signal<{ valid: boolean; message: string } | null>(null);

  constructor() {
    void this.loadReference();
    effect(() => {
      const routeId = this.id();
      if (routeId && routeId !== 'new') {
        void this.catalog.product(+routeId).then((product) => this.draft.set(product));
      }
    });
  }

  private async loadReference(): Promise<void> {
    const [suppliers, categories, hsCodes] = await Promise.all([
      this.sourcing.suppliers(), this.catalog.categories(), this.catalog.hsCodes(),
    ]);
    this.suppliers.set(suppliers);
    this.categories.set(categories);
    this.hsCodes.set(hsCodes);

    if (!this.id() || this.id() === 'new') {
      const supplierId = this.supplier() ? +this.supplier() : (suppliers[0]?.id ?? null);
      const currency = suppliers.find((s) => s.id === supplierId)?.currency ?? 'USD';
      this.draft.set(blankProduct(supplierId, currency));
    }
  }

  readonly isNew = computed(() => this.draft().id === null);

  readonly cartonCbm = computed(() => {
    const c = this.draft().carton;
    return ((c.lengthCm ?? 0) * (c.widthCm ?? 0) * (c.heightCm ?? 0)) / 1_000_000;
  });
  readonly pieceCbm = computed(() =>
    this.cartonCbm() / Math.max(1, this.draft().carton.piecesPerCarton ?? 1));

  readonly salesPrice = computed(() => {
    const product = this.draft();
    if (product.fixedSalesPriceEur) return product.fixedSalesPriceEur;
    const cost = product.landedCostEur ?? 0;
    return Math.round(cost * (1 + (product.markupPct ?? 0) / 100) * 100) / 100;
  });

  readonly realisedMargin = computed(() => {
    const price = this.salesPrice();
    const cost = this.draft().landedCostEur ?? 0;
    return price > 0 ? ((price - cost) / price) * 100 : 0;
  });

  num(value: unknown): number | null {
    if (value === null || value === '' || value === undefined) return null;
    return Number(value);
  }

  patch(changes: Partial<Product>): void {
    this.draft.update((product) => ({ ...product, ...changes }));
  }

  patchDimensions(changes: Partial<Product['dimensions']>): void {
    this.draft.update((p) => ({ ...p, dimensions: { ...p.dimensions, ...changes } }));
  }

  patchCarton(changes: Partial<Product['carton']>): void {
    this.draft.update((p) => ({ ...p, carton: { ...p.carton, ...changes } }));
  }

  setSupplier(supplierId: number): void {
    const supplier = this.suppliers().find((s) => s.id === supplierId);
    if (this.isNew() && supplier) {
      this.patch({ supplierId, exwCurrency: supplier.currency });
    } else {
      this.patch({ supplierId });
    }
  }

  /** Laat de server het controlecijfer nakijken — één plek waar die regel staat. */
  async check(value: string, which: 'inner' | 'outer'): Promise<void> {
    const target = which === 'inner' ? this.innerCheck : this.outerCheck;
    if (!value) { target.set(null); return; }
    target.set(await this.catalog.checkBarcode(value));
  }

  startCopy(): void {
    this.copyColour.set('');
    this.copying.set(true);
  }

  /** Maakt de kopie en springt er meteen naartoe, klaar om aan te passen. */
  async copy(): Promise<void> {
    const source = this.draft();
    if (!this.copyColour().trim()) {
      this.ui.toast('Vul een kleur in', 'err');
      return;
    }
    this.saving.set(true);
    try {
      const copy = await this.catalog.duplicateProduct(source.id!, this.copyColour().trim());
      this.copying.set(false);
      this.ui.toast(`${copy.sku} aangemaakt — vul de barcodes en foto's nog aan`);
      await this.router.navigate(['/products', copy.id]);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Kopiëren mislukt'), 'err');
    } finally {
      this.saving.set(false);
    }
  }

  async save(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    try {
      const product = this.draft();
      const saved = product.id === null
        ? await this.catalog.createProduct(product)
        : await this.catalog.updateProduct(product.id, product);
      this.draft.set(saved);
      this.ui.toast(product.id === null ? 'Product aangemaakt' : 'Opgeslagen');
      const back = this.returnTo();
      await this.router.navigateByUrl(back || `/products/${saved.id}`);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Opslaan mislukt'), 'err');
    } finally {
      this.saving.set(false);
    }
  }

  remove(): void {
    const product = this.draft();
    this.ui.confirm(
      {
        title: 'Product verwijderen',
        message: `<b>${product.name}</b> verwijderen? Regels op orders verdwijnen mee.`,
        confirmLabel: 'Verwijderen', danger: true,
      },
      async () => {
        await this.catalog.deleteProduct(product.id!);
        this.ui.toast('Product verwijderd');
        await this.router.navigate(['/products']);
      },
    );
  }
}
