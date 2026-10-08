import type { BookingCheck, CountLine, CountLineWrite, OpenDocument } from '../../core/api/inventory-models';

/**
 * The rules behind the count screen, without Angular.
 *
 * What a line is, what counts as "to count", how a difference reads and
 * which write goes to the server decide what lands in the stock ledger, so
 * they live here and not in a template. Pure and type-imports only, so node
 * tests it directly.
 */

const LOCALE = 'nl-BE';
const ZONE = 'Europe/Brussels';

const whole = (value: number) => value.toLocaleString(LOCALE);

/** "09:02", the Brussels time of an instant; empty when there is none. */
function timeText(instant: string | null): string {
  const at = instant ? new Date(instant) : null;
  if (!at || isNaN(at.getTime())) return '';
  return new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONE }).format(at);
}

export type CountLineState = 'TE_TELLEN' | 'KLOPT' | 'VERSCHIL_ZONDER_REDEN' | 'VERSCHIL_MET_REDEN';

export function lineState(line: CountLine): CountLineState {
  if (line.countedQuantity === null) return 'TE_TELLEN';
  if (!line.difference) return 'KLOPT';
  return line.reasonCode ? 'VERSCHIL_MET_REDEN' : 'VERSCHIL_ZONDER_REDEN';
}

export type CountChip = 'TE_TELLEN' | 'GETELD' | 'VERSCHILLEN' | 'GEWIJZIGD' | 'ALLES';

/** The chips in screen order; a full count opens on the first, a correction on the last. */
export const COUNT_CHIPS: readonly { key: CountChip; label: string }[] = [
  { key: 'TE_TELLEN', label: 'Te tellen' },
  { key: 'GETELD', label: 'Geteld' },
  { key: 'VERSCHILLEN', label: 'Verschillen' },
  { key: 'GEWIJZIGD', label: 'Gewijzigd' },
  { key: 'ALLES', label: 'Alles' },
];

const counted = (line: CountLine) => line.countedQuantity !== null;

/** A line of a zero-level product nobody touched is on the list but not part of the work. */
function inProgressTotal(line: CountLine): boolean {
  return counted(line) || line.liveQuantity !== 0 || (line.expectedQuantity ?? 0) !== 0 || line.addedByHand;
}

function onChip(line: CountLine, chip: CountChip): boolean {
  switch (chip) {
    /* Not counted yet, and either the system holds a figure or somebody added the line to count it. */
    case 'TE_TELLEN': return !counted(line) && (line.liveQuantity !== 0 || line.addedByHand);
    case 'GETELD': return counted(line);
    case 'VERSCHILLEN': return counted(line) && !!line.difference;
    case 'GEWIJZIGD': return line.moved;
    case 'ALLES': return true;
  }
}

