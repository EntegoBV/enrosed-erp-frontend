import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { HomeData } from '../home-data';
import { HomeWidget, amount, count } from './home-w';

/**
 * Voorraad (spec-home §6.6): the known stock cost and its pieces, with the
 * coverage warning when pieces have no cost or products no known stock -
 * the old home's formula, the same as Analyses › Voorraad. In pieces.
 */
@Component({
  selector: 'app-home-voorraad',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HomeWidget],
  template: `
    <app-home-w [variant]="variant()" kind="voorraad" title="Bekende voorraadkost" icon="stock" tone="blue" link="/analyses/inventory" [state]="state()">
      @if (state() === 'ready') {
        <span class="home-w__value">{{ whole(stock().eur) }}</span>
        <span class="home-w__line">{{ count(stock().pieces) }} st met bekende kost</span>
        @if (stock().unvalued || stock().unknown) {
          <span class="home-w__line is-warn">Kostdekking is nog niet volledig@if (stock().unvalued) { · {{ count(stock().unvalued) }} st zonder kost }</span>
        }
      }
    </app-home-w>
  `,
})
export class HomeVoorraad {
  readonly data = inject(HomeData);
  readonly variant = input<'desk' | 'phone'>('desk');
  readonly state = computed(() => this.data.combined('voorraad'));
  readonly whole = amount;
  readonly count = count;
  readonly stock = computed(() => {
    let eur = 0;
    let pieces = 0;
    let unvalued = 0;
    let unknown = 0;
    for (const product of this.data.products()) {
      if (product.inventoryKnown !== true) { unknown++; continue; }
      if (product.stockQuantity <= 0) continue;
      if (product.landedCostEur == null) { unvalued += product.stockQuantity; continue; }
      eur += product.stockQuantity * product.landedCostEur;
      pieces += product.stockQuantity;
    }
    return { eur, pieces, unvalued, unknown };
  });
}
