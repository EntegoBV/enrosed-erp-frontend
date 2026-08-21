import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { Location } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import {
  Category,
  Currency,
  HsCode,
  Product,
  ProductFamily,
  ProductFamilyText,
  Supplier,
} from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { PhotoManager } from '../../shared/photo-manager';
import { Privacy } from '../../core/api/privacy';
import { escapeHtml, Sheet, Ui } from '../../shared/ui';
import { CbmPipe, EurPipe, NumPipe } from '../../shared/pipes';
import { messageOf } from '../../core/api/errors';
import { STANDARD_COLOURS } from '../../core/api/geo';
import { ProductPublicationEditor } from './product-publication-editor';
import { ProductFamilyImageVariantChange } from './product-family-gallery';

function blankProduct(supplierId: number | null, currency: Currency): Product {
  return {
    id: null, familyId: null, canonicalVariantKey: null, canonicalBarcode: null,
    variantPosition: 0,
    inventoryKnown: true, sku: null, name: '',
    dimensions: { lengthCm: null, widthCm: null, heightCm: null },
    colour: null, colourHex: null, variantSize: null,
    description: null, categoryId: null, supplierId, active: true,
    familyKey: null, publicHandle: null, websiteStatus: 'DRAFT', orderAppStatus: 'DRAFT',
    barcodeInner: '', barcodeOuter: '', hsCode: '',
    carton: { lengthCm: null, widthCm: null, heightCm: null, piecesPerCarton: 1, weightKg: null },
    exwPrice: 0, exwCurrency: currency, extraUnitCost: 0,
    landedCostEur: null, landedCostSource: null,
    markupPct: 45, fixedSalesPriceEur: null,
    computedSalesPriceEur: 0,
    stockQuantity: 0,
    photos: [],
    texts: [], publicationIssues: [],
  };
}

