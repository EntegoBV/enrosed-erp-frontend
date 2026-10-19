import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { OdooApi, OdooLincStatus, OdooTicaStatus } from '../../core/api/odoo-api';
import { Icon } from '../../shared/icon';

const REASONS: Record<string, string> = {
  READY: 'Verwerkt', REGISTERED: 'Kost geboekt', ALREADY_REGISTERED: 'Al geboekt', WAITING_FOR_BANK: 'Wacht op passende banktransactie',
  STRUCTURED_REFERENCE_MISSING: 'Gestructureerde betalingsreferentie ontbreekt', LINC_REVIEW: 'Linc-documenten vragen controle',
  DOCUMENT_MISSING: 'Brondocument ontbreekt', MISSING_DOCUMENT: 'Brondocument ontbreekt', UNSUPPORTED_DOCUMENT: 'Document vraagt handmatige controle',
  AMBIGUOUS_BANK: 'Meerdere banktransacties passen', REVIEW_EXISTING_COST: 'Bestaande kost controleren', ALREADY_COST: 'Document staat al bij de kosten',
  AMOUNT_OR_REFERENCE_MISMATCH: 'Bedrag of referentie wijkt af', AMBIGUOUS_DOCUMENT: 'Meerdere documenten passen',
  SOURCE_CHANGED: 'Brondocument gewijzigd; controle nodig', SOURCE_UNAVAILABLE: 'Brondocument tijdelijk niet beschikbaar',
  UNAVAILABLE: 'Odoo tijdelijk niet beschikbaar', LINC_COMPANY_MISMATCH: 'Bedrijfsgegevens komen niet overeen',
};

/** Visible receipts of the server's automatic import; reviewing a conflict stays a separate explicit action. */
@Component({
  selector: 'app-odoo-import-monitor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, RouterLink],
  template: `
    <section class="import-monitor" [attr.aria-label]="title()">
      <div class="import-head"><app-icon name="repeat" [size]="16" /><strong>{{ title() }}</strong><button type="button" [disabled]="loading()" (click)="reload()" aria-label="Importstatus vernieuwen"><app-icon name="refresh" [size]="15" /></button></div>
      @if (error()) { <p class="import-warning" role="status">Importstatus niet beschikbaar. Vernieuw om de automatische verwerking te controleren.</p> }
      @else if (state(); as state) {
        <p>{{ state.enabled ? 'Elke 12 uur automatisch controleren in Odoo.' : 'Automatische documentimport staat uit.' }}</p>
        <p class="import-meta">Laatste geslaagde controle: {{ state.lastSuccessAt ? moment(state.lastSuccessAt) : 'nog niet uitgevoerd' }}@if (state.enabled && state.nextRunAt) {<br />Volgende controle: {{ moment(state.nextRunAt) }}}</p>
        @if (issueCode()) { <p class="import-warning">{{ reason(issueCode()!) }}</p> }
        @if (pending().length) {
          <details open><summary>{{ pending().length }} {{ pending().length === 1 ? 'document vraagt' : 'documenten vragen' }} controle</summary>
            <ul>@for (row of pending(); track row.id) {<li><div><strong>{{ row.reference || 'Document ' + row.id }}</strong><span>{{ reason(row.code) }}</span></div>
              @if (row.settlementId) {<a routerLink="/tica" [queryParams]="{ settlement: row.settlementId }">Afrekening ›</a>}
              @if (row.companyCostId) {<a routerLink="/costs" [queryParams]="{ view: 'costs', cost: row.companyCostId }">Kost ›</a>}
            </li>}</ul>
          </details>
        } @else if (state.lastSuccessAt) { <p class="import-meta">Geen documenten in afwachting van controle.</p> }
      } @else if (loading()) { <p>Importstatus ophalen…</p> }
    </section>
  `,
  styles: [`
    :host { display: block; }
    .import-monitor { border: 1px solid var(--line); background: var(--surface-2); border-radius: 12px; padding: 14px; font-size: 12px; }
    .import-head { display: flex; align-items: center; gap: 8px; color: var(--ink-2); }
    .import-head strong { flex: 1; }
    .import-head button { display: grid; place-items: center; width: 34px; height: 34px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); color: var(--ink-2); cursor: pointer; }
    button:disabled { opacity: .5; cursor: default; }
    button:focus-visible, a:focus-visible, summary:focus-visible { outline: 2px solid var(--rose); outline-offset: 3px; }
    p { margin: 7px 0 0; line-height: 1.6; }
    .import-meta { color: var(--muted); font-size: 11px; }
    .import-warning { color: var(--warn); }
    details { margin-top: 12px; border-top: 1px solid var(--line); padding-top: 12px; }
    summary { color: var(--warn); font-weight: 650; cursor: pointer; }
    ul { list-style: none; padding: 0; margin: 6px 0 0; }
    li { display: flex; gap: 8px 14px; align-items: center; flex-wrap: wrap; border-top: 1px solid var(--line); padding: 10px 0; }
    li:first-child { border-top: 0; }
    li div { flex: 1 1 180px; overflow-wrap: anywhere; }
    li span { display: block; color: var(--muted); margin-top: 4px; font-size: 11px; }
    a { color: var(--rose-dark); text-decoration: none; }
  `],
})
export class OdooImportMonitor implements OnInit {
  private readonly api = inject(OdooApi);
  private readonly destroyRef = inject(DestroyRef);
  readonly kind = input.required<'tica' | 'linc'>();
  readonly title = computed(() => this.kind() === 'tica' ? 'TICA-creditnota’s via Odoo' : 'Linc-facturen via Odoo');
  readonly state = signal<OdooTicaStatus | OdooLincStatus | null>(null);
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly issueCode = computed(() => {
    const state = this.state();
    if (!state?.enabled || !state.lastCode || ['READY', 'COMPLETE', 'OK', 'DISABLED', 'REGISTERED', 'ALREADY_REGISTERED'].includes(state.lastCode)) return null;
    return state.lastCode;
  });
  readonly pending = computed(() => {
    const state = this.state();
    if (!state) return [];
    if ('pendingDocuments' in state) return state.pendingDocuments.map(row => ({ id: row.moveId, reference: row.reference, code: row.code, settlementId: row.settlementId, companyCostId: null }));
    return (state.lastReport?.items ?? []).filter(row => !['READY', 'REGISTERED', 'ALREADY_REGISTERED'].includes(row.code))
      .map(row => ({ id: row.documentId, reference: row.reference, code: row.code, companyCostId: row.companyCostId, settlementId: null }));
  });
  ngOnInit(): void { void this.reload(); }
  async reload(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true); this.error.set(false);
    try { const state = this.kind() === 'tica' ? await this.api.ticaImportStatus() : await this.api.lincImportStatus(); if (!this.destroyRef.destroyed) this.state.set(state); }
    catch { if (!this.destroyRef.destroyed) this.error.set(true); }
    finally { if (!this.destroyRef.destroyed) this.loading.set(false); }
  }
  reason(code: string): string { return REASONS[code] ?? 'Controle nodig bij de Odoo-import'; }
  moment(value: string): string {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('nl-BE', { timeZone: 'Europe/Brussels', dateStyle: 'short', timeStyle: 'short' }).format(date) : 'onbekend';
  }
}
