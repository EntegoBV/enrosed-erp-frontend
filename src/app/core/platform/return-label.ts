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
  return ['/costs', '/files', '/login', '/offerte', '/voorwaarden'].some((root) => under(path, root));
}

/** The name of the screen behind a URL, as it reads after "Terug naar". */
export function returnLabel(url: string): string {
  const path = pathOf(url);
  if (/^\/purchasing\/\d+(?:[/]|$)/.test(path)) return 'inkooporder';
  if (under(path, '/purchasing')) return 'Inkoop';
  if (/^\/sales\/\d+(?:[/]|$)/.test(path)) return 'verkooporder';
  if (under(path, '/sales') || under(path, '/revisions')) return 'Verkoop';
  if (under(path, '/analyses')) return 'Analyses';
  if (/^\/products\/\d+(?:[/]|$)/.test(path)) return 'product';
  if (under(path, '/products')) return 'Producten';
  if (under(path, '/customers')) return 'Klanten';
  if (under(path, '/suppliers')) return 'Leveranciers';
  if (under(path, '/settings')) return 'Instellingen';
  if (under(path, '/activity')) return 'Logboek';
  if (under(path, '/website')) return 'Website';
  if (under(path, '/more')) return 'Meer';
  if (under(path, '/dashboard')) return 'Dashboard';
  return 'ERP';
}

/** Exposed for WorkspaceReturn, which keys refined labels by path. */
export function returnPath(url: string): string {
  return pathOf(url);
}
