import type { DeletedItemSummary, DeletedItemType, RestoredItem } from '../../core/api/deleted-items-api';

export const DELETED_ITEM_TYPES: { value: DeletedItemType | ''; label: string }[] = [
  { value: '', label: 'Alles' }, { value: 'INVOICE', label: 'Facturen' }, { value: 'CREDIT_NOTE', label: 'Creditnota’s' },
  { value: 'QUOTE', label: 'Offertes' }, { value: 'PURCHASE_ORDER', label: 'Inkooporders' },
];
export const deletedItemLabel = (type: DeletedItemType): string =>
  ({ INVOICE: 'Factuur', QUOTE: 'Offerte', CREDIT_NOTE: 'Creditnota', PURCHASE_ORDER: 'Inkooporder' })[type];

export function deletedItemStatus(status: string): string {
  return ({ CONCEPT: 'Concept', UITGEREIKT: 'Uitgereikt', VERZONDEN: 'Verstuurd', BEKEKEN: 'Bekeken',
    GEACCEPTEERD: 'Geaccepteerd', AFGEWEZEN: 'Afgewezen', GEANNULEERD: 'Geannuleerd', VERLOPEN: 'Verlopen',
    BETAALD: 'Betaald', WIJZIGING_GEVRAAGD: 'Wijziging gevraagd', BESTELD: 'Besteld',
    PRODUCTIE: 'In productie', ONDERWEG: 'Vertrokken', ONTVANGEN: 'Ontvangen', CALCULATIE: 'Calculatie',
  } as Record<string, string>)[status] ?? status.replaceAll('_', ' ').toLowerCase();
}

const searchable = (value: string): string => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('nl');
export function filterDeletedItems(items: DeletedItemSummary[], query: string, type: DeletedItemType | ''): DeletedItemSummary[] {
  const words = searchable(query).trim().split(/\s+/).filter(Boolean);
  return items.filter(item => (!type || item.type === type)
    && words.every(word => searchable(`${item.number} ${item.partyName} ${deletedItemLabel(item.type)}`).includes(word)))
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || b.id - a.id);
}

/** Only the restored document's own internal route can be offered after success. */
export function restoredItemRoute(item: DeletedItemSummary, result: RestoredItem): string | null {
  if (!Number.isSafeInteger(result.sourceId) || result.sourceId <= 0 || result.sourceId !== item.sourceId) return null;
  const expected = `/${item.type === 'PURCHASE_ORDER' ? 'purchasing' : 'sales'}/${result.sourceId}`;
  return result.targetRoute === expected ? expected : null;
}

/** Use the snapshot's filename without path segments, control characters or reserved filename symbols. */
export function deletedAttachmentFilename(name: string): string {
  const filename = (name.split(/[\\/]/).at(-1) ?? '')
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[<>:"|?*]/g, '_').trim().replace(/^[. ]+|[. ]+$/g, '').slice(0, 240);
  return filename || 'bijlage';
}

/** How many items of each type (the chips), '' = all. */
export function countDeletedByType(items: readonly DeletedItemSummary[]): Record<DeletedItemType | '', number> {
  const counts: Record<DeletedItemType | '', number> = { '': items.length, INVOICE: 0, CREDIT_NOTE: 0, QUOTE: 0, PURCHASE_ORDER: 0 };
  for (const item of items) counts[item.type] = (counts[item.type] ?? 0) + 1;
  return counts;
}

/** Whole days until a restore deadline (0 on the last day, negative once past). */
export function daysLeft(expiresAt: string, now: Date = new Date()): number {
  const end = new Date(expiresAt).getTime();
  if (Number.isNaN(end)) return 0;
  return Math.floor((end - now.getTime()) / 86_400_000);
}

/** "nog 89 dagen", "nog 1 dag", "laatste dag". */
export function daysLeftText(days: number): string {
  if (days <= 0) return 'laatste dag';
  return `nog ${days} ${days === 1 ? 'dag' : 'dagen'}`;
}

const pad = (n: number) => String(n).padStart(2, '0');
const euro = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
const decimal = new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 6 });
let regionNames: Intl.DisplayNames | null = null;
function countryName(code: string): string | null {
  try {
    regionNames ??= new Intl.DisplayNames(['nl-BE'], { type: 'region' });
    const name = regionNames.of(code);
    return name && name !== code ? name : null;
  } catch { return null; }
}

/** A field label without the unit its value now carries: "Goederen (EUR)" → "Goederen". */
export function deletedFieldLabel(label: string): string {
  return label.replace(/\s*\((?:EUR|%)\)\s*$/i, '').trim() || label;
}

/**
 * A snapshot field as the screens show it (also for snapshots stored before
 * the backend formatted them): dates and instants in Belgian notation, euro
 * amounts, statuses in words, percentages, exchange rates as decimals and
 * the destination country by name.
 */
export function deletedFieldValue(label: string, value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw) return '—';
  if (/^status/i.test(label)) return deletedItemStatus(raw);
  if (/\(EUR\)\s*$/i.test(label) && /^-?\d+(\.\d+)?$/.test(raw)) return euro.format(Number(raw));
  if (/\(%\)\s*$/.test(label) && /^-?\d+(\.\d+)?$/.test(raw)) return `${decimal.format(Number(raw))} %`;
  if (/[A-Z]{3}\/[A-Z]{3}|wisselkoers/i.test(label) && /^-?\d+(\.\d+)?$/.test(raw)) return decimal.format(Number(raw));
  if (/^bestemming|land$/i.test(label) && /^[A-Z]{2}$/.test(raw)) {
    const name = countryName(raw);
    return name ? `${name} (${raw})` : raw;
  }
  const date = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (date) return `${date[3]}/${date[2]}/${date[1]}`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
    const at = new Date(raw);
    if (!Number.isNaN(at.getTime())) {
      return `${pad(at.getDate())}/${pad(at.getMonth() + 1)}/${at.getFullYear()}, ${pad(at.getHours())}:${pad(at.getMinutes())}`;
    }
  }
  return raw;
}

/** After "per": the singular ("€ 2,95 per stuk", never "per stuks"). */
export function perUnit(unit: string | null | undefined): string {
  const value = (unit ?? '').trim();
  if (!value) return 'eenheid';
  const singular: Record<string, string> = { stuks: 'stuk', displays: 'display', dozen: 'doos', sets: 'set', kartons: 'karton', diamanten: 'diamant' };
  return singular[value.toLowerCase()] ?? value;
}
