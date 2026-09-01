import { DOCUMENT } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { PushSetup, playSoundFor } from '../../core/platform/push';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { SalesApi } from '../../core/api/sales-api';
import { SourcingApi } from '../../core/api/sourcing-api';
import {
  CatalogImportResult, Category, CompanyProfile, DiscountTier, HsCode, LANGUAGES, LanguageCode,
  Product, ProductFamily, Supplier,
} from '../../core/api/models';
import { AuthImage } from '../../core/api/auth-image';
import { PageHeader } from '../../shared/page-header';
import { ProductPicker } from '../../shared/product-picker';
import { Ui } from '../../shared/ui';
import { saveBlob } from '../../core/api/download';
import { isRevisionConflict, messageOf } from '../../core/api/errors';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { THEMES, Theme } from '../../core/platform/theme';
import {
  FeaturedProductEligibility,
  familyForProduct,
  featuredProductEligibility,
  productBelongsToCategory,
} from '../../shared/product-featured-eligibility';
import { CategoryTranslationEditor } from './category-translation-editor';
import { WebsiteSyncStatus } from './website-sync-status';

interface CategoryFeaturedOption {
  product: Product;
  family: ProductFamily | null;
  eligibility: FeaturedProductEligibility;
  inCategory: boolean;
}

const CATEGORY_CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CATEGORY_TRANSLATION_FOCUS = new Set([
  'category-name',
  'category-navigation-name',
  'category-mobile-name',
  'category-footer-name',
  'category-eyebrow',
  'category-description',
]);

/** Category codes are also public URL keys, so one canonical form is used everywhere. */
const normalizeCategoryCode = (value: string): string => value
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

