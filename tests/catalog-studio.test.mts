import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogueFamilies, cataloguePhoto } from '../src/app/features/products/catalog-studio.ts';
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
