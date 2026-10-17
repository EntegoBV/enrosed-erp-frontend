import { lineMarkers } from '../src/app/features/finance/bank-markers.ts';
import { bankSearchMatches, legDistance, lineStatus, selectionTotals, vatPeriodLabel } from '../src/app/features/finance/bank-suggestions.ts';
import { CLASSIFICATION_LABEL } from '../src/app/features/finance/cash-forecast.ts';
import { bankAllocationTargets, filterBankAllocationTargets } from '../src/app/features/finance/bank-allocation-targets.ts';
import { cashTotalOf, openOf } from '../src/app/features/finance/finance-metrics.ts';
import { containerPayables } from '../src/app/features/finance/payables.ts';
import { amountInputText, parsePurchasePaymentAmount } from '../src/app/features/purchasing/purchase-payment-amount.ts';
import { inspectionRestOffered, invoiceLine, invoiceTermsLine, paymentRoundOnServer } from '../src/app/features/purchasing/purchase-invoices.ts';
import { splitTransfer } from '../src/app/features/purchasing/purchase-transfer-split.ts';
import {
  adjustConsequence, carveForeignText, carveText, foreignLinkWarning, linkChange, linkNotice, pendingLinkPlan, surplusQuestion, transferCompanions,
} from '../src/app/features/purchasing/purchase-payment-links.ts';
import { bankTransactionDay } from '../src/app/shared/bank-transaction-options.ts';
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
import { bankTextOf } from '../src/app/features/finance/bank-text.ts';
import { signedEur as signedMoney } from '../src/app/features/finance/finance-format.ts';
import { containerName, containerNumberHint } from '../src/app/features/purchasing/container-name.ts';
import { paymentPayeeLabel } from '../src/app/features/finance/cost-ledger.ts';
import { incomingPurposeLabel } from '../src/app/features/finance/incoming-money.ts';

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
  const opened: { kind: string; id: number }[] = [];
  const menus: any[] = [];
  const toasts: string[] = [];
  const movementDraft = signal<{ accountKey?: string } | null>(null);
  const state = {
    costs: signal<any[]>([]), payments: signal<any[]>([]), purchaseViews: signal<any[]>([]),
    inspectItem: (target: { kind: string; id: number }) => opened.push({ ...target }),
    openInvoice: (id: number) => opened.push({ kind: 'invoice', id }),
    openMenu: (menu: any) => menus.push(menu),
    lineMarkers: () => lineMarkers(state.bankStatements()),
    canonicalAccount: (key: string) => bankExports.bankAccountKey!(key),
    archivedBankLine: (_row: BankStatementLine) => false,
    officialBankLine: (row: BankStatementLine) => true,
    accountOptions: () => [],
    reload: async (_sources: readonly string[]) => {}, sourceErrors: (_sources: readonly string[]) => [] as string[],
    salesOrders: signal<SalesOrderView[]>([]), incomingPayments: signal<IncomingPaymentRow[]>([]),
    bankStatements: signal<BankStatementLine[]>([]), customers: signal<Customer[]>([]), accounts: signal<string[]>([]),
    load: async () => { loads.load += 1; },
    // The movement form lives in FinanceState now; the panel opens it and reads whether it is open.
    movementDraft,
    openMovement: (prefill: { accountKey?: string } = {}) => { movementDraft.set({ ...prefill }); },
    refreshBank: async () => { loads.refreshBank += 1; },
    // Transacties (2026-10-16): the row's suggestion, saldo and day end, the detail's address and the sheets it opens.
    suggestions: () => new Map(), running: () => new Map(), dayEndEur: () => null as number | null,
    lineDay: (row: BankStatementLine) => paymentLocalDay({ receivedAt: row.bookedAt, timeZone: row.timeZone }),
    openLine: (id: number) => opened.push({ kind: 'line', id }), location: () => ({ line: null as number | null, link: '' }),
    unbanked: () => [], pendingReceipts: () => [], searchedFrom: signal<string | null>(null), linking: signal<number | null>(null),
    bookAsLine: signal<BankStatementLine | null>(null), attachmentsFor: () => [], unlinkLine: (_row: BankStatementLine) => {}, unclassifyLine: async (_row: BankStatementLine) => {},
    linkLine: async () => '', accountLabel: (key: string) => key,
    today: () => '2026-10-16', accountsView: () => [] as { account: string }[],
    showHistorical: signal(false), flashLine: signal<number | null>(null),
    inspect: signal<{ kind: string; id: number } | null>(null), closeInspector: () => { state.inspect.set(null); },
  };
  const confirms: { title: string; message: string; confirmLabel?: string; danger?: boolean }[] = [];
  const ui = {
    toast: (message: string, tone?: string) => { toasts.push(tone === 'err' ? `err: ${message}` : message); },
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
  const sourcing = { suppliers: async () => [], documents: async (_id: number) => [] };
  const tokens = { state: Symbol('FinanceState'), api: Symbol('BankingApi'), ui: Symbol('Ui'), sourcing: Symbol('SourcingApi') };
  const exports: { BankMovementPanel?: new () => BankMovementPanel } = {};
  vm.runInNewContext(componentCode, {
    exports, signal, computed, input: <T>(value: T) => () => value, bankSearchMatches, lineStatus, selectionTotals, legDistance, vatPeriodLabel, CLASSIFICATION_LABEL, bankAmountsMatch, bankAmountDifference, bankAllocationTargets, filterBankAllocationTargets, cashTotalOf, openOf, containerPayables, parsePurchasePaymentAmount, bankTransactionDay, Component: () => (value: unknown) => value, ChangeDetectionStrategy: { OnPush: 0 },
    invoiceLine, invoiceTermsLine, paymentRoundOnServer, splitTransfer, linkChange, linkNotice, surplusQuestion,
    inspectionRestOffered, carveForeignText, carveText, foreignLinkWarning, pendingLinkPlan, transferCompanions, adjustConsequence, amountInputText,
    FormsModule: {}, RouterLink: {}, EurPipe: {}, Sheet: {}, DateField: {}, Icon: {}, SwipeActions: {}, MenuTrigger: {},
    FinanceState: tokens.state, BankingApi: tokens.api, Ui: tokens.ui, SourcingApi: tokens.sourcing, saveBlob: () => {},
    inject: (token: symbol) => {
      if (token === tokens.state) return state;
      if (token === tokens.sourcing) return sourcing;
      if (token === tokens.api) return api;
      if (token === tokens.ui) return ui;
      throw new Error(`Unexpected service injection: ${String(token)}`);
    },
    bankAccountKey: bankExports.bankAccountKey, receiptLocalParts, receiptRequest,
    paymentLocalDay, paymentMomentLabel, bankTextOf, signedMoney, containerName, containerNumberHint, paymentPayeeLabel, incomingPurposeLabel, crypto: globalThis.crypto, escapeHtml, document: { querySelector: () => null },
    messageOf: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
  });
  assert.ok(exports.BankMovementPanel, 'Production component class was compiled');
  const panel = new exports.BankMovementPanel();
  return { panel, state, api, sourcing, allocationCalls, loads, confirms, opened, menus, toasts };
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
  assert.equal(confirms[0].title, 'Transactie intrekken', 'one name for the manual line (spec §3.4)');
  assert.match(confirms[0].message, /&lt;b&gt;Leverancier &amp; Co&lt;\/b&gt;/);
  assert.match(confirms[0].message, /Factuur &quot;7&quot;/);
  assert.ok(confirms[0].message.includes('€ -1.250,50'), confirms[0].message);
  assert.doesNotMatch(confirms[0].message, /<b>/);
  assert.equal(confirms[0].danger, true);
  assert.deepEqual(deleted, [3]);
  return Promise.resolve().then(() => new Promise((done) => setTimeout(done, 0))).then(() => assert.equal(loads.refreshBank, 1));
});

