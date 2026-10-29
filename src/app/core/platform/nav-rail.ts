import { PHONE_MEDIA } from './desktop-viewport';

/**
 * Where the phone's tab bar stands (2026-10-29, the iPhone Duo follow-up). iOS 27.1 apps on an iPhone Duo move
 * their tab bar, toolbars and back button into a strip on the side of the screen (84 pt wide, the status bar at
 * its top, the tab bar at its bottom): folded upright and sideways, and unfolded sideways; only the unfolded
 * upright pose keeps bars at the top and bottom. An HTML tab bar stays where its CSS puts it, so the shell
 * follows the system itself:
 * - the page sees the strip: one side's safe-area inset of STRIP_MIN px or more, the other side and the top
 *   (nearly) free. The tab bar stands in that strip, on its side (`data-side-strip` and `data-nav-rail` on
 *   <html>); the page already keeps clear of it through --safe-l / --safe-r;
 * - no strip, but a touch screen of the phone shell held sideways (an unfolded Duo whose strip WebKit keeps
 *   outside the page, the Duo folded sideways, a landscape iPhone): the tab bar stands at the right edge, where
 *   the strip would be, and the page keeps clear of it (`data-nav-rail="right"`);
 * - otherwise it stays at the bottom (no attribute).
 * styles/nav-rail.scss draws the rail; the shell opens the long-press menu beside it (tab-menu.ts
 * tabMenuSidePlacement). The decision functions are pure.
 */

export type RailSide = 'left' | 'right';

export interface SafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The narrowest side inset (px) that counts as the Duo's strip (84 there). A notch in landscape (about 59, and on both sides) does not. */
export const STRIP_MIN = 72;
/** The most the other side and the top may report for a strip (px): the strip is the only inset beside the bottom. */
export const STRIP_OTHER_MAX = 16;
/**
 * A touch screen of the phone shell held sideways, at least 340 px high: the rail without a strip. Lower (a phone
 * browser's landscape tab with its bars, about 300 px) the icon-only rail and its '+' (318 px) would run off the
 * top, so the bottom bar stays.
 */
export const RAIL_LANDSCAPE_MEDIA = '(hover: none) and (max-width: 1023.98px) and (orientation: landscape) and (min-height: 340px)';

/** The side of the Duo's strip as the page sees it, or null when the insets are those of any other screen. */
export function stripSide(insets: SafeInsets): RailSide | null {
  if (insets.top > STRIP_OTHER_MAX) return null;
  if (insets.right >= STRIP_MIN && insets.left <= STRIP_OTHER_MAX) return 'right';
  if (insets.left >= STRIP_MIN && insets.right <= STRIP_OTHER_MAX) return 'left';
  return null;
}

export interface NavRail {
  /** Where the tab bar stands; null keeps it at the bottom. */
  side: RailSide | null;
  /** The side of the strip it stands in, when the page sees one. */
  strip: RailSide | null;
}

/** The rail for the phone shell (phone), a sideways touch screen (landscape) and the page's safe-area insets. */
export function navRailFor(phone: boolean, landscape: boolean, insets: SafeInsets): NavRail {
  if (!phone) return { side: null, strip: null };
  const strip = stripSide(insets);
  if (strip) return { side: strip, strip };
  return { side: landscape ? 'right' : null, strip: null };
}

const PROBE_ATTR = 'data-safe-area-probe';
const NO_INSETS: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** The hidden fixed probe padded by env(safe-area-inset-*): one per document, made on first use. */
function safeAreaProbe(doc: Document): HTMLElement {
  const found = doc.querySelector<HTMLElement>(`[${PROBE_ATTR}]`);
  if (found) return found;
  const probe = doc.createElement('div');
  probe.setAttribute(PROBE_ATTR, '');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;'
    + 'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  doc.body.appendChild(probe);
  return probe;
}

/** The page's safe-area insets in px, read now (resolved by the browser; a custom property holding env() may not be). */
export function readSafeInsets(doc: Document): SafeInsets {
  const view = doc.defaultView;
  if (!view || !doc.body) return NO_INSETS;
  const style = view.getComputedStyle(safeAreaProbe(doc));
  const px = (value: string) => parseFloat(value) || 0;
  return { top: px(style.paddingTop), right: px(style.paddingRight), bottom: px(style.paddingBottom), left: px(style.paddingLeft) };
}

function setData(root: HTMLElement, key: 'navRail' | 'sideStrip', value: string | null): void {
  if (value === null) delete root.dataset[key];
  else if (root.dataset[key] !== value) root.dataset[key] = value;
}

/**
 * Keeps `data-nav-rail` / `data-side-strip` on <html> current: now, on every resize (a fold or unfold, a turn of
 * the phone), and when either media query flips. The insets come from the hidden probe (readSafeInsets); iOS can
 * settle them a moment after the resize, so each change is read twice. Returns the uninstall.
 */
export function installNavRail(doc: Document): () => void {
  const view = doc.defaultView;
  if (!view || typeof view.matchMedia !== 'function' || !doc.body) return () => undefined;
  const root = doc.documentElement;
  const probe = safeAreaProbe(doc);
  const phone = view.matchMedia(PHONE_MEDIA);
  const landscape = view.matchMedia(RAIL_LANDSCAPE_MEDIA);

  const apply = (): void => {
    const rail = navRailFor(phone.matches, landscape.matches, readSafeInsets(doc));
    setData(root, 'sideStrip', rail.strip);
    setData(root, 'navRail', rail.side);
  };

  let frame = 0;
  let settle: ReturnType<typeof setTimeout> | null = null;
  const schedule = (): void => {
    view.cancelAnimationFrame(frame);
    frame = view.requestAnimationFrame(apply);
    if (settle !== null) clearTimeout(settle);
    settle = setTimeout(() => { settle = null; apply(); }, 300);
  };

  apply();
  phone.addEventListener('change', schedule);
  landscape.addEventListener('change', schedule);
  view.addEventListener('resize', schedule);
  view.addEventListener('orientationchange', schedule);
  return () => {
    phone.removeEventListener('change', schedule);
    landscape.removeEventListener('change', schedule);
    view.removeEventListener('resize', schedule);
    view.removeEventListener('orientationchange', schedule);
    view.cancelAnimationFrame(frame);
    if (settle !== null) clearTimeout(settle);
    probe.remove();
    setData(root, 'sideStrip', null);
    setData(root, 'navRail', null);
  };
}
