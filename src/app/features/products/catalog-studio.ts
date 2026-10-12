import type { PhotoDto, Product, ProductFamily } from '../../core/api/models';

/** Use the same explicit catalogue lead as the PDF, preserving original media. */
export function cataloguePhoto(product: Pick<Product, 'photos'>): PhotoDto | null {
  return product.photos.find((photo) => photo.leadFor?.includes('CATALOGUE'))
    ?? product.photos[0] ?? null;
}

export function catalogueFamilyKey(product: Pick<Product, 'id' | 'familyId'>): string {
  return product.familyId === null ? `product:${product.id}` : `family:${product.familyId}`;
}

export interface CatalogueFamilySelection {
  key: string;
  name: string;
  products: Product[];
  photo: Pick<PhotoDto, 'url' | 'smallUrl' | 'leadFor'> | null;
}

/** Keep catalogue order; unlinked products each remain an independent group. */
export function catalogueFamilies(
  products: readonly Product[],
  families: readonly Pick<ProductFamily, 'id' | 'name' | 'catalogueOverviewPhotoId' | 'cataloguePhotoOptions'>[],
): CatalogueFamilySelection[] {
  const names = new Map(families.map((family) => [family.id, family.name]));
  const groups = new Map<string, CatalogueFamilySelection>();
  for (const product of products) {
    if (product.id === null) continue;
    const key = catalogueFamilyKey(product);
    const existing = groups.get(key);
    if (existing) {
      existing.products.push(product);
      const candidate = cataloguePhoto(product);
      if (!existing.photo || (!existing.photo.leadFor?.includes('CATALOGUE')
          && candidate?.leadFor?.includes('CATALOGUE'))) existing.photo = candidate;
    } else {
      groups.set(key, {
        key,
        name: names.get(product.familyId) || product.name,
        products: [product],
        photo: cataloguePhoto(product),
      });
    }
  }
  for (const group of groups.values()) {
    const family = families.find(row => row.id !== null && row.id === group.products[0]?.familyId);
    const selected = family?.cataloguePhotoOptions?.find(photo => photo.id === family.catalogueOverviewPhotoId);
    if (selected) group.photo = { url: selected.largeUrl, smallUrl: selected.smallUrl, leadFor: ['CATALOGUE'] };
  }
  return [...groups.values()];
}

/* ------------------------------------------------------- catalogue photo link */

/** The link on every colour row of the studio; the words of the photo section. */
export const CATALOGUE_PHOTO_LINK_LABEL = 'Catalogusfoto wijzigen';

/** The query of that link: the photo section, with the catalogue picker asked for. One object, so a template can bind it. */
export const CATALOGUE_PHOTO_LINK_QUERY: Readonly<{ tab: 'media'; kies: 'catalogus' }> = { tab: 'media', kies: 'catalogus' };

/**
 * Where "Catalogusfoto wijzigen" leads: the photo section of that colour in
 * the product editor, with the catalogue picker open (`?tab=media&kies=catalogus`).
 * The editor drops `kies` once the picker is open, and ignores it for a
 * product without a saved series or a colour whose card has nothing to change.
 */
export function cataloguePhotoLink(productId: number): {
  commands: [string, number, string];
  queryParams: Readonly<{ tab: 'media'; kies: 'catalogus' }>;
} {
  return { commands: ['/products', productId, 'edit'], queryParams: CATALOGUE_PHOTO_LINK_QUERY };
}

/* -------------------------------------------------- what the studio remembers */

/**
 * The open cards of "Assortiment aanpassen", kept for this browser tab so the
 * back button returns to the series the owner was working on.
 */
export interface CatalogueStudioView {
  /** "Assortiment aanpassen" is unfolded. */
  editorOpen: boolean;
  /** Keys of the expanded series cards (`catalogueFamilyKey`). */
  expanded: string[];
  /** The colour row the owner left through "Catalogusfoto wijzigen"; brought back into view once. */
  returnProductId: number | null;
}

export const CATALOGUE_STUDIO_VIEW_KEY = 'erp.catalog-studio.open-cards';

/** More open cards than anyone unfolds by hand: a stored list beyond this is cut, never trusted blindly. */
const MAX_REMEMBERED_CARDS = 200;

export function serializeStudioView(view: CatalogueStudioView): string {
  return JSON.stringify({
    editorOpen: view.editorOpen,
    expanded: view.expanded.slice(0, MAX_REMEMBERED_CARDS),
    returnProductId: view.returnProductId,
  });
}

/** Reads what `serializeStudioView` wrote; anything else (nothing, old or damaged data) gives the closed start. */
export function parseStudioView(raw: string | null | undefined): CatalogueStudioView {
  const closed: CatalogueStudioView = { editorOpen: false, expanded: [], returnProductId: null };
  if (!raw) return closed;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return closed; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return closed;
  const stored = parsed as Record<string, unknown>;
  const expanded = Array.isArray(stored['expanded'])
    ? [...new Set(stored['expanded'].filter((key): key is string => typeof key === 'string' && /^(family|product):\d+$/.test(key)))]
      .slice(0, MAX_REMEMBERED_CARDS)
    : [];
  const returnTo = stored['returnProductId'];
  return {
    editorOpen: stored['editorOpen'] === true,
    expanded,
    returnProductId: typeof returnTo === 'number' && Number.isSafeInteger(returnTo) && returnTo > 0 ? returnTo : null,
  };
}
