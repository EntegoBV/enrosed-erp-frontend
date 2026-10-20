import type { Currency, Payee, PurchaseOrderView, PurchasePaymentRow, PurchasePaymentWrite } from '../../core/api/models';
import type { ContainerPayable, TermDue } from '../finance/payables';
import type { TermStanding } from './purchase-payment-links';

/*
 * "Deze transactie dekt ook andere containers" (owner addition 2026-10-15):
 * one supplier transfer that paid a term of several containers at once, as
 * the Inkoop payment sheet notes it. The other containers' parts travel in
 * the one atomic call that records this payment on the transaction
 * (POST /bank-statements/{id}/purchase-payment, each part naming its own
 * purchaseOrderId).
 *
 * Emre, 2026-10-16: a container whose instalment was already noted (not on
 * the bank yet) gets that payment linked, never a second one. With the
 * payments loaded (alsoContainerOptions' `extra`) an option carries its open
 * payments and where its terms stand against the Afspraak; a part names the
 * open payment it links (`paymentId`) or is a new payment, and the owner can
 * switch per container (alsoPartChoices / alsoPartAs). Such parts go through
 * POST …/purchase-share; proposeShare picks the rows "Verdelen over
 * containers" starts with. Pure: type-only imports, node-tested.
 */

/** An open payment of another container: noted, not on the bank, no credit offset, of the payee in question. */
export interface AlsoOpenPayment {
  id: number; due: TermDue | null; label: string | null; amountEur: number; amount: number; currency: Currency; paidOn: string;
}
/** Where a term (or, without terms, the payee's stream) of another container stands against the Afspraak, its noted payments counted. */
export interface AlsoStanding extends TermStanding { due: TermDue | null; }

/** A container that may share the transfer, with its open terms of the payee (and, with the payments loaded, its open payments). */
export interface AlsoContainerOption {
  orderId: number; number: string; alias: string | null; supplierId: number | null; supplier: string;
  terms: { due: TermDue | null; label: string; openEur: number; plannedEur?: number; paidEur?: number }[];
  /** With the payments loaded: the container's open payments of the payee, oldest first. */
  openPayments?: AlsoOpenPayment[];
  /** With the payments loaded: where every term stands (the payee's stream for a payee without terms). */
  standings?: AlsoStanding[];
}
/** One other container's part of the transfer, in euro (the transaction's). */
export interface AlsoContainerPart {
  orderId: number; number: string; supplierId: number | null; due: TermDue | null; label: string; amountInput: string; amount: number | null;
  /** The container's own name ('Herkenbare naam'): containerName() shows it, the number as small print. */
  alias?: string | null;
  /** The open payment this part links (never a second payment for the same instalment); absent or null: a new payment. */
  paymentId?: number | null;
  /** That payment as the screen loaded it: its euro (the server checks it is unchanged), its money and its day. */
  paymentEur?: number; paymentCurrency?: Currency; paymentAmount?: number; paidOn?: string;
  /** Where the part's term (or payee) stands against the Afspraak, the open payment counted as the server has it. */
  standing?: TermStanding | null;
  /** A new payment's term: what is still open and its Afspraak, the weight of 'Volgens afspraak'. */
  openEur?: number; plannedEur?: number;
}

const cents = (value: number): number => Math.round(value * 100);
const amountText = (value: number): string => value.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const EURO = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
/** The payee as a term label when it has no terms (the server's stream). */
const PAYEE_WORD: Record<Payee, string> = { SUPPLIER: 'Leverancier', LOGISTICS: 'Douane & transport', SEPARATE: 'Inspectie & andere kosten', OTHER: 'Bijkomende kosten' };
const sameWords = (left: string | null | undefined, right: string | null | undefined): boolean =>
  !!(left ?? '').trim() && (left ?? '').trim().toLocaleLowerCase('nl-BE') === (right ?? '').trim().toLocaleLowerCase('nl-BE');
const daysApart = (left: string, right: string): number =>
  Math.abs(Math.round((Date.parse(`${left.slice(0, 10)}T00:00:00Z`) - Date.parse(`${right.slice(0, 10)}T00:00:00Z`)) / 86_400_000));
/** containerName()'s rule (container-name.ts: alias, else number, else 'Inkoop #id'), here without a runtime import: keep the two in step. */
const nameOf = (part: { orderId: number; number: string; alias?: string | null }): string =>
  (part.alias ?? '').trim() || (part.number ?? '').trim() || `Inkoop #${part.orderId}`;

/**
 * The standings of one container for a payee: every term, else the payee's
 * stream. A term exactly paid counts as finalized on the server, and that is
 * just the one a larger share puts above its Afspraak: it stays.
 */
