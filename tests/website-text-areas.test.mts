import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { ContentTranslationGroup } from '../src/app/core/api/models.ts';
import {
  OTHER_AREA,
  displayLabel,
  groupByArea,
  homeSubArea,
  websiteTextArea,
  websiteTextAreas,
} from '../src/app/features/website-builder/website-text-areas.ts';

function group(key: string, label: string, nl = ''): ContentTranslationGroup {
  return { scope: 'WEBSITE', key, label, required: true, system: true, revision: 1,
    texts: [{ language: 'NL', value: nl }], missingLanguages: [] };
}

test('the module has no runtime imports, so node can test it', async () => {
  const source = await readFile(new URL('../src/app/features/website-builder/website-text-areas.ts', import.meta.url), 'utf8');
  for (const line of source.split('\n').filter((row) => row.startsWith('import'))) assert.match(line, /^import type /, line);
});

test('the area is the first segment only', () => {
  assert.equal(websiteTextArea('home.hero.title').label, 'Homepage');
  assert.equal(websiteTextArea('quote.product.title').label, 'Offerte', 'quote.product.* is no second Producten');
  assert.equal(websiteTextArea('product.gallery.next').label, 'Productpagina’s');
  assert.equal(websiteTextArea('products.card.cta').label, 'Productpagina’s');
  assert.equal(websiteTextArea('meta.home.title').label, 'SEO');
  assert.equal(websiteTextArea('notFound.title').label, '404-pagina');
  assert.equal(websiteTextArea('a11y.skip').label, 'Toegankelijkheid');
  assert.equal(websiteTextArea('legal.trade.title').label, 'Juridisch');
  assert.equal(websiteTextArea('navigation.menu').label, 'Header & menu');
  assert.deepEqual(websiteTextArea('mystery.key'), OTHER_AREA);
  assert.deepEqual(websiteTextAreas().map((area) => area.order), [...websiteTextAreas().map((area) => area.order)].sort((a, b) => a - b));
});

test('homepage sub-areas follow the blocks', () => {
  assert.deepEqual(homeSubArea('home.hero.title'), { label: 'Openingsbeeld', order: 1 });
  assert.deepEqual(homeSubArea('home.marquee.text'), { label: 'Openingsbeeld', order: 1 });
  assert.equal(homeSubArea('home.catalog.title')?.label, 'Ons assortiment · Volledige collectie');
  assert.equal(homeSubArea('home.tradeFlow.step1')?.label, 'Handelsflow');
  assert.equal(homeSubArea('home.quote.title')?.label, 'Offerte aanvragen');
  assert.equal(homeSubArea('quote.title'), null);
});

test('labels lose the repeated area word; a bare key shows its Dutch text', () => {
  assert.equal(displayLabel(group('home.hero.title', 'Homepage · Hero · titel')), 'Hero · titel');
  assert.equal(displayLabel(group('contact.form.name', 'contact · Formulier · naam')), 'Formulier · naam');
  assert.equal(displayLabel(group('notFound.title', '404-pagina · titel')), 'Titel', 'the first word starts with a capital');
  assert.equal(displayLabel(group('meta.home.title', 'Homepage · SEO-titel')), 'Homepage · SEO-titel', 'meta keeps the page name');
  assert.equal(displayLabel(group('footer', 'Footer')), 'Footer');
  assert.equal(displayLabel(group('consent.enabled', 'consent.enabled', 'Ingeschakeld')), 'Ingeschakeld');
  assert.equal(displayLabel(group('consent.bannerDescription', 'consent.bannerDescription',
    'We gebruiken analytische cookies om te begrijpen hoe bezoekers de website gebruiken.')),
    'We gebruiken analytische cookies om te begrijpe…', 'cut to 48 characters');
  assert.equal(displayLabel(group('consent.empty', 'consent.empty')), 'consent.empty');
});

test('groups sort by area in site order; the homepage by block, others keep server order', () => {
  const sections = groupByArea([
    group('legal.b', 'x'), group('home.faq.q1', 'x'), group('quote.product.title', 'x'), group('home.hero.title', 'x'),
    group('legal.a', 'x'), group('mystery', 'x'), group('home.catalog.title', 'x'), group('header.menu', 'x'),
  ]);
  assert.deepEqual(sections.map((section) => section.area.label), ['Homepage', 'Header & menu', 'Offerte', 'Juridisch', 'Overig']);
  assert.deepEqual(sections[0].groups.map((item) => item.key), ['home.hero.title', 'home.catalog.title', 'home.faq.q1']);
  assert.deepEqual(sections[3].groups.map((item) => item.key), ['legal.b', 'legal.a']);
});
