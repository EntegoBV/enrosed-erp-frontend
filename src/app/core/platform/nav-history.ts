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
 * - popstate moves to the entry whose id the browser restored, and that
 *   entry takes the pop's own id: Angular rewrites the restored browser
 *   entry with the new navigationId (HistoryStateManager.setBrowserUrl
 *   replaces the state when the location already equals the target), so
 *   the next return to it reports the new id. An id we do not know, or one
 *   whose entry shows another screen (history from before a reload, where
 *   the ids started at 1 again), restarts the stack there, because we
 *   cannot know what lies below it.
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
    /* After a reload the ids start at 1 again: an older browser entry can carry the id of
       another screen's entry. The path must agree (a page may change its own query in place). */
    if (at >= 0 && navPath(stack.entries[at].url) === navPath(nav.url)) {
      const entries = stack.entries.slice();
      /* The restored entry now carries the pop's id (Angular rewrote its state) and the URL the router settled on. */
      entries[at] = entry;
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
