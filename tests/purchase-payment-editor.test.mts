import { bankAmountsMatch, bankAmountDifference } from '../src/app/shared/bank-transaction-options.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { signal, computed } from '@angular/core';
import { parsePurchasePaymentAmount, purchasePaymentOverage } from '../src/app/features/purchasing/purchase-payment-amount.ts';
import { paymentPlanError } from '../src/app/features/purchasing/payment-plan.ts';
import { invoiceDocument, splitTransfer } from '../src/app/features/purchasing/purchase-transfer-split.ts';
import { bankMarker, lineMarkers } from '../src/app/features/finance/bank-markers.ts';
import { defaultBankAccount, readPayToBank, writePayToBank } from '../src/app/features/finance/pay-to-bank-preference.ts';
import { preservePurchaseDraft } from '../src/app/features/purchasing/purchase-payment-refresh.ts';
import { PAYEE_LABEL } from '../src/app/features/purchasing/purchase-payment-ledger.ts';
import { receiptInstant, receiptLocalParts } from '../src/app/shared/received-at.ts';

test('bank amounts accept Dutch decimal commas, thousands and plain API decimals', () => {
  for (const [raw, expected] of [['1.046,95', 1046.95], ['1 200,25', 1200.25], ['€ 1\u00a0200,25', 1200.25],
    ['1200.25', 1200.25], ['4500', 4500], ['1.000', 1000], [4500, 4500]] as const) {
    assert.equal(parsePurchasePaymentAmount(raw), expected, String(raw));
  }
  for (const raw of ['', null, undefined, 'abc', '1,2,3', '-20', '0', '10,123', '1.23,45', Infinity, NaN]) {
    assert.equal(parsePurchasePaymentAmount(raw), null, String(raw));
  }
});

test('a logistics payment correction replaces its old amount instead of double-counting it', () => {
  assert.equal(purchasePaymentOverage(1300, 1046.95, 1200.25, 1046.95), 0);
  assert.equal(purchasePaymentOverage(1300, 1246.95, 1200.25, 1046.95), 100.25);
  assert.equal(purchasePaymentOverage(1300, 1246.95, 1046.95, 1046.95), 0);
});

test('a custom agreement must total 100 percent, without silently filling missing terms', () => {
  assert.equal(paymentPlanError({ paymentTerms: 'CUSTOM', payPctOrdered: 30, payPctShipped: 30, payPctArrived: 40 }), null);
  assert.match(paymentPlanError({ paymentTerms: 'CUSTOM', payPctOrdered: 30, payPctShipped: 30 })!, /100%/);
  assert.match(paymentPlanError({ paymentTerms: 'CUSTOM', payPctOrdered: -1, payPctShipped: 101 })!, /tussen 0 en 100/);
});

const source = await readFile(new URL('../src/app/features/purchasing/purchase-editor.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('purchase-editor.ts', source, ts.ScriptTarget.Latest, true);
const original = parsed.statements.find((node): node is ts.ClassDeclaration => ts.isClassDeclaration(node) && node.name?.text === 'PurchaseEditor')!;
const names = new Set(['paying', 'payingBusy', 'payments', 'paymentPlanOrder', 'paymentPlanBusy', 'paymentPlanFailure',
  'setPaymentAmount', 'setPaymentAmountEur', 'paymentDraftEur', 'paymentRateEur', 'editPayment', 'closePayment', 'savePaymentPlan', 'confirmPayment', 'proofSlots', 'proofsOf',
  'firstInstalmentPrompt', 'confirmFirstInstalment', 'setFirstPaymentAmount',
  'setPaymentPart', 'paymentTransfer', 'paymentTransferEur', 'writeEur', 'paymentGoodsEur', 'bankLines', 'bankedPaymentIds', 'paymentOnBank',
  'paymentBankAccount', 'transferLine', 'bankToday']);
const members = original.members.filter(member => member.name && ts.isIdentifier(member.name) && names.has(member.name.text));
assert.equal(members.length, names.size);
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)),
  original.name, original.typeParameters, undefined, members);
