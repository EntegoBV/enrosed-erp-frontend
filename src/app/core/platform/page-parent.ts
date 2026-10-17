/**
 * The way up from a screen: the parent a desk crumb ("Inkoop › PO-2026-025")
 * and a phone back control fall back to.
 *
 * Only detail screens have a parent. Root screens (lists, settings, Meer,
 * the dashboard) return null: on the desk the sidebar is their way around,
 * on the phone the tab bar. Pure and import-free: node-tested.
 */

export interface PageParent {
  /** The crumb text on the desk ("Inkoop"). */
  label: string;
  /** Where the crumb leads when there is no history entry to return to. */
  url: string;
  /** The back label on the phone when there is no previous screen ("Vandaag" for the dashboard). */
  phoneLabel: string;
}

/** The path of a router URL, without query string or fragment. */
export function urlPath(url: string): string {
  const cut = url.search(/[?#]/);
  const path = cut < 0 ? url : url.slice(0, cut);
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

const parent = (label: string, url: string, phoneLabel = label): PageParent => ({ label, url, phoneLabel });

export function parentOf(url: string): PageParent | null {
  const path = urlPath(url);
  let match: RegExpMatchArray | null;

  if (/^\/sales\/[^/]+(?:\/edit)?$/.test(path)) return parent('Verkoop', '/sales');
  if (/^\/prospects\/[^/]+$/.test(path)) return parent('Prospects', '/prospects');
  if (/^\/purchasing\/[^/]+(?:\/edit)?$/.test(path)) return parent('Inkoop', '/purchasing');
  if ((match = path.match(/^\/products\/([^/]+)\/(?:edit|translations)$/)) && match[1] !== 'new') {
    return parent('Product', `/products/${match[1]}`);
  }
  if (/^\/products\/[^/]+$/.test(path)) return parent('Producten', '/products');
  if (/^\/stock\/inventaris\/(?:telling|afsluiting)\/[^/]+$/.test(path)) {
    return parent('Jaarinventaris', '/stock/inventaris');
  }
  if (path === '/dashboard/agenda' || path === '/dashboard/open') return parent('Dashboard', '/dashboard', 'Vandaag');
  if (path === '/settings/deleted-items') return parent('Instellingen', '/settings');
  if (path === '/catalog/texts') return parent('Catalogus PDF', '/catalog-export');
  return null;
}
