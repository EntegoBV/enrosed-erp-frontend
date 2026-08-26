import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthImage } from '../../core/api/auth-image';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import {
  LanguageCode,
  Product,
  ProductFamily,
  ProductFamilyImage,
  ProductFamilyText,
  ProductPublicCopy,
  ProductPublicNameText,
  ProductPublicTranslationsSnapshot,
  ProductPublicTranslationsWrite,
  ProductText,
} from '../../core/api/models';
import { Ui } from '../../shared/ui';
import {
  TRANSLATION_LANGUAGES,
  blankFamilyText,
  blankProductText,
  familyText,
  productText,
  translationGaps,
  upsertFamilyText,
  upsertProductText,
} from './product-translation-adapter';

@Component({
  selector: 'app-product-translation-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthImage, FormsModule],
  template: `
    @if (visible()) {
    <section class="translations" aria-labelledby="product-translations-title"
             [attr.aria-busy]="loading() || effectiveBusy()">
      <div class="translations__head">
        <div>
          <h3 id="product-translations-title">Vertalingen</h3>
          <p>{{ familyDraft()
            ? 'Gedeelde producttekst, deze variant en fototeksten worden samen opgeslagen.'
            : 'Klantgerichte teksten voor dit losse product worden samen opgeslagen.' }}</p>
        </div>
        @if (snapshot()) {
          <span class="completion-badge" [class.completion-badge--done]="completeCount() === languages.length">
            {{ completeCount() }}/{{ languages.length }} compleet
          </span>
        }
      </div>

      @if (!canLoad()) {
        <div class="editor-state">
          @if (product().id === null) {
            Sla het product eerst op. Daarna kun je ook een los product vertalen.
          } @else {
            Sla de nieuwe productkoppeling eerst op. Daarna worden alle vertalingen veilig samen bewaard.
          }
        </div>
      } @else if (loading()) {
        <div class="editor-state" role="status">Vertalingen laden…</div>
      } @else if (loadError()) {
        <div class="editor-state editor-state--error" role="alert">
          <div><b>Vertalingen niet geladen</b><small>{{ loadError() }}</small></div>
          <button class="btn btn--sm" type="button" [disabled]="loading()" (click)="reload()">
            Opnieuw proberen
          </button>
        </div>
      } @else if (snapshot()) {
        <div class="language-tabs" role="tablist" aria-label="Taal bewerken"
             (keydown)="languageKeydown($event)">
          @for (option of languageStates(); track option.code) {
            <button type="button" role="tab"
                    [id]="'translation-tab-' + option.code"
                    [attr.aria-controls]="'translation-panel-' + option.code"
                    [attr.aria-selected]="language() === option.code"
                    [class.active]="language() === option.code"
                    [class.complete]="!option.gaps"
                    [disabled]="effectiveBusy()"
                    (click)="selectLanguage(option.code)">
              <span>{{ option.label }}</span>
              <small>{{ option.gaps ? option.gaps + ' mist' : 'Compleet' }}</small>
            </button>
          }
        </div>
        <label class="mobile-language-picker">
          <span>Taal kiezen</span>
          <select class="select" [ngModel]="language()" [disabled]="effectiveBusy()"
                  (ngModelChange)="selectLanguage($any($event))">
            @for (option of languageStates(); track option.code) {
              <option [ngValue]="option.code">
                {{ option.label }} — {{ option.gaps ? option.gaps + ' ontbreekt' : 'compleet' }}
              </option>
            }
          </select>
        </label>

        <fieldset class="translation-fields" [disabled]="effectiveBusy()"
                  role="tabpanel"
                  [id]="'translation-panel-' + language()"
                  [attr.aria-labelledby]="'translation-tab-' + language()">
          <legend class="sr-only">{{ languageLabel() }} vertaling</legend>

          <div class="language-state" [class.language-state--complete]="!gaps().length">
            <div>
              <b>{{ languageLabel() }}</b>
              <small>{{ gaps().length ? gaps().length + ' veld(en) ontbreken' : 'Alle gebruikte teksten zijn ingevuld' }}</small>
            </div>
            @if (gaps().length) {
              <div class="missing-fields" aria-label="Ontbrekende vertalingen">
                @for (gap of gaps(); track gap.key) {
                  <span [attr.data-area]="gap.area">{{ gap.label }}</span>
                }
              </div>
            } @else {
              <span class="language-state__check" aria-hidden="true">✓</span>
            }
          </div>
          @if (nextIncompleteLanguage(); as nextLanguage) {
            <button class="next-language" type="button" [disabled]="effectiveBusy()"
                    (click)="selectLanguage(nextLanguage.code)">
              Volgende taal met ontbrekende velden: <b>{{ nextLanguage.label }}</b>
              <span aria-hidden="true">›</span>
            </button>
          }

          <section class="translation-group public-name-group" aria-labelledby="public-name-title">
            <div class="translation-group__head">
              <div>
                <h4 id="public-name-title">Naam op de website</h4>
                <p>De publieke naam mag vriendelijker zijn dan de interne productnaam.</p>
              </div>
              <span>Website</span>
            </div>
            <div class="public-name-grid">
              <div class="internal-name-card">
                <span>Interne productnaam</span>
                <b>{{ (productDraft() ?? product()).name }}</b>
                <small>Blijft ongewijzigd voor administratie, voorraad en documenten.</small>
              </div>
              <label class="field public-name-field">
                <span>Publieke naam in {{ languageLabel() }}</span>
                <input class="input" maxlength="255" [ngModel]="publicName()"
                       [placeholder]="(productDraft() ?? product()).name"
                       (ngModelChange)="patchPublicName($event)" />
                <small class="field__hint">Dit is de naam die bezoekers op de website zien.</small>
              </label>
            </div>
          </section>

          @if (familyDraft()) {
          <section class="translation-group" aria-labelledby="shared-translation-title">
            <div class="translation-group__head">
              <div>
                <h4 id="shared-translation-title">Gedeelde producttekst</h4>
                <p>Wordt gebruikt voor alle gekoppelde kleuren en maten.</p>
              </div>
              <span>Productreeks</span>
            </div>
            <div class="form-grid">
              <label class="field span-2">
                <span>Naam voor klanten</span>
                <input class="input" [ngModel]="sharedText().name"
                       (ngModelChange)="patchFamily({ name: $event })" />
              </label>
              <label class="field span-2">
                <span>Korte samenvatting</span>
                <textarea class="textarea" rows="2" maxlength="240"
                          [ngModel]="sharedText().summary"
                          (ngModelChange)="patchFamily({ summary: $event })"></textarea>
                <small class="field__hint">Voor productkaarten en de intro van de detailpagina.</small>
              </label>
              <label class="field span-2">
                <span>Beschrijving</span>
                <textarea class="textarea" rows="5" [ngModel]="sharedText().description"
                          (ngModelChange)="patchFamily({ description: $event })"></textarea>
              </label>
              <label class="field">
                <span>Formaat</span>
                <input class="input" [ngModel]="sharedText().format"
                       (ngModelChange)="patchFamily({ format: $event })" />
              </label>
              <label class="field">
                <span>Highlights</span>
                <textarea class="textarea" rows="3" [ngModel]="highlightsText()"
                          (ngModelChange)="patchHighlights($event)"
                          placeholder="Eén voordeel per regel"></textarea>
              </label>
            </div>
          </section>
          }

          <section class="translation-group" aria-labelledby="variant-translation-title">
            <div class="translation-group__head">
              <div>
                <h4 id="variant-translation-title">
                  {{ familyDraft() ? 'Deze variant: ' + variantLabel() : 'Dit product' }}
                </h4>
                <p>
                  {{ familyDraft()
                    ? 'Teksten die alleen voor deze kleur en maat gelden; de familieteksten hierboven deelt ze met de andere varianten.'
                    : 'Tekst voor dit losse product.' }}
                </p>
              </div>
              <span>{{ language() }}</span>
            </div>
            <div class="form-grid">
              <label class="field">
                <span>{{ familyDraft() ? 'Documentnaam variant in ' + language() : 'Documentnaam in ' + language() }}</span>
                <input class="input" [ngModel]="variantText().name"
                       [placeholder]="(productDraft() ?? product()).name"
                       (ngModelChange)="patchVariant({ name: $event })" />
                <small class="field__hint">Voor offertes en klantdocumenten. De websitenaam staat hierboven apart.</small>
              </label>
              @if ((productDraft() ?? product()).colour) {
                <label class="field">
                  <span>Kleur "{{ (productDraft() ?? product()).colour }}" in {{ language() }}</span>
                  <input class="input" [ngModel]="variantText().colour"
                         [placeholder]="(productDraft() ?? product()).colour ?? ''"
                         (ngModelChange)="patchVariant({ colour: $event })" />
                  <small class="field__hint">Het woord zoals de klant het leest, bv. Rood → Rouge.</small>
                </label>
              }
              @if ((productDraft() ?? product()).variantSize) {
                <label class="field">
                  <span>Maat "{{ (productDraft() ?? product()).variantSize }}" in {{ language() }}</span>
                  <input class="input" [ngModel]="variantText().variantSize"
                         [placeholder]="(productDraft() ?? product()).variantSize ?? ''"
                         (ngModelChange)="patchVariant({ variantSize: $event })" />
                  <small class="field__hint">Woorden vertalen (Small → Klein); codes en afmetingen zoals S of 12x25 blijven gelijk.</small>
                </label>
              }
              <label class="field span-2">
                <span>{{ familyDraft() ? 'Variantbeschrijving' : 'Productbeschrijving' }}</span>
                <textarea class="textarea" rows="3" [ngModel]="variantText().description"
                          (ngModelChange)="patchVariant({ description: $event })"></textarea>
              </label>
            </div>
          </section>

          @if (familyDraft()) {
          <section class="translation-group" aria-labelledby="seo-translation-title">
            <div class="translation-group__head">
              <div>
                <h4 id="seo-translation-title">Zoekresultaat</h4>
                <p>Valt in dezelfde taal terug op naam en samenvatting of beschrijving.</p>
              </div>
              <span>SEO</span>
            </div>
            <div class="form-grid">
              <label class="field span-2">
                <span>SEO-titel</span>
                <input class="input" maxlength="70" [ngModel]="sharedText().seoTitle"
                       (ngModelChange)="patchFamily({ seoTitle: $event })" />
              </label>
              <label class="field span-2">
                <span>SEO-beschrijving</span>
                <textarea class="textarea" rows="3" maxlength="170"
                          [ngModel]="sharedText().seoDescription"
                          (ngModelChange)="patchFamily({ seoDescription: $event })"></textarea>
              </label>
            </div>
          </section>

          <section class="translation-group" aria-labelledby="photo-translation-title">
            <div class="translation-group__head">
              <div>
                <h4 id="photo-translation-title">Fototeksten</h4>
                <p>Korte, concrete beschrijving voor toegankelijkheid en zoekmachines.</p>
              </div>
              <span>Galerij</span>
            </div>
            <div class="photo-alt-list">
              @for (image of images(); track image.id; let index = $index) {
                <label class="photo-alt-row">
                  <img [appAuthSrc]="image.smallUrl || image.largeUrl" alt="" />
                  <span><b>Foto {{ index + 1 }}</b><small>{{ languageLabel() }}</small></span>
                  <input class="input" [ngModel]="imageAlt(image)"
                         (ngModelChange)="patchImageAlt(image.id, $event)"
                         [placeholder]="'Beschrijf foto ' + (index + 1)" />
                </label>
              } @empty {
                <p class="empty-photos">Voeg eerst foto’s toe aan de websitegalerij.</p>
              }
            </div>
          </section>
          }
        </fieldset>

        @if (conflict()) {
          <div class="conflict" role="alert">
            <div><b>Nieuwere versie beschikbaar</b><small>{{ saveError() }}</small></div>
            <button class="btn btn--sm" type="button" [disabled]="saving()" (click)="reload()">
              Laatste versie laden
            </button>
          </div>
        } @else if (saveError()) {
          <div class="save-error" role="alert">{{ saveError() }}</div>
        }

        <div class="translation-actions">
          <span aria-live="polite">{{ dirty() ? 'Wijzigingen nog niet opgeslagen' : 'Vertalingen bijgewerkt' }}</span>
          <button class="btn btn--sm" type="button" [disabled]="!dirty() || effectiveBusy()"
                  (click)="revert()">Wijzigingen wissen</button>
          <button class="btn btn--sm btn--primary" type="button"
                  [disabled]="!dirty() || effectiveBusy()" (click)="save()">
            {{ saving() ? 'Opslaan…' : 'Vertalingen opslaan' }}
          </button>
        </div>
      }
    </section>
    }
  `,
  styles: `
    :host { display: block; border-bottom: 1px solid var(--line); }
    .translations { padding: 18px 0; }
    .translations__head, .translation-group__head, .language-state, .editor-state {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
    }
    .translations__head h3 { font-size: 17px; }
    .translations__head p, .translation-group__head p {
      margin-top: 3px; color: var(--muted); font-size: 13px; line-height: 1.45;
    }
    .completion-badge {
      flex: none; padding: 5px 8px; border: 1px solid var(--warn); border-radius: 999px;
      background: var(--warn-soft); color: var(--ink-2); font-size: 13px; font-weight: 750;
    }
    .completion-badge--done { border-color: var(--ok); background: var(--ok-soft); color: var(--ok); }
    .editor-state {
      min-height: 64px; align-items: center; margin-top: 12px; padding: 11px;
      border-radius: var(--r-sm); background: var(--surface-2); color: var(--muted); font-size: 14px;
    }
    .editor-state > div { display: grid; gap: 2px; }
    .editor-state small { font-size: 13px; }
    .editor-state--error { background: var(--danger-soft); color: var(--danger); }
    .language-tabs {
      display: grid; grid-template-columns: repeat(4, minmax(112px, 1fr)); gap: 7px;
      margin-top: 12px; overflow-x: auto; padding-bottom: 3px; scrollbar-width: thin;
    }
    .language-tabs button {
      display: grid; min-width: 112px; min-height: 56px; align-content: center; justify-items: start;
      gap: 2px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px;
      background: var(--surface-2); color: var(--ink-2); cursor: pointer;
    }
    .language-tabs button span { font-size: 14px; font-weight: 750; }
    .language-tabs button small {
      color: var(--warn); font-size: 12px; font-weight: 650;
    }
    .language-tabs button.complete small { color: var(--ok); }
    .language-tabs button.active {
      border-color: var(--rose); background: var(--rose-soft); color: var(--rose-dark);
      box-shadow: inset 0 0 0 1px var(--rose);
    }
    .translation-fields { min-inline-size: 0; margin: 12px 0 0; padding: 0; border: 0; }
    .mobile-language-picker { display: none; }
    .language-state {
      align-items: center; padding: 10px 11px; border: 1px solid var(--warn);
      border-radius: var(--r-sm); background: var(--warn-soft);
    }
    .language-state--complete { border-color: var(--ok); background: var(--ok-soft); }
    .language-state > div:first-child { display: grid; gap: 1px; }
    .language-state b { font-size: 15px; }
    .language-state small { color: var(--muted); font-size: 13px; }
    .language-state__check { color: var(--ok); font-size: 16px; font-weight: 800; }
    .missing-fields { display: flex; max-width: 64%; flex-wrap: wrap; justify-content: flex-end; gap: 4px; }
    .missing-fields span {
      padding: 4px 6px; border-radius: 999px; background: rgb(255 255 255 / 72%);
      color: var(--ink-2); font-size: 12px; font-weight: 650;
    }
    .next-language { display: flex; width: 100%; min-height: 48px; align-items: center; justify-content: flex-start; gap: 5px; margin-top: 8px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink-2); font-size: 13px; cursor: pointer; }
    .next-language span { margin-left: auto; color: var(--rose-dark); font-size: 21px; }
    .translation-group { padding: 16px 0; border-bottom: 1px solid var(--line); }
    .translation-group__head { margin-bottom: 11px; }
    .translation-group__head h4 { font-size: 16px; }
    .translation-group__head > span {
      flex: none; color: var(--muted); font-size: 12px; font-weight: 750;
      letter-spacing: .07em; text-transform: uppercase;
    }
    .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .field { display: flex; min-width: 0; flex-direction: column; gap: 5px; }
    .field > span { color: var(--ink-2); font-size: 14px; font-weight: 650; }
    .field__hint { color: var(--muted); font-size: 13px; line-height: 1.4; }
    .public-name-group { border: 1px solid var(--rose); border-radius: var(--r-sm); margin-top: 14px; padding: 15px; background: var(--rose-soft); }
    .public-name-grid { display: grid; grid-template-columns: minmax(0, .85fr) minmax(0, 1.15fr); align-items: stretch; gap: 12px; }
    .internal-name-card { display: grid; align-content: center; gap: 4px; min-height: 92px; padding: 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); }
    .internal-name-card > span { color: var(--muted); font-size: 12px; font-weight: 750; letter-spacing: .04em; text-transform: uppercase; }
    .internal-name-card b { overflow-wrap: anywhere; color: var(--ink-2); font-size: 15px; }
    .internal-name-card small { color: var(--muted); font-size: 13px; line-height: 1.4; }
    .public-name-field { justify-content: center; }
    .span-2 { grid-column: 1 / -1; }
    .photo-alt-list { display: grid; gap: 6px; }
    .photo-alt-row {
      display: grid; grid-template-columns: 46px minmax(90px, .28fr) minmax(0, 1fr);
      align-items: center; gap: 9px; padding: 7px; border: 1px solid var(--line);
      border-radius: 9px; background: var(--surface-2);
    }
    .photo-alt-row img { width: 46px; height: 46px; border-radius: 7px; object-fit: cover; }
    .photo-alt-row > span { display: grid; gap: 1px; }
    .photo-alt-row b { font-size: 13px; }
    .photo-alt-row small, .empty-photos { color: var(--muted); font-size: 12px; }
    .empty-photos { padding: 10px 0; }
    .conflict, .save-error {
      margin-top: 10px; padding: 9px 10px; border-radius: 9px;
      background: var(--danger-soft); color: var(--danger); font-size: 13px;
    }
    .conflict { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .conflict > div { display: grid; gap: 1px; }
    .conflict small { font-size: 12px; }
    .translation-actions { display: flex; align-items: center; gap: 6px; margin-top: 11px; }
    .translation-actions > span { margin-right: auto; color: var(--muted); font-size: 13px; }
    .translations .btn { min-height: 48px; font-size: 14px; }
    .translations .input, .translations .select { min-height: 48px; }
    @media (max-width: 720px) {
      .language-tabs { display: none; }
      .mobile-language-picker { display: grid; gap: 6px; margin-top: 14px; }
      .mobile-language-picker > span { color: var(--ink-2); font-size: 14px; font-weight: 700; }
      .public-name-grid, .form-grid { grid-template-columns: 1fr; }
      .span-2 { grid-column: auto; }
      .public-name-group { padding: 13px; }
      .public-name-field .input { min-height: 48px; }
      .language-state { align-items: flex-start; flex-direction: column; }
      .missing-fields { max-width: 100%; justify-content: flex-start; }
      .photo-alt-row { grid-template-columns: 56px minmax(0, 1fr); }
      .photo-alt-row img { width: 56px; height: 56px; }
      .photo-alt-row .input { grid-column: 1 / -1; }
      .translation-actions { align-items: stretch; flex-direction: column; }
      .translation-actions > span { margin: 0 0 3px; }
      .translation-actions .btn { width: 100%; }
    }
  `,
})
export class ProductTranslationEditor {
  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);
  private readonly destroyRef = inject(DestroyRef);
  private loadVersion = 0;
  private loadedIdentity = '';

  readonly languages = TRANSLATION_LANGUAGES;
  readonly product = input.required<Product>();
  readonly family = input<ProductFamily | null>(null);
  readonly language = input.required<LanguageCode>();
  readonly busy = input(false);
  readonly visible = input(true);
  readonly saved = output<ProductPublicTranslationsSnapshot>();
  readonly languageChange = output<LanguageCode>();
  readonly dirtyChange = output<boolean>();
  readonly savingChange = output<boolean>();

  readonly snapshot = signal<ProductPublicTranslationsSnapshot | null>(null);
  readonly familyDraft = signal<ProductFamily | null>(null);
  readonly productDraft = signal<Product | null>(null);
  readonly publicCopyDraft = signal<ProductPublicCopy | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);
  readonly conflict = signal(false);

  readonly canLoad = computed(() => {
    const product = this.product();
    const family = this.family();
    return product.id !== null
      && (product.familyId === null ? family === null : family?.id === product.familyId);
  });
  readonly effectiveBusy = computed(() => this.busy() || this.saving());
  readonly sharedText = computed(() => {
    const family = this.familyDraft();
    return family ? familyText(family, this.language()) : blankFamilyText(this.language());
  });
  readonly variantText = computed(() => {
    const product = this.productDraft();
    return product ? productText(product, this.language()) : blankProductText(this.language());
  });
  readonly publicName = computed(() => {
    const copy = this.publicCopyDraft();
    if (!copy) return '';
    return copy.texts.find((text) => text.language === this.language())?.publicName
      ?? (this.language() === 'EN' ? copy.publicName : null)
      ?? '';
  });
  readonly highlightsText = computed(() => this.sharedText().highlights.join('\n'));
  readonly gaps = computed(() => {
    const family = this.familyDraft();
    const product = this.productDraft();
    return product
      ? translationGaps(family, product, this.language(), this.publicCopyDraft())
      : [];
  });
  readonly languageStates = computed(() => this.languages.map((option) => {
    const family = this.familyDraft();
    const product = this.productDraft();
    return { ...option, gaps: product
      ? translationGaps(family, product, option.code, this.publicCopyDraft()).length : 0 };
  }));
  readonly completeCount = computed(() =>
    this.languageStates().filter((state) => state.gaps === 0).length);
  readonly nextIncompleteLanguage = computed(() => {
    const states = this.languageStates();
    const currentIndex = states.findIndex((state) => state.code === this.language());
    for (let offset = 1; offset < states.length; offset += 1) {
      const candidate = states[(currentIndex + offset) % states.length];
      if (candidate.gaps > 0) return candidate;
    }
    return null;
  });
  readonly languageLabel = computed(() =>
    this.languages.find((item) => item.code === this.language())?.label ?? this.language());
  readonly variantLabel = computed(() => {
    const product = this.productDraft() ?? this.product();
    return [product.colour || 'zonder kleur', product.variantSize].filter(Boolean).join(' · ');
  });
  readonly images = computed(() => [...(this.familyDraft()?.images ?? [])]
    .sort((left, right) => left.position - right.position));
  /* Dirty means: different from what the form showed right after loading
     or saving. Comparing against the raw server snapshot instead flagged
     untouched families as changed whenever the draft carried images the
     snapshot's translated list did not (photos without alt texts). */
  private readonly baseline = signal<string | null>(null);
  readonly dirty = computed(() => {
    const draft = this.writeBody();
    const baseline = this.baseline();
    return !!draft && baseline !== null
      && JSON.stringify(this.canonicalWrite(draft)) !== baseline;
  });

  constructor() {
    effect(() => {
      if (!this.visible()) return;
      const product = this.product();
      const family = this.family();
      const productId = product.id;
      const familyId = product.familyId;
      const ready = productId !== null
        && (familyId === null ? family === null : family?.id === familyId);
      const identity = ready ? `${productId}:${familyId ?? 'standalone'}` : '';
      if (identity === this.loadedIdentity) return;
      this.loadedIdentity = identity;
      untracked(() => {
        if (!ready || productId === null) this.clear();
        else void this.load(productId, familyId);
      });
    });
    effect(() => this.dirtyChange.emit(this.dirty()));
    effect(() => this.savingChange.emit(this.saving()));
  }

  selectLanguage(language: LanguageCode): void {
    if (!this.effectiveBusy() && language !== this.language()) this.languageChange.emit(language);
  }

  languageKeydown(event: KeyboardEvent): void {
    if (this.effectiveBusy() || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const index = this.languages.findIndex((item) => item.code === this.language());
    const target = event.key === 'Home' ? 0 : event.key === 'End'
      ? this.languages.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + this.languages.length)
        % this.languages.length;
    event.preventDefault();
    this.languageChange.emit(this.languages[target].code);
    queueMicrotask(() => document.getElementById(
      `translation-tab-${this.languages[target].code}`)?.focus());
  }

  patchFamily(changes: Partial<ProductFamilyText>): void {
    if (this.effectiveBusy()) return;
    this.familyDraft.update((family) => family
      ? upsertFamilyText(family, this.language(), changes) : family);
    this.resetSaveState();
  }

  patchVariant(changes: Partial<ProductText>): void {
    if (this.effectiveBusy()) return;
    this.productDraft.update((product) => product
      ? upsertProductText(product, this.language(), changes) : product);
    this.resetSaveState();
  }

  patchPublicName(value: string): void {
    if (this.effectiveBusy()) return;
    const language = this.language();
    this.publicCopyDraft.update((copy) => {
      if (!copy) return copy;
      const next: ProductPublicNameText = { language, publicName: value || null };
      const texts = copy.texts.some((item) => item.language === language)
        ? copy.texts.map((item) => item.language === language ? next : item)
        : [...copy.texts, next];
      return {
        ...copy,
        publicName: language === 'EN' ? next.publicName : copy.publicName,
        texts,
      };
    });
    this.resetSaveState();
  }

  patchHighlights(value: string): void {
    this.patchFamily({
      highlights: value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
    });
  }

  imageAlt(image: ProductFamilyImage): string {
    return image.altTexts.find((item) => item.language === this.language())?.alt ?? '';
  }

  patchImageAlt(imageId: number, alt: string): void {
    if (this.effectiveBusy()) return;
    const language = this.language();
    this.familyDraft.update((family) => family ? {
      ...family,
      images: family.images.map((image) => {
        if (image.id !== imageId) return image;
        const next = { language, alt };
        const altTexts = image.altTexts.some((item) => item.language === language)
          ? image.altTexts.map((item) => item.language === language ? next : item)
          : [...image.altTexts, next];
        return { ...image, altTexts };
      }),
    } : family);
    this.resetSaveState();
  }

  async reload(): Promise<void> {
    const productId = this.product().id;
    const familyId = this.product().familyId;
    if (productId === null || !this.canLoad() || this.loading() || this.saving()) return;
    await this.load(productId, familyId);
  }

  revert(): void {
    const snapshot = this.snapshot();
    if (snapshot && !this.effectiveBusy()) this.applySnapshot(snapshot);
  }

  async save(): Promise<void> {
    const productId = this.product().id;
    const body = this.writeBody();
    if (productId === null || !body || !this.dirty() || this.effectiveBusy()) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.conflict.set(false);
    try {
      const saved = await this.catalog.updateProductPublicTranslations(productId, body);
      if (this.destroyRef.destroyed) return;
      this.applySnapshot(saved);
      this.saved.emit(saved);
      this.ui.toast('Productvertalingen opgeslagen');
    } catch (failure: unknown) {
      if (this.destroyRef.destroyed) return;
      const status = (failure as { status?: number }).status;
      this.conflict.set(status === 409);
      this.saveError.set(status === 409
        ? 'Deze vertalingen of foto’s zijn intussen gewijzigd. Laad de laatste versie en controleer je werk opnieuw.'
        : messageOf(failure, 'Productvertalingen opslaan mislukt.'));
    } finally {
      if (!this.destroyRef.destroyed) this.saving.set(false);
    }
  }

  private async load(productId: number, expectedFamilyId: number | null): Promise<void> {
    const version = ++this.loadVersion;
    this.loading.set(true);
    this.loadError.set(null);
    this.resetSaveState();
    try {
      const snapshot = await this.catalog.productPublicTranslations(productId);
      if (this.destroyRef.destroyed || version !== this.loadVersion) return;
      if (snapshot.familyId !== expectedFamilyId || snapshot.productId !== productId) {
        throw new Error('De productkoppeling is intussen gewijzigd. Vernieuw het product.');
      }
      this.applySnapshot(snapshot);
    } catch (failure: unknown) {
      if (!this.destroyRef.destroyed && version === this.loadVersion) {
        this.loadError.set(messageOf(failure, failure instanceof Error
          ? failure.message : 'Vertalingen konden niet worden geladen.'));
      }
    } finally {
      if (!this.destroyRef.destroyed && version === this.loadVersion) this.loading.set(false);
    }
  }

  private applySnapshot(snapshot: ProductPublicTranslationsSnapshot): void {
    const translatedImages = new Map(snapshot.images.map((image) => [image.imageId, image]));
    const family: ProductFamily | null = snapshot.family ? {
      ...structuredClone(snapshot.family),
      texts: structuredClone(snapshot.familyTexts),
      images: snapshot.family.images.map((image) => {
        const translated = translatedImages.get(image.id);
        return translated ? {
          ...image,
          position: translated.position,
          altTexts: structuredClone(translated.altTexts),
        } : image;
      }),
    } : null;
    const product: Product = {
      ...structuredClone(snapshot.product),
      texts: structuredClone(snapshot.productTexts),
    };
    const productPublicCopy: ProductPublicCopy = snapshot.productPublicCopy
      ? structuredClone(snapshot.productPublicCopy)
      : {
          publicName: product.name,
          texts: snapshot.productTexts
            .filter((text) => !!text.name?.trim())
            .map((text) => ({ language: text.language, publicName: text.name })),
        };
    this.snapshot.set(structuredClone(snapshot));
    this.familyDraft.set(family);
    this.productDraft.set(product);
    this.publicCopyDraft.set(productPublicCopy);
    const body = this.writeBody();
    this.baseline.set(body ? JSON.stringify(this.canonicalWrite(body)) : null);
    this.resetSaveState();
  }

  private writeBody(): ProductPublicTranslationsWrite | null {
    const snapshot = this.snapshot();
    const family = this.familyDraft();
    const product = this.productDraft();
    const productPublicCopy = this.publicCopyDraft();
    if (!snapshot || !product || !productPublicCopy) return null;
    return {
      revision: snapshot.revision,
      familyId: snapshot.familyId,
      familyTexts: family ? structuredClone(family.texts) : [],
      productTexts: structuredClone(product.texts),
      images: (family?.images ?? []).map((image) => ({
        imageId: image.id,
        position: image.position,
        altTexts: structuredClone(image.altTexts),
      })),
      productPublicCopy: structuredClone(productPublicCopy),
    };
  }

  private canonicalWrite(write: ProductPublicTranslationsWrite): ProductPublicTranslationsWrite {
    return {
      ...write,
      familyTexts: [...write.familyTexts].sort((a, b) => a.language.localeCompare(b.language)),
      productTexts: [...write.productTexts].sort((a, b) => a.language.localeCompare(b.language)),
      productPublicCopy: write.productPublicCopy ? {
        ...write.productPublicCopy,
        texts: [...write.productPublicCopy.texts]
          .sort((a, b) => a.language.localeCompare(b.language)),
      } : write.productPublicCopy,
      images: [...write.images]
        .sort((a, b) => a.position - b.position || a.imageId - b.imageId)
        .map((image) => ({ ...image, altTexts: [...image.altTexts]
          .sort((a, b) => a.language.localeCompare(b.language)) })),
    };
  }

  private resetSaveState(): void {
    this.saveError.set(null);
    this.conflict.set(false);
  }

  private clear(): void {
    ++this.loadVersion;
    this.snapshot.set(null);
    this.baseline.set(null);
    this.familyDraft.set(null);
    this.productDraft.set(null);
    this.publicCopyDraft.set(null);
    this.loading.set(false);
    this.loadError.set(null);
    this.resetSaveState();
  }
}
