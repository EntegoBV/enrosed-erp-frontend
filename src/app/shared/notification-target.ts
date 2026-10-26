import type { AppNotification } from '../core/api/models';

/** IDs overlap across sales and purchases; the notification kind owns its destination. */
export function notificationTarget(item: Pick<AppNotification, 'kind' | 'orderId'>): {
  commands: (string | number)[]; queryParams: Record<string, string>;
} | null {
  if (!Number.isSafeInteger(item.orderId) || item.orderId == null || item.orderId <= 0) return null;
  return item.kind === 'CONTAINER_AANKOMST'
    ? { commands: ['/purchasing', item.orderId], queryParams: { tracking: '1' } }
    : { commands: ['/sales', item.orderId], queryParams: {} };
}
