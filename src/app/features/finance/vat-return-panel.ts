import { ChangeDetectionStrategy, Component, computed, forwardRef, inject, signal } from '@angular/core';
import { saveBlob } from '../../core/api/download';
import { Icon } from '../../shared/icon';
import { EurPipe } from '../../shared/pipes';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { Skeleton } from '../../shared/skeleton';
import { Sheet } from '../../shared/ui';
import { dayMonth, dayMonthYear } from './finance-format';
import { containerName as nameOfContainer, containerNumberHint } from '../purchasing/container-name';
import { defaultReturnPeriod } from './finance-metrics';
import { FINANCE_SECTION, FinanceSectionApi, StripItem } from './finance-section';
import { FinanceState, formatEuro } from './finance-state';
import { vatReturnCsv } from './vat-return';
import type { ContainerLine, Grid, GridCode, GridRow } from './vat-return';

type Kader = Grid['kader'];
const KADERS: readonly { kader: Kader; title: string; phone: string }[] = [
  { kader: 'V', title: 'Kader V · Aftrekbaar', phone: 'Aftrekbaar (Kader V)' },
  { kader: 'IV', title: 'Kader IV · Verschuldigd', phone: 'Verschuldigd (Kader IV)' },
  { kader: 'II', title: 'Kader II · Verkopen', phone: 'Verkopen (Kader II)' },
  { kader: 'III', title: 'Kader III · Aankopen', phone: 'Aankopen (Kader III)' },
];
/** The desk's two columns: sales and what is due on the left, purchases and the deduction on the right. */
const DESK_COLUMNS: readonly (readonly Kader[])[] = [['II', 'IV'], ['III', 'V']];
const QUARTERS = [1, 2, 3, 4] as const;
const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Analyse › Btw-aangifte: the quarterly return as form 625 reads it. The
 * headline says what comes back or is due; every grid opens on the
 * documents behind it, so a figure is never a surprise. A phone reads the
 * totals first, then Kader V/IV, then II/III; a desk shows the four Kaders
 * in two columns. Costs without a regime sit outside the grids until one
 * is picked. The money and the placing come from finance-state.vatReturnFor.
 */
