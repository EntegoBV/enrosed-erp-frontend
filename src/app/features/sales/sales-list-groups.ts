import type { SalesOrderView } from '../../core/api/models';
import { invoiceReceivable } from '../finance/incoming-money';
import { isPartnerDocument } from './sales-payment-state';
import { statusOf } from './quote-status';

export interface SalesContainerStatus {
  label: string;
  cls: string;
  count: number;
  concept: boolean;
  inactive: boolean;
}

export interface SalesContainerGroup {
  kind: 'PARTNER_CONTAINER';
  key: string;
  purchaseOrderId: number;
  customerId: number | null;
  purchaseOrderNumber: string | null;
  rows: SalesOrderView[];
  summary: {
    count: number;
    totalEur: number;
    draftCount: number;
    draftEur: number;
    issuedCount: number;
    inactiveCount: number;
    statuses: SalesContainerStatus[];
    receivedEur: number;
    remainingEur: number;
    creditEur: number;
    attentionCount: number;
    containerPieces: number | null;
  };
}

export interface SalesSplitGroup {
  kind: 'SPLIT_ORDER';
  key: string;
  groupId: string;
  rootOrderId: number;
  rows: SalesOrderView[];
  summary: { parts: number; totalEur: number; pieces: number; unavailableCount: number; waitingCount: number; shippedCount: number };
}

export type SalesListEntry = SalesContainerGroup | SalesSplitGroup | { kind: 'DOCUMENT'; key: string; row: SalesOrderView };
const INACTIVE = new Set(['GEANNULEERD', 'AFGEWEZEN', 'VERLOPEN']);
const sumMoney = (values: number[]): number => values.reduce((sum, value) => sum + (Number.isFinite(value) ? Math.round(value * 100) : 0), 0) / 100;

/** Call after filtering/sorting. Groups occupy their first invoice's position; member order stays intact. */
export function groupSalesInvoices(rows: readonly SalesOrderView[], needsAttention: (row: SalesOrderView) => boolean = () => false): SalesListEntry[] {
  const entries: SalesListEntry[] = [];
  const groups = new Map<string, SalesContainerGroup>();
  const splitGroups = new Map<string, SalesSplitGroup>();
  for (const row of rows) {
    const split = row.fulfillment;
    if (split?.groupId && Number.isSafeInteger(split.rootOrderId) && split.rootOrderId > 0
        && [1, 2].includes(split.part) && !isPartnerDocument(row.order)) {
      const key = `split-${split.groupId}-${row.order.customerId ?? 'unknown'}`;
      let group = splitGroups.get(key);
      if (!group) {
        group = { kind: 'SPLIT_ORDER', key, groupId: split.groupId, rootOrderId: split.rootOrderId, rows: [],
          summary: { parts: 0, totalEur: 0, pieces: 0, unavailableCount: 0, waitingCount: 0, shippedCount: 0 } };
        splitGroups.set(key, group); entries.push(group);
      }
      group.rows.push(row);
      continue;
    }
    const purchaseOrderId = row.order.partnerPurchaseOrderId;
    if (row.order.docType !== 'FACTUUR' || !isPartnerDocument(row.order)
        || !Number.isInteger(purchaseOrderId) || purchaseOrderId! <= 0) {
      entries.push({ kind: 'DOCUMENT', key: `document-${row.order.id}`, row });
      continue;
    }
    const key = `container-${purchaseOrderId}-customer-${row.order.customerId ?? 'unknown'}`;
    let group = groups.get(key);
    if (!group) {
      group = { kind: 'PARTNER_CONTAINER', key, purchaseOrderId: purchaseOrderId!, customerId: row.order.customerId,
        purchaseOrderNumber: null, rows: [], summary: { count: 0, totalEur: 0, draftCount: 0, draftEur: 0,
          issuedCount: 0, inactiveCount: 0, statuses: [], receivedEur: 0, remainingEur: 0, creditEur: 0, attentionCount: 0, containerPieces: null } };
      groups.set(key, group); entries.push(group);
    }
    group.rows.push(row);
  }
  for (const group of splitGroups.values()) {
    group.rows.sort((a, b) => a.fulfillment!.part - b.fulfillment!.part);
    // An archived source quote and its invoice can share one part. Count its live document only.
    const active = group.rows.filter(row => !INACTIVE.has(row.order.status)
      && !((row.order.docType ?? 'OFFERTE') === 'OFFERTE' && (row.invoicedAsId || row.invoicedAs)));
    group.summary = {
      parts: new Set(group.rows.map(row => row.fulfillment!.part)).size,
      totalEur: sumMoney(active.map(row => row.priced.totals.total)),
      pieces: active.reduce((sum, row) => sum + (Number.isFinite(row.priced.totals.pieces) ? row.priced.totals.pieces : 0), 0),
      unavailableCount: active.reduce((sum, row) => sum + (row.order.lines ?? []).filter(line => line.unavailable === true).length, 0),
      waitingCount: active.filter(row => !row.order.goodsShippedAt && row.fulfillment!.status === 'WAITING_FOR_STOCK').length,
      shippedCount: active.filter(row => !!row.order.goodsShippedAt || row.fulfillment!.status === 'SHIPPED').length,
    };
  }
  for (const group of groups.values()) {
    const active = group.rows.filter(row => !INACTIVE.has(row.order.status));
    const drafts = active.filter(row => row.order.status === 'CONCEPT');
    const issued = active.filter(row => row.order.status !== 'CONCEPT');
    const payments = issued.map(invoiceReceivable);
    const contents = group.rows.map(row => row.advanceContents).filter(contents => contents?.purchaseOrderId === group.purchaseOrderId);
    const quantities = contents.map(contents => contents!.totals.pieces).filter(Number.isFinite);
    const statuses = new Map<string, SalesContainerStatus>();
    for (const row of group.rows) {
      const status = statusOf(row);
      const existing = statuses.get(status.label);
      if (existing) existing.count += 1;
      else statuses.set(status.label, { ...status, count: 1,
        concept: row.order.status === 'CONCEPT', inactive: INACTIVE.has(row.order.status) });
    }
    group.purchaseOrderNumber = contents.find(contents => contents!.purchaseOrderNumber?.trim())?.purchaseOrderNumber ?? null;
    group.summary = {
      count: group.rows.length,
      totalEur: sumMoney(active.map(row => row.priced.totals.total)),
      draftCount: drafts.length, draftEur: sumMoney(drafts.map(row => row.priced.totals.total)),
      issuedCount: issued.length, inactiveCount: group.rows.length - active.length,
      statuses: [...statuses.values()].sort((left, right) => Number(right.concept) - Number(left.concept)),
      receivedEur: sumMoney(payments.map(payment => payment.receivedEur)),
      remainingEur: sumMoney(payments.map(payment => payment.remainingEur)),
      creditEur: sumMoney(payments.map(payment => payment.creditEur)),
      attentionCount: group.rows.filter(needsAttention).length,
      // Each advance can repeat the complete cargo. Never add those quantities or invent one when snapshots differ.
      containerPieces: quantities.length > 0 && quantities.every(value => value === quantities[0]) ? quantities[0] : null,
    };
  }
  return entries;
}
