import type { BankPurchasePaymentPart, BankPurchaseSharePart } from '../../core/api/banking-api';
import type { Currency } from '../../core/api/models';

/*
 * Transactiekosten (Emre, 2026-10-19): what the bank charges on a Chinese
 * transfer for a container is a cost of that container, never a company
 * cost. It is a new Bijkomende kosten payment (payee OTHER, EUR, no term,
 * settling nothing) labelled 'Transactiekosten' on the bank line: it counts
 * in the nacalculatie's eindkost and stays out of the year-end stock value,
 * Kosten and the btw-aangifte. The parts below go in the calls the bank
 * already makes (…/purchase-payment, …/purchase-share). Pure: type-only
 * imports, node-tested (tests/bank-transaction-fees.test.mts).
 */

export const FEE_LABEL = 'Transactiekosten';

/**
 * The detail's "Transactiekosten" card on an open charge (2026-10-20): the
 * line about its transfer, "Bij {container} boeken" when that transfer pays
 * one container, else "Container kiezen…" with `first` (the transfer's
 * containers, or those its best match points at) leading the picker.
 */
export interface FeeCard { text: string; book: { orderId: number; label: string } | null; first: readonly number[]; }
/** Boeken als opened on Bankkosten by that card: Algemene bankkost, or at a container (chosen, or `first` leading). The sheet takes it once. */
export interface BookAsFee { lineId: number; where: 'COMPANY' | 'CONTAINER'; orderId: number | null; first: readonly number[]; }

const cents = (value: number): number => Math.round(value * 100);

/** The fee as a part of POST …/purchase-payment: a line of its own, or beside the goods of a new term. */
export function feePaymentPart(paidOn: string, amountEur: number, purchaseOrderId?: number | null): BankPurchasePaymentPart {
  return { paidOn, amount: cents(Math.abs(amountEur)) / 100, currency: 'EUR', amountEur: null, label: FEE_LABEL, payee: 'OTHER', instalmentDue: null, settles: false,
    ...(purchaseOrderId != null ? { purchaseOrderId } : {}) };
}

/** The fee as a part of POST …/purchase-share ('Splitsen' with an open payment among the parts). */
export function feeSharePart(purchaseOrderId: number, amountEur: number): BankPurchaseSharePart {
  return { purchaseOrderId, amountEur: cents(Math.abs(amountEur)) / 100, payee: 'OTHER', instalmentDue: null, label: FEE_LABEL, settles: false };
}

/**
 * The goods of a new term when the transaction also paid its costs ('Waarvan
 * transactiekosten'): in euro the typed amount less the fee; in USD/CNY the
 * amount stays and its euro is the transaction's less the fee. Without a fee
 * as before: the euro amount, or the foreign one with the transaction's euro.
 */
export function goodsAfterFee(amount: number, currency: Currency, lineEur: number, feeEur: number | null): { amount: number; amountEur: number | null } {
  const fee = feeEur !== null && feeEur > 0 ? cents(feeEur) : 0;
  if (currency === 'EUR') return { amount: (cents(amount) - fee) / 100, amountEur: null };
  return { amount, amountEur: (Math.abs(cents(lineEur)) - fee) / 100 };
}

/** The fee may be booked: more than zero and less than what it comes out of (the goods' own share stays above zero). */
export function feeFits(feeEur: number | null, ofEur: number): boolean {
  return feeEur !== null && cents(feeEur) > 0 && cents(feeEur) < cents(Math.abs(ofEur));
}
