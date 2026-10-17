import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import * as codes from '../src/app/features/purchasing/douane-codes.ts';

/*
 * Douane (Inkoop redesign I8) run, not read: the page's own methods lifted out
 * of douane-page.ts and driven with real signals. Enter on a strip button keeps
 * that button's meaning, a dirty row blocks another, and the open row stays on
 * screen under any search.
 */
const source = await readFile(new URL('../src/app/features/purchasing/douane-page.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('douane-page.ts', source, ts.ScriptTarget.Latest, true);
const page = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'DouanePage');
assert.ok(page);
const wanted = new Set(['codes', 'products', 'loading', 'loadError', 'query', 'editing', 'blocked', 'attempted', 'saving', 'savedKey', 'leavingCode',
  'rows', 'counts', 'errors', 'changes', 'dirty', 'startEdit', 'startNew', 'focusEdit', 'patch', 'cancel', 'save', 'editKey', 'canDeactivate']);
const members = page.members.filter((member) => member.name && ts.isIdentifier(member.name) && wanted.has(member.name.text));
assert.equal(members.length, wanted.size, 'every lifted member is still on the page');
const isolated = ts.factory.updateClassDeclaration(page, page.modifiers?.filter((modifier) => !ts.isDecorator(modifier)),
  page.name, page.typeParameters, undefined, members);
const NEW = parsed.statements.find((node) => ts.isVariableStatement(node) && node.declarationList.declarations[0].name.getText(parsed) === 'NEW');
assert.ok(NEW);
const javascript = ts.transpileModule(ts.createPrinter().printList(ts.ListFormat.MultiLine,
  ts.factory.createNodeArray([NEW as ts.Statement, isolated]), parsed), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText + '\nexports.DouanePage = DouanePage;';

const settle = () => new Promise((resolve) => setImmediate(resolve));
const tariff = (code: string, description: string, dutyRatePct: number) => ({ id: Number(code.replace(/\D/g, '').slice(0, 6)), code, description, dutyRatePct });

function setup() {
  const saved: unknown[] = [];
  const toasts: string[] = [];
  const exports: Record<string, new () => any> = {};
  vm.runInNewContext(javascript, {
    exports, signal, computed, ...codes, setTimeout: () => 0, requestAnimationFrame: () => 0,
    document: { querySelector: () => null },
    messageOf: (failure: unknown, fallback: string) => (failure as { message?: string })?.message || fallback,
    confirmLeave: () => Promise.resolve(false),
  });
  const douane = new exports['DouanePage']();
  Object.assign(douane, {
    desktop: { active: () => true },
    host: { nativeElement: { querySelector: () => null } },
    catalog: { saveHsCode: async (body: unknown) => { saved.push(body); return body; } },
    ui: { toast: (text: string) => { toasts.push(text); } },
  });
  douane.codes.set([tariff('0603900000', 'Kunstbloemen', 6.5), tariff('7013 99 00', 'Glaswerk', 3), tariff('9505', 'Feestartikelen', 2.7)]);
  douane.loading.set(false);
  return { douane, saved, toasts };
}

function key(key: string, tagName: string) {
  const event = { key, target: { tagName }, defaultPrevented: false, propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; } };
  return event;
}

test('Enter on the strip\'s Annuleren keeps the button\'s own click and never saves the changed tariff', async () => {
  const { douane, saved, toasts } = setup();
  douane.startEdit(douane.codes()[0]);
  douane.patch({ dutyText: '8' });
  assert.equal(douane.dirty(), true);
  const onCancel = key('Enter', 'BUTTON');
  douane.editKey(onCancel);
  await settle();
  assert.equal(onCancel.defaultPrevented, false, 'the button\'s activation goes ahead: Annuleren cancels');
  assert.deepEqual(saved, [], 'no PUT /api/hs-codes for a rate the owner meant to throw away');
  douane.cancel();
  assert.equal(douane.editing(), null);
  assert.equal(douane.codes()[0].dutyRatePct, 6.5);
  assert.deepEqual(toasts, []);
});

test('Enter in a field saves the open row; Esc cancels it', async () => {
  const { douane, saved, toasts } = setup();
  douane.startEdit(douane.codes()[2]);
  douane.patch({ dutyText: '3,1' });
  const inField = key('Enter', 'INPUT');
  douane.editKey(inField);
  await settle();
  assert.equal(inField.defaultPrevented, true);
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), [{ id: 9505, code: '9505', description: 'Feestartikelen', dutyRatePct: 3.1 }], 'the vm builds the body in its own realm');
  assert.deepEqual(toasts, ['Tarief opgeslagen']);
  assert.equal(douane.editing(), null);
  douane.startEdit(douane.codes()[1]);
  const escape = key('Escape', 'INPUT');
  douane.editKey(escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(douane.editing(), null);
});

test('a dirty row blocks another row and Nieuw, and says so in its own strip', () => {
  const { douane } = setup();
  douane.startEdit(douane.codes()[0]);
  douane.patch({ description: 'Zijden bloemen' });
  douane.startEdit(douane.codes()[1]);
  assert.equal(douane.editing().key, '0603900000', 'the dirty row stays open');
  assert.equal(douane.blocked(), true);
  douane.startNew();
  assert.equal(douane.editing().key, '0603900000');
  douane.patch({ description: 'Kunstbloemen' });
  assert.equal(douane.dirty(), false, 'back to the stored words: nothing left to lose');
  douane.startEdit(douane.codes()[1]);
  assert.equal(douane.editing().key, '7013 99 00');
  assert.equal(douane.blocked(), false);
});

test('a search that does not match the open, changed row keeps that row (and its strip) on screen', () => {
  const { douane } = setup();
  douane.startEdit(douane.codes()[0]);
  douane.patch({ description: 'Zijden bloemen' });
  douane.query.set('glas');
  assert.deepEqual(douane.rows().map((row: { code: string }) => row.code), ['0603900000', '7013 99 00']);
  douane.startEdit(douane.codes()[1]);
  assert.equal(douane.blocked(), true, 'the blocked strip shows in the row that is still visible');
  douane.cancel();
  assert.deepEqual(douane.rows().map((row: { code: string }) => row.code), ['7013 99 00'], 'closed, the search filters it again');
});
