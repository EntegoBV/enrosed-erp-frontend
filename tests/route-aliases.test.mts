import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { middleEllipsis } from '../src/app/features/not-found/middle-ellipsis.ts';
import { documentTitle, routeTitleApplies } from '../src/app/core/platform/document-title.ts';
import { phoneTabForUrl } from '../src/app/core/platform/phone-tabs.ts';

const routes = readFileSync(new URL('../src/app/app.routes.ts', import.meta.url), 'utf8');

/** The route objects as text, in order. */
function routeBlocks(): string[] {
  const body = routes.slice(routes.indexOf('export const routes'));
  const blocks: string[] = [];
  let depth = 0; let start = -1;
  for (let i = body.indexOf('[') + 1; i < body.length; i++) {
    if (body[i] === '{') { if (depth === 0) start = i; depth++; }
    else if (body[i] === '}') { depth--; if (depth === 0) blocks.push(body.slice(start, i + 1)); }
    else if (body[i] === ']' && depth === 0) break;
  }
  return blocks;
}

test('Dutch addresses lead to their screens, detail forms included (N26)', () => {
  const blocks = routeBlocks();
  const redirect = (path: string) => blocks.find((b) => b.includes(`path: '${path}',`) && b.includes('redirectTo'));
  for (const [alias, target] of [
    ['verkoop', 'sales'], ['inkoop', 'purchasing'], ['producten', 'products'], ['voorraad', 'stock'],
    ['klanten', 'customers'], ['leveranciers', 'suppliers'], ['instellingen', 'settings'], ['kosten', 'costs'],
    ['bank', 'costs'], ['documenten', 'files'], ['media', 'files'], ['analyse', 'analyses/cash'], ['home', 'dashboard'],
    ['verkoop/:id', 'sales/:id'], ['inkoop/:id', 'purchasing/:id'], ['producten/:id', 'products/:id'],
  ]) {
    const block = redirect(alias);
    assert.ok(block, `alias ${alias}`);
    assert.match(block!, new RegExp(`redirectTo: '${target.replace('/', '\\/')}'`), alias);
    assert.match(block!, /pathMatch: 'full'/, alias);
  }
  /* Kosten & bank's Facturen by its Dutch name: an absolute redirect, so the view query comes along */
  const facturen = redirect('facturen');
  assert.ok(facturen, 'alias facturen');
  assert.match(facturen!, /redirectTo: '\/costs\?view=invoices'/);
  assert.match(facturen!, /pathMatch: 'full'/);
  assert.ok(routes.indexOf("path: 'facturen'") > routes.indexOf("path: 'kosten'"), 'next to the kosten alias');
  assert.ok(routes.indexOf("path: 'facturen'") < routes.indexOf("path: '**'"));
  /* the old builder bookmarks stay */
  assert.ok(redirect('website-builder/layout'));
});

test('an unknown address gets the 404 page, last, behind the login', () => {
  const blocks = routeBlocks();
  const last = blocks.at(-1)!;
  assert.match(last, /path: '\*\*'/);
  assert.match(last, /canActivate: \[authGuard\]/);
  assert.match(last, /m\.NotFoundPage/);
  assert.match(last, /title: 'Pagina niet gevonden'/);
  assert.equal(blocks.filter((b) => b.includes("path: '**'")).length, 1);
  /* every alias comes before it */
  assert.ok(routes.indexOf("path: 'verkoop'") < routes.indexOf("path: '**'"));
  assert.equal(phoneTabForUrl('/nope'), 'more');
});

test('every screen has a route title for the browser tab', () => {
  for (const block of routeBlocks().filter((b) => b.includes('loadComponent'))) {
    assert.match(block, /title: '[^']+'/, block.slice(0, 80));
  }
});

test('one name per screen: a sales document is a Verkooporder, as the sidebar and Inkooporder say', () => {
  const blocks = routeBlocks();
  const titleOf = (path: string) => blocks.find((b) => b.includes(`path: '${path}',`) && b.includes('loadComponent'))?.match(/title: '([^']+)'/)?.[1];
  assert.equal(titleOf('sales/:id'), 'Verkooporder');
  assert.equal(titleOf('sales/:id/edit'), 'Verkooporder');
  assert.equal(titleOf('purchasing/:id'), 'Inkooporder');
  /* the customer portal is the customer's quote */
  assert.equal(titleOf('offerte/:token'), 'Offerte');
});

test('the tab title: "X — Enrosed", and query-only navigations keep the page\'s own', () => {
  assert.equal(documentTitle('Inkooporder'), 'Inkooporder — Enrosed');
  assert.equal(documentTitle('  '), 'Enrosed');
  assert.equal(documentTitle(undefined), 'Enrosed');
  assert.equal(routeTitleApplies(null, '/sales'), true);
  assert.equal(routeTitleApplies('/sales', '/sales'), false);
  assert.equal(routeTitleApplies('/sales', '/sales/79'), true);
  assert.equal(routeTitleApplies('/purchasing/62', '/purchasing/62'), false);
});

test('a long unknown path is shortened in the middle', () => {
  assert.equal(middleEllipsis('/nope'), '/nope');
  const long = '/sales/79/' + 'x'.repeat(80) + '/edit';
  const short = middleEllipsis(long, 60);
  assert.equal(short.length, 60);
  assert.ok(short.startsWith('/sales/79/'));
  assert.ok(short.endsWith('/edit'));
  assert.ok(short.includes('…'));
});
