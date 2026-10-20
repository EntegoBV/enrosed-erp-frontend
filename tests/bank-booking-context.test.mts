import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal, untracked } from '@angular/core';
import { allocatedLine, cancellationCandidates, transferCandidates, vatPeriods, legDistance } from '../src/app/features/finance/bank-suggestions.ts';
import { CLASSIFICATION_LABEL } from '../src/app/features/finance/cash-forecast.ts';
import { bankTextOf } from '../src/app/features/finance/bank-text.ts';
import { containerName, containerNumberHint } from '../src/app/features/purchasing/container-name.ts';
import { costLedger } from '../src/app/features/finance/cost-ledger.ts';
import { dayMonthYear } from '../src/app/features/finance/finance-format.ts';

// Execute the production classes with injected in-memory services; no browser, HTTP or persisted financial writes.
async function classCode(file: string, name: string): Promise<string> {
  const text = await readFile(new URL(`../src/app/features/finance/${file}`, import.meta.url), 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const cls = source.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === name)!;
  const isolated = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter(m => !ts.isDecorator(m)), cls.name, undefined, undefined, cls.members);
  return ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(source, [isolated])), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}
const bookCode = await classCode('book-as-sheet.ts', 'BookAsSheet');
const unbankedCode = await classCode('bank-sheets.ts', 'UnbankedSheet');
const row = (id: number, amountEur: number, extra = {}) => ({ id, amountEur, account: 'KBC', bookedAt: '2026-10-07T00:00:00Z',
  counterparty: 'IKEA', reference: 'Kaartbetaling', allocated: false, salesPaymentId: null, classification: null, ...extra });

function harness() {
  const source = row(73, -279.96), other = row(74, 279.96);
  const calls: any[] = [], notices: any[] = [], undone: any[] = [];
  const state = {
    bookAsLine: signal<any>(source), bankStatements: signal<any[]>([source, other]), receivedDocumentLine: signal<number | null>(null),
    accountOptions: () => [{ key: 'KBC' }], canonicalAccount: (s: string) => s, accountLabel: (s: string) => s,
    officialBankLine: () => true, lineDay: (r: any) => r.bookedAt.slice(0, 10), cashRound: () => true, today: () => '2026-10-20',
    flash: () => {}, refreshBank: async () => {}, inspectItem: (target: any) => calls.push({ inspect: target }),
    openCostFromBank: () => { throw Error('A cancellation must not create a cost'); },
    unclassifyLine: (line: any) => undone.push(line),
    purchaseViews: () => [{ order: { id: 40, supplierId: 9 } }, { order: { id: 41, supplierId: 9 } }],
    suppliers: () => [{ id: 9, name: 'Foam Supplier' }],
  };
  const api = { classify: async (id: number, body: any) => {
    calls.push({ id, body });
    return { lines: [source, other].map(line => ({ ...line, classification: body.classification, allocated: true, transferLineId: line.id === 73 ? 74 : 73 })) };
  }};
  const exports: any = {};
  vm.runInNewContext(bookCode + '\n' + unbankedCode, {
    exports, signal, computed, untracked, effect: (run: () => void) => run(), NONE: 'none',
    FinanceState: 'state', BankingApi: 'api', Ui: 'ui',
    inject: (token: string) => token === 'state' ? state : token === 'api' ? api : { toast: (...args: any[]) => notices.push(args) },
    allocatedLine, cancellationCandidates, transferCandidates, vatPeriods, legDistance, bankTextOf, CLASSIFICATION_LABEL,
    formatEuro: (n: number) => `€ ${n.toFixed(2)}`, messageOf: (e: Error) => e.message,
    containerName, containerNumberHint, dayMonthYear,
  });
  return { sheet: new exports.BookAsSheet(), unbanked: new exports.UnbankedSheet(), source, state, calls, notices, undone };
}

