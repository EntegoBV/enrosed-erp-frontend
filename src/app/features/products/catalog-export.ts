import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { AuthImage } from '../../core/api/auth-image';
import { catalogueFamilies, cataloguePhoto } from './catalog-studio';
import { gpCapacityHint, isAutoGpCapacity, readGpCapacity } from './carton-capacity';
import { CataloguePhotoSelectionChange } from './catalogue-photo-selection';
import { CataloguePhotoImport } from './catalogue-photo-import';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  CatalogApi,
  CatalogExportRequest,
  CatalogLayout,
  CatalogOrder,
  CatalogPreflightResult,
  CatalogPriceIssue,
  CatalogPriceOverride,
} from '../../core/api/catalog-api';
import { CustomerPriceApi, type CustomerPrice } from '../../core/api/customer-price-api';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import { Category, Customer, LANGUAGES, LanguageCode, Product, ProductFamily } from '../../core/api/models';
import { SalesApi } from '../../core/api/sales-api';
import { DateField } from '../../shared/date-field';
import { PageHeader } from '../../shared/page-header';
import { Ui } from '../../shared/ui';
import {
  CATALOG_LOAD_STANDARD, catalogCarriers, catalogLoadDeviation, catalogLoadFields, catalogLoadProblem, catalogueUnits, restoreCatalogLoad, storeCatalogLoad,
  type CatalogLoad,
} from './catalog-load';
import { CatalogLoadSettings, type CatalogLoadExample } from './catalog-load-settings';
import { CatalogPriceSheet } from './catalog-price-sheet';
import {
  basisChanged, changesPrint, printedPrice, recipientSlug, requestOverrides, standardPrice, storedOverride, todayIso,
} from './catalog-prices';
import {
  CatalogBrochureDraft,
  CatalogBrochureSettings,
} from './catalog-brochure-settings';
import { CatalogProductSelection } from './catalog-product-selection';
import { CatalogProductArrangement } from './catalog-product-arrangement';
import {
  catalogTranslationAffectedProductIds,
  catalogTranslationLinks,
} from './catalog-translation-issues';
import { applyCatalogProductOrder, orderCatalogProducts, reorderCatalogSelection } from './catalog-product-order';
import { deselectProductIds, selectProductIds } from './catalog-product-selection-state';
import { catalogOrderChanged, initialCatalogOrderIds, normalizedCatalogOrderIds } from './catalog-saved-order';
import { productText } from './product-translation-adapter';
import { productSalesUnit } from './product-sales-unit';
import { StaffContactPhones } from '../../shared/staff-contact-phones';

const STATE_KEY = 'enrosed.catalogBuilder.v3';
const LEGACY_STATE_KEY = 'enrosed.catalogBuilder.v2';
/** Who the PDF is for and its one-off prices: this tab only, never in the device draft, so the next customer cannot inherit them. */
const PRICE_STATE_KEY = 'enrosed.catalogBuilder.prices.v1';

interface CatalogPriceState {
  version: 1;
  customerId: number | null;
  /** "Andere naam…": a recipient without a customer record (a fair lead), with no stored prices. */
  named: boolean;
  recipientName: string;
  pricesValidUntil: string;
  overrides: CatalogPriceOverride[];
  /** Who the one-off prices were typed for (recipientKey); absent in a tab stored before it existed. */
  pricesFor?: PricesFor | null;
}

/** The recipient one-off prices belong to: its key and the name as it was typed. */
interface PricesFor {
  key: string;
  name: string;
}

/** A free name as a recipient: case and spacing do not make another lead. */
function nameKey(name: string): string {
  return `n:${name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('nl-BE')}`;
}

/** "per display", "per stolp" (NL, the product's own unit) or the language's word for a piece. */
function unitAfterPrice(product: Product, language: LanguageCode, copy: { perPiece: string; perDisplay: string }): string {
  const unit = productSalesUnit(product);
  if (unit.isDisplay) return copy.perDisplay;
  return language === 'NL' ? unit.piece.per : copy.perPiece;
}

/** The pallet and the kar of a PDF nobody picked a height or a spill for (260 / 230 / 2 cm): what decides which product the example names. */
const STANDARD_CARRIERS = catalogCarriers(CATALOG_LOAD_STANDARD);

interface CatalogBuilderState extends CatalogBrochureDraft {
  version: 2 | 3;
  layout: CatalogLayout;
  language: LanguageCode;
  intro: string;
  includePrices: boolean;
  includePhotos: boolean;
  /** "PDF verkleinen": the server makes the photos lighter, about 10 MB for the whole range; on unless turned off. */
  compressPdf?: boolean;
  selectedIds: number[];
  /** All available products, so deselecting and reselecting retains their position. */
  orderedIds?: number[];
}

const DEFAULT_BROCHURE: CatalogBrochureDraft = {
  photosPerProduct: 1,
  coverTitle: '',
  coverSubtitle: '',
  includeOverview: true,
  includeCategoryIntros: false,
  includeCustomisation: true,
  includeOrdering: true,
  includeBackCover: true,
};

/* The preview's own words per document language; the PDF takes its copy from the catalogue texts. */
const COMPACT_PREVIEW_COPY: Record<LanguageCode, {
  title: string; onRequest: string; empty: string;
  /** The ribbon's labels, as the PDF's catalogue texts say them (catalog.common.carton, .simple.pallet, .kar, .short20ft, .short40ft), shortened. */
  carton: string; pallet: string; kar: string; gp: string; hc: string;
  priceListFor: string;
  /** After a price, as the PDF's catalog.simple.perpiece and its display word say it; NL names the product's own unit. */
  perPiece: string; perDisplay: string;
}> = {
  NL: { title: 'Compact overzicht', onRequest: 'Prijs op aanvraag', empty: 'Kies producten voor uw overzicht.', carton: 'Omdoos', pallet: 'Pallet', kar: 'Deense kar', gp: '20ft GP', hc: '40ft HC', priceListFor: 'Prijslijst voor {name}', perPiece: 'per stuk', perDisplay: 'per display' },
  EN: { title: 'Compact overview', onRequest: 'Price on request', empty: 'Select products for your overview.', carton: 'Carton', pallet: 'Pallet', kar: 'Danish trolley', gp: '20ft GP', hc: '40ft HC', priceListFor: 'Price list for {name}', perPiece: 'per piece', perDisplay: 'per display' },
  FR: { title: 'Aperçu compact', onRequest: 'Prix sur demande', empty: 'Sélectionnez les produits à présenter.', carton: 'Carton', pallet: 'Palette', kar: 'Chariot danois', gp: '20\' GP', hc: '40\' HC', priceListFor: 'Liste de prix pour {name}', perPiece: 'par pièce', perDisplay: 'par présentoir' },
  DE: { title: 'Kompakte Übersicht', onRequest: 'Preis auf Anfrage', empty: 'Wählen Sie Produkte für Ihre Übersicht.', carton: 'Umkarton', pallet: 'Palette', kar: 'CC-Container', gp: '20\' GP', hc: '40\' HC', priceListFor: 'Preisliste für {name}', perPiece: 'pro Stück', perDisplay: 'pro Display' },
  ES: { title: 'Resumen compacto', onRequest: 'Precio a consultar', empty: 'Seleccione los productos del resumen.', carton: 'Caja', pallet: 'Palé', kar: 'Carro danés', gp: '20\' GP', hc: '40\' HC', priceListFor: 'Lista de precios para {name}', perPiece: 'por unidad', perDisplay: 'por expositor' },
  PL: { title: 'Skrócony przegląd', onRequest: 'Cena na zapytanie', empty: 'Wybierz produkty do zestawienia.', carton: 'Karton', pallet: 'Paleta', kar: 'Wózek duński', gp: '20\' GP', hc: '40\' HC', priceListFor: 'Cennik dla {name}', perPiece: 'za sztukę', perDisplay: 'za ekspozytor' },
  PT: { title: 'Resumo compacto', onRequest: 'Preço sob consulta', empty: 'Selecione os produtos para o resumo.', carton: 'Caixa', pallet: 'Palete', kar: 'Carro dinamarquês', gp: '20\' GP', hc: '40\' HC', priceListFor: 'Tabela de preços para {name}', perPiece: 'por unidade', perDisplay: 'por expositor' },
  TR: { title: 'Kompakt genel bakış', onRequest: 'Fiyat için iletişime geçin', empty: 'Özet için ürünleri seçin.', carton: 'Koli', pallet: 'Palet', kar: 'Danimarka arabası', gp: '20\' GP', hc: '40\' HC', priceListFor: '{name} için fiyat listesi', perPiece: 'adet başına', perDisplay: 'stand başına' },
  EL: { title: 'Συνοπτική επισκόπηση', onRequest: 'Τιμή κατόπιν αιτήματος', empty: 'Επιλέξτε προϊόντα για την επισκόπηση.', carton: 'Κιβώτιο', pallet: 'Παλέτα', kar: 'Δανέζικο καρότσι', gp: '20\' GP', hc: '40\' HC', priceListFor: 'Τιμοκατάλογος για {name}', perPiece: 'ανά τεμάχιο', perDisplay: 'ανά σταντ' },
};

