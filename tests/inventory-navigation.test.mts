import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(`../src/app/${path}`, import.meta.url), 'utf8');
const routes = read('app.routes.ts');
const shell = read('app.ts');

/** The route object with this path, as source text. */
function route(path: string): string {
  const at = routes.indexOf(`path: '${path}',`);
  assert.notEqual(at, -1, `route ${path} is missing`);
  return routes.slice(at, routes.indexOf('}', at));
}

test('the three screens of the Jaarinventaris are routed, behind the login', () => {
  for (const [path, page] of [
    ['stock/inventaris', 'InventoryPage'],
    ['stock/inventaris/telling/:id', 'StockCountPage'],
    ['stock/inventaris/afsluiting/:id', 'StockClosingPage'],
  ]) {
    const source = route(path);
    assert.match(source, /canActivate: \[authGuard\]/, `${path} must sit behind the login`);
    assert.ok(source.includes(`m.${page}`), `${path} must load ${page}`);
  }
  /* The detail routes come before the hub and the hub before /stock, so none is swallowed by a shorter path. */
  const order = ['stock/inventaris/telling/:id', 'stock/inventaris/afsluiting/:id', 'stock/inventaris', 'stock'].map((path) => routes.indexOf(`path: '${path}',`));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test('the sidebar leads to the Jaarinventaris, and Voorraad no longer lights up with it', () => {
  const link = shell.indexOf('routerLink="/stock/inventaris"');
  assert.notEqual(link, -1, 'the sidebar link to /stock/inventaris is missing');
  assert.ok(shell.slice(link, shell.indexOf('</a>', link)).includes('Jaarinventaris'));
  /* /stock is a prefix of /stock/inventaris: without an exact match both links would be active together. */
  const stock = shell.indexOf('routerLink="/stock" routerLinkActive="active"');
  assert.notEqual(stock, -1, 'the sidebar link to /stock is missing');
  assert.match(shell.slice(stock, shell.indexOf('</a>', stock)), /\[routerLinkActiveOptions\]="\{ paths: 'exact'/);
});
