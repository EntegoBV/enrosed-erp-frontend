import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { type ResultOptions, resultAnalysis } from '../../analyses/analysis-metrics';
import { withTicaResult } from '../../analyses/tica-analysis';
import { costChargeIn, openOf } from '../../finance/finance-metrics';
import { HomeData } from '../home-data';
import { dayMonthShort } from '../home-figures';
import { HomeWidget, amount } from './home-w';

/**
 * Resultaat (spec-home §6.4, design §2.1): this year's result - red below
 * zero, no dark card - over its period ("1 jan – 16 okt"), and beside it
 * Marge, Eigen kosten and this month's costs (warn tone) as label/value
 * rows. The windows follow the day. The year adds TICA as Analyses does
 * (withTicaResult, design/analyses2 D-H1: the commission is already a cost);
 * without the TICA days the result and the margin read "—".
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
            <span class="home-w__value" [class.is-neg]="year().resultEur < 0">{{ ticaFailed() ? '—' : whole(year().resultEur) }}</span>
            @if (desk) { <span class="home-w__line">{{ period() }}</span> }
          </div>
          <dl class="home-w__kv">
            <div [class.is-neg]="!ticaFailed() && year().marginEur < 0"><dt>Marge</dt><dd>{{ ticaFailed() ? '—' : whole(year().marginEur) }}</dd></div>
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
  /* The year waits for the TICA days on the first load, so the figure never jumps by the TICA margin. */
  readonly state = computed(() => {
    const state = this.data.combined('verkoop', 'inkoop', 'kosten');
    return state === 'ready' && this.data.ticaState() === 'loading' ? 'loading' : state;
  });
  readonly ticaFailed = computed(() => this.data.ticaState() === 'failed');
  readonly whole = amount;
  /* The options of Analyses › Resultaat (investments charge their depreciation, open amounts read the payments): one figure in both places. */
  readonly year = computed(() => withTicaResult(resultAnalysis(this.data.salesOrders(), this.data.purchases(), this.data.costs(),
    { from: this.data.windows().yearStart, to: this.data.today(), ...this.money() }), this.data.ticaDays()));
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
