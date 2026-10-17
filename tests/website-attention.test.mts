import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { Category, ContentTranslationGroup, LanguageCode, ProductFamily, ProductFamilyText } from '../src/app/core/api/models.ts';
import {
  ATTENTION_ORDER,
  WEBSITE_LANGUAGE_ORDER,
  attentionHeading,
  categoryMissingLanguages,
  detailTranslationLanguages,
  familyCompleteness,
  familyProductId,
  looksDutch,
  missingPerLanguage,
  plural,
  seoAttention,
  websiteAttention,
  websiteCounts,
  websiteStatusWord,
  websiteTodos,
} from '../src/app/features/website-builder/website-attention.ts';

const ALL = WEBSITE_LANGUAGE_ORDER;

function text(language: LanguageCode, patch: Partial<ProductFamilyText> = {}): ProductFamilyText {
  return { language, name: `Naam ${language}`, summary: null, description: `Beschrijving ${language}`, format: null,
    highlights: [], seoTitle: `SEO ${language}`, seoDescription: `SEO beschrijving ${language}`, ...patch };
}

function family(id: number, patch: Partial<ProductFamily> = {}): ProductFamily {
  return {
    id, familyKey: `reeks-${id}`, publicHandle: `reeks-${id}`, categoryId: 1, categoryKey: 'domes', categoryName: 'Domes',
    categoryPosition: 1, collectionKey: null, collections: [], productPosition: id, cardFeaturedProductId: null, tags: [],
    websiteStatus: 'PUBLISHED', orderAppStatus: 'PUBLISHED', catalogueStatus: 'DRAFT', active: true, name: `Reeks ${id}`,
    summary: null, description: null, format: null, highlights: [], seoTitle: null, seoDescription: null, dimensions: null,
    texts: ALL.map((code) => text(code)), packages: [], images: [], externalIdentifiers: [], priceObservations: [],
    provenance: [], conflicts: [], publicationIssues: [],
    members: [{ productId: id * 10, canonicalVariantKey: null, sku: null, name: 'Variant', colour: null, colourHex: null,
      size: null, position: 0, active: true }],
    variantCount: 1,
    ...patch,
  };
}

const deps = { familyName: (item: ProductFamily) => item.name, isSizeIssue: (issue: string) => /\.size$/.test(issue) };

test('the module has no runtime imports, so node can test it', async () => {
  const source = await readFile(new URL('../src/app/features/website-builder/website-attention.ts', import.meta.url), 'utf8');
  for (const line of source.split('\n').filter((row) => row.startsWith('import'))) {
    assert.match(line, /^import type /, line);
  }
});

test('completeness counts name + description and SEO title + description per language', () => {
  const item = family(1, { texts: ALL.map((code) => code === 'FR' ? text(code, { description: ' ' })
    : code === 'DE' ? text(code, { seoTitle: null }) : code === 'EL' ? text(code, { name: '' }) : text(code)) });
  const result = familyCompleteness(item, ALL);
  assert.equal(result.text, 7);
  assert.equal(result.seo, 8);
  assert.deepEqual(result.missingText, ['FR', 'EL']);
  assert.deepEqual(result.missingName, ['EL']);
  assert.deepEqual(result.missingDescription, ['FR']);
  assert.deepEqual(result.missingSeo, ['DE']);
});

test('the attention rule, in order', () => {
  const full = { text: 9, seo: 9 };
  assert.equal(websiteAttention(family(1, { active: false }), full, 9), 'inactive-live');
  assert.equal(websiteAttention(family(1, { active: false, websiteStatus: 'DRAFT' }), full, 9), null);
  assert.equal(websiteAttention(family(1, { publicationIssues: ['x'], websiteStatus: 'DRAFT' }), full, 9), 'issues');
  assert.equal(websiteAttention(family(1, { publicationIssues: ['x'] }), full, 9), 'issues');
  assert.equal(websiteAttention(family(1, { websiteStatus: 'DRAFT' }), full, 9), 'ready');
  assert.equal(websiteAttention(family(1, { websiteStatus: 'READY' }), { text: 3, seo: 9 }, 9), 'ready');
  assert.equal(websiteAttention(family(1), { text: 9, seo: 8 }, 9), 'incomplete');
  assert.equal(websiteAttention(family(1), full, 9), null);
  assert.deepEqual([...ATTENTION_ORDER], ['inactive-live', 'issues', 'ready', 'incomplete']);
  assert.equal(attentionHeading('issues'), 'Nog niet publicatieklaar');
  assert.equal(attentionHeading('ready'), 'Klaar om live te zetten');
});

