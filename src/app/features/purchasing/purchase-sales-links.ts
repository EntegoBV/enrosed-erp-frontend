import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { SalesOrderView } from '../../core/api/models';
import { salesDocumentKind } from '../sales/partner-settlement';
import { isPartnerDocument } from '../sales/sales-payment-state';

/** Paperwork of the container: the sales documents it is the source of. Money in lives with the partner block. */
@Component({
  selector: 'app-purchase-sales-links',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `@if (shown().length) {
    <section aria-label="Verkoopdocumenten"><h3>Verkoopdocumenten</h3>
      @for (doc of shown(); track doc.order.id) { <a [routerLink]="['/sales', doc.order.id]"><b>{{ doc.order.number }} · {{ kind(doc.order, doc.settlement?.finalSettlement) }}</b><small>{{ partner(doc.order) ? 'Partnerfinanciering / veilingafrekening' : 'Reguliere verkoop · container als herkomst' }}</small></a> }
    </section>
  }`,
  styles: `section{margin:12px 0;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}h3{margin:0 0 8px;font-size:12px}a{display:grid;gap:4px;padding:9px 0;color:var(--rose-dark);text-decoration:none;font-size:12px}a+a{border-top:1px solid var(--line)}small{font-size:10px;color:var(--muted)}`,
})
export class PurchaseSalesLinks {
  readonly documents = input<SalesOrderView[]>([]);
  /** The partner block already lists partner documents; leave them out next to it. */
  readonly excludePartner = input(false);
  readonly shown = computed(() => this.excludePartner()
    ? this.documents().filter(doc => !isPartnerDocument(doc.order)) : this.documents());
  readonly kind = salesDocumentKind;
  readonly partner = isPartnerDocument;
}
