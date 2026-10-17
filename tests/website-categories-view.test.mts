import assert from 'node:assert/strict';
import test from 'node:test';
import type { Category, LanguageCode, ProductFamily } from '../src/app/core/api/models.ts';
import {
  blankCategoryDraft,
  categoryCodeTaken,
  categoryCodeValid,
  categoryDeepLink,
  categoryDraftValid,
  categoryEditDraft,
  categoryMenuLine,
  categoryPhoneLine,
  categoryReeksCount,
  categorySavePayload,
  findCategoryByCode,
  mergeSavedCategory,
  movedCategoryIds,
  normalizeCategoryCode,
} from '../src/app/features/website-builder/website-categories-view.ts';

const LANGUAGES: LanguageCode[] = ['NL', 'EN', 'FR', 'DE', 'ES', 'PL', 'PT', 'TR', 'EL'];

function category(id: number | null, code: string, patch: Partial<Category> = {}): Category {
  return {
    id, code, name: code[0]?.toUpperCase() + code.slice(1), revision: 3, navigationName: null, footerName: null,
    mobileName: null, eyebrow: null, description: '', texts: [], position: id ?? 0, featuredProductId: null, ...patch,
  };
}

function family(categoryId: number | null, categoryName: string | null): ProductFamily {
  return { id: 1, familyKey: 'k', categoryId, categoryName } as unknown as ProductFamily;
}

const list = [category(1, 'display'), category(2, 'domes', { navigationName: 'Rose in Dome', mobileName: 'Rose in Dome', footerName: 'Rose in Dome', eyebrow: 'Gepreserveerd' }), category(3, 'boxes')];

test('codes: one canonical form, the URL pattern, and no code twice', () => {
  assert.equal(normalizeCategoryCode('  Rozen in Één Doos! '), 'rozen-in-een-doos');
  assert.equal(normalizeCategoryCode('--Soap__Roses--'), 'soap-roses');
  assert.equal(categoryCodeValid('Rose Dome'), true);
  assert.equal(categoryCodeValid('!!!'), false);
  assert.equal(categoryCodeTaken(list, { id: null, code: 'Domes' }), true);
  assert.equal(categoryCodeTaken(list, { id: 2, code: 'domes' }), false, 'its own code is not taken');
  assert.equal(categoryCodeTaken(list, { id: null, code: '' }), false);
});

test('a draft is valid with a name, a valid free code and a position', () => {
  assert.equal(categoryDraftValid(list, category(null, 'foam', { name: 'Foam' })), true);
  assert.equal(categoryDraftValid(list, category(null, 'foam', { name: '  ' })), false);
  assert.equal(categoryDraftValid(list, category(null, 'boxes', { name: 'Boxen' })), false);
  assert.equal(categoryDraftValid(list, category(null, 'foam', { name: 'Foam', position: Number.NaN })), false);
  assert.equal(categoryDraftValid(list, null), false);
});

test('a new category goes after the last one; an edit draft has every optional name', () => {
  assert.equal(blankCategoryDraft(list).position, 4);
  assert.equal(blankCategoryDraft([]).position, 1);
  const draft = categoryEditDraft({ ...list[0], revision: undefined, navigationName: undefined,
    texts: [{ language: 'FR', name: 'Présentoir', description: null, eyebrow: null, mobileName: null }] });
  assert.equal(draft.revision, null);
  assert.equal(draft.navigationName, null);
  assert.equal(draft.texts[0].footerName, null);
  assert.equal(draft.texts[0].navigationName, null);
});

test('the save payload trims, empties to null and keeps the code canonical', () => {
  const payload = categorySavePayload(category(null, ' Soap Roses ', {
    name: ' Soap ', mobileName: '  ', eyebrow: ' Gift-ready ', description: null, position: 4.4,
    texts: [{ language: 'FR', name: ' Savon ', navigationName: '', footerName: null, description: ' ', eyebrow: null, mobileName: 'Savon' }],
  }));
  assert.equal(payload.code, 'soap-roses');
  assert.equal(payload.name, 'Soap');
  assert.equal(payload.mobileName, null);
  assert.equal(payload.eyebrow, 'Gift-ready');
  assert.equal(payload.description, '');
  assert.equal(payload.position, 4);
  assert.deepEqual(payload.texts[0], { language: 'FR', name: 'Savon', navigationName: null, footerName: null, description: null, eyebrow: null, mobileName: 'Savon' });
});

