import type { ActivityCategory, ActivityEvent } from '../../core/api/models';

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
  PHOTO_ADDED: 'Foto toegevoegd',
  PHOTO_DELETED: 'Foto verwijderd',
  PHOTO_REORDERED: 'Foto’s herschikt',
  STOCK_BOOKED: 'Voorraad bijgeboekt',
  RECEIPT_REPORTED: 'Schade of tekort nagemeld',
  COSTS_APPLIED: 'Kostprijzen toegepast',
  DELETED: 'Verwijderd',
  CUSTOMER_ACCEPTED: 'Door klant aanvaard',
  CUSTOMER_REJECTED: 'Door klant afgewezen',
  CUSTOMER_CHANGE_REQUESTED: 'Wijziging gevraagd',
  IDENTITY_FINALIZED: 'Identiteit vastgelegd',
};

const ENTITY_CATEGORIES: Record<string, ActivityCategory> = {
  SALES_ORDER: 'SALES',
  PURCHASE_ORDER: 'PURCHASING',
  SUPPLIER: 'PURCHASING',
  PRODUCT: 'CATALOGUE',
  PRODUCT_FAMILY: 'CATALOGUE',
  CUSTOMER: 'RELATIONS',
  PLANNER_ITEM: 'PLANNING',
  COMPANY_COST: 'FINANCE',
  RECURRING_COST: 'FINANCE',
  BANK_BALANCE: 'FINANCE',
  BANK_STATEMENT: 'FINANCE',
};

const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  SALES: 'Verkoop',
  PURCHASING: 'Inkoop',
  CATALOGUE: 'Producten',
  RELATIONS: 'Relaties',
  PLANNING: 'Planning',
  FINANCE: 'Kosten & bank',
  OTHER: 'Overig',
};

const CATEGORY_ICONS: Record<ActivityCategory, string> = {
  SALES: 'sales',
  PURCHASING: 'purchase',
  CATALOGUE: 'products',
  RELATIONS: 'customers',
  PLANNING: 'activity',
  FINANCE: 'exchange',
  OTHER: 'more',
};

export function activityActionLabel(action: string): string {
  const key = action.trim().toUpperCase();
  return ACTION_LABELS[key] ?? action.replaceAll('_', ' ').toLocaleLowerCase('nl-BE');
}

export function activityCategory(event: ActivityEvent): ActivityCategory {
  if (event.category && CATEGORY_LABELS[event.category]) return event.category;
  return ENTITY_CATEGORIES[event.entityType.trim().toUpperCase()] ?? 'OTHER';
}

export function activityCategoryLabel(category: ActivityCategory): string {
  return CATEGORY_LABELS[category];
}

export function activityCategoryIcon(category: ActivityCategory): string {
  return CATEGORY_ICONS[category];
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
  if (type === 'COMPANY_COST') return 'Kost';
  if (type === 'RECURRING_COST') return 'Vaste kost';
  if (type === 'BANK_BALANCE') return 'Banksaldo';
  if (type === 'BANK_STATEMENT') return 'Bankbeweging';
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
  if (FINANCE_TYPES.has(type)) return ['/costs'];
  return null;
}

const FINANCE_TYPES = new Set(['COMPANY_COST', 'RECURRING_COST', 'BANK_BALANCE', 'BANK_STATEMENT']);

/**
 * The query that goes with activityRoute: Kosten & bank keeps its section
 * in the query string, never in the path (a '?' inside a routerLink array
 * matched no route and ended on the dashboard).
 */
export function activityQueryParams(event: ActivityEvent): Record<string, string> | null {
  if (!activityRoute(event)) return null;
  const type = event.entityType.trim().toUpperCase();
  if (type === 'COMPANY_COST') return { view: 'costs', cost: String(event.entityId) };
  if (type === 'RECURRING_COST') return { view: 'costs', tab: 'recurring' };
  if (type === 'BANK_BALANCE') return { view: 'bank' };
  if (type === 'BANK_STATEMENT') return { view: 'bank', tab: 'movements' };
  return null;
}
