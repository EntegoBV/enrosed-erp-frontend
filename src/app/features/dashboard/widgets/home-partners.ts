import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { HomeData } from '../home-data';
import { HomeWidget, amount, count } from './home-w';

/**
 * Partners (spec-home §6.7, amendment G10): the realised partner result,
 * the partner containers and what they really paid, our own cash exposure
 * ("betaald min ontvangsten", a second line under its label on the desk)
 * with what is still to come, and the auction settlements still to make
 * (only when there are any) - as label/value rows; the phone's labels are
 * shorter (critique N2), the long ones in their title.
 */
@Component({
  selector: 'app-home-partners',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HomeWidget],
  template: `
    <app-home-w [variant]="variant()" kind="partners" title="Gerealiseerd partnerresultaat" icon="customers" tone="ink" link="/analyses/purchasing"
                [state]="state()">
      @if (state() === 'ready') {
        @let desk = variant() === 'desk';
        <span class="home-w__value">{{ whole(financing().resultEur) }}</span>
        <dl class="home-w__kv">
          <div><dt title="Partnercontainers">{{ desk ? 'Partnercontainers' : 'Containers' }}</dt><dd>{{ count(financing().partner.count) }}</dd></div>
          <div><dt title="Werkelijk ontvangen">{{ desk ? 'Werkelijk ontvangen' : 'Ontvangen' }}</dt><dd>{{ whole(financing().receivedEur) }}</dd></div>
          <div><dt title="Eigen kasinleg (betaald min ontvangsten)">@if (desk) {Eigen kasinleg<small>betaald min ontvangsten</small>} @else {Kasinleg}</dt>
            <dd>{{ whole(financing().ownExposureEur) }}</dd></div>
          <div><dt>Nog te ontvangen</dt><dd>{{ whole(financing().openEur) }}</dd></div>
          @if (financing().awaitingSettlement) {
            <div class="is-warn"><dt title="Afrekeningen nog te maken">{{ desk ? 'Afrekeningen nog te maken' : 'Af te rekenen' }}</dt>
              <dd>{{ count(financing().awaitingSettlement) }}</dd></div>
          }
        </dl>
      }
    </app-home-w>
  `,
})
export class HomePartners {
  readonly data = inject(HomeData);
  readonly variant = input<'desk' | 'phone'>('desk');
  readonly state = computed(() => this.data.combined('verkoop', 'inkoop', 'partnerfinanciering'));
  readonly whole = amount;
  readonly count = count;
  readonly financing = this.data.financing;
}
