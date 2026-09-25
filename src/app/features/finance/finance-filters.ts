import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal } from '@angular/core';
import { ContextMenuItem } from '../../shared/context-menu';
import { DateField } from '../../shared/date-field';
import { Icon } from '../../shared/icon';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { FinanceFilterFields } from './finance-filter-fields';
import { dayMonthYear } from './finance-format';
import { FinanceState } from './finance-state';
import { FinancePeriod } from './finance-url';

/**
 * The filters of the section on screen, on the right of the desk strip:
 * period, kind chips, the account, and 'Filter (n)' as a popover. They read
 * and write the address only, so a reload or Back keeps them.
 */
@Component({
  selector: 'app-finance-filters',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:pointerdown)': 'outside($event)', '(document:keydown.escape)': 'popover.set(null)' },
  imports: [NgTemplateOutlet, Icon, Segmented, DateField, FinanceFilterFields],
  template: `
    @let location = state.location();
    @switch (location.view + '/' + location.tab) {
      @case ('incoming/open') {
        <div class="wk-chips" role="group" aria-label="Soort">
          <button class="wk-chip" type="button" [attr.aria-pressed]="!location.kind" (click)="state.go({ kind: '' })">Alle</button>
          <button class="wk-chip" type="button" [attr.aria-pressed]="location.kind === 'customer'" (click)="state.go({ kind: 'customer' })">Klanten</button>
          <button class="wk-chip" type="button" [attr.aria-pressed]="location.kind === 'partner'" (click)="state.go({ kind: 'partner' })">Partners</button>
        </div>
      }
      @case ('incoming/received') {
        <app-segmented label="Periode" [options]="receivedPeriods" [value]="location.period === 'custom' ? '' : location.period" (changed)="state.go({ period: $any($event) })" />
        <ng-container *ngTemplateOutlet="range; context: { custom: true }" />
        <ng-container *ngTemplateOutlet="filter; context: { kind: 'receipts' }" />
      }
      @case ('bank/movements') {
        <app-segmented label="Richting" [options]="movementOptions()" [value]="movementValue()" (changed)="pickMovement($event)" />
        <button class="wk-btn wk-btn--sm" type="button" (click)="accountMenu($event)">{{ location.account ? state.accountLabel(location.account) : 'Alle rekeningen' }} <app-icon name="chevron-down" [size]="14" /></button>
        <ng-container *ngTemplateOutlet="range" />
      }
      @case ('costs/company') {
        <ng-container *ngTemplateOutlet="range" />
        <ng-container *ngTemplateOutlet="filter; context: { kind: 'costs' }" />
        @if (costsChanged()) { <button class="wk-link" type="button" (click)="resetCosts()">Filters wissen</button> }
      }
      @case ('costs/containers') {
        @if (location.container) {
          <span class="wk-chip is-on">{{ containerName() }}<button class="wk-chip__x" type="button" aria-label="Filter op container wissen" (click)="state.go({ container: null })"><app-icon name="close" [size]="11" /></button></span>
        }
        <div class="wk-chips" role="group" aria-label="Welke containers">
          <button class="wk-chip" type="button" [attr.aria-pressed]="!location.scope" (click)="state.go({ scope: '' })">Lopend</button>
          <button class="wk-chip" type="button" [attr.aria-pressed]="location.scope === 'all'" (click)="state.go({ scope: 'all' })">Alles</button>
        </div>
      }
      @case ('analysis/') {
        <app-segmented label="Jaar" [options]="yearOptions()" [value]="location.year" (changed)="state.go({ year: $event })" />
        @if (otherYears().length) { <button class="wk-btn wk-btn--sm" type="button" (click)="yearMenu($event)">Ander jaar <app-icon name="chevron-down" [size]="14" /></button> }
      }
    }

    <ng-template #range let-custom="custom">
      <span class="wk-popover-anchor">
        @if (custom) {
          <button class="wk-btn wk-btn--sm" type="button" [class.is-on]="location.period === 'custom'" (click)="openRange()"><app-icon name="calendar" [size]="14" />{{ location.period === 'custom' ? periodLabel() : 'Eigen periode…' }}</button>
        } @else {
          <button class="wk-btn wk-btn--sm" type="button" (click)="periodMenu($event)"><app-icon name="calendar" [size]="14" />{{ periodLabel() }} <app-icon name="chevron-down" [size]="14" /></button>
        }
        @if (popover() === 'range') {
          <div class="wk-popover fin-range" data-kit-overlay role="dialog" aria-label="Eigen periode">
            <label class="fin-field"><span>Van</span><app-date-field fieldId="fin-range-from" [value]="rangeFrom()" (valueChange)="rangeFrom.set($event)" /></label>
            <label class="fin-field"><span>Tot en met</span><app-date-field fieldId="fin-range-to" [value]="rangeTo()" (valueChange)="rangeTo.set($event)" /></label>
            <div class="wk-popover__foot">
              <button class="wk-btn wk-btn--sm" type="button" (click)="popover.set(null)">Annuleren</button>
              <button class="wk-btn wk-btn--sm wk-btn--primary" type="button" [disabled]="!!rangeFrom() && !!rangeTo() && rangeFrom() > rangeTo()" (click)="applyRange()">Toepassen</button>
            </div>
          </div>
        }
      </span>
    </ng-template>
    <ng-template #filter let-kind="kind">
      <span class="wk-popover-anchor">
        <button class="wk-btn wk-btn--sm" type="button" [attr.aria-expanded]="popover() === 'filter'" (click)="toggle('filter')"><app-icon name="filter" [size]="14" />Filter{{ filterCount() ? ' (' + filterCount() + ')' : '' }}</button>
        @if (popover() === 'filter') {
          <div class="wk-popover fin-filter-pop" data-kit-overlay role="dialog" aria-label="Filter"><app-finance-filter-fields [kind]="kind" /></div>
        }
      </span>
    </ng-template>
  `,
})
export class FinanceFilters {
  readonly state = inject(FinanceState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly popover = signal<'filter' | 'range' | null>(null);
  readonly rangeFrom = signal('');
  readonly rangeTo = signal('');

  readonly receivedPeriods: SegmentOption[] = [
    { id: 'month', label: 'Deze maand', shortLabel: 'Maand' }, { id: 'quarter', label: 'Dit kwartaal', shortLabel: 'Kwartaal' },
    { id: 'year', label: 'Dit jaar', shortLabel: 'Jaar' }, { id: 'all', label: 'Alles' },
  ];

  readonly movementOptions = computed<SegmentOption[]>(() => {
    const unlinked = this.state.bankStatements().filter((line) => line.amountEur > 0 && line.salesPaymentId === null).length;
    return [{ id: '', label: 'Alles' }, { id: 'in', label: 'Binnen' }, { id: 'out', label: 'Buiten' },
      { id: 'unlinked', label: 'Te koppelen', count: unlinked || null, dot: unlinked ? 'warn' : null }];
  });
  readonly movementValue = computed(() => {
    const location = this.state.location();
    return location.link === 'unlinked' ? 'unlinked' : location.dir;
  });

  readonly thisYear = computed(() => Number(this.state.today().slice(0, 4)));
  readonly otherYears = computed(() => {
    const years = new Set<number>();
    for (const row of this.state.ledger()) {
      const year = Number(row.date.slice(0, 4));
      if (year && year < this.thisYear() - 1) years.add(year);
    }
    return [...years].sort((a, b) => b - a);
  });
  readonly yearOptions = computed<SegmentOption[]>(() => {
    const year = this.state.location().year;
    const options: SegmentOption[] = [{ id: '', label: 'Dit jaar' }, { id: String(this.thisYear() - 1), label: 'Vorig jaar' }, { id: 'all', label: 'Alles' }];
    if (year && !options.some((option) => option.id === year)) options.push({ id: year, label: year });
    return options;
  });

  readonly periodLabel = computed(() => {
    const location = this.state.location();
    if (location.period === 'custom') return `${location.from ? dayMonthYear(location.from) : '…'} – ${location.to ? dayMonthYear(location.to) : '…'}`;
    return this.periodName(location.period || 'all');
  });

  readonly filterCount = computed(() => {
    const location = this.state.location();
    return location.view === 'costs'
      ? Number(!!location.cat) + Number(!!location.status) + Number(!!location.channel) + Number(!!location.docs)
      : Number(!!location.dir) + Number(!!location.purpose) + Number(!!location.account);
  });

  /** Uitgaven differs from how it opens (this year, no search, no filters). */
  readonly costsChanged = computed(() => {
    const location = this.state.location();
    return location.period !== 'year' || !!location.q || this.filterCount() > 0;
  });

  readonly containerName = computed(() => {
    const id = this.state.location().container;
    const view = this.state.purchaseViews().find((row) => row.order.id === id);
    return view?.order.number ?? this.state.payments().find((row) => row.orderId === id)?.orderNumber ?? `Container #${id}`;
  });

  periodName(period: FinancePeriod | ''): string {
    switch (period) {
      case 'month': return 'Deze maand';
      case 'quarter': return 'Dit kwartaal';
      case 'year': return 'Dit jaar';
      case 'lastYear': return String(this.thisYear() - 1);
      default: return 'Alles';
    }
  }

  toggle(which: 'filter' | 'range'): void {
    this.popover.update((current) => (current === which ? null : which));
  }

  outside(event: PointerEvent): void {
    if (!this.popover()) return;
    const target = event.target;
    if (target instanceof Element && ((target.closest('.wk-popover-anchor') && this.host.nativeElement.contains(target)) || target.closest('.cm, .overlay'))) return;
    this.popover.set(null);
  }

  periodMenu(event: MouseEvent): void {
    const current = this.state.location().period;
    const periods: FinancePeriod[] = this.state.location().view !== 'incoming' ? ['month', 'quarter', 'year', 'lastYear', 'all'] : ['month', 'quarter', 'year', 'all'];
    const items: ContextMenuItem[] = periods.map((id) => ({ id, label: this.periodName(id), checked: current === id }));
    items.push({ id: 'custom', label: 'Eigen periode…', divider: true, checked: current === 'custom' });
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.state.openMenu({ title: 'Periode', items, anchor: { x: rect.left, y: rect.bottom + 6 }, pick: (id) => {
      if (id !== 'custom') this.state.go({ period: id as FinancePeriod });
      else this.openRange();
    } });
  }

  openRange(): void {
    const range = this.state.rangeOf();
    this.rangeFrom.set(range.from);
    this.rangeTo.set(range.to);
    this.popover.set('range');
  }

  applyRange(): void {
    this.popover.set(null);
    this.state.go({ from: this.rangeFrom(), to: this.rangeTo() });
  }

  accountMenu(event: MouseEvent): void {
    const current = this.state.location().account;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.state.openMenu({ title: 'Rekening', anchor: { x: rect.left, y: rect.bottom + 6 },
      items: [{ id: '', label: 'Alle rekeningen', checked: !current }, ...this.state.accountOptions().map((option) => ({ id: option.key, label: option.label, checked: option.key === current }))],
      pick: (id) => this.state.go({ account: id }) });
  }

  yearMenu(event: MouseEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.state.openMenu({ title: 'Jaar', anchor: { x: rect.left, y: rect.bottom + 6 },
      items: this.otherYears().map((year) => ({ id: String(year), label: String(year), checked: this.state.location().year === String(year) })),
      pick: (id) => this.state.go({ year: id }) });
  }

  pickMovement(id: string): void {
    if (id === 'unlinked') this.state.go({ dir: '', link: 'unlinked' });
    else this.state.go({ dir: id as 'in' | 'out' | '', link: '' });
  }

  resetCosts(): void {
    this.state.go({ period: 'year', from: '', to: '', q: '', cat: '', status: '', channel: '', docs: '', cost: null });
  }
}
