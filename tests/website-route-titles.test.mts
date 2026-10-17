import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const routes = await readFile(new URL('../src/app/app.routes.ts', import.meta.url), 'utf8');

/** The `title:` of the route block that starts with this path. */
function titleOf(path: string): string | null {
  const start = routes.indexOf(`path: '${path}',`);
  if (start < 0) return null;
  const block = routes.slice(start, routes.indexOf('}', start));
  return /title: '([^']*)'/.exec(block)?.[1] ?? null;
}

test('the website screens name the tab like every other ERP screen: "{Scherm} · Website — Enrosed" (design §2.2)', () => {
  assert.equal(titleOf('website'), 'Website — Enrosed');
  const screens: [string, string][] = [
    ['website/layout', 'Homepage'], ['website/texts', 'Teksten'], ['website/products', 'Producten'],
    ['website/categories', 'Categorieën'], ['website/seo', 'SEO'], ['website/publication', 'Publicatie'],
  ];
  for (const [path, screen] of screens) assert.equal(titleOf(path), `${screen} · Website — Enrosed`, path);
});
