import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { LANGUAGES, LanguageCode, Product, ProductFamily } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { ProductTranslationEditor } from './product-translation-editor';
import { HasUnsavedChanges } from '../../core/guards/unsaved-changes.guard';
import { messageOf } from '../../core/api/errors';

const PRODUCT_TRANSLATION_FOCUS = new Set([
  'public-name',
  'family-name',
  'family-summary',
  'family-description',
  'family-format',
  'family-highlights',
  'variant-name',
  'variant-colour',
  'variant-size',
  'variant-description',
]);

/**
 * Website translations on a page of their own.
 *
 * Inside the product editor the translations fought with the ERP fields:
 * two kinds of unsaved work on one screen, one save button, and a form
 * that scrolled forever. Here the product is already saved (the page is
 * reachable only for an existing product), the translation editor has
 * the full width, its own save, and leaving with unsaved copy asks.
 */
@Component({
  selector: 'app-product-translations-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageHeader, Skeleton, ProductTranslationEditor],
  template: `
    @if (loadError()) {
      <app-page-header title="Productvertalingen" subtitle="Product niet beschikbaar"
                       [showBack]="true" [backTo]="returnTo" [showBell]="false" />
      <main class="content translations-page">
        <section class="translation-load-error" role="alert">
          <span aria-hidden="true">!</span>
          <div>
            <h2>Productvertalingen konden niet worden geopend</h2>
            <p>{{ loadError() }}</p>
          </div>
          <div class="translation-load-error__actions">
            <a class="btn" routerLink="/products">Terug naar producten</a>
            @if (validProductId) {
              <button class="btn btn--primary" type="button" [disabled]="loading()"
                      (click)="retry()">
                {{ loading() ? 'Laden…' : 'Opnieuw proberen' }}
              </button>
            }
          </div>
        </section>
      </main>
    } @else if (loading()) {
      <app-page-header title="Productvertalingen" subtitle="Product laden…"
                       [showBack]="true" [backTo]="returnTo" [showBell]="false" />
      <main class="content translations-page" aria-live="polite">
        <app-skeleton kind="card" [rows]="2" />
        <span class="sr-only">Product en vertalingen laden…</span>
      </main>
    } @else if (product(); as product) {
      <app-page-header title="Productvertalingen" [subtitle]="product.name"
                       [showBack]="true" [backTo]="returnTo" [showBell]="false">
        @if (returnTo === '/catalog-export') {
          <a class="btn" [routerLink]="returnTo">Terug naar catalogus</a>
        }
        <a class="btn" [routerLink]="['/products', product.id, 'edit']">Productgegevens</a>
      </app-page-header>
      <div class="content translations-page">
        <nav class="translation-hub" aria-label="Kies het soort vertaling">
          <div class="translation-route translation-route--active" aria-current="page">
            <span class="translation-route__letter" aria-hidden="true">A</span>
            <span>
              <b>Productvertalingen</b>
              <small>Publieke product- en familienaam, variantkleur en -maat, beschrijving, SEO en foto-alt.</small>
              <strong>U werkt aan {{ product.name }}</strong>
            </span>
          </div>
          <a class="translation-route" routerLink="/website/texts">
            <span class="translation-route__letter" aria-hidden="true">B</span>
            <span>
              <b>Website Content</b>
              <small>Homepage en onderdelen, navigatie, footer, juridische pagina’s en algemene SEO-paginacopy.</small>
              <strong>Open Website Content <i aria-hidden="true">→</i></strong>
            </span>
          </a>
        </nav>

        <app-product-translation-editor
          [product]="product"
          [family]="family()"
          [language]="language()"
          [focusField]="focusField"
          [visible]="true"
          (languageChange)="language.set($event)"
          (dirtyChange)="dirty.set($event)"
          (savingChange)="saving.set($event)"
        />
      </div>
    } @else {
      <app-page-header title="Productvertalingen" subtitle="Geen product geselecteerd"
                       [showBack]="true" [backTo]="returnTo" [showBell]="false" />
      <main class="content translations-page">
        <section class="translation-load-error" role="status">
          <span aria-hidden="true">?</span>
          <div><h2>Geen product geselecteerd</h2><p>Kies eerst een product om de publieke teksten te vertalen.</p></div>
          <a class="btn btn--primary" routerLink="/products">Product kiezen</a>
        </section>
      </main>
    }
  `,
  styles: `
    .translations-page { max-width: 1180px; margin: 0 auto; padding-bottom: calc(52px + env(safe-area-inset-bottom)); }
    .btn { min-height: 48px; }
    .translation-hub { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-bottom: 18px; }
    .translation-route {
      display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 14px; min-height: 158px;
      padding: 18px; border: 1px solid var(--line); border-radius: var(--r); background: var(--surface);
      color: var(--ink); text-decoration: none; box-shadow: var(--sh-1);
    }
    .translation-route--active { border-color: var(--rose); background: var(--rose-soft); box-shadow: inset 0 0 0 1px var(--rose); }
    .translation-route__letter { display: grid; width: 48px; height: 48px; place-items: center; border-radius: 14px; background: var(--surface-2); color: var(--rose-dark); font-size: 18px; font-weight: 850; }
    .translation-route > span:last-child { display: grid; align-content: start; gap: 7px; }
    .translation-route b { font-size: 20px; }
    .translation-route small { color: var(--muted); font-size: 16px; line-height: 1.5; }
    .translation-route strong { margin-top: auto; overflow-wrap: anywhere; color: var(--rose-dark); font-size: 15px; }
    .translation-route i { font-style: normal; }
    .translation-route:focus-visible { outline: 3px solid var(--rose); outline-offset: 3px; }
    .translation-load-error {
      display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 16px;
      padding: 20px; border: 1px solid var(--danger); border-radius: var(--r);
      background: var(--danger-soft); color: var(--danger);
    }
    .translation-load-error > span { display: grid; width: 44px; height: 44px; place-items: center;
      border-radius: 50%; background: var(--surface); font-size: 20px; font-weight: 800; }
    .translation-load-error h2 { font-size: 20px; line-height: 1.25; }
    .translation-load-error p { margin-top: 4px; color: var(--muted); font-size: 16px; line-height: 1.5; }
    .translation-load-error__actions { display: flex; gap: 8px; }

    @media (max-width: 760px) {
      .translation-hub { grid-template-columns: 1fr; }
      .translation-route { min-height: 0; }
    }

    @media (max-width: 460px) {
      .translations-page { padding-inline: 12px; }
      .translation-route { grid-template-columns: 42px minmax(0, 1fr); gap: 11px; padding: 15px; }
      .translation-route__letter { width: 42px; height: 42px; }
      .translation-route b { font-size: 18px; }
      .translation-load-error { grid-template-columns: auto minmax(0, 1fr); padding: 16px; }
      .translation-load-error__actions, .translation-load-error > .btn {
        grid-column: 1 / -1; display: grid; grid-template-columns: 1fr; width: 100%;
      }
      .translation-load-error__actions .btn { width: 100%; min-height: 48px; }
    }
  `,
})
export class ProductTranslationsPage implements HasUnsavedChanges {
  private readonly catalog = inject(CatalogApi);
  private readonly route = inject(ActivatedRoute);

