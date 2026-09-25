import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { EurPipe } from '../../shared/pipes';
import { Sheet } from '../../shared/ui';
import type { BankMatch } from '../../core/api/banking-api';
import { BankMovementPanel } from './bank-movement-panel';

/**
 * 'Factuur koppelen' for one bank line. The state machine (suggestions,
 * existing receipts, the duplicate guard, the busy lock) stays in
 * BankMovementPanel; this is its dialog, rendered at page level so no
 * scrolling pane traps it.
 */
@Component({
  selector: 'app-bank-allocation-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Sheet, EurPipe],
  template: `
    @let p = panel();
    @if (p.selected(); as row) {
      <app-sheet variant="ios" title="Factuur koppelen" [wide]="true" (closed)="p.closeAllocation()">
        <div body class="fin-sheet fin-alloc">
          <div class="fin-alloc__movement">
            <span>{{ row.amountEur > 0 ? 'Ontvangen op' : 'Betaald vanaf' }} {{ p.accountName(row.account) }}</span>
            <strong>{{ row.amountEur | eur }}</strong>
            <small>{{ p.stamp(row.bookedAt, row.timeZone) }}{{ row.counterparty ? ' · ' + row.counterparty : '' }}</small>
            @if (row.reference) { <small>{{ row.reference }}</small> }
          </div>
          @if (row.amountEur < 0) { <p class="fin-hint">Een uitgaande beweging koppel je alleen aan een terugbetaling op een factuur.</p> }
          @if (p.matchingLoading()) { <p class="fin-hint" role="status">Voorstellen zoeken…</p> }
          @if (p.matches().length) {
            <h3 class="fin-alloc__label">Voorstellen</h3>
            <div class="fin-alloc__cards" role="group" aria-label="Voorstellen">
              @for (match of p.matches(); track key(match)) {
                <button class="fin-match" type="button" [disabled]="p.busy()" [attr.aria-pressed]="p.isChosen(match)" (click)="p.chooseMatch(match)">
                  <span class="fin-match__kind">{{ match.existingPaymentId ? 'Bestaande betaling koppelen' : row.amountEur < 0 ? 'Nieuwe terugbetaling op de factuur' : 'Nieuwe betaling op de factuur' }}</span>
                  <b>{{ match.number }}</b>
                  <span>{{ match.openEur | eur }} {{ row.amountEur < 0 ? 'terug te betalen' : 'nog te ontvangen' }}</span>
                  @if (match.receivedAt) { <small>Geboekt {{ p.matchStamp(match) }}{{ match.reference ? ' · ' + match.reference : '' }}</small> }
                </button>
              }
            </div>
          }
          <h3 class="fin-alloc__label">Zelf een factuur kiezen</h3>
          <select class="select" [disabled]="p.busy()" [value]="p.manualInvoice()" (change)="p.chooseInvoice(+$any($event.target).value)" aria-label="Factuur">
            <option value="0">Kies een factuur…</option>
            @for (view of p.selectableInvoices(); track view.order.id) {
              <option [value]="view.order.id" [selected]="view.order.id === p.manualInvoice()">{{ view.order.number }} · {{ p.customerName(view.order.customerId) }} · {{ p.available(view) | eur }} {{ row.amountEur < 0 ? 'terug te betalen' : 'open' }}</option>
            }
          </select>
          @if (!p.selectableInvoices().length && !p.matchingLoading()) {
            <p class="fin-hint">{{ row.amountEur < 0 ? 'Geen factuur met genoeg tegoed voor deze terugbetaling.' : 'Geen uitgegeven verkoopfactuur gevonden.' }}</p>
          }
          @if (p.manualInvoice()) {
            <div class="fin-alloc__cards">
              @for (match of p.manualMatches(); track key(match)) {
                <button class="fin-match" type="button" [disabled]="p.busy()" [attr.aria-pressed]="p.isChosen(match)" (click)="p.chooseMatch(match, true)">
                  <span class="fin-match__kind">Bestaande betaling koppelen</span>
                  <b>{{ p.matchStamp(match) }}</b><small>{{ match.reference || 'Deze betaling wordt niet opnieuw geboekt.' }}</small>
                </button>
              }
              @if (p.manualNewMatch(); as match) {
                <button class="fin-match" type="button" [disabled]="p.busy()" [attr.aria-pressed]="p.isChosen(match)" (click)="p.chooseMatch(match, true)">
                  <span class="fin-match__kind">{{ row.amountEur < 0 ? 'Nieuwe terugbetaling op de factuur' : 'Nieuwe betaling op de factuur' }}</span>
                  <b>{{ match.number }}</b><span>{{ match.openEur | eur }} {{ row.amountEur < 0 ? 'terug te betalen' : 'nog te ontvangen' }}</span>
                </button>
              }
            </div>
          }
          @if (p.choice(); as chosen) {
            @if (!chosen.existingPaymentId && row.amountEur > 0 && row.amountEur > chosen.openEur) {
              <p class="fin-hint fin-hint--warn">{{ row.amountEur - chosen.openEur | eur }} meer dan wat openstaat; het wordt als teveel ontvangen geregistreerd.</p>
            }
            @if (!chosen.existingPaymentId && p.chosenInvoiceHasExistingMatches()) {
              <label class="fin-check"><input type="checkbox" [disabled]="p.busy()" [checked]="p.newBookingConfirmed()" (change)="p.newBookingConfirmed.set($any($event.target).checked)" />
                <span>Ik heb de bestaande betalingen gecontroleerd; dit is een andere betaling.</span></label>
            }
          }
          @if (p.error()) { <p class="fin-error" role="alert">{{ p.error() }}</p> }
        </div>
        <div foot style="display:contents">
          <button class="btn" type="button" [disabled]="p.busy()" (click)="p.closeAllocation()">Annuleren</button>
          <span class="spacer"></span>
          <button class="btn btn--primary" type="button" [disabled]="!p.canAllocate()" (click)="p.allocate()">{{ p.busy() ? 'Koppelen…' : 'Koppelen' }}</button>
        </div>
      </app-sheet>
    }
  `,
})
export class BankAllocationSheet {
  readonly panel = input.required<BankMovementPanel>();

  key(match: BankMatch): string {
    return `${match.salesOrderId}:${match.existingPaymentId ?? 'new'}`;
  }
}
