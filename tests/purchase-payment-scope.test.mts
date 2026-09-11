import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';

// Run the component's real selection behavior; there is deliberately no API.
const source = await readFile(new URL('../src/app/features/purchasing/purchase-payment-scope.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('scope.ts', source, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'PurchasePaymentScope')!;
const names = new Set(['scope', 'knownDue', 'dueLabel', 'chooseDue', 'chooseScope']);
const members = original.members.filter(member => member.name && ts.isIdentifier(member.name) && names.has(member.name.text));
assert.equal(members.length, names.size);
const isolated = ts.factory.updateClassDeclaration(original, undefined, original.name, undefined, undefined, members);
const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText + '\nexports.Component = PurchasePaymentScope;';

function setup(values: { instalmentDue?: string | null; settles?: boolean; payee?: string } = {}) {
  const exports: any = {};
  vm.runInNewContext(js, { exports, computed });
  const ui = new exports.Component();
  const changes: any[] = [];
  Object.assign(ui, {
    payee: signal(values.payee ?? 'SUPPLIER'), instalmentDue: signal(values.instalmentDue ?? null),
    settles: signal(values.settles ?? false), busy: signal(false),
    options: signal([{ due: 'ORDERED', label: '30% bij bestelling' }, { due: 'SHIPPED', label: '30% bij vertrek' }, { due: 'ARRIVED', label: '40% bij aankomst' }]),
    changed: { emit: (value: any) => changes.push(JSON.parse(JSON.stringify(value))) },
  });
  return { ui, changes, accept: () => { const value = changes.at(-1); ui.instalmentDue.set(value.instalmentDue); ui.settles.set(value.settles); } };
}

test('a new automatic supplier payment has no settlement and requires a selected term before term closure', () => {
  const { ui, changes } = setup();
  assert.equal(ui.scope(), 'NONE');
  assert.equal(ui.knownDue(), false);
  ui.chooseScope('INSTALMENT');
  assert.deepEqual(changes, []);
});

test('choosing the 30 percent term permits closing only that term, without financial edits', () => {
  const { ui, changes, accept } = setup();
  ui.chooseDue('ORDERED'); accept();
  assert.equal(ui.dueLabel(), '30% bij bestelling');
  assert.equal(ui.knownDue(), true);
  ui.chooseScope('INSTALMENT'); accept();
  assert.equal(ui.scope(), 'INSTALMENT');
  assert.deepEqual(changes.at(-1), { instalmentDue: 'ORDERED', settles: true });
  const payment = { amount: 17_000, currency: 'EUR', paidOn: '2026-09-11', label: 'Aanbetaling', instalmentDue: null, settles: false };
  assert.deepEqual({ ...payment, ...changes.at(-1) }, { ...payment, instalmentDue: 'ORDERED', settles: true });
});

test('changing the assignment requires a new explicit settlement choice', () => {
  const { ui, changes, accept } = setup({ instalmentDue: 'ORDERED', settles: true });
  ui.chooseDue('SHIPPED'); accept();
  assert.deepEqual(changes.at(-1), { instalmentDue: 'SHIPPED', settles: false });
  assert.equal(ui.scope(), 'NONE');
  ui.chooseDue(''); accept();
  assert.deepEqual(changes.at(-1), { instalmentDue: null, settles: false });
});

test('the whole supplier action clears term allocation and explicitly settles the complete group', () => {
  const { ui, changes, accept } = setup({ instalmentDue: 'ORDERED' });
  ui.chooseScope('GROUP'); accept();
  assert.deepEqual(changes.at(-1), { instalmentDue: null, settles: true });
  assert.equal(ui.scope(), 'GROUP');
});

test('editing old whole-group and term settlements preserves their scope until user changes it', () => {
  const legacy = setup({ settles: true });
  assert.equal(legacy.ui.scope(), 'GROUP');
  assert.deepEqual(legacy.changes, []);
  const term = setup({ settles: true, instalmentDue: 'ARRIVED' });
  assert.equal(term.ui.scope(), 'INSTALMENT');
  assert.deepEqual(term.changes, []);
  term.ui.chooseScope('NONE');
  assert.deepEqual(term.changes.at(-1), { instalmentDue: 'ARRIVED', settles: false }, 'Reopening does not remove the explicit payment allocation');
});

test('other cost groups cannot receive a supplier term, while their existing group settlement remains available', () => {
  for (const payee of ['LOGISTICS', 'SEPARATE']) {
    const { ui, changes } = setup({ payee });
    ui.chooseDue('ORDERED'); ui.chooseScope('INSTALMENT');
    assert.deepEqual(changes, []);
    ui.chooseScope('GROUP');
    assert.deepEqual(changes, [{ instalmentDue: null, settles: true }]);
  }
  const other = setup({ payee: 'OTHER' });
  other.ui.chooseScope('GROUP');
  assert.deepEqual(other.changes, []);
});

test('a removed historical term stays identifiable but cannot silently become a new closure', () => {
  const { ui, changes } = setup({ instalmentDue: 'SHIPPED', settles: true });
  ui.options.set([{ due: 'ORDERED', label: '100% bij bestelling' }]);
  assert.equal(ui.knownDue(), false);
  assert.equal(ui.dueLabel(), 'Bij vertrek');
  ui.chooseScope('INSTALMENT'); ui.chooseDue('INVALID');
  assert.deepEqual(changes, []);
});

test('pending payment or refresh disables both allocation and settlement mutations', () => {
  const { ui, changes } = setup({ instalmentDue: 'ORDERED' });
  ui.busy.set(true);
  ui.chooseDue('SHIPPED'); ui.chooseScope('INSTALMENT'); ui.chooseScope('GROUP'); ui.chooseScope('NONE');
  assert.deepEqual(changes, []);
});

test('mounting or replacing options preserves the assigned term without emitting a payment edit', () => {
  const { ui, changes } = setup({ instalmentDue: 'ORDERED', settles: true });
  ui.options.set([]);
  assert.equal(ui.dueLabel(), 'Bij bestelling');
  assert.equal(ui.scope(), 'INSTALMENT');
  ui.options.set([{ due: 'ORDERED', label: '30% bij bestelling' }, { due: 'SHIPPED', label: '70% bij vertrek' }]);
  assert.equal(ui.knownDue(), true);
  assert.equal(ui.dueLabel(), '30% bij bestelling');
  ui.chooseDue('ORDERED');
  assert.deepEqual(changes, [], 'Synchronizing the form model after options mount must not reopen a settled term');
  ui.chooseDue('SHIPPED');
  assert.deepEqual(changes, [{ instalmentDue: 'SHIPPED', settles: false }]);
});
