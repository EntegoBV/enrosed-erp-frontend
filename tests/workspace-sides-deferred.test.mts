import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/* The workspace sides load with their workspace (foundation F1b), keeping them out of the first screen's script. */
const app = readFileSync(new URL('../src/app/app.ts', import.meta.url), 'utf8');

test('the website, files and finance sides are @defer blocks with a dark placeholder', () => {
  assert.match(app, /@defer \(on immediate\) \{ <app-website-admin-nav \/> \} @placeholder \{ <div class="website-sidebar-placeholder" aria-hidden="true"><\/div> \}/);
  assert.match(app, /@defer \(on immediate\) \{ <app-files-admin-nav \/> \} @placeholder \{ <aside class="wk-side" aria-hidden="true"><\/aside> \}/);
  assert.match(app, /@defer \(on immediate\) \{ <app-finance-admin-nav \/> \} @placeholder \{ <aside class="wk-side" aria-hidden="true"><\/aside> \}/);
  /* nothing else in the shell template uses them, or they would be back in the initial bundle */
  for (const tag of ['app-website-admin-nav', 'app-files-admin-nav', 'app-finance-admin-nav']) {
    assert.equal(app.split(`<${tag}`).length - 1, 1, tag);
  }
});
