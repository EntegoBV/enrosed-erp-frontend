import assert from 'node:assert/strict';
import test from 'node:test';
import {
  catalogTranslationAffectedProductIds,
  catalogTranslationLinks,
} from '../src/app/features/products/catalog-translation-issues.ts';

const products = [
  { id: 11, familyKey: 'preserved-bowl-rose', categoryId: 7, name: 'Bowl Rose XL Red' },
  { id: 12, familyKey: 'preserved-bowl-rose', categoryId: 7, name: 'Bowl Rose XL Pink' },
  { id: 21, familyKey: null, categoryId: 8, name: 'Single Rose Black' },
];

const categories = [
  { id: 7, code: 'preserved-roses', name: 'Preserved Roses' },
];

test('catalog copy links preserve the exact content key and requested language', () => {
  const [issue] = catalogTranslationLinks(
    ['catalog.copy.catalog.cover.title'],
    'NL',
    products,
    categories,
  );

  assert.deepEqual(issue, {
    path: 'catalog.copy.catalog.cover.title',
    kind: 'CATALOG_COPY',
    entityLabel: 'Catalogustekst · Catalog cover title',
    fieldLabel: 'Tekst invullen',
    route: '/catalog/texts',
    queryParams: {
      language: 'NL',
      returnTo: '/catalog-export',
      key: 'catalog.cover.title',
    },
    affectedProductIds: [],
  });
});

test('category links open the exact category, language, and missing field', () => {
  const [issue] = catalogTranslationLinks(
    ['categories.preserved-roses.description'],
    'NL',
    products,
    categories,
    new Set([11, 12, 21]),
  );

  assert.equal(issue.route, '/settings');
  assert.equal(issue.entityLabel, 'Categorie · Preserved Roses');
  assert.equal(issue.fieldLabel, 'Beschrijving');
  assert.deepEqual(issue.queryParams, {
    language: 'NL',
    returnTo: '/catalog-export',
    sectie: 'categories',
    category: 'preserved-roses',
    focus: 'category-description',
  });
  assert.deepEqual(issue.affectedProductIds, [11, 12]);
});

test('family links prefer a selected family member and target the precise shared field', () => {
  const [issue] = catalogTranslationLinks(
    ['families.preserved-bowl-rose.highlights'],
    'NL',
    products,
    categories,
    new Set([12]),
  );

  assert.equal(issue.route, '/products/12/translations');
  assert.equal(issue.entityLabel, 'Productreeks · Bowl Rose XL Pink');
  assert.equal(issue.fieldLabel, 'Highlights');
  assert.deepEqual(issue.queryParams, {
    language: 'NL',
    returnTo: '/catalog-export',
    focus: 'family-highlights',
  });
  assert.deepEqual(issue.affectedProductIds, [12]);
});

test('every strict family field maps to its shared translation field', () => {
  const issues = catalogTranslationLinks([
    'families.preserved-bowl-rose.name',
    'families.preserved-bowl-rose.summary',
    'families.preserved-bowl-rose.description',
    'families.preserved-bowl-rose.format',
    'families.preserved-bowl-rose.highlights',
  ], 'NL', products, categories);

  assert.deepEqual(issues.map((issue) => issue.queryParams.focus), [
    'family-name',
    'family-summary',
    'family-description',
    'family-format',
    'family-highlights',
  ]);
  assert.ok(issues.every((issue) => issue.route === '/products/11/translations'));
});

test('every strict product field maps to the product translation editor', () => {
  const issues = catalogTranslationLinks([
    'products.21.name',
    'products.21.description',
    'products.21.color',
    'products.21.size',
  ], 'NL', products, categories, new Set([21]));

  assert.deepEqual(issues.map((issue) => [issue.route, issue.queryParams.focus]), [
    ['/products/21/translations', 'variant-name'],
    ['/products/21/translations', 'variant-description'],
    ['/products/21/translations', 'variant-colour'],
    ['/products/21/translations', 'variant-size'],
  ]);
  assert.ok(issues.every((issue) => issue.affectedProductIds.join(',') === '21'));
});

test('family fields fall back to a known member and unknown paths remain visible', () => {
  const issues = catalogTranslationLinks([
    'families.preserved-bowl-rose.format',
    'families.missing-family.summary',
    'unexpected.path',
  ], 'NL', products, categories);

  assert.equal(issues[0].route, '/products/11/translations');
  assert.equal(issues[0].queryParams.focus, 'family-format');
  assert.equal(issues[1].route, null);
  assert.deepEqual(issues[1].affectedProductIds, []);
  assert.equal(issues[1].fieldLabel, 'Samenvatting');
  assert.equal(issues[2].route, null);
  assert.deepEqual(issues[2].affectedProductIds, []);
  assert.equal(issues[2].fieldLabel, 'unexpected.path');
});

test('blank, duplicate, and non-string paths do not create duplicate issue cards', () => {
  const issues = catalogTranslationLinks([
    ' products.21.color ',
    'products.21.color',
    '',
    null,
    21,
  ], 'NL', products, categories);

  assert.deepEqual(issues.map((issue) => issue.path), ['products.21.color']);
});

test('affected products combine category, family and product issues without global-copy duplicates', () => {
  const issues = catalogTranslationLinks([
    'categories.preserved-roses.description',
    'families.preserved-bowl-rose.summary',
    'products.21.name',
    'catalog.copy.catalog.cover.title',
  ], 'NL', products, categories, new Set([11, 12, 21]));

  assert.deepEqual([...catalogTranslationAffectedProductIds(issues)], [11, 12, 21]);
});