@Component({
  selector: 'app-vat-return-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: FINANCE_SECTION, useExisting: forwardRef(() => VatReturnPanel) }],
  imports: [Icon, EurPipe, Segmented, Skeleton, Sheet],
  template: `
    @if (state.desk()) {
      <div class="fin-vat">
        <div class="fin-vat__chips">
          <app-segmented label="Jaar" [options]="yearOptions()" [value]="periodYear()" (changed)="pick(+$event, null)" />
          <app-segmented label="Kwartaal" [options]="quarterOptions" [value]="periodQuarter()" (changed)="pick(null, +$event)" />
          <button class="wk-btn wk-btn--sm" type="button" (click)="state.openPackage(period())">Pakket</button>
        </div>
        <div class="fin-vat__kaders">
          @for (column of deskColumns; track $index) {
            <div class="fin-vat__column">
              @for (kader of column; track kader.kader) {
                <section class="wk-card">
                  <header class="wk-card__head"><h2 class="wk-card__title">{{ kader.title }}</h2><span class="wk-card__trail">{{ kaderTotal(kader.kader) | eur }}</span></header>
                  <div class="wk-table fin-table fin-table--grids" role="table">
                    <div class="wk-thead" role="row"><span class="wk-th">Rooster</span><span class="wk-th">Omschrijving</span><span class="wk-th wk-th--num">Bedrag</span></div>
                    @for (grid of gridsOf(kader.kader); track grid.code) {
                      @if (grid.rows.length) {
                        <details>
                          <summary class="wk-tr wk-tr--link" role="row">
                            <span class="wk-td fin-vat__code">{{ grid.code }}</span>
                            <span class="wk-td">{{ grid.label }} <span class="wk-amount--muted">· {{ grid.rows.length }} {{ grid.rows.length === 1 ? 'document' : 'documenten' }}</span></span>
                            <span class="wk-td wk-td--num"><b>{{ grid.eur | eur }}</b></span>
                          </summary>
                          <ul class="fin-vat__rows">
                            @for (row of grid.rows; track $index) {
                              <li class="fin-vat__row">
                                <span>{{ day(row.date) }}</span>
                                <span><button class="wk-link" type="button" (click)="openRow(row)">{{ row.title }}</button>@if (row.sub) { <span class="wk-amount--muted">· {{ row.sub }}</span> }</span>
                                <i>{{ secondaryOf(grid, row) }}</i>
                                <b>{{ primaryOf(grid, row) | eur }}</b>
                                @if (row.badges.length) { <span class="fin-vat__badges">@for (badge of row.badges; track badge) { <span class="wk-pill wk-pill--outline">{{ badge }}</span> }</span> }
                              </li>
                            }
                          </ul>
                        </details>
                      } @else {
                        <div class="wk-tr wk-tr--muted" role="row">
                          <span class="wk-td fin-vat__code">{{ grid.code }}</span><span class="wk-td">{{ grid.label }}</span><span class="wk-td wk-td--num">{{ 0 | eur }}</span>
                        </div>
                      }
                    }
                  </div>
                </section>
              }
            </div>
          }
        </div>
        @if (unknownRows().length) {
          <section class="wk-card">
            <header class="wk-card__head"><h2 class="wk-card__title">Nog te bepalen</h2><span class="wk-card__trail">{{ unknownRows().length }} {{ unknownRows().length === 1 ? 'kost' : 'kosten' }} zonder btw-regeling</span></header>
            <ul class="fin-vat__rows">
              @for (row of unknownRows(); track row.line.costId) {
                <li class="fin-vat__row">
                  <span>{{ day(row.line.date) }}</span>
                  <span>{{ row.line.description }}@if (row.line.party) { <span class="wk-amount--muted">· {{ row.line.party }}</span> } <button class="wk-link" type="button" (click)="pickRegime(row.line.costId)">Btw-regeling kiezen…</button></span>
                  <i>excl. btw</i>
                  <b>{{ row.amountEur | eur }}</b>
                </li>
              }
            </ul>
          </section>
        }
        @if (result().notReceived.length) {
          <section class="wk-card">
            <header class="wk-card__head"><h2 class="wk-card__title">Nog niet ontvangen</h2><span class="wk-card__trail">containers zonder datum · tellen pas mee na ontvangst</span></header>
            <ul class="fin-vat__rows">
              @for (container of result().notReceived; track container.id) {
                <li class="fin-vat__row">
                  <span>—</span>
                  <span><button class="wk-link" type="button" (click)="state.openContainer(container.id)">{{ containerName(container) }}</button>@if (containerHint(container); as number) { <span class="fin-hint-number">{{ number }}</span> }</span>
                  <i>goederen</i>
                  <b>{{ container.goodsEur | eur }}</b>
                </li>
              }
            </ul>
          </section>
        }
        @if (state.containersLoading()) { <div class="fin-pending" aria-label="Containers laden…"><app-skeleton kind="list" [rows]="2" /></div> }
        <p class="fin-vat__foot">Roosters 61/62 (herzieningen) vult de boekhouder in. Detailroosters 86–88 op de maatstaf excl. btw: te bevestigen door de boekhouder.</p>
      </div>
    } @else {
      <div class="ios-headline">
        <div class="ios-headline__label">{{ headline().label }}</div>
        <div class="ios-headline__value">{{ headline().value }}</div>
        <div class="ios-headline__sub" [class.fin-warn-text]="late()">Q{{ period().quarter }} {{ period().year }} · indienen en betalen vóór {{ day(result().filingDeadline) }}</div>
        <div class="ios-headline__sub" [class.fin-warn-text]="pendingCount() > 0">{{ statusText() }}</div>
      </div>
      <div class="ios-chips" role="group" aria-label="Kwartaal">
        @for (option of yearOptions(); track option.id) {
          <button class="ios-chip" type="button" [attr.aria-pressed]="option.id === periodYear()" (click)="pick(+option.id, null)">{{ option.label }}</button>
        }
        @for (quarter of quarters; track quarter) {
          <button class="ios-chip" type="button" [attr.aria-pressed]="quarter === period().quarter" (click)="pick(null, quarter)">Q{{ quarter }}</button>
        }
      </div>
      @for (kader of kaders; track kader.kader) {
        <section class="ios-section">
          <div class="ios-section__head"><h2>{{ kader.phone }}</h2><span class="ios-section__trail">{{ kaderTotal(kader.kader) | eur }}</span></div>
          <div class="ios-group">
            @for (grid of gridsOf(kader.kader); track grid.code) {
              <button class="ios-cell" type="button" (click)="openGridCode.set(grid.code)">
                <span class="ios-cell__body"><span class="ios-cell__title ios-cell__title--2" [class.wk-amount--muted]="!grid.rows.length">Rooster {{ grid.code }} · {{ grid.label }}</span></span>
                <span class="ios-cell__trail"><span class="ios-cell__value" [class.ios-cell__value--strong]="grid.rows.length > 0" [class.wk-amount--muted]="!grid.rows.length">{{ grid.eur | eur }}</span></span>
                <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" [class.wk-amount--muted]="!grid.rows.length" />
              </button>
            }
          </div>
        </section>
      }
      @if (unknownRows().length) {
        <section class="ios-section">
          <div class="ios-section__head"><h2>Nog te bepalen</h2><span class="ios-section__trail">{{ unknownRows().length }} zonder btw-regeling</span></div>
          <div class="ios-group">
            @for (row of unknownRows(); track row.line.costId) {
              <div class="ios-cell ios-cell--tall">
                <span class="ios-cell__body"><span class="ios-cell__title">{{ row.line.description }}</span><span class="ios-cell__sub">{{ day(row.line.date) }}{{ row.line.party ? ' · ' + row.line.party : '' }} · {{ row.amountEur | eur }}</span></span>
                <button class="ios-capsule ios-capsule--tinted ios-capsule--sm" type="button" (click)="pickRegime(row.line.costId)">Btw-regeling kiezen…</button>
              </div>
            }
          </div>
        </section>
      }
      @if (result().notReceived.length) {
        <section class="ios-section">
          <div class="ios-section__head"><h2>Nog niet ontvangen</h2></div>
          <div class="ios-group">
            @for (container of result().notReceived; track container.id) {
              <button class="ios-cell" type="button" (click)="state.openContainer(container.id)">
                <span class="ios-cell__body"><span class="ios-cell__title fin-wrapall">{{ containerName(container) }}@if (containerHint(container); as number) { <small class="fin-hint-number">{{ number }}</small> }</span><span class="ios-cell__sub fin-wrapall">Telt mee in het kwartaal van ontvangst</span></span>
                <span class="ios-cell__trail"><span class="ios-cell__value">{{ container.goodsEur | eur }}</span></span>
                <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
              </button>
            }
          </div>
        </section>
      }
      @if (state.containersLoading()) { <div class="ios-card"><app-skeleton kind="list" [rows]="2" /></div> }
      <div class="ios-group fin-ios-single">
        <div class="ios-cell">
          <span class="ios-cell__body"><span class="ios-cell__title">Boekhouderspakket</span><span class="ios-cell__sub fin-wrapall">Kosten, btw-aangifte (CSV) en documenten van Q{{ period().quarter }} {{ period().year }}</span></span>
          <button class="ios-capsule ios-capsule--tinted ios-capsule--sm" type="button" (click)="state.openPackage(period())">Pakket</button>
        </div>
      </div>
      <p class="fin-vat__foot fin-ios-foot">Roosters 61/62 (herzieningen) vult de boekhouder in. Detailroosters 86–88 op de maatstaf excl. btw: te bevestigen door de boekhouder.</p>

      @if (openGrid(); as grid) {
        <app-sheet variant="ios" [title]="'Rooster ' + grid.code" (closed)="openGridCode.set(null)">
          <div body class="fin-sheet">
            <p class="fin-sheet__lead">{{ grid.label }} · {{ grid.eur | eur }}</p>
            <div class="ios-group">
              @for (row of grid.rows; track $index) {
                <button class="ios-cell ios-cell--tall fin-vat__cell" type="button" (click)="openRow(row)">
                  <span class="ios-cell__body"><span class="ios-cell__title">{{ row.title }}</span><span class="ios-cell__sub">{{ row.sub ? row.sub + ' · ' : '' }}{{ day(row.date) }}</span></span>
                  <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">{{ primaryOf(grid, row) | eur }}</span><span class="ios-cell__meta">{{ secondaryOf(grid, row) }}</span></span>
                  <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                  @if (row.badges.length) { <span class="fin-vat__badges">@for (badge of row.badges; track badge) { <span class="wk-pill wk-pill--outline">{{ badge }}</span> }</span> }
                </button>
              } @empty { <div class="ios-cell"><span class="ios-cell__sub">Niets in dit rooster.</span></div> }
            </div>
          </div>
        </app-sheet>
      }
    }
  `,
})
export class VatReturnPanel implements FinanceSectionApi {
  readonly state = inject(FinanceState);
  readonly kaders = KADERS;
  readonly deskColumns = DESK_COLUMNS.map((column) => column.map((kader) => KADERS.find((row) => row.kader === kader)!));
  readonly quarters = QUARTERS;
  readonly quarterOptions: SegmentOption[] = QUARTERS.map((quarter) => ({ id: String(quarter), label: `Q${quarter}` }));
  /** The grid whose documents are open in the phone sub-sheet. */
  readonly openGridCode = signal<GridCode | null>(null);

