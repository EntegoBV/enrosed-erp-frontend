import type { LocalizedUnit, OrderStep } from '../../core/api/models';

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

/** A quote line or catalogue item with what the server rounds it to. */
export interface PortalOrderStep {
  piecesPerCarton: number;
  /** The product's "Verkocht per"; absent from older servers (full cartons). */
  orderStep?: OrderStep | null;
  /** What the server rounds this quotation's quantity to; 1 when it does not round. */
  unitsPerOrderStep?: number | null;
}

/** The multiple a proposal is rounded to: the server's step, full cartons from an older server. */
export function portalUnitsPerStep(item: PortalOrderStep | null | undefined): number {
  const step = item?.unitsPerOrderStep;
  if (step != null && Number.isSafeInteger(step) && step >= 1) return step;
  return Math.max(1, item?.piecesPerCarton || 1);
}

/** Up to the next whole step; zero stays zero. */
export function portalRoundToStep(quantity: number, step: number): number {
  const per = Math.max(1, step || 1);
  return quantity > 0 ? Math.ceil(quantity / per) * per : quantity;
}

/** Where an addition starts: ten cartons as always for a carton product, one step for one sold per display or unit. */
export function portalStartQuantity(item: PortalOrderStep): number {
  return item.orderStep === 'PACKAGE' || item.orderStep === 'UNIT'
    ? portalUnitsPerStep(item) : item.piecesPerCarton * 10;
}

/**
 * What one step holds, next to a rounding notice: "8 bowls per display" for a
 * display step, the carton contents otherwise. Existing text keys only.
 */
export function portalStepContents(
  item: PortalSalesUnit & PortalOrderStep,
  t: (key: string) => string,
  locale: string,
): string {
  const step = portalUnitsPerStep(item);
  if (item.orderStep !== 'PACKAGE' || step <= 1) return portalCartonContents(item, t, locale);
  const count = new Intl.NumberFormat(locale).format(step);
  return item.unit
    ? t('salesUnitsPerDisplay').replace('%s', `${count} ${portalUnitNoun(item.unit, step, locale)}`)
    : t('salesPiecesPerDisplay').replace('%s', count);
}
