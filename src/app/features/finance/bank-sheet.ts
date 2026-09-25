import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { BankBalance } from '../../core/api/models';
import { DateField } from '../../shared/date-field';
import { EurPipe } from '../../shared/pipes';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { Sheet } from '../../shared/ui';
import { receiptInstant, receiptLocalParts } from '../../shared/received-at';
import { dayMonthYear } from './finance-format';
import { blankBalance } from './finance-sections';
import { FinanceState } from './finance-state';

type Moment = 'now' | 'end' | 'moment';

/**
 * 'Saldo invullen' / 'Saldo corrigeren': the balance the bank app shows, and
 * when it held. Later movements on the account are counted from there. New
 * readings are in Brussels time; a corrected one keeps its own zone, and an
 * unchanged day and time keep the original instant.
 */
@Component({
  selector: 'app-bank-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, DateField, EurPipe, Segmented],
  template: `
    <app-sheet variant="ios" [title]="draft().id ? 'Saldo corrigeren' : 'Saldo invullen'" (closed)="state.bankDraft.set(null)">
      <div body class="fin-sheet">
        <div class="fin-group" [class.ios-group]="!state.desk()">
          <div class="fin-field fin-field--stack"><span>Rekening</span>
            @if (state.accountOptions().length) {
              <div class="fin-choice" role="group" aria-label="Bestaande rekeningen">
                @for (option of state.accountOptions(); track option.key) {
                  <button class="fin-choice__chip" type="button" [attr.aria-pressed]="!newAccount() && draft().account === option.label" (click)="newAccount.set(false); patch({ account: option.label })">{{ option.label }}</button>
                }
                <button class="fin-choice__chip" type="button" [attr.aria-pressed]="newAccount() || !known()" (click)="newAccount.set(true); patch({ account: '' })">Nieuwe rekening</button>
              </div>
            }
            @if (newAccount() || !known() || !state.accountOptions().length) {
              <input class="input" maxlength="120" placeholder="Bijv. KBC zakelijk of BE12 3456 7890 1234" autocomplete="off" [value]="draft().account" (input)="newAccount.set(true); patch({ account: $any($event.target).value })" />
            }
          </div>
        </div>
        <label class="fin-amount fin-amount--left">
          <span class="fin-field__label">Saldo</span><i aria-hidden="true">€</i>
          <input #amount type="number" step="0.01" inputmode="decimal" [value]="startBalance" (input)="typed(amount)" />
          <button class="fin-sign" type="button" aria-label="Plus of min" title="Negatief of positief" (click)="flipSign(amount)">±</button>
        </label>
        <p class="fin-hint">Een negatief saldo kan ook: tik op ±.</p>
        <div class="fin-group" [class.ios-group]="!state.desk()">
          <div class="fin-field fin-field--stack"><span>Wanneer?</span>
            <app-segmented [variant]="state.desk() ? 'desk' : 'ios'" label="Wanneer geldt dit saldo?" [options]="moments" [value]="mode()" (changed)="mode.set($any($event))" />
          </div>
          @if (mode() !== 'now') {
            <div class="fin-field-row">
              <label class="fin-field"><span>Datum</span><app-date-field fieldId="b-date" [value]="draft().date" (valueChange)="patch({ date: $event })" /></label>
              @if (mode() === 'moment') { <label class="fin-field"><span>Tijdstip</span><input class="input" type="time" step="60" [value]="time()" (input)="time.set($any($event.target).value)" /></label> }
            </div>
          }
          <label class="fin-field fin-field--stack"><span>Notities</span>
            <textarea class="textarea" rows="2" placeholder="Bijv. overgenomen uit de bankapp" [value]="draft().notes ?? ''" (input)="patch({ notes: $any($event.target).value })"></textarea></label>
        </div>
        @if (timeError()) { <p class="fin-error" role="alert">{{ timeError() }}</p> }
        <div class="fin-preview" aria-live="polite">
          <strong>{{ finite(draft().balanceEur) ? (draft().balanceEur | eur) : '—' }}</strong>
          <span>{{ (draft().account || '').trim() || 'Kies een rekening' }} · {{ when() }}</span>
        </div>
      </div>
      <div foot style="display:contents">
        @if (draft().id) { <button class="btn btn--danger" type="button" [disabled]="state.saving()" (click)="state.deleteBank(draft())">Verwijderen</button> }
        <span class="spacer"></span>
        <button class="btn btn--primary" type="button" [disabled]="state.saving() || !canSave()" (click)="save()">{{ state.saving() ? 'Bezig…' : 'Bewaren' }}</button>
      </div>
    </app-sheet>
  `,
})
export class BankSheet {
  readonly state = inject(FinanceState);
  readonly moments: SegmentOption[] = [{ id: 'now', label: 'Nu' }, { id: 'end', label: 'Einde van een dag' }, { id: 'moment', label: 'Ander moment' }];
  readonly draft = linkedSignal<BankBalance>(() => this.state.bankDraft() ?? blankBalance(this.state.today()));
  /**
   * The amount field is written once and then left to the keyboard: writing
   * the parsed number back would wipe a '-' being typed (the field reads empty
   * until a digit follows). A partial entry leaves the balance NaN, so Bewaren waits.
   */
  readonly startBalance = String(this.state.bankDraft()?.balanceEur ?? 0);
  readonly finite = Number.isFinite;
  /** A reading being corrected keeps its zone; new readings are Brussels time. */
  readonly zone = computed(() => (this.state.bankDraft()?.id && this.state.bankDraft()?.timeZone) || 'Europe/Brussels');
  readonly mode = linkedSignal<Moment>(() => {
    const draft = this.state.bankDraft();
    return !draft?.id ? 'now' : draft.asOfAt ? 'moment' : 'end';
  });
  readonly time = linkedSignal(() => receiptLocalParts(this.state.bankDraft()?.asOfAt || Date.now(), this.zone()).time.slice(0, 5));
  /** A new account is typed; an existing one is picked from the chips. '+ Rekening toevoegen' starts empty, so typing. */
  readonly newAccount = linkedSignal(() => !this.state.bankDraft()?.account);
  readonly known = computed(() => this.state.accountOptions().some((option) => option.label === this.draft().account));

