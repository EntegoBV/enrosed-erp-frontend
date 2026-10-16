import { bankAmountsMatch, bankAmountDifference, bankTransactionDay } from '../src/app/shared/bank-transaction-options.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { signal, computed } from '@angular/core';
import { amountInputText, parsePurchasePaymentAmount, purchasePaymentOverage } from '../src/app/features/purchasing/purchase-payment-amount.ts';
import { paymentPlanError } from '../src/app/features/purchasing/payment-plan.ts';
import { splitTransfer } from '../src/app/features/purchasing/purchase-transfer-split.ts';
import {
  invoiceDocumentKind, invoiceNumberKey, invoicesOf, paymentRoundOnServer, primaryInvoice, resolveInvoice,
} from '../src/app/features/purchasing/purchase-invoices.ts';
import {
  alreadyLinkedText, carveForeignText, carveText, growLinkPlan, inspectionSplitBlocked, inspectionSplitEur, linkNotice, paymentFigure, pendingAlreadyLinked,
  pendingLinkPlan, pendingPartEur, surplusQuestion, transferCompanions,
} from '../src/app/features/purchasing/purchase-payment-links.ts';
import { lineMarkers } from '../src/app/features/finance/bank-markers.ts';
import { preservePurchaseDraft } from '../src/app/features/purchasing/purchase-payment-refresh.ts';
import { PAYEE_LABEL } from '../src/app/features/purchasing/purchase-payment-ledger.ts';
import { alsoContainerOptions, alsoNotice, alsoTotalEur, alsoWrites, proposeShare } from '../src/app/features/purchasing/purchase-also-containers.ts';
import { applyShare, shareBody, shareNewPart, sharePartsOf, shareStatus, shareToast } from '../src/app/features/purchasing/purchase-payment-share.ts';
import { containerName } from '../src/app/features/purchasing/container-name.ts';
import { containerPayables } from '../src/app/features/finance/payables.ts';
/** The menus module imports the payee words at runtime; its euro format is handed in as it reads. */
const formatEur = (value: number): string => value.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR' });
import { receiptLocalParts } from '../src/app/shared/received-at.ts';

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
  'bankToday', 'paymentInstalmentOptions',
  // the round of 2026-10-15: credit offsets, invoices, payments in parts, bank transactions as proof, the inspection split
  'payingCreditOffset', 'roundOnServer', 'payingRow', 'payingParts', 'saveGroup', 'reloadBankLines', 'groupOf', 'preselectedInvoice',
  'storedPaymentDraft', 'rebindPaying', 'removeSheetPart',
  // round 2: the payment follows the linked transaction, the main invoice by default, the notice after a link
  'unresolvedMainInvoice', 'sameStoredWords', 'resolvedInvoiceOf', 'paymentNotice',
  // round 3: a save that changes nothing of the payment writes nothing; where its term stands
  'storedUnchanged', 'payingTermStanding',
  // round-2 review: the file goes to the invoice the sheet showed
  'invoiceFileTarget',
  // owner addition 2026-10-15: one transfer for several containers
  'alsoPartsOf',
  // Emre, 2026-10-16: one transaction shared over containers, an open payment linked instead of a second one
  'alsoState', 'alsoFor', 'loadAlso', 'proposeShareRows', 'refreshAlsoRows', 'paymentRows', 'loadPaymentRows', 'payingLineShares', 'shareRefused', 'shareMissing']);
const members = original.members.filter(member => member.name && ts.isIdentifier(member.name) && names.has(member.name.text));
assert.equal(members.length, names.size);
const isolated = ts.factory.updateClassDeclaration(original, original.modifiers?.filter(modifier => !ts.isDecorator(modifier)),
  original.name, original.typeParameters, undefined, members);
const javascript = ts.transpileModule(ts.createPrinter().printFile(ts.factory.updateSourceFile(parsed, [isolated])), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
/** Intl writes '€' and the figure with a no-break space; the assertions read plain spaces. */
const plain = (text: string | null | undefined): string | null | undefined => text?.replace(/\u00a0/g, ' ');
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
    paymentPlanError, preservePurchaseDraft, splitTransfer, invoiceDocumentKind, invoicesOf, paymentRoundOnServer, primaryInvoice, inspectionSplitBlocked, inspectionSplitEur, pendingLinkPlan, pendingPartEur,
    carveText, carveForeignText, linkNotice, pendingAlreadyLinked, surplusQuestion, transferCompanions, invoiceNumberKey, resolveInvoice,
    amountInputText, growLinkPlan, alreadyLinkedText, paymentFigure, alsoNotice, alsoTotalEur, alsoWrites,
    alsoContainerOptions, proposeShare, applyShare, shareBody, shareNewPart, sharePartsOf, shareStatus, shareToast, containerName, containerPayables,
    SHARE_SERVER_PENDING: 'Verdelen over containers kan zodra de server bijgewerkt is.',
    NO_SHARE: { alsoParts: [], shareOwn: null, shareOwnInput: '', shareMode: undefined, shareProposed: false },
    bankTransactionDay, lineMarkers,
    PAYEE_LABEL, formatEur, receiptLocalParts, BANK_ZONE: 'Europe/Brussels', crypto: globalThis.crypto,
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
    view: signal({ order: order(), reconciliation: { supplierInstalments: [] }, creditOffsets: [] }), savedOrder: signal(JSON.stringify(order())),
    paymentLedger: signal(null), loadBankLines: async () => {},
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
    instalmentDue: 'ARRIVED', amountEurInput: '1234,56', amountEur: 1234.56, freightAmountInput: '333,33', freightAmount: 333.33, separateAmountInput: '100', separateAmount: 100 };
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

test('a USD transfer with a typed debit and both parts posts three payments with the typed figure and notes no bank line (the picked transaction is the movement)', async () => {
  const { editor, api, writes, toasts, lines } = setup();
  const ledger = ledgerServer(api, editor);
  editor.paying.set(splitDraft());
  assert.equal(editor.paymentTransferEur(), 1234.56, 'the typed debit already covers the goods and the parts');
  assert.equal(editor.paymentGoodsEur(), 861.33, 'the overage hint weighs the goods share only');
  await editor.confirmPayment();
  assert.deepEqual(writes.map(row => [row.type, row.body.payee, row.body.instalmentDue ?? null, row.body.amountEur, row.body.label]),
    [['POST payment', 'SUPPLIER', 'ARRIVED', 861.33, 'Saldo'], ['POST payment', 'SUPPLIER', 'FREIGHT', 287.1, 'Saldo · zeevracht (CIF)'], ['POST payment', 'SEPARATE', null, 86.13, 'Saldo · inspectie']]);
  assert.equal(ledger.reduce((sum, row) => sum + row.amountEur, 0), 1234.56);
  assert.equal(lines.length, 0, "no 'Ook als bankbeweging noteren' any more");
  assert.equal(editor.paying(), null);
  assert.deepEqual(toasts.at(-1), ['Betaling bewaard', 'ok']);
});

