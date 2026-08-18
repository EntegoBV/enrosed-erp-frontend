import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { Auth } from './auth';
import { API_BASE } from './api.config';

/**
 * Attaches the login key to every call to our own API and returns to the
 * login page the moment the server rejects it.
 *
 * The portal stays out of it: that is the customer side, which has no
 * account - only a token in the link.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(Auth);
  const router = inject(Router);

  const isOurApi = request.url.startsWith(API_BASE);
  const isPortal = request.url.includes('/api/portal/');
  const header = auth.header();

  const outgoing =
    isOurApi && !isPortal && header && !request.headers.has('Authorization')
      ? request.clone({ setHeaders: { Authorization: header } })
      : request;

  return next(outgoing).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && !isPortal && !request.url.includes('/api/auth/me')) {
        auth.logout();
        router.navigate(['/login']);
      }
      return throwError(() => error);
    }),
  );
};