/** Categorieën, douanetarieven en kortingsstaffels. */
@Component({
  selector: 'app-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AuthImage,
    CategoryTranslationEditor,
    FormsModule,
    PageHeader,
    ProductPicker,
    WebsiteSyncStatus,
  ],
  template: `
    <app-page-header
      [showBack]="!websiteCategoryMode"
      [backTo]="websiteCategoryMode ? null : settingsBackTo"
      [title]="websiteCategoryMode ? 'Categorieën & websitemenu' : 'Instellingen'"
      [subtitle]="websiteCategoryMode
        ? 'Beheer collectievolgorde, uitgelicht product en menunamen per taal.'
        : 'Categorieën, tarieven en staffels'"
      [showBell]="!websiteCategoryMode"
    />

    @if (websiteCategoryMode) {
      <div class="content website-category-nav">
        <section class="category-ownership" role="note">
          <div><b>Collectiekaart en menu</b><span>De volgorde en korte namen sturen het websitemenu, mobiel menu en de footer.</span></div>
          <div><b>Uitgelicht product</b><span>De featured SKU kiest het collectiebeeld. Vaste homepage-highlights worden door hun eigen websitecomponent bepaald.</span></div>
        </section>
        @if (categoryDependencyWarning()) {
          <section class="category-dependency-warning" role="alert">
            <div><b>Uitgelichte producten niet volledig geladen</b><span>{{ categoryDependencyWarning() }}</span></div>
            <button class="btn" type="button" [disabled]="loadingSettings()" (click)="load()">Opnieuw laden</button>
          </section>
        }
      </div>
    }

    @if (!websiteCategoryMode) {
    <nav class="settings-nav" aria-label="Snel naar instelling">
      <div class="settings-nav__rail">
        @for (section of settingsSections; track section.id) {
          <button type="button" [class.active]="activeSection() === section.id"
                  [attr.aria-current]="activeSection() === section.id ? 'location' : null"
                  [attr.data-settings-section]="section.id"
                  (click)="scrollToSection(section.id)">
            {{ section.label }}
          </button>
        }
      </div>
    </nav>
    }

    <div class="content settings-content" [class.settings-content--website]="websiteCategoryMode">
      @if (settingsLoadError()) {
        <section class="settings-load-error" role="alert">
          <span aria-hidden="true">!</span>
          <div>
            <b>{{ websiteCategoryMode
              ? 'Categorieën konden niet worden geladen'
              : 'Instellingen konden niet volledig worden geladen' }}</b>
            <small>{{ settingsLoadError() }}</small>
          </div>
          <button class="btn" type="button" [disabled]="loadingSettings()" (click)="load()">
            {{ loadingSettings() ? 'Laden…' : 'Opnieuw laden' }}
          </button>
        </section>
      }
      <!-- ======================================= bedrijfsgegevens -->
      <div [class.settings-section--folded]="folded('company')" class="card settings-section" id="company">
        <div (click)="toggleSection('company', $event)" class="card__head settings-head"><h2>Onze bedrijfsgegevens</h2></div>
        <div class="card__body">
          <p class="small muted" style="margin-bottom:12px">
            Deze gegevens komen op elke offerte, factuur en catalogus. Het BTW-nummer hoort
            er wettelijk op te staan, net als je adres.
          </p>
          <p class="legend"><b>*</b> verplicht op documenten.</p>

          @if (company(); as profile) {
            <div class="form-grid">
              <div class="field">
                <label class="req" for="co-name">Handelsnaam</label>
                <input class="input" id="co-name" [ngModel]="profile.name"
                       (ngModelChange)="patchCompany({ name: $event })" />
              </div>
              <div class="field">
                <label for="co-legal">Juridische naam <span class="opt"></span></label>
                <input class="input" id="co-legal" [ngModel]="profile.legalName"
                       (ngModelChange)="patchCompany({ legalName: $event })"
                       placeholder="Enrosed BV" />
              </div>
              <div class="field">
                <label class="req" for="co-vat">BTW-nummer</label>
                <input class="input mono" id="co-vat" [ngModel]="profile.vatNumber"
                       (ngModelChange)="patchCompany({ vatNumber: $event })"
                       placeholder="BE 0123.456.789" />
              </div>
              <div class="field">
                <label for="co-reg">Ondernemingsnummer <span class="opt"></span></label>
                <input class="input mono" id="co-reg" [ngModel]="profile.registrationNumber"
                       (ngModelChange)="patchCompany({ registrationNumber: $event })" />
              </div>
              <div class="field span-2">
                <label class="req" for="co-address">Adres</label>
                <input class="input" id="co-address" [ngModel]="profile.addressLine"
                       (ngModelChange)="patchCompany({ addressLine: $event })" />
              </div>
              <div class="field">
                <label class="req" for="co-zip">Postcode</label>
                <input class="input" id="co-zip" [ngModel]="profile.postalCode"
                       (ngModelChange)="patchCompany({ postalCode: $event })" />
              </div>
              <div class="field">
                <label class="req" for="co-city">Stad</label>
                <input class="input" id="co-city" [ngModel]="profile.city"
                       (ngModelChange)="patchCompany({ city: $event })" />
              </div>
              <div class="field">
                <label class="req" for="co-country">Land (ISO)</label>
                <input class="input" id="co-country" maxlength="2" [ngModel]="profile.countryCode"
                       (ngModelChange)="patchCompany({ countryCode: $event.toUpperCase() })" />
                <span class="hint">Bepaalt mee welk BTW-regime binnenland is.</span>
              </div>
              <div class="field">
                <label for="co-email">E-mail <span class="opt"></span></label>
                <input class="input" id="co-email" type="email" [ngModel]="profile.email"
                       (ngModelChange)="patchCompany({ email: $event })" />
              </div>
              <div class="field">
                <label for="co-phone">Telefoon <span class="opt"></span></label>
                <input class="input" id="co-phone" [ngModel]="profile.phone"
                       (ngModelChange)="patchCompany({ phone: $event })" />
              </div>
              <div class="field">
                <label for="co-web">Website <span class="opt"></span></label>
                <input class="input" id="co-web" [ngModel]="profile.website"
                       (ngModelChange)="patchCompany({ website: $event })" />
              </div>
              <div class="field">
                <label for="co-iban">IBAN <span class="opt"></span></label>
                <input class="input mono" id="co-iban" [ngModel]="profile.iban"
                       (ngModelChange)="patchCompany({ iban: $event })" />
              </div>
              <div class="field">
                <label for="co-bic">BIC <span class="opt"></span></label>
                <input class="input mono" id="co-bic" [ngModel]="profile.bic"
                       (ngModelChange)="patchCompany({ bic: $event })" />
              </div>
              <div class="field span-2">
                <label for="co-foot">Voettekst op documenten (NL) <span class="opt"></span></label>
                <textarea class="textarea" id="co-foot" [ngModel]="profile.documentFooter"
                          (ngModelChange)="patchCompany({ documentFooter: $event })"
                          placeholder="Op al onze offertes zijn onze algemene voorwaarden van toepassing."></textarea>
              </div>
              @if (desktop.active()) {
                <div class="field span-2">
                  <label for="co-foot-en">Voettekst op documenten (EN) <span class="opt"></span></label>
                  <textarea class="textarea" id="co-foot-en" [ngModel]="profile.documentFooterEn"
                            (ngModelChange)="patchCompany({ documentFooterEn: $event })"
                            placeholder="All our quotations are subject to our general terms and conditions."></textarea>
                  <span class="hint">
                    Documenten in een andere taal dan Nederlands gebruiken deze; leeg = de
                    Nederlandse tekst.
                  </span>
                </div>
              }
            </div>
            <div class="span-2 mt-8">
              <div class="section-title" style="margin-top:0">Juridische teksten</div>
              <p class="small muted" style="margin-bottom:8px">
                Voorwaarden en privacyverklaring staan klaar als voorstel voor Enrosed BV —
                laat ze nakijken door je boekhouder of jurist. Klanten lezen ze op
                <a href="/voorwaarden" target="_blank" rel="noopener">/voorwaarden</a>.
                @if (desktop.active()) {
                  Documenten in een andere taal dan Nederlands verwijzen naar de
                  <b>Engelse</b> versie.
                }
                Leeg laten betekent: gebruik het ingebouwde voorstel.
              </p>
              <details style="margin-bottom:8px">
                <summary class="small strong" style="cursor:pointer">
                  Algemene voorwaarden (NL)
                </summary>
                <textarea class="textarea mt-8" rows="12" style="min-height:220px"
                          [ngModel]="profile.termsAndConditions"
                          (ngModelChange)="patchCompany({ termsAndConditions: $event })"
                          [placeholder]="'Leeg = ingebouwd voorstel'"></textarea>
              </details>
              @if (desktop.active()) {
                <details style="margin-bottom:8px">
                  <summary class="small strong" style="cursor:pointer">
                    Terms and conditions (EN)
                  </summary>
                  <textarea class="textarea mt-8" rows="12" style="min-height:220px"
                            [ngModel]="profile.termsAndConditionsEn"
                            (ngModelChange)="patchCompany({ termsAndConditionsEn: $event })"
                            [placeholder]="'Empty = built-in draft'"></textarea>
                </details>
              }
              <details style="margin-bottom:8px">
                <summary class="small strong" style="cursor:pointer">
                  Privacyverklaring (NL)
                </summary>
                <textarea class="textarea mt-8" rows="12" style="min-height:220px"
                          [ngModel]="profile.privacyPolicy"
                          (ngModelChange)="patchCompany({ privacyPolicy: $event })"
                          [placeholder]="'Leeg = ingebouwd voorstel'"></textarea>
              </details>
              @if (desktop.active()) {
                <details>
                  <summary class="small strong" style="cursor:pointer">
                    Privacy statement (EN)
                  </summary>
                  <textarea class="textarea mt-8" rows="12" style="min-height:220px"
                            [ngModel]="profile.privacyPolicyEn"
                            (ngModelChange)="patchCompany({ privacyPolicyEn: $event })"
                            [placeholder]="'Empty = built-in draft'"></textarea>
                </details>
              }
            </div>
            <button class="btn btn--primary btn--block mt-8" type="button"
                    [disabled]="savingCompany()" (click)="saveCompany()">
              {{ savingCompany() ? 'Bezig…' : 'Bedrijfsgegevens opslaan' }}
            </button>
          }
        </div>
      </div>

      <div [class.settings-section--folded]="folded('categories')" class="card settings-section category-section" id="categories">
        <div (click)="toggleSection('categories', $event)" class="card__head settings-head category-section__head">
          <div>
            <h2 id="categories-title">Productcategorieën</h2>
            <span class="category-count">
              {{ categories().length }} {{ categories().length === 1 ? 'categorie' : 'categorieën' }}
            </span>
          </div>
          <span class="spacer"></span>
          <button class="btn btn--sm btn--primary" type="button"
                  [disabled]="categoryDraft() !== null" (click)="addCategory()">
            Categorie toevoegen
          </button>
        </div>
        <div class="card__body">
          <p class="small muted category-intro">
            Deze lijst wordt overal gebruikt: in het ERP, de bestelapp en de website.
            Wijzigingen worden pas verwerkt wanneer je ze opslaat.
          </p>

          <app-website-sync-status [refreshKey]="websiteSyncRefresh()" />

          @if (categoryDraft(); as draft) {
            <section class="category-form" aria-labelledby="category-form-title">
              <div class="category-form__heading">
                <div>
                  <div class="eyebrow">{{ draft.id === null ? 'Nieuwe categorie' : 'Categorie bewerken' }}</div>
                  <h3 id="category-form-title">
                    {{ draft.id === null ? 'Voeg een categorie toe' : draft.name }}
                  </h3>
                </div>
                @if (draft.id !== null) {
                  <button class="btn btn--sm btn--danger" type="button"
                          [disabled]="savingCategory() || deletingCategoryId() === draft.id"
                          (click)="removeCategoryDraft()">
                    {{ deletingCategoryId() === draft.id ? 'Verwijderen…' : 'Verwijderen' }}
                  </button>
                }
                <button class="category-form__close" type="button" aria-label="Bewerken annuleren"
                        [disabled]="savingCategory()" (click)="cancelCategoryEdit()">
                  Sluiten
                </button>
              </div>

              <div class="category-form__grid">
                <div class="field category-form__name">
                  <label class="req" for="category-name">Naam</label>
                  <input class="input" id="category-name" autocomplete="off"
                         [ngModel]="draft.name"
                         (ngModelChange)="updateCategoryDraft({ name: $event })"
                         placeholder="Bijv. Geurkaarsen" />
                </div>
                <div class="field">
                  <label for="category-navigation-name">Korte navigatienaam (desktop) <span class="opt"></span></label>
                  <input class="input" id="category-navigation-name" maxlength="40"
                         [ngModel]="draft.navigationName"
                         (ngModelChange)="updateCategoryDraft({ navigationName: $event })"
                         placeholder="Bijv. Kaarsen" />
                  <span class="hint">Alleen gebruikt in de hoofdnavigatie van de website op desktop.</span>
                </div>
                <div class="field">
                  <label for="category-mobile-name">Korte mobiele naam <span class="opt"></span></label>
                  <input class="input" id="category-mobile-name" maxlength="40"
                         [ngModel]="draft.mobileName"
                         (ngModelChange)="updateCategoryDraft({ mobileName: $event })"
                         placeholder="Bijv. Kaarsen" />
                  <span class="hint">Alleen gebruikt waar de volledige naam niet netjes past.</span>
                </div>
                <div class="field">
                  <label for="category-footer-name">Naam in websitefooter <span class="opt"></span></label>
                  <input class="input" id="category-footer-name"
                         [ngModel]="draft.footerName"
                         (ngModelChange)="updateCategoryDraft({ footerName: $event })"
                         placeholder="Bijv. Geurkaarsen" />
                  <span class="hint">Leeg gebruikt de gewone categorienaam in de websitefooter.</span>
                </div>
                <div class="field">
                  <label for="category-eyebrow">Bovenregel website <span class="opt"></span></label>
                  <input class="input" id="category-eyebrow"
                         [ngModel]="draft.eyebrow"
                         (ngModelChange)="updateCategoryDraft({ eyebrow: $event })"
                         placeholder="Bijv. Onze signatuur" />
                  <span class="hint">
                    Korte tekst boven de categorietitel op de website; leeg betekent geen bovenregel.
                  </span>
                </div>
                <div class="field">
                  <label class="req" for="category-code">Vaste URL-code</label>
                  <input class="input mono" id="category-code" autocomplete="off"
                         [ngModel]="draft.code"
                         [readOnly]="draft.id !== null"
                         (ngModelChange)="updateCategoryDraft({ code: $event })"
                         (blur)="normalizeCategoryDraftCode()"
                         autocapitalize="none" spellcheck="false"
                         placeholder="display-roses" />
                  <span class="hint">
                    @if (draft.id === null) {
                      Kies deze permanente sleutel één keer bij het aanmaken. De categorietitel en vertalingen kunnen later wel veranderen.
                    } @else {
                      Permanent na aanmaak: deze sleutel houdt collectie- en menulinks stabiel. Voor een URL-migratie is een aparte redirect nodig.
                    }
                  </span>
                </div>
                <div class="field">
                  <label for="category-position">Volgorde</label>
                  <input class="input num" id="category-position" type="number" min="0" step="1"
                         [ngModel]="draft.position"
                         (ngModelChange)="updateCategoryDraft({ position: +$event })" />
                  <span class="hint">Lager nummer verschijnt eerst.</span>
                </div>
                <div class="field">
                  <label for="category-featured-product">Uitgelicht product <span class="opt"></span></label>
                  <select class="select" id="category-featured-product"
                          [ngModel]="draft.featuredProductId ?? null"
                          [disabled]="draft.id === null || !!categoryDependencyWarning()"
                          (ngModelChange)="updateCategoryDraft({ featuredProductId: numberOrNull($event) })">
                    <option [ngValue]="null">Automatisch</option>
                    @for (option of categoryFeaturedOptions(draft); track option.product.id) {
                      <option [ngValue]="option.product.id" [disabled]="!categoryOptionEligible(option)">
                        {{ productOptionLabel(option.product) }}{{ categoryEligibilityLabel(option) }}
                      </option>
                    }
                    @if (categoryDependencyWarning() && draft.featuredProductId !== null) {
                      <option [ngValue]="draft.featuredProductId" disabled>
                        Huidige keuze #{{ draft.featuredProductId }} · productgegevens niet geladen
                      </option>
                    } @else if (missingFeaturedProductId(draft) !== null) {
                      <option [ngValue]="missingFeaturedProductId(draft)" disabled>
                        SKU #{{ missingFeaturedProductId(draft) }} · geen publieke foto
                      </option>
                    }
                  </select>
                  <span class="hint">
                    @if (draft.id === null) {
                      Sla de categorie eerst op en koppel daarna producten.
                    } @else if (categoryDependencyWarning()) {
                      Laad de productgegevens opnieuw voordat u de featured SKU wijzigt.
                    } @else {
                      Actieve SKU die deze collectie visueel vertegenwoordigt.
                    }
                  </span>
                </div>
                <div class="field category-form__description">
                  <label for="category-description">Beschrijving <span class="opt"></span></label>
                  <textarea class="textarea" id="category-description" rows="3"
                            [ngModel]="draft.description"
                            (ngModelChange)="updateCategoryDraft({ description: $event })"
                            placeholder="Korte omschrijving voor catalogus, bestelapp en website…"></textarea>
                </div>

                <app-category-translation-editor
                  [category]="draft"
                  [busy]="savingCategory()"
                  [saveError]="categorySaveError()"
                  [initialLanguage]="categoryDeepLinkLanguage"
                  [focusField]="categoryDeepLinkFocus"
                  (categoryChange)="updateCategoryTranslations($event)"
                />
              </div>

              @if (categoryCodeExists(draft)) {
                <p class="category-form__error" role="alert">
                  Deze code bestaat al. Kies een unieke code.
                </p>
              } @else if (draft.code.trim() && !categoryCodeValid(draft)) {
                <p class="category-form__error" role="alert">
                  Vul minstens één letter of cijfer in voor de publieke URL-code.
                </p>
              }

              @if (categoryConflict()) {
                <div class="category-conflict" role="alert">
                  <span><b>Nieuwere categorieversie beschikbaar.</b> Je lokale invoer is niet overschreven.</span>
                  <div class="category-conflict__actions">
                    <button class="btn btn--sm" type="button" [disabled]="savingCategory()"
                            (click)="cancelCategoryEdit()">Formulier sluiten</button>
                    <button class="btn btn--sm btn--primary" type="button" [disabled]="savingCategory()"
                            (click)="reloadConflictedCategory()">Laatste versie laden</button>
                  </div>
                </div>
              } @else if (categorySaveError()) {
                <div class="category-conflict" role="alert">
                  <span><b>Categorie is nog niet opgeslagen.</b> {{ categorySaveError() }}</span>
                  <button class="btn btn--sm btn--primary" type="button"
                          [disabled]="savingCategory() || !categoryDraftValid()"
                          (click)="saveCategory()">Opnieuw opslaan</button>
                </div>
              }

              <div class="category-form__actions">
                <button class="btn" type="button" [disabled]="savingCategory()"
                        (click)="cancelCategoryEdit()">Annuleren</button>
                <button class="btn btn--primary" type="button"
                        [disabled]="!categoryDraftValid() || savingCategory() || categoryConflict()"
                        (click)="saveCategory()">
                  {{ savingCategory() ? 'Opslaan…' : (draft.id === null ? 'Categorie toevoegen' : 'Wijzigingen opslaan') }}
                </button>
              </div>
            </section>
          }

          @if (categories().length) {
            <div class="category-list" role="list" aria-labelledby="categories-title">
              @for (category of categories(); track category.id) {
                <article class="category-item" role="listitem"
                         [class.category-item--editing]="categoryDraft()?.id === category.id">
                  <div class="category-item__body">
                    <div class="category-item__title-row">
                      <h3>{{ category.name }}</h3>
                      <span class="badge badge--neutral mono">{{ category.code }}</span>
                    </div>
                    @if (category.description) {
                      <p>{{ category.description }}</p>
                    } @else {
                      <p class="category-item__empty">Nog geen beschrijving</p>
                    }
                    <span class="category-item__position">
                      Volgorde {{ category.position }}
                      @if (category.navigationName) { · desktop „{{ category.navigationName }}” }
                      @if (category.footerName) { · footer „{{ category.footerName }}” }
                      @if (category.mobileName) { · mobiel „{{ category.mobileName }}” }
                      @if (category.eyebrow) { · bovenregel „{{ category.eyebrow }}” }
                      @if (category.featuredProductId) {
                        · uitgelicht {{ featuredProductLabel(category.featuredProductId) }}
                      }
                    </span>
                  </div>
                  <div class="category-item__actions">
                    <!-- The order here is the order everywhere: catalogue,
                         stock, order app and website. -->
                    <span class="category-order" role="group" [attr.aria-label]="'Volgorde van ' + category.name">
                      <button class="category-order__btn" type="button" title="Omhoog"
                              [disabled]="reordering() || $index === 0"
                              [attr.aria-label]="category.name + ' omhoog'"
                              (click)="moveCategory(category.id!, -1)">↑</button>
                      <button class="category-order__btn" type="button" title="Omlaag"
                              [disabled]="reordering() || $index === categories().length - 1"
                              [attr.aria-label]="category.name + ' omlaag'"
                              (click)="moveCategory(category.id!, 1)">↓</button>
                    </span>
                    <button class="btn btn--sm" type="button"
                            [disabled]="categoryDraft() !== null || deletingCategoryId() === category.id"
                            (click)="editCategory(category)">Bewerken</button>
                  </div>
                </article>
              }
            </div>
          } @else {
            <div class="empty category-empty">
              <div class="empty__title">Nog geen productcategorieën</div>
              <p class="empty__text">Voeg de eerste categorie toe om producten eenduidig in te delen.</p>
              <button class="btn btn--primary" type="button" (click)="addCategory()">
                Eerste categorie toevoegen
              </button>
            </div>
          }
        </div>
      </div>

      <!-- ======================================= douanetarieven -->
      <div [class.settings-section--folded]="folded('duties')" class="card settings-section" id="duties">
        <div (click)="toggleSection('duties', $event)" class="card__head settings-head"><h2>Douanetarieven</h2><span class="spacer"></span>
          <button class="btn btn--sm" type="button" (click)="addHsCode()">+</button></div>
        <div class="card__body">
          <div class="alert alert--warn" style="margin-bottom:14px">
            <span class="alert__icon">!</span>
            <div>
              Kijk deze percentages na in de <b>TARIC-databank</b> van de EU. Wat hier staat is
              configuratie, geen douaneadvies.
            </div>
          </div>
          @for (code of hsCodes(); track code.code) {
            <div style="border:1px solid var(--line);border-radius:var(--r-sm);
                        padding:10px 12px;margin-bottom:10px">
              <div class="row" style="margin-bottom:8px">
                <input class="input input--sm mono" style="max-width:140px" aria-label="HS-code"
                       [ngModel]="code.code" (ngModelChange)="code.code = $event" />
                <input class="input input--sm num right" style="max-width:80px" type="text"
                       inputmode="decimal" aria-label="Invoerrecht"
                       [value]="pctText(code.dutyRatePct)"
                       (change)="code.dutyRatePct = pctValue($any($event.target).value)" />
                <span class="small muted">%</span>
                <button class="btn btn--sm" type="button" (click)="saveHsCode(code)">✓</button>
                <button class="btn btn--sm btn--danger" type="button"
                        (click)="removeHsCode(code)">✕</button>
              </div>
              <input class="input input--sm" aria-label="Omschrijving" placeholder="Omschrijving"
                     [ngModel]="code.description" (ngModelChange)="code.description = $event" />
            </div>
          }
          <p class="small muted">
            Het invoerrecht geldt over de <b>douanewaarde</b>: goederen + lokale kosten China +
            zeevracht. De kosten vanaf de aankomsthaven vallen erbuiten.
          </p>
        </div>
      </div>

      <!-- ======================================= productspecifieke lijnkorting -->
      <div class="card settings-section discount-section"
           [class.settings-section--folded]="folded('discounts')" id="discounts">
        <div (click)="toggleSection('discounts', $event)" class="card__head settings-head">
          <div>
            <h2>Lijnkorting — per product</h2>
            <span class="discount-section__count">
              {{ lineDiscountGroups().length }} product{{ lineDiscountGroups().length === 1 ? '' : 'en' }} ingesteld
            </span>
          </div>
          <span class="spacer"></span>
          <button class="btn btn--sm" type="button"
                  [disabled]="!discountPickerProducts().length"
                  (click)="lineDiscountPicker.set(true)">+ Product</button>
        </div>
        <div class="card__body">
          <p class="discount-intro">
            Iedere productvariant krijgt zijn eigen staffel. Een grens voor bijvoorbeeld rood
            verandert dus niets aan blauw of aan een ander product.
          </p>

          @if (legacyLineTiers().length) {
            <div class="discount-legacy" role="status">
              <div><b>Oude algemene lijnkorting staat uit</b><span>Deze {{ legacyLineTiers().length }} oude regel{{ legacyLineTiers().length === 1 ? '' : 's' }} wordt niet meer op alle producten toegepast.</span></div>
              <button class="btn btn--sm" type="button" (click)="removeLegacyLineTiers()">Opruimen</button>
            </div>
          }

          <div class="discount-product-list">
            @for (group of lineDiscountGroups(); track group.productId) {
              <article class="discount-product" [id]="'line-discount-' + group.productId">
                <header class="discount-product__head">
                  @if (group.product?.photos?.length) {
                    <img class="discount-product__photo"
                         [appAuthSrc]="group.product!.photos[0].url"
                         [alt]="group.product!.name" />
                  } @else {
                    <span class="discount-product__photo discount-product__photo--empty" aria-hidden="true">◈</span>
                  }
                  <div class="discount-product__identity">
                    <h3>{{ group.product?.name || 'Verwijderd product #' + group.productId }}</h3>
                    <span>
                      @if (group.product?.colour) { {{ group.product!.colour }} · }
                      @if (group.product?.variantSize) { {{ group.product!.variantSize }} · }
                      {{ group.product?.sku || 'Onbekende SKU' }}
                    </span>
                    @if (group.product && supplierName(group.product); as supplier) {
                      <small>{{ supplier }}</small>
                    }
                  </div>
                  <button class="discount-product__remove" type="button"
                          [attr.aria-label]="'Lijnkorting voor ' + (group.product?.name || group.productId) + ' verwijderen'"
                          (click)="removeLineDiscountProduct(group.productId, group.product?.name)">×</button>
                </header>

                <div class="discount-tiers" [attr.aria-label]="'Staffel voor ' + (group.product?.name || group.productId)">
                  @for (tier of group.tiers; track tier.id ?? $index) {
                    <div class="discount-tier">
                      <label>
                        <span>Vanaf</span>
                        <input class="input input--sm num right" type="number" min="1" step="1"
                               [attr.aria-label]="'Vanaf aantal voor ' + (group.product?.name || group.productId)"
                               [ngModel]="tier.minQuantity"
                               (ngModelChange)="updateLineTier(tier, { minQuantity: +$event })" />
                        <small>stuks</small>
                      </label>
                      <span class="discount-tier__arrow" aria-hidden="true">→</span>
                      <label>
                        <span>Korting</span>
                        <input class="input input--sm num right" type="text" inputmode="decimal"
                               [attr.aria-label]="'Kortingspercentage voor ' + (group.product?.name || group.productId)"
                               [value]="pctText(tier.percent)"
                               (change)="updateLineTier(tier, { percent: pctValue($any($event.target).value) })" />
                        <small>%</small>
                      </label>
                      <button class="discount-tier__remove" type="button" aria-label="Drempel verwijderen"
                              (click)="removeLineTier(tier)">×</button>
                    </div>
                  }
                </div>

                <footer class="discount-product__actions">
                  <button class="btn btn--sm" type="button" (click)="addLineTier(group.productId)">+ Drempel</button>
                  <button class="btn btn--sm btn--primary" type="button"
                          [disabled]="savingLineProductId() !== null || !group.tiers.length"
                          (click)="saveLineProductTiers(group.productId)">
                    {{ savingLineProductId() === group.productId ? 'Opslaan…' : 'Staffel opslaan' }}
                  </button>
                </footer>
              </article>
            } @empty {
              <div class="discount-empty">
                <b>Nog geen productspecifieke korting</b>
                <span>Kies een product en voeg alleen daarvoor de juiste staffel toe.</span>
                <button class="btn btn--primary" type="button"
                        [disabled]="!discountPickerProducts().length"
                        (click)="lineDiscountPicker.set(true)">Product kiezen</button>
              </div>
            }
          </div>
        </div>
      </div>

      <!-- ======================================= orderkorting -->
      <div class="card settings-section" [class.settings-section--folded]="folded('order-discounts')"
           id="order-discounts">
        <div (click)="toggleSection('order-discounts', $event)" class="card__head settings-head">
          <h2>Orderkorting — totaal order</h2><span class="spacer"></span>
          <button class="btn btn--sm" type="button" (click)="addTier('ORDER')">+</button>
        </div>
        <div class="card__body">
          <p class="small muted" style="margin:0 0 12px">
            Korting op de hele order zodra het totale aantal stuks van alle producten samen een grens haalt.
          </p>
          @if (!orderTiers().length) {
            <p class="small muted">Nog geen staffel. Druk op + om een eerste grens toe te voegen.</p>
          }
          @for (tier of orderTiers(); track tier.id ?? $index; let tierIndex = $index) {
            <div class="row" style="margin-bottom:8px">
              <span class="small muted" style="width:52px">vanaf</span>
              <input class="input input--sm num right" type="number" step="50"
                     aria-label="Vanaf aantal" [ngModel]="tier.minQuantity"
                     (ngModelChange)="updateOrderTier(tierIndex, { minQuantity: +$event })" />
              <span class="small muted">st →</span>
              <input class="input input--sm num right" type="text" inputmode="decimal"
                     aria-label="Percentage" [value]="pctText(tier.percent)"
                     (change)="updateOrderTier(tierIndex, { percent: pctValue($any($event.target).value) })" />
              <span class="small muted">%</span>
              <button class="btn btn--sm btn--danger" type="button"
                      (click)="removeTier('ORDER', tierIndex)">✕</button>
            </div>
          }
          @if (orderTiers().length) {
            <button class="btn btn--sm btn--primary mt-8" type="button"
                    (click)="saveTiers('ORDER')">Staffel opslaan</button>
          }
        </div>
      </div>
      <!-- ======================================= catalogus in Excel -->
      <div [class.settings-section--folded]="folded('catalog-data')" class="card settings-section workbook-card" id="catalog-data">
        <div (click)="toggleSection('catalog-data', $event)" class="card__head settings-head workbook-card__head">
          <div><span class="workbook-badge" aria-hidden="true">XLSX</span><h2>Producten in Excel (importeren / exporteren)</h2></div>
        </div>
        <div class="card__body">
          <p class="workbook-intro">
            Bewerk productteksten, maten, barcodes, prijzen en publicatie in één duidelijk
            Excel-bestand. Kolomfilters, vaste kopregels en dropdowns staan al voor je klaar.
            @if (desktop.active()) {
              Ook vertalingen staan in dezelfde export.
            }
          </p>

          <ol class="workbook-steps" aria-label="Werkwijze Excel-import">
            <li><span>1</span><div><b>Download</b><small>Begin altijd met de nieuwste export.</small></div></li>
            <li><span>2</span><div><b>Bewerk</b><small>
              Producten staan op duidelijke tabbladen.@if (desktop.active()) { Vertalingen staan apart. }
            </small></div></li>
            <li><span>3</span><div><b>Importeer</b><small>Problemen worden per rij gemeld; onbekende SKU's worden niet aangemaakt.</small></div></li>
          </ol>

          <div class="workbook-safety">
            <b>SKU niet wijzigen.</b>
            <span>
              De SKU koppelt elke rij aan het juiste product. Categorie, leverancier,
              voorraad, extra eenheidskosten en landed cost beheer je in het ERP, niet in Excel.
            </span>
          </div>

          <div class="workbook-actions">
            <button class="btn btn--primary" type="button" [disabled]="exportingWorkbook()"
                    (click)="exportWorkbook()">
              {{ exportingWorkbook() ? 'Excel maken…' : 'Excel downloaden' }}
            </button>
            <button class="btn" type="button" [disabled]="importingWorkbook()"
                    (click)="workbookFile.click()">Excel importeren…</button>
            <input #workbookFile type="file"
                   accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                   hidden (change)="selectWorkbook($any($event.target))" />
          </div>

          @if (selectedWorkbook(); as file) {
            <div class="workbook-selection">
              <div class="workbook-selection__file">
                <span class="workbook-file-icon" aria-hidden="true">X</span>
                <div><b>{{ file.name }}</b><small>{{ fileSize(file.size) }}</small></div>
              </div>
              <div class="workbook-selection__actions">
                <button class="btn btn--sm" type="button" [disabled]="importingWorkbook()"
                        (click)="clearWorkbookSelection()">Annuleren</button>
                <button class="btn btn--sm btn--primary" type="button"
                        [disabled]="importingWorkbook()" (click)="importWorkbook()">
                  {{ importingWorkbook() ? 'Controleren en importeren…' : 'Controleren en importeren' }}
                </button>
              </div>
            </div>
          }

          @if (workbookResult(); as result) {
            <div class="alert workbook-result" aria-live="polite"
                 [class.alert--ok]="!result.problems.length"
                 [class.alert--warn]="result.problems.length > 0">
              <span class="alert__icon">{{ result.problems.length ? '!' : '✓' }}</span>
              <div>
                <b>{{ result.problems.length ? 'Import afgerond met aandachtspunten' : 'Excel succesvol geïmporteerd' }}</b>
                <div class="small workbook-result__summary">
                  {{ result.updatedProducts }} productregels verwerkt ·
                  {{ result.updatedRows }} vertaalregels bijgewerkt
                </div>
                @if (result.problems.length) {
                  <details class="workbook-problems">
                    <summary>{{ result.problems.length }} {{ result.problems.length === 1 ? 'melding' : 'meldingen' }} bekijken</summary>
                    <ul>
                      @for (problem of result.problems; track $index) { <li>{{ problem }}</li> }
                    </ul>
                  </details>
                }
              </div>
            </div>
          }
        </div>
      </div>

      <!-- ======================================= categorieen -->

      <!-- ======================================= weergave -->
      <!-- ============== app on this device: looks and notifications -->
      <p class="app-settings-kicker">App op dit toestel</p>
      <div [class.settings-section--folded]="folded('appearance')" class="card settings-section" id="appearance">
        <div (click)="toggleSection('appearance', $event)" class="card__head settings-head"><h2>Weergave</h2></div>
        <div class="card__body">
          <p class="small muted" style="margin-bottom:12px">De accentkleur van de app: knoppen, actieve menu-items en markeringen. Geldt op dit toestel.</p>
          <div class="theme-picker" role="radiogroup" aria-label="Kleurschema">
            @for (option of themes; track option.key) {
              <button class="theme-picker__option" type="button" role="radio"
                      [class.theme-picker__option--active]="theme.current() === option.key"
                      [attr.aria-checked]="theme.current() === option.key"
                      (click)="theme.set(option.key)">
                <i class="theme-picker__swatch" [style.background]="option.swatch" aria-hidden="true"></i>
                <span>{{ option.label }}</span>
              </button>
            }
          </div>
        </div>
      </div>

      <!-- ======================================= meldingen op dit toestel -->
      <div [class.settings-section--folded]="folded('notifications')" class="card settings-section" id="notifications">
        <div (click)="toggleSection('notifications', $event)" class="card__head settings-head"><h2>Meldingen op dit toestel</h2></div>
        <div class="card__body">
          <p class="small muted" style="margin-bottom:12px">
            Een melding bij elke nieuwe offerte of factuur (mét kassageluid), inkooporder,
            product en agendapunt — en elke ochtend om 9u wat er die dag gepland staat.
            Op iPhone werkt dit zodra de app op het beginscherm staat.
          </p>
          @if (!push.supported()) {
            <p class="small warn-text">Deze browser ondersteunt geen meldingen.</p>
          } @else if (push.enabled()) {
            <div class="push-actions">
              <span class="badge badge--ok">Meldingen staan aan op dit toestel</span>
              <button class="btn btn--sm" type="button" [disabled]="push.busy()"
                      (click)="testPush()">Stuur testmelding</button>
              <button class="btn btn--sm" type="button" [disabled]="push.busy()"
                      (click)="disablePush()">Uitzetten</button>
            </div>
            @if (pushDevices().length) {
              <div class="push-devices">
                @for (device of pushDevices(); track device.id) {
                  <div class="push-device">
                    <b>{{ device.device }}</b>
                    <span>
                      @if (device.lastStatus === null) { nog geen melding gestuurd }
                      @else if (device.lastStatus >= 200 && device.lastStatus < 300) {
                        laatste melding afgeleverd ✓
                      } @else { laatste melding geweigerd ({{ device.lastStatus }}) }
                    </span>
                  </div>
                }
              </div>
            }
          } @else {
            <button class="btn btn--primary" type="button" [disabled]="push.busy()"
                    (click)="enablePush()">
              {{ push.busy() ? 'Bezig…' : 'Meldingen aanzetten op dit toestel' }}
            </button>
          }
          @if (pushActionError()) {
            <div class="push-error" role="alert">
              <div><b>Meldingsactie mislukt</b><small>{{ pushActionError() }}</small></div>
              <button class="btn btn--sm" type="button" [disabled]="push.busy()"
                      (click)="retryPushAction()">Opnieuw proberen</button>
            </div>
          }
          <div class="push-sounds">
            <button class="btn btn--sm" type="button" (click)="previewSound('sale-quote')">
              🔔 Geluid nieuwe offerte
            </button>
            <button class="btn btn--sm" type="button" (click)="previewSound('sale-invoice')">
              💰 Geluid nieuwe factuur
            </button>
          </div>
        </div>
      </div>

    </div>

    @if (lineDiscountPicker()) {
      <app-product-picker
        heading="Product voor lijnkorting kiezen"
        [products]="discountPickerProducts()"
        [categories]="categories()"
        [families]="families()"
        [groupByFamily]="true"
        [preserveSourceOrder]="true"
        [selectionOnly]="true"
        [showPrice]="false"
        [stockAware]="false"
        [supplierNameOf]="discountSupplierNameOf"
        (picked)="chooseDiscountProduct($event.product)"
        (cancelled)="lineDiscountPicker.set(false)"
      />
    }
  `,
  styles: `
    .website-category-nav { max-width: 1540px; padding-bottom: 0; }
    .category-ownership {
      display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px;
      margin-bottom: 14px; padding: 14px; border: 1px solid var(--rose-line);
      border-radius: var(--r); background: var(--rose-soft);
    }
    .category-ownership > div { display: grid; gap: 3px; }
    .category-ownership b { color: var(--rose-dark); font-size: 15px; }
    .category-ownership span { color: var(--muted); font-size: 14px; line-height: 1.45; }
    .category-dependency-warning { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 14px; padding: 12px 14px; border: 1px solid var(--warn); border-radius: var(--r-sm); background: var(--warn-soft); }
    .category-dependency-warning > div { display: grid; gap: 3px; }
    .category-dependency-warning b { color: var(--ink-2); font-size: 14px; }
    .category-dependency-warning span { color: var(--muted); font-size: 13px; line-height: 1.4; }
    .category-dependency-warning .btn { min-height: 48px; }
    .settings-content--website { max-width: 1540px; padding-top: 0; }
    .settings-content--website > .settings-section:not(.category-section) { display: none; }
    .settings-content--website > .app-settings-kicker { display: none; }
    .settings-nav {
      position: sticky; top: var(--appbar-h); z-index: 50;
      width: 100%; margin: 0; border-bottom: 1px solid var(--line);
      background: var(--surface);
    }
    .settings-nav__rail {
      display: flex; gap: 3px; width: 100%; max-width: 1400px; margin: 0 auto;
      padding: 6px 12px; overflow-x: auto; overscroll-behavior-x: contain;
      scrollbar-width: none;
    }
    .settings-load-error {
      display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px;
      margin-bottom: 14px; padding: 14px; border: 1px solid var(--danger); border-radius: var(--r-sm);
      background: var(--danger-soft); color: var(--danger);
    }
    .settings-load-error > span { display: grid; width: 38px; height: 38px; place-items: center;
      border-radius: 50%; background: var(--surface); font-size: 18px; font-weight: 800; }
    .settings-load-error > div { display: grid; gap: 3px; min-width: 0; }
    .settings-load-error b { font-size: 15px; }
    .settings-load-error small { color: var(--muted); font-size: 14px; line-height: 1.45; }
    .settings-load-error .btn { min-height: 48px; }
    .settings-nav__rail::-webkit-scrollbar { display: none; }
    @media (max-width: 679px) {
      .settings-nav__rail { padding-right: 36px; mask-image: linear-gradient(to right, #000 calc(100% - 40px), transparent);
        -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 40px), transparent); }
    }
    .settings-nav button {
      flex: 0 0 auto; display: inline-flex; align-items: center; min-height: 40px;
      padding: 0 11px; border: 0; border-radius: 8px; background: transparent;
      color: var(--muted); font: inherit; font-size: 12px; font-weight: 650;
      cursor: pointer; text-decoration: none; transition: color .16s, background .16s;
    }
    .settings-nav button:hover { color: var(--ink-2); background: var(--surface-2); }
    .settings-nav button.active { background: var(--rose-soft); color: var(--rose-dark); }
    .settings-nav button:focus-visible { outline: 2px solid var(--rose); outline-offset: -2px; }
    .settings-content { padding-top: 12px; }
    .settings-section { scroll-margin-top: 109px; }
    .workbook-card { overflow: hidden; }
    /* Phone: the settings page reads as a grouped list - one section open,
       the rest a row with a chevron, the way iOS keeps a long settings
       screen short. On desktop everything stays open. */
    @media (max-width: 679px) {
      .settings-head { cursor: pointer; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
      .settings-head::after { content: ''; width: 8px; height: 8px; margin-left: auto; flex: none;
        border-right: 1.8px solid var(--muted); border-bottom: 1.8px solid var(--muted);
        transform: rotate(45deg); transition: transform .15s ease; }
      .settings-head .spacer { display: none; }
      .settings-section--folded .settings-head::after { transform: rotate(-45deg); }
      .settings-section--folded .card__body { display: none; }
      .settings-section--folded .settings-head .btn { display: none; }
      .settings-section + .settings-section { margin-top: 10px; }
    }
    .theme-picker { display: flex; flex-wrap: wrap; gap: 8px; }
    .theme-picker__option { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 14px 0 10px;
      border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--ink-2);
      font: inherit; font-size: 13px; font-weight: 650; cursor: pointer; }
    .theme-picker__option:hover { background: var(--surface-2); }
    .theme-picker__option--active { border-color: var(--rose); background: var(--rose-soft); color: var(--rose-dark); box-shadow: inset 0 0 0 1px var(--rose); }
    .theme-picker__swatch { width: 18px; height: 18px; border-radius: 50%; border: 1px solid rgb(0 0 0 / 12%); }
    .workbook-card__head { background: linear-gradient(135deg, #effbf7, #fff); }
    .workbook-card__head > div { display: flex; align-items: center; gap: 9px; }
    .workbook-badge { padding: 4px 7px; border-radius: 5px; background: #16845b; color: #fff;
      font-size: 9px; font-weight: 800; letter-spacing: .08em; }
    .workbook-intro { margin-bottom: 14px; color: var(--ink-2); font-size: 13px; line-height: 1.55; }
    .workbook-steps { display: grid; gap: 8px; margin: 0 0 12px; padding: 0; list-style: none; }
    .workbook-steps li { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 10px;
      border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface-2); }
    .workbook-steps li > span { display: grid; flex: 0 0 28px; width: 28px; height: 28px;
      place-items: center; border-radius: 50%; background: #dff5ec; color: #126645; font-weight: 750; }
    .workbook-steps li div { min-width: 0; }
    .workbook-steps b, .workbook-steps small { display: block; }
    .workbook-steps b { font-size: 12.5px; }
    .workbook-steps small { margin-top: 2px; color: var(--muted); font-size: 11.5px; line-height: 1.35; }
    .workbook-safety { display: grid; gap: 2px; margin-bottom: 14px; padding: 11px 12px;
      border-left: 3px solid #16845b; border-radius: 0 var(--r-sm) var(--r-sm) 0; background: #effbf7;
      color: var(--ink-2); font-size: 11.5px; line-height: 1.45; }
    .workbook-safety b { color: #126645; font-size: 12px; }
    .workbook-actions { display: grid; gap: 8px; }
    .workbook-actions .btn { width: 100%; }
    .workbook-selection { display: grid; gap: 12px; margin-top: 12px; padding: 12px;
      border: 1px solid #9edbc5; border-radius: var(--r-sm); background: #f6fcfa; }
    .workbook-selection__file { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .workbook-selection__file div { min-width: 0; }
    .workbook-selection__file b { display: block; overflow: hidden; font-size: 12.5px;
      text-overflow: ellipsis; white-space: nowrap; }
    .workbook-selection__file small { display: block; margin-top: 2px; color: var(--muted); }
    .workbook-file-icon { display: grid; flex: 0 0 34px; width: 34px; height: 34px; place-items: center;
      border-radius: 8px; background: #16845b; color: #fff; font-weight: 800; }
    .workbook-selection__actions { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 7px; }
    .workbook-result { margin-top: 12px; }
    .workbook-result__summary { margin-top: 3px; }
    .workbook-problems { margin-top: 8px; }
    .workbook-problems summary { cursor: pointer; font-size: 12px; font-weight: 650; }
    .workbook-problems ul { display: grid; gap: 4px; margin: 7px 0 0; padding-left: 18px;
      font-size: 11.5px; line-height: 1.4; }
    .category-section__head > div:first-child { min-width: 0; }
    .category-count { display: block; margin-top: 2px; color: var(--muted); font-size: 11.5px; }
    .category-intro { margin-bottom: 14px; line-height: 1.5; }
    .category-form { margin-bottom: 14px; padding: 14px; border: 1px solid var(--rose-line);
      border-radius: var(--r); background: linear-gradient(145deg, var(--rose-soft), #fff 70%); }
    .category-form__heading { display: flex; align-items: flex-start; justify-content: space-between;
      gap: 12px; margin-bottom: 14px; }
    .category-form__heading h3 { margin-top: 2px; font-size: 16px; }
    .eyebrow { color: var(--rose-dark); font-size: 10.5px; font-weight: 750;
      letter-spacing: .09em; text-transform: uppercase; }
    .category-form__close { min-height: 36px; padding: 0 4px; border: 0; background: transparent;
      color: var(--muted); font-size: 12px; font-weight: 650; cursor: pointer; }
    .category-form__grid { display: grid; gap: 12px; }
    #category-code[readonly] { background: var(--surface-2); color: var(--muted); cursor: not-allowed; }
    .category-form__description { grid-column: 1 / -1; }
    .category-form__error { margin-top: 10px; color: var(--danger); font-size: 12.5px; font-weight: 600; }
    .category-conflict {
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px;
      margin-top: 10px; padding: 10px 12px; border: 1px solid var(--danger); border-radius: 10px;
      color: var(--danger); background: var(--danger-soft); font-size: 14px; font-weight: 600;
    }
    .category-conflict > span { min-width: 0; line-height: 1.45; }
    .category-conflict__actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .category-form__actions { display: grid; grid-template-columns: 1fr; gap: 8px; margin-top: 14px; }
    .category-form__actions .btn { width: 100%; }
    .category-order { display: inline-flex; gap: 4px; margin-right: 4px; }
    .category-order__btn { display: inline-grid; place-items: center; width: 30px; height: 30px;
      border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink-2);
      font: inherit; font-size: 14px; cursor: pointer; }
    .category-order__btn:hover:not(:disabled) { background: var(--surface-2); }
    .category-order__btn:disabled { opacity: .35; cursor: default; }
    .category-list { overflow: hidden; border: 1px solid var(--line); border-radius: var(--r-sm); }
    .category-item { display: grid; gap: 12px; padding: 14px; border-bottom: 1px solid var(--line);
      background: var(--surface); }
    .category-item:last-child { border-bottom: 0; }
    .category-item--editing { background: var(--rose-soft); }
    .category-item__body { min-width: 0; }
    .category-item__title-row { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; }
    .category-item__title-row h3 { min-width: 0; font-size: 14.5px; }
    .category-item__body p { margin-top: 5px; color: var(--ink-2); font-size: 12.5px; line-height: 1.45; }
    .category-item__body .category-item__empty { color: var(--muted-2); font-style: italic; }
    .category-item__position { display: block; margin-top: 7px; color: var(--muted); font-size: 11px; }
    .category-item__actions { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
    .category-item__actions .btn { width: 100%; }
    .category-empty { padding-block: 30px; }
    @media (max-width: 520px) {
      .website-category-nav { padding-inline: 12px; }
      .category-ownership { grid-template-columns: 1fr; }
      .category-dependency-warning { align-items: stretch; flex-direction: column; }
      .category-dependency-warning .btn { width: 100%; }
      .settings-load-error { grid-template-columns: auto minmax(0, 1fr); }
      .settings-load-error .btn { grid-column: 1 / -1; width: 100%; }
      .category-section__head { align-items: flex-start; flex-wrap: wrap; }
      .category-section__head .spacer { display: none; }
      .category-section__head .btn { width: 100%; }
      .category-conflict, .category-conflict__actions { align-items: stretch; flex-direction: column; }
      .category-conflict .btn { width: 100%; min-height: 48px; }
    }
    @media (min-width: 680px) {
      .workbook-steps { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .workbook-steps li { align-items: flex-start; }
      .workbook-actions { grid-template-columns: auto auto; justify-content: flex-start; }
      .workbook-actions .btn { width: auto; }
      .workbook-selection { grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
      .workbook-selection__actions { display: flex; }
      .category-form { padding: 18px; }
      .category-form__grid { grid-template-columns: minmax(0, 1fr) minmax(110px, .42fr); }
      .category-form__name { grid-column: 1 / -1; }
      .category-form__actions { grid-template-columns: auto auto; justify-content: flex-end; }
      .category-form__actions .btn { width: auto; }
      .category-item { grid-template-columns: minmax(0, 1fr) auto; align-items: center; padding: 15px 16px; }
      .category-item__actions { display: flex; }
      .category-item__actions .btn { width: auto; }
    }
    @media (min-width: 680px) {
      .settings-nav { top: 62px; }
      .settings-nav__rail { padding-inline: 26px; }
      .settings-content { padding-top: 16px; }
      .settings-content--website { padding-top: 0; }
      .settings-section { scroll-margin-top: 119px; }
    }
    .push-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .push-devices { display: grid; gap: 5px; margin-top: 10px; }
    .push-device { display: flex; justify-content: space-between; gap: 12px; padding: 7px 10px;
      border: 1px solid var(--line); border-radius: 10px; background: var(--surface-2);
      font-size: 11px; }
    .push-device span { color: var(--muted); }
    .push-sounds { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    .push-error { display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px;
      padding:12px;border:1px solid var(--danger);border-radius:12px;background:var(--danger-soft);color:var(--danger) }
    .push-error>div { display:grid;gap:2px;min-width:0 }
    .push-error small { color:var(--muted);font-size:13px;line-height:1.45 }
    .push-error .btn { flex:none;min-height:48px }
    @media(max-width:560px) { .push-error { align-items:stretch;flex-direction:column }.push-error .btn { width:100% } }
    .app-settings-kicker { margin: 22px 2px 8px; color: var(--muted); font-size: 10px;
      font-weight: 780; letter-spacing: .09em; text-transform: uppercase; }
  `,
})
export class SettingsPage implements AfterViewInit, OnDestroy {
  readonly push = inject(PushSetup);
  readonly pushActionError = signal<string | null>(null);
  private lastPushAction: 'enable' | 'disable' | 'test' = 'enable';
  /** The device list fills in once the worker knows whether we are enabled. */
  private readonly pushDevicesLoad = setTimeout(() => void this.loadPushDevices(), 1500);

