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
  bad: boolean;
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

/** The price column's head: "Prijs per roos" when every product counts in roses, else "Prijs per stuk". */
export function pricePerLabel(entries: readonly DraftEntry[], prefix = 'Prijs'): string {
  const nouns = new Set(entries.map((entry) => pieceUnit(entry.product).one));
  return `${prefix} per ${nouns.size === 1 ? [...nouns][0] : 'stuk'}`;
}
