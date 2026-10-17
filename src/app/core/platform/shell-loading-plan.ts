/**
 * The route progress line and the tab-root preloading: the numbers and
 * rules behind shell-loading.ts. Pure and import-free: node-tested.
 */

/** A navigation shows the progress line only once it has waited this long (after its guards, N16). */
export const ROUTE_PROGRESS_DELAY_MS = 200;
/** The line grows to 80 % over this time, then waits for the screen. */
export const ROUTE_PROGRESS_GROW_MS = 2000;

/** The tab roots, loaded ahead when the browser is idle so a tab switch never waits for its chunk. */
export const PRELOAD_PATHS: readonly string[] = ['dashboard', 'sales', 'purchasing', 'products', 'more'];

export interface ConnectionHint {
  saveData?: boolean;
  effectiveType?: string;
}

/** No preloading on a data-saving or 2G connection (navigator.connection; Safari has none, N17). */
export function preloadAllowed(connection: ConnectionHint | null | undefined): boolean {
  if (connection?.saveData) return false;
  const type = connection?.effectiveType ?? '';
  return type !== '2g' && type !== 'slow-2g';
}

/**
 * Whether the shell may preload the staff chunks: only for a signed-in user
 * on a staff screen. A customer on /offerte (often a phone on mobile data)
 * never uses them, and on /login they wait until after signing in.
 */
export function preloadWanted(loggedIn: boolean, bare: boolean): boolean {
  return loggedIn && !bare;
}
