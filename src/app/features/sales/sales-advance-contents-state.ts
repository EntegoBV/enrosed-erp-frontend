import type { AdvanceContents, Product, SalesOrderView } from '../../core/api/models';
import { isAdvanceDocument } from './sales-payment-state';

export function isAdvanceInvoice(view: SalesOrderView | null | undefined): boolean {
  return !!view && view.order.docType === 'FACTUUR' && isAdvanceDocument(view.order);
}

/** Only this invoice's immutable snapshot supplies quantities and transport facts. */
export function advanceContentsFor(view: SalesOrderView | null | undefined): AdvanceContents | null {
  const contents = view?.advanceContents;
  return isAdvanceInvoice(view) && contents && contents.purchaseOrderId === view?.order.partnerPurchaseOrderId ? contents : null;
}

const number = (value: number): string => new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 3 }).format(value);
export function advanceContentsSummary(view: SalesOrderView | null | undefined) {
  const contents = advanceContentsFor(view);
  const total = contents?.totals;
  return {
    lines: contents?.lines.length ?? null,
    productLines: contents ? `${contents.lines.length} ${contents.lines.length === 1 ? 'regel' : 'regels'}` : 'Nog te bevestigen',
    pieces: total ? `${number(total.pieces)} stuks` : 'Inhoud nog niet beschikbaar',
    load: total?.cartons != null ? `${number(total.cartons)} dozen` : 'Nog te bevestigen',
    volume: total?.cbm != null ? `${number(total.cbm)} m³` : 'Volume nog te bevestigen',
    arrival: contents?.delivery.expectedArrival ?? null,
    deliveryWeek: contents?.delivery.deliveryWeek ?? null,
  };
}

/** Catalog media may change, but catalog quantities/prices never replace invoice snapshot facts. */
export function advanceProductPhoto(products: readonly Product[], productId: number): string | null {
  const photos = products.find(product => product.id === productId)?.photos ?? [];
  return [...photos].sort((left, right) => left.position - right.position)[0]?.url ?? null;
}

/** Navigation describes the frozen planning, never the financial invoice's dummy freight state. */
export function advancePlanningHint(view: SalesOrderView | null | undefined): string {
  const delivery = advanceContentsFor(view)?.delivery;
  const date = delivery?.expectedArrival;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date.split('-').reverse().join('/');
  if (delivery?.deliveryWeek) {
    const week = /^(\d{4})-W(\d{2})$/.exec(delivery.deliveryWeek);
    return week ? `Week ${Number(week[2])} · ${week[1]}` : delivery.deliveryWeek;
  }
  if (delivery?.receivedOn) return 'Container ontvangen';
  if (delivery?.shippedOn) return 'Onderweg';
  return 'Nog te bevestigen';
}
