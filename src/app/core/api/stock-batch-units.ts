/**
 * Stock batches (2026-10-25): unit words and euro text the batch screens share.
 * Zero imports, so node tests load it directly; the pure batch modules get a
 * BatchFormat from their component instead of importing a runtime helper.
 */

/** A product's unit words, as productSalesUnit gives them. */
export interface UnitWords { singular: string; plural: string }

const NUMBER = new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 0 });
const MINUS = '−';
const EUR: Record<0 | 2 | 4, Intl.NumberFormat> = {
  0: new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 }),
  2: new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  4: new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 4, maximumFractionDigits: 4 }),
};

/** Whole units and loose pieces of an absolute piece count; a unit below 1 piece counts as 1. */
function split(pieces: number, unitPieces: number): { negative: boolean; whole: number; loose: number } {
  const total = Math.round(Number.isFinite(pieces) ? pieces : 0);
  const unit = Number.isFinite(unitPieces) && unitPieces >= 1 ? Math.round(unitPieces) : 1;
  const size = Math.abs(total);
  return { negative: total < 0, whole: Math.floor(size / unit), loose: size % unit };
}

/** "105", "105 + 4 los", "4 los", "0": whole units of unitPieces plus loose pieces; negative → leading "−". */
export function unitsCount(pieces: number, unitPieces: number): string {
  const { negative, whole, loose } = split(pieces, unitPieces);
  const sign = negative ? MINUS : '';
  if (whole > 0 && loose > 0) return `${sign}${NUMBER.format(whole)} + ${NUMBER.format(loose)} los`;
  if (loose > 0) return `${sign}${NUMBER.format(loose)} los`;
  return whole > 0 ? `${sign}${NUMBER.format(whole)}` : '0';
}

/** "105 displays", "105 displays + 4 los", "4 los", "1 display", "0 displays"; per piece "380 stuks". */
export function unitsText(pieces: number, unitPieces: number, unit: UnitWords): string {
  const { negative, whole, loose } = split(pieces, unitPieces);
  const sign = negative ? MINUS : '';
  const units = `${NUMBER.format(whole)} ${whole === 1 ? unit.singular : unit.plural}`;
  if (whole > 0 && loose > 0) return `${sign}${units} + ${NUMBER.format(loose)} los`;
  if (loose > 0) return `${sign}${NUMBER.format(loose)} los`;
  return whole > 0 ? `${sign}${units}` : units;
}

/** nl-BE euro: "€ 8,32" (2, default), "€ 8,3180" (4), "€ 12.341" (0); null/undefined → "—". Intl currency format. */
export function eurText(value: number | null | undefined, decimals: 0 | 2 | 4 = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const format = EUR[decimals] ?? EUR[2];
  /* A value that rounds to zero reads "€ 0,00", never "€ -0,00". */
  const shown = Math.abs(value) < 0.5 / 10 ** decimals ? 0 : value;
  return format.format(shown);
}

/** What the pure batch modules need at runtime, passed in by the components. */
export interface BatchFormat { unit: UnitWords; count(pieces: number, unitPieces: number): string;
  units(pieces: number, unitPieces: number): string; eur(value: number | null | undefined, decimals?: 0 | 2 | 4): string }

export function batchFormat(unit: UnitWords): BatchFormat {
  return {
    unit,
    count: (pieces, unitPieces) => unitsCount(pieces, unitPieces),
    units: (pieces, unitPieces) => unitsText(pieces, unitPieces, unit),
    eur: (value, decimals) => eurText(value, decimals ?? 2),
  };
}
