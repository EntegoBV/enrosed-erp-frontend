import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { IncomingPaymentRow } from '../../core/api/models';
import type { MenuPoint } from '../../shared/context-menu-position';
import { Icon } from '../../shared/icon';
import { MenuTrigger } from '../../shared/menu-trigger';
import { EurPipe } from '../../shared/pipes';
import { bankAccountKey } from './bank-reconciliation';
import { clockOf, dayHeading, signedEur } from './finance-format';
import type { FinanceCommand } from './finance-shortcuts';
import { FinanceState } from './finance-state';
import { FinanceTable } from './finance-table';
import { NO_ACCOUNT } from './finance-url';
import { incomingMoneyTotals, incomingPurposeLabel, paymentLocalDay, paymentMomentLabel, uniqueIncomingPayments } from './incoming-money';
import { FinanceFilterFields } from './finance-filter-fields';
import { Sheet } from '../../shared/ui';

/**
 * Te ontvangen › Ontvangen: the receipts and refunds recorded on sales and
 * partner invoices. Period, kind, purpose and account come from the address.
 * On a desk a grid like the others: a click selects, Enter or a double click
 * opens the invoice, the menu (right-click or ⋯) also offers the container of
 * a partner receipt. A receipt linked to a bank line counts on that line's
 * account.
 */