const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function order(id = 50) { return { id, number: `PO-${id}`, paymentTerms: 'THIRDS', alias: 'Container', notes: '', lines: [] }; }
function payment() { return { id: 80, orderId: 50, amount: 1046.95, amountEur: 1046.95, currency: 'EUR', paidOn: '2026-09-13',
  label: 'Douane en transport', payee: 'LOGISTICS', instalmentDue: null, settles: false }; }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup() {
  const exports: Record<string, new () => any> = {};
  vm.runInNewContext(javascript, { exports, signal, computed, bankAmountsMatch, parsePurchasePaymentAmount, purchasePaymentOverage,
    paymentPlanError, preservePurchaseDraft, splitTransfer, invoiceDocument, lineMarkers, bankMarker, defaultBankAccount, readPayToBank, writePayToBank,
    PAYEE_LABEL, receiptInstant, receiptLocalParts, BANK_ZONE: 'Europe/Brussels', crypto: globalThis.crypto,
    messageOf: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback });
  const editor = new exports['PurchaseEditor']();
  const writes: any[] = []; const uploads: string[] = []; const toasts: any[] = []; const lines: any[] = [];
  const api = {
    updatePurchaseOrder: async (_id: number, body: any) => ({ order: { ...body }, reconciliation: { supplierInstalments: [] } }),
    addPayment: async (_id: number, body: any) => ({ ...payment(), ...body, id: 81 }),
    updatePayment: async (_id: number, id: number, body: any) => ({ ...payment(), ...body, id }),
    addDocument: async (_id: number, file: File) => ({ id: 900 + uploads.length, originalFilename: file.name, paymentId: 81 }),
    createLine: async (body: any) => ({ id: 500 + lines.length, ...body }),
  };
  Object.assign(editor, {
    view: signal({ order: order(), reconciliation: { supplierInstalments: [] } }), savedOrder: signal(JSON.stringify(order())),
    saving: signal(false), dirty: signal(false), paymentStateLoading: signal(false), paymentStateError: signal(null),
    documents: signal([]), previewVersion: 0, supplier: signal({ name: 'Yiwu Trading' }),
    ui: { toast: (...args: any[]) => toasts.push(args) }, eurOf: (amount: number, currency: string) => currency === 'USD' ? amount * 0.9 : amount,
    refreshPaymentState: async () => true, loadDocuments: async () => {},
    sourcing: {
      updatePurchaseOrder: (id: number, body: any) => { writes.push({ type: 'order', id, body: clone(body) }); return api.updatePurchaseOrder(id, body); },
      addPayment: (id: number, body: any) => { writes.push({ type: 'POST payment', id, body: clone(body) }); return api.addPayment(id, body); },
      updatePayment: (id: number, paymentId: number, body: any) => { writes.push({ type: 'PUT payment', id, paymentId, body: clone(body) }); return api.updatePayment(id, paymentId, body); },
      addDocument: (id: number, file: File) => { uploads.push(file.name); return api.addDocument(id, file); },
    },
    bankAccounts: { options: signal([{ key: 'KBC', label: 'KBC' }]), loading: signal(false), load: async () => {} },
    banking: { create: (body: any) => { lines.push(clone(body)); return api.createLine(body); } },
  });
  editor.payments.set([payment()]);
  return { editor, api, writes, uploads, toasts, lines };
}

/** A supplier transfer in USD that pays the goods, the CIF freight and the inspection, with the bank's euro typed in. */
function splitDraft() {
  return { id: null, amount: 1000, amountInput: '1000', currency: 'USD', paidOn: '2026-07-02', label: 'Saldo', payee: 'SUPPLIER', files: [], settles: false,
    instalmentDue: 'ARRIVED', amountEurInput: '1234,56', amountEur: 1234.56, freightAmountInput: '333,33', freightAmount: 333.33, separateAmountInput: '100', separateAmount: 100,
    toBank: true, bankAccount: 'KBC' };
}
/** A server that stores what it gets and, like the real one, keeps a stored euro when a PUT carries none. */
function ledgerServer(api: ReturnType<typeof setup>['api'], editor: any) {
  const ledger: any[] = []; let nextId = 81;
  api.addPayment = async (_id, body) => {
    const row = { ...payment(), ...body, id: nextId++, amountEur: body.amountEur ?? Math.round(body.amount * 90) / 100 };
    ledger.push(row); return row;
  };
  api.updatePayment = async (_id, id, body) => { const row = ledger.find(item => item.id === id); Object.assign(row, body); return { ...row }; };
  editor.refreshPaymentState = async () => { editor.payments.set(ledger.map(row => ({ ...row }))); return true; };
  return ledger;
}

