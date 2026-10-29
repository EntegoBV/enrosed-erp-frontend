/**
 * The phone tab bar's long press (2026-10-20): a finger held on Verkoop,
 * Inkoop or Producten opens a menu above that tab with the section's
 * pages, so a sub-page is one press away instead of a detour through Meer.
 * Home has no sub-pages and Meer is the full list: they get no menu.
 *
 * Which rows a tab gets and what a press decides live here; the shell
 * (app.ts) holds the timer, the listeners and the DOM. Pure, node-tested:
 * type-only imports.
 */
import type { NavGroup, NavGroupId, NavItem } from './nav-items';

/** Held this long (ms) without moving further than the slop (px), a press opens the menu. */
export const TAB_MENU_HOLD_MS = 450;
export const TAB_MENU_SLOP_PX = 10;
/** The click that trails a long press lands within this long (ms) after the finger lifts. */
export const TAB_MENU_CLICK_GUARD_MS = 700;
/** The menu's widest width (px); on a narrower bar it takes the bar's width. */
export const TAB_MENU_WIDTH = 248;
/** The navigation info of a row whose page arrives as a push (nav-direction.ts; App.menuRowInfo decides). */
export const TAB_MENU_PUSH = { nav: 'push' } as const;

/** The phone tabs (phone-tabs.ts PhoneTab) that have a menu. */
export type MenuTab = 'sales' | 'purchasing' | 'products';

/** The NAV_GROUPS group behind each tab with a menu. */
export const TAB_MENU_GROUP: Readonly<Record<MenuTab, NavGroupId>> = {
  sales: 'verkoop',
  purchasing: 'inkoop',
  products: 'producten',
};

export function hasTabMenu(tab: string): tab is MenuTab {
  return Object.hasOwn(TAB_MENU_GROUP, tab);
}

export interface TabMenuRow {
  item: NavItem;
  /** The phone label: the short one where defined; the tab root in full ("Verkooporders"), its short label is the tab's own. */
  label: string;
}

export interface TabMenu {
  tab: MenuTab;
  /** The menu's accessible name: the tab's label. */
  label: string;
  rows: TabMenuRow[];
}

/**
 * A tab's menu: its root first, then the group's other pages in sidebar
 * order. What the phone gets follows Meer (meerItems): every page except
 * the tab roots, the ones the desk keeps for wide screens included.
 */
export function tabMenuFor(tab: string, groups: readonly NavGroup[]): TabMenu | null {
  if (!hasTabMenu(tab)) return null;
  const group = groups.find((candidate) => candidate.id === TAB_MENU_GROUP[tab]);
  if (!group) return null;
  const roots = group.items.filter((item) => item.tabRoot).map((item) => ({ item, label: item.label }));
  const pages = group.items.filter((item) => !item.tabRoot).map((item) => ({ item, label: item.short ?? item.label }));
  return { tab, label: group.short ?? group.label, rows: [...roots, ...pages] };
}

