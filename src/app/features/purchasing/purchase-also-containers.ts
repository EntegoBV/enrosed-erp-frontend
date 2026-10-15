import type { PurchasePaymentWrite } from '../../core/api/models';
import type { ContainerPayable, TermDue } from '../finance/payables';

/*
 * "Deze transactie dekt ook andere containers" (owner addition 2026-10-15):
 * one supplier transfer that paid a term of several containers at once, as
 * the Inkoop payment sheet notes it. The other containers' parts travel in
 * the one atomic call that records this payment on the transaction
 * (POST /bank-statements/{id}/purchase-payment, each part naming its own
 * purchaseOrderId). Pure: node-tested.
 */

/** A container that may share the transfer, with its open supplier terms. */
export interface AlsoContainerOption {
  orderId: number; number: string; alias: string | null; supplierId: number | null; supplier: string;
  terms: { due: TermDue | null; label: string; openEur: number }[];
}
/** One other container's part of the transfer, in euro (the transaction's). */
export interface AlsoContainerPart {
  orderId: number; number: string; supplierId: number | null; due: TermDue | null; label: string; amountInput: string; amount: number | null;
}

const cents = (value: number): number => Math.round(value * 100);
const amountText = (value: number): string => value.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The other containers with an open supplier amount (archived ones and this
 * container left out): the same supplier's first, then by number.
 */
export function alsoContainerOptions(payables: readonly ContainerPayable[], orders: readonly { id: number; supplierId: number | null }[],
  supplierNames: ReadonlyMap<number, string>, ownOrderId: number, supplierId: number | null): AlsoContainerOption[] {
  const supplierOf = new Map(orders.map((order) => [order.id, order.supplierId]));
  const byOrder = new Map<number, AlsoContainerOption>();
  for (const row of payables) {
    if (row.orderId === ownOrderId || row.archived || row.payee !== 'SUPPLIER' || cents(row.remainingEur) <= 0) continue;
    const id = supplierOf.get(row.orderId) ?? null;
    const option = byOrder.get(row.orderId) ?? { orderId: row.orderId, number: row.orderNumber, alias: row.alias, supplierId: id,
      supplier: id === null ? '' : supplierNames.get(id) ?? '', terms: [] };
    option.terms.push({ due: row.due, label: row.termLabel ?? 'Leverancier', openEur: row.remainingEur });
    byOrder.set(row.orderId, option);
  }
  const same = (option: AlsoContainerOption): number => Number(supplierId !== null && option.supplierId === supplierId);
  return [...byOrder.values()].sort((a, b) => same(b) - same(a) || a.number.localeCompare(b.number, 'nl'));
}

/** A container added: this payment's term when that container has it open (30 % of all three), else its earliest open term, at its open amount. */
export function alsoPartFor(option: AlsoContainerOption, due: TermDue | null): AlsoContainerPart {
  const term = option.terms.find((item) => due !== null && item.due === due) ?? option.terms[0];
  const amount = term ? Math.round(term.openEur * 100) / 100 : null;
  return { orderId: option.orderId, number: option.number, supplierId: option.supplierId, due: term?.due ?? null, label: term?.label ?? 'Leverancier',
    amountInput: amount === null ? '' : amountText(amount), amount };
}

/** What the other containers take of the transaction. */
export function alsoTotalEur(parts: readonly AlsoContainerPart[] | null | undefined): number {
  return (parts ?? []).reduce((sum, part) => sum + cents(part.amount ?? 0), 0) / 100;
}

/**
 * Keeps the transaction balanced while containers come and go: when this
 * payment and the others made the transaction before the change, this
 * payment's goods take the difference (never below a cent); otherwise the
 * typed amounts stand (null).
 */
export function rebalancedGoods(goodsEur: number | null, transferEur: number, othersBefore: number, othersAfter: number, lineEur: number): number | null {
  if (goodsEur === null || Math.abs(cents(transferEur + othersBefore) - cents(lineEur)) > 2) return null;
  const next = cents(goodsEur) - (cents(othersAfter) - cents(othersBefore));
  return next >= 1 ? next / 100 : null;
}

/** The writes of the other containers' parts: euro, the supplier's, on the transaction's day, each on its own order. */
export function alsoWrites(parts: readonly AlsoContainerPart[] | null | undefined, paidOn: string): (PurchasePaymentWrite & { purchaseOrderId: number })[] {
  return (parts ?? []).filter((part) => (part.amount ?? 0) > 0).map((part) => ({
    paidOn, amount: part.amount!, currency: 'EUR', label: part.label, payee: 'SUPPLIER', settles: false, instalmentDue: part.due, purchaseOrderId: part.orderId,
  }));
}

/** "Ook op PO-2026-044 en PO-2026-045" after the save. */
export function alsoNotice(parts: readonly AlsoContainerPart[] | null | undefined): string | null {
  const numbers = (parts ?? []).filter((part) => (part.amount ?? 0) > 0).map((part) => part.number);
  if (!numbers.length) return null;
  return `Ook op ${numbers.length === 1 ? numbers[0] : numbers.slice(0, -1).join(', ') + ' en ' + numbers.at(-1)}`;
}
