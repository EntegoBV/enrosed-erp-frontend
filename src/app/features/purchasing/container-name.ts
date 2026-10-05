/*
 * One name for a container, everywhere in Verkoop: our own 'Herkenbare naam'
 * (the purchase order's alias, e.g. "container/2026/002"), else the PO
 * number, else 'Inkoop #id'. The backend applies the same rule
 * (PurchaseOrder.displayName) and sends it as `partnerContainerName` on sales
 * views. Pure and node-tested: type-only imports.
 */

/** What naming needs of a purchase order: a PurchaseOrder fits, so does a light lookup row. */
export interface ContainerNameSource {
  id?: number | null;
  number?: string | null;
  alias?: string | null;
}

/** What naming needs of a sales view: the server's live name (newer backend) and the frozen cargo snapshot. */
export interface SalesContainerSource {
  order: { partnerPurchaseOrderId?: number | null; sourcePurchaseOrderId?: number | null };
  partnerContainerName?: string | null;
  partnerContainerNumber?: string | null;
  advanceContents?: { purchaseOrderId: number; purchaseOrderNumber: string } | null;
}

const text = (value: string | null | undefined): string => (typeof value === 'string' ? value.trim() : '');
const validId = (value: number | null | undefined): value is number => Number.isSafeInteger(value) && (value as number) > 0;

/** alias, else number, else 'Inkoop #id' ('Inkooporder' when not even an id is known). */
export function containerName(po: ContainerNameSource | null | undefined, fallbackId?: number | null): string {
  const alias = text(po?.alias);
  if (alias) return alias;
  const number = text(po?.number);
  if (number) return number;
  const id = validId(po?.id) ? po!.id! : validId(fallbackId) ? fallbackId : null;
  return id != null ? `Inkoop #${id}` : 'Inkooporder';
}

/** The PO number as small print next to a name: only when it says something the name does not. */
export function containerNumberHint(name: string | null | undefined, number: string | null | undefined): string | null {
  const shown = text(number);
  return shown && shown !== text(name) ? shown : null;
}

/** "container PO-2026-011", but "container/2026/002" as it is: the word is never said twice. */
export function containerPhrase(name: string | null | undefined): string {
  const shown = text(name);
  if (!shown) return 'de container';
  return /^container\b/i.test(shown) ? shown : `container ${shown}`;
}

/** The container a sales document belongs to: its regular-sale source, else its partner container (backend linkedPurchaseOrderId). */
export function linkedPurchaseOrderId(order: SalesContainerSource['order'] | null | undefined): number | null {
  const source = order?.sourcePurchaseOrderId;
  if (validId(source)) return source;
  const partner = order?.partnerPurchaseOrderId;
  return validId(partner) ? partner : null;
}

/**
 * A sales document's container name, freshest first: the purchase order
 * itself when the screen loaded it, the server's live name, the live number,
 * the advance's cargo snapshot, 'Inkoop #id'. Null without a container.
 */
export function salesContainerName(view: SalesContainerSource | null | undefined, live?: ContainerNameSource | null): string | null {
  const id = linkedPurchaseOrderId(view?.order);
  if (id == null) return null;
  if (live && (live.id == null || live.id === id) && (text(live.alias) || text(live.number))) return containerName(live, id);
  const name = text(view?.partnerContainerName) || text(view?.partnerContainerNumber);
  if (name) return name;
  const snapshot = view?.advanceContents;
  if (snapshot && snapshot.purchaseOrderId === id && text(snapshot.purchaseOrderNumber)) return text(snapshot.purchaseOrderNumber);
  return `Inkoop #${id}`;
}

/** The container's PO number when the screen knows it, for the small print beside the name. */
export function salesContainerNumber(view: SalesContainerSource | null | undefined, live?: ContainerNameSource | null): string | null {
  const id = linkedPurchaseOrderId(view?.order);
  if (id == null) return null;
  if (live && (live.id == null || live.id === id) && text(live.number)) return text(live.number);
  const number = text(view?.partnerContainerNumber);
  if (number) return number;
  const snapshot = view?.advanceContents;
  return snapshot && snapshot.purchaseOrderId === id && text(snapshot.purchaseOrderNumber) ? text(snapshot.purchaseOrderNumber) : null;
}
