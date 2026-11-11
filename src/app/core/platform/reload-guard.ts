import { isTypingTarget } from '../../shared/key-context';

/**
 * What the app's two own reloads share: the one for a newer build
 * (fresh-build-service.ts) and the one for a chunk that no longer exists
 * (app.config.ts). One record per tab says what was already tried, and one
 * set of questions says whether a reload would take something away right
 * now: an open sheet, popup or menu, a field someone is in, a running save,
 * unsaved work. No Angular import: the error handler uses it before anything
 * else exists.
 */

/** One record per tab (sessionStorage) for every reload the app starts itself. */
export const RELOAD_RECORD_KEY = 'enrosed.build.reloaded';
/** The key the chunk reload used before 2026-11-10; removed on the first write. */
const LEGACY_KEY = 'enrosed.reloaded-for-build';

export interface ReloadRecord {
  /** The build this tab reloaded for (a newer build was seen): never again for the same id. */
  build: string | null;
  /** The build last tried and how often: a reload that never got through gets one more chance (fresh-build.ts BUILD_TRIES). */
  tried: string | null;
  tries: number;
  /** A missing chunk: the address this tab last reloaded at, and the main script it ran then. Not twice for the same pair. */
  href: string | null;
  from: string | null;
  at: number;
}

const NO_RECORD: ReloadRecord = { build: null, tried: null, tries: 0, href: null, from: null, at: 0 };

