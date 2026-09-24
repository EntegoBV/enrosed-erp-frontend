import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { signal, computed } from '@angular/core';
import { PAYEE_LABEL, settleCarriers } from '../src/app/features/purchasing/purchase-payment-ledger.ts';

// The editor's new payment actions, isolated from Angular: save first, settle,
// undo a settlement, move a payment to another payee, and receive with a final
// payment. Only transport, dialogs and neighbouring members are stubbed.
const source = await readFile(new URL('../src/app/features/purchasing/purchase-editor.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('purchase-editor.ts', source, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'PurchaseEditor')!;
const names = new Set(['whenSaved', 'requestPayment', 'requestEdit', 'requestSettle', 'requestRemove', 'settling', 'settleCarrierOptions',
  'openSettle', 'setSettleScope', 'confirmSettle', 'undoSettle', 'setPaymentPayee', 'movePayment', 'confirmReceive']);
const members = original.members.filter(member => member.name && ts.isIdentifier(member.name) && names.has(member.name.text));
assert.equal(members.length, names.size);
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)),
  original.name, original.typeParameters, undefined, members);
const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function payment(id: number, values: Record<string, unknown> = {}) {
  return { id, orderId: 50, paidOn: '2026-08-0' + id, amount: 1000, currency: 'USD', amountEur: 920, label: 'Aanbetaling',
    actor: 'emre', recordedAt: '2026-08-01T10:00:00Z', payee: 'SUPPLIER', settles: false, instalmentDue: null, ...values };
}

function view(id = 50, canonical = true) {
  return { order: { id, number: 'INK-2026-014', lines: [], supplierId: 8 },
    reconciliation: { streams: [], supplierInstalments: canonical ? [{ due: 'SHIPPED', label: '70% bij vertrek' }] : undefined } };
}

function setup() {
  const exports: Record<string, new () => any> = {};
  vm.runInNewContext(javascript, { exports, signal, computed, settleCarriers, escapeHtml, PAYEE_LABEL,
    messageOf: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback });
  const editor = new exports['PurchaseEditor']();
  const calls: any[] = [];
  const toasts: [string, string][] = [];
  const confirms: { options: any; run: () => Promise<void> | void }[] = [];
  const api = {
    updatePayment: async (_order: number, id: number, body: any) => ({ ...payment(id), ...body }),
    addPayment: async (_order: number, body: any) => ({ ...payment(90), ...body }),
    receivePurchaseOrder: async (id: number, _body: any) => ({ ...view(id), order: { ...view(id).order, status: 'ONTVANGEN' } }),
    save: async (): Promise<any> => ({ order: { id: 50 } }),
    refresh: async (_id: number) => true,
  };
  Object.assign(editor, {
    view: signal<any>(view()), payments: signal<any[] | null>([payment(1), payment(2, { instalmentDue: 'SHIPPED' }), payment(3, { payee: 'LOGISTICS', currency: 'EUR', amount: 400, amountEur: 400 })]),
    dirty: signal(false), saving: signal(false), payingBusy: signal(false), paymentPlanBusy: signal(false),
    paymentStateLoading: signal(false), paymentStateError: signal<string | null>(null), paying: signal<any>(null),
    receiving: signal<any>(null), booking: signal(false), statusCelebration: signal<any>(null), products: signal<any[]>([]),
    savedOrder: signal(''), previewVersion: 0,
    ui: { toast: (text: string, kind = 'ok') => toasts.push([text, kind]), confirm: (options: any, run: () => Promise<void> | void) => confirms.push({ options, run }) },
    sourcing: {
      updatePayment: (order: number, id: number, body: any) => { calls.push({ type: 'PUT', order, id, body: clone(body) }); return api.updatePayment(order, id, body); },
      addPayment: (order: number, body: any) => { calls.push({ type: 'POST', order, body: clone(body) }); return api.addPayment(order, body); },
      deletePayment: (order: number, id: number) => { calls.push({ type: 'DELETE', order, id }); return Promise.resolve(); },
      receivePurchaseOrder: (order: number, body: any) => { calls.push({ type: 'RECEIVE', order, body: clone(body) }); return api.receivePurchaseOrder(order, body); },
    },
    catalog: { products: async () => [] },
    save: () => { calls.push({ type: 'SAVE' }); return api.save(); },
    refreshPaymentState: (id: number) => { calls.push({ type: 'REFRESH', id }); return api.refresh(id); },
    loadPayments: async (id: number) => { calls.push({ type: 'LOAD', id }); },
    openPayment: (...args: unknown[]) => calls.push({ type: 'OPEN', args }),
    editPayment: (value: any) => calls.push({ type: 'EDIT', id: value.id }),
    removePayment: (value: any) => calls.push({ type: 'REMOVE', id: value.id }),
    openFor: (payee: string) => ({ SUPPLIER: 700, LOGISTICS: 150, SEPARATE: 0, OTHER: 0 } as Record<string, number>)[payee],
    paidTotalEur: () => 300, remainingEur: () => 700,
  });
  return { editor, api, calls, toasts, confirms };
}