test('a USD transfer with a typed debit and both parts posts three payments and one bank line with the typed figure and every id', async () => {
  const { editor, api, writes, toasts, lines } = setup();
  const ledger = ledgerServer(api, editor);
  editor.paying.set(splitDraft());
  assert.equal(editor.paymentTransferEur(), 1234.56, 'the typed debit already covers the goods and the parts');
  assert.equal(editor.paymentGoodsEur(), 861.33, 'the overage hint weighs the goods share only');
  await editor.confirmPayment();
  assert.deepEqual(writes.map(row => [row.type, row.body.payee, row.body.instalmentDue ?? null, row.body.amountEur, row.body.label]),
    [['POST payment', 'SUPPLIER', 'ARRIVED', 861.33, 'Saldo'], ['POST payment', 'SUPPLIER', 'FREIGHT', 287.1, 'Saldo · zeevracht (CIF)'], ['POST payment', 'SEPARATE', null, 86.13, 'Saldo · inspectie']]);
  assert.equal(ledger.reduce((sum, row) => sum + row.amountEur, 0), 1234.56);
  assert.equal(lines.length, 1);
  assert.deepEqual([lines[0].amountEur, lines[0].purchasePaymentIds, lines[0].direction, lines[0].account, lines[0].counterparty],
    [1234.56, [81, 82, 83], 'OUTGOING', 'KBC', 'Yiwu Trading']);
  assert.equal(lines[0].reference, 'Saldo · PO-50 · containerbetaling #81');
  assert.equal(editor.paying(), null);
  assert.deepEqual(toasts.at(-1), ['Betaling genoteerd · ook op KBC', 'ok']);
});

test('a part that fails leaves the goods euro alone: the retry posts only the missing part and the bank line still carries the typed figure', async () => {
  const { editor, api, writes, toasts, lines } = setup();
  const ledger = ledgerServer(api, editor);
  const post = api.addPayment; let fail = true;
  api.addPayment = async (id, body) => {
    if (body.payee === 'SEPARATE' && fail) { fail = false; throw new Error('Even geen verbinding'); }
    return post(id, body);
  };
  editor.paying.set(splitDraft());
  await editor.confirmPayment();
  assert.deepEqual(writes.map(row => row.type), ['POST payment', 'POST payment', 'POST payment']);
  assert.equal(lines.length, 0, 'no bank line while a part of the transfer is missing');
  assert.match(toasts.at(-1)[0], /het deel inspectie is niet genoteerd/);
  const draft = editor.paying();
  assert.deepEqual([draft.id, clone(draft.partIds), draft.freightAmount, draft.separateAmount, draft.planned.goodsEur, draft.planned.parts.length], [81, [82], null, 100, 861.33, 2]);
  assert.equal(editor.paymentTransferEur(), 1234.56, 'the frozen split still adds up to the typed debit');
  await editor.confirmPayment();
  assert.deepEqual(writes.slice(3).map(row => [row.type, row.body.payee, row.body.amountEur ?? 'none']), [['PUT payment', 'SUPPLIER', 'none'], ['POST payment', 'SEPARATE', 86.13]]);
  assert.deepEqual(ledger.map(row => row.amountEur), [861.33, 287.1, 86.13], 'the goods euro survives the retry');
  assert.deepEqual([lines[0].amountEur, lines[0].purchasePaymentIds], [1234.56, [81, 82, 83]]);
  assert.equal(editor.paying(), null);
  assert.deepEqual(toasts.at(-1), ['Betaling genoteerd · ook op KBC', 'ok']);
});

