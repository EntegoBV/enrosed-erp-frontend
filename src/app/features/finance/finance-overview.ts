import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DateNlPipe, EurPipe } from '../../shared/pipes';
import { TrendChart, TrendSeries } from '../../shared/trend-chart';
import { resultAnalysis } from '../analyses/analysis-metrics';
import { CostRow } from './cost-row';
import { addDays, intervalLabel, monthlyCostSeries, upcomingRecurring } from './finance-metrics';
import { FinanceView, MONTH_START, TODAY, YEAR } from './finance-sections';
import { FinanceState } from './finance-state';
import { PurchasePaymentCostRow } from './purchase-payment-cost-row';
import { incomingMoneyTotals } from './incoming-money';

/** The money at a glance: the bank, what has to go out, what comes in, and how the months run. */
@Component({
  selector: 'app-finance-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, EurPipe, DateNlPipe, TrendChart, CostRow, PurchasePaymentCostRow],
  template: `
    <section class="finance-snapshot" aria-label="Geld in één oogopslag">
      <button type="button" class="finance-balance" (click)="navigate.emit('bank')">
        <span class="finance-eyebrow">{{ bankKnown() ? bankComplete() ? 'Berekend banksaldo' : 'Bekend deel van je banksaldo' : 'Banksaldo nog onbekend' }}</span>
        <strong>{{ bankKnown() ? (state.currentBankEur() | eur) : 'Vul je saldo in' }}</strong>
        <span>{{ bankComplete() ? state.bankLedger().accounts.length + ' rekening(en) · op basis van je registraties' : bankKnown() ? 'Deeltotaal · ' + state.bankLedger().missingReadings + ' rekening(en) zonder beginsaldo' : 'Begin met het saldo en tijdstip uit je bankapp.' }}</span>
        <b>{{ bankKnown() ? 'Rekeningen bekijken' : 'Bank instellen' }} <span aria-hidden="true">↗</span></b>
      </button>
      <div class="finance-position">
        <button type="button" (click)="navigate.emit('open')"><span><b>Te betalen</b><small>{{ state.openCosts().length }} open bedrijfskosten · incl. btw</small></span><strong>{{ state.openCostsInclEur() | eur }}</strong></button>
        <a routerLink="/sales" [queryParams]="{scope: 'ALL', tab: 'FACTUUR', payment: 'open'}"><span><b>Te ontvangen</b><small>{{ state.openInvoices().count }} open verkoop- en partnerfacturen</small></span><strong>{{ state.openInvoices().totalEur | eur }}</strong></a>
        <button type="button" (click)="navigate.emit('recurring')"><span><b>Vaste kosten binnenkort</b><small>{{ state.upcoming().length }} geplande boekingen · komende 30 dagen</small></span><strong>{{ state.upcomingInclEur() | eur }}</strong></button>
      </div>
    </section>

    <section class="card fin-panel finance-next" aria-label="Volgende acties">
      <header class="fin-panel__head"><div><span class="section-kicker">Aan de slag</span><h2>Wat wil je bijwerken?</h2></div></header>
      <div class="finance-actions">
        <button type="button" (click)="navigate.emit('bank')"><span class="finance-action-icon" aria-hidden="true">↔</span><span><b>Bankbeweging noteren</b><small>Geld ontvangen of betaald? Vul het handmatig in.</small></span><span aria-hidden="true">›</span></button>
        <button type="button" (click)="state.openCost(null)"><span class="finance-action-icon" aria-hidden="true">+</span><span><b>Kost toevoegen</b><small>Een bedrijfsuitgave met factuur of bon.</small></span><span aria-hidden="true">›</span></button>
        <button type="button" (click)="navigate.emit('open')"><span class="finance-action-icon" aria-hidden="true">✓</span><span><b>Betalingen bijwerken</b><small>{{ olderCosts() ? olderCosts() + (olderCosts() === 1 ? ' open kost met een boekdatum ouder dan 30 dagen.' : ' open kosten met een boekdatum ouder dan 30 dagen.') : 'Bekijk je open bedrijfskosten en noteer wat betaald is.' }}</small></span><span aria-hidden="true">›</span></button>
      </div>
      @if (state.dueNow().length || state.bankLedger().unassignedPayments) {
        <div class="finance-attention">
          @if (state.dueNow().length) { <button class="linklike" type="button" (click)="navigate.emit('recurring')">{{ state.dueNow().length }} vaste kosten klaar om te boeken ›</button> }
          @if (state.bankLedger().unassignedPayments) { <button class="linklike" type="button" (click)="navigate.emit('bank')">{{ state.bankLedger().unassignedPayments }} {{ state.bankLedger().unassignedPayments === 1 ? 'factuurbetaling' : 'factuurbetalingen' }} zonder rekening ›</button> }
        </div>
      }
    </section>

    <div class="fin-cols">
      <section class="card fin-panel finance-scenario">
        <header class="fin-panel__head"><div><span class="section-kicker">Vooruitkijken</span><h2>Als alles wordt betaald</h2></div></header>
        <p class="fin-panel__hint">Een rekenscenario met de bedragen die nu bekend zijn.</p>
        @if (bankComplete() && !state.loadErrors().length) {
          <dl class="finance-equation">
            <div><dt>Berekend banksaldo</dt><dd>{{ state.currentBankEur() | eur }}</dd></div>
            <div><dt>Alle open bedrijfskosten</dt><dd>− {{ state.openCostsInclEur() | eur }}</dd></div>
            <div><dt>Vaste kosten komende 30 dagen</dt><dd>− {{ state.upcomingInclEur() | eur }}</dd></div>
            <div class="finance-equation__subtotal"><dt>Na deze kosten</dt><dd [class.finance-negative]="afterCosts() < 0">{{ afterCosts() | eur }}</dd></div>
            <div><dt>Alle open klant- en partnerfacturen</dt><dd>+ {{ state.openInvoices().totalEur | eur }}</dd></div>
            <div class="finance-equation__total"><dt>Als ook die facturen binnenkomen</dt><dd [class.finance-negative]="state.outlook().expectedEur < 0">{{ state.outlook().expectedEur | eur }}</dd></div>
          </dl>
        } @else {
          <div class="finance-placeholder"><b>{{ state.loadErrors().length ? 'Nog geen volledig beeld' : 'Eerst een beginsaldo per rekening' }}</b><p>Dit scenario verschijnt zodra alle gegevens en rekeningsaldi beschikbaar zijn.</p><button class="linklike" type="button" (click)="navigate.emit('bank')">Rekeningen bekijken ›</button></div>
        }
        <details class="finance-explainer"><summary>Welke bedragen tellen mee?</summary><p>Alle open bedrijfskosten en uitgeschreven facturen tellen mee, ongeacht hun betaaldatum. Van vaste kosten nemen we de komende 30 dagen mee. Nog te betalen containertermijnen, toekomstige verkopen en mogelijke terugbetalingen zitten hier niet in. Dit is geen voorspelling voor een vaste datum.</p></details>
      </section>
      <section class="card fin-panel finance-receipts">
        <header class="fin-panel__head"><div><span class="section-kicker">{{ monthLabel }}</span><h2>Ontvangen op facturen</h2></div><button class="linklike" type="button" (click)="navigate.emit('bank')">Bekijk ›</button></header>
        <div class="finance-receipt-total"><strong>{{ incomingMonth().receivedEur | eur }}</strong><span>netto · {{ incomingMonth().count }} registraties</span></div>
        <dl class="finance-equation">
          <div><dt>Ontvangsten</dt><dd>{{ incomingMonth().grossReceivedEur | eur }}</dd></div>
          <div><dt>Terugbetalingen</dt><dd>− {{ incomingMonth().refundedEur | eur }}</dd></div>
        </dl>
        <div class="finance-breakdown"><b>Waaruit bestaat het nettobedrag?</b><div><span>Klantbetalingen</span><strong>{{ incomingMonth().standardEur | eur }}</strong></div><div><span>Partnervoorschotten</span><strong>{{ incomingMonth().partnerAdvanceEur | eur }}</strong></div><div><span>Partnerafrekeningen</span><strong>{{ incomingMonth().partnerSettlementEur | eur }}</strong></div></div>
        <p class="fin-panel__hint">Partnervoorschotten zijn ontvangen financiering. Een ontvangst is niet automatisch omzet of winst.</p>
      </section>
    </div>

    <section class="card fin-panel">
      <header class="fin-panel__head"><div><span class="section-kicker">Open facturen</span><h2>Wie moet nog betalen?</h2></div><a class="linklike" routerLink="/sales" [queryParams]="{scope: 'ALL', tab: 'FACTUUR', payment: 'open'}">Naar facturen ›</a></header>
      <div class="finance-receivable-split"><div><span>Reguliere verkoop</span><strong>{{ state.openInvoices().standardEur | eur }}</strong></div><div><span>Partnercontainers</span><strong>{{ state.openInvoices().partnerEur | eur }}</strong></div><p>{{ state.openInvoices().partialCount }} facturen zijn gedeeltelijk betaald. De bedragen tonen alleen wat nog openstaat.</p></div>
    </section>

    <section class="card fin-panel">
      <header class="fin-panel__head">
        <div><span class="section-kicker">Bedrijfskosten per maand</span><h2>{{ monthEur() | eur: 0 }} deze maand · {{ yearEur() | eur: 0 }} dit jaar</h2></div>
        <button class="linklike" type="button" (click)="navigate.emit('analysis')">Analyse ›</button>
      </header>
      <p class="fin-panel__hint">Bedrijfskosten excl. btw · <a class="linklike" routerLink="/analyses/result">Resultaat {{ year }}: {{ result().resultEur | eur }} ›</a></p>
      <app-trend-chart [series]="series()" prefix="€ " [decimals]="0" [height]="150" ariaLabel="Kosten per maand, de laatste twaalf maanden" emptyText="Nog geen kosten geboekt" />
      @if (containerPaymentsEur()) { <p class="fin-panel__hint">Daarnaast {{ containerPaymentsEur() | eur }} aan containerbetalingen dit jaar, geregistreerd bij de inkooporders. De goederenwaarde telt in de verkoopmarge mee.</p> }
    </section>

    <div class="fin-cols">
      <section class="card fin-panel">
        <header class="fin-panel__head">
          <div><span class="section-kicker">Vaste kosten</span><h2>Komt eraan</h2></div>
          <button class="linklike" type="button" (click)="navigate.emit('recurring')">Alle vaste kosten ›</button>
        </header>
        @if (state.dueNow().length) {
          <p class="fin-note fin-note--warn">{{ state.dueNow().length }} vaste {{ state.dueNow().length === 1 ? 'kost staat' : 'kosten staan' }} klaar om te boeken.
            <button class="linklike" type="button" [disabled]="state.booking()" (click)="state.bookNow()">{{ state.booking() ? 'Bezig…' : 'Nu boeken' }}</button></p>
        }
        @if (!ahead().length) {
          <p class="fin-empty">{{ state.recurring().length ? 'Niets gepland in de komende 60 dagen.' : 'Nog geen vaste kosten: huur, boekhouder, software, verzekering. Stel ze één keer in, de boekingen volgen vanzelf.' }}
            <button class="linklike" type="button" (click)="state.openRecurring(null)">Vaste kost instellen</button></p>
        } @else {
          <ul class="fin-agenda">
            @for (row of ahead(); track row.date + '/' + row.definition.id) {
              <li>
                <span class="fin-agenda__date">{{ row.date | dateNl }}</span>
                <span class="fin-agenda__body"><b>{{ row.definition.name }}</b><small>{{ intervalLabel(row.definition.interval) }}{{ row.definition.party ? ' · ' + row.definition.party : '' }}{{ row.definition.autoPaid ? ' · domiciliëring' : '' }}</small></span>
                <strong>{{ row.amountInclEur | eur }}</strong>
              </li>
            }
          </ul>
        }
      </section>

      <section class="card fin-panel">
        <header class="fin-panel__head">
          <div><span class="section-kicker">Openstaand</span><h2>Te betalen</h2></div>
          <button class="linklike" type="button" (click)="navigate.emit('open')">Alles open ›</button>
        </header>
        @if (!state.openCosts().length) {
          <p class="fin-empty">Er zijn geen open bedrijfskosten geregistreerd.</p>
        } @else {
          <div class="fin-list">
            @for (cost of openSoon(); track cost.id) { <app-cost-row [cost]="cost" /> }
          </div>
          @if (state.openCosts().length > openSoon().length) {
            <button class="linklike fin-more" type="button" (click)="navigate.emit('open')">Nog {{ state.openCosts().length - openSoon().length }} meer ›</button>
          }
        }
      </section>
    </div>

    <section class="card fin-panel">
      <header class="fin-panel__head">
        <div><span class="section-kicker">Laatste boekingen</span><h2>Recent</h2></div>
        <div class="fin-panel__actions">
          <button class="linklike" type="button" (click)="navigate.emit('costs')">Alle kosten ›</button>
          <button class="btn btn--primary btn--sm hide-mobile" type="button" (click)="state.openCost(null)">+ Kost</button>
        </div>
      </header>
      @if (state.loading()) {
        <p class="fin-empty">Laden…</p>
      } @else if (!recent().length) {
        <p class="fin-empty">Nog geen kosten geboekt. Boek de beurs, de boekhouder of de huur met + Kost.</p>
      } @else {
        <div class="fin-list">
          @for (row of recent(); track row.key) {
            @if (row.cost; as cost) { <app-cost-row [cost]="cost" /> }
            @else { <app-purchase-payment-cost-row [row]="row" /> }
          }
        </div>
      }
    </section>
  `,
})
export class FinanceOverview {
  readonly state = inject(FinanceState);
  readonly navigate = output<FinanceView>();
  readonly intervalLabel = intervalLabel;
  readonly year = YEAR;
  readonly monthLabel = new Date(TODAY + 'T12:00:00').toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' });
  readonly bankKnown = computed(() => this.state.bankLedger().accounts.some(account => account.currentEur !== null));
  readonly bankComplete = computed(() => this.bankKnown() && !this.state.bankLedger().missingReadings);
  readonly afterCosts = computed(() => this.state.currentBankEur() - this.state.openCostsInclEur() - this.state.upcomingInclEur());
  readonly olderCosts = computed(() => this.state.openCosts().filter(cost => cost.date < addDays(TODAY, -30)).length);
  readonly incomingMonth = computed(() => incomingMoneyTotals(this.state.incomingPayments(), MONTH_START, TODAY));

