import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { BankStatementLine } from '../../core/api/banking-api';
import { BankTransactionPicker } from '../../shared/bank-transaction-picker';
import { DateField } from '../../shared/date-field';
import { EurPipe } from '../../shared/pipes';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { Sheet } from '../../shared/ui';
import { dayMonthYear } from './finance-format';
import { addDays, cashTotalOf, openOf } from './finance-metrics';
import { FinanceState, formatEuro } from './finance-state';

type PaidChoice = 'today' | 'yesterday' | 'cost' | 'other';

/**
 * The one place a payment is entered. For one cost: the amount (what is
 * still open by default; less notes a part payment, more is allowed), the
 * day, and, when switched on, an outgoing bank line on a chosen account
 * (the choice is remembered on this device). For a selection: each cost
 * pays its remainder on that day. Never a one-tap write.
 */
@Component({
  selector: 'app-pay-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, DateField, EurPipe, Segmented, BankTransactionPicker],
  template: `
    <app-sheet variant="ios" [title]="existingPayment() ? 'Betaling aan bank koppelen' : costs().length === 1 ? 'Betaald zetten' : costs().length + ' kosten betaald zetten'" (closed)="state.paySheet.set(null)">
      <div body class="fin-sheet">
        @if (!single()) { <p class="fin-hint">Bestaande banktransacties koppel je per kost. Open daarvoor de betaling bij die kost.</p> }
        @if (single()) {
          @if (existingPayment(); as payment) { <p class="fin-sheet__lead">{{ single()!.description }} · {{ payment.amountEur | eur }} betaald op {{ payment.paidOn }}</p> }
          <app-bank-transaction-picker direction="OUTGOING" [amount]="existingPayment()?.amountEur ?? amount()" [selected]="selectedBank()" [disabled]="state.saving() || !!state.bankCostLinkPending()" (selectedChange)="selectedBank.set($event)" />
        }
        @if (state.bankCostLinkError()) { <p class="fin-hint fin-hint--warn" role="alert">{{ state.bankCostLinkError() }}</p> }
        @if (state.bankCostLinkPending()) {
          @if (!state.bankCostLinkError()) { <p class="fin-hint">De bankkoppeling wacht op bevestiging. Probeer opnieuw of koppel later.</p> }
          <button class="btn btn--sm" type="button" [disabled]="state.saving()" (click)="state.deferBankCostLink()">Koppeling later</button>
        }
        @if (!selectedBank() && !existingPayment()) {
        @if (single(); as cost) {
          <p class="fin-sheet__lead">{{ cost.description }} · @if (partial()) { nog {{ open() | eur }} open van {{ total() | eur }} } @else { {{ total() | eur }} incl. btw }</p>
          <label class="fin-amount fin-field--wide">
            <span class="fin-sr">Bedrag</span><i aria-hidden="true">€</i>
            <input type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0,00" aria-label="Bedrag" [value]="initialAmount" (input)="typed($any($event.target).value)" />
          </label>
          @if (amountHint(); as hint) { <p class="fin-hint" style="text-align:center">{{ hint }}</p> }
        } @else {
          <p class="fin-sheet__lead">{{ costs().length }} kosten · {{ open() | eur }} nog open</p>
        }
        <div class="fin-group" [class.ios-group]="!state.desk()">
          <div class="fin-field fin-field--stack"><span>Betaald op</span>
            <app-segmented [variant]="state.desk() ? 'desk' : 'ios'" label="Betaald op" [options]="choices()" [value]="choice()" (changed)="choice.set($any($event))" />
            @if (choice() === 'other') { <app-date-field fieldId="pay-day" [value]="otherDay()" (valueChange)="otherDay.set($event)" /> }
            <span class="fin-hint">{{ paidLabel() }}</span>
          </div>
          <label class="fin-field fin-field--switch"><span>Ook als bankbeweging noteren<small>{{ single() ? 'Een uitgaande beweging voor deze betaling, met een verwijzing naar de kost' : 'Een uitgaande beweging per kost, met een verwijzing naar de kost' }}</small></span>
            <input [class]="state.desk() ? 'fin-checkbox' : 'ios-switch'" type="checkbox" role="switch" [checked]="toBank()" (change)="toBank.set($any($event.target).checked)" /></label>
          @if (toBank()) {
            <div class="fin-field fin-field--stack"><span>Rekening</span>
              @if (state.manualAccountOptions().length) {
                <div class="fin-choice" role="group" aria-label="Rekening">
                  @for (option of state.manualAccountOptions(); track option.key) {
                    <button class="fin-choice__chip" type="button" [attr.aria-pressed]="account() === option.key" (click)="account.set(option.key)">{{ option.label }}</button>
                  }
                </div>
              } @else {
                <span class="fin-hint">Nog geen rekening: vul eerst een saldo in bij Bank.</span>
              }
            </div>
          }
        </div>
        @if (toBank()) {
          @if (future()) { <p class="fin-hint fin-hint--warn">Een bankbeweging kan niet in de toekomst liggen.</p> }
          @else if (accountHint(); as hint) { <p class="fin-hint">{{ hint }}</p> }
        }
        }
      </div>
      <div foot style="display:contents">
        <button class="btn btn--primary" type="button" [disabled]="!canSave()" (click)="save()">{{ state.busy() || state.saving() ? 'Bezig…' : selectedBank() ? (state.bankCostLinkPending() ? 'Koppeling opnieuw proberen' : 'Betaling koppelen') : primaryLabel() }}</button>
      </div>
    </app-sheet>
  `,
})
export class PaySheet {
  readonly state = inject(FinanceState);
  readonly existingPayment = computed(() => this.state.paySheet()?.existingPayment ?? null);
  readonly costs = computed(() => this.state.paySheet()?.costs ?? []);
  /** The cost when the sheet is for exactly one; the amount field only exists then. */
  readonly single = computed(() => (this.costs().length === 1 ? this.costs()[0] : null));
  /** What is still open on the single cost, or the sum of the remainders. */
  readonly open = computed(() => Math.round(this.costs().reduce((sum, cost) => sum + openOf(cost) * 100, 0)) / 100);
  readonly total = computed(() => Math.round(this.costs().reduce((sum, cost) => sum + cashTotalOf(cost) * 100, 0)) / 100);
  readonly partial = computed(() => Math.round(this.open() * 100) < Math.round(this.total() * 100));
  private readonly preference = this.state.payToBank();
  readonly choice = signal<PaidChoice>('today');
  readonly otherDay = signal(this.state.today());
  readonly toBank = signal(this.preference.on);
  readonly account = signal(this.state.manualAccountOptions().some((option) => option.key === this.preference.accountKey)
    ? this.preference.accountKey : this.state.manualAccountOptions().length === 1 ? this.state.manualAccountOptions()[0].key : '');
  /** The field starts on the remainder and is not rebound while typing. */
  readonly initialAmount = this.open();
  readonly amount = signal(this.open());
  readonly selectedBank = signal<BankStatementLine | null>(this.state.bankCostLinkPending()?.costId === this.single()?.id ? this.state.bankCostLinkPending()!.line : null);

