import { ActivityEvent } from '../../core/api/models';

const ACTION_LABELS: Record<string, string> = {
  CREATED: 'Aangemaakt',
  DUPLICATED: 'Gekopieerd',
  UPDATED: 'Aangepast',
  SENT: 'Verstuurd',
  SHIPPED: 'Goederen verzonden',
  PAID: 'Betaald',
  STATUS_CHANGED: 'Status gewijzigd',
  RECEIVED: 'Ontvangst genoteerd',
  PAYMENT_ADDED: 'Betaling genoteerd',
  PAYMENT_DELETED: 'Betaling verwijderd',
  DOCUMENT_ADDED: 'Document toegevoegd',
  DOCUMENT_RENAMED: 'Document hernoemd',
  DOCUMENT_DELETED: 'Document verwijderd',
  STOCK_BOOKED: 'Voorraad bijgeboekt',
  COSTS_APPLIED: 'Kostprijzen toegepast',
  DELETED: 'Verwijderd',
  CUSTOMER_ACCEPTED: 'Door klant aanvaard',
  CUSTOMER_REJECTED: 'Door klant afgewezen',
  CUSTOMER_CHANGE_REQUESTED: 'Wijziging gevraagd',
};

export function activityActionLabel(action: string): string {
  const key = action.trim().toUpperCase();
  return ACTION_LABELS[key] ?? action.replaceAll('_', ' ').toLocaleLowerCase('nl-BE');
}

export function activityEntityLabel(event: ActivityEvent): string {
  const type = event.entityType.trim().toUpperCase();
  if (type === 'PURCHASE_ORDER') return 'Inkooporder';
  if (type === 'SALES_ORDER') {
    return /factuur/i.test(`${event.entityLabel ?? ''} ${event.summary}`) ? 'Factuur' : 'Offerte';
  }
  if (type === 'PRODUCT') return 'Product';
  if (type === 'PRODUCT_FAMILY') return 'Productfamilie';
  if (type === 'SUPPLIER') return 'Leverancier';
  if (type === 'CUSTOMER') return 'Klant';
  if (type === 'PLANNER_ITEM') return 'Planning';
  return event.entityType.replaceAll('_', ' ').toLocaleLowerCase('nl-BE');
}

export function activityRoute(event: ActivityEvent): string[] | null {
  if (event.action.trim().toUpperCase() === 'DELETED') return null;
  if (event.entityId === null) return null;
  const type = event.entityType.trim().toUpperCase();
  if (type === 'PURCHASE_ORDER') return ['/purchasing', String(event.entityId)];
  if (type === 'SALES_ORDER') return ['/sales', String(event.entityId)];
  if (type === 'PRODUCT') return ['/products', String(event.entityId)];
  if (type === 'PRODUCT_FAMILY') return ['/website/products'];
  return null;
}
