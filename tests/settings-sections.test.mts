import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SETTINGS_VIEWS, deviceFocus, isSettingsOverviewUrl, settingsCategoryRedirect, settingsTabs, settingsView, settingsViewInfo, settingsViewQuery,
} from '../src/app/features/settings/settings-sections.ts';

test('every ?sectie= of the old scroll page opens its own view', () => {
  assert.equal(settingsView(null), 'overview');
  assert.equal(settingsView(''), 'overview');
  assert.equal(settingsView('unknown'), 'overview');
  assert.equal(settingsView('company'), 'company');
  assert.equal(settingsView('legal'), 'legal');
  assert.equal(settingsView('website'), 'website');
  assert.equal(settingsView('duties'), 'duties');
  assert.equal(settingsView('discounts'), 'discounts');
  assert.equal(settingsView('order-discounts'), 'discounts');
  assert.equal(settingsView('catalog-data'), 'catalog-data');
  assert.equal(settingsView('appearance'), 'device');
  assert.equal(settingsView('notifications'), 'device');
  assert.equal(settingsView('device'), 'device');
  /* categories is a redirect, never a view of its own */
  assert.equal(settingsView('categories'), 'overview');
});

test('a view this build does not have yet falls back to the overview', () => {
  assert.equal(settingsView('legal', ['overview', 'company']), 'overview');
  assert.equal(settingsView('company', ['overview', 'company']), 'company');
});

test('titles and subtitles per view; the overview says what it covers', () => {
  assert.equal(settingsViewInfo('overview').title, 'Instellingen');
  assert.equal(settingsViewInfo('overview').subtitle, 'Bedrijf, verkoop, website en dit toestel');
  assert.equal(settingsViewInfo('company').title, 'Bedrijfsgegevens');
  assert.equal(settingsViewInfo('website').title, 'Prijzen op de website');
  assert.equal(settingsViewInfo('device').title, 'Dit toestel');
  assert.deepEqual(SETTINGS_VIEWS.map((view) => view.tab),
    ['Overzicht', 'Bedrijf', 'Voorwaarden', 'Website', 'Douane', 'Kortingen', 'Catalogusdata', 'Dit toestel']);
});

test('the tab strip drops Douane once /douane exists, and views the build lacks', () => {
  assert.ok(settingsTabs({ douaneRoute: false }).some((tab) => tab.id === 'duties'));
  assert.ok(!settingsTabs({ douaneRoute: true }).some((tab) => tab.id === 'duties'));
  assert.deepEqual(settingsTabs({ douaneRoute: false, available: ['overview', 'company'] }).map((tab) => tab.id), ['overview', 'company']);
});

test('view links: the overview has no query, a view its sectie', () => {
  assert.equal(settingsViewQuery('overview'), null);
  assert.deepEqual(settingsViewQuery('discounts'), { sectie: 'discounts' });
});

test('categories redirects to /website/categories with only the parameters present', () => {
  assert.equal(settingsCategoryRedirect({ sectie: 'company' }), null);
  assert.deepEqual(settingsCategoryRedirect({ sectie: 'categories' }), { path: '/website/categories', queryParams: {} });
  assert.deepEqual(settingsCategoryRedirect({ sectie: 'categories', category: 'display-roses', language: 'FR', focus: 'category-name', returnTo: '/x' }),
    { path: '/website/categories', queryParams: { category: 'display-roses', language: 'FR', focus: 'category-name' } });
  assert.deepEqual(settingsCategoryRedirect({ sectie: 'categories', category: 'soap', language: null, focus: '' }),
    { path: '/website/categories', queryParams: { category: 'soap' } });
});

test('device deep links name their card', () => {
  assert.equal(deviceFocus('notifications'), 'notifications');
  assert.equal(deviceFocus('appearance'), 'appearance');
  assert.equal(deviceFocus('device'), null);
});

test('the overview is /settings with no known view; "Alle instellingen" goes back to it when it lies below', () => {
  for (const url of ['/settings', '/settings/', '/settings?sectie=', '/settings?sectie=unknown', '/settings?returnTo=%2Fmore', '/settings#top']) {
    assert.equal(isSettingsOverviewUrl(url), true, url);
  }
  for (const url of [null, undefined, '', '/settings?sectie=company', '/settings?sectie=discounts&category=x',
    '/settings/deleted-items', '/settings/overzicht', '/settingsx', '/more']) {
    assert.equal(isSettingsOverviewUrl(url), false, String(url));
  }
});
