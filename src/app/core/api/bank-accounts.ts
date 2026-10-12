import { Injectable, computed, inject, signal } from '@angular/core';
import { bankAccountKey } from '../../features/finance/bank-reconciliation';
import { FinanceApi } from './finance-api';
import type { BankBalance } from './models';

export interface BankAccountOption {
  /** The key the bank ledger merges on (an IBAN without spaces, else the upper-cased name). */
  key: string;
  /** The name as last typed on a reading. */
  label: string;
}

/**
 * The company's bank accounts for forms outside Kosten & bank (the container
 * payment sheet): one account per key from the saldo readings, loaded once
 * per session and refreshed on request.
 */
@Injectable({ providedIn: 'root' })
export class BankAccountsStore {
  private readonly finance = inject(FinanceApi);
  private readonly balances = signal<readonly BankBalance[]>([]);
  private pending: Promise<void> | null = null;
  private loaded = false;
  /** A fetch is in flight: a form shows 'Rekeningen laden…' instead of 'Nog geen rekening'. */
  readonly loading = signal(false);

  readonly options = computed<BankAccountOption[]>(() => {
    const newestFirst = [...this.balances()].sort((left, right) => right.date.localeCompare(left.date) || (right.id ?? 0) - (left.id ?? 0));
    const byKey = new Map<string, string>();
    for (const row of newestFirst) {
      const key = bankAccountKey(row.account);
      if (key && !byKey.has(key)) byKey.set(key, row.account.trim().replace(/\s+/g, ' ') || key);
    }
    return [...byKey].map(([key, label]) => ({ key, label })).sort((left, right) => left.label.localeCompare(right.label, 'nl'));
  });

  /** Fetches the readings the first time; later calls return at once. */
  load(): Promise<void> {
    if (this.loaded) return Promise.resolve();
    return this.pending ?? this.refresh();
  }

  refresh(): Promise<void> {
    if (!this.pending) {
      this.loading.set(true);
      this.pending = this.finance.bankBalances()
        .then((rows) => { this.balances.set(rows); this.loaded = true; })
        .catch(() => { /* the chips stay as they were; the form says when there is no account */ })
        .finally(() => { this.pending = null; this.loading.set(false); });
    }
    return this.pending;
  }
}
