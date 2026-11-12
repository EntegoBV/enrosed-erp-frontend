import type { Product } from '../../core/api/models';
import type { PartnerCountUnitCode, PartnerProductUnitRow } from '../../core/api/partner-sales-api';
import { buildCountUnits, countFactsOf, effectiveCountUnit } from '../../shared/partner-count-units';
import { unitName } from '../products/product-sales-unit';

/*
 * How the partner can count a product in the portal, for the staff screens
 * (Instellingen › Partnerportaal, the staff melding page). The rule itself is
 * the one shared mirror of the server's PartnerCountUnits
 * (shared/partner-count-units.ts, also behind the portal's partner-units.ts);
 * this file only feeds it a staff Product and adds the labels ("per roos",
 * "per display · 12 rozen"). Stock and meldingen stay in sales units; this
 * only names the defaults staff choose ("Standaard per stuk, nooit per set").
 */

type UnitProduct = Pick<Product, 'packaging' | 'carton'>;

export interface PartnerUnitChoice {
  unit: PartnerCountUnitCode;
  /** "roos" / "display" / "omdoos". */
  one: string;
  other: string;
  /** Pieces in one of it (1 for STUK). */
  pieces: number;
  /** "per roos", "per display · 12 rozen", "per omdoos · 48 rozen". */
  label: string;
}

const NL = new Intl.NumberFormat('nl-BE');

function counting(product: UnitProduct): ReturnType<typeof buildCountUnits> {
  return buildCountUnits(countFactsOf(product, unitName(product.packaging?.unitKey)));
}

/** Pieces per sales unit: a display's content on a display basis, else 1. */
export function piecesPerSalesUnit(product: UnitProduct): number {
  return counting(product).piecesPerSalesUnit;
}

/** The units offered for this product, smallest first; STUK always. */
export function partnerUnitChoices(product: UnitProduct): PartnerUnitChoice[] {
  const units = counting(product).countUnits;
  const piece = units.find((unit) => unit.unit === 'STUK') ?? units[0];
  const pieces = (n: number) => `${NL.format(n)} ${n === 1 ? piece.one : piece.other}`;
  return units.map(({ unit, one, other, pieces: n }) => ({
    unit, one, other, pieces: n, label: unit === 'STUK' ? `per ${one}` : `per ${one} · ${pieces(n)}`,
  }));
}

/** The unit that applies: the stored one while the product still offers it, else per piece. */
export function effectiveUnit(stored: PartnerCountUnitCode | null | undefined, choices: readonly PartnerUnitChoice[]): PartnerCountUnitCode {
  return effectiveCountUnit(stored, choices);
}

export function storedUnits(rows: readonly PartnerProductUnitRow[]): Map<number, PartnerCountUnitCode> {
  return new Map(rows.filter((row) => row && Number.isSafeInteger(row.productId)).map((row) => [row.productId, row.unit]));
}

/** Accent- and case-free text for the search. */
export function searchText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
