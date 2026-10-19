import type { Currency, Payee } from '../../core/api/models';
import type { ContainerPayable, TermDue } from './payables';

/*
 * Kosten & bank "Splitsen" (container-split.ts), the rules behind its rows
 * (Emre, 2026-10-16: an instalment already noted is linked, never a second
 * payment). Which row a ticked container starts on, the choices of its
 * select in order, and each row's weight for 'Volgens afspraak'. A row
 * stands on an open payment ('p:{id}'), on an open term (the term's key) or
 * on Transactiekosten ('fee', a new Bijkomende kosten payment). The transfer
 * paid one payee: a row never starts on another payee's payment (a € 300
 * transport payment does not take the supplier's money). Since 2026-10-19 a
 * container holds several rows ('+ Deel': 30 % + 70 %, goods + transport,
 * goods + Transactiekosten), and two rows never stand on one open payment.
 * Pure: type-only imports, node-tested.
 */

/** A payment of the container noted but not on the bank yet (no credit offset, more than zero). */
export interface SplitOpenPayment {
  id: number; due: TermDue | null; label: string | null; amountEur: number; payee: Payee; currency: Currency; amount: number; paidOn: string;
}
/** A container the transfer may have paid: its open terms (every payee) and its open payments, oldest first. */
export interface SplitContainer {
  orderId: number; number: string; alias: string | null; supplier: string; supplierId: number | null;
  terms: ContainerPayable[]; open: SplitOpenPayment[];
}
/** The payee and term a row stands on. */
export interface SplitTarget { payee: Payee; due: TermDue | null; }
/** One choice of a row's select: an open payment, an open term, or Transactiekosten (every container offers it). */
export type SplitChoice = { key: string; payment: SplitOpenPayment; term?: undefined; fee?: undefined }
  | { key: string; term: ContainerPayable; payment?: undefined; fee?: undefined }
  | { key: string; fee: true; payment?: undefined; term?: undefined };

/** The key of a Transactiekosten row: payee OTHER, EUR, no term, settling nothing (transaction-fees.ts). */
export const SPLIT_FEE_KEY = 'fee';

const TERM_ORDER: readonly (TermDue | null)[] = ['ORDERED', 'SHIPPED', 'FREIGHT', 'ARRIVED', null];
/** PAYEE_SHORT of purchase-payment-ledger (no runtime import here): keep the two in step. */
const PAYEE_SHORT: Readonly<Record<Payee, string>> = { SUPPLIER: 'Leverancier', LOGISTICS: 'Transport', SEPARATE: 'Inspectie', OTHER: 'Bijkomend' };
const EURO = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
const dueRank = (due: TermDue | null): number => TERM_ORDER.indexOf(due);

/** The key of an open payment's row. */
export const splitPaymentKey = (id: number): string => `p:${id}`;

/** What a key stands on in one container: its open payment's payee and term, or its term's. */
function targetIn(container: SplitContainer, key: string): SplitTarget | null {
  const payment = container.open.find((item) => splitPaymentKey(item.id) === key);
  if (payment) return { payee: payment.payee, due: payment.due };
  const term = container.terms.find((item) => item.key === key);
  return term ? { payee: term.payee, due: term.due } : null;
}

/** The payee and term of a row's key, in whichever container has it. */
export function splitTarget(containers: readonly SplitContainer[], key: string): SplitTarget | null {
  for (const container of containers) {
    const target = targetIn(container, key);
    if (target) return target;
  }
  return null;
}

/**
 * The row a ticked container starts on.
 * - `prefer`: the open payment the transaction was matched to, when the container has it; a matched term sets the target.
 * - The target (payee and term): the first row's; without one the supplier's (or, with no supplier amount, the payee of
 *   the container's first open term or payment), on the earliest term where it has an open payment, else its earliest open term.
 * - Then, in this order: an open payment of that payee on that term; that open term; another open payment of that payee
 *   (its earliest term); another open term of that payee; the container's first open term; its first open payment.
 * Null for a container with nothing open.
 */
