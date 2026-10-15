import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import { parseFinanceLocation, patchLocation } from '../src/app/features/finance/finance-url.ts';

/*
 * The account pieces of Bank (2026-10-16): the switcher became the account
 * chips and sidebar rows (BankPanel.openAccount keeps the stream's filters),
 * the account's ⋯ moved to its card (BankAccountCard.menu, with "Telt mee in
 * de kasprognose"), and the connection's "controle nodig" to OdooSyncState.
 */
async function selectedClass(file: string, name: string, members: string[], globals: Record<string, unknown> = {}) {
  const source = await readFile(new URL(`../src/app/features/finance/${file}`, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const cls = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name)!;
  const kept = cls.members.filter(member => member.name && members.includes(member.name.getText(parsed)));
  assert.equal(kept.length, members.length);
  const isolated = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter(m => !ts.isDecorator(m)), cls.name, undefined, undefined, kept);
  const code = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {};
  vm.runInNewContext(code, { exports, computed, signal, ...globals });
  return exports[name];
}
const Panel = await selectedClass('bank-panel.ts', 'BankPanel', ['selectedAccount', 'openAccount', 'movements', 'iban', 'showUnlinked', 'accountLines', 'openCount', 'transactionCount', 'pendingLabel', 'freshLabel']);
const Card = await selectedClass('bank-account-card.ts', 'BankAccountCard', ['menu', 'iban', 'open']);
const Sync = await selectedClass('odoo-sync-state.ts', 'OdooSyncState', ['attention']);
const event = { currentTarget: { getBoundingClientRect: () => ({ left: 50, bottom: 130 }) } };

function setup() {
  const location = signal(parseFinanceLocation(key => ({ view: 'bank', tab: 'movements', account: 'BE123', q: 'Factuur 42', dir: 'out', link: 'unlinked', period: 'month' }[key] ?? null)));
  const accounts = signal([{ account: 'BE123', label: 'KBC', source: 'ODOO', archived: false, reading: null, countsInCash: true },
    { account: 'BE456', label: 'Spaar', source: 'MANUAL', archived: false, reading: { id: 1 }, countsInCash: false, aliases: ['Spaar oud'], odooJournalId: null, manualMovementsAllowed: true }]);
  const archived = { account: 'ARCHIVED', label: 'Oude rekening', source: 'MANUAL', archived: true, reading: { id: 2 } };
  const navigations: any[] = [];
  const counted: any[] = [];
  const state = { location, accountsView: accounts, archivedAccounts: () => [archived], desk: signal(false), menu: signal<any>(null), cashRound: signal(true),
    canonicalAccount: (key: string) => key === 'KBC alias' ? 'BE123' : key,
    bankStatements: signal<any[]>([]), officialBankLine: (line: any) => line.source === 'ODOO',
    go: (patch: any, mode?: string) => { navigations.push({ patch, mode }); location.set(patchLocation(location(), patch)); },
    openMenu: (menu: any) => state.menu.set(menu), bankAccountEditor: signal<any>(null),
    checkOrFill: (key: string) => navigations.push({ check: key }), historyAccount: signal<string | null>(null),
    openBank: (reading: any) => navigations.push({ reading }), setCountsInCash: (key: string, counts: boolean) => counted.push({ key, counts }),
  };
  const panel = new Panel(); panel.state = state;
  return { panel, state, navigations, archived, counted };
}
function card(state: any, account: any, wide = false) {
  const instance = new Card(); instance.state = state; instance.account = () => account; instance.wide = () => wide;
  return instance;
}

test('an account chip or sidebar row switches the account and keeps the search, direction, link and period', () => {
  const { panel, state, navigations } = setup();
  panel.openAccount('BE456');
  assert.equal(state.location().account, 'BE456'); assert.equal(navigations.at(-1).mode, 'push');
  assert.equal(state.location().q, 'Factuur 42'); assert.equal(state.location().dir, 'out');
  assert.equal(state.location().link, 'unlinked'); assert.equal(state.location().period, 'month');
});

