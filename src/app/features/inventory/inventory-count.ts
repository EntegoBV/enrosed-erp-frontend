import type { BookingCheck, CountLine, CountLineWrite, CountView, OpenDocument } from '../../core/api/inventory-models';

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
const counted1 = (value: number, one: string, many: string) => `${whole(value)} ${value === 1 ? one : many}`;

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
        /* Numbers in a name in their own order: "Rose Bear 25 cm" before "Rose Bear 100 cm", as on the shelf. */
        || a.productName.localeCompare(b.productName, LOCALE, { numeric: true }) || a.id - b.id);
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
  return `Je boekt ${counted1(summary.lines, 'regel', 'regels')}: ${counted1(summary.equal, 'klopt', 'kloppen')}, `
    + `${whole(summary.short)} te weinig (-${whole(summary.shortUnits)}), `
    + `${whole(summary.over)} te veel (+${whole(summary.overUnits)}).`;
}

/**
 * The reasons that fit the direction of a difference: nobody "finds back" a
 * shortage, and a surplus was not lost, broken or given away. A reason this
 * screen does not know stays on both lists, and without a direction (the same
 * reason for lines that go both ways) every reason is offered.
 */
const SHORTAGE_ONLY: ReadonlySet<string> = new Set(['BESCHADIGD', 'NIET_GEVONDEN', 'DEMO']);
const SURPLUS_ONLY: ReadonlySet<string> = new Set(['TERUGGEVONDEN']);

export function reasonsFor<T extends { code: string }>(reasons: readonly T[], differences: readonly (number | null)[]): T[] {
  const short = differences.some((difference) => (difference ?? 0) < 0);
  const over = differences.some((difference) => (difference ?? 0) > 0);
  if (short === over) return [...reasons];
  const hidden = short ? SURPLUS_ONLY : SHORTAGE_ONLY;
  return reasons.filter((reason) => !hidden.has(reason.code));
}

/**
 * The way out under an open invoice or container, by what is open: an
 * invoice is afgepunt, a container bijgeboekt.
 */
export function openDocumentHint(documents: readonly OpenDocument[]): string {
  const invoices = documents.some((document) => document.kind === 'FACTUUR');
  const containers = documents.some((document) => document.kind !== 'FACTUUR');
  const action = invoices && containers ? 'Punt dan eerst de factuur af en boek de container bij'
    : containers ? 'Boek dan eerst de container bij' : 'Punt dan eerst de factuur af';
  return `Zijn dit die stuks? ${action}; het verschil verdwijnt dan uit de telling.`;
}

/**
 * A whole-session answer against what is on screen. A reload can be older
 * than a save that answered while it was under way: per line the higher
 * revision stays, and a line added here meanwhile is kept. A session that
 * this screen already knows as booked or cancelled never goes back to open:
 * the older answer loses, lines and all.
 */
export function mergeCountView(current: CountView | null, fresh: CountView): CountView {
  if (!current || current.id !== fresh.id) return fresh;
  if (current.status !== 'OPEN' && fresh.status === 'OPEN') return current;
  const mine = new Map(current.lines.map((line) => [line.id, line]));
  const lines = fresh.lines.map((line) => {
    const local = mine.get(line.id);
    mine.delete(line.id);
    return local && local.revision > line.revision ? local : line;
  });
  return { ...fresh, lines: [...lines, ...mine.values()] };
}

/**
 * The lines another phone counted while this one was typing in them: lines
 * with a draft here that the fresh answer shows as counted and this screen
 * still showed as open. Their typed number becomes the conflict question
 * instead of vanishing with the field.
 */
export function overtakenDrafts(
  current: CountView | null, fresh: CountView, drafts: Readonly<Record<number, string>>,
): { line: CountLine; draft: string }[] {
  if (!current || current.id !== fresh.id) return [];
  const open = new Map(current.lines.filter((line) => line.countedQuantity === null).map((line) => [line.id, line.revision]));
  return fresh.lines
    .filter((line) => line.countedQuantity !== null && line.revision > (open.get(line.id) ?? Number.POSITIVE_INFINITY)
      && (drafts[line.id] ?? '').trim() !== '')
    .map((line) => ({ line, draft: drafts[line.id].trim() }));
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
