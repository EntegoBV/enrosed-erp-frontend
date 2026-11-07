import type { Category, Product } from '../../core/api/models';

/** Add valid product IDs without mutating the current selection. */
export function selectProductIds(
  current: ReadonlySet<number>,
  productIds: Iterable<number | null | undefined>,
): Set<number> {
  const next = new Set(current);
  for (const id of productIds) {
    if (id !== null && id !== undefined) next.add(id);
  }
  return next;
}

/** Remove valid product IDs without mutating the current selection. */
export function deselectProductIds(
  current: ReadonlySet<number>,
  productIds: Iterable<number | null | undefined>,
): Set<number> {
  const next = new Set(current);
  for (const id of productIds) {
    if (id !== null && id !== undefined) next.delete(id);
  }
  return next;
}

export interface CatalogSelectionGroup<T> {
  key: string;
  categoryId: number | null;
  name: string;
  products: T[];
}

/**
 * Products in the order the categories are listed, uncategorised ones last,
 * so the chooser reads like the catalogue that will come out of it.
 */
export function groupProductsByCategory<T extends { categoryId: number | null }>(
  products: readonly T[],
  categories: readonly { id: number | null; name: string }[],
): CatalogSelectionGroup<T>[] {
  const groups = new Map<string, CatalogSelectionGroup<T>>();
  for (const category of categories) {
    if (category.id === null) continue;
    groups.set(`category:${category.id}`, { key: `category:${category.id}`, categoryId: category.id, name: category.name, products: [] });
  }
  const loose: CatalogSelectionGroup<T> = { key: 'category:none', categoryId: null, name: 'Zonder categorie', products: [] };
  for (const product of products) {
    const group = product.categoryId === null ? loose : groups.get(`category:${product.categoryId}`);
    if (group) group.products.push(product);
    else loose.products.push(product);
  }
  const ordered = [...groups.values()].filter((group) => group.products.length > 0);
  if (loose.products.length) ordered.push(loose);
  return ordered;
}

/**
 * A shift-click covers every row between the last toggled row and this one,
 * inclusive, and gives them all the state of the row that was clicked last.
 */
export function productIdsBetween(
  orderedIds: readonly (number | null)[],
  fromIndex: number,
  toIndex: number,
): number[] {
  if (!orderedIds.length) return [];
  const clamp = (index: number) => Math.min(orderedIds.length - 1, Math.max(0, index));
  const start = Math.min(clamp(fromIndex), clamp(toIndex));
  const end = Math.max(clamp(fromIndex), clamp(toIndex));
  return orderedIds.slice(start, end + 1).filter((id): id is number => id !== null);
}


/* ------------------------------------------------------------------ search */

/**
 * A search key: no case, no accents, and a size written 12x25, 12*25, 12×25
 * or 12 x 25 the same (Emre types 12x25, the names say 12*25); "15 x 30 cm"
 * and "15x30cm" too. Only digits are joined: "box" and "XL" stay as they are.
 */
export function catalogSearchKey(text: string): string {
  return text.toLocaleLowerCase('nl-BE').normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/(\d)\s*[x×*]\s*(?=\d)/g, '$1x')
    .replace(/(\d)\s+(?=(?:cm|mm)\b)/g, '$1');
}

/** The words of a search; a size being typed ("12*", "12 ×") already reads as "12x", so the list does not empty halfway. */
export function catalogSearchWords(query: string): string[] {
  const key = catalogSearchKey(query).replace(/(\d)\s*[x×*]\s*$/, '$1x').trim();
  return key ? key.split(/\s+/) : [];
}

/** What a category is found by: its name, its language-neutral code ("domes") and its translated names ("Stolpen", "Domes"). */
export function catalogCategorySearchName(category: Category): string {
  return [category.name, category.code, ...(category.texts ?? []).map((text) => text.name)].filter(Boolean).join(' ');
}

/** What a product is found by: its own, its family's and its Dutch catalogue name, Maat, colour, category, SKU and barcodes. */
export function catalogSearchText(product: Product, familyName?: string | null, categoryName?: string | null): string {
  const dutch = product.texts?.find((text) => text.language === 'NL');
  return catalogSearchKey([
    product.name, familyName, dutch?.name, dutch?.colour, product.variantSize, product.colour, categoryName,
    product.sku, product.canonicalBarcode, product.barcodeInner, product.barcodeOuter,
  ].filter(Boolean).join(' '));
}

/**
 * Every word somewhere in the text, in any order. A size never matches inside
 * a larger number ("2x25" does not find "12x25"). A word of four letters or
 * more that ends in s also finds its singular, but only as a word of its own:
 * "domes" finds "dome" and "boxes" "box", while the Dutch "roos" never finds
 * "rood" and "doos" never "odoo".
 */
export function catalogSearchMatch(text: string, words: readonly string[]): boolean {
  return words.every((word) => hasWord(text, word)
    || (word.length >= 4 && word.endsWith('s') && (hasWholeWord(text, word.slice(0, -1))
      || (word.endsWith('es') && hasWholeWord(text, word.slice(0, -2))))));
}

function hasWholeWord(text: string, word: string): boolean {
  const inWord = /[\p{L}\p{N}]/u;
  for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1)) {
    if (!inWord.test(text[at - 1] ?? ' ') && !inWord.test(text[at + word.length] ?? ' ')) return true;
  }
  return false;
}

function hasWord(text: string, word: string): boolean {
  if (!/^\d+x\d/.test(word)) return text.includes(word);
  for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1)) {
    if (at === 0 || !/\d/.test(text[at - 1])) return true;
  }
  return false;
}
