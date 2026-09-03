import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthImage } from '../../core/api/auth-image';
import { Category, Product } from '../../core/api/models';
import { Sheet } from '../../shared/ui';
import { CurPipe, NumPipe } from '../../shared/pipes';
import { colourHexOf, stripColour, variantOf } from './purchase-desk-format';

/**
 * The desk's product sheet: every product of the supplier that is not on
 * the container yet, grouped by category and series.
 *
 * Two panes on the wide sheet - a category list with counts on the left
 * that filters the right - and one row per variant with photo, SKU, stock,
 * cartons, EXW price, a quantity (one carton pre-filled, Enter adds) and
 * Toevoegen. The sheet only reports what was picked; the desk owns the
 * order.
 */
@Component({
  selector: 'app-purchase-desk-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet, AuthImage, CurPipe, NumPipe],
  template: `
    <app-sheet title="Product toevoegen aan de container" [wide]="true" (closed)="closed.emit()">
      <div body class="pick">
        <aside class="pick__side">
          <input class="input pick__search" type="search" autocomplete="off" placeholder="Zoek naam, kleur, maat of SKU…"
                 aria-label="Zoeken in de catalogus" [ngModel]="query()" (ngModelChange)="query.set($event)" />
          <nav class="pick__cats" aria-label="Categorieën">
            <button type="button" [class.on]="category() === null" (click)="category.set(null)">
              <span>Alle producten</span><b>{{ total() }}</b>
            </button>
            @for (option of categories(); track option.key) {
              <button type="button" [class.on]="category() === option.key" (click)="category.set(option.key)">
                <span>{{ option.label }}</span><b>{{ option.count }}</b>
              </button>
            }
          </nav>
          <p class="pick__hint">{{ supplierName() }} · alleen wat nog niet op de container staat</p>
        </aside>
        <div class="pick__list">
          @for (group of groups(); track group.key) {
            <div class="pick__cat">{{ group.label }} <small>{{ group.count }} product{{ group.count === 1 ? '' : 'en' }}</small></div>
            @for (family of group.families; track family.key) {
              <div class="pick__family">
                @if (family.products.length > 1) {
                  <div class="pick__head">
                    @if (photoOf(family.products[0]); as photo) { <img [appAuthSrc]="photo" alt="" /> }
                    <span><strong>{{ strip(family.label, family.products[0].colour) }}</strong>
                      <small>Reeks · {{ family.products.length }} varianten</small></span>
                  </div>
                }
                @for (product of family.products; track product.id) {
                  <div class="pick__row" [class.pick__row--variant]="family.products.length > 1">
                    @if (photoOf(product); as photo) { <img [appAuthSrc]="photo" alt="" /> } @else { <i aria-hidden="true">◈</i> }
                    <span class="pick__copy">
                      <strong>
                        @if (family.products.length > 1) {
                          @if (product.colour) {
                            <i class="pick__dot" [class.pick__dot--empty]="!hex(product)"
                               [style.background]="hex(product) || 'transparent'" aria-hidden="true"></i>
                          }{{ variant(product) || product.name }}
                        } @else {
                          {{ strip(product.name, product.colour) }}@if (variant(product); as label) { <em>{{ label }}</em> }
                        }
                      </strong>
                      <small>{{ product.sku }} · {{ product.stockQuantity | num }} op voorraad · {{ cartonOf(product) | num }}/doos</small>
                    </span>
                    <span class="pick__price">{{ product.exwPrice ?? 0 | cur: (product.exwCurrency ?? 'USD') }}<small>{{ product.exwPrice == null ? 'productkaart' : 'EXW' }}</small></span>
                    <input class="input num right pick__qty" type="number" min="1" step="1" inputmode="numeric"
                           [attr.aria-label]="'Aantal ' + product.name"
                           [ngModel]="quantityOf(product)" (ngModelChange)="setQuantity(product, +$event)"
                           (keydown.enter)="pick(product)" />
                    <button class="btn btn--sm btn--primary" type="button" (click)="pick(product)">Toevoegen</button>
                  </div>
                }
              </div>
            }
          } @empty {
            <p class="hint pick__empty">{{ query().trim() ? 'Niets gevonden bij deze leverancier.' : 'Alle producten van deze leverancier staan al op de container.' }}</p>
          }
        </div>
      </div>
      <div foot style="display:contents">
        <button class="btn" type="button" (click)="create.emit()">Nieuw product aanmaken</button>
        <span class="spacer pick__count">@if (added()) { {{ added() }} toegevoegd }</span>
        <button class="btn btn--primary" type="button" (click)="closed.emit()">Klaar</button>
      </div>
    </app-sheet>
  `,
  styles: [`
    :host{display:contents}
    .pick{display:grid;grid-template-columns:190px minmax(0,1fr);gap:18px;align-items:start}
    .pick__side{position:sticky;top:0;display:grid;gap:10px}
    .pick__search{width:100%}
    .pick__cats{display:grid;gap:2px}.pick__cats button{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:7px 10px;border:0;border-radius:9px;background:transparent;color:var(--ink-2);font:inherit;font-size:12.5px;text-align:left;cursor:pointer}
    .pick__cats button b{color:var(--muted);font-size:11px}.pick__cats button.on{background:var(--rose-soft);color:var(--rose-dark);font-weight:650}.pick__cats button.on b{color:var(--rose-dark)}
    .pick__hint{margin:0;padding:0 10px;color:var(--muted);font-size:11px;line-height:1.4}
    .pick__list{min-width:0}
    .pick__cat{margin:0 0 6px;color:var(--rose);font-size:10px;font-weight:760;letter-spacing:.1em;text-transform:uppercase}.pick__cat small{margin-left:6px;color:var(--muted);font-weight:600;letter-spacing:0;text-transform:none}.pick__family+.pick__cat{margin-top:16px}
    .pick__family{margin-bottom:8px;border:1px solid var(--line);border-radius:14px;background:var(--surface);overflow:hidden}
    .pick__head{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--line);background:var(--surface-2)}.pick__head img{width:32px;height:32px;border:1px solid var(--line);border-radius:9px;object-fit:cover}.pick__head span{display:grid}.pick__head strong{font-size:13px}.pick__head small{color:var(--muted);font-size:11px}
    .pick__row{display:grid;grid-template-columns:44px minmax(0,1fr) 110px 84px auto;align-items:center;gap:12px;padding:8px 12px;border-top:1px solid var(--line)}.pick__family>.pick__row:first-child{border-top:0}
    .pick__row--variant{padding-left:22px}.pick__row--variant img,.pick__row--variant>i{width:36px;height:36px}
    .pick__row img,.pick__row>i{width:44px;height:44px;border:1px solid var(--line);border-radius:11px;object-fit:cover;background:var(--surface-2)}.pick__row>i{display:grid;place-items:center;color:var(--muted);font-style:normal}
    .pick__copy{display:grid;min-width:0;line-height:1.25}.pick__copy strong{font-size:13px}.pick__copy em{margin-left:6px;color:var(--muted);font-style:normal;font-weight:600}.pick__copy small{overflow:hidden;color:var(--muted);font-size:11px;text-overflow:ellipsis;white-space:nowrap}
    .pick__dot{display:inline-block;width:10px;height:10px;margin-right:5px;border:1px solid rgb(0 0 0/.15);border-radius:50%;vertical-align:-1px}.pick__dot--empty{background:var(--surface)!important}
    .pick__price{display:grid;text-align:right;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums}.pick__price small{color:var(--muted);font-size:10px;font-weight:600}
    .pick__qty{min-height:36px}
    .pick__empty{padding:24px 0;text-align:center}
    .pick__count{color:var(--ok);font-size:12.5px;font-weight:650;text-align:center}
    @media(max-width:759px){.pick{grid-template-columns:1fr}.pick__side{position:static}.pick__cats{display:flex;flex-wrap:wrap}.pick__cats button{width:auto}}
  `],
})
export class PurchaseDeskPicker {
  /** Products of the supplier that are not on the container yet. */
  readonly products = input.required<Product[]>();
  readonly categoryList = input.required<Category[]>();
  readonly supplierName = input('');

