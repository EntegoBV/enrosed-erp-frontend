import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  Category,
  LANGUAGES,
  LanguageCode,
  Product,
  ProductFamily,
  ProductFamilyText,
  PublicationStatus,
} from '../../core/api/models';
import {
  ProductFamilyGallery,
  ProductFamilyImageVariantChange,
} from './product-family-gallery';
import { ProductFamilySourceDetails } from './product-family-source-details';
import {
  FeaturedProductEligibility,
  featuredProductEligibility,
} from '../../shared/product-featured-eligibility';

interface FamilyFeaturedOption {
  member: ProductFamily['members'][number];
  eligibility: FeaturedProductEligibility;
}

/**
 * Keeps website master data available without letting it take over the daily
 * purchasing and sales form. The native details element is closed by default,
 * keyboard accessible and deliberately non-sticky on small screens.
 */
@Component({
  selector: 'app-product-publication-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, ProductFamilyGallery, ProductFamilySourceDetails],
  template: `
    <details class="publication" id="publication">
      <summary>
        <span class="publication__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
          </svg>
        </span>
        <span class="publication__summary-copy">
          <b>Website &amp; publicatie</b>
          <small>{{ familyLabel() }}</small>
        </span>
        <span class="publication__summary-status">
          <span class="channel-state" [class.channel-state--live]="websiteStatus() === 'PUBLISHED'">
            Website
          </span>
          <span
            class="channel-state"
            [class.channel-state--live]="orderAppStatus() === 'PUBLISHED'"
          >
            Orderapp
          </span>
          <span
            class="channel-state"
            [class.channel-state--live]="catalogueStatus() === 'PUBLISHED'"
          >
            Catalogus
          </span>
        </span>
        @if (issueCount()) {
          <span class="issue-count">{{ issueCount() }} punt(en)</span>
        } @else if (family()) {
          <span class="complete-count">Compleet</span>
        }
        <span class="publication__chevron" aria-hidden="true">⌄</span>
      </summary>

      <fieldset
        class="publication__body"
        [disabled]="busy()"
        [attr.aria-busy]="busy()"
      >
        <div class="family-picker">
          <label class="field">
            <span>Productfamilie</span>
            <select
              class="select"
              [ngModel]="product().familyId"
              (ngModelChange)="selectFamily($event)"
            >
              <option [ngValue]="null">Nog niet gekoppeld</option>
              @for (option of families(); track option.id) {
                <option [ngValue]="option.id">
                  {{ option.name || option.familyKey }} · {{ option.variantCount }} variant(en)
                </option>
              }
            </select>
            <small class="field__hint">Kies een andere familie om deze variant te verplaatsen.</small>
          </label>
          <div class="family-picker__actions">
            @if (product().familyId !== null) {
              <button class="btn btn--sm" type="button" (click)="unlinkFamily()">
                Loskoppelen
              </button>
            }
            <button class="btn btn--sm" type="button" (click)="requestFamilyCreation()">
              + Nieuwe familie
            </button>
          </div>
        </div>

        @if (family(); as family) {
          <div class="family-impact" role="note">
            <span aria-hidden="true">i</span>
            <p>
              Je bewerkt <b>{{ family.name || family.familyKey }}</b
              >. Namen, websitefoto's, volgorde en SEO gelden voor alle
              <b>{{ family.variantCount || 1 }} variant(en)</b>. Inkoop, voorraad, verpakking
              en prijzen hierboven blijven per variant.
            </p>
          </div>

          <section class="family-members" aria-labelledby="family-members-title">
            <div class="family-members__head">
              <div>
                <h3 id="family-members-title">Varianten in deze familie</h3>
                <p>Alleen een overzicht; elke variant behoudt eigen voorraad, prijs en verpakking.</p>
              </div>
              <span>{{ members().length || family.variantCount }}</span>
            </div>
            @if (members().length) {
              <ul>
                @for (member of members(); track member.productId) {
                  <li [class.family-member--current]="member.productId === product().id">
                    <a [routerLink]="['/products', member.productId]"
                       [attr.aria-current]="member.productId === product().id ? 'page' : null">
                      <span class="family-member__swatch"
                            [style.backgroundColor]="member.colourHex || null"
                            [class.family-member__swatch--empty]="!member.colourHex"
                            aria-hidden="true"></span>
                      <span class="family-member__copy">
                        <b>{{ member.colour || 'Geen kleur' }}@if (member.size) { · {{ member.size }} }</b>
                        <small>{{ member.sku || member.name }}</small>
                      </span>
                      @if (member.productId === product().id) {
                        <span class="family-member__current">Deze variant</span>
                      } @else if (!member.active) {
                        <span class="family-member__inactive">Inactief</span>
                      }
                      <span aria-hidden="true">›</span>
                    </a>
                  </li>
                }
              </ul>
            } @else {
              <p class="family-members__empty">De varianten verschijnen hier na opslaan.</p>
            }
            <label class="field family-card-variant">
              <span>Productkaartfoto</span>
              <select class="select" [ngModel]="family.cardFeaturedProductId ?? null"
                      [disabled]="!members().length && missingCardFeaturedProductId() === null"
                      (ngModelChange)="patch({ cardFeaturedProductId: numberOrNull($event) })">
                <option [ngValue]="null">Automatisch · eerste actieve variant</option>
                @for (option of cardFeaturedOptions(); track option.member.productId) {
                  <option [ngValue]="option.member.productId" [disabled]="!option.eligibility.eligible">
                    {{ memberOptionLabel(option.member) }}{{ eligibilityLabel(option.eligibility) }}
                  </option>
                }
                @if (missingCardFeaturedProductId() !== null) {
                  <option [ngValue]="missingCardFeaturedProductId()" disabled>
                    SKU #{{ missingCardFeaturedProductId() }} · geen publieke foto
                  </option>
                }
              </select>
              <small class="field__hint">
                Bepaalt welke kleur of maat op website- en orderappkaarten wordt getoond.
              </small>
            </label>
          </section>

          <section class="subsection" aria-labelledby="publication-channels-title">
            <div class="subsection__head">
              <div>
                <h3 id="publication-channels-title">Kanalen</h3>
                <p>Maak pas live wanneer de controlepunten zijn opgelost.</p>
              </div>
            </div>
            <label class="switch-row">
              <span
                ><b>Publieke familie actief</b
                ><small>Verbergt alle kleurvarianten als dit uitstaat.</small></span
              >
              <input
                type="checkbox"
                [ngModel]="family.active"
                (ngModelChange)="patch({ active: $event })"
              />
            </label>
            <div class="channel-grid">
              <label class="channel-card">
                <span><b>Website</b><small>Publieke productpagina</small></span>
                <select
                  class="select select--sm"
                  [ngModel]="family.websiteStatus"
                  (ngModelChange)="patch({ websiteStatus: $event })"
                >
                  <option value="DRAFT">Concept</option>
                  <option value="READY">Klaar voor controle</option>
                  <option value="PUBLISHED">Gepubliceerd</option>
                </select>
              </label>
              <label class="channel-card">
                <span><b>Orderapp</b><small>Bestelbaar voor klanten</small></span>
                <select
                  class="select select--sm"
                  [ngModel]="family.orderAppStatus"
                  (ngModelChange)="patch({ orderAppStatus: $event })"
                >
                  <option value="DRAFT">Concept</option>
                  <option value="READY">Klaar voor controle</option>
                  <option value="PUBLISHED">Gepubliceerd</option>
                </select>
              </label>
              <label class="channel-card">
                <span><b>Catalogus</b><small>Voor de toekomstige catalogussync</small></span>
                <select
                  class="select select--sm"
                  [ngModel]="family.catalogueStatus"
                  (ngModelChange)="patch({ catalogueStatus: $event })"
                >
                  <option value="DRAFT">Concept</option>
                  <option value="READY">Klaar voor controle</option>
                  <option value="PUBLISHED">Gepubliceerd</option>
                </select>
              </label>
            </div>

            @if (family.publicationIssues.length) {
              <div class="readiness" role="status">
                <b>{{ family.publicationIssues.length }} punt(en) voor publicatie</b>
                <ul>
                  @for (issue of family.publicationIssues; track issue) {
                    <li>{{ issue }}</li>
                  }
                </ul>
              </div>
            } @else {
              <div class="ready">
                <span aria-hidden="true">✓</span> Website-informatie is compleet.
              </div>
            }
          </section>

          <section class="subsection" aria-labelledby="publication-identity-title">
            <div class="subsection__head">
              <div>
                <h3 id="publication-identity-title">Model &amp; URL</h3>
                <p>Stabiele identiteit van deze productfamilie.</p>
              </div>
            </div>
            <div class="form-grid">
              <label class="field">
                <span>Familiemodel</span>
                <input
                  class="input mono"
                  [ngModel]="family.familyKey"
                  (ngModelChange)="patch({ familyKey: $event })"
                  placeholder="bijv. rose-in-dome-xl"
                />
              </label>
              <label class="field">
                <span>Publieke URL</span>
                <span class="url-field">
                  <small>/products/</small>
                  <input
                    class="input mono"
                    [ngModel]="family.publicHandle"
                    (ngModelChange)="patch({ publicHandle: $event })"
                    placeholder="rose-in-dome-xl"
                  />
                </span>
              </label>
            </div>
          </section>

          <section class="subsection" aria-labelledby="publication-copy-title">
            <div class="subsection__head subsection__head--language">
              <div>
                <h3 id="publication-copy-title">Tekst voor klanten</h3>
                <p>Alleen de gekozen taal staat open.</p>
              </div>
              <label>
                <span class="sr-only">Taal van de website-informatie</span>
                <select
                  class="select select--sm"
                  [ngModel]="language()"
                  (ngModelChange)="selectLanguage($event)"
                >
                  @for (option of languages; track option.code) {
                    <option [value]="option.code">{{ option.label }}</option>
                  }
                </select>
              </label>
            </div>
            <div class="form-grid">
              <label class="field span-2">
                <span>Naam voor klanten</span>
                <input
                  class="input"
                  [ngModel]="text().name"
                  (ngModelChange)="patchText({ name: $event })"
                />
              </label>
              <label class="field span-2">
                <span>Korte samenvatting</span>
                <textarea
                  class="textarea"
                  rows="2"
                  maxlength="240"
                  [ngModel]="text().summary"
                  (ngModelChange)="patchText({ summary: $event })"
                ></textarea>
                <small class="field__hint"
                  >Voor productkaarten en de intro van de detailpagina.</small
                >
              </label>
              <label class="field span-2">
                <span>Beschrijving</span>
                <textarea
                  class="textarea"
                  rows="5"
                  [ngModel]="text().description"
                  (ngModelChange)="patchText({ description: $event })"
                ></textarea>
              </label>
              <label class="field">
                <span>Formaat</span>
                <input
                  class="input"
                  [ngModel]="text().format"
                  (ngModelChange)="patchText({ format: $event })"
                />
              </label>
              <label class="field">
                <span>Highlights</span>
                <textarea
                  class="textarea"
                  rows="3"
                  [ngModel]="highlightsText()"
                  (ngModelChange)="patchHighlights($event)"
                  placeholder="Eén voordeel per regel"
                ></textarea>
              </label>
            </div>
          </section>

          <section class="subsection" aria-labelledby="publication-merchandising-title">
            <div class="subsection__head">
              <div>
                <h3 id="publication-merchandising-title">Plaats in de shop</h3>
                <p>De categorie bepaalt automatisch de hoofdcollectie.</p>
              </div>
            </div>
            <div class="form-grid">
              <label class="field">
                <span>Categorie</span>
                <select
                  class="select"
                  [ngModel]="family.categoryId"
                  (ngModelChange)="patch({ categoryId: numberOrNull($event) })"
                >
                  <option [ngValue]="null">Geen categorie</option>
                  @for (category of categories(); track category.id) {
                    <option [ngValue]="category.id">{{ category.name }}</option>
                  }
                </select>
              </label>
              <div class="field collection-readonly">
                <span>Collecties</span>
                @if (family.collections.length) {
                  <span class="collection-membership">
                    @for (collection of family.collections; track collection.id) {
                      <small [class.collection-membership__primary]="collection.primary">
                        {{ collection.mobileName || collection.name }}
                        @if (collection.primary) { · hoofd }
                      </small>
                    }
                  </span>
                } @else {
                  <small class="collection-empty">Nog geen collectie gekoppeld</small>
                }
                <small class="field__hint">Wordt door de backend afgeleid van de categorie.</small>
              </div>
              <label class="field">
                <span>Volgorde</span>
                <input
                  class="input num"
                  type="number"
                  min="0"
                  step="1"
                  [ngModel]="family.productPosition"
                  (ngModelChange)="patch({ productPosition: +$event || 0 })"
                />
              </label>
              <label class="field">
                <span>Tags</span>
                <input
                  class="input"
                  [ngModel]="family.tags.join(', ')"
                  (ngModelChange)="patchTags($event)"
                  placeholder="gift, preserved, premium"
                />
              </label>
            </div>
          </section>

          <app-product-family-gallery
            [family]="family"
            [language]="language()"
            [currentProductId]="product().id"
            [busy]="busy()"
            (familyChange)="updateFamily($event)"
            (imageUploadRequested)="requestImageUpload($event)"
            (imageDeleteRequested)="requestImageDelete($event)"
            (imageVariantChangeRequested)="requestImageVariantChange($event)"
          />

          <section class="subsection" aria-labelledby="publication-seo-title">
            <div class="subsection__head">
              <div>
                <h3 id="publication-seo-title">Zoekresultaat</h3>
                <p>Valt terug op naam en samenvatting wanneer je dit leeg laat.</p>
              </div>
            </div>
            <div class="form-grid">
              <label class="field span-2">
                <span>SEO-titel</span>
                <input
                  class="input"
                  maxlength="70"
                  [ngModel]="text().seoTitle"
                  (ngModelChange)="patchText({ seoTitle: $event })"
                />
              </label>
              <label class="field span-2">
                <span>SEO-beschrijving</span>
                <textarea
                  class="textarea"
                  rows="3"
                  maxlength="170"
                  [ngModel]="text().seoDescription"
                  (ngModelChange)="patchText({ seoDescription: $event })"
                ></textarea>
              </label>
            </div>
          </section>

          <app-product-family-source-details [product]="product()" [family]="family" />
        } @else {
          <div class="no-family">
            <span aria-hidden="true">◇</span>
            <div>
              <b>Nog niet aan een productfamilie gekoppeld</b>
              <p>
                Koppel een bestaande familie of maak er één. Pas daarna worden websitegegevens
                gedeeld door alle kleuren.
              </p>
            </div>
          </div>
        }
      </fieldset>
    </details>
  `,
  styles: `
    :host {
      display: block;
      margin-top: 16px;
      scroll-margin-top: calc(var(--appbar-h) + 12px);
    }
    .publication__body {
      min-inline-size: 0;
      margin: 0;
      border: 0;
      padding: 14px;
    }
    .family-picker {
      display: grid;
      gap: 8px;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--line);
    }
    .family-picker .field {
      margin: 0;
    }
    .family-picker__actions { display: flex; flex-wrap: wrap; gap: 6px; }
    .family-picker__actions .btn { flex: 1 1 auto; }
    .family-impact {
      display: flex;
      gap: 10px;
      margin-top: 14px;
      padding: 11px 12px;
      border: 1px solid var(--rose-line);
      border-radius: var(--r-sm);
      background: var(--rose-soft);
    }
    .family-impact > span {
      display: grid;
      flex: 0 0 auto;
      width: 22px;
      height: 22px;
      place-items: center;
      border-radius: 50%;
      background: var(--rose);
      color: #fff;
      font-size: 11px;
      font-weight: 800;
    }
    .family-impact p {
      color: var(--ink-2);
      font-size: 11.5px;
      line-height: 1.48;
    }
    .family-members { padding: 14px 0; border-bottom: 1px solid var(--line); }
    .family-members__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
    .family-members__head h3 { font-size: 12.5px; }
    .family-members__head p { margin-top: 2px; color: var(--muted); font-size: 10px; line-height: 1.35; }
    .family-members__head > span {
      display: grid; min-width: 24px; height: 24px; padding: 0 6px; place-items: center;
      border-radius: 999px; background: var(--surface-2); color: var(--muted); font: 700 9px/1 var(--mono);
    }
    .family-members ul { display: grid; gap: 5px; margin: 9px 0 0; padding: 0; list-style: none; }
    .family-members li { min-width: 0; }
    .family-members a {
      display: grid; grid-template-columns: 24px minmax(0, 1fr) auto auto; align-items: center; gap: 8px;
      min-height: 46px; padding: 6px 9px; border: 1px solid var(--line); border-radius: 10px;
      background: var(--surface-2); color: var(--ink-2); text-decoration: none;
    }
    .family-members a:hover { border-color: var(--rose-line); background: var(--rose-soft); }
    .family-member--current a { border-color: var(--rose-line); }
    .family-member__swatch {
      width: 24px; height: 24px; border: 1px solid rgb(26 22 20 / 10%); border-radius: 50%;
      box-shadow: inset 0 0 0 2px rgb(255 255 255 / 55%);
    }
    .family-member__swatch--empty { background: linear-gradient(135deg, #fff 45%, var(--line-strong) 46% 54%, #fff 55%); }
    .family-member__copy { display: flex; flex-direction: column; min-width: 0; }
    .family-member__copy b, .family-member__copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .family-member__copy b { font-size: 10.5px; }
    .family-member__copy small { margin-top: 1px; color: var(--muted); font-size: 9px; }
    .family-member__current, .family-member__inactive {
      padding: 3px 6px; border-radius: 999px; font-size: 8.5px; font-weight: 750; white-space: nowrap;
    }
    .family-member__current { background: var(--rose-soft); color: var(--rose); }
    .family-member__inactive { background: var(--surface); color: var(--muted); }
    .family-members__empty { margin-top: 9px; padding: 10px; border-radius: 9px; background: var(--surface-2); color: var(--muted); font-size: 10px; }
    .family-card-variant { margin: 11px 0 0; }

    .subsection {
      padding: 18px 0;
      border-bottom: 1px solid var(--line);
    }
    .subsection__head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .subsection__head h3 {
      font-size: 13.5px;
      line-height: 1.25;
    }
    .subsection__head p {
      margin-top: 2px;
      color: var(--muted);
      font-size: 10.5px;
      line-height: 1.35;
    }
    .subsection__head--language {
      align-items: flex-end;
    }
    .subsection__head--language .select {
      min-width: 126px;
    }
    .form-grid {
      display: grid;
      gap: 12px;
    }
    .field {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .field > span:first-child {
      color: var(--ink-2);
      font-size: 12px;
      font-weight: 650;
    }
    .field__hint {
      color: var(--muted);
      font-size: 10.5px;
      line-height: 1.35;
    }
    .url-field {
      min-width: 0;
      display: flex;
      align-items: center;
    }
    .url-field small {
      align-self: stretch;
      display: grid;
      place-items: center;
      padding: 0 9px;
      border: 1px solid var(--line-strong);
      border-right: 0;
      border-radius: 10px 0 0 10px;
      background: var(--surface-2);
      color: var(--muted);
      font: 10px var(--mono);
    }
    .url-field .input {
      min-width: 0;
      border-radius: 0 10px 10px 0;
    }
    .switch-row {
      min-height: 58px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 15px;
      padding: 2px 0 10px;
      cursor: pointer;
    }
    .switch-row > span {
      display: flex;
      flex-direction: column;
    }
    .switch-row small {
      margin-top: 2px;
      color: var(--muted);
      font-size: 10.5px;
    }
    .switch-row input {
      flex: 0 0 auto;
      width: 23px;
      height: 23px;
      accent-color: var(--rose);
    }
    .channel-grid {
      display: grid;
      gap: 8px;
    }
    .channel-card {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 9px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: var(--r-sm);
      background: var(--surface-2);
    }
    .channel-card > span {
      display: flex;
      flex-direction: column;
    }
    .channel-card small {
      margin-top: 1px;
      color: var(--muted);
      font-size: 10px;
    }
    .readiness {
      margin-top: 10px;
      padding: 11px 12px;
      border: 1px solid #eddcb9;
      border-radius: var(--r-sm);
      background: var(--warn-soft);
      font-size: 11.5px;
    }
    .readiness ul {
      margin: 7px 0 0;
      padding-left: 18px;
      color: var(--ink-2);
    }
    .readiness li + li {
      margin-top: 3px;
    }
    .ready {
      display: flex;
      align-items: center;
      gap: 7px;
      margin-top: 10px;
      padding: 10px 12px;
      border-radius: var(--r-sm);
      background: var(--ok-soft);
      color: var(--ok);
      font-size: 11.5px;
      font-weight: 650;
    }
    .collection-readonly {
      align-self: stretch;
    }
    .collection-membership {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }
    .collection-membership small,
    .collection-empty {
      width: fit-content;
      padding: 6px 8px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--surface-2);
      color: var(--muted);
      font-size: 9.5px;
      line-height: 1;
    }
    .collection-membership__primary {
      border-color: var(--rose-line) !important;
      background: var(--rose-soft) !important;
      color: var(--rose) !important;
      font-weight: 700;
    }

    .no-family {
      display: flex;
      align-items: center;
      gap: 11px;
      padding: 15px;
      border: 1px dashed var(--line-strong);
      border-radius: var(--r-sm);
      background: var(--surface-2);
    }
    .no-family > span {
      color: var(--rose);
      font-size: 25px;
    }
    .no-family > div {
      display: flex;
      flex-direction: column;
    }
    .no-family b {
      font-size: 12px;
    }
    .no-family p {
      margin-top: 2px;
      color: var(--muted);
      font-size: 10.5px;
      line-height: 1.4;
    }


    @media (min-width: 700px) {
      .publication > summary {
        grid-template-columns: auto minmax(0, 1fr) auto auto auto;
        padding: 14px 18px;
      }
      .publication__summary-status {
        display: flex;
        gap: 12px;
      }
      .publication__summary-status + .issue-count,
      .publication__summary-status + .complete-count {
        grid-column: auto;
      }
      .publication__chevron {
        grid-column: auto;
        grid-row: auto;
      }
      .publication__body {
        padding: 18px;
      }
      .family-picker {
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: end;
      }
      .family-picker__actions .btn { flex: 0 0 auto; }
      .form-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .span-2 {
        grid-column: 1 / -1;
      }
      .channel-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .channel-card {
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
      }
      .channel-card .select {
        width: auto;
        min-width: 150px;
      }
    }
    @media (min-width: 900px) {
      .channel-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .channel-card {
        flex-direction: column;
        align-items: stretch;
      }
      .channel-card .select {
        width: 100%;
        min-width: 0;
      }
    }
  `,
})
export class ProductPublicationEditor {
  readonly product = input.required<Product>();
  readonly family = input<ProductFamily | null>(null);
  readonly families = input<ProductFamily[]>([]);
  readonly categories = input<Category[]>([]);
  readonly busy = input(false);

