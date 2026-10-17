/**
 * The periods of Analyses (redesign 2026-10-17, design §2.4).
 *
 * Verkoop and Resultaat share one period; Inkoop's Kwaliteit and
 * Afwijkingen have their own receipt period. A choice is a preset or two
 * dates; the dates of a preset are derived from today, so "Dit jaar" rolls
 * over at midnight and on 1 January. The URL carries the choice:
 * - Verkoop/Resultaat: ?periode=maand|kwartaal|vorigjaar|alle or ?van=&tot=
 *   ("jaar", the default, is omitted);
 * - Inkoop receipts: ?ontvangst=… or ?ovan=&otot=, and ?leverancier=<id>;
 * - Inkoop part: ?deel=kosten|kwaliteit|partners|afwijkingen; kosten is omitted
 *   unless an order focus is in the URL, because a bare ?orderId means afwijkingen.
 * Unknown values fall back to the default.
 *
 * Pure and import-free (node-tested, tests/analyses-period.test.mts).
 */

export type PeriodPreset = 'maand' | 'kwartaal' | 'jaar' | 'vorigjaar' | 'alle';
export type PeriodChoice = { preset: PeriodPreset } | { from: string; to: string };
/** Inclusive ISO days; '' is an open end. */
export interface PeriodRange { from: string; to: string }

export const PERIOD_PRESETS: readonly PeriodPreset[] = ['maand', 'kwartaal', 'jaar', 'vorigjaar', 'alle'];
export const DEFAULT_PERIOD: PeriodChoice = { preset: 'jaar' };

/** Which URL keys a period uses. */
export interface PeriodKeys { preset: string; from: string; to: string }
export const SALES_PERIOD_KEYS: PeriodKeys = { preset: 'periode', from: 'van', to: 'tot' };
export const RECEIPT_PERIOD_KEYS: PeriodKeys = { preset: 'ontvangst', from: 'ovan', to: 'otot' };

export type InkoopPart = 'kosten' | 'kwaliteit' | 'partners' | 'afwijkingen';
export const INKOOP_PARTS: readonly InkoopPart[] = ['kosten', 'kwaliteit', 'partners', 'afwijkingen'];

function isDay(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isPreset(value: string | null | undefined): value is PeriodPreset {
  return !!value && (PERIOD_PRESETS as readonly string[]).includes(value);
}

/** 1 January of today's year. */
export function yearStart(today: string): string {
  return `${today.slice(0, 4)}-01-01`;
}

/** The dates of a preset on a given day. */
export function presetRange(preset: PeriodPreset, today: string): PeriodRange {
  const year = today.slice(0, 4);
  switch (preset) {
    case 'maand': return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'kwartaal': {
      const month = Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1;
      return { from: `${year}-${String(month).padStart(2, '0')}-01`, to: today };
    }
    case 'jaar': return { from: `${year}-01-01`, to: today };
    case 'vorigjaar': {
      const last = String(Number(year) - 1);
      return { from: `${last}-01-01`, to: `${last}-12-31` };
    }
    case 'alle': return { from: '', to: '' };
  }
}

export function periodRange(choice: PeriodChoice, today: string): PeriodRange {
  return 'preset' in choice ? presetRange(choice.preset, today) : { from: choice.from, to: choice.to };
}

/** "Deze maand", "Dit kwartaal", "Dit jaar", "2025", "Alle jaren". */
export function presetLabel(preset: PeriodPreset, today: string): string {
  switch (preset) {
    case 'maand': return 'Deze maand';
    case 'kwartaal': return 'Dit kwartaal';
    case 'jaar': return 'Dit jaar';
    case 'vorigjaar': return String(Number(today.slice(0, 4)) - 1);
    case 'alle': return 'Alle jaren';
  }
}

/** The button text: the preset's name, or "Eigen periode" for two hand-picked dates. */
export function periodLabel(choice: PeriodChoice, today: string): string {
  return 'preset' in choice ? presetLabel(choice.preset, today) : 'Eigen periode';
}

export function samePeriod(left: PeriodChoice, right: PeriodChoice): boolean {
  if ('preset' in left || 'preset' in right) return 'preset' in left && 'preset' in right && left.preset === right.preset;
  return left.from === right.from && left.to === right.to;
}

/**
 * Two dates as a choice: both empty is "Alle jaren"; a reversed pair is
 * swapped so the range never comes out empty by accident.
 */
export function customPeriod(from: string, to: string): PeriodChoice {
  const start = isDay(from) ? from : '';
  const end = isDay(to) ? to : '';
  if (!start && !end) return { preset: 'alle' };
  if (start && end && start > end) return { from: end, to: start };
  return { from: start, to: end };
}

/** Reads a period from the URL; anything unknown gives the default. */
export function parsePeriod(get: (key: string) => string | null, keys: PeriodKeys, fallback: PeriodChoice = DEFAULT_PERIOD): PeriodChoice {
  const from = get(keys.from);
  const to = get(keys.to);
  if (isDay(from) || isDay(to)) return customPeriod(isDay(from) ? from : '', isDay(to) ? to : '');
  const preset = get(keys.preset);
  return isPreset(preset) ? { preset } : fallback;
}

/** The URL parameters of a period, every key present (null removes it) so a merge clears the old ones. */
export function periodParams(choice: PeriodChoice, keys: PeriodKeys): Record<string, string | null> {
  if ('preset' in choice) {
    return { [keys.preset]: choice.preset === 'jaar' ? null : choice.preset, [keys.from]: null, [keys.to]: null };
  }
  return { [keys.preset]: null, [keys.from]: choice.from || null, [keys.to]: choice.to || null };
}

/**
 * The Inkoop part from ?deel; without one, ?orderId means Afwijkingen (today's
 * deep link from a purchase order). An explicit part wins: the order focus
 * stays while he looks at another part, which simply ignores it.
 */
export function parsePart(get: (key: string) => string | null): InkoopPart {
  const part = get('deel');
  if (part && (INKOOP_PARTS as readonly string[]).includes(part)) return part as InkoopPart;
  return parseOrderId(get) !== null ? 'afwijkingen' : 'kosten';
}

/**
 * The ?deel of a part. Kosten, the default, is omitted, except with an order focus: a bare ?orderId reads as
 * Afwijkingen, so Containerkost must be written out to survive the round trip.
 */
export function partParams(part: InkoopPart, orderFocus = false): { deel: string | null } {
  return { deel: part === 'kosten' && !orderFocus ? null : part };
}

function positiveId(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** ?orderId: the one order Afwijkingen focuses on. */
export function parseOrderId(get: (key: string) => string | null): number | null {
  return positiveId(get('orderId'));
}

/** ?leverancier: the supplier of Kwaliteit and Afwijkingen. */
export function parseSupplier(get: (key: string) => string | null): number | null {
  return positiveId(get('leverancier'));
}

/**
 * The receipt period from the URL. A focused order (?orderId) looks over
 * all years unless the link names a period itself (today's deep link).
 */
export function parseReceiptPeriod(get: (key: string) => string | null): PeriodChoice {
  const fallback: PeriodChoice = parseOrderId(get) !== null ? { preset: 'alle' } : DEFAULT_PERIOD;
  return parsePeriod(get, RECEIPT_PERIOD_KEYS, fallback);
}
