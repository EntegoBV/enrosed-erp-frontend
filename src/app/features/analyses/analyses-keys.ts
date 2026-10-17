/**
 * ⌥1…⌥8 on the desk (design §2.5, critique N24): the eight Analyses tabs in
 * sidebar order. The physical key counts (`event.code`), because ⌥1 types '¡'
 * on a Mac. Pure and import-free: node-tested; the page adds the keyContext()
 * rules (not while typing, not behind a sheet or popover).
 */

/** The tabs in the order of the sidebar's Analyses group (nav-items.ts). */
export const ANALYSES_KEY_TABS = ['cash', 'overview', 'sales', 'inventory', 'purchasing', 'result', 'market', 'website'] as const;
export type AnalysesKeyTab = (typeof ANALYSES_KEY_TABS)[number];

export interface AnalysesKey {
  code: string;
  altKey: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
}

/** The tab ⌥ + digit opens, or null when the key is not one of ours (other modifiers, other keys). */
export function analysesTabForKey(event: AnalysesKey): AnalysesKeyTab | null {
  if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return null;
  const match = /^Digit([1-8])$/.exec(event.code);
  return match ? ANALYSES_KEY_TABS[Number(match[1]) - 1] : null;
}
