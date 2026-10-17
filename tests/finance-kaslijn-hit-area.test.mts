import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = async (file: string) => (await readFile(new URL(`../src/styles/${file}`, import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');

test('the phone Kaslijn 4 w / 8 w / 13 w options reach 44 px through ::before (N15)', async () => {
  const kit = await read('workspace-kit.scss');
  const seg = /\.ios-seg\{[^}]*\}/.exec(kit)![0];
  const padding = Number(/padding:(\d+)px/.exec(seg)![1]);
  const cockpit = await read('bank-cockpit.scss');
  const at = cockpit.indexOf('.fin-kaslijn-phone__head { align-items: center;');
  assert.ok(at >= 0, 'the phone head with the span switch');
  const head = cockpit.slice(at, cockpit.indexOf('.fin-kaslijn-phone__rows {', at));
  const height = Number(/\.ios-seg \{ width: 150px; height: (\d+)px; \}/.exec(head)![1]);
  const inset = Number(/\.ios-seg__opt::before \{ content: ''; position: absolute; inset: -(\d+)px 0; \}/.exec(head)![1]);
  const option = height - 2 * padding;
  assert.equal(option, 24, 'a 30 px segmented holds 24 px options');
  assert.ok(option + 2 * inset >= 44, `hit area ${option + 2 * inset} px`);
});
