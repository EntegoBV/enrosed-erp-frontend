import assert from 'node:assert/strict';
import test from 'node:test';
import { ANALYSES_KEY_TABS, analysesTabForKey } from '../src/app/features/analyses/analyses-keys.ts';
import { NAV_GROUPS } from '../src/app/core/platform/nav-items.ts';
import { pageShortcutsFor } from '../src/app/core/platform/app-shortcuts.ts';

const key = (code: string, extra: Partial<Parameters<typeof analysesTabForKey>[0]> = {}) => ({ code, altKey: true, ...extra });

test('⌥1…⌥8 open the Analyses tabs by the physical key, in the order of the sidebar', () => {
  const sidebar = NAV_GROUPS.find((group) => group.id === 'analyses')!.items.map((item) => item.link.replace('/analyses/', ''));
  assert.deepEqual([...ANALYSES_KEY_TABS], sidebar);
  assert.deepEqual(['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8'].map((code) => analysesTabForKey(key(code))),
    ['cash', 'overview', 'sales', 'inventory', 'purchasing', 'result', 'market', 'website']);
});

test('other keys and other modifiers stay someone else\'s', () => {
  assert.equal(analysesTabForKey(key('Digit1', { altKey: false })), null);
  assert.equal(analysesTabForKey(key('Digit1', { metaKey: true })), null);
  assert.equal(analysesTabForKey(key('Digit1', { ctrlKey: true })), null);
  assert.equal(analysesTabForKey(key('Digit1', { shiftKey: true })), null);
  assert.equal(analysesTabForKey(key('Digit9')), null);
  assert.equal(analysesTabForKey(key('Digit0')), null);
  assert.equal(analysesTabForKey(key('Numpad1')), null);
  assert.equal(analysesTabForKey(key('KeyA')), null);
});

test('the Sneltoetsen list names the keys on every Analyses tab only', () => {
  for (const url of ['/analyses/cash', '/analyses/purchasing?deel=partners', '/analyses/website?source=GA4&days=7']) {
    assert.deepEqual(pageShortcutsFor(url).map((row) => [row.keys.join(' '), row.text]), [['⌥ 1–8', 'Onderdeel van Analyses']], url);
  }
  assert.deepEqual(pageShortcutsFor('/analysesx'), []);
  assert.deepEqual(pageShortcutsFor('/purchasing/62').map((row) => row.keys.join(' ')), ['⌥ 1', '⌥ 2', '⌥ 3']);
});
