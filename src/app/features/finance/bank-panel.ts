import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, forwardRef, inject, untracked, viewChild } from '@angular/core';
import { Icon } from '../../shared/icon';
import { EurPipe } from '../../shared/pipes';
import { bankAccountKey } from './bank-reconciliation';
import { BankMovementPanel } from './bank-movement-panel';
import { bankMarker } from './bank-markers';
import { paymentPayeeLabel } from './cost-ledger';
import { dayMonth } from './finance-format';
import { FINANCE_SECTION, FinanceSectionApi, StripItem } from './finance-section';
import type { FinanceCommand } from './finance-shortcuts';
import { FinanceState, formatEuro } from './finance-state';
import type { CostLedgerRow } from './cost-ledger';
import { paymentMomentLabel } from './incoming-money';

type AccountView = FinanceState['accountsView'] extends () => (infer T)[] ? T : never;

/**
 * Bank: only accounts and movements. Rekeningen answers "klopt mijn
 * banksaldo?" per account; Bewegingen is the movement list, whose filters
 * follow the address both ways.
 */
@Component({
  selector: 'app-bank-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: FINANCE_SECTION, useExisting: forwardRef(() => BankPanel) }],
  imports: [Icon, EurPipe, BankMovementPanel],
  template: `
    @if (state.location().tab === 'movements') {
      <app-bank-movement-panel />
    } @else if (state.desk()) {
      <header class="fin-bank-head">
        <span class="fin-bank-head__label">Totaal op de bank</span>
        <strong class="fin-bank-head__value">{{ known() ? (state.currentBankEur() | eur) : '—' }}</strong>
        <span class="fin-bank-head__sub">{{ headSub() }}</span>
      </header>
      @if (state.accountsView().length) {
        <div class="fin-accounts">
          @for (account of state.accountsView(); track account.account) {
            <article class="fin-account">
              <div class="fin-account__top">
                <span class="fin-account__name"><b>{{ account.label }}</b>@if (tail(account.account); as tail) { <small>…{{ tail }}</small> }</span>
                <span [class]="'wk-pill ' + freshTone(account)">{{ freshLabel(account) }}</span>
                <button class="wk-btn wk-btn--ghost wk-btn--icon wk-btn--sm" type="button" aria-label="Meer over deze rekening" (click)="accountMenu(account, $event)"><app-icon name="more" [size]="16" /></button>
              </div>
              <strong class="fin-account__value">{{ account.currentEur === null ? 'Nog geen saldo' : (account.currentEur | eur) }}</strong>
              @if (account.reading; as reading) {
                <dl class="wk-equation">
                  <div><dt>Saldo {{ stamp(reading.asOfAt, reading.date, reading.timeZone) }}</dt><dd>{{ reading.balanceEur | eur }}</dd></div>
                  <div class="is-sub"><dt><span class="wk-equation__op">+</span>{{ account.movements.length }} {{ account.movements.length === 1 ? 'beweging' : 'bewegingen' }}</dt><dd>{{ account.deltaEur | eur }}</dd></div>
                </dl>
              }
              <div class="fin-account__actions">
                <button class="wk-btn" type="button" (click)="state.checkOrFill(account.account)">{{ account.reading ? 'Klopt het saldo?' : 'Saldo invullen' }}</button>
                <button class="wk-btn" type="button" (click)="state.openMovement({ accountKey: account.account })">Beweging noteren</button>
              </div>
            </article>
          }
          <button class="fin-account fin-account--add" type="button" (click)="state.openBank(null)"><app-icon name="plus" [size]="18" />Rekening toevoegen</button>
        </div>
      } @else {
        <div class="wk-empty"><span class="wk-empty__icon"><app-icon name="bank" [size]="22" /></span><p class="wk-empty__title">Nog geen rekening</p>
          <p class="wk-empty__text">Vul het saldo uit je bankapp in.</p><div class="wk-empty__actions"><button class="wk-btn wk-btn--primary" type="button" (click)="state.openBank(null)">Saldo invullen</button></div></div>
      }
      @if (state.unbanked().length) {
        <section class="wk-card fin-unbanked">
          <header class="wk-card__head"><h2 class="wk-card__title">Nog niet op de bank ({{ state.unbanked().length }})</h2></header>
          <p class="fin-hint">Betaald gezet, maar geen bankbeweging gevonden na je laatste saldocontrole.</p>
          <div class="wk-table fin-table fin-table--unbanked" role="table">
            <div class="wk-thead" role="row"><span class="wk-th">Betaald op</span><span class="wk-th">Wat</span><span class="wk-th" data-hide="xs">Soort</span><span class="wk-th wk-th--num">Bedrag</span><span class="wk-th"></span></div>
            @for (item of state.unbanked(); track item.row.key) {
              <div class="wk-tr" role="row">
                <span class="wk-td">{{ day(item.paidOn) }}</span>
                <span class="wk-td">{{ item.row.description }}<span class="wk-td__sub">{{ item.row.cost ? item.row.party : item.row.reference }}</span></span>
                <span class="wk-td" data-hide="xs"><span class="wk-pill" [class.tone-teal]="!!item.row.cost" [class.tone-blue]="!item.row.cost">{{ item.row.cost ? 'Kost' : 'Container' }}</span></span>
                <span class="wk-td wk-td--num">{{ item.amountEur | eur }}</span>
                <span class="wk-td fin-td-end"><button class="wk-btn wk-btn--sm" type="button" (click)="note(item.row)">Noteren</button></span>
              </div>
            }
          </div>
        </section>
      }
    } @else {
      <div class="ios-card fin-ios-total"><span class="ios-hero__label">Op de bank</span><strong>{{ known() ? (state.currentBankEur() | eur) : '—' }}</strong><small>{{ headSub() }}</small></div>
      @for (account of state.accountsView(); track account.account) {
        <article class="ios-card ios-wallet">
          <div class="ios-wallet__top"><span>{{ account.label }}</span><span [class]="'wk-pill ' + freshTone(account)">{{ freshLabel(account) }}</span></div>
          <div class="ios-wallet__value">{{ account.currentEur === null ? 'Nog geen saldo' : (account.currentEur | eur) }}</div>
          @if (account.reading; as reading) {
            <div class="ios-wallet__sub">Saldo {{ day(reading.date) }} {{ reading.balanceEur | eur }} · + {{ account.movements.length }} {{ account.movements.length === 1 ? 'beweging' : 'bewegingen' }}</div>
          }
          <div class="ios-wallet__actions">
            <button class="ios-capsule ios-capsule--tinted ios-capsule--sm" type="button" (click)="state.checkOrFill(account.account)">{{ account.reading ? 'Klopt het saldo?' : 'Saldo invullen' }}</button>
            <button class="ios-capsule ios-capsule--tinted ios-capsule--sm" type="button" (click)="state.openMovement({ accountKey: account.account })">Beweging</button>
          </div>
          <button class="fin-wallet-link" type="button" (click)="state.historyAccount.set(account.account)">Saldogeschiedenis <app-icon name="chevron-right" [size]="14" /></button>
        </article>
      }
      <div class="ios-group fin-ios-add"><button class="ios-cell ios-cell--action" type="button" (click)="state.openBank(null)"><app-icon name="plus" [size]="18" />Rekening toevoegen</button></div>
      @if (state.unbanked().length) {
        <section class="ios-section">
          <div class="ios-section__head"><h2>Nog niet op de bank</h2><span class="ios-section__trail">{{ unbankedEur() | eur }}</span></div>
          <div class="ios-group">
            @for (item of state.unbanked(); track item.row.key) {
              <div class="ios-cell">
                <span class="ios-cell__body"><span class="ios-cell__title">{{ item.row.description }}</span><span class="ios-cell__sub">{{ day(item.paidOn) }} · {{ item.row.cost ? 'Kost' : 'Container' }} · {{ item.amountEur | eur }}</span></span>
                <button class="ios-capsule ios-capsule--tinted ios-capsule--sm" type="button" (click)="note(item.row)">Noteer</button>
              </div>
            }
          </div>
          <p class="ios-section__foot">Betaald gezet, maar geen bankbeweging gevonden na je laatste saldocontrole.</p>
        </section>
      }
      <p class="fin-ios-foot"><button class="ios-section__link" type="button" (click)="state.helpOpen.set(true)">Hoe werkt je banksaldo?</button></p>
    }
  `,
})
export class BankPanel implements FinanceSectionApi {
  readonly state = inject(FinanceState);
  readonly movementPanel = viewChild(BankMovementPanel);

