import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { signal, computed } from '@angular/core';
import { FINANCE_TABS, financeNavOf, financeSection } from '../src/app/features/finance/finance-sections.ts';
import { parseFinanceLocation, patchLocation } from '../src/app/features/finance/finance-url.ts';
import { cashTotalOf, openOf, paidOf } from '../src/app/features/finance/finance-metrics.ts';
import { syncMoment } from '../src/app/features/finance/finance-format.ts';

async function selectedClass(file: string, name: string, members: string[]) {
  const source = await readFile(new URL(`../src/app/features/finance/${file}`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const cls = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name)!;
  const kept = cls.members.filter(member => member.name && members.includes(member.name.getText(parsed)));
  assert.equal(kept.length, members.length);
  const isolated = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter(m => !ts.isDecorator(m)), cls.name, undefined, undefined, kept);
  const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {};
  vm.runInNewContext(js, { exports, signal, computed, FINANCE_TABS, financeSection, financeNavOf, cashTotalOf, openOf, paidOf, syncMoment });
  return exports[name];
}
const State = await selectedClass('finance-state.ts', 'FinanceState', ['inspect', 'inspectParents', 'inspectOrigin', 'inspectorBackLabel', 'inspectorOriginLabel', 'inspectItem', 'inspectRelated', 'backInspector', 'selectInspector', 'closeInspector', 'clearInspector']);
// Bank and Transacties are places of their own since 2026-10-16: no account register, no 'bankDetail'.
const Page = await selectedClass('costs-page.ts', 'CostsPage', ['pageTitle', 'phoneSubtitle', 'bankSub', 'phoneInspector', 'phoneLine', 'subScreen', 'backFromSection', 'phoneSegments']);
const Row = await selectedClass('cost-row.ts', 'CostRow', ['incl', 'open', 'credit', 'overpaid', 'status']);

function setup(params: Record<string, string> = { view: 'bank', tab: 'movements', account: 'BE94731074082814', dir: 'out', link: 'unlinked', q: 'Container', from: '2026-09-01', to: '2026-09-30' }) {
  const state = new State();
  state.location = signal(parseFinanceLocation(key => params[key] ?? null));
  state.go = (patch: any) => { state.location.set(patchLocation(state.location(), patch)); };
  state.inspectTitle = (target: any) => `${target.kind} ${target.id}`;
  Object.assign(state, { desk: signal(false), costDraft: signal(null), paySheet: signal(null), recurringDraft: signal(null), menu: signal(null),
    accountLabel: () => 'KBC-zichtrekening', segmentWarn: () => false, leaveAnalysis: () => { state.leftAnalysis = true; }, today: signal('2026-10-15'),
    accountsView: () => [{ account: 'BE94731074082814', label: 'KBC-zichtrekening', source: 'ODOO' }] });
  const page = new Page(); page.state = state; page.current = computed(() => financeSection(state.location().view));
  page.sync = { status: () => ({ lastSyncAt: '2026-10-15T06:12:00Z' }) };
  return { state, page };
}

