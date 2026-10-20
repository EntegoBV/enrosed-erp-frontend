import type { ReceiptVarianceRow, ReceiptVarianceTotals } from '../../core/api/models';
import type { PartnerFinancingRow } from './analysis-metrics';
import type { DrillColumn, DrillLink, DrillRow, DrillView } from './drill-model';
import type { ReceiptOrderRow, SupplierReceiptPerformance, SupplierScorecard } from './receipt-metrics';

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

/** Nog te ontvangen: the partner containers with an open invoice amount, the most first; the figure is openEur. */
export function partnersOpenView(rows: readonly PartnerFinancingRow[], figure: number, name: (row: PartnerFinancingRow) => string): DrillView {
  return {
    id: 'partners.open', title: 'Nog te ontvangen van partners', scope: 'Vandaag · incl. btw',
    rows: rows.filter((row) => row.openEur > 0).map((row) => ({
      key: `o${row.purchaseOrderId}`, link: PAYMENTS(row), cells: { name: name(row), partner: row.partnerName, open: row.openEur },
    })),
    columns: [{ key: 'name', label: 'Container', format: 'text', phone: 'title' }, { key: 'partner', label: 'Partner', format: 'text', phone: 'sub' },
      { key: 'open', label: 'Open incl.', format: 'eur', phone: 'value' }],
    valueKey: 'open', total: { value: figure, format: 'eur', of: 'sum' }, sort: { key: 'open', dir: 'desc' },
    empty: 'Niets meer te ontvangen van partners.',
  };
}

/* ---------- Kwaliteit (§B.6): one row per received order, the same tests as the figures */

/** A received order with the names the page knows: its container, its supplier and the supplier's agreed lead time. */
export interface ReceivedOrderRow extends ReceiptOrderRow {
  name: string;
  supplierId: number;
  supplierName: string;
  /** The supplier's lead time in days; null when none is set. */
  agreedDays: number | null;
}

export type ReceiptFigure = 'perfect' | 'ontime' | 'lead';

