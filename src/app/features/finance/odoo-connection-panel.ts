import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { OdooApi } from '../../core/api/odoo-api';
import type { OdooAttachment, OdooDocument, OdooDocumentDirection } from '../../core/api/odoo-api';
import { saveBlob } from '../../core/api/download';
import { messageOf, readableFailure } from '../../core/api/errors';
import { Icon } from '../../shared/icon';
import { Skeleton } from '../../shared/skeleton';
import { OdooSyncState } from './odoo-sync-state';

/**
 * Bank import and Odoo document access, without issuing or sending invoices.
 * The connection state and "Transacties ophalen" are the page's OdooSyncState;
 * this panel is its view (the Odoo-verbinding sheet) plus the invoice browser.
 */
@Component({
  selector: 'app-odoo-connection-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Icon, Skeleton],
  template: `
    <section class="odoo-card" aria-labelledby="odoo-title" [attr.aria-busy]="loading() || checking() || syncing()">
      <div class="odoo-head">
        <span class="odoo-icon"><app-icon name="exchange" [size]="18" /></span>
        <div class="odoo-heading"><h2 id="odoo-title">Bankverbinding via Odoo</h2><p>{{ loading() ? 'Verbinding controleren…' : ready() ? 'Laatste import: ' + (status()?.lastSyncAt ? moment(status()!.lastSyncAt!) : 'nog niet uitgevoerd') : connectionLabel() }}</p></div>
        <div class="odoo-head-actions">
          @if (ready()) { <button class="odoo-button" type="button" [disabled]="busy()" (click)="syncBank()"><app-icon name="refresh" [size]="15" />{{ syncing() ? 'Ophalen…' : 'Transacties ophalen' }}</button> }
          <button class="odoo-button odoo-button--details" type="button" [attr.aria-expanded]="detailsOpen()" aria-controls="odoo-connection-details" (click)="detailsOpen.set(!detailsOpen())">Details <app-icon [name]="detailsOpen() ? 'chevron-up' : 'chevron-down'" [size]="14" /></button>
        </div>
      </div>
      @if (detailsOpen()) {
        <div id="odoo-connection-details">
          <p class="odoo-description">{{ description() }}</p>
          @if (status()?.companyName; as company) { <p class="odoo-meta">{{ company }}</p> }
          <div class="odoo-actions"><button class="odoo-button" type="button" [disabled]="busy()" (click)="checkConnection()">{{ checking() ? 'Verbinding controleren…' : 'Verbinding controleren' }}</button></div>
          <div class="odoo-sync-meta">@if (status()?.lastCheckAt; as checkedAt) { <span>Verbinding gecontroleerd {{ moment(checkedAt) }}</span> }</div>
        </div>
      }
      @if (error()) { <p class="odoo-notice odoo-notice--error" role="alert">{{ error() }}</p> }
      @if (visibleSyncResult(); as result) {
        <div class="odoo-notice" [class.odoo-notice--warning]="!result.complete || result.conflicts > 0 || result.skippedNonEur > 0" role="status">
          <strong>{{ result.complete ? 'Import afgerond' : 'Import nog niet volledig' }}</strong>
          <span>{{ result.created }} nieuw · {{ result.updated }} bijgewerkt · {{ result.unchanged }} ongewijzigd</span>
          @if (result.message) { <span>{{ result.message }}</span> }
          @if (result.conflicts) { <span>{{ result.conflicts }} {{ result.conflicts === 1 ? 'beweging vraagt' : 'bewegingen vragen' }} controle. Bestaande koppelingen blijven behouden.</span> }
          @if (result.skippedNonEur) { <span>{{ result.skippedNonEur }} {{ result.skippedNonEur === 1 ? 'beweging in een andere munt is' : 'bewegingen in een andere munt zijn' }} niet overgenomen.</span> }
        </div>
      }
      @if (detailsOpen()) {
      <div class="odoo-documents">
        <button class="odoo-disclosure" type="button" [attr.aria-expanded]="documentsOpen()" aria-controls="odoo-documents" (click)="toggleDocuments()">
          <app-icon name="document" [size]="18" /><span>Facturen uit Odoo<small>Inkomend, uitgaand en Peppol-statussen</small></span>
          <app-icon [name]="documentsOpen() ? 'chevron-up' : 'chevron-down'" [size]="16" />
        </button>
        @if (documentsOpen()) {
          <div class="odoo-document-body" id="odoo-documents">
            @if (!ready()) {
              <p class="odoo-empty">Zodra de verbinding is ingesteld, verschijnen hier de facturen en beschikbare bestanden uit Odoo.</p>
            } @else {
              <div class="odoo-document-tools">
                <div class="odoo-tabs" role="group" aria-label="Factuurrichting">
                  <button type="button" [attr.aria-pressed]="direction() === 'incoming'" (click)="setDirection('incoming')">Inkomend</button>
                  <button type="button" [attr.aria-pressed]="direction() === 'outgoing'" (click)="setDirection('outgoing')">Uitgaand</button>
                </div>
                <button class="odoo-button odoo-button--small" type="button" [disabled]="documentsLoading()" (click)="loadDocuments()">Vernieuwen</button>
              </div>
              <p class="odoo-document-hint">{{ direction() === 'incoming' ? 'Aankoopfacturen en creditnota’s uit Odoo. Je kunt de beschikbare bestanden downloaden.' : 'Verkoopfacturen en creditnota’s uit Odoo. De Peppol-status is de status die Odoo doorgeeft.' }}</p>
              @if (!status()?.outboundEnabled) { <p class="odoo-document-hint">Versturen vanuit ENROSED staat nog uit.</p> }
              @if (documentsError()) { <p class="odoo-notice odoo-notice--error" role="alert">{{ documentsError() }}</p> }
              @if (documentsLoading() && !documents().length) {
                <app-skeleton kind="list" [rows]="3" />
              } @else if (documents().length) {
                <ul class="odoo-document-list">
                  @for (document of documents(); track document.id) {
                    <li class="odoo-document">
                      <div class="odoo-document-main"><strong>{{ document.partner || 'Onbekende tegenpartij' }}</strong>
                        <span>{{ document.name || document.reference || 'Factuur' }} · {{ document.date ? day(document.date) : 'Geen datum' }}</span>
                        @if (document.reference && document.reference !== document.name) { <small>{{ document.reference }}</small> }
                      </div>
                      <div class="odoo-document-value"><strong>{{ amount(document) }}</strong><small>{{ documentType(document) }} · {{ documentState(document.state) }}</small></div>
                      <div class="odoo-document-foot">
                        <span class="odoo-document-status" [class.odoo-document-status--error]="document.peppolState === 'error'">{{ peppolState(document.peppolState) }}</span>
                        <div class="odoo-files">
                          @for (attachment of document.attachments; track attachment.id) {
                            <button class="odoo-file" type="button" [disabled]="downloadId() !== null" [attr.title]="attachment.name" (click)="download(document, attachment)">
                              <app-icon name="download" [size]="13" />{{ downloadId() === attachment.id ? 'Ophalen…' : fileLabel(attachment) }}<span class="odoo-sr"> {{ attachment.name }}</span>
                            </button>
                          } @empty { <span class="odoo-no-file">Geen downloadbaar bestand</span> }
                        </div>
                      </div>
                    </li>
                  }
                </ul>
                @if (hasMore()) { <button class="odoo-button odoo-more" type="button" [disabled]="documentsLoading()" (click)="loadDocuments(true)">{{ documentsLoading() ? 'Meer facturen ophalen…' : 'Meer facturen tonen' }}</button> }
              } @else if (!documentsError()) {
                <p class="odoo-empty">Geen {{ direction() === 'incoming' ? 'inkomende' : 'uitgaande' }} facturen gevonden in Odoo.</p>
              }
              @if (peppolSupported() === false) { <p class="odoo-document-hint">Odoo geeft voor deze verbinding geen Peppol-statussen door.</p> }
            }
          </div>
        }
      </div>
      }
    </section>
  `,
  styles: [`
    :host { display: block; margin-bottom: 22px; min-width: 0; }
    .odoo-card { border: 1px solid var(--line); border-radius: 12px; background: var(--surface); overflow: hidden; color: var(--ink); }
    .odoo-head { display: flex; align-items: center; gap: 11px; padding: 13px 16px; }
    .odoo-icon { display: grid; place-items: center; width: 34px; height: 34px; flex: none; border-radius: 12px; color: var(--rose-dark); background: var(--rose-soft); }
    .odoo-head-actions { display: flex; flex-wrap: wrap; gap: 6px; }
    .odoo-button--details { border-color: transparent; }
    .odoo-heading { flex: 1; min-width: 0; }
    h2 { margin: 0; font-size: 13px; font-weight: 650; letter-spacing: -.01em; }
    .odoo-heading p { margin: 3px 0 0; color: var(--muted); font-size: 12px; }
    .odoo-badge { padding: 5px 9px; border-radius: 999px; font-size: 11px; font-weight: 650; color: var(--rose-dark); background: var(--rose-soft); white-space: nowrap; }
    .odoo-badge--muted { color: var(--muted); background: var(--surface-2); }
    .odoo-description { margin: 15px 18px 0; color: var(--ink-2); font-size: 13px; line-height: 1.5; }
    .odoo-meta { margin: 4px 18px 0; color: var(--muted); font-size: 12px; }
    .odoo-actions { display: flex; gap: 8px; flex-wrap: wrap; margin: 14px 18px 0; }
    .odoo-button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 38px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); color: var(--ink-2); font: inherit; font-size: 12px; font-weight: 650; cursor: pointer; }
    .odoo-button--primary { background: var(--rose-dark); color: white; border-color: transparent; }
    button:disabled { opacity: .5; cursor: default; }
    button:focus-visible { outline: 2px solid var(--rose-dark); outline-offset: 3px; }
    .odoo-button--small { min-height: 32px; padding: 5px 10px; }
    .odoo-sync-meta { display: flex; flex-wrap: wrap; gap: 4px 16px; padding: 10px 18px 17px; font-size: 11px; line-height: 1.5; color: var(--muted); }
    .odoo-sync-meta b { font-weight: 550; }
    .odoo-loading { padding: 20px 18px 10px; }
    .odoo-notice { display: grid; gap: 4px; margin: 0 18px 14px; padding: 11px 13px; border-radius: 10px; background: var(--surface-2); color: var(--ink-2); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
    .odoo-notice--error { color: #a32c2c; background: #fff0ef; }
    .odoo-notice--warning { color: #87551c; background: #fff5e6; }
    .odoo-documents { border-top: 1px solid var(--line); }
    .odoo-disclosure { display: flex; align-items: center; gap: 10px; width: 100%; padding: 14px 18px; border: 0; background: transparent; color: var(--ink-2); text-align: left; font: inherit; font-size: 12px; font-weight: 650; cursor: pointer; }
    .odoo-disclosure span { flex: 1; }
    .odoo-disclosure small { display: block; color: var(--muted); font-size: 11px; font-weight: 400; margin-top: 3px; }
    .odoo-document-body { padding: 0 18px 18px; }
    .odoo-document-tools { display: flex; justify-content: space-between; gap: 10px; align-items: center; }
    .odoo-tabs { display: flex; gap: 3px; background: var(--surface-2); border-radius: 10px; padding: 3px; }
    .odoo-tabs button { padding: 6px 12px; border-radius: 8px; border: 0; color: var(--muted); background: transparent; font: inherit; font-size: 12px; font-weight: 650; cursor: pointer; }
    .odoo-tabs button[aria-pressed=true] { color: var(--ink); background: var(--surface); box-shadow: 0 1px 4px #0000000f; }
    .odoo-document-hint { color: var(--muted); font-size: 11px; line-height: 1.5; margin: 10px 0; }
    .odoo-document-list { list-style: none; padding: 0; margin: 8px 0 0; }
    .odoo-document { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 9px 16px; padding: 15px 0; border-bottom: 1px solid var(--line); }
    .odoo-document-main, .odoo-document-value { display: grid; align-content: start; gap: 3px; font-size: 12px; min-width: 0; overflow-wrap: anywhere; }
    .odoo-document-main strong { font-size: 13px; }
    .odoo-document-main span, .odoo-document-main small, .odoo-document-value small { color: var(--muted); font-size: 11px; }
    .odoo-document-value { text-align: right; font-variant-numeric: tabular-nums; }
    .odoo-document-foot { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .odoo-document-status { color: var(--muted); font-size: 11px; }
    .odoo-document-status--error { color: #a32c2c; font-weight: 650; }
    .odoo-files { display: flex; flex-wrap: wrap; gap: 5px; }
    .odoo-file { display: inline-flex; gap: 5px; align-items: center; min-height: 28px; padding: 4px 8px; border: 1px solid var(--line); border-radius: 7px; color: var(--ink-2); background: var(--surface); font: inherit; font-size: 10px; cursor: pointer; }
    .odoo-no-file { font-size: 10px; color: var(--muted); }
    .odoo-empty { padding: 16px 0; margin: 0; color: var(--muted); font-size: 12px; line-height: 1.6; }
    .odoo-more { margin-top: 14px; }
    .odoo-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
    @media (max-width: 679px) {
      :host { margin: 0 0 20px; }
      .odoo-head { padding: 12px; gap: 9px; flex-wrap: wrap; }
      .odoo-head-actions { width: 100%; margin-left: 44px; }
      .odoo-head-actions .odoo-button { min-height: 36px; }
      .odoo-heading p { font-size: 11px; }
      .odoo-icon { width: 35px; height: 35px; }
      .odoo-badge { margin-left: 44px; margin-top: -3px; }
      .odoo-description { margin: 12px 14px 0; }
      .odoo-meta { margin-left: 14px; }
      .odoo-actions { margin: 12px 14px 0; }
      .odoo-button { min-height: 42px; }
      .odoo-actions .odoo-button { flex: 1 1 100%; }
      .odoo-sync-meta { padding: 11px 14px 15px; }
      .odoo-disclosure { padding: 14px; }
      .odoo-document-body { padding: 0 14px 14px; }
      .odoo-document { grid-template-columns: minmax(0, 1fr); gap: 7px; }
      .odoo-document-value { display: flex; justify-content: space-between; gap: 10px; text-align: left; }
      .odoo-document-foot { align-items: flex-start; flex-direction: column; }
      .odoo-notice { margin: 0 14px 14px; }
      .odoo-tabs button { min-height: 38px; padding: 6px 10px; }
      .odoo-file { min-height: 36px; }
    }
  `],
})
export class OdooConnectionPanel implements OnInit {
  private readonly api = inject(OdooApi);
  private readonly sync = inject(OdooSyncState);
  private readonly destroyRef = inject(DestroyRef);
  /** In the Odoo-verbinding sheet the details start open. */
  readonly expanded = input(false);
  readonly detailsOpen = signal(false);
  readonly status = this.sync.status;
  readonly loading = this.sync.loading;
  readonly checking = this.sync.checking;
  readonly syncing = this.sync.syncing;
  readonly error = this.sync.error;
  readonly syncResult = this.sync.syncResult;
  readonly visibleSyncResult = computed(() => {
    const result = this.syncResult();
    return result && (this.detailsOpen() || !result.complete || result.conflicts > 0 || result.skippedNonEur > 0) ? result : null;
  });
  readonly ready = this.sync.ready;
  readonly busy = this.sync.busy;
  readonly connectionLabel = computed(() => {
    if (!this.status()) return 'Niet beschikbaar';
    if (!this.status()!.enabled) return 'Nog niet actief';
    return this.status()!.configured ? 'Ingesteld' : 'Instellen nodig';
  });
  readonly description = computed(() => {
    const status = this.status();
    if (!status) return 'De verbindingsstatus kon niet worden opgehaald. Probeer de status opnieuw te vernieuwen.';
    if (!status.enabled) return 'De Odoo-verbinding is nog niet ingeschakeld voor deze omgeving. Zodra ze klaarstaat, kun je hier je banktransacties ophalen.';
    if (!status.configured) return 'De Odoo-verbinding is nog niet volledig ingesteld. Je beheerder moet de verbinding afronden voordat je banktransacties kunt ophalen.';
    return status.message || 'Haal je banktransacties op uit Odoo en koppel ze hier in ENROSED aan je facturen en uitgaven.';
  });

