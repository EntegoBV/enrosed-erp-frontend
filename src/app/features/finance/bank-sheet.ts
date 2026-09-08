import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BankBalance } from '../../core/api/models';
import { DateField } from '../../shared/date-field';
import { DateNlPipe, EurPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';
import { receiptInstant, receiptLocalParts } from '../../shared/received-at';
import { blankBalance } from './finance-sections';
import { FinanceState } from './finance-state';

/** A balance observed at the bank, used as the starting point for later movements. */
@Component({
  selector: 'app-bank-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, Sheet, DateField, DateNlPipe, EurPipe],
  styles: `
    .bank-intro { margin: 0 0 18px; color: var(--muted); font-size: 13px; line-height: 1.6; }
    .bank-time-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .bank-time-option { display: grid; align-content: start; gap: 4px; padding: 12px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface-2); text-align: left; color: inherit; font: inherit; cursor: pointer; }
    .bank-time-option.on { border-color: var(--rose); background: var(--rose-soft); }
    .bank-time-option strong { font-size: 12px; }
    .bank-time-option span { color: var(--muted); font-size: 11px; line-height: 1.5; }
    .bank-preview { display: grid; gap: 5px; padding: 14px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--surface-2); }
    .bank-preview__label { color: var(--muted); font-size: 11px; }
    .bank-preview__value { font-size: 22px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .bank-preview p { margin: 0; font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
    .bank-preview small { color: var(--muted); font-size: 11px; line-height: 1.5; }
    .bank-account-chips { max-height: 120px; overflow-y: auto; }
    .bank-account-chips .fin-chip { max-width: 100%; overflow-wrap: anywhere; white-space: normal; text-align: left; }
    @media (max-width: 600px) {
      .bank-time-options { grid-template-columns: minmax(0, 1fr); }
      .bank-time-option { min-height: 56px; }
      .bank-checkpoint-form .input { min-height: 44px; }
    }
  `,
  template: `
    <app-sheet [title]="draft().id ? 'Vastgelegd banksaldo bewerken' : 'Banksaldo vastleggen'" (closed)="state.bankDraft.set(null)">
      <div body>
        <p class="bank-intro">Neem het volledige saldo over uit je bankapp of rekeningafschrift, met de datum en het tijdstip waarop dat saldo geldt. Vanaf dit punt volgen we de latere bewegingen op deze rekening.</p>
        <div class="form-grid bank-checkpoint-form">
          <div class="field span-2"><label class="req" for="b-account">Rekening</label>
            <input class="input" id="b-account" list="b-accounts" placeholder="Bijv. KBC zakelijk of BE12 3456 7890 1234" autocomplete="off" [ngModel]="draft().account" (ngModelChange)="patch({ account: $event })" />
            <datalist id="b-accounts">@for (account of state.accounts(); track account) { <option [value]="account"></option> }</datalist>
            @if (state.accounts().length) {
              <span class="hint">Kies een bestaande rekening of geef een nieuwe rekening op.</span>
              <div class="fin-chips bank-account-chips mt-8" role="group" aria-label="Bestaande rekeningen">
                @for (account of state.accounts(); track account) { <button type="button" class="fin-chip" [class.on]="draft().account === account" [attr.aria-pressed]="draft().account === account" (click)="patch({ account })">{{ account }}</button> }
              </div>
            } @else {
              <span class="hint">Je eerste rekening: kies een herkenbare naam of je IBAN. Gebruik dezelfde rekening bij je bankbewegingen en ontvangsten.</span>
            }</div>
          <div class="field span-2"><label>Wanneer geldt dit saldo?</label>
            <div class="bank-time-options" role="group" aria-label="Nauwkeurigheid van het banksaldo">
              <button class="bank-time-option" [class.on]="exactTime()" [attr.aria-pressed]="exactTime()" type="button" (click)="exactTime.set(true)"><strong>Op een exact tijdstip</strong><span>Bijvoorbeeld het saldo dat je nu in je bankapp ziet.</span></button>
              <button class="bank-time-option" [class.on]="!exactTime()" [attr.aria-pressed]="!exactTime()" type="button" (click)="exactTime.set(false)"><strong>Aan het einde van de dag</strong><span>Het eindsaldo op een afschrift, inclusief alle bewegingen van die dag.</span></button>
            </div>
          </div>
          <div class="field"><label class="req" for="b-date">Datum van het saldo</label>
            <app-date-field fieldId="b-date" [value]="draft().date" (valueChange)="patch({ date: $event })" /></div>
          @if (exactTime()) {
            <div class="field"><label class="req" for="b-time">Tijdstip</label><input id="b-time" class="input" type="time" step="1" [ngModel]="time()" (ngModelChange)="time.set($event)" /></div>
            <div class="field span-2"><label for="b-zone">Tijdzone</label><input class="input" id="b-zone" list="bank-time-zones" [ngModel]="zone()" (ngModelChange)="zone.set($event)" />
              <datalist id="bank-time-zones"><option value="Europe/Brussels"></option><option value="Europe/Amsterdam"></option><option value="UTC"></option></datalist>
              <span class="hint">Gebruik de tijdzone van het ingevoerde tijdstip. Latere bewegingen kunnen ook op dezelfde dag vallen.</span>
            </div>
          }
          <div class="field span-2"><label class="req" for="b-amount">Volledig banksaldo op dat moment</label>
            <span class="fin-money"><i>€</i><input class="input num right" id="b-amount" type="number" step="0.01" inputmode="decimal"
                   [ngModel]="draft().balanceEur" (ngModelChange)="patch({ balanceEur: +($event || 0) })" /></span>
            <span class="hint">Een nulsaldo of negatief saldo is ook mogelijk. Losse ontvangsten en uitgaven voer je in bij Bankbewegingen.</span></div>
          <div class="field span-2"><label for="b-notes">Notities <span class="opt"></span></label>
            <textarea class="textarea" id="b-notes" rows="2" placeholder="Bijv. overgenomen uit de bankapp of afschrift september" [ngModel]="draft().notes" (ngModelChange)="patch({ notes: $event })"></textarea></div>
          @if (timeError()) { <p class="field span-2" role="alert">{{ timeError() }}</p> }
          <div class="bank-preview span-2" aria-label="Controleer het banksaldo">
            <span class="bank-preview__label">Dit saldo leg je vast</span><strong class="bank-preview__value">{{ draft().balanceEur | eur }}</strong>
            <p>{{ (draft().account || '').trim() || 'Kies hierboven een rekening' }} · {{ draft().date | dateNl }}{{ exactTime() ? ' om ' + time() : ' aan het einde van de dag' }}</p>
            <small>Latere bankbewegingen en geregistreerde ontvangsten of terugbetalingen op deze rekening werken het berekende saldo bij.</small>
          </div>
        </div>
      </div>
      <div foot style="display:contents">
        @if (draft().id) { <button class="btn btn--danger" type="button" [disabled]="state.saving()" (click)="state.deleteBank(draft())">Verwijderen</button> }
        <span class="spacer"></span>
        <button class="btn" type="button" (click)="state.bankDraft.set(null)">Annuleren</button>
        <button class="btn btn--primary" type="button" [disabled]="state.saving() || !canSave()" (click)="save()">{{ state.saving() ? 'Bezig…' : draft().id ? 'Wijzigingen bewaren' : 'Saldo vastleggen' }}</button>
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
