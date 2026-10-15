import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { incomingMoneyTotals } from '../../finance/incoming-money';
import { HomeData } from '../home-data';
import { HomeWidget, amount } from './home-w';

/**
 * Ontvangen (spec-home §6.5): what came in net this month, with the gross,
 * the refunds and the partner advances, incl. btw - the old "Netto
 * ontvangen deze maand". Opens Kosten & bank › Ontvangen for the month.
 */
@Component({
  selector: 'app-home-ontvangen',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HomeWidget],
  template: `
    <app-home-w [variant]="variant()" kind="ontvangen" [title]="'Netto ontvangen ' + data.windows().monthName" icon="arrow-in" tone="teal"
                link="/costs" [query]="{ view: 'incoming', tab: 'received', period: 'month' }" [state]="state()">
      @if (state() === 'ready') {
        <span class="home-w__value">{{ whole(month().receivedEur) }}</span>
        <span class="home-w__line">{{ whole(month().grossReceivedEur) }} ontvangen · {{ whole(month().refundedEur) }} terugbetaald</span>
        <span class="home-w__line">{{ whole(month().partnerAdvanceEur) }} netto partnervoorschotten · incl. btw</span>
      }
    </app-home-w>
  `,
})
export class HomeOntvangen {
  readonly data = inject(HomeData);
  readonly variant = input<'desk' | 'phone'>('desk');
  readonly state = computed(() => this.data.combined('inkomende betalingen'));
  readonly whole = amount;
  readonly month = computed(() => incomingMoneyTotals(this.data.incomingPayments(), this.data.windows().monthStart, this.data.today()));
}
