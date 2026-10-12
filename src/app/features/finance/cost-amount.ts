/*
 * Entering a cost incl. or excl. btw: the arithmetic between the two. The
 * figure that was typed is kept as it is; the other side is derived and
 * rounded to the cent. No runtime imports: the node tests run this file on
 * its own.
 */

const round2 = (value: number): number => Math.round(value * 100) / 100;
const finite = (value: number | null | undefined): number => (Number.isFinite(value as number) ? (value as number) : 0);
const rate = (vatPct: number | null | undefined): number => Math.max(0, finite(vatPct)) / 100;

/** The excl. amount behind an inclusive total at a VAT rate; null or 0 % leaves the figure as it is. */
export function exclFromIncl(incl: number, vatPct: number | null | undefined): number {
  return round2(finite(incl) / (1 + rate(vatPct)));
}

/** The inclusive total of an excl. amount, the way vatOf/inclOf add it up (the VAT rounded first). */
export function inclFromExcl(excl: number, vatPct: number | null | undefined): number {
  const amount = finite(excl);
  return round2(amount + round2(amount * rate(vatPct)));
}

/** The VAT between an entered inclusive total and its excl. amount; never below zero. */
export function vatFromIncl(incl: number, excl: number): number {
  return Math.max(0, round2(finite(incl) - finite(excl)));
}
