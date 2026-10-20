import { ChangeDetectionStrategy, Component, DestroyRef, HostListener, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TicaApi, TicaSettlement, TicaSettlementWrite } from '../../core/api/tica-api';
import { BankingApi, BankStatementLine } from '../../core/api/banking-api';
import { messageOf } from '../../core/api/errors';
import { saveBlob } from '../../core/api/download';
import { OdooImportMonitor } from '../finance/odoo-import-monitor';
import { Icon } from '../../shared/icon';
import { Sheet, Ui, confirmLeave } from '../../shared/ui';
import { Skeleton } from '../../shared/skeleton';
import { ticaDate, ticaMoment, ticaRangeError, ticaToday, validTicaDay } from './tica-format';
import { SettlementAmounts, settlementDifference, ticaBankCandidates, ticaSettlementReady } from './tica-settlement-rules';

type SettlementDraft = Omit<TicaSettlementWrite, keyof SettlementAmounts> & SettlementAmounts;
const emptyDraft = (): SettlementDraft => ({ reference: '', location: 'TICA - Brussel', documentDate: ticaToday(), dueDate: null,
  periodFrom: ticaToday(), periodTo: ticaToday(), salesExcl: null, salesVat: null, commissionExcl: null, commissionVat: null,
  netReceivable: null, documentNote: null, sourceDocumentUrl: null });

