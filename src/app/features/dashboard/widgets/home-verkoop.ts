import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { isPartnerFundingDocument, overdueInvoiceRows, salesAnalysis } from '../../analyses/analysis-metrics';
import { eurWhole } from '../../finance/cash-format';
import { HomeData } from '../home-data';
import { deltaPct, deltaText, monthBars } from '../home-figures';
import { HomeWidget, amount, counted } from './home-w';

const OPEN_QUOTE = new Set(['CONCEPT', 'VERZONDEN', 'BEKEKEN', 'WIJZIGING_GEVRAAGD']);

/**
 * Verkoop (spec-home §6.2): what was invoiced this month (claims incl. btw,
 * as Analyses › Verkoop), against the same days of last month, six month
 * bars, and Pijplijn · Te ontvangen · Te laat · Omzetting. "Te ontvangen"
 * is the block's one inline link (the open invoices); "Te laat" is the same
 * list as the home's overdue-invoice rows.
 */
@Component({
  selector: 'app-home-verkoop',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, HomeWidget],
  template: `
    <app-home-w [variant]="variant()" kind="verkoop" title="Verkoop" icon="sales" tone="green" link="/analyses/sales" [wide]="true"
                [sub]="data.windows().monthName + ' · gefactureerd incl. btw'" [state]="state()">
      @if (state() === 'ready') {
        <div class="home-w__split">
          <div class="home-w__lead">
            <span class="home-w__value">{{ whole(month()) }}</span>
            <span class="home-w__delta" [class.is-up]="(delta() ?? 0) > 0" [class.is-down]="(delta() ?? 0) < 0">
              {{ deltaLabel(delta()) }} t.o.v. {{ data.windows().prevLabel }}</span>
          </div>
          <div class="home-w__bars" role="img" [attr.aria-label]="barsLabel()">
            @for (bar of bars(); track bar.key) {
              <span class="home-w__bar-col" [title]="bar.label + ': ' + whole(bar.value)">
                <i class="home-w__bar" [class.is-current]="bar.current" [style.height.%]="bar.pct"></i>
                <small>{{ bar.label }}</small>
              </span>
            }
          </div>
        </div>
        <div class="home-w__figs home-w__figs--4">
          <div class="home-w__fig"><span class="home-w__fig-label">Pijplijn</span><strong class="home-w__fig-value">{{ whole(pipelineEur()) }}</strong>
            <span class="home-w__fig-sub">{{ counted(openQuotes().length, 'offerte', 'offertes') }} · excl. btw</span></div>
          <a class="home-w__fig home-w__fig--link home-w__raise" routerLink="/sales" [queryParams]="{ scope: 'ALL', tab: 'FACTUUR', payment: 'open' }">
            <span class="home-w__fig-label">Te ontvangen ›</span><strong class="home-w__fig-value">{{ whole(data.receivables().totalEur) }}</strong>
            <span class="home-w__fig-sub">{{ counted(data.receivables().count, 'factuur', 'facturen') }} · {{ data.receivables().partialCount }} deels</span></a>
          <div class="home-w__fig" [class.is-warn]="overdue().count > 0"><span class="home-w__fig-label">Te laat</span>
            <strong class="home-w__fig-value">{{ whole(overdue().eur) }}</strong>
            <span class="home-w__fig-sub">{{ counted(overdue().count, 'factuur', 'facturen') }}</span></div>
          <div class="home-w__fig"><span class="home-w__fig-label">Omzetting</span>
            <strong class="home-w__fig-value">{{ conversion() === null ? '—' : conversion() + '%' }}</strong>
            <span class="home-w__fig-sub">offertes dit jaar</span></div>
        </div>
      }
    </app-home-w>
  `,
})
export class HomeVerkoop {
  readonly data = inject(HomeData);
  readonly variant = input<'desk' | 'phone'>('desk');
  readonly state = computed(() => this.data.combined('verkoop'));
  readonly whole = amount;
  readonly counted = counted;

  readonly month = computed(() => {
    const window = this.data.windows();
    return salesAnalysis(this.data.salesOrders(), [], { from: window.monthStart, to: window.today, today: window.today }).invoices.issuedValueEur;
  });
  private readonly previous = computed(() => {
    const window = this.data.windows();
    return salesAnalysis(this.data.salesOrders(), [], { from: window.prevFrom, to: window.prevTo, today: window.today }).invoices.issuedValueEur;
  });
  readonly delta = computed(() => deltaPct(this.month(), this.previous()));
  readonly bars = computed(() => {
    const window = this.data.windows();
    return monthBars(salesAnalysis(this.data.salesOrders(), [], { from: window.sixMonthStart, to: window.today, today: window.today }).monthly, window.today);
  });
  readonly barsLabel = computed(() => `Gefactureerd per maand: ${this.bars().map((bar) => `${bar.label} ${eurWhole(bar.value)}`).join(', ')}`);

  /** Open regular quotes (excl. btw), as the old Verkooppijplijn. */
  readonly openQuotes = computed(() => this.data.salesOrders().filter((row) => (row.order.docType ?? 'OFFERTE') === 'OFFERTE'
    && !isPartnerFundingDocument(row) && OPEN_QUOTE.has(row.order.status)));
  readonly pipelineEur = computed(() => this.openQuotes().reduce((sum, row) => sum + row.priced.totals.total, 0));
  readonly overdue = computed(() => {
    const rows = overdueInvoiceRows(this.data.salesOrders(), this.data.today());
    return { count: rows.length, eur: Math.round(rows.reduce((sum, row) => sum + row.outstandingEur, 0) * 100) / 100 };
  });
  readonly conversion = computed(() => {
    const window = this.data.windows();
    const pct = salesAnalysis(this.data.salesOrders(), [], { from: window.yearStart, to: window.today, today: window.today }).funnel.conversionRatePct;
    return pct === null ? null : Math.round(pct);
  });

  deltaLabel(pct: number | null): string {
    return deltaText(pct);
  }
}
