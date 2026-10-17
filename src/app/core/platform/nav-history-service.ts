import { Injectable, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import {
  currentNavEntry, emptyNavStack, lastUrlFor, recordNavigation, screenBelow, upTarget,
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
  private readonly stack = signal(emptyNavStack());
  private pending: Omit<NavRecord, 'url'> | null = null;

  readonly current = computed(() => currentNavEntry(this.stack())?.url ?? null);
  private readonly screenBelow = computed(() => screenBelow(this.stack()));
  readonly below = computed(() => this.screenBelow()?.entry.url ?? null);
  readonly belowLabel = computed(() => {
    const below = this.below();
    return below ? screenLabel(below) : '';
  });

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
      } else if (event instanceof NavigationEnd) {
        const pending = this.pending?.id === event.id
          ? this.pending
          : { id: event.id, trigger: 'imperative' as const, replace: false, restoredId: null };
        this.pending = null;
        this.stack.update((stack) => recordNavigation(stack, { ...pending, url: event.urlAfterRedirects }));
      }
    });
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

  back(fallbackUrl: string): void {
    const below = this.screenBelow();
    if (below) { this.location.historyGo(-below.steps); return; }
    /* A fallback with its own query is meant as it is; a bare path returns with the filters last seen there. */
    const url = /[?#]/.test(fallbackUrl) ? fallbackUrl : (this.lastUrlFor(fallbackUrl) ?? fallbackUrl);
    void this.router.navigateByUrl(url, { info: { nav: 'pop' } });
  }
}
