import type { PurchaseOrderView } from '../../core/api/models';
import type { InventoryAttentionRow, InventoryCapitalMetric, InventoryGapRows, InventoryProductRow, ReorderRow } from './analysis-metrics';
import type { DrillColumn, DrillRow, DrillView } from './drill-model';

/*
 * The drill-downs of Voorraad and of the Overzicht rows that read the stock (design/analyses2/design.md §B.2, §B.5).
 * Pure and node-tested (tests/analyses-drill-stock.test.mts): type imports only.
 */

/** "Roos · Rood": the catalogue name with its colour. */
function productName(row: { name: string; colour: string | null }): string {
  return row.colour ? `${row.name} · ${row.colour}` : row.name;
}

/**
 * Aandacht › Producten zonder voorraad én inkoop: the active products on zero with nothing ordered, the most recently
 * sold first (never sold last). The figure is their count (zeroStock.withoutIncomingCount).
 */
export function zeroNoIncomingView(rows: readonly InventoryAttentionRow[], lastSold: ReadonlyMap<number, string>, figure: number): DrillView {
  return {
    id: 'stock.zeroNoIncoming', title: 'Zonder voorraad én inkoop', scope: 'Vandaag · actief, niets besteld',
    rows: rows.filter((row) => row.expectedPieces <= 0).map((row) => ({
      key: `p${row.productId}`, link: { path: ['/products', row.productId] },
      cells: { product: productName(row), sku: row.sku, lastSold: lastSold.get(row.productId) ?? null },
    })),
    columns: [{ key: 'product', label: 'Product', format: 'text', phone: 'title' }, { key: 'sku', label: 'SKU', format: 'text', phone: 'sub' },
      { key: 'lastSold', label: 'Laatst verkocht', format: 'day', phone: 'value' }],
    valueKey: null, total: { value: figure, format: 'int', of: 'rows', label: 'Producten' }, sort: { key: 'lastSold', dir: 'desc' },
    empty: 'Elk actief product heeft voorraad of inkoop onderweg.', foot: { label: 'Voorraad ›', link: { path: ['/analyses', 'inventory'] } },
  };
}

/** "7.200 stuks", "1.500 displays": the page's count in a product's own sales unit (a runtime helper, passed in). */
export type UnitText = (productId: number, count: number) => string;

const PRODUCT: DrillColumn = { key: 'product', label: 'Product', format: 'text', phone: 'title' };
const SKU: DrillColumn = { key: 'sku', label: 'SKU', format: 'text', phone: 'sub' };
const productLink = (productId: number | null) => productId !== null ? { path: ['/products', productId] } : null;

export interface StockValueFigure {
  costValueEur: number;
  salesValueEur: number;
  /** Verkoopwaarde minus the cost of the same stock; null while a saleable product has no cost. */
  upliftEur: number | null;
}

/**
 * Kostwaarde and Verkoopwaarde (and Grootste voorraadposities "Alle ›"): every valued product, then the known stock
 * without a cost as its own group. The Kostwaarde column adds up to Kostwaarde, the Verkoopwaarde column to
 * Verkoopwaarde (inactive and demo products have none).
 */
