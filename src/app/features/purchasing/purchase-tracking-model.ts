import type { ContainerTracking, ContainerTrackingFeed } from '../../core/api/container-tracking-models';
import type { PurchaseOrder } from '../../core/api/models';

/** A saved order and its exact saved reference define the tracking snapshot. */
export function purchaseTrackingScope(orderId: number, trackingReference: string | null): string | null {
  return Number.isInteger(orderId) && orderId > 0 && trackingReference?.trim()
    ? JSON.stringify([orderId, trackingReference]) : null;
}

export function purchaseTrackingRow(
  feed: ContainerTrackingFeed | null, orderId: number, trackingReference: string | null,
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
