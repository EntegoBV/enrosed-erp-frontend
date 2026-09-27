import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DateField } from '../../shared/date-field';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { Sheet } from '../../shared/ui';
import { FinanceState, MovementDraft } from './finance-state';

/**
 * 'Bankbeweging noteren': what the statement says, typed over. Money in or
 * out, the amount, the account, the day and (only when it matters) the time.
 * It records; nothing is paid. Opened from anywhere through FinanceState.
 */
@Component({
  selector: 'app-bank-movement-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, DateField, Segmented],
  template: `
    @if (state.movementDraft(); as draft) {
      <app-sheet variant="ios" title="Bankbeweging noteren" (closed)="state.closeMovement()">
        <div body class="fin-sheet">
          <app-segmented [variant]="state.desk() ? 'desk' : 'ios'" label="Richting" [options]="directions" [value]="draft.direction"
                         (changed)="patch({ direction: $any($event) })" />
          <label class="fin-amount">
            <span class="fin-sr">Bedrag</span><i aria-hidden="true">€</i>
            <input type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0,00" data-initial-focus
                   [value]="draft.amount || ''" (input)="patch({ amount: +$any($event.target).value })" (keydown.enter)="save()" />
          </label>
          <div class="fin-group" [class.ios-group]="!state.desk()">
            <div class="fin-field fin-field--stack"><span>Rekening</span>
              <div class="fin-choice" role="group" aria-label="Rekening">
                @for (option of state.accountOptions(); track option.key) {
                  <button class="fin-choice__chip" type="button" [attr.aria-pressed]="!other() && draft.account === option.label" (click)="other.set(false); patch({ account: option.label })">{{ option.label }}</button>
                }
                <button class="fin-choice__chip" type="button" [attr.aria-pressed]="other() || !knownAccount()" (click)="pickOther()">Andere…</button>
              </div>
              @if (other() || !knownAccount() || !state.accountOptions().length) {
                <input class="input" maxlength="120" placeholder="Rekeningnaam of IBAN" [value]="draft.account" (input)="other.set(true); patch({ account: $any($event.target).value })" />
              }
            </div>
          </div>
          <div class="fin-group" [class.ios-group]="!state.desk()">
            <div class="fin-field-row">
              <label class="fin-field"><span>Datum</span><app-date-field fieldId="move-day" [value]="draft.day" (valueChange)="patch({ day: $event })" /></label>
              <div class="fin-field"><span>Tijdstip</span>
                @if (draft.time === null) {
                  <button class="fin-inline-btn" type="button" (click)="patch({ time: nowTime() })">{{ draft.day === state.today() ? 'nu' : 'midden van de dag' }} · aanpassen</button>
                } @else {
                  <input class="input" type="time" step="60" [value]="draft.time" (input)="patch({ time: $any($event.target).value || null })" />
                }
              </div>
            </div>
          </div>
          <div class="fin-group" [class.ios-group]="!state.desk()">
            <label class="fin-field"><span>Van / aan wie</span>
              <input class="input" maxlength="300" [value]="draft.counterparty" (input)="patch({ counterparty: $any($event.target).value })" (keydown.enter)="save()" /></label>
            <label class="fin-field"><span>Mededeling</span>
              <input class="input" maxlength="500" placeholder="Bijvoorbeeld het factuurnummer" [value]="draft.reference" (input)="patch({ reference: $any($event.target).value })" (keydown.enter)="save()" /></label>
          </div>
          <p class="fin-hint">Tijdzone · {{ draft.timeZone }}</p>
          @if (state.movementError()) { <p class="fin-error" role="alert">{{ state.movementError() }}</p> }
        </div>
        <div foot style="display:contents">
          <span class="fin-foot-note">Dit registreert alleen; er wordt niets betaald.</span>
          <button class="btn btn--primary" type="button" [disabled]="state.movementBusy()" (click)="save()">{{ state.movementBusy() ? 'Bewaren…' : 'Bewaren' }}</button>
        </div>
      </app-sheet>
    }
  `,
})
export class BankMovementSheet {
  readonly state = inject(FinanceState);
  readonly directions: SegmentOption[] = [{ id: 'INCOMING', label: 'Geld in' }, { id: 'OUTGOING', label: 'Geld uit' }];
  readonly other = signal(false);
  readonly knownAccount = computed(() => {
    const account = this.state.movementDraft()?.account ?? '';
    return !account || this.state.accountOptions().some((option) => option.label === account);
  });

  patch(changes: Partial<MovementDraft>): void {
    if (this.state.movementBusy()) return;
    this.state.movementDraft.update((draft) => (draft ? { ...draft, ...changes } : draft));
    this.state.movementError.set('');
  }

  pickOther(): void {
    this.other.set(true);
    this.patch({ account: '' });
  }

  nowTime(): string {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Europe/Brussels' }).format(new Date());
  }

  save(): void {
    void this.state.saveMovement();
  }
}
