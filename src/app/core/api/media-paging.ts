/**
 * Reading a whole media list page by page. The server hands out at most 200
 * assets per request, whatever limit is asked for, so a caller that needs
 * "every attachment of every cost" walks the offsets until a short page
 * says the end is reached. Pure and import-free: node-tested.
 */

/** The server caps `limit` at this; asking for more still returns 200. */
export const MEDIA_PAGE_SIZE = 200;

export interface CollectedPages<T> {
  items: T[];
  /** False when `max` cut the list short: there may be more on the server. */
  complete: boolean;
}

/**
 * Fetches pages of `pageSize` until one comes back short or `max` items are
 * collected. Offsets advance by what each page really returned, and ids seen
 * before are skipped, so a list that shifts while it is read (an upload in
 * between) neither loses nor doubles an asset. The first failure is passed on.
 */
export async function collectPages<T extends { id: number }>(
  fetchPage: (offset: number, limit: number) => Promise<readonly T[]>,
  options: { pageSize: number; max: number },
): Promise<CollectedPages<T>> {
  const { pageSize, max } = options;
  const items: T[] = [];
  const seen = new Set<number>();
  const rounds = Math.ceil(max / pageSize) + 2;
  let offset = 0;
  for (let round = 0; round < rounds; round++) {
    const page = await fetchPage(offset, pageSize);
    for (const item of page) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
    if (items.length >= max) {
      return { items: items.slice(0, max), complete: page.length < pageSize && items.length === max };
    }
    if (page.length < pageSize) return { items, complete: true };
    offset += page.length;
  }
  /* The guard only trips when pages keep repeating ids: stop rather than spin. */
  return { items, complete: false };
}
