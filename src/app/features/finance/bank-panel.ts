import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, forwardRef, inject, signal, untracked, viewChild } from '@angular/core';
import { BankingApi } from '../../core/api/banking-api';
import { messageOf } from '../../core/api/errors';
import { Ui } from '../../shared/ui';
import { Icon } from '../../shared/icon';
import { EurPipe } from '../../shared/pipes';
import { bankAccountKey } from './bank-reconciliation';
import { BankMovementPanel } from './bank-movement-panel';
import { OdooConnectionPanel } from './odoo-connection-panel';
import { dayMonth } from './finance-format';
import { FINANCE_SECTION, FinanceSectionApi, StripItem } from './finance-section';
import type { FinanceCommand } from './finance-shortcuts';
import { FinanceState } from './finance-state';
import { FinanceFilters } from './finance-filters';
import { paymentMomentLabel } from './incoming-money';

type AccountView = FinanceState['accountsView'] extends () => (infer T)[] ? T : never;
type UnbankedItem = FinanceState['unbanked'] extends () => (infer T)[] ? T : never;

/**
 * Account-led bank register. Old movement URLs remain valid, while every
 * visible transaction list belongs to an explicitly selected account.
 */
@Component({
  selector: 'app-bank-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: FINANCE_SECTION, useExisting: forwardRef(() => BankPanel) }],
  imports: [Icon, EurPipe, BankMovementPanel, OdooConnectionPanel, FinanceFilters],
  template: `
    @if (selectedAccount(); as account) {
      <section class="fin-bank-account" aria-label="Gekozen bankrekening">
        <div class="fin-bank-account__identity">
          <span class="fin-bank-account__icon"><app-icon name="bank" [size]="22" /></span>
          <div><p class="fin-bank-account__iban">{{ iban(account.account) }}</p><span class="fin-hint">{{ account.archived ? 'Gearchiveerde rekening · historiek' : account.source === 'ODOO' ? 'Banktransacties via Odoo' : 'Handmatig bijgehouden rekening' }}</span></div>
          <button class="wk-btn wk-btn--sm" type="button" (click)="accountMenu(account, $event)">Rekening beheren <app-icon name="chevron-down" [size]="14" /></button>
        </div>
        <div class="fin-bank-account__figures">
          <div><span>Berekend saldo</span><strong>{{ account.currentEur === null ? 'Nog geen saldo' : (account.currentEur | eur) }}</strong><small>{{ account.reading ? 'Vanaf saldocontrole ' + stamp(account.reading.asOfAt, account.reading.date, account.reading.timeZone) : 'Voeg een saldocontrole toe om het saldo te berekenen' }}</small></div>
          <button type="button" (click)="state.go({ link: 'unlinked', dir: '', q: '', period: 'all', from: '', to: '' })"><span>Te koppelen</span><strong>{{ openCount(account.account) }}</strong><small>Banktransacties zonder volledige koppeling</small></button>
          <div><span>Banktransacties</span><strong>{{ transactionCount(account.account) }}</strong><small>{{ account.source === 'ODOO' ? 'Opgehaald van deze rekening' : 'Geregistreerd op deze rekening' }}</small></div>
        </div>
      </section>
      @if (account.source === 'ODOO') { <app-odoo-connection-panel /> }
      <section class="fin-bank-register" aria-label="Transacties van deze rekening">
        <header class="fin-bank-register__head"><div><h2>Transacties</h2><p>Koppel een factuur, uitgave of bestaande betaling. Maximaal € 0,02 verschil.</p></div>
          @if (account.manualMovementsAllowed && !account.archived) { <button class="wk-btn wk-btn--sm" type="button" (click)="state.openMovement({ accountKey: account.account })"><app-icon name="plus" [size]="14" />Transactie noteren</button> }
        </header>
        @if (state.desk()) {
          <div class="fin-bank-register__filters"><app-finance-filters />
            @if (movementPanel(); as panel) { <span class="fin-bank-register__totals">In {{ panel.totals().incoming | eur }} · Uit {{ panel.totals().outgoing | eur }} <small>binnen selectie</small></span> }
          </div>
        }
        <app-bank-movement-panel />
      </section>
    } @else {
      <header class="fin-bank-home">
        <div><h2>Je bankrekeningen</h2><p>Open een rekening om transacties te bekijken en facturen af te punten.</p></div>
        <div class="fin-bank-home__balance"><span>Totaal berekend saldo</span><strong>{{ known() ? (state.currentBankEur() | eur) : '—' }}</strong><small>{{ headSub() }}</small></div>
      </header>
      @if (state.location().tab === 'movements') { <p class="fin-hint">Kies hieronder de rekening waarvan je de transacties wilt bekijken.</p> }
      <div class="fin-bank-accounts" role="list" aria-label="Bankrekeningen">
        @for (account of state.accountsView(); track account.account) {
          <article class="fin-bank-account-row" role="listitem">
            <button class="fin-bank-account-row__open" type="button" (click)="openAccount(account.account)" [attr.aria-label]="account.label + ' openen'">
              <span class="fin-bank-account__icon"><app-icon name="bank" [size]="22" /></span>
              <span class="fin-bank-account-row__name"><b>{{ account.label }}</b><span>{{ iban(account.account) }}</span><small>{{ account.source === 'ODOO' ? 'Via Odoo' : 'Handmatige rekening' }} · {{ transactionCount(account.account) }} transacties</small></span>
              <span class="fin-bank-account-row__balance"><b>{{ account.currentEur === null ? 'Nog geen saldo' : (account.currentEur | eur) }}</b><small>{{ freshLabel(account) }}</small></span>
              <span class="fin-bank-account-row__pending" [class.is-open]="openCount(account.account) > 0">{{ openCount(account.account) ? openCount(account.account) + ' te koppelen' : 'Alles gekoppeld' }}</span>
              <app-icon name="chevron-right" [size]="18" />
            </button>
            <button class="wk-btn wk-btn--ghost wk-btn--icon" type="button" [attr.aria-label]="account.label + ' beheren'" (click)="accountMenu(account, $event)"><app-icon name="more" [size]="18" /></button>
          </article>
        } @empty {
          <div class="wk-empty"><span class="wk-empty__icon"><app-icon name="bank" [size]="22" /></span><p class="wk-empty__title">Nog geen actieve rekening</p><p class="wk-empty__text">Voeg een rekening met beginsaldo toe, of haal je verbonden rekeningen op.</p><button class="wk-btn wk-btn--primary" type="button" (click)="state.openBank(null)">Rekening toevoegen</button></div>
        }
      </div>
      <app-odoo-connection-panel />
      @if (state.unbanked().length || pendingReceipts().length) {
        <details class="fin-bank-pending">
          <summary><span>Betalingen zonder bankkoppeling</span><b>{{ state.unbanked().length + pendingReceipts().length }}</b></summary>
          <p class="fin-hint">Deze betalingen zijn al geregistreerd. Open de juiste rekening en koppel de bijbehorende banktransactie; registreer ze niet opnieuw.</p>
          @for (item of state.unbanked(); track item.kind + '#' + item.id) {
            <div class="fin-bank-pending__row"><span><b>{{ item.row.description }}</b><small>{{ day(item.paidOn) }} · {{ item.row.party || item.row.reference }}</small></span><strong>{{ item.amountEur | eur }}</strong><button class="wk-btn wk-btn--sm" type="button" (click)="note(item)">Transactie zoeken</button></div>
          }
          @for (payment of pendingReceipts(); track payment.id) {
            <div class="fin-bank-pending__row"><span><b>{{ payment.orderNumber }}</b><small>{{ state.accountLabel(payment.bankAccount) || 'Rekening nog te kiezen' }}</small></span><strong>{{ payment.amountEur | eur }}</strong><button class="wk-btn wk-btn--sm" type="button" (click)="movements(state.canonicalAccount(payment.bankAccount), payment.amountEur < 0 ? 'out' : 'in', true)">Transactie zoeken</button></div>
          }
        </details>
      }
      @if (state.archivedAccounts().length) {
        <details class="fin-bank-pending"><summary><span>Gearchiveerde rekeningen</span><b>{{ state.archivedAccounts().length }}</b></summary><p class="fin-hint">Historiek blijft bewaard; deze rekeningen tellen niet mee in het actieve saldo.</p>
          @for (account of state.archivedAccounts(); track account.account) {
            <div class="fin-bank-pending__row"><span><b>{{ account.label }}</b><small>{{ iban(account.account) }}</small></span><button class="wk-btn wk-btn--sm" type="button" (click)="movements(account.account)">Historiek</button><button class="wk-btn wk-btn--sm" type="button" [disabled]="restoring()" (click)="restore(account.account)">Terugzetten</button></div>
          }
        </details>
      }
    }

  `,
})
export class BankPanel implements FinanceSectionApi {
  readonly state = inject(FinanceState);
  private readonly banking = inject(BankingApi);
  private readonly ui = inject(Ui);
  readonly restoring = signal(false);
  readonly selectedAccount = computed(() => {
    const location = this.state.location();
    if (location.tab !== 'movements' || !location.account) return null;
    const key = this.state.canonicalAccount(location.account);
    return this.state.accountsView().find(account => account.account === key)
      ?? this.state.archivedAccounts().map(account => ({ ...account, ageDays: null })).find(account => account.account === key) ?? null;
  });
  private accountLines(key: string) { return this.state.bankStatements().filter(line => this.state.canonicalAccount(line.account) === key && this.state.officialBankLine(line)); }
  openCount(key: string): number { return this.accountLines(key).filter(line => !line.allocated && line.salesPaymentId == null).length; }
  transactionCount(key: string): number { return this.accountLines(key).length; }
  readonly pendingReceipts = computed(() => {
    const linked = new Set(this.state.bankStatements().map(line => line.salesPaymentId));
    return this.state.incomingPayments().filter(payment => !linked.has(payment.id) && this.state.bankLedger().accounts.some(account => account.source === 'ODOO' && !account.archived && account.account === this.state.canonicalAccount(payment.bankAccount)));
  });
  manage(account: AccountView): void { this.state.bankAccountEditor.set({ key: account.account, label: account.label, source: account.source, archived: account.archived, aliases: account.aliases, odooJournalId: account.odooJournalId, manualMovementsAllowed: account.manualMovementsAllowed }); }
  async restore(key: string): Promise<void> {
    if (this.restoring()) return;
    this.restoring.set(true);
    try { await this.banking.restoreAccount(key); await this.state.refreshBank(); this.ui.toast('Rekening teruggezet'); }
    catch (failure) { this.ui.toast(messageOf(failure, 'Terugzetten mislukt'), 'err'); }
    finally { this.restoring.set(false); }
  }
  iban(key: string): string { return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(key) ? key.match(/.{1,4}/g)!.join(' ') : key; }
  movements(account = '', dir: '' | 'in' | 'out' = '', unlinked = false): void { this.state.go({ view: 'bank', tab: 'movements', account: account || (this.state.accountsView().length === 1 ? this.state.accountsView()[0].account : ''), dir, link: unlinked ? 'unlinked' : '', q: '', period: 'all', from: '', to: '' }, 'push'); }
  openAccount(account: string): void {
    // A work-queue link may first ask which account: preserve its search and filters.
    if (this.state.location().tab === 'movements') this.state.go({ account }, 'push');
    else this.movements(account);
  }
  readonly movementPanel = viewChild(BankMovementPanel);

