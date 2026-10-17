/*
 * Voorraad boeken: the one model behind every stock booking by hand (a
 * recount, damaged or short pieces, a demo, a move between locations). The
 * sheet, the product pages and the Voorraad page read their words, preview
 * and readiness from here, so the five places that booked stock before can
 * never drift apart again. Pure and import-free: node-tested.
 */

/** The five ways stock changes by hand. */
export type BookingKind = 'RECOUNT' | 'DAMAGED' | 'SHORTAGE' | 'DEMO' | 'TRANSFER';

/** One location of the product, with what lies there now. */
export interface BookingLevel {
  locationId: number;
  name: string;
  quantity: number;
}

/** What the sheet holds while it is being filled in. */
export interface BookingDraft {
  kind: BookingKind;
  /** The location booked on; for a move, where the pieces leave ("Van"). */
  locationId: number | null;
  /** Only for a move: where the pieces go ("Naar"). */
  toLocationId: number | null;
  /** The counted figure for a recount, else how many; null while the field is empty or invalid. */
  quantity: number | null;
  note: string;
  /** The received container a damage or shortage report points at. */
  containerId: number | null;
}

export interface BookingKindOption {
  kind: BookingKind;
  label: string;
  icon: string;
}

const KINDS: readonly BookingKindOption[] = [
  { kind: 'RECOUNT', label: 'Hertelling', icon: 'refresh' },
  { kind: 'DAMAGED', label: 'Beschadigd', icon: 'alert' },
  { kind: 'SHORTAGE', label: 'Te weinig', icon: 'arrow-out' },
  { kind: 'DEMO', label: 'Demo', icon: 'tag' },
  { kind: 'TRANSFER', label: 'Verplaatsen', icon: 'move' },
];

/** The kinds the sheet offers: a move only where there is somewhere to move to. */
export function bookingKinds(locationCount: number): BookingKindOption[] {
  return KINDS.filter((option) => option.kind !== 'TRANSFER' || locationCount >= 2);
}

export function bookingKindLabel(kind: BookingKind): string {
  return KINDS.find((option) => option.kind === kind)?.label ?? 'Hertelling';
}

/**
 * A count typed by hand: whole and not negative. Dutch thousands are fine
 * ("1.000", "1 000"); anything else (empty, letters, a minus, a decimal,
 * "1e3") is no count at all, so the caller books nothing.
 */
