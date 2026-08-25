import { ChangeDetectionStrategy, Component, OnDestroy, computed, input, output, signal } from '@angular/core';
import { CartonQuantity } from './carton-quantity';
import { FormsModule } from '@angular/forms';
import { AuthImage } from '../core/api/auth-image';
import { Product } from '../core/api/models';
import { Sheet } from './ui';
import { EurPipe, NumPipe } from './pipes';

/**
 * Picking a product with a search field instead of a dropdown.
 *
 * A dropdown of dozens of articles is unworkable on a phone: you scroll a
 * list you cannot search and the names get clipped. Here you type a few
 * letters, a SKU or a barcode and see the photo, the carton content and
 * the stock right away.
 *
 * The quantity is entered in pieces and rounded up to a full carton at
 * once, with the correction visible under the field — no surprise
 * afterwards.
 */
/** Everything the quick-create form measures; the parent builds the product. */
export interface ProductDraft {
  name: string;
  lengthCm: number | null; widthCm: number | null; heightCm: number | null;
  cartonLengthCm: number | null; cartonWidthCm: number | null; cartonHeightCm: number | null;
  piecesPerCarton: number;
  weightKg: number | null;
  exwPrice: number;
  exwCurrency: string;
}

@Component({
  selector: 'app-product-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AuthImage, Sheet, EurPipe, NumPipe],
  template: `
    <app-sheet [title]="heading()" (closed)="cancelled.emit()">
      <div body>
        @if (!createMode()) {
        <div class="search-bar">
          <input
            class="input"
            type="search"
            inputmode="search"
            placeholder="Zoek op naam, kleur, maat, SKU of barcode…"
            [ngModel]="query()"
            (ngModelChange)="searchAgain($event)"
          />
        </div>
        }

        @if (createMode()) {
          <!-- Measure the article in your hand and go: everything the
               calculation needs, nothing it does not. Optional fields can
               stay empty and be completed later on the product. -->
          <div class="field">
            <label class="req" for="qc-name">Naam</label>
            <input class="input" id="qc-name" [ngModel]="draftName()"
                   (ngModelChange)="draftName.set($event)" />
          </div>
          <div class="field">
            <label for="qc-size">Afmeting product (B × D × H cm) <span class="opt"></span></label>
            <div class="dims-row" id="qc-size">
              <input class="input num right" type="number" min="0" placeholder="B"
                     [ngModel]="draftL()" (ngModelChange)="draftL.set($event)" />
              <input class="input num right" type="number" min="0" placeholder="D"
                     [ngModel]="draftW()" (ngModelChange)="draftW.set($event)" />
              <input class="input num right" type="number" min="0" placeholder="H"
                     [ngModel]="draftH()" (ngModelChange)="draftH.set($event)" />
            </div>
          </div>
          <div class="field">
            <label for="qc-carton">Omdoos (B × D × H cm) <span class="opt"></span></label>
            <div class="dims-row" id="qc-carton">
              <input class="input num right" type="number" min="0" placeholder="B"
                     [ngModel]="draftCL()" (ngModelChange)="draftCL.set($event)" />
              <input class="input num right" type="number" min="0" placeholder="D"
                     [ngModel]="draftCW()" (ngModelChange)="draftCW.set($event)" />
              <input class="input num right" type="number" min="0" placeholder="H"
                     [ngModel]="draftCH()" (ngModelChange)="draftCH.set($event)" />
            </div>
            <span class="hint">De omdoos bepaalt het volume in de container.</span>
          </div>
          <div class="field-row">
            <div class="field">
              <label class="req" for="qc-per">Stuks per doos</label>
              <input class="input num right" id="qc-per" type="number" min="1"
                     [ngModel]="draftPer()" (ngModelChange)="draftPer.set($event)" />
            </div>
            <div class="field">
              <label for="qc-weight">Gewicht/doos kg <span class="opt"></span></label>
              <input class="input num right" id="qc-weight" type="number" min="0" step="0.1"
                     [ngModel]="draftWeight()" (ngModelChange)="draftWeight.set($event)" />
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label class="req" for="qc-exw">EXW-prijs per stuk</label>
              <input class="input num right" id="qc-exw" type="number" min="0" step="0.01"
                     [ngModel]="draftExw()" (ngModelChange)="draftExw.set($event)" />
            </div>
            <div class="field">
              <label for="qc-cur">Munt</label>
              <select class="select" id="qc-cur" [ngModel]="draftCurrency()"
                      (ngModelChange)="draftCurrency.set($event)">
                <option value="USD">USD</option>
                <option value="CNY">CNY</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
          </div>
        } @else if (chosen(); as product) {
          <div class="picker-chosen">
            <div class="row">
              @if (product.photos.length) {
                <img class="thumb" [appAuthSrc]="product.photos[0].url" [alt]="product.name" />
              } @else {
                <div class="thumb thumb--placeholder">◈</div>
              }
              <div class="grow">
                <div class="strong">{{ product.describedAs }}</div>
                <div class="small muted">
                  <span class="row wrap" style="gap:5px">
                    <span>
                      {{ product.sku }}
                      · {{ product.carton.piecesPerCarton }} per doos
                    </span>
                    @if (stockAware()) {
                      <span>·</span>
                      <span class="stock-dot" [class]="'stock-dot--' + stockLevel(product)"></span>
                      <span>{{ stockLabel(product) }}</span>
                    }
                  </span>
                </div>
              </div>
              <button class="btn btn--sm" type="button" (click)="clear()">Wijzig</button>
            </div>

            <div class="field mt-12">
              <label class="req" for="pick-qty">Aantal stuks</label>
              <input
                class="input num right"
                id="pick-qty"
                type="number"
                min="0"
                step="1"
                inputmode="numeric"
                [ngModel]="carton.value()"
                (ngModelChange)="carton.set(+$event)"
              />
              @if (carton.pending(); as note) {
                <span class="hint warn-text">
                  @if (enforceCartons()) {
                    Wordt zo <b>{{ note.to | num }}</b> — er gaan er
                    {{ product.carton.piecesPerCarton }} in een doos.
                  } @else {
                    Geen volle doos — er gaan er {{ product.carton.piecesPerCarton }} in
                    een doos. Bij inkoop mag dat, bijvoorbeeld voor stalen.
                  }
                </span>
              } @else if (carton.applied(); as note) {
                <span class="hint warn-text">
                  Bijgesteld van {{ note.from | num }} naar <b>{{ note.to | num }}</b>.
                </span>
              } @else {
                <span class="hint">{{ cartons() | num }} volle doos(en).</span>
              }
            </div>

            <!-- Stock only matters when selling from it; a purchase is
                 what fills it, so there the warnings would be nonsense. -->
            @if (!stockAware()) {
            } @else if (!product.inventoryKnown) {
              <div class="alert alert--warn mt-8">
                <span class="alert__icon">?</span>
                <div>
                  <b>Voorraad nog niet bevestigd.</b>
                  Controleer de levertermijn voordat je deze regel aan de klant toezegt.
                </div>
              </div>
            } @else if (!hasEnoughStock()) {
              <div class="alert alert--warn mt-8">
                <span class="alert__icon">!</span>
                <div>
                  <b>Onvoldoende voorraad.</b>
                  Er ligt {{ product.stockQuantity | num }} van de {{ carton.value() | num }} stuks.
                  Deze regel kan pas mee zodra er een container binnen is — spreek de
                  levertermijn af met de klant.
                </div>
              </div>
            }
          </div>
        } @else if (quantityStep()) {
          <!-- Several products at once: every chosen product gets its
               number here, then the whole batch lands on the order. -->
          <div class="picker-batch">
            @for (entry of batch(); track entry.product.id) {
              <div class="picker-batch__row">
                @if (entry.product.photos.length) {
                  <img class="thumb" [appAuthSrc]="entry.product.photos[0].url" [alt]="entry.product.name" />
                } @else {
                  <div class="thumb thumb--placeholder">◈</div>
                }
                <div class="picker-batch__body">
                  <div class="strong">{{ entry.product.name }}</div>
                  <div class="small muted">
                    {{ entry.product.sku }}@if (entry.product.colour) { · {{ entry.product.colour }}}
                    · {{ entry.product.carton.piecesPerCarton }}/doos
                    @if (entry.quantity > 0 && (entry.product.carton.piecesPerCarton ?? 0) > 0) {
                      · {{ entry.quantity / (entry.product.carton.piecesPerCarton ?? 1) | num: 1 }} doos(en)
                    }
                  </div>
                </div>
                <input class="input num right picker-batch__qty" type="number" min="0" step="1" inputmode="numeric"
                       [attr.aria-label]="'Aantal stuks ' + entry.product.name"
                       [ngModel]="entry.quantity" (ngModelChange)="setBatchQuantity(entry.product.id!, +$event)" />
                <button class="picker-batch__remove" type="button" [attr.aria-label]="entry.product.name + ' weglaten'"
                        (click)="toggle(entry.product)">×</button>
              </div>
            }
          </div>
          <span class="hint">Aantal stuks per product; start op één doos. Een halve doos mag bij inkoop.</span>
        } @else {
          <div class="picker-list">
            @for (product of matches(); track product.id) {
              <button class="picker-item" type="button" [class.picker-item--selected]="isSelected(product)"
                      [attr.aria-pressed]="mode() === 'multi' ? isSelected(product) : null"
                      (click)="mode() === 'multi' ? toggle(product) : choose(product)">
                @if (mode() === 'multi') {
                  <span class="picker-item__check" aria-hidden="true">{{ isSelected(product) ? '✓' : '' }}</span>
                }
                @if (product.photos.length) {
                  <img class="thumb" [appAuthSrc]="product.photos[0].url" [alt]="product.name" />
                } @else {
                  <div class="thumb thumb--placeholder">◈</div>
                }
                <div class="picker-item__body">
                  <div class="picker-item__title">{{ product.name }}</div>
                  <div class="picker-item__meta">
                    {{ product.sku }}
                    @if (product.colour) { · {{ product.colour }} }
                    @if (product.variantSize) { · {{ product.variantSize }} }
                    · {{ product.carton.piecesPerCarton }}/doos
                  </div>
                  @if (stockAware()) {
                    <div class="picker-item__meta row" style="gap:5px">
                      <span class="stock-dot" [class]="'stock-dot--' + stockLevel(product)"></span>
                      <span>{{ stockLabel(product) }}</span>
                    </div>
                  }
                </div>
                <div class="picker-item__end">{{ price(product) | eur }}</div>
              </button>
            } @empty {
              <div class="empty">
                <div class="empty__title">Niets gevonden</div>
                <div class="empty__text">Probeer een deel van de naam, kleur, maat, SKU of barcode.</div>
                @if (allowCreate() && query().trim().length >= 2) {
                  <!-- Straight from the gap to a new product: at a fair the
                       article in your hand often is not in the system yet. -->
                  <button class="btn btn--primary mt-8" type="button"
                          (click)="startCreate()">
                    + „{{ query().trim() }}" aanmaken en toevoegen
                  </button>
                }
              </div>
            }
          </div>
          @if (allowCreate()) {
            <!-- Always reachable, not only when the search comes up empty:
                 you should not have to type to discover it. -->
            <button class="btn btn--block btn--quiet mt-8" type="button"
                    (click)="startCreate()">
              + Nieuw product aanmaken
            </button>
          }
        }
      </div>

      <div foot style="display:contents">
        @if (createMode()) {
          <button class="btn" type="button" (click)="createMode.set(false)">Terug</button>
          <button class="btn btn--primary" type="button"
                  [disabled]="!draftName().trim() || draftPer() < 1"
                  (click)="submitCreate()">Aanmaken en toevoegen</button>
        } @else if (mode() === 'multi' && quantityStep()) {
          <button class="btn" type="button" (click)="quantityStep.set(false)">Terug</button>
          <span class="spacer"></span>
          <button class="btn btn--primary" type="button" [disabled]="!batchReady()" (click)="confirmBatch()">
            {{ batch().length }} product{{ batch().length === 1 ? '' : 'en' }} toevoegen
          </button>
        } @else if (mode() === 'multi') {
          <button class="btn" type="button" (click)="cancelled.emit()">Annuleren</button>
          <span class="spacer"></span>
          <button class="btn btn--primary" type="button" [disabled]="!selected().size" (click)="toQuantities()">
            @if (selected().size) { {{ selected().size }} gekozen · aantallen › } @else { Kies producten }
          </button>
        } @else {
        <button class="btn" type="button" (click)="cancelled.emit()">Annuleren</button>
        <button
          class="btn btn--primary"
          type="button"
          [disabled]="!chosen() || carton.value() <= 0"
          (click)="confirm()"
        >
          Toevoegen
        </button>
        }
      </div>
    </app-sheet>
  `,
  styles: `
    .dims-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
    .picker-list { display: flex; flex-direction: column; margin: 0 -16px; }
    .picker-item--selected { background: var(--rose-soft); }
    .picker-item__check { flex: 0 0 auto; width: 22px; height: 22px; display: inline-flex; align-items: center;
      justify-content: center; border: 1.5px solid var(--line-strong); border-radius: 6px; background: var(--surface);
      color: var(--rose-dark); font-size: 13px; font-weight: 800; }
    .picker-item--selected .picker-item__check { border-color: var(--rose); background: var(--rose); color: #fff; }
    .picker-batch { display: grid; }
    .picker-batch__row { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--line); }
    .picker-batch__body { flex: 1; min-width: 0; }
    .picker-batch__body .strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .picker-batch__qty { width: 96px; }
    .picker-batch__remove { width: 28px; height: 28px; border: 0; border-radius: 50%; background: transparent;
      color: var(--muted); font-size: 20px; line-height: 1; cursor: pointer; }
    .picker-batch__remove:hover { background: var(--surface-2); color: var(--ink); }
    .picker-item {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 10px 16px;
      border: 0;
      border-bottom: 1px solid var(--line);
      background: transparent;
      text-align: left;
      cursor: pointer;
      min-height: 60px;
    }
    .picker-item:active { background: var(--surface-2); }
    .picker-item__body { flex: 1; min-width: 0; }
    .picker-item__title { font-size: 14.5px; font-weight: 620; }
    .picker-item__meta { font-size: 12px; color: var(--muted); }
    .picker-item__end { font-weight: 650; font-variant-numeric: tabular-nums; }
    /* Stock dot: red empty, orange tight, green ample. Colour alone is not
       enough, so a text always sits next to it. */
    .stock-dot {
      width: 8px; height: 8px; border-radius: 50%;
      display: inline-block; flex: none;
    }
    .stock-dot--none { background: var(--danger); }
    .stock-dot--low { background: var(--warn); }
    .stock-dot--ok { background: var(--ok); }
    .stock-dot--unknown { background: var(--muted); }

    .picker-chosen {
      border: 1px solid var(--line-strong);
      border-radius: var(--r-sm);
      padding: 12px;
      background: var(--surface-2);
    }
  `,
})
export class ProductPicker implements OnDestroy {
  readonly heading = input('Product toevoegen');
  readonly products = input.required<Product[]>();
  /** The price to display; the caller decides which one that is. */
  readonly priceOf = input<(product: Product) => number>((product) =>
    product.computedSalesPriceEur);
  /**
   * Whether quantities snap to full cartons.
   *
   * Sales orders must (half a carton breaks volume, pallets and freight
   * further down). Purchasing only warns: a supplier can perfectly well ship
   * a three-piece sample, and silently inflating an order to a supplier costs
   * real money.
   */
  readonly enforceCartons = input(true);

