import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const scss = (await readFile(new URL('../src/styles/bank-cockpit.scss', import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');

/** The body of the first `@container wk-pane (min-width: {px}px)` block that styles the band. */
function bandBlock(px: number): string {
  const at = scss.indexOf(`@container wk-pane (min-width: ${px}px) {\n    .fin-band {`);
  assert.ok(at >= 0, `the band's ${px} px block`);
  return scss.slice(at, scss.indexOf('\n  }', at));
}

test('two-row band (600–1149 px pane): the spark keeps a width beside a docked line (1280: pane 608)', () => {
  const block = bandBlock(600);
  const columns = /grid-template-columns: ([^;]+);/.exec(block)![1];
  assert.equal(columns, 'auto minmax(64px, 1fr) minmax(min-content, max-content) auto');
  assert.match(block, /grid-template-areas: 'id id status more' 'balance spark moves moves';/);
  assert.match(block, /\.fin-band__spark \{ display: block; \}/);
  assert.match(block, /\.fin-band__balance, \.fin-band__pills \{ min-width: min-content; \}/,
    'the figure and the widest pill set their columns\' floors, so neither runs out of its cell when the spark keeps its 64 px');
});

test('stacked band (below 600) still hides the spark, and the one-row band keeps its own tracks', () => {
  assert.match(scss, /\.fin-band__spark \{ grid-area: spark; display: none;/);
  assert.match(bandBlock(1150), /grid-template-columns: minmax\(170px, 1\.05fr\) auto minmax\(90px, 1fr\) auto minmax\(0, max-content\) auto;/);
});
