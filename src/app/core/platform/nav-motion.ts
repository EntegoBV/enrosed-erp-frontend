import { DOCUMENT } from '@angular/common';
import { Injectable, Injector, afterNextRender, inject } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router } from '@angular/router';
import { DesktopViewport } from './desktop-viewport';
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
 * fades. Right after the arriving page's first render, its content blocks
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
 * a sheet is open on arrival (it is never moved).
 */
@Injectable({ providedIn: 'root' })
export class NavMotion {
  private readonly router = inject(Router);
  private readonly desktop = inject(DesktopViewport);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);

  /* Created lazily after the first navigation (App): that screen is where the next one comes from. */
  private previousUrl: string | null = this.router.navigated ? this.router.url : null;
  private pending: { id: number; trigger: NavTrigger; info: unknown } | null = null;
  private running: Animation[] = [];
  private clearTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.stop();
        this.pending = {
          id: event.id,
          trigger: event.navigationTrigger ?? 'imperative',
          info: this.router.currentNavigation()?.extras.info,
        };
      } else if (event instanceof NavigationEnd) {
        const pending = this.pending?.id === event.id ? this.pending : null;
        this.pending = null;
        const previous = this.previousUrl;
        this.previousUrl = event.urlAfterRedirects;
        if (!pending || previous === null) return;
        const direction = navDirection(previous, event.urlAfterRedirects, pending.trigger, pending.info, PHONE_TABS);
        this.play(direction);
      } else if (event instanceof NavigationCancel || event instanceof NavigationError) {
        this.pending = null;
      }
    });
  }

  private play(direction: NavDirection): void {
    if (direction === 'none' || this.desktop.active() || prefersReducedMotion()) return;
    const main = this.document.querySelector<HTMLElement>('.main');
    if (!main || typeof main.animate !== 'function') return;
    main.setAttribute('data-nav', direction);
    afterNextRender(() => this.animate(main, direction), { injector: this.injector });
    this.clearTimer = setTimeout(() => this.stop(), 400);
  }

  private animate(main: HTMLElement, direction: 'push' | 'pop' | 'tab'): void {
    if (main.getAttribute('data-nav') !== direction) return;
    /* A sheet open on arrival is never moved (nor its page). */
    if (main.querySelector('.overlay')) return;
    const tokens = getComputedStyle(this.document.documentElement);
    const duration = cssTimeMs(tokens.getPropertyValue(direction === 'tab' ? '--dur-1' : '--dur-3'));
    if (duration <= 0) return;
    const easing = (direction === 'tab' ? tokens.getPropertyValue('--ease-out') : tokens.getPropertyValue('--ease-spring')).trim() || 'ease-out';
    const shift = parseFloat(tokens.getPropertyValue('--mo-shift')) || 28;
    const keyframes = navMotionKeyframes(direction, shift);
    for (const target of navMotionTargets(toMotionNode(main))) {
      const element = (target as ElementNode).element;
      this.running.push(element.animate(keyframes, { duration, easing, id: `nav-${direction}` }));
    }
  }

  /** Ends a running motion at once (a new navigation starts) and clears data-nav. */
  private stop(): void {
    if (this.clearTimer) { clearTimeout(this.clearTimer); this.clearTimer = null; }
    for (const animation of this.running) animation.cancel();
    this.running = [];
    this.document.querySelector('.main')?.removeAttribute('data-nav');
  }
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
