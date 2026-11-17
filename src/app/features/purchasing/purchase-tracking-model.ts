import type { ContainerTracking, ContainerTrackingFeed } from '../../core/api/container-tracking-models';
import type { PurchaseOrder, PurchaseOrderView } from '../../core/api/models';

/** A saved order and its exact saved reference define the tracking snapshot. */
export function purchaseTrackingScope(orderId: number | null, trackingReference: string | null): string | null {
  return orderId !== null && Number.isInteger(orderId) && orderId > 0 && trackingReference?.trim()
    ? JSON.stringify([orderId, trackingReference]) : null;
}

export function purchaseTrackingRow(
  feed: ContainerTrackingFeed | null, orderId: number | null, trackingReference: string | null,
): ContainerTracking | null {
  if (!purchaseTrackingScope(orderId, trackingReference)) return null;
  return feed?.containers.find((row) => row.orderId === orderId && row.trackingReference === trackingReference) ?? null;
}

/** Display canonical saved dates without changing an editor's draft or inferring dates from vessel ETA. */
export function purchaseTrackedOrder<T extends Pick<PurchaseOrder, 'id' | 'trackingReference' | 'expectedArrival' | 'shippedOn'>>(
  order: T, row: ContainerTracking | null,
): T {
  const scope = purchaseTrackingScope(order.id, order.trackingReference ?? null);
  if (!scope || !row || scope !== purchaseTrackingScope(row.orderId, row.trackingReference)) return order;
  const expectedArrival = canonicalDate(row.orderExpectedArrival, order.expectedArrival);
  const shippedOn = canonicalDate(row.orderShippedOn, order.shippedOn);
  if (expectedArrival === order.expectedArrival && shippedOn === order.shippedOn) return order;
  return { ...order, expectedArrival, shippedOn };
}

/**
 * The tracking row right after the bill of lading was taken over, until the read that follows answers: the order's
 * two dates and the ship's arrival as the answer has them. The order pages read their dates from the row
 * (purchaseTrackedOrder), so a row from before the apply would show the old departure and arrival again. A move
 * noted for another day is dropped; the read brings the real one.
 */
export function billAppliedRow(row: ContainerTracking, fresh: Pick<PurchaseOrderView, 'order' | 'arrival'>): ContainerTracking {
  const expectedArrival = fresh.order.expectedArrival ?? null;
  const moved = (row.orderExpectedArrival ?? null) !== expectedArrival;
  const portArrivedOn = fresh.arrival?.portArrivedOn;
  return {
    ...row, orderExpectedArrival: expectedArrival, orderShippedOn: fresh.order.shippedOn ?? null,
    ...(portArrivedOn !== undefined ? { portArrivedOn } : {}),
    ...(moved ? { arrivalMovedFrom: null, arrivalMovedAt: null, arrivalMovedDays: null } : {}),
  };
}

/**
 * The tracking row right after the Aankomst sheet saved, until the read that follows answers (and on the desk while
 * it edits, where no read follows): what billAppliedRow takes from the answer (the departure, the arrival, the ship's
 * arrival a new departure may have taken back, a dropped move), the container's hand mark, and no source date
 * beside it until the read names one again. One helper for every host, so none keeps a day from before the save.
 */
export function arrivalSavedRow(row: ContainerTracking, fresh: Pick<PurchaseOrderView, 'order' | 'arrival'>): ContainerTracking {
  return { ...billAppliedRow(row, fresh), arrivalByHand: fresh.arrival?.containerByHand === true, sourceArrival: null };
}

/** Consume each fetched row once, so an old snapshot cannot undo a later manual save. */
export class PurchaseTrackingBaseline {
  private readonly seen = new WeakSet<ContainerTracking>();

  accept<T extends Pick<PurchaseOrder, 'id' | 'trackingReference' | 'expectedArrival' | 'shippedOn'>>(
    order: T, row: ContainerTracking | null, blocked: boolean,
  ): T {
    if (!row || this.seen.has(row)) return order;
    this.seen.add(row);
    return blocked ? order : purchaseTrackedOrder(order, row);
  }
}

function canonicalDate(value: string | null | undefined, fallback: string | null | undefined): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fallback;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : fallback;
}
