import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { PurchaseOrderView } from '../../core/api/models';
import { EurPipe } from '../../shared/pipes';
import { purchasePaymentResult } from './purchase-payment-result-metrics';

/**
 * Nacalculatie: what settling the payments did to the cost, apart from the
 * Enrosed kost on the order. Styles live in styles/purchase-payments.scss.
 */
@Component({
  selector: 'app-purchase-payment-result',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EurPipe],
  template: `
    @if (result(); as amounts) {
      <section class="payment-result" id="purchase-payment-result" tabindex="-1" aria-label="Betalingsresultaat">
        <header class="payment-result__head">
          <div><span class="payment-result__eyebrow">Nacalculatie</span><h3>Betalingsresultaat</h3></div>
          <span class="wk-pill" [class.tone-ok]="amounts.finalized">{{ !amounts.eligible ? 'Nog niet besteld' : amounts.finalized ? 'Afgerekend' : 'Tussenstand' }}</span>
        </header>
        @if (!amounts.eligible) {
          <p class="payment-result__note">Zodra de order besteld is, verschijnen hier de afgerekende verschillen.</p>
        } @else if (quiet()) {
          <p class="payment-result__note">Geen afgerekende verschillen.</p>
        } @else {
          <div class="payment-result__amount" [class.is-loss]="amounts.netResultEur < 0">
            <strong>{{ amounts.netResultEur | eur }}</strong>
            <span>{{ amounts.netResultEur < 0 ? 'Netto extra kost' : 'Netto voordeel' }}</span>
          </div>
          <dl class="wk-equation">
            <div><dt>Minder betaald na afrekening</dt><dd class="wk-amount--in">+ {{ amounts.settledSavingsEur | eur }}</dd></div>
            @if (amounts.settledOverrunsEur) {
              <div><dt>Meer betaald na afrekening</dt><dd>− {{ amounts.settledOverrunsEur | eur }}</dd></div>
            }
            @if (amounts.additionalCostsEur) {
              <div><dt>Bijkomende kosten</dt><dd>− {{ amounts.additionalCostsEur | eur }}</dd></div>
            }
            <div class="is-total"><dt>Enrosed kost + betalingsresultaat</dt><dd>{{ amounts.markupWithResultEur | eur }}</dd></div>
          </dl>
          <p class="payment-result__note">Een lager bedrag telt mee zodra je de ontvanger of termijn afrekent. De Enrosed kost op de order blijft {{ amounts.internalMarkupEur | eur }}.</p>
        }
        @if (amounts.eligible && amounts.unsettledOverrunsEur) {
          <p class="payment-result__pending">Nog na te kijken: {{ amounts.unsettledOverrunsEur | eur }} te veel betaald; staat apart van dit resultaat.</p>
        }
      </section>
    }
  `,
})
export class PurchasePaymentResult {
  readonly view = input.required<PurchaseOrderView>();
  readonly result = computed(() => purchasePaymentResult(this.view()));
  /** Nothing was settled differently: one calm line instead of a row of zeros. */
  readonly quiet = computed(() => {
    const amounts = this.result();
    return !!amounts && !amounts.netResultEur && !amounts.settledSavingsEur && !amounts.settledOverrunsEur
      && !amounts.additionalCostsEur && !amounts.unsettledOverrunsEur;
  });
}