  /** The address, or the return due next (defaultReturnPeriod); a past year without a quarter opens on its Q4. */
  readonly period = computed(() => {
    const { year, quarter } = this.state.location();
    const today = this.state.today();
    const thisYear = Number(today.slice(0, 4));
    const chosenYear = /^\d{4}$/.test(year) ? Number(year) : 0;
    if (quarter) return { year: chosenYear || thisYear, quarter: Number(quarter) };
    if (!chosenYear || chosenYear === thisYear) return defaultReturnPeriod(today);
    return { year: chosenYear, quarter: chosenYear < thisYear ? 4 : 1 };
  });
  readonly periodYear = computed(() => String(this.period().year));
  readonly periodQuarter = computed(() => String(this.period().quarter));
  readonly result = computed(() => this.state.vatReturnFor(this.period().year, this.period().quarter));
  readonly running = computed(() => this.state.today() <= this.result().to);
  readonly late = computed(() => this.state.today() > this.result().filingDeadline && this.result().status === 'provisional');
  readonly favour = computed(() => this.result().totals.refundEur > 0);
  readonly amount = computed(() => (this.favour() ? this.result().totals.refundEur : this.result().totals.payableEur));
  readonly openClearances = computed(() => this.result().openClearanceCount);
  /** Everything that waits for a confirmation: derived regimes, costs without one and containers without a confirmed clearance. */
  readonly pendingCount = computed(() => this.result().unconfirmedCount + this.result().unknown.length + this.openClearances());