test('a saved category lands in its place; a new one at the end of its position', () => {
  const saved = { ...list[2], name: 'Boxes XL' };
  assert.deepEqual(mergeSavedCategory(list, saved, false).map((item) => item.name), ['Display', 'Domes', 'Boxes XL']);
  const created = category(9, 'foam', { name: 'Foam', position: 2 });
  assert.deepEqual(mergeSavedCategory(list, created, true).map((item) => item.code), ['display', 'domes', 'foam', 'boxes']);
});

test('one step up or down gives the whole order; the ends refuse', () => {
  assert.deepEqual(movedCategoryIds(list, 2, -1), [2, 1, 3]);
  assert.deepEqual(movedCategoryIds(list, 2, 1), [1, 3, 2]);
  assert.equal(movedCategoryIds(list, 1, -1), null);
  assert.equal(movedCategoryIds(list, 3, 1), null);
  assert.equal(movedCategoryIds(list, 99, 1), null);
});

test('the menu names read as one line; none gives an empty line', () => {
  assert.equal(categoryMenuLine(list[1]), 'desktop „Rose in Dome” · mobiel „Rose in Dome” · footer „Rose in Dome” · bovenregel „Gepreserveerd”');
  assert.equal(categoryMenuLine(list[0]), '');
  assert.equal(categoryMenuLine(category(5, 'soap', { mobileName: ' Soap roses ' })), 'mobiel „Soap roses”');
});

test('reeksen count by category id where the reeks has one, else by name', () => {
  const families = [family(1, 'Display'), family(1, 'Display'), family(2, 'Domes'), family(null, 'display'), family(null, null), family(3, 'Display')];
  assert.equal(categoryReeksCount(list[0], families), 3, 'two by id, one by name; a reeks of another id with the same name does not count');
  assert.equal(categoryReeksCount(list[1], families), 1);
  assert.equal(categoryReeksCount(category(null, 'display', { name: 'Display' }), families), 4, 'a new category without id counts by name');
});

test('the phone line uses real plurals and leaves out an empty mobile name', () => {
  assert.equal(categoryPhoneLine(1, 9, 9, 'Display'), '1 reeks · 9/9 talen · Display');
  assert.equal(categoryPhoneLine(5, 8, 9, null), '5 reeksen · 8/9 talen');
  assert.equal(categoryPhoneLine(0, 9, 9, '  '), '0 reeksen · 9/9 talen');
});

test('deep links: ?code= (Te doen) and ?category= (older links) open the same category', () => {
  assert.deepEqual(categoryDeepLink({ code: 'domes' }, LANGUAGES), { code: 'domes', language: 'NL', focus: null });
  assert.deepEqual(categoryDeepLink({ category: 'domes', language: 'fr', focus: 'category-mobile-name' }, LANGUAGES),
    { code: 'domes', language: 'FR', focus: 'category-mobile-name' });
  assert.deepEqual(categoryDeepLink({ code: ' ', category: 'boxes', language: 'xx', focus: 'javascript:alert(1)' }, LANGUAGES),
    { code: 'boxes', language: 'NL', focus: null });
  assert.equal(findCategoryByCode(list, 'Domes')?.id, 2);
  assert.equal(findCategoryByCode(list, 'unknown'), null);
  assert.equal(findCategoryByCode(list, null), null);
});

test('Categorieën at 1100: Uitgelicht wraps to two lines like Menu, and one missing language reads "ontbreekt"', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(new URL('../src/styles/website-categories.scss', import.meta.url), 'utf8');
  const page = await readFile(new URL('../src/app/features/website-builder/website-categories-page.ts', import.meta.url), 'utf8');
  assert.match(css, /\.wk-td\.ws-cat-feat\{display:-webkit-box;[^}]*-webkit-line-clamp:2/);
  assert.match(page, /\(languageCount - row\.complete === 1 \? 'ontbreekt' : 'ontbreken'\)/);
});