test('a failed bank line keeps the sheet open, so the retry sends the line once more with every id and the full debit', async () => {
  const { editor, api, writes, toasts, lines } = setup();
  const ledger = ledgerServer(api, editor);
  api.createLine = async () => { throw new Error('Bank even niet bereikbaar'); };
  editor.paying.set(splitDraft());
  await editor.confirmPayment();
  assert.deepEqual(toasts.at(-1), ['Betaling genoteerd, maar de bankbeweging is niet bewaard.', 'err']);
  assert.deepEqual([editor.paying().id, clone(editor.paying().partIds)], [81, [82, 83]]);
  api.createLine = async (body) => ({ id: 500, ...body });
  await editor.confirmPayment();
  assert.deepEqual(writes.slice(3).map(row => [row.type, row.body.amountEur ?? 'none']), [['PUT payment', 'none']], 'nothing is posted twice');
  assert.deepEqual(ledger.map(row => row.amountEur), [861.33, 287.1, 86.13]);
  assert.deepEqual(lines.map(line => [line.amountEur, line.purchasePaymentIds]), [[1234.56, [81, 82, 83]], [1234.56, [81, 82, 83]]]);
  assert.equal(editor.paying(), null);
});

test('editing preserves the booking label and invalid money blocks save instead of submitting the old value', async () => {
  const { editor, writes } = setup();
  editor.editPayment(payment());
  assert.equal(editor.paying().label, 'Douane en transport');
  editor.setPaymentAmount('1.200,25');
  assert.equal(editor.paying().amount, 1200.25);
  editor.setPaymentAmount('1,20,25');
  assert.equal(editor.paying().amount, null);
  assert.equal(editor.paying().amountInput, '1,20,25');
  await editor.confirmPayment();
  assert.equal(writes.length, 0);
  editor.setPaymentAmount('1.200,25');
  await editor.confirmPayment();
  assert.equal(writes[0].type, 'PUT payment');
  assert.equal(writes[0].paymentId, 80);
  assert.equal(writes[0].body.amount, 1200.25);
  assert.equal(writes[0].body.label, 'Douane en transport');
});

test('metadata-only foreign currency edits preserve historical EUR; changed money uses the current rate', () => {
  const { editor } = setup();
  const old = { ...payment(), amount: 1000, currency: 'USD', amountEur: 830 };
  editor.payments.set([old]); editor.editPayment(old);
  assert.equal(editor.paymentDraftEur(), 830);
  editor.setPaymentAmount('1100'); assert.equal(editor.paymentDraftEur(), 990);
  editor.setPaymentAmount('1000'); assert.equal(editor.paymentDraftEur(), 830);
});

test('the bank euro amount of a USD payment travels with the write; euro payments and an empty field send none', async () => {
  const { editor, writes } = setup();
  editor.paying.set({ id: null, amount: 21453.49, amountInput: '21453,49', currency: 'USD', paidOn: '2026-07-02', label: 'Aanbetaling 30%', payee: 'SUPPLIER', files: [], settles: false, instalmentDue: null });
  assert.equal(editor.paymentRateEur(), 19308.14, 'the order-rate estimate feeds the placeholder and the hint');
  assert.equal(editor.paymentDraftEur(), 19308.14);
  editor.setPaymentAmountEur('18.300,00');
  assert.deepEqual([editor.paying().amountEur, editor.paying().amountEurInput, editor.paymentDraftEur()], [18300, '18.300,00', 18300]);
  await editor.confirmPayment();
  assert.equal(writes[0].type, 'POST payment');
  assert.equal(writes[0].body.amountEur, 18300);
  // Changing the foreign amount clears the bank amount: it belonged to the old figure.
  editor.paying.set({ id: null, amount: 21453.49, amountInput: '21453,49', currency: 'USD', paidOn: '2026-07-02', label: '', payee: 'SUPPLIER', files: [], settles: false, instalmentDue: null, amountEurInput: '18.300,00', amountEur: 18300 });
  editor.setPaymentAmount('22000');
  assert.deepEqual([editor.paying().amountEur, editor.paying().amountEurInput], [null, '']);
  editor.setPaymentAmount('22000');
  assert.equal(editor.paying().amountEur, null, 'retyping the same amount changes nothing');
  await editor.confirmPayment();
  assert.equal('amountEur' in writes[1].body, false, 'an empty field means the order rate: nothing is sent');
  editor.paying.set({ id: null, amount: 500, amountInput: '500', currency: 'EUR', paidOn: '2026-07-02', label: '', payee: 'SUPPLIER', files: [], settles: false, instalmentDue: null, amountEurInput: '480', amountEur: 480 });
  assert.equal(editor.paymentDraftEur(), 500, 'a euro payment ignores a stale bank amount');
  await editor.confirmPayment();
  assert.equal('amountEur' in writes[2].body, false, 'never for a euro payment');
  editor.setPaymentAmountEur('nonsense');
  assert.deepEqual([editor.paying(), writes.length], [null, 3], 'after a save the sheet is closed and a stray input changes nothing');
});

