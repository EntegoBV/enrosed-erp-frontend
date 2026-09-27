import type { CompanyCost, Payee, PurchaseOrder, PurchaseOrderView } from '../../core/api/models';
import type { UpcomingCost } from './finance-metrics';

/*
 * Everything that still has to be paid, in one list with one 30-day horizon:
 * open company costs, open container terms and the recurring costs that come
 * up. Container amounts are the server's reconciliation forecast; this only
 * buckets them and never recomputes an allocation. Pure: node-tested.
 */

export type PayableBucket = 'now' | 'soon' | 'later';
export type TermDue = 'ORDERED' | 'SHIPPED' | 'ARRIVED';

/** One open container amount: a supplier term, or a whole payee stream. Payee codes, never labels. */
export interface ContainerPayable {
  key: string;
  orderId: number;
  orderNumber: string;
  alias: string | null;
  status: PurchaseOrder['status'];
  archived: boolean;
  payee: Payee;
  termLabel: string | null;
  due: TermDue | null;
  plannedEur: number;
  paidEur: number;
  remainingEur: number;
  bucket: 'now' | 'later';
  whenLabel: 'nu' | 'bij vertrek' | 'bij aankomst';
}

const SKIPPED = new Set(['PAID', 'SETTLED_LOWER', 'NOT_APPLICABLE']);
const PAYEE_ORDER: readonly Payee[] = ['SUPPLIER', 'LOGISTICS', 'SEPARATE', 'OTHER'];
const TERM_ORDER: readonly TermDue[] = ['ORDERED', 'SHIPPED', 'ARRIVED'];
const cents = (value: number | null | undefined): number => Math.round((Number.isFinite(value) ? value as number : 0) * 100);

/**
 * When a supplier term falls due. A copy of reached() in
 * purchasing/purchase-instalment-state.ts: keep the two in step.
 */
function reached(due: TermDue, status: PurchaseOrder['status']): boolean {
  if (due === 'ORDERED') return status !== 'CONCEPT';
  if (due === 'SHIPPED') return status === 'ONDERWEG' || status === 'ONTVANGEN';
  return status === 'ONTVANGEN';
}

/** Logistics and other costs fall due once the goods leave; inspection happens at the factory, so from the order on. */
function streamDue(payee: Payee, status: PurchaseOrder['status']): boolean {
  if (payee === 'SUPPLIER' || payee === 'SEPARATE') return status !== 'CONCEPT';
  return status === 'ONDERWEG' || status === 'ONTVANGEN';
}

export function containerPayables(views: readonly PurchaseOrderView[]): ContainerPayable[] {
  const rows: ContainerPayable[] = [];
  for (const view of views) {
    const order = view.order;
    const reconciliation = view.reconciliation;
    if (!reconciliation || order.status === 'CONCEPT') continue;
    const base = { orderId: order.id, orderNumber: order.number, alias: order.alias ?? null, status: order.status, archived: !!order.archivedAt };
    for (const stream of [...reconciliation.streams].sort((a, b) => PAYEE_ORDER.indexOf(a.payee) - PAYEE_ORDER.indexOf(b.payee))) {
      if (stream.finalized || SKIPPED.has(stream.status)) continue;
      const terms = stream.payee === 'SUPPLIER' ? reconciliation.supplierInstalments ?? [] : [];
      if (terms.length) {
        /* The terms replace the stream, never both: nothing is counted twice. */
        for (const term of [...terms].sort((a, b) => TERM_ORDER.indexOf(a.due) - TERM_ORDER.indexOf(b.due))) {
          if (term.finalized || cents(term.remainingEur) <= 0) continue;
          const now = reached(term.due, order.status);
          rows.push({ ...base, key: `container:${order.id}:SUPPLIER:${term.due}`, payee: 'SUPPLIER', termLabel: term.label || null, due: term.due,
            plannedEur: cents(term.plannedEur) / 100, paidEur: cents(term.paidEur) / 100, remainingEur: cents(term.remainingEur) / 100,
            bucket: now ? 'now' : 'later', whenLabel: now ? 'nu' : term.due === 'ARRIVED' ? 'bij aankomst' : 'bij vertrek' });
        }
        continue;
      }
      if (cents(stream.remainingEur) <= 0) continue;
      const now = streamDue(stream.payee, order.status);
      rows.push({ ...base, key: `container:${order.id}:${stream.payee}`, payee: stream.payee, termLabel: null, due: null,
        plannedEur: cents(stream.plannedEur) / 100, paidEur: cents(stream.paidEur) / 100, remainingEur: cents(stream.remainingEur) / 100,
        bucket: now ? 'now' : 'later', whenLabel: now ? 'nu' : 'bij vertrek' });
    }
  }
  return rows.sort((a, b) => a.orderNumber.localeCompare(b.orderNumber, 'nl') || a.orderId - b.orderId);
}

export interface PayableRow {
  key: string;
  kind: 'cost' | 'container' | 'recurring';
  bucket: PayableBucket;
  date: string | null;
  /** Days since the cost date; null for containers, recurring and future costs. */
  ageDays: number | null;
  title: string;
  party: string | null;
  /** Incl. btw for costs and recurring; the expected EUR for containers. */
  amountEur: number;
  /** Container amounts are forecasts. */
  estimated: boolean;
  /** A direct debit: the recurring cost pays itself. */
  autoPaid: boolean;
  costId: number | null;
  orderId: number | null;
  recurringId: number | null;
  cost: CompanyCost | null;
  container: ContainerPayable | null;
  upcoming: UpcomingCost | null;
}

