import { Injectable, computed, inject, signal } from '@angular/core';
import { Location, ViewportScroller } from '@angular/common';
import { NavigationCancel, NavigationCancellationCode, NavigationEnd, NavigationStart, Router, Scroll } from '@angular/router';
import {
  currentNavEntry, emptyNavStack, hostStack, lastUrlFor, navPath, recordNavigation, screenBelow, screensBelow, upTarget,
} from './nav-history';
import type { NavRecord } from './nav-history';
import { screenLabel } from './return-label';

/**
 * The in-app history as the browser keeps it (see nav-history.ts), for back
 * labels and the way up.
 *
 * - below(): the screen back returns to, or null when back would leave the
 *   app (deep link, reload). The sections of one screen (/analyses/:section)
 *   count as one: back skips them in one step;
 * - belowLabel(): that screen's phone label ("Verkoop", "Order", "Meer");
 * - up(parentUrl): the desk crumb and a detail screen's way up. History
 *   back when the screen below is the parent (its filters and scroll kept),
 *   otherwise the last URL seen for the parent's path, or the parent;
 * - back(fallbackUrl): history back to the screen below when there is one,
 *   otherwise fallbackUrl.
 *
 * Navigations it starts carry info { nav: 'pop' } for the phone motion.
 * Instantiated by the App shell so it records from the first navigation.
 */
@Injectable({ providedIn: 'root' })
export class NavHistory {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly scroller = inject(ViewportScroller);
  private readonly stack = signal(emptyNavStack());
  private pending: Omit<NavRecord, 'url'> | null = null;
  /** A back the guard refused: where the page stood, until its way forward again has passed the router's scroller. */
  private refused: { path: string; position: [number, number] } | null = null;

  readonly current = computed(() => currentNavEntry(this.stack())?.url ?? null);
  private readonly screenBelow = computed(() => screenBelow(this.stack()));
  readonly below = computed(() => this.screenBelow()?.entry.url ?? null);
  readonly belowLabel = computed(() => {
    const below = this.below();
    return below ? screenLabel(below) : '';
  });
  /** The screens up to the current one, bottom first (nav-history.ts hostStack), for the native host's stack. */
  readonly hostStack = computed(() => hostStack(this.stack()));

  constructor() {
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        const extras = this.router.currentNavigation()?.extras;
        this.pending = {
          id: event.id,
          trigger: event.navigationTrigger ?? 'imperative',
          replace: !!(extras?.replaceUrl || extras?.skipLocationChange),
          restoredId: event.restoredState?.navigationId ?? null,
        };
        if (event.navigationTrigger !== 'popstate') this.refused = null;
      } else if (event instanceof NavigationEnd) {
        const pending = this.pending?.id === event.id
          ? this.pending
          : { id: event.id, trigger: 'imperative' as const, replace: false, restoredId: null };
        this.pending = null;
        this.stack.update((stack) => recordNavigation(stack, { ...pending, url: event.urlAfterRedirects }));
      } else if (event instanceof NavigationCancel) {
        if (event.code === NavigationCancellationCode.GuardRejected && this.pending?.id === event.id && this.pending.trigger === 'popstate') {
          this.refused = { path: navPath(this.router.url), position: this.scroller.getScrollPosition() };
        }
      } else if (event instanceof Scroll) {
        this.keepRefusedPosition();
      }
    });
  }

  /**
   * A refused back goes forward again (canceledNavigationResolution 'computed', app.config.ts) and the router's scroller
   * sends that navigation to the top like any other: Annuleren on the leave question jumped to the top of the form. This
   * event reaches us before the scroller's own listener, so the position goes back right after it, before a paint.
   */
  private keepRefusedPosition(): void {
    const refused = this.refused;
    this.refused = null;
    if (refused && navPath(this.router.url) === refused.path) {
      queueMicrotask(() => this.scroller.scrollToPosition(refused.position, { behavior: 'instant' }));
    }
  }

  /** The last full URL seen for a path (with its query), or null. */
  lastUrlFor(path: string): string | null {
    return lastUrlFor(this.stack(), path);
  }

  /** Where up() goes as a link target (for an href that ⌘-click can open). */
  upHref(parentUrl: string): string {
    const target = upTarget(this.stack(), parentUrl);
    return target.back ? (this.below() ?? parentUrl) : target.url;
  }

  up(parentUrl: string): void {
    const target = upTarget(this.stack(), parentUrl);
    if (target.back) this.location.historyGo(-target.steps);
    else void this.router.navigateByUrl(target.url, { info: { nav: 'pop' } });
  }

  /**
   * The native host popped `count` screens: history back to the screen that
   * many screens below (as far as history reaches); when nothing lies below,
   * `webBack` runs the page's own back control instead (a workspace's way
   * out, a folder's level up). Returns false when it had to fall back.
   */
  popScreens(count: number, webBack: () => void): boolean {
    const target = screensBelow(this.stack(), count);
    if (target) { this.location.historyGo(-target.steps); return true; }
    webBack();
    return false;
  }

  back(fallbackUrl: string): void {
    const below = this.screenBelow();
    if (below) { this.location.historyGo(-below.steps); return; }
    /* A fallback with its own query is meant as it is; a bare path returns with the filters last seen there. */
    const url = /[?#]/.test(fallbackUrl) ? fallbackUrl : (this.lastUrlFor(fallbackUrl) ?? fallbackUrl);
    void this.router.navigateByUrl(url, { info: { nav: 'pop' } });
  }
}
