/**
 * The staff navigation as one table: the desk sidebar and the phone Meer
 * page both render from it, so the two can never drift apart.
 *
 * - NAV_HOME: the dashboard link above the groups.
 * - NAV_GROUPS: the five accordion groups, in sidebar order. Items marked
 *   tabRoot are phone tabs (Verkooporders, Inkooporders, Producten) and are
 *   not listed again on Meer.
 * - NAV_WORKSPACES: the three workspace doors (sidebar below the groups,
 *   Meer "Snel naar").
 * - NAV_DEVICE: the settings of this device (sidebar foot, Meer "App op
 *   dit toestel").
 *
 * countKey names a WorkQueue count signal; the folded group header sums the
 * counts of its items unless an item opts out (groupCount: false), the way
 * the Verkoop header has always shown action + login requests but not
 * revisions. Areas extend NavCountKey and the rows they own.
 * Pure and import-free: node-tested.
 */

export type NavGroupId = 'verkoop' | 'inkoop' | 'producten' | 'analyses' | 'bedrijf';

/** WorkQueue count signals a navigation item can show. */
export type NavCountKey = 'actionCount' | 'revisionCount' | 'loginRequestCount';

export type NavTone = 'accent' | 'amber' | 'green' | 'blue' | 'plum' | 'grey';

export interface NavItem {
  /** Stable key (tests, track). */
  id: string;
  /** The label in the sidebar. */
  label: string;
  /** The label in the 680–1023 rail and on the phone; defaults to label. */
  short?: string;
  /** The title on Meer when it differs from the sidebar label. */
  meerLabel?: string;
  /** An app-icon name; unique within its group. */
  icon: string;
  /** Router path. */
  link: string;
  /** Query parameters, e.g. { sectie: 'discounts' }. */
  query?: Readonly<Record<string, string>>;
  /** routerLinkActive matches the path exactly (Voorraad must not light on /stock/inventaris). */
  exact?: boolean;
  countKey?: NavCountKey;
  /** false: the count shows on the item but is not added to the folded group header. */
  groupCount?: boolean;
  /** The help line on Meer. */
  hint?: string;
  /** Shown in the 680–899 rail (Home, Verkoop, Inkoop, Producten). */
  railMain?: boolean;
  /** Hidden in the 900–1023 rail as well (the long tail waits under Meer). */
  wide?: boolean;
  /** ISO date until which the item wears a "nieuw" pill. */
  newUntil?: string;
  /** A phone tab root: on the tab bar, so not listed on Meer. */
  tabRoot?: boolean;
  /** The tile tone on Meer. */
  tone?: NavTone;
}

export interface NavGroup {
  id: NavGroupId;
  label: string;
  /** Shorter label where the full one does not fit. */
  short?: string;
  /** The 16 px icon of the sidebar header. */
  icon: string;
  /** The tile icon on Meer; defaults to icon. */
  meerIcon?: string;
  tone: NavTone;
  /** The two-line summary under the group on Meer. */
  hint: string;
  items: readonly NavItem[];
}

