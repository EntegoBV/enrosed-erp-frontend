import { Injectable, computed, inject, signal } from '@angular/core';
import { BankingApi, BankAccount } from './banking-api';

export interface BankAccountOption {
  /** The key the bank ledger merges on (an IBAN without spaces, else the upper-cased name). */
  key: string;
  /** Staff-facing account label; writes always use key. */
  label: string;
}

/**
 * The company's bank accounts for forms outside Kosten & bank (the container
 * payment sheet): only active accounts that permit manual bank movements.
 * Refresh on each form opening because accounts may have been archived or connected.
 */
@Injectable({ providedIn: 'root' })
export class BankAccountsStore {
  private readonly banking = inject(BankingApi);
  private readonly registry = signal<readonly BankAccount[]>([]);
  private pending: Promise<void> | null = null;
  /** A fetch is in flight: a form shows 'Rekeningen laden…' instead of 'Nog geen rekening'. */
  readonly loading = signal(false);

  readonly options = computed<BankAccountOption[]>(() => this.registry()
    .filter(account => !account.archived && account.manualMovementsAllowed && account.source !== 'ODOO')
    .map(account => ({ key: account.key, label: account.label }))
    .sort((left, right) => left.label.localeCompare(right.label, 'nl')));

  /** Reuse an in-flight request; otherwise recheck current account permissions. */
  load(): Promise<void> {
    return this.pending ?? this.refresh();
  }

  refresh(): Promise<void> {
    if (!this.pending) {
      this.loading.set(true);
      this.pending = this.banking.accounts()
        .then((rows) => { this.registry.set(rows); })
        .catch(() => { /* the chips stay as they were; the form says when there is no account */ })
        .finally(() => { this.pending = null; this.loading.set(false); });
    }
    return this.pending;
  }
}
