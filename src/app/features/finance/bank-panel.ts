import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DateNlPipe, EurPipe } from '../../shared/pipes';
import { FinanceState } from './finance-state';
import { IncomingPaymentList } from './incoming-payment-list';
import { BankMovementPanel } from './bank-movement-panel';
import { paymentMomentLabel } from './incoming-money';

type BankView = 'movements' | 'receipts' | 'accounts';
@Component({
  selector: 'app-bank-panel', changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, EurPipe, DateNlPipe, IncomingPaymentList, BankMovementPanel],
  template: `
    <section class="finance-bank-summary" aria-label="Bank samengevat">
      <button type="button" class="finance-bank-total" (click)="tab.set('accounts')"><span>{{ knownAccounts() ? state.bankLedger().missingReadings ? 'Bekend deel van je banksaldo' : 'Berekend banksaldo' : 'Banksaldo nog onbekend' }}</span><strong>{{ knownAccounts() ? (state.currentBankEur() | eur) : 'Nog invullen' }}</strong><small>{{ state.bankLedger().missingReadings ? 'Deeltotaal · ' + state.bankLedger().missingReadings + ' rekening(en) zonder beginsaldo' : 'Volgens de ingevoerde saldi en betalingen' }}</small></button>
      <div><span>Rekeningen</span><strong>{{ state.bankLedger().accounts.length }}</strong><small>{{ knownAccounts() }} met een beginsaldo</small></div>
      <div><span>Bankbewegingen</span><strong>{{ state.bankStatements().length }}</strong><small>{{ linkedCount() }} aan een factuurbetaling gekoppeld</small></div>
    </section>
    @if (!knownAccounts() || state.bankLedger().missingReadings) {
      <div class="finance-setup"><div><b>{{ !knownAccounts() ? 'Begin met het saldo uit je bankapp' : 'Nog niet alle rekeningen hebben een beginsaldo' }}</b><p>Noteer per rekening het saldo met datum en tijd. Latere geregistreerde bewegingen worden daarbij opgeteld.</p></div><button type="button" class="btn btn--sm" (click)="setupBank()">Banksaldo invullen</button></div>
    }
    <nav class="finance-bank-tabs" aria-label="Bankonderdelen">
      <button type="button" [class.active]="tab() === 'movements'" [attr.aria-pressed]="tab() === 'movements'" (click)="tab.set('movements')"><b>Bankbewegingen</b><span>{{ state.bankStatements().length }} geregistreerd</span></button>
      <button type="button" [class.active]="tab() === 'receipts'" [attr.aria-pressed]="tab() === 'receipts'" (click)="tab.set('receipts')"><b>Factuurbetalingen</b><span>Ontvangsten & terugbetalingen</span></button>
      <button type="button" [class.active]="tab() === 'accounts'" [attr.aria-pressed]="tab() === 'accounts'" (click)="tab.set('accounts')"><b>Rekeningen</b><span>Saldi & controlepunten</span></button>
    </nav>

    <div [hidden]="tab() !== 'movements'">
      <app-bank-movement-panel />
      <details class="card finance-help"><summary>Hoe gebruik ik Bank & betalingen?</summary>
        <ol><li><b>Noteer het beginsaldo.</b> Neem rekening, saldo en tijdstip over uit je bankapp.</li><li><b>Voeg een bankbeweging toe.</b> Kies geld in of uit en vul bedrag, datum, tijd en omschrijving in.</li><li><b>Koppel waar nodig een factuurbetaling.</b> Kies de verkoop- of partnerfactuur. Is de betaling al genoteerd bij die factuur? Koppel dan de bestaande betaling.</li></ol>
        <p>Een leveranciersbetaling of bedrijfsuitgave kun je als bankbeweging registreren. Rechtstreeks koppelen aan een inkoopbetaling of bedrijfskost is nog niet beschikbaar. Eén bankbeweging kan aan één factuurbetaling worden gekoppeld.</p>
      </details>
    </div>

    @if (tab() === 'receipts') {
      <section class="card fin-panel">
        <header class="fin-panel__head"><div><span class="section-kicker">Geld op verkoop- en partnerfacturen</span><h2>Ontvangsten &amp; terugbetalingen</h2></div><a class="linklike" routerLink="/sales" [queryParams]="{scope: 'ALL', tab: 'FACTUUR'}">Facturen beheren ›</a></header>
        <p class="fin-panel__hint">Betalingen die bij een factuur zijn geregistreerd. Een bankbeweging zonder factuurkoppeling staat hier niet tussen.</p>
        @if (state.bankLedger().unassignedPayments) { <p class="finance-inline-note">Over alle datums: {{ state.bankLedger().unassignedPayments }} factuurbetalingen hebben geen rekening of bankkoppeling. Ze tellen niet mee in het banksaldo. <button class="linklike" type="button" (click)="tab.set('movements')">Bankbeweging koppelen ›</button></p> }
        <app-incoming-payment-list [payments]="state.incomingPayments()" [customers]="state.customers()" />
      </section>
    }

    @if (tab() === 'accounts') {
      <section class="card fin-panel">
        <header class="fin-panel__head"><div><span class="section-kicker">Per rekening</span><h2>Saldi controleren</h2></div><button type="button" class="btn btn--sm" (click)="state.openBank(null)">+ Rekening / saldo</button></header>
        <p class="fin-panel__hint">Dit overzicht is berekend uit jouw registraties. Vergelijk het met je bankapp en voeg een nieuw saldo toe als controlepunt.</p>
        <div class="finance-accounts">@for (account of state.bankLedger().accounts; track account.account) {
          <article class="finance-account">
            <header><b>{{ account.account }}</b><span [class.finance-status--warn]="account.currentEur === null" class="finance-status">{{ account.currentEur === null ? 'Beginsaldo nodig' : 'Berekend' }}</span></header>
            <strong class="finance-account__amount">{{ account.currentEur === null ? 'Nog onbekend' : (account.currentEur | eur) }}</strong>
            @if (account.reading; as reading) {
              <dl class="finance-equation"><div><dt>Laatst ingevoerd saldo</dt><dd>{{ reading.balanceEur | eur }}</dd></div><div><dt>Bewegingen daarna ({{ account.movements.length }})</dt><dd>{{ account.deltaEur | eur }}</dd></div></dl>
              <small>{{ reading.asOfAt ? stamp(reading.asOfAt, reading.timeZone || 'Europe/Brussels') : (reading.date | dateNl) + ' einde dag' }}</small>
            } @else { <p class="fin-panel__hint">De bewegingen zijn bewaard. Het saldo kan pas berekend worden na het invoeren van een beginsaldo.</p> }
            @if (account.unlinkedBookings) { <p class="fin-panel__hint">{{ account.unlinkedBookings }} losse factuurbetalingen geregistreerd. Alleen betalingen na het controlepunt tellen erbij. Koppel dezelfde betaling aan elkaar als je die ook als bankbeweging invoert.</p> }
            <button type="button" class="btn btn--sm" (click)="state.openBank(null, account.account)">{{ account.reading ? 'Nieuw banksaldo invullen' : 'Beginsaldo invullen' }}</button>
          </article>
        } @empty { <div class="finance-placeholder"><b>Je eerste rekening toevoegen</b><p>Gebruik een herkenbare naam of IBAN en vul het huidige saldo uit je bankapp in.</p><button type="button" class="btn btn--primary btn--sm" (click)="state.openBank(null)">Rekening toevoegen</button></div> }</div>
        <details class="finance-explainer"><summary>Hoe wordt mijn saldo berekend?</summary><p>Elke rekening begint bij haar laatste ingevoerde saldo en tijdstip. Alleen latere bankbewegingen en afzonderlijke factuurbetalingen met die rekening tellen erbij. Een gekoppelde bankbeweging vervangt de factuurbetaling, zodat hetzelfde bedrag één keer meetelt. Een betaling zonder rekening telt niet mee.</p></details>
      </section>
      @if (state.balances().length) {
        <section class="card fin-panel"><header class="fin-panel__head"><div><span class="section-kicker">Geschiedenis</span><h2>Ingevoerde saldi</h2></div><span class="finance-status">{{ state.balances().length }} controlepunten</span></header><p class="fin-panel__hint">Open een saldo om de registratie te bekijken of te corrigeren.</p><div class="fin-list">@for (row of state.balances(); track row.id) {<button type="button" class="fin-reading" (click)="state.openBank(row)"><span class="fin-reading__date">{{ row.date | dateNl }}</span><span class="fin-reading__body"><b>{{ row.account }}</b><small>{{ row.asOfAt ? stamp(row.asOfAt, row.timeZone || 'Europe/Brussels') : 'Einde van de bankdag' }}</small>@if(row.notes){<small>{{ row.notes }}</small>}</span><strong>{{ row.balanceEur | eur }}</strong></button>}</div></section>
      }
      @if (state.outgoingsWithoutAccount().length) {
        <details class="card finance-help"><summary>Administratieve uitgaven bekijken ({{ state.outgoingsWithoutAccount().length }})</summary>
          <p>{{ state.outgoingsWithoutAccountEur() | eur }} aan betaalde bedrijfskosten en inkoopbetalingen, over alle datums. Deze registraties hebben geen bankrekening. Ze kunnen al verwerkt zijn in een saldo of bankbeweging; dit is geen lijst van ontbrekende bankbewegingen.</p>
          <div class="fin-list">@for (row of state.outgoingsWithoutAccount(); track row.key) {
            <div class="fin-reading"><span class="fin-reading__date">{{ row.paidOn | dateNl }}</span><span class="fin-reading__body">@if (row.payment; as payment) { <a class="linklike" [routerLink]="['/purchasing', payment.orderId]">{{ row.description }} · {{ row.reference }} ›</a> } @else if (row.cost; as cost) { <button class="linklike" type="button" (click)="state.openCost(cost)">{{ row.description }} ›</button> }</span><strong>{{ row.amountEur | eur }}</strong></div>
          }</div>
        </details>
      }
    }
  `,
})
export class BankPanel {
  readonly state = inject(FinanceState);
  readonly tab = signal<BankView>('movements');
  readonly movementPanel = viewChild(BankMovementPanel);
  readonly knownAccounts = computed(() => this.state.bankLedger().accounts.filter(account => account.currentEur !== null).length);
  readonly linkedCount = computed(() => this.state.bankStatements().filter(row => row.salesPaymentId !== null).length);
  setupBank(): void { this.tab.set('accounts'); this.state.openBank(null, this.state.bankLedger().accounts.find(account => account.currentEur === null)?.account ?? ''); }
  addMovement(): void { this.tab.set('movements'); this.movementPanel()?.add(); }
  stamp(receivedAt: string, timeZone: string): string { return paymentMomentLabel({ receivedAt, timeZone }); }
}