test('Annulatie waits for explicit selection; atomically sends the pair, updates both and undo uses saved classification', async () => {
  const h = harness();
  h.sheet.choice.set('CANCELLATION');
  assert.equal(h.sheet.ready(), false);
  await h.sheet.book(h.source);
  assert.equal(h.calls.length, 0);
  h.sheet.cancellationLeg.set(74);
  assert.equal(h.sheet.ready(), true);
  await h.sheet.book(h.source);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [{ id: 73, body: { classification: 'CANCELLATION', transferLineId: 74, note: null, vatPeriod: null } }]);
  assert.ok(h.state.bankStatements().every(line => line.allocated && line.classification === 'CANCELLATION'));
  h.notices[0][2].run();
  assert.equal(h.undone[0].classification, 'CANCELLATION');
  assert.equal(h.undone[0].transferLineId, 74);
});

test('A selected counterpart that becomes allocated blocks saving, and internal transfer choice never selects cancellation', async () => {
  const h = harness();
  h.sheet.leg.set('74');
  h.sheet.choice.set('CANCELLATION');
  assert.equal(h.sheet.ready(), false);
  h.sheet.cancellationLeg.set(74);
  h.state.bankStatements.update(rows => rows.map(line => line.id === 74 ? { ...line, classification: 'OTHER', allocated: true } : line));
  assert.equal(h.sheet.ready(), false);
  await h.sheet.book(h.source);
  assert.equal(h.calls.length, 0);
});

test('Aankoopfactuur or creditnota opens the existing Odoo picker without booking or creating a cost', async () => {
  const h = harness();
  h.sheet.choice.set('RECEIVED_DOCUMENT');
  await h.sheet.book(h.source);
  assert.equal(h.state.receivedDocumentLine(), 73);
  assert.equal(h.state.bookAsLine(), null);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [{ inspect: { kind: 'line', id: 73 } }]);
});

test('Unbanked container payments retain both identical aliases and their distinct PO numbers in list and search context', () => {
  const h = harness();
  const rows = costLedger([], [40, 41].map((id, index) => ({
    id: 100 + index, orderId: id, orderNumber: `PO-2026-00${6 + index}`, orderAlias: 'Foam Bear - 25cm RED ONLY',
    paidOn: `2026-09-${28 + index}`, amountEur: 7025, label: '70% bij vertrek', payee: 'SUPPLIER' as const, invoiceNumber: 'SUP-123',
  })), () => 0);
  for (const row of rows) {
    const context = h.unbanked.paymentContext(row);
    assert.equal(context.title, 'Foam Bear - 25cm RED ONLY');
    assert.equal(context.reference, row.payment!.orderNumber);
    assert.equal(context.party, 'Foam Supplier');
    assert.equal(context.phase, '70% bij vertrek · Factuur SUP-123');
    assert.ok(context.searchDescription.includes(row.payment!.orderNumber));
    assert.ok(context.searchDescription.includes(context.title));
    assert.ok(context.searchDescription.includes('70% bij vertrek'));
  }
  assert.notEqual(h.unbanked.paymentContext(rows[0]).searchDescription, h.unbanked.paymentContext(rows[1]).searchDescription);
});

test('Unbanked fallback names stay useful, while logistics does not inherit the goods supplier name', () => {
  const h = harness();
  const row = costLedger([], [{ id: 1, orderId: 40, orderNumber: 'PO-2026-006', orderAlias: null,
    paidOn: '2026-10-07', amountEur: 100, label: 'Vracht', payee: 'LOGISTICS' }], () => 0)[0];
  const context = h.unbanked.paymentContext(row);
  assert.equal(context.title, 'PO-2026-006');
  assert.equal(context.reference, null);
  assert.equal(context.party, 'Douane & transport');
  assert.equal(context.searchDescription, 'PO-2026-006 · Vracht');
  assert.equal(h.unbanked.paymentContext({ ...row, payment: { ...row.payment, orderNumber: null } }).title, 'Inkoop #40');
});
