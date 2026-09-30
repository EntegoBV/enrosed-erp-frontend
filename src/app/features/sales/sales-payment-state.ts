import type { SalesOrder, SalesOrderView, SalesPurpose } from '../../core/api/models';

export function salesPurpose(order: Pick<SalesOrder, 'purpose' | 'partnerPurchaseOrderId' | 'partnerSettlement'>): SalesPurpose {
  return order.purpose ?? (order.partnerPurchaseOrderId ? order.partnerSettlement ? 'PARTNER_SETTLEMENT' : 'PARTNER_ADVANCE' : 'STANDARD');
}

export function isAdvanceDocument(order: Pick<SalesOrder, 'purpose' | 'partnerPurchaseOrderId' | 'partnerSettlement'>): boolean {
  return salesPurpose(order) === 'PARTNER_ADVANCE';
}

/**
 * An invoice that carries no goods: a partner advance, or a regular
 * voorschotfactuur on a quote (advanceBilling stage ADVANCE, the same test as
 * isAdvanceBillingInvoice). It goes issue → send → receipts: the server
 * refuses to ship an invoice without product lines, so there is no shipping
 * step and no packing slip.
 */
export function skipsShipping(view: Pick<SalesOrderView, 'order' | 'advanceBilling'>): boolean {
  return isAdvanceDocument(view.order) || (view.advanceBilling?.stage === 'ADVANCE' && view.order.docType === 'FACTUUR');
}

export function isPartnerDocument(order: Pick<SalesOrder, 'purpose' | 'partnerPurchaseOrderId' | 'partnerSettlement'>): boolean {
  return salesPurpose(order) !== 'STANDARD';
}

/** The agreed production plan takes precedence over older customer payment terms. */
export function displayedPaymentTerms(
  order: Pick<SalesOrder, 'purpose' | 'partnerPurchaseOrderId' | 'partnerSettlement' | 'paymentPlan' | 'paymentTerms'> | null | undefined,
  fallback = 'Vooruitbetaling',
): string {
  if (order?.paymentPlan === 'THIRD_TWO_THIRDS_PRODUCTION') return '1/3 bij start productie, 2/3 na productie';
  if (order?.paymentPlan === 'FULL' && isPartnerDocument(order)) return 'Volledige betaling';
  return order?.paymentTerms || fallback;
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
