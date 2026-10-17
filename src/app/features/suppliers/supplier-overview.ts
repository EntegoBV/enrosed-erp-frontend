/*
 * Leveranciers (Inkoop redesign I7, 2026-10-17, F20): per supplier what its
 * containers still ask and where they stand, from the same list the Inkoop
 * screen loads and the same open container amounts as Kosten & bank's Te
 * betalen (finance/payables' containerPayables, handed in). Pure and
 * node-tested: type-only imports.
 */
import type { PurchaseOrder, PurchaseOrderView } from '../../core/api/models';
import type { ContainerPayable } from '../finance/payables';

/** A container's payment in one word and two sums, as the Inkoop list's Betaling column reads it. */
export interface ContainerPayment {
  state: 'due' | 'later' | 'paid' | 'concept' | 'unknown';
  nowEur: number;
  laterEur: number;
}

export interface SupplierContainer {
  id: number;
  /** containerName(): the herkenbare naam, else the PO number. */
  name: string;
  number: string;
  status: PurchaseOrder['status'];
  orderDate: string;
  receivedOn: string | null;
  totalEur: number;
  partner: boolean;
  archived: boolean;
  payment: ContainerPayment | null;
}

export interface SupplierOverview {
  supplierId: number;
  /** Newest order first. */
  containers: SupplierContainer[];
  /** Not received yet (concept, besteld, vertrokken). */
  running: number;
  received: number;
  nowEur: number;
  laterEur: number;
  /** Open supplier credits (tegoed) over its containers, in euro. */
  creditOpenEur: number;
  lastOrderDate: string | null;
}

const cents = (value: number | null | undefined): number => Math.round((Number.isFinite(value) ? value as number : 0) * 100);

function nameOf(order: Pick<PurchaseOrder, 'alias' | 'number' | 'id'>): string {
  const alias = typeof order.alias === 'string' ? order.alias.trim() : '';
  if (alias) return alias;
  const number = typeof order.number === 'string' ? order.number.trim() : '';
  return number || `Inkoop #${order.id}`;
}

function openCreditCents(view: Pick<PurchaseOrderView, 'reconciliation' | 'supplierCredits'>): number {
  const total = view.reconciliation?.totals?.supplierCreditOpenEur;
  if (total != null) return cents(total);
  return (view.supplierCredits ?? []).filter((credit) => credit.status === 'OPEN').reduce((sum, credit) => sum + cents(credit.amountEur), 0);
}

/** Per container: what is due now and later, from the open amounts (bucket now/later). */
function containerPayments(views: readonly PurchaseOrderView[],
  payables: readonly Pick<ContainerPayable, 'orderId' | 'bucket' | 'remainingEur'>[]): Map<number, ContainerPayment> {
  const sums = new Map<number, { now: number; later: number }>();
  for (const row of payables) {
    const sum = sums.get(row.orderId) ?? { now: 0, later: 0 };
    if (row.bucket === 'now') sum.now += cents(row.remainingEur); else sum.later += cents(row.remainingEur);
    sums.set(row.orderId, sum);
  }
  const out = new Map<number, ContainerPayment>();
  for (const view of views) {
    const sum = sums.get(view.order.id) ?? { now: 0, later: 0 };
    const state: ContainerPayment['state'] = view.order.status === 'CONCEPT' ? 'concept' : !view.reconciliation ? 'unknown'
      : sum.now > 0 ? 'due' : sum.later > 0 ? 'later' : 'paid';
    out.set(view.order.id, state === 'concept' || state === 'unknown' ? { state, nowEur: 0, laterEur: 0 } : { state, nowEur: sum.now / 100, laterEur: sum.later / 100 });
  }
  return out;
}

/** Every supplier's containers and open amounts; archived containers count in the money, not in lopend/ontvangen. */
export function supplierOverview(views: readonly PurchaseOrderView[],
  payables: readonly Pick<ContainerPayable, 'orderId' | 'bucket' | 'remainingEur'>[]): Map<number, SupplierOverview> {
  const payments = containerPayments(views, payables);
  const out = new Map<number, SupplierOverview>();
  const sums = new Map<number, { now: number; later: number; credit: number }>();
  for (const view of views) {
    const order = view.order;
    let row = out.get(order.supplierId);
    if (!row) {
      row = { supplierId: order.supplierId, containers: [], running: 0, received: 0, nowEur: 0, laterEur: 0, creditOpenEur: 0, lastOrderDate: null };
      out.set(order.supplierId, row);
      sums.set(order.supplierId, { now: 0, later: 0, credit: 0 });
    }
    const payment = payments.get(order.id) ?? null;
    row.containers.push({
      id: order.id, name: nameOf(order), number: order.number, status: order.status, orderDate: order.orderDate,
      receivedOn: order.receivedOn ?? null, totalEur: view.costing?.totals?.totalEur ?? 0, partner: order.partnerCustomerId != null,
      archived: !!order.archivedAt, payment,
    });
    const sum = sums.get(order.supplierId)!;
    sum.now += cents(payment?.nowEur);
    sum.later += cents(payment?.laterEur);
    sum.credit += openCreditCents(view);
    if (!order.archivedAt) {
      if (order.status === 'ONTVANGEN') row.received++;
      else row.running++;
    }
    if (order.orderDate && (!row.lastOrderDate || order.orderDate > row.lastOrderDate)) row.lastOrderDate = order.orderDate;
  }
  for (const row of out.values()) {
    const sum = sums.get(row.supplierId)!;
    row.nowEur = sum.now / 100;
    row.laterEur = sum.later / 100;
    row.creditOpenEur = sum.credit / 100;
    row.containers.sort((a, b) => b.orderDate.localeCompare(a.orderDate) || b.id - a.id);
  }
  return out;
}

/** '3 lopend · 2 ontvangen', the parts that are there. */
export function containerCounts(row: Pick<SupplierOverview, 'running' | 'received'> | undefined): string {
  if (!row) return 'nog geen containers';
  const parts = [row.running ? `${row.running} lopend` : '', row.received ? `${row.received} ontvangen` : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'gearchiveerd';
}
