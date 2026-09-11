import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { computed, signal } from '@angular/core';
import type { PurchaseOrder, PurchaseOrderView, PurchasePayment } from '../src/app/core/api/models.ts';
import { PAYMENT_TERMS } from '../src/app/core/api/models.ts';
import { instalmentsOf } from '../src/app/features/purchasing/payment-plan.ts';
import { purchaseInstalmentState } from '../src/app/features/purchasing/purchase-instalment-state.ts';
import { preservePurchaseDraft } from '../src/app/features/purchasing/purchase-payment-refresh.ts';

function purchase(id = 50): PurchaseOrderView {
  return {
    order: { id, number: `PO-${id}`, status: 'BESTELD', alias: 'Container', notes: 'Bestaande notitie',
      paymentTerms: 'CUSTOM', payPctOrdered: 30, payPctShipped: 30, payPctArrived: 40,
      destinationCostsEur: 100, extraRevenueEur: 200, lines: [{ id: 1, productId: 10, quantity: 24 }] },
    costing: { totals: { goodsEur: 59_620, totalEur: 59_920 } },
    reconciliation: { streams: [], totals: { paidEur: 17_000 }, supplierInstalments: [
      { due: 'ORDERED', label: '30% bij bestelling', plannedEur: 17_886, paidEur: 17_000,
        remainingEur: 0, settledSavingEur: 886, overpaidEur: 0, explicitlySettled: true, finalized: true },
    ] },
  } as unknown as PurchaseOrderView;
}

const oldPayment: PurchasePayment = { id: 70, orderId: 50, paidOn: '2026-09-11', amount: 17_000,
  amountEur: 17_000, currency: 'EUR', label: '30% bij bestelling', actor: null,
  recordedAt: '2026-09-11T12:00:00Z', payee: 'SUPPLIER', settles: true, instalmentDue: 'ORDERED' };

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }

test('three-way refresh preserves dirty scalars and product edits while updating clean server fields', () => {
  const saved = purchase().order;
  const draft = { ...clone(saved), alias: 'Mijn wijziging', destinationCostsEur: 120,
    lines: [{ ...saved.lines[0], quantity: 48 }] };
  const fresh = { ...clone(saved), notes: 'Bestaande notitie\nBetaling gewijzigd', shippedOn: '2026-09-11' };
  const before = clone({ draft, saved, fresh });
  const next = preservePurchaseDraft(draft, saved, fresh);
  assert.equal(next.alias, 'Mijn wijziging');
  assert.equal(next.destinationCostsEur, 120);
  assert.equal(next.lines[0].quantity, 48);
  assert.equal(next.notes, fresh.notes);
  assert.equal(next.shippedOn, fresh.shippedOn);
  assert.equal(next.extraRevenueEur, 200);
  assert.deepEqual({ draft, saved, fresh }, before, 'Merging must not mutate any baseline or draft');
});

test('intentionally cleared fields and locally edited notes are not overwritten by the server', () => {
  const saved = purchase().order;
  const draft = { ...clone(saved), alias: null, notes: '', lines: [] };
  const fresh = { ...clone(saved), alias: 'Servernaam', notes: 'Servernotitie', destinationCostsEur: 125 };
  const next = preservePurchaseDraft(draft, saved, fresh);
  assert.equal(next.alias, null);
  assert.equal(next.notes, '');
  assert.deepEqual(next.lines, []);
  assert.equal(next.destinationCostsEur, 125);
});

test('a clean or reverted draft adopts the full fresh order without inventing unsaved changes', () => {
  const saved = purchase().order;
  const draft = clone(saved);
  draft.alias = 'tijdelijk'; draft.alias = saved.alias;
  const fresh = { ...clone(saved), notes: 'Nieuwe logboekregel', receivedOn: '2026-09-12' };
  assert.deepEqual(preservePurchaseDraft(draft, saved, fresh), fresh);
});

