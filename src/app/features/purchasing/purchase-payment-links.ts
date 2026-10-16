import type { Currency } from '../../core/api/models';

/*
 * Linking a saved container payment to bank transactions (round of
 * 2026-10-15): one transaction for the whole payment, one for a part of it
 * (the rest stays open as a second transfer of the same payment), or several
 * that together make the amount. The server splits the payment into one row
 * per transfer, each on its bank day; this module only decides which call the
 * payment sheet makes. Pure: type-only imports, node-tested, counts in cents
 * with the two-cent bank rule (bankAmountsMatch).
 *
 * Round 2 (Emre, 2026-10-15): one payment linked to one transaction follows
 * it. Its day becomes the bank's day and its euro the transaction's (a euro
 * payment's amount with it; a USD/CNY payment keeps its own amount and gets
 * the effective rate). A transaction larger than the payment is never refused
 * outright: the sheet asks whether the payment takes the transaction's amount
 * ('ADJUST') or the rest is the inspection paid via the supplier
 * ('INSPECTION'). The server does it in one call (bank-part with `surplus`);
 * linkChange words what will change and linkNotice what did.
 *
 * A USD/CNY payment is compared in its own currency, as the server does
 * (PurchasePaymentSplitService.linkForeign): its euro is a forecast at the
 * order rate, so a gap in euro is the exchange rate, never a part or a
 * surplus. One transaction is the whole payment (the euro and the day
 * follow, the dollars stay) unless the owner names the part it paid in the
 * payment's currency; that part is carved out and sent as bank-part's
 * `amount`. 'Hoger' and 'Rest als inspectie' never apply to it.
 */

const TOLERANCE_CENTS = 2;
const cents = (value: number): number => Math.round(value * 100);
const EURO = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
const eur = (value: number): string => EURO.format(value);
const money = (amount: number, currency: Currency): string => new Intl.NumberFormat('nl-BE', { style: 'currency', currency }).format(amount);
/** '05/01/2026' of an ISO day. */
const day = (iso: string): string => iso.slice(0, 10).split('-').reverse().join('/');

/**
 * What happens with a transaction larger than the payment: the payment takes
 * its amount, or the rest becomes the inspection paid via the supplier on the
 * same transaction (round 1 D), both sent as bank-part's `surplus`; or the
 * transaction also paid other containers and is shared over them ('SHARE',
 * Emre 2026-10-16: one transfer for the 30 % of three containers), one
 * POST …/purchase-share.
 */
export type SurplusChoice = 'ADJUST' | 'INSPECTION' | 'SHARE';
/** The choices bank-part itself takes (`higher`): every one but the share. */
export type BankPartSurplus = Exclude<SurplusChoice, 'SHARE'>;

/** What the sheet does with the transactions picked for one part. */
export type PendingLinkPlan =
  /** Nothing picked. */
  | { kind: 'none' }
  /**
   * One transaction: the whole part when it matches, else its part of it (C2,
   * /bank-part). A larger one is whole once the owner chose what the surplus
   * is (`surplus`).
   */
  | { kind: 'part'; lineId: number; whole: boolean; surplus?: BankPartSurplus; withPaymentIds?: number[];
      /** A USD/CNY carve: the part in the payment's own currency, sent as bank-part's `amount`. */
      amount?: number }
  /** One transaction larger than the part, no choice yet: the sheet asks (extraEur = how much larger). */
  | { kind: 'higher'; lineId: number; extraEur: number }
  /** 'Verdelen over containers': the one transaction is shared between this part and other containers (POST …/purchase-share). */
  | { kind: 'share'; lineId: number }
  /** Two to ten transactions that together make the part (C1, /bank-lines). */
  | { kind: 'lines'; lineIds: number[] }
  /** A server without this round: one matching transaction through the old /links call. */
  | { kind: 'links'; lineId: number }
  /**
   * 'Transactie toevoegen' on a payment whose every transfer is on the bank:
   * the payment grows by this transaction (bank-part with `higher: 'ADJUST'`,
   * the server's addTransfer), addEur = what it adds.
   */
  | { kind: 'grow'; lineId: number; addEur: number }
  | { kind: 'invalid'; message: string };

export const PENDING_LINES_MESSAGE = 'Kies transacties die samen het bedrag maken, of één transactie voor een deel van het bedrag.';

