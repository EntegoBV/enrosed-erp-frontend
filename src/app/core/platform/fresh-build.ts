/**
 * An open app or tab loads a newer build by itself (2026-11-10). The rules,
 * pure and import-free; fresh-build-service.ts is the thin half that reads
 * the page and reloads.
 *
 * Why: nothing ever made an open session load a new build. The web app only
 * reloaded when a lazy chunk was gone, the native iOS shell loads its pages
 * once, and iOS keeps an app for days. A fix that was live was not on the
 * phone that reported the bug.
 *
 * - The build is its hashed entry files (main, styles, polyfills), not the
 *   main script alone: a release that only changes the stylesheet renames
 *   only `styles-….css`. A development build (unhashed) is no build and
 *   nothing ever happens there.
 * - The latest build is read from a fresh `/index.html` (no cache): when the
 *   page comes back in view, every BUILD_CHECK_INTERVAL_MS while in view and
 *   on arrival at another screen, never more often than BUILD_CHECK_GAP_MS;
 *   a failed or offline check is silent and may be asked again after
 *   BUILD_RETRY_MS.
 * - A newer build is first downloaded into the browser's cache (its entry
 *   files and preloaded chunks). Only then is it "ready": the reload itself
 *   then needs one small file and takes a fraction of a second, also on a
 *   weak connection.
 * - The page reloads at one of two moments, and only when nothing can be
 *   lost and nobody is interrupted (decideBuildReload):
 *   arrival: a navigation ended on another screen, that screen has come to
 *     rest (no request for BUILD_ARRIVAL_REST_MS) within BUILD_ARRIVAL_MAX_MS,
 *     and nobody touched it since it appeared;
 *   quiet: nobody touched the page for BUILD_QUIET_MS (BUILD_VIEW_QUIET_MS
 *     when a search, filter or sort was set on this screen, which a reload
 *     would clear). In view: the app picked up after a while, a desk window
 *     beside other work. In the native shell also a tab that is not on
 *     screen while the app is in front.
 * - Never over a sheet, popup, menu or toast, a field someone is in, text in
 *   a field, an open file picker, a running save or upload, unsaved work, a
 *   native question; never while hidden in a browser or while the app is in
 *   the background.
 * - At most once per build (BUILD_TRIES when the load never got through). If
 *   the page still runs another build after it (CDN lag, a roll-back) it
 *   stays as it is until a different build appears.
 * - Customer pages (/login, /offerte, /voorwaarden) never take part.
 * - Nothing is shown: no banner, no toast, no question.
 */

/** While in view the latest build is asked this often… */
export const BUILD_CHECK_INTERVAL_MS = 5 * 60_000;
/** …and never more often than this, whatever the reason (coming back in view, an arrival, the timer). */
export const BUILD_CHECK_GAP_MS = 3 * 60_000;
/** A check that failed (offline, a slow first request after iOS woke the app) may be asked again after this. */
export const BUILD_RETRY_MS = 20_000;
/** Coming back in view: one more try this long after a failed check. */
export const BUILD_WAKE_RETRY_MS = 2_000;
/** A reload only follows an answer this fresh; otherwise the build is asked once more first. */
export const BUILD_CONFIRM_MS = 30_000;
/** Such a confirming check at most this often. */
export const BUILD_CONFIRM_GAP_MS = 5_000;
/** A confirming check slower than this means a weak connection: not now. */
export const BUILD_CONFIRM_SLOW_MS = 1_500;
export const BUILD_FETCH_TIMEOUT_MS = 8_000;
/** The new build's files must all arrive within this, or it is not ready yet. */
export const BUILD_PREFETCH_TIMEOUT_MS = 20_000;
/** Nobody touched the page for this long: quiet. */
export const BUILD_QUIET_MS = 5 * 60_000;
/** Quiet for a screen with a search, filter or sort set by hand: a reload clears those. */
export const BUILD_VIEW_QUIET_MS = 30 * 60_000;
/** While a newer build waits for its moment, the page looks again this often. */
export const BUILD_WATCH_MS = 30_000;
/** After coming back in view the page settles this long before the quiet reload. */
export const BUILD_WAKE_SETTLE_MS = 600;
export const BUILD_ARRIVAL_SETTLE_MS = 400;
export const BUILD_ARRIVAL_REST_MS = 300;
/** A screen that has not come to rest this long after arriving is being read by then: this arrival is skipped. */
export const BUILD_ARRIVAL_MAX_MS = 2_500;
/** A pointer that went down and never came up counts as down for this long. */
export const BUILD_HELD_MS = 10_000;
/** An opened file picker that never reported back holds for this long. */
export const BUILD_PICK_MS = 30 * 60_000;
/** The document still runs this long after its reload was asked for: the load never got through. */
export const BUILD_ALIVE_MS = 10_000;
/** Reloads per build when the load never got through. */
export const BUILD_TRIES = 2;
/** In the native shell the tabs that are not on screen check this much later than the one in view, spread out, so they do not all load at once. */
export const BUILD_BACKSTAGE_DELAY_MS = 1_500;
export const BUILD_BACKSTAGE_SPREAD_MS = 4_500;
export const BUILD_SCROLL_KEEP_MS = 60 * 60_000;
export const BUILD_SCROLL_WAIT_MS = 3_000;