const NL = new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 0 });
const PCT = new Intl.NumberFormat('nl-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** "perfect", "3 ontbreekt · 2 beschadigd", "meer ontvangen", "geen bestelsnapshot". */
function receiptWords(row: ReceiptOrderRow): string {
  if (row.perfect === null) return 'geen bestelsnapshot';
  if (row.perfect) return 'perfect';
  const parts = [row.missing ? `${NL.format(row.missing)} ontbreekt` : '', row.damaged ? `${NL.format(row.damaged)} beschadigd` : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'meer ontvangen';
}

/** "op tijd", "4 d te laat", or nothing without an ETA. */
function onTimeWords(row: ReceiptOrderRow): string | null {
  return row.lateDays === null ? null : row.lateDays === 0 ? 'op tijd' : `${NL.format(row.lateDays)} d te laat`;
}

/** An order with a shortage or damage opens its card on Afwijkingen; any other its purchase order. */
function receiptLink(row: ReceiptOrderRow): DrillLink {
  return row.missing > 0 || row.damaged > 0
    ? { path: ['/analyses', 'purchasing'], query: { deel: 'afwijkingen', orderId: row.id } } : { path: ['/purchasing', row.id] };
}

/** The view's own order before the stable sort: not perfect (then no snapshot) first, or late (then no ETA) first; each by the last receipt. */
function receiptRank(rows: readonly ReceivedOrderRow[], by: ReceiptFigure): Map<number, number> {
  const weight = (row: ReceiptOrderRow): number => by === 'perfect' ? (row.perfect === false ? 0 : row.perfect === null ? 1 : 2)
    : by === 'ontime' ? (row.lateDays !== null && row.lateDays > 0 ? 0 : row.lateDays === null ? 1 : 2) : 0;
  const ordered = [...rows].sort((left, right) => weight(left) - weight(right) || (right.receivedOn ?? '').localeCompare(left.receivedOn ?? '') || right.id - left.id);
  return new Map(ordered.map((row, index) => [row.id, index]));
}

function receiptColumns(value: 'receipt' | 'onTime' | 'lead', withSupplier: boolean): DrillColumn[] {
  const role = (key: string): DrillColumn['phone'] => key === value ? 'value' : 'none';
  return [
    { key: 'name', label: 'Container', format: 'text', phone: 'title' },
    { key: 'supplier', label: 'Leverancier', format: 'text', phone: withSupplier ? 'sub' : 'none' },
    { key: 'received', label: 'Ontvangen', format: 'day', phone: 'sub' },
    { key: 'lead', label: 'Doorlooptijd', format: 'days', phone: role('lead') },
    { key: 'agreed', label: 'Levertijd', format: 'days', phone: 'none' },
    { key: 'receipt', label: 'Ontvangst', format: 'text', phone: role('receipt') },
    { key: 'onTime', label: 'Op tijd', format: 'text', phone: role('onTime') },
  ];
}

function receiptRows(rows: readonly ReceivedOrderRow[], rank: Map<number, number>): DrillRow[] {
  return rows.map((row) => ({
    key: `o${row.id}`, link: receiptLink(row),
    tone: row.perfect === false || (row.lateDays ?? 0) > 0 ? 'warn' as const : null,
    cells: { rank: rank.get(row.id) ?? 0, name: row.name, supplier: row.supplierName, received: row.receivedOn, lead: row.leadDays, agreed: row.agreedDays,
      receipt: receiptWords(row), onTime: onTimeWords(row) },
  }));
}

/**
 * Perfect ontvangen, Op tijd and Doorlooptijd: the received orders of the receipt period, ordered for the figure
 * clicked. The figure is the number of received orders; the summary says the figure in words.
 */
export function receiptsView(by: ReceiptFigure, rows: readonly ReceivedOrderRow[], performance: SupplierReceiptPerformance,
  lead: { averageDays: number | null; agreedDays: number | null }, scope: string): DrillView {
  const pct = (value: number | null) => value === null ? '' : ` · ${PCT.format(value)} %`;
  const summary = by === 'perfect' ? `${NL.format(performance.perfectOrders)} van ${NL.format(performance.comparableOrders)} perfect${pct(performance.perfectPct)}`
    : by === 'ontime' ? `${NL.format(performance.onTimeOrders)} van ${NL.format(performance.datedOrders)} op tijd · tegen de laatste ETA`
    : lead.averageDays === null ? 'nog geen doorlooptijd'
    : `gem. ${NL.format(lead.averageDays)} ${lead.averageDays === 1 ? 'dag' : 'dagen'}${lead.agreedDays === null ? '' : ` · afgesproken ${NL.format(lead.agreedDays)}`}`;
  const title = by === 'perfect' ? 'Perfect ontvangen' : by === 'ontime' ? 'Op tijd' : 'Doorlooptijd';
  return {
    id: `purchase.receipts.${by}`, title, scope, summary,
    rows: receiptRows(rows, receiptRank(rows, by)),
    columns: receiptColumns(by === 'perfect' ? 'receipt' : by === 'ontime' ? 'onTime' : 'lead', true),
    valueKey: null, total: { value: performance.receivedOrders, format: 'int', of: 'rows', label: 'Orders' },
    sort: by === 'lead' ? { key: 'lead', dir: 'desc' } : { key: 'rank', dir: 'asc' }, empty: 'Nog geen ontvangen orders in deze periode.',
  };
}

/** Scorekaart › a supplier (D-V1): its received orders; Leverancier openen searches the supplier list. */
export function supplierView(card: SupplierScorecard, rows: readonly ReceivedOrderRow[], scope: string, amount: (value: number) => string): DrillView {
  const own = rows.filter((row) => row.supplierId === card.supplierId);
  const perfect = card.perfectPct === null ? '' : ` · perfect ${NL.format(Math.round(card.perfectPct))} %`;
  return {
    id: `purchase.supplier.${card.supplierId}`, title: card.name, scope,
    summary: `${NL.format(card.orders)} ${card.orders === 1 ? 'order' : 'orders'} · externe kost ${amount(card.totalEur)}${perfect}`,
    rows: receiptRows(own, receiptRank(own, 'perfect')),
    columns: receiptColumns('receipt', false),
    valueKey: null, total: { value: card.orders, format: 'int', of: 'rows', label: 'Orders' },
    sort: { key: 'received', dir: 'desc' }, empty: 'Nog geen ontvangen orders in deze periode.',
    foot: { label: 'Leverancier openen ›', link: { path: ['/suppliers'], query: { q: card.name } } },
  };
}

/* ---------- Afwijkingen (§B.6): Inkoopimpact per product and per supplier */

/**
 * Inkoopimpact: the report's lines summed per product and per supplier, the most impact first; the figure is the
 * report's known impact (lines without a value count their pieces, not their value: the summary says how many).
 */
export function impactViews(rows: readonly ReceiptVarianceRow[], totals: Pick<ReceiptVarianceTotals, 'totalLossValueEur' | 'unvaluedLossPieces'>, scope: string,
  productName: (row: ReceiptVarianceRow) => string): DrillView[] {
  const per = <K extends string | number>(keyOf: (row: ReceiptVarianceRow) => K) => {
    const groups = new Map<K, { first: ReceiptVarianceRow; orders: Set<number>; missing: number; damaged: number; impact: number }>();
    for (const row of rows) {
      if (row.missingPieces + row.damagedPieces <= 0) continue;
      const key = keyOf(row);
      const group = groups.get(key) ?? { first: row, orders: new Set<number>(), missing: 0, damaged: 0, impact: 0 };
      group.orders.add(row.orderId);
      group.missing += row.missingPieces;
      group.damaged += row.damagedPieces;
      group.impact += row.totalLossValueEur ?? 0;
      groups.set(key, group);
    }
    return [...groups.entries()];
  };
  const summary = totals.unvaluedLossPieces > 0 ? `+ ${NL.format(totals.unvaluedLossPieces)} zonder waarde` : null;
  const total = { value: totals.totalLossValueEur, format: 'eur', of: 'sum' } as const;
  const counts: DrillColumn[] = [{ key: 'orders', label: 'Orders', format: 'int', phone: 'sub' }, { key: 'missing', label: 'Ontbreekt', format: 'int', phone: 'none' },
    { key: 'damaged', label: 'Beschadigd', format: 'int', phone: 'none' }, { key: 'impact', label: 'Impact', format: 'eur', phone: 'value' }];
  return [
    { id: 'purchase.impact', tab: 'Per product', title: 'Inkoopimpact', scope, summary,
      rows: per((row) => row.productId).map(([productId, group]) => ({
        key: `p${productId}`, link: { path: ['/products', productId] },
        cells: { product: productName(group.first), sku: group.first.productSku, orders: group.orders.size, missing: group.missing, damaged: group.damaged, impact: group.impact },
      })),
      columns: [{ key: 'product', label: 'Product', format: 'text', phone: 'title' }, { key: 'sku', label: 'SKU', format: 'text', phone: 'sub' }, ...counts],
      valueKey: 'impact', total, sort: { key: 'impact', dir: 'desc' }, empty: 'Geen tekorten of schade in deze selectie.' },
    { id: 'purchase.impact.supplier', tab: 'Per leverancier', title: 'Inkoopimpact', scope, summary,
      rows: per((row) => String(row.supplierId ?? 'none')).map(([supplierId, group]) => ({
        key: `s${supplierId}`,
        cells: { supplier: group.first.supplierName, orders: group.orders.size, missing: group.missing, damaged: group.damaged, impact: group.impact },
      })),
      columns: [{ key: 'supplier', label: 'Leverancier', format: 'text', phone: 'title' }, ...counts],
      valueKey: 'impact', total, sort: { key: 'impact', dir: 'desc' }, empty: 'Geen tekorten of schade in deze selectie.' },
  ];
}