/** The path of a router URL, without query string or fragment. */
function pathOf(url: string): string {
  const cut = url.search(/[?#]/);
  const path = cut < 0 ? url : url.slice(0, cut);
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/**
 * True when the screen at url lies under the page at link: on it, below its
 * path (an exact row too: Jaarinventaris lies under Voorraad), or below it
 * by the parent chain `up` names (page-parent.ts parentOf: the Catalogus
 * PDF's texts lie under Catalogus PDF). Picked from the menu, that page is
 * the way up, so App.menuRowInfo leaves its direction to nav-direction.ts.
 */
export function liesUnder(url: string, link: string, up: (url: string) => string | null): boolean {
  const seen = new Set<string>();
  for (let at: string | null = url; at !== null && !seen.has(at); at = up(at)) {
    seen.add(at);
    const path = pathOf(at);
    if (path === link || path.startsWith(link + '/')) return true;
  }
  return false;
}

/** A finger, pen or mouse button held on a tab with a menu. */
export interface TabPress {
  tab: MenuTab;
  pointerId: number;
  x: number;
  y: number;
  /** The menu opened during this press: lifting the finger is no tap. */
  opened: boolean;
}

export interface PointerStart {
  pointerId: number;
  clientX: number;
  clientY: number;
  isPrimary: boolean;
  button: number;
}

/** A press starts with the primary pointer's main button on a tab with a menu. */
export function startTabPress(tab: string, pointer: PointerStart): TabPress | null {
  if (!hasTabMenu(tab) || !pointer.isPrimary || pointer.button !== 0) return null;
  return { tab, pointerId: pointer.pointerId, x: pointer.clientX, y: pointer.clientY, opened: false };
}

/** Moved past the slop before the menu opened: a scroll or a slip, the press is over. Once open, the finger may slide onto a row. */
export function pressWandered(press: TabPress, x: number, y: number): boolean {
  return !press.opened && Math.hypot(x - press.x, y - press.y) > TAB_MENU_SLOP_PX;
}

/** Until when (ms) the tab's click is swallowed after a press ends: only a press that opened the menu has no tap. */
export function clickGuardAfter(press: TabPress, now: number): number {
  return press.opened ? now + TAB_MENU_CLICK_GUARD_MS : 0;
}

/** The keyboard's way to the menu on a focused tab: the context-menu key or Shift+F10. */
export function isMenuKey(event: { key: string; shiftKey: boolean }): boolean {
  return event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
}

/** The row an arrow, Home or End key moves the focus to (wrapping), or null for any other key. */
export function menuFocusIndex(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowDown': return index < 0 ? 0 : (index + 1) % count;
    case 'ArrowUp': return index < 0 ? count - 1 : (index - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}

/**
 * Where the menu stands over a tab centred at tabCenter on a bar from
 * barLeft to barRight (px): centred on the tab and kept within the bar, so
 * it never covers the '+' beside it. origin is the tab's x inside the
 * menu, where the menu grows from.
 */
export function tabMenuPlacement(tabCenter: number, barLeft: number, barRight: number): { left: number; width: number; origin: number } {
  const width = Math.max(0, Math.min(TAB_MENU_WIDTH, barRight - barLeft));
  const left = Math.max(barLeft, Math.min(tabCenter - width / 2, barRight - width));
  return { left: Math.round(left), width: Math.round(width), origin: Math.round(tabCenter - left) };
}

/** The menu's fixed geometry (shell-tabbar.scss): a 44 px row, the 1 px rule with 4 px above and below, 6 px padding and a 1 px border on each side. */
export const TAB_MENU_ROW_PX = 44;
export const TAB_MENU_RULE_PX = 9;
export const TAB_MENU_FRAME_PX = 14;
/** Beside a rail: the gap to the rail and the least margin to the screen's edges (px). */
export const TAB_MENU_SIDE_GAP = 10;
export const TAB_MENU_SIDE_MARGIN = 12;

/** The menu's height (px) for its row count: the rows, the rule after the tab's own list, the frame. */
export function tabMenuHeight(rows: number): number {
  return TAB_MENU_FRAME_PX + rows * TAB_MENU_ROW_PX + (rows > 1 ? TAB_MENU_RULE_PX : 0);
}

/**
 * Where the menu stands beside a tab of the vertical rail (nav-rail.ts; px, the viewport's): on the page's side of
 * the rail (left of a right rail), centred on the tab and kept on screen inside the safe area's top and bottom (at
 * least the margin; the home indicator is 34 px on the iPhone Duo), so a finger held on the tab slides straight
 * across onto a row. top and maxHeight replace the bottom bar's bottom; origin and originY are the tab's centre
 * inside the menu, where it grows from.
 */
export function tabMenuSidePlacement(
  tab: { top: number; bottom: number },
  rail: { left: number; right: number },
  viewport: { width: number; height: number },
  rows: number,
  safe: { top: number; bottom: number } = { top: 0, bottom: 0 },
): { left: number; width: number; top: number; maxHeight: number; origin: number; originY: number } {
  const onRight = rail.left + rail.right > viewport.width;
  const room = (onRight ? rail.left : viewport.width - rail.right) - TAB_MENU_SIDE_GAP - TAB_MENU_SIDE_MARGIN;
  const width = Math.max(0, Math.min(TAB_MENU_WIDTH, room));
  const left = onRight ? rail.left - TAB_MENU_SIDE_GAP - width : rail.right + TAB_MENU_SIDE_GAP;
  const minTop = Math.max(TAB_MENU_SIDE_MARGIN, safe.top);
  const maxBottom = viewport.height - Math.max(TAB_MENU_SIDE_MARGIN, safe.bottom);
  const height = Math.min(tabMenuHeight(rows), Math.max(0, maxBottom - minTop));
  const centre = (tab.top + tab.bottom) / 2;
  const top = Math.max(minTop, Math.min(centre - height / 2, maxBottom - height));
  return {
    left: Math.round(left),
    width: Math.round(width),
    top: Math.round(top),
    maxHeight: Math.round(maxBottom - top),
    origin: Math.round((rail.left + rail.right) / 2 - left),
    originY: Math.round(centre - top),
  };
}
