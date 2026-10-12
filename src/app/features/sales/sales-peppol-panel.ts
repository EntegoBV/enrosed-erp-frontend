import { ChangeDetectionStrategy, Component, OnChanges, OnDestroy, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { OdooOutboxApi, type OdooCustomerMatch, type OdooOutboxView } from '../../core/api/odoo-outbox-api';
import { messageOf } from '../../core/api/errors';
import { EurPipe } from '../../shared/pipes';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-sales-peppol-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, EurPipe, Icon],
  template: `
    <section class="peppol" [attr.aria-busy]="busy()">
      <button class="peppol__toggle" type="button" [attr.aria-expanded]="opened()" (click)="toggle()">
        <app-icon name="send" [size]="17" /><span><strong>Versturen via Peppol</strong><small>{{ statusLabel() }}</small></span>
        <app-icon [name]="opened() ? 'chevron-up' : 'chevron-down'" [size]="16" />
      </button>
      @if (opened()) {
        <div class="peppol__body">
          @if (busy() && !data()) { <p role="status">Factuurgegevens laden…</p> }
          @if (error()) { <p class="peppol__error" role="alert">{{ error() }}</p> }
          @if (data(); as view) {
            @if (!view.configured || !view.enabled) { <p class="peppol__notice">Odoo-verbinding nog instellen. Je kunt de factuurgegevens hieronder al controleren.</p> }
            @else if (!view.sendEnabled) { <p class="peppol__notice">Verzenden via Peppol is nog niet ingeschakeld. Je kunt de factuur alvast voorbereiden.</p> }
            @if (view.localPreview; as invoice) {
              <div class="peppol__customer"><strong>{{ invoice.customerName }}</strong><span>{{ invoice.customerVat || 'Geen btw-nummer' }}</span><span>{{ invoice.moveType === 'out_refund' ? 'Creditnota' : 'Factuur' }} {{ invoice.number }} · {{ day(invoice.date) }}</span>
                @if (invoice.creditReference) { <small>Bij factuur {{ invoice.creditReference }}</small> }
              </div>
              <div class="peppol__totals"><span>Excl. btw<strong>{{ invoice.net | eur }}</strong></span><span>Btw<strong>{{ invoice.vat | eur }}</strong></span><span>Totaal<strong>{{ invoice.total | eur }}</strong></span></div>
              <details class="peppol__lines"><summary>Factuurregels controleren · {{ invoice.lines.length }}</summary>
                @for (line of invoice.lines; track $index) { <div><span>{{ line.description }}<small>{{ line.quantity }} × {{ line.unitPrice | eur }}@if (line.discount) { · {{ line.discount }}% korting }</small></span><b>{{ line.total | eur }}</b></div> }
                @if (invoice.dueDate) { <p>Vervaldatum {{ day(invoice.dueDate) }}</p> }
                @if (invoice.legalMention) { <p>{{ invoice.legalMention }}</p> }
              </details>
            } @else { <p class="peppol__notice">{{ view.message || 'Voor dit document zijn nog geen definitieve factuurgegevens beschikbaar.' }}</p> }
            @if (view.localPreview && view.code !== 'READY' && view.code !== 'OUTBOX_PREVIEW_REQUIRED' && view.code !== 'OUTBOUND_DISABLED' && view.code !== 'OUTBOUND_NOT_CONFIGURED') { <p class="peppol__notice" role="status">{{ view.message }}</p> }
            @if (view.entry; as entry) {
              <p class="peppol__notice" role="status"><strong>{{ statusLabel() }}</strong>@if (entry.number) { · {{ entry.number }} }@if (entry.peppolState) { <span>Peppol: {{ peppolLabel(entry.peppolState) }}</span> }@if (entry.message) { <span>{{ entry.message }}</span> }</p>
            }
            @if (uncertain()) { <p class="peppol__notice">De uitkomst wordt gecontroleerd. Vernieuw de status voordat je verdergaat.</p> }
            @if (canPreview()) {
              <label class="peppol__field"><span>Klant in Odoo</span><select class="select" [ngModel]="partnerId()" (ngModelChange)="partnerId.set($event)" [disabled]="busy() || !partners().length">
                <option [ngValue]="null">{{ partnersLoading() ? 'Klanten laden…' : 'Kies de bijbehorende klant' }}</option>
                @for (partner of partners(); track partner.id) { <option [ngValue]="partner.id">{{ partner.name }}{{ partner.vat ? ' · ' + partner.vat : '' }}</option> }
              </select></label>
              @if (partnersMessage()) { <p class="peppol__hint">{{ partnersMessage() }}</p> }
              @if (!partnersLoading() && !partners().length) { <p class="peppol__hint">Er is nog geen overeenkomende klant beschikbaar in Odoo.</p> }
              <button class="btn btn--sm" type="button" [disabled]="busy() || !partnerId()" (click)="preparePreview()">Klant en factuur controleren</button>
            }
            @if (canDraft()) { <p class="peppol__hint">De gecontroleerde factuurgegevens staan vast. De volgende stap maakt het factuurconcept in Odoo.</p><button class="btn btn--sm" type="button" [disabled]="busy()" (click)="createDraft()">Concept in Odoo klaarzetten</button> }
            @if (canSend()) {
              <label class="peppol__confirm"><input type="checkbox" [checked]="sendConfirmed()" [disabled]="busy() || dirty()" (change)="sendConfirmed.set($any($event.target).checked)" /><span>Ik heb de klant en bedragen gecontroleerd. Dit document mag definitief via Peppol worden verstuurd.</span></label>
              <button class="btn btn--primary btn--sm" type="button" [disabled]="busy() || !sendConfirmed() || dirty()" (click)="send()">Definitief versturen via Peppol</button>
            }
            @if (dirty()) { <p class="peppol__hint">Bewaar eerst de factuurwijzigingen.</p> }
          }
          <div class="peppol__actions"><button class="btn btn--sm" type="button" [disabled]="busy()" (click)="refresh()">{{ busy() ? 'Bezig…' : 'Status vernieuwen' }}</button></div>
        </div>
      }
    </section>
  `,
  styles: `
    :host{display:block;min-width:0}.peppol{border:1px solid var(--line);border-radius:14px;margin:12px 0;background:var(--surface)}.peppol__toggle{display:flex;align-items:center;gap:10px;width:100%;border:0;background:none;color:inherit;text-align:left;padding:14px;cursor:pointer;border-radius:14px}.peppol__toggle>span{flex:1;display:grid;gap:4px;min-width:0}.peppol__toggle strong{font-size:12px}.peppol__toggle small,.peppol__hint{color:var(--muted);font-size:11px;line-height:1.5}.peppol__body{padding:0 14px 14px;display:grid;gap:12px;font-size:12px}.peppol__body p{margin:0;line-height:1.5}.peppol__customer{display:grid;gap:4px;overflow-wrap:anywhere}.peppol__customer span,.peppol__customer small{color:var(--muted);font-size:11px}.peppol__totals{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.peppol__totals>span{display:grid;gap:5px;color:var(--muted);font-size:10px}.peppol__totals strong{font-size:14px;color:var(--text);font-variant-numeric:tabular-nums}.peppol__notice{padding:10px;border-radius:10px;background:var(--surface-2);overflow-wrap:anywhere}.peppol__notice>span{display:block;margin-top:4px}.peppol__error{color:var(--danger);overflow-wrap:anywhere}.peppol__lines{font-size:11px}.peppol__lines summary{cursor:pointer;padding:8px 0}.peppol__lines>div{display:flex;align-items:start;gap:12px;justify-content:space-between;padding:8px 0;border-top:1px solid var(--line)}.peppol__lines>div>span{min-width:0;overflow-wrap:anywhere}.peppol__lines small{display:block;color:var(--muted);margin-top:4px}.peppol__lines b{white-space:nowrap}.peppol__field{display:grid;gap:6px}.peppol__field select{width:100%;max-width:100%;min-width:0;min-height:44px}.peppol__confirm{display:flex;gap:9px;align-items:start;line-height:1.5}.peppol__confirm input{margin-top:3px;flex:none}.peppol__actions{border-top:1px solid var(--line);padding-top:10px}.peppol button:focus-visible,.peppol select:focus-visible{outline:2px solid var(--rose-dark);outline-offset:3px}@media(max-width:520px){.peppol__field select{font-size:16px}.peppol__body>.btn{width:100%;white-space:normal;min-height:44px}.peppol__totals strong{font-size:13px;overflow-wrap:anywhere}}
  `,
})
export class SalesPeppolPanel implements OnChanges, OnDestroy {
  readonly orderId = input.required<number>();
  readonly dirty = input(false);
  private readonly api = inject(OdooOutboxApi);
  readonly opened = signal(false);
  readonly busy = signal(false);
  readonly data = signal<OdooOutboxView | null>(null);
  readonly error = signal('');
  readonly partners = signal<OdooCustomerMatch[]>([]);
  readonly partnersLoading = signal(false);
  readonly partnersMessage = signal('');
  readonly partnerId = signal<number | null>(null);
  readonly sendConfirmed = signal(false);
  private version = 0;
  private currentId: number | null = null;
  readonly uncertain = computed(() => ['UNKNOWN_CREATE', 'UNKNOWN_SEND'].includes(this.data()?.entry?.state ?? ''));
  readonly ready = computed(() => !!this.data()?.configured && !!this.data()?.enabled && !!this.data()?.localPreview && !this.dirty());
  readonly canPreview = computed(() => this.ready() && ['READY', 'OUTBOX_PREVIEW_REQUIRED', 'OUTBOX_CHANGED'].includes(this.data()?.code ?? '') && (!this.data()?.entry || this.data()?.entry?.state === 'PREVIEW'));
  readonly canDraft = computed(() => this.ready() && this.data()?.code === 'READY' && this.data()?.entry?.state === 'PREVIEW');
  readonly canSend = computed(() => this.ready() && this.data()?.code === 'READY' && !!this.data()?.sendEnabled && this.data()?.entry?.state === 'DRAFT');
  readonly statusLabel = computed(() => {
    const data = this.data();
    const state = data?.entry?.state;
    if (state) return ({ PREVIEW: 'Factuur gecontroleerd', DRAFT: 'Concept klaar in Odoo', QUEUED: 'Verzending in behandeling', DONE: 'Verstuurd via Peppol', UNKNOWN_CREATE: 'Conceptstatus controleren', UNKNOWN_SEND: 'Verzendstatus controleren', BLOCKED: 'Controle nodig' })[state] ?? state;
    return data && (!data.configured || !data.enabled) ? 'Verbinding nog instellen' : 'Factuurgegevens en verzendstatus';
  });
  ngOnChanges(): void {
    if (this.currentId === this.orderId()) return;
    this.currentId = this.orderId(); this.version++; this.data.set(null); this.opened.set(false); this.busy.set(false); this.error.set('');
    this.partners.set([]); this.partnerId.set(null); this.partnersMessage.set(''); this.partnersLoading.set(false); this.sendConfirmed.set(false);
  }
  ngOnDestroy(): void { this.version++; }
  toggle(): void { this.opened.update(open => !open); if (this.opened() && !this.data() && !this.busy()) void this.load(); }
  day(value: string): string { return value?.slice(0, 10).split('-').reverse().join('/') || '—'; }
  peppolLabel(value: string): string { return ({ done: 'Verstuurd', processing: 'In behandeling', ready: 'Klaar om te versturen', error: 'Mislukt', skipped: 'Overgeslagen' } as Record<string, string>)[value] ?? value; }
  private async load(): Promise<void> { await this.run(() => this.api.view(this.orderId())); }
  async refresh(): Promise<void> { await this.run(() => this.data()?.entry?.odooMoveId || this.uncertain() ? this.api.refresh(this.orderId()) : this.api.view(this.orderId())); }
  async preparePreview(): Promise<void> {
    const partnerId = this.partnerId();
    if (!this.canPreview() || !partnerId || !this.partners().some(partner => partner.id === partnerId)) return;
    await this.run(() => this.api.preview(this.orderId(), partnerId));
  }
  async createDraft(): Promise<void> { const hash = this.data()?.entry?.snapshotHash; if (this.canDraft() && hash) await this.run(() => this.api.draft(this.orderId(), hash)); }
  async send(): Promise<void> { const hash = this.data()?.entry?.snapshotHash; if (this.canSend() && this.sendConfirmed() && hash) await this.run(() => this.api.send(this.orderId(), hash)); }
  private async run(action: () => Promise<OdooOutboxView>): Promise<void> {
    if (this.busy()) return;
    const version = ++this.version, id = this.orderId(); this.busy.set(true); this.error.set(''); this.sendConfirmed.set(false);
    try { const view = await action(); if (version !== this.version || id !== this.orderId()) return; this.data.set(view); if (this.canPreview() && !this.partners().length) await this.loadPartners(version, id); }
    catch (failure) { if (version === this.version && id === this.orderId()) this.error.set(messageOf(failure, 'Peppol-status ophalen mislukt. Probeer opnieuw.')); }
    finally { if (version === this.version) this.busy.set(false); }
  }
  private async loadPartners(version: number, id: number): Promise<void> {
    this.partnersLoading.set(true);
    try { const matches = await this.api.partners(id); if (version !== this.version || id !== this.orderId()) return; this.partners.set(matches.partners); this.partnersMessage.set(matches.message ?? ''); if (matches.partners.length === 1) this.partnerId.set(matches.partners[0].id); }
    catch (failure) { if (version === this.version) this.partnersMessage.set(messageOf(failure, 'De klanten konden niet worden opgehaald. Vernieuw de status.')); }
    finally { if (version === this.version) this.partnersLoading.set(false); }
  }
}