test('Intrekken from the phone sheet\'s ⋯: a failure is a toast, a success closes the detail of that line', async () => {
  // Review 2026-10-17: the sheet's ⋯ ran remove() on a panel whose error() nobody showed, and the sheet came back on a deleted line.
  const { panel, api, state, toasts, loads } = harness();
  const settle = () => new Promise((done) => setTimeout(done, 0));
  const manual = movement(7, -80);
  state.bankStatements.set([manual, movement(8, -20)]);
  state.inspect.set({ kind: 'line', id: 7 });
  (api as unknown as { delete: (id: number) => Promise<void> }).delete = async () => { throw new Error('Deze transactie is al gekoppeld.'); };
  panel.remove(manual); await settle();
  assert.deepEqual(toasts, ['err: Deze transactie is al gekoppeld.']);
  assert.deepEqual(state.inspect(), { kind: 'line', id: 7 }, 'a failed withdrawal keeps the line open');
  assert.equal(state.bankStatements().length, 2);
  (api as unknown as { delete: (id: number) => Promise<void> }).delete = async () => {};
  panel.remove(manual); await settle();
  assert.equal(state.inspect(), null, 'the withdrawn line no longer holds the sheet');
  assert.deepEqual(Array.from(state.bankStatements(), (line) => line.id), [8]);
  assert.equal(loads.refreshBank, 1);
  state.inspect.set({ kind: 'line', id: 8 });
  state.bankStatements.set([movement(8, -20), movement(9, -5)]);
  panel.remove(movement(9, -5)); await settle();
  assert.deepEqual(state.inspect(), { kind: 'line', id: 8 }, 'another open line stays');
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
  state.showHistorical.set(true); assert.equal(panel.filteredLines().length, 2, 'the state holds the switch (toolbar ⋯, phone ⋯, bar chip)');
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


function localCost(id = 1, gross = 100, open = gross, payments: any[] = []): any {
  return { id, description: 'Drukwerk', party: 'Drukkerij', date: '2026-10-01', reference: 'PRINT-2026-01', amountExclEur: gross, amountInclEur: gross,
    vatPct: 0, vatRegime: null, paidOn: open ? null : '2026-10-02', openEur: open, paidEur: gross - open, payments };
}
function purchaseView(): any {
  return { order: { id: 20, number: 'PO-20', alias: 'Zomerrozen', status: 'BESTELD' }, reconciliation: { streams: [{ payee: 'SUPPLIER', status: 'UNPAID', plannedEur: 1200, remainingEur: 1200, paidEur: 0, finalized: false }],
    supplierInstalments: [{ due: 'ORDERED', label: 'Voorschot', plannedEur: 1200, remainingEur: 1200, paidEur: 0, finalized: false }] } };
}

test('local ordinary cost is the primary path and a partial bank debit pays only that part without a new bank movement', async () => {
  const { panel, state, api } = harness(); state.costs.set([localCost()]); const bank = movement(7, -40); await panel.openAllocation(bank);
  assert.equal(panel.allocationStep(), 'documents'); panel.chooseLocalDocument(panel.localDocuments()[0]);
  assert.equal(panel.localPreview()!.paymentEur, -40); assert.equal(panel.localPreview()!.remainingEur, 60); assert.equal(panel.canLinkLocal(), true);
  const calls: any[] = []; (api as any).addCostPayment = async (...args: any[]) => { calls.push(args); return { ...bank, allocated: true }; };
  await panel.linkLocalDocument(); assert.deepEqual(calls, [[7, 1, false]]); assert.equal(state.bankStatements()[0].amountEur, -40); assert.equal(panel.selected(), null);
});

test('local cost full settlement keeps original amount at two cents, blocks overpay at three and supports signed supplier refunds', async () => {
  for (const sign of [1, -1]) {
    const { panel, state } = harness(); state.costs.set([localCost(1, sign * 100)]); await panel.openAllocation(movement(1, -sign * 100.02));
    panel.chooseLocalDocument(panel.localDocuments()[0]); assert.equal(panel.canLinkLocal(), true);
    assert.equal(panel.localPreview()!.paymentEur, -sign * 100); assert.equal(panel.localPreview()!.differenceEur, -sign * 0.02);
    panel.selected.set(movement(1, -sign * 100.03)); assert.equal(panel.canLinkLocal(), false);
  }
});

test('possible existing cost payment needs explicit reuse or new-payment confirmation and failed response retries the same pair', async () => {
  const { panel, state, api } = harness(); state.costs.set([localCost(1, 140, 100, [{ id: 9, amountEur: 40, paidOn: '2026-10-01', bankStatementLineId: null }])]);
  const bank = movement(7, -40); await panel.openAllocation(bank); panel.chooseLocalDocument(panel.localDocuments()[0]);
  assert.equal(panel.localExistingPayments().length, 1); assert.equal(panel.localPossibleDuplicate(), true); assert.equal(panel.canLinkLocal(), false);
  panel.reuseLocalPayment(panel.localExistingPayments()[0]); assert.equal(panel.allocationStep(), 'payments'); assert.equal(panel.canLinkOutgoing(), true);
  panel.setAllocationStep('documents'); panel.localNewConfirmed.set(true); assert.equal(panel.canLinkLocal(), true);
  const calls: any[] = []; (api as any).addCostPayment = async (...args: any[]) => { calls.push(args); if (calls.length === 1) throw new Error('Response verloren'); return { ...bank, allocated: true }; };
  await panel.linkLocalDocument(); assert.equal(panel.selected()!.id, 7); await panel.linkLocalDocument();
  assert.deepEqual(calls, [[7, 1, true], [7, 1, true]]);
});

test('fully paid local document is visible for reusing its payment and never creates an additional payment', async () => {
  const { panel, state } = harness(); state.costs.set([localCost(1, 40, 0, [{ id: 9, amountEur: 40, paidOn: '2026-10-01', bankStatementLineId: null }])]);
  await panel.openAllocation(movement(7, -40)); panel.chooseLocalDocument(panel.localDocuments()[0]);
  assert.equal(panel.localPreview()!.eligible, false); assert.equal(panel.localExistingPayments().length, 1); panel.localNewConfirmed.set(true); assert.equal(panel.canLinkLocal(), false);
});

test('purchase term keeps expected budget distinct from entered original currency and authoritative bank EUR', async () => {
  const { panel, state, api } = harness(); state.purchaseViews.set([purchaseView()]); const bank = movement(7, -800);
  await panel.openAllocation(bank); panel.chooseLocalDocument(panel.localDocuments()[0]); assert.equal(panel.localDocument()!.estimated, true);
  panel.changePurchaseCurrency('USD'); assert.equal(panel.purchaseAmountInput(), ''); assert.equal(panel.canLinkLocal(), false);
  panel.purchaseAmountInput.set('1.000,00'); assert.equal(panel.canLinkLocal(), true); assert.equal(panel.localPreview()!.remainingEur, 400);
  const calls: any[] = []; (api as any).addPurchasePayment = async (...args: any[]) => { calls.push(args); return { line: { ...bank, allocated: true }, payments: [] }; };
  await panel.linkLocalDocument(); const body = calls[0][2][0];
  assert.equal(body.amount, 1000); assert.equal(body.currency, 'USD'); assert.equal(body.amountEur, 800); assert.equal(body.payee, 'SUPPLIER'); assert.equal(body.instalmentDue, 'ORDERED'); assert.equal(body.settles, false);
});

test('failed source refresh blocks local allocation even when FinanceState reload resolves with cached data', async () => {
  const { panel, state } = harness(); state.costs.set([localCost()]);
  state.sourceErrors = () => ['Kosten: laden mislukt'];
  await panel.openAllocation(movement(7, -40)); panel.chooseLocalDocument(panel.localDocuments()[0]);
  assert.equal(panel.localLoading(), false); assert.match(panel.localError(), /Kosten/); assert.equal(panel.canLinkLocal(), false);
  state.sourceErrors = () => []; await panel.loadLocalDocuments(); assert.equal(panel.canLinkLocal(), true);
});

test('account context scopes unmatched/history counts and survives resetting the movement filters', () => {
  const { panel, state } = harness(); const own = movement(1, -40), other = { ...movement(2, 50), account: 'OTHER' }, history = { ...movement(3, -40), source: null };
  state.bankStatements.set([own, other, history]); state.officialBankLine = line => line.id !== 3;
  panel.accountFilter.set('KBC'); panel.search.set('test'); panel.directionFilter.set('OUTGOING');
  assert.equal(panel.unlinkedCount(), 1); assert.equal(panel.historicalCount(), 1);
  panel.clearFilters(); assert.equal(panel.accountFilter(), 'KBC'); assert.equal(panel.search(), ''); assert.equal(panel.hasFilters(), false);
});


test('real allSettled finance refresh failures disable cached local targets until successful scoped retry', async () => {
  const code = await readFile(new URL('../src/app/features/finance/finance-state.ts', import.meta.url), 'utf8');
  const parsed = ts.createSourceFile('finance-state.ts', code, ts.ScriptTarget.Latest, true);
  const cls = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'FinanceState')!;
  const names = ['reload', 'sourceErrors']; const members = cls.members.filter(member => member.name && names.includes(member.name.getText(parsed))); assert.equal(members.length, 2);
  const isolated = ts.factory.updateClassDeclaration(cls, cls.modifiers?.filter(m => !ts.isDecorator(m)), cls.name, undefined, undefined, members);
  const js = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: any = {}; vm.runInNewContext(js, { exports, SOURCE_NAMES: { costs: 'Kosten' }, messageOf: (error: any) => error.message });
  const real = new exports.FinanceState(); let failing = true;
  Object.assign(real, { requests: { costs: 0, orders: 0, payments: 0, containers: 0, incoming: 0, statements: 0 }, errorMap: signal({}), apply: () => {}, fetch: async (name: string) => { if (name === 'costs' && failing) throw new Error('Offline'); return []; } });
  const { panel, state } = harness(); state.costs.set([localCost()]); state.reload = sources => real.reload(sources); state.sourceErrors = sources => real.sourceErrors(sources);
  await panel.openAllocation(movement(7, -40)); await panel.loadLocalDocuments(); panel.chooseLocalDocument(panel.localDocuments()[0]);
  assert.equal(panel.canLinkLocal(), false); assert.match(panel.localError(), /Kosten: Offline/);
  failing = false; await panel.loadLocalDocuments(); assert.equal(panel.localError(), ''); assert.equal(panel.canLinkLocal(), true);
});

test('purchase lookup searches the actual supplier name and late invoice-file responses cannot replace another order', async () => {
  const { panel, state, sourcing } = harness(); const first = purchaseView(), second = purchaseView();
  first.order.supplierId = 8; second.order = { ...second.order, id: 21, number: 'PO-21', supplierId: 9 };
  state.purchaseViews.set([first, second]); (sourcing as any).suppliers = async () => [{ id: 8, name: 'Yiwu Trading' }, { id: 9, name: 'Verhoeven' }];
  await panel.openAllocation(movement(7, -800)); await panel.loadLocalDocuments(); panel.localSearch.set('verhoeven'); assert.equal(panel.localMatches()[0].id, 21);
  const pending = deferred<any>(); (sourcing as any).documents = (id: number) => id === 20 ? pending.promise : Promise.resolve([{ id: 2, orderId: 21, kind: 'COMMERCIAL_INVOICE', originalFilename: 'INV-21.pdf' }]);
  panel.chooseLocalDocument(panel.localDocuments().find(row => row.id === 20)!); panel.chooseLocalDocument(panel.localDocuments().find(row => row.id === 21)!);
  await new Promise(resolve => setImmediate(resolve)); pending.resolve([{ id: 1, orderId: 20, kind: 'COMMERCIAL_INVOICE', originalFilename: 'INV-20.pdf' }]); await new Promise(resolve => setImmediate(resolve));
  assert.equal(panel.localPurchaseFiles()[0].id, 2);
});

test('purchase EUR entry permits two cents but rejects three and local cost handoff keeps original bank identity', async () => {
  const { panel, state } = harness(); state.purchaseViews.set([purchaseView()]); const bank = movement(7, -100);
  await panel.openAllocation(bank); panel.chooseLocalDocument(panel.localDocuments()[0]);
  panel.purchaseAmountInput.set('99,98'); assert.equal(panel.canLinkLocal(), true); assert.equal(panel.localPreview()!.differenceEur, -0.02);
  panel.purchaseAmountInput.set('99,97'); assert.equal(panel.canLinkLocal(), false);
  let handedOff: any = null; (state as any).openCostFromBank = (line: any) => { handedOff = line; };
  panel.newCostFromBank(); assert.equal(handedOff, bank); assert.equal(panel.selected(), null);
});


test('a bank row changed or allocated during local document selection blocks submission with a visible reason', async () => {
  const { panel, state } = harness(); const bank = movement(7, -40); state.costs.set([localCost()]); state.bankStatements.set([bank]);
  await panel.openAllocation(bank); panel.chooseLocalDocument(panel.localDocuments()[0]); assert.equal(panel.canLinkLocal(), true);
  state.bankStatements.set([{ ...bank, amountEur: -41 }]); assert.equal(panel.canLinkLocal(), false); assert.match(panel.localBankProblem(), /gewijzigd/);
  state.bankStatements.set([{ ...bank, allocated: true }]); assert.equal(panel.canLinkLocal(), false); assert.match(panel.localBankProblem(), /gekoppeld/);
});


test('an imported allocated cost opens directly and can be found by its invoice reference', async () => {
  const { panel, state, opened } = harness();
  const row = { ...movement(1, -121), source: 'ODOO' as const, allocated: true };
  state.bankStatements.set([row]);
  state.costs.set([{ id: 5, description: 'Office supplies', reference: 'BILL-2026-99', payments: [{ id: 7, bankStatementLineId: 1 }] }]);
  panel.search.set('BILL-2026-99');
  assert.equal(panel.filteredLines().length, 1);
  await panel.openLinked(row);
  assert.deepEqual(opened, [{ kind: 'cost', id: 5 }]);
  assert.match(panel.linkedLabel(row), /BILL-2026-99/);
});

test('purchase splits deduplicate by order and multiple orders offer every document', async () => {
  const { panel, state, opened, menus } = harness();
  const row = { ...movement(1, -200), source: 'ODOO' as const, allocated: true };
  state.bankStatements.set([row]);
  state.payments.set([{ id: 10, orderId: 20, orderNumber: 'PO-20', bankStatementLineId: 1 },
    { id: 11, orderId: 20, orderNumber: 'PO-20', bankStatementLineId: 1 },
    { id: 12, orderId: 21, orderNumber: 'PO-21', bankStatementLineId: 1 }]);
  assert.equal(panel.linkedDocuments(row).length, 2);
  await panel.openLinked(row);
  assert.equal(opened.length, 0);
  assert.equal(menus[0].items.length, 2);
  menus[0].pick('container:21');
  assert.deepEqual(opened, [{ kind: 'container', id: 21 }]);
});

test('cost and purchase share a bank line without hiding a destination', async () => {
  const { panel, state, menus } = harness();
  const row = { ...movement(1, -200), source: 'ODOO' as const, allocated: true };
  state.bankStatements.set([row]);
  state.costs.set([{ id: 5, description: 'Transport', bankStatementLineId: 1, payments: [{ id: 7, bankStatementLineId: 1 }] }]);
  state.payments.set([{ id: 10, orderId: 20, orderNumber: 'PO-20', bankStatementLineId: 1 }]);
  await panel.openLinked(row);
  assert.equal(menus[0].items.length, 2);
});

test('Enter opens the transaction (its detail); O opens the paid sales invoice or credit refund itself', async () => {
  // Reversed on purpose (spec-bank-forecast §1.1, §3.4): a row never jumps away; Enter opens line=<id>, O the linked document.
  const { panel, state, opened } = harness();
  const row = { ...movement(1, -50), allocated: true, salesOrderId: 88, salesPaymentId: 99 };
  state.bankStatements.set([row]);
  panel.focusId.set(1);
  assert.equal(panel.handle('open'), true);
  assert.deepEqual(opened, [{ kind: 'line', id: 1 }]);
  assert.equal(panel.handle('open-linked'), true);
  await new Promise((done) => setTimeout(done, 0));
  assert.deepEqual(opened, [{ kind: 'line', id: 1 }, { kind: 'invoice', id: 88 }]);
});

test('with a transaction in the detail, J / K step the detail and C / U act on the transaction shown, not on the list focus', () => {
  // Review 2026-10-16: the detail's J button moved line= but the keys still read the row clicked first.
  const { panel, state } = harness();
  const gone: any[] = []; let shown: number | null = 2;
  Object.assign(state, { location: () => ({ line: shown, link: '' }), go: (patch: any) => { gone.push(patch); shown = patch.line ?? shown; } });
  const booked: BankStatementLine[] = []; state.bookAsLine = { set: (row: BankStatementLine) => booked.push(row) } as any;
  state.bankStatements.set([movement(1, -10), movement(2, -20), movement(3, -30)]);
  panel.focusId.set(3);
  assert.deepEqual(Array.from(panel.visibleLines(), (line) => line.id), [3, 2, 1]);
  assert.equal(panel.handle('book-as'), true);
  assert.equal(booked[0].id, 2, '"Boeken als…" for the transaction in the detail');
  assert.equal(panel.handle('down'), true);
  assert.deepEqual(gone.map((patch) => patch.line), [1], 'J steps the detail from the transaction it shows');
  assert.equal(panel.focusId(), 1);
  assert.equal(panel.handle('up'), true); assert.equal(gone.at(-1).line, 2);
  shown = null; panel.focusId.set(3);
  assert.equal(panel.handle('book-as'), true); assert.equal(booked[1].id, 3, 'without a detail the focused row');
  assert.equal(panel.handle('down'), true); assert.equal(gone.length, 2, 'the arrows move the focus only');
});

test('an explicitly unlinked imported row ignores stale cost-payment cache and misleading markers', () => {
  const { panel, state } = harness();
  const row = { ...movement(), source: 'ODOO' as const, allocated: false, reference: 'kost #5' };
  state.costs.set([{ id: 5, description: 'Old link', payments: [{ id: 7, bankStatementLineId: 1 }] }]);
  assert.equal(panel.linkedDocuments(row).length, 0);
});

test('missing destinations refresh once and never open a stale document after unlink', async () => {
  const { panel, state, opened, toasts } = harness();
  const row = { ...movement(), source: 'ODOO' as const, allocated: true };
  state.bankStatements.set([row]);
  let reloads = 0;
  state.reload = async () => { reloads++; state.bankStatements.set([{ ...row, allocated: false }]); };
  await panel.openLinked(row);
  assert.equal(reloads, 1);
  assert.equal(opened.length, 0);
  assert.match(toasts[0], /niet meer gekoppeld/);
  assert.equal(panel.openingId(), null);
});

test('a failed refresh never uses retained document links', async () => {
  const { panel, state, opened, toasts } = harness();
  const row = { ...movement(), source: 'ODOO' as const, allocated: true };
  state.bankStatements.set([row]);
  state.costs.set([{ id: 5, description: 'Retained', bankStatementLineId: 1 }]);
  state.sourceErrors = () => ['Kosten laden mislukt'];
  await panel.openLinked(row);
  assert.equal(opened.length, 0);
  assert.match(toasts[0], /niet geladen/);
});

test('legacy manual references expose all documents, never imported reference guesses', () => {
  const { panel, state } = harness();
  const row = { ...movement(), reference: 'kost #5 containerbetaling #10 kostbetaling #7' };
  state.bankStatements.set([row]);
  state.costs.set([{ id: 5, description: 'Legacy', payments: [{ id: 7 }] }]);
  state.payments.set([{ id: 10, orderId: 20, orderNumber: 'PO-20' }]);
  assert.equal(panel.linkedDocuments(row).length, 2);
  assert.equal(panel.linkedDocuments({ ...row, source: 'ODOO' }).length, 0);
});


test('a slow destination lookup cannot open a document after leaving its account', async () => {
  const { panel, state, opened, toasts } = harness();
  const row = { ...movement(), source: 'ODOO' as const, allocated: true };
  state.bankStatements.set([row]);
  const pending = deferred<void>();
  state.reload = async () => { await pending.promise; state.costs.set([{ id: 5, description: 'Late', bankStatementLineId: 1 }]); };
  const work = panel.openLinked(row);
  assert.equal(panel.openingId(), 1);
  panel.ngOnDestroy();
  pending.resolve();
  await work;
  assert.equal(opened.length, 0);
  assert.equal(toasts.length, 0);
});

test('footer explains empty document, payment and received-document selections without submitting', async () => {
  const { panel } = harness(); await panel.openAllocation(movement(7, -40));
  assert.equal(panel.allocationReady(), false); assert.match(panel.allocationBlockedReason(), /Kies eerst een factuur of uitgave/);
  panel.setAllocationStep('payments'); assert.equal(panel.allocationReady(), false); assert.match(panel.allocationBlockedReason(), /Selecteer eerst/);
  panel.allocationStep.set('new'); assert.equal(panel.allocationReady(), false); assert.match(panel.allocationBlockedReason(), /Kies eerst een ontvangen factuur/);
  await panel.submitAllocation(); assert.equal(panel.selected()!.id, 7);
});

test('settled cost footer reuses its unique matching payment and preserves the original signed two-cent difference', async () => {
  for (const sign of [1, -1]) {
    const { panel, state, api } = harness(); const bank = movement(7, -sign * 40.02);
    const cost = localCost(1, sign * 40, 0, [{ id: 9, amountEur: sign * 40, paidOn: '2026-09-01', bankStatementLineId: null }]);
    state.costs.set([cost]); state.bankStatements.set([bank]);
    const calls: any[] = []; let creations = 0;
    (api as any).addCostPayment = async () => { creations++; throw new Error('Must never create'); };
    (api as any).linkPayments = async (id: number, body: any) => { calls.push({ id, costPaymentId: body.costPaymentId, purchases: Array.from(body.purchasePaymentIds) }); return { ...bank, allocated: true }; };
    await panel.openAllocation(bank); panel.chooseLocalDocument(panel.localDocuments()[0]);
    assert.equal(panel.localReusablePayment()!.id, 9); assert.equal(panel.localPreview()!.paymentEur, -sign * 40);
    assert.equal(panel.localPreview()!.differenceEur, -sign * .02); assert.equal(panel.localPreview()!.overpaidEur, 0);
    assert.equal(panel.canLinkLocal(), false, 'creating another payment stays forbidden');
    assert.equal(panel.allocationReady(), true); assert.equal(panel.allocationBlockedReason(), '');
    assert.equal(panel.allocationActionLabel(), 'Bestaande betaling koppelen');
    await panel.submitAllocation(); assert.equal(creations, 0);
    assert.deepEqual(calls, [{ id: 7, costPaymentId: 9, purchases: [] }]);
    assert.equal(state.costs()[0], cost); assert.equal(state.bankStatements()[0].amountEur, bank.amountEur);
  }
});

test('paid cost reuse rejects a three-cent mismatch, opposite sign and payments of another cost', async () => {
  for (const amount of [40.03, -40]) {
    const { panel, state } = harness(); state.costs.set([localCost(1, 40, 0, [{ id: 9, amountEur: amount, paidOn: '2026-10-01', bankStatementLineId: null }]),
      localCost(2, 40, 0, [{ id: 10, amountEur: 40, paidOn: '2026-10-01', bankStatementLineId: null }])]);
    await panel.openAllocation(movement(7, -40)); panel.chooseLocalDocument(panel.localDocuments().find(doc => doc.id === 1)!);
    assert.equal(panel.localReusablePayment(), null); assert.equal(panel.allocationReady(), false);
    assert.match(panel.allocationBlockedReason(), amount > 0 ? /wijkt.*af van de banktransactie/ : /andere betaalrichting/);
  }
});

test('multiple free matching payments require an explicit selection even on a settled cost', async () => {
  const { panel, state } = harness(); state.costs.set([localCost(1, 80, 0, [9, 10].map(id => ({ id, amountEur: 40, paidOn: '2026-10-01', bankStatementLineId: null })))]);
  await panel.openAllocation(movement(7, -40)); panel.chooseLocalDocument(panel.localDocuments()[0]);
  assert.equal(panel.localReusablePayment(), null); assert.equal(panel.allocationReady(), false);
  assert.match(panel.allocationBlockedReason(), /2 geregistreerde betalingen.*Kies expliciet/);
  panel.localNewConfirmed.set(true); assert.equal(panel.allocationReady(), false);
  panel.reuseLocalPayment(panel.localExistingPayments()[0]); assert.equal(panel.allocationReady(), true);
});

test('matching payments with an earlier bank link never become reusable through the footer', async () => {
  for (const source of ['MANUAL', 'ODOO']) {
    const { panel, state } = harness(); const bank = movement(7, -40);
    state.costs.set([localCost(1, 40, 0, [{ id: 9, amountEur: 40, paidOn: '2026-10-01', bankStatementLineId: 8 }])]);
    state.bankStatements.set([bank, { ...movement(8, -40), source: source as any, allocated: true }]);
    await panel.openAllocation(bank); panel.chooseLocalDocument(panel.localDocuments()[0]);
    assert.equal(panel.localReusablePayment(), null); assert.equal(panel.allocationReady(), false);
    assert.match(panel.allocationBlockedReason(), /heeft al een bankkoppeling/);
    assert.match(panel.allocationBlockedReason(), /eerst los/);
  }
});

test('the unique reuse action remains blocked during source loading, errors, bank changes or concurrent linkage', async () => {
  const { panel, state } = harness(); const bank = movement(7, -40);
  const cost = localCost(1, 40, 0, [{ id: 9, amountEur: 40, paidOn: '2026-10-01', bankStatementLineId: null }]);
  state.costs.set([cost]); state.bankStatements.set([bank]); await panel.openAllocation(bank); panel.chooseLocalDocument(panel.localDocuments()[0]);
  panel.localLoading.set(true); assert.equal(panel.allocationReady(), false); assert.match(panel.allocationBlockedReason(), /nog geladen/);
  panel.localLoading.set(false); panel.localError.set('Kosten offline'); assert.equal(panel.allocationReady(), false); assert.match(panel.allocationBlockedReason(), /Kosten offline/);
  panel.localError.set(''); state.bankStatements.set([{ ...bank, amountEur: -41 }]); assert.equal(panel.allocationReady(), false); assert.match(panel.allocationBlockedReason(), /gewijzigd/);
  state.bankStatements.set([{ ...bank, allocated: true }]); assert.equal(panel.allocationReady(), false); assert.match(panel.allocationBlockedReason(), /gekoppeld/);
  state.bankStatements.set([bank]); state.costs.set([{ ...cost, payments: [{ ...cost.payments[0], bankStatementLineId: 8 }] }]);
  assert.equal(panel.allocationReady(), false); assert.equal(panel.localReusablePayment(), null);
});

test('partial cost payments retain the duplicate confirmation and do not silently reuse', async () => {
  const { panel, state } = harness(); state.costs.set([localCost(1, 80, 40, [{ id: 9, amountEur: 40, paidOn: '2026-10-01', bankStatementLineId: null }])]);
  await panel.openAllocation(movement(7, -40)); panel.chooseLocalDocument(panel.localDocuments()[0]);
  assert.equal(panel.localReusablePayment(), null); assert.equal(panel.allocationReady(), false);
  assert.match(panel.allocationBlockedReason(), /bevestig hierboven dat dit een nieuwe betaling/);
  panel.localNewConfirmed.set(true); assert.equal(panel.allocationReady(), true); assert.equal(panel.allocationBlockedReason(), '');
});

test('existing payments footer keeps source refresh and aggregate two-cent guards', async () => {
  const { panel, state } = harness(); const bank = movement(7, -100.02); state.bankStatements.set([bank]);
  state.payments.set([{ id: 9, orderId: 1, amountEur: 60, paidOn: '2026-10-01' }, { id: 10, orderId: 1, amountEur: 40, paidOn: '2026-10-01' }]);
  await panel.openAllocation(bank); panel.setAllocationStep('payments');
  panel.toggleOutgoing(panel.outgoingCandidates()[0]); assert.equal(panel.allocationReady(), false); assert.match(panel.allocationBlockedReason(), /op het totaal/);
  panel.toggleOutgoing(panel.outgoingCandidates()[1]); assert.equal(panel.allocationReady(), true);
  panel.localError.set('Betalingen offline'); assert.equal(panel.allocationReady(), false); assert.match(panel.allocationBlockedReason(), /Betalingen offline/);
  panel.localError.set(''); panel.selected.set(movement(7, -100.03)); state.bankStatements.set([movement(7, -100.03)]);
  assert.equal(panel.allocationReady(), false); assert.match(panel.allocationBlockedReason(), /op het totaal/);
  state.payments.update(payments => payments.map(payment => payment.id === 9 ? { ...payment, bankStatementLineId: 88 } : payment));
  assert.equal(panel.allocationReady(), false); assert.match(panel.allocationBlockedReason(), /niet meer beschikbaar/);
});

test('existing sales payment footer cannot bypass a source error or matching load', async () => {
  const { panel, state, allocationCalls } = harness(); state.salesOrders.set([invoice(1)]); state.incomingPayments.set([receipt(9, 1, 50)]);
  await panel.openAllocation(movement(7, 50)); panel.reuseLocalSales(panel.existingMatches()[0]);
  assert.equal(panel.allocationReady(), true);
  panel.matchingLoading.set(true); assert.equal(panel.allocationReady(), false); assert.match(panel.allocationBlockedReason(), /nog geladen/);
  panel.matchingLoading.set(false); panel.localError.set('Ontvangsten offline'); assert.equal(panel.allocationReady(), false);
  await panel.submitAllocation(); assert.equal(allocationCalls.length, 0);
  panel.localError.set(''); await panel.submitAllocation(); assert.deepEqual(allocationCalls, [{ id: 7, salesOrderId: 1, existingPaymentId: 9 }]);
});

test('new-source footer explains failed preview, candidate selection, snapshot and amount gates', async () => {
  const { panel } = harness(); await panel.openAllocation(movement(7, -100)); panel.allocationStep.set('new');
  panel.receivedError.set('Odoo offline'); assert.match(panel.allocationBlockedReason(), /Odoo offline/); panel.receivedError.set('');
  panel.receivedPreviewLoading.set(true); assert.match(panel.allocationBlockedReason(), /nog gecontroleerd/); panel.receivedPreviewLoading.set(false);
  panel.receivedPreview.set(receivedPreview(receivedDocument(), { existingCandidates: [{ id: 8 }] }));
  assert.equal(panel.allocationReady(), false); assert.match(panel.allocationBlockedReason(), /Kies de bestaande kost/);
  panel.receivedExistingCostId.set(8); assert.equal(panel.allocationReady(), true);
  panel.receivedPreview.update(preview => ({ ...preview!, eligible: false, unavailableReason: 'Andere onderneming' })); assert.match(panel.allocationBlockedReason(), /Andere onderneming/);
  panel.receivedPreview.update(preview => ({ ...preview!, eligible: true, snapshotHash: '' })); assert.match(panel.allocationBlockedReason(), /niet volledig/);
  panel.receivedPreview.update(preview => ({ ...preview!, snapshotHash: 'new', differenceEur: .03 })); assert.match(panel.allocationBlockedReason(), /0,02 verschil/);
});

test('footer submit dispatches ordinary local and received-source paths without changing their identities', async () => {
  const ordinary = harness(); ordinary.state.costs.set([localCost()]); const bank = movement(7, -40);
  await ordinary.panel.openAllocation(bank); ordinary.panel.chooseLocalDocument(ordinary.panel.localDocuments()[0]);
  const costCalls: any[] = []; (ordinary.api as any).addCostPayment = async (...args: any[]) => { costCalls.push(args); return { ...bank, allocated: true }; };
  await ordinary.panel.submitAllocation(); assert.deepEqual(costCalls, [[7, 1, false]]);
  const received = harness(); await received.panel.openAllocation(movement(8, -100)); received.panel.allocationStep.set('new');
  received.panel.receivedPreview.set(receivedPreview()); assert.equal(received.panel.allocationActionLabel(), 'Registreren en koppelen');
  const receivedCalls: any[] = []; (received.api as any).linkReceivedOdooInvoice = async (id: number, body: any) => {
    receivedCalls.push({ id, ...body }); return { line: { ...movement(id, -100), allocated: true }, companyCostId: 11, alreadyRegistered: false };
  };
  await received.panel.submitAllocation(); assert.deepEqual(receivedCalls, [{ id: 8, odooInvoiceId: 10, snapshotHash: 'snapshot-10' }]);
});

test('uncertain reuse response remains an existing-payment retry and never creates another payment', async () => {
  const { panel, state, api } = harness(); const bank = movement(7, -40); state.bankStatements.set([bank]);
  state.costs.set([localCost(1, 40, 0, [{ id: 9, amountEur: 40, paidOn: '2026-10-01', bankStatementLineId: null }])]);
  await panel.openAllocation(bank); panel.chooseLocalDocument(panel.localDocuments()[0]);
  let creations = 0; const calls: number[] = [];
  (api as any).addCostPayment = async () => { creations++; };
  (api as any).linkPayments = async (_id: number, body: any) => { calls.push(body.costPaymentId); if (calls.length === 1) throw new Error('Response verloren'); return { ...bank, allocated: true }; };
  await panel.submitAllocation(); assert.equal(panel.allocationStep(), 'payments'); assert.equal(panel.allocationReady(), true);
  await panel.submitAllocation(); assert.deepEqual(calls, [9, 9]); assert.equal(creations, 0);
});

test('Expofit paid-cost preview shows its actual 423.04 payment against 349.62 bank and the honest 73.42 difference', async () => {
  const { panel, state, api } = harness(); const bank = { ...movement(81, -349.62), counterparty: 'Expofit', bookedAt: '2026-09-24T00:00:00Z' };
  const payment = { id: 2, amountEur: 423.04, paidOn: '2026-09-24', bankStatementLineId: null };
  const cost = { ...localCost(10, 423.04, 0, [payment]), description: 'Beursbalie', party: 'Expofit', date: '2026-09-24' };
  state.bankStatements.set([bank]); state.costs.set([cost]); await panel.openAllocation(bank); panel.chooseLocalDocument(panel.localDocuments()[0]);
  assert.equal(panel.localRecordedCostPayments()[0], payment);
  const preview = panel.localPreview()!;
  assert.equal(preview.paymentKind, 'existing'); assert.equal(preview.paymentEur, -423.04);
  assert.equal(preview.differenceEur, 73.42); assert.equal(preview.paymentLinked, false);
  assert.equal(preview.eligible, false); assert.equal(preview.overpaidEur, 0);
  assert.equal(panel.localReusablePayment(), null); assert.equal(panel.allocationReady(), false);
  assert.match(panel.allocationBlockedReason(), /423,04/); assert.match(panel.allocationBlockedReason(), /73,42/);
  assert.match(panel.allocationBlockedReason(), /Maximaal € 0,02/);
  let writes = 0; (api as any).addCostPayment = async () => { writes++; }; (api as any).linkPayments = async () => { writes++; };
  await panel.submitAllocation(); assert.equal(writes, 0); assert.equal(state.costs()[0], cost); assert.equal(state.bankStatements()[0], bank);
});

test('paid supplier credit preview preserves signed amounts and reveals an existing bank link even when the amount differs', async () => {
  const { panel, state } = harness(); const bank = movement(81, 349.62);
  state.costs.set([localCost(10, -423.04, 0, [{ id: 2, amountEur: -423.04, paidOn: '2026-09-24', bankStatementLineId: 44 }])]);
  await panel.openAllocation(bank); panel.chooseLocalDocument(panel.localDocuments()[0]);
  const preview = panel.localPreview()!;
  assert.equal(preview.paymentEur, 423.04); assert.equal(preview.differenceEur, -73.42);
  assert.equal(preview.paymentKind, 'existing'); assert.equal(preview.paymentLinked, true);
  assert.match(preview.explanation!, /423,04/); assert.match(preview.explanation!, /73,42/);
  assert.doesNotMatch(preview.explanation!, /eerst los/);
  assert.match(panel.allocationBlockedReason(), /wijkt.*af van de banktransactie/);
  assert.doesNotMatch(panel.allocationBlockedReason(), /eerst los/); assert.equal(panel.allocationReady(), false);
});

test('multiple recorded payments without a unique matching free payment never fabricate a payment amount', async () => {
  const { panel, state } = harness(); const recorded = [
    { id: 1, amountEur: 200, paidOn: '2026-09-01', bankStatementLineId: null },
    { id: 2, amountEur: 223.04, paidOn: '2026-09-24', bankStatementLineId: 44 },
  ];
  state.costs.set([localCost(10, 423.04, 0, recorded)]); await panel.openAllocation(movement(81, -349.62)); panel.chooseLocalDocument(panel.localDocuments()[0]);
  const preview = panel.localPreview()!;
  assert.equal(preview.paymentKind, 'choose-existing'); assert.equal(preview.paymentEur, null); assert.equal(preview.differenceEur, null); assert.equal(preview.paymentLinked, null);
  assert.equal(panel.localRecordedCostPayments().length, 2); assert.equal(panel.localRecordedCostPayments()[1].bankStatementLineId, 44);
  assert.match(preview.explanation!, /2 geregistreerde betalingen/); assert.equal(panel.allocationReady(), false);
});

test('a paid cost without recorded payments has no presumed payment amount or difference', async () => {
  const { panel, state } = harness(); state.costs.set([localCost(10, 423.04, 0, [])]);
  await panel.openAllocation(movement(81, -349.62)); panel.chooseLocalDocument(panel.localDocuments()[0]);
  assert.equal(panel.localPreview()!.paymentEur, null); assert.equal(panel.localPreview()!.differenceEur, null);
  assert.match(panel.allocationBlockedReason(), /geen afzonderlijke betaling geregistreerd/); assert.equal(panel.allocationReady(), false);
});

test('multiple recorded payments retain the prior unique-free-match route and show only that real matching amount', async () => {
  const { panel, state } = harness(); state.costs.set([localCost(10, 100, 0, [
    { id: 1, amountEur: 60, paidOn: '2026-09-01', bankStatementLineId: 44 },
    { id: 2, amountEur: 40, paidOn: '2026-09-24', bankStatementLineId: null },
  ])]);
  await panel.openAllocation(movement(81, -40.02)); panel.chooseLocalDocument(panel.localDocuments()[0]);
  assert.equal(panel.localReusablePayment()!.id, 2); assert.equal(panel.localPreview()!.paymentEur, -40);
  assert.equal(panel.localPreview()!.differenceEur, -.02); assert.equal(panel.localPreview()!.paymentLinked, false);
  assert.equal(panel.localPreview()!.eligible, false); assert.equal(panel.allocationReady(), true);
});


test('each recorded payment shows its own signed difference without implying a selection', async () => {
  const { panel } = harness(); assert.equal(panel.localRecordedPaymentDifference({ amountEur: 423.04 }), null);
  await panel.openAllocation(movement(81, -349.62));
  assert.equal(panel.localRecordedPaymentDifference({ amountEur: 423.04 }), 73.42);
  assert.equal(panel.localRecordedPaymentDifference({ amountEur: 200 }), -149.62);
  assert.equal(panel.localRecordedPaymentDifference({ amountEur: Number.NaN }), null);
  panel.selected.set(movement(81, 349.62)); assert.equal(panel.localRecordedPaymentDifference({ amountEur: -423.04 }), -73.42);
  assert.equal(panel.localSelectedKey(), null); assert.equal(panel.allocationReady(), false);
});

/* ---- the round of 2026-10-15: payments in parts, inspection via the supplier, offsets */

/** A container on a server with invoices (the round's marker for Kosten & bank). */
function roundView(values: any = {}): any {
  return { ...purchaseView(), invoices: [], invoiceFiles: [], ...values };
}

test('a credit offset is never offered for a bank line; a transfer of a payment in parts says so', async () => {
  const { panel, state } = harness();
  state.payments.set([{ id: 21, orderId: 3, orderNumber: 'PO-3', label: 'Saldo 70%', amountEur: 100, paidOn: '2026-09-08', groupId: 20 },
    { id: 20, orderId: 3, orderNumber: 'PO-3', label: 'Saldo 70%', amountEur: 50, paidOn: '2026-09-01', groupId: 20, bankStatementLineId: 9 },
    { id: 22, orderId: 3, orderNumber: 'PO-3', label: 'Verrekend tegoed INK-9', amountEur: 100, paidOn: '2026-09-08', creditOffset: true }]);
  await panel.openAllocation(movement(70, -100));
  assert.deepEqual(JSON.parse(JSON.stringify(panel.outgoingCandidates().map(row => [row.id, row.detail]))), [[21, 'PO-3 · Saldo 70% · deel van een betaling in 2 transacties']]);
});

test('Bestaande betaling: one larger payment is linked in part (Deel koppelen); a matching transfer of a group goes through bank-part too', async () => {
  const { panel, state, sourcing } = harness();
  state.purchaseViews.set([roundView()]);
  const bank = { ...movement(534, -10000), source: 'ODOO' as const };
  state.bankStatements.set([bank]);
  state.payments.set([{ id: 102, orderId: 20, orderNumber: 'PO-20', label: 'Saldo 70%', amountEur: 21733.63, paidOn: '2026-09-10' }]);
  const calls: any[] = [];
  (sourcing as any).linkPaymentPart = async (id: number, lineId: number) => { calls.push([id, lineId]); return { payments: [], lines: [{ ...bank, allocated: true }] }; };
  await panel.openAllocation(bank);
  panel.setAllocationStep('payments');
  panel.toggleOutgoing(panel.outgoingCandidates()[0]);
  assert.deepEqual([panel.outgoingPart()?.carve, panel.canLinkOutgoing(), panel.allocationActionLabel()], [true, true, 'Deel koppelen']);
  await panel.linkOutgoing();
  assert.deepEqual(calls, [[102, 534]]);
  // A server without this round: the larger payment cannot be linked at all.
  const older = harness();
  older.state.purchaseViews.set([purchaseView()]);
  older.state.payments.set([{ id: 102, orderId: 20, amountEur: 21733.63, paidOn: '2026-09-10' }]);
  await older.panel.openAllocation(bank);
  older.panel.toggleOutgoing(older.panel.outgoingCandidates()[0]);
  assert.deepEqual([older.panel.outgoingPart(), older.panel.canLinkOutgoing()], [null, false]);
  // Route 2: the open transfer 103 of group 102 matches the line and takes its day through bank-part.
  const route = harness();
  route.state.purchaseViews.set([roundView()]);
  route.state.payments.set([{ id: 103, orderId: 20, amountEur: 11733.63, paidOn: '2026-09-10', groupId: 102 }]);
  const parts: any[] = [];
  (route.sourcing as any).linkPaymentPart = async (id: number, lineId: number) => { parts.push([id, lineId]); return { payments: [], lines: [] }; };
  await route.panel.openAllocation({ ...movement(534, -11733.65), source: 'ODOO' });
  route.panel.toggleOutgoing(route.panel.outgoingCandidates()[0]);
  assert.deepEqual([route.panel.outgoingPart()?.row.id, route.panel.outgoingPart()?.carve, route.panel.canLinkOutgoing()], [103, false, true]);
  await route.panel.linkOutgoing();
  assert.deepEqual(parts, [[103, 534]]);
});

test('a line that paid goods and the inspection of one container names both; one payee keeps Inkoop', () => {
  const { panel, state } = harness();
  const row = { ...movement(610, -10300), source: 'ODOO' as const, allocated: true };
  state.bankStatements.set([row]);
  state.payments.set([{ id: 201, orderId: 21, orderNumber: 'PO-2026-021', payee: 'SUPPLIER', bankStatementLineId: 610 },
    { id: 202, orderId: 21, orderNumber: 'PO-2026-021', payee: 'SEPARATE', bankStatementLineId: 610 }]);
  assert.equal(panel.linkedLabel(row), 'Goederen + inspectie · PO-2026-021');
  state.payments.set([{ id: 201, orderId: 21, orderNumber: 'PO-2026-021', payee: 'SUPPLIER', bankStatementLineId: 610 },
    { id: 203, orderId: 21, orderNumber: 'PO-2026-021', payee: 'SUPPLIER', instalmentDue: 'FREIGHT', bankStatementLineId: 610 },
    { id: 202, orderId: 21, orderNumber: 'PO-2026-021', payee: 'SEPARATE', bankStatementLineId: 610 }]);
  assert.equal(panel.linkedLabel(row), 'Goederen + zeevracht + inspectie · PO-2026-021');
  state.payments.set([{ id: 201, orderId: 21, orderNumber: 'PO-2026-021', payee: 'SUPPLIER', bankStatementLineId: 610 }]);
  assert.equal(panel.linkedLabel(row), 'Inkoop · PO-2026-021');
  state.payments.set([{ id: 201, orderId: 21, orderNumber: 'PO-2026-021', orderAlias: 'ORDER (3e) OOSTENRIJKER', payee: 'SUPPLIER', bankStatementLineId: 610 }]);
  assert.equal(panel.linkedLabel(row), 'Inkoop · ORDER (3e) OOSTENRIJKER', 'the container name, not its number');
});

test('a line linked to a container is found by the PO number, whatever its label shows (B9); rows read bankTextOf', () => {
  const { panel, state } = harness();
  const row = { ...movement(611, -33867), source: 'ODOO' as const, allocated: true, counterparty: 'Yunnan Pubei Agricultural Science A',
    reference: 'YUNNAN PUBEI AGRICULTURAL SCIENCE A Instantoverschrijving LU16 0670 0000 1234 5678 BIC: CHASLULXXXX PI 20260907 glass 09.59 uur KBC Mobile' };
  state.bankStatements.set([row, movement(612, 10)]);
  state.payments.set([{ id: 301, orderId: 11, orderNumber: 'PO-2026-011', orderAlias: 'ORDER (3e) OOSTENRIJKER / STOLP FRANS- 40FTHQ', payee: 'SUPPLIER', bankStatementLineId: 611 }]);
  panel.search.set('PO-2026-011');
  assert.deepEqual(panel.filteredLines().map(line => line.id), [611]);
  assert.equal(panel.titleOf(row), 'Yunnan Pubei Agricultural Science A');
  assert.equal(panel.subOf(row), 'PI 20260907 glass');
  assert.equal(panel.verschil({ ...row, allocationDifferenceEur: -0.01 }).replace(/\u00a0/g, ' '), 'Verschil − € 0,01');
});

test('one transfer for several containers reads "Inkoop · 3 containers (…)", the numbers in order (owner addition)', () => {
  const { panel, state } = harness();
  const row = { ...movement(112, -16500), source: 'ODOO' as const, allocated: true };
  state.bankStatements.set([row]);
  state.payments.set([{ id: 905, orderId: 45, orderNumber: 'PO-2026-045', payee: 'SUPPLIER', bankStatementLineId: 112 },
    { id: 904, orderId: 44, orderNumber: 'PO-2026-044', payee: 'SUPPLIER', bankStatementLineId: 112 },
    { id: 903, orderId: 43, orderNumber: 'PO-2026-043', payee: 'SUPPLIER', bankStatementLineId: 112 }]);
  assert.equal(panel.linkedLabel(row), 'Inkoop · 3 containers (PO-2026-043, PO-2026-044, PO-2026-045)');
  state.payments.update(rows => rows.map(payment => payment.orderId === 44 ? { ...payment, orderAlias: 'Foam Bear' } : payment));
  assert.equal(panel.linkedLabel(row), 'Inkoop · 3 containers (PO-2026-043, Foam Bear, PO-2026-045)', 'names, in PO order');
});

test('Factuur of uitgave: goods and the inspection paid via the supplier become two payments on the one bank line', async () => {
  const { panel, state, api, toasts } = harness();
  const view = roundView({ order: { ...purchaseView().order, inspectionViaSupplier: true } });
  view.reconciliation.streams.push({ payee: 'SEPARATE', status: 'UNPAID', plannedEur: 300, remainingEur: 300, paidEur: 0, finalized: false });
  state.purchaseViews.set([view]);
  const bank = movement(610, -10300);
  await panel.openAllocation(bank);
  panel.chooseLocalDocument(panel.localDocuments().find(row => row.container?.payee === 'SUPPLIER')!);
  assert.equal(panel.localInspectionOffered(), true);
  panel.purchaseInspectionInput.set('300');
  assert.equal(panel.canLinkLocal(), true);
  const calls: any[] = []; (api as any).addPurchasePayment = async (...args: any[]) => { calls.push(JSON.parse(JSON.stringify(args))); return { line: { ...bank, allocated: true }, payments: [] }; };
  await panel.linkLocalDocument();
  assert.deepEqual(calls[0][2].map((part: any) => [part.payee, part.amount, part.instalmentDue, part.invoiceId, part.inspectionViaSupplier ?? false]),
    [['SUPPLIER', 10000, 'ORDERED', null, false], ['SEPARATE', 300, null, null, true]]);
  assert.equal(toasts.at(-1), 'Bankbetaling gekoppeld: goederen + inspectie');
  panel.selected.set(bank); panel.localSelectedKey.set(panel.localDocuments()[0].key); panel.purchaseInspectionInput.set('10300');
  assert.equal(panel.canLinkLocal(), false, 'the inspection is smaller than the transfer');
});

/* ---- round 2 (Emre, 2026-10-15): one payment linked to one transaction follows it */

test('Bestaande betaling: one matching payment goes through bank-part so it follows the transaction, with the notice as the toast', async () => {
  const { panel, state, sourcing, toasts } = harness();
  state.purchaseViews.set([roundView()]);
  const bank = { ...movement(520, -1046.97), source: 'ODOO' as const };
  state.payments.set([{ id: 80, orderId: 20, orderNumber: 'PO-20', label: 'Douane', amountEur: 1046.95, paidOn: '2026-09-01', payee: 'LOGISTICS' }]);
  const calls: any[] = [];
  (sourcing as any).linkPaymentPart = async (id: number, lineId: number, amount: number | null, options: any) => {
    calls.push([id, lineId, amount, options.higher, [...options.withPaymentIds]]);
    return { payments: [{ id: 80, amountEur: 1046.97, paidOn: '2026-09-08', bankStatementLineId: 520 }], lines: [{ ...bank, allocated: true }] };
  };
  await panel.openAllocation(bank);
  panel.setAllocationStep('payments');
  panel.toggleOutgoing(panel.outgoingCandidates()[0]);
  assert.deepEqual([panel.outgoingPart()?.carve, panel.outgoingPart()?.higher, panel.canLinkOutgoing()], [false, false, true]);
  assert.deepEqual(panel.outgoingChange().map(row => [row.label, row.now.replace(/\u00a0/g, ' '), row.after.replace(/\u00a0/g, ' ')]).slice(0, 2),
    [['Bedrag', '€ 1.046,95', '€ 1.046,97'], ['Betaald op', '01/09/2026', '08/09/2026']]);
  await panel.linkOutgoing();
  assert.deepEqual(calls, [[80, 520, null, null, []]]);
  assert.equal(toasts.at(-1)!.replace(/\u00a0/g, ' '), 'Bedrag en datum gevolgd van de transactie: € 1.046,97 op 08/09/2026 (was € 1.046,95 op 01/09/2026).');
});

test('Bestaande betaling: a larger transaction asks first; the inspection rest only for a supplier payment of a container with an inspection', async () => {
  const { panel, state, sourcing } = harness();
  const view = roundView({ order: { ...purchaseView().order, inspectionCostEur: 300 } });
  state.purchaseViews.set([view]);
  const bank = { ...movement(610, -10300), source: 'ODOO' as const };
  state.payments.set([{ id: 201, orderId: 20, orderNumber: 'PO-20', label: 'Aanbetaling 30%', amountEur: 10000, paidOn: '2026-09-01', payee: 'SUPPLIER', instalmentDue: 'ORDERED' }]);
  const calls: any[] = [];
  (sourcing as any).linkPaymentPart = async (id: number, lineId: number, amount: number | null, options: any) => {
    calls.push([id, lineId, amount, options.higher]); return { payments: [], lines: [{ ...bank, allocated: true }] };
  };
  await panel.openAllocation(bank);
  panel.setAllocationStep('payments');
  panel.toggleOutgoing(panel.outgoingCandidates()[0]);
  assert.deepEqual([panel.outgoingPart()?.higher, panel.canLinkOutgoing(), panel.outgoingInspectionOffered()], [true, false, true]);
  assert.match(panel.allocationBlockedReason().replace(/\u00a0/g, ' '), /^Transactie is € 300,00 hoger dan deze betaling: kies hierboven/);
  assert.equal(panel.outgoingChange().length, 0, 'no comparison before the choice');
  panel.chooseOutgoingSurplus('INSPECTION');
  assert.equal(panel.canLinkOutgoing(), true);
  assert.equal(panel.outgoingChange().find(row => row.label === 'Inspectie via leverancier')?.after.replace(/\u00a0/g, ' '), '€ 300,00 op dezelfde transactie');
  await panel.linkOutgoing();
  assert.deepEqual(calls, [[201, 610, null, 'INSPECTION']]);
  // Douane & transport: only 'Bedrag aanpassen'.
  const other = harness();
  other.state.purchaseViews.set([view]);
  other.state.payments.set([{ id: 202, orderId: 20, label: 'Douane', amountEur: 1000, paidOn: '2026-09-01', payee: 'LOGISTICS' }]);
  await other.panel.openAllocation({ ...movement(611, -1100), source: 'ODOO' });
  other.panel.toggleOutgoing(other.panel.outgoingCandidates()[0]);
  assert.deepEqual([other.panel.outgoingPart()?.higher, other.panel.outgoingInspectionOffered()], [true, false]);
});

test('Factuur of uitgave offers the unlinked payment of the container first, on any term, before a new payment is booked', async () => {
  const { panel, state } = harness();
  const view = roundView();
  view.reconciliation.supplierInstalments[0].label = '30% bij bestelling';
  view.reconciliation.supplierInstalments.push({ due: 'SHIPPED', label: '70% bij vertrek', plannedEur: 2800, remainingEur: 2800, paidEur: 0, finalized: false });
  state.purchaseViews.set([view]);
  state.payments.set([{ id: 301, orderId: 20, label: 'Aanbetaling 30%', amountEur: 12000, paidOn: '2026-10-02', payee: 'SUPPLIER', instalmentDue: 'ORDERED' },
    { id: 302, orderId: 20, label: 'Inspectie', amountEur: 300, paidOn: '2026-10-02', payee: 'SEPARATE' },
    { id: 303, orderId: 20, label: 'Saldo', amountEur: 100, paidOn: '2026-09-01', payee: 'SUPPLIER', bankStatementLineId: 77 }]);
  await panel.openAllocation(movement(640, -5000));
  // Booking the € 5.000 on the 70% term: the unlinked € 12.000 of the 30% comes first, as a part of it.
  panel.chooseLocalDocument(panel.localDocuments().find(row => row.container?.due === 'SHIPPED')!);
  const offered = panel.localOpenPayments().map(open => [open.match.id, open.term, open.action, open.day]);
  assert.deepEqual(JSON.parse(JSON.stringify(offered)), [[301, '30%', 'Deel koppelen', '02/10/2026']], 'only the supplier\'s payment not on the bank');
  panel.reuseLocalPayment(panel.localOpenPayments()[0].match);
  assert.deepEqual([panel.allocationStep(), panel.outgoingPart()?.carve], ['payments', true], 'under Bestaande betaling, as a part');
  assert.match(panel.outgoingCarveText().replace(/\u00a0/g, ' '), /^Deel van deze betaling: € 5\.000,00 van € 12\.000,00/);
  // A matching line links it whole.
  const whole = harness();
  whole.state.purchaseViews.set([view]);
  whole.state.payments.set([{ id: 301, orderId: 20, label: 'Aanbetaling 30%', amountEur: 12000, paidOn: '2026-10-02', payee: 'SUPPLIER', instalmentDue: 'ORDERED' }]);
  await whole.panel.openAllocation(movement(641, -12000));
  whole.panel.chooseLocalDocument(whole.panel.localDocuments().find(row => row.container?.due === 'ORDERED')!);
  assert.equal(whole.panel.localOpenPayments()[0]?.action, 'Koppelen');
});

test("'Bedrag aanpassen' says what it does to the term before the choice", async () => {
  const { panel, state } = harness();
  const view = roundView();
  Object.assign(view.reconciliation.supplierInstalments[0], { label: '30% bij bestelling', plannedEur: 12000, paidEur: 12000, remainingEur: 0 });
  state.purchaseViews.set([view]);
  state.payments.set([{ id: 201, orderId: 20, label: 'Aanbetaling 30%', amountEur: 12000, paidOn: '2026-10-02', payee: 'SUPPLIER', instalmentDue: 'ORDERED' }]);
  await panel.openAllocation({ ...movement(680, -12300), source: 'ODOO' });
  panel.setAllocationStep('payments');
  panel.toggleOutgoing(panel.outgoingCandidates()[0]);
  assert.equal(panel.outgoingAdjustText().replace(/\u00a0/g, ' '), 'De termijn komt dan € 300,00 boven de afspraak (te veel betaald).');
});

test('Bestaande betaling: the goods and the inspection noted with them go on the transaction together, the inspection keeping its amount', async () => {
  const { panel, state, sourcing, toasts } = harness();
  state.purchaseViews.set([roundView()]);
  const bank = { ...movement(610, -10300), source: 'ODOO' as const };
  state.payments.set([{ id: 201, orderId: 20, label: 'Aanbetaling 30%', amountEur: 10000, paidOn: '2026-09-01', payee: 'SUPPLIER', instalmentDue: 'ORDERED' },
    { id: 202, orderId: 20, label: 'Aanbetaling 30% · inspectie', amountEur: 300, paidOn: '2026-09-01', payee: 'SEPARATE' }]);
  const calls: any[] = [];
  (sourcing as any).linkPaymentPart = async (id: number, lineId: number, amount: number | null, options: any) => {
    calls.push([id, lineId, options.higher, [...options.withPaymentIds]]);
    return { payments: [], lines: [{ ...bank, allocated: true }], notice: 'Datum gevolgd van de transactie: 08/09/2026 (was 01/09/2026).' };
  };
  await panel.openAllocation(bank);
  panel.setAllocationStep('payments');
  for (const row of panel.outgoingCandidates()) panel.toggleOutgoing(row);
  assert.deepEqual([panel.outgoingPart()?.row.id, [...panel.outgoingPart()!.withIds], panel.canLinkOutgoing()], [201, [202], true]);
  assert.equal(panel.outgoingChange().find(row => row.label === 'Inspectie via leverancier')?.after.replace(/\u00a0/g, ' '), '€ 300,00 · zelfde transactie');
  await panel.linkOutgoing();
  assert.deepEqual(calls, [[201, 610, null, [202]]]);
  assert.equal(toasts.at(-1), 'Datum gevolgd van de transactie: 08/09/2026 (was 01/09/2026).', "the server's own sentence");
}
);

/* ---- round-2 review: a USD payment is linked as the server links it; 'Rest als inspectie' only where the server takes it */

test('Bestaande betaling: a USD payment is linked whole with its rate, or carved by a part named in dollars; never the larger-transaction question', async () => {
  const { panel, state, sourcing, toasts } = harness();
  state.purchaseViews.set([roundView({ order: { ...purchaseView().order, inspectionCostEur: 300 } })]);
  const bank = { ...movement(650, -5090), source: 'ODOO' as const };
  state.payments.set([{ id: 401, orderId: 20, orderNumber: 'PO-20', label: 'Saldo 70%', amount: 12000, currency: 'USD', amountEur: 10250, paidOn: '2026-09-01',
    payee: 'SUPPLIER', instalmentDue: 'SHIPPED' }]);
  const calls: any[] = [];
  (sourcing as any).linkPaymentPart = async (id: number, lineId: number, amount: number | null, options: any) => {
    calls.push([id, lineId, amount, options.higher]); return { payments: [], lines: [{ ...bank, allocated: true }] };
  };
  await panel.openAllocation(bank);
  panel.setAllocationStep('payments');
  panel.toggleOutgoing(panel.outgoingCandidates()[0]);
  assert.deepEqual([panel.outgoingPart()?.carve, panel.outgoingPart()?.higher, panel.canLinkOutgoing(), panel.allocationActionLabel()], [false, false, true, 'Koppelen']);
  assert.deepEqual(panel.outgoingChange().map(row => row.label), ['Bedrag', 'Betaald op', 'Koers', 'Bewijs']);
  assert.match(panel.outgoingForeignWarning()!.replace(/ /g, ' '), /^€ 5\.090,00 wijkt sterk af van de geboekte € 10\.250,00/);
  panel.outgoingForeignInput.set('6000');
  assert.deepEqual([panel.outgoingPart()?.carve, panel.outgoingPart()?.amount, panel.canLinkOutgoing(), panel.allocationActionLabel()], [true, 6000, true, 'Deel koppelen']);
  assert.equal(panel.outgoingCarveText().replace(/ /g, ' '),
    'Deel van deze betaling: US$ 6.000,00 (€ 5.090,00) van US$ 12.000,00; de rest (US$ 6.000,00) blijft open als tweede transactie.');
  panel.outgoingForeignInput.set('13000');
  assert.equal(panel.canLinkOutgoing(), false);
  assert.match(panel.allocationBlockedReason().replace(/ /g, ' '), /^Het deel moet kleiner zijn dan de betaling \(US\$ 12\.000,00\)/);
  panel.outgoingForeignInput.set('6000');
  await panel.linkOutgoing();
  assert.deepEqual(calls, [[401, 650, 6000, null]]);
  assert.equal(toasts.at(-1), 'Deel van de betaling gekoppeld');
  // A larger euro line on the same USD payment: whole, no question, no inspection rest.
  const larger = harness();
  larger.state.purchaseViews.set([roundView({ order: { ...purchaseView().order, inspectionCostEur: 300 } })]);
  larger.state.payments.set(state.payments());
  await larger.panel.openAllocation({ ...movement(651, -10600), source: 'ODOO' });
  larger.panel.toggleOutgoing(larger.panel.outgoingCandidates()[0]);
  assert.deepEqual([larger.panel.outgoingPart()?.higher, larger.panel.canLinkOutgoing(), larger.panel.outgoingInspectionOffered()], [false, true, false]);
});

test("Bestaande betaling: no 'Rest als inspectie' once the inspection via the supplier is booked or noted with the transfer", async () => {
  const view = roundView({ order: { ...purchaseView().order, inspectionCostEur: 300, inspectionViaSupplier: true } });
  const goods = { id: 301, orderId: 20, orderNumber: 'PO-20', label: 'Saldo 70%', amountEur: 21733.63, paidOn: '2026-09-10', payee: 'SUPPLIER', instalmentDue: 'SHIPPED' };
  // PO-2026-014: the € 300 inspection rides on the 30% transfer.
  const booked = harness();
  booked.state.purchaseViews.set([view]);
  booked.state.payments.set([goods, { id: 201, orderId: 20, label: 'Aanbetaling 30%', amountEur: 9314.41, paidOn: '2026-08-03', payee: 'SUPPLIER', bankStatementLineId: 610 },
    { id: 202, orderId: 20, label: 'Aanbetaling 30% · inspectie', amountEur: 300, paidOn: '2026-08-03', payee: 'SEPARATE', bankStatementLineId: 610 }]);
  await booked.panel.openAllocation({ ...movement(700, -21783.63), source: 'ODOO' });
  booked.panel.toggleOutgoing(booked.panel.outgoingCandidates().find(row => row.id === 301)!);
  assert.deepEqual([booked.panel.outgoingPart()?.higher, booked.panel.outgoingInspectionOffered()], [true, false]);
  // An inspection noted with the goods on their day is this transfer's: no second one either.
  const noted = harness();
  noted.state.purchaseViews.set([view]);
  noted.state.payments.set([goods, { id: 302, orderId: 20, label: 'Inspectie', amountEur: 100, paidOn: '2026-09-10', payee: 'SEPARATE' }]);
  await noted.panel.openAllocation({ ...movement(701, -21783.63), source: 'ODOO' });
  noted.panel.toggleOutgoing(noted.panel.outgoingCandidates().find(row => row.id === 301)!);
  assert.deepEqual([noted.panel.outgoingPart()?.higher, noted.panel.outgoingInspectionOffered()], [true, false]);
});

test('Transacties over every account: the search reads amounts four ways, In · Uit leave internal transfers out', () => {
  const { panel, state } = harness();
  const rent = { ...movement(1, -1452), account: 'KBC', counterparty: 'Huur loods Wilrijk', reference: 'Oktober' };
  const other = { ...movement(2, 5000), account: 'WISE', counterparty: 'Van KBC', classification: 'INTERNAL_TRANSFER' as const, allocated: true };
  const fee = { ...movement(3, -14.5), account: 'WISE', counterparty: 'Wise', reference: 'fee' };
  state.bankStatements.set([rent, other, fee]);
  assert.deepEqual(Array.from(panel.filteredLines(), (line) => line.id).sort(), [1, 2, 3], 'no account: every active account');
  for (const query of ['1452', '1.452,00', '1452.00', '-1452']) {
    panel.search.set(query);
    assert.deepEqual(Array.from(panel.filteredLines(), (line) => line.id), [1], query);
  }
  panel.search.set('');
  assert.deepEqual({ ...panel.totals() }, { incoming: 0, outgoing: 1466.5, net: -1466.5, internal: 1 });
  panel.accountFilter.set('WISE');
  assert.deepEqual(Array.from(panel.filteredLines(), (line) => line.id).sort(), [2, 3]);
  assert.equal(panel.statusLabel(other), 'Interne overboeking');
  assert.equal(panel.statusLabel(fee), 'Te koppelen');
});

test('Transacties rows: "Zoek een match" when nothing is found, a why line under a container link, one account drops the account column', () => {
  const { panel, state } = harness();
  const open = movement(720, -120), linked = { ...movement(721, -33867), source: 'ODOO' as const, allocated: true };
  state.bankStatements.set([open, linked]);
  state.payments.set([{ id: 301, orderId: 11, orderNumber: 'PO-2026-011', orderAlias: null, payee: 'SUPPLIER', bankStatementLineId: 721 },
    { id: 302, orderId: 11, orderNumber: 'PO-2026-011', orderAlias: null, payee: 'LOGISTICS', bankStatementLineId: 721 }]);
  assert.deepEqual([panel.koppeling(open)?.find, panel.koppeling(open)?.text], [true, 'Zoek een match']);
  assert.equal(panel.koppeling(linked)?.sub, 'Leverancier + Douane & transport', 'the payees; no PO hint when the name is the number');
  assert.equal(panel.phoneSub(open), 'Bank reference');
  assert.ok(panel.phoneSub(linked).endsWith(' · Leverancier + Douane & transport'));
  assert.equal(panel.one(), true, 'no active account list in the harness: one account');
  assert.deepEqual(['link', 'open', 'book'].map((kind) => panel.swipeIcon(kind as 'link')), ['link', 'eye', 'receipt']);
});

test('several containers on one transfer: "Inkoop · 3 containers" with the names on the why line', () => {
  const { panel, state } = harness();
  const row = { ...movement(112, -16500), source: 'ODOO' as const, allocated: true };
  state.bankStatements.set([row]);
  state.payments.set([{ id: 905, orderId: 45, orderNumber: 'PO-2026-045', payee: 'SUPPLIER', bankStatementLineId: 112 },
    { id: 904, orderId: 44, orderNumber: 'PO-2026-044', orderAlias: 'Foam Bear', payee: 'SUPPLIER', bankStatementLineId: 112 },
    { id: 903, orderId: 43, orderNumber: 'PO-2026-043', payee: 'SUPPLIER', bankStatementLineId: 112 }]);
  assert.equal(panel.koppeling(row)?.text, 'Inkoop · 3 containers');
  assert.equal(panel.koppeling(row)?.sub, 'PO-2026-043, Foam Bear en PO-2026-045');
});

test('the cockpit list gives its action one column for all rows, or none when no row on screen has an action', () => {
  // Review 2026-10-17: an auto track was sized per row (each row is its own grid), so the status pills jumped between rows.
  const { panel, state } = harness();
  const suggestions = signal(new Map<number, unknown>());
  (state as unknown as { suggestions: typeof suggestions }).suggestions = suggestions;
  state.bankStatements.set([movement(1, -50), movement(2, -20)]);
  assert.equal(panel.anyAction(), false, 'no suggestion: the action track collapses to 0');
  const suggestion = { lineId: 2, target: { kind: 'cost-new', costId: 4, title: 'Kost · Huur', openEur: 20 }, score: 80, reasons: [], amountMatches: true, exact: true, changesAmount: false, others: [] };
  suggestions.set(new Map([[2, suggestion]]));
  assert.equal(panel.actionOf(movement(2, -20))?.label, 'Koppelen');
  assert.equal(panel.anyAction(), true, 'one row with Koppelen: every row keeps the fixed action track');
});
