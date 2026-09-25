import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { IosTab, IosTabbar } from '../../shared/ios-tabbar';
import { FINANCE_SECTIONS } from './finance-sections';
import { FinanceShell } from './finance-shell';
import { FinanceState } from './finance-state';

/** The phone tab bar: five sections (Analyse sits in ⋯), their counts as badges, and '+' beside it. */
@Component({
  selector: 'app-finance-tabbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IosTabbar],
  template: `
    <app-ios-tabbar label="Onderdelen van Kosten en bank" [tabs]="tabs()" accessoryIcon="plus" accessoryLabel="Toevoegen" (accessory)="add.emit()" />
  `,
})
export class FinanceTabbar {
  private readonly state = inject(FinanceState);
  private readonly shell = inject(FinanceShell);
  readonly add = output<void>();

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