test('the account card opens Transacties on its account from the cockpit; on top of Transacties it is no link', () => {
  const { state } = setup(); state.go({ tab: 'accounts' });
  const account = state.accountsView()[1];
  card(state, account).open();
  assert.deepEqual([state.location().tab, state.location().account, state.location().q], ['movements', 'BE456', '']);
  const before = JSON.stringify(state.location());
  card(state, account, true).open();
  assert.equal(JSON.stringify(state.location()), before);
});

test('an archived account stays identifiable on Transacties, and Bank shows no account', () => {
  const { panel, state } = setup(); state.go({ account: 'ARCHIVED' });
  assert.equal(panel.selectedAccount().archived, true); assert.equal(panel.selectedAccount().countsInCash, false);
  state.go({ tab: 'accounts' });
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

test('the card ⋯ keeps the canonical identity, the balance and history actions, and "Telt mee in de kasprognose"', () => {
  const { state, navigations, counted } = setup(); const account = state.accountsView()[1];
  card(state, account).menu(event); assert.equal(state.menu().anchor, null, 'a phone sheet');
  assert.deepEqual(Array.from(state.menu().items, (item: any) => item.label),
    ['Rekeninggegevens en beheer', 'Saldo controleren', 'Saldogeschiedenis', 'Saldo corrigeren', 'Telt mee in de kasprognose']);
  assert.equal(state.menu().items.at(-1).checked, false);
  state.menu().pick('manage'); assert.equal(state.bankAccountEditor().key, 'BE456'); assert.deepEqual(Array.from(state.bankAccountEditor().aliases), ['Spaar oud']);
  state.menu().pick('check'); assert.equal(navigations.at(-1).check, 'BE456');
  state.menu().pick('history'); assert.equal(state.historyAccount(), 'BE456');
  state.menu().pick('fix'); assert.equal(navigations.at(-1).reading.id, 1);
  state.menu().pick('counts'); assert.deepEqual(JSON.parse(JSON.stringify(counted)), [{ key: 'BE456', counts: true }]);
  state.desk.set(true); card(state, account).menu(event);
  assert.equal(state.menu().anchor.x, 50); assert.equal(state.menu().anchor.y, 136, 'a desk menu anchors to its trigger');
  state.cashRound.set(false); card(state, account).menu(event);
  assert.equal(state.menu().items.some((item: any) => item.id === 'counts'), false, 'an older server has no such switch');
});

test('"Odoo: controle nodig" for real errors, an incomplete import or a connection still to set up (OdooSyncState.attention)', () => {
  const sync = new Sync();
  Object.assign(sync, { error: signal(''), documentsError: signal(''), syncResult: signal<any>(null), loading: signal(true), ready: signal(false) });
  assert.equal(sync.attention(), false);
  sync.loading.set(false); assert.equal(sync.attention(), true);
  sync.ready.set(true); assert.equal(sync.attention(), false);
  sync.error.set('Ophalen mislukt'); assert.equal(sync.attention(), true);
  sync.error.set(''); sync.documentsError.set('Bestand ontbreekt'); assert.equal(sync.attention(), true);
  sync.documentsError.set('');
  for (const result of [{ complete: false, conflicts: 0, skippedNonEur: 0 }, { complete: true, conflicts: 1, skippedNonEur: 0 }, { complete: true, conflicts: 0, skippedNonEur: 1 }]) {
    sync.syncResult.set(result); assert.equal(sync.attention(), true);
  }
  sync.syncResult.set({ complete: true, conflicts: 0, skippedNonEur: 0 }); assert.equal(sync.attention(), false);
});

test('archived accounts with a checkpoint never claim that no balance was entered', () => {
  const { panel } = setup();
  assert.equal(panel.freshLabel({ reading: { id: 1 }, ageDays: null }), 'Historische saldocontrole');
  assert.equal(panel.freshLabel({ reading: null, ageDays: null }), 'Nog geen saldo');
});
