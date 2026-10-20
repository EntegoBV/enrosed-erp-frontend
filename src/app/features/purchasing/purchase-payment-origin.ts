import type { PurchasePaymentOrigin } from '../../core/api/models';

/** Provenance never means that a bank transfer or proof file exists. */
export function paymentOriginLabel(origin: PurchasePaymentOrigin | null | undefined): string | null {
  if (!origin) return null;
  const title = origin.source === 'OTHER_COMPANY' ? `Betaald door ${origin.payerName}` : 'Betaald via oude bankrekening';
  return origin.note?.trim() ? `${title} · ${origin.note.trim()}` : title;
}

export function expectsBankLink(payment: { origin?: PurchasePaymentOrigin | null }): boolean {
  return payment.origin == null;
}
