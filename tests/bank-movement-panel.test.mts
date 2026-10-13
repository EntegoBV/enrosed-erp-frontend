import { bankAmountsMatch, bankAmountDifference } from '../src/app/shared/bank-transaction-options.ts';
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

/* The same helper as shared/ui.ts (that file has Angular decorators, so it cannot be imported here). */
const escapeHtml = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

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
  const loads = { load: 0, refreshBank: 0 };
  const movementDraft = signal<{ accountKey?: string } | null>(null);
  const state = {
    costs: signal<any[]>([]), payments: signal<any[]>([]),
    canonicalAccount: (key: string) => bankExports.bankAccountKey!(key),
    archivedBankLine: (_row: BankStatementLine) => false,
    officialBankLine: (row: BankStatementLine) => true,
    accountOptions: () => [],
    reload: async (_sources: string[]) => {},
    salesOrders: signal<SalesOrderView[]>([]), incomingPayments: signal<IncomingPaymentRow[]>([]),
    bankStatements: signal<BankStatementLine[]>([]), customers: signal<Customer[]>([]), accounts: signal<string[]>([]),
    load: async () => { loads.load += 1; },
    // The movement form lives in FinanceState now; the panel opens it and reads whether it is open.
    movementDraft,
    openMovement: (prefill: { accountKey?: string } = {}) => { movementDraft.set({ ...prefill }); },
    refreshBank: async () => { loads.refreshBank += 1; },
  };
  const confirms: { title: string; message: string; confirmLabel?: string; danger?: boolean }[] = [];
  const ui = {
    toast: () => {},
    confirm: (options: { title: string; message: string; confirmLabel?: string; danger?: boolean }, onConfirm: () => void) => {
      confirms.push(options);
      onConfirm();
    },
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
    exports, signal, computed, bankAmountsMatch, bankAmountDifference, Component: () => (value: unknown) => value, ChangeDetectionStrategy: { OnPush: 0 },
    FormsModule: {}, RouterLink: {}, EurPipe: {}, Sheet: {}, DateField: {}, Icon: {}, SwipeActions: {}, MenuTrigger: {},
    FinanceState: tokens.state, BankingApi: tokens.api, Ui: tokens.ui,
    inject: (token: symbol) => {
      if (token === tokens.state) return state;
      if (token === tokens.api) return api;
      if (token === tokens.ui) return ui;
      throw new Error(`Unexpected service injection: ${String(token)}`);
    },
    bankAccountKey: bankExports.bankAccountKey, receiptLocalParts, receiptRequest,
    paymentLocalDay, paymentMomentLabel, crypto: globalThis.crypto, escapeHtml,
    messageOf: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
  });
  assert.ok(exports.BankMovementPanel, 'Production component class was compiled');
  const panel = new exports.BankMovementPanel();
  return { panel, state, api, allocationCalls, loads, confirms };
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

