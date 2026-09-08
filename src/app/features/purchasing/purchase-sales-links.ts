import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { SalesOrderView } from '../../core/api/models';
import { salesDocumentKind } from '../sales/partner-settlement';
import { isPartnerDocument } from '../sales/sales-payment-state';

@Component({
  selector: 'app-purchase-sales-links',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `@if (documents().length) {
    <section aria-label="Gekoppelde verkoopdocumenten"><h3>Verkoopdocumenten van deze container</h3>
      @for (doc of documents(); track doc.order.id) { <a [routerLink]="['/sales', doc.order.id]"><b>{{ doc.order.number }} · {{ kind(doc.order) }}</b><small>{{ partner(doc.order) ? 'Partnerfinanciering / slotafrekening' : 'Reguliere verkoop · container als herkomst' }}</small></a> }
    </section>
  }`,
  styles: `section{margin:12px 0;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}h3{margin:0 0 8px;font-size:12px}a{display:grid;gap:4px;padding:9px 0;color:var(--rose-dark);text-decoration:none;font-size:12px}a+a{border-top:1px solid var(--line)}small{font-size:10px;color:var(--muted)}`,
})
export class PurchaseSalesLinks {
  readonly documents = input<SalesOrderView[]>([]);
  readonly kind = salesDocumentKind;
  readonly partner = isPartnerDocument;
}