// Exercise the actual editor methods, including the confirmed DELETE callback.
// Only transport, route signals and notifications are mocked; no live API is reachable.
const source = await readFile(new URL('../src/app/features/purchasing/purchase-editor.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('purchase-editor.ts', source, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'PurchaseEditor');
assert.ok(original);
const names = new Set(['payments', 'paymentStateError', 'paymentStateLoading', 'paymentRefreshVersion',
  'previewVersion', 'previewTimer', 'savedOrder', 'payingBusy', 'refreshPaymentState', 'removePayment', 'plannedInstalments']);
const members = original.members.filter(member => member.name && ts.isIdentifier(member.name) && names.has(member.name.text));
assert.equal(members.length, names.size);
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)),
  original.name, original.typeParameters, undefined, members);
const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup() {
  const calls: { method: string; id: number; body?: unknown }[] = [];
  const notifications: unknown[][] = [];
  const confirmations: (() => Promise<void>)[] = [];
  const api = {
    payments: async (_id: number): Promise<PurchasePayment[]> => [],
    purchaseOrder: async (id: number): Promise<PurchaseOrderView> => purchase(id),
    previewPurchaseOrder: async (id: number, order: PurchaseOrder): Promise<PurchaseOrderView> => ({ ...purchase(id), order }),
    deletePayment: async (_id: number, _paymentId: number): Promise<void> => {},
  };
  const exports: Record<string, new () => any> = {};
  vm.runInNewContext(javascript, { exports, signal, computed, clearTimeout, preservePurchaseDraft,
    purchaseInstalmentState, instalmentsOf, PAYMENT_TERMS,
    messageOf: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback });
  const editor = new exports['PurchaseEditor']();
  Object.assign(editor, {
    view: signal(purchase()), id: signal('50'),
    ui: { toast: (...args: unknown[]) => notifications.push(args),
      confirm: (_options: unknown, action: () => Promise<void>) => confirmations.push(action) },
    sourcing: {
      payments: (id: number) => { calls.push({ method: 'GET payments', id }); return api.payments(id); },
      purchaseOrder: (id: number) => { calls.push({ method: 'GET order', id }); return api.purchaseOrder(id); },
      previewPurchaseOrder: (id: number, order: PurchaseOrder) => {
        calls.push({ method: 'POST preview', id, body: clone(order) }); return api.previewPurchaseOrder(id, order);
      },
      deletePayment: (id: number, paymentId: number) => {
        calls.push({ method: 'DELETE payment', id, body: paymentId }); return api.deletePayment(id, paymentId);
      },
    },
  });
  editor.savedOrder.set(JSON.stringify(editor.view().order));
  editor.payments.set([oldPayment]);
  return { editor, api, calls, notifications, confirmations };
}

test('a clean refresh publishes the fresh ledger and reconciliation together using only GETs', async () => {
  const { editor, api, calls } = setup();
  const fresh = purchase(); fresh.order.notes += '\nBetaling verwijderd';
  fresh.reconciliation!.totals.paidEur = 0;
  api.purchaseOrder = async () => fresh;
  assert.equal(await editor.refreshPaymentState(), true);
  assert.deepEqual(editor.payments(), []);
  assert.deepEqual(clone(editor.view()), fresh);
  assert.equal(editor.savedOrder(), JSON.stringify(fresh.order));
  assert.equal(editor.paymentStateLoading(), false);
  assert.equal(editor.paymentStateError(), null);
  assert.deepEqual(calls.map(call => call.method), ['GET payments', 'GET order']);
});