  readonly familyChange = output<ProductFamily>();
  readonly familyIdChange = output<number | null>();
  readonly createFamilyRequested = output<void>();
  readonly imageUploadRequested = output<File>();
  readonly imageDeleteRequested = output<number>();
  readonly imageVariantChangeRequested = output<ProductFamilyImageVariantChange>();

  readonly languages = LANGUAGES;
  readonly language = signal<LanguageCode>('EN');

  readonly text = computed<ProductFamilyText>(() => {
    const language = this.language();
    return (
      this.family()?.texts.find((item) => item.language === language) ?? this.blankText(language)
    );
  });

  readonly familyLabel = computed(() => {
    const family = this.family();
    if (!family) return 'Apart gehouden van je dagelijkse productwerk';
    return `${family.name || family.familyKey} · ${family.variantCount || 1} variant(en)`;
  });

  readonly websiteStatus = computed<PublicationStatus>(
    () => this.family()?.websiteStatus ?? this.product().websiteStatus,
  );
  readonly orderAppStatus = computed<PublicationStatus>(
    () => this.family()?.orderAppStatus ?? this.product().orderAppStatus,
  );
  readonly catalogueStatus = computed<PublicationStatus>(
    () => this.family()?.catalogueStatus ?? 'DRAFT',
  );
  readonly issueCount = computed(
    () => (this.family()?.publicationIssues ?? this.product().publicationIssues ?? []).length,
  );
  readonly highlightsText = computed(() => this.text().highlights.join('\n'));
  readonly members = computed(() => this.family()?.members ?? []);
  readonly cardFeaturedOptions = computed<FamilyFeaturedOption[]>(() => {
    const family = this.family();
    if (!family) return [];
    const selected = family.cardFeaturedProductId;
    return this.members()
      .map((member) => ({
        member,
        eligibility: featuredProductEligibility(family, member.productId, member.active),
      }))
      .filter((option) => option.eligibility.eligible || option.member.productId === selected);
  });
  readonly missingCardFeaturedProductId = computed(() => {
    const selected = this.family()?.cardFeaturedProductId ?? null;
    return selected !== null && !this.members().some((member) => member.productId === selected)
      ? selected
      : null;
  });

