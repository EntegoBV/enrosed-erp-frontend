import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/* The dark sidebar (foundation F5b): its skin lives in styles/shell-sidebar.scss only; the light one left styles.scss. */
const skin = readFileSync(new URL('../src/styles/shell-sidebar.scss', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.scss', import.meta.url), 'utf8');

test('the ERP sidebar wears the workspaces\' dark side: 248 px, an 88 px rail, the kit tokens', () => {
  assert.ok(skin.length > 1000, 'the skin block exists');
  assert.match(skin, /--side-count-bg: var\(--wk-side-active-ink\)/);
  assert.match(skin, /--side-count-ink: #171311/);
  assert.match(skin, /background: var\(--wk-side-bg\)/);
  assert.match(skin, /\.sidebar \{ width: 248px; flex: 0 0 248px; \}/);
  assert.match(skin, /\.sidebar \{ width: 88px; flex: 0 0 88px; overflow-x: clip; \}/);
  assert.match(skin, /filter: invert\(1\) grayscale\(1\) brightness\(2\)/);
});

test('styles.scss keeps no sidebar rule, but every rule that shared its blocks (critique B1)', () => {
  assert.match(styles, /@include meta\.load-css\('styles\/shell'\);\n@include meta\.load-css\('styles\/shell-sidebar'\);/);
  /* (the 44 px touch-target list may still name .sidebar__logout among other controls) */
  const sidebarRules = styles.split('\n').filter((line) => /^\s*\.sidebar[\w-]*[^,]*\{/.test(line));
  assert.deepEqual(sidebarRules, [], 'no .sidebar rule left in styles.scss');
  assert.doesNotMatch(styles, /@mixin sidebar-rail/);
  for (const kept of ['.hide-mobile.hide-mobile { display: revert; }', '.hide-desktop.hide-desktop { display: none !important; }',
    '.shell { flex-direction: row; }', '.content { padding: 18px 20px 60px; }', '.content { padding: 22px 26px 60px; }',
    '.shell--bare .content', '.content--with-action-bar', '.list-item:hover', '.product-nav {']) {
    assert.ok(styles.includes(kept), kept);
  }
});

test('only a group the user toggles animates, and a closed list leaves the tab order', () => {
  assert.match(skin, /\.sidebar--animate \.sidebar__sub \{ transition: grid-template-rows/);
  assert.match(skin, /\.sidebar__sub--closed \{ grid-template-rows: 0fr; visibility: hidden; \}/);
  for (const line of skin.split('\n').filter((l) => l.includes('grid-template-rows var('))) {
    assert.match(line, /^\s*\.sidebar--animate /, line);
  }
});

test('what stands beside the sidebar follows its width', () => {
  assert.match(skin, /\.action-bar \{ left: 100px; \}/);
  assert.match(skin, /\.action-bar \{ left: 264px; \}/);
  const block = skin.slice(skin.indexOf('@media (min-width: 1024px) and (max-width: 1279.98px)'));
  assert.match(block, /\.content:not\(\.desk\) \{ padding-right: 16px; padding-left: 16px; \}/);
  assert.match(block, /\.content\.desk \{ padding-inline: 14px; \}/);
  assert.match(block, /\.pin-line \{ margin: -22px -16px 14px; \}/);
});
