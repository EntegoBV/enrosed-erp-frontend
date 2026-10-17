import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { ResultMonthRow } from './analysis-metrics';
import { eurK } from '../finance/cash-format';
import { monthBars, monthLabel, monthShort, yearSpans } from './analyses-words';

/**
 * Resultaat › "Marge en kosten per maand" (design §3.6): per month the
 * margin on goods (accent above zero, danger below) beside the own costs
 * (warn, hanging below zero), one zero line and three ticks; the desk shows
 * each month's result under its label. Every month of the period is there,
 * empty ones as bars of 0; a period over several years adds a year band. Styles: analyses-tabs.scss (.an-mbars).
 */
@Component({
  selector: 'app-an-month-bars',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'an-mbars-host' },
  template: `
    @let g = geometry();
    <div class="an-mbars" role="img" [attr.aria-label]="ariaLabel()" [style.--h.px]="height()" [style.--n]="g.bars.length">
      <div class="an-mbars__axis" aria-hidden="true">
        @for (tick of g.ticks; track tick.value) { <span [style.top.%]="tick.pct">{{ k(tick.value) }}</span> }
      </div>
      <div class="an-mbars__plot" aria-hidden="true">
        @for (tick of g.ticks; track tick.value) { <i class="an-mbars__grid" [class.is-zero]="tick.value === 0" [style.top.%]="tick.pct"></i> }
        @for (bar of g.bars; track bar.month) {
          <div class="an-mbars__m" [attr.title]="title(bar.month)">
            <i class="m" [class.neg]="bar.marginNegative" [style.top.%]="bar.marginTop" [style.height.%]="bar.marginHeight"></i>
            <i class="c" [style.top.%]="bar.costTop" [style.height.%]="bar.costHeight"></i>
          </div>
        }
      </div>
    </div>
    <div class="an-mbars__x" aria-hidden="true" [style.--n]="g.bars.length">
      @for (bar of g.bars; track bar.month) {
        <span>{{ short(bar.month) }}@if (!compact()) { <b [class.neg]="bar.resultEur < 0">{{ k(bar.resultEur) }}</b> }</span>
      }
    </div>
    @if (years().length) {
      <!-- More than one calendar year: a year band under the months, so two Septembers are never the same word. -->
      <div class="an-mbars__years" aria-hidden="true" [style.--n]="g.bars.length">
        @for (year of years(); track year.year) { <span [style.grid-column]="(year.start + 1) + ' / span ' + year.span">{{ year.year }}</span> }
      </div>
    }
  `,
})
export class ResultMonthBars {
  readonly months = input.required<readonly ResultMonthRow[]>();
  readonly height = input(180);
  /** Phone: month words only; the results are in the Per maand cells below. */
  readonly compact = input(false);

  readonly geometry = computed(() => monthBars(this.months()));
  readonly years = computed(() => yearSpans(this.months().map((row) => row.month)));
  readonly ariaLabel = computed(() => {
    const months = this.months();
    return months.length ? `Marge en eigen kosten per maand, ${monthLabel(months[0].month)} tot ${monthLabel(months[months.length - 1].month)}` : 'Marge en eigen kosten per maand';
  });
  readonly k = eurK;
  readonly short = monthShort;

  title(month: string): string {
    const row = this.months().find((candidate) => candidate.month === month);
    return row ? `${monthLabel(month)}: marge ${eurK(row.marginEur)}, eigen kosten ${eurK(row.costsEur)}, resultaat ${eurK(row.resultEur)}` : month;
  }
}
