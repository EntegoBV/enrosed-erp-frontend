import { signal } from '@angular/core';
import type { Product, UnitName } from '../../core/api/models';

type ProductWithPackaging = Pick<Product, 'packaging'> | null | undefined;

/** The unit of every product that never chose one; blank or unknown keys read as this one too. */
export const DEFAULT_UNIT_KEY = 'stuk';

/** Today's wording, used until the server list has arrived (or when it cannot be loaded). */
const STUK: UnitName = { key: DEFAULT_UNIT_KEY, one: 'stuk', other: 'stuks', per: 'per stuk', short: 'st.' };

/**
 * The Dutch unit names of `GET /api/products/unit-names`, handed over by
 * CatalogApi.unitNames(). A signal on purpose: templates that printed "stuks"
 * before the list arrived render "bowls" as soon as it does.
 */
const knownUnits = signal<ReadonlyMap<string, UnitName>>(new Map());

export function rememberUnitNames(names: readonly UnitName[]): void {
  knownUnits.set(new Map(names.map((unit) => [unit.key, unit])));
}

/** Same cleaning as the server: trimmed and lower case; anything else is not a unit key. */
function cleanUnitKey(key: string | null | undefined): string {
  return key?.trim().toLowerCase() ?? '';
}

/** The names of one unit key; blank, unknown or not yet loaded reads as "stuk". */
export function unitName(key: string | null | undefined): UnitName {
  const units = knownUnits();
  return units.get(cleanUnitKey(key)) ?? units.get(DEFAULT_UNIT_KEY) ?? STUK;
}

/** "bowls" → "Bowls", for a unit word at the start of a label. */
export function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase('nl-BE') + text.slice(1);
}

/** "1 bowl", "1.200 bowls": a count with the matching Dutch noun. */
export function unitCount(unit: { singular: string; plural: string }, quantity: number): string {
  return `${quantity.toLocaleString('nl-BE')} ${quantity === 1 ? unit.singular : unit.plural}`;
}

/** Presentation only: never converts the price or quantity stored on a document. */
export function productSalesUnit(product: ProductWithPackaging) {
  const packaging = product?.packaging;
  const isDisplay = packaging?.kind === 'DISPLAY' && packaging.salesUnit === 'DISPLAY';
  const count = packaging?.kind === 'DISPLAY' ? packaging.piecesPerUnit : null;
  const piecesPerDisplay = count != null && Number.isSafeInteger(count) && count > 1 ? count : null;
  /* What one piece is called; with a display basis it names what the display holds. */
  const piece = unitName(packaging?.unitKey);
  const plural = isDisplay ? 'displays' : piece.other;
  return {
    isDisplay,
    hasSet: piecesPerDisplay !== null,
    piece,
    singular: isDisplay ? 'display' : piece.one,
    plural,
    /** The plural at the start of a label: "Bowls per karton". */
    pluralLabel: capitalize(plural),
    short: isDisplay ? 'display' : piece.short,
    priceLabel: isDisplay ? 'Displayprijs' : piece.key === DEFAULT_UNIT_KEY ? 'Stukprijs' : `Prijs per ${piece.one}`,
    setPriceLabel: 'Setprijs',
    piecesPerDisplay,
  };
}

/** The customer-facing price basis: a confirmed display/set is the primary figure. */
export function primarySalesPrice(product: ProductWithPackaging, unitPrice: number | null | undefined) {
  const unit = productSalesUnit(product);
  if (unitPrice == null || !Number.isFinite(unitPrice) || unitPrice <= 0) return null;
  if (!unit.piecesPerDisplay) return { price: unitPrice, label: unit.priceLabel, singular: unit.singular };
  return {
    price: unit.isDisplay ? unitPrice : unitPrice * unit.piecesPerDisplay,
    label: unit.setPriceLabel,
    singular: 'set',
  };
}