  /** 'Kostdatum' only when the costs share one date. */
  readonly choices = computed<SegmentOption[]>(() => {
    const dates = new Set(this.costs().map((cost) => cost.date));
    return [{ id: 'today', label: 'Vandaag' }, { id: 'yesterday', label: 'Gisteren' },
      ...(dates.size === 1 ? [{ id: 'cost', label: 'Kostdatum' }] : []), { id: 'other', label: 'Andere datum', shortLabel: 'Andere' }];
  });
  readonly paidOn = computed(() => {
    const today = this.state.today();
    switch (this.choice()) {
      case 'yesterday': return addDays(today, -1);
      case 'cost': return this.costs()[0]?.date ?? today;
      case 'other': return this.otherDay();
      default: return today;
    }
  });
  readonly paidLabel = computed(() => dayMonthYear(this.paidOn()));
  readonly future = computed(() => this.paidOn() > this.state.today());
  /** Less than the remainder, the remainder, or more: the button says which. */
  readonly amountState = computed<'rest' | 'part' | 'over' | 'none'>(() => {
    if (!this.single()) return 'rest';
    const amount = Math.round(this.amount() * 100);
    if (amount <= 0) return 'none';
    const open = Math.round(this.open() * 100);
    return amount === open ? 'rest' : amount < open ? 'part' : 'over';
  });
  readonly primaryLabel = computed(() => {
    switch (this.amountState()) {
      case 'part': return 'Betaling noteren';
      case 'over': return 'Te veel: toch noteren';
      default: return 'Betaald zetten';
    }
  });
  readonly amountHint = computed(() => {
    switch (this.amountState()) {
      case 'part': return `Daarna nog ${formatEuro(Math.round((this.open() - this.amount()) * 100) / 100)} open`;
      case 'over': return `${formatEuro(Math.round((this.amount() - this.open()) * 100) / 100)} meer dan wat open staat`;
      case 'none': return 'Geef een bedrag groter dan nul op';
      default: return '';
    }
  });
  readonly canSave = computed(() => this.selectedBank() ? !this.state.busy() && !this.state.saving() : !this.existingPayment() && !!this.paidOn() && !this.state.busy() && !this.state.saving() && this.amountState() !== 'none'
    && (!this.toBank() || (!!this.account() && !this.future())));

  /** Whether the line lands after the account's last check (and so moves its balance); the cost form shows the same hint. */
  readonly accountHint = computed(() => this.state.accountHint(this.account(), this.paidOn()));

  typed(value: string): void {
    const amount = Number(value);
    this.amount.set(Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0);
  }

  save(): void {
    if (!this.canSave()) return;
    const selectedBank = this.selectedBank();
    if (selectedBank && this.single()) {
      void this.state.addPaymentFromBank(this.single()!, selectedBank, this.existingPayment()).then(done => { if (done) this.state.paySheet.set(null); });
      return;
    }
    this.state.rememberPayToBank({ on: this.toBank(), accountKey: this.account() || this.preference.accountKey });
    const bankAccount = this.toBank() ? this.account() : null;
    const single = this.single();
    if (!single) {
      void this.state.markPaid(this.costs(), { paidOn: this.paidOn(), bankAccount });
      return;
    }
    void this.state.addPayment(single, { paidOn: this.paidOn(), amountEur: this.amount(), bankAccountKey: bankAccount })
      .then((done) => { if (done) this.state.paySheet.set(null); });
  }
}
