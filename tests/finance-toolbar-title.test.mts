import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = async (path: string) => {
  const text = await readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');
  return path.endsWith('.scss') ? text.replace(/\/\*[\s\S]*?\*\//g, '') : text;
};

test('Transacties and Inkoop & kosten keep their title below the compact bar, down to 760 (§3.12)', async () => {
  const toolbar = await read('app/features/finance/finance-toolbar.ts');
  const compact = Number(/readonly compact = computed\(\(\) => this\.width\(\) > 0 && this\.width\(\) < (\d+)\);/.exec(toolbar)![1]);
  const tight = Number(/readonly tight = computed\(\(\) => this\.width\(\) > 0 && this\.width\(\) < (\d+)\);/.exec(toolbar)![1]);
  assert.deepEqual([compact, tight], [980, 760]);
  const kit = await read('styles/workspace-kit.scss');
  const padding = Number(/\.wk-toolbar\{[^}]*padding:0 (\d+)px/.exec(kit)![1]);
  // the toolbar measures its border box; container queries see the content box
  const compactContent = compact - 2 * padding;
  for (const [file, cls] of [['styles/bank-cockpit.scss', 'fin-toolbar--tx'], ['styles/finance-workspace.scss', 'fin-toolbar--costs']]) {
    const scss = await read(file);
    const rule = new RegExp(`@container wk-bar \\(([^{]+)\\) \\{\\s*\\.${cls} \\.fin-toolbar__title \\{ position: absolute;`).exec(scss);
    assert.ok(rule, `${cls}: the rule that steps the title aside`);
    const min = /min-width: (\d+)px/.exec(rule[1]);
    assert.ok(min, `${cls}: the title only steps aside while the full labels need the room`);
    assert.equal(Number(min[1]), compactContent, `${cls}: it comes back exactly where the short labels start`);
  }
});
