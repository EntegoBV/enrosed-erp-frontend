import type { CartonDto, Packaging } from '../core/api/models';
import type { PartnerCountUnit, PartnerCountUnitKey, PartnerSalesUnit } from '../core/api/partner-portal-api';

/*
 * The one frontend mirror of the server's partnerportal/domain/PartnerCountUnits
 * (contract round 2 section 1): how a product can be counted in the partner
 * portal. The portal's partner-units.ts and the staff screens (Instellingen ›
 * Partnerportaal, the staff melding page) both read it, so they can never
 * count differently.
 *
 *   STUK        one piece in the product's own noun (roos, bowl, stolp, stuk)
 *   VERPAKKING  the display: its pieces, offered for a DISPLAY packaging of 2+
 *   OMDOOS      the outer carton: carton content (sales units) x pieces per
 *               sales unit, offered when the content is known and above 1
 *
 *   pieces per sales unit = the display's pieces on a DISPLAY basis, else 1
 *   (a DISPLAY basis needs a DISPLAY packaging, as Packaging.salesUnit()).
 *
 * Smallest first; ties in the order STUK, VERPAKKING, OMDOOS. Pure: type
 * imports only.
 */

/** The catalogue facts the rule reads. */
export interface CountFacts {
  /** The effective sales unit: DISPLAY only for a DISPLAY packaging sold per display. */
  salesUnit: PartnerSalesUnit;
  /** The packaging is a DISPLAY (kind), whatever the basis. */
  displayKind: boolean;
  /** packaging.unitPieces(): 1 when unknown. */
  unitPieces: number;
  /** OrderSteps.knownPiecesPerCarton: the carton content in sales units, 0 when unknown. */
  cartonContent: number;
  /** The piece noun from UnitNames via packaging.unitKey(). */
  pieceOne: string;
  pieceOther: string;
}

export const DISPLAY_NAMES = { one: 'display', other: 'displays' } as const;
export const CARTON_NAMES = { one: 'omdoos', other: 'omdozen' } as const;
export const COUNT_UNIT_ORDER: Readonly<Record<PartnerCountUnitKey, number>> = { STUK: 0, VERPAKKING: 1, OMDOOS: 2 };

function positive(value: number | null | undefined): number {
  return value != null && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/** Smallest first, ties STUK < VERPAKKING < OMDOOS (the server's order). */
export function sortCountUnits(units: readonly PartnerCountUnit[]): PartnerCountUnit[] {
  return [...units].sort((a, b) => a.pieces - b.pieces || COUNT_UNIT_ORDER[a.unit] - COUNT_UNIT_ORDER[b.unit]);
}

/** The units offered for these facts (smallest first), the effective sales unit and the pieces per sales unit. */
export function buildCountUnits(facts: CountFacts): { salesUnit: PartnerSalesUnit; piecesPerSalesUnit: number; countUnits: PartnerCountUnit[] } {
  const unitPieces = Math.max(1, positive(facts.unitPieces));
  const salesUnit: PartnerSalesUnit = facts.salesUnit === 'DISPLAY' ? 'DISPLAY' : 'PIECE';
  const piecesPerSalesUnit = salesUnit === 'DISPLAY' ? unitPieces : 1;
  const units: PartnerCountUnit[] = [{ unit: 'STUK', one: facts.pieceOne, other: facts.pieceOther, pieces: 1 }];
  if (facts.displayKind && unitPieces >= 2) units.push({ unit: 'VERPAKKING', ...DISPLAY_NAMES, pieces: unitPieces });
  const carton = positive(facts.cartonContent);
  if (carton > 1) units.push({ unit: 'OMDOOS', ...CARTON_NAMES, pieces: carton * piecesPerSalesUnit });
  return { salesUnit, piecesPerSalesUnit, countUnits: sortCountUnits(units) };
}

/**
 * The facts of a staff catalogue product, as the server reads its Packaging and Carton: a DISPLAY basis needs a
 * DISPLAY packaging; the carton content counts only when it is above one (a one-piece carton without evidence reads
 * as unknown on the server, and one is never offered either way). The piece noun comes from the caller (UnitNames).
 */
export function countFactsOf(product: { packaging?: Pick<Packaging, 'kind' | 'piecesPerUnit' | 'salesUnit'> | null; carton?: Pick<CartonDto, 'piecesPerCarton'> | null },
    piece: { one: string; other: string }): CountFacts {
  const packaging = product.packaging ?? null;
  const displayKind = packaging?.kind === 'DISPLAY';
  return {
    salesUnit: displayKind && packaging?.salesUnit === 'DISPLAY' ? 'DISPLAY' : 'PIECE',
    displayKind,
    unitPieces: Math.max(1, positive(packaging?.piecesPerUnit)),
    cartonContent: positive(product.carton?.piecesPerCarton),
    pieceOne: piece.one,
    pieceOther: piece.other,
  };
}

/** The unit that applies: the stored one while the product still offers it, else per piece. */
export function effectiveCountUnit(stored: PartnerCountUnitKey | null | undefined, units: readonly Pick<PartnerCountUnit, 'unit'>[]): PartnerCountUnitKey {
  return stored && units.some((unit) => unit.unit === stored) ? stored : 'STUK';
}
