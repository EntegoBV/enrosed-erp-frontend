import { Injectable, signal } from '@angular/core';

/** What waits per section: the sidebar pills on a desk, the tab badges on a phone. */
export interface FinanceCounts {
  /** Rows due now in Te betalen; amber once a cost is older than 30 days or a container term is due. */
  open: number;
  openWarn: boolean;
  /** Invoices open for more than 30 days. */
  incoming: number;
  /** Incoming lines to link, plus accounts without a reading or with a stale one. */
  bank: number;
  bankWarn: boolean;
  /** Recurring costs ready to book. */
  costs: number;
}

/**
 * The one piece of Kosten & bank that lives outside the page: FinanceState
 * belongs to CostsPage, but the sidebar is rendered by the app shell. The
 * page publishes its counts here and clears them when it closes.
 */
@Injectable({ providedIn: 'root' })
export class FinanceShell {
  readonly counts = signal<FinanceCounts | null>(null);
}
