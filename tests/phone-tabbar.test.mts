import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/* The phone tab bar and the '+' (foundation F4b). */
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const block = read('src/styles/shell-tabbar.scss');
const shell = read('src/app/app.ts');
const styles = read('src/styles.scss');

test('the tab bar takes the kit geometry: 60 px glass, red badges, an accent pill', () => {
  assert.match(block, /:root \{ --tabbar-h: var\(--ios-tabbar-h, 60px\); \}/);
  assert.match(block, /height: var\(--ios-tabbar-h, 60px\)/);
  assert.match(block, /background: var\(--glass-bg-strong\)/);
  assert.match(block, /\.tabbar__count \{[^}]*background: var\(--danger\)/);
  assert.match(block, /\.tabbar__item\.active::before \{ opacity: 1; transform: none; \}/);
  /* every label in its own span, so a long one ellipsizes instead of pushing the bar */
  assert.equal((shell.match(/class="tabbar__label"/g) ?? []).length, 5);
  for (const label of ['Home', 'Verkoop', 'Inkoop', 'Producten', 'Meer']) assert.ok(shell.includes(`<span class="tabbar__label">${label}</span>`), label);
});

test('every list \'+\' is the round accessory beside the bar; the bar makes room and animates its width', () => {
  assert.match(block, /\.fab \{[^}]*width: var\(--ios-tabbar-h, 60px\);[^}]*border-radius: 50%;[^}]*font-size: 0;/);
  assert.match(block, /\.shell:has\(> \.main \.fab:not\(\.fab--text\)\) > \.tabbar \{ right: calc\(var\(--safe-r\) \+ 12px \+ var\(--ios-tabbar-h, 60px\)\); \}/);
  assert.match(block, /transition: right var\(--dur-2/);
  /* an action that is not "new" keeps its words */
  assert.match(block, /\.fab\.fab--text \{[^}]*font-size: 15px;/);
  assert.match(block, /@media \(min-width: 680px\) \{\n  \.tabbar, \.fab \{ display: none; \}/);
});

test('one beige on the phone\'s staff screens, also in the status bar and the manifest', () => {
  assert.match(block, /body:has\(\.shell:not\(\.shell--bare\)\) \{ --bg: #f2efeb; \}/);
  const index = read('src/index.html');
  assert.match(index, /<meta name="theme-color" content="#f2efeb" media="\(max-width: 679px\)">/);
  assert.match(index, /<meta name="theme-color" content="#ffffff">/);
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  assert.equal(manifest.background_color, '#f2efeb');
  assert.equal(manifest.theme_color, '#f2efeb');
});

test('the old tab bar and fab rules left styles.scss by selector, nothing else (critique B1)', () => {
  assert.doesNotMatch(styles, /^\.tabbar \{/m);
  assert.doesNotMatch(styles, /^\.fab \{/m);
  /* (the old count rule next to the sidebar's stays: shell-tabbar.scss overrides every property it sets) */
  assert.match(styles, /@include meta\.load-css\('styles\/files-phone'\);\n@include meta\.load-css\('styles\/shell-tabbar'\);/);
  for (const kept of ['.hide-mobile.hide-mobile', '.hide-desktop.hide-desktop', '.shell--bare .content', '.content--with-action-bar', '.list-item:hover']) {
    assert.ok(styles.includes(kept), kept);
  }
});
