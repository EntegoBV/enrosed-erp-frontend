import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import {
  GuardsCheckEnd, NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router,
} from '@angular/router';
import type { Route } from '@angular/router';
import { DesktopViewport } from './desktop-viewport';
import {
  PRELOAD_PATHS, ROUTE_PROGRESS_DELAY_MS, ROUTE_PROGRESS_GROW_MS, preloadAllowed,
} from './shell-loading-plan';
import type { ConnectionHint } from './shell-loading-plan';
import { prefersReducedMotion } from '../../shared/motion';

/**
 * Two things that keep the shell from looking stuck while a screen loads
 * (design §3.9 and §6 #21). Installed by App after the first screen, from a
 * lazy chunk.
 *
 * - The route progress: a 2 px accent line at the top of the page (under
 *   the desk toolbar, under the phone's status bar) that appears only when
 *   a navigation still waits 200 ms after its guards (so it never crawls
 *   behind the leave-confirm sheet, N16), grows to 80 % over 2 s, completes
 *   on arrival and fades. Under reduced motion: a still line while waiting.
 *   Above the toolbar (60), under sheets (100); aria-hidden.
 * - Tab-root preloading: when the browser is idle after the first screen,
 *   the five tab roots' chunks load ahead, so switching tabs never waits.
 *   Not on a data-saving or 2G connection; requestIdleCallback only where
 *   it exists (Safari: a 1.5 s timeout, N17).
 */
@Injectable({ providedIn: 'root' })
export class ShellLoading {
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly desktop = inject(DesktopViewport);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private line: HTMLElement | null = null;
  private grow: Animation | null = null;

  install(): void {
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) this.reset();
      else if (event instanceof GuardsCheckEnd && event.shouldActivate) {
        this.clearTimer();
        this.timer = setTimeout(() => this.show(), ROUTE_PROGRESS_DELAY_MS);
      } else if (event instanceof NavigationEnd) this.finish();
      else if (event instanceof NavigationCancel || event instanceof NavigationError) this.reset();
    });
    this.preloadWhenIdle();
  }

  private show(): void {
    this.timer = null;
    const main = this.document.querySelector<HTMLElement>('.main');
    if (!main || this.line) return;
    const line = this.document.createElement('div');
    line.className = 'route-progress';
    line.setAttribute('aria-hidden', 'true');
    const left = Math.max(0, main.getBoundingClientRect().left);
    line.style.cssText = `position:fixed;z-index:70;left:${left}px;right:0;height:2px;`
      + `top:${this.desktop.active() ? 'var(--appbar-h)' : 'var(--safe-t)'};background:var(--rose);`
      + 'border-radius:0 2px 2px 0;transform-origin:left center;pointer-events:none;';
    this.document.body.appendChild(line);
    this.line = line;
    if (prefersReducedMotion() || typeof line.animate !== 'function') return;
    this.grow = line.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(.8)' }],
      { duration: ROUTE_PROGRESS_GROW_MS, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
  }

  private finish(): void {
    this.clearTimer();
    const line = this.line;
    if (!line) return;
    this.line = null;
    this.grow?.cancel();
    this.grow = null;
    if (prefersReducedMotion() || typeof line.animate !== 'function') { line.remove(); return; }
    const done = line.animate([{ transform: 'scaleX(1)', opacity: 1 }, { transform: 'scaleX(1)', opacity: 0 }],
      { duration: 120, easing: 'ease-in', fill: 'forwards' });
    done.onfinish = () => line.remove();
    done.oncancel = () => line.remove();
  }

  private reset(): void {
    this.clearTimer();
    this.grow?.cancel();
    this.grow = null;
    this.line?.remove();
    this.line = null;
  }

  private clearTimer(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  private preloadWhenIdle(): void {
    const view = this.document.defaultView as (Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    }) | null;
    const connection = (view?.navigator as Navigator & { connection?: ConnectionHint } | undefined)?.connection;
    if (!view || !preloadAllowed(connection)) return;
    const run = () => {
      for (const path of PRELOAD_PATHS) {
        const route = this.router.config.find((candidate: Route) => candidate.path === path);
        /* Every route here loads with import(): a promise. Offline, the router loads it when asked. */
        const loading = route?.loadComponent?.();
        if (loading instanceof Promise) loading.catch(() => undefined);
      }
    };
    if (typeof view.requestIdleCallback === 'function') view.requestIdleCallback(run, { timeout: 3000 });
    else view.setTimeout(run, 1500);
  }
}
