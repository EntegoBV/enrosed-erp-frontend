import { ChangeDetectionStrategy, Component, computed, effect, inject, input, OnDestroy, signal } from '@angular/core';
import type { SalesOrderView } from '../../core/api/models';
import { InvoiceDeclarationApi, type InvoiceDeclaration, type InvoiceDeclarationMode, type InvoiceDeclarationRequest } from '../../core/api/invoice-declaration-api';
import { messageOf } from '../../core/api/errors';
import { Ui } from '../../shared/ui';
import { isAdvanceDocument, isPartnerDocument } from './sales-payment-state';
import { INVOICE_DECLARATION_LABELS, invoiceDeclarationDraft, invoiceDeclarationPreview, invoiceDeclarationRequest } from './invoice-declaration-state';

@Component({
  selector: 'app-sales-invoice-declaration',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (documentId() !== null) {
      <details class="invoice-declaration">
        <summary><span><b>Vermelding op de factuur</b><small>{{ loading() ? 'Vermelding laden…' : saved() ? labels[saved()!.mode] : 'Nog niet geladen' }}</small></span><i aria-hidden="true">⌄</i></summary>
        <div class="declaration-body">
          @if (loading()) { <p role="status">Vermelding laden…</p> }
          @else if (!saved()) {
            <p class="declaration-error" role="alert">{{ error() || 'De factuurvermelding is nog niet beschikbaar.' }}</p>
            <button class="btn btn--sm" type="button" (click)="reload()">Opnieuw laden</button>
          } @else {
            @if (dirty()) { <p class="declaration-hint">Sla eerst de wijzigingen aan de factuur op voordat je de vermelding wijzigt.</p> }
            @if (!editable()) {
              <p class="declaration-readonly"><b>{{ labels[saved()!.mode] }}</b>@if (view().order.archivedAt) { · alleen lezen in het archief } @else if (view().order.status !== 'CONCEPT') { · alleen lezen na uitgifte }</p>
            } @else {
              <fieldset [disabled]="saving()" class="declaration-options">
                <legend>Vermelding kiezen</legend>
                <label><input type="radio" [name]="'invoice-declaration-' + documentId()" value="DEFAULT" [checked]="draft().mode === 'DEFAULT'" (change)="choose('DEFAULT')" /><span>Standaard btwvermelding</span></label>
                @if (advance()) {
                  <label [class.is-disabled]="!fiscalTreatmentAllowed()"><input type="radio" [name]="'invoice-declaration-' + documentId()" value="CUSTOMS_REPRESENTATIVE" [checked]="draft().mode === 'CUSTOMS_REPRESENTATIVE'" [disabled]="!fiscalTreatmentAllowed()" (change)="choose('CUSTOMS_REPRESENTATIVE')" /><span>Inklaring via 24/7 Customs (Engels)</span></label>
                } @else {
                  <label [class.is-disabled]="!fiscalTreatmentAllowed()"><input type="radio" [name]="'invoice-declaration-' + documentId()" value="REVERSE_CHARGE" [checked]="draft().mode === 'REVERSE_CHARGE'" [disabled]="!fiscalTreatmentAllowed()" (change)="choose('REVERSE_CHARGE')" /><span>Reverse charge (Engels)</span></label>
                }
                @if (!fiscalTreatmentAllowed()) { <p class="declaration-hint">Alleen beschikbaar voor een Nederlandse factuur met de bestaande btwbehandeling via fiscale vertegenwoordiging.</p> }
              </fieldset>
              @if (draft().mode !== 'DEFAULT') {
                <label class="declaration-field"><span>Dossierreferentie <small>optioneel</small></span><input class="input" [value]="draft().reference || ''" [disabled]="saving()" maxlength="160" (input)="patch({ reference: $any($event.target).value })" /></label>
              }
            }
            @if (preview()) { <div class="declaration-preview"><small>{{ displayed().mode === 'DEFAULT' ? 'Standaardtekst op de factuur' : 'Gekozen tekst op de factuur' }}</small><p>{{ preview() }}</p></div> }
            @else { <p class="declaration-hint">Er is geen aanvullende tekst naast de standaard btwgegevens.</p> }
            @if (displayed().mode !== 'DEFAULT') { <p class="declaration-hint">Deze vermelding blijft Engels, ongeacht de taal van de factuur. Adres en btw-nummer van de koper komen uit de klantgegevens.</p> }
            @if (error()) { <p class="declaration-error" role="alert">{{ error() }}</p> }
            @if (editable()) {
              <div class="declaration-actions"><span role="status">{{ changed() ? 'Nog niet opgeslagen' : 'Opgeslagen keuze' }}</span><button class="btn btn--primary btn--sm" type="button" [disabled]="saving() || !changed()" (click)="save()">{{ saving() ? 'Opslaan…' : 'Vermelding opslaan' }}</button></div>
            }
          }
        </div>
      </details>
    }
  `,
  styles: `
    :host{display:block;min-width:0}.invoice-declaration{margin:14px 0;border:1px solid var(--rose-line);border-radius:13px;background:var(--surface)}summary{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 14px;cursor:pointer;list-style:none;min-height:58px}summary::-webkit-details-marker{display:none}summary>span{display:grid;gap:4px;min-width:0}summary b{font-size:13px}summary small{font-size:11px;color:var(--muted);overflow-wrap:anywhere}summary>i{font-style:normal;color:var(--rose-dark);transition:transform .18s}.invoice-declaration[open]>summary>i{transform:rotate(180deg)}summary:focus-visible{outline:2px solid var(--rose);outline-offset:-2px;border-radius:12px}.declaration-body{display:grid;gap:12px;padding:0 14px 14px}.declaration-hint{margin:0;color:var(--muted);font-size:11px;line-height:1.55}.declaration-options{display:grid;gap:4px;border:0;margin:0;padding:0;min-width:0}.declaration-options legend{font-size:12px;font-weight:650;margin-bottom:6px}.declaration-options>label{display:flex;gap:9px;align-items:center;min-height:44px;font-size:12px;line-height:1.4;cursor:pointer}.declaration-options input{width:17px;height:17px;margin:0;accent-color:var(--rose);flex:none}.declaration-options .is-disabled{color:var(--muted);cursor:default}.declaration-field{display:grid;gap:6px;font-size:12px}.declaration-field>span{font-weight:650}.declaration-field small{color:var(--muted);font-weight:400}.declaration-field input{width:100%;min-width:0;min-height:44px;font-size:14px}.declaration-preview{padding:11px;border-radius:9px;background:var(--surface-2);min-width:0}.declaration-preview>small{font-size:10px;font-weight:700;color:var(--muted)}.declaration-preview>p{margin:5px 0 0;font-size:12px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}.declaration-readonly{font-size:12px;color:var(--muted);margin:0}.declaration-error{margin:0;color:var(--danger);font-size:12px;line-height:1.5}.declaration-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.declaration-actions>span{font-size:10px;color:var(--muted)}.declaration-actions>.btn{min-height:44px}@media(max-width:520px){.declaration-field input{font-size:16px}.declaration-actions>.btn{flex:1 1 auto}}@media(prefers-reduced-motion:reduce){summary>i{transition:none}}
  `,
})
export class SalesInvoiceDeclaration implements OnDestroy {
  readonly view = input.required<SalesOrderView>();
  readonly dirty = input(false);
  readonly documentId = computed(() => this.view().order.docType === 'FACTUUR' && isPartnerDocument(this.view().order) ? this.view().order.id : null);
  readonly documentStatus = computed(() => this.view().order.status);
  readonly advance = computed(() => isAdvanceDocument(this.view().order));
  readonly fiscalTreatmentAllowed = computed(() => this.view().order.countryCode?.trim().toUpperCase() === 'NL'
    && this.view().priced.totals.vatTreatment === 'VERLEGD_FISCAAL_VERTEGENWOORDIGER');
  readonly editable = computed(() => this.documentId() !== null && this.view().order.status === 'CONCEPT' && !this.view().order.archivedAt && !this.dirty());
  readonly saved = signal<InvoiceDeclaration | null>(null);
  readonly draft = signal<InvoiceDeclarationRequest>({ mode: 'DEFAULT', reference: null });
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly labels = INVOICE_DECLARATION_LABELS;
  readonly displayed = computed(() => this.editable() ? this.draft() : this.saved() ?? this.draft());
  readonly preview = computed(() => invoiceDeclarationPreview(this.displayed(), this.view().priced.totals.vatLegalMention));
  readonly changed = computed(() => !!this.saved() && JSON.stringify(this.draft()) !== JSON.stringify(invoiceDeclarationDraft(this.saved()!)));
  private readonly api = inject(InvoiceDeclarationApi);
  private readonly ui = inject(Ui);
  private version = 0;

  constructor() {
    effect(() => { const id = this.documentId(); this.documentStatus(); void this.load(id); });
  }

  reload(): void { if (!this.saving()) void this.load(this.documentId()); }

  async load(id: number | null): Promise<void> {
    const version = ++this.version;
    this.saved.set(null); this.error.set(''); this.saving.set(false); this.loading.set(id !== null);
    if (id === null) return;
    try {
      const saved = await this.api.get(id);
      if (version !== this.version || id !== this.documentId()) return;
      const draft = invoiceDeclarationDraft(saved);
      this.saved.set(saved); this.draft.set(draft);
    } catch (failure) {
      if (version === this.version) this.error.set(messageOf(failure, 'De factuurvermelding kon niet worden geladen.'));
    } finally {
      if (version === this.version) this.loading.set(false);
    }
  }

  choose(mode: InvoiceDeclarationMode): void {
    if (!this.editable() || this.saving() || !this.saved()) return;
    if (mode !== 'DEFAULT' && (!this.fiscalTreatmentAllowed()
      || mode === 'CUSTOMS_REPRESENTATIVE' && !this.advance()
      || mode === 'REVERSE_CHARGE' && this.advance())) return;
    const current = this.draft();
    this.draft.set({ mode, reference: mode === 'DEFAULT' ? null : current.reference });
    this.error.set('');
  }

  patch(change: Partial<Pick<InvoiceDeclarationRequest, 'reference'>>): void {
    if (this.editable() && !this.saving() && this.saved()) { this.draft.update(value => ({ ...value, ...change })); this.error.set(''); }
  }

  async save(): Promise<void> {
    const id = this.documentId();
    if (id === null || !this.editable() || !this.saved() || this.loading() || this.saving() || !this.changed()) return;
    const version = this.version;
    this.error.set('');
    try {
      const request = invoiceDeclarationRequest(this.draft(), this.advance(), this.fiscalTreatmentAllowed());
      this.saving.set(true);
      const saved = await this.api.save(id, request);
      if (version !== this.version || id !== this.documentId()) return;
      const draft = invoiceDeclarationDraft(saved);
      this.saved.set(saved); this.draft.set(draft);
      this.ui.toast('Factuurvermelding opgeslagen', 'ok');
    } catch (failure) {
      if (version === this.version) this.error.set(messageOf(failure, failure instanceof Error ? failure.message : 'De factuurvermelding kon niet worden opgeslagen.'));
    } finally {
      if (version === this.version) this.saving.set(false);
    }
  }

  ngOnDestroy(): void { this.version++; }
}