  readonly picked = output<{ product: Product; quantity: number }>();
  /** Multi mode: the whole batch at once, each with its quantity. */
  readonly pickedMany = output<{ product: Product; quantity: number }[]>();
  readonly cancelled = output<void>();
  /** 'single': pick one, type its number. 'multi': tick several, then numbers for all. */
  readonly mode = input<'single' | 'multi'>('single');
  /** Whether stock levels and shortfall warnings are shown - selling from stock cares, buying does not. */
  readonly stockAware = input(true);

  /* ---- multi mode ---- */
  readonly selected = signal(new Map<number, { product: Product; quantity: number }>());
  readonly quantityStep = signal(false);

  /**
   * Typing in the search always searches, also from the quantity step:
   * the sheet walks back to the list with the picks kept, so one more
   * product is a few letters away instead of a dead field.
   */
  searchAgain(value: string): void {
    this.query.set(value);
    if (this.quantityStep()) this.quantityStep.set(false);
  }
  readonly batch = computed(() => [...this.selected().values()]);
  readonly batchReady = computed(() => this.batch().length > 0 && this.batch().every((entry) => entry.quantity > 0));

  isSelected(product: Product): boolean {
    return this.selected().has(product.id!);
  }

  toggle(product: Product): void {
    this.selected.update((map) => {
      const next = new Map(map);
      if (next.has(product.id!)) next.delete(product.id!);
      else next.set(product.id!, { product, quantity: product.carton.piecesPerCarton ?? 1 });
      return next;
    });
    if (this.quantityStep() && !this.selected().size) this.quantityStep.set(false);
  }

