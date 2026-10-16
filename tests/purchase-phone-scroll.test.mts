import assert from 'node:assert/strict';
import test from 'node:test';
import { phoneStickPoint, phoneTabsStuck, stickPointFor } from '../src/app/features/purchasing/purchase-phone-scroll.ts';

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