test('existing receipt fallback accepts historical account labels but respects direction and prior links', async () => {
  const { panel, state } = harness();
  state.salesOrders.set([invoice(1)]);
  state.incomingPayments.set([
    receipt(1, 1, 50, ' kbc '), receipt(2, 1, -50), receipt(3, 1, 50, 'ING'),
    receipt(4, 1, 50, null), receipt(5, 1), receipt(6, 1, 51),
  ]);
  state.bankStatements.set([{ ...movement(2), salesPaymentId: 5 }]);
  await panel.openAllocation(movement());
  panel.chooseInvoice(1);
  assert.deepEqual(Array.from(panel.manualMatches(), match => match.existingPaymentId), [4, 3, 1]);
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

test('adding a movement opens the shared form with the account filter and closes the allocation', async () => {
  const { panel, state } = harness();
  state.salesOrders.set([invoice(1)]);
  await panel.openAllocation(movement());
  panel.accountFilter.set('KBC');
  panel.add();
  assert.equal(panel.selected(), null, 'the allocation closes first');
  assert.deepEqual(state.movementDraft(), { accountKey: 'KBC' });
  assert.deepEqual(panel.draft(), { accountKey: 'KBC' }, 'the panel reads the form from the state');
  state.movementDraft.set(null);
  panel.accountFilter.set('');
  panel.add();
  assert.deepEqual(state.movementDraft(), { accountKey: undefined });
});

test('adding while busy does nothing', async () => {
  const { panel, state, api } = harness();
  const pending = deferred<BankStatementLine>();
  state.salesOrders.set([invoice(1)]);
  state.bankStatements.set([movement()]);
  api.allocate = async () => pending.promise;
  await panel.openAllocation(movement());
  panel.chooseInvoice(1);
  panel.chooseMatch(panel.manualNewMatch()!, true);
  const saving = panel.allocate();
  panel.add();
  assert.equal(state.movementDraft(), null);
  pending.resolve({ ...movement(), salesPaymentId: 7, salesOrderId: 1 });
  await saving;
});

test('allocating refreshes only the bank sources and keeps every filter', async () => {
  const { panel, state, loads } = harness();
  state.salesOrders.set([invoice(1)]);
  state.bankStatements.set([movement()]);
  panel.search.set('partner');
  panel.accountFilter.set('KBC');
  panel.directionFilter.set('INCOMING');
  panel.linkFilter.set('UNLINKED_IN');
  await panel.openAllocation(movement());
  panel.chooseInvoice(1);
  panel.chooseMatch(panel.manualNewMatch()!, true);
  await panel.allocate();
  assert.deepEqual(loads, { load: 0, refreshBank: 1 });
  assert.deepEqual([panel.search(), panel.accountFilter(), panel.directionFilter(), panel.linkFilter()], ['partner', 'KBC', 'INCOMING', 'UNLINKED_IN']);
});

test('the withdraw confirmation escapes what was typed and shows the amount in euro', () => {
  const { panel, api, confirms, loads } = harness();
  const deleted: number[] = [];
  (api as unknown as { delete: (id: number) => Promise<void> }).delete = async (id) => { deleted.push(id); };
  panel.remove({ ...movement(3, -1250.5), counterparty: '<b>Leverancier & Co</b>', reference: 'Factuur "7"' });
  assert.equal(confirms.length, 1);
  assert.equal(confirms[0].title, 'Bankbeweging intrekken');
  assert.match(confirms[0].message, /&lt;b&gt;Leverancier &amp; Co&lt;\/b&gt;/);
  assert.match(confirms[0].message, /Factuur &quot;7&quot;/);
  assert.ok(confirms[0].message.includes('€ -1.250,50'), confirms[0].message);
  assert.doesNotMatch(confirms[0].message, /<b>/);
  assert.equal(confirms[0].danger, true);
  assert.deepEqual(deleted, [3]);
  return Promise.resolve().then(() => new Promise((done) => setTimeout(done, 0))).then(() => assert.equal(loads.refreshBank, 1));
});

test('"Te koppelen" includes incoming and outgoing bank rows without saved allocations', () => {
  const { panel, state } = harness();
  state.bankStatements.set([movement(1, 50), { ...movement(2, 40), salesPaymentId: 9 }, movement(3, -30), { ...movement(4, -20), salesPaymentId: 8 }]);
  panel.linkFilter.set('UNLINKED_IN');
  assert.deepEqual(Array.from(panel.filteredLines(), (line) => line.id), [3, 1]);
  panel.linkFilter.set('UNLINKED');
  assert.deepEqual(Array.from(panel.filteredLines(), (line) => line.id).sort(), [1, 3]);
});

test('an Odoo transaction cannot be withdrawn directly or with the Delete shortcut', () => {
  const { panel, state, confirms } = harness();
  const row: BankStatementLine = { ...movement(91, -125), source: 'ODOO', sourceId: 'odoo:91' };
  state.bankStatements.set([row]);
  panel.focusId.set(row.id);
  assert.equal(panel.canRemove(row), false);
  panel.remove(row);
  assert.equal(panel.handle('delete'), false);
  assert.equal(confirms.length, 0, 'No destructive confirmation is offered for imported bank facts');
  assert.equal(state.bankStatements().length, 1);
});

test('Odoo dates never display the synthetic midnight as an actual bank booking time', () => {
  const { panel } = harness();
  const row: BankStatementLine = { ...movement(91, -125), source: 'ODOO', bookedAt: '2026-09-07T22:00:00Z' };
  assert.equal(panel.movementStamp(row), '08/09/2026');
  assert.equal(panel.clock(row), 'Tijdstip niet beschikbaar');
  assert.match(panel.record(row), /boekingsdatum, zonder tijdstip/);
  assert.equal(panel.movementStamp(movement()), panel.stamp(movement().bookedAt, movement().timeZone));
});

test('a movement allocated to a cost stays linked in filters and cannot receive a second allocation', async () => {
  const { panel, state, confirms } = harness();
  const linked: BankStatementLine = { ...movement(92, -125), allocated: true, allocationLabel: 'Bedrijfskost' };
  state.bankStatements.set([linked, movement(93, -20)]);
  panel.linkFilter.set('UNLINKED');
  assert.deepEqual(Array.from(panel.filteredLines(), row => row.id), [93]);
  panel.linkFilter.set('LINKED');
  assert.deepEqual(Array.from(panel.filteredLines(), row => row.id), [92]);
  await panel.openAllocation(linked);
  assert.equal(panel.selected(), null);
  panel.remove(linked);
  assert.equal(confirms.length, 0);
});

test('unlinking an outgoing cost payment preserves the bank movement and uses the payment-link endpoint', async () => {
  const { panel, state, api, loads, confirms } = harness();
  const linked: BankStatementLine = { ...movement(94, -125), source: 'ODOO', allocated: true, allocationLabel: 'Bedrijfskost' };
  state.bankStatements.set([linked]);
  const unlinked: number[] = [];
  const refreshed: string[][] = [];
  (api as unknown as { unlinkPayments(id: number): Promise<void> }).unlinkPayments = async id => { unlinked.push(id); };
  (state as unknown as { reload(sources: string[]): Promise<void> }).reload = async sources => { refreshed.push(sources); };
  panel.unlink(linked);
  await new Promise(done => setTimeout(done, 0));
  assert.deepEqual(unlinked, [94]);
  assert.equal(state.bankStatements().length, 1);
  assert.equal(loads.refreshBank, 1);
  assert.deepEqual(refreshed.map(sources => Array.from(sources)), [['costs', 'payments']]);
  assert.match(confirms[0].message, /betaling op je uitgave blijft bewaard/);
});

test('a credit note with an open tegoed is offered for an outgoing line only, and a verrekening row never matches', async () => {
  const creditNote = { order: { id: 55, number: 'CN-2026-0002', status: 'UITGEREIKT', docType: 'CREDITNOTA', customerId: 1 },
    priced: { totals: { totalInclVat: 220.2 } }, paymentSummary: { invoiceTotalEur: -220.2, remainingEur: 0, refundableEur: 220.2, payments: [] } } as unknown as SalesOrderView;
  const outgoing = harness();
  outgoing.state.salesOrders.set([invoice(1, 100, 100, 0), creditNote]);
  outgoing.state.incomingPayments.set([{ ...receipt(12, 55, -120.2), offsetOrderId: 1, offsetPaymentId: 13 } as IncomingPaymentRow]);
  outgoing.state.bankStatements.set([movement(1, -220.2)]);
  await outgoing.panel.openAllocation(movement(1, -220.2));
  assert.deepEqual(outgoing.panel.selectableInvoices().map(view => view.order.id), [55], 'money out: only the credit note has enough tegoed');
  assert.equal(outgoing.panel.isCreditNote(55), true);
  assert.equal(outgoing.panel.existingMatches().length, 0, 'the verrekening row is no bank movement');
  outgoing.panel.chooseInvoice(55);
  outgoing.panel.chooseMatch(outgoing.panel.manualNewMatch()!, true);
  await outgoing.panel.allocate();
  assert.deepEqual(outgoing.allocationCalls, [{ id: 1, salesOrderId: 55, existingPaymentId: null }]);
  const incoming = harness();
  incoming.state.salesOrders.set([invoice(1, 100, 100, 0), creditNote]);
  incoming.state.bankStatements.set([movement(2, 50)]);
  await incoming.panel.openAllocation(movement(2, 50));
  assert.deepEqual(incoming.panel.selectableInvoices().map(view => view.order.id), [1], 'money in never lands on a credit note');
});

test('existing outgoing parts link by their exact summed cents without creating any payment', async () => {
  const { panel, state, api } = harness();
  const bank = { ...movement(70, -100.03), source: 'ODOO' as const };
  state.bankStatements.set([bank]);
  state.costs.set([{ id: 11, party: 'Transport', description: 'Kost', payments: [{ id: 12, paidOn: '2026-09-08', amountEur: 20.01, bankStatementLineId: null }] }]);
  state.payments.set([{ id: 21, orderId: 3, orderNumber: 'PO-3', label: 'Goederen', amountEur: 60.01, paidOn: '2026-09-08' }, { id: 22, orderId: 3, orderNumber: 'PO-3', label: 'Zeevracht', amountEur: 20.01, paidOn: '2026-09-08' }]);
  const calls: any[] = [];
  (api as any).linkPayments = async (id: number, body: any) => { calls.push({ id, ...body }); return { ...bank, allocated: true }; };
  await panel.openAllocation(bank);
  assert.equal(panel.allocationMode(), 'expense');
  for (const choice of panel.outgoingCandidates()) panel.toggleOutgoing(choice);
  assert.equal(panel.outgoingTotal(), 100.03); assert.equal(panel.canLinkOutgoing(), true);
  await panel.linkOutgoing();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ id: 70, purchasePaymentIds: [21, 22], costPaymentId: 12 }]);
  assert.equal(state.bankStatements()[0].allocated, true); assert.equal(panel.selected(), null);
});

