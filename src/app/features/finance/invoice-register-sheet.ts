import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { BankingApi } from '../../core/api/banking-api';
import type { BankStatementLine, ReceivedOdooInvoicePreview } from '../../core/api/banking-api';
import { messageOf } from '../../core/api/errors';
import type { InvoiceRow } from '../../core/api/invoice-finder-api';
import { BankTransactionPicker } from '../../shared/bank-transaction-picker';
import { bankAmountsMatch } from '../../shared/bank-transaction-options';
import { Sheet, Ui } from '../../shared/ui';
import { FinanceState } from './finance-state';
import { InvoiceFinderState } from './invoice-finder-state';
import { amountText, eurText, numberText, partyName, receivedLinkReady } from './invoice-finder';

/**
 * "Registreren bij transactie…" for an incoming Odoo bill: the bank's own
 * flow ("Ontvangen factuur" on a transaction), started from the invoice.
 * Pick the transaction, check Factuur · Betaling · Verschil, choose an
 * existing cost when the server offers some, register and link. No new money
 * logic: preview and link are the bank endpoints.
 */
@Component({
  selector: 'app-invoice-register-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, BankTransactionPicker],
  template: `
    <app-sheet variant="ios" title="Registreren bij transactie" closeLabel="Annuleren" (closed)="close()">
      <div body class="fin-sheet fin-inv-register">
        <p class="fin-inv-register__doc"><b>{{ party() }}</b> · {{ number() }} · {{ amount() }}</p>
        <app-bank-transaction-picker [direction]="row().kind === 'CREDIT_NOTE' ? 'INCOMING' : 'OUTGOING'" [amount]="row().amount" [selected]="line()"
                                     [startOpen]="true" [disabled]="busy()" heading="Transactie kiezen" (selectedChange)="choose($event)" />
        @if (checking()) { <p class="fin-hint" role="status">Factuur controleren…</p> }
        @if (preview(); as preview) {
          <dl class="wk-equation fin-inv-register__sum">
            <div><dt>Factuur</dt><dd>{{ eur(preview.invoiceTotalEur) }}</dd></div>
            <div><dt>Betaling</dt><dd>{{ eur(preview.paymentAmountEur) }}</dd></div>
            <div class="is-total"><dt>Verschil</dt><dd [class.wk-amount--warn]="warnDifference()">{{ eur(preview.differenceEur) }}</dd></div>
          </dl>
          @if (!preview.eligible && (preview.unavailableReason || preview.actionMessage)) { <p class="fin-error">{{ preview.unavailableReason || preview.actionMessage }}</p> }
          @if (preview.existingCandidates.length) {
            <fieldset class="fin-inv-register__costs">
              <legend>Bestaande kost</legend>
              @for (cost of preview.existingCandidates; track cost.id) {
                <label class="fin-inv-register__cost">
                  <input type="radio" name="fin-inv-register-cost" [checked]="chosenCost() === cost.id" [disabled]="busy() || checking()" (change)="chooseCost(cost.id)" />
                  <span><b>{{ cost.description || cost.reference || 'Kost' }}</b><small>{{ costLine(cost) }}</small></span>
                </label>
              }
            </fieldset>
          }
        }
        @if (error()) { <p class="fin-error" role="alert">{{ error() }}</p> }
      </div>
      <div foot style="display:contents">
        <button class="btn" type="button" [disabled]="busy()" (click)="close()">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="!ready() || busy()" (click)="register()">{{ busy() ? 'Bezig…' : 'Registreren en koppelen' }}</button>
      </div>
    </app-sheet>
  `,
})
export class InvoiceRegisterSheet {
  readonly row = input.required<InvoiceRow>();
  private readonly finder = inject(InvoiceFinderState);
  private readonly state = inject(FinanceState);
  private readonly banking = inject(BankingApi);
  private readonly ui = inject(Ui);

  readonly line = signal<BankStatementLine | null>(null);
  readonly preview = signal<ReceivedOdooInvoicePreview | null>(null);
  readonly chosenCost = signal<number | null>(null);
  readonly checking = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  private version = 0;

  readonly party = computed(() => partyName(this.row()));
  readonly number = computed(() => numberText(this.row()));
  readonly amount = computed(() => amountText(this.row()));
  readonly ready = computed(() => !this.checking()
    && receivedLinkReady(this.preview(), this.line()?.amountEur ?? null, this.chosenCost(), bankAmountsMatch));
  readonly warnDifference = computed(() => Math.abs(Math.round((this.preview()?.differenceEur ?? 0) * 100)) > 2);

  eur(value: number): string { return eurText(value); }
  costLine(cost: ReceivedOdooInvoicePreview['existingCandidates'][number]): string {
    return [cost.party, cost.date ? cost.date.split('-').reverse().join('/') : '', eurText(cost.totalEur)].filter(Boolean).join(' · ');
  }

  private moveId(): number | null {
    return this.row().odoo?.moveId ?? this.row().odooMoveId ?? null;
  }

  async choose(line: BankStatementLine | null): Promise<void> {
    this.line.set(line);
    this.chosenCost.set(null);
    this.preview.set(null);
    this.error.set('');
    if (line) await this.check(line, undefined);
    else this.version++;
  }

  chooseCost(id: number): void {
    const line = this.line();
    if (line && this.preview()?.existingCandidates.some((cost) => cost.id === id)) void this.check(line, id);
  }

  private async check(line: BankStatementLine, existingCompanyCostId: number | undefined): Promise<void> {
    const moveId = this.moveId();
    if (!moveId) return;
    const version = ++this.version;
    this.checking.set(true);
    this.error.set('');
    try {
      const preview = await this.banking.previewReceivedOdooInvoice(line.id, moveId, existingCompanyCostId);
      if (version !== this.version) return;
      this.preview.set(preview);
      this.chosenCost.set(existingCompanyCostId ?? preview.companyCostId);
    } catch (failure) {
      if (version === this.version) this.error.set(messageOf(failure, 'Factuur controleren mislukt. Kies de transactie opnieuw.'));
    } finally {
      if (version === this.version) this.checking.set(false);
    }
  }

  async register(): Promise<void> {
    const line = this.line(), preview = this.preview(), moveId = this.moveId();
    if (!line || !preview || !moveId || !this.ready() || this.busy()) return;
    const key = this.row().key;
    const costId = this.chosenCost();
    this.busy.set(true);
    this.error.set('');
    try {
      const result = await this.banking.linkReceivedOdooInvoice(line.id, { odooInvoiceId: moveId, snapshotHash: preview.snapshotHash,
        ...(costId ? { existingCompanyCostId: costId } : {}) });
      this.ui.toast(result.alreadyRegistered ? 'Ontvangen factuur gekoppeld' : 'Ontvangen factuur geregistreerd en gekoppeld');
      this.finder.registering.set(null);
      await this.state.refreshBank();
      await this.state.reload(['costs', 'payments', 'attachments']);
      await this.finder.afterRegister(key);
    } catch (failure) {
      this.error.set(messageOf(failure, 'Registreren mislukt.'));
    } finally {
      this.busy.set(false);
    }
  }

  close(): void {
    if (this.busy()) return;
    this.finder.registering.set(null);
  }
}
