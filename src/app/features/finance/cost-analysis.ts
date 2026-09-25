import { ChangeDetectionStrategy, Component, computed, forwardRef, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EurPipe, PctPipe } from '../../shared/pipes';
import { TrendChart, TrendSeries } from '../../shared/trend-chart';
import { channelLabel } from '../sales/sales-channels';
import { categoryLabel } from './cost-categories';
import { costSummary } from './cost-metrics';
import { CONTAINER_PAYMENT_CATEGORIES, costLedgerTotals, missingDocument } from './cost-ledger';
import { dayMonth } from './finance-format';
import { largestCosts, monthlyCostSeries, topParties, vatByQuarter, yearComparison } from './finance-metrics';
import { FINANCE_SECTION, FinanceSectionApi, StripItem } from './finance-section';
import { FinanceState, formatEuro } from './finance-state';

const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const round2 = (value: number): number => Math.round(value * 100) / 100;
type ShareRow = { key: string; label: string; count: number; exclEur: number; sharePct: number };
type TableId = 'category' | 'party' | 'channel';

/**
 * Analyse: where the money goes, excl. btw. The year comes from the address;
 * a single year gets the btw per quarter (with the documents still missing
 * and the accountant package) and the months against the year before.
 * Container payments are purchasing and stay in their own card.
 */
