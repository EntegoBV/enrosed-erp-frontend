import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { AuthImage } from '../../core/api/auth-image';
import { catalogueFamilies } from './catalog-studio';
import { CataloguePhotoSelectionChange } from './catalogue-photo-selection';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  CatalogApi,
  CatalogExportRequest,
  CatalogLayout,
} from '../../core/api/catalog-api';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import { Category, LANGUAGES, LanguageCode, Product, ProductFamily } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Ui } from '../../shared/ui';
import {
  CatalogBrochureDraft,
  CatalogBrochureSettings,
} from './catalog-brochure-settings';
import { CatalogProductSelection } from './catalog-product-selection';
import {
  catalogTranslationAffectedProductIds,
  catalogTranslationLinks,
} from './catalog-translation-issues';
import { orderCatalogProducts } from './catalog-product-order';
import { deselectProductIds } from './catalog-product-selection-state';

const STATE_KEY = 'enrosed.catalogBuilder.v2';

interface CatalogBuilderState extends CatalogBrochureDraft {
  version: 2;
  layout: CatalogLayout;
  language: LanguageCode;
  intro: string;
  includePrices: boolean;
  includePhotos: boolean;
  selectedIds: number[];
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

@Component({
  selector: 'app-catalog-export',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AuthImage,
    CatalogBrochureSettings,
    CatalogProductSelection,
    FormsModule,
    PageHeader,
    RouterLink,
  ],
  template: `
    <app-page-header
      title="Catalogusstudio"
      subtitle="Van uw assortiment naar een professionele PDF"
      [showBack]="true"
      [showBell]="false"
    />

    <div class="content content--with-action-bar catalog-page"
         [attr.aria-busy]="busy() || loading()">
      <fieldset class="catalog-workspace" [disabled]="busy()">
        <legend class="sr-only">Catalogus samenstellen</legend>

        <aside class="studio-preview" aria-labelledby="studio-preview-title">
          <div class="studio-preview__heading">
            <span>ENROSED · CATALOGUSSTUDIO</span>
            <span class="studio-preview__format">{{ layout() === 'BROCHURE' ? 'A4 · Brochure' : 'A4 · Prijslijst' }}</span>
          </div>
          <div class="cover-stage">
            <div class="cover-sheet" [class.cover-sheet--simple]="layout() === 'SIMPLE'">
              <div class="cover-sheet__copy">
                <img class="cover-sheet__brand" [src]="layout() === 'BROCHURE' ? '/catalog-logo-gold.png' : '/logo-ui.png'" alt="ENROSED" />
                <span class="cover-sheet__edition">WHOLESALE COLLECTION</span>
                <h2 id="studio-preview-title">{{ previewTitle() }}<em>{{ previewSubtitle() }}</em></h2>
                <span class="cover-sheet__rule"></span>
                @if (layout() === 'SIMPLE') {
                  <span class="cover-sheet__language">{{ languageLabel() }} · {{ selectedFamilyCount() }} productgroepen</span>
                }
              </div>
              @if (layout() === 'SIMPLE') {
              <div class="cover-sheet__image">
                @if (includePhotos() && coverPhoto(); as photo) {
                  <img [appAuthSrc]="photo.url" [alt]="photo.alt" (error)="coverImageFailed(photo.url)" />
                } @else {
                  <span class="cover-sheet__monogram" aria-hidden="true">E</span>
                }
                @if (layout() === 'SIMPLE') {
                  <div class="cover-sheet__lines" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
                }
              </div>
              }
              <div class="cover-sheet__foot"><span>ENROSED.COM</span><span>{{ language() }}</span></div>
            </div>
          </div>
          <p class="preview-caption">Opmaakimpressie · de PDF gebruikt uw gekozen teksten en foto’s.</p>
          <div class="studio-totals" aria-label="Inhoud van de catalogus">
            <span><b>{{ selectedFamilyCount() }}</b><small>productgroepen</small></span>
            <span><b>{{ selected().size }}</b><small>varianten</small></span>
            <span><b>{{ selectedCategoryCount() }}</b><small>categorieën</small></span>
          </div>
          @if (desktop.active() && previewProducts().length && includePhotos()) {
            <div class="preview-range" aria-label="Een blik op uw selectie">
              @for (family of previewProducts(); track family.key) {
                @if (family.photo; as photo) {
                  <div [attr.title]="family.name"><img [appAuthSrc]="photo.url" [alt]="family.name" /></div>
                }
              }
            </div>
          }
          <p class="studio-note">Uw selectie blijft bewaard terwijl u verder werkt. De vertalingen worden gecontroleerd vóór het downloaden.</p>
        </aside>

        <div class="catalog-settings">
          <section class="studio-section" aria-labelledby="catalog-mode-title">
            <div class="studio-section__head"><span class="studio-step">01</span><div>
              <h2 id="catalog-mode-title">Een document dat verkoopt.</h2>
              <p>Kies hoe u uw collectie presenteert.</p>
            </div></div>
            <div class="mode-choice" role="group" aria-label="Soort catalogus">
              <button type="button" [class.active]="layout() === 'BROCHURE'"
                      [attr.aria-pressed]="layout() === 'BROCHURE'" (click)="layout.set('BROCHURE')">
                <span class="mode-choice__paper" aria-hidden="true"><i></i></span>
                <span class="mode-choice__copy"><b>Handelscatalogus</b><small>Fotografie, collectie en productdetails</small><em>Voor de beurs &amp; uw klanten</em></span>
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
              <h2 id="catalog-content-title">Op maat van uw lezer.</h2>
              <p>Eén taal, consistent door de hele catalogus.</p>
            </div></div>
            <label class="field studio-language">
              <span>Documenttaal</span>
              <select class="select" [ngModel]="language()" (ngModelChange)="language.set($event)">
                @for (option of languages; track option.code) { <option [value]="option.code">{{ option.label }}</option> }
              </select>
            </label>
            <div class="option-grid">
              <label class="option-toggle">
                <span><b id="catalog-prices-label">Prijzen tonen</b><small id="catalog-prices-help">{{ includePrices() ? 'Per stuk, excl. btw en levering' : 'Zonder prijzen in de PDF' }}</small></span>
                <span class="option-toggle__control">
                  <span class="option-toggle__value" aria-hidden="true">{{ includePrices() ? 'Ja' : 'Nee' }}</span>
                  <input class="studio-switch" type="checkbox" role="switch" aria-labelledby="catalog-prices-label"
                         aria-describedby="catalog-prices-help" [ngModel]="includePrices()" (ngModelChange)="includePrices.set($event)" />
                </span>
              </label>
              <label class="option-toggle">
                <span><b>Productfoto’s</b><small>Uw foto voor de catalogus krijgt voorrang</small></span>
                <input class="studio-switch" type="checkbox" [ngModel]="includePhotos()" (ngModelChange)="includePhotos.set($event)" />
              </label>
            </div>
          </section>

          <app-catalog-product-selection
            [products]="products()" [families]="families()" [categories]="categories()" [selected]="selected()"
            [loading]="loading()" [loadError]="loadError()" [disabled]="busy()"
            [showReferencePrices]="includePrices()" (selectedChange)="selected.set($event)" (retry)="load()"
            (cataloguePhotosRequested)="saveCataloguePhotos($event)"
          />

          @if (layout() === 'BROCHURE') {
            <app-catalog-brochure-settings
              [disabled]="busy()" [includePhotos]="includePhotos()" [selectedFamilyCount]="selectedFamilyCount()"
              [settings]="brochure()" (settingsChange)="brochure.set($event)"
            />
          }
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
                                 [attr.aria-label]="'Vertaling aanvullen: ' + issue.entityLabel + ', ' + issue.fieldLabel">
                                <span><b>{{ issue.entityLabel }}</b><small>{{ issue.fieldLabel }}</small></span>
                                <i aria-hidden="true">Vertaling aanvullen →</i>
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
                                 [attr.aria-label]="'Catalogustekst aanvullen: ' + issue.entityLabel + ', ' + issue.fieldLabel">
                                <span><b>{{ issue.entityLabel }}</b><small>{{ issue.fieldLabel }}</small></span>
                                <i aria-hidden="true">Catalogustekst aanvullen →</i>
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
              </div>
              <div class="render-error__actions">
                @if (renderTranslationError() && !renderTranslationIssues().length) {
                  <a class="btn btn--sm" routerLink="/catalog/texts"
                     [queryParams]="{ language: language(), returnTo: '/catalog-export' }">
                    Catalogusteksten openen
                  </a>
                }
                <button class="btn btn--sm btn--primary" type="button" [disabled]="busy()"
                        (click)="retryRender()">Opnieuw proberen</button>
              </div>
            </section>
          }
          </div>
        </div>
      </fieldset>
    </div>

    <div class="action-bar catalog-action" [attr.aria-busy]="busy()">
      <div class="action-bar__total">
        <div class="action-bar__label">
          {{ languageLabel() }} · {{ includePrices() ? 'Met prijzen' : 'Zonder prijzen' }}
        </div>
        <div class="action-bar__value">{{ selectedFamilyCount() }} groepen · {{ selected().size }} varianten</div>
      </div>
      <div class="catalog-action__buttons">
        <button class="btn btn--primary" type="button"
                [disabled]="!canExport() || busy()" (click)="download()">
          {{ downloading() ? 'PDF wordt gemaakt…' : 'Download catalogus' }}
        </button>
      </div>
      <span class="sr-only" aria-live="polite">{{ actionStatus() }}</span>
    </div>
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
    .cover-sheet__language { font-size: 8px; letter-spacing: .04em; opacity: .8; }
    .cover-sheet__image { position: relative; display: grid; flex: 1 1 auto; min-height: 0; place-items: center; background: #f5f0e8; overflow: hidden; }
    .cover-sheet__image > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
    .cover-sheet__monogram { font-family: Georgia, serif; font-size: 90px; color: #c7a895; }
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
    .cover-sheet--simple .cover-sheet__copy { flex-basis: 37%; background: #f7f3eb; color: #641c32; }
    .cover-sheet--simple .cover-sheet__brand { filter: brightness(0); }
    .cover-sheet--simple h2 { font-size: 25px; }
    .cover-sheet--simple h2 em { color: #916b73; }
    .cover-sheet--simple .cover-sheet__image > img { inset: 0 0 auto; height: 55%; }
    .cover-sheet__lines { position: absolute; inset: 59% 9% 1%; display: grid; gap: 9px; }
    .cover-sheet__lines i { border-block: 1px solid #d8cfc7; }
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
    .catalog-action .action-bar__label { font-size: 10px; text-transform: none; letter-spacing: 0; margin-bottom: 3px; }
    .catalog-action .action-bar__value { font-size: 15px; font-weight: 700; }
    .catalog-action__buttons { display: flex; gap: 7px; }
    .catalog-action__buttons .btn { min-height: 48px; padding-inline: 22px; border-radius: 14px; font-size: 14px; white-space: nowrap; }
    @container catalog-page (min-width: 860px) {
      .catalog-workspace { grid-template-columns: minmax(300px, .85fr) minmax(430px, 1.15fr); gap: 24px; align-items: start; }
      .studio-preview { position: sticky; top: 88px; padding: 24px; }
      .cover-stage { padding: 30px 26px 26px; }
      .studio-section { padding: 24px; }
    }
    @media (max-width: 679px) {
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
  private readonly ui = inject(Ui);
  private readonly destroyRef = inject(DestroyRef);
  private storedSelection: number[] | null = null;
  private selectionInitialized = false;
  private destroyed = false;

  readonly layout = signal<CatalogLayout>('BROCHURE');
  readonly language = signal<LanguageCode>('NL');
  readonly intro = signal('');
  readonly includePrices = signal(false);
  readonly includePhotos = signal(true);
  readonly brochure = signal<CatalogBrochureDraft>({ ...DEFAULT_BROCHURE });

  readonly products = signal<Product[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly families = signal<ProductFamily[]>([]);
  readonly selected = signal<Set<number>>(new Set());
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly dataReady = signal(false);
  readonly downloading = signal(false);
  readonly savingPhotos = signal(false);
  readonly renderError = signal<string | null>(null);
  readonly renderTranslationError = signal(false);
  readonly missingTranslationPaths = signal<string[]>([]);

  readonly busy = computed(() => this.downloading() || this.savingPhotos());
  readonly canExport = computed(() =>
    this.dataReady() && this.selected().size > 0 && !this.loadError());
  readonly actionStatus = computed(() => {
    if (this.savingPhotos()) return 'Fotokeuzes worden opgeslagen.';
    if (this.downloading()) return 'PDF wordt gemaakt. Dit kan enkele minuten duren.';
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
  readonly selectedProducts = computed(() => this.products().filter((product) => product.id !== null && this.selected().has(product.id)));
  readonly selectedCategoryCount = computed(() => new Set(this.selectedProducts().map((product) => product.categoryId).filter((id) => id !== null)).size);
  readonly previewProducts = computed(() => catalogueFamilies(this.selectedProducts(), this.families()).filter((family) => family.photo).slice(0, 4));
  private readonly failedCoverPhotos = signal<ReadonlySet<string>>(new Set());
  readonly coverPhoto = computed(() => {
    for (const product of this.selectedProducts()) {
      const lead = product.photos.find((photo) => photo.leadFor?.includes('CATALOGUE') && !this.failedCoverPhotos().has(photo.url));
      if (lead) return { url: lead.url, alt: product.name };
    }
    const category = this.categories().find((row) => this.selectedProducts().some((product) => product.categoryId === row.id) && row.photos?.length);
    if (category?.id !== null && category?.id !== undefined && category.photos?.[0]) {
      const url = this.catalog.categoryPhotoUrl(category.id, category.photos[0].id);
      if (!this.failedCoverPhotos().has(url)) return { url, alt: category.name };
    }
    const family = this.previewProducts().find((group) => group.photo && !this.failedCoverPhotos().has(group.photo.url));
    return family?.photo ? { url: family.photo.url, alt: family.name } : null;
  });
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
    void this.load();

    effect(() => {
      if (!this.dataReady()) return;
      const brochure = this.brochure();
      const state: CatalogBuilderState = {
        version: 2,
        layout: this.layout(),
        language: this.language(),
        intro: this.intro(),
        includePrices: this.includePrices(),
        includePhotos: this.includePhotos(),
        selectedIds: [...this.selected()].sort((a, b) => a - b),
        ...brochure,
      };
      try {
        sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
      } catch {
        /* The builder remains usable when session storage is blocked. */
      }
    });

    let previousRequest = '';
    effect(() => {
      const currentRequest = this.requestKey();
      if (previousRequest && previousRequest !== currentRequest) {
        this.renderError.set(null);
        this.renderTranslationError.set(false);
        this.missingTranslationPaths.set([]);
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
    this.loadError.set(null);
    try {
      const [products, categories, families] = await Promise.all([
        this.catalog.products(),
        this.catalog.categories(),
        this.catalog.productFamilies().catch(() => [] as ProductFamily[]),
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
      if (!this.destroyed) this.loading.set(false);
    }
  }

  async download(): Promise<void> {
    if (!this.canExport() || this.busy()) return;
    const request = this.buildRequest();
    const key = JSON.stringify(request);
    this.renderError.set(null);
    this.renderTranslationError.set(false);
    this.missingTranslationPaths.set([]);
    this.downloading.set(true);
    try {
      const preflight = await this.catalog.preflightCatalog(request);
      if (this.destroyed || key !== this.requestKey()) return;
      const missingPaths = this.validMissingPaths(preflight.missingPaths);
      if (!preflight.ready || missingPaths.length) {
        this.showMissingTranslations(missingPaths);
        return;
      }
      const blob = await this.catalog.exportCatalog(request);
      if (this.destroyed || key !== this.requestKey()) return;
      saveBlob(
        blob,
        `enrosed-${request.layout === 'BROCHURE' ? 'brochure' : 'catalogus'}-${request.language.toLowerCase()}.pdf`,
      );
      this.ui.toast('Catalogus gedownload');
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

  private buildRequest(): CatalogExportRequest {
    const brochure = this.brochure();
    return {
      productIds: this.products()
        .filter((product) => product.id !== null && this.selected().has(product.id))
        .map((product) => product.id!),
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
    };
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
    const fallback = 'De PDF-rendering mislukte of duurde te lang. Probeer opnieuw of selecteer minder producten.';
    const message = messageOf(decodedFailure, fallback);
    this.renderError.set(message);
    this.renderTranslationError.set(false);
    this.missingTranslationPaths.set([]);
    this.ui.toast(messageOf(decodedFailure, toastFallback), 'err');
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

  coverImageFailed(url: string): void {
    this.failedCoverPhotos.update((current) => new Set([...current, url]));
  }

  languageLabel(): string {
    return this.languages.find((language) => language.code === this.language())?.label
      ?? this.language();
  }

  private restoreState(): void {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(STATE_KEY) ?? 'null') as
        Partial<CatalogBuilderState> | null;
      if (parsed?.version !== 2) return;
      if (parsed.layout === 'SIMPLE' || parsed.layout === 'BROCHURE') {
        this.layout.set(parsed.layout);
      }
      if (this.languages.some((language) => language.code === parsed.language)) {
        this.language.set(parsed.language!);
      }
      if (typeof parsed.intro === 'string') this.intro.set(parsed.intro);
      if (typeof parsed.includePrices === 'boolean') this.includePrices.set(parsed.includePrices);
      if (typeof parsed.includePhotos === 'boolean') this.includePhotos.set(parsed.includePhotos);
      if (Array.isArray(parsed.selectedIds)) {
        this.storedSelection = parsed.selectedIds.filter(
          (id): id is number => Number.isInteger(id) && id > 0,
        );
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
