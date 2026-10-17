/**
 * What moves on a phone push, pop or tab switch: the arriving page's
 * content blocks, never its fixed bars or sheets. Pure (it takes any
 * element-like tree) and import-free: node-tested.
 *
 * The page host is the routed component, or for the four wrapper screens
 * (sales, purchase and product screens, the dashboard) their child
 * (critique B7). Below a host:
 * - .content (legacy pages) and the page header's large title (the bar
 *   itself never moves);
 * - the children of .ios-page and .mpo-phone (kit pages, the phone PO):
 *   app-ios-nav's blocks except its bar, plain elements, and the children
 *   of display:contents component hosts (the home's Kas hero);
 * - never a fixed bar, an overlay or anything that holds one: a transform
 *   on it would trap the fixed element (trap rule).
 */

export interface MotionNode {
  readonly localName: string;
  readonly classList: { contains(token: string): boolean };
  readonly children: ArrayLike<MotionNode>;
  /** True when this node or a descendant is a fixed bar, an overlay or a sheet. */
  holdsFixed(): boolean;
  /** The computed display ('contents' for a pass-through host). */
  display(): string;
}

/** The wrapper screens whose child is the page host. */
export const NAV_WRAPPER_HOSTS: readonly string[] = ['app-sales-screen', 'app-purchase-screen', 'app-product-screen', 'app-dashboard-home'];

/** Never moved: fixed bars and overlays, and the hosts that render them. */
export const NAV_FIXED_SELECTOR = [
  'app-sheet', 'app-context-menu', 'app-ios-tabbar', '.overlay', '.ios-tabbar', '.ios-accessory', '.ios-toolbar',
  '.ios-float', '.action-bar', '[class*="dock"]', '.fab', '.tabbar',
].join(', ');

const KIT_ROOTS = ['ios-page', 'mpo-phone'];

function list<T>(items: ArrayLike<T>): T[] {
  return Array.from(items);
}

function isComponentHost(node: MotionNode): boolean {
  return node.localName.includes('-');
}

function kitChildren(root: MotionNode, out: MotionNode[]): void {
  for (const child of list(root.children)) {
    if (child.localName === 'app-ios-nav') {
      for (const block of list(child.children)) {
        if (!block.classList.contains('ios-nav') && !block.holdsFixed()) out.push(block);
      }
    } else if (child.holdsFixed()) {
      continue;
    } else if (isComponentHost(child) && child.display() === 'contents') {
      for (const inner of list(child.children)) if (!inner.holdsFixed()) out.push(inner);
    } else {
      out.push(child);
    }
  }
}

/** The page hosts under .main (router-outlet excluded, wrappers unwrapped). */
export function navPageHosts(main: MotionNode): MotionNode[] {
  return list(main.children)
    .filter((child) => child.localName !== 'router-outlet')
    .flatMap((child) => (NAV_WRAPPER_HOSTS.includes(child.localName) ? list(child.children) : [child]));
}

export function navMotionTargets(main: MotionNode): MotionNode[] {
  const out: MotionNode[] = [];
  for (const host of navPageHosts(main)) {
    for (const child of list(host.children)) {
      if (child.classList.contains('content')) {
        if (!child.holdsFixed()) out.push(child);
      } else if (child.localName === 'app-page-header') {
        for (const block of list(child.children)) if (block.classList.contains('appbar__large')) out.push(block);
      } else if (KIT_ROOTS.some((root) => child.classList.contains(root))) {
        kitChildren(child, out);
      }
    }
  }
  return out;
}

/** The keyframes of a direction: a 28 px slide plus a fade for push and pop, a fade for a tab switch. */
export function navMotionKeyframes(direction: 'push' | 'pop' | 'tab', shiftPx: number): Keyframe[] {
  if (direction === 'tab') return [{ opacity: 0 }, { opacity: 1 }];
  const from = direction === 'push' ? shiftPx : -shiftPx;
  return [{ opacity: 0, transform: `translateX(${from}px)` }, { opacity: 1, transform: 'none' }];
}

/** A CSS time token ('320ms', '.2s') in milliseconds; 0 when absent. */
export function cssTimeMs(value: string): number {
  const text = value.trim();
  const number = parseFloat(text);
  if (!Number.isFinite(number)) return 0;
  return text.endsWith('ms') ? number : text.endsWith('s') ? number * 1000 : number;
}
