import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CatalogApi } from '../../core/api/catalog-api';
import { AuthImage } from '../../core/api/auth-image';
import { saveBlob } from '../../core/api/download';
import { LANGUAGES, LanguageCode } from '../../core/api/models';
import { Category, Product } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Ui } from '../../shared/ui';

/**
 * Catalogus samenstellen en als PDF meegeven.
 *
 * Je kiest zelf wat erin gaat: een klant die alleen glaswerk koopt heeft niets
 * aan tien pagina's acryl. Prijzen zijn optioneel — zonder prijzen is het een
 * productblad dat je aan iedereen kan geven.
 */
@Component({
  selector: 'app-catalog-export',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, PageHeader, AuthImage],
  template: `
    <app-page-header title="Catalogus exporteren"
                     [subtitle]="selected().size + ' van ' + products().length + ' geselecteerd'"
                     [showBack]="true" />

    <div class="content content--with-action-bar">
      <div class="card">
        <div class="card__head"><h2>Opmaak</h2></div>
        <div class="card__body">
          <div class="field">
            <label for="cat-lang">Taal</label>
            <select class="select" id="cat-lang" [ngModel]="language()"
                    (ngModelChange)="language.set($event)">
              @for (option of languages; track option.code) {
                <option [value]="option.code">{{ option.label }}</option>
              }
            </select>
            <span class="hint">Productnamen volgen de vertalingen uit het CSV-bestand.</span>
          </div>
          <div class="field">
            <label for="cat-intro">Inleiding <span class="opt"></span></label>
            <textarea class="textarea" id="cat-intro" [ngModel]="intro()"
                      (ngModelChange)="intro.set($event)"
                      placeholder="Bijvoorbeeld: selectie voor de beurs in Frankfurt."></textarea>
          </div>
          <div class="row wrap" style="gap:16px">
            <label class="row" style="gap:7px;cursor:pointer">
              <input type="checkbox" [ngModel]="includePrices()"
                     (ngModelChange)="includePrices.set($event)" />
              <span class="small">Verkoopprijzen tonen</span>
            </label>
            <label class="row" style="gap:7px;cursor:pointer">
              <input type="checkbox" [ngModel]="includePhotos()"
                     (ngModelChange)="includePhotos.set($event)" />
              <span class="small">Foto's tonen</span>
            </label>
          </div>
          <p class="tiny muted mt-8">
            Zonder prijzen krijg je een productblad dat je aan iedereen kan geven.
          </p>
        </div>
      </div>

      <div class="card">
        <div class="card__head">
          <h2>Producten</h2>
          <span class="spacer"></span>
          <button class="btn btn--sm" type="button" (click)="selectAll()">Alles</button>
          <button class="btn btn--sm" type="button" (click)="selectNone()">Geen</button>
        </div>
        <div class="card__body card__body--flush">
          <div class="chips" style="padding:10px 14px 0">
            <button class="chip" type="button" [class.active]="categoryFilter() === null"
                    (click)="categoryFilter.set(null)">Alle</button>
            @for (category of categories(); track category.id) {
              <button class="chip" type="button"
                      [class.active]="categoryFilter() === category.id"
                      (click)="categoryFilter.set(category.id)">{{ category.name }}</button>
            }
          </div>

          <div class="list">
            @for (product of filtered(); track product.id) {
              <label class="list-item" style="cursor:pointer">
                <input type="checkbox" [checked]="selected().has(product.id!)"
                       (change)="toggle(product.id!)" />
                @if (product.photos.length) {
                  <img class="thumb" [appAuthSrc]="product.photos[0].url" [alt]="product.name" />
                } @else {
                  <div class="thumb thumb--placeholder">◈</div>
                }
                <div class="list-item__body">
                  <div class="list-item__title">{{ product.name }}</div>
                  <div class="list-item__meta">
                    {{ product.sku }} · {{ product.describedAs }}
                  </div>
                </div>
              </label>
            } @empty {
              <div class="empty"><div class="empty__title">
                {{ loading() ? 'Laden…' : 'Geen producten' }}</div></div>
            }
          </div>
        </div>
      </div>
    </div>

    <div class="action-bar">
      <div class="action-bar__total">
        <div class="action-bar__label">Selectie</div>
        <div class="action-bar__value">{{ selected().size }} product(en)</div>
      </div>
      <button class="btn btn--primary" type="button"
              [disabled]="!selected().size || busy()" (click)="download()">
        {{ busy() ? 'Bezig…' : 'PDF maken' }}
      </button>
    </div>
  `,
})
export class CatalogExport {
  readonly languages = LANGUAGES;
  readonly language = signal<LanguageCode>('NL');

  private readonly catalog = inject(CatalogApi);
  private readonly ui = inject(Ui);

  readonly products = signal<Product[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly selected = signal<Set<number>>(new Set());
  readonly categoryFilter = signal<number | null>(null);
  readonly loading = signal(true);
  readonly busy = signal(false);

  readonly title = signal('Productcatalogus');
  readonly intro = signal('');
  readonly includePrices = signal(true);
  readonly includePhotos = signal(true);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const [products, categories] = await Promise.all([
      this.catalog.products(), this.catalog.categories(),
    ]);
    this.products.set(products);
    this.categories.set(categories);
    this.selected.set(new Set(products.map((product) => product.id!)));
    this.loading.set(false);
  }

  readonly filtered = computed(() => {
    const category = this.categoryFilter();
    return this.products().filter(
      (product) => category === null || product.categoryId === category);
  });

  toggle(id: number): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  selectAll(): void {
    this.selected.set(new Set(this.filtered().map((product) => product.id!)));
  }

  selectNone(): void {
    this.selected.set(new Set());
  }

  async download(): Promise<void> {
    this.busy.set(true);
    try {
      const blob = await this.catalog.exportCatalog({
        productIds: [...this.selected()],
        includePrices: this.includePrices(),
        includePhotos: this.includePhotos(),
        /* The title is universal and follows the chosen language. */
        title: '',
        intro: this.intro(),
        language: this.language(),
      });
      saveBlob(blob, 'enrosed-catalogus.pdf');
      this.ui.toast('Catalogus gedownload');
    } catch {
      this.ui.toast('Catalogus maken mislukt', 'err');
    } finally {
      this.busy.set(false);
    }
  }
}
