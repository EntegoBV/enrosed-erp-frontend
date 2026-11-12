import type {
  PartnerReport, PartnerReportBuyback, PartnerReportEntry, PartnerReportSale, PartnerReportTotals,
} from '../../core/api/partner-portal-api';
import { count, units } from './partner-format';
import { NO_TWINS, Twins, twinTitle } from './partner-twins';
import { pieceUnit, piecesPerSalesUnit, unitOf, unitText } from './partner-units';

/**
 * How a saved melding reads in the portal: counts as they were typed
 * ("120 rozen", "3 omdozen"), pieces ("Stuks" means pieces everywhere), the
 * partner's status words. Round-1 rows (no entered unit) read in their sales
 * unit. Pure.
 */

type Part = PartnerReportSale | PartnerReportBuyback;

/** Pieces of a part: round 2 sends them; a round-1 row is its sales units x pieces per sales unit. */
export function partPieces(entry: PartnerReportEntry, part: Part): number {
  return part.pieces ?? part.quantity * piecesPerSalesUnit(entry);
}

/** What was typed: "120 rozen", "3 omdozen"; a round-1 row in its sales unit ("3 displays"). */
export function partCount(entry: PartnerReportEntry, part: Part): string {
  const unit = unitOf(entry, part.enteredUnit);
  if (unit && part.enteredCount) return unitText(unit, part.enteredCount);
  return units(part.quantity, entry);
}

/** "= 144 rozen" beside a count that is not in pieces; null when it is. */
export function partPiecesText(entry: PartnerReportEntry, part: Part): string | null {
  const pieces = partPieces(entry, part);
  const unit = unitOf(entry, part.enteredUnit);
  const typedPieces = unit ? unit.unit === 'STUK' : piecesPerSalesUnit(entry) === 1;
  return typedPieces ? null : '= ' + unitText(pieceUnit(entry), pieces);
}

/** The average per piece (4 decimals as stored). */
export function partPiecePrice(entry: PartnerReportEntry, part: Part): number {
  return part.piecePriceEur ?? part.unitPriceEur / piecesPerSalesUnit(entry);
}

/** One piece's noun of the entry: "roos". */
export function pieceNoun(entry: PartnerReportEntry): string {
  return pieceUnit(entry).one;
}

/** The pieces a melding sold and bought back. */
export function reportPieces(report: Pick<PartnerReport, 'entries' | 'totals'>): { sale: number; buyback: number } {
  const t = report.totals;
  return {
    sale: t.salePieces ?? report.entries.reduce((sum, entry) => sum + (entry.sale ? partPieces(entry, entry.sale) : 0), 0),
    buyback: t.buybackPieces ?? report.entries.reduce((sum, entry) => sum + (entry.buyback ? partPieces(entry, entry.buyback) : 0), 0),
  };
}

/** Pieces in words: "144 rozen" when every product counts in the same noun, else "144 stuks". */
export function piecesWords(report: Pick<PartnerReport, 'entries'>, pieces: number): string {
  const nouns = new Set(report.entries.map((entry) => pieceUnit(entry).other));
  const first = report.entries[0];
  if (first && nouns.size === 1) return unitText(pieceUnit(first), pieces);
  return `${count(pieces)} ${pieces === 1 ? 'stuk' : 'stuks'}`;
}

/** Veilingcommissie + transport + extra kost of the sales, in euros (cents summed, never floats). */
export function costsEur(totals: PartnerReportTotals): number {
  const cents = [totals.commissionEur, totals.transportEur, totals.extraCostEur].reduce((sum, value) => sum + Math.round((value || 0) * 100), 0);
  return cents / 100;
}

/** The buyer of a direct sale: "Bloemen Jansen · Aalsmeer". */
export function buyerLine(report: Pick<PartnerReport, 'buyer'>): string {
  const buyer = report.buyer;
  return buyer ? [buyer.company, buyer.city].filter(Boolean).join(' · ') : '';
}

/** The products of a melding in one short line: the first one, then "+ 2"; a twin carries its code. */
export function productsShort(report: Pick<PartnerReport, 'entries'>, twins: Twins = NO_TWINS): string {
  const [first, ...rest] = report.entries;
  if (!first) return '';
  const title = twinTitle(first, twins);
  return rest.length ? `${title} + ${rest.length}` : title;
}

export interface StatusView {
  label: string;
  tone: string;
}

/**
 * The partner's words for a melding's state: Ingediend (saved, his to change until Enrosed confirms), Bevestigd,
 * Deels gefactureerd, Gefactureerd, Ingetrokken.
 */
export function partnerStatus(report: Pick<PartnerReport, 'status' | 'confirmed'>): StatusView {
  switch (report.status) {
    case 'VOIDED': return { label: 'Ingetrokken', tone: 'tone-grey' };
    case 'INVOICED': return { label: 'Gefactureerd', tone: 'tone-green' };
    case 'PARTLY_INVOICED': return { label: 'Deels gefactureerd', tone: 'tone-blue' };
    default: return report.confirmed ? { label: 'Bevestigd', tone: 'tone-teal' } : { label: 'Ingediend', tone: 'tone-amber' };
  }
}

/** Ongedaan maken shows: round 2 decides with canUndo; a round-1 server also needs the melding open. */
export function canUndoReport(report: Pick<PartnerReport, 'canUndo' | 'status'>): boolean {
  return report.canUndo && report.status === 'OPEN';
}

/** Bewerken shows: only a round-2 server says so. */
export function canEditReport(report: Pick<PartnerReport, 'canEdit' | 'status'>): boolean {
  return report.canEdit === true && report.status === 'OPEN';
}

/** Newest sale day first, then the newest melding. */
export function bySoldOn(a: Pick<PartnerReport, 'soldOn' | 'id'>, b: Pick<PartnerReport, 'soldOn' | 'id'>): number {
  return b.soldOn.localeCompare(a.soldOn) || b.id - a.id;
}
