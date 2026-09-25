import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DateField } from '../../shared/date-field';
import { EurPipe } from '../../shared/pipes';
import { Segmented, SegmentOption } from '../../shared/segmented';
import { Sheet } from '../../shared/ui';
import { receiptInstant } from '../../shared/received-at';
import { bankCheckpoint } from './bank-reconciliation';
import { dayMonthYear } from './finance-format';
import { addDays, inclOf } from './finance-metrics';
import { FinanceState } from './finance-state';

type PaidChoice = 'today' | 'yesterday' | 'cost' | 'other';

/**
 * 'Betaald zetten' for one cost or a selection: the day it was paid and,
 * when switched on, an outgoing bank line per cost on a chosen account (the
 * choice is remembered on this device). Never a one-tap write.
 */
@Component({
  selector: 'app-pay-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, DateField, EurPipe, Segmented],
  template: `
    <app-sheet variant="ios" [title]="costs().length === 1 ? 'Betaald zetten' : costs().length + ' kosten betaald zetten'" (closed)="state.paySheet.set(null)">
      <div body class="fin-sheet">
        <p class="fin-sheet__lead">{{ costs().length === 1 ? costs()[0].description : costs().length + ' kosten' }} · {{ total() | eur }} incl. btw</p>
        <div class="fin-group" [class.ios-group]="!state.desk()">
          <div class="fin-field fin-field--stack"><span>Betaald op</span>
            <app-segmented [variant]="state.desk() ? 'desk' : 'ios'" label="Betaald op" [options]="choices()" [value]="choice()" (changed)="choice.set($any($event))" />
            @if (choice() === 'other') { <app-date-field fieldId="pay-day" [value]="otherDay()" (valueChange)="otherDay.set($event)" /> }
            <span class="fin-hint">{{ paidLabel() }}</span>
          </div>
          <label class="fin-field fin-field--switch"><span>Ook als bankbeweging noteren<small>Een uitgaande beweging per kost, met een verwijzing naar de kost</small></span>
            <input [class]="state.desk() ? 'fin-checkbox' : 'ios-switch'" type="checkbox" role="switch" [checked]="toBank()" (change)="toBank.set($any($event.target).checked)" /></label>
          @if (toBank()) {
            <div class="fin-field fin-field--stack"><span>Rekening</span>
              @if (state.accountOptions().length) {
                <div class="fin-choice" role="group" aria-label="Rekening">
                  @for (option of state.accountOptions(); track option.key) {
                    <button class="fin-choice__chip" type="button" [attr.aria-pressed]="account() === option.key" (click)="account.set(option.key)">{{ option.label }}</button>
                  }
                </div>
              } @else {
                <span class="fin-hint">Nog geen rekening: vul eerst een saldo in bij Bank.</span>
              }
            </div>
          }
        </div>
        @if (toBank()) {
          @if (future()) { <p class="fin-hint fin-hint--warn">Een bankbeweging kan niet in de toekomst liggen.</p> }
          @else if (accountHint(); as hint) { <p class="fin-hint">{{ hint }}</p> }
        }
      </div>
      <div foot style="display:contents">
        <button class="btn btn--primary" type="button" [disabled]="!canSave()" (click)="save()">{{ state.busy() ? 'Bezig…' : 'Betaald zetten' }}</button>
      </div>
    </app-sheet>
  `,
})
export class PaySheet {
  readonly state = inject(FinanceState);
  readonly costs = computed(() => this.state.paySheet()?.costs ?? []);
  readonly total = computed(() => Math.round(this.costs().reduce((sum, cost) => sum + inclOf(cost) * 100, 0)) / 100);
  private readonly preference = this.state.payToBank();
  readonly choice = signal<PaidChoice>('today');
  readonly otherDay = signal(this.state.today());
  readonly toBank = signal(this.preference.on);
  readonly account = signal(this.state.accountOptions().some((option) => option.key === this.preference.accountKey)
    ? this.preference.accountKey : this.state.accountOptions().length === 1 ? this.state.accountOptions()[0].key : '');

  /** 'Kostdatum' only when the costs share one date. */
  readonly choices = computed<SegmentOption[]>(() => {
    const dates = new Set(this.costs().map((cost) => cost.date));
    return [{ id: 'today', label: 'Vandaag' }, { id: 'yesterday', label: 'Gisteren' },
      ...(dates.size === 1 ? [{ id: 'cost', label: 'Kostdatum' }] : []), { id: 'other', label: 'Andere datum', shortLabel: 'Andere' }];
  });
  readonly paidOn = computed(() => {
    const today = this.state.today();
    switch (this.choice()) {
      case 'yesterday': return addDays(today, -1);
      case 'cost': return this.costs()[0]?.date ?? today;
      case 'other': return this.otherDay();
      default: return today;
    }
  });
  readonly paidLabel = computed(() => dayMonthYear(this.paidOn()));
  readonly future = computed(() => this.paidOn() > this.state.today());
  readonly canSave = computed(() => !!this.paidOn() && !this.state.busy() && (!this.toBank() || (!!this.account() && !this.future())));

  /** Whether the line lands after the account's last check (and so moves its balance). */
  readonly accountHint = computed(() => {
    const account = this.state.accountsView().find((row) => row.account === this.account());
    if (!account) return '';
    if (!account.reading) return `${account.label} heeft nog geen saldo; de beweging telt mee zodra je er een invult.`;
    const paidOn = this.paidOn();
    let at: number;
    try { at = paidOn === this.state.today() ? Date.now() : Date.parse(receiptInstant(paidOn, '12:00:00', 'Europe/Brussels')); } catch { return ''; }
    return at <= bankCheckpoint(account.reading)
      ? `Valt vóór je laatste saldocontrole van ${account.label} (${dayMonthYear(account.reading.date)}); zit al in dat saldo.`
      : `Telt mee in het saldo van ${account.label}.`;
  });

  save(): void {
    if (!this.canSave()) return;
    this.state.rememberPayToBank({ on: this.toBank(), accountKey: this.account() || this.preference.accountKey });
    void this.state.markPaid(this.costs(), { paidOn: this.paidOn(), bankAccount: this.toBank() ? this.account() : null });
  }
}
