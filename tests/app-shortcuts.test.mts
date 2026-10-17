import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GLOBAL_SHORTCUTS, PAGE_SHORTCUTS, appShortcutsActive, pageShortcutsFor, routeMatches, shortcutCommand,
} from '../src/app/core/platform/app-shortcuts.ts';

const key = (k: string, extra: Partial<Parameters<typeof shortcutCommand>[0]> = {}) => ({ key: k, typing: false, overlay: false, ...extra });

test("'/' searches and '?' lists the keys, only when nobody else wants the key", () => {
  assert.equal(shortcutCommand(key('/'), '/sales'), 'search');
  assert.equal(shortcutCommand(key('?'), '/purchasing/62'), 'help');
  assert.equal(shortcutCommand(key('/', { typing: true }), '/sales'), null);
  assert.equal(shortcutCommand(key('?', { overlay: true }), '/sales'), null);
  assert.equal(shortcutCommand(key('/', { metaKey: true }), '/sales'), null);
  assert.equal(shortcutCommand(key('/', { defaultPrevented: true }), '/sales'), null);
  assert.equal(shortcutCommand(key('k'), '/sales'), null);
});

test('Kosten & bank and Documenten & media keep their own keys', () => {
  for (const url of ['/costs', '/costs?view=bank', '/files', '/files/photos']) {
    assert.equal(appShortcutsActive(url), false, url);
    assert.equal(shortcutCommand(key('/'), url), null, url);
  }
  assert.equal(appShortcutsActive('/costsheet'), true);
});

test('route patterns match one segment per parameter and a whole subtree with /*', () => {
  assert.equal(routeMatches('/purchasing/:id', '/purchasing/62'), true);
  assert.equal(routeMatches('/purchasing/:id', '/purchasing/62?sectie=betalingen'), true);
  assert.equal(routeMatches('/purchasing/:id', '/purchasing/62/edit'), false);
  assert.equal(routeMatches('/purchasing/:id', '/purchasing'), false);
  assert.equal(routeMatches('/website/*', '/website'), true);
  assert.equal(routeMatches('/website/*', '/website/texts'), true);
  assert.equal(routeMatches('/website/*', '/websites'), false);
});

test('the page section lists the screen keys and hides elsewhere', () => {
  assert.deepEqual(pageShortcutsFor('/purchasing/62').map((row) => row.keys.join(' ')), ['⌥ 1', '⌥ 2', '⌥ 3']);
  assert.deepEqual(pageShortcutsFor('/sales/79/edit').map((row) => row.text), ['Opslaan']);
  assert.deepEqual(pageShortcutsFor('/website/layout').map((row) => row.text),
    ['Opslaan', 'Ander blok kiezen', 'Blok hoger of lager zetten', 'Blok tonen of verbergen', 'Naar de instellingen van het blok']);
  assert.deepEqual(pageShortcutsFor('/website/texts?key=home.hero.title').map((row) => row.text),
    ['Opslaan', 'Andere tekstgroep kiezen', 'Naar het tekstveld', 'Vorige of volgende taal']);
  assert.deepEqual(pageShortcutsFor('/customers'), []);
});

test("the list uses the app's own verb", () => {
  const all = [...GLOBAL_SHORTCUTS, ...PAGE_SHORTCUTS.flatMap((set) => set.rows)].map((row) => row.text).join(' ');
  assert.match(all, /Opslaan/);
  assert.doesNotMatch(all, /Bewaren/);
});

test('a new product lists no product-page keys: E, B and ⌥←/→ only work on a saved product', () => {
  const page = pageShortcutsFor('/products/101').map((row) => row.text);
  assert.ok(page.includes('Voorraad boeken'));
  assert.ok(page.includes('Vorige of volgende kleur'));
  const fresh = pageShortcutsFor('/products/new').map((row) => row.text);
  assert.ok(!fresh.includes('Voorraad boeken'), fresh.join(', '));
  assert.ok(!fresh.includes('Vorige of volgende kleur'), fresh.join(', '));
  assert.ok(pageShortcutsFor('/products/101/edit').map((row) => row.text).includes('Opslaan'));
});

test('Categorieën lists its own keys next to Opslaan', () => {
  assert.deepEqual(pageShortcutsFor('/website/categories?code=domes').map((row) => row.text),
    ['Opslaan', 'Andere categorie kiezen', 'Categorie hoger of lager zetten', 'Categorie openen']);
});
