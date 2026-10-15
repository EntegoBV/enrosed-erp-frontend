import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DateField } from '../../shared/date-field';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { Sheet } from '../../shared/ui';
import { FinanceState, MovementDraft } from './finance-state';
import { PartyField } from './party-field';
import { partyKey } from './party-suggestions';
import type { PartyCandidate } from './party-suggestions';

/**
 * 'Transactie noteren': what the statement says, typed over. Money in or
 * out, the amount, the account, the day and (only when it matters) the time.
 * It records; nothing is paid. Opened from anywhere through FinanceState.
 */
@Component({
  selector: 'app-bank-movement-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, DateField, Segmented, PartyField],
  template: `
    @if (state.movementDraft(); as draft) {
      <app-sheet variant="ios" title="Transactie noteren" (closed)="state.closeMovement()">
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
                @for (option of state.manualAccountOptions(); track option.key) {
                  <button class="fin-choice__chip" type="button" [attr.aria-pressed]="!other() && draft.account === option.key" (click)="other.set(false); patch({ account: option.key })">{{ option.label }}</button>
                }
                <button class="fin-choice__chip" type="button" [attr.aria-pressed]="other() || !knownAccount()" (click)="pickOther()">Andere…</button>
              </div>
              @if (other() || !knownAccount() || !state.manualAccountOptions().length) {
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
            <div class="fin-field fin-field--combo"><span><label for="move-party">Van / aan wie</label></span>
              <app-party-field fieldId="move-party" [value]="draft.counterparty" [candidates]="candidates()" [maxlength]="300" (valueChange)="patch({ counterparty: $event })" /></div>
            <label class="fin-field"><span>Mededeling</span>
              <input class="input" maxlength="500" placeholder="Bijvoorbeeld het factuurnummer" [value]="draft.reference" (input)="patch({ reference: $any($event.target).value })" (keydown.enter)="save()" /></label>
          </div>
          <p class="fin-hint">Rekeningen via Odoo gebruiken uitsluitend opgehaalde banktransacties. Open de rekening onder Bankrekeningen om deze transacties te koppelen.</p>
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
    return !account || this.state.manualAccountOptions().some((option) => option.key === account);
  });
  /** Money in comes from customers: their names and the earlier incoming counterparties, by how often they paid. */
  private readonly incomingCandidates = computed<PartyCandidate[]>(() => {
    const rows = new Map<string, PartyCandidate>();
    for (const customer of this.state.customers()) {
      const key = partyKey(customer.company);
      if (key && !rows.has(key)) rows.set(key, { name: customer.company.trim(), stored: true, count: 0, detail: 'Klant' });
    }
    for (const line of this.state.bankStatements()) {
      if (line.amountEur <= 0) continue;
      const key = partyKey(line.counterparty);
      if (!key) continue;
      const known = rows.get(key);
      if (known) known.count += 1;
      else rows.set(key, { name: line.counterparty.trim().replace(/\s+/g, ' '), stored: false, count: 1 });
    }
    for (const row of rows.values()) if (!row.stored) row.detail = `${row.count} ${row.count === 1 ? 'ontvangst' : 'ontvangsten'}`;
    return [...rows.values()];
  });
  /** Money out goes to the Aan wie names; money in comes from customers. Nothing else is prefilled. */
  readonly candidates = computed(() => (this.state.movementDraft()?.direction === 'OUTGOING' ? this.state.partySuggestions() : this.incomingCandidates()));

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
