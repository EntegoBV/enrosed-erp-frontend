import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DateNlPipe, EurPipe } from '../../shared/pipes';
import { TrendChart, TrendSeries } from '../../shared/trend-chart';
import { FinanceState } from './finance-state';

/** The bank: every account at its latest reading, the total over time, and what is about to move. */
@Component({
  selector: 'app-bank-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EurPipe, DateNlPipe, TrendChart],
  template: `
    <section class="fin-kpis fin-kpis--4" aria-label="Bank samengevat">
      <article class="card fin-kpi fin-kpi--dark"><small>Totaal op de bank</small><strong>{{ state.bank().totalEur | eur: 0 }}</strong><span>{{ state.bank().asOf ? 'laatste saldo van ' + (state.bank().asOf | dateNl) : 'nog geen saldo ingegeven' }}</span></article>
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
        <p class="fin-empty">Geef het saldo van de zichtrekening in, en later dat van de spaarrekening of de kredietlijn. Elke nieuwe ingave wordt een punt op de lijn.</p>
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
              <span class="fin-reading__body"><b>{{ row.account }}</b>@if (row.notes) { <small>{{ row.notes }}</small> }</span>
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
  readonly series = computed<TrendSeries[]>(() => {
    const total = this.state.bank().series;
    return total.dates.length >= 2 ? [{ label: 'Totaal', dates: total.dates, values: total.values, tone: 'accent' }] : [];
  });
}