@Component({
  selector: 'app-catalog-export',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AuthImage,
    CatalogBrochureSettings,
    CatalogLoadSettings,
    CatalogPriceSheet,
    CatalogProductSelection,
    CatalogProductArrangement,
    CataloguePhotoImport,
    DateField,
    FormsModule,
    PageHeader,
    RouterLink,
    StaffContactPhones,
  ],
  template: `
    <app-page-header
      title="Catalogus PDF"
      subtitle="Van je producten naar een PDF voor je klanten"
      [showBack]="true"
      [showBell]="false"
    />

    <div class="content content--with-action-bar catalog-page"
         [attr.aria-busy]="busy() || loading()">
      <app-catalogue-photo-import [disabled]="busy() || loading()"
        (workingChange)="importingPhotos.set($event)" (completed)="load()" />
      <fieldset class="catalog-workspace" [disabled]="busy()">
        <legend class="sr-only">Catalogus samenstellen</legend>

        <aside class="studio-preview" aria-labelledby="studio-preview-title">
          <div class="studio-preview__heading">
            <span>ENROSED · CATALOGUSSTUDIO</span>
            <span class="studio-preview__format">{{ layout() === 'BROCHURE' ? 'A4 · Brochure' : includePrices() ? 'A4 · Prijslijst' : 'A4 · Overzicht' }}</span>
          </div>
          <div class="cover-stage" [class.cover-stage--compact]="layout() === 'SIMPLE'">
            @if (layout() === 'BROCHURE') {
            <div class="cover-sheet">
              <div class="cover-sheet__copy">
                <img class="cover-sheet__brand" src="/catalog-logo-gold.png" alt="ENROSED" />
                <span class="cover-sheet__edition">WHOLESALE COLLECTION</span>
                @if (recipientLine()) { <span class="cover-sheet__recipient">{{ recipientLine() }}</span> }
                <h2 id="studio-preview-title">{{ previewTitle() }}<em>{{ previewSubtitle() }}</em></h2>
                <span class="cover-sheet__rule"></span>
              </div>
              <div class="cover-sheet__foot"><span>ENROSED.COM</span><span>{{ language() }}</span></div>
            </div>
            } @else {
              <div class="compact-sheet">
                <header class="compact-sheet__head">
                  <img src="/catalog-logo-gold.png" alt="ENROSED" />
                  <h2 id="studio-preview-title">{{ compactCopy().title }}</h2>
                  @if (recipientLine()) { <span class="compact-sheet__recipient">{{ recipientLine() }}</span> }
                  <span>{{ languageLabel() }}</span>
                </header>
                <div class="compact-sheet__rows">
                  @for (row of compactRows(); track row.id) {
                    <!-- One card per product, as the PDF: its colours as the picture, then pallet, kar, 20ft and 40ft together. -->
                    <div class="compact-card">
                      <div class="compact-card__head">
                        <b>{{ row.name }}</b>
                        @if (includePrices()) { <strong [class.is-stale]="row.priceStale">{{ row.price }}</strong> }
                      </div>
                      <span class="compact-card__meta">@if (row.dimensions) { {{ row.dimensions }} · }HS {{ row.hsCode ?? '–' }}@if (row.ean) { · EAN {{ row.ean }} }</span>
                      <div class="compact-card__colours">
                        @for (colour of row.colours; track colour.id) {
                          <span class="compact-card__colour">
                            @if (includePhotos() && colour.photoUrl) {
                              <img [appAuthSrc]="colour.photoUrl" [alt]="colour.name" />
                            } @else {
                              <i [style.background]="colour.hex ?? 'transparent'"></i>
                            }
                            <em>{{ colour.name }}</em>
                            <small>{{ colour.sku }}</small>
                          </span>
                        }
                        @if (row.moreColours) { <span class="compact-card__more">+ {{ row.moreColours }}</span> }
                      </div>
                      <dl class="compact-card__ribbon">
                        <div><dt>{{ compactCopy().carton }}</dt><dd>{{ row.perBox ?? '–' }}</dd></div>
                        <div><dt>{{ compactCopy().pallet }}</dt><dd>{{ row.perPallet ?? '–' }}</dd></div>
                        <div><dt>{{ compactCopy().kar }}</dt><dd>{{ row.perKar ?? '–' }}</dd></div>
                        <div><dt>{{ compactCopy().gp }}</dt><dd>{{ row.per20Ft ?? '–' }}@if (row.per20FtAuto) { <small [title]="row.per20FtHint">Auto</small> }</dd></div>
                        <div><dt>{{ compactCopy().hc }}</dt><dd>{{ row.per40Ft ?? '–' }}</dd></div>
                      </dl>
                    </div>
                  } @empty {
                    <p class="compact-sheet__empty">{{ compactCopy().empty }}</p>
                  }
                </div>
                <footer class="compact-sheet__foot">
                  <span>ENROSED.COM</span>
                  @if (compactHidden() > 0) { <span>+ {{ compactHidden() }}</span> }
                  <span>{{ language() }}</span>
                </footer>
              </div>
            }
          </div>
          <p class="preview-caption">Opmaakimpressie · de PDF gebruikt je gekozen teksten en foto’s.</p>
          <div class="studio-totals" aria-label="Inhoud van de catalogus">
            <span><b>{{ selectedFamilyCount() }}</b><small>productgroepen</small></span>
            <span><b>{{ selected().size }}</b><small>varianten</small></span>
            <span><b>{{ selectedCategoryCount() }}</b><small>categorieën</small></span>
          </div>
          @if (layout() === 'BROCHURE' && desktop.active() && previewProducts().length && includePhotos()) {
            <div class="preview-range" aria-label="Een blik op je selectie">
              @for (family of previewProducts(); track family.key) {
                @if (family.photo; as photo) {
                  <div [attr.title]="family.name"><img [appAuthSrc]="photo.url" [alt]="family.name" /></div>
                }
              }
            </div>
          }
          <p class="studio-note">{{ draftPersistence() === 'DEVICE' ? 'Je selectie en instellingen blijven bewaard op dit apparaat.' : draftPersistence() === 'SESSION' ? 'Je selectie en instellingen blijven bewaard in dit tabblad.' : 'Je selectie en instellingen blijven actief zolang dit scherm open is.' }} Gebruik ‘Volgorde opslaan’ om je volgorde voor volgende exports te bewaren.</p>
        </aside>

        <div class="catalog-settings">
          <section class="studio-section" aria-labelledby="catalog-mode-title">
            <div class="studio-section__head"><span class="studio-step">01</span><div>
              <h2 id="catalog-mode-title">Soort catalogus</h2>
              <p>Kies hoe je je collectie toont.</p>
            </div></div>
            <div class="mode-choice" role="group" aria-label="Soort catalogus">
              <button type="button" [class.active]="layout() === 'BROCHURE'"
                      [attr.aria-pressed]="layout() === 'BROCHURE'" (click)="layout.set('BROCHURE')">
                <span class="mode-choice__paper" aria-hidden="true"><i></i></span>
                <span class="mode-choice__copy"><b>Handelscatalogus</b><small>Fotografie, collectie en productdetails</small><em>Voor de beurs en je klanten</em></span>
                <span class="mode-choice__check" aria-hidden="true">{{ layout() === 'BROCHURE' ? '✓' : '' }}</span>
              </button>
              <button type="button" [class.active]="layout() === 'SIMPLE'"
                      [attr.aria-pressed]="layout() === 'SIMPLE'" (click)="layout.set('SIMPLE')">
                <span class="mode-choice__paper mode-choice__paper--list" aria-hidden="true"><i></i></span>
                <span class="mode-choice__copy"><b>Compact overzicht</b><small>SKU’s en productgegevens in een korte lijst</small></span>
                <span class="mode-choice__check" aria-hidden="true">{{ layout() === 'SIMPLE' ? '✓' : '' }}</span>
              </button>
            </div>
          </section>

          <section class="studio-section" aria-labelledby="catalog-content-title">
            <div class="studio-section__head"><span class="studio-step">02</span><div>
              <h2 id="catalog-content-title">Wat staat erin</h2>
              <p>Eén taal, consistent door de hele catalogus.</p>
            </div></div>
            <label class="field studio-language">
              <span>Documenttaal</span>
              <select class="select" [ngModel]="language()" (ngModelChange)="language.set($event)">
                @for (option of languages; track option.code) { <option [value]="option.code">{{ option.label }}</option> }
              </select>
            </label>
            <a class="linklike studio-texts-link" routerLink="/catalog/texts"
               [queryParams]="{ language: language(), returnTo: '/catalog-export' }">Catalogusteksten per taal ›</a>
            <div class="option-grid">
              <label class="option-toggle">
                <span><b id="catalog-prices-label">Prijzen tonen</b><small id="catalog-prices-help">{{ includePrices() ? 'Catalogusprijs per verkoopeenheid (bowl, display…), excl. btw en levering' : 'Zonder prijzen in de PDF' }}</small></span>
                <span class="option-toggle__control">
                  <span class="option-toggle__value" aria-hidden="true">{{ includePrices() ? 'Ja' : 'Nee' }}</span>
                  <input class="studio-switch" type="checkbox" role="switch" aria-labelledby="catalog-prices-label"
                         aria-describedby="catalog-prices-help" [ngModel]="includePrices()" (ngModelChange)="includePrices.set($event)" />
                </span>
              </label>
              @if (includePrices()) {
                <div class="price-target">
                  <div class="price-target__who">
                    <label class="field"><span>Voor klant (optioneel)</span>
                      <select class="select" #recipientSelect (change)="chooseRecipient(recipientSelect)">
                        <option value="" [selected]="recipientValue() === ''">Geen klant</option>
                        @if (customerId() !== null && !targetKnown()) {
                          <option [value]="recipientValue()" selected>{{ customersState() === 'ERROR' ? 'Klant #' + customerId() : 'Klanten laden…' }}</option>
                        }
                        @for (customer of customers(); track customer.id) {
                          <option [value]="'c' + customer.id" [selected]="recipientValue() === 'c' + customer.id">{{ customer.company }}{{ customer.city ? ' — ' + customer.city : '' }}</option>
                        }
                        <option value="name" [selected]="recipientValue() === 'name'">Andere naam…</option>
                      </select>
                    </label>
                    @if (named()) {
                      <label class="field"><span>Naam op de prijslijst</span>
                        <input class="input" maxlength="120" autocomplete="off" placeholder="Bijvoorbeeld: Bloemen Janssens"
                               [ngModel]="recipientName()" (ngModelChange)="recipientName.set($event)"
                               (change)="confirmRecipientName()" (keydown.enter)="confirmRecipientName()" />
                      </label>
                    }
                  </div>
                  <label class="field"><span>Geldig tot (optioneel)</span>
                    <app-date-field fieldId="catalog-valid-until" [value]="pricesValidUntil()" (valueChange)="pricesValidUntil.set($event)" />
                    @if (validityPast()) { <small class="price-target__past">Ligt in het verleden</small> }
                  </label>
                  <div class="price-target__adjust">
                    <!-- Also with an empty PDF: the sheet finds and takes in products itself. -->
                    <button class="btn" type="button" [disabled]="!dataReady()" (click)="openPriceSheet()">
                      Prijzen aanpassen{{ overrideCount() ? ' (' + overrideCount() + ')' : '' }}
                    </button>
                    @if (customerNote()) { <small>{{ customerNote() }}</small> }
                    @if (customerPricesState() === 'ERROR') {
                      <button class="linklike" type="button" (click)="loadCustomerPrices()">Opnieuw laden</button>
                    } @else if (customersState() === 'ERROR') {
                      <small>Klanten niet geladen</small>
                      <button class="linklike" type="button" (click)="loadCustomers()">Opnieuw laden</button>
                    }
                  </div>
                </div>
              }
              <label class="option-toggle">
                <span><b>Productfoto’s</b><small>Je foto voor de catalogus krijgt voorrang</small></span>
                <input class="studio-switch" type="checkbox" [ngModel]="includePhotos()" (ngModelChange)="includePhotos.set($event)" />
              </label>
              <label class="option-toggle">
                <span><b>PDF verkleinen</b><small>Rond 10 MB, makkelijk te mailen</small></span>
                <input class="studio-switch" type="checkbox" [ngModel]="compressPdf()" (ngModelChange)="compressPdf.set($event)" />
              </label>
            </div>
          </section>

          <app-catalog-product-selection
            [products]="products()" [families]="families()" [categories]="categories()" [selected]="selected()"
            [loading]="loading()" [loadError]="loadError()" [disabled]="busy()"
            [showReferencePrices]="includePrices()" (selectedChange)="selected.set($event)" (retry)="load()"
            (cataloguePhotosRequested)="saveCataloguePhotos($event)"
          />

          <app-catalog-product-arrangement
            [products]="selectedProducts()" [families]="families()" [categories]="categories()"
            [disabled]="busy() || loading()" [canReset]="hasCustomOrder()"
            [canSave]="canSaveOrder()" [saving]="savingOrder()" [saveStatus]="orderSaveStatus()"
            [saveError]="orderError()" [canReload]="dataReady() && (!savedOrder() || orderConflict())"
            (orderChange)="reorderProducts($event)" (resetRequested)="resetProductOrder()"
            (saveRequested)="saveProductOrder()" (reloadRequested)="reloadSavedOrder()"
          />

          <!-- In both modes: both PDFs print per-pallet and per-kar figures and name the height they count with. -->
          <app-catalog-load-settings [settings]="loadChoice()" [example]="loadExample()" [desk]="desktop.active()"
                                     [disabled]="busy()" (settingsChange)="loadChoice.set($event)" />

          @if (layout() === 'BROCHURE') {
            <app-catalog-brochure-settings
              [disabled]="busy()" [includePhotos]="includePhotos()" [selectedFamilyCount]="selectedFamilyCount()"
              [settings]="brochure()" (settingsChange)="brochure.set($event)"
            />
          }
          <app-staff-contact-phones [disabled]="busy()" (pendingChange)="contactPhonesPending.set($event)" />
          <details class="studio-personal">
            <summary><span>Een persoonlijke inleiding<small>Optioneel · bijvoorbeeld voor een specifieke klant</small></span><i aria-hidden="true">+</i></summary>
            <label class="field intro-field"><span>Korte inleiding</span>
              <textarea class="textarea" rows="3" [ngModel]="intro()" (ngModelChange)="intro.set($event)"
                        placeholder="Bijvoorbeeld: samengesteld voor uw winkel of verkoopkanaal"></textarea>
            </label>
          </details>

          <div class="catalog-output">
          @if (downloading()) {
            <section class="card render-status" role="status" aria-live="polite">
              <span class="render-status__mark" aria-hidden="true"></span>
              <div>
                <b>PDF wordt opgebouwd</b>
                <small>Bij een grote productselectie kan dit enkele minuten duren. Laat dit scherm open.</small>
              </div>
            </section>
          }

          @if (renderError(); as error) {
            <section class="card render-error" role="alert">
              <div class="render-error__body">
                <b>PDF kon niet worden gemaakt</b>
                <small>{{ error }}</small>
                @if (renderTranslationIssues().length) {
                  <div class="translation-issues" aria-label="Ontbrekende vertalingen">
                    @if (selectionTranslationIssues().length) {
                      <section class="translation-issues__group" aria-labelledby="product-translation-issues-title">
                        <div class="translation-issues__head">
                          <span>
                            <b id="product-translation-issues-title">Productgebonden vertalingen</b>
                            <small>Vul de vertaling aan of haal de getroffen producten uit deze PDF.</small>
                          </span>
                          @if (missingTranslationProductIds().size) {
                            <button class="btn btn--sm" type="button" [disabled]="busy()"
                                    (click)="excludeMissingTranslationProducts()">
                              {{ missingTranslationProductIds().size }} getroffen
                              product{{ missingTranslationProductIds().size === 1 ? '' : 'en' }} uitsluiten
                            </button>
                          }
                        </div>
                        <div class="translation-issues__list">
                          @for (issue of selectionTranslationIssues(); track issue.path) {
                            @if (issue.route) {
                              <a class="translation-issue" [routerLink]="issue.route"
                                 [queryParams]="issue.queryParams"
                                 [attr.aria-label]="issue.actionLabel + ': ' + issue.entityLabel + ', ' + issue.fieldLabel">
                                <span><b>{{ issue.entityLabel }}</b><small>{{ issue.fieldLabel }}</small></span>
                                <i aria-hidden="true">{{ issue.actionLabel }} →</i>
                              </a>
                            } @else {
                              <div class="translation-issue">
                                <span><b>{{ issue.entityLabel }}</b><small>{{ issue.fieldLabel }}</small></span>
                                <i>Geen directe editor</i>
                              </div>
                            }
                          }
                        </div>
                      </section>
                    }
                    @if (catalogTranslationIssues().length) {
                      <section class="translation-issues__group" aria-labelledby="catalog-translation-issues-title">
                        <div class="translation-issues__head translation-issues__head--catalog">
                          <span>
                            <b id="catalog-translation-issues-title">Algemene catalogusteksten</b>
                            <small>Deze teksten blijven nodig, ongeacht welke producten je selecteert.</small>
                          </span>
                        </div>
                        <div class="translation-issues__list">
                          @for (issue of catalogTranslationIssues(); track issue.path) {
                            @if (issue.route) {
                              <a class="translation-issue" [routerLink]="issue.route"
                                 [queryParams]="issue.queryParams"
                                 [attr.aria-label]="issue.actionLabel + ': ' + issue.entityLabel + ', ' + issue.fieldLabel">
                                <span><b>{{ issue.entityLabel }}</b><small>{{ issue.fieldLabel }}</small></span>
                                <i aria-hidden="true">{{ issue.actionLabel }} →</i>
                              </a>
                            } @else {
                              <div class="translation-issue">
                                <span><b>{{ issue.entityLabel }}</b><small>{{ issue.fieldLabel }}</small></span>
                                <i>Geen directe editor</i>
                              </div>
                            }
                          }
                        </div>
                      </section>
                    }
                  </div>
                }
                @if (priceIssueList().length) {
                  <div class="translation-issues__list price-issues" aria-label="Prijzen die niet in de PDF kunnen">
                    @for (issue of priceIssueList(); track $index) {
                      <div class="translation-issue"><span>@if (issue.name) {<b>{{ issue.name }}</b>}<small>{{ issue.message }}</small></span></div>
                    }
                  </div>
                }
              </div>
              <div class="render-error__actions">
                @if (renderTranslationError() && !renderTranslationIssues().length) {
                  <a class="btn btn--sm" routerLink="/catalog/texts"
                     [queryParams]="{ language: language(), returnTo: '/catalog-export' }">
                    Catalogusteksten openen
                  </a>
                }
                <!-- Refused prices change only in the sheet; trying the same request again would be refused again. -->
                @if (priceIssues().length) {
                  <button class="btn btn--sm btn--primary" type="button" [disabled]="busy()" (click)="openPriceSheet()">Prijzen aanpassen</button>
                } @else {
                  <button class="btn btn--sm btn--primary" type="button" [disabled]="busy()"
                          (click)="retryRender()">Opnieuw proberen</button>
                }
              </div>
            </section>
          }

          @if (priceNoteRows().length) {
            <section class="card render-status render-notes" role="status">
              <div>
                <b>PDF gemaakt met {{ priceNoteRows().length }} {{ priceNoteRows().length === 1 ? 'opmerking' : 'opmerkingen' }}</b>
                @for (note of priceNoteRows(); track $index) { <small>{{ note.name ? note.name + ': ' : '' }}{{ note.message }}</small> }
              </div>
            </section>
          }
          </div>
        </div>
      </fieldset>
    </div>

    <div class="action-bar catalog-action" [attr.aria-busy]="busy()">
      <div class="action-bar__total">
        <!-- A phone has no room for both: the customer's name wins over the language. -->
        <div class="action-bar__label" [attr.title]="recipientLabel() || null">
          <span [class.catalog-action__lang]="!!recipientLabel()">{{ languageLabel() }} · </span>{{ includePrices() ? 'Met prijzen' : 'Zonder prijzen' }}@if (recipientLabel()) { · voor {{ recipientLabel() }}}
        </div>
        <div class="action-bar__value">{{ selectedFamilyCount() }} groepen · {{ selected().size }} varianten</div>
        <!-- A height or spill of this PDF's own, said where the download happens (it stays in the tab from the customer before). -->
        @if (loadNote(); as note) { <div class="action-bar__value">{{ note }}</div> }
      </div>
      <div class="catalog-action__buttons">
        <button class="btn btn--primary" type="button"
                [disabled]="!canExport() || busy()" (click)="download()">
          {{ downloading() ? 'PDF wordt gemaakt…' : 'Download catalogus' }}
        </button>
      </div>
      <span class="sr-only" aria-live="polite">{{ actionStatus() }}</span>
    </div>

    @if (priceSheetOpen()) {
      <app-catalog-price-sheet [catalogue]="orderedProducts()" [selected]="selected()" [families]="families()" [categories]="categories()"
        [overrides]="priceOverrides()" [customer]="targetCustomer()"
        [customerPrices]="customerPrices()" [customerNote]="customerNote()" [validUntil]="pricesValidUntil()" [issues]="priceIssues()"
        (saved)="customerPricesSaved($event)" (included)="includeProducts($event)" (applied)="applyPrices($event)"
        (productsStale)="refreshProducts()" (closed)="priceSheetOpen.set(false)" />
    }
  `,
  styles: `
    :host { display: block; --studio-bordeaux: #651629; }
    .catalog-page { max-width: 1400px; container: catalog-page / inline-size; }
    .catalog-workspace { display: grid; min-width: 0; margin: 0; padding: 0; border: 0; gap: 24px; }
    .catalog-settings, .catalog-output { display: grid; min-width: 0; gap: 16px; align-content: start; }
    .catalog-output:empty { display: none; }
    .studio-preview { min-width: 0; padding: 18px; border: 1px solid var(--line); border-radius: 26px; background: color-mix(in srgb, var(--surface-2) 65%, var(--surface)); }
    .studio-preview__heading { display: flex; justify-content: space-between; gap: 10px; color: var(--muted); font-size: 9px; font-weight: 750; letter-spacing: .13em; }
    .studio-preview__format { letter-spacing: .01em; white-space: nowrap; }
    .cover-stage { display: grid; place-items: center; min-width: 0; padding: 24px 20px 22px; perspective: 1000px; }
    .cover-sheet { width: min(100%, 320px); aspect-ratio: 210 / 297; display: flex; flex-direction: column; overflow: hidden; background: #f7f3eb; color: #fff9f0; box-shadow: -3px 1px 0 #d6cfc6, -6px 3px 0 #eee9e2, 0 18px 28px -12px rgb(45 17 22 / 28%); transform: rotate(-2deg); transition: transform .35s ease; }
    .cover-sheet__copy { display: flex; flex-direction: column; align-items: flex-start; flex: 0 0 52%; box-sizing: border-box; padding: 9% 9% 5%; background: var(--studio-bordeaux); }
    .cover-sheet__brand { width: 45%; height: 34px; object-fit: contain; object-position: left; filter: brightness(0) invert(1); }
    .cover-sheet__edition { margin-top: 8%; font-size: clamp(6px, .8vw, 9px); letter-spacing: .18em; opacity: .7; }
    .cover-sheet h2 { margin: 6% 0 5%; font-family: Georgia, 'Times New Roman', serif; font-size: clamp(22px, 3vw, 32px); font-weight: 400; line-height: 1.08; letter-spacing: -.025em; overflow-wrap: anywhere; }
    .cover-sheet h2 em { display: block; color: #e8c8be; font-weight: 400; }
    .cover-sheet__rule { height: 1px; width: 28px; background: #d8ae9e; margin: auto 0 5%; }
    .cover-sheet__foot { display: flex; justify-content: space-between; padding: 5% 9%; color: #641c32; font-size: 7px; letter-spacing: .15em; }
    .cover-sheet:not(.cover-sheet--simple) { position: relative; background: #651629; }
    .cover-sheet:not(.cover-sheet--simple)::before { content: ''; position: absolute; inset: 4%; border: 1px solid #a97f72; pointer-events: none; }
    .cover-sheet:not(.cover-sheet--simple) .cover-sheet__copy { flex: 1; padding: 0; background: transparent; text-align: center; }
    .cover-sheet:not(.cover-sheet--simple) .cover-sheet__brand { position: absolute; top: 22%; left: 25%; width: 50%; height: auto; filter: none; }
    .cover-sheet:not(.cover-sheet--simple) .cover-sheet__edition { position: absolute; top: 10%; left: 10%; width: 80%; margin: 0; color: #d6b783; opacity: 1; }
    .cover-sheet:not(.cover-sheet--simple) h2 { position: absolute; top: 46%; left: 10%; width: 80%; margin: 0; font-size: clamp(20px, 2.7vw, 29px); }
    .cover-sheet:not(.cover-sheet--simple) h2 em { margin-top: 8px; color: #e7cba6; font-size: .82em; }
    .cover-sheet:not(.cover-sheet--simple) .cover-sheet__rule { position: absolute; top: 38%; left: 44%; width: 12%; margin: 0; background: #cbb07b; }
    .cover-sheet:not(.cover-sheet--simple) .cover-sheet__foot { position: absolute; bottom: 10%; left: 12%; width: 76%; padding: 0; color: #d6b783; }
    .cover-sheet__recipient { position: absolute; top: 40.8%; left: 10%; width: 80%; overflow: hidden; color: #d6b783; font-size: clamp(5px, .7vw, 8px); letter-spacing: .14em; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
    .cover-stage.cover-stage--compact { padding: 22px 0; }
    .compact-sheet { display: flex; flex-direction: column; box-sizing: border-box; width: min(100%, 360px); min-width: 0; aspect-ratio: 210 / 297; padding: 5.5%; background: #f6f1eb; color: #39282d; box-shadow: 0 12px 26px -12px rgb(45 17 22 / 28%); }
    .compact-sheet__head { padding: 8px 11px 7px; border-radius: 7px; background: #4b1024; }
    .compact-sheet__head img { display: block; width: 56px; height: auto; }
    .compact-sheet__head h2 { margin: 3px 0 1px; color: #fffaf3; font-family: Georgia, serif; font-size: clamp(13px, 1.7vw, 15px); font-weight: 400; line-height: 1.15; overflow-wrap: anywhere; }
    .compact-sheet__head > span { font-size: 7px; color: #e1c590; }
    .compact-sheet__head .compact-sheet__recipient { display: block; margin-bottom: 2px; color: #fffaf3; font-family: Georgia, serif; font-size: 9px; font-style: italic; overflow-wrap: anywhere; }
    .compact-sheet__rows { flex: 1; display: flex; flex-direction: column; gap: 5px; margin-top: 7px; overflow: hidden; }
    .compact-card { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; padding: 6px 9px 5px; border: 1px solid #e5d9d2; border-radius: 7px; background: #fff; }
    .compact-card__head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .compact-card__head b { overflow-wrap: anywhere; color: var(--studio-bordeaux); font-family: Georgia, serif; font-size: 9.5px; font-weight: 400; line-height: 1.2; }
    .compact-card__head strong { flex: none; color: var(--studio-bordeaux); font-size: 8px; white-space: nowrap; }
    .compact-card__head .is-stale { color: var(--warn); }
    .compact-card__meta { color: #80676d; font-size: 6px; line-height: 1.3; }
    .compact-card__colours { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; padding: 2px 0 1px; }
    .compact-card__colour { display: grid; justify-items: center; gap: 1px; min-width: 0; text-align: center; }
    .compact-card__colour img { width: 100%; max-width: 38px; aspect-ratio: 1; object-fit: contain; }
    .compact-card__colour i { width: 15px; height: 15px; margin: 2px 0 1px; border: 1px solid #d8c8bb; border-radius: 50%; }
    .compact-card__colour em { max-width: 100%; font-size: 6.5px; font-style: normal; font-weight: 650; line-height: 1.25; }
    .compact-card__colour small { max-width: 100%; color: #745c63; font-size: 5.5px; line-height: 1.2; }
    .compact-card__more { color: #80676d; font-size: 7px; }
    .compact-card__ribbon { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; margin: 0; padding-top: 4px; border-top: 1px solid #efe6df; }
    .compact-card__ribbon dt { color: #7b3145; font-size: 5.3px; line-height: 1.3; }
    .compact-card__meta, .compact-card__colour em, .compact-card__colour small, .compact-card__ribbon dt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .compact-card__ribbon dd { margin: 0; font-size: 7.5px; font-weight: 650; line-height: 1.25; }
    .compact-card__ribbon dd small { margin-left: 2px; color: #80676d; font-size: 5px; font-weight: 400; }
    .compact-sheet__empty { margin: 18px 0; font-size: 10px; color: #80676d; line-height: 1.5; }
    .compact-sheet__foot { display: flex; justify-content: space-between; gap: 8px; margin-top: 8px; color: #80676d; font-size: 6px; letter-spacing: .08em; }
    .preview-caption { margin: 0; color: var(--muted); font-size: 11px; text-align: center; line-height: 1.5; }
    .studio-totals { display: grid; grid-template-columns: repeat(3, 1fr); margin: 22px 0 18px; }
    .studio-totals > span { display: grid; gap: 3px; text-align: center; border-right: 1px solid var(--line); }
    .studio-totals > span:last-child { border: 0; }
    .studio-totals b { color: var(--ink); font-size: 25px; font-weight: 600; letter-spacing: -.05em; }
    .studio-totals small { color: var(--muted); font-size: 11px; }
    .preview-range { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .preview-range > div { aspect-ratio: 1; border: 1px solid var(--line); border-radius: 13px; background: #fff; overflow: hidden; }
    .preview-range img { width: 100%; height: 100%; padding: 5px; box-sizing: border-box; object-fit: contain; }
    .studio-note { margin: 16px 2px 0; color: var(--muted); font-size: 12px; line-height: 1.5; }
    .studio-section { min-width: 0; padding: 22px; border: 1px solid var(--line); border-radius: 22px; background: var(--surface); }
    .studio-section__head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 20px; }
    .studio-step { display: grid; flex: none; width: 32px; height: 32px; place-items: center; border-radius: 11px; background: var(--rose-soft); color: var(--rose-dark); font-size: 11px; font-weight: 800; }
    .studio-section h2 { margin: 0; color: var(--ink); font-size: 19px; font-weight: 720; letter-spacing: -.04em; line-height: 1.25; }
    .studio-section p { margin: 5px 0 0; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .mode-choice { display: grid; gap: 9px; }
    .mode-choice button { display: flex; min-width: 0; align-items: center; gap: 14px; padding: 15px; border: 1px solid var(--line); border-radius: 15px; background: var(--surface); color: var(--ink); text-align: left; cursor: pointer; transition: border-color .2s, background .2s; }
    .mode-choice button.active { border-color: var(--rose); background: color-mix(in srgb, var(--rose-soft) 48%, var(--surface)); box-shadow: 0 0 0 1px var(--rose); }
    .mode-choice__paper { display: grid; width: 34px; height: 46px; flex: none; border: 1px solid #e0d4cf; border-radius: 2px; background: linear-gradient(#641c32 0 55%, #f2eae0 55%); box-shadow: -2px 1px #d6cfc6; }
    .mode-choice__paper--list { background: repeating-linear-gradient(#faf7f2 0 8px, #d6c7c7 8px 9px); }
    .mode-choice__copy { display: grid; flex: 1; min-width: 0; gap: 3px; }
    .mode-choice__copy b { font-size: 15px; font-weight: 720; }
    .mode-choice__copy small { color: var(--muted); font-size: 12px; line-height: 1.4; }
    .mode-choice__copy em { margin-top: 3px; color: var(--rose-dark); font-size: 10px; font-weight: 750; font-style: normal; }
    .mode-choice__check { display: grid; width: 20px; height: 20px; flex: none; place-items: center; border: 1px solid var(--line-strong); border-radius: 50%; font-size: 12px; }
    .active .mode-choice__check { border-color: var(--rose); background: var(--rose); color: #fff; }
    .studio-language { margin: 0 0 12px; }
    .field > span { color: var(--ink-2); font-size: 12px; font-weight: 700; }
    .studio-language .select { min-height: 48px; font-size: 16px; border-radius: 13px; }
    .option-grid { display: grid; }
    .option-toggle { display: flex; min-width: 0; min-height: 68px; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 0; border-bottom: 1px solid var(--line); cursor: pointer; }
    .option-toggle:last-child { border: 0; padding-bottom: 0; }
    .option-toggle span { display: grid; min-width: 0; gap: 3px; }
    .option-toggle b { font-size: 14px; }
    .option-toggle small { color: var(--muted); font-size: 12px; line-height: 1.4; }
    .option-toggle .option-toggle__control { display: flex; flex: none; align-items: center; gap: 8px; }
    .option-toggle__value { min-width: 25px; color: var(--ink-2); font-size: 13px; font-weight: 700; text-align: right; }
    .studio-switch { appearance: none; -webkit-appearance: none; position: relative; display: block; width: 44px; height: 27px; flex: none; margin: 0; border: 1px solid var(--line-strong); border-radius: 99px; background: var(--line-strong); cursor: pointer; transition: background .2s; }
    .studio-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 21px; height: 21px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px #0002; transition: transform .2s; }
    .studio-switch:checked { background: var(--rose); border-color: var(--rose); }
    .studio-switch:checked::after { transform: translateX(17px); }
    .studio-switch:focus-visible { outline: 3px solid var(--rose); outline-offset: 3px; }
    .option-toggle:has(+ .price-target) { border: 0; }
    .price-target { display: grid; gap: 12px; padding: 2px 0 16px; border-bottom: 1px solid var(--line); }
    .price-target__who { display: grid; gap: 12px; min-width: 0; }
    .price-target .field { min-width: 0; margin: 0; }
    .price-target__adjust { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; }
    .price-target__adjust small, .price-target__past { color: var(--muted); font-size: 12px; }
    .price-target__past { color: var(--warn); }
    @container catalog-page (min-width: 480px) {
      .price-target { grid-template-columns: minmax(0, 1fr) 172px; align-items: start; }
      .price-target__adjust { grid-column: 1 / -1; }
    }
    .studio-personal { overflow: hidden; border: 1px solid var(--line); border-radius: 18px; background: var(--surface); }
    .studio-personal summary { display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: 74px; padding: 16px 20px; cursor: pointer; list-style: none; }
    .studio-personal summary::-webkit-details-marker { display: none; }
    .studio-personal summary span { display: grid; gap: 4px; font-size: 14px; font-weight: 700; }
    .studio-personal summary small { color: var(--muted); font-size: 12px; font-weight: 400; }
    .studio-personal summary i { color: var(--muted); font-size: 22px; font-style: normal; transition: transform .2s; }
    .studio-personal[open] summary i { transform: rotate(45deg); }
    .intro-field { margin: 0; padding: 0 20px 20px; }
    .intro-field .textarea { min-height: 96px; padding: 13px; font-size: 16px; line-height: 1.45; }
    .render-status, .render-error {
      display: flex; min-height: 76px; align-items: center; gap: 12px; padding: 14px;
    }
    .render-status__mark {
      width: 22px; height: 22px; flex: none; border: 2px solid var(--rose-line);
      border-top-color: var(--rose); border-radius: 50%; animation: spin .8s linear infinite;
    }
    .render-status > div, .render-error__body { display: grid; min-width: 0; gap: 2px; }
    .render-status b, .render-error b { color: var(--ink-2); font-size: 15px; }
    .render-status small, .render-error small { color: var(--muted); font-size: 14px; line-height: 1.45; }
    .render-error { align-items: flex-start; justify-content: space-between; border-color: var(--danger); }
    .render-error__body { flex: 1 1 auto; }
    .render-error small { color: var(--danger); }
    .render-notes { align-items: flex-start; border-color: var(--warn); }
    .render-error__actions { display:flex;justify-content:flex-end;flex-wrap:wrap;gap:7px }
    .render-error__actions .btn { min-height:48px }
    .translation-issues { display: grid; gap: 12px; margin-top: 12px; }
    .translation-issues__group { display: grid; gap: 7px; }
    .translation-issues__head {
      display: flex; min-width: 0; align-items: flex-start; justify-content: space-between;
      gap: 12px; padding: 10px 11px; border-radius: 10px; background: var(--surface-2);
    }
    .translation-issues__head > span { display: grid; min-width: 0; gap: 2px; }
    .translation-issues__head > span small { color: var(--muted); }
    .translation-issues__head .btn { min-height: 44px; flex: none; white-space: normal; }
    .translation-issues__head--catalog { border-left: 3px solid var(--warn); }
    .translation-issues__list { display: grid; gap: 7px; }
    .translation-issue {
      display: flex; min-width: 0; min-height: 54px; align-items: center; justify-content: space-between;
      gap: 12px; padding: 9px 11px; border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--line));
      border-radius: 10px; background: var(--surface); color: var(--ink); text-decoration: none;
    }
    a.translation-issue:hover { border-color: var(--rose); background: var(--rose-soft); }
    a.translation-issue:focus-visible { outline: 3px solid var(--rose); outline-offset: 2px; }
    .translation-issue span { display: grid; min-width: 0; gap: 1px; }
    .translation-issue span b { overflow-wrap: anywhere; }
    .translation-issue span small { color: var(--muted); }
    .translation-issue i { flex: none; color: var(--rose-dark); font-size: 13px; font-style: normal; font-weight: 750; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .catalog-action { background: color-mix(in srgb, var(--surface) 92%, transparent); border-color: var(--line); }
    .catalog-action .action-bar__label { overflow: hidden; margin-bottom: 3px; font-size: 10px; letter-spacing: 0; text-overflow: ellipsis; text-transform: none; white-space: nowrap; }
    .catalog-action .action-bar__value { font-size: 15px; font-weight: 700; }
    .catalog-action__buttons { display: flex; gap: 7px; }
    .catalog-action__buttons .btn { min-height: 48px; padding-inline: 22px; border-radius: 14px; font-size: 14px; white-space: nowrap; }
    @container catalog-page (min-width: 860px) {
      .catalog-workspace { grid-template-columns: minmax(300px, .85fr) minmax(430px, 1.15fr); gap: 24px; align-items: start; }
      .studio-preview { position: sticky; top: 88px; padding: 24px; }
      .cover-stage { padding: 30px 26px 26px; }
      .studio-section { padding: 24px; }
    }
    @media (max-width: 679.98px), (hover: none) and (max-width: 1023.98px) {
      .catalog-page { padding-inline: 12px; padding-bottom: calc(110px + env(safe-area-inset-bottom)); }
      .catalog-workspace { gap: 16px; }
      .studio-preview { padding: 16px; border-radius: 22px; }
      .cover-stage { padding: 24px 55px 20px; }
      .cover-sheet { max-width: 255px; }
      .cover-sheet h2 { font-size: clamp(20px, 6vw, 28px); }
      .cover-sheet__brand { height: 26px; }
      .cover-sheet__edition { font-size: 6px; }
      .preview-caption { font-size: 10px; }
      .studio-totals { margin: 16px 0 0; }
      .studio-totals b { font-size: 23px; }
      .preview-range, .studio-note { display: none; }
      .studio-section { padding: 18px; border-radius: 20px; }
      .studio-section h2 { font-size: 18px; }
      .studio-section__head { margin-bottom: 16px; }
      .catalog-action { bottom: calc(8px + env(safe-area-inset-bottom)); padding: 10px 12px; gap: 8px; border-radius: 20px; }
      .catalog-action .action-bar__value { font-size: 12px; }
      .catalog-action__lang { display: none; }
      .catalog-action__buttons .btn { font-size: 13px; padding-inline: 16px; }
      .render-error { align-items: stretch; flex-direction: column; }
      .render-error__actions { display: grid; grid-template-columns: 1fr; }
      .translation-issues__head, .translation-issue { align-items: flex-start; flex-direction: column; gap: 6px; }
      .translation-issues__head .btn { width: 100%; }
    }
    @media (max-width: 359px) {
      .cover-stage { padding-inline: 38px; }
      .studio-preview__heading { font-size: 8px; }
      .catalog-action__buttons .btn { padding-inline: 10px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .render-status__mark { animation: none; }
      .cover-sheet, .studio-switch, .studio-switch::after, .mode-choice button, .studio-personal summary i { transition: none; }
    }

  `,
})
export class CatalogExport {
  readonly languages = LANGUAGES;
  readonly desktop = inject(DesktopViewport);

