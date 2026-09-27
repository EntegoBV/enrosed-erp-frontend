import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Currency } from '../../core/api/models';
import { DateField } from '../../shared/date-field';
import { PaymentProofPicker } from '../../shared/payment-proof-picker';
import { EurPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';

/** The editor's first-instalment prompt, as the sheet shows it. */
export interface FirstInstalmentDraft {
  label: string;
  amount: number | null;
  amountInput: string;
  currency: Currency;
  paidOn: string;
  files: File[];
}

/**
 * Just ordered: the first instalment falls due now. Asked once, with room for
 * the bank statement; the editor records it through the normal payment save.
 */
@Component({
  selector: 'app-purchase-first-instalment-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet, DateField, PaymentProofPicker, EurPipe],
  template: `
    @let first = prompt();
    <app-sheet title="Eerste betaling" variant="ios" (closed)="dismiss.emit()">
      <div body class="first-sheet">
        <p>De bestelling staat vast. Volgens het betaalplan is nu <b>{{ first.label }}</b> aan de beurt:
          <b>{{ first.amount | eur }}</b> aan {{ supplierName() }}.</p>
        <p class="hint">Al betaald? Noteer het hier, eventueel met het bankafschrift (max. 5 bestanden). Nog niet? Dan blijft de termijn open staan bij Betalingen.</p>
        <div class="form-grid">
          <div class="field">
            <label for="first-amount">Betaald bedrag</label>
            <div class="input-affix">
              <input class="input num right" id="first-amount" type="text" inputmode="decimal" autocomplete="off" [disabled]="busy()"
                     [ngModel]="first.amountInput" (ngModelChange)="amountInput.emit($event)" />
              <select class="input-affix__suffix" aria-label="Munt" [ngModel]="first.currency" (ngModelChange)="patch.emit({ currency: $event })">
                <option value="EUR">EUR</option><option value="USD">USD</option><option value="CNY">CNY</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label for="first-date">Betaald op</label>
            <app-date-field fieldId="first-date" [value]="first.paidOn" (valueChange)="patch.emit({ paidOn: $event })" />
          </div>
          <div class="field span-2">
            <app-payment-proof-picker title="Bewijs (bankafschrift)" [files]="first.files" [disabled]="busy()" (filesChange)="patch.emit({ files: $event })" />
          </div>
        </div>
      </div>
      <div foot style="display:contents">
        <button class="btn" type="button" (click)="dismiss.emit()">Later noteren</button>
        <button class="btn btn--primary" type="button" [disabled]="busy() || !((first.amount ?? 0) > 0)" (click)="confirm.emit()">
          {{ busy() ? 'Bezig…' : 'Betaling noteren' }}
        </button>
      </div>
    </app-sheet>
  `,
})
export class PurchaseFirstInstalmentSheet {
  readonly prompt = input.required<FirstInstalmentDraft>();
  readonly supplierName = input('');
  readonly busy = input(false);
  readonly patch = output<Partial<FirstInstalmentDraft>>();
  readonly amountInput = output<string>();
  readonly confirm = output<void>();
  readonly dismiss = output<void>();
}