  readonly headline = computed(() => ({
    label: this.running() ? `Btw Q${this.period().quarter} tot nu · ${this.favour() ? 'in je voordeel' : 'te betalen'}` : this.favour() ? 'Btw terug te krijgen' : 'Btw te betalen',
    value: formatEuro(this.amount()),
  }));
  readonly statusText = computed(() => {
    if (this.result().status === 'ready') return 'Klaar voor de boekhouder';
    const pending = this.pendingCount();
    const open = this.openClearances();
    if (pending && pending === open) return `Voorlopig · ${open} ${open === 1 ? 'inklaring' : 'inklaringen'} te bevestigen`;
    if (pending) return `Voorlopig · ${pending} te bevestigen`;
    return this.running() ? 'Voorlopig · het kwartaal loopt nog' : 'Voorlopig';
  });

  readonly yearOptions = computed<SegmentOption[]>(() => {
    const thisYear = Number(this.state.today().slice(0, 4));
    const years = new Set<number>([thisYear - 1, thisYear, this.period().year]);
    return [...years].sort((a, b) => a - b).map((year) => ({ id: String(year), label: String(year) }));
  });

  /** Costs without a regime, with the amount of the cost behind the line. */
  readonly unknownRows = computed(() => this.result().unknown.map((line) => ({
    line, amountEur: line.exclEur,
  })));

