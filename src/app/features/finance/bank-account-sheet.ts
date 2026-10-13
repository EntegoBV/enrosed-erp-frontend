import { ChangeDetectionStrategy, Component, inject, input, linkedSignal, output, signal } from '@angular/core';
import { BankingApi, BankAccount } from '../../core/api/banking-api';
import { messageOf } from '../../core/api/errors';
import { Sheet, Ui, escapeHtml } from '../../shared/ui';
import { FinanceState } from './finance-state';

/** Account identity and visibility change; transactions and payment history remain intact. */
@Component({
  selector: 'app-bank-account-sheet', changeDetection: ChangeDetectionStrategy.OnPush, imports: [Sheet],
  template: `
    <app-sheet variant="ios" title="Rekening beheren" (closed)="close()">
      <div body class="fin-sheet">
        <p><strong>{{ account().key }}</strong><br /><span class="fin-hint">{{ account().source === 'ODOO' ? 'Banktransacties via Odoo' : 'Handmatig bijgehouden rekening' }}</span></p>
        <label class="fin-field"><span>Naam in ENROSED</span><input class="input" maxlength="120" [disabled]="busy()" [value]="label()" (input)="label.set($any($event.target).value)" /></label>
        <label class="fin-field fin-field--stack"><span>Eerdere namen voor dezelfde rekening</span>
          <textarea class="textarea" rows="3" [disabled]="busy()" [value]="aliases()" (input)="aliases.set($any($event.target).value)" placeholder="Eén naam of IBAN per regel"></textarea>
        </label>
        <p class="fin-hint">Vul alleen namen in die zeker bij deze rekening horen. Hun saldocontroles en betalingen worden onder deze rekening getoond. Bij een rekening via Odoo tellen uitsluitend opgehaalde banktransacties mee na de saldocontrole.</p>
        <p class="fin-hint">Archiveren verbergt de rekening uit het actieve overzicht en het totaal. Alle transacties, betalingen en saldocontroles blijven bewaard. Je kunt de rekening later terugzetten.</p>
        @if (error()) { <p class="fin-error" role="alert">{{ error() }}</p> }
      </div>
      <div foot style="display:contents">
        <button class="btn" type="button" [disabled]="busy()" (click)="archive()">Rekening archiveren</button>
        <span class="spacer"></span>
        <button class="btn btn--primary" type="button" [disabled]="busy() || !label().trim()" (click)="save()">{{ busy() ? 'Bewaren…' : 'Bewaren' }}</button>
      </div>
    </app-sheet>
  `,
})
export class BankAccountSheet {
  readonly account = input.required<BankAccount>();
  readonly closed = output<void>();
  readonly label = linkedSignal(() => this.account().label);
  readonly aliases = linkedSignal(() => this.account().aliases.join('\n'));
  readonly busy = signal(false);
  readonly error = signal('');
  private readonly api = inject(BankingApi);
  private readonly state = inject(FinanceState);
  private readonly ui = inject(Ui);
  close(): void { if (!this.busy()) this.closed.emit(); }
  async save(): Promise<void> {
    if (this.busy() || !this.label().trim()) return;
    this.busy.set(true); this.error.set('');
    try {
      const account = this.account();
      await this.api.updateAccount(account.key, { label: this.label().trim(), aliases: this.aliases().split(/[\n,;]/).map(value => value.trim()).filter(Boolean), source: account.source, odooJournalId: account.odooJournalId });
      await this.state.refreshBank(); this.ui.toast('Rekening bewaard'); this.closed.emit();
    } catch (failure) { this.error.set(messageOf(failure, 'Rekening bewaren mislukt')); }
    finally { this.busy.set(false); }
  }
  archive(): void {
    if (this.busy()) return;
    const account = this.account();
    this.ui.confirm({ title: 'Rekening archiveren', message: `${escapeHtml(account.label)} verdwijnt uit het actieve bankoverzicht en het totaal. De volledige financiële historiek blijft bewaard. Je kunt de rekening later terugzetten.`, confirmLabel: 'Archiveren' }, async () => {
      this.busy.set(true); this.error.set('');
      try { await this.api.archiveAccount(account.key); await this.state.refreshBank(); this.ui.toast('Rekening gearchiveerd'); this.closed.emit(); }
      catch (failure) { this.error.set(messageOf(failure, 'Archiveren mislukt')); }
      finally { this.busy.set(false); }
    });
  }
}