/**
 * A USD/CNY payment (or transfer) a transaction is linked to: its amount in
 * its own currency and, when the owner typed one, the part of it this
 * transaction paid ('Alleen een deel?'). Null or EUR: compared in euro.
 */
export interface ForeignLink {
  amount: number;
  currency: Currency;
  part?: number | null;
}

/** The typed part is not less than the payment: the server refuses it, so the sheet does. */
export function foreignPartMessage(foreign: ForeignLink): string {
  return `Het deel moet kleiner zijn dan de betaling (${money(foreign.amount, foreign.currency)}); laat het leeg voor de hele betaling.`;
}

/**
 * The call for the transactions picked for a part of `partEur`. One
 * transaction that matches (± € 0,02) or is smaller; one that is larger once
 * the owner chose what the surplus is (`surplus`; without a choice the plan
 * is 'higher' and the sheet asks); several whose sum matches; anything else
 * is refused before the server is asked. A server without this round only
 * takes one matching transaction.
 */
export function pendingLinkPlan(
  partEur: number, lines: readonly { id: number; amountEur: number }[], roundOnServer: boolean, surplus: SurplusChoice | null = null,
  companions: readonly { id: number; amountEur: number }[] = [], foreign: ForeignLink | null = null,
): PendingLinkPlan {
  if (!lines.length) return { kind: 'none' };
  const part = cents(partEur);
  const outgoing = lines.map(line => -cents(line.amountEur));
  if (outgoing.some(value => value <= 0) || !(part > 0)) return { kind: 'invalid', message: PENDING_LINES_MESSAGE };
  if (lines.length === 1 && roundOnServer && foreign && foreign.currency !== 'EUR') {
    // The transaction also paid other containers: the payment goes whole on it, its euro becomes its share.
    if (surplus === 'SHARE') return { kind: 'share', lineId: lines[0].id };
    // USD/CNY: the server compares in the payment's own currency. A named part is carved out; else the transaction is the whole payment.
    const named = foreign.part ?? null;
    if (named !== null) {
      if (!(cents(named) > 0) || cents(named) > cents(foreign.amount)) return { kind: 'invalid', message: foreignPartMessage(foreign) };
      if (cents(named) < cents(foreign.amount)) return { kind: 'part', lineId: lines[0].id, whole: false, amount: cents(named) / 100 };
    }
    const together = part + companions.reduce((sum, companion) => sum + cents(companion.amountEur), 0);
    if (companions.length && Math.abs(outgoing[0] - together) <= TOLERANCE_CENTS) {
      return { kind: 'part', lineId: lines[0].id, whole: true, withPaymentIds: companions.map(companion => companion.id) };
    }
    return { kind: 'part', lineId: lines[0].id, whole: true };
  }
  if (lines.length === 1) {
    // The goods and the inspection noted with them make the transaction: both go on it, the inspection keeping its amount.
    const together = part + companions.reduce((sum, companion) => sum + cents(companion.amountEur), 0);
    if (roundOnServer && companions.length && Math.abs(outgoing[0] - together) <= TOLERANCE_CENTS) {
      return { kind: 'part', lineId: lines[0].id, whole: true, withPaymentIds: companions.map(companion => companion.id) };
    }
    const whole = Math.abs(outgoing[0] - part) <= TOLERANCE_CENTS;
    if (!roundOnServer) return whole ? { kind: 'links', lineId: lines[0].id } : { kind: 'invalid', message: PENDING_LINES_MESSAGE };
    if (whole || outgoing[0] < part) return { kind: 'part', lineId: lines[0].id, whole };
    if (surplus === 'SHARE') return { kind: 'share', lineId: lines[0].id };
    return surplus ? { kind: 'part', lineId: lines[0].id, whole: true, surplus }
      : { kind: 'higher', lineId: lines[0].id, extraEur: (outgoing[0] - part) / 100 };
  }
  const sum = outgoing.reduce((total, value) => total + value, 0);
  if (!roundOnServer || lines.length > 10 || Math.abs(sum - part) > TOLERANCE_CENTS) return { kind: 'invalid', message: PENDING_LINES_MESSAGE };
  return { kind: 'lines', lineIds: lines.map(line => line.id) };
}

