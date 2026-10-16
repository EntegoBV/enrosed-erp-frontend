/**
 * The in-app navigation history as a stack, the way the browser keeps it.
 *
 * Back labels and the way up need to know which screen sits *under* the
 * current one: "‹ Verkoop" only when location.back() really returns to
 * Verkoop. A plain "previous URL" is wrong after a pop (Verkoop → Order 79
 * → Klant → back: the previous URL is Klant, the screen below is Verkoop)
 * and after replaceUrl navigations (list filters, workspace tabs).
 *
 * Entries are keyed by the router's navigation id:
 * - an imperative navigation pushes (dropping any forward entries);
 * - replaceUrl (or skipLocationChange) replaces the top;
 * - popstate moves to the entry whose id the browser restored. An id we do
 *   not know (history from before a reload) restarts the stack there,
 *   because we cannot know what lies below it.
 *
 * lastUrlFor(path) keeps the last full URL seen per path, so "way up" can
 * return to the list with its filters (/sales?tab=facturen&scope=PARTNER)
 * when history cannot. Pure and import-free: node-tested.
 */

export interface NavEntry {
  /** The router's navigation id. */
  id: number;
  /** The final URL (after redirects). */
  url: string;
}

export interface NavStack {
  readonly entries: readonly NavEntry[];
  /** The current entry; -1 while empty. */
  readonly index: number;
  /** The last full URL seen per path. */
  readonly lastUrls: Readonly<Record<string, string>>;
}

export interface NavRecord {
  id: number;
  url: string;
  trigger: 'imperative' | 'popstate' | 'hashchange';
  /** replaceUrl or skipLocationChange: no new browser history entry. */
  replace?: boolean;
  /** The navigation id the browser restored on popstate (restoredState.navigationId). */
  restoredId?: number | null;
}

export function navPath(url: string): string {
  const cut = url.search(/[?#]/);
  const path = cut < 0 ? url : url.slice(0, cut);
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

export function emptyNavStack(): NavStack {
  return { entries: [], index: -1, lastUrls: {} };
}

export function recordNavigation(stack: NavStack, nav: NavRecord): NavStack {
  const entry: NavEntry = { id: nav.id, url: nav.url };
  const lastUrls = { ...stack.lastUrls, [navPath(nav.url)]: nav.url };

  if (nav.trigger === 'popstate' || nav.trigger === 'hashchange') {
    const at = nav.restoredId == null ? -1 : stack.entries.findIndex((e) => e.id === nav.restoredId);
    if (at >= 0) {
      const entries = stack.entries.slice();
      /* The restored entry keeps its id; its URL is what the router settled on now. */
      entries[at] = { id: entries[at].id, url: nav.url };
      return { entries, index: at, lastUrls };
    }
    return { entries: [entry], index: 0, lastUrls };
  }

  if (nav.replace && stack.index >= 0) {
    const entries = stack.entries.slice(0, stack.index + 1);
    entries[stack.index] = entry;
    return { entries, index: stack.index, lastUrls };
  }

  const entries = [...stack.entries.slice(0, stack.index + 1), entry];
  return { entries, index: entries.length - 1, lastUrls };
}

export function currentNavEntry(stack: NavStack): NavEntry | null {
  return stack.entries[stack.index] ?? null;
}

/** The entry location.back() returns to, or null when back would leave the app. */
export function navEntryBelow(stack: NavStack): NavEntry | null {
  return stack.index > 0 ? stack.entries[stack.index - 1] : null;
}

/** The last full URL seen for a path (its query and fragment included), or null. */
export function lastUrlFor(stack: NavStack, path: string): string | null {
  return stack.lastUrls[navPath(path)] ?? null;
}

/**
 * How to go up to a parent screen: history back when the screen below is
 * that parent (filters and scroll kept), otherwise a navigation to the last
 * URL seen for the parent's path, or the parent URL itself.
 */
export function upTarget(stack: NavStack, parentUrl: string): { back: true } | { back: false; url: string } {
  const below = navEntryBelow(stack);
  const parentPath = navPath(parentUrl);
  if (below && navPath(below.url) === parentPath) return { back: true };
  return { back: false, url: lastUrlFor(stack, parentPath) ?? parentUrl };
}