test('editing a foreign payment brings its booked euro value into the bank field; a euro payment leaves it empty', () => {
  const { editor } = setup();
  const foreign = { ...payment(), amount: 1000, currency: 'USD', amountEur: 830 };
  editor.payments.set([foreign]); editor.editPayment(foreign);
  assert.deepEqual([editor.paying().amountEur, editor.paying().amountEurInput], [830, '830']);
  editor.editPayment(payment());
  assert.deepEqual([editor.paying().amountEur, editor.paying().amountEurInput], [null, '']);
  assert.equal(editor.paymentRateEur(), 0, 'no order-rate estimate for euro money');
});

test('partial proof-upload failure retries remaining files with the saved payment ID', async () => {
  const { editor, api, writes, uploads } = setup();
  const first = new File(['a'], 'first.pdf', { type: 'application/pdf' });
  const second = new File(['b'], 'second.pdf', { type: 'application/pdf' });
  editor.paying.set({ ...payment(), id: null, amountInput: '1046,95', files: [first, second] });
  let fail = true;
  api.addDocument = async (_id, file) => {
    if (file.name === 'second.pdf' && fail) { fail = false; throw new Error('Upload tijdelijk niet beschikbaar'); }
    return { id: file === first ? 901 : 902, originalFilename: file.name, paymentId: 81 };
  };
  await editor.confirmPayment();
  assert.equal(editor.paying().id, 81);
  assert.deepEqual(Array.from(editor.paying().files, (file: File) => file.name), ['second.pdf']);
  assert.equal(editor.proofSlots(81), 4);
  await editor.confirmPayment();
  assert.deepEqual(writes.map(row => row.type), ['POST payment', 'PUT payment']);
  assert.deepEqual(uploads, ['first.pdf', 'second.pdf', 'second.pdf']);
  assert.equal(editor.paying(), null);
});

test('proof capacity includes saved attachments before any payment write', async () => {
  const { editor, writes } = setup();
  editor.documents.set(Array.from({ length: 5 }, (_, index) => ({ id: index, paymentId: 80 })));
  editor.editPayment(payment());
  editor.paying.update((draft: any) => ({ ...draft, files: [new File(['x'], 'new.pdf')] }));
  assert.equal(editor.proofSlots(80), 0);
  await editor.confirmPayment();
  assert.equal(writes.length, 0);
});

test('a pending payment cannot be closed or edited and late responses never replace another order', async () => {
  const { editor, api } = setup(); const wait = deferred<any>();
  editor.editPayment(payment()); api.updatePayment = () => wait.promise;
  const saving = editor.confirmPayment();
  editor.closePayment(); editor.setPaymentAmount('1500');
  assert.equal(editor.paying().amount, 1046.95);
  editor.view.set({ order: order(51) });
  const next = { ...payment(), orderId: 51, id: 90, amountInput: '999', amount: 999, files: [] };
  editor.paying.set(next);
  wait.resolve(payment()); await saving;
  assert.equal(editor.paying(), next);
  assert.equal(editor.payingBusy(), false);
});

