import type { InventoryAttentionRow } from './analysis-metrics';
import type { DrillView } from './drill-model';

/*
 * The drill-downs of Voorraad and of the Overzicht rows that read the stock (design/analyses2/design.md §B.2, §B.5).
 * Pure and node-tested (tests/analyses-drill-stock.test.mts): type imports only.
 */

/** "Roos · Rood": the catalogue name with its colour. */
function productName(row: Pick<InventoryAttentionRow, 'name' | 'colour'>): string {
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
