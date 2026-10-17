import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const css = await readFile(new URL('../src/styles/website-workspace.scss', import.meta.url), 'utf8');
const homepage = await readFile(new URL('../src/styles/website-homepage.scss', import.meta.url), 'utf8');
const texts = await readFile(new URL('../src/styles/website-texts-page.scss', import.meta.url), 'utf8');

/** "calc(var(--ios-tabbar-h) + var(--safe-b) + 18px)" → 18, the offset above the tab bar. */
function offset(rule: string): number {
  return Number(/var\(--safe-b\) \+ (\d+)px\)/.exec(rule)?.[1] ?? Number.NaN);
}

test('on the phone a toast stands above the Homepage and Teksten save bars, never on Opslaan', () => {
  const rule = /body:has\(\.shell--website \.ws-savebar, \.shell--website \.ws-ph-editor \.ws-edfoot\.is-dirty\) \.toasts\{bottom:calc\(var\(--ios-tabbar-h\) \+ var\(--safe-b\) \+ \d+px\)\}/.exec(css)?.[0];
  assert.ok(rule, 'the website partial lifts the toasts while a save bar shows');
  const savebar = /\.ws-savebar\{[^}]*bottom:calc\(var\(--ios-tabbar-h\) \+ var\(--safe-b\) \+ \d+px\)[^}]*min-height:(\d+)px/.exec(homepage);
  assert.ok(savebar, 'the Homepage save bar keeps its place and height');
  const barTop = offset(savebar[0]) + Number(savebar[1]);
  assert.ok(offset(rule) > barTop, `toast at +${offset(rule)} clears the bar top at +${barTop}`);
  const foot = /\.ws-ph-editor \.ws-edfoot\.is-dirty\{[^}]*bottom:calc\(var\(--ios-tabbar-h\) \+ var\(--safe-b\) \+ (\d+)px\)/.exec(texts);
  assert.ok(foot && offset(rule) >= Number(foot[1]) + 56 + 16, 'the Teksten save bar (56 px) is cleared too');
});

test('while typing the toast sits just above the save bar at the keyboard', () => {
  assert.match(css, /body:has\(\.shell--website \.ws-ios \.ws-ph-editor textarea:focus\) \.toasts\{bottom:calc\(var\(--safe-b\) \+ 76px\)\}/);
});