export function splitStart(container: SplitContainer, first: SplitTarget | null,
  prefer?: { paymentId?: number | null; termKey?: string | null } | null): { key: string; amountEur: number } | null {
  const asPayment = (payment: SplitOpenPayment) => ({ key: splitPaymentKey(payment.id), amountEur: payment.amountEur });
  const asTerm = (term: ContainerPayable) => ({ key: term.key, amountEur: term.remainingEur });
  const preferred = prefer?.paymentId != null ? container.open.find((item) => item.id === prefer.paymentId) : undefined;
  if (preferred) return asPayment(preferred);
  const matched = prefer?.termKey ? container.terms.find((item) => item.key === prefer.termKey) : undefined;
  let target = first ?? (matched ? { payee: matched.payee, due: matched.due } : null);
  if (!target) {
    const payee: Payee | undefined = container.terms.some((item) => item.payee === 'SUPPLIER') || container.open.some((item) => item.payee === 'SUPPLIER')
      ? 'SUPPLIER' : container.terms[0]?.payee ?? container.open[0]?.payee;
    if (!payee) return null;
    const noted = byDue(container.open.filter((item) => item.payee === payee))[0];
    target = { payee, due: noted ? noted.due : container.terms.find((item) => item.payee === payee)?.due ?? null };
  }
  const { payee, due } = target;
  const payments = byDue(container.open.filter((item) => item.payee === payee));
  const terms = container.terms.filter((item) => item.payee === payee);
  const payment = payments.find((item) => item.due === due);
  if (payment) return asPayment(payment);
  const term = terms.find((item) => item.due === due);
  if (term) return asTerm(term);
  if (payments.length) return asPayment(payments[0]);
  if (terms.length) return asTerm(terms[0]);
  if (container.terms.length) return asTerm(container.terms[0]);
  return container.open.length ? asPayment(container.open[0]) : null;
}

/** Open payments by term (a payee without terms last), the oldest first within a term. */
function byDue(payments: readonly SplitOpenPayment[]): SplitOpenPayment[] {
  return payments.map((payment, index) => ({ payment, index }))
    .sort((a, b) => dueRank(a.payment.due) - dueRank(b.payment.due) || a.index - b.index).map((item) => item.payment);
}

/**
 * The row's select: the open payments of the payee it stands on, then the
 * container's open terms, then other payees' open payments (said with their
 * payee by the screen), Transactiekosten last. An open payment another row
 * stands on (`taken`) is left out: one payment is never chosen twice. The
 * shown choice is the row's key (`selected` per option: a select's value set
 * before its options exist shows the first).
 */
export function splitChoices(container: SplitContainer, key: string, taken: readonly string[] = []): SplitChoice[] {
  const payee = splitRowPayee(container, key);
  const free = container.open.filter((item) => splitPaymentKey(item.id) === key || !taken.includes(splitPaymentKey(item.id)));
  const own = byDue(free.filter((item) => item.payee === payee)).map((payment) => ({ key: splitPaymentKey(payment.id), payment }));
  const others = free.filter((item) => item.payee !== payee).map((payment) => ({ key: splitPaymentKey(payment.id), payment }));
  return [...own, ...container.terms.map((term) => ({ key: term.key, term })), ...others, { key: SPLIT_FEE_KEY, fee: true as const }];
}

/**
 * '+ Deel' on a ticked container: the next part it most likely paid. An open
 * payment or term of the first row's payee that no row of the container
 * stands on yet (the 70 % after the 30 %; never the term a row already
 * pays), else Transactiekosten, else any free choice. `taken`: the keys of
 * every row (other containers' rows too).
 */