function standingsOf(view: PurchaseOrderView | undefined, payee: Payee): AlsoStanding[] {
  const report = view?.reconciliation;
  if (!report) return [];
  const terms = payee === 'SUPPLIER' ? report.supplierInstalments ?? [] : [];
  if (terms.length) return terms.map((term) => ({ due: term.due, label: term.label, term: true, plannedEur: term.plannedEur, paidEur: term.paidEur }));
  const stream = report.streams.find((item) => item.payee === payee);
  return stream ? [{ due: null, label: PAYEE_WORD[payee], term: false, plannedEur: stream.plannedEur, paidEur: stream.paidEur }] : [];
}

/**
 * The other containers with an open amount for the payee (archived ones and
 * this container left out): the same supplier's first, then by number.
 * Without `extra` the supplier's open terms only, exactly as the first round.
 * With `extra` (Emre, 2026-10-16) the payee is `extra.payee` (the supplier by
 * default), a container is also listed for an open payment of that payee
 * (noted, not on the bank, no credit offset), it carries those payments and
 * where its terms stand, and the same supplier's containers with an open
 * payment come first.
 */
export function alsoContainerOptions(payables: readonly ContainerPayable[], orders: readonly { id: number; supplierId: number | null }[],
  supplierNames: ReadonlyMap<number, string>, ownOrderId: number, supplierId: number | null,
  extra?: { payments?: readonly PurchasePaymentRow[]; views?: readonly PurchaseOrderView[]; payee?: Payee }): AlsoContainerOption[] {
  const payee: Payee = extra?.payee ?? 'SUPPLIER';
  const supplierOf = new Map(orders.map((order) => [order.id, order.supplierId]));
  const byOrder = new Map<number, AlsoContainerOption>();
  const optionOf = (orderId: number, number: string, alias: string | null): AlsoContainerOption => {
    const known = byOrder.get(orderId);
    if (known) return known;
    const id = supplierOf.get(orderId) ?? null;
    const option: AlsoContainerOption = { orderId, number, alias, supplierId: id, supplier: id === null ? '' : supplierNames.get(id) ?? '', terms: [],
      ...(extra ? { openPayments: [], standings: [] } : {}) };
    byOrder.set(orderId, option);
    return option;
  };
  for (const row of payables) {
    if (row.orderId === ownOrderId || row.archived || row.payee !== payee || cents(row.remainingEur) <= 0) continue;
    optionOf(row.orderId, row.orderNumber, row.alias).terms.push({ due: row.due, label: row.termLabel ?? PAYEE_WORD[payee], openEur: row.remainingEur,
      ...(extra ? { plannedEur: row.plannedEur, paidEur: row.paidEur } : {}) });
  }
  if (extra) {
    const views = new Map((extra.views ?? []).map((view) => [view.order.id, view]));
    for (const payment of extra.payments ?? []) {
      if (payment.orderId === ownOrderId || payment.bankStatementLineId != null || payment.creditOffset || payment.origin != null || !(cents(payment.amountEur) > 0)
        || (payment.payee ?? 'SUPPLIER') !== payee) continue;
      const view = views.get(payment.orderId);
      if (view?.order.archivedAt) continue;
      const option = optionOf(payment.orderId, payment.orderNumber ?? view?.order.number ?? '', payment.orderAlias ?? view?.order.alias ?? null);
      option.openPayments!.push({ id: payment.id, due: payee === 'SUPPLIER' ? payment.instalmentDue ?? null : null, label: payment.label ?? null,
        amountEur: cents(payment.amountEur) / 100, amount: payment.amount ?? payment.amountEur, currency: payment.currency ?? 'EUR', paidOn: payment.paidOn });
    }
    for (const option of byOrder.values()) {
      option.openPayments!.sort((a, b) => a.paidOn.localeCompare(b.paidOn) || a.id - b.id);
      option.standings = standingsOf(views.get(option.orderId), payee);
    }
  }
  // The same supplier's containers with an open payment, then the same supplier's, then the others; by number.
  const rank = (option: AlsoContainerOption): number => supplierId !== null && option.supplierId === supplierId ? (option.openPayments?.length ? 0 : 1) : 2;
  return [...byOrder.values()].sort((a, b) => rank(a) - rank(b) || a.number.localeCompare(b.number, 'nl'));
}

/**
 * Where a term of a container stands against the Afspraak (the payee's
 * stream for a payee without terms), its noted payments counted: what a
 * share's effect is said against (Kosten & bank's split as the sheet).
 */
export function containerStanding(view: PurchaseOrderView | undefined, payee: Payee, due: TermDue | null): TermStanding | null {
  const standings = standingsOf(view, payee);
  const standing = standings.find((item) => item.due === due) ?? standings.find((item) => !item.term) ?? null;
  return standing ? { label: standing.label, term: standing.term, plannedEur: standing.plannedEur, paidEur: standing.paidEur } : null;
}

