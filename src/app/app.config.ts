import { ApplicationConfig, ErrorHandler, Injector, inject, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  TitleStrategy, provideRouter, withComponentInputBinding, withInMemoryScrolling, withNavigationErrorHandler, withRouterConfig,
} from '@angular/router';

import { routes } from './app.routes';
import { authInterceptor } from './core/api/auth.interceptor';
import { InFlight, inFlightInterceptor } from './core/api/in-flight';
import { NavHistory } from './core/platform/nav-history-service';
import { isStaleChunkError, reloadForStaleChunk } from './core/platform/reload-guard';
import type { StaleChunkContext } from './core/platform/reload-guard';
import { EnrosedTitleStrategy } from './core/platform/title-strategy';

/**
 * After a deploy the hashed chunk a still-open tab wants to lazy-load no
 * longer exists, navigation fails and every tap seems dead. The only cure
 * is a fresh load of the new build (reload-guard.ts reloadForStaleChunk):
 * once per address and running build, so a genuinely broken build cannot
 * loop; at once after a failed navigation, and outside one as soon as no
 * sheet, field, save or unsaved work is in the way. An open session normally
 * gets a new build before it meets a missing chunk (fresh-build-service.ts);
 * the two share one record and one set of questions.
 */
function staleChunkContext(injector: Injector): StaleChunkContext {
  /* Looked up at the moment of the error: an eager inject in the ErrorHandler would be a cycle through the Router. */
  return {
    writes: () => injector.get(InFlight).writes,
    keepStack: () => { injector.get(NavHistory).keepForReload(); },
  };
}

class StaleBuildErrorHandler implements ErrorHandler {
  private readonly injector = inject(Injector);

  handleError(error: unknown): void {
    if (isStaleChunkError(error) && reloadForStaleChunk(window, staleChunkContext(this.injector), false)) return;
    console.error(error);
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useClass: StaleBuildErrorHandler },
    provideHttpClient(withInterceptors([authInterceptor, inFlightInterceptor])),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
      /* A back the guard refuses (the leave question's Annuleren) goes forward again to the entry it left. The default,
         'replace', stays one entry lower and writes the editor's URL over that entry: NavHistory's steps no longer fit, so
         the next back is dead or lands one screen too far. Every entry needs its ɵrouterPageId for this: a location.replaceState
         of our own passes this.location.getState() along. */
      withRouterConfig({ canceledNavigationResolution: 'computed' }),
      withNavigationErrorHandler((event) => {
        if (isStaleChunkError(event.error)) reloadForStaleChunk(window, staleChunkContext(inject(Injector)), true);
      }),
    ),
    /* Route titles in the browser tab; a page header's own title wins (title-strategy.ts). */
    { provide: TitleStrategy, useClass: EnrosedTitleStrategy },
  ],
};
