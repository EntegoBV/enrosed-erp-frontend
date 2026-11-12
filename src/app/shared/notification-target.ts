import type { AppNotification } from '../core/api/models';

/** IDs overlap across sales and purchases; the notification kind owns its destination. */
export function notificationTarget(item: Pick<AppNotification, 'kind' | 'orderId'> & Partial<Pick<AppNotification, 'url' | 'notificationId'>>): {
  commands: (string | number)[]; queryParams: Record<string, string>;
} | null {
  /* A partner's melding has no sales order (orderId null, so an older build shows it without a link): its id rides in
     url ("/veilingverkopen?melding=12") and notificationId ("partner-sale:12"). */
  if (item.kind === 'PARTNER_VERKOOP') {
    const melding = meldingId(item);
    return { commands: ['/veilingverkopen'], queryParams: melding ? { melding: String(melding) } : {} };
  }
  /* A customer the partner made: its sheet ("/customers?klant=7", notificationId "partner-customer:7"). */
  if (item.kind === 'PARTNER_KLANT') {
    const customer = idFrom(item, /[?&]klant=(\d+)/, /^partner-customer:(\d+)$/);
    return { commands: ['/customers'], queryParams: customer ? { klant: String(customer) } : {} };
  }
  if (!Number.isSafeInteger(item.orderId) || item.orderId == null || item.orderId <= 0) return null;
  return item.kind === 'CONTAINER_AANKOMST'
    ? { commands: ['/purchasing', item.orderId], queryParams: { tracking: '1' } }
    : { commands: ['/sales', item.orderId], queryParams: {} };
}

/** The melding behind a PARTNER_VERKOOP item, from its url or its notificationId (one per revision: "partner-sale:12:<token>"). */
function meldingId(item: Partial<Pick<AppNotification, 'url' | 'notificationId'>>): number | null {
  return idFrom(item, /[?&]melding=(\d+)/, /^partner-sale:(\d+)(?::|$)/);
}

function idFrom(item: Partial<Pick<AppNotification, 'url' | 'notificationId'>>, fromUrl: RegExp, fromId: RegExp): number | null {
  const id = Number(fromUrl.exec(item.url ?? '')?.[1] ?? fromId.exec(item.notificationId ?? '')?.[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
