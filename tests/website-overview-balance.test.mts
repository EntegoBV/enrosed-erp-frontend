import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { langsColumn, todoCardHeight } from '../src/app/features/website-builder/website-overview-balance.ts';

const live = 48 + 2 * 40;
const recent = 48 + 8 * 53;
const langs = 48 + 3 * 52;

test('production-shaped Te doen (8 rows in 3 sections): the languages go under Te doen, the smaller gap', () => {
  const todo = todoCardHeight(8, 3);
  assert.equal(todo, 554);
  assert.equal(langsColumn({ todo, live, recent, langs }), 'left');
});

test('a long Te doen keeps the languages on the right', () => {
  assert.equal(langsColumn({ todo: todoCardHeight(20, 4), live, recent, langs }), 'right');
});

test('nothing to do: the empty card plus the languages still balance best on the left', () => {
  assert.equal(todoCardHeight(0, 0), 190);
  assert.equal(langsColumn({ todo: 190, live, recent, langs }), 'left');
});

test('Recent gewijzigd is mounted once, in the right column, never moved after the data lands', async () => {
  const page = await readFile(new URL('../src/app/features/website-builder/website-admin-page.ts', import.meta.url), 'utf8');
  assert.equal((page.match(/<app-website-recent layout="card"/g) ?? []).length, 1);
  assert.doesNotMatch(page, /recentRight/);
  assert.match(page, /@if \(langsPlace\(\) === 'left'\)/);
  assert.match(page, /@if \(langsPlace\(\) === 'right'\)/);
});

test('Te doen never shows an empty "+n" chip at 1440 when 4 or 5 languages are missing', async () => {
  const queue = await readFile(new URL('../src/app/features/website-builder/website-translation-queue.ts', import.meta.url), 'utf8');
  const css = await readFile(new URL('../src/styles/website-overview.scss', import.meta.url), 'utf8');
  assert.match(queue, /\[class\.ws-lang--narrow\]="row\.missingLanguages\.length <= 5"/);
  assert.match(css, /@media \(min-width:1348px\)\{\.ws-lang--narrow\{display:none\}\}/);
});
