import type { PurchaseOrderView } from '../../core/api/models';
import { containerName } from '../purchasing/container-name';

/** A received container that carried a product: what a damage or shortage report can point at. */
export interface ReceivedContainer {
  id: number;
  number: string;
  /** The container's one name (containerName(): Herkenbare naam, else the number). */
  name: string;
  receivedOn: string | null;
}

/** The received containers that carried this product, newest first (at most 12), so a report can name its origin. */
export function receivedContainersFor(orders: readonly PurchaseOrderView[], productId: number): ReceivedContainer[] {
  return orders
    .filter((row) => row.order.status === 'ONTVANGEN'
      && row.order.lines.some((line) => line.productId === productId))
    .map((row) => ({ id: row.order.id, number: row.order.number, name: containerName(row.order), receivedOn: row.order.receivedOn ?? null }))
    .sort((left, right) => (right.receivedOn ?? '').localeCompare(left.receivedOn ?? '') || right.id - left.id)
    .slice(0, 12);
}
