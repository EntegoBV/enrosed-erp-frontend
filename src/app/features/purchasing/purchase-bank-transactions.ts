import type { BankStatementLine } from '../../core/api/banking-api';
import type { Payee, PurchasePayment, PurchasePaymentRow } from '../../core/api/models';
import { bankTransactionDay } from '../../shared/bank-transaction-options';

/*
 * "Op de bank" on an order's Betalingen (Emre, 2026-11-04: "inkoop order daar
 * betalingen splitsen naar transport en leverancier etc is gemakkelijker te
 * volgen"): every bank transaction that paid this container, with who got
 * what of it here and which other containers the same transfer paid. Read
 * from the order's payments (their hard bank link), the loaded bank lines and
 * GET /purchase-payments for the other containers.
 */

/** One part of the transaction on this container: a payment (or one transfer of a payment in parts). */
export interface TransactionPart { paymentId: number; payee: Payee; label: string | null; amountEur: number; }
/** The same transaction's part on another container. */
export interface TransactionElsewhere { orderId: number; number: string | null; alias: string | null; amountEur: number; }
export interface OrderTransaction {
  lineId: number;
  /** The loaded line; null while the bank lines load or when the line is not in the list (the parts still show). */
  line: BankStatementLine | null;
  day: string;
  /** What the transfer was, in euro (the line's, else the parts' sum). */
  amountEur: number;
  parts: TransactionPart[];
  elsewhere: TransactionElsewhere[];
  /** What the line carries beyond these containers' purchase payments (a cost, a difference); 0 when it all adds up. */
  otherEur: number;
}

const cents = (value: number): number => Math.round(value * 100);
const PAYEE_RANK: Readonly<Record<Payee, number>> = { SUPPLIER: 0, LOGISTICS: 1, SEPARATE: 2, OTHER: 3 };

/**
 * The transactions of one order, newest first; the parts per transaction by
 * payee (Leverancier, Transport, Inspectie, Bijkomend), then amount. `rows`
 * (GET /purchase-payments) adds the other containers on the same line; null
 * leaves them out.
 */
export function orderTransactions(orderId: number, payments: readonly PurchasePayment[], lines: readonly BankStatementLine[] | null,
  rows: readonly PurchasePaymentRow[] | null): OrderTransaction[] {
  const byLine = new Map<number, TransactionPart[]>();
  for (const payment of payments) {
    if (payment.orderId !== orderId || payment.bankStatementLineId == null) continue;
    const parts = byLine.get(payment.bankStatementLineId) ?? [];
    parts.push({ paymentId: payment.id, payee: payment.payee ?? 'SUPPLIER', label: payment.label, amountEur: payment.amountEur });
    byLine.set(payment.bankStatementLineId, parts);
  }
  const result: OrderTransaction[] = [];
  for (const [lineId, parts] of byLine) {
    const line = lines?.find((item) => item.id === lineId) ?? null;
    parts.sort((a, b) => PAYEE_RANK[a.payee] - PAYEE_RANK[b.payee] || b.amountEur - a.amountEur || a.paymentId - b.paymentId);
    const elsewhere = new Map<number, TransactionElsewhere>();
    for (const row of rows ?? []) {
      if (row.bankStatementLineId !== lineId || row.orderId === orderId) continue;
      const known = elsewhere.get(row.orderId);
      if (known) known.amountEur = (cents(known.amountEur) + cents(row.amountEur)) / 100;
      else elsewhere.set(row.orderId, { orderId: row.orderId, number: row.orderNumber, alias: row.orderAlias, amountEur: row.amountEur });
    }
    const own = parts.reduce((sum, part) => sum + cents(part.amountEur), 0);
    const others = [...elsewhere.values()].reduce((sum, part) => sum + cents(part.amountEur), 0);
    const total = line ? Math.abs(cents(line.amountEur)) : own + others;
    const day = line ? bankTransactionDay(line) : payments.find((payment) => payment.bankStatementLineId === lineId)?.paidOn ?? '';
    result.push({ lineId, line, day, amountEur: total / 100, parts, elsewhere: [...elsewhere.values()],
      otherEur: Math.max(0, total - own - others) / 100 });
  }
  return result.sort((a, b) => b.day.localeCompare(a.day) || b.lineId - a.lineId);
}

const EURO = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
const PAYEE_WORD: Readonly<Record<Payee, string>> = { SUPPLIER: 'Leverancier', LOGISTICS: 'Transport', SEPARATE: 'Inspectie', OTHER: 'Bijkomend' };

/** Who got what, in one line: 'Leverancier € 6.000,00 · Transport € 3.000,00 · ook 2 andere containers'. */
export function transactionSplitText(transaction: OrderTransaction): string {
  const own = transaction.parts.map((part) => `${part.label?.trim() === 'Transactiekosten' ? 'Transactiekosten' : PAYEE_WORD[part.payee]} ${EURO.format(part.amountEur)}`);
  const others = transaction.elsewhere.length;
  const rest = others ? [`ook ${others === 1 ? '1 andere container' : `${others} andere containers`}`]
    : transaction.otherEur > 0 ? [`elders ${EURO.format(transaction.otherEur)}`] : [];
  return [...own, ...rest].join(' · ');
}

/** A part as its row says it: the payee, then the term or label when it says more. */
export function transactionPartText(part: TransactionPart): { title: string; sub: string | null } {
  const label = part.label?.trim() || null;
  const title = label === 'Transactiekosten' ? 'Transactiekosten' : PAYEE_WORD[part.payee] === 'Transport' ? 'Douane & transport' : PAYEE_WORD[part.payee] === 'Bijkomend' ? 'Bijkomende kosten' : PAYEE_WORD[part.payee];
  return { title, sub: label && label !== title && label !== 'Transactiekosten' ? label : null };
}
