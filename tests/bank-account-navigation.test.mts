import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { signal, computed } from '@angular/core';
import { parseFinanceLocation, patchLocation, financeQueryParams } from '../src/app/features/finance/finance-url.ts';

async function selectedClass(file: string, name: string, members: string[]) {
  const source = await readFile(new URL(`../src/app/features/finance/${file}`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const cls = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name)!;
  const kept = cls.members.filter(member => member.name && members.includes(member.name.getText(parsed)));
  assert.equal(kept.length, members.length);
  const isolated = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter(m => !ts.isDecorator(m)), cls.name, undefined, undefined, kept);
  const code = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {};
  vm.runInNewContext(code, { exports, computed, signal });
  return exports[name];
}
const Panel = await selectedClass('bank-panel.ts', 'BankPanel', ['selectedAccount', 'accountLines', 'openCount', 'transactionCount', 'movements', 'openAccount', 'note']);
const Filters = await selectedClass('finance-filters.ts', 'FinanceFilters', ['movementOptions', 'pickMovement']);
const Toolbar = await selectedClass('finance-toolbar.ts', 'FinanceToolbar', ['bankDetail', 'primary', 'canNoteMovement']);
function setup() {
  const location = signal(parseFinanceLocation(key => key === 'view' ? 'bank' : null));
  const accounts = signal([{ account: 'BE123', label: 'KBC', source: 'ODOO' }, { account: 'BE456', label: 'Spaar', source: 'MANUAL' }]);
  const statements = signal([
    { id: 1, account: 'legacy KBC', source: 'ODOO', allocated: false, salesPaymentId: null },
    { id: 2, account: 'BE123', source: 'ODOO', allocated: true, salesPaymentId: null },
    { id: 3, account: 'BE123', source: 'MANUAL', allocated: false, salesPaymentId: null },
    { id: 4, account: 'BE456', source: 'MANUAL', allocated: false, salesPaymentId: null },
  ]);
  const navigations: any[] = [];
  const state = { location, accountsView: accounts, bankStatements: statements,
    canonicalAccount: (key: string) => key === 'legacy KBC' ? 'BE123' : key,
    archivedAccounts: () => [{ account: 'ARCHIVED', label: 'Oude rekening', archived: true }],
    officialBankLine: (line: any) => line.source === 'ODOO' || line.account !== 'BE123',
    manualAccountAllowed: (key: string) => key === 'BE456',
    go: (patch: any, mode?: string) => { navigations.push({ patch, mode }); location.set(patchLocation(location(), patch)); },
  };
  const panel = new Panel(); panel.state = state;
  const filters = new Filters(); filters.state = state;
  const toolbar = new Toolbar(); toolbar.state = state;
  return { panel, filters, toolbar, state, navigations };
}

test('bank entry is account overview; selecting an account creates a shareable scoped URL and history entry', () => {
  const { panel, state, navigations } = setup();
  assert.equal(panel.selectedAccount(), null);
  panel.movements('BE123');
  assert.equal(panel.selectedAccount().label, 'KBC');
  assert.equal(navigations[0].mode, 'push');
  const params = financeQueryParams(state.location());
  assert.equal(params['account'], 'BE123'); assert.equal(params['tab'], 'movements');
  state.go({ tab: 'accounts' }, 'push');
  assert.equal(panel.selectedAccount(), null); assert.equal(state.location().account, '');
});

test('a legacy unscoped link never silently merges multiple bank accounts', () => {
  const { panel, state } = setup(); panel.movements();
  assert.equal(state.location().account, ''); assert.equal(panel.selectedAccount(), null);
  state.accountsView.set([{ account: 'BE123', label: 'KBC', source: 'ODOO' }]);
  panel.movements(); assert.equal(state.location().account, 'BE123');
});

test('account totals and filter badge exclude other accounts and obsolete manual copies', () => {
  const { panel, filters, state } = setup(); panel.movements('BE123');
  assert.equal(panel.transactionCount('BE123'), 2); assert.equal(panel.openCount('BE123'), 1);
  assert.equal(filters.movementOptions().find((option: any) => option.id === 'unlinked').count, 1);
  filters.pickMovement('unlinked'); assert.equal(state.location().account, 'BE123');
  filters.pickMovement('in'); assert.equal(state.location().account, 'BE123'); assert.equal(state.location().dir, 'in');
});

test('archived account remains readable and cannot offer manual transaction entry', () => {
  const { panel, toolbar } = setup(); panel.movements('ARCHIVED');
  assert.equal(panel.selectedAccount().archived, true); assert.equal(toolbar.canNoteMovement(), false);
  assert.equal(toolbar.primary().kind, 'cost');
});

test('search for recorded payment never creates a synthetic bank movement', () => {
  const { panel, state } = setup();
  panel.note({ amountEur: 121, row: { cost: { id: 99 } } });
  assert.equal(state.location().tab, 'movements'); assert.equal(state.location().dir, 'out');
  assert.equal(state.location().link, 'unlinked'); assert.equal(panel.selectedAccount(), null);
});

test('Odoo detail primary action is a document, not an unsupported manual bank entry', () => {
  const { panel, toolbar } = setup(); panel.movements('BE123');
  assert.equal(toolbar.primary().kind, 'cost'); assert.equal(toolbar.canNoteMovement(), false);
  panel.movements('BE456'); assert.equal(toolbar.canNoteMovement(), true);
});


test('account choice preserves a work-queue search, period and allocation filters', () => {
  const { panel, state } = setup(); panel.note({ amountEur: 121, row: {} });
  state.go({ q: 'INV-42', period: 'month' });
  panel.openAccount('BE123');
  assert.equal(state.location().account, 'BE123'); assert.equal(state.location().dir, 'out');
  assert.equal(state.location().link, 'unlinked'); assert.equal(state.location().q, 'INV-42');
  assert.equal(state.location().period, 'month');
});

const Odoo = await selectedClass('odoo-connection-panel.ts', 'OdooConnectionPanel', ['syncBank']);
test('successful import refreshes shared bank state after navigating into an account', async () => {
  const panel = new Odoo(); let refreshes = 0, statuses = 0;
  Object.assign(panel, { ready: () => true, busy: () => false, syncing: signal(false), error: signal(''), syncResult: signal(null),
    destroyRef: { destroyed: true }, finance: { refreshBank: async () => { refreshes++; } },
    api: { syncBank: async () => ({ created: 1 }), status: async () => { statuses++; } } });
  await panel.syncBank();
  assert.equal(refreshes, 1); assert.equal(statuses, 0); assert.equal(panel.syncResult(), null);
});
