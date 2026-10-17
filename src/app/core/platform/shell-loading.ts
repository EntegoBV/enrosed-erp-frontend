import { GuardsCheckEnd, NavigationCancel, NavigationEnd, NavigationError, NavigationStart } from '@angular/router';
import type { Route, Router } from '@angular/router';
import type { DesktopViewport } from './desktop-viewport';
import {
  PRELOAD_PATHS, ROUTE_PROGRESS_DELAY_MS, ROUTE_PROGRESS_GROW_MS, preloadAllowed,
} from './shell-loading-plan';
import type { ConnectionHint } from './shell-loading-plan';
import { prefersReducedMotion } from '../../shared/motion';

/**
 * Two things that keep the shell from looking stuck while a screen loads
 * (design §3.9 and §6 #21). The App shell installs them from a lazy chunk.
 *
 * - The route progress: a 2 px accent line at the top of the page (under
 *   the desk toolbar, under the phone's status bar) that appears only when
 *   a navigation still waits 200 ms after its guards (so it never crawls
 *   behind the leave-confirm sheet, N16), grows to 80 % over 2 s, completes
 *   on arrival and fades. Under reduced motion: a still line while waiting.
 *   Above the toolbar (60), under sheets (100); aria-hidden.
 * - Preloading: when the browser is idle after the first screen, the five
 *   tab roots' chunks load ahead, so switching tabs never waits, and so do
 *   the three workspace sides (deferred in the shell). Not on a data-saving
 *   or 2G connection; requestIdleCallback only where it exists (Safari: a
 *   1.5 s timeout, N17).
 */
export function installShellLoading(router: Router, document: Document, desktop: DesktopViewport): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let line: HTMLElement | null = null;
  let grow: Animation | null = null;

  const clearTimer = () => {
    if (timer) { clearTimeout(timer); timer = null; }
  };

  const reset = () => {
    clearTimer();
    grow?.cancel();
    grow = null;
    line?.remove();
    line = null;
  };

  const show = () => {
    timer = null;
    const main = document.querySelector<HTMLElement>('.main');
    if (!main || line) return;
    const bar = document.createElement('div');
    bar.className = 'route-progress';
    bar.setAttribute('aria-hidden', 'true');
    const left = Math.max(0, main.getBoundingClientRect().left);
    bar.style.cssText = `position:fixed;z-index:70;left:${left}px;right:0;height:2px;`
      + `top:${desktop.active() ? 'var(--appbar-h)' : 'var(--safe-t)'};background:var(--rose);`
      + 'border-radius:0 2px 2px 0;transform-origin:left center;pointer-events:none;';
    document.body.appendChild(bar);
    line = bar;
    if (prefersReducedMotion() || typeof bar.animate !== 'function') return;
    grow = bar.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(.8)' }],
      { duration: ROUTE_PROGRESS_GROW_MS, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
  };

  const finish = () => {
    clearTimer();
    const bar = line;
    if (!bar) return;
    line = null;
    grow?.cancel();
    grow = null;
    if (prefersReducedMotion() || typeof bar.animate !== 'function') { bar.remove(); return; }
    const done = bar.animate([{ transform: 'scaleX(1)', opacity: 1 }, { transform: 'scaleX(1)', opacity: 0 }],
      { duration: 120, easing: 'ease-in', fill: 'forwards' });
    done.onfinish = () => bar.remove();
    done.oncancel = () => bar.remove();
  };

  const subscription = router.events.subscribe((event) => {
    if (event instanceof NavigationStart) reset();
    else if (event instanceof GuardsCheckEnd && event.shouldActivate) {
      clearTimer();
      timer = setTimeout(show, ROUTE_PROGRESS_DELAY_MS);
    } else if (event instanceof NavigationEnd) finish();
    else if (event instanceof NavigationCancel || event instanceof NavigationError) reset();
  });

  const view = document.defaultView as (Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  }) | null;
  const connection = (view?.navigator as Navigator & { connection?: ConnectionHint } | undefined)?.connection;
  if (view && preloadAllowed(connection)) {
    const run = () => {
      for (const path of PRELOAD_PATHS) {
        const route = router.config.find((candidate: Route) => candidate.path === path);
        /* Every route here loads with import(): a promise. Offline, the router loads it when asked. */
        const loading = route?.loadComponent?.();
        if (loading instanceof Promise) loading.catch(() => undefined);
      }
      /* The workspace sides the shell defers (the same chunks). */
      void import('../../features/finance/finance-admin-nav').catch(() => undefined);
      void import('../../features/files/files-admin-nav').catch(() => undefined);
      void import('../../features/website-builder/website-admin-nav').catch(() => undefined);
    };
    if (typeof view.requestIdleCallback === 'function') view.requestIdleCallback(run, { timeout: 3000 });
    else view.setTimeout(run, 1500);
  }

  return () => { subscription.unsubscribe(); reset(); };
}
