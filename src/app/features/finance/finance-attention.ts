import type { FinanceLocation } from './finance-url';

/*
 * "Vraagt aandacht": one queue instead of notes scattered over the sections.
 * The state hands in plain data; the thresholds, the Dutch sentences and the
 * order live here, so the node tests can pin them down. Pure.
 */

export const OVERDUE_COST_DAYS = 30;
export const STALE_READING_DAYS = 14;
export const OLD_RECEIVABLE_DAYS = 30;
export const DOCUMENT_WINDOW_DAYS = 90;
/** The VAT reminder shows from 30 days before the deadline, calm (info) until its last 7 days (warn). */
export const VAT_REMINDER_DAYS = 30;
export const VAT_URGENT_DAYS = 7;

export type AttentionKind = 'vat-deadline' | 'container-due' | 'overdue-costs' | 'account-without-reading' | 'recurring-due' | 'unlinked-incoming'
  | 'old-receivables' | 'stale-reading' | 'receipts-without-account' | 'unbanked-payments' | 'costs-without-document' | 'open-credits' | 'unconfirmed-regimes';
export type AttentionTone = 'danger' | 'warn' | 'info';
/** What the row's button does directly; null means it just opens the target. 'unbanked' opens Transacties with the payments without a transaction. */
export type AttentionAction = 'book' | 'link' | 'check' | 'fill' | 'unbanked' | null;

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  tone: AttentionTone;
  count: number;
  amountEur: number | null;
  title: string;
  detail: string;
  action: AttentionAction;
  actionLabel: string;
  target: Partial<FinanceLocation>;
  accountKey?: string;
  /** Unlinked lines: what came in and what went out; their sum is amountEur, which only sorts (and the home still reads). */
  split?: { inEur: number; outEur: number };
  /** Days until the item's deadline (the VAT return); it leads its tone group when close. */
  dueInDays?: number;
}

/** The return of the closed quarter: its deadline, its figures and whether its payment is booked already. */
export interface VatDueInput {
  year: number;
  quarter: number;
  deadline: string;
  refundEur: number;
  payableEur: number;
  /** Lines to confirm or decide before filing. */
  pending: number;
  /** A VAT payment for the quarter is on the bank: the reminder is done. */
  booked: boolean;
}

export interface AttentionInput {
  today: string;
  /** Issued credit notes whose tegoed is not yet offset or refunded. */
  openCredits?: { count: number; eur: number };
  /** Open company costs: their date and what is still to pay. */
  openCosts: readonly { date: string; openEur: number }[];
  /** Costs of this year whose regime was only derived from the rate, or is unknown. */
  unconfirmedRegimes: { count: number };
  dueNowCount: number;
  containerNow: { count: number; eur: number };
  /** Official, active account bank lines without a saved allocation, in either direction. */
  bankLines: readonly { amountEur: number; salesPaymentId: number | null; allocated?: boolean }[];
  receiptsWithoutAccount: { count: number; eur: number };
  accounts: readonly { key: string; label: string; hasReading: boolean; ageDays: number | null }[];
  unbanked: { count: number; eur: number };
  /** Company costs with whether a document hangs on them. */
  costs: readonly { date: string; recurringCostId?: number | null; documented: boolean }[];
  /** Open invoices: the invoice date and what is still open; optional: the due date (else invoice date + 30), number and customer. */
  receivables: readonly { orderDate: string; remainingEur: number; dueDate?: string | null; number?: string | null; customer?: string | null }[];
  /** Optional: the closed quarter's return (absent: no VAT reminder, as on the home). */
  vatDue?: VatDueInput | null;
}

const TONE_ORDER: Readonly<Record<AttentionTone, number>> = { danger: 0, warn: 1, info: 2 };
const cents = (value: number): number => Math.round((Number.isFinite(value) ? value : 0) * 100);
const eur = (values: readonly number[]): number => values.reduce((sum, value) => sum + cents(value), 0) / 100;

