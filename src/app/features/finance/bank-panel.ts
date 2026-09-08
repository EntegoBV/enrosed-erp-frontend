import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DateNlPipe, EurPipe } from '../../shared/pipes';
import { FinanceState } from './finance-state';
import { IncomingPaymentList } from './incoming-payment-list';
import { BankMovementPanel } from './bank-movement-panel';
import { paymentMomentLabel } from './incoming-money';

@Component({
  selector: 'app-bank-panel', changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, EurPipe, DateNlPipe, IncomingPaymentList, BankMovementPanel],
  template: `
    <section class="fin-kpis fin-kpis--4" aria-label="Bank samengevat">
      <article class="card fin-kpi fin-kpi--dark"><small>Saldo over de rekeningen</small><strong>{{ state.currentBankEur() | eur: 0 }}</strong><span>Ingegeven saldi + eigen bankbewegingen</span></article>
      <article class="card fin-kpi"><small>Bruto ontvangen</small><strong>{{ state.incomingTotals().grossReceivedEur | eur: 0 }}</strong><span>Geregistreerde factuurontvangsten</span></article>
      <article class="card fin-kpi"><small>Terugbetaald</small><strong>{{ state.incomingTotals().refundedEur | eur: 0 }}</strong><span>Uitgevoerde terugbetalingen en credits</span></article>
      <article class="card fin-kpi fin-kpi--accent"><small>Netto ontvangen</small><strong>{{ state.incomingTotals().receivedEur | eur: 0 }}</strong><span>Bruto ontvangsten min terugbetalingen</span></article>
    </section>
    <section class="card fin-panel">
      <header class="fin-panel__head"><div><span class="section-kicker">Rekeningen</span><h2>Saldo per rekening</h2></div><button class="btn btn--primary btn--sm" (click)="state.openBank(null)">+ Saldo</button></header>
      <p class="fin-panel__hint">Elke rekening heeft haar eigen peilmoment. Het saldo telt afzonderlijke bankbewegingen en factuurbetalingen op deze rekening samen. Zodra een bankbeweging aan een bestaande factuurbetaling is gekoppeld, telt alleen de bankbeweging mee, op haar eigen rekening en tijdstip. Koppel dezelfde betaling dus altijd aan de bestaande boeking.</p>
      @if (state.bankLedger().unassignedPayments) { <p class="fin-panel__hint">{{ state.bankLedger().unassignedPayments }} factuurboekingen hebben nog geen rekening of bankkoppeling en tellen niet mee in het rekeningsaldo.</p> }
      @if (state.bankLedger().missingReadings) { <p class="fin-panel__hint">Voor {{ state.bankLedger().missingReadings }} rekeningen ontbreekt een beginsaldo. Ze zijn nog niet opgenomen in het totaal.</p> }
      <div class="fin-accounts">@for (account of state.bankLedger().accounts; track account.account) {
        <article class="fin-account"><b>{{ account.account }}</b><strong>{{ account.currentEur === null ? 'Beginsaldo ontbreekt' : (account.currentEur | eur) }}</strong>
          @if (account.reading; as reading) { <small>{{ reading.balanceEur | eur }} op {{ reading.asOfAt ? stamp(reading.asOfAt, reading.timeZone || 'Europe/Brussels') : (reading.date | dateNl) + ' einde dag' }}<br />{{ account.deltaEur | eur }} uit {{ account.movements.length }} rekeninggebonden bewegingen</small> }
          <small>Bankbewegingen + afzonderlijke factuurboekingen, ieder eenmaal</small>
          @if (account.unlinkedBookings) { <small>{{ account.unlinkedBookings }} afzonderlijke factuurboekingen op deze rekening. Koppel wanneer hiervoor ook een bankbeweging bestaat.</small> }
          <button class="linklike" (click)="state.openBank(null, account.account)">Nieuw gecontroleerd saldo</button>
          @if (account.reading && account.movements.length) { <button class="linklike" [disabled]="state.saving()" (click)="state.rollForward(account.account)">Saldo van deze rekening doortrekken</button> }
        </article>
      } @empty { <p class="fin-empty">Geef een saldo met rekening en peilmoment in en noteer daarna de bankbewegingen.</p> }</div>
    </section>
    <app-bank-movement-panel />
    @if (state.outgoingsWithoutAccount().length) {
      <section class="card fin-panel"><header class="fin-panel__head"><div><span class="section-kicker">Administratieve uitgaven</span><h2>Kosten &amp; inkoopbetalingen zonder rekening</h2></div></header>
        <p class="fin-panel__hint">{{ state.outgoingsWithoutAccount().length }} geboekte uitgaven · {{ state.outgoingsWithoutAccountEur() | eur }}. Deze bestaande uitgaven hebben geen bankrekening in hun oorspronkelijke registratie. Ze blijven hieronder zichtbaar en worden niet aan een willekeurige rekening toegeschreven. Ze kunnen al in een beginsaldo of genoteerde bankbeweging verwerkt zijn; noteer alleen een ontbrekende bankbeweging.</p>
        <details><summary>Uitgaven nakijken</summary><div class="fin-list">@for (row of state.outgoingsWithoutAccount(); track row.key) {
          <div class="fin-reading"><span class="fin-reading__date">{{ row.paidOn | dateNl }}</span><span class="fin-reading__body">@if (row.payment; as payment) { <a class="linklike" [routerLink]="['/purchasing', payment.orderId]">{{ row.description }} · {{ row.reference }} ›</a> } @else if (row.cost; as cost) { <button class="linklike" (click)="state.openCost(cost)">{{ row.description }} ›</button> }</span><strong>{{ row.amountEur | eur }}</strong></div>
        }</div></details>
      </section>
    }
    <section class="card fin-panel"><header class="fin-panel__head"><div><span class="section-kicker">Factuurboekingen</span><h2>Ontvangsten &amp; terugbetalingen</h2></div><a class="linklike" routerLink="/sales">Facturen beheren ›</a></header><app-incoming-payment-list [payments]="state.incomingPayments()" [customers]="state.customers()" /></section>
    @if (state.balances().length) { <section class="card fin-panel"><header class="fin-panel__head"><div><span class="section-kicker">Controlepunten</span><h2>Alle saldi</h2></div></header><div class="fin-list">@for (row of state.balances(); track row.id) {<button class="fin-reading" (click)="state.openBank(row)"><span class="fin-reading__date">{{ row.date | dateNl }}</span><span class="fin-reading__body"><b>{{ row.account }}</b><small>{{ row.asOfAt ? stamp(row.asOfAt, row.timeZone || 'Europe/Brussels') : 'Einde van de bankdag' }}</small>@if(row.notes){<small>{{ row.notes }}</small>}</span><strong>{{ row.balanceEur | eur }}</strong></button>}</div></section> }
  `,
})
export class BankPanel {
  readonly state = inject(FinanceState);
  stamp(receivedAt: string, timeZone: string): string { return paymentMomentLabel({ receivedAt, timeZone }); }
}