export function stockValueView(capital: readonly InventoryCapitalMetric[], unvalued: readonly InventoryProductRow[], figure: StockValueFigure,
  by: 'cost' | 'sales', unitText: UnitText, amount: (value: number) => string): DrillView {
  const rows: DrillRow[] = [
    ...capital.map((row) => ({ key: `p${row.productId}`, link: productLink(row.productId),
      cells: { product: productName(row), sku: row.sku, units: unitText(row.productId, row.stockPieces), unitCost: row.landedUnitCostEur,
        sales: row.salesValueEur, share: row.sharePct, cost: row.costValueEur } })),
    ...unvalued.map((row, index) => ({ key: `u${row.productId ?? `i${index}`}`, group: 'unvalued', link: productLink(row.productId),
      cells: { product: productName(row), sku: row.sku, units: row.productId !== null ? unitText(row.productId, row.stockPieces) : String(row.stockPieces),
        unitCost: null, sales: row.salesValueEur, share: null, cost: null } })),
  ];
  return {
    id: 'stock.cost', title: by === 'cost' ? 'Kostwaarde' : 'Verkoopwaarde', scope: 'Vandaag · excl. btw · over alle locaties',
    summary: figure.upliftEur === null ? 'kostdekking onvolledig' : `marge op voorraad ${amount(figure.upliftEur)}`,
    rows, groups: unvalued.length ? [{ key: 'unvalued', label: 'Zonder kostprijs' }] : [],
    columns: [PRODUCT, SKU, { key: 'units', label: 'Voorraad', format: 'text', phone: 'sub' }, { key: 'unitCost', label: 'Kost/eenheid', format: 'eur2', phone: 'none' },
      { key: 'sales', label: 'Verkoopwaarde', format: 'eur', phone: 'none', sum: true }, { key: 'share', label: 'Aandeel', format: 'pct', phone: 'none', width: '84px' },
      { key: 'cost', label: 'Kostwaarde', format: 'eur', phone: 'value' }],
    valueKey: 'cost', total: { value: figure.costValueEur, format: 'eur', of: 'sum', label: 'Kostwaarde' },
    sort: { key: by, dir: 'desc' }, empty: 'Nog geen voorraad met een kostprijs.',
    foot: { label: 'Jaarinventaris ›', link: { path: ['/stock', 'inventaris'] } },
  };
}

/**
 * Onderweg: the ordered and sailing containers with their external cost, the first ETA first (without one last).
 * The cost and the names come in as functions (purchaseExternalCost and containerName are runtime helpers).
 */
export function incomingView(orders: readonly PurchaseOrderView[], figure: number, names: { container: (view: PurchaseOrderView) => string;
  supplier: (id: number) => string; cost: (view: PurchaseOrderView) => number }, summary: string | null): DrillView {
  return {
    id: 'stock.incoming', title: 'Onderweg', scope: 'Vandaag · besteld en onderweg · externe kost', summary,
    rows: orders.map((view) => ({
      key: `o${view.order.id}`, link: { path: ['/purchasing', view.order.id] },
      cells: { name: names.container(view), supplier: names.supplier(view.order.supplierId), status: view.order.status === 'ONDERWEG' ? 'Onderweg' : 'Besteld',
        /* A text cell sorts after every day, so "zonder ETA" comes last on the way up. */
        eta: view.order.expectedArrival || 'zonder ETA', products: new Set(view.order.lines.map((line) => line.productId)).size, cost: names.cost(view) },
    })),
    columns: [{ key: 'name', label: 'Container', format: 'text', phone: 'title' }, { key: 'supplier', label: 'Leverancier', format: 'text', phone: 'sub' },
      { key: 'status', label: 'Status', format: 'text', phone: 'sub' }, { key: 'eta', label: 'ETA', format: 'day', phone: 'sub' },
      { key: 'products', label: 'Producten', format: 'int', phone: 'none' }, { key: 'cost', label: 'Externe kost', format: 'eur', phone: 'value' }],
    valueKey: 'cost', total: { value: figure, format: 'eur', of: 'sum' }, sort: { key: 'eta', dir: 'asc' },
    empty: 'Niets onderweg: geen bestelde of vertrokken containers.',
  };
}

/** today + n days, as an ISO day. */
function addDays(day: string, days: number): string {
  const date = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)) + days));
  return date.toISOString().slice(0, 10);
}

/** "Bestel vóór": the day the shelf runs dry minus the supplier's lead time; null without a lead time. */
export function orderByDay(today: string, weeksLeft: number | null, leadTimeDays: number | null): string | null {
  if (weeksLeft === null || !leadTimeDays || leadTimeDays <= 0) return null;
  return addDays(today, Math.floor(weeksLeft * 7) - leadTimeDays);
}

/**
 * Raakt op: every product that runs out within the horizon on the pace of the last invoices, the latest order day
 * first (without a lead time last). The figure is reorder.count.
 */
