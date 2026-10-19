import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import type { BankStatementLine } from '../../core/api/banking-api';
import { BankingApi } from '../../core/api/banking-api';
import { messageOf } from '../../core/api/errors';
import { Icon } from '../../shared/icon';
import { EurPipe } from '../../shared/pipes';
import { Sheet, Ui } from '../../shared/ui';
import type { LinkTarget } from './bank-change-preview';
import { bankTextOf } from './bank-text';
import { dayMonth } from './finance-format';
import { FinanceState, formatEuro } from './finance-state';
import { OdooConnectionPanel } from './odoo-connection-panel';
import { OdooSyncState } from './odoo-sync-state';

const signed = (value: number): string => `${value > 0 ? '+' : '−'} ${formatEuro(Math.abs(value))}`;
const amountOf = (target: LinkTarget): number => target.kind === 'cost-new' || target.kind === 'sales-new' ? target.openEur
  : target.kind === 'term-new' ? target.payable.remainingEur : target.amountEur;

/**
 * "{k} exacte suggesties koppelen" (spec §3.8): every exact, unique match
 * ticked; "Koppel {n}" links them one by one in booking order (each follows
 * the bank) and stops at the first refusal, saying how far it got.
 */
@Component({
  selector: 'app-exact-links-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet],
  template: `
    <app-sheet variant="ios" title="Exacte suggesties koppelen" [wide]="true" (closed)="close()">
      <div body class="fin-sheet fin-exact">
        <p class="fin-hint">Alleen suggesties met het juiste bedrag, nog een teken in de mededeling en geen tweede kandidaat. Elke koppeling volgt de bank.</p>
        <ul class="fin-exact__list">
          @for (row of rows(); track row.line.id) {
            <li><label><input type="checkbox" [checked]="ticked().has(row.line.id)" [disabled]="busy()" (change)="toggle(row.line.id)" />
              <span><b>{{ title(row.line) }} {{ signedEur(row.line.amountEur) }}</b>
                <span>⇄ {{ row.target.title }} {{ eur(amount(row.target)) }}</span>
                @if (row.follows) { <small>datum volgt de bank</small> }</span></label></li>
          } @empty { <li class="fin-hint">Geen exacte suggesties meer.</li> }
        </ul>
      </div>
      <div foot class="fin-sheet__foot">
        <button class="btn" type="button" [disabled]="busy()" (click)="close()">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="busy() || !ticked().size" (click)="run()">{{ busy() ? 'Koppelen…' : 'Koppel ' + ticked().size }}</button>
      </div>
    </app-sheet>
  `,
})
export class ExactLinksSheet {
  readonly state = inject(FinanceState);
  private readonly ui = inject(Ui);
  readonly busy = signal(false);
  readonly ticked = signal<ReadonlySet<number>>(new Set());
  /** The exact suggestions of the lines on screen (one account on Transacties, else every active one), in booking order. */
  readonly rows = computed(() => {
    const location = this.state.location();
    const account = location.view === 'bank' && location.tab === 'movements' && location.account ? this.state.canonicalAccount(location.account) : '';
    return this.state.bankStatements().filter((line) => this.state.officialBankLine(line) && !this.state.archivedBankLine(line) && (!account || this.state.canonicalAccount(line.account) === account))
      .map((line) => ({ line, suggestion: this.state.suggestions().get(line.id) }))
      .filter((row): row is { line: BankStatementLine; suggestion: NonNullable<typeof row.suggestion> } => !!row.suggestion?.exact && row.suggestion.target.kind !== 'cost-pattern')
      .map((row) => ({ line: row.line, target: row.suggestion.target as LinkTarget, follows: !['cost-new', 'sales-new', 'term-new'].includes(row.suggestion.target.kind) }))
      .sort((a, b) => Date.parse(a.line.bookedAt) - Date.parse(b.line.bookedAt) || a.line.id - b.line.id);
  });

  constructor() {
    effect(() => { const ids = this.rows().map((row) => row.line.id); untracked(() => { if (!this.busy()) this.ticked.set(new Set(ids)); }); });
  }

