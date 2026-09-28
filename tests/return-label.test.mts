import assert from 'node:assert/strict';
import test from 'node:test';
import { isWorkspaceUrl, returnLabel } from '../src/app/core/platform/return-label.ts';

test('every ERP screen has a name to return to', () => {
  const table: Array<[string, string]> = [
    ['/purchasing/46', 'inkooporder'],
    ['/purchasing/46/edit', 'inkooporder'],
    ['/purchasing', 'Inkoop'],
    ['/purchasing/new', 'Inkoop'],
    ['/sales/24', 'verkooporder'],
    ['/sales/24/edit', 'verkooporder'],
    ['/sales', 'Verkoop'],
    ['/revisions', 'Verkoop'],
    ['/analyses', 'Analyses'],
    ['/analyses/market', 'Analyses'],
    ['/products/57', 'product'],
    ['/products/57/edit', 'product'],
    ['/products', 'Producten'],
    ['/customers', 'Klanten'],
    ['/suppliers', 'Leveranciers'],
    ['/settings', 'Instellingen'],
    ['/activity', 'Logboek'],
    ['/website', 'Website'],
    ['/more', 'Meer'],
    ['/dashboard', 'Dashboard'],
    ['/stock', 'ERP'],
    ['/countries', 'ERP'],
  ];
  for (const [url, label] of table) assert.equal(returnLabel(url), label, url);
});

test('query strings and fragments do not change the name', () => {
  assert.equal(returnLabel('/purchasing/46?section=ledger'), 'inkooporder');
  assert.equal(returnLabel('/settings?sectie=company'), 'Instellingen');
  assert.equal(returnLabel('/sales?filter=open#top'), 'Verkoop');
  assert.equal(returnLabel('/products/57#media'), 'product');
});

test('a longer sibling path is not mistaken for a known screen', () => {
  assert.equal(returnLabel('/salesforce'), 'ERP');
  assert.equal(returnLabel('/productsheet'), 'ERP');
});

test('workspaces, redirects and screens outside the ERP are never a place to return to', () => {
  for (const url of ['', '/', '/costs', '/costs?view=bank', '/files', '/files?view=all&archief=1',
    '/login', '/offerte/x', '/voorwaarden']) {
    assert.equal(isWorkspaceUrl(url), true, url);
  }
  for (const url of ['/purchasing/46', '/filesystem', '/dashboard', '/sales?view=costs', '/costsheet']) {
    assert.equal(isWorkspaceUrl(url), false, url);
  }
});