test('rejected new terms never change the displayed order or saved baseline', async () => {
  const { editor, api } = setup();
  editor.paymentPlanOrder.set(order());
  api.updatePurchaseOrder = async () => { throw new Error('Een betaald termijnmoment kan niet worden verwijderd.'); };
  const before = JSON.stringify(editor.view()); const baseline = editor.savedOrder();
  await editor.savePaymentPlan({ paymentTerms: 'CUSTOM', payPctOrdered: 0, payPctShipped: 50, payPctArrived: 50 });
  assert.equal(JSON.stringify(editor.view()), before); assert.equal(editor.savedOrder(), baseline);
  assert.match(editor.paymentPlanFailure(), /niet worden verwijderd/);
  assert.ok(editor.paymentPlanOrder());
});

test('saving an agreement does not write unrelated local edits and retains them after success', async () => {
  const { editor, api, writes } = setup(); const wait = deferred<any>();
  editor.paymentPlanOrder.set(order());
  editor.view.set({ order: { ...order(), alias: 'Mijn lokale alias' } });
  api.updatePurchaseOrder = () => wait.promise;
  const saving = editor.savePaymentPlan({ paymentTerms: 'CUSTOM', payPctOrdered: 50, payPctShipped: 50, payPctArrived: 0 });
  assert.equal(writes[0].body.alias, 'Container');
  editor.view.set({ order: { ...editor.view().order, notes: 'Ook nog mijn notitie' } });
  wait.resolve({ order: { ...writes[0].body, notes: 'Serverlogboek' } }); await saving;
  assert.equal(editor.view().order.alias, 'Mijn lokale alias');
  assert.equal(editor.view().order.notes, 'Ook nog mijn notitie');
  assert.equal(editor.view().order.paymentTerms, 'CUSTOM');
  assert.equal(JSON.parse(editor.savedOrder()).alias, 'Container');
  assert.equal(editor.paymentPlanOrder(), null);
});

test('a late agreement response does not overwrite a newly opened container', async () => {
  const { editor, api } = setup(); const wait = deferred<any>();
  editor.paymentPlanOrder.set(order()); api.updatePurchaseOrder = () => wait.promise;
  const saving = editor.savePaymentPlan({ paymentTerms: 'THIRDS' });
  editor.view.set({ order: order(51) }); editor.savedOrder.set(JSON.stringify(order(51)));
  wait.resolve({ order: order() }); await saving;
  assert.equal(editor.view().order.id, 51); assert.equal(JSON.parse(editor.savedOrder()).id, 51);
});

test('a new imported transfer uses one atomic call and a lost response retries the same immutable split', async () => {
  const { editor, writes, lines } = setup(); const requests: any[] = []; let fails = true;
  editor.banking.addPurchasePayment = async (id: number, orderId: number, payments: any[]) => {
    requests.push(clone({ id, orderId, payments }));
    if (fails) throw new Error('Bank temporarily unavailable');
    return { line: { id, amountEur: -1234.56, account: 'BE123456', source: 'ODOO', allocated: true }, payments: payments.map((body, i) => ({ ...payment(), ...body, id: 81 + i })) };
  };
  editor.paying.set({ ...splitDraft(), toBank: false, bankTransaction: { id: 44, amountEur: -1234.56, account: 'BE123456', source: 'ODOO' } });
  await editor.confirmPayment(); assert.equal(editor.paying().id, null);
  fails = false; await editor.confirmPayment();
  assert.equal(requests.length, 2); assert.deepEqual(requests[0], requests[1]);
  assert.equal(requests[0].payments.length, 3); assert.equal(requests[0].payments.reduce((sum: number, row: any) => sum + row.amountEur, 0), 1234.56);
  assert.equal(writes.length, 0, 'the separate payment API is never called');
  assert.equal(lines.length, 0); assert.equal(editor.paying(), null);
});

