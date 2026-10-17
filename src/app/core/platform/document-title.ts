/**
 * The browser tab's title: "Inkooporder — Enrosed". Pure and import-free:
 * node-tested.
 *
 * The router sets a route's title after every navigation; a page header
 * then sets the page's own ("PO-2026-025 — Enrosed"). A navigation that
 * only changes the query (a sales filter, a settings section, a purchase
 * desk tab) must not put the route title back: the page header's title did
 * not change, so it would not set its own again (critique N15).
 */

export const APP_NAME = 'Enrosed';

export function documentTitle(title: string | null | undefined): string {
  const text = (title ?? '').trim();
  return text ? `${text} — ${APP_NAME}` : APP_NAME;
}

/** True when the router should set the route title: the path changed (or there was none yet). */
export function routeTitleApplies(previousPath: string | null, nextPath: string): boolean {
  return previousPath !== nextPath;
}