@Component({
  selector: 'app-cost-analysis',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: FINANCE_SECTION, useExisting: forwardRef(() => CostAnalysis) }],
  imports: [RouterLink, EurPipe, PctPipe, TrendChart],
  template: `
    @if (!state.desk()) {
      <div class="ios-figures">
        @for (item of kpis(); track item.label) { <div><small>{{ item.label }}</small><strong>{{ item.value }}</strong></div> }
      </div>
    }
    <section [class]="state.desk() ? 'wk-card fin-chart' : 'ios-card fin-chart'">
      <header [class]="state.desk() ? 'wk-card__head' : 'fin-chart__head'"><h2 class="wk-card__title">{{ chartTitle() }}</h2></header>
      <div [class.wk-card__body]="state.desk()"><app-trend-chart [series]="series()" prefix="€ " [decimals]="0" [height]="170" [ariaLabel]="chartTitle()" emptyText="Nog geen kosten geboekt" /></div>
    </section>

    <div [class.fin-analysis-grid]="state.desk()">
      @for (table of tables(); track table.id) {
        @if (state.desk()) {
          <section class="fin-card fin-share">
            <header class="wk-card__head"><h2 class="wk-card__title">{{ table.title }}</h2>
              <button class="wk-link wk-card__trail" type="button" (click)="flipSort(table.id)">{{ sortByName().has(table.id) ? 'Op naam' : 'Op bedrag' }}</button></header>
            <ul class="fin-share__list">
              @for (row of table.rows; track row.key) {
                <li><span class="fin-share__label"><b>{{ row.label }}</b><small>{{ row.count }} {{ row.count === 1 ? 'kost' : 'kosten' }}</small></span>
                  <span class="fin-share__amount">{{ row.exclEur | eur: 0 }}<small>{{ row.sharePct | pct: 0 }}</small></span>
                  <span class="wk-meter"><i [style.width.%]="row.sharePct"></i><i class="is-rest" [style.width.%]="100 - row.sharePct"></i></span></li>
              } @empty { <li class="fin-hint">Niets in deze periode.</li> }
            </ul>
          </section>
        } @else {
          <section class="ios-section">
            <div class="ios-section__head"><h2>{{ table.title }}</h2></div>
            <div class="ios-group">
              @for (row of table.rows; track row.key) {
                <div class="ios-cell fin-share-cell"><span class="ios-cell__body"><span class="ios-cell__title">{{ row.label }}</span>
                  <span class="wk-meter"><i [style.width.%]="row.sharePct"></i><i class="is-rest" [style.width.%]="100 - row.sharePct"></i></span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">{{ row.exclEur | eur: 0 }}</span><span class="ios-cell__meta">{{ row.sharePct | pct: 0 }}</span></span></div>
              } @empty { <div class="ios-cell"><span class="ios-cell__sub">Niets in deze periode.</span></div> }
            </div>
          </section>
        }
      }
      @if (state.desk()) {
        <section class="fin-card fin-share">
          <header class="wk-card__head"><h2 class="wk-card__title">Grootste kosten</h2></header>
          <ul class="fin-share__list">
            @for (cost of largest(); track cost.id) {
              <li><button class="fin-share__row-btn" type="button" (click)="state.inspectItem({ kind: 'cost', id: cost.id! })">
                <span class="fin-share__label"><b>{{ cost.description }}</b><small>{{ day(cost.date) }} · {{ category(cost.category) }}{{ cost.party ? ' · ' + cost.party : '' }}</small></span>
                <span class="fin-share__amount">{{ cost.amountExclEur | eur: 0 }}</span></button></li>
            } @empty { <li class="fin-hint">Niets in deze periode.</li> }
          </ul>
        </section>
      } @else {
        <section class="ios-section">
          <div class="ios-section__head"><h2>Grootste kosten</h2></div>
          <div class="ios-group">
            @for (cost of largest(); track cost.id) {
              <button class="ios-cell" type="button" (click)="state.inspectItem({ kind: 'cost', id: cost.id! })"><span class="ios-cell__body"><span class="ios-cell__title">{{ cost.description }}</span><span class="ios-cell__sub">{{ day(cost.date) }} · {{ category(cost.category) }}</span></span>
                <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">{{ cost.amountExclEur | eur: 0 }}</span></span></button>
            }
          </div>
        </section>
      }
    </div>

    @if (year() > 0) {
      @if (state.desk()) {
        <section class="wk-card fin-vat">
          <header class="wk-card__head"><h2 class="wk-card__title">Btw per kwartaal · {{ year() }}</h2><span class="wk-card__trail">{{ quartersTotal().vatEur | eur }} btw</span></header>
          <div class="wk-table fin-table fin-table--vat" role="table">
            <div class="wk-thead" role="row"><span class="wk-th">Kwartaal</span><span class="wk-th wk-th--num">Excl.</span><span class="wk-th wk-th--num">Btw</span><span class="wk-th wk-th--num" data-hide="md">Incl.</span><span class="wk-th wk-th--num" title="Zonder document">Zonder document</span><span class="wk-th"></span></div>
            @for (row of quarters(); track row.quarter) {
              <div class="wk-tr" role="row" [class.wk-tr--muted]="!row.count">
                <span class="wk-td"><b>{{ row.label }}</b> <span class="wk-amount--muted">· {{ row.count }} {{ row.count === 1 ? 'kost' : 'kosten' }}</span></span>
                <span class="wk-td wk-td--num">{{ row.exclEur | eur }}</span><span class="wk-td wk-td--num">{{ row.vatEur | eur }}</span><span class="wk-td wk-td--num" data-hide="md">{{ row.inclEur | eur }}</span>
                <span class="wk-td wk-td--num">@if (row.missing) { <button class="wk-link" type="button" (click)="showMissing(row.quarter)">{{ row.missing }}</button> } @else { <span class="wk-amount--muted">0</span> }</span>
                <span class="wk-td fin-td-end"><button class="wk-btn wk-btn--sm" type="button" (click)="state.openPackage({ year: year(), quarter: row.quarter })">Pakket</button></span>
              </div>
            }
            <div class="wk-tr wk-tr--total" role="row"><span class="wk-td">{{ year() }}</span><span class="wk-td wk-td--num">{{ quartersTotal().exclEur | eur }}</span><span class="wk-td wk-td--num">{{ quartersTotal().vatEur | eur }}</span><span class="wk-td wk-td--num" data-hide="md">{{ quartersTotal().inclEur | eur }}</span><span class="wk-td"></span><span class="wk-td"></span></div>
          </div>
        </section>
        <section class="wk-card fin-compare">
          <header class="wk-card__head"><h2 class="wk-card__title">Per maand tegenover {{ year() - 1 }}</h2><span class="wk-card__trail">{{ compareTotal().thisYearEur | eur: 0 }} · vorig jaar {{ compareTotal().lastYearEur | eur: 0 }}</span></header>
          <div class="wk-card__body fin-months">
            @for (row of compare(); track row.month) {
              <div class="fin-months__row" [class.fin-months__row--quiet]="!row.thisYearEur && !row.lastYearEur">
                <span class="fin-months__label">{{ monthName(row.month) }}</span>
                <span class="fin-months__bars"><i class="fin-months__this" [style.width.%]="compareMax() ? row.thisYearEur / compareMax() * 100 : 0"></i><i class="fin-months__last" [style.width.%]="compareMax() ? row.lastYearEur / compareMax() * 100 : 0"></i></span>
                <strong>{{ row.thisYearEur | eur: 0 }}</strong><small>{{ row.lastYearEur ? (row.lastYearEur | eur: 0) : '—' }}</small>
              </div>
            }
          </div>
        </section>
      } @else {
        <section class="ios-section">
          <div class="ios-section__head"><h2>Btw per kwartaal</h2><span class="ios-section__trail">{{ quartersTotal().vatEur | eur }}</span></div>
          <div class="ios-group">
            @for (row of quarters(); track row.quarter) {
              <div class="ios-cell"><span class="ios-cell__body"><span class="ios-cell__title">{{ row.label }} · {{ row.vatEur | eur }} btw</span>
                <span class="ios-cell__sub">{{ row.exclEur | eur }} excl. · {{ row.missing }} zonder document</span></span>
                <button class="ios-capsule ios-capsule--tinted ios-capsule--sm" type="button" (click)="state.openPackage({ year: year(), quarter: row.quarter })">Pakket</button></div>
            }
          </div>
        </section>
      }
    }

    @if (state.purchaseFiguresVisible() && containerTotals().containerCount) {
      <section [class]="state.desk() ? 'wk-card' : 'ios-card'">
        <header [class]="state.desk() ? 'wk-card__head' : 'fin-chart__head'"><h2 class="wk-card__title">Containerbetalingen · inkoop, geen bedrijfskosten</h2>
          <a class="wk-link wk-card__trail" routerLink="/analyses/purchasing">Kostprijs &amp; verschillen ›</a></header>
        <div [class.wk-card__body]="state.desk()">
          @for (row of containerStreams(); track row.code) {
            <div class="fin-pay-line"><span>{{ row.label }}</span><span>{{ row.count }} {{ row.count === 1 ? 'betaling' : 'betalingen' }}</span><b>{{ row.paidEur | eur }}</b></div>
          }
        </div>
      </section>
    }
    <p class="fin-foot-link"><a class="wk-link" routerLink="/analyses/result">Resultaat &amp; marge in Analyses ›</a></p>
  `,
})
export class CostAnalysis implements FinanceSectionApi {
  readonly state = inject(FinanceState);
  readonly sortByName = signal<ReadonlySet<TableId>>(new Set());

