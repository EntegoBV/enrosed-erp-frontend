import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { IosTab, IosTabbar } from '../../shared/ios-tabbar';
import { HOST_SYMBOLS } from '../../core/platform/host-symbols';
import type { HostTab } from '../../core/platform/host';
import { FINANCE_NAV, phoneTabOf } from './finance-sections';
import type { FinanceLocation } from './finance-url';
import { FinanceCounts, FinanceShell } from './finance-shell';
import { FinanceState } from './finance-state';
import { DEFAULT_LOCATION, financeQueryParams, patchLocation } from './finance-url';

/** The badge per phone place: what waits there (the warn tone on every badge). */
function financeBadges(counts: FinanceCounts | null): Record<string, number | null> {
  return { bank: counts?.bank ?? null, transactions: counts?.transactions ?? null, open: counts?.open ?? null, incoming: counts?.incoming ?? null, costs: counts?.costs ?? null };
}

/** The five phone places as the native host's workspace tabs (enrosed-erp-ios). */
export function financeHostTabs(location: FinanceLocation, counts: FinanceCounts | null): HostTab[] {
  const active = phoneTabOf(location);
  const badges = financeBadges(counts);
  return FINANCE_NAV.filter((item) => item.phoneTab).map((item) => {
    const query = new URLSearchParams(financeQueryParams(patchLocation(DEFAULT_LOCATION, item.target))).toString();
    const tab: HostTab = { id: item.id, label: item.short, icon: item.icon, symbol: HOST_SYMBOLS[item.icon] ?? 'circle.dashed', active: active === item.id, url: query ? `/costs?${query}` : '/costs' };
    const badge = badges[item.id];
    if (badge) { tab.badge = badge; tab.warn = true; }
    return tab;
  });
}

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
    const badges = financeBadges(this.shell.counts());
    return FINANCE_NAV.filter((item) => item.phoneTab).map((item) => ({
      id: item.id, label: item.short, icon: item.icon, link: '/costs',
      query: financeQueryParams(patchLocation(DEFAULT_LOCATION, item.target)), active: active === item.id,
      badge: badges[item.id] || null, badgeTone: 'warn' as const,
    }));
  });
}
