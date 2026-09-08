import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { CompanyCost } from '../../core/api/models';
import { DateNlPipe, EurPipe } from '../../shared/pipes';
import { channelLabel } from '../sales/sales-channels';
import { categoryLabel } from './cost-categories';
import { inclOf } from './finance-metrics';
import { FinanceState } from './finance-state';

/** One cost in a list: date, category, what and to whom, the amount, and "Betaald" while it is open. */
@Component({
  selector: 'app-cost-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DateNlPipe, EurPipe],
  template: `
    <div class="fin-row" [class.fin-row--open]="!cost().paidOn">
      <button class="fin-row__main" type="button" (click)="state.openCost(cost())">
        <span class="fin-row__date">{{ cost().date | dateNl }}</span>
        <span class="fin-row__cat" [attr.data-cat]="cost().category">{{ categoryLabel(cost().category) }}</span>
        <span class="fin-row__body">
          <span class="fin-row__title">{{ cost().description }}@if (cost().recurringCostId) { <i class="fin-row__auto" title="Automatisch geboekt als vaste kost">↻</i> }</span>
          <span class="fin-row__meta">{{ meta() }}</span>
        </span>
        <span class="fin-row__amount">
          <b>{{ cost().amountExclEur | eur }}</b>
          <small>{{ inclOf(cost()) | eur }} incl.</small>
        </span>
      </button>
      @if (cost().paidOn) {
        <em class="fin-row__state fin-row__state--paid">betaald<br>{{ cost().paidOn | dateNl }}</em>
      } @else {
        <button class="fin-row__pay" type="button" (click)="state.markPaid(cost())" [attr.aria-label]="'Markeer ' + cost().description + ' als betaald'">Betaald</button>
      }
    </div>
  `,
})
export class CostRow {
  readonly state = inject(FinanceState);
  readonly cost = input.required<CompanyCost>();
  readonly categoryLabel = categoryLabel;
  readonly inclOf = inclOf;

  /** Who, which invoice and which channel, on one line. */
  readonly meta = computed(() => {
    const cost = this.cost();
    return [cost.party, cost.reference, cost.salesChannel ? channelLabel(cost.salesChannel) : null]
      .filter((part): part is string => !!part).join(' · ') || '—';
  });
}