export interface PayablesInput {
  openCosts: readonly CompanyCost[];
  upcoming30: readonly UpcomingCost[];
  containerRows: readonly ContainerPayable[];
  today: string;
}

/** Whole days from one ISO day to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** incl. = excl + round2(excl × max(0, vat) / 100), the same rule as finance-metrics inclOf. */
function inclCents(cost: Pick<CompanyCost, 'amountExclEur' | 'vatPct'>): number {
  const excl = cents(cost.amountExclEur);
  return excl + Math.round(excl * Math.max(0, Number(cost.vatPct) || 0) / 100);
}

const BUCKET_ORDER: Readonly<Record<PayableBucket, number>> = { now: 0, soon: 1, later: 2 };
const KIND_ORDER: Readonly<Record<PayableRow['kind'], number>> = { cost: 0, recurring: 1, container: 2 };

export function payablesFor(input: PayablesInput): PayableRow[] {
  const { today } = input;
  const horizon = addDays(today, 30);
  const empty = { costId: null, orderId: null, recurringId: null, cost: null, container: null, upcoming: null };
  const rows: PayableRow[] = [];
  for (const cost of input.openCosts) {
    if (cost.paidOn) continue;
    const bucket: PayableBucket = cost.date <= today ? 'now' : cost.date <= horizon ? 'soon' : 'later';
    rows.push({ ...empty, key: `cost:${cost.id ?? cost.date}`, kind: 'cost', bucket, date: cost.date,
      ageDays: cost.date <= today ? daysBetween(cost.date, today) : null, title: cost.description, party: cost.party || null,
      amountEur: inclCents(cost) / 100, estimated: false, autoPaid: false, costId: cost.id, cost });
  }
  for (const row of input.upcoming30) {
    rows.push({ ...empty, key: `recurring:${row.definition.id}:${row.date}`, kind: 'recurring', bucket: 'soon', date: row.date,
      ageDays: null, title: row.definition.name, party: row.definition.party || null, amountEur: cents(row.amountInclEur) / 100,
      estimated: false, autoPaid: !!row.definition.autoPaid, recurringId: row.definition.id, upcoming: row });
  }
  for (const container of input.containerRows) {
    rows.push({ ...empty, key: container.key, kind: 'container', bucket: container.bucket, date: null, ageDays: null,
      title: container.alias ? `${container.orderNumber} · ${container.alias}` : container.orderNumber, party: null,
      amountEur: container.remainingEur, estimated: true, autoPaid: false, orderId: container.orderId, container });
  }
  return rows.sort((a, b) => BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket]
    || (a.bucket === 'now' ? KIND_ORDER[a.kind] - KIND_ORDER[b.kind] : 0)
    || compareWithin(a, b));
}

/** Dated rows by date (oldest first), containers after them by order number, then the key. */
function compareWithin(a: PayableRow, b: PayableRow): number {
  if (a.date && b.date) return a.date.localeCompare(b.date) || a.key.localeCompare(b.key);
  if (a.date) return -1;
  if (b.date) return 1;
  return (a.container?.orderNumber ?? '').localeCompare(b.container?.orderNumber ?? '', 'nl') || a.key.localeCompare(b.key);
}

export interface PayableTotals {
  nowEur: number;
  soonEur: number;
  laterEur: number;
  totalEur: number;
  containerNowEur: number;
  containerLaterEur: number;
  byKind: Readonly<Record<PayableRow['kind'], number>>;
  counts: { now: number; soon: number; later: number; cost: number; container: number; recurring: number; total: number };
  /** The oldest open company cost dated today or earlier, in days; null without one. */
  oldestCostAgeDays: number | null;
}

/** Summed in cents, so 0.1 + 0.2 stays 0.3. */
export function payableTotals(rows: readonly PayableRow[]): PayableTotals {
  const sum = (filter: (row: PayableRow) => boolean): number => rows.filter(filter).reduce((total, row) => total + cents(row.amountEur), 0) / 100;
  const count = (filter: (row: PayableRow) => boolean): number => rows.filter(filter).length;
  const ages = rows.filter((row) => row.kind === 'cost' && row.ageDays !== null).map((row) => row.ageDays as number);
  return {
    nowEur: sum((row) => row.bucket === 'now'),
    soonEur: sum((row) => row.bucket === 'soon'),
    laterEur: sum((row) => row.bucket === 'later'),
    totalEur: sum(() => true),
    containerNowEur: sum((row) => row.kind === 'container' && row.bucket === 'now'),
    containerLaterEur: sum((row) => row.kind === 'container' && row.bucket === 'later'),
    byKind: { cost: sum((row) => row.kind === 'cost'), container: sum((row) => row.kind === 'container'), recurring: sum((row) => row.kind === 'recurring') },
    counts: {
      now: count((row) => row.bucket === 'now'), soon: count((row) => row.bucket === 'soon'), later: count((row) => row.bucket === 'later'),
      cost: count((row) => row.kind === 'cost'), container: count((row) => row.kind === 'container'),
      recurring: count((row) => row.kind === 'recurring'), total: rows.length,
    },
    oldestCostAgeDays: ages.length ? Math.max(...ages) : null,
  };
}
