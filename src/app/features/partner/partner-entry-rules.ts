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
  /* The shelf, as the server checks it: a new melding's sale against what lies there; an edit's net change (sale
     minus buyback), blamed on the sale when it grew, else on the buyback whose pieces were sold again since. */
  const short = draft.shelfShort(entry);
  const piece = pieceUnit(product);
  if (which === 'sale') {
    max = draft.maxCount(entry);
    if (short?.side === 'sale') {
      invalid = true;
      const there = short.most * piecesPerSalesUnit(product);
      const rest = unit.unit !== 'STUK' && there % unit.pieces !== 0;
      messages.push({ text: `Er liggen maar ${there ? mixText(product, there) : unitText(piece, 0)}${short.back ? ' met de terugkoop' : ''}${rest ? ' · rest: tel per ' + piece.one : ''}`, bad: true });
    } else if (short && !draft.showsBuyback(entry)) {
      invalid = true;
      messages.push({ text: 'De teruggekochte stuks liggen niet meer op voorraad: de terugkoop moet blijven', bad: true });
    }
  } else if (short?.side === 'buyback') {
    invalid = true;
    messages.push({ text: `De teruggekochte stuks liggen niet meer op voorraad: minstens ${unitText(piece, short.leastBack * piecesPerSalesUnit(product))} terug`, bad: true });
  }
  if (part.unreadable) {
    invalid = true;
    messages.push({ text: countUnreadableText(entry, unit), bad: true });
  } else if (draft.notWhole(entry, which)) {
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