  async enablePush(): Promise<void> {
    this.lastPushAction = 'enable';
    this.pushActionError.set(null);
    try {
      const error = await this.push.enable();
      if (error) {
        this.pushActionError.set(error);
        this.ui.toast(error, 'err');
        return;
      }
      this.ui.toast('Meldingen aangezet — je krijgt zo een testmelding');
      this.lastPushAction = 'test';
      await this.push.sendTest();
      setTimeout(() => void this.loadPushDevices(), 4000);
    } catch (failure: unknown) {
      const message = messageOf(failure, 'Controleer de verbinding en de browsertoestemming.');
      this.pushActionError.set(message);
      this.ui.toast(message, 'err');
    }
  }

  async disablePush(): Promise<void> {
    this.lastPushAction = 'disable';
    this.pushActionError.set(null);
    try {
      await this.push.disable();
      this.ui.toast('Meldingen uitgezet op dit toestel');
    } catch (failure: unknown) {
      const message = messageOf(failure, 'Meldingen uitzetten mislukt.');
      this.pushActionError.set(message);
      this.ui.toast(message, 'err');
    }
  }

  async testPush(): Promise<void> {
    this.lastPushAction = 'test';
    this.pushActionError.set(null);
    try {
      await this.push.sendTest();
      this.ui.toast('Testmelding onderweg');
      setTimeout(() => void this.loadPushDevices(), 4000);
    } catch (failure: unknown) {
      const message = messageOf(failure, 'Testmelding versturen mislukt.');
      this.pushActionError.set(message);
      this.ui.toast(message, 'err');
    }
  }

