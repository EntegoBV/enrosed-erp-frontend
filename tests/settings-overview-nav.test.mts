import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { navDirection } from '../src/app/core/platform/nav-direction.ts';
import { PHONE_TABS, phoneTabForUrl } from '../src/app/core/platform/phone-tabs.ts';

/* The phone Instellingen root (/settings, Meer lit): how each row's page arrives (2026-10-20, the tab pages round). */
const source = readFileSync(new URL('../src/app/features/settings/settings-overview.ts', import.meta.url), 'utf8');

/* The overview's link members run on their own (the class without Angular), as tab-menu.test.mts does for the shell. */
function isolate(name: string, members: string[], globals: Record<string, unknown>) {
  const parsed = ts.createSourceFile('fixture.ts', source, ts.ScriptTarget.Latest, true);
  const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name);
  assert.ok(original);
  const selected = original.members.filter((member) => member.name && ts.isIdentifier(member.name) && members.includes(member.name.text));
  assert.equal(selected.length, members.length);
  const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter((modifier) => !ts.isDecorator(modifier)), original.name, undefined, undefined, selected);
  const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {}; vm.runInNewContext(js, { exports, ...globals }); return exports[name];
}
const Overview = isolate('SettingsOverview', ['push', 'rowInfo', 'companyLink', 'dutiesLink', 'legalLink'],
  { computed: (read: () => unknown) => read, phoneTabForUrl });

/** A template binding read against the overview, as Angular would (sloppy-mode `with`: the template's scope is the component). */
const evaluate = (expression: string, scope: object): unknown =>
  new Function('scope', `with (scope) { return (${expression}); }`)(scope);

/** The phone rows: each ios-cell's address and the info it hands the router, with Douane on its own screen or still a view. */
function phoneRows(douaneRoute: boolean) {
  const overview = Object.assign(new Overview(), { douaneRoute: () => douaneRoute, legalView: () => true });
  return [...source.matchAll(/<a class="ios-cell[^"]*"([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs, body]) => {
    const title = /ios-cell__title[^>]*>([^<]+)</.exec(body)?.[1].trim() ?? '';
    const bound = (name: string) => new RegExp(`\\[${name}\\]="([^"]+)"`).exec(attrs)?.[1];
    const path = /\brouterLink="([^"]+)"/.exec(attrs)?.[1] ?? evaluate(bound('routerLink') ?? 'null', overview) as string;
    const query = bound('queryParams') ? evaluate(bound('queryParams')!, overview) as Record<string, string> | null : null;
    const url = query ? `${path}?${new URLSearchParams(query)}` : path;
    const info = bound('info') ? evaluate(bound('info')!, overview) : undefined;
    return { title, url, info };
  });
}

test('a row of Instellingen slides in while it stays under Meer, a page another tab owns fades as a tab switch', () => {
  for (const douaneRoute of [true, false]) {
    const rows = phoneRows(douaneRoute);
    assert.ok(rows.length >= 10, `${rows.length} rows`);
    for (const row of rows) {
      assert.ok(row.url.startsWith('/'), row.title);
      const expected = phoneTabForUrl(row.url) === 'more' ? 'push' : 'tab';
      assert.equal(navDirection('/settings', row.url, 'imperative', row.info, PHONE_TABS), expected, `${row.title} (${row.url})`);
    }
    const byTitle = (title: string) => rows.find((row) => row.title === title)!;
    /* Categorieën is a Producten page (its tab's long-press menu lists it) */
    assert.equal(byTitle('Categorieën').url, '/categories');
    assert.equal(navDirection('/settings', '/categories', 'imperative', byTitle('Categorieën').info, PHONE_TABS), 'tab');
    /* views of Instellingen keep their push: the path stays /settings, so the plain rule would not move at all */
    assert.equal(navDirection('/settings', byTitle('Kortingen').url, 'imperative', byTitle('Kortingen').info, PHONE_TABS), 'push');
    assert.equal(navDirection('/settings', byTitle('Logboek').url, 'imperative', byTitle('Logboek').info, PHONE_TABS), 'push');
  }
  /* Douane: Inkoop's own screen is a tab switch; the old view of Instellingen (no /douane route yet) is still a push */
  const douane = (douaneRoute: boolean) => phoneRows(douaneRoute).find((row) => row.title === 'Douane')!;
  assert.deepEqual({ url: douane(true).url, nav: navDirection('/settings', douane(true).url, 'imperative', douane(true).info, PHONE_TABS) },
    { url: '/douane', nav: 'tab' });
  assert.deepEqual({ url: douane(false).url, nav: navDirection('/settings', douane(false).url, 'imperative', douane(false).info, PHONE_TABS) },
    { url: '/settings?sectie=duties', nav: 'push' });
});
