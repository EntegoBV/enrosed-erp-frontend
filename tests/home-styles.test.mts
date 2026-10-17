import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

/*
 * The home's partials load with the home routes, not in the initial bundle (home-styles.ts; the foundation left the
 * 1 MB initial budget at 999.9 kB). The components import Angular at run time, so their sources are read as text.
 */
const read = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');
const PARTIALS = ['home-widgets', 'home-desk', 'home-phone', 'home-agenda'];

test('styles.scss no longer loads the home partials', async () => {
  const styles = await read('styles.scss');
  for (const partial of PARTIALS) assert.doesNotMatch(styles, new RegExp(`load-css\\('styles/${partial}'\\)`), partial);
});

test('one carrier per partial, unencapsulated, so the rules stay global while a home route is on screen', async () => {
  const carrier = await read('app/features/dashboard/home-styles.ts');
  for (const partial of PARTIALS) assert.match(carrier, new RegExp(`styleUrl: '\\.\\./\\.\\./\\.\\./styles/${partial}\\.scss'`), partial);
  assert.equal(carrier.match(/encapsulation: ViewEncapsulation\.None/g)?.length, PARTIALS.length);
  assert.match(carrier, /template: '<app-home-widget-styles \/><app-home-desk-styles \/><app-home-phone-styles \/><app-home-agenda-styles \/>'/);
});

test('every home route renders the carrier hidden, as its first child', async () => {
  assert.match(await read('app/features/dashboard/dashboard-home.ts'), /template: `<app-home-styles hidden \/>@if \(desk\(\)\)/);
  assert.match(await read('app/features/dashboard/agenda-page.ts'), /template: `\n {4}<app-home-styles hidden \/>\n {4}@if \(!desk\(\)\)/);
  assert.match(await read('app/features/dashboard/open-page.ts'), /template: `\n {4}@let t = data\.tasks\(\);\n {4}<app-home-styles hidden \/>\n/);
});

test('no partial uses :host (they are plain global rules)', async () => {
  for (const partial of PARTIALS) assert.doesNotMatch(await read(`styles/${partial}.scss`), /:host/, partial);
});