  readonly known = computed(() => this.state.bankLedger().accounts.some((account) => account.currentEur !== null));
  readonly unbankedEur = computed(() => Math.round(this.state.unbanked().reduce((sum, row) => sum + row.amountEur * 100, 0)) / 100);
  readonly headSub = computed(() => {
    const ages = this.state.accountsView().map((account) => account.ageDays).filter((age): age is number => age !== null);
    if (!ages.length) return 'Nog geen saldo ingevuld';
    const newest = Math.min(...ages);
    return `Berekend uit je saldo's en bewegingen · laatst gecontroleerd ${newest === 0 ? 'vandaag' : newest === 1 ? 'gisteren' : newest + ' dagen geleden'}`;
  });

  readonly strip = computed<StripItem[] | null>(() => {
    const panel = this.movementPanel();
    if (this.state.location().tab !== 'movements' || !panel) return null;
    const totals = panel.totals();
    return [
      { label: 'In', value: formatEuro(totals.incoming), tone: 'in' },
      { label: 'Uit', value: formatEuro(totals.outgoing) },
      { label: 'Netto', value: formatEuro(totals.net), tone: 'strong' },
    ];
  });
  readonly status = computed(() => {
    const panel = this.movementPanel();
    if (this.state.location().tab === 'movements' && panel) return `${panel.filteredLines().length} van ${this.state.bankStatements().length} bewegingen`;
    const count = this.state.accountsView().length;
    return `${count} ${count === 1 ? 'rekening' : 'rekeningen'}`;
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
        const account = location.account ? bankAccountKey(location.account) : '';
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
        { id: 'history', label: 'Saldogeschiedenis', iconName: 'recent' },
        ...(account.reading ? [{ id: 'fix', label: 'Saldo corrigeren', iconName: 'pencil' }] : []),
      ],
      pick: (id) => (id === 'history' ? this.state.historyAccount.set(account.account) : this.state.openBank(account.reading)) });
  }

  /** 'Noteren': the movement form prefilled with the amount, the day and the marker. */
  note(row: CostLedgerRow): void {
    if (row.cost) {
      this.state.openMovement(this.state.costMovement(row.cost));
      return;
    }
    const payment = row.payment!;
    const marker = bankMarker('containerbetaling', payment.id);
    this.state.openMovement({ direction: 'OUTGOING', amount: row.amountEur, day: payment.paidOn, counterparty: paymentPayeeLabel(payment.payee),
      reference: `${[payment.orderNumber, payment.label].filter(Boolean).join(' · ')} · ${marker}`.replace(/^ · /, '') });
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
