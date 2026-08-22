import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  provideRouter, withComponentInputBinding, withInMemoryScrolling, withNavigationErrorHandler,
} from '@angular/router';

import { routes } from './app.routes';
import { authInterceptor } from './core/api/auth.interceptor';

/**
 * After a deploy the hashed chunk a still-open tab wants to lazy-load no
 * longer exists, navigation fails and every tap seems dead. The only cure
 * is a fresh load of the new build - done once, guarded so a genuinely
 * broken build cannot loop.
 */
function isStaleChunkError(error: unknown): boolean {
  const text = String((error as { message?: string })?.message ?? error ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|error loading dynamically imported module/i.test(text);
}

function reloadForNewBuild(): void {
  const key = 'enrosed.reloaded-for-build';
  if (sessionStorage.getItem(key) === location.href) return;
  sessionStorage.setItem(key, location.href);
  location.reload();
}

class StaleBuildErrorHandler implements ErrorHandler {
  handleError(error: unknown): void {
    if (isStaleChunkError(error)) { reloadForNewBuild(); return; }
    console.error(error);
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useClass: StaleBuildErrorHandler },
    provideHttpClient(withInterceptors([authInterceptor])),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
      withNavigationErrorHandler((event) => {
        if (isStaleChunkError(event.error)) reloadForNewBuild();
      }),
    ),
  ],
};
