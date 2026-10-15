import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, forwardRef, inject, signal, untracked, viewChild } from '@angular/core';
import { BankingApi } from '../../core/api/banking-api';
import { messageOf } from '../../core/api/errors';
import { Ui } from '../../shared/ui';
import { Icon } from '../../shared/icon';
import { EurPipe } from '../../shared/pipes';
import { bankAccountKey } from './bank-reconciliation';
import { BankAccountCard, type AccountView } from './bank-account-card';
import { BankMovementPanel } from './bank-movement-panel';
import { dayMonth } from './finance-format';
import { FINANCE_SECTION, FinanceSectionApi, StripItem } from './finance-section';
import type { FinanceCommand } from './finance-shortcuts';
import { FinanceState } from './finance-state';
import { FinanceFilters } from './finance-filters';
import { paymentMomentLabel } from './incoming-money';

type UnbankedItem = FinanceState['unbanked'] extends () => (infer T)[] ? T : never;

/**
 * Bank (spec-bank-forecast §3.1, §3.4): the cockpit on bank/accounts and
 * Transacties on bank/movements, one stream over every active account or one
 * account with `account=` (its card on top). The address and the list's
 * filters stay in step here; the list itself is BankMovementPanel.
 */
@Component({
  selector: 'app-bank-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: FINANCE_SECTION, useExisting: forwardRef(() => BankPanel) }],
  imports: [Icon, EurPipe, BankMovementPanel, BankAccountCard, FinanceFilters],
  template: `
    @if (state.location().tab === 'movements') {
      @if (selectedAccount(); as account) {
        @if (account.archived) {
          <p class="fin-note-line"><app-icon name="archive" [size]="14" />{{ account.label }} is gearchiveerd · alleen historiek
            <button class="wk-link" type="button" [disabled]="restoring()" (click)="restore(account.account)">Terugzetten</button></p>
        } @else { <app-bank-account-card class="fin-tx-account" [account]="account" [wide]="true" /> }
      }
      @if (state.desk()) {
        <div class="fin-tx-bar">
          @if (state.accountOptions().length > 1) {
            <div class="wk-chips" role="group" aria-label="Rekening">
              <button class="wk-chip" type="button" [attr.aria-pressed]="!state.location().account" (click)="state.go({ account: '' })">Alle rekeningen</button>
              @for (option of state.accountOptions(); track option.key) {
                <button class="wk-chip" type="button" [attr.aria-pressed]="state.canonicalAccount(state.location().account) === option.key" (click)="state.go({ account: option.key })">{{ option.label }}</button>
              }
            </div>
          }
          <app-finance-filters />
          @if (exactCount(); as count) {
            <button class="wk-btn wk-btn--sm" type="button" (click)="state.exactLinksOpen.set(true)"><app-icon name="link" [size]="14" />{{ count }} {{ count === 1 ? 'exacte suggestie' : 'exacte suggesties' }} koppelen</button>
          }
          @if (movementPanel(); as panel) {
            <span class="fin-tx-bar__totals">In {{ panel.totals().incoming | eur }} · Uit {{ panel.totals().outgoing | eur }}@if (panel.totals().internal) { <small> · interne overboekingen niet meegeteld</small> }</span>
          }
        </div>
      } @else if (exactCount(); as count) {
        <div class="ios-group fin-ios-single"><button class="ios-cell ios-cell--action" type="button" (click)="state.exactLinksOpen.set(true)">{{ count }} {{ count === 1 ? 'exacte suggestie' : 'exacte suggesties' }} koppelen</button></div>
      }
      <app-bank-movement-panel />
    } @else {
      <app-bank-movement-panel />
    }
  `,
})
export class BankPanel implements FinanceSectionApi {
  readonly state = inject(FinanceState);
  private readonly banking = inject(BankingApi);
  private readonly ui = inject(Ui);
  readonly restoring = signal(false);
  /** The account of Transacties with `account=`: an active one, or an archived one for its history. */
  readonly selectedAccount = computed<AccountView | null>(() => {
    const location = this.state.location();
    if (location.tab !== 'movements' || !location.account) return null;
    const key = this.state.canonicalAccount(location.account);
    return this.state.accountsView().find(account => account.account === key)
      ?? this.state.archivedAccounts().map(account => ({ ...account, ageDays: null, countsInCash: false })).find(account => account.account === key) ?? null;
  });
  private accountLines(key: string) { return this.state.bankStatements().filter(line => this.state.canonicalAccount(line.account) === key && this.state.officialBankLine(line)); }
  openCount(key: string): number { return this.accountLines(key).filter(line => !line.allocated && line.salesPaymentId == null).length; }
  transactionCount(key: string): number { return this.accountLines(key).length; }
  /** Every official line on the active accounts (Transacties without an account). */
  private readonly activeLines = computed(() => this.state.bankStatements().filter(line => this.state.officialBankLine(line) && !this.state.archivedBankLine(line)));
  /** "{k} exacte suggesties koppelen": the exact suggestions of the lines on screen (one account, or all). */
  readonly exactCount = computed(() => {
    const account = this.state.location().account ? this.state.canonicalAccount(this.state.location().account) : '';
    return this.activeLines().filter(line => (!account || this.state.canonicalAccount(line.account) === account) && this.state.suggestions().get(line.id)?.exact).length;
  });
  async restore(key: string): Promise<void> {
    if (this.restoring()) return;
    this.restoring.set(true);
    try { await this.banking.restoreAccount(key); await this.state.refreshBank(); this.ui.toast('Rekening teruggezet'); }
    catch (failure) { this.ui.toast(messageOf(failure, 'Terugzetten mislukt'), 'err'); }
    finally { this.restoring.set(false); }
  }
  iban(key: string): string { return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(key) ? key.match(/.{1,4}/g)!.join(' ') : key; }
  /** Transacties: one account, or (without one) every active account; a work-queue link keeps no stale filters. */
  movements(account = '', dir: '' | 'in' | 'out' = '', unlinked = false): void {
    this.state.go({ view: 'bank', tab: 'movements', account, dir, link: unlinked ? 'unlinked' : '', q: '', period: 'all', from: '', to: '' }, 'push');
  }
  /** An account chip or card keeps the search, period and filters of the stream. */
  openAccount(account: string): void {
    if (this.state.location().tab === 'movements') this.state.go({ account }, 'push');
    else this.movements(account);
  }
  showUnlinked(): void { this.state.go({ link: 'unlinked', dir: '', q: '', period: 'all', from: '', to: '' }); }
  pendingLabel(key: string): string {
    const count = this.openCount(key);
    return count ? count + ' te koppelen' : this.transactionCount(key) ? 'Alles gekoppeld' : 'Nog geen transacties';
  }
  readonly movementPanel = viewChild(BankMovementPanel);

