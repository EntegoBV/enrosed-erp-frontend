import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, forwardRef, inject, signal, untracked } from '@angular/core';
import { CompanyCost } from '../../core/api/models';
import { Icon } from '../../shared/icon';
import { MenuTrigger } from '../../shared/menu-trigger';
import { EurPipe } from '../../shared/pipes';
import { Skeleton } from '../../shared/skeleton';
import { categoryLabel, categoryTone } from './cost-categories';
import { paymentPayeeLabel } from './cost-ledger';
import { CostRow } from './cost-row';
import { PAYEE_TONES, dayMonth } from './finance-format';
import { FINANCE_SECTION, FinanceSectionApi, StripItem } from './finance-section';
import { SortDirection, sortRows } from './finance-selection';
import type { FinanceCommand } from './finance-shortcuts';
import { FinanceState, formatEuro } from './finance-state';
import { FinanceTable } from './finance-table';
import { PayableBucket, PayableRow, payableSearchTexts, payableTotals } from './payables';
import { containerNumberHint } from '../purchasing/container-name';
import type { MenuPoint } from '../../shared/context-menu-position';
import { containerNumberHint as poHint } from '../purchasing/container-name';

const BUCKETS: readonly { id: PayableBucket; label: string; phone: string }[] = [
  { id: 'now', label: 'Nu te betalen', phone: 'Nu te betalen' },
  { id: 'soon', label: 'Binnenkort · 30 dagen', phone: 'Binnenkort' },
  { id: 'later', label: 'Later', phone: 'Later' },
];
type SortKey = 'date' | 'title' | 'amount';

/**
 * Te betalen: everything still to pay in one list with one 30-day horizon,
 * in three buckets (Nu, Binnenkort, Later): open company costs, open
 * container terms (read-only, expected) and the recurring costs coming up.
 */
