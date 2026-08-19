import {
  ChangeDetectionStrategy, Component, OnDestroy, computed, input, output, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PortalCatalogItem } from '../../core/api/models';
import { Sheet } from '../../shared/ui';
import { EurPipe, NumPipe } from '../../shared/pipes';
import { CartonQuantity } from '../../shared/carton-quantity';

/**
 * Adding an item from the customer portal.
 *
 * Same shape as our internal picker: search instead of a long list to scroll
 * through. Stock status is visible up front, because it decides whether the
 * customer gets delivery now or has to wait.
 *
 * Quantities behave exactly like on our side: the rounding notice appears
 * immediately, the field snaps to a full carton two seconds after the last
 * keystroke. A customer typing "240" passes through "2" too.
 */
@Component({
  selector: 'app-portal-product-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet, EurPipe, NumPipe],
  template: `
    <app-sheet [title]="t()('portalAddItem')" [closeLabel]="t()('portalCancel')"
               (closed)="cancelled.emit()">
      <div body>
        <div class="search-bar">
          <input class="input" type="search" inputmode="search"
                 [placeholder]="t()('portalSearch')"
                 [ngModel]="query()" (ngModelChange)="query.set($event)" />
        </div>

        @if (chosen(); as item) {
          <div class="picker-chosen">
            <div class="row">
              @if (item.photoUrl) {
                <img class="picker-photo" [src]="item.photoUrl" alt="" loading="lazy" />
              } @else {
                <div class="picker-photo picker-photo--empty" aria-hidden="true">◈</div>
              }
              <div class="grow">
                <div class="strong">{{ item.description }}</div>
                <div class="small muted">
                  {{ item.unitPrice | eur: 2: locale() }} {{ t()('portalPerPiece') }} ·
                  {{ item.piecesPerCarton }} {{ t()('portalPerBox') }}
                </div>
              </div>
              <button class="btn btn--sm" type="button"
                      (click)="chosen.set(null)">{{ changeLabel() }}</button>
            </div>

            <div class="field mt-12" style="margin-bottom:0">
              <label class="req" for="portal-qty">{{ t()('quantity') }}</label>
              <input class="input num right" id="portal-qty" type="number" min="0" step="1"
                     inputmode="numeric" [ngModel]="carton.value()"
                     (ngModelChange)="carton.set(+$event)" />
              @if (carton.pending(); as note) {
                <span class="hint warn-text">
                  {{ t()('portalRoundingNotice') }} <b>{{ note.to | num: 0: locale() }}</b>
                  ({{ item.piecesPerCarton }} {{ t()('portalPerBox') }})
                </span>
              } @else if (carton.applied(); as note) {
                <span class="hint warn-text">
                  {{ note.from | num: 0: locale() }} → <b>{{ note.to | num: 0: locale() }}</b>
                  ({{ item.piecesPerCarton }} {{ t()('portalPerBox') }})
                </span>
              } @else {
                <span class="hint">
                  {{ t()('portalPerBox') }}: {{ item.piecesPerCarton }}
                  {{ t()('portalPieces') }}.
                </span>
              }
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
                @if (item.photoUrl) {
                  <img class="picker-photo" [src]="item.photoUrl" alt="" loading="lazy" />
                } @else {
                  <div class="picker-photo picker-photo--empty" aria-hidden="true">◈</div>
                }
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
                <div class="picker-item__end">{{ item.unitPrice | eur: 2: locale() }}</div>
              </button>
            } @empty {
              <div class="empty">
                <div class="empty__title">{{ emptyTitle() }}</div>
                <div class="empty__text">{{ emptyText() }}</div>
              </div>
            }
          </div>
        }
      </div>

      <div foot style="display:contents">
        <button class="btn" type="button"
                (click)="cancelled.emit()">{{ t()('portalCancel') }}</button>
        <button class="btn btn--primary" type="button"
                [disabled]="!chosen() || carton.value() <= 0" (click)="confirm()">
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
    .picker-photo {
      width: 48px; height: 48px; flex: none; object-fit: cover;
      border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface-2);
    }
    .picker-photo--empty {
      display: flex; align-items: center; justify-content: center;
      color: var(--muted-2); font-size: 17px;
    }
    .picker-chosen {
      border: 1px solid var(--line-strong); border-radius: var(--r-sm);
      padding: 12px; background: var(--surface-2);
    }
  `,
})
export class PortalProductPicker implements OnDestroy {
  readonly items = input.required<PortalCatalogItem[]>();
  /**
   * Translated texts, handed down from the portal page.
   *
   * A function rather than a map, so the template reads the same as in
   * portal-page: {{ t()('key') }}.
   */
  readonly t = input.required<(key: string) => string>();
  readonly locale = input('nl-BE');
  readonly changeLabel = input('Wijzig');
  readonly emptyTitle = input('Niets gevonden');
  readonly emptyText = input('Probeer een deel van de naam of de kleur.');
  readonly picked = output<{ item: PortalCatalogItem; quantity: number }>();
  readonly cancelled = output<void>();

  readonly query = signal('');
  readonly chosen = signal<PortalCatalogItem | null>(null);
  readonly carton = new CartonQuantity(
    () => this.chosen()?.piecesPerCarton ?? 1, /* snap: */ () => true);

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
    this.carton.reset(item.piecesPerCarton * 10);
  }

  confirm(): void {
    const item = this.chosen();
    if (!item || this.carton.value() <= 0) return;
    this.picked.emit({ item, quantity: this.carton.finalValue() });
  }

  ngOnDestroy(): void {
    this.carton.destroy();
  }
}
