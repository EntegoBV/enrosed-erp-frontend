import type { BankPurchaseSharePart } from '../../core/api/banking-api';
import type { Payee, PurchasePaymentWrite } from '../../core/api/models';
import type { AlsoContainerPart } from './purchase-also-containers';

/*
 * "Verdelen over containers" (Emre, 2026-10-16): "met 1 transactie 3
 * containers hun deelbetalingen betaald … 1/3 nemen van die transactie
 * bijvoorbeeld en ook manueel kunnen aanpassen". A transaction larger than
 * the payment it is picked for is shared between this payment and other
 * containers: each part an open payment of that container (linked, never a
 * second one) or a new payment, all in one POST …/purchase-share. This module
 * splits the transaction by Afspraak or equally, to the cent, says whether the
 * parts make it and builds the request; shareEffect (purchase-payment-links)
 * words what each part does, proposeShare (purchase-also-containers) picks
 * the first rows. Pure: type-only imports, node-tested; cents and the
 * two-cent bank rule (bankAmountsMatch's, shared/bank-transaction-options).
 */

/** How the amounts were set: by Afspraak, equally (1/n), or typed. */
export type ShareMode = 'AFSPRAAK' | 'EQUAL' | 'MANUAL';

/** The bank's two-cent rule, as bankAmountsMatch counts it. */
const TOLERANCE_CENTS = 2;
const cents = (value: number): number => Math.round(value * 100);
const EURO = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
const eur = (value: number): string => EURO.format(value);
const amountText = (value: number): string => value.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The transaction over the weights, in cents: each part is the total times
 * its weight over all weights, rounded half up; what rounding leaves (a cent
 * or two either way) goes to the part with the largest weight, the last of
 * equal ones, so the parts make the total exactly. Equal weights give exactly
 * 1/n: € 11.403,38 over three is 3.801,13 + 3.801,13 + 3.801,12. Null for no
 * total, no weights, a weight that is not a positive number, or a part that
 * would be less than a cent.
 */
export function splitCents(totalEur: number, weights: readonly number[]): number[] | null {
  if (!Number.isFinite(totalEur) || !weights.length) return null;
  const total = cents(totalEur);
  const units = weights.map((weight) => (Number.isFinite(weight) ? cents(weight) : Number.NaN));
  if (!(total > 0) || units.some((unit) => !(unit > 0))) return null;
  const sum = BigInt(units.reduce((all, unit) => all + unit, 0));
  // Half up in whole numbers: floor((2·total·unit + sum) / (2·sum)).
  const parts = units.map((unit) => Number((BigInt(2) * BigInt(total) * BigInt(unit) + sum) / (BigInt(2) * sum)));
  let largest = 0;
  units.forEach((unit, index) => { if (unit >= units[largest]) largest = index; });
  parts[largest] += total - parts.reduce((all, part) => all + part, 0);
  return parts.some((part) => part < 1) ? null : parts.map((part) => part / 100);
}

/**
 * A part's weight for 'Volgens afspraak': an open payment's euro (what was
 * agreed for it when it was noted); a new payment's open amount on its term,
 * its Afspraak when nothing is open. This payment's weight is its booked euro.
 */
export function shareWeight(part: AlsoContainerPart): number | null {
  if (part.paymentId != null) return (part.paymentEur ?? 0) > 0 ? part.paymentEur! : null;
  if ((part.openEur ?? 0) > 0) return part.openEur!;
  return (part.plannedEur ?? 0) > 0 ? part.plannedEur! : null;
}

/** 'Volgens afspraak' or 'Gelijk verdelen': this payment's part and every other row's, to the cent. Null when a weight is missing. */
export function applyShare(mode: 'AFSPRAAK' | 'EQUAL', lineEur: number, ownWeight: number | null, parts: readonly AlsoContainerPart[]):
  { own: number; parts: AlsoContainerPart[] } | null {
  const weights = mode === 'EQUAL' ? parts.map(() => 1 as number | null) : parts.map(shareWeight);
  const all = [mode === 'EQUAL' ? 1 : ownWeight, ...weights];
  if (all.some((weight) => weight === null)) return null;
  const split = splitCents(Math.abs(lineEur), all as number[]);
  if (!split) return null;
  const [own, ...rest] = split;
  return { own, parts: parts.map((part, index) => ({ ...part, amount: rest[index], amountInput: amountText(rest[index]) })) };
}

