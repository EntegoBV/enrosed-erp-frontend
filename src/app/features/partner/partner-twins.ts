import { searchText } from './partner-format';

/**
 * Products with the same name and colour ("Glass dome · Gemengd" twice: two sizes without a Maat in the
 * catalogue) look alike in every list of the portal. Where that happens the rows carry a quiet extra line
 * with the product's code (SKU), so the partner books the right one. Pure.
 */

export interface TwinProduct {
  productId: number;
  name: string;
  variant: string | null;
  sku?: string | null;
}

/** The set of shared name + colour keys; empty when every name is unique. */
export type Twins = ReadonlySet<string>;

export const NO_TWINS: Twins = new Set<string>();

function keyOf(product: Pick<TwinProduct, 'name' | 'variant'>): string {
  return `${searchText(product.name).trim()}|${searchText(product.variant ?? '').trim()}`;
}

/** The name + colour keys that more than one product carries. */
export function twinKeys(products: Iterable<TwinProduct>): Twins {
  const seen = new Map<string, number>();
  const twins = new Set<string>();
  for (const product of products) {
    const key = keyOf(product);
    const first = seen.get(key);
    if (first === undefined) seen.set(key, product.productId);
    else if (first !== product.productId) twins.add(key);
  }
  return twins;
}

/** "ENR-P08" for a product whose name and colour another product shares; null otherwise. */
export function twinLabel(product: TwinProduct, twins: Twins): string | null {
  if (!twins.size || !twins.has(keyOf(product))) return null;
  return product.sku?.trim() || `#${product.productId}`;
}

/** "Glass dome · Gemengd" with the code of a twin: "Glass dome · Gemengd · ENR-P08". */
export function twinTitle(product: TwinProduct, twins: Twins): string {
  const label = twinLabel(product, twins);
  return [product.name, product.variant, label].filter(Boolean).join(' · ');
}
