import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { SalesAdvanceDeduction, SalesOrderView } from '../../core/api/models';
import { EurPipe } from '../../shared/pipes';
import { dayText, deductionPaidText, isFinalBillingInvoice } from './sales-advance-billing';

/**
 * 'Verrekende voorschotfacturen' on a slotfactuur (desk, phone view and
 * editor): the advances the server deducted, frozen at creation, each with
 * its paid date and a link. Read-only: the deduction lines are the server's.
 * Styles: src/styles/sales-advance-billing.scss (adv-*).
 */
@Component({
  selector: 'app-sales-advance-deductions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, EurPipe],
  template: `
    @if (rows().length) {
      <section class="adv-card adv-card--final" aria-labelledby="adv-deductions-title">
        <header class="adv-card__head">
          <div><span>Slotfactuur@if (view().advanceBilling?.quoteNumber) { · offerte {{ view().advanceBilling!.quoteNumber }} }</span><h2 id="adv-deductions-title">Verrekende voorschotfacturen</h2></div>
          @if (view().advanceBilling?.quoteId) { <a class="adv-card__link" [routerLink]="['/sales', view().advanceBilling!.quoteId]">Offerte ›</a> }
        </header>
        <ul class="adv-list" aria-label="Verrekende voorschotfacturen">
          @for (row of rows(); track row.advanceInvoiceId) {
            <li>
              <a class="adv-row" [routerLink]="['/sales', row.advanceInvoiceId]">
                <span class="adv-row__who"><b>{{ row.number }}</b><small>van {{ day(row.invoiceDate) }}</small></span>
                <span class="adv-row__money"><b>− {{ row.exclEur | eur }} <small>excl. btw</small></b><small>btw {{ row.vatEur | eur }} · incl. {{ row.inclEur | eur }}</small></span>
                <span [class]="'adv-pill adv-pill--' + tone(row)"><i aria-hidden="true"></i>{{ paid(row) }}</span>
              </a>
            </li>
          }
        </ul>
        <dl class="adv-sum">
          <div><dt>Totale waarde excl. btw</dt><dd>{{ fullValue() | eur }}</dd></div>
          <div><dt>Verrekende voorschotten</dt><dd>− {{ deducted() | eur }}</dd></div>
          <div class="adv-sum__rest"><dt>Saldo excl. btw <small>de btw volgt het saldo</small></dt><dd>{{ view().priced.totals.total | eur }}</dd></div>
        </dl>
        <p class="adv-note">De regels 'Voorschotfactuur … van …' komen van de server en staan vast; aantallen en prijzen van de producten kun je in het concept nog corrigeren.</p>
      </section>
    }
  `,
})
export class SalesAdvanceDeductions {
  readonly view = input.required<SalesOrderView>();
  readonly rows = computed(() => isFinalBillingInvoice(this.view()) ? this.view().advanceDeductions ?? [] : []);
  readonly deducted = computed(() => Math.round(this.rows().reduce((sum, row) => sum + (Number.isFinite(row.exclEur) ? row.exclEur : 0), 0) * 100) / 100);
  readonly fullValue = computed(() => Math.round(((this.view().priced.totals.total ?? 0) + this.deducted()) * 100) / 100);
  readonly day = dayText;
  readonly paid = deductionPaidText;
  tone(row: SalesAdvanceDeduction): 'ok' | 'warn' | 'rose' {
    return row.paidOn ? 'ok' : (row.receipts ?? []).some((receipt) => receipt.amountEur > 0) ? 'warn' : 'rose';
  }
}
