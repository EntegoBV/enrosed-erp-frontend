import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import type { BankMatch, BankStatementLine } from '../src/app/core/api/banking-api.ts';
import type { Customer, IncomingPaymentRow, SalesOrderView } from '../src/app/core/api/models.ts';
import type { BankMovementPanel } from '../src/app/features/finance/bank-movement-panel.ts';
import { receiptInstant, receiptLocalParts, receiptRequest } from '../src/app/shared/received-at.ts';
import { paymentLocalDay, paymentMomentLabel } from '../src/app/features/finance/incoming-money.ts';

/**
 * Exercise the production component methods with real Angular signals, without
 * a browser, HTTP client or backend. The AST transform removes only imports;
 * no method, guard, computed value or helper implementation is rewritten.
 * Component metadata and injected services are supplied by the harness.
 * Angular's templates remain covered by the application build and browser QA.
 *
 * Run: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test
 *      --experimental-strip-types tests/bank-movement-panel.test.mts
 */
async function compile(relativePath: string): Promise<string> {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  const parsed = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true);
  const isolated = ts.factory.updateSourceFile(parsed, parsed.statements.filter(statement => !ts.isImportDeclaration(statement)));
  // Reparse the printed module so TypeScript does not retain the removed
  // imports' original CommonJS symbol bindings during decorator emission.
  return ts.transpileModule(ts.createPrinter().printFile(isolated), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, experimentalDecorators: true },
  }).outputText;
}

const componentCode = await compile('../src/app/features/finance/bank-movement-panel.ts');
const bankCode = await compile('../src/app/features/finance/bank-reconciliation.ts');
const bankExports: { bankAccountKey?: (value: string | null | undefined) => string } = {};
vm.runInNewContext(bankCode, { exports: bankExports, receiptInstant });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function invoice(id: number, total = 100, remaining = 100, refundable = 0): SalesOrderView {
  return {
    order: { id, number: `INV-${id}`, status: 'UITGEREIKT', docType: 'FACTUUR', customerId: 1 },
    priced: { totals: { totalInclVat: total } },
    paymentSummary: { invoiceTotalEur: total, remainingEur: remaining, refundableEur: refundable, payments: [] },
  } as unknown as SalesOrderView;
}

function movement(id = 1, amountEur = 50): BankStatementLine {
  return {
    id, amountEur, account: 'KBC', bookedAt: '2026-09-08T12:00:00Z', timeZone: 'Europe/Brussels',
    reference: 'Bank reference', counterparty: 'Test partner', salesPaymentId: null, salesOrderId: null,
    allocationCreatedPayment: false, allocatedAt: null, recordedAt: '2026-09-08T12:05:00Z', actor: 'Test', fingerprint: `test-${id}`,
  };
}

function receipt(id: number, salesOrderId: number, amountEur = 50, bankAccount: string | null = 'KBC'): IncomingPaymentRow {
  return {
    id, salesOrderId, amountEur, bankAccount, receivedAt: '2026-09-08T12:00:00Z', timeZone: 'Europe/Brussels',
    recordedAt: '2026-09-08T12:05:00Z', reference: 'Existing payment', actor: 'Test', legacy: false,
    orderNumber: `INV-${salesOrderId}`, customerId: 1, purchaseOrderId: null, purpose: 'STANDARD',
  };
}

function newMatch(salesOrderId: number, openEur = 100): BankMatch {
  return { salesOrderId, number: `INV-${salesOrderId}`, existingPaymentId: null, openEur, score: 0,
    reason: 'New receipt', receivedAt: null, reference: null };
}

