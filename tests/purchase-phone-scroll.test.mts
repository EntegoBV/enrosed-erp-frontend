import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { keepPhoneTabFocusInPlace, liftPhoneTabs, phoneStickPoint, phoneTabsStuck, stickPointFor, tabLift } from '../src/app/features/purchasing/purchase-phone-scroll.ts';

/*
 * The phone purchase order's stick point (review round 2): a tab switch, a
 * summary tile or a tap on the open tab scrolls there, and the nav must be
 * condensed on arrival. IosNav condenses once its 1px sentinel no longer
 * intersects the viewport below the nav's rounded height; an edge that only
 * touches still intersects. Positions are fractional, as on a real page.
 */

/** IosNav's condensed state for the sentinel's bottom in the viewport: strictly above the nav's bottom. */
const condensed = (sentinelBottom: number, navHeight: number): boolean => sentinelBottom < navHeight;

/** A host with the kit's nav and sentinel at a document position, read the way the browser does at a scroll position. */
function page(sentinelDocBottom: number, navHeight: number, scrollY: number) {
  (globalThis as { window?: unknown }).window = { scrollY };
  const rect = (top: number, height: number) => ({ getBoundingClientRect: () => ({ top, bottom: top + height, height }) });
  const nodes: Record<string, unknown> = {
    '.ios-large__sentinel': rect(sentinelDocBottom - 1 - scrollY, 1),
    '.ios-nav': rect(0, navHeight),
  };
  return { querySelector: (selector: string) => nodes[selector] ?? null } as unknown as HTMLElement;
}

test('the stick point leaves the sentinel wholly above the nav, so the nav has condensed', () => {
  for (const navHeight of [44, 91, 103]) {
    for (let tenth = 0; tenth < 100; tenth++) {
      const bottom = 300 + navHeight + tenth / 10 + (tenth % 3) / 64;
      const stick = stickPointFor(bottom, navHeight);
      const after = bottom - stick;
      assert.ok(condensed(after, navHeight), `bottom ${bottom}, nav ${navHeight}: sentinel ends at ${after}`);
      assert.ok(after >= navHeight - 1, `at most 1px of the card goes under the nav (${after})`);
    }
  }
  assert.equal(stickPointFor(20, 44), 0, 'never above the page');
});

test('review round 2: the view and the editor fractions that left the nav plain and the card bottom behind it', () => {
  // View 390: at scrollY 333 the sentinel's top sat at 44.4 (bottom 45.4) under a 44px nav; 334 did not condense either.
  const view = page(333 + 45.4, 44, 333);
  assert.equal(phoneStickPoint(view), 335);
  assert.ok(condensed(333 + 45.4 - 335, 44));
  assert.ok(!condensed(333 + 45.4 - 334, 44), 'one pixel less still touches the nav');
  // Editor 390: at 216 the tabs' top was at 44.8; it condenses from 217.
  assert.equal(phoneStickPoint(page(216 + 44.8, 44, 216)), 217);
  // The same answer from any scroll position, and a nav taller by the safe area.
  assert.equal(phoneStickPoint(page(378.4, 44, 900)), 335);
  assert.equal(phoneStickPoint(page(378.4 + 47, 91, 12)), 335);
});

test('the bar counts as stuck from the stick point, and a host without the kit has none', () => {
  const host = page(378.4, 44, 900);
  const stick = phoneStickPoint(host);
  (globalThis as { window?: unknown }).window = { scrollY: 335 };
  assert.ok(phoneTabsStuck(stick));
  (globalThis as { window?: unknown }).window = { scrollY: 334 };
  assert.ok(phoneTabsStuck(stick), 'within a pixel of the nav counts as stuck');
  (globalThis as { window?: unknown }).window = { scrollY: 300 };
  assert.ok(!phoneTabsStuck(stick));
  assert.equal(phoneTabsStuck(null), false);
  assert.equal(phoneStickPoint({ querySelector: () => null } as unknown as HTMLElement), null);
});

/*
 * Round 1 of the release (2026-10-16): just before the bar sticks the tabs sit
 * inside the root's scroll padding (nav 44 + tabs 74 = 118 at 390x844) without
 * the stuck rule, and a Tab, Shift+Tab or arrow key onto one scrolled the page
 * up: PO-21's view 295 -> 273 at 40 px before the stick point, 330 -> 8 at 5 px.
 */
