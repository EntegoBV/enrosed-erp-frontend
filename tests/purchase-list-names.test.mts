import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { signal } from '@angular/core';
import { containerName, containerNumberHint } from '../src/app/features/purchasing/container-name.ts';

/* The list's archive toast and delete confirm name the row as the row does: containerName(), the PO number as small print. */
const source = await readFile(new URL('../src/app/features/purchasing/purchase-list.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('purchase-list.ts', source, ts.ScriptTarget.Latest, true);
const list = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'PurchaseList');
assert.ok(list);
const wanted = new Set(['toggleArchive', 'remove']);
const members = list.members.filter((member) => member.name && ts.isIdentifier(member.name) && wanted.has(member.name.text));
assert.equal(members.length, wanted.size);
const javascript = ts.transpileModule(ts.createPrinter().printNode(ts.EmitHint.Unspecified,
  ts.factory.updateClassDeclaration(list, list.modifiers?.filter((modifier) => !ts.isDecorator(modifier)), list.name, undefined, undefined, members), parsed), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText + '\nexports.PurchaseList = PurchaseList;';

const row = (id: number, number: string, alias: string | null) => ({ order: { id, number, alias, status: 'BESTELD', archivedAt: null } });

function setup() {
  const toasts: string[] = [];
  const asked: { message: string }[] = [];
  const exports: Record<string, new () => any> = {};
  vm.runInNewContext(javascript, {
    exports, containerName, containerNumberHint, TEMPORARY_DELETION_NOTICE: 'Je vindt het terug onder Verwijderd.',
    escapeHtml: (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    messageOf: (_failure: unknown, fallback: string) => fallback,
  });
  const page = new exports['PurchaseList']();
  Object.assign(page, {
    archivingOrderId: signal(null), deletingOrderId: signal(null), rowMenu: signal(null), openRow: signal(null), leavingId: signal(null),
    orders: signal([row(46, 'PO-2026-046', 'Moederdag 2027'), row(47, 'PO-2026-047', null)]),
    sourcing: { archivePurchaseOrder: async (id: number) => ({ order: { id, archivedAt: '2026-10-17' } }) },
    ui: { toast: (text: string) => toasts.push(text), confirmRequest: () => null, confirm: (options: { message: string }) => asked.push(options) },
  });
  return { page, toasts, asked };
}

test('archiving a named container toasts its name, a container without a name its number', async () => {
  const { page, toasts } = setup();
  await page.toggleArchive(page.orders()[0]);
  await page.toggleArchive(page.orders()[1]);
  assert.deepEqual(toasts, ['Moederdag 2027 gearchiveerd', 'PO-2026-047 gearchiveerd']);
});

test('the delete confirm names the container, with the PO number as small print only when it adds something', () => {
  const { page, asked } = setup();
  page.remove(46, 'PO-2026-046');
  page.remove(47, 'PO-2026-047');
  assert.match(asked[0].message, /^Inkooporder <b>Moederdag 2027<\/b> \(PO-2026-046\) tijdelijk verwijderen\?<br><br>/);
  assert.match(asked[1].message, /^Inkooporder <b>PO-2026-047<\/b> tijdelijk verwijderen\?<br><br>/);
});
