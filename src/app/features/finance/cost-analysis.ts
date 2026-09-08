import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { EurPipe, PctPipe } from '../../shared/pipes';
import { TrendChart, TrendSeries } from '../../shared/trend-chart';
import { channelLabel } from '../sales/sales-channels';
import { categoryLabel } from './cost-categories';
import { costSummary } from './cost-metrics';
import { inclOf, monthlyCostSeries, yearComparison } from './finance-metrics';
import { TODAY, YEAR } from './finance-sections';
import { FinanceState } from './finance-state';

const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Where the money goes: per category, per channel, fixed against one-off, and month by month against last year. */
@Component({
  selector: 'app-cost-analysis',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EurPipe, PctPipe, TrendChart],
  template: `
    <div class="fin-filters" role="group" aria-label="Jaar">
      @for (option of years(); track option) {
        <button class="fin-chip" type="button" [class.on]="year() === option" (click)="year.set(option)">{{ option === 0 ? 'Alles' : option }}</button>
      }
    </div>

    <section class="fin-kpis fin-kpis--4" aria-label="Samenvatting">
      <article class="card fin-kpi fin-kpi--dark"><small>Kosten excl. btw</small><strong>{{ summary().exclEur | eur: 0 }}</strong><span>{{ summary().count }} {{ summary().count === 1 ? 'kost' : 'kosten' }} · {{ summary().vatEur | eur: 0 }} btw</span></article>
      <article class="card fin-kpi"><small>Vast tegenover eenmalig</small><strong>{{ split().recurringPct | pct: 0 }} vast</strong><span>{{ split().recurringEur | eur: 0 }} vast · {{ split().onceEur | eur: 0 }} eenmalig</span></article>
      <article class="card fin-kpi" [class.fin-kpi--warn]="summary().unpaidCount > 0"><small>Betaald tegenover open</small><strong>{{ paid().paidEur | eur: 0 }}</strong><span>{{ summary().unpaidEur | eur: 0 }} nog open, incl. btw</span></article>
      <article class="card fin-kpi"><small>Gemiddeld per maand</small><strong>{{ perMonth() | eur: 0 }}</strong><span>{{ monthsCounted() }} {{ monthsCounted() === 1 ? 'maand' : 'maanden' }} met kosten</span></article>
    </section>

    <section class="card fin-panel">
      <header class="fin-panel__head"><div><span class="section-kicker">Verloop</span><h2>Laatste twaalf maanden</h2></div></header>
      <app-trend-chart [series]="series()" prefix="€ " [decimals]="0" [height]="150" ariaLabel="Kosten per maand" emptyText="Nog geen kosten geboekt" />
    </section>

    <div class="fin-cols">
      <section class="card fin-panel">
        <header class="fin-panel__head"><div><span class="section-kicker">Per categorie</span><h2>Waar het geld naartoe gaat</h2></div></header>
        @if (!summary().byCategory.length) { <p class="fin-empty">Niets in deze periode.</p> }
        <ul class="fin-bars">
          @for (row of summary().byCategory; track row.category) {
            <li>
              <b>{{ categoryLabel(row.category) }}</b>
              <small>{{ row.count }} {{ row.count === 1 ? 'kost' : 'kosten' }}</small>
              <strong>{{ row.exclEur | eur: 0 }}</strong>
              <em>{{ row.sharePct | pct: 0 }}</em>
              <span class="fin-bars__bar"><i [style.width.%]="row.sharePct"></i></span>
            </li>
          }
        </ul>
      </section>

      <section class="card fin-panel">
        <header class="fin-panel__head"><div><span class="section-kicker">Per verkoopkanaal</span><h2>Kosten die bij een kanaal horen</h2></div></header>
        <ul class="fin-bars">
          @for (row of byChannel(); track row.channel ?? 'ALGEMEEN') {
            <li>
              <b>{{ row.channel ? channelLabel(row.channel) : 'Algemene kosten' }}</b>
              <small>{{ row.count }} {{ row.count === 1 ? 'kost' : 'kosten' }}</small>
              <strong>{{ row.exclEur | eur: 0 }}</strong>
              <em>{{ row.sharePct | pct: 0 }}</em>
              <span class="fin-bars__bar"><i [style.width.%]="row.sharePct"></i></span>
            </li>
          }
        </ul>
        <p class="fin-panel__hint">Een standhuur bij TICA of een beurs telt in het resultaat van dat kanaal; de rest is algemeen.</p>
      </section>
    </div>

    @if (year() > 0) {
      <section class="card fin-panel">
        <header class="fin-panel__head"><div><span class="section-kicker">Maand na maand</span><h2>{{ year() }} tegenover {{ year() - 1 }}</h2></div>
          <strong class="fin-panel__total">{{ compareTotal().thisYearEur | eur: 0 }} <small>vs {{ compareTotal().lastYearEur | eur: 0 }}</small></strong></header>
        <div class="fin-months">
          @for (row of compare(); track row.month) {
            <div class="fin-months__row" [class.fin-months__row--quiet]="!row.thisYearEur && !row.lastYearEur">
              <span class="fin-months__label">{{ monthName(row.month) }}</span>
              <span class="fin-months__bars">
                <i class="fin-months__this" [style.width.%]="compareMax() ? row.thisYearEur / compareMax() * 100 : 0"></i>
                <i class="fin-months__last" [style.width.%]="compareMax() ? row.lastYearEur / compareMax() * 100 : 0"></i>
              </span>
              <strong>{{ row.thisYearEur | eur: 0 }}</strong>
              <small>{{ row.lastYearEur ? (row.lastYearEur | eur: 0) : '—' }}</small>
            </div>
          }
        </div>
        <p class="fin-panel__hint"><i class="fin-months__key fin-months__key--this"></i> {{ year() }} <i class="fin-months__key fin-months__key--last"></i> {{ year() - 1 }}, excl. btw.</p>
      </section>
    }
  `,
})
export class CostAnalysis {
  readonly state = inject(FinanceState);
  readonly categoryLabel = categoryLabel;
  readonly channelLabel = channelLabel;
  readonly year = signal(YEAR);

