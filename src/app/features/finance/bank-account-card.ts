import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Icon } from '../../shared/icon';
import { EurPipe } from '../../shared/pipes';
import { dayEndBalances } from './cash-forecast';
import { FinanceState } from './finance-state';
import { OdooSyncState } from './odoo-sync-state';

export type AccountView = FinanceState['accountsView'] extends () => (infer T)[] ? T : never;

const DAY_MS = 86_400_000;
const isoDaysBack = (today: string, back: number): string => new Date(Date.parse(`${today}T00:00:00Z`) - back * DAY_MS).toISOString().slice(0, 10);

/**
 * One bank account as a card (the cockpit's row of accounts, and on top of
 * Transacties when one account is chosen): label, IBAN, balance, a 30-day
 * sparkline, where its transactions come from, what is still to link and
 * whether it counts in the Kaslijn. Its ⋯ keeps the four account actions
 * plus "Telt mee in de kasprognose".
 */
@Component({
  selector: 'app-bank-account-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, EurPipe],
  template: `
    @let a = account();
    <article class="fin-acct" [class.fin-acct--wide]="wide()" [class.fin-acct--phone]="!state.desk()">
      <button class="fin-acct__open" type="button" (click)="open()" [attr.aria-label]="wide() ? null : a.label + ': transacties openen'" [class.is-static]="wide()" [attr.tabindex]="wide() ? -1 : null">
        <span class="fin-acct__head"><span class="fin-acct__icon"><app-icon name="bank" [size]="18" /></span>
          <span class="fin-acct__name"><b>{{ a.label }}</b><small>{{ iban(a.account) }}</small></span></span>
        @if (a.currentEur !== null) {
          <strong class="fin-acct__balance">{{ a.currentEur | eur }}</strong>
        } @else { <strong class="fin-acct__balance fin-acct__balance--none">Nog geen saldo</strong> }
        @if (spark(); as path) {
          <svg class="fin-acct__spark" viewBox="0 0 120 32" preserveAspectRatio="none" aria-hidden="true"><path [attr.d]="path" /></svg>
        }
        <span class="fin-acct__source">{{ source() }}@if (checked(); as text) { <span class="fin-acct__checked" [class.is-warn]="stale()">{{ text }}</span> }</span>
        <span class="fin-acct__foot">
          <span [class]="'wk-pill ' + (unlinked() > 0 ? 'tone-warn' : count() ? 'tone-ok' : '')">{{ pending() }}</span>
          @if (!a.countsInCash) { <span class="wk-pill wk-pill--outline">telt niet mee in de kasprognose</span> }
          <small>{{ count() }} {{ count() === 1 ? 'transactie' : 'transacties' }}</small>
        </span>
      </button>
      @if (a.currentEur === null) {
        <button class="wk-link fin-acct__fill" type="button" (click)="state.checkOrFill(a.account)">Beginsaldo invullen</button>
      }
      <button class="wk-btn wk-btn--ghost wk-btn--sm fin-acct__more" [class.wk-btn--icon]="!wide()" type="button" [attr.aria-label]="a.label + ' beheren'" aria-haspopup="menu" (click)="menu($event)">
        <app-icon name="more" [size]="16" />@if (wide()) { <span>Beheer</span> }</button>
    </article>
  `,
})
export class BankAccountCard {
  readonly state = inject(FinanceState);
  private readonly sync = inject(OdooSyncState);
  readonly account = input.required<AccountView>();
  /** On top of Transacties: a wide card with "Beheer", not a link. */
  readonly wide = input(false);

