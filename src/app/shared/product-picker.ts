import { ChangeDetectionStrategy, Component, OnDestroy, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthImage } from '../core/api/auth-image';
import { Product } from '../core/api/models';
import { Sheet } from './ui';
import { EurPipe, NumPipe } from './pipes';

/**
 * Product kiezen met een zoekveld in plaats van een keuzelijst.
 *
 * Een dropdown met tientallen artikelen is op een telefoon onwerkbaar: je
 * scrolt door een lijst die je niet kan doorzoeken en de namen worden
 * afgekapt. Hier tik je een paar letters, een SKU of een barcode en zie je
 * meteen de foto, de doosinhoud en de voorraad erbij.
 *
 * Het aantal wordt in stuks ingevuld en meteen naar boven afgerond op een
 * volle doos, met de correctie zichtbaar onder het veld — dan is het geen
 * verrassing achteraf.
 */
/** Zo lang blijft een ingetikt aantal staan voor het naar een volle doos springt. */
const SNAP_DELAY_MS = 2000;

@Component({
  selector: 'app-product-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, AuthImage, Sheet, EurPipe, NumPipe],
  template: `
    <app-sheet [title]="heading()" (closed)="cancelled.emit()">
      <div body>
        <div class="search-bar">
          <input
            class="input"
            type="search"
            inputmode="search"
            placeholder="Zoek op naam, kleur, SKU of barcode…"
            [ngModel]="query()"
            (ngModelChange)="query.set($event)"
          />
        </div>

        @if (chosen(); as product) {
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
                    <span>{{ product.sku }} · {{ product.carton.piecesPerCarton }} per doos ·</span>
                    <span class="stock-dot" [class]="'stock-dot--' + stockLevel(product)"></span>
                    <span>{{ stockLabel(product) }}</span>
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
                [ngModel]="quantity()"
                (ngModelChange)="setQuantity(+$event)"
              />
              @if (pending(); as note) {
                <span class="hint warn-text">
                  Wordt zo <b>{{ note.to | num }}</b> — er gaan er
                  {{ product.carton.piecesPerCarton }} in een doos.
                </span>
              } @else if (adjusted(); as note) {
                <span class="hint warn-text">
                  Bijgesteld van {{ note.from | num }} naar <b>{{ note.to | num }}</b>.
                </span>
              } @else {
                <span class="hint">{{ cartons() | num }} volle doos(en).</span>
              }
            </div>

            @if (!hasEnoughStock()) {
              <div class="alert alert--warn mt-8">
                <span class="alert__icon">!</span>
                <div>
                  <b>Onvoldoende voorraad.</b>
                  Er ligt {{ product.stockQuantity | num }} van de {{ quantity() | num }} stuks.
                  Deze regel kan pas mee zodra er een container binnen is — spreek de
                  levertermijn af met de klant.
                </div>
              </div>
            }
          </div>
        } @else {
          <div class="picker-list">
            @for (product of matches(); track product.id) {
              <button class="picker-item" type="button" (click)="choose(product)">
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
                    · {{ product.carton.piecesPerCarton }}/doos
                  </div>
                  <div class="picker-item__meta row" style="gap:5px">
                    <span class="stock-dot" [class]="'stock-dot--' + stockLevel(product)"></span>
                    <span>{{ stockLabel(product) }}</span>
                  </div>
                </div>
                <div class="picker-item__end">{{ price(product) | eur }}</div>
              </button>
            } @empty {
              <div class="empty">
                <div class="empty__title">Niets gevonden</div>
                <div class="empty__text">Probeer een deel van de naam, de SKU of een barcode.</div>
              </div>
            }
          </div>
        }
      </div>

      <div foot style="display:contents">
        <button class="btn" type="button" (click)="cancelled.emit()">Annuleren</button>
        <button
          class="btn btn--primary"
          type="button"
          [disabled]="!chosen() || rounded() <= 0"
          (click)="confirm()"
        >
          Toevoegen
        </button>
      </div>
    </app-sheet>
  `,
  styles: `
    .picker-list { display: flex; flex-direction: column; margin: 0 -16px; }
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
    /* Voorraadstip: rood leeg, oranje krap, groen ruim. Kleur alleen is niet
       genoeg, dus er staat altijd een tekst naast. */
    .stock-dot {
      width: 8px; height: 8px; border-radius: 50%;
      display: inline-block; flex: none;
    }
    .stock-dot--none { background: var(--danger); }
    .stock-dot--low { background: var(--warn); }
    .stock-dot--ok { background: var(--ok); }

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
  /** Prijs die getoond wordt; laat de aanroeper bepalen welke dat is. */
  readonly priceOf = input<(product: Product) => number>((product) =>
    product.fixedSalesPriceEur ?? 0);

  readonly picked = output<{ product: Product; quantity: number }>();
  readonly cancelled = output<void>();

  readonly query = signal('');
  readonly chosen = signal<Product | null>(null);
  readonly quantity = signal(0);
  /** Wat er zonet is bijgesteld, om het onder het veld te melden. */
  readonly adjusted = signal<{ from: number; to: number } | null>(null);
  /** Wat er straks bijgesteld wordt; meteen zichtbaar, nog niet toegepast. */
  readonly pending = signal<{ from: number; to: number } | null>(null);

  private snapTimer: ReturnType<typeof setTimeout> | undefined;

  readonly matches = computed(() => {
    const needle = this.query().toLowerCase().trim();
    const all = this.products();
    if (!needle) return all.slice(0, 50);
    return all
      .filter((product) =>
        [
          product.name, product.sku, product.colour, product.describedAs,
          product.barcodeInner, product.barcodeOuter,
        ]
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
      .slice(0, 50);
  });

  /**
   * Zet het aantal op een volle doos, maar pas nadat je klaar bent met typen.
   *
   * Meteen bijstellen tijdens het tikken maakt het veld onbruikbaar: je typt "2"
   * van "240" en het springt al naar 6. Daarom wordt er twee seconden gewacht
   * nadat de laatste toets is losgelaten. De melding eronder verschijnt wel
   * direct, zodat je ziet wat er gaat gebeuren voor het gebeurt.
   */
  setQuantity(value: number): void {
    const wanted = Math.max(0, value || 0);
    this.quantity.set(wanted);

    const product = this.chosen();
    if (!product) return;

    const per = Math.max(1, product.carton.piecesPerCarton ?? 1);
    const snapped = Math.ceil(wanted / per) * per;

    /* Vooraankondiging: meteen zichtbaar, nog niet toegepast. */
    this.pending.set(snapped !== wanted && wanted > 0 ? { from: wanted, to: snapped } : null);
    this.adjusted.set(null);

    clearTimeout(this.snapTimer);
    if (snapped === wanted || wanted <= 0) return;

    this.snapTimer = setTimeout(() => {
      /* Alleen bijstellen als er intussen niets anders is ingetikt. */
      if (this.quantity() !== wanted) return;
      this.quantity.set(snapped);
      this.pending.set(null);
      this.adjusted.set({ from: wanted, to: snapped });
    }, SNAP_DELAY_MS);
  }

  ngOnDestroy(): void {
    clearTimeout(this.snapTimer);
  }

  /** Genoeg op voorraad voor wat er gevraagd wordt? */
  readonly hasEnoughStock = computed(() => {
    const product = this.chosen();
    return product ? product.stockQuantity >= this.quantity() : true;
  });

  /** Grof niveau voor de stip: leeg, krap of ruim. */
  stockLevel(product: Product): 'none' | 'low' | 'ok' {
    if (product.stockQuantity <= 0) return 'none';
    /* Minder dan tien dozen noemen we krap; daaronder ben je er snel doorheen. */
    return product.stockQuantity < (product.carton.piecesPerCarton ?? 1) * 10 ? 'low' : 'ok';
  }

  stockLabel(product: Product): string {
    if (product.stockQuantity <= 0) return 'geen voorraad — op bestelling';
    return `${product.stockQuantity.toLocaleString('nl-BE')} op voorraad`;
  }

  readonly cartons = computed(() => {
    const product = this.chosen();
    if (!product) return 0;
    const per = Math.max(1, product.carton.piecesPerCarton ?? 1);
    return Math.ceil(Math.max(0, this.quantity()) / per);
  });

  /** Aantal opgeschoven naar een volle doos. */
  readonly rounded = computed(() => {
    const product = this.chosen();
    if (!product) return 0;
    return this.cartons() * Math.max(1, product.carton.piecesPerCarton ?? 1);
  });

  readonly willRound = computed(() => this.rounded() !== this.quantity() && this.quantity() > 0);

  price(product: Product): number {
    return this.priceOf()(product);
  }

  choose(product: Product): void {
    clearTimeout(this.snapTimer);
    this.chosen.set(product);
    this.adjusted.set(null);
    this.pending.set(null);
    this.quantity.set((product.carton.piecesPerCarton ?? 1) * 10);
  }

  clear(): void {
    this.chosen.set(null);
    this.query.set('');
  }

  confirm(): void {
    const product = this.chosen();
    if (!product || this.quantity() <= 0) return;
    /* Loopt de wachttijd nog? Dan hier alsnog afronden - er mag nooit een
       half gevulde doos de order op. */
    clearTimeout(this.snapTimer);
    this.picked.emit({ product, quantity: this.rounded() });
  }
}