@Component({
  selector: 'app-payables-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: FINANCE_SECTION, useExisting: forwardRef(() => PayablesPanel) }],
  imports: [Icon, EurPipe, Skeleton, MenuTrigger, CostRow],
  template: `
    @if (showDueNow()) {
      @if (state.desk()) {
        <div class="wk-banner wk-banner--warn wk-banner--inset" role="status">
          <app-icon name="repeat" [size]="18" />
          <span class="wk-banner__text">{{ dueNowText() }}</span>
          <span class="wk-banner__actions"><button class="wk-btn wk-btn--sm" type="button" [disabled]="state.booking()" (click)="state.bookNow()">{{ state.booking() ? 'Bezig…' : 'Nu boeken' }}</button></span>
        </div>
      } @else {
        <div class="ios-banner"><span>{{ dueNowText() }}</span><button class="ios-capsule ios-capsule--sm ios-capsule--accent" type="button" [disabled]="state.booking()" (click)="state.confirmBookNow()">Boek nu</button></div>
      }
    }

    @if (state.desk()) {
      @if (rows().length) {
        <div class="wk-table fin-table fin-table--payables" role="grid" aria-label="Te betalen" [class.wk-table--selecting]="table.count() > 0">
          <div class="wk-thead" role="row">
            <span class="wk-th" role="columnheader"><input class="wk-check" type="checkbox" aria-label="Alle kosten selecteren" [checked]="allChecked()" [indeterminate]="someChecked()" (change)="table.checkAll(costKeys())" /></span>
            <span class="wk-th" role="columnheader" [attr.aria-sort]="ariaSort('date')"><button class="wk-th__btn" type="button" (click)="sortBy('date')">Wanneer</button></span>
            <span class="wk-th" role="columnheader" [attr.aria-sort]="ariaSort('title')"><button class="wk-th__btn" type="button" (click)="sortBy('title')">Omschrijving</button></span>
            <span class="wk-th" role="columnheader">Ontvanger / categorie</span>
            <span class="wk-th" role="columnheader" data-hide="md"><app-icon name="clip" [size]="13" /></span>
            <span class="wk-th wk-th--num" role="columnheader" [attr.aria-sort]="ariaSort('amount')"><button class="wk-th__btn" type="button" (click)="sortBy('amount')">Bedrag<span data-hide="md">&nbsp;incl. btw</span></button></span>
            <span class="wk-th" role="columnheader"><span class="fin-sr">Actie</span></span>
          </div>
          @for (group of groups(); track group.id) {
            <div class="wk-group" role="row">
              <span class="wk-group__label">{{ group.label }} <span class="wk-group__count">· {{ group.rows.length }}</span></span>
              <span class="wk-td--num fin-group__sum">{{ group.totalEur | eur }}</span>
            </div>
            @for (row of group.rows; track row.key) {
              @switch (row.kind) {
                @case ('cost') {
                  <app-cost-row [cost]="row.cost!" columns="payable" [selected]="table.isSelected(row.key)" [tabStop]="table.stop() === row.key"
                                (focused)="table.focused(row.key)" (select)="table.click(row.key, $event)" (check)="table.check(row.key)" />
                }
                @case ('container') {
                  <!-- A container term opens in the inspector (its foot: "Beheren bij de container ›"); the row stays in Te betalen. -->
                  <div class="wk-tr wk-tr--link" role="row" [attr.tabindex]="table.stop() === row.key ? 0 : -1" [attr.data-key]="row.key" [attr.aria-selected]="table.isSelected(row.key)"
                       (focus)="table.focused(row.key)" (click)="table.click(row.key, $event)" (dblclick)="inspectContainer(row)" appMenuTrigger (menuTrigger)="containerMenu(row, $event)">
                    <span class="wk-td" role="gridcell"></span>
                    <span class="wk-td fin-when" role="gridcell"><b>{{ whenDay(row) }}</b><small>{{ whenWord(row) }}</small></span>
                    <span class="wk-td fin-what" role="gridcell"><app-icon class="tone-blue" name="truck" [size]="16" /><b>{{ row.title }}@if (row.container!.archived) { <span class="wk-pill wk-pill--outline">gearchiveerd</span> }</b>
                      <small>{{ whatSub(row) }}</small></span>
                    <span class="wk-td wk-td--wrap" role="gridcell"><span [class]="'wk-dot tone-' + payeeTone(row)"></span> {{ payee(row) }}</span>
                    <span class="wk-td" role="gridcell" data-hide="md"></span>
                    <span class="wk-td wk-td--num" role="gridcell"><b>{{ row.amountEur | eur }}</b><span class="wk-td__sub">verwacht</span></span>
                    <span class="wk-td wk-td--actions fin-td-chev" role="gridcell"><app-icon name="chevron-right" [size]="16" /></span>
                  </div>
                }
                @case ('recurring') {
                  <div class="wk-tr wk-tr--link" role="row" [attr.tabindex]="table.stop() === row.key ? 0 : -1" [attr.data-key]="row.key" [attr.aria-selected]="table.isSelected(row.key)"
                       (focus)="table.focused(row.key)" (click)="table.click(row.key, $event)" (dblclick)="state.openRecurring(row.upcoming!.definition)"
                       appMenuTrigger (menuTrigger)="state.recurringMenu(row.upcoming!.definition, $event)">
                    <span class="wk-td" role="gridcell"></span>
                    <span class="wk-td" role="gridcell">{{ day(row.date) }}</span>
                    <span class="wk-td fin-what" role="gridcell"><app-icon class="tone-plum" name="repeat" [size]="16" /><b>{{ row.title }}</b>@if (row.party) { <small>{{ row.party }}</small> }</span>
                    <span class="wk-td wk-td--wrap" role="gridcell"><span [class]="'wk-dot tone-' + tone(row.upcoming!.definition.category)"></span> {{ category(row.upcoming!.definition.category) }}
                      @if (row.autoPaid) { <span class="wk-pill wk-pill--outline fin-pill-wrap" title="Domiciliëring: gaat vanzelf">domiciliëring · gaat vanzelf</span> }</span>
                    <span class="wk-td" role="gridcell" data-hide="md"></span>
                    <span class="wk-td wk-td--num" role="gridcell"><b>{{ row.amountEur | eur }}</b></span>
                    <span class="wk-td wk-td--actions" role="gridcell"><button class="wk-btn wk-btn--sm" type="button" tabindex="-1" (click)="$event.stopPropagation(); state.openRecurring(row.upcoming!.definition)">Bewerken</button></span>
                  </div>
                }
              }
            }
          }
        </div>
      }
      @if (containersPending()) { <div class="fin-pending" aria-label="Containers worden geladen"><app-skeleton kind="list" [rows]="2" /></div> }
      @if (!rows().length && !containersPending()) {
        <div class="wk-empty">
          <span class="wk-empty__icon"><app-icon name="tick" [size]="22" /></span>
          <p class="wk-empty__title">{{ state.location().q ? 'Niets gevonden' : 'Niets te betalen' }}</p>
          <p class="wk-empty__text">{{ state.location().q ? 'Pas je zoekterm aan.' : 'Boek nieuwe facturen met Kost boeken.' }}</p>
        </div>
      }
    } @else {
      <div class="ios-headline">
        <div class="ios-headline__label">Nu te betalen</div>
        <div class="ios-headline__value">{{ totals().nowEur | eur }}</div>
        <div class="ios-headline__sub">Binnenkort {{ totals().soonEur | eur }} · Later {{ totals().laterEur | eur }}@if (totals().containerLaterEur || totals().containerSoonEur) { (verwacht)}</div>
      </div>
      @for (group of groups(); track group.id) {
        <section class="ios-section">
          <div class="ios-section__head"><h2>{{ group.phone }}</h2><span class="ios-section__trail">{{ group.totalEur | eur }}</span></div>
          <div class="ios-group ios-group--icons">
            @for (row of group.rows; track row.key) {
              @switch (row.kind) {
                @case ('cost') { <app-cost-row [cost]="row.cost!" layout="inset" columns="payable" /> }
                @case ('container') {
                  <button class="ios-cell ios-cell--tall" type="button" (click)="inspectContainer(row)">
                    <span class="ios-cell__lead"><span class="ios-tile ios-tile--lg ios-tile--soft tone-blue"><app-icon name="truck" [size]="18" /></span></span>
                    <span class="ios-cell__body"><span class="ios-cell__title fin-wrapall">{{ row.title }}</span>
                      <span class="ios-cell__sub fin-wrapall">@if (row.bucket !== 'now' && row.date) { <b class="fin-due">{{ whenDay(row) }}</b> · }{{ phoneSub(row) }}</span></span>
                    <!-- A container amount is an estimate in every bucket: "verwacht" stays under the Nu pill too (as Bedrag on the desk). -->
                    <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">{{ row.amountEur | eur }}</span>
                      @if (row.bucket === 'now') { <span class="wk-pill tone-warn">Nu</span> }<span class="ios-cell__meta">verwacht</span></span>
                    <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
                  </button>
                }
                @case ('recurring') {
                  <button class="ios-cell ios-cell--tall" type="button" (click)="state.openRecurring(row.upcoming!.definition)">
                    <span class="ios-cell__lead"><span class="ios-tile ios-tile--lg ios-tile--soft tone-plum"><app-icon name="calendar" [size]="18" /></span></span>
                    <span class="ios-cell__body"><span class="ios-cell__title">{{ row.title }}</span>
                      <span class="ios-cell__sub">{{ day(row.date) }}{{ row.autoPaid ? ' · domiciliëring' : '' }}</span></span>
                    <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">{{ row.amountEur | eur }}</span></span>
                  </button>
                }
              }
            }
          </div>
        </section>
      }
      @if (containersPending()) { <div class="ios-card"><app-skeleton kind="list" [rows]="2" /></div> }
      @if (!rows().length && !containersPending()) {
        <div class="ios-empty">
          <span class="ios-empty__icon"><app-icon name="tick" [size]="26" /></span>
          <p class="ios-empty__title">Niets te betalen</p>
          <p class="ios-empty__text">Nieuwe facturen boek je met +.</p>
        </div>
      }
    }
  `,
})
export class PayablesPanel implements FinanceSectionApi {
  readonly state = inject(FinanceState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly sort = signal<{ key: SortKey; direction: SortDirection } | null>(null);

  /** The segment and the search narrow the one list. */
  readonly rows = computed(() => {
    const { tab, q } = this.state.location();
    const kind = tab === 'costs' ? 'cost' : tab === 'containers' ? 'container' : tab === 'recurring' ? 'recurring' : null;
    const needle = q.trim().toLocaleLowerCase('nl-BE');
    /* A container is found by its name, its PO number and its alias, whatever the row shows (B9). */
    return this.state.payables().filter((row) => (!kind || row.kind === kind) && (!needle || [...payableSearchTexts(row),
      row.cost ? categoryLabel(row.cost.category) : null, row.container ? paymentPayeeLabel(row.container.payee) : null,
      row.upcoming ? categoryLabel(row.upcoming.definition.category) : null]
      .some((part) => part?.toLocaleLowerCase('nl-BE').includes(needle))));
  });
  readonly totals = computed(() => payableTotals(this.rows()));
  readonly groups = computed(() => {
    const sort = this.sort();
    return BUCKETS.map((bucket) => {
      let rows = this.rows().filter((row) => row.bucket === bucket.id);
      if (sort) rows = sortRows(rows, (row) => sort.key === 'amount' ? row.amountEur : sort.key === 'title' ? row.title : row.date, sort.direction);
      return { ...bucket, rows, totalEur: payableTotals(rows).totalEur };
    }).filter((group) => group.rows.length);
  });
  private readonly order = computed(() => this.groups().flatMap((group) => group.rows.map((row) => row.key)));
  readonly costKeys = computed(() => this.rows().filter((row) => row.kind === 'cost').map((row) => row.key));
  readonly containersPending = computed(() => this.state.containersLoading() && ['all', 'containers'].includes(this.state.location().tab));

  readonly table = new FinanceTable({
    order: () => this.order(),
    host: () => this.host.nativeElement,
    inspect: (key) => {
      const row = this.rows().find((item) => item.key === key);
      if (row?.kind === 'cost' && row.costId) this.state.inspectItem({ kind: 'cost', id: row.costId });
      else if (row?.kind === 'container' && row.orderId) this.state.inspectItem({ kind: 'container', id: row.orderId });
      else if (row?.kind === 'recurring' && row.recurringId) this.state.inspectItem({ kind: 'recurring', id: row.recurringId });
    },
  });

  readonly selectedCosts = computed<CompanyCost[]>(() => this.rows().filter((row) => row.kind === 'cost' && this.table.isSelected(row.key)).map((row) => row.cost!));
  readonly selecting = computed(() => this.selectedCosts().length >= 2 || (this.table.ticked() && this.selectedCosts().length > 0));
  readonly allChecked = computed(() => this.costKeys().length > 0 && this.costKeys().every((key) => this.table.isSelected(key)));
  readonly someChecked = computed(() => !this.allChecked() && this.costKeys().some((key) => this.table.isSelected(key)));
  readonly showDueNow = computed(() => this.state.dueNow().length > 0 && ['all', 'recurring'].includes(this.state.location().tab));
  readonly dueNowText = computed(() => {
    const n = this.state.dueNow().length;
    return `${n} vaste ${n === 1 ? 'kost staat' : 'kosten staan'} klaar om te boeken`;
  });

  readonly strip = computed<StripItem[]>(() => {
    const totals = this.totals();
    return [
      { label: 'Nu', value: formatEuro(totals.nowEur), tone: totals.nowEur > 0 ? 'strong' : undefined },
      { label: totals.containerSoonEur ? 'Binnenkort · 30 dagen (verwacht)' : 'Binnenkort · 30 dagen', value: formatEuro(totals.soonEur) },
      { label: totals.containerLaterEur ? 'Later (verwacht)' : 'Later', value: formatEuro(totals.laterEur), tone: 'muted' },
      { label: 'Totaal', value: formatEuro(totals.totalEur) },
    ];
  });
  readonly status = computed(() => `${this.rows().length} ${this.rows().length === 1 ? 'post' : 'posten'}`);

  constructor() {
    effect(() => { this.order(); untracked(() => this.table.prune()); });
  }

  handle(command: FinanceCommand): boolean {
    if (this.table.handle(command)) return true;
    const focus = this.rows().find((row) => row.key === this.table.selection().focus);
    const costs = this.selectedCosts().length ? this.selectedCosts() : focus?.cost ? [focus.cost] : [];
    switch (command) {
      case 'open':
        if (focus?.kind === 'container') this.inspectContainer(focus);
        else if (focus?.kind === 'recurring') this.state.openRecurring(focus.upcoming!.definition);
        else if (focus?.cost) this.state.inspectItem({ kind: 'cost', id: focus.cost.id! });
        return !!focus;
      case 'edit':
        if (focus?.cost) this.state.openCost(focus.cost);
        else if (focus?.upcoming) this.state.openRecurring(focus.upcoming.definition);
        return !!focus;
      case 'pay': if (!costs.length) return false; this.state.openPay(costs); return true;
      case 'delete': if (!costs.length) return false; this.state.deleteCosts(costs); return true;
      default: return false;
    }
  }

  clearSelection(): void {
    this.table.clear();
  }

  sortBy(key: SortKey): void {
    const current = this.sort();
    this.sort.set(current?.key === key ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: key === 'amount' ? 'desc' : 'asc' });
  }

