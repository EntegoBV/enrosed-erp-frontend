import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  CatalogApi,
  CatalogExportRequest,
  CatalogLayout,
} from '../../core/api/catalog-api';
import { saveBlob } from '../../core/api/download';
import { messageOf } from '../../core/api/errors';
import { Category, LANGUAGES, LanguageCode, Product } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Ui } from '../../shared/ui';
import {
  CatalogBrochureDraft,
  CatalogBrochureSettings,
} from './catalog-brochure-settings';
import { CatalogProductSelection } from './catalog-product-selection';

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
  photosPerProduct: 2,
  coverTitle: '',
  coverSubtitle: '',
  includeOverview: true,
  includeCategoryIntros: false,
  includeCustomisation: false,
  includeOrdering: true,
  includeBackCover: false,
};

@Component({
  selector: 'app-catalog-export',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CatalogBrochureSettings,
    CatalogProductSelection,
    FormsModule,
    PageHeader,
    RouterLink,
  ],
  template: `
    <app-page-header
      title="Handelscatalogus maken"
      [subtitle]="selected().size + ' van ' + products().length + ' producten opgenomen'"
      [showBack]="true"
      [showBell]="false"
    />

    <div class="content content--with-action-bar catalog-page"
         [attr.aria-busy]="busy() || loading()">
      <fieldset class="catalog-workspace" [disabled]="busy()">
        <legend class="sr-only">Catalogus samenstellen</legend>

        <div class="catalog-settings">
          <section class="card mode-card" aria-labelledby="catalog-mode-title">
            <div class="card__head">
              <div>
                <h2 id="catalog-mode-title">Kies het document</h2>
                <p>De handelscatalogus is de aanbevolen versie voor klanten en inkopers.</p>
              </div>
            </div>
            <div class="card__body">
              <div class="mode-choice" role="group" aria-label="Soort catalogus">
                <button type="button" [class.active]="layout() === 'BROCHURE'"
                        [attr.aria-pressed]="layout() === 'BROCHURE'"
                        (click)="layout.set('BROCHURE')">
                  <span aria-hidden="true">▤</span>
                  <b>B2B-handelscatalogus</b>
                  <small>Cover, productoverzicht, details en bestellen</small>
                  <i>Aanbevolen</i>
                </button>
                <button type="button" [class.active]="layout() === 'SIMPLE'"
                        [attr.aria-pressed]="layout() === 'SIMPLE'"
                        (click)="layout.set('SIMPLE')">
                  <span aria-hidden="true">▦</span>
                  <b>Compacte prijslijst</b>
                  <small>Een snelle SKU-lijst zonder uitgebreide productpagina’s</small>
                </button>
              </div>
            </div>
          </section>

          <section class="card" aria-labelledby="catalog-content-title">
            <div class="card__head">
              <div>
                <h2 id="catalog-content-title">Taal en prijzen</h2>
                <p>Productgegevens en prijzen komen rechtstreeks uit het dashboard.</p>
              </div>
            </div>
            <div class="card__body">
              <div class="option-grid">
                <label class="field option-grid__language">
                  <span>Taal</span>
                  <select class="select" [ngModel]="language()"
                          (ngModelChange)="language.set($event)">
                    @for (option of languages; track option.code) {
                      <option [value]="option.code">{{ option.label }}</option>
                    }
                  </select>
                </label>

                <label class="option-toggle">
                  <input type="checkbox" [ngModel]="includePrices()"
                         (ngModelChange)="includePrices.set($event)" />
                  <span><b>Referentieprijzen</b><small>Per stuk, exclusief btw en levering</small></span>
                </label>
                <label class="option-toggle">
                  <input type="checkbox" [ngModel]="includePhotos()"
                         (ngModelChange)="includePhotos.set($event)" />
                  <span><b>Productfoto’s</b><small>Foto’s uit de productmaster</small></span>
                </label>
              </div>

              <label class="field intro-field">
                <span>Korte inleiding <small>optioneel</small></span>
                <textarea class="textarea" rows="3" [ngModel]="intro()"
                          (ngModelChange)="intro.set($event)"
                          placeholder="Bijvoorbeeld: samengesteld voor uw winkel of verkoopkanaal"></textarea>
              </label>
            </div>
          </section>

          @if (layout() === 'BROCHURE') {
            <app-catalog-brochure-settings
              [disabled]="busy()"
              [includePhotos]="includePhotos()"
              [selectedFamilyCount]="selectedFamilyCount()"
              [settings]="brochure()"
              (settingsChange)="brochure.set($event)"
            />
          }
        </div>

        <div class="catalog-output">
          <app-catalog-product-selection
            [products]="products()"
            [categories]="categories()"
            [selected]="selected()"
            [loading]="loading()"
            [loadError]="loadError()"
            [disabled]="busy()"
            [showReferencePrices]="includePrices()"
            (selectedChange)="selected.set($event)"
            (retry)="load()"
          />

          @if (busy()) {
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
              <div>
                <b>PDF kon niet worden gemaakt</b>
                <small>{{ error }}</small>
              </div>
              <div class="render-error__actions">
                @if (renderTranslationError()) {
                  <a class="btn btn--sm" routerLink="/catalog/texts">Catalogusteksten</a>
                  <a class="btn btn--sm" routerLink="/settings"
                     [queryParams]="{ sectie: 'categories' }">Categorieën</a>
                  <a class="btn btn--sm" routerLink="/products">Productvertalingen</a>
                }
                <button class="btn btn--sm btn--primary" type="button" [disabled]="busy()"
                        (click)="retryRender()">Opnieuw proberen</button>
              </div>
            </section>
          }
        </div>
      </fieldset>
    </div>

    <div class="action-bar catalog-action" [attr.aria-busy]="busy()">
      <div class="action-bar__total">
        <div class="action-bar__label">
          {{ layout() === 'SIMPLE' ? 'Compacte prijslijst' : 'B2B-handelscatalogus' }}
        </div>
        <div class="action-bar__value">{{ selected().size }} product(en)</div>
      </div>
      <div class="catalog-action__buttons">
        <button class="btn btn--primary" type="button"
                [disabled]="!canExport() || busy()" (click)="download()">
          {{ downloading() ? 'PDF wordt gemaakt…' : 'PDF maken & downloaden' }}
        </button>
      </div>
      <span class="sr-only" aria-live="polite">{{ actionStatus() }}</span>
    </div>
  `,
  styles: `
    :host { display: block; }
    .catalog-page { max-width: 1320px; }
    .catalog-workspace { min-width: 0; margin: 0; padding: 0; border: 0; }
    .catalog-settings, .catalog-output {
      display: grid; min-width: 0; gap: 12px; align-content: start;
    }
    .catalog-output { margin-top: 12px; }
    .card__head > div { min-width: 0; }
    .card__head p { margin-top: 4px; color: var(--muted); font-size: 14px; line-height: 1.45; }
    .field > span { color: var(--ink-2); font-size: 14px; font-weight: 700; }
    .field > span > small { color: var(--muted); font-size: 14px; font-weight: 500; }

    .mode-choice { display: grid; gap: 10px; }
    .mode-choice button {
      position: relative; display: grid; min-width: 0; min-height: 132px;
      align-content: start; gap: 5px; padding: 16px; border: 1px solid var(--line);
      border-radius: var(--r-sm);
      background: var(--surface-2); color: var(--ink-2); text-align: left; cursor: pointer;
    }
    .mode-choice button > span { color: var(--muted); font-size: 22px; line-height: 1; }
    .mode-choice button b { margin-top: 4px; font-size: 16px; line-height: 1.25; }
    .mode-choice button small { max-width: 34ch; color: var(--muted); font-size: 14px; line-height: 1.45; }
    .mode-choice button i {
      position: absolute; top: 12px; right: 12px; padding: 5px 8px; border-radius: 999px;
      background: var(--rose); color: #fff; font-size: 11px; font-style: normal;
      font-weight: 750; letter-spacing: .04em; text-transform: uppercase;
    }
    .mode-choice button.active {
      border-color: var(--rose); background: var(--rose-soft); color: var(--rose-dark);
      box-shadow: inset 0 0 0 1px var(--rose);
    }
    .mode-choice button.active > span { color: var(--rose); }

    .option-grid { display: grid; grid-template-columns: 1fr; gap: 8px; }
    .option-grid__language { margin: 0; }
    .option-grid__language .select { min-height: 48px; font-size: 16px; }
    .option-toggle {
      display: flex; min-width: 0; min-height: 68px; align-items: flex-start; gap: 11px;
      padding: 13px;
      border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface-2);
      cursor: pointer;
    }
    .option-toggle input { width: 22px; height: 22px; flex: none; accent-color: var(--rose); }
    .option-toggle span { display: grid; min-width: 0; gap: 1px; }
    .option-toggle b { font-size: 15px; }
    .option-toggle small { color: var(--muted); font-size: 14px; line-height: 1.4; }
    .intro-field { margin: 16px 0 0; }
    .intro-field .textarea { min-height: 96px; padding: 13px; font-size: 16px; line-height: 1.45; }

    .render-status, .render-error {
      display: flex; min-height: 76px; align-items: center; gap: 12px; padding: 14px;
    }
    .render-status__mark {
      width: 22px; height: 22px; flex: none; border: 2px solid var(--rose-line);
      border-top-color: var(--rose); border-radius: 50%; animation: spin .8s linear infinite;
    }
    .render-status div, .render-error div { display: grid; min-width: 0; gap: 2px; }
    .render-status b, .render-error b { color: var(--ink-2); font-size: 15px; }
    .render-status small, .render-error small { color: var(--muted); font-size: 14px; line-height: 1.45; }
    .render-error { justify-content: space-between; border-color: var(--danger); }
    .render-error small { color: var(--danger); }
    .render-error__actions { display:flex;justify-content:flex-end;flex-wrap:wrap;gap:7px }
    .render-error__actions .btn { min-height:48px }
    @keyframes spin { to { transform: rotate(360deg); } }

    .catalog-action__buttons { display: flex; gap: 7px; }
    .catalog-action__buttons .btn { min-height: 48px; padding-inline: 16px; font-size: 14px; white-space: nowrap; }

    @media (prefers-reduced-motion: reduce) {
      .render-status__mark { animation: none; }
    }
    @media (min-width: 520px) {
      .mode-choice { grid-template-columns: 1fr 1fr; }
      .option-grid { grid-template-columns: 1fr 1fr; }
      .option-grid__language { grid-column: 1 / -1; }
    }
    @media (min-width: 680px) {
      .catalog-workspace {
        display: grid; grid-template-columns: minmax(330px, .78fr) minmax(440px, 1.22fr);
        align-items: start; gap: 14px;
      }
      .catalog-output { margin-top: 0; }
      .catalog-action__buttons .btn { min-width: 132px; }
    }
    @media (max-width: 430px) {
      .render-error { align-items:stretch;flex-direction:column }
      .render-error__actions { display:grid;grid-template-columns:1fr }
      .render-error__actions .btn { width:100% }
      .catalog-action { padding-inline: 10px; gap: 7px; }
      .catalog-action .action-bar__label { display: none; }
      .catalog-action .action-bar__value { font-size: 15px; }
      .catalog-action__buttons { gap: 5px; }
      .catalog-action__buttons .btn { min-height: 48px; padding-inline: 12px; font-size: 13px; }
    }
  `,
})
export class CatalogExport {
  readonly languages = LANGUAGES;

  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);
  private readonly destroyRef = inject(DestroyRef);
  private storedSelection: number[] | null = null;
  private selectionInitialized = false;
  private destroyed = false;

  readonly layout = signal<CatalogLayout>('BROCHURE');
  readonly language = signal<LanguageCode>('NL');
  readonly intro = signal('');
  readonly includePrices = signal(true);
  readonly includePhotos = signal(true);
  readonly brochure = signal<CatalogBrochureDraft>({ ...DEFAULT_BROCHURE });

  readonly products = signal<Product[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly selected = signal<Set<number>>(new Set());
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly dataReady = signal(false);
  readonly downloading = signal(false);
  readonly renderError = signal<string | null>(null);
  readonly renderTranslationError = signal(false);

  readonly busy = computed(() => this.downloading());
  readonly canExport = computed(() =>
    this.dataReady() && this.selected().size > 0 && !this.loadError());
  readonly actionStatus = computed(() => {
    if (this.downloading()) return 'PDF wordt gemaakt. Dit kan enkele minuten duren.';
    return this.renderError() ?? '';
  });
  readonly selectedFamilyCount = computed(() => {
    const selected = this.selected();
    const groups = new Set<string>();
    for (const product of this.products()) {
      if (product.id === null || !selected.has(product.id)) continue;
      groups.add(product.familyId === null ? `product:${product.id}` : `family:${product.familyId}`);
    }
    return groups.size;
  });
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
      const [products, categories] = await Promise.all([
        this.catalog.products(),
        this.catalog.categories(),
      ]);
      if (this.destroyed) return;
      this.products.set(products);
      this.categories.set(categories);
      const available = new Set(products.flatMap((product) =>
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
    this.downloading.set(true);
    try {
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

  private async handleRenderFailure(failure: unknown, toastFallback: string): Promise<void> {
    const decodedFailure = await this.decodeBlobError(failure);
    const fallback = 'De PDF-rendering mislukte of duurde te lang. Probeer opnieuw of selecteer minder producten.';
    const missingTranslations = this.missingTranslationMessage(decodedFailure);
    const message = missingTranslations ?? messageOf(decodedFailure, fallback);
    this.renderError.set(message);
    this.renderTranslationError.set(missingTranslations !== null);
    this.ui.toast(missingTranslations ?? messageOf(decodedFailure, toastFallback), 'err');
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

  private missingTranslationMessage(failure: unknown): string | null {
    const response = failure as {
      status?: number;
      error?: { message?: string; missingPaths?: unknown };
    };
    if (response.status !== 409) return null;
    const paths = Array.isArray(response.error?.missingPaths)
      ? response.error.missingPaths.filter(
          (path): path is string => typeof path === 'string' && !!path.trim(),
        )
      : [];
    if (!paths.length) {
      return response.error?.message
        ?? `De ${this.languageLabel()} catalogus mist nog verplichte vertalingen.`;
    }
    const visible = paths.slice(0, 4).join(' · ');
    const remaining = paths.length - 4;
    return `De ${this.languageLabel()} catalogus mist ${paths.length} verplichte `
      + `vertaling${paths.length === 1 ? '' : 'en'}: ${visible}`
      + (remaining > 0 ? ` · en nog ${remaining}` : '')
      + '. Vul deze teksten in het dashboard aan en probeer opnieuw.';
  }

  private languageLabel(): string {
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
