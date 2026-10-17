import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

// Inkoop redesign I5a (2026-10-17): while the read view's dock shows, the ERP tab bar steps aside, in one place.
test('the read view hides the ERP tab bar under its dock, in one place', async () => {
  const scss = await readFile(new URL('../src/styles/purchase-phone.scss', import.meta.url), 'utf8');
  const count = (pattern: string) => scss.split(pattern).length - 1;
  assert.equal(count('body:has(app-purchase-view .mpo-dock) .tabbar{display:none}'), 1);
  assert.equal(count('body:has(app-purchase-view .mpo-dock){--tabbar-h:0px}'), 1);
});
