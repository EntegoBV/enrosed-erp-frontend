import { HttpInterceptorFn } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { finalize } from 'rxjs';

/**
 * Requests that have not answered yet: `writes` change something (a save, an
 * upload), `reads` only fetch. Plain fields, nothing renders from them: the
 * reload for a newer build (fresh-build-service.ts) and the one for a missing
 * chunk (reload-guard.ts) read them to stay out of a running save.
 */
@Injectable({ providedIn: 'root' })
export class InFlight {
  reads = 0;
  writes = 0;
}

/** Counts every HttpClient request while it runs. */
export const inFlightInterceptor: HttpInterceptorFn = (request, next) => {
  const inFlight = inject(InFlight);
  const key = request.method === 'GET' || request.method === 'HEAD' ? 'reads' : 'writes';
  inFlight[key]++;
  return next(request).pipe(finalize(() => { inFlight[key] = Math.max(0, inFlight[key] - 1); }));
};
