export type SidebarGroup = 'verkoop' | 'inkoop' | 'producten' | 'analyses' | 'bedrijf';

/**
 * Keep the desktop accordion aligned with the page that is actually open.
 * Query-backed settings pages live with the workflow they configure.
 */
export function sidebarGroupForUrl(url: string): SidebarGroup | null {
  const [path = '', query = ''] = url.split('?', 2);
  const section = new URLSearchParams(query.split('#', 1)[0]).get('sectie');

  if (
    path.startsWith('/sales')
    || path.startsWith('/revisions')
    || path.startsWith('/customers')
    || path.startsWith('/klantlogins')
    || path.startsWith('/contactaanvragen')
    || path.startsWith('/prospects')
    || path.startsWith('/countries')
    || section === 'discounts'
  ) return 'verkoop';

  if (
    path.startsWith('/purchasing')
    || path.startsWith('/suppliers')
    || section === 'duties'
  ) return 'inkoop';

  if (
    path.startsWith('/products')
    || path.startsWith('/stock')
    || path.startsWith('/stock-locations')
    || path.startsWith('/barcodes')
    || path.startsWith('/categories')
    || path.startsWith('/catalog-export')
    || path.startsWith('/catalog/texts')
    || section === 'categories'
    || section === 'catalog-data'
  ) return 'producten';

  if (path.startsWith('/analyses')) return 'analyses';

  /* The company group: Logboek, Bedrijfsgegevens, Voorwaarden & privacy,
     Verwijderde items, and the settings overview itself. The settings of
     this device (notifications, appearance) belong to no group. */
  if (
    path.startsWith('/activity')
    || path.startsWith('/voorwaarden')
    || path === '/settings/deleted-items'
    || (path === '/settings' && !section)
    || section === 'company'
    /* The settings tab strip stays inside Bedrijf: legal, website and this device's view. */
    || (path === '/settings' && (section === 'legal' || section === 'website' || section === 'appearance' || section === 'device'))
  ) return 'bedrijf';

  return null;
}

/** A real accordion: opening one section closes the previous one. */
export function toggleSidebarGroup(
  current: SidebarGroup | null,
  requested: SidebarGroup,
): SidebarGroup | null {
  return current === requested ? null : requested;
}
