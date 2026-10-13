import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { signal, computed } from '@angular/core';
import { FINANCE_TABS, financeSection } from '../src/app/features/finance/finance-sections.ts';
import { parseFinanceLocation, patchLocation } from '../src/app/features/finance/finance-url.ts';
import { cashTotalOf, openOf, paidOf } from '../src/app/features/finance/finance-metrics.ts';

async function selectedClass(file: string, name: string, members: string[]) {
  const source = await readFile(new URL(`../src/app/features/finance/${file}`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const cls = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name)!;
  const kept = cls.members.filter(member => member.name && members.includes(member.name.getText(parsed)));
  assert.equal(kept.length, members.length);
  const isolated = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter(m => !ts.isDecorator(m)), cls.name, undefined, undefined, kept);
  const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {};
  vm.runInNewContext(js, { exports, signal, computed, FINANCE_TABS, financeSection, cashTotalOf, openOf, paidOf });
  return exports[name];
}
const State = await selectedClass('finance-state.ts', 'FinanceState', ['inspect', 'inspectParents', 'inspectOrigin', 'inspectorBackLabel', 'inspectorOriginLabel', 'inspectItem', 'inspectRelated', 'backInspector', 'selectInspector', 'closeInspector', 'clearInspector']);
const Page = await selectedClass('costs-page.ts', 'CostsPage', ['bankDetail', 'pageTitle', 'phoneSubtitle', 'phoneInspector', 'subScreen', 'backFromSection', 'phoneSegments']);
const Row = await selectedClass('cost-row.ts', 'CostRow', ['incl', 'open', 'credit', 'overpaid', 'status']);

function setup(params: Record<string, string> = { view: 'bank', tab: 'movements', account: 'BE94731074082814', dir: 'out', link: 'unlinked', q: 'Container', from: '2026-09-01', to: '2026-09-30' }) {
  const state = new State();
  state.location = signal(parseFinanceLocation(key => params[key] ?? null));
  state.go = (patch: any) => { state.location.set(patchLocation(state.location(), patch)); };
  state.inspectTitle = (target: any) => `${target.kind} ${target.id}`;
  Object.assign(state, { desk: signal(false), costDraft: signal(null), paySheet: signal(null), recurringDraft: signal(null), menu: signal(null),
    accountLabel: () => 'KBC-zichtrekening', segmentWarn: () => false, leaveAnalysis: () => { state.leftAnalysis = true; } });
  const page = new Page(); page.state = state; page.current = computed(() => financeSection(state.location().view));
  return { state, page };
}

test('opening a linked cost from bank and returning keeps the exact account, query, direction and period', () => {
  const { state, page } = setup(); const before = { ...state.location() };
  state.inspectItem({ kind: 'cost', id: 26 });
  assert.equal(state.inspectorBackLabel(), 'Terug naar transacties');
  assert.equal(page.pageTitle(), 'KBC-zichtrekening');
  assert.equal(page.phoneInspector().id, 26);
  state.backInspector();
  assert.equal(state.inspect(), null);
  assert.deepEqual(state.location(), before);
});

test('related detail has a back trail and returns to the original bank list after the last back', () => {
  const { state } = setup(); const before = { ...state.location() };
  state.inspectItem({ kind: 'cost', id: 26 });
  state.inspectRelated({ kind: 'recurring', id: 7 });
  state.inspectRelated({ kind: 'cost', id: 27 });
  assert.equal(state.inspectorBackLabel(), 'Terug naar recurring 7');
  state.backInspector(); assert.equal(state.inspect().id, 7);
  assert.equal(state.inspectorBackLabel(), 'Terug naar cost 26');
  state.backInspector(); assert.equal(state.inspect().id, 26);
  assert.equal(state.inspectorBackLabel(), 'Terug naar transacties');
  state.backInspector(); assert.equal(state.inspect(), null);
  assert.deepEqual(state.location(), before);
});

test('closing deep-linked cost details removes only cost identity and preserves local list filters', () => {
  const { state } = setup({ view: 'costs', tab: 'company', cost: '26', cat: 'DRUKWERK', status: 'paid', period: 'all', q: 'Hello' });
  state.inspect.set({ kind: 'cost', id: 26 });
  assert.equal(state.inspectorBackLabel(), 'Terug naar facturen & kosten');
  state.closeInspector();
  assert.equal(state.location().cost, null); assert.equal(state.location().q, 'Hello');
  assert.equal(state.location().cat, 'DRUKWERK'); assert.equal(state.location().status, 'paid'); assert.equal(state.location().period, 'all');
});

test('editing or paying hides the mobile detail dialog without discarding its origin; closing the form restores it', () => {
  const { state, page } = setup(); state.inspectItem({ kind: 'cost', id: 26 });
  for (const field of ['costDraft', 'paySheet', 'recurringDraft', 'menu']) {
    state[field].set({ id: 26 }); assert.equal(page.phoneInspector(), null);
    assert.equal(state.inspect().id, 26); assert.equal(state.inspectorBackLabel(), 'Terug naar transacties');
    state[field].set(null); assert.equal(page.phoneInspector().id, 26);
  }
});

test('mobile section chooser uses full names; account back remains explicit and preserves bank overview', () => {
  const { state, page } = setup({ view: 'costs', tab: 'company' });
  assert.deepEqual(Array.from(page.phoneSegments(), (row: any) => row.label), ['Facturen & kosten', 'Containers', 'Vaste kosten', 'Aan wie & beurzen']);
  state.go({ view: 'bank', tab: 'movements', account: 'BE94731074082814' });
  assert.equal(page.phoneSegments().length, 0); assert.equal(page.subScreen(), true);
  page.backFromSection(); assert.equal(state.location().view, 'bank'); assert.equal(state.location().tab, 'accounts'); assert.equal(state.location().account, '');
});

test('supplier credit stays open until refunded, and partial/over-refund status follows signed money', () => {
  const row = new Row(); const cost = signal<any>({ amountExclEur: -78.99, amountInclEur: -95.58, vatPct: null, openEur: -95.58, paidEur: 0 }); row.cost = cost;
  assert.equal(row.credit(), true); assert.equal(row.status(), 'open'); assert.equal(row.overpaid(), 0);
  cost.update(c => ({ ...c, openEur: -45.58, paidEur: -50 })); assert.equal(row.status(), 'partial'); assert.equal(row.overpaid(), 0);
  cost.update(c => ({ ...c, openEur: 0, paidEur: -95.58 })); assert.equal(row.status(), 'paid'); assert.equal(row.overpaid(), 0);
  cost.update(c => ({ ...c, paidEur: -100 })); assert.equal(row.overpaid(), 4.42);
  cost.set({ amountExclEur: 100, amountInclEur: 121, vatPct: 21, openEur: 21, paidEur: 100 });
  assert.equal(row.credit(), false); assert.equal(row.status(), 'partial'); assert.equal(row.overpaid(), 0);
});