  readonly documentsOpen = signal(false);
  readonly direction = signal<OdooDocumentDirection>('incoming');
  readonly documents = signal<OdooDocument[]>([]);
  readonly documentsLoading = signal(false);
  readonly documentsError = this.sync.documentsError;
  readonly hasMore = signal(false);
  readonly peppolSupported = signal<boolean | null>(null);
  readonly downloadId = signal<number | null>(null);
  private documentVersion = 0;
  private nextAfterId = 0;
  private documentsLoaded = false;

  constructor() {
    this.destroyRef.onDestroy(() => { ++this.documentVersion; });
  }

  ngOnInit(): void {
    if (this.expanded()) this.detailsOpen.set(true);
  }

  async checkConnection(): Promise<void> {
    await this.sync.checkConnection();
    if (this.documentsOpen() && this.ready() && !this.documentsLoaded) void this.loadDocuments();
  }

  /** "Transacties ophalen": the page's import (it outlives this panel). */
  syncBank(): Promise<void> {
    return this.sync.syncBank();
  }

  toggleDocuments(): void {
    this.documentsOpen.update(open => !open);
    if (this.documentsOpen() && this.ready() && !this.documentsLoaded && !this.documentsLoading()) void this.loadDocuments();
  }

  setDirection(direction: OdooDocumentDirection): void {
    if (this.direction() === direction) return;
    this.direction.set(direction);
    this.documents.set([]);
    this.documentsLoaded = false;
    this.hasMore.set(false);
    void this.loadDocuments();
  }

