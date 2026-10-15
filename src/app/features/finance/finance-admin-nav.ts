import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { BrandMark } from '../../shared/brand-mark';
import { Icon } from '../../shared/icon';
import { WkSideFoot } from '../../shared/wk-side-foot';
import { FINANCE_GROUPS, FINANCE_NAV, financeNavOf } from './finance-sections';
import type { FinanceNavId, FinanceNavItem } from './finance-sections';
import { FinanceShell } from './finance-shell';
import type { FinanceShellAccount } from './finance-shell';
import { financeQueryParams, parseFinanceLocation, patchLocation, DEFAULT_LOCATION } from './finance-url';

const euro = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
const ACCOUNT_TONES = ['tone-blue', 'tone-teal', 'tone-amber', 'tone-plum', 'tone-green', 'tone-grey'];

/**
 * The dark sidebar of Kosten & bank on a desk (a rail from 680 to 899px),
 * rendered by the app shell outside the page's FinanceState: it reads the
 * place from the address and the counts and accounts from FinanceShell.
 * Bank · Transacties (one row per active account, with its balance and how
 * old it is) · Te betalen · Te ontvangen · Inkoop & kosten · Rapportage.
 * Places are places, not history: the links replace the entry.
 */
@Component({
  selector: 'app-finance-admin-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'display: contents' },
  imports: [BrandMark, Icon, RouterLink, WkSideFoot],
  template: `
    <aside class="wk-side" aria-label="Kosten en bank">
      <header class="wk-side__brand"><app-brand-mark subtitle="Kosten & bank" /></header>
      <nav class="wk-side__nav" aria-label="Onderdelen van Kosten en bank">
        @for (group of groups; track group) {
          <span class="wk-side__label">{{ group }}</span>
          @for (item of itemsOf(group); track item.id) {
            <a class="wk-side__item" routerLink="/costs" [queryParams]="queryOf(item)" [replaceUrl]="true" [title]="item.hint"
               [class.active]="active() === item.id" [class.is-open]="item.id === 'transactions' && !!account()" [attr.aria-current]="active() === item.id ? 'page' : null"
               [attr.aria-label]="countOf(item.id) ? item.label + ', ' + countOf(item.id) + ' open' : null">
              <app-icon [name]="item.icon" [size]="18" />
              <span class="wk-side__text">{{ item.label }}</span><span class="wk-side__short">{{ item.short }}</span>
              @if (countOf(item.id); as count) {
                <span class="wk-side__count" [class.wk-side__count--warn]="warnOf(item.id)">{{ count }}</span>
                <i class="wk-side__dot" [class.wk-side__dot--warn]="warnOf(item.id)" aria-hidden="true"></i>
              }
            </a>
            @if (item.id === 'transactions') {
              @for (row of shell.accounts(); track row.key; let index = $index) {
                <a class="wk-side__item fin-side-account" routerLink="/costs" [queryParams]="accountQuery(row.key)" [replaceUrl]="true"
                   [class.active]="account() === row.key" [attr.aria-current]="account() === row.key ? 'page' : null"
                   [attr.aria-label]="row.label + (row.unlinked ? ', ' + row.unlinked + ' te koppelen' : ', alles gekoppeld')">
                  <i [class]="'wk-dot ' + tone(index)" aria-hidden="true"></i>
                  <span class="fin-side-account__text"><span class="fin-side-account__label">{{ row.label }}</span>
                    <small [class.is-warn]="(row.ageDays ?? 0) > 14">{{ balanceLine(row) }}</small></span>
                  @if (row.unlinked) { <span class="wk-side__count" [class.wk-side__count--warn]="row.warn">{{ row.unlinked }}</span> }
                  @else { <span class="fin-side-account__ok" aria-hidden="true">✓</span> }
                </a>
              }
            }
          }
        }
      </nav>
      <app-wk-side-foot />
    </aside>
  `,
})
export class FinanceAdminNav {
  private readonly router = inject(Router);
  readonly shell = inject(FinanceShell);
  readonly groups = FINANCE_GROUPS;

  private readonly url = toSignal(this.router.events.pipe(
    filter((event): event is NavigationEnd => event instanceof NavigationEnd),
    map(() => this.router.url),
  ), { initialValue: this.router.url });

  private readonly location = computed(() => {
    const params = new URLSearchParams(this.url().split('?')[1] ?? '');
    return parseFinanceLocation((key) => params.get(key));
  });
  /** The account of Transacties with account=; its row is active and Transacties shows as open. */
  readonly account = computed(() => {
    const location = this.location();
    return location.view === 'bank' && location.tab === 'movements' ? location.account : '';
  });
  readonly active = computed<FinanceNavId | null>(() => (this.account() ? null : financeNavOf(this.location()).id));

  itemsOf(group: string): FinanceNavItem[] {
    return FINANCE_NAV.filter((item) => item.group === group);
  }

  queryOf(item: FinanceNavItem): Record<string, string> {
    return financeQueryParams(patchLocation(DEFAULT_LOCATION, item.target));
  }

  accountQuery(key: string): Record<string, string> {
    return financeQueryParams(patchLocation(DEFAULT_LOCATION, { view: 'bank', tab: 'movements', account: key }));
  }

  countOf(id: FinanceNavId): number {
    const counts = this.shell.counts();
    if (!counts) return 0;
    return id === 'open' ? counts.open : id === 'incoming' ? counts.incoming : id === 'bank' ? counts.bank : id === 'transactions' ? counts.transactions
      : id === 'costs' ? counts.costs : 0;
  }

  warnOf(id: FinanceNavId): boolean {
    const counts = this.shell.counts();
    return id === 'open' ? !!counts?.openWarn : id === 'bank' ? !!counts?.bankWarn : id === 'transactions' ? (counts?.transactions ?? 0) > 0 : false;
  }

  /** '€ 32.365,27 · 5 d oud', or 'Nog geen saldo'. */
  balanceLine(row: FinanceShellAccount): string {
    if (row.balanceEur === null) return 'Nog geen saldo';
    return euro.format(row.balanceEur) + (row.ageDays !== null && row.ageDays >= 1 ? ` · ${row.ageDays} d oud` : '');
  }

  tone(index: number): string { return ACCOUNT_TONES[index % ACCOUNT_TONES.length]; }
}
