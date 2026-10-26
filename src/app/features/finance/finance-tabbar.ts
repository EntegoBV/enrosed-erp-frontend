import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { IosTab, IosTabbar } from '../../shared/ios-tabbar';
import { FINANCE_NAV, phoneTabOf } from './finance-sections';
import { FinanceShell } from './finance-shell';
import { FinanceState } from './finance-state';
import { DEFAULT_LOCATION, financeQueryParams, patchLocation } from './finance-url';

/** Five full-width phone places, Bank · Transacties · Betalen · Ontvangen · Kosten; creation stays in the sticky page header. */
@Component({
  selector: 'app-finance-tabbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IosTabbar],
  template: `
    <app-ios-tabbar label="Onderdelen van Kosten en bank" [tabs]="tabs()" />
  `,
})
export class FinanceTabbar {
  private readonly state = inject(FinanceState);
  private readonly shell = inject(FinanceShell);

  readonly tabs = computed<IosTab[]>(() => {
    /* Facturen lights Kosten, where its phone entry is. */
    const active = phoneTabOf(this.state.location());
    const counts = this.shell.counts();
    const badges: Record<string, number | null> = { bank: counts?.bank ?? null, transactions: counts?.transactions ?? null, open: counts?.open ?? null,
      incoming: counts?.incoming ?? null, costs: counts?.costs ?? null };
    return FINANCE_NAV.filter((item) => item.phoneTab).map((item) => ({
      id: item.id, label: item.short, icon: item.icon, link: '/costs',
      query: financeQueryParams(patchLocation(DEFAULT_LOCATION, item.target)), active: active === item.id,
      badge: badges[item.id] || null, badgeTone: 'warn' as const,
    }));
  });
}