  readonly known = computed(() => this.state.accountsView().some((account) => account.currentEur !== null));
  readonly unbankedEur = computed(() => Math.round(this.state.unbanked().reduce((sum, row) => sum + row.amountEur * 100, 0)) / 100);
  readonly headSub = computed(() => {
    const ages = this.state.accountsView().map((account) => account.ageDays).filter((age): age is number => age !== null);
    if (!ages.length) return 'Nog geen saldo ingevuld';
    const newest = Math.min(...ages);
    return `Berekend uit je saldo's en bewegingen · laatst gecontroleerd ${newest === 0 ? 'vandaag' : newest === 1 ? 'gisteren' : newest + ' dagen geleden'}`;
  });

  readonly strip = computed<StripItem[] | null>(() => null);
  readonly status = computed(() => {
    const panel = this.movementPanel();
    if (this.state.location().tab === 'movements' && panel) return `${panel.filteredLines().length} van ${this.transactionCount(this.state.canonicalAccount(this.state.location().account))} transacties op deze rekening`;
    const count = this.state.accountsView().length;
    return `${count} ${count === 1 ? 'rekening' : 'rekeningen'}`;
  });

  constructor() {
    // Legacy all-movement links choose the only account when unambiguous; never mix accounts silently.
    effect(() => {
      const location = this.state.location(), accounts = this.state.accountsView();
      if (location.view === 'bank' && location.tab === 'movements' && !location.account && accounts.length === 1)
        untracked(() => this.state.go({ account: accounts[0].account }));
    });
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

  accountMenu(account: AccountView, event: MouseEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.state.openMenu({ title: account.label, anchor: { x: rect.left, y: rect.bottom + 6 },
      items: [
        { id: 'manage', label: 'Naam en rekeningbeheer', iconName: 'pencil' },
        { id: 'check', label: account.reading ? 'Saldo controleren' : 'Beginsaldo invullen', iconName: 'tick' },
        { id: 'history', label: 'Saldogeschiedenis', iconName: 'recent' },
        ...(account.reading ? [{ id: 'fix', label: 'Saldo corrigeren', iconName: 'pencil' }] : []),
      ],
      pick: (id) => (id === 'manage' ? this.manage(account) : id === 'check' ? this.state.checkOrFill(account.account) : id === 'history' ? this.state.historyAccount.set(account.account) : this.state.openBank(account.reading)) });
  }

  /** Find the real transaction for an already recorded payment. */
  note(item: UnbankedItem): void {
    this.movements('', item.amountEur < 0 ? 'in' : 'out', true);
  }

  freshTone(account: AccountView): string {
    if (!account.reading || account.ageDays === null) return 'tone-warn';
    return account.ageDays === 0 ? 'tone-ok' : account.ageDays <= 7 ? '' : account.ageDays <= 14 ? 'tone-warn' : 'tone-danger';
  }

  freshLabel(account: AccountView): string {
    if (!account.reading || account.ageDays === null) return 'Nog geen saldo';
    return account.ageDays === 0 ? 'Vandaag gecontroleerd' : `${account.ageDays} d geleden`;
  }

  /** The last digits of an IBAN key, so two accounts of one bank can be told apart. */
  tail(key: string): string {
    return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(key) ? key.slice(-4) : '';
  }

  stamp(asOfAt: string | null | undefined, date: string, timeZone: string | null | undefined): string {
    return asOfAt ? paymentMomentLabel({ receivedAt: asOfAt, timeZone: timeZone || 'Europe/Brussels' }) : `${dayMonth(date)}, einde dag`;
  }

  day(date: string | null): string { return dayMonth(date); }
}
