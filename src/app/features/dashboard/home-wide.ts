import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/** The wide desk: two columns of cards, the Ook nog preview, the seven agenda days as columns. */
export const HOME_WIDE_QUERY = '(min-width: 1280px)';

/**
 * One source for "the desk is 1280 px or wider" (critique N19): the desk home
 * provides it, so the page (the Ook nog preview) and its Agenda card (columns
 * or rows) read the same signal from one matchMedia listener and never
 * disagree for a frame. The listener goes with the page.
 */
@Injectable()
export class HomeWide {
  private readonly query = window.matchMedia(HOME_WIDE_QUERY);
  readonly active = signal(this.query.matches);

  constructor() {
    const change = (event: MediaQueryListEvent): void => this.active.set(event.matches);
    this.query.addEventListener('change', change);
    inject(DestroyRef).onDestroy(() => this.query.removeEventListener('change', change));
  }
}