test('outgoing matching rejects mismatches and a candidate linked elsewhere after selection', async () => {
  const { panel, state } = harness();
  state.payments.set([{ id: 21, orderId: 3, amountEur: 10, paidOn: '2026-09-08' }]);
  await panel.openAllocation(movement(70, -11));
  panel.toggleOutgoing(panel.outgoingCandidates()[0]); assert.equal(panel.canLinkOutgoing(), false);
  panel.selected.set(movement(70, -10)); assert.equal(panel.canLinkOutgoing(), true);
  state.payments.set([{ id: 21, orderId: 3, amountEur: 10, paidOn: '2026-09-08', bankStatementLineId: 99 }]);
  assert.equal(panel.canLinkOutgoing(), false);
});

test('revealing historical manual rows keeps them outside bank movement totals', () => {
  const { panel, state } = harness();
  state.officialBankLine = (row: BankStatementLine) => row.source === 'ODOO';
  state.bankStatements.set([{ ...movement(1, 50), source: 'ODOO' }, movement(2, 50)]);
  assert.equal(panel.filteredLines().length, 1); assert.equal(panel.historicalCount(), 1);
  panel.showHistorical.set(true); assert.equal(panel.filteredLines().length, 2);
  assert.equal(panel.totals().incoming, 50);
});


