import assert from 'node:assert/strict';
import test from 'node:test';
import { capsuleLabel, isWorkspaceUrl, returnLabel, screenLabel } from '../src/app/core/platform/return-label.ts';

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
    ['/klantlogins', 'Login-aanvragen'],
    ['/contactaanvragen', 'Contactaanvragen'],
    ['/prospects/24', 'Prospects'],
    ['/suppliers', 'Leveranciers'],
    ['/settings', 'Instellingen'],
    ['/activity', 'Logboek'],
    ['/website', 'Website'],
    ['/more', 'Meer'],
    ['/dashboard', 'Dashboard'],
    ['/stock', 'ERP'],
    ['/stock/inventaris', 'Jaarinventaris'],
    ['/stock/inventaris/telling/3', 'Jaarinventaris'],
    ['/countries', 'ERP'],
  ];
  for (const [url, label] of table) assert.equal(returnLabel(url), label, url);
});

test('query strings and fragments do not change the name', () => {
  assert.equal(returnLabel('/purchasing/46?section=ledger'), 'inkooporder');
  assert.equal(returnLabel('/settings?sectie=company'), 'Instellingen');
  assert.equal(returnLabel('/sales?filter=open#top'), 'Verkoop');
  assert.equal(returnLabel('/products/57#media'), 'product');
  assert.equal(returnLabel('/klantlogins?status=goedgekeurd'), 'Login-aanvragen');
  assert.equal(returnLabel('/contactaanvragen?open=12'), 'Contactaanvragen');
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

test('a phone back control names the screen it returns to', () => {
  const table: Array<[string, string]> = [
    ['/dashboard', 'Vandaag'],
    ['/dashboard/agenda', 'Agenda'],
    ['/sales', 'Verkoop'],
    ['/sales?tab=facturen', 'Verkoop'],
    ['/sales/79', 'Order'],
    ['/sales/79/edit', 'Order'],
    ['/revisions', 'Wijzigingen'],
    ['/purchasing', 'Inkoop'],
    ['/purchasing/62', 'Inkooporder'],
    ['/products', 'Producten'],
    ['/products/57/edit', 'Product'],
    ['/customers', 'Klanten'],
    ['/suppliers', 'Leveranciers'],
    ['/stock', 'Voorraad'],
    ['/stock/inventaris', 'Jaarinventaris'],
    ['/stock-locations', 'Voorraadlocaties'],
    ['/prospects/4', 'Prospects'],
    ['/settings?sectie=company', 'Bedrijfsgegevens'],
    ['/settings', 'Instellingen'],
    ['/settings/deleted-items', 'Verwijderde items'],
    ['/activity', 'Logboek'],
    ['/analyses/cash', 'Analyses'],
    ['/more', 'Meer'],
    ['/costs', 'Kosten & bank'],
    ['/nope', ''],
  ];
  for (const [url, label] of table) assert.equal(screenLabel(url), label, url);
});

test('a back capsule holds at most ten characters, else it is a chevron circle', () => {
  assert.equal(capsuleLabel('Verkoop'), 'Verkoop');
  assert.equal(capsuleLabel('Inkooporder'), '');
  assert.equal(capsuleLabel('Instellingen'), '');
  assert.equal(capsuleLabel('Meer'), 'Meer');
  assert.equal(capsuleLabel(''), '');
  assert.equal(capsuleLabel(null), '');
});

test('a settings view is named as its own screen, the overview as Instellingen (B9)', async () => {
  const { SETTINGS_VIEWS } = await import('../src/app/features/settings/settings-sections.ts');
  for (const view of SETTINGS_VIEWS) {
    const url = view.id === 'overview' ? '/settings' : `/settings?sectie=${view.id}`;
    assert.equal(screenLabel(url), view.title, url);
  }
  assert.equal(screenLabel('/settings?sectie=order-discounts'), 'Kortingen');
  assert.equal(screenLabel('/settings?sectie=notifications'), 'Dit toestel');
  assert.equal(screenLabel('/settings?returnTo=%2Fmore&sectie=discounts#top'), 'Kortingen');
  assert.equal(screenLabel('/settings?sectie=unknown'), 'Instellingen');
  assert.equal(screenLabel('/settings?sectie=constructor'), 'Instellingen');
  assert.equal(screenLabel('/settings/overzicht'), 'Instellingen');
  assert.equal(screenLabel('/settings/deleted-items?sectie=company'), 'Verwijderde items');
  assert.equal(capsuleLabel(screenLabel('/settings?sectie=discounts')), 'Kortingen');
  assert.equal(capsuleLabel(screenLabel('/settings?sectie=company')), '');
});
