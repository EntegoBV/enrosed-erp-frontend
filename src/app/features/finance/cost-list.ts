import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, forwardRef, inject, signal, untracked } from '@angular/core';
import { CompanyCost } from '../../core/api/models';
import { DateField } from '../../shared/date-field';
import { Icon } from '../../shared/icon';
import { EurPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';
import { costSummary } from './cost-metrics';
import { CostRow } from './cost-row';
import { CostLedgerRow, filterCostLedger } from './cost-ledger';
import { channelLabel } from '../sales/sales-channels';
import { FinanceFilterFields } from './finance-filter-fields';
import { monthLabel } from './finance-format';
import { FINANCE_SECTION, FinanceSectionApi, StripItem } from './finance-section';
import { SortDirection, selectOne, sortRows } from './finance-selection';
import type { FinanceCommand } from './finance-shortcuts';
import { FinanceState, formatEuro } from './finance-state';
import { FinanceTable } from './finance-table';
import { FinancePeriod } from './finance-url';
import { inclOf, vatOf } from './finance-metrics';

type SortKey = 'date' | 'description' | 'category' | 'excl' | 'incl';

/**
 * Uitgaven › Bedrijfskosten: the company's own costs in a period, never
 * mixed with container cash. Excl. btw with the btw beside it; month groups
 * while sorted by date; selection, bulk actions, a menu per row and file
 * drops. Filters come from the address; the default is this year.
 */
@Component({
  selector: 'app-cost-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: FINANCE_SECTION, useExisting: forwardRef(() => CostList) }],
  imports: [Icon, EurPipe, CostRow, Sheet, DateField, FinanceFilterFields],
  template: `
    @if (state.desk()) {
      @if (rows().length) {
        <div class="wk-table fin-table fin-table--costs" role="grid" aria-label="Bedrijfskosten" [class.wk-table--selecting]="table.count() > 0">
          <div class="wk-thead" role="row">
            <span class="wk-th" role="columnheader"><input class="wk-check" type="checkbox" aria-label="Alle kosten selecteren" [checked]="allChecked()" [indeterminate]="someChecked()" (change)="table.checkAll(keys())" /></span>
            <span class="wk-th" role="columnheader" [attr.aria-sort]="ariaSort('date')"><button class="wk-th__btn" type="button" (click)="sortBy('date')">Datum</button></span>
            <span class="wk-th" role="columnheader" [attr.aria-sort]="ariaSort('description')"><button class="wk-th__btn" type="button" (click)="sortBy('description')">Omschrijving</button></span>
            <span class="wk-th" role="columnheader" data-hide="xs" [attr.aria-sort]="ariaSort('category')"><button class="wk-th__btn" type="button" (click)="sortBy('category')">Categorie</button></span>
            <span class="wk-th fin-hide-lg" role="columnheader" data-hide="md inspecting">Referentie</span>
            <span class="wk-th fin-hide-lg" role="columnheader" data-hide="md inspecting">Kanaal</span>
            <span class="wk-th" role="columnheader" data-hide="md"><app-icon name="clip" [size]="13" /></span>
            <span class="wk-th wk-th--num" role="columnheader" data-hide="xs" [attr.aria-sort]="ariaSort('excl')"><button class="wk-th__btn" type="button" (click)="sortBy('excl')">Excl.</button></span>
            <span class="wk-th wk-th--num" role="columnheader" data-hide="md">Btw</span>
            <span class="wk-th wk-th--num" role="columnheader" [attr.aria-sort]="ariaSort('incl')"><button class="wk-th__btn" type="button" (click)="sortBy('incl')">Incl.</button></span>
            <span class="wk-th" role="columnheader">Status</span>
          </div>
          @for (group of groups(); track group.key) {
            @if (group.label) {
              <div class="wk-group" role="row">
                <span class="wk-group__label">{{ group.label }} <span class="wk-group__count">· {{ group.rows.length }} {{ group.rows.length === 1 ? 'kost' : 'kosten' }}</span></span>
                <span class="wk-td--num fin-sum fin-sum--excl" data-hide="xs">{{ group.exclEur | eur }}</span>
                <span class="wk-td--num fin-sum fin-sum--vat" data-hide="md">{{ group.vatEur | eur }}</span>
                <span class="wk-td--num fin-sum fin-sum--incl">{{ group.inclEur | eur }}</span>
              </div>
            }
            @for (row of group.rows; track row.key) {
              <app-cost-row [cost]="row.cost!" columns="ledger" [selected]="table.isSelected(row.key)" [tabStop]="table.stop() === row.key"
                            (focused)="table.focused(row.key)" (select)="table.click(row.key, $event)" (check)="table.check(row.key)" />
            }
          }
        </div>
      } @else {
        <div class="wk-empty">
          <span class="wk-empty__icon"><app-icon name="receipt" [size]="22" /></span>
          @if (state.costs().length) {
            <p class="wk-empty__title">Geen kosten in deze periode</p>
            <p class="wk-empty__text">Kies een andere periode, of herstel de standaardweergave (dit jaar, zonder filters).</p>
            <div class="wk-empty__actions">
              <button class="wk-btn" type="button" (click)="periodMenu($event)">Periode wijzigen</button>
              <button class="wk-btn" type="button" (click)="reset()">Standaard herstellen</button>
            </div>
          } @else {
            <p class="wk-empty__title">Nog geen kosten geboekt</p>
            <p class="wk-empty__text">Boek de beurs, de boekhouder of de huur met Kost boeken.</p>
          }
        </div>
      }
    } @else {
      <div class="ios-search fin-ios-search"><label class="ios-search__field"><app-icon name="search" [size]="16" />
        <input type="search" placeholder="Zoeken" aria-label="Zoeken in kosten" [value]="state.location().q" (input)="search($any($event.target).value)" />
        <button class="ios-search__clear" type="button" aria-label="Zoekterm wissen" (click)="search('')"><app-icon name="close" [size]="14" /></button></label></div>
      <div class="ios-chips" role="group" aria-label="Periode">
        @for (option of phonePeriods(); track option.id) {
          <button class="ios-chip" type="button" [attr.aria-pressed]="state.location().period === option.id" (click)="state.go({ period: option.id })">{{ option.label }}</button>
        }
        <button class="ios-chip" type="button" [attr.aria-pressed]="state.location().period === 'custom'" (click)="openRange()">Eigen…</button>
        <button class="ios-chip" type="button" [attr.aria-pressed]="filterCount() > 0" (click)="filtersOpen.set(true)"><app-icon name="filter" [size]="16" />Filter
          @if (filterCount()) { <span class="ios-chip__badge">{{ filterCount() }}</span> }</button>
      </div>
      <div class="ios-figures">
        <div><small>Excl. btw</small><strong>{{ summary().exclEur | eur }}</strong></div>
        <div><small>Btw</small><strong>{{ summary().vatEur | eur }}</strong></div>
        <div><small>Incl. btw</small><strong>{{ summary().inclEur | eur }}</strong></div>
        <div><small>Open ({{ summary().unpaidCount }})</small><strong [class.wk-amount--warn]="summary().unpaidCount > 0">{{ summary().unpaidEur | eur }}</strong></div>
      </div>
      @for (group of monthGroups(); track group.key) {
        <section class="ios-section">
          <div class="ios-section__head"><h2>{{ group.label }}</h2><span class="ios-section__trail">{{ group.inclEur | eur }} incl.</span></div>
          <div class="ios-group ios-group--icons">
            @for (row of group.rows; track row.key) { <app-cost-row [cost]="row.cost!" layout="inset" columns="ledger" /> }
          </div>
        </section>
      } @empty {
        <div class="ios-empty"><span class="ios-empty__icon"><app-icon name="receipt" [size]="26" /></span>
          <p class="ios-empty__title">{{ state.costs().length ? 'Geen kosten in deze periode' : 'Nog geen kosten geboekt' }}</p>
          <p class="ios-empty__text">{{ state.costs().length ? 'Kies een andere periode of pas de filters aan.' : 'Boek de beurs, de boekhouder of de huur met +.' }}</p></div>
      }
      @if (filtersOpen()) {
        <app-sheet variant="ios" title="Filter" (closed)="filtersOpen.set(false)">
          <div body class="fin-sheet"><app-finance-filter-fields kind="costs" /></div>
          <div foot style="display:contents"><button class="btn btn--primary" type="button" (click)="filtersOpen.set(false)">Klaar</button></div>
        </app-sheet>
      }
      @if (rangeOpen()) {
        <app-sheet variant="ios" title="Eigen periode" (closed)="rangeOpen.set(false)">
          <div body class="fin-sheet">
            <div class="fin-group ios-group">
              <label class="fin-field"><span>Van</span><app-date-field fieldId="cost-range-from" [value]="rangeFrom()" (valueChange)="rangeFrom.set($event)" /></label>
              <label class="fin-field"><span>Tot en met</span><app-date-field fieldId="cost-range-to" [value]="rangeTo()" (valueChange)="rangeTo.set($event)" /></label>
            </div>
          </div>
          <div foot style="display:contents"><button class="btn btn--primary" type="button" [disabled]="!!rangeFrom() && !!rangeTo() && rangeFrom() > rangeTo()" (click)="applyRange()">Toepassen</button></div>
        </app-sheet>
      }
    }
  `,
})
export class CostList implements FinanceSectionApi {
  readonly state = inject(FinanceState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly sort = signal<{ key: SortKey; direction: SortDirection }>({ key: 'date', direction: 'desc' });
  readonly filtersOpen = signal(false);
  readonly rangeOpen = signal(false);
  readonly rangeFrom = signal('');
  readonly rangeTo = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  /** The company costs of the period and filters on the address. */
  readonly rows = computed<CostLedgerRow[]>(() => {
    const location = this.state.location();
    const range = this.state.rangeOf(location);
    return filterCostLedger(this.state.ledger(), {
      from: range.from || null, to: range.to || null, query: location.q, category: location.cat,
      status: location.status || 'all', source: 'company', docs: location.docs || null, documentedIds: this.state.documentedIds(),
    }, this.state.categoryName, channelLabel).filter((row) => !location.channel || (row.cost?.salesChannel ?? '').toUpperCase() === location.channel);
  });
  readonly costs = computed(() => this.rows().map((row) => row.cost!));
  readonly summary = computed(() => costSummary(this.costs()));
  readonly sorted = computed(() => {
    const sort = this.sort();
    if (sort.key === 'date') return sortRows(this.rows(), (row) => row.date, sort.direction);
    return sortRows(this.rows(), (row) => {
      const cost = row.cost!;
      return sort.key === 'description' ? cost.description : sort.key === 'category' ? this.state.categoryName(cost.category)
        : sort.key === 'excl' ? cost.amountExclEur : inclOf(cost);
    }, sort.direction);
  });
  /** Month groups while sorted by date; one plain list otherwise. */
  readonly groups = computed(() => (this.sort().key === 'date' ? this.byMonth(this.sorted()) : [{ ...this.totalsOf(this.sorted()), key: 'all', label: '', rows: this.sorted() }]));
  readonly monthGroups = computed(() => this.byMonth(sortRows(this.rows(), (row) => row.date, 'desc')));
  readonly keys = computed(() => this.sorted().map((row) => row.key));
  readonly filterCount = computed(() => {
    const location = this.state.location();
    return Number(!!location.cat) + Number(!!location.status) + Number(!!location.channel) + Number(!!location.docs);
  });
  readonly phonePeriods = computed<{ id: FinancePeriod; label: string }[]>(() => [
    { id: 'month', label: 'Deze maand' }, { id: 'quarter', label: 'Kwartaal' }, { id: 'year', label: 'Dit jaar' },
    { id: 'lastYear', label: String(Number(this.state.today().slice(0, 4)) - 1) }, { id: 'all', label: 'Alles' },
  ]);

  readonly table = new FinanceTable({
    order: () => this.keys(),
    host: () => this.host.nativeElement,
    inspect: (key) => this.state.inspectItem({ kind: 'cost', id: Number(key.slice(5)) }),
  });
  readonly selectedCosts = computed<CompanyCost[]>(() => this.rows().filter((row) => this.table.isSelected(row.key)).map((row) => row.cost!));
  readonly selecting = computed(() => this.selectedCosts().length >= 2 || (this.table.ticked() && this.selectedCosts().length > 0));
  readonly allChecked = computed(() => this.keys().length > 0 && this.keys().every((key) => this.table.isSelected(key)));
  readonly someChecked = computed(() => !this.allChecked() && this.keys().some((key) => this.table.isSelected(key)));

  readonly strip = computed<StripItem[]>(() => {
    const summary = this.summary();
    return [
      { label: 'Excl. btw', value: formatEuro(summary.exclEur), tone: 'strong' },
      { label: 'Btw', value: formatEuro(summary.vatEur) },
      { label: 'Incl. btw', value: formatEuro(summary.inclEur) },
      { label: `Open (${summary.unpaidCount})`, value: formatEuro(summary.unpaidEur), tone: summary.unpaidCount ? 'warn' : 'muted' },
    ];
  });
  readonly status = computed(() => `${this.rows().length} ${this.rows().length === 1 ? 'kost' : 'kosten'}`);

  constructor() {
    inject(DestroyRef).onDestroy(() => { if (this.searchTimer) clearTimeout(this.searchTimer); });
    effect(() => { this.keys(); untracked(() => this.table.prune()); });
    /* A cost opened from elsewhere (?cost=<id>) is selected and scrolled to. */
    effect(() => {
      const id = this.state.location().cost;
      const present = this.rows().some((row) => row.cost?.id === id);
      if (!id || !present) return;
      untracked(() => {
        const key = `cost:${id}`;
        if (this.table.selection().focus === key) return;
        this.table.selection.set(selectOne(key));
        setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>(`[data-key="${key}"]`)?.scrollIntoView({ block: 'nearest' }));
      });
    });
  }

  handle(command: FinanceCommand): boolean {
    if (this.table.handle(command)) return true;
    const focus = this.rows().find((row) => row.key === this.table.selection().focus)?.cost ?? null;
    const costs = this.selectedCosts().length ? this.selectedCosts() : focus ? [focus] : [];
    switch (command) {
      case 'open': if (!focus) return false; this.state.inspectItem({ kind: 'cost', id: focus.id! }); return true;
      case 'edit': if (!focus) return false; this.state.openCost(focus); return true;
      case 'pay': if (!costs.length) return false; this.state.openPay(costs); return true;
      case 'delete': if (!costs.length) return false; this.state.deleteCosts(costs); return true;
      default: return false;
    }
  }

  clearSelection(): void {
    this.table.clear();
  }

  exportCsv(): void {
    const range = this.state.rangeOf();
    this.state.exportCsv(this.rows(), `kosten-${range.from || 'alles'}${range.to ? '-tot-' + range.to : ''}.csv`);
  }

  sortBy(key: SortKey): void {
    const current = this.sort();
    this.sort.set(current.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: key === 'excl' || key === 'incl' || key === 'date' ? 'desc' : 'asc' });
  }

  ariaSort(key: SortKey): string | null {
    const sort = this.sort();
    return sort.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : null;
  }

  search(value: string): void {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => { this.searchTimer = null; this.state.go({ q: value }); }, 400);
  }

  reset(): void {
    this.state.go({ period: 'year', from: '', to: '', q: '', cat: '', status: '', channel: '', docs: '', cost: null });
  }

  periodMenu(event: MouseEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const current = this.state.location().period;
    this.state.openMenu({ title: 'Periode', anchor: { x: rect.left, y: rect.bottom + 6 },
      items: this.phonePeriods().map((option) => ({ id: option.id, label: option.id === 'quarter' ? 'Dit kwartaal' : option.label, checked: current === option.id })),
      pick: (id) => this.state.go({ period: id as FinancePeriod }) });
  }

  openRange(): void {
    const range = this.state.rangeOf();
    this.rangeFrom.set(range.from);
    this.rangeTo.set(range.to);
    this.rangeOpen.set(true);
  }

  applyRange(): void {
    this.rangeOpen.set(false);
    this.state.go({ from: this.rangeFrom(), to: this.rangeTo() });
  }

  private byMonth(rows: readonly CostLedgerRow[]) {
    const groups = new Map<string, CostLedgerRow[]>();
    for (const row of rows) groups.set(row.date.slice(0, 7), [...(groups.get(row.date.slice(0, 7)) ?? []), row]);
    return [...groups.entries()].map(([month, list]) => ({ ...this.totalsOf(list), key: month, label: capitalise(monthLabel(month)), rows: list }));
  }

  private totalsOf(rows: readonly CostLedgerRow[]): { exclEur: number; vatEur: number; inclEur: number } {
    const sum = (value: (cost: CompanyCost) => number): number => Math.round(rows.reduce((total, row) => total + value(row.cost!) * 100, 0)) / 100;
    return { exclEur: sum((cost) => cost.amountExclEur || 0), vatEur: sum(vatOf), inclEur: sum(inclOf) };
  }
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
