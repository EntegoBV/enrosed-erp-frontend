/**
 * The views of /settings: which ?sectie= opens which screen, with its tab,
 * title and subtitle. Pure and import-free (node-tested).
 *
 * /settings with no (or an unknown) sectie is the overview; every other
 * view renders on its own, the desk with a tab strip under the toolbar, the
 * phone as a pushed screen. The deep links of the old scroll page keep
 * working: appearance and notifications open "Dit toestel", order-discounts
 * opens Kortingen, categories moves to /website/categories.
 */

export type SettingsView =
  | 'overview' | 'company' | 'legal' | 'website' | 'duties' | 'discounts' | 'catalog-data' | 'device';

export interface SettingsViewInfo {
  id: SettingsView;
  /** The desk tab label. */
  tab: string;
  /** The toolbar title (desk) and the large title (phone). */
  title: string;
  subtitle: string;
  icon: string;
  tone: 'accent' | 'amber' | 'blue' | 'green' | 'plum' | 'grey';
}

export const SETTINGS_VIEWS: readonly SettingsViewInfo[] = [
  { id: 'overview', tab: 'Overzicht', title: 'Instellingen', subtitle: 'Bedrijf, verkoop, website en dit toestel', icon: 'settings', tone: 'grey' },
  { id: 'company', tab: 'Bedrijf', title: 'Bedrijfsgegevens', subtitle: 'Komt op elke offerte, factuur en catalogus', icon: 'settings', tone: 'plum' },
  { id: 'legal', tab: 'Voorwaarden', title: 'Voorwaarden & privacy', subtitle: 'Wat klanten lezen bij offertes en in het portaal', icon: 'book', tone: 'plum' },
  { id: 'website', tab: 'Website', title: 'Prijzen op de website', subtitle: 'Geldt voor alle websitetalen', icon: 'globe', tone: 'blue' },
  { id: 'duties', tab: 'Douane', title: 'Douane', subtitle: 'HS-codes en invoerrechten', icon: 'truck', tone: 'amber' },
  { id: 'discounts', tab: 'Kortingen', title: 'Kortingen', subtitle: 'Staffels per regel en per order', icon: 'tag', tone: 'amber' },
  { id: 'catalog-data', tab: 'Catalogusdata', title: 'Catalogusdata', subtitle: 'Producten in Excel en foto’s als ZIP', icon: 'download', tone: 'green' },
  { id: 'device', tab: 'Dit toestel', title: 'Dit toestel', subtitle: 'Weergave en meldingen op dit toestel', icon: 'bell', tone: 'grey' },
];

/** The ?sectie= values each view answers to; the first is the one links use. */
const SECTIONS: Readonly<Record<string, SettingsView>> = {
  company: 'company',
  legal: 'legal',
  website: 'website',
  duties: 'duties',
  discounts: 'discounts',
  'order-discounts': 'discounts',
  'catalog-data': 'catalog-data',
  device: 'device',
  appearance: 'device',
  notifications: 'device',
};

/** The view a ?sectie= value opens; anything unknown (or none) is the overview. */
export function settingsView(sectie: string | null | undefined, available: readonly SettingsView[] = ALL_VIEWS): SettingsView {
  const view = sectie ? SECTIONS[sectie.trim()] : undefined;
  return view && available.includes(view) ? view : 'overview';
}

const ALL_VIEWS: readonly SettingsView[] = SETTINGS_VIEWS.map((view) => view.id);

export function settingsViewInfo(view: SettingsView): SettingsViewInfo {
  return SETTINGS_VIEWS.find((info) => info.id === view) ?? SETTINGS_VIEWS[0];
}

/**
 * The tabs of the desk strip. Douane leaves the strip once the purchasing
 * screen /douane exists (it is configured from Inkoop); a view this build
 * does not have yet (e.g. legal) is left out.
 */
export function settingsTabs(options: { douaneRoute: boolean; available?: readonly SettingsView[] }): SettingsViewInfo[] {
  const available = options.available ?? ALL_VIEWS;
  return SETTINGS_VIEWS.filter((view) =>
    available.includes(view.id) && !(view.id === 'duties' && options.douaneRoute));
}

/** The query of a view link: none for the overview, else { sectie }. */
export function settingsViewQuery(view: SettingsView): Record<string, string> | null {
  return view === 'overview' ? null : { sectie: view };
}

/**
 * The old categories drawer lives at /website/categories now; its deep link
 * (catalog-translation-issues: ?sectie=categories&category=…&language=…&focus=…)
 * carries the parameters that are present, nothing else.
 */
export function settingsCategoryRedirect(
  params: Readonly<Record<string, string | null | undefined>>,
): { path: string; queryParams: Record<string, string> } | null {
  if (params['sectie'] !== 'categories') return null;
  const queryParams: Record<string, string> = {};
  for (const key of ['category', 'language', 'focus']) {
    const value = params[key];
    if (value) queryParams[key] = value;
  }
  return { path: '/website/categories', queryParams };
}

/**
 * Whether a router URL shows the settings overview: /settings with no (or an
 * unknown) sectie. The phone's "Alle instellingen" goes back to it when it
 * is the screen below instead of stacking a second overview.
 */
export function isSettingsOverviewUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const cut = url.search(/[?#]/);
  const path = (cut < 0 ? url : url.slice(0, cut)).replace(/(.)\/+$/, '$1');
  if (path !== '/settings') return false;
  const query = url.indexOf('?') < 0 ? '' : url.slice(url.indexOf('?') + 1).split('#')[0];
  return settingsView(new URLSearchParams(query).get('sectie')) === 'overview';
}

/** Which card of "Dit toestel" a deep link points at, if any. */
export function deviceFocus(sectie: string | null | undefined): 'notifications' | 'appearance' | null {
  return sectie === 'notifications' || sectie === 'appearance' ? sectie : null;
}