  async loadDocuments(append = false): Promise<void> {
    if (!this.ready() || (append && (!this.hasMore() || this.documentsLoading()))) return;
    const version = ++this.documentVersion;
    const direction = this.direction();
    this.documentsLoading.set(true);
    this.documentsError.set('');
    try {
      const page = await this.api.documents(direction, append ? this.nextAfterId : 0);
      if (version !== this.documentVersion || this.destroyRef.destroyed) return;
      const rows = append ? [...this.documents(), ...page.documents] : page.documents;
      this.documents.set([...new Map(rows.map(document => [document.id, document])).values()]);
      this.nextAfterId = page.nextAfterId ?? 0;
      this.hasMore.set(page.hasMore && this.nextAfterId > 0);
      this.peppolSupported.set(page.peppolSupported);
      this.documentsLoaded = true;
    } catch (failure) {
      if (version === this.documentVersion && !this.destroyRef.destroyed) this.documentsError.set(messageOf(failure, 'Facturen uit Odoo ophalen is niet gelukt.'));
    } finally {
      if (version === this.documentVersion && !this.destroyRef.destroyed) this.documentsLoading.set(false);
    }
  }

  async download(document: OdooDocument, attachment: OdooAttachment): Promise<void> {
    if (this.downloadId() !== null) return;
    this.downloadId.set(attachment.id);
    this.documentsError.set('');
    try {
      const blob = await this.api.attachment(document.id, attachment.id);
      if (!this.destroyRef.destroyed) saveBlob(blob, attachment.name || `factuur-${document.id}-${attachment.id}`);
    } catch (failure) {
      const readable = await readableFailure(failure);
      if (!this.destroyRef.destroyed) this.documentsError.set(messageOf(readable, 'Het bestand downloaden is niet gelukt.'));
    } finally {
      if (!this.destroyRef.destroyed) this.downloadId.set(null);
    }
  }

