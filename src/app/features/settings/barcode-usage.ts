/*
 * EAN-codes "In gebruik": every code that sits on a product, from the
 * products themselves (piece, display or gift box, outer carton), so the
 * page can show what the free list no longer holds. Frontend only.
 * Pure and import-free (type imports only): node-tested.
 */
import type { Product } from '../../core/api/models';

export type BarcodeKind = 'Stuk' | 'Display' | 'Geschenkdoosje' | 'Omdoos';

export interface BarcodeInUse {
  code: string;
  kind: BarcodeKind;
  productId: number;
  name: string;
  /** "{kleur} · {SKU}", or the SKU alone. */
  detail: string;
  active: boolean;
}

type BarcodeProduct = Pick<Product, 'id' | 'name' | 'sku' | 'colour' | 'active' | 'barcodeInner' | 'barcodeOuter'>
  & { packaging: Pick<Product['packaging'], 'kind' | 'barcode'> };

/** Every code on a product, one row per code and place, sorted by code (then by kind). */
export function barcodesInUse(products: readonly BarcodeProduct[]): BarcodeInUse[] {
  const rows: BarcodeInUse[] = [];
  for (const product of products) {
    if (product.id === null) continue;
    const detail = [product.colour?.trim(), product.sku?.trim()].filter(Boolean).join(' · ');
    const add = (code: string | null | undefined, kind: BarcodeKind) => {
      const clean = (code ?? '').trim();
      if (clean) rows.push({ code: clean, kind, productId: product.id!, name: product.name, detail, active: product.active });
    };
    add(product.barcodeInner, 'Stuk');
    if (product.packaging.kind !== 'NONE') add(product.packaging.barcode, product.packaging.kind === 'DISPLAY' ? 'Display' : 'Geschenkdoosje');
    add(product.barcodeOuter, 'Omdoos');
  }
  const order: BarcodeKind[] = ['Stuk', 'Display', 'Geschenkdoosje', 'Omdoos'];
  return rows.sort((a, b) => a.code.localeCompare(b.code) || order.indexOf(a.kind) - order.indexOf(b.kind) || a.productId - b.productId);
}

/** The search on the In gebruik view: code, product name, colour, SKU. */
export function matchesBarcode(row: BarcodeInUse, needle: string): boolean {
  const text = needle.trim().toLowerCase();
  return !text || `${row.code} ${row.name} ${row.detail} ${row.kind}`.toLowerCase().includes(text);
}