  memberOptionLabel(member: ProductFamily['members'][number]): string {
    const option = [member.colour || 'Geen kleur', member.size].filter(Boolean).join(' · ');
    return member.sku ? `${option} — ${member.sku}` : option;
  }

  eligibilityLabel(eligibility: FeaturedProductEligibility): string {
    if (eligibility.eligible) return '';
    return [
      eligibility.active ? null : 'inactief',
      eligibility.hasPublicImage ? null : 'geen publieke foto',
    ]
      .filter(Boolean)
      .map((reason) => ` · ${reason}`)
      .join('');
  }

  selectFamily(value: number | string | null): void {
    if (this.busy()) return;
    this.familyIdChange.emit(this.numberOrNull(value));
  }

  unlinkFamily(): void {
    if (this.busy()) return;
    this.familyIdChange.emit(null);
  }

  requestFamilyCreation(): void {
    if (this.busy()) return;
    this.createFamilyRequested.emit();
  }

  selectLanguage(language: LanguageCode): void {
    if (this.busy()) return;
    this.language.set(language);
  }

  updateFamily(family: ProductFamily): void {
    if (this.busy()) return;
    this.familyChange.emit(family);
  }

  requestImageUpload(file: File): void {
    if (this.busy()) return;
    this.imageUploadRequested.emit(file);
  }

