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

test('the desk keeps "Alle analyses ›" (the old home had it over its figures), under Meer cijfers as on the phone', async () => {
  const desk = await read('app/features/dashboard/home-desk.ts');
  const head = /<header class="home-desk__more-head">([\s\S]*?)<\/header>\s*<div class="home-desk__more">/.exec(desk)?.[1] ?? '';
  assert.match(head, /<h2 class="home-desk__card-title">Meer cijfers<\/h2>/);
  assert.match(head, /<a class="wk-link" routerLink="\/analyses\/overview">Alle analyses <span aria-hidden="true">›<\/span><\/a>/);
  const phone = await read('app/features/dashboard/home-phone.ts');
  assert.match(phone, /<a class="ios-cell" routerLink="\/analyses\/overview">[\s\S]*?Alle analyses/, 'the phone has it under Meer cijfers');
  assert.match(await read('styles/home-desk.scss'), /\.home-desk__more-head \.wk-link \{ font-size: 13px; white-space: nowrap; \}/);
});
