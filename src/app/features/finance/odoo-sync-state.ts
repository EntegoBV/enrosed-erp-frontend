import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { messageOf } from '../../core/api/errors';
import { OdooApi } from '../../core/api/odoo-api';
import type { OdooBankSyncResult, OdooConnectionStatus } from '../../core/api/odoo-api';
import { Ui } from '../../shared/ui';
import { FinanceState } from './finance-state';

/**
 * The bank import from Odoo for the whole page (spec-bank-forecast §3): its
 * status, "Transacties ophalen" and its result. The toolbar button, the
 * phone ⋯ item, the status bar and the Odoo-verbinding sheet all read it, so
 * an import still refreshes the bank after the sheet that started it closed.
 * Provided by CostsPage, next to FinanceState.
 */
@Injectable()
export class OdooSyncState {
  private readonly api = inject(OdooApi);
  private readonly finance = inject(FinanceState);
  private readonly ui = inject(Ui);
  private readonly destroyRef = inject(DestroyRef);

  readonly status = signal<OdooConnectionStatus | null>(null);
  readonly loading = signal(true);
  readonly checking = signal(false);
  readonly syncing = signal(false);
  readonly error = signal('');
  readonly syncResult = signal<OdooBankSyncResult | null>(null);
  /** The Odoo-verbinding sheet (desk ⋯, phone ⋯, the toast's "Details", "Odoo: controle nodig ›"). */
  readonly sheetOpen = signal(false);
  /** The documents part of the panel reports its own failures here, so "controle nodig" covers them too. */
  readonly documentsError = signal('');

  readonly ready = computed(() => !!this.status()?.enabled && !!this.status()?.configured);
  /** A failed scheduled attempt must never look like a successful bank import. */
  readonly lastSuccessAt = computed(() => {
    const status = this.status();
    return status?.autoBankSync ? status.autoBankSync.lastSuccessAt : status?.lastSyncAt ?? null;
  });
  readonly busy = computed(() => this.loading() || this.checking() || this.syncing());
  /** Something to look at: a failure, an incomplete import, conflicts, skipped lines, or a connection still to set up. */
  readonly attention = computed(() => {
    if (this.error() || this.documentsError()) return true;
    const result = this.syncResult();
    return (!this.loading() && !this.ready()) || !!(result && (!result.complete || result.conflicts > 0 || result.skippedNonEur > 0));
  });

  constructor() {
    void this.refreshStatus();
  }

  async refreshStatus(): Promise<void> {
    try {
      const result = await this.api.status();
      if (this.destroyRef.destroyed) return;
      this.status.set(result);
      this.syncResult.set(result.lastSync);
    } catch (failure) {
      if (!this.destroyRef.destroyed) this.error.set(messageOf(failure, 'De Odoo-status ophalen is niet gelukt.'));
    } finally {
      if (!this.destroyRef.destroyed) this.loading.set(false);
    }
  }

  async checkConnection(): Promise<void> {
    if (this.busy()) return;
    this.checking.set(true);
    this.error.set('');
    try {
      const result = this.ready() ? await this.api.check() : await this.api.status();
      if (this.destroyRef.destroyed) return;
      this.status.set(result);
      this.syncResult.set(result.lastSync);
    } catch (failure) {
      if (!this.destroyRef.destroyed) this.error.set(messageOf(failure, 'De verbinding met Odoo controleren is niet gelukt.'));
    } finally {
      if (!this.destroyRef.destroyed) this.checking.set(false);
    }
  }

  /** "Transacties ophalen": the import, the shared bank refreshed, the result as a toast ("Details" when it needs a look). */
  async syncBank(): Promise<void> {
    if (!this.ready() || this.busy()) return;
    this.syncing.set(true);
    this.error.set('');
    this.syncResult.set(null);
    try {
      const result = await this.api.syncBank();
      await this.finance.refreshBank();
      if (this.destroyRef.destroyed) return;
      this.syncResult.set(result);
      const warn = !result.complete || result.conflicts > 0 || result.skippedNonEur > 0;
      this.ui.toast(syncNotice(result), warn ? 'err' : 'ok', warn ? { label: 'Details', run: () => this.sheetOpen.set(true) } : undefined);
      // The last import time comes from the server, never the browser's clock.
      const status = await this.api.status();
      if (!this.destroyRef.destroyed) this.status.set(status);
    } catch (failure) {
      if (this.destroyRef.destroyed) return;
      const text = messageOf(failure, 'Banktransacties ophalen is niet gelukt. Probeer opnieuw.');
      this.error.set(text);
      this.ui.toast(text, 'err', { label: 'Details', run: () => this.sheetOpen.set(true) });
    } finally {
      if (!this.destroyRef.destroyed) this.syncing.set(false);
    }
  }
}

/** "Import afgerond · 3 nieuw · 1 bijgewerkt · 240 ongewijzigd · 1 beweging vraagt controle · 2 in een andere munt niet overgenomen". */
export function syncNotice(result: OdooBankSyncResult): string {
  const parts = [result.complete ? 'Import afgerond' : 'Import nog niet volledig',
    `${result.created} nieuw`, `${result.updated} bijgewerkt`, `${result.unchanged} ongewijzigd`];
  if (result.conflicts) parts.push(`${result.conflicts} ${result.conflicts === 1 ? 'beweging vraagt' : 'bewegingen vragen'} controle`);
  if (result.skippedNonEur) parts.push(`${result.skippedNonEur} in een andere munt niet overgenomen`);
  return parts.join(' · ');
}
