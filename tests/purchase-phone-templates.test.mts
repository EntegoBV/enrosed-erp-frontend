import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseTemplate } from '@angular/compiler';

/*
 * The phone purchase order's templates (2026-10-15): they parse, every place
 * a figure or a deep link needs is there exactly once, and the new styles
 * stay inside their hosts.
 */
const read = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), 'utf8');
const templateOf = (source: string): string => {
  const template = /template:\s*`([\s\S]*?)`,\s*styles:/.exec(source)?.[1];
  assert.ok(template, 'a template followed by styles');
  return template;
};
const count = (text: string, pattern: string): number => text.split(pattern).length - 1;

test('the step confirmation and the Nacalculatie glance parse and only take inputs', async () => {
  for (const file of ['purchase-step-confirm-sheet.ts', 'purchase-nacalc-glance.ts']) {
    const source = await read(`app/features/purchasing/${file}`);
    const template = templateOf(source);
    assert.equal(parseTemplate(template, file).errors, null, file);
    assert.doesNotMatch(source, /inject\(/, `${file} has inputs and outputs only`);
  }
  const sheet = templateOf(await read('app/features/purchasing/purchase-step-confirm-sheet.ts'));
  assert.match(sheet, /<app-sheet \[title\]="text\(\)\.title" variant="ios" \(closed\)="cancel\.emit\(\)">/);
  assert.match(sheet, /Je openstaande wijzigingen worden mee opgeslagen\./);
  assert.match(sheet, /id="mpo-step-tracking"/);
  const glance = templateOf(await read('app/features/purchasing/purchase-nacalc-glance.ts'));
  for (const words of ['Afspraak', 'Verschil met afspraak', 'Volledige nacalculatie', 'Nacalculatie laden…', 'De nacalculatie is nog niet beschikbaar.']) {
    assert.ok(glance.includes(words), words);
  }
  assert.doesNotMatch(glance, /begroot/i);
});

test('the kit gains the stacked segments and the nav its [hero] slot', async () => {
  assert.match(await read('styles/workspace-kit.scss'), /\.ios-seg\.ios-seg--stacked\{/);
  const nav = await read('app/shared/ios-nav.ts');
  assert.match(nav, /customLarge/);
  assert.match(nav, /<ng-content select="\[hero\]" \/>/);
  const navTemplate = /template:\s*`([\s\S]*?)`,/.exec(nav)?.[1];
  assert.ok(navTemplate);
  assert.equal(parseTemplate(navTemplate, 'ios-nav.html').errors, null);
});

test('the phone styles load once and every rule stays scoped to the purchase hosts', async () => {
  const styles = await read('styles.scss');
  assert.equal(count(styles, "@include meta.load-css('styles/purchase-phone');"), 1);
  assert.match(styles, /@include meta\.load-css\('styles\/purchase-nacalc'\);\n@include meta\.load-css\('styles\/purchase-phone'\);/);
  const scss = (await read('styles/purchase-phone.scss')).replace(/\/\*[\s\S]*?\*\//g, '');
  const scope = /^(@media|\s*(app-purchase-view|app-purchase-editor|:is\(app-purchase-view, ?app-purchase-editor\)|\.mpo-|body:has\(app-purchase-))/;
  const selectors: string[] = [];
  let depth = 0;
  let buffer = '';
  for (const char of scss) {
    if (char === '{') {
      const text = buffer.trim();
      if (text) selectors.push(text);
      buffer = '';
      depth++;
    } else if (char === '}') { buffer = ''; depth--; } else if (char === ';') { buffer = ''; } else { buffer += char; }
  }
  assert.equal(depth, 0);
  assert.ok(selectors.length > 40, String(selectors.length));
  const outside = selectors.flatMap((selector) => splitTopLevel(selector)).filter((selector) => !scope.test(selector));
  assert.deepEqual(outside, []);
});

/** The selectors of a list, split on the commas outside parentheses. */
function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let level = 0;
  let current = '';
  for (const char of list) {
    if (char === '(') level++;
    if (char === ')') level--;
    if (char === ',' && level === 0) { parts.push(current.trim()); current = ''; continue; }
    current += char;
  }
  parts.push(current.trim());
  return parts.filter(Boolean);
}
