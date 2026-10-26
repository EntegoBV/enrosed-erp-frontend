import type { ContainerTracking, ContainerTrackingFeed } from '../../core/api/container-tracking-models';

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
