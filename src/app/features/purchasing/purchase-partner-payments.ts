import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PurchaseOrder, SalesOrderView } from '../../core/api/models';
import { DateNlPipe, EurPipe, NumPipe } from '../../shared/pipes';

/**
 * The partner's side of the container's money, under the payments: what he
 * pays up front against the invoice we sent him, and after the auction what
 * the settlement brings back. Only on a partner container; a container we
 * pay ourselves has no such stream.
 */
@Component({
  selector: 'app-purchase-partner-payments',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, EurPipe, NumPipe, DateNlPipe],
  template: `
    @if (order().partnerCustomerId != null) {
      <div class="pay-stream pay-stream--partner">
        <div class="pay-stream__head">
          <span><b>Van de partner</b><small>{{ costPct() | num }} % van de gelande kost vooraf{{ costPct() < 100 ? ' · ' + (ownEur() | eur: 0) + ' eigen geld tot de veiling' : '' }}</small></span>
          <span class="num"><b>{{ receivedEur() | eur }}</b><small>van {{ expectedEur() | eur }}</small></span>
        </div>
        <div class="payments-meter"><div class="payments-meter__fill" [style.width.%]="expectedEur() > 0 ? Math.min(100, receivedEur() / expectedEur() * 100) : 0"></div></div>
        @if (costDocument(); as doc) {
          <div class="pay-line">
            <a class="pay-line__what" [routerLink]="['/sales', doc.order.id, 'edit']">
              <b>{{ doc.order.number }}{{ doc.order.docType === 'FACTUUR' ? '' : ' · nog geen factuur' }}</b>
              <small>@if (doc.order.docType === 'FACTUUR') { {{ doc.order.paidAt ? 'betaald op ' + (doc.order.paidAt | dateNl) : 'open · vervalt ' + (doc.order.invoiceDueDate ? (doc.order.invoiceDueDate | dateNl) : '—') }} } @else { offerte · maak de factuur zodra de partner akkoord is }</small>
            </a>
            <span class="num pay-line__amount">{{ doc.priced.totals.totalInclVat | eur }}</span>
          </div>
        } @else {
          <p class="pay-stream__note">Nog geen offerte of factuur voor de partner; maak die bij Order onder Partnercontainer.</p>
        }
        @if (settlement(); as doc) {
          <div class="pay-line">
            <a class="pay-line__what" [routerLink]="['/sales', doc.order.id, 'edit']">
              <b>{{ doc.order.number }} · veilingafrekening</b>
              <small>{{ doc.order.paidAt ? 'betaald op ' + (doc.order.paidAt | dateNl) : 'open · na de veiling' }}</small>
            </a>
            <span class="num pay-line__amount">{{ doc.priced.totals.totalInclVat | eur }}</span>
          </div>
        }
        @if (costDocument()?.order?.docType === 'FACTUUR' && costDocument()?.order?.paidAt) {
          <p class="pay-stream__done">✓ De partner heeft zijn deel betaald</p>
        }
      </div>
    }
  `,
})
export class PurchasePartnerPayments {
  readonly order = input.required<PurchaseOrder>();
  readonly docs = input<SalesOrderView[]>([]);
  readonly landedTotalEur = input(0);
  readonly Math = Math;

  readonly costPct = computed(() => this.order().partnerCostPct ?? 100);
  readonly expectedEur = computed(() => {
    const doc = this.costDocument();
    return doc ? doc.priced.totals.totalInclVat : Math.round(this.landedTotalEur() * this.costPct()) / 100;
  });
  readonly ownEur = computed(() => Math.round(this.landedTotalEur() * (100 - this.costPct())) / 100);
  readonly costDocument = computed(() => this.docs().find((deal) => !deal.order.partnerSettlement) ?? null);
  readonly settlement = computed(() => this.docs().find((deal) => deal.order.partnerSettlement) ?? null);
  readonly receivedEur = computed(() => {
    const doc = this.costDocument();
    return doc && doc.order.docType === 'FACTUUR' && doc.order.paidAt ? doc.priced.totals.totalInclVat : 0;
  });
}