@Component({
  selector: 'app-product-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, PageHeader, PhotoManager, ProductPublicationEditor, Sheet,
            EurPipe, NumPipe, CbmPipe],
  template: `
    <app-page-header
      [title]="isNew() ? 'Nieuw product' : draft().name || 'Product'"
      [subtitle]="isNew() ? 'Aan een leverancier koppelen' : (draft().sku ?? '')"
      [showBack]="true"
      [showBell]="false"
    >
      <button class="btn btn--primary btn--sm" type="button"
              [disabled]="saving() || photoUploading()"
              (click)="save()">{{ saving() ? 'Bezig…' : 'Opslaan' }}</button>
    </app-page-header>

    <div class="content product-editor-page">
      <div class="editor-canvas">
      <!-- ============================================ product -->
      <section class="card editor-section" id="identity" aria-labelledby="identity-title">
        <div class="card__head section-head">
          <span class="section-head__number">01</span>
          <div><h2 id="identity-title">Basisgegevens</h2><p>Herkenning en klantgerichte informatie</p></div>
        </div>
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
              <label class="req" for="p-name">Productnaam intern</label>
              <input class="input" id="p-name" [ngModel]="draft().name"
                     (ngModelChange)="patch({ name: $event })" />
              <span class="hint">Voor verkoop, inkoop en magazijn. De publieke naam staat onder Website &amp; publicatie.</span>
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
            <fieldset class="measure-group variant-fields span-2">
              <legend>Uitvoering <span class="opt"></span></legend>
              <div class="form-grid">
                <div class="field">
                  <label for="p-colour">Kleur <span class="opt"></span></label>
                  <div class="colour-control">
                    <select class="select" id="p-colour" [ngModel]="colourChoice()"
                            (ngModelChange)="pickColour($event)">
                      <option value="">Geen kleur</option>
                      @for (option of standardColours; track option) {
                        <option [value]="option">{{ option }}</option>
                      }
                      <option value="__other__">Anders…</option>
                    </select>
                    <label class="colour-swatch-picker" title="Optionele exacte kleurstaal">
                      <input class="sr-only" type="color"
                             [value]="pickerColour(draft().colourHex)"
                             (input)="setProductColourHex($event)" />
                      @if (draft().colourHex) {
                        <i [style.backgroundColor]="draft().colourHex" aria-hidden="true"></i>
                        <span>{{ draft().colourHex }}</span>
                      } @else {
                        <span>+ Staal</span>
                      }
                    </label>
                    @if (draft().colourHex) {
                      <button class="btn btn--sm" type="button" title="Kleurstaal wissen"
                              style="width:38px;padding:0"
                              aria-label="Kleurstaal wissen" (click)="patch({ colourHex: null })">×</button>
                    }
                  </div>
                  @if (customColour() || colourChoice() === '__other__') {
                    <input class="input mt-8" aria-label="Eigen kleur"
                           placeholder="Eigen kleur…" [ngModel]="draft().colour"
                           (ngModelChange)="setProductColour($event)" />
                  }
                </div>
                <div class="field">
                  <label for="p-variant-size">Maat <span class="opt"></span></label>
                  <input class="input" id="p-variant-size" maxlength="80"
                         placeholder="Bijv. S, XL of 30 cm"
                         [ngModel]="draft().variantSize"
                         (ngModelChange)="patch({ variantSize: emptyToNull($event) })" />
                </div>
              </div>
              <p>
                Een product blijft standaard zelfstandig. Vul kleur of maat alleen in als dat
                nuttig is voor de keuze tussen varianten.
              </p>
            </fieldset>
            <div class="model-link span-2">
              <div>
                <span>Model &amp; varianten</span>
                <b>{{ family()?.name || draft().name || 'Nieuw product' }}</b>
                <small>
                  @if (family(); as model) {
                    {{ model.members.length || model.variantCount }} gekoppelde producten ·
                    ieder behoudt eigen voorraad, prijs en verpakking.
                  } @else if (isNew()) {
                    Sla eerst op; daarna kun je een bestaand product op kleur of maat koppelen.
                  } @else {
                    Dit product staat nog los. Koppel vanuit het productoverzicht een andere kleur of maat.
                  }
                </small>
              </div>
              @if (!isNew()) {
                <a class="btn btn--sm" [routerLink]="['/products', draft().id]">
                  Varianten beheren
                </a>
              }
            </div>
            <div class="field span-2">
              <label for="p-description">Omschrijving op offerte <span class="opt"></span></label>
              <textarea class="textarea" id="p-description" rows="3"
                        placeholder="Korte omschrijving voor verkoopdocumenten"
                        [ngModel]="draft().description"
                        (ngModelChange)="patch({ description: $event })"></textarea>
              <span class="hint">Producttekst voor offertes. Websitecopy staat apart onder Website &amp; publicatie.</span>
            </div>
            <label class="switch-row span-2" for="p-active">
              <span>
                <b>Actief product</b>
                <small>Beschikbaar voor verkoop, inkoop en de interne productkiezer.</small>
              </span>
              <input id="p-active" type="checkbox" [ngModel]="draft().active"
                     (ngModelChange)="patch({ active: $event })" />
            </label>
          </div>

          <fieldset class="measure-group">
            <legend>Productafmeting</legend>
            <div class="measure-grid">
              <label class="measure-field">
                <span>Breedte</span>
                <span class="measure-field__control">
                  <input class="input num right" type="number" step="0.1" min="0" inputmode="decimal"
                         [ngModel]="draft().dimensions.lengthCm"
                         (ngModelChange)="patchDimensions({ lengthCm: num($event) })" />
                  <small>cm</small>
                </span>
              </label>
              <label class="measure-field">
                <span>Diepte</span>
                <span class="measure-field__control">
                  <input class="input num right" type="number" step="0.1" min="0" inputmode="decimal"
                         [ngModel]="draft().dimensions.widthCm"
                         (ngModelChange)="patchDimensions({ widthCm: num($event) })" />
                  <small>cm</small>
                </span>
              </label>
              <label class="measure-field">
                <span>Hoogte</span>
                <span class="measure-field__control">
                  <input class="input num right" type="number" step="0.1" min="0" inputmode="decimal"
                         [ngModel]="draft().dimensions.heightCm"
                         (ngModelChange)="patchDimensions({ heightCm: num($event) })" />
                  <small>cm</small>
                </span>
              </label>
            </div>
            <p>Het artikel zelf, zonder de omdoos.</p>
          </fieldset>

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
      </section>

      <!-- ============================================ foto's -->
      <section class="card editor-section" id="media" aria-labelledby="media-title">
        <div class="card__head section-head">
          <span class="section-head__number">02</span>
          <div><h2 id="media-title">Foto's</h2><p>Voor dit product · ERP en orderregels</p></div>
          <span class="spacer"></span>
          <span class="badge badge--neutral">{{ photoCount() }}</span>
        </div>
        <div class="card__body photo-workspace">
          <app-photo-manager
            [productId]="draft().id"
            [photos]="draft().photos"
            [disabled]="saving()"
            (changed)="onPhotosChanged($event)"
          />
        </div>
      </section>

      <!-- ============================================ verpakking -->
      <section class="card editor-section" id="packaging" aria-labelledby="packaging-title">
        <div class="card__head section-head">
          <span class="section-head__number">03</span>
          <div><h2 id="packaging-title">Omdoos</h2><p>Voor bestelling, volume en logistiek</p></div>
        </div>
        <div class="card__body">
          <fieldset class="measure-group">
            <legend>Kartonafmeting</legend>
            <div class="measure-grid">
              <label class="measure-field">
                <span>Breedte</span>
                <span class="measure-field__control">
                  <input class="input num right" type="number" step="0.1" min="0" inputmode="decimal"
                         [ngModel]="draft().carton.lengthCm"
                         (ngModelChange)="patchCarton({ lengthCm: num($event) })" />
                  <small>cm</small>
                </span>
              </label>
              <label class="measure-field">
                <span>Diepte</span>
                <span class="measure-field__control">
                  <input class="input num right" type="number" step="0.1" min="0" inputmode="decimal"
                         [ngModel]="draft().carton.widthCm"
                         (ngModelChange)="patchCarton({ widthCm: num($event) })" />
                  <small>cm</small>
                </span>
              </label>
              <label class="measure-field">
                <span>Hoogte</span>
                <span class="measure-field__control">
                  <input class="input num right" type="number" step="0.1" min="0" inputmode="decimal"
                         [ngModel]="draft().carton.heightCm"
                         (ngModelChange)="patchCarton({ heightCm: num($event) })" />
                  <small>cm</small>
                </span>
              </label>
            </div>
          </fieldset>
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
      </section>

      <!-- ======================================== purchasing -->
      @if (privacy.showPurchase()) {
      <section class="card editor-section" id="purchasing" aria-labelledby="purchasing-title">
        <div class="card__head section-head">
          <span class="section-head__number">04</span>
          <div><h2 id="purchasing-title">Inkoop</h2><p>Interne kostgegevens en douane</p></div>
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
      </section>

      }

      <!-- ============================================= sales -->
      <section class="card editor-section" id="sales" aria-labelledby="sales-title">
        <div class="card__head section-head">
          <span class="section-head__number">{{ privacy.showPurchase() ? '05' : '04' }}</span>
          <div><h2 id="sales-title">Verkoop</h2><p>Prijsstrategie voor alle kanalen</p></div>
        </div>
        <div class="card__body">
          <fieldset class="price-method">
            <legend>Hoe wil je de verkoopprijs bepalen?</legend>
            <div class="price-method__options" role="group" aria-label="Prijsstrategie">
              <button type="button"
                      [class.price-method__active]="priceStrategy() === 'MARKUP'"
                      [attr.aria-pressed]="priceStrategy() === 'MARKUP'"
                      (click)="setPriceStrategy('MARKUP')">
                <b>Kostprijs + opslag</b>
                <small>Beweegt mee met je kostprijs</small>
              </button>
              <button type="button"
                      [class.price-method__active]="priceStrategy() === 'FIXED'"
                      [attr.aria-pressed]="priceStrategy() === 'FIXED'"
                      (click)="setPriceStrategy('FIXED')">
                <b>Vaste verkoopprijs</b>
                <small>Blijft hetzelfde bedrag</small>
              </button>
            </div>
          </fieldset>

          @if (priceStrategy() === 'MARKUP') {
            <div class="field">
              <label for="p-markup">Opslag op kostprijs</label>
              <div class="input-affix">
                <input class="input num right" id="p-markup" type="number" min="0" step="1"
                       inputmode="decimal" [ngModel]="draft().markupPct"
                       (ngModelChange)="setMarkup($event)" />
                <span class="input-affix__suffix">%</span>
              </div>
              <span class="hint">De verkoopprijs wordt opnieuw berekend als de kostprijs wijzigt.</span>
            </div>
          } @else {
            <div class="field">
              <label class="req" for="p-price">Vaste verkoopprijs per stuk</label>
              <div class="input-affix">
                <input class="input num right" id="p-price" type="number" min="0" step="0.01"
                       inputmode="decimal" [ngModel]="draft().fixedSalesPriceEur"
                       [placeholder]="draft().landedCostEur
                         ? 'kostprijs ' + (draft().landedCostEur | eur: 2) : ''"
                       (ngModelChange)="setFixedSalesPrice($event)" />
                <span class="input-affix__suffix">EUR</span>
              </div>
              @if ((draft().fixedSalesPriceEur ?? 0) <= 0) {
                <span class="hint danger-text">Vul een bedrag hoger dan € 0 in.</span>
              } @else if (draft().landedCostEur; as landed) {
                @if (draft().fixedSalesPriceEur; as fixed) {
                  <span class="hint"
                        [class.warn-text]="fixed < landed">
                    Kostprijs incl. rechten {{ landed | eur: 2 }} —
                    @if (fixed < landed) {
                      deze prijs ligt <b>onder kostprijs</b>
                    } @else {
                      marge {{ fixed - landed | eur: 2 }} per stuk
                    }
                  </span>
                } @else {
                  <span class="hint">Kostprijs incl. rechten {{ landed | eur: 2 }}</span>
                }
              } @else {
                <span class="hint">Dit bedrag blijft gelijk als je kostprijs later verandert.</span>
              }
            </div>
          }
          <div class="price-preview">
            <div>
              <span class="price-preview__label">Catalogusprijs</span>
              <strong class="num">{{ salesPrice() | eur }}</strong>
              <small>{{ priceStrategy() === 'FIXED' ? 'Vaste prijs' : 'Kostprijs + opslag' }}</small>
            </div>
            <div class="price-preview__meta">
              <span>
                Voorraad
                @if (draft().inventoryKnown) {
                  <b class="num">{{ draft().stockQuantity | num }}</b>
                } @else {
                  <b>onbekend</b>
                }
              </span>
              @if (privacy.showPurchase()) {
                <span>Marge per stuk <b class="num">{{ unitMargin() | eur }}</b></span>
              }
            </div>
          </div>
        </div>
      </section>

      <!-- Public content stays available without crowding daily ERP fields. -->
      <app-product-publication-editor
        [product]="draft()"
        [family]="family()"
        [categories]="categories()"
        [busy]="saving() || photoUploading()"
        [familyLoading]="familyLoading()"
        [familyLoadError]="familyLoadError()"
        (familyChange)="onFamilyChange($event)"
        (createFamilyRequested)="startNewFamily()"
        (retryFamilyRequested)="retryFamily()"
        (imageUploadRequested)="uploadFamilyImage($event)"
        (imageDeleteRequested)="removeFamilyImage($event)"
        (imageVariantChangeRequested)="linkFamilyImageVariant($event)"
      />

      <div class="editor-actions">
        <button class="btn btn--primary btn--block" type="button"
                [disabled]="saving() || photoUploading()" (click)="save()">
          {{ isNew() && photoCount() ? "Product met foto's aanmaken" :
             (isNew() ? 'Product aanmaken' : 'Wijzigingen opslaan') }}
        </button>
        @if (!isNew()) {
          <button class="btn btn--block" type="button"
                  [disabled]="saving() || photoUploading()" (click)="startCopy()">
            Kopiëren als variant
          </button>
          <details class="danger-zone">
            <summary>Geavanceerde acties</summary>
            <div>
              <p>Staat dit product al op een order of offerte? Zet het dan inactief; gebruikte producten kunnen niet worden verwijderd.</p>
              <button class="btn btn--danger btn--block" type="button"
                      [disabled]="saving() || photoUploading()" (click)="remove()">
                Product definitief verwijderen
              </button>
            </div>
          </details>
        }
      </div>

      @if (copying()) {
        <app-sheet title="Nieuwe variant" (closed)="closeCopySheet()">
          <div body class="variant-copy">
            <section class="variant-copy__source" aria-label="Bronproduct">
              <span class="variant-copy__eyebrow">Kopie van · laatst opgeslagen</span>
              <strong>{{ copySource().name }}</strong>
              <div>
                @if (copySource().sku) { <span class="mono">{{ copySource().sku }}</span> }
                <span>{{ copySource().colour || 'Geen kleur' }}</span>
                @if (copySource().variantSize) { <span>{{ copySource().variantSize }}</span> }
              </div>
              <small>
                @if (copySource().familyId) {
                  Model {{ family()?.name || copySource().name }}
                } @else {
                  Nog niet aan een model gekoppeld
                }
              </small>
            </section>

            <p class="variant-copy__explanation">
              Productafmetingen, verpakking en prijzen gaan mee. De nieuwe variant start met
              <b>0 voorraad</b>; foto's, barcodes en publicatiestatussen gaan niet mee.
            </p>

            @if (copyVariantLoading()) {
              <div class="small muted" role="status">
                Bestaande varianten controleren…
              </div>
            } @else if (copyVariantCheckFailed()) {
              <div class="alert alert--danger" role="alert">
                <span>Controle van bestaande varianten lukte niet.</span>
                <button class="btn btn--sm" type="button" (click)="loadCopyVariants()">
                  Opnieuw proberen
                </button>
              </div>
            } @else if (copyVariants().length) {
              <div class="variant-copy__existing">
                <span class="tiny muted">Bestaat al in dit model</span>
                <div>
                  @for (variant of copyVariants(); track variant.id) {
                    <span class="badge badge--neutral variant-chip">
                      {{ variant.colour || 'Geen kleur' }}
                      @if (variant.variantSize) { <span>· {{ variant.variantSize }}</span> }
                      @if (variant.sku) { <small class="mono">{{ variant.sku }}</small> }
                    </span>
                  }
                </div>
              </div>
            }

            <div class="variant-copy__options">
            <div class="field variant-copy__field">
              <label for="copy-colour">Kleur <span class="opt"></span></label>
              <select class="select" id="copy-colour" data-initial-focus
                      [ngModel]="copyColourChoice()"
                      (ngModelChange)="pickCopyColour($event)"
                      [attr.aria-invalid]="copyVariantConflict() ? 'true' : null"
                      aria-describedby="copy-variant-help">
                <option value="">Geen kleur</option>
                @for (option of standardColours; track option) {
                  <option [value]="option">{{ option }}</option>
                }
                <option value="__other__">Andere kleur invoeren…</option>
              </select>
              @if (copyCustomColour()) {
                <input class="input" aria-label="Andere kleur voor de nieuwe variant"
                       placeholder="Bijv. Terracotta" maxlength="80" autocomplete="off"
                       [ngModel]="copyColour()"
                       (ngModelChange)="setCopyColour($event)" />
              }
              <div style="display:flex;gap:6px">
                <label class="colour-swatch-picker" title="Optionele exacte kleurstaal">
                  <input class="sr-only" type="color"
                         [value]="pickerColour(copyColourHex())"
                         (input)="setCopyColourHex($event)" />
                  @if (copyColourHex()) {
                    <i [style.backgroundColor]="copyColourHex()" aria-hidden="true"></i>
                    <span>{{ copyColourHex() }}</span>
                  } @else {
                    <span>+ Kleurstaal</span>
                  }
                </label>
                @if (copyColourHex()) {
                  <button class="btn btn--sm" type="button" aria-label="Kleurstaal wissen"
                          style="width:38px;padding:0"
                          title="Kleurstaal wissen" (click)="copyColourHex.set(null)">×</button>
                }
              </div>
            </div>

            <div class="field variant-copy__field">
              <label for="copy-size">Maat <span class="opt"></span></label>
              <input class="input" id="copy-size" maxlength="80"
                     placeholder="Bijv. S, XL of 30 cm"
                     [ngModel]="copySize()" (ngModelChange)="copySize.set($event)"
                     [attr.aria-invalid]="copyVariantConflict() ? 'true' : null"
                     aria-describedby="copy-variant-help" />
            </div>
            </div>

            @if (copyVariantConflict(); as conflict) {
              <span class="hint danger-text" id="copy-variant-help">{{ conflict }}</span>
            } @else {
              <span class="hint" id="copy-variant-help">
                Pas kleur, maat of beide aan. Dezelfde kleur kan in meerdere maten bestaan.
              </span>
            }

            @if (!copySource().familyId) {
              <div class="alert alert--info variant-copy__family-note">
                <span class="alert__icon" aria-hidden="true">i</span>
                <p><b>Nog geen modelgroep</b><br />
                  De kopie wordt wel gemaakt. Koppel daarna één product aan het andere via
                  Product koppelen; de modelgroep wordt dan automatisch aangemaakt.</p>
              </div>
            }
          </div>
          <div foot style="display:contents">
            <button class="btn" type="button" [disabled]="saving()"
                    (click)="closeCopySheet()">Annuleren</button>
            <button class="btn btn--primary" type="button"
                    [disabled]="!canCopyVariant()" (click)="copy()">
              {{ saving() ? 'Variant maken…' : 'Variant maken' }}
            </button>
          </div>
        </app-sheet>
      }
      </div>
    </div>
  `,
  styles: `
    .product-editor-page { background: radial-gradient(circle at 50% 0, var(--rose-soft), transparent 260px); }
    .editor-canvas { width: 100%; max-width: 920px; margin: 0 auto; }

    .editor-section { scroll-margin-top: calc(var(--appbar-h) + 12px); }
    .editor-section + .editor-section { margin-top: 16px; }
    .section-head { min-height: 66px; padding: 12px 14px; }
    .section-head__number {
      display: grid; flex: 0 0 auto; width: 34px; height: 34px; place-items: center;
      border-radius: 11px; background: var(--rose-soft); color: var(--rose);
      font: 760 10px/1 var(--mono); letter-spacing: .04em;
    }
    .section-head h2 { font-size: 15px; line-height: 1.2; }
    .section-head p { margin-top: 2px; color: var(--muted); font-size: 11.5px; line-height: 1.35; }

    .measure-group {
      min-width: 0; margin: 2px 0 16px; padding: 12px; border: 1px solid var(--line);
      border-radius: var(--r-sm); background: var(--surface-2);
    }
    .measure-group legend { padding: 0 5px; color: var(--ink-2); font-size: 12.5px; font-weight: 650; }
    .measure-group > p { margin-top: 7px; color: var(--muted); font-size: 11.5px; }
    .model-link {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      margin-top: -4px; padding: 11px 12px; border: 1px solid var(--line);
      border-radius: var(--r-sm); background: var(--surface-2);
    }
    .model-link > div { display: grid; gap: 2px; min-width: 0; }
    .model-link span { color: var(--brand); font-size: 9.5px; font-weight: 750;
      letter-spacing: .06em; text-transform: uppercase; }
    .model-link b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
    .model-link small { color: var(--muted); font-size: 10.5px; line-height: 1.35; }
    .measure-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }
    .measure-field { min-width: 0; display: flex; flex-direction: column; gap: 4px; color: var(--muted);
      font-size: 10.5px; font-weight: 650; }
    .measure-field__control { min-width: 0; display: flex; align-items: stretch; }
    .measure-field__control .input { min-width: 0; padding: 10px 7px; border-radius: 10px 0 0 10px; }
    .measure-field__control small { display: grid; place-items: center; padding: 0 6px;
      border: 1px solid var(--line-strong); border-left: 0; border-radius: 0 10px 10px 0;
      background: var(--surface); color: var(--muted); font-size: 10px; font-weight: 650; }

    .switch-row { display: flex; align-items: center; justify-content: space-between; gap: 16px;
      min-height: 62px; padding: 2px; cursor: pointer; }
    .switch-row span { display: flex; flex-direction: column; }
    .switch-row small { margin-top: 2px; color: var(--muted); font-size: 12px; }
    .switch-row input { flex: 0 0 auto; width: 24px; height: 24px; accent-color: var(--rose); }
    .channel-grid { display: grid; gap: 8px; }
    .channel-card { display: flex; flex-direction: column; align-items: stretch; gap: 10px;
      padding: 13px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface-2); }
    .channel-card .select { width: 100%; }
    .readiness { padding: 13px 14px; border: 1px solid #eddcb9; border-radius: var(--r-sm);
      background: var(--warn-soft); }
    .readiness__head { display: flex; align-items: center; gap: 10px; }
    .readiness__head > span { display: grid; width: 24px; height: 24px; place-items: center;
      border-radius: 50%; background: var(--warn); color: white; font-weight: 800; }
    .readiness ul { margin: 10px 0 0; padding-left: 22px; color: var(--ink-2); font-size: 13px; }
    .readiness li + li { margin-top: 4px; }

    .price-preview {
      display: flex; align-items: flex-end; justify-content: space-between; gap: 14px;
      margin-top: 2px; padding: 15px; border-radius: var(--r-sm);
      background: linear-gradient(145deg, #211a17, #382923); color: #fff;
    }
    .price-preview > div:first-child { display: flex; flex-direction: column; }
    .price-preview__label { color: #c7bdb7; font-size: 9.5px; font-weight: 750;
      letter-spacing: .1em; text-transform: uppercase; }
    .price-preview strong { margin-top: 2px; font-size: 25px; line-height: 1.1; letter-spacing: -.025em; }
    .price-preview small { margin-top: 3px; color: #a99d96; font-size: 10.5px; }
    .price-preview__meta { display: flex; flex-direction: column; align-items: flex-end; gap: 3px;
      color: #c7bdb7; font-size: 11px; }
    .price-preview__meta b { color: #fff; }

    .price-method { min-width: 0; margin: 0 0 14px; padding: 0; border: 0; }
    .price-method legend { margin-bottom: 7px; font-weight: 650; }
    .price-method__options { display: grid; grid-template-columns: 1fr 1fr; gap: 6px;
      padding: 4px; border: 1px solid var(--line); border-radius: 13px; background: var(--surface-2); }
    .price-method button { min-width: 0; min-height: 58px; display: flex; flex-direction: column;
      justify-content: center; gap: 2px; padding: 8px 9px; border: 0; border-radius: 9px;
      background: transparent; color: var(--muted); text-align: left; cursor: pointer; }
    .price-method button small { font-size: 9.5px; line-height: 1.25; }
    .price-method .price-method__active { background: var(--surface); color: var(--ink);
      box-shadow: 0 1px 5px rgb(26 22 20 / 9%); }

    .editor-actions { display: grid; gap: 8px; margin-top: 16px; }
    .danger-zone { margin-top: 4px; border: 1px solid var(--line); border-radius: var(--r-sm);
      background: var(--surface); overflow: hidden; }
    .danger-zone summary { padding: 12px 14px; color: var(--muted); font-size: 12px;
      font-weight: 650; cursor: pointer; }
    .danger-zone > div { padding: 0 12px 12px; }
    .danger-zone p { margin-bottom: 10px; color: var(--muted); font-size: 11.5px; }

    .variant-copy { display: flex; flex-direction: column; gap: 15px; }
    .variant-copy__source {
      display: flex; flex-direction: column; gap: 5px; padding: 14px;
      border: 1px solid var(--rose-line); border-radius: var(--r-sm);
      background: color-mix(in srgb, var(--surface) 82%, var(--rose-soft));
    }
    .variant-copy__eyebrow { color: var(--rose); font-size: 9.5px; font-weight: 800;
      letter-spacing: .1em; text-transform: uppercase; }
    .variant-copy__source > strong { overflow-wrap: anywhere; font-size: 15px; line-height: 1.25; }
    .variant-copy__source > div { display: flex; flex-wrap: wrap; gap: 8px; color: var(--ink-2);
      font-size: 10.5px; }
    .variant-copy__source > small { color: var(--muted); font-size: 10.5px; }
    .variant-copy__explanation { color: var(--ink-2); font-size: 12.5px; line-height: 1.5; }
    .variant-copy__existing > span { display: block; margin-bottom: 7px; }
    .variant-copy__existing > div { display: flex; flex-wrap: wrap; gap: 5px; }
    .variant-chip { gap: 5px; }
    .variant-chip small { color: var(--muted); font-size: 9.5px; }
    .variant-copy__field { margin: 0; }
    .variant-copy__family-note p { color: var(--muted); font-size: 11px; line-height: 1.45; }
    .variant-copy__family-note b { color: var(--ink-2); }

    @media (min-width: 700px) {
      .section-head { padding-inline: 18px; }
      .editor-section .card__body { padding: 18px; }
      .measure-grid { gap: 10px; }
      .channel-grid { grid-template-columns: 1fr 1fr; }
      .channel-card { flex-direction: row; align-items: center; justify-content: space-between; }
      .channel-card .select { width: auto; min-width: 142px; }
      .editor-actions { grid-template-columns: 1fr 1fr; }
      .editor-actions .danger-zone { grid-column: 1 / -1; }
      .variant-copy__source { padding: 16px; }
    }
    @media (max-width: 520px) {
      .model-link { align-items: stretch; flex-direction: column; }
      .model-link .btn { align-self: flex-start; }
    }
  `,
})
export class ProductEditor {
  private readonly catalog = inject(CatalogApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
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
      const current = this.draft().colour ?? '';
      if ((this.standardColours as readonly string[]).includes(current)) {
        this.patch({ colour: '', colourHex: null });
      }
      this.customColour.set(true);
      return;
    }
    this.customColour.set(false);
    this.setProductColour(choice);
  }

  setProductColour(colour: string): void {
    const changed = this.normalizeColour(colour) !== this.normalizeColour(this.draft().colour);
    this.patch({ colour, ...(changed ? { colourHex: null } : {}) });
  }

  emptyToNull(value: string | null | undefined): string | null {
    return value?.trim() || null;
  }

  pickerColour(value: string | null | undefined): string {
    return /^#[0-9a-f]{6}$/i.test(value ?? '') ? value! : '#b01f3f';
  }

  setProductColourHex(event: Event): void {
    this.patch({ colourHex: this.colourFromPicker(event) });
  }

  readonly draft = signal<Product>(blankProduct(null, 'USD'));
  readonly suppliers = signal<Supplier[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly hsCodes = signal<HsCode[]>([]);
  readonly families = signal<ProductFamily[]>([]);
  readonly family = signal<ProductFamily | null>(null);
  readonly familyLoading = signal(false);
  readonly familyLoadError = signal(false);
  private readonly savedFamily = signal<ProductFamily | null>(null);
  private readonly savedProductFamilyId = signal<number | null>(null);
  readonly familyDirty = computed(() =>
    JSON.stringify(this.family()) !== JSON.stringify(this.savedFamily()));
  readonly saving = signal(false);
  readonly priceStrategy = signal<'MARKUP' | 'FIXED'>('MARKUP');
  private readonly priceTouched = signal(false);
  private readonly lastMarkupPct = signal(45);
  readonly copying = signal(false);
  readonly copyColour = signal('');
  readonly copyColourHex = signal<string | null>(null);
  readonly copySize = signal('');
  readonly copyCustomColour = signal(false);
  readonly copyProducts = signal<Product[]>([]);
  readonly copyVariantLoading = signal(false);
  readonly copyVariantCheckFailed = signal(false);
  readonly innerCheck = signal<{ valid: boolean; message: string } | null>(null);
  readonly outerCheck = signal<{ valid: boolean; message: string } | null>(null);
  readonly photoManager = viewChild(PhotoManager);
  readonly photoUploading = computed(() => this.photoManager()?.busy() ?? false);
  readonly photoCount = computed(() =>
    this.draft().photos.length + (this.photoManager()?.pendingCount() ?? 0));

  /** The duplicate endpoint copies the saved product, not unsaved form edits. */
  readonly copySource = computed(() =>
    this.copyProducts().find((product) => product.id === this.draft().id) ?? this.draft());

  readonly copyVariants = computed(() => {
    const source = this.copySource();
    const familyId = source.familyId ?? null;
    if (familyId === null) return [];
    return this.copyProducts().filter((product) =>
      product.id !== source.id
      && product.familyId === familyId);
  });

  readonly copyVariantConflict = computed(() => {
    const colour = this.copyColour().trim();
    const size = this.copySize().trim();
    const source = this.copySource();
    if (this.sameVariantCombination(colour, size, source)) {
      return 'Pas de kleur of maat aan ten opzichte van het bronproduct.';
    }
    const duplicate = this.copyVariants().find((variant) =>
      this.sameVariantCombination(colour, size, variant));
    if (duplicate) {
      const label = [colour || 'Geen kleur', size || 'Geen maat'].join(' · ');
      return `${label} bestaat al in dit model${duplicate.sku ? ` (${duplicate.sku})` : ''}.`;
    }
    return null;
  });

  readonly canCopyVariant = computed(() =>
    !this.saving()
    && !this.photoUploading()
    && !this.copyVariantLoading()
    && !this.copyVariantCheckFailed()
    && !this.copyVariantConflict());

  constructor() {
    void this.loadReference();
    void this.loadFamilies();
    effect(() => {
      const routeId = this.id();
      if (routeId && routeId !== 'new') {
        void this.catalog.product(+routeId).then((product) => {
          this.savedProductFamilyId.set(product.familyId ?? null);
          this.draft.set(product);
          this.syncPriceStrategy(product);
          void this.loadFamilyForProduct(product);
        });
      }
    });
  }

  private async loadFamilies(): Promise<void> {
    try {
      const families = await this.catalog.productFamilies();
      this.families.set(families);
      const product = this.draft();
      if (product.id !== null && this.family() === null) {
        await this.loadFamilyForProduct(product);
      }
    } catch {
      /* Product work remains usable while the family endpoint is unavailable. */
      this.families.set([]);
    }
  }

  private async loadFamilyForProduct(product: Product): Promise<void> {
    const familyId = product.familyId ?? null;
    if (familyId === null) {
      this.familyLoading.set(false);
      this.familyLoadError.set(false);
      this.setFamilyDraft(null);
      return;
    }
    this.familyLoading.set(true);
    this.familyLoadError.set(false);
    let family = familyId === null
      ? null
      : this.families().find((item) => item.id === familyId) ?? null;

    if (!family && familyId !== null) {
      try {
        family = await this.catalog.productFamily(familyId);
      } catch {
        family = null;
        this.familyLoadError.set(true);
      }
    }
    if (!this.familyLoadError()) this.setFamilyDraft(family);
    this.familyLoading.set(false);
  }

  retryFamily(): void {
    const product = this.draft();
    if (!this.familyLoading() && product.familyId !== null) void this.loadFamilyForProduct(product);
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
      this.savedProductFamilyId.set(null);
      this.priceStrategy.set('MARKUP');
      this.lastMarkupPct.set(45);
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
    if (product.id !== null && !this.priceTouched()) return product.computedSalesPriceEur;
    if (this.priceStrategy() === 'FIXED') return product.fixedSalesPriceEur ?? 0;
    const cost = product.landedCostEur ?? 0;
    return Math.round(cost * (1 + (product.markupPct ?? 0) / 100) * 100) / 100;
  });

  readonly unitMargin = computed(() =>
    Math.round((this.salesPrice() - (this.draft().landedCostEur ?? 0)) * 100) / 100);

  readonly readinessIssues = computed(() => {
    const family = this.family();
    const product = this.draft();
    const publicationStarted = family !== null
      || product.websiteStatus !== 'DRAFT'
      || product.orderAppStatus !== 'DRAFT';
    if (!publicationStarted) return [];
    const server = family?.publicationIssues ?? [];
    const issues: string[] = [...server];
    if (!product.active) issues.push('Zet het product actief.');
    if (!product.name.trim()) issues.push('Vul een productnaam in.');
    if (!product.categoryId) issues.push('Kies een categorie.');
    if (!family) {
      issues.push('Start gedeelde websitegegevens voor dit model.');
    } else {
      if (!family.name.trim()) issues.push('Vul de publieke modelnaam in.');
      if (!family.publicHandle.trim()) issues.push('Vul een stabiele publieke URL in.');
      if (!family.images.length) issues.push('Voeg minstens één publieke productfoto toe.');
    }
    if (this.salesPrice() <= 0) issues.push('Stel een verkoopprijs in.');
    if (!product.carton.piecesPerCarton || product.carton.piecesPerCarton < 1) {
      issues.push('Vul een geldige doosinhoud in.');
    }
    return [...new Set(issues)];
  });

  scrollToSection(id: string): void {
    const section = document.getElementById(id);
    if (section instanceof HTMLDetailsElement) section.open = true;
    section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

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

  onFamilyChange(family: ProductFamily): void {
    this.family.set(family);
    this.patch({
      familyId: family.id,
      familyKey: family.familyKey,
      ...this.variantPublicationFields(),
    });
  }

  startNewFamily(): void {
    const product = this.draft();
    const category = this.categories().find((item) => item.id === product.categoryId);
    const familyKey = this.slug(product.name) || 'nieuwe-productfamilie';
    const englishText: ProductFamilyText = {
      language: 'EN',
      name: product.name.trim() || null,
      summary: null,
      description: null,
      format: null,
      highlights: [],
      seoTitle: null,
      seoDescription: null,
    };
    const family: ProductFamily = {
      id: null,
      familyKey,
      publicHandle: familyKey,
      categoryId: product.categoryId,
      categoryKey: category?.code ?? null,
      categoryName: category?.name ?? null,
      categoryPosition: category?.position ?? 0,
      collectionKey: null,
      collections: [],
      productPosition: this.families().length,
      cardFeaturedProductId: null,
      tags: [],
      websiteStatus: 'DRAFT',
      orderAppStatus: 'DRAFT',
      catalogueStatus: 'DRAFT',
      active: true,
      name: product.name.trim(),
      summary: null,
      description: null,
      format: null,
      highlights: [],
      seoTitle: null,
      seoDescription: null,
      dimensions: null,
      texts: [englishText],
      packages: [],
      images: [],
      externalIdentifiers: [],
      priceObservations: [],
      provenance: [],
      conflicts: [],
      publicationIssues: [],
      members: [],
      variantCount: 1,
    };
    this.family.set(family);
    this.patch({
      familyId: null,
      familyKey: family.familyKey,
      ...this.variantPublicationFields(),
    });
    queueMicrotask(() => document.getElementById('publication')?.setAttribute('open', ''));
  }

  private setFamilyDraft(family: ProductFamily | null): void {
    const current = family ? structuredClone(family) : null;
    this.family.set(current);
    this.savedFamily.set(family ? structuredClone(family) : null);
  }

  async uploadFamilyImage(file: File): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    try {
      await this.persistFamilyDraft();
      const familyId = this.family()?.id;
      if (familyId === null || familyId === undefined) {
        throw new Error('Websitegegevens konden niet worden aangemaakt');
      }
      const saved = await this.catalog.uploadProductFamilyImage(
        familyId,
        file,
        this.currentFamilyMemberId(),
      );
      this.replaceFamily(saved);
      this.ui.toast('Websitefoto toegevoegd');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Websitefoto toevoegen mislukt'), 'err');
    } finally {
      this.saving.set(false);
    }
  }

  removeFamilyImage(imageId: number): void {
    const family = this.family();
    if (!family?.id || this.saving()) return;
    this.ui.confirm(
      {
        title: 'Websitefoto verwijderen',
        message: 'Deze foto uit de publieke galerij verwijderen?',
        confirmLabel: 'Verwijderen',
        danger: true,
      },
      async () => {
        this.saving.set(true);
        try {
          await this.persistFamilyDraft();
          const saved = await this.catalog.deleteProductFamilyImage(family.id!, imageId);
          this.replaceFamily(saved);
          this.ui.toast('Websitefoto verwijderd');
        } catch (failure: unknown) {
          this.ui.toast(messageOf(failure, 'Websitefoto verwijderen mislukt'), 'err');
        } finally {
          this.saving.set(false);
        }
      },
    );
  }

  async linkFamilyImageVariant(change: ProductFamilyImageVariantChange): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    try {
      await this.persistFamilyDraft();
      const familyId = this.family()?.id;
      if (familyId === null || familyId === undefined) {
        throw new Error('Sla de gedeelde websitegegevens eerst op');
      }
      const saved = await this.catalog.updateProductFamilyImageVariant(
        familyId,
        change.imageId,
        change.variantProductId,
      );
      this.replaceFamily(saved);
      this.ui.toast(change.variantProductId === null
        ? 'Foto geldt nu voor alle varianten'
        : 'Foto aan variant gekoppeld');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Foto koppelen aan variant mislukt'), 'err');
      const familyId = this.family()?.id;
      if (familyId !== null && familyId !== undefined) {
        try {
          this.replaceFamily(await this.catalog.productFamily(familyId));
        } catch {
          /* The save error above remains the useful feedback. */
        }
      }
    } finally {
      this.saving.set(false);
    }
  }

  private replaceFamily(family: ProductFamily): void {
    this.setFamilyDraft(family);
    this.families.update((families) => families.some((item) => item.id === family.id)
      ? families.map((item) => item.id === family.id ? family : item)
      : [...families, family]);
    this.patch({
      familyId: family.id,
      familyKey: family.familyKey,
      ...this.variantPublicationFields(),
    });
  }

  /** Never attach an upload to a SKU until the family projection confirms membership. */
  private currentFamilyMemberId(): number | null {
    const productId = this.draft().id;
    if (productId === null) return null;
    return this.family()?.members.some((member) => member.productId === productId)
      ? productId
      : null;
  }

  private slug(value: string): string {
    return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  setPriceStrategy(strategy: 'MARKUP' | 'FIXED'): void {
    if (strategy === this.priceStrategy()) return;
    this.priceTouched.set(true);

    const product = this.draft();
    if (strategy === 'FIXED') {
      const currentPrice = this.salesPrice();
      this.lastMarkupPct.set(product.markupPct ?? 0);
      this.priceStrategy.set('FIXED');
      this.patch({
        markupPct: 0,
        fixedSalesPriceEur: currentPrice > 0 ? currentPrice : null,
      });
      return;
    }

    const cost = product.landedCostEur ?? 0;
    const fixedPrice = product.fixedSalesPriceEur ?? 0;
    const equivalentMarkup = cost > 0 && fixedPrice >= cost
      ? Math.round(((fixedPrice / cost) - 1) * 10_000) / 100
      : this.lastMarkupPct();
    this.lastMarkupPct.set(equivalentMarkup);
    this.priceStrategy.set('MARKUP');
    this.patch({ markupPct: equivalentMarkup, fixedSalesPriceEur: null });
  }

  setMarkup(value: unknown): void {
    this.priceTouched.set(true);
    const markupPct = Math.max(0, this.num(value) ?? 0);
    this.lastMarkupPct.set(markupPct);
    this.patch({ markupPct, fixedSalesPriceEur: null });
  }

  setFixedSalesPrice(value: unknown): void {
    this.priceTouched.set(true);
    this.patch({ fixedSalesPriceEur: this.num(value), markupPct: 0 });
  }

  private syncPriceStrategy(product: Product): void {
    this.priceTouched.set(false);
    if (product.fixedSalesPriceEur !== null && product.fixedSalesPriceEur > 0) {
      this.priceStrategy.set('FIXED');
      if (product.markupPct !== 0) this.patch({ markupPct: 0 });
      return;
    }
    this.priceStrategy.set('MARKUP');
    this.lastMarkupPct.set(product.markupPct ?? 0);
    if (product.fixedSalesPriceEur !== null) this.patch({ fixedSalesPriceEur: null });
  }

  /** Photo endpoints return a full server product; keep concurrent form edits intact. */
  onPhotosChanged(serverProduct: Product): void {
    this.draft.update((current) => ({
      ...current,
      photos: serverProduct.photos,
      publicationIssues: serverProduct.publicationIssues,
      describedAs: serverProduct.describedAs,
      cartonCbm: serverProduct.cartonCbm,
      pieceCbm: serverProduct.pieceCbm,
    }));
  }

  setSupplier(supplierId: number): void {
    const supplier = this.suppliers().find((s) => s.id === supplierId);
    if (this.isNew() && supplier) {
      this.patch({ supplierId, exwCurrency: supplier.currency });
    } else {
      this.patch({ supplierId });
    }
  }

  /** Lets the server verify the check digit — one place where that rule lives. */
  async check(value: string, which: 'inner' | 'outer'): Promise<void> {
    const target = which === 'inner' ? this.innerCheck : this.outerCheck;
    if (!value) { target.set(null); return; }
    target.set(await this.catalog.checkBarcode(value));
  }

  copyColourChoice(): string {
    if (this.copyCustomColour()) return '__other__';
    return this.copyColour();
  }

  pickCopyColour(choice: string): void {
    if (choice === '__other__') {
      this.copyCustomColour.set(true);
      this.setCopyColour('');
      return;
    }
    this.copyCustomColour.set(false);
    this.setCopyColour(choice);
  }

  setCopyColour(colour: string): void {
    const changed = this.normalizeColour(colour) !== this.normalizeColour(this.copyColour());
    this.copyColour.set(colour);
    if (changed) this.copyColourHex.set(null);
  }

  setCopyColourHex(event: Event): void {
    this.copyColourHex.set(this.colourFromPicker(event));
  }

  startCopy(): void {
    if (this.photoUploading()) return;
    const source = this.draft();
    const colour = source.colour ?? '';
    this.copyColour.set(colour);
    this.copyColourHex.set(source.colourHex ?? null);
    this.copySize.set(source.variantSize ?? '');
    this.copyCustomColour.set(
      !!colour && !(this.standardColours as readonly string[]).includes(colour),
    );
    this.copyProducts.set([]);
    this.copyVariantCheckFailed.set(false);
    this.copying.set(true);
    void this.loadCopyVariants();
  }

  closeCopySheet(): void {
    if (!this.saving()) this.copying.set(false);
  }

  async loadCopyVariants(): Promise<void> {
    this.copyVariantLoading.set(true);
    this.copyVariantCheckFailed.set(false);
    try {
      this.copyProducts.set(await this.catalog.products());
    } catch {
      this.copyProducts.set([]);
      this.copyVariantCheckFailed.set(true);
    } finally {
      this.copyVariantLoading.set(false);
    }
  }

  /** Makes the copy and jumps straight to it, ready to adjust. */
  async copy(): Promise<void> {
    const source = this.draft();
    const conflict = this.copyVariantConflict();
    if (conflict) {
      this.ui.toast(conflict, 'err');
      return;
    }
    this.saving.set(true);
    try {
      const copy = await this.catalog.duplicateProduct(source.id!, {
        colour: this.copyColour().trim(),
        colourHex: this.copyColourHex() ?? '',
        variantSize: this.copySize().trim(),
      });
      this.copying.set(false);
      this.ui.toast(`${copy.sku} aangemaakt — vul de barcodes en foto's nog aan`);
      await this.router.navigate(['/products', copy.id, 'edit']);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Kopiëren mislukt'), 'err');
    } finally {
      this.saving.set(false);
    }
  }

  private normalizeColour(value: string | null | undefined): string {
    return (value ?? '').trim().toLocaleLowerCase('nl-BE');
  }

  private normalizeSize(value: string | null | undefined): string {
    return (value ?? '').trim().toLocaleLowerCase('nl-BE');
  }

  private sameVariantCombination(colour: string, size: string, product: Product): boolean {
    return this.normalizeColour(colour) === this.normalizeColour(product.colour)
      && this.normalizeSize(size) === this.normalizeSize(product.variantSize);
  }

  private colourFromPicker(event: Event): string {
    return (event.target as HTMLInputElement).value.toUpperCase();
  }

  async save(): Promise<void> {
    if (this.saving() || this.photoUploading()) return;
    if (this.priceStrategy() === 'FIXED'
        && (this.draft().fixedSalesPriceEur ?? 0) <= 0) {
      this.ui.toast('Vul een vaste verkoopprijs hoger dan € 0 in', 'err');
      this.scrollToSection('sales');
      return;
    }
    const wasNew = this.isNew();
    const queuedPhotoCount = this.photoManager()?.pendingCount() ?? 0;
    this.saving.set(true);
    try {
      await this.persistFamilyDraft();
      const product = this.draft();
      const photoManager = this.photoManager();
      const saved = product.id === null
        ? await this.createWithPendingPhotos(product, photoManager)
        : await this.updateWithPendingPhotos(product, photoManager);
      if (!saved) return;

      this.draft.set(saved);
      this.savedProductFamilyId.set(saved.familyId ?? null);
      this.ui.toast(wasNew
        ? (queuedPhotoCount ? 'Product met foto’s aangemaakt' : 'Product aangemaakt')
        : 'Opgeslagen');
      const back = this.returnTo();
      await this.router.navigateByUrl(back || `/products/${saved.id}`);
    } catch (failure: unknown) {
      const fallback = wasNew && this.draft().id !== null
        ? 'Product is aangemaakt, maar kon nog niet volledig worden afgewerkt'
        : 'Opslaan mislukt';
      this.ui.toast(messageOf(failure, fallback), 'err');
    } finally {
      this.saving.set(false);
    }
  }

  private async persistFamilyDraft(): Promise<void> {
    const desired = this.family();
    if (!desired || !this.familyDirty()) return;

    const previous = this.savedFamily();
    let saved = desired.id === null
      ? await this.catalog.createProductFamily(desired)
      : await this.catalog.updateProductFamily(desired.id, desired);

    if (saved.id !== null && desired.id !== null && previous?.id === desired.id) {
      const familyId = saved.id;
      const desiredImages = [...desired.images].sort((left, right) => left.position - right.position);
      const previousImages = [...previous.images].sort((left, right) => left.position - right.position);
      const desiredIds = desiredImages.map((image) => image.id);
      const previousIds = previousImages.map((image) => image.id);
      if (desiredIds.join(',') !== previousIds.join(',')) {
        saved = await this.catalog.reorderProductFamilyImages(familyId, desiredIds);
      }

      for (const image of desired.images) {
        const before = previous.images.find((item) => item.id === image.id);
        for (const alt of image.altTexts) {
          const oldAlt = before?.altTexts.find((item) => item.language === alt.language)?.alt ?? '';
          const nextAlt = alt.alt ?? '';
          if (oldAlt !== nextAlt) {
            saved = await this.catalog.updateProductFamilyImageAlt(
              familyId, image.id, alt.language, nextAlt);
          }
        }
      }
    }

    this.setFamilyDraft(saved);
    this.families.update((families) => {
      const index = families.findIndex((item) => item.id === saved.id);
      return index < 0
        ? [...families, saved]
        : families.map((item) => item.id === saved.id ? saved : item);
    });
    this.patch({
      familyId: saved.id,
      familyKey: saved.familyKey,
      ...this.variantPublicationFields(),
    });
  }

  /** Public handle and channel state belong to the family, never to one colour SKU. */
  private variantPublicationFields(): Pick<Product, 'publicHandle' | 'websiteStatus' | 'orderAppStatus'> {
    return { publicHandle: null, websiteStatus: 'DRAFT', orderAppStatus: 'DRAFT' };
  }

  private async createWithPendingPhotos(
    product: Product,
    photoManager: PhotoManager | undefined,
  ): Promise<Product | null> {
    /* Incoming photos are deliberately ignored by the product endpoint.
       A requested publish state must therefore wait until the queued files
       are uploaded to the newly assigned id. */
    const staged: Product = {
      ...product,
      websiteStatus: product.websiteStatus === 'PUBLISHED' ? 'DRAFT' : product.websiteStatus,
      orderAppStatus: product.orderAppStatus === 'PUBLISHED' ? 'DRAFT' : product.orderAppStatus,
    };
    const created = await this.catalog.createProduct(staged);
    this.savedProductFamilyId.set(created.familyId ?? null);
    this.draft.set({
      ...created,
      websiteStatus: product.websiteStatus,
      orderAppStatus: product.orderAppStatus,
    });
    if (created.id !== null) this.replaceNewProductUrl(created.id);

    if (created.id !== null && !await this.flushPendingPhotos(photoManager, created.id, true)) {
      return null;
    }

    const publicationWasStaged = staged.websiteStatus !== product.websiteStatus
      || staged.orderAppStatus !== product.orderAppStatus;
    if (!publicationWasStaged || created.id === null) return this.draft();

    return this.catalog.updateProduct(created.id, {
      ...product,
      id: created.id,
      sku: created.sku,
      familyId: null,
      photos: this.draft().photos,
    });
  }

  private async updateWithPendingPhotos(
    product: Product,
    photoManager: PhotoManager | undefined,
  ): Promise<Product | null> {
    if (product.id === null) return null;
    if (!await this.flushPendingPhotos(photoManager, product.id, false)) return null;
    const desiredFamilyId = product.familyId ?? null;
    const familyChanged = desiredFamilyId !== this.savedProductFamilyId();
    const movesToFamily = familyChanged && desiredFamilyId !== null;
    const updated = await this.catalog.updateProduct(product.id, {
      ...product,
      /* A non-null family move belongs in the same transaction as the product edits.
         Null on the ordinary PUT preserves the current family; unlink is explicit below. */
      familyId: movesToFamily ? desiredFamilyId : null,
    });
    if (!familyChanged || desiredFamilyId !== null) return updated;
    return this.catalog.assignProductFamily(product.id, null);
  }

  private async flushPendingPhotos(
    photoManager: PhotoManager | undefined,
    productId: number,
    newlyCreated: boolean,
  ): Promise<boolean> {
    if (!photoManager?.pendingCount()) return true;
    const uploads = await photoManager.uploadPending(productId, true);
    if (!uploads.remaining) return true;

    this.ui.toast(
      newlyCreated
        ? `Product aangemaakt; ${uploads.remaining} foto('s) wachten op opnieuw proberen`
        : `${uploads.remaining} foto('s) wachten nog; je wijzigingen zijn niet verloren`,
      'err',
    );
    return false;
  }

  /** Keep the assigned id on refresh without destroying the local photo queue. */
  private replaceNewProductUrl(productId: number): void {
    const currentUrl = this.location.path(true);
    const queryStart = currentUrl.indexOf('?');
    const query = queryStart < 0 ? '' : currentUrl.slice(queryStart + 1);
    this.location.replaceState(`/products/${productId}/edit`, query);
  }

  remove(): void {
    if (this.photoUploading()) return;
    const product = this.draft();
    this.ui.confirm(
      {
        title: 'Product verwijderen',
        message: `<b>${escapeHtml(product.name)}</b> verwijderen? Producten die al op een order staan, kunnen niet worden verwijderd; zet die inactief.`,
        confirmLabel: 'Verwijderen', danger: true,
      },
      async () => {
        try {
          await this.catalog.deleteProduct(product.id!);
          this.ui.toast('Product verwijderd');
          await this.router.navigate(['/products']);
        } catch (failure: unknown) {
          this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
        }
      },
    );
  }
}
