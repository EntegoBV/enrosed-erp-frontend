/**
 * Where the "Terug naar …" link of a workspace leads, in words.
 *
 * Kosten & bank and Documenten & media replace the ERP navigation with
 * their own. Their way out names the screen the user came from, so these
 * two functions decide which URLs count as a place to return to and how
 * such a place is called. Pure and import-free: node-tested.
 */

/** The path of a router URL, without query string or fragment. */
function pathOf(url: string): string {
  const cut = url.search(/[?#]/);
  return cut < 0 ? url : url.slice(0, cut);
}

/** True for the path itself and anything below it, never for a longer sibling (/filesystem). */
function under(path: string, root: string): boolean {
  return path === root || path.startsWith(root + '/');
}

/**
 * Workspaces, redirects and the screens outside the staff ERP are never a
 * place to return to: going back there would loop or leave the ERP.
 */
export function isWorkspaceUrl(url: string): boolean {
  const path = pathOf(url);
  if (path === '' || path === '/') return true;
  return ['/costs', '/files', '/website', '/login', '/offerte', '/voorwaarden'].some((root) => under(path, root));
}

/** The name of the screen behind a URL, as it reads after "Terug naar". */
export function returnLabel(url: string): string {
  const path = pathOf(url);
  if (path === '/purchasing/tracking') return 'Track & trace';
  if (/^\/purchasing\/\d+(?:[/]|$)/.test(path)) return 'inkooporder';
  if (under(path, '/purchasing')) return 'Inkoop';
  if (/^\/sales\/\d+(?:[/]|$)/.test(path)) return 'verkooporder';
  if (under(path, '/sales') || under(path, '/revisions')) return 'Verkoop';
  if (under(path, '/tica')) return 'TICA verkopen';
  if (under(path, '/analyses')) return 'Analyses';
  if (/^\/products\/\d+(?:[/]|$)/.test(path)) return 'product';
  if (under(path, '/products')) return 'Producten';
  if (under(path, '/klantlogins')) return 'Login-aanvragen';
  if (under(path, '/contactaanvragen')) return 'Contactaanvragen';
  if (under(path, '/customers')) return 'Klanten';
  if (under(path, '/prospects')) return 'Prospects';
  if (under(path, '/suppliers')) return 'Leveranciers';
  if (under(path, '/settings')) return 'Instellingen';
  if (under(path, '/activity')) return 'Logboek';
  if (under(path, '/website')) return 'Website';
  if (under(path, '/more')) return 'Meer';
  if (under(path, '/dashboard')) return 'Dashboard';
  if (under(path, '/stock/inventaris')) return 'Jaarinventaris';
  return 'ERP';
}

/** Exposed for WorkspaceReturn, which keys refined labels by path. */
export function returnPath(url: string): string {
  return pathOf(url);
}

/**
 * The views of /settings by their ?sectie=, named as each view titles its
 * screen (settings-sections.ts SETTINGS_VIEWS; a test keeps the two equal).
 * Unknown or no sectie is the overview, "Instellingen".
 */
const SETTINGS_VIEW_LABELS: Readonly<Record<string, string>> = {
  company: 'Bedrijfsgegevens',
  legal: 'Voorwaarden & privacy',
  website: 'Prijzen op de website',
  duties: 'Douane',
  discounts: 'Kortingen',
  'order-discounts': 'Kortingen',
  'catalog-data': 'Catalogusdata',
  device: 'Dit toestel',
  appearance: 'Dit toestel',
  notifications: 'Dit toestel',
};

function settingsViewLabel(url: string): string | null {
  const cut = url.indexOf('?');
  if (cut < 0) return null;
  const sectie = new URLSearchParams(url.slice(cut + 1).split('#')[0]).get('sectie')?.trim() ?? '';
  return Object.hasOwn(SETTINGS_VIEW_LABELS, sectie) ? SETTINGS_VIEW_LABELS[sectie] : null;
}

/**
 * The name of the screen behind a URL as a phone back control shows it
 * ("‹ Verkoop", "‹ Order"): capitalised, the screen's own word. Empty when
 * the screen has no name worth showing; the back control is then a plain
 * chevron circle.
 */
export function screenLabel(url: string): string {
  const path = pathOf(url).replace(/(.)\/+$/, '$1');
  if (path === '/dashboard') return 'Vandaag';
  if (path === '/dashboard/agenda') return 'Agenda';
  if (path === '/dashboard/open') return 'Open punten';
  if (/^\/sales\/[^/]+(?:[/]|$)/.test(path)) return 'Order';
  if (under(path, '/sales')) return 'Verkoop';
  if (under(path, '/tica')) return 'TICA';
  if (under(path, '/revisions')) return 'Wijzigingen';
  if (path === '/purchasing/tracking') return 'Track & trace';
  if (/^\/purchasing\/[^/]+(?:[/]|$)/.test(path)) return 'Inkooporder';
  if (under(path, '/purchasing')) return 'Inkoop';
  if (/^\/products\/[^/]+(?:[/]|$)/.test(path)) return 'Product';
  if (under(path, '/products')) return 'Producten';
  if (under(path, '/customers')) return 'Klanten';
  if (under(path, '/klantlogins')) return 'Login-aanvragen';
  if (under(path, '/contactaanvragen')) return 'Contactaanvragen';
  if (under(path, '/prospects')) return 'Prospects';
  if (under(path, '/suppliers')) return 'Leveranciers';
  if (under(path, '/countries')) return 'Landen & vracht';
  if (under(path, '/stock/inventaris')) return 'Jaarinventaris';
  if (under(path, '/stock')) return 'Voorraad';
  if (under(path, '/stock-locations')) return 'Voorraadlocaties';
  if (under(path, '/barcodes')) return 'EAN-codes';
  if (under(path, '/categories')) return 'Categorieën';
  if (under(path, '/catalog-export')) return 'Catalogus PDF';
  if (under(path, '/catalog')) return 'Catalogusteksten';
  if (under(path, '/settings/deleted-items')) return 'Verwijderde items';
  /* A settings view is a screen of its own ("‹ Kortingen"), not the overview. */
  if (path === '/settings') return settingsViewLabel(url) ?? 'Instellingen';
  if (under(path, '/settings')) return 'Instellingen';
  if (under(path, '/activity')) return 'Logboek';
  if (under(path, '/analyses')) return 'Analyses';
  if (under(path, '/more')) return 'Meer';
  if (under(path, '/costs')) return 'Kosten & bank';
  if (under(path, '/files')) return 'Documenten & media';
  if (under(path, '/website')) return 'Website';
  if (under(path, '/voorwaarden')) return 'Voorwaarden';
  return '';
}

/** The longest label a phone back capsule shows; longer ones become a chevron circle. */
export const BACK_CAPSULE_MAX = 10;

/** The text of a phone back capsule: the label when it fits, '' (chevron circle) otherwise. */
export function capsuleLabel(label: string | null | undefined): string {
  const text = (label ?? '').trim();
  return text.length > 0 && text.length <= BACK_CAPSULE_MAX ? text : '';
}
