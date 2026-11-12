import type {
  PartnerContainer, PartnerContainerLine, PartnerContainerState, PartnerContainerTotals, PartnerProductSpec, PartnerSize,
} from '../../core/api/partner-portal-api';
/* agenda-days is pure and import-free (its header says so and it is node-tested that way): only day math comes along. */
import { addDaysIso, monthCells, shiftMonthIso, weekdayMon0 } from '../dashboard/agenda-days';
import { count } from './partner-format';
import { safeColour } from './partner-photo';
import { stockFigure } from './partner-units';

/**
 * The partner's containers screen, pure: the state words, the arrival day
 * and its words, the progress from leaving to arriving, the calendar month
 * with its chips, and a container's products grouped by category and
 * family. Never a price, amount or supplier: the server sends none, and
 * nothing here makes one up.
 *
 * The state rule is the ERP's one (shared/product-incoming): Aangekomen once
 * received; Besteld while it has not left, however near its date; Binnenkort
 * when it has left and its date lies within 14 days either side; else
 * Onderweg. The server sends the word (`state`); an older answer without it
 * is read with the same rule here.
 */

export const SOON_DAYS = 14;
/** A received container drops behind "Ook oude containers" after this many days. */
export const OLD_DAYS = 60;

export const STATE_WORD: Readonly<Record<PartnerContainerState, string>> = {
  BESTELD: 'Besteld', ONDERWEG: 'Onderweg', BINNENKORT: 'Binnenkort', AANGEKOMEN: 'Aangekomen',
};

/** Four tones that tell the words apart at a glance: not left yet grey, at sea blue, nearly here teal, in green. */
export const STATE_TONE: Readonly<Record<PartnerContainerState, string>> = {
  BESTELD: 'tone-grey', ONDERWEG: 'tone-blue', BINNENKORT: 'tone-teal', AANGEKOMEN: 'tone-green',
};

const RANK: Readonly<Record<PartnerContainerState, number>> = { AANGEKOMEN: 0, BINNENKORT: 1, ONDERWEG: 2, BESTELD: 3 };

const WEEKDAYS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const MONTHS_LONG = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

const DECIMAL_1 = new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 1 });
const DECIMAL_2 = new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 2 });

function isDay(value: string | null | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}/.test(value);
}

function day10(value: string): string {
  return value.slice(0, 10);
}