test('"Nog niet publicatieklaar" counts exactly what the dashboard counts', () => {
  const families = [
    family(1, { publicationIssues: ['a', 'b'], websiteStatus: 'DRAFT' }),
    family(2, { publicationIssues: ['a'] }),
    family(3, { publicationIssues: ['a'], active: false }),
    family(4, { publicationIssues: ['a'], active: false, websiteStatus: 'DRAFT' }),
    family(5, { websiteStatus: 'DRAFT' }),
    family(6),
  ];
  const dashboard = families.filter((item) => item.active && item.publicationIssues.length > 0).length;
  const counts = websiteCounts({ families, categories: [], groups: [] });
  assert.equal(counts.notReady, dashboard);
  assert.equal(counts.byReason['inactive-live'], 1);
  assert.equal(counts.byReason.ready, 1);
  assert.equal(counts.attention, 4);
});

test('one status word per state', () => {
  assert.equal(websiteStatusWord(family(1)), 'Live');
  assert.equal(websiteStatusWord(family(1, { websiteStatus: 'DRAFT' })), 'Concept');
  assert.equal(websiteStatusWord(family(1, { websiteStatus: 'READY' })), 'Verborgen');
  assert.equal(websiteStatusWord(family(1, { active: false })), 'Niet actief in ERP');
});

test('the product editor of a reeks is its first active variant', () => {
  const members = family(1).members;
  assert.equal(familyProductId(family(1, { members: [{ ...members[0], productId: 7, active: false }, { ...members[0], productId: 8 }] })), 8);
  assert.equal(familyProductId(family(1, { members: [{ ...members[0], productId: 7, active: false }] })), 7);
  assert.equal(familyProductId(family(1, { members: [] })), null);
});

test('detail translations come from variant and alt issues, never from a per-language Maat', () => {
  const item = family(1, { publicationIssues: [
    'website.families.reeks-1.variants.RD.fr.color',
    'website.families.reeks-1.variants.RD.de.size',
    'website.families.reeks-1.images.3.pl.alt',
    'website.families.reeks-1.en.name',
  ] });
  assert.deepEqual(detailTranslationLanguages(item, ALL, deps.isSizeIssue), ['FR', 'PL']);
});