  toQuantities(): void {
    if (this.selected().size) this.quantityStep.set(true);
  }

  setBatchQuantity(productId: number, quantity: number): void {
    this.selected.update((map) => {
      const entry = map.get(productId);
      if (!entry) return map;
      return new Map(map).set(productId, { ...entry, quantity: Math.max(0, Math.round(quantity || 0)) });
    });
  }

  confirmBatch(): void {
    if (!this.batchReady()) return;
    this.pickedMany.emit(this.batch());
  }
  /** When on, an empty search offers creating the product right there. */
  readonly allowCreate = input(false);
  /** Default currency for a quick-created product (the supplier's). */
  readonly createCurrency = input('USD');
  readonly create = output<ProductDraft>();

  /* Quick-create: measure the article in your hand, fill it in here, and
     it lands on the order without leaving the sheet. */
  readonly createMode = signal(false);
  readonly draftName = signal('');
  readonly draftL = signal<number | null>(null);
  readonly draftW = signal<number | null>(null);
  readonly draftH = signal<number | null>(null);
  readonly draftCL = signal<number | null>(null);
  readonly draftCW = signal<number | null>(null);
  readonly draftCH = signal<number | null>(null);
  readonly draftPer = signal(1);
  readonly draftWeight = signal<number | null>(null);
  readonly draftExw = signal(0);
  readonly draftCurrency = signal('USD');

