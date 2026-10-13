/*
 * Entering a cost incl. or excl. btw: the arithmetic between the two, and
 * what a regime change does to the amount block. The figure that was typed
 * is kept as it is; the other side is derived and rounded to the cent. No
 * runtime imports: the node tests run this file on its own.
 */

const round2 = (value: number): number => Math.round(value * 100) / 100;
const finite = (value: number | null | undefined): number => (Number.isFinite(value as number) ? (value as number) : 0);
const rate = (vatPct: number | null | undefined): number => Math.max(0, finite(vatPct)) / 100;
/** A figure in whole cents, half up, read through the binary float a typed 1.005 or 8.145 really is (1.005 → 101). */
const cents = (value: number | null | undefined): number => Math.round(Math.round(finite(value) * 1000) / 10);

/** The excl. amount behind an inclusive total at a VAT rate, in cents; null or 0 % leaves the figure as it is (to the cent). */
export function exclFromIncl(incl: number, vatPct: number | null | undefined): number {
  const pct = Math.max(0, finite(vatPct));
  return pct > 0 ? Math.round(cents(incl) * 100 / (100 + pct)) / 100 : cents(incl) / 100;
}

/** The inclusive total of an excl. amount, the way vatOf/inclOf add it up (the VAT rounded first). */
export function inclFromExcl(excl: number, vatPct: number | null | undefined): number {
  const amount = finite(excl);
  return round2(amount + round2(amount * rate(vatPct)));
}

/** The VAT between an entered inclusive total and its excl. amount, in cents; never below zero. */
export function vatFromIncl(incl: number, excl: number): number {
  return Math.max(0, cents(incl) - cents(excl)) / 100;
}

/**
 * How a regime reads the amount block: an invoice with VAT on it (Belgian or
 * foreign VAT), reverse charge (no VAT on the invoice, a rate for the
 * return), no VAT at all (exempt, out of scope, a ticket) or the VAT of an
 * import document alone.
 */
export type AmountKind = 'invoice' | 'reverse' | 'none' | 'import';

/** The amount block of the cost form: the two amounts, the rate, the mode of the field and where its figure came from. */
export interface AmountBlock {
  amountExclEur: number;
  amountInclEur: number | null;
  vatPct: number | null;
  mode: 'excl' | 'incl';
  /** The total in the field was typed (or stored) incl. btw; false once the mode switch converted it. */
  typedIncl: boolean;
  /** The excl. amount is a total that was typed incl. btw and kept whole because the regime puts no VAT on the invoice. */
  totalKept: boolean;
}

/**
 * The amount block after a regime change. Import VAT is one incl. figure;
 * reverse charge and the regimes without VAT are excl.-only; an invoice
 * with VAT gets its rate back (21 %) when the previous regime had none.
 *
 * Without VAT on the invoice its total IS the excl. amount: a figure typed
 * incl. btw is kept whole (the back-calculated excl. amount would turn a
 * typed € 1.210 into € 1.000), while an amount typed excl. stays what it
 * was, also after a look at its total through the mode switch. When a regime
 * with VAT on the invoice follows, the kept total is the invoice total again.
 */
export function fitAmountToRegime(block: AmountBlock, kind: AmountKind, before: AmountKind | null): AmountBlock {
  const entered = (value: number | null): number => (finite(value) > 0 ? finite(value) : 0);
  const figure = block.mode === 'incl' ? entered(block.amountInclEur) : block.amountExclEur;
  if (kind === 'import') return { amountExclEur: 0, amountInclEur: figure > 0 ? figure : null, vatPct: null, mode: 'incl', typedIncl: false, totalKept: false };
  const from: AmountBlock = before === 'import' ? { ...block, amountExclEur: figure, amountInclEur: null, mode: 'excl', typedIncl: false, totalKept: false } : block;
  const pct = finite(from.vatPct) > 0;
  if (kind === 'none' || kind === 'reverse') {
    const total = from.mode === 'incl' && from.typedIncl ? entered(from.amountInclEur) : 0;
    return {
      amountExclEur: total > 0 ? cents(total) / 100 : from.amountExclEur, amountInclEur: null,
      vatPct: kind === 'none' ? null : pct ? from.vatPct : 21,
      mode: 'excl', typedIncl: false, totalKept: total > 0 || from.totalKept,
    };
  }
  const vatPct = !pct && (before === null || before === 'none' || before === 'import') ? 21 : from.vatPct;
  if (from.totalKept) {
    return { amountExclEur: exclFromIncl(from.amountExclEur, vatPct), amountInclEur: from.amountExclEur, vatPct, mode: 'incl', typedIncl: true, totalKept: false };
  }
  const incl = entered(from.amountInclEur);
  return { ...from, vatPct, amountExclEur: vatPct !== from.vatPct && from.mode === 'incl' && incl ? exclFromIncl(incl, vatPct) : from.amountExclEur };
}
