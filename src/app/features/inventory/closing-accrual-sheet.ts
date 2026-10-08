import { ChangeDetectionStrategy, Component, OnInit, computed, input, output, signal } from '@angular/core';
import type { ClosingContainer, ClosingStream } from '../../core/api/inventory-models';
import { EurPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';
import { decimalText, parseDecimal } from './closing-decision-sheet';
import { streamButtonLabel } from './inventory-closing';

export interface AccrualChoice {
  amountEur: number;
  invoiceReceived: boolean;
  reason: string;
}

/**
 * "Nog verschuldigd bedrag" of one payee stream of a container: the amount
 * that is still owed on the closing date, what it rests on and whether the
 * invoice has arrived (then it is a confirmed amount, otherwise an
 * estimate). "Terug naar de Afspraak" deletes the decision.
 */
@Component({
  selector: 'app-closing-accrual-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, EurPipe],
  template: `
    <app-sheet [title]="title()" (closed)="closed.emit()">
      <div body class="inv-sheet">
        <p class="inv-sheet__lead"><strong>{{ stream().payeeLabel }}</strong> · {{ container().displayName }}<br />
          Afspraak {{ stream().plannedEur | eur }} · betaald {{ stream().paidEur | eur }} · nog open {{ stream().openEur | eur }}</p>
        @if (stream().accrual?.stale) { <p class="inv-sheet__warn">Het open bedrag is gewijzigd: bevestig opnieuw</p> }
        @if (stream().status === 'SETTLED_LOWER') {
          <p class="inv-sheet__help">Deze betaalstroom is lager afgerekend dan de Afspraak; het lagere bedrag staat nu als aanschafwaarde. Is het verschil volgens je boekhouder een financiële korting en geen prijsvermindering? Vul het dan hier in, met de reden, en vink 'Factuur ontvangen' aan: het telt dan mee in de aanschafwaarde.</p>
        }
        <div class="field">
          <label for="inv-accrual-amount">Nog verschuldigd bedrag</label>
          <div class="input-affix">
            <input class="input num" id="inv-accrual-amount" type="text" inputmode="decimal" autocomplete="off" [value]="amount()" (input)="amount.set($any($event.target).value)" />
            <span class="input-affix__suffix">EUR</span>
          </div>
        </div>
        <div class="field">
          <label for="inv-accrual-reason">Waarop steunt dit bedrag?</label>
          <textarea class="textarea" id="inv-accrual-reason" rows="3" maxlength="1000" [value]="reason()" (input)="reason.set($any($event.target).value)"></textarea>
        </div>
        <label class="inv-check inv-sheet__last">
          <input type="checkbox" [checked]="invoiceReceived()" (change)="invoiceReceived.set($any($event.target).checked)" />
          <span>Factuur ontvangen</span>
        </label>
      </div>
      <div foot style="display:contents">
        @if (stream().accrual) {
          <button class="btn" type="button" [disabled]="busy()" (click)="remove.emit()">Terug naar de Afspraak</button>
        } @else {
          <button class="btn" type="button" (click)="closed.emit()">Annuleren</button>
        }
        <button class="btn btn--primary" type="button" [disabled]="!canSave()" (click)="submit()">{{ busy() ? 'Bezig…' : 'Bewaren' }}</button>
      </div>
    </app-sheet>
  `,
})
export class ClosingAccrualSheet implements OnInit {
  readonly container = input.required<ClosingContainer>();
  readonly stream = input.required<ClosingStream>();
  readonly busy = input(false);
  readonly save = output<AccrualChoice>();
  readonly remove = output<void>();
  readonly closed = output<void>();

  readonly amount = signal('');
  readonly reason = signal('');
  readonly invoiceReceived = signal(false);

  readonly title = computed(() => streamButtonLabel(this.stream()));
  private readonly amountEur = computed(() => parseDecimal(this.amount()));
  readonly canSave = computed(() => {
    const amount = this.amountEur();
    return !this.busy() && amount !== null && Number.isFinite(amount) && amount >= 0 && !!this.reason().trim();
  });

  /* A saved amount comes back as it was; otherwise the open Afspraak is the proposal (nothing open: empty). */
  ngOnInit(): void {
    const stream = this.stream();
    if (stream.accrual) {
      this.amount.set(decimalText(stream.accrual.amountEur));
      this.reason.set(stream.accrual.reason);
      this.invoiceReceived.set(stream.accrual.invoiceReceived);
    } else if (stream.openEur > 0) {
      this.amount.set(decimalText(stream.openEur));
    }
  }

  submit(): void {
    const amountEur = this.amountEur();
    if (amountEur === null || !this.canSave()) return;
    this.save.emit({ amountEur, invoiceReceived: this.invoiceReceived(), reason: this.reason().trim() });
  }
}
