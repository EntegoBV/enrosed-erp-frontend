import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { incomingMoneyTotals } from '../../finance/incoming-money';
import { HomeData } from '../home-data';
import { HomeWidget, amount } from './home-w';

/**
 * Ontvangen (spec-home §6.5): what came in net this month, with the gross,
 * the refunds and the partner advances as label/value rows, incl. btw - the
 * old "Netto ontvangen deze maand". Opens Kosten & bank › Ontvangen for the
 * month. The phone says "Voorschotten" (the full label in its title).
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
        <dl class="home-w__kv">
          <div><dt>Ontvangen</dt><dd>{{ whole(month().grossReceivedEur) }}</dd></div>
          <div><dt>Terugbetaald</dt><dd>{{ whole(month().refundedEur) }}</dd></div>
          <div><dt title="Netto partnervoorschotten">{{ variant() === 'desk' ? 'Netto partnervoorschotten' : 'Voorschotten' }}</dt>
            <dd>{{ whole(month().partnerAdvanceEur) }}</dd></div>
        </dl>
        <span class="home-w__note">incl. btw</span>
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
