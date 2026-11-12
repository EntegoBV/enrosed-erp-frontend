import type { OrderStep, SalesOrderLine } from '../../core/api/models';
import type { SegmentOption } from '../../shared/segmented';

/*
 * "Aantal per stuk" on one sales line (2026-11-10): staff can let a line count per piece, so its quantity is not
 * rounded up to the product's order step. The server owns the rule and says where the choice exists
 * (PricedLine.perPieceChoice); this file only words the switch and keeps the draft tidy. Types only: no runtime imports.
 */

const options = new Map<string, SegmentOption[]>();

/**
 * The two sides of a line's switch, small to large like "Klant bestelt per" in the product editor: one unit
 * ("Stolp"), then the product's order step ("Omdoos" or "Display"). The same array for the same words, so a
 * template can bind it.
 */
export function perPieceOptions(step: OrderStep | null | undefined, unitSingular: string): SegmentOption[] {
  const key = `${step === 'PACKAGE' ? 'PACKAGE' : 'CARTON'}|${unitSingular}`;
  let found = options.get(key);
  if (!found) {
    found = [
      { id: 'piece', label: `${unitSingular.charAt(0).toLocaleUpperCase('nl-BE')}${unitSingular.slice(1)}` },
      { id: 'step', label: step === 'PACKAGE' ? 'Display' : 'Omdoos' },
    ];
    options.set(key, found);
  }
  return found;
}

/**
 * What a per-piece line adds to its cartons when the last one ships part-filled: "niet vol" for one carton,
 * "laatste niet vol" for more. Null for a line that rounds, for whole cartons and when the carton content is unknown.
 */
export function partCartonNote(
  perPiece: boolean,
  quantity: number,
  cartons: number,
  piecesPerCarton: number | null | undefined,
): string | null {
  if (!perPiece || !(quantity > 0) || !piecesPerCarton || piecesPerCarton <= 1 || quantity % piecesPerCarton === 0) return null;
  return cartons === 1 ? 'niet vol' : 'laatste niet vol';
}

/**
 * The draft line with its choice set. `stored` is the choice on the saved line: switching off what was saved must
 * travel as false (an absent value keeps the stored choice), while taking back a choice that was never saved leaves
 * no trace, so the draft equals the saved document again.
 */
export function salesLineWithPerPiece(line: SalesOrderLine, on: boolean, stored: boolean): SalesOrderLine {
  if (on) return { ...line, perPiece: true };
  if (stored) return { ...line, perPiece: false };
  const { perPiece: _choice, ...rest } = line;
  return rest;
}
