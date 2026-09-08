import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BankBalance } from '../../core/api/models';
import { DateField } from '../../shared/date-field';
import { Sheet } from '../../shared/ui';
import { receiptInstant, receiptLocalParts } from '../../shared/received-at';
import { blankBalance } from './finance-sections';
import { FinanceState } from './finance-state';

/** A bank reading: which account, which day, what it held. */
@Component({
  selector: 'app-bank-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet, DateField],
  template: `
    <app-sheet [title]="draft().id ? 'Saldo bewerken' : 'Banksaldo ingeven'" (closed)="state.bankDraft.set(null)">
      <div body>
        <div class="form-grid">
          <div class="field span-2"><label class="req" for="b-account">Rekening</label>
            <input class="input" id="b-account" list="b-accounts" placeholder="bijv. KBC zichtrekening" [ngModel]="draft().account" (ngModelChange)="patch({ account: $event })" />
            <datalist id="b-accounts">@for (account of state.accounts(); track account) { <option [value]="account"></option> }</datalist>
            @if (state.accounts().length) {
              <div class="fin-chips mt-8">
                @for (account of state.accounts(); track account) { <button type="button" class="fin-chip" [class.on]="draft().account === account" (click)="patch({ account })">{{ account }}</button> }
              </div>
            }</div>
          <div class="field"><label class="req" for="b-date">Op datum</label>
            <app-date-field fieldId="b-date" [value]="draft().date" (valueChange)="patch({ date: $event })" /></div>
          <div class="field"><label for="b-exact"><input id="b-exact" type="checkbox" [ngModel]="exactTime()" (ngModelChange)="exactTime.set($event)" /> Exact tijdstip</label>
            @if (exactTime()) {
              <input class="input" aria-label="Tijdstip van het banksaldo" type="time" step="1" [ngModel]="time()" (ngModelChange)="time.set($event)" />
            } @else { <span class="hint">Saldo aan het einde van deze dag. Alle betalingen op deze datum zijn al inbegrepen.</span> }
          </div>
          @if (exactTime()) {
            <div class="field span-2"><label for="b-zone">Tijdzone</label><input class="input" id="b-zone" list="bank-time-zones" [ngModel]="zone()" (ngModelChange)="zone.set($event)" />
              <datalist id="bank-time-zones"><option value="Europe/Brussels"></option><option value="Europe/Amsterdam"></option><option value="UTC"></option></datalist>
              <span class="hint">Ontvangsten na dit tijdstip tellen mee, ook op dezelfde dag. Kosten en inkoopbetalingen zonder tijdstip tellen vanaf de volgende dag.</span>
            </div>
          }
          <div class="field"><label class="req" for="b-amount">Saldo</label>
            <span class="fin-money"><i>€</i><input class="input num right" id="b-amount" type="number" step="0.01" inputmode="decimal"
                   [ngModel]="draft().balanceEur === 0 && !draft().id ? null : draft().balanceEur" (ngModelChange)="patch({ balanceEur: +($event || 0) })" /></span>
            <span class="hint">Negatief mag: een kredietlijn onder nul.</span></div>
          <div class="field span-2"><label for="b-notes">Notities <span class="opt"></span></label>
            <textarea class="textarea" id="b-notes" rows="2" [ngModel]="draft().notes" (ngModelChange)="patch({ notes: $event })"></textarea></div>
          @if (timeError()) { <p class="field span-2" role="alert">{{ timeError() }}</p> }
        </div>
      </div>
      <div foot style="display:contents">
        @if (draft().id) { <button class="btn btn--danger" type="button" [disabled]="state.saving()" (click)="state.deleteBank(draft())">Verwijderen</button> }
        <span class="spacer"></span>
        <button class="btn" type="button" (click)="state.bankDraft.set(null)">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="state.saving() || !canSave()" (click)="save()">{{ state.saving() ? 'Bezig…' : draft().id ? 'Bewaren' : 'Ingeven' }}</button>
      </div>
    </app-sheet>
  `,
})
export class BankSheet {
  readonly state = inject(FinanceState);
  readonly draft = linkedSignal<BankBalance>(() => this.state.bankDraft() ?? blankBalance());
  readonly zone = linkedSignal(() => this.state.bankDraft()?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Brussels');
  readonly exactTime = linkedSignal(() => !this.state.bankDraft()?.id || !!this.state.bankDraft()?.asOfAt);
  readonly time = linkedSignal(() => receiptLocalParts(this.state.bankDraft()?.asOfAt || Date.now(), this.state.bankDraft()?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Brussels').time);
  readonly timeError = computed(() => {
    if (!this.exactTime()) return '';
    try { receiptInstant(this.draft().date, this.time(), this.zone()); return ''; }
    catch (error) { return error instanceof Error ? error.message : 'Controleer het tijdstip.'; }
  });
  readonly canSave = computed(() => !!(this.draft().account ?? '').trim() && !!this.draft().date && Number.isFinite(this.draft().balanceEur) && !this.timeError());

  save(): void {
    if (!this.canSave()) return;
    const row = this.draft();
    let asOfAt: string | null = this.exactTime() ? receiptInstant(row.date, this.time(), this.zone()) : null;
    if (asOfAt && row.asOfAt && this.zone() === row.timeZone) {
      const original = receiptLocalParts(row.asOfAt, this.zone());
      if (original.day === row.date && original.time === this.time()) asOfAt = row.asOfAt;
    }
    void this.state.saveBank({ ...row, asOfAt, timeZone: asOfAt ? this.zone() : null });
  }

  patch(changes: Partial<BankBalance>): void {
    this.draft.update((draft) => ({ ...draft, ...changes }));
  }
}
