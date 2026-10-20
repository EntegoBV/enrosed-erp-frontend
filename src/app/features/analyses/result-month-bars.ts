import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { ResultMonthRow } from './analysis-metrics';
import { eurK } from '../finance/cash-format';
import { monthBars, monthLabel, monthShort, yearSpans } from './analyses-words';

/**
 * Resultaat › "Marge en kosten per maand" (design §3.6): per month the
 * margin on goods (accent above zero, danger below) beside the own costs
 * (warn, hanging below zero), one zero line and three ticks; the desk shows
 * each month's result under its label. Every month of the period is there,
 * empty ones as bars of 0; a period over several years adds a year band. Each month with figures is a button
 * that says its numbers and emits `picked` (the page opens the month's rows, design/analyses2 §B.4). Styles:
 * analyses-tabs.scss (.an-mbars), the button reset in analyses-drill.scss.
 */
@Component({
  selector: 'app-an-month-bars',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'an-mbars-host' },
  template: `
    @let g = geometry();
    <div class="an-mbars" role="group" [attr.aria-label]="ariaLabel()" [style.--h.px]="height()" [style.--n]="g.bars.length">
      <div class="an-mbars__axis" aria-hidden="true">
        @for (tick of g.ticks; track tick.value) { <span [style.top.%]="tick.pct">{{ k(tick.value) }}</span> }
      </div>
      <div class="an-mbars__plot">
        @for (tick of g.ticks; track tick.value) { <i class="an-mbars__grid" aria-hidden="true" [class.is-zero]="tick.value === 0" [style.top.%]="tick.pct"></i> }
        @for (bar of g.bars; track bar.month) {
          <button class="an-mbars__m" type="button" aria-haspopup="dialog" [disabled]="!pickable(bar.month)" [attr.aria-label]="title(bar.month)" [attr.title]="title(bar.month)"
                  (click)="picked.emit(bar.month)">
            <i class="m" [class.neg]="bar.marginNegative" [style.top.%]="bar.marginTop" [style.height.%]="bar.marginHeight"></i>
            <i class="c" [style.top.%]="bar.costTop" [style.height.%]="bar.costHeight"></i>
          </button>
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
  /** A month with figures was clicked ('2026-10'). */
  readonly picked = output<string>();

  readonly geometry = computed(() => monthBars(this.months()));
  readonly years = computed(() => yearSpans(this.months().map((row) => row.month)));
  readonly ariaLabel = computed(() => {
    const months = this.months();
    return months.length ? `Marge en eigen kosten per maand, ${monthLabel(months[0].month)} tot ${monthLabel(months[months.length - 1].month)}` : 'Marge en eigen kosten per maand';
  });
  readonly k = eurK;
  readonly short = monthShort;

  /** A month without margin, revenue or costs has nothing to list: its bar stays plain. */
  pickable(month: string): boolean {
    const row = this.months().find((candidate) => candidate.month === month);
    return !!row && (row.revenueEur !== 0 || row.marginEur !== 0 || row.costsEur !== 0);
  }

  title(month: string): string {
    const row = this.months().find((candidate) => candidate.month === month);
    return row ? `${monthLabel(month)}: marge ${eurK(row.marginEur)}, eigen kosten ${eurK(row.costsEur)}, resultaat ${eurK(row.resultEur)}` : month;
  }
}
