import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DateNlPipe, EurPipe } from '../../shared/pipes';
import { TrendChart, TrendSeries } from '../../shared/trend-chart';
import { MovementKind, latestBankReading } from './finance-metrics';
import { FinanceState } from './finance-state';
import { IncomingPaymentList } from './incoming-payment-list';
import { paymentMomentLabel } from './incoming-money';

const KIND_LABELS: Record<MovementKind, string> = { COST: 'Kost', PURCHASE: 'Inkoop', INVOICE: 'Factuur' };

/** The bank: the last reading rolled forward with what the ERP saw move, per account, and what is about to move. */
@Component({
  selector: 'app-bank-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, EurPipe, DateNlPipe, TrendChart, IncomingPaymentList],
  template: `
    <section class="fin-kpis fin-kpis--4" aria-label="Bank samengevat">
      <article class="card fin-kpi fin-kpi--dark"><small>Op de bank nu</small><strong>{{ state.currentBankEur() | eur: 0 }}</strong>
        <span>{{ state.bank().asOf ? (state.movements().rows.length ? 'saldo van ' + (state.bank().asOf | dateNl) + ' + ' + state.movements().rows.length + ' bewegingen' : 'saldo van ' + (state.bank().asOf | dateNl)) : 'nog geen saldo ingegeven' }}</span></article>
      <article class="card fin-kpi" [class.fin-kpi--warn]="state.openCosts().length"><small>Gaat eruit</small><strong>{{ state.outlook().openCostsEur + state.outlook().upcomingEur | eur: 0 }}</strong><span>{{ state.openCostsInclEur() | eur: 0 }} open + {{ state.upcomingInclEur() | eur: 0 }} vaste kosten, 30 dagen</span></article>
      <article class="card fin-kpi"><small>Komt binnen</small><strong>{{ state.openInvoices().totalEur | eur: 0 }}</strong><span>{{ state.openInvoices().count }} open {{ state.openInvoices().count === 1 ? 'factuur' : 'facturen' }}</span></article>
      <article class="card fin-kpi fin-kpi--accent"><small>Verwacht saldo</small><strong>{{ state.outlook().expectedEur | eur: 0 }}</strong><span>na wat eruit gaat en binnenkomt</span></article>
    </section>

    <section class="card fin-panel">
      <header class="fin-panel__head">
        <div><span class="section-kicker">Rekeningen</span><h2>Laatste saldo per rekening</h2></div>
        <button class="btn btn--primary btn--sm hide-mobile" type="button" (click)="state.openBank(null)">+ Saldo</button>
      </header>
      @if (!state.bank().accounts.length) {
        <p class="fin-empty">Geef het saldo van de zichtrekening in, en later dat van de spaarrekening of de kredietlijn. Vanaf dan schuift het saldo mee met elke betaalde kost, inkoopbetaling en ontvangen factuur.</p>
      } @else {
        <div class="fin-accounts">
          @for (account of state.bank().accounts; track account.account) {
            <article class="fin-account">
              <b>{{ account.account }}</b>
              <strong [class.fin-neg]="account.balanceEur < 0">{{ account.balanceEur | eur }}</strong>
              <small>op {{ account.date | dateNl }}@if (account.deltaEur !== null) { · <i [class.fin-up]="account.deltaEur > 0" [class.fin-down]="account.deltaEur < 0">{{ account.deltaEur > 0 ? '+' : '' }}{{ account.deltaEur | eur: 0 }}</i> sinds vorige }</small>
              <button class="linklike" type="button" (click)="state.openBank(null, account.account)">Nieuw saldo</button>
            </article>
          }
        </div>
      }
    </section>

    <section class="card fin-panel">
      <header class="fin-panel__head">
        <div><span class="section-kicker">Sinds het laatste saldo</span><h2>{{ moves().since ? 'Bewogen na ' + checkpointLabel() : 'Nog geen saldo om van te vertrekken' }}</h2></div>
        @if (moves().rows.length) {
          <button class="btn btn--sm" type="button" [disabled]="state.saving()" (click)="state.rollForward()" title="Schrijft het doorgerekende saldo als nieuw saldo van vandaag">{{ state.saving() ? 'Bezig…' : 'Saldo doortrekken' }}</button>
        }
      </header>
      @if (!moves().since) {
        <p class="fin-empty">Geef eerst een saldo in. Daarna telt het ERP elke betaalde kost, elke inkoopbetaling en elke ontvangen factuur van na die dag erbij of eraf.</p>
      } @else if (!moves().rows.length) {
        <p class="fin-empty">Niets bewogen sinds {{ moves().since | dateNl }}. Zet kosten op betaald, boek inkoopbetalingen op de container en markeer facturen als betaald: dan schuift het saldo vanzelf mee.</p>
      } @else {
        <div class="fin-moves__sum">
          <span><small>Saldo van {{ moves().since | dateNl }}</small><b>{{ state.bank().totalEur | eur }}</b></span>
          <span><small>Eruit</small><b class="fin-down">− {{ moves().outEur | eur }}</b></span>
          <span><small>Erin</small><b class="fin-up">+ {{ moves().inEur | eur }}</b></span>
          <span><small>Nu</small><b>{{ moves().currentEur | eur }}</b></span>
        </div>
        <div class="fin-list">
          @for (row of moves().rows; track row.key ?? $index) {
            <div class="fin-move">
              <span class="fin-move__date">{{ row.date | dateNl }}</span>
              <span class="fin-move__kind" [attr.data-kind]="row.kind">{{ kindLabel(row.kind) }}</span>
              <span class="fin-move__body">
                @if (row.salesOrderId) { <a class="linklike" [routerLink]="['/sales', row.salesOrderId, 'edit']"><b>{{ row.label }} ›</b></a> }
                @else if (row.purchaseOrderId) { <a class="linklike" [routerLink]="['/purchasing', row.purchaseOrderId]"><b>{{ row.label }} ›</b></a> }
                @else { <b>{{ row.label }}</b> }
                <small>{{ row.detail }}</small>
                @if (row.receivedAt) { <small>{{ momentLabel({ receivedAt: row.receivedAt, timeZone: row.timeZone || 'Europe/Brussels' }) }}</small> }
              </span>
              <strong [class.fin-up]="row.amountEur > 0" [class.fin-down]="row.amountEur < 0">{{ row.amountEur > 0 ? '+' : '−' }} {{ abs(row.amountEur) | eur }}</strong>
            </div>
          }
        </div>
        <p class="fin-panel__hint">Saldo doortrekken schrijft {{ moves().currentEur | eur }} als saldo van vandaag op {{ latestAccount() }}. Vergelijk met de bank en corrigeer wat het ERP niet zag: bankkosten, privé, btw.</p>
      }
    </section>

    <section class="card fin-panel">
      <header class="fin-panel__head"><div><span class="section-kicker">Inkomende betalingen</span><h2>{{ state.incomingTotals().receivedEur | eur }} ontvangen</h2></div><a class="linklike" routerLink="/sales">Facturen beheren ›</a></header>
      <p class="fin-panel__hint">{{ state.incomingTotals().standardEur | eur }} klanten · {{ state.incomingTotals().partnerAdvanceEur | eur }} partnervoorschotten · {{ state.incomingTotals().partnerSettlementEur | eur }} partnerafrekeningen. Geregistreerde kasontvangsten, inclusief eventuele btw; voorschotten zijn nog geen omzet.</p>
      <app-incoming-payment-list [payments]="state.incomingPayments()" [customers]="state.customers()" />
    </section>

    @if (series().length) {
      <section class="card fin-panel">
        <header class="fin-panel__head"><div><span class="section-kicker">Verloop</span><h2>Alle rekeningen samen</h2></div></header>
        <app-trend-chart [series]="series()" prefix="€ " [decimals]="0" [height]="160" ariaLabel="Banksaldo over de tijd" emptyText="Geef minstens twee saldi in voor een verloop" />
      </section>
    }

    @if (state.balances().length) {
      <section class="card fin-panel">
        <header class="fin-panel__head"><div><span class="section-kicker">Ingaven</span><h2>Alle saldi</h2></div></header>
        <div class="fin-list">
          @for (row of state.balances(); track row.id) {
            <button class="fin-reading" type="button" (click)="state.openBank(row)">
              <span class="fin-reading__date">{{ row.date | dateNl }}</span>
              <span class="fin-reading__body"><b>{{ row.account }}</b><small>{{ row.asOfAt ? momentLabel({ receivedAt: row.asOfAt, timeZone: row.timeZone || 'Europe/Brussels' }) : 'Saldo aan het einde van deze dag' }}</small>@if (row.notes) { <small>{{ row.notes }}</small> }</span>
              <strong [class.fin-neg]="row.balanceEur < 0">{{ row.balanceEur | eur }}</strong>
            </button>
          }
        </div>
      </section>
    }
  `,
})
export class BankPanel {
  readonly state = inject(FinanceState);
  readonly momentLabel = paymentMomentLabel;
  readonly moves = computed(() => this.state.movements());
  readonly latestAccount = computed(() => latestBankReading(this.state.balances())?.account ?? '');
  readonly checkpointLabel = computed(() => {
    const bank = this.state.bank();
    return bank.asOfAt ? paymentMomentLabel({ receivedAt: bank.asOfAt, timeZone: bank.timeZone || 'Europe/Brussels' }) : `${bank.asOf ?? ''} (einde dag)`;
  });
  readonly series = computed<TrendSeries[]>(() => {
    const total = this.state.bank().series;
    return total.dates.length >= 2 ? [{ label: 'Totaal', dates: total.dates, values: total.values, tone: 'accent' }] : [];
  });

  kindLabel(kind: MovementKind): string {
    return KIND_LABELS[kind];
  }

  abs(value: number): number {
    return Math.abs(value);
  }
}
