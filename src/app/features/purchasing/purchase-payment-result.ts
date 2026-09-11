import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Payee, PurchaseOrderView } from '../../core/api/models';
import { EurPipe } from '../../shared/pipes';
import { purchasePaymentResult } from './purchase-payment-result-metrics';

/** Internal payment advantage, separate from the agreed order's Enrosed markup. */
@Component({
  selector: 'app-purchase-payment-result',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EurPipe, RouterLink],
  template: `
    @if (result(); as amounts) {
      <section class="payment-result" id="purchase-payment-result" tabindex="-1" aria-label="Extra opbrengst uit betalingen">
        <header class="payment-result__head">
          <div><span>Naast de ENROSED kost</span><h3>Extra opbrengst uit betalingen</h3></div>
          <span class="payment-result__state">{{ !amounts.eligible ? 'Concept' : amounts.finalized ? 'Afgerekend' : 'Tussenstand' }}</span>
        </header>
        <div class="payment-result__amount" [class.is-loss]="amounts.netResultEur < 0">
          <strong>{{ amounts.netResultEur | eur }}</strong>
          <span>{{ amounts.netResultEur < 0 ? 'Netto extra kosten' : 'Netto betalingsvoordeel' }}</span>
        </div>
        @if (amounts.eligible) {
          <dl class="payment-result__breakdown">
            <div><dt>Minder betaald na afrekening</dt><dd class="is-gain">+ {{ amounts.settledSavingsEur | eur }}</dd></div>
            @if (amounts.settledOverrunsEur) {
              <div><dt>Meer betaald na afrekening</dt><dd>− {{ amounts.settledOverrunsEur | eur }}</dd></div>
            }
            @if (amounts.additionalCostsEur) {
              <div><dt>Overige betaalde kosten</dt><dd>− {{ amounts.additionalCostsEur | eur }}</dd></div>
            }
            <div class="payment-result__total"><dt>ENROSED kost + betalingsresultaat</dt><dd>{{ amounts.markupWithResultEur | eur }}</dd></div>
          </dl>
          <p class="payment-result__note">Een lager bedrag telt mee zodra je de kostenpost of termijn afrekent. De ENROSED kost op de order blijft {{ amounts.internalMarkupEur | eur }}.</p>
          @if (amounts.unsettledOverrunsEur) {
            <p class="payment-result__pending">{{ amounts.unsettledOverrunsEur | eur }} meer betaald is nog te beoordelen en staat apart van dit nettoresultaat.</p>
          }
        } @else {
          <p class="payment-result__note">Zodra de order is besteld, verschijnen hier de verschillen van volledig afgerekende kostenposten.</p>
        }
        <details class="payment-result__details">
          <summary>Per kostenpost <span>Bedragen en afrekening</span></summary>
          <div class="payment-result__streams">
            @for (stream of amounts.streams; track stream.payee) {
              @if (stream.plannedEur || stream.paidEur || stream.paymentCount) {
                <article class="payment-result__stream">
                  <header><b>{{ stream.label }}</b><span [class.is-gain]="stream.netResultEur > 0" [class.is-loss]="stream.netResultEur < 0">{{ stream.netResultEur > 0 ? '+' : '' }}{{ stream.netResultEur | eur }}</span></header>
                  <dl><div><dt>Begroot</dt><dd>{{ stream.plannedEur === null ? 'Onbekend' : (stream.plannedEur | eur) }}</dd></div><div><dt>Betaald</dt><dd>{{ stream.paidEur === null ? 'Onbekend' : (stream.paidEur | eur) }}</dd></div></dl>
                  <div class="payment-result__stream-foot">
                    <small>{{ !amounts.eligible ? 'Telt nog niet mee' : stream.payee === 'OTHER' ? 'Extra uitgave' : stream.finalized ? 'Volledig afgerekend' : 'Nog niet volledig afgerekend' }}</small>
                    @if (editable() && amounts.eligible && stream.payee !== 'OTHER' && stream.paymentCount > 0) {
                      <button type="button" [disabled]="busy()" (click)="manage.emit(stream.payee)">{{ stream.finalized ? 'Afrekening aanpassen' : 'Volledig betaald' }}</button>
                    }
                  </div>
                </article>
              }
            }
          </div>
          <p class="payment-result__note">Deze knoppen rekenen de hele betaalgroep af. Alleen een leverancierstermijn afrekenen? Kies die termijn bij het aanpassen van de betaling.</p>
          @if (!editable() && amounts.eligible) {
            <a class="payment-result__link" [routerLink]="['/purchasing', view().order.id, 'edit']" [queryParams]="{ section: 'payment-result' }">Betalingen beheren →</a>
          }
        </details>
      </section>
    }
  `,
  styles: `
    :host { display: block; min-width: 0; margin-top: 12px; }
    .payment-result { padding: 16px; border: 1px solid var(--rose-line); border-radius: 16px; background: linear-gradient(145deg, var(--surface), var(--rose-soft)); scroll-margin-top: calc(var(--appbar-h) + 100px); }
    .payment-result__head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    .payment-result__head > div { min-width: 0; }
    .payment-result__head > div > span { color: var(--muted); font-size: 10px; }
    h3 { margin: 4px 0 0; font-size: 15px; line-height: 1.4; }
    .payment-result__state { padding: 5px 8px; border: 1px solid var(--line); border-radius: 999px; color: var(--muted); background: var(--surface); font-size: 10px; white-space: nowrap; }
    .payment-result__amount { display: grid; gap: 4px; margin: 18px 0 14px; color: var(--rose-dark); }
    .payment-result__amount strong { font-size: 30px; line-height: 1.15; letter-spacing: -.04em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .payment-result__amount > span { font-size: 11px; color: var(--muted); }
    .payment-result__breakdown { display: grid; gap: 9px; margin: 0; }
    .payment-result__breakdown > div { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; font-size: 11px; }
    dd { margin: 0; font-weight: 700; font-variant-numeric: tabular-nums; }
    .payment-result__breakdown dd { flex-shrink: 0; }
    .payment-result__total { border-top: 1px solid var(--rose-line); padding-top: 12px; margin-top: 3px; font-weight: 700; }
    .payment-result__note { margin: 10px 0 0; color: var(--muted); font-size: 11px; line-height: 1.6; }
    .payment-result__pending { margin: 10px 0 0; padding: 10px; border-radius: 10px; background: var(--warn-soft); color: var(--warn); font-size: 11px; line-height: 1.5; }
    .payment-result__details { border-top: 1px solid var(--rose-line); margin-top: 14px; }
    summary { min-height: 44px; padding: 13px 0 5px; color: var(--ink); font-size: 12px; font-weight: 650; cursor: pointer; }
    summary > span { display: block; margin: 4px 0 0 15px; color: var(--muted); font-size: 10px; font-weight: 400; }
    .payment-result__streams { display: grid; gap: 8px; margin-top: 10px; }
    .payment-result__stream { min-width: 0; padding: 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
    .payment-result__stream header { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 12px; }
    .payment-result__stream header > span { flex-shrink: 0; font-weight: 700; font-variant-numeric: tabular-nums; }
    .payment-result__stream dl { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0 0; }
    .payment-result__stream dt { color: var(--muted); font-size: 10px; }
    .payment-result__stream dd { margin-top: 4px; font-size: 12px; overflow-wrap: anywhere; }
    .payment-result__stream-foot { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .payment-result__stream small { color: var(--muted); font-size: 10px; }
    .payment-result__stream button, .payment-result__link { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 8px 10px; border: 1px solid var(--rose-line); border-radius: 10px; background: var(--rose-soft); color: var(--rose-dark); font: inherit; font-size: 11px; font-weight: 650; text-decoration: none; cursor: pointer; }
    .payment-result__stream button:disabled { opacity: .5; cursor: default; }
    .payment-result__link { margin-top: 12px; }
    button:focus-visible, a:focus-visible, summary:focus-visible { outline: 2px solid var(--rose); outline-offset: 3px; }
    .is-gain { color: var(--ok); } .is-loss { color: var(--warn); }
    @media (max-width: 360px) { .payment-result { padding: 12px; } .payment-result__head { flex-wrap: wrap; } }
  `,
})
export class PurchasePaymentResult {
  readonly view = input.required<PurchaseOrderView>();
  readonly editable = input(false);
  readonly busy = input(false);
  readonly manage = output<Payee>();
  readonly result = computed(() => purchasePaymentResult(this.view()));
}