  private readonly catalog = inject(CatalogApi);
  private readonly sales = inject(SalesApi);
  private readonly customerPriceApi = inject(CustomerPriceApi);
  private readonly ui = inject(Ui);
  private readonly destroyRef = inject(DestroyRef);
  private storedSelection: number[] | null = null;
  private storedOrder: number[] | null = null;
  private selectionInitialized = false;
  private destroyed = false;
  private customerPricesRequest = 0;

  readonly layout = signal<CatalogLayout>('BROCHURE');
  readonly language = signal<LanguageCode>('NL');
  readonly intro = signal('');
  readonly includePrices = signal(false);
  readonly includePhotos = signal(true);
  /** Emre, 2026-11-07: "pdf rond 10 mb … zet dit standaard aan". */
  readonly compressPdf = signal(true);
  readonly brochure = signal<CatalogBrochureDraft>({ ...DEFAULT_BROCHURE });
  /**
   * "Laadhoogte en spill" (Emre, 2026-11-26): the pallet's and the kar's loading height and the spill this PDF
   * counts with. Kept in this tab only, as the recipient is (catalog-load.ts): never in the device draft.
   */
  readonly loadChoice = signal<CatalogLoad>(restoreCatalogLoad());
  /** The server's two carriers for that pick: the preview counts on them as the PDF will. */
  readonly carriers = computed(() => catalogCarriers(this.loadChoice()));
  /**
   * "pallet 180 cm": what this PDF's load differs in from the standard, '' on the standard. A line of its own on
   * the action bar and a part of the download's toast, so a height or spill still in the tab from the customer
   * before is read at the button (the card's tinted line is some 2.300 px up a phone's page).
   */
  readonly loadNote = computed(() => catalogLoadDeviation(this.loadChoice()));