/** Lower case without accents, so "cafe" finds "Café". */
function fold(text: string | null): string {
  return (text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase(LOCALE);
}

/** The lines of one chip that match every word of the search in their name or SKU. */
export function filterLines(lines: readonly CountLine[], chip: CountChip, query: string): CountLine[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return lines.filter((line) => {
    if (!onChip(line, chip)) return false;
    if (!words.length) return true;
    const haystack = `${fold(line.productName)} ${fold(line.sku)}`;
    return words.every((word) => haystack.includes(word));
  });
}

export const NO_CATEGORY = 'Zonder categorie';

export interface CountSection {
  category: string;
  lines: CountLine[];
  /** "{counted} / {total} geteld", with the total of countProgress. */
  counted: number;
  total: number;
}

/**
 * The given lines per category, categories by name with "Zonder categorie"
 * last. Inside a category variants of one family stay together: by family
 * id (products without a family after them), then by name.
 */
export function countSections(lines: readonly CountLine[]): CountSection[] {
  const byCategory = new Map<string, CountLine[]>();
  for (const line of lines) {
    const category = line.categoryName?.trim() || NO_CATEGORY;
    const bucket = byCategory.get(category);
    if (bucket) bucket.push(line);
    else byCategory.set(category, [line]);
  }
  const family = (line: CountLine) => line.familyId ?? Number.POSITIVE_INFINITY;
  return [...byCategory.entries()]
    .sort(([a], [b]) => Number(a === NO_CATEGORY) - Number(b === NO_CATEGORY) || a.localeCompare(b, LOCALE))
    .map(([category, bucket]) => {
      const sorted = [...bucket].sort((a, b) =>
        (family(a) === family(b) ? 0 : family(a) < family(b) ? -1 : 1)
        || a.productName.localeCompare(b.productName, LOCALE) || a.id - b.id);
      const progress = countProgress(sorted);
      return { category, lines: sorted, counted: progress.counted, total: progress.total };
    });
}

export interface CountProgress {
  counted: number;
  /** Lines that are counted, or have a live or expected quantity other than 0, or were added by hand. */
  total: number;
  differences: number;
  missingReasons: number;
}

export function countProgress(lines: readonly CountLine[]): CountProgress {
  const progress: CountProgress = { counted: 0, total: 0, differences: 0, missingReasons: 0 };
  for (const line of lines) {
    if (inProgressTotal(line)) progress.total++;
    const state = lineState(line);
    if (state === 'TE_TELLEN') continue;
    progress.counted++;
    if (state === 'KLOPT') continue;
    progress.differences++;
    if (state === 'VERSCHIL_ZONDER_REDEN') progress.missingReasons++;
  }
  return progress;
}

/** "klopt", "3 te weinig", "2 te veel". */
export function differenceText(difference: number): string {
  if (!difference) return 'klopt';
  return difference < 0 ? `${whole(-difference)} te weinig` : `${whole(difference)} te veel`;
}

export function bookingSummaryText(summary: BookingCheck['summary']): string {
  if (summary.lines === 0) return 'Je bevestigt dat hier niets ligt.';
  return `Je boekt ${whole(summary.lines)} regels: ${whole(summary.equal)} kloppen, `
    + `${whole(summary.short)} te weinig (-${whole(summary.shortUnits)}), `
    + `${whole(summary.over)} te veel (+${whole(summary.overUnits)}).`;
}

/**
 * The question after 409 REGEL_GEWIJZIGD: `line` is the server's current
 * line, `mine` the count this phone tried to save (null: it wiped the count).
 */
export function conflictText(line: CountLine, mine: number | null): string {
  const own = mine === null ? 'Jij wiste het aantal.' : `Jouw telling: ${whole(mine)}.`;
  /* The other phone wiped its count: the server keeps no name and no time then. */
  if (line.countedQuantity === null) return `Het aantal is hier intussen gewist. ${own}`;
  const time = timeText(line.countedAt);
  return `${line.countedByName ?? 'Iemand'} telde hier al ${whole(line.countedQuantity)}${time ? ` (${time})` : ''}. ${own}`;
}

/** Why a difference cannot be booked yet: the invoice or container that explains it is still open. */
export function openDocumentText(document: OpenDocument): string {
  return document.kind === 'FACTUUR'
    ? `Factuur ${document.number} (${whole(document.quantity)} stuks) is nog niet afgepunt.`
    : `Container ${document.number} (${whole(document.quantity)} stuks) is nog niet bijgeboekt.`;
}

/**
 * "Zelfde reden voor alle": one write per line with that line's own revision
 * and its unchanged count, so the server stores only the reason and the
 * difference of no line moves.
 */
export function sameReasonWrites(
  lines: readonly CountLine[], reasonCode: string, reasonNote: string | null,
): { lineId: number; write: CountLineWrite }[] {
  const note = reasonNote?.trim() || null;
  return lines.map((line) => ({
    lineId: line.id,
    write: { countedQuantity: line.countedQuantity, reasonCode, reasonNote: note, revision: line.revision },
  }));
}

/** "Ja, herreken het verschil": the same count against the level of now; the reason stays with a remaining difference. */
export function rebaseWrite(line: CountLine): CountLineWrite {
  return {
    countedQuantity: line.countedQuantity, reasonCode: line.reasonCode, reasonNote: line.reasonNote,
    revision: line.revision, rebase: true,
  };
}

/** "Klopt" saves the system figure, which the server refuses below zero. */
export function canConfirmEqual(line: CountLine): boolean {
  return line.liveQuantity >= 0;
}
