import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PAYMENT_TERMS, type PurchaseOrder } from '../../core/api/models';
import { Sheet } from '../../shared/ui';
import { paymentPlanError, paymentPlanLabel, splitTotal, type PaymentPlanFields } from './payment-plan';

/** Changes stay inside this sheet until the server accepts the new agreement. */
@Component({
  selector: 'app-purchase-payment-plan-sheet',
  imports: [FormsModule, Sheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-sheet title="Betaalafspraak aanpassen" (closed)="close()">
      <div body class="payment-plan-form">
        <p>Eerdere betalingen behouden hun bedrag, datum en omschrijving. De nieuwe afspraak bepaalt wat er per termijn nog openstaat.</p>
        @let value = draft();
        <label for="purchase-payment-plan">Verdeling</label>
        <select id="purchase-payment-plan" class="select" [ngModel]="value.paymentTerms" [disabled]="busy()"
                (ngModelChange)="draft.set({ ...value, paymentTerms: $event })">
          @for (option of options; track option.value) { <option [value]="option.value">{{ option.label }}</option> }
        </select>
        @if (value.paymentTerms === 'CUSTOM') {
          <div class="payment-plan-form__percentages">
            <label>Bij bestelling <span><input class="input" type="number" inputmode="decimal" min="0" max="100" step="0.01" [ngModel]="value.payPctOrdered" [disabled]="busy()" (ngModelChange)="draft.set({ ...value, payPctOrdered: $event })" />%</span></label>
            <label>Bij vertrek <span><input class="input" type="number" inputmode="decimal" min="0" max="100" step="0.01" [ngModel]="value.payPctShipped" [disabled]="busy()" (ngModelChange)="draft.set({ ...value, payPctShipped: $event })" />%</span></label>
            <label>Bij aankomst <span><input class="input" type="number" inputmode="decimal" min="0" max="100" step="0.01" [ngModel]="value.payPctArrived" [disabled]="busy()" (ngModelChange)="draft.set({ ...value, payPctArrived: $event })" />%</span></label>
          </div>
          <p class="payment-plan-form__total">Samen {{ total() }}%</p>
        }
        <p class="payment-plan-form__preview">{{ label() }}</p>
        @if (validation() || error()) { <p role="alert" class="payment-plan-form__error">{{ validation() || error() }}</p> }
      </div>
      <div foot>
        <button class="btn" type="button" [disabled]="busy()" (click)="close()">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="busy() || !!validation()" (click)="confirm()">{{ busy() ? 'Afspraak opslaan…' : 'Afspraak opslaan' }}</button>
      </div>
    </app-sheet>
  `,
  styles: `
    .payment-plan-form { display: grid; gap: 12px; }
    .payment-plan-form > p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.6; }
    label { display: grid; gap: 7px; color: var(--ink); font-size: 12px; font-weight: 650; }
    select, input { width: 100%; min-width: 0; min-height: 46px; font-size: 16px; }
    .payment-plan-form__percentages { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .payment-plan-form__percentages span { display: flex; align-items: center; gap: 5px; }
    .payment-plan-form__preview { padding: 12px; border-radius: 12px; background: var(--surface-2); }
    .payment-plan-form .payment-plan-form__error { padding: 12px; border-radius: 12px; background: var(--danger-soft); color: var(--danger); }
    [foot] { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; width: 100%; }
  `,
})
export class PurchasePaymentPlanSheet {
  readonly order = input.required<PurchaseOrder>();
  readonly busy = input(false);
  readonly error = input<string | null>(null);
  readonly saved = output<PaymentPlanFields>();
  readonly closed = output();
  readonly options = PAYMENT_TERMS;
  readonly draft = linkedSignal<PaymentPlanFields>(() => ({
    paymentTerms: this.order().paymentTerms ?? 'THIRDS', payPctOrdered: this.order().payPctOrdered ?? null,
    payPctShipped: this.order().payPctShipped ?? null, payPctArrived: this.order().payPctArrived ?? null,
  }));
  readonly validation = computed(() => paymentPlanError(this.draft()));
  readonly total = computed(() => splitTotal(this.draft().payPctOrdered, this.draft().payPctShipped, this.draft().payPctArrived));
  readonly label = computed(() => paymentPlanLabel(this.draft(), PAYMENT_TERMS));
  close(): void { if (!this.busy()) this.closed.emit(); }
  confirm(): void { if (!this.busy() && !this.validation()) this.saved.emit(this.draft()); }
}
