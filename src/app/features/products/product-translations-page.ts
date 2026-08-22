import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CatalogApi } from '../../core/api/catalog-api';
import { LanguageCode, Product, ProductFamily } from '../../core/api/models';
import { PageHeader } from '../../shared/page-header';
import { Skeleton } from '../../shared/skeleton';
import { ProductTranslationEditor } from './product-translation-editor';
import { HasUnsavedChanges } from '../../core/guards/unsaved-changes.guard';

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
    @if (product(); as product) {
      <app-page-header title="Vertalingen" [subtitle]="product.name"
                       [showBack]="true" [showBell]="false">
        <a class="btn btn--sm" [routerLink]="['/products', product.id, 'edit']">Product</a>
      </app-page-header>
      <div class="content translations-page">
        @if (familyLoading()) {
          <app-skeleton kind="lines" [rows]="4" />
        } @else {
          <app-product-translation-editor
            [product]="product"
            [family]="family()"
            [language]="language()"
            [visible]="true"
            (languageChange)="language.set($event)"
            (dirtyChange)="dirty.set($event)"
            (savingChange)="saving.set($event)"
          />
        }
      </div>
    } @else {
      <app-page-header title="Vertalingen" [showBack]="true" [showBell]="false" />
      <div class="content"><app-skeleton kind="card" [rows]="2" /></div>
    }
  `,
  styles: `
    .translations-page { max-width: 1100px; margin: 0 auto; }
  `,
})
export class ProductTranslationsPage implements HasUnsavedChanges {
  private readonly catalog = inject(CatalogApi);
  private readonly route = inject(ActivatedRoute);

  readonly product = signal<Product | null>(null);
  readonly family = signal<ProductFamily | null>(null);
  readonly familyLoading = signal(true);
  readonly language = signal<LanguageCode>('NL');
  readonly dirty = signal(false);
  readonly saving = signal(false);

  constructor() {
    const id = +(this.route.snapshot.paramMap.get('id') ?? 0);
    void this.load(id);
  }

  private async load(id: number): Promise<void> {
    const product = await this.catalog.product(id);
    this.product.set(product);
    if (product.familyId !== null) {
      try {
        this.family.set(await this.catalog.productFamily(product.familyId));
      } catch {
        this.family.set(null);
      }
    }
    this.familyLoading.set(false);
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