for (const failing of ['payments', 'purchaseOrder'] as const) {
  test(`${failing} GET failure clears the old paid/slot state; retry cannot issue a second DELETE`, async () => {
    const { editor, api, calls, confirmations } = setup();
    api[failing] = async () => { throw new Error('Verbinding verbroken'); };
    editor.removePayment(oldPayment);
    assert.equal(calls.length, 0, 'Nothing is removed before explicit confirmation');
    assert.equal(confirmations.length, 1);
    await confirmations[0]();
    assert.equal(editor.payments(), null);
    assert.equal(editor.view().reconciliation, null);
    assert.match(editor.paymentStateError(), /Verbinding verbroken/);
    assert.deepEqual(Array.from(editor.plannedInstalments()), []);
    assert.equal(editor.paymentStateLoading(), false);
    assert.equal(editor.payingBusy(), false);
    assert.equal(calls.filter(call => call.method === 'DELETE payment').length, 1);

    const refreshed = purchase();
    refreshed.reconciliation!.totals.paidEur = 0;
    refreshed.reconciliation!.supplierInstalments![0] = { ...refreshed.reconciliation!.supplierInstalments![0],
      paidEur: 0, remainingEur: 17_886, settledSavingEur: 0, explicitlySettled: false, finalized: false };
    api.payments = async () => [];
    api.purchaseOrder = async () => refreshed;
    const beforeRetry = calls.length;
    assert.equal(await editor.refreshPaymentState(), true);
    assert.deepEqual(calls.slice(beforeRetry).map(call => call.method), ['GET payments', 'GET order']);
    assert.equal(calls.filter(call => call.method === 'DELETE payment').length, 1);
    assert.equal(editor.view().reconciliation.totals.paidEur, 0);
    assert.equal(editor.plannedInstalments()[0].amount, 17_886);
    assert.equal(editor.paymentStateError(), null);
  });
}

for (const outcome of ['success', 'failure'] as const) {
  test(`a late order 50 ${outcome} leaves order 51 and its draft/payment state untouched`, async () => {
    const { editor, api } = setup();
    const pending = deferred<PurchaseOrderView>();
    api.purchaseOrder = () => pending.promise;
    const refresh = editor.refreshPaymentState();
    const next = purchase(51); next.order.alias = 'Niet opgeslagen op 51';
    editor.id.set('51'); editor.view.set(next);
    editor.savedOrder.set(JSON.stringify(purchase(51).order));
    editor.payments.set([{ ...oldPayment, orderId: 51, id: 71 }]);
    ++editor.paymentRefreshVersion; // load(newRouteId) invalidates the old request.
    editor.paymentStateLoading.set(true);
    editor.paymentStateError.set('Status van order 51');
    const snapshot = { view: editor.view(), saved: editor.savedOrder(), payments: editor.payments() };
    if (outcome === 'success') pending.resolve(purchase()); else pending.reject(new Error('Late netwerkfout'));
    assert.equal(await refresh, false);
    assert.equal(editor.view(), snapshot.view);
    assert.equal(editor.savedOrder(), snapshot.saved);
    assert.equal(editor.payments(), snapshot.payments);
    assert.equal(editor.paymentStateError(), 'Status van order 51');
    assert.equal(editor.paymentStateLoading(), true, 'The old request cannot clear the new route loading state');
  });
}

test('a changed route ID already blocks a response while the old order is still on screen', async () => {
  const { editor, api } = setup();
  const pending = deferred<PurchaseOrderView>();
  api.purchaseOrder = () => pending.promise;
  const oldView = editor.view();
  const refresh = editor.refreshPaymentState();
  editor.id.set('51');
  pending.resolve(purchase());
  assert.equal(await refresh, false);
  assert.equal(editor.view(), oldView);
  assert.deepEqual(editor.payments(), [oldPayment]);
});

