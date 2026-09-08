import type { SalesOrder, SalesOrderView, SalesPurpose } from '../../core/api/models';

export function salesPurpose(order: Pick<SalesOrder, 'purpose' | 'partnerPurchaseOrderId' | 'partnerSettlement'>): SalesPurpose {
  return order.purpose ?? (order.partnerPurchaseOrderId ? order.partnerSettlement ? 'PARTNER_SETTLEMENT' : 'PARTNER_ADVANCE' : 'STANDARD');
}

export function isAdvanceDocument(order: Pick<SalesOrder, 'purpose' | 'partnerPurchaseOrderId' | 'partnerSettlement'>): boolean {
  return salesPurpose(order) === 'PARTNER_ADVANCE';
}

export function isPartnerDocument(order: Pick<SalesOrder, 'purpose' | 'partnerPurchaseOrderId' | 'partnerSettlement'>): boolean {
  return salesPurpose(order) !== 'STANDARD';
}

/** Advances finance a container. Only the issued settlement can realize its result. */
export function displayedSalesProfit(view: SalesOrderView): number {
  if (!isPartnerDocument(view.order)) return view.priced.totals.marginEur;
  if (isAdvanceDocument(view.order) || view.order.docType !== 'FACTUUR'
      || ['CONCEPT', 'GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN'].includes(view.order.status)) return 0;
  return view.accounting?.recognizedProfitEur ?? 0;
}

/** A payment refresh must never replace a commercial draft still being edited. */
export function withPaymentState(current: SalesOrderView, fresh: SalesOrderView): SalesOrderView {
  return { ...current, paymentSummary: fresh.paymentSummary, accounting: fresh.accounting,
    order: { ...current.order, status: fresh.order.status, paidAt: fresh.order.paidAt } };
}
