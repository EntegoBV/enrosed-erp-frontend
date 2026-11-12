import type { PartnerCountUnit, PartnerCountUnitKey } from '../../core/api/partner-portal-api';
import { CARTON_NAMES, COUNT_UNIT_ORDER as ORDER, DISPLAY_NAMES, buildCountUnits, sortCountUnits as sortUnits } from '../../shared/partner-count-units';
import { count } from './partner-format';

/**
 * Counting units of the portal ("per roos, per bowl, per stuk"), the pure
 * mirror of the server's partnerportal/domain/PartnerCountUnits (contract
 * round 2 section 1). Stock, parts and movements stay in sales units; a
 * melding is typed as a count in a count unit and converts at the edge:
 *
 *   STUK        one piece in the product's own noun (roos, bowl, stolp, stuk)
 *   VERPAKKING  the display: its pieces, offered for a DISPLAY packaging of 2+
 *   OMDOOS      the outer carton: carton content (sales units) x pieces per
 *               sales unit, offered when the content is known and above 1
 *
 *   sales units = count x pieces per count unit / pieces per sales unit,
 *   and must be whole; pieces = sales units x pieces per sales unit.
 *
 * The partner's tiles carry the offered units and the default from the
 * server; `buildCountUnits` (shared/partner-count-units.ts, re-exported) is
 * for a screen that builds tiles from the catalogue itself. A tile of a
 * round-1 server (no countUnits) counts in its sales unit, as round 1 did.
 * Pure: the number format and the shared rule only.
 */

/** What counting needs of a product: a tile, a stock tile or a melding's entry. */
export interface CountProduct {
  unitOne: string;
  unitOther: string;
  piecesPerSalesUnit?: number;
  pieceOne?: string;
  pieceOther?: string;
  countUnits?: readonly PartnerCountUnit[];
  defaultUnit?: PartnerCountUnitKey;
}

/* The offer rule itself (CountFacts, buildCountUnits, the unit names and their order) lives once in
   shared/partner-count-units.ts, the one mirror of the server's PartnerCountUnits for the portal and the staff
   screens; re-exported here so the portal's imports stay as they are. */
export type { CountFacts } from '../../shared/partner-count-units';
export { CARTON_NAMES, DISPLAY_NAMES, buildCountUnits };

