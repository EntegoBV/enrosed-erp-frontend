import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { describePublicationIssues } from './publication-issues';
import {
  Category,
  LanguageCode,
  Product,
  ProductFamily,
  ProductPublicTranslationsSnapshot,
  PublicationStatus,
} from '../../core/api/models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
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
  imports: [
    FormsModule,
    ProductFamilyGallery,
    ProductFamilySourceDetails,
    RouterLink,
  ],
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
        @if (!familyLoading() && !familyLoadError()) {
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
        }
        @if (familyLoadError()) {
          <span class="issue-count">Niet geladen</span>
        } @else if (issueCount()) {
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
        @if (familyLoading()) {
          <div class="model-load-state" role="status">Gedeelde websitegegevens laden…</div>
        } @else if (familyLoadError()) {
          <div class="model-load-state model-load-state--error" role="alert">
            <span>
              <b>Gedeelde websitegegevens niet geladen</b>
              <small>Je dagelijkse productvelden blijven wel bewerkbaar.</small>
            </span>
            <button class="btn btn--sm" type="button" (click)="retryFamily()">
              Opnieuw proberen
            </button>
          </div>
        } @else if (family(); as family) {
          <div class="family-impact" role="note">
            <span aria-hidden="true">i</span>
            <p>
              Je bewerkt gedeelde websitegegevens voor <b>{{ family.name || family.familyKey }}</b>.
              Deze inhoud geldt voor alle <b>{{ family.variantCount }} product(en)</b>;
              inkoop, voorraad, verpakking en prijzen blijven per product apart.
            </p>
          </div>


        } @else {
          <div class="model-empty">
            <div>
              <b>Nog geen gedeeld websiteproduct</b>
              <p>
                Voor één los product kun je hier websitegegevens starten. Heb je meerdere
                kleuren of maten, koppel ze dan eerst bij <b>Varianten</b> in dit bewerkscherm.
              </p>
              @if (legacyFamilyKey()) {
                <p class="legacy-family-note" role="note">
                  Oude groepscode gevonden. Dit product is pas echt gekoppeld nadat je het via
                  <b>Varianten</b> aan een ander product hebt gekoppeld.
                </p>
              }
            </div>
            <button class="btn btn--sm" type="button" (click)="requestFamilyCreation()">
              Websitegegevens starten
            </button>
          </div>
        }


        @if (!familyLoading() && !familyLoadError() && family(); as family) {

          <!-- One question a seller actually asks: is this on the website?
               Orderapp and catalogue are future channels; they stay
               reachable under "Meer" without cluttering the answer. -->
          <section class="subsection" aria-labelledby="publication-channels-title">
            <div class="subsection__head">
              <div>
                <h3 id="publication-channels-title">Op de website</h3>
                <p>Geldt voor alle kleuren en maten van deze reeks.</p>
              </div>
              <select class="select select--status"
                      [class.select--status-off]="visiblePublicationStatus(family.websiteStatus) !== 'PUBLISHED'"
                      [ngModel]="visiblePublicationStatus(family.websiteStatus)"
                      (ngModelChange)="patch({ websiteStatus: $event })"
                      aria-label="Zichtbaar op de website">
                <option value="DRAFT">Nog niet zichtbaar</option>
                <option value="PUBLISHED">Zichtbaar op de website</option>
              </select>
            </div>

            @if (family.publicationIssues.length) {
              <div class="readiness" role="status">
                <div class="readiness__head">
                  <b>Nog {{ readableIssues().length }} punt(en) voordat dit live kan</b>
                  <small>U kunt productgegevens en gedeeltelijke vertalingen wel gewoon opslaan; alleen publicatie wacht.</small>
                </div>
                <ul>
                  @for (issue of readableIssues(); track issue) {
                    <li>{{ issue }}</li>
                  }
                </ul>
              </div>
            } @else {
              <div class="readiness readiness--ok" role="status">
                <b>Alles compleet</b> — deze reeks kan live.
              </div>
            }

            <div class="translations-row">
              <div>
                <b>Vertalingen</b>
                <small>Naam, beschrijving, variantteksten en foto-alt-teksten in acht talen. Ontbrekende talen blijven als vervolgtaken staan.</small>
              </div>
              @if (product().id !== null) {
                <a class="btn btn--sm btn--primary" [routerLink]="['/products', product().id, 'translations']">
                  Vertalingen bewerken
                </a>
              } @else {
                <span class="small muted">Sla het product eerst op.</span>
              }
            </div>

            <details class="more-channels">
              <summary>Meer: orderapp, catalogus en reeks aan/uit</summary>
              <label class="switch-row">
                <span><b>Reeks actief</b><small>Uit = alle kleuren en maten verborgen, overal.</small></span>
                <input type="checkbox" [ngModel]="family.active" (ngModelChange)="patch({ active: $event })" />
              </label>
              <div class="channel-grid">
                <label class="channel-card">
                  <span><b>Orderapp</b><small>Bestelbaar voor klanten (later)</small></span>
                  <select class="select select--sm"
                          [ngModel]="visiblePublicationStatus(family.orderAppStatus)"
                          (ngModelChange)="patch({ orderAppStatus: $event })">
                    <option value="DRAFT">Concept</option>
                    <option value="PUBLISHED">Gepubliceerd</option>
                  </select>
                </label>
                <label class="channel-card">
                  <span><b>Catalogus</b><small>Catalogussync (later)</small></span>
                  <select class="select select--sm"
                          [ngModel]="visiblePublicationStatus(family.catalogueStatus)"
                          (ngModelChange)="patch({ catalogueStatus: $event })">
                    <option value="DRAFT">Concept</option>
                    <option value="PUBLISHED">Gepubliceerd</option>
                  </select>
                </label>
              </div>
            </details>
          </section>

          <section class="model-publication" aria-labelledby="model-publication-title">
            <div>
              <h3 id="model-publication-title">Productkaart</h3>
              <p>De kaart in de shop en de bestelapp toont één kleur of maat van deze reeks.</p>
            </div>
            <label class="field family-card-variant">
              <span>Variant op de kaart</span>
              <select class="select" [ngModel]="family.cardFeaturedProductId ?? null"
                      [disabled]="!members().length && missingCardFeaturedProductId() === null"
                      (ngModelChange)="patch({ cardFeaturedProductId: numberOrNull($event) })">
                <option [ngValue]="null">Automatisch · het eerste actieve product</option>
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
            </label>
          </section>

          <section class="subsection" aria-labelledby="publication-identity-title">
            <div class="subsection__head">
              <div>
                <h3 id="publication-identity-title">Vaste koppeling &amp; URL</h3>
                <p>Vaste koppeling en permanente URL voor alle gekoppelde varianten.</p>
              </div>
            </div>
            <div class="stable-identity-note" role="note">
              <span aria-hidden="true">🔗</span>
              <p><b>De klanttitel mag later veranderen.</b> De vaste reeks-sleutel en URL worden één keer bij het aanmaken gekozen. Een latere URL-migratie hoort buiten dit formulier en vereist een gecontroleerde redirect.</p>
            </div>
            <div class="form-grid">
              <label class="field">
                <span>Vaste productreeks-sleutel</span>
                <input
                  class="input mono"
                  [ngModel]="family.familyKey"
                  [readOnly]="family.id !== null"
                  (ngModelChange)="patch({ familyKey: $event })"
                  placeholder="bijv. rose-in-dome-xl"
                />
                <small class="field__hint">Permanente technische koppeling tussen varianten; alleen te kiezen wanneer een nieuwe reeks wordt aangemaakt.</small>
              </label>
              <label class="field">
                <span>Permanente publieke URL</span>
                <span class="url-field">
                  <small>/products/</small>
                  <input
                    class="input mono"
                    [ngModel]="family.publicHandle"
                    [readOnly]="family.id !== null"
                    (ngModelChange)="patch({ publicHandle: $event })"
                    placeholder="rose-in-dome-xl"
                  />
                </span>
                <small class="field__hint">{{ family.id !== null
                  ? 'Permanent na aanmaak. Gebruik een gecontroleerde redirect buiten dit formulier voor een URL-migratie.'
                  : 'Kies deze permanente URL één keer voor de nieuwe reeks; een titelwijziging past hem later niet automatisch aan.' }}</small>
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
            [translationEditing]="false"
            [currentProductId]="product().id"
            [busy]="busy() || translationDirtyState()"
            (familyChange)="updateFamily($event)"
            (imageUploadRequested)="requestImageUpload($event)"
            (imageDeleteRequested)="requestImageDelete($event)"
            (imageVariantChangeRequested)="requestImageVariantChange($event)"
          />

          <app-product-family-source-details [product]="product()" [family]="family" />
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
    .model-publication, .model-empty {
      display: grid;
      gap: 10px;
      margin-top: 12px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: var(--r-sm);
      background: var(--surface-2);
    }
    .model-publication h3, .model-empty b { font-size: 12.5px; }
    .model-publication p, .model-empty p {
      margin-top: 2px;
      color: var(--muted);
      font-size: 10.5px;
      line-height: 1.4;
    }
    .model-empty > .btn { justify-self: start; }
    .legacy-family-note {
      margin-top: 7px !important; padding: 7px 8px; border-radius: 8px;
      background: var(--warn-soft); color: var(--ink-2) !important;
    }
    .family-card-variant { margin: 2px 0 0; }
    .model-load-state {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      min-height: 70px; padding: 12px; border: 1px solid var(--line);
      border-radius: var(--r-sm); background: var(--surface-2); color: var(--muted); font-size: 11px;
    }
    .model-load-state span { display: grid; gap: 2px; }
    .model-load-state small { font-size: 10px; }
    .model-load-state--error { border-color: var(--warn); color: var(--text); }

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
    .stable-identity-note { display: flex; align-items: flex-start; gap: 8px; margin: -2px 0 12px; padding: 9px 10px; border: 1px solid var(--rose-line); border-radius: 10px; background: var(--rose-soft); }
    .stable-identity-note > span { flex: none; font-size: 13px; }
    .stable-identity-note p { color: var(--muted); font-size: 10.5px; line-height: 1.45; }
    .stable-identity-note b { color: var(--ink-2); }
    .field .input[readonly] { background: var(--surface-2); color: var(--muted); cursor: not-allowed; }
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
    .readiness__head { display: grid; gap: 2px; margin-bottom: 6px; }
    .readiness__head small { color: var(--muted); font-size: 10.5px; line-height: 1.4; }
    .readiness--ok { background: var(--ok-soft, #eaf5ee); color: var(--ok, #2e7d4f); border-color: transparent; }
    .translations-row {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      margin-top: 12px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px;
    }
    .translations-row small { display: block; color: var(--muted); font-size: 12px; margin-top: 2px; }
    .more-channels { margin-top: 12px; }
    .more-channels summary { cursor: pointer; font-size: 12.5px; color: var(--muted); padding: 6px 0; }
    .select--status {
      width: auto; min-height: 34px; padding: 4px 30px 4px 12px; font-size: 13px; font-weight: 650;
      background-color: var(--ok-soft, #eaf5ee); color: var(--ok, #2e7d4f); border-color: transparent; border-radius: 999px;
    }
    .select--status-off { background-color: var(--surface-2); color: var(--muted); }
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

    @media (min-width: 680px) {
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
      .model-publication {
        grid-template-columns: minmax(0, 1fr);
        align-items: start;
      }
      .model-empty { grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
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
    @media (min-width: 680px) {
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
  readonly desktop = inject(DesktopViewport);

  readonly product = input.required<Product>();
  readonly family = input<ProductFamily | null>(null);
  readonly categories = input<Category[]>([]);
  readonly busy = input(false);
  readonly familyLoading = input(false);
  readonly familyLoadError = input(false);

  readonly productChange = output<Product>();
  readonly familyChange = output<ProductFamily>();
  readonly createFamilyRequested = output<void>();
  readonly retryFamilyRequested = output<void>();
  readonly imageUploadRequested = output<File>();
  readonly imageDeleteRequested = output<number>();
  readonly imageVariantChangeRequested = output<ProductFamilyImageVariantChange>();
  readonly translationsSaved = output<ProductPublicTranslationsSnapshot>();

  readonly translationDirtyChange = output<boolean>();
  readonly translationSavingChange = output<boolean>();

  readonly language = signal<LanguageCode>('EN');

  /** The family's blockers in plain words, variant keys replaced by names. */
  readonly readableIssues = computed(() => {
    const family = this.family();
    if (!family) return [];
    const names = new Map<string, string>();
    for (const member of family.members ?? []) {
      const key = member.canonicalVariantKey || String(member.productId);
      names.set(key, [member.colour, member.size].filter(Boolean).join(' · ') || member.name || key);
    }
    return describePublicationIssues(family.publicationIssues, names);
  });
  readonly translationDirtyState = signal(false);
  readonly legacyFamilyKey = computed(() =>
    this.product().familyId === null && !!this.product().familyKey?.trim());

  readonly familyLabel = computed(() => {
    if (this.familyLoading()) return 'Gedeelde websitegegevens laden…';
    if (this.familyLoadError()) return 'Gedeelde websitegegevens niet geladen';
    const family = this.family();
    if (!family) return 'Apart gehouden van je dagelijkse productwerk';
    return `${family.name || family.familyKey} · ${family.variantCount} product(en)`;
  });

  readonly websiteStatus = computed<PublicationStatus>(
    () => this.family()?.websiteStatus ?? 'DRAFT',
  );
  readonly orderAppStatus = computed<PublicationStatus>(
    () => this.family()?.orderAppStatus ?? 'DRAFT',
  );
  readonly catalogueStatus = computed<PublicationStatus>(
    () => this.family()?.catalogueStatus ?? 'DRAFT',
  );
  readonly issueCount = computed(
    () => (this.family()?.publicationIssues ?? []).length,
  );
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

  visiblePublicationStatus(status: PublicationStatus): 'DRAFT' | 'PUBLISHED' {
    return status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT';
  }

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

  requestFamilyCreation(): void {
    if (this.busy()) return;
    this.createFamilyRequested.emit();
  }

  retryFamily(): void {
    if (!this.busy()) this.retryFamilyRequested.emit();
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

  setTranslationDirty(dirty: boolean): void {
    this.translationDirtyState.set(dirty);
    this.translationDirtyChange.emit(dirty);
  }

  patch(changes: Partial<ProductFamily>): void {
    if (this.busy()) return;
    const family = this.family();
    if (!family) return;
    this.familyChange.emit({ ...family, ...changes });
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

}