  private readonly lines = computed(() => this.state.bankStatements().filter((line) => this.state.canonicalAccount(line.account) === this.account().account && this.state.officialBankLine(line)));
  readonly count = computed(() => this.lines().length);
  readonly unlinked = computed(() => this.lines().filter((line) => !line.allocated && line.salesPaymentId == null).length);
  readonly pending = computed(() => this.unlinked() ? `${this.unlinked()} te koppelen` : this.count() ? 'Alles gekoppeld' : 'Nog geen transacties');
  /** "Via Odoo · opgehaald vandaag 08:12" or "Handmatig · saldo 2 d geleden gecontroleerd". */
  readonly source = computed(() => {
    const a = this.account();
    if (a.source === 'ODOO') {
      const at = this.sync.lastSuccessAt();
      if (!at) return 'Via Odoo · nog niet opgehaald';
      const date = new Date(at);
      const day = date.toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' });
      const when = day === this.state.today() ? 'vandaag ' + date.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })
        : date.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' }).replace('.', '');
      return `Via Odoo · opgehaald ${when}`;
    }
    if (!a.reading || a.ageDays === null) return 'Handmatig · nog geen saldo gecontroleerd';
    return `Handmatig · saldo ${a.ageDays === 0 ? 'vandaag' : a.ageDays + ' d geleden'} gecontroleerd`;
  });
  /**
   * An Odoo account's last balance check, as the old account row said it ("Saldo 5 d geleden gecontroleerd"):
   * its transactions come from Odoo, its balance still rests on that check. A manual account says it in source().
   */
  readonly checked = computed(() => {
    const a = this.account();
    if (a.source !== 'ODOO' || !a.reading) return null;
    if (a.ageDays === null) return 'Historische saldocontrole';
    return a.ageDays === 0 ? 'Saldo vandaag gecontroleerd' : a.ageDays === 1 ? 'Saldo gisteren gecontroleerd' : `Saldo ${a.ageDays} d geleden gecontroleerd`;
  });
  /** Older than 14 days: warn, as the total tile does. */
  readonly stale = computed(() => (this.account().ageDays ?? 0) > 14);
  /** The account's end of day over the last 30 days, as a line; null without a known day. */
  readonly spark = computed(() => {
    const input = this.state.cashInput();
    const today = this.state.today();
    const days = dayEndBalances(input.movements, input.accounts, [this.account().account], isoDaysBack(today, 29), today);
    const values = [...days.values()];
    const known = values.filter((value): value is number => value !== null);
    if (known.length < 2) return null;
    const low = Math.min(...known), high = Math.max(...known), span = high - low || 1;
    let path = '', pen = false;
    values.forEach((value, index) => {
      if (value === null) { pen = false; return; }
      const x = (index / (values.length - 1)) * 120, y = 29 - ((value - low) / span) * 26;
      path += `${pen ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
      pen = true;
    });
    return path;
  });

  open(): void {
    if (this.wide()) return;
    this.state.go({ view: 'bank', tab: 'movements', account: this.account().account, dir: '', link: '', q: '', period: 'all', from: '', to: '' }, 'push');
  }

  iban(key: string): string { return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(key) ? key.match(/.{1,4}/g)!.join(' ') : key; }

  menu(event: MouseEvent): void {
    const a = this.account();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.state.openMenu({ title: a.label, anchor: this.state.desk() ? { x: rect.left, y: rect.bottom + 6 } : null, cancelLabel: this.state.desk() ? '' : 'Sluiten',
      items: [
        { id: 'manage', label: 'Rekeninggegevens en beheer', iconName: 'pencil' },
        { id: 'check', label: a.reading ? 'Saldo controleren' : 'Beginsaldo invullen', iconName: 'tick' },
        { id: 'history', label: 'Saldogeschiedenis', iconName: 'recent' },
        ...(a.reading ? [{ id: 'fix', label: 'Saldo corrigeren', iconName: 'pencil' }] : []),
        ...(this.state.cashRound() ? [{ id: 'counts', label: 'Telt mee in de kasprognose', iconName: 'bank', checked: a.countsInCash, divider: true }] : []),
      ],
      pick: (id) => {
        if (id === 'manage') this.state.bankAccountEditor.set({ key: a.account, label: a.label, source: a.source, archived: a.archived, aliases: a.aliases,
          odooJournalId: a.odooJournalId, manualMovementsAllowed: a.manualMovementsAllowed });
        else if (id === 'check') this.state.checkOrFill(a.account);
        else if (id === 'history') this.state.historyAccount.set(a.account);
        else if (id === 'fix') this.state.openBank(a.reading);
        else if (id === 'counts') this.state.setCountsInCash(a.account, !a.countsInCash);
      } });
  }
}
