import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { HomeData } from '../home-data';
import { HomeWidget, amount, counted } from './home-w';

/**
 * Partners (spec-home §6.7, amendment G10): the realised partner result,
 * the partner containers and what they really paid, our own cash exposure
 * ("betaald min ontvangsten") with what is still to come, and the auction
 * settlements still to make.
 */
@Component({
  selector: 'app-home-partners',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HomeWidget],
  template: `
    <app-home-w [variant]="variant()" kind="partners" title="Gerealiseerd partnerresultaat" icon="customers" tone="ink" link="/analyses/purchasing"
                [state]="state()">
      @if (state() === 'ready') {
        <span class="home-w__value">{{ whole(financing().resultEur) }}</span>
        <span class="home-w__line">{{ counted(financing().partner.count, 'partnercontainer', 'partnercontainers') }} · {{ whole(financing().receivedEur) }} werkelijk ontvangen</span>
        <span class="home-w__line">Eigen kasinleg {{ whole(financing().ownExposureEur) }} · betaald min ontvangsten · {{ whole(financing().openEur) }} nog te ontvangen</span>
        @if (financing().awaitingSettlement) {
          <span class="home-w__line is-warn">{{ counted(financing().awaitingSettlement, 'afrekening', 'afrekeningen') }} nog te maken</span>
        }
      }
    </app-home-w>
  `,
})
export class HomePartners {
  readonly data = inject(HomeData);
  readonly variant = input<'desk' | 'phone'>('desk');
  readonly state = computed(() => this.data.combined('verkoop', 'inkoop', 'partnerfinanciering'));
  readonly whole = amount;
  readonly counted = counted;
  readonly financing = this.data.financing;
}