test('a tab inside the scroll padding gets its scroll area moved down by as much; below it nothing', () => {
  /* The tab tops measured on PO-21 (view, 390x844): at the stick point, 5, 20 and 40 px before it, and lower down. */
  assert.deepEqual([57, 61, 76, 96, 118, 131, 400].map((top) => tabLift(118, top)), [61, 57, 42, 22, 0, 0, 0]);
  assert.equal(tabLift(118, 96.4), 22, 'rounded up: the area lands at or below the padding, never 1px inside it');
  assert.equal(tabLift(0, 57), 0, 'no padding, no lift');
});

function tabsHost(tops: number[], padding: string) {
  (globalThis as { document?: unknown }).document = { documentElement: {} };
  (globalThis as { getComputedStyle?: unknown }).getComputedStyle = () => ({ scrollPaddingTop: padding });
  const tabs = tops.map((top) => ({ top, style: { scrollMargin: 'stale' }, getBoundingClientRect() { return { top: this.top }; } }));
  const host = { querySelectorAll: (selector: string) => selector === '.mpo-tabs [role="tab"]' ? tabs : [] } as unknown as HTMLElement;
  return { host, tabs, margins: () => tabs.map((tab) => tab.style.scrollMargin) };
}

test('every tab gets the lift of where it sits now; lower down the stylesheet decides again', () => {
  const near = tabsHost([76, 76], '118px');
  liftPhoneTabs(near.host);
  assert.deepEqual(near.margins(), ['-42px 0 42px', '-42px 0 42px']);
  for (const tab of near.tabs) tab.top = 400;
  liftPhoneTabs(near.host);
  assert.deepEqual(near.margins(), ['', ''], 'scrolled back down: no lift');
  const auto = tabsHost([76], 'auto');
  liftPhoneTabs(auto.host);
  assert.deepEqual(auto.margins(), [''], 'no scroll padding (the desk): no lift');
  liftPhoneTabs({ querySelectorAll: () => [] } as unknown as HTMLElement);
});

test('the lifts follow every scroll a frame later and every key that can move focus at once; the cleanup stops both', () => {
  const listeners = new Map<string, (event: { key?: string }) => void>();
  const frames: (() => void)[] = [];
  const target = (name: string) => ({
    addEventListener: (type: string, fn: (event: { key?: string }) => void) => listeners.set(`${name}:${type}`, fn),
    removeEventListener: (type: string) => listeners.delete(`${name}:${type}`),
  });
  const page = tabsHost([400], '118px');
  Object.assign(globalThis as Record<string, unknown>, {
    window: target('window'),
    document: { ...target('document'), documentElement: {} },
    requestAnimationFrame: (fn: () => void) => frames.push(fn),
    cancelAnimationFrame: () => { frames.length = 0; },
  });
  const stop = keepPhoneTabFocusInPlace(page.host);
  // Scrolled to just before the stick point: one frame later the tab carries its lift, however many scroll events came.
  page.tabs[0].top = 61;
  listeners.get('window:scroll')!({});
  listeners.get('window:scroll')!({});
  assert.equal(frames.length, 1, 'one frame per burst of scroll events');
  assert.deepEqual(page.margins(), ['stale']);
  frames.shift()!();
  assert.deepEqual(page.margins(), ['-57px 0 57px']);
  // A key that can move focus measures at once, before the browser moves focus; typing does not.
  page.tabs[0].top = 96;
  listeners.get('document:keydown')!({ key: 'a' });
  assert.deepEqual(page.margins(), ['-57px 0 57px']);
  for (const key of ['Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) {
    page.tabs[0].top = key === 'Tab' ? 96 : 100;
    listeners.get('document:keydown')!({ key });
    assert.deepEqual(page.margins(), [key === 'Tab' ? '-22px 0 22px' : '-18px 0 18px'], key);
  }
  stop();
  assert.equal(listeners.size, 0, 'both listeners are gone');
});

test('the view and the editor keep the tabs\' lifts from their start until they are destroyed', async () => {
  for (const [file, host] of [['purchase-view.ts', 'host'], ['purchase-editor.ts', 'phoneHost']]) {
    const source = await readFile(new URL(`../src/app/features/purchasing/${file}`, import.meta.url), 'utf8');
    // A field right after the host it reads, so the host is there when it runs.
    assert.match(source, new RegExp(`private readonly ${host} = inject<ElementRef<HTMLElement>>\\(ElementRef\\);\\n  /\\*\\*[^\\n]*\\*/\\n  private readonly tabFocusKept = inject\\(DestroyRef\\)\\.onDestroy\\(keepPhoneTabFocusInPlace\\(this\\.${host}\\.nativeElement\\)\\);`), file);
  }
});