  ariaSort(key: SortKey): string | null {
    const sort = this.sort();
    return sort?.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : null;
  }

  containerMenu(row: PayableRow, anchor: MenuPoint): void {
    this.state.openMenu({ title: row.title, anchor, items: [{ id: 'open', label: 'Bij de container openen', iconName: 'external' }],
      pick: () => this.state.openContainer(row.orderId!) });
  }

  /** A container term in the inspector (Te betalen stays behind it); "Bij de container openen" in its menu still leaves for the order. */
  inspectContainer(row: PayableRow): void { if (row.orderId) this.state.inspectItem({ kind: 'container', id: row.orderId }); }
  /** Wanneer: "± 22 okt" (no ± for a fixed day), "nu" for a reached term, "± vandaag" for a planned day already past. */
  whenDay(row: PayableRow): string {
    if (row.bucket === 'now' || !row.date) return row.bucket === 'now' ? 'nu' : '—';
    const approx = row.dateCertainty && row.dateCertainty !== 'FIXED' ? '± ' : '';
    return `${approx}${row.plannedDate || row.date === this.state.today() ? 'vandaag' : dayMonth(row.date)}`;
  }
  /** Under the day: when the term falls due ("bij vertrek"), and the planned day once it has passed. */
  whenWord(row: PayableRow): string {
    return [row.dueWord, row.plannedDate ? `gepland ${dayMonth(row.plannedDate)}` : ''].filter(Boolean).join(' · ');
  }
  /** Omschrijving's second line: "PO-2026-013 · 30% bij vertrek" (the payee for a stream without a term), " · Factuur X", " · via leverancier". */
  whatSub(row: PayableRow): string {
    const container = row.container;
    if (!container) return '';
    const hint = poHint(row.title, container.orderNumber);
    return [hint, container.termLabel || this.payee(row), container.invoiceNumber ? 'Factuur ' + container.invoiceNumber : '', container.viaSupplier ? 'via leverancier' : '']
      .filter(Boolean).join(' · ');
  }
  /** The phone sub after the day: the term (with its due word when the label lacks it) or the payee, the invoice, via leverancier, the PO number (N3). */
  phoneSub(row: PayableRow): string {
    const container = row.container;
    if (!container) return '';
    const term = container.termLabel && row.dueWord && !container.termLabel.toLowerCase().includes(row.dueWord) ? `${container.termLabel} · ${row.dueWord}`
      : container.termLabel || [row.bucket === 'now' ? '' : row.dueWord, this.payee(row)].filter(Boolean).join(' · ');
    return [term, container.invoiceNumber ? 'Factuur ' + container.invoiceNumber : '', container.viaSupplier ? 'via leverancier' : '',
      poHint(row.title, container.orderNumber)].filter(Boolean).join(' · ');
  }
  payee(row: PayableRow): string { return row.container ? paymentPayeeLabel(row.container.payee) : ''; }
  /** 'Leverancier · 70% bij vertrek · Factuur CI-2026-118'; the inspection paid via the supplier says so. */
  containerSub(row: PayableRow): string {
    const container = row.container;
    if (!container) return '';
    const hint = containerNumberHint(row.title, container.orderNumber);
    return this.payee(row) + (container.viaSupplier ? ' · via leverancier' : '') + (container.termLabel ? ' · ' + container.termLabel : '')
      + (container.invoiceNumber ? ' · Factuur ' + container.invoiceNumber : '') + (hint ? ' · ' + hint : '');
  }
  payeeTone(row: PayableRow): string { return PAYEE_TONES[row.container?.payee ?? 'OTHER'] ?? 'grey'; }
  day(date: string | null): string { return dayMonth(date); }
  category(code: string): string { return categoryLabel(code); }
  tone(code: string): string { return categoryTone(code); }
}
