/*
 * What is coming for a product, as one status: the state, the word, the
 * figure and the date every screen shows (Voorraad, Producten, the product
 * page, the sales picker and the sales line). Read from the purchase orders
 * behind GET /api/purchase-orders/expected-stock?arrived=true; nothing is
 * stored. Pure: only a type import.
 */
import type { ExpectedStock, ExpectedStockOrder } from '../core/api/models';

/** In reading order: what arrives first leads. */
export type IncomingState = 'AANGEKOMEN' | 'BINNENKORT' | 'ONDERWEG' | 'BESTELD';

/** The one fixed set of words. */
export const INCOMING_WORD: Readonly<Record<IncomingState, string>> = {
  AANGEKOMEN: 'Aangekomen', BINNENKORT: 'Binnenkort', ONDERWEG: 'Onderweg', BESTELD: 'Besteld',
};

const RANK: Readonly<Record<IncomingState, number>> = { AANGEKOMEN: 0, BINNENKORT: 1, ONDERWEG: 2, BESTELD: 3 };

/** A departed container expected at most this many days ahead, or this many days overdue, reads "Binnenkort". */
export const SOON_DAYS = 14;

/** One purchase order behind the figure. */
export interface IncomingOrder {
  orderId: number;
  orderNumber: string;
  /** The container as sales names it; the number when it has no name of its own. */
  name: string;
  state: IncomingState;
  word: string;
  /** Null from a backend that sends no breakdown yet. */
  quantity: number | null;
  expectedArrival: string | null;
  partner: boolean;
  /** "verwacht 20/11/2026", "verwacht sinds 02/11/2026", "datum nog open", "ontvangen 05/11/2026 · nog bij te boeken". */
  when: string;
}

export interface Incoming {
  /** Every order together: what sorting, the filter and "Leeg verbergen" go by. */
  total: number;
  /** The first arrival only: the pieces of the orders that share the lead's state and date. */
  quantity: number;
  /** What comes after the first arrival (total minus quantity). */
  later: number;
  state: IncomingState;
  word: string;
  /** The first arrival's date when it is today or later (yyyy-mm-dd); a past date is never shown bare. */
  date: string | null;
  /** "20/11". */
  dateShort: string | null;
  /** The first arrival in words, see IncomingOrder.when. */
  when: string;
  /** First arrival first. */
  orders: IncomingOrder[];
  /** False when built from a backend without the per-order breakdown. */
  detailed: boolean;
  /** One line per order, for a tooltip. */
  title: string;
  /** Read aloud: "+240 Binnenkort, verwacht 20/11/2026, +3.000 later". */
  label: string;
}

/** Today in Belgium as yyyy-mm-dd. */
export function brusselsToday(now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
    const day = `${part('year')}-${part('month')}-${part('day')}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  } catch { /* no time zone data: the device's own day */ }
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** yyyy-mm-dd plus a number of days. */
function plusDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

/** yyyy-mm-dd as dd/mm/jjjj. */
function long(day: string): string {
  return day.split('-').reverse().join('/');
}

function figure(value: number): string {
  return value.toLocaleString('nl-BE');
}

/**
 * The state of one order. Departed is the order's status or a departure day
 * that has come (tracking writes the day without moving the status). Only a
 * departed container reads "Binnenkort", and only while its date lies within
 * SOON_DAYS of today on either side: an order that has not left keeps
 * "Besteld" however near its date, and a date long past falls back to the
 * order's own word.
 */
function stateOf(order: Pick<ExpectedStockOrder, 'status' | 'expectedArrival' | 'shippedOn'>, today: string): IncomingState {
  if (order.status === 'ONTVANGEN') return 'AANGEKOMEN';
  const departed = order.status === 'ONDERWEG' || (!!order.shippedOn && order.shippedOn <= today);
  if (!departed) return 'BESTELD';
  const date = order.expectedArrival;
  return date && date >= plusDays(today, -SOON_DAYS) && date <= plusDays(today, SOON_DAYS) ? 'BINNENKORT' : 'ONDERWEG';
}

function whenOf(state: IncomingState, expectedArrival: string | null, receivedOn: string | null | undefined, today: string): string {
  if (state === 'AANGEKOMEN') return receivedOn ? `ontvangen ${long(receivedOn)} · nog bij te boeken` : 'nog bij te boeken';
  if (!expectedArrival) return 'datum nog open';
  return expectedArrival >= today ? `verwacht ${long(expectedArrival)}` : `verwacht sinds ${long(expectedArrival)}`;
}

/** The rows of one product: from the breakdown, else one row per order of the old fields (no figures of their own). */
function ordersOf(item: ExpectedStock, today: string): { orders: IncomingOrder[]; total: number; detailed: boolean } {
  if (Array.isArray(item.orders)) {
    const orders = item.orders.filter((order) => order && order.quantity > 0).map((order): IncomingOrder => {
      const state = stateOf(order, today);
      const expectedArrival = state === 'AANGEKOMEN' ? null : order.expectedArrival ?? null;
      return {
        orderId: order.orderId, orderNumber: order.orderNumber ?? '', name: order.name?.trim() || order.orderNumber || `Inkoop #${order.orderId}`,
        state, word: INCOMING_WORD[state], quantity: order.quantity, expectedArrival, partner: order.partner === true,
        when: whenOf(state, expectedArrival, order.receivedOn, today),
      };
    });
    return { orders, total: orders.reduce((sum, order) => sum + (order.quantity ?? 0), 0), detailed: true };
  }
  /* A backend before 2026-11-10: it cannot say Besteld from Vertrokken, so every order reads "Onderweg". */
  const total = item.quantity > 0 ? item.quantity : 0;
  const orders: IncomingOrder[] = [];
  (item.orderIds ?? []).forEach((orderId, index) => {
    if (orders.some((order) => order.orderId === orderId)) return;
    const number = item.orderNumbers?.[index] ?? '';
    orders.push({
      orderId, orderNumber: number, name: number || `Inkoop #${orderId}`, state: 'ONDERWEG', word: INCOMING_WORD.ONDERWEG, quantity: null,
      expectedArrival: item.expectedArrival ?? null, partner: false, when: whenOf('ONDERWEG', item.expectedArrival ?? null, null, today),
    });
  });
  return { orders, total, detailed: false };
}