  startCreate(): void {
    this.draftName.set(this.query().trim());
    this.draftCurrency.set(this.createCurrency());
    this.createMode.set(true);
  }

  submitCreate(): void {
    this.create.emit({
      name: this.draftName().trim(),
      lengthCm: this.draftL(), widthCm: this.draftW(), heightCm: this.draftH(),
      cartonLengthCm: this.draftCL(), cartonWidthCm: this.draftCW(),
      cartonHeightCm: this.draftCH(),
      piecesPerCarton: Math.max(1, Math.round(this.draftPer() || 1)),
      weightKg: this.draftWeight(),
      exwPrice: this.draftExw() || 0,
      exwCurrency: this.draftCurrency(),
    });
    this.createMode.set(false);
  }

  readonly query = signal('');
  readonly chosen = signal<Product | null>(null);
  readonly carton = new CartonQuantity(
    () => this.chosen()?.carton.piecesPerCarton ?? 1,
    () => this.enforceCartons());

  readonly matches = computed(() => {
    const needle = this.query().toLowerCase().trim();
    /* Name first, colour second: a family's variants stand side by side
       with the colours in a fixed order, instead of database order. */
    /* Colour groups first (all Rood together), alphabetical inside each;
       colourless products close the list. */
    const all = this.products().slice().sort((a, b) =>
      Number(!a.colour) - Number(!b.colour)
      || (a.colour ?? '').localeCompare(b.colour ?? '', 'nl')
      || a.name.localeCompare(b.name, 'nl'));
    if (!needle) return all.slice(0, 50);
    return all
      .filter((product) =>
        [
          product.name, product.sku, product.colour, product.variantSize, product.describedAs,
          product.barcodeInner, product.barcodeOuter,
        ]
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
      .slice(0, 50);
  });

  ngOnDestroy(): void {
    this.carton.destroy();
  }

  /** Enough stock for what is being asked? */
  readonly hasEnoughStock = computed(() => {
    const product = this.chosen();
    return product ? !product.inventoryKnown || product.stockQuantity >= this.carton.value() : true;
  });

  /** Grof niveau voor de stip: leeg, krap of ruim. */
  stockLevel(product: Product): 'none' | 'low' | 'ok' | 'unknown' {
    if (!product.inventoryKnown) return 'unknown';
    if (product.stockQuantity <= 0) return 'none';
    /* Under ten cartons we call tight; below that you run out fast. */
    return product.stockQuantity < (product.carton.piecesPerCarton ?? 1) * 10 ? 'low' : 'ok';
  }

  stockLabel(product: Product): string {
    if (!product.inventoryKnown) return 'voorraad nog niet bevestigd';
    if (product.stockQuantity <= 0) return 'geen voorraad — op bestelling';
    return `${product.stockQuantity.toLocaleString('nl-BE')} op voorraad`;
  }

  readonly cartons = computed(() => {
    const product = this.chosen();
    if (!product) return 0;
    const per = Math.max(1, product.carton.piecesPerCarton ?? 1);
    return Math.ceil(Math.max(0, this.carton.value()) / per);
  });

  price(product: Product): number {
    return this.priceOf()(product);
  }

  choose(product: Product): void {
    this.chosen.set(product);
    /* One carton as the starting point: at the table you type the real
       number anyway, and ten boxes preloaded reads as a pushy default. */
    this.carton.reset(product.carton.piecesPerCarton ?? 1);
  }

  clear(): void {
    this.chosen.set(null);
    this.query.set('');
  }

  confirm(): void {
    const product = this.chosen();
    if (!product || this.carton.value() <= 0) return;
    this.picked.emit({ product, quantity: this.carton.finalValue() });
  }
}