export function reorderView(rows: readonly ReorderRow[], figure: number, today: string, supplierOf: (id: number | null) => { name: string; leadTimeDays: number } | null,
  unitText: UnitText, days: number): DrillView {
  return {
    id: 'stock.reorder', title: 'Raakt op', scope: 'Vandaag · binnen 8 weken op, met wat onderweg is',
    summary: `tempo over ${days} dagen, zonder TICA`,
    rows: rows.map((row) => {
      const supplier = supplierOf(row.supplierId);
      const lead = supplier && supplier.leadTimeDays > 0 ? supplier.leadTimeDays : null;
      const orderBy = orderByDay(today, row.weeksLeft, lead);
      return {
        key: `p${row.productId}`, link: productLink(row.productId), tone: orderBy !== null && orderBy <= today ? 'danger' as const : null,
        cells: { product: productName(row), supplier: supplier?.name ?? null, units: unitText(row.productId, row.stockPieces),
          incoming: row.expectedPieces > 0 ? unitText(row.productId, row.expectedPieces) : null, eta: row.expectedPieces > 0 ? row.nextArrival : null,
          weekly: row.weeklyPieces, lead, orderBy },
      };
    }),
    columns: [PRODUCT, { key: 'supplier', label: 'Leverancier', format: 'text', phone: 'sub' }, { key: 'units', label: 'Voorraad', format: 'text', phone: 'sub' },
      { key: 'incoming', label: 'Onderweg', format: 'text', phone: 'none' }, { key: 'eta', label: 'ETA', format: 'day', phone: 'none' },
      { key: 'weekly', label: 'Per week', format: 'int', phone: 'none' }, { key: 'lead', label: 'Levertijd', format: 'days', phone: 'none' },
      { key: 'orderBy', label: 'Bestel vóór', format: 'day', phone: 'value' }],
    valueKey: null, total: { value: figure, format: 'int', of: 'rows', label: 'Producten' }, sort: { key: 'orderBy', dir: 'asc' },
    empty: 'Niets raakt binnen 8 weken op, of er werd nog niets gefactureerd.',
  };
}

export type QualityKey = 'unknown' | 'unvalued' | 'missingCarton' | 'negative';
const QUALITY: readonly { key: QualityKey; tab: string; empty: string }[] = [
  { key: 'unknown', tab: 'Onbekend', empty: 'Elk actief product heeft een voorraadstand.' },
  { key: 'unvalued', tab: 'Zonder kostprijs', empty: 'Alle voorraad heeft een kostprijs.' },
  { key: 'missingCarton', tab: 'Zonder omdoos', empty: 'Elk actief product heeft een omdoos.' },
  { key: 'negative', tab: 'Negatief', empty: 'Geen negatieve voorraad.' },
];
export const QUALITY_KEYS: readonly QualityKey[] = QUALITY.map((item) => item.key);

/** Datakwaliteit: one segment per count, the products it counts by name; each count is its list's length (dataGaps). */
export function qualityViews(gaps: InventoryGapRows, counts: Readonly<Record<QualityKey, number>>, unitText: UnitText): DrillView[] {
  return QUALITY.map((item) => ({
    id: `stock.quality.${item.key}`, tab: item.tab, title: 'Datakwaliteit', scope: 'Vandaag · uit de productkaart',
    rows: gaps[item.key].map((row, index) => ({
      key: `p${row.productId ?? `i${index}`}`, link: productLink(row.productId),
      cells: { product: productName(row), sku: row.sku,
        units: !row.inventoryKnown ? 'onbekend' : row.productId !== null ? unitText(row.productId, row.stockPieces) : String(row.stockPieces) },
    })),
    columns: [PRODUCT, SKU, { key: 'units', label: 'Voorraad', format: 'text', phone: 'value' }],
    valueKey: null, total: { value: counts[item.key], format: 'int', of: 'rows', label: 'Producten' }, sort: { key: 'product', dir: 'asc' },
    empty: item.empty,
  }));
}
