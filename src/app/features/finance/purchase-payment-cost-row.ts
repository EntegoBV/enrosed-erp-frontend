import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DateNlPipe, EurPipe } from '../../shared/pipes';
import { CostLedgerRow } from './cost-ledger';

@Component({
  selector: 'app-purchase-payment-cost-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DateNlPipe, EurPipe],
  styles: `
    .fin-row__main { text-decoration: none; }
    .fin-row__cat { color: var(--rose-dark); background: var(--rose-soft); }
    .fin-row__title { white-space: normal; overflow-wrap: anywhere; }
    .fin-row__meta { white-space: normal; overflow-wrap: anywhere; }
    .fin-row__state { color: var(--muted); }
    @media (max-width: 600px) { .fin-row__main { grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'cat amount' 'date amount' 'body body'; } }
  `,
  template: `
    @if (row().payment; as payment) {
      <div class="fin-row">
        <a class="fin-row__main" [routerLink]="['/purchasing', payment.orderId]" [attr.aria-label]="'Bekijk betaling bij ' + row().reference">
          <span class="fin-row__date">{{ row().date | dateNl }}</span>
          <span class="fin-row__cat">Container ↗</span>
          <span class="fin-row__body"><span class="fin-row__title">{{ row().description }}</span><span class="fin-row__meta">{{ row().reference }} · {{ row().party }}</span></span>
          <span class="fin-row__amount"><b>{{ row().amountEur | eur }}</b><small>betaald · EUR</small></span>
        </a>
        <em class="fin-row__state" title="Automatisch gekoppeld aan de container. Bewerk of verwijder de betaling daar.">gekoppeld<br>bekijken ›</em>
      </div>
    }
  `,
})
export class PurchasePaymentCostRow {
  readonly row = input.required<CostLedgerRow>();
}
