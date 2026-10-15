import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { resultAnalysis } from '../../analyses/analysis-metrics';
import { HomeData } from '../home-data';
import { HomeWidget, amount } from './home-w';

/**
 * Resultaat (spec-home §6.4): this year's result with its margin and own
 * costs, and this month's costs in the warn tone; the card turns dark below
 * zero, as on the old home. The windows follow the day.
 */
@Component({
  selector: 'app-home-resultaat',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HomeWidget],
  template: `
    <app-home-w [variant]="variant()" kind="resultaat" title="Resultaat dit jaar" icon="analytics" tone="plum" link="/analyses/result"
                [state]="state()" [dark]="state() === 'ready' && year().resultEur < 0">
      @if (state() === 'ready') {
        <span class="home-w__value">{{ whole(year().resultEur) }}</span>
        <span class="home-w__line">marge {{ whole(year().marginEur) }} · eigen kosten {{ whole(year().costsEur) }}</span>
        <span class="home-w__line is-warn">{{ whole(monthCosts()) }} kosten deze maand</span>
      }
    </app-home-w>
  `,
})
export class HomeResultaat {
  readonly data = inject(HomeData);
  readonly variant = input<'desk' | 'phone'>('desk');
  readonly state = computed(() => this.data.combined('verkoop', 'inkoop', 'kosten'));
  readonly whole = amount;
  readonly year = computed(() => resultAnalysis(this.data.salesOrders(), this.data.purchases(), this.data.costs(),
    { from: this.data.windows().yearStart, to: this.data.today() }));
  readonly monthCosts = computed(() => resultAnalysis([], [], this.data.costs(),
    { from: this.data.windows().monthStart, to: this.data.today() }).costsEur);
}
