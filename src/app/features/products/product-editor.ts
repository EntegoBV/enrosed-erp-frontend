import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  HostListener,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild, untracked } from '@angular/core';
import { Location } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import { Category, Currency, HsCode, Product, ProductFamily, ProductFamilyText, ProductPublicTranslationsSnapshot, Supplier, LanguageCode, Dimensions, StockMovement, ProductStock } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { orderLikeTheList } from './catalogue-order';
import { PhotoManager } from '../../shared/photo-manager';
import { DecimalInput } from '../../shared/decimal-input';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { escapeHtml, Sheet, Ui } from '../../shared/ui';
import { CbmPipe, DateTimeNlPipe, EurPipe, NumPipe } from '../../shared/pipes';
import { messageOf } from '../../core/api/errors';
import { STANDARD_COLOURS, COLOUR_SWATCHES } from '../../core/api/geo';
import { ProductPublicationEditor } from './product-publication-editor';
import { ProductFamilyImageVariantChange } from './product-family-gallery';
import { ProductVariantGroup } from './product-variant-group';

function blankProduct(supplierId: number | null, currency: Currency): Product {
  return {
    id: null, familyId: null, canonicalVariantKey: null, canonicalBarcode: null,
    variantPosition: 0,
    inventoryKnown: true, sku: null, name: '',
    dimensions: { lengthCm: null, widthCm: null, heightCm: null, weightKg: null },
    packaging: { kind: 'NONE', dimensions: { lengthCm: null, widthCm: null, heightCm: null, weightKg: null }, barcode: null, piecesPerUnit: null },
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

/**
 * The default order of the catalogue list: category after category in the
 * categories' own order (no category last), names A-Z inside each. Stepping
 * through the editor then follows what the eye just saw in the list.
 */
@Component({
  selector: 'app-product-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, PageHeader, PhotoManager, ProductPublicationEditor,
    ProductVariantGroup, Sheet, EurPipe, NumPipe, CbmPipe, DateTimeNlPipe, DecimalInput, RouterLink,
  ],
  template: `
    <app-page-header
      [title]="isNew() ? 'Nieuw product' : draft().name || 'Product'"
      [subtitle]="isNew() ? 'Aan een leverancier koppelen' : (draft().sku ?? '')"
      [showBack]="true"
      [showBell]="false"
    >
      <!-- Desktop: step through the catalogue without going back to the
           list. The unsaved-changes guard still asks before leaving. -->
      @if (!isNew() && neighbours(); as around) {
        <span class="product-nav" role="group" aria-label="Vorig of volgend product">
          <a class="btn btn--sm product-nav__btn" [class.product-nav__btn--off]="!around.previous"
             [routerLink]="around.previous ? ['/products', around.previous.id, 'edit'] : null"
             [attr.aria-disabled]="!around.previous"
             [title]="around.previous ? 'Vorige: ' + around.previous.name : 'Dit is het eerste product'">‹</a>
          <small class="product-nav__pos">{{ around.index + 1 }}/{{ around.total }}</small>
          <a class="btn btn--sm product-nav__btn" [class.product-nav__btn--off]="!around.next"
             [routerLink]="around.next ? ['/products', around.next.id, 'edit'] : null"
             [attr.aria-disabled]="!around.next"
             [title]="around.next ? 'Volgende: ' + around.next.name : 'Dit is het laatste product'">›</a>
        </span>
      }
      <button class="btn btn--primary btn--sm" type="button"
              [disabled]="saving() || photoUploading() || translationSaving()"
              (click)="save()">{{ saving() ? 'Bezig…' : (photoUploading() ? 'Foto’s…' : (savedHere() ? 'Opnieuw opslaan' : 'Opslaan')) }}</button>
    </app-page-header>

    @if (productLoadError()) {
      <div class="content product-load-error" role="alert">
        <span><b>Product kon niet worden geladen</b><small>{{ productLoadError() }}</small></span>
        <button class="btn btn--sm" type="button" (click)="retryProductLoad()">Opnieuw proberen</button>
      </div>
    }

    <!-- Same rail as the settings page. Phone: one section at a time;
         desktop: a jump list whose highlight follows the scroll. -->
    <nav class="subnav" aria-label="Onderdelen">
      <div class="subnav__rail">
        @for (tab of visibleTabs(); track tab.id) {
          <button type="button" [class.active]="activeTab() === tab.id"
                  [attr.aria-current]="activeTab() === tab.id ? 'location' : null"
                  (click)="showTab(tab.id)">{{ tab.label }}</button>
        }
      </div>
    </nav>

    <div class="content product-editor-page">
      <div class="editor-canvas" [attr.data-tab]="activeTab()"
           [class.editor-canvas--last]="isLastPhoneTab()">
      <!-- ============================================ product -->
      <section class="card editor-section" id="identity" aria-labelledby="identity-title">
        <div class="card__head section-head">
          <h2 id="identity-title">Basisgegevens</h2>
          <span class="spacer"></span>
          <!-- Active/inactive sits in the section head: it is a status, not
               a field among the fields. -->
          <select class="select select--status" aria-label="Productstatus"
                  [class.select--status-off]="!draft().active"
                  [ngModel]="draft().active ? 'actief' : 'inactief'"
                  (ngModelChange)="patch({ active: $event === 'actief' })">
            <option value="actief">Actief</option>
            <option value="inactief">Inactief</option>
          </select>
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
            </div>
                <div class="field">
                  <label for="p-colour">Kleur <span class="opt"></span></label>
                  <!-- Compact: a dropdown with the current swatch dot in
                       front of it. Colours typed on other products join the
                       list; "Anders…" opens a name field. An exact sample is
                       picked on the dot and turns the colour into a custom
                       one on purpose - no clear button needed. -->
                  <div class="colour-control">
                    <select class="select" id="p-colour" [ngModel]="colourChoice()"
                            (ngModelChange)="pickColour($event)">
                      <option value="">Geen kleur</option>
                      @for (option of standardColours(); track option) {
                        <option [value]="option">{{ option }}</option>
                      }
                      <option value="__other__">Anders…</option>
                    </select>
                    <label class="colour-swatch-picker colour-dot" title="Exacte kleurstaal kiezen">
                      <input class="sr-only" type="color"
                             [value]="pickerColour(draft().colourHex || swatchFor(draft().colour || ''))"
                             (input)="setProductColourHex($event)" />
                      <i [style.backgroundColor]="draft().colour ? (draft().colourHex || swatchFor(draft().colour!)) : 'transparent'"
                         [class.colour-dot--empty]="!draft().colour" aria-hidden="true"></i>
                    </label>
                  </div>
                  @if (customColour() || colourChoice() === '__other__') {
                    <input class="input mt-8" aria-label="Eigen kleur"
                           placeholder="Naam van de kleur…" [ngModel]="draft().colour"
                           (ngModelChange)="setProductColour($event)" />
                    <span class="hint">Tik op het bolletje voor de exacte staal
                      @if (draft().colourHex) { ({{ draft().colourHex }}) }</span>
                  }
                </div>
                <div class="field">
                  <label for="p-variant-size">Maat <span class="opt"></span></label>
                  <input class="input" id="p-variant-size" maxlength="80"
                         placeholder="Bijv. S, XL of 30 cm"
                         [ngModel]="draft().variantSize"
                         (ngModelChange)="patch({ variantSize: emptyToNull($event) })" />
                </div>
            @if (isNew()) {
              <!-- A sibling can be chosen before the product exists; the
                   editor links it right after create, so "save first" is
                   no longer a step the user has to know about. -->
              <app-product-variant-group class="variant-editor-group span-2"
                                         [product]="draft()" [family]="null"
                                         [deferred]="true" [disabled]="saving()"
                                         (pending)="pendingVariant.set($event)" />
              @if (pendingVariant(); as sibling) {
                <div class="variant-editor-card span-2 variant-pending" role="status">
                  <div>
                    <span>Wordt gekoppeld bij aanmaken</span>
                    <b>{{ sibling.name }}</b>
                    <small>{{ sibling.sku }}{{ sibling.colour ? ' · ' + sibling.colour : '' }}</small>
                  </div>
                  <button class="btn btn--sm" type="button" (click)="pendingVariant.set(null)">
                    Ongedaan
                  </button>
                </div>
              }
            } @else if (familyLoading()) {
              <div class="variant-editor-card span-2" role="status">Varianten laden…</div>
            } @else if (familyLoadError()) {
              <div class="variant-editor-card variant-editor-card--error span-2" role="alert">
                <div><b>Varianten niet geladen</b><small>De andere productvelden blijven bewerkbaar.</small></div>
                <button class="btn btn--sm" type="button" (click)="retryFamily()">Opnieuw proberen</button>
              </div>
            } @else {
              <app-product-variant-group class="variant-editor-group span-2"
                                         [product]="draft()" [family]="family()"
                                         [disabled]="saving() || photoUploading() || translationSaving() || translationDirty()"
                                         (linked)="onVariantLinked($event)"
                                         (familyChange)="onFamilyChange($event)" />
            }
            <div class="field span-2">
              <label for="p-description">Omschrijving op offerte <span class="opt"></span></label>
              <textarea class="textarea" id="p-description" rows="3"
                        placeholder="Korte omschrijving voor verkoopdocumenten"
                        [ngModel]="draft().description"
                        (ngModelChange)="patch({ description: $event })"></textarea>
            </div>
          </div>

          <fieldset class="measure-group">
            <legend>Productafmeting</legend>
            <div class="measure-grid measure-grid--4">
              <label class="measure-field">
                <span>Breedte</span>
                <span class="measure-field__control">
                  <input class="input num right" appDecimal
                         [ngModel]="draft().dimensions.lengthCm"
                         (ngModelChange)="patchDimensions({ lengthCm: num($event) })" />
                  <small>cm</small>
                </span>
              </label>
              <label class="measure-field">
                <span>Diepte</span>
                <span class="measure-field__control">
                  <input class="input num right" appDecimal
                         [ngModel]="draft().dimensions.widthCm"
                         (ngModelChange)="patchDimensions({ widthCm: num($event) })" />
                  <small>cm</small>
                </span>
              </label>
              <label class="measure-field">
                <span>Hoogte</span>
                <span class="measure-field__control">
                  <input class="input num right" appDecimal
                         [ngModel]="draft().dimensions.heightCm"
                         (ngModelChange)="patchDimensions({ heightCm: num($event) })" />
                  <small>cm</small>
                </span>
              </label>
              <label class="measure-field">
                <span>Gewicht</span>
                <span class="measure-field__control">
                  <input class="input num right" appDecimal
                         [ngModel]="draft().dimensions.weightKg"
                         (ngModelChange)="patchDimensions({ weightKg: num($event) })" />
                  <small>kg</small>
                </span>
              </label>
            </div>
            <p>Het artikel zelf, zonder de omdoos.</p>
          </fieldset>

          <!-- Presentation packaging: a gift box or display is a third size,
               between the bare article and the shipping carton. -->
          <fieldset class="measure-group">
            <legend>Geschenkverpakking of display</legend>
            <select class="select" aria-label="Verpakking rondom het product"
                    [ngModel]="draft().packaging?.kind ?? 'NONE'"
                    (ngModelChange)="patchPackaging({ kind: $event })">
              <option value="NONE">Geen — los artikel</option>
              <option value="GIFT_BOX">Geschenkverpakking</option>
              <option value="DISPLAY">Display</option>
            </select>
            @if ((draft().packaging?.kind ?? 'NONE') !== 'NONE') {
              <div class="measure-grid measure-grid--4 mt-8">
                <label class="measure-field">
                  <span>Breedte</span>
                  <span class="measure-field__control">
                    <input class="input num right" appDecimal
                           [ngModel]="draft().packaging.dimensions.lengthCm"
                           (ngModelChange)="patchPackagingDimensions({ lengthCm: num($event) })" />
                    <small>cm</small>
                  </span>
                </label>
                <label class="measure-field">
                  <span>Diepte</span>
                  <span class="measure-field__control">
                    <input class="input num right" appDecimal
                           [ngModel]="draft().packaging.dimensions.widthCm"
                           (ngModelChange)="patchPackagingDimensions({ widthCm: num($event) })" />
                    <small>cm</small>
                  </span>
                </label>
                <label class="measure-field">
                  <span>Hoogte</span>
                  <span class="measure-field__control">
                    <input class="input num right" appDecimal
                           [ngModel]="draft().packaging.dimensions.heightCm"
                           (ngModelChange)="patchPackagingDimensions({ heightCm: num($event) })" />
                    <small>cm</small>
                  </span>
                </label>
                <label class="measure-field">
                  <span>Gewicht</span>
                  <span class="measure-field__control">
                    <input class="input num right" appDecimal
                           [ngModel]="draft().packaging.dimensions.weightKg"
                           (ngModelChange)="patchPackagingDimensions({ weightKg: num($event) })" />
                    <small>kg</small>
                  </span>
                </label>
              </div>
              <p>Buitenmaat van de {{ draft().packaging.kind === 'DISPLAY' ? 'display' : 'geschenkverpakking' }}, zoals die in de winkel staat.</p>
              @if (draft().packaging.kind === 'DISPLAY') {
                <div class="field mt-8">
                  <label class="req" for="p-packaging-pieces">Stuks in de display</label>
                  <input class="input num right" id="p-packaging-pieces" type="number" min="1" step="1" inputmode="numeric"
                         [ngModel]="draft().packaging.piecesPerUnit" placeholder="bijv. 12"
                         (ngModelChange)="patchPackaging({ piecesPerUnit: num($event) })" />
                  <span class="hint">Hoeveel stuks één volle display bevat - de catalogus kan daarmee ook een prijs per display tonen.</span>
                </div>
              }
              <div class="field mt-8">
                <label for="p-packaging-barcode">Barcode op de {{ draft().packaging.kind === 'DISPLAY' ? 'display' : 'geschenkverpakking' }} <span class="opt"></span></label>
<span class="magic-field">
              <input class="input mono" id="p-packaging-barcode" inputmode="numeric"
                       [ngModel]="draft().packaging.barcode" placeholder="EAN-13"
                       (ngModelChange)="patchPackaging({ barcode: $event }); check($event, 'packaging')" />
              <!-- The next free code from the company's EAN list, one tap. -->
              <button class="magic-field__btn" type="button" title="Vrije EAN uit de lijst halen"
                      aria-label="Vrije EAN uit de lijst halen" [disabled]="takingCode()"
                      (click)="takeCode('packaging')">✦</button>
            </span>
                @if (packagingCheck(); as result) {
                  <span class="hint" [class.danger-text]="!result.valid">{{ result.message }}</span>
                }
              </div>
            }
          </fieldset>

          <div class="field">
            <label for="p-inner">Barcode (stuk) <span class="opt"></span></label>
<span class="magic-field">
              <input class="input mono" id="p-inner" inputmode="numeric"
                   [ngModel]="draft().barcodeInner" placeholder="EAN-13"
                   (ngModelChange)="patch({ barcodeInner: $event }); check($event, 'inner')" />
              <!-- The next free code from the company's EAN list, one tap. -->
              <button class="magic-field__btn" type="button" title="Vrije EAN uit de lijst halen"
                      aria-label="Vrije EAN uit de lijst halen" [disabled]="takingCode()"
                      (click)="takeCode('inner')">✦</button>
            </span>
            @if (innerCheck(); as result) {
              <span class="hint" [class.danger-text]="!result.valid">{{ result.message }}</span>
            }
          </div>
        </div>
      </section>

      <!-- ============================================ foto's -->
      <section class="card editor-section" id="media" aria-labelledby="media-title">
        <div class="card__head section-head">
          <h2 id="media-title">Foto's</h2>
          <span class="spacer"></span>
          <span class="badge badge--neutral">{{ photoCount() }}</span>
        </div>
        <div class="card__body photo-workspace">
          <app-photo-manager
            [productId]="draft().id"
            [photos]="draft().photos"
            [disabled]="saving() || translationSaving() || translationDirty()"
            (changed)="onPhotosChanged($event)"
          />
        </div>
      </section>

      <!-- ============================================ verpakking -->
      <section class="card editor-section" id="packaging" aria-labelledby="packaging-title">
        <div class="card__head section-head">
          <h2 id="packaging-title">Omdoos</h2>
        </div>
        <div class="card__body">
          <fieldset class="measure-group">
            <legend>Kartonafmeting</legend>
            <div class="measure-grid">
              <label class="measure-field">
                <span>Breedte</span>
                <span class="measure-field__control">
                  <input class="input num right" appDecimal
                         [ngModel]="draft().carton.lengthCm"
                         (ngModelChange)="patchCarton({ lengthCm: num($event) })" />
                  <small>cm</small>
                </span>
              </label>
              <label class="measure-field">
                <span>Diepte</span>
                <span class="measure-field__control">
                  <input class="input num right" appDecimal
                         [ngModel]="draft().carton.widthCm"
                         (ngModelChange)="patchCarton({ widthCm: num($event) })" />
                  <small>cm</small>
                </span>
              </label>
              <label class="measure-field">
                <span>Hoogte</span>
                <span class="measure-field__control">
                  <input class="input num right" appDecimal
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
                <input class="input num right" id="p-weight" appDecimal
                       inputmode="decimal" [ngModel]="draft().carton.weightKg"
                       (ngModelChange)="patchCarton({ weightKg: num($event) })" />
                <span class="input-affix__suffix">kg</span>
              </div>
            </div>
            <div class="field">
              <label for="p-outer">Omdoosbarcode <span class="opt"></span></label>
<span class="magic-field">
              <input class="input mono" id="p-outer" inputmode="numeric"
                     [ngModel]="draft().barcodeOuter" placeholder="EAN-13 of ITF-14"
                     (ngModelChange)="patch({ barcodeOuter: $event }); check($event, 'outer')" />
              <!-- The next free code from the company's EAN list, one tap. -->
              <button class="magic-field__btn" type="button" title="Vrije EAN uit de lijst halen"
                      aria-label="Vrije EAN uit de lijst halen" [disabled]="takingCode()"
                      (click)="takeCode('outer')">✦</button>
            </span>
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
    <section class="card editor-section" id="purchasing" aria-labelledby="purchasing-title">
      <div class="card__head section-head">
        <h2 id="purchasing-title">Inkoop</h2></div>
      <div class="card__body">
        <div class="form-grid">
          <div class="field">
            <label class="req" for="p-exw">EXW prijs</label>
            <input class="input num right" id="p-exw" appDecimal
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
            <label for="p-extra">Extra kost per stuk (bijvoorbeeld display, geschenkverpakking) <span class="opt"></span></label>
            <div class="input-affix">
              <input class="input num right" id="p-extra" appDecimal
                     inputmode="decimal" [ngModel]="draft().extraUnitCost"
                     (ngModelChange)="patch({ extraUnitCost: +$event })" />
              <span class="input-affix__suffix">{{ draft().exwCurrency }}</span>
            </div>
            <span class="hint">Wat de leverancier per stuk extra rekent bovenop de EXW-prijs: een display, een giftbox, een inlay. Telt mee in de kostprijs.</span>
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


      <!-- ============================================= sales -->
      <section class="card editor-section" id="sales" aria-labelledby="sales-title">
        <div class="card__head section-head">
          <h2 id="sales-title">Verkoop</h2>
        </div>
        <div class="card__body">
          <fieldset class="price-method">
            <legend>Catalogusprijs</legend>
            <div class="price-method__options" role="group" aria-label="Prijsstrategie">
              <button type="button"
                      [class.price-method__active]="priceStrategy() === 'FIXED'"
                      [attr.aria-pressed]="priceStrategy() === 'FIXED'"
                      (click)="setPriceStrategy('FIXED')">
                <b>Vaste verkoopprijs per stuk</b>
                <small>Blijft hetzelfde bedrag</small>
              </button>
              <button type="button"
                      [class.price-method__active]="priceStrategy() === 'MARKUP'"
                      [attr.aria-pressed]="priceStrategy() === 'MARKUP'"
                      (click)="setPriceStrategy('MARKUP')">
                <b>Kostprijs + opslag</b>
                <small>Beweegt mee met je kostprijs</small>
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
                <input class="input num right" id="p-price" appDecimal
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
              <span class="price-preview__label">Catalogusprijs per stuk</span>
              <strong class="num">{{ salesPrice() | eur }}</strong>
              <small>{{ priceStrategy() === 'FIXED' ? 'Vaste prijs' : 'Kostprijs + opslag' }}</small>
            </div>
            <!-- Two aligned rows: label left, figure right, nothing wraps. -->
            <dl class="price-preview__meta">
              <dt>Voorraad</dt>
              <dd class="num">
                @if (draft().inventoryKnown) { {{ draft().stockQuantity | num }} } @else { onbekend }
              </dd>
              <dt>Marge per stuk</dt>
              <dd class="num">{{ unitMargin() | eur }}</dd>
            </dl>
          </div>
        </div>
      </section>

      <!-- ======================================== stock -->
      <!-- Stock lives apart from the product form: purchase receipts feed
           it, a recount corrects it on the spot, and the book below says
           where every figure came from. -->
      <section class="card editor-section" id="stock" aria-labelledby="stock-title">
        <div class="card__head section-head">
          <h2 id="stock-title">Voorraad</h2>
          <span class="spacer"></span>
          @if (!isNew() && stockLevels(); as levels) {
            <strong class="num stock-now">{{ stockTotal() | num }} stuks</strong>
          }
        </div>
        <div class="card__body">
          @if (isNew()) {
            <p class="hint">Voorraad komt er zodra het product is aangemaakt.</p>
          } @else {
            <!-- One line per location. The warehouse is what the website
                 sells from; a stand sells on the spot. Correcting is per
                 line, saved at once, apart from Opslaan. -->
            @if (stockLevels(); as levels) {
              <ul class="stock-levels">
                @for (level of levels; track level.locationId) {
                  <li [class.stock-levels__row--editing]="stockEditing() === level.locationId">
                    <span class="stock-levels__where">
                      <b>{{ level.name }}</b>
                      <small>{{ level.kindLabel }}{{ level.countsForWebsite ? ' · alle verkoopkanalen' : '' }}</small>
                    </span>
                    @if (stockEditing() === level.locationId) {
                      <span class="stock-levels__edit">
                        <label class="sr-only" [for]="'p-stock-' + level.locationId">Geteld aantal op {{ level.name }}</label>
                        <input class="input num right" [id]="'p-stock-' + level.locationId" type="number" min="0" step="1"
                               inputmode="numeric" [ngModel]="stockDraft()" (ngModelChange)="stockDraft.set($event)"
                               (keydown.enter)="saveStock(level.locationId)" (keydown.escape)="stockEditing.set(null)" />
                        <button class="btn btn--primary btn--sm" type="button" [disabled]="stockSaving()"
                                (click)="saveStock(level.locationId)">{{ stockSaving() ? 'Bezig…' : 'Opslaan' }}</button>
                        <button class="btn btn--sm" type="button" (click)="stockEditing.set(null)">Annuleren</button>
                      </span>
                    } @else {
                      <strong class="num stock-levels__qty" [class.muted]="!level.quantity">{{ level.quantity | num }}</strong>
                      <button class="btn btn--sm" type="button" (click)="startStockEdit(level)">Corrigeren</button>
                    }
                  </li>
                }
              </ul>
              <div class="stock-edit">
                @if (levels.length > 1) {
                  <button class="btn btn--sm" type="button" (click)="startTransfer(levels)">Verplaatsen</button>
                } @else {
                  <a class="btn btn--sm" routerLink="/stock-locations">Locatie toevoegen</a>
                }
                <!-- Pieces that leave without a sale, each counted under its own name. -->
                <button class="btn btn--sm" type="button" (click)="startTakeOut(levels, 'DAMAGED')">Beschadigd</button>
                <button class="btn btn--sm" type="button" (click)="startTakeOut(levels, 'DEMO')">Demo weggegeven</button>
                <span class="hint">Groeit vanzelf wanneer een inkooporder op Ontvangen gaat.</span>
              </div>
              @if (lossCounters(); as loss) {
                @if (loss.damaged || loss.demo) {
                  <p class="stock-loss">
                    @if (loss.damaged) { <span><b>{{ loss.damaged | num }}</b> beschadigd</span> }
                    @if (loss.demo) { <span><b>{{ loss.demo | num }}</b> als demo weggegeven</span> }
                  </p>
                }
              }
              @if (takeOutDraft(); as out) {
                <div class="stock-transfer">
                  <label class="field">
                    <span>{{ out.kind === 'DAMAGED' ? 'Beschadigd op' : 'Demo uit' }}</span>
                    <select class="select" [ngModel]="out.locationId" (ngModelChange)="patchTakeOut({ locationId: +$event })">
                      @for (level of levels; track level.locationId) {
                        <option [value]="level.locationId">{{ level.name }} ({{ level.quantity | num }})</option>
                      }
                    </select>
                  </label>
                  <label class="field">
                    <span>Aantal</span>
                    <input class="input num right" type="number" min="1" step="1" inputmode="numeric"
                           [ngModel]="out.quantity" (ngModelChange)="patchTakeOut({ quantity: +$event })" />
                  </label>
                  <label class="field stock-transfer__note">
                    <span>{{ out.kind === 'DAMAGED' ? 'Wat is er gebeurd' : 'Aan wie' }} <span class="opt"></span></span>
                    <input class="input" [placeholder]="out.kind === 'DAMAGED' ? 'bijv. gevallen bij het laden' : 'bijv. klant Janssens, beurs Gent'"
                           [ngModel]="out.note" (ngModelChange)="patchTakeOut({ note: $event })" />
                  </label>
                  <span class="stock-transfer__actions">
                    <button class="btn btn--primary btn--sm" type="button" [disabled]="stockSaving()"
                            (click)="confirmTakeOut()">{{ stockSaving() ? 'Bezig…' : (out.kind === 'DAMAGED' ? 'Als beschadigd afboeken' : 'Als demo afboeken') }}</button>
                    <button class="btn btn--sm" type="button" (click)="takeOutDraft.set(null)">Annuleren</button>
                  </span>
                </div>
              }
              @if (transferDraft(); as move) {
                <div class="stock-transfer">
                  <label class="field">
                    <span>Van</span>
                    <select class="select" [ngModel]="move.fromId" (ngModelChange)="patchTransfer({ fromId: +$event })">
                      @for (level of levels; track level.locationId) {
                        <option [value]="level.locationId">{{ level.name }} ({{ level.quantity | num }})</option>
                      }
                    </select>
                  </label>
                  <label class="field">
                    <span>Naar</span>
                    <select class="select" [ngModel]="move.toId" (ngModelChange)="patchTransfer({ toId: +$event })">
                      @for (level of levels; track level.locationId) {
                        <option [value]="level.locationId">{{ level.name }}</option>
                      }
                    </select>
                  </label>
                  <label class="field">
                    <span>Aantal</span>
                    <input class="input num right" type="number" min="1" step="1" inputmode="numeric"
                           [ngModel]="move.quantity" (ngModelChange)="patchTransfer({ quantity: +$event })" />
                  </label>
                  <label class="field stock-transfer__note">
                    <span>Notitie <span class="opt"></span></span>
                    <input class="input" placeholder="bijv. bus van maandag" [ngModel]="move.note"
                           (ngModelChange)="patchTransfer({ note: $event })" />
                  </label>
                  <span class="stock-transfer__actions">
                    <button class="btn btn--primary btn--sm" type="button" [disabled]="stockSaving()"
                            (click)="confirmTransfer()">{{ stockSaving() ? 'Bezig…' : 'Verplaatsen' }}</button>
                    <button class="btn btn--sm" type="button" (click)="transferDraft.set(null)">Annuleren</button>
                  </span>
                </div>
              }
            } @else {
              <p class="hint">Voorraad laden…</p>
            }

            <h3 class="stock-history__title">Geschiedenis</h3>
            @if (stockHistory(); as history) {
              @if (history.length) {
                <!-- Swipe a line left to strike it: a short swipe shows the
                     bin, a long one deletes at once - no question asked, the
                     count itself never changes. -->
                <ol class="stock-history">
                  @for (move of history; track move.id) {
                    <li class="swipe stock-history__item" [class.swipe--open]="moveSwiped() === move.id"
                        [class.swipe--dragging]="moveDragging() === move.id"
                        [class.stock-history__item--leaving]="moveDeleting() === move.id"
                        [style.--swipe-offset]="moveDragging() === move.id ? moveOffset() + 'px' : null">
                      <div class="swipe__row stock-history__row"
                           (touchstart)="moveSwipeStart($event, move.id)"
                           (touchmove)="moveSwipeMove($event, move)"
                           (touchend)="moveSwipeEnd(move)"
                           (touchcancel)="moveSwipeEnd(move)"
                           (click)="moveSwiped() !== null && moveSwiped.set(null)">
                        <span class="stock-history__delta num" [class.stock-history__delta--minus]="move.delta < 0">
                          {{ move.delta > 0 ? '+' : '' }}{{ move.delta | num }}
                        </span>
                        <span class="stock-history__what">
                          <b>{{ move.kindLabel }}@if (move.reference) { {{ move.kind === 'TRANSFER_OUT' || move.kind === 'TRANSFER_IN' ? '' : '·' }} {{ move.reference }}}</b>
                          <small>@if (move.locationName) { {{ move.locationName }} · }{{ move.at | dateTimeNl }} · {{ move.actor }}</small>
                        </span>
                        <span class="stock-history__after num">= {{ move.quantityAfter | num }}</span>
                        <button class="stock-history__bin" type="button" title="Regel verwijderen"
                                aria-label="Regel verwijderen" (click)="deleteMove(move); $event.stopPropagation()">
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M4 7h16" /><path d="M9 7V5h6v2" />
                            <path d="M6.5 7l1 13h9l1-13" /><path d="M10 11v6" /><path d="M14 11v6" />
                          </svg>
                        </button>
                      </div>
                      <button class="swipe__delete" type="button" [disabled]="moveDeleting() !== null"
                              aria-label="Regel verwijderen" (click)="deleteMove(move)">
                        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
                             stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                          <path d="M4 7h16" /><path d="M9 7V5h6v2" />
                          <path d="M6.5 7l1 13h9l1-13" /><path d="M10 11v6" /><path d="M14 11v6" />
                        </svg>
                      </button>
                    </li>
                  }
                </ol>
              } @else {
                <p class="hint">Nog geen bewegingen geboekt. Alles wat vanaf nu binnenkomt of geteld wordt, staat hier.</p>
              }
            } @else {
              <p class="hint">Geschiedenis laden…</p>
            }
          }
        </div>
      </section>

      <!-- Public content is desktop work: long texts, translations and
           image curation do not belong on a phone at the fair. -->
      <div class="editor-desktop-only" id="publication">
      <app-product-publication-editor
        [product]="draft()"
        [family]="family()"
        [categories]="categories()"
        [busy]="saving() || photoUploading() || translationSaving()"
        [familyLoading]="familyLoading()"
        [familyLoadError]="familyLoadError()"
        (productChange)="draft.set($event)"
        (familyChange)="onFamilyChange($event)"
        (createFamilyRequested)="startNewFamily()"
        (retryFamilyRequested)="retryFamily()"
        (imageUploadRequested)="uploadFamilyImage($event)"
        (imageDeleteRequested)="removeFamilyImage($event)"
        (imageVariantChangeRequested)="linkFamilyImageVariant($event)"
        (translationDirtyChange)="translationDirty.set($event)"
        (translationSavingChange)="translationSaving.set($event)"
        (translationsSaved)="onPublicTranslationsSaved($event)"
      />
      </div>

      <div class="editor-actions">
        <!-- Phone: walk the sections with Volgende, save at the end (the
             header keeps a save shortcut once something changed). Desktop
             sees everything at once and simply saves. -->
        <button class="btn btn--primary btn--block editor-next" type="button"
                (click)="nextTab()">
          Volgende
        </button>
        <button class="btn btn--primary btn--block editor-save" type="button"
                [disabled]="saving() || photoUploading() || translationSaving()"
                (click)="save()">
          {{ isNew() && photoCount() ? "Product met foto's aanmaken" :
             (isNew() ? 'Product aanmaken' : 'Wijzigingen opslaan') }}
        </button>
        @if (!isNew()) {
          <button class="btn btn--block" type="button"
                  [disabled]="saving() || photoUploading() || translationSaving() || translationDirty()"
                  (click)="startCopy()">
            Kopiëren als variant
          </button>
          <details class="danger-zone">
            <summary>Geavanceerde acties</summary>
            <div>
              <p>Staat dit product al op een order of offerte? Zet het dan inactief; gebruikte producten kunnen niet worden verwijderd.</p>
              <button class="btn btn--danger btn--block" type="button"
                      [disabled]="saving() || photoUploading() || translationSaving() || translationDirty()"
                      (click)="remove()">
                Product definitief verwijderen
              </button>
            </div>
          </details>
        }
      </div>

      @if (publishFix(); as plan) {
        <app-sheet title="Even invullen om op te slaan" (closed)="publishFix.set(null)">
          <div body>
            <p class="small muted" style="margin:0 0 12px">
              Dit product zit in een gepubliceerde familie. Zonder deze gegevens zou de
              website-pagina van <b>{{ plan.family }}</b> stukgaan, daarom is de wijziging
              nog niet opgeslagen. Vul ze hier in en het gaat meteen door.
            </p>
            @for (item of plan.items; track item.field) {
              <div class="fix-item">
                <div class="fix-item__head">
                  <b>{{ item.label }} vertalen</b>
                  @if (item.base) {
                    <button class="linklike" type="button" (click)="fillAll(item, item.base)">
                      "{{ item.base }}" overal
                    </button>
                  }
                </div>
                <div class="fix-item__grid">
                  @for (lang of item.languages; track lang) {
                    <label class="fix-item__lang">
                      <span>{{ lang }}</span>
                      <input class="input input--sm" [value]="item.values[lang] ?? ''"
                             (input)="item.values[lang] = $any($event.target).value" />
                    </label>
                  }
                </div>
              </div>
            }
            @if (plan.swatch) {
              <div class="fix-item">
                <div class="fix-item__head"><b>Kleurstaal voor "{{ draft().colour }}"</b></div>
                <label class="fix-item__lang" style="max-width:200px">
                  <span>Kleur</span>
                  <input type="color" [value]="plan.swatchHex"
                         (input)="plan.swatchHex = $any($event.target).value" />
                </label>
              </div>
            }
            @for (note of plan.notes; track note) {
              <div class="fix-note">{{ note }}</div>
            }
          </div>
          <div foot style="display:contents">
            <button class="btn" type="button" (click)="publishFix.set(null)">Annuleren</button>
            <button class="btn btn--primary" type="button" [disabled]="saving()"
                    (click)="applyPublishFix()">
              {{ plan.items.length || plan.swatch ? 'Invullen en opslaan' : 'Sluiten' }}
            </button>
          </div>
        </app-sheet>
      }

      @if (leaveQuestion(); as answer) {
        <app-sheet title="Wijzigingen opslaan?" (closed)="answer(null)">
          <div body>
            <p class="small muted" style="margin:0">
              Je hebt dit product gewijzigd maar nog niet opgeslagen.
            </p>
          </div>
          <div foot style="display:contents">
            <button class="btn btn--quiet" type="button" (click)="answer(false)">Niet opslaan</button>
            <button class="btn btn--primary" type="button" (click)="answer(true)">Opslaan</button>
          </div>
        </app-sheet>
      }

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
                  Variantgroep: {{ family()?.name || copySource().name }}
                } @else {
                  Nog geen varianten gekoppeld
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
                <span class="tiny muted">Bestaat al bij de gekoppelde producten</span>
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
                @for (option of standardColours(); track option) {
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
              <p class="hint">De kopie wordt meteen als variant aan dit product gekoppeld.</p>
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
    .product-load-error {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding-block: 10px; color: var(--danger);
    }
    .product-load-error > span { display: grid; gap: 2px; }
    .product-load-error small { font-size: 10px; }
    .editor-canvas { width: 100%; max-width: 920px; margin: 0 auto; }
    .editor-section, .editor-desktop-only { scroll-margin-top: 112px; }
    .colour-control { display: flex; align-items: center; gap: 8px; }
    .colour-control .select { flex: 1; }
    .colour-dot { display: inline-flex; cursor: pointer; }
    .colour-dot i {
      width: 30px; height: 30px; border-radius: 50%;
      border: 1px solid rgb(0 0 0 / 14%); box-shadow: inset 0 0 0 2px var(--surface);
    }
    .colour-dot--empty { background: repeating-linear-gradient(45deg, #eee 0 4px, #fff 4px 8px) !important; }
    .fix-item { margin-bottom: 14px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; }
    .fix-item__head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .fix-item__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 10px; }
    .fix-item__lang { display: flex; align-items: center; gap: 6px; font-size: 12px; }
    .fix-item__lang span { min-width: 22px; font-weight: 700; color: var(--muted); }
    .fix-note { font-size: 12.5px; color: var(--ink-2); padding: 6px 0; border-top: 1px solid var(--line); }
    /* Phone: Volgende until the last step, then save; the header save
       fades out while nothing changed. Desktop: always save. */
    .editor-next { display: none; }
    @media (max-width: 679px) {
      /* Phone: Volgende until the last step; saving is the header's job. */
      .editor-next { display: block; }
      .editor-save { display: none; }
      .editor-canvas--last .editor-actions .editor-next { display: none; }
    }
    .select--status {
      width: auto; min-height: 34px; padding: 4px 30px 4px 12px;
      font-size: 13px; font-weight: 650;
      background-color: var(--ok-soft, #eaf5ee); color: var(--ok, #2e7d4f);
      border-color: transparent; border-radius: 999px;
    }
    .select--status-off { background-color: var(--surface-2); color: var(--muted); }
    .variant-pending { border-color: var(--rose-soft); background: var(--rose-soft); }
    /* Phone: only the active section is in the DOM flow; desktop: all. */
    @media (max-width: 679px) {
      /* Deleting lives on the list (swipe left) - no danger zone on a
         phone screen that is mostly about typing numbers. */
      .danger-zone { display: none; }
      .editor-canvas .editor-section,
      .editor-canvas .editor-desktop-only { display: none; }
      .editor-canvas[data-tab="identity"] #identity,
      .editor-canvas[data-tab="media"] #media,
      .editor-canvas[data-tab="packaging"] #packaging,
      .editor-canvas[data-tab="purchasing"] #purchasing,
      .editor-canvas[data-tab="sales"] #sales,
      .editor-canvas[data-tab="stock"] #stock { display: block; }
    }

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
    .variant-editor-card {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      margin-top: -4px; padding: 11px 12px; border: 1px solid var(--line);
      border-radius: var(--r-sm); background: var(--surface-2);
    }
    .variant-editor-group { display: block; margin-top: -4px; }
    .variant-editor-card--error { border-color: #eddcb9; background: var(--warn-soft); }
    .variant-editor-card > div { display: grid; gap: 2px; min-width: 0; }
    .variant-editor-card span { color: var(--brand); font-size: 9.5px; font-weight: 750;
      letter-spacing: .06em; text-transform: uppercase; }
    .variant-editor-card b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
    .variant-editor-card small { color: var(--muted); font-size: 10.5px; line-height: 1.35; }
    .measure-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; }
    .measure-grid--4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    /* Four measures on a narrow phone: two rows of two, not four slivers. */
    @media (max-width: 420px) { .measure-grid--4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
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

    /* Desktop idiom only (the rail breakpoint); a phone has no room next
       to Opslaan and goes back to the list anyway. */
    .product-nav { display: none; align-items: center; gap: 4px; margin-right: 6px; }
    @media (min-width: 680px) { .product-nav { display: inline-flex; } }
    .product-nav__btn { min-width: 32px; padding: 0 9px; font-size: 18px; line-height: 1; text-decoration: none; }
    .product-nav__btn--off { opacity: .35; pointer-events: none; }
    .product-nav__pos { min-width: 40px; color: var(--muted); font-size: 11px; text-align: center;
      font-variant-numeric: tabular-nums; }
    .magic-field { position: relative; display: block; }
    .magic-field .input { padding-right: 44px; }
    .magic-field__btn { position: absolute; right: 5px; top: 50%; transform: translateY(-50%); width: 32px; height: 32px;
      border: 0; border-radius: 8px; background: var(--rose-soft); color: var(--rose-dark); font-size: 15px;
      cursor: pointer; }
    .magic-field__btn:hover { background: var(--rose-line); }
    .magic-field__btn:disabled { opacity: .5; cursor: wait; }
    .stock-now { font-size: 16px; }
    .stock-loss { display: flex; flex-wrap: wrap; gap: 14px; margin: 8px 0 0; color: var(--muted); font-size: 12px; }
    .stock-loss b { color: var(--ink); }
    .stock-levels { list-style: none; margin: 0 0 12px; padding: 0; border-top: 1px solid var(--line); }
    .stock-levels li { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 9px 0;
      border-bottom: 1px solid var(--line); }
    .stock-levels__where { flex: 1 1 160px; display: grid; min-width: 0; }
    .stock-levels__where b { font-size: 13.5px; }
    .stock-levels__where small { color: var(--muted); font-size: 11px; }
    .stock-levels__qty { min-width: 64px; font-size: 16px; text-align: right; }
    .stock-levels__edit { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .stock-levels__edit .input { width: 110px; }
    .stock-transfer { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; padding: 12px;
      border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface-2); }
    .stock-transfer .field > span { display: block; margin-bottom: 4px; color: var(--muted); font-size: 11px; font-weight: 700; }
    .stock-transfer__note { grid-column: 1 / -1; }
    .stock-transfer__actions { grid-column: 1 / -1; display: flex; gap: 8px; }
    @media (min-width: 680px) { .stock-transfer { grid-template-columns: 1fr 1fr 120px; } .stock-transfer__note { grid-column: auto; } }
    .stock-edit { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .stock-edit .input { width: 120px; }
    .stock-history__title { margin: 18px 0 6px; color: var(--muted); font-size: 11px; font-weight: 750;
      letter-spacing: .06em; text-transform: uppercase; }
    .stock-history { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
    .stock-history__item { border-bottom: 1px solid var(--line); }
    /* The row follows the finger all the way; past the threshold it
       slides out entirely instead of parking halfway. */
    .stock-history__item.swipe--dragging .swipe__row {
      transform: translateX(var(--swipe-offset, 0px)); transition: none; }
    .stock-history__item--leaving .swipe__row { transform: translateX(-110%); opacity: .3;
      transition: transform .2s ease, opacity .2s ease; }
    .stock-history__row { display: grid; grid-template-columns: 64px 1fr auto auto; align-items: center;
      gap: 10px; padding: 8px 0; }
    /* Desktop: the bin sits at the row's edge and shows on hover; a mouse
       cannot swipe. */
    .stock-history__bin { display: none; width: 28px; height: 28px; padding: 0; border: 0;
      border-radius: 8px; background: transparent; color: var(--muted); cursor: pointer; }
    .stock-history__bin svg { width: 16px; height: 16px; fill: none; stroke: currentColor;
      stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .stock-history__bin:hover { background: var(--danger-soft, #fbe9e7); color: var(--danger); }
    @media (hover: hover) and (pointer: fine) {
      .stock-history__bin { display: inline-flex; align-items: center; justify-content: center; opacity: 0; }
      .stock-history__row:hover .stock-history__bin, .stock-history__bin:focus-visible { opacity: 1; }
    }
    .stock-history__delta { font-weight: 750; color: var(--ok, #2e7d4f); }
    .stock-history__delta--minus { color: var(--danger); }
    .stock-history__what { display: grid; min-width: 0; }
    .stock-history__what b { font-weight: 650; font-size: 13px; }
    .stock-history__what small { color: var(--muted); font-size: 11.5px; }
    .stock-history__after { color: var(--muted); font-size: 12.5px; white-space: nowrap; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; }
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
    .price-preview__meta {
      display: grid; grid-template-columns: auto auto; column-gap: 10px; row-gap: 4px;
      align-items: baseline; margin: 0; flex: none;
      color: #c7bdb7; font-size: 11px; white-space: nowrap;
    }
    .price-preview__meta dt { margin: 0; }
    .price-preview__meta dd { margin: 0; color: #fff; font-weight: 700; text-align: right; }
    .price-preview__label { white-space: nowrap; }

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

    @media (min-width: 680px) {
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
      .variant-editor-card { align-items: stretch; flex-direction: column; }
      .variant-editor-card .btn { align-self: flex-start; }
    }
  `,
})
export class ProductEditor implements OnDestroy {
  /** Which section a phone shows; on desktop the scroll spy drives it. */
  readonly activeTab = signal('identity');

  /* The draft as last loaded or saved; anything different is unsaved
     work. JSON is crude but honest - it also catches a field typed and
     typed back, which then correctly counts as clean. */
  private readonly baseline = signal('');
  readonly dirty = computed(() => JSON.stringify(this.draft()) !== this.baseline());
  private markClean(): void { this.baseline.set(JSON.stringify(this.draft())); }

  /** Phone flow: the tabs you can actually complete on a phone. */
  readonly phoneTabs = computed(() => this.tabs().filter((t) => t.id !== 'publication'));
  /* Website only exists on a desktop screen; below that the tab is just
     a dead end, so it is not offered. */
  private readonly desktop = inject(DesktopViewport);
  readonly visibleTabs = computed(() => this.desktop.active() ? this.tabs() : this.phoneTabs());
  readonly isLastPhoneTab = computed(() => {
    const list = this.phoneTabs();
    return list.findIndex((t) => t.id === this.activeTab()) >= list.length - 1;
  });
  nextTab(): void {
    const list = this.phoneTabs();
    const index = list.findIndex((t) => t.id === this.activeTab());
    const next = list[Math.min(index + 1, list.length - 1)];
    if (next) this.showTab(next.id);
  }

  /* ---- publication blockers, made fixable ------------------------ */

  readonly publishFix = signal<PublishFixPlan | null>(null);
  readonly fixLanguages: LanguageCode[] = ['NL', 'FR', 'EN', 'DE', 'ES', 'PL', 'PT', 'TR'];

  /**
   * Turns the family guard's refusal ("...niet publiceerbaar: key; key")
   * into a plan: per missing text of THIS product one row with an input
   * per language, a swatch row when the colour sample is missing, and
   * plain-language notes for what belongs elsewhere (family copy, other
   * variants). Null when the message is not a publication blocker.
   */
  planPublishFix(message: string): PublishFixPlan | null {
    const marker = 'niet publiceerbaar: ';
    const at = message.indexOf(marker);
    if (at < 0) return null;
    const family = /productfamilie\s+(\S+)\s+niet/.exec(message)?.[1] ?? '';
    const issues = message.slice(at + marker.length).split(';').map((i) => i.trim()).filter(Boolean);
    const draft = this.draft();
    /* The backend keys a variant by its canonical key, falling back to
       the product id - mirror that so "mine" is recognised either way. */
    const myKey = draft.canonicalVariantKey || String(draft.id ?? '');
    const fieldLabel: Record<string, string> = { size: 'Maat', name: 'Naam', color: 'Kleur' };
    const base: Record<string, string> = {
      size: draft.variantSize ?? '', name: draft.name ?? '', color: draft.colour ?? '',
    };
    const items = new Map<string, PublishFixItem>();
    const notes: string[] = [];
    let swatch = false;
    const langs = (list: Set<string>) => [...list].join(', ');
    const others = new Map<string, Set<string>>();
    const familyTexts = new Map<string, Set<string>>();

    for (const issue of issues) {
      const variant = /\.variants\.([^.]+)\.([A-Z]{2}|[a-z]{2})\.(size|name|color)$/i.exec(issue);
      if (variant) {
        const [, key, lang, field] = variant;
        const code = lang.toUpperCase() as LanguageCode;
        if (key === myKey) {
          const item = items.get(field) ?? { field, label: fieldLabel[field] ?? field,
            base: base[field] ?? '', languages: [], values: {} as Record<string, string> };
          if (!item.languages.includes(code)) {
            item.languages.push(code);
            item.values[code] = item.base;
          }
          items.set(field, item);
        } else {
          const set = others.get(`${key}|${fieldLabel[field] ?? field}`) ?? new Set<string>();
          set.add(code);
          others.set(`${key}|${fieldLabel[field] ?? field}`, set);
        }
        continue;
      }
      const familyText = /\.([A-Z]{2}|[a-z]{2})\.(\w+)$/i.exec(issue);
      if (issue.startsWith('website.') && familyText && !issue.includes('.variants.')) {
        const set = familyTexts.get(familyText[2]) ?? new Set<string>();
        set.add(familyText[1].toUpperCase());
        familyTexts.set(familyText[2], set);
        continue;
      }
      if (/Kleurstaal ontbreekt/.test(issue) && draft.colour && !draft.colourHex) { swatch = true; continue; }
      notes.push(issue);
    }
    for (const [key, set] of others) {
      const [variant, field] = key.split('|');
      notes.push(`Variant ${variant}: ${field.toLowerCase()} nog niet vertaald in ${langs(set)} - open dat product.`);
    }
    for (const [field, set] of familyTexts) {
      notes.push(`Familietekst "${field}" ontbreekt in ${langs(set)} - Website & publicatie (desktop).`);
    }
    if (!items.size && !swatch && !notes.length) return null;
    return { family, items: [...items.values()], swatch, swatchHex: '#A91F32', notes };
  }

  fillAll(item: PublishFixItem, value: string): void {
    for (const lang of item.languages) item.values[lang] = value;
    this.publishFix.update((plan) => plan ? { ...plan } : plan);
  }

  /** Writes the filled-in texts (and swatch), then saves the product again. */
  async applyPublishFix(): Promise<void> {
    const plan = this.publishFix();
    const productId = this.draft().id;
    if (!plan) return;
    if (productId === null) {
      this.ui.toast('Maak het product eerst zonder familie aan; koppel daarna de variant.', 'err');
      return;
    }
    this.saving.set(true);
    try {
      if (plan.items.length) {
        const snapshot = await this.catalog.productPublicTranslations(productId);
        const texts = [...snapshot.productTexts];
        for (const item of plan.items) {
          for (const lang of item.languages) {
            const value = (item.values[lang] ?? '').trim();
            if (!value) continue;
            let text = texts.find((t) => t.language === lang);
            if (!text) {
              text = { language: lang, name: null, description: null, colour: null, variantSize: null };
              texts.push(text);
            }
            if (item.field === 'size') text.variantSize = value;
            else if (item.field === 'name') text.name = value;
            else if (item.field === 'color') text.colour = value;
          }
        }
        await this.catalog.updateProductPublicTranslations(productId, {
          revision: snapshot.revision, familyId: snapshot.familyId,
          familyTexts: snapshot.familyTexts, productTexts: texts, images: snapshot.images,
        });
      }
      if (plan.swatch) this.patch({ colourHex: plan.swatchHex.toUpperCase() });
      this.publishFix.set(null);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Invullen mislukt'), 'err');
      return;
    } finally {
      this.saving.set(false);
    }
    await this.save();
  }

  /** The three-way question when leaving with unsaved work. */
  readonly leaveQuestion = signal<((keep: boolean | null) => void) | null>(null);

  /** Sibling chosen while the product had no id; linked right after create. */
  readonly pendingVariant = signal<Product | null>(null);

  ngOnDestroy(): void {
    window.removeEventListener('scroll', this.onScroll);
    if (this.spyFrame) cancelAnimationFrame(this.spyFrame);
  }

  readonly tabs = computed(() => {
    const list = [
      { id: 'identity', label: 'Basis' },
      { id: 'media', label: "Foto's" },
      { id: 'packaging', label: 'Omdoos' },
      { id: 'purchasing', label: 'Inkoop' },
      { id: 'sales', label: 'Verkoop' },
      { id: 'stock', label: 'Voorraad' },
      { id: 'publication', label: 'Website' },
    ];
    return list;
  });

  showTab(id: string): void {
    this.activeTab.set(id);
    if (window.innerWidth >= 680) {
      /* Desktop: every section is on the page; jump to it. The spy below
         is muted briefly so the smooth scroll does not flicker the
         highlight through the sections it passes. */
      this.spyMutedUntil = Date.now() + 700;
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      window.scrollTo({ top: 0 });
    }
  }

  /* Scroll spy (desktop): the highlighted tab follows the section under
     the sticky rail, like the settings page. */
  private spyMutedUntil = 0;
  private spyFrame = 0;
  private readonly onScroll = () => {
    if (this.spyFrame) return;
    this.spyFrame = requestAnimationFrame(() => {
      this.spyFrame = 0;
      if (window.innerWidth < 680 || Date.now() < this.spyMutedUntil) return;
      /* Normally the last section whose top passed the rail owns the
         highlight. At the very end of the page that rule sticks on the
         section above the one you scrolled to (short sections cannot
         reach the top), so there the section filling most of the
         viewport wins instead. */
      const rail = document.querySelector<HTMLElement>('.subnav');
      const top = (rail?.getBoundingClientRect().bottom ?? 0);
      const atEnd = window.scrollY + window.innerHeight >= document.body.scrollHeight - 2;
      let current = this.tabs()[0].id;
      let best = -1;
      for (const tab of this.tabs()) {
        const box = document.getElementById(tab.id)?.getBoundingClientRect();
        if (!box) continue;
        if (atEnd) {
          const visible = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, top);
          if (visible > best) { best = visible; current = tab.id; }
        } else if (box.top <= top + 12) {
          current = tab.id;
        }
      }
      if (this.activeTab() !== current) this.activeTab.set(current);
    });
  };

  private readonly catalog = inject(CatalogApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly ui = inject(Ui);

  readonly id = input<string>('');
  /** ?tab=stock opens that section straight away (the view page links here). */
  readonly tab = input<string>('');
  readonly action = input<string>('');
  readonly supplier = input<string>('');
  readonly returnTo = input<string>('');

  /** Colours already in use on other products, with the swatch they carry. */
  private readonly usedColours = signal<Map<string, string | null>>(new Map());

  /** Every product in the order the catalogue list shows them by default. */
  private readonly catalogueOrder = signal<Product[]>([]);
  readonly neighbours = computed(() => {
    const id = this.draft().id;
    const order = this.catalogueOrder();
    if (id === null || !order.length) return null;
    const index = order.findIndex((product) => product.id === id);
    if (index < 0) return null;
    return {
      index, total: order.length,
      previous: index > 0 ? order[index - 1] : null,
      next: index < order.length - 1 ? order[index + 1] : null,
    };
  });

  /**
   * The pick-list: the standard colours, then every colour typed once on
   * any product (Navy, Cherry Pink, …). A colour entered via "Anders…"
   * is saved with the product and shows up here for the next one, so
   * the list grows with the catalogue instead of forcing retyping.
   */
  readonly standardColours = computed<readonly string[]>(() => {
    const extra = [...this.usedColours().keys()]
        .filter((colour) => !(STANDARD_COLOURS as readonly string[]).includes(colour))
        .sort((a, b) => a.localeCompare(b, 'nl'));
    return [...STANDARD_COLOURS, ...extra];
  });
  /** True while a colour outside the list is being typed. */
  readonly customColour = signal(false);

  /** What the select should show for the current draft colour. */
  colourChoice(): string {
    if (this.customColour()) return '__other__';
    const colour = this.draft().colour ?? '';
    if (!colour) return '';
    return this.standardColours().includes(colour) ? colour : '__other__';
  }

  pickColour(choice: string): void {
    if (choice === '__other__') {
      const current = this.draft().colour ?? '';
      if (this.standardColours().includes(current)) {
        this.patch({ colour: '', colourHex: null });
      }
      this.customColour.set(true);
      return;
    }
    this.customColour.set(false);
    /* Choosing from the list means the list's swatch - also when the name
       was already this one but carried a hand-picked sample. */
    const swatch = choice ? (COLOUR_SWATCHES[choice] ?? this.usedColours().get(choice) ?? null) : null;
    this.patch({ colour: choice, colourHex: swatch });
  }

  setProductColour(colour: string): void {
    const changed = this.normalizeColour(colour) !== this.normalizeColour(this.draft().colour);
    /* A standard colour brings its own swatch; a hand-picked sample on the
       same colour stays, a colour change starts from the default again. */
    const swatch = COLOUR_SWATCHES[colour.trim()] ?? this.usedColours().get(colour.trim()) ?? null;
    this.patch({ colour, ...(changed ? { colourHex: swatch } : {}) });
  }

  emptyToNull(value: string | null | undefined): string | null {
    return value?.trim() || null;
  }

  pickerColour(value: string | null | undefined): string {
    return /^#[0-9a-f]{6}$/i.test(value ?? '') ? value! : '#b01f3f';
  }

  setProductColourHex(event: Event): void {
    /* An exact sample on a list colour is, by definition, no longer that
       list colour: the chip flips to "Anders" with the name kept. */
    if (!this.customColour() && this.colourChoice() !== '__other__') this.customColour.set(true);
    this.patch({ colourHex: this.colourFromPicker(event) });
  }

  swatchFor(colour: string): string {
    return COLOUR_SWATCHES[colour] ?? this.usedColours().get(colour) ?? '#d9d2cc';
  }

  readonly draft = signal<Product>(blankProduct(null, 'USD'));
  readonly suppliers = signal<Supplier[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly hsCodes = signal<HsCode[]>([]);
  readonly families = signal<ProductFamily[]>([]);
  readonly family = signal<ProductFamily | null>(null);
  readonly familyLoading = signal(false);
  readonly familyLoadError = signal(false);
  private familyLoadVersion = 0;
  private readonly savedFamily = signal<ProductFamily | null>(null);
  private readonly savedProductFamilyId = signal<number | null>(null);
  private productLoadVersion = 0;
  private activeProductId: number | null = null;
  readonly familyDirty = computed(() =>
    JSON.stringify(this.family()) !== JSON.stringify(this.savedFamily()));
  readonly saving = signal(false);
  /** Saved at least once on this screen: the button then reads "Opnieuw opslaan". */
  readonly savedHere = signal(history.state?.savedHere === true);
  readonly saveError = signal<string | null>(null);
  readonly productLoadError = signal<string | null>(null);
  readonly translationDirty = signal(false);
  readonly translationSaving = signal(false);
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
  readonly stockHistory = signal<StockMovement[] | null>(null);

  private async loadStockHistory(productId: number): Promise<void> {
    this.stockHistory.set(null);
    try {
      this.stockHistory.set(await this.catalog.stockMovements(productId));
    } catch {
      this.stockHistory.set([]);
    }
  }

  /* ---- move pieces between two locations ---- */
  readonly transferDraft = signal<{ fromId: number; toId: number; quantity: number; note: string } | null>(null);

  startTransfer(levels: ProductStock[]): void {
    this.stockEditing.set(null);
    const from = levels.find((level) => level.quantity > 0) ?? levels[0];
    const to = levels.find((level) => level.locationId !== from.locationId) ?? levels[0];
    this.transferDraft.set({ fromId: from.locationId, toId: to.locationId, quantity: 0, note: '' });
  }

  patchTransfer(changes: Partial<{ fromId: number; toId: number; quantity: number; note: string }>): void {
    this.transferDraft.update((move) => move ? { ...move, ...changes } : move);
  }

  /* ---- broken or given away: out of stock under its own kind ---- */
  readonly takeOutDraft = signal<{ kind: 'DAMAGED' | 'DEMO'; locationId: number; quantity: number; note: string } | null>(null);

  /** Lifetime counts from the stock book: how much broke, how much went out as demo. */
  readonly lossCounters = computed(() => {
    const moves = this.stockHistory();
    if (!moves) return null;
    let damaged = 0, demo = 0;
    for (const move of moves) {
      if (move.kind === 'DAMAGED') damaged += Math.abs(move.delta);
      if (move.kind === 'DEMO') demo += Math.abs(move.delta);
    }
    return { damaged, demo };
  });

  startTakeOut(levels: ProductStock[], kind: 'DAMAGED' | 'DEMO'): void {
    this.transferDraft.set(null);
    const first = levels.find((level) => level.quantity > 0) ?? levels[0];
    this.takeOutDraft.set({ kind, locationId: first?.locationId ?? 0, quantity: 1, note: '' });
  }

  patchTakeOut(changes: Partial<{ locationId: number; quantity: number; note: string }>): void {
    this.takeOutDraft.update((draft) => draft && { ...draft, ...changes });
  }

  async confirmTakeOut(): Promise<void> {
    const id = this.draft().id;
    const out = this.takeOutDraft();
    if (id === null || !out || this.stockSaving()) return;
    if (!(out.quantity > 0)) { this.ui.toast('Geef een aantal op', 'err'); return; }
    this.stockSaving.set(true);
    try {
      const saved = await this.catalog.takeOutStock(id, { locationId: out.locationId, quantity: out.quantity, kind: out.kind, note: out.note || null });
      this.draft.update((p) => ({ ...p, stockQuantity: saved.stockQuantity, inventoryKnown: saved.inventoryKnown }));
      const baseline = this.baseline();
      if (baseline) {
        const parsed = JSON.parse(baseline) as Product;
        this.baseline.set(JSON.stringify({ ...parsed, stockQuantity: saved.stockQuantity, inventoryKnown: saved.inventoryKnown }));
      }
      this.takeOutDraft.set(null);
      this.ui.toast(out.kind === 'DAMAGED' ? `${out.quantity} stuks als beschadigd afgeboekt` : `${out.quantity} stuks als demo afgeboekt`, 'ok');
      void this.loadStockHistory(id);
      void this.loadStockLevels(id);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Afboeken mislukt'), 'err');
    } finally {
      this.stockSaving.set(false);
    }
  }

  async confirmTransfer(): Promise<void> {
    const id = this.draft().id;
    const move = this.transferDraft();
    if (id === null || !move || this.stockSaving()) return;
    if (!(move.quantity > 0)) { this.ui.toast('Geef een aantal op', 'err'); return; }
    if (move.fromId === move.toId) { this.ui.toast('Kies twee verschillende locaties', 'err'); return; }
    this.stockSaving.set(true);
    try {
      const saved = await this.catalog.transferStock(id, move.fromId, move.toId, move.quantity, move.note || null);
      this.draft.update((p) => ({ ...p, stockQuantity: saved.stockQuantity, inventoryKnown: saved.inventoryKnown }));
      const baseline = this.baseline();
      if (baseline) {
        const parsed = JSON.parse(baseline) as Product;
        this.baseline.set(JSON.stringify({ ...parsed, stockQuantity: saved.stockQuantity, inventoryKnown: saved.inventoryKnown }));
      }
      this.transferDraft.set(null);
      this.ui.toast(`${move.quantity} stuks verplaatst`, 'ok');
      void this.loadStockHistory(id);
      void this.loadStockLevels(id);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Verplaatsen mislukt'), 'err');
    } finally {
      this.stockSaving.set(false);
    }
  }

  /* ---- strike a line from the stock book: swipe left, no question ---- */
  readonly moveSwiped = signal<number | null>(null);
  readonly moveDeleting = signal<number | null>(null);
  private moveTouchX = 0;
  private moveTouchY = 0;
  private moveSwipeHandled = false;

  readonly moveDragging = signal<number | null>(null);
  readonly moveOffset = signal(0);
  private moveHorizontal = false;

  moveSwipeStart(event: TouchEvent, id: number): void {
    this.moveTouchX = event.touches[0].clientX;
    this.moveTouchY = event.touches[0].clientY;
    this.moveSwipeHandled = false;
    this.moveHorizontal = false;
    if (this.moveSwiped() !== null && this.moveSwiped() !== id) this.moveSwiped.set(null);
  }

  moveSwipeMove(event: TouchEvent, move: StockMovement): void {
    if (this.moveSwipeHandled) return;
    const dx = event.touches[0].clientX - this.moveTouchX;
    const dy = event.touches[0].clientY - this.moveTouchY;
    if (!this.moveHorizontal) {
      if (Math.hypot(dx, dy) < 8 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      this.moveHorizontal = true;
      this.moveDragging.set(move.id);
    }
    /* Already open: the finger starts from the parked position. */
    const base = this.moveSwiped() === move.id ? -76 : 0;
    this.moveOffset.set(Math.min(0, base + dx));
  }

  moveSwipeEnd(move: StockMovement): void {
    if (this.moveDragging() !== move.id) return;
    const offset = this.moveOffset();
    this.moveDragging.set(null);
    this.moveOffset.set(0);
    if (offset < -140) {
      this.moveSwipeHandled = true;
      void this.deleteMove(move);
      return;
    }
    this.moveSwipeHandled = true;
    this.moveSwiped.set(offset < -40 ? move.id : null);
  }

  async deleteMove(move: StockMovement): Promise<void> {
    const productId = this.draft().id;
    if (productId === null || this.moveDeleting() !== null) return;
    this.moveDeleting.set(move.id);
    this.moveSwiped.set(null);
    try {
      await this.catalog.deleteStockMovement(productId, move.id);
      this.stockHistory.update((history) => history?.filter((item) => item.id !== move.id) ?? null);
      this.ui.toast(`Regel verwijderd · voorraad blijft ${this.draft().stockQuantity}`);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Regel verwijderen mislukt'), 'err');
    } finally {
      this.moveDeleting.set(null);
    }
  }

  /** The pieces per location; null while loading. */
  readonly stockLevels = signal<ProductStock[] | null>(null);
  readonly stockTotal = computed(() => (this.stockLevels() ?? []).reduce((sum, level) => sum + level.quantity, 0));
  /** The location being corrected, or null. */
  readonly stockEditing = signal<number | null>(null);
  readonly stockDraft = signal<number | null>(null);
  readonly stockSaving = signal(false);

  private async loadStockLevels(productId: number): Promise<void> {
    try {
      this.stockLevels.set(await this.catalog.productStock(productId));
    } catch {
      this.stockLevels.set([]);
    }
  }

  startStockEdit(level: ProductStock): void {
    this.transferDraft.set(null);
    this.stockDraft.set(level.quantity);
    this.stockEditing.set(level.locationId);
    setTimeout(() => document.getElementById('p-stock-' + level.locationId)?.focus());
  }

  async saveStock(locationId: number): Promise<void> {
    const id = this.draft().id;
    const quantity = this.stockDraft();
    if (id === null || this.stockSaving()) return;
    if (quantity === null || !Number.isInteger(Number(quantity)) || Number(quantity) < 0) {
      this.ui.toast('Geef een heel aantal stuks op (0 of meer).', 'err');
      return;
    }
    this.stockSaving.set(true);
    try {
      const saved = await this.catalog.setStock(id, Number(quantity), locationId);
      /* Only the stock figures change; the rest of the form keeps the
         user's unsaved edits. */
      this.draft.update((p) => ({ ...p, stockQuantity: saved.stockQuantity, inventoryKnown: saved.inventoryKnown }));
      /* The baseline follows, or the form would count a saved stock figure
         as an unsaved change and nag on leaving. */
      const baseline = this.baseline();
      if (baseline) {
        const parsed = JSON.parse(baseline) as Product;
        this.baseline.set(JSON.stringify(
          { ...parsed, stockQuantity: saved.stockQuantity, inventoryKnown: saved.inventoryKnown }));
      }
      this.stockEditing.set(null);
      this.ui.toast(`Voorraad gezet op ${quantity}`, 'ok');
      void this.loadStockHistory(id);
      void this.loadStockLevels(id);
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Voorraad aanpassen mislukt'), 'err');
    } finally {
      this.stockSaving.set(false);
    }
  }

  readonly innerCheck = signal<{ valid: boolean; message: string } | null>(null);
  readonly outerCheck = signal<{ valid: boolean; message: string } | null>(null);
  readonly packagingCheck = signal<{ valid: boolean; message: string } | null>(null);
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
      return `${label} bestaat al bij de gekoppelde producten${duplicate.sku ? ` (${duplicate.sku})` : ''}.`;
    }
    return null;
  });

  readonly canCopyVariant = computed(() =>
    !this.saving()
    && !this.photoUploading()
    && !this.translationSaving()
    && !this.translationDirty()
    && !this.copyVariantLoading()
    && !this.copyVariantCheckFailed()
    && !this.copyVariantConflict());

  constructor() {
    window.addEventListener('scroll', this.onScroll, { passive: true });
    void this.loadReference();
    void this.loadFamilies();
    /* React to the route id only. Everything else runs untracked: loadProduct
       reads and writes draft/translation signals synchronously, and with
       those as dependencies the effect re-ran on its own writes before
       activeProductId was set - an endless stream of GET /api/products/:id
       until the browser ran out of sockets. */
    effect(() => {
      const routeId = this.id();
      untracked(() => {
        if (routeId && routeId !== 'new') {
          const productId = +routeId;
          if (this.activeProductId !== null && productId !== this.activeProductId
              && (this.translationSaving()
                || (this.translationDirty() && !this.confirmDiscardTranslations()))) {
            const currentId = this.activeProductId;
            queueMicrotask(() => void this.router.navigate(
              ['/products', currentId, 'edit'], { replaceUrl: true }));
            return;
          }
          if (productId !== this.activeProductId) void this.loadProduct(productId);
        } else {
          ++this.productLoadVersion;
          this.productLoadError.set(null);
        }
      });
    });
  }

  async retryProductLoad(): Promise<void> {
    const productId = Number(this.id());
    if (Number.isInteger(productId) && productId > 0) await this.loadProduct(productId);
  }

  private async loadProduct(productId: number): Promise<void> {
    const version = ++this.productLoadVersion;
    this.productLoadError.set(null);
    if (this.draft().id !== productId) {
      ++this.familyLoadVersion;
      this.setFamilyDraft(null);
      this.savedProductFamilyId.set(null);
      this.translationDirty.set(false);
      this.translationSaving.set(false);
      this.draft.set(blankProduct(null, 'USD'));
      this.markClean();
    }
    try {
      const product = await this.catalog.product(productId);
      if (version !== this.productLoadVersion || Number(this.id()) !== productId) return;
      this.savedProductFamilyId.set(product.familyId ?? null);
      this.activeProductId = productId;
      this.draft.set(product);
      void this.loadStockHistory(productId);
      void this.loadStockLevels(productId);
      const wanted = this.tab();
      if (wanted && this.tabs().some((item) => item.id === wanted)) {
        setTimeout(() => this.showTab(wanted), 50);
      }
      /* Arriving from the product page's "Beschadigd" / "Demo": open that form at once. */
      const action = this.action();
      if (action === 'damaged' || action === 'demo') {
        const levels = await this.loadStockLevels(productId).then(() => this.stockLevels() ?? []);
        if (levels.length) this.startTakeOut(levels, action === 'damaged' ? 'DAMAGED' : 'DEMO');
      }
      this.syncPriceStrategy(product);
      this.markClean();
      await this.loadFamilyForProduct(product);
    } catch (failure: unknown) {
      if (version !== this.productLoadVersion || Number(this.id()) !== productId) return;
      this.productLoadError.set(messageOf(failure, 'Controleer de verbinding en probeer opnieuw.'));
    }
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
    const version = ++this.familyLoadVersion;
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
        if (version !== this.familyLoadVersion) return;
        family = null;
        this.familyLoadError.set(true);
      }
    }
    if (version !== this.familyLoadVersion) return;
    if (!this.familyLoadError()) this.setFamilyDraft(family);
    this.familyLoading.set(false);
  }

  retryFamily(): void {
    const product = this.draft();
    if (!this.familyLoading() && product.familyId !== null) void this.loadFamilyForProduct(product);
  }

  private async loadReference(): Promise<void> {
    const [suppliers, categories, hsCodes, allProducts] = await Promise.all([
      this.sourcing.suppliers(), this.catalog.categories(), this.catalog.hsCodes(),
      this.catalog.products().catch(() => [] as Product[]),
    ]);
    this.suppliers.set(suppliers);
    this.categories.set(categories);
    this.hsCodes.set(hsCodes);
    const used = new Map<string, string | null>();
    for (const product of allProducts) {
      const colour = product.colour?.trim();
      if (!colour) continue;
      if (!used.has(colour) || (!used.get(colour) && product.colourHex)) {
        used.set(colour, product.colourHex ?? null);
      }
    }
    this.usedColours.set(used);
    this.catalogueOrder.set(orderLikeTheList(allProducts, categories));

    if (!this.id() || this.id() === 'new') {
      const supplierId = this.supplier() ? +this.supplier() : (suppliers[0]?.id ?? null);
      const currency = suppliers.find((s) => s.id === supplierId)?.currency ?? 'USD';
      this.draft.set(blankProduct(supplierId, currency));
      this.savedProductFamilyId.set(null);
      /* New products open on a fixed price (how fair deals are agreed);
         the 45% markup stays remembered for a tap to the other option. */
      this.lastMarkupPct.set(45);
      this.priceStrategy.set('FIXED');
      this.patch({ markupPct: 0 });
      this.markClean();
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
    // Only the stable family FK/publication draft owns public state. Legacy
    // flat statuses on an unlinked SKU must never make it look publishable.
    const publicationStarted = family !== null;
    if (!publicationStarted) return [];
    const server = family?.publicationIssues ?? [];
    const issues: string[] = [...server];
    if (!product.active) issues.push('Zet het product actief.');
    if (!product.name.trim()) issues.push('Vul een productnaam in.');
    if (!product.categoryId) issues.push('Kies een categorie.');
    if (!family) {
      issues.push('Start gedeelde websitegegevens voor deze productreeks.');
    } else {
      if (!family.name.trim()) issues.push('Vul de publieke productnaam in.');
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

  patchPackaging(changes: Partial<Product['packaging']>): void {
    this.draft.update((p) => ({ ...p, packaging: { ...this.packagingOf(p), ...changes } }));
  }

  patchPackagingDimensions(changes: Partial<Dimensions>): void {
    this.draft.update((p) => {
      const packaging = this.packagingOf(p);
      return { ...p, packaging: { ...packaging, dimensions: { ...packaging.dimensions, ...changes } } };
    });
  }

  /** Products loaded from an older API answer may not carry packaging yet. */
  private packagingOf(product: Product): Product['packaging'] {
    return product.packaging
      ?? { kind: 'NONE', dimensions: { lengthCm: null, widthCm: null, heightCm: null }, barcode: null };
  }

  patchCarton(changes: Partial<Product['carton']>): void {
    this.draft.update((p) => ({ ...p, carton: { ...p.carton, ...changes } }));
  }

  onPublicTranslationsSaved(snapshot: ProductPublicTranslationsSnapshot): void {
    if (this.draft().id !== snapshot.productId
        || (this.family()?.id ?? null) !== snapshot.familyId) return;
    this.draft.update((product) => ({
      ...product,
      texts: structuredClone(snapshot.productTexts),
      publicationIssues: structuredClone(snapshot.product.publicationIssues),
    }));
    this.family.update((family) => family
      ? this.mergePublicTranslations(family, snapshot)
      : family);
    this.savedFamily.update((family) => family
      ? this.mergePublicTranslations(family, snapshot)
      : family);
    this.families.update((families) => families.map((family) =>
      family.id === snapshot.familyId
        ? this.mergePublicTranslations(family, snapshot)
        : family));
    this.translationDirty.set(false);
  }

  onFamilyChange(family: ProductFamily): void {
    this.family.set(family);
    this.patch({
      familyId: family.id,
      familyKey: family.familyKey,
      ...this.variantPublicationFields(),
    });
  }

  async onVariantLinked(family: ProductFamily): Promise<void> {
    if (this.translationDirty() || this.translationSaving()) return;
    const productId = this.draft().id;
    this.replaceFamily(family);
    this.savedProductFamilyId.set(family.id);
    if (productId === null) return;

    this.saving.set(true);
    try {
      const serverProduct = await this.catalog.product(productId);
      this.draft.update((current) => ({
        ...current,
        familyId: family.id,
        familyKey: family.familyKey,
        categoryId: family.categoryId,
        canonicalVariantKey: serverProduct.canonicalVariantKey,
        variantPosition: serverProduct.variantPosition,
        photos: serverProduct.photos,
        publicationIssues: serverProduct.publicationIssues,
        describedAs: serverProduct.describedAs,
        cartonCbm: serverProduct.cartonCbm,
        pieceCbm: serverProduct.pieceCbm,
      }));
    } catch {
      this.ui.toast('Variant gekoppeld, maar de bijgewerkte productgegevens konden niet worden geladen.', 'err');
    } finally {
      this.saving.set(false);
    }
  }

  startNewFamily(): void {
    if (this.translationDirty() || this.translationSaving()) return;
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

  private mergePublicTranslations(
    family: ProductFamily,
    snapshot: ProductPublicTranslationsSnapshot,
  ): ProductFamily {
    if (!snapshot.family) return family;
    const imageTranslations = new Map(snapshot.images.map((image) => [image.imageId, image]));
    return {
      ...family,
      name: snapshot.family.name,
      summary: snapshot.family.summary,
      description: snapshot.family.description,
      format: snapshot.family.format,
      highlights: structuredClone(snapshot.family.highlights),
      seoTitle: snapshot.family.seoTitle,
      seoDescription: snapshot.family.seoDescription,
      texts: structuredClone(snapshot.familyTexts),
      publicationIssues: structuredClone(snapshot.family.publicationIssues),
      images: family.images.map((image) => {
        const translated = imageTranslations.get(image.id);
        return translated
          ? { ...image, altTexts: structuredClone(translated.altTexts) }
          : image;
      }),
    };
  }

  async uploadFamilyImage(file: File): Promise<void> {
    if (this.saving() || this.translationDirty() || this.translationSaving()) return;
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
    if (!family?.id || this.saving() || this.translationDirty() || this.translationSaving()) return;
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
    if (this.saving() || this.translationDirty() || this.translationSaving()) return;
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
    /* A brand-new product opens on a fixed price - that is how prices
       are agreed at the fair; markup stays one tap away. */
    if (product.id === null) {
      this.lastMarkupPct.set(product.markupPct ?? 0);
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

  /* ---- a free code from the company's EAN list ---- */
  readonly takingCode = signal(false);

  async takeCode(which: 'inner' | 'outer' | 'packaging'): Promise<void> {
    if (this.takingCode()) return;
    this.takingCode.set(true);
    try {
      /* Only a look at the next free code; it leaves the list when this product is saved. */
      const taken = await this.catalog.nextBarcode();
      if (which === 'inner') this.patch({ barcodeInner: taken.code });
      else if (which === 'outer') this.patch({ barcodeOuter: taken.code });
      else this.patchPackaging({ barcode: taken.code });
      void this.check(taken.code, which);
      this.ui.toast(`${taken.code} klaargezet · verlaat de lijst bij Opslaan (${taken.remaining} vrij)`, 'ok');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Geen code gekregen'), 'err');
    } finally {
      this.takingCode.set(false);
    }
  }

  /**
   * Lets the server verify the check digit and whether the code is still
   * free - one place where those rules live. A taken code names the
   * product and level it sits on.
   */
  async check(value: string, which: 'inner' | 'outer' | 'packaging'): Promise<void> {
    const target = which === 'inner' ? this.innerCheck
      : which === 'outer' ? this.outerCheck : this.packagingCheck;
    if (!value) { target.set(null); return; }
    target.set(await this.catalog.checkBarcode(value, this.draft().id));
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
    if (this.photoUploading() || this.translationDirty() || this.translationSaving()) return;
    const source = this.draft();
    const colour = source.colour ?? '';
    this.copyColour.set(colour);
    this.copyColourHex.set(source.colourHex ?? null);
    this.copySize.set(source.variantSize ?? '');
    this.copyCustomColour.set(
      !!colour && !this.standardColours().includes(colour),
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
    if (this.translationDirty() || this.translationSaving()) return;
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
      this.ui.toast(`${copy.sku} aangemaakt en gekoppeld — vul de barcodes en foto's nog aan`);
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
    if (this.saving() || this.photoUploading() || this.translationSaving()) return;
    /* Every reason not to save is said out loud and the screen jumps to
       the field - a greyed-out button explained nothing. */
    const missing: { tab: string; field: string; label: string }[] = [];
    if (!this.draft().supplierId) missing.push({ tab: 'identity', field: 'p-supplier', label: 'leverancier' });
    if (!this.draft().name.trim()) missing.push({ tab: 'identity', field: 'p-name', label: 'productnaam' });
    if ((this.draft().carton.piecesPerCarton ?? 0) <= 0) {
      missing.push({ tab: 'packaging', field: 'p-ppc', label: 'stuks per karton' });
    }
    if (this.draft().packaging.kind === 'DISPLAY' && !((this.draft().packaging.piecesPerUnit ?? 0) >= 1)) {
      missing.push({ tab: 'identity', field: 'p-packaging-pieces', label: 'stuks in de display' });
    }
    if (this.priceStrategy() === 'FIXED' && (this.draft().fixedSalesPriceEur ?? 0) <= 0) {
      missing.push({ tab: 'sales', field: 'p-price', label: 'vaste verkoopprijs (hoger dan € 0)' });
    }
    if (missing.length) {
      const first = missing[0];
      this.ui.toast(`Nog invullen: ${missing.map((m) => m.label).join(', ')}.`, 'err');
      this.showTab(first.tab);
      setTimeout(() => document.getElementById(first.field)?.focus(), 250);
      return;
    }
    const wasNew = this.isNew();
    const queuedPhotoCount = this.photoManager()?.pendingCount() ?? 0;
    this.saveError.set(null);
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
      this.markClean();
      this.savedProductFamilyId.set(saved.familyId ?? null);
      this.ui.toast(wasNew
        ? (queuedPhotoCount ? 'Product met foto’s aangemaakt' : 'Product aangemaakt')
        : 'Opgeslagen');
      /* Saving keeps you on the form: the next tweak is usually seconds
         away. A caller that sent us here with a return address (a sales
         order creating a product) still gets its product back. */
      const back = this.returnTo();
      if (back) {
        await this.router.navigateByUrl(back);
        return;
      }
      this.savedHere.set(true);
      if (saved.id !== null) { void this.loadStockHistory(saved.id); void this.loadStockLevels(saved.id); }
      if (wasNew && saved.id !== null) {
        await this.router.navigate(['/products', saved.id, 'edit'],
          { replaceUrl: true, state: { savedHere: true } });
      }
    } catch (failure: unknown) {
      const fallback = wasNew && this.draft().id !== null
        ? 'Product is aangemaakt, maar kon nog niet volledig worden afgewerkt'
        : 'Opslaan mislukt';
      const message = messageOf(failure, fallback);
      /* A publication blocker is not a dead end: open the fix sheet with
         the missing pieces spelled out, fillable on the spot. */
      const plan = this.planPublishFix(message);
      if (plan) {
        this.publishFix.set(plan);
        return;
      }
      this.saveError.set(message);
      this.ui.toast(message, 'err');
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
    const sibling = this.pendingVariant();
    if (created.id !== null && sibling?.id != null) {
      try {
        const family = await this.catalog.linkProductVariant(created.id, sibling.id);
        created.familyId = family.id;
        this.pendingVariant.set(null);
        this.ui.toast(`Gekoppeld aan ${sibling.name}`, 'ok');
      } catch (failure) {
        this.ui.toast(messageOf(failure, 'Variant koppelen mislukt - het product is wel aangemaakt'), 'err');
      }
    }
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
    if (this.photoUploading() || this.translationDirty() || this.translationSaving()) return;
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

  canDeactivate(): boolean | Promise<boolean> {
    if (this.translationSaving()) return false;
    if (this.translationDirty()) return this.confirmDiscardTranslations();
    if (!this.dirty() || this.saving()) return true;
    /* Unsaved product fields: ask in our own words - save, drop, or stay. */
    return new Promise<boolean>((resolve) => {
      this.leaveQuestion.set(async (keep) => {
        this.leaveQuestion.set(null);
        if (keep === null) { resolve(false); return; }
        if (keep) {
          await this.save();
          resolve(!this.dirty());
          return;
        }
        resolve(true);
      });
    });
  }

  @HostListener('window:beforeunload', ['$event'])
  warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.dirty() && !this.translationDirty() && !this.translationSaving()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  private confirmDiscardTranslations(): boolean {
    return window.confirm(
      'Je hebt productvertalingen die nog niet zijn opgeslagen. Dit scherm toch verlaten?',
    );
  }
}


/** One missing text of this product, fillable per language. */
interface PublishFixItem {
  field: 'size' | 'name' | 'color' | string;
  label: string;
  base: string;
  languages: LanguageCode[];
  values: Record<string, string>;
}

interface PublishFixPlan {
  family: string;
  items: PublishFixItem[];
  swatch: boolean;
  swatchHex: string;
  notes: string[];
}
