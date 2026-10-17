import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseTemplate } from '@angular/compiler';

/*
 * Inkoop fix round 2: on the phone list the trailing status line ('verwacht
 * 20/11/2026', ~127 px on one line) squeezed long container names to four
 * lines at 360 and 390. The trail now shrinks with the body (both size from
 * their content), the line may break before its day and never inside it, and
 * under 375 px the title is 15 px, so a 45-character name keeps two lines.
 */
const source = await readFile(new URL('../src/app/features/purchasing/purchase-list.ts', import.meta.url), 'utf8');
const template = /template: `([\s\S]*?)`,\n  styles:/.exec(source)?.[1] ?? '';
const partial = (await readFile(new URL('../src/styles/purchase-list.scss', import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');

test('the status line is split before its day; the due amount stays one line', () => {
  assert.equal(parseTemplate(template, 'purchase-list.html').errors, null);
  assert.match(template, /@if \(trail\.due\) \{ <span class="pl-pline pl-warn">\{\{ pay!\.nowEur \| eur: 0 \}\} nu<\/span> \} @else \{\s*@let day = dayParts\(trail\.text\);\s*<span class="pl-pline pl-pline--day">\{\{ day\.lead \}\}<span class="pl-nw">\{\{ day\.day \}\}<\/span><\/span>\s*\}/);
});

test('the trail shrinks with the body; only the day line wraps; small phones get a 15 px title', () => {
  assert.ok(partial.includes('app-purchase-list .pl-prow>.ios-cell__body{flex:1 1 auto}'));
  assert.ok(partial.includes('app-purchase-list .pl-ptrail{flex:0 1 auto;gap:2px;max-width:48%}'));
  assert.ok(partial.includes('app-purchase-list .pl-pline{color:var(--muted);font-size:12.5px;font-variant-numeric:tabular-nums;line-height:1.25;white-space:nowrap}'));
  const nowrap = partial.indexOf('app-purchase-list .pl-pline{');
  const wraps = partial.indexOf('app-purchase-list .pl-pline--day{white-space:normal}');
  assert.ok(nowrap >= 0 && wraps > nowrap, 'the day rule comes after the nowrap rule of the same specificity');
  assert.ok(partial.includes('@media (max-width:374px){app-purchase-list .pl-ptitle{font-size:15px}}'));
});