function harness() {
  const state = {
    salesOrders: signal<SalesOrderView[]>([]), incomingPayments: signal<IncomingPaymentRow[]>([]),
    bankStatements: signal<BankStatementLine[]>([]), customers: signal<Customer[]>([]), accounts: signal<string[]>([]),
    load: async () => {},
  };
  const allocationCalls: { id: number; salesOrderId: number; existingPaymentId: number | null }[] = [];
  const api = {
    suggestions: async (_id: number): Promise<BankMatch[]> => [],
    allocate: async (id: number, salesOrderId: number, existingPaymentId: number | null): Promise<BankStatementLine> => {
      allocationCalls.push({ id, salesOrderId, existingPaymentId });
      return { ...movement(id), salesOrderId, salesPaymentId: existingPaymentId ?? 999, allocationCreatedPayment: existingPaymentId === null };
    },
  };
  const tokens = { state: Symbol('FinanceState'), api: Symbol('BankingApi'), ui: Symbol('Ui') };
  const exports: { BankMovementPanel?: new () => BankMovementPanel } = {};
  vm.runInNewContext(componentCode, {
    exports, signal, computed, Component: () => (value: unknown) => value, ChangeDetectionStrategy: { OnPush: 0 },
    FormsModule: {}, RouterLink: {}, EurPipe: {}, Sheet: {}, DateField: {},
    FinanceState: tokens.state, BankingApi: tokens.api, Ui: tokens.ui,
    inject: (token: symbol) => {
      if (token === tokens.state) return state;
      if (token === tokens.api) return api;
      if (token === tokens.ui) return { toast: () => {} };
      throw new Error(`Unexpected service injection: ${String(token)}`);
    },
    bankAccountKey: bankExports.bankAccountKey, receiptLocalParts, receiptRequest,
    paymentLocalDay, paymentMomentLabel, crypto: globalThis.crypto,
    messageOf: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
  });
  assert.ok(exports.BankMovementPanel, 'Production component class was compiled');
  const panel = new exports.BankMovementPanel();
  return { panel, state, api, allocationCalls };
}

test('choosing a suggestion clears the manual invoice and allocates the visibly chosen invoice', async () => {
  const { panel, state, allocationCalls } = harness();
  state.salesOrders.set([invoice(1), invoice(2)]);
  state.bankStatements.set([movement()]);
  await panel.openAllocation(movement());
  panel.chooseInvoice(1);
  panel.chooseMatch(panel.manualNewMatch()!, true);
  assert.equal(panel.manualInvoice(), 1);
  panel.chooseMatch(newMatch(2));
  assert.equal(panel.manualInvoice(), 0);
  assert.equal(panel.choice()?.salesOrderId, 2);
  await panel.allocate();
  assert.deepEqual(allocationCalls, [{ id: 1, salesOrderId: 2, existingPaymentId: null }]);
});

test('a matching existing receipt blocks accidental duplicate creation and can be linked directly', async () => {
  const { panel, state, allocationCalls } = harness();
  state.salesOrders.set([invoice(1, 100, 50)]);
  state.incomingPayments.set([receipt(11, 1)]);
  state.bankStatements.set([movement()]);
  await panel.openAllocation(movement());
  panel.chooseInvoice(1);
  panel.chooseMatch(panel.manualNewMatch()!, true);
  assert.equal(panel.canAllocate(), false);
  await panel.allocate();
  assert.equal(allocationCalls.length, 0, 'A new receipt requires an explicit duplicate check');
  panel.newBookingConfirmed.set(true);
  assert.equal(panel.canAllocate(), true);
  panel.chooseMatch(panel.manualMatches()[0], true);
  assert.equal(panel.newBookingConfirmed(), false, 'Changing choice clears the prior duplicate acknowledgement');
  assert.equal(panel.canAllocate(), true, 'Linking the existing receipt creates no duplicate');
  await panel.allocate();
  assert.deepEqual(allocationCalls, [{ id: 1, salesOrderId: 1, existingPaymentId: 11 }]);
});

test('an existing refund remains linkable after its invoice credit is exhausted', async () => {
  const { panel, state, allocationCalls } = harness();
  const outgoing = movement(1, -75);
  state.salesOrders.set([invoice(1, -75, 0, 0), invoice(2, -50, 0, 50), invoice(3, -75, 0, 75)]);
  state.incomingPayments.set([receipt(12, 1, -75)]);
  state.bankStatements.set([outgoing]);
  await panel.openAllocation(outgoing);
  assert.deepEqual(Array.from(panel.selectableInvoices(), view => view.order.id), [1, 3], 'Insufficient new refund credit is excluded');
  panel.chooseInvoice(1);
  assert.equal(panel.manualNewMatch(), null, 'Exhausted credit cannot fund another refund');
  assert.equal(panel.manualMatches()[0].existingPaymentId, 12);
  panel.chooseMatch(panel.manualMatches()[0], true);
  await panel.allocate();
  assert.deepEqual(allocationCalls, [{ id: 1, salesOrderId: 1, existingPaymentId: 12 }]);
});