function days(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const dayMonth = (day: string): string => `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
const EURO = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
const addDays = (day: string, count: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + count * 86_400_000).toISOString().slice(0, 10);

export function financeAttention(input: AttentionInput): AttentionItem[] {
  const { today } = input;
  const items: AttentionItem[] = [];
  const add = (item: Omit<AttentionItem, 'id'> & { id?: string }): void => { items.push({ ...item, id: item.id ?? item.kind }); };

  const vat = input.vatDue;
  if (vat && !vat.booked && vat.deadline >= today && days(today, vat.deadline) <= VAT_REMINDER_DAYS) {
    const left = days(today, vat.deadline);
    const money = vat.refundEur > 0 ? `${EURO.format(vat.refundEur)} terug te krijgen` : vat.payableEur > 0 ? `${EURO.format(vat.payableEur)} te betalen` : 'niets te betalen';
    add({ kind: 'vat-deadline', tone: left <= VAT_URGENT_DAYS ? 'warn' : 'info', count: 1, amountEur: null, dueInDays: left,
      title: `Btw-aangifte Q${vat.quarter} indienen vóór ${dayMonth(vat.deadline)}`,
      detail: [left === 0 ? 'Vandaag indienen' : `Nog ${left} ${plural(left, 'dag', 'dagen')}`, money, vat.pending > 0 ? `${vat.pending} te bevestigen` : ''].filter(Boolean).join(' · '),
      action: null, actionLabel: 'Openen', target: { view: 'analysis', tab: 'vat', year: String(vat.year), quarter: String(vat.quarter) as FinanceLocation['quarter'] } });
  }

  if (input.containerNow.count > 0) {
    const n = input.containerNow.count;
    add({ kind: 'container-due', tone: 'warn', count: n, amountEur: input.containerNow.eur,
      title: `${n} ${plural(n, 'containertermijn', 'containertermijnen')} nu te betalen`,
      detail: 'Volgens de afspraak bij de container · verwacht', action: null, actionLabel: 'Bekijken',
      target: { view: 'open', tab: 'containers' } });
  }

  const overdue = input.openCosts.filter((cost) => days(cost.date, today) > OVERDUE_COST_DAYS);
  if (overdue.length) {
    const oldest = Math.max(...overdue.map((cost) => days(cost.date, today)));
    add({ kind: 'overdue-costs', tone: 'danger', count: overdue.length, amountEur: eur(overdue.map((cost) => cost.openEur)),
      title: `${overdue.length} open ${plural(overdue.length, 'kost', 'kosten')} ouder dan ${OVERDUE_COST_DAYS} dagen`,
      detail: `De oudste staat er al ${oldest} dagen`, action: null, actionLabel: 'Bekijken', target: { view: 'open', tab: 'costs' } });
  }

  for (const account of input.accounts.filter((row) => !row.hasReading)) {
    add({ id: `account-without-reading:${account.key}`, kind: 'account-without-reading', tone: 'warn', count: 1, amountEur: null,
      title: `${account.label}: nog geen saldo`, detail: 'Zonder saldo telt deze rekening niet mee in je banksaldo',
      action: 'fill', actionLabel: 'Saldo invullen', target: { view: 'bank' }, accountKey: account.key });
  }

  if (input.dueNowCount > 0) {
    const n = input.dueNowCount;
    add({ kind: 'recurring-due', tone: 'warn', count: n, amountEur: null,
      title: `${n} vaste ${plural(n, 'kost staat', 'kosten staan')} klaar om te boeken`,
      detail: 'Na het boeken staan ze bij Te betalen', action: 'book', actionLabel: 'Nu boeken',
      target: { view: 'costs', tab: 'recurring' } });
  }

  const unlinked = input.bankLines.filter((line) => !line.allocated && line.salesPaymentId === null);
  if (unlinked.length) {
    const n = unlinked.length;
    const split = { inEur: eur(unlinked.filter((line) => line.amountEur > 0).map((line) => line.amountEur)),
      outEur: eur(unlinked.filter((line) => line.amountEur < 0).map((line) => -line.amountEur)) };
    add({ kind: 'unlinked-incoming', tone: 'warn', count: n, amountEur: eur(unlinked.map((line) => Math.abs(line.amountEur))), split,
      title: `${n} ${plural(n, 'banktransactie', 'banktransacties')} nog te koppelen`,
      detail: 'Koppel aan een factuur, kostenbetaling of containerbetaling', action: 'link', actionLabel: 'Koppelen',
      target: { view: 'bank', tab: 'movements', link: 'unlinked' } });
  }

  if ((input.openCredits?.count ?? 0) > 0) {
    const n = input.openCredits!.count;
    add({ kind: 'open-credits', tone: 'warn', count: n, amountEur: input.openCredits!.eur,
      title: `${n} ${plural(n, 'creditnota', 'creditnota\u2019s')} met een tegoed af te handelen`,
      detail: 'Verreken met een openstaande factuur of noteer de terugbetaling', action: null, actionLabel: 'Bekijken', target: { view: 'incoming', kind: 'credit' } });
  }

  /* Late by the invoice's own due date; without one, 30 days after the invoice date (the old rule). */
  const dueOf = (row: AttentionInput['receivables'][number]): string => row.dueDate || addDays(row.orderDate, OLD_RECEIVABLE_DAYS);
  const old = input.receivables.filter((row) => row.remainingEur > 0 && today > dueOf(row));
  if (old.length) {
    const n = old.length;
    const late = Math.max(...old.map((row) => days(dueOf(row), today)));
    const named = old.some((row) => !!row.number);
    const detail = !named ? 'Samen nog te ontvangen'
      : n === 1 ? [old[0].number, old[0].customer, `${late} ${plural(late, 'dag', 'dagen')} te laat`].filter(Boolean).join(' · ')
      : `Samen nog te ontvangen · de oudste ${late} ${plural(late, 'dag', 'dagen')} te laat`;
    add({ kind: 'old-receivables', tone: 'warn', count: n, amountEur: eur(old.map((row) => row.remainingEur)),
      title: named ? `${n} vervallen ${plural(n, 'factuur', 'facturen')}` : `${n} ${plural(n, 'factuur staat', 'facturen staan')} langer dan ${OLD_RECEIVABLE_DAYS} dagen open`,
      detail, action: null, actionLabel: 'Bekijken', target: { view: 'incoming' } });
  }

  for (const account of input.accounts.filter((row) => row.hasReading && row.ageDays !== null && row.ageDays > STALE_READING_DAYS)) {
    add({ id: `stale-reading:${account.key}`, kind: 'stale-reading', tone: 'info', count: 1, amountEur: null,
      title: `${account.label}: ${account.ageDays} dagen niet gecontroleerd`, detail: 'Vergelijk het saldo met je bankapp',
      action: 'check', actionLabel: 'Controleren', target: { view: 'bank' }, accountKey: account.key });
  }

  if (input.receiptsWithoutAccount.count > 0) {
    const n = input.receiptsWithoutAccount.count;
    add({ kind: 'receipts-without-account', tone: 'info', count: n, amountEur: input.receiptsWithoutAccount.eur,
      title: `${n} ${plural(n, 'factuurbetaling', 'factuurbetalingen')} zonder rekening`, detail: 'Tellen niet mee in je banksaldo',
      action: null, actionLabel: 'Bekijken', target: { view: 'incoming', tab: 'received', account: '__none__', period: 'all' } });
  }

  if (input.unbanked.count > 0) {
    const n = input.unbanked.count;
    add({ kind: 'unbanked-payments', tone: 'info', count: n, amountEur: input.unbanked.eur,
      title: `${n} ${plural(n, 'betaling', 'betalingen')} nog niet op de bank`, detail: 'Betaald gezet, maar geen transactie gevonden',
      action: 'unbanked', actionLabel: 'Bekijken', target: { view: 'bank', tab: 'movements' } });
  }

  const since = new Date(Date.parse(`${today}T00:00:00Z`) - DOCUMENT_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const bare = input.costs.filter((cost) => !cost.documented && !cost.recurringCostId && cost.date >= since && cost.date <= today);
  if (bare.length) {
    const n = bare.length;
    add({ kind: 'costs-without-document', tone: 'info', count: n, amountEur: null,
      title: `${n} ${plural(n, 'kost', 'kosten')} zonder factuur of bon`, detail: `Van de laatste ${DOCUMENT_WINDOW_DAYS} dagen`,
      action: null, actionLabel: 'Bekijken', target: { view: 'costs', docs: 'missing', from: since, to: today } });
  }

  if (input.unconfirmedRegimes.count > 0) {
    const n = input.unconfirmedRegimes.count;
    add({ kind: 'unconfirmed-regimes', tone: 'info', count: n, amountEur: null,
      title: `${n} ${plural(n, 'kost', 'kosten')}: btw-regeling nog te bevestigen`, detail: 'Afgeleid uit het btw-percentage · bevestig of pas aan',
      action: null, actionLabel: 'Bekijken', target: { view: 'costs', tab: 'company', period: 'year', regime: 'unconfirmed' } });
  }

  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => TONE_ORDER[a.item.tone] - TONE_ORDER[b.item.tone] || (a.item.dueInDays ?? 99) - (b.item.dueInDays ?? 99)
      || (b.item.amountEur ?? 0) - (a.item.amountEur ?? 0) || a.index - b.index)
    .map(({ item }) => item);
}
