import { Pipe, PipeTransform } from '@angular/core';

/*
 * Euro amounts that may be below zero, the way Analyses, Kaslijn and the home
 * widgets write them (finance/cash-format.ts): the minus sign U+2212 before
 * the euro sign, "− € 169,66", never "€ -169,66". No-break spaces keep the
 * amount on one line. Pure.
 */

const MINUS = '−';
const NBSP = ' ';
const FORMATS = new Map<number, Intl.NumberFormat>();

function format(decimals: number): Intl.NumberFormat {
  let known = FORMATS.get(decimals);
  if (!known) {
    known = new Intl.NumberFormat('nl-BE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    FORMATS.set(decimals, known);
  }
  return known;
}

/** '€ 1.234,56', '− € 169,66', '€ 0,00'; '—' without a number. A value that rounds to zero has no sign. */
export function signedEur(value: number | null | undefined, decimals = 2): string {
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) return '—';
  const factor = 10 ** decimals;
  const rounded = Math.round(Math.abs(n) * factor) / factor;
  const text = `€${NBSP}${format(decimals).format(rounded)}`;
  return n < 0 && rounded > 0 ? `${MINUS}${NBSP}${text}` : text;
}

/** {{ value | signedEur }} / {{ value | signedEur: 0 }}. */
@Pipe({ name: 'signedEur' })
export class SignedEurPipe implements PipeTransform {
  transform(value: number | null | undefined, decimals = 2): string {
    return signedEur(value, decimals);
  }
}