export const NAV_HOME: NavItem = {
  id: 'dashboard', label: 'Dashboard', short: 'Home', icon: 'home', link: '/dashboard', railMain: true, tabRoot: true,
};

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: 'verkoop', label: 'Verkoop', icon: 'sales', tone: 'accent',
    hint: 'Wijzigingen, klanten, aanvragen, prospects, landen & vracht en kortingen',
    items: [
      { id: 'sales', label: 'Verkooporders', short: 'Verkoop', icon: 'sales', link: '/sales', countKey: 'actionCount', railMain: true, tabRoot: true },
      { id: 'revisions', label: 'Wijzigingen', icon: 'pencil', link: '/revisions', countKey: 'revisionCount', groupCount: false,
        hint: 'Wijzigingsvoorstellen van klanten beoordelen' },
      { id: 'customers', label: 'Klanten', icon: 'customers', link: '/customers', hint: 'Contacten, voorwaarden en nieuwe orders' },
      { id: 'login-requests', label: 'Login-aanvragen', icon: 'tick', link: '/klantlogins', countKey: 'loginRequestCount',
        hint: 'Aanvragen van de website goedkeuren' },
      { id: 'prospects', label: 'Prospects', meerLabel: 'Prospects & groothandels', icon: 'search', link: '/prospects',
        hint: 'Contactgegevens, outreach en opvolging' },
      { id: 'contact-inquiries', label: 'Contactaanvragen', icon: 'info', link: '/contactaanvragen',
        hint: 'Berichten van het contactformulier opvolgen' },
      { id: 'countries', label: 'Landen & vracht', icon: 'countries', link: '/countries',
        hint: 'Minimumorders, tarieven en verzendorganisaties' },
      { id: 'discounts', label: 'Kortingen', icon: 'tag', link: '/settings', query: { sectie: 'discounts' }, wide: true,
        hint: 'Staffels per regel en per order' },
    ],
  },
  {
    id: 'inkoop', label: 'Inkoop', icon: 'purchase', tone: 'amber',
    hint: 'Leveranciers en douane',
    items: [
      { id: 'purchasing', label: 'Inkooporders', short: 'Inkoop', icon: 'purchase', link: '/purchasing', railMain: true, tabRoot: true },
      { id: 'suppliers', label: 'Leveranciers', icon: 'suppliers', link: '/suppliers', hint: 'Contacten, valuta en levertijden' },
      { id: 'duties', label: 'Douane', icon: 'truck', link: '/douane', hint: 'HS-codes en invoerrechten' },
    ],
  },
  {
    id: 'producten', label: 'Producten & voorraad', short: 'Producten', icon: 'products', meerIcon: 'stock', tone: 'green',
    hint: 'Voorraad, jaarinventaris, locaties, categorieën, EAN en catalogus',
    items: [
      { id: 'products', label: 'Producten', icon: 'products', link: '/products', railMain: true, tabRoot: true },
      { id: 'stock', label: 'Voorraad', icon: 'stock', link: '/stock', exact: true, hint: 'Per locatie tellen en verplaatsen' },
      { id: 'inventory', label: 'Jaarinventaris', short: 'Inventaris', icon: 'list', link: '/stock/inventaris',
        hint: 'Tellen en eindvoorraad met waarde voor de boekhouding' },
      { id: 'stock-locations', label: 'Voorraadlocaties', short: 'Locaties', icon: 'folder', link: '/stock-locations',
        hint: 'Magazijn, stand en wat de website telt' },
      { id: 'barcodes', label: 'EAN-codes', icon: 'barcode', link: '/barcodes', hint: 'Vrije barcodes voor nieuwe producten' },
      { id: 'categories', label: 'Categorieën', icon: 'grid', link: '/categories', wide: true, hint: 'Productgroepen, foto’s en volgorde' },
      { id: 'catalog-data', label: 'Catalogusdata', icon: 'download', link: '/settings', query: { sectie: 'catalog-data' }, wide: true,
        hint: 'Excel-import en -export van productgegevens' },
      { id: 'catalog-export', label: 'Catalogus PDF', icon: 'pdf', link: '/catalog-export', wide: true,
        hint: 'Selecteer producten, taal en prijzen' },
    ],
  },
  {
    id: 'analyses', label: 'Analyses', icon: 'analytics', tone: 'blue',
    hint: 'Kasprognose, verkoop, voorraad, inkoop, resultaat, markt en bezoekers',
    items: [
      { id: 'analyses-cash', label: 'Kasprognose', icon: 'bank', link: '/analyses/cash', newUntil: '2027-01-01',
        hint: 'Banksaldo vandaag en wat er komt' },
      { id: 'analyses-overview', label: 'Overzicht', icon: 'analytics', link: '/analyses/overview',
        hint: 'Belangrijkste waarde, kwaliteit en aandachtspunten' },
      { id: 'analyses-sales', label: 'Verkoop', icon: 'sales', link: '/analyses/sales', hint: 'Pijplijn, conversie, facturen en klanten' },
      { id: 'analyses-inventory', label: 'Voorraad', icon: 'stock', link: '/analyses/inventory',
        hint: 'Waarde, tekorten, inkomend en datakwaliteit' },
      { id: 'analyses-purchasing', label: 'Inkoop', icon: 'purchase', link: '/analyses/purchasing',
        hint: 'Leveranciers, ontvangstkwaliteit, schade en tekort' },
      { id: 'analyses-result', label: 'Resultaat', icon: 'receipt', link: '/analyses/result', hint: 'Omzet, marge en eigen kosten' },
      { id: 'analyses-market', label: 'Markt & container', icon: 'layers', link: '/analyses/market',
        hint: 'Actuele wisselkoersen en containertarieven' },
      { id: 'analyses-website', label: 'Bezoekers', meerLabel: 'Websitebezoekers', icon: 'globe', link: '/analyses/website',
        hint: 'Bezoekers, landen, bronnen en drukste uren' },
    ],
  },
  {
    id: 'bedrijf', label: 'Bedrijf', icon: 'settings', tone: 'plum',
    hint: 'Logboek, bedrijfsgegevens, voorwaarden en verwijderde items',
    items: [
      { id: 'activity', label: 'Logboek', icon: 'activity', link: '/activity', wide: true, hint: 'Belangrijke bedrijfsacties per medewerker' },
      { id: 'company', label: 'Bedrijfsgegevens', icon: 'settings', link: '/settings', query: { sectie: 'company' }, wide: true,
        hint: 'Adres, BTW, IBAN en juridische teksten' },
      { id: 'terms', label: 'Voorwaarden & privacy', icon: 'book', link: '/voorwaarden', wide: true, hint: 'Bekijk wat klanten te zien krijgen' },
      { id: 'deleted-items', label: 'Verwijderde items', icon: 'trash', link: '/settings/deleted-items', wide: true,
        hint: 'Verwijderde offertes, facturen en inkooporders herstellen' },
    ],
  },
];

