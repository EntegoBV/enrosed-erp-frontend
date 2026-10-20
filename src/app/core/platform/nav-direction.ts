/**
 * Which way a phone navigation moves: deeper (push), back up (pop), to
 * another tab (tab) or nowhere (none).
 *
 * The shell sets the answer as data-nav on .main for a moment, and the
 * motion styles slide or fade the arriving page accordingly. A navigation
 * can name its direction itself with `info: { nav: 'push' }` (routerLink
 * [info], or router.navigate extras), e.g. a list row that only changes
 * the query. Pure and import-free (node-tested modules take no runtime
 * imports): the caller hands in the tab mapping, i.e. PHONE_TABS from
 * phone-tabs.ts.
 */

export type NavDirection = 'push' | 'pop' | 'tab' | 'none';
export type NavTrigger = 'imperative' | 'popstate' | 'hashchange';

/** The tab mapping navDirection works with (PHONE_TABS in phone-tabs.ts). */
export interface NavTabs {
  tabOf(url: string): string;
  /** True on a tab root itself (/sales, /more…). */
  isRoot(url: string): boolean;
}

const DIRECTIONS: readonly NavDirection[] = ['push', 'pop', 'tab', 'none'];

/** The direction a navigation names itself, from its `info` extra. */
export function navInfoDirection(info: unknown): NavDirection | null {
  if (!info || typeof info !== 'object') return null;
  const nav = (info as { nav?: unknown }).nav;
  return typeof nav === 'string' && (DIRECTIONS as readonly string[]).includes(nav) ? nav as NavDirection : null;
}

function pathOf(url: string): string {
  const cut = url.search(/[?#]/);
  const path = cut < 0 ? url : url.slice(0, cut);
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

function depth(path: string): number {
  return path.split('/').filter(Boolean).length;
}

export function navDirection(
  prevUrl: string | null,
  nextUrl: string,
  trigger: NavTrigger,
  info: unknown,
  tabs: NavTabs,
): NavDirection {
  if (trigger === 'popstate') return 'pop';
  const named = navInfoDirection(info);
  if (named) return named;
  if (prevUrl === null) return 'none';
  const prev = pathOf(prevUrl);
  const next = pathOf(nextUrl);
  if (prev === next) return 'none';
  if (tabs.tabOf(prev) !== tabs.tabOf(next)) return 'tab';
  /* Within a tab, leaving its root goes deeper (Verkoop → Klanten) and returning to it goes up. */
  const prevRoot = tabs.isRoot(prev);
  const nextRoot = tabs.isRoot(next);
  if (prevRoot && !nextRoot) return 'push';
  if (!prevRoot && nextRoot) return 'pop';
  const from = depth(prev);
  const to = depth(next);
  if (to > from) return 'push';
  if (to < from) return 'pop';
  return 'none';
}