  readonly thisYear = computed(() => Number(this.state.today().slice(0, 4)));
  /** 0 is every year. */
  readonly year = computed(() => {
    const raw = this.state.location().year;
    return raw === 'all' ? 0 : raw ? Number(raw) : this.thisYear();
  });
  /** This year counts up to today; a future-dated cost is not spent yet. */
  readonly rows = computed(() => {
    const year = this.year();
    const today = this.state.today();
    return this.state.costs().filter((cost) => year === 0 || (cost.date.startsWith(`${year}-`) && (year !== this.thisYear() || cost.date <= today)));
  });
  readonly summary = computed(() => costSummary(this.rows()));
  readonly monthsCounted = computed(() => this.summary().byMonth.filter((row) => row.exclEur > 0).length);
  readonly perMonth = computed(() => (this.monthsCounted() ? round2(this.summary().exclEur / this.monthsCounted()) : 0));
  readonly containerRows = computed(() => this.state.ledger().filter((row) => row.source === 'container'
    && (this.year() === 0 || row.date.startsWith(`${this.year()}-`))));
  readonly containerTotals = computed(() => costLedgerTotals(this.containerRows()));
  readonly containerStreams = computed(() => CONTAINER_PAYMENT_CATEGORIES.map((category) => {
    const rows = this.containerRows().filter((row) => row.category === category.code);
    return { ...category, count: rows.length, paidEur: round2(rows.reduce((sum, row) => sum + row.amountEur, 0)) };
  }).filter((row) => row.count));

  readonly kpis = computed<StripItem[]>(() => [
    { label: 'Kosten excl. btw', value: formatEuro(this.summary().exclEur), tone: 'strong' },
    { label: 'Btw', value: formatEuro(this.summary().vatEur) },
    { label: 'Gemiddeld per maand', value: formatEuro(this.perMonth()) },
    ...(this.state.purchaseFiguresVisible() ? [{ label: 'Containerbetalingen (betaald)', value: formatEuro(this.containerTotals().containerPaidEur), tone: 'muted' as const, title: 'Inkoop, geen bedrijfskosten' }] : []),
  ]);
  readonly strip = this.kpis;
  readonly status = computed(() => `${this.summary().count} ${this.summary().count === 1 ? 'kost' : 'kosten'} · ${this.year() || 'alle jaren'}`);