  retryPushAction(): void {
    if (this.lastPushAction === 'disable') void this.disablePush();
    else if (this.lastPushAction === 'test') void this.testPush();
    else void this.enablePush();
  }

  readonly pushDevices = signal<{ id: number; device: string;
    lastStatus: number | null; lastAt: string | null }[]>([]);

  async loadPushDevices(): Promise<void> {
    try {
      this.pushDevices.set(await this.push.devices());
    } catch { /* diagnostics only */ }
  }

  previewSound(kind: string): void {
    void playSoundFor(kind);
  }

  readonly desktop = inject(DesktopViewport);
  readonly theme = inject(Theme);
  readonly themes = THEMES;
  readonly workbookResult = signal<CatalogImportResult | null>(null);
  readonly selectedWorkbook = signal<File | null>(null);
  readonly exportingWorkbook = signal(false);
  readonly importingWorkbook = signal(false);
  readonly websiteSyncRefresh = signal(0);
  readonly loadingSettings = signal(true);
  readonly settingsLoadError = signal<string | null>(null);
  readonly categoryDependencyWarning = signal<string | null>(null);

  async exportWorkbook(): Promise<void> {
    if (this.exportingWorkbook()) return;
    this.exportingWorkbook.set(true);
    try {
      const date = new Intl.DateTimeFormat('sv-SE').format(new Date());
      saveBlob(await this.catalog.catalogWorkbook(), `enrosed-catalogus-${date}.xlsx`);
      this.ui.toast('Excel-bestand is gedownload', 'ok');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Excel exporteren mislukt'), 'err');
    } finally {
      this.exportingWorkbook.set(false);
    }
  }