test('save first: clean runs at once; dirty confirms, saves and only then runs; a failed save runs nothing', async () => {
  const { editor, calls, confirms, api } = setup();
  editor.requestPayment({ payee: 'LOGISTICS', due: undefined });
  assert.deepEqual(calls, [{ type: 'OPEN', args: [undefined, undefined, 'LOGISTICS', null] }]);
  calls.length = 0;
  editor.dirty.set(true);
  editor.requestRemove(payment(3));
  assert.equal(calls.length, 0, 'Nothing happens before the answer');
  assert.equal(confirms[0].options.confirmLabel, 'Opslaan en verder');
  api.save = async () => { editor.dirty.set(false); return { order: { id: 50 } }; };
  await confirms[0].run();
  assert.deepEqual(calls.map(call => call.type), ['SAVE', 'REMOVE']);
  calls.length = 0;
  editor.dirty.set(true);
  api.save = async () => null;
  editor.requestEdit(payment(1));
  await confirms[1].run();
  assert.deepEqual(calls.map(call => call.type), ['SAVE'], 'A refused save opens nothing');
  api.save = async () => ({ order: { id: 50 } });
  editor.requestSettle({ payee: 'SUPPLIER', scope: 'GROUP', due: null });
  await confirms[2].run();
  assert.equal(editor.settling(), null, 'Still dirty after saving: nothing runs');
  calls.length = 0;
  editor.saving.set(true);
  editor.requestEdit(payment(1));
  assert.equal(confirms.length, 3, 'No second question while saving');
  assert.equal(calls.some(call => call.type === 'DELETE'), false, 'requestRemove never deletes before a save');
});

test('the settle sheet only opens when payments may be written, never for bijkomende kosten', () => {
  for (const guard of ['payingBusy', 'paymentStateLoading', 'paymentPlanBusy', 'dirty'] as const) {
    const { editor } = setup();
    editor[guard].set(true);
    editor.openSettle({ payee: 'SUPPLIER', scope: 'GROUP', due: null });
    assert.equal(editor.settling(), null, guard);
  }
  const failed = setup();
  failed.editor.paymentStateError.set('Niet actueel');
  failed.editor.openSettle({ payee: 'SUPPLIER', scope: 'GROUP', due: null });
  assert.equal(failed.editor.settling(), null);
  const unloaded = setup();
  unloaded.editor.payments.set(null);
  unloaded.editor.openSettle({ payee: 'SUPPLIER', scope: 'GROUP', due: null });
  assert.equal(unloaded.editor.settling(), null);
  const { editor } = setup();
  editor.openSettle({ payee: 'OTHER', scope: 'GROUP', due: null });
  assert.equal(editor.settling(), null);
  editor.openSettle({ payee: 'SUPPLIER', scope: 'GROUP', due: null });
  assert.deepEqual(clone(editor.settling()), { payee: 'SUPPLIER', scope: 'GROUP', due: null, paymentId: 1 });
  editor.setSettleScope('TERM', 'SHIPPED');
  assert.deepEqual(clone(editor.settling()), { payee: 'SUPPLIER', scope: 'TERM', due: 'SHIPPED', paymentId: 2 });
  assert.deepEqual(editor.settleCarrierOptions().options.map((option: any) => option.id), [2]);
  editor.openSettle({ payee: 'LOGISTICS', scope: 'TERM', due: 'SHIPPED' });
  assert.deepEqual(clone(editor.settling()), { payee: 'LOGISTICS', scope: 'GROUP', due: null, paymentId: 3 }, 'Only the supplier has terms');
});

test('settling resends the stored payment with the flag, so the booked euro value stays', async () => {
  const { editor, calls, toasts } = setup();
  editor.openSettle({ payee: 'SUPPLIER', scope: 'TERM', due: 'SHIPPED' });
  await editor.confirmSettle();
  assert.deepEqual(calls[0], { type: 'PUT', order: 50, id: 2, body: { paidOn: '2026-08-02', amount: 1000, currency: 'USD', label: 'Aanbetaling',
    payee: 'SUPPLIER', settles: true, instalmentDue: 'SHIPPED' } });
  assert.deepEqual(calls.filter(call => call.type === 'REFRESH'), [{ type: 'REFRESH', id: 50 }]);
  assert.equal(editor.settling(), null);
  assert.deepEqual(toasts.at(-1), ['70% bij vertrek afgerekend', 'ok']);
  assert.equal(editor.payingBusy(), false);
  const group = setup();
  group.editor.openSettle({ payee: 'LOGISTICS', scope: 'GROUP', due: null });
  await group.editor.confirmSettle();
  assert.deepEqual(group.calls[0].body, { paidOn: '2026-08-03', amount: 400, currency: 'EUR', label: 'Aanbetaling', payee: 'LOGISTICS', settles: true, instalmentDue: null });
  assert.deepEqual(group.toasts.at(-1), ['Douane & transport afgerekend', 'ok']);
});

