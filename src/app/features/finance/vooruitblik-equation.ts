import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { EurPipe } from '../../shared/pipes';
import { FinanceState } from './finance-state';

/**
 * The Vooruitblik equation of today's Overzicht, unchanged (spec §3.3): Op
 * de bank − open costs − containers due now − recurring costs of 30 days =
 * "Na wat nu betaald moet worden"; + what is still to come in − containers
 * later = "Als alles betaald en ontvangen is" (or the "Netto open positie"
 * without a reading). The Kaslijn card's right column on a desk, the
 * Vooruitblik sheet on a phone.
 */
@Component({
  selector: 'app-vooruitblik-equation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EurPipe],
  template: `
    @let o = state.outlook();
    <dl class="wk-equation" [class.fin-equation--compact]="compact()">
      <div><dt>Op de bank</dt><dd>@if (hasReading()) { {{ o.bankEur | eur }} } @else { onbekend · <button class="wk-link" type="button" (click)="state.openBank(null)">Saldo invullen</button> }</dd></div>
      <div class="is-sub"><dt><span class="wk-equation__op">−</span>Open kosten (incl. btw)</dt><dd>{{ o.openCostsEur | eur }}</dd></div>
      @if (state.purchaseFiguresVisible()) { <div class="is-sub"><dt><span class="wk-equation__op">−</span>Containers · nu te betalen (verwacht)</dt><dd>{{ o.containerNowEur | eur }}</dd></div> }
      <div class="is-sub"><dt><span class="wk-equation__op">−</span>Vaste kosten · komende 30 dagen</dt><dd>{{ o.upcomingEur | eur }}</dd></div>
      @if (hasReading()) {
        <div class="is-total"><dt><span class="wk-equation__op">=</span>Na wat nu betaald moet worden</dt><dd [class.wk-amount--warn]="o.afterPayablesEur < 0">{{ o.afterPayablesEur | eur }}</dd></div>
      }
      <div class="is-sub"><dt><span class="wk-equation__op">+</span>Nog te ontvangen (klant &amp; partner)</dt><dd>{{ o.openInvoicesEur | eur }}</dd></div>
      @if (state.purchaseFiguresVisible()) { <div class="is-sub"><dt><span class="wk-equation__op">−</span>Containers · later (verwacht)</dt><dd>{{ o.containerLaterEur | eur }}</dd></div> }
      @if (hasReading()) {
        <div class="is-total is-grand"><dt><span class="wk-equation__op">=</span>Als alles betaald en ontvangen is</dt><dd [class.wk-amount--warn]="o.expectedEur < 0">{{ o.expectedEur | eur }}</dd></div>
      } @else {
        <div class="is-total is-grand"><dt><span class="wk-equation__op">=</span>Netto open positie</dt><dd>{{ o.netOpenEur | eur }}</dd></div>
      }
    </dl>
    @if (!hasReading()) { <p class="fin-hint fin-hint--warn">Banksaldo onbekend: vul eerst een saldo in.</p> }
    @else if (incomplete()) { <p class="fin-hint fin-hint--warn">Onvolledig: {{ incomplete() }}</p> }
    <p class="fin-hint">Containerbedragen volgen de afspraak bij de container en zijn verwacht. Toekomstige verkopen tellen niet mee; die staan in Analyses › Kasprognose. De kaslijn zet dezelfde posten op hun verwachte dag.</p>
  `,
})
export class VooruitblikEquation {
  readonly state = inject(FinanceState);
  /** The Kaslijn card's 28 px rows (the cockpit's fold). */
  readonly compact = input(false);

  readonly hasReading = computed(() => this.state.bankLedger().accounts.some((account) => account.currentEur !== null));
  /** Why the totals may not be the whole story; containers still loading count, their terms are not in yet. */
  readonly incomplete = computed(() => {
    const missing = this.state.accountsView().filter((account) => !account.reading).length;
    const reasons = [
      ...(missing ? [`${missing} ${missing === 1 ? 'rekening' : 'rekeningen'} zonder saldo`] : []),
      ...(this.state.containersLoading() && this.state.purchaseFiguresVisible() ? ['containers worden geladen'] : []),
      ...(this.state.loadErrors().length ? [`niet geladen: ${this.state.failedSources().join(', ')}`] : []),
    ];
    return reasons.join('; ');
  });
}
