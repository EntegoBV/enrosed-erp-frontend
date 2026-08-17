import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { Auth } from './auth';
import { API_BASE } from './api.config';

/**
 * Zet de aanmeldsleutel op elke oproep naar onze eigen API en stuurt terug naar
 * de aanmeldpagina zodra de server hem afwijst.
 *
 * Het portaal blijft er buiten: dat is de klantkant en die heeft geen account,
 * alleen een token in de link.
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
