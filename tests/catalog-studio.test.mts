import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  CATALOGUE_PHOTO_LINK_LABEL, CATALOGUE_PHOTO_LINK_QUERY, CATALOGUE_STUDIO_VIEW_KEY, catalogueFamilies, catalogueFamilyKey, cataloguePhoto, cataloguePhotoLink,
  parseStudioView, serializeStudioView,
} from '../src/app/features/products/catalog-studio.ts';
import type { PhotoDto, Product } from '../src/app/core/api/models.ts';

const photo = (id: number, leadFor: PhotoDto['leadFor'] = []): PhotoDto => ({ id, url: `/photos/${id}`, leadFor } as PhotoDto);
const product = (id: number | null, familyId: number | null, photos: PhotoDto[] = []): Product => ({ id, familyId, name: `SKU ${id}`, photos } as Product);

test('catalogue photos use their explicit lead without changing the original order', () => {
  const photos = [photo(1, ['WEBSITE']), photo(2, ['CATALOGUE'])];
  assert.equal(cataloguePhoto({ photos })?.id, 2);
  assert.deepEqual(photos.map((p) => p.id), [1, 2]);
  assert.equal(cataloguePhoto({ photos: [photo(3)] })?.id, 3);
  assert.equal(cataloguePhoto({ photos: [] }), null);
});

test('families retain complete variant membership, canonical names, and first selection order', () => {
  const groups = catalogueFamilies([product(1, 10), product(2, 20, [photo(2)]), product(3, 10, [photo(3)])], [{ id: 10, name: 'Glazen stolp' }, { id: 20, name: 'Display' }]);
  assert.deepEqual(groups.map((g) => [g.key, g.name, g.products.map((p) => p.id)]), [
    ['family:10', 'Glazen stolp', [1, 3]], ['family:20', 'Display', [2]],
  ]);
  assert.equal(groups[0].photo?.id, 3);
});

test('unlinked products are separate groups and unsaved products cannot enter an export', () => {
  const groups = catalogueFamilies([product(1, null), product(null, null), product(2, null), product(3, 30)], []);
  assert.deepEqual(groups.map((g) => [g.key, g.name]), [['product:1', 'SKU 1'], ['product:2', 'SKU 2'], ['family:30', 'SKU 3']]);
  assert.equal(catalogueFamilies([], []).length, 0);
});

test('a selected variant catalogue lead wins over an earlier fallback, but an excluded variant cannot supply it', () => {
  const first = product(1, 10, [photo(11, ['WEBSITE'])]);
  const second = product(2, 10, [photo(21), photo(22, ['CATALOGUE'])]);
  const third = product(3, 10, [photo(31, ['CATALOGUE'])]);
  assert.equal(catalogueFamilies([first, second, third], [])[0].photo?.id, 22);
  assert.equal(catalogueFamilies([first], [])[0].photo?.id, 11);
});

test('"Catalogusfoto wijzigen" leads to the photo section of that colour with the catalogue picker asked for', () => {
  assert.equal(CATALOGUE_PHOTO_LINK_LABEL, 'Catalogusfoto wijzigen');
  assert.deepEqual(cataloguePhotoLink(101), { commands: ['/products', 101, 'edit'], queryParams: { tab: 'media', kies: 'catalogus' } });
  assert.equal(cataloguePhotoLink(101).queryParams, CATALOGUE_PHOTO_LINK_QUERY, 'The row link binds the same query as the menu item uses');
});