test('manual invoice selection finds an existing receipt outside the eight returned suggestions', async () => {
  const { panel, state, api } = harness();
  state.salesOrders.set(Array.from({ length: 9 }, (_, index) => invoice(index + 1)));
  state.incomingPayments.set([receipt(99, 9)]);
  api.suggestions = async () => Array.from({ length: 8 }, (_, index) => newMatch(index + 1));
  await panel.openAllocation(movement());
  assert.equal(panel.matches().length, 8);
  panel.chooseInvoice(9);
  assert.equal(panel.manualMatches()[0].existingPaymentId, 99);
  panel.chooseMatch(panel.manualMatches()[0], true);
  assert.equal(panel.canAllocate(), true);
});

test('existing receipt fallback respects direction, account and prior bank links', async () => {
  const { panel, state } = harness();
  state.salesOrders.set([invoice(1)]);
  state.incomingPayments.set([
    receipt(1, 1, 50, ' kbc '), receipt(2, 1, -50), receipt(3, 1, 50, 'ING'),
    receipt(4, 1, 50, null), receipt(5, 1), receipt(6, 1, 51),
  ]);
  state.bankStatements.set([{ ...movement(2), salesPaymentId: 5 }]);
  await panel.openAllocation(movement());
  panel.chooseInvoice(1);
  assert.deepEqual(Array.from(panel.manualMatches(), match => match.existingPaymentId), [4, 1]);
});

test('a late suggestion response cannot overwrite a subsequently opened bank movement', async () => {
  const { panel, state, api } = harness();
  const first = deferred<BankMatch[]>(), second = deferred<BankMatch[]>();
  state.salesOrders.set([invoice(1), invoice(2)]);
  api.suggestions = id => id === 1 ? first.promise : second.promise;
  const openingFirst = panel.openAllocation(movement(1));
  panel.closeAllocation();
  const openingSecond = panel.openAllocation(movement(2));
  second.resolve([newMatch(2)]);
  await openingSecond;
  first.resolve([newMatch(1)]);
  await openingFirst;
  assert.equal(panel.selected()?.id, 2);
  assert.equal(panel.matches()[0].salesOrderId, 2);
  assert.equal(panel.matchingLoading(), false);
});

test('an error from a closed suggestion request does not appear on the new movement', async () => {
  const { panel, state, api } = harness();
  const first = deferred<BankMatch[]>();
  state.salesOrders.set([invoice(1), invoice(2)]);
  api.suggestions = id => id === 1 ? first.promise : Promise.resolve([newMatch(2)]);
  const openingFirst = panel.openAllocation(movement(1));
  await panel.openAllocation(movement(2));
  first.reject(new Error('Old request failed'));
  await openingFirst;
  assert.equal(panel.selected()?.id, 2);
  assert.equal(panel.error(), '');
  assert.equal(panel.matches()[0].salesOrderId, 2);
});

test('a pending allocation locks the selection, closing and duplicate submission', async () => {
  const { panel, state, api, allocationCalls } = harness();
  const pending = deferred<BankStatementLine>();
  state.salesOrders.set([invoice(1), invoice(2)]);
  state.bankStatements.set([movement()]);
  api.allocate = async (id, salesOrderId, existingPaymentId) => {
    allocationCalls.push({ id, salesOrderId, existingPaymentId });
    return pending.promise;
  };
  await panel.openAllocation(movement());
  panel.chooseInvoice(1);
  panel.chooseMatch(panel.manualNewMatch()!, true);
  const saving = panel.allocate();
  assert.equal(panel.busy(), true);
  panel.chooseInvoice(2);
  panel.chooseMatch(newMatch(2));
  panel.closeAllocation();
  panel.add();
  await panel.allocate();
  assert.equal(panel.choice()?.salesOrderId, 1);
  assert.equal(panel.manualInvoice(), 1);
  assert.equal(panel.selected()?.id, 1);
  assert.equal(panel.draft(), null);
  assert.equal(allocationCalls.length, 1);
  pending.resolve({ ...movement(), salesPaymentId: 100, salesOrderId: 1, allocationCreatedPayment: true });
  await saving;
  assert.equal(panel.busy(), false);
  assert.equal(panel.selected(), null);
  assert.equal(state.bankStatements()[0].salesOrderId, 1);
});
