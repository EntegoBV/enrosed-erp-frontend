import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseTemplate } from '@angular/compiler';

// The Douane screen (Inkoop redesign I8): its own route and nav link, the settings card as a pointer, the words of the family.
const read = (path: string) => readFile(new URL(`../src/app/${path}`, import.meta.url), 'utf8');

test('the Douane screen parses, says Opslaan, saves per row and asks before deleting', async () => {
  const page = await read('features/purchasing/douane-page.ts');
  const template = /template: `([\s\S]*?)`,\n\}\)/.exec(page)?.[1] ?? '';
  assert.ok(template.length > 1000);
  assert.equal(parseTemplate(template, 'douane-page.html').errors, null);
  assert.doesNotMatch(template, /Bewaren|Tarief bewaard/, 'the settings family says Opslaan (N16)');
  assert.match(template, /Gewijzigd: \{\{ changes\(\)\.join\(', '\) \}\} · Enter slaat op, Esc annuleert/);
  assert.match(template, /Eerst opslaan of Esc/);
  assert.match(page, /this\.ui\.toast\('Tarief opgeslagen'\)/);
  assert.match(page, /messageOf\(failure, 'Opslaan mislukt'\)/);
  assert.match(page, /title: 'Tariefcode verwijderen', message: `<b>\$\{escapeHtml\(formatHs\(code\.code\)\)\}<\/b> verwijderen\? \$\{who\} terug op het invoerrecht van de inkooporder\.`/);
  assert.doesNotMatch(template + page, /van hun inkooporder|percentage van de order/, 'words that hold for one product as for several');
  // The spelling note and the row name the stored code literally; grouped, the two spellings read alike.
  assert.match(template, /\{\{ words\.verb \}\} <b class="dt-code">„\{\{ mismatch\.spelled \}\}”<\/b>; het tarief staat als <b class="dt-code">„\{\{ mismatch\.code \}\}”<\/b>\. \{\{ words\.rest \}\}/);
  assert.equal(template.split('opgeslagen als <span class="dt-code">„{{ code.code }}”</span>').length - 1, 2, 'desk row and phone cell');
  assert.match(page, /canDeactivate\(\): boolean \| Promise<boolean> \{\s*return this\.dirty\(\) \? confirmLeave\(this\.ui, \(\) => this\.save\(\)\) : true;/);
  assert.doesNotMatch(page, /location\.reload|this\.load\(\);\s*this\.ui\.toast\('Tarief/, 'a save updates its row, never the page');
});

test('the route, the nav link and the settings pointer', async () => {
  const routes = await read('app.routes.ts');
  assert.match(routes, /path: 'douane',\s*canActivate: \[authGuard\],\s*canDeactivate: \[unsavedChangesGuard\],\s*title: 'Douane',/);
  const nav = await read('core/platform/nav-items.ts');
  assert.match(nav, /\{ id: 'duties', label: 'Douane', icon: 'truck', link: '\/douane', hint: 'HS-codes en invoerrechten' \}/);
  const settings = await read('features/settings/settings-page.ts');
  assert.match(settings, /De douanetarieven hebben nu een eigen scherm onder Inkoop\./);
  assert.match(settings, /<a class="btn btn--sm" routerLink="\/douane">Naar Douane ›<\/a>/);
  assert.doesNotMatch(settings, /saveHsCode|removeHsCode|addHsCode|hsCodes\(\)/, 'the old editor is gone from Instellingen');
  // The phone's Meer opens Douane itself, not Instellingen's pointer card (with the foundation tip, Meer renders NAV_GROUPS).
  const more = await read('features/more/more-page.ts');
  assert.doesNotMatch(more, /sectie: 'duties'/);
});

test('the saved row fades back: the transition is on the row, not on the class that goes', async () => {
  const partial = await readFile(new URL('../src/styles/douane.scss', import.meta.url), 'utf8');
  assert.match(partial, /app-douane-page \.dt-row\{[^}]*transition:background var\(--dur-2,200ms\)/);
  assert.match(partial, /app-douane-page \.dt-row--saved\{background:var\(--rose-soft\)\}/);
});
