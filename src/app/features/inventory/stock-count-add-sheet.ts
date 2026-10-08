import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { CatalogApi } from '../../core/api/catalog-api';
import { messageOf } from '../../core/api/errors';
import { sentence } from './inventory-closing';
import type { Product } from '../../core/api/models';
import { Icon } from '../../shared/icon';
import { Skeleton } from '../../shared/skeleton';
import { Sheet } from '../../shared/ui';

/** More matches than this are not drawn: the search narrows them down. */
const SHOWN = 40;

/** Lower case without accents, the way the count list searches. */
function fold(text: string | null | undefined): string {
  return (text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('nl-BE');
}

/**
 * "Product toevoegen": a search over all products, also the ones that are
 * not on the count list (a correction starts empty; a full count lists what
 * has stock or is active). It only picks: the page adds the line, and the
 * server answers the existing line when the product is already listed.
 */
@Component({
  selector: 'app-stock-count-add-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, Skeleton, Icon],
  template: `
    <app-sheet variant="ios" title="Product toevoegen" (closed)="closed.emit()">
      <div body class="inv-add">
        <div class="ios-search inv-add__search">
          <div class="ios-search__field">
            <app-icon name="search" [size]="18" />
            <input type="search" placeholder="Zoek naam of SKU…" aria-label="Zoek naam of SKU" autocomplete="off" data-initial-focus
                   [value]="query()" (input)="query.set($any($event.target).value)" />
            <button class="ios-search__clear" type="button" aria-label="Zoekopdracht wissen" (click)="query.set('')"><app-icon name="close" [size]="16" /></button>
          </div>
        </div>
        @if (error(); as message) {
          <div class="alert alert--danger inv-add__alert" role="alert">
            <span>{{ message }}</span>
            <button class="btn btn--sm" type="button" (click)="load()">Opnieuw</button>
          </div>
        } @else if (!products()) {
          <div class="inv-add__loading" aria-busy="true"><app-skeleton kind="list" [rows]="6" /></div>
        } @else if (!matches().length) {
          <p class="inv-add__empty">Geen product gevonden.</p>
        } @else {
          <div class="ios-group">
            @for (product of shown(); track product.id) {
              <button class="ios-cell ios-cell--tall" type="button" [disabled]="busy()" (click)="pick.emit(product.id!)">
                <span class="ios-cell__body">
                  <span class="ios-cell__title ios-cell__title--2">{{ product.name }}</span>
                  <span class="ios-cell__sub">{{ product.sku || 'Geen SKU' }}@if (!product.active) { · niet actief }</span>
                </span>
                @if (listed().has(product.id!)) { <span class="ios-cell__trail"><span class="ios-cell__meta">Staat op de lijst</span></span> }
                <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
              </button>
            }
          </div>
          @if (matches().length > shown().length) {
            <p class="ios-section__foot">Nog {{ matches().length - shown().length }} producten. Zoek preciezer om ze te zien.</p>
          }
        }
      </div>
    </app-sheet>
  `,
})
export class StockCountAddSheet {
  private readonly catalog = inject(CatalogApi);

  /** Product ids that already have a line. */
  readonly listed = input<ReadonlySet<number>>(new Set());
  readonly busy = input(false);
  readonly pick = output<number>();
  readonly closed = output<void>();

  readonly query = signal('');
  readonly products = signal<Product[] | null>(null);
  readonly error = signal<string | null>(null);

  readonly matches = computed(() => {
    const words = fold(this.query()).split(/\s+/).filter(Boolean);
    return (this.products() ?? []).filter((product) => {
      const haystack = `${fold(product.name)} ${fold(product.sku)}`;
      return words.every((word) => haystack.includes(word));
    });
  });
  readonly shown = computed(() => this.matches().slice(0, SHOWN));

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    try {
      const products = await this.catalog.products();
      this.products.set(products
        .filter((product) => product.id !== null)
        .sort((a, b) => a.name.localeCompare(b.name, 'nl-BE')));
    } catch (failure) {
      this.error.set(sentence(messageOf(failure, 'De producten konden niet worden geladen.')));
    }
  }
}
