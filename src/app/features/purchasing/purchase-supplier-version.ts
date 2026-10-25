/*
 * One product, several suppliers (2026-10-25): which version of a product a
 * purchase line carries, in words. The order line's snapshot (made when the
 * line was saved) wins over the product's offer of this order's supplier, so
 * a placed container keeps the version it was ordered as. Purchasing only:
 * the Versie and the supplier's reference never reach the website, quotes or
 * invoices. Pure and node-tested (tests/purchase-supplier-version.test.mts):
 * type-only imports.
 */
import type { Product, PurchaseOrderLine } from '../../core/api/models';

type VersionParts = { versionLabel?: string | null; supplierReference?: string | null };

const clean = (value: string | null | undefined): string | null => value?.trim() || null;

/** "Versie B · ref PB-1530", "Versie B", "ref PB-1530" or null. */
function versionText(parts: VersionParts | null | undefined): string | null {
  const label = clean(parts?.versionLabel);
  const reference = clean(parts?.supplierReference);
  const text = [label ? `Versie ${label}` : null, reference ? `ref ${reference}` : null].filter((part) => part !== null).join(' · ');
  return text || null;
}

/** "Versie B · ref PB-1530", "Versie B", "ref PB-1530" or null: the line's snapshot first, the product's offer second. */
export function lineVersionText(line: Pick<PurchaseOrderLine, 'supplierVersionLabel' | 'supplierReference'> | null | undefined,
                                product?: Pick<Product, 'offer'> | null): string | null {
  const snapshot = versionText({ versionLabel: line?.supplierVersionLabel, supplierReference: line?.supplierReference });
  return snapshot ?? versionText(product?.offer);
}

/** The desk picker pill: "Versie B" or null. */
export function offerChip(product: Pick<Product, 'offer'>): string | null {
  const label = clean(product.offer?.versionLabel);
  return label ? `Versie ${label}` : null;
}

/** Inactive offers stay in the list (lines keep their names) but are never offered in the picker. */
export function pickable(product: Pick<Product, 'offer'>): boolean {
  return product.offer?.active !== false;
}

/** Price note under the desk picker price: "EXW" or "geen prijs". */
export function offerPriceNote(product: Pick<Product, 'exwPrice'>): string {
  return product.exwPrice == null ? 'geen prijs' : 'EXW';
}
