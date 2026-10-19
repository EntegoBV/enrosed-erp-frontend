import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { type ResultOptions, resultAnalysis } from '../../analyses/analysis-metrics';
import { costChargeIn, openOf } from '../../finance/finance-metrics';
import { HomeData } from '../home-data';
import { dayMonthShort } from '../home-figures';
import { HomeWidget, amount } from './home-w';

/**
 * Resultaat (spec-home §6.4, design §2.1): this year's result - red below
 * zero, no dark card - over its period ("1 jan – 16 okt"), and beside it
 * Marge, Eigen kosten and this month's costs (warn tone) as label/value
 * rows. The windows follow the day.
 */
@Component({
  selector: 'app-home-resultaat',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HomeWidget],
  template: `
    <app-home-w [variant]="variant()" kind="resultaat" title="Resultaat dit jaar" icon="analytics" tone="plum" link="/analyses/result"
                [state]="state()">
      @if (state() === 'ready') {
        @let desk = variant() === 'desk';
        <div class="home-w__split home-w__split--kv">
          <div class="home-w__lead">
            <span class="home-w__value" [class.is-neg]="year().resultEur < 0">{{ whole(year().resultEur) }}</span>
            @if (desk) { <span class="home-w__line">{{ period() }}</span> }
          </div>
          <dl class="home-w__kv">
            <div [class.is-neg]="year().marginEur < 0"><dt>Marge</dt><dd>{{ whole(year().marginEur) }}</dd></div>
            <div><dt>Eigen kosten</dt><dd>{{ whole(year().costsEur) }}</dd></div>
            <div class="is-warn"><dt>Kosten {{ desk ? data.windows().monthName : monthShort() }}</dt><dd>{{ whole(monthCosts()) }}</dd></div>
          </dl>
        </div>
      }
    </app-home-w>
  `,
})
export class HomeResultaat {
  readonly data = inject(HomeData);
  readonly variant = input<'desk' | 'phone'>('desk');
  readonly state = computed(() => this.data.combined('verkoop', 'inkoop', 'kosten'));
  readonly whole = amount;
  /* The options of Analyses › Resultaat (investments charge their depreciation, open amounts read the payments): one figure in both places. */
  readonly year = computed(() => resultAnalysis(this.data.salesOrders(), this.data.purchases(), this.data.costs(),
    { from: this.data.windows().yearStart, to: this.data.today(), ...this.money() }));
  readonly monthCosts = computed(() => resultAnalysis([], [], this.data.costs(),
    { from: this.data.windows().monthStart, to: this.data.today(), ...this.money() }).costsEur);
  private money(): ResultOptions {
    const today = this.data.today();
    return { costCharge: (cost, from, to) => costChargeIn(cost, from, to, today), openEur: openOf, today };
  }
  /** "1 jan – 16 okt". */
  readonly period = computed(() => `${dayMonthShort(this.data.windows().yearStart)} – ${dayMonthShort(this.data.today())}`);
  /** "okt": the phone's "Kosten okt". */
  readonly monthShort = computed(() => dayMonthShort(this.data.windows().monthStart).split(' ')[1]);
}