test('the studio remembers its open cards and the row to return to, and starts closed on anything it cannot read', () => {
  const closed = { editorOpen: false, expanded: [], returnProductId: null };
  const view = { editorOpen: true, expanded: [catalogueFamilyKey({ id: 100, familyId: 33 }), catalogueFamilyKey({ id: 7, familyId: null })], returnProductId: 101 };
  assert.deepEqual(view.expanded, ['family:33', 'product:7']);
  assert.deepEqual(parseStudioView(serializeStudioView(view)), view);
  assert.deepEqual(parseStudioView(serializeStudioView({ ...view, returnProductId: null })), { ...view, returnProductId: null });
  for (const raw of [null, undefined, '', 'not json', 'null', '[]', '"open"', '{"expanded":"family:33"}']) {
    assert.deepEqual(parseStudioView(raw), closed, `${raw} gives the closed start`);
  }
  assert.deepEqual(parseStudioView(JSON.stringify({ editorOpen: 'yes', expanded: ['family:33', 'family:33', 33, 'family:x', '__proto__', 'product:7'], returnProductId: '101' })),
    { editorOpen: false, expanded: ['family:33', 'product:7'], returnProductId: null }, 'Only what the studio itself writes is taken over');
  assert.equal(parseStudioView(JSON.stringify({ returnProductId: -4 })).returnProductId, null);
  assert.equal(parseStudioView(JSON.stringify({ returnProductId: 1.5 })).returnProductId, null);
  const many = Array.from({ length: 500 }, (_, index) => `family:${index}`);
  assert.equal(parseStudioView(serializeStudioView({ ...view, expanded: many })).expanded.length, 200);
  assert.equal(parseStudioView(JSON.stringify({ expanded: many })).expanded.length, 200, 'A list that was not written by the studio is cut too');
  assert.equal(CATALOGUE_STUDIO_VIEW_KEY, 'erp.catalog-studio.open-cards');
});

test('every colour row of the studio carries the link, the menu offers it too and the open cards survive leaving the page', async () => {
  const selection = await readFile(new URL('../src/app/features/products/catalog-product-selection.ts', import.meta.url), 'utf8');
  assert.match(selection, /<a class="product-choice__photo-link" \[attr\.data-catalogue-photo-link\]="product\.id"\s+\[routerLink\]="disabled\(\) \? null : \['\/products', product\.id, 'edit'\]" \[queryParams\]="photoLinkQuery"/);
  assert.match(selection, /readonly photoLinkQuery = CATALOGUE_PHOTO_LINK_QUERY;/);
  assert.match(selection, /\(click\)="rememberReturn\(product\)">\{\{ photoLinkLabel \}\}<\/a>/);
  assert.match(selection, /\{ id: 'catalogue-photo', label: CATALOGUE_PHOTO_LINK_LABEL,/);
  assert.match(selection, /case 'catalogue-photo':[\s\S]{0,200}this\.rememberReturn\(product\);\s+void this\.router\.navigate\(link\.commands, \{ queryParams: link\.queryParams \}\);/);
  assert.match(selection, /readonly expandedFamilies = signal<ReadonlySet<string>>\(new Set\(this\.remembered\.expanded\)\);/);
  assert.match(selection, /readonly selectionEditorOpen = signal\(this\.remembered\.editorOpen\);/);
  assert.match(selection, /\[open\]="selectionEditorOpen\(\) \|\| !!loadError\(\)"/, 'The fold opens again on return');
  // Storage can be blocked: both roads to sessionStorage sit in a try block.
  const storage = [...selection.matchAll(/try \{[^}]*sessionStorage\.(?:getItem|setItem)\(CATALOGUE_STUDIO_VIEW_KEY/g)];
  assert.equal(storage.length, 2);
  assert.equal(selection.match(/sessionStorage/g)?.length, 2, 'No unguarded use of the storage');
});

test('the photo block of the studio speaks the words of the photo section', async () => {
  const block = await readFile(new URL('../src/app/features/products/catalogue-photo-selection.ts', import.meta.url), 'utf8');
  for (const text of [
    'Kleine catalogusfoto (overzicht)', 'Grote catalogusfoto', 'Formaat van de grote catalogusfoto',
    'De catalogusfoto per kleur kies je bij het product: tik op ‘Catalogusfoto wijzigen’ bij de kleur.',
    'De catalogus kiest de foto bij het maken van de pdf.',
  ]) assert.ok(block.includes(text), text);
  const template = block.slice(block.indexOf('template: `'), block.indexOf('styles: `')) + block.slice(block.indexOf('readonly roles'));
  for (const word of ['assortiment', 'hoofdfoto', 'kleurfoto', 'productpagina', 'brochure', 'variant gekozen']) {
    assert.ok(!template.toLocaleLowerCase('nl').includes(word), `"${word}" is not a word of the photo section`);
  }
});