test('a term settlement without per-term server figures writes nothing', async () => {
  const { editor, calls, toasts } = setup();
  editor.openSettle({ payee: 'SUPPLIER', scope: 'TERM', due: 'SHIPPED' });
  editor.view.set(view(50, false));
  await editor.confirmSettle();
  assert.equal(calls.length, 0);
  assert.deepEqual(toasts.at(-1), ['Laad de order opnieuw voordat je een betaling aan een termijn koppelt.', 'err']);
});

test('a failed settlement keeps the sheet open; a late answer for another order publishes nothing', async () => {
  const { editor, api, calls, toasts } = setup();
  api.updatePayment = async () => { throw new Error('Deze termijn is al afgerekend'); };
  editor.openSettle({ payee: 'SUPPLIER', scope: 'GROUP', due: null });
  await editor.confirmSettle();
  assert.ok(editor.settling(), 'The sheet stays');
  assert.deepEqual(toasts.at(-1), ['Deze termijn is al afgerekend', 'err']);
  assert.equal(calls.some(call => call.type === 'REFRESH'), false);
  assert.equal(editor.payingBusy(), false);
  const late = setup();
  const answer = deferred<any>();
  late.api.updatePayment = () => answer.promise;
  late.editor.openSettle({ payee: 'SUPPLIER', scope: 'GROUP', due: null });
  const pending = late.editor.confirmSettle();
  late.editor.view.set(view(51));
  answer.resolve(payment(1));
  await pending;
  assert.equal(late.calls.some(call => call.type === 'REFRESH'), false);
  assert.equal(late.toasts.length, 0);
  assert.equal(late.editor.payingBusy(), false);
});

test('undo clears only the matching flags, one write at a time, and refreshes once', async () => {
  const { editor, calls, confirms, toasts, api } = setup();
  editor.payments.set([payment(1, { settles: true }), payment(2, { settles: true, instalmentDue: 'SHIPPED' }),
    payment(3, { payee: 'LOGISTICS', settles: true }), payment(4)]);
  editor.undoSettle('SUPPLIER', 'SHIPPED');
  assert.match(confirms[0].options.message, /^<b>70% bij vertrek<\/b> weer openzetten\?/);
  let inFlight = 0;
  let most = 0;
  api.updatePayment = async (_order, id, body) => { inFlight++; most = Math.max(most, inFlight); await Promise.resolve(); inFlight--; return { ...payment(id), ...body }; };
  await confirms[0].run();
  assert.deepEqual(calls.filter(call => call.type === 'PUT').map(call => [call.id, call.body.settles, call.body.instalmentDue]), [[2, false, 'SHIPPED']]);
  assert.equal(calls.filter(call => call.type === 'REFRESH').length, 1);
  assert.deepEqual(toasts.at(-1), ['Afrekening ongedaan gemaakt', 'ok']);
  calls.length = 0;
  editor.undoSettle('SUPPLIER');
  await confirms[1].run();
  assert.deepEqual(calls.filter(call => call.type === 'PUT').map(call => call.id), [1, 2]);
  assert.equal(most, 1, 'Sequential writes');
  calls.length = 0;
  api.updatePayment = async (_order, id) => { if (id === 1) throw new Error('Geweigerd'); return payment(id); };
  editor.undoSettle('SUPPLIER');
  await confirms[2].run();
  assert.deepEqual(calls.filter(call => call.type === 'PUT').map(call => call.id), [1], 'Stops at the first error');
  assert.equal(calls.filter(call => call.type === 'REFRESH').length, 1);
  assert.deepEqual(toasts.at(-1), ['Geweigerd', 'err']);
  editor.undoSettle('SUPPLIER', null);
  assert.match(confirms[3].options.message, /Leverancier/);
  assert.equal(editor.payingBusy(), false);
});