@Component({
  selector: 'app-tica-settlements',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, Icon, Sheet, Skeleton, OdooImportMonitor],
  templateUrl: './tica-settlements.html',
  styleUrl: './tica-settlements.scss',
})
export class TicaSettlements {
  private readonly api = inject(TicaApi);
  private readonly route = inject(ActivatedRoute);
  private readonly banking = inject(BankingApi);
  private readonly ui = inject(Ui);
  private readonly destroyRef = inject(DestroyRef);
  private initialDraft = '';
  readonly rows = signal<TicaSettlement[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly actionError = signal<string | null>(null);
  readonly busy = signal(false);
  readonly selected = signal<TicaSettlement | null>(null);
  readonly editing = signal(false);
  readonly draft = signal<SettlementDraft>(emptyDraft());
  readonly previewWarnings = signal<string[]>([]);
  readonly uploading = signal(false);
  readonly downloading = signal(false);
  readonly bankLoading = signal(false);
  readonly bankError = signal<string | null>(null);
  readonly bankLines = signal<BankStatementLine[]>([]);
  readonly bankChoice = signal<number | null>(null);
  readonly bankSearch = signal('');
  readonly bankOpen = signal(false);
  readonly dirty = computed(() => this.editing() && JSON.stringify(this.draft()) !== this.initialDraft);
  readonly difference = computed(() => settlementDifference(this.draft()));
  readonly candidates = computed(() => ticaBankCandidates(this.bankLines(), this.selected()?.netReceivable ?? 0, this.bankSearch()));
  readonly selectedBank = computed(() => this.candidates().find(line => line.id === this.bankChoice()) ?? null);
  readonly openTotal = computed(() => this.rows().filter(row => row.status === 'OPEN').reduce((total, row) => total + row.netReceivable, 0));
  readonly paidTotal = computed(() => this.rows().filter(row => row.status === 'PAID').reduce((total, row) => total + row.netReceivable, 0));
  readonly commissionTotal = computed(() => this.rows().filter(row => row.status !== 'DRAFT').reduce((total, row) => total + row.commissionExcl, 0));
  readonly euro = (amount: number) => new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' }).format(amount);
  readonly day = ticaDate;
  readonly moment = ticaMoment;
  readonly amountFields: { key: keyof SettlementAmounts; label: string }[] = [
    { key: 'salesExcl', label: 'Omzet na korting excl. btw' }, { key: 'salesVat', label: 'Btw op omzet' },
    { key: 'commissionExcl', label: 'Commissie excl. btw' }, { key: 'commissionVat', label: 'Btw op commissie' },
    { key: 'netReceivable', label: 'Netto te ontvangen incl. btw' },
  ];

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const id = Number(params.get('settlement'));
      if (id && !this.editing() && !this.busy()) { const row = this.rows().find(row => row.id === id); if (row) this.show(row); }
    });
    void this.reload();
  }

  @HostListener('window:beforeunload', ['$event'])
  beforeUnload(event: BeforeUnloadEvent): void {
    if (this.dirty() || this.busy() || this.uploading()) { event.preventDefault(); event.returnValue = ''; }
  }
  canDeactivate(): boolean | Promise<boolean> {
    if (this.busy() || this.uploading()) return false;
    return this.dirty() ? confirmLeave(this.ui, () => this.saveDraft()) : true;
  }
  patch<K extends keyof SettlementDraft>(key: K, value: SettlementDraft[K]): void {
    this.draft.update(draft => ({ ...draft, [key]: value }));
  }
  async reload(): Promise<void> {
    this.loading.set(true); this.error.set(null);
    try { const rows = await this.api.settlements(); if (!this.destroyRef.destroyed) { this.rows.set(rows);
      const id = Number(this.route.snapshot.queryParamMap.get('settlement'));
      if (id && !this.editing() && !this.selected()) { const row = rows.find(row => row.id === id); if (row) this.show(row); }
    } }
    catch (failure) { if (!this.destroyRef.destroyed) this.error.set(messageOf(failure, 'De TICA-afrekeningen konden niet worden geladen.')); }
    finally { if (!this.destroyRef.destroyed) this.loading.set(false); }
  }
  startNew(): void {
    this.selected.set(null); this.actionError.set(null); this.previewWarnings.set([]);
    this.draft.set(emptyDraft()); this.initialDraft = JSON.stringify(this.draft()); this.editing.set(true);
  }
  show(row: TicaSettlement): void {
    this.selected.set(row); this.actionError.set(null); this.bankOpen.set(false); this.bankChoice.set(null);
  }
  edit(): void {
    const row = this.selected(); if (!row || row.status !== 'DRAFT' || row.sourceKey || this.busy()) return;
    this.draft.set({ reference: row.reference, location: row.location, documentDate: row.documentDate, dueDate: row.dueDate,
      periodFrom: row.periodFrom, periodTo: row.periodTo, salesExcl: row.salesExcl, salesVat: row.salesVat,
      commissionExcl: row.commissionExcl, commissionVat: row.commissionVat, netReceivable: row.netReceivable,
      documentNote: row.documentNote, sourceDocumentUrl: row.sourceDocumentUrl });
    this.initialDraft = JSON.stringify(this.draft()); this.editing.set(true); this.actionError.set(null); this.previewWarnings.set([]);
  }
  async close(): Promise<void> {
    if (await this.canDeactivate()) { this.editing.set(false); this.selected.set(null); this.bankOpen.set(false); }
  }
  async upload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = '';
    if (!file || this.uploading() || this.busy()) return;
    this.uploading.set(true); this.error.set(null);
    try {
      const preview = await this.api.previewSettlementDocument(file);
      if (this.destroyRef.destroyed) return;
      this.startNew();
      const { fileName, warnings, ...values } = preview;
      this.draft.set({ ...emptyDraft(), ...values, documentNote: null });
      this.previewWarnings.set(preview.warnings ?? []);
    } catch (failure) {
      if (!this.destroyRef.destroyed) this.error.set(messageOf(failure, 'De creditnota kon niet worden ingelezen. Voeg de afrekening handmatig toe.'));
    } finally { if (!this.destroyRef.destroyed) this.uploading.set(false); }
  }
  async saveDraft(): Promise<boolean> {
    if (this.busy()) return false;
    const value = this.draft();
    const rangeError = ticaRangeError(value.periodFrom, value.periodTo);
    if (!value.reference.trim() || !value.location.trim() || !validTicaDay(value.documentDate) || (value.dueDate && !validTicaDay(value.dueDate)) || rangeError || this.difference() === null) {
      this.actionError.set(rangeError ?? 'Vul referentie, vestiging, geldige datums en alle bedragen van de creditnota in.'); return false;
    }
    this.busy.set(true); this.actionError.set(null);
    try {
      const saved = await this.api.saveSettlement(this.selected()?.id ?? null, { ...value, reference: value.reference.trim(), location: value.location.trim() } as TicaSettlementWrite);
      if (this.destroyRef.destroyed) return false;
      this.accept(saved); this.editing.set(false); this.ui.toast('TICA-afrekening als concept opgeslagen');
      return true;
    } catch (failure) { if (!this.destroyRef.destroyed) this.actionError.set(messageOf(failure, 'Opslaan van de afrekening is niet gelukt.')); return false; }
    finally { if (!this.destroyRef.destroyed) this.busy.set(false); }
  }
  confirm(): void {
    const row = this.selected(); if (!row || row.status !== 'DRAFT' || this.busy()) return;
    this.ui.confirm({ title: 'Afrekening boeken',
      message: `Leg ${this.euro(row.commissionExcl)} commissie excl. btw vast als verrekende kost. Er blijft ${this.euro(row.netReceivable)} te ontvangen van TICA. De geïmporteerde omzet telt één keer mee.`, confirmLabel: 'Boeken' },
      () => void this.perform(() => this.api.confirmSettlement(row.id), 'TICA-afrekening geboekt'));
  }
  canConfirm(row: TicaSettlement): boolean {
    return ticaSettlementReady(row);
  }
  statusLabel(row: TicaSettlement): string {
    return row.status === 'DRAFT' ? row.sourceKey ? 'Te controleren' : 'Concept' : row.status === 'PAID' ? 'Ontvangen' : 'Te ontvangen';
  }
  async openBank(): Promise<void> {
    this.bankOpen.set(true); this.bankChoice.set(null); this.bankSearch.set('');
    await this.reloadBank();
  }
  async reloadBank(): Promise<void> {
    this.bankLoading.set(true); this.bankError.set(null);
    try { const rows = await this.banking.list(); if (!this.destroyRef.destroyed) this.bankLines.set(rows); }
    catch (failure) { if (!this.destroyRef.destroyed) this.bankError.set(messageOf(failure, 'Bankontvangsten konden niet worden geladen.')); }
    finally { if (!this.destroyRef.destroyed) this.bankLoading.set(false); }
  }
  linkBank(): void {
    const row = this.selected(), bank = this.selectedBank(); if (!row || !bank || this.busy()) return;
    this.ui.confirm({ title: 'Bankontvangst koppelen', message: `${this.euro(bank.amountEur)} op ${this.day(bank.bookedAt.slice(0, 10))} · ${bank.counterparty || bank.reference || bank.account}. Koppelen aan TICA-afrekening ${row.reference}?`, confirmLabel: 'Koppelen' },
      () => void this.perform(() => this.api.linkSettlementBank(row.id, bank.id), 'Bankontvangst aan TICA gekoppeld'));
  }
  unlinkBank(): void {
    const row = this.selected(); if (!row?.bankStatementLineId || this.busy()) return;
    this.ui.confirm({ title: 'Bankontvangst loskoppelen', message: 'De afrekening wordt weer te ontvangen. De banktransactie blijft bestaan en kan opnieuw worden gekoppeld.', confirmLabel: 'Loskoppelen' },
      () => void this.perform(() => this.api.unlinkSettlementBank(row.id), 'Bankontvangst losgekoppeld'));
  }
  async download(row: Pick<TicaSettlement, 'sourceDocumentUrl' | 'reference'>): Promise<void> {
    if (!row.sourceDocumentUrl || this.downloading()) return;
    this.downloading.set(true); this.actionError.set(null);
    try { const blob = await this.api.settlementDocument(row.sourceDocumentUrl);
      saveBlob(blob, `TICA-${row.reference || 'creditnota'}.${blob.type.toLowerCase().includes('xml') ? 'xml' : 'pdf'}`); }
    catch (failure) { if (!this.destroyRef.destroyed) this.actionError.set(messageOf(failure, 'De creditnota kon niet worden gedownload.')); }
    finally { if (!this.destroyRef.destroyed) this.downloading.set(false); }
  }
  private accept(row: TicaSettlement): void {
    this.selected.set(row);
    this.rows.update(rows => [row, ...rows.filter(item => item.id !== row.id)].sort((a, b) => b.documentDate.localeCompare(a.documentDate) || b.id - a.id));
  }
  private async perform(action: () => Promise<TicaSettlement>, notice: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true); this.actionError.set(null);
    try { const row = await action(); if (!this.destroyRef.destroyed) { this.accept(row); this.bankOpen.set(false); this.ui.toast(notice); } }
    catch (failure) { if (!this.destroyRef.destroyed) this.actionError.set(messageOf(failure, 'De afrekening kon niet worden bijgewerkt.')); }
    finally { if (!this.destroyRef.destroyed) this.busy.set(false); }
  }
}
