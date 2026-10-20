import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

/*
 * TICA verkopen's template (2026-10-20 review): the stateful children are mounted once, outside the desk/phone
 * switch, so crossing 680 px (a rotation, Split View, a narrowed window) never drops an open settlement sheet, its
 * draft, a PDF being read or a dirty TICA-voorraad sheet; one tabpanel carries the tabs' aria-controls id.
 */
const html = await readFile(new URL('../src/app/features/tica/tica-page.html', import.meta.url), 'utf8');

/** Control-flow depth at a place in the template: interpolations removed, a binding's object literal is balanced. */
function depthAt(index: number): number {
  const before = html.slice(0, index).replace(/\{\{[\s\S]*?\}\}/g, '');
  return (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length;
}
const once = (tag: string): number => {
  const first = html.indexOf(tag);
  assert.ok(first >= 0, `${tag} is in the template`);
  assert.equal(html.indexOf(tag, first + 1), -1, `${tag} is mounted once`);
  return first;
};

test('settlements, the stock link and the sale history are mounted once, in no @if', () => {
  for (const tag of ['<app-tica-settlements', '<app-tica-stock-settings', '<app-tica-sale-history']) assert.equal(depthAt(once(tag)), 0, `${tag} sits in no @if`);
  assert.match(html, /<app-tica-settlements \[desk\]="desktop\.active\(\)"/);
});

test('one tabpanel holds both tabs and carries the id the tabs point at', () => {
  assert.equal(html.match(/id="tica-results"/g)?.length, 1);
  assert.match(html, /<div class="tl-panel" id="tica-results" role="tabpanel"/);
  assert.equal(depthAt(html.indexOf('id="tica-results"')), 0, 'the panel is there in every state, also loading or on Afrekeningen');
  assert.equal(html.match(/controls="tica-results"/g)?.length, 2, 'desk and phone tabs');
});

test('the desk Periode popover is a kit overlay that hands Escape and outside clicks to the page', () => {
  assert.match(html, /<form class="wk-popover tl-period"[^>]*data-kit-overlay/);
  assert.doesNotMatch(html, /tl-period"[^>]*\(keydown\.escape\)/, 'Escape is the document listener, which also returns the focus');
});