test('Te doen: one row per reeks with true details and links', () => {
  const todos = websiteTodos({
    ...deps,
    families: [
      family(1, { name: 'TEST PRODUCT', websiteStatus: 'DRAFT', categoryName: null, members: [], variantCount: 0,
        publicationIssues: ['1', '2', '3', '4', '5', '6', '7', '8'],
        texts: [text('NL'), text('EN', { name: null, description: null, seoTitle: null })] }),
      family(2, { name: 'Heart-Shaped Flowerbox', websiteStatus: 'DRAFT', variantCount: 0, publicationIssues: ['a', 'b', 'c'] }),
      family(3, { name: 'Foam Rose Bear 25 cm', websiteStatus: 'DRAFT' }),
      family(4, { name: 'Bear met gaten', websiteStatus: 'DRAFT', texts: ALL.map((code) => code === 'TR' || code === 'EL' ? text(code, { seoTitle: null }) : text(code)) }),
      family(5, { name: 'Live onvolledig', texts: ALL.map((code) => code === 'FR' ? text(code, { description: null }) : text(code)) }),
      family(6, { name: 'Live onvolledig zonder product', members: [], texts: ALL.map((code) => code === 'DE' ? text(code, { seoTitle: null }) : text(code)) }),
      family(7, { name: 'Oud maar live', active: false }),
      family(8, { name: 'Compleet en live' }),
      family(9, { name: 'Inactief concept', active: false, websiteStatus: 'DRAFT' }),
    ],
    categories: [],
    groups: [],
  });
  assert.equal(new Set(todos.map((row) => row.key)).size, todos.length, 'never two rows for one reeks');
  assert.deepEqual(todos.map((row) => row.title), [
    'Oud maar live', 'TEST PRODUCT', 'Heart-Shaped Flowerbox', 'Bear met gaten', 'Foam Rose Bear 25 cm',
    'Live onvolledig', 'Live onvolledig zonder product',
  ]);
  const byTitle = new Map(todos.map((row) => [row.title, row]));
  const test1 = byTitle.get('TEST PRODUCT')!;
  assert.equal(test1.section, 'publish');
  assert.equal(test1.detail, '8 publicatiepunten · nog geen varianten gekoppeld · naam, beschrijving en SEO ontbreken');
  assert.deepEqual(test1.missingLanguages, ['EN', 'FR', 'DE', 'ES', 'PL', 'PT', 'TR', 'EL']);
  assert.equal(test1.link, '/website/products');
  assert.deepEqual(test1.query, { reeks: '1' });
  assert.equal(byTitle.get('Heart-Shaped Flowerbox')!.detail, '3 publicatiepunten · nog geen varianten gekoppeld');
  assert.equal(byTitle.get('Oud maar live')!.detail, 'Live, maar niet actief in ERP');
  const ready = byTitle.get('Foam Rose Bear 25 cm')!;
  assert.equal(ready.section, 'live');
  assert.equal(ready.detail, 'Alles compleet · staat nog op Concept');
  const readyGaps = byTitle.get('Bear met gaten')!;
  assert.equal(readyGaps.section, 'live');
  assert.equal(readyGaps.detail, 'Klaar om live te zetten · SEO 7/9');
  assert.deepEqual(readyGaps.missingLanguages, ['TR', 'EL']);
  const incomplete = byTitle.get('Live onvolledig')!;
  assert.equal(incomplete.section, 'translate');
  assert.equal(incomplete.detail, 'Tekst');
  assert.deepEqual(incomplete.link, ['/products', 50, 'translations']);
  const orphan = byTitle.get('Live onvolledig zonder product')!;
  assert.equal(orphan.detail, 'SEO');
  assert.equal(orphan.link, '/website/products', 'never /products/null/translations');
  assert.deepEqual(orphan.query, { reeks: '6' });
});

test('Te doen: live reeksen first inside a section, then most points', () => {
  const todos = websiteTodos({ ...deps, categories: [], groups: [], families: [
    family(1, { name: 'A concept 1', websiteStatus: 'DRAFT', publicationIssues: ['x'] }),
    family(2, { name: 'B concept 3', websiteStatus: 'DRAFT', publicationIssues: ['x', 'y', 'z'] }),
    family(3, { name: 'C live 1', publicationIssues: ['x'] }),
  ] });
  assert.deepEqual(todos.map((row) => row.title), ['C live 1', 'B concept 3', 'A concept 1']);
  assert.equal(todos[1].detail, '3 publicatiepunten');
  assert.equal(todos[2].detail, '1 publicatiepunt');
});

