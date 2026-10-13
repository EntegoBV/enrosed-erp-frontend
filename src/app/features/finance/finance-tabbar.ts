import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { IosTab, IosTabbar } from '../../shared/ios-tabbar';
import { FINANCE_SECTIONS } from './finance-sections';
import { FinanceShell } from './finance-shell';
import { FinanceState } from './finance-state';

/** Five full-width phone sections; creation stays in the sticky page header. */
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
    const view = this.state.location().view;
    const counts = this.shell.counts();
    const badges: Record<string, number | null> = { open: counts?.open ?? null, incoming: counts?.incoming ?? null, bank: counts?.bank ?? null, costs: counts?.costs ?? null };
    return FINANCE_SECTIONS.filter((section) => section.phoneTab).map((section) => ({
      id: section.id, label: section.short, icon: section.icon, link: '/costs',
      query: section.id === 'overview' ? {} : { view: section.id }, active: view === section.id,
      badge: badges[section.id] ?? null, badgeTone: 'warn' as const,
    }));
  });
}
