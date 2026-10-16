/*
 * Scrolling of the phone purchase order's tabs (view and editor): the tabs
 * stick under the nav once the summary card has scrolled away. A switch with
 * the bar stuck starts the new pane at its top under the bar; a switch
 * higher up leaves the page where it is.
 */

/**
 * The scroll position at which the tabs stick and the nav has condensed:
 * the nav's sentinel (1px, right above the tabs) wholly above the nav's
 * bottom. IosNav condenses only once the sentinel stops intersecting the
 * viewport below its rounded height (touching that edge still counts), so
 * a fractional position goes down to the whole pixel and one more.
 */
export function phoneStickPoint(host: HTMLElement): number | null {
  const sentinel = host.querySelector<HTMLElement>('.ios-large__sentinel');
  const nav = host.querySelector<HTMLElement>('.ios-nav');
  if (!sentinel || !nav) return null;
  return stickPointFor(sentinel.getBoundingClientRect().bottom + window.scrollY, Math.round(nav.getBoundingClientRect().height));
}

/** The stick point for the sentinel's document bottom under a nav of that height: the sentinel ends above the nav's bottom. */
export function stickPointFor(sentinelBottom: number, navHeight: number): number {
  return Math.max(0, Math.floor(sentinelBottom - navHeight) + 1);
}

/** Whether the bar is stuck at that point. */
export function phoneTabsStuck(stick: number | null): boolean {
  return stick !== null && window.scrollY >= stick - 1;
}

/** After a switch: the new pane at its top under the stuck bar, in the next frame (once it rendered). */
export function keepPhoneTabsStuck(stick: number | null, wasStuck: boolean): void {
  if (stick === null || !wasStuck) return;
  requestAnimationFrame(() => window.scrollTo({ top: stick, behavior: 'instant' }));
}

/** The tab bar's 'tap to top': the pane's top under the stuck bar, smoothly. */
export function scrollPhoneTabsTop(stick: number | null): void {
  if (stick !== null) window.scrollTo({ top: stick, behavior: 'smooth' });
}

/** A tap on the tab that is already selected (app-segmented emits nothing for it). */
export function tappedSelectedTab(event: Event): boolean {
  const target = event.target instanceof Element ? event.target.closest('[role="tab"]') : null;
  return target?.getAttribute('aria-selected') === 'true';
}

/** The keys that move keyboard focus onto a tab: Tab and Shift+Tab, and the tabs' own arrow, Home and End keys. */
const TAB_FOCUS_KEYS = new Set(['Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

/** How far a tab's scroll area moves down: the part of the root's top scroll padding the tab sits in; 0 below it. */
export function tabLift(scrollPaddingTop: number, tabTop: number): number {
  return Math.max(0, Math.ceil(scrollPaddingTop - tabTop));
}

/** The lift each tab carries now, so a scroll frame only writes a style that changes. */
const lifted = new WeakMap<HTMLElement, number>();

/**
 * Moves each tab's scroll area down past the part of the root's scroll
 * padding (nav + tabs) the tab sits in, and as much at the bottom, so it
 * keeps its height. Just before the bar sticks the tabs sit in that padding
 * without the stuck rule's margin, and a focus on one scrolled the page up
 * by up to 322 px; with the lift it lands where it is, stuck or not. Lower
 * down the lift is 0: the tab is plain content and the stylesheet decides.
 */
export function liftPhoneTabs(host: HTMLElement): void {
  const tabs = host.querySelectorAll<HTMLElement>('.mpo-tabs [role="tab"]');
  if (!tabs.length) return;
  const padding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  for (const tab of tabs) {
    const lift = tabLift(padding, tab.getBoundingClientRect().top);
    if (lifted.get(tab) === lift) continue;
    lifted.set(tab, lift);
    tab.style.scrollMargin = lift > 0 ? `${-lift}px 0 ${lift}px` : '';
  }
}

/**
 * Keeps the tabs' lifts current, so focusing a tab never moves the page: on
 * a key that can move focus, before it does (Tab, Shift+Tab, the tabs' arrow
 * keys), and a frame after every scroll, for a focus by script (a sheet that
 * hands focus back). Returns the cleanup for the screen's DestroyRef.
 */
export function keepPhoneTabFocusInPlace(host: HTMLElement): () => void {
  let frame: number | null = null;
  const lift = (): void => {
    frame = null;
    liftPhoneTabs(host);
  };
  const onScroll = (): void => {
    frame ??= requestAnimationFrame(lift);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (TAB_FOCUS_KEYS.has(event.key)) lift();
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('keydown', onKey);
  return () => {
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('keydown', onKey);
    if (frame !== null) cancelAnimationFrame(frame);
  };
}