/** Equivalent at the same discount/tax basis as the supplied unit price. */
export function secondarySalesPrice(product: ProductWithPackaging, unitPrice: number | null | undefined) {
  const unit = productSalesUnit(product);
  if (!unit.piecesPerDisplay || unitPrice == null || !Number.isFinite(unitPrice) || unitPrice <= 0) return null;
  return {
    price: unit.isDisplay ? unitPrice / unit.piecesPerDisplay : unitPrice,
    label: unit.piece.per,
    piecesPerDisplay: unit.piecesPerDisplay,
    /** "8 bowls/display", the compact contents next to the equivalent. */
    perDisplay: `${unit.piecesPerDisplay.toLocaleString('nl-BE')} ${unit.piece.other}/display`,
  };
}

export function salesQuantityDetail(product: ProductWithPackaging, quantity: number): string | null {
  const unit = productSalesUnit(product);
  const per = unit.piecesPerDisplay;
  if (!per) return null;
  const pieces = unit.piece.other;
  const format = (value: number) => value.toLocaleString('nl-BE');
  if (!Number.isSafeInteger(quantity) || quantity <= 0) return `${format(per)} ${pieces} per display`;
  if (unit.isDisplay) {
    const total = quantity * per;
    return Number.isSafeInteger(total) ? `${format(quantity)} × ${format(per)} = ${format(total)} ${pieces}` : null;
  }
  if (quantity % per !== 0) return `${format(per)} ${pieces} per display`;
  const displays = quantity / per;
  return `${format(displays)} ${displays === 1 ? 'display' : 'displays'} van ${format(per)} ${pieces}`;
}

/**
 * The word after a summed quantity of several lines: the shared noun when every
 * product uses the same unit ("48 bowls"), "stuks" for a mix, and the neutral
 * "verkoopeenheden" as soon as displays and pieces could be added up together.
 */
export function salesQuantityLabel(products: readonly ProductWithPackaging[]): string {
  const units = products.map((product) => productSalesUnit(product));
  if (units.some((unit) => unit.isDisplay)) return 'verkoopeenheden';
  const keys = new Set(units.map((unit) => unit.piece.key));
  return keys.size === 1 ? units[0].plural : unitName(DEFAULT_UNIT_KEY).other;
}

/**
 * What a customer reads next to the price, as a one-line preview for the
 * product editor: "Klant leest: € 8,95 per stolp · 10 stolpen per doos".
 * Like the documents and the website, a product packed in displays leads with
 * the set price: "€ 31,60 per display (8 bowls) · € 3,95 per bowl · 40 bowls per doos".
 */
export function customerUnitPreview(
  product: ProductWithPackaging,
  unitPrice: number | null | undefined,
  perCarton: number | null | undefined,
): string {
  const unit = productSalesUnit(product);
  const money = (value: number) => new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' }).format(value);
  const parts: string[] = [];
  const priced = unitPrice != null && Number.isFinite(unitPrice) && unitPrice > 0;
  const pieces = unit.piecesPerDisplay;
  if (pieces) {
    const contents = `(${unitCount({ singular: unit.piece.one, plural: unit.piece.other }, pieces)})`;
    if (priced) {
      const setPrice = unit.isDisplay ? unitPrice : unitPrice * pieces;
      const piecePrice = unit.isDisplay ? unitPrice / pieces : unitPrice;
      /* Only a split set price is approximate: 31,60 over 8 bowls is exactly 3,95. */
      const approximate = unit.isDisplay && Math.round(piecePrice * 100) * pieces !== Math.round(setPrice * 100);
      parts.push(`${money(setPrice)} per display ${contents}`, `${approximate ? '≈ ' : ''}${money(piecePrice)} ${unit.piece.per}`);
    } else {
      parts.push(`prijs per display ${contents}`);
    }
  } else {
    parts.push(priced ? `${money(unitPrice)} per ${unit.singular}` : `prijs ${unit.isDisplay ? 'per display' : unit.piece.per}`);
  }
  if (perCarton != null && Number.isSafeInteger(perCarton) && perCarton > 0) parts.push(`${unitCount(unit, perCarton)} per doos`);
  return `Klant leest: ${parts.join(' · ')}`;
}