function positive(value: number | null | undefined): number {
  return value != null && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Pieces in one sales unit (12 for a display of 12 rozen sold per display); 1 on a round-1 tile. */
export function piecesPerSalesUnit(product: CountProduct): number {
  return Math.max(1, positive(product.piecesPerSalesUnit));
}

/** The offered units, smallest first; a round-1 tile counts in its sales unit. */
export function countUnitsOf(product: CountProduct): PartnerCountUnit[] {
  const listed = (product.countUnits ?? []).filter((unit) => positive(unit.pieces) > 0 && ORDER[unit.unit] !== undefined);
  if (!listed.length) return [{ unit: 'STUK', one: product.pieceOne || product.unitOne, other: product.pieceOther || product.unitOther, pieces: 1 }];
  if (!listed.some((unit) => unit.unit === 'STUK')) {
    listed.push({ unit: 'STUK', one: product.pieceOne || 'stuk', other: product.pieceOther || 'stuks', pieces: 1 });
  }
  return sortUnits(listed);
}

export function unitOf(product: CountProduct, key: PartnerCountUnitKey | null | undefined): PartnerCountUnit | null {
  return key ? countUnitsOf(product).find((unit) => unit.unit === key) ?? null : null;
}

/** One piece: roos / rozen. */
export function pieceUnit(product: CountProduct): PartnerCountUnit {
  return unitOf(product, 'STUK') ?? countUnitsOf(product)[0];
}

/** Enrosed's default for the product; a stored unit the product no longer offers falls back to per stuk. */
export function defaultUnitOf(product: CountProduct): PartnerCountUnit {
  return unitOf(product, product.defaultUnit) ?? pieceUnit(product);
}

/** The smallest count that books whole sales units: 12 rozen of a display of 12, else 1. */
export function stepOf(product: CountProduct, unit: PartnerCountUnit): number {
  const perSalesUnit = piecesPerSalesUnit(product);
  return perSalesUnit / gcd(Math.max(1, unit.pieces), perSalesUnit);
}

export function piecesOf(unit: PartnerCountUnit, countValue: number | null | undefined): number {
  return positive(countValue) * unit.pieces;
}

/** The sales units a count books, or null when it is no whole number of them (or no count). */
export function salesUnitsOf(product: CountProduct, unit: PartnerCountUnit, countValue: number | null | undefined): number | null {
  const pieces = piecesOf(unit, countValue);
  if (!pieces) return null;
  const perSalesUnit = piecesPerSalesUnit(product);
  return pieces % perSalesUnit === 0 ? pieces / perSalesUnit : null;
}

/** The most that can be counted in this unit out of `salesUnits` (whole units, a multiple of the step). */
export function maxCountOf(product: CountProduct, unit: PartnerCountUnit, salesUnits: number): number {
  const most = Math.floor((Math.max(0, salesUnits) * piecesPerSalesUnit(product)) / Math.max(1, unit.pieces));
  const step = stepOf(product, unit);
  return Math.floor(most / step) * step;
}

/** "3 omdozen", "1 roos". */
export function unitText(unit: Pick<PartnerCountUnit, 'one' | 'other'>, countValue: number): string {
  return `${count(countValue)} ${countValue === 1 ? unit.one : unit.other}`;
}

/** Pieces in the product's units, biggest first: "1 omdoos + 6 rozen"; only pieces: "150 rozen". */
export function mixText(product: CountProduct, pieces: number): string {
  let left = Math.max(0, Math.floor(pieces));
  const parts: string[] = [];
  for (const unit of [...countUnitsOf(product)].reverse()) {
    if (unit.pieces <= 0) continue;
    const n = Math.floor(left / unit.pieces);
    if (n > 0) { parts.push(unitText(unit, n)); left -= n * unit.pieces; }
  }
  return parts.length ? parts.join(' + ') : unitText(pieceUnit(product), 0);
}

/**
 * Stock as the tables show it: in the default unit when it is whole, with "= 432 rozen" beside it; otherwise in
 * pieces with how it is made up ("1 omdoos + 6 rozen").
 */
export function stockFigure(product: CountProduct, salesUnits: number): { main: string; sub: string | null; pieces: number } {
  const pieces = Math.max(0, salesUnits) * piecesPerSalesUnit(product);
  const unit = defaultUnitOf(product);
  const piece = pieceUnit(product);
  if (unit.pieces > 0 && pieces % unit.pieces === 0) {
    return { main: unitText(unit, pieces / unit.pieces), sub: unit.unit === 'STUK' ? null : '= ' + unitText(piece, pieces), pieces };
  }
  const mix = mixText(product, pieces);
  return { main: unitText(piece, pieces), sub: mix.includes('+') ? mix : null, pieces };
}

/** The noun of one sales unit ("display") for the whole-number hint. */
function salesUnitNames(product: CountProduct): { one: string; other: string } {
  const perSalesUnit = piecesPerSalesUnit(product);
  return countUnitsOf(product).find((unit) => unit.unit !== 'STUK' && unit.pieces === perSalesUnit) ?? { one: product.unitOne, other: product.unitOther };
}

/** "Een display telt 12 rozen: meld 12, 24, 36 … rozen of tel per display." (the server's words) */
export function wholeHint(product: CountProduct): string {
  const n = piecesPerSalesUnit(product);
  const piece = pieceUnit(product);
  const sales = salesUnitNames(product);
  return `Een ${sales.one} telt ${count(n)} ${piece.other}: meld ${count(n)}, ${count(2 * n)}, ${count(3 * n)} … ${piece.other} of tel per ${sales.one}.`;
}

/**
 * Another unit for a typed count: the pieces stay when they fit in whole units of the new one (120 rozen ->
 * 10 displays); else the count stays (3 omdozen -> 3 displays) and `kept` says so.
 */
export function switchCount(product: CountProduct, from: PartnerCountUnit, countValue: number | null, to: PartnerCountUnit)
    : { count: number | null; kept: boolean } {
  if (countValue == null || countValue <= 0) return { count: countValue, kept: false };
  const pieces = piecesOf(from, countValue);
  if (to.pieces > 0 && pieces % to.pieces === 0) {
    const next = pieces / to.pieces;
    if (salesUnitsOf(product, to, next) !== null) return { count: next, kept: false };
  }
  return { count: countValue, kept: true };
}
