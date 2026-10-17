/**
 * The desk's app-level keyboard shortcuts and the Sneltoetsen list.
 *
 * App level owns only two keys: '/' focuses the page's search and '?'
 * opens the list. Everything else (Esc, ⌘S, ⌥1–3, arrow keys in a
 * segmented control) already belongs to a screen; the list documents those,
 * it does not unify them. Kosten & bank and Documenten & media have their
 * own handlers for '/' and '?', so the app stays out of their way.
 *
 * Areas append rows to PAGE_SHORTCUTS for their screens (append-only).
 * Pure and import-free: node-tested.
 */

export interface ShortcutRow {
  /** Key caps, each rendered as one kbd ('⌘', 'S'). */
  keys: readonly string[];
  /** An alternative chord, shown after a slash ('Tab' / '⇧ Tab'). */
  alt?: readonly string[];
  text: string;
}

export interface PageShortcutSet {
  /**
   * Route patterns: ':param' matches one segment, a trailing '/*' matches
   * the path itself and anything below it.
   */
  routes: readonly string[];
  rows: readonly ShortcutRow[];
}

/** "Overal": keys that work on every screen. */
export const GLOBAL_SHORTCUTS: readonly ShortcutRow[] = [
  { keys: ['/'], text: 'Zoeken op deze pagina' },
  { keys: ['?'], text: 'Deze lijst tonen' },
  { keys: ['Esc'], text: 'Venster, menu of zoekveld sluiten' },
  { keys: ['⌘', 'S'], text: 'Opslaan in een offerte, inkooporder, product of de website-editor' },
  { keys: ['Tab'], alt: ['⇧', 'Tab'], text: 'Volgend of vorig veld' },
  { keys: ['←', '→'], text: 'Andere keuze in een keuzebalk' },
];

/** "Op deze pagina": screen keys, matched on the route. Areas append their own sets. */
export const PAGE_SHORTCUTS: readonly PageShortcutSet[] = [
  {
    routes: ['/purchasing/:id'],
    rows: [
      { keys: ['⌥', '1'], text: 'Producten' },
      { keys: ['⌥', '2'], text: 'Betalingen' },
      { keys: ['⌥', '3'], text: 'Nacalculatie' },
    ],
  },
  {
    routes: ['/sales/:id/edit', '/purchasing/:id/edit', '/products/:id/edit', '/website/*'],
    rows: [{ keys: ['⌘', 'S'], text: 'Opslaan' }],
  },
  /* Producten & voorraad (2026-10-17) */
  {
    routes: ['/products'],
    rows: [
      { keys: ['↑', '↓'], text: 'Door de lijst' },
      { keys: ['→', '←'], text: 'Reeks openen of sluiten' },
      { keys: ['↵'], text: 'Product openen' },
      { keys: ['E'], text: 'Bewerken' },
    ],
  },
  {
    routes: ['/products/:id'],
    rows: [
      { keys: ['E'], text: 'Bewerken' },
      { keys: ['B'], text: 'Voorraad boeken' },
      { keys: ['⌥', '←'], alt: ['⌥', '→'], text: 'Vorige of volgende kleur' },
    ],
  },
  {
    routes: ['/stock'],
    rows: [
      { keys: ['↑', '↓'], text: 'Door de lijst' },
      { keys: ['↵'], text: 'Voorraad van het product' },
      { keys: ['B'], text: 'Voorraad boeken' },
    ],
  },
];

/** The foot line of the Sneltoetsen sheet. */
export const WORKSPACE_SHORTCUTS_NOTE = 'Kosten & bank en Documenten & media hebben hun eigen lijst: druk daar op ?';

/** What '/' focuses: the page's own search field, first visible match inside .main. */
export const PAGE_SEARCH_SELECTOR = '[data-page-search], .wk-search input, .ios-search input, input[type=search]';

function pathOf(url: string): string {
  const cut = url.search(/[?#]/);
  const path = cut < 0 ? url : url.slice(0, cut);
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/** True when a route pattern matches a path (see PageShortcutSet.routes). */
export function routeMatches(pattern: string, url: string): boolean {
  const path = pathOf(url);
  if (pattern.endsWith('/*')) {
    const root = pattern.slice(0, -2);
    return path === root || path.startsWith(root + '/');
  }
  const want = pattern.split('/');
  const have = path.split('/');
  if (want.length !== have.length) return false;
  return want.every((part, i) => part.startsWith(':') ? have[i] !== '' : part === have[i]);
}

/** The "Op deze pagina" rows for a URL; empty when nothing matches (the section hides). */
export function pageShortcutsFor(url: string, sets: readonly PageShortcutSet[] = PAGE_SHORTCUTS): ShortcutRow[] {
  return sets.filter((set) => set.routes.some((route) => routeMatches(route, url))).flatMap((set) => set.rows);
}

/** Kosten & bank and Documenten & media handle '/' and '?' themselves. */
export function appShortcutsActive(url: string): boolean {
  const path = pathOf(url);
  return !['/costs', '/files'].some((root) => path === root || path.startsWith(root + '/'));
}

export interface ShortcutKey {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  /** The focus is in an input, select, textarea or contenteditable. */
  typing: boolean;
  /** A sheet, menu or popover is open. */
  overlay: boolean;
  defaultPrevented?: boolean;
}

export type ShortcutCommand = 'search' | 'help';

/** The app-level command for a key press on the desk, or null when the key is someone else's. */
export function shortcutCommand(event: ShortcutKey, url: string): ShortcutCommand | null {
  if (event.defaultPrevented || event.typing || event.overlay) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (!appShortcutsActive(url)) return null;
  if (event.key === '/') return 'search';
  if (event.key === '?') return 'help';
  return null;
}
