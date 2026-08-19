import { DOCUMENT } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { SalesApi } from '../../core/api/sales-api';
import {
  CatalogImportResult, Category, CompanyProfile, DiscountTier, HsCode,
} from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Ui } from '../../shared/ui';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';

/** Categorieën, douanetarieven en kortingsstaffels. */
@Component({
  selector: 'app-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageHeader],
  template: `
    <app-page-header title="Instellingen" subtitle="Categorieën, tarieven en staffels" />

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

    <div class="content settings-content">
      <!-- ======================================= bedrijfsgegevens -->
      <div class="card settings-section" id="company">
        <div class="card__head"><h2>Onze bedrijfsgegevens</h2></div>
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
            </div>
            <div class="span-2 mt-8">
              <div class="section-title" style="margin-top:0">Juridische teksten</div>
              <p class="small muted" style="margin-bottom:8px">
                Voorwaarden en privacyverklaring staan klaar als voorstel voor Enrosed BV —
                laat ze nakijken door je boekhouder of jurist. Klanten lezen ze op
                <a href="/voorwaarden" target="_blank" rel="noopener">/voorwaarden</a>;
                documenten in een andere taal dan Nederlands verwijzen naar de
                <b>Engelse</b> versie. Leeg laten betekent: gebruik het ingebouwde voorstel.
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
              <details style="margin-bottom:8px">
                <summary class="small strong" style="cursor:pointer">
                  Terms and conditions (EN)
                </summary>
                <textarea class="textarea mt-8" rows="12" style="min-height:220px"
                          [ngModel]="profile.termsAndConditionsEn"
                          (ngModelChange)="patchCompany({ termsAndConditionsEn: $event })"
                          [placeholder]="'Empty = built-in draft'"></textarea>
              </details>
              <details style="margin-bottom:8px">
                <summary class="small strong" style="cursor:pointer">
                  Privacyverklaring (NL)
                </summary>
                <textarea class="textarea mt-8" rows="12" style="min-height:220px"
                          [ngModel]="profile.privacyPolicy"
                          (ngModelChange)="patchCompany({ privacyPolicy: $event })"
                          [placeholder]="'Leeg = ingebouwd voorstel'"></textarea>
              </details>
              <details>
                <summary class="small strong" style="cursor:pointer">
                  Privacy statement (EN)
                </summary>
                <textarea class="textarea mt-8" rows="12" style="min-height:220px"
                          [ngModel]="profile.privacyPolicyEn"
                          (ngModelChange)="patchCompany({ privacyPolicyEn: $event })"
                          [placeholder]="'Empty = built-in draft'"></textarea>
              </details>
            </div>
            <button class="btn btn--primary btn--block mt-8" type="button"
                    [disabled]="savingCompany()" (click)="saveCompany()">
              {{ savingCompany() ? 'Bezig…' : 'Bedrijfsgegevens opslaan' }}
            </button>
          }
        </div>
      </div>

      <!-- ======================================= catalogus in Excel -->
      <div class="card settings-section workbook-card" id="catalog-data">
        <div class="card__head workbook-card__head">
          <div><span class="workbook-badge" aria-hidden="true">XLSX</span><h2>Catalogus in Excel</h2></div>
        </div>
        <div class="card__body">
          <p class="workbook-intro">
            Bewerk productteksten, maten, barcodes, prijzen, publicatie en vertalingen
            in één duidelijk Excel-bestand. Kolomfilters, vaste kopregels en dropdowns
            staan al voor je klaar.
          </p>

          <ol class="workbook-steps" aria-label="Werkwijze Excel-import">
            <li><span>1</span><div><b>Download</b><small>Begin altijd met de nieuwste export.</small></div></li>
            <li><span>2</span><div><b>Bewerk</b><small>Producten en vertalingen staan op aparte tabbladen.</small></div></li>
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
                    (click)="workbookFile.click()">Excel kiezen…</button>
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
      <div class="card settings-section category-section" id="categories">
        <div class="card__head category-section__head">
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

          @if (categoryDraft(); as draft) {
            <section class="category-form" aria-labelledby="category-form-title">
              <div class="category-form__heading">
                <div>
                  <div class="eyebrow">{{ draft.id === null ? 'Nieuwe categorie' : 'Categorie bewerken' }}</div>
                  <h3 id="category-form-title">
                    {{ draft.id === null ? 'Voeg een categorie toe' : draft.name }}
                  </h3>
                </div>
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
                  <label class="req" for="category-code">Code</label>
                  <input class="input mono" id="category-code" autocomplete="off"
                         [ngModel]="draft.code"
                         (ngModelChange)="updateCategoryDraft({ code: $event })"
                         placeholder="GEURKAARSEN" />
                  <span class="hint">Korte unieke interne code.</span>
                </div>
                <div class="field">
                  <label for="category-position">Volgorde</label>
                  <input class="input num" id="category-position" type="number" min="0" step="1"
                         [ngModel]="draft.position"
                         (ngModelChange)="updateCategoryDraft({ position: +$event })" />
                  <span class="hint">Lager nummer verschijnt eerst.</span>
                </div>
                <div class="field category-form__description">
                  <label for="category-description">Beschrijving <span class="opt"></span></label>
                  <textarea class="textarea" id="category-description" rows="3"
                            [ngModel]="draft.description"
                            (ngModelChange)="updateCategoryDraft({ description: $event })"
                            placeholder="Korte omschrijving voor catalogus, bestelapp en website…"></textarea>
                </div>
              </div>

              @if (categoryCodeExists(draft)) {
                <p class="category-form__error" role="alert">
                  Deze code bestaat al. Kies een unieke code.
                </p>
              }

              <div class="category-form__actions">
                <button class="btn" type="button" [disabled]="savingCategory()"
                        (click)="cancelCategoryEdit()">Annuleren</button>
                <button class="btn btn--primary" type="button"
                        [disabled]="!categoryDraftValid() || savingCategory()"
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
                    <span class="category-item__position">Volgorde {{ category.position }}</span>
                  </div>
                  <div class="category-item__actions">
                    <button class="btn btn--sm" type="button"
                            [disabled]="categoryDraft() !== null || deletingCategoryId() === category.id"
                            (click)="editCategory(category)">Bewerken</button>
                    <button class="btn btn--sm btn--danger" type="button"
                            [disabled]="categoryDraft() !== null || deletingCategoryId() === category.id"
                            (click)="removeCategory(category)">
                      {{ deletingCategoryId() === category.id ? 'Verwijderen…' : 'Verwijderen' }}
                    </button>
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
      <div class="card settings-section" id="duties">
        <div class="card__head"><h2>Douanetarieven</h2><span class="spacer"></span>
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
                <input class="input input--sm num right" style="max-width:80px" type="number"
                       step="0.5" aria-label="Invoerrecht" [ngModel]="code.dutyRatePct"
                       (ngModelChange)="code.dutyRatePct = +$event" />
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

      <!-- ======================================= staffels -->
      @for (scope of scopes; track scope.key) {
        <div class="card settings-section" [id]="scope.key === 'LINE' ? 'discounts' : 'order-discounts'">
          <div class="card__head"><h2>{{ scope.label }}</h2><span class="spacer"></span>
            <button class="btn btn--sm" type="button" (click)="addTier(scope.key)">+</button></div>
          <div class="card__body">
            @for (tier of tiers(scope.key); track $index) {
              <div class="row" style="margin-bottom:8px">
                <span class="small muted" style="width:52px">vanaf</span>
                <input class="input input--sm num right" type="number" step="50"
                       aria-label="Vanaf aantal" [ngModel]="tier.minQuantity"
                       (ngModelChange)="tier.minQuantity = +$event" />
                <span class="small muted">st →</span>
                <input class="input input--sm num right" type="number" step="0.5"
                       aria-label="Percentage" [ngModel]="tier.percent"
                       (ngModelChange)="tier.percent = +$event" />
                <span class="small muted">%</span>
                <button class="btn btn--sm btn--danger" type="button"
                        (click)="removeTier(scope.key, $index)">✕</button>
              </div>
            }
            <button class="btn btn--sm btn--primary mt-8" type="button"
                    (click)="saveTiers(scope.key)">Staffel opslaan</button>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
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
    .settings-nav__rail::-webkit-scrollbar { display: none; }
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
    .category-form__description { grid-column: 1 / -1; }
    .category-form__error { margin-top: 10px; color: var(--danger); font-size: 12.5px; font-weight: 600; }
    .category-form__actions { display: grid; grid-template-columns: 1fr; gap: 8px; margin-top: 14px; }
    .category-form__actions .btn { width: 100%; }
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
      .category-section__head { align-items: flex-start; flex-wrap: wrap; }
      .category-section__head .spacer { display: none; }
      .category-section__head .btn { width: 100%; }
    }
    @media (min-width: 700px) {
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
    @media (min-width: 1024px) {
      .settings-nav { top: 62px; }
      .settings-nav__rail { padding-inline: 26px; }
      .settings-content { padding-top: 16px; }
      .settings-section { scroll-margin-top: 119px; }
    }
  `,
})
export class SettingsPage implements AfterViewInit, OnDestroy {
  readonly workbookResult = signal<CatalogImportResult | null>(null);
  readonly selectedWorkbook = signal<File | null>(null);
  readonly exportingWorkbook = signal(false);
  readonly importingWorkbook = signal(false);

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
  private readonly ui = inject(Ui);
  private readonly document = inject(DOCUMENT);
  private scrollSpyFrame: number | null = null;
  private removeScrollSpyListeners?: () => void;
  private contentResizeObserver?: ResizeObserver;

