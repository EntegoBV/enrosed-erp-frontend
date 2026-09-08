import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Customer } from '../../core/api/models';
import { EurPipe } from '../../shared/pipes';
import { IncomingMoneyRow, incomingPurposeLabel, paymentMomentLabel, uniqueIncomingPayments } from './incoming-money';

@Component({
  selector: 'app-incoming-payment-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, EurPipe],
  styles: `
    .receipt { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; padding:11px 0; border-bottom:1px solid var(--line); }
    .receipt:last-child { border-bottom:0; } .receipt__body { display:grid; gap:3px; min-width:0; }
    .receipt small { color:var(--muted); font-size:12px; overflow-wrap:anywhere; } .receipt b { font-variant-numeric:tabular-nums; }
    .receipt a { color:var(--rose-dark); font-weight:650; text-decoration:none; } .receipt__amount { color:var(--ok); white-space:nowrap; }
  `,
  template: `
    @if (!rows().length) { <p class="fin-empty">Nog geen inkomende betalingen geregistreerd.</p> }
    @for (row of visible(); track row.id) {
      <div class="receipt">
        <span class="receipt__body">
          <a [routerLink]="['/sales', row.salesOrderId, 'edit']">{{ row.orderNumber }} · {{ purposeLabel(row.purpose) }} ›</a>
          <small>{{ momentLabel(row) }}{{ customerName(row.customerId) ? ' · ' + customerName(row.customerId) : '' }}</small>
          @if (row.reference) { <small>{{ row.reference }}</small> }
          @if (row.purchaseOrderId) { <a [routerLink]="['/purchasing', row.purchaseOrderId]">Gekoppelde container ›</a> }
          @if (row.legacy) { <small>Overgenomen uit eerdere betaaldregistratie</small> }
        </span>
        <b class="receipt__amount">+ {{ row.amountEur | eur }}</b>
      </div>
    }
    @if (!expanded() && rows().length > limit()) { <button class="linklike" type="button" (click)="expanded.set(true)">Alle {{ rows().length }} ontvangsten bekijken ›</button> }
  `,
})
export class IncomingPaymentList {
  readonly payments = input<readonly IncomingMoneyRow[]>([]);
  readonly customers = input<readonly Customer[]>([]);
  readonly limit = input(12);
  readonly expanded = signal(false);
  readonly rows = computed(() => uniqueIncomingPayments(this.payments()));
  readonly visible = computed(() => this.expanded() ? this.rows() : this.rows().slice(0, this.limit()));
  readonly purposeLabel = incomingPurposeLabel;
  readonly momentLabel = paymentMomentLabel;
  customerName(id: number | null): string { return this.customers().find((row) => row.id === id)?.company ?? ''; }
}