/** The workspace doors: in the sidebar under the groups, on Meer under "Snel naar". */
export const NAV_WORKSPACES: readonly NavItem[] = [
  { id: 'files', label: 'Documenten & media', short: 'Media', icon: 'media', link: '/files', tone: 'plum',
    hint: 'Foto’s, PDF’s en bestanden beheren en delen' },
  { id: 'costs', label: 'Kosten & bank', short: 'Kosten', icon: 'exchange', link: '/costs', tone: 'green',
    hint: 'Kosten, vaste kosten, banksaldo en analyse' },
  { id: 'website', label: 'Website beheren', short: 'Website', icon: 'globe', link: '/website', tone: 'blue',
    hint: 'Indeling, teksten, SEO, producten en publicatie' },
];

/** This device's settings: the desk sidebar foot and Meer "App op dit toestel". */
export const NAV_DEVICE: readonly NavItem[] = [
  { id: 'notifications', label: 'Meldingen op dit toestel', meerLabel: 'Meldingen', icon: 'bell', link: '/settings',
    query: { sectie: 'notifications' }, tone: 'grey', hint: 'Pushmeldingen en geluiden op dit toestel' },
];

/** The rail's way to the long tail (680–1023). */
export const NAV_MORE: NavItem = { id: 'more', label: 'Meer', icon: 'more', link: '/more', tabRoot: true };

/** The title of an item on Meer. */
export function meerLabel(item: NavItem): string {
  return item.meerLabel ?? item.label;
}

/** The rail and phone label of an item. */
export function shortLabel(item: { label: string; short?: string }): string {
  return item.short ?? item.label;
}

/** True while an item wears its "nieuw" pill. */
export function navItemIsNew(item: NavItem, now: Date = new Date()): boolean {
  if (!item.newUntil) return false;
  const [y, m, d] = item.newUntil.split('-').map(Number);
  return now < new Date(y, (m || 1) - 1, d || 1);
}

/** The full URL of an item (path plus query), e.g. /settings?sectie=discounts. */
export function navItemUrl(item: NavItem): string {
  const query = item.query ? new URLSearchParams(item.query as Record<string, string>).toString() : '';
  return query ? `${item.link}?${query}` : item.link;
}

/**
 * True when an item stands for the open URL. Query-backed items (the
 * settings sections) need their query; plain items match their path and
 * anything below it, or the path only when exact.
 */
export function navItemActive(item: NavItem, url: string): boolean {
  const cut = url.search(/[?#]/);
  const path = cut < 0 ? url : url.slice(0, cut);
  if (item.query) {
    if (path !== item.link) return false;
    const params = new URLSearchParams(cut < 0 ? '' : url.slice(cut + 1).split('#', 1)[0]);
    return Object.entries(item.query).every(([key, value]) => params.get(key) === value);
  }
  if (item.exact) return path === item.link;
  return path === item.link || path.startsWith(item.link + '/');
}

/** The count keys a folded group header adds up (sidebar), or a Meer group row (without the tab roots). */
export function groupCountKeys(group: NavGroup, surface: 'sidebar' | 'meer'): NavCountKey[] {
  return group.items
    .filter((item) => item.countKey && item.groupCount !== false && (surface === 'sidebar' || !item.tabRoot))
    .map((item) => item.countKey as NavCountKey);
}

/** The items Meer lists per group: everything except the phone tab roots. */
export function meerItems(group: NavGroup): NavItem[] {
  return group.items.filter((item) => !item.tabRoot);
}

/** Every navigation target as a full URL, for the "nothing dropped" checks. */
export function allNavUrls(): string[] {
  return [NAV_HOME, ...NAV_GROUPS.flatMap((group) => group.items), ...NAV_WORKSPACES, ...NAV_DEVICE].map(navItemUrl);
}
