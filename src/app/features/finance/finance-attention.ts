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

export type AttentionKind = 'container-due' | 'overdue-costs' | 'account-without-reading' | 'recurring-due' | 'unlinked-incoming'
  | 'old-receivables' | 'stale-reading' | 'receipts-without-account' | 'unbanked-payments' | 'costs-without-document';
export type AttentionTone = 'danger' | 'warn' | 'info';
/** What the row's button does directly; null means it just opens the target. */
export type AttentionAction = 'book' | 'link' | 'check' | 'fill' | null;

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
}

export interface AttentionInput {
  today: string;
  /** Open company costs: their date and the amount incl. btw. */
  openCosts: readonly { date: string; amountInclEur: number }[];
  dueNowCount: number;
  containerNow: { count: number; eur: number };
  /** Bank lines as recorded: only incoming ones without an invoice count. */
  bankLines: readonly { amountEur: number; salesPaymentId: number | null }[];
  receiptsWithoutAccount: { count: number; eur: number };
  accounts: readonly { key: string; label: string; hasReading: boolean; ageDays: number | null }[];
  unbanked: { count: number; eur: number };
  /** Company costs with whether a document hangs on them. */
  costs: readonly { date: string; recurringCostId?: number | null; documented: boolean }[];
  /** Open invoices: the invoice date and what is still open. */
  receivables: readonly { orderDate: string; remainingEur: number }[];
}

const TONE_ORDER: Readonly<Record<AttentionTone, number>> = { danger: 0, warn: 1, info: 2 };
const cents = (value: number): number => Math.round((Number.isFinite(value) ? value : 0) * 100);
const eur = (values: readonly number[]): number => values.reduce((sum, value) => sum + cents(value), 0) / 100;

function days(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);

export function financeAttention(input: AttentionInput): AttentionItem[] {
  const { today } = input;
  const items: AttentionItem[] = [];
  const add = (item: Omit<AttentionItem, 'id'> & { id?: string }): void => { items.push({ ...item, id: item.id ?? item.kind }); };

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
    add({ kind: 'overdue-costs', tone: 'danger', count: overdue.length, amountEur: eur(overdue.map((cost) => cost.amountInclEur)),
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

  const unlinked = input.bankLines.filter((line) => line.amountEur > 0 && line.salesPaymentId === null);
  if (unlinked.length) {
    const n = unlinked.length;
    add({ kind: 'unlinked-incoming', tone: 'warn', count: n, amountEur: eur(unlinked.map((line) => line.amountEur)),
      title: `${n} ontvangen ${plural(n, 'bankbeweging', 'bankbewegingen')} nog niet aan een factuur gekoppeld`,
      detail: 'Koppel ze, dan telt het geld één keer', action: 'link', actionLabel: 'Koppelen',
      target: { view: 'bank', tab: 'movements', link: 'unlinked' } });
  }

  const old = input.receivables.filter((row) => row.remainingEur > 0 && days(row.orderDate, today) > OLD_RECEIVABLE_DAYS);
  if (old.length) {
    const n = old.length;
    add({ kind: 'old-receivables', tone: 'warn', count: n, amountEur: eur(old.map((row) => row.remainingEur)),
      title: `${n} ${plural(n, 'factuur staat', 'facturen staan')} langer dan ${OLD_RECEIVABLE_DAYS} dagen open`,
      detail: 'Samen nog te ontvangen', action: null, actionLabel: 'Bekijken', target: { view: 'incoming' } });
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
      title: `${n} ${plural(n, 'betaling', 'betalingen')} nog niet op de bank`, detail: 'Betaald gezet, maar geen bankbeweging gevonden',
      action: null, actionLabel: 'Bekijken', target: { view: 'bank' } });
  }

  const since = new Date(Date.parse(`${today}T00:00:00Z`) - DOCUMENT_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const bare = input.costs.filter((cost) => !cost.documented && !cost.recurringCostId && cost.date >= since && cost.date <= today);
  if (bare.length) {
    const n = bare.length;
    add({ kind: 'costs-without-document', tone: 'info', count: n, amountEur: null,
      title: `${n} ${plural(n, 'kost', 'kosten')} zonder factuur of bon`, detail: `Van de laatste ${DOCUMENT_WINDOW_DAYS} dagen`,
      action: null, actionLabel: 'Bekijken', target: { view: 'costs', docs: 'missing', from: since, to: today } });
  }

  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => TONE_ORDER[a.item.tone] - TONE_ORDER[b.item.tone]
      || (b.item.amountEur ?? 0) - (a.item.amountEur ?? 0) || a.index - b.index)
    .map(({ item }) => item);
}