  readonly monthEur = computed(() => sum(this.state.costs().filter((cost) => cost.date >= MONTH_START && cost.date <= TODAY)));
  readonly yearEur = computed(() => sum(this.state.costs().filter((cost) => cost.date >= `${YEAR}-01-01` && cost.date <= TODAY)));
  readonly series = computed<TrendSeries[]>(() => {
    const months = monthlyCostSeries(this.state.costs(), 12, TODAY);
    return months.values.some((value) => value > 0) ? [{ label: 'Kosten excl. btw', dates: months.dates, values: months.values, tone: 'accent' }] : [];
  });
  readonly ahead = computed(() => upcomingRecurring(this.state.recurring(), TODAY, addDays(TODAY, 60)).slice(0, 8));
  readonly openSoon = computed(() => this.state.openCosts().slice(0, 6));
  readonly recent = computed(() => this.state.ledger().slice(0, 6));
  readonly containerPaymentsEur = computed(() => Math.round(this.state.ledger()
    .filter((row) => row.source === 'container' && row.date >= `${YEAR}-01-01` && row.date <= TODAY)
    .reduce((total, row) => total + row.amountEur, 0) * 100) / 100);
  readonly result = computed(() => resultAnalysis(this.state.salesOrders(), [], this.state.costs(), { from: `${YEAR}-01-01`, to: TODAY }));
}

function sum(costs: readonly { amountExclEur: number }[]): number {
  return Math.round(costs.reduce((total, cost) => total + (cost.amountExclEur || 0), 0) * 100) / 100;
}