test('an atomic imported transfer followed by a failed proof upload retries only the missing proof', async () => {
  const { editor, api, writes, uploads } = setup(); let creates = 0;
  const proof = new File(['proof'], 'proof.pdf');
  editor.banking.addPurchasePayment = async (id: number, _orderId: number, payments: any[]) => {
    creates++;
    return { line: { id, amountEur: -1234.56, source: 'ODOO' }, payments: payments.map((body, i) => ({ ...payment(), ...body, id: 81 + i })) };
  };
  let fails = true; api.addDocument = async () => { if (fails) throw new Error('Upload failed'); return { id: 99, originalFilename: 'proof.pdf', paymentId: 81 }; };
  editor.paying.set({ ...splitDraft(), files: [proof], bankTransaction: { id: 44, amountEur: -1234.56, source: 'ODOO' } });
  await editor.confirmPayment(); assert.equal(editor.paying().bankLinkComplete, true); assert.deepEqual(Array.from(editor.paying().partIds), [82, 83]);
  fails = false; await editor.confirmPayment();
  assert.equal(creates, 1); assert.equal(writes.length, 0); assert.deepEqual(uploads, ['proof.pdf', 'proof.pdf']); assert.equal(editor.paying(), null);
});

test('an imported transfer with a different total cannot save payments before linking', async () => {
  const { editor, writes, lines, toasts } = setup();
  editor.paying.set({ ...splitDraft(), bankTransaction: { id: 44, amountEur: -999, account: 'BE123456' } });
  await editor.confirmPayment();
  assert.equal(writes.length, 0); assert.equal(lines.length, 0);
  assert.match(toasts.at(-1)[0], /0,02/);
});

test('a selected bank debit remains fixed while foreign goods or EUR freight shares are edited', () => {
  const { editor } = setup();
  const bankTransaction = { id: 44, amountEur: -1234.56, account: 'BE123456' };
  editor.paying.set({ ...splitDraft(), bankTransaction });
  editor.setPaymentAmount('1500');
  assert.equal(editor.paying().amountEur, 1234.56); assert.equal(editor.paymentTransferEur(), 1234.56);
  editor.paying.set({ ...splitDraft(), bankTransaction, currency: 'EUR', amount: 1234.56, amountEur: null, freightAmount: null, separateAmount: null });
  editor.setPaymentPart('freight', '200');
  assert.equal(editor.paying().amount, 1034.56); assert.equal(editor.paymentTransferEur(), 1234.56);
  editor.setPaymentPart('separate', '100');
  assert.equal(editor.paying().amount, 934.56); assert.equal(editor.paymentTransferEur(), 1234.56);
  editor.setPaymentPart('freight', '1200'); assert.equal(editor.paying().amount, null, 'parts greater than the debit need correction');
});


test('the first-instalment shortcut opens the bank-enabled payment sheet without writing immediately', async () => {
  const { editor, writes } = setup();
  const file = new File(['proof'], 'proof.pdf');
  editor.firstInstalmentPrompt.set({ label: 'Voorschot', amount: 250, amountInput: '250', currency: 'USD', paidOn: '2026-10-01', due: 'ORDERED', files: [file] });
  await editor.confirmFirstInstalment();
  assert.equal(writes.length, 0); assert.equal(editor.firstInstalmentPrompt(), null);
  assert.equal(editor.paying().amount, 250); assert.equal(editor.paying().currency, 'USD'); assert.equal(editor.paying().instalmentDue, 'ORDERED');
  assert.equal(editor.paying().files[0], file); assert.equal(typeof editor.paying().toBank, 'boolean');
});


test('a selected purchase bank row can differ two cents from the original split without rewriting goods or parts', async () => {
  const { editor, writes } = setup(); const atomic: any[] = [];
  editor.banking.addPurchasePayment = async (id: number, _order: number, payments: any[]) => { atomic.push(...payments); return { line: { id }, payments: payments.map((body, i) => ({ ...payment(), ...body, id: 81 + i })) }; };
  const bank = { id: 44, amountEur: -1234.58, account: 'BE123456', source: 'ODOO' };
  editor.paying.set({ ...splitDraft(), bankTransaction: bank }); await editor.confirmPayment();
  assert.equal(writes.length, 0); assert.equal(atomic.length, 3);
  assert.equal(Math.round(atomic.reduce((sum, payment) => sum + payment.amountEur, 0) * 100), 123456);
  assert.equal(bank.amountEur, -1234.58); assert.equal(editor.paying(), null);
});
