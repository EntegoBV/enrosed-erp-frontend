import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../src/styles/website-homepage.scss', import.meta.url), 'utf8');

/** Class-level weight of a simple selector list item: classes, attributes and pseudo-classes, :not() counted by its argument. */
function classWeight(selector: string): number {
  const inner = selector.replace(/:not\(([^)]*)\)/g, ' $1 ');
  return (inner.match(/\.[\w-]+|\[[^\]]+\]|:(?!not\b)[\w-]+/g) ?? []).length;
}

/** Every rule whose selector list holds this exact selector and whose block sets display, in source order. */
function displayRules(target: RegExp): { selector: string; display: string; at: number }[] {
  const rules: { selector: string; display: string; at: number }[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const display = /(?:^|;)\s*display:([^;]+)/.exec(match[2])?.[1].trim();
    if (!display) continue;
    for (const raw of match[1].split(',')) {
      const selector = raw.replace(/\/\*[\s\S]*?\*\//g, '').trim();
      if (target.test(selector)) rules.push({ selector, display, at: match.index! });
    }
  }
  return rules;
}

test('below three columns "Voorbeeld" shows the preview: the show rule outweighs or follows the hide rule', () => {
  const rules = displayRules(/\.ws-hp__prev$/);
  const hide = rules.find((rule) => rule.selector.includes(':not(.ws-hp--three)') && rule.display === 'none');
  const show = rules.find((rule) => rule.selector.includes('ws-hp--preview') && rule.display !== 'none');
  assert.ok(hide, 'the two-column layout hides the preview column');
  assert.ok(show, 'the preview view shows it');
  const [hideWeight, showWeight] = [classWeight(hide.selector), classWeight(show.selector)];
  assert.ok(showWeight > hideWeight || (showWeight === hideWeight && show.at > hide.at),
    `${show.selector} (${showWeight}) must beat ${hide.selector} (${hideWeight})`);
});

test('the preview view hides the inspector', () => {
  const rules = displayRules(/\.ws-hp__insp$/);
  assert.ok(rules.some((rule) => rule.selector.includes('ws-hp--preview') && rule.display === 'none'));
});

test('the weight helper counts :not() by its argument', () => {
  assert.equal(classWeight('.ws-hp:not(.ws-hp--three) .ws-hp__prev'), 3);
  assert.equal(classWeight('.ws-hp--preview .ws-hp__prev'), 2);
});
