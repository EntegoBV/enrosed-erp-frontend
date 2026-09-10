import type { SalesOrderView } from '../../core/api/models';

/** Converting a quotation creates a draft invoice; sending is a separate action. */
export function canCreateInvoiceFromQuote(view: SalesOrderView | null | undefined): boolean {
  if (!view) return false;
  const order = view.order;
  return (order.docType ?? 'OFFERTE') === 'OFFERTE'
    && !order.archivedAt && !view.invoicedAsId && !view.invoicedAs
    && !view.advanceAgreement
    && (order.status === 'CONCEPT' || order.status === 'GEACCEPTEERD');
}
