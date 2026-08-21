import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
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

const STATE_KEY = 'enrosed.catalogBuilder.v1';

interface CatalogBuilderState extends CatalogBrochureDraft {
  version: 1;
  layout: CatalogLayout;
  language: LanguageCode;
  intro: string;
  includePrices: boolean;
  includePhotos: boolean;
  selectedIds: number[];
}

type RenderAction = 'preview' | 'download';

const DEFAULT_BROCHURE: CatalogBrochureDraft = {
  photosPerProduct: 4,
  coverTitle: '',
  coverSubtitle: '',
  includeOverview: true,
  includeCategoryIntros: true,
  includeCustomisation: true,
  includeOrdering: true,
  includeBackCover: true,
};

@Component({
  selector: 'app-catalog-export',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CatalogBrochureSettings,
    CatalogProductSelection,
    FormsModule,
    PageHeader,
  ],
  template: `
    <app-page-header
      title="Catalogus maken"
      [subtitle]="selected().size + ' van ' + products().length + ' producten'"
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
                <h2 id="catalog-mode-title">Kies je catalogus</h2>
                <p>Je productselectie blijft behouden wanneer je wisselt.</p>
              </div>
            </div>
            <div class="card__body">
              <div class="mode-choice" role="group" aria-label="Soort catalogus">
                <button type="button" [class.active]="layout() === 'SIMPLE'"
                        [attr.aria-pressed]="layout() === 'SIMPLE'"
                        (click)="layout.set('SIMPLE')">
                  <span aria-hidden="true">▦</span>
                  <b>Eenvoudige catalogus</b>
                  <small>Verzorgd productoverzicht, direct klaar als PDF</small>
                </button>
                <button type="button" [class.active]="layout() === 'BROCHURE'"
                        [attr.aria-pressed]="layout() === 'BROCHURE'"
                        (click)="layout.set('BROCHURE')">
                  <span aria-hidden="true">▤</span>
                  <b>Uitgebreide brochure</b>
                  <small>Voorpagina, hoofdstukken en merkverhaal</small>
                </button>
              </div>
            </div>
          </section>

          <section class="card" aria-labelledby="catalog-content-title">
            <div class="card__head">
              <div>
                <h2 id="catalog-content-title">Inhoud</h2>
                <p>Productgegevens komen rechtstreeks uit het dashboard.</p>
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
                  <span><b>Verkoopprijzen</b><small>Prijs per stuk tonen</small></span>
                </label>
                <label class="option-toggle">
                  <input type="checkbox" [ngModel]="includePhotos()"
                         (ngModelChange)="includePhotos.set($event)" />
                  <span><b>Productfoto’s</b><small>Foto’s uit de productmaster</small></span>
                </label>
              </div>

              @if (desktop()) {
                <label class="field intro-field">
                  <span>Inleiding <small>optioneel</small></span>
                  <textarea class="textarea" rows="3" [ngModel]="intro()"
                            (ngModelChange)="intro.set($event)"
                            placeholder="Korte boodschap voor deze klant of gelegenheid"></textarea>
                </label>
              }
            </div>
          </section>

          @if (layout() === 'BROCHURE') {
            <app-catalog-brochure-settings
              [desktop]="desktop()"
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
            (selectedChange)="selected.set($event)"
            (retry)="load()"
          />

          @if (busy()) {
            <section class="card render-status" role="status" aria-live="polite">
              <span class="render-status__mark" aria-hidden="true"></span>
              <div>
                <b>{{ previewing() ? 'PDF-preview wordt opgebouwd' : 'PDF wordt voorbereid' }}</b>
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
              <button class="btn btn--sm" type="button" [disabled]="busy()"
                      (click)="retryRender()">Opnieuw proberen</button>
            </section>
          }

          @if (previewUrl(); as url) {
            <section class="card pdf-preview" aria-labelledby="pdf-preview-title">
              <div class="card__head">
                <div>
                  <h2 id="pdf-preview-title" tabindex="-1" #previewHeading>PDF-preview</h2>
                  <p>Download gebruikt deze reeds gemaakte PDF; er wordt niet opnieuw gerenderd.</p>
                </div>
                <button class="btn btn--sm" type="button" (click)="clearPreview()">Sluiten</button>
              </div>
              <iframe [src]="url" title="Preview van de catalogus-pdf"></iframe>
            </section>
          } @else if (desktop() && !busy() && !renderError()) {
            <section class="card preview-empty" aria-label="PDF-preview">
              <span aria-hidden="true">PDF</span>
              <div><b>Nog geen preview</b><small>Controleer je selectie en kies PDF bekijken.</small></div>
            </section>
          }
        </div>
      </fieldset>
    </div>

    <div class="action-bar catalog-action" [attr.aria-busy]="busy()">
      <div class="action-bar__total">
        <div class="action-bar__label">
          {{ layout() === 'SIMPLE' ? 'Eenvoudige catalogus' : 'Brochure' }}
        </div>
        <div class="action-bar__value">{{ selected().size }} product(en)</div>
      </div>
      <div class="catalog-action__buttons">
        <button class="btn" type="button"
                [disabled]="!canExport() || busy()" (click)="preview()">
          {{ previewing() ? 'Preview laden…' : 'PDF bekijken' }}
        </button>
        <button class="btn btn--primary" type="button"
                [disabled]="!canExport() || busy()" (click)="download()">
          {{ downloading() ? 'Downloaden…' : 'Download' }}
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
    .card__head p { margin-top: 2px; color: var(--muted); font-size: 10.5px; line-height: 1.35; }
    .field > span { color: var(--ink-2); font-size: 11.5px; font-weight: 650; }
    .field > span > small { color: var(--muted); font-size: 9px; font-weight: 500; }

    .mode-choice { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .mode-choice button {
      display: grid; min-width: 0; min-height: 112px; align-content: start; gap: 3px;
      padding: 12px; border: 1px solid var(--line); border-radius: var(--r-sm);
      background: var(--surface-2); color: var(--ink-2); text-align: left; cursor: pointer;
    }
    .mode-choice button > span { color: var(--muted); font-size: 19px; line-height: 1; }
    .mode-choice button b { margin-top: 4px; font-size: 12px; line-height: 1.25; }
    .mode-choice button small { color: var(--muted); font-size: 9.5px; line-height: 1.35; }
    .mode-choice button.active {
      border-color: var(--rose); background: var(--rose-soft); color: var(--rose-dark);
      box-shadow: inset 0 0 0 1px var(--rose);
    }
    .mode-choice button.active > span { color: var(--rose); }

    .option-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .option-grid__language { grid-column: 1 / -1; margin: 0; }
    .option-toggle {
      display: flex; min-width: 0; align-items: flex-start; gap: 9px; padding: 10px;
      border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface-2);
      cursor: pointer;
    }
    .option-toggle input { width: 18px; height: 18px; flex: none; accent-color: var(--rose); }
    .option-toggle span { display: grid; min-width: 0; gap: 1px; }
    .option-toggle b { font-size: 11px; }
    .option-toggle small { color: var(--muted); font-size: 9px; line-height: 1.3; }
    .intro-field { margin: 13px 0 0; }

    .render-status, .render-error {
      display: flex; min-height: 76px; align-items: center; gap: 12px; padding: 14px;
    }
    .render-status__mark {
      width: 22px; height: 22px; flex: none; border: 2px solid var(--rose-line);
      border-top-color: var(--rose); border-radius: 50%; animation: spin .8s linear infinite;
    }
    .render-status div, .render-error div { display: grid; min-width: 0; gap: 2px; }
    .render-status b, .render-error b { color: var(--ink-2); font-size: 12px; }
    .render-status small, .render-error small { color: var(--muted); font-size: 10px; line-height: 1.4; }
    .render-error { justify-content: space-between; border-color: var(--danger); }
    .render-error small { color: var(--danger); }
    @keyframes spin { to { transform: rotate(360deg); } }

    .pdf-preview iframe {
      display: block; width: 100%; height: 68dvh; min-height: 480px;
      border: 0; background: #4a4a4a;
    }
    .preview-empty {
      display: flex; min-height: 110px; align-items: center; justify-content: center;
      gap: 12px; padding: 18px; color: var(--muted);
    }
    .preview-empty > span {
      padding: 8px; border: 1px solid var(--line); border-radius: 8px;
      color: var(--rose); font-size: 10px; font-weight: 800;
    }
    .preview-empty div { display: grid; gap: 2px; }
    .preview-empty b { color: var(--ink-2); font-size: 12px; }
    .preview-empty small { font-size: 10px; }

    .catalog-action__buttons { display: flex; gap: 7px; }
    .catalog-action__buttons .btn { min-height: 42px; padding-inline: 12px; white-space: nowrap; }

    @media (prefers-reduced-motion: reduce) {
      .render-status__mark { animation: none; }
    }
    @media (min-width: 1024px) {
      .catalog-workspace {
        display: grid; grid-template-columns: minmax(330px, .78fr) minmax(440px, 1.22fr);
        align-items: start; gap: 14px;
      }
      .catalog-output { margin-top: 0; }
      .catalog-action__buttons .btn { min-width: 132px; }
    }
    @media (max-width: 430px) {
      .catalog-action { padding-inline: 10px; gap: 7px; }
      .catalog-action .action-bar__label { display: none; }
      .catalog-action .action-bar__value { font-size: 14px; }
      .catalog-action__buttons { gap: 5px; }
      .catalog-action__buttons .btn { min-height: 40px; padding-inline: 9px; font-size: 11px; }
    }
  `,
})
export class CatalogExport {
  readonly languages = LANGUAGES;

  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);
  private readonly previewHeading = viewChild<ElementRef<HTMLElement>>('previewHeading');
  private mediaQuery: MediaQueryList | null = null;
  private previewObjectUrl: string | null = null;
  private cachedBlob: Blob | null = null;
  private cachedRequestKey: string | null = null;
  private storedSelection: number[] | null = null;
  private selectionInitialized = false;
  private destroyed = false;
  private lastRenderAction: RenderAction = 'preview';

  readonly layout = signal<CatalogLayout>('SIMPLE');
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
  readonly previewing = signal(false);
  readonly downloading = signal(false);
  readonly renderError = signal<string | null>(null);
  readonly previewUrl = signal<SafeResourceUrl | null>(null);
  readonly desktop = signal(false);

  readonly busy = computed(() => this.previewing() || this.downloading());
  readonly canExport = computed(() =>
    this.dataReady() && this.selected().size > 0 && !this.loadError());
  readonly actionStatus = computed(() => {
    if (this.previewing()) return 'PDF-preview wordt gemaakt. Dit kan enkele minuten duren.';
    if (this.downloading()) return 'PDF wordt voorbereid voor downloaden.';
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
    this.bindDesktopQuery();
    void this.load();

    effect(() => {
      if (!this.dataReady()) return;
      const brochure = this.brochure();
      const state: CatalogBuilderState = {
        version: 1,
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
      if (previousRequest && previousRequest !== currentRequest) this.invalidatePdf();
      previousRequest = currentRequest;
    });

    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.invalidatePdf();
      if (this.mediaQuery) this.mediaQuery.removeEventListener('change', this.handleDesktopChange);
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
      this.invalidatePdf();
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

  async preview(): Promise<void> {
    if (!this.canExport() || this.busy()) return;
    const request = this.buildRequest();
    const key = JSON.stringify(request);
    this.lastRenderAction = 'preview';
    this.renderError.set(null);
    this.previewing.set(true);
    try {
      const blob = await this.pdfFor(request, key);
      if (this.destroyed || key !== this.requestKey()) return;
      this.setPreview(blob);
      setTimeout(() => {
        if (!this.destroyed) this.previewHeading()?.nativeElement.focus();
      });
    } catch (failure) {
      if (!this.destroyed) this.handleRenderFailure(failure, 'PDF-preview maken mislukt');
    } finally {
      if (!this.destroyed) this.previewing.set(false);
    }
  }

  async download(): Promise<void> {
    if (!this.canExport() || this.busy()) return;
    const request = this.buildRequest();
    const key = JSON.stringify(request);
    this.lastRenderAction = 'download';
    this.renderError.set(null);
    this.downloading.set(true);
    try {
      const blob = await this.pdfFor(request, key);
      if (this.destroyed || key !== this.requestKey()) return;
      saveBlob(
        blob,
        request.layout === 'BROCHURE' ? 'enrosed-brochure.pdf' : 'enrosed-catalogus.pdf',
      );
      this.ui.toast('Catalogus gedownload');
    } catch (failure) {
      if (!this.destroyed) this.handleRenderFailure(failure, 'Catalogus maken mislukt');
    } finally {
      if (!this.destroyed) this.downloading.set(false);
    }
  }

  retryRender(): void {
    if (this.busy()) return;
    if (this.lastRenderAction === 'download') void this.download();
    else void this.preview();
  }

  clearPreview(): void {
    if (this.previewObjectUrl !== null) URL.revokeObjectURL(this.previewObjectUrl);
    this.previewObjectUrl = null;
    this.previewUrl.set(null);
  }

  private async pdfFor(request: CatalogExportRequest, key: string): Promise<Blob> {
    if (this.cachedBlob && this.cachedRequestKey === key) return this.cachedBlob;
    const blob = await this.catalog.exportCatalog(request);
    if (!this.destroyed && key === this.requestKey()) {
      this.cachedBlob = blob;
      this.cachedRequestKey = key;
    }
    return blob;
  }

  private buildRequest(): CatalogExportRequest {
    const brochure = this.brochure();
    return {
      productIds: [...this.selected()].sort((a, b) => a - b),
      includePrices: this.includePrices(),
      includePhotos: this.includePhotos(),
      photosPerProduct: this.includePhotos()
        ? this.layout() === 'BROCHURE' ? brochure.photosPerProduct : 1
        : undefined,
      title: '',
      intro: this.intro().trim(),
      language: this.language(),
      layout: this.layout(),
      brochure: this.layout() === 'BROCHURE'
        ? {
            includeOverview: brochure.includeOverview,
            includeCategoryIntros: brochure.includeCategoryIntros,
            includeCustomisation: brochure.includeCustomisation,
            includeOrdering: brochure.includeOrdering,
            includeBackCover: brochure.includeBackCover,
            coverTitle: brochure.coverTitle.trim() || undefined,
            coverSubtitle: brochure.coverSubtitle.trim() || undefined,
          }
        : undefined,
    };
  }

  private setPreview(blob: Blob): void {
    this.clearPreview();
    const url = URL.createObjectURL(blob);
    this.previewObjectUrl = url;
    this.previewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
  }

  private invalidatePdf(): void {
    this.clearPreview();
    this.cachedBlob = null;
    this.cachedRequestKey = null;
    this.renderError.set(null);
  }

  private handleRenderFailure(failure: unknown, toastFallback: string): void {
    const fallback = 'De PDF-rendering mislukte of duurde te lang. Probeer opnieuw of selecteer minder producten.';
    const message = messageOf(failure, fallback);
    this.renderError.set(message);
    this.ui.toast(messageOf(failure, toastFallback), 'err');
  }

  private bindDesktopQuery(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    this.mediaQuery = window.matchMedia('(min-width: 1024px)');
    this.desktop.set(this.mediaQuery.matches);
    this.mediaQuery.addEventListener('change', this.handleDesktopChange);
  }

  private readonly handleDesktopChange = (event: MediaQueryListEvent): void => {
    this.desktop.set(event.matches);
  };

  private restoreState(): void {
    try {
      const parsed = JSON.parse(sessionStorage.getItem(STATE_KEY) ?? 'null') as
        Partial<CatalogBuilderState> | null;
      if (parsed?.version !== 1) return;
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
