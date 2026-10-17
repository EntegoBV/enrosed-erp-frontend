import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const css = (await readFile(new URL('../src/styles/website-homepage.scss', import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');

function rule(selector: string): { body: string; at: number } {
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].split(',').map((part) => part.trim()).includes(selector)) return { body: match[2], at: match.index! };
  }
  throw new Error(`no rule for ${selector}`);
}

const declarations = (body: string) => Object.fromEntries(body.split(';').filter(Boolean).map((line) => {
  const [name, ...value] = line.split(':');
  return [name.trim(), value.join(':').trim()];
}));

test('the phone preview sheet frame fills the sheet between the insets instead of the 390 px desk frame', () => {
  const phoneFrame = rule('.ws-stage--mobile .ws-site');
  const sheet = rule('.ws-prev-sheet .ws-site');
  assert.ok(sheet.at > phoneFrame.at, 'same weight, so the sheet rule must come later');
  const values = declarations(sheet.body);
  assert.equal(values.width, 'auto');
  assert.equal(values['max-width'], 'none');
  assert.equal(values.margin, '0 var(--ios-inset)');
});

test('the sheet frame is as tall as its iframe (no white block under the site)', () => {
  assert.equal(declarations(rule('.ws-prev-sheet .ws-site').body).height, 'auto');
  assert.match(declarations(rule('.ws-prev-sheet .ws-site iframe').body).height, /100dvh/);
});
