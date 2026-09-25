import { InjectionToken, Signal } from '@angular/core';
import type { CompanyCost } from '../../core/api/models';
import type { ContextMenuItem } from '../../shared/context-menu';
import type { MenuPoint } from '../../shared/context-menu-position';
import type { FinanceCommand } from './finance-shortcuts';

/** One figure in the summary strip under the desk toolbar. */
export interface StripItem {
  label: string;
  value: string;
  tone?: 'in' | 'warn' | 'muted' | 'strong';
  title?: string;
}

/**
 * What a section tells the page around it: the figures for the strip, the
 * count for the status bar, and the keyboard commands it takes. The page
 * finds the section on screen with viewChild(FINANCE_SECTION); every section
 * provides itself under this token.
 */
export interface FinanceSectionApi {
  readonly strip: Signal<readonly StripItem[] | null>;
  readonly status: Signal<string>;
  /** Runs a keyboard command on the section's table; false when it does not apply. */
  handle(command: FinanceCommand): boolean;
  /** Company costs picked for a bulk action (Te betalen, Uitgaven › Bedrijfskosten). */
  readonly selectedCosts?: Signal<readonly CompanyCost[]>;
  /** True while the selection toolbar replaces the tools. */
  readonly selecting?: Signal<boolean>;
  clearSelection?(): void;
  /** 'Exporteer CSV' for what the section shows; without it the page exports this year's costs. */
  exportCsv?(): void;
}

export const FINANCE_SECTION = new InjectionToken<FinanceSectionApi>('FinanceSection');

/**
 * A context menu or action sheet, opened by a row or a toolbar button and
 * rendered once at page level: inside the scrolling pane (a size container)
 * or a swiped row it would be trapped.
 */
export interface FinanceMenu {
  title?: string;
  items: ContextMenuItem[];
  anchor: MenuPoint | null;
  cancelLabel?: string;
  pick: (id: string) => void;
}
