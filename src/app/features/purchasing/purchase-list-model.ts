/*
 * The Inkoop list (Inkoop redesign I1, 2026-10-17): what a row and a group
 * say beyond the order itself. The payment column reads the same open
 * container amounts as Kosten & bank's Te betalen (containerPayables of
 * finance/payables.ts, handed in), so the two never disagree. Pure and
 * node-tested: type-only imports.
 */
import type { PurchaseOrder, PurchaseOrderView } from '../../core/api/models';
import type { ContainerPayable } from '../finance/payables';

/**
 * A row's Betaling cell. due: something to pay now (and maybe later); later:
 * nothing now, something later; paid: nothing open; concept: not ordered
 * yet; unknown: the server sent no reconciliation.
 */
export interface ListPayment {
  state: 'due' | 'later' | 'paid' | 'concept' | 'unknown';
  nowEur: number;
  laterEur: number;
}

const cents = (value: number | null | undefined): number => Math.round((Number.isFinite(value) ? value as number : 0) * 100);

/** Per container: what is due now and later, from the open container amounts (bucket now/later). */
export function listPayments(views: readonly PurchaseOrderView[],
  payables: readonly Pick<ContainerPayable, 'orderId' | 'bucket' | 'remainingEur'>[]): Map<number, ListPayment> {
  const sums = new Map<number, { now: number; later: number }>();
  for (const row of payables) {
    const sum = sums.get(row.orderId) ?? { now: 0, later: 0 };
    if (row.bucket === 'now') sum.now += cents(row.remainingEur); else sum.later += cents(row.remainingEur);
    sums.set(row.orderId, sum);
  }
  const out = new Map<number, ListPayment>();
  for (const view of views) {
    const order = view.order;
    const sum = sums.get(order.id) ?? { now: 0, later: 0 };
    const nowEur = sum.now / 100, laterEur = sum.later / 100;
    if (order.status === 'CONCEPT') out.set(order.id, { state: 'concept', nowEur: 0, laterEur: 0 });
    else if (!view.reconciliation) out.set(order.id, { state: 'unknown', nowEur: 0, laterEur: 0 });
    else out.set(order.id, { state: sum.now > 0 ? 'due' : sum.later > 0 ? 'later' : 'paid', nowEur, laterEur });
  }
  return out;
}

/** The sums of a set of rows' payment cells (a supplier group, the filtered list). */
export function groupSums(payments: readonly (ListPayment | undefined)[]): { nowEur: number; laterEur: number } {
  let now = 0, later = 0;
  for (const payment of payments) {
    if (!payment) continue;
    now += cents(payment.nowEur);
    later += cents(payment.laterEur);
  }
  return { nowEur: now / 100, laterEur: later / 100 };
}

function day(value: string | null | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}

/** The status's own line under the pill: where the container stands, with its day. */
export function statusLine(order: Pick<PurchaseOrder, 'status' | 'orderDate' | 'expectedArrival' | 'shippedOn' | 'receivedOn' | 'stockBooked'>): string {
  const expected = day(order.expectedArrival);
  switch (order.status) {
    case 'CONCEPT': return 'calculatie';
    case 'BESTELD': return expected ? `verwacht ${expected}` : day(order.orderDate) ? `besteld ${day(order.orderDate)}` : 'besteld';
    case 'ONDERWEG': return expected ? `verwacht ${expected}` : day(order.shippedOn) ? `vertrokken ${day(order.shippedOn)}` : 'vertrokken';
    default: {
      const received = day(order.receivedOn);
      return (received ? `ontvangen ${received}` : 'ontvangen') + (order.stockBooked === false ? ' · nog bij te boeken' : '');
    }
  }
}

/** Lowercase without accents: 'Café' finds 'cafe'. */
export function foldText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('nl-BE').trim();
}

/** The search: herkenbare naam, PO number, supplier, maker and the product names of the lines; every word must match. */
export function matchesQuery(view: Pick<PurchaseOrderView, 'order' | 'costing' | 'createdBy'>, supplierName: string, query: string): boolean {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = foldText([
    view.order.alias, view.order.number, supplierName, view.createdBy?.displayName,
    ...(view.costing?.lines ?? []).map((line) => line.productName),
  ].filter(Boolean).join(' \u0001 '));
  return words.every((word) => haystack.includes(word));
}

/** The fill's colour, as the container desk paints it: over 105 % bad, over 100 % warn, from 97 % (nothing over) ok. */
export function fillTone(fillPercent: number, overflowCbm = 0): 'ok' | 'warn' | 'bad' | '' {
  if (fillPercent > 105) return 'bad';
  if (fillPercent > 100) return 'warn';
  return overflowCbm <= 0 && fillPercent >= 97 ? 'ok' : '';
}

/** The phone's third trailing line: what is due now, else the status day. */
export function phoneTrail(order: Parameters<typeof statusLine>[0], payment: ListPayment | undefined): { text: string; due: boolean } {
  if (payment?.state === 'due') return { text: '', due: true };
  return { text: order.status === 'CONCEPT' ? 'calculatie' : statusLine({ ...order, stockBooked: null }), due: false };
}

/** A server text with amounts in it ('Betaling open: … (€ 4500,00)'): the euro sign never wraps away from its figure (N9). */
export function keepEuro(text: string): string {
  return text.replace(/€ (?=[\d−-])/g, '€\u00a0');
}
