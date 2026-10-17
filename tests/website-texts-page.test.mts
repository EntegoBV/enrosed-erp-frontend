import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { textsBackTarget } from '../src/app/features/website-builder/website-texts-nav.ts';

const read = (path: string) => readFile(new URL(`../src/app/features/${path}`, import.meta.url), 'utf8');
const page = await read('website-builder/content-translations-page.ts');
const workspace = await read('settings/content-translation-workspace.ts');
const audit = await read('website-builder/website-product-seo-audit.ts');

const base = { seoMode: false, returnPath: '', pushedFrom: null, editorArea: 'header' } as const;

test('an editor opened by a link (Te doen) goes back to its site part, as its back control says', () => {
  assert.deepEqual(textsBackTarget({ ...base, view: 'editor' }), { kind: 'query', query: { key: null, gebied: 'header' } });
  assert.deepEqual(textsBackTarget({ ...base, view: 'editor', pushedFrom: 'area' }), { kind: 'query', query: { key: null, gebied: 'header' } });
});

test('an editor pushed from the Teksten list (search, language banner) goes back to that list', () => {
  assert.deepEqual(textsBackTarget({ ...base, view: 'editor', pushedFrom: 'parts' }), { kind: 'query', query: { key: null, gebied: null } });
});

test('an editor opened from a homepage block goes back to that block', () => {
  assert.deepEqual(textsBackTarget({ ...base, view: 'editor', returnPath: '/website/layout?blok=hero' }), { kind: 'url', url: '/website/layout?blok=hero' });
});

test('SEO: a page text goes back to Algemene pagina’s, and that list to Overzicht (its label)', () => {
  assert.deepEqual(textsBackTarget({ ...base, seoMode: true, view: 'editor', editorArea: 'meta' }), { kind: 'query', query: { key: null, gebied: null } });
  assert.deepEqual(textsBackTarget({ ...base, seoMode: true, view: 'area' }), { kind: 'url', url: '/website' });
  assert.match(page, /\(back\)="leaveSeo\(\)"/, 'the SEO root goes back through history when Overzicht is below');
});

test('an area goes back to the Teksten list', () => {
  assert.deepEqual(textsBackTarget({ ...base, view: 'area' }), { kind: 'query', query: { gebied: null } });
});

test('back goes through history when its target is the entry below, so no duplicate entry is built', () => {
  assert.match(page, /if \(this\.nav\.below\(\) === url\) this\.location\.back\(\);/);
  assert.doesNotMatch(page, /navigateByUrl\(this\.returnPath, \{ replaceUrl: true \}\)/);
});

test('a text save, create or delete loads the website status again', () => {
  assert.match(page, /saved\(\): void \{\s*void this\.sync\.load\(\);/);
  assert.equal((page.match(/\(contentSaved\)="saved\(\)"/g) ?? []).length, 2, 'desk and phone workspace');
});

test('switching the SEO page type holds an unsaved text', () => {
  const body = page.slice(page.indexOf('  setSeoTab('), page.indexOf('\n  }\n', page.indexOf('  setSeoTab(')));
  assert.match(body, /if \(this\.dirty\(\)\) \{\s*this\.ui\.toast\('Sla de tekst eerst op of herstel de wijziging\.', 'err'\);\s*return;/);
  assert.ok(body.indexOf('this.dirty()') < body.indexOf('this.router.navigate'));
});

test('a failed load shows the error with a retry, never an endless skeleton', () => {
  assert.match(page, /store\.errors\(\)\.content && !store\.content\(\)[\s\S]{0,40}<app-load-error title="Teksten konden niet worden geladen"/);
  assert.match(audit, /store\.errors\(\)\.families && !store\.families\(\)[\s\S]{0,40}<app-load-error title="Publieke producten konden niet worden geladen"/);
});

test('split and inline wait for the store’s request instead of fetching the 654 groups beside it', () => {
  const load = workspace.slice(workspace.indexOf('  async load(): Promise<void> {'), workspace.indexOf('  select(group'));
  assert.match(load, /await this\.store\.ensure\(\['content'\]\);\s*fromStore = this\.store\.content\(\);/);
  assert.doesNotMatch(load, /isFresh\('content'\)/);
});

test('phone SEO keeps its filter with counts, its search and the webadres per reeks', () => {
  assert.match(page, /seoFilterOptions\(\); track option\.id\) \{\s*<button class="ios-chip"/);
  assert.match(page, /<app-website-product-seo-audit layout="phone" \[filter\]="seoFilter\(\)" \[query\]="query\(\)" \/>/);
  assert.doesNotMatch(page, /filter="alles"/);
  assert.match(page, /placeholder="Zoek reeks of SEO-titel" aria-label="Zoek reeks of SEO-titel"/);
  assert.match(audit, /'\/products\/' \+ row\.family\.publicHandle : 'Nog geen webadres'/);
});

test('the phone language chip opens the editor on the missing language', () => {
  assert.match(page, /layout="inline"[\s\S]{0,300}\[missingLanguage\]="language\(\)"/);
});

test('each phone view animates, and the dirty save bar is never inside an animated wrapper', () => {
  assert.match(page, /@case \('parts'\) \{ <div class="ws-ph-view" \[class\]="'ws-ph-view ' \+ viewMotion\(\)">/);
  assert.match(page, /@case \('area'\) \{ <div class="ws-ph-view" \[class\]="'ws-ph-view ' \+ viewMotion\(\)">/);
  const view = page.slice(page.indexOf('<ng-template #phoneList'), page.indexOf('<ng-template #groupValue'));
  assert.doesNotMatch(view, /app-content-translation-workspace/, 'the editor lives outside the view wrapper');
  assert.match(page, /'ws-ph-editor ' \+ \(view\(\) !== 'editor' \? 'ws-ct-parked' : dirty\(\) \? '' : viewMotion\(\)\)/);
});

test('the desk Geavanceerd toggle follows the panel', () => {
  assert.match(page, /\(advancedChange\)="advanced\.set\(\$event\)"/);
  assert.match(workspace, /effect\(\(\) => this\.advancedChange\.emit\(this\.advancedOpen\(\)\)\);/);
});

test('the desk list keeps the keys: only an address key from a link focuses the text field', () => {
  assert.match(workspace, /if \(selected && this\.layout\(\) !== 'card' && selected\.key !== initialKey\) this\.focusedInitialKey = selected\.key;/);
  const pick = workspace.slice(workspace.indexOf('  pick(group'), workspace.indexOf('\n  }\n', workspace.indexOf('  pick(group')));
  assert.match(pick, /if \(this\.layout\(\) !== 'card'\) this\.focusedInitialKey = group\.key;/);
});

test('list rows carry the full label in their title, and the area count says ontbreekt for one', () => {
  assert.match(workspace, /\[attr\.title\]="row\.label \+ ' · ' \+ row\.group\.key"/);
  assert.match(workspace, /plural\(section\.missing, 'ontbreekt', 'ontbreken'\)/);
});