/** Where a term of the container stands (its payee's stream without terms). */
function standingFor(option: AlsoContainerOption, due: TermDue | null): TermStanding | null {
  const standing = (option.standings ?? []).find((item) => item.due === due) ?? (option.standings ?? []).find((item) => !item.term) ?? null;
  return standing ? { label: standing.label, term: standing.term, plannedEur: standing.plannedEur, paidEur: standing.paidEur } : null;
}

/** An open payment of the container as its part: linked at its own euro until the owner (or 'Volgens afspraak') says otherwise. */
export function alsoPaymentPart(option: AlsoContainerOption, payment: AlsoOpenPayment): AlsoContainerPart {
  const term = (option.standings ?? []).find((item) => item.due === payment.due);
  return { orderId: option.orderId, number: option.number, supplierId: option.supplierId, due: payment.due,
    label: payment.label || term?.label || option.terms[0]?.label || 'Leverancier', amountInput: amountText(payment.amountEur), amount: payment.amountEur,
    alias: option.alias, paymentId: payment.id, paymentEur: payment.amountEur, paymentCurrency: payment.currency, paymentAmount: payment.amount,
    paidOn: payment.paidOn, standing: standingFor(option, payment.due) };
}

/** A new payment on a term of the container (an open one, or the term an open payment belongs to), at what is still open on it. */
function newPart(option: AlsoContainerOption, due: TermDue | null, fallbackLabel: string | null): AlsoContainerPart {
  const term = option.terms.find((item) => item.due === due);
  const standing = (option.standings ?? []).find((item) => item.due === due);
  const amount = term ? cents(term.openEur) / 100 : null;
  const base: AlsoContainerPart = { orderId: option.orderId, number: option.number, supplierId: option.supplierId, due,
    label: term?.label ?? standing?.label ?? fallbackLabel ?? PAYEE_WORD.SUPPLIER, amountInput: amount === null ? '' : amountText(amount), amount };
  if (!option.standings) return base;
  return { ...base, alias: option.alias, paymentId: null, openEur: term?.openEur ?? 0, plannedEur: term?.plannedEur ?? standing?.plannedEur ?? 0,
    standing: standingFor(option, due) };
}

/** Term order, a payee without terms last (Kosten & bank's split rows count the same). */
const TERM_ORDER: readonly (TermDue | null)[] = ['ORDERED', 'SHIPPED', 'FREIGHT', 'ARRIVED', null];

/**
 * A container added. An open payment on this payment's term (`due`; the same
 * `label` first, or by label without a term) is linked: never a second
 * payment for the same instalment. Else this payment's term when that
 * container has it open (30 % of all three), at its open amount. Else, under
 * 'Automatisch' (no term) or a term that container does not have open, its
 * open payment (the same label first, else the earliest term, the oldest) is
 * linked rather than a second payment noted beside it (Kosten & bank's
 * split starts a row the same way); only a container without open payments
 * gets a new payment on its earliest open term. Without open payments (and
 * without `extra`) exactly the first round's part.
 */
export function alsoPartFor(option: AlsoContainerOption, due: TermDue | null, label: string | null = null): AlsoContainerPart {
  const open = option.openPayments ?? [];
  const sameTerm = open.filter((payment) => payment.due === due && (due !== null || sameWords(payment.label, label)));
  const payment = sameTerm.find((item) => sameWords(item.label, label)) ?? sameTerm[0];
  if (payment) return alsoPaymentPart(option, payment);
  const term = due !== null ? option.terms.find((item) => item.due === due) : undefined;
  if (term) return newPart(option, term.due, term.label);
  const byTerm = open.map((item, index) => ({ item, index }))
    .sort((a, b) => TERM_ORDER.indexOf(a.item.due) - TERM_ORDER.indexOf(b.item.due) || a.index - b.index).map(({ item }) => item);
  const noted = byTerm.find((item) => sameWords(item.label, label)) ?? byTerm[0];
  if (noted) return alsoPaymentPart(option, noted);
  const first = option.terms[0];
  return newPart(option, first?.due ?? null, first?.label ?? null);
}

/** The key of a part's choice: 'p:{id}' for an open payment, 't:{due}' for a new payment on a term. */
export function alsoPartKey(part: AlsoContainerPart): string {
  return part.paymentId != null ? `p:${part.paymentId}` : `t:${part.due ?? ''}`;
}

/**
 * The row's choices: 'Bestaand: € 3.070,20' per open payment (with its label,
 * or its day when the labels do not tell them apart, when there are several)
 * and 'Nieuw: 30% bij bestelling' per open term and per term an open payment
 * belongs to. Short, so a phone shows them whole.
 */