function build(orders: IncomingOrder[], total: number, detailed: boolean, fallbackDate: string | null, today: string): Incoming | null {
  if (!(total > 0)) return null;
  const sorted = [...orders].sort((a, b) => RANK[a.state] - RANK[b.state]
    || (a.expectedArrival === b.expectedArrival ? 0 : a.expectedArrival === null ? 1 : b.expectedArrival === null ? -1 : a.expectedArrival < b.expectedArrival ? -1 : 1)
    || a.orderId - b.orderId);
  const lead = sorted[0];
  const state = lead?.state ?? 'ONDERWEG';
  const arrival = lead ? lead.expectedArrival : fallbackDate;
  /* The first arrival: the orders that share the lead's state and date. Without figures per order it is everything. */
  const first = detailed && lead ? sorted.filter((order) => order.state === lead.state && order.expectedArrival === lead.expectedArrival) : sorted;
  const quantity = detailed && lead ? first.reduce((sum, order) => sum + (order.quantity ?? 0), 0) : total;
  const later = Math.max(0, total - quantity);
  const date = arrival && arrival >= today ? arrival : null;
  const when = lead?.when ?? whenOf(state, arrival, null, today);
  const word = INCOMING_WORD[state];
  const title = sorted.map((order) => order.quantity === null ? order.name : `${order.name} · +${figure(order.quantity)} · ${order.word} · ${order.when}`).join('\n');
  return {
    total, quantity, later, state, word, date, dateShort: date ? `${date.slice(8, 10)}/${date.slice(5, 7)}` : null, when, orders: sorted, detailed,
    title, label: `+${figure(quantity)} ${word}, ${when}${later ? `, +${figure(later)} later` : ''}`,
  };
}

/** One product's status; null when nothing is coming. */
export function incomingOf(item: ExpectedStock | null | undefined, today: string): Incoming | null {
  if (!item) return null;
  const { orders, total, detailed } = ordersOf(item, today);
  return build(orders, total, detailed, item.expectedArrival ?? null, today);
}

/** A series' status: its colours together, an order that carries several colours counted once with the summed pieces. */
export function incomingSum(items: readonly (ExpectedStock | null | undefined)[], today: string): Incoming | null {
  const merged = new Map<number, IncomingOrder>();
  let total = 0;
  let detailed = true;
  let fallbackDate: string | null = null;
  for (const item of items) {
    if (!item) continue;
    const part = ordersOf(item, today);
    if (!(part.total > 0)) continue;
    total += part.total;
    detailed = detailed && part.detailed;
    if (item.expectedArrival && (fallbackDate === null || item.expectedArrival < fallbackDate)) fallbackDate = item.expectedArrival;
    for (const order of part.orders) {
      const known = merged.get(order.orderId);
      if (!known) merged.set(order.orderId, { ...order });
      else known.quantity = known.quantity === null || order.quantity === null ? null : known.quantity + order.quantity;
    }
  }
  return build([...merged.values()], total, detailed, fallbackDate, today);
}

/** Every product's status by product id. */
export function incomingMap(items: readonly ExpectedStock[], today: string): Map<number, Incoming> {
  const map = new Map<number, Incoming>();
  for (const item of items) {
    const value = incomingOf(item, today);
    if (value) map.set(item.productId, value);
  }
  return map;
}

/** How many distinct purchase orders these carry. */
export function incomingOrderCount(values: Iterable<Incoming | null | undefined>): number {
  const ids = new Set<number>();
  for (const value of values) for (const order of value?.orders ?? []) ids.add(order.orderId);
  return ids.size;
}

/** First arrival first: by state, then by date (an open date last), then the most pieces. */
export function compareIncoming(a: Incoming | null | undefined, b: Incoming | null | undefined): number {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  const left = a.orders[0]?.expectedArrival ?? null;
  const right = b.orders[0]?.expectedArrival ?? null;
  return RANK[a.state] - RANK[b.state]
    || (left === right ? 0 : left === null ? 1 : right === null ? -1 : left < right ? -1 : 1)
    || b.total - a.total;
}
