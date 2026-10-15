import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { signal, computed } from '@angular/core';
import { parseFinanceLocation, patchLocation, financeQueryParams } from '../src/app/features/finance/finance-url.ts';
import { financeNavOf } from '../src/app/features/finance/finance-sections.ts';

async function selectedClass(file: string, name: string, members: string[]) {
  const source = await readFile(new URL(`../src/app/features/finance/${file}`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const cls = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name)!;
  const kept = cls.members.filter(member => member.name && members.includes(member.name.getText(parsed)));
  assert.equal(kept.length, members.length);
  const isolated = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter(m => !ts.isDecorator(m)), cls.name, undefined, undefined, kept);
  const code = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {};
  vm.runInNewContext(code, { exports, computed, signal, financeNavOf });
  return exports[name];
}
// The Bank router (cockpit / Transacties) and the toolbar's Transacties members followed BankPanel and FinanceFilters to their new homes (2026-10-16).
const Panel = await selectedClass('bank-panel.ts', 'BankPanel', ['selectedAccount', 'accountLines', 'openCount', 'transactionCount', 'movements', 'openAccount', 'note']);
const Toolbar = await selectedClass('finance-toolbar.ts', 'FinanceToolbar', ['transactions', 'title', 'hasManualAccount', 'canNoteMovement', 'noteBlocked', 'primary', 'movementOptions', 'movementValue', 'pickMovement']);
function setup(manual: string[] = ['BE456']) {
  const location = signal(parseFinanceLocation(key => key === 'view' ? 'bank' : null));
  const accounts = signal([{ account: 'BE123', label: 'KBC', source: 'ODOO' }, { account: 'BE456', label: 'Spaar', source: 'MANUAL' }]);
  const statements = signal([
    { id: 1, account: 'legacy KBC', source: 'ODOO', allocated: false, salesPaymentId: null },
    { id: 2, account: 'BE123', source: 'ODOO', allocated: true, salesPaymentId: null },
    { id: 3, account: 'BE123', source: 'MANUAL', allocated: false, salesPaymentId: null },
    { id: 4, account: 'BE456', source: 'MANUAL', allocated: false, salesPaymentId: null },
  ]);
  const navigations: any[] = [];
  const searches: any[] = [];
  const state = { location, accountsView: accounts, bankStatements: statements,
    canonicalAccount: (key: string) => key === 'legacy KBC' ? 'BE123' : key,
    archivedAccounts: () => [{ account: 'ARCHIVED', label: 'Oude rekening', archived: true }],
    officialBankLine: (line: any) => line.source === 'ODOO' || line.account !== 'BE123',
    archivedBankLine: () => false,
    manualAccountAllowed: (key: string) => key === 'BE456',
    manualAccountOptions: () => manual.map((key) => ({ key, label: key })),
    accountLabel: (key: string) => ({ BE123: 'KBC', BE456: 'Spaar' } as Record<string, string>)[key] ?? key,
    today: () => '2026-10-15',
    searchTransaction: (payment: any) => { searches.push(payment); },
    go: (patch: any, mode?: string) => { navigations.push({ patch, mode }); location.set(patchLocation(location(), patch)); },
  };
  const panel = new Panel(); panel.state = state;
  const toolbar = new Toolbar(); toolbar.state = state;
  return { panel, toolbar, state, navigations, searches };
}

test('bank entry is the cockpit; choosing an account creates a shareable scoped URL and history entry', () => {
  const { panel, toolbar, state, navigations } = setup();
  assert.equal(state.location().tab, 'accounts', 'Kosten & bank opens on Bank');
  assert.equal(toolbar.title(), 'Bank');
  assert.equal(panel.selectedAccount(), null);
  panel.movements('BE123');
  assert.equal(panel.selectedAccount().label, 'KBC');
  assert.equal(toolbar.title(), 'Transacties', 'the title is the place, the account card says which account');
  assert.equal(navigations[0].mode, 'push');
  const params = financeQueryParams(state.location());
  assert.equal(params['account'], 'BE123'); assert.equal(params['tab'], 'movements');
  state.go({ tab: 'accounts' }, 'push');
  assert.equal(panel.selectedAccount(), null); assert.equal(state.location().account, '');
});

test('Transacties without an account is the stream over every account (reversed: a legacy unscoped link no longer picks one)', () => {
  // Reversed on purpose (spec-bank-forecast §1.2): bank/movements without account= shows all accounts; nothing is chosen for you.
  const { panel, state } = setup(); panel.movements();
  assert.equal(state.location().account, ''); assert.equal(panel.selectedAccount(), null);
  state.accountsView.set([{ account: 'BE123', label: 'KBC', source: 'ODOO' }]);
  panel.movements(); assert.equal(state.location().account, '', 'one account is no reason to scope the stream');
  assert.equal(state.location().tab, 'movements');
});

