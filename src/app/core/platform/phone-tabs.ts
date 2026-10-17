/**
 * Which tab of the phone tab bar a screen belongs to.
 *
 * The tab follows where the screen is listed on the phone: a screen reached
 * only from Meer lights Meer, so the tab bar and the "‹ Meer" back capsule
 * agree. The desk sidebar answers a different question (which group opens);
 * see sidebarGroupForUrl. Pure and import-free: node-tested.
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
  if (under(path, '/dashboard')) return 'home';
  if (under(path, '/sales')) return 'sales';
  if (under(path, '/purchasing')) return 'purchasing';
  if (under(path, '/products') || under(path, '/catalog-export') || under(path, '/catalog')) return 'products';
  return 'more';
}

/** True only on a tab root itself (any query), e.g. /sales?tab=facturen, never /sales/79. */
export function isPhoneTabRoot(url: string): boolean {
  const path = pathOf(url).replace(/\/+$/, '') || '/';
  return Object.values(PHONE_TAB_ROOTS).includes(path);
}

/** The mapping navDirection takes (nav-direction.ts stays import-free). */
export const PHONE_TABS = { tabOf: phoneTabForUrl, isRoot: isPhoneTabRoot } as const;
