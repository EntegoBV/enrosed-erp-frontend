/**
 * Which tab of the phone tab bar a screen belongs to.
 *
 * A page the long-press menu of a tab lists (tab-menu.ts) belongs to that
 * tab (Emre, 2026-10-20: fewer trips to Meer): Klanten lights Verkoop,
 * Leveranciers Inkoop, Jaarinventaris Producten, and without history their
 * back control goes up to that tab's root ("‹ Verkoop"). A screen reached
 * only from Meer lights Meer, in agreement with its "‹ Meer". The desk
 * sidebar answers a different question (which group opens); see
 * sidebarGroupForUrl. Pure and import-free: node-tested.
 */

export type PhoneTab = 'home' | 'sales' | 'purchasing' | 'products' | 'more';

/** The five tab roots: no back control on the phone, never a large-title crumb. */
export const PHONE_TAB_ROOTS: Readonly<Record<PhoneTab, string>> = {
  home: '/dashboard',
  sales: '/sales',
  purchasing: '/purchasing',
  products: '/products',
  more: '/more',
};

/**
 * The screens of the four work tabs, each with what lies below it: the tab
 * root, then the pages its long-press menu lists, in menu order (a test
 * keeps these equal to the tab-menu.ts rows). /stock holds Voorraad and
 * Jaarinventaris; /catalog is the Catalogus PDF's texts. The menus' views
 * of Instellingen (Kortingen, Catalogusdata: /settings?sectie=…) stay
 * Instellingen's and light Meer with it.
 */
export const PHONE_TAB_PAGES: Readonly<Record<Exclude<PhoneTab, 'more'>, readonly string[]>> = {
  home: ['/dashboard'],
  sales: ['/sales', '/tica', '/revisions', '/customers', '/klantlogins', '/prospects', '/contactaanvragen', '/countries'],
  purchasing: ['/purchasing', '/suppliers', '/douane'],
  products: ['/products', '/stock', '/stock-locations', '/barcodes', '/categories', '/catalog-export', '/catalog'],
};

/** The path of a router URL, without query string or fragment. */
function pathOf(url: string): string {
  const cut = url.search(/[?#]/);
  return cut < 0 ? url : url.slice(0, cut);
}

/** True for the path itself and anything below it, never for a longer sibling (/stock-locations). */
function under(path: string, root: string): boolean {
  return path === root || path.startsWith(root + '/');
}

export function phoneTabForUrl(url: string): PhoneTab {
  const path = pathOf(url);
  for (const [tab, pages] of Object.entries(PHONE_TAB_PAGES)) {
    if (pages.some((page) => under(path, page))) return tab as PhoneTab;
  }
  return 'more';
}

/** The root of a screen's tab (/sales for Klanten, /more for Logboek): where the phone goes up to when nothing else names the way. */
export function phoneTabRootFor(url: string): string {
  return PHONE_TAB_ROOTS[phoneTabForUrl(url)];
}

/** True only on a tab root itself (any query), e.g. /sales?tab=facturen, never /sales/79. */
export function isPhoneTabRoot(url: string): boolean {
  const path = pathOf(url).replace(/\/+$/, '') || '/';
  return Object.values(PHONE_TAB_ROOTS).includes(path);
}

/** The mapping navDirection takes (nav-direction.ts stays import-free). */
export const PHONE_TABS = { tabOf: phoneTabForUrl, isRoot: isPhoneTabRoot } as const;
