import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { SalesOrderView } from '../../core/api/models';
import { EurPipe } from '../../shared/pipes';
import {
  advanceBaseExcl, advanceInvoiceBlock, advancePaymentState, advancedExcl, dayText, finalInvoicePlan, isRegularQuote, liveAdvances,
  pctText, quoteSettlement, remainingToInvoiceExcl,
} from './sales-advance-billing';
import { canCreateInvoiceFromQuote } from './sales-invoice-actions';

/**
 * 'Voorschotfacturen' on a regular quote, desk and phone: the advances with
 * their payment state, what is left to invoice, 'Voorschotfactuur maken…'
 * and, once there are advances, what the slotfactuur will deduct (or, once
 * it exists, which slotfactuur settled them). The host
 * opens the sheet and makes the slotfactuur (page-level sheets, trap rule).
 * Styles: src/styles/sales-advance-billing.scss (adv-*).
 */
@Component({
  selector: 'app-sales-advance-billing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, EurPipe],
  template: `
    @if (shown()) {
      <section class="adv-card" [class.adv-card--ios]="variant() === 'ios'" aria-labelledby="adv-card-title">
        <header class="adv-card__head">
          <div><span>Offerte {{ view().order.number }}</span><h2 id="adv-card-title">Voorschotfacturen</h2></div>
          @if (!block()) {
            <button class="btn btn--sm" [class.btn--primary]="!advances().length" type="button" [disabled]="blocked()" [title]="blocked() ? 'Sla de wijzigingen eerst op' : ''" (click)="create.emit()">Voorschotfactuur maken…</button>
          }
        </header>
        @if (!advances().length) {
          <p class="adv-card__copy">Factureer een deel vooraf, bijvoorbeeld 30 % bij bestelling. De slotfactuur trekt de voorschotten later af, met de datum waarop ze betaald zijn.</p>
        } @else {
          <ul class="adv-list" aria-label="Voorschotfacturen van deze offerte">
            @for (advance of advances(); track advance.id) {
              @let state = paymentState(advance);
              <li>
                <a class="adv-row" [routerLink]="['/sales', advance.id]">
                  <span class="adv-row__who"><b>{{ advance.number }}</b><small>{{ advance.percentage != null ? pct(advance.percentage) + ' %' : 'Vast bedrag' }}@if (day(advance.invoiceDate)) { · {{ day(advance.invoiceDate) }} }</small></span>
                  <span class="adv-row__money"><b>{{ advance.amountExclEur | eur }} <small>excl. btw</small></b><small>{{ advance.totalInclVatEur | eur }} incl. btw</small></span>
                  <span [class]="'adv-pill adv-pill--' + state.cls"><i aria-hidden="true"></i>{{ state.label }}</span>
                </a>
              </li>
            }
          </ul>
        }
        <dl class="adv-sum">
          <div><dt>Offerte excl. btw</dt><dd>{{ base() | eur }}</dd></div>
          <div><dt>Als voorschot gefactureerd</dt><dd>{{ advanced() | eur }}</dd></div>
          <div class="adv-sum__rest"><dt>Nog te factureren</dt><dd>{{ (settled() ? 0 : remaining()) | eur }}</dd></div>
        </dl>
        @if (settled(); as s) {
          <p class="adv-note">Slotfactuur @if (s.id) { <a [routerLink]="['/sales', s.id]">{{ s.number }}</a> } @else { {{ s.number }} } verrekent deze voorschotfacturen@if (s.state) { · {{ s.state }}}.</p>
        } @else {
          @if (block(); as reason) { @if (advances().length || view().order.freight === 'TE_BEPALEN') { <p class="adv-note">{{ reason }}</p> } }
          @if (plan(); as p) {
            @if (p.blocking) { <p class="adv-note adv-note--warn" role="status">{{ p.blocking }} Daarna kun je de slotfactuur maken.</p> }
            @else if (p.negative && p.creditsKnown) { <p class="adv-note adv-note--warn" role="status">De voorschotten zijn hoger dan de offerte nu: de slotfactuur komt onder nul. Maak een creditnota op een voorschotfactuur.</p> }
            @else if (p.negative) { <p class="adv-note adv-note--warn" role="status">Vóór creditnota's zijn de voorschotten hoger dan de offerte nu: zonder creditnota op een voorschotfactuur komt de slotfactuur onder nul.</p> }
            @else { <p class="adv-note">De slotfactuur neemt de volledige offerte over en trekt {{ p.deductedExclEur | eur }} excl. btw aan voorschotten af@if (!p.creditsKnown) { (vóór creditnota's)} · saldo {{ p.balanceExclEur | eur }} excl. btw, btw op het saldo.</p> }
            @if (canFinal()) {
              <div class="adv-card__actions"><button class="btn btn--sm" type="button" [disabled]="blocked() || !!p.blocking" (click)="finalInvoice.emit()">Slotfactuur maken</button></div>
            }
          }
        }
      </section>
    }
  `,
})
export class SalesAdvanceBillingCard {
  readonly view = input.required<SalesOrderView>();
  /** Unsaved edits or another mutation: nothing may be created now. */
  readonly blocked = input(false);
  readonly variant = input<'default' | 'ios'>('default');
  readonly create = output<void>();
  readonly finalInvoice = output<void>();

  readonly advances = computed(() => liveAdvances(this.view()));
  /** Only on a regular quote, and once it is more than a first draft: sent, accepted, from a container, or already advanced. */
  readonly shown = computed(() => {
    const view = this.view();
    /* An older backend sends no advanceInvoices and has no advance endpoint: no card until it is live. */
    if (!isRegularQuote(view) || !Array.isArray(view.advanceInvoices)) return false;
    if (this.advances().length) return true;
    if (view.order.archivedAt || view.invoicedAsId || view.invoicedAs) return false;
    if (['GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN'].includes(view.order.status)) return false;
    return view.order.status !== 'CONCEPT' || view.order.sourcePurchaseOrderId != null;
  });
  readonly block = computed(() => advanceInvoiceBlock(this.view()));
  readonly base = computed(() => advanceBaseExcl(this.view()));
  readonly advanced = computed(() => advancedExcl(this.view()));
  readonly remaining = computed(() => remainingToInvoiceExcl(this.view()));
  readonly plan = computed(() => finalInvoicePlan(this.view()));
  /** The slotfactuur made from this quote: the card then says so instead of what it would deduct. */
  readonly settled = computed(() => quoteSettlement(this.view()));
  readonly canFinal = computed(() => canCreateInvoiceFromQuote(this.view()));
  readonly paymentState = advancePaymentState;
  readonly day = dayText;
  readonly pct = pctText;
}
