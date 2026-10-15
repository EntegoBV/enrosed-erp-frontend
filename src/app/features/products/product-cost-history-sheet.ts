import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import type { Product } from '../../core/api/models';
import { DesktopViewport } from '../../core/platform/desktop-viewport';
import { Sheet } from '../../shared/ui';
import { ProductCostHistory } from './product-cost-history';

/**
 * Kostprijshistoriek as a sheet of its own, the one way into the history
 * from the product desk, the phone page, the product editor and the
 * Kostprijzen toepassen sheet of a container (stacked on top of it).
 */
@Component({
  selector: 'app-product-cost-history-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, ProductCostHistory],
  template: `
    <app-sheet title="Kostprijshistoriek" variant="ios" [wide]="desktop.active()" (closed)="closed.emit()">
      <div body class="pch-sheet">
        <p class="pch-sheet__name">{{ product().name }}</p>
        @if (product().id; as id) {
          <app-product-cost-history [productId]="id" [product]="product()" [currentOrderId]="currentOrderId()" [sourceLink]="sourceLink()" />
        }
      </div>
      <div foot style="display:contents">
        <span class="spacer"></span>
        <button class="btn" type="button" (click)="closed.emit()">Sluiten</button>
      </div>
    </app-sheet>
  `,
  styles: `
    .pch-sheet { display: grid; gap: 12px; min-width: 0; }
    .pch-sheet__name { margin: 0; color: var(--muted); font-size: 13px; font-weight: 600; line-height: 1.4; overflow-wrap: anywhere; }
    @media (max-width: 679.98px) { .pch-sheet { padding: 0 16px; } .pch-sheet__name { text-align: center; } }
  `,
})
export class ProductCostHistorySheet {
  protected readonly desktop = inject(DesktopViewport);

  readonly product = input.required<Pick<Product, 'id' | 'name' | 'packaging'>>();
  /** The container the sheet was opened from, if any: its own rows need no link back. */
  readonly currentOrderId = input<number | null>(null);
  /** The cost's source container, shown while the history is still empty. */
  readonly sourceLink = input<{ id: number; text: string } | null>(null);
  readonly closed = output<void>();
}
