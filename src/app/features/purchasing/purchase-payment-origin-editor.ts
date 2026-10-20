import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SourcingApi } from '../../core/api/sourcing-api';
import type { PurchasePayment, PurchasePaymentOrigin } from '../../core/api/models';
import { messageOf } from '../../core/api/errors';
import { paymentOriginLabel } from './purchase-payment-origin';

/** An immediate metadata change, separate from editing a payment's amount or day. */
@Component({
  selector: 'app-purchase-payment-origin-editor',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="origin" aria-label="Betaalbron">
      <div class="field">
        <label [for]="'payment-origin-' + payment().id">Betaalbron</label>
        <select class="input" [id]="'payment-origin-' + payment().id" [disabled]="locked()" [ngModel]="source()" (ngModelChange)="source.set($event)">
          <option value="BANK">Eigen bankrekening</option>
          <option value="OLD_BANK_ACCOUNT">Oude bankrekening</option>
          <option value="OTHER_COMPANY">Andere vennootschap</option>
        </select>
      </div>
      @if (source() === 'OTHER_COMPANY') {
        <div class="field"><label [for]="'payment-payer-' + payment().id">Betaald door</label>
          <input class="input" [id]="'payment-payer-' + payment().id" maxlength="100" placeholder="Naam vennootschap" [disabled]="locked()" [ngModel]="payer()" (ngModelChange)="payer.set($event)" /></div>
      }
      @if (source() !== 'BANK') {
        <div class="field"><label [for]="'payment-origin-note-' + payment().id">Toelichting <span class="opt"></span></label>
          <input class="input" [id]="'payment-origin-note-' + payment().id" maxlength="500" placeholder="Bijvoorbeeld: oude bankrekening" [disabled]="locked()" [ngModel]="note()" (ngModelChange)="note.set($event)" /></div>
      }
      @if (payment().bankStatementLineId != null) { <p class="hint">Maak de bankkoppeling eerst los om de betaalbron te wijzigen.</p> }
      @else if (changedDraft()) {
        <button type="button" class="btn btn--sm" [disabled]="locked() || (source() === 'OTHER_COMPANY' && !payer().trim())" (click)="save()">{{ saving() ? 'Bewaren…' : 'Betaalbron bewaren' }}</button>
      } @else if (label(); as text) { <p class="hint">{{ text }}</p> }
      @if (error()) { <p class="hint hint--warn" role="alert">{{ error() }}</p> }
    </section>
  `,
  styles: [`.origin { display:grid; gap:10px; padding-block:12px; } .origin .field { min-width:0; } .origin .btn { justify-self:start; } .origin p { margin:0; }`],
})
export class PurchasePaymentOriginEditor {
  private readonly api = inject(SourcingApi);
  readonly payment = input.required<PurchasePayment>();
  readonly disabled = input(false);
  readonly changed = output<void>();
  readonly saving = signal(false);
  readonly error = signal('');
  readonly source = linkedSignal<'BANK' | PurchasePaymentOrigin['source']>(() => this.payment().origin?.source ?? 'BANK');
  readonly payer = linkedSignal(() => this.payment().origin?.payerName ?? '');
  readonly note = linkedSignal(() => this.payment().origin?.note ?? '');
  readonly locked = computed(() => this.disabled() || this.saving() || this.payment().bankStatementLineId != null);
  readonly label = computed(() => paymentOriginLabel(this.payment().origin));
  readonly request = computed<PurchasePaymentOrigin | null>(() => this.source() === 'BANK' ? null : ({
    source: this.source() as PurchasePaymentOrigin['source'],
    payerName: this.source() === 'OTHER_COMPANY' ? this.payer().trim() : null,
    note: this.note().trim() || null,
  }));
  readonly changedDraft = computed(() => JSON.stringify(this.request()) !== JSON.stringify(this.payment().origin ?? null));
  async save(): Promise<void> {
    if (this.locked()) return;
    this.saving.set(true); this.error.set('');
    try { await this.api.setPaymentOrigin(this.payment().id, this.request()); this.changed.emit(); }
    catch (failure) { this.error.set(messageOf(failure, 'Betaalbron bewaren is niet gelukt')); }
    finally { this.saving.set(false); }
  }
}