  readonly strip = computed<StripItem[] | null>(() => null);
  readonly status = computed(() => {
    const location = this.state.location();
    const panel = this.movementPanel();
    if (panel) {
      const account = location.account ? this.state.canonicalAccount(location.account) : '';
      const total = account ? this.transactionCount(account) : this.activeLines().length;
      return `${panel.filteredLines().length} van ${total} ${total === 1 ? 'transactie' : 'transacties'}${account ? ' op ' + this.state.accountLabel(account) : ''}`;
    }
    return '';
  });

  constructor() {
    let timer: ReturnType<typeof setTimeout> | null = null;
    /* The list writes back only once the address has been read into it, or its defaults would wipe the address. */
    let synced: BankMovementPanel | null = null;
    inject(DestroyRef).onDestroy(() => { if (timer) clearTimeout(timer); });

    /* Address → list: the panel keeps its own filter signals (its tests rely on them). */
    effect(() => {
      const panel = this.movementPanel();
      const location = this.state.location();
      const desk = this.state.desk();
      if (!panel || location.view !== 'bank' || location.tab !== 'movements') return;
      untracked(() => {
        const range = this.state.rangeOf(location);
        const direction = location.dir === 'in' ? 'INCOMING' : location.dir === 'out' ? 'OUTGOING' : 'ALL';
        const link = location.link === 'unlinked' ? 'UNLINKED_IN' : 'ALL';
        const account = location.account ? this.state.canonicalAccount(location.account) : '';
        if (!timer && panel.search() !== location.q) panel.search.set(location.q);
        if (panel.accountFilter() !== account) panel.accountFilter.set(account);
        if (panel.directionFilter() !== direction) panel.directionFilter.set(direction);
        if (panel.linkFilter() !== link) panel.linkFilter.set(link);
        if (panel.from() !== range.from) panel.from.set(range.from);
        if (panel.to() !== range.to) panel.to.set(range.to);
        if (desk && panel.shown() < 50) panel.shown.set(50);
        synced = panel;
      });
    });

    /* List → address: a chip or the search field on the phone writes back, the search after 400 ms. */
    effect(() => {
      const panel = this.movementPanel();
      if (!panel) return;
      const search = panel.search(), account = panel.accountFilter(), direction = panel.directionFilter();
      const link = panel.linkFilter(), from = panel.from(), to = panel.to();
      untracked(() => {
        const location = this.state.location();
        if (synced !== panel || location.view !== 'bank' || location.tab !== 'movements') return;
        const patch: Record<string, string> = {};
        const dir = direction === 'INCOMING' ? 'in' : direction === 'OUTGOING' ? 'out' : '';
        const unlinked = link === 'UNLINKED_IN' ? 'unlinked' : '';
        if (dir !== location.dir) patch['dir'] = dir;
        if (unlinked !== location.link) patch['link'] = unlinked;
        if (account !== (location.account ? bankAccountKey(location.account) : '')) patch['account'] = account;
        const range = this.state.rangeOf(location);
        if (from !== range.from || to !== range.to) Object.assign(patch, from || to ? { from, to } : { period: 'all', from: '', to: '' });
        if (Object.keys(patch).length) this.state.go(patch);
        if (search !== location.q) {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            timer = null;
            if (this.state.location().q !== panel.search()) this.state.go({ q: panel.search() });
          }, 400);
        }
      });
    });
  }

  handle(command: FinanceCommand): boolean {
    return this.movementPanel()?.handle(command) ?? false;
  }

  /** "Transactie zoeken" for a payment marked paid without a transaction: Transacties, prefilled (§3.11). */
  note(item: UnbankedItem): void {
    const row = item.row;
    this.state.searchTransaction({ amountEur: item.amountEur, paidOn: item.paidOn ?? this.state.today(), party: row.party ?? null,
      description: row.description ?? null, incoming: item.amountEur < 0 });
  }

  freshLabel(account: AccountView): string {
    if (!account.reading) return 'Nog geen saldo';
    if (account.ageDays === null) return 'Historische saldocontrole';
    return account.ageDays === 0 ? 'Saldo vandaag gecontroleerd' : account.ageDays === 1 ? 'Saldo gisteren gecontroleerd' : `Saldo ${account.ageDays} d geleden gecontroleerd`;
  }

  stamp(asOfAt: string | null | undefined, date: string, timeZone: string | null | undefined): string {
    return asOfAt ? paymentMomentLabel({ receivedAt: asOfAt, timeZone: timeZone || 'Europe/Brussels' }) : `${dayMonth(date)}, einde dag`;
  }
}
