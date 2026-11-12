import type { PartnerCountUnit } from '../../core/api/partner-portal-api';
import type { DraftEntry, MeldingDraft } from './partner-draft';
import {
  countUnitsOf, mixText, pieceUnit, piecesPerSalesUnit, stepOf, stockFigure, unitText, wholeHint,
} from './partner-units';

/**
 * What one part of an entry shows, for the desk table and the phone card
 * alike: its unit and the units to pick from, the step, "= 144 rozen", the
 * most it can count, and the lines under it (too many, not whole, the unit
 * switch kept the count). Pure functions over the draft.
 */

export interface PartLineMessage {
  text: string;
  /** It stops Opslaan (red). */
  bad: boolean;
  /** Worth a second look, but it does not stop Opslaan (amber). */
  warn?: boolean;
}

export interface PartLine {
  unit: PartnerCountUnit;
  units: PartnerCountUnit[];
  step: number;
  pieces: number;
  /** "= 144 rozen"; null when the count is in pieces or empty. */
  piecesText: string | null;
  /** The most the count can be (sale only, when a limit is known). */
  max: number | null;
  /** The count field is wrong (red). */
  invalid: boolean;
  messages: PartLineMessage[];
}

/** "roos", "display (12)", "omdoos (144)": the unit as the Eenheid list shows it. */
export function unitOption(unit: PartnerCountUnit): string {
  return unit.unit === 'STUK' ? unit.one : `${unit.one} (${unit.pieces})`;
}

export function partLine(draft: MeldingDraft, entry: DraftEntry, which: 'sale' | 'buyback'): PartLine {
  const product = entry.product;
  const unit = draft.unitOf(entry, which);
  const part = entry[which];
  const pieces = draft.pieces(entry, which);
  const messages: PartLineMessage[] = [];
  let invalid = false;
  let max: number | null = null;
  if (which === 'sale') {
    max = draft.maxCount(entry);
    if (draft.overLimit(entry)) {
      invalid = true;
      const limit = draft.saleLimit(product.productId) ?? 0;
      const there = limit * piecesPerSalesUnit(product);
      const rest = unit.unit !== 'STUK' && there % unit.pieces !== 0;
      messages.push({ text: `Er liggen maar ${there ? mixText(product, there) : unitText(pieceUnit(product), 0)}${rest ? ' · rest: tel per ' + pieceUnit(product).one : ''}`, bad: true });
    }
  }
  if (draft.notWhole(entry, which)) {
    invalid = true;
    messages.push({ text: wholeHint(product), bad: true });
  } else if (part.kept) {
    messages.push({ text: `Gaat niet op in hele ${unit.other}: het aantal bleef staan.`, bad: false });
  }
  /* A buyback on the clock usually stays below what sold that day; more is possible (it can take back an earlier
     sale), so it is said, not refused. */
  if (which === 'buyback' && draft.kind() === 'veiling') {
    const sold = draft.pieces(entry, 'sale');
    if (sold > 0 && pieces > sold) {
      const piece = pieceUnit(product);
      messages.push({ text: `Meer teruggekocht (${unitText(piece, pieces)}) dan verkocht (${unitText(piece, sold)}): klopt dat?`, bad: false, warn: true });
    }
  }
  return {
    unit,
    units: countUnitsOf(product),
    step: stepOf(product, unit),
    pieces,
    piecesText: unit.unit === 'STUK' || !pieces ? null : '= ' + unitText(pieceUnit(product), pieces),
    max,
    invalid,
    messages,
  };
}

/** "720 rozen op voorraad" (in edit "beschikbaar": the melding's own pieces count again); on Terugkoop the last sale day. */
export function stockLine(draft: MeldingDraft, entry: DraftEntry, lastSoldOn: string | null, day: (iso: string) => string): string {
  if (draft.kind() === 'terugkoop') return lastSoldOn ? 'verkocht ' + day(lastSoldOn) : '';
  const limit = draft.saleLimit(entry.product.productId);
  if (limit === null) return '';
  return `${stockFigure(entry.product, limit).main} ${draft.editing() ? 'beschikbaar' : 'op voorraad'}`;
}

/** The piece noun every product of the melding shares ("roos"), or null when they differ (each row then says its own). */
export function sharedPieceNoun(entries: readonly DraftEntry[]): string | null {
  const nouns = new Set(entries.map((entry) => pieceUnit(entry.product).one));
  return nouns.size === 1 ? [...nouns][0] : nouns.size === 0 ? 'stuk' : null;
}

/** The price column's head: "Prijs per roos" when every product counts in roses, else "Prijs" (each row says per what). */
export function pricePerLabel(entries: readonly DraftEntry[], prefix = 'Prijs'): string {
  const noun = sharedPieceNoun(entries);
  return noun ? `${prefix} per ${noun}` : prefix;
}

/** Under an Aantal that is no whole number ("2,5"): what to type instead. */
export function countUnreadableText(entry: DraftEntry, unit: PartnerCountUnit): string {
  const piece = pieceUnit(entry.product);
  return unit.unit === piece.unit ? 'Alleen hele aantallen' : `Alleen hele ${unit.other}: tel de rest per ${piece.one}`;
}
