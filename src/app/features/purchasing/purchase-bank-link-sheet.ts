import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { BankingApi, type BankPurchasePaymentPart, type BankPurchaseSharePart, type BankStatementLine } from '../../core/api/banking-api';
import { BankAccountsStore } from '../../core/api/bank-accounts';
import { messageOf } from '../../core/api/errors';
import type { PurchaseOrderView, PurchasePaymentRow, Supplier } from '../../core/api/models';
import { SourcingApi } from '../../core/api/sourcing-api';
import { BankTransactionPicker } from '../../shared/bank-transaction-picker';
import { bankTransactionDay } from '../../shared/bank-transaction-options';
import { Icon } from '../../shared/icon';
import { EurPipe } from '../../shared/pipes';
import { Skeleton } from '../../shared/skeleton';
import { Sheet, Ui } from '../../shared/ui';
import { bankTextOf } from '../finance/bank-text';
import { ContainerSplit, type SplitSource } from '../finance/container-split';
import { paymentLocalDay } from '../finance/incoming-money';
import { containerPayables, type ContainerPayable } from '../finance/payables';
import { shareToast } from './purchase-payment-share';

const cents = (value: number): number => Math.round(value * 100);
const normal = (text: string | null | undefined): string => (text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * "Transactie koppelen" from an order's Betalingen (Emre, 2026-11-04: "ik
 * moet betalingen kunnen koppelen en splitsen ook op inkoop order, niet
 * persee altijd via bank en kosten"). Pick the outgoing transaction, then
 * share it over this container's parts (Leverancier per term, Douane &
 * transport, Inspectie, Transactiekosten) and, when the same transfer paid
 * them too, other containers: Kosten & bank's own split (container-split.ts)
 * on this order's data, booked through the same calls (POST
 * …/purchase-payment, or …/purchase-share once an open payment is among the
 * parts). This container starts ticked, on the open payment or term the
 * transaction matches. The host refreshes its payment state on `linked`.
 */
@Component({
  selector: 'app-purchase-bank-link-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, BankTransactionPicker, ContainerSplit, Icon, EurPipe, Skeleton],
  template: `
    <app-sheet title="Transactie koppelen" variant="ios" [wide]="true" (closed)="closed.emit()">
      <div body class="pbl">
        @if (line(); as row) {
          <div class="pbl__line">
            <span class="pbl__icon" aria-hidden="true"><app-icon name="bank" [size]="16" /></span>
            <span class="pbl__copy"><b>{{ titleOf(row) }}</b><small>{{ dayOf(row) }} · {{ accountOf(row) }}</small></span>
            <b class="pbl__amount">{{ amountOf(row) | eur }}</b>
            <button class="btn btn--sm" type="button" [disabled]="linking() !== null" (click)="line.set(null)">Andere</button>
          </div>
          @switch (state()) {
            @case ('loading') { <app-skeleton kind="list" [rows]="3" /> }
            @case ('error') {
              <p class="pbl__error" role="alert">Containers laden mislukt. <button class="btn btn--sm" type="button" (click)="load()">Opnieuw</button></p>
            }
            @default { <app-container-split [line]="row" [source]="source" [hint]="hint()" (done)="closed.emit()" /> }
          }
        } @else {
          <app-bank-transaction-picker direction="OUTGOING" heading="Welke transactie?" [fixed]="true" [exclude]="linkedLineIds()"
                                       note="Daarna verdeel je ze over leverancier, transport en andere kosten." (selectedChange)="pick($event)" />
        }
      </div>
      <div foot style="display:contents">
        <button class="btn" type="button" (click)="closed.emit()">Sluiten</button>
      </div>
    </app-sheet>
  `,
})
export class PurchaseBankLinkSheet implements OnInit {
  private readonly sourcing = inject(SourcingApi);
  private readonly banking = inject(BankingApi);
  private readonly accounts = inject(BankAccountsStore);
  private readonly ui = inject(Ui);

  readonly orderId = input.required<number>();
  /** The order's payments as the screen has them: the transactions already on it stay out of the picker. */
  readonly orderLineIds = input<readonly number[]>([]);
  readonly closed = output<void>();
  /** Booked: the host reloads the payments and the bank lines. */
  readonly linked = output<void>();

  readonly line = signal<BankStatementLine | null>(null);
  readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  readonly views = signal<PurchaseOrderView[]>([]);
  readonly rows = signal<PurchasePaymentRow[]>([]);
  readonly suppliers = signal<Supplier[]>([]);
  readonly linking = signal<number | null>(null);
  readonly payables = computed<ContainerPayable[]>(() => containerPayables(this.views()));
  readonly linkedLineIds = computed(() => [...this.orderLineIds()]);

