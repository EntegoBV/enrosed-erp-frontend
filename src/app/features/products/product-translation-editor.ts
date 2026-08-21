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
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import {
  LanguageCode,
  Product,
  ProductFamily,
  ProductFamilyImage,
  ProductFamilyText,
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
  imports: [FormsModule],
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
              <span>{{ option.code }}</span>
              <small>{{ option.gaps ? option.gaps : '✓' }}</small>
            </button>
          }
        </div>

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
                <h4 id="variant-translation-title">{{ familyDraft() ? 'Deze kleur of maat' : 'Dit product' }}</h4>
                <p>{{ familyDraft() ? 'Alleen voor ' + variantLabel() + '.' : 'Tekst voor dit losse product.' }}</p>
              </div>
              <span>{{ familyDraft() ? 'Variant' : 'Product' }}</span>
            </div>
            <div class="form-grid">
              <label class="field">
                <span>{{ familyDraft() ? 'Variantnaam' : 'Productnaam' }}</span>
                <input class="input" [ngModel]="variantText().name"
                       (ngModelChange)="patchVariant({ name: $event })" />
              </label>
              <label class="field">
                <span>Kleur</span>
                <input class="input" [ngModel]="variantText().colour"
                       (ngModelChange)="patchVariant({ colour: $event })" />
              </label>
              <label class="field">
                <span>Maat</span>
                <input class="input" [ngModel]="variantText().variantSize"
                       (ngModelChange)="patchVariant({ variantSize: $event })" />
                <small class="field__hint">Vertaal woorden zoals Small of Large; codes zoals S en XL mogen gelijk blijven.</small>
              </label>
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
                  <img [src]="image.smallUrl || image.largeUrl" alt="" />
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
    .translations__head h3 { font-size: 13.5px; }
    .translations__head p, .translation-group__head p {
      margin-top: 2px; color: var(--muted); font-size: 10.5px; line-height: 1.4;
    }
    .completion-badge {
      flex: none; padding: 5px 8px; border: 1px solid var(--warn); border-radius: 999px;
      background: var(--warn-soft); color: var(--ink-2); font-size: 9.5px; font-weight: 750;
    }
    .completion-badge--done { border-color: var(--ok); background: var(--ok-soft); color: var(--ok); }
    .editor-state {
      min-height: 64px; align-items: center; margin-top: 12px; padding: 11px;
      border-radius: var(--r-sm); background: var(--surface-2); color: var(--muted); font-size: 10.5px;
    }
    .editor-state > div { display: grid; gap: 2px; }
    .editor-state small { font-size: 9px; }
    .editor-state--error { background: var(--danger-soft); color: var(--danger); }
    .language-tabs {
      display: grid; grid-template-columns: repeat(8, minmax(52px, 1fr)); gap: 5px;
      margin-top: 12px; overflow-x: auto; padding-bottom: 3px; scrollbar-width: thin;
    }
    .language-tabs button {
      display: flex; min-width: 52px; min-height: 44px; align-items: center; justify-content: center;
      gap: 5px; padding: 6px; border: 1px solid var(--line); border-radius: 9px;
      background: var(--surface-2); color: var(--ink-2); cursor: pointer;
    }
    .language-tabs button span { font-size: 10.5px; font-weight: 800; }
    .language-tabs button small {
      display: grid; min-width: 17px; height: 17px; place-items: center; padding-inline: 3px;
      border-radius: 999px; background: var(--warn-soft); color: var(--warn); font-size: 8.5px;
    }
    .language-tabs button.complete small { background: var(--ok-soft); color: var(--ok); }
    .language-tabs button.active {
      border-color: var(--rose); background: var(--rose-soft); color: var(--rose-dark);
      box-shadow: inset 0 0 0 1px var(--rose);
    }
    .translation-fields { min-inline-size: 0; margin: 12px 0 0; padding: 0; border: 0; }
    .language-state {
      align-items: center; padding: 10px 11px; border: 1px solid var(--warn);
      border-radius: var(--r-sm); background: var(--warn-soft);
    }
    .language-state--complete { border-color: var(--ok); background: var(--ok-soft); }
    .language-state > div:first-child { display: grid; gap: 1px; }
    .language-state b { font-size: 11.5px; }
    .language-state small { color: var(--muted); font-size: 9.5px; }
    .language-state__check { color: var(--ok); font-size: 16px; font-weight: 800; }
    .missing-fields { display: flex; max-width: 64%; flex-wrap: wrap; justify-content: flex-end; gap: 4px; }
    .missing-fields span {
      padding: 4px 6px; border-radius: 999px; background: rgb(255 255 255 / 72%);
      color: var(--ink-2); font-size: 8.5px; font-weight: 650;
    }
    .translation-group { padding: 16px 0; border-bottom: 1px solid var(--line); }
    .translation-group__head { margin-bottom: 11px; }
    .translation-group__head h4 { font-size: 12.5px; }
    .translation-group__head > span {
      flex: none; color: var(--muted); font-size: 9px; font-weight: 750;
      letter-spacing: .07em; text-transform: uppercase;
    }
    .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .field { display: flex; min-width: 0; flex-direction: column; gap: 5px; }
    .field > span { color: var(--ink-2); font-size: 12px; font-weight: 650; }
    .field__hint { color: var(--muted); font-size: 10.5px; line-height: 1.35; }
    .span-2 { grid-column: 1 / -1; }
    .photo-alt-list { display: grid; gap: 6px; }
    .photo-alt-row {
      display: grid; grid-template-columns: 46px minmax(90px, .28fr) minmax(0, 1fr);
      align-items: center; gap: 9px; padding: 7px; border: 1px solid var(--line);
      border-radius: 9px; background: var(--surface-2);
    }
    .photo-alt-row img { width: 46px; height: 46px; border-radius: 7px; object-fit: cover; }
    .photo-alt-row > span { display: grid; gap: 1px; }
    .photo-alt-row b { font-size: 10px; }
    .photo-alt-row small, .empty-photos { color: var(--muted); font-size: 8.5px; }
    .empty-photos { padding: 10px 0; }
    .conflict, .save-error {
      margin-top: 10px; padding: 9px 10px; border-radius: 9px;
      background: var(--danger-soft); color: var(--danger); font-size: 10px;
    }
    .conflict { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .conflict > div { display: grid; gap: 1px; }
    .conflict small { font-size: 9px; }
    .translation-actions { display: flex; align-items: center; gap: 6px; margin-top: 11px; }
    .translation-actions > span { margin-right: auto; color: var(--muted); font-size: 9px; }
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
  readonly highlightsText = computed(() => this.sharedText().highlights.join('\n'));
  readonly gaps = computed(() => {
    const family = this.familyDraft();
    const product = this.productDraft();
    return product ? translationGaps(family, product, this.language()) : [];
  });
  readonly languageStates = computed(() => this.languages.map((option) => {
    const family = this.familyDraft();
    const product = this.productDraft();
    return { ...option, gaps: product
      ? translationGaps(family, product, option.code).length : 0 };
  }));
  readonly completeCount = computed(() =>
    this.languageStates().filter((state) => state.gaps === 0).length);
  readonly languageLabel = computed(() =>
    this.languages.find((item) => item.code === this.language())?.label ?? this.language());
  readonly variantLabel = computed(() => {
    const product = this.productDraft() ?? this.product();
    return [product.colour || 'zonder kleur', product.variantSize].filter(Boolean).join(' · ');
  });
  readonly images = computed(() => [...(this.familyDraft()?.images ?? [])]
    .sort((left, right) => left.position - right.position));
  readonly dirty = computed(() => {
    const snapshot = this.snapshot();
    const draft = this.writeBody();
    return !!snapshot && !!draft
      && JSON.stringify(this.canonicalWrite(draft))
        !== JSON.stringify(this.canonicalWrite(this.snapshotWrite(snapshot)));
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
    this.snapshot.set(structuredClone(snapshot));
    this.familyDraft.set(family);
    this.productDraft.set(product);
    this.resetSaveState();
  }

  private writeBody(): ProductPublicTranslationsWrite | null {
    const snapshot = this.snapshot();
    const family = this.familyDraft();
    const product = this.productDraft();
    if (!snapshot || !product) return null;
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
    };
  }

  private snapshotWrite(snapshot: ProductPublicTranslationsSnapshot): ProductPublicTranslationsWrite {
    return {
      revision: snapshot.revision,
      familyId: snapshot.familyId,
      familyTexts: structuredClone(snapshot.familyTexts),
      productTexts: structuredClone(snapshot.productTexts),
      images: structuredClone(snapshot.images),
    };
  }

  private canonicalWrite(write: ProductPublicTranslationsWrite): ProductPublicTranslationsWrite {
    return {
      ...write,
      familyTexts: [...write.familyTexts].sort((a, b) => a.language.localeCompare(b.language)),
      productTexts: [...write.productTexts].sort((a, b) => a.language.localeCompare(b.language)),
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
    this.familyDraft.set(null);
    this.productDraft.set(null);
    this.loading.set(false);
    this.loadError.set(null);
    this.resetSaveState();
  }
}