function receivedDocument(id = 10, extra: any = {}): any {
  return { id, name: `BILL/${id}`, reference: `SUP-${id}`, partner: 'Leverancier', date: '2026-10-01', moveType: 'in_invoice', state: 'draft', currency: 'EUR', total: 100,
    peppolState: 'done', peppolMessageId: null, attachments: [{ id: 99, name: 'invoice.xml', kind: 'XML' }], registered: false, companyCostId: null, eligible: true, unavailableReason: null, ...extra };
}
function receivedPreview(document = receivedDocument(), extra: any = {}): any {
  return { document, snapshotHash: `snapshot-${document.id}`, invoiceTotalEur: 100, netEur: 82.64, vatEur: 17.36, paymentAmountEur: 100, differenceEur: -0.02, supplierCountry: 'BE', companyCostId: null, existingCandidates: [], eligible: true, unavailableReason: null, ...extra };
}

test('received document pagination keeps identity, searches supplier/reference and reports Peppol only with evidence', async () => {
  const { panel, api } = harness(); await panel.openAllocation(movement(1, -100.02));
  const cursors: number[] = [];
  (api as any).receivedOdooInvoices = async (_id: number, cursor: number) => { cursors.push(cursor); return cursor === 0
    ? { documents: [receivedDocument(20)], nextAfterId: 20, hasMore: true }
    : { documents: [receivedDocument(20), receivedDocument(19, { peppolState: null })], nextAfterId: null, hasMore: false }; };
  await panel.loadReceivedInvoices(); await panel.loadReceivedInvoices(true);
  assert.deepEqual(cursors, [0, 20]); assert.deepEqual(Array.from(panel.receivedInvoices(), d => d.id), [20, 19]);
  panel.receivedSearch.set('leverancier SUP-19'); assert.equal(panel.visibleReceivedInvoices()[0].id, 19);
  assert.equal(panel.receivedSource(receivedDocument()), 'Ontvangen via Peppol');
  assert.equal(panel.receivedSource(receivedDocument(19, { peppolState: 'draft', peppolMessageId: null })), 'Odoo');
  assert.equal(panel.receivedHasMore(), false);
});

