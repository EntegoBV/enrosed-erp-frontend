import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/** One JS breakpoint for controls that must not exist in the mobile DOM. */
@Injectable({ providedIn: 'root' })
export class DesktopViewport {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private mediaQuery: MediaQueryList | null = null;

  readonly active = signal(false);

  constructor() {
    const view = this.document.defaultView;
    if (!view || typeof view.matchMedia !== 'function') return;
    this.mediaQuery = view.matchMedia('(min-width: 680px)');
    this.active.set(this.mediaQuery.matches);
    this.mediaQuery.addEventListener('change', this.handleChange);
    this.destroyRef.onDestroy(() => this.mediaQuery?.removeEventListener('change', this.handleChange));
  }

  private readonly handleChange = (event: MediaQueryListEvent): void => {
    this.active.set(event.matches);
  };
}
