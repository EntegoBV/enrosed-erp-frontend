import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseTemplate } from '@angular/compiler';

/*
 * Inkoop fix round 2: while /api/purchase-orders is pending, and after it
 * failed, the list does not know its containers. Then no count or sum shows:
 * no 'Inkooporders 0 | Archief 0', no chip at 0, no '0 van 0 · € 0', no
 * '0 containercalculaties'. The subtitle and caption keep their line (a
 * no-break space), so nothing jumps when the figures arrive.
 */
const source = await readFile(new URL('../src/app/features/purchasing/purchase-list.ts', import.meta.url), 'utf8');
const template = /template: `([\s\S]*?)`,\n  styles:/.exec(source)?.[1] ?? '';

test('ready means loaded without an error', () => {
  assert.match(source, /readonly ready = computed\(\(\) => !this\.loading\(\) && !this\.loadError\(\)\);/);
  assert.match(source, /const NOT_KNOWN_YET = '\\u00a0';/);
});

test('the desk subbar shows its counts and sums only when the list is known', () => {
  assert.equal(parseTemplate(template, 'purchase-list.html').errors, null);
  assert.match(template, /\{\{ chip\.label \}\} @if \(ready\(\)\) \{ <span class="wk-seg__count">\{\{ chip\.count \}\}<\/span> \}/);
  const end = /@if \(ready\(\)\) \{\s*<span class="wk-subbar__end pl-subbar__end">([\s\S]*?)<\/span>\s*\}/.exec(template);
  assert.ok(end, 'the end of the subbar sits inside @if (ready())');
  for (const figure of ['filtered().length', 'pile().length', 'shownSums().nowEur', 'shownSums().laterEur']) assert.ok(end[1].includes(figure), figure);
  assert.equal(template.split('shownSums()').length - 1, 2, 'no sum outside the guarded end');
});

test('the tabs, the desk subtitle and the phone caption wait for the list', () => {
  assert.match(source, /\{ id: 'active', label: 'Inkooporders', count: this\.ready\(\) \? this\.activeOrders\(\)\.length : null \}/);
  assert.match(source, /\{ id: 'archive', label: 'Archief', count: this\.ready\(\) \? this\.archivedOrders\(\)\.length : null \}/);
  assert.match(source, /readonly deskSubtitle = computed\(\(\) => this\.ready\(\) \? `\$\{this\.activeOrders\(\)\.length\} containercalculaties` : NOT_KNOWN_YET\);/);
  assert.match(source, /readonly phoneCaption = computed\(\(\) => \{\s*if \(!this\.ready\(\)\) return NOT_KNOWN_YET;/);
  assert.match(template, /<app-page-header title="Inkoop" \[subtitle\]="desktop\.active\(\) \? deskSubtitle\(\) : phoneCaption\(\)">/);
});