test('late received previews and document loads cannot overwrite a newer selection or another bank transaction', async () => {
  const { panel, api } = harness(); await panel.openAllocation(movement(1, -100.02));
  const first = deferred<any>(), second = deferred<any>();
  (api as any).previewReceivedOdooInvoice = (_id: number, invoiceId: number) => invoiceId === 10 ? first.promise : second.promise;
  const one = panel.selectReceivedInvoice(receivedDocument(10)), two = panel.selectReceivedInvoice(receivedDocument(11));
  second.resolve(receivedPreview(receivedDocument(11))); await two;
  first.resolve(receivedPreview(receivedDocument(10))); await one;
  assert.equal(panel.receivedPreview()!.document.id, 11);
  const list = deferred<any>(); (api as any).receivedOdooInvoices = () => list.promise;
  const loading = panel.loadReceivedInvoices(); await panel.openAllocation(movement(2, 100));
  list.resolve({ documents: [receivedDocument()], hasMore: false }); await loading;
  assert.equal(panel.receivedInvoices().length, 0); assert.equal(panel.receivedPreview(), null);
});

test('received source registration requires a chosen existing candidate and retries the same snapshot without creating another cost', async () => {
  const { panel, api, state } = harness(); const bank = movement(1, -100.02); state.bankStatements.set([bank]); await panel.openAllocation(bank);
  const preview = receivedPreview(receivedDocument(), { existingCandidates: [{ id: 77, description: 'Bestaande factuur', totalEur: 100, openEur: 0 }] });
  (api as any).previewReceivedOdooInvoice = async () => preview;
  await panel.selectReceivedInvoice(preview.document); assert.equal(panel.canLinkReceived(), false);
  panel.receivedExistingCostId.set(999); assert.equal(panel.canLinkReceived(), false);
  panel.receivedExistingCostId.set(77); assert.equal(panel.canLinkReceived(), true);
  const writes: any[] = []; let first = true;
  (api as any).linkReceivedOdooInvoice = async (id: number, body: any) => { writes.push({ id, ...body }); if (first) { first = false; throw new Error('Response verloren'); }
    return { line: { ...bank, allocated: true, allocationDifferenceEur: -0.02 }, companyCostId: 77, alreadyRegistered: true, documentsSaved: 1 }; };
  await panel.linkReceivedInvoice(); assert.equal(panel.selected()!.id, 1); assert.match(panel.error(), /Response verloren/);
  await panel.linkReceivedInvoice(); await panel.linkReceivedInvoice();
  assert.equal(writes.length, 2); assert.deepEqual(writes[0], writes[1]); assert.equal(writes[0].existingCompanyCostId, 77);
  assert.equal(state.bankStatements()[0].amountEur, -100.02); assert.equal(state.bankStatements()[0].allocationDifferenceEur, -0.02); assert.equal(panel.selected(), null);
});