/** Whole days from a to b (b later is positive). */
export function daysBetween(a: string, b: string): number {
  const ms = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

/* ------------------------------------------------------------------ state and days */

export function stateOf(container: PartnerContainer, today: string): PartnerContainerState {
  if (container.state && container.state in STATE_WORD) return container.state;
  if (container.status === 'ONTVANGEN') return 'AANGEKOMEN';
  const departed = container.status === 'ONDERWEG' || (isDay(container.shippedOn) && day10(container.shippedOn) <= today);
  if (!departed) return 'BESTELD';
  const date = container.expectedArrival;
  return isDay(date) && date >= addDaysIso(today, -SOON_DAYS) && date <= addDaysIso(today, SOON_DAYS) ? 'BINNENKORT' : 'ONDERWEG';
}

export function isReceived(container: PartnerContainer): boolean {
  return container.status === 'ONTVANGEN';
}

/** Received (or put away) long ago: behind "Ook oude containers". */
export function isOld(container: PartnerContainer, today: string): boolean {
  if (typeof container.old === 'boolean') return container.old;
  if (!isReceived(container)) return false;
  return !isDay(container.receivedOn) || day10(container.receivedOn) < addDaysIso(today, -OLD_DAYS);
}

/** The day the calendar puts it on: the receipt once received, else the expected arrival. */
export function calendarDay(container: PartnerContainer): string | null {
  const value = isReceived(container) ? container.receivedOn : container.expectedArrival;
  return isDay(value) ? day10(value) : null;
}

/** Not received and its expected day has passed. */
export function isLate(container: PartnerContainer, today: string): boolean {
  return !isReceived(container) && isDay(container.expectedArrival) && day10(container.expectedArrival) < today;
}

/** Comes first in "Komt eraan": a date that can still hold, the earliest first; then the ones without, longest overdue first. */
function arrivalKey(container: PartnerContainer, today: string): string {
  const state = stateOf(container, today);
  if (state === 'AANGEKOMEN') return '0';
  const date = isDay(container.expectedArrival) ? day10(container.expectedArrival) : null;
  const due = container.due !== undefined ? container.due : date && (date >= today || state === 'BINNENKORT') ? date : null;
  return due ? `1${due}${RANK[state]}` : `2${RANK[state]}${date ?? '9'}`;
}

/** What is still coming (not received), the nearest arrival first. */
export function upcoming(containers: readonly PartnerContainer[], today: string): PartnerContainer[] {
  return containers
    .filter((container) => !isReceived(container))
    .map((container) => ({ container, key: arrivalKey(container, today) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.container.id - b.container.id))
    .map((item) => item.container);
}

/* ------------------------------------------------------------------ words */

/** "do 20 nov", with the year when it is not this year: "di 4 nov 2025". */
export function dayText(iso: string | null | undefined, today: string): string {
  if (!isDay(iso)) return '';
  const value = day10(iso);
  const text = `${WEEKDAYS[weekdayMon0(value)]} ${Number(value.slice(8, 10))} ${MONTHS[Number(value.slice(5, 7)) - 1]}`;
  return value.slice(0, 4) === today.slice(0, 4) ? text : `${text} ${value.slice(0, 4)}`;
}

/** "12/11". */
export function shortDay(iso: string | null | undefined): string {
  return isDay(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '';
}

/** "November 2026". */
export function monthTitle(month: string): string {
  const name = MONTHS_LONG[Number(month.slice(5, 7)) - 1] ?? '';
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${month.slice(0, 4)}`;
}

/** "vandaag", "morgen", "over 8 dagen". */
function relative(iso: string, today: string): string {
  const days = daysBetween(today, iso);
  if (days === 0) return 'vandaag';
  if (days === 1) return 'morgen';
  return `over ${days} dagen`;
}

export interface ArrivalWords {
  /** "± do 20 nov", "ma 3 nov" (received), "datum nog open". */
  main: string;
  /** "over 8 dagen", "nog niet binnen", "aangekomen". */
  sub: string;
  /** Not received while its day has passed: amber. */
  late: boolean;
  /** "verschoven (was 12/11)" when tracking moved it. */
  moved: string | null;
}

export function arrivalWords(container: PartnerContainer, today: string): ArrivalWords {
  const moved = !isReceived(container) && isDay(container.arrivalMovedFrom) ? `verschoven (was ${shortDay(container.arrivalMovedFrom)})` : null;
  if (isReceived(container)) {
    return { main: isDay(container.receivedOn) ? dayText(container.receivedOn, today) : 'aangekomen', sub: isDay(container.receivedOn) ? 'aangekomen' : '', late: false, moved: null };
  }
  if (!isDay(container.expectedArrival)) return { main: 'datum nog open', sub: '', late: false, moved };
  const date = day10(container.expectedArrival);
  const late = date < today;
  return { main: `± ${dayText(date, today)}`, sub: late ? 'nog niet binnen' : relative(date, today), late, moved };
}

/** "± do 20 nov · over 8 dagen" in one line (Komt eraan). */
export function arrivalLine(container: PartnerContainer, today: string): string {
  const words = arrivalWords(container, today);
  return words.sub && !isReceived(container) ? `${words.main} · ${words.sub}` : words.main;
}

/**
 * From leaving (or ordering) to the expected arrival, 0-100: the thin bar under a coming container. Null without
 * an expected date; 100 once the day has passed.
 */
export function progressOf(container: PartnerContainer, today: string): number | null {
  if (isReceived(container)) return 100;
  if (!isDay(container.expectedArrival)) return null;
  const end = day10(container.expectedArrival);
  if (end <= today) return 100;
  const startValue = isDay(container.shippedOn) ? container.shippedOn : isDay(container.orderDate) ? container.orderDate : null;
  if (!startValue) return 0;
  const start = day10(startValue);
  const span = daysBetween(start, end);
  if (span <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((daysBetween(start, today) / span) * 100)));
}

/* ------------------------------------------------------------------ figures */

/** "1,08", "61,3": two decimals under 10 m³, one above. */
export function cbmNumber(value: number | null | undefined): string {
  const n = Number(value) || 0;
  return (n >= 10 ? DECIMAL_1 : DECIMAL_2).format(n);
}

export function cbmText(value: number | null | undefined): string {
  return `${cbmNumber(value)} m³`;
}

export function fillText(value: number | null | undefined): string {
  return value == null ? '' : `${DECIMAL_1.format(value)} % vol`;
}

export function kgText(value: number | null | undefined): string {
  if (value == null) return '';
  return `${DECIMAL_2.format(value >= 100 ? Math.round(value) : value)} kg`;
}

/** "± 24 pallets", "± 1 pallet"; empty when nothing could be counted. */
export function palletsText(value: number | null | undefined): string {
  if (value == null) return '';
  return `± ${count(value)} ${value === 1 ? 'pallet' : 'pallets'}`;
}

/** "75 dozen", "1 doos". */
export function cartonsText(value: number | null | undefined): string {
  const n = Number(value) || 0;
  return `${count(n)} ${n === 1 ? 'doos' : 'dozen'}`;
}

export function productsText(value: number | null | undefined): string {
  const n = Number(value) || 0;
  return `${count(n)} ${n === 1 ? 'product' : 'producten'}`;
}

/** "40HQ · ± 24 pallets · 61 m³" (Komt eraan). */
export function cargoLine(container: PartnerContainer): string {
  const totals = container.totals;
  return [container.containerType, palletsText(totals?.pallets), totals ? cbmText(totals.cbm) : ''].filter(Boolean).join(' · ');
}

/** "24 × 24 × 24 cm"; empty without a size. */
export function sizeText(size: PartnerSize | null | undefined): string {
  if (!size || size.b == null || size.d == null || size.h == null) return '';
  return `${DECIMAL_1.format(size.b)} × ${DECIMAL_1.format(size.d)} × ${DECIMAL_1.format(size.h)} cm`;
}

/** "16 bowls per doos · 6 kg". */
export function cartonContentText(spec: PartnerProductSpec | undefined): string {
  if (!spec) return '';
  const n = spec.unitsPerCarton;
  const content = n && n > 0 ? `${count(n)} ${n === 1 ? spec.unitOne : spec.unitOther} per doos` : '';
  return [content, kgText(spec.cartonWeightKg)].filter(Boolean).join(' · ');
}

const PACKAGING_WORD: Record<string, string> = { GIFT_BOX: 'geschenkverpakking', DISPLAY: 'display' };

/** "Geschenkverpakking 12 × 12 × 10 cm", "display"; empty without packaging. */
export function packagingText(spec: PartnerProductSpec | undefined): string {
  const word = spec?.packagingKind ? PACKAGING_WORD[spec.packagingKind] : undefined;
  if (!word) return '';
  return [word, sizeText(spec!.packagingCm)].filter(Boolean).join(' ');
}

/** The product's own specification in one line: "10 × 10 × 8 cm · 0,25 kg · display 12 × 12 × 10 cm". */
export function productSpecText(spec: PartnerProductSpec | undefined): string {
  if (!spec) return '';
  return [sizeText(spec.productCm), kgText(spec.productWeightKg), packagingText(spec)].filter(Boolean).join(' · ');
}

/** "± 48 dozen per pallet" (the europallet estimate); empty when unknown. */
export function perPalletText(spec: PartnerProductSpec | undefined): string {
  const n = spec?.cartonsPerPallet;
  return n && n > 0 ? `± ${count(n)} ${n === 1 ? 'doos' : 'dozen'} per pallet` : '';
}

/** Totals in one Lading cell: "2 producten · 75 dozen", "1,08 m³ · 1,6 % vol". */
export function loadLines(totals: PartnerContainerTotals): { first: string; second: string } {
  const cbm = (totals.cbmUnknown ? '± ' : '') + cbmText(totals.cbm);
  return {
    first: [productsText(totals.products), cartonsText(totals.cartons)].join(' · '),
    second: [cbm, fillText(totals.fillPercent)].filter(Boolean).join(' · '),
  };
}

/** A product that is gone from the catalogue still reads as itself. */
export function specOrFallback(spec: PartnerProductSpec | undefined, productId: number): PartnerProductSpec {
  return spec ?? {
    productId, sku: null, name: `Product #${productId}`, variant: null, colourHex: null, familyId: null, familyName: null,
    unitOne: 'stuk', unitOther: 'stuks', piecesPerUnit: 1, hasPhoto: false, photoVersion: null, categoryId: null,
    categoryName: null, colour: null, variantSize: null, productCm: null, productWeightKg: null, packagingKind: null,
    packagingCm: null, unitsPerCarton: null, cartonCm: null, cartonWeightKg: null, cartonsPerPallet: null,
  };
}

/**
 * A line's Aantal in the product's default unit with the pieces beside it ("2 omdozen" "= 48 stolpen"); a round-1
 * tile (no count units) still shows the server's pieces when they differ from the sales units.
 */
export function lineFigure(line: PartnerContainerLine, spec: PartnerProductSpec): { main: string; sub: string | null } {
  const figure = stockFigure(spec, line.quantity);
  if (line.pieces > 0 && figure.pieces !== line.pieces) {
    return { main: figure.main, sub: `= ${count(line.pieces)} ${spec.pieceOther || 'stuks'}` };
  }
  return { main: figure.main, sub: figure.sub };
}

/* ------------------------------------------------------------------ products grouped */

export interface LineRow {
  line: PartnerContainerLine;
  spec: PartnerProductSpec;
}

export interface LineGroup {
  key: string;
  /** "Acryl · Rozenstolp"; "Acryl" for products without a family. */
  label: string;
  rows: LineRow[];
  /** The colours in the group (at most 8), for the swatches beside the label. */
  swatches: string[];
}

/** A container's products grouped by category, then family, in the server's product order. */
export function lineGroups(container: PartnerContainer, specs: ReadonlyMap<number, PartnerProductSpec>,
    order: ReadonlyMap<number, number>): LineGroup[] {
  const lines = [...container.lines].sort((a, b) => (order.get(a.productId) ?? 1e9) - (order.get(b.productId) ?? 1e9) || a.productId - b.productId);
  const groups: LineGroup[] = [];
  const byKey = new Map<string, LineGroup>();
  for (const line of lines) {
    const spec = specOrFallback(specs.get(line.productId), line.productId);
    const category = spec.categoryName?.trim() || '';
    const family = spec.familyId != null ? spec.familyName?.trim() || spec.name : '';
    const key = `${spec.categoryId ?? 'x'}|${spec.familyId ?? 'x'}`;
    let group = byKey.get(key);
    if (!group) {
      const label = [category, family].filter(Boolean).join(' · ') || 'Andere producten';
      group = { key, label, rows: [], swatches: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.rows.push({ line, spec });
    const colour = safeColour(spec.colourHex);
    if (colour && group.swatches.length < 8 && !group.swatches.includes(colour)) group.swatches.push(colour);
  }
  return groups;
}

/* ------------------------------------------------------------------ calendar */

export interface CalendarChip {
  id: number;
  name: string;
  /** "PO-011" for a number of this year (a narrow day cell), else the name. */
  short: string;
  tone: string;
  word: string;
  own: boolean;
  late: boolean;
}

export interface CalendarCell {
  key: string;
  label: number;
  inMonth: boolean;
  today: boolean;
  past: boolean;
  weekend: boolean;
  chips: CalendarChip[];
}

/** The Monday-first month grid (only the weeks it needs) with each container on its arrival day. */
export function calendarCells(month: string, containers: readonly PartnerContainer[], today: string): CalendarCell[] {
  const byDay = new Map<string, CalendarChip[]>();
  for (const container of containers) {
    const date = calendarDay(container);
    if (!date) continue;
    const state = stateOf(container, today);
    const chip: CalendarChip = { id: container.id, name: container.name, short: shortName(container.name, today), tone: STATE_TONE[state], word: STATE_WORD[state],
      own: container.own, late: isLate(container, today) };
    const list = byDay.get(date);
    if (list) list.push(chip); else byDay.set(date, [chip]);
  }
  return monthCells(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 'fit').map((cell) => ({
    key: cell.key, label: cell.label, inMonth: cell.inMonth, today: cell.date === today, past: cell.date < today,
    weekend: weekdayMon0(cell.date) >= 5, chips: byDay.get(cell.date) ?? [],
  }));
}

/** "PO-2026-011" -> "PO-011" when it is this year's number; any other name stays. */
export function shortName(name: string, today: string): string {
  const match = /^PO-(\d{4})-(\d+)$/.exec(name);
  return match && match[1] === today.slice(0, 4) ? `PO-${match[2]}` : name;
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function nextMonth(month: string, step: number): string {
  return shiftMonthIso(month, step);
}

export const WEEKDAY_HEADS: readonly string[] = WEEKDAYS;