/** The tab's sessionStorage, or null where it is switched off (the app then never reloads by itself: it could not remember that it did). */
export function sessionStore(win: Window | null | undefined): Storage | null {
  try {
    return win?.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function readReloadRecord(store: Storage | null): ReloadRecord {
  try {
    const parsed = JSON.parse(store?.getItem(RELOAD_RECORD_KEY) ?? 'null') as Partial<ReloadRecord> | null;
    if (!parsed || typeof parsed !== 'object') return { ...NO_RECORD };
    const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
    return {
      build: text(parsed.build), tried: text(parsed.tried), tries: typeof parsed.tries === 'number' ? parsed.tries : 0,
      href: text(parsed.href), from: text(parsed.from), at: typeof parsed.at === 'number' ? parsed.at : 0,
    };
  } catch {
    return { ...NO_RECORD };
  }
}

/** False when the record could not be written: the caller then does not reload (it could loop). */
export function writeReloadRecord(store: Storage | null, record: ReloadRecord): boolean {
  if (!store) return false;
  try {
    store.setItem(RELOAD_RECORD_KEY, JSON.stringify(record));
    store.removeItem(LEGACY_KEY);
    return true;
  } catch {
    return false;
  }
}

/** The main script this document runs ("main-D5NXTMQC.js"; "main.js" in a development build). */
export function runningMain(doc: Document): string {
  const src = doc.querySelector('script[src*="main"]')?.getAttribute('src') ?? '';
  return src.split(/[?#]/)[0].split('/').pop() ?? '';
}

export function isStaleChunkError(error: unknown): boolean {
  const text = String((error as { message?: string })?.message ?? error ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|error loading dynamically imported module/i.test(text);
}

/* ------------------------------------------------------------- what is open */

/** Every sheet, popup, menu and toast of the app while it is in the DOM. A popup that is none of these gets `data-kit-overlay`. */
export const OPEN_SURFACE = '.overlay, .cm, [data-kit-overlay], .cp-pop, .wk-popover, .lpp, .lightbox, .toast, [role="dialog"], [role="menu"], [aria-modal="true"]';
const LEAVING = '.mo-leaving, .mo-toast-leaving, .tabbar-menu--leaving';
/**
 * Work made by clicks that no field and no editor guard shows: an element that only exists while such work is in hand.
 * `data-unsaved` is the marker for new screens; the bank allocation's chosen document or payment is today's one case.
 */
const WORK_IN_HAND = '[data-unsaved], .bank-alloc-preview';

/** A sheet, popup, menu or toast on screen that is not on its way out. */
export function surfaceOpen(doc: Document): boolean {
  return Array.from(doc.querySelectorAll(OPEN_SURFACE)).some((element) => !element.closest(LEAVING));
}

/** A search field: its text is a view of the list, not work (the lists keep it in memory only). */
export function isSearchField(target: Element | null): boolean {
  if (!(target instanceof HTMLInputElement)) return false;
  return target.type === 'search' || target.getAttribute('role') === 'searchbox' || target.getAttribute('enterkeyhint') === 'search'
    || target.closest('.wk-search, .ios-search') !== null;
}

/** A field that takes text (isTypingTarget), not a search field and not a select: those are views of a list. */
export function isTextField(target: Element | null): boolean {
  return isTypingTarget(target) && !(target instanceof HTMLSelectElement) && !isSearchField(target);
}

/**
 * Someone is in a field. A search field or a select does not count: a sheet hands the focus back to the list's search
 * when it closes (shared/ui.ts), with no keyboard on screen, and the focus would then hold the page for good.
 */
export function fieldFocused(doc: Document): boolean {
  return isTextField(doc.activeElement);
}

/** Click-made work without a guard of its own is on screen (WORK_IN_HAND). */
export function workInHand(doc: Document): boolean {
  return doc.querySelector(WORK_IN_HAND) !== null;
}

/**
 * Asks every editor what a real unload would ask (their window:beforeunload listeners only call preventDefault while
 * dirty or busy), without the browser's question: the event is ours, so nothing is shown.
 */
export function unsavedWork(win: Window): boolean {
  const probe = new Event('beforeunload', { cancelable: true });
  win.dispatchEvent(probe);
  return probe.defaultPrevented;
}

/** Something a reload would take away right now. */
export function holdsWork(doc: Document, writes: number): boolean {
  const win = doc.defaultView;
  return writes > 0 || surfaceOpen(doc) || fieldFocused(doc) || workInHand(doc) || (!!win && unsavedWork(win));
}

/* ------------------------------------------------------------ missing chunk */

/** What the chunk reload needs from the app (looked up at the moment of the error). */
export interface StaleChunkContext {
  /** Saves and uploads that have not answered (InFlight.writes). */
  writes: () => number;
  /** NavHistory.keepForReload: the back history survives the reload. */
  keepStack: () => void;
}

/** While a chunk reload waits for open work to be saved or closed: how often it looks again. */
const STALE_RETRY_MS = 1500;
let waiting: ReturnType<typeof setInterval> | null = null;

function stopWaiting(): void {
  if (waiting !== null) clearInterval(waiting);
  waiting = null;
}

/**
 * After a deploy the hashed chunk a still-open tab wants to lazy-load no longer exists: a navigation fails and every tap
 * seems dead. The cure is a fresh load of the new build, once per address and running build, so a build that is really
 * broken cannot loop. A failed navigation (`leaving`) has passed its screen's leave guards and reloads at once. A chunk
 * that fails outside a navigation (a deferred block, a lazy part of an open sheet) never reloads over an open sheet, a
 * field someone is in, a running save or unsaved work: it waits and reloads as soon as that is closed or saved.
 * Returns true when the page is reloading.
 */
export function reloadForStaleChunk(win: Window, context: StaleChunkContext, leaving: boolean): boolean {
  const store = sessionStore(win);
  if (!store) return false;
  const record = readReloadRecord(store);
  const from = runningMain(win.document);
  if (record.href === win.location.href && record.from === from) return false;
  if (!leaving && holdsWork(win.document, context.writes())) {
    waiting ??= setInterval(() => {
      if (holdsWork(win.document, context.writes())) return;
      stopWaiting();
      reloadForStaleChunk(win, context, true);
    }, STALE_RETRY_MS);
    return false;
  }
  stopWaiting();
  if (!writeReloadRecord(store, { ...record, href: win.location.href, from, at: Date.now() })) return false;
  try { context.keepStack(); } catch { /* The stack then starts over, as after any reload. */ }
  win.location.reload();
  return true;
}
