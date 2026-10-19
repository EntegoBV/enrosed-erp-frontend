import type { BankingApi, BankPurchasePaymentPart, BankStatementLine } from '../../core/api/banking-api';
import type { FinanceApi } from '../../core/api/finance-api';
import type { BankPartHigher, PaymentSplitResult, PurchasePayment } from '../../core/api/models';
import type { SourcingApi } from '../../core/api/sourcing-api';
import type { KeepAs, LinkTarget } from './bank-change-preview';

/*
 * The calls behind "Koppelen" on a transaction (spec-bank-forecast §3.6):
 * one function per target kind, with "Betaling volgt de bank" (the payment
 * takes the line's amount, day and account) or "Betaling houden, verschil
 * als Transactiekosten / Koersverschil" (Bankkosten for /links' own choice).
 * followPurchaseLink is the only place that reads round 2's follow operation
 * (bank-part with its `higher` choice and B2's `feeEur`, 2026-10-19).
 * followBank and keepDifferenceAs go to the server only when it knows them
 * (cashRound); a purchase payment follows through round 2 either way.
 */

export interface LinkApis { banking: BankingApi; sourcing: SourcingApi; finance: FinanceApi; }
export interface LinkChoice {
  follow: boolean;
  keepAs: KeepAs;
  /** A larger transaction on a purchase payment that follows: the payment takes it, or the rest is the inspection via the supplier or Transactiekosten. */
  surplus: 'ADJUST' | 'INSPECTION' | 'FEE';
  /** 'Waarvan transactiekosten' of a USD/CNY purchase payment that follows: that euro becomes Transactiekosten, the payment's euro the rest. */
  feeEur?: number | null;
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
 * currency on the server and never gets `higher`; its Transactiekosten go as
 * `feeEur` (B2).
 */
export function followPurchaseLink(sourcing: Pick<SourcingApi, 'linkPaymentPart'>, paymentId: number, lineId: number,
  choice: { higher: BankPartHigher | null; amount?: number | null; withPaymentIds?: readonly number[]; feeEur?: number | null }): Promise<PaymentSplitResult> {
  return sourcing.linkPaymentPart(paymentId, lineId, choice.amount ?? null, { higher: choice.higher, withPaymentIds: choice.withPaymentIds ?? [],
    ...(choice.feeEur ? { feeEur: choice.feeEur } : {}) });
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
      const foreign = target.currency !== 'EUR';
      // "Betaling houden" with the difference as Transactiekosten: the payment keeps its euro, the rest is a Bijkomende kosten payment on the line.
      const keepFee = !choice.follow && higher && choice.keepAs === 'TRANSACTIEKOSTEN';
      if (choice.follow || keepFee || lineCents < cents(target.amountEur) - 2) {
        const feeEur = keepFee ? (foreign ? (lineCents - cents(target.amountEur)) / 100 : null) : foreign ? choice.feeEur ?? null : null;
        const result = await followPurchaseLink(apis.sourcing, target.paymentId, line.id,
          { higher: higher && !foreign ? (keepFee ? 'FEE' : choice.surplus) : null, feeEur });
        return { lines: result.lines, purchasePayments: result.payments, serverNotice: result.notice ?? null };
      }
      const keep = higher && choice.cashRound && choice.keepAs !== 'TRANSACTIEKOSTEN' ? { keepDifferenceAs: choice.keepAs } : {};
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
