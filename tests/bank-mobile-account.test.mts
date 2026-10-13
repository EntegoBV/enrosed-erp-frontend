import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { parseFinanceLocation, patchLocation } from '../src/app/features/finance/finance-url.ts';

const source = await readFile(new URL('../src/app/features/finance/bank-panel.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('bank-panel.ts', source, ts.ScriptTarget.Latest, true);
const cls = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'BankPanel')!;
const names = ['selectedAccount', 'chooseAccount', 'openAccount', 'movements', 'iban', 'accountMenu', 'manage', 'showUnlinked', 'accountLines', 'openCount', 'transactionCount', 'pendingLabel', 'connectionAttention', 'freshLabel'];
const members = cls.members.filter(member => member.name && names.includes(member.name.getText(parsed)));
assert.equal(members.length, names.length);
const isolated = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter(m => !ts.isDecorator(m)), cls.name, undefined, undefined, members);
const code = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const exports: any = {};
vm.runInNewContext(code, { exports, computed });
const Panel = exports.BankPanel;
const event = { currentTarget: { getBoundingClientRect: () => ({ left: 50, bottom: 130 }) } };

function setup() {
  const location = signal(parseFinanceLocation(key => ({ view: 'bank', tab: 'movements', account: 'BE123', q: 'Factuur 42', dir: 'out', link: 'unlinked', period: 'month' }[key] ?? null)));
  const accounts = signal([{ account: 'BE123', label: 'KBC', source: 'ODOO', archived: false, reading: null }, { account: 'BE456', label: 'Spaar', source: 'MANUAL', archived: false, reading: { id: 1 } }]);
  const archived = { account: 'ARCHIVED', label: 'Oude rekening', source: 'MANUAL', archived: true, reading: { id: 2 } };
  const navigations: any[] = [];
  const state = { location, accountsView: accounts, archivedAccounts: () => [archived], desk: signal(false), menu: signal<any>(null),
    canonicalAccount: (key: string) => key === 'KBC alias' ? 'BE123' : key,
    bankStatements: signal<any[]>([]), officialBankLine: (line: any) => line.source === 'ODOO',
    go: (patch: any, mode?: string) => { navigations.push({ patch, mode }); location.set(patchLocation(location(), patch)); },
    openMenu: (menu: any) => state.menu.set(menu), bankAccountEditor: signal<any>(null),
    checkOrFill: (key: string) => navigations.push({ check: key }), historyAccount: signal<string | null>(null),
    openBank: (reading: any) => navigations.push({ reading }),
  };
  const panel = new Panel(); panel.state = state;
  return { panel, state, navigations, archived };
}

test('phone account switcher uses a page-level sheet and preserves the transaction selection', () => {
  const { panel, state, navigations } = setup();
  panel.chooseAccount(event);
  const menu = state.menu();
  assert.equal(menu.anchor, null); assert.equal(menu.cancelLabel, 'Sluiten');
  assert.equal(menu.items.find((item: any) => item.id === 'account:BE123').checked, true);
  assert.equal(menu.items.find((item: any) => item.id === 'account:BE456').hint, 'BE456');
  menu.pick('account:BE456');
  assert.equal(state.location().account, 'BE456'); assert.equal(navigations.at(-1).mode, 'push');
  assert.equal(state.location().q, 'Factuur 42'); assert.equal(state.location().dir, 'out');
  assert.equal(state.location().link, 'unlinked'); assert.equal(state.location().period, 'month');
});

test('desktop switcher anchors to its trigger; same/unknown choices do not navigate', () => {
  const { panel, state, navigations } = setup(); state.desk.set(true);
  panel.chooseAccount(event);
  assert.equal(state.menu().anchor.x, 50); assert.equal(state.menu().anchor.y, 136);
  state.menu().pick('account:BE123'); state.menu().pick('account:missing');
  assert.equal(navigations.length, 0);
});

test('account chooser keeps an archived detail identifiable and offers the explicit overview', () => {
  const { panel, state } = setup(); state.go({ account: 'ARCHIVED' }); panel.chooseAccount(event);
  const current = state.menu().items.find((item: any) => item.id === 'account:ARCHIVED');
  assert.equal(current.checked, true); assert.match(current.hint, /Gearchiveerd/);
  state.menu().pick('overview');
  assert.equal(state.location().tab, 'accounts'); assert.equal(state.location().account, '');
  assert.equal(panel.selectedAccount(), null);
});

test('te koppelen applies to both directions on the same account, irrespective of previous search/range', () => {
  const { panel, state } = setup(); panel.showUnlinked();
  assert.equal(state.location().account, 'BE123'); assert.equal(state.location().link, 'unlinked');
  assert.equal(state.location().dir, ''); assert.equal(state.location().q, '');
  assert.equal(state.location().period, 'all');
});

test('account status distinguishes empty, fully allocated, and pending official bank lines', () => {
  const { panel, state } = setup();
  assert.equal(panel.pendingLabel('BE123'), 'Nog geen transacties');
  state.bankStatements.set([{ account: 'KBC alias', source: 'ODOO', allocated: true, salesPaymentId: null },
    { account: 'BE123', source: 'MANUAL', allocated: false, salesPaymentId: null }]);
  assert.equal(panel.pendingLabel('BE123'), 'Alles gekoppeld');
  state.bankStatements.update(rows => [...rows, { account: 'BE123', source: 'ODOO', amountEur: -121, allocated: false, salesPaymentId: null }]);
  assert.equal(panel.pendingLabel('BE123'), '1 te koppelen');
});

test('mobile management preserves canonical account identity and existing balance/history actions', () => {
  const { panel, state, navigations } = setup(); const account = state.accountsView()[1];
  panel.accountMenu(account, event); assert.equal(state.menu().anchor, null);
  state.menu().pick('manage'); assert.equal(state.bankAccountEditor().key, 'BE456');
  state.menu().pick('check'); assert.equal(navigations.at(-1).check, 'BE456');
  state.menu().pick('history'); assert.equal(state.historyAccount(), 'BE456');
  state.menu().pick('fix'); assert.equal(navigations.at(-1).reading.id, 1);
});

test('collapsed connection opens for real errors, incomplete import or missing setup', () => {
  const { panel } = setup();
  const connection = { error: signal(''), documentsError: signal(''), syncResult: signal<any>(null), loading: signal(true), ready: signal(false) };
  panel.connectionPanel = () => connection;
  assert.equal(panel.connectionAttention(), false);
  connection.loading.set(false); assert.equal(panel.connectionAttention(), true);
  connection.ready.set(true); assert.equal(panel.connectionAttention(), false);
  connection.error.set('Ophalen mislukt'); assert.equal(panel.connectionAttention(), true);
  connection.error.set(''); connection.documentsError.set('Bestand ontbreekt'); assert.equal(panel.connectionAttention(), true);
  connection.documentsError.set('');
  for (const result of [{ complete: false, conflicts: 0, skippedNonEur: 0 }, { complete: true, conflicts: 1, skippedNonEur: 0 }, { complete: true, conflicts: 0, skippedNonEur: 1 }]) {
    connection.syncResult.set(result); assert.equal(panel.connectionAttention(), true);
  }
  connection.syncResult.set({ complete: true, conflicts: 0, skippedNonEur: 0 }); assert.equal(panel.connectionAttention(), false);
});

test('archived accounts with a checkpoint never claim that no balance was entered', () => {
  const { panel } = setup();
  assert.equal(panel.freshLabel({ reading: { id: 1 }, ageDays: null }), 'Historische saldocontrole');
  assert.equal(panel.freshLabel({ reading: null, ageDays: null }), 'Nog geen saldo');
});
