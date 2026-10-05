import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { SalesOrderView } from '../../core/api/models';
import { salesDocumentKind } from '../sales/partner-settlement';
import { isPartnerDocument } from '../sales/sales-payment-state';
import { billingKind, pctText } from '../sales/sales-advance-billing';
import { statusOf } from '../sales/quote-status';

/**
 * Paperwork of the container: the sales documents it is the source of. Money
 * in lives with the partner block. A regular sale paid in advance shows its
 * voorschotfacturen and slotfactuur with their status.
 */
@Component({
  selector: 'app-purchase-sales-links',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `@if (shown().length) {
    <section aria-label="Verkoopdocumenten"><h3>Verkoopdocumenten</h3>
      @for (doc of shown(); track doc.order.id) {
        <a [routerLink]="['/sales', doc.order.id]"><b>{{ doc.order.number }} · {{ kind(doc) }}</b><small>{{ sub(doc) }} · <span [class]="'status status--' + status(doc).cls">{{ status(doc).label }}</span></small></a>
      }
    </section>
  }`,
  styles: `section{margin:12px 0;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}h3{margin:0 0 8px;font-size:12px}a{display:grid;gap:4px;padding:9px 0;color:var(--rose-dark);text-decoration:none;font-size:12px}a+a{border-top:1px solid var(--line)}small{font-size:10px;color:var(--muted)}.status{font-weight:650}.status--ok{color:var(--ok)}.status--warn,.status--gold{color:var(--warn)}.status--danger{color:var(--danger)}`,
})
export class PurchaseSalesLinks {
  readonly documents = input<SalesOrderView[]>([]);
  /** The partner block already lists partner documents; leave them out next to it. */
  readonly excludePartner = input(false);
  readonly shown = computed(() => this.excludePartner()
    ? this.documents().filter(doc => !isPartnerDocument(doc.order)) : this.documents());
  readonly status = statusOf;

  kind(doc: SalesOrderView): string {
    const billing = billingKind(doc);
    const pct = billing === 'Voorschotfactuur' && doc.advanceBilling?.percentage != null ? ` ${pctText(doc.advanceBilling.percentage)} %` : '';
    return billing ? billing + pct : salesDocumentKind(doc.order, doc.settlement?.finalSettlement);
  }

  sub(doc: SalesOrderView): string {
    if (isPartnerDocument(doc.order)) return 'Partnerfinanciering / veilingafrekening';
    const quote = doc.advanceBilling?.quoteNumber;
    const billing = billingKind(doc);
    if (billing === 'Voorschotfactuur') return `Voorschot op offerte ${quote ?? ''}`.trim();
    if (billing === 'Slotfactuur') return `Verrekent de voorschotfacturen${quote ? ` · offerte ${quote}` : ''}`;
    const advances = (doc.advanceInvoices ?? []).length;
    return advances ? `Reguliere verkoop · ${advances} ${advances === 1 ? 'voorschotfactuur' : 'voorschotfacturen'}` : 'Reguliere verkoop · container als herkomst';
  }
}