  readonly years = computed(() => {
    const seen = new Set<number>([YEAR]);
    for (const cost of this.state.costs()) {
      const year = Number(cost.date.slice(0, 4));
      if (year) seen.add(year);
    }
    return [...[...seen].sort((left, right) => right - left), 0];
  });
  readonly rows = computed(() => (this.year() === 0 ? this.state.costs() : this.state.costs().filter((cost) => cost.date.startsWith(String(this.year())))));
  readonly summary = computed(() => costSummary(this.rows()));
  readonly split = computed(() => {
    const recurringEur = round2(this.rows().filter((cost) => cost.recurringCostId).reduce((sum, cost) => sum + (cost.amountExclEur || 0), 0));
    const onceEur = round2(this.summary().exclEur - recurringEur);
    return { recurringEur, onceEur, recurringPct: this.summary().exclEur > 0 ? round2(recurringEur / this.summary().exclEur * 100) : 0 };
  });
  readonly paid = computed(() => ({ paidEur: round2(this.rows().filter((cost) => cost.paidOn).reduce((sum, cost) => sum + inclOf(cost), 0)) }));
  readonly monthsCounted = computed(() => this.summary().byMonth.filter((row) => row.exclEur > 0).length);
  readonly perMonth = computed(() => (this.monthsCounted() ? round2(this.summary().exclEur / this.monthsCounted()) : 0));
  readonly byChannel = computed(() => {
    const total = this.summary().exclEur;
    return this.summary().byChannel.map((row) => ({ ...row, sharePct: total > 0 ? round2(row.exclEur / total * 100) : 0 }));
  });
  readonly series = computed<TrendSeries[]>(() => {
    const months = monthlyCostSeries(this.state.costs(), 12, TODAY);
    return months.values.some((value) => value > 0) ? [{ label: 'Kosten excl. btw', dates: months.dates, values: months.values, tone: 'accent' }] : [];
  });
  readonly compare = computed(() => yearComparison(this.state.costs(), this.year()));
  readonly compareMax = computed(() => Math.max(0, ...this.compare().flatMap((row) => [row.thisYearEur, row.lastYearEur])));
  readonly compareTotal = computed(() => ({
    thisYearEur: round2(this.compare().reduce((sum, row) => sum + row.thisYearEur, 0)),
    lastYearEur: round2(this.compare().reduce((sum, row) => sum + row.lastYearEur, 0)),
  }));

  monthName(month: number): string {
    return MONTHS[month - 1] ?? '';
  }
}