  readonly strip = computed<StripItem[]>(() => [
    { label: this.favour() ? 'Terug te krijgen' : 'Te betalen', value: formatEuro(this.amount()), tone: this.favour() ? 'in' : 'strong' },
    { label: 'Btw op verkopen (54)', value: formatEuro(this.grid('54').eur) },
    { label: 'Aftrekbaar (59)', value: formatEuro(this.grid('59').eur) },
    { label: 'Te bevestigen', value: String(this.pendingCount()), tone: this.pendingCount() ? 'warn' : 'muted' },
    { label: 'Indienen vóór', value: dayMonthYear(this.result().filingDeadline), tone: this.late() ? 'warn' : undefined },
  ]);
  readonly status = computed(() => `${this.result().status === 'ready' ? 'Klaar' : 'Voorlopig'} · Q${this.period().quarter} ${this.period().year} · indienen vóór ${dayMonthYear(this.result().filingDeadline)}`);

  readonly openGrid = computed(() => (this.openGridCode() ? this.result().grids.find((grid) => grid.code === this.openGridCode()) ?? null : null));

  handle(): boolean {
    return false;
  }

  exportCsv(): void {
    const { year, quarter } = this.period();
    saveBlob(new Blob(['﻿' + vatReturnCsv(this.result())], { type: 'text/csv;charset=utf-8' }), `btw-aangifte-${year}-Q${quarter}.csv`);
  }

  pick(year: number | null, quarter: number | null): void {
    const current = this.period();
    this.state.go({ year: String(year ?? current.year), quarter: String(quarter ?? current.quarter) as '1' | '2' | '3' | '4' });
  }

  grid(code: GridCode): Grid {
    return this.result().grids.find((grid) => grid.code === code)!;
  }

  gridsOf(kader: Kader): Grid[] {
    return this.result().grids.filter((grid) => grid.kader === kader);
  }

  /** What a Kader adds up to: the VAT for IV and V, the sales bases for II, the totals 81–83 for III (86–88 repeat them). */
  kaderTotal(kader: Kader): number {
    const totals = this.result().totals;
    if (kader === 'IV') return totals.dueEur;
    if (kader === 'V') return totals.deductibleEur;
    /* Kader II reads as the sales: 48 and 49 are the credit notes on them, listed in their rows but never added to the headline. */
    const codes = kader === 'III' ? ['81', '82', '83'] : ['00', '01', '02', '03', '44', '45', '46', '47'];
    return round2(codes.reduce((sum, code) => sum + this.grid(code as GridCode).eur, 0));
  }

  /** The figure a grid counts: the base in Kader II/III, the VAT in IV/V; the other one is shown beside it. */
  primaryOf(grid: Grid, row: GridRow): number {
    return grid.kader === 'IV' || grid.kader === 'V' ? row.vatEur : row.baseEur;
  }

  secondaryOf(grid: Grid, row: GridRow): string {
    return grid.kader === 'IV' || grid.kader === 'V' ? `basis ${formatEuro(row.baseEur)}` : row.vatEur ? `btw ${formatEuro(row.vatEur)}` : '';
  }

  openRow(row: GridRow): void {
    this.openGridCode.set(null);
    if (row.kind === 'sales') this.state.openInvoice(row.id);
    else if (row.kind === 'container') this.state.openContainer(row.id);
    else this.pickRegime(row.id);
  }

  /** A cost row opens its form on the Btw-regeling disclosure; a cost no longer loaded is inspected instead. */
  pickRegime(costId: number | null): void {
    const cost = this.costOf(costId);
    if (cost) this.state.openCost(cost, [], { regime: true });
    else if (costId) this.state.inspectItem({ kind: 'cost', id: costId });
  }

  /** The container by its name (alias, else PO number); the number as small print beside an alias. */
  containerName(container: ContainerLine): string {
    return nameOfContainer({ id: container.id, number: container.number, alias: container.alias });
  }
  containerHint(container: ContainerLine): string | null {
    return containerNumberHint(this.containerName(container), container.number);
  }

  private costOf(costId: number | null) {
    return costId ? this.state.costs().find((cost) => cost.id === costId) ?? null : null;
  }

  day(date: string | null): string { return dayMonth(date); }
}