@Component({
  selector: 'app-incoming-payment-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, Icon, EurPipe, Sheet, FinanceFilterFields, MenuTrigger],
  template: `
    @if (state.desk()) {
      @if (filtered().length) {
        <div class="wk-table fin-table fin-table--receipts" role="grid" aria-label="Ontvangen">
          <div class="wk-thead" role="row">
            <span class="wk-th" role="columnheader">Moment</span>
            <span class="wk-th" role="columnheader">Factuur · klant</span>
            <span class="wk-th" role="columnheader" data-hide="xs">Waarvoor</span>
            <span class="wk-th" role="columnheader" data-hide="sm">Rekening</span>
            <span class="wk-th wk-th--num" role="columnheader">Bedrag</span>
            <span class="wk-th" role="columnheader"><span class="fin-sr">Acties</span></span>
          </div>
          @for (row of visible(); track row.id) {
            <div class="wk-tr wk-tr--link" role="row" [attr.tabindex]="table.stop() === key(row) ? 0 : -1" [attr.data-key]="key(row)" [attr.aria-selected]="table.isSelected(key(row))"
                 (focus)="table.focused(key(row))" (click)="table.click(key(row), $event)" (dblclick)="state.openInvoice(row.salesOrderId)"
                 appMenuTrigger (menuTrigger)="rowMenu(row, $event)">
              <span class="wk-td" role="gridcell">{{ moment(row) }}</span>
              <span class="wk-td" role="gridcell"><a class="wk-link" tabindex="-1" [routerLink]="['/sales', row.salesOrderId]" (click)="$event.stopPropagation()">{{ row.orderNumber }}</a>{{ customer(row) ? ' · ' + customer(row) : '' }}@if (row.reference) { <span class="wk-td__sub">{{ row.reference }}</span> }</span>
              <span class="wk-td" role="gridcell" data-hide="xs"><span class="wk-pill" [class.tone-plum]="row.purpose !== 'STANDARD'" [attr.title]="row.purpose === 'PARTNER_ADVANCE' ? 'Een partnervoorschot is financiering, geen omzet.' : null">{{ purpose(row) }}</span></span>
              <span class="wk-td" role="gridcell" data-hide="sm">@if (account(row); as name) { {{ name }} } @else { <span class="wk-pill tone-warn" title="Telt niet mee in je banksaldo">geen rekening</span> }</span>
              <span class="wk-td wk-td--num" role="gridcell"><b [class.wk-amount--in]="row.amountEur > 0">{{ signed(row.amountEur) }}</b></span>
              <span class="wk-td fin-td-end" role="gridcell">
                <button class="wk-btn wk-btn--ghost wk-btn--icon wk-btn--sm" type="button" tabindex="-1" aria-label="Acties" (click)="$event.stopPropagation(); rowMenu(row, point($event))"><app-icon name="more" [size]="16" /></button>
              </span>
            </div>
          }
        </div>
        @if (visible().length < filtered().length) {
          <div class="fin-more"><button class="wk-btn" type="button" (click)="limit.update(more)">Meer tonen · nog {{ filtered().length - visible().length }}</button></div>
        }
      } @else {
        <div class="wk-empty"><span class="wk-empty__icon"><app-icon name="arrow-in" [size]="22" /></span>
          <p class="wk-empty__title">Niets ontvangen in deze periode</p><p class="wk-empty__text">Kies een andere periode of pas de filters aan.</p></div>
      }
    } @else {
      <div class="ios-chips" role="group" aria-label="Periode">
        @for (option of periods; track option.id) {
          <button class="ios-chip" type="button" [attr.aria-pressed]="state.location().period === option.id" (click)="state.go({ period: option.id })">{{ option.label }}</button>
        }
        <button class="ios-chip" type="button" [attr.aria-pressed]="filterCount() > 0" (click)="filtersOpen.set(true)"><app-icon name="filter" [size]="16" />Filter
          @if (filterCount()) { <span class="ios-chip__badge">{{ filterCount() }}</span> }</button>
      </div>
      <div class="ios-figures ios-figures--3">
        <div><small>Ontvangen</small><strong [attr.title]="totals().grossReceivedEur | eur">{{ totals().grossReceivedEur | eur: 0 }}</strong></div>
        <div><small>Terug</small><strong [attr.title]="totals().refundedEur | eur">{{ totals().refundedEur | eur: 0 }}</strong></div>
        <div><small>Netto</small><strong [attr.title]="totals().receivedEur | eur">{{ totals().receivedEur | eur: 0 }}</strong></div>
      </div>
      @for (day of days(); track day.day) {
        <section class="ios-section">
          <div class="ios-section__head"><h2>{{ day.label }}</h2><span class="ios-section__trail">{{ day.totalEur | eur }}</span></div>
          <div class="ios-group">
            @for (row of day.rows; track row.id) {
              <button class="ios-cell" type="button" (click)="rowMenu(row, null)">
                <span class="ios-cell__body"><span class="ios-cell__title">{{ row.orderNumber }}{{ customer(row) ? ' · ' + customer(row) : '' }}</span>
                  <span class="ios-cell__sub">{{ clock(row) }} · @if (account(row); as name) { {{ name }} } @else { <span class="fin-warn-text">geen rekening</span> }</span></span>
                <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong" [class.wk-amount--in]="row.amountEur > 0">{{ signed(row.amountEur) }}</span></span>
              </button>
            }
          </div>
        </section>
      } @empty {
        <div class="ios-empty"><span class="ios-empty__icon"><app-icon name="arrow-in" [size]="26" /></span><p class="ios-empty__title">Niets ontvangen</p><p class="ios-empty__text">Niet in deze periode, of niet met deze filters.</p></div>
      }
      @if (!expanded() && filtered().length > 12) {
        <div class="ios-group fin-ios-more"><button class="ios-cell ios-cell--action" type="button" (click)="expanded.set(true)">Alle {{ filtered().length }} tonen</button></div>
      }
      @if (filtersOpen()) {
        <app-sheet variant="ios" title="Filter" (closed)="filtersOpen.set(false)">
          <div body class="fin-sheet"><app-finance-filter-fields kind="receipts" /></div>
          <div foot style="display:contents"><button class="btn btn--primary" type="button" (click)="filtersOpen.set(false)">Klaar</button></div>
        </app-sheet>
      }
    }
  `,
})
export class IncomingPaymentList {
  readonly state = inject(FinanceState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly periods = [{ id: 'month', label: 'Maand' }, { id: 'quarter', label: 'Kwartaal' }, { id: 'year', label: 'Jaar' }, { id: 'all', label: 'Alles' }] as const;
  readonly limit = signal(100);
  readonly more = (count: number): number => count + 100;
  readonly expanded = signal(false);
  readonly filtersOpen = signal(false);

  /** Unique by id, zero amounts dropped, newest first. */
  readonly rows = computed(() => uniqueIncomingPayments(this.state.incomingPayments()) as IncomingPaymentRow[]);
  readonly filtered = computed(() => {
    const location = this.state.location();
    const range = this.state.rangeOf(location);
    const needle = location.q.trim().toLocaleLowerCase('nl-BE');
    return this.rows().filter((row) => {
      const day = paymentLocalDay(row);
      const key = this.state.receiptAccountKey(row);
      return (!range.from || day >= range.from) && (!range.to || day <= range.to)
        && (!location.dir || (location.dir === 'in' ? row.amountEur > 0 : row.amountEur < 0))
        && (!location.purpose || row.purpose === location.purpose)
        && (!location.account || (location.account === NO_ACCOUNT ? !key : key === bankAccountKey(location.account)))
        && (!needle || [row.orderNumber, row.reference, this.customer(row), row.bankAccount].join(' ').toLocaleLowerCase('nl-BE').includes(needle));
    });
  });
  readonly totals = computed(() => incomingMoneyTotals(this.filtered()));
  readonly visible = computed(() => this.filtered().slice(0, this.limit()));

  readonly table = new FinanceTable({
    order: () => this.visible().map((row) => this.key(row)),
    host: () => this.host.nativeElement,
    /* A receipt has no inspector of its own; Enter opens its invoice. */
    inspect: () => undefined,
  });

  constructor() {
    effect(() => { this.visible(); untracked(() => this.table.prune()); });
  }

  /** The desk keyboard: the arrows move, Enter or E opens the invoice. */
  handle(command: FinanceCommand): boolean {
    if (this.table.handle(command)) return true;
    const focus = this.visible().find((row) => this.key(row) === this.table.selection().focus);
    if ((command === 'open' || command === 'edit') && focus) {
      this.state.openInvoice(focus.salesOrderId);
      return true;
    }
    return false;
  }

  key(row: IncomingPaymentRow): string {
    return `receipt:${row.id}`;
  }

  point(event: MouseEvent): MenuPoint {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: rect.left, y: rect.bottom + 6 };
  }
  readonly filterCount = computed(() => {
    const location = this.state.location();
    return Number(!!location.dir) + Number(!!location.purpose) + Number(!!location.account);
  });
  readonly days = computed(() => {
    const rows = this.expanded() ? this.filtered() : this.filtered().slice(0, 12);
    const groups = new Map<string, IncomingPaymentRow[]>();
    for (const row of rows) {
      const day = paymentLocalDay(row);
      groups.set(day, [...(groups.get(day) ?? []), row]);
    }
    return [...groups.entries()].map(([day, list]) => ({
      day, label: dayHeading(day, this.state.today()), rows: list,
      totalEur: Math.round(list.reduce((sum, row) => sum + row.amountEur * 100, 0)) / 100,
    }));
  });