test('opening a linked cost from bank and returning keeps the exact account, query, direction and period', () => {
  const { state, page } = setup(); const before = { ...state.location() };
  state.inspectItem({ kind: 'cost', id: 26 });
  assert.equal(state.inspectorBackLabel(), 'Terug naar transacties');
  assert.equal(page.pageTitle(), 'Transacties');
  assert.equal(page.phoneSubtitle(), 'KBC-zichtrekening', 'the chosen account is the sub line');
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
  assert.equal(state.inspectorBackLabel(), 'Terug naar kosten');
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

test('the phone segmented reads the short words with four segments, the full names as their accessible names; Transacties is a phone tab', () => {
  // Reversed on purpose (spec-bank-forecast §1.1, §6.1): the account register's explicit "Rekeningen" back is gone.
  // 2026-10-17 (critique N12): the kit's segmented replaces the native select; shorts only where there are more than two segments.
  const { state, page } = setup({ view: 'costs', tab: 'company' });
  assert.deepEqual(Array.from(page.phoneSegments(), (row: any) => row.label), ['Kosten', 'Containers', 'Vast', 'Aan wie']);
  assert.deepEqual(Array.from(page.phoneSegments(), (row: any) => row.ariaLabel), ['Kosten', 'Containers', 'Vaste kosten', 'Aan wie & beurzen']);
  state.go({ view: 'incoming', tab: 'open' });
  assert.deepEqual(Array.from(page.phoneSegments(), (row: any) => row.label), ['Openstaand', 'Ontvangen'], 'two segments keep their words');
  state.go({ view: 'costs', tab: 'company' });
  state.go({ view: 'bank', tab: 'movements', account: 'BE94731074082814' });
  assert.equal(page.phoneSegments().length, 0); assert.equal(page.subScreen(), false);
  assert.deepEqual([page.pageTitle(), page.phoneSubtitle()], ['Transacties', 'KBC-zichtrekening']);
  const views = signal(state.accountsView());
  state.accountsView = views;
  state.go({ account: '' });
  // One active account (Emre, 2026-10-16: "precies hetzelfde, aangezien we 1 rek hebben"): Transacties is that account.
  assert.deepEqual([page.pageTitle(), page.phoneSubtitle()], ['Transacties', 'KBC-zichtrekening']);
  views.set([...views(), { account: 'WISE-EUR', label: 'Wise EUR', source: 'MANUAL' }]);
  assert.deepEqual([page.pageTitle(), page.phoneSubtitle()], ['Transacties', 'Alle rekeningen'], 'two accounts: the stream over both');
  views.set(views().slice(0, 1));
  state.go({ view: 'bank', tab: 'accounts' });
  assert.equal(page.pageTitle(), 'Bank');
  assert.match(page.phoneSubtitle(), /^KBC-zichtrekening opgehaald \d\d:\d\d$/, 'Bank\'s sub: what was fetched, short enough for 360 px');
  assert.equal(page.phoneSubtitle(), 'KBC-zichtrekening opgehaald 08:12');
  state.today.set('2026-10-20');
  assert.equal(page.phoneSubtitle(), 'KBC-zichtrekening opgehaald 15 okt', 'an import of an earlier day shows its day, never a bare time');
  state.go({ view: 'analysis' });
  assert.equal(page.subScreen(), true, 'Rapportage stays a sub-screen');
  page.backFromSection(); assert.equal(state.leftAnalysis, true);
});

test('a transaction (line=) opens its own sheet on the phone, not the generic detail sheet', () => {
  const { state, page } = setup({ view: 'bank', tab: 'movements', line: '8841' });
  state.inspect.set({ kind: 'line', id: 8841 });
  assert.equal(page.phoneLine().id, 8841);
  state.inspect.set({ kind: 'cost', id: 26 });
  assert.equal(page.phoneLine(), null);
  assert.equal(page.phoneInspector().id, 26);
});

test('the transaction sheet stays under its own ⋯ menu; the generic detail sheet steps aside for a menu or a form', () => {
  // Review 2026-10-17 (B6 follow-up): the sheet unmounted when its ⋯ opened, so Intrekken ran on a destroyed sheet and a choice in progress was lost.
  const { state, page } = setup({ view: 'bank', tab: 'movements', line: '8841' });
  state.inspect.set({ kind: 'line', id: 8841 });
  state.menu.set({ items: [] });
  assert.equal(page.phoneLine().id, 8841, 'the menu stacks above the transaction sheet');
  state.menu.set(null);
  for (const field of ['costDraft', 'paySheet', 'recurringDraft']) {
    state[field].set({ id: 1 }); assert.equal(page.phoneLine(), null, `${field} takes the screen`);
    state[field].set(null); assert.equal(page.phoneLine().id, 8841);
  }
  state.inspect.set({ kind: 'cost', id: 26 }); state.menu.set({ items: [] });
  assert.equal(page.phoneLine(), null); assert.equal(page.phoneInspector(), null);
  state.desk.set(true); state.menu.set(null); state.inspect.set({ kind: 'line', id: 8841 });
  assert.equal(page.phoneLine(), null, 'a desk docks the line instead');
});

test('opening anything else while a transaction is open takes line= off the address, so it cannot win the inspector back', () => {
  // Facturen & kosten: cost 14 → its transaction → another cost row. Before 2026-10-16's review the address kept line=105.
  const { state } = setup({ view: 'costs', tab: 'company', cost: '14', line: '105' });
  state.inspect.set({ kind: 'line', id: 105 });
  state.inspectItem({ kind: 'cost', id: 17 });
  assert.deepEqual([state.location().cost, state.location().line], [17, null]);
  // Elsewhere a container or a recent row opened from a transaction drops line=, and Back pushes it again.
  const bank = setup({ view: 'bank', tab: 'movements', line: '105' }).state;
  bank.inspect.set({ kind: 'line', id: 105 });
  bank.inspectRelated({ kind: 'container', id: 43 });
  assert.equal(bank.location().line, null); assert.deepEqual(bank.inspect(), { kind: 'container', id: 43 });
  bank.backInspector();
  assert.equal(bank.location().line, 105);
  // On Facturen & kosten a container from the transaction drops cost= too; the same cost keeps cost=.
  const stale = setup({ view: 'costs', tab: 'company', cost: '26', line: '105' }).state;
  stale.inspectItem({ kind: 'container', id: 43 });
  assert.deepEqual([stale.location().cost, stale.location().line], [null, null]);
  const same = setup({ view: 'costs', tab: 'company', cost: '26', line: '105' }).state;
  same.inspectItem({ kind: 'cost', id: 26 });
  assert.deepEqual([same.location().cost, same.location().line], [26, null]);
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

test('Facturen on the phone: Inkomend · Uitgaand, the Odoo state as sub line, a sub-screen only when pushed (Kosten cell, ⋯)', () => {
  const { state, page } = setup({ view: 'invoices' });
  const pushed = signal(false);
  const note = signal<string | null>('Odoo: voorbeeld');
  let back = 0;
  page.finder = { pushed, odooNote: note, back: () => { back++; } };
  assert.deepEqual(Array.from(page.phoneSegments(), (row: any) => row.label), ['Inkomend', 'Uitgaand'], 'two segments keep their words');
  assert.equal(page.pageTitle(), 'Facturen');
  assert.equal(page.phoneSubtitle(), 'Odoo: voorbeeld');
  note.set(null);
  assert.equal(page.phoneSubtitle(), null, 'a connected Odoo needs no sub line');
  assert.equal(page.subScreen(), false, 'from the sidebar or Meer: the page keeps its own way back');
  pushed.set(true);
  assert.equal(page.subScreen(), true);
  page.backFromSection();
  assert.deepEqual([back, state.leftAnalysis], [1, undefined], 'back goes back in history');
  state.go({ tab: 'out' });
  assert.equal(state.location().tab, 'out');
  assert.equal(page.subScreen(), true, 'Uitgaand is the same sub-screen');
  pushed.set(false);
  state.go({ view: 'analysis' });
  page.backFromSection();
  assert.equal(state.leftAnalysis, true, 'Rapportage keeps its own back');
  const bare = setup({ view: 'invoices' }).page;
  assert.equal(bare.phoneSubtitle(), null, 'without the finder (a test harness) nothing breaks');
  assert.equal(bare.subScreen(), false);
});
