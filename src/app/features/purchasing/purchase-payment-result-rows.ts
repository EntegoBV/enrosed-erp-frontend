import type { Payee } from '../../core/api/models';
import type { PayeeLedger, PaymentLedger, PurchaseSettleRequest } from './purchase-payment-ledger';
import type { PurchasePaymentResultStream } from './purchase-payment-result-metrics';

/**
 * The 'Per ontvanger' list of the Nacalculatie: the same payees, figures and
 * words as Betalingen, joined with what each one did to the payment result.
 * Pure and node-tested; the component only renders it.
 */
export interface PaymentResultRow {
  payee: Payee;
  label: string;
  icon: string;
  tone: string;
  /** Null for the bijkomende kosten: there is no agreement. */
  agreedEur: number | null;
  paidEur: number;
  openEur: number;
  /** Positive is more paid than agreed; the bijkomende kosten are all 'more'. */
  differenceEur: number;
  netResultEur: number;
  finalized: boolean;
  status: { label: string; tone: 'warn' | 'ok' | 'neutral' };
  canSettle: boolean;
  canUndoSettle: boolean;
  settleDefault: PurchaseSettleRequest;
  paymentCount: number;
}

export function paymentResultRows(
  ledger: Pick<PaymentLedger, 'payees'> | null, streams: readonly PurchasePaymentResultStream[],
): PaymentResultRow[] {
  if (!ledger) return [];
  return ledger.payees
    .filter(payee => payee.visible && (payee.payee !== 'OTHER' || payee.paidEur > 0))
    .map(payee => resultRow(payee, streams.find(stream => stream.payee === payee.payee)));
}

function resultRow(payee: PayeeLedger, stream: PurchasePaymentResultStream | undefined): PaymentResultRow {
  const other = payee.payee === 'OTHER';
  return {
    payee: payee.payee,
    label: payee.label,
    icon: payee.icon,
    tone: payee.tone,
    agreedEur: payee.agreedEur,
    paidEur: payee.paidEur,
    openEur: payee.openEur,
    differenceEur: other ? payee.paidEur : payee.differenceEur,
    netResultEur: stream?.netResultEur ?? 0,
    finalized: payee.finalized,
    status: { label: payee.status.label, tone: payee.status.tone },
    canSettle: payee.canSettle,
    canUndoSettle: payee.canUndoSettle,
    settleDefault: payee.settleDefault,
    paymentCount: payee.paymentCount,
  };
}
