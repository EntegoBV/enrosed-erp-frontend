import { Injectable, signal } from '@angular/core';

/** What waits per place: the sidebar pills on a desk, the tab badges on a phone. */
export interface FinanceCounts {
  /** Rows due now in Te betalen; amber once a cost is older than 30 days or a container term is due. */
  open: number;
  openWarn: boolean;
  /** Invoices open for more than 30 days. */
  incoming: number;
  /** Bank: accounts without a reading plus stale readings. */
  bank: number;
  bankWarn: boolean;
  /** Transacties: lines of the active accounts still to link, both directions (booked lines are linked). */
  transactions: number;
  /** Recurring costs ready to book. */
  costs: number;
}

/** One active account under Transacties in the desk sidebar: its balance, how old it is and what is still to link. */
export interface FinanceShellAccount {
  key: string;
  label: string;
  balanceEur: number | null;
  ageDays: number | null;
  unlinked: number;
  warn: boolean;
}

/**
 * The one piece of Kosten & bank that lives outside the page: FinanceState
 * belongs to CostsPage, but the sidebar is rendered by the app shell. The
 * page publishes its counts and accounts here and clears them when it closes.
 */
@Injectable({ providedIn: 'root' })
export class FinanceShell {
  readonly counts = signal<FinanceCounts | null>(null);
  readonly accounts = signal<FinanceShellAccount[]>([]);
}
