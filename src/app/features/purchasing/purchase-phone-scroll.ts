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
