import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { Payee, PurchaseOrderView } from '../../core/api/models';
import { Icon } from '../../shared/icon';
import { EurPipe } from '../../shared/pipes';
import type { PaymentLedger, PurchaseSettleRequest } from './purchase-payment-ledger';
import { formatEur } from './purchase-payment-menus';
import { purchasePaymentResult } from './purchase-payment-result-metrics';
import { paymentResultRows } from './purchase-payment-result-rows';

/**
 * Nacalculatie: what settling the payments did to the cost, apart from the
 * Enrosed kost on the order, and the same picture per payee as Betalingen
 * shows, so the two never disagree. One markup for the desk rail and the
 * phone Kosten card; styles live in styles/purchase-payments.scss.
 */
@Component({
  selector: 'app-purchase-payment-result',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EurPipe, Icon],
  template: `
    @let amounts = result();
    <section class="payment-result" id="purchase-payment-result" tabindex="-1" aria-label="Betalingsresultaat">
      <header class="payment-result__head">
        <h3>Betalingsresultaat</h3>
        @if (amounts) {
          @let net = amounts.netResultEur;
          <span class="payment-result__net" [class.wk-amount--in]="net > 0" [class.wk-amount--warn]="net < 0" [class.wk-amount--muted]="net === 0">{{ signed(net) }}</span>
          <span class="wk-pill" [class.tone-ok]="amounts.finalized">{{ !amounts.eligible ? 'Nog niet besteld' : amounts.finalized ? 'Afgerekend' : 'Tussenstand' }}</span>
        }
      </header>
      @if (!amounts) {
        <p class="payment-result__note">Nog niet beschikbaar. Vernieuw de order om de actuele betalingen op te halen.</p>
      } @else if (!amounts.eligible) {
        <p class="payment-result__note">Zodra de container besteld is, verschijnen hier de afgerekende verschillen.</p>
      } @else {
        @if (quiet()) { <p class="payment-result__note">Geen afgerekende verschillen.</p> }
        <dl class="wk-equation">
          <div><dt>Enrosed kost</dt><dd>{{ amounts.internalMarkupEur | eur }}</dd></div>
          <div><dt><span class="wk-equation__op" aria-hidden="true">+</span>Minder betaald · afgerekend</dt><dd class="wk-amount--in">{{ amounts.settledSavingsEur | eur }}</dd></div>
          @if (amounts.settledOverrunsEur) {
            <div><dt><span class="wk-equation__op" aria-hidden="true">−</span>Meer betaald · afgerekend</dt><dd>{{ amounts.settledOverrunsEur | eur }}</dd></div>
          }
          @if (amounts.additionalCostsEur) {
            <div><dt><span class="wk-equation__op" aria-hidden="true">−</span>Bijkomende kosten</dt><dd>{{ amounts.additionalCostsEur | eur }}</dd></div>
          }
          <div class="is-total"><dt><span class="wk-equation__op" aria-hidden="true">=</span>Enrosed kost + resultaat</dt><dd>{{ amounts.markupWithResultEur | eur }}</dd></div>
        </dl>
        @if (amounts.unsettledOverrunsEur) {
          <p class="payment-result__pending">Nog na te kijken: {{ amounts.unsettledOverrunsEur | eur }} te veel betaald; staat apart van dit resultaat.</p>
        }
        <p class="payment-result__note">Minder betalen telt pas mee zodra je de ontvanger of termijn afrekent.</p>
      }

      <h4 class="payment-result__sub">Per ontvanger</h4>
      @if (rows().length) {
        <!-- A plain list: the buttons in each row are the actions, so the row itself is no button (nested controls would lose their names). -->
        <div class="pr-payees">
          @for (row of rows(); track row.payee) {
            <div class="pr-payee">
              <span class="pr-payee__tile" [class]="row.tone"><app-icon [name]="row.icon" [size]="14" /></span>
              <span class="pr-payee__copy">
                <b>{{ row.label }}</b>
                <span class="pr-payee__figures">@if (row.agreedEur !== null) { {{ row.agreedEur | eur }} {{ row.payee === 'SUPPLIER' ? 'afgesproken' : 'begroot' }} · }{{ row.paidEur | eur }} betaald@if (row.agreedEur !== null) { · {{ row.openEur | eur }} open } @else { · zonder afspraak }</span>
                <span class="pr-payee__state">
                  <span class="wk-pill" [class]="pill(row.status.tone)">{{ row.status.label }}</span>
                  @if (actions() === 'inline') {
                    @if (row.canSettle) {
                      <button class="wk-link" type="button" [disabled]="busy()" (click)="settle.emit(row.settleDefault)">Afrekenen…</button>
                    }
                    @if (row.canUndoSettle) {
                      <button class="wk-link" type="button" [disabled]="busy()" (click)="undoSettle.emit({ payee: row.payee })">Afrekening ongedaan maken</button>
                    }
                  }
                  <button class="wk-link" type="button" [attr.aria-label]="'Betalingen van ' + row.label" (click)="open.emit(row.payee)">Betalingen ›</button>
                </span>
              </span>
              @if (row.payee !== 'OTHER' && row.differenceEur === 0 && !row.finalized) {
                <span class="pr-payee__diff wk-amount--muted"><small>nog niet afgerekend</small></span>
              } @else {
                <span class="pr-payee__diff" [class.wk-amount--in]="row.differenceEur < 0" [class.wk-amount--warn]="row.differenceEur > 0" [class.wk-amount--muted]="row.differenceEur === 0">
                  {{ signed(row.differenceEur) }}<small>{{ row.payee === 'OTHER' ? 'zonder afspraak' : row.differenceEur < 0 ? 'minder betaald' : row.differenceEur > 0 ? 'meer betaald' : 'geen verschil' }}</small>
                </span>
              }
            </div>
          }
        </div>
      } @else if (!ledger()) {
        <p class="payment-result__note">Betalingen niet actueel — vernieuw de order.</p>
      } @else {
        <p class="payment-result__note">Nog geen ontvangers met een afspraak of betaling.</p>
      }
    </section>
  `,
})
export class PurchasePaymentResult {
  readonly view = input.required<PurchaseOrderView>();
  readonly ledger = input<PaymentLedger | null>(null);
  /** 'inline' adds Afrekenen… and its undo to every payee; the read view keeps only the way to Betalingen. */
  readonly actions = input<'none' | 'inline'>('none');
  readonly busy = input(false);
  /** A payee was chosen: show its payments. */
  readonly open = output<Payee>();
  readonly settle = output<PurchaseSettleRequest>();
  readonly undoSettle = output<{ payee: Payee }>();

  readonly result = computed(() => purchasePaymentResult(this.view()));
  readonly rows = computed(() => paymentResultRows(this.ledger(), this.result()?.streams ?? []));
  /** Nothing was settled differently: one calm line above the zeros. */
  readonly quiet = computed(() => {
    const amounts = this.result();
    return !!amounts && !amounts.netResultEur && !amounts.settledSavingsEur && !amounts.settledOverrunsEur
      && !amounts.additionalCostsEur && !amounts.unsettledOverrunsEur;
  });

  pill(tone: 'warn' | 'ok' | 'neutral'): string { return tone === 'warn' ? 'tone-warn' : tone === 'ok' ? 'tone-ok' : ''; }

  /** '+ € 120,00', '− € 50,00' or a plain '€ 0,00'. */
  signed(value: number): string {
    if (!value) return formatEur(0);
    return (value > 0 ? '+ ' : '− ') + formatEur(Math.abs(value));
  }
}
