/**
 * Reading and writing the numbers of the closing fields, without Angular.
 *
 * An amount typed here goes straight into the acquisition value of the lots,
 * so a field is read the Belgian way and never guessed: the comma is the
 * decimal sign, a dot or a space only groups thousands. "12.500" is twelve
 * thousand five hundred, exactly as the screens print it; "12.5" is refused
 * instead of being read as twelve and a half. Pure, so node tests it directly.
 */

/** Ordinary, no-break and narrow no-break spaces, as people type them and as Intl prints them. */
const SPACES = /[\s  ]/g;

/** Whole part plain, or grouped per three by dots, or grouped per three by spaces; decimals after one comma. */
const BELGIAN = /^(-?)(\d+|\d{1,3}(?:\.\d{3})+|\d{1,3}(?: \d{3})+)(?:,(\d+))?$/;

/**
 * "12.500,50", "12 500,50", "12500,5" and "12500" as numbers; null when the
 * field is empty, NaN when it cannot be read without guessing ("12.5",
 * "1,234.50", "12,5,0", letters).
 */
export function parseDecimal(text: string): number | null {
  const raw = text.replace(SPACES, ' ').trim();
  if (!raw) return null;
  const match = BELGIAN.exec(raw);
  if (!match) return NaN;
  const whole = match[2].replace(/[. ]/g, '');
  return Number(`${match[1]}${whole}${match[3] ? `.${match[3]}` : ''}`);
}

/** What to say under a field that parseDecimal could not read; null when it could (or is empty). */
export function decimalError(text: string): string | null {
  const value = parseDecimal(text);
  if (value === null || !Number.isNaN(value)) return null;
  return 'Niet leesbaar. Schrijf decimalen met een komma en duizendtallen met een punt, bijvoorbeeld 12.500,50.';
}

/**
 * A number as a Belgian field shows it and as parseDecimal reads it back:
 * 12500 with two decimals becomes "12.500,00", 0.6812 "0,6812", 1045
 * "1.045". At least `minDecimals` and at most four decimals.
 */
export function decimalText(value: number | null | undefined, minDecimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  const [whole, fraction = ''] = Math.abs(value).toFixed(4).split('.');
  let decimals = fraction.replace(/0+$/, '');
  while (decimals.length < minDecimals) decimals += '0';
  const grouped = whole.replace(/\B(?=(\d{3})+$)/g, '.');
  const sign = value < 0 && (Number(whole) > 0 || decimals.replace(/0/g, '') !== '') ? '-' : '';
  return `${sign}${grouped}${decimals ? `,${decimals}` : ''}`;
}
