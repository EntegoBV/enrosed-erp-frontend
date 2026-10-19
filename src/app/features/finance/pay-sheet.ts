import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { BankStatementLine } from '../../core/api/banking-api';
import { bankAmountsMatch } from '../../shared/bank-transaction-options';
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
 * still open by default; less notes a part payment, more is allowed) and the
 * day, or a bank transaction that already is the payment (picked above the
 * fields; no second bank line is noted here, 2026-10-16). For a selection:
 * each cost pays its remainder on that day. Never a one-tap write. A manual
 * account's movement is noted through Kosten & bank's own 'Bankbeweging
 * noteren'.
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
          @if (existingPayment(); as payment) { <p class="fin-sheet__lead">{{ single()!.description }} · {{ payment.amountEur | eur }} betaald op {{ dayMonthYear(payment.paidOn) }}</p> }
          <app-bank-transaction-picker [direction]="total() < 0 ? 'INCOMING' : 'OUTGOING'" [amount]="abs(existingPayment()?.amountEur ?? amount())" [selected]="selectedBank()" [disabled]="state.saving() || !!state.bankCostLinkPending()" (selectedChange)="selectedBank.set($event)" />
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
            <app-segmented class="fin-paid-seg" [variant]="state.desk() ? 'desk' : 'ios'" label="Betaald op" [options]="choices()" [value]="choice()" (changed)="choice.set($any($event))" />
            @if (choice() === 'other') { <app-date-field fieldId="pay-day" [value]="otherDay()" (valueChange)="otherDay.set($event)" /> }
            <span class="fin-hint">{{ paidLabel() }}</span>
          </div>
        </div>
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
  readonly partial = computed(() => Math.abs(Math.round(this.open() * 100)) < Math.abs(Math.round(this.total() * 100)));
  readonly choice = signal<PaidChoice>('today');
  readonly otherDay = signal(this.state.today());
  /** The field starts on the remainder and is not rebound while typing. */
  readonly initialAmount = Math.abs(this.open());
  readonly amount = signal(this.open());
  /** A link still pending for this one cost starts on its transaction; a selection (no single cost) or nothing pending starts empty. */
  readonly selectedBank = signal<BankStatementLine | null>(this.pendingLine());

  private pendingLine(): BankStatementLine | null {
    const pending = this.state.bankCostLinkPending(), single = this.single();
    return pending && single && pending.costId === single.id ? pending.line : null;
  }

  /**
   * 'Kostdatum' only when the costs share one date. A phone's four segments
   * at 390 px cut 'Andere datum' to 'Andere …': there it says 'Andere' (the
   * screen reader still hears 'Andere datum'; the chosen day stands under it).
   */
  readonly choices = computed<SegmentOption[]>(() => {
    const dates = new Set(this.costs().map((cost) => cost.date));
    return [{ id: 'today', label: 'Vandaag' }, { id: 'yesterday', label: 'Gisteren' },
      ...(dates.size === 1 ? [{ id: 'cost', label: 'Kostdatum' }] : []),
      this.state.desk() ? { id: 'other', label: 'Andere datum', shortLabel: 'Andere' } : { id: 'other', label: 'Andere', ariaLabel: 'Andere datum' }];
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
  /** '14 okt 2026': the app's date words, never the ISO day. */
  readonly dayMonthYear = dayMonthYear;
  /** Less than the remainder, the remainder, or more: the button says which. */
  readonly amountState = computed<'rest' | 'part' | 'over' | 'none'>(() => {
    if (!this.single()) return 'rest';
    const amount = Math.abs(Math.round(this.amount() * 100));
    if (amount <= 0) return 'none';
    const open = Math.abs(Math.round(this.open() * 100));
    return amount === open ? 'rest' : amount < open ? 'part' : 'over';
  });
  readonly primaryLabel = computed(() => {
    switch (this.amountState()) {
      case 'part': return 'Betaling noteren';
      case 'over': return 'Te veel: toch noteren';
      default: return this.total() < 0 ? 'Terugbetaling noteren' : 'Betaald zetten';
    }
  });
  readonly amountHint = computed(() => {
    switch (this.amountState()) {
      case 'part': return `Daarna nog ${formatEuro(Math.abs(Math.round((this.open() - this.amount()) * 100) / 100))} open`;
      case 'over': return `${formatEuro(Math.abs(Math.round((this.amount() - this.open()) * 100) / 100))} meer dan wat open staat`;
      case 'none': return 'Geef een bedrag groter dan nul op';
      default: return '';
    }
  });
  readonly canSave = computed(() => this.selectedBank() ? !this.state.busy() && !this.state.saving() && (!this.existingPayment() || bankAmountsMatch(this.existingPayment()!.amountEur, -this.selectedBank()!.amountEur)) : !this.existingPayment() && !!this.paidOn() && !this.state.busy() && !this.state.saving() && this.amountState() !== 'none');

  readonly abs = Math.abs;

  typed(value: string): void {
    const amount = Number(value);
    this.amount.set(Number.isFinite(amount) && amount > 0 ? Math.sign(this.total()) * Math.round(amount * 100) / 100 : 0);
  }

  save(): void {
    if (!this.canSave()) return;
    const selectedBank = this.selectedBank();
    if (selectedBank && this.single()) {
      void this.state.addPaymentFromBank(this.single()!, selectedBank, this.existingPayment()).then(done => { if (done) this.state.paySheet.set(null); });
      return;
    }
    const single = this.single();
    if (!single) {
      void this.state.markPaid(this.costs(), { paidOn: this.paidOn() });
      return;
    }
    void this.state.addPayment(single, { paidOn: this.paidOn(), amountEur: this.amount() })
      .then((done) => { if (done) this.state.paySheet.set(null); });
  }
}