  /* Who the PDF is for and its one-off prices: they count only while "Prijzen tonen" is on (PRICE_STATE_KEY). */
  readonly customers = signal<Customer[]>([]);
  readonly customersState = signal<'IDLE' | 'LOADING' | 'READY' | 'ERROR'>('IDLE');
  readonly customerId = signal<number | null>(null);
  readonly named = signal(false);
  readonly recipientName = signal('');
  readonly pricesValidUntil = signal('');
  readonly priceOverrides = signal<ReadonlyMap<number, CatalogPriceOverride>>(new Map());
  /** Who the one-off prices were typed for; another recipient asks before they go (chooseRecipient, confirmRecipientName). */
  readonly pricesFor = signal<PricesFor | null>(null);
  private askingRecipient = false;
  /** The chosen customer's stored prices by product; empty without a customer and while they load. */
  readonly customerPrices = signal<ReadonlyMap<number, CustomerPrice>>(new Map());
  readonly customerPricesState = signal<'IDLE' | 'LOADING' | 'READY' | 'ERROR'>('IDLE');
  readonly priceSheetOpen = signal(false);
  /** The server's refusal of one-off prices (409 CATALOG_PRICES_INVALID), per product. */
  readonly priceIssues = signal<CatalogPriceIssue[]>([]);
  /** What the preflight remarked on the PDF just made (below cost, validity in the past); it stops nothing. */
  readonly priceNotes = signal<CatalogPriceIssue[]>([]);