  requestImageDelete(imageId: number): void {
    if (this.busy()) return;
    this.imageDeleteRequested.emit(imageId);
  }

  requestImageVariantChange(change: ProductFamilyImageVariantChange): void {
    if (this.busy()) return;
    this.imageVariantChangeRequested.emit(change);
  }

  patch(changes: Partial<ProductFamily>): void {
    if (this.busy()) return;
    const family = this.family();
    if (!family) return;
    this.familyChange.emit({ ...family, ...changes });
  }

  patchText(changes: Partial<ProductFamilyText>): void {
    if (this.busy()) return;
    const family = this.family();
    if (!family) return;
    const language = this.language();
    const existing =
      family.texts.find((item) => item.language === language) ?? this.blankText(language);
    const text = { ...existing, ...changes };
    const texts = family.texts.some((item) => item.language === language)
      ? family.texts.map((item) => (item.language === language ? text : item))
      : [...family.texts, text];

    this.familyChange.emit({
      ...family,
      texts,
      ...(language === 'EN'
        ? {
            name: text.name ?? '',
            summary: text.summary,
            description: text.description,
            format: text.format,
            highlights: text.highlights,
            seoTitle: text.seoTitle,
            seoDescription: text.seoDescription,
          }
        : {}),
    });
  }

  patchHighlights(value: string): void {
    this.patchText({
      highlights: value
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean),
    });
  }

  patchTags(value: string): void {
    this.patch({
      tags: [
        ...new Set(
          value
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
        ),
      ],
    });
  }

  numberOrNull(value: number | string | null): number | null {
    if (value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private blankText(language: LanguageCode): ProductFamilyText {
    return {
      language,
      name: null,
      summary: null,
      description: null,
      format: null,
      highlights: [],
      seoTitle: null,
      seoDescription: null,
    };
  }
}
