/*
 * The payments on a cost: what they add up to, whether the cost is settled
 * (within a cent) and how much of it is on the bank. The server derives
 * paidOn the same way; this mirrors it for drafts and hints. Pure: node-tested.
 */

export interface PaymentTotals {
  paidEur: number;
  openEur: number;
  overpaidEur: number;
  paid: boolean;
  /** The last payment date once paid, else null. */
  paidOn: string | null;
}

const cents = (value: number): number => Math.round((Number.isFinite(value) ? value : 0) * 100);

/** Summed in cents; a cost counts as paid from one cent under its cash total. */
export function paymentTotals(cashEur: number, payments: readonly { amountEur: number; paidOn: string }[]): PaymentTotals {
  const cash = cents(cashEur);
  const paidCents = payments.reduce((sum, payment) => sum + cents(payment.amountEur), 0);
  const paid = payments.length > 0 && paidCents >= cash - 1;
  return {
    paidEur: paidCents / 100,
    /* Settled within a cent reads nothing open: the lists never say 'Deels' next to 'Betaald'. */
    openEur: paid ? 0 : Math.max(0, cash - paidCents) / 100,
    overpaidEur: Math.max(0, paidCents - cash) / 100,
    paid,
    paidOn: paid ? payments.reduce<string | null>((latest, payment) => (latest === null || payment.paidOn > latest ? payment.paidOn : latest), null) : null,
  };
}

/**
 * The payment an action just wrote: the row the cost did not have before.
 * The server lists payments by date, so the newest row is not always the
 * last one; ids are identity-generated, so the highest unknown id is it.
 */
export function newPaymentOf<T extends { id: number | null }>(before: { payments?: readonly T[] } | null | undefined, saved: { payments?: readonly T[] }): T | null {
  const known = new Set((before?.payments ?? []).map((payment) => payment.id));
  return [...(saved.payments ?? [])].filter((payment) => payment.id !== null && !known.has(payment.id))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))[0] ?? null;
}

/** How much of a cost's payments the bank holds. */
export function paymentsBanked(payments: readonly { bankStatementLineId: number | null }[]): 'none' | 'some' | 'all' {
  const banked = payments.filter((payment) => payment.bankStatementLineId !== null && payment.bankStatementLineId !== undefined).length;
  if (!payments.length || banked === 0) return 'none';
  return banked === payments.length ? 'all' : 'some';
}

/** The text a bank line carries for a payment on a cost (the bank-markers rule for the 'kostbetaling' kind). */
export function paymentMarker(paymentId: number): string {
  return `kostbetaling #${paymentId}`;
}