  toggle(id: number): void { this.ticked.update((set) => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  close(): void { if (!this.busy()) this.state.exactLinksOpen.set(false); }

  async run(): Promise<void> {
    const rows = this.rows().filter((row) => this.ticked().has(row.line.id));
    if (!rows.length || this.busy()) return;
    this.busy.set(true);
    let done = 0;
    try {
      for (const row of rows) {
        const failure = await this.state.linkLine(row.line, row.target, { toast: false });
        if (failure) {
          this.ui.toast(`Gestopt bij ${row.line.counterparty || row.line.reference ? this.title(row.line) : 'een transactie'} ${formatEuro(Math.abs(row.line.amountEur))}: ${failure}. ${done} van ${rows.length} gekoppeld.`, 'err');
          return;
        }
        done += 1;
      }
      this.ui.toast(`${done} ${done === 1 ? 'transactie' : 'transacties'} gekoppeld`);
      this.state.exactLinksOpen.set(false);
    } finally {
      this.busy.set(false);
    }
  }
  amount(target: LinkTarget): number { return amountOf(target); }
  /** The line's clean title (bankTextOf), as its row on Transacties reads. */
  title(line: BankStatementLine): string { return bankTextOf(line).title; }
  eur(value: number): string { return formatEuro(value); }
  signedEur(value: number): string { return signed(value); }
}

/** "Betalingen zonder transactie ({n})": payments marked paid that no transaction carries, each with "Transactie zoeken" (§3.4, §3.11). */
@Component({
  selector: 'app-unbanked-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, EurPipe],
  template: `
    <app-sheet variant="ios" title="Betalingen zonder transactie" (closed)="state.unbankedOpen.set(false)">
      <div body class="fin-sheet">
        <p class="fin-hint">Deze betalingen zijn al geregistreerd. Zoek de bijbehorende banktransactie en koppel ze; registreer ze niet opnieuw.</p>
        @for (item of state.unbanked(); track item.kind + '#' + item.id) {
          <div class="fin-bank-pending__row"><span><b>{{ item.row.description }}</b><small>{{ day(item.paidOn) }} · {{ item.row.party || item.row.reference }}</small></span>
            <strong>{{ item.amountEur | eur }}</strong>
            <button class="wk-btn wk-btn--sm" type="button" (click)="state.searchTransaction({ amountEur: item.amountEur, paidOn: item.paidOn ?? state.today(), party: item.row.party, description: item.row.description, incoming: item.amountEur < 0 })">Transactie zoeken</button></div>
        }
        @for (payment of state.pendingReceipts(); track payment.id) {
          <div class="fin-bank-pending__row"><span><b>{{ payment.orderNumber }}</b><small>{{ state.accountLabel(payment.bankAccount) || 'Rekening nog te kiezen' }}</small></span>
            <strong>{{ payment.amountEur | eur }}</strong>
            <button class="wk-btn wk-btn--sm" type="button" (click)="state.searchTransaction({ amountEur: payment.amountEur, paidOn: payment.receivedAt.slice(0, 10), party: null, description: payment.orderNumber, account: payment.bankAccount, incoming: payment.amountEur > 0 })">Transactie zoeken</button></div>
        }
        @if (!state.unbanked().length && !state.pendingReceipts().length) { <p class="fin-hint">Alle betalingen staan op de bank.</p> }
      </div>
    </app-sheet>
  `,
})
export class UnbankedSheet {
  readonly state = inject(FinanceState);
  day(value: string | null): string { return dayMonth(value); }
}

/** ⋯ › "Gearchiveerde rekeningen": history stays; restore. */
@Component({
  selector: 'app-archived-accounts-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet],
  template: `
    <app-sheet variant="ios" title="Gearchiveerde rekeningen" (closed)="state.archivedOpen.set(false)">
      <div body class="fin-sheet">
        <p class="fin-hint">Historiek blijft bewaard; deze rekeningen tellen niet mee in het actieve saldo.</p>
        @for (account of state.archivedAccounts(); track account.account) {
          <div class="fin-bank-pending__row"><span><b>{{ account.label }}</b><small>{{ iban(account.account) }}</small></span>
            <button class="wk-btn wk-btn--sm" type="button" (click)="history(account.account)">Historiek</button>
            <button class="wk-btn wk-btn--sm" type="button" [disabled]="restoring()" (click)="restore(account.account)">Terugzetten</button></div>
        } @empty { <p class="fin-hint">Geen gearchiveerde rekeningen.</p> }
      </div>
    </app-sheet>
  `,
})
export class ArchivedAccountsSheet {
  readonly state = inject(FinanceState);
  private readonly banking = inject(BankingApi);
  private readonly ui = inject(Ui);
  readonly restoring = signal(false);
  iban(key: string): string { return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(key) ? key.match(/.{1,4}/g)!.join(' ') : key; }
  history(key: string): void {
    this.state.archivedOpen.set(false);
    this.state.go({ view: 'bank', tab: 'movements', account: key, dir: '', link: '', q: '', period: 'all', from: '', to: '' }, 'push');
  }
  async restore(key: string): Promise<void> {
    if (this.restoring()) return;
    this.restoring.set(true);
    try { await this.banking.restoreAccount(key); await this.state.refreshBank(); this.ui.toast('Rekening teruggezet'); }
    catch (failure) { this.ui.toast(messageOf(failure, 'Terugzetten mislukt'), 'err'); }
    finally { this.restoring.set(false); }
  }
}

/** ⋯ › "Odoo-verbinding", the toast's "Details" and "Odoo: controle nodig ›": the connection panel in a sheet. */
@Component({
  selector: 'app-odoo-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, OdooConnectionPanel],
  template: `
    <app-sheet variant="ios" title="Odoo-verbinding" [wide]="true" (closed)="sync.sheetOpen.set(false)">
      <div body class="fin-sheet"><app-odoo-connection-panel [expanded]="true" /></div>
    </app-sheet>
  `,
})
export class OdooSheet {
  readonly sync = inject(OdooSyncState);
}

/** "Buffer voor 'krap'": one amount for the company (§3.3), also in Analyses. */
@Component({
  selector: 'app-buffer-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, Icon],
  template: `
    <app-sheet variant="ios" title="Buffer voor 'krap'" (closed)="state.bufferOpen.set(false)">
      <div body class="fin-sheet">
        <label class="fin-field"><span>Buffer</span>
          <span class="fin-amount-field"><app-icon name="bank" [size]="16" /><input class="input" inputmode="decimal" [value]="text()" (input)="text.set($any($event.target).value)" aria-label="Buffer in euro" /></span></label>
        <p class="fin-hint">Eén bedrag voor het bedrijf; ook in Analyses › Kasprognose.</p>
        @if (invalid()) { <p class="fin-error" role="alert">Geef een bedrag van € 0 of meer.</p> }
      </div>
      <div foot class="fin-sheet__foot">
        <button class="btn" type="button" [disabled]="busy()" (click)="save(null)">Standaard (€ 10.000)</button>
        <button class="btn btn--primary" type="button" [disabled]="busy() || invalid()" (click)="save(value())">Bewaren</button>
      </div>
    </app-sheet>
  `,
})
export class BufferSheet {
  readonly state = inject(FinanceState);
  readonly text = signal(String(this.state.kaslijn().bufferEur).replace('.', ','));
  readonly busy = signal(false);
  readonly value = computed(() => { const value = Number(this.text().trim().replace(/\./g, '').replace(',', '.')); return Number.isFinite(value) ? Math.round(value * 100) / 100 : NaN; });
  readonly invalid = computed(() => !(this.value() >= 0));
  async save(value: number | null): Promise<void> {
    this.busy.set(true);
    try { if (await this.state.saveBuffer(value)) this.state.bufferOpen.set(false); } finally { this.busy.set(false); }
  }
}