test('account totals and the Te koppelen badge exclude other accounts and obsolete manual copies; without an account they count every account', () => {
  const { panel, toolbar, state } = setup(); panel.movements('BE123');
  assert.equal(panel.transactionCount('BE123'), 2); assert.equal(panel.openCount('BE123'), 1);
  assert.equal(toolbar.movementOptions().find((option: any) => option.id === 'unlinked').count, 1);
  toolbar.pickMovement('unlinked'); assert.equal(state.location().account, 'BE123'); assert.equal(state.location().link, 'unlinked');
  toolbar.pickMovement('in'); assert.equal(state.location().account, 'BE123'); assert.equal(state.location().dir, 'in');
  assert.equal(toolbar.movementValue(), 'in');
  state.go({ account: '' });
  assert.equal(toolbar.movementOptions().find((option: any) => option.id === 'unlinked').count, 2, 'both accounts');
});

test('an archived account remains readable and cannot take a noted transaction', () => {
  const { panel, toolbar } = setup(); panel.movements('ARCHIVED');
  assert.equal(panel.selectedAccount().archived, true); assert.equal(toolbar.canNoteMovement(), false);
});

test('"Transactie zoeken" prefills Transacties with the amount and five days either side; it never creates a bank movement', () => {
  const { panel, searches } = setup();
  panel.note({ amountEur: 121, paidOn: '2026-10-08', row: { party: 'Securex', description: 'Factuur september' } });
  assert.deepEqual(JSON.parse(JSON.stringify(searches)), [{ amountEur: 121, paidOn: '2026-10-08', party: 'Securex', description: 'Factuur september', incoming: false }]);
});

test('"Transactie noteren" on an Odoo account is disabled with its reason; without any manual account "Transacties ophalen" leads', () => {
  const { panel, toolbar } = setup(); panel.movements('BE123');
  assert.equal(toolbar.primary().kind, 'movement'); assert.equal(toolbar.primary().label, 'Transactie noteren');
  assert.equal(toolbar.noteBlocked(), 'Transacties van KBC komen uit Odoo');
  assert.equal(toolbar.canNoteMovement(), false);
  panel.movements('BE456'); assert.equal(toolbar.canNoteMovement(), true); assert.equal(toolbar.noteBlocked(), null);
  const odooOnly = setup([]); odooOnly.panel.movements();
  assert.deepEqual([odooOnly.toolbar.primary().kind, odooOnly.toolbar.primary().label], ['sync', 'Transacties ophalen'], 'production today: one Odoo account');
  assert.equal(odooOnly.toolbar.canNoteMovement(), false);
});

test('account choice preserves a work-queue search, period and allocation filters', () => {
  const { panel, state } = setup(); panel.movements('', 'out', true);
  state.go({ q: 'INV-42', period: 'month' });
  panel.openAccount('BE123');
  assert.equal(state.location().account, 'BE123'); assert.equal(state.location().dir, 'out');
  assert.equal(state.location().link, 'unlinked'); assert.equal(state.location().q, 'INV-42');
  assert.equal(state.location().period, 'month');
});

// The import moved into OdooSyncState (the page's): it still refreshes the shared bank after the sheet that started it closed.
const SyncSource = await readFile(new URL('../src/app/features/finance/odoo-sync-state.ts', import.meta.url), 'utf8');
const syncParsed = ts.createSourceFile('odoo-sync-state.ts', SyncSource, ts.ScriptTarget.Latest, true);
const syncClass = syncParsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'OdooSyncState')!;
const syncNoticeFn = syncParsed.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'syncNotice')!;
const syncMembers = syncClass.members.filter(member => member.name && ['syncBank', 'attention'].includes(member.name.getText(syncParsed)));
const syncCode = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(syncParsed, [syncNoticeFn as ts.Statement,
  ts.factory.updateClassDeclaration(syncClass, syncClass.modifiers?.filter(m => !ts.isDecorator(m)), syncClass.name, undefined, undefined, syncMembers)])),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const syncExports: any = {};
vm.runInNewContext(syncCode, { exports: syncExports, computed, messageOf: (error: any, fallback: string) => error?.message || fallback });
test('a successful import refreshes the shared bank state and says what it brought, whoever started it', async () => {
  const sync = new syncExports.OdooSyncState(); let refreshes = 0, statuses = 0; const toasts: any[] = [];
  Object.assign(sync, { ready: () => true, busy: () => false, syncing: signal(false), error: signal(''), syncResult: signal(null), sheetOpen: signal(false),
    destroyRef: { destroyed: false }, finance: { refreshBank: async () => { refreshes++; } }, status: signal(null),
    ui: { toast: (text: string, kind: string, action?: any) => toasts.push({ text, kind, action: action?.label ?? null }) },
    api: { syncBank: async () => ({ created: 3, updated: 1, unchanged: 240, conflicts: 1, skippedNonEur: 2, complete: true, scanned: 244, message: '' }),
      status: async () => { statuses++; return { lastSyncAt: '2026-10-15T06:12:00Z' }; } } });
  await sync.syncBank();
  assert.equal(refreshes, 1); assert.equal(statuses, 1); assert.equal(sync.syncResult().created, 3);
  assert.deepEqual(toasts, [{ text: 'Import afgerond · 3 nieuw · 1 bijgewerkt · 240 ongewijzigd · 1 beweging vraagt controle · 2 in een andere munt niet overgenomen',
    kind: 'err', action: 'Details' }]);
});
