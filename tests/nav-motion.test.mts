import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { NAV_FIXED_SELECTOR, cssTimeMs, navMotionKeyframes, navMotionTargets, navPageHosts } from '../src/app/core/platform/nav-motion-targets.ts';
import type { MotionNode } from '../src/app/core/platform/nav-motion-targets.ts';

/** A fake element: tag.class1.class2, its children, whether it holds a fixed bar, its display. */
function el(spec: string, children: MotionNode[] = [], opts: { fixed?: boolean; display?: string } = {}): MotionNode & { spec: string } {
  const [localName, ...classes] = spec.split('.');
  const kids = children;
  return {
    spec, localName, classList: { contains: (t: string) => classes.includes(t) }, children: kids,
    holdsFixed: () => !!opts.fixed || kids.some((k) => k.holdsFixed()), display: () => opts.display ?? 'block',
  };
}
const names = (nodes: MotionNode[]) => nodes.map((n) => (n as MotionNode & { spec: string }).spec);

test('legacy pages: the content and the large title move, the bar never', () => {
  const main = el('div.main', [
    el('router-outlet'),
    el('app-sales-list', [el('app-page-header', [el('header.appbar'), el('div.appbar__large'), el('div.appbar__sentinel')]), el('div.content'), el('button.fab', [], { fixed: true })]),
  ]);
  assert.deepEqual(names(navMotionTargets(main)), ['div.appbar__large', 'div.content']);
});

test('the four wrapper screens: their child is the page host (critique B7)', () => {
  const main = el('div.main', [el('router-outlet'), el('app-sales-screen', [el('app-sales-view', [el('main.content.sales-view-page')])])]);
  assert.deepEqual(names(navPageHosts(main)), ['app-sales-view']);
  assert.deepEqual(names(navMotionTargets(main)), ['main.content.sales-view-page']);
  const po = el('div.main', [el('app-purchase-screen', [el('app-purchase-view', [el('div.mpo-phone.mpo-phone--view', [
    el('app-ios-nav', [el('header.ios-nav'), el('div.ios-large')], { display: 'contents' }),
    el('div.mpo-panes'),
    el('nav.erp-workspace__mobile-actions.mpo-dock', [], { fixed: true }),
    el('app-purchase-quote-sheet', [el('app-sheet', [el('div.overlay', [], { fixed: true })])], { display: 'inline' }),
  ])])])]);
  assert.deepEqual(names(navMotionTargets(po)), ['div.ios-large', 'div.mpo-panes']);
});

test('kit pages: plain blocks and the children of pass-through hosts move; fixed bars and sheets never', () => {
  const home = el('div.main', [el('app-dashboard-home', [el('app-home-phone', [el('div.ios-page', [
    el('app-ios-nav', [el('header.ios-nav'), el('div.ios-large')], { display: 'contents' }),
    el('app-home-kas', [el('a.ios-hero')], { display: 'contents' }),
    el('section.ios-section'),
    el('button.ios-accessory', [], { fixed: true }),
  ])])])]);
  assert.deepEqual(names(navMotionTargets(home)), ['div.ios-large', 'a.ios-hero', 'section.ios-section']);
});

test('the fixed bars inside a page are known: the website builder\'s Opslaan bar and the phone save bars', () => {
  /* .builder-actions is position:fixed on the phone inside main.content.builder-page: the content holding
     it must not slide, or the bar rides along for 320 ms. */
  const parts = NAV_FIXED_SELECTOR.split(', ');
  for (const bar of ['.builder-actions', '.erp-workspace__mobile-actions', '.erp-workspace__mobile-dock', '[data-fixed-bar]', '.action-bar', '.fab']) {
    assert.ok(parts.includes(bar), bar);
  }
  const builder = el('div.main', [el('app-website-builder-page', [el('main.content.builder-page', [el('div.builder-actions', [], { fixed: true })])])]);
  assert.deepEqual(names(navMotionTargets(builder)), []);
});

test('push and pop slide 28 px with a fade, a tab only fades; tokens read as milliseconds', () => {
  assert.deepEqual(navMotionKeyframes('push', 28), [{ opacity: 0, transform: 'translateX(28px)' }, { opacity: 1, transform: 'none' }]);
  assert.deepEqual(navMotionKeyframes('pop', 28), [{ opacity: 0, transform: 'translateX(-28px)' }, { opacity: 1, transform: 'none' }]);
  assert.deepEqual(navMotionKeyframes('tab', 28), [{ opacity: 0 }, { opacity: 1 }]);
  assert.equal(cssTimeMs(' 320ms'), 320);
  assert.equal(cssTimeMs('.2s'), 200);
  assert.equal(cssTimeMs('0ms'), 0);
  assert.equal(cssTimeMs(''), 0);
});

test('the shell loads the motion after the first screen; back controls name their navigation a pop', () => {
  const app = readFileSync(new URL('../src/app/app.ts', import.meta.url), 'utf8');
  assert.match(app, /import\('\.\/core\/platform\/nav-motion'\)\.then\(\(m\) => \{\n      if \(!cancelled\) uninstall = m\.installNavMotion\(this\.router, this\.document, this\.desktopViewport\);/);
  const motion = readFileSync(new URL('../src/app/core/platform/nav-motion.ts', import.meta.url), 'utf8');
  assert.match(motion, /prefersReducedMotion\(\)/);
  assert.match(motion, /if \(main\.querySelector\('\.overlay'\)\) return;/);
  assert.match(motion, /desktop\.active\(\) \|\| prefersReducedMotion\(\)/);
  const iosNav = readFileSync(new URL('../src/app/shared/ios-nav.ts', import.meta.url), 'utf8');
  assert.match(iosNav, /navigateByUrl\(url, \{ info: \{ nav: 'pop' \} \}\)/);
});
