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
 * The screen below is the first entry under the current one that shows
 * another screen: the sections of one screen (/analyses/:section, whose
 * strip pushes an entry per section) count as one, as iOS never pushes for
 * in-screen sections. Back goes there in one step (history.go(-n)).
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
  /**
   * The native host starts a stack of its own here: the login page, and
   * the screen that replaces it after the sign-in (hostStack, screensBelow).
   * The PWA's own below()/up()/back() do not read it.
   */
  root?: boolean;
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
  /* Signed out (or never in): the native host's stack starts over at the login page. */
  if (navPath(nav.url) === '/login') entry.root = true;
  const lastUrls = { ...stack.lastUrls, [navPath(nav.url)]: nav.url };

  if (nav.trigger === 'popstate' || nav.trigger === 'hashchange') {
    const at = nav.restoredId == null ? -1 : stack.entries.findIndex((e) => e.id === nav.restoredId);
    /* After a reload the ids start at 1 again: an older browser entry can carry the id of
       another screen's entry. The path must agree (a page may change its own query in place). */
    if (at >= 0 && navPath(stack.entries[at].url) === navPath(nav.url)) {
      const entries = stack.entries.slice();
      /* The restored entry now carries the pop's id (Angular rewrote its state) and the URL the router settled on. */
      entries[at] = stack.entries[at].root ? { ...entry, root: true } : entry;
      return { entries, index: at, lastUrls };
    }
    return { entries: [entry], index: 0, lastUrls };
  }

  if (nav.replace && stack.index >= 0) {
    const entries = stack.entries.slice(0, stack.index + 1);
    /* The screen that replaces a root (the sign-in's replaceUrl navigation to the dashboard or returnTo) is the root then. */
    if (stack.entries[stack.index].root) entry.root = true;
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

/** Screens whose sections are routes of their own: one screen for the way back. */
const SECTIONED_SCREENS: readonly string[] = ['/analyses'];

/**
 * Which screen a URL shows, for "the screen below": the URL itself, or the
 * sectioned screen it is a section of (/analyses/sales → /analyses). A
 * query-only change stays another entry: /settings?sectie=… is a view of
 * its own, reached from the overview at /settings.
 */
export function navScreen(url: string): string {
  const path = navPath(url);
  const sectioned = SECTIONED_SCREENS.find((root) => path === root || path.startsWith(root + '/'));
  return sectioned ?? url;
}

/** The first entry below the current one that shows another screen, and how many steps back it lies. */
export function screenBelow(stack: NavStack): { entry: NavEntry; steps: number } | null {
  const current = currentNavEntry(stack);
  if (!current) return null;
  const screen = navScreen(current.url);
  for (let at = stack.index - 1; at >= 0; at--) {
    if (navScreen(stack.entries[at].url) !== screen) return { entry: stack.entries[at], steps: stack.index - at };
  }
  return null;
}

/** The last full URL seen for a path (its query and fragment included), or null. */
export function lastUrlFor(stack: NavStack, path: string): string | null {
  return stack.lastUrls[navPath(path)] ?? null;
}

/**
 * How to go up to a parent screen: history back (steps entries) when the
 * screen below is that parent (filters and scroll kept), otherwise a
 * navigation to the last URL seen for the parent's path, or the parent URL
 * itself.
 */
export function upTarget(stack: NavStack, parentUrl: string): { back: true; steps: number } | { back: false; url: string } {
  const below = screenBelow(stack);
  const parentPath = navPath(parentUrl);
  if (below && navPath(below.entry.url) === parentPath) return { back: true, steps: below.steps };
  return { back: false, url: lastUrlFor(stack, parentPath) ?? parentUrl };
}

/**
 * The screens under and including the current one, bottom first, as the
 * native host mirrors them (enrosed-erp-ios: one NavigationStack entry per
 * screen). Consecutive entries of one screen (the sections of /analyses, a
 * replaceUrl filter change) count once, keeping the URL they settled on;
 * forward entries are left out. A root entry (the login page, and the
 * screen the sign-in replaces it with) starts the stack over, so the shell
 * pops to its root on sign-out and the signed-in screen is a root again.
 * Empty while nothing was recorded.
 */
export function hostStack(stack: NavStack): string[] {
  const screens: string[] = [];
  for (let at = 0; at <= stack.index; at++) {
    const { url, root } = stack.entries[at];
    if (root) screens.length = 0;
    if (screens.length && navScreen(screens[screens.length - 1]) === navScreen(url)) screens[screens.length - 1] = url;
    else screens.push(url);
  }
  return screens;
}

/**
 * The entry `count` screens below the current one and how many history
 * steps back it lies, or the deepest one history still has (fewer screens)
 * with `short` saying how many screens were missing; null when nothing lies
 * below at all (the native back then means the web's own back control).
 * Never steps below a root entry: what history keeps under the login page
 * is not the shell's stack.
 */
export function screensBelow(stack: NavStack, count: number): { entry: NavEntry; steps: number; short: number } | null {
  const current = currentNavEntry(stack);
  if (!current || count <= 0) return null;
  let screen = navScreen(current.url);
  let remaining = count;
  let found: { entry: NavEntry; steps: number } | null = null;
  for (let at = stack.index - 1; at >= 0 && remaining > 0; at--) {
    if (stack.entries[at + 1].root) break;
    const next = navScreen(stack.entries[at].url);
    if (next === screen) continue;
    screen = next;
    remaining--;
    found = { entry: stack.entries[at], steps: stack.index - at };
  }
  return found ? { ...found, short: remaining } : null;
}
