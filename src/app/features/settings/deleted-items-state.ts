import type { DeletedItemSummary, DeletedItemType, RestoredItem } from '../../core/api/deleted-items-api';

export const DELETED_ITEM_TYPES: { value: DeletedItemType | ''; label: string }[] = [
  { value: '', label: 'Alles' }, { value: 'INVOICE', label: 'Facturen' },
  { value: 'QUOTE', label: 'Offertes' }, { value: 'PURCHASE_ORDER', label: 'Inkooporders' },
];
export const deletedItemLabel = (type: DeletedItemType): string =>
  ({ INVOICE: 'Factuur', QUOTE: 'Offerte', PURCHASE_ORDER: 'Inkooporder' })[type];

export function deletedItemStatus(status: string): string {
  return ({ CONCEPT: 'Concept', UITGEREIKT: 'Uitgereikt', VERZONDEN: 'Verstuurd', BEKEKEN: 'Bekeken',
    GEACCEPTEERD: 'Geaccepteerd', AFGEWEZEN: 'Afgewezen', GEANNULEERD: 'Geannuleerd', VERLOPEN: 'Verlopen',
    BETAALD: 'Betaald', WIJZIGING_GEVRAAGD: 'Wijziging gevraagd', BESTELD: 'Besteld',
    PRODUCTIE: 'In productie', ONDERWEG: 'Onderweg', ONTVANGEN: 'Ontvangen', CALCULATIE: 'Calculatie',
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
