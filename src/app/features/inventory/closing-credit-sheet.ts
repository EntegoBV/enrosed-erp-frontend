import { ChangeDetectionStrategy, Component, OnInit, computed, input, output, signal } from '@angular/core';
import type { ClosingContainer } from '../../core/api/inventory-models';
import { DateNlPipe, EurPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';
import type { CreditTreatmentChoice } from './inventory-closing';

type Credit = ClosingContainer['credits'][number];

export interface CreditChoice {
  choice: CreditTreatmentChoice;
  reason: string;
}

const CHOICES: readonly { value: CreditTreatmentChoice; label: string }[] = [
  { value: 'VERLAAGT', label: 'Verlaagt de aanschafwaarde (prijs of kwaliteit)' },
  { value: 'BUITEN', label: 'Buiten de voorraadwaarde (tekort, schade of iets anders dan de prijs)' },
  { value: 'IN_BETALING', label: 'Al afgetrokken van de betaling aan de leverancier' },
];

/**
 * "Wat is dit tegoed?": the user states what a supplier credit is, with a
 * reason. The ERP shows the three treatments and gives no advice; "Terug
 * naar het voorstel" takes a saved choice back.
 */
@Component({
  selector: 'app-closing-credit-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, EurPipe, DateNlPipe],
  template: `
    <app-sheet title="Wat is dit tegoed?" (closed)="closed.emit()">
      <div body class="inv-sheet">
        <p class="inv-sheet__lead"><strong>{{ credit().reasonLabel }} {{ credit().countedEur | eur }}</strong> · {{ container().displayName }} · genoteerd op {{ credit().notedOn | dateNl }}</p>
        <div class="inv-sheet__choices" role="radiogroup" aria-label="Wat is dit tegoed?">
          @for (option of choices; track option.value) {
            <button class="inv-sheet__choice" type="button" role="radio" [attr.aria-checked]="choice() === option.value" (click)="choice.set(option.value)"><span>{{ option.label }}</span></button>
          }
        </div>
        <div class="field inv-sheet__last">
          <label for="inv-credit-reason">Reden</label>
          <textarea class="textarea" id="inv-credit-reason" rows="3" maxlength="1000" [value]="reason()" (input)="reason.set($any($event.target).value)"></textarea>
        </div>
      </div>
      <div foot style="display:contents">
        @if (credit().decisionId !== null) {
          <button class="btn" type="button" [disabled]="busy()" (click)="remove.emit()">Terug naar het voorstel</button>
        } @else {
          <button class="btn" type="button" (click)="closed.emit()">Annuleren</button>
        }
        <button class="btn btn--primary" type="button" [disabled]="!canSave()" (click)="submit()">{{ busy() ? 'Bezig…' : 'Bewaren' }}</button>
      </div>
    </app-sheet>
  `,
})
export class ClosingCreditSheet implements OnInit {
  readonly container = input.required<ClosingContainer>();
  readonly credit = input.required<Credit>();
  readonly busy = input(false);
  readonly save = output<CreditChoice>();
  readonly remove = output<void>();
  readonly closed = output<void>();

  readonly choices = CHOICES;
  readonly choice = signal<CreditTreatmentChoice | null>(null);
  readonly reason = signal('');
  readonly canSave = computed(() => !this.busy() && !!this.choice() && !!this.reason().trim());

  /* Only a saved choice is prefilled: a proposal is not the user's statement. */
  ngOnInit(): void {
    const credit = this.credit();
    if (credit.decisionId === null || credit.treatment === 'NOG_TE_BESLISSEN') return;
    this.choice.set(credit.treatment);
    this.reason.set(credit.reason ?? '');
  }

  submit(): void {
    const choice = this.choice();
    if (!choice || !this.canSave()) return;
    this.save.emit({ choice, reason: this.reason().trim() });
  }
}
