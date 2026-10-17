import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('Facturen & kosten: a month header keeps one line, its "· verlegd € x" on the label beside the Btw total (N5.1)', async () => {
  const source = await readFile(new URL('../src/app/features/finance/cost-list.ts', import.meta.url), 'utf8');
  const start = source.indexOf('<div class="wk-group" role="row">');
  const header = source.slice(start, source.indexOf('</div>', start));
  const label = /<span class="wk-group__label">([\s\S]*?)<\/span>\s*<span class="wk-td--num fin-sum fin-sum--excl"/.exec(header);
  assert.ok(label, 'the label cell');
  assert.match(label[1], /@if \(group\.reverseEur\) \{ <span class="wk-group__count" data-hide="md"[^>]*>· verlegd \{\{ group\.reverseEur \| eur \}\}<\/span> \}/,
    'the note leaves with the Btw column below md, as the total it is left out of');
  const vat = /<span class="wk-td--num fin-sum fin-sum--vat" data-hide="md"[^>]*>([\s\S]*?)<\/span>/.exec(header);
  assert.ok(vat);
  assert.equal(vat[1], '{{ group.vatEur | eur }}', 'the narrow Btw cell holds its figure alone');
  const scss = await readFile(new URL('../src/styles/finance-workspace.scss', import.meta.url), 'utf8');
  assert.doesNotMatch(scss, /fin-sum__note/, 'no stacked note left behind');
});
