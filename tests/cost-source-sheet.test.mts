import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { signal, computed } from '@angular/core';

const source = await readFile(new URL('../src/app/features/finance/cost-sheet.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('cost-sheet.ts', source, ts.ScriptTarget.Latest, true);
const cls = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'CostSheet')!;
const names = ['source', 'sourceLoading', 'sourceError', 'sourceLocked', 'loadSource', 'patch', 'setAmount', 'setMode', 'fitAmountTo', 'canSave', 'showError', 'dueProblem'];
const members = cls.members.filter(member => member.name && names.includes(member.name.getText(parsed))); assert.equal(members.length, names.length);
const isolated = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter(m => !ts.isDecorator(m)), cls.name, undefined, undefined, members);
const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const exports: any = {}; vm.runInNewContext(js, { exports, signal, computed, messageOf: (e: any, fallback: string) => e.message || fallback });
function setup() {
  const sheet = new exports.CostSheet();
  const original = { id: 5, date: '2026-10-01', party: 'Leverancier', reference: 'CN-5', amountExclEur: -79, amountInclEur: -95.58, vatPct: null };
  const cashRound = signal(true);
  Object.assign(sheet, { draft: signal(original), mode: signal('incl'), basics: () => true, amount: () => sheet.draft().amountInclEur, regimeProblem: () => null, tried: signal(true),
    state: { cashRound } });
  return { sheet, original, cashRound };
}

test('"Vervalt op" before the cost date is refused in the sheet, with the server\'s words, before anything is saved', async () => {
  // spec-bank-forecast §3.13 (review 2026-10-16): a refused due date after the PUT left the list stale; now the sheet refuses it first.
  const { sheet, original, cashRound } = setup(); sheet.financeApi = { costOdooSource: async () => ({ snapshot: { totalEur: -95.58 } }) }; await sheet.loadSource();
  assert.equal(sheet.dueProblem(), null); assert.equal(sheet.canSave(), true);
  sheet.draft.set({ ...original, dueDate: '2026-09-30' });
  assert.equal(sheet.dueProblem(), 'De vervaldag ligt vóór de kostdatum'); assert.equal(sheet.canSave(), false);
  sheet.draft.set({ ...original, dueDate: '2026-10-01' }); assert.equal(sheet.dueProblem(), null, 'the cost date itself is fine');
  sheet.draft.set({ ...original, dueDate: '2026-09-30' }); cashRound.set(false);
  assert.equal(sheet.dueProblem(), null, 'an older server has no due date field');
});

test('source credit metadata/classification can be saved while original signed financial fields stay immutable', async () => {
  const { sheet, original } = setup(); sheet.financeApi = { costOdooSource: async () => ({ snapshot: { totalEur: -95.58 } }) };
  await sheet.loadSource(); assert.equal(sheet.sourceLocked(), true); assert.equal(sheet.canSave(), true); assert.equal(sheet.showError(), false);
  sheet.patch({ date: '2026-10-02', party: 'Ander', reference: 'new', amountExclEur: 100, amountInclEur: 121, description: 'Credit drukwerk', vatRegime: 'BE' });
  sheet.setAmount(200); sheet.setMode('excl'); sheet.fitAmountTo('BE', null);
  for (const key of ['date', 'party', 'reference', 'amountExclEur', 'amountInclEur']) assert.equal(sheet.draft()[key], original[key as keyof typeof original]);
  assert.equal(sheet.draft().description, 'Credit drukwerk'); assert.equal(sheet.draft().vatRegime, 'BE'); assert.equal(sheet.mode(), 'incl');
});

test('source lookup failure locks original fields and saving until a successful retry', async () => {
  const { sheet } = setup(); sheet.financeApi = { costOdooSource: async () => { throw new Error('Odoo-bron niet beschikbaar'); } };
  await sheet.loadSource(); assert.equal(sheet.sourceLocked(), true); assert.equal(sheet.canSave(), false); assert.match(sheet.sourceError(), /niet beschikbaar/);
  sheet.financeApi.costOdooSource = async () => ({ snapshot: { totalEur: -95.58 } }); await sheet.loadSource();
  assert.equal(sheet.sourceError(), ''); assert.equal(sheet.canSave(), true);
});


test('inspector labels do not invent zero percent VAT or a service classification for an imported document', async () => {
  const inspectorSource = await readFile(new URL('../src/app/features/finance/finance-inspector.ts', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('finance-inspector.ts', inspectorSource, ts.ScriptTarget.Latest, true);
  const cls = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'FinanceInspector')!;
  const names = ['vatLabel', 'kind'];
  const members = cls.members.filter(member => member.name && names.includes(member.name.getText(parsed))); assert.equal(members.length, 2);
  const labelConstant = parsed.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(parsed) === 'KIND_LABEL'));
  const isolated = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter(m => !ts.isDecorator(m)), cls.name, undefined, undefined, members);
  const code = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [...labelConstant, isolated])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {}; vm.runInNewContext(code, { exports, REVERSE_CHARGE: new Set(['EU_GOODS']) });
  const inspector = new exports.FinanceInspector();
  const credit = { vatPct: null, costKind: null, amountExclEur: -78.99, amountInclEur: -95.58, vatRegime: null };
  assert.equal(inspector.vatLabel(credit), 'Btw op document'); assert.equal(inspector.kind(credit), 'Nog te bepalen');
  assert.equal(inspector.vatLabel({ ...credit, vatRegime: 'BE' }), 'Btw op document');
  assert.equal(inspector.vatLabel({ ...credit, vatPct: 0 }), 'Btw (0%)');
  assert.equal(inspector.vatLabel({ ...credit, vatPct: 21, vatRegime: 'EU_GOODS' }), 'Btw verlegd (21%)');
  assert.equal(inspector.kind({ ...credit, costKind: 'SERVICES' }), 'Diensten');
  assert.equal(inspector.kind({ ...credit, costKind: 'GOODS' }), 'Goederen');
});