export function splitNextPart(container: SplitContainer, rowKeys: readonly string[], taken: readonly string[] = rowKeys): string {
  const first = rowKeys[0] ?? SPLIT_FEE_KEY;
  const payee = splitRowPayee(container, first);
  const used = rowKeys.map((key) => targetIn(container, key)).filter((target): target is SplitTarget => target !== null);
  const free = splitChoices(container, first, taken).filter((choice) => !choice.fee && !rowKeys.includes(choice.key) && !taken.includes(choice.key)
    && !(choice.term && used.some((target) => target.payee === choice.term!.payee && target.due === choice.term!.due)));
  const same = free.find((choice) => (choice.payment?.payee ?? choice.term?.payee) === payee);
  if (same) return same.key;
  if (!rowKeys.includes(SPLIT_FEE_KEY)) return SPLIT_FEE_KEY;
  return free[0]?.key ?? SPLIT_FEE_KEY;
}

/**
 * The amounts by 'Volgens afspraak' (`weight`) or 'Gelijk verdelen' (weight
 * 1): Transactiekosten rows keep their typed amount, the other rows share
 * what is left of the transaction, to the cent (`split`: purchase-payment-
 * share's splitCents, handed in). Null when it cannot: no other row, nothing
 * left, a weight missing.
 */
export function splitSpread(lineEur: number, rows: readonly { fee: boolean; amountEur: number | null; weight: number | null }[],
  split: (totalEur: number, weights: readonly number[]) => number[] | null): number[] | null {
  const fees = rows.filter((row) => row.fee).reduce((sum, row) => sum + Math.round((row.amountEur ?? 0) * 100), 0);
  const others = rows.filter((row) => !row.fee);
  const rest = Math.abs(Math.round(lineEur * 100)) - fees;
  if (!others.length || rest <= 0 || others.some((row) => row.weight === null)) return null;
  const shares = split(rest / 100, others.map((row) => row.weight!));
  if (!shares) return null;
  let next = 0;
  return rows.map((row) => (row.fee ? row.amountEur ?? 0 : shares[next++]));
}

/** A row's weight 'Volgens afspraak': an open payment's euro; a term's open amount, its Afspraak when nothing is open. Null for an unknown key. */
export function splitWeight(container: SplitContainer, key: string): number | null {
  const payment = container.open.find((item) => splitPaymentKey(item.id) === key);
  if (payment) return payment.amountEur > 0 ? payment.amountEur : null;
  const term = container.terms.find((item) => item.key === key);
  if (!term) return null;
  return term.remainingEur > 0 ? term.remainingEur : term.plannedEur > 0 ? term.plannedEur : null;
}

/**
 * A choice as the select says it, short so the 424 px inspector and a phone
 * show it whole (the amounts and what happens stand under the row):
 * 'Bestaand: € 3.070,20' (one open payment of the row's payee), 'Bestaand
 * 25/09: € 3.070,20' (several), 'Transport: € 300,00 (bestaand)' (another
 * payee's), 'Nieuw: 30% bij bestelling' (a term), 'Nieuw: Transport' (a
 * payee without terms).
 */
export function splitChoiceText(choice: SplitChoice, choices: readonly SplitChoice[], rowPayee: Payee): string {
  if (choice.fee) return 'Nieuw: Transactiekosten';
  if (choice.term) return `Nieuw: ${choice.term.termLabel || PAYEE_SHORT[choice.term.payee]}`;
  const payment = choice.payment;
  if (payment.payee !== rowPayee) return `${PAYEE_SHORT[payment.payee]}: ${EURO.format(payment.amountEur)} (bestaand)`;
  const several = choices.filter((item) => item.payment && item.payment.payee === rowPayee).length > 1;
  return several ? `Bestaand ${payment.paidOn.slice(8, 10)}/${payment.paidOn.slice(5, 7)}: ${EURO.format(payment.amountEur)}` : `Bestaand: ${EURO.format(payment.amountEur)}`;
}

/** The payee of a row in its container (Bijkomende kosten for Transactiekosten, the supplier for an unknown key). */
export function splitRowPayee(container: SplitContainer, key: string): Payee {
  if (key === SPLIT_FEE_KEY) return 'OTHER';
  return targetIn(container, key)?.payee ?? 'SUPPLIER';
}