test('a part that fails leaves the goods euro alone: the retry posts only the missing part, and no bank line', async () => {
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
  assert.match(toasts.at(-1)[0], /het deel inspectie is niet genoteerd/);
  const draft = editor.paying();
  assert.deepEqual([draft.id, clone(draft.partIds), draft.freightAmount, draft.separateAmount, draft.planned.goodsEur, draft.planned.parts.length], [81, [82], null, 100, 861.33, 2]);
  assert.equal(editor.paymentTransferEur(), 1234.56, 'the frozen split still adds up to the typed debit');
  await editor.confirmPayment();
  assert.deepEqual(writes.slice(3).map(row => [row.type, row.body.payee, row.body.amountEur ?? 'none']), [['PUT payment', 'SUPPLIER', 'none'], ['POST payment', 'SEPARATE', 86.13]]);
  assert.deepEqual(ledger.map(row => row.amountEur), [861.33, 287.1, 86.13], 'the goods euro survives the retry');
  assert.equal(lines.length, 0);
  assert.equal(editor.paying(), null);
  assert.deepEqual(toasts.at(-1), ['Betaling aangepast', 'ok'], 'the retry wrote the saved goods payment once more and added the missing part');
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
  assert.deepEqual([editor.paying().amountEur, editor.paying().amountEurInput, editor.paying().amountInput], [830, '830,00', '1.000,00'], 'as the owner reads money');
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
  editor.paying.set({ ...splitDraft(), bankTransaction: { id: 44, amountEur: -1234.56, account: 'BE123456', source: 'ODOO' } });
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

test('one transfer for three containers: one atomic call, each other part on its own order; only this container\'s payments stay in the sheet', async () => {
  const { editor, writes, toasts } = setup(); const requests: any[] = [];
  editor.banking.addPurchasePayment = async (id: number, orderId: number, payments: any[]) => {
    requests.push(clone({ id, orderId, payments }));
    return { line: { id, amountEur: -16500, source: 'ODOO' }, payments: payments.map((body, i) => ({ ...payment(), ...body, orderId: body.purchaseOrderId ?? orderId, id: 81 + i })) };
  };
  const bankTransaction = { id: 103, amountEur: -16500, bookedAt: '2026-10-12T22:00:00Z', timeZone: 'Europe/Brussels', account: 'BE94731074082814', source: 'ODOO' };
  const also = [{ orderId: 44, number: 'PO-2026-044', supplierId: 8, due: 'ORDERED', label: '30% bij bestelling', amountInput: '3.000,00', amount: 3000 },
    { orderId: 45, number: 'PO-2026-045', supplierId: 8, due: 'ORDERED', label: '30% bij bestelling', amountInput: '4.500,00', amount: 4500 }];
  const draft = { id: null, amount: 9000, amountInput: '9.000,00', currency: 'EUR', paidOn: '2026-10-13', label: '30% bij bestelling', payee: 'SUPPLIER', files: [], settles: false,
    instalmentDue: 'ORDERED', bankTransaction, alsoOpen: true, alsoParts: also };
  // The parts must make the transaction: 9.000 + 3.000 alone is refused before anything is written.
  editor.paying.set({ ...draft, alsoParts: also.slice(0, 1) }); await editor.confirmPayment();
  assert.equal(requests.length, 0); assert.match(toasts.at(-1)[0], /Samen mogen de containers maximaal € 0,02 afwijken/);
  editor.paying.set({ ...draft, alsoParts: [{ ...also[0], amount: null, amountInput: 'x' }, also[1]] }); await editor.confirmPayment();
  assert.equal(requests.length, 0); assert.match(toasts.at(-1)[0], /positief bedrag/);
  editor.paying.set(draft); await editor.confirmPayment();
  assert.equal(requests.length, 1); assert.equal(writes.length, 0, 'no separate payment call');
  assert.equal(requests[0].orderId, 50);
  assert.deepEqual(requests[0].payments.map((row: any) => [row.purchaseOrderId ?? null, row.amount, row.instalmentDue, row.paidOn]),
    [[null, 9000, 'ORDERED', '2026-10-13'], [44, 3000, 'ORDERED', '2026-10-13'], [45, 4500, 'ORDERED', '2026-10-13']]);
  assert.equal(editor.paying(), null);
  assert.equal(plain(toasts.at(-1)[0]), 'Betaling bewaard en banktransactie gekoppeld · Ook op PO-2026-044 en PO-2026-045');
  // A USD payment or another payee never sends the parts it may still carry.
  requests.length = 0;
  editor.paying.set({ ...draft, payee: 'LOGISTICS', amount: 16500, amountInput: '16.500,00' }); await editor.confirmPayment();
  assert.equal(requests[0].payments.length, 1);
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
  assert.equal(editor.paying().files[0], file); assert.equal('toBank' in editor.paying(), false, "no 'Ook als bankbeweging noteren' any more");
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

test('PO 35: a payment never closes a netted term on its own, while the whole supplier and plain saving still work', async () => {
  // The server netted the 30 % term's + € 61,28 against the 70 % term's − € 60,78.
  const { editor, writes, toasts } = setup();
  editor.view.set({ order: { ...order(35), paymentTerms: 'DEPOSIT_30_70' }, reconciliation: { supplierInstalments: [
    { due: 'ORDERED', label: '30% bij bestelling', plannedEur: 9314.41, paidEur: 9375.69, remainingEur: 0, overpaidEur: 0.5, offsetEur: -60.78 },
    { due: 'SHIPPED', label: '70% bij vertrek', plannedEur: 21733.63, paidEur: 21672.85, remainingEur: 0, overpaidEur: 0, offsetEur: 60.78 },
  ] } });
  assert.deepEqual(clone(editor.paymentInstalmentOptions()), [
    { due: 'ORDERED', label: '30% bij bestelling', netted: true }, { due: 'SHIPPED', label: '70% bij vertrek', netted: true }]);
  const shipped = { ...payment(), id: 352, orderId: 35, amount: 21672.85, amountEur: 21672.85, payee: 'SUPPLIER', label: '70%', instalmentDue: 'SHIPPED' };
  editor.payments.set([shipped]);
  editor.editPayment(shipped);
  editor.paying.update((draft: any) => ({ ...draft, settles: true }));
  await editor.confirmPayment();
  assert.equal(writes.length, 0, 'closing the 70 % term alone would reopen € 60,78 on it');
  assert.deepEqual(toasts.at(-1), ['Deze termijn is verrekend met een andere termijn. Reken alles aan de leverancier af, niet deze termijn alleen.', 'err']);
  editor.paying.update((draft: any) => ({ ...draft, settles: true, instalmentDue: null }));
  await editor.confirmPayment();
  assert.deepEqual(writes.map(row => [row.type, row.body.settles, row.body.instalmentDue]), [['PUT payment', true, null]], 'the whole supplier settles');
  // An older response without offsetEur nets nothing: the term can be closed as before.
  editor.view.update((view: any) => ({ ...view, reconciliation: { supplierInstalments: view.reconciliation.supplierInstalments.map(({ offsetEur, ...term }: any) => term) } }));
  assert.equal(editor.paymentInstalmentOptions().some((option: { netted: boolean }) => option.netted), false);
});

/* ---- the round of 2026-10-15: bank transactions on a saved payment, payments in parts, the inspection split, the invoice */

/** A server with this round: its view carries `invoices`; link calls answer with the group and the touched lines. */
function roundSetup(stored: any = payment(), linked: (paymentId: number, lineId: number, surplus: string | null) => any[] = () => []) {
  const harness = setup();
  const { editor } = harness;
  const splits: any[] = [];
  editor.view.set({ order: order(), reconciliation: { supplierInstalments: [] }, creditOffsets: [], invoices: [] });
  editor.payments.set([stored]);
  // Like the server: a PUT answers the stored row with the new fields; without a euro, unchanged money keeps its euro, changed money takes the rate.
  harness.api.updatePayment = async (_id: number, id: number, body: any) => {
    const row = editor.payments().find((item: any) => item.id === id) ?? payment();
    const same = row.currency === body.currency && Math.round(row.amount * 100) === Math.round(body.amount * 100);
    const amountEur = body.amountEur ?? (same ? row.amountEur : body.currency === 'EUR' ? body.amount : Math.round(body.amount * 90) / 100);
    return { ...row, ...body, id, amountEur };
  };
  Object.assign(editor.sourcing, {
    linkPaymentPart: async (paymentId: number, bankStatementLineId: number, _amount: number | null = null,
      options: { higher?: string | null; withPaymentIds?: number[] } = {}) => {
      splits.push({ type: 'bank-part', paymentId, bankStatementLineId, ...(options.higher ? { surplus: options.higher } : {}),
        ...(options.withPaymentIds?.length ? { withPaymentIds: clone(options.withPaymentIds) } : {}) });
      return { payments: linked(paymentId, bankStatementLineId, options.higher ?? null), lines: [{ id: bankStatementLineId }] };
    },
    linkPaymentLines: async (paymentId: number, lines: any[]) => { splits.push({ type: 'bank-lines', paymentId, lines: clone(lines) }); return { payments: [], lines: lines.map(line => ({ id: line.bankStatementLineId })) }; },
    splitInspection: async (paymentId: number, body: any) => { splits.push({ type: 'inspection', paymentId, body: clone(body) }); return { payments: [], lines: [] }; },
  });
  editor.banking.linkPayments = async (id: number, body: any) => { splits.push({ type: 'links', id, body: clone(body) }); return { id }; };
  return { ...harness, splits };
}
const bankLine = (id: number, amountEur: number, bookedAt = '2026-09-24T09:00:00Z') => ({ id, amountEur, bookedAt, timeZone: 'Europe/Brussels', account: 'KBC', reference: 'Saldo' });

test('a saved payment and one matching transaction: no PUT first, bank-part links it whole and the payment follows the transaction', async () => {
  // The server answers the payment as it follows the line: the bank's day and its cents.
  const { editor, writes, splits, toasts } = roundSetup(payment(), (id, lineId) => [{ ...payment(), id, amount: 1046.97, amountEur: 1046.97, paidOn: '2026-09-24', bankStatementLineId: lineId }]);
  editor.editPayment(payment());
  editor.paying.update((draft: any) => ({ ...draft, pendingPartId: 80, pendingLines: [bankLine(520, -1046.97)] }));
  await editor.confirmPayment();
  assert.deepEqual(writes, [], 'nothing typed: the link alone writes the payment (no PUT then link)');
  assert.deepEqual(splits, [{ type: 'bank-part', paymentId: 80, bankStatementLineId: 520 }]);
  assert.deepEqual(toasts.at(-1), ['Banktransactie gekoppeld', 'ok']);
  assert.equal(editor.paying(), null);
  assert.equal(plain(editor.paymentNotice()?.text),
    'Bedrag en datum gevolgd van de transactie: € 1.046,97 op 24/09/2026 (was € 1.046,95 op 13/09/2026).');
  // Changed words go first, with the stored money and day; the link then carries the transaction's.
  const words = roundSetup();
  words.editor.editPayment(payment());
  words.editor.paying.update((draft: any) => ({ ...draft, label: 'Douane september', pendingPartId: 80, pendingLines: [bankLine(520, -1046.95)] }));
  await words.editor.confirmPayment();
  assert.deepEqual(words.writes.map(row => [row.type, row.paymentId, row.body.label, row.body.amount, row.body.paidOn]),
    [['PUT payment', 80, 'Douane september', 1046.95, '2026-09-13']]);
  assert.equal('invoiceId' in words.writes[0].body, false, 'an unchanged invoice choice is never sent');
  assert.deepEqual(words.splits, [{ type: 'bank-part', paymentId: 80, bankStatementLineId: 520 }]);
});

test('a larger transaction waits for the choice; "Bedrag aanpassen" and "Rest als inspectie" each link in one call with the notice', async () => {
  const goods = { ...payment(), payee: 'SUPPLIER', label: 'Aanbetaling 30%', amount: 10250, amountEur: 10250, paidOn: '2026-01-03', instalmentDue: 'ORDERED' };
  const adjust = roundSetup(goods, (id, lineId) => [{ ...goods, id, amount: 10300, amountEur: 10300, paidOn: '2026-01-05', bankStatementLineId: lineId }]);
  adjust.editor.editPayment(goods);
  adjust.editor.paying.update((draft: any) => ({ ...draft, pendingPartId: 80, pendingLines: [bankLine(610, -10300, '2026-01-05T09:00:00Z')] }));
  await adjust.editor.confirmPayment();
  assert.deepEqual([adjust.writes.length, adjust.splits.length], [0, 0], 'nothing happens before the owner chose');
  assert.deepEqual([plain(adjust.toasts.at(-1)[0]), adjust.toasts.at(-1)[1]], ['Transactie is € 50,00 hoger dan deze betaling: kies eerst wat er met het verschil gebeurt.', 'err']);
  adjust.editor.paying.update((draft: any) => ({ ...draft, surplus: 'ADJUST' }));
  await adjust.editor.confirmPayment();
  assert.deepEqual(adjust.splits, [{ type: 'bank-part', paymentId: 80, bankStatementLineId: 610, surplus: 'ADJUST' }]);
  assert.equal(plain(adjust.editor.paymentNotice()?.text),
    'Bedrag en datum gevolgd van de transactie: € 10.300,00 op 05/01/2026 (was € 10.250,00 op 03/01/2026).');
  const rest = roundSetup(goods, (id, lineId) => [{ ...goods, id, paidOn: '2026-01-05', bankStatementLineId: lineId },
    { ...goods, id: 81, payee: 'SEPARATE', label: 'Aanbetaling 30% · inspectie', amount: 50, amountEur: 50, paidOn: '2026-01-05', bankStatementLineId: lineId }]);
  rest.editor.editPayment(goods);
  rest.editor.paying.update((draft: any) => ({ ...draft, pendingPartId: 80, pendingLines: [bankLine(610, -10300, '2026-01-05T09:00:00Z')], surplus: 'INSPECTION',
    inspectionSplitInput: '50', inspectionSplit: 50 }));
  await rest.editor.confirmPayment();
  assert.deepEqual(rest.splits, [{ type: 'bank-part', paymentId: 80, bankStatementLineId: 610, surplus: 'INSPECTION' }], 'no second split on top of the rest');
  assert.deepEqual(rest.toasts.at(-1), ['Banktransactie gekoppeld · rest als inspectie', 'ok']);
  assert.equal(plain(rest.editor.paymentNotice()?.text), 'Datum gevolgd van de transactie: 05/01/2026 (was 03/01/2026). Rest als inspectie via leverancier: € 50,00.');
});

test('a lost answer of bank-lines: the refreshed payment carries both transactions, so the sheet clears the pick instead of refusing the retry', async () => {
  const root = { ...payment(), id: 102, payee: 'SUPPLIER', label: 'Saldo 70%', amount: 21733.63, amountEur: 21733.63, paidOn: '2026-09-05', instalmentDue: 'SHIPPED' };
  const { editor, splits, toasts } = roundSetup(root);
  const part = (item: any) => ({ id: item.id, payment: item, paidOn: item.paidOn, amount: item.amount, currency: item.currency, amountEur: item.amountEur,
    bankStatementLineId: item.bankStatementLineId ?? null, onBank: item.bankStatementLineId != null, proofs: [] });
  editor.paymentLedger.set({ rows: [{ id: 102, payment: root, parts: [part(root)], proofs: [] }] });
  // The server splits and links, then the answer is lost.
  const split = [{ ...root, amount: 10000, amountEur: 10000, paidOn: '2026-09-10', groupId: 102, bankStatementLineId: 520 },
    { ...root, id: 103, amount: 11733.63, amountEur: 11733.63, paidOn: '2026-09-24', groupId: 102, bankStatementLineId: 534 }];
  editor.sourcing.linkPaymentLines = async (paymentId: number, lines: any[]) => { splits.push({ type: 'bank-lines', paymentId, lines: clone(lines) }); throw new Error('Gateway Timeout'); };
  editor.refreshPaymentState = async () => {
    editor.payments.set(split);
    editor.paymentLedger.set({ rows: [{ id: 102, payment: split[0], parts: split.map(part), proofs: [] }] });
    return true;
  };
  editor.editPayment(root);
  editor.paying.update((draft: any) => ({ ...draft, pendingPartId: 102, pendingLines: [bankLine(520, -10000), bankLine(534, -11733.63)] }));
  await editor.confirmPayment();
  assert.equal(splits.length, 1);
  assert.equal(editor.paying(), null, 'the link did happen: the sheet closes');
  assert.deepEqual(toasts.at(-1), ['2 transacties al gekoppeld · betaald op 24/09/2026 (was 05/09/2026)', 'ok'], 'in its number, with what changed');
  // A retry from a sheet that still holds the pick (an older failure) recognises it before any check or write.
  editor.editPayment(split[0]);
  editor.paying.update((draft: any) => ({ ...draft, pendingPartId: 102, pendingLines: [bankLine(520, -10000), bankLine(534, -11733.63)], bankLinkPending: true, bankSavedPayment: split[0] }));
  await editor.confirmPayment();
  assert.equal(splits.length, 1, 'no second call');
  assert.equal(editor.paying(), null);
  assert.deepEqual(toasts.at(-1), ['2 transacties al gekoppeld', 'ok']);
});

test('a smaller transaction carves its part out of the payment; two that make the amount split it over both', async () => {
  const smaller = roundSetup();
  smaller.editor.editPayment(payment());
  smaller.editor.paying.update((draft: any) => ({ ...draft, pendingPartId: 80, pendingLines: [bankLine(520, -500)] }));
  await smaller.editor.confirmPayment();
  assert.deepEqual(smaller.splits, [{ type: 'bank-part', paymentId: 80, bankStatementLineId: 520 }]);
  assert.deepEqual(smaller.toasts.at(-1), ['Deel van de betaling gekoppeld', 'ok']);
  const two = roundSetup();
  two.editor.editPayment(payment());
  two.editor.paying.update((draft: any) => ({ ...draft, pendingPartId: 80, pendingLines: [bankLine(520, -500), bankLine(534, -546.97)] }));
  await two.editor.confirmPayment();
  assert.deepEqual(two.splits, [{ type: 'bank-lines', paymentId: 80, lines: [{ bankStatementLineId: 520 }, { bankStatementLineId: 534 }] }],
    'the sum is two cents off: still within the bank rule');
  assert.deepEqual(two.toasts.at(-1), ['Betaling verdeeld over 2 transacties', 'ok']);
  const wrong = roundSetup();
  wrong.editor.editPayment(payment());
  wrong.editor.paying.update((draft: any) => ({ ...draft, pendingPartId: 80, pendingLines: [bankLine(520, -500), bankLine(534, -500)] }));
  await wrong.editor.confirmPayment();
  assert.deepEqual([wrong.writes.length, wrong.splits.length], [0, 0], 'nothing is written when the transactions do not make the amount');
  assert.deepEqual(wrong.toasts.at(-1), ['Kies transacties die samen het bedrag maken, of één transactie voor een deel van het bedrag.', 'err']);
});

test('the inspection is split off after the link, with the goods payment\'s euro as the server must still have it', async () => {
  const goods = { ...payment(), payee: 'SUPPLIER', label: 'Aanbetaling 30%', amount: 10300, amountEur: 10300, instalmentDue: 'ORDERED' };
  const { editor, writes, splits, toasts } = roundSetup(goods);
  editor.editPayment(goods);
  editor.paying.update((draft: any) => ({ ...draft, pendingPartId: 80, pendingLines: [bankLine(610, -10300)], inspectionSplitInput: '300', inspectionSplit: 300 }));
  await editor.confirmPayment();
  assert.deepEqual(writes.map(row => row.type), [], 'only the transaction was picked: no PUT before the link');
  assert.deepEqual(splits, [{ type: 'bank-part', paymentId: 80, bankStatementLineId: 610 },
    { type: 'inspection', paymentId: 80, body: { amountEur: 300, expectedAmountEur: 10300 } }]);
  assert.deepEqual(toasts.at(-1), ['Banktransactie gekoppeld · Inspectie afgesplitst', 'ok']);
  // A lost answer of the split: the retry writes no payment again and sends the same body.
  const retry = roundSetup(goods);
  let fail = true;
  const split = retry.editor.sourcing.splitInspection;
  retry.editor.sourcing.splitInspection = async (id: number, body: any) => { if (fail) { fail = false; retry.splits.push({ type: 'lost', body: clone(body) }); throw new Error('Geen verbinding'); } return split(id, body); };
  retry.editor.editPayment(goods);
  retry.editor.paying.update((draft: any) => ({ ...draft, inspectionSplitInput: '300', inspectionSplit: 300 }));
  await retry.editor.confirmPayment();
  assert.equal(retry.editor.paying().bankLinkPending, true, 'the sheet stays, the form is held');
  retry.writes.length = 0;
  await retry.editor.confirmPayment();
  assert.equal(retry.writes.length, 0, 'the payment is not written twice');
  assert.deepEqual(retry.splits.map(row => row.body), [{ amountEur: 300, expectedAmountEur: 10300 }, { amountEur: 300, expectedAmountEur: 10300 }]);
  assert.equal(retry.editor.paying(), null);
});

test('a payment in parts: a corrected unlinked transfer gets its own PUT first, then one PUT on the root for the whole group', async () => {
  const root = { ...payment(), id: 102, payee: 'SUPPLIER', label: 'Saldo 70%', amount: 10000, amountEur: 10000, paidOn: '2026-09-10',
    instalmentDue: 'SHIPPED', groupId: 102, bankStatementLineId: 520 };
  const open = { ...root, id: 103, amount: 11733.63, amountEur: 11733.63, bankStatementLineId: null };
  const { editor, writes } = roundSetup(root);
  editor.payments.set([root, open]);
  const part = (item: any) => ({ id: item.id, payment: item, paidOn: item.paidOn, amount: item.amount, currency: item.currency, amountEur: item.amountEur,
    bankStatementLineId: item.bankStatementLineId, onBank: item.bankStatementLineId != null, proofs: [] });
  editor.paymentLedger.set({ rows: [{ id: 102, payment: root, parts: [part(root), part(open)], proofs: [] }] });
  editor.editPayment(root);
  assert.deepEqual(clone(editor.paying().groupIds), [102, 103]);
  editor.paying.update((draft: any) => ({ ...draft, label: 'Saldo', partEdits: { 103: { amountInput: '11733,65', amount: 11733.65 } } }));
  await editor.confirmPayment();
  assert.deepEqual(writes.map(row => [row.paymentId, row.body.amount, row.body.label, row.body.applyToGroup ?? false]),
    [[103, 11733.65, 'Saldo 70%', false], [102, 10000, 'Saldo', true]]);
  assert.equal('amountEur' in writes[1].body, false, 'the root\'s money goes as stored, without a euro');
  assert.deepEqual([writes[1].body.paidOn, writes[1].body.instalmentDue], ['2026-09-10', 'SHIPPED']);
});

test('the invoice choice travels only when it changed; a server without this round links one matching line the old way, on the bank\'s day', async () => {
  const { editor, writes } = roundSetup();
  editor.editPayment(payment());
  editor.paying.update((draft: any) => ({ ...draft, invoiceId: null, invoiceIdChanged: true }));
  await editor.confirmPayment();
  assert.equal(writes[0].body.invoiceId, null, 'back to automatic is sent explicitly');
  const older = roundSetup();
  older.editor.view.set({ order: order(), reconciliation: { supplierInstalments: [] }, creditOffsets: [] });
  older.editor.editPayment(payment());
  older.editor.paying.update((draft: any) => ({ ...draft, pendingPartId: 80, pendingLines: [bankLine(520, -1046.95, '2026-09-24T09:00:00Z')] }));
  await older.editor.confirmPayment();
  assert.equal(older.writes[0].body.paidOn, '2026-09-24', 'the payment takes the bank\'s day before /links');
  assert.equal('invoiceId' in older.writes[0].body, false);
  assert.deepEqual(older.splits, [{ type: 'links', id: 520, body: { purchasePaymentIds: [80] } }]);
});

test('an inline new invoice is saved once, with its file, before the payment; the payment points to it and the inspection part stays automatic', async () => {
  const { editor, api, writes } = roundSetup();
  const invoices: any[] = [];
  editor.sourcing.addInvoiceWithFile = async (_order: number, body: any, file: File, assignAll: boolean) => {
    invoices.push([clone(body), file.name, assignAll]); return { id: 7, ...body };
  };
  let fail = true;
  const post = api.addPayment;
  api.addPayment = async (id: number, body: any) => { if (fail) { fail = false; throw new Error('Even geen verbinding'); } return post(id, body); };
  const file = new File(['ci'], 'CI-2026-118.pdf');
  editor.paying.set({ ...splitDraft(), currency: 'EUR', amount: 10000, amountInput: '10000', amountEur: null, amountEurInput: '', freightAmount: null,
    freightAmountInput: '', newInvoice: { open: true, number: 'CI-2026-118', invoiceDate: '2026-08-20', amountInput: '31048,04', amount: 31048.04, currency: 'EUR', file, forAll: true } });
  await editor.confirmPayment();
  assert.equal(editor.paying().createdInvoiceId, 7, 'the invoice is kept for the retry');
  await editor.confirmPayment();
  assert.deepEqual(invoices, [[{ payee: 'SUPPLIER', number: 'CI-2026-118', invoiceDate: '2026-08-20', amount: 31048.04, currency: 'EUR', amountEur: null, documentId: null, notes: null },
    'CI-2026-118.pdf', false]], 'one call with the data and the file; the payee\'s only invoice needs no assignment');
  assert.deepEqual(writes.filter(row => row.type === 'POST payment').map(row => [row.body.payee, row.body.invoiceId, row.body.inspectionViaSupplier ?? false]),
    [['SUPPLIER', 7, false], ['SUPPLIER', 7, false], ['SEPARATE', null, true]], 'the failed goods POST, its retry on the same invoice, then the inspection');
});

test('an inspection split typed before a smaller transaction is picked is refused before any write: the split comes after the carve', async () => {
  const goods = { ...payment(), payee: 'SUPPLIER', label: 'Aanbetaling 30%', amount: 10300, amountEur: 10300, instalmentDue: 'ORDERED' };
  const { editor, writes, splits, toasts } = roundSetup(goods);
  editor.editPayment(goods);
  editor.paying.update((draft: any) => ({ ...draft, inspectionSplitInput: '300', inspectionSplit: 300, pendingPartId: 80, pendingLines: [bankLine(610, -5000)] }));
  await editor.confirmPayment();
  assert.deepEqual([writes.length, splits.length], [0, 0]);
  assert.deepEqual(toasts.at(-1), ['Eerst de banktransacties koppelen, daarna de inspectie afsplitsen.', 'err']);
  // Two transactions that make the amount: the same.
  editor.paying.update((draft: any) => ({ ...draft, pendingLines: [bankLine(610, -5000), bankLine(611, -5300)] }));
  await editor.confirmPayment();
  assert.deepEqual([writes.length, splits.length], [0, 0]);
});

test('a linked transaction is checked against the stored payment, and a later split sends the euro the server answered', async () => {
  const goods = { ...payment(), payee: 'SUPPLIER', label: 'Aanbetaling 30%', amount: 10000, amountEur: 10000, instalmentDue: 'ORDERED' };
  const { editor, writes, splits, toasts } = roundSetup(goods, (id, lineId) => [{ ...goods, id, amount: 10300, amountEur: 10300, bankStatementLineId: lineId }]);
  editor.editPayment(goods);
  // Typed money no longer decides the link: the € 10.300 transaction is larger than the stored € 10.000 and asks first.
  editor.setPaymentAmount('10300');
  editor.paying.update((draft: any) => ({ ...draft, pendingPartId: 80, pendingLines: [bankLine(610, -10300)], inspectionSplitInput: '300', inspectionSplit: 300 }));
  await editor.confirmPayment();
  assert.deepEqual([writes.length, splits.length], [0, 0]);
  assert.match(plain(toasts.at(-1)[0])!, /^Transactie is € 300,00 hoger dan deze betaling/);
  // Taken whole, then the split of a later save expects the euro the link answered.
  editor.paying.update((draft: any) => ({ ...draft, surplus: 'ADJUST', inspectionSplitInput: '', inspectionSplit: null }));
  await editor.confirmPayment();
  assert.deepEqual(splits, [{ type: 'bank-part', paymentId: 80, bankStatementLineId: 610, surplus: 'ADJUST' }]);
  assert.deepEqual(toasts.at(-1), ['Banktransactie gekoppeld', 'ok']);
  // A USD goods payment whose bank euro alone was corrected: the split expects the new euro and takes the new rate.
  const usd = { ...goods, currency: 'USD', amount: 11000, amountEur: 10000 };
  const foreign = roundSetup(usd);
  foreign.editor.editPayment(usd);
  foreign.editor.setPaymentAmountEur('10100');
  foreign.editor.paying.update((draft: any) => ({ ...draft, inspectionSplitInput: '330', inspectionSplit: 330 }));
  await foreign.editor.confirmPayment();
  assert.equal(foreign.writes[0].body.amountEur, 10100);
  assert.deepEqual(foreign.splits, [{ type: 'inspection', paymentId: 80, body: { amountEur: 303, amount: 330, expectedAmountEur: 10100 } }]);
});

test('removing the root of a USD payment in two parts rebinds the sheet to the other transfer with its own euro', async () => {
  const root = { ...payment(), id: 102, payee: 'SUPPLIER', label: 'Saldo 70%', amount: 10000, amountEur: 9000, currency: 'USD', paidOn: '2026-09-10',
    instalmentDue: 'SHIPPED', groupId: 102, bankStatementLineId: null };
  const rest = { ...root, id: 103, amount: 5000, amountEur: 4600, paidOn: '2026-09-24' };
  const { editor, writes } = roundSetup(root);
  editor.payments.set([root, rest]);
  let confirmed: Promise<void> | undefined;
  editor.ui.confirm = (_options: unknown, yes: () => Promise<void>) => { confirmed = yes(); };
  editor.sourcing.deletePayment = async () => {};
  editor.refreshPaymentState = async () => { editor.payments.set([{ ...rest, groupId: null }]); return true; };
  editor.editPayment(root);
  assert.equal(editor.paying().amountEur, 9000);
  editor.paying.update((draft: any) => ({ ...draft, label: 'Saldo', bankLinkPending: true, bankSavedPayment: root, inspectionExpectedEur: 9000 }));
  editor.removeSheetPart({ id: 102, payment: root, paidOn: root.paidOn, amount: 10000, currency: 'USD', amountEur: 9000, bankStatementLineId: null, onBank: false, proofs: [] });
  await confirmed;
  const draft = editor.paying();
  assert.deepEqual([draft.id, draft.amount, draft.amountEur, draft.amountEurInput, draft.paidOn, draft.label, clone(draft.groupIds)],
    [103, 5000, 4600, '4.600,00', '2026-09-24', 'Saldo', [103]], 'the survivor\'s money, the typed words');
  assert.deepEqual([draft.bankLinkPending, draft.bankSavedPayment, draft.inspectionExpectedEur], [false, undefined, undefined]);
  await editor.confirmPayment();
  assert.deepEqual(writes.map(row => [row.type, row.paymentId, row.body.amount, row.body.amountEur]), [['PUT payment', 103, 5000, 4600]]);
});

test('a group save whose root PUT fails after a corrected transfer was saved shows the group as the server now has it', async () => {
  const root = { ...payment(), id: 102, payee: 'SUPPLIER', label: 'Saldo 70%', amount: 10000, amountEur: 10000, paidOn: '2026-09-10',
    instalmentDue: 'SHIPPED', groupId: 102, bankStatementLineId: 520 };
  const open = { ...root, id: 103, amount: 11733.63, amountEur: 11733.63, bankStatementLineId: null };
  const { editor, api, writes, toasts } = roundSetup(root);
  editor.payments.set([root, open]);
  const part = (item: any) => ({ id: item.id, payment: item, paidOn: item.paidOn, amount: item.amount, currency: item.currency, amountEur: item.amountEur,
    bankStatementLineId: item.bankStatementLineId, onBank: item.bankStatementLineId != null, proofs: [] });
  editor.paymentLedger.set({ rows: [{ id: 102, payment: root, parts: [part(root), part(open)], proofs: [] }] });
  let refreshed = 0;
  editor.refreshPaymentState = async () => { refreshed++; return true; };
  const put = api.updatePayment;
  api.updatePayment = async (order: number, id: number, body: any) => { if (id === 102) throw new Error('Even geen verbinding'); return put(order, id, body); };
  editor.editPayment(root);
  editor.paying.update((draft: any) => ({ ...draft, partEdits: { 103: { amountInput: '11733,65', amount: 11733.65 } } }));
  await editor.confirmPayment();
  assert.deepEqual(writes.map(row => row.paymentId), [103, 102]);
  assert.equal(refreshed, 1, 'the saved transfer shows its new amount');
  assert.deepEqual(clone(editor.paying().partEdits), {}, 'its edit left the draft: the retry does not send it again');
  assert.deepEqual(toasts.at(-1), ['Even geen verbinding', 'err']);
});

/* ---- round 2 (Emre, 2026-10-15): one invoice for every part-payment */

const ci = (id: number, extra: any = {}) => ({ id, orderId: 50, payee: 'SUPPLIER', payeeLabel: 'Leverancier', number: `CI-${id}`, invoiceDate: '2026-08-20',
  amount: 31048.04, currency: 'EUR', amountEur: 31048.04, documentId: null, documentName: null, notes: null, actor: null, recordedAt: '2026-08-20T10:00:00Z',
  primary: id === 7, coversInspection: false, paymentIds: [], paidEur: 0, ...extra });

test('a new invoice "voor alle deelbetalingen" beside another one: one call with the file and assignAll; a lost answer is recognised, never made twice', async () => {
  const goods = { ...payment(), payee: 'SUPPLIER', label: 'Saldo', amount: 10000, amountEur: 10000, instalmentDue: null };
  const { editor, writes } = roundSetup(goods);
  editor.view.update((view: any) => ({ ...view, invoices: [ci(7)] }));
  const calls: any[] = [];
  let lost = true;
  editor.sourcing.addInvoiceWithFile = async (_order: number, body: any, file: File, assignAll: boolean) => {
    calls.push(['POST invoice + file', body.number, file.name, assignAll]);
    if (lost) {
      lost = false;
      // The server made it, with its file; the answer is lost. The refresh shows it.
      editor.refreshPaymentState = async () => { editor.view.update((view: any) => ({ ...view, invoices: [ci(7), ci(8, { number: 'CI-2026-140', primary: false, documentId: 905 })] })); return true; };
      throw new Error('Gateway Timeout');
    }
    return ci(8, { number: body.number });
  };
  editor.sourcing.assignInvoiceToAll = async (order: number, invoice: number) => { calls.push(['assign-all', order, invoice]); return [ci(7), ci(invoice)]; };
  editor.editPayment(goods);
  editor.paying.update((draft: any) => ({ ...draft, newInvoice: { open: true, number: 'CI-2026-140', invoiceDate: '2026-09-01', amountInput: '5000', amount: 5000,
    currency: 'EUR', file: new File(['x'], 'ci-140.pdf'), forAll: true } }));
  await editor.confirmPayment();
  assert.equal(writes.length, 0, 'the payment waits for the invoice');
  await editor.confirmPayment();
  assert.deepEqual(calls, [['POST invoice + file', 'CI-2026-140', 'ci-140.pdf', true], ['assign-all', 50, 8]],
    'the retry finds CI-2026-140 on the container and only assigns it (idempotent)');
  assert.deepEqual(writes.map(row => [row.type, row.body.invoiceId]), [['PUT payment', 8]]);
  // Off: only this payment points to the new invoice; without a file the JSON call.
  const single = roundSetup(goods);
  single.editor.view.update((view: any) => ({ ...view, invoices: [ci(7)] }));
  let assigned = 0;
  single.editor.sourcing.addInvoice = async (_order: number, body: any) => ({ id: 8, ...body });
  single.editor.sourcing.assignInvoiceToAll = async () => { assigned++; return []; };
  single.editor.editPayment(goods);
  single.editor.paying.update((draft: any) => ({ ...draft, newInvoice: { open: true, number: 'CI-2026-140', invoiceDate: '2026-09-01', amountInput: '5000', amount: 5000,
    currency: 'EUR', file: null, forAll: false } }));
  await single.editor.confirmPayment();
  assert.equal(assigned, 0);
  assert.deepEqual(single.writes.map(row => row.body.invoiceId), [8]);
});

test('a file chosen for an invoice without one goes to the invoice in one call, never to the payment', async () => {
  const goods = { ...payment(), payee: 'SUPPLIER', label: 'Saldo', amount: 10000, amountEur: 10000, instalmentDue: null };
  const { editor, uploads } = roundSetup(goods);
  editor.view.update((view: any) => ({ ...view, invoices: [ci(7, { notes: 'zie mail' })] }));
  const attached: any[] = [];
  editor.sourcing.attachInvoiceFile = async (_order: number, id: number, file: File) => { attached.push([id, file.name]); return ci(id, { documentId: 905 }); };
  editor.editPayment(goods);
  editor.paying.update((draft: any) => ({ ...draft, invoiceFile: new File(['x'], 'ci-7.pdf') }));
  await editor.confirmPayment();
  assert.deepEqual([attached, uploads], [[[7, 'ci-7.pdf']], []], 'no payment document');
});

test('editing a payment of a payee with two invoices and none of its own starts on the main invoice', () => {
  const goods = { ...payment(), payee: 'SUPPLIER', label: 'Saldo', amount: 10000, amountEur: 10000, instalmentDue: null };
  const { editor } = roundSetup(goods);
  editor.view.update((view: any) => ({ ...view, invoices: [ci(9), ci(7)] }));
  editor.editPayment(goods);
  assert.deepEqual([editor.paying().invoiceId, editor.paying().invoiceIdChanged], [7, true], 'the lowest id is the main invoice');
  editor.view.update((view: any) => ({ ...view, invoices: [ci(9, { paymentIds: [80] }), ci(7)] }));
  editor.paying.set(null);
  editor.editPayment(goods);
  assert.deepEqual([editor.paying().invoiceId, editor.paying().invoiceIdChanged], [null, false], 'an invoice that already covers it stays');
});

test('goods noted with their inspection on one day and a transaction of both: one bank-part call with the inspection along, no second inspection', async () => {
  const goods = { ...payment(), payee: 'SUPPLIER', label: 'Aanbetaling 30%', amount: 10000, amountEur: 10000, paidOn: '2026-08-03', instalmentDue: 'ORDERED' };
  const inspection = { ...goods, id: 81, payee: 'SEPARATE', label: 'Aanbetaling 30% · inspectie', amount: 300, amountEur: 300, instalmentDue: null };
  const { editor, writes, splits } = roundSetup(goods);
  editor.payments.set([goods, inspection]);
  editor.editPayment(goods);
  editor.paying.update((draft: any) => ({ ...draft, pendingPartId: 80, pendingLines: [bankLine(610, -10300.01, '2026-08-05T09:00:00Z')] }));
  await editor.confirmPayment();
  assert.deepEqual([writes.length, splits], [0, [{ type: 'bank-part', paymentId: 80, bankStatementLineId: 610, withPaymentIds: [81] }]],
    'no question about € 300 more: it is the inspection noted with the goods');
  // Another day's inspection is not this transfer's: the larger transaction asks.
  const apart = roundSetup(goods);
  apart.editor.payments.set([goods, { ...inspection, paidOn: '2026-08-04' }]);
  apart.editor.editPayment(goods);
  apart.editor.paying.update((draft: any) => ({ ...draft, pendingPartId: 80, pendingLines: [bankLine(610, -10300, '2026-08-05T09:00:00Z')] }));
  await apart.editor.confirmPayment();
  assert.equal(apart.splits.length, 0);
});

/* ---- round-2 review: a USD link as the server makes it, a refused link, the invoice a file and a number belong to */

test('a USD payment: one transaction links it whole (no amount sent), a part named in dollars goes as bank-part\'s amount', async () => {
  const usd = { ...payment(), payee: 'SUPPLIER', label: 'Saldo 70%', amount: 12000, currency: 'USD', amountEur: 10250, paidOn: '2026-01-03', instalmentDue: 'SHIPPED' };
  const sent: any[] = [];
  const whole = roundSetup(usd);
  whole.editor.sourcing.linkPaymentPart = async (id: number, lineId: number, amount: number | null, options: any) => {
    sent.push([id, lineId, amount, options.higher ?? null]);
    return { payments: [{ ...usd, amountEur: 5090, paidOn: '2026-01-05', bankStatementLineId: lineId }], lines: [{ id: lineId }],
      notice: 'Bedrag en datum gevolgd van de transactie: € 5.090,00 op 05/01/2026 (was € 10.250,00 op 03/01/2026).' };
  };
  whole.editor.editPayment(usd);
  whole.editor.paying.update((draft: any) => ({ ...draft, pendingPartId: 80, pendingLines: [bankLine(650, -5090, '2026-01-05T09:00:00Z')] }));
  await whole.editor.confirmPayment();
  assert.deepEqual(sent, [[80, 650, null, null]], 'never a euro carve: the server links a USD payment whole');
  assert.deepEqual(whole.toasts.at(-1), ['Banktransactie gekoppeld', 'ok']);
  // The part paid, in dollars.
  const half = roundSetup(usd);
  half.editor.sourcing.linkPaymentPart = async (id: number, lineId: number, amount: number | null) => { sent.push([id, lineId, amount]); return { payments: [], lines: [{ id: lineId }] }; };
  half.editor.editPayment(usd);
  half.editor.paying.update((draft: any) => ({ ...draft, pendingPartId: 80, pendingLines: [bankLine(650, -5090, '2026-01-05T09:00:00Z')],
    pendingPartAmountInput: '6.000', pendingPartAmount: 6000 }));
  await half.editor.confirmPayment();
  assert.deepEqual(sent.at(-1), [80, 650, 6000]);
  assert.deepEqual(half.toasts.at(-1), ['Deel van de betaling gekoppeld', 'ok']);
  assert.equal(plain(half.editor.paymentNotice()?.text),
    'Deel van deze betaling: US$ 6.000,00 (€ 5.090,00) van US$ 12.000,00; de rest (US$ 6.000,00) blijft open als tweede transactie.');
});

test('a refused link: with nothing written the choice is open again and nothing claims a saved payment; after a write the retry stays safe', async () => {
  const goods = { ...payment(), payee: 'SUPPLIER', label: 'Saldo 70%', amount: 10250, amountEur: 10250, paidOn: '2026-01-03', instalmentDue: 'SHIPPED' };
  const refusal = 'Inspectie via leverancier staat al geboekt: € 300,00 van € 300,00 inspectiekost; een tweede inspectie kan niet.';
  const untouched = roundSetup(goods);
  untouched.editor.sourcing.linkPaymentPart = async () => { throw new Error(refusal); };
  untouched.editor.editPayment(goods);
  untouched.editor.paying.update((draft: any) => ({ ...draft, pendingPartId: 80, pendingLines: [bankLine(610, -10300)], surplus: 'INSPECTION' }));
  await untouched.editor.confirmPayment();
  const open = untouched.editor.paying();
  assert.deepEqual([untouched.writes.length, open.bankLinkPending, open.bankSavedPayment, open.surplus, open.bankLinkError],
    [0, false, undefined, null, refusal], 'no PUT happened: the choice is open again, the words say only why');
  assert.equal(open.pendingLines.length, 1, 'the picked transaction stays for another choice');
  // Changed words were written first: the retry must not write them again, and says the payment is saved.
  const written = roundSetup(goods);
  written.editor.sourcing.linkPaymentPart = async () => { throw new Error(refusal); };
  written.editor.editPayment(goods);
  written.editor.paying.update((draft: any) => ({ ...draft, label: 'Saldo 70% juli', pendingPartId: 80, pendingLines: [bankLine(610, -10300)], surplus: 'INSPECTION' }));
  await written.editor.confirmPayment();
  assert.deepEqual([written.writes.length, written.editor.paying().bankLinkPending, written.editor.paying().paymentWritten], [1, true, true]);
  assert.equal(written.editor.paying().bankLinkError, `Betaling bewaard. ${refusal} Opnieuw proberen maakt geen extra betaling.`);
  // The owner picks 'Bedrag aanpassen' instead: the retry links with it and writes nothing again.
  written.editor.sourcing.linkPaymentPart = async (id: number, lineId: number, _amount: number | null, options: any) => {
    written.splits.push({ type: 'bank-part', paymentId: id, bankStatementLineId: lineId, surplus: options.higher }); return { payments: [], lines: [{ id: lineId }] };
  };
  written.editor.paying.update((draft: any) => ({ ...draft, surplus: 'ADJUST' }));
  await written.editor.confirmPayment();
  assert.deepEqual([written.writes.length, written.splits], [1, [{ type: 'bank-part', paymentId: 80, bankStatementLineId: 610, surplus: 'ADJUST' }]]);
  assert.equal(written.editor.paying(), null);
});

test('a typed invoice number the payee already has is another invoice: no call, no assign-all, the typed data and the file stay', async () => {
  const goods = { ...payment(), payee: 'SUPPLIER', label: 'Saldo', amount: 10000, amountEur: 10000, instalmentDue: null };
  const { editor, writes, toasts } = roundSetup(goods);
  editor.view.update((view: any) => ({ ...view, invoices: [ci(7, { number: 'CI-2026-118' }), ci(8, { number: 'CI-2026-140', primary: false })] }));
  const calls: any[] = [];
  editor.sourcing.addInvoiceWithFile = async (...args: any[]) => { calls.push(['POST invoice + file', args[1].number]); return ci(9); };
  editor.sourcing.addInvoice = async (...args: any[]) => { calls.push(['POST invoice', args[1].number]); return ci(9); };
  editor.sourcing.assignInvoiceToAll = async (...args: any[]) => { calls.push(['assign-all', ...args]); return []; };
  editor.sourcing.attachInvoiceFile = async (...args: any[]) => { calls.push(['attach', args[1]]); return ci(7); };
  editor.editPayment(goods);
  const file = new File(['x'], 'ci-118.pdf');
  editor.paying.update((draft: any) => ({ ...draft, newInvoice: { open: true, number: ' ci-2026-118', invoiceDate: '2026-09-01', amountInput: '5000', amount: 5000,
    currency: 'EUR', file, forAll: true } }));
  await editor.confirmPayment();
  assert.deepEqual([calls, writes.length], [[], 0]);
  assert.deepEqual(toasts.at(-1), ['Factuur CI-2026-118 bestaat al: kies die bij Factuur, of gebruik een ander nummer.', 'err']);
  assert.equal(editor.paying().newInvoice.file, file, 'nothing typed or chosen is lost');
  // A real lost answer of this sheet's own call whose file did not arrive: the retry reuses the invoice and sends the file to it.
  const retry = roundSetup(goods);
  retry.editor.view.update((view: any) => ({ ...view, invoices: [ci(7), ci(8, { number: 'CI-2026-140', primary: false })] }));
  const attached: any[] = [];
  retry.editor.sourcing.attachInvoiceFile = async (_order: number, id: number, sent: File) => { attached.push([id, sent.name]); return ci(id, { documentId: 906 }); };
  retry.editor.sourcing.assignInvoiceToAll = async () => [];
  retry.editor.editPayment(goods);
  retry.editor.paying.update((draft: any) => ({ ...draft, invoiceAttempt: 'ci-2026-140', newInvoice: { open: true, number: 'CI-2026-140', invoiceDate: '2026-09-01',
    amountInput: '5000', amount: 5000, currency: 'EUR', file: new File(['x'], 'ci-140.pdf'), forAll: true } }));
  await retry.editor.confirmPayment();
  assert.deepEqual(attached, [[8, 'ci-140.pdf']]);
  assert.deepEqual(retry.writes.map(row => [row.type, row.body.invoiceId]), [['PUT payment', 8]]);
});

test("'Bestand bij de factuur' of an inspection paid via the supplier goes to the supplier's invoice; without an invoice the file is kept", async () => {
  const goods = { ...payment(), id: 201, payee: 'SUPPLIER', label: 'Aanbetaling 30%', amount: 10000, amountEur: 10000, paidOn: '2026-08-03', bankStatementLineId: 610, instalmentDue: 'ORDERED' };
  const inspection = { ...goods, id: 202, payee: 'SEPARATE', label: 'Aanbetaling 30% · inspectie', amount: 300, amountEur: 300, instalmentDue: null };
  for (const chosenFor of [7, undefined]) {
    const { editor, uploads, toasts } = roundSetup(inspection);
    editor.view.update((view: any) => ({ ...view, order: { ...view.order, inspectionViaSupplier: true }, invoices: [ci(7)] }));
    editor.payments.set([goods, inspection]);
    const attached: any[] = [];
    editor.sourcing.attachInvoiceFile = async (_order: number, id: number, file: File) => { attached.push([id, file.name]); return ci(id, { documentId: 905 }); };
    editor.editPayment(inspection);
    editor.paying.update((draft: any) => ({ ...draft, invoiceFile: new File(['x'], 'ci-7.pdf'), invoiceFileFor: chosenFor }));
    await editor.confirmPayment();
    assert.deepEqual([attached, uploads], [[[7, 'ci-7.pdf']], []], `the supplier's invoice (${chosenFor ? 'as chosen' : 'by the automatic rule'})`);
    assert.equal(toasts.at(-1)[1], 'ok');
  }
  // No invoice to put it on: nothing is written, the file stays in the sheet.
  const none = roundSetup(inspection);
  none.editor.view.update((view: any) => ({ ...view, order: { ...view.order, inspectionViaSupplier: false }, invoices: [ci(7)] }));
  none.editor.payments.set([goods, inspection]);
  none.editor.editPayment(inspection);
  const file = new File(['x'], 'ci-7.pdf');
  none.editor.paying.update((draft: any) => ({ ...draft, label: 'Inspectie', invoiceFile: file }));
  await none.editor.confirmPayment();
  assert.deepEqual([none.writes.length, none.editor.paying().invoiceFile, none.toasts.at(-1)], [0, file, ['Kies eerst de factuur waar het bestand bij hoort.', 'err']]);
});

/* ---- round 3 (screen check of round 2): a payment fully on the bank grows, a lost answer says what changed, a file alone writes nothing else */

test("'Transactie toevoegen' on a payment fully on the bank: one bank-part with 'ADJUST', no PUT, the server's notice", async () => {
  const linked = { ...payment(), id: 201, payee: 'SUPPLIER', label: 'Aanbetaling 30%', amount: 12000, amountEur: 12000, paidOn: '2026-10-02',
    instalmentDue: 'ORDERED', bankStatementLineId: 680 };
  const { editor, writes, splits, toasts } = roundSetup(linked);
  const part = (item: any) => ({ id: item.id, payment: item, paidOn: item.paidOn, amount: item.amount, currency: item.currency, amountEur: item.amountEur,
    bankStatementLineId: item.bankStatementLineId ?? null, onBank: item.bankStatementLineId != null, proofs: [] });
  editor.paymentLedger.set({ rows: [{ id: 201, payment: linked, parts: [part(linked)], proofs: [] }] });
  editor.editPayment(linked);
  editor.paying.update((draft: any) => ({ ...draft, addTransfer: true, pendingPartId: 201, pendingLines: [bankLine(695, -500)] }));
  await editor.confirmPayment();
  assert.deepEqual(writes, [], 'the linked transfer stays as it is: nothing is written first');
  assert.deepEqual(splits, [{ type: 'bank-part', paymentId: 201, bankStatementLineId: 695, surplus: 'ADJUST' }]);
  assert.deepEqual(toasts.at(-1), ['Transactie toegevoegd', 'ok']);
  assert.equal(plain(editor.paymentNotice()?.text), 'Transactie van € 500,00 toegevoegd; de betaling is nu € 12.500,00 (was € 12.000,00).',
    'the same words as the server when its answer carries none');
  assert.equal(editor.paying(), null);
});

test('a lost bank-part answer: the refreshed payment carries the transaction and the toast says what changed', async () => {
  const stored = { ...payment(), id: 201, payee: 'SUPPLIER', label: 'Aanbetaling 30%', amount: 12000, amountEur: 12000, paidOn: '2026-10-02', instalmentDue: 'ORDERED' };
  const { editor, splits, toasts } = roundSetup(stored);
  const part = (item: any) => ({ id: item.id, payment: item, paidOn: item.paidOn, amount: item.amount, currency: item.currency, amountEur: item.amountEur,
    bankStatementLineId: item.bankStatementLineId ?? null, onBank: item.bankStatementLineId != null, proofs: [] });
  editor.paymentLedger.set({ rows: [{ id: 201, payment: stored, parts: [part(stored)], proofs: [] }] });
  const followed = { ...stored, amount: 12300, amountEur: 12300, paidOn: '2026-10-05', bankStatementLineId: 680 };
  editor.sourcing.linkPaymentPart = async (paymentId: number, bankStatementLineId: number) => { splits.push({ paymentId, bankStatementLineId }); throw new Error('Gateway Timeout'); };
  editor.refreshPaymentState = async () => {
    editor.payments.set([followed]);
    editor.paymentLedger.set({ rows: [{ id: 201, payment: followed, parts: [part(followed)], proofs: [] }] });
    return true;
  };
  editor.editPayment(stored);
  editor.paying.update((draft: any) => ({ ...draft, pendingPartId: 201, pendingLines: [bankLine(680, -12300)], surplus: 'ADJUST' }));
  await editor.confirmPayment();
  assert.equal(splits.length, 1);
  assert.deepEqual(toasts.at(-1).map(plain), ['Transactie al gekoppeld · bedrag nu € 12.300,00 (was € 12.000,00) · betaald op 05/10/2026 (was 02/10/2026)', 'ok']);
});

test("a proof file added to an unchanged payment only uploads: no PUT, 'Bewijs toegevoegd'", async () => {
  const { editor, writes, uploads, toasts } = roundSetup();
  editor.editPayment(payment());
  editor.paying.update((draft: any) => ({ ...draft, files: [new File(['x'], 'kbc-bevestiging.pdf')] }));
  await editor.confirmPayment();
  assert.deepEqual([writes, uploads], [[], ['kbc-bevestiging.pdf']]);
  assert.deepEqual(toasts.at(-1), ['Bewijs toegevoegd', 'ok']);
  // A changed word still writes, and says both.
  editor.editPayment(payment());
  editor.paying.update((draft: any) => ({ ...draft, label: 'Douane september', files: [new File(['x'], 'tweede.pdf')] }));
  await editor.confirmPayment();
  assert.deepEqual(writes.map(row => row.type), ['PUT payment']);
  assert.deepEqual(toasts.at(-1), ['Betaling aangepast · Bewijs toegevoegd', 'ok']);
});

test('where the edited payment stands: its supplier term, else its payee, as the server counts it', () => {
  const { editor } = roundSetup();
  const goods = { ...payment(), id: 201, payee: 'SUPPLIER', amount: 12000, amountEur: 12000, instalmentDue: 'ORDERED' };
  editor.payments.set([goods, payment()]);
  editor.view.set({ order: order(), creditOffsets: [], invoices: [], reconciliation: {
    supplierInstalments: [{ due: 'ORDERED', label: '30% bij bestelling', plannedEur: 12000, paidEur: 12000, remainingEur: 0 }],
    streams: [{ payee: 'LOGISTICS', label: 'Douane & transport', plannedEur: 1300, paidEur: 1046.95, remainingEur: 253.05 }] } });
  editor.editPayment(goods);
  assert.deepEqual(clone(editor.payingTermStanding()), { label: '30% bij bestelling', term: true, plannedEur: 12000, paidEur: 12000 });
  editor.editPayment(payment());
  assert.deepEqual(clone(editor.payingTermStanding()), { label: 'Douane & transport', term: false, plannedEur: 1300, paidEur: 1046.95 });
});

/* ---- Emre, 2026-10-16: "met 1 transactie 3 containers hun deelbetalingen betaald" */

/** PO-50 noted its 30 % (€ 3.070,20); PO-039 noted the same, PO-040 not yet; one € 11.403,38 transfer on 28/09 paid all three. */
function shareSetup() {
  const own = { ...payment(), id: 381, payee: 'SUPPLIER', label: '30% bij bestelling', amount: 3070.2, amountEur: 3070.2, paidOn: '2026-09-25', instalmentDue: 'ORDERED' };
  const harness = roundSetup(own);
  const { editor } = harness;
  editor.view.update((view: any) => ({ ...view, order: { ...view.order, alias: null, number: 'PO-2026-050', supplierId: 8 } }));
  const requests: any[] = [];
  const reply = (id: number, parts: any[]) => ({
    line: { ...bankLine(id, -11403.38, '2026-09-28T09:00:00Z'), allocated: true },
    payments: parts.map((part, index) => ({ ...own, id: part.paymentId ?? 900 + index, orderId: part.purchaseOrderId ?? (index === 0 ? 50 : 39), amount: part.amountEur,
      amountEur: part.amountEur, paidOn: '2026-09-28', bankStatementLineId: id })),
    parts: parts.map((part, index) => ({ paymentId: part.paymentId ?? 900 + index, orderId: part.purchaseOrderId ?? 50, amountEur: part.amountEur,
      outcome: part.paymentId ? 'GREW' : 'CREATED', wasEur: part.paymentId ? 3070.2 : null, wasPaidOn: part.paymentId ? '2026-09-25' : null, restPaymentId: null })),
  });
  editor.banking.sharePurchasePayment = async (id: number, parts: any[]) => { requests.push(clone({ id, parts })); return reply(id, parts); };
  editor.banking.addPurchasePayment = async () => { throw new Error('a container with an open payment never gets a second one'); };
  editor.sourcing.purchasePayments = async () => [];
  const others = [
    { orderId: 39, number: 'PO-2026-039', alias: 'Kerst 2026', supplierId: 8, due: 'ORDERED', label: '30% bij bestelling', amountInput: '3.801,13', amount: 3801.13,
      paymentId: 392, paymentEur: 3070.2, paymentCurrency: 'EUR', paymentAmount: 3070.2, paidOn: '2026-09-25', standing: null },
    { orderId: 40, number: 'PO-2026-040', alias: null, supplierId: 8, due: 'ORDERED', label: '30% bij bestelling', amountInput: '3.801,12', amount: 3801.12, paymentId: null,
      openEur: 3070.2, plannedEur: 3070.2, standing: null },
  ];
  const share = (values: any = {}) => {
    editor.editPayment(own);
    editor.paying.update((draft: any) => ({ ...draft, pendingPartId: 381, pendingLines: [bankLine(610, -11403.38, '2026-09-28T09:00:00Z')], surplus: 'SHARE',
      alsoParts: others, shareOwn: 3801.13, shareOwnInput: '3.801,13', shareMode: 'AFSPRAAK', ...values }));
  };
  return { ...harness, own, requests, reply, share, others };
}

test("'Verdelen en koppelen': one purchase-share call, this payment first, no PUT; the toast names every container and the pick is cleared", async () => {
  const { editor, writes, splits, toasts, requests, share } = shareSetup();
  share({ shareOwn: 3801.14, shareOwnInput: '3.801,14', alsoParts: [] });
  await editor.confirmPayment();
  assert.deepEqual([requests.length, plain(toasts.at(-1)[0]), toasts.at(-1)[1]], [0, 'Verdeel eerst de transactie: samen moeten de delen € 11.403,38 zijn.', 'err']);
  share({ shareOwn: 3500, shareOwnInput: '3.500' });
  await editor.confirmPayment();
  assert.equal(requests.length, 0, 'the parts must make the transaction before anything is written');
  share();
  await editor.confirmPayment();
  assert.deepEqual(writes, [], 'nothing typed: the share alone writes the payment');
  assert.deepEqual(splits, [], 'no bank-part or bank-lines beside it');
  assert.deepEqual(requests, [{ id: 610, parts: [
    { paymentId: 381, amountEur: 3801.13, expectedAmountEur: 3070.2 },
    { paymentId: 392, amountEur: 3801.13, expectedAmountEur: 3070.2 },
    { purchaseOrderId: 40, amountEur: 3801.12, payee: 'SUPPLIER', instalmentDue: 'ORDERED', label: '30% bij bestelling', settles: false },
  ] }]);
  assert.deepEqual([plain(toasts.at(-1)[0]), toasts.at(-1)[1]],
    ['Verdeeld over 3 containers: PO-2026-050 € 3.801,13 · Kerst 2026 € 3.801,13 · PO-2026-040 € 3.801,12', 'ok']);
  assert.equal(editor.paying(), null);
  assert.equal(plain(editor.paymentNotice()?.text), 'Bedrag en datum gevolgd van de transactie: € 3.801,13 op 28/09/2026 (was € 3.070,20 op 25/09/2026).');
  assert.equal(editor.bankLines()[0].id, 610, 'the line as the server describes it now');
});

test('a lost answer of purchase-share: the refreshed payment is on the transaction, so the sheet says so and never calls twice', async () => {
  const { editor, toasts, requests, share, own } = shareSetup();
  let calls = 0;
  editor.banking.sharePurchasePayment = async (id: number, parts: any[]) => { calls++; requests.push(clone({ id, parts })); throw Object.assign(new Error('Gateway Timeout'), { status: 504 }); };
  editor.refreshPaymentState = async () => { editor.payments.set([{ ...own, amount: 3801.13, amountEur: 3801.13, paidOn: '2026-09-28', bankStatementLineId: 610 }]); return true; };
  share();
  await editor.confirmPayment();
  assert.equal(calls, 1);
  assert.equal(plain(toasts.at(-1)[0]), 'Transactie al gekoppeld · bedrag nu € 3.801,13 (was € 3.070,20) · betaald op 28/09/2026 (was 25/09/2026)');
  assert.equal(editor.paying(), null);
});

test('a server without purchase-share says so; a refusal keeps the share open and drops a row whose payment is no longer open', async () => {
  const missing = shareSetup();
  missing.editor.banking.sharePurchasePayment = async () => { throw { status: 404, error: null }; };
  missing.share();
  await missing.editor.confirmPayment();
  assert.deepEqual([missing.editor.paying().bankLinkError, missing.editor.paying().surplus, missing.editor.paying().bankLinkPending],
    ['Verdelen over containers kan zodra de server bijgewerkt is.', 'SHARE', false]);
  assert.deepEqual(missing.toasts.at(-1), ['Verdelen over containers kan zodra de server bijgewerkt is.', 'err']);

  const refused = shareSetup();
  const reason = 'PO-2026-039: deze betaling staat al op de bank; maak die koppeling eerst los';
  refused.editor.banking.sharePurchasePayment = async () => { throw Object.assign(new Error(reason), { status: 409, error: { message: reason } }); };
  // The containers as the server has them now: PO-039's payment went onto another transaction.
  const views = [39, 40].map(id => ({ order: { id, number: `PO-2026-0${id}`, alias: null, supplierId: 8, status: 'BESTELD', archivedAt: null },
    reconciliation: { streams: [{ payee: 'SUPPLIER', label: 'Leverancier', status: 'OPEN', plannedEur: 10234, paidEur: 0, remainingEur: 10234, finalized: false }],
      supplierInstalments: [{ due: 'ORDERED', label: '30% bij bestelling', plannedEur: 3070.2, paidEur: id === 39 ? 3070.2 : 0, remainingEur: id === 39 ? 0 : 3070.2, finalized: false }] } }));
  Object.assign(refused.editor, { cashApi: { settings: async () => ({}) } });
  Object.assign(refused.editor.sourcing, { purchaseOrders: async () => views, suppliers: async () => [],
    purchasePayments: async () => [{ id: 392, orderId: 39, orderNumber: 'PO-2026-039', orderAlias: null, paidOn: '2026-09-25', amountEur: 3070.2, payee: 'SUPPLIER',
      bankStatementLineId: 77, instalmentDue: 'ORDERED', creditOffset: false }] });
  refused.share();
  await refused.editor.confirmPayment();
  await new Promise(resolve => setTimeout(resolve, 0));
  const draft = refused.editor.paying();
  assert.deepEqual([draft.bankLinkError, draft.surplus, draft.alsoParts.map((part: any) => part.orderId)], [reason, 'SHARE', [40]]);
  assert.deepEqual(refused.toasts.at(-1), [reason, 'err']);
});

test('a new transfer whose other container has an open payment links it in one purchase-share call, never a second payment', async () => {
  const { editor, writes, toasts, requests } = shareSetup();
  const bankTransaction = { id: 103, amountEur: -16500, bookedAt: '2026-10-12T22:00:00Z', timeZone: 'Europe/Brussels', account: 'BE94731074082814', source: 'ODOO' };
  const also = [{ orderId: 44, number: 'PO-2026-044', supplierId: 8, due: 'ORDERED', label: '30% bij bestelling', amountInput: '3.000,00', amount: 3000,
      paymentId: 441, paymentEur: 3000 },
    { orderId: 45, number: 'PO-2026-045', supplierId: 8, due: 'ORDERED', label: '30% bij bestelling', amountInput: '4.500,00', amount: 4500, paymentId: null }];
  editor.paying.set({ id: null, amount: 9000, amountInput: '9.000,00', currency: 'EUR', paidOn: '2026-10-13', label: '30% bij bestelling', payee: 'SUPPLIER', files: [],
    settles: false, instalmentDue: 'ORDERED', bankTransaction, alsoOpen: true, alsoParts: also });
  await editor.confirmPayment();
  assert.equal(writes.length, 0, 'no separate payment call');
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].parts.map((part: any) => [part.paymentId ?? null, part.purchaseOrderId ?? null, part.amountEur, part.expectedAmountEur ?? null, part.instalmentDue ?? null]),
    [[null, 50, 9000, null, 'ORDERED'], [441, null, 3000, 3000, null], [null, 45, 4500, null, 'ORDERED']]);
  assert.equal(plain(toasts.at(-1)[0]), 'Betaling bewaard en banktransactie gekoppeld · Ook op PO-2026-044 en PO-2026-045');
  assert.equal(editor.paying(), null);
});