  readonly picked = output<{ product: Product; quantity: number }>();
  readonly create = output<void>();
  readonly closed = output<void>();

  readonly query = signal('');
  readonly category = signal<string | null>(null);
  readonly added = signal(0);
  /** Quantities typed in the sheet, per product; a carton until changed. */
  private readonly draft = signal<Map<number, number>>(new Map());

  /** Category → series → variants, narrowed by the search. */
  private readonly all = computed(() => {
    const words = this.query().trim().toLocaleLowerCase('nl-BE').split(/\s+/).filter(Boolean);
    const matches = (product: Product): boolean => !words.length || words.every((word) =>
      [product.name, product.sku, product.colour, product.variantSize].filter(Boolean).join(' ')
        .toLocaleLowerCase('nl-BE').includes(word));
    const categories = new Map<string, { key: string; label: string; count: number;
      families: Map<string, { key: string; label: string; products: Product[] }> }>();
    for (const product of this.products()) {
      if (!matches(product)) continue;
      const categoryName = this.categoryList().find((category) => category.id === product.categoryId)?.name ?? 'Overig';
      const category = categories.get(categoryName)
        ?? { key: categoryName, label: categoryName, count: 0, families: new Map() };
      categories.set(categoryName, category);
      const familyKey = product.familyId === null ? 'p:' + product.id : 'f:' + product.familyId;
      const family = category.families.get(familyKey) ?? { key: familyKey, label: product.name, products: [] };
      family.products.push(product);
      category.families.set(familyKey, family);
      category.count++;
    }
    return [...categories.values()].map((category) => ({
      ...category, families: [...category.families.values()],
    }));
  });

  readonly categories = computed(() => this.all()
    .map((group) => ({ key: group.key, label: group.label, count: group.count })));

  readonly total = computed(() => this.all().reduce((sum, group) => sum + group.count, 0));

  readonly groups = computed(() => {
    const category = this.category();
    return this.all().filter((group) => category === null || group.key === category);
  });

  readonly strip = stripColour;
  readonly variant = variantOf;

  hex(product: Product): string | null {
    return colourHexOf(product.colourHex, product.colour);
  }

  photoOf(product: Product): string | null {
    return product.photos?.[0]?.url ?? null;
  }

  cartonOf(product: Product): number {
    return product.carton?.piecesPerCarton ?? 1;
  }

  quantityOf(product: Product): number {
    return this.draft().get(product.id!) ?? (this.cartonOf(product) || 1);
  }

  setQuantity(product: Product, quantity: number): void {
    this.draft.update((draft) => new Map(draft).set(product.id!, Math.max(1, Math.floor(quantity || 1))));
  }

  /** Reports the pick; the row leaves the list once the desk has it. */
  pick(product: Product): void {
    this.picked.emit({ product, quantity: this.quantityOf(product) });
    this.draft.update((draft) => { const next = new Map(draft); next.delete(product.id!); return next; });
    this.added.update((count) => count + 1);
  }
}