  selectWorkbook(input: HTMLInputElement): void {
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      this.ui.toast('Kies een Excel-bestand met de extensie .xlsx', 'err');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      this.ui.toast('Dit Excel-bestand is groter dan 15 MB', 'err');
      return;
    }
    this.workbookResult.set(null);
    this.selectedWorkbook.set(file);
  }

  clearWorkbookSelection(): void {
    if (!this.importingWorkbook()) this.selectedWorkbook.set(null);
  }

  async importWorkbook(): Promise<void> {
    const file = this.selectedWorkbook();
    if (!file || this.importingWorkbook()) return;
    this.importingWorkbook.set(true);
    try {
      const result = await this.catalog.importCatalogWorkbook(file);
      this.workbookResult.set(result);
      this.selectedWorkbook.set(null);
      this.ui.toast(result.problems.length
        ? 'Excel geïmporteerd met aandachtspunten'
        : 'Catalogus bijgewerkt', result.problems.length ? 'err' : 'ok');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Excel importeren mislukt'), 'err');
    } finally {
      this.importingWorkbook.set(false);
    }
  }

  fileSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
    return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  }

  private readonly catalog = inject(CatalogApi);
  private readonly sales = inject(SalesApi);
  private readonly sourcing = inject(SourcingApi);
  private readonly ui = inject(Ui);
  private readonly document = inject(DOCUMENT);
  private readonly route = inject(ActivatedRoute);
  readonly websiteCategoryMode = this.route.snapshot.data['websiteCategoryMode'] === true;
  readonly categoryDeepLinkCode = this.route.snapshot.queryParamMap.get('category')?.trim() || null;
  readonly categoryDeepLinkLanguage = this.queryLanguage();
  readonly categoryDeepLinkFocus = this.queryCategoryFocus();
  readonly settingsBackTo = this.safeInternalRoute(
    this.route.snapshot.queryParamMap.get('returnTo'),
    '/more',
  );
  private categoryDeepLinkOpened = false;
  private scrollSpyFrame: number | null = null;
  private removeScrollSpyListeners?: () => void;
  private contentResizeObserver?: ResizeObserver;

  readonly settingsSections = [
    { id: 'company', label: 'Bedrijf' },
    { id: 'categories', label: 'Categorieën' },
    { id: 'duties', label: 'Douane' },
    { id: 'discounts', label: 'Kortingen' },
    { id: 'catalog-data', label: 'Catalogusdata' },
    { id: 'appearance', label: 'Weergave' },
    { id: 'notifications', label: 'Meldingen' },
  ] as const;
  readonly activeSection = signal<SettingsSectionId>(
    this.websiteCategoryMode ? 'categories' : 'company',
  );
  /** Phone: the one section that is unfolded; desktop shows them all. */
  readonly openSection = signal<string>(this.websiteCategoryMode ? 'categories' : 'company');
  folded(section: string): boolean {
    return !this.desktop.active() && this.openSection() !== section;
  }
  toggleSection(section: string, event: Event): void {
    if (this.desktop.active()) return;
    /* A button or field in the head does its own job; the head only folds on the bare row. */
    if ((event.target as HTMLElement).closest('button, a, input, select, label')) return;
    this.openSection.set(this.openSection() === section ? '' : section);
  }

  readonly company = signal<CompanyProfile | null>(null);
  readonly savingCompany = signal(false);
  readonly categories = signal<Category[]>([]);
  readonly products = signal<Product[]>([]);
  readonly families = signal<ProductFamily[]>([]);
  readonly suppliers = signal<Supplier[]>([]);
  readonly categoryDraft = signal<Category | null>(null);
  private readonly savedCategoryDraft = signal<Category | null>(null);
  readonly categoryDirty = computed(() =>
    JSON.stringify(this.categoryDraft()) !== JSON.stringify(this.savedCategoryDraft()));
  readonly savingCategory = signal(false);
  readonly categorySaveError = signal<string | null>(null);
  readonly categoryConflict = signal(false);
  readonly deletingCategoryId = signal<number | null>(null);
  readonly hsCodes = signal<HsCode[]>([]);
  private readonly lineTiers = signal<DiscountTier[]>([]);
  readonly orderTiers = signal<DiscountTier[]>([]);
  readonly lineDiscountPicker = signal(false);
  readonly savingLineProductId = signal<number | null>(null);
  readonly legacyLineTiers = computed(() =>
    this.lineTiers().filter((tier) => tier.productId == null));
  readonly lineDiscountGroups = computed(() => {
    const products = new Map(this.products().flatMap((product) =>
      product.id == null ? [] : [[product.id, product] as const]));
    const groups = new Map<number, DiscountTier[]>();
    for (const tier of this.lineTiers()) {
      if (tier.productId == null) continue;
      const current = groups.get(tier.productId) ?? [];
      current.push(tier);
      groups.set(tier.productId, current);
    }
    const productRank = new Map(this.products().flatMap((product, index) =>
      product.id == null ? [] : [[product.id, index] as const]));
    return [...groups.entries()]
      .map(([productId, tiers]) => ({
        productId,
        product: products.get(productId) ?? null,
        tiers: [...tiers].sort((left, right) => left.minQuantity - right.minQuantity),
      }))
      .sort((left, right) =>
        (productRank.get(left.productId) ?? Number.MAX_SAFE_INTEGER)
        - (productRank.get(right.productId) ?? Number.MAX_SAFE_INTEGER));
  });
  readonly discountPickerProducts = computed(() => {
    const configured = new Set(this.lineDiscountGroups().map((group) => group.productId));
    return this.products().filter((product) =>
      product.id != null && product.active && !product.demo && !configured.has(product.id));
  });
  readonly discountSupplierNameOf = (product: Product): string | null =>
    this.supplierName(product);

  constructor() { void this.load(); }

  ngAfterViewInit(): void {
    const view = this.document.defaultView;
    if (!view) return;

    const schedule = (): void => this.scheduleScrollSpy();
    view.addEventListener('scroll', schedule, { passive: true });
    view.addEventListener('resize', schedule, { passive: true });
    this.removeScrollSpyListeners = () => {
      view.removeEventListener('scroll', schedule);
      view.removeEventListener('resize', schedule);
    };

    const content = this.document.querySelector<HTMLElement>('.settings-content');
    if (content && typeof ResizeObserver !== 'undefined') {
      this.contentResizeObserver = new ResizeObserver(schedule);
      this.contentResizeObserver.observe(content);
    }
    this.scheduleScrollSpy();

    this.scrollToDeepLink();
  }

  /**
   * Meer links straight into one drawer: /settings?sectie=... opens and
   * scrolls to it. Runs again after the data lands, because the sections
   * above the target grow while loading and drag the anchor along.
   */
  private scrollToDeepLink(): void {
    const view = this.document.defaultView;
    this.openDeepLinkedCategory();
    const wanted = (this.websiteCategoryMode
      ? 'categories'
      : this.route.snapshot.queryParamMap.get('sectie')) as SettingsSectionId | null;
    if (!view || !wanted || !this.settingsSections.some((section) => section.id === wanted)) return;
    view.setTimeout(() => this.scrollToSection(wanted), 150);
  }

  private openDeepLinkedCategory(): void {
    if (this.categoryDeepLinkOpened || !this.categoryDeepLinkCode || this.categoryDraft()) return;
    const category = this.categories().find((candidate) =>
      candidate.code === this.categoryDeepLinkCode);
    if (!category) return;
    this.categoryDeepLinkOpened = true;
    this.editCategory(category);
  }

  private queryLanguage(): LanguageCode {
    const requested = this.route.snapshot.queryParamMap.get('language')?.toUpperCase();
    return LANGUAGES.some((language) => language.code === requested)
      ? requested as LanguageCode
      : 'NL';
  }

  private queryCategoryFocus(): string | null {
    const focus = this.route.snapshot.queryParamMap.get('focus');
    return focus && CATEGORY_TRANSLATION_FOCUS.has(focus) ? focus : null;
  }

  private safeInternalRoute(value: string | null, fallback: string): string {
    return value?.startsWith('/') && !value.startsWith('//') ? value : fallback;
  }

  ngOnDestroy(): void {
    this.removeScrollSpyListeners?.();
    this.contentResizeObserver?.disconnect();
    const view = this.document.defaultView;
    if (view && this.scrollSpyFrame !== null) view.cancelAnimationFrame(this.scrollSpyFrame);
  }

  async load(): Promise<void> {
    if (this.loadingSettings() && this.company()) return;
    this.loadingSettings.set(true);
    this.settingsLoadError.set(null);
    this.categoryDependencyWarning.set(null);
    try {
      if (this.websiteCategoryMode) {
        let dependencyFailure = false;
        const [categories, products, families] = await Promise.all([
          this.catalog.categories(),
          this.catalog.products().catch(() => {
            dependencyFailure = true;
            return [];
          }),
          this.catalog.productFamilies().catch(() => {
            dependencyFailure = true;
            return [];
          }),
        ]);
        this.categories.set(categories.map((category) => ({
          ...category,
          revision: category.revision ?? null,
          texts: category.texts ?? [],
        })));
        this.products.set(products);
        this.families.set(families);
        if (dependencyFailure) {
          this.categoryDependencyWarning.set(
            'Categorieën kunt u blijven bewerken. De keuzelijst voor featured SKU’s is tijdelijk onvolledig.',
          );
        }
        this.scrollToDeepLink();
        return;
      }
      const [categories, products, families, suppliers, hsCodes, line, order, company] = await Promise.all([
        this.catalog.categories(), this.catalog.products().catch(() => []),
        this.catalog.productFamilies().catch(() => []),
        this.sourcing.suppliers().catch(() => []), this.catalog.hsCodes(),
        this.sales.tiers('LINE'), this.sales.tiers('ORDER'),
        this.sales.company(),
      ]);
      this.company.set(company);
      this.categories.set(categories.map((category) => ({
        ...category,
        revision: category.revision ?? null,
        texts: category.texts ?? [],
      })));
      this.products.set(products);
      this.families.set(families);
      this.suppliers.set(suppliers);
      this.hsCodes.set(hsCodes);
      this.savedHsCodes = new Set(hsCodes.map((code) => code.code));
      this.lineTiers.set(line);
      this.orderTiers.set(order);
      this.scrollToDeepLink();
    } catch (failure: unknown) {
      this.settingsLoadError.set(messageOf(
        failure,
        'Controleer de verbinding met Enrosed en probeer opnieuw.',
      ));
    } finally {
      this.loadingSettings.set(false);
    }
  }

  patchCompany(changes: Partial<CompanyProfile>): void {
    this.company.update((profile) => (profile ? { ...profile, ...changes } : profile));
  }

  async saveCompany(): Promise<void> {
    const profile = this.company();
    if (!profile) return;
    this.savingCompany.set(true);
    try {
      this.company.set(await this.sales.saveCompany(profile));
      this.ui.toast('Bedrijfsgegevens opgeslagen');
    } catch {
      this.ui.toast('Opslaan mislukt', 'err');
    } finally {
      this.savingCompany.set(false);
    }
  }

  tiers(scope: 'LINE' | 'ORDER'): DiscountTier[] {
    return scope === 'LINE' ? this.lineTiers() : this.orderTiers();
  }

  scrollToSection(section: SettingsSectionId): void {
    const view = this.document.defaultView;
    const target = this.document.getElementById(section);
    if (!view || !target) return;

    this.activeSection.set(section);
    this.openSection.set(section);
    this.revealActiveNavButton(section);
    const nav = this.document.querySelector<HTMLElement>('.settings-nav');
    const stickyBottom = nav?.getBoundingClientRect().bottom ?? 0;
    const targetTop = target.getBoundingClientRect().top + view.scrollY;
    view.scrollTo({ top: Math.max(0, targetTop - stickyBottom - 8), behavior: 'smooth' });
  }

  private scheduleScrollSpy(): void {
    const view = this.document.defaultView;
    if (!view || this.scrollSpyFrame !== null) return;
    this.scrollSpyFrame = view.requestAnimationFrame(() => {
      this.scrollSpyFrame = null;
      this.updateActiveSection();
    });
  }

  private updateActiveSection(): void {
    const view = this.document.defaultView;
    if (!view) return;

    const nav = this.document.querySelector<HTMLElement>('.settings-nav');
    // The marker is based on the rendered sticky navigation, not a guessed
    // header height. This keeps the scroll spy correct on both appbar sizes.
    const stickyBottom = nav?.getBoundingClientRect().bottom ?? 0;
    const marker = stickyBottom + 10;
    let current: SettingsSectionId = this.settingsSections[0].id;

    for (const section of this.settingsSections) {
      const element = this.document.getElementById(section.id);
      if (!element || element.getBoundingClientRect().top > marker) break;
      current = section.id;
    }

    const pageBottom = view.scrollY + view.innerHeight;
    const documentBottom = this.document.documentElement.scrollHeight;
    if (pageBottom >= documentBottom - 2) {
      current = this.settingsSections[this.settingsSections.length - 1].id;
    }

    if (this.activeSection() === current) return;
    this.activeSection.set(current);
    this.revealActiveNavButton(current);
  }

  private revealActiveNavButton(section: SettingsSectionId): void {
    const nav = this.document.querySelector<HTMLElement>('.settings-nav');
    const rail = nav?.querySelector<HTMLElement>('.settings-nav__rail');
    const button = rail?.querySelector<HTMLElement>(`[data-settings-section="${section}"]`);
    if (!rail || !button) return;

    const railRect = rail.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    if (buttonRect.left < railRect.left) {
      rail.scrollBy({ left: buttonRect.left - railRect.left - 8, behavior: 'smooth' });
    } else if (buttonRect.right > railRect.right) {
      rail.scrollBy({ left: buttonRect.right - railRect.right + 8, behavior: 'smooth' });
    }
  }

  /* ---------------------------------------------------- categorieen */

  readonly reordering = signal(false);

  /** One tap on an arrow: the whole order is written in one call. */
  async moveCategory(id: number, direction: -1 | 1): Promise<void> {
    const ids = this.categories().map((category) => category.id!) as number[];
    const index = ids.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    this.reordering.set(true);
    try {
      const fresh = await this.catalog.reorderCategories(ids);
      this.categories.set(fresh.map((category) => ({
        ...category,
        revision: category.revision ?? null,
        texts: category.texts ?? [],
      })));
      this.ui.toast('Volgorde aangepast', 'ok');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Volgorde aanpassen mislukt'), 'err');
    } finally {
      this.reordering.set(false);
    }
  }

  addCategory(): void {
    if (this.categoryDraft()) return;
    this.categorySaveError.set(null);
    this.categoryConflict.set(false);
    const lastPosition = Math.max(0, ...this.categories().map((category) => category.position));
    const draft: Category = {
      id: null,
      revision: null,
      code: '',
      name: '',
      navigationName: null,
      footerName: null,
      mobileName: null,
      eyebrow: null,
      description: '',
      texts: [],
      position: lastPosition + 1,
      featuredProductId: null,
    };
    this.savedCategoryDraft.set(structuredClone(draft));
    this.categoryDraft.set(draft);
  }

  editCategory(category: Category): void {
    if (this.categoryDraft()) return;
    this.categorySaveError.set(null);
    this.categoryConflict.set(false);
    const draft: Category = {
      ...category,
      revision: category.revision ?? null,
      navigationName: category.navigationName ?? null,
      footerName: category.footerName ?? null,
      texts: (category.texts ?? []).map((text) => ({
        ...text,
        navigationName: text.navigationName ?? null,
        footerName: text.footerName ?? null,
      })),
    };
    this.savedCategoryDraft.set(structuredClone(draft));
    this.categoryDraft.set(draft);
  }

  cancelCategoryEdit(): void {
    if (this.savingCategory()) return;
    if (this.categoryDirty()) {
      this.ui.confirm({
        title: 'Categorieformulier sluiten',
        message: 'De niet-opgeslagen categorie- en vertaalwijzigingen gaan verloren.',
        confirmLabel: 'Wijzigingen wissen',
        danger: true,
      }, () => this.clearCategoryDraft());
      return;
    }
    this.clearCategoryDraft();
  }

  updateCategoryDraft(changes: Partial<Category>): void {
    this.categorySaveError.set(null);
    this.categoryDraft.update((draft) => draft ? { ...draft, ...changes } : draft);
  }

  updateCategoryTranslations(category: Category): void {
    this.categorySaveError.set(null);
    this.categoryConflict.set(false);
    this.categoryDraft.set(category);
  }

  normalizeCategoryDraftCode(): void {
    this.categoryDraft.update((draft) => draft
      ? { ...draft, code: normalizeCategoryCode(draft.code) }
      : draft);
  }

  numberOrNull(value: number | string | null): number | null {
    return value === null || value === '' ? null : Number(value);
  }

  categoryFeaturedOptions(category: Category): CategoryFeaturedOption[] {
    const categoryId = category.id;
    if (categoryId === null) return [];
    const current = category.featuredProductId;
    return this.products()
      .filter((product): product is Product & { id: number } => product.id !== null)
      .map((product) => {
        const family = familyForProduct(this.families(), product.familyId);
        return {
          product,
          family,
          eligibility: featuredProductEligibility(family, product.id, product.active),
          inCategory: productBelongsToCategory(
            family,
            product.categoryId,
            categoryId,
            normalizeCategoryCode(category.code),
          ),
        };
      })
      .filter((option) =>
        (option.inCategory && option.eligibility.eligible) || option.product.id === current);
  }

  categoryOptionEligible(option: CategoryFeaturedOption): boolean {
    return option.inCategory
      && option.eligibility.eligible
      && option.family?.active === true
      && option.family.websiteStatus === 'PUBLISHED';
  }

  categoryEligibilityLabel(option: CategoryFeaturedOption): string {
    if (this.categoryOptionEligible(option)) return '';
    return [
      option.inCategory ? null : 'andere categorie',
      option.eligibility.active ? null : 'inactief',
      option.family?.active === false ? 'familie inactief' : null,
      option.family && option.family.websiteStatus !== 'PUBLISHED'
        ? 'website niet gepubliceerd'
        : null,
      option.eligibility.hasPublicImage ? null : 'geen publieke foto',
    ]
      .filter(Boolean)
      .map((reason) => ` · ${reason}`)
      .join('');
  }

  missingFeaturedProductId(category: Category): number | null {
    const selected = category.featuredProductId;
    return selected !== null && !this.products().some((product) => product.id === selected)
      ? selected
      : null;
  }

  productOptionLabel(product: Product): string {
    const option = [product.colour || 'Geen kleur', product.variantSize].filter(Boolean).join(' · ');
    return product.sku ? `${product.name} · ${option} — ${product.sku}` : `${product.name} · ${option}`;
  }

  featuredProductLabel(productId: number): string {
    const product = this.products().find((candidate) => candidate.id === productId);
    return product ? this.productOptionLabel(product) : `#${productId}`;
  }

  categoryCodeExists(draft = this.categoryDraft()): boolean {
    if (!draft) return false;
    const code = normalizeCategoryCode(draft.code);
    if (!code) return false;
    return this.categories().some((category) =>
      category.id !== draft.id && normalizeCategoryCode(category.code) === code);
  }

  categoryCodeValid(draft = this.categoryDraft()): boolean {
    if (!draft) return false;
    return CATEGORY_CODE_PATTERN.test(normalizeCategoryCode(draft.code));
  }

  categoryDraftValid(): boolean {
    const draft = this.categoryDraft();
    return !!draft?.name.trim() && this.categoryCodeValid(draft)
      && Number.isFinite(draft.position) && draft.position >= 0
      && !this.categoryCodeExists(draft);
  }

  async saveCategory(): Promise<void> {
    const draft = this.categoryDraft();
    if (!draft || !this.categoryDraftValid()) return;
    const payload: Category = {
      ...draft,
      code: normalizeCategoryCode(draft.code),
      name: draft.name.trim(),
      navigationName: draft.navigationName?.trim() || null,
      footerName: draft.footerName?.trim() || null,
      mobileName: draft.mobileName?.trim() || null,
      eyebrow: draft.eyebrow?.trim() || null,
      description: draft.description?.trim() || '',
      texts: (draft.texts ?? []).map((text) => ({
        ...text,
        name: text.name?.trim() || null,
        navigationName: text.navigationName?.trim() || null,
        footerName: text.footerName?.trim() || null,
        description: text.description?.trim() || null,
        eyebrow: text.eyebrow?.trim() || null,
        mobileName: text.mobileName?.trim() || null,
      })),
      position: Math.round(draft.position),
      featuredProductId: draft.featuredProductId ?? null,
    };
    this.categorySaveError.set(null);
    this.categoryConflict.set(false);
    this.savingCategory.set(true);
    try {
      const saved = payload.id === null
        ? await this.catalog.createCategory(payload)
        : await this.catalog.updateCategory(payload.id, payload);
      this.categories.update((categories) => {
        const next = payload.id === null
          ? [...categories, saved]
          : categories.map((category) => category.id === saved.id ? saved : category);
        return next.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'nl'));
      });
      this.categoryDraft.set(null);
      this.savedCategoryDraft.set(null);
      this.websiteSyncRefresh.update((value) => value + 1);
      const missingLanguageCount = this.categoryMissingLanguages(saved).length;
      this.ui.toast(missingLanguageCount
        ? `${payload.id === null ? 'Categorie toegevoegd' : 'Categorie opgeslagen'} · ${missingLanguageCount} taal/talen later aanvullen`
        : (payload.id === null ? 'Categorie toegevoegd' : 'Categorie opgeslagen'));
    } catch (failure: unknown) {
      const conflict = isRevisionConflict(failure);
      const message = conflict
        ? 'Deze categorie is intussen gewijzigd. Laad de laatste versie en controleer je aanpassing opnieuw.'
        : messageOf(failure, 'Opslaan mislukt');
      this.categoryConflict.set(conflict);
      this.categorySaveError.set(message);
      this.ui.toast(message, 'err');
    } finally {
      this.savingCategory.set(false);
    }
  }

  async reloadConflictedCategory(): Promise<void> {
    const draft = this.categoryDraft();
    if (!draft || draft.id === null || this.savingCategory()) return;
    this.savingCategory.set(true);
    try {
      const latest = (await this.catalog.categories()).find((category) => category.id === draft.id);
      if (!latest) {
        this.categorySaveError.set('Deze categorie bestaat niet meer. Sluit het formulier en laad Instellingen opnieuw.');
        return;
      }
      const normalized: Category = {
        ...latest,
        revision: latest.revision ?? null,
        navigationName: latest.navigationName ?? null,
        footerName: latest.footerName ?? null,
        texts: (latest.texts ?? []).map((text) => ({
          ...text,
          navigationName: text.navigationName ?? null,
          footerName: text.footerName ?? null,
        })),
      };
      this.categories.update((categories) => categories.map((category) =>
        category.id === normalized.id ? normalized : category));
      this.savedCategoryDraft.set(structuredClone(normalized));
      this.categoryDraft.set(structuredClone(normalized));
      this.categoryConflict.set(false);
      this.categorySaveError.set(null);
      this.ui.toast('Laatste categorieversie geladen');
    } catch (failure: unknown) {
      this.categorySaveError.set(messageOf(failure, 'Laatste categorieversie laden mislukt'));
    } finally {
      this.savingCategory.set(false);
    }
  }

  private categoryMissingLanguages(category: Category): LanguageCode[] {
    return LANGUAGES.filter((language) => {
      const text = category.texts?.find((item) => item.language === language.code);
      return !text?.name?.trim()
        || (this.categoryTranslationFieldUsed(category, 'navigationName') && !text?.navigationName?.trim())
        || (this.categoryTranslationFieldUsed(category, 'footerName') && !text?.footerName?.trim())
        || (this.categoryTranslationFieldUsed(category, 'mobileName') && !text?.mobileName?.trim())
        || (this.categoryTranslationFieldUsed(category, 'eyebrow') && !text?.eyebrow?.trim())
        || (this.categoryTranslationFieldUsed(category, 'description') && !text?.description?.trim());
    }).map((language) => language.code);
  }

  private categoryTranslationFieldUsed(
    category: Category,
    field: 'navigationName' | 'footerName' | 'mobileName' | 'eyebrow' | 'description',
  ): boolean {
    return !!category[field]?.trim()
      || (category.texts ?? []).some((text) => !!text[field]?.trim());
  }

  /** Delete lives inside the edit form: you look at it before you lose it. */
  removeCategoryDraft(): void {
    const draft = this.categoryDraft();
    const category = this.categories().find((candidate) => candidate.id === draft?.id);
    if (category) this.removeCategory(category);
  }

  removeCategory(category: Category): void {
    this.ui.confirm(
      { title: 'Categorie verwijderen', message: `<b>${category.name}</b> verwijderen?`,
        confirmLabel: 'Verwijderen', danger: true },
      async () => {
        this.deletingCategoryId.set(category.id);
        try {
          await this.catalog.deleteCategory(category.id!);
          this.categories.update((categories) =>
            categories.filter((current) => current.id !== category.id));
          if (this.categoryDraft()?.id === category.id) this.clearCategoryDraft();
          this.websiteSyncRefresh.update((value) => value + 1);
          this.ui.toast('Categorie verwijderd');
        } catch (failure: unknown) {
          const message = messageOf(failure, 'Categorie verwijderen mislukt');
          this.ui.toast(message, 'err');
        } finally {
          this.deletingCategoryId.set(null);
        }
      });
  }

  /* -------------------------------------------------- douanetarieven */

  addHsCode(): void {
    this.hsCodes.update((codes) =>
      [...codes, { id: null, code: '', description: '', dutyRatePct: 0 }]);
  }

  async saveHsCode(code: HsCode): Promise<void> {
    if (!code.code.trim()) { this.ui.toast('Vul een code in', 'err'); return; }
    await this.catalog.saveHsCode(code);
    this.ui.toast('Tarief opgeslagen');
    await this.load();
  }

  /** Codes as loaded from the server; anything else is an unsaved draft. */
  private savedHsCodes = new Set<string>();

  /* Percentages are typed the Belgian way, with a comma. A number input
     refuses "6,5" on most keyboards; a decimal text field accepts both. */
  pctText(value: number | null | undefined): string {
    return value == null ? '' : String(value).replace('.', ',');
  }

  pctValue(raw: string): number {
    const parsed = parseFloat(String(raw).trim().replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  removeHsCode(code: HsCode): void {
    /* A freshly added row has nothing on the server yet: drop it locally,
       no dialog - that was the "X does nothing" on a new tariff. */
    if (!this.savedHsCodes.has(code.code)) {
      this.hsCodes.update((codes) => codes.filter((candidate) => candidate !== code));
      return;
    }
    this.ui.confirm(
      { title: 'Tariefcode verwijderen',
        message: `<b>${code.code}</b> verwijderen? Producten vallen terug op het `
          + 'standaardpercentage van de inkooporder.',
        confirmLabel: 'Verwijderen', danger: true },
      async () => { await this.catalog.deleteHsCode(code.code); await this.load(); });
  }

  /* ------------------------------------------------------- staffels */

  addTier(scope: 'LINE' | 'ORDER'): void {
    const target = scope === 'LINE' ? this.lineTiers : this.orderTiers;
    target.update((tiers) => [...tiers, {
      id: null, scope, productId: null, minQuantity: 1, percent: 0,
    }]);
  }

  removeTier(scope: 'LINE' | 'ORDER', index: number): void {
    const target = scope === 'LINE' ? this.lineTiers : this.orderTiers;
    target.update((tiers) => tiers.filter((_, i) => i !== index));
  }

  async saveTiers(scope: 'LINE' | 'ORDER'): Promise<void> {
    try {
      const saved = await this.sales.saveTiers(scope, this.tiers(scope));
      (scope === 'LINE' ? this.lineTiers : this.orderTiers).set(saved);
      this.ui.toast('Staffel opgeslagen');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Staffel opslaan mislukt'), 'err');
    }
  }

  supplierName(product: Product): string | null {
    if (product.supplierId == null) return null;
    return this.suppliers().find((supplier) => supplier.id === product.supplierId)?.name ?? null;
  }

  chooseDiscountProduct(product: Product): void {
    if (product.id == null) return;
    this.lineDiscountPicker.set(false);
    if (this.lineTiers().some((tier) => tier.productId === product.id)) {
      this.scrollToLineDiscount(product.id);
      return;
    }
    this.lineTiers.update((tiers) => [...tiers, {
      id: null,
      scope: 'LINE',
      productId: product.id,
      minQuantity: Math.max(1, product.carton.piecesPerCarton ?? 1),
      percent: 0,
    }]);
    this.scrollToLineDiscount(product.id);
  }

  addLineTier(productId: number): void {
    const existing = this.lineTiers().filter((tier) => tier.productId === productId);
    const highest = existing.reduce((value, tier) => Math.max(value, tier.minQuantity), 0);
    this.lineTiers.update((tiers) => [...tiers, {
      id: null,
      scope: 'LINE',
      productId,
      minQuantity: Math.max(1, highest + 100),
      percent: 0,
    }]);
  }

  updateLineTier(tier: DiscountTier, changes: Partial<Pick<DiscountTier, 'minQuantity' | 'percent'>>): void {
    this.lineTiers.update((tiers) => tiers.map((candidate) =>
      candidate === tier ? { ...candidate, ...changes } : candidate));
  }

  removeLineTier(tier: DiscountTier): void {
    if (tier.productId != null
        && this.lineTiers().filter((candidate) => candidate.productId === tier.productId).length === 1) {
      const productName = this.products().find((product) => product.id === tier.productId)?.name;
      this.removeLineDiscountProduct(tier.productId, productName);
      return;
    }
    this.lineTiers.update((tiers) => tiers.filter((candidate) => candidate !== tier));
  }

  updateOrderTier(index: number, changes: Partial<Pick<DiscountTier, 'minQuantity' | 'percent'>>): void {
    this.orderTiers.update((tiers) => tiers.map((tier, currentIndex) =>
      currentIndex === index ? { ...tier, ...changes, productId: null } : tier));
  }

  async saveLineProductTiers(productId: number): Promise<void> {
    const tiers = this.lineTiers()
      .filter((tier) => tier.productId === productId)
      .sort((left, right) => left.minQuantity - right.minQuantity);
    if (!tiers.length) return;
    this.savingLineProductId.set(productId);
    try {
      const saved = await this.sales.saveProductTiers(productId, tiers);
      this.lineTiers.update((current) => [
        ...current.filter((tier) => tier.productId !== productId),
        ...saved,
      ]);
      this.ui.toast('Productstaffel opgeslagen');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Productstaffel opslaan mislukt'), 'err');
    } finally {
      this.savingLineProductId.set(null);
    }
  }

  removeLineDiscountProduct(productId: number, productName?: string | null): void {
    this.ui.confirm({
      title: 'Productkorting verwijderen',
      message: 'De automatische lijnkorting voor dit product wordt verwijderd. Andere producten blijven ongewijzigd.',
      confirmLabel: 'Verwijderen',
      danger: true,
    }, async () => {
      this.savingLineProductId.set(productId);
      try {
        await this.sales.saveProductTiers(productId, []);
        this.lineTiers.update((tiers) => tiers.filter((tier) => tier.productId !== productId));
        this.ui.toast(productName ? `Korting voor ${productName} verwijderd` : 'Productkorting verwijderd');
      } catch (failure: unknown) {
        this.ui.toast(messageOf(failure, 'Productkorting verwijderen mislukt'), 'err');
      } finally {
        this.savingLineProductId.set(null);
      }
    });
  }

  removeLegacyLineTiers(): void {
    this.ui.confirm({
      title: 'Oude algemene lijnkorting opruimen',
      message: 'Alleen de oude niet-productspecifieke regels worden verwijderd. Productspecifieke staffels blijven staan.',
      confirmLabel: 'Opruimen',
      danger: false,
    }, async () => {
      try {
        const valid = this.lineTiers().filter((tier) => tier.productId != null);
        this.lineTiers.set(await this.sales.saveTiers('LINE', valid));
        this.ui.toast('Oude algemene lijnkorting opgeruimd');
      } catch (failure: unknown) {
        this.ui.toast(messageOf(failure, 'Oude lijnkorting opruimen mislukt'), 'err');
      }
    });
  }

  private scrollToLineDiscount(productId: number): void {
    this.document.defaultView?.setTimeout(() => {
      this.document.getElementById(`line-discount-${productId}`)?.scrollIntoView({
        behavior: 'smooth', block: 'center',
      });
    });
  }

  canDeactivate(): boolean {
    if (this.savingCategory()) return false;
    if (!this.categoryDirty()) return true;
    return window.confirm(
      'Je hebt categorie- of vertaalwijzigingen die nog niet zijn opgeslagen. Dit scherm toch verlaten?',
    );
  }

  @HostListener('window:beforeunload', ['$event'])
  warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.categoryDirty() && !this.savingCategory()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  private clearCategoryDraft(): void {
    this.categoryDraft.set(null);
    this.savedCategoryDraft.set(null);
    this.categorySaveError.set(null);
    this.categoryConflict.set(false);
  }
}

type SettingsSectionId = 'company' | 'appearance' | 'catalog-data' | 'categories' | 'duties' | 'discounts' | 'notifications';
