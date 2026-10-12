import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { CompanyCost, CostPayment } from '../../core/api/models';
import { Icon } from '../../shared/icon';
import { EurPipe } from '../../shared/pipes';
import { bankAccountKey } from './bank-reconciliation';
import { dayMonthYear } from './finance-format';
import { cashTotalOf, openOf, paidOf } from './finance-metrics';
import { FinanceState, formatEuro } from './finance-state';

/** One payment as the list shows it; `payment` is null for the one full payment of a legacy paid cost without rows. */
interface PaymentRow {
  key: string;
  payment: CostPayment | null;
  paidOn: string;
  amountEur: number;
  /** The account label of the bank line, else the account name the payment was noted with. */
  account: string;
  banked: boolean;
}

/**
 * The payments on a cost (the KBC invoice paid in several transfers): one
 * row per payment with its day, amount, account and whether the bank holds
 * it, a menu to note it on the bank or take it off, and what is still open.
 * The buttons that add a payment or reopen the cost sit in the inspector's
 * foot; this section only lists.
 */
@Component({
  selector: 'app-cost-payments-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  imports: [Icon, EurPipe],
  template: `
    <section class="wk-section">
      <h3 class="wk-section__title">Betalingen <span>{{ summary() }}</span></h3>
      @if (rows().length) {
        <ul class="fin-payments">
          @for (row of rows(); track row.key) {
            <li class="fin-payment">
              <span>{{ day(row.paidOn) }}</span>
              <b>{{ row.amountEur | eur }}</b>
              <span>
                @if (row.banked) { {{ row.account }} }
                @else { @if (row.account) { {{ row.account }} · } <span class="wk-amount--warn">nog niet op de bank</span> }
              </span>
              <span class="fin-payment__bank" [class.is-off]="!row.banked" [attr.title]="row.banked ? 'Op de bank genoteerd' : 'Nog niet op de bank'"><app-icon name="bank" [size]="15" /></span>
              <button class="fin-payment__menu" type="button" [attr.aria-label]="'Acties voor de betaling van ' + day(row.paidOn)" [disabled]="state.saving()" (click)="menu(row, $event)"><app-icon name="more" [size]="16" /></button>
            </li>
          }
        </ul>
        @if (overpaid() > 0) { <p class="fin-overpaid">Te veel betaald · {{ overpaid() | eur }}</p> }
      } @else {
        <p class="fin-payments__empty">Nog geen betaling</p>
      }
    </section>
  `,
})
export class CostPaymentsSection {
  readonly state = inject(FinanceState);
  readonly cost = input.required<CompanyCost>();

  readonly rows = computed<PaymentRow[]>(() => {
    const cost = this.cost();
    const banked = this.state.bankedLines();
    const lines = new Map(this.state.bankStatements().map((line) => [line.id, line]));
    const payments = [...(cost.payments ?? [])].sort((left, right) => left.paidOn.localeCompare(right.paidOn) || (left.id ?? 0) - (right.id ?? 0));
    if (payments.length) {
      return payments.map((payment) => {
        const line = (payment.bankStatementLineId != null ? lines.get(payment.bankStatementLineId) : undefined)
          ?? (payment.id ? banked.get(`kostbetaling#${payment.id}`) : undefined);
        return { key: `p${payment.id ?? payment.paidOn}`, payment, paidOn: payment.paidOn, amountEur: payment.amountEur,
          account: line ? this.state.accountLabel(bankAccountKey(line.account)) : payment.account ?? '', banked: !!line };
      });
    }
    /* A cost paid before payments existed: its date is the one full payment. */
    if (!cost.paidOn) return [];
    const line = cost.id ? banked.get(`kost#${cost.id}`) : undefined;
    return [{ key: 'legacy', payment: null, paidOn: cost.paidOn, amountEur: cashTotalOf(cost),
      account: line ? this.state.accountLabel(bankAccountKey(line.account)) : '', banked: !!line }];
  });
  readonly overpaid = computed(() => Math.max(0, Math.round((paidOf(this.cost()) - cashTotalOf(this.cost())) * 100)) / 100);
  readonly summary = computed(() => {
    const cost = this.cost();
    const n = this.rows().length;
    if (!n) return `nog ${formatEuro(openOf(cost))} open`;
    const count = `${n} ${n === 1 ? 'betaling' : 'betalingen'}`;
    const open = openOf(cost);
    if (open > 0) return `${count} · ${formatEuro(paidOf(cost))} betaald · nog ${formatEuro(open)}`;
    return `${count} · ${this.overpaid() > 0 ? `te veel betaald ${formatEuro(this.overpaid())}` : 'volledig betaald'}`;
  });

  day(date: string | null): string { return dayMonthYear(date); }

  /** ⋯ on a row: onto the bank when the bank does not hold it yet; off the cost (the bank line stays). A legacy payment goes through 'Weer open zetten'. */
  menu(row: PaymentRow, event: MouseEvent): void {
    const cost = this.cost();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const anchor = this.state.desk() ? { x: rect.left, y: rect.bottom + 6 } : null;
    const items = [
      ...(!row.banked ? [{ id: 'bank', label: 'Op de bank noteren', iconName: 'bank' }] : []),
      ...(row.payment ? [{ id: 'delete', label: 'Verwijderen', iconName: 'trash', danger: true, divider: !row.banked }] : []),
    ];
    if (!items.length) return;
    this.state.openMenu({ title: `${this.day(row.paidOn)} · ${formatEuro(row.amountEur)}`, items, anchor, cancelLabel: anchor ? '' : 'Annuleren', pick: (id) => {
      if (id === 'bank') this.state.openMovement(this.state.costMovement(cost, row.payment));
      else if (id === 'delete' && row.payment) void this.state.deletePayment(cost, row.payment);
    } });
  }
}