  /** The split's data and calls on this screen (Kosten & bank passes its FinanceState instead). */
  readonly source: SplitSource = {
    suppliers: () => this.suppliers(),
    purchaseViews: () => this.views(),
    containerPayables: () => this.payables(),
    payments: () => this.rows(),
    linking: () => this.linking(),
    lineDay: (line) => paymentLocalDay({ receivedAt: line.bookedAt, timeZone: line.timeZone }),
    termPart: (line, target) => ({ paidOn: paymentLocalDay({ receivedAt: line.bookedAt, timeZone: line.timeZone }), amount: cents(Math.abs(line.amountEur)) / 100,
      currency: 'EUR', amountEur: null, label: target.payable.termLabel || 'Bankbetaling', payee: target.payable.payee, instalmentDue: target.payable.due, settles: false }),
    linkContainers: (line, parts, numbers) => this.book(line, async () => {
      await this.banking.addPurchasePayment(line.id, parts[0].purchaseOrderId!, parts);
      return numbers.length === 1 ? `Gekoppeld aan ${numbers[0]}${parts.length > 1 ? ` (${parts.length} delen)` : ''}` : `Gekoppeld aan ${numbers.length} containers (${numbers.join(', ')})`;
    }),
    shareContainers: (line, parts, rows) => this.book(line, async () => {
      const result = await this.banking.sharePurchasePayment(line.id, parts);
      const byName = new Map<string, number>();
      rows.forEach((row, index) => byName.set(row.name, (byName.get(row.name) ?? 0) + cents(result.parts[index]?.amountEur ?? row.amountEur)));
      return byName.size === 1 ? `Gekoppeld aan ${[...byName.keys()][0]}${parts.length > 1 ? ` (${parts.length} delen)` : ''}`
        : shareToast([...byName].map(([name, amount]) => ({ name, amountEur: amount / 100 })));
    }),
  };

  /**
   * Where the split starts: this container, on its open payment of the
   * transaction's amount, else its open term of that amount, else (a
   * transfer that is not to the supplier) its open Douane & transport.
   */
  readonly hint = computed(() => {
    const line = this.line(), orderId = this.orderId();
    const counterparty = line?.counterparty ?? '';
    if (!line) return { orderId, counterparty };
    const amount = cents(Math.abs(line.amountEur));
    const open = this.rows().filter((row) => row.orderId === orderId && row.bankStatementLineId == null && !row.creditOffset && row.amountEur > 0);
    const payment = open.find((row) => Math.abs(cents(row.amountEur) - amount) <= 2);
    if (payment) return { orderId, counterparty, paymentId: payment.id };
    const terms = this.payables().filter((term) => term.orderId === orderId);
    const term = terms.find((item) => Math.abs(cents(item.remainingEur) - amount) <= 2);
    if (term) return { orderId, counterparty, termKey: term.key };
    const view = this.views().find((item) => item.order.id === orderId);
    const supplier = normal(this.suppliers().find((item) => item.id === view?.order.supplierId)?.name);
    const toSupplier = supplier.length > 3 && normal(counterparty).includes(supplier.slice(0, Math.min(supplier.length, 8)));
    const transport = toSupplier ? undefined : terms.find((item) => item.payee === 'LOGISTICS');
    return transport ? { orderId, counterparty, termKey: transport.key } : { orderId, counterparty };
  });

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    this.state.set('loading');
    try {
      const [views, rows, suppliers] = await Promise.all([this.sourcing.purchaseOrders(), this.sourcing.purchasePayments(), this.sourcing.suppliers()]);
      this.views.set(views); this.rows.set(rows); this.suppliers.set(suppliers);
      this.state.set('ready');
    } catch {
      this.state.set('error');
    }
  }

  pick(line: BankStatementLine | null): void { this.line.set(line); }

  titleOf(line: BankStatementLine): string { return bankTextOf(line).title; }
  dayOf(line: BankStatementLine): string { const day = bankTransactionDay(line); return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`; }
  accountOf(line: BankStatementLine): string { return this.accounts.options().find((option) => option.key === line.account)?.label ?? line.account; }
  amountOf(line: BankStatementLine): number { return Math.abs(line.amountEur); }

  /** One booking at a time; the toast says what was linked, the host reloads. Answers the refusal, or ''. */
  private async book(line: BankStatementLine, run: () => Promise<string>): Promise<string> {
    if (this.linking() !== null) return 'Er loopt al een koppeling.';
    this.linking.set(line.id);
    try {
      const text = await run();
      this.ui.toast(text, 'ok');
      this.linked.emit();
      return '';
    } catch (failure: unknown) {
      return messageOf(failure, 'Koppelen mislukt');
    } finally {
      this.linking.set(null);
    }
  }
}
