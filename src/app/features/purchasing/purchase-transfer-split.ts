import type { Currency, Instalment, Payee, PurchasePaymentWrite } from '../../core/api/models';

/*
 * One transfer to the supplier may pay more than the goods: under CIF the
 * sea freight, and the inspection the supplier paid on our behalf. The
 * ledger keeps one payment per stream (the reconciliation and the
 * nacalculatie are per stream), tied together by the one bank line. This
 * module turns the sheet's draft into those writes and the euro that left
 * the bank. Pure: node-tested, counts in cents.
 */

/** What the sheet collected for one transfer, as the host hands it over. */
export interface TransferDraft {
  amount: number;
  currency: Currency;
  paidOn: string;
  label: string;
  payee: Payee;
  settles: boolean;
  instalmentDue?: Instalment['due'] | null;
  /** 'Afgeschreven in euro' of a USD/CNY transfer: the bank's debit for the whole transfer; empty means the order rate. */
  amountEur?: number | null;
  /** The extra streams of a supplier transfer, in the payment's currency. */
  freightAmount?: number | null;
  separateAmount?: number | null;
  /**
   * The invoice chosen in the sheet, on the goods and the freight writes; the
   * inspection part always goes without one (automatic: the supplier's primary
   * via §2.2 rule 3 with the tick, its own invoice or none without it).
   * Undefined against a server without invoices: no invoice field is sent.
   */
  invoiceId?: number | null;
  /** 'Inspectie via leverancier' ticked: the inspection part sets the container's flag. */
  inspectionViaSupplier?: boolean;
}

export interface TransferSplit {
  /** The ledger payments to post, the goods first. */
  writes: PurchasePaymentWrite[];
  /** What left the bank for the whole transfer, in euro. */
  bankEur: number;
}

const cents = (value: number): number => Math.round(value * 100);
const filled = (value: number | null | undefined): value is number => value != null && Number.isFinite(value) && value > 0;

/**
 * The goods payment as before, then the freight (SUPPLIER, term FREIGHT)
 * and the inspection (SEPARATE), neither settling anything. A typed bank
 * euro is split over the parts by their share, in cents, with the
 * remainder on the goods; otherwise every part takes the order rate.
 */
export function splitTransfer(draft: TransferDraft, eurOf: (amount: number, currency: Currency) => number): TransferSplit {
  const parts: { payee: Payee; due: Instalment['due'] | null; amount: number; suffix: string | null }[] = [
    { payee: draft.payee, due: draft.payee === 'SUPPLIER' ? draft.instalmentDue ?? null : null, amount: draft.amount, suffix: null },
  ];
  if (draft.payee === 'SUPPLIER') {
    if (filled(draft.freightAmount)) parts.push({ payee: 'SUPPLIER', due: 'FREIGHT', amount: draft.freightAmount, suffix: 'zeevracht (CIF)' });
    if (filled(draft.separateAmount)) parts.push({ payee: 'SEPARATE', due: null, amount: draft.separateAmount, suffix: 'inspectie' });
  }
  const typed = draft.currency !== 'EUR' && filled(draft.amountEur) ? cents(draft.amountEur) : null;
  const weights = parts.map((part) => cents(part.amount));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const euros = typed === null
    ? parts.map((part) => cents(eurOf(part.amount, draft.currency)))
    : weights.map((weight) => Math.round(typed * weight / total));
  if (typed !== null) euros[0] = typed - euros.slice(1).reduce((sum, value) => sum + value, 0);
  const base = draft.label || 'Betaling';
  const invoiced = draft.invoiceId !== undefined;
  const writes = parts.map((part, index): PurchasePaymentWrite => {
    const separate = index > 0 && part.payee === 'SEPARATE';
    return {
      paidOn: draft.paidOn, amount: part.amount, currency: draft.currency,
      label: index === 0 ? draft.label || null : `${base} · ${part.suffix}`,
      payee: part.payee, settles: index === 0 ? draft.settles : false, instalmentDue: part.due,
      ...(typed !== null ? { amountEur: euros[index] / 100 } : {}),
      ...(invoiced ? { invoiceId: separate ? null : draft.invoiceId ?? null } : {}),
      ...(separate && draft.inspectionViaSupplier ? { inspectionViaSupplier: true } : {}),
    };
  });
  return { writes, bankEur: euros.reduce((sum, value) => sum + value, 0) / 100 };
}