test('a new payee drops the term and the settlement and re-prefills only an untouched amount', () => {
  const { editor } = setup();
  editor.paying.set({ id: null, amount: 700, amountInput: '700', currency: 'EUR', paidOn: '2026-09-01', label: 'Saldo', payee: 'SUPPLIER',
    files: [], settles: true, instalmentDue: 'SHIPPED' });
  editor.setPaymentPayee('LOGISTICS');
  assert.deepEqual(clone(editor.paying()), { id: null, amount: 150, amountInput: '150', currency: 'EUR', paidOn: '2026-09-01',
    label: 'Douane & transport', payee: 'LOGISTICS', files: [], settles: false, instalmentDue: null });
  editor.paying.set({ ...editor.paying(), amount: 123.45, amountInput: '123,45', label: 'Forwarder' });
  editor.setPaymentPayee('OTHER');
  assert.equal(editor.paying().amount, 123.45, 'A typed amount stays');
  assert.equal(editor.paying().label, 'Forwarder');
  assert.equal(editor.paying().payee, 'OTHER');
  editor.paying.set({ ...payment(1), id: 1, amountInput: '1000', files: [], settles: true, instalmentDue: 'SHIPPED' });
  editor.setPaymentPayee('SEPARATE');
  assert.deepEqual([editor.paying().amount, editor.paying().settles, editor.paying().instalmentDue], [1000, false, null], 'An edit keeps its amount');
  editor.payingBusy.set(true);
  editor.setPaymentPayee('SUPPLIER');
  assert.equal(editor.paying().payee, 'SEPARATE');
});

test('an edited payment moved away and back gets its own term and settlement again', () => {
  const { editor } = setup();
  editor.payments.set([payment(2, { settles: true, instalmentDue: 'SHIPPED' })]);
  editor.paying.set({ ...payment(2, { settles: true, instalmentDue: 'SHIPPED' }), amountInput: '1000', files: [] });
  editor.setPaymentPayee('LOGISTICS');
  assert.deepEqual([editor.paying().settles, editor.paying().instalmentDue], [false, null]);
  editor.setPaymentPayee('SUPPLIER');
  assert.deepEqual([editor.paying().payee, editor.paying().settles, editor.paying().instalmentDue], ['SUPPLIER', true, 'SHIPPED']);
  assert.equal(editor.paying().amount, 1000, 'The amount stays as typed');
  const fresh = setup();
  fresh.editor.paying.set({ id: null, amount: null, amountInput: '', currency: 'EUR', paidOn: '2026-09-01', label: '', payee: 'SUPPLIER',
    files: [], settles: true, instalmentDue: 'SHIPPED' });
  fresh.editor.setPaymentPayee('LOGISTICS');
  fresh.editor.setPaymentPayee('SUPPLIER');
  assert.deepEqual([fresh.editor.paying().settles, fresh.editor.paying().instalmentDue], [false, null], 'A new payment has nothing to restore');
});

test('moving a payment sends the new payee without term or settlement', async () => {
  const { editor, calls, confirms, toasts } = setup();
  editor.movePayment(payment(2, { settles: true, instalmentDue: 'SHIPPED' }), 'OTHER');
  assert.match(confirms[0].options.message, /verplaatsen naar <b>Bijkomende kosten<\/b>/);
  await confirms[0].run();
  assert.deepEqual(calls[0], { type: 'PUT', order: 50, id: 2, body: { paidOn: '2026-08-02', amount: 1000, currency: 'USD', label: 'Aanbetaling',
    payee: 'OTHER', settles: false, instalmentDue: null } });
  assert.equal(calls.filter(call => call.type === 'REFRESH').length, 1);
  assert.deepEqual(toasts.at(-1), ['Betaling verplaatst naar Bijkomende kosten', 'ok']);
  editor.dirty.set(true);
  editor.movePayment(payment(1), 'LOGISTICS');
  assert.equal(confirms.length, 1, 'Never over unsaved order edits');
});

test('receiving with a final payment stores the supplier total including it, then refreshes', async () => {
  const { editor, calls } = setup();
  editor.receiving.set({ lines: [{ productId: 1, name: 'Roos', sku: 'R1', ordered: 10, received: 10, damaged: 0, unitValueEur: 1, note: '' }],
    bookStock: true, finalPayment: true, note: '' });
  await editor.confirmReceive();
  assert.deepEqual(calls.map(call => call.type), ['POST', 'LOAD', 'RECEIVE', 'REFRESH']);
  assert.deepEqual({ ...calls[0].body, paidOn: 'today' }, { paidOn: 'today', amount: 700, currency: 'EUR', label: 'Slotbetaling', payee: 'SUPPLIER', settles: true });
  assert.equal(calls[2].body.paidTotalEur, 1000);
  assert.equal(editor.statusCelebration(), 'RECEIVED');
  const plain = setup();
  plain.editor.receiving.set({ lines: [], bookStock: false, finalPayment: false, note: '' });
  await plain.editor.confirmReceive();
  assert.equal(plain.calls.find(call => call.type === 'RECEIVE').body.paidTotalEur, 300);
});
