import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DateNlPipe, EurPipe } from '../../shared/pipes';
import { TrendChart, TrendSeries } from '../../shared/trend-chart';
import { resultAnalysis } from '../analyses/analysis-metrics';
import { CostRow } from './cost-row';
import { addDays, intervalLabel, monthlyCostSeries, upcomingRecurring } from './finance-metrics';
import { FinanceView, MONTH_START, TODAY, YEAR } from './finance-sections';
import { FinanceState } from './finance-state';

/** The money at a glance: the bank, what has to go out, what comes in, and how the months run. */
@Component({
  selector: 'app-finance-overview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, EurPipe, DateNlPipe, TrendChart, CostRow],
  template: `
    <section class="fin-kpis" aria-label="Kerncijfers">
      <button type="button" class="card fin-kpi fin-kpi--dark" (click)="navigate.emit('bank')">
        <small>Op de bank</small><strong>{{ state.currentBankEur() | eur: 0 }}</strong>
        <span>{{ state.bank().asOf ? (state.movements().rows.length ? 'saldo van ' + (state.bank().asOf | dateNl) + ' + ' + state.movements().rows.length + ' bewegingen' : 'saldo van ' + (state.bank().asOf | dateNl)) : 'nog geen saldo ingegeven' }}</span>
      </button>
      <button type="button" class="card fin-kpi" [class.fin-kpi--warn]="state.openCosts().length" (click)="navigate.emit('open')">
        <small>Nog te betalen</small><strong>{{ state.openCostsInclEur() | eur: 0 }}</strong>
        <span>{{ state.openCosts().length }} open, incl. btw</span>
      </button>
      <button type="button" class="card fin-kpi" (click)="navigate.emit('recurring')">
        <small>Komende 30 dagen</small><strong>{{ state.upcomingInclEur() | eur: 0 }}</strong>
        <span>{{ state.upcoming().length }} vaste {{ state.upcoming().length === 1 ? 'kost' : 'kosten' }}, incl. btw</span>
      </button>
      <a class="card fin-kpi" routerLink="/sales">
        <small>Te ontvangen</small><strong>{{ state.openInvoices().totalEur | eur: 0 }}</strong>
        <span>{{ state.openInvoices().count }} open {{ state.openInvoices().count === 1 ? 'factuur' : 'facturen' }}, incl. btw</span>
      </a>
      <article class="card fin-kpi fin-kpi--accent">
        <small>Verwacht saldo</small><strong>{{ state.outlook().expectedEur | eur: 0 }}</strong>
        <span>bank − open − komend + facturen</span>
      </article>
      <a class="card fin-kpi" routerLink="/analyses/result" [class.fin-kpi--neg]="result().resultEur < 0">
        <small>Resultaat {{ year }}</small><strong>{{ result().resultEur | eur: 0 }}</strong>
        <span>marge {{ result().marginEur | eur: 0 }} − kosten {{ result().costsEur | eur: 0 }}</span>
      </a>
    </section>

    <section class="card fin-panel">
      <header class="fin-panel__head">
        <div><span class="section-kicker">Kosten per maand</span><h2>{{ monthEur() | eur: 0 }} deze maand · {{ yearEur() | eur: 0 }} dit jaar</h2></div>
        <button class="linklike" type="button" (click)="navigate.emit('analysis')">Analyse ›</button>
      </header>
      <app-trend-chart [series]="series()" prefix="€ " [decimals]="0" [height]="150" ariaLabel="Kosten per maand, de laatste twaalf maanden" emptyText="Nog geen kosten geboekt" />
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
          <p class="fin-empty">Alles is betaald.</p>
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
          @for (cost of recent(); track cost.id) { <app-cost-row [cost]="cost" /> }
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

  readonly monthEur = computed(() => sum(this.state.costs().filter((cost) => cost.date >= MONTH_START && cost.date <= TODAY)));
  readonly yearEur = computed(() => sum(this.state.costs().filter((cost) => cost.date >= `${YEAR}-01-01` && cost.date <= TODAY)));
  readonly series = computed<TrendSeries[]>(() => {
    const months = monthlyCostSeries(this.state.costs(), 12, TODAY);
    return months.values.some((value) => value > 0) ? [{ label: 'Kosten excl. btw', dates: months.dates, values: months.values, tone: 'accent' }] : [];
  });
  readonly ahead = computed(() => upcomingRecurring(this.state.recurring(), TODAY, addDays(TODAY, 60)).slice(0, 8));
  readonly openSoon = computed(() => this.state.openCosts().slice(0, 6));
  readonly recent = computed(() => [...this.state.costs()]
    .sort((left, right) => right.date.localeCompare(left.date) || (right.id ?? 0) - (left.id ?? 0)).slice(0, 6));
  readonly result = computed(() => resultAnalysis(this.state.salesOrders(), [], this.state.costs(), { from: `${YEAR}-01-01`, to: TODAY }));
}

function sum(costs: readonly { amountExclEur: number }[]): number {
  return Math.round(costs.reduce((total, cost) => total + (cost.amountExclEur || 0), 0) * 100) / 100;
}
