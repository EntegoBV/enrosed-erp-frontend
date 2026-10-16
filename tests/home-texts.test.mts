import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

/*
 * Words and places on the home that a screen check found wrong (release
 * 2026-10-16, round 1). The templates are read as text: the components
 * import Angular at run time.
 */
const read = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');

test('a day that could not be checked whole says so in plain Dutch, and the phone line wraps instead of being cut', async () => {
  const files = ['home-desk.ts', 'home-phone.ts', 'open-page.ts'];
  for (const file of files) {
    const source = await read(`app/features/dashboard/${file}`);
    assert.doesNotMatch(source, /all-clear/, file);
    assert.match(source, /Nog niet alles nagekeken/, file);
  }
  // The phone cell beside Opnieuw: 'Nog geen volledige all-…' at 390 had no title; the line now takes a second row at 360.
  const phone = await read('app/features/dashboard/home-phone.ts');
  assert.match(phone, /<span class="ios-cell__title ios-cell__title--strong home-todo__unsure">Nog niet alles nagekeken<\/span>/);
  assert.match(await read('styles/home-phone.scss'), /\.home-todo__unsure \{ overflow: visible; text-overflow: clip; white-space: normal; \}/);
});
