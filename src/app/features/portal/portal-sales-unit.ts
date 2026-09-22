import type { LocalizedUnit } from '../../core/api/models';

/** The server's names for a product's unit in the portal language (UnitDto). */
export type PortalUnit = LocalizedUnit;

export interface PortalSalesUnit {
  salesUnit?: 'PIECE' | 'DISPLAY' | null;
  piecesPerDisplay?: number | null;
  /** Absent from older servers; the generic "stuks" keys stay the fallback. */
  unit?: PortalUnit | null;
}

export function portalQuantityUnitKey(item: PortalSalesUnit): string {
  return item.salesUnit === 'DISPLAY' ? 'salesDisplayUnits' : 'portalPieces';
}

export function portalPriceUnitKey(item: PortalSalesUnit): string {
  return portalDisplayPieces(item) ? 'salesPricePerDisplay' : item.salesUnit === 'DISPLAY' ? 'salesPricePerDisplay' : 'portalPerPiece';
}

export function portalDisplayPieces(item: PortalSalesUnit): number | null {
  const count = item.piecesPerDisplay;
  return count != null && Number.isSafeInteger(count) && count > 1 ? count : null;
}

/**
 * The piece noun that belongs after a count, with the language's own plural
 * rules ("1 bowl", "2 miseczki", "5 miseczek"); without a count the plain plural.
 */
export function portalUnitNoun(unit: PortalUnit, count: number | null, locale: string): string {
  if (count == null || !Number.isFinite(count)) return unit.other;
  const form = new Intl.PluralRules(locale).select(count);
  return form === 'one' || form === 'few' || form === 'many' ? unit[form] || unit.other : unit.other;
}

/**
 * The word after a quantity of this line, when the server named the unit:
 * "bowls" for a piece basis. Null means "use the translated key" - displays
 * keep their display wording, and older servers send no unit.
 */
export function portalQuantityUnit(item: PortalSalesUnit, count: number | null, locale: string): string | null {
  return item.unit && item.salesUnit !== 'DISPLAY' ? portalUnitNoun(item.unit, count, locale) : null;
}

export function portalPrimaryPrice(item: PortalSalesUnit & { unitPrice: number | null }) {
  const pieces = portalDisplayPieces(item);
  if (item.unitPrice == null || !Number.isFinite(item.unitPrice) || item.unitPrice <= 0) return null;
  const perPiece = !pieces && item.salesUnit !== 'DISPLAY';
  return {
    price: pieces && item.salesUnit !== 'DISPLAY' ? item.unitPrice * pieces : item.unitPrice,
    labelKey: pieces ? 'salesPricePerDisplay' : portalPriceUnitKey(item),
    /** "per bowl" from the server; wins over the key when present. */
    label: perPiece && item.unit ? item.unit.per : null,
  };
}

/** Raw quote price is unchanged; this is only a display equivalent. */
export function portalSecondaryPrice(item: PortalSalesUnit & { unitPrice: number | null }) {
  const pieces = portalDisplayPieces(item);
  if (!pieces || item.unitPrice == null || !Number.isFinite(item.unitPrice) || item.unitPrice <= 0) return null;
  const price = item.salesUnit === 'DISPLAY' ? item.unitPrice / pieces : item.unitPrice;
  return {
    price,
    labelKey: 'portalPerPiece',
    label: item.unit ? item.unit.per : null,
    /* Shown with two decimals, like every other amount in the portal. */
    approximate: Math.abs(price - Math.round(price * 100) / 100) > 1e-9,
  };
}

/**
 * What one carton holds: "16 bowls per doos" with a named unit, otherwise
 * today's "16 per doos". Displays keep the bare count; their noun is a key.
 */
export function portalCartonContents(
  item: PortalSalesUnit & { piecesPerCarton: number },
  t: (key: string) => string,
  locale: string,
): string {
  const count = new Intl.NumberFormat(locale).format(item.piecesPerCarton);
  const noun = portalQuantityUnit(item, item.piecesPerCarton, locale);
  return noun ? t('unitsPerCarton').replace('%s', `${count} ${noun}`) : `${count} ${t('portalPerBox')}`;
}
