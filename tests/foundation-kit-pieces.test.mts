import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('the load error says what happened in the app\'s own words, with one way out', async () => {
  const source = await read('src/app/shared/load-error.ts');
  assert.match(source, /selector: 'app-load-error'/);
  assert.match(source, /'Dit scherm kon niet worden geladen'/);
  assert.match(source, /'Controleer de verbinding en probeer opnieuw\.'/);
  assert.match(source, /Opnieuw proberen/);
  assert.match(source, /role="alert"/);
  assert.match(source, /wk-empty__icon--danger/);
  assert.match(source, /ios-empty__icon--danger/);
  assert.doesNotMatch(source, /styles:/, 'kit component: host rules live in workspace-kit.scss');
});

test('the skeleton offers a desk table and a phone group', async () => {
  const source = await read('src/app/shared/skeleton.ts');
  assert.match(source, /'list' \| 'card' \| 'lines' \| 'stats' \| 'table' \| 'group'/);
  assert.match(source, /@case \('table'\)/);
  assert.match(source, /@case \('group'\)/);
  const styles = await read('src/styles.scss');
  for (const cls of ['.skel-table__row', '.skel-table__end', '.skel-group__cell', '.skel-group__tile']) assert.ok(styles.includes(cls), cls);
});

test('the kit pieces the areas use exist, and the motion layer is loaded after the kit', async () => {
  const kit = await read('src/styles/workspace-kit.scss');
  for (const cls of ['.wk-subbar{', '.wk-subbar__end{', '.wk-search>.wk-kbd{', '.ios-count{', '.ios-disclosure__body{', '.ios-cell__sub--2{', '.ios-tile--sm{']) {
    assert.ok(kit.includes(cls), cls);
  }
  assert.doesNotMatch(kit, /\.wk-subbar\{[^}]*(transform|filter|container)/, 'trap rule: the subbar itself takes no transform, filter or container');
  /* The open animation is Meer's (one body wrapper): Kosten & bank, the PO nacalculatie and payments and the
     files inspector keep their disclosures instant and unclipped (the kit's approved geometry). */
  const additions = kit.slice(kit.indexOf('Foundation additions'));
  const detailsRules = [...additions.matchAll(/\n\s+([^{}@\n]*::details-content[^{}\n]*)\{/g)];
  assert.equal(detailsRules.length, 2);
  for (const rule of detailsRules) {
    assert.match(rule[1], /\.ios-disclosure:has\(>\.ios-disclosure__body\)/, rule[1]);
  }
  assert.doesNotMatch(additions, /\.ios-disclosure>:not\(summary\)/);
  assert.match(additions, /\.ios-disclosure>\.ios-disclosure__body\{min-height:0;overflow:hidden\}/);
  const shell = await read('src/styles/shell.scss');
  assert.match(shell, /\.content\.content--narrow \{ max-width: 960px; \}/);
  const styles = await read('src/styles.scss');
  const kitAt = styles.indexOf("@include meta.load-css('styles/workspace-kit');");
  const motionAt = styles.indexOf("@include meta.load-css('styles/motion');");
  const shellAt = styles.indexOf("@include meta.load-css('styles/shell');");
  assert.ok(kitAt > 0 && motionAt > kitAt && shellAt > motionAt);
});

test('every enter keyframe ends on transform:none and reduced motion zeroes the tokens', async () => {
  const motion = await read('src/styles/motion.scss');
  for (const name of ['mo-push-in', 'mo-pop-in', 'mo-lift-in', 'mo-sheet-in', 'mo-row-in']) {
    assert.match(motion, new RegExp(`@keyframes ${name} \\{[^\\n]*to \\{[^}]*transform: none;`), name);
  }
  assert.match(motion, /--dur-1: 120ms;/);
  assert.match(motion, /--dur-3: 320ms;/);
  assert.match(motion, /prefers-reduced-motion: reduce\) \{\s*:root \{\s*--dur-1: 0ms; --dur-2: 0ms; --dur-3: 0ms; --dur-out: 0ms;/);
  assert.match(motion, /animation-iteration-count: 1 !important;/);
  assert.match(motion, /scroll-behavior: auto !important;/);
  const styles = await read('src/styles.scss');
  assert.doesNotMatch(styles, /\.btn:active/, 'one press rule, in motion.scss');
  assert.doesNotMatch(styles, /^\.content \{ animation/m, 'one page animation, in motion.scss');
});