export function alsoPartChoices(option: AlsoContainerOption): { key: string; text: string }[] {
  const open = option.openPayments ?? [];
  const labels = open.map((payment) => (payment.label ?? '').trim());
  const byLabel = open.length > 1 && labels.every((label) => !!label) && new Set(labels.map((label) => label.toLocaleLowerCase('nl-BE'))).size === labels.length;
  const choices = open.map((payment) => ({ key: `p:${payment.id}`,
    text: open.length < 2 ? `Bestaand: ${EURO.format(payment.amountEur)}` : byLabel ? `${payment.label!.trim()}: ${EURO.format(payment.amountEur)}`
      : `Bestaand ${payment.paidOn.slice(8, 10)}/${payment.paidOn.slice(5, 7)}: ${EURO.format(payment.amountEur)}` }));
  const terms = new Map<string, string>();
  for (const term of option.terms) terms.set(`t:${term.due ?? ''}`, term.label);
  for (const payment of open) {
    const key = `t:${payment.due ?? ''}`;
    if (!terms.has(key)) terms.set(key, (option.standings ?? []).find((item) => item.due === payment.due)?.label ?? payment.label ?? PAYEE_WORD.SUPPLIER);
  }
  return [...choices, ...[...terms].map(([key, label]) => ({ key, text: `Nieuw: ${label}` }))];
}

/**
 * The part as another choice of the row ('p:…' or 't:…'): the payment or term
 * changes. The typed amount stays (a share then follows its mode); with
 * `own` the choice brings its own amount (the open payment's euro, the term's
 * open amount), as a container added does: a new transfer's row, so 'Nieuw:
 * 70% bij vertrek' at € 7.163,80 switched to 'Bestaand: € 3.070,20' links
 * that payment at € 3.070,20. A term with nothing open keeps the typed
 * amount. Null for an unknown key.
 */
export function alsoPartAs(option: AlsoContainerOption, key: string, current: AlsoContainerPart, own = false): AlsoContainerPart | null {
  let next: AlsoContainerPart | null = null;
  if (key.startsWith('p:')) {
    const payment = (option.openPayments ?? []).find((item) => item.id === Number(key.slice(2)));
    next = payment ? alsoPaymentPart(option, payment) : null;
  } else if (key.startsWith('t:')) {
    const due = (key.slice(2) || null) as TermDue | null;
    const known = option.terms.some((term) => term.due === due) || (option.openPayments ?? []).some((payment) => payment.due === due);
    next = known ? newPart(option, due, (option.openPayments ?? []).find((payment) => payment.due === due)?.label ?? null) : null;
  }
  if (next && own && next.amount !== null) return next;
  return next && { ...next, amount: current.amount, amountInput: current.amountInput };
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

/** "Ook op PO-2026-044 en PO-2026-045" after the save, each container by its name. */
export function alsoNotice(parts: readonly AlsoContainerPart[] | null | undefined): string | null {
  // A toast never breaks inside a name: a word joiner after each hyphen ('PO-2026-' / '038'), no-break spaces in a name of up to
  // 22 characters ('Moederdag' / 'Rood'); a longer one may wrap at its spaces (purchase-payment-share's unbrokenName: keep in step).
  const names = (parts ?? []).filter((part) => (part.amount ?? 0) > 0).map((part) => nameOf(part))
    .map((name) => { const joined = name.replace(/-/g, '-\u2060'); return name.length <= 22 ? joined.replace(/ /g, '\u00a0') : joined; });
  if (!names.length) return null;
  return `Ook op ${names.length === 1 ? names[0] : names.slice(0, -1).join(', ') + ' en ' + names.at(-1)}`;
}

/**
 * The rows 'Verdelen over containers' starts with (Emre, 2026-10-16): the
 * same supplier's containers that have an open payment on this payment's term
 * (by label without a term) noted within seven days of this one, each with
 * that payment (the nearest day first). One to nine such containers; else
 * none, and the owner adds them himself.
 */
export function proposeShare(options: readonly AlsoContainerOption[], own: { orderId: number; due: TermDue | null; label: string | null; paidOn: string },
  supplierId: number | null): AlsoContainerPart[] {
  if (supplierId === null) return [];
  const rows: AlsoContainerPart[] = [];
  for (const option of options) {
    if (option.orderId === own.orderId || option.supplierId !== supplierId) continue;
    const near = (option.openPayments ?? [])
      .filter((payment) => (own.due !== null ? payment.due === own.due : payment.due === null && sameWords(payment.label, own.label)) && daysApart(payment.paidOn, own.paidOn) <= 7)
      .sort((a, b) => daysApart(a.paidOn, own.paidOn) - daysApart(b.paidOn, own.paidOn) || a.id - b.id);
    if (near.length) rows.push(alsoPaymentPart(option, near[0]));
  }
  return rows.length >= 1 && rows.length <= 9 ? rows : [];
}