  customer(row: IncomingPaymentRow): string {
    return row.customerId == null ? '' : this.state.customerNames().get(row.customerId) ?? '';
  }

  account(row: IncomingPaymentRow): string {
    return this.state.accountLabel(this.state.receiptAccountKey(row));
  }

  purpose(row: IncomingPaymentRow): string {
    return incomingPurposeLabel(row.purpose);
  }

  moment(row: IncomingPaymentRow): string {
    return paymentMomentLabel(row);
  }

  clock(row: IncomingPaymentRow): string {
    return clockOf(row.receivedAt, row.timeZone);
  }

  signed(amount: number): string {
    return signedEur(amount);
  }

  /** Right-click or ⋯ on a desk, a tap on a phone: the invoice, and the container of a partner receipt. */
  rowMenu(row: IncomingPaymentRow, anchor: MenuPoint | null): void {
    this.state.openMenu({
      title: `${row.orderNumber} · ${signedEur(row.amountEur)}`, anchor, cancelLabel: anchor ? '' : 'Annuleren',
      items: [
        { id: 'invoice', label: 'Factuur openen', iconName: 'document' },
        ...(row.purchaseOrderId ? [{ id: 'container', label: 'Container openen', iconName: 'truck' }] : []),
      ],
      pick: (id) => (id === 'container' ? this.state.openPartnerContainer(row.purchaseOrderId!) : this.state.openInvoice(row.salesOrderId)),
    });
  }
}
