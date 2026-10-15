import type { BankingApi, BankPurchasePaymentPart, BankStatementLine } from '../../core/api/banking-api';
import type { FinanceApi } from '../../core/api/finance-api';
import type { PaymentSplitResult, PurchasePayment } from '../../core/api/models';
import type { SourcingApi } from '../../core/api/sourcing-api';
import type { KeepAs, LinkTarget } from './bank-change-preview';

/*
 * The calls behind "Koppelen" on a transaction (spec-bank-forecast §3.6):
 * one function per target kind, with "Betaling volgt de bank" (the payment
 * takes the line's amount, day and account) or "Betaling houden, verschil
 * als Bankkosten / Koersverschil". followPurchaseLink is the only place that
 * reads round 2's follow operation (bank-part with its `higher` choice).
 * followBank and keepDifferenceAs go to the server only when it knows them
 * (cashRound); a purchase payment follows through round 2 either way.
 */

export interface LinkApis { banking: BankingApi; sourcing: SourcingApi; finance: FinanceApi; }
export interface LinkChoice {
  follow: boolean;
  keepAs: KeepAs;
  /** A larger transaction on a purchase payment that follows: the payment takes it, or the rest is the inspection via the supplier. */
  surplus: 'ADJUST' | 'INSPECTION';
  /** The server knows followBank / keepDifferenceAs (the 2026-10-16 round). */
  cashRound: boolean;
  /** A new cost payment beside an existing one that is not on the bank: "Ik heb de bestaande betalingen gecontroleerd; dit is een nieuwe betaling." */
  confirmNew?: boolean;
}
export interface LinkOutcome {
  /** The linked line(s) as the server returned them. */
  lines: BankStatementLine[];
  /** Payments the link created (a new cost payment is found back after the refresh). */
  purchasePayments: PurchasePayment[];
  /** Round 2's own sentence of what followed, when the server sent one. */
  serverNotice: string | null;
}

const cents = (value: number): number => Math.round(value * 100);

/**
 * Round 2's follow (R2-2): one transaction linked to one purchase payment,
 * which takes its day and euro; a smaller one carves the line's part out, a
 * larger one needs `higher`. A USD/CNY payment is compared in its own
 * currency on the server and never gets `higher`.
 */
export function followPurchaseLink(sourcing: Pick<SourcingApi, 'linkPaymentPart'>, paymentId: number, lineId: number,
  choice: { higher: 'ADJUST' | 'INSPECTION' | null; amount?: number | null; withPaymentIds?: readonly number[] }): Promise<PaymentSplitResult> {
  return sourcing.linkPaymentPart(paymentId, lineId, choice.amount ?? null, { higher: choice.higher, withPaymentIds: choice.withPaymentIds ?? [] });
}

/** One link: the call of its target kind (the table of §3.6). `parts` are the purchase payments a new container term gets. */
export async function runLink(apis: LinkApis, line: BankStatementLine, target: LinkTarget, choice: LinkChoice,
  parts: BankPurchasePaymentPart[] = []): Promise<LinkOutcome> {
  const lineCents = Math.abs(cents(line.amountEur));
  switch (target.kind) {
    case 'sales-new':
      return { lines: [await apis.banking.allocate(line.id, target.salesOrderId, null)], purchasePayments: [], serverNotice: null };
    case 'sales-existing':
      return { lines: [await apis.banking.allocate(line.id, target.salesOrderId, target.paymentId, choice.follow && choice.cashRound)], purchasePayments: [], serverNotice: null };
    case 'cost-new':
      return { lines: [await apis.banking.addCostPayment(line.id, target.costId, choice.confirmNew === true)], purchasePayments: [], serverNotice: null };
    case 'cost-existing':
      return { lines: [await apis.banking.linkPayments(line.id, { costPaymentId: target.costPaymentId, ...(choice.follow && choice.cashRound ? { followBank: true } : {}) })],
        purchasePayments: [], serverNotice: null };
    case 'term-new': {
      const result = await apis.banking.addPurchasePayment(line.id, target.orderId, parts);
      return { lines: [result.line], purchasePayments: result.payments, serverNotice: null };
    }
    case 'purchase-existing': {
      const higher = lineCents > cents(target.amountEur) + 2;
      if (choice.follow || lineCents < cents(target.amountEur) - 2) {
        const result = await followPurchaseLink(apis.sourcing, target.paymentId, line.id,
          { higher: higher && target.currency === 'EUR' ? choice.surplus : null });
        return { lines: result.lines, purchasePayments: result.payments, serverNotice: result.notice ?? null };
      }
      const keep = higher && choice.cashRound ? { keepDifferenceAs: choice.keepAs } : {};
      return { lines: [await apis.banking.linkPayments(line.id, { purchasePaymentIds: [target.paymentId], ...keep })], purchasePayments: [], serverNotice: null };
    }
  }
}

/**
 * "Ongedaan maken" on the toast: unlinks, and deletes the payment(s) the link
 * created for a new cost or container term. Old amounts are never restored
 * (the toast says so when the payment had followed the bank).
 */
export async function undoLink(apis: LinkApis, line: BankStatementLine, target: LinkTarget, created: { costPaymentId?: number | null; purchase?: readonly PurchasePayment[] }): Promise<void> {
  if (target.kind === 'sales-new' || target.kind === 'sales-existing') {
    await apis.banking.unallocate(line.id);
    return;
  }
  await apis.banking.unlinkPayments(line.id);
  if (target.kind === 'cost-new' && created.costPaymentId) await apis.finance.deleteCostPayment(target.costId, created.costPaymentId);
  if (target.kind === 'term-new') for (const payment of created.purchase ?? []) await apis.sourcing.deletePayment(payment.orderId, payment.id);
}
