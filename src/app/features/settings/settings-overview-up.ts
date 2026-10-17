import { inject } from '@angular/core';
import { CanMatchFn, RedirectCommand, Router } from '@angular/router';

/**
 * /settings/overzicht, the way up from a settings view (or from Verwijderde
 * items) to the overview: the overview takes the place of the screen it
 * came up from in the history (replaceUrl) instead of stacking on top of it.
 *
 * Up is not a new screen. Pushed, a deep-linked view's phone back led to an
 * overview whose own back returned into that view, and from there up again:
 * a loop that never reached Meer, with a back label that did not name where
 * it went (critique B9). Replaced, the overview's back leads to what lay
 * below the view, or to Meer. On the desk the views are tabs that replace
 * each other already; the crumb now behaves like the Overzicht tab.
 *
 * The navigation's own info (the phone's push or pop motion) is kept.
 */
export const settingsOverviewUp: CanMatchFn = () => {
  const router = inject(Router);
  const info = router.currentNavigation()?.extras.info;
  return new RedirectCommand(router.parseUrl('/settings'), { replaceUrl: true, info: info ?? { nav: 'pop' } });
};