  readonly settingsSections = [
    { id: 'company', label: 'Bedrijf' },
    { id: 'catalog-data', label: 'Catalogusdata' },
    { id: 'categories', label: 'Categorieën' },
    { id: 'duties', label: 'Douane' },
    { id: 'discounts', label: 'Kortingen' },
  ] as const;
  readonly activeSection = signal<SettingsSectionId>('company');

  readonly scopes = [
    { key: 'LINE' as const, label: 'Lijnkorting — per product' },
    { key: 'ORDER' as const, label: 'Orderkorting — totaal order' },
  ];

  readonly company = signal<CompanyProfile | null>(null);
  readonly savingCompany = signal(false);
  readonly categories = signal<Category[]>([]);
  readonly categoryDraft = signal<Category | null>(null);
  readonly savingCategory = signal(false);
  readonly deletingCategoryId = signal<number | null>(null);
  readonly hsCodes = signal<HsCode[]>([]);
  private readonly lineTiers = signal<DiscountTier[]>([]);
  private readonly orderTiers = signal<DiscountTier[]>([]);

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
  }

  ngOnDestroy(): void {
    this.removeScrollSpyListeners?.();
    this.contentResizeObserver?.disconnect();
    const view = this.document.defaultView;
    if (view && this.scrollSpyFrame !== null) view.cancelAnimationFrame(this.scrollSpyFrame);
  }

  private async load(): Promise<void> {
    const [categories, hsCodes, line, order, company] = await Promise.all([
      this.catalog.categories(), this.catalog.hsCodes(),
      this.sales.tiers('LINE'), this.sales.tiers('ORDER'),
      this.sales.company(),
    ]);
    this.company.set(company);
    this.categories.set(categories);
    this.hsCodes.set(hsCodes);
    this.lineTiers.set(line);
    this.orderTiers.set(order);
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

  addCategory(): void {
    if (this.categoryDraft()) return;
    const lastPosition = Math.max(0, ...this.categories().map((category) => category.position));
    this.categoryDraft.set(
      { id: null, code: '', name: '', description: '', position: lastPosition + 1 });
  }

  editCategory(category: Category): void {
    if (this.categoryDraft()) return;
    this.categoryDraft.set({ ...category });
  }

  cancelCategoryEdit(): void {
    if (!this.savingCategory()) this.categoryDraft.set(null);
  }

  updateCategoryDraft(changes: Partial<Category>): void {
    this.categoryDraft.update((draft) => draft ? { ...draft, ...changes } : draft);
  }

  categoryCodeExists(draft = this.categoryDraft()): boolean {
    if (!draft?.code.trim()) return false;
    const code = draft.code.trim().toLocaleUpperCase('nl-BE');
    return this.categories().some((category) =>
      category.id !== draft.id && category.code.trim().toLocaleUpperCase('nl-BE') === code);
  }

  categoryDraftValid(): boolean {
    const draft = this.categoryDraft();
    return !!draft?.name.trim() && !!draft.code.trim()
      && Number.isFinite(draft.position) && draft.position >= 0
      && !this.categoryCodeExists(draft);
  }

  async saveCategory(): Promise<void> {
    const draft = this.categoryDraft();
    if (!draft || !this.categoryDraftValid()) return;
    const payload: Category = {
      ...draft,
      code: draft.code.trim().toLocaleUpperCase('nl-BE'),
      name: draft.name.trim(),
      description: draft.description?.trim() || '',
      position: Math.round(draft.position),
    };
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
      this.ui.toast(payload.id === null ? 'Categorie toegevoegd' : 'Categorie opgeslagen');
    } catch (failure: unknown) {
      this.ui.toast(messageOf(failure, 'Opslaan mislukt'), 'err');
    } finally {
      this.savingCategory.set(false);
    }
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
          this.ui.toast('Categorie verwijderd');
        } catch (failure: unknown) {
          this.ui.toast(messageOf(failure, 'Verwijderen mislukt'), 'err');
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

  removeHsCode(code: HsCode): void {
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
    target.update((tiers) => [...tiers, { id: null, scope, minQuantity: 0, percent: 0 }]);
  }

  removeTier(scope: 'LINE' | 'ORDER', index: number): void {
    const target = scope === 'LINE' ? this.lineTiers : this.orderTiers;
    target.update((tiers) => tiers.filter((_, i) => i !== index));
  }

  async saveTiers(scope: 'LINE' | 'ORDER'): Promise<void> {
    const saved = await this.sales.saveTiers(scope, this.tiers(scope));
    (scope === 'LINE' ? this.lineTiers : this.orderTiers).set(saved);
    this.ui.toast('Staffel opgeslagen');
  }
}

type SettingsSectionId = 'company' | 'catalog-data' | 'categories' | 'duties' | 'discounts';
