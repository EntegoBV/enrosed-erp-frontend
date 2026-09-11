import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { signal } from '@angular/core';

// Execute the real portal proposal methods without the unrelated router/DOM constructor.
const source = await readFile(new URL('../src/app/features/portal/portal-page.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('portal-page.ts', source, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'PortalPage');
assert.ok(original);
const names = new Set(['openProposal', 'setProposal', 'addFromCatalog', 'propose', 'requestedQuantityText']);
const members = original.members.filter(member => member.name && ts.isIdentifier(member.name) && names.has(member.name.text));
assert.equal(members.length, names.size);
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)), original.name, original.typeParameters, undefined, members);
const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness() {
  const timers: (() => void)[] = [];
  const exports: { PortalPage?: new () => any } = {};
  vm.runInNewContext(javascript, { exports, Intl, setTimeout: (fn: () => void) => { timers.push(fn); return timers.length; }, clearTimeout: () => {} });
  const page = new exports.PortalPage!();
  const submissions: any[] = [];
  Object.assign(page, {
    quote: signal({ lines: [
      { productId: 1, description: 'Available rose', quantity: 24, piecesPerCarton: 24 },
      { productId: 2, description: 'Unavailable rose', quantity: 0, piecesPerCarton: 24, unavailable: true, requestedQuantity: 48 },
    ] }),
    proposalLines: signal([]), proposalSheet: signal(false), pendingRound: signal({}), roundTimers: new Map(),
    additions: signal(new Map()), catalogSheet: signal(true), catalog: signal([]),
    token: () => 'fixture', proposeBy: () => 'Customer', proposeMessage: () => '', locale: () => 'nl-BE',
    t: (key: string) => key === 'lineRequestedQuantity' ? 'Oorspronkelijk aangevraagd: %s stuks' : key,
    local: (key: string) => key,
    sales: { portalPropose: async (_token: string, _by: string, _message: string, lines: any[]) => { submissions.push(lines); return page.quote(); }, portalCatalog: async () => [] },
    language: () => 'NL', run: async (action: () => Promise<any>) => { await action(); },
  });
  return { page, submissions, timers };
}

test('proposal keeps unavailable product and original request visible but ignores quantity edits', () => {
  const { page, timers } = harness();
  page.openProposal();
  assert.equal(page.proposalSheet(), true);
  assert.equal(page.proposalLines().length, 2);
  assert.equal(page.requestedQuantityText(page.proposalLines()[1]), 'Oorspronkelijk aangevraagd: 48 stuks');
  page.setProposal(2, 96);
  assert.equal(page.proposalLines()[1].quantity, 0);
  assert.equal(timers.length, 0);
  assert.equal(Object.keys(page.pendingRound()).length, 0);
});

test('available quantities retain carton rounding, but a later unavailable state cancels pending rounding', () => {
  const { page, timers } = harness();
  page.openProposal();
  page.setProposal(1, 25);
  assert.equal(page.proposalLines()[0].quantity, 25);
  assert.equal(page.pendingRound()[1], 48);
  timers[0]();
  assert.equal(page.proposalLines()[0].quantity, 48);
  page.setProposal(1, 49);
  page.quote.update((q: any) => ({ ...q, lines: q.lines.map((l: any) => l.productId === 1 ? { ...l, unavailable: true } : l) }));
  timers[1]();
  assert.equal(page.proposalLines()[0].quantity, 49, 'a queued timer cannot reactivate a now-excluded product');
});

test('a stale catalogue result cannot add an existing unavailable product', () => {
  const { page } = harness();
  page.addFromCatalog({ item: { productId: 2, description: 'Unavailable rose' }, quantity: 96 });
  assert.equal(page.additions().size, 0);
  page.addFromCatalog({ item: { productId: 3, description: 'New product' }, quantity: 24 });
  assert.equal(page.additions().get(3).quantity, 24);
});

test('submission omits unavailable products even if stale local rows/additions contain positive quantities', async () => {
  const { page, submissions } = harness();
  page.openProposal();
  page.proposalLines.update((lines: any[]) => lines.map(line => line.productId === 2 ? { ...line, unavailable: false, quantity: 96 } : line));
  page.additions.set(new Map([[2, { description: 'Stale selection', quantity: 48 }], [3, { description: 'New product', quantity: 24 }]]));
  await page.propose();
  assert.equal(submissions.length, 1);
  assert.deepEqual(Array.from(submissions[0], (line: any) => [line.productId, line.quantity]), [[1, 24], [3, 24]]);
});

test('agreement quotation cannot open or submit quantity changes', async () => {
  const { page, submissions } = harness();
  page.quote.update((q: any) => ({ ...q, advanceAgreement: {} }));
  page.openProposal();
  assert.equal(page.proposalSheet(), false);
  await page.propose();
  assert.equal(submissions.length, 0);
});
