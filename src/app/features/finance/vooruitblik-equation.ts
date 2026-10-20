import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { eur } from './cash-format';
import { FinanceState } from './finance-state';

/**
 * The Vooruitblik equation of today's Overzicht, unchanged (spec §3.3): Op
 * de bank − open costs − containers due now − recurring costs of 30 days =
 * "Na wat nu betaald moet worden"; + what is still to come in − containers
 * later = "Als alles betaald en ontvangen is" (or the "Netto open positie"
 * without a reading). The Kaslijn card's right column on a desk, the
 * Vooruitblik sheet on a phone. Amounts read as the Kaslijn's: a negative one
 * is '− € 10.714,75' (cash-format), never '€ -10.714,75'.
 */
@Component({
  selector: 'app-vooruitblik-equation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let o = state.outlook();
    <dl class="wk-equation" [class.fin-equation--compact]="compact()">
      <div><dt>Op de bank</dt><dd>@if (hasReading()) { {{ money(o.bankEur) }} } @else { onbekend · <button class="wk-link" type="button" (click)="state.openBank(null)">Saldo invullen</button> }</dd></div>
      <div class="is-sub"><dt><span class="wk-equation__op">−</span>Open kosten (incl. btw)</dt><dd>{{ money(o.openCostsEur) }}</dd></div>
      @if (state.purchaseFiguresVisible()) { <div class="is-sub"><dt><span class="wk-equation__op">−</span>Containers · nu te betalen (verwacht)</dt><dd>{{ money(o.containerNowEur) }}</dd></div> }
      <div class="is-sub"><dt><span class="wk-equation__op">−</span>Vaste kosten · komende 30 dagen</dt><dd>{{ money(o.upcomingEur) }}</dd></div>
      @if (hasReading()) {
        <div class="is-total"><dt><span class="wk-equation__op">=</span>Na wat nu betaald moet worden</dt><dd [class.wk-amount--warn]="o.afterPayablesEur < 0">{{ money(o.afterPayablesEur) }}</dd></div>
      }
      <div class="is-sub"><dt><span class="wk-equation__op">+</span>Nog te ontvangen (klant &amp; partner)</dt><dd>{{ money(o.openInvoicesEur - ticaOpen()) }}</dd></div>
      @if (ticaOpen()) { <div class="is-sub"><dt><span class="wk-equation__op">+</span><button class="wk-link" type="button" (click)="state.openTica()">TICA · netto te ontvangen</button></dt><dd>{{ money(ticaOpen()) }}</dd></div> }
      @if (state.purchaseFiguresVisible()) { <div class="is-sub"><dt><span class="wk-equation__op">−</span>Containers · binnenkort en later (verwacht)</dt><dd>{{ money(o.containerLaterEur) }}</dd></div> }
      @if (hasReading()) {
        <div class="is-total is-grand"><dt><span class="wk-equation__op">=</span>Als alles betaald en ontvangen is</dt><dd [class.wk-amount--warn]="o.expectedEur < 0">{{ money(o.expectedEur) }}</dd></div>
      } @else {
        <div class="is-total is-grand"><dt><span class="wk-equation__op">=</span>Netto open positie</dt><dd>{{ money(o.netOpenEur) }}</dd></div>
      }
    </dl>
    <!-- The Kaslijn ends after its weeks; this total counts every term, also later ones (they looked contradictory side by side). -->
    @if (hasReading()) { <p class="fin-outlook__horizon">alle termijnen, ook na de {{ state.kaslijnWeeks() }} weken van de kaslijn</p> }
    @if (!hasReading()) { <p class="fin-hint fin-hint--warn">Banksaldo onbekend: vul eerst een saldo in.</p> }
    @else if (incomplete()) { <p class="fin-hint fin-hint--warn">Onvolledig: {{ incomplete() }}</p> }
    <p class="fin-hint">Containerbedragen volgen de afspraak bij de container en zijn verwacht. Toekomstige verkopen tellen niet mee; die staan in Analyses › Kasprognose. De kaslijn zet dezelfde posten op hun verwachte dag.</p>
  `,
})
export class VooruitblikEquation {
  readonly state = inject(FinanceState);
  /** The Kaslijn card's 28 px rows (the cockpit's fold). */
  readonly compact = input(false);

  readonly money = eur;
  readonly ticaOpen = computed(() => this.state.ticaSettlements().filter(row => row.status === 'OPEN').reduce((sum, row) => sum + Math.round(row.netReceivable * 100), 0) / 100);
  readonly hasReading = computed(() => this.state.bankLedger().accounts.some((account) => account.currentEur !== null));
  /** Why the totals may not be the whole story; containers still loading count, their terms are not in yet. */
  readonly incomplete = computed(() => {
    const missing = this.state.accountsView().filter((account) => !account.reading).length;
    const reasons = [
      ...(missing ? [`${missing} ${missing === 1 ? 'rekening' : 'rekeningen'} zonder saldo`] : []),
      ...(this.state.containersLoading() && this.state.purchaseFiguresVisible() ? ['containers worden geladen'] : []),
      ...(this.state.loadErrors().length ? [`niet geladen: ${this.state.failedSources().join(', ')}`] : []),
      ...this.doubleCounted(),
    ];
    return reasons.join('; ');
  });
  /** "€ 18.145,28 telt mogelijk dubbel (1 transactie)": a line that probably paid an open item counts twice until it is linked. */
  private doubleCounted(): string[] {
    const matches = this.state.kaslijn().likelyPaid;
    if (!matches.length) return [];
    const total = matches.reduce((sum, match) => sum + Math.round(Math.abs(match.amountEur) * 100), 0) / 100;
    return [`${eur(total)} telt mogelijk dubbel (${matches.length} ${matches.length === 1 ? 'transactie' : 'transacties'})`];
  }
}
