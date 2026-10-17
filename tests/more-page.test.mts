import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { NAV_DEVICE, NAV_GROUPS, NAV_WORKSPACES, meerItems } from '../src/app/core/platform/nav-items.ts';

/* Meer on the kit (foundation F6): rows from NAV_GROUPS, the header kept for the bell (critique B2). */
const page = readFileSync(new URL('../src/app/features/more/more-page.ts', import.meta.url), 'utf8');

test('Meer keeps app-page-header with "Aangemeld als", so the phone keeps the large title and the bell', () => {
  assert.match(page, /<app-page-header title="Meer" \[subtitle\]="'Aangemeld als ' \+ \(auth\.username\(\) \?\? ''\)" \/>/);
  assert.doesNotMatch(page, /showBell\]="false"|\[showBell\]/);
  assert.doesNotMatch(page, /class="ios-page/);
  assert.doesNotMatch(page, /<app-ios-nav/);
  assert.match(page, /class="content more-content"/);
});

test('the rows come from the navigation table the sidebar renders', () => {
  assert.match(page, /@for \(item of workspaces; track item\.id\)/);
  assert.match(page, /@for \(group of groups; track group\.id\)/);
  assert.match(page, /@for \(item of itemsOf\(group\); track item\.id\)/);
  assert.match(page, /@for \(item of device; track item\.id\)/);
  assert.match(page, /<details class="ios-disclosure" name="meer-groepen">/);
  /* Wijzigingen and Verwijderde items are reachable on the phone now; the duplicate Documenten row is gone. */
  const rows = NAV_GROUPS.flatMap(meerItems).map((item) => item.link);
  assert.ok(rows.includes('/revisions'));
  assert.ok(rows.includes('/settings/deleted-items'));
  assert.doesNotMatch(page, /settings\/documents-media/);
  assert.deepEqual(NAV_WORKSPACES.map((item) => item.link), ['/files', '/costs', '/website']);
  assert.equal(NAV_DEVICE[0].link, '/settings');
});

test('the counts, the theme and Afmelden stay', () => {
  assert.match(page, /groupCountKeys\(group, 'meer'\)/);
  assert.match(page, /login-aanvragen wachten/);
  assert.match(page, /countOf\(item\.countKey\)/);
  assert.match(page, /role="radiogroup" aria-label="Kleurschema"/);
  assert.match(page, /\{\{ currentThemeLabel\(\) \}\}/);
  assert.match(page, />Afmelden</);
  assert.match(page, /Aangemeld als \{\{ auth\.username\(\) \}\}/);
  assert.match(page, /wk-pill tone-accent">nieuw</);
});

test('help lines wrap instead of being cut', () => {
  assert.match(page, /\.ios-cell__sub \{ overflow: visible; text-overflow: clip; white-space: normal;/);
  assert.doesNotMatch(page, /ios-cell__sub--2/);
});
