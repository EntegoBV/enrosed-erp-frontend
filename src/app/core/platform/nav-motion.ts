import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart } from '@angular/router';
import type { Router } from '@angular/router';
import type { DesktopViewport } from './desktop-viewport';
import { navDirection } from './nav-direction';
import type { NavDirection, NavTrigger } from './nav-direction';
import { NAV_FIXED_SELECTOR, cssTimeMs, navMotionKeyframes, navMotionTargets } from './nav-motion-targets';
import type { MotionNode } from './nav-motion-targets';
import { PHONE_TABS } from './phone-tabs';
import { prefersReducedMotion } from '../../shared/motion';

/**
 * Phone push, pop and tab motion (iOS feel, design §4 / critique B7).
 *
 * A navigation's direction comes from navDirection(): popstate and the back
 * controls (info { nav: 'pop' }) pop, a deeper screen pushes, another tab
 * fades. On the arriving page's first rendered frame its content blocks
 * (nav-motion-targets.ts: never a fixed bar or a sheet) slide 28 px in over
 * --dur-3 with --ease-spring, or fade in over --dur-1 for a tab.
 *
 * The motion runs on the Web Animations API, not on a CSS class: it leaves
 * every element's own CSS animation untouched (a class swap would restart
 * an .anim-rise or a fade when it is taken away), it moves only what exists
 * at the first render (content arriving later never slides), and nothing
 * remains once it ends. .main carries data-nav="push|pop|tab" while it
 * runs, for anyone who needs to know.
 *
 * Off on a desk (the content fades by CSS), under reduced motion, and when
 * a sheet is open on arrival. The App shell installs it from a lazy chunk;
 * the returned function uninstalls it.
 */
export function installNavMotion(router: Router, document: Document, desktop: DesktopViewport): () => void {
  /* Installed after the app started: the screen on view is where the next one comes from. */
  let previousUrl: string | null = router.navigated ? router.url : null;
  let pending: { id: number; trigger: NavTrigger; info: unknown } | null = null;
  let running: Animation[] = [];
  let clearTimer: ReturnType<typeof setTimeout> | null = null;

  /** Ends a running motion at once (a new navigation starts) and clears data-nav. */
  const stop = () => {
    if (clearTimer) { clearTimeout(clearTimer); clearTimer = null; }
    for (const animation of running) animation.cancel();
    running = [];
    document.querySelector('.main')?.removeAttribute('data-nav');
  };

  const animate = (main: HTMLElement, direction: 'push' | 'pop' | 'tab') => {
    if (main.getAttribute('data-nav') !== direction) return;
    /* A sheet open on arrival is never moved (nor its page). */
    if (main.querySelector('.overlay')) return;
    const tokens = getComputedStyle(document.documentElement);
    const duration = cssTimeMs(tokens.getPropertyValue(direction === 'tab' ? '--dur-1' : '--dur-3'));
    if (duration <= 0) return;
    const easing = (direction === 'tab' ? tokens.getPropertyValue('--ease-out') : tokens.getPropertyValue('--ease-spring')).trim() || 'ease-out';
    const shift = parseFloat(tokens.getPropertyValue('--mo-shift')) || 28;
    const keyframes = navMotionKeyframes(direction, shift);
    for (const target of navMotionTargets(toMotionNode(main))) {
      running.push((target as ElementNode).element.animate(keyframes, { duration, easing, id: `nav-${direction}` }));
    }
  };

  const play = (direction: NavDirection) => {
    if (direction === 'none' || desktop.active() || prefersReducedMotion()) return;
    const main = document.querySelector<HTMLElement>('.main');
    if (!main || typeof main.animate !== 'function') return;
    main.setAttribute('data-nav', direction);
    /* The router has activated the page and change detection is scheduled; a frame callback
       registered now runs after it renders and before that frame paints. */
    requestAnimationFrame(() => animate(main, direction));
    clearTimer = setTimeout(stop, 400);
  };

  const subscription = router.events.subscribe((event) => {
    if (event instanceof NavigationStart) {
      stop();
      pending = {
        id: event.id,
        trigger: event.navigationTrigger ?? 'imperative',
        info: router.currentNavigation()?.extras.info,
      };
    } else if (event instanceof NavigationEnd) {
      const current = pending?.id === event.id ? pending : null;
      pending = null;
      const previous = previousUrl;
      previousUrl = event.urlAfterRedirects;
      if (!current || previous === null) return;
      play(navDirection(previous, event.urlAfterRedirects, current.trigger, current.info, PHONE_TABS));
    } else if (event instanceof NavigationCancel || event instanceof NavigationError) {
      pending = null;
    }
  });

  return () => { subscription.unsubscribe(); stop(); };
}

interface ElementNode extends MotionNode { readonly element: HTMLElement }

/** The DOM element as the pure target walk sees it. */
function toMotionNode(element: Element): ElementNode {
  return {
    element: element as HTMLElement,
    localName: element.localName,
    classList: element.classList,
    get children() { return Array.from(element.children, toMotionNode); },
    holdsFixed: () => element.matches(NAV_FIXED_SELECTOR) || !!element.querySelector(NAV_FIXED_SELECTOR)
      || getComputedStyle(element).position === 'fixed',
    display: () => getComputedStyle(element).display,
  };
}
