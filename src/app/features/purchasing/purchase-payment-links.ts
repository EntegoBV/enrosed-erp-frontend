import type { Currency } from '../../core/api/models';

/*
 * Linking a saved container payment to bank transactions (round of
 * 2026-10-15): one transaction for the whole payment, one for a part of it
 * (the rest stays open as a second transfer of the same payment), or several
 * that together make the amount. The server splits the payment into one row
 * per transfer, each on its bank day; this module only decides which call the
 * payment sheet makes. Pure: type-only imports, node-tested, counts in cents
 * with the two-cent bank rule (bankAmountsMatch).
 */

const TOLERANCE_CENTS = 2;
const cents = (value: number): number => Math.round(value * 100);

/** What the sheet does with the transactions picked for one part. */
export type PendingLinkPlan =
  /** Nothing picked. */
  | { kind: 'none' }
  /** One transaction: the whole part when it matches, else its part of it (C2, /bank-part). */
  | { kind: 'part'; lineId: number; whole: boolean }
  /** Two to ten transactions that together make the part (C1, /bank-lines). */
  | { kind: 'lines'; lineIds: number[] }
  /** A server without this round: one matching transaction through the old /links call. */
  | { kind: 'links'; lineId: number }
  | { kind: 'invalid'; message: string };

export const PENDING_LINES_MESSAGE = 'Kies transacties die samen het bedrag maken, of één transactie voor een deel van het bedrag.';

/**
 * The call for the transactions picked for a part of `partEur`. One
 * transaction that matches (± € 0,02) or is smaller; several whose sum
 * matches; anything else is refused before the server is asked. A server
 * without this round only takes one matching transaction.
 */
export function pendingLinkPlan(partEur: number, lines: readonly { id: number; amountEur: number }[], roundOnServer: boolean): PendingLinkPlan {
  if (!lines.length) return { kind: 'none' };
  const part = cents(partEur);
  const outgoing = lines.map(line => -cents(line.amountEur));
  if (outgoing.some(value => value <= 0) || !(part > 0)) return { kind: 'invalid', message: PENDING_LINES_MESSAGE };
  if (lines.length === 1) {
    const whole = Math.abs(outgoing[0] - part) <= TOLERANCE_CENTS;
    if (!roundOnServer) return whole ? { kind: 'links', lineId: lines[0].id } : { kind: 'invalid', message: PENDING_LINES_MESSAGE };
    return whole || outgoing[0] < part ? { kind: 'part', lineId: lines[0].id, whole } : { kind: 'invalid', message: PENDING_LINES_MESSAGE };
  }
  const sum = outgoing.reduce((total, value) => total + value, 0);
  if (!roundOnServer || lines.length > 10 || Math.abs(sum - part) > TOLERANCE_CENTS) return { kind: 'invalid', message: PENDING_LINES_MESSAGE };
  return { kind: 'lines', lineIds: lines.map(line => line.id) };
}

/**
 * The euro the transactions picked for a part are checked against; the
 * sheet and the save use this one rule. A payment never split: the draft's
 * own euro (`draftEur`, as the editor values the typed money), because the
 * save writes the payment before the link. A transfer of a payment in parts:
 * its correction when typed, else its booked euro.
 */
export function pendingPartEur(
  part: { amount: number; currency: Currency; amountEur: number },
  edit: { amount: number | null; amountEur?: number | null } | undefined,
  draftEur: number | null,
): number {
  if (draftEur !== null && draftEur > 0) return draftEur;
  if (!edit || edit.amount === null) return part.amountEur;
  if (part.currency === 'EUR') return edit.amount;
  return edit.amountEur ?? Math.round(part.amountEur * edit.amount / part.amount * 100) / 100;
}

/** The inspection split must wait while two or more transactions, or one smaller one, are about to be linked. */
export function inspectionSplitBlocked(plan: PendingLinkPlan): boolean {
  return plan.kind === 'lines' || (plan.kind === 'part' && !plan.whole);
}

/**
 * The euro of the inspection part split off a payment: in euro the typed
 * part itself; in USD/CNY the payment's own booked rate (its euro over its
 * amount), never the order rate, as the transfer split does.
 */
export function inspectionSplitEur(payment: { amount: number; currency: Currency; amountEur: number }, part: number): number {
  if (payment.currency === 'EUR') return cents(part) / 100;
  return Math.round(payment.amountEur * part / payment.amount * 100) / 100;
}
