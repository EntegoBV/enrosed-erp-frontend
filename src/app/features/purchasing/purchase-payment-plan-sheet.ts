import { ChangeDetectionStrategy, Component, computed, input, linkedSignal, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PAYMENT_TERMS, type Instalment, type PurchaseOrder } from '../../core/api/models';
import { EurPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';
import { instalmentsOf, paymentPlanError, paymentPlanLabel, planPreview, splitTotal, type PaymentPlanFields } from './payment-plan';

const MOMENT: Record<Instalment['due'], string> = { ORDERED: 'bij bestelling', SHIPPED: 'bij vertrek', ARRIVED: 'bij aankomst' };

/** Changes stay inside this sheet until the server accepts the new plan. */
@Component({
  selector: 'app-purchase-payment-plan-sheet',
  imports: [FormsModule, Sheet, EurPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-sheet title="Betaalplan leverancier" variant="ios" (closed)="close()">
      <div body class="payment-plan-form">
        <p>Eerdere betalingen behouden hun bedrag, datum en omschrijving. Het nieuwe plan bepaalt wat er per termijn nog openstaat.</p>
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
        @if (!validation() && preview().length) {
          <div class="payment-plan-form__terms" role="table" aria-label="Bedrag per termijn">
            <div class="payment-plan-form__row payment-plan-form__row--head" role="row"><span role="columnheader">Bedrag per termijn</span><span role="columnheader">{{ agreedEur() | eur }}</span></div>
            @for (step of preview(); track step.due) {
              <div class="payment-plan-form__row" role="row"><span role="cell">{{ step.label }}</span><b role="cell">{{ step.amountEur | eur }}</b></div>
            }
          </div>
        }
        @if (paidEur() > 0) {
          <p>Al betaald aan de leverancier: <b>{{ paidEur() | eur }}</b>. Na opslaan verdeelt het systeem dat opnieuw over de termijnen.</p>
        }
        @if (droppedDue(); as due) {
          <p role="alert" class="payment-plan-form__warning">Er zijn betalingen gekoppeld aan ‘{{ moment[due] }}’. Behoud dat moment in het plan, of koppel die betalingen eerst los.</p>
        }
        @if (validation() || error()) { <p role="alert" class="payment-plan-form__error">{{ validation() || error() }}</p> }
      </div>
      <div foot style="display:contents">
        <button class="btn" type="button" [disabled]="busy()" (click)="close()">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="busy() || !!validation()" (click)="confirm()">{{ busy() ? 'Betaalplan opslaan…' : 'Betaalplan opslaan' }}</button>
      </div>
    </app-sheet>
  `,
  styles: `
    .payment-plan-form { display: grid; gap: 12px; }
    .payment-plan-form > p { margin: 0; color: var(--muted); font-size: 12px; line-height: 1.6; }
    .payment-plan-form > p b { color: var(--ink); }
    label { display: grid; gap: 7px; color: var(--ink); font-size: 12px; font-weight: 650; }
    select, input { width: 100%; min-width: 0; min-height: 46px; font-size: 16px; }
    .payment-plan-form__percentages { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .payment-plan-form__percentages span { display: flex; align-items: center; gap: 5px; }
    .payment-plan-form .payment-plan-form__preview { padding: 12px; border-radius: 12px; background: var(--surface-2); color: var(--ink-2); }
    .payment-plan-form__terms { border: 1px solid var(--line); border-radius: 12px; background: var(--surface); overflow: hidden; }
    .payment-plan-form__row { display: flex; justify-content: space-between; gap: 12px; padding: 9px 12px; font-size: 13px; font-variant-numeric: tabular-nums; }
    .payment-plan-form__row + .payment-plan-form__row { border-top: 1px solid var(--line); }
    .payment-plan-form__row--head { background: var(--surface-2); color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    .payment-plan-form .payment-plan-form__warning { padding: 12px; border-radius: 12px; background: var(--warn-soft); color: #7c450b; }
    .payment-plan-form .payment-plan-form__error { padding: 12px; border-radius: 12px; background: var(--danger-soft); color: var(--danger); }
  `,
})
export class PurchasePaymentPlanSheet {
  readonly order = input.required<PurchaseOrder>();
  readonly busy = input(false);
  readonly error = input<string | null>(null);
  /** What the supplier is agreed to be paid, for the euro amount per term. */
  readonly agreedEur = input(0);
  /** Paid to the supplier so far; the server spreads it again over the new plan. */
  readonly paidEur = input(0);
  /** Moments that supplier payments are tied to; the server refuses a plan without them. */
  readonly scopedDues = input<readonly Instalment['due'][]>([]);
  readonly saved = output<PaymentPlanFields>();
  readonly closed = output();
  readonly options = PAYMENT_TERMS;
  readonly moment = MOMENT;
  readonly draft = linkedSignal<PaymentPlanFields>(() => ({
    paymentTerms: this.order().paymentTerms ?? 'THIRDS', payPctOrdered: this.order().payPctOrdered ?? null,
    payPctShipped: this.order().payPctShipped ?? null, payPctArrived: this.order().payPctArrived ?? null,
  }));
  readonly validation = computed(() => paymentPlanError(this.draft()));
  readonly total = computed(() => splitTotal(this.draft().payPctOrdered, this.draft().payPctShipped, this.draft().payPctArrived));
  readonly label = computed(() => paymentPlanLabel(this.draft(), PAYMENT_TERMS));
  private readonly instalments = computed(() => instalmentsOf({ ...this.order(), ...this.draft() }, PAYMENT_TERMS));
  readonly preview = computed(() => planPreview(this.agreedEur(), this.instalments()));
  /** Mirrors the server's refusal; the server stays the judge. */
  readonly droppedDue = computed(() => this.scopedDues().find(due => !this.instalments().some(step => step.due === due)) ?? null);
  close(): void { if (!this.busy()) this.closed.emit(); }
  confirm(): void { if (!this.busy() && !this.validation()) this.saved.emit(this.draft()); }
}