test('edits made during GET survive and fresh server notes and matching preview are retained', async () => {
  const { editor, api, calls } = setup();
  const pending = deferred<PurchaseOrderView>();
  const fresh = purchase(); fresh.order.notes += '\nBetaling bewaard';
  api.purchaseOrder = () => pending.promise;
  api.previewPurchaseOrder = async (_id, order) => ({ ...fresh, order,
    costing: { ...fresh.costing, totals: { ...fresh.costing.totals, totalEur: 60_020 } } });
  const refresh = editor.refreshPaymentState();
  editor.view.update((current: PurchaseOrderView) => ({ ...current, order: { ...current.order,
    alias: 'Mijn late edit', destinationCostsEur: 200,
    lines: current.order.lines.map(line => ({ ...line, quantity: 48 })) } }));
  pending.resolve(fresh);
  assert.equal(await refresh, true);
  assert.equal(editor.view().order.alias, 'Mijn late edit');
  assert.equal(editor.view().order.destinationCostsEur, 200);
  assert.equal(editor.view().order.lines[0].quantity, 48);
  assert.equal(editor.view().order.notes, fresh.order.notes);
  assert.equal(editor.view().costing.totals.totalEur, 60_020);
  assert.equal(editor.savedOrder(), JSON.stringify(fresh.order), 'The unsaved draft cannot become its own saved baseline');
  assert.notEqual(JSON.stringify(editor.view().order), editor.savedOrder());
  assert.deepEqual(calls.map(call => call.method), ['GET payments', 'GET order', 'POST preview']);
});

test('typing again during the preview retries with the latest draft instead of publishing stale costs', async () => {
  const { editor, api, calls } = setup();
  editor.view.update((current: PurchaseOrderView) => ({ ...current, order: { ...current.order, destinationCostsEur: 200 } }));
  const firstPreview = deferred<PurchaseOrderView>();
  const started = deferred<void>();
  let previews = 0;
  api.previewPurchaseOrder = async (_id, order) => {
    if (++previews === 1) { started.resolve(); return firstPreview.promise; }
    return { ...purchase(), order, costing: { totals: { totalEur: 60_120 } } } as PurchaseOrderView;
  };
  const refresh = editor.refreshPaymentState();
  await started.promise;
  editor.view.update((current: PurchaseOrderView) => ({ ...current, order: { ...current.order, destinationCostsEur: 300 } }));
  firstPreview.resolve(purchase());
  assert.equal(await refresh, true);
  assert.equal(previews, 2);
  assert.equal(editor.view().order.destinationCostsEur, 300);
  assert.equal(editor.view().costing.totals.totalEur, 60_120);
  const previewCalls = calls.filter(call => call.method === 'POST preview');
  assert.deepEqual(previewCalls.map(call => (call.body as PurchaseOrder).destinationCostsEur), [200, 300]);
  assert.equal(calls.filter(call => call.method === 'DELETE payment').length, 0);
});

test('a failed dirty-draft preview preserves edits and baseline but invalidates financial state', async () => {
  const { editor, api } = setup();
  editor.view.update((current: PurchaseOrderView) => ({ ...current, order: { ...current.order, alias: 'Blijft staan' } }));
  const baseline = editor.savedOrder();
  api.previewPurchaseOrder = async () => { throw new Error('Berekening niet beschikbaar'); };
  assert.equal(await editor.refreshPaymentState(), false);
  assert.equal(editor.view().order.alias, 'Blijft staan');
  assert.equal(editor.savedOrder(), baseline);
  assert.equal(editor.payments(), null);
  assert.equal(editor.view().reconciliation, null);
  assert.match(editor.paymentStateError(), /Berekening niet beschikbaar/);
});

test('an older refresh cannot overwrite a newer result for the same order', async () => {
  const { editor, api } = setup();
  const first = deferred<PurchaseOrderView>();
  api.purchaseOrder = () => first.promise;
  const oldRefresh = editor.refreshPaymentState();
  const newest = purchase(); newest.order.notes = 'Nieuwste serverversie';
  api.purchaseOrder = async () => newest;
  assert.equal(await editor.refreshPaymentState(), true);
  first.resolve(purchase());
  assert.equal(await oldRefresh, false);
  assert.equal(editor.view().order.notes, 'Nieuwste serverversie');
  assert.equal(editor.savedOrder(), JSON.stringify(newest.order));
  assert.equal(editor.paymentStateLoading(), false);
  assert.equal(editor.paymentStateError(), null);
});