/**
 * Whether the parts make the transaction (two-cent rule), and the live line:
 * 'Samen € 11.403,38 van € 11.403,38 ✓', '… · nog € 403,38 te verdelen' or
 * '… · € 12,00 te veel'.
 */
export function shareStatus(own: number | null, parts: readonly AlsoContainerPart[], lineEur: number): { matches: boolean; text: string } {
  const total = cents(own ?? 0) + parts.reduce((sum, part) => sum + cents(part.amount ?? 0), 0);
  const line = Math.abs(cents(lineEur));
  const matches = total > 0 && line > 0 && Math.abs(total - line) <= TOLERANCE_CENTS;
  const head = `Samen ${eur(total / 100)} van ${eur(line / 100)}`;
  if (matches) return { matches, text: `${head} ✓` };
  return { matches, text: total < line ? `${head} · nog ${eur((line - total) / 100)} te verdelen` : `${head} · ${eur((total - line) / 100)} te veel` };
}

/** The other rows as parts of the request: an open payment with its part and the euro the screen saw, else a new payment of the payee on its term. */
export function sharePartsOf(parts: readonly AlsoContainerPart[], payee: Payee = 'SUPPLIER'): BankPurchaseSharePart[] {
  return parts.map((part) => part.paymentId != null
    ? { paymentId: part.paymentId, amountEur: cents(part.amount ?? 0) / 100, ...(part.paymentEur != null ? { expectedAmountEur: cents(part.paymentEur) / 100 } : {}) }
    : { purchaseOrderId: part.orderId, amountEur: cents(part.amount ?? 0) / 100, payee, instalmentDue: part.due, label: part.label, settles: false });
}

/** The request of 'Verdelen over containers': this payment first (its euro as seen, unless this save wrote it), then every other row. */
export function shareBody(own: { paymentId: number; partEur: number; expectedEur: number | null }, parts: readonly AlsoContainerPart[],
  payee: Payee = 'SUPPLIER'): BankPurchaseSharePart[] {
  return [{ paymentId: own.paymentId, amountEur: cents(own.partEur) / 100, ...(own.expectedEur != null ? { expectedAmountEur: cents(own.expectedEur) / 100 } : {}) },
    ...sharePartsOf(parts, payee)];
}

/** A new payment of this container as a part of the request (a new transfer whose other containers have open payments): euro on the line's day. */
export function shareNewPart(orderId: number, write: PurchasePaymentWrite): BankPurchaseSharePart {
  return { purchaseOrderId: orderId, amountEur: cents(write.amountEur ?? write.amount) / 100, payee: write.payee ?? 'SUPPLIER', instalmentDue: write.instalmentDue ?? null,
    label: write.label ?? null, settles: !!write.settles, invoiceId: write.invoiceId ?? null, inspectionViaSupplier: write.inspectionViaSupplier ?? null };
}

/** A name up to this long stays whole with its amount; a longer one may wrap at its spaces rather than run out of the 320 px desk toast. */
const WHOLE_NAME = 22;

/**
 * A container name that never breaks inside: a word joiner after each
 * hyphen ('PO-2026-' / '038' read as two things in a toast) and, for a name
 * of up to 22 characters, a no-break space for each space ('Moederdag' /
 * 'Rood € 3.801,13' read as two containers). Invisible; the same rule as
 * alsoNotice's (purchase-also-containers): keep the two in step.
 */
export const unbrokenName = (name: string): string => {
  const joined = name.replace(/-/g, '-\u2060');
  return name.length <= WHOLE_NAME ? joined.replace(/ /g, '\u00a0') : joined;
};

/**
 * 'Verdeeld over 3 containers: PO-2026-038 € 3.801,13 · PO-2026-039 € 3.801,13 · PO-2026-040 € 3.801,12'.
 * Each name keeps its amount on its line (unbrokenName; a no-break space before the euro).
 */
export function shareToast(rows: readonly { name: string; amountEur: number }[]): string {
  return `Verdeeld over ${rows.length} ${rows.length === 1 ? 'container' : 'containers'}: ${rows.map((row) => `${unbrokenName(row.name)}\u00a0${eur(cents(row.amountEur) / 100)}`).join(' · ')}`;
}
