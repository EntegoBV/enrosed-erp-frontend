import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Icon } from '../../shared/icon';
import { EurPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';
import { bankAccountKey, bankCheckpoint } from './bank-reconciliation';
import { dayMonthYear } from './finance-format';
import { FinanceState } from './finance-state';
import { paymentMomentLabel } from './incoming-money';

/** 'Saldogeschiedenis': every reading of one account, newest first; a tap corrects or deletes it. */
@Component({
  selector: 'app-account-history-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, EurPipe, Icon],
  template: `
    <app-sheet variant="ios" [title]="'Saldogeschiedenis · ' + label()" (closed)="state.historyAccount.set(null)">
      <div body class="fin-sheet">
        @if (readings().length) {
          <div class="ios-group fin-history">
            @for (reading of readings(); track reading.id) {
              <button class="ios-cell" type="button" (click)="state.historyAccount.set(null); state.openBank(reading)">
                <span class="ios-cell__body"><span class="ios-cell__title">{{ moment(reading.asOfAt, reading.date, reading.timeZone) }}</span>
                  @if (reading.notes) { <span class="ios-cell__sub">{{ reading.notes }}</span> }</span>
                <span class="ios-cell__trail"><span class="ios-cell__value ios-cell__value--strong">{{ reading.balanceEur | eur }}</span></span>
                <app-icon class="ios-cell__chev" name="chevron-right" [size]="16" />
              </button>
            }
          </div>
        } @else {
          <p class="fin-hint">Nog geen saldo voor deze rekening.</p>
        }
      </div>
    </app-sheet>
  `,
})
export class AccountHistorySheet {
  readonly state = inject(FinanceState);
  readonly label = computed(() => this.state.accountLabel(this.state.historyAccount()));
  readonly readings = computed(() => this.state.balances()
    .filter((row) => bankAccountKey(row.account) === this.state.historyAccount())
    .sort((a, b) => bankCheckpoint(b) - bankCheckpoint(a) || (b.id ?? 0) - (a.id ?? 0)));

  moment(asOfAt: string | null | undefined, date: string, timeZone: string | null | undefined): string {
    return asOfAt ? paymentMomentLabel({ receivedAt: asOfAt, timeZone: timeZone || 'Europe/Brussels' }) : `${dayMonthYear(date)}, einde van de dag`;
  }
}