  readonly timeError = computed(() => {
    if (this.mode() !== 'moment') return '';
    try { receiptInstant(this.draft().date, this.time(), this.zone()); return ''; }
    catch (error) { return error instanceof Error ? error.message : 'Controleer het tijdstip.'; }
  });
  readonly canSave = computed(() => !!(this.draft().account ?? '').trim() && (this.mode() === 'now' || !!this.draft().date)
    && Number.isFinite(this.draft().balanceEur) && !this.timeError());
  readonly when = computed(() => this.mode() === 'now' ? 'nu' : this.mode() === 'end'
    ? `${dayMonthYear(this.draft().date)}, einde van de dag` : `${dayMonthYear(this.draft().date)} om ${this.time()}`);

  save(): void {
    if (!this.canSave()) return;
    const row = this.draft();
    const zone = this.zone();
    let date = row.date;
    let asOfAt: string | null = null;
    if (this.mode() === 'now') {
      asOfAt = new Date().toISOString();
      date = receiptLocalParts(asOfAt, zone).day;
    } else if (this.mode() === 'moment') {
      asOfAt = receiptInstant(row.date, this.time(), zone);
      if (row.asOfAt && zone === row.timeZone) {
        const original = receiptLocalParts(row.asOfAt, zone);
        if (original.day === row.date && original.time.slice(0, 5) === this.time()) asOfAt = row.asOfAt;
      }
    }
    void this.state.saveBank({ ...row, date, asOfAt, timeZone: asOfAt ? zone : null });
  }

  patch(changes: Partial<BankBalance>): void {
    this.draft.update((draft) => ({ ...draft, ...changes }));
  }

  typed(input: HTMLInputElement): void {
    this.patch({ balanceEur: input.value === '' ? Number.NaN : input.valueAsNumber });
  }

  /** '±': a phone keypad has no minus key. */
  flipSign(input: HTMLInputElement): void {
    const value = input.valueAsNumber;
    if (!Number.isFinite(value) || value === 0) return;
    input.value = String(-value);
    this.typed(input);
  }
}