const ENTRY_FILE = /^(?:main|polyfills|styles)-[A-Za-z0-9_-]+\.(?:js|css)$/;
const HASHED_FILE = /^(?:main|polyfills|styles|chunk)-[A-Za-z0-9_-]+\.(?:js|css)$/;

function fileName(url: string | null | undefined): string {
  return (url ?? '').split(/[?#]/)[0].split('/').pop() ?? '';
}

/**
 * The build behind a set of file URLs: its hashed entry files, sorted
 * ("main-D5NXTMQC.js|styles-SZC5YEUP.css"); '' without a hashed main script (a development build).
 */
export function buildIdOf(urls: Iterable<string | null | undefined>): string {
  const names = new Set<string>();
  for (const url of urls) {
    const name = fileName(url);
    if (ENTRY_FILE.test(name)) names.add(name);
  }
  const list = [...names].sort();
  return list.some((name) => name.startsWith('main-')) ? list.join('|') : '';
}

/** What an index.html names: the build, and every hashed file the page loads at start (entry files and preloaded chunks). */
export interface BuildPage {
  id: string;
  files: string[];
}

/** The build an index.html names; null when the text is not this app's page (an error page, a captive portal) or names no hashed main script. */
export function buildOfHtml(html: string): BuildPage | null {
  if (!html.includes('<app-root')) return null;
  const urls = Array.from(html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g), (match) => match[1]);
  const id = buildIdOf(urls);
  if (!id) return null;
  const files = [...new Set(urls.filter((url) => HASHED_FILE.test(fileName(url))))];
  return { id, files };
}

/** A build in a few characters, to read out or compare by eye: the first four of each entry file's hash ("D5NX-SZC5"). */
export function buildCode(id: string): string {
  return id.split('|').map((name) => name.replace(/^[a-z]+-/, '').replace(/\.[a-z]+$/, '').slice(0, 4)).filter(Boolean).join('-');
}

const CUSTOMER_ROOTS = ['/login', '/offerte', '/voorwaarden'];

/** False on the login page, the customer portal and the terms page (whole path segments). */
export function isStaffUrl(url: string): boolean {
  const path = url.split(/[?#]/)[0];
  return !CUSTOMER_ROOTS.some((root) => path === root || path.startsWith(root + '/'));
}

/** A newer build is live and this tab has not reloaded for it yet. */
export function pendingBuild(running: string, latest: string, reloadedFor: string | null): boolean {
  return running !== '' && latest !== '' && latest !== running && latest !== reloadedFor;
}

export type BuildMoment = 'arrival' | 'quiet';

/** Why nothing happens. */
export type BuildHold =
  | 'dev' | 'nostore' | 'customer' | 'current' | 'fetching' | 'hidden' | 'offline' | 'navigating' | 'surface' | 'focus' | 'saving'
  | 'asking' | 'picking' | 'unsaved' | 'typed' | 'late' | 'handed' | 'acted' | 'present' | 'view' | 'slow';

export type BuildVerdict = { act: 'reload' } | { act: 'confirm' } | { act: 'none'; why: BuildHold };

/** Everything the decision reads, as the service found it at that moment. */
export interface BuildSituation {
  moment: BuildMoment;
  /** The build this document runs; '' in a development build. */
  running: string;
  /** The build the last answered check named. */
  latest: string;
  /** The build this tab already reloaded for. */
  reloadedFor: string | null;
  /** The latest build's files are in the browser's cache. */
  ready: boolean;
  /** sessionStorage works: the one-reload record can be kept. */
  canRemember: boolean;
  /** Signed in and on a staff screen. */
  staff: boolean;
  visible: boolean;
  /** Native shell: this web view is a tab that is not on screen while the app is in front. */
  backstage: boolean;
  /** Native shell: the app is in the background. */
  appAway: boolean;
  online: boolean;
  navigating: boolean;
  /** A sheet, popup, menu or toast is open. */
  surfaceOpen: boolean;
  /** Someone is in a text field (not a search field or a select). */
  fieldFocused: boolean;
  /** A save or upload has not answered. */
  writing: boolean;
  /** A native confirm or prompt is open. */
  asking: boolean;
  /** A file picker was opened and has not reported back. */
  picking: boolean;
  /** An editor says it has unsaved work, or click-made work is in hand. */
  unsaved: boolean;
  /** Text someone typed stands in a field that is still on screen (or a chosen file). */
  typed: boolean;
  /** Arrival: the screen rewrote its own address after arriving (it took something from it into memory). */
  handed: boolean;
  /** Arrival: a press, a key, a scroll or a native control since the screen appeared, or a pointer still down. */
  acted: boolean;
  /** Arrival: more than BUILD_ARRIVAL_MAX_MS ago. */
  late: boolean;
  /** Since the last sign of a person on this page. */
  quietForMs: number;
  quietMs: number;
  /** A search, filter or sort was set by hand on this screen. */
  viewTouched: boolean;
  viewQuietMs: number;
  /** Since the last check that answered. */
  confirmedAgoMs: number;
}

export function decideBuildReload(s: BuildSituation): BuildVerdict {
  const hold = (why: BuildHold): BuildVerdict => ({ act: 'none', why });
  if (!s.running) return hold('dev');
  if (!s.canRemember) return hold('nostore');
  if (!s.staff) return hold('customer');
  if (!pendingBuild(s.running, s.latest, s.reloadedFor)) return hold('current');
  if (!s.ready) return hold('fetching');
  if (s.appAway) return hold('hidden');
  if (!s.visible && !(s.moment === 'quiet' && s.backstage)) return hold('hidden');
  if (!s.online) return hold('offline');
  if (s.navigating) return hold('navigating');
  if (s.surfaceOpen) return hold('surface');
  if (s.fieldFocused) return hold('focus');
  if (s.writing) return hold('saving');
  if (s.asking) return hold('asking');
  if (s.picking) return hold('picking');
  if (s.unsaved) return hold('unsaved');
  if (s.typed) return hold('typed');
  if (s.moment === 'arrival') {
    if (s.late) return hold('late');
    if (s.handed) return hold('handed');
    if (s.acted) return hold('acted');
  } else {
    if (s.quietForMs < s.quietMs) return hold('present');
    if (s.viewTouched && s.quietForMs < s.viewQuietMs) return hold('view');
  }
  return s.confirmedAgoMs > BUILD_CONFIRM_MS ? { act: 'confirm' } : { act: 'reload' };
}
