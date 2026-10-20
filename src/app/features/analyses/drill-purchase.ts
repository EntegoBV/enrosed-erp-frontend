import type { ReceiptVarianceRow } from '../../core/api/models';
import type { PartnerFinancingRow } from './analysis-metrics';
import type { DrillView } from './drill-model';

/*
 * The drill-downs of Inkoop (Kwaliteit, Partners, Afwijkingen) and of the Overzicht rows that read them
 * (design/analyses2/design.md §B.2, §B.6). Container names come in as a function (containerName() is a runtime import).
 * Pure and node-tested (tests/analyses-drill-purchase.test.mts): type imports only.
 */

/** One received order with its variance lines (Afwijkingen' order cards, Overzicht's Aandacht row). */
export interface VarianceGroup {
  orderId: number;
  orderNumber: string;
  orderAlias: string | null;
  supplierName: string;
  receivedOn: string | null;
  expectedArrival: string | null;
  missingPieces: number;
  damagedPieces: number;
  totalLossValueEur: number;
  unvaluedLossPieces: number;
  rows: ReceiptVarianceRow[];
}

/** The report's lines per order, the last received first. */
export function varianceGroups(rows: readonly ReceiptVarianceRow[]): VarianceGroup[] {
  const groups = new Map<number, VarianceGroup>();
  for (const row of rows) {
    const current = groups.get(row.orderId) ?? {
      orderId: row.orderId,
      orderNumber: row.orderNumber,
      orderAlias: row.orderAlias,
      supplierName: row.supplierName,
      receivedOn: row.receivedOn,
      expectedArrival: row.expectedArrival,
      missingPieces: 0,
      damagedPieces: 0,
      totalLossValueEur: 0,
      unvaluedLossPieces: 0,
      rows: [],
    };
    current.missingPieces += row.missingPieces;
    current.damagedPieces += row.damagedPieces;
    current.totalLossValueEur += row.totalLossValueEur ?? 0;
    if (!row.valuationComplete) current.unvaluedLossPieces += row.missingPieces + row.damagedPieces;
    current.rows.push(row);
    groups.set(row.orderId, current);
  }
  return [...groups.values()].sort((left, right) =>
    (right.receivedOn ?? '').localeCompare(left.receivedOn ?? '') || right.orderId - left.orderId);
}

/** Aandacht › Ontvangstafwijkingen: one row per order, its known impact; the figure is the report's total. */
export function varianceOrdersView(groups: readonly VarianceGroup[], figure: number, unvaluedPieces: number, scope: string,
  name: (group: VarianceGroup) => string): DrillView {
  return {
    id: 'purchase.varianceOrders', title: 'Ontvangstafwijkingen', scope,
    summary: unvaluedPieces > 0 ? `+ ${unvaluedPieces.toLocaleString('nl-BE')} zonder waarde` : null,
    rows: groups.map((group) => ({
      key: `o${group.orderId}`, link: { path: ['/analyses', 'purchasing'], query: { deel: 'afwijkingen', orderId: group.orderId } },
      cells: { name: name(group), supplier: group.supplierName, received: group.receivedOn, missing: group.missingPieces, damaged: group.damagedPieces,
        impact: group.totalLossValueEur },
    })),
    columns: [{ key: 'name', label: 'Container', format: 'text', phone: 'title' }, { key: 'supplier', label: 'Leverancier', format: 'text', phone: 'sub' },
      { key: 'received', label: 'Ontvangen', format: 'day', phone: 'sub' }, { key: 'missing', label: 'Ontbreekt', format: 'int', phone: 'none' },
      { key: 'damaged', label: 'Beschadigd', format: 'int', phone: 'none' }, { key: 'impact', label: 'Impact', format: 'eur', phone: 'value' }],
    valueKey: 'impact', total: { value: figure, format: 'eur', of: 'sum' }, sort: { key: 'received', dir: 'desc' },
    empty: 'Geen tekorten of schade in deze periode.',
  };
}

const PAYMENTS = (row: PartnerFinancingRow) => ({ path: ['/purchasing', row.purchaseOrderId], query: { section: 'payments' } });

/** Partnercontainers af te rekenen: received, the auction statement still to come; the longest waiting first. */
export function partnersAwaitingView(rows: readonly PartnerFinancingRow[], received: ReadonlyMap<number, string | null>, figure: number,
  name: (row: PartnerFinancingRow) => string): DrillView {
  return {
    id: 'partners.awaiting', title: 'Partnercontainers af te rekenen', scope: 'Vandaag · ontvangen, veilingoverzicht wacht',
    rows: rows.filter((row) => row.awaitingSettlement).map((row) => ({
      key: `o${row.purchaseOrderId}`, link: PAYMENTS(row),
      cells: { name: name(row), partner: row.partnerName, received: received.get(row.purchaseOrderId) ?? null, remaining: row.remainingQuantity },
    })),
    columns: [{ key: 'name', label: 'Container', format: 'text', phone: 'title' }, { key: 'partner', label: 'Partner', format: 'text', phone: 'sub' },
      { key: 'received', label: 'Ontvangen', format: 'day', phone: 'sub' }, { key: 'remaining', label: 'Resterend', format: 'int', phone: 'value' }],
    valueKey: null, total: { value: figure, format: 'int', of: 'rows', label: 'Containers' }, sort: { key: 'received', dir: 'asc' },
    empty: 'Geen ontvangen partnercontainer wacht.',
  };
}

/** Voorschottermijnen te factureren: per container its open terms, in the analysis' order (overdue first, then the next due day). */
export function partnersUnbilledView(rows: readonly PartnerFinancingRow[], figure: number, name: (row: PartnerFinancingRow) => string): DrillView {
  return {
    id: 'partners.unbilled', title: 'Voorschottermijnen te factureren', scope: 'Vandaag · excl. btw',
    rows: rows.map((row, index) => ({
      key: `o${row.purchaseOrderId}`, link: PAYMENTS(row), tone: row.overdueUnbilledAdvanceEur > 0 ? 'danger' as const : null,
      cells: { rank: index, name: name(row), partner: row.partnerName, terms: row.unbilledAdvanceCount, next: row.nextAdvanceDueDate, amount: row.unbilledAdvanceEur },
    })),
    columns: [{ key: 'name', label: 'Container', format: 'text', phone: 'title' }, { key: 'partner', label: 'Partner', format: 'text', phone: 'sub' },
      { key: 'terms', label: 'Termijnen', format: 'int', phone: 'sub' }, { key: 'next', label: 'Volgende vervaldag', format: 'day', phone: 'none' },
      { key: 'amount', label: 'Te factureren excl.', format: 'eur', phone: 'value' }],
    valueKey: 'amount', total: { value: figure, format: 'eur', of: 'sum' }, sort: { key: 'rank', dir: 'asc' },
    empty: 'Geen voorschottermijnen te factureren.',
  };
}
