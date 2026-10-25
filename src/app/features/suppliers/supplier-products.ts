/*
 * Leveranciers › Producten (one product, several suppliers, 2026-10-25): the
 * products a supplier makes, from GET /api/suppliers/{id}/products, as the
 * desk table and the phone section read them. Pure and node-tested: type-only
 * imports.
 */
import type { SupplierProductRow } from '../../core/api/product-supplier-models';

/** Trimmed text, '' as null. */
function textOrNull(value: string | null | undefined): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text : null;
}

/** Active rows first; within each group the server's order (active rows, then the product overview order) stays. */
export function sortSupplierProducts(rows: readonly SupplierProductRow[]): SupplierProductRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => Number(b.row.active) - Number(a.row.active) || a.index - b.index)
    .map(({ row }) => row);
}

/** "{name}", then " · {colour}" and " · {Maat}" when present. */
export function supplierProductTitle(row: SupplierProductRow): string {
  return [row.name, row.colour, row.variantSize].map(textOrNull).filter((part): part is string => part !== null).join(' · ');
}

/** "Versie B · ref PB-1530 · laatst PO-2026-005"; without an order the last part reads "nog niet besteld". */
export function supplierProductSub(row: SupplierProductRow): string {
  const parts: string[] = [];
  const label = textOrNull(row.versionLabel);
  const reference = textOrNull(row.supplierReference);
  const order = textOrNull(row.lastOrder?.number);
  if (label) parts.push(`Versie ${label}`);
  if (reference) parts.push(`ref ${reference}`);
  parts.push(order ? `laatst ${order}` : 'nog niet besteld');
  return parts.join(' · ');
}

/** Rows this supplier still offers (active) and rows kept for history (inactive). */
export function supplierProductCount(rows: readonly SupplierProductRow[]): { active: number; inactive: number } {
  const active = rows.filter((row) => row.active).length;
  return { active, inactive: rows.length - active };
}