/** One transaction to add to a payment fully on the bank; never several at once, never an incoming one. */
export function growLinkPlan(lines: readonly { id: number; amountEur: number }[]): PendingLinkPlan {
  if (!lines.length) return { kind: 'none' };
  if (lines.length > 1) return { kind: 'invalid', message: 'Voeg één transactie tegelijk toe.' };
  const outgoing = -cents(lines[0].amountEur);
  if (!(outgoing > 0)) return { kind: 'invalid', message: 'Kies een uitgaande transactie.' };
  return { kind: 'grow', lineId: lines[0].id, addEur: outgoing / 100 };
}

/** Where the term of a payment (or its payee, without a term) stands against the Afspraak, the payment itself counted. */
export interface TermStanding {
  /** '30% bij bestelling' or the payee's name. */
  label: string;
  /** A supplier term ('de termijn'), else the payee as a whole. */
  term: boolean;
  plannedEur: number;
  paidEur: number;
}

/**
 * What `addEur` more paid does to the term, said before the owner chooses:
 * over the Afspraak ('de termijn komt € 500,00 boven de afspraak'), exactly
 * paid, or what stays open. Null without an Afspraak.
 */
export function termAfterAdding(term: TermStanding | null, addEur: number): { overEur: number; subject: string; text: string } | null {
  if (!term || !(cents(term.plannedEur) > 0)) return null;
  const rest = cents(term.paidEur) + cents(addEur) - cents(term.plannedEur);
  const subject = term.term ? 'de termijn' : term.label;
  if (rest > TOLERANCE_CENTS) return { overEur: rest / 100, subject, text: `${subject} komt ${eur(rest / 100)} boven de afspraak` };
  if (rest < -TOLERANCE_CENTS) return { overEur: 0, subject, text: `daarna nog open ${term.term ? 'voor de termijn' : 'bij ' + term.label}: ${eur(-rest / 100)}` };
  return { overEur: 0, subject, text: `${subject} is dan precies betaald` };
}

/** One row of the share as the effect is worded: an open payment (its euro, money and day) or a new payment (paymentEur null). */
export interface ShareEffectRow {
  paymentEur: number | null;
  currency?: Currency;
  amount?: number | null;
  partEur: number | null;
  standing?: TermStanding | null;
  /** The transaction's day: every part takes it. */
  day: string;
  /** A new payment's term, and what is still open on it. */
  label?: string | null;
  openEur?: number | null;
}

/**
 * 'Verdelen over containers' (Emre, 2026-10-16): what the share does to one
 * row, said before it is saved (the server's rules in POST …/purchase-share):
 * 'wordt gekoppeld · betaald op 28/09/2026';
 * '€ 2.000,00 op de bank; € 1.070,20 blijft open als tweede transactie';
 * 'betaling wordt € 3.801,13 (was € 3.070,20); de termijn komt € 789,48 boven de afspraak';
 * 'betaling in USD: gaat helemaal op deze transactie; de euro wordt € 3.700,00 (was € 3.680,00)';
 * 'nieuwe betaling · 30% bij bestelling; de termijn komt € 730,92 boven de afspraak'.
 */
export function shareEffect(row: ShareEffectRow): string {
  const part = cents(row.partEur ?? 0);
  if (row.paymentEur == null) {
    const open = (row.openEur ?? 0) > 0 ? ` · open ${eur(row.openEur!)}` : '';
    const after = termAfterAdding(row.standing ?? null, part / 100);
    return `nieuwe betaling · ${row.label || 'Leverancier'}${open}${after && after.overEur > 0 ? '; ' + after.text : ''}`;
  }
  const booked = cents(row.paymentEur);
  if (row.currency && row.currency !== 'EUR') {
    // The server links a USD/CNY payment whole: its euro becomes the part, its own amount stays.
    const text = `betaling in ${row.currency}: gaat helemaal op deze transactie; de euro wordt ${eur(part / 100)} (was ${eur(booked / 100)})`;
    return foreignLinkWarning({ amountEur: booked / 100, currency: row.currency }, part / 100) ? `${text} · wijkt sterk af, controleer het deel` : text;
  }
  const difference = part - booked;
  if (Math.abs(difference) <= TOLERANCE_CENTS) return `wordt gekoppeld · betaald op ${day(row.day)}`;
  if (difference < 0) return `${eur(part / 100)} op de bank; ${eur(-difference / 100)} blijft open als tweede transactie`;
  const after = termAfterAdding(row.standing ?? null, difference / 100);
  return `betaling wordt ${eur(part / 100)} (was ${eur(booked / 100)})${after ? '; ' + after.text : ''}`;
}

