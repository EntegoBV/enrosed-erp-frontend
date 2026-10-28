import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/**
 * The one phone/desk breakpoint, the same in JS and in every stylesheet:
 * - phone: narrower than 680 px, or a touch screen without hover narrower
 *   than 1024 px (an unfolded iPhone Duo is 669 x 951 points and reports
 *   hover: none in every pose; so do a landscape iPhone and an iPad held
 *   upright);
 * - desk: 1024 px and up, or 680 px and up with a hovering pointer (a
 *   desktop window, a laptop, the Browser pane).
 * The two lists are exact complements. Stylesheets write them out in full,
 * so a grep for either string finds every rule of that shell.
 */
export const DESK_MEDIA = '(min-width: 1024px), (min-width: 680px) and (hover: hover)';
export const PHONE_MEDIA = '(max-width: 679.98px), (hover: none) and (max-width: 1023.98px)';
/** The wide phone shell: a touch screen of 600 px and more (an unfolded iPhone Duo, a landscape iPhone, an upright iPad). */
export const WIDE_PHONE_MEDIA = '(min-width: 600px) and (max-width: 1023.98px) and (hover: none)';

/** Whether the desk shell applies right now (DESK_MEDIA); false without a window. */
export function deskViewport(view: Window | null | undefined = typeof window === 'undefined' ? null : window): boolean {
  return !!view && typeof view.matchMedia === 'function' && view.matchMedia(DESK_MEDIA).matches;
}

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
    this.mediaQuery = view.matchMedia(DESK_MEDIA);
    this.active.set(this.mediaQuery.matches);
    this.mediaQuery.addEventListener('change', this.handleChange);
    this.destroyRef.onDestroy(() => this.mediaQuery?.removeEventListener('change', this.handleChange));
  }

  private readonly handleChange = (event: MediaQueryListEvent): void => {
    this.active.set(event.matches);
  };
}