export function parseCount(raw: string | number | null | undefined): number | null {
  if (typeof raw === 'number') return Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
  const text = (raw ?? '').trim();
  if (!text) return null;
  let digits: string | null = null;
  if (/^\d+$/.test(text)) digits = text;
  else if (/^\d{1,3}(?:[.   ]\d{3})+$/.test(text)) digits = text.replace(/[.   ]/g, '');
  if (digits === null) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

/** What a typed cell on the Voorraad page means: put the old figure back, nothing, or book this count. */
export type StockCellEdit = { action: 'revert' } | { action: 'none' } | { action: 'book'; quantity: number };

export function stockCellEdit(raw: string, before: number): StockCellEdit {
  const quantity = parseCount(raw);
  if (quantity === null) return { action: 'revert' };
  if (quantity === before) return { action: 'none' };
  return { action: 'book', quantity };
}

/** Undo puts the old figure back only while the figure is still the one that was booked. */
export function undoAllowed(current: number | null | undefined, booked: number): boolean {
  return current === booked;
}

/** The sheet's own explanation per kind, in the product's unit ("bowls"), never "stuks" for everything. */
export function bookingHelp(kind: BookingKind, units: string): string {
  switch (kind) {
    case 'RECOUNT': return 'Tel wat er ligt; het verschil boekt als correctie.';
    case 'DAMAGED': return `Stuk of beschadigd: de ${units} gaan uit de voorraad, met een notitie waarom. Kwam het zo uit een container, koppel die dan.`;
    case 'SHORTAGE': return `Te weinig geleverd: minder in de dozen dan de paklijst zei. De ${units} gaan uit de voorraad en de container hoort het.`;
    case 'DEMO': return 'Weggegeven als demo: uit de voorraad, nooit verkocht.';
    default: return 'Van de ene locatie naar de andere; het totaal blijft gelijk.';
  }
}

/** The primary button. */
export function bookingLabel(kind: BookingKind): string {
  switch (kind) {
    case 'RECOUNT': return 'Boek hertelling';
    case 'DAMAGED': return 'Boek beschadigd';
    case 'SHORTAGE': return 'Boek tekort';
    case 'DEMO': return 'Boek demo';
    default: return 'Verplaatsen';
  }
}

export function bookingNotePlaceholder(kind: BookingKind): string {
  switch (kind) {
    case 'RECOUNT': return 'bijv. telling na inventaris';
    case 'DAMAGED': return 'bijv. gebarsten bij het uitpakken';
    case 'SHORTAGE': return 'bijv. doos 12 bevatte 18 in plaats van 24';
    case 'DEMO': return 'bijv. klant Janssens';
    default: return 'bijv. bus van maandag';
  }
}

/** Only damage and shortage can be reported on a container. */
export function bookingNeedsContainer(kind: BookingKind): boolean {
  return kind === 'DAMAGED' || kind === 'SHORTAGE';
}

/** The location a fresh sheet opens on: the asked one, else the first with stock, else the first. */
export function defaultBookingLocation(levels: readonly BookingLevel[], asked?: number | null): number | null {
  if (asked != null && levels.some((level) => level.locationId === asked)) return asked;
  return (levels.find((level) => level.quantity > 0) ?? levels[0])?.locationId ?? asked ?? null;
}

/** "Naar" defaults to the first other location. */
export function defaultTargetLocation(levels: readonly BookingLevel[], from: number | null): number | null {
  return levels.find((level) => level.locationId !== from)?.locationId ?? null;
}

/** A fresh draft: a recount starts on the figure that lies there, the others on an empty field. */
export function newBookingDraft(kind: BookingKind, levels: readonly BookingLevel[], locationId?: number | null): BookingDraft {
  const from = defaultBookingLocation(levels, locationId);
  return {
    kind,
    locationId: from,
    toLocationId: kind === 'TRANSFER' ? defaultTargetLocation(levels, from) : null,
    quantity: kind === 'RECOUNT' ? levels.find((level) => level.locationId === from)?.quantity ?? null : null,
    note: '',
    containerId: null,
  };
}

/** Switching the kind keeps the location and note; a recount refills its count, the others keep theirs. */
export function switchBookingKind(draft: BookingDraft, kind: BookingKind, levels: readonly BookingLevel[]): BookingDraft {
  const level = levels.find((item) => item.locationId === draft.locationId);
  return {
    ...draft,
    kind,
    quantity: kind === 'RECOUNT' ? level?.quantity ?? null : draft.kind === 'RECOUNT' ? null : draft.quantity,
    toLocationId: kind === 'TRANSFER'
      ? (draft.toLocationId !== null && draft.toLocationId !== draft.locationId ? draft.toLocationId : defaultTargetLocation(levels, draft.locationId))
      : null,
    containerId: bookingNeedsContainer(kind) ? draft.containerId : null,
  };
}

export interface BookingPreview {
  /** change: the figure moves; same: a recount on the same figure; short: more than lies there; move: two locations change. */
  state: 'change' | 'same' | 'short' | 'move';
  location: string;
  before: number;
  after: number;
  delta: number;
  /** Only for a move: the location that receives. */
  to: { location: string; before: number; after: number } | null;
}

function levelOf(levels: readonly BookingLevel[], locationId: number | null): BookingLevel | null {
  return levels.find((level) => level.locationId === locationId) ?? null;
}

/** What the booking does, before anything is saved; null while there is no figure. */
export function bookingPreview(draft: BookingDraft, levels: readonly BookingLevel[], fallbackBefore = 0): BookingPreview | null {
  if (draft.quantity === null) return null;
  const level = levelOf(levels, draft.locationId);
  const location = level?.name ?? 'Voorraad';
  const before = level?.quantity ?? fallbackBefore;
  if (draft.kind === 'RECOUNT') {
    const delta = draft.quantity - before;
    return { state: delta === 0 ? 'same' : 'change', location, before, after: draft.quantity, delta, to: null };
  }
  const after = before - draft.quantity;
  if (after < 0) return { state: 'short', location, before, after, delta: -draft.quantity, to: null };
  if (draft.kind === 'TRANSFER') {
    const target = levelOf(levels, draft.toLocationId);
    if (!target || target.locationId === draft.locationId) return null;
    return {
      state: 'move', location, before, after, delta: -draft.quantity,
      to: { location: target.name, before: target.quantity, after: target.quantity + draft.quantity },
    };
  }
  return { state: draft.quantity === 0 ? 'same' : 'change', location, before, after, delta: -draft.quantity, to: null };
}

/** The primary stays off until the booking changes something that can change. */
export function bookingReady(draft: BookingDraft, levels: readonly BookingLevel[], fallbackBefore = 0): boolean {
  const preview = bookingPreview(draft, levels, fallbackBefore);
  if (!preview || draft.quantity === null) return false;
  if (draft.kind === 'RECOUNT') return preview.state === 'change';
  if (!(draft.quantity > 0) || preview.state === 'short') return false;
  if (draft.kind === 'TRANSFER') return preview.state === 'move';
  return true;
}

export interface BookingToastInput {
  kind: BookingKind;
  delta: number;
  quantity: number;
  location: string;
  /** The container the report landed on, by its name (containerName()). */
  container: string | null;
  toLocation: string | null;
  unit: { singular: string; plural: string };
}

/** The host's toast after a booking. */
export function bookingToast(input: BookingToastInput): string {
  const on = input.container ? ` · gemeld op ${input.container}` : '';
  switch (input.kind) {
    case 'RECOUNT': return `Hertelling geboekt: ${input.delta > 0 ? '+' : ''}${input.delta.toLocaleString('nl-BE')} op ${input.location}`;
    case 'DAMAGED': return `Beschadigd geboekt${on}`;
    case 'SHORTAGE': return `Tekort geboekt${on}`;
    case 'DEMO': return 'Demo geboekt';
    default: return `${input.quantity.toLocaleString('nl-BE')} ${input.quantity === 1 ? input.unit.singular : input.unit.plural} naar ${input.toLocation ?? 'de andere locatie'}`;
  }
}

/** "20/12/2026" from "2026-12-20"; the text itself when it is no date. */
export function dayLabel(day: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day ?? '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : (day ?? '');
}

/** A container in the "Uit welke container?" list: "{naam} · ontvangen 20/12/2026". */
export function containerOptionLabel(container: { name: string; receivedOn: string | null }): string {
  return container.receivedOn ? `${container.name} · ontvangen ${dayLabel(container.receivedOn)}` : container.name;
}