test('Te doen: categories and required text groups in the language order of the screens', () => {
  const category: Category = { id: 4, code: 'domes', name: 'Domes', mobileName: 'Domes', eyebrow: null, description: null,
    position: 1, featuredProductId: null, navigationName: null, footerName: null,
    texts: ALL.map((code) => ({ language: code, name: code === 'PL' ? null : 'Domes', description: null, eyebrow: null,
      mobileName: code === 'FR' ? '' : 'Domes', navigationName: null, footerName: null })) };
  const group = (key: string, missing: LanguageCode[], required = true): ContentTranslationGroup => ({
    scope: 'WEBSITE', key, label: `Homepage · ${key}`, required, system: true, revision: 1, texts: [], missingLanguages: missing });
  const todos = websiteTodos({ ...deps, families: [], categories: [category],
    groups: [group('home.hero.title', ['EL', 'FR']), group('home.optional', ['DE'], false), group('home.done', [])] });
  assert.equal(todos.length, 2);
  assert.equal(todos[0].kind, 'categorie');
  assert.equal(todos[0].detail, 'Categorienaam of menunamen');
  assert.deepEqual(todos[0].missingLanguages, ['FR', 'PL']);
  assert.deepEqual(todos[0].query, { code: 'domes' });
  assert.equal(todos[1].kind, 'tekst');
  assert.deepEqual(todos[1].missingLanguages, ['FR', 'EL']);
  assert.equal(todos[1].link, '/website/texts');
  assert.deepEqual(todos[1].query, { key: 'home.hero.title' });
  assert.deepEqual(categoryMissingLanguages(category, ALL), ['FR', 'PL']);
});

test('real plurals', () => {
  assert.equal(plural(1, 'variant', 'varianten'), '1 variant');
  assert.equal(plural(3, 'variant', 'varianten'), '3 varianten');
  assert.equal(plural(0, 'blok', 'blokken'), '0 blokken');
});

test('SEO attention: missing languages or an English title that reads Dutch', () => {
  assert.equal(looksDutch('Gepreserveerde roos in glazen stolp'), true);
  assert.equal(looksDutch('Preserved rose in a glass dome'), false);
  assert.equal(looksDutch('Rose de luxe voor het huis'), true);
  assert.equal(looksDutch(null), false);
  const dutch = seoAttention(family(1, { texts: ALL.map((code) => code === 'EN' ? text(code, { seoTitle: 'Rozen in een doos' }) : text(code)) }), ALL);
  assert.equal(dutch.suspiciousEnglish, true);
  assert.equal(dutch.attention, true);
  const missing = seoAttention(family(1, { texts: ALL.map((code) => code === 'PT' ? text(code, { seoDescription: '' }) : text(code)) }), ALL);
  assert.deepEqual(missing.missingLanguages, ['PT']);
  assert.equal(seoAttention(family(1), ALL).attention, false);
});

test('counts for the side, the tab bar and the figures strip', () => {
  const groups: ContentTranslationGroup[] = [
    { scope: 'WEBSITE', key: 'a', label: 'a', required: true, system: true, revision: 1, texts: [], missingLanguages: ['FR'] },
    { scope: 'WEBSITE', key: 'b', label: 'b', required: true, system: true, revision: 1, texts: [], missingLanguages: [] },
  ];
  const families = [
    family(1),
    family(2, { texts: ALL.map((code) => code === 'EN' ? text(code, { seoTitle: 'Glazen roos' }) : text(code)) }),
    family(3, { websiteStatus: 'DRAFT', texts: [text('NL')] }),
    family(4, { websiteStatus: 'READY' }),
    family(5, { active: false, websiteStatus: 'DRAFT' }),
  ];
  const counts = websiteCounts({ families, categories: [], groups });
  assert.equal(counts.families, 5);
  assert.equal(counts.live, 2);
  assert.equal(counts.concept, 2);
  assert.equal(counts.hidden, 1);
  assert.equal(counts.seoTotal, 4);
  assert.equal(counts.seoOk, 2);
  assert.equal(counts.seoLiveTotal, 2);
  assert.equal(counts.seoLiveAttention, 1);
  assert.equal(counts.textsMissing, 1);
  assert.equal(counts.textGroups, 2);
  assert.equal(counts.textsPercent, 94, '17 of 18 fields, rounded down: never 100 % with a field empty');
  assert.deepEqual(missingPerLanguage(groups), [{ code: 'FR', missing: 1 }]);
  const empty = websiteCounts({ families: null, categories: null, groups: null });
  assert.equal(empty.attention, 0);
  assert.equal(empty.textsPercent, 100);
});
