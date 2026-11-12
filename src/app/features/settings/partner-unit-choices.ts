import type { Product } from '../../core/api/models';
import type { PartnerCountUnitCode, PartnerProductUnitRow } from '../../core/api/partner-sales-api';
import { unitName } from '../products/product-sales-unit';

/*
 * How the partner can count a product in the portal (contract round 2 §1, the
 * backend's PartnerCountUnits mirrored for Instellingen › Partnerportaal): per
 * piece in the product's own noun (roos, bowl, stolp …), per display when a
 * display holds two or more, per outer carton when its content is known and
 * above one. Smallest first. Stock and meldingen stay in sales units; this
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

function whole(value: number | null | undefined): number | null {
  return value != null && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Pieces per sales unit: a display's content on a display basis, else 1. */
export function piecesPerSalesUnit(product: UnitProduct): number {
  const packaging = product.packaging;
  const pieces = whole(packaging?.piecesPerUnit);
  return packaging?.kind === 'DISPLAY' && packaging.salesUnit === 'DISPLAY' && pieces && pieces >= 2 ? pieces : 1;
}

/** The units offered for this product, smallest first; STUK always. */
export function partnerUnitChoices(product: UnitProduct): PartnerUnitChoice[] {
  const piece = unitName(product.packaging?.unitKey);
  const pieces = (n: number) => `${NL.format(n)} ${n === 1 ? piece.one : piece.other}`;
  const choices: PartnerUnitChoice[] = [{ unit: 'STUK', one: piece.one, other: piece.other, pieces: 1, label: `per ${piece.one}` }];
  const display = whole(product.packaging?.piecesPerUnit);
  if (product.packaging?.kind === 'DISPLAY' && display && display >= 2) {
    choices.push({ unit: 'VERPAKKING', one: 'display', other: 'displays', pieces: display, label: `per display · ${pieces(display)}` });
  }
  const carton = whole(product.carton?.piecesPerCarton);
  if (carton && carton > 1) {
    const inPieces = carton * piecesPerSalesUnit(product);
    choices.push({ unit: 'OMDOOS', one: 'omdoos', other: 'omdozen', pieces: inPieces, label: `per omdoos · ${pieces(inPieces)}` });
  }
  return choices.sort((a, b) => a.pieces - b.pieces);
}

/** The unit that applies: the stored one while the product still offers it, else per piece. */
export function effectiveUnit(stored: PartnerCountUnitCode | null | undefined, choices: readonly PartnerUnitChoice[]): PartnerCountUnitCode {
  return stored && choices.some((choice) => choice.unit === stored) ? stored : 'STUK';
}

export function storedUnits(rows: readonly PartnerProductUnitRow[]): Map<number, PartnerCountUnitCode> {
  return new Map(rows.filter((row) => row && Number.isSafeInteger(row.productId)).map((row) => [row.productId, row.unit]));
}

/** Accent- and case-free text for the search. */
export function searchText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
