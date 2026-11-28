import type { PartnerProductTile } from '../../core/api/partner-portal-api';
import { count } from './partner-format';
import { safeColour } from './partner-photo';
import { piecesPerSalesUnit, pieceUnit } from './partner-units';

/**
 * Products folded per family, pure: the name once, its colours beside it. The stock and a container used to list
 * every colour as a row of its own under a family head with the same name ("Glass Bowl - M" five times); here a
 * family is one row and each product in it a variant (its colour and size, or its own name where that differs
 * from the family's). A product without a family is a family of one. Categories keep Enrosed's order.
 */

export interface FamilyVariant<T> {
  item: T;
  /** "Kersenroze · 12x25"; the product's name too where it is not the family's ("Acrylic Roses · Red"). */
  label: string;
  colour: string | null;
  /** Pieces (the piece noun's count), for the chip's figure and the total. */
  pieces: number;
}

export interface Family<T> {
  key: string;
  /** The name its products share (once), else the family's name; a product's own name for a family of one. */
  title: string;
  categoryKey: string;
  categoryName: string;
  variants: FamilyVariant<T>[];
  /** Pieces of every variant together. */
  pieces: number;
  /** "rozen", or "stuks" when the variants count different things. */
  noun: string;
  /** "rozen" for one, used with 1. */
  nounOne: string;
}

export interface FamilyCategory<T> {
  key: string;
  name: string;
  families: Family<T>[];
  /** How many products (variants) in it. */
  products: number;
}

/** The same words, whatever their case, spaces, dashes or × against x. */
export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const normal = (value: string | null | undefined) => (value ?? '').toLowerCase().replace(/×/g, 'x').replace(/[^\p{L}\p{N}]+/gu, '');
  return normal(a) !== '' && normal(a) === normal(b);
}

/**
 * Folds the products (in the order given: category, then catalogue order) into categories and families.
 * `quantityOf` gives a product's sales units (stock, or what a container carries).
 */
export function foldFamilies<T extends PartnerProductTile>(items: readonly T[], quantityOf: (item: T) => number): FamilyCategory<T>[] {
  const categories: FamilyCategory<T>[] = [];
  const categoryByKey = new Map<string, FamilyCategory<T>>();
  const familyByKey = new Map<string, Family<T>>();
  for (const item of items) {
    const categoryKey = item.categoryId != null ? `c${item.categoryId}` : 'x';
    let category = categoryByKey.get(categoryKey);
    if (!category) {
      category = { key: categoryKey, name: item.categoryName?.trim() || 'Zonder categorie', families: [], products: 0 };
      categoryByKey.set(categoryKey, category);
      categories.push(category);
    }
    const familyKey = item.familyId != null ? `${categoryKey}|f${item.familyId}` : `${categoryKey}|p${item.productId}`;
    let family = familyByKey.get(familyKey);
    if (!family) {
      const title = item.familyId != null ? item.familyName?.trim() || item.name : item.name;
      family = { key: familyKey, title, categoryKey, categoryName: category.name, variants: [], pieces: 0, noun: '', nounOne: '' };
      familyByKey.set(familyKey, family);
      category.families.push(family);
    }
    const pieces = Math.max(0, quantityOf(item)) * piecesPerSalesUnit(item);
    const ownName = sameName(item.name, family.title) ? null : item.name;
    const label = [ownName, item.variant].filter(Boolean).join(' · ') || item.name;
    family.variants.push({ item, label, colour: safeColour(item.colourHex), pieces });
    family.pieces += pieces;
    category.products++;
  }
  for (const category of categories) {
    for (const family of category.families) {
      /* Every product of the family under one name (often not the family's own: "Glass Bowl - M" in "Bowl Rozen M -
         Display"): that name is the row's title, once, and each variant reads as its colour and size. */
      const first = family.variants[0].item;
      if (family.variants.every((variant) => sameName(variant.item.name, first.name) || variant.item.name === first.name)) {
        family.title = first.name;
        for (const variant of family.variants) variant.label = variant.item.variant || variant.item.name;
      }
      const nouns = new Set(family.variants.map((variant) => pieceUnit(variant.item).other));
      const piece = pieceUnit(first);
      family.noun = nouns.size === 1 ? piece.other : 'stuks';
      family.nounOne = nouns.size === 1 ? piece.one : 'stuk';
    }
  }
  return categories;
}

/** "23.376 rozen", "1 roos". */
export function familyTotal(family: Pick<Family<unknown>, 'pieces' | 'noun' | 'nounOne'>): string {
  return `${count(family.pieces)} ${family.pieces === 1 ? family.nounOne : family.noun}`;
}