  readonly chartTitle = computed(() => (this.year() ? `Per maand · ${this.year()} tegenover ${this.year() - 1}` : 'Per maand · laatste twaalf maanden'));
  readonly series = computed<TrendSeries[]>(() => {
    const year = this.year();
    if (!year) {
      const months = monthlyCostSeries(this.state.costs(), 12, this.state.today());
      return months.values.some((value) => value > 0) ? [{ label: 'Kosten excl. btw', dates: months.dates, values: months.values, tone: 'accent' }] : [];
    }
    const compare = yearComparison(this.state.costs(), year);
    const dates = compare.map((row) => `${year}-${String(row.month).padStart(2, '0')}-01`);
    if (!compare.some((row) => row.thisYearEur || row.lastYearEur)) return [];
    return [
      { label: String(year), dates, values: compare.map((row) => row.thisYearEur), tone: 'accent' },
      { label: String(year - 1), dates, values: compare.map((row) => row.lastYearEur), tone: 'muted' },
    ];
  });

  readonly tables = computed(() => {
    const total = this.summary().exclEur;
    const order = (id: TableId, rows: ShareRow[]): ShareRow[] => (this.sortByName().has(id)
      ? [...rows].sort((a, b) => a.label.localeCompare(b.label, 'nl')) : rows);
    const byCategory: ShareRow[] = this.summary().byCategory.map((row) => ({ key: row.category, label: categoryLabel(row.category), count: row.count, exclEur: row.exclEur, sharePct: row.sharePct }));
    const byParty: ShareRow[] = topParties(this.rows(), 8).map((row) => ({ key: row.party, label: row.party, count: row.count, exclEur: row.exclEur, sharePct: row.sharePct }));
    const byChannel: ShareRow[] = this.summary().byChannel.map((row) => ({ key: row.channel ?? 'ALGEMEEN', label: row.channel ? channelLabel(row.channel) : 'Algemene kosten',
      count: row.count, exclEur: row.exclEur, sharePct: total > 0 ? round2(row.exclEur / total * 100) : 0 }));
    return [
      { id: 'category' as const, title: 'Per categorie', rows: order('category', byCategory) },
      { id: 'party' as const, title: 'Grootste partijen', rows: order('party', byParty) },
      { id: 'channel' as const, title: 'Per kanaal', rows: order('channel', byChannel) },
    ];
  });
  readonly largest = computed(() => largestCosts(this.rows(), 8));
  readonly quarters = computed(() => vatByQuarter(this.state.costs(), this.year()).map((row) => ({
    ...row,
    missing: this.state.costs().filter((cost) => cost.date.startsWith(`${this.year()}-`) && Math.floor((Number(cost.date.slice(5, 7)) - 1) / 3) + 1 === row.quarter
      && missingDocument(cost, this.state.documentedIds())).length,
  })));
  readonly quartersTotal = computed(() => ({
    exclEur: round2(this.quarters().reduce((sum, row) => sum + row.exclEur, 0)),
    vatEur: round2(this.quarters().reduce((sum, row) => sum + row.vatEur, 0)),
    inclEur: round2(this.quarters().reduce((sum, row) => sum + row.inclEur, 0)),
  }));
  readonly compare = computed(() => yearComparison(this.state.costs(), this.year()));
  readonly compareMax = computed(() => Math.max(0, ...this.compare().flatMap((row) => [row.thisYearEur, row.lastYearEur])));
  readonly compareTotal = computed(() => ({
    thisYearEur: round2(this.compare().reduce((sum, row) => sum + row.thisYearEur, 0)),
    lastYearEur: round2(this.compare().reduce((sum, row) => sum + row.lastYearEur, 0)),
  }));

  handle(): boolean {
    return false;
  }

  flipSort(id: TableId): void {
    this.sortByName.update((set) => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  showMissing(quarter: number): void {
    const first = (quarter - 1) * 3 + 1;
    const from = `${this.year()}-${String(first).padStart(2, '0')}-01`;
    const to = new Date(Date.UTC(this.year(), first + 2, 0)).toISOString().slice(0, 10);
    this.state.go({ view: 'costs', tab: 'company', docs: 'missing', from, to }, 'push');
  }

  monthName(month: number): string { return MONTHS[month - 1] ?? ''; }
  category(code: string): string { return categoryLabel(code); }
  day(date: string): string { return dayMonth(date); }
}