  moment(value: string): string {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('nl-BE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Brussels' }).format(date) : 'onbekend';
  }

  day(value: string): string { return /^\d{4}-\d{2}-\d{2}/.test(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : value; }

  amount(document: OdooDocument): string {
    try { return new Intl.NumberFormat('nl-BE', { style: 'currency', currency: document.currency || 'EUR' }).format(document.total); }
    catch { return `${document.total} ${document.currency}`; }
  }

  documentType(document: OdooDocument): string { return document.moveType.endsWith('_refund') ? 'Creditnota' : 'Factuur'; }
  documentState(state: string): string { return ({ draft: 'Concept', posted: 'Geboekt', cancel: 'Geannuleerd' } as Record<string, string>)[state] || state || 'Status onbekend'; }
  peppolState(state: string | null): string {
    return ({ ready: 'Klaar voor Peppol', to_send: 'In de wachtrij voor Peppol', skipped: 'Peppol overgeslagen', processing: 'Peppol: wacht op ontvangst', done: 'Peppol: voltooid in Odoo', error: 'Peppol: fout bij verwerking' } as Record<string, string>)[state ?? ''] || (state ? `Peppol: ${state}` : 'Geen Peppol-status beschikbaar');
  }
  fileLabel(attachment: OdooAttachment): string { return attachment.kind === 'XML' || attachment.kind === 'PDF' ? attachment.kind : 'Bestand'; }
}