  readonly products = signal<Product[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly families = signal<ProductFamily[]>([]);
  readonly selected = signal<Set<number>>(new Set());
  readonly orderedIds = signal<number[]>([]);
  readonly savedOrder = signal<CatalogOrder | null>(null);
  readonly loadingOrder = signal(false);
  readonly savingOrder = signal(false);
  readonly orderError = signal<string | null>(null);
  readonly orderConflict = signal(false);
  readonly draftPersistence = signal<'DEVICE' | 'SESSION' | 'NONE'>('NONE');
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly dataReady = signal(false);
  readonly downloading = signal(false);
  readonly savingPhotos = signal(false);
  readonly importingPhotos = signal(false);
  readonly renderError = signal<string | null>(null);
  readonly renderTranslationError = signal(false);
  readonly missingTranslationPaths = signal<string[]>([]);
  readonly contactPhonesPending = signal(false);

  readonly busy = computed(() => this.downloading() || this.savingPhotos() || this.importingPhotos()
    || this.savingOrder() || this.loadingOrder());
  readonly canExport = computed(() =>
    this.dataReady() && this.selected().size > 0 && !this.loadError() && !this.contactPhonesPending());
  readonly actionStatus = computed(() => {
    if (this.savingOrder()) return 'Catalogusvolgorde wordt opgeslagen.';
    if (this.loadingOrder()) return 'Opgeslagen catalogusvolgorde wordt geladen.';
    if (this.importingPhotos()) return 'Catalogusfoto’s worden gecontroleerd of toegevoegd.';
    if (this.savingPhotos()) return 'Fotokeuzes worden opgeslagen.';
    if (this.downloading()) return 'PDF wordt gemaakt. Dit kan enkele minuten duren.';
    if (this.contactPhonesPending()) return 'Sla de gewijzigde telefoonnummers op voor je de catalogus downloadt.';
    return this.renderError() ?? '';
  });
  readonly renderTranslationIssues = computed(() => catalogTranslationLinks(
    this.missingTranslationPaths(),
    this.language(),
    this.products(),
    this.categories(),
    this.selected(),
  ));
  readonly selectionTranslationIssues = computed(() => this.renderTranslationIssues().filter((issue) =>
    issue.kind === 'CATEGORY' || issue.kind === 'FAMILY' || issue.kind === 'PRODUCT'));
  readonly catalogTranslationIssues = computed(() => this.renderTranslationIssues().filter((issue) =>
    issue.kind === 'CATALOG_COPY' || issue.kind === 'UNKNOWN'));
  readonly missingTranslationProductIds = computed(() =>
    catalogTranslationAffectedProductIds(this.selectionTranslationIssues()));
  readonly selectedFamilyCount = computed(() => {
    const selected = this.selected();
    const groups = new Set<string>();
    for (const product of this.products()) {
      if (product.id === null || !selected.has(product.id)) continue;
      groups.add(product.familyId === null ? `product:${product.id}` : `family:${product.familyId}`);
    }
    return groups.size;
  });
  readonly orderedProducts = computed(() => applyCatalogProductOrder(this.products(), this.orderedIds()));
  readonly selectedProducts = computed(() => this.orderedProducts().filter((product) => product.id !== null && this.selected().has(product.id)));
  readonly hasCustomOrder = computed(() => {
    const defaults = applyCatalogProductOrder(this.products(), []);
    return this.orderedProducts().some((product, index) => product.id !== defaults[index]?.id);
  });
  readonly orderDirty = computed(() => {
    const saved = this.savedOrder();
    return saved !== null && catalogOrderChanged(this.products(), this.orderedIds(), saved.orderedIds);
  });
  readonly canSaveOrder = computed(() => this.dataReady() && this.savedOrder() !== null
    && !this.orderConflict() && this.products().length > 0 && !this.busy() && !this.loading()
    && (this.savedOrder()!.revision === 0 || this.orderDirty()));
  readonly orderSaveStatus = computed(() => {
    if (this.loadingOrder()) return 'Opgeslagen volgorde laden…';
    if (this.savingOrder()) return 'Volgorde opslaan…';
    if (this.orderConflict()) return 'De opgeslagen volgorde is intussen gewijzigd. Laad die opnieuw voordat je verder opslaat.';
    if (!this.savedOrder()) return 'De opgeslagen volgorde kon nog niet worden geladen.';
    if (this.orderDirty()) return 'Volgorde gewijzigd · nog niet opgeslagen voor volgende exports.';
    if (this.savedOrder()!.revision > 0) return 'Volgorde opgeslagen voor volgende exports, ook op andere apparaten.';
    return 'Sla deze volgorde op voor volgende exports, ook op andere apparaten.';
  });
  readonly selectedCategoryCount = computed(() => new Set(this.selectedProducts().map((product) => product.categoryId).filter((id) => id !== null)).size);
  readonly previewProducts = computed(() => catalogueFamilies(this.selectedProducts(), this.families()).filter((family) => family.photo).slice(0, 4));
  readonly compactCopy = computed(() => COMPACT_PREVIEW_COPY[this.language()]);
  /**
   * The first three cards of the PDF as it prints them: a family's colours together on one card while
   * they share carton, pallet, kar, 20ft, 40ft and price (the server's compactProducts), in its order.
   */
  readonly compactRows = computed(() => {
    const language = this.language();
    const currency = new Intl.NumberFormat(language.toLowerCase(), { style: 'currency', currency: 'EUR' });
    const count = new Intl.NumberFormat(language.toLowerCase());
    const overrides = this.priceOverrides();
    const stored = this.customerPrices();
    const copy = this.compactCopy();
    const familyNames = new Map(this.families().map((family) => [family.id,
      family.texts.find((text) => text.language === language)?.name?.trim() || family.name]));
    const carriers = this.carriers();
    const figures = (product: Product) => {
      const gp = readGpCapacity(product.carton);
      /* The PDF's figures: whole omdozen on the pallet or kar times what one omdoos holds, in the unit of 20ft and 40ft,
         on the heights and the spill picked for this PDF (catalogueUnits). */
      const perCarton = product.carton.piecesPerCarton;
      const load = (units: number | null) => units === null ? null : count.format(units);
      const override = overrides.get(product.id!);
      /* A one-off typed on a unit the product has since left is no price at its unit now: it waits to be typed again
         (the server refuses it, BASIS_CHANGED), as the sheet says. */
      /* "Op aanvraag" has no unit to go stale: the server prints it whatever the product is sold per. */
      const priceStale = !!override && !override.onRequest && basisChanged(product, override);
      const price = printedPrice(product, override, stored.get(product.id!));
      const packaging = product.packaging;
      /* The PDF's Packaging.soldAsDisplay: a display, sold as one. */
      const soldAsDisplay = packaging.kind === 'DISPLAY' && packaging.salesUnit === 'DISPLAY';
      return {
        /* What the PDF's unit words follow: a display sold as one (with its contents) or a piece, and the unit's name. */
        unit: `${soldAsDisplay ? `display ${packaging.piecesPerUnit ?? ''}` : 'piece'}|${(packaging.unitKey || 'stuk').trim().toLowerCase()}`,
        /* A display of known contents also prints its total price (the PDF's catalogPrices), sold as one or not. */
        displayPieces: packaging.kind === 'DISPLAY' && (packaging.piecesPerUnit ?? 0) > 1 ? packaging.piecesPerUnit : null,
        perBox: perCarton,
        perPallet: load(catalogueUnits(product, carriers.pallet)),
        perKar: load(catalogueUnits(product, carriers.kar)),
        per20Ft: gp.value === null ? null : count.format(gp.value),
        per20FtAuto: isAutoGpCapacity(gp),
        per20FtHint: gpCapacityHint(gp, product.carton),
        per40Ft: product.carton.hcCapacity ? count.format(product.carton.hcCapacity) : null,
        /* The price names its unit, as the PDF does: per display or per piece is where a ×6 mistake would hide. */
        price: priceStale ? 'Prijsbasis gewijzigd · vul opnieuw in'
          : price === null ? copy.onRequest : `${currency.format(price)} ${unitAfterPrice(product, language, copy)}`,
        priceStale,
      };
    };
    const includePrices = this.includePrices();
    const rows = new Map<string, ReturnType<typeof figures> & { products: Product[] }>();
    for (const product of this.selectedProducts()) {
      const printed = figures(product);
      /* What the PDF groups on (compactFigures): the unit, the carton and its size, the loads, and the price only
         when prices are printed. The carton size goes as typed: the PDF prints it so. Another height or spill can
         give two colours other loads, and then they stand on cards of their own, here and in the PDF. */
      const carton = product.carton;
      const signature = [printed.unit, printed.perBox, [carton.lengthCm, carton.widthCm, carton.heightCm].join('x'),
        printed.perPallet, printed.perKar, printed.per20Ft, printed.per40Ft,
        ...(includePrices ? [printed.price, printed.priceStale, printed.displayPieces] : [])];
      const key = `${product.familyId ?? `p${product.id}`}|${JSON.stringify(signature)}`;
      const row = rows.get(key);
      if (row) row.products.push(product);
      else if (rows.size < 3) rows.set(key, { ...printed, products: [product] });
    }
    return [...rows.values()].map(({ products, ...printed }) => {
      const product = products[0];
      const text = product.texts.find(row => row.language === language);
      const dimensions = [product.dimensions.lengthCm, product.dimensions.widthCm, product.dimensions.heightCm];
      /* The Maat is not translated. One Maat stands once, as in the PDF's heading; several stand with their colour. */
      const sizes = new Set(products.map((colour) => colour.variantSize?.trim()).filter((size): size is string => !!size));
      const size = sizes.size === 1 ? [...sizes][0] : null;
      return {
        ...printed,
        id: product.id,
        colourCount: products.length,
        name: (product.familyId !== null ? familyNames.get(product.familyId) : null) || text?.name?.trim() || product.name,
        perBox: printed.perBox ? count.format(printed.perBox) : null,
        /* The colours are the card's picture: the first four with their photo (a swatch without photos), SKU under each. */
        colours: products.slice(0, 4).map((colour) => {
          const photo = cataloguePhoto(colour);
          return {
            id: colour.id,
            name: [productText(colour, language).colour?.trim() || colour.colour,
              sizes.size > 1 ? colour.variantSize : null].filter(Boolean).join(' · ') || colour.sku,
            sku: colour.sku,
            photoUrl: photo?.smallUrl || photo?.url || null,
            hex: colour.colourHex,
          };
        }),
        moreColours: Math.max(0, products.length - 4),
        dimensions: [size, dimensions.every(value => value !== null && value > 0) ? `${dimensions.join(' × ')} cm` : null]
          .filter(Boolean).join(' · ') || null,
        /* One colour names its EAN in the heading line; several carry theirs under each photo in the PDF. */
        ean: products.length === 1 ? product.barcodeInner?.trim() || product.canonicalBarcode?.trim() || null : null,
        /* The PDF joins the HS codes its colours have; a colour without one adds nothing. */
        hsCode: [...new Set(products.map((colour) => colour.hsCode?.trim()).filter(Boolean))].join(' / ') || null,
      };
    });
  });
  /** The selected colours the preview leaves out. */
  readonly compactHidden = computed(() => this.selectedProducts().length
    - this.compactRows().reduce((sum, row) => sum + row.colourCount, 0));
  /**
   * The example under "Laadhoogte en spill": one selected product as the PDF names it, with its per-pallet and
   * per-kar figures on the picked load, in the document's number format (the preview's figures). It is the first
   * in the PDF's order that has a per-pallet figure on the standard, whatever is picked, so the same product
   * stays there while a height or the spill is stepped and only its figures move.
   */
  readonly loadExample = computed<CatalogLoadExample | null>(() => {
    const products = this.selectedProducts();
    const product = products.find((candidate) => catalogueUnits(candidate, STANDARD_CARRIERS.pallet) !== null) ?? products[0];
    if (!product) return null;
    const language = this.language();
    const count = new Intl.NumberFormat(language.toLowerCase());
    const carriers = this.carriers();
    const figure = (units: number | null) => units === null ? null : count.format(units);
    const family = product.familyId === null ? undefined : this.families().find((candidate) => candidate.id === product.familyId);
    return {
      /* The card's name in the preview: the family's in the document language, else the product's own. */
      name: (family ? family.texts.find((text) => text.language === language)?.name?.trim() || family.name : null)
        || product.texts.find((text) => text.language === language)?.name?.trim() || product.name,
      perPallet: figure(catalogueUnits(product, carriers.pallet)),
      perKar: figure(catalogueUnits(product, carriers.kar)),
    };
  });
  readonly targetKnown = computed(() => this.customers().some((customer) => customer.id === this.customerId()));
  /** The stored customer's id while prices are on: their prices load for it. */
  private readonly targetCustomerId = computed(() => this.includePrices() ? this.customerId() : null);
  readonly targetCustomer = computed(() => {
    const id = this.targetCustomerId();
    if (id === null) return null;
    return { id, name: this.customers().find((customer) => customer.id === id)?.company.trim() || `Klant #${id}` };
  });
  /** The name the PDF is made for; '' without a recipient, and always without prices. */
  readonly recipientLabel = computed(() => this.targetCustomer()?.name
    ?? (this.includePrices() && this.named() ? this.recipientName().trim().slice(0, 120) : ''));
  readonly recipientValue = computed(() => this.customerId() !== null ? `c${this.customerId()}` : this.named() ? 'name' : '');
  /** The recipient as one key: 'c12', 'n:bloemen janssens', '' for nobody. */
  readonly recipientKey = computed(() => this.customerId() !== null ? `c${this.customerId()}`
    : this.named() ? nameKey(this.recipientName()) : '');
  /** The free name now differs from the one the one-off prices were typed for (prices typed before any name follow it). */
  readonly recipientNameChanged = computed(() => {
    const owner = this.pricesFor();
    return this.includePrices() && this.named() && this.priceOverrides().size > 0
      && !!owner && owner.key !== 'n:' && owner.key !== this.recipientKey();
  });
  readonly recipientLine = computed(() => this.recipientLabel()
    ? this.compactCopy().priceListFor.replace('{name}', this.recipientLabel()) : '');
  readonly requestPriceOverrides = computed(() => this.includePrices()
    ? requestOverrides(this.selectedProducts(), this.priceOverrides(), this.customerPrices()) : []);
  readonly overrideCount = computed(() => this.requestPriceOverrides().length);
  readonly customerNote = computed(() => {
    if (!this.targetCustomer()) return '';
    switch (this.customerPricesState()) {
      case 'LOADING': return 'Klantprijzen laden…';
      case 'ERROR': return 'Klantprijzen niet geladen';
      default: {
        const stored = this.customerPrices();
        const active = this.selectedProducts().filter((product) => stored.get(product.id!)?.status === 'ACTIVE').length;
        return active ? `${active} ${active === 1 ? 'klantprijs' : 'klantprijzen'}` : 'Geen klantprijzen';
      }
    }
  });
  readonly validityPast = computed(() => !!this.pricesValidUntil() && this.pricesValidUntil() < todayIso());
  readonly priceIssueRows = computed(() => this.withProductNames(this.priceIssues()));
  /** The list under the card's message; a single refusal is that message already, so it is not said twice. */
  readonly priceIssueList = computed(() => {
    const rows = this.priceIssueRows();
    return rows.length === 1 && rows[0].message === this.renderError() ? [] : rows;
  });
  readonly priceNoteRows = computed(() => this.withProductNames(this.priceNotes()));
  readonly previewTitle = computed(() => this.brochure().coverTitle.trim() || ({
    NL: 'Gepreserveerde rozen,', EN: 'Preserved roses,', FR: 'Roses préservées,', DE: 'Konservierte Rosen,',
    ES: 'Rosas preservadas,', PL: 'Róże stabilizowane,', PT: 'Rosas preservadas,', TR: 'Korunmuş güller,', EL: 'Διατηρημένα τριαντάφυλλα,',
  }[this.language()]));
  readonly previewSubtitle = computed(() => this.brochure().coverSubtitle.trim() || ({
    NL: 'klaar voor retail.', EN: 'ready for retail.', FR: 'prêtes pour la vente au détail.', DE: 'bereit für den Handel.',
    ES: 'listas para retail.', PL: 'gotowe do sprzedaży.', PT: 'prontas para o retalho.', TR: 'perakendeye hazır.', EL: 'έτοιμα για λιανική.',
  }[this.language()]));
  readonly requestKey = computed(() => JSON.stringify(this.buildRequest()));

  constructor() {
    this.restoreState();
    this.restorePriceState();
    void this.load();
    /* The unit words of the reference prices and the price sheet ("per bowl", "per display"). */
    void this.catalog.unitNames().catch(() => undefined);

    /* The customers load the first time prices are shown; a chosen customer's stored prices on every change. */
    effect(() => {
      if (this.includePrices() && this.customersState() === 'IDLE') untracked(() => void this.loadCustomers());
    });
    effect(() => {
      const customerId = this.targetCustomerId();
      untracked(() => void this.loadCustomerPrices(customerId));
    });
    effect(() => storeCatalogLoad(this.loadChoice()));
    effect(() => this.persistPriceState({
      version: 1,
      customerId: this.customerId(),
      named: this.named(),
      recipientName: this.recipientName(),
      pricesValidUntil: this.pricesValidUntil(),
      overrides: [...this.priceOverrides().values()],
      pricesFor: this.pricesFor(),
    }));

    effect(() => {
      if (!this.dataReady()) return;
      const brochure = this.brochure();
      const state: CatalogBuilderState = {
        version: 3,
        layout: this.layout(),
        language: this.language(),
        intro: this.intro(),
        includePrices: this.includePrices(),
        includePhotos: this.includePhotos(),
        compressPdf: this.compressPdf(),
        selectedIds: this.selectedProducts().map(product => product.id!),
        orderedIds: this.orderedProducts().map(product => product.id!),
        ...brochure,
      };
      this.persistState(state);
    });

    let previousRequest = '';
    effect(() => {
      const currentRequest = this.requestKey();
      if (previousRequest && previousRequest !== currentRequest) {
        this.renderError.set(null);
        this.renderTranslationError.set(false);
        this.missingTranslationPaths.set([]);
        this.priceIssues.set([]);
        this.priceNotes.set([]);
      }
      previousRequest = currentRequest;
    });

    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
    });
  }

  async load(): Promise<void> {
    if (this.loading() && this.dataReady()) return;
    this.loading.set(true);
    this.loadingOrder.set(true);
    this.loadError.set(null);
    try {
      const [products, categories, families, orderResult] = await Promise.all([
        this.catalog.products(),
        this.catalog.categories(),
        this.catalog.productFamilies().catch(() => [] as ProductFamily[]),
        this.selectionInitialized
          ? Promise.resolve({ order: this.savedOrder(), error: this.orderError() })
          : this.catalog.catalogOrder()
          .then(order => ({ order, error: null }))
          .catch(failure => ({ order: null, error: messageOf(failure,
            'De opgeslagen volgorde kon niet worden geladen. Probeer het opnieuw voordat je de volgorde opslaat.') })),
      ]);
      if (this.destroyed) return;
      /* Internal assessment products stay in product management but never appear in a
         customer-facing PDF or return through an older saved browser selection. */
      const customerCatalogue = orderCatalogProducts(
        products.filter((product) => !product.demo),
        categories,
      );
      this.products.set(customerCatalogue);
      this.categories.set(categories);
      this.families.set(families);
      const available = new Set(customerCatalogue.flatMap((product) =>
        product.id === null ? [] : [product.id]));
      // Product/photo refreshes keep the original revision so a stale editor cannot
      // silently overwrite an order saved from another tab in the meantime.
      if (!this.selectionInitialized) {
        this.savedOrder.set(orderResult.order);
        this.orderError.set(orderResult.error);
        this.orderConflict.set(false);
      }
      this.orderedIds.set(this.selectionInitialized
        ? normalizedCatalogOrderIds(customerCatalogue, this.orderedIds())
        : initialCatalogOrderIds(customerCatalogue,
          orderResult.order ?? { revision: 0, orderedIds: [] }, this.storedOrder ?? []));
      if (!this.selectionInitialized) {
        const initial = this.storedSelection === null
          ? available
          : new Set(this.storedSelection.filter((id) => available.has(id)));
        this.selected.set(initial);
        this.selectionInitialized = true;
      } else {
        this.selected.update((current) =>
          new Set([...current].filter((id) => available.has(id))));
      }
      this.dataReady.set(true);
      this.renderError.set(null);
      this.renderTranslationError.set(false);
      this.missingTranslationPaths.set([]);
    } catch (failure) {
      if (!this.destroyed) {
        this.loadError.set(messageOf(
          failure,
          'Controleer de verbinding en probeer de producten opnieuw te laden.',
        ));
      }
    } finally {
      if (!this.destroyed) {
        this.loading.set(false);
        this.loadingOrder.set(false);
      }
    }
  }

  async download(): Promise<void> {
    if (!this.canExport() || this.busy()) return;
    /* A name typed and not yet left (the click blurred it): the question comes before a PDF with someone else's prices. */
    if (this.recipientNameChanged()) {
      this.confirmRecipientName();
      return;
    }
    const request = this.buildRequest();
    const key = JSON.stringify(request);
    /* The load this request carries, as the bar words it: the toast after the download names the same. */
    const loadNote = this.loadNote();
    this.renderError.set(null);
    this.renderTranslationError.set(false);
    this.missingTranslationPaths.set([]);
    this.priceIssues.set([]);
    this.priceNotes.set([]);
    this.downloading.set(true);
    try {
      const preflight = await this.catalog.preflightCatalog(request);
      if (this.destroyed || key !== this.requestKey()) return;
      /* An older server drops what it does not know: the PDF would leave without the customer or the typed prices. */
      if (this.needsPriceServer(request) && !Array.isArray(preflight.prices)) {
        this.showRenderProblem('De server kent prijzen per klant nog niet. Maak de PDF zonder klant, geldigheid en aangepaste prijzen, of probeer het later opnieuw.');
        return;
      }
      /* The same for a height or a spill of this PDF's own: without the server's echo the PDF would carry the standard figures. */
      const loadProblem = catalogLoadProblem(request, preflight.load);
      if (loadProblem) {
        this.showRenderProblem(loadProblem);
        return;
      }
      const missingPaths = this.validMissingPaths(preflight.missingPaths);
      if (!preflight.ready || missingPaths.length) {
        this.showMissingTranslations(missingPaths);
        return;
      }
      const blob = await this.catalog.exportCatalog(request, this.compressPdf());
      if (this.destroyed || key !== this.requestKey()) return;
      saveBlob(blob, this.fileName(request, preflight));
      const notes = this.validPriceIssues(preflight.priceWarnings);
      this.priceNotes.set(notes);
      /* A height or spill of this PDF's own is named with it, as on the bar: the PDF in hand was counted on it. */
      this.ui.toast(['Catalogus gedownload', notes.length ? `${notes.length} ${notes.length === 1 ? 'opmerking' : 'opmerkingen'}` : null, loadNote]
        .filter((part) => !!part).join(' · '));
    } catch (failure) {
      if (!this.destroyed) await this.handleRenderFailure(failure, 'Catalogus maken mislukt');
    } finally {
      if (!this.destroyed) this.downloading.set(false);
    }
  }

  retryRender(): void {
    if (this.busy()) return;
    void this.download();
  }

  excludeMissingTranslationProducts(): void {
    if (this.busy()) return;
    const affected = this.missingTranslationProductIds();
    if (!affected.size) return;
    this.selected.update((current) => deselectProductIds(current, affected));
    this.ui.toast(
      `${affected.size} getroffen product${affected.size === 1 ? '' : 'en'} uit de catalogusselectie gehaald`,
    );
  }

  reorderProducts(orderedSelectedIds: number[]): void {
    if (this.busy() || this.loading()) return;
    this.orderedIds.set(reorderCatalogSelection(this.orderedProducts(), this.selected(), orderedSelectedIds)
      .map(product => product.id!));
  }

  resetProductOrder(): void {
    if (this.busy() || this.loading()) return;
    this.orderedIds.set(applyCatalogProductOrder(this.products(), []).map(product => product.id!));
    this.ui.toast('Standaardvolgorde hersteld. Sla op om deze voortaan te gebruiken.');
  }

  async saveProductOrder(): Promise<void> {
    const previous = this.savedOrder();
    if (!previous || !this.canSaveOrder()) return;
    const ids = normalizedCatalogOrderIds(this.products(), this.orderedIds());
    this.savingOrder.set(true);
    this.orderError.set(null);
    try {
      const saved = await this.catalog.saveCatalogOrder(previous.revision, ids);
      if (this.destroyed) return;
      this.savedOrder.set(saved);
      this.orderedIds.set(normalizedCatalogOrderIds(this.products(), saved.orderedIds));
      this.ui.toast('Catalogusvolgorde opgeslagen voor volgende exports');
    } catch (failure) {
      if (this.destroyed) return;
      this.orderConflict.set((failure as { status?: number })?.status === 409);
      const message = messageOf(failure, 'De volgorde is niet opgeslagen. Je aanpassingen staan er nog; probeer opnieuw.');
      this.orderError.set(message);
      this.ui.toast(message, 'err');
    } finally {
      if (!this.destroyed) this.savingOrder.set(false);
    }
  }

  async reloadSavedOrder(): Promise<void> {
    if (this.busy() || this.loading() || !this.dataReady()) return;
    this.loadingOrder.set(true);
    try {
      const saved = await this.catalog.catalogOrder();
      if (this.destroyed) return;
      this.savedOrder.set(saved);
      this.orderedIds.set(initialCatalogOrderIds(this.products(), saved, this.orderedIds()));
      this.orderError.set(null);
      this.orderConflict.set(false);
      this.ui.toast('Opgeslagen catalogusvolgorde geladen');
    } catch (failure) {
      if (!this.destroyed) this.orderError.set(messageOf(failure, 'De opgeslagen volgorde kon niet worden geladen. Probeer opnieuw.'));
    } finally {
      if (!this.destroyed) this.loadingOrder.set(false);
    }
  }

  /* ------------------------------------------------- prices for a customer */

  async loadCustomers(): Promise<void> {
    this.customersState.set('LOADING');
    try {
      const customers = await this.sales.customers();
      if (this.destroyed) return;
      this.customers.set(customers.filter((customer) => customer.id !== null)
        .sort((a, b) => a.company.localeCompare(b.company, 'nl-BE')));
      this.customersState.set('READY');
      const chosen = this.customerId();
      if (chosen !== null && !customers.some((customer) => customer.id === chosen)) {
        /* Its one-off prices were typed for that customer: they must not end up in a general price list. */
        this.customerId.set(null);
        this.priceOverrides.set(new Map());
        this.pricesFor.set(null);
        this.ui.toast('De gekozen klant bestaat niet meer', 'err');
      }
    } catch {
      if (!this.destroyed) this.customersState.set('ERROR');
    }
  }

  async loadCustomerPrices(customerId: number | null = this.targetCustomerId()): Promise<void> {
    const request = ++this.customerPricesRequest;
    this.customerPrices.set(new Map());
    this.customerPricesState.set(customerId === null ? 'IDLE' : 'LOADING');
    if (customerId === null) return;
    try {
      const prices = await this.customerPriceApi.list(customerId);
      if (this.destroyed || request !== this.customerPricesRequest) return;
      this.customerPrices.set(new Map(prices.map((price) => [price.productId, price])));
      this.customerPricesState.set('READY');
    } catch {
      if (!this.destroyed && request === this.customerPricesRequest) this.customerPricesState.set('ERROR');
    }
  }

  /** Another customer (or none, or a free name): the one-off prices were for the previous one, so they go, after a question. */
  chooseRecipient(select: HTMLSelectElement): void {
    const value = select.value;
    const previous = this.recipientValue();
    if (value === previous) return;
    const commit = () => {
      this.customerId.set(value.startsWith('c') ? Number(value.slice(1)) : null);
      this.named.set(value === 'name');
      this.priceOverrides.set(new Map());
      this.pricesFor.set(null);
    };
    const count = this.overrideCount();
    if (!count) {
      commit();
      return;
    }
    this.ui.confirm({
      title: 'Andere klant kiezen?',
      message: count === 1 ? 'Je aangepaste prijs vervalt.' : `Je ${count} aangepaste prijzen vervallen.`,
      confirmLabel: 'Andere klant',
    }, commit, undefined, () => { select.value = previous; });
  }

  /**
   * A free name left (blur or Enter) that differs from the one the one-off
   * prices were typed for is another recipient: they go after the same
   * question as another customer. "Zelfde klant" keeps them for a corrected
   * spelling; Annuleren puts the previous name back.
   */
  confirmRecipientName(): void {
    if (this.askingRecipient || !this.named()) return;
    const owner = this.pricesFor();
    const key = this.recipientKey();
    if (!this.priceOverrides().size || !owner || owner.key === 'n:') {
      if (this.priceOverrides().size) this.pricesFor.set({ key, name: this.recipientName().trim() });
      return;
    }
    if (owner.key === key) return;
    const settle = (change: () => void) => () => { this.askingRecipient = false; change(); };
    const adopt = () => this.pricesFor.set({ key: this.recipientKey(), name: this.recipientName().trim() });
    const commit = () => { this.priceOverrides.set(new Map()); this.pricesFor.set(null); };
    const count = this.overrideCount();
    if (!count) {
      commit();
      return;
    }
    this.askingRecipient = true;
    this.ui.confirm({
      title: 'Andere klant kiezen?',
      message: count === 1 ? 'Je aangepaste prijs vervalt.' : `Je ${count} aangepaste prijzen vervallen.`,
      confirmLabel: 'Andere klant',
      secondaryLabel: 'Zelfde klant',
    }, settle(commit), settle(adopt), settle(() => this.recipientName.set(owner.name)));
  }

  openPriceSheet(): void {
    if (this.recipientNameChanged()) {
      this.confirmRecipientName();
      return;
    }
    if (this.dataReady()) this.priceSheetOpen.set(true);
  }

  /** Products taken in from Prijzen aanpassen: added to the PDF (never replacing it), so step 03 and the counts follow. */
  includeProducts(ids: readonly number[]): void {
    const known = new Set(this.products().map((product) => product.id));
    this.selected.update((current) => selectProductIds(current, ids.filter((id) => known.has(id))));
  }

  /** The sheet's prices; one that prints what the PDF would print anyway is not kept. */
  applyPrices(overrides: ReadonlyMap<number, CatalogPriceOverride>): void {
    const products = new Map(this.products().map((product) => [product.id, product]));
    const stored = this.customerPrices();
    const kept = new Map([...overrides].filter(([id, price]) => {
      const product = products.get(id);
      return !!product && changesPrint(product, price, standardPrice(product, stored.get(id)));
    }));
    this.priceOverrides.set(kept);
    this.pricesFor.set(kept.size ? { key: this.recipientKey(), name: this.recipientName().trim() } : null);
    this.priceSheetOpen.set(false);
  }

  /** "Ook bewaren als prijzen van …" answered with the customer's full list; it applies before the sheet's prices do. */
  customerPricesSaved(prices: CustomerPrice[]): void {
    this.customerPricesRequest++;
    this.customerPrices.set(new Map(prices.map((price) => [price.productId, price])));
    this.customerPricesState.set('READY');
  }

  private buildRequest(): CatalogExportRequest {
    const brochure = this.brochure();
    const prices = this.includePrices();
    const customerId = prices ? this.customerId() : null;
    const recipientName = prices && customerId === null && this.named() ? this.recipientName().trim().slice(0, 120) : '';
    const overrides = this.requestPriceOverrides();
    return {
      productIds: this.selectedProducts().map(product => product.id!),
      preserveProductOrder: true,
      includePrices: this.includePrices(),
      includePhotos: this.includePhotos(),
      strictLanguage: true,
      photosPerProduct: this.includePhotos()
        ? this.layout() === 'BROCHURE' ? brochure.photosPerProduct : 1
        : undefined,
      title: '',
      intro: this.intro().trim(),
      language: this.language(),
      layout: this.layout(),
      brochure: this.layout() === 'BROCHURE'
        ? {
            includeOverview: true,
            includeCategoryIntros: brochure.includeCategoryIntros,
            includeCustomisation: brochure.includeCustomisation,
            includeOrdering: true,
            includeBackCover: brochure.includeBackCover,
            coverTitle: brochure.coverTitle.trim() || undefined,
            coverSubtitle: brochure.coverSubtitle.trim() || undefined,
          }
        : undefined,
      /* Only what is set travels: a request without them is the one every server knows. */
      ...(customerId !== null ? { customerId } : {}),
      ...(recipientName ? { recipientName } : {}),
      ...(prices && this.pricesValidUntil() ? { pricesValidUntil: this.pricesValidUntil() } : {}),
      ...(overrides.length ? { priceOverrides: overrides } : {}),
      /* A height or the spill of this PDF's own: each only when it differs from the standard (260 / 230 / 2). */
      ...catalogLoadFields(this.loadChoice()),
    };
  }

  private needsPriceServer(request: CatalogExportRequest): boolean {
    return request.customerId != null || !!request.recipientName || !!request.pricesValidUntil || !!request.priceOverrides?.length;
  }

  /** enrosed-prijslijst-<customer>-<lang>.pdf for a recipient, as the server names it; else the usual names. */
  private fileName(request: CatalogExportRequest, preflight: CatalogPreflightResult): string {
    const language = request.language.toLowerCase();
    const recipient = request.customerId != null || request.recipientName
      ? preflight.recipient?.name?.trim() || this.recipientLabel() : '';
    return recipient
      ? `enrosed-prijslijst-${recipientSlug(recipient)}-${language}.pdf`
      : `enrosed-${request.layout === 'BROCHURE' ? 'brochure' : 'catalogus'}-${language}.pdf`;
  }

  async saveCataloguePhotos(change: CataloguePhotoSelectionChange): Promise<void> {
    if (this.busy()) return;
    this.savingPhotos.set(true);
    try {
      const saved = await this.catalog.updateCataloguePhotos(change.familyId, change.selection);
      this.families.update(families => families.map(family => family.id === saved.id ? saved : family));
      this.ui.toast('Fotokeuzes opgeslagen · de volgende PDF gebruikt deze foto’s');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Fotokeuzes opslaan mislukt'), 'err');
    } finally {
      this.savingPhotos.set(false);
    }
  }

  private async handleRenderFailure(failure: unknown, toastFallback: string): Promise<void> {
    const decodedFailure = await this.decodeBlobError(failure);
    const missingTranslations = this.missingTranslationsFromFailure(decodedFailure);
    if (missingTranslations !== null) {
      this.showMissingTranslations(missingTranslations);
      return;
    }
    const refused = this.priceIssuesFromFailure(decodedFailure);
    if (refused) {
      this.priceIssues.set(refused.issues);
      /* The card says what and where; the toast only that the PDF did not come. */
      this.showRenderProblem(refused.message, 'PDF niet gemaakt: kijk de prijzen na');
      /* A product now sold on another unit: its price is typed again against the unit of now. */
      if (refused.issues.some((issue) => issue.code === 'BASIS_CHANGED')) void this.refreshProducts();
      return;
    }
    const fallback = 'De PDF-rendering mislukte of duurde te lang. Probeer opnieuw of selecteer minder producten.';
    const message = messageOf(decodedFailure, fallback);
    this.renderError.set(message);
    this.renderTranslationError.set(false);
    this.missingTranslationPaths.set([]);
    this.ui.toast(messageOf(decodedFailure, toastFallback), 'err');
  }

  /**
   * The products again, without touching the selection or the message on screen (load() clears that): after the PDF's
   * BASIS_CHANGED, and after the price sheet's kept prices were refused for the same reason.
   */
  protected async refreshProducts(): Promise<void> {
    try {
      const products = await this.catalog.products();
      if (!this.destroyed) this.products.set(orderCatalogProducts(products.filter((product) => !product.demo), this.categories()));
    } catch {
      /* The next load brings them. */
    }
  }

  private showRenderProblem(message: string, toast = message): void {
    this.renderError.set(message);
    this.renderTranslationError.set(false);
    this.missingTranslationPaths.set([]);
    this.ui.toast(toast, 'err');
  }

  /** 409 CATALOG_PRICES_INVALID: the one-off prices the server cannot print, each with its reason. */
  private priceIssuesFromFailure(failure: unknown): { message: string; issues: CatalogPriceIssue[] } | null {
    const response = failure as { status?: number; error?: { code?: unknown; message?: unknown; priceIssues?: unknown } | null };
    if (response.status !== 409 || response.error?.code !== 'CATALOG_PRICES_INVALID') return null;
    const message = typeof response.error.message === 'string' && response.error.message.trim()
      ? response.error.message.trim() : 'Niet alle aangepaste prijzen kunnen in de PDF.';
    return { message, issues: this.validPriceIssues(response.error.priceIssues) };
  }

  private validPriceIssues(issues: unknown): CatalogPriceIssue[] {
    if (!Array.isArray(issues)) return [];
    return issues.flatMap((issue: Partial<CatalogPriceIssue> | null) => issue && typeof issue.message === 'string' && issue.message.trim()
      ? [{ productId: Number(issue.productId) || 0, code: String(issue.code ?? ''), message: issue.message.trim() }] : []);
  }

  /**
   * The product a remark is about, as the selection names it. None for a remark about the whole PDF, nor in front of
   * the server's words when they already name the product (its SKU, or "Product #12"): each remark says it once.
   */
  private withProductNames(issues: readonly CatalogPriceIssue[]): (CatalogPriceIssue & { name: string })[] {
    const products = new Map(this.products().map((product) => [product.id, product]));
    return issues.map((issue) => {
      const product = issue.productId > 0 ? products.get(issue.productId) : undefined;
      const sku = product?.sku?.trim();
      if ((sku && issue.message.includes(sku)) || issue.message.includes(`Product #${issue.productId}`)) return { ...issue, name: '' };
      const variant = product ? [product.colour, product.variantSize].filter(Boolean).join(' · ') : '';
      const name = product ? `${product.name}${variant ? ` · ${variant}` : ''}` : issue.productId > 0 ? `Product #${issue.productId}` : '';
      return { ...issue, name };
    });
  }

  private persistPriceState(state: CatalogPriceState): void {
    try {
      sessionStorage.setItem(PRICE_STATE_KEY, JSON.stringify(state));
    } catch {
      /* Blocked tab storage: the choice lasts as long as this screen. */
    }
  }

  private restorePriceState(): void {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(PRICE_STATE_KEY) ?? 'null') as Partial<CatalogPriceState> | null;
      if (parsed?.version !== 1) return;
      if (typeof parsed.customerId === 'number' && Number.isSafeInteger(parsed.customerId) && parsed.customerId > 0) {
        this.customerId.set(parsed.customerId);
      } else if (parsed.named === true) {
        this.named.set(true);
      }
      if (typeof parsed.recipientName === 'string') this.recipientName.set(parsed.recipientName.slice(0, 120));
      if (typeof parsed.pricesValidUntil === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.pricesValidUntil)) {
        this.pricesValidUntil.set(parsed.pricesValidUntil);
      }
      if (Array.isArray(parsed.overrides)) {
        this.priceOverrides.set(new Map(parsed.overrides.flatMap((price) => {
          const valid = storedOverride(price);
          return valid ? [[valid.productId, valid] as const] : [];
        })));
      }
      const owner = parsed.pricesFor;
      this.pricesFor.set(owner && typeof owner.key === 'string' && typeof owner.name === 'string'
        ? { key: owner.key.slice(0, 130), name: owner.name.slice(0, 120) }
        : this.priceOverrides().size ? { key: this.recipientKey(), name: this.recipientName().trim() } : null);
    } catch {
      /* A damaged or blocked tab store starts without a customer and without one-off prices. */
    }
  }

  private async decodeBlobError(failure: unknown): Promise<unknown> {
    const response = failure as { status?: number; error?: unknown };
    if (!(response.error instanceof Blob)) return failure;
    try {
      const text = await response.error.text();
      if (!text.trim()) return failure;
      return { status: response.status, error: JSON.parse(text) as unknown };
    } catch {
      return failure;
    }
  }

  private missingTranslationsFromFailure(failure: unknown): string[] | null {
    const response = failure as {
      status?: number;
      error?: { missingPaths?: unknown };
    };
    if (response.status !== 409 || !Array.isArray(response.error?.missingPaths)) return null;
    return this.validMissingPaths(response.error.missingPaths);
  }

  private showMissingTranslations(paths: readonly unknown[]): void {
    const missingPaths = this.validMissingPaths(paths);
    const count = missingPaths.length;
    const message = count
      ? `De ${this.languageLabel()} catalogus mist ${count} verplichte `
        + `vertaling${count === 1 ? '' : 'en'}. Vul de tekst aan of sluit getroffen producten tijdelijk uit.`
      : `De ${this.languageLabel()} catalogus mist nog verplichte vertalingen. `
        + 'Open de catalogusteksten en probeer daarna opnieuw.';
    this.missingTranslationPaths.set(missingPaths);
    this.renderTranslationError.set(true);
    this.renderError.set(message);
    this.ui.toast(message, 'err');
  }

  private validMissingPaths(paths: readonly unknown[] | null | undefined): string[] {
    if (!Array.isArray(paths)) return [];
    return [...new Set(paths
      .filter((path): path is string => typeof path === 'string')
      .map((path) => path.trim())
      .filter(Boolean))];
  }

  languageLabel(): string {
    return this.languages.find((language) => language.code === this.language())?.label
      ?? this.language();
  }

  private persistState(state: CatalogBuilderState): void {
    const serialized = JSON.stringify(state);
    let persistence: 'DEVICE' | 'SESSION' | 'NONE' = 'NONE';
    try {
      localStorage.setItem(STATE_KEY, serialized);
      persistence = 'DEVICE';
    } catch {
      /* Try tab storage if persistent storage is unavailable. */
    }
    try {
      sessionStorage.setItem(STATE_KEY, serialized);
      if (persistence !== 'DEVICE') persistence = 'SESSION';
    } catch {
      /* The in-memory document remains usable when browser storage is blocked. */
    }
    this.draftPersistence.set(persistence);
  }

  private restoreState(): void {
    let stored: string | null = null;
    try { stored = localStorage.getItem(STATE_KEY); } catch { /* Try this tab's draft next. */ }
    if (stored === null) {
      try { stored = sessionStorage.getItem(STATE_KEY) ?? sessionStorage.getItem(LEGACY_STATE_KEY); }
      catch { /* Storage is optional; the default collection still loads. */ }
    }
    try {
      const parsed = JSON.parse(stored ?? 'null') as Partial<CatalogBuilderState> | null;
      if (parsed?.version !== 2 && parsed?.version !== 3) return;
      if (parsed.layout === 'SIMPLE' || parsed.layout === 'BROCHURE') {
        this.layout.set(parsed.layout);
      }
      if (this.languages.some((language) => language.code === parsed.language)) {
        this.language.set(parsed.language!);
      }
      if (typeof parsed.intro === 'string') this.intro.set(parsed.intro);
      if (typeof parsed.includePrices === 'boolean') this.includePrices.set(parsed.includePrices);
      if (typeof parsed.includePhotos === 'boolean') this.includePhotos.set(parsed.includePhotos);
      if (typeof parsed.compressPdf === 'boolean') this.compressPdf.set(parsed.compressPdf);
      if (Array.isArray(parsed.selectedIds)) {
        this.storedSelection = parsed.selectedIds.filter(
          (id): id is number => Number.isInteger(id) && id > 0,
        );
      }
      if (parsed.version === 3 && Array.isArray(parsed.orderedIds)) {
        this.storedOrder = parsed.orderedIds.filter((id): id is number => Number.isInteger(id) && id > 0);
      }
      this.brochure.set({
        photosPerProduct: this.clampPhotoCount(parsed.photosPerProduct),
        coverTitle: typeof parsed.coverTitle === 'string' ? parsed.coverTitle : '',
        coverSubtitle: typeof parsed.coverSubtitle === 'string' ? parsed.coverSubtitle : '',
        includeOverview: this.booleanOrDefault(parsed.includeOverview, true),
        includeCategoryIntros: this.booleanOrDefault(parsed.includeCategoryIntros, true),
        includeCustomisation: this.booleanOrDefault(parsed.includeCustomisation, true),
        includeOrdering: this.booleanOrDefault(parsed.includeOrdering, true),
        includeBackCover: this.booleanOrDefault(parsed.includeBackCover, true),
      });
    } catch {
      /* An old or damaged draft starts with safe defaults. */
    }
  }

  private clampPhotoCount(value: number | undefined): number {
    if (typeof value !== 'number') return DEFAULT_BROCHURE.photosPerProduct;
    return Math.max(1, Math.min(4, Math.round(value)));
  }

  private booleanOrDefault(value: boolean | undefined, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
  }
}