test('supplier credit notes match bank receipts and two-cent difference, never opposite signs or three cents', async () => {
  const { panel } = harness(); await panel.openAllocation(movement(1, 95.58));
  const doc = receivedDocument(10, { moveType: 'in_refund', total: 95.6 });
  panel.receivedPreview.set(receivedPreview(doc, { invoiceTotalEur: -95.6, netEur: -79.01, vatEur: -16.59, paymentAmountEur: -95.6, differenceEur: -0.02 }));
  assert.equal(panel.canLinkReceived(), true);
  panel.receivedPreview.update(p => ({ ...p!, paymentAmountEur: 95.6 })); assert.equal(panel.canLinkReceived(), false);
  panel.receivedPreview.update(p => ({ ...p!, paymentAmountEur: -95.61, differenceEur: -0.03 })); assert.equal(panel.canLinkReceived(), false);
});

test('existing supplier refund candidates are signed and match with a two-cent difference', async () => {
  const { panel, state } = harness(); state.costs.set([{ id: 5, description: 'Credit leverancier', payments: [{ id: 8, amountEur: -95.6, bankStatementLineId: null, paidOn: '2026-10-01' }] }]);
  await panel.openAllocation(movement(1, 95.58)); panel.toggleOutgoing(panel.outgoingCandidates()[0]);
  assert.equal(panel.canLinkOutgoing(), true); assert.equal(panel.outgoingDifference(), -0.02);
  panel.selected.set(movement(1, 95.57)); assert.equal(panel.canLinkOutgoing(), false);
});


test('choosing an existing source candidate refreshes its actual payment amount before enabling submit', async () => {
  const { panel, api } = harness(); await panel.openAllocation(movement(1, -100.02));
  const base = receivedPreview(receivedDocument(), { existingCandidates: [{ id: 77, description: 'Bestaande kost', totalEur: 100, openEur: 0 }] });
  panel.receivedPreview.set(base); const pending = deferred<any>(); const requests: any[] = [];
  (api as any).previewReceivedOdooInvoice = (_line: number, _invoice: number, costId?: number) => { requests.push(costId); return pending.promise; };
  panel.selectReceivedCost(77); assert.equal(panel.receivedPreviewLoading(), true); assert.equal(panel.canLinkReceived(), false);
  pending.resolve({ ...base, paymentAmountEur: 100.01, differenceEur: -0.01 });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests, [77]); assert.equal(panel.receivedExistingCostId(), 77); assert.equal(panel.receivedPreview()!.differenceEur, -0.01); assert.equal(panel.canLinkReceived(), true);
});

test('received picker uses the supplier-document direction and actual currency, and a failed load remains retryable', async () => {
  const { panel, api } = harness(); await panel.openAllocation(movement(1, 95.58));
  panel.receivedInvoices.set([receivedDocument(1), receivedDocument(2, { moveType: 'in_refund', currency: 'USD' })]);
  assert.deepEqual(Array.from(panel.visibleReceivedInvoices(), d => d.id), [2]); assert.match(panel.receivedAmount(panel.visibleReceivedInvoices()[0]), /US\$|USD/);
  (api as any).receivedOdooInvoices = async () => { throw new Error('Odoo offline'); };
  await panel.loadReceivedInvoices(); assert.equal(panel.receivedLoading(), false); assert.equal(panel.receivedLoaded(), false); assert.match(panel.receivedError(), /offline/);
  (api as any).receivedOdooInvoices = async () => ({ documents: [], hasMore: false }); await panel.loadReceivedInvoices();
  assert.equal(panel.receivedLoaded(), true); assert.equal(panel.receivedError(), '');
});
