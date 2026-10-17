import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/* Sneltoetsen (foundation F7b-2): the keys install after the first screen; the sheet loads on demand. */
const app = readFileSync(new URL('../src/app/app.ts', import.meta.url), 'utf8');
const keys = readFileSync(new URL('../src/app/core/platform/app-shortcut-keys.ts', import.meta.url), 'utf8');
const sheet = readFileSync(new URL('../src/app/shared/shortcuts-sheet.ts', import.meta.url), 'utf8');

test('the shell installs the / and ? keys lazily and opens Sneltoetsen from the key cap', () => {
  assert.match(app, /import\('\.\/core\/platform\/app-shortcut-keys'\)\.then\(\(m\) => \{/);
  assert.match(app, /uninstall = m\.installShortcutKeys\(this\.document, \{/);
  assert.match(app, /active: \(\) => !this\.bare\(\)/);
  assert.match(app, /@if \(shortcutsOpen\(\)\) \{\n      @defer \(on immediate\) \{\n        <app-shortcuts-sheet \[url\]="url\(\)" \(closed\)="shortcutsOpen\.set\(false\)" \/>/);
  assert.match(app, /<button class="sidebar__key" type="button" title="Sneltoetsen \(\?\)" aria-label="Sneltoetsen"/);
  assert.match(app, /class="sidebar__user" \[title\]="auth\.username\(\) \?\? ''"/);
  /* no shortcut table in the shell itself: they load with the sheet */
  assert.doesNotMatch(app, /from '\.\/core\/platform\/app-shortcuts'/);
});

test('the keys respect typing, overlays, modifiers and the workspaces; / focuses the page search', () => {
  assert.match(keys, /shortcutCommand\(\{/);
  assert.match(keys, /typing: context\.typing, overlay: context\.overlayOpen/);
  assert.match(keys, /\.main :is\(\$\{PAGE_SEARCH_SELECTOR\}\)/);
  assert.match(keys, /field\.select\?\.\(\)/);
});

test('the sheet: Overal, Op deze pagina when it has rows, and the workspaces note', () => {
  assert.match(sheet, /<app-sheet title="Sneltoetsen"/);
  assert.match(sheet, />Overal</);
  assert.match(sheet, /@if \(page\(\)\.length\) \{\n          <h3 class="keys__head">Op deze pagina<\/h3>/);
  assert.match(sheet, /<p foot class="keys__note">\{\{ note \}\}<\/p>/);
});
