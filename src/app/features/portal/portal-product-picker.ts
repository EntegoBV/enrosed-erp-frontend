import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PortalCatalogItem } from '../../core/api/models';
import { Sheet } from '../../shared/ui';
import { EurPipe } from '../../shared/pipes';

/**
 * Artikel bijbestellen vanuit het klantportaal.
 *
 * Dezelfde vorm als intern: zoeken in plaats van een lange lijst waar de klant
 * doorheen moet scrollen. Wat er niet ligt is meteen zichtbaar, want dat
 * bepaalt of hij vandaag geleverd krijgt of moet wachten.
 */
@Component({
  selector: 'app-portal-product-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet, EurPipe],
  template: `
    <app-sheet [title]="t()('portalAddItem')" (closed)="cancelled.emit()">
      <div body>
        <div class="search-bar">
          <input class="input" type="search" inputmode="search"
                 [placeholder]="t()('portalSearch')"
                 [ngModel]="query()" (ngModelChange)="query.set($event)" />
        </div>

        @if (chosen(); as item) {
          <div class="picker-chosen">
            <div class="row">
              <div class="grow">
                <div class="strong">{{ item.description }}</div>
                <div class="small muted">
                  {{ item.unitPrice | eur: 2 }} {{ t()('portalPerPiece') }} ·
                  {{ item.piecesPerCarton }} {{ t()('portalPerBox') }}
                </div>
              </div>
              <button class="btn btn--sm" type="button" (click)="chosen.set(null)">Wijzig</button>
            </div>

            <div class="field mt-12" style="margin-bottom:0">
              <label class="req" for="portal-qty">{{ t()('quantity') }}</label>
              <input class="input num right" id="portal-qty" type="number" min="0" step="1"
                     inputmode="numeric" [ngModel]="quantity()"
                     (ngModelChange)="quantity.set(+$event)" />
              <span class="hint">
                {{ t()('portalPerBox') }}: {{ item.piecesPerCarton }}
                {{ t()('portalPieces') }}.
              </span>
            </div>

            @if (!item.inStock) {
              <div class="alert alert--warn mt-12">
                <span class="alert__icon">!</span>
                <div>{{ t()('portalOutOfStockWarning') }}</div>
              </div>
            }
          </div>
        } @else {
          <div class="picker-list">
            @for (item of matches(); track item.productId) {
              <button class="picker-item" type="button" (click)="choose(item)">
                <div class="picker-item__body">
                  <div class="picker-item__title">{{ item.description }}</div>
                  <div class="picker-item__meta">
                    {{ item.piecesPerCarton }} {{ t()('portalPerBox') }}
                  </div>
                  <div class="picker-item__meta row" style="gap:5px">
                    <span class="stock-dot"
                          [class.stock-dot--ok]="item.inStock"
                          [class.stock-dot--none]="!item.inStock"></span>
                    <span>{{ item.inStock
                      ? t()('portalInStock') : t()('portalTermToBeDetermined') }}</span>
                  </div>
                </div>
                <div class="picker-item__end">{{ item.unitPrice | eur: 2 }}</div>
              </button>
            } @empty {
              <div class="empty">
                <div class="empty__title">Niets gevonden</div>
                <div class="empty__text">Probeer een deel van de naam of de kleur.</div>
              </div>
            }
          </div>
        }
      </div>

      <div foot style="display:contents">
        <button class="btn" type="button"
                (click)="cancelled.emit()">{{ t()('portalCancel') }}</button>
        <button class="btn btn--primary" type="button"
                [disabled]="!chosen() || quantity() <= 0" (click)="confirm()">
          {{ t()('portalAdd') }}
        </button>
      </div>
    </app-sheet>
  `,
  styles: `
    .picker-list { display: flex; flex-direction: column; margin: 0 -16px; }
    .picker-item {
      display: flex; align-items: center; gap: 12px; width: 100%;
      padding: 11px 16px; border: 0; border-bottom: 1px solid var(--line);
      background: transparent; text-align: left; cursor: pointer; min-height: 58px;
    }
    .picker-item:active { background: var(--surface-2); }
    .picker-item__body { flex: 1; min-width: 0; }
    .picker-item__title { font-size: 14.5px; font-weight: 620; }
    .picker-item__meta { font-size: 12px; color: var(--muted); }
    .picker-item__end { font-weight: 650; font-variant-numeric: tabular-nums; }
    .picker-chosen {
      border: 1px solid var(--line-strong); border-radius: var(--r-sm);
      padding: 12px; background: var(--surface-2);
    }
  `,
})
export class PortalProductPicker {
  readonly items = input.required<PortalCatalogItem[]>();
  /**
   * De vertaalde teksten, doorgegeven vanuit het portaal.
   *
   * Als functie in plaats van als map, zodat de sjabloon er net zo uitziet als
   * in portal-page: {{ t()('sleutel') }}.
   */
  readonly t = input.required<(key: string) => string>();
  readonly picked = output<{ item: PortalCatalogItem; quantity: number }>();
  readonly cancelled = output<void>();

  readonly query = signal('');
  readonly chosen = signal<PortalCatalogItem | null>(null);
  readonly quantity = signal(0);

  readonly matches = computed(() => {
    const needle = this.query().toLowerCase().trim();
    const all = this.items();
    if (!needle) return all.slice(0, 50);
    return all
      .filter((item) => item.description.toLowerCase().includes(needle))
      .slice(0, 50);
  });

  choose(item: PortalCatalogItem): void {
    this.chosen.set(item);
    this.quantity.set(item.piecesPerCarton * 10);
  }

  confirm(): void {
    const item = this.chosen();
    if (!item || this.quantity() <= 0) return;
    const per = Math.max(1, item.piecesPerCarton);
    this.picked.emit({ item, quantity: Math.ceil(this.quantity() / per) * per });
  }
}
