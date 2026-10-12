import assert from 'node:assert/strict';
import test from 'node:test';
import { COST_CATEGORIES, categoryChoices, categoryLabel, categoryTone } from '../src/app/features/finance/cost-categories.ts';

test('the retired TICA category keeps its name on the rows that still carry it', () => {
  assert.equal(COST_CATEGORIES.some((category) => category.code === 'TICA'), false, 'the fair is the channel now, not a category');
  assert.equal(categoryLabel('TICA'), 'TICA');
  assert.equal(categoryLabel(' tica '), 'TICA');
  assert.equal(categoryChoices(['TICA']).find((category) => category.code === 'TICA')?.label, 'TICA');
  assert.equal(categoryTone('TICA'), 'grey');
});

test('known codes read by their label, unknown ones by a tidied code', () => {
  assert.equal(categoryLabel('beurs'), 'Beurs & stand');
  assert.equal(categoryLabel('OPLEIDING_PERSONEEL'), 'Opleiding personeel');
  assert.equal(categoryLabel(''), 'Zonder categorie');
  assert.equal(categoryLabel(null), 'Zonder categorie');
  assert.deepEqual(categoryChoices(['huur', 'EIGEN', null, '']).slice(-1)[0], { code: 'EIGEN', label: 'Eigen', hint: 'Eigen categorie', tone: 'grey' });
});