/** 'De betaling wordt € 12.500,00 (was € 12.000,00); de termijn komt € 500,00 boven de afspraak.' before a transaction is added. */
export function growPreview(paymentEur: number, addEur: number, term: TermStanding | null): string {
  const after = termAfterAdding(term, addEur);
  return `De betaling wordt ${eur((cents(paymentEur) + cents(addEur)) / 100)} (was ${eur(cents(paymentEur) / 100)})${after ? '; ' + after.text : ''}.`;
}

/**
 * The consequence of 'Bedrag aanpassen' for a transaction `extraEur` larger
 * than the payment, said on the choice itself: 'De termijn komt dan € 300,00
 * boven de afspraak (te veel betaald).', else what stays open.
 */
export function adjustConsequence(term: TermStanding | null, extraEur: number): string {
  const after = termAfterAdding(term, extraEur);
  if (!after) return 'De betaling volgt de transactie.';
  if (after.overEur > 0) return `${after.subject.charAt(0).toUpperCase()}${after.subject.slice(1)} komt dan ${eur(after.overEur)} boven de afspraak (te veel betaald).`;
  return `De betaling volgt de transactie; ${after.text}.`;
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

/**
 * The inspection split must wait while two or more transactions, one smaller
 * one or one larger one (whatever its surplus becomes, a share included) are
 * about to be linked: each changes the goods payment first.
 */
export function inspectionSplitBlocked(plan: PendingLinkPlan): boolean {
  return plan.kind === 'lines' || plan.kind === 'higher' || plan.kind === 'grow' || plan.kind === 'share' || (plan.kind === 'part' && (!plan.whole || !!plan.surplus));
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

/**
 * The inspection noted with the goods of one transfer and not on the bank
 * yet: payments under Inspectie & andere kosten of the same container on the
 * goods payment's own day. A transaction that makes goods + inspection links
 * them together (bank-part's withPaymentIds): the inspection keeps its
 * amount, the goods take the rest, so no second inspection is booked.
 */
export function transferCompanions<T extends { id: number; payee?: string | null; paidOn: string; amountEur: number; bankStatementLineId?: number | null }>(
  part: { id: number; payee?: string | null; paidOn: string; bankStatementLineId?: number | null }, payments: readonly T[], skip: readonly number[] = [],
): T[] {
  if ((part.payee ?? 'SUPPLIER') !== 'SUPPLIER' || part.bankStatementLineId != null) return [];
  return payments.filter(payment => payment.id !== part.id && !skip.includes(payment.id) && payment.payee === 'SEPARATE'
    && payment.bankStatementLineId == null && payment.paidOn === part.paidOn && payment.amountEur > 0);
}

/** The payment as the sheet shows it before the link. */
export interface LinkSubject {
  amount: number;
  currency: Currency;
  amountEur: number;
  paidOn: string;
  /** 'geen', '1 bestand', 'KBC · 03/01/2026 · € 10.000,00': what proves it now. */
  proof: string;
}

/** One row of 'Wat verandert': Betaling nu → Na koppelen. */
export interface LinkChangeRow {
  label: 'Bedrag' | 'Betaald op' | 'Koers' | 'Inspectie via leverancier' | 'Bewijs';
  now: string;
  after: string;
  changed: boolean;
}

/** '1 USD = 0,9227 EUR' of a USD/CNY amount and its euro. */
function rateText(amount: number, currency: Currency, amountEur: number): string {
  if (!(amount > 0) || !(amountEur > 0)) return '—';
  return `1 ${currency} = ${(amountEur / amount).toLocaleString('nl-BE', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} EUR`;
}

/** The amount as the sheet writes it: the euro, or the foreign amount with its euro. */
function amountText(amount: number, currency: Currency, amountEur: number): string {
  return currency === 'EUR' ? eur(amountEur) : `${money(amount, currency)} · ${eur(amountEur)}`;
}

/**
 * 'Wat verandert' before one transaction is linked to one payment (or one
 * transfer of a payment in parts): what the payment is now and what it will
 * be. A whole link (or a larger transaction taken whole) follows the
 * transaction's euro and day; a smaller one carves the line's part and leaves
 * the rest open; the surplus as inspection keeps the payment and adds the
 * inspection on the same transaction. A USD/CNY payment keeps its own amount
 * (its euro and its rate follow), or the part named in its currency is carved
 * out at the bank's euro. Empty for any other plan (a larger transaction asks
 * its question first).
 */
export function linkChange(
  subject: LinkSubject, line: { amountEur: number; day: string; text: string }, plan: PendingLinkPlan, companionsEur = 0,
): LinkChangeRow[] {
  if (plan.kind !== 'part') return [];
  const lineEur = Math.abs(cents(line.amountEur)) / 100;
  const foreign = subject.currency !== 'EUR';
  const row = (label: LinkChangeRow['label'], now: string, after: string): LinkChangeRow => ({ label, now, after, changed: now !== after });
  const proof = row('Bewijs', subject.proof, line.text);
  if (!plan.whole && foreign && plan.amount != null) {
    // The part named in dollars takes the bank's euro; the rest stays open at the payment's booked rate (as the server splits it).
    const partBooked = Math.round(subject.amountEur * plan.amount / subject.amount * 100) / 100;
    const restAmount = (cents(subject.amount) - cents(plan.amount)) / 100;
    const restEur = (cents(subject.amountEur) - cents(partBooked)) / 100;
    return [
      row('Bedrag', amountText(subject.amount, subject.currency, subject.amountEur),
        `${amountText(plan.amount, subject.currency, lineEur)} op de bank + ${amountText(restAmount, subject.currency, restEur)} open`),
      row('Betaald op', day(subject.paidOn), `${day(line.day)} (deel) · rest ${day(subject.paidOn)}`),
      row('Koers', rateText(subject.amount, subject.currency, subject.amountEur), `${rateText(plan.amount, subject.currency, lineEur)} (deel)`),
      proof,
    ];
  }
  if (!plan.whole) {
    const restEur = (cents(subject.amountEur) - cents(lineEur)) / 100;
    return [
      row('Bedrag', eur(subject.amountEur), `${eur(lineEur)} op de bank + ${eur(restEur)} open`),
      row('Betaald op', day(subject.paidOn), `${day(line.day)} (deel) · rest ${day(subject.paidOn)}`),
      proof,
    ];
  }
  if (plan.surplus === 'INSPECTION') {
    const extraEur = (cents(lineEur) - cents(subject.amountEur)) / 100;
    return [
      row('Bedrag', amountText(subject.amount, subject.currency, subject.amountEur), amountText(subject.amount, subject.currency, subject.amountEur)),
      row('Betaald op', day(subject.paidOn), day(line.day)),
      row('Inspectie via leverancier', '—', `${eur(extraEur)} op dezelfde transactie`),
      proof,
    ];
  }
  // With the inspection noted beside the goods, the goods take the transaction minus that inspection.
  const together = plan.withPaymentIds?.length ? cents(companionsEur) : 0;
  const goodsEur = (cents(lineEur) - together) / 100;
  const afterAmount = foreign ? subject.amount : goodsEur;
  return [
    row('Bedrag', amountText(subject.amount, subject.currency, subject.amountEur), amountText(afterAmount, subject.currency, goodsEur)),
    row('Betaald op', day(subject.paidOn), day(line.day)),
    ...(foreign ? [row('Koers', rateText(subject.amount, subject.currency, subject.amountEur), rateText(subject.amount, subject.currency, goodsEur))] : []),
    ...(together ? [row('Inspectie via leverancier', `${eur(together / 100)} · niet op de bank`, `${eur(together / 100)} · zelfde transactie`)] : []),
    proof,
  ];
}

/** 'Deel van deze betaling: € 5.000,00 van € 12.000,00; de rest (€ 7.000,00) blijft open als tweede transactie.' (the same words as Kosten & bank). */
export function carveText(paymentEur: number, lineEur: number): string {
  const part = Math.abs(cents(lineEur));
  return `Deel van deze betaling: ${eur(part / 100)} van ${eur(cents(paymentEur) / 100)}; de rest (${eur((cents(paymentEur) - part) / 100)}) blijft open als tweede transactie.`;
}

/**
 * The part of a USD/CNY payment named in its own currency, in the server's
 * words (carvedForeign): 'Deel van deze betaling: US$ 6.000,00 (€ 5.090,00)
 * van US$ 12.000,00; de rest (US$ 6.000,00) blijft open als tweede transactie.'
 */
export function carveForeignText(part: number, lineEur: number, whole: number, currency: Currency): string {
  return `Deel van deze betaling: ${money(part, currency)} (${eur(Math.abs(cents(lineEur)) / 100)}) van ${money(whole, currency)}; de rest (${
    money((cents(whole) - cents(part)) / 100, currency)}) blijft open als tweede transactie.`;
}

/**
 * One transaction linked whole to a USD/CNY payment whose booked euro is far
 * from it (more than 15 %, the sheet's own yardstick for a typed debit): it
 * may pay only a part. Null when the euro is close.
 */
export function foreignLinkWarning(subject: { amountEur: number; currency: Currency }, lineEur: number): string | null {
  const booked = cents(subject.amountEur), bank = Math.abs(cents(lineEur));
  if (subject.currency === 'EUR' || !(booked > 0) || Math.abs(bank - booked) / booked <= 0.15) return null;
  return `${eur(bank / 100)} wijkt sterk af van de geboekte ${eur(booked / 100)}. Betaalt deze transactie maar een deel, vul dan het deel in ${subject.currency} in.`;
}

/** 'Transactie is € 300,00 hoger dan deze betaling'. */
export function surplusQuestion(extraEur: number): string {
  return `Transactie is ${eur(extraEur)} hoger dan deze betaling`;
}

/**
 * The short notice after a link: what followed the transaction, with what it
 * was. Null when nothing changed but the link itself.
 * 'Bedrag en datum gevolgd van de transactie: € 10.300,00 op 05/01/2026 (was € 10.250,00 op 03/01/2026).'
 */
export function linkNotice(
  before: { amountEur: number; paidOn: string }, after: { amountEur: number; paidOn: string }, inspectionEur: number | null = null,
): string | null {
  const amount = cents(before.amountEur) !== cents(after.amountEur);
  const date = before.paidOn !== after.paidOn;
  const rest = inspectionEur !== null && cents(inspectionEur) > 0 ? ` Rest als inspectie via leverancier: ${eur(inspectionEur)}.` : '';
  if (amount && date) {
    return `Bedrag en datum gevolgd van de transactie: ${eur(after.amountEur)} op ${day(after.paidOn)} (was ${eur(before.amountEur)} op ${day(before.paidOn)}).${rest}`;
  }
  if (amount) return `Bedrag gevolgd van de transactie: ${eur(after.amountEur)} (was ${eur(before.amountEur)}).${rest}`;
  if (date) return `Datum gevolgd van de transactie: ${day(after.paidOn)} (was ${day(before.paidOn)}).${rest}`;
  return rest ? rest.trim() : null;
}

/**
 * The picked transactions are already on this payment: a retry after a lost
 * answer, the refreshed payment carries every one of them. The sheet then
 * clears the pick instead of checking it against the payment's new amount.
 */
export function pendingAlreadyLinked(pending: readonly { id: number }[], parts: readonly { bankStatementLineId: number | null }[]): boolean {
  if (!pending.length) return false;
  const linked = new Set(parts.map(part => part.bankStatementLineId).filter((id): id is number => id != null));
  return pending.every(line => linked.has(line.id));
}

/**
 * After a lost answer the refreshed payment already carries the picked
 * transactions: say so in the right number and what changed with it,
 * 'Transactie al gekoppeld · bedrag nu € 12.300,00 (was € 12.000,00) · betaald
 * op 05/10/2026 (was 02/10/2026)'. Without `before` only the first part.
 */
export function alreadyLinkedText(
  count: number, before: { amountEur: number; paidOn: string } | null, after: { amountEur: number; paidOn: string } | null,
): string {
  const words = [count > 1 ? `${count} transacties al gekoppeld` : 'Transactie al gekoppeld'];
  if (before && after) {
    if (cents(before.amountEur) !== cents(after.amountEur)) words.push(`bedrag nu ${eur(after.amountEur)} (was ${eur(before.amountEur)})`);
    if (before.paidOn !== after.paidOn) words.push(`betaald op ${day(after.paidOn)} (was ${day(before.paidOn)})`);
  }
  return words.join(' · ');
}

/** A payment (in parts) as one figure: the sum of its transfers in euro and its newest day, the one date rule. Null without transfers. */
export function paymentFigure(parts: readonly { amountEur: number; paidOn: string }[]): { amountEur: number; paidOn: string } | null {
  if (!parts.length) return null;
  return { amountEur: parts.reduce((sum, part) => sum + cents(part.amountEur), 0) / 100,
    paidOn: parts.reduce((newest, part) => part.paidOn > newest ? part.paidOn : newest, parts[0].paidOn) };
}