  readonly product = signal<Product | null>(null);
  readonly family = signal<ProductFamily | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly language = signal<LanguageCode>(this.requestedLanguage());
  readonly focusField = this.requestedFocus();
  readonly returnTo = this.requestedReturnTo('/products');
  readonly dirty = signal(false);
  readonly saving = signal(false);
  private readonly productId = +(this.route.snapshot.paramMap.get('id') ?? 0);
  readonly validProductId = Number.isInteger(this.productId) && this.productId > 0;

  private requestedLanguage(): LanguageCode {
    const requested = this.route.snapshot.queryParamMap.get('language')?.toUpperCase();
    return LANGUAGES.some((language) => language.code === requested)
      ? requested as LanguageCode : 'NL';
  }

  private requestedFocus(): string | null {
    const focus = this.route.snapshot.queryParamMap.get('focus')?.trim() ?? '';
    return PRODUCT_TRANSLATION_FOCUS.has(focus) ? focus : null;
  }

  private requestedReturnTo(fallback: string): string {
    const returnTo = this.route.snapshot.queryParamMap.get('returnTo')?.trim() ?? '';
    return returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : fallback;
  }

  constructor() {
    void this.load();
  }

  retry(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    if (!this.validProductId) {
      this.loading.set(false);
      this.loadError.set('Het productnummer in de link is ongeldig.');
      return;
    }
    this.loading.set(true);
    this.loadError.set(null);
    this.product.set(null);
    this.family.set(null);
    try {
      const product = await this.catalog.product(this.productId);
      let family: ProductFamily | null = null;
      if (product.familyId !== null) {
        this.family.set(await this.catalog.productFamily(product.familyId));
        family = this.family();
      }
      this.product.set(product);
      this.family.set(family);
    } catch (failure: unknown) {
      this.product.set(null);
      this.family.set(null);
      this.loadError.set(messageOf(
        failure,
        'Controleer de verbinding met Enrosed en probeer opnieuw.',
      ));
    } finally {
      this.loading.set(false);
    }
  }

  canDeactivate(): boolean {
    if (this.saving()) return false;
    if (!this.dirty()) return true;
    return window.confirm('Je hebt vertalingen die nog niet zijn opgeslagen. Dit scherm toch verlaten?');
  }

  @HostListener('window:beforeunload', ['$event'])
  warnBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.dirty() && !this.saving()) return;
    event.preventDefault();
    event.returnValue = '';
  }
}
