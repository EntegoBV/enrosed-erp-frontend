import { inject } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router, UrlTree } from '@angular/router';
import { Auth, isPartnerUser } from './auth';
import type { CurrentUser } from './models';
import { HostBridge } from '../platform/host-bridge';

/*
 * Both guards answer true or a UrlTree, never false: a refused canMatch would
 * let the router try the next route, and '**' (behind authGuard) would send a
 * partner straight back to /partner. When only the credential is stored and
 * the identity is not known yet, they ask the server first (currentUser).
 */

/** Keeps the staff screens closed while nobody is signed in, and sends a partner to the partner portal. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(Auth);
  const router = inject(Router);
  const toLogin = (): UrlTree => router.createUrlTree(['/login'], { queryParams: { returnTo: state.url } });

  if (!auth.isLoggedIn()) return toLogin();
  const decide = (user: CurrentUser | null): boolean | UrlTree => {
    if (!auth.isLoggedIn()) return toLogin();
    return isPartnerUser(user) ? router.createUrlTree(['/partner']) : true;
  };
  const known = auth.user();
  return known ? decide(known) : auth.currentUser().then(decide);
};

/**
 * The partner portal (/partner): a partner passes, staff go to their home,
 * a visitor to the login in partner mode. Inside the native iOS app the
 * portal is not offered; a partner who still lands there passes and the
 * portal's shell only says to open it in Safari.
 */
export const partnerGuard: CanMatchFn = (_route, segments) => {
  const auth = inject(Auth);
  const router = inject(Router);
  const host = inject(HostBridge);
  const path = '/' + segments.map((segment) => segment.path).join('/');
  const toLogin = (): UrlTree => host.present
    ? router.createUrlTree(['/login'])
    : router.createUrlTree(['/login'], { queryParams: { partner: 1, returnTo: path.startsWith('/partner') ? path : '/partner' } });

  if (!auth.isLoggedIn()) return toLogin();
  const decide = (user: CurrentUser | null): boolean | UrlTree => {
    if (!auth.isLoggedIn()) return toLogin();
    /* An unknown identity (no connection) passes: the portal's own calls then answer, a staff session gets 403 there. */
    return user && !isPartnerUser(user) ? router.createUrlTree(['/dashboard']) : true;
  };
  const known = auth.user();
  return known ? decide(known) : auth.currentUser().then(decide);
};
